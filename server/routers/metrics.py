from fastapi import APIRouter
import os
import datetime
from server.database import DATA_DIR

router = APIRouter(prefix="/api")

@router.get("/metrics")
def get_metrics():
    today_str = datetime.datetime.now().strftime("%Y-%m-%d")
    target_dir = os.path.join(DATA_DIR, today_str)
    filesToday = sum(1 for f in os.listdir(target_dir) if f.endswith('.edi')) if os.path.exists(target_dir) else 0

    from server.routers.members import read_members
    from server.routers.clarifications import read_clarifications
    members = read_members()
    clarifications = read_clarifications()

    membersIdentified = len(members)
    readyCount = sum(1 for m in members if m.get("status") == "Ready")
    pendingCount = sum(1 for m in members if m.get("status") in ["Needs Clarification", "Awaiting Input", "Under Review"])
    blockedCount = sum(1 for m in members if m.get("status") == "Cannot Process")
    awaitingClarification = sum(1 for c in clarifications if c.get("status") != "Resolved")

    return {
        "kpis": {
            "filesToday": filesToday,
            "membersIdentified": membersIdentified,
            "readyCount": readyCount,
            "pendingCount": pendingCount,
            "blockedCount": blockedCount,
            "awaitingClarification": awaitingClarification,
            "inProgressBatches": 0,
            "completedBatches": 0
        },
        "pieData": []
    }
