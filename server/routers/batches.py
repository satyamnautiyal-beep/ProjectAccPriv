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

# ---------------------------------------------------------------------------
# In-process event buffer
# Keyed by batch_id. Stores every SSE payload emitted during a run so that
# reconnecting clients can replay the full history and then tail live events.
# Cleared when the pipeline finishes (after a short grace period).
# ---------------------------------------------------------------------------
_batch_buffers: dict[str, list[dict]] = {}   # batch_id → list of payloads
_batch_queues:  dict[str, list[asyncio.Queue]] = {}  # batch_id → subscriber queues
_batch_done:    set[str] = set()             # batch_ids whose pipeline has finished


def _buffer_emit(batch_id: str, payload: dict) -> None:
    """Append payload to the buffer and fan-out to all subscriber queues."""
    _batch_buffers.setdefault(batch_id, []).append(payload)
    for q in _batch_queues.get(batch_id, []):
        q.put_nowait(payload)


def _buffer_close(batch_id: str) -> None:
    """Signal all subscriber queues that the stream is done."""
    _batch_done.add(batch_id)
    for q in _batch_queues.get(batch_id, []):
        q.put_nowait(None)  # sentinel


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class BatchRequest(BaseModel):
    batchId: str


class ApproveRequest(BaseModel):
    id: str
    action: str  # "approve" or "hold"


# ---------------------------------------------------------------------------
# Batch CRUD
# ---------------------------------------------------------------------------

@router.get("/batches")
def get_batches():
    db = get_database()
    if db is None:
        return []
    return list(db.batches.find({}, {"_id": 0}))


@router.post("/batches")
def create_batch():
    """Creates batches for classified members, organized by pipeline type."""
    db = get_database()
    if db is None:
        raise HTTPException(status_code=500, detail="Database connection failed")

    classified_members = list(
        db.members.find(
            {"status": "Ready", "classification": {"$exists": True, "$ne": None}},
            {"_id": 0, "subscriber_id": 1, "classification": 1, "routing_target": 1}
        )
    )

    if not classified_members:
        raise HTTPException(status_code=400, detail="No classified members found")

    batches_by_pipeline: dict[str, list[str]] = {}
    for member in classified_members:
        rt = member.get("routing_target", "EnrollmentRouterAgent")
        batches_by_pipeline.setdefault(rt, []).append(member["subscriber_id"])

    created_batches = []
    for routing_target, member_ids in batches_by_pipeline.items():
        batch_id = f"BCH-{datetime.utcnow().strftime('%Y%m%d')}-{routing_target[:3]}-{int(time.time()) % 1000}"

        pipeline_type = "ENROLLMENT"
        if "Renewal" in routing_target:
            pipeline_type = "RENEWAL"
        elif "Retro" in routing_target:
            pipeline_type = "RETRO_COVERAGE"

        db.batches.insert_one({
            "id": batch_id,
            "status": "Awaiting Approval",
            "pipelineType": pipeline_type,
            "pipeline_type": pipeline_type,
            "routing_target": routing_target,
            "membersCount": len(member_ids),
            "member_ids": member_ids,
            "createdAt": datetime.utcnow().isoformat(),
        })
        db.members.update_many(
            {"subscriber_id": {"$in": member_ids}},
            {"$set": {"status": "In Batch", "batch_id": batch_id}}
        )
        created_batches.append({
            "batchId": batch_id,
            "pipelineType": pipeline_type,
            "pipeline_type": pipeline_type,
            "routing_target": routing_target,
            "membersCount": len(member_ids),
        })

    return {"success": True, "batches": created_batches}


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
    """Legacy non-streaming endpoint — kept for backward compat."""
    db = get_database()
    if db is None:
        raise HTTPException(status_code=500, detail="Database connection failed")

    batch = db.batches.find_one({"id": req.batchId}, {"_id": 0})
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    members_in_batch = list(
        db.members.find({"status": "In Batch", "batch_id": req.batchId}, {"_id": 0})
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
                {"$set": {"status": "Processing Failed", "processing_error": str(e),
                           "lastProcessedAt": datetime.utcnow().isoformat()}}
            )

    stuck = list(db.members.find(
        {"status": "In Batch", "batch_id": req.batchId}, {"_id": 0, "subscriber_id": 1}
    ))
    for m in stuck:
        db.members.update_one(
            {"subscriber_id": m["subscriber_id"]},
            {"$set": {"status": "Processing Failed",
                       "processing_error": "Pipeline did not return a result",
                       "lastProcessedAt": datetime.utcnow().isoformat()}}
        )
        failed += 1

    db.batches.update_one(
        {"id": req.batchId},
        {"$set": {"status": "Completed", "processedCount": processed,
                   "failedCount": failed, "completedAt": datetime.utcnow().isoformat()}}
    )
    return {"success": True, "batchId": req.batchId, "processed": processed, "failed": failed}


# ---------------------------------------------------------------------------
# Streaming endpoints
# ---------------------------------------------------------------------------

@router.post("/batches/stream/{batch_id}")
async def start_batch_stream(batch_id: str):
    """
    START a pipeline run and stream its events.
    Only allowed when batch status is 'Awaiting Approval'.
    Returns 409 if the pipeline is already running or completed.
    """
    from server.ai.chat_agent import _run_batch_streaming

    db = get_database()
    if db is None:
        raise HTTPException(status_code=500, detail="Database connection failed")

    batch = db.batches.find_one({"id": batch_id}, {"_id": 0})
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    # Guard: refuse to start a second run
    if batch["status"] in ("In Progress", "Completed"):
        raise HTTPException(
            status_code=409,
            detail=f"Batch is already {batch['status']}. Use GET to reconnect to a live stream."
        )

    members_in_batch = list(
        db.members.find({"status": "In Batch", "batch_id": batch_id}, {"_id": 0})
    )
    if not members_in_batch:
        raise HTTPException(status_code=400, detail="No members In Batch for this batch")

    # Mark running immediately
    db.batches.update_one(
        {"id": batch_id},
        {"$set": {"status": "In Progress", "startedAt": datetime.utcnow().isoformat()}}
    )

    # Initialise buffer and subscriber list
    _batch_buffers[batch_id] = []
    _batch_queues[batch_id] = []
    _batch_done.discard(batch_id)

    def send(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    async def event_stream():
        # Start event — buffered so reconnecting clients see it
        start_payload = {
            "type": "start",
            "batchId": batch_id,
            "memberCount": len(members_in_batch),
            "pipelineType": batch.get("pipelineType") or batch.get("pipeline_type", "ENROLLMENT"),
            "routingTarget": batch.get("routing_target", "EnrollmentRouterAgent"),
        }
        _buffer_emit(batch_id, start_payload)

        # Subscribe this client BEFORE starting the pipeline so it misses nothing
        client_queue: asyncio.Queue = asyncio.Queue()
        _batch_queues[batch_id].append(client_queue)

        # Seed the client queue with the start event we just buffered
        client_queue.put_nowait(start_payload)

        # Raw pipeline queue — events flow: pipeline → fan_out_task → buffer + all client queues
        raw_queue: asyncio.Queue = asyncio.Queue()

        async def fan_out_task():
            """Read raw pipeline events, write to buffer + all subscriber queues."""
            processed = 0
            failed = 0
            while True:
                event = await raw_queue.get()
                if event is None:
                    break
                _buffer_emit(batch_id, event)
                if event.get("type") == "member_result":
                    if event.get("status") == "Processing Failed":
                        failed += 1
                    else:
                        processed += 1

            # Pipeline done — emit done event, close all subscribers
            done_payload = {
                "type": "done",
                "batchId": batch_id,
                "processed": processed,
                "failed": failed,
            }
            _buffer_emit(batch_id, done_payload)

            # Persist the full event log to MongoDB so it survives server restarts
            try:
                db.batches.update_one(
                    {"id": batch_id},
                    {"$set": {"event_log": _batch_buffers.get(batch_id, [])}}
                )
            except Exception:
                pass

            _buffer_close(batch_id)

        asyncio.create_task(_run_batch_streaming(
            batch_id, members_in_batch, raw_queue, batch.get("routing_target")
        ))
        asyncio.create_task(fan_out_task())

        # Yield control so the tasks above can start before we block on the queue
        await asyncio.sleep(0)

        # Stream events to this client from its subscriber queue
        while True:
            event = await client_queue.get()
            if event is None:
                break
            yield send(event)
            yield ": \n\n"
            await asyncio.sleep(0)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform",
                 "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.get("/batches/stream/{batch_id}")
async def reconnect_batch_stream(batch_id: str):
    """
    RECONNECT to a running or completed pipeline stream.
    Replays all buffered events, then tails live events if still running.
    Safe to call multiple times — never starts a new pipeline run.
    """
    db = get_database()
    if db is None:
        raise HTTPException(status_code=500, detail="Database connection failed")

    batch = db.batches.find_one({"id": batch_id}, {"_id": 0})
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    def send(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    async def replay_stream():
        # 1. Try in-process buffer first (fast path — same server process)
        buffered = list(_batch_buffers.get(batch_id, []))

        # 2. If buffer is empty (server restarted), load from MongoDB
        if not buffered:
            stored = batch.get("event_log") or []
            if stored:
                buffered = stored
                # Restore into in-process buffer so subsequent reconnects are fast
                _batch_buffers[batch_id] = list(stored)
                # If the stored log contains a 'done' event, mark as done
                if any(e.get("type") == "done" for e in stored):
                    _batch_done.add(batch_id)

        replay_count = len(buffered)

        # Replay everything buffered so far
        for payload in buffered:
            yield send(payload)
            yield ": \n\n"
            await asyncio.sleep(0)

        # 3. If pipeline already finished, we're done
        if batch_id in _batch_done or batch.get("status") == "Completed":
            return

        # 4. Pipeline still running — subscribe to future events only
        q: asyncio.Queue = asyncio.Queue()
        _batch_queues.setdefault(batch_id, []).append(q)

        # Drain any events that arrived between our buffer snapshot and subscription
        current_buffer = _batch_buffers.get(batch_id, [])
        for payload in current_buffer[replay_count:]:
            yield send(payload)
            yield ": \n\n"
            await asyncio.sleep(0)

        try:
            while True:
                event = await asyncio.wait_for(q.get(), timeout=120.0)
                if event is None:
                    break
                yield send(event)
                yield ": \n\n"
                await asyncio.sleep(0)
        except asyncio.TimeoutError:
            yield ": keepalive\n\n"
        finally:
            queues = _batch_queues.get(batch_id, [])
            if q in queues:
                queues.remove(q)

    return StreamingResponse(
        replay_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform",
                 "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
