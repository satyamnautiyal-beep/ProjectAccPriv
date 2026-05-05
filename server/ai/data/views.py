"""
Stage-specific view builders — each agent receives only the data it needs.
"""
from typing import Any, Dict


def _history_last_two(history: Dict[str, Any]) -> Dict[str, Any]:
    """Returns a history dict containing only the latest 2 snapshot dates."""
    if not history:
        return {}
    dates = sorted(history.keys())
    if len(dates) <= 2:
        return {d: history[d] for d in dates}
    return {dates[-2]: history[dates[-2]], dates[-1]: history[dates[-1]]}


def classification_view(record: Dict[str, Any]) -> Dict[str, Any]:
    """Classifier only needs subscriber_id + last two snapshots."""
    history = record.get("history") or {}
    return {
        "subscriber_id": record.get("subscriber_id"),
        "history": _history_last_two(history),
    }


def sep_inference_view(record: Dict[str, Any]) -> Dict[str, Any]:
    """SEP inference only needs last two snapshots (dependents + member_info changes)."""
    history = record.get("history") or {}
    return {
        "subscriber_id": record.get("subscriber_id"),
        "history": _history_last_two(history),
    }


def normal_flow_view(record: Dict[str, Any]) -> Dict[str, Any]:
    """Normal flow needs the full history to build a timeline."""
    return {
        "subscriber_id": record.get("subscriber_id"),
        "history": record.get("history") or {},
    }


def decision_view(record: Dict[str, Any]) -> Dict[str, Any]:
    """Decision needs minimal root flags + last two snapshots."""
    history = record.get("history") or {}
    return {
        "subscriber_id": record.get("subscriber_id"),
        "status": record.get("status"),
        "validation_issues": record.get("validation_issues") or [],
        "history": _history_last_two(history),
    }
