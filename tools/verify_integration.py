
import sys
import os
import logging
import json
from datetime import datetime, timedelta

# Add the application directory to the python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app import create_app
from app.models.database import db, PurchaseOrder, Material

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def verify_integration():
    app = create_app()
    with app.app_context():
        logger.info("Starting integration verification...")
        
        # 1. Find a material with purchase orders
        po = PurchaseOrder.query.filter(PurchaseOrder.outstanding_quantity > 0).first()
        if not po:
            logger.error("No suitable purchase order found for testing.")
            return
            
        material_id = po.material_id
        po_number = po.po_number
        logger.info(f"Testing with Material: {material_id}, PO: {po_number}")
        
        # 2. Simulate GET /api/purchase_orders/<material_id>
        logger.info(f"Simulating GET /api/purchase_orders/{material_id}")
        with app.test_client() as client:
            response = client.get(f'/api/purchase_orders/{material_id}')
            if response.status_code != 200:
                logger.error(f"Failed to get purchase orders: {response.status_code}")
                return
                
            data = response.get_json()
            logger.info(f"Received {len(data)} purchase orders.")
            
            # Verify the target PO is in the list
            target_po_data = next((item for item in data if item['po_number'] == po_number), None)
            if not target_po_data:
                logger.error(f"Target PO {po_number} not found in response.")
                return
            logger.info(f"Found target PO in response: {target_po_data['po_number']}")
            
            # 3. Simulate POST /api/delivery (Save Delivery)
            new_delivery_date = (datetime.now() + timedelta(days=7)).strftime('%Y-%m-%d')
            payload = {
                "material_id": material_id,
                "expected_date": new_delivery_date,
                "quantity": 10,
                "po_number": po_number,
                "supplier": "Test Supplier",
                "notes": "Integration Test"
            }
            
            logger.info(f"Simulating POST /api/delivery with payload: {payload}")
            response = client.post('/api/delivery', json=payload)
            
            if response.status_code != 200:
                logger.error(f"Failed to save delivery: {response.status_code}, {response.get_data(as_text=True)}")
                return
                
            result = response.get_json()
            if not result.get('success'):
                logger.error(f"Save delivery returned success=False: {result}")
                return
            logger.info("Delivery saved successfully.")
            
            # 4. Verify Database Update
            logger.info("Verifying database update...")
            updated_po = PurchaseOrder.query.filter_by(po_number=po_number).first()
            
            if updated_po.status == 'updated' and updated_po.updated_delivery_date.strftime('%Y-%m-%d') == new_delivery_date:
                logger.info("✅ Database verification PASSED!")
                logger.info(f"  PO Status: {updated_po.status}")
                logger.info(f"  Updated Date: {updated_po.updated_delivery_date}")
            else:
                logger.error("❌ Database verification FAILED!")
                logger.error(f"  Expected Status: updated, Actual: {updated_po.status}")
                logger.error(f"  Expected Date: {new_delivery_date}, Actual: {updated_po.updated_delivery_date}")

if __name__ == "__main__":
    verify_integration()
