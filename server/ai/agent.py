"""
Backward-compatibility shim.
All real logic lives in the modular sub-packages.
Existing imports (server.routers.*, etc.) continue to work unchanged.
"""
import asyncio

# Core
from .core.client import create_client, PROJECT_NAME          # noqa: F401
from .core.distiller import (                                  # noqa: F401
    process_record,
    process_records_batch,
    mongo_update,
)
from .core.utils import _utc_now_z                            # noqa: F401

# Data layer
from .data.sanitizer import build_engine_input                # noqa: F401
from .data.views import (                                      # noqa: F401
    classification_view  as _classification_view,
    sep_inference_view   as _sep_inference_view,
    normal_flow_view     as _normal_flow_view,
    decision_view        as _decision_view,
)

# Agents
from .agents import get_executor_dict                         # noqa: F401
from .agents.classifier       import EnrollmentClassifierAgent  # noqa: F401
from .agents.sep_inference    import SepInferenceAgent          # noqa: F401
from .agents.normal_enrollment import NormalEnrollmentAgent     # noqa: F401
from .agents.decision         import DecisionAgent              # noqa: F401
from .agents.evidence_check   import EvidenceCheckAgent         # noqa: F401
from .agents.router           import EnrollmentRouterAgent      # noqa: F401

# executor_dict as a plain dict (legacy callers expect a dict, not a callable)
executor_dict = get_executor_dict()


def orchestrate_enrollment(record: dict) -> dict:
    """Sync wrapper for process_record. Used by FastAPI router endpoints."""
    return asyncio.run(process_record(record, persist=False))


# -----------------------------------
# ENV + CONFIG
# -----------------------------------
load_dotenv()

PROJECT_NAME = "enrollment_intelligence"
CONFIG_PATH = (Path(__file__).resolve().parent / "config.yaml").resolve()
_HASH_CACHE = Path(__file__).resolve().parent / ".enrollment_intelligence_project_version"

# Evidence config (NEW)
SEP_REQUIRED_DOCS_PATH = (Path(__file__).resolve().parent / "sep_required_docs.json").resolve()
MOCK_SUBMITTED_DOCS_PATH = (Path(__file__).resolve().parent / "mock_submitted_docs.json").resolve()

# Mongo (optional - used only if persist=True in process_record/process_records_batch)
MONGO_URI = os.getenv("MONGO_URI", "")
MONGO_DB = os.getenv("MONGO_DB_NAME", "health_enroll")
MONGO_COLLECTION = os.getenv("MONGO_COLLECTION", "members")

DEFAULT_ENROLLMENT_SOURCE = os.getenv("DEFAULT_ENROLLMENT_SOURCE", "Employer")

# OEP CONFIG (ENV-DRIVEN)
OEP_START_DATE = os.getenv("OEP_START_DATE")  # YYYY-MM-DD
OEP_END_DATE = os.getenv("OEP_END_DATE")      # YYYY-MM-DD


# -----------------------------------
# PROJECT LIFECYCLE
# -----------------------------------
def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _ensure_project(client: AsyncAIRefinery) -> None:
    """
    Create/refresh the Distiller project only when config.yaml changes.
    """
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(f"Config file not found: {CONFIG_PATH}")

    new_hash = _sha256_file(CONFIG_PATH)
    old_hash = _HASH_CACHE.read_text().strip() if _HASH_CACHE.exists() else ""

    if new_hash != old_hash:
        is_valid = client.distiller.validate_config(config_path=str(CONFIG_PATH))
        if not is_valid:
            raise ValueError(f"AI Refinery rejected config: {CONFIG_PATH}")

        client.distiller.create_project(
            config_path=str(CONFIG_PATH),
            project=PROJECT_NAME
        )
        _HASH_CACHE.write_text(new_hash)


def create_client() -> AsyncAIRefinery:
    api_key = os.getenv("AI_REFINERY_KEY") or os.getenv("AI_REFINERY_API_KEY") or os.getenv("API_KEY")
    if not api_key:
        raise RuntimeError("Missing AI_REFINERY_KEY / AI_REFINERY_API_KEY / API_KEY")

    client = AsyncAIRefinery(api_key=api_key)
    _ensure_project(client)
    return client


# -----------------------------------
# HELPERS
# -----------------------------------
def _sorted_history_dates(record: Dict[str, Any]) -> List[str]:
    return sorted((record.get("history") or {}).keys())


def _get_latest_two_snapshots(
    record: Dict[str, Any]
) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]], List[str]]:
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


# ✅ DATE / OEP HELPERS
def _parse_date(d: Optional[str]) -> Optional[date]:
    if not d:
        return None
    return datetime.strptime(d, "%Y-%m-%d").date()


def is_within_oep(today: date) -> Optional[bool]:
    """
    True  -> within OEP
    False -> outside OEP
    None  -> OEP not configured
    """
    start = _parse_date(OEP_START_DATE)
    end = _parse_date(OEP_END_DATE)
    if not start or not end:
        return None
    return start <= today <= end



# ✅ SAFE JSON FILE LOADERS (NEW)
_DEFAULT_SEP_REQUIRED_DOCS = {
    "Permanent move / relocation": ["Proof of new address", "Date of move"],
    "Household change (marriage/birth/adoption/divorce)": ["Marriage certificate or birth/adoption record"],
    "Loss of coverage": ["Termination letter", "Prior coverage end"],
}
_DEFAULT_MOCK_SUBMITTED_DOCS = {
    "SUB123": ["Proof of new address"]
}


def _load_json_file(path: Path, default: Any) -> Tuple[Any, Optional[str]]:
    """
    Returns (data, warning). If file missing/invalid, returns (default, warning).
    """
    try:
        if not path.exists():
            return default, f"file_missing:{str(path)}"
        raw = path.read_text(encoding="utf-8")
        return json.loads(raw), None
    except Exception as e:
        return default, f"file_load_failed:{str(path)}:{type(e).__name__}:{str(e)}"


def _get_sep_required_docs(sep_type: str) -> Dict[str, Any]:
    mapping, warn = _load_json_file(SEP_REQUIRED_DOCS_PATH, _DEFAULT_SEP_REQUIRED_DOCS)
    required = mapping.get(sep_type)
    return {"mapping_warning": warn, "required_docs": required}


def _get_submitted_docs(subscriber_id: str) -> Dict[str, Any]:
    submitted_map, warn = _load_json_file(MOCK_SUBMITTED_DOCS_PATH, _DEFAULT_MOCK_SUBMITTED_DOCS)
    submitted = submitted_map.get(subscriber_id, [])
    return {"mapping_warning": warn, "submitted_docs": submitted}


# -----------------------------------
# ✅ Step A: THIN ENGINE INPUT (sanitize before Distiller)
# -----------------------------------
def build_engine_input(record: dict) -> dict:
    """
    Removes Mongo _id and strips PII (ssn, dob) from subscriber + dependents
    before sending to Distiller. Zero agent changes. Immediate risk reduction.
    """
    r = copy.deepcopy(record)

    # Remove Mongo internal id (ObjectId or {"$oid": "..."} export)
    r.pop("_id", None)

    history = r.get("history") or {}
    for _, snap in history.items():
        # subscriber PII
        mi = snap.get("member_info") or {}
        mi.pop("ssn", None)
        mi.pop("dob", None)

        # dependents PII
        for dep in (snap.get("dependents") or []):
            dmi = dep.get("member_info") or {}
            dmi.pop("ssn", None)
            dmi.pop("dob", None)

    return r


# -----------------------------------
# ✅ Step B: STAGE-SPECIFIC VIEWS
# -----------------------------------
def _history_last_two_view(history: Dict[str, Any]) -> Dict[str, Any]:
    """
    Returns a history dict containing only the latest 2 snapshot dates.
    Keeps date keys as strings.
    """
    if not history:
        return {}
    dates = sorted(history.keys())
    if len(dates) <= 2:
        return {d: history[d] for d in dates}
    return {dates[-2]: history[dates[-2]], dates[-1]: history[dates[-1]]}


def _classification_view(record: Dict[str, Any]) -> Dict[str, Any]:
    """
    Classifier only needs subscriber_id + last two snapshots.
    """
    history = record.get("history") or {}
    return {
        "subscriber_id": record.get("subscriber_id"),
        "history": _history_last_two_view(history),
    }


def _sep_inference_view(record: Dict[str, Any]) -> Dict[str, Any]:
    """
    SEP inference only needs last two snapshots too (dependents + member_info changes).
    """
    history = record.get("history") or {}
    return {
        "subscriber_id": record.get("subscriber_id"),
        "history": _history_last_two_view(history),
    }


def _normal_flow_view(record: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normal flow produces timeline; it needs the full history (but still sanitized by build_engine_input).
    """
    return {
        "subscriber_id": record.get("subscriber_id"),
        "history": record.get("history") or {},
    }


def _decision_view(record: Dict[str, Any]) -> Dict[str, Any]:
    """
    Decision needs minimal root flags + last snapshot status (from last 2 snapshots).
    """
    history = record.get("history") or {}
    return {
        "subscriber_id": record.get("subscriber_id"),
        "status": record.get("status"),
        "validation_issues": record.get("validation_issues") or [],
        "history": _history_last_two_view(history),
    }


# -----------------------------------
# MONGO PERSIST (optional)
# -----------------------------------
def mongo_update(subscriber_id: str, root_status: str, agent_analysis: Dict[str, Any], markers: Optional[Dict[str, Any]] = None) -> None:
    if not MONGO_URI:
        return
    from pymongo import MongoClient
    client = MongoClient(MONGO_URI)
    col = client[MONGO_DB][MONGO_COLLECTION]
    col.update_one(
        {"subscriber_id": subscriber_id},
        {"$set": {"status": root_status, "agent_analysis": agent_analysis, "markers": markers or {}, "updated_at": _utc_now_z()}},
        upsert=False,
    )


# ============================================================
#  UTILITY AGENTS + ROUTER
# ============================================================
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
            "history_dates": dates
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
        "history_dates": dates
    })


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
    top = candidates[0]
    sep_confirmed = top["confidence"] >= 0.70 and top["sep_candidate"] != "Unknown / insufficient signals"

    return json.dumps({
        "sep_confirmed": sep_confirmed,
        "sep_causality": top,
        "other_candidates": candidates[1:],
        "note": "Causality inference, not eligibility approval/denial.",
        "classification_used": {
            "enrollment_type": classification.get("enrollment_type"),
            "subtype": classification.get("subtype"),
            "sep_candidate": classification.get("sep_candidate")
        }
    })


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
            "notes": "Processed via normal flow; SEP inference skipped."
        },
        "timeline": {
            "history_dates": _sorted_history_dates(record),
            "timeline": timeline_rows,
            "observations": {
                "distinct_effective_dates": sorted(set([x for x in effective_dates if x])),
                "snapshot_count": len(timeline_rows)
            }
        }
    })


async def DecisionAgent(query: str, **kwargs) -> str:
    """
    ✅ Updated: no longer forces 'SEP confirmed => In Review always'
    Instead returns:
      - hard_blocks (validation issues / blocking status)
      - requires_evidence_check (when SEP confirmed)
    Router will run EvidenceCheckAgent next and finalize Ready/In Review.
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

    # Hard blocks = must remain In Review regardless of evidence completeness
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
        # Don't force review here; evidence check step will finalize.
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
            "generated_at": _utc_now_z(),
            "latest_snapshot_date": dates[-1] if dates else None,
            "latest_snapshot_status": latest_snapshot_status,
            "risk": risk,
            "classification": classification,
            "analysis_used": analysis,
            "requires_evidence_check": requires_evidence_check,
            "hard_blocks": hard_blocks,
            "explain": "Decision aggregates deterministic blockers; SEP confirmed triggers evidence check instead of auto-review."
        }
    })


# Evidence Check Agent
async def EvidenceCheckAgent(query: str, **kwargs) -> str:
    """
    Input:
      {
        "subscriber_id": "...",
        "sep_type": "Permanent move / relocation"
      }
    Output:
      {
        "sep_type": ...,
        "required_docs": [...],
        "submitted_docs": [...],
        "missing_docs": [...],
        "evidence_complete": bool,
        "email_triggered": bool,
        "email_reason": str | None,
        "warnings": [...]
      }
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

    # If SEP type isn't configured, treat as not verifiable => In Review
    if not required_docs:
        evidence_complete = False
        missing_docs = ["<UNMAPPED_SEP_TYPE_IN_sep_required_docs.json>"]
        email_triggered = True
        email_reason = f"SEP type not mapped to required docs: {sep_type}"
        return json.dumps({
            "sep_type": sep_type,
            "required_docs": [],
            "submitted_docs": submitted_docs,
            "missing_docs": missing_docs,
            "evidence_complete": evidence_complete,
            "email_triggered": email_triggered,
            "email_reason": email_reason,
            "warnings": warnings
        })

    # Normalise for case-insensitive substring matching
    submitted_lower = [s.lower() for s in submitted_docs]

    def _doc_satisfied(required: str) -> bool:
        """
        A required doc is satisfied if any submitted doc is a case-insensitive
        substring match in either direction (submitted contains required keyword
        or required contains submitted keyword).
        """
        req_lower = required.lower()
        return any(
            req_lower in s or s in req_lower
            for s in submitted_lower
        )

    # Household-change SEP: member needs to submit ONE of the listed docs (any one suffices)
    # All other SEP types: member must submit ALL listed docs
    household_sep_types = {"household change", "marriage", "birth", "adoption", "divorce"}
    is_any_one_sufficient = any(kw in (sep_type or "").lower() for kw in household_sep_types)

    if is_any_one_sufficient:
        # Evidence complete if at least one required doc is satisfied
        satisfied = [d for d in required_docs if _doc_satisfied(d)]
        # missing_docs = docs that weren't submitted (informational only — not blocking)
        not_submitted = [d for d in required_docs if not _doc_satisfied(d)]
        missing_docs = [] if satisfied else not_submitted  # empty when evidence is complete
        evidence_complete = len(satisfied) > 0
    else:
        # Evidence complete only if ALL required docs are satisfied
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
        "warnings": warnings
    })


async def EnrollmentRouterAgent(query: str, **kwargs) -> str:
    """
    ✅ Stage-specific routing:
      - classify uses last 2 snapshots only
      - sep inference uses last 2 snapshots only
      - normal flow uses full history
      - decision uses minimal root flags + last 2 snapshots
      - evidence check (NEW) runs only when SEP confirmed and no other hard blocks
    """
    try:
        full_record = build_engine_input(json.loads(query))   # sanitized
        subscriber_id = full_record.get("subscriber_id")

        if not (full_record.get("history") or {}):
            return json.dumps({
                "subscriber_id": subscriber_id,
                "root_status_recommended": "In Review",
                "agent_analysis": {"error": "No history snapshots found", "history_dates": []}
            })

        # ---- 1) Classification (thin view)
        classification_record = _classification_view(full_record)
        classification = json.loads(await EnrollmentClassifierAgent(json.dumps(classification_record)))

        # ---- 2) Branch analysis
        if classification.get("sep_candidate"):
            sep_record = _sep_inference_view(full_record)
            branch_payload = json.dumps({"record": sep_record, "classification": classification})
            branch_analysis = json.loads(await SepInferenceAgent(branch_payload))
        else:
            normal_record = _normal_flow_view(full_record)
            branch_payload = json.dumps({"record": normal_record, "classification": classification})
            branch_analysis = json.loads(await NormalEnrollmentAgent(branch_payload))

        # ---- 3) Authority analysis (uses only source_system)
        source = full_record.get("source_system") or DEFAULT_ENROLLMENT_SOURCE
        payer_discretion = False if source in ["Exchange", "CMS", "FFE", "SBE"] else True
        authority = {
            "authority_analysis": {
                "source": source,
                "payer_discretion": payer_discretion,
                "notes": "Add EDI envelope sender/receiver IDs to Mongo for deterministic classification."
            }
        }

        # ---- 4) Decision
        decision_record = _decision_view(full_record)
        decision_payload = json.dumps({
            "record": decision_record,
            "classification": classification,
            "analysis": branch_analysis
        })
        decision = json.loads(await DecisionAgent(decision_payload))

        # ---- 5) Evidence check (NEW) + final status override
        root_status_recommended = decision.get("root_status_recommended", "In Review")
        evidence_check = None

        requires_evidence = decision.get("agent_analysis_patch", {}).get("requires_evidence_check", False)
        hard_blocks = decision.get("agent_analysis_patch", {}).get("hard_blocks", []) or []
        sep_confirmed = branch_analysis.get("sep_confirmed") is True

        if sep_confirmed and requires_evidence:
            # Run evidence check only if no other hard blockers exist
            sep_type = (branch_analysis.get("sep_causality") or {}).get("sep_candidate")
            ev_payload = json.dumps({"subscriber_id": subscriber_id, "sep_type": sep_type})
            evidence_check = json.loads(await EvidenceCheckAgent(ev_payload))

            if hard_blocks:
                # Keep In Review regardless of evidence
                root_status_recommended = "In Review"
            else:
                # No hard blocks; evidence determines final status
                if evidence_check.get("evidence_complete") is True:
                    root_status_recommended = "Enrolled (SEP)"
                else:
                    root_status_recommended = "In Review"

        # ---- Final status: promote "Ready" to "Enrolled" for clean OEP path
        # root_status_recommended is "Ready" only for OEP members with no hard blocks and no SEP.
        if root_status_recommended == "Ready" and not sep_confirmed:
            root_status_recommended = "Enrolled"

        # ---- Send email if SEP evidence is missing
        if evidence_check and evidence_check.get("email_triggered"):
            email = draft_email(
                template="sep_missing_documents",
                context={
                    "member_name": full_record.get("member_name", "Member"),
                    "sep_type": sep_type,
                    "missing_documents": "\n".join(evidence_check["missing_docs"])
                }
            )
            send_email(
                to=full_record.get("email"),
                email_payload=email
            )

        # ---- 6) Diff explainability
        latest, prev, dates = _get_latest_two_snapshots(classification_record)
        if prev is None:
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
                "latest_date": dates[-1] if dates else None,
                "previous_date": dates[-2] if len(dates) >= 2 else None,
                "diff": raw_diffs,
                "semantic_flags": flags
            }
        
        # ---- 5.5) Compute SEP markers for frontend filtering (NEW)
        is_sep_candidate = bool(classification.get("sep_candidate"))
        is_sep_confirmed = bool(branch_analysis.get("sep_confirmed")) if is_sep_candidate else False

        sep_type_marker = None
        sep_conf_marker = None
        if is_sep_confirmed:
            causality = (branch_analysis.get("sep_causality") or {})
            sep_type_marker = causality.get("sep_candidate")
            sep_conf_marker = causality.get("confidence")

        evidence_status = "not_applicable"
        last_evidence_check_at = None

        if is_sep_confirmed and requires_evidence:
            last_evidence_check_at = _utc_now_z()
            if not sep_type_marker:
                evidence_status = "unmapped"
            elif evidence_check and evidence_check.get("required_docs") == [] and evidence_check.get("missing_docs"):
                evidence_status = "unmapped"
            elif evidence_check and evidence_check.get("evidence_complete") is True:
                evidence_status = "complete"
            else:
                    evidence_status = "missing"

        markers = {
            "is_sep_candidate": is_sep_candidate,
            "is_sep_confirmed": is_sep_confirmed,
            "sep_type": sep_type_marker,
            "sep_confidence": sep_conf_marker,
            "evidence_status": evidence_status,
            "last_evidence_check_at": last_evidence_check_at,
            "received_at": full_record.get("received_at") or _utc_now_z(),
            # Enrollment path — always set so UI can filter/display
            "enrollment_path": "SEP" if is_sep_confirmed else "OEP",
            "is_within_oep": classification.get("is_within_oep"),
        }

        agent_analysis = {
            "diff": diff,
            "classification": classification,
            "branch_analysis": branch_analysis,
            "authority": authority,
            "decision": decision,
            "evidence_check": evidence_check,  # ✅ NEW
            "final_explain": {
                "final_root_status": root_status_recommended,
                "logic": (
                    "OEP clean path (no SEP, no hard blocks) => Enrolled. "
                    "SEP confirmed + evidence complete => Enrolled (SEP). "
                    "SEP confirmed + evidence missing => In Review + email triggered. "
                    "Hard blocks (validation issues / blocking status) => In Review."
                )
            }
        }


        return json.dumps({
            "subscriber_id": subscriber_id,
            "root_status_recommended": root_status_recommended,
            "plain_english_summary": decision.get("plain_english_summary"),  # lifted from DecisionAgent
            "markers": markers,
            "agent_analysis": agent_analysis
        })

    except Exception as e:
        return json.dumps({
            "subscriber_id": None,
            "root_status_recommended": "In Review",
            "plain_english_summary": None,  # null-safe on error path
            "agent_analysis": {
                "error": "EnrollmentRouterAgent failed",
                "exception": type(e).__name__,
                "message": str(e)
            }
        })


# -----------------------------------
# EXECUTOR (ALL AGENTS REGISTERED)
# -----------------------------------
executor_dict = {
    "EnrollmentClassifierAgent": EnrollmentClassifierAgent,
    "SepInferenceAgent": SepInferenceAgent,
    "NormalEnrollmentAgent": NormalEnrollmentAgent,
    "DecisionAgent": DecisionAgent,
    "EvidenceCheckAgent": EvidenceCheckAgent,         # ✅ NEW
    "EnrollmentRouterAgent": EnrollmentRouterAgent
}


# -----------------------------------
# DISTILLER STREAM COLLECTOR
# -----------------------------------
def _safe_json_dumps(obj: Any) -> str:
    """
    Safety: makes any lingering non-JSON types serializable (should be rare if _id removed).
    """
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


# -----------------------------------
# SINGLE RECORD (convenience)
# -----------------------------------
async def process_record(record: Dict[str, Any], persist: bool = False) -> Dict[str, Any]:
    """
    Single record. Still opens a session per call.
    Prefer process_records_batch for batch endpoints.
    """
    client = create_client()
    run_uuid = os.getenv("AIREFINERY_UUID", "enrollment_dev_local")

    thin = build_engine_input(record)
    payload = _safe_json_dumps(thin)

    async with client.distiller(
        project=PROJECT_NAME,
        uuid=run_uuid,
        executor_dict=executor_dict,
    ) as dc:
        responses = await dc.query(query=payload)
        final_text, errors = await _collect_distiller_text(responses)

    if errors:
        raise RuntimeError(f"Distiller error: {errors}")

    result = json.loads(final_text)

    if persist and result.get("subscriber_id"):
        mongo_update(
            subscriber_id=result["subscriber_id"],
            root_status=result.get("root_status_recommended", "In Review"),
            agent_analysis=result.get("agent_analysis", {}),
            markers=result.get("markers", {}),
        )

    return result


# -----------------------------------
# ✅ BATCH PROCESSING (ONE DISTILLER SESSION)
# -----------------------------------
async def process_records_batch(
    records: List[Dict[str, Any]],
    persist: bool = False
) -> List[Dict[str, Any]]:
    """
    Batch processing:
      - create_client() once
      - async with client.distiller(...) once
      - dc.query(...) for each record
    """
    client = create_client()
    run_uuid = os.getenv("AIREFINERY_UUID", "enrollment_dev_local")

    results: List[Dict[str, Any]] = []

    async with client.distiller(
        project=PROJECT_NAME,
        uuid=run_uuid,
        executor_dict=executor_dict,
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
                        "agent_analysis": {"error": errors}
                    })
                    continue

                parsed = json.loads(final_text)

                if persist and parsed.get("subscriber_id"):
                    mongo_update(
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
                        "message": str(e)
                    }
                })

    return results


# -----------------------------------
# CLI (optional)
# -----------------------------------
if __name__ == "__main__":
    import json
    import sys

    record = json.loads(sys.stdin.read())
    out = asyncio.run(process_record(record, persist=False))
    print(json.dumps(out, indent=2))
