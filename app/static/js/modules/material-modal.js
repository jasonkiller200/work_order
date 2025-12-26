/**
 * 物料彈窗模組
 * 處理物料詳情彈窗的顯示和互動
 */

// 避免重複綁定
if (!window.setupModal) {
    window.setupModal = setupModal;
}

if (!window.openDetailsModal) {
    window.openDetailsModal = openDetailsModal;
}

function setupModal() {
    const modal = document.getElementById('details-modal');
    // ... code continues ...
    if (!modal) return;

    const closeModalBtn = document.getElementById('close-modal-btn');
    const closeLink = modal.querySelector('.close');

    const closeModal = () => modal.close();

    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', closeModal);
    }
    if (closeLink) {
        closeLink.addEventListener('click', (e) => { e.preventDefault(); closeModal(); });
    }

    modal.querySelectorAll('.tab-link').forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            const tabId = this.dataset.tab;
            modal.querySelectorAll('.tab-link').forEach(l => l.classList.remove('active'));
            modal.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            document.getElementById(tabId).classList.add('active');
        });
    });

    // 🆕 設定採購人員編輯模態視窗的關閉邏輯
    const buyerModal = document.getElementById('buyer-modal');
    if (buyerModal) {
        const closeBuyerModalBtn = document.getElementById('close-buyer-modal');
        const closeBuyerModal = () => buyerModal.close();
        if (closeBuyerModalBtn) {
            closeBuyerModalBtn.addEventListener('click', (e) => { e.preventDefault(); closeBuyerModal(); });
        }
    }
}


function openDetailsModal(materialId) {
    const modal = document.getElementById('details-modal');

    // 🆕 先設定基本標題，後續從API取得詳細資訊後再更新
    document.getElementById('modal-title').textContent = `物料詳情: ${materialId}`;

    document.getElementById('stock-summary-section').style.display = 'block';
    document.getElementById('unrestricted-stock').textContent = '載入中...';
    document.getElementById('inspection-stock').textContent = '載入中...';
    document.getElementById('on-order-stock').textContent = '載入中...';

    // 清空替代品區域
    const substituteSection = document.getElementById('substitute-section');
    if (substituteSection) {
        substituteSection.innerHTML = '<p>載入中...</p>';
    }

    document.getElementById('tab-demand').innerHTML = '<p>載入中...</p>';

    // 隱藏替代版本分頁，只保留需求訂單分頁
    modal.querySelectorAll('.tab-link').forEach(l => {
        l.classList.remove('active');
        const tabName = l.getAttribute('data-tab');
        if (tabName === 'tab-substitute') {
            l.classList.add('hidden');
        } else {
            l.classList.remove('hidden');
        }
    });
    modal.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('.tab-link[data-tab="tab-demand"]').classList.add('active');
    document.getElementById('tab-demand').classList.add('active');

    modal.showModal();

    // 根據當前儀表板類型傳遞參數
    const dashboardType = currentDashboardType;
    fetch(`/api/material/${materialId}/details?type=${dashboardType}`)
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => Promise.reject(err));
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                throw new Error(data.error);
            }

            // 🆕 更新標題，顯示物料說明（分兩行顯示）
            const description = data.material_description || '無說明';
            const modalTitle = document.getElementById('modal-title');
            modalTitle.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
                    <div>
                        <div>物料詳情: ${materialId}</div>
                        <div style="font-size: 0.85em; font-weight: normal; color: var(--pico-muted-color); margin-top: 0.3em;">${description}</div>
                    </div>
                    <div style="text-align: right; font-size: 0.9em; padding-right: 2em;">
                        <span class="drawing-edit-link" data-part-number="${materialId}" data-drawing="${data.drawing_number || ''}" style="cursor: pointer; color: var(--pico-primary); border-bottom: 1px dashed;">
                            圖號: ${data.drawing_number || '未設定'} 🖊️
                        </span>
                    </div>
                </div>
            `;

            // 🆕 綁定圖號編輯事件
            const drawingLink = modalTitle.querySelector('.drawing-edit-link');
            if (drawingLink) {
                drawingLink.addEventListener('click', function (e) {
                    e.stopPropagation();
                    const partNo = this.dataset.partNumber;
                    const currentDrawing = this.dataset.drawing;
                    promptUpdateDrawingNumber(partNo, currentDrawing);
                });
            }

            // 更新庫存總覽
            document.getElementById('unrestricted-stock').textContent = data.stock_summary.unrestricted.toFixed(0);
            document.getElementById('inspection-stock').textContent = data.stock_summary.inspection.toFixed(0);
            document.getElementById('on-order-stock').textContent = data.stock_summary.on_order.toFixed(0);

            // 顯示替代品資訊在庫存總覽下方
            let subHTML = '<h4 style="margin-top: 1em; margin-bottom: 0.5em; color: var(--pico-primary);">可替代版本</h4>';
            if (data.substitute_inventory && data.substitute_inventory.length > 0) {
                subHTML += '<table style="font-size: 0.9em;"><thead><tr><th>通知</th><th>物料</th><th>說明</th><th>庫存</th><th>品檢中</th><th>總需求數</th></tr></thead><tbody>';
                data.substitute_inventory.forEach(s => {
                    const totalDemand = s.total_demand || 0;
                    const isNotified = localStorage.getItem(`notify_${s['物料']}`) === 'true';
                    const checkedAttr = isNotified ? 'checked' : '';
                    subHTML += `<tr>
                        <td><input type="checkbox" ${checkedAttr} onchange="toggleSubstituteNotify('${s['物料']}')"></td>
                        <td>${s['物料']}</td>
                        <td>${s['物料說明']}</td>
                        <td>${s.unrestricted_stock.toFixed(0)}</td>
                        <td>${s.inspection_stock.toFixed(0)}</td>
                        <td>${totalDemand.toFixed(0)}</td>
                    </tr>`;
                });
                subHTML += '</tbody></table>';
            } else {
                subHTML += '<p style="font-size: 0.9em; color: var(--pico-muted-color);">沒有找到可用的替代版本。</p>';
            }

            const substituteSection = document.getElementById('substitute-section');
            if (substituteSection) {
                substituteSection.innerHTML = subHTML;
            }

            // 🆕 儲存需求資料到全域變數供採購單表格使用
            window.currentDemandDetails = data.demand_details || [];

            // 🆕 載入採購單資料(在需求資料載入完成後)
            loadPurchaseOrders(materialId);

            // 🆕 計算並顯示缺料警示
            const shortageAlertEl = document.getElementById('shortage-alert');
            const totalAvailable = data.stock_summary.unrestricted + data.stock_summary.inspection + data.stock_summary.on_order;
            const totalDemand = data.demand_details.reduce((sum, d) => sum + d['未結數量 (EINHEIT)'], 0);
            const shortage = Math.max(0, totalDemand - totalAvailable);

            if (shortageAlertEl && shortage > 0) {
                shortageAlertEl.style.display = 'block';

                const shortageQtyEl = document.getElementById('current-shortage-qty');
                if (shortageQtyEl) {
                    shortageQtyEl.textContent = shortage.toFixed(0);
                }

                // 🔧 找開始缺料的需求日（而不是最早需求日）
                let shortageStartDate = '-';
                let runningStock = totalAvailable;

                for (const demand of data.demand_details) {
                    runningStock -= demand['未結數量 (EINHEIT)'];
                    if (runningStock < 0 && shortageStartDate === '-') {
                        // 這是第一筆造成缺料的需求
                        shortageStartDate = demand['需求日期'];
                        break;
                    }
                }

                // 如果都會缺料，就用第一筆需求日
                if (shortageStartDate === '-' && data.demand_details.length > 0) {
                    shortageStartDate = data.demand_details[0]['需求日期'];
                }

                const demandDateEl = document.getElementById('earliest-demand-date');
                if (demandDateEl) {
                    demandDateEl.textContent = shortageStartDate;
                }

                // 建議採購數量
                const suggestedQty = Math.ceil(shortage * 1.1);
                const deliveryQtyEl = document.getElementById('delivery-qty');
                if (deliveryQtyEl) {
                    deliveryQtyEl.value = suggestedQty;
                    deliveryQtyEl.placeholder = `建議: ${suggestedQty}`;
                }

                // 建議到貨日期（開始缺料需求日 - 3天）
                if (shortageStartDate !== '-') {
                    try {
                        const demandDate = new Date(shortageStartDate);
                        demandDate.setDate(demandDate.getDate() - 3);
                        const deliveryDateEl = document.getElementById('delivery-date');
                        if (deliveryDateEl) {
                            deliveryDateEl.value = demandDate.toISOString().split('T')[0];
                        }
                    } catch (e) {
                        // 忽略日期轉換錯誤
                    }
                }
            } else if (shortageAlertEl) {
                shortageAlertEl.style.display = 'none';
            }

            // 🆕 載入現有交期資料（只在元素存在時執行）
            if (typeof loadExistingDelivery === 'function') {
                loadExistingDelivery(materialId);
            }

            // 🆕 綁定交期表單事件（只在元素存在時執行）
            if (typeof setupDeliveryFormEvents === 'function') {
                setupDeliveryFormEvents(materialId, data);
            }

            // 顯示需求訂單
            let demandHTML = '<table><thead><tr><th>訂單號碼</th><th>未結數量</th><th>需求日期</th><th>預計剩餘庫存</th></tr></thead><tbody>';
            if (data.demand_details && data.demand_details.length > 0) {
                data.demand_details.forEach(d => {
                    const shortageClass = d.is_shortage_point ? ' class="shortage-warning"' : '';
                    demandHTML += `<tr>
                        <td>${d['訂單']}</td>
                        <td${shortageClass}>${d['未結數量 (EINHEIT)'].toFixed(0)}</td>
                        <td>${d['需求日期']}</td>
                        <td>${d.remaining_stock.toFixed(0)}</td>
                    </tr>`;
                });
            } else {
                demandHTML += '<tr><td colspan="4">沒有找到相關的需求訂單。</td></tr>';
            }
            demandHTML += '</tbody></table>';
            document.getElementById('tab-demand').innerHTML = demandHTML;
        })
        .catch(error => {
            console.error('Error fetching details:', error);
            const errorMsg = error.error || error.message || '未知錯誤';
            document.getElementById('unrestricted-stock').textContent = '-';
            document.getElementById('inspection-stock').textContent = '-';
            document.getElementById('on-order-stock').textContent = '-';

            const substituteSection = document.getElementById('substitute-section');
            if (substituteSection) {
                substituteSection.innerHTML = '<p style="color:red;">載入替代版本時發生錯誤。</p>';
            }

            document.getElementById('tab-demand').innerHTML = `<p style="color:red;">載入需求時發生錯誤: ${errorMsg}</p>`;
        });
}

// 明確指定給 window 物件
window.openBuyerReferenceModal = openBuyerReferenceModal;

function openBuyerReferenceModal(materialId) {
    // 🆕 改用獨立的 buyer-modal
    const modal = document.getElementById('buyer-modal');
    if (!modal) return;

    // 清空並顯示載入中
    document.getElementById('buyer-modal-content').innerHTML = '<p>載入中...</p>';

    modal.showModal();

    // 取得當前儀表板類型
    const dashboardType = currentDashboardType;

    fetch(`/api/material/${materialId}/buyer_reference?type=${dashboardType}`)
        .then(response => response.json())
        .then(data => {
            // 先取得所有採購人員清單
            fetch('/api/buyers_list')
                .then(response => response.json())
                .then(buyersData => {
                    let buyerHTML = '<h4>該物料上下25筆採購人員參考（點擊下拉選單可修改採購人員）</h4>';
                    buyerHTML += '<table><thead><tr><th>物料</th><th>物料說明</th><th>採購人員</th></tr></thead><tbody>';

                    if (data.reference_list && data.reference_list.length > 0) {
                        data.reference_list.forEach(item => {
                            const isCurrentMaterial = item['物料'] === materialId;
                            const rowClass = isCurrentMaterial ? ' class="current-material-row"' : '';
                            const currentBuyer = item['採購人員'] || '';

                            // 建立採購人員下拉選單
                            let buyerSelect = `<select class="buyer-select" data-material-id="${item['物料']}" data-dashboard-type="${dashboardType}">`;
                            buyerSelect += `<option value="">未指定</option>`;
                            buyersData.buyers.forEach(buyer => {
                                const selected = buyer === currentBuyer ? 'selected' : '';
                                buyerSelect += `<option value="${buyer}" ${selected}>${buyer}</option>`;
                            });
                            buyerSelect += `</select>`;

                            buyerHTML += `<tr${rowClass}>
                                <td>${item['物料']}</td>
                                <td>${item['物料說明']}</td>
                                <td>${buyerSelect}</td>
                            </tr>`;
                        });
                    } else {
                        buyerHTML += '<tr><td colspan="3">沒有找到相關的採購人員資料。</td></tr>';
                    }

                    buyerHTML += '</tbody></table>';
                    buyerHTML += '</tbody></table>';
                    // 🆕 渲染到 buyer-modal-content
                    document.getElementById('buyer-modal-content').innerHTML = buyerHTML;

                    // 綁定下拉選單變更事件
                    bindBuyerSelectEvents();
                })
                .catch(error => {
                    console.error('Error fetching buyers list:', error);
                    let buyerHTML = '<h4>該物料上下25筆採購人員參考</h4>';
                    buyerHTML += '<table><thead><tr><th>物料</th><th>物料說明</th><th>採購人員</th></tr></thead><tbody>';

                    if (data.reference_list && data.reference_list.length > 0) {
                        data.reference_list.forEach(item => {
                            const isCurrentMaterial = item['物料'] === materialId;
                            const rowClass = isCurrentMaterial ? ' class="current-material-row"' : '';
                            buyerHTML += `<tr${rowClass}>
                                <td>${item['物料']}</td>
                                <td>${item['物料說明']}</td>
                                <td>${item['採購人員'] || '-'}</td>
                            </tr>`;
                        });
                    }

                    buyerHTML += '</tbody></table>';
                    buyerHTML += '<p style="color: orange;">無法載入採購人員清單，顯示為唯讀模式。</p>';
                    // 🆕 渲染到 buyer-modal-content
                    document.getElementById('buyer-modal-content').innerHTML = buyerHTML;
                });
        })
        .catch(error => {
            console.error('Error fetching buyer reference:', error);
            // 🆕 渲染到 buyer-modal-content
            document.getElementById('buyer-modal-content').innerHTML = '<p style="color:red;">載入採購人員參考時發生錯誤。</p>';
        });
}

function bindBuyerSelectEvents() {
    document.querySelectorAll('.buyer-select').forEach(select => {
        select.addEventListener('change', function () {
            const materialId = this.dataset.materialId;
            const newBuyer = this.value;
            const dashboardType = this.dataset.dashboardType;
            const originalValue = this.getAttribute('data-original-value') || '';

            // 暫時禁用選單
            this.disabled = true;
            this.style.opacity = '0.6';

            // 儲存採購人員變更
            fetch('/api/update_buyer', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    material_id: materialId,
                    buyer: newBuyer,
                    dashboard_type: dashboardType
                })
            })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        // 顯示成功訊息
                        this.style.backgroundColor = '#d4edda';
                        this.style.borderColor = '#c3e6cb';
                        setTimeout(() => {
                            this.style.backgroundColor = '';
                            this.style.borderColor = '';
                        }, 1500);

                        // 更新快取資料
                        if (dashboardType === 'finished') {
                            const material = currentFinishedMaterialsData.find(m => m['物料'] === materialId);
                            if (material) {
                                material['採購人員'] = newBuyer;
                            }
                        } else {
                            const material = currentMaterialsData.find(m => m['物料'] === materialId);
                            if (material) {
                                material['採購人員'] = newBuyer;
                            }
                        }

                        // 重新渲染表格以反映變更
                        renderMaterialsTable();
                    } else {
                        // 顯示錯誤訊息
                        alert('儲存失敗: ' + (data.error || '未知錯誤'));
                        this.value = originalValue;
                    }
                })
                .catch(error => {
                    console.error('Error updating buyer:', error);
                    alert('儲存採購人員時發生錯誤');
                    this.value = originalValue;
                })
                .finally(() => {
                    // 重新啟用選單
                    this.disabled = false;
                    this.style.opacity = '1';
                });
        });

        // 儲存原始值
        select.setAttribute('data-original-value', select.value);
    });
}

function loadPurchaseOrders(materialId) {
    const poSection = document.getElementById('purchase-orders-section');
    const poTbody = document.getElementById('purchase-orders-tbody');
    const poSelect = document.getElementById('po-select');

    if (!poSection || !poTbody) return;

    // 顯示載入中
    poSection.style.display = 'block';
    poTbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">載入中...</td></tr>';

    // 🆕 同時載入採購單和分批交期資料
    Promise.all([
        fetch(`/api/purchase_orders/${materialId}`).then(r => r.json()),
        fetch(`/api/delivery/${materialId}`).then(r => r.json())
    ])
        .then(([purchaseOrders, deliveryData]) => {
            if (purchaseOrders.error) {
                poTbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: red;">${purchaseOrders.error}</td></tr>`;
                return;
            }

            if (purchaseOrders.length === 0) {
                // 🆕 友善的無採購單提示
                poTbody.innerHTML = `
                    <tr>
                        <td colspan="6" style="text-align: center; padding: 2em;">
                            <div style="background: var(--pico-card-background-color, #1a1f36); padding: 1.5em; border-radius: 8px; border: 1px solid var(--pico-muted-border-color);">
                                <div style="font-size: 2em; margin-bottom: 0.5em;">📋</div>
                                <div style="font-weight: bold; margin-bottom: 0.5em; color: var(--pico-primary, #3b82f6); font-size: 1.1em;">此物料目前無採購單記錄</div>
                                <div style="font-size: 0.9em; color: var(--pico-color, #d1d5db);">
                                    您可以在下方「📅 交期維護」中直接填寫預計交期<br>
                                    <small style="color: var(--pico-muted-color, #9ca3af); margin-top: 0.3em; display: inline-block;">
                                        ※ 採購單號可留空，或填寫預計採購單號（例如：預採-20251215-001）
                                    </small>
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
                // 清空並重置選擇器
                if (poSelect) {
                    poSelect.innerHTML = '<option value="">-- 新建交期記錄 (不關聯採購單) --</option>';
                }

                // 🆕 在交期維護表單上方加入提示
                addNoPurchaseOrderHint();
                return;
            }

            // 🆕 將分批交期資料附加到採購單上
            const deliveryHistory = deliveryData.history || [];
            purchaseOrders.forEach(po => {
                // 找出該採購單的所有分批交期(按日期排序)
                po.delivery_schedules = deliveryHistory
                    .filter(d => d.po_number === po.po_number && d.status !== 'completed' && d.status !== 'cancelled')
                    .sort((a, b) => new Date(a.expected_date) - new Date(b.expected_date));
            });

            // 渲染表格
            renderPurchaseOrdersTable(purchaseOrders);

            // 填充選擇器
            populatePOSelect(purchaseOrders);
        })
        .catch(error => {
            console.error('Error loading purchase orders:', error);
            poTbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: red;">載入失敗</td></tr>';
        });
}

function renderPurchaseOrdersTable(purchaseOrders) {
    const poTbody = document.getElementById('purchase-orders-tbody');
    if (!poTbody) return;

    // 🆕 獲取需求資料(從全域變數或當前物料資料)
    const demandDetails = window.currentDemandDetails || [];

    // 🆕 找出第一筆已欠料的需求(預計剩餘庫存 < 0)
    const firstShortage = demandDetails.find(d => (d.remaining_stock || 0) < 0);

    let html = '';
    purchaseOrders.forEach(po => {
        let status = '';
        if (po.outstanding_quantity <= 0) {
            status = '<span style="color: #4caf50;">✓ 已完成</span>';
        } else if (po.delivery_schedules && po.delivery_schedules.length > 0) {
            status = `<span style="color: #2196f3;">📦 ${po.delivery_schedules.length}批</span>`;
        } else {
            status = '<span style="color: #ff9800;">待交貨</span>';
        }

        let deliveryHTML = '';
        if (po.delivery_schedules && po.delivery_schedules.length > 0) {
            deliveryHTML = po.delivery_schedules.map((schedule, idx) => {
                const scheduleDate = new Date(schedule.expected_date);
                const today = new Date();
                const diffDays = Math.ceil((scheduleDate - today) / (1000 * 60 * 60 * 24));

                let colorStyle = '';
                if (diffDays < 0) {
                    colorStyle = 'color: #d32f2f; font-weight: bold;';
                } else if (diffDays <= 7) {
                    colorStyle = 'color: #ff9800; font-weight: bold;';
                } else if (diffDays <= 30) {
                    colorStyle = 'color: #4caf50; font-weight: bold;';
                }

                const batchLabel = idx === 0 ? '' : `<small style="color: #666;">第${idx + 1}批: </small>`;

                // 🆕 如果是第一筆且有欠料需求,檢查是否延遲
                let shortageInfo = '';
                if (idx === 0 && firstShortage) {
                    console.log('🔍 檢查延遲:', {
                        firstShortage,
                        scheduleDate: schedule.expected_date,
                        demandDate: firstShortage['需求日期'],
                        remaining_stock: firstShortage.remaining_stock
                    });

                    const demandDate = new Date(firstShortage['需求日期']);
                    if (scheduleDate > demandDate) {
                        const delayDays = Math.ceil((scheduleDate - demandDate) / (1000 * 60 * 60 * 24));
                        const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
                        const warningColor = isDarkMode ? '#ffcdd2' : '#c62828';
                        shortageInfo = `<br><small style="color: ${warningColor}; font-size: 0.75em;">⚠️ 工單 ${firstShortage['訂單']} 需求 ${firstShortage['需求日期']} 延遲 ${delayDays}天</small>`;
                        console.log('✅ 延遲警告已生成:', shortageInfo);
                    } else {
                        console.log('❌ 交期未延遲');
                    }
                } else {
                    console.log('❌ 無延遲檢查:', { idx, hasFirstShortage: !!firstShortage });
                }

                return `<div style="margin-bottom: 0.3em;">
                    ${batchLabel}<span style="${colorStyle}">${schedule.expected_date}</span> 
                    <small style="color: #888;">(${Math.round(schedule.quantity)}件)</small>${shortageInfo}
                </div>`;
            }).join('');
        } else {
            // 沒有分批交期,顯示原始交期
            const deliveryDate = po.updated_delivery_date || po.original_delivery_date || '-';
            deliveryHTML = deliveryDate;
        }

        html += `
            <tr>
                <td>${po.po_number}</td>
                <td>${po.supplier || '-'}</td>
                <td>
                    訂購: ${po.ordered_quantity}<br>
                    <small style="color: #666;">未交: ${po.outstanding_quantity}</small>
                </td>
                <td style="min-width: 180px;">${deliveryHTML}</td>
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

function populatePOSelect(purchaseOrders) {
    const poSelect = document.getElementById('po-select');
    if (!poSelect) return;

    let html = '<option value="">-- 新建交期記錄 (不關聯採購單) --</option>';

    // 🆕 所有未結案的採購單都會顯示（API已過濾completed和cancelled）
    purchaseOrders.forEach(po => {
        const deliveryDate = po.updated_delivery_date || po.original_delivery_date || '未定';
        html += `<option value="${po.po_number}">
            ${po.po_number} - ${po.supplier || '未知供應商'} (未交: ${po.outstanding_quantity}, 交期: ${deliveryDate})
        </option>`;
    });

    poSelect.innerHTML = html;
}

window.fillDeliveryFormFromPO = function (poNumber) {
    const poSelect = document.getElementById('po-select');
    if (poSelect) {
        poSelect.value = poNumber;
        // 觸發 change 事件
        const event = new Event('change');
        poSelect.dispatchEvent(event);
    }
};

function addNoPurchaseOrderHint() {
    const deliveryFormSection = document.getElementById('delivery-form-section');
    if (!deliveryFormSection) return;

    // 移除舊的提示（如果有）
    const oldHint = deliveryFormSection.querySelector('.no-po-hint');
    if (oldHint) oldHint.remove();

    // 新增提示訊息
    const hint = document.createElement('div');
    hint.className = 'no-po-hint';
    hint.style.cssText = `
        padding: 1.2em;
        margin-bottom: 1em;
        background: var(--pico-card-background-color, #1e293b);
        border-left: 4px solid var(--pico-primary, #3b82f6);
        border-radius: 6px;
        font-size: 0.9em;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    `;
    hint.innerHTML = `
        <div style="display: flex; align-items: start; gap: 0.8em;">
            <div style="font-size: 1.5em;">💡</div>
            <div style="flex: 1;">
                <div style="font-weight: bold; margin-bottom: 0.5em; color: var(--pico-primary, #3b82f6); font-size: 1.05em;">此物料目前無採購單記錄</div>
                <div style="color: var(--pico-color, #cbd5e1); line-height: 1.6;">
                    您可以直接填寫預計交期，系統會自動記錄：
                    <ul style="margin: 0.8em 0 0 1.5em; padding: 0; color: var(--pico-muted-color, #94a3b8);">
                        <li style="margin-bottom: 0.3em;">採購單號可留空，或填寫預計單號（例如：預採-20251215-001）</li>
                        <li style="margin-bottom: 0.3em;">供應商可填寫預計供應商名稱</li>
                        <li>之後有正式採購單時，可隨時更新</li>
                    </ul>
                </div>
            </div>
        </div>
    `;

    // 插入到表單標題之後
    const formTitle = deliveryFormSection.querySelector('.delivery-form-title');
    if (formTitle && formTitle.nextSibling) {
        deliveryFormSection.insertBefore(hint, formTitle.nextSibling);
    } else {
        deliveryFormSection.insertBefore(hint, deliveryFormSection.firstChild);
    }
}

function removeNoPurchaseOrderHint() {
    const hint = document.querySelector('.no-po-hint');
    if (hint) hint.remove();
}

/**
 * 🆕 提示更新圖號
 */
function promptUpdateDrawingNumber(partNumber, currentDrawing) {
    const newDrawing = prompt(`請輸入品號 ${partNumber} 的新圖號:`, currentDrawing);

    if (newDrawing === null) return; // 使用者取消

    // 如果沒變，就不處理
    if (newDrawing === currentDrawing) return;

    // 🆕 只使用前10碼
    const partNumberPrefix = partNumber.length >= 10 ? partNumber.substring(0, 10) : partNumber;

    // 呼叫 API 更新
    fetch(`/api/part-drawing/${partNumberPrefix}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            drawing_number: newDrawing
        })
    })
        .then(response => {
            if (!response.ok) {
                // 如果是 404，表示該品號在對照表中不存在，需改用 POST 新增
                if (response.status === 404) {
                    return fetch('/api/part-drawing', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            part_number: partNumberPrefix,  // 🆕 只儲存前10碼
                            drawing_number: newDrawing
                        })
                    }).then(res => res.json());
                }
                return response.json().then(err => Promise.reject(err));
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                alert(`更新失敗: ${data.error}`);
            } else {
                alert('圖號已更新');
                // 重新載入物料詳情以顯示最新資料
                location.reload();
            }
        })
        .catch(error => {
            console.error('更新圖號失敗:', error);
            alert('更新失敗,請稍後再試');
        });
}

/**
 * 🆕 更新主畫面快取中的圖號
 */
function updateMainCacheDrawing(partNumber, newDrawing) {
    // 遍歷主儀表板資料
    const mainItem = currentMaterialsData.find(m => m['物料'] === partNumber);
    if (mainItem) {
        mainItem['drawing_number'] = newDrawing;
    }

    // 遍歷成品儀表板資料
    const finishedItem = currentFinishedMaterialsData.find(m => m['物料'] === partNumber);
    if (finishedItem) {
        finishedItem['drawing_number'] = newDrawing;
    }

    // 重新渲染表格（雖然欄位沒顯示，但匯出會用到）
    if (typeof renderMaterialsTable === 'function') {
        renderMaterialsTable();
    }
}

document.addEventListener('DOMContentLoaded', function () {
    setupModal();
});

