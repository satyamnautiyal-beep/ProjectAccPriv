from fastapi import APIRouter
from server.routers.members import summarize_system_status
from server.routers.files import get_todays_dir, get_statuses
import os

router = APIRouter(prefix="/api")


@router.get("/metrics")
def get_metrics():
    summary = summarize_system_status()
    mc = summary.get("memberCounts", {})

    # --- Files received today: count actual .edi files on disk today ---
    target_dir = get_todays_dir()
    statuses = get_statuses()
    files_today = 0
    if os.path.exists(target_dir):
        for fname in os.listdir(target_dir):
            if fname.endswith(".edi"):
                files_today += 1
    # Also count files that were parsed & ingested (removed from disk but tracked in statuses)
    for st in statuses.values():
        if st.get("status") in ("Parsed & Ingested",):
            files_today += 1

    # --- Total members ever identified (all statuses) ---
    members_identified = sum(mc.values())

    # --- Enrolled = OEP + SEP ---
    enrolled_count = mc.get("Enrolled", 0) + mc.get("Enrolled (SEP)", 0)

    return {
        "kpis": {
            "filesToday":           files_today,
            "membersIdentified":    members_identified,
            "readyCount":           mc.get("Ready", 0),
            "pendingCount":         mc.get("Pending Business Validation", 0),
            "awaitingClarification": mc.get("Awaiting Clarification", 0),
            "enrolledCount":        enrolled_count,
            "inReviewCount":        mc.get("In Review", 0),
            "inBatchCount":         mc.get("In Batch", 0),
            "processingFailedCount": mc.get("Processing Failed", 0),
            "inProgressBatches":    sum(1 for b in summary.get("batches", []) if b.get("status") in ("Awaiting Approval", "Approved")),
            "completedBatches":     sum(1 for b in summary.get("batches", []) if b.get("status") == "Completed"),
        },
        "pieData": [
            {"name": "Enrolled (OEP)",         "value": mc.get("Enrolled", 0),                    "color": "#22c55e"},
            {"name": "Enrolled (SEP)",          "value": mc.get("Enrolled (SEP)", 0),              "color": "#16a34a"},
            {"name": "In Review",               "value": mc.get("In Review", 0),                   "color": "#3b82f6"},
            {"name": "In Batch",                "value": mc.get("In Batch", 0),                    "color": "#8b5cf6"},
            {"name": "Ready",                   "value": mc.get("Ready", 0),                       "color": "#06b6d4"},
            {"name": "Pending Validation",      "value": mc.get("Pending Business Validation", 0), "color": "#6366f1"},
            {"name": "Awaiting Clarification",  "value": mc.get("Awaiting Clarification", 0),      "color": "#f59e0b"},
            {"name": "Processing Failed",       "value": mc.get("Processing Failed", 0),           "color": "#ef4444"},
        ]
    }
