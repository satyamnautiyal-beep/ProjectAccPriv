from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from datetime import datetime
from typing import List
from db.mongo_connection import get_database
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
            "lastValidatedAt": datetime.utcnow().isoformat(),
        }

        if latest_update:
            update_doc[f"history.{latest_update}.business_validation"] = {
                "validated_at": datetime.utcnow().isoformat(),
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


@router.post("/classify-members")
def classify_members():
    """Runs classification on all Ready members (assigns them to pipelines)."""
    db = get_database()
    if db is None:
        return {"error": "Database not available"}

    collection = db.members
    ready_members = list(collection.find({"status": "Ready"}))

    classified_count = 0
    unclassified_count = 0
    not_enough_info_count = 0

    for member in ready_members:
        subscriber_id = member.get("subscriber_id")
        latest_date = member.get("latest_update")
        snapshot = member.get("history", {}).get(latest_date, {})
        
        # Determine classification based on member data
        classification = None
        routing_target = None
        
        try:
            from datetime import datetime as dt
            
            coverages = snapshot.get("coverages", [])
            if not coverages:
                raise Exception("No coverages found")
            
            coverage = coverages[0]
            today = dt.now().date()
            
            # PRIORITY 1: Check for renewal signals (prior APTC or prior premium)
            # Renewal takes precedence over retro detection
            has_prior_aptc = coverage.get("prior_aptc") and str(coverage.get("prior_aptc")).strip() != ""
            has_prior_premium = coverage.get("prior_gross_premium") and str(coverage.get("prior_gross_premium")).strip() != ""
            
            if has_prior_aptc or has_prior_premium:
                classification = "RENEWAL"
                routing_target = "RenewalProcessorAgent"
            else:
                # PRIORITY 2: Check for retro coverage signals
                # Retro coverage has a coverage start date in the past (before today)
                # BUT only if it's NOT a renewal
                coverage_start_str = coverage.get("coverage_start_date")
                is_retro = False
                if coverage_start_str:
                    try:
                        coverage_start = dt.strptime(coverage_start_str, "%Y-%m-%d").date()
                        if coverage_start < today:
                            is_retro = True
                    except (ValueError, TypeError):
                        pass
                
                if is_retro:
                    classification = "RETRO_COVERAGE"
                    routing_target = "RetroEnrollmentOrchestratorAgent"
                # PRIORITY 3: Check for SEP signals (address change, household change, etc.)
                elif snapshot.get("sep_indicator") or snapshot.get("life_event"):
                    classification = "SEP_ENROLLMENT"
                    routing_target = "EnrollmentRouterAgent"
                else:
                    # PRIORITY 4: Default to OEP Enrollment
                    classification = "OEP_ENROLLMENT"
                    routing_target = "EnrollmentRouterAgent"
            
            # Update member with classification
            collection.update_one(
                {"subscriber_id": subscriber_id},
                {"$set": {
                    "classification": classification,
                    "routing_target": routing_target,
                    "classifiedAt": datetime.utcnow().isoformat(),
                }}
            )
            
            if classification != "Unclassified":
                classified_count += 1
            else:
                unclassified_count += 1
                
        except Exception as e:
            print(f"Classification error for {subscriber_id}: {e}")
            # Mark as "Not Enough Info" (variant of Awaiting Clarification)
            collection.update_one(
                {"subscriber_id": subscriber_id},
                {"$set": {
                    "classification": "Not Enough Info",
                    "status": "Not Enough Info",
                    "classification_error": str(e),
                    "classificationAttemptedAt": datetime.utcnow().isoformat(),
                }}
            )
            not_enough_info_count += 1

    return {
        "classified": classified_count,
        "unclassified": unclassified_count,
        "not_enough_info": not_enough_info_count,
        "total_ready": len(ready_members)
    }


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
            "lastProcessedAt": datetime.utcnow().isoformat(),
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
        f"Today's date: {datetime.utcnow().strftime('%Y-%m-%d')}. "
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
