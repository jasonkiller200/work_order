# import_materials_from_excel.py
# Script to import material data from an Excel file into the database.

import os
import sqlite3
import pandas as pd
import logging
from datetime import datetime

# --- Configuration ---
DB_PATH = os.path.join('instance', 'order_management.db')
EXCEL_PATH = '採購人員.xlsx'
# Column mapping: Key = DB column name, Value = Excel column name
COLUMN_MAP = {
    'material_id': '物料',
    'description': '物料/物料群組',
    'buyer_id': '採購人員'
}
# --- End Configuration ---

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def get_db_connection():
    """Establishes a connection to the SQLite database."""
    try:
        conn = sqlite3.connect(DB_PATH)
        logging.info(f"Successfully connected to database at {DB_PATH}")
        return conn
    except sqlite3.Error as e:
        logging.error(f"Error connecting to database: {e}")
        return None

def import_data(conn):
    """
    Reads the Excel file and imports data into the materials table.
    """
    cursor = conn.cursor()
    
    try:
        logging.info(f"Reading data from Excel file: {EXCEL_PATH}")
        # Read the Excel file, recognizing the first row as the header
        df = pd.read_excel(EXCEL_PATH, header=0, dtype=str)
        logging.info(f"Found {len(df)} rows in the Excel file.")

        imported_count = 0
        skipped_count = 0
        
        # Start transaction
        cursor.execute('BEGIN TRANSACTION;')

        # Iterate over DataFrame rows
        for index, row in df.iterrows():
            try:
                material_id = row.get(COLUMN_MAP.get('material_id'))
                description = row.get(COLUMN_MAP.get('description'))
                buyer_id_raw = row.get(COLUMN_MAP.get('buyer_id'))

                # Basic validation
                if not material_id or pd.isna(material_id):
                    logging.warning(f"Skipping row {index + 2}: material_id is empty.") # index + 2 to account for header and 0-based index
                    skipped_count += 1
                    continue
                
                # Check if material already exists
                cursor.execute("SELECT id FROM materials WHERE material_id = ?", (material_id,))
                if cursor.fetchone():
                    logging.warning(f"Skipping material '{material_id}': already exists in the database.")
                    skipped_count += 1
                    continue

                # --- Data Transformation ---
                # Create base_material_id
                base_material_id = material_id[:10] if len(material_id) >= 10 else material_id
                
                # Buyer ID is already a formatted string, just use it directly
                # Ensure it's a string and handle potential NaN values
                buyer_id_formatted = str(buyer_id_raw) if buyer_id_raw and pd.notna(buyer_id_raw) else None
                
                # Insert new record
                cursor.execute("""
                    INSERT INTO materials (material_id, description, base_material_id, buyer_id, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    material_id,
                    description,
                    base_material_id,
                    buyer_id_formatted,
                    datetime.utcnow(),
                    datetime.utcnow()
                ))
                imported_count += 1

            except Exception as row_error:
                logging.error(f"Error processing row {index + 2}: {row_error}. Row data: {row.to_dict()}", exc_info=True)
                skipped_count += 1
                continue

        conn.commit()
        logging.info(f"Import process finished. Imported: {imported_count} records. Skipped: {skipped_count} records.")

    except FileNotFoundError:
        logging.error(f"The file '{EXCEL_PATH}' was not found. Please ensure it is in the correct directory.")
        conn.rollback()
    except Exception as e:
        conn.rollback()
        logging.error(f"An error occurred during data import. Transaction rolled back. Error: {e}", exc_info=True)
    finally:
        cursor.close()

if __name__ == '__main__':
    # First, clear the table
    clear_conn = get_db_connection()
    if clear_conn:
        # Assuming clear_materials_table.py is available and does its job
        # For simplicity, we include the clearing logic here.
        logging.info("--- Clearing Materials Table ---")
        clear_cursor = clear_conn.cursor()
        try:
            # Temporarily disable foreign key constraints
            clear_cursor.execute("PRAGMA foreign_keys = OFF;")
            
            clear_cursor.execute("DELETE FROM materials")
            clear_cursor.execute("DELETE FROM sqlite_sequence WHERE name='materials'")
            clear_conn.commit()
            logging.info("Successfully cleared 'materials' table.")
        except Exception as e:
            clear_conn.rollback()
            logging.error(f"Failed to clear materials table: {e}")
        finally:
            # Re-enable foreign key constraints
            clear_cursor.execute("PRAGMA foreign_keys = ON;")
            clear_cursor.close()
            clear_conn.close()
        
        # Second, import the data
        logging.info("\n--- Importing Materials from Excel ---")
        import_conn = get_db_connection()
        if import_conn:
            import_data(import_conn)
            import_conn.close()
    
    logging.info("Full process finished.")
