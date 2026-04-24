from fastapi import APIRouter, HTTPException
from datetime import datetime
from db.mongo_connection import get_database
from server.business_logic import validate_member_record
from server.agents.enrollment_intelligence_runner import orchestrate_enrollment

router = APIRouter(prefix="/api")


@router.get("/members")
def get_members():
    """Returns all members stored in MongoDB."""
    db = get_database()
    if db is not None:
        return list(db.members.find({}, {"_id": 0}))
    return []


@router.post("/parse-members")
def parse_members():
    """
    Runs Business Validation on newly ingested members.
    Root status is updated.
    Snapshot status is NOT overwritten.
    """
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

        # OPTIONAL but recommended: write validation metadata into snapshot
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


@router.get("/agent/process/{subscriber_id}")
def process_member_agent(subscriber_id: str):
    """
    Triggers AI Refinery pipeline for a single member.
    Intended only for Ready / In Batch members.
    """
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

    # Run agentic pipeline
    result = orchestrate_enrollment(member)

    root_status = result.get("root_status_recommended", "In Review")

    db.members.update_one(
        {"subscriber_id": subscriber_id},
        {"$set": {
            "agent_analysis": result.get("agent_analysis", result),
            "status": root_status,
            "lastProcessedAt": datetime.utcnow().isoformat(),
        }}
    )

    return {
        "subscriber_id": subscriber_id,
        "root_status_recommended": root_status,
        "agent_analysis": result.get("agent_analysis", result),
    }