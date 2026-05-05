"""
Distiller session management — single-record and batch processing entry points.
"""
import json
import os
from typing import Any, Dict, List, Optional, Tuple

from .client import create_client, PROJECT_NAME
from .utils import _utc_now_z
from ..data.sanitizer import build_engine_input

# ---------------------------------------------------------------------------
# BQ persist (optional — used only when persist=True)
# ---------------------------------------------------------------------------
def _bq_update(
    subscriber_id: str,
    root_status: str,
    agent_analysis: dict,
    markers: dict = None,
) -> None:
    """Persists agent results to BigQuery. No-op if BQ is unavailable."""
    from db.bq_connection import get_database
    db = get_database()
    if db is None:
        return
    db.members.update_one(
        {"subscriber_id": subscriber_id},
        {"$set": {
            "status":         root_status,
            "agent_analysis": agent_analysis,
            "markers":        markers or {},
            "updated_at":     _utc_now_z(),
        }},
        upsert=False,
    )


# Backwards-compatible alias kept for any callers that import mongo_update by name
mongo_update = _bq_update


def _safe_json_dumps(obj) -> str:
    """Makes any lingering non-JSON types serialisable (e.g. ObjectId)."""
    return json.dumps(obj, default=str)


async def _collect_distiller_text(responses) -> Tuple[str, List[Any]]:
    text_parts: List[str] = []
    errors: List[Any] = []
    raw_chunks: List[Any] = []

    async for chunk in responses:
        raw_chunks.append(chunk)

        if hasattr(chunk, "content") and chunk.content:
            text_parts.append(chunk.content)
        if hasattr(chunk, "error") and getattr(chunk, "error"):
            errors.append(getattr(chunk, "error"))

        if isinstance(chunk, dict):
            if "error" in chunk:
                errors.append(chunk["error"])
            if chunk.get("content"):
                text_parts.append(chunk["content"])

    final_text = "".join(text_parts).strip()
    if not final_text and not errors:
        errors.append(f"No content returned. First chunks: {raw_chunks[:3]}")
    return final_text, errors


async def process_record(record: Dict[str, Any], persist: bool = False) -> Dict[str, Any]:
    """
    Single record. Opens one Distiller session per call.
    Prefer process_records_batch for batch endpoints.
    """
    from ..agents import get_executor_dict

    client = create_client()
    run_uuid = os.getenv("AIREFINERY_UUID", "enrollment_dev_local")

    thin = build_engine_input(record)
    payload = _safe_json_dumps(thin)

    async with client.distiller(
        project=PROJECT_NAME,
        uuid=run_uuid,
        executor_dict=get_executor_dict(),
    ) as dc:
        responses = await dc.query(query=payload)
        final_text, errors = await _collect_distiller_text(responses)

    if errors:
        raise RuntimeError(f"Distiller error: {errors}")

    result = json.loads(final_text)

    if persist and result.get("subscriber_id"):
        _bq_update(
            subscriber_id=result["subscriber_id"],
            root_status=result.get("root_status_recommended", "In Review"),
            agent_analysis=result.get("agent_analysis", {}),
            markers=result.get("markers", {}),
        )

    return result


async def process_records_batch(
    records: List[Dict[str, Any]],
    persist: bool = False,
) -> List[Dict[str, Any]]:
    """
    Batch processing — one Distiller session for all records.
    """
    from ..agents import get_executor_dict

    client = create_client()
    run_uuid = os.getenv("AIREFINERY_UUID", "enrollment_dev_local")
    results: List[Dict[str, Any]] = []

    async with client.distiller(
        project=PROJECT_NAME,
        uuid=run_uuid,
        executor_dict=get_executor_dict(),
    ) as dc:
        for raw in records:
            subscriber_id = raw.get("subscriber_id")
            try:
                thin = build_engine_input(raw)
                payload = _safe_json_dumps(thin)

                responses = await dc.query(query=payload)
                final_text, errors = await _collect_distiller_text(responses)

                if errors:
                    results.append({
                        "subscriber_id": subscriber_id,
                        "root_status_recommended": "In Review",
                        "agent_analysis": {"error": errors},
                    })
                    continue

                parsed = json.loads(final_text)

                if persist and parsed.get("subscriber_id"):
                    _bq_update(
                        subscriber_id=parsed["subscriber_id"],
                        root_status=parsed.get("root_status_recommended", "In Review"),
                        agent_analysis=parsed.get("agent_analysis", {}),
                        markers=parsed.get("markers", {}),
                    )

                results.append(parsed)

            except Exception as e:
                results.append({
                    "subscriber_id": subscriber_id,
                    "root_status_recommended": "In Review",
                    "agent_analysis": {
                        "error": "process_records_batch failed for record",
                        "exception": type(e).__name__,
                        "message": str(e),
                    },
                })

    return results
