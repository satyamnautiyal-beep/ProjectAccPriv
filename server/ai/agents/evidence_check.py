"""
EvidenceCheckAgent — verifies submitted documents against SEP requirements.
Returns JSON only.
"""
import json
import os
from pathlib import Path
from typing import Any, Dict, List

from .base import register_agent
from ..core.utils import (
    _load_json_file,
    _DEFAULT_SEP_REQUIRED_DOCS,
    _DEFAULT_MOCK_SUBMITTED_DOCS,
)

# Paths to data files (relative to the ai/ package root)
_AI_ROOT = Path(__file__).resolve().parent.parent
SEP_REQUIRED_DOCS_PATH = (_AI_ROOT / "sep_required_docs.json").resolve()
MOCK_SUBMITTED_DOCS_PATH = (_AI_ROOT / "mock_submitted_docs.json").resolve()


def _get_sep_required_docs(sep_type: str) -> Dict[str, Any]:
    mapping, warn = _load_json_file(SEP_REQUIRED_DOCS_PATH, _DEFAULT_SEP_REQUIRED_DOCS)
    required = mapping.get(sep_type)
    return {"mapping_warning": warn, "required_docs": required}


def _get_submitted_docs(subscriber_id: str) -> Dict[str, Any]:
    submitted_map, warn = _load_json_file(MOCK_SUBMITTED_DOCS_PATH, _DEFAULT_MOCK_SUBMITTED_DOCS)
    submitted = submitted_map.get(subscriber_id, [])
    return {"mapping_warning": warn, "submitted_docs": submitted}


@register_agent("EvidenceCheckAgent")
async def EvidenceCheckAgent(query: str, **kwargs) -> str:
    """
    Input:  {"subscriber_id": "...", "sep_type": "Permanent move / relocation"}
    Output: evidence completeness check with required/submitted/missing docs.
    """
    payload = json.loads(query)
    subscriber_id = payload.get("subscriber_id")
    sep_type = payload.get("sep_type")

    warnings: List[str] = []
    req_info = _get_sep_required_docs(sep_type)
    sub_info = _get_submitted_docs(subscriber_id)

    if req_info.get("mapping_warning"):
        warnings.append(req_info["mapping_warning"])
    if sub_info.get("mapping_warning"):
        warnings.append(sub_info["mapping_warning"])

    required_docs = req_info.get("required_docs")
    submitted_docs = sub_info.get("submitted_docs") or []

    # SEP type not configured → treat as not verifiable → In Review
    if not required_docs:
        return json.dumps({
            "sep_type": sep_type,
            "required_docs": [],
            "submitted_docs": submitted_docs,
            "missing_docs": ["<UNMAPPED_SEP_TYPE_IN_sep_required_docs.json>"],
            "evidence_complete": False,
            "email_triggered": True,
            "email_reason": f"SEP type not mapped to required docs: {sep_type}",
            "warnings": warnings,
        })

    submitted_lower = [s.lower() for s in submitted_docs]

    def _doc_satisfied(required: str) -> bool:
        req_lower = required.lower()
        return any(req_lower in s or s in req_lower for s in submitted_lower)

    # Household-change SEP: any one doc suffices; all others require all docs
    household_sep_types = {"household change", "marriage", "birth", "adoption", "divorce"}
    is_any_one_sufficient = any(kw in (sep_type or "").lower() for kw in household_sep_types)

    if is_any_one_sufficient:
        satisfied = [d for d in required_docs if _doc_satisfied(d)]
        not_submitted = [d for d in required_docs if not _doc_satisfied(d)]
        missing_docs = [] if satisfied else not_submitted
        evidence_complete = len(satisfied) > 0
    else:
        missing_docs = [d for d in required_docs if not _doc_satisfied(d)]
        evidence_complete = len(missing_docs) == 0

    email_triggered = not evidence_complete
    email_reason = None
    if email_triggered:
        email_reason = f"Missing required evidence for SEP type '{sep_type}': {missing_docs}"

    return json.dumps({
        "sep_type": sep_type,
        "required_docs": required_docs,
        "submitted_docs": submitted_docs,
        "missing_docs": missing_docs,
        "evidence_complete": evidence_complete,
        "email_triggered": email_triggered,
        "email_reason": email_reason,
        "warnings": warnings,
    })
