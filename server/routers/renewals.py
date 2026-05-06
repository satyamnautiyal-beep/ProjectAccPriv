"""
Renewals Router — API endpoints for premium change alerts.

Endpoints:
- GET /api/renewals/alerts - Get list of premium change alerts
- GET /api/renewals/alerts/{case_id} - Get alert details
- POST /api/renewals/alerts/{case_id}/approve - Approve/hold/reject an alert
- GET /api/renewals/stats - Get renewal statistics
"""

from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db.mongo_connection import get_database

router = APIRouter(prefix="/api")


class ApprovePremiumAlertRequest(BaseModel):
    action: str  # "send", "hold", or "reject"
    notes: Optional[str] = None


@router.get("/renewals/alerts")
def get_premium_alerts(
    priority: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    skip: int = 0
):
    try:
        db = get_database()
        if db is None:
            raise HTTPException(status_code=500, detail="Database connection failed")

        filter_dict = {}
        if priority:
            filter_dict["priority"] = priority
        if status:
            filter_dict["status"] = status

        alerts = list(
            db["renewal_cases"]
            .find(filter_dict, {"_id": 0})
            .sort("created_at", -1)
            .skip(skip)
            .limit(limit)
        )
        total = db["renewal_cases"].count_documents(filter_dict)

        return {"success": True, "alerts": alerts, "total": total, "limit": limit, "skip": skip}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching alerts: {str(e)}")


@router.get("/renewals/alerts/{case_id}")
def get_premium_alert(case_id: str):
    try:
        db = get_database()
        if db is None:
            raise HTTPException(status_code=500, detail="Database connection failed")

        alert = db["renewal_cases"].find_one({"case_id": case_id}, {"_id": 0})
        if not alert:
            raise HTTPException(status_code=404, detail=f"Alert {case_id} not found")

        return {"success": True, "alert": alert}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching alert: {str(e)}")


@router.post("/renewals/alerts/{case_id}/approve")
def approve_premium_alert(case_id: str, request: ApprovePremiumAlertRequest):
    try:
        db = get_database()
        if db is None:
            raise HTTPException(status_code=500, detail="Database connection failed")

        alert = db["renewal_cases"].find_one({"case_id": case_id}, {"_id": 0})
        if not alert:
            raise HTTPException(status_code=404, detail=f"Alert {case_id} not found")

        valid_actions = ["send", "hold", "reject"]
        if request.action not in valid_actions:
            raise HTTPException(status_code=400, detail=f"Invalid action: {request.action}")

        status_map = {"send": "RESOLVED", "hold": "AWAITING_SPECIALIST", "reject": "REJECTED"}
        message_map = {"send": "Communication sent to member", "hold": "Alert held for further review", "reject": "Alert rejected"}

        activity_entry = {
            "timestamp": datetime.now().isoformat(),
            "action": f"ALERT_{request.action.upper()}",
            "actor": "specialist",
            "details": request.notes or message_map[request.action]
        }

        db["renewal_cases"].update_one(
            {"case_id": case_id},
            {"$set": {"status": status_map[request.action]}, "$push": {"activity_log": activity_entry}}
        )

        return {"success": True, "case_id": case_id, "action": request.action, "message": message_map[request.action]}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error approving alert: {str(e)}")


@router.get("/renewals/stats")
def get_renewals_stats():
    try:
        db = get_database()
        if db is None:
            raise HTTPException(status_code=500, detail="Database connection failed")

        total_alerts = db["renewal_cases"].count_documents({})
        by_priority = {p: db["renewal_cases"].count_documents({"priority": p}) for p in ["HIGH", "MEDIUM", "LOW"]}
        by_status = {s: db["renewal_cases"].count_documents({"status": s}) for s in ["AWAITING_SPECIALIST", "RESOLVED", "REJECTED"]}

        return {"success": True, "total_alerts": total_alerts, "by_priority": by_priority, "by_status": by_status}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching stats: {str(e)}")
