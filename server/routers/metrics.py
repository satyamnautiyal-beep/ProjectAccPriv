from fastapi import APIRouter
from server.routers.members import get_members, summarize_system_status
from server.routers.clarifications import read_clarifications

router = APIRouter(prefix="/api")


@router.get("/metrics")
def get_metrics():
    summary = summarize_system_status()
    mc = summary.get("memberCounts", {})

    members = get_members()
    clarifications = read_clarifications()

    return {
        "kpis": {
            "filesToday": len(summary.get("fileCounts", {})),
            "membersIdentified": len(members),
            "readyCount": mc.get("Ready", 0),
            "pendingCount": mc.get("Pending Business Validation", 0) + mc.get("Awaiting Clarification", 0),
            "enrolledCount": mc.get("Enrolled", 0) + mc.get("Enrolled (SEP)", 0),
            "inReviewCount": mc.get("In Review", 0),
            "processingFailedCount": mc.get("Processing Failed", 0),
            "blockedCount": mc.get("Cannot Process", 0),
            "awaitingClarification": sum(1 for c in clarifications if c.get("status") != "Resolved"),
            "inProgressBatches": sum(1 for b in summary.get("batches", []) if b.get("status") == "Awaiting Approval"),
            "completedBatches": sum(1 for b in summary.get("batches", []) if b.get("status") == "Completed"),
        },
        "pieData": [
            {"name": "Enrolled (OEP)", "value": mc.get("Enrolled", 0), "color": "#22c55e"},
            {"name": "Enrolled (SEP)", "value": mc.get("Enrolled (SEP)", 0), "color": "#16a34a"},
            {"name": "In Review", "value": mc.get("In Review", 0), "color": "#3b82f6"},
            {"name": "Pending", "value": mc.get("Pending Business Validation", 0), "color": "#6366f1"},
            {"name": "Awaiting Clarification", "value": mc.get("Awaiting Clarification", 0), "color": "#f59e0b"},
            {"name": "Processing Failed", "value": mc.get("Processing Failed", 0), "color": "#ef4444"},
        ]
    }
