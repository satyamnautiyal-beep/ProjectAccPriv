"""
Retro Enrollments Router — API endpoints for retroactive enrollment cases.

Endpoints:
- GET /api/retro - List retro cases
- GET /api/retro/{case_id} - Get case details
- POST /api/retro/{case_id}/step/{step_id}/confirm - Confirm step completion
- GET /api/retro/{case_id}/audit-trail - Get audit trail
- GET /api/retro/stats - Get statistics
"""

from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db.mongo_connection import get_database

router = APIRouter(prefix="/api")


class ConfirmRetroStepRequest(BaseModel):
    step_id: str
    data: Optional[dict] = None
    notes: Optional[str] = None


@router.get("/retro")
def get_retro_cases(status: Optional[str] = None, limit: int = 50, skip: int = 0):
    try:
        db = get_database()
        if db is None:
            raise HTTPException(status_code=500, detail="Database connection failed")

        filter_dict = {}
        if status:
            filter_dict["status"] = status

        cases = list(
            db["retro_enrollments"]
            .find(filter_dict, {"_id": 0})
            .sort("created_at", -1)
            .skip(skip)
            .limit(limit)
        )
        total = db["retro_enrollments"].count_documents(filter_dict)

        return {"success": True, "cases": cases, "total": total, "limit": limit, "skip": skip}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching cases: {str(e)}")


@router.get("/retro/stats")
def get_retro_stats():
    try:
        db = get_database()
        if db is None:
            raise HTTPException(status_code=500, detail="Database connection failed")

        total_cases = db["retro_enrollments"].count_documents({})
        by_status = {s: db["retro_enrollments"].count_documents({"status": s}) for s in ["AWAITING_SPECIALIST", "IN_PROGRESS", "COMPLETED"]}
        pending_confirmation = db["retro_enrollments"].count_documents({"retro_current_step": "CONFIRMATION_834", "confirmation_834_sent_at": None})
        now = datetime.now().isoformat()
        overdue_deadline = db["retro_enrollments"].count_documents({"confirmation_834_deadline": {"$lt": now}, "confirmation_834_sent_at": None})

        return {"success": True, "total_cases": total_cases, "by_status": by_status, "pending_confirmation": pending_confirmation, "overdue_deadline": overdue_deadline}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching stats: {str(e)}")


@router.get("/retro/{case_id}")
def get_retro_case(case_id: str):
    try:
        db = get_database()
        if db is None:
            raise HTTPException(status_code=500, detail="Database connection failed")

        case = db["retro_enrollments"].find_one({"case_id": case_id}, {"_id": 0})
        if not case:
            raise HTTPException(status_code=404, detail=f"Case {case_id} not found")

        return {"success": True, "case": case}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching case: {str(e)}")


@router.post("/retro/{case_id}/step/{step_id}/confirm")
def confirm_retro_step(case_id: str, step_id: str, request: ConfirmRetroStepRequest):
    try:
        db = get_database()
        if db is None:
            raise HTTPException(status_code=500, detail="Database connection failed")

        case = db["retro_enrollments"].find_one({"case_id": case_id}, {"_id": 0})
        if not case:
            raise HTTPException(status_code=404, detail=f"Case {case_id} not found")

        current_step = case.get("retro_current_step")
        if current_step != step_id:
            raise HTTPException(status_code=400, detail=f"Cannot confirm step {step_id}. Current step is {current_step}")

        step_workflow = ["AUTH_VERIFY", "POLICY_ACTIVATE", "APTC_CALCULATE", "CSR_CONFIRM", "BILLING_ADJUST", "CONFIRMATION_834"]
        current_index = step_workflow.index(step_id) if step_id in step_workflow else -1
        next_step = step_workflow[current_index + 1] if current_index + 1 < len(step_workflow) else None

        activity_entry = {
            "timestamp": datetime.now().isoformat(),
            "action": "STEP_CONFIRMED",
            "actor": "specialist",
            "details": f"Step {step_id} confirmed. {request.notes or ''}"
        }

        update_dict = {"$push": {"retro_steps_completed": step_id, "activity_log": activity_entry}}
        update_dict["$set"] = {"retro_current_step": next_step} if next_step else {"status": "COMPLETED"}

        db["retro_enrollments"].update_one({"case_id": case_id}, update_dict)

        return {"success": True, "case_id": case_id, "step_id": step_id, "next_step": next_step, "message": f"Step {step_id} confirmed. Next: {next_step or 'COMPLETED'}"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error confirming step: {str(e)}")


@router.get("/retro/{case_id}/audit-trail")
def get_retro_audit_trail(case_id: str):
    try:
        db = get_database()
        if db is None:
            raise HTTPException(status_code=500, detail="Database connection failed")

        case = db["retro_enrollments"].find_one({"case_id": case_id}, {"_id": 0})
        if not case:
            raise HTTPException(status_code=404, detail=f"Case {case_id} not found")

        audit_trail = case.get("activity_log", [])
        return {"success": True, "case_id": case_id, "audit_trail": audit_trail, "entry_count": len(audit_trail)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching audit trail: {str(e)}")
