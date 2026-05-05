"""
Enrollment pipeline workflows — background and streaming batch runners.
"""
import asyncio
import json
from datetime import datetime as _dt, timezone as _tz
from typing import Any, Dict, List

from ..core.client import create_client, PROJECT_NAME
from ..core.distiller import process_records_batch
from ..data.sanitizer import build_engine_input
from ..data.views import (
    classification_view,
    sep_inference_view,
    normal_flow_view,
    decision_view,
)
from ..agents import get_executor_dict
from ..agents.classifier import EnrollmentClassifierAgent
from ..agents.sep_inference import SepInferenceAgent
from ..agents.normal_enrollment import NormalEnrollmentAgent
from ..agents.decision import DecisionAgent
from ..agents.evidence_check import EvidenceCheckAgent


def _extract_member_name(member_doc: dict) -> str:
    """Extracts a display name from a member document using the latest snapshot."""
    latest_date = member_doc.get("latest_update")
    snapshot = (member_doc.get("history") or {}).get(latest_date, {})
    info = snapshot.get("member_info") or {}
    return " ".join(filter(None, [info.get("first_name"), info.get("last_name")])) or "Unknown"


async def run_batch_in_background(batch_id: str, members: List[Dict[str, Any]]) -> None:
    """
    Runs the AI enrollment pipeline for a batch and writes results to BigQuery.
    Stores job status in the shared _batch_jobs registry (imported from batch_jobs).
    """
    from datetime import timezone as _tz
    from ..chat.batch_jobs import _batch_jobs
    from db.bq_connection import get_database

    _batch_jobs[batch_id] = {"status": "running", "startedAt": _dt.now(_tz.utc).isoformat()}
    db = get_database()

    try:
        results = await process_records_batch(members, persist=False)
        processed = 0
        failed = 0

        for r in results:
            sid = r.get("subscriber_id")
            if not sid:
                analysis = r.get("agent_analysis", {})
                if isinstance(analysis, dict):
                    sid = analysis.get("subscriber_id")
            if not sid:
                failed += 1
                continue

            try:
                root_status = r.get("root_status_recommended", "In Review")
                markers = r.get("markers", {})

                valid_statuses = {"Enrolled", "Enrolled (SEP)", "In Review", "Ready", "Awaiting Clarification"}
                if root_status not in valid_statuses:
                    root_status = "In Review"

                if db is not None:
                    db.members.update_one(
                        {"subscriber_id": sid},
                        {"$set": {
                            "agent_analysis": r.get("agent_analysis", r),
                            "markers": markers,
                            "agent_summary": r.get("plain_english_summary"),
                            "status": root_status,
                            "lastProcessedAt": _dt.now(_tz.utc),
                        }},
                    )
                processed += 1
            except Exception as member_err:
                failed += 1
                if db is not None:
                    try:
                        db.members.update_one(
                            {"subscriber_id": sid},
                            {"$set": {
                                "status": "Processing Failed",
                                "processing_error": str(member_err),
                                "lastProcessedAt": _dt.now(_tz.utc),
                            }},
                        )
                    except Exception:
                        pass

        # Mark any members still "In Batch" as Processing Failed
        if db is not None:
            stuck = list(db.members.find(
                {"status": "In Batch", "batch_id": batch_id},
                {"_id": 0, "subscriber_id": 1},
            ))
            for m in stuck:
                db.members.update_one(
                    {"subscriber_id": m["subscriber_id"]},
                    {"$set": {
                        "status": "Processing Failed",
                        "processing_error": "Pipeline did not return a result for this member",
                        "lastProcessedAt": _dt.now(_tz.utc),
                    }},
                )
                failed += 1

        if db is not None:
            db.batches.update_one(
                {"id": batch_id},
                {"$set": {
                    "status": "Completed",
                    "processedCount": processed,
                    "failedCount": failed,
                    "completedAt": _dt.now(_tz.utc),
                }},
            )

        _batch_jobs[batch_id] = {
            "status": "completed",
            "batchId": batch_id,
            "processed": processed,
            "failed": failed,
            "completedAt": _dt.now(_tz.utc),
        }

    except Exception as e:
        _batch_jobs[batch_id] = {
            "status": "failed",
            "batchId": batch_id,
            "error": str(e),
            "failedAt": _dt.now(_tz.utc),
        }
        if db is not None:
            db.batches.update_one(
                {"id": batch_id},
                {"$set": {"status": "Processing Failed", "error": str(e)}},
            )


async def run_batch_streaming(
    batch_id: str,
    members: List[Dict[str, Any]],
    queue: asyncio.Queue,
) -> None:
    """
    Streaming variant — emits per-member SSE events via the queue.
    Sends a None sentinel when done.
    """
    from datetime import timezone as _tz
    from db.bq_connection import get_database

    async def emit(payload: dict, delay: float = 0.0) -> None:
        await queue.put(payload)
        await asyncio.sleep(delay if delay > 0 else 0)

    db = get_database()
    processed = 0
    failed = 0
    in_review = 0

    try:
        client = create_client()
    except Exception as e:
        await emit({"type": "thinking", "message": f"Could not connect to AI Refinery: {e}"})
        await queue.put(None)
        return

    async with client.distiller(
        project=PROJECT_NAME,
        uuid="enrollment_batch_stream",
        executor_dict=get_executor_dict(),
    ) as dc:
        total_members = len(members)
        await emit({"type": "pipeline_progress", "done": 0, "total": total_members, "enrolled": 0, "inReview": 0, "failed": 0})

        for member in members:
            sid = member.get("subscriber_id", "")
            member_name = _extract_member_name(member)

            await emit({"type": "thinking", "scope": "pipeline", "message": f"-- Starting pipeline for {member_name} ({sid})"}, delay=0.05)

            try:
                full_record = build_engine_input(member)

                # Stage 1: Classification
                await emit({"type": "thinking", "scope": "pipeline", "message": "  Reading enrollment history and checking for life-event signals..."}, delay=0.08)
                classification_record = classification_view(full_record)
                await emit({"type": "agent_call", "scope": "pipeline", "agent": "Enrollment Classifier", "message": "Classifier Agent — detecting SEP signals and enrollment type"}, delay=0.0)
                classification = json.loads(await EnrollmentClassifierAgent(json.dumps(classification_record)))
                sep_candidate = classification.get("sep_candidate", False)
                within_oep = classification.get("is_within_oep")

                if sep_candidate:
                    await emit({"type": "thinking", "scope": "pipeline", "message": "  Detected changes in the member record that may indicate a qualifying life event."}, delay=0.1)
                else:
                    oep_note = "Member is enrolling during the open enrollment window." if within_oep else "Enrollment is outside the standard OEP window."
                    await emit({"type": "thinking", "scope": "pipeline", "message": f"  No life-event signals found. {oep_note} Routing to standard OEP path."}, delay=0.1)

                # Stage 2: Branch analysis
                if sep_candidate:
                    await emit({"type": "thinking", "scope": "pipeline", "message": "  Analysing what changed between snapshots to identify the SEP trigger..."}, delay=0.08)
                    sep_record = sep_inference_view(full_record)
                    await emit({"type": "agent_call", "scope": "pipeline", "agent": "SEP Inference Agent", "message": "SEP Inference Agent — identifying qualifying life event"}, delay=0.0)
                    branch_analysis = json.loads(await SepInferenceAgent(json.dumps({"record": sep_record, "classification": classification})))
                    sep_confirmed = branch_analysis.get("sep_confirmed", False)
                    causality = branch_analysis.get("sep_causality") or {}
                    sep_type_label = causality.get("sep_candidate", "unknown")
                    confidence = causality.get("confidence", 0)
                    conf_pct = int(confidence * 100) if isinstance(confidence, float) else confidence
                    signals = causality.get("supporting_signals") or []
                    signal_note = f" Supporting signals: {', '.join(signals[:2])}." if signals else ""
                    if sep_confirmed:
                        await emit({"type": "thinking", "scope": "pipeline", "message": f"  SEP confirmed: {sep_type_label} ({conf_pct}% confidence).{signal_note}"}, delay=0.1)
                    else:
                        await emit({"type": "thinking", "scope": "pipeline", "message": "  SEP signals present but not strong enough to confirm. Treating as standard enrollment."}, delay=0.1)
                else:
                    await emit({"type": "thinking", "scope": "pipeline", "message": "  Building enrollment timeline from member history snapshots..."}, delay=0.08)
                    normal_record = normal_flow_view(full_record)
                    await emit({"type": "agent_call", "scope": "pipeline", "agent": "Normal Enrollment Agent", "message": "Normal Enrollment Agent — building OEP timeline"}, delay=0.0)
                    branch_analysis = json.loads(await NormalEnrollmentAgent(json.dumps({"record": normal_record, "classification": classification})))
                    sep_confirmed = False
                    snapshots = (branch_analysis.get("timeline") or {}).get("observations", {}).get("snapshot_count", 1)
                    eff_dates = (branch_analysis.get("timeline") or {}).get("observations", {}).get("distinct_effective_dates") or []
                    date_note = f" Coverage effective {eff_dates[0]}." if eff_dates else ""
                    await emit({"type": "thinking", "scope": "pipeline", "message": f"  Timeline built from {snapshots} snapshot(s).{date_note} Clean OEP enrollment path."}, delay=0.1)

                # Stage 3: Authority
                source = full_record.get("source_system", "Employer")
                payer_discretion = source not in {"Exchange", "CMS", "FFE", "SBE"}
                authority = {"authority_analysis": {"source": source, "payer_discretion": payer_discretion}}
                if payer_discretion:
                    await emit({"type": "thinking", "scope": "pipeline", "message": f"  Enrollment source is {source}. Employer-sponsored plan — payer has discretion over eligibility."}, delay=0.08)
                else:
                    await emit({"type": "thinking", "scope": "pipeline", "message": f"  Enrollment source is {source} (Exchange/CMS). Regulatory rules apply — no payer discretion."}, delay=0.08)

                # Stage 4: Decision
                await emit({"type": "thinking", "scope": "pipeline", "message": "  Evaluating eligibility: checking validation issues, blocking conditions, and final status..."}, delay=0.08)
                decision_record = decision_view(full_record)
                await emit({"type": "agent_call", "scope": "pipeline", "agent": "Decision Agent", "message": "Decision Agent — evaluating eligibility and final status"}, delay=0.0)
                decision = json.loads(await DecisionAgent(json.dumps({"record": decision_record, "classification": classification, "analysis": branch_analysis})))
                hard_blocks = (decision.get("agent_analysis_patch") or {}).get("hard_blocks", [])
                requires_evidence = (decision.get("agent_analysis_patch") or {}).get("requires_evidence_check", False)
                interim_status = decision.get("root_status_recommended", "In Review")

                if hard_blocks:
                    block_desc = "; ".join(hard_blocks)
                    await emit({"type": "thinking", "scope": "pipeline", "message": f"  Hard block detected: {block_desc}. Member cannot be auto-enrolled — flagging for manual review."}, delay=0.1)
                elif sep_confirmed and requires_evidence:
                    await emit({"type": "thinking", "scope": "pipeline", "message": "  SEP confirmed. Need to verify that the required supporting documents have been submitted."}, delay=0.1)
                else:
                    await emit({"type": "thinking", "scope": "pipeline", "message": "  No blocking conditions found. Member meets all eligibility criteria."}, delay=0.1)

                # Stage 5: Evidence check (SEP only)
                evidence_check = None
                root_status = interim_status

                if sep_confirmed and requires_evidence:
                    sep_type = (branch_analysis.get("sep_causality") or {}).get("sep_candidate")
                    await emit({"type": "thinking", "scope": "pipeline", "message": f"  Checking submitted documents against requirements for: {sep_type}..."}, delay=0.08)
                    await emit({"type": "agent_call", "scope": "pipeline", "agent": "Evidence Check Agent", "message": "Evidence Check Agent — verifying submitted documents"}, delay=0.0)
                    evidence_check = json.loads(await EvidenceCheckAgent(json.dumps({"subscriber_id": sid, "sep_type": sep_type})))
                    evidence_complete = evidence_check.get("evidence_complete", False)
                    missing = evidence_check.get("missing_docs", [])
                    submitted = evidence_check.get("submitted_docs", [])
                    if hard_blocks:
                        root_status = "In Review"
                        await emit({"type": "thinking", "scope": "pipeline", "message": "  Evidence check complete but hard blocks remain. Placing in review."}, delay=0.1)
                    elif evidence_complete:
                        root_status = "Enrolled (SEP)"
                        await emit({"type": "thinking", "scope": "pipeline", "message": f"  All required documents verified ({', '.join(submitted[:2])}). SEP enrollment approved."}, delay=0.1)
                    else:
                        root_status = "In Review"
                        missing_str = ", ".join(missing[:2])
                        await emit({"type": "thinking", "scope": "pipeline", "message": f"  Missing documents: {missing_str}. Cannot complete SEP enrollment — placing in review."}, delay=0.1)
                else:
                    if root_status == "Ready" and not sep_confirmed:
                        root_status = "Enrolled"
                    await emit({"type": "thinking", "scope": "pipeline", "message": "  All checks passed. Enrolling member via standard OEP path."}, delay=0.08)

                # Validate final status
                valid_statuses = {"Enrolled", "Enrolled (SEP)", "In Review", "Processing Failed"}
                if root_status not in valid_statuses:
                    root_status = "In Review"

                summary = decision.get("plain_english_summary")

                # Persist to BigQuery
                if db is not None:
                    agent_analysis = {
                        "classification": classification,
                        "branch_analysis": branch_analysis,
                        "authority": authority,
                        "decision": decision,
                        "evidence_check": evidence_check,
                    }
                    markers = {
                        "is_sep_candidate": sep_candidate,
                        "is_sep_confirmed": sep_confirmed,
                        "sep_type": (branch_analysis.get("sep_causality") or {}).get("sep_candidate") if sep_confirmed else None,
                        "enrollment_path": "SEP" if sep_confirmed else "OEP",
                        "is_within_oep": classification.get("is_within_oep"),
                        "evidence_status": (
                            "complete" if (evidence_check and evidence_check.get("evidence_complete"))
                            else "missing" if evidence_check
                            else "not_applicable"
                        ),
                    }
                    db.members.update_one(
                        {"subscriber_id": sid},
                        {"$set": {
                            "agent_summary": summary,
                            "status": root_status,
                            "agent_analysis": agent_analysis,
                            "markers": markers,
                            "lastProcessedAt": _dt.now(_tz.utc),
                        }},
                    )

                processed += 1
                if root_status == "In Review":
                    in_review += 1

                await emit({"type": "member_result", "subscriber_id": sid, "name": member_name, "status": root_status, "summary": summary}, delay=0.05)
                await emit({
                    "type": "pipeline_progress",
                    "done": processed + failed,
                    "total": total_members,
                    "enrolled": processed - in_review,
                    "inReview": in_review,
                    "failed": failed,
                    "currentMember": member_name,
                    "currentStatus": root_status,
                })

            except Exception as e:
                failed += 1
                await emit({"type": "thinking", "scope": "pipeline", "message": f"  Pipeline error for {member_name}: {e}"})
                await emit({"type": "member_result", "subscriber_id": sid, "name": member_name, "status": "Processing Failed", "summary": str(e)}, delay=0.05)
                await emit({
                    "type": "pipeline_progress",
                    "done": processed + failed,
                    "total": total_members,
                    "enrolled": processed - in_review,
                    "inReview": in_review,
                    "failed": failed,
                    "currentMember": member_name,
                    "currentStatus": "Processing Failed",
                })

    await queue.put(None)  # sentinel

    if db is not None:
        db.batches.update_one(
            {"id": batch_id},
            {"$set": {
                "status": "Completed",
                "processedCount": processed,
                "failedCount": failed,
                "completedAt": _dt.now(_tz.utc),
            }},
        )

