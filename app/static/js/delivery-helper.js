// 交期維護相關函數

// 載入現有交期資料
function loadExistingDelivery(materialId) {
    fetch(`/api/delivery/${materialId}`)
        .then(response => response.json())
        .then(data => {
            // 🆕 檢查是否有過期的交期
            let deliveryToShow = data.delivery;
            let isOverdue = false;
            let isPartialReceived = false;

            // 🆕 顯示交期來源提示
            const deliveryFormContainer = document.getElementById('delivery-form')?.parentElement;
            if (deliveryFormContainer) {
                // 移除舊的提示
                const oldHint = deliveryFormContainer.querySelector('.delivery-source-hint');
                if (oldHint) oldHint.remove();

                // 🆕 偵測暗黑模式
                const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';

                let hintHTML = '';

                // 如果有採購單交期
                if (data.po_delivery) {
                    const bgColor = isDarkMode ? '#1a2634' : '#e3f2fd';
                    const borderColor = isDarkMode ? '#42a5f5' : '#2196f3';
                    const textColor = isDarkMode ? '#e0e0e0' : '#333';

                    hintHTML = `
                        <div class="delivery-source-hint" style="padding: 0.5em; margin-bottom: 0.5em; background: ${bgColor}; border-left: 3px solid ${borderColor}; border-radius: 4px; color: ${textColor};">
                            ℹ️ 目前使用採購單交期：<strong>${data.po_delivery.po_number}</strong>
                            （${data.po_delivery.expected_date}，${data.po_delivery.quantity} 件）
                        </div>
                    `;
                    deliveryToShow = data.po_delivery;
                }
                // 如果只有手動維護的交期
                else if (data.manual_delivery) {
                    // 🆕 檢查是否為部分到貨狀態
                    if (data.manual_delivery.status === 'partial_received') {
                        isPartialReceived = true;
                        const bgColor = isDarkMode ? '#3d2f1f' : '#fff3e0';
                        const borderColor = isDarkMode ? '#ffa726' : '#ff9800';
                        const textColor = isDarkMode ? '#e0e0e0' : '#333';

                        hintHTML = `
                            <div class="delivery-source-hint" style="padding: 0.5em; margin-bottom: 0.5em; background: ${bgColor}; border-left: 3px solid ${borderColor}; border-radius: 4px; color: ${textColor};">
                                ⚠️ <strong>採購單已部分到貨</strong><br>
                                <small>${data.manual_delivery.partial_note || '請確認剩餘數量的新交期'}</small><br>
                                <button type="button" class="small" onclick="clearPartialDelivery('${materialId}')" style="margin-top: 0.3em;">
                                    ✏️ 確認並更新交期
                                </button>
                            </div>
                        `;
                    }
                    else if (data.manual_delivery.status === 'overdue') {
                        isOverdue = true;
                        const bgColor = isDarkMode ? '#3d2f1f' : '#fff3e0';
                        const borderColor = isDarkMode ? '#ffa726' : '#ff9800';
                        const textColor = isDarkMode ? '#e0e0e0' : '#333';

                        hintHTML = `
                            <div class="delivery-source-hint" style="padding: 0.5em; margin-bottom: 0.5em; background: ${bgColor}; border-left: 3px solid ${borderColor}; border-radius: 4px; color: ${textColor};">
                                ⚠️ 交期已過期（${data.manual_delivery.expected_date}），請更新或清除
                                <button type="button" class="small" onclick="clearOverdueDelivery('${materialId}')" style="margin-left: 0.5em;">
                                    🗑️ 清除過期交期
                                </button>
                            </div>
                        `;
                    }
                    deliveryToShow = data.manual_delivery;
                }

                if (hintHTML) {
                    deliveryFormContainer.insertAdjacentHTML('afterbegin', hintHTML);
                }
            }

            if (deliveryToShow) {
                // 填充表單
                document.getElementById('delivery-date').value = deliveryToShow.expected_date || '';
                document.getElementById('delivery-qty').value = deliveryToShow.quantity || '';
                document.getElementById('po-number').value = deliveryToShow.po_number || '';
                document.getElementById('supplier').value = deliveryToShow.supplier || '';
                document.getElementById('delivery-notes').value = deliveryToShow.notes || '';

                // 🆕 如果是過期或部分到貨交期，標記為橙色
                if (isOverdue || isPartialReceived) {
                    document.getElementById('delivery-date').style.borderColor = '#ff9800';
                    document.getElementById('delivery-date').style.backgroundColor = '#fff3e0';
                } else {
                    document.getElementById('delivery-date').style.borderColor = '';
                    document.getElementById('delivery-date').style.backgroundColor = '';
                }
            } else {
                // 清空表單
                document.getElementById('delivery-form').reset();
            }

            // 🆕 顯示交期排程清單 (原歷史記錄區塊)
            const historyContainer = document.getElementById('delivery-history');
            if (data.history && data.history.length > 0) {
                // 🆕 偵測暗黑模式
                const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';

                let historyHTML = '<div class="delivery-schedule-list">';
                data.history.forEach(h => {
                    const deliveryDate = new Date(h.expected_date);
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);

                    const isCompleted = h.status === 'completed';
                    const isOverdue = deliveryDate < today && !isCompleted;
                    const isPartial = h.status === 'partial';

                    let statusBadge = '';
                    let borderColor = '#2196f3';
                    let bgColor = '#f8f9fa';
                    let textColor = '#333';

                    // 🆕 根據狀態和主題設定顏色
                    if (isCompleted) {
                        statusBadge = '<span class="badge success">已到貨</span>';
                        borderColor = '#4caf50';
                        bgColor = isDarkMode ? '#1b2e1b' : '#f1f8e9';
                        textColor = isDarkMode ? '#c8e6c9' : '#333';
                    } else if (isPartial) {
                        statusBadge = '<span class="badge warning">部分到貨</span>';
                        borderColor = '#ff9800';
                        bgColor = isDarkMode ? '#3d2f1f' : '#fff3e0';
                        textColor = isDarkMode ? '#ffcc80' : '#333';
                    } else if (isOverdue) {
                        statusBadge = '<span class="badge error">已過期</span>';
                        borderColor = '#f44336';
                        bgColor = isDarkMode ? '#4a2020' : '#ffebee';
                        textColor = isDarkMode ? '#ffcdd2' : '#333';
                    } else {
                        statusBadge = '<span class="badge info">待到貨</span>';
                        borderColor = isDarkMode ? '#42a5f5' : '#2196f3';
                        bgColor = isDarkMode ? '#1a2634' : '#f8f9fa';
                        textColor = isDarkMode ? '#bbdefb' : '#333';
                    }

                    const poTotalInfo = h.po_number ? ` (PO 總額分批)` : '';
                    const receivedInfo = h.received_quantity > 0 ? `<br><small>已收: ${h.received_quantity} / 應收: ${h.quantity}</small>` : '';

                    const secondaryTextColor = isDarkMode ? '#999' : '#666';

                    historyHTML += `
                        <div class="delivery-item" style="margin: 0.8em 0; padding: 0.8em; background: ${bgColor}; border-left: 4px solid ${borderColor}; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); color: ${textColor};">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                                <div>
                                    <div style="font-weight: bold; margin-bottom: 0.3em;">📅 預計到貨: ${h.expected_date} ${statusBadge}${poTotalInfo}</div>
                                    <div style="font-size: 1.1em;">數量: <strong>${h.quantity}</strong> 件 ${receivedInfo}</div>
                                    ${h.po_number ? `<div style="font-size: 0.9em; color: ${secondaryTextColor}; margin-top: 0.3em;">採購單: ${h.po_number}</div>` : ''}
                                    ${h.notes ? `<div style="font-size: 0.9em; color: ${secondaryTextColor}; font-style: italic;">備註: ${h.notes}</div>` : ''}
                                </div>
                                <div style="display: flex; gap: 0.5em;">
                                    ${!isCompleted ? `
                                        <button class="small outline" onclick="editDeliverySchedule('${h.id}', '${materialId}')" title="編輯">✏️</button>
                                        <button class="small outline error" onclick="deleteDeliverySchedule('${h.id}', '${materialId}')" title="刪除">🗑️</button>
                                    ` : ''}
                                </div>
                            </div>
                        </div>
                    `;
                });
                historyHTML += '</div>';
                historyContainer.innerHTML = historyHTML;
            } else {
                const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
                const textColor = isDarkMode ? '#999' : '#666';
                historyContainer.innerHTML = `<p style="color: ${textColor}; font-style: italic; text-align: center; padding: 1em;">尚無交期計畫</p>`;
            }

            // 🆕 儲存到全域變數供數量試算使用
            window.currentDeliveryHistory = data.history || [];
        })
        .catch(error => {
            console.error('載入交期資料失敗:', error);
            document.getElementById('delivery-history').innerHTML = '<p style="color: #d32f2f;">載入失敗</p>';
        });
}

// 綁定交期表單事件
function setupDeliveryFormEvents(materialId, materialData) {
    // 即時計算到貨後庫存
    const qtyInput = document.getElementById('delivery-qty');
    const dateInput = document.getElementById('delivery-date');

    const updateCalculation = () => {
        const deliveryQty = parseFloat(qtyInput.value) || 0;
        const deliveryDate = dateInput.value;

        // 🆕 移除舊的延遲警告
        const oldWarning = dateInput.parentElement.querySelector('.delivery-delay-warning');
        if (oldWarning) oldWarning.remove();

        // 🆕 移除舊的過去日期警告
        const oldPastWarning = dateInput.parentElement.querySelector('.past-date-warning');
        if (oldPastWarning) oldPastWarning.remove();

        // 🆕 檢查是否選擇了過去的日期
        if (deliveryDate) {
            const selectedDate = new Date(deliveryDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            selectedDate.setHours(0, 0, 0, 0);

            if (selectedDate < today) {
                // 偵測暗黑模式
                const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
                const bgColor = isDarkMode ? '#4a2020' : '#ffebee';
                const borderColor = isDarkMode ? '#ef5350' : '#f44336';
                const textColor = isDarkMode ? '#ffcdd2' : '#c62828';

                // 顯示過去日期警告
                const warning = document.createElement('div');
                warning.className = 'past-date-warning';
                warning.style.cssText = `padding: 0.5em; margin-top: 0.5em; background: ${bgColor}; border-left: 3px solid ${borderColor}; border-radius: 4px; color: ${textColor}; font-size: 0.9em; font-weight: bold;`;
                warning.innerHTML = `
                    ❌ <strong>不能選擇過去的日期</strong><br>
                    請選擇今天或未來的日期
                `;
                dateInput.parentElement.appendChild(warning);

                // 清空日期欄位
                dateInput.value = '';
                dateInput.focus();
                return;
            }
        }

        if (deliveryQty > 0 && deliveryDate) {
            const totalAvailable = materialData.stock_summary.unrestricted +
                materialData.stock_summary.inspection +
                deliveryQty;

            document.getElementById('calc-available-stock').textContent = totalAvailable.toFixed(0);

            // 🆕 檢查交期是否晚於第一筆「缺料」需求日期 (remaining_stock < 0 的那筆)
            if (materialData.demand_details && materialData.demand_details.length > 0) {
                // 找出第一筆缺料需求 (預計剩餘庫存為負的那筆)
                let firstShortageDemand = null;
                let runningStockCheck = materialData.stock_summary.unrestricted + materialData.stock_summary.inspection;

                for (const demand of materialData.demand_details) {
                    runningStockCheck -= (demand['未結數量 (EINHEIT)'] || 0);
                    if (runningStockCheck < 0) {
                        firstShortageDemand = demand;
                        break;
                    }
                }

                // 只有在有缺料需求時才顯示延遲警告
                if (firstShortageDemand) {
                    const shortageDemandDate = new Date(firstShortageDemand['需求日期']);
                    const deliveryDateObj = new Date(deliveryDate);

                    if (deliveryDateObj > shortageDemandDate) {
                        // 計算延遲天數
                        const delayDays = Math.ceil((deliveryDateObj - shortageDemandDate) / (1000 * 60 * 60 * 24));

                        // 偵測暗黑模式
                        const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
                        const bgColor = isDarkMode ? '#4a2020' : '#ffebee';
                        const borderColor = isDarkMode ? '#ef5350' : '#f44336';
                        const textColor = isDarkMode ? '#ffcdd2' : '#c62828';

                        // 顯示警告
                        const warning = document.createElement('div');
                        warning.className = 'delivery-delay-warning';
                        warning.style.cssText = `padding: 0.5em; margin-top: 0.5em; background: ${bgColor}; border-left: 3px solid ${borderColor}; border-radius: 4px; color: ${textColor}; font-size: 0.9em;`;
                        warning.innerHTML = `
                            ⚠️ <strong>交期延遲警告</strong><br>
                            預計交期 (${deliveryDate}) 晚於第一筆缺料需求日期 (${firstShortageDemand['需求日期']})<br>
                            <strong style="font-size: 1.1em;">延遲 ${delayDays} 天</strong>
                        `;
                        dateInput.parentElement.appendChild(warning);
                    }
                }
            }

            // 計算能滿足到哪個需求
            let runningStock = totalAvailable;
            let lastSatisfiedDate = '-';

            for (const demand of materialData.demand_details) {
                runningStock -= demand['未結數量 (EINHEIT)'];
                if (runningStock >= 0) {
                    lastSatisfiedDate = demand['需求日期'];
                } else {
                    break;
                }
            }

            document.getElementById('calc-satisfy-until').textContent = lastSatisfiedDate;
            document.getElementById('delivery-calculation').style.display = 'block';
        } else {
            document.getElementById('delivery-calculation').style.display = 'none';
        }
    };

    qtyInput.addEventListener('input', updateCalculation);
    dateInput.addEventListener('change', updateCalculation);

    // 🆕 採購單/鑄件訂單選擇事件
    const poSelect = document.getElementById('po-select');
    if (poSelect) {
        poSelect.addEventListener('change', function () {
            const selectedValue = this.value;
            const selectedOption = this.options[this.selectedIndex];
            const orderType = selectedOption ? selectedOption.dataset.type : null;

            if (!selectedValue) {
                removePOBatchHint();
                return;
            }

            // 🆕 處理鑄件訂單 (4開頭)
            if (orderType === 'casting' || selectedValue.startsWith('4')) {
                const coData = window.currentCastingOrders ? window.currentCastingOrders.find(c => c.order_number === selectedValue) : null;

                if (coData) {
                    // 自動填入表單
                    document.getElementById('po-number').value = coData.order_number;
                    document.getElementById('supplier').value = '鑄件生產';

                    // 填入未交數量
                    const outstandingQty = parseFloat(coData.outstanding_quantity) || 0;
                    document.getElementById('delivery-qty').value = outstandingQty > 0 ? outstandingQty : 0;

                    // 🔧 不自動載入 SAP 預計完成日期，因為那是採購開單時的預設日期，需由用戶手動填寫實際預計交期

                    // 🆕 顯示鑄件訂單分批提示
                    const currentEditId = document.getElementById('save-delivery-btn').dataset.editId;
                    showCastingOrderHint(selectedValue, coData.outstanding_quantity, coData.expected_date, currentEditId);

                    // 觸發計算更新
                    updateCalculation();
                }
                return;
            }

            // 處理採購單
            const poData = window.currentPurchaseOrders ? window.currentPurchaseOrders.find(p => p.po_number === selectedValue) : null;

            if (poData) {
                // 自動填入表單
                document.getElementById('po-number').value = poData.po_number;
                document.getElementById('supplier').value = poData.supplier || '';

                // 🆕 智慧計算剩餘可分配數量
                const currentEditId = document.getElementById('save-delivery-btn').dataset.editId;
                const remaining = calculateRemainingPOQuantity(selectedValue, currentEditId);

                // 填入數量
                document.getElementById('delivery-qty').value = remaining > 0 ? remaining : 0;

                // 設定上限提示 (供驗證使用)
                document.getElementById('delivery-qty').dataset.maxAllowed = (remaining + (currentEditId ? 0 : 0)); // 稍後在 validator 中細化

                // 填入交期 (優先使用更新後的交期)
                const deliveryDate = poData.updated_delivery_date || poData.original_delivery_date;
                if (deliveryDate) {
                    document.getElementById('delivery-date').value = deliveryDate;
                }

                // 🆕 顯示分批資訊提示
                showPOBatchHint(selectedValue, poData.outstanding_quantity, remaining, currentEditId);

                // 觸發計算更新
                updateCalculation();
            }
        });
    }

    // 儲存按鈕
    document.getElementById('save-delivery-btn').onclick = () => {
        const formData = {
            material_id: materialId,
            expected_date: document.getElementById('delivery-date').value,
            quantity: parseFloat(document.getElementById('delivery-qty').value),
            po_number: document.getElementById('po-number').value,
            supplier: document.getElementById('supplier').value,
            notes: document.getElementById('delivery-notes').value
        };

        // 🆕 驗證必填欄位
        if (!formData.expected_date || isNaN(formData.quantity) || formData.quantity <= 0) {
            showToast('❌ 請填寫必填欄位(預計到貨日期和有效數量)', 'error');
            return;
        }

        // 🆕 驗證日期不能是過去
        const selectedDate = new Date(formData.expected_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        selectedDate.setHours(0, 0, 0, 0);

        if (selectedDate < today) {
            showToast('❌ 不能選擇過去的日期,請選擇今天或未來的日期', 'error');
            document.getElementById('delivery-date').focus();
            return;
        }

        // 🆕 加強型驗證:檢查採購單分配上限（鑄件訂單跳過此驗證）
        const isCastingOrder = formData.po_number && formData.po_number.startsWith('4');

        if (formData.po_number && window.currentPurchaseOrders && !isCastingOrder) {
            const currentEditId = document.getElementById('save-delivery-btn').dataset.editId;
            const maxRemaining = calculateRemainingPOQuantity(formData.po_number, currentEditId);

            if (formData.quantity > (maxRemaining + 0.01)) { // 允許微小浮點誤差
                if (!confirm(`⚠️ 注意:此筆交期數量 (${formData.quantity}) 已超出該採購單剩餘未分配數量 (${maxRemaining.toFixed(1)})。\n\n確定要強制儲存嗎?`)) {
                    return;
                }
            }
        }

        saveDelivery(formData);
    };

    // 清除按鈕
    document.getElementById('clear-delivery-btn').onclick = () => {
        if (confirm('確定要清除表單內容嗎？')) {
            resetDeliveryForm();
        }
    };
}

// 🆕 計算採購單剩餘可分配數量
function calculateRemainingPOQuantity(poNumber, currentScheduleId = null) {
    if (!poNumber || !window.currentPurchaseOrders) return 0;

    const po = window.currentPurchaseOrders.find(p => p.po_number === poNumber);
    if (!po) return 0;

    const totalOutstanding = parseFloat(po.outstanding_quantity) || 0;

    // 計算已分配量 (排除當前正在編輯的這一筆)
    let alreadyAssigned = 0;
    if (window.currentDeliveryHistory) {
        window.currentDeliveryHistory.forEach(h => {
            if (h.po_number === poNumber && String(h.id) !== String(currentScheduleId) && h.status !== 'cancelled') {
                alreadyAssigned += (parseFloat(h.quantity) - parseFloat(h.received_quantity || 0));
            }
        });
    }

    return totalOutstanding - alreadyAssigned;
}

// 🆕 顯示 PO 分批狀態提示
function showPOBatchHint(poNumber, total, remaining, currentEditId) {
    const qtyInput = document.getElementById('delivery-qty');
    const container = qtyInput.parentElement;

    // 移除舊提示
    removePOBatchHint();

    // 🆕 偵測暗黑模式
    const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
    const bgColor = isDarkMode ? '#1a2634' : '#f0f7ff';
    const textColor = isDarkMode ? '#bbdefb' : '#666';
    const borderColor = isDarkMode ? '#42a5f5' : '#007bff';
    const highlightColor = isDarkMode ? '#64b5f6' : '#007bff';

    const hint = document.createElement('div');
    hint.className = 'po-batch-hint';
    hint.style.cssText = `font-size: 0.85em; color: ${textColor}; margin-top: 0.3em; background: ${bgColor}; padding: 4px 8px; border-radius: 4px; border-left: 3px solid ${borderColor};`;

    // 計算該 PO 已有的分批數
    const batchCount = window.currentDeliveryHistory ? window.currentDeliveryHistory.filter(h => h.po_number === poNumber && h.status !== 'cancelled').length : 0;

    hint.innerHTML = `
        <strong>採購單 ${poNumber}</strong> 狀態:<br>
        • 未交總數:${total} | • 已分配分批:${batchCount} 筆<br>
        • 本次剩餘可分配上限:<span style="color: ${highlightColor}; font-weight: bold;">${remaining.toFixed(1)}</span>
    `;

    container.appendChild(hint);
}

function removePOBatchHint() {
    const oldHint = document.querySelector('.po-batch-hint');
    if (oldHint) oldHint.remove();
    // 同時移除鑄件訂單提示
    const oldCastingHint = document.querySelector('.casting-order-hint');
    if (oldCastingHint) oldCastingHint.remove();
}

// 🆕 顯示鑄件訂單狀態提示
function showCastingOrderHint(orderNumber, outstandingQty, expectedDate, currentEditId) {
    const qtyInput = document.getElementById('delivery-qty');
    const container = qtyInput.parentElement;

    // 移除舊提示
    removePOBatchHint();

    // 🆕 偵測暗黑模式
    const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
    const bgColor = isDarkMode ? '#3d2f1f' : '#fff3e0';
    const textColor = isDarkMode ? '#ffcc80' : '#666';
    const borderColor = isDarkMode ? '#ffa726' : '#ff9800';
    const highlightColor = isDarkMode ? '#ffcc80' : '#ff9800';

    const hint = document.createElement('div');
    hint.className = 'casting-order-hint';
    hint.style.cssText = `font-size: 0.85em; color: ${textColor}; margin-top: 0.3em; background: ${bgColor}; padding: 4px 8px; border-radius: 4px; border-left: 3px solid ${borderColor};`;

    // 計算已有的分批數
    const batchCount = window.currentDeliveryHistory ? window.currentDeliveryHistory.filter(h => h.po_number === orderNumber && h.status !== 'cancelled').length : 0;

    hint.innerHTML = `
        <strong>🔧 鑄件訂單 ${orderNumber}</strong> 狀態:<br>
        • 未交數量:<span style="color: ${highlightColor}; font-weight: bold;">${outstandingQty}</span> | • 已有排程:${batchCount} 筆<br>
        • 交期請手動填寫
    `;

    container.appendChild(hint);
}

// 儲存交期
function saveDelivery(formData) {
    // 檢查是新增還是編輯
    const scheduleId = document.getElementById('save-delivery-btn').dataset.editId;
    const method = scheduleId ? 'PUT' : 'POST';
    const url = scheduleId ? `/api/delivery/${scheduleId}` : '/api/delivery';

    // 顯示載入中
    const saveBtn = document.getElementById('save-delivery-btn');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = '⏳ 處理中...';
    saveBtn.disabled = true;

    fetch(url, {
        method: method,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showToast(scheduleId ? '✅ 交期已更新' : '✅ 交期已儲存', 'success');
                // 重置編輯狀態
                resetDeliveryForm();
                // 重新載入交期資料
                loadExistingDelivery(formData.material_id);
                // 🆕 重新載入採購單列表以更新交期顯示
                if (typeof loadPurchaseOrders === 'function') {
                    loadPurchaseOrders(formData.material_id);
                }
                // 重新載入儀錶板以更新統計
                loadProcurementDashboard();
            } else {
                showToast('❌ 儲存失敗: ' + (data.error || '未知錯誤'), 'error');
            }
        })
        .catch(error => {
            console.error('儲存交期失敗:', error);
            showToast('❌ 儲存失敗，請稍後再試', 'error');
        })
        .finally(() => {
            saveBtn.textContent = originalText;
            saveBtn.disabled = false;
        });
}

// 🆕 編輯交期分批
function editDeliverySchedule(id, materialId) {
    // 從歷史記錄中找到該筆資料 (或者直接呼叫 API，這裡為了快先從 DOM 找或是重新 Fetch)
    fetch(`/api/delivery/${materialId}`)
        .then(resp => resp.json())
        .then(data => {
            const item = data.history.find(h => h.id == id);
            if (item) {
                // 填入表單
                document.getElementById('delivery-date').value = item.expected_date;
                document.getElementById('delivery-qty').value = item.quantity;
                document.getElementById('po-number').value = item.po_number || '';
                document.getElementById('supplier').value = item.supplier || '';
                document.getElementById('delivery-notes').value = item.notes || '';

                // 標記為編輯模式
                const saveBtn = document.getElementById('save-delivery-btn');
                saveBtn.textContent = '💾 更新交期';
                saveBtn.dataset.editId = id;

                // 🆕 如果有關聯採購單，顯示分批提示
                if (item.po_number) {
                    const poSelect = document.getElementById('po-select');
                    if (poSelect) poSelect.value = item.po_number;

                    const poData = window.currentPurchaseOrders ? window.currentPurchaseOrders.find(p => p.po_number === item.po_number) : null;
                    if (poData) {
                        const remaining = calculateRemainingPOQuantity(item.po_number, id);
                        showPOBatchHint(item.po_number, poData.outstanding_quantity, remaining + parseFloat(item.quantity), id);
                    }
                } else {
                    removePOBatchHint();
                }

                // 捲動到表單
                document.getElementById('delivery-form').scrollIntoView({ behavior: 'smooth' });
            }
        });
}

// 🆕 刪除交期分批
function deleteDeliverySchedule(id, materialId) {
    if (!confirm('確定要刪除此筆交期排程嗎？這將影響缺料試算結果。')) {
        return;
    }

    fetch(`/api/delivery/${id}`, {
        method: 'DELETE'
    })
        .then(resp => resp.json())
        .then(data => {
            if (data.success) {
                showToast('✅ 交期已刪除', 'success');
                loadExistingDelivery(materialId);
                // 🆕 重新載入採購單列表以更新交期顯示
                if (typeof loadPurchaseOrders === 'function') {
                    loadPurchaseOrders(materialId);
                }
                loadProcurementDashboard();
            } else {
                alert('刪除失敗: ' + (data.error || '未知錯誤'));
            }
        })
        .catch(error => {
            console.error('刪除交期失敗:', error);
            alert('刪除失敗，請檢查網路連線');
        });
}

// 🆕 重置交期表單
function resetDeliveryForm() {
    const form = document.getElementById('delivery-form');
    if (form) form.reset();

    const saveBtn = document.getElementById('save-delivery-btn');
    if (saveBtn) {
        saveBtn.textContent = '💾 儲存交期';
        delete saveBtn.dataset.editId;
    }

    const calcEl = document.getElementById('delivery-calculation');
    if (calcEl) calcEl.style.display = 'none';

    // 🆕 清除延遲警告
    const delayWarning = document.querySelector('.delivery-delay-warning');
    if (delayWarning) delayWarning.remove();

    // 🆕 清除 PO 分批提示
    removePOBatchHint();

    // 🆕 重置日期欄位樣式
    const dateInput = document.getElementById('delivery-date');
    if (dateInput) {
        dateInput.style.borderColor = '';
        dateInput.style.backgroundColor = '';
    }
}

// Toast 提示函數
function showToast(message, type = 'info') {
    // 檢查是否已有 toast
    const existingToast = document.querySelector('.toast-notification');
    if (existingToast) {
        existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'toast-notification';

    const bgColor = {
        'success': '#4caf50',
        'error': '#f44336',
        'info': '#2196f3',
        'warning': '#ff9800'
    }[type] || '#2196f3';

    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1em 1.5em;
        background: ${bgColor};
        color: white;
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
        animation: slideInRight 0.3s ease-out;
        font-weight: bold;
        max-width: 400px;
    `;
    toast.textContent = message;

    // 加入動畫樣式
    if (!document.getElementById('toast-animation-style')) {
        const style = document.createElement('style');
        style.id = 'toast-animation-style';
        style.textContent = `
            @keyframes slideInRight {
                from {
                    transform: translateX(400px);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            @keyframes slideOutRight {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(400px);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOutRight 0.3s ease-in';
        setTimeout(() => {
            if (toast.parentNode) {
                document.body.removeChild(toast);
            }
        }, 300);
    }, 3000);
}

// 🆕 清除過期交期
function clearOverdueDelivery(materialId) {
    if (!confirm('確定要清除過期的交期嗎？清除後將自動使用下一筆有效交期（如有）。')) {
        return;
    }

    // 這裡可以呼叫 API 清除過期交期，或直接重新載入
    // 暫時簡化處理：清空表單並重新載入
    fetch(`/api/delivery/${materialId}/clear_overdue`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showToast('✅ 已清除過期交期', 'success');
                loadExistingDelivery(materialId);
                loadProcurementDashboard();
            } else {
                showToast('❌ 清除失敗', 'error');
            }
        })
        .catch(error => {
            console.error('清除過期交期失敗:', error);
            // 降級處理：直接清空表單
            document.getElementById('delivery-form').reset();
            showToast('⚠️ 表單已清空，請填寫新的交期', 'warning');
        });
}

// 🆕 確認並清除部分到貨標記
function clearPartialDelivery(materialId) {
    if (!confirm('確定要更新剩餘數量的交期嗎？請在表單中填寫新的交期資訊。')) {
        return;
    }

    // 清空表單，讓使用者填寫新的交期
    document.getElementById('delivery-form').reset();

    // 移除部分到貨的提示框
    const hint = document.querySelector('.delivery-source-hint');
    if (hint) hint.remove();

    showToast('請填寫剩餘數量的新交期', 'info');

    // 聚焦到交期日期欄位
    document.getElementById('delivery-date').focus();
}

// 🆕 批量清除所有過期交期
function batchClearOverdueDeliveries() {
    if (!confirm('確定要批量清除所有過期的交期嗎？\n\n此操作將清除所有已過期的手動維護交期，清除後系統會自動使用採購單交期（如有）。')) {
        return;
    }

    // 顯示處理中
    const btn = document.getElementById('batch-clear-overdue-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ 處理中...';

    fetch('/api/delivery/batch-clear-overdue', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })
        .then(response => response.json())
        .then(data => {
            btn.disabled = false;
            btn.textContent = originalText;

            if (data.success) {
                showToast(`✅ 已批量清除 ${data.cleared_count} 個過期交期`, 'success');
                // 重新載入儀表板
                loadProcurementDashboard();
                // 隱藏批量操作欄
                document.getElementById('batch-actions-bar').style.display = 'none';
            } else {
                showToast('❌ 批量清除失敗: ' + (data.message || '未知錯誤'), 'error');
            }
        })
        .catch(error => {
            btn.disabled = false;
            btn.textContent = originalText;
            console.error('批量清除過期交期失敗:', error);
            showToast('❌ 批量清除失敗', 'error');
        });
}

// 🆕 切換自動清理過期交期
function toggleAutoClearOverdue() {
    const btn = document.getElementById('auto-clear-overdue-btn');
    const isEnabled = localStorage.getItem('autoClearOverdue') === 'true';

    if (!isEnabled) {
        if (confirm('啟用自動清理功能後，系統會在每次載入資料時自動清除過期超過 1 天的交期。\n\n確定要啟用嗎？')) {
            localStorage.setItem('autoClearOverdue', 'true');
            btn.textContent = '✅ 自動清理已啟用';
            btn.classList.remove('outline');
            showToast('✅ 自動清理已啟用', 'success');
            // 立即執行一次
            batchClearOverdueDeliveries();
        }
    } else {
        localStorage.setItem('autoClearOverdue', 'false');
        btn.textContent = '⚡ 啟用自動清理';
        btn.classList.add('outline');
        showToast('已停用自動清理', 'info');
    }
}

// 🆕 檢查並執行自動清理（在載入資料時調用）
function checkAndAutoClearOverdue() {
    const isEnabled = localStorage.getItem('autoClearOverdue') === 'true';
    if (isEnabled) {
        // 靜默執行，不顯示確認對話框
        fetch('/api/delivery/batch-clear-overdue', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        })
            .then(response => response.json())
            .then(data => {
                if (data.success && data.cleared_count > 0) {
                    showToast(`🤖 自動清理: 已清除 ${data.cleared_count} 個過期交期`, 'info');
                }
            })
            .catch(error => {
                console.error('自動清理失敗:', error);
            });
    }
}

// 初始化自動清理按鈕狀態
function initAutoClearButton() {
    const btn = document.getElementById('auto-clear-overdue-btn');
    if (btn) {
        const isEnabled = localStorage.getItem('autoClearOverdue') === 'true';
        if (isEnabled) {
            btn.textContent = '✅ 自動清理已啟用';
            btn.classList.remove('outline');
        }
    }
}

// 將函數暴露到全域
window.clearOverdueDelivery = clearOverdueDelivery;
window.clearPartialDelivery = clearPartialDelivery;
window.batchClearOverdueDeliveries = batchClearOverdueDeliveries;
window.toggleAutoClearOverdue = toggleAutoClearOverdue;
window.checkAndAutoClearOverdue = checkAndAutoClearOverdue;
window.initAutoClearButton = initAutoClearButton;
window.editDeliverySchedule = editDeliverySchedule;
window.deleteDeliverySchedule = deleteDeliverySchedule;
window.resetDeliveryForm = resetDeliveryForm;
