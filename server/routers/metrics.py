from fastapi import APIRouter
import os
import datetime
from server.database import DATA_DIR

router = APIRouter(prefix="/api")

@router.get("/metrics")
def get_metrics():
    from server.routers.files import get_statuses
    statuses = get_statuses()
    filesToday = len(statuses)

    from server.routers.members import get_members
    from server.routers.clarifications import read_clarifications
    members = get_members()
    clarifications = read_clarifications()

    membersIdentified = len(members)
    readyCount = sum(1 for m in members if m.get("status") == "Ready")
    triageCount = sum(1 for m in members if m.get("status") == "Awaiting Clarification")
    pendingCount = sum(1 for m in members if m.get("status") in ["Pending Business Validation", "Under Review", "Pending"])
    blockedCount = sum(1 for m in members if m.get("status") == "Cannot Process")
    awaitingClarification = sum(1 for c in clarifications if c.get("status") != "Resolved")

    return {
        "kpis": {
            "filesToday": filesToday,
            "membersIdentified": membersIdentified,
            "readyCount": readyCount,
            "pendingCount": pendingCount + triageCount,
            "blockedCount": blockedCount,
            "awaitingClarification": awaitingClarification,
            "inProgressBatches": 0,
            "completedBatches": 0
        },
        "pieData": [
            {"name": "Ready", "value": readyCount, "color": "#22c55e"},
            {"name": "Pending", "value": pendingCount, "color": "#3b82f6"},
            {"name": "Awaiting Clarification", "value": triageCount, "color": "#f59e0b"},
            {"name": "Blocked", "value": blockedCount, "color": "#ef4444"}
        ]
    }
