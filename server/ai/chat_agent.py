"""
LLM-powered chat agent for the Enrollment Assistant.
Uses AI Refinery chat.completions with function-calling so the LLM can
actually execute real backend actions instead of just talking about them.

All tool execution is async — no asyncio.run() calls, which would deadlock
inside FastAPI's already-running uvicorn event loop.
"""
import asyncio
import json
import os
from datetime import datetime as _dt
from typing import AsyncGenerator, List, Dict, Any

from dotenv import load_dotenv
from air import AsyncAIRefinery

load_dotenv()

# ---------------------------------------------------------------------------
# BACKGROUND BATCH JOB REGISTRY
# ---------------------------------------------------------------------------
_batch_jobs: Dict[str, Dict[str, Any]] = {}


async def _run_batch_in_background(batch_id: str, members: list) -> None:
    """Runs the AI enrollment pipeline and writes result to _batch_jobs."""
    from server.ai.agent import process_records_batch
    from db.mongo_connection import get_database

    _batch_jobs[batch_id] = {"status": "running", "startedAt": _dt.utcnow().isoformat()}
    db = get_database()

    try:
        results = await process_records_batch(members, persist=False)
        processed = 0
        failed = 0

        # Build a lookup of original member data by subscriber_id for fallback
        members_by_id = {m.get("subscriber_id"): m for m in members if m.get("subscriber_id")}

        for r in results:
            # Try to get subscriber_id from result, fall back to matching by position
            sid = r.get("subscriber_id")

            # If pipeline returned no subscriber_id, try to recover it from the error context
            if not sid:
                # Check if there's an error with subscriber context
                analysis = r.get("agent_analysis", {})
                if isinstance(analysis, dict):
                    sid = analysis.get("subscriber_id")

            if not sid:
                failed += 1
                continue

            try:
                root_status = r.get("root_status_recommended", "In Review")
                markers = r.get("markers", {})

                # Validate root_status is a known terminal status
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
                            "lastProcessedAt": _dt.utcnow().isoformat(),
                        }}
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
                                "lastProcessedAt": _dt.utcnow().isoformat(),
                            }}
                        )
                    except Exception:
                        pass

        # Mark any members that still have "In Batch" status as "Processing Failed"
        # (pipeline failed to return a result for them)
        if db is not None:
            stuck = list(db.members.find(
                {"status": "In Batch", "batch_id": batch_id},
                {"_id": 0, "subscriber_id": 1}
            ))
            for m in stuck:
                db.members.update_one(
                    {"subscriber_id": m["subscriber_id"]},
                    {"$set": {
                        "status": "Processing Failed",
                        "processing_error": "Pipeline did not return a result for this member",
                        "lastProcessedAt": _dt.utcnow().isoformat(),
                    }}
                )
                failed += 1

        if db is not None:
            db.batches.update_one(
                {"id": batch_id},
                {"$set": {
                    "status": "Completed",
                    "processedCount": processed,
                    "failedCount": failed,
                    "completedAt": _dt.utcnow().isoformat(),
                }}
            )

        _batch_jobs[batch_id] = {
            "status": "completed",
            "batchId": batch_id,
            "processed": processed,
            "failed": failed,
            "completedAt": _dt.utcnow().isoformat(),
        }

    except Exception as e:
        _batch_jobs[batch_id] = {
            "status": "failed",
            "batchId": batch_id,
            "error": str(e),
            "failedAt": _dt.utcnow().isoformat(),
        }
        if db is not None:
            db.batches.update_one(
                {"id": batch_id},
                {"$set": {"status": "Processing Failed", "error": str(e)}}
            )


async def _run_batch_streaming(
    batch_id: str,
    members: list,
    queue: asyncio.Queue,
) -> None:
    """
    Streaming variant of the batch runner.
    Calls each enrollment pipeline stage individually and emits a thinking event
    for every stage so the frontend shows the full agentic reasoning flow.
    Puts None sentinel when all members are done.
    Does NOT modify _run_batch_in_background — that function is used by reprocess_in_review.
    """
    from server.ai.agent import (
        build_engine_input,
        _classification_view, _sep_inference_view, _normal_flow_view, _decision_view,
        EnrollmentClassifierAgent, SepInferenceAgent, NormalEnrollmentAgent,
        DecisionAgent, EvidenceCheckAgent,
        _utc_now_z, create_client, PROJECT_NAME, executor_dict,
    )
    from db.mongo_connection import get_database
    import json as _json

    db = get_database()
    processed = 0
    failed = 0

    # Open one Distiller session for the whole batch
    try:
        client = create_client()
    except Exception as e:
        await queue.put({"type": "thinking", "message": f"⚠ Could not connect to AI Refinery: {e}"})
        await queue.put(None)
        return

    async with client.distiller(
        project=PROJECT_NAME,
        uuid="enrollment_batch_stream",
        executor_dict=executor_dict,
    ) as dc:
        for member in members:
            sid = member.get("subscriber_id", "")
            member_name = _extract_member_name(member)

            await queue.put({"type": "thinking", "message": f"-- Starting pipeline for {member_name} ({sid})"})

            try:
                full_record = build_engine_input(member)

                # ── Stage 1: Classification ──────────────────────────────────
                classification_record = _classification_view(full_record)
                classification = _json.loads(await EnrollmentClassifierAgent(_json.dumps(classification_record)))
                sep_candidate = classification.get("sep_candidate", False)
                enroll_type = classification.get("enrollment_type", "Unknown")
                within_oep = classification.get("is_within_oep")
                oep_label = "within OEP" if within_oep else ("outside OEP" if within_oep is False else "OEP unknown")
                await queue.put({"type": "thinking", "message": f"  Classifier: {enroll_type}, SEP candidate: {sep_candidate}, {oep_label}"})

                # ── Stage 2: Branch analysis ─────────────────────────────────
                if sep_candidate:
                    sep_record = _sep_inference_view(full_record)
                    branch_analysis = _json.loads(await SepInferenceAgent(_json.dumps({"record": sep_record, "classification": classification})))
                    sep_confirmed = branch_analysis.get("sep_confirmed", False)
                    causality = branch_analysis.get("sep_causality") or {}
                    sep_type_label = causality.get("sep_candidate", "unknown")
                    confidence = causality.get("confidence", 0)
                    conf_pct = int(confidence * 100) if isinstance(confidence, float) else confidence
                    await queue.put({"type": "thinking", "message": f"  SEP Inference: {'confirmed' if sep_confirmed else 'not confirmed'} — {sep_type_label} ({conf_pct}% confidence)"})
                else:
                    normal_record = _normal_flow_view(full_record)
                    branch_analysis = _json.loads(await NormalEnrollmentAgent(_json.dumps({"record": normal_record, "classification": classification})))
                    sep_confirmed = False
                    snapshots = (branch_analysis.get("timeline") or {}).get("observations", {}).get("snapshot_count", 1)
                    await queue.put({"type": "thinking", "message": f"  Normal flow: OEP path, {snapshots} snapshot(s) analysed"})

                # ── Stage 3: Authority ───────────────────────────────────────
                source = full_record.get("source_system", "Employer")
                payer_discretion = source not in {"Exchange", "CMS", "FFE", "SBE"}
                authority = {"authority_analysis": {"source": source, "payer_discretion": payer_discretion}}
                await queue.put({"type": "thinking", "message": f"  Authority: source={source}, payer discretion={payer_discretion}"})

                # ── Stage 4: Decision ────────────────────────────────────────
                decision_record = _decision_view(full_record)
                decision = _json.loads(await DecisionAgent(_json.dumps({"record": decision_record, "classification": classification, "analysis": branch_analysis})))
                hard_blocks = (decision.get("agent_analysis_patch") or {}).get("hard_blocks", [])
                requires_evidence = (decision.get("agent_analysis_patch") or {}).get("requires_evidence_check", False)
                interim_status = decision.get("root_status_recommended", "In Review")
                blocks_label = f" — blocks: {', '.join(hard_blocks)}" if hard_blocks else " — no hard blocks"
                await queue.put({"type": "thinking", "message": f"  Decision: interim={interim_status}{blocks_label}"})

                # ── Stage 5: Evidence check (SEP only) ──────────────────────
                evidence_check = None
                root_status = interim_status

                if sep_confirmed and requires_evidence:
                    sep_type = (branch_analysis.get("sep_causality") or {}).get("sep_candidate")
                    evidence_check = _json.loads(await EvidenceCheckAgent(_json.dumps({"subscriber_id": sid, "sep_type": sep_type})))
                    evidence_complete = evidence_check.get("evidence_complete", False)
                    missing = evidence_check.get("missing_docs", [])
                    if hard_blocks:
                        root_status = "In Review"
                    elif evidence_complete:
                        root_status = "Enrolled (SEP)"
                    else:
                        root_status = "In Review"
                    await queue.put({"type": "thinking", "message": f"  Evidence: {'complete' if evidence_complete else f'incomplete — {len(missing)} doc(s) missing'} → {root_status}"})
                else:
                    if root_status == "Ready" and not sep_confirmed:
                        root_status = "Enrolled"
                    await queue.put({"type": "thinking", "message": f"  Evidence: skipped (OEP path) → {root_status}"})

                # Validate final status
                valid_statuses = {"Enrolled", "Enrolled (SEP)", "In Review", "Processing Failed"}
                if root_status not in valid_statuses:
                    root_status = "In Review"

                summary = decision.get("plain_english_summary")

                # Persist to MongoDB
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
                            "lastProcessedAt": _dt.utcnow().isoformat(),
                        }}
                    )

                processed += 1
                await queue.put({
                    "type": "member_result",
                    "subscriber_id": sid,
                    "name": member_name,
                    "status": root_status,
                    "summary": summary,
                })

            except Exception as e:
                failed += 1
                await queue.put({"type": "thinking", "message": f"  ⚠ Pipeline error for {member_name}: {e}"})
                await queue.put({
                    "type": "member_result",
                    "subscriber_id": sid,
                    "name": member_name,
                    "status": "Processing Failed",
                    "summary": str(e),
                })

    await queue.put(None)  # sentinel

    if db is not None:
        db.batches.update_one(
            {"id": batch_id},
            {"$set": {
                "status": "Completed",
                "processedCount": processed,
                "failedCount": failed,
                "completedAt": _dt.utcnow().isoformat(),
            }}
        )


# ---------------------------------------------------------------------------
# SYSTEM PROMPT
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """You are HealthEnroll AI, a friendly and knowledgeable assistant for a health insurance enrollment platform that processes EDI 834 files.

You behave like a helpful, conversational AI (similar to ChatGPT) — you respond naturally to greetings, small talk, and general questions, AND you can take real actions on the enrollment system using your tools.

CONVERSATIONAL BEHAVIOR:
- Greet users warmly. If someone says "hi" or "hello", respond like: "Hello! How can I help you today? I can assist with enrollment files, member status, batches, and more."
- Answer general questions about the platform, workflows, or concepts directly without calling tools.
- Only call tools when the user is asking for live data or wants to trigger an action.
- Keep responses friendly, clear, and concise. Use plain language first, then structured data when needed.

TOOLS — you have tools that ACTUALLY execute real actions. Never invent numbers.

Workflow order:
1. check_edi_structure  — validates & ingests EDI files on disk → members become "Pending Business Validation"
2. run_business_validation — validates member data (SSN, DOB, address) → members become "Ready" or "Awaiting Clarification"
3. create_batch — bundles all Ready members into a batch
4. process_batch — fires the AI enrollment pipeline as a background job, returns immediately
5. get_batch_result — checks if a background batch job has finished
6. get_system_status — check current counts at any time

Tool rules:
- Call check_edi_structure when the user asks about new/unchecked EDI files.
- Only call run_business_validation if pending_business_validation_count > 0.
- Only call create_batch when the user asks to create a batch.
- Only call process_batch if a batch is "Awaiting Approval".
- When the user asks to check batch status, call get_batch_result with the batch_id.
- Only call get_system_status when the user explicitly asks for status, overview, or current state.
- When calling get_system_status, pass the specific query: 'edi_files', 'pending_validation', 'ready', 'clarifications', 'enrolled', 'in_review', 'failed', 'batches', or 'all'.
- Call get_clarifications when the user asks about members needing attention, clarification issues, member names with problems, what issues exist, or anything about "Awaiting Clarification" members. This returns real names and exact issues from MongoDB — never use get_system_status for this.
- Call get_enrolled_members when the user asks who was enrolled, how many people enrolled today/this week, or wants a list of enrolled members. Pass today's date (YYYY-MM-DD) when they say "today".
- Call get_subscriber_details when the user asks about a specific subscriber ID, their SEP reason, why they were enrolled under SEP, what evidence they submitted, or any details about a named member. The result includes a full 'sep' object with sep_type, supporting_signals, evidence submitted, and confidence — always use this data to answer SEP questions, never say the reason is not stored.
- Call reprocess_in_review when the user wants to retry, reprocess, or re-run the pipeline on In Review members — either all of them or a specific subscriber. This handles both SEP members who have now submitted evidence and members whose data issues have been fixed.
- Call analyze_member when the user asks about a specific member by name or subscriber ID, asks why someone is in review, asks about SEP details for a member, or asks about a member's enrollment outcome. analyze_member returns agent_summary which is a plain-English explanation — use it directly in your response without rephrasing.
- For batch processing requests, use process_batch. Per-member results stream to the right panel automatically. In your final response, give ONLY a 1-line summary like "Batch complete — X enrolled, Y failed." Do NOT list individual members in your response text.
- Prefer analyze_member over get_subscriber_details when the user wants an explanation of why a member is in their current status, not just raw field data.
- For conversational messages (greetings, questions, explanations) — respond directly, do NOT call any tool.

Member statuses: Pending Business Validation → Ready / Awaiting Clarification → In Batch → Enrolled / Enrolled (SEP) / In Review / Processing Failed

Status meanings:
- "Enrolled" = OEP member, pipeline completed successfully
- "Enrolled (SEP)" = SEP member, evidence complete, pipeline completed
- "In Review" = SEP with missing evidence, or has validation/hard blocks — needs manual review
- "Processing Failed" = pipeline threw an error — needs investigation
- "In Batch" = bundled, awaiting pipeline run
- "Awaiting Clarification" = failed business validation (missing SSN, DOB, address etc.)

RESPONSE FORMAT — strict rules:
- Keep responses SHORT. 2-4 sentences max for data responses. No walls of text.
- NEVER include "Next steps", "Key take-aways", "What this means", or any unsolicited advice sections.
- NEVER repeat information the user didn't ask for.
- For data responses: one short sentence summary + a table if there are counts. That's it.
- For member detail (analyze_member): show the agent_summary as-is, then the SEP context if present. No extra commentary.
- For conversational responses: reply naturally in 1-2 sentences.
- Do NOT add markdown headers like **Member Detail** or **AI-generated summary** — just present the data cleanly.

SUGGESTIONS — mandatory format rules:
- Always end action/data responses with a SUGGESTIONS line.
- Suggestion text MUST be 2-5 words only. Short button labels, not sentences.
- Good examples: "Create batch", "Process batch", "Check status", "View clarifications", "Retry failed"
- Bad examples: "Create a batch with the 5 Ready members" — TOO LONG, never do this.
- Maximum 3 suggestions per response.
- NEVER write "Next steps:" as prose. ONLY use the SUGGESTIONS line below.

You MUST end every data/action response with exactly this format on the last line:
SUGGESTIONS: [{"text": "Short label", "action": "status"}, {"text": "Short label 2", "action": "batch"}]

Example of a correct complete response:
5 members enrolled today, 2 in review.
SUGGESTIONS: [{"text": "View in review", "action": "status"}, {"text": "Reprocess in review", "action": "process"}]
"""

# ---------------------------------------------------------------------------
# TOOL DEFINITIONS
# ---------------------------------------------------------------------------
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "check_edi_structure",
            "description": (
                "Validates all EDI 834 files currently on disk for structural integrity. "
                "Internally checks disk first — if no unchecked files exist it returns immediately "
                "with a clear message instead of running. Safe to call any time the user asks "
                "about new or unchecked EDI files. Healthy files are parsed and members ingested "
                "as 'Pending Business Validation'."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_business_validation",
            "description": (
                "Runs business-rule validation on members in 'Pending Business Validation' status only. "
                "Returns: validated = count that became Ready, clarifications = count that failed. "
                "Do NOT call if pending_business_validation_count is 0."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_batch",
            "description": (
                "Bundles all 'Ready' members into a new enrollment batch. "
                "Self-checks the ready count — if 0, returns a focused message saying nothing to batch "
                "and whether any failed members can be retried. "
                "Do NOT call get_system_status before or after this — the result is self-contained."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "process_batch",
            "description": (
                "Starts the AI enrollment pipeline on the batch that is 'Awaiting Approval' "
                "as a background job. Returns immediately with status 'started'. "
                "The pipeline runs in the background — use get_batch_result to check completion."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "batch_id": {
                        "type": "string",
                        "description": "Batch ID to process. Leave empty to auto-select the first pending batch.",
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_batch_result",
            "description": (
                "Checks the result of a background batch processing job started by process_batch. "
                "Returns status: 'running' (still in progress), 'completed' (with processed/failed counts), "
                "or 'failed' (with error). Always call this when the user asks about batch status or result."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "batch_id": {
                        "type": "string",
                        "description": "The batch ID to check. Use the last batch ID that was processed.",
                    }
                },
                "required": ["batch_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_system_status",
            "description": (
                "Returns current system metrics. Pass a 'query' describing what the user asked about "
                "so only the relevant data is returned. Examples: 'new edi files', "
                "'pending business validation', 'enrolled members', 'failed members', 'batch status'. "
                "Pass 'all' only when the user explicitly asks for full system status or overview."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": (
                            "What the user is asking about. One of: 'edi_files', 'pending_validation', "
                            "'ready', 'clarifications', 'enrolled', 'in_review', 'failed', "
                            "'batches', 'all'. Defaults to 'all'."
                        ),
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_clarifications",
            "description": (
                "Returns the full list of members in 'Awaiting Clarification' status from MongoDB, "
                "including their subscriber ID, full name, and the exact validation issues "
                "(e.g. 'Missing SSN', 'Invalid DOB', 'Incomplete Address'). "
                "Always call this when the user asks: who needs attention, what are the issues, "
                "show me members needing clarification, what are the names of members with problems, etc."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_enrolled_members",
            "description": (
                "Queries MongoDB for enrolled members. Can filter by date and enrollment path. "
                "Use this when the user asks who was enrolled, how many enrolled today/yesterday, "
                "SEP vs OEP breakdowns, or any question about enrolled member details."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": "Filter by lastProcessedAt date. Format YYYY-MM-DD. Leave empty for all time.",
                    },
                    "enrollment_path": {
                        "type": "string",
                        "description": "Filter by 'OEP', 'SEP', or leave empty for both.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "retry_failed_members",
            "description": (
                "Re-queues all members with status 'Processing Failed' back to 'Ready' "
                "so they can be included in the next batch. Call this when the user wants "
                "to retry failed members. Returns count of members re-queued."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "reprocess_in_review",
            "description": (
                "Re-runs the AI enrollment pipeline on members currently in 'In Review' status. "
                "Use this when the user wants to retry In Review members after evidence has been submitted "
                "or data issues have been resolved. Can target a specific subscriber_id or all In Review members. "
                "Runs as a background job — returns immediately."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "subscriber_id": {
                        "type": "string",
                        "description": "Specific subscriber ID to reprocess. Leave empty to reprocess all In Review members.",
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_enrolled_members",
            "description": (
                "Returns a list of enrolled members (status 'Enrolled' or 'Enrolled (SEP)'). "
                "Use when the user asks who was enrolled today, this week, or in general. "
                "Optionally filter by date (YYYY-MM-DD) to see enrollments processed on that day. "
                "Returns name, subscriber_id, status, enrollment path, and last processed date."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": (
                            "Filter by lastProcessedAt date (YYYY-MM-DD). "
                            "Pass today's date to see today's enrollments. Leave empty for all enrolled members."
                        ),
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_subscriber_details",
            "description": (
                "Looks up a specific subscriber by their subscriber ID and returns full details: "
                "current status, coverage, dependents, validation issues, AND full SEP context — "
                "sep_type (e.g. 'Household change'), sep_confidence, supporting_signals that triggered SEP, "
                "evidence submitted, evidence status, and whether they were within OEP. "
                "Use when the user asks about a specific member, their SEP reason, why they were enrolled under SEP, "
                "what evidence they submitted, or any details about a named member or subscriber ID."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "subscriber_id": {
                        "type": "string",
                        "description": "The subscriber ID to look up (e.g. EMP00030).",
                    }
                },
                "required": ["subscriber_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_member",
            "description": (
                "Looks up a specific member by subscriber ID and returns their current status, "
                "AI-generated plain-English enrollment summary (agent_summary), validation issues with severity, "
                "and full SEP context. If the member has not been through the AI pipeline yet, runs it on demand. "
                "Use this — NOT get_subscriber_details — when the user asks: why is a member in review, "
                "what happened with a specific member's enrollment, what is their SEP reason, "
                "or any question about a member's enrollment outcome or status explanation."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "subscriber_id": {
                        "type": "string",
                        "description": "The subscriber ID to analyze (e.g. EMP00030).",
                    }
                },
                "required": ["subscriber_id"],
            },
        },
    },
]


# ---------------------------------------------------------------------------
# MEMBER HELPER FUNCTIONS
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# ASYNC TOOL EXECUTOR
# ---------------------------------------------------------------------------
async def _execute_tool(name: str, args: Dict[str, Any]) -> str:
    """Executes the real backend function. Fully async — no asyncio.run()."""
    try:
        if name == "check_edi_structure":
            from server.routers.files import check_structure, get_todays_dir, get_statuses

            # Always check what's actually on disk first before running
            target_dir = get_todays_dir()
            statuses = get_statuses()
            unchecked = [
                fname for fname in (os.listdir(target_dir) if os.path.exists(target_dir) else [])
                if fname.endswith(".edi")
                and statuses.get(fname, {}).get("status", "Unchecked") in ("Unchecked", "Healthy")
            ]

            if not unchecked:
                return json.dumps({
                    "healthy": 0,
                    "issues": 0,
                    "results": [],
                    "message": "No unchecked EDI files on disk right now. Upload files first.",
                })

            result = check_structure()
            result["files_found_on_disk"] = unchecked
            return json.dumps(result)

        elif name == "run_business_validation":
            from server.routers.members import parse_members
            result = parse_members()
            return json.dumps(result)

        elif name == "create_batch":
            from server.routers.batches import create_batch
            from db.mongo_connection import get_database

            # Self-check ready count before attempting
            db = get_database()
            ready_count = 0
            if db is not None:
                ready_count = db.members.count_documents({"status": "Ready"})

            if ready_count == 0:
                # Check if there are failed members that could be retried
                failed_count = db.members.count_documents({"status": "Processing Failed"}) if db is not None else 0
                return json.dumps({
                    "success": False,
                    "ready_count": 0,
                    "processing_failed_count": failed_count,
                    "message": (
                        "No Ready members to batch."
                        + (f" {failed_count} member(s) failed processing and can be retried." if failed_count else "")
                    ),
                })

            result = create_batch()
            result["ready_count_batched"] = ready_count
            return json.dumps(result)

        elif name == "process_batch":
            from db.mongo_connection import get_database

            batch_id = args.get("batch_id", "").strip()
            db = get_database()
            if db is None:
                return json.dumps({"error": "Database not available"})

            if not batch_id:
                pending = db.batches.find_one(
                    {"status": "Awaiting Approval"}, {"_id": 0, "id": 1}
                )
                if pending:
                    batch_id = pending["id"]

            if not batch_id:
                return json.dumps({"error": "No batch awaiting approval. Create a batch first."})

            existing = _batch_jobs.get(batch_id, {})
            if existing.get("status") == "running":
                return json.dumps({
                    "status": "already_running",
                    "batchId": batch_id,
                    "message": "This batch is already being processed in the background.",
                })

            members_in_batch = list(
                db.members.find({"status": "In Batch", "batch_id": batch_id}, {"_id": 0})
            )
            if not members_in_batch:
                return json.dumps({"error": f"No members with status 'In Batch' found for {batch_id}"})

            # Return streaming sentinel — stream_chat_response() will drain the queue
            # and yield per-member SSE events before continuing the LLM loop.
            return json.dumps({
                "status": "streaming",
                "batchId": batch_id,
                "memberCount": len(members_in_batch),
                "_members": members_in_batch,
            })

        elif name == "get_batch_result":
            batch_id = args.get("batch_id", "").strip()
            if not batch_id:
                return json.dumps({"error": "batch_id is required"})
            result = _batch_jobs.get(batch_id)
            if not result:
                # Also check MongoDB for the batch status as fallback
                from db.mongo_connection import get_database
                db = get_database()
                if db is not None:
                    batch = db.batches.find_one({"id": batch_id}, {"_id": 0})
                    if batch:
                        return json.dumps({
                            "status": batch.get("status", "unknown"),
                            "batchId": batch_id,
                            "processedCount": batch.get("processedCount"),
                            "failedCount": batch.get("failedCount"),
                            "completedAt": batch.get("completedAt"),
                            "source": "mongodb",
                        })
                return json.dumps({
                    "status": "unknown",
                    "batchId": batch_id,
                    "message": "No job found. The batch may not have been started this session.",
                })
            return json.dumps(result)

        elif name == "get_system_status":
            from server.routers.members import summarize_system_status
            from server.routers.files import get_todays_dir, get_statuses

            result = summarize_system_status()

            target_dir = get_todays_dir()
            statuses = get_statuses()
            unchecked_on_disk = 0
            if os.path.exists(target_dir):
                for fname in os.listdir(target_dir):
                    if fname.endswith(".edi"):
                        file_status = statuses.get(fname, {}).get("status", "Unchecked")
                        if file_status in ("Unchecked", "Healthy"):
                            unchecked_on_disk += 1

            file_counts = result.get("fileCounts", {})
            if unchecked_on_disk > 0:
                file_counts["Unchecked"] = file_counts.get("Unchecked", 0) + unchecked_on_disk
            result["fileCounts"] = file_counts

            mc = result.get("memberCounts", {})
            full = {
                "unchecked_edi_on_disk": unchecked_on_disk,
                "pending_business_validation_count": mc.get("Pending Business Validation", 0),
                "ready_count": mc.get("Ready", 0),
                "awaiting_clarification_count": mc.get("Awaiting Clarification", 0),
                "in_batch_count": mc.get("In Batch", 0),
                "enrolled_oep_count": mc.get("Enrolled", 0),
                "enrolled_sep_count": mc.get("Enrolled (SEP)", 0),
                "in_review_count": mc.get("In Review", 0),
                "processing_failed_count": mc.get("Processing Failed", 0),
                "batchCount": result.get("batchCount", 0),
                "batches": result.get("batches", []),
                "fileCounts": file_counts,
                "active_background_jobs": {
                    bid: {"status": job["status"], "startedAt": job.get("startedAt")}
                    for bid, job in _batch_jobs.items()
                    if job.get("status") == "running"
                },
            }

            # Return only the slice the user asked about
            query = args.get("query", "all").lower()

            if query == "edi_files":
                return json.dumps({
                    "unchecked_edi_on_disk": full["unchecked_edi_on_disk"],
                    "fileCounts": full["fileCounts"],
                })
            elif query == "pending_validation":
                return json.dumps({
                    "pending_business_validation_count": full["pending_business_validation_count"],
                })
            elif query == "ready":
                return json.dumps({
                    "ready_count": full["ready_count"],
                })
            elif query == "clarifications":
                return json.dumps({
                    "awaiting_clarification_count": full["awaiting_clarification_count"],
                })
            elif query == "enrolled":
                return json.dumps({
                    "enrolled_oep_count": full["enrolled_oep_count"],
                    "enrolled_sep_count": full["enrolled_sep_count"],
                    "total_enrolled": full["enrolled_oep_count"] + full["enrolled_sep_count"],
                })
            elif query == "in_review":
                return json.dumps({
                    "in_review_count": full["in_review_count"],
                })
            elif query == "failed":
                return json.dumps({
                    "processing_failed_count": full["processing_failed_count"],
                })
            elif query == "batches":
                return json.dumps({
                    "batchCount": full["batchCount"],
                    "batches": full["batches"],
                    "active_background_jobs": full["active_background_jobs"],
                })
            else:
                # "all" — full dump
                return json.dumps(full)

        elif name == "get_clarifications":
            from db.mongo_connection import get_database
            db = get_database()
            if db is None:
                return json.dumps({"error": "Database not available"})

            members = list(db.members.find(
                {"status": "Awaiting Clarification"},
                {"_id": 0, "subscriber_id": 1, "validation_issues": 1,
                 "latest_update": 1, "history": 1, "lastValidatedAt": 1}
            ))

            results = []
            for m in members:
                latest_date = m.get("latest_update")
                snapshot = (m.get("history") or {}).get(latest_date, {})
                info = snapshot.get("member_info") or {}
                name_str = " ".join(filter(None, [
                    info.get("first_name"), info.get("last_name")
                ])) or "Unknown"
                raw_issues = m.get("validation_issues") or []
                normalised_issues = [
                    {"message": issue.get("message", ""), "severity": issue.get("severity")}
                    if isinstance(issue, dict)
                    else {"message": issue, "severity": None}
                    for issue in raw_issues
                ]
                results.append({
                    "subscriber_id": m.get("subscriber_id"),
                    "name": name_str,
                    "issues": normalised_issues,
                    "issue_count": len(normalised_issues),
                    "last_validated": (m.get("lastValidatedAt") or "")[:10],
                })

            return json.dumps({
                "total": len(results),
                "members": results,
            })

        elif name == "get_enrolled_members":
            from db.mongo_connection import get_database
            db = get_database()
            if db is None:
                return json.dumps({"error": "Database not available"})

            query: Dict[str, Any] = {
                "status": {"$in": ["Enrolled", "Enrolled (SEP)"]}
            }

            date_filter = args.get("date", "").strip()
            if date_filter:
                # Match on lastProcessedAt date prefix (YYYY-MM-DD)
                query["lastProcessedAt"] = {"$regex": f"^{date_filter}"}

            enrollment_path = args.get("enrollment_path", "").strip().upper()
            if enrollment_path == "SEP":
                query["status"] = "Enrolled (SEP)"
            elif enrollment_path == "OEP":
                query["status"] = "Enrolled"

            members = list(db.members.find(query, {
                "_id": 0,
                "subscriber_id": 1,
                "status": 1,
                "lastProcessedAt": 1,
                "markers": 1,
                "history": 1,
            }))

            # Extract name from latest history snapshot
            results = []
            for m in members:
                history = m.get("history", {})
                latest_date = max(history.keys()) if history else None
                info = history[latest_date].get("member_info", {}) if latest_date else {}
                first = info.get("first_name", "")
                last = info.get("last_name", "")
                results.append({
                    "subscriber_id": m["subscriber_id"],
                    "name": f"{first} {last}".strip() or "Unknown",
                    "status": m.get("status"),
                    "enrollment_path": m.get("markers", {}).get("enrollment_path", "OEP"),
                    "lastProcessedAt": (m.get("lastProcessedAt") or "")[:10],
                })

            return json.dumps({
                "total": len(results),
                "date_filter": date_filter or "all time",
                "enrollment_path_filter": enrollment_path or "all",
                "members": results,
            })

        elif name == "retry_failed_members":
            from db.mongo_connection import get_database
            db = get_database()
            if db is None:
                return json.dumps({"error": "Database not available"})

            failed_members = list(db.members.find(
                {"status": "Processing Failed"},
                {"_id": 0, "subscriber_id": 1, "processing_error": 1}
            ))
            if not failed_members:
                return json.dumps({"requeued": 0, "message": "No Processing Failed members found."})

            ids = [m["subscriber_id"] for m in failed_members]
            db.members.update_many(
                {"subscriber_id": {"$in": ids}},
                {"$set": {
                    "status": "Ready",
                    "retried_at": _dt.utcnow().isoformat(),
                }, "$unset": {"processing_error": ""}}
            )
            return json.dumps({
                "requeued": len(ids),
                "subscriber_ids": ids,
                "message": (
                    f"{len(ids)} member(s) re-queued as Ready. "
                    "Create a new batch to include them in the next enrollment run."
                ),
            })

        elif name == "reprocess_in_review":
            from db.mongo_connection import get_database

            db = get_database()
            if db is None:
                return json.dumps({"error": "Database not available"})

            subscriber_id = args.get("subscriber_id", "").strip()
            query = {"status": "In Review"}
            if subscriber_id:
                query["subscriber_id"] = subscriber_id

            members_to_reprocess = list(db.members.find(query, {"_id": 0}))
            if not members_to_reprocess:
                target = f"subscriber {subscriber_id}" if subscriber_id else "any In Review members"
                return json.dumps({"error": f"No In Review members found for {target}"})

            # Re-set to a temporary batch-like state and fire background processing
            ids = [m["subscriber_id"] for m in members_to_reprocess]
            reprocess_batch_id = f"REVIEW-REPROCESS-{_dt.utcnow().strftime('%Y%m%d%H%M%S')}"

            db.members.update_many(
                {"subscriber_id": {"$in": ids}},
                {"$set": {"status": "In Batch", "batch_id": reprocess_batch_id}}
            )
            db.batches.insert_one({
                "id": reprocess_batch_id,
                "status": "Awaiting Approval",
                "membersCount": len(ids),
                "member_ids": ids,
                "createdAt": _dt.utcnow().isoformat(),
                "note": "Auto-created for In Review reprocessing",
            })

            asyncio.create_task(_run_batch_in_background(reprocess_batch_id, members_to_reprocess))

            return json.dumps({
                "status": "started",
                "batchId": reprocess_batch_id,
                "memberCount": len(ids),
                "subscriber_ids": ids,
                "message": (
                    f"{len(ids)} In Review member(s) sent back through the enrollment pipeline. "
                    f"Use get_batch_result with batchId '{reprocess_batch_id}' to check when done."
                ),
            })

        elif name == "get_enrolled_members":
            from db.mongo_connection import get_database
            db = get_database()
            if db is None:
                return json.dumps({"error": "Database not available"})

            date_filter = args.get("date", "").strip()
            query = {"status": {"$in": ["Enrolled", "Enrolled (SEP)"]}}

            members = list(db.members.find(query, {"_id": 0}))

            # Filter by date if provided (match on lastProcessedAt prefix)
            if date_filter:
                members = [
                    m for m in members
                    if (m.get("lastProcessedAt") or "").startswith(date_filter)
                ]

            result = []
            for m in members:
                latest_date = m.get("latest_update")
                snapshot = (m.get("history") or {}).get(latest_date, {})
                info = snapshot.get("member_info") or {}
                dependents = snapshot.get("dependents") or []
                coverages = snapshot.get("coverages") or []

                name_str = " ".join(filter(None, [info.get("first_name"), info.get("last_name")])) or "Unknown"
                result.append({
                    "subscriber_id": m.get("subscriber_id"),
                    "name": name_str,
                    "status": m.get("status"),
                    "enrollment_path": (m.get("markers") or {}).get("enrollment_path", "OEP"),
                    "last_processed": m.get("lastProcessedAt", "")[:10] if m.get("lastProcessedAt") else "—",
                    "plan_code": (coverages[0].get("plan_code") if coverages else None) or "—",
                    "dependents_count": len(dependents),
                })

            return json.dumps({
                "total": len(result),
                "date_filter": date_filter or "all",
                "members": result,
            })

        elif name == "get_subscriber_details":
            from db.mongo_connection import get_database
            from datetime import datetime as _datetime
            db = get_database()
            if db is None:
                return json.dumps({"error": "Database not available"})

            subscriber_id = args.get("subscriber_id", "").strip()
            if not subscriber_id:
                return json.dumps({"error": "subscriber_id is required"})

            m = db.members.find_one({"subscriber_id": subscriber_id}, {"_id": 0})
            if not m:
                return json.dumps({"error": f"No member found with subscriber_id '{subscriber_id}'"})

            latest_date = m.get("latest_update")
            snapshot = (m.get("history") or {}).get(latest_date, {})
            info = snapshot.get("member_info") or {}
            dependents = snapshot.get("dependents") or []
            coverages = snapshot.get("coverages") or []

            def calc_age(dob_str):
                if not dob_str:
                    return None
                try:
                    dob = _datetime.strptime(dob_str, "%Y-%m-%d")
                    return int(((_datetime.utcnow() - dob).days) / 365.25)
                except Exception:
                    return None

            dep_list = []
            for dep in dependents:
                di = dep.get("member_info") or {}
                dep_list.append({
                    "name": " ".join(filter(None, [di.get("first_name"), di.get("last_name")])) or "Unknown",
                    "dob": di.get("dob") or "—",
                    "age": calc_age(di.get("dob")),
                    "gender": "Male" if di.get("gender") == "M" else "Female" if di.get("gender") == "F" else di.get("gender") or "—",
                    "relationship_code": di.get("relationship_code") or "—",
                })

            coverage_list = []
            for cov in coverages:
                coverage_list.append({
                    "plan_code": cov.get("plan_code") or "—",
                    "coverage_start": cov.get("coverage_start_date") or "—",
                    "coverage_end": cov.get("coverage_end_date") or "—",
                })

            markers = m.get("markers") or {}
            agent_analysis = m.get("agent_analysis") or {}
            branch_analysis = agent_analysis.get("branch_analysis") or {}
            evidence_check = agent_analysis.get("evidence_check") or {}
            classification = agent_analysis.get("classification") or {}

            # SEP context
            sep_info = None
            if markers.get("is_sep_confirmed"):
                causality = branch_analysis.get("sep_causality") or {}
                sep_info = {
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

            return json.dumps({
                "subscriber_id": m.get("subscriber_id"),
                "name": " ".join(filter(None, [info.get("first_name"), info.get("last_name")])) or "Unknown",
                "status": m.get("status"),
                "last_updated": m.get("latest_update") or "—",
                "last_validated": (m.get("lastValidatedAt") or "")[:10] or "—",
                "last_processed": (m.get("lastProcessedAt") or "")[:10] or "—",
                "batch_id": m.get("batch_id") or "—",
                "enrollment_path": markers.get("enrollment_path", "—"),
                "enrollment_type": classification.get("enrollment_type") or "—",
                "agent_summary": m.get("agent_summary"),  # plain-English summary; null for legacy docs
                "validation_issues": [
                    issue if isinstance(issue, dict) else {"message": issue, "severity": None}
                    for issue in (m.get("validation_issues") or [])
                ],
                "coverages": coverage_list,
                "dependents_count": len(dep_list),
                "dependents": dep_list,
                "employer": info.get("employer_name") or "—",
                "insurer": info.get("insurer_name") or "—",
                "sep": sep_info,
            })

        elif name == "analyze_member":
            from db.mongo_connection import get_database
            from server.ai.agent import EnrollmentRouterAgent, build_engine_input

            subscriber_id = args.get("subscriber_id", "").strip()
            if not subscriber_id:
                return json.dumps({"error": "subscriber_id is required"})

            db = get_database()
            if db is None:
                return json.dumps({"error": "Database not available"})

            m = db.members.find_one({"subscriber_id": subscriber_id}, {"_id": 0})
            if not m:
                return json.dumps({"error": f"No member found with subscriber_id '{subscriber_id}'"})

            name_str = _extract_member_name(m)
            sep_info = _build_sep_context(m)
            raw_issues = m.get("validation_issues") or []
            normalised_issues = [
                issue if isinstance(issue, dict) else {"message": issue, "severity": None}
                for issue in raw_issues
            ]

            # Cache hit: return stored summary without re-running pipeline
            if m.get("agent_summary") is not None:
                return json.dumps({
                    "subscriber_id": subscriber_id,
                    "name": name_str,
                    "status": m.get("status"),
                    "agent_summary": m.get("agent_summary"),
                    "validation_issues": normalised_issues,
                    "sep": sep_info,
                })

            # Cache miss: run EnrollmentRouterAgent on demand
            try:
                result = json.loads(
                    await EnrollmentRouterAgent(json.dumps(build_engine_input(m)))
                )
                root_status = result.get("root_status_recommended", "In Review")
                summary = result.get("plain_english_summary")

                db.members.update_one(
                    {"subscriber_id": subscriber_id},
                    {"$set": {
                        "agent_summary": summary,
                        "status": root_status,
                        "agent_analysis": result.get("agent_analysis", {}),
                        "markers": result.get("markers", {}),
                        "lastProcessedAt": _dt.utcnow().isoformat(),
                    }}
                )
                return json.dumps({
                    "subscriber_id": subscriber_id,
                    "name": name_str,
                    "status": root_status,
                    "agent_summary": summary,
                    "validation_issues": normalised_issues,
                    "sep": sep_info,
                })
            except Exception as e:
                return json.dumps({"error": str(e), "agent_summary": None})

        else:
            return json.dumps({"error": f"Unknown tool: {name}"})

    except Exception as e:
        return json.dumps({"error": str(e)})


# ---------------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------------
def _get_api_key() -> str:
    key = os.getenv("AI_REFINERY_KEY") or os.getenv("AI_REFINERY_API_KEY") or os.getenv("API_KEY")
    return key or ""  # Return empty string instead of raising — handled in stream_chat_response


def _build_messages(history: List[Dict[str, str]], system_context: str) -> List[Dict[str, str]]:
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


# ---------------------------------------------------------------------------
# MAIN STREAMING ENTRY POINT
# ---------------------------------------------------------------------------
async def stream_chat_response(
    history: List[Dict[str, str]],
    system_context: str = "",
) -> AsyncGenerator[str, None]:
    """
    Agentic tool-calling loop:
      1. Send messages + tools to LLM
      2. LLM calls a tool → await execution → append result → loop
      3. LLM produces final text → stream as SSE
    """
    def send_event(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    # We use a list as a simple one-shot buffer; the real yielding happens below.

    api_key = _get_api_key()
    if not api_key:
        yield send_event({
            "type": "response",
            "message": (
                "⚠️ The AI assistant is not configured yet.\n\n"
                "The `AI_REFINERY_KEY` environment variable is missing. "
                "Please add it to your `.env` file and restart the server.\n\n"
                "Once configured, I'll be able to answer questions about your enrollment pipeline, "
                "check EDI files, validate members, create batches, and more."
            ),
            "suggestions": [{"text": "Show system status", "action": "status"}],
        })
        yield send_event({"type": "done"})
        return

    client = AsyncAIRefinery(api_key=api_key)
    messages = _build_messages(history, system_context)

    # ── Round 0 kickoff ──────────────────────────────────────────────────────
    yield send_event({"type": "thinking", "message": "Received your message — routing to orchestrator..."})

    try:
        for round_num in range(8):
            if round_num == 0:
                yield send_event({"type": "thinking", "message": "Orchestrator analysing intent and selecting tool..."})
            else:
                yield send_event({"type": "thinking", "message": f"Orchestrator reviewing tool result (round {round_num + 1})..."})

            response = await client.chat.completions.create(
                messages=messages,
                model="openai/gpt-oss-120b",
                tools=TOOLS,
                tool_choice="auto",
                temperature=0.3,
                max_completion_tokens=1024,
            )

            choice = response.choices[0]
            msg = choice.message

            # ── Orchestrator decided ─────────────────────────────────────────
            if choice.finish_reason == "tool_calls" and msg.tool_calls:
                tool_names = [tc.function.name for tc in msg.tool_calls]
                tool_label = " + ".join(t.replace("_", " ") for t in tool_names)
                yield send_event({"type": "thinking", "message": f"Orchestrator dispatching → {tool_label}"})
            else:
                yield send_event({"type": "thinking", "message": "Orchestrator composing final response..."})

            # ---- Tool call round ----
            if choice.finish_reason == "tool_calls" and msg.tool_calls:
                messages.append({
                    "role": "assistant",
                    "content": msg.content or "",
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            },
                        }
                        for tc in msg.tool_calls
                    ],
                })

                for tc in msg.tool_calls:
                    tool_name = tc.function.name
                    try:
                        tool_args = json.loads(tc.function.arguments or "{}")
                    except Exception:
                        tool_args = {}

                    # ── Pre-execution thinking event ─────────────────────────
                    if tool_name == "analyze_member":
                        sid = tool_args.get('subscriber_id', '')
                        thinking_msg = f"Tool: analyze_member — fetching record for {sid}"
                        exec_msg    = f"Running AI enrollment analysis for {sid}..."
                    elif tool_name == "process_batch":
                        bid = tool_args.get('batch_id', '') or 'pending batch'
                        thinking_msg = f"Tool: process_batch — launching pipeline for {bid}"
                        exec_msg    = f"Streaming enrollment pipeline for {bid}..."
                    elif tool_name == "get_subscriber_details":
                        sid = tool_args.get('subscriber_id', '')
                        thinking_msg = f"Tool: get_subscriber_details — loading {sid}"
                        exec_msg    = f"Reading subscriber record {sid} from MongoDB..."
                    elif tool_name == "get_system_status":
                        query = tool_args.get('query', 'all')
                        thinking_msg = f"Tool: get_system_status — query={query}"
                        exec_msg    = "Aggregating member counts and batch status from database..."
                    elif tool_name == "check_edi_structure":
                        thinking_msg = "Tool: check_edi_structure — scanning EDI files"
                        exec_msg    = "Parsing EDI 834 files on disk, checking segment structure..."
                    elif tool_name == "run_business_validation":
                        thinking_msg = "Tool: run_business_validation — validating pending members"
                        exec_msg    = "Applying SSN, DOB, address and coverage rules to each member..."
                    elif tool_name == "create_batch":
                        thinking_msg = "Tool: create_batch — bundling Ready members"
                        exec_msg    = "Grouping all Ready members into a new enrollment batch..."
                    elif tool_name == "get_clarifications":
                        thinking_msg = "Tool: get_clarifications — fetching Awaiting Clarification list"
                        exec_msg    = "Querying MongoDB for members with validation failures..."
                    elif tool_name == "get_enrolled_members":
                        date = tool_args.get('date', '')
                        thinking_msg = f"Tool: get_enrolled_members — date={date or 'all'}"
                        exec_msg    = f"Querying enrolled members{' for ' + date if date else ''}..."
                    elif tool_name == "retry_failed_members":
                        thinking_msg = "Tool: retry_failed_members — re-queuing failed members"
                        exec_msg    = "Resetting Processing Failed members back to Ready status..."
                    elif tool_name == "reprocess_in_review":
                        sid = tool_args.get('subscriber_id', '')
                        thinking_msg = f"Tool: reprocess_in_review — target={sid or 'all In Review'}"
                        exec_msg    = f"Re-running enrollment pipeline on {sid or 'all In Review members'}..."
                    else:
                        thinking_msg = f"Tool: {tool_name} — executing"
                        exec_msg    = f"Running {tool_name.replace('_', ' ')}..."

                    yield send_event({"type": "thinking", "message": thinking_msg})
                    yield send_event({"type": "thinking", "message": exec_msg})

                    tool_result = await _execute_tool(tool_name, tool_args)

                    # ---- Streaming batch drain ----
                    # When process_batch returns a streaming sentinel, drain the queue
                    # and yield per-member SSE events before continuing the LLM loop.
                    try:
                        sentinel_check = json.loads(tool_result)
                        if isinstance(sentinel_check, dict) and sentinel_check.get("status") == "streaming":
                            batch_id_stream = sentinel_check["batchId"]
                            members_stream = sentinel_check.pop("_members", [])
                            stream_queue: asyncio.Queue = asyncio.Queue()
                            asyncio.create_task(_run_batch_streaming(batch_id_stream, members_stream, stream_queue))

                            stream_processed = 0
                            stream_failed = 0
                            while True:
                                event = await stream_queue.get()
                                if event is None:
                                    break
                                yield send_event(event)
                                if event.get("type") == "member_result":
                                    if event.get("status") == "Processing Failed":
                                        stream_failed += 1
                                    else:
                                        stream_processed += 1

                            yield send_event({
                                "type": "status_update",
                                "message": (
                                    f"Batch complete — {stream_processed} enrolled, "
                                    f"{stream_failed} failed."
                                ),
                                "details": {
                                    "batchId": batch_id_stream,
                                    "processed": stream_processed,
                                    "failed": stream_failed,
                                },
                            })
                            # Replace tool_result with clean summary (strips _members)
                            tool_result = json.dumps({
                                "status": "completed",
                                "batchId": batch_id_stream,
                                "processed": stream_processed,
                                "failed": stream_failed,
                            })
                    except Exception:
                        pass  # not a streaming sentinel — continue normally

                    try:
                        parsed = json.loads(tool_result)
                        if isinstance(parsed, dict) and "error" not in parsed and parsed.get("status") != "completed":
                            # Build a human-readable completion message
                            if tool_name == "get_system_status":
                                mc = parsed
                                enrolled = mc.get("enrolled_oep_count", 0) + mc.get("enrolled_sep_count", 0)
                                in_review = mc.get("in_review_count", 0)
                                clarifications = mc.get("awaiting_clarification_count", 0)
                                ready = mc.get("ready_count", 0)
                                done_msg = f"✓ System status — {enrolled} enrolled, {ready} ready, {in_review} in review, {clarifications} awaiting clarification"
                            elif tool_name == "analyze_member":
                                name = parsed.get('name', '')
                                status = parsed.get('status', '')
                                has_sep = parsed.get('sep') is not None
                                done_msg = f"✓ Member record loaded — {name} ({status}){', SEP detected' if has_sep else ''}"
                            elif tool_name == "get_clarifications":
                                total = parsed.get('total', 0)
                                done_msg = f"✓ Found {total} member{'s' if total != 1 else ''} awaiting clarification"
                            elif tool_name == "get_enrolled_members":
                                total = parsed.get('total', 0)
                                done_msg = f"✓ Found {total} enrolled member{'s' if total != 1 else ''}"
                            elif tool_name == "create_batch":
                                count = parsed.get('ready_count_batched', '?')
                                bid = parsed.get('batch_id', '')
                                done_msg = f"✓ Batch {bid} created — {count} members bundled"
                            elif tool_name == "check_edi_structure":
                                healthy = parsed.get('healthy', 0)
                                issues = parsed.get('issues', 0)
                                done_msg = f"✓ EDI scan complete — {healthy} healthy, {issues} with issues"
                            elif tool_name == "run_business_validation":
                                validated = parsed.get('validated', 0)
                                clarifications = parsed.get('clarifications', 0)
                                done_msg = f"✓ Validation done — {validated} ready, {clarifications} need clarification"
                            elif tool_name == "get_subscriber_details":
                                name = parsed.get('name', '')
                                status = parsed.get('status', '')
                                done_msg = f"✓ Subscriber loaded — {name} is {status}"
                            elif tool_name == "retry_failed_members":
                                requeued = parsed.get('requeued', 0)
                                done_msg = f"✓ {requeued} failed member{'s' if requeued != 1 else ''} re-queued as Ready"
                            elif tool_name == "reprocess_in_review":
                                count = parsed.get('memberCount', '?')
                                done_msg = f"✓ Reprocessing {count} In Review member{'s' if count != 1 else ''} — pipeline started"
                            elif tool_name == "get_batch_result":
                                status = parsed.get('status', '')
                                processed = parsed.get('processedCount') or parsed.get('processed', '?')
                                failed = parsed.get('failedCount') or parsed.get('failed', 0)
                                done_msg = f"✓ Batch result — {status}, {processed} processed, {failed} failed"
                            else:
                                done_msg = f"✓ {tool_name.replace('_', ' ')} completed"
                            yield send_event({
                                "type": "status_update",
                                "message": done_msg,
                                "details": parsed,
                            })
                        elif isinstance(parsed, dict) and "error" in parsed:
                            yield send_event({
                                "type": "thinking",
                                "message": f"⚠ {tool_name.replace('_', ' ')} returned error: {parsed['error']}",
                            })
                    except Exception:
                        pass

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": tool_result,
                    })

                continue

            # ---- Final text response ----
            full_response = msg.content or ""
            yield send_event({"type": "thinking", "message": "Formulating response from tool results..."})
            suggestions = []
            response_text = full_response

            # Extract SUGGESTIONS: line if present
            if "SUGGESTIONS:" in full_response:
                parts = full_response.rsplit("SUGGESTIONS:", 1)
                response_text = parts[0].strip()
                try:
                    raw_suggestions = json.loads(parts[1].strip())
                    # Validate: only keep suggestions with short text (≤6 words)
                    # If the LLM put long sentences, discard them — we'll auto-generate below
                    suggestions = [
                        s for s in raw_suggestions
                        if isinstance(s, dict) and len(s.get("text", "").split()) <= 6
                    ]
                except Exception:
                    suggestions = []

            # Strip "Next steps" / "Key take-aways" / similar prose sections
            # that the LLM keeps generating despite instructions
            import re
            response_text = re.sub(
                r'\n+\*{0,2}(Next steps?|Key take-?aways?|What (this|you can do) next|Recommended actions?)\*{0,2}:?.*',
                '',
                response_text,
                flags=re.IGNORECASE | re.DOTALL,
            ).strip()

            # Auto-generate suggestions from the last tool call context if LLM didn't provide good ones
            if not suggestions:
                last_tool = None
                for m in reversed(messages):
                    if m.get("role") == "assistant" and m.get("tool_calls"):
                        last_tool = m["tool_calls"][0]["function"]["name"]
                        break
                suggestion_map = {
                    "get_system_status": [
                        {"text": "View clarifications", "action": "clarification"},
                        {"text": "Create batch", "action": "batch"},
                        {"text": "Check enrolled", "action": "status"},
                    ],
                    "get_clarifications": [
                        {"text": "Run validation", "action": "business"},
                        {"text": "Check status", "action": "status"},
                    ],
                    "check_edi_structure": [
                        {"text": "Run validation", "action": "business"},
                        {"text": "Check status", "action": "status"},
                    ],
                    "run_business_validation": [
                        {"text": "Create batch", "action": "batch"},
                        {"text": "View clarifications", "action": "clarification"},
                    ],
                    "create_batch": [
                        {"text": "Process batch", "action": "process"},
                        {"text": "Check status", "action": "status"},
                    ],
                    "process_batch": [
                        {"text": "Check batch result", "action": "status"},
                        {"text": "Check status", "action": "status"},
                    ],
                    "get_batch_result": [
                        {"text": "Check status", "action": "status"},
                        {"text": "View enrolled", "action": "status"},
                    ],
                    "get_enrolled_members": [
                        {"text": "Check status", "action": "status"},
                        {"text": "View clarifications", "action": "clarification"},
                    ],
                    "analyze_member": [
                        {"text": "Reprocess member", "action": "process"},
                        {"text": "Check status", "action": "status"},
                    ],
                    "get_subscriber_details": [
                        {"text": "Analyze member", "action": "status"},
                        {"text": "Check status", "action": "status"},
                    ],
                }
                suggestions = suggestion_map.get(last_tool, [
                    {"text": "Check status", "action": "status"},
                ])[:3]

            yield send_event({
                "type": "response",
                "message": response_text,
                "suggestions": suggestions,
            })
            break

        else:
            yield send_event({
                "type": "response",
                "message": "Actions completed. See the status updates above for results.",
                "suggestions": [{"text": "Show system status", "action": "status"}],
            })

    except Exception as e:
        error_msg = str(e)
        # Provide a more helpful message for common errors
        if "401" in error_msg or "unauthorized" in error_msg.lower() or "invalid" in error_msg.lower():
            user_msg = (
                "⚠️ Authentication failed with the AI service.\n\n"
                "Your `AI_REFINERY_KEY` appears to be invalid or expired. "
                "Please check your `.env` file and restart the server."
            )
        elif "429" in error_msg or "rate limit" in error_msg.lower():
            user_msg = "⚠️ Rate limit reached. Please wait a moment and try again."
        elif "connect" in error_msg.lower() or "timeout" in error_msg.lower():
            user_msg = "⚠️ Could not connect to the AI service. Please check your network and try again."
        else:
            user_msg = f"⚠️ An error occurred: {error_msg}"

        yield send_event({
            "type": "response",
            "message": user_msg,
            "suggestions": [{"text": "Show system status", "action": "status"}],
        })

    yield send_event({"type": "done"})
