
// 🆕 載入採購單資料
function loadPurchaseOrders(materialId) {
    const poSection = document.getElementById('purchase-orders-section');
    const poTbody = document.getElementById('purchase-orders-tbody');
    const poSelect = document.getElementById('po-select');

    if (!poSection || !poTbody) return;

    // 顯示載入中
    poSection.style.display = 'block';
    poTbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">載入中...</td></tr>';

    fetch(`/api/purchase_orders/${materialId}`)
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                poTbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: red;">${data.error}</td></tr>`;
                return;
            }

            if (data.length === 0) {
                poTbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">沒有相關的採購單。</td></tr>';
                // 清空並重置選擇器
                if (poSelect) {
                    poSelect.innerHTML = '<option value="">-- 新建交期記錄 (不關聯採購單) --</option>';
                }
                return;
            }

            // 渲染表格
            renderPurchaseOrdersTable(data);

            // 填充選擇器
            populatePOSelect(data);
        })
        .catch(error => {
            console.error('Error loading purchase orders:', error);
            poTbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: red;">載入失敗</td></tr>';
        });
}

// 🆕 渲染採購單表格
function renderPurchaseOrdersTable(purchaseOrders) {
    const poTbody = document.getElementById('purchase-orders-tbody');
    if (!poTbody) return;

    let html = '';
    purchaseOrders.forEach(po => {
        const deliveryDate = po.updated_delivery_date || po.original_delivery_date || '-';
        const statusMap = {
            'open': '<span style="color: green;">未結案</span>',
            'closed': '<span style="color: gray;">已結案</span>',
            'updated': '<span style="color: blue;">已更新</span>'
        };
        const status = statusMap[po.status] || po.status;

        html += `
            <tr>
                <td>${po.po_number}</td>
                <td>${po.supplier || '-'}</td>
                <td>
                    訂購: ${po.ordered_quantity}<br>
                    <small style="color: #666;">未交: ${po.outstanding_quantity}</small>
                </td>
                <td>${deliveryDate}</td>
                <td>${status}</td>
                <td>
                    <button class="small secondary" onclick="fillDeliveryFormFromPO('${po.po_number}')">
                        帶入
                    </button>
                </td>
            </tr>
        `;
    });

    poTbody.innerHTML = html;

    // 將採購單資料儲存到全域變數，供選擇器使用
    window.currentPurchaseOrders = purchaseOrders;
}

// 🆕 填充採購單選擇器
function populatePOSelect(purchaseOrders) {
    const poSelect = document.getElementById('po-select');
    if (!poSelect) return;

    let html = '<option value="">-- 新建交期記錄 (不關聯採購單) --</option>';

    // 只顯示未結案或有未交數量的採購單
    const activePOs = purchaseOrders.filter(po => po.outstanding_quantity > 0 || po.status !== 'closed');

    activePOs.forEach(po => {
        const deliveryDate = po.updated_delivery_date || po.original_delivery_date || '未定';
        html += `<option value="${po.po_number}">
            ${po.po_number} - ${po.supplier || '未知供應商'} (未交: ${po.outstanding_quantity}, 交期: ${deliveryDate})
        </option>`;
    });

    poSelect.innerHTML = html;
}

// 🆕 從採購單帶入資料到表單 (供表格按鈕使用)
window.fillDeliveryFormFromPO = function (poNumber) {
    const poSelect = document.getElementById('po-select');
    if (poSelect) {
        poSelect.value = poNumber;
        // 觸發 change 事件
        const event = new Event('change');
        poSelect.dispatchEvent(event);
    }
};
