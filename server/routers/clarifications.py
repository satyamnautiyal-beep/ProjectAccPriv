"""
Clarifications router.

GET  /api/clarifications  — returns all members with status 'Awaiting Clarification'
                            from BigQuery, shaped for the UI table.
PATCH /api/clarifications — marks a clarification as resolved: updates the member's
                            status back to 'Ready' in BigQuery.

Previously this router read/wrote a local clarifications.json file that was never
populated, so the page always showed empty. It now reads directly from BigQuery.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import datetime, timezone

router = APIRouter(prefix="/api")


class ClarificationUpdate(BaseModel):
    id: str  # subscriber_id used as the clarification ID


@router.get("/clarifications")
def get_clarifications():
    """
    Returns all members currently in 'Awaiting Clarification' status.
    Each entry includes subscriber_id, member name, validation issues, and status.
    """
    from db.bq_connection import get_database

    db = get_database()
    if db is None:
        return []

    members = db.members.find(
        {"status": "Awaiting Clarification"},
        {"_id": 0},
    )

    results = []
    for m in members:
        latest_date = m.get("latest_update")
        snapshot = (m.get("history") or {}).get(latest_date, {})
        info = snapshot.get("member_info") or {}
        first = info.get("first_name") or ""
        last = info.get("last_name") or ""
        member_name = f"{first} {last}".strip() or m.get("subscriber_id", "Unknown")

        raw_issues = m.get("validation_issues") or []
        # Normalise — issues can be strings or {message, severity} dicts
        issue_messages = [
            i.get("message", "") if isinstance(i, dict) else str(i)
            for i in raw_issues
        ]
        issue_type = issue_messages[0] if issue_messages else "Validation failed"
        if len(issue_messages) > 1:
            issue_type += f" (+{len(issue_messages) - 1} more)"

        results.append({
            "id":         m.get("subscriber_id"),
            "memberId":   m.get("subscriber_id"),
            "memberName": member_name,
            "issueType":  issue_type,
            "issues":     issue_messages,
            "status":     "Awaiting Response",
            "lastValidatedAt": (m.get("lastValidatedAt") or "")[:10],
        })

    return results


@router.patch("/clarifications")
def update_clarification(update: ClarificationUpdate):
    """
    Resolves a clarification by resetting the member's status to 'Ready'.
    The subscriber_id is used as the clarification ID.
    """
    from db.bq_connection import get_database

    db = get_database()
    if db is None:
        raise HTTPException(
            status_code=503,
            detail="Database unavailable — cannot resolve clarification",
        )

    member = db.members.find_one({"subscriber_id": update.id})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    if member.get("status") != "Awaiting Clarification":
        raise HTTPException(
            status_code=400,
            detail=f"Member is not in 'Awaiting Clarification' status (current: {member.get('status')})",
        )

    db.members.update_one(
        {"subscriber_id": update.id},
        {"$set": {
            "status": "Ready",
            "clarification_resolved_at": datetime.now(timezone.utc).isoformat(),
        }},
    )

    return {"success": True}
