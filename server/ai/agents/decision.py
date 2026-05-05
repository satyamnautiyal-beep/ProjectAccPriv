"""
DecisionAgent — aggregates classification + branch analysis + risk rules
to produce a final operational status recommendation.
Returns JSON only.
"""
import json
from datetime import datetime as _dt, timezone as _tz
from typing import List

from .base import register_agent
from ..core.utils import _get_latest_two_snapshots


@register_agent("DecisionAgent")
async def DecisionAgent(query: str, **kwargs) -> str:
    """
    Returns:
      - hard_blocks (validation issues / blocking status)
      - requires_evidence_check (when SEP confirmed)
    The router runs EvidenceCheckAgent next and finalises Ready/In Review.
    """
    payload = json.loads(query)
    record = payload["record"]
    classification = payload["classification"]
    analysis = payload["analysis"]

    latest, prev, dates = _get_latest_two_snapshots(record)

    latest_snapshot_status = (latest or {}).get("status")
    root_status_current = record.get("status")
    validation_issues = record.get("validation_issues", []) or []

    risk = {"level": "Low", "reasons": []}
    root_status_recommended = "Ready"
    hard_blocks: List[str] = []

    if validation_issues:
        risk["level"] = "High"
        risk["reasons"].append("validation_issues_present")
        hard_blocks.append("validation_issues_present")
        root_status_recommended = "In Review"

    BLOCKING_ROOT_STATUSES = {
        "Pending Business Validation",
        "Clarification Required",
        "Processing Failed",
    }
    if str(root_status_current) in BLOCKING_ROOT_STATUSES:
        risk["reasons"].append(f"root_status_blocks:{root_status_current}")
        hard_blocks.append(f"root_status_blocks:{root_status_current}")
        root_status_recommended = "In Review"

    requires_evidence_check = False
    if analysis.get("sep_confirmed") is True:
        requires_evidence_check = True
        risk["reasons"].append("sep_confirmed_requires_evidence_check")

    # ---- Deterministic plain-English summary ----
    sep_confirmed = analysis.get("sep_confirmed")
    sep_type = (analysis.get("sep_causality") or {}).get("sep_candidate")

    def _humanise_block(block: str) -> str:
        if block == "validation_issues_present":
            return "validation issues present"
        if block.startswith("root_status_blocks:"):
            status_val = block.split(":", 1)[1]
            return f"status blocked: {status_val}"
        return block

    if root_status_recommended in ("Enrolled", "Ready") and not hard_blocks:
        plain_english_summary = "Member enrolled under OEP — all fields valid, no issues found."
    elif root_status_recommended == "Enrolled (SEP)" and sep_confirmed:
        plain_english_summary = (
            f"Member enrolled under SEP — {sep_type} confirmed. "
            "Required evidence submitted."
        )
    elif root_status_recommended == "In Review" and sep_confirmed:
        plain_english_summary = (
            f"Placed in review — {sep_type} detected but required evidence is missing."
        )
    elif hard_blocks:
        human_blocks = " and ".join(_humanise_block(b) for b in (hard_blocks or []))
        plain_english_summary = f"Placed in review — {human_blocks}."
    else:
        plain_english_summary = f"Status: {root_status_recommended}."

    return json.dumps({
        "root_status_current": root_status_current,
        "root_status_recommended": root_status_recommended,
        "plain_english_summary": plain_english_summary,
        "agent_analysis_patch": {
            "generated_at": _dt.now(_tz.utc).isoformat(),
            "latest_snapshot_date": dates[-1] if dates else None,
            "latest_snapshot_status": latest_snapshot_status,
            "risk": risk,
            "classification": classification,
            "analysis_used": analysis,
            "requires_evidence_check": requires_evidence_check,
            "hard_blocks": hard_blocks,
            "explain": (
                "Decision aggregates deterministic blockers; "
                "SEP confirmed triggers evidence check instead of auto-review."
            ),
        },
    })
