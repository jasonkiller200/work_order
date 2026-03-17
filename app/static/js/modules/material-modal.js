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

    // 根據當前儀表板類型傳遞參數 (如果未定義則使用 'main' 作為預設值)
    const dashboardType = typeof currentDashboardType !== 'undefined' ? currentDashboardType : 'main';
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

            // 🆕 儲存當前物料 ID 到全域變數供 toggle 函數使用
            window.currentModalMaterialId = materialId;

            // 顯示替代品資訊在庫存總覽下方 (先載入通知狀態再顯示)
            if (data.substitute_inventory && data.substitute_inventory.length > 0) {
                // 🆕 有替代品時，顯示替代版本頁籤
                const substituteTab = modal.querySelector('.tab-link[data-tab="tab-substitute"]');
                if (substituteTab) {
                    substituteTab.classList.remove('hidden');
                }

                // 從 API 載入該物料的替代品通知設定
                fetch(`/api/substitute_notification/list/${materialId}`)
                    .then(res => res.json())
                    .then(notifyData => {
                        const notifiedList = notifyData.notified_substitutes || [];
                        renderSubstituteSection(data.substitute_inventory, notifiedList, materialId);
                    })
                    .catch(err => {
                        console.error('Error loading substitute notifications:', err);
                        renderSubstituteSection(data.substitute_inventory, [], materialId);
                    });
            } else {
                let subHTML = '<h4 style="margin-top: 1em; margin-bottom: 0.5em; color: var(--pico-primary);">可替代版本</h4>';
                subHTML += '<p style="font-size: 0.9em; color: var(--pico-muted-color);">沒有找到可用的替代版本。</p>';
                const substituteSection = document.getElementById('substitute-section');
                if (substituteSection) {
                    substituteSection.innerHTML = subHTML;
                }
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

            // 🆕 初始化交期日期選擇器 (Flatpickr)
            const deliveryDateEl = document.getElementById('delivery-date');
            // 使用函式開頭定義的 modal 變數，不要重複宣告
            if (deliveryDateEl && typeof flatpickr !== 'undefined') {
                // 🆕 禁用瀏覽器自動填入，避免遮擋日期選擇器
                deliveryDateEl.setAttribute('autocomplete', 'off');
                deliveryDateEl.setAttribute('data-lpignore', 'true');  // 禁用 LastPass
                deliveryDateEl.setAttribute('data-form-type', 'other');  // 禁用其他密碼管理器

                // 如果已有 flatpickr 實例，先銷毀
                if (deliveryDateEl._flatpickr) {
                    deliveryDateEl._flatpickr.destroy();
                }
                // 找到 modal 內的 article 元素作為 appendTo 目標
                // 這樣 calendar 會在 dialog 的 top-layer 內渲染，不會被遮住
                const modalArticle = modal ? modal.querySelector('article') : null;
                // 🆕 初始化 flatpickr，並整合假日功能
                const initFlatpickr = () => {
                    flatpickr(deliveryDateEl, {
                        locale: 'zh_tw',
                        dateFormat: 'Y-m-d',
                        minDate: 'today',
                        allowInput: true,
                        defaultDate: deliveryDateEl.value || null,
                        appendTo: modalArticle || document.body,  // 附加到 modal 內
                        static: true,  // 使用 static 定位，相對於 input 位置
                        // 🆕 禁用週六、週日和台灣假日
                        disable: [
                            function (date) {
                                // 0 = 週日, 6 = 週六
                                if (date.getDay() === 0 || date.getDay() === 6) {
                                    return true;
                                }
                                // 檢查台灣假日
                                if (typeof HolidayUtils !== 'undefined' && HolidayUtils.isHoliday(date)) {
                                    return true;
                                }
                                return false;
                            }
                        ],
                        // 🆕 標記假日和週末
                        onDayCreate: function (dObj, dStr, fp, dayElem) {
                            const date = dayElem.dateObj;
                            const day = date.getDay();

                            // 標記週末
                            if (day === 0 || day === 6) {
                                dayElem.classList.add('weekend');
                            }

                            // 標記假日
                            if (typeof HolidayUtils !== 'undefined') {
                                const holidayName = HolidayUtils.getHolidayName(date);
                                if (holidayName) {
                                    dayElem.classList.add('holiday');
                                    dayElem.title = holidayName;
                                }
                            }
                        }
                    });
                };

                // 確保假日資料載入後再初始化
                if (typeof HolidayUtils !== 'undefined' && HolidayUtils.isReady()) {
                    initFlatpickr();
                } else if (typeof HolidayUtils !== 'undefined') {
                    // 等待假日資料載入
                    HolidayUtils.waitForInit().then(initFlatpickr);
                } else {
                    // 沒有 HolidayUtils，直接初始化
                    initFlatpickr();
                }
            }

            // 顯示需求訂單
            let demandHTML = '<table><thead><tr><th>訂單號碼</th><th>未結數量</th><th>需求日期</th><th>預計剩餘庫存</th></tr></thead><tbody>';
            if (data.demand_details && data.demand_details.length > 0) {
                data.demand_details.forEach(d => {
                    const shortageClass = d.is_shortage_point ? ' class="shortage-warning"' : '';
                    const orderId = d['訂單'];
                    const isClickable = orderId && (orderId.startsWith('1') || orderId.startsWith('2') || orderId.startsWith('6'));
                    const orderCell = isClickable
                        ? `<span class="material-link" onclick="showOrderInfoPopup('${orderId}', event)">${orderId}</span>`
                        : orderId;
                    demandHTML += `<tr>
                        <td>${orderCell}</td>
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

    // 🆕 同時載入採購單、鑄件訂單和分批交期資料
    Promise.all([
        fetch(`/api/purchase_orders/${materialId}`).then(r => r.json()),
        fetch(`/api/casting_orders/${materialId}`).then(r => r.json()),
        fetch(`/api/delivery/${materialId}`).then(r => r.json())
    ])
        .then(([purchaseOrders, castingOrders, deliveryData]) => {
            if (purchaseOrders.error) {
                purchaseOrders = [];
            }
            if (castingOrders.error) {
                castingOrders = [];
            }

            const hasPurchaseOrders = purchaseOrders.length > 0;
            const hasCastingOrders = castingOrders.length > 0;

            if (!hasPurchaseOrders && !hasCastingOrders) {
                // 🆕 友善的無採購單提示
                poTbody.innerHTML = `
                    <tr>
                        <td colspan="6" style="text-align: center; padding: 2em;">
                            <div style="background: var(--pico-card-background-color, #1a1f36); padding: 1.5em; border-radius: 8px; border: 1px solid var(--pico-muted-border-color);">
                                <div style="font-size: 2em; margin-bottom: 0.5em;">📋</div>
                                <div style="font-weight: bold; margin-bottom: 0.5em; color: var(--pico-primary, #3b82f6); font-size: 1.1em;">此物料目前無採購單/鑄件訂單記錄</div>
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

            // 🔧 先將交期歷史存到全域變數，供表格和下拉選單使用
            window.currentDeliveryHistory = deliveryHistory;

            purchaseOrders.forEach(po => {
                // 找出該採購單的所有分批交期(按日期排序)
                po.delivery_schedules = deliveryHistory
                    .filter(d => d.po_number === po.po_number && d.status !== 'completed' && d.status !== 'cancelled')
                    .sort((a, b) => new Date(a.expected_date) - new Date(b.expected_date));
            });

            // 渲染表格 (包含採購單和鑄件訂單)
            renderPurchaseOrdersTable(purchaseOrders, castingOrders);

            // 填充選擇器 (包含採購單和鑄件訂單)
            populatePOSelect(purchaseOrders, castingOrders);
        })
        .catch(error => {
            console.error('Error loading purchase orders:', error);
            poTbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: red;">載入失敗</td></tr>';
        });
}

function renderPurchaseOrdersTable(purchaseOrders, castingOrders = []) {
    const poTbody = document.getElementById('purchase-orders-tbody');
    if (!poTbody) return;

    // 🆕 獲取需求資料(從全域變數或當前物料資料)
    const demandDetails = window.currentDemandDetails || [];

    // 🆕 找出第一筆已欠料的需求(預計剩餘庫存 < 0)
    const firstShortage = demandDetails.find(d => (d.remaining_stock || 0) < 0);

    let html = '';

    // 🆕 如果有鑄件訂單，先顯示鑄件訂單區塊
    if (castingOrders && castingOrders.length > 0) {
        html += `
            <tr>
                <td colspan="6" style="background: rgba(255, 152, 0, 0.1); padding: 0.5em 1em; font-weight: bold; color: #ff9800;">
                    🔧 鑄件訂單（4開頭）- 共 ${castingOrders.length} 筆
                </td>
            </tr>
        `;

        castingOrders.forEach(co => {
            let status = '';
            if (co.outstanding_quantity <= 0) {
                status = '<span style="color: #4caf50;">✓ 已完成</span>';
            } else {
                status = '<span style="color: #ff9800;">待交貨</span>';
            }

            // 🔧 從已維護的交期記錄中查詢該鑄件訂單的交期
            let deliveryHTML = '<span style="color: #888; font-style: italic;">尚未設定</span>';
            const deliveryHistory = window.currentDeliveryHistory || [];
            const maintainedSchedule = deliveryHistory.find(h =>
                h.po_number === co.order_number &&
                h.status !== 'completed' &&
                h.status !== 'cancelled'
            );

            if (maintainedSchedule) {
                const expectedDate = new Date(maintainedSchedule.expected_date);
                const today = new Date();
                const diffDays = Math.ceil((expectedDate - today) / (1000 * 60 * 60 * 24));

                let colorStyle = '';
                if (diffDays < 0) {
                    colorStyle = 'color: #d32f2f; font-weight: bold;';
                } else if (diffDays <= 7) {
                    colorStyle = 'color: #ff9800; font-weight: bold;';
                } else if (diffDays <= 30) {
                    colorStyle = 'color: #4caf50; font-weight: bold;';
                }

                deliveryHTML = `<span style="${colorStyle}">${maintainedSchedule.expected_date}</span> <small style="color: #888;">(${maintainedSchedule.quantity}件)</small>`;
            }

            html += `
                <tr style="background: rgba(255, 152, 0, 0.03);">
                    <td>${co.order_number}</td>
                    <td><small style="color: #888;">鑄件生產</small></td>
                    <td>
                        訂購: ${co.ordered_quantity}<br>
                        <small style="color: #666;">未交: ${co.outstanding_quantity}</small>
                    </td>
                    <td style="min-width: 180px;">${deliveryHTML}</td>
                    <td>${status}</td>
                    <td>
                        <button class="small secondary" onclick="fillDeliveryFormFromPO('${co.order_number}')">
                            帶入
                        </button>
                    </td>
                </tr>
            `;
        });
    }

    // 🆕 如果有採購單，顯示採購單區塊
    if (purchaseOrders && purchaseOrders.length > 0) {
        if (castingOrders && castingOrders.length > 0) {
            // 如果有鑄件訂單，加個分隔標題
            html += `
                <tr>
                    <td colspan="6" style="background: rgba(33, 150, 243, 0.1); padding: 0.5em 1em; font-weight: bold; color: #2196f3;">
                        📦 採購單 - 共 ${purchaseOrders.length} 筆
                    </td>
                </tr>
            `;
        }

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

                    // 如果是第一筆且有欠料需求,檢查是否延遲
                    let shortageInfo = '';
                    if (idx === 0 && firstShortage) {
                        const demandDate = new Date(firstShortage['需求日期']);
                        if (scheduleDate > demandDate) {
                            const delayDays = Math.ceil((scheduleDate - demandDate) / (1000 * 60 * 60 * 24));
                            const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
                            const warningColor = isDarkMode ? '#ffcdd2' : '#c62828';
                            shortageInfo = `<br><small style="color: ${warningColor}; font-size: 0.75em;">⚠️ 工單 ${firstShortage['訂單']} 需求 ${firstShortage['需求日期']} 延遲 ${delayDays}天</small>`;
                        }
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
    }

    poTbody.innerHTML = html;

    // 將採購單資料儲存到全域變數，供選擇器使用
    window.currentPurchaseOrders = purchaseOrders;
}

function populatePOSelect(purchaseOrders, castingOrders = []) {
    const poSelect = document.getElementById('po-select');
    if (!poSelect) return;

    let html = '<option value="">-- 新建交期記錄 (不關聯訂單) --</option>';

    // 🆕 鑄件訂單選項 (4開頭) - 顯示已維護的交期
    if (castingOrders && castingOrders.length > 0) {
        const deliveryHistory = window.currentDeliveryHistory || [];

        html += '<optgroup label="🔧 鑄件訂單">';
        castingOrders.forEach(co => {
            // 從已維護的交期記錄中查詢
            const maintainedSchedule = deliveryHistory.find(h =>
                h.po_number === co.order_number &&
                h.status !== 'completed' &&
                h.status !== 'cancelled'
            );

            const deliveryInfo = maintainedSchedule
                ? `交期: ${maintainedSchedule.expected_date}`
                : '尚未設定';

            html += `<option value="${co.order_number}" data-type="casting">
                ${co.order_number} - 鑄件生產 (未交: ${co.outstanding_quantity}, ${deliveryInfo})
            </option>`;
        });
        html += '</optgroup>';
    }

    // 🆕 採購單選項
    if (purchaseOrders && purchaseOrders.length > 0) {
        html += '<optgroup label="📦 採購單">';
        purchaseOrders.forEach(po => {
            const deliveryDate = po.updated_delivery_date || po.original_delivery_date || '未定';
            html += `<option value="${po.po_number}" data-type="purchase">
                ${po.po_number} - ${po.supplier || '未知供應商'} (未交: ${po.outstanding_quantity}, 交期: ${deliveryDate})
            </option>`;
        });
        html += '</optgroup>';
    }

    poSelect.innerHTML = html;

    // 🆕 儲存鑄件訂單資料到全域變數
    window.currentCastingOrders = castingOrders;
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
    // 遍歷半品儀表板資料
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

// ¶ 點擊訂單號碼顯示工單資訊浮動面板
function showOrderInfoPopup(orderId, event) {
    event.stopPropagation();
    event.preventDefault();

    // 移除先前的 popup
    const existing = document.getElementById('order-info-popup');
    if (existing) existing.remove();

    // 找到 modal 的 article 容器（僅在 modal 開啟時使用，否則掛到 body）
    const modal = document.getElementById('details-modal');
    const modalArticle = (modal && modal.open) ? modal.querySelector('article') : null;
    const container = modalArticle || document.body;

    // 確保容器有 position: relative
    if (container.style.position !== 'relative') {
        container.style.position = 'relative';
    }

    // 建立浮動面板
    const popup = document.createElement('div');
    popup.id = 'order-info-popup';
    popup.style.cssText = `
        position: fixed; z-index: 10000;
        background: var(--bg-card, #1e1e1e); color: var(--text-primary, #e0e0e0);
        border: 1px solid var(--border-default, #333); border-radius: 8px;
        padding: 1em 1.2em; min-width: 260px; max-width: 360px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4); font-size: 0.9em;
    `;
    popup.innerHTML = '<div style="text-align:center; padding: 0.5em;">載入中...</div>';

    // 定位
    const rect = event.target.getBoundingClientRect();
    popup.style.left = Math.min(rect.left, window.innerWidth - 380) + 'px';
    popup.style.top = (rect.bottom + 6) + 'px';
    container.appendChild(popup);

    // 點擊外部關閉
    const closePopup = (e) => {
        if (!popup.contains(e.target) && e.target !== event.target) {
            popup.remove();
            document.removeEventListener('click', closePopup, true);
        }
    };
    setTimeout(() => document.addEventListener('click', closePopup, true), 100);

    // 呼叫 API
    fetch(`/api/order-info/${orderId}`)
        .then(r => r.json())
        .then(data => {
            if (!data.found) {
                popup.innerHTML = `
                    <div style="font-weight:bold; margin-bottom:0.5em;">📋 工單: ${orderId}</div>
                    <div style="color: var(--text-muted, #999);">${data.message || '找不到資訊'}</div>
                `;
                return;
            }

            let html = '';
            if (data.type === 'semi') {
                html = `
                    <div style="font-weight:bold; margin-bottom:0.6em; border-bottom:1px solid var(--border-light,#333); padding-bottom:0.4em;">
                        📋 半品工單: ${orderId}
                    </div>
                    <div style="line-height:1.8;">
                        <div>🏭 品名: <strong>${data.product_name || '-'}</strong></div>
                        <div>🔗 對應成品: <strong>${data.corresponding_finished || '-'}</strong></div>
                        <div>🖥️ 機型: <strong>${data.machine_type || '-'}</strong></div>
                        <div>📅 成品出貨日: <strong style="color: var(--color-warning, #ff9800);">${data.shipment_date || '-'}</strong></div>
                    </div>
                `;
            } else {
                html = `
                    <div style="font-weight:bold; margin-bottom:0.6em; border-bottom:1px solid var(--border-light,#333); padding-bottom:0.4em;">
                        📋 成品工單: ${orderId}
                    </div>
                    <div style="line-height:1.8;">
                        <div>🖥️ 機型: <strong>${data.machine_type || '-'}</strong></div>
                        <div>👤 客戶: <strong>${data.customer || '-'}</strong></div>
                        <div>📅 出貨日: <strong style="color: var(--color-warning, #ff9800);">${data.shipment_date || '-'}</strong></div>
                        <div>🏭 廠別: <strong>${data.factory || '-'}</strong></div>
                    </div>
                `;
            }
            popup.innerHTML = html;
        })
        .catch(err => {
            popup.innerHTML = `<div style="color: var(--color-danger, red);">載入失敗: ${err.message}</div>`;
        });
}
window.showOrderInfoPopup = showOrderInfoPopup;

document.addEventListener('DOMContentLoaded', function () {
    setupModal();
});

// 🆕 渲染替代品區塊 (已載入通知狀態，並顯示可替代的工單需求)
function renderSubstituteSection(substituteInventory, notifiedList, materialId) {
    let subHTML = '<h4 style="margin-top: 1em; margin-bottom: 0.5em; color: var(--pico-primary);">可替代版本</h4>';
    subHTML += '<table style="font-size: 0.9em;"><thead><tr><th>通知</th><th>物料</th><th>說明</th><th>可用庫存</th><th>品檢中</th><th>可替代需求</th></tr></thead><tbody>';

    // 取得當前物料的需求資料（已儲存在全域變數）
    const demandDetails = window.currentDemandDetails || [];

    substituteInventory.forEach((s, idx) => {
        const availableStock = s.unrestricted_stock || 0;
        const inspectionStock = s.inspection_stock || 0;
        const totalDemand = s.total_demand || 0;

        // ✨ 計算「淨可用庫存」: 替代品的可用庫存 - 替代品本身的需求
        const netAvailableStock = Math.max(0, availableStock - totalDemand);

        const isNotified = notifiedList.includes(s['物料']);
        const checkedAttr = isNotified ? 'checked' : '';

        // 計算此替代品可以滿足多少需求 (使用淨可用庫存)
        const coverageInfo = calculateSubstituteCoverage(demandDetails, netAvailableStock);

        let coverageText = '-';
        let coverageStyle = '';

        if (netAvailableStock > 0) {
            coverageText = coverageInfo.coveredCount > 0
                ? `可滿足 ${coverageInfo.coveredCount} 筆工單`
                : '-';
            coverageStyle = coverageInfo.coveredCount > 0
                ? 'color: var(--pico-primary); font-weight: bold;'
                : '';
        } else {
            // 淨庫存不夠
            coverageText = '<span style="color: var(--color-danger, red);"><small>無淨庫存</small></span>';
        }

        subHTML += `<tr>
            <td><input type="checkbox" ${checkedAttr} 
                data-substitute-id="${s['物料']}" 
                data-substitute-idx="${idx}"
                onchange="window.toggleSubstituteNotify('${materialId}', '${s['物料']}', this)"></td>
            <td>${s['物料']}</td>
            <td>${s['物料說明']}</td>
            <td>
                <div>${availableStock.toFixed(0)}</div>
                ${totalDemand > 0 ? `<div style="font-size: 0.85em; color: var(--text-main, #d1d1d1); font-weight: 500; margin-top: 2px;">需: ${totalDemand.toFixed(0)} | <span style="color: var(--pico-primary);">淨: ${netAvailableStock.toFixed(0)}</span></div>` : ''}
            </td>
            <td>${inspectionStock.toFixed(0)}</td>
            <td style="${coverageStyle}">${coverageText}</td>
        </tr>`;

        // 如果已勾選，顯示詳細的工單需求替代表格
        if (isNotified && coverageInfo.coveredOrders.length > 0) {
            subHTML += `<tr><td colspan="6" style="padding: 0;">
                <div style="margin-left: 2em; margin-bottom: 0.5em; background: rgba(255,255,255,0.03); padding: 0.5em; border-radius: 4px;">
                    <strong style="color: var(--pico-primary);">🔄 可替代工單需求 (淨可用庫存 ${netAvailableStock.toFixed(0)} 可滿足)：</strong>
                    <table style="font-size: 0.85em; margin-top: 0.3em;">
                        <thead><tr><th>工單</th><th>需求日期</th><th>需求數量</th><th>滿足狀態</th></tr></thead>
                        <tbody>`;

            let remainingStock = netAvailableStock;
            coverageInfo.coveredOrders.forEach(order => {
                const orderNum = order['訂單'] || order['order_number'] || '-';
                const demandDate = order['需求日期'] || '-';
                const demandQty = order['未結數量 (EINHEIT)'] || 0;

                let statusText, statusStyle;
                if (remainingStock >= demandQty) {
                    statusText = '✅ 完全滿足';
                    statusStyle = 'color: #28a745;';
                    remainingStock -= demandQty;
                } else if (remainingStock > 0) {
                    statusText = `⚠️ 部分滿足 (${remainingStock.toFixed(0)})`;
                    statusStyle = 'color: #ffc107;';
                    remainingStock = 0;
                } else {
                    statusText = '❌ 無法滿足';
                    statusStyle = 'color: #dc3545;';
                }

                subHTML += `<tr>
                    <td>${orderNum}</td>
                    <td>${demandDate}</td>
                    <td style="text-align: right;">${demandQty.toFixed(0)}</td>
                    <td style="${statusStyle}">${statusText}</td>
                </tr>`;
            });

            subHTML += `</tbody></table>
                </div>
            </td></tr>`;
        }
    });
    subHTML += '</tbody></table>';

    const substituteSection = document.getElementById('substitute-section');
    if (substituteSection) {
        substituteSection.innerHTML = subHTML;
    }
}

// 🆕 計算替代品可覆蓋的工單需求
function calculateSubstituteCoverage(demandDetails, availableStock) {
    if (!demandDetails || demandDetails.length === 0 || availableStock <= 0) {
        return { coveredCount: 0, coveredOrders: [], totalCoverable: 0 };
    }

    // 按需求日期排序（最早的先滿足）
    const sortedDemands = [...demandDetails]
        .filter(d => (d['未結數量 (EINHEIT)'] || 0) > 0)
        .sort((a, b) => {
            const dateA = a['需求日期'] || '';
            const dateB = b['需求日期'] || '';
            return dateA.localeCompare(dateB);
        });

    let remainingStock = availableStock;
    let coveredCount = 0;
    let totalCoverable = 0;
    const coveredOrders = [];

    for (const demand of sortedDemands) {
        const demandQty = demand['未結數量 (EINHEIT)'] || 0;
        if (remainingStock >= demandQty) {
            // 完全滿足
            coveredCount++;
            totalCoverable += demandQty;
            remainingStock -= demandQty;
            coveredOrders.push(demand);
        } else if (remainingStock > 0) {
            // 部分滿足
            totalCoverable += remainingStock;
            coveredOrders.push(demand);
            remainingStock = 0;
            break;
        } else {
            break;
        }
    }

    return { coveredCount, coveredOrders, totalCoverable };
}


// 🆕 切換替代品通知狀態 (儲存到資料庫)
window.toggleSubstituteNotify = function (materialId, substituteMaterialId, checkbox) {
    fetch('/api/substitute_notification/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            material_id: materialId,
            substitute_material_id: substituteMaterialId
        })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                console.log(`替代品 ${substituteMaterialId} 通知狀態: ${data.is_notified ? '啟用' : '停用'}`);
                // 更新 checkbox 狀態 (以防 API 回傳的狀態與 UI 不同步)
                if (checkbox) {
                    checkbox.checked = data.is_notified;
                }

                // 🆕 重新載入替代品通知資料並刷新儀表板統計
                if (typeof window.loadNotifiedSubstitutes === 'function') {
                    window.loadNotifiedSubstitutes().then(() => {
                        // 重新計算並更新統計卡片
                        if (typeof window.updateStatsCards === 'function') {
                            window.updateStatsCards();
                            console.log('替代用料統計已刷新');
                        }
                    });
                }
            } else {
                console.error('Toggle failed:', data.error);
                // 復原 checkbox 狀態
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                }
            }
        })
        .catch(err => {
            console.error('Toggle API error:', err);
            // 復原 checkbox 狀態
            if (checkbox) {
                checkbox.checked = !checkbox.checked;
            }
        });
};
