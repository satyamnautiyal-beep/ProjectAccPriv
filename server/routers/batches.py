from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from db.mongo_connection import get_database
from agent import orchestrate_enrollment
import time
from datetime import datetime

router = APIRouter(prefix="/api")

class BatchRequest(BaseModel):
    batchId: str

@router.get("/batches")
def get_batches():
    db = get_database()
    if db is None:
        return []
    return list(db.batches.find({}, {"_id": 0}))

@router.post("/batches")
def create_batch():
    """Bundles all 'Ready' members into a new batch."""
    db = get_database()
    if db is None:
        raise HTTPException(status_code=500, detail="Database connection failed")
    
    # 1. Find all 'Ready' members
    ready_members = list(db.members.find({"status": "Ready"}))
    if not ready_members:
        raise HTTPException(status_code=400, detail="No 'Ready' members found to batch.")
    
    # 2. Generate Batch ID
    batch_id = f"BCH-{datetime.now().strftime('%Y%m%d')}-{int(time.time()) % 1000}"
    member_ids = [m["subscriber_id"] for m in ready_members]
    
    new_batch = {
        "id": batch_id,
        "status": "Awaiting Approval",
        "membersCount": len(member_ids),
        "member_ids": member_ids,
        "createdAt": datetime.now().isoformat(),
    }
    
    # 3. Save Batch and update members
    db.batches.insert_one(new_batch)
    db.members.update_many(
        {"subscriber_id": {"$in": member_ids}},
        {"$set": {"status": "In Batch", "batch_id": batch_id}}
    )
    
    return {"success": True, "batchId": batch_id}

@router.post("/initiate-batch")
def initiate_batch(req: BatchRequest):
    """Triggers the Agentic system for every member in the batch."""
    db = get_database()
    if db is None:
        raise HTTPException(status_code=500, detail="Database connection failed")
    
    batch = db.batches.find_one({"id": req.batchId})
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    member_ids = batch.get("member_ids", [])
    
    # Process each member (AI Refinery)
    for sub_id in member_ids:
        member = db.members.find_one({"subscriber_id": sub_id})
        if member:
            result = orchestrate_enrollment(member)
            db.members.update_one(
                {"subscriber_id": sub_id},
                {"$set": {
                    "agent_analysis": result,
                    "status": result.get("status", "Completed")
                }}
            )
            
    # Update batch status
    db.batches.update_one(
        {"id": req.batchId},
        {"$set": {"status": "Completed"}}
    )
    
    return {"success": True, "processed": len(member_ids)}
