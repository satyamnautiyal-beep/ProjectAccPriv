"""
Chat assistant helper functions — member name extraction, SEP context builder,
message list builder.
"""
import os
from typing import Any, Dict, List

from ..chat.system_prompt import SYSTEM_PROMPT


def _extract_member_name(member_doc: dict) -> str:
    """
    Extracts a display name from a member document using the latest snapshot.
    Falls back to 'Unknown' when any key is absent.
    """
    latest_date = member_doc.get("latest_update")
    snapshot = (member_doc.get("history") or {}).get(latest_date, {})
    info = snapshot.get("member_info") or {}
    return " ".join(filter(None, [info.get("first_name"), info.get("last_name")])) or "Unknown"


def _build_sep_context(member_doc: dict):
    """
    Extracts the SEP context object from a member document.
    Returns the same shape as get_subscriber_details' sep field, or None when no SEP markers.
    """
    markers = member_doc.get("markers") or {}
    if not markers.get("is_sep_confirmed"):
        return None

    agent_analysis = member_doc.get("agent_analysis") or {}
    branch_analysis = agent_analysis.get("branch_analysis") or {}
    evidence_check = agent_analysis.get("evidence_check") or {}
    causality = branch_analysis.get("sep_causality") or {}

    return {
        "sep_type": markers.get("sep_type") or causality.get("sep_candidate") or "—",
        "sep_confidence": markers.get("sep_confidence") or causality.get("confidence"),
        "supporting_signals": causality.get("supporting_signals") or [],
        "other_candidates": branch_analysis.get("other_candidates") or [],
        "is_within_oep": markers.get("is_within_oep"),
        "evidence_status": markers.get("evidence_status") or "—",
        "required_docs": evidence_check.get("required_docs") or [],
        "submitted_docs": evidence_check.get("submitted_docs") or [],
        "missing_docs": evidence_check.get("missing_docs") or [],
        "evidence_complete": evidence_check.get("evidence_complete"),
    }


def _get_api_key() -> str:
    key = (
        os.getenv("AI_REFINERY_KEY")
        or os.getenv("AI_REFINERY_API_KEY")
        or os.getenv("API_KEY")
    )
    return key or ""


def _build_messages(
    history: List[Dict[str, str]],
    system_context: str,
) -> List[Dict[str, str]]:
    system_with_context = SYSTEM_PROMPT
    if system_context:
        system_with_context += (
            f"\n\nLatest system snapshot (may be stale — call get_system_status for fresh data):\n{system_context}"
        )
    messages = [{"role": "system", "content": system_with_context}]
    for msg in history:
        role = "user" if msg.get("role") == "user" else "assistant"
        messages.append({"role": role, "content": msg.get("text", "")})
    return messages
