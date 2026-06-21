/**
 * ============================================================
 *  BSD 專屬應用系統 (BSD Sales Kit) — 眼睛超舒服模式 v4.0
 *  依賴：bsd-core.js, index.html (DOM)
 *  串接窗口：ComfortMode.init() / ComfortMode.exit()
 * ============================================================
 *  作者：今晚沒喝夠的小賈哥
 *  系統說明：此為業務單位自行獨立開發之應用系統，旨在最大化業務服務效能與實務應用分析能力。
 */
var ComfortMode = {
    data: { mode: 0, step: 0, msrp: '', amount: '', payType: '', terms: [], chargeRate: '', custRate: '', agentSub: '', dealerSub: '', payments: [] },
    
    init: function() {
        var isMobile = window.innerWidth <= 1024 || /Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent);
        if (!isMobile) { if(!confirm("此功能是為手機/平板設計的超大字體模式，在電腦上使用會佔滿螢幕，確定要繼續嗎？")) return; }
        document.getElementById('comfort-overlay').style.display = 'flex';
        this.resetData(); this.renderStep0();
    },
    resetData: function() {
        this.data = { mode: 0, step: 0, msrp: '', amount: '', payType: '', terms: [], chargeRate: '', custRate: '', agentSub: '', dealerSub: '', payments: [] };
        document.getElementById('comfort-stepper').innerHTML = '';
    },
    exit: function() { if(confirm("確定要離開舒適模式嗎？")) document.getElementById('comfort-overlay').style.display = 'none'; },

    updateStepper: function(stepIdx) {
        var container = document.getElementById('comfort-stepper');
        var d = this.data, stepsMap = [];
        stepsMap.push({idx:0, label:'模式', val: this.getModeLabel(d.mode)});
        stepsMap.push({idx:1, label:'建議售價', val: d.msrp ? (parseInt(d.msrp)/10000 + '萬') : ''});
        stepsMap.push({idx:2, label:'分期金額', val: d.amount ? (parseInt(d.amount)/10000 + '萬') : ''});
        stepsMap.push({idx:3, label:'付款結構', val: d.terms.length ? (d.terms.join('+') + '期') : ''});
        stepsMap.push({idx:4, label:'牌價利率', val: d.chargeRate ? (d.chargeRate + '%') : ''});
        if(d.mode !== 3) stepsMap.push({idx:5, label:'客戶利率', val: d.custRate ? (d.custRate + '%') : '未知'});
        stepsMap.push({idx:6, label:'總代補貼', val: d.agentSub > 0 ? d.agentSub : ''});
        if(d.mode !== 2) stepsMap.push({idx:7, label:'經銷補貼', val: d.dealerSub > 0 ? d.dealerSub : ''});
        stepsMap.push({idx:8, label:'月付內容', val: d.payments.length ? '已填' : ''});
        stepsMap.push({idx:9, label:'結果', val: ''});
        var html = '';
        stepsMap.forEach(function(s, i) {
            var status = ''; if(s.idx < stepIdx) status = 'done'; if(s.idx === stepIdx) status = 'active';
            html += '<div class="step-item ' + status + '"><div class="step-circle">' + (s.idx === 9 ? '★' : (i+1)) + '</div><div class="step-label">' + s.label + '</div><div class="step-data">' + s.val + '</div></div>';
            if(i < stepsMap.length - 1) html += '<div class="step-line ' + status + '"></div>';
        });
        container.innerHTML = html;
        setTimeout(function() { var active = container.querySelector('.active'); if(active) active.scrollIntoView({behavior:'smooth', inline:'center'}); }, 100);
    },
    getModeLabel: function(m) { if(m===1) return '月付款'; if(m===2) return '補貼'; if(m===3) return '回推'; return ''; },

    renderStep0: function() {
        this.data.step = 0; this.updateStepper(0);
        var html = '<div class="c-title">請問您今天要算什麼？</div><div class="c-btn-group" style="flex-direction: column;"><button class="c-btn-option" onclick="ComfortMode.setMode(1)">💰 我要算月付款</button><button class="c-btn-option" onclick="ComfortMode.setMode(2)">🏢 我要算經銷商補貼息/退利率佣</button><button class="c-btn-option" onclick="ComfortMode.setMode(3)">🔄 我要回推客戶利率</button></div>';
        document.getElementById('comfort-question-area').innerHTML = html;
    },
    setMode: function(mode) { this.data.mode = mode; this.nextStep(); },
    nextStep: function() { this.data.step++; this.renderRouter(this.data.step); },
    prevStep: function() { if(this.data.step <= 0) return; this.data.step--; if(this.data.step === 0) this.renderStep0(); else this.renderRouter(this.data.step); },

    renderRouter: function(step) {
        this.updateStepper(step); var d = this.data;
        switch(step) {
            case 1: this.renderMSRP(); break;
            case 2: this.renderAmount(); break;
            case 3: this.renderPayType(); break;
            case 4: this.renderChargeRate(); break;
            case 5: if(d.mode === 3) this.nextStep(); else this.renderCustRate(); break;
            case 6: this.renderAgentSub(); break;
            case 7: if(d.mode === 2) this.nextStep(); else this.renderDealerSub(); break;
            case 8: this.renderPayments(); break;
            case 9: this.renderDashboard(); break;
        }
    },

    renderMSRP: function() {
        var mb = '<div class="c-mult-btns"><button class="c-mult-btn" onclick="multField(\'inp-msrp\',10000)">×10,000</button><button class="c-mult-btn" onclick="multField(\'inp-msrp\',1000)">×1,000</button><button class="c-mult-btn" onclick="multField(\'inp-msrp\',100)">×100</button><button class="c-mult-btn c-del" onclick="delDigit(\'inp-msrp\')">←</button></div>';
        this.renderHTML('<div class="c-title">建議售價</div><div class="c-subtitle">非必填，僅供參考</div><input type="number" id="inp-msrp" class="c-input" placeholder="請輸入金額" value="' + this.data.msrp + '" onkeydown="if(event.key===\'Enter\') ComfortMode.saveMSRP()">' + mb + '<button class="c-btn-submit" onclick="ComfortMode.saveMSRP()">送出 / 略過</button>', 'inp-msrp');
    },
    saveMSRP: function() { this.data.msrp = document.getElementById('inp-msrp').value; this.nextStep(); },

    renderAmount: function() {
        var mb = '<div class="c-mult-btns"><button class="c-mult-btn" onclick="multField(\'inp-amt\',10000)">×10,000</button><button class="c-mult-btn" onclick="multField(\'inp-amt\',1000)">×1,000</button><button class="c-mult-btn" onclick="multField(\'inp-amt\',100)">×100</button><button class="c-mult-btn c-del" onclick="delDigit(\'inp-amt\')">←</button></div>';
        this.renderHTML('<div class="c-title">分期金額</div><input type="number" id="inp-amt" class="c-input" placeholder="例如: 1000000" value="' + this.data.amount + '" onkeydown="if(event.key===\'Enter\') ComfortMode.saveAmount()">' + mb + '<button class="c-btn-submit" onclick="ComfortMode.saveAmount()">送出</button>', 'inp-amt');
    },
    saveAmount: function() { var val = document.getElementById('inp-amt').value; if(!val || val <= 0) return this.showError("金額必須大於0"); this.data.amount = val; this.nextStep(); },

    renderPayType: function() {
        this.renderHTML('<div class="c-title">付款方式</div><div class="c-btn-group" style="margin-bottom:20px;"><button class="c-btn-option" id="btn-type-c" onclick="ComfortMode.selectType(\'classic\')">均攤 (Classic)</button><button class="c-btn-option" id="btn-type-b" onclick="ComfortMode.selectType(\'balloon\')">尾款 (Balloon)</button><button class="c-btn-option" id="btn-type-s" onclick="ComfortMode.selectType(\'step\')">階段 (Step)</button></div><div id="terms-container"></div><button class="c-btn-submit" onclick="ComfortMode.saveTerms()">送出</button>');
        if(this.data.payType) this.selectType(this.data.payType);
    },
    selectType: function(type) {
        this.data.payType = type;
        ['c','b','s'].forEach(function(k) { var el = document.getElementById('btn-type-' + k); if(el) el.classList.remove('selected'); });
        document.getElementById('btn-type-' + type[0]).classList.add('selected');
        var inputs = '';
        if(type === 'classic') {
            var qt = '<div class="c-quick-terms">' + [[24],[36],[48],[60],[72],[84],[96],[100]].map(function(v){ return '<button class="c-quick-term" onclick="ComfortMode.cSetTerms(' + JSON.stringify(v) + ',this)">' + v[0] + ' 期</button>'; }).join('') + '</div>';
            inputs = qt + '<input type="number" class="c-input term-input" placeholder="期數 (例如 60)" value="60">';
        }
        if(type === 'balloon') {
            var qt = '<div class="c-quick-terms">' + [[47,1],[59,1],[71,1],[83,1]].map(function(v){ return '<button class="c-quick-term" onclick="ComfortMode.cSetTerms(' + JSON.stringify(v) + ',this)">' + v[0] + '+' + v[1] + '</button>'; }).join('') + '</div>';
            inputs = qt + '<input type="number" class="c-input term-input" placeholder="期數" style="margin-bottom:10px;"><input type="number" class="c-input term-input" placeholder="尾款期數 (通常為1)" value="1">';
        }
        if(type === 'step') {
            var qt = '<div class="c-quick-terms">' + [[12,47,1],[12,12,35,1],[12,59,1],[12,12,47,1],[12,24,35,1],[12,71,1]].map(function(v){ return '<button class="c-quick-term" onclick="ComfortMode.cSetTerms(' + JSON.stringify(v) + ',this)">' + v.join('+') + '</button>'; }).join('') + '</div>';
            inputs = qt;
            for(var i=0; i<5; i++) inputs += '<input type="number" class="c-input term-input" placeholder="第' + (i+1) + '段期數" style="width:45%; margin:2%;">';
        }
        document.getElementById('terms-container').innerHTML = inputs;
    },
    saveTerms: function() {
        if(!this.data.payType) return this.showError("請選擇付款方式");
        var inputs = document.querySelectorAll('.term-input'), terms = [];
        inputs.forEach(function(inp) { if(inp.value && inp.value > 0) terms.push(inp.value); });
        if(terms.length === 0) return this.showError("請至少輸入一個期數");
        this.data.terms = terms; this.nextStep();
    },

    renderChargeRate: function() {
        var rg = this.cRateGrid('inp-charge');
        this.renderHTML('<div class="c-title">牌價利率 (%)</div>' + rg + '<input type="number" id="inp-charge" class="c-input" inputmode="decimal" placeholder="例如: 3.5" value="' + this.data.chargeRate + '" onkeydown="if(event.key===\'Enter\') ComfortMode.saveCharge()"><button class="c-btn-submit" onclick="ComfortMode.saveCharge()">送出</button>', 'inp-charge');
    },
    saveCharge: function() { var val = document.getElementById('inp-charge').value; if(!val) return this.showError("請輸入牌價利率"); this.data.chargeRate = val; this.nextStep(); },

    renderCustRate: function() {
        var isRequired = (this.data.mode === 2);
        var rg = this.cRateGrid('inp-cust');
        var html = '<div class="c-title">客戶利率 (%)</div><div class="c-subtitle">' + (isRequired ? '<span style="color:red">請輸入利率，或點擊下方按鈕略過</span>' : '若未填則等於牌價利率') + '</div>' + rg + '<input type="number" id="inp-cust" class="c-input" inputmode="decimal" placeholder="例如: 2.99" value="' + this.data.custRate + '" onkeydown="if(event.key===\'Enter\') ComfortMode.saveCust()"><button class="c-btn-submit" onclick="ComfortMode.saveCust()">送出</button>';
        if(isRequired) html += '<button class="c-btn c-btn-secondary" style="margin-top:10px; width:80%;" onclick="ComfortMode.skipCust()">略過 (由月付款反推)</button>';
        this.renderHTML(html, 'inp-cust');
    },
    saveCust: function() { var val = document.getElementById('inp-cust').value; if(this.data.mode === 2 && !val) return this.showError("請輸入利率或點擊略過"); if(!val && this.data.mode === 1) val = this.data.chargeRate; this.data.custRate = val; this.nextStep(); },
    skipCust: function() { this.data.custRate = ''; this.nextStep(); },

    renderAgentSub: function() {
        this.renderHTML('<div class="c-title">總代理補貼款</div><div class="c-subtitle">若無請填 0</div><input type="number" id="inp-asub" class="c-input" placeholder="金額" value="' + this.data.agentSub + '" onkeydown="if(event.key===\'Enter\') ComfortMode.saveAgentSub()"><button class="c-btn-submit" onclick="ComfortMode.saveAgentSub()">送出</button>', 'inp-asub');
    },
    saveAgentSub: function() { this.data.agentSub = document.getElementById('inp-asub').value || 0; this.nextStep(); },

    renderDealerSub: function() {
        this.renderHTML('<div class="c-title">經銷商補貼款</div><div class="c-subtitle">若無請填 0</div><input type="number" id="inp-dsub" class="c-input" placeholder="金額" value="' + this.data.dealerSub + '" onkeydown="if(event.key===\'Enter\') ComfortMode.saveDealerSub()"><button class="c-btn-submit" onclick="ComfortMode.saveDealerSub()">送出</button>', 'inp-dsub');
    },
    saveDealerSub: function() { this.data.dealerSub = document.getElementById('inp-dsub').value || 0; this.nextStep(); },

    renderPayments: function() {
        var inputsHTML = '', count = this.data.terms.length, mode = this.data.mode, hasCustRate = (this.data.custRate !== '');
        var guide = "";
        if (mode === 2) { guide = hasCustRate ? "您已鎖定客戶利率，請<span style='color:red'>保留一個欄位空白</span>讓系統計算月付款。" : "您選擇由月付款反推，請<span style='color:red'>填寫所有欄位</span>。"; }
        else if (mode === 3) { guide = "計算利率模式，請<span style='color:red'>填寫所有欄位</span>。"; }
        else { guide = "若為均攤可全空，若有尾款請填寫已知部分。"; }
        for(var i=0; i<count; i++) { inputsHTML += '<div style="text-align:left; width:80%; margin-top:10px;">第 ' + (i+1) + ' 筆月付款 (' + this.data.terms[i] + '期):</div><input type="number" class="c-input pay-input" data-idx="' + i + '" placeholder="輸入金額" style="margin-bottom:5px;">'; }
        this.renderHTML('<div class="c-title">月付款設定</div><div class="c-subtitle">' + guide + '</div><div style="max-height: 40vh; overflow-y:auto; width:100%; display:flex; flex-direction:column; align-items:center;">' + inputsHTML + '</div><button class="c-btn-submit" onclick="ComfortMode.savePayments()">送出並計算</button>');
    },
    savePayments: function() {
        var inputs = document.querySelectorAll('.pay-input'), pays = [], emptyCount = 0;
        inputs.forEach(function(inp) { pays.push(inp.value); if(!inp.value) emptyCount++; });
        var mode = this.data.mode, hasCustRate = (this.data.custRate !== '');
        if (mode === 2) { if (hasCustRate) { if(emptyCount === 0) return this.showError("既鎖定利率又填滿月付款，系統無法計算。請清空一欄。"); } else { if(emptyCount > 0) return this.showError("反推模式下，所有月付款都必須輸入！"); } }
        if (mode === 3) { if(emptyCount > 0) return this.showError("回推利率模式下，所有月付款都必須輸入！"); }
        this.data.payments = pays;
        this.syncToOriginalCore(false);
        smartSolve();
        this.nextStep();
    },

    toggleSubsidyDisplay: function() {
        var isChecked = document.getElementById('show-dealer-sub').checked;
        var subRow = document.getElementById('dash-sub-row');
        if(subRow) subRow.style.display = isChecked ? 'block' : 'none';
    },

    renderDashboard: function() {
        var d = this.data;
        var resValText = document.getElementById('res-val').innerText;
        var resValColor = document.getElementById('res-val').style.color;
        var resTotal = document.getElementById('d-total-pmt').innerText;
        var resIRR_raw = document.getElementById('d-crate').innerText;
        var displayIRR = resIRR_raw;
        if(resIRR_raw.includes('%')) { var num = parseFloat(resIRR_raw.replace('%','')); if(!isNaN(num)) displayIRR = roundTo2(num) + '%'; }
        var fullSummary = document.getElementById('d-summary').innerHTML;
        var heroLabel = "月付款 / 完整結構", heroValue = fullSummary;
        var dynamicLabel = "經銷商補貼";
        if (resValColor === 'rgb(22, 163, 74)' || resValColor === '#16a34a') dynamicLabel = "退利率佣";
        if(d.mode === 2) { heroLabel = dynamicLabel; heroValue = resValText; }
        else if(d.mode === 3) { heroLabel = "客戶實際利率 (IRR)"; heroValue = displayIRR; }

        var html = '<div class="dash-card-pro"><div class="pro-header"><div class="pro-title">試算結果報告</div><div class="pro-tag">BSD Core Verified</div></div><div class="pro-hero"><div class="pro-hero-label">' + heroLabel + '</div><div class="pro-hero-val" style="' + (d.mode === 2 ? 'color:' + resValColor : '') + '">' + heroValue + '</div><div id="dash-sub-row" style="display:none; margin-top:15px; border-top:1px dashed rgba(255,255,255,0.3); padding-top:10px;"><div class="pro-hero-label">' + dynamicLabel + ' (核心運算)</div><div class="pro-val" style="font-size:1.5rem; color:' + resValColor + '">' + resValText + '</div></div></div><div class="pro-grid"><div class="pro-item"><div class="pro-label">分期金額</div><div class="pro-val">$' + parseInt(d.amount).toLocaleString() + '</div></div><div class="pro-item"><div class="pro-label">建議售價</div><div class="pro-val">$' + (d.msrp ? parseInt(d.msrp).toLocaleString() : '-') + '</div></div><div class="pro-item wide"><div class="pro-label">完整月付款結構</div><div class="pro-val" style="font-size:1rem; line-height:1.4;">' + fullSummary + '</div></div><div class="pro-item"><div class="pro-label">期數結構</div><div class="pro-val">' + d.terms.join('+') + ' 期</div></div><div class="pro-item"><div class="pro-label">付款方式</div><div class="pro-val" style="text-transform:capitalize">' + d.payType + '</div></div><div class="pro-item"><div class="pro-label">總付款</div><div class="pro-val">' + resTotal + '</div></div><div class="pro-item"><div class="pro-label">客戶利率</div><div class="pro-val">' + displayIRR + '</div></div></div><div class="pro-footer">本試算結果僅供參考，本公司保留最終審核及解釋之權利。<br>請截圖保存或點擊下方按鈕離開。</div></div><div class="toggle-container"><label class="toggle-switch"><input type="checkbox" id="show-dealer-sub" onchange="ComfortMode.toggleSubsidyDisplay()"><span class="slider"></span>顯示補貼/退佣</label></div><button class="c-btn-submit" style="margin-top:10px;" onclick="ComfortMode.finish()">✅ 完成並離開</button><button class="c-btn-restart" style="margin-top:10px; width:80%;" onclick="ComfortMode.init()">🔄 重新計算</button>';
        document.getElementById('comfort-question-area').innerHTML = html;
    },

    finish: function() { document.getElementById('comfort-overlay').style.display = 'none'; },

    syncToOriginalCore: function(showAlert) {
        if (showAlert === undefined) showAlert = true;
        var d = this.data;
        document.getElementById('MSRP').value = d.msrp;
        document.getElementById('B20').value = d.amount;
        document.getElementById('B4').value = d.chargeRate;
        var rateLock = document.getElementById('rateLock');
        if(d.custRate !== '' && d.custRate !== null) { document.getElementById('CRate').value = d.custRate; rateLock.checked = true; }
        else { rateLock.checked = false; document.getElementById('CRate').value = ''; }
        if (d.agentSub && parseFloat(d.agentSub) > 0) { document.getElementById('SubAgent').value = d.agentSub; document.getElementById('agentLock').checked = true; }
        else { document.getElementById('SubAgent').value = 0; document.getElementById('agentLock').checked = false; }
        document.getElementById('SubDealer').value = d.dealerSub;
        document.getElementById('dealerLock').checked = (parseFloat(d.dealerSub) > 0);
        var pMs = document.querySelectorAll('.p-m'), pVs = document.querySelectorAll('.p-v');
        pMs.forEach(function(i) { i.value = ''; }); pVs.forEach(function(i) { i.value = ''; });
        for(var i=0; i < d.terms.length; i++) { if(pMs[i]) pMs[i].value = d.terms[i]; if(pVs[i] && d.payments[i]) pVs[i].value = d.payments[i]; }
        updateUI();
        if(showAlert) alert("數據已帶入核心！");
    },

    cRateGrid: function(id) {
        var rates = [0, 0.99, 1.68, 1.88, 2.5, 2.68, 2.88, 2.99, 3.00, 3.3, 3.5, 3.75, 3.99, 4.13, 4.23, 4.49, 4.75, 4.99, 5.25, 5.49];
        var html = '<div class="c-rate-grid">';
        rates.forEach(function(r) { html += '<button class="c-rate-btn" onclick="ComfortMode.cSetRate(\'' + id + '\',' + r + ')">' + r + '%</button>'; });
        return html + '</div>';
    },
    cSetRate: function(id, val) { document.getElementById(id).value = val; },
    cSetTerms: function(vals, btn) {
        var inputs = document.querySelectorAll('.term-input');
        inputs.forEach(function(inp, i) { inp.value = vals[i] !== undefined ? vals[i] : ''; });
        document.querySelectorAll('.c-quick-term').forEach(function(b) { b.classList.remove('selected'); });
        if(btn) btn.classList.add('selected');
    },

    renderHTML: function(html, focusId) {
        document.getElementById('comfort-question-area').innerHTML = html;
        document.getElementById('comfort-error-msg').innerText = '';
        if(focusId && !(/Android|iPhone/i.test(navigator.userAgent))) { setTimeout(function() { document.getElementById(focusId).focus(); }, 100); }
    },
    showError: function(msg) { document.getElementById('comfort-error-msg').innerText = msg; }
};
