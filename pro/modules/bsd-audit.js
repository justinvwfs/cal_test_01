/**
 * ============================================================
 *  BSD 智慧覆核引擎 v5.0 — 貼上即覆核
 *  作者：今晚沒喝夠的小賈哥
 *
 *  v5.0 重構重點：
 *  - 移除檔案上傳 (Excel/CSV) 與 OCR 功能
 *  - 改採「螢幕顯示格式 + 剪貼簿貼上」的確定性流程
 *  - 新增退利率佣比例 / 補貼上限 / 尾款比例規則表
 *  - 新增 12 條智能行為（方向驗證、寬鬆容差、欄位錯位偵測…）
 *  - 結果卡四段式版面：給定條件 / 計算結果 / 審核項目 / 智能備註
 *
 *  ⚠️ BSDCore.* 為純運算引擎，本檔案只呼叫不修改。
 * ============================================================
 */
(function() {
    'use strict';

    /* ═══════════════════════════════════════════════════════════
       欄位定義 (18 欄，順序即貼上順序)
       ═══════════════════════════════════════════════════════════ */
    var FIELDS = [
        // 基本條件 (4)
        { key:'msrp',           label:'MSRP',           unit:'元', required:false, group:'basic' },
        { key:'amount',         label:'分期金額',       unit:'元', required:true,  group:'basic' },
        { key:'basicRate',      label:'基礎利率',       unit:'%',  required:false, group:'basic' },
        { key:'custRate',       label:'客戶利率',       unit:'%',  required:false, group:'basic' },
        // 期數結構 (5 組 × 2 = 10)
        { key:'term1', label:'期數1', unit:'期', required:true,  group:'phase', phase:1, kind:'term' },
        { key:'pmt1',  label:'月付1', unit:'元', required:true,  group:'phase', phase:1, kind:'pmt'  },
        { key:'term2', label:'期數2', unit:'期', required:false, group:'phase', phase:2, kind:'term' },
        { key:'pmt2',  label:'月付2', unit:'元', required:false, group:'phase', phase:2, kind:'pmt'  },
        { key:'term3', label:'期數3', unit:'期', required:false, group:'phase', phase:3, kind:'term' },
        { key:'pmt3',  label:'月付3', unit:'元', required:false, group:'phase', phase:3, kind:'pmt'  },
        { key:'term4', label:'期數4', unit:'期', required:false, group:'phase', phase:4, kind:'term' },
        { key:'pmt4',  label:'月付4', unit:'元', required:false, group:'phase', phase:4, kind:'pmt'  },
        { key:'term5', label:'期數5', unit:'期', required:false, group:'phase', phase:5, kind:'term' },
        { key:'pmt5',  label:'月付5', unit:'元', required:false, group:'phase', phase:5, kind:'pmt'  },
        // 補貼/退佣 (4)
        { key:'dealerSubLimit', label:'經銷商補貼上限', unit:'元', required:false, group:'sub' },
        { key:'agentSubLimit',  label:'總代理補貼上限', unit:'元', required:false, group:'sub' },
        { key:'commission',     label:'退利率佣',       unit:'元', required:false, group:'sub' },
        { key:'commissionRatio',label:'退利率佣比例',   unit:'%',  required:false, group:'sub' }
    ];

    /* ═══════════════════════════════════════════════════════════
       全域狀態
       ═══════════════════════════════════════════════════════════ */
    function emptyCase() {
        var c = { _flags: {} };
        FIELDS.forEach(function(f) { c[f.key] = null; });
        c.phases = [];
        return c;
    }

    var state = {
        global: {
            basicRate: null,         // % (必填)
            pmtTolerance: 2,         // ±元
            rateTolerance: 0.01,     // ±%
            balloonRules: [
                { minTerm: 11, maxTerm: 24, maxRatio: 75 },
                { minTerm: 25, maxTerm: 36, maxRatio: 65 },
                { minTerm: 37, maxTerm: 48, maxRatio: 55 },
                { minTerm: 49, maxTerm: 60, maxRatio: 50 },
                { minTerm: 61, maxTerm: 72, maxRatio: 45 }
            ],
            rebateRatioEven: 100,    // 均攤型默認退佣比例 %
            rebateRatioBalloon: 80   // 尾款型默認退佣比例 %
        },
        cases: [],     // 待覆核案件
        results: []    // 覆核結果
    };

    /* ═══════════════════════════════════════════════════════════
       Helpers — 數值清洗與格式化
       ═══════════════════════════════════════════════════════════ */
    function cleanNumeric(str) {
        if (str === null || str === undefined || str === '') return null;
        var s = String(str).trim();
        if (s === '' || s === '-' || s === '─' || s === '—') return null;
        // 吸收 $, NT$, 元, 千分位逗號, %, 全形空白
        s = s.replace(/NT\$?/gi, '').replace(/[$,，\s\u3000元]/g, '').replace(/%$/, '');
        if (s === '') return null;
        var n = parseFloat(s);
        return isNaN(n) ? null : n;
    }

    function normalizeRate(val) {
        // 0.0499 → 4.99 (加上 _adjusted 旗標)
        if (val === null) return { value: null, adjusted: false };
        if (val > 0 && val < 1) return { value: val * 100, adjusted: true };
        return { value: val, adjusted: false };
    }

    function isNumericLikeString(str) {
        // 接受：純數字、帶單位後綴的數字 (18,871元、60期、4.99%)、空白、橫槓
        // 拒絕：含中英文 (如 "一萬八"、"車主")
        if (str === null || str === undefined) return true;
        var s = String(str).trim();
        if (s === '' || s === '-' || s === '─' || s === '—') return true;
        var afterCurrency = s.replace(/NT\$?/gi, '').replace(/[$,，\s\u3000]/g, '');
        return /^[\d.\-]+(元|期|%)?$/.test(afterCurrency);
    }

    function classifyCell(s) {
        // 'empty' / 'numeric' / 'text' — 用於標題列偵測
        var trimmed = String(s == null ? '' : s).trim();
        if (trimmed === '' || trimmed === '-' || trimmed === '─' || trimmed === '—') return 'empty';
        var afterCurrency = trimmed.replace(/NT\$?/gi, '').replace(/[$,，\s\u3000]/g, '');
        if (/^[\d.\-]+(元|期|%)?$/.test(afterCurrency)) return 'numeric';
        if (/[\u4e00-\u9fffA-Za-z]/.test(afterCurrency)) return 'text';
        return 'symbol';
    }

    function fmt$(n) {
        if (n === null || n === undefined || isNaN(n)) return '─';
        return '$' + Math.round(n).toLocaleString();
    }

    function fmt$signed(n) {
        if (n === null || n === undefined || isNaN(n)) return '─';
        var sign = n < 0 ? '−' : '';
        return sign + '$' + Math.abs(Math.round(n)).toLocaleString();
    }

    function fmtPct(n, d) {
        if (n === null || n === undefined || isNaN(n)) return '─';
        return n.toFixed(d || 4) + ' %';
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
            return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
        });
    }

    /* ═══════════════════════════════════════════════════════════
       PasteParser — 解析剪貼簿
       ═══════════════════════════════════════════════════════════ */
    var PasteParser = {
        parse: function(text) {
            if (!text || !text.trim()) return { rows: [], errors: [], hadHeader: false };

            var lines = text.split(/\r?\n/).filter(function(l) { return l.length > 0; });
            if (lines.length === 0) return { rows: [], errors: [], hadHeader: false };

            // 偵測分隔符 — 優先 Tab (Excel/Sheets 預設)，再 Comma
            var sep = '\t';
            if (lines[0].indexOf('\t') < 0) {
                sep = lines[0].indexOf(',') >= 0 ? ',' : /\s{2,}/;
            }

            var rawRows = lines.map(function(l) {
                return (typeof sep === 'string') ? l.split(sep) : l.split(sep);
            });

            // 偵測標題列 — 只有當「無任何純數值欄位」且「有文字欄位」才視為標題
            // 這樣 "18,871元" "5.00%" "60期" 不會被誤判，但 "車主名稱 分期金額 利率" 會
            var isHeader = function(cells) {
                var textCount = 0, numCount = 0;
                cells.forEach(function(c) {
                    var t = classifyCell(c);
                    if (t === 'text') textCount++;
                    else if (t === 'numeric') numCount++;
                });
                return textCount > 0 && numCount === 0;
            };

            var startIdx = 0;
            var hadHeader = false;
            if (isHeader(rawRows[0])) { startIdx = 1; hadHeader = true; }

            var dataRows = rawRows.slice(startIdx);
            var errors = [];
            dataRows.forEach(function(cells, idx) {
                var rowNum = idx + (hadHeader ? 2 : 1);
                var bad = [];
                cells.forEach(function(c, ci) {
                    if (!isNumericLikeString(c)) bad.push({ col: ci + 1, value: String(c).trim() });
                });
                if (bad.length > 0) {
                    errors.push({ rowNum: rowNum, bad: bad, line: cells.join(' | ') });
                }
            });

            return { rows: dataRows, errors: errors, hadHeader: hadHeader };
        }
    };

    /* ═══════════════════════════════════════════════════════════
       Row → Case 轉換
       ═══════════════════════════════════════════════════════════ */
    function rowToCase(cells, idx) {
        var obj = { _idx: idx, _flags: {} };
        FIELDS.forEach(function(f, i) {
            var raw = cells[i];
            var cleaned = cleanNumeric(raw);
            if (f.unit === '%' && cleaned !== null) {
                var nr = normalizeRate(cleaned);
                obj[f.key] = nr.value;
                if (nr.adjusted) obj._flags['rate_adjusted_' + f.key] = true;
            } else {
                obj[f.key] = cleaned;
            }
            // 保留原始字串（給結果卡 §1 給定條件顯示用）
            obj['_raw_' + f.key] = (raw == null || raw === '') ? '' : String(raw).trim();
        });
        // 組成 phases
        obj.phases = [];
        for (var i = 1; i <= 5; i++) {
            var t = obj['term' + i];
            var p = obj['pmt' + i];
            if (t && t > 0) obj.phases.push({ term: Math.round(t), pmt: p });
        }
        return obj;
    }

    /* ═══════════════════════════════════════════════════════════
       AuditPipeline — 覆核引擎核心
       ═══════════════════════════════════════════════════════════ */
    var AuditPipeline = {

        auditOne: function(c, global) {
            var result = {
                input: c,
                computed: {},
                checks: [],
                notes: [],
                status: 'pass'
            };

            var setStatus = function(s) {
                if (s === 'fail') result.status = 'fail';
                else if (s === 'warn' && result.status === 'pass') result.status = 'warn';
            };
            var addCheck = function(status, label, detail) {
                result.checks.push({ status: status, label: label, detail: detail });
                setStatus(status);
            };
            var addNote = function(text) { result.notes.push(text); };

            /* ─── 利率自動修正旗標 ─── */
            Object.keys(c._flags || {}).forEach(function(flag) {
                if (flag.indexOf('rate_adjusted_') === 0) {
                    var key = flag.replace('rate_adjusted_', '');
                    var field = FIELDS.find(function(f) { return f.key === key; });
                    addNote('「' + (field ? field.label : key) + '」輸入為小數，已自動視為百分比 (×100)');
                }
            });

            /* ─── 決定有效基礎利率 (個別覆寫全域) ─── */
            var baseRate;
            if (c.basicRate !== null && c.basicRate > 0) {
                baseRate = c.basicRate;
                if (global.basicRate !== null && global.basicRate > 0 && Math.abs(c.basicRate - global.basicRate) > 0.001) {
                    addNote('使用個別基礎利率 ' + c.basicRate + '% (覆寫全域 ' + global.basicRate + '%)');
                }
            } else {
                baseRate = global.basicRate;
            }
            if (baseRate === null || baseRate <= 0) {
                addCheck('fail', '無法執行覆核', '個別案件未填基礎利率且全域基礎利率未設定');
                return result;
            }
            result.computed.baseRate = baseRate;

            /* ─── 期數合理性 ─── */
            if (!c.phases || c.phases.length === 0) {
                addCheck('fail', '期數缺失', '至少需填寫一階段的期數');
                return result;
            }
            var totalTerms = 0;
            var hasAllPmts = true;
            c.phases.forEach(function(p) {
                totalTerms += p.term;
                if (p.pmt === null || p.pmt === undefined || p.pmt <= 0) hasAllPmts = false;
            });
            result.computed.totalTerms = totalTerms;

            /* ─── 分期金額 ─── */
            if (c.amount === null || c.amount <= 0) {
                addCheck('fail', '分期金額缺失', '無法執行覆核');
                return result;
            }

            /* ─── ⑨ 值域軟性警告 ─── */
            if (c.amount < 100000)
                addCheck('warn', '分期金額過小', '$' + c.amount.toLocaleString() + ' < 10萬，請確認');
            if (totalTerms < 12)
                addCheck('warn', '總期數過少', totalTerms + ' 期 < 12 期，請確認');
            if (c.custRate !== null && c.custRate < 0)
                addCheck('warn', '客戶利率為負', '請確認');
            if (baseRate < 0)
                addCheck('warn', '基礎利率為負', '請確認');

            /* ─── ⑫ 欄位錯位偵測 ─── */
            if (c.amount !== null && c.amount > 0 && c.amount < 100)
                addCheck('warn', '欄位疑似錯位', '分期金額 = ' + c.amount + '，數值過小，是否貼錯欄位？');
            if (c.custRate !== null && c.custRate > 100)
                addCheck('warn', '欄位疑似錯位', '客戶利率 = ' + c.custRate + '，數值過大，是否貼錯欄位？');
            if (c.basicRate !== null && c.basicRate > 100)
                addCheck('warn', '欄位疑似錯位', '基礎利率 = ' + c.basicRate + '，數值過大，是否貼錯欄位？');

            /* ─── ③ 尾款結構偵測 ─── */
            var isBalloon = false;
            var balloonAmount = 0;
            if (c.phases.length >= 2) {
                var last = c.phases[c.phases.length - 1];
                var prev = c.phases[c.phases.length - 2];
                if (last.term === 1 && last.pmt !== null && prev.pmt !== null && last.pmt > prev.pmt * 5) {
                    isBalloon = true;
                    balloonAmount = last.pmt;
                }
            }
            result.computed.isBalloon = isBalloon;
            result.computed.balloonAmount = balloonAmount;
            if (isBalloon) addNote('偵測為尾款結構（末段 1 期 $' + balloonAmount.toLocaleString() + '）');

            /* ─── 核心：IRR 與 S 計算 (呼叫 BSDCore) ─── */
            var computedRate = null;
            var computedS = null;
            var totalPayment = null;
            if (hasAllPmts) {
                var flows = [];
                c.phases.forEach(function(p) {
                    for (var i = 0; i < p.term; i++) flows.push(p.pmt);
                });
                var baseM = baseRate / 100 / 12;
                computedS = BSDCore.calculateActualS(c.amount, baseM, flows);
                var irr = BSDCore.solveIRR(-c.amount, flows);
                if (irr < 0) irr = 0;
                computedRate = irr * 1200;
                totalPayment = 0;
                flows.forEach(function(f) { totalPayment += f; });

                result.computed.computedRate = computedRate;
                result.computed.computedS = computedS;
                result.computed.totalPayment = totalPayment;
                result.computed.totalInterest = totalPayment - c.amount;
            } else {
                addNote('部分階段月付款未填，無法計算 IRR 與 S 值');
            }

            /* ─── 退佣比例決定 ─── */
            var rebateRatio;
            if (c.commissionRatio !== null && c.commissionRatio > 0) {
                rebateRatio = c.commissionRatio;
                addNote('使用個別退佣比例 ' + rebateRatio + '%');
            } else if (isBalloon) {
                rebateRatio = global.rebateRatioBalloon;
                addNote('未填退佣比例，採用全域預設 ' + rebateRatio + '% (尾款型)');
            } else {
                rebateRatio = global.rebateRatioEven;
                addNote('未填退佣比例，採用全域預設 ' + rebateRatio + '% (均攤型)');
            }
            result.computed.rebateRatio = rebateRatio;

            /* ─── 計算實質補貼/退佣 ─── */
            var actualSubsidy = 0;
            var actualRebate = 0;
            if (computedS !== null) {
                if (computedS < 0) actualSubsidy = Math.abs(Math.round(computedS));
                else if (computedS > 0) actualRebate = Math.round(computedS * rebateRatio / 100);
                result.computed.actualSubsidy = actualSubsidy;
                result.computed.actualRebate = actualRebate;
                result.computed.fullRebate = Math.round(computedS > 0 ? computedS : 0);
            }

            /* ─── ① 客戶利率一致性 ─── */
            if (c.custRate !== null && computedRate !== null) {
                var diff = Math.abs(computedRate - c.custRate);
                if (diff <= global.rateTolerance) {
                    addCheck('pass', '客戶利率一致',
                        '給定 ' + c.custRate.toFixed(4) + '% vs 運算 ' + computedRate.toFixed(4) + '%，差 ' + diff.toFixed(4) + '% (容差 ±' + global.rateTolerance + '%)');
                } else {
                    addCheck('warn', '客戶利率有差異',
                        '給定 ' + c.custRate.toFixed(4) + '% vs 運算 ' + computedRate.toFixed(4) + '%，差 ' + diff.toFixed(4) + '%，超出容差 ±' + global.rateTolerance + '%');
                }
            } else if (c.custRate === null && computedRate !== null) {
                addNote('客戶利率未填，已依條件反推為 ' + computedRate.toFixed(4) + '%');
            } else if (c.custRate !== null && computedRate === null) {
                addNote('給定客戶利率 ' + c.custRate + '%，但因月付款不完整無法反推驗證');
            }

            /* ─── ⑦ 補貼上限驗證 (硬規則：超限直接 fail) ─── */
            var dealerLimit = c.dealerSubLimit || 0;
            var agentLimit = c.agentSubLimit || 0;
            var totalLimit = dealerLimit + agentLimit;
            if (totalLimit > 0 && computedS !== null) {
                if (actualSubsidy > totalLimit) {
                    addCheck('fail', '補貼超限 (硬規則)',
                        '運算需補貼 $' + actualSubsidy.toLocaleString() + ' > 補貼上限合計 $' + totalLimit.toLocaleString() +
                        ' (經銷 $' + dealerLimit.toLocaleString() + ' + 總代 $' + agentLimit.toLocaleString() + ')，超 $' + (actualSubsidy - totalLimit).toLocaleString());
                } else if (actualSubsidy > 0) {
                    addCheck('pass', '補貼未超限',
                        '$' + actualSubsidy.toLocaleString() + ' ≤ 上限合計 $' + totalLimit.toLocaleString() + ' (餘裕 $' + (totalLimit - actualSubsidy).toLocaleString() + ')');
                } else {
                    addCheck('pass', '補貼未超限', '無需補貼，給定上限 $' + totalLimit.toLocaleString() + ' 全額保留');
                }
            } else if (computedS !== null && actualSubsidy > 0) {
                addNote('未指定補貼上限，運算需補貼 $' + actualSubsidy.toLocaleString());
            }

            /* ─── 退利率佣驗證 ─── */
            if (c.commission !== null && computedS !== null) {
                var monetaryTol = 10;
                var diffC = Math.abs(actualRebate - c.commission);
                if (diffC <= monetaryTol) {
                    addCheck('pass', '退佣一致',
                        '給定 $' + c.commission.toLocaleString() + ' ≈ 計算 $' + actualRebate.toLocaleString() +
                        ' (' + rebateRatio + '% × 全額 $' + result.computed.fullRebate.toLocaleString() + ')');
                } else if (actualRebate > c.commission) {
                    addCheck('warn', '退佣低於計算',
                        '給定 $' + c.commission.toLocaleString() + ' < 計算 $' + actualRebate.toLocaleString() + '，差 $' + (actualRebate - c.commission).toLocaleString());
                } else {
                    addCheck('warn', '退佣高於計算',
                        '給定 $' + c.commission.toLocaleString() + ' > 計算 $' + actualRebate.toLocaleString() + '，差 $' + (c.commission - actualRebate).toLocaleString());
                }
            } else if (actualRebate > 0) {
                addNote('未指定退佣金額，依比例 ' + rebateRatio + '% 計算退佣 $' + actualRebate.toLocaleString() +
                        ' (全額退佣 $' + result.computed.fullRebate.toLocaleString() + ')');
            }

            /* ─── ⑧ 方向性驗證 ─── */
            if (c.custRate !== null && computedS !== null) {
                if (actualSubsidy > 0 && c.custRate >= baseRate) {
                    addCheck('warn', '方向矛盾',
                        '有補貼但客戶利率 ' + c.custRate + '% ≥ 基礎利率 ' + baseRate + '%（補貼情境下客戶利率應低於基礎利率）');
                } else if (actualRebate > 0 && c.custRate <= baseRate) {
                    addCheck('warn', '方向矛盾',
                        '有退佣但客戶利率 ' + c.custRate + '% ≤ 基礎利率 ' + baseRate + '%（退佣情境下客戶利率應高於基礎利率）');
                }
            }

            /* ─── 尾款比例驗證 (有 MSRP 才驗) ─── */
            if (isBalloon) {
                if (c.msrp !== null && c.msrp > 0) {
                    var ratio = balloonAmount / c.msrp * 100;
                    var rule = global.balloonRules.find(function(r) {
                        return totalTerms >= r.minTerm && totalTerms <= r.maxTerm;
                    });
                    if (rule) {
                        if (ratio <= rule.maxRatio) {
                            addCheck('pass', '尾款比例符合',
                                '尾款/MSRP = ' + ratio.toFixed(2) + '% ≤ 上限 ' + rule.maxRatio + '% (適用 ' + rule.minTerm + '-' + rule.maxTerm + ' 期規則)');
                        } else {
                            addCheck('fail', '尾款比例超限',
                                '尾款/MSRP = ' + ratio.toFixed(2) + '% > 上限 ' + rule.maxRatio + '% (適用 ' + rule.minTerm + '-' + rule.maxTerm + ' 期規則)');
                        }
                    } else {
                        addNote('總期數 ' + totalTerms + ' 不在任何尾款規則區間，未驗證尾款比例');
                    }
                } else {
                    addNote('⚠️ 請留意尾款比例上限（未填 MSRP，無法驗證）');
                }
            }

            /* ─── 月付款合理性（總付款 < 本金 → fail） ─── */
            if (totalPayment !== null && totalPayment < c.amount) {
                addCheck('fail', '付款不足',
                    '總付款 $' + totalPayment.toLocaleString() + ' < 本金 $' + c.amount.toLocaleString());
            }

            return result;
        },

        runAll: function() {
            state.results = state.cases.map(function(c) {
                return AuditPipeline.auditOne(c, state.global);
            });
        }
    };

    /* ═══════════════════════════════════════════════════════════
       UI Renderers
       ═══════════════════════════════════════════════════════════ */
    var UI = {

        /* ─── 格式說明區（永久可見） ─── */
        renderFormatGuide: function() {
            var h = '<div class="audit-format-card">';
            h += '<div class="afc-title">📋 貼上格式 — 從 Excel/Sheets 依下列順序選取欄位後 Ctrl+V</div>';
            h += '<div class="afc-table-wrap"><table class="afc-table"><thead>';

            // 第一列：分組
            h += '<tr class="afc-group-row">';
            h += '<th colspan="4" style="background:#dbeafe;color:#1e40af">基本條件 (4 欄)</th>';
            h += '<th colspan="10" style="background:#dcfce7;color:#15803d">期數結構 (5 組 × 2 = 10 欄)</th>';
            h += '<th colspan="4" style="background:#fef3c7;color:#a16207">補貼/退佣 (4 欄)</th>';
            h += '</tr>';

            // 第二列：欄位名稱 + 必填星號
            h += '<tr class="afc-name-row">';
            FIELDS.forEach(function(f, i) {
                h += '<th>' + (i + 1) + '. ' + f.label + (f.required ? ' <span class="afc-req">★</span>' : '') + '</th>';
            });
            h += '</tr>';

            // 第三列：單位
            h += '<tr class="afc-unit-row">';
            FIELDS.forEach(function(f) {
                h += '<th>(' + f.unit + ')</th>';
            });
            h += '</tr>';

            // 第四列：範例
            var examples = ['1500000', '1200000', '5.00', '4.99', '12', '8500', '47', '21200', '1', '580000', '', '', '', '', '20000', '20000', '', ''];
            h += '<tr class="afc-example-row">';
            examples.forEach(function(e) {
                h += '<td>' + (e || '<span style="color:#cbd5e1">（空）</span>') + '</td>';
            });
            h += '</tr>';

            h += '</thead></table></div>';

            h += '<div class="afc-notes">';
            h += '<div><b>★ = 必填</b>　其餘空白可不填</div>';
            h += '<div><b>單位約定</b>：金額一律「元」整數（可帶千分位逗號、$、NT$、元字尾，會自動清理）；利率一律「%」（可帶 % 字尾，輸入 <code>0.0499</code> 會自動視為 4.99%）</div>';
            h += '<div><b>標題列</b>：若第一列為文字標題會自動跳過</div>';
            h += '<div><b>整行非數值</b>：若某列含非數字字元（如備註、車型名），整列會被擋下並提示</div>';
            h += '<div><b>未填項目</b>：客戶利率、基礎利率、MSRP、補貼上限、退佣金額、退佣比例都可留白，系統會自動計算並在備註提示</div>';
            h += '</div>';

            h += '</div>';
            return h;
        },

        /* ─── 全域設定區 ─── */
        renderGlobalConfig: function() {
            var g = state.global;
            var h = '<div class="audit-global-card">';
            h += '<div class="agc-row">';
            h += '<div class="input-group"><label>全域基礎利率 % <span class="req">*</span></label><input type="number" id="A-G-BasicRate" step="0.01" placeholder="例如 5.00" value="' + (g.basicRate || '') + '" oninput="AuditUI.updateGlobal()"></div>';
            h += '<div class="input-group"><label>月付款容差 (±元)</label><input type="number" id="A-G-PmtTol" value="' + g.pmtTolerance + '" oninput="AuditUI.updateGlobal()"></div>';
            h += '<div class="input-group"><label>利率容差 (±%)</label><input type="number" id="A-G-RateTol" step="0.001" value="' + g.rateTolerance + '" oninput="AuditUI.updateGlobal()"></div>';
            h += '</div>';

            h += '<details class="agc-advanced"><summary>▾ 進階規則設定（尾款比例上限 + 退佣比例預設）</summary>';

            // 尾款規則表
            h += '<div class="agc-section-title">📐 尾款比例上限規則 (需有 MSRP 才會驗證)</div>';
            h += '<div id="A-G-BalloonRules-Wrap">' + UI.renderBalloonRulesTable() + '</div>';

            // 退佣比例
            h += '<div class="agc-section-title" style="margin-top:14px">💸 退佣比例預設值 (個別案件可覆寫)</div>';
            h += '<div class="agc-row">';
            h += '<div class="input-group"><label>均攤型默認退佣比例 %</label><input type="number" id="A-G-RebateEven" value="' + g.rebateRatioEven + '" oninput="AuditUI.updateGlobal()"></div>';
            h += '<div class="input-group"><label>尾款型默認退佣比例 %</label><input type="number" id="A-G-RebateBalloon" value="' + g.rebateRatioBalloon + '" oninput="AuditUI.updateGlobal()"></div>';
            h += '</div>';

            h += '</details></div>';
            return h;
        },

        renderBalloonRulesTable: function() {
            var rules = state.global.balloonRules;
            var h = '<table class="agc-rules-table"><thead><tr><th>期數區間</th><th>尾款上限 (% of MSRP)</th><th></th></tr></thead><tbody>';
            rules.forEach(function(r, idx) {
                h += '<tr>';
                h += '<td><input type="number" value="' + r.minTerm + '" style="width:60px" oninput="AuditUI.updateRule(' + idx + ',\'minTerm\',this.value)"> ~ ';
                h += '<input type="number" value="' + r.maxTerm + '" style="width:60px" oninput="AuditUI.updateRule(' + idx + ',\'maxTerm\',this.value)"> 期</td>';
                h += '<td><input type="number" value="' + r.maxRatio + '" style="width:80px" step="0.1" oninput="AuditUI.updateRule(' + idx + ',\'maxRatio\',this.value)"> %</td>';
                h += '<td><button class="btn btn-del" onclick="AuditUI.removeRule(' + idx + ')">×</button></td>';
                h += '</tr>';
            });
            h += '</tbody></table>';
            h += '<button class="btn btn-add-rule" onclick="AuditUI.addRule()">➕ 新增區間</button>';
            return h;
        },

        /* ─── 內嵌表單 (整合貼上區 + 預覽 + 編輯) ─── */
        renderInlineForm: function() {
            var h = '<div class="audit-inline-form-card">';

            // 標題列
            h += '<div class="aif-head">';
            h += '<div class="aif-title">✂️ 待覆核資料</div>';
            h += '<div class="aif-hint">直接於儲存格輸入，或從 Excel/Sheets 框選後 <kbd>Ctrl+V</kbd> 貼到任一格 → 自動展開填入</div>';
            h += '</div>';

            // 訊息區
            h += '<div id="A-FormMsg" class="form-msg" style="display:none"></div>';

            // 表格
            h += '<div class="aif-table-wrap"><table class="aif-table"><thead>';
            h += '<tr class="aif-group-row">';
            h += '<th class="aif-idx" rowspan="2">#</th>';
            h += '<th colspan="4" style="background:#dbeafe;color:#1e40af">基本條件</th>';
            h += '<th colspan="10" style="background:#dcfce7;color:#15803d">期數結構</th>';
            h += '<th colspan="4" style="background:#fef3c7;color:#a16207">補貼/退佣</th>';
            h += '<th class="aif-act" rowspan="2"></th>';
            h += '</tr>';
            h += '<tr class="aif-name-row">';
            FIELDS.forEach(function(f) {
                h += '<th>' + f.label + (f.required ? '<span class="afc-req">★</span>' : '') + '<br><span class="aif-unit">(' + f.unit + ')</span></th>';
            });
            h += '</tr></thead>';
            h += '<tbody id="A-FormBody">';
            state.cases.forEach(function(c, rowIdx) {
                h += UI.renderFormRow(c, rowIdx);
            });
            h += '</tbody></table></div>';

            // 表格下方控制列
            h += '<div class="aif-foot">';
            h += '<button class="btn btn-add-row" onclick="AuditUI.addRow()">➕ 新增空白列</button>';
            h += '<span class="aif-count"><span id="A-RowCount">' + state.cases.length + '</span> / 30 列</span>';
            h += '</div>';

            // 操作按鈕
            h += '<div class="aif-actions">';
            h += '<button class="btn btn-audit-run" onclick="AuditUI.runAudit()">🚀 啟動覆核</button>';
            h += '<button class="btn btn-clear-all" onclick="AuditUI.clearAll()">🗑 全部清空</button>';
            h += '</div>';

            h += '</div>';
            return h;
        },

        renderFormRow: function(c, rowIdx) {
            var h = '<tr>';
            h += '<td class="aif-idx">' + (rowIdx + 1) + '</td>';
            FIELDS.forEach(function(f, colIdx) {
                var v = c[f.key];
                var displayVal = (v === null || v === undefined) ? '' : v;
                h += '<td><input type="text" class="aif-cell"';
                h += ' data-row="' + rowIdx + '"';
                h += ' data-col="' + colIdx + '"';
                h += ' value="' + displayVal + '"';
                h += ' placeholder="—"';
                h += ' onchange="AuditUI.updateCellValue(' + rowIdx + ',\'' + f.key + '\',this.value)"';
                h += ' onpaste="AuditUI.handleCellPaste(event,' + rowIdx + ',' + colIdx + ')"';
                h += '></td>';
            });
            h += '<td class="aif-act"><button class="btn btn-del" title="刪除此列" onclick="AuditUI.removeRow(' + rowIdx + ')">×</button></td>';
            h += '</tr>';
            return h;
        },

        /* ─── 結果區 ─── */
        renderResults: function() {
            if (state.results.length === 0) return '';
            var pass = 0, warn = 0, fail = 0;
            state.results.forEach(function(r) {
                if (r.status === 'pass') pass++;
                else if (r.status === 'warn') warn++;
                else fail++;
            });

            var h = '<div class="audit-results-card">';
            h += '<div class="arc-summary-row">';
            h += '<div class="arc-summary-box pass"><div class="num">' + pass + '</div><div class="lbl">通過</div></div>';
            h += '<div class="arc-summary-box warn"><div class="num">' + warn + '</div><div class="lbl">警告</div></div>';
            h += '<div class="arc-summary-box fail"><div class="num">' + fail + '</div><div class="lbl">異常</div></div>';
            h += '<div class="arc-summary-box total"><div class="num">' + state.results.length + '</div><div class="lbl">總計</div></div>';
            h += '<div style="margin-left:auto"><button class="btn btn-excel" onclick="AuditUI.exportExcel()">📗 匯出 Excel</button></div>';
            h += '</div>';

            state.results.forEach(function(r, idx) {
                h += UI.renderOneResultCard(r, idx);
            });
            h += '</div>';
            return h;
        },

        renderOneResultCard: function(r, idx) {
            var sc = r.status === 'pass' ? '#10b981' : r.status === 'fail' ? '#ef4444' : '#f59e0b';
            var si = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '⚠️';
            var st = r.status === 'pass' ? '通過' : r.status === 'fail' ? '異常' : '警告';

            var h = '<div class="arc-card" style="border-left-color:' + sc + '">';

            // 標題列
            h += '<div class="arc-card-head">';
            h += '<div class="arc-card-title">' + si + ' Case #' + (idx + 1) + '</div>';
            h += '<div class="arc-card-status" style="background:' + sc + '15;color:' + sc + '">' + st + '</div>';
            h += '</div>';

            // §1 給定條件 — 採用與貼上區同樣的表格格式
            h += '<div class="arc-section">';
            h += '<div class="arc-section-title">① 給定條件</div>';
            h += '<div class="arc-input-table-wrap"><table class="arc-input-table"><thead>';
            h += '<tr class="arc-group-row">';
            h += '<th colspan="4" style="background:#dbeafe;color:#1e40af">基本</th>';
            h += '<th colspan="10" style="background:#dcfce7;color:#15803d">期數結構</th>';
            h += '<th colspan="4" style="background:#fef3c7;color:#a16207">補貼/退佣</th>';
            h += '</tr>';
            h += '<tr class="arc-name-row">';
            FIELDS.forEach(function(f) {
                h += '<th>' + f.label + '<br><span class="arc-unit">(' + f.unit + ')</span></th>';
            });
            h += '</tr></thead><tbody><tr>';
            FIELDS.forEach(function(f) {
                var v = r.input[f.key];
                var cellHtml;
                if (v === null || v === undefined || v === '') {
                    cellHtml = '<span class="arc-empty">（未填）</span>';
                } else if (f.unit === '元') {
                    cellHtml = v.toLocaleString();
                } else if (f.unit === '%') {
                    cellHtml = v + ' %';
                } else {
                    cellHtml = v;
                }
                h += '<td>' + cellHtml + '</td>';
            });
            h += '</tr></tbody></table></div>';
            h += '</div>';

            // §2 計算結果（無論通過與否一律顯示）
            h += '<div class="arc-section">';
            h += '<div class="arc-section-title">② 計算結果</div>';
            h += '<div class="arc-compute-grid">';
            var cp = r.computed;
            h += UI.computeCell('基礎利率 (採用)', cp.baseRate != null ? fmtPct(cp.baseRate, 2) : '─');
            h += UI.computeCell('客戶實際利率 (IRR)', cp.computedRate != null ? fmtPct(cp.computedRate, 4) : '─');
            h += UI.computeCell('S 值 (基礎利率折算)', cp.computedS != null ? fmt$signed(cp.computedS) : '─');
            h += UI.computeCell('實質補貼款', cp.actualSubsidy ? fmt$(cp.actualSubsidy) : '─');
            h += UI.computeCell('實質退利率佣', cp.actualRebate ? fmt$(cp.actualRebate) + (cp.fullRebate ? ' (' + cp.rebateRatio + '% × $' + cp.fullRebate.toLocaleString() + ')' : '') : '─');
            h += UI.computeCell('總期數', cp.totalTerms ? cp.totalTerms + ' 期' : '─');
            h += UI.computeCell('總付款金額', cp.totalPayment != null ? fmt$(cp.totalPayment) : '─');
            h += UI.computeCell('總利息支出', cp.totalInterest != null ? fmt$(cp.totalInterest) : '─');
            h += '</div>';
            h += '</div>';

            // §3 審核項目
            if (r.checks.length > 0) {
                h += '<div class="arc-section">';
                h += '<div class="arc-section-title">③ 審核項目</div>';
                h += '<div class="arc-checks">';
                r.checks.forEach(function(chk) {
                    var cc = chk.status === 'pass' ? '#10b981' : chk.status === 'fail' ? '#ef4444' : '#f59e0b';
                    var ci = chk.status === 'pass' ? '✅' : chk.status === 'fail' ? '❌' : '⚠️';
                    h += '<div class="arc-check" style="border-left-color:' + cc + ';background:' + cc + '0a">';
                    h += '<div class="arc-check-label"><b>' + ci + ' ' + escapeHtml(chk.label) + '</b></div>';
                    h += '<div class="arc-check-detail">' + escapeHtml(chk.detail) + '</div>';
                    h += '</div>';
                });
                h += '</div></div>';
            }

            // §4 智能備註
            if (r.notes.length > 0) {
                h += '<div class="arc-section">';
                h += '<div class="arc-section-title">④ 智能備註</div>';
                h += '<div class="arc-notes">';
                r.notes.forEach(function(n) {
                    h += '<div class="arc-note">ℹ ' + escapeHtml(n) + '</div>';
                });
                h += '</div></div>';
            }

            h += '</div>';
            return h;
        },

        computeCell: function(label, value) {
            return '<div class="arc-compute-cell"><div class="arc-cc-lbl">' + label + '</div><div class="arc-cc-val">' + value + '</div></div>';
        }
    };

    /* ═══════════════════════════════════════════════════════════
       AuditUI — UI 行為控制 (掛到 window 給 inline onclick 用)
       ═══════════════════════════════════════════════════════════ */
    window.AuditUI = {

        updateGlobal: function() {
            var g = state.global;
            var bv = parseFloat(document.getElementById('A-G-BasicRate').value);
            g.basicRate = (isNaN(bv) || bv <= 0) ? null : bv;
            var ptv = parseFloat(document.getElementById('A-G-PmtTol').value);
            if (!isNaN(ptv) && ptv >= 0) g.pmtTolerance = ptv;
            var rtv = parseFloat(document.getElementById('A-G-RateTol').value);
            if (!isNaN(rtv) && rtv >= 0) g.rateTolerance = rtv;
            var re = parseFloat(document.getElementById('A-G-RebateEven').value);
            if (!isNaN(re) && re >= 0) g.rebateRatioEven = re;
            var rb = parseFloat(document.getElementById('A-G-RebateBalloon').value);
            if (!isNaN(rb) && rb >= 0) g.rebateRatioBalloon = rb;
        },

        updateRule: function(idx, key, val) {
            var v = parseFloat(val);
            if (isNaN(v)) return;
            state.global.balloonRules[idx][key] = v;
        },

        addRule: function() {
            state.global.balloonRules.push({ minTerm: 1, maxTerm: 12, maxRatio: 80 });
            document.getElementById('A-G-BalloonRules-Wrap').innerHTML = UI.renderBalloonRulesTable();
        },

        removeRule: function(idx) {
            state.global.balloonRules.splice(idx, 1);
            document.getElementById('A-G-BalloonRules-Wrap').innerHTML = UI.renderBalloonRulesTable();
        },

        /* ─── 儲存格層級的剪貼簿事件處理 ─── */
        handleCellPaste: function(e, rowIdx, colIdx) {
            var text = (e.clipboardData || window.clipboardData).getData('text');
            if (!text) return;
            // 單值貼上 → 不攔截，讓瀏覽器處理（onchange 會接續清洗）
            if (text.indexOf('\t') === -1 && text.indexOf('\n') === -1) return;
            // 多格貼上 → 接管
            e.preventDefault();
            window.AuditUI.applyClipboardAtCell(rowIdx, colIdx, text);
        },

        applyClipboardAtCell: function(startRow, startCol, text) {
            var parsed = PasteParser.parse(text);

            if (parsed.rows.length === 0) {
                showFormMsg('warn', '⚠️ 沒有解析到任何資料列');
                return;
            }

            // 非數值整列 → 擋下並提示
            if (parsed.errors.length > 0) {
                var errHtml = '<div style="font-weight:700;margin-bottom:6px">❌ 下列 ' + parsed.errors.length + ' 列含非數值字元，已被擋下：</div>';
                parsed.errors.forEach(function(e) {
                    errHtml += '<div style="font-size:12px;margin-bottom:4px">';
                    errHtml += '貼上的第 ' + e.rowNum + ' 列：<code>' + escapeHtml(e.line) + '</code>';
                    errHtml += '<br><span style="color:#9ca3af">問題欄位：' + e.bad.map(function(b) { return '第 ' + b.col + ' 欄 = "' + b.value + '"'; }).join('、') + '</span>';
                    errHtml += '</div>';
                });
                errHtml += '<div style="margin-top:8px;font-size:12px;color:#6b7280">請確認是否誤含備註、車型等文字。修正後重新貼上即可。</div>';
                showFormMsg('err', errHtml);
                return;
            }

            // 容量檢查 (30 筆上限)
            var rowsAfter = Math.max(state.cases.length, startRow + parsed.rows.length);
            if (rowsAfter > 30) {
                showFormMsg('warn', '⚠️ 加總將達 ' + rowsAfter + ' 筆，超過 30 筆上限。請拆批處理。');
                return;
            }

            // 將解析後的列填入 state.cases，從 (startRow, startCol) 開始
            parsed.rows.forEach(function(cells, ri) {
                var targetRow = startRow + ri;
                // 自動補上空白列直到 targetRow 存在
                while (state.cases.length <= targetRow) state.cases.push(emptyCase());
                // 將 cells 對應到從 startCol 開始的欄位
                cells.forEach(function(rawVal, ci) {
                    var targetCol = startCol + ci;
                    if (targetCol >= FIELDS.length) return; // 超出 18 欄忽略
                    var f = FIELDS[targetCol];
                    var cleaned = cleanNumeric(rawVal);
                    if (f.unit === '%' && cleaned !== null) {
                        var nr = normalizeRate(cleaned);
                        state.cases[targetRow][f.key] = nr.value;
                        if (nr.adjusted) state.cases[targetRow]._flags['rate_adjusted_' + f.key] = true;
                    } else {
                        state.cases[targetRow][f.key] = cleaned;
                    }
                });
                // 重建 phases
                rebuildPhases(state.cases[targetRow]);
            });

            var msgs = ['✅ 已填入 ' + parsed.rows.length + ' 列' + (parsed.hadHeader ? '（自動跳過第 1 列標題）' : '') + '，從第 ' + (startRow + 1) + ' 列開始'];
            showFormMsg('ok', msgs.join(' '));

            UI.refreshInlineForm();
        },

        updateCellValue: function(rowIdx, key, rawValue) {
            var c = state.cases[rowIdx];
            if (!c) return;
            if (rawValue === '' || rawValue === null || rawValue === undefined) {
                c[key] = null;
            } else {
                var cleaned = cleanNumeric(rawValue);
                var f = null;
                for (var i = 0; i < FIELDS.length; i++) if (FIELDS[i].key === key) { f = FIELDS[i]; break; }
                if (f && f.unit === '%' && cleaned !== null) {
                    var nr = normalizeRate(cleaned);
                    c[key] = nr.value;
                    if (nr.adjusted) c._flags['rate_adjusted_' + key] = true;
                    else delete c._flags['rate_adjusted_' + key];
                } else {
                    c[key] = cleaned;
                }
            }
            rebuildPhases(c);
        },

        addRow: function() {
            if (state.cases.length >= 30) {
                showFormMsg('warn', '⚠️ 已達上限 30 列');
                return;
            }
            state.cases.push(emptyCase());
            UI.refreshInlineForm();
            // 把焦點移到新列第一格
            setTimeout(function() {
                var el = document.querySelector('input.aif-cell[data-row="' + (state.cases.length - 1) + '"][data-col="0"]');
                if (el) el.focus();
            }, 20);
        },

        removeRow: function(rowIdx) {
            state.cases.splice(rowIdx, 1);
            // 至少保留 1 列
            if (state.cases.length === 0) state.cases.push(emptyCase());
            UI.refreshInlineForm();
        },

        clearAll: function() {
            state.cases = [emptyCase()];
            state.results = [];
            UI.refreshInlineForm();
            UI.refreshResults();
            hideFormMsg();
        },

        runAudit: function() {
            if (state.global.basicRate === null || state.global.basicRate <= 0) {
                // 容許個別案件有 basicRate；只在「全部都沒填」時才擋
                var allHaveLocal = state.cases.every(function(c) {
                    return c.basicRate !== null && c.basicRate > 0;
                });
                if (!allHaveLocal) {
                    showFormMsg('warn', '⚠️ 請先設定全域基礎利率（或各案件分別填入基礎利率欄位）');
                    return;
                }
            }
            // 過濾完全空白的列
            var validCases = state.cases.filter(function(c) {
                var hasAny = false;
                FIELDS.forEach(function(f) {
                    if (c[f.key] !== null && c[f.key] !== undefined) hasAny = true;
                });
                return hasAny;
            });
            if (validCases.length === 0) {
                showFormMsg('warn', '⚠️ 尚未輸入任何資料');
                return;
            }
            state.results = validCases.map(function(c) {
                return AuditPipeline.auditOne(c, state.global);
            });
            UI.refreshResults();
            hideFormMsg();
            // 滾動至結果
            setTimeout(function() {
                var el = document.querySelector('.audit-results-card');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 50);
        },

        exportExcel: function() {
            if (typeof XLSX === 'undefined') { alert('Excel 匯出需要載入 SheetJS'); return; }
            if (state.results.length === 0) { alert('尚無覆核結果'); return; }

            var data = [['BSD 智慧覆核報告 v5.0'], ['產生時間', new Date().toLocaleString()], []];
            // 欄位列
            var header = ['#', '狀態'];
            FIELDS.forEach(function(f) { header.push(f.label); });
            header.push('IRR (%)', 'S 值', '實質補貼', '實質退佣', '退佣比例%', '審核摘要', '備註');
            data.push(header);

            state.results.forEach(function(r, i) {
                var row = [i + 1, r.status.toUpperCase()];
                FIELDS.forEach(function(f) {
                    var v = r.input[f.key];
                    row.push(v === null || v === undefined ? '' : v);
                });
                var cp = r.computed;
                row.push(cp.computedRate != null ? cp.computedRate.toFixed(4) : '');
                row.push(cp.computedS != null ? Math.round(cp.computedS) : '');
                row.push(cp.actualSubsidy || '');
                row.push(cp.actualRebate || '');
                row.push(cp.rebateRatio || '');
                row.push(r.checks.map(function(c) { return '[' + c.status.toUpperCase() + '] ' + c.label + ': ' + c.detail; }).join(' | '));
                row.push(r.notes.join(' | '));
                data.push(row);
            });

            var ws = XLSX.utils.aoa_to_sheet(data);
            var wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '覆核報告');
            XLSX.writeFile(wb, 'BSD_覆核報告_v5.xlsx');
        }
    };

    /* ═══════════════════════════════════════════════════════════
       UI 重繪 / 內部 helpers
       ═══════════════════════════════════════════════════════════ */
    function rebuildPhases(c) {
        c.phases = [];
        for (var i = 1; i <= 5; i++) {
            var t = c['term' + i], p = c['pmt' + i];
            if (t && t > 0) c.phases.push({ term: Math.round(t), pmt: p });
        }
    }

    function showFormMsg(level, html) {
        var el = document.getElementById('A-FormMsg');
        if (!el) return;
        var cls = 'form-msg form-msg-' + (level === 'err' ? 'err' : level === 'warn' ? 'warn' : 'ok');
        el.className = cls;
        el.innerHTML = html;
        el.style.display = 'block';
    }

    function hideFormMsg() {
        var el = document.getElementById('A-FormMsg');
        if (el) el.style.display = 'none';
    }

    UI.refreshInlineForm = function() {
        var body = document.getElementById('A-FormBody');
        if (!body) return;
        var html = '';
        state.cases.forEach(function(c, rowIdx) {
            html += UI.renderFormRow(c, rowIdx);
        });
        body.innerHTML = html;
        var rc = document.getElementById('A-RowCount');
        if (rc) rc.textContent = state.cases.length;
    };

    UI.refreshResults = function() {
        var el = document.getElementById('A-ResultsWrap');
        if (el) el.innerHTML = UI.renderResults();
    };

    /* ═══════════════════════════════════════════════════════════
       注入樣式
       ═══════════════════════════════════════════════════════════ */
    function injectStyles() {
        if (document.getElementById('bsd-audit-styles')) return;
        var style = document.createElement('style');
        style.id = 'bsd-audit-styles';
        style.textContent =
            '.audit-scope { font-family: var(--font); color: var(--text); }' +
            '.audit-scope code { background: rgba(0,0,0,0.06); padding: 1px 6px; border-radius: 4px; font-family: var(--mono); font-size: 12px; }' +

            /* 共同卡片 */
            '.audit-format-card, .audit-global-card, .audit-inline-form-card, .audit-results-card { background: var(--bg-white); border: 1px solid var(--border); border-radius: 14px; padding: 22px 26px; margin-bottom: 18px; box-shadow: var(--shadow-sm); }' +

            /* 格式說明 */
            '.afc-title { font-size: 14px; font-weight: 800; color: var(--text); margin-bottom: 12px; }' +
            '.afc-table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; margin-bottom: 12px; }' +
            '.afc-table { border-collapse: collapse; font-family: var(--mono); font-size: 11px; min-width: 100%; }' +
            '.afc-table th, .afc-table td { padding: 6px 8px; border: 1px solid var(--border); text-align: center; white-space: nowrap; }' +
            '.afc-group-row th { font-weight: 800; padding: 7px 8px; letter-spacing: 0.05em; font-size: 11px; }' +
            '.afc-name-row th { background: var(--bg); color: var(--text); font-weight: 700; font-size: 11px; }' +
            '.afc-unit-row th { background: var(--bg); color: var(--text-muted); font-weight: 400; font-size: 10px; }' +
            '.afc-example-row td { background: var(--accent-light); color: var(--accent); font-weight: 700; }' +
            '.afc-req { color: #dc2626; font-weight: 800; }' +
            '.afc-notes { font-size: 12px; color: var(--text-secondary); line-height: 1.8; }' +
            '.afc-notes b { color: var(--text); }' +

            /* 全域設定 */
            '.agc-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 12px; }' +
            '.agc-advanced summary { cursor: pointer; font-size: 13px; font-weight: 700; color: var(--accent); padding: 8px 0; user-select: none; }' +
            '.agc-section-title { font-weight: 700; color: var(--text); margin: 10px 0 8px; font-size: 13px; }' +
            '.agc-rules-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 8px; }' +
            '.agc-rules-table th, .agc-rules-table td { padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: left; }' +
            '.agc-rules-table th { font-weight: 700; color: var(--text-secondary); font-size: 11px; }' +
            '.agc-rules-table input { padding: 5px 8px; border: 1px solid var(--border); border-radius: 5px; font-family: var(--mono); font-size: 12px; }' +
            '.btn-add-rule { background: var(--accent-light); color: var(--accent); padding: 6px 14px; font-size: 11px; border-radius: 6px; border: 1px dashed rgba(79,125,243,0.3); }' +

            /* 內嵌表單 */
            '.aif-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; }' +
            '.aif-title { font-size: 14px; font-weight: 800; color: var(--text); }' +
            '.aif-hint { font-size: 11px; color: var(--text-muted); }' +
            '.aif-hint kbd { background: var(--bg); border: 1px solid var(--border); border-bottom-width: 2px; padding: 1px 6px; border-radius: 4px; font-family: var(--mono); font-size: 10px; color: var(--text); }' +

            '.form-msg { margin-bottom: 12px; padding: 10px 14px; border-radius: 8px; font-size: 13px; line-height: 1.55; }' +
            '.form-msg-ok { background: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d; }' +
            '.form-msg-warn { background: #fffbeb; border: 1px solid #fde68a; color: #a16207; }' +
            '.form-msg-err { background: #fef2f2; border: 1px solid #fca5a5; color: #b91c1c; }' +
            '.form-msg code { background: rgba(0,0,0,0.06); padding: 1px 6px; border-radius: 4px; font-family: var(--mono); font-size: 11px; }' +

            '.aif-table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; max-height: 480px; overflow-y: auto; }' +
            '.aif-table { border-collapse: separate; border-spacing: 0; font-family: var(--mono); font-size: 11px; min-width: 100%; }' +
            '.aif-table th, .aif-table td { padding: 0; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); text-align: center; white-space: nowrap; }' +
            '.aif-table th:last-child, .aif-table td:last-child { border-right: none; }' +
            '.aif-table thead { position: sticky; top: 0; z-index: 5; background: var(--bg-white); }' +
            '.aif-group-row th { font-weight: 800; padding: 7px 8px; font-size: 10px; letter-spacing: 0.05em; }' +
            '.aif-name-row th { background: var(--bg); font-weight: 700; font-size: 10px; padding: 6px 4px; color: var(--text); }' +
            '.aif-unit { font-weight: 400; color: var(--text-muted); font-size: 9px; }' +
            '.aif-idx { background: var(--nav-dark); color: white; font-weight: 700; padding: 6px 8px; min-width: 32px; }' +
            '.aif-cell { width: 100%; min-width: 90px; padding: 8px 8px; border: none; background: transparent; font-family: var(--mono); font-size: 12px; text-align: right; outline: none; color: var(--text); }' +
            '.aif-cell:focus { background: rgba(79,125,243,0.06); box-shadow: inset 0 0 0 2px var(--accent); }' +
            '.aif-cell::placeholder { color: var(--text-muted); opacity: 0.5; }' +
            '.aif-table tbody tr:hover .aif-cell { background: rgba(0,0,0,0.02); }' +
            '.aif-table tbody tr:hover .aif-cell:focus { background: rgba(79,125,243,0.06); }' +
            '.aif-act { width: 34px; background: var(--bg); }' +
            '.aif-act .btn-del { background: transparent; color: #dc2626; font-size: 16px; padding: 4px 8px; border: 1px solid transparent; border-radius: 5px; transition: all 0.15s; }' +
            '.aif-act .btn-del:hover { background: #ef4444; color: white; border-color: #ef4444; }' +

            '.aif-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; flex-wrap: wrap; gap: 10px; }' +
            '.btn-add-row { background: var(--accent-light); color: var(--accent); padding: 8px 16px; font-size: 12px; border-radius: 8px; border: 1px dashed rgba(79,125,243,0.4); font-weight: 600; }' +
            '.btn-add-row:hover { background: var(--accent); color: white; border-style: solid; }' +
            '.aif-count { font-family: var(--mono); font-size: 11px; color: var(--text-muted); }' +

            '.aif-actions { display: flex; gap: 10px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); flex-wrap: wrap; }' +
            '.btn-audit-run { background: linear-gradient(135deg, #4f7df3, #6366f1); color: white; padding: 11px 24px; font-size: 14px; border-radius: 10px; font-weight: 700; box-shadow: 0 4px 16px rgba(79,125,243,0.25); }' +
            '.btn-clear-all { background: var(--bg); color: var(--text-muted); padding: 11px 18px; font-size: 13px; border-radius: 10px; border: 1px solid var(--border); }' +
            '.btn-clear-all:hover { color: #dc2626; border-color: #fca5a5; background: #fef2f2; }' +

            /* 結果區 */
            '.arc-summary-row { display: flex; gap: 12px; align-items: center; margin-bottom: 20px; flex-wrap: wrap; }' +
            '.arc-summary-box { padding: 12px 22px; border-radius: 10px; text-align: center; min-width: 90px; }' +
            '.arc-summary-box .num { font-size: 1.6rem; font-weight: 900; font-family: var(--mono); }' +
            '.arc-summary-box .lbl { font-size: 11px; font-weight: 700; margin-top: 2px; letter-spacing: 0.05em; }' +
            '.arc-summary-box.pass { background: #dcfce7; color: #15803d; }' +
            '.arc-summary-box.warn { background: #fef3c7; color: #a16207; }' +
            '.arc-summary-box.fail { background: #fee2e2; color: #b91c1c; }' +
            '.arc-summary-box.total { background: var(--accent-light); color: var(--accent); }' +

            '.arc-card { background: var(--bg-white); border: 1px solid var(--border); border-left: 4px solid #10b981; border-radius: 12px; padding: 18px 22px; margin-bottom: 16px; }' +
            '.arc-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }' +
            '.arc-card-title { font-weight: 800; color: var(--text); font-size: 14px; }' +
            '.arc-card-status { padding: 4px 12px; border-radius: 50px; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; }' +

            '.arc-section { margin-bottom: 14px; }' +
            '.arc-section:last-child { margin-bottom: 0; }' +
            '.arc-section-title { font-weight: 700; color: var(--text); font-size: 12px; margin-bottom: 8px; letter-spacing: 0.02em; }' +

            '.arc-input-table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }' +
            '.arc-input-table { border-collapse: collapse; font-family: var(--mono); font-size: 11px; min-width: 100%; }' +
            '.arc-input-table th, .arc-input-table td { padding: 5px 8px; border: 1px solid var(--border); text-align: center; white-space: nowrap; }' +
            '.arc-group-row th { font-weight: 800; padding: 6px 8px; font-size: 10px; }' +
            '.arc-name-row th { background: var(--bg); font-weight: 600; font-size: 10px; color: var(--text-secondary); }' +
            '.arc-unit { font-weight: 400; color: var(--text-muted); font-size: 9px; }' +
            '.arc-input-table tbody td { background: var(--bg-white); font-weight: 700; color: var(--text); }' +
            '.arc-empty { color: var(--text-muted); font-weight: 400; font-style: italic; }' +

            '.arc-compute-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }' +
            '.arc-compute-cell { background: linear-gradient(135deg, var(--accent-light), var(--accent2-light)); padding: 10px 14px; border-radius: 8px; }' +
            '.arc-cc-lbl { font-size: 10px; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.02em; margin-bottom: 4px; }' +
            '.arc-cc-val { font-family: var(--mono); font-size: 14px; font-weight: 700; color: var(--text); }' +

            '.arc-checks { display: flex; flex-direction: column; gap: 6px; }' +
            '.arc-check { border-left: 3px solid; padding: 8px 12px; border-radius: 0 6px 6px 0; }' +
            '.arc-check-label { font-size: 12px; color: var(--text); margin-bottom: 2px; }' +
            '.arc-check-detail { font-size: 11px; color: var(--text-secondary); line-height: 1.5; }' +

            '.arc-notes { display: flex; flex-direction: column; gap: 4px; padding: 10px 14px; background: var(--bg); border-radius: 8px; border-left: 3px solid var(--text-muted); }' +
            '.arc-note { font-size: 12px; color: var(--text-secondary); line-height: 1.55; }' +

            /* 響應式 */
            '@media (max-width: 768px) {' +
                '.audit-format-card, .audit-global-card, .audit-inline-form-card, .audit-results-card { padding: 16px 16px; }' +
                '.aif-head { flex-direction: column; align-items: flex-start; }' +
                '.aif-actions .btn-audit-run { flex: 1; }' +
            '}';
        document.head.appendChild(style);
    }

    /* ═══════════════════════════════════════════════════════════
       initAudit — 入口
       ═══════════════════════════════════════════════════════════ */
    var initialized = false;
    function initAudit() {
        var mount = document.getElementById('audit-mount-point');
        if (!mount) return;
        if (initialized) return;

        injectStyles();

        // 初始化 state.cases 為一個空白列
        if (state.cases.length === 0) state.cases.push(emptyCase());

        var html = '';
        html += '<div class="audit-scope">';
        html += '<div class="glass-card" style="border-top:3px solid #7c5df3">';
        html += '<div class="section-title" style="color:#7c5df3">';
        html += '<div>🔍 智慧覆核引擎 v5.1 <span class="author-tag">內嵌表單版 — Power by BSD Core</span></div>';
        html += '<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-back" onclick="switchView(\'single\')">← 返回精算核心</button></div>';
        html += '</div>';

        html += UI.renderFormatGuide();
        html += UI.renderGlobalConfig();
        html += UI.renderInlineForm();
        html += '<div id="A-ResultsWrap"></div>';

        html += '</div></div>';
        mount.innerHTML = html;

        initialized = true;
    }

    window.initAudit = initAudit;
    window.AuditEngine = { reset: function() { state.cases = [emptyCase()]; state.results = []; UI.refreshInlineForm(); UI.refreshResults(); } };

})();
