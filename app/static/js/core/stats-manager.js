/**
 * 統計管理器
 * 統一處理統計計算和圖卡渲染
 */

const StatsManager = {
    /**
     * 計算儀表板統計數據
     * @param {Array} materials - 物料清單
     * @returns {object} 統計結果
     */
    calculateStats(materials) {
        if (!Array.isArray(materials)) {
            return {
                total: 0,
                shortage: 0,
                partial: 0,
                sufficient: 0,
                noDelivery: 0,
                within30Days: 0
            };
        }

        const stats = {
            total: materials.length,
            shortage: 0,
            partial: 0,
            sufficient: 0,
            noDelivery: 0,
            within30Days: 0
        };

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        materials.forEach(material => {
            // 使用實際資料欄位（支援多種欄位名稱）
            const currentShortage = material.current_shortage || 0;
            const projectedShortage = material.projected_shortage || 0;
            const hasShortage = currentShortage > 0 || projectedShortage > 0;
            const shortage30 = material.shortage_within_30_days || false;
            const hasDelivery = material.delivery_date ? true : false;

            // 分類統計
            if (hasShortage) {
                const onOrder = material['on_order_stock'] || 0;
                if (onOrder > 0) {
                    stats.partial++;
                } else {
                    stats.shortage++;
                }
            } else {
                stats.sufficient++;
            }

            // 無交期統計（有缺料但無交期）
            if (hasShortage && !hasDelivery) {
                stats.noDelivery++;
            }

            // 30 日內缺料
            if (shortage30) {
                stats.within30Days++;
            }
        });

        return stats;
    },

    /**
     * 建立統計卡片 HTML
     * @param {object} stats - 統計數據
     * @param {string} activeFilter - 當前啟用的篩選
     * @param {string} onClickHandler - 點擊處理函數名稱
     * @returns {string} HTML 字串
     */
    createStatsCardsHTML(stats, activeFilter = 'all', onClickHandler = 'filterByStats') {
        const cards = [
            {
                key: 'all',
                icon: '📊',
                label: '全部物料',
                count: stats.total,
                sublabel: '總計'
            },
            {
                key: 'shortage',
                icon: '⚠️',
                label: '完全缺料',
                count: stats.shortage,
                sublabel: '尚無採購',
                priority: 'high'
            },
            {
                key: 'partial',
                icon: '🔶',
                label: '部分缺料',
                count: stats.partial,
                sublabel: '已部分採購',
                priority: 'medium'
            },
            {
                key: 'within30days',
                icon: '⏰',
                label: '30日內缺料',
                count: stats.within30Days,
                sublabel: '需求緊急',
                priority: 'high'
            },
            {
                key: 'sufficient',
                icon: '✅',
                label: '庫存充足',
                count: stats.sufficient,
                sublabel: '無需採購',
                priority: 'low'
            }
        ];

        let html = '<div class="stats-cards-grid">';

        cards.forEach(card => {
            const activeClass = activeFilter === card.key ? ' active' : '';
            const priorityClass = card.priority ? ` priority-${card.priority}` : '';
            
            html += `
                <div class="stat-card${activeClass}${priorityClass}" onclick="${onClickHandler}('${card.key}')">
                    <div class="stat-icon">${card.icon}</div>
                    <div class="stat-number">${FormatUtils.formatNumber(card.count)}</div>
                    <div class="stat-label">${card.label}</div>
                    <div class="stat-sublabel">${card.sublabel}</div>
                </div>
            `;
        });

        html += '</div>';
        return html;
    },

    /**
     * 根據統計類型篩選物料
     * @param {Array} materials - 完整物料清單
     * @param {string} filterType - 篩選類型
     * @returns {Array} 篩選後的物料
     */
    filterByStatsType(materials, filterType) {
        if (!Array.isArray(materials)) return [];
        if (filterType === 'all') return materials;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        return materials.filter(material => {
            const demand = material['total_demand'] || 0;
            const stock = material['unrestricted_stock'] || 0;
            const onOrder = material['on_order_stock'] || 0;
            const shortage = CalcUtils.calculateShortage(demand, stock, onOrder);

            switch (filterType) {
                case 'shortage':
                    return shortage < 0 && onOrder === 0;

                case 'partial':
                    return shortage < 0 && onOrder > 0;

                case 'sufficient':
                    return shortage >= 0;

                case 'within30days':
                    if (shortage >= 0) return false;
                    if (!material.earliest_demand_date) return false;
                    const demandDate = new Date(material.earliest_demand_date);
                    const diffDays = DateUtils.daysDifference(demandDate, today);
                    return diffDays >= 0 && diffDays <= 30;

                default:
                    return true;
            }
        });
    },

    /**
     * 取得統計類型的描述文字
     * @param {string} filterType - 篩選類型
     * @returns {string} 描述文字
     */
    getFilterDescription(filterType) {
        const descriptions = {
            all: '全部物料',
            shortage: '完全缺料（尚無採購）',
            partial: '部分缺料（已部分採購）',
            within30days: '30日內缺料項目',
            sufficient: '庫存充足項目'
        };
        return descriptions[filterType] || '未知類型';
    },

    /**
     * 建立篩選徽章 HTML
     * @param {string} filterType - 當前篩選類型
     * @param {string} onClearHandler - 清除處理函數名稱
     * @returns {string} HTML 字串
     */
    createFilterBadgeHTML(filterType, onClearHandler = 'clearStatsFilter') {
        if (filterType === 'all') return '';

        return `
            <div class="badge">
                篩選：${this.getFilterDescription(filterType)}
                <button onclick="${onClearHandler}()" title="清除篩選">✕</button>
            </div>
        `;
    },

    /**
     * 計算採購人員統計
     * @param {Array} materials - 物料清單
     * @returns {object} { buyer: count, ... }
     */
    calculateBuyerStats(materials) {
        if (!Array.isArray(materials)) return {};

        const stats = {};
        materials.forEach(material => {
            const buyer = material['採購人員'] || '未指定';
            stats[buyer] = (stats[buyer] || 0) + 1;
        });

        return stats;
    },

    /**
     * 計算交期統計
     * @param {Array} materials - 物料清單
     * @returns {object} 交期統計
     */
    calculateDeliveryStats(materials) {
        if (!Array.isArray(materials)) {
            return {
                withDelivery: 0,
                withoutDelivery: 0,
                overdue: 0,
                within7Days: 0
            };
        }

        const stats = {
            withDelivery: 0,
            withoutDelivery: 0,
            overdue: 0,
            within7Days: 0
        };

        const today = new Date();

        materials.forEach(material => {
            const deliveryDate = material.delivery_date;

            if (!deliveryDate) {
                stats.withoutDelivery++;
            } else {
                stats.withDelivery++;

                // 檢查過期
                if (DateUtils.isOverdue(deliveryDate)) {
                    stats.overdue++;
                }

                // 檢查 7 天內
                if (DateUtils.isWithinDays(deliveryDate, 7)) {
                    stats.within7Days++;
                }
            }
        });

        return stats;
    }
};

// 全域暴露
window.StatsManager = StatsManager;

// ES6 模組匯出（未來使用）
// export default StatsManager;
