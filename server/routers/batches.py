from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import datetime
import time

from db.mongo_connection import get_database
from server.agents.enrollment_intelligence_runner import process_records_batch

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
    """Bundles all Ready members into a batch."""
    db = get_database()
    if db is None:
        raise HTTPException(status_code=500, detail="Database connection failed")

    ready_members = list(
        db.members.find({"status": "Ready"}, {"_id": 0, "subscriber_id": 1})
    )

    if not ready_members:
        raise HTTPException(status_code=400, detail="No Ready members found")

    batch_id = f"BCH-{datetime.utcnow().strftime('%Y%m%d')}-{int(time.time()) % 1000}"
    member_ids = [m["subscriber_id"] for m in ready_members]

    db.batches.insert_one({
        "id": batch_id,
        "status": "Awaiting Approval",
        "membersCount": len(member_ids),
        "member_ids": member_ids,
        "createdAt": datetime.utcnow().isoformat(),
    })

    db.members.update_many(
        {"subscriber_id": {"$in": member_ids}},
        {"$set": {"status": "In Batch", "batch_id": batch_id}}
    )

    return {"success": True, "batchId": batch_id}


@router.post("/initiate-batch")
async def initiate_batch(req: BatchRequest):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=500, detail="Database connection failed")

    batch = db.batches.find_one({"id": req.batchId}, {"_id": 0})
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    members_in_batch = list(
        db.members.find(
            {"status": "In Batch", "batch_id": req.batchId},
            {"_id": 0}
        )
    )

    if not members_in_batch:
        raise HTTPException(
            status_code=400,
            detail="No members In Batch for this batch"
        )

    results = await process_records_batch(members_in_batch, persist=False)

    processed = 0
    failed = 0

    for result in results:
        subscriber_id = result.get("subscriber_id")
        if not subscriber_id:
            failed += 1
            continue

        try:
            root_status = result.get("root_status_recommended", "In Review")

            db.members.update_one(
                {"subscriber_id": subscriber_id},
                {"$set": {
                    "agent_analysis": result.get("agent_analysis", result),
                    "status": root_status,
                    "lastProcessedAt": datetime.utcnow().isoformat(),
                }}
            )
            processed += 1

        except Exception as e:
            failed += 1
            db.members.update_one(
                {"subscriber_id": subscriber_id},
                {"$set": {
                    "status": "Processing Failed",
                    "processing_error": str(e),
                    "lastProcessedAt": datetime.utcnow().isoformat(),
                }}
            )

    db.batches.update_one(
        {"id": req.batchId},
        {"$set": {
            "status": "Completed",
            "processedCount": processed,
            "failedCount": failed,
            "completedAt": datetime.utcnow().isoformat(),
        }}
    )

    return {
        "success": True,
        "batchId": req.batchId,
        "processed": processed,
        "failed": failed,
    }