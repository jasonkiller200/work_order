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
                
                let hintHTML = '';
                
                // 如果有採購單交期
                if (data.po_delivery) {
                    hintHTML = `
                        <div class="delivery-source-hint" style="padding: 0.5em; margin-bottom: 0.5em; background: #e3f2fd; border-left: 3px solid #2196f3; border-radius: 4px;">
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
                        hintHTML = `
                            <div class="delivery-source-hint" style="padding: 0.5em; margin-bottom: 0.5em; background: #fff3e0; border-left: 3px solid #ff9800; border-radius: 4px;">
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
                        hintHTML = `
                            <div class="delivery-source-hint" style="padding: 0.5em; margin-bottom: 0.5em; background: #fff3e0; border-left: 3px solid #ff9800; border-radius: 4px;">
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

            // 顯示歷史記錄
            if (data.history && data.history.length > 0) {
                let historyHTML = '<ul style="list-style: none; padding: 0; margin: 0;">';
                data.history.forEach(h => {
                    const createdDate = h.created_at ? new Date(h.created_at).toLocaleString('zh-TW') : '-';
                    // 🆕 檢查是否過期或部分到貨
                    const deliveryDate = new Date(h.expected_date);
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const isHistoryOverdue = deliveryDate < today;
                    const isHistoryPartial = h.status === 'partial_received';
                    
                    let borderColor = '#2196f3';
                    let statusText = '';
                    
                    if (isHistoryPartial) {
                        borderColor = '#ff9800';
                        statusText = `<span style="color: #ff9800;">⚠️ ${h.partial_note || '部分到貨'}</span>`;
                    } else if (isHistoryOverdue) {
                        borderColor = '#ff9800';
                        statusText = '<span style="color: #ff9800;">⚠️ 已過期</span>';
                    }
                    
                    historyHTML += `<li style="margin: 0.5em 0; padding: 0.5em; background: #f8f9fa; border-left: 3px solid ${borderColor}; border-radius: 4px;">
                        <div style="font-weight: bold;">📅 ${createdDate}</div>
                        <div style="margin-top: 0.3em;">預計 <strong>${h.expected_date}</strong> 到 <strong>${h.quantity}</strong> 件 ${statusText}</div>
                        ${h.po_number ? `<div style="font-size: 0.9em; color: #666;">採購單號: ${h.po_number}</div>` : ''}
                        ${h.notes ? `<div style="font-size: 0.9em; color: #666; margin-top: 0.2em;">備註: ${h.notes}</div>` : ''}
                    </li>`;
                });
                historyHTML += '</ul>';
                document.getElementById('delivery-history').innerHTML = historyHTML;
            } else {
                document.getElementById('delivery-history').innerHTML = '<p style="color: #666; font-style: italic;">尚無歷史記錄</p>';
            }
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

        if (deliveryQty > 0 && deliveryDate) {
            const totalAvailable = materialData.stock_summary.unrestricted +
                materialData.stock_summary.inspection +
                materialData.stock_summary.on_order +
                deliveryQty;

            document.getElementById('calc-available-stock').textContent = totalAvailable.toFixed(0);

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

    // 🆕 採購單選擇事件
    const poSelect = document.getElementById('po-select');
    if (poSelect) {
        poSelect.addEventListener('change', function () {
            const selectedPO = this.value;
            if (!selectedPO) return;

            // 從全域變數中查找採購單資料
            const poData = window.currentPurchaseOrders ? window.currentPurchaseOrders.find(p => p.po_number === selectedPO) : null;

            if (poData) {
                // 自動填入表單
                document.getElementById('po-number').value = poData.po_number;
                document.getElementById('supplier').value = poData.supplier || '';

                // 填入未交數量
                if (poData.outstanding_quantity > 0) {
                    document.getElementById('delivery-qty').value = poData.outstanding_quantity;
                }

                // 填入交期 (優先使用更新後的交期)
                const deliveryDate = poData.updated_delivery_date || poData.original_delivery_date;
                if (deliveryDate) {
                    document.getElementById('delivery-date').value = deliveryDate;
                }

                // 觸發計算更新
                updateCalculation();

                // 提示
                showToast('✅ 已自動填入採購單資料', 'info');
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

        if (!formData.expected_date || !formData.quantity || isNaN(formData.quantity)) {
            showToast('❌ 請填寫必填欄位（預計到貨日期和採購數量）', 'error');
            return;
        }

        saveDelivery(formData);
    };

    // 清除按鈕
    document.getElementById('clear-delivery-btn').onclick = () => {
        if (confirm('確定要清除表單內容嗎？')) {
            document.getElementById('delivery-form').reset();
            document.getElementById('delivery-calculation').style.display = 'none';
        }
    };
}

// 儲存交期
function saveDelivery(formData) {
    // 顯示載入中
    const saveBtn = document.getElementById('save-delivery-btn');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = '⏳ 儲存中...';
    saveBtn.disabled = true;

    fetch('/api/delivery', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showToast('✅ 交期已成功儲存', 'success');
                // 重新載入交期資料
                loadExistingDelivery(formData.material_id);
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
