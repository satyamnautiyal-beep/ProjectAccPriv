import asyncio
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv
from air import AsyncAIRefinery

# -----------------------------------
# ENV + CONFIG
# -----------------------------------
load_dotenv()

PROJECT_NAME = "enrollment_intelligence"
CONFIG_PATH = (Path(__file__).resolve().parent / "enrollment_intelligence.yaml").resolve()
_HASH_CACHE = Path(__file__).resolve().parent / ".enrollment_intelligence_project_version"

# Mongo (optional)
MONGO_URI = os.getenv("MONGO_URI", "")
MONGO_DB = os.getenv("MONGO_DB_NAME", "health_enroll")
MONGO_COLLECTION = os.getenv("MONGO_COLLECTION", "members")

DEFAULT_ENROLLMENT_SOURCE = os.getenv("DEFAULT_ENROLLMENT_SOURCE", "Employer")

# -----------------------------------
# PROJECT LIFECYCLE
# -----------------------------------
def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def _ensure_project(client: AsyncAIRefinery) -> None:
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(f"Config file not found: {CONFIG_PATH}")

    new_hash = _sha256_file(CONFIG_PATH)
    old_hash = _HASH_CACHE.read_text().strip() if _HASH_CACHE.exists() else ""

    if new_hash != old_hash:
        is_valid = client.distiller.validate_config(config_path=str(CONFIG_PATH))
        if not is_valid:
            raise ValueError(f"AI Refinery rejected config: {CONFIG_PATH}")

        client.distiller.create_project(config_path=str(CONFIG_PATH), project=PROJECT_NAME)
        _HASH_CACHE.write_text(new_hash)

def create_client() -> AsyncAIRefinery:
    api_key = os.getenv("AI_REFINERY_KEY") or os.getenv("AI_REFINERY_API_KEY")
    if not api_key:
        raise RuntimeError("Missing AI_REFINERY_KEY / AI_REFINERY_API_KEY")

    client = AsyncAIRefinery(api_key=api_key)
    _ensure_project(client)
    return client

# -----------------------------------
# HELPERS
# -----------------------------------
def _sorted_history_dates(record: Dict[str, Any]) -> List[str]:
    return sorted(record.get("history", {}).keys())

def _get_latest_two_snapshots(record: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]], List[str]]:
    dates = _sorted_history_dates(record)
    if len(dates) == 0:
        return None, None, dates
    if len(dates) == 1:
        return record["history"][dates[-1]], None, dates
    return record["history"][dates[-1]], record["history"][dates[-2]], dates

def _deep_diff(a: Any, b: Any, path: str = "") -> List[Dict[str, Any]]:
    diffs: List[Dict[str, Any]] = []

    if type(a) != type(b):
        diffs.append({"path": path, "from": a, "to": b, "type": "type_change"})
        return diffs

    if isinstance(a, dict):
        keys = set(a.keys()) | set(b.keys())
        for k in sorted(keys):
            p = f"{path}.{k}" if path else k
            if k not in a:
                diffs.append({"path": p, "from": None, "to": b[k], "type": "added"})
            elif k not in b:
                diffs.append({"path": p, "from": a[k], "to": None, "type": "removed"})
            else:
                diffs.extend(_deep_diff(a[k], b[k], p))
        return diffs

    if isinstance(a, list):
        if a != b:
            diffs.append({"path": path, "from": a, "to": b, "type": "list_changed"})
        return diffs

    if a != b:
        diffs.append({"path": path, "from": a, "to": b, "type": "value_changed"})
    return diffs

def _utc_now_z() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

# -----------------------------------
# MONGO PERSIST (optional)
# -----------------------------------
def mongo_update(subscriber_id: str, root_status: str, agent_analysis: Dict[str, Any]) -> None:
    if not MONGO_URI:
        return

    from pymongo import MongoClient
    client = MongoClient(MONGO_URI)
    col = client[MONGO_DB][MONGO_COLLECTION]
    col.update_one(
        {"subscriber_id": subscriber_id},
        {"$set": {"status": root_status, "agent_analysis": agent_analysis}},
        upsert=False,
    )

# -----------------------------------
# ✅ FULL LOGIC SINGLE CUSTOM AGENT
# -----------------------------------
async def EnrollmentPipelineAgent(query: str, **kwargs) -> str:
    """
    Called by Distiller. Must return ONLY a JSON string.
    """
    try:
        record = json.loads(query)
        subscriber_id = record.get("subscriber_id")

        latest, prev, dates = _get_latest_two_snapshots(record)

        # -------- 1) Snapshot differencer --------
        if not latest:
            return json.dumps({
                "subscriber_id": subscriber_id,
                "root_status_recommended": "In Review",
                "agent_analysis": {"error": "No history snapshots found", "history_dates": dates},
            })

        if not prev:
            diff = {
                "history_dates": dates,
                "diff": [],
                "semantic_flags": ["first_snapshot_only"],
                "notes": "Only one snapshot exists; nothing to diff yet."
            }
        else:
            raw_diffs = _deep_diff(prev, latest)
            flags = []
            if len(raw_diffs) == 0:
                flags.append("exact_resend_or_duplicate")
            else:
                non_status = [d for d in raw_diffs if not d["path"].endswith(".status") and d["path"] != "status"]
                if len(non_status) == 0:
                    flags.append("status_only_change")
                if any("dependents" in d["path"] for d in raw_diffs):
                    flags.append("household_structure_change")
                if any("coverages" in d["path"] for d in raw_diffs):
                    flags.append("coverage_change")

            diff = {
                "history_dates": dates,
                "latest_date": dates[-1],
                "previous_date": dates[-2],
                "diff": raw_diffs,
                "semantic_flags": flags
            }

        # -------- 2) Timeline reconstruction --------
        history = record.get("history", {})
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

        timeline = {
            "subscriber_id": subscriber_id,
            "history_dates": _sorted_history_dates(record),
            "timeline": timeline_rows,
            "observations": {
                "distinct_effective_dates": sorted(set([x for x in effective_dates if x])),
                "snapshot_count": len(timeline_rows),
            }
        }

        # -------- 3) SEP causality inference (heuristics) --------
        candidates = []
        if prev and latest:
            prev_deps = prev.get("dependents", []) or []
            latest_deps = latest.get("dependents", []) or []
            if len(prev_deps) != len(latest_deps):
                candidates.append({
                    "sep_candidate": "Household change (marriage/birth/adoption/divorce)",
                    "confidence": 0.75,
                    "supporting_signals": ["dependents_count_changed"]
                })

            p = prev.get("member_info", {}) or {}
            l = latest.get("member_info", {}) or {}
            if any(p.get(k) != l.get(k) for k in ["address_line_1", "city", "state", "zip"]):
                candidates.append({
                    "sep_candidate": "Permanent move / relocation",
                    "confidence": 0.70,
                    "supporting_signals": ["address_fields_changed"]
                })

            diffs = _deep_diff(prev, latest)
            non_status = [d for d in diffs if not d["path"].endswith(".status") and d["path"] != "status"]
            if len(non_status) == 0:
                candidates.append({
                    "sep_candidate": "Administrative resend/correction (Exchange/Employer reprocessing)",
                    "confidence": 0.85,
                    "supporting_signals": ["status_only_or_no_change"]
                })

        if not candidates:
            candidates.append({
                "sep_candidate": "Unknown / insufficient signals",
                "confidence": 0.30,
                "supporting_signals": ["no_strong_change_signals_found"]
            })

        candidates = sorted(candidates, key=lambda x: x["confidence"], reverse=True)
        sep_inference = {
            "sep_causality": candidates[0],
            "other_candidates": candidates[1:],
            "note": "This is causality inference, not eligibility approval/denial."
        }

        # -------- 4) Authority / trust classification --------
        source = record.get("source_system") or DEFAULT_ENROLLMENT_SOURCE
        payer_discretion = False if source in ["Exchange", "CMS", "FFE", "SBE"] else True
        authority = {
            "authority_analysis": {
                "source": source,
                "payer_discretion": payer_discretion,
                "notes": "Add EDI envelope sender/receiver IDs to Mongo for deterministic classification."
            }
        }

        # -------- 5) Risk + root status decision --------
        validation_issues = record.get("validation_issues", []) or []
        latest_snapshot_status = latest.get("status")
        root_status_current = record.get("status")

        risk = {"level": "Low", "reasons": []}
        root_status_recommended = "Ready"

        if validation_issues:
            risk["level"] = "High"
            risk["reasons"].append("validation_issues_present")
            root_status_recommended = "In Review"

        if latest_snapshot_status and "Pending" in latest_snapshot_status:
            risk["reasons"].append("latest_snapshot_pending_business_validation")
            root_status_recommended = "In Review"

        decision = {
            "root_status_current": root_status_current,
            "root_status_recommended": root_status_recommended,
            "agent_analysis_patch": {
                "generated_at": _utc_now_z(),
                "latest_snapshot_date": dates[-1] if dates else None,
                "latest_snapshot_status": latest_snapshot_status,
                "risk": risk,
                "recommended_root_status": root_status_recommended,
                "explain": (
                    "History snapshots are treated as immutable facts. "
                    "Root status is operational."
                )
            }
        }

        final_agent_analysis = {
            "diff": diff,
            "timeline": timeline,
            "sep_inference": sep_inference,
            "authority": authority,
            "decision": decision
        }

        output = {
            "subscriber_id": subscriber_id,
            "root_status_recommended": root_status_recommended,
            "agent_analysis": final_agent_analysis
        }

        return json.dumps(output)

    except Exception as e:
        return json.dumps({
            "subscriber_id": None,
            "root_status_recommended": "In Review",
            "agent_analysis": {
                "error": "EnrollmentPipelineAgent failed",
                "exception": type(e).__name__,
                "message": str(e)
            }
        })

# -----------------------------------
# EXECUTOR
# -----------------------------------
executor_dict = {"EnrollmentPipelineAgent": EnrollmentPipelineAgent}

# -----------------------------------
# ROBUST DISTILLER COLLECTOR (handles DistillerIncomingMessage objects)
# -----------------------------------
async def process_record(record: Dict[str, Any], persist: bool = False) -> Dict[str, Any]:
    client = create_client()
    payload = json.dumps(record)
    run_uuid = os.getenv("AIREFINERY_UUID", "enrollment_dev_local")

    async with client.distiller(
        project=PROJECT_NAME,
        uuid=run_uuid,
        executor_dict=executor_dict,
    ) as dc:

        responses = await dc.query(query=payload)

        raw_chunks = []
        text_parts = []
        errors = []

        async for chunk in responses:
            raw_chunks.append(chunk)

            # Object-style chunks (DistillerIncomingMessage)
            if hasattr(chunk, "content") and chunk.content:
                text_parts.append(chunk.content)

            if hasattr(chunk, "error") and getattr(chunk, "error"):
                errors.append(getattr(chunk, "error"))

            # Dict-style fallback
            if isinstance(chunk, dict):
                if "error" in chunk:
                    errors.append(chunk["error"])
                if chunk.get("content"):
                    text_parts.append(chunk["content"])

    if errors:
        raise RuntimeError(f"Distiller error: {errors}\nFirst chunks: {raw_chunks[:3]}")

    final_text = "".join(text_parts).strip()
    if not final_text:
        raise RuntimeError(f"No content returned from agent.\nRaw chunks: {raw_chunks[:3]}")

    result = json.loads(final_text)

    if persist and result.get("subscriber_id"):
        mongo_update(
            subscriber_id=result["subscriber_id"],
            root_status=result["root_status_recommended"],
            agent_analysis=result["agent_analysis"],
        )

    return result

# -----------------------------------
# CLI
# -----------------------------------
if __name__ == "__main__":
    import sys
    record = json.loads(sys.stdin.read())
    out = asyncio.run(process_record(record, persist=False))
    print(json.dumps(out, indent=2))