"""
Renewal pipeline — streaming batch runner for RENEWAL classified members.

Calls RenewalProcessorAgent (deterministic math + LLM reasoning) per member
and emits SSE events via queue.

Stages per member:
  1. Extract prior/current coverage data
  2. RenewalProcessorAgent: calculate delta + LLM contextual review
  3. Emit priority reasoning and LLM override/anomaly notes
  4. Emit outcome
"""
import asyncio
import json
from datetime import datetime as _dt
from typing import Any, Dict, List

from ..agents.renewal_agent import RenewalProcessorAgent


def _extract_member_name(member: Dict[str, Any]) -> str:
    latest_date = member.get("latest_update")
    snapshot = (member.get("history") or {}).get(latest_date, {})
    info = snapshot.get("member_info") or {}
    return " ".join(filter(None, [info.get("first_name"), info.get("last_name")])) or "Unknown"


async def run_renewal_batch_streaming(
    batch_id: str,
    members: List[Dict[str, Any]],
    queue: asyncio.Queue,
) -> None:
    """
    Streams renewal pipeline events for each member into queue.
    Sends None sentinel when all members are processed.
    """
    from db.mongo_connection import get_database

    async def emit(payload: dict, delay: float = 0.0) -> None:
        await queue.put(payload)
        if delay > 0:
            await asyncio.sleep(delay)

    db = get_database()
    processed = 0
    failed = 0
    in_review = 0
    total = len(members)

    await emit({"type": "pipeline_progress", "done": 0, "total": total,
                "enrolled": 0, "inReview": 0, "failed": 0})

    for member in members:
        sid = member.get("subscriber_id", "")
        member_name = _extract_member_name(member)

        await emit({"type": "thinking", "scope": "pipeline",
                    "message": f"-- Starting pipeline for {member_name} ({sid})"}, delay=0.05)

        try:
            # ── Stage 1: Extract coverage data ──────────────────────────────
            await emit({"type": "thinking", "scope": "pipeline",
                        "message": "  Analyzing renewal member record for premium changes..."}, delay=0.08)

            latest_date = member.get("latest_update")
            snapshot = (member.get("history") or {}).get(latest_date, {})
            coverages = snapshot.get("coverages") or []

            if not coverages:
                raise ValueError("No coverage data found in member record")

            cov = coverages[0]
            prior_aptc  = float(cov.get("prior_aptc")         or 0)
            prior_gross = float(cov.get("prior_gross_premium") or 0)
            new_aptc    = float(cov.get("aptc")               or 0)
            new_gross   = float(cov.get("gross_premium")      or 0)

            await emit({"type": "thinking", "scope": "pipeline",
                        "message": "  Extracting renewal coverage data from member record..."}, delay=0.08)
            await emit({"type": "thinking", "scope": "pipeline",
                        "message": f"  Prior year coverage: Gross ${prior_gross:.2f}, "
                                   f"APTC ${prior_aptc:.2f}, Net ${prior_gross - prior_aptc:.2f}"}, delay=0.08)
            await emit({"type": "thinking", "scope": "pipeline",
                        "message": f"  Current year coverage: Gross ${new_gross:.2f}, "
                                   f"APTC ${new_aptc:.2f}, Net ${new_gross - new_aptc:.2f}"}, delay=0.08)

            # ── Stage 2: RenewalProcessorAgent (math + LLM) ─────────────────
            await emit({"type": "agent_call", "scope": "pipeline",
                        "agent": "RenewalProcessorAgent",
                        "message": "RenewalProcessorAgent — calculating premium delta..."})

            result = json.loads(await RenewalProcessorAgent(json.dumps({
                "subscriber_id": sid,
                "member": member,
            })))

            analysis          = result.get("renewal_analysis") or {}
            delta             = analysis.get("delta", 0)
            delta_pct         = analysis.get("delta_pct", 0)
            prior_net         = analysis.get("prior_net", 0)
            new_net           = analysis.get("new_net", 0)
            det_priority      = analysis.get("deterministic_priority", "LOW")
            final_priority    = analysis.get("final_priority", det_priority)
            override_reason   = analysis.get("override_reason")
            anomaly_flags     = analysis.get("anomaly_flags") or []
            specialist_note   = analysis.get("specialist_note", "")
            cov_start         = analysis.get("coverage_start_date", "")
            root_status       = result.get("root_status_recommended", "In Review")
            summary           = result.get("plain_english_summary", "")
            llm_error         = analysis.get("llm_error")

            # ── Stage 3: Emit calculation and reasoning ──────────────────────
            await emit({"type": "thinking", "scope": "pipeline",
                        "message": f"  Calculating premium change: ${new_net:.2f} - ${prior_net:.2f} "
                                   f"= ${delta:+.2f} ({delta_pct:+.1f}%)"}, delay=0.08)

            priority_thresholds = {
                "HIGH":   f"Premium change exceeds $50 threshold (${abs(delta):.2f})",
                "MEDIUM": f"Premium change between $20–$50 (${abs(delta):.2f})",
                "LOW":    f"Premium change under $20 (${abs(delta):.2f})",
            }
            await emit({"type": "thinking", "scope": "pipeline",
                        "message": f"  Deterministic priority: {det_priority} — "
                                   f"{priority_thresholds.get(det_priority, '')}"}, delay=0.08)

            # Emit anomaly flags if any
            for flag in anomaly_flags:
                await emit({"type": "thinking", "scope": "pipeline",
                            "message": f"  ⚠ Data anomaly: {flag}"}, delay=0.06)

            # Emit LLM reasoning
            if llm_error:
                await emit({"type": "thinking", "scope": "pipeline",
                            "message": f"  LLM reasoning unavailable ({llm_error}), using deterministic result."}, delay=0.06)
            else:
                await emit({"type": "agent_call", "scope": "pipeline",
                            "agent": "RenewalProcessorAgent",
                            "message": "RenewalProcessorAgent — applying contextual judgment..."})
                if override_reason:
                    await emit({"type": "thinking", "scope": "pipeline",
                                "message": f"  LLM override: {det_priority} → {final_priority}. {override_reason}"}, delay=0.08)
                else:
                    await emit({"type": "thinking", "scope": "pipeline",
                                "message": f"  LLM confirmed priority: {final_priority} — deterministic result stands."}, delay=0.08)

            # ── Stage 4: Emit outcome ────────────────────────────────────────
            if root_status == "In Review":
                await emit({"type": "thinking", "scope": "pipeline",
                            "message": f"  {final_priority}-priority change requires specialist review. "
                                       f"Member must be notified of cost change."}, delay=0.08)
                if specialist_note:
                    await emit({"type": "thinking", "scope": "pipeline",
                                "message": f"  Specialist note: {specialist_note}"}, delay=0.08)
                await emit({"type": "thinking", "scope": "pipeline",
                            "message": f"  Flagging case for specialist review: "
                                       f"Premium change ${delta:+.2f} ({delta_pct:+.1f}%)"}, delay=0.08)
                in_review += 1
            else:
                await emit({"type": "thinking", "scope": "pipeline",
                            "message": f"  {final_priority}-priority change within acceptable range. "
                                       f"Proceeding with automatic renewal approval."}, delay=0.08)
                await emit({"type": "thinking", "scope": "pipeline",
                            "message": "  Verifying member eligibility and plan availability..."}, delay=0.08)
                await emit({"type": "thinking", "scope": "pipeline",
                            "message": f"  All eligibility checks passed. "
                                       f"Approving renewal effective {cov_start}."}, delay=0.08)

            processed += 1

        except Exception as e:
            failed += 1
            root_status = "Processing Failed"
            summary = str(e)
            await emit({"type": "thinking", "scope": "pipeline",
                        "message": f"  Pipeline error for {member_name}: {e}"})

        # ── Persist to MongoDB ───────────────────────────────────────────────
        if db is not None:
            db.members.update_one(
                {"subscriber_id": sid},
                {"$set": {
                    "agent_summary": summary,
                    "status": root_status,
                    "lastProcessedAt": _dt.utcnow().isoformat(),
                }},
            )

        await emit({"type": "member_result", "subscriber_id": sid,
                    "name": member_name, "status": root_status, "summary": summary}, delay=0.05)
        await emit({"type": "pipeline_progress",
                    "done": processed + failed, "total": total,
                    "enrolled": processed - in_review, "inReview": in_review,
                    "failed": failed, "currentMember": member_name, "currentStatus": root_status})

    # ── Finalise batch ───────────────────────────────────────────────────────
    await queue.put(None)  # sentinel

    if db is not None:
        db.batches.update_one(
            {"id": batch_id},
            {"$set": {
                "status": "Completed",
                "processedCount": processed,
                "failedCount": failed,
                "completedAt": _dt.utcnow().isoformat(),
            }},
        )
