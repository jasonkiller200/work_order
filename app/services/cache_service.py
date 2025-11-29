# app/services/cache_service.py
# 快取管理服務

import threading
import time
import logging
import xlrd
from app.config import FilePaths

app_logger = logging.getLogger(__name__)

class CacheManager:
    """雙緩衝快取管理器"""
    
    def __init__(self):
        """初始化快取管理器"""
        self.data_cache = {"A": None, "B": None}
        self.live_cache_pointer = "A"
        self.cache_lock = threading.Lock()
        
        # 訂單備註與版本快取
        self.order_note_cache = {}
        self.order_note_cache_lock = threading.Lock()
    
    def get_current_data(self):
        """取得當前快取資料"""
        with self.cache_lock:
            return self.data_cache[self.live_cache_pointer]
    
    def update_cache(self, new_data):
        """
        更新快取資料
        
        Args:
            new_data: 新的資料
        """
        target_buffer = "B" if self.live_cache_pointer == "A" else "A"
        self.data_cache[target_buffer] = new_data
        
        with self.cache_lock:
            self.live_cache_pointer = target_buffer
        
        app_logger.info(f"快取更新完畢，線上服務已切換至緩衝區 {self.live_cache_pointer}")
    
    def is_data_loaded(self):
        """檢查資料是否已載入"""
        with self.cache_lock:
            return self.data_cache[self.live_cache_pointer] is not None
    
    def get_live_cache_pointer(self):
        """取得當前快取指標"""
        with self.cache_lock:
            return self.live_cache_pointer
    
    # --- 訂單備註快取相關方法 ---
    
    def load_order_notes_to_cache(self):
        """載入訂單備註與版本快取"""
        app_logger.info("開始載入訂單備註與版本快取...")
        file_path = FilePaths.ORDER_NOTE_SOURCE_FILE
        sheet_name = FilePaths.ORDER_NOTE_SOURCE_SHEET
        
        temp_cache = {}
        try:
            workbook = xlrd.open_workbook(file_path, formatting_info=True)
            sheet = workbook.sheet_by_name(sheet_name)
            
            # --- 動態尋找欄位索引 ---
            header_row = sheet.row_values(0)
            order_id_col_idx = 5  # Column F is index 5 (0-indexed)
            version_col_idx = -1
            try:
                version_col_idx = header_row.index('訂單版本')
            except ValueError:
                app_logger.error(f"在 {file_path} 的 '{sheet_name}' 頁籤中找不到 '訂單版本' 欄位。將無法載入版本資訊。")
            
            # --- 遍歷資料列 ---
            for row_idx in range(1, sheet.nrows):  # 從第 1 行開始，跳過標頭
                order_id_cell = sheet.cell(row_idx, order_id_col_idx)
                order_id = str(order_id_cell.value).strip()
                
                if order_id:
                    note_text = None
                    if (row_idx, order_id_col_idx) in sheet.cell_note_map:
                        note = sheet.cell_note_map[(row_idx, order_id_col_idx)]
                        note_text = note.text
                    
                    version_text = None
                    if version_col_idx != -1:
                        version_cell = sheet.cell(row_idx, version_col_idx)
                        version_text = str(version_cell.value).strip()
                    
                    # 只有在備註或版本存在時才加入快取
                    if note_text or version_text:
                        temp_cache[order_id] = {'note': note_text, 'version': version_text}
            
            with self.order_note_cache_lock:
                self.order_note_cache = temp_cache
            
            app_logger.info(f"訂單備註與版本快取載入完成。共載入 {len(self.order_note_cache)} 條紀錄。")
        
        except FileNotFoundError:
            app_logger.error(f"載入訂單快取失敗：找不到檔案: {file_path}")
        except xlrd.biffh.XLRDError as e:
            app_logger.error(f"載入訂單快取失敗：使用 xlrd 讀取 {file_path} 時發生錯誤: {e}", exc_info=True)
        except Exception as e:
            app_logger.error(f"載入訂單快取失敗：發生未知錯誤: {e}", exc_info=True)
    
    def get_order_note_cache(self):
        """取得訂單備註快取"""
        with self.order_note_cache_lock:
            return self.order_note_cache.copy()
    
    def start_cache_update_thread(self, update_interval, update_function):
        """
        啟動快取更新執行緒
        
        Args:
            update_interval: 更新間隔（秒）
            update_function: 更新函式
        """
        def update_periodically():
            while True:
                time.sleep(update_interval)
                app_logger.info("背景執行緒：準備更新快取...")
                update_function()
        
        thread = threading.Thread(target=update_periodically, daemon=True)
        thread.start()
        app_logger.info(f"快取更新執行緒已啟動，更新間隔：{update_interval} 秒")
    
    def start_order_note_cache_update_thread(self, update_interval):
        """
        啟動訂單備註快取更新執行緒
        
        Args:
            update_interval: 更新間隔（秒）
        """
        def update_periodically():
            while True:
                time.sleep(update_interval)
                app_logger.info("背景執行緒：準備更新訂單備註與版本快取...")
                self.load_order_notes_to_cache()
        
        thread = threading.Thread(target=update_periodically, daemon=True)
        thread.start()
        app_logger.info(f"訂單備註快取更新執行緒已啟動，更新間隔：{update_interval} 秒")

# 建立全域快取管理器實例
cache_manager = CacheManager()
