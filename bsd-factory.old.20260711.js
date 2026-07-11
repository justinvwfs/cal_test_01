/**
 * ============================================================
 *  BSD 專屬應用系統 (BSD Sales Kit) — 葵花寶典工廠 v4.0
 *  依賴：bsd-core.js (BSDCore)
 *  串接窗口：initFactory(), generateMatrix(), exportToExcel()
 *  下游擴展：可加掛 bsd-factory-ext.js → TBD
 * ============================================================
 *  作者：今晚沒喝夠的小賈哥
 *  系統說明：此為業務單位自行獨立開發之應用系統，旨在最大化業務服務效能與實務應用分析能力。
 */
(function() {
    'use strict';

    // === 初始化：注入 HTML 到掛載點 ===
    function initFactory() {
        var mount = document.getElementById('factory-mount-point');
        if (!mount) return;
        mount.innerHTML = getFactoryHTML();
        syncFactoryLock();
        buildFactoryPresets();
    }

    function getFactoryHTML() {
        return '<div class="glass-card">' +
            '<div class="section-title"><div>葵花寶典批量生產小工廠 <span class="author-tag">Power by BSD Core</span></div>' +
            '<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">' +
            '<button class="btn btn-excel" onclick="exportToExcel()">📗 Excel</button>' +
            '<button class="btn btn-pdf" onclick="exportFactoryPDF()">📕 PDF</button>' +
            '<button class="btn btn-export" onclick="window.print()">🖨️ 列印</button>' +
            '<button class="btn btn-mail" onclick="mailFactory()">✉️ 寄送</button>' +
            '<button class="btn btn-copy" onclick="copyFactoryReport()">📋 複製</button>' +
            '<button class="btn btn-back" onclick="switchView(\'single\')">返回精算核心</button></div></div>' +
            '<div class="factory-config">' +
            '<div class="input-group"><label><span class="zt">牌價利率 %</span>&nbsp;<span class="en">Charge Rate</span></label><input type="number" id="F-ChargeRate" value="5.0" step="0.01" oninput="syncFactoryLock()"><div class="rate-presets" id="fpresets-charge"></div></div>' +
            '<div class="input-group"><label><span class="zt">客戶利率 %</span>&nbsp;<span class="en">Cust. Rate</span></label><input type="number" id="F-CustRate" value="5.0" step="0.01" disabled style="background:#e2e8f0;"><div class="rate-presets" id="fpresets-cust"></div></div>' +
            '<div class="input-group"><label>客戶利率優先鎖</label><div class="check-wrap" style="height:42px; border:1px solid #cbd5e1; border-radius:6px; background:white; padding:0 10px;"><input type="checkbox" id="F-PriorityLock" onchange="syncFactoryLock()"><span style="font-size:12px;">啟用 (鎖定利率)</span></div></div>' +
            '<div class="input-group"><label>總代理補貼 (優先扣除)</label><input type="number" id="F-SubAgent" value="0"></div>' +
            '<div class="input-group"><label id="F-SubDealer-Label">經銷商補貼</label><input type="number" id="F-SubDealer" value="0" placeholder="0=自動消D"></div></div>' +
            '<div class="factory-range">' +
            '<div class="input-group"><label>起始 (萬)</label><input type="number" id="R-Start" value="60"></div>' +
            '<div class="input-group"><label>結束 (萬)</label><input type="number" id="R-End" value="100"></div>' +
            '<div class="input-group"><label>區間 (萬)</label><input type="number" id="R-Step" value="5"></div>' +
            '<button class="btn btn-super-gen" onclick="generateMatrix()" style="width:100%; background:linear-gradient(135deg, #001e50 0%, #004e92 100%); color:white; padding:16px; font-size:18px; border-radius:8px; box-shadow:0 4px 15px rgba(0,78,146,0.4); text-shadow:0 1px 2px rgba(0,0,0,0.3);">一鍵生成葵花寶典</button></div>' +
            '<div class="term-selector">' +
            '<label class="term-check"><input type="checkbox" value="12">12期</label>' +
            '<label class="term-check"><input type="checkbox" value="24" checked>24期</label>' +
            '<label class="term-check"><input type="checkbox" value="36" checked>36期</label>' +
            '<label class="term-check"><input type="checkbox" value="48" checked>48期</label>' +
            '<label class="term-check"><input type="checkbox" value="60" checked>60期</label>' +
            '<label class="term-check"><input type="checkbox" value="72">72期</label>' +
            '<label class="term-check"><input type="checkbox" value="84">84期</label>' +
            '<label class="term-check"><input type="checkbox" value="96">96期</label>' +
            '<label class="term-check"><input type="checkbox" value="100">100期</label></div>' +
            '<div class="sf-table-container"><table class="sf-table" id="sf-matrix"><thead><tr><th class="row-header">分期金額</th></tr></thead><tbody></tbody></table></div>' +
            '<div style="margin-top:30px; border-top:4px solid var(--vw-blue); padding-top:20px;">' +
            '<div class="section-title">手動添加階段式組合 (無限累加)</div>' +
            '<div class="manual-input-area" style="background:#fff; padding:20px; border-radius:10px; border:1px solid #cbd5e1; margin-bottom:20px; box-shadow:0 4px 15px rgba(0,0,0,0.03);">' +
            '<div style="display:grid; grid-template-columns:2fr 1fr 1fr; gap:15px; margin-bottom:15px;">' +
            '<div class="input-group"><label>分期金額 (完整數字)</label><input type="number" id="M-Amt" placeholder="例如: 1325998" style="background:#f8fafc; border-color:#001e50;"></div>' +
            '<div class="input-group"><label>Charge %</label><input type="number" id="M-ChargeRate" step="0.01"></div>' +
            '<div class="input-group"><label>Customer %</label><input type="number" id="M-CustRate" step="0.01" disabled style="background:#e2e8f0;"></div></div>' +
            '<div style="background:#f8fafc; border:1px dashed #cbd5e1; border-radius:8px; padding:10px; margin-bottom:15px;">' +
            '<div style="font-size:11px; font-weight:bold; color:#64748b; margin-bottom:5px;">期數與金額設定 (金額空白 = 自動計算)</div>' +
            '<div style="display:flex; gap:8px; overflow-x:auto; padding-bottom:5px;">' +
            '<div class="phase-box"><label>1(期)</label><input type="number" class="mp-m"><label>額</label><input type="number" class="mp-v"></div>' +
            '<div class="phase-box"><label>2(期)</label><input type="number" class="mp-m"><label>額</label><input type="number" class="mp-v"></div>' +
            '<div class="phase-box"><label>3(期)</label><input type="number" class="mp-m"><label>額</label><input type="number" class="mp-v"></div>' +
            '<div class="phase-box"><label>4(期)</label><input type="number" class="mp-m"><label>額</label><input type="number" class="mp-v"></div>' +
            '<div class="phase-box"><label>5(期)</label><input type="number" class="mp-m"><label>額</label><input type="number" class="mp-v"></div></div></div>' +
            '<button class="btn btn-gen-row" onclick="addManualResultRow()" style="background:#10b981; color:white; padding:12px; font-size:15px; width:100%; box-shadow:0 2px 8px rgba(16,185,129,0.2);">生成並加入清單</button></div>' +
            '<div class="sf-table-container"><table class="sf-table result-list-table"><thead><tr><th>分期金額</th><th>付款明細</th><th style="width:80px;">客戶利率</th><th style="width:160px;">補貼狀況</th><th style="width:140px;">操作</th></tr></thead><tbody id="manual-results-body"></tbody></table></div></div></div>';
    }

    // --- Factory Style additions ---
    var style = document.createElement('style');
    style.textContent = '.factory-config{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;background:white;padding:15px;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:15px;}.factory-range{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:15px;align-items:end;}.term-selector{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0;}.term-check{display:flex;align-items:center;gap:4px;background:white;padding:6px 12px;border-radius:20px;border:1px solid #cbd5e1;font-size:13px;font-weight:bold;cursor:pointer;transition:0.2s;}.term-check:hover{background:#f1f5f9;}.res-cell{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;}.res-pmt{font-weight:900;font-size:15px;color:var(--text);}.res-rate{font-size:11px;color:var(--vw-light-blue);font-weight:bold;}.res-sub{font-size:10px;font-weight:bold;line-height:1.3;text-align:center;display:flex;flex-direction:column;}.sf-table th.row-header{position:sticky;left:0;z-index:11;background:var(--vw-blue);border-right:2px solid #334155;}.sf-table td.row-header{position:sticky;left:0;z-index:9;background:#f8fafc;font-weight:900;border-right:2px solid #cbd5e1;color:var(--vw-blue);}.manual-input-area .phase-box{display:flex;flex-direction:column;min-width:70px;background:white;padding:5px;border-radius:6px;border:1px solid #e2e8f0;}.manual-input-area .phase-box label{font-size:10px;color:#64748b;font-weight:bold;text-align:center;margin-bottom:3px;}.manual-input-area .phase-box input{padding:6px;text-align:center;font-size:13px;border:1px solid #cbd5e1;border-radius:4px;}.result-list-table th{background:#334155;color:white;padding:12px;}.result-list-table td:first-child{font-size:16px;font-weight:900;color:var(--vw-blue);min-width:120px;text-align:left;padding-left:15px;}.result-list-table td{font-size:13px;padding:12px;vertical-align:middle;}.detail-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}.detail-item{background:#f1f5f9;padding:4px 10px;border-radius:4px;font-weight:bold;color:#334155;font-size:12px;white-space:nowrap;border:1px solid #e2e8f0;}@media(max-width:768px){.factory-range{grid-template-columns:1fr 1fr;}.factory-range .btn-super-gen{grid-column:span 2;}}';
    document.head.appendChild(style);

    // --- syncFactoryLock ---
    window.syncFactoryLock = function() {
        var el = document.getElementById('F-PriorityLock');
        if (!el) return;
        var isLocked = el.checked;
        var cRateInput = document.getElementById('F-CustRate');
        var dSubInput = document.getElementById('F-SubDealer');
        var mChargeInput = document.getElementById('M-ChargeRate');
        var mCustInput = document.getElementById('M-CustRate');
        var fChargeVal = document.getElementById('F-ChargeRate').value;
        if(isLocked) {
            cRateInput.disabled = false; cRateInput.style.background = "#fff";
            dSubInput.disabled = true; dSubInput.value = ""; dSubInput.placeholder = "鎖定模式不輸入"; dSubInput.style.background = "#e2e8f0";
            mCustInput.disabled = false; mCustInput.style.background = "#fff";
            if(!mChargeInput.value) mChargeInput.value = fChargeVal;
            if(!mCustInput.value) mCustInput.value = fChargeVal;
        } else {
            cRateInput.disabled = true; cRateInput.style.background = "#e2e8f0"; cRateInput.value = fChargeVal;
            dSubInput.disabled = false; dSubInput.placeholder = "輸入金額 (0=消D)"; dSubInput.style.background = "#fff";
            mCustInput.disabled = true; mCustInput.style.background = "#e2e8f0"; mCustInput.value = mChargeInput.value || fChargeVal;
            if(!mChargeInput.value) mChargeInput.value = fChargeVal;
        }
    };

    // --- generateMatrix ---
    window.generateMatrix = function() {
        var start = parseInt(document.getElementById('R-Start').value) * 10000;
        var end = parseInt(document.getElementById('R-End').value) * 10000;
        var step = parseInt(document.getElementById('R-Step').value) * 10000;
        var terms = Array.from(document.querySelectorAll('.term-selector input:checked')).map(function(c) { return parseInt(c.value); });
        if(terms.length===0) return alert("請選擇期數");
        var thead = document.querySelector('#sf-matrix thead tr');
        thead.innerHTML = '<th class="row-header">分期金額</th>';
        terms.forEach(function(t) { thead.innerHTML += '<th>' + t + ' 期</th>'; });
        var tbody = document.querySelector('#sf-matrix tbody'); tbody.innerHTML = '';
        for(var amt=start; amt<=end; amt+=step) {
            var tr = document.createElement('tr');
            tr.innerHTML = '<td class="row-header">' + (amt/10000) + ' 萬</td>';
            terms.forEach(function(t) {
                var cellData = calcFactoryCell(amt, t, null, null, null);
                var td = document.createElement('td');
                td.innerHTML = renderCellHTML(amt, t, cellData.pmt, null, null);
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        }
    };

    // --- calcFactoryCell (UI bridge → BSDCore) ---
    window.calcFactoryCell = function(loan, term, overridePmt, manualCharge, manualCust) {
        var globalCharge = parseFloat(document.getElementById('F-ChargeRate').value);
        var globalCust = parseFloat(document.getElementById('F-CustRate').value);
        var lockMode = document.getElementById('F-PriorityLock').checked;
        var agentMax = parseFloat(document.getElementById('F-SubAgent').value)||0;
        var dealerFixed = parseFloat(document.getElementById('F-SubDealer').value)||0;
        var result = BSDCore.calcFactoryCellCore({
            loan: loan, term: term, overridePmt: overridePmt,
            chargeRate: (manualCharge !== null) ? manualCharge : globalCharge,
            custRate: (manualCust !== null) ? manualCust : globalCust,
            lockMode: lockMode, agentMax: agentMax, dealerFixed: dealerFixed
        });
        return { pmt: result.pmt, chargeRateM: result.chargeRateM };
    };

    // --- renderCellHTML ---
    window.renderCellHTML = function(loan, term, pmt, manualCharge, manualCust) {
        var globalCharge = parseFloat(document.getElementById('F-ChargeRate').value);
        var chargeRateVal = (manualCharge !== null) ? manualCharge : globalCharge;
        var chargeM = chargeRateVal/100/12;
        var agentMax = parseFloat(document.getElementById('F-SubAgent').value)||0;
        var flows = []; for(var i=0;i<term;i++) flows.push(pmt);
        var irr = BSDCore.solveIRR(-loan, flows); if(irr<0) irr=0;
        var rate = (irr*1200).toFixed(2);
        var totalS = BSDCore.calculateActualS(loan, chargeM, flows);
        var subNeeded = (totalS<0)?Math.abs(totalS):0;
        var commission = (totalS>0)?totalS:0;
        var agentUsed = Math.min(subNeeded, agentMax);
        var dealerUsed = subNeeded - agentUsed;
        var unusedAgent = agentMax - agentUsed;
        var showAgentActual = (agentMax>0&&unusedAgent>1000);
        var subStr = "";
        if (commission > 0) { subStr = '<span class="res-sub" style="color:green">產生退利率佣：$' + commission.toLocaleString() + '</span>'; }
        else { var parts = []; if(dealerUsed>0) parts.push('<span style="color:red">經銷商補貼：$' + dealerUsed.toLocaleString() + '</span>'); if(showAgentActual) parts.push('<span style="color:var(--agent-color)">總代理補貼實際使用：$' + agentUsed.toLocaleString() + '</span>'); subStr = parts.length>0 ? '<span class="res-sub">' + parts.join('<br>') + '</span>' : '<span class="res-sub" style="height:14px; display:block;"></span>'; }
        return '<div class="res-cell"><span class="res-pmt" style="font-size:15px; color:#001e50;">$' + pmt.toLocaleString() + '</span><span class="res-rate">' + rate + '%</span>' + subStr + '<button class="btn btn-rev" onclick="reviseMatrixCell(this, ' + loan + ', ' + term + ', ' + manualCharge + ', ' + manualCust + ')">校訂</button></div>';
    };

    window.reviseMatrixCell = function(btn, loan, term, mCharge, mCust) {
        var parent = btn.parentElement;
        var pmtText = parent.querySelector('.res-pmt').innerText.replace('$','').replace(/,/g,'');
        var mc = mCharge === null ? 'null' : mCharge; var mu = mCust === null ? 'null' : mCust;
        parent.innerHTML = '<input type="number" value="' + pmtText + '" style="width:80px; text-align:center; border:2px solid var(--warning); border-radius:4px;" onblur="saveMatrixRevise(this, ' + loan + ', ' + term + ', ' + mc + ', ' + mu + ')" onkeydown="if(event.key===\'Enter\') this.blur()"><span style="font-size:10px; color:gray">輸入後離開</span>';
        parent.querySelector('input').focus();
    };

    window.saveMatrixRevise = function(input, loan, term, mCharge, mCust) {
        var newPmt = parseInt(input.value); if(!newPmt) return;
        var td = input.parentElement.parentElement;
        var realMC = (mCharge === 'null' || isNaN(mCharge)) ? null : mCharge;
        var realMU = (mCust === 'null' || isNaN(mCust)) ? null : mCust;
        td.innerHTML = renderCellHTML(loan, term, newPmt, realMC, realMU);
    };

    // --- Manual Row ---
    window.addManualResultRow = function() {
        var loan = parseFloat(document.getElementById('M-Amt').value);
        if(!loan) return alert("請輸入分期金額");
        var mCharge = parseFloat(document.getElementById('M-ChargeRate').value);
        var mCust = parseFloat(document.getElementById('M-CustRate').value);
        if(isNaN(mCharge) || isNaN(mCust)) return alert("請確認利率欄位");
        var phases = [];
        document.querySelectorAll('.manual-input-area .phase-box').forEach(function(box) {
            var inputs = box.querySelectorAll('input');
            var m = parseInt(inputs[0].value)||0;
            var v = inputs[1].value === "" ? null : parseFloat(inputs[1].value);
            if(m>0) phases.push({ m: m, v: v, isAuto: (v===null) });
        });
        if(phases.length===0) return alert("請輸入至少一組期數");
        var res = calcManualPhases(loan, phases, null, mCharge, mCust);
        var tbody = document.getElementById('manual-results-body');
        var rowId = 'mr-' + Date.now();
        var tr = document.createElement('tr'); tr.id = rowId;
        tr.innerHTML = renderManualRowHTML(loan, res, phases, rowId, mCharge, mCust);
        tbody.appendChild(tr);
        document.getElementById('M-Amt').value = '';
        document.querySelectorAll('.manual-input-area .phase-box').forEach(function(box) { box.querySelectorAll('input').forEach(function(i) { i.value=''; }); });
    };

    window.calcManualPhases = function(loan, phases, overridePmt, mCharge, mCust) {
        var lockMode = document.getElementById('F-PriorityLock').checked;
        var agentMax = parseFloat(document.getElementById('F-SubAgent').value)||0;
        var dealerFixed = parseFloat(document.getElementById('F-SubDealer').value)||0;
        var result = BSDCore.calcManualPhasesCore({
            loan: loan, phases: phases, overridePmt: overridePmt,
            chargeRate: mCharge, custRate: mCust,
            lockMode: lockMode, agentMax: agentMax, dealerFixed: dealerFixed
        });
        // Convert details to HTML format
        var detailsHTML = result.details.map(function(d) { return '<span class="detail-item">' + d.from + '-' + d.to + '期: $' + d.value.toLocaleString() + '</span>'; });
        return { rate: result.rate.toFixed(2), dealerUsed: result.dealerUsed, agentUsed: result.agentUsed, commission: result.commission, details: detailsHTML, flows: result.flows, autoPmt: result.autoPmt };
    };

    window.renderManualRowHTML = function(loan, res, phases, rowId, mCharge, mCust) {
        var phasesJson = JSON.stringify(phases).replace(/"/g, '&quot;');
        var agentMax = parseFloat(document.getElementById('F-SubAgent').value)||0;
        var unusedAgent = agentMax - res.agentUsed; var showAgentActual = (agentMax>0&&unusedAgent>1000);
        var subStr = "";
        if (res.commission > 0) { subStr = '<span style="color:green; font-weight:bold;">產生退利率佣：$' + res.commission.toLocaleString() + '</span>'; }
        else { var parts = []; if(res.dealerUsed>0) parts.push('<div style="color:red; font-weight:bold;">經銷商補貼：$' + res.dealerUsed.toLocaleString() + '</div>'); if(showAgentActual) parts.push('<div style="color:var(--agent-color); font-weight:bold;">總代理補貼實際使用：$' + res.agentUsed.toLocaleString() + '</div>'); subStr = parts.join(''); }
        return '<td>' + loan.toLocaleString() + '</td><td><div class="detail-row">' + res.details.join('') + '</div></td><td><b>' + res.rate + '%</b></td><td>' + subStr + '</td><td><button class="btn btn-rev" onclick="reviseManualRow(\'' + rowId + '\', ' + loan + ', ' + mCharge + ', ' + mCust + ')">校訂</button> <button class="btn btn-del" onclick="document.getElementById(\'' + rowId + '\').remove()">刪除</button><div id="data-' + rowId + '" style="display:none;">' + phasesJson + '</div></td>';
    };

    window.reviseManualRow = function(rowId, loan, mCharge, mCust) {
        var phases = JSON.parse(document.getElementById('data-'+rowId).innerText);
        if(!phases.some(function(p) { return p.isAuto; })) return alert("此組合沒有自動計算的欄位，無法校訂");
        var newPmt = prompt("請輸入修正後的月付款:");
        if(newPmt===null) return; newPmt = parseInt(newPmt);
        if(isNaN(newPmt)) return alert("請輸入有效金額");
        var res = calcManualPhases(loan, phases, newPmt, mCharge, mCust);
        document.getElementById(rowId).innerHTML = renderManualRowHTML(loan, res, phases, rowId, mCharge, mCust);
    };

    // --- Export ---
    window.exportToExcel = function() {
        if (typeof XLSX === 'undefined') return alert('Excel 匯出需要連線載入 SheetJS');
        var start = parseInt(document.getElementById('R-Start').value) * 10000;
        var end = parseInt(document.getElementById('R-End').value) * 10000;
        var step = parseInt(document.getElementById('R-Step').value) * 10000;
        var terms = Array.from(document.querySelectorAll('.term-selector input:checked')).map(function(c) { return parseInt(c.value); });
        if (terms.length === 0) return alert("請選擇期數");
        var data = [], headerRow = ["分期金額"], subHeaderRow = [""];
        var merges = [{ s: { r: 0, c: 0 }, e: { r: 1, c: 0 } }];
        var colIndex = 1;
        terms.forEach(function(t) {
            headerRow.push(t + ' 期', null, null);
            merges.push({ s: { r: 0, c: colIndex }, e: { r: 0, c: colIndex + 2 } });
            subHeaderRow.push("月付款", "客戶利率(%)", "經銷補貼/退佣");
            colIndex += 3;
        });
        data.push(headerRow); data.push(subHeaderRow);
        var agentMax = parseFloat(document.getElementById('F-SubAgent').value) || 0;
        for (var amt = start; amt <= end; amt += step) {
            var row = [amt];
            terms.forEach(function(t) {
                var cellData = calcFactoryCell(amt, t, null, null, null);
                var pmt = cellData.pmt, chargeM = cellData.chargeRateM;
                var flows = []; for(var i=0;i<t;i++) flows.push(pmt);
                var irr = BSDCore.solveIRR(-amt, flows); if(irr<0) irr=0;
                var rate = parseFloat((irr * 1200).toFixed(2));
                var totalS = BSDCore.calculateActualS(amt, chargeM, flows);
                var dealerResult = 0;
                if (totalS > 0) { dealerResult = totalS; }
                else { var subNeeded = Math.abs(totalS); var agentUsed = Math.min(subNeeded, agentMax); dealerResult = -(subNeeded - agentUsed); }
                row.push(pmt, rate, dealerResult);
            });
            data.push(row);
        }
        var ws = XLSX.utils.aoa_to_sheet(data); ws['!merges'] = merges;
        var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "葵花寶典_分欄版");
        var manualTable = document.querySelector('.result-list-table');
        if(manualTable && manualTable.rows.length > 1) { var ws_manual = XLSX.utils.table_to_sheet(manualTable); XLSX.utils.book_append_sheet(wb, ws_manual, "手動試算清單"); }
        XLSX.writeFile(wb, 'BSD_葵花寶典_精細版.xlsx');
    };

    window.exportFactoryPDF = function() {
        if (typeof html2pdf === 'undefined') return alert('PDF 匯出需要連線載入 html2pdf');
        var area = document.getElementById('view-factory');
        var containers = area.querySelectorAll('.sf-table-container');
        containers.forEach(function(c) { c.style.overflow = 'visible'; c.style.maxHeight = 'none'; });
        html2pdf().set({
            margin: [5, 5, 5, 5], filename: 'BSD_葵花寶典_v4.pdf',
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 1.5, useCORS: true, scrollY: 0, windowWidth: Math.max(area.scrollWidth, 1200) },
            jsPDF: { unit: 'mm', format: 'a3', orientation: 'landscape' },
            pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
        }).from(area).save().then(function() { containers.forEach(function(c) { c.style.overflow = ''; c.style.maxHeight = ''; }); });
    };

    // --- buildFactoryPresets: 從主頁 DOM 同步利率按鈕 ---
    function buildFactoryPresets() {
        function buildGroup(sourceId, containerId, inputId) {
            var source = document.getElementById(sourceId);
            var container = document.getElementById(containerId);
            if (!source || !container) return;
            container.innerHTML = '';
            source.querySelectorAll('.rate-btn').forEach(function(btn) {
                var text = btn.textContent;
                var val = parseFloat(text);
                var b = document.createElement('button');
                b.className = 'rate-btn';
                b.textContent = text;
                b.onclick = (function(v, cid, iid) {
                    return function() { setFactoryRate(iid, v, cid); };
                })(val, containerId, inputId);
                container.appendChild(b);
            });
        }
        buildGroup('rate-presets-B4',    'fpresets-charge', 'F-ChargeRate');
        buildGroup('rate-presets-CRate', 'fpresets-cust',   'F-CustRate');
    }

    window.setFactoryRate = function(inputId, val, containerId) {
        var el = document.getElementById(inputId);
        if (!el || el.disabled) return;
        el.value = val;
        var container = document.getElementById(containerId);
        if (container) container.querySelectorAll('.rate-btn').forEach(function(b) {
            b.classList.toggle('active', parseFloat(b.textContent) === val);
        });
        syncFactoryLock();
    };

    // --- copyFactoryReport: 複製矩陣摘要到剪貼簿 ---
    window.copyFactoryReport = function() {
        var chargeRate = document.getElementById('F-ChargeRate').value || '—';
        var custRate   = document.getElementById('F-CustRate').value   || '—';
        var lockMode   = document.getElementById('F-PriorityLock').checked;
        var agentSub   = document.getElementById('F-SubAgent').value   || '0';
        var dealerSub  = document.getElementById('F-SubDealer').value  || '0';
        var start      = document.getElementById('R-Start').value      || '—';
        var end        = document.getElementById('R-End').value        || '—';
        var step       = document.getElementById('R-Step').value       || '—';
        var terms = Array.from(document.querySelectorAll('.term-selector input:checked')).map(function(c) { return c.value + '期'; }).join('、');
        var lines = [
            'BSD 葵花寶典 試算矩陣',
            '產生時間：' + new Date().toLocaleString(), '',
            '牌價利率 Charge Rate：' + chargeRate + '%',
            '客戶利率 Cust. Rate：' + (lockMode ? custRate + '%（鎖定）' : '隨 Charge 計算'),
            '總代理補貼：' + agentSub,
            '經銷商補貼：' + dealerSub,
            '金額範圍：' + start + '萬 ～ ' + end + '萬（每 ' + step + '萬）',
            '期數：' + (terms || '（未選擇）'), '',
            '本表僅供參考，實際攤還金額分配及結清金額需以 VWFS 系統資料為準'
        ];
        navigator.clipboard.writeText(lines.join('\n')).then(function() {
            alert('✅ 矩陣摘要已複製到剪貼簿');
        }).catch(function() {
            alert('❌ 複製失敗，請手動選取複製');
        });
    };

    // --- mailFactory: 下載 PDF 並開啟 mailto ---
    window.mailFactory = function() {
        var to = prompt('請輸入收件人信箱\nRecipient email:');
        if (!to || !to.includes('@')) return;
        var chargeRate = document.getElementById('F-ChargeRate').value || '—';
        var start      = document.getElementById('R-Start').value      || '—';
        var end        = document.getElementById('R-End').value        || '—';
        var terms = Array.from(document.querySelectorAll('.term-selector input:checked')).map(function(c) { return c.value + '期'; }).join('、');
        exportFactoryPDF();
        var subject = encodeURIComponent('BSD 葵花寶典 試算矩陣');
        var body = encodeURIComponent(
            'Hi，\n\n請見附件 PDF 葵花寶典試算矩陣。\n\n'
            + '牌價利率：' + chargeRate + '%\n'
            + '金額範圍：' + start + '萬 ～ ' + end + '萬\n'
            + '期數：' + (terms || '—') + '\n\n'
            + '本表僅供參考，實際攤還金額分配及結清金額需以 VWFS 系統資料為準。\n\nBSD Core v4.0'
        );
        setTimeout(function() {
            window.location.href = 'mailto:' + to + '?subject=' + subject + '&body=' + body;
        }, 600);
    };

    // 暴露初始化函式
    window.initFactory = initFactory;
})();
