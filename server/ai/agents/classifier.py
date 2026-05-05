"""
EnrollmentClassifierAgent — detects enrollment type and SEP candidacy.
Returns JSON only.
"""
import json
from datetime import datetime, timezone
from typing import List

from .base import register_agent
from ..core.utils import (
    _get_latest_two_snapshots,
    _deep_diff,
    is_within_oep,
)


@register_agent("EnrollmentClassifierAgent")
async def EnrollmentClassifierAgent(query: str, **kwargs) -> str:
    record = json.loads(query)
    latest, prev, dates = _get_latest_two_snapshots(record)

    today = datetime.now(timezone.utc).date()
    within_oep = is_within_oep(today)

    enrollment_type = "Maintenance"
    subtype = "Unknown"
    sep_candidate = False
    sep_required = False
    confidence = "medium"
    reasons: List[str] = []

    if not latest:
        return json.dumps({
            "enrollment_type": "Unknown",
            "subtype": "NoSnapshots",
            "sep_candidate": False,
            "sep_required": False,
            "is_within_oep": within_oep,
            "confidence": "low",
            "reasons": ["no_history_snapshots"],
            "history_dates": dates,
        })

    latest_status = latest.get("status") or ""

    if "Terminated" in latest_status:
        enrollment_type = "Termination"
        subtype = "CoverageEnd"
        confidence = "high"
        reasons.append("latest_status_terminated")

    elif "Reinstated" in latest_status:
        enrollment_type = "Reinstatement"
        subtype = "CoverageReactivated"
        confidence = "high"
        reasons.append("latest_status_reinstated")

    if prev:
        diffs = _deep_diff(prev, latest)

        addr_changed = any(
            any(k in d["path"] for k in ["address_line_1", "city", "state", "zip"])
            for d in diffs
        )
        dep_changed = any("dependents" in d["path"] for d in diffs)

        if addr_changed:
            sep_candidate = True
            subtype = "AddressChange"
            reasons.append("address_changed")

        if dep_changed:
            sep_candidate = True
            subtype = "HouseholdChange"
            reasons.append("dependents_changed")

        if sep_candidate:
            if within_oep is False:
                sep_required = True
                reasons.append("outside_oep_sep_required")
            elif within_oep is True:
                sep_required = False
                reasons.append("within_oep_sep_not_required")

    return json.dumps({
        "enrollment_type": enrollment_type,
        "subtype": subtype,
        "sep_candidate": sep_candidate,
        "sep_required": sep_required,
        "is_within_oep": within_oep,
        "confidence": confidence,
        "reasons": reasons,
        "history_dates": dates,
    })
