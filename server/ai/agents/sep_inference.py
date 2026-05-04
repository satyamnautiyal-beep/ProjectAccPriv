"""
SepInferenceAgent — confirms SEP type and causality.
Runs only when EnrollmentClassifierAgent flags a SEP candidate.
Returns JSON only.
"""
import json
from typing import List

from .base import register_agent
from ..core.utils import _get_latest_two_snapshots, _deep_diff


@register_agent("SepInferenceAgent")
async def SepInferenceAgent(query: str, **kwargs) -> str:
    payload = json.loads(query)
    record = payload["record"]
    classification = payload["classification"]

    latest, prev, dates = _get_latest_two_snapshots(record)
    candidates = []

    if prev and latest:
        prev_deps = prev.get("dependents", []) or []
        latest_deps = latest.get("dependents", []) or []
        if len(prev_deps) != len(latest_deps):
            candidates.append({
                "sep_candidate": "Household change (marriage/birth/adoption/divorce)",
                "confidence": 0.75,
                "supporting_signals": ["dependents_count_changed"],
            })

        p = prev.get("member_info", {}) or {}
        l = latest.get("member_info", {}) or {}
        if any(p.get(k) != l.get(k) for k in ["address_line_1", "city", "state", "zip"]):
            candidates.append({
                "sep_candidate": "Permanent move / relocation",
                "confidence": 0.70,
                "supporting_signals": ["address_fields_changed"],
            })

        diffs = _deep_diff(prev, latest)
        non_status = [
            d for d in diffs
            if not d["path"].endswith(".status") and d["path"] != "status"
        ]
        if len(non_status) == 0:
            candidates.append({
                "sep_candidate": "Administrative resend/correction (Exchange/Employer reprocessing)",
                "confidence": 0.85,
                "supporting_signals": ["status_only_or_no_change"],
            })

    if not candidates:
        candidates.append({
            "sep_candidate": "Unknown / insufficient signals",
            "confidence": 0.30,
            "supporting_signals": ["no_strong_change_signals_found"],
        })

    candidates = sorted(candidates, key=lambda x: x["confidence"], reverse=True)
    top = candidates[0]
    sep_confirmed = (
        top["confidence"] >= 0.70
        and top["sep_candidate"] != "Unknown / insufficient signals"
    )

    return json.dumps({
        "sep_confirmed": sep_confirmed,
        "sep_causality": top,
        "other_candidates": candidates[1:],
        "note": "Causality inference, not eligibility approval/denial.",
        "classification_used": {
            "enrollment_type": classification.get("enrollment_type"),
            "subtype": classification.get("subtype"),
            "sep_candidate": classification.get("sep_candidate"),
        },
    })
