"""
Async tool executor — routes LLM tool calls to real backend operations.
Add new tool handlers here as elif branches.
"""
import asyncio
import json
import os
from datetime import datetime as _dt, timezone as _tz
from typing import Any, Dict

from .batch_jobs import _batch_jobs
from .helpers import _extract_member_name, _build_sep_context


async def _execute_tool(name: str, args: Dict[str, Any]) -> str:
    """Executes the real backend function. Fully async — no asyncio.run()."""
    try:
        # ------------------------------------------------------------------ #
        #  EDI / VALIDATION                                                   #
        # ------------------------------------------------------------------ #
        if name == "check_edi_structure":
            from server.routers.files import check_structure, get_todays_dir, get_statuses

            target_dir = get_todays_dir()
            statuses = get_statuses()
            unchecked = [
                fname
                for fname in (os.listdir(target_dir) if os.path.exists(target_dir) else [])
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
            return json.dumps(parse_members())

        # ------------------------------------------------------------------ #
        #  BATCH MANAGEMENT                                                   #
        # ------------------------------------------------------------------ #
        elif name == "create_batch":
            from db.bq_connection import get_database

            db = get_database()
            ready_count = db.members.count_documents({"status": "Ready"}) if db is not None else 0

            if ready_count == 0:
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

            # Inline the batch creation logic — cannot call the FastAPI endpoint directly
            import time
            batch_id = f"BCH-{_dt.now(_tz.utc).strftime('%Y%m%d')}-{int(time.time()) % 1000}"
            member_ids_list = [
                m["subscriber_id"]
                for m in db.members.find({"status": "Ready"}, {"_id": 0, "subscriber_id": 1})
            ]
            db.batches.insert_one({
                "id": batch_id,
                "status": "Awaiting Approval",
                "membersCount": len(member_ids_list),
                "member_ids": member_ids_list,
                "createdAt": _dt.now(_tz.utc),
            })
            db.members.update_many(
                {"subscriber_id": {"$in": member_ids_list}},
                {"$set": {"status": "In Batch", "batch_id": batch_id}},
            )
            return json.dumps({
                "success": True,
                "batch_id": batch_id,
                "ready_count_batched": ready_count,
            })

        elif name == "process_batch":
            from db.bq_connection import get_database

            batch_id = args.get("batch_id", "").strip()
            db = get_database()
            if db is None:
                return json.dumps({"error": "Database not available"})

            if not batch_id:
                pending = db.batches.find_one({"status": "Awaiting Approval"}, {"_id": 0, "id": 1})
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

            # Return streaming sentinel — stream_chat_response() drains the queue
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
                from db.bq_connection import get_database
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
                            "source": "bigquery",
                        })
                return json.dumps({
                    "status": "unknown",
                    "batchId": batch_id,
                    "message": "No job found. The batch may not have been started this session.",
                })
            return json.dumps(result)

        # ------------------------------------------------------------------ #
        #  SYSTEM STATUS                                                      #
        # ------------------------------------------------------------------ #
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
                        if statuses.get(fname, {}).get("status", "Unchecked") in ("Unchecked", "Healthy"):
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

            query = args.get("query", "all").lower()
            slices = {
                "edi_files": {"unchecked_edi_on_disk": full["unchecked_edi_on_disk"], "fileCounts": full["fileCounts"]},
                "pending_validation": {"pending_business_validation_count": full["pending_business_validation_count"]},
                "ready": {"ready_count": full["ready_count"]},
                "clarifications": {"awaiting_clarification_count": full["awaiting_clarification_count"]},
                "enrolled": {
                    "enrolled_oep_count": full["enrolled_oep_count"],
                    "enrolled_sep_count": full["enrolled_sep_count"],
                    "total_enrolled": full["enrolled_oep_count"] + full["enrolled_sep_count"],
                },
                "in_review": {"in_review_count": full["in_review_count"]},
                "failed": {"processing_failed_count": full["processing_failed_count"]},
                "batches": {
                    "batchCount": full["batchCount"],
                    "batches": full["batches"],
                    "active_background_jobs": full["active_background_jobs"],
                },
            }
            return json.dumps(slices.get(query, full))

        # ------------------------------------------------------------------ #
        #  MEMBER QUERIES                                                     #
        # ------------------------------------------------------------------ #
        elif name == "get_clarifications":
            from db.bq_connection import get_database
            db = get_database()
            if db is None:
                return json.dumps({"error": "Database not available"})

            members = list(db.members.find(
                {"status": "Awaiting Clarification"},
                {"_id": 0, "subscriber_id": 1, "validation_issues": 1,
                 "latest_update": 1, "history": 1, "lastValidatedAt": 1},
            ))

            results = []
            for m in members:
                latest_date = m.get("latest_update")
                snapshot = (m.get("history") or {}).get(latest_date, {})
                info = snapshot.get("member_info") or {}
                name_str = " ".join(filter(None, [info.get("first_name"), info.get("last_name")])) or "Unknown"
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

            return json.dumps({"total": len(results), "members": results})

        elif name == "get_enrolled_members":
            from db.bq_connection import get_database
            db = get_database()
            if db is None:
                return json.dumps({"error": "Database not available"})

            date_filter = args.get("date", "").strip()
            query: Dict[str, Any] = {"status": {"$in": ["Enrolled", "Enrolled (SEP)"]}}

            members = list(db.members.find(query, {"_id": 0}))

            if date_filter:
                members = [m for m in members if (m.get("lastProcessedAt") or "").startswith(date_filter)]

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

            return json.dumps({"total": len(result), "date_filter": date_filter or "all", "members": result})

        elif name == "retry_failed_members":
            from db.bq_connection import get_database
            db = get_database()
            if db is None:
                return json.dumps({"error": "Database not available"})

            failed_members = list(db.members.find(
                {"status": "Processing Failed"},
                {"_id": 0, "subscriber_id": 1, "processing_error": 1},
            ))
            if not failed_members:
                return json.dumps({"requeued": 0, "message": "No Processing Failed members found."})

            ids = [m["subscriber_id"] for m in failed_members]
            db.members.update_many(
                {"subscriber_id": {"$in": ids}},
                {"$set": {
                    "status":           "Ready",
                    "retried_at":       _dt.now(_tz.utc),
                    "processing_error": None,
                }},
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
            from db.bq_connection import get_database
            from ..workflows.enrollment_pipeline import run_batch_in_background

            db = get_database()
            if db is None:
                return json.dumps({"error": "Database not available"})

            subscriber_id = args.get("subscriber_id", "").strip()
            query: Dict[str, Any] = {"status": "In Review"}
            if subscriber_id:
                query["subscriber_id"] = subscriber_id

            members_to_reprocess = list(db.members.find(query, {"_id": 0}))
            if not members_to_reprocess:
                target = f"subscriber {subscriber_id}" if subscriber_id else "any In Review members"
                return json.dumps({"error": f"No In Review members found for {target}"})

            ids = [m["subscriber_id"] for m in members_to_reprocess]
            reprocess_batch_id = f"REVIEW-REPROCESS-{_dt.now(_tz.utc).strftime('%Y%m%d%H%M%S')}"

            db.members.update_many(
                {"subscriber_id": {"$in": ids}},
                {"$set": {"status": "In Batch", "batch_id": reprocess_batch_id}},
            )
            db.batches.insert_one({
                "id": reprocess_batch_id,
                "status": "Awaiting Approval",
                "membersCount": len(ids),
                "member_ids": ids,
                "createdAt": _dt.now(_tz.utc),
                "note": "Auto-created for In Review reprocessing",
            })

            asyncio.create_task(run_batch_in_background(reprocess_batch_id, members_to_reprocess))

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

        elif name == "get_subscriber_details":
            from db.bq_connection import get_database
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
                    return int(((_dt.now(_tz.utc) - dob).days) / 365.25)
                except Exception:
                    return None

            dep_list = [
                {
                    "name": " ".join(filter(None, [(dep.get("member_info") or {}).get("first_name"), (dep.get("member_info") or {}).get("last_name")])) or "Unknown",
                    "dob": (dep.get("member_info") or {}).get("dob") or "—",
                    "age": calc_age((dep.get("member_info") or {}).get("dob")),
                    "gender": (
                        "Male" if (dep.get("member_info") or {}).get("gender") == "M"
                        else "Female" if (dep.get("member_info") or {}).get("gender") == "F"
                        else (dep.get("member_info") or {}).get("gender") or "—"
                    ),
                    "relationship_code": (dep.get("member_info") or {}).get("relationship_code") or "—",
                }
                for dep in dependents
            ]

            coverage_list = [
                {
                    "plan_code": cov.get("plan_code") or "—",
                    "coverage_start": cov.get("coverage_start_date") or "—",
                    "coverage_end": cov.get("coverage_end_date") or "—",
                }
                for cov in coverages
            ]

            markers = m.get("markers") or {}
            agent_analysis = m.get("agent_analysis") or {}
            branch_analysis = agent_analysis.get("branch_analysis") or {}
            evidence_check = agent_analysis.get("evidence_check") or {}
            classification = agent_analysis.get("classification") or {}

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
                "agent_summary": m.get("agent_summary"),
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
            from db.bq_connection import get_database
            from ..agents.router import EnrollmentRouterAgent
            from ..data.sanitizer import build_engine_input

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

            # Cache hit
            if m.get("agent_summary") is not None:
                return json.dumps({
                    "subscriber_id": subscriber_id,
                    "name": name_str,
                    "status": m.get("status"),
                    "agent_summary": m.get("agent_summary"),
                    "validation_issues": normalised_issues,
                    "sep": sep_info,
                })

            # Cache miss — run pipeline on demand
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
                        "lastProcessedAt": _dt.now(_tz.utc),
                    }},
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


