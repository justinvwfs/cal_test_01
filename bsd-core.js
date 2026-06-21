/**
 * ============================================================
 *  BSD 專屬應用系統 (BSD Sales Kit) — 精算核心模組 v4.0
 *  純運算模組 — 零UI依賴，可獨立在任何JS環境運行
 * ============================================================
 *  作者：今晚沒喝夠的小賈哥
 *  系統說明：此為業務單位自行獨立開發之應用系統，旨在最大化業務服務效能與實務應用分析能力。
 *
 *  本模組提供以下核心功能：
 *    1. calculateActualS()  — S值計算（補貼/退佣判定核心）
 *    2. solveIRR()          — IRR 牛頓法求解
 *    3. roundTo2()          — 四捨五入至小數點第二位
 *    4. calcPayment()       — 標準等額本息月付款計算
 *    5. buildAmortSchedule()— 本息攤還表生成
 *    6. smartSolveCore()    — 智慧同步計算（支援多階段+鎖定）
 *    7. calcFactoryCellCore()— 工廠矩陣單格計算
 *    8. calcManualPhasesCore()— 手動多階段組合計算
 *    9. auditOneCaseCore()  — 覆核單案核心邏輯
 *
 *  串接窗口（供下游模組使用）：
 *    - BSDCore.calculateActualS(B20, B4_m, flows)
 *    - BSDCore.solveIRR(p0, flows)
 *    - BSDCore.smartSolveCore(params) => { flows, irr, totalS, ... }
 *    - BSDCore.auditOneCaseCore(caseData, params) => { checks, status, ... }
 *
 *  部署支援：
 *    - 本機 HTML 離線：<script src="bsd-core.js">
 *    - GitHub Pages：同上
 *    - Google Apps Script：複製貼上此檔案內容
 *    - Node.js / Deno：module.exports / export
 * ============================================================
 */

(function(root) {
    'use strict';

    var BSDCore = {};

    // === 基礎工具 ===
    BSDCore.VERSION = '4.0.0';

    BSDCore.roundTo2 = function(val) {
        return Math.round(val * 100) / 100;
    };

    // === 顯示用格式化（不影響運算精度）===
    // 四捨五入到小數第N位（僅供顯示，如同 Excel 格式設定）
    BSDCore.formatRate = function(val, decimals) {
        if (val === null || val === undefined || isNaN(val)) return '-';
        var d = decimals !== undefined ? decimals : 2;
        var factor = Math.pow(10, d);
        return (Math.round(val * factor) / factor).toFixed(d);
    };

    // === 核心運算：S值計算 ===
    // S > 0 → 退佣（月付款高於 Buydown Rate 等價，多的退給經銷商）
    // S < 0 → 需補貼（月付款低於 Buydown Rate 等價，需經銷商/總代理補錢）
    BSDCore.calculateActualS = function(B20, B4_m, flows) {
        var npv_unit = 0;
        for (var i = 0; i < flows.length; i++) {
            npv_unit += (flows[i] / B20 * 10000) / Math.pow(1 + B4_m, i + 1);
        }
        return Math.floor(npv_unit - 10000) * B20 / 10000;
    };

    // === 核心運算：IRR 牛頓法 ===
    BSDCore.solveIRR = function(p0, flows) {
        var r = 0.005;
        for (var i = 0; i < 100; i++) {
            var f = p0;
            var df = 0;
            for (var t = 0; t < flows.length; t++) {
                f += flows[t] / Math.pow(1 + r, t + 1);
                df -= ((t + 1) * flows[t]) / Math.pow(1 + r, t + 2);
            }
            if (Math.abs(df) < 0.0000001) break;
            var newR = r - f / df;
            if (isNaN(newR) || !isFinite(newR)) break;
            r = newR;
        }
        return r;
    };

    // === 輔助：標準等額本息計算 ===
    BSDCore.calcPayment = function(loan, annualRate, term) {
        var m = annualRate / 100 / 12;
        if (m === 0) return Math.ceil(loan / term);
        var pow = Math.pow(1 + m, term);
        return Math.ceil(loan * m * pow / (pow - 1));
    };

    // === 輔助：生成攤還表 ===
    BSDCore.buildAmortSchedule = function(principal, flows, irr_m) {
        var schedule = [];
        var bal = principal;
        for (var i = 0; i < flows.length; i++) {
            var interest = bal * irr_m;
            var princPart = flows[i] - interest;
            bal -= princPart;
            schedule.push({
                period: i + 1,
                payment: Math.round(flows[i]),
                interest: Math.round(interest),
                principal: Math.round(princPart),
                balance: Math.max(0, Math.round(bal))
            });
        }
        return schedule;
    };

    // === 核心：智慧同步計算 (Tab1 精算核心) ===
    // params: { B20, B4_v, phases:[{months, value}], rateLock, agentLock, dealerLock, custRate, subAgent, subDealer }
    // 其中 phases[i].value 若為 null 代表需系統計算
    BSDCore.smartSolveCore = function(params) {
        var B20 = params.B20;
        var B4_v = params.B4_v;
        var B4_m = B4_v / 100 / 12;
        var phases = params.phases; // [{months:59, value:12000}, {months:1, value:null}]
        var rateLock = params.rateLock || false;
        var agentLock = params.agentLock || false;
        var dealerLock = params.dealerLock || false;
        var custRate = params.custRate;
        var subAgent = params.subAgent || 0;
        var subDealer = params.subDealer || 0;

        // 找出空白欄（需自動計算的）
        var emptyIdx = -1;
        for (var i = 0; i < phases.length; i++) {
            if (phases[i].months > 0 && (phases[i].value === null || phases[i].value === undefined)) {
                emptyIdx = i;
                break;
            }
        }

        var target_m = ((custRate !== null && custRate !== undefined && rateLock) ? custRate : B4_v) / 100 / 12;

        if (emptyIdx !== -1) {
            var knownPV = 0, currentT = 0, factor = 0;
            for (var i = 0; i < phases.length; i++) {
                for (var j = 0; j < phases[i].months; j++) {
                    currentT++;
                    if (i === emptyIdx) {
                        factor += 1 / Math.pow(1 + target_m, currentT);
                    } else {
                        knownPV += (phases[i].value || 0) / Math.pow(1 + target_m, currentT);
                    }
                }
            }
            var basePmt = Math.ceil((B20 - knownPV) / factor);

            // 補貼鎖定邏輯
            if (!rateLock && (agentLock || dealerLock)) {
                var sA = agentLock ? subAgent : 0;
                var sD = dealerLock ? subDealer : 0;
                var targetS_Limit = -(sA + sD);
                var getS = function(p) {
                    var npv_u = 0, t = 0;
                    for (var ii = 0; ii < phases.length; ii++) {
                        for (var jj = 0; jj < phases[ii].months; jj++) {
                            t++;
                            var val = (ii === emptyIdx) ? p : (phases[ii].value || 0);
                            npv_u += (val / B20 * 10000) / Math.pow(1 + B4_m, t);
                        }
                    }
                    return Math.round(Math.floor(npv_u - 10000) * B20 / 10000);
                };
                // 二分搜尋
                var lo = 0, hi = basePmt * 2;
                while (getS(hi) < targetS_Limit && hi < B20) hi *= 2;
                for (var iter = 0; iter < 100; iter++) {
                    var mid = Math.floor((lo + hi) / 2);
                    if (lo >= hi - 1) break;
                    if (getS(mid) >= targetS_Limit) hi = mid;
                    else lo = mid;
                }
                basePmt = hi;
                while (getS(basePmt) > targetS_Limit && basePmt > 0) basePmt--;
                while (getS(basePmt) < targetS_Limit) basePmt++;
                if (getS(basePmt) > targetS_Limit) basePmt--;
            }

            // 0% IRR Floor 保護
            var testFlows = [];
            for (var i = 0; i < phases.length; i++) {
                for (var j = 0; j < phases[i].months; j++) {
                    testFlows.push(i === emptyIdx ? basePmt : (phases[i].value || 0));
                }
            }
            var testIRR = BSDCore.solveIRR(-B20, testFlows);
            while (testIRR < 0) {
                basePmt++;
                testFlows = [];
                for (var i = 0; i < phases.length; i++) {
                    for (var j = 0; j < phases[i].months; j++) {
                        testFlows.push(i === emptyIdx ? basePmt : (phases[i].value || 0));
                    }
                }
                testIRR = BSDCore.solveIRR(-B20, testFlows);
            }

            // 回填
            phases[emptyIdx].value = basePmt;
        }

        // 建構 flows
        var flows = [];
        for (var i = 0; i < phases.length; i++) {
            for (var j = 0; j < phases[i].months; j++) {
                flows.push(phases[i].value || 0);
            }
        }

        var irr_m = BSDCore.solveIRR(-B20, flows);
        var fullCRate = irr_m * 12 * 100; // 保留完整精度，不在核心做任何進位
        var totalS = BSDCore.calculateActualS(B20, B4_m, flows);
        var totalPmt = 0;
        for (var i = 0; i < flows.length; i++) totalPmt += flows[i];

        // 補貼分配
        var neededTotal = (totalS < 0) ? Math.abs(totalS) : 0;
        var resultAgent = subAgent;
        var resultDealer = subDealer;
        if (dealerLock) {
            resultDealer = Math.max(0, neededTotal - subAgent);
        } else if (agentLock) {
            resultDealer = Math.max(0, neededTotal - subAgent);
        } else {
            resultAgent = 0;
            resultDealer = neededTotal;
        }

        var schedule = BSDCore.buildAmortSchedule(B20, flows, irr_m);

        return {
            phases: phases,
            flows: flows,
            irr_m: irr_m,
            customerRate: fullCRate, // 完整精度，顯示層自行格式化
            totalS: totalS,
            totalPayment: totalPmt,
            totalTerms: flows.length,
            subAgent: resultAgent,
            subDealer: resultDealer,
            schedule: schedule
        };
    };

    // === 工廠矩陣單格計算 ===
    // params: { loan, term, overridePmt, chargeRate, custRate, lockMode, agentMax, dealerFixed }
    BSDCore.calcFactoryCellCore = function(params) {
        var loan = params.loan;
        var term = params.term;
        var overridePmt = params.overridePmt || null;
        var chargeRateVal = params.chargeRate;
        var chargeRateM = chargeRateVal / 100 / 12;
        var lockMode = params.lockMode || false;
        var targetRateVal = lockMode ? (params.custRate || chargeRateVal) : chargeRateVal;
        var targetRateM = targetRateVal / 100 / 12;
        var agentMax = params.agentMax || 0;
        var dealerFixed = params.dealerFixed || 0;

        var pmt = 0;
        if (overridePmt !== null) {
            pmt = overridePmt;
        } else {
            if (lockMode) {
                var pow = Math.pow(1 + targetRateM, term);
                pmt = Math.ceil(loan * targetRateM * pow / (pow - 1));
            } else {
                var netLoan = loan - (agentMax + dealerFixed);
                var pow = Math.pow(1 + chargeRateM, term);
                pmt = Math.ceil(netLoan * chargeRateM * pow / (pow - 1));
                var limit = -(agentMax + dealerFixed);
                var getS = function(p) {
                    var flows = [];
                    for (var i = 0; i < term; i++) flows.push(p);
                    return BSDCore.calculateActualS(loan, chargeRateM, flows);
                };
                while (getS(pmt) < limit) pmt++;
            }
            var minPmt = Math.ceil(loan / term);
            if (pmt < minPmt) pmt = minPmt;
        }

        // 衍生數據
        var flows = [];
        for (var i = 0; i < term; i++) flows.push(pmt);
        var irr = BSDCore.solveIRR(-loan, flows);
        if (irr < 0) irr = 0;
        var rate = irr * 1200; // 保留完整精度，顯示層自行格式化
        var totalS = BSDCore.calculateActualS(loan, chargeRateM, flows);
        var subNeeded = (totalS < 0) ? Math.abs(totalS) : 0;
        var commission = (totalS > 0) ? totalS : 0;
        var agentUsed = Math.min(subNeeded, agentMax);
        var dealerUsed = subNeeded - agentUsed;

        return {
            pmt: pmt,
            chargeRateM: chargeRateM,
            customerRate: rate, // 完整精度
            totalS: totalS,
            commission: commission,
            subNeeded: subNeeded,
            agentUsed: agentUsed,
            dealerUsed: dealerUsed
        };
    };

    // === 手動多階段組合計算 ===
    // params: { loan, phases:[{m, v, isAuto}], overridePmt, chargeRate, custRate, lockMode, agentMax, dealerFixed }
    BSDCore.calcManualPhasesCore = function(params) {
        var loan = params.loan;
        var phases = params.phases;
        var overridePmt = params.overridePmt || null;
        var chargeRateVal = params.chargeRate;
        var chargeRateM = chargeRateVal / 100 / 12;
        var lockMode = params.lockMode || false;
        var agentMax = params.agentMax || 0;
        var dealerFixed = params.dealerFixed || 0;
        var custRateVal = params.custRate || chargeRateVal;

        var calcPmt = 0;
        if (overridePmt !== null) {
            calcPmt = overridePmt;
        } else {
            var targetPV = 0, targetRate = 0;
            if (lockMode) {
                targetRate = custRateVal / 100 / 12;
                targetPV = loan;
            } else {
                targetRate = chargeRateM;
                targetPV = loan - (agentMax + dealerFixed);
            }
            var fixedPV = 0, varFactor = 0, t = 0;
            for (var i = 0; i < phases.length; i++) {
                for (var k = 0; k < phases[i].m; k++) {
                    t++;
                    var disc = 1 / Math.pow(1 + targetRate, t);
                    if (!phases[i].isAuto) fixedPV += phases[i].v * disc;
                    else varFactor += disc;
                }
            }
            if (varFactor > 0) calcPmt = Math.ceil((targetPV - fixedPV) / varFactor);

            if (!lockMode) {
                var limit = -(agentMax + dealerFixed);
                var getS_Multi = function(p) {
                    var t_s = 0, npv_u = 0;
                    for (var ii = 0; ii < phases.length; ii++) {
                        var val = phases[ii].isAuto ? p : phases[ii].v;
                        for (var k = 0; k < phases[ii].m; k++) {
                            t_s++;
                            npv_u += (val / loan * 10000) / Math.pow(1 + chargeRateM, t_s);
                        }
                    }
                    return Math.round(Math.floor(npv_u - 10000) * loan / 10000);
                };
                while (getS_Multi(calcPmt) < limit) calcPmt++;
            }

            // 0% Floor
            var flowsCheck = [];
            for (var i = 0; i < phases.length; i++) {
                for (var k = 0; k < phases[i].m; k++) {
                    flowsCheck.push(phases[i].isAuto ? calcPmt : phases[i].v);
                }
            }
            while (BSDCore.solveIRR(-loan, flowsCheck) < 0) {
                calcPmt++;
                flowsCheck = [];
                for (var i = 0; i < phases.length; i++) {
                    for (var k = 0; k < phases[i].m; k++) {
                        flowsCheck.push(phases[i].isAuto ? calcPmt : phases[i].v);
                    }
                }
            }
        }

        var flows = [], details = [], st = 1;
        for (var i = 0; i < phases.length; i++) {
            var val = phases[i].isAuto ? calcPmt : phases[i].v;
            for (var k = 0; k < phases[i].m; k++) flows.push(val);
            var end = st + phases[i].m - 1;
            details.push({ from: st, to: end, value: val });
            st += phases[i].m;
        }

        var irr = BSDCore.solveIRR(-loan, flows);
        if (irr < 0) irr = 0;
        var rate = irr * 1200; // 保留完整精度
        var totalS = BSDCore.calculateActualS(loan, chargeRateM, flows);
        var subNeeded = (totalS < 0) ? Math.abs(totalS) : 0;
        var commission = (totalS > 0) ? totalS : 0;
        var agentUsed = Math.min(subNeeded, agentMax);
        var dealerUsed = subNeeded - agentUsed;

        return {
            rate: rate, // 完整精度
            dealerUsed: dealerUsed,
            agentUsed: agentUsed,
            commission: commission,
            details: details,
            flows: flows,
            autoPmt: calcPmt
        };
    };

    // === 覆核單案核心邏輯 ===
    BSDCore.auditOneCaseCore = function(caseData, params) {
        var amount = caseData.amount;
        var givenRate = caseData.rate;
        var phases = caseData.phases;
        var rowIndex = caseData.rowIndex;
        var buydownRate = params.buydownRate;
        var custRange = params.custRange;
        var agentSub = params.agentSub || 0;
        var dealerSub = params.dealerSub || 0;
        var commission = params.commission || 0;
        var tolerance = params.tolerance || 2;
        var bypassSubsidy = params.bypassSubsidy || false;

        var buydownM = buydownRate / 100 / 12;
        var checks = [];
        var overallStatus = 'pass';
        var totalTerms = 0;
        for (var i = 0; i < phases.length; i++) totalTerms += (phases[i].term || 0);
        var hasAllPmts = true;
        for (var i = 0; i < phases.length; i++) {
            if (phases[i].pmt === null || phases[i].pmt === undefined || phases[i].pmt <= 0) {
                hasAllPmts = false;
                break;
            }
        }
        var totalSub = agentSub + dealerSub;
        var hasGivenBudget = (commission > 0 || totalSub > 0);
        var computedRate = null;
        var displayRate = '-';
        var computedS = null;

        // Check A: Term sanity
        if (totalTerms === 0) {
            checks.push({ status: 'warn', label: '期數缺失', detail: '無法取得期數資訊，以下檢核可能不完整。' });
            overallStatus = 'warn';
        }

        // Check B: 模式標記
        if (hasGivenBudget) {
            if (commission > 0) {
                checks.push({ status: 'info', label: '覆核模式', detail: '有給定退佣 $' + commission.toLocaleString() + ' → 運算退佣不可超過此值' });
            } else {
                var parts = [];
                if (agentSub > 0) parts.push('總代理 $' + agentSub.toLocaleString());
                if (dealerSub > 0) parts.push('經銷商 $' + dealerSub.toLocaleString());
                checks.push({ status: 'info', label: '覆核模式', detail: '有給定補貼 ' + parts.join(' + ') + ' = $' + totalSub.toLocaleString() + ' → 運算補貼不可超過此值' });
            }
        } else {
            checks.push({ status: 'info', label: '覆核模式', detail: '無給定補貼/退佣 → 利率精準度驗證，不可產生任何補貼或退佣' });
        }

        // Check C: Payment verification (CORE)
        if (totalTerms > 0 && hasAllPmts) {
            var flows = [];
            for (var i = 0; i < phases.length; i++) {
                for (var j = 0; j < phases[i].term; j++) flows.push(phases[i].pmt);
            }

            computedS = BSDCore.calculateActualS(amount, buydownM, flows);
            var absS = Math.abs(Math.round(computedS));
            var irr = BSDCore.solveIRR(-amount, flows);
            if (irr < 0) irr = 0;
            computedRate = irr * 1200; // 保留完整精度
            displayRate = (Math.round(computedRate * 100) / 100).toFixed(2); // 顯示用：四捨五入到小數第二位

            // 情境A: 有給定補貼或退佣
            if (hasGivenBudget) {
                if (commission > 0) {
                    var actualCommission = Math.round(computedS);
                    if (actualCommission < 0) {
                        checks.push({ status: 'fail', label: '退佣驗證 — 異常', detail: '月付款組合反而需要補貼 $' + Math.abs(actualCommission).toLocaleString() + '，與退佣模式矛盾' });
                        overallStatus = 'fail';
                    } else if (actualCommission <= commission) {
                        checks.push({ status: 'pass', label: '退佣驗證 — 未超額', detail: '運算退佣 $' + actualCommission.toLocaleString() + ' ≤ 給定 $' + commission.toLocaleString() + ' (餘裕 $' + (commission - actualCommission).toLocaleString() + ')' });
                    } else {
                        checks.push({ status: 'fail', label: '退佣驗證 — 超額!', detail: '運算退佣 $' + actualCommission.toLocaleString() + ' > 給定 $' + commission.toLocaleString() + '，超額 $' + (actualCommission - commission).toLocaleString() });
                        overallStatus = 'fail';
                    }
                } else {
                    var actualSubsidy = computedS < 0 ? Math.abs(Math.round(computedS)) : 0;
                    if (computedS >= 0) {
                        checks.push({ status: 'pass', label: '補貼驗證 — 無需補貼', detail: '此月付款組合實際不需補貼，反而有退佣空間 $' + Math.round(computedS).toLocaleString() });
                    } else if (actualSubsidy <= totalSub) {
                        checks.push({ status: 'pass', label: '補貼驗證 — 未超額', detail: '運算需補貼 $' + actualSubsidy.toLocaleString() + ' ≤ 給定 $' + totalSub.toLocaleString() + ' (餘裕 $' + (totalSub - actualSubsidy).toLocaleString() + ')' });
                    } else {
                        checks.push({ status: 'fail', label: '補貼驗證 — 超額!', detail: '運算需補貼 $' + actualSubsidy.toLocaleString() + ' > 給定 $' + totalSub.toLocaleString() + '，超額 $' + (actualSubsidy - totalSub).toLocaleString() });
                        overallStatus = 'fail';
                    }
                }
            }
            // 情境B: 無給定
            else {
                if (givenRate !== null && givenRate !== undefined) {
                    var rateDiff = Math.abs(computedRate - givenRate);
                    if (rateDiff <= 0.01) {
                        checks.push({ status: 'pass', label: '利率精準度', detail: '給定 ' + givenRate + '% vs 運算 ' + displayRate + '%，差 ' + rateDiff.toFixed(4) + '% (容許 ±0.01%)' });
                    } else {
                        checks.push({ status: 'fail', label: '利率偏差超限', detail: '給定 ' + givenRate + '% vs 運算 ' + displayRate + '%，差 ' + rateDiff.toFixed(4) + '% (容許 ±0.01%)' });
                        overallStatus = 'fail';
                    }
                }

                var sValueTolerance = 10;
                if (Math.abs(Math.round(computedS)) <= sValueTolerance) {
                    checks.push({ status: 'pass', label: '零補貼/零退佣', detail: 'S值 $' + Math.round(computedS).toLocaleString() + ' ≈ $0 (容許 ±$' + sValueTolerance + ')，無額外成本產生' });
                } else if (computedS > sValueTolerance) {
                    if (bypassSubsidy) {
                        checks.push({ status: 'info', label: '參考：產生退佣', detail: 'S值 $' + Math.round(computedS).toLocaleString() + '（已略過覆核，僅供參考）' });
                    } else {
                        checks.push({ status: 'fail', label: '異常：產生退佣', detail: '無給定退佣情境下，S值 $' + Math.round(computedS).toLocaleString() + ' → 月付款偏高，客戶被多收' });
                        overallStatus = 'fail';
                    }
                } else {
                    if (bypassSubsidy) {
                        checks.push({ status: 'info', label: '參考：需要補貼', detail: 'S值 $' + Math.round(computedS).toLocaleString() + '，需額外補貼 $' + Math.abs(Math.round(computedS)).toLocaleString() + '（已略過覆核，僅供參考）' });
                    } else {
                        checks.push({ status: 'fail', label: '異常：需要補貼', detail: '無給定補貼情境下，S值 $' + Math.round(computedS).toLocaleString() + ' → 需額外補貼 $' + Math.abs(Math.round(computedS)).toLocaleString() + '，表示月付款偏低' });
                        overallStatus = 'fail';
                    }
                }
            }

            // 共用檢核
            if (custRange) {
                if (computedRate >= custRange.min - 0.01 && computedRate <= custRange.max + 0.01) {
                    checks.push({ status: 'pass', label: '利率區間', detail: '運算 ' + displayRate + '% 在 ' + custRange.min + '%~' + custRange.max + '% 內' });
                } else {
                    checks.push({ status: 'fail', label: '利率超出區間', detail: '運算 ' + displayRate + '%，設定區間 ' + custRange.min + '%~' + custRange.max + '%' });
                    overallStatus = 'fail';
                }
            }

            if (hasGivenBudget && givenRate !== null && givenRate !== undefined) {
                var rateDiff2 = Math.abs(computedRate - givenRate);
                if (rateDiff2 <= 0.05) {
                    checks.push({ status: 'pass', label: '利率吻合', detail: '給定 ' + givenRate + '% vs 運算 ' + displayRate + '%' });
                } else {
                    checks.push({ status: 'warn', label: '利率差異', detail: '給定 ' + givenRate + '% vs 運算 ' + displayRate + '%，差 ' + rateDiff2.toFixed(4) + '% (有給定補貼/退佣情境，供參考)' });
                    if (overallStatus === 'pass') overallStatus = 'warn';
                }
            }

            var totalPmt = 0;
            for (var i = 0; i < flows.length; i++) totalPmt += flows[i];
            if (totalPmt < amount) {
                checks.push({ status: 'fail', label: '付款不足', detail: '總付款 $' + totalPmt.toLocaleString() + ' < 本金 $' + amount.toLocaleString() });
                overallStatus = 'fail';
            }

            var sLabel = computedS >= 0
                ? '退佣 $' + Math.round(computedS).toLocaleString()
                : '需補貼 $' + Math.abs(Math.round(computedS)).toLocaleString();
            checks.push({ status: 'info', label: '📊 透明化摘要', detail: '客戶利率 ' + displayRate + '% ｜ ' + sLabel + ' ｜ Buydown ' + buydownRate + '%' });

        } else if (totalTerms > 0 && !hasAllPmts) {
            var autoIdx = -1;
            for (var i = 0; i < phases.length; i++) {
                if (phases[i].pmt === null) { autoIdx = i; break; }
            }
            if (autoIdx >= 0) {
                var targetRate = buydownM;
                var effectiveLoan = commission > 0 ? amount : (amount - totalSub);
                var fixedPV = 0, varFactor = 0, t = 0;
                for (var i = 0; i < phases.length; i++) {
                    for (var k = 0; k < phases[i].term; k++) {
                        t++;
                        var disc = 1 / Math.pow(1 + targetRate, t);
                        if (i === autoIdx) varFactor += disc;
                        else if (phases[i].pmt !== null) fixedPV += phases[i].pmt * disc;
                    }
                }
                if (varFactor > 0) {
                    var expectedPmt = Math.ceil((effectiveLoan - fixedPV) / varFactor);
                    checks.push({ status: 'info', label: '推算參考', detail: '第' + (autoIdx + 1) + '階段缺月付款，依Buydown Rate推算應為 $' + expectedPmt.toLocaleString() + '/月' });
                }
            }

            if (custRange) {
                checks.push({ status: 'warn', label: '缺少月付款', detail: '缺少完整月付款資訊，無法進行客戶利率覆核。' });
                if (overallStatus === 'pass') overallStatus = 'warn';
            }
        }

        return {
            rowIndex: rowIndex,
            amount: amount,
            phases: phases,
            givenRate: givenRate,
            checks: checks,
            status: overallStatus,
            computedRate: displayRate,
            computedS: computedS !== null ? Math.round(computedS) : null
        };
    };

    // === 覆核預期月付款計算 ===
    BSDCore.computeExpectedPmt = function(amount, term, buydownM, totalSub, commission, tolerance) {
        if (commission > 0) {
            var pow = Math.pow(1 + buydownM, term);
            var basePmt = Math.ceil(amount * buydownM * pow / (pow - 1));
            var pmt = basePmt;
            for (var i = 0; i < 5000; i++) {
                pmt++;
                var flows = [];
                for (var j = 0; j < term; j++) flows.push(pmt);
                var s = BSDCore.calculateActualS(amount, buydownM, flows);
                if (s >= commission) return pmt;
            }
            return pmt;
        } else if (totalSub > 0) {
            var targetS = -totalSub;
            var pow = Math.pow(1 + buydownM, term);
            var effectiveLoan = amount - totalSub;
            var pmt = Math.ceil(effectiveLoan * buydownM * pow / (pow - 1));
            var flows = [];
            for (var j = 0; j < term; j++) flows.push(pmt);
            var s = BSDCore.calculateActualS(amount, buydownM, flows);
            var dir = s < targetS ? 1 : -1;
            for (var i = 0; i < 5000; i++) {
                pmt += dir;
                flows = [];
                for (var j = 0; j < term; j++) flows.push(pmt);
                s = BSDCore.calculateActualS(amount, buydownM, flows);
                if ((dir > 0 && s >= targetS) || (dir < 0 && s <= targetS)) break;
            }
            return pmt;
        } else {
            var pow = Math.pow(1 + buydownM, term);
            return Math.ceil(amount * buydownM * pow / (pow - 1));
        }
    };

    // === 匯出介面 ===
    // Browser (window)
    if (typeof root !== 'undefined') {
        root.BSDCore = BSDCore;
    }
    // Node.js / CommonJS
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = BSDCore;
    }
    // AMD
    if (typeof define === 'function' && define.amd) {
        define(function() { return BSDCore; });
    }

})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
