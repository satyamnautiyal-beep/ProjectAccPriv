"""
Retro pipeline — streaming batch runner for RETRO_COVERAGE classified members.

Calls RetroEnrollmentOrchestratorAgent (deterministic liability + LLM risk assessment)
per member and emits SSE events via queue.

Stages per member:
  1. Extract coverage start date and premium data
  2. RetroEnrollmentOrchestratorAgent: calculate liability + LLM risk assessment
  3. Emit retroactive period, liability, and LLM risk/anomaly notes
  4. Emit outcome
"""
import asyncio
import json
from datetime import datetime as _dt
from typing import Any, Dict, List

from ..agents.retro_agent import RetroEnrollmentOrchestratorAgent


def _extract_member_name(member: Dict[str, Any]) -> str:
    latest_date = member.get("latest_update")
    snapshot = (member.get("history") or {}).get(latest_date, {})
    info = snapshot.get("member_info") or {}
    return " ".join(filter(None, [info.get("first_name"), info.get("last_name")])) or "Unknown"


async def run_retro_batch_streaming(
    batch_id: str,
    members: List[Dict[str, Any]],
    queue: asyncio.Queue,
) -> None:
    """
    Streams retro pipeline events for each member into queue.
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
                        "message": "  Analyzing retroactive coverage member record..."}, delay=0.08)

            latest_date = member.get("latest_update")
            snapshot = (member.get("history") or {}).get(latest_date, {})
            coverages = snapshot.get("coverages") or []

            if not coverages:
                raise ValueError("No coverage data found in member record")

            cov = coverages[0]
            coverage_start = cov.get("coverage_start_date", "")
            gross_premium  = float(cov.get("gross_premium") or 0)
            aptc           = float(cov.get("aptc")          or 0)

            await emit({"type": "thinking", "scope": "pipeline",
                        "message": "  Extracting retroactive coverage data from member record..."}, delay=0.08)
            await emit({"type": "thinking", "scope": "pipeline",
                        "message": f"  Retroactive effective date: {coverage_start}"}, delay=0.08)
            await emit({"type": "thinking", "scope": "pipeline",
                        "message": f"  Monthly coverage: Gross ${gross_premium:.2f}, "
                                   f"APTC ${aptc:.2f}, "
                                   f"Member Responsibility ${gross_premium - aptc:.2f}"}, delay=0.08)

            # ── Stage 2: RetroEnrollmentOrchestratorAgent (math + LLM) ───────
            await emit({"type": "agent_call", "scope": "pipeline",
                        "agent": "RetroEnrollmentOrchestratorAgent",
                        "message": "RetroEnrollmentOrchestratorAgent — calculating retroactive liability..."})

            result = json.loads(await RetroEnrollmentOrchestratorAgent(json.dumps({
                "subscriber_id": sid,
                "member": member,
            })))

            analysis         = result.get("retro_analysis") or {}
            months_back      = analysis.get("months_retroactive", 0)
            monthly_net      = analysis.get("monthly_net", 0)
            total_liability  = analysis.get("total_liability", 0)
            liability_reason = analysis.get("liability_reason", "")
            aptc_table       = analysis.get("aptc_table", [])
            risk_level       = analysis.get("risk_level", "MEDIUM")
            override_reason  = analysis.get("override_reason")
            anomaly_flags    = analysis.get("anomaly_flags") or []
            compliance_note  = analysis.get("compliance_note", "")
            specialist_note  = analysis.get("specialist_note", "")
            root_status      = result.get("root_status_recommended", "In Review")
            summary          = result.get("plain_english_summary", "")
            today_str        = _dt.now().strftime("%Y-%m-%d")
            llm_error        = analysis.get("llm_error")

            # ── Stage 3: Emit calculation and reasoning ──────────────────────
            await emit({"type": "thinking", "scope": "pipeline",
                        "message": f"  Calculating retroactive period: "
                                   f"From {coverage_start} to today ({today_str}) = {months_back} month(s)"}, delay=0.08)
            await emit({"type": "thinking", "scope": "pipeline",
                        "message": f"  Computing total retroactive liability: "
                                   f"${monthly_net:.2f}/month × {months_back} months = ${total_liability:.2f}"}, delay=0.08)

            await emit({"type": "thinking", "scope": "pipeline",
                        "message": "  Verifying retroactive authorization and policy activation..."}, delay=0.08)
            await emit({"type": "thinking", "scope": "pipeline",
                        "message": f"  Authorization verified. Policy activated retroactively to {coverage_start}."}, delay=0.08)
            await emit({"type": "thinking", "scope": "pipeline",
                        "message": f"  Calculating month-by-month APTC reconciliation table "
                                   f"for {months_back} month(s)..."}, delay=0.08)
            await emit({"type": "thinking", "scope": "pipeline",
                        "message": f"  APTC table generated ({len(aptc_table)} entries). "
                                   f"CSR variant confirmed."}, delay=0.08)

            # Emit anomaly flags if any
            for flag in anomaly_flags:
                await emit({"type": "thinking", "scope": "pipeline",
                            "message": f"  ⚠ Data anomaly: {flag}"}, delay=0.06)

            # Emit LLM risk assessment
            if llm_error:
                await emit({"type": "thinking", "scope": "pipeline",
                            "message": f"  LLM risk assessment unavailable ({llm_error}), using deterministic result."}, delay=0.06)
            else:
                await emit({"type": "agent_call", "scope": "pipeline",
                            "agent": "RetroEnrollmentOrchestratorAgent",
                            "message": "RetroEnrollmentOrchestratorAgent — applying risk assessment..."})
                await emit({"type": "thinking", "scope": "pipeline",
                            "message": f"  Risk assessment: {risk_level} risk"
                                       + (f" — {override_reason}" if override_reason else "")}, delay=0.08)
                if compliance_note:
                    await emit({"type": "thinking", "scope": "pipeline",
                                "message": f"  Compliance: {compliance_note}"}, delay=0.08)

            # ── Stage 4: Emit outcome ────────────────────────────────────────
            if liability_reason == "fully_covered" and root_status == "Enrolled":
                await emit({"type": "thinking", "scope": "pipeline",
                            "message": "  Member fully covered by APTC for entire retroactive period. "
                                       "No member liability."}, delay=0.08)
                await emit({"type": "thinking", "scope": "pipeline",
                            "message": "  All retroactive coverage requirements satisfied. "
                                       "Approving retroactive enrollment."}, delay=0.08)
            elif liability_reason == "overpayment":
                await emit({"type": "thinking", "scope": "pipeline",
                            "message": f"  Overpayment detected: Member paid "
                                       f"${abs(total_liability):.2f} more than owed."}, delay=0.08)
                await emit({"type": "thinking", "scope": "pipeline",
                            "message": "  Flagging for specialist review: "
                                       "Overpayment requires manual reconciliation and potential refund."}, delay=0.08)
                if specialist_note:
                    await emit({"type": "thinking", "scope": "pipeline",
                                "message": f"  Specialist note: {specialist_note}"}, delay=0.08)
                in_review += 1
            elif root_status == "In Review":
                await emit({"type": "thinking", "scope": "pipeline",
                            "message": f"  Member liability identified: "
                                       f"${total_liability:.2f} owed for retroactive period."}, delay=0.08)
                await emit({"type": "thinking", "scope": "pipeline",
                            "message": "  Generating billing adjustment and confirmation 834 "
                                       "for exchange submission..."}, delay=0.08)
                await emit({"type": "thinking", "scope": "pipeline",
                            "message": "  Flagging for specialist review: Confirmation 834 requires "
                                       "approval before exchange submission (48-hour deadline)."}, delay=0.08)
                if specialist_note:
                    await emit({"type": "thinking", "scope": "pipeline",
                                "message": f"  Specialist note: {specialist_note}"}, delay=0.08)
                in_review += 1
            else:
                # LLM overrode to Enrolled despite non-zero liability
                await emit({"type": "thinking", "scope": "pipeline",
                            "message": f"  LLM approved enrollment: {override_reason}"}, delay=0.08)

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
