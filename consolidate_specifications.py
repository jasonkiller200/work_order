
import os
import pandas as pd

def consolidate_spec_files():
    """
    將指定資料夾內的所有 Excel 規格檔案合併成一個總表。

    - 讀取 'order_specifications' 資料夾內的所有 .xlsx 和 .xls 檔案。
    - 以檔案的檔名（不含副檔名）作為「訂單」號碼。
    - 將「訂單」號碼作為第一欄，並將所有檔案的內容合併。
    - 最終產出一個名為 '工單規格總表.xlsx' 的檔案。
    """
    # --- 設定路徑 ---
    # 來源資料夾：存放所有獨立的工單規格 Excel 檔
    source_folder = r'P:\F004\SAP半品庫存管理\成品工單訂單規格'
    # 目標檔案：合併後的總表名稱
    output_filename = r'P:\F004\MPS維護\工單規格總表.xlsx'
    
    # 檢查來源資料夾是否存在
    if not os.path.isdir(source_folder):
        print(f"錯誤：找不到名為 '{source_folder}' 的資料夾。")
        print("請先建立該資料夾，並將所有規格 Excel 檔案放入其中。")
        return

    # 用於存放從每個檔案讀取的 DataFrame
    all_specs_data = []

    print(f"開始掃描 '{source_folder}' 資料夾...")

    # --- 遍歷、讀取、處理檔案 ---
    for filename in os.listdir(source_folder):
        # 將檔名轉為小寫來比對，使其不區分大小寫
        if filename.lower().endswith(('.xlsx', '.xls')):
            file_path = os.path.join(source_folder, filename)
            
            try:
                # 從檔名提取訂單號碼（去除副檔名，並只取前9個字元）
                order_number = os.path.splitext(filename)[0][:9]
                
                # 讀取 Excel 檔案
                df = pd.read_excel(file_path)
                
                # 在第一欄插入訂單號碼
                df.insert(0, '訂單', order_number)
                
                all_specs_data.append(df)
                print(f"  - 已處理檔案: {filename} (訂單: {order_number})")

            except Exception as e:
                print(f"  - 處理檔案 {filename} 時發生錯誤: {e}")

    # --- 合併與儲存 ---
    if not all_specs_data:
        print("在資料夾中沒有找到任何 Excel 檔案可以處理。")
        return

    # 將所有 DataFrame 合併成一個
    consolidated_df = pd.concat(all_specs_data, ignore_index=True)

    # 確保輸出目錄存在
    output_dir = os.path.dirname(output_filename)
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        print(f"已建立輸出目錄: {output_dir}")

    # 將合併後的 DataFrame 寫入新的 Excel 檔案
    # index=False 表示不要將 DataFrame 的索引寫入 Excel 檔案中
    consolidated_df.to_excel(output_filename, index=False)

    print(f"\n成功！已將 {len(all_specs_data)} 個規格檔案合併至 '{output_filename}'。")

if __name__ == '__main__':
    # 確保您已經安裝了必要的函式庫：
    # pip install pandas openpyxl
    consolidate_spec_files()
