from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from datetime import datetime, timezone
from typing import List
from db.bq_connection import get_database
from server.business_logic import validate_member_record
from server.ai.agent import orchestrate_enrollment
from server.routers.files import get_statuses
from server.ai.chat_agent import stream_chat_response

router = APIRouter(prefix="/api")


@router.get("/members")
def get_members():
    db = get_database()
    if db is not None:
        return list(db.members.find({}, {"_id": 0}))
    return []


@router.post("/parse-members")
def parse_members():
    """Runs business validation on all Pending Business Validation members."""
    db = get_database()
    if db is None:
        return {"error": "Database not available"}

    collection = db.members
    pending_members = collection.find({"status": "Pending Business Validation"})

    validated_count = 0
    clarification_count = 0

    for m_doc in pending_members:
        new_status, issues = validate_member_record(m_doc)

        latest_update = m_doc.get("latest_update")
        update_doc = {
            "status": new_status,
            "validation_issues": issues,
            "lastValidatedAt": datetime.now(timezone.utc),
        }

        if latest_update:
            update_doc[f"history.{latest_update}.business_validation"] = {
                "validated_at": datetime.now(timezone.utc).isoformat(),
                "result_status": new_status,
                "issues_count": len(issues),
            }

        collection.update_one(
            {"subscriber_id": m_doc["subscriber_id"]},
            {"$set": update_doc},
        )

        if new_status == "Ready":
            validated_count += 1
        else:
            clarification_count += 1

    return {"validated": validated_count, "clarifications": clarification_count}


@router.get("/agent/process/{subscriber_id}")
def process_member_agent(subscriber_id: str):
    """Triggers AI Refinery pipeline for a single member (Ready or In Batch)."""
    db = get_database()
    if db is None:
        raise HTTPException(status_code=500, detail="Database connection failed")

    member = db.members.find_one({"subscriber_id": subscriber_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    if member.get("status") not in {"Ready", "In Batch"}:
        raise HTTPException(
            status_code=400,
            detail=f"Member not eligible for agent processing (status={member.get('status')})",
        )

    result = orchestrate_enrollment(member)
    root_status = result.get("root_status_recommended", "In Review")

    db.members.update_one(
        {"subscriber_id": subscriber_id},
        {"$set": {
            "agent_analysis": result.get("agent_analysis", result),
            "markers": result.get("markers", {}),
            "agent_summary": result.get("plain_english_summary"),
            "status": root_status,
            "lastProcessedAt": datetime.now(timezone.utc),
        }}
    )

    return {
        "subscriber_id": subscriber_id,
        "root_status_recommended": root_status,
        "agent_analysis": result.get("agent_analysis", result),
    }


def summarize_system_status():
    db = get_database()
    member_counts = {}
    batch_count = 0
    batches = []

    if db is not None:
        for m_doc in db.members.find({}, {"_id": 0, "status": 1}):
            status = m_doc.get("status", "Unknown")
            member_counts[status] = member_counts.get(status, 0) + 1

        batches = list(db.batches.find({}, {"_id": 0}))
        batch_count = len(batches)

    file_counts = {}
    try:
        statuses = get_statuses()
        for status_record in statuses.values():
            status_name = status_record.get("status", "Unknown")
            file_counts[status_name] = file_counts.get(status_name, 0) + 1
    except Exception:
        file_counts = {}

    return {
        "memberCounts": member_counts,
        "batchCount": batch_count,
        "fileCounts": file_counts,
        "batches": batches,
    }


# -----------------------------------
# LLM CHAT ENDPOINT
# -----------------------------------

class ChatMessage(BaseModel):
    role: str
    text: str = ""  # optional — UI-only messages (batch cards, member results) may omit text


class LLMChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = []


@router.post("/assistant/chat/llm")
async def assistant_chat_llm(req: LLMChatRequest):
    """LLM-powered assistant with full conversation history and tool calling."""
    summary = summarize_system_status()
    member_counts = summary.get("memberCounts", {})
    file_counts = summary.get("fileCounts", {})
    batches = summary.get("batches", [])

    system_context = (
        f"Today's date: {datetime.now(timezone.utc).strftime('%Y-%m-%d')}. "
        f"Ready: {member_counts.get('Ready', 0)}, "
        f"Pending Validation: {member_counts.get('Pending Business Validation', 0)}, "
        f"Awaiting Clarification: {member_counts.get('Awaiting Clarification', 0)}, "
        f"In Batch: {member_counts.get('In Batch', 0)}, "
        f"Enrolled: {member_counts.get('Enrolled', 0)}, "
        f"Enrolled (SEP): {member_counts.get('Enrolled (SEP)', 0)}, "
        f"In Review: {member_counts.get('In Review', 0)}, "
        f"Processing Failed: {member_counts.get('Processing Failed', 0)}, "
        f"Files with Issues: {file_counts.get('Structure Error', 0) + file_counts.get('Parsing Failed', 0)}, "
        f"Active Batches: {len(batches)}"
    )

    full_history = [msg.dict() for msg in req.history]
    full_history.append({"role": "user", "text": req.message})

    async def event_stream():
        async for chunk in stream_chat_response(full_history, system_context):
            yield chunk
            # Yield an empty keep-alive comment to force the chunk through
            # any intermediate buffers (uvicorn, nginx, Next.js proxy)
            yield ": \n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",       # disables nginx buffering
            "Connection": "keep-alive",
        },
    )
