"""
NormalEnrollmentAgent — builds an OEP enrollment timeline for non-SEP members.
Returns JSON only.
"""
import json
from typing import List

from .base import register_agent
from ..core.utils import _sorted_history_dates


@register_agent("NormalEnrollmentAgent")
async def NormalEnrollmentAgent(query: str, **kwargs) -> str:
    payload = json.loads(query)
    record = payload["record"]
    classification = payload["classification"]

    history = record.get("history", {}) or {}
    timeline_rows = []
    effective_dates: List[str] = []

    for d in _sorted_history_dates(record):
        snap = history[d]
        covs = snap.get("coverages", []) or []
        deps = snap.get("dependents", []) or []
        member = snap.get("member_info", {}) or {}

        cov_start_dates = [c.get("coverage_start_date") for c in covs]
        for ed in cov_start_dates:
            if ed:
                effective_dates.append(ed)

        timeline_rows.append({
            "snapshot_date": d,
            "snapshot_status": snap.get("status"),
            "coverage_start_dates": cov_start_dates,
            "plan_codes": [c.get("plan_code") for c in covs],
            "city": member.get("city"),
            "state": member.get("state"),
            "dependents_count": len(deps),
        })

    return json.dumps({
        "normal_flow_summary": {
            "enrollment_type": classification.get("enrollment_type"),
            "subtype": classification.get("subtype"),
            "notes": "Processed via normal flow; SEP inference skipped.",
        },
        "timeline": {
            "history_dates": _sorted_history_dates(record),
            "timeline": timeline_rows,
            "observations": {
                "distinct_effective_dates": sorted(set([x for x in effective_dates if x])),
                "snapshot_count": len(timeline_rows),
            },
        },
    })
