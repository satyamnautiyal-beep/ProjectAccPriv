from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from datetime import datetime
import asyncio
import json
import time

from db.mongo_connection import get_database
from server.ai.agent import process_records_batch

router = APIRouter(prefix="/api")


class BatchRequest(BaseModel):
    batchId: str


class ApproveRequest(BaseModel):
    id: str
    action: str  # "approve" or "hold"


@router.get("/batches")
def get_batches():
    db = get_database()
    if db is None:
        return []
    return list(db.batches.find({}, {"_id": 0}))


@router.post("/batches")
def create_batch():
    """Bundles all Ready members into a new batch awaiting approval."""
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


@router.post("/approve-batch")
def approve_batch(req: ApproveRequest):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=500, detail="Database connection failed")

    batch = db.batches.find_one({"id": req.id}, {"_id": 0})
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    if req.action == "approve":
        db.batches.update_one(
            {"id": req.id},
            {"$set": {"status": "Approved", "approvedAt": datetime.utcnow().isoformat()}}
        )
        return {"success": True, "batchId": req.id, "status": "Approved"}
    elif req.action == "hold":
        return {"success": True, "batchId": req.id, "status": "Awaiting Approval"}
    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {req.action}")


@router.post("/initiate-batch")
async def initiate_batch(req: BatchRequest):
    """
    Legacy non-streaming endpoint — kept for backward compat.
    The streaming version is GET /batches/stream/{batch_id}.
    """
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
        raise HTTPException(status_code=400, detail="No members In Batch for this batch")

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
            valid_statuses = {"Enrolled", "Enrolled (SEP)", "In Review", "Ready", "Awaiting Clarification"}
            if root_status not in valid_statuses:
                root_status = "In Review"

            db.members.update_one(
                {"subscriber_id": subscriber_id},
                {"$set": {
                    "agent_analysis": result.get("agent_analysis", result),
                    "markers": result.get("markers", {}),
                    "agent_summary": result.get("plain_english_summary"),
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

    stuck = list(db.members.find(
        {"status": "In Batch", "batch_id": req.batchId},
        {"_id": 0, "subscriber_id": 1}
    ))
    for m in stuck:
        db.members.update_one(
            {"subscriber_id": m["subscriber_id"]},
            {"$set": {
                "status": "Processing Failed",
                "processing_error": "Pipeline did not return a result for this member",
                "lastProcessedAt": datetime.utcnow().isoformat(),
            }}
        )
        failed += 1

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


@router.post("/batches/stream/{batch_id}")
async def stream_batch_enrollment(batch_id: str):
    """
    Streaming enrollment endpoint for Release Staging.
    Processes each member individually, emits SSE events in real time,
    and persists the full enrollment log to MongoDB for later replay.
    """
    from server.ai.chat_agent import _run_batch_streaming, _extract_member_name

    db = get_database()
    if db is None:
        raise HTTPException(status_code=500, detail="Database connection failed")

    batch = db.batches.find_one({"id": batch_id}, {"_id": 0})
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    members_in_batch = list(
        db.members.find(
            {"status": "In Batch", "batch_id": batch_id},
            {"_id": 0}
        )
    )

    if not members_in_batch:
        raise HTTPException(status_code=400, detail="No members In Batch for this batch")

    def send(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    async def event_stream():
        # Accumulated log for persistence
        log_entries = []

        start_event = {
            "type": "start",
            "batchId": batch_id,
            "memberCount": len(members_in_batch),
        }
        log_entries.append(start_event)
        yield send(start_event)
        yield ": \n\n"

        queue: asyncio.Queue = asyncio.Queue()
        asyncio.create_task(_run_batch_streaming(batch_id, members_in_batch, queue))

        processed = 0
        failed = 0

        while True:
            event = await queue.get()
            if event is None:
                break
            log_entries.append(event)
            yield send(event)
            yield ": \n\n"
            if event.get("type") == "member_result":
                if event.get("status") == "Processing Failed":
                    failed += 1
                else:
                    processed += 1

        done_event = {
            "type": "done",
            "batchId": batch_id,
            "processed": processed,
            "failed": failed,
        }
        log_entries.append(done_event)
        yield send(done_event)
        yield ": \n\n"

        # Persist the full log to MongoDB so it can be replayed later
        if db is not None:
            db.batches.update_one(
                {"id": batch_id},
                {"$set": {"enrollmentLog": log_entries}}
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/batches/log/{batch_id}")
def get_batch_log(batch_id: str):
    """Returns the persisted enrollment log for a completed batch."""
    db = get_database()
    if db is None:
        raise HTTPException(status_code=500, detail="Database connection failed")

    batch = db.batches.find_one({"id": batch_id}, {"_id": 0, "enrollmentLog": 1})
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    return {"batchId": batch_id, "log": batch.get("enrollmentLog") or []}
