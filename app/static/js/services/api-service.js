/**
 * API 服務層
 * 統一管理所有 API 呼叫，避免在各處重複 fetch 邏輯
 */

class ApiService {
    constructor() {
        this.baseUrl = '';  // 使用相對路徑
    }

    /**
     * 通用 GET 請求
     */
    async get(endpoint) {
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`GET ${endpoint} 失敗:`, error);
            throw error;
        }
    }

    /**
     * 通用 POST 請求
     */
    async post(endpoint, data) {
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`POST ${endpoint} 失敗:`, error);
            throw error;
        }
    }

    // ==================== 系統狀態 ====================
    
    /**
     * 檢查 API 狀態
     */
    async checkStatus() {
        return await this.get('/api/status');
    }

    // ==================== 採購儀表板 ====================
    
    /**
     * 取得物料資料
     */
    async getMaterials() {
        return await this.get('/api/materials');
    }

    /**
     * 取得成品物料資料
     */
    async getFinishedMaterials() {
        return await this.get('/api/finished_materials');
    }

    /**
     * 取得所有交期資料
     */
    async getAllDeliveries() {
        return await this.get('/api/delivery/all');
    }

    /**
     * 取得所有需求明細
     */
    async getAllDemandDetails() {
        return await this.get('/api/demand_details/all');
    }

    /**
     * 取得物料詳情
     */
    async getMaterialDetails(materialId, dashboardType = 'main') {
        return await this.get(`/api/material/${materialId}/details?type=${dashboardType}`);
    }

    /**
     * 取得採購人員參考清單
     */
    async getBuyerReference(materialId, dashboardType = 'main') {
        return await this.get(`/api/material/${materialId}/buyer_reference?type=${dashboardType}`);
    }

    /**
     * 取得採購人員清單
     */
    async getBuyersList() {
        return await this.get('/api/buyers_list');
    }

    /**
     * 更新採購人員
     */
    async updateBuyer(materialId, buyer, dashboardType) {
        return await this.post('/api/update_buyer', {
            material_id: materialId,
            buyer: buyer,
            dashboard_type: dashboardType
        });
    }

    // ==================== 採購單管理 ====================
    
    /**
     * 取得物料的採購單
     */
    async getPurchaseOrders(materialId) {
        return await this.get(`/api/purchase_orders/${materialId}`);
    }

    // ==================== 交期管理 ====================
    
    /**
     * 取得物料交期
     */
    async getDelivery(materialId) {
        return await this.get(`/api/delivery/${materialId}`);
    }

    /**
     * 儲存交期
     */
    async saveDelivery(deliveryData) {
        return await this.post('/api/delivery', deliveryData);
    }

    /**
     * 清除過期交期
     */
    async clearOverdueDelivery(materialId) {
        return await this.post(`/api/delivery/${materialId}/clear_overdue`, {});
    }

    /**
     * 批量清除過期交期
     */
    async batchClearOverdueDeliveries() {
        return await this.post('/api/delivery/batch-clear-overdue', {});
    }

    // ==================== 訂單查詢 ====================
    
    /**
     * 查詢訂單
     */
    async getOrder(orderId) {
        return await this.get(`/api/order/${orderId}`);
    }

    /**
     * 下載訂單規格表
     */
    downloadSpecs(orderId) {
        window.location.href = `/api/download_specs/${orderId}`;
    }

    // ==================== 管理後台 ====================
    
    /**
     * 取得流量數據
     */
    async getTrafficData() {
        return await this.get('/api/admin/traffic');
    }
}

// 建立全域實例
window.apiService = new ApiService();

// 也可以這樣使用（ES6 export，如果未來使用模組化）
// export default new ApiService();
