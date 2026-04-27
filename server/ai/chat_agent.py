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
- Call get_enrolled_members when the user asks who was enrolled, how many people enrolled today/this week, or wants a list of enrolled members. Pass today's date (YYYY-MM-DD) when they say "today".
- Call get_subscriber_details when the user asks about a specific subscriber ID — their status, last update, dependents, coverage, or any details about a named member.
- For conversational messages (greetings, questions, explanations) — respond directly, do NOT call any tool.

Member statuses: Pending Business Validation → Ready / Awaiting Clarification → In Batch → Enrolled / Enrolled (SEP) / In Review / Processing Failed

Status meanings:
- "Enrolled" = OEP member, pipeline completed successfully
- "Enrolled (SEP)" = SEP member, evidence complete, pipeline completed
- "In Review" = SEP with missing evidence, or has validation/hard blocks — needs manual review
- "Processing Failed" = pipeline threw an error — needs investigation
- "In Batch" = bundled, awaiting pipeline run
- "Awaiting Clarification" = failed business validation (missing SSN, DOB, address etc.)

RESPONSE FORMAT for data/action responses:
**[Action/Status Title]**
[1-2 sentence summary]
| Metric | Value |
|--------|-------|
[table rows with key numbers when you have counts]
**Next steps:**
1. [Most logical next action]
2. [Second option]

For conversational responses, just reply naturally — no tables or headers needed.

When showing system status always include: Enrolled (OEP), Enrolled (SEP), In Review, In Batch, Awaiting Clarification, Pending Business Validation, and Unchecked EDI files.

For action/data responses, end with:
SUGGESTIONS: [{"text": "...", "action": "validate|business|batch|process|status|clarification"}, ...]
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
            "description": "Returns members awaiting clarification with their validation issues.",
            "parameters": {"type": "object", "properties": {}, "required": []},
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
                "current status, last updated date, coverage info, dependents (name, DOB, gender, age), "
                "and any validation issues. Use when the user asks about a specific member or subscriber ID."
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
]


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

            asyncio.create_task(_run_batch_in_background(batch_id, members_in_batch))

            return json.dumps({
                "status": "started",
                "batchId": batch_id,
                "memberCount": len(members_in_batch),
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
            from server.routers.clarifications import read_clarifications
            result = read_clarifications()
            return json.dumps(result[:20])

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

            return json.dumps({
                "subscriber_id": m.get("subscriber_id"),
                "name": " ".join(filter(None, [info.get("first_name"), info.get("last_name")])) or "Unknown",
                "status": m.get("status"),
                "last_updated": m.get("latest_update") or "—",
                "last_validated": (m.get("lastValidatedAt") or "")[:10] or "—",
                "last_processed": (m.get("lastProcessedAt") or "")[:10] or "—",
                "batch_id": m.get("batch_id") or "—",
                "enrollment_path": (m.get("markers") or {}).get("enrollment_path", "—"),
                "validation_issues": m.get("validation_issues") or [],
                "coverages": coverage_list,
                "dependents_count": len(dep_list),
                "dependents": dep_list,
                "employer": info.get("employer_name") or "—",
                "insurer": info.get("insurer_name") or "—",
            })

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

    yield send_event({"type": "thinking", "message": "Thinking..."})

    try:
        for _ in range(8):
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

                    yield send_event({
                        "type": "thinking",
                        "message": f"Running: {tool_name.replace('_', ' ')}...",
                    })

                    tool_result = await _execute_tool(tool_name, tool_args)

                    try:
                        parsed = json.loads(tool_result)
                        if isinstance(parsed, dict) and "error" not in parsed:
                            yield send_event({
                                "type": "status_update",
                                "message": f"✓ {tool_name.replace('_', ' ')} completed",
                                "details": parsed,
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
            suggestions = []
            response_text = full_response

            if "SUGGESTIONS:" in full_response:
                parts = full_response.rsplit("SUGGESTIONS:", 1)
                response_text = parts[0].strip()
                try:
                    suggestions = json.loads(parts[1].strip())
                except Exception:
                    suggestions = []

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
