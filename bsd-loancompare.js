/**
 * ============================================================
 *  BSD 專屬應用系統 (BSD Sales Kit) — 雙方案比較模組 v4.0
 *  Plan A (均攤) vs Plan B (尾款型) — Cash-Flow Analysis
 * ============================================================
 *  作者：今晚沒喝夠的小賈哥
 *  系統說明：此為業務單位自行獨立開發之應用系統，旨在最大化業務服務效能與實務應用分析能力。
 *
 *  ⚠️  本模組之 Engine 運算邏輯與 BSDCore v4.0 同源，
 *      且為了與原獨立版 index.html 一致：
 *      Engine / recompute / drawChart / renderSchedule
 *      / toggleSchedule / fmt / fmtPct 全部一字不差搬入。
 *      請勿修改任何運算公式。
 *
 *  載入方式（沿用主頁既有模式）：
 *    initAll() → loadSubModule('bsd-loancompare.js', initLoanCompare)
 *    渲染目標：#loancompare-mount-point
 *    切換入口：switchView('loancompare')
 * ============================================================
 */

(function() {
    'use strict';

    // ─────────────────────────────────────────────────────────
    //  核心運算 ─ Engine
    //  以下 Engine 物件來自獨立版 Loan Compare（index.html），
    //  與 BSDCore v4.0 邏輯同源；維持原文，禁止改動。
    // ─────────────────────────────────────────────────────────
    const Engine = {
        // 標準等額本息月付款（與 BSDCore.calcPayment 一致）
        calcEvenPayment(principal, annualRatePct, term) {
            const m = annualRatePct / 100 / 12;
            if (m === 0) return Math.ceil(principal / term);
            const pow = Math.pow(1 + m, term);
            return Math.ceil(principal * m * pow / (pow - 1));
        },

        // 尾款型月付款：解出 X 使 NPV = principal
        // 1~(term-1) 期月付 X；第 term 期付 balloon（純尾款）
        calcBalloonPayment(principal, annualRatePct, term, balloon) {
            const m = annualRatePct / 100 / 12;
            if (m === 0) return Math.ceil((principal - balloon) / (term - 1));
            const annuityFactor = (1 - Math.pow(1 + m, -(term - 1))) / m;
            const balloonPV = balloon / Math.pow(1 + m, term);
            return Math.ceil((principal - balloonPV) / annuityFactor);
        },

        // 攤還表（與 BSDCore.buildAmortSchedule 一致）
        buildSchedule(principal, flows, monthlyRate) {
            const schedule = [];
            let bal = principal;
            for (let i = 0; i < flows.length; i++) {
                const interest = bal * monthlyRate;
                const princPart = flows[i] - interest;
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
        },

        // 折現值（每萬元為單位 ─ 與 BSDCore.calculateActualS 同源邏輯）
        npvPerWan(principal, monthlyRate, flows) {
            let npv = 0;
            for (let i = 0; i < flows.length; i++) {
                npv += (flows[i] / principal * 10000) / Math.pow(1 + monthlyRate, i + 1);
            }
            return npv;
        },

        // 投資累積終值：1~(term-1) 期每月投入 d，月利率 rm，至 term 期末
        // FV = Σ_{t=1..term-1} d × (1 + rm)^(term - t)
        investFV(monthlyDiff, investRatePct, term) {
            const rm = investRatePct / 100 / 12;
            if (rm === 0) return monthlyDiff * (term - 1);
            // 封閉式：FV = d × (1+rm) × [(1+rm)^(term-1) - 1] / rm
            return monthlyDiff * (1 + rm) * (Math.pow(1 + rm, term - 1) - 1) / rm;
        },

        // 每期月底之「累積投資價值」（給圖表用）
        // 投入時點 t（1..term-1），到觀察時點 k（1..term）月底的累積
        cumulativeFVSeries(monthlyDiff, investRatePct, term) {
            const rm = investRatePct / 100 / 12;
            const series = []; // 長度 term，index 0 對應第 1 期
            for (let k = 1; k <= term; k++) {
                // 投入 t = 1..min(k, term-1)
                const maxT = Math.min(k, term - 1);
                let acc = 0;
                for (let t = 1; t <= maxT; t++) {
                    acc += monthlyDiff * Math.pow(1 + rm, k - t);
                }
                series.push(acc);
            }
            return series;
        },

        // 二分搜尋：求使淨終值為 0 之投資年化報酬率
        solveBreakEvenRate(diffMonthly, balDiff, term) {
            // 目標：FV(r) = balDiff
            // r 範圍：0% ~ 50%
            let lo = 0, hi = 50;
            for (let iter = 0; iter < 60; iter++) {
                const mid = (lo + hi) / 2;
                const fv = Engine.investFV(diffMonthly, mid, term);
                if (Math.abs(fv - balDiff) < 0.01) return mid;
                if (fv < balDiff) lo = mid;
                else hi = mid;
            }
            return (lo + hi) / 2;
        },

        // ── 以下三個方法支援階段式付款（可變月差額）──

        // 可變月差額的投資終值
        // diffs[t] = 第 t+1 期的月投入差額，t = 0..N-2（共 N-1 個，最末期尾款期不投入）
        // FV = Σ_{t=0..N-2} diffs[t] × (1 + r_m)^(N-1-t)
        investFVFromDiffs(diffs, investRatePct) {
            const rm = investRatePct / 100 / 12;
            if (rm === 0) return diffs.reduce((a, b) => a + b, 0);
            return diffs.reduce((fv, d, t) => fv + d * Math.pow(1 + rm, diffs.length - 1 - t), 0);
        },

        // 可變月差額的累積投資序列（給圖表用）
        // 回傳長度 N（= diffs.length + 1）的陣列，index k-1 對應第 k 期的累積投資價值
        cumulativeFVSeriesFromDiffs(diffs, investRatePct) {
            const rm = investRatePct / 100 / 12;
            const N = diffs.length + 1;
            const series = [];
            for (let k = 1; k <= N; k++) {
                let acc = 0;
                for (let t = 0; t < Math.min(k, diffs.length); t++) {
                    acc += diffs[t] * Math.pow(1 + rm, k - t - 1);
                }
                series.push(acc);
            }
            return series;
        },

        // 可變月差額的打平點（二分搜尋）
        solveBreakEvenFromDiffs(diffs, balDiff) {
            let lo = 0, hi = 50;
            for (let iter = 0; iter < 60; iter++) {
                const mid = (lo + hi) / 2;
                const fv = Engine.investFVFromDiffs(diffs, mid);
                if (Math.abs(fv - balDiff) < 0.01) return mid;
                if (fv < balDiff) lo = mid;
                else hi = mid;
            }
            return (lo + hi) / 2;
        }
    };

    // ─────────────────────────────────────────────────────────
    //  模組狀態
    // ─────────────────────────────────────────────────────────
    let _lcPhases = null; // 階段式資料（由精算核心 launchBalloonCompare 傳入）

    // ─────────────────────────────────────────────────────────
    //  UI 助手（原樣搬入）
    // ─────────────────────────────────────────────────────────
    const $ = id => document.getElementById(id);
    const fmt = n => {
        if (n === null || n === undefined || isNaN(n)) return '─';
        const sign = n < 0 ? '−' : '';
        return sign + '$ ' + Math.abs(Math.round(n)).toLocaleString('en-US');
    };
    const fmtPct = (n, d = 3) => {
        if (n === null || n === undefined || isNaN(n)) return '─';
        return n.toFixed(d) + ' %';
    };

    // ─────────────────────────────────────────────────────────
    //  主流程：recompute（原樣搬入）
    // ─────────────────────────────────────────────────────────
    function recompute() {
        // 讀取輸入
        const amountWan = parseFloat($('pAmount').value) || 0;
        const principal = amountWan * 10000;
        const annualRate = parseFloat($('pRate').value) || 0;
        const term = parseInt($('pTerm').value) || 60;
        const balloonWan = parseFloat($('pBalloon').value) || 0;
        const balloon = balloonWan * 10000;
        const investRate = parseFloat($('pInvest').value) || 0;

        $('pAmountHint').textContent = '= NT$ ' + principal.toLocaleString('en-US');
        $('pBalloonHint').textContent = '第 ' + term + ' 期一次清償 NT$ ' + balloon.toLocaleString('en-US');
        $('invRateEcho').textContent = investRate.toFixed(2) + ' %';

        // 基本檢查
        if (principal <= 0 || term < 2 || balloon < 0 || balloon >= principal) {
            $('aPmt').textContent = '參數異常';
            return;
        }

        const m = annualRate / 100 / 12;

        // ───── 方案 A：均攤 ─────
        const pmtA = Engine.calcEvenPayment(principal, annualRate, term);
        const totalA = pmtA * term;
        const interestA = totalA - principal;
        const flowsA = Array(term).fill(pmtA);
        const npvA = Engine.npvPerWan(principal, m, flowsA);

        $('aPmt').textContent = fmt(pmtA);
        $('aTotal').textContent = fmt(totalA);
        $('aInterest').textContent = fmt(interestA);
        $('aNPV').textContent = npvA.toFixed(2);

        // ───── 方案 B：標準模式 or 階段式（精算核心傳入）─────
        let flowsB, diffs;

        if (_lcPhases && _lcPhases.length >= 2) {
            // 階段式：展開各期實際付款流
            flowsB = [];
            _lcPhases.forEach(p => {
                for (let i = 0; i < p.months; i++) flowsB.push(p.payment);
            });
            // diffs[t]：第 t+1 期的月差額（均攤 - 方案B付款），最末期尾款期不計入投資
            diffs = flowsB.slice(0, -1).map(fb => pmtA - fb);
        } else {
            // 標準模式：由 Engine 推算尾款型月付款
            const pmtB = Engine.calcBalloonPayment(principal, annualRate, term, balloon);
            flowsB = Array(term - 1).fill(pmtB).concat([balloon]);
            diffs = null; // 後面使用常數差額版 Engine.investFV
        }

        const totalB = flowsB.reduce((a, b) => a + b, 0);
        const interestB = totalB - principal;
        const npvB = Engine.npvPerWan(principal, m, flowsB);

        // ── Plan B 顯示 ──
        const bPhaseInfo = $('bPhaseInfo');
        const bPmtLbl = $('bPmt-lbl');
        if (_lcPhases && _lcPhases.length >= 2) {
            const isMultiStage = _lcPhases.length > 2;
            $('bPmt').textContent = fmt(_lcPhases[0].payment);
            if (bPmtLbl) bPmtLbl.textContent = '第 1 段月付款';
            if (bPhaseInfo && isMultiStage) {
                let phaseHtml = '';
                _lcPhases.forEach((p, i) => {
                    if (i < _lcPhases.length - 1) {
                        phaseHtml += '第 ' + (i + 1) + ' 段 · ' + p.months + ' 期 · $' + p.payment.toLocaleString('en-US') + '<br>';
                    }
                });
                bPhaseInfo.innerHTML = '各段付款明細：<br>' + phaseHtml;
                bPhaseInfo.style.display = 'block';
            } else if (bPhaseInfo) {
                bPhaseInfo.style.display = 'none';
            }
        } else {
            $('bPmt').textContent = fmt(flowsB[0]);
            if (bPmtLbl) bPmtLbl.textContent = '1 ~ N-1 期月付款';
            if (bPhaseInfo) bPhaseInfo.style.display = 'none';
        }
        $('bBalloon').textContent = fmt(flowsB[flowsB.length - 1]);
        $('bTotal').textContent = fmt(totalB);
        $('bInterest').textContent = fmt(interestB);
        $('bNPV').textContent = npvB.toFixed(2);

        // 攤還表
        renderSchedule('aSched', Engine.buildSchedule(principal, flowsA, m), false);
        renderSchedule('bSched', Engine.buildSchedule(principal, flowsB, m), true);

        // ───── 投資對比 ─────
        let fv, diffMonthlyConst;
        if (diffs) {
            fv = Engine.investFVFromDiffs(diffs, investRate);
            diffMonthlyConst = null;
        } else {
            diffMonthlyConst = pmtA - flowsB[0];
            fv = Engine.investFV(diffMonthlyConst, investRate, term);
        }

        const balDiff = flowsB[flowsB.length - 1] - pmtA; // 最末期方案 B 多付
        const netVal = fv - balDiff;

        // ① 月差額顯示：多段時提示各段不同
        const isMultiStageDisplay = diffs && _lcPhases && _lcPhases.length > 2;
        $('diffMonthly').textContent = isMultiStageDisplay
            ? '各段差額不同'
            : '+' + fmt(diffMonthlyConst !== null ? diffMonthlyConst : (diffs ? diffs[0] : 0));
        $('fvInvest').textContent = '+' + fmt(fv);
        $('balDiff').textContent = '−' + fmt(balDiff);

        const netEl = $('netVal');
        netEl.textContent = (netVal >= 0 ? '+' : '−') + fmt(Math.abs(netVal));
        netEl.className = 'step-val ' + (netVal >= 0 ? 'pos' : 'neg');

        // 結論
        const verdictBox = $('verdictBox');
        const verdictText = $('verdictText');
        const verdictSub = $('verdictSub');
        if (netVal >= 0) {
            verdictBox.classList.remove('lose');
            verdictText.innerHTML = '在年化 ' + investRate.toFixed(2) + ' % 報酬下，<br>方案 B 較有優勢 <span class="num">+' + fmt(Math.abs(netVal)).replace('$ ', '$') + '</span>';
            verdictSub.textContent = '即使方案 B 多繳了 ' + fmt(interestB - interestA) + ' 的利息，月差額的投資複利已超出尾款的多繳成本。';
        } else {
            verdictBox.classList.add('lose');
            verdictText.innerHTML = '在年化 ' + investRate.toFixed(2) + ' % 報酬下，<br>方案 A 較有優勢 <span class="num">+' + fmt(Math.abs(netVal)).replace('$ ', '$') + '</span>';
            verdictSub.textContent = '投資複利的累積不足以彌補方案 B 額外的利息支出；如能取得更高報酬，結論可能反轉。';
        }

        // 打平點
        const breakEven = diffs
            ? Engine.solveBreakEvenFromDiffs(diffs, balDiff)
            : Engine.solveBreakEvenRate(diffMonthlyConst, balDiff, term);
        $('breakEvenRate').textContent = fmtPct(breakEven, 3);
        $('breakEvenHelper').textContent = '高於 ' + fmtPct(breakEven, 2) + '，方案 B 較划算；低於則方案 A 較划算。';

        // 圖表
        if (diffs) {
            drawChartFromDiffs(diffs, investRate, balDiff, principal);
        } else {
            drawChart(diffMonthlyConst, investRate, term, balDiff, principal);
        }
    }

    // ─────────────────────────────────────────────────────────
    //  攤還表渲染（原樣搬入）
    // ─────────────────────────────────────────────────────────
    function renderSchedule(elId, schedule, isBalloon) {
        const wrap = $(elId);
        let html = '<table class="schedule"><thead><tr>'
            + '<th>期</th><th>月付</th><th>利息</th><th>本金</th><th>餘額</th>'
            + '</tr></thead><tbody>';
        schedule.forEach((r, idx) => {
            const isLast = isBalloon && idx === schedule.length - 1;
            html += '<tr' + (isLast ? ' class="balloon-row"' : '') + '>'
                + '<td>' + r.period + (isLast ? ' ★' : '') + '</td>'
                + '<td>' + r.payment.toLocaleString() + '</td>'
                + '<td>' + r.interest.toLocaleString() + '</td>'
                + '<td>' + r.principal.toLocaleString() + '</td>'
                + '<td>' + r.balance.toLocaleString() + '</td>'
                + '</tr>';
        });
        html += '</tbody></table>';
        wrap.innerHTML = html;
    }

    function toggleSchedule(id, btn) {
        const el = $(id);
        el.classList.toggle('open');
        btn.textContent = el.classList.contains('open') ? '▴ 收合攤還表' : '▾ 展開攤還表';
    }

    // ─────────────────────────────────────────────────────────
    //  SVG 圖表（原樣搬入）
    // ─────────────────────────────────────────────────────────
    function drawChart(diffMonthly, investRate, term, balDiff, principal) {
        const svg = $('chart');
        const W = 800, H = 360;
        const padL = 60, padR = 30, padT = 20, padB = 40;
        const innerW = W - padL - padR;
        const innerH = H - padT - padB;

        // 計算數據
        const fvSeries = Engine.cumulativeFVSeries(diffMonthly, investRate, term);
        const principalSeries = []; // 無投資 ─ 純累積本金
        for (let k = 1; k <= term; k++) {
            const t = Math.min(k, term - 1);
            principalSeries.push(diffMonthly * t);
        }

        const maxY = Math.max(
            Math.max(...fvSeries),
            Math.max(...principalSeries),
            balDiff
        ) * 1.1;
        const minY = 0;

        const xOf = i => padL + (i / (term - 1)) * innerW;
        const yOf = v => padT + innerH - ((v - minY) / (maxY - minY)) * innerH;

        let html = '';

        // ── 背景網格 ──
        const ySteps = 5;
        for (let i = 0; i <= ySteps; i++) {
            const v = minY + (maxY - minY) * i / ySteps;
            const y = yOf(v);
            html += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--rule-soft)" stroke-width="0.5" stroke-dasharray="3,3" />`;
            html += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="10" fill="var(--ink-mute)">${Math.round(v).toLocaleString()}</text>`;
        }

        // ── X 軸刻度 ──
        const xTicks = Math.min(term, 6);
        for (let i = 0; i <= xTicks; i++) {
            const periodIdx = Math.round(i * (term - 1) / xTicks);
            const x = xOf(periodIdx);
            html += `<line x1="${x}" y1="${padT + innerH}" x2="${x}" y2="${padT + innerH + 4}" stroke="var(--ink-mute)" stroke-width="1" />`;
            html += `<text x="${x}" y="${padT + innerH + 18}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="10" fill="var(--ink-mute)">第 ${periodIdx + 1} 期</text>`;
        }

        // ── 軸線 ──
        html += `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + innerH}" stroke="var(--ink)" stroke-width="1.5" />`;
        html += `<line x1="${padL}" y1="${padT + innerH}" x2="${W - padR}" y2="${padT + innerH}" stroke="var(--ink)" stroke-width="1.5" />`;

        // ── 累積本金（無投資）面 ──
        let pathPrincipal = `M ${xOf(0)} ${yOf(0)} `;
        principalSeries.forEach((v, i) => { pathPrincipal += `L ${xOf(i)} ${yOf(v)} `; });
        pathPrincipal += `L ${xOf(term - 1)} ${yOf(0)} Z`;
        html += `<path d="${pathPrincipal}" fill="var(--gold)" opacity="0.18" />`;
        // 線
        let linePrincipal = '';
        principalSeries.forEach((v, i) => { linePrincipal += (i === 0 ? 'M' : 'L') + ` ${xOf(i)} ${yOf(v)} `; });
        html += `<path d="${linePrincipal}" fill="none" stroke="var(--gold)" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.7" />`;

        // ── 累積投資價值 線 ──
        let lineFV = '';
        fvSeries.forEach((v, i) => { lineFV += (i === 0 ? 'M' : 'L') + ` ${xOf(i)} ${yOf(v)} `; });
        html += `<path d="${lineFV}" fill="none" stroke="var(--accent)" stroke-width="2.5" />`;

        // 終值點
        const lastIdx = term - 1;
        const lastFV = fvSeries[lastIdx];
        html += `<circle cx="${xOf(lastIdx)}" cy="${yOf(lastFV)}" r="5" fill="var(--accent)" />`;
        html += `<text x="${xOf(lastIdx) - 8}" y="${yOf(lastFV) - 10}" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="11" font-weight="600" fill="var(--accent)">FV: $${Math.round(lastFV).toLocaleString()}</text>`;

        // ── 尾款差額水平基準線 ──
        const yBalDiff = yOf(balDiff);
        html += `<line x1="${padL}" y1="${yBalDiff}" x2="${W - padR}" y2="${yBalDiff}" stroke="var(--accent-2)" stroke-width="1.5" stroke-dasharray="6,4" />`;
        html += `<text x="${W - padR - 4}" y="${yBalDiff - 6}" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="11" font-weight="600" fill="var(--accent-2)">需補足 $${Math.round(balDiff).toLocaleString()}</text>`;

        // ── 淨損益區域標示 ──
        // 在最後一期，畫一條垂直註記，顯示淨損益
        const xLast = xOf(lastIdx);
        const yA = yOf(lastFV);
        const yB = yOf(balDiff);
        const isWin = lastFV >= balDiff;
        html += `<line x1="${xLast + 12}" y1="${Math.min(yA, yB)}" x2="${xLast + 12}" y2="${Math.max(yA, yB)}" stroke="${isWin ? 'var(--pos)' : 'var(--neg)'}" stroke-width="3" />`;
        html += `<line x1="${xLast + 8}" y1="${Math.min(yA, yB)}" x2="${xLast + 16}" y2="${Math.min(yA, yB)}" stroke="${isWin ? 'var(--pos)' : 'var(--neg)'}" stroke-width="2" />`;
        html += `<line x1="${xLast + 8}" y1="${Math.max(yA, yB)}" x2="${xLast + 16}" y2="${Math.max(yA, yB)}" stroke="${isWin ? 'var(--pos)' : 'var(--neg)'}" stroke-width="2" />`;

        svg.innerHTML = html;
    }

    // ─────────────────────────────────────────────────────────
    //  SVG 圖表（階段式可變差額版）
    // ─────────────────────────────────────────────────────────
    function drawChartFromDiffs(diffs, investRate, balDiff, principal) {
        const svg = $('chart');
        const W = 800, H = 360;
        const padL = 60, padR = 30, padT = 20, padB = 40;
        const innerW = W - padL - padR;
        const innerH = H - padT - padB;
        const term = diffs.length + 1; // 含最末尾款期

        const fvSeries = Engine.cumulativeFVSeriesFromDiffs(diffs, investRate);
        // 累積本金（無複利，純加總差額）
        const principalSeries = [];
        for (let k = 1; k <= term; k++) {
            let acc = 0;
            for (let t = 0; t < Math.min(k, diffs.length); t++) acc += diffs[t];
            principalSeries.push(acc);
        }

        const maxY = Math.max(Math.max(...fvSeries), Math.max(...principalSeries), balDiff) * 1.1;
        const minY = 0;
        const xOf = i => padL + (i / (term - 1)) * innerW;
        const yOf = v => padT + innerH - ((v - minY) / (maxY - minY)) * innerH;

        let html = '';

        // 背景網格
        const ySteps = 5;
        for (let i = 0; i <= ySteps; i++) {
            const v = minY + (maxY - minY) * i / ySteps;
            const y = yOf(v);
            html += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--rule-soft)" stroke-width="0.5" stroke-dasharray="3,3" />`;
            html += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="10" fill="var(--ink-mute)">${Math.round(v).toLocaleString()}</text>`;
        }
        // X 軸刻度
        const xTicks = Math.min(term, 6);
        for (let i = 0; i <= xTicks; i++) {
            const periodIdx = Math.round(i * (term - 1) / xTicks);
            const x = xOf(periodIdx);
            html += `<line x1="${x}" y1="${padT + innerH}" x2="${x}" y2="${padT + innerH + 4}" stroke="var(--ink-mute)" stroke-width="1" />`;
            html += `<text x="${x}" y="${padT + innerH + 18}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="10" fill="var(--ink-mute)">第 ${periodIdx + 1} 期</text>`;
        }
        // 軸線
        html += `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + innerH}" stroke="var(--ink)" stroke-width="1.5" />`;
        html += `<line x1="${padL}" y1="${padT + innerH}" x2="${W - padR}" y2="${padT + innerH}" stroke="var(--ink)" stroke-width="1.5" />`;
        // 累積本金（無複利）面 + 線
        let pathP = `M ${xOf(0)} ${yOf(0)} `;
        principalSeries.forEach((v, i) => { pathP += `L ${xOf(i)} ${yOf(v)} `; });
        pathP += `L ${xOf(term - 1)} ${yOf(0)} Z`;
        html += `<path d="${pathP}" fill="var(--gold)" opacity="0.18" />`;
        let lineP = '';
        principalSeries.forEach((v, i) => { lineP += (i === 0 ? 'M' : 'L') + ` ${xOf(i)} ${yOf(v)} `; });
        html += `<path d="${lineP}" fill="none" stroke="var(--gold)" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.7" />`;
        // FV 曲線
        let lineFV = '';
        fvSeries.forEach((v, i) => { lineFV += (i === 0 ? 'M' : 'L') + ` ${xOf(i)} ${yOf(v)} `; });
        html += `<path d="${lineFV}" fill="none" stroke="var(--accent)" stroke-width="2.5" />`;
        // 終值點
        const lastIdx = term - 1;
        const lastFV = fvSeries[lastIdx];
        html += `<circle cx="${xOf(lastIdx)}" cy="${yOf(lastFV)}" r="5" fill="var(--accent)" />`;
        html += `<text x="${xOf(lastIdx) - 8}" y="${yOf(lastFV) - 10}" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="11" font-weight="600" fill="var(--accent)">FV: $${Math.round(lastFV).toLocaleString()}</text>`;
        // 尾款差額水平線
        const yBD = yOf(balDiff);
        html += `<line x1="${padL}" y1="${yBD}" x2="${W - padR}" y2="${yBD}" stroke="var(--accent-2)" stroke-width="1.5" stroke-dasharray="6,4" />`;
        html += `<text x="${W - padR - 4}" y="${yBD - 6}" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="11" font-weight="600" fill="var(--accent-2)">需補足 $${Math.round(balDiff).toLocaleString()}</text>`;
        // 淨損益標示
        const xLast = xOf(lastIdx);
        const yA = yOf(lastFV), yB = yOf(balDiff);
        const isWin = lastFV >= balDiff;
        html += `<line x1="${xLast + 12}" y1="${Math.min(yA, yB)}" x2="${xLast + 12}" y2="${Math.max(yA, yB)}" stroke="${isWin ? 'var(--pos)' : 'var(--neg)'}" stroke-width="3" />`;
        html += `<line x1="${xLast + 8}" y1="${Math.min(yA, yB)}" x2="${xLast + 16}" y2="${Math.min(yA, yB)}" stroke="${isWin ? 'var(--pos)' : 'var(--neg)'}" stroke-width="2" />`;
        html += `<line x1="${xLast + 8}" y1="${Math.max(yA, yB)}" x2="${xLast + 16}" y2="${Math.max(yA, yB)}" stroke="${isWin ? 'var(--pos)' : 'var(--neg)'}" stroke-width="2" />`;
        svg.innerHTML = html;
    }

    // ─────────────────────────────────────────────────────────
    //  注入專屬樣式（Glass Frost 風格，與主頁一致）
    //  將原 Editorial Finance CSS 變數映射到主頁 palette
    // ─────────────────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('bsd-loancompare-styles')) return;
        const style = document.createElement('style');
        style.id = 'bsd-loancompare-styles';
        style.textContent = `
            /* === 命名空間：CSS 變數映射 ─ 讓 drawChart() 的 var(--xxx) 直接吃主頁色 === */
            .loancompare-scope {
                --ink: #1a202c;
                --ink-soft: #5a6577;
                --ink-mute: #9ca8b9;
                --rule: rgba(0,0,0,0.08);
                --rule-soft: rgba(0,0,0,0.04);
                --accent: #4f7df3;
                --accent-2: #06b6a0;
                --gold: #e8a117;
                --pos: #10b981;
                --neg: #ef4444;
                --highlight: rgba(79,125,243,0.08);
                color: var(--ink);
            }

            /* === 頁首 === */
            .loancompare-scope .lc-head {
                display: flex; justify-content: space-between; align-items: flex-end;
                gap: 24px; flex-wrap: wrap; padding-bottom: 18px; margin-bottom: 22px;
                border-bottom: 1px solid var(--rule);
            }
            .loancompare-scope .lc-head-title {
                font-size: 1.5rem; font-weight: 800; letter-spacing: -0.02em;
                color: var(--ink); line-height: 1.15;
            }
            .loancompare-scope .lc-head-sub {
                font-size: 12px; color: var(--ink-mute); margin-top: 4px;
                font-family: var(--mono); letter-spacing: 0.02em;
            }
            .loancompare-scope .lc-head-meta {
                text-align: right; font-size: 10px; color: var(--ink-mute);
                font-family: var(--mono); letter-spacing: 0.05em; line-height: 1.8;
                text-transform: uppercase;
            }
            .loancompare-scope .lc-head-badge {
                display: inline-block; border: 1px solid var(--accent);
                color: var(--accent); padding: 3px 10px; border-radius: 50px;
                background: var(--accent-light); margin-bottom: 4px;
                font-weight: 600;
            }

            /* === 區段標題 § I / § II 等 === */
            .loancompare-scope .lc-section-title {
                font-size: 1.05rem; font-weight: 800; color: var(--ink);
                margin: 28px 0 16px; display: flex; align-items: baseline;
                gap: 12px; letter-spacing: -0.01em;
            }
            .loancompare-scope .lc-section-title:first-of-type { margin-top: 0; }
            .loancompare-scope .lc-section-title .num {
                font-family: var(--mono); font-size: 11px; font-weight: 700;
                color: var(--accent-2); letter-spacing: 0.1em;
                background: var(--accent2-light); padding: 3px 9px; border-radius: 50px;
            }
            .loancompare-scope .lc-section-title .rule {
                flex: 1; height: 1px; background: var(--rule);
            }

            /* === 共用參數面板 === */
            .loancompare-scope .params-panel {
                background: var(--bg-white); border: 1px solid var(--rule);
                border-radius: 14px; padding: 22px 26px; box-shadow: var(--shadow-sm);
            }
            .loancompare-scope .params-grid {
                display: grid; gap: 18px 26px;
                grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
            }
            .loancompare-scope .param { display: flex; flex-direction: column; gap: 5px; }
            .loancompare-scope .param label {
                font-size: 12px; color: var(--ink-soft); font-weight: 600;
                letter-spacing: 0.01em;
            }
            .loancompare-scope .param label .unit {
                color: var(--ink-mute); font-weight: 400; margin-left: 4px;
            }
            .loancompare-scope .input-wrap {
                border-bottom: 2px solid var(--ink); padding-bottom: 3px;
                transition: border-color 0.2s;
            }
            .loancompare-scope .input-wrap:focus-within { border-bottom-color: var(--accent); }
            .loancompare-scope .param input {
                width: 100%; border: none; background: transparent;
                font-family: var(--mono); font-size: 1.4rem; font-weight: 700;
                color: var(--ink); outline: none; padding: 2px 0;
            }
            .loancompare-scope .param input:focus { color: var(--accent); }
            .loancompare-scope .param .note {
                font-size: 10px; color: var(--ink-mute); font-family: var(--mono);
                letter-spacing: 0.02em;
            }

            /* === 方案卡片 === */
            .loancompare-scope .plans-row {
                display: grid; grid-template-columns: 1fr 1fr; gap: 18px;
            }
            @media (max-width: 860px) {
                .loancompare-scope .plans-row { grid-template-columns: 1fr; }
            }
            .loancompare-scope .plan-card {
                background: var(--bg-white); border: 1px solid var(--rule);
                border-top: 3px solid var(--accent); border-radius: 14px;
                padding: 22px 24px; box-shadow: var(--shadow-sm);
                transition: box-shadow 0.3s, border-color 0.3s;
            }
            .loancompare-scope .plan-card:hover {
                box-shadow: var(--shadow); border-color: rgba(79,125,243,0.18);
            }
            .loancompare-scope .plan-card.balloon { border-top-color: var(--accent-2); }
            .loancompare-scope .plan-card.balloon:hover { border-color: rgba(6,182,160,0.18); }
            .loancompare-scope .plan-tag {
                font-family: var(--mono); font-size: 10px;
                color: var(--accent); letter-spacing: 0.2em;
                text-transform: uppercase; font-weight: 700; margin-bottom: 6px;
            }
            .loancompare-scope .plan-card.balloon .plan-tag { color: var(--accent-2); }
            .loancompare-scope .plan-name {
                font-size: 1.2rem; font-weight: 800; color: var(--ink);
                letter-spacing: -0.02em;
            }
            .loancompare-scope .plan-name .ja {
                font-style: italic; font-weight: 400; font-size: 14px;
                color: var(--ink-mute); margin-left: 8px;
            }
            .loancompare-scope .plan-desc {
                font-size: 13px; color: var(--ink-soft); margin: 6px 0 18px;
                line-height: 1.55;
            }
            .loancompare-scope .figures { display: grid; gap: 12px; margin-bottom: 16px; }
            .loancompare-scope .figure-row {
                display: flex; justify-content: space-between; align-items: baseline;
                padding-bottom: 10px; border-bottom: 1px dashed var(--rule);
            }
            .loancompare-scope .figure-row:last-child {
                border-bottom: none; padding-bottom: 0;
            }
            .loancompare-scope .figure-row .lbl { font-size: 13px; color: var(--ink-soft); }
            .loancompare-scope .figure-row .val {
                font-family: var(--mono); font-size: 15px; font-weight: 600;
                color: var(--ink);
            }
            .loancompare-scope .figure-row.primary .lbl { font-weight: 600; color: var(--ink); }
            .loancompare-scope .figure-row.primary .val {
                font-size: 1.6rem; font-weight: 800; color: var(--accent);
            }
            .loancompare-scope .plan-card.balloon .figure-row.primary .val {
                color: var(--accent-2);
            }

            /* === 攤還表（摺疊）=== */
            .loancompare-scope .toggle-btn {
                width: 100%; background: transparent; border: 1px solid var(--rule);
                color: var(--ink-soft); padding: 9px; font-family: var(--mono);
                font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;
                cursor: pointer; transition: all 0.2s; margin-top: 14px;
                border-radius: 8px; font-weight: 600;
            }
            .loancompare-scope .toggle-btn:hover {
                background: var(--ink); color: white; border-color: var(--ink);
            }
            .loancompare-scope .schedule-wrap {
                max-height: 0; overflow: hidden; transition: max-height 0.4s ease;
            }
            .loancompare-scope .schedule-wrap.open {
                max-height: 600px; overflow-y: auto; margin-top: 12px;
            }
            .loancompare-scope table.schedule {
                width: 100%; border-collapse: collapse;
                font-family: var(--mono); font-size: 12px;
            }
            .loancompare-scope table.schedule th,
            .loancompare-scope table.schedule td {
                padding: 5px 8px; text-align: right;
                border-bottom: 1px dotted var(--rule);
            }
            .loancompare-scope table.schedule th {
                font-weight: 700; color: var(--ink-soft);
                text-transform: uppercase; letter-spacing: 0.06em; font-size: 10px;
                position: sticky; top: 0; background: var(--bg-white);
            }
            .loancompare-scope table.schedule th:first-child,
            .loancompare-scope table.schedule td:first-child { text-align: left; }
            .loancompare-scope table.schedule tr.balloon-row {
                background: rgba(6,182,160,0.08); font-weight: 700;
                color: var(--accent-2);
            }

            /* === 投資比較區 === */
            .loancompare-scope .investment-section {
                background: var(--bg-white); border: 1px solid var(--rule);
                border-radius: 14px; padding: 26px 30px; box-shadow: var(--shadow-sm);
            }
            .loancompare-scope .invest-headline {
                font-size: 16px; font-weight: 500; color: var(--ink);
                margin-bottom: 22px; line-height: 1.55; max-width: 800px;
                padding: 14px 18px; background: linear-gradient(135deg, var(--accent-light), var(--accent2-light));
                border-left: 3px solid var(--accent); border-radius: 10px;
            }
            .loancompare-scope .invest-headline em {
                font-style: normal; color: var(--accent); font-weight: 800;
            }
            .loancompare-scope .invest-grid {
                display: grid; grid-template-columns: 1fr 1fr; gap: 32px;
                margin-bottom: 26px;
            }
            @media (max-width: 860px) {
                .loancompare-scope .invest-grid {
                    grid-template-columns: 1fr; gap: 24px;
                }
            }
            .loancompare-scope .invest-flow {
                display: flex; flex-direction: column; gap: 8px;
            }
            .loancompare-scope .flow-step {
                display: grid; grid-template-columns: 28px 1fr auto; gap: 14px;
                align-items: baseline; padding: 12px 0;
                border-bottom: 1px dashed var(--rule);
            }
            .loancompare-scope .flow-step:last-child {
                border-bottom: 2px solid var(--ink); padding-bottom: 14px;
            }
            .loancompare-scope .flow-step .step-num {
                font-family: var(--mono); font-size: 13px;
                color: var(--accent-2); font-weight: 700;
            }
            .loancompare-scope .flow-step .step-text {
                font-size: 13px; color: var(--ink-soft); line-height: 1.5;
            }
            .loancompare-scope .flow-step .step-val {
                font-family: var(--mono); font-size: 15px; font-weight: 700;
                color: var(--ink); white-space: nowrap;
            }
            .loancompare-scope .flow-step .step-val.pos { color: var(--pos); }
            .loancompare-scope .flow-step .step-val.neg { color: var(--neg); }

            /* === Verdict 結論卡 === */
            .loancompare-scope .verdict {
                padding: 18px 22px;
                background: linear-gradient(135deg, var(--accent-light), #f5f3ff);
                border-left: 4px solid var(--accent);
                border-radius: 12px; margin-bottom: 14px;
            }
            .loancompare-scope .verdict.lose {
                background: linear-gradient(135deg, #fef2f2, #fff7ed);
                border-left-color: var(--neg);
            }
            .loancompare-scope .verdict .label {
                font-family: var(--mono); font-size: 10px;
                color: var(--ink-mute); letter-spacing: 0.15em;
                text-transform: uppercase; margin-bottom: 8px; font-weight: 700;
            }
            .loancompare-scope .verdict .v {
                font-size: 1.1rem; font-weight: 700; color: var(--ink);
                line-height: 1.4;
            }
            .loancompare-scope .verdict .v .num {
                font-family: var(--mono); color: var(--pos); font-weight: 800;
            }
            .loancompare-scope .verdict.lose .v .num { color: var(--neg); }
            .loancompare-scope .verdict .sub {
                font-size: 13px; color: var(--ink-soft); margin-top: 8px;
                font-style: italic;
            }

            /* === 打平點 box === */
            .loancompare-scope .threshold-box {
                padding: 14px 18px; background: var(--bg);
                border: 1px solid var(--rule); border-radius: 10px;
                display: flex; justify-content: space-between; align-items: center;
                flex-wrap: wrap; gap: 12px;
            }
            .loancompare-scope .threshold-box .lbl {
                font-size: 13px; color: var(--ink-soft);
            }
            .loancompare-scope .threshold-box .v {
                font-family: var(--mono); font-size: 1.5rem; font-weight: 800;
                color: var(--gold);
            }
            .loancompare-scope .threshold-box .helper {
                font-size: 11px; color: var(--ink-mute); font-style: italic;
                flex-basis: 100%; margin-top: 4px;
            }

            /* === 直覺說明 === */
            .loancompare-scope .intuition-box {
                margin-top: 14px; padding: 14px 18px;
                background: rgba(232, 161, 23, 0.08);
                border-left: 3px solid var(--gold);
                font-size: 13px; color: var(--ink-soft);
                line-height: 1.6; border-radius: 0 8px 8px 0;
            }
            .loancompare-scope .intuition-box strong {
                color: var(--ink); font-weight: 800; display: inline-block;
                margin-bottom: 2px;
            }
            .loancompare-scope .intuition-box .arrow {
                color: var(--ink-mute); font-style: italic; font-size: 12px;
                display: block; margin-top: 4px;
            }

            /* === 圖表 === */
            .loancompare-scope .chart-box {
                margin-top: 24px; padding-top: 22px;
                border-top: 1px solid var(--rule);
            }
            .loancompare-scope .chart-title {
                font-size: 14px; font-weight: 700; color: var(--ink);
                margin-bottom: 12px;
            }
            .loancompare-scope .chart-legend {
                display: flex; gap: 18px; flex-wrap: wrap;
                margin-bottom: 14px; font-size: 12px; color: var(--ink-soft);
                font-family: var(--mono);
            }
            .loancompare-scope .legend-item {
                display: flex; align-items: center; gap: 6px;
            }
            .loancompare-scope .legend-swatch {
                width: 14px; height: 14px; border-radius: 3px;
            }
            .loancompare-scope svg.chart {
                width: 100%; height: auto; display: block;
                background: var(--bg); border: 1px solid var(--rule);
                border-radius: 10px;
            }

            /* === 公式區（收合）=== */
            .loancompare-scope .formulas-details {
                background: var(--bg-white); border: 1px solid var(--rule);
                border-radius: 14px; padding: 18px 26px; box-shadow: var(--shadow-sm);
            }
            .loancompare-scope .formulas-details summary {
                cursor: pointer; font-size: 14px; font-weight: 800;
                color: var(--ink); padding: 4px 0; user-select: none;
                list-style: none; display: flex; align-items: center; gap: 8px;
            }
            .loancompare-scope .formulas-details summary::-webkit-details-marker { display: none; }
            .loancompare-scope .formulas-details summary::before {
                content: '▸'; color: var(--accent); font-size: 14px;
                transition: transform 0.2s;
            }
            .loancompare-scope .formulas-details[open] summary::before {
                transform: rotate(90deg);
            }
            .loancompare-scope .formula-block { margin-top: 18px; }
            .loancompare-scope .formula-block .h {
                font-size: 13px; font-weight: 700; color: var(--ink);
                margin-bottom: 6px;
            }
            .loancompare-scope .formula-block .h .step {
                font-family: var(--mono); font-size: 9px; color: var(--accent-2);
                margin-right: 8px; letter-spacing: 0.1em;
                background: var(--accent2-light); padding: 2px 7px; border-radius: 4px;
                font-weight: 700;
            }
            .loancompare-scope .formula-block .desc {
                font-size: 12px; color: var(--ink-soft); margin-bottom: 8px;
                line-height: 1.5;
            }
            .loancompare-scope .formula-box {
                background: var(--bg); border-left: 3px solid var(--gold);
                padding: 12px 16px; font-family: var(--mono); font-size: 13px;
                color: var(--ink); line-height: 1.8; border-radius: 0 8px 8px 0;
                overflow-x: auto;
            }
            .loancompare-scope .formula-box .var {
                color: var(--accent-2); font-style: normal; font-weight: 700;
            }
            .loancompare-scope .formula-box .note {
                color: var(--ink-mute); font-size: 11px; margin-top: 6px;
                display: block; font-family: var(--font);
            }

            /* === 響應式微調 === */
            @media (max-width: 640px) {
                .loancompare-scope .params-panel,
                .loancompare-scope .investment-section,
                .loancompare-scope .formulas-details { padding: 18px 18px; }
                .loancompare-scope .plan-card { padding: 18px 18px; }
                .loancompare-scope .figure-row.primary .val { font-size: 1.3rem; }
                .loancompare-scope .invest-headline { font-size: 14px; }
                .loancompare-scope .verdict .v { font-size: 1rem; }
            }
        `;
        document.head.appendChild(style);
    }

    // ─────────────────────────────────────────────────────────
    //  渲染 HTML 結構
    // ─────────────────────────────────────────────────────────
    function buildHTML() {
        return `
        <div class="loancompare-scope">

            <!-- 頁首 + 返回按鈕 -->
            <div class="lc-head">
                <div>
                    <div class="lc-head-title">雙方案精算比較器</div>
                    <div class="lc-head-sub">Even Amortisation &nbsp;<em>vs.</em>&nbsp; Balloon Payment ─ A Cash-Flow Analysis</div>
                </div>
                <div class="lc-head-meta">
                    <div class="lc-head-badge">BSDCore-Compatible</div>
                    <div>v1.0 · Loan Compare</div>
                    <div id="meta-date"></div>
                </div>
            </div>

            <!-- 工具列：返回主介面 -->
            <div style="display:flex;justify-content:flex-end;margin-bottom:18px;">
                <button class="btn btn-back" onclick="switchView('single')">← 返回精算核心</button>
            </div>

            <!-- 自動載入提示（由 launchBalloonCompare 觸發時顯示） -->
            <div id="lc-prefill-banner" style="display:none;margin-bottom:18px;padding:10px 16px;background:#f0fdf9;border-left:3px solid #06b6a0;border-radius:0 8px 8px 0;font-size:13px;color:#0f766e;line-height:1.5;"></div>

            <!-- ════════════ § I 共用參數 ════════════ -->
            <div class="lc-section-title">
                <span class="num">§ I</span>
                <span>共用參數</span>
                <span class="rule"></span>
            </div>
            <div class="params-panel" style="margin-bottom:24px;">
                <div class="params-grid">
                    <div class="param">
                        <label>分期金額<span class="unit">/ 萬元</span></label>
                        <div class="input-wrap"><input type="number" id="pAmount" value="100" step="1" min="1"></div>
                        <span class="note" id="pAmountHint">= NT$ 1,000,000</span>
                    </div>
                    <div class="param">
                        <label>年利率<span class="unit">/ %</span></label>
                        <div class="input-wrap"><input type="number" id="pRate" value="4.49" step="0.01" min="0"></div>
                        <span class="note">月利率 m = r / 12</span>
                    </div>
                    <div class="param">
                        <label>期數<span class="unit">/ 月</span></label>
                        <div class="input-wrap"><input type="number" id="pTerm" value="60" step="1" min="2"></div>
                        <span class="note">通常 12 / 24 / 36 / 48 / 60 / 72 / 84</span>
                    </div>
                    <div class="param">
                        <label>尾款金額<span class="unit">/ 萬元</span></label>
                        <div class="input-wrap"><input type="number" id="pBalloon" value="50" step="1" min="0"></div>
                        <span class="note" id="pBalloonHint">第 N 期一次清償</span>
                    </div>
                    <div class="param">
                        <label>投資年化報酬<span class="unit">/ %</span></label>
                        <div class="input-wrap"><input type="number" id="pInvest" value="4.00" step="0.01" min="0"></div>
                        <span class="note">月差額再投資假設</span>
                    </div>
                </div>
            </div>

            <!-- ════════════ § II 方案速覽 ════════════ -->
            <div class="lc-section-title">
                <span class="num">§ II</span>
                <span>方案速覽</span>
                <span class="rule"></span>
            </div>
            <div class="plans-row" style="margin-bottom:24px;">

                <!-- 方案 A -->
                <div class="plan-card">
                    <div class="plan-tag">PLAN · A</div>
                    <div class="plan-name">均攤方案<span class="ja">Even Amortisation</span></div>
                    <div class="plan-desc">每期固定本息攤還，期末本金歸零，最常見也最單純。</div>
                    <div class="figures">
                        <div class="figure-row primary">
                            <span class="lbl">每月月付款</span>
                            <span class="val" id="aPmt">─</span>
                        </div>
                        <div class="figure-row">
                            <span class="lbl">總付款金額</span>
                            <span class="val" id="aTotal">─</span>
                        </div>
                        <div class="figure-row">
                            <span class="lbl">總利息支出</span>
                            <span class="val" id="aInterest">─</span>
                        </div>
                        <div class="figure-row">
                            <span class="lbl">折現驗算 <span style="color:var(--ink-mute);font-size:11px">(每萬元 NPV)</span></span>
                            <span class="val" id="aNPV">─</span>
                        </div>
                    </div>
                    <button class="toggle-btn" onclick="toggleSchedule('aSched', this)">▾ 展開攤還表</button>
                    <div class="schedule-wrap" id="aSched"></div>
                </div>

                <!-- 方案 B -->
                <div class="plan-card balloon">
                    <div class="plan-tag">PLAN · B</div>
                    <div class="plan-name">尾款型方案<span class="ja">Balloon Payment</span></div>
                    <div class="plan-desc">前 N-1 期繳低額月付，最終一期清償尾款，期間現金流壓力較小。</div>
                    <div class="figures">
                        <div class="figure-row primary">
                            <span class="lbl" id="bPmt-lbl">1 ~ N-1 期月付款</span>
                            <span class="val" id="bPmt">─</span>
                        </div>
                        <div id="bPhaseInfo" style="display:none;margin:4px 0 8px;background:#f0fdf9;border-left:2px solid #06b6a0;padding:6px 12px;border-radius:0 6px 6px 0;font-family:var(--mono);font-size:11.5px;line-height:1.9;color:#5a6577"></div>
                        <div class="figure-row">
                            <span class="lbl">最末期尾款</span>
                            <span class="val" id="bBalloon">─</span>
                        </div>
                        <div class="figure-row">
                            <span class="lbl">總付款金額</span>
                            <span class="val" id="bTotal">─</span>
                        </div>
                        <div class="figure-row">
                            <span class="lbl">總利息支出</span>
                            <span class="val" id="bInterest">─</span>
                        </div>
                        <div class="figure-row">
                            <span class="lbl">折現驗算 <span style="color:var(--ink-mute);font-size:11px">(每萬元 NPV)</span></span>
                            <span class="val" id="bNPV">─</span>
                        </div>
                    </div>
                    <button class="toggle-btn" onclick="toggleSchedule('bSched', this)">▾ 展開攤還表</button>
                    <div class="schedule-wrap" id="bSched"></div>
                </div>

            </div>

            <!-- ════════════ § III 投資損益對比 ════════════ -->
            <div class="lc-section-title">
                <span class="num">§ III</span>
                <span>投資損益對比</span>
                <span class="rule"></span>
            </div>
            <div class="investment-section" style="margin-bottom:24px;">

                <div class="invest-headline">
                    若將方案 B 每月「省下」的差額 <em>定期定額</em> 投入年化報酬率為 <em id="invRateEcho">─%</em> 的理財商品，到最末期能否補足尾款的差額？
                </div>

                <div class="invest-grid">

                    <!-- 左：推導流程 -->
                    <div class="invest-flow">
                        <div class="flow-step">
                            <span class="step-num">①</span>
                            <span class="step-text">方案 B 每月（1 ~ N-1 期）較方案 A 少繳<br><span style="color:var(--ink-mute);font-size:12px">= PMT<sub>A</sub> − PMT<sub>B</sub></span></span>
                            <span class="step-val pos" id="diffMonthly">─</span>
                        </div>
                        <div class="flow-step">
                            <span class="step-num">②</span>
                            <span class="step-text">每月差額複利投資至最末期<br><span style="color:var(--ink-mute);font-size:12px">d × Σ (1 + r<sub>m</sub>)<sup>N − t</sup>, t = 1..N−1</span></span>
                            <span class="step-val pos" id="fvInvest">─</span>
                        </div>
                        <div class="flow-step">
                            <span class="step-num">③</span>
                            <span class="step-text">最末期方案 B 多付的尾款差額<br><span style="color:var(--ink-mute);font-size:12px">= 尾款 − PMT<sub>A</sub></span></span>
                            <span class="step-val neg" id="balDiff">─</span>
                        </div>
                        <div class="flow-step">
                            <span class="step-num">④</span>
                            <span class="step-text">淨終值 = ② − ③<br><span style="color:var(--ink-mute);font-size:12px">方案 B 相對方案 A 的損益</span></span>
                            <span class="step-val" id="netVal">─</span>
                        </div>
                    </div>

                    <!-- 右：結論卡 -->
                    <div>
                        <div class="verdict" id="verdictBox">
                            <div class="label">結論</div>
                            <div class="v" id="verdictText">計算中…</div>
                            <div class="sub" id="verdictSub"></div>
                        </div>

                        <div class="threshold-box">
                            <span class="lbl">打平之投資年化報酬<br><span style="color:var(--ink-mute);font-size:11px">net = 0 之 r 解</span></span>
                            <span class="v" id="breakEvenRate">─</span>
                            <span class="helper" id="breakEvenHelper">高於此報酬率，方案 B 較划算；低於則方案 A 較划算。</span>
                        </div>

                        <div class="intuition-box">
                            <strong>📐 金融直覺</strong><br>
                            打平點通常會非常接近分期利率本身，這不是巧合 ─ 尾款型本質是把<strong style="margin:0;display:inline;">部分本金延後以分期利率累息</strong>，當投資報酬恰好等於分期利率時，資金時間價值兩相抵消。
                            <span class="arrow">→ 簡化決策法則：投資能穩定贏過分期利率 ⇒ 選尾款型；否則均攤更穩。</span>
                        </div>
                    </div>
                </div>

                <!-- 視覺化：每月累積投資 vs 尾款差額 -->
                <div class="chart-box">
                    <div class="chart-title">每月累積投資價值之時間軸</div>
                    <div class="chart-legend">
                        <span class="legend-item"><span class="legend-swatch" style="background:#4f7df3"></span>方案 B 累積投資價值</span>
                        <span class="legend-item"><span class="legend-swatch" style="background:#06b6a0"></span>第 N 期尾款差額（需補足）</span>
                        <span class="legend-item"><span class="legend-swatch" style="background:#e8a117;opacity:0.4"></span>累積本金（無投資報酬）</span>
                    </div>
                    <svg class="chart" id="chart" viewBox="0 0 800 360" preserveAspectRatio="none"></svg>
                </div>

            </div>

            <!-- ════════════ § IV 公式與算法透明化（可收合）════════════ -->
            <div class="lc-section-title">
                <span class="num">§ IV</span>
                <span>公式與算法透明化</span>
                <span class="rule"></span>
            </div>
            <details class="formulas-details">
                <summary>展開查看 5 條核心公式（與 BSDCore 同源邏輯）</summary>

                <div class="formula-block">
                    <div class="h"><span class="step">FORMULA 1</span>等額本息月付款（方案 A）</div>
                    <div class="desc">標準金融年金公式：給定本金、月利率與期數，解出每期固定還款額。</div>
                    <div class="formula-box">
                        PMT<sub>A</sub> = <span class="var">P</span> × <span class="var">m</span> × (1 + <span class="var">m</span>)<sup><span class="var">N</span></sup> / [(1 + <span class="var">m</span>)<sup><span class="var">N</span></sup> − 1]
                        <span class="note">P = 本金；m = 年利率 / 12；N = 期數。實作採 Math.ceil 進位以對齊金融機構處理慣例。</span>
                    </div>
                </div>

                <div class="formula-block">
                    <div class="h"><span class="step">FORMULA 2</span>尾款型月付款（方案 B）</div>
                    <div class="desc">前 N−1 期均攤、第 N 期為尾款 BAL，使現值折回正好等於本金。</div>
                    <div class="formula-box">
                        <span class="var">P</span> = PMT<sub>B</sub> × Σ<sub>t=1..N−1</sub> (1 + <span class="var">m</span>)<sup>−t</sup> + <span class="var">BAL</span> × (1 + <span class="var">m</span>)<sup>−<span class="var">N</span></sup>
                        <br>
                        ∴ PMT<sub>B</sub> = [<span class="var">P</span> − <span class="var">BAL</span> × (1 + <span class="var">m</span>)<sup>−<span class="var">N</span></sup>] ÷ Σ<sub>t=1..N−1</sub> (1 + <span class="var">m</span>)<sup>−t</sup>
                        <span class="note">尾款 BAL 並非「再向客戶多收的錢」，而是把本金延後到最末期清償的部分；最末期不再付月付，僅付 BAL。</span>
                    </div>
                </div>

                <div class="formula-block">
                    <div class="h"><span class="step">FORMULA 3</span>折現驗算 ─ 每萬元為單位</div>
                    <div class="desc">與 BSDCore 一致的折現邏輯：將每期現金流折算到「每萬元本金」尺度後再加總，可消除浮點誤差並貼近金融機構實務。</div>
                    <div class="formula-box">
                        NPV<sub>per 10K</sub> = Σ<sub>t=1..N</sub> (CF<sub>t</sub> / <span class="var">P</span> × 10000) ÷ (1 + <span class="var">m</span>)<sup>t</sup>
                        <span class="note">理論上應 ≈ 10,000；任何顯著偏離即代表月付款或尾款金額不一致於原始利率假設。</span>
                    </div>
                </div>

                <div class="formula-block">
                    <div class="h"><span class="step">FORMULA 4</span>定期定額複利累積（投資視角）</div>
                    <div class="desc">每月底投入差額，按月複利成長，至最末期月底結算。月利率採 r / 12（與分期同一基準，方便比較）。</div>
                    <div class="formula-box">
                        FV = Σ<sub>t=1..N−1</sub> d × (1 + <span class="var">r<sub>m</sub></span>)<sup>N − t</sup>
                        &nbsp;=&nbsp; d × (1 + <span class="var">r<sub>m</sub></span>) × [(1 + <span class="var">r<sub>m</sub></span>)<sup>N − 1</sup> − 1] / <span class="var">r<sub>m</sub></span>
                        <span class="note">d = 每月差額 = PMT<sub>A</sub> − PMT<sub>B</sub>；r<sub>m</sub> = 投資年化 / 12。最末期當期不再投入。</span>
                    </div>
                </div>

                <div class="formula-block">
                    <div class="h"><span class="step">FORMULA 5</span>淨損益 &amp; 打平點</div>
                    <div class="desc">最末期將「累積投資價值」扣除「尾款超出 PMT<sub>A</sub> 的部分」，即得方案 B 相對方案 A 的淨損益。打平點即令此值為零之 r 解。</div>
                    <div class="formula-box">
                        Net = FV − (BAL − PMT<sub>A</sub>)
                        <span class="note">Net &gt; 0 → 方案 B 較有優勢；Net &lt; 0 → 方案 A 較有優勢。打平點以二分搜尋法求得。</span>
                    </div>
                </div>

            </details>

        </div>
        `;
    }

    // ─────────────────────────────────────────────────────────
    //  入口 — 提供給主頁 initAll() 呼叫
    // ─────────────────────────────────────────────────────────
    let initialized = false;

    window.initLoanCompare = function() {
        if (initialized) return;
        const mount = document.getElementById('loancompare-mount-point');
        if (!mount) {
            console.warn('[bsd-loancompare] 找不到 #loancompare-mount-point，模組未掛載');
            return;
        }

        // 注入樣式
        injectStyles();

        // 渲染 HTML
        mount.innerHTML = buildHTML();

        // 暴露 toggleSchedule 給 inline onclick 使用
        window.toggleSchedule = toggleSchedule;

        // 綁定輸入事件
        ['pAmount', 'pRate', 'pTerm', 'pBalloon', 'pInvest'].forEach(id => {
            const el = $(id);
            if (el) el.addEventListener('input', recompute);
        });

        // ── 讀取由精算核心傳入的預填資料（localStorage，有效期 30 秒）──
        try {
            const raw = localStorage.getItem('bsd_lc_prefill');
            if (raw) {
                const pf = JSON.parse(raw);
                if (pf && pf.ts && Date.now() - pf.ts < 30000) {
                    localStorage.removeItem('bsd_lc_prefill');
                    _lcPhases = pf.phases || null;
                    // 填入參數欄位
                    const setVal = (id, v) => { const el = $(id); if (el) el.value = v; };
                    setVal('pAmount', Math.round(pf.principal / 10000 * 100) / 100); // 元 → 萬
                    setVal('pRate',   pf.rate);
                    setVal('pTerm',   pf.term);
                    setVal('pBalloon', Math.round(pf.balloon / 10000 * 100) / 100); // 元 → 萬
                    // 顯示來源提示 banner
                    const banner = $('lc-prefill-banner');
                    if (banner) {
                        banner.textContent = '✅ 已自動載入精算核心數值 — 本金 $' +
                            Math.round(pf.principal).toLocaleString('en-US') + '，總期數 ' + pf.term + ' 期' +
                            (_lcPhases && _lcPhases.length > 2 ? '（階段式 ' + _lcPhases.length + ' 段）' : '');
                        banner.style.display = 'block';
                    }
                }
            }
        } catch(e) { /* 靜默忽略 */ }

        // 日期戳記
        const d = new Date();
        const dateEl = $('meta-date');
        if (dateEl) {
            dateEl.textContent = d.getFullYear() + '.' +
                String(d.getMonth() + 1).padStart(2, '0') + '.' +
                String(d.getDate()).padStart(2, '0');
        }

        // 啟動首次運算
        recompute();
        initialized = true;
    };

})();
