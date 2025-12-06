// 交期維護相關函數

// 載入現有交期資料
function loadExistingDelivery(materialId) {
    fetch(`/api/delivery/${materialId}`)
        .then(response => response.json())
        .then(data => {
            if (data.delivery) {
                // 填充表單
                document.getElementById('delivery-date').value = data.delivery.expected_date || '';
                document.getElementById('delivery-qty').value = data.delivery.quantity || '';
                document.getElementById('po-number').value = data.delivery.po_number || '';
                document.getElementById('supplier').value = data.delivery.supplier || '';
                document.getElementById('delivery-notes').value = data.delivery.notes || '';
            } else {
                // 清空表單
                document.getElementById('delivery-form').reset();
            }

            // 顯示歷史記錄
            if (data.history && data.history.length > 0) {
                let historyHTML = '<ul style="list-style: none; padding: 0; margin: 0;">';
                data.history.forEach(h => {
                    const createdDate = h.created_at ? new Date(h.created_at).toLocaleString('zh-TW') : '-';
                    historyHTML += `<li style="margin: 0.5em 0; padding: 0.5em; background: #f8f9fa; border-left: 3px solid #2196f3; border-radius: 4px;">
                        <div style="font-weight: bold;">📅 ${createdDate}</div>
                        <div style="margin-top: 0.3em;">預計 <strong>${h.expected_date}</strong> 到 <strong>${h.quantity}</strong> 件</div>
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
