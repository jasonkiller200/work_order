# clear_materials_table_only.py
# A dedicated script to clear the materials table, for debugging purposes.

import os
import sqlite3
import logging

# --- Configuration ---
DB_PATH = os.path.join('instance', 'order_management.db')
TABLE_TO_CLEAR = 'materials'
# --- End Configuration ---

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def get_db_connection():
    """Establishes a connection to the SQLite database."""
    try:
        # Increase the timeout to handle potential locking issues
        conn = sqlite3.connect(DB_PATH, timeout=10)
        logging.info(f"Successfully connected to database at {DB_PATH}")
        return conn
    except sqlite3.Error as e:
        logging.error(f"Error connecting to database: {e}")
        return None

def clear_table(conn):
    """
    Deletes all records from the specified table.
    """
    cursor = conn.cursor()
    
    try:
        logging.info(f"--- Preparing to DELETE all records from '{TABLE_TO_CLEAR}' ---")
        
        # 1. Disable foreign key constraints for this connection
        cursor.execute("PRAGMA foreign_keys = OFF;")
        logging.info("Step 1: Disabled foreign key constraints.")

        # 2. Begin a transaction
        cursor.execute("BEGIN TRANSACTION;")
        logging.info("Step 2: Started a new transaction.")
        
        # 3. Get row count before deleting
        cursor.execute(f"SELECT COUNT(*) FROM {TABLE_TO_CLEAR}")
        initial_count = cursor.fetchone()[0]
        logging.info(f"Step 3: Found {initial_count} records in '{TABLE_TO_CLEAR}' before deletion.")
        
        if initial_count == 0:
            logging.info("Table is already empty. No deletion needed.")
            return

        # 4. Execute the DELETE statement
        cursor.execute(f"DELETE FROM {TABLE_TO_CLEAR};")
        logging.info(f"Step 4: Executed DELETE command. Rows affected: {cursor.rowcount}")

        # 5. Commit the transaction
        conn.commit()
        logging.info("Step 5: Transaction committed.")

        # 6. Verify row count after deleting
        cursor.execute(f"SELECT COUNT(*) FROM {TABLE_TO_CLEAR}")
        final_count = cursor.fetchone()[0]
        logging.info(f"Step 6: Found {final_count} records in '{TABLE_TO_CLEAR}' after deletion.")

        if final_count == 0:
            logging.info("SUCCESS: The table is now empty.")
            # Also reset the auto-increment counter
            cursor.execute(f"DELETE FROM sqlite_sequence WHERE name=?;", (TABLE_TO_CLEAR,))
            conn.commit()
            logging.info("Reset auto-increment sequence counter.")
        else:
            logging.error(f"FAILURE: The table still contains {final_count} records. The DELETE operation did not work as expected.")

    except sqlite3.OperationalError as e:
        logging.error(f"A database error occurred: {e}", exc_info=True)
        logging.error("This could be due to the database being locked by another process (like the running web server).")
        conn.rollback()
        logging.info("Transaction was rolled back.")
    except Exception as e:
        logging.error(f"An unexpected error occurred: {e}", exc_info=True)
        conn.rollback()
        logging.info("Transaction was rolled back.")
    finally:
        # 7. Re-enable foreign key constraints
        cursor.execute("PRAGMA foreign_keys = ON;")
        logging.info("Step 7: Re-enabled foreign key constraints.")
        cursor.close()

if __name__ == '__main__':
    print("------------------------------------------------------------------")
    print("IMPORTANT: Please ensure the main application/web server is fully stopped before running this script to avoid database locking issues.")
    print("------------------------------------------------------------------")
    
    conn = get_db_connection()
    if conn:
        clear_table(conn)
        conn.close()
        logging.info("Table clearing process finished.")
