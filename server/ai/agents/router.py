"""
EnrollmentRouterAgent — master orchestrator that chains all pipeline agents.
Returns JSON only.
"""
import json
import os

from .base import register_agent
from .classifier import EnrollmentClassifierAgent
from .sep_inference import SepInferenceAgent
from .normal_enrollment import NormalEnrollmentAgent
from .decision import DecisionAgent
from .evidence_check import EvidenceCheckAgent
from ..core.utils import _get_latest_two_snapshots, _utc_now_z
from ..data.sanitizer import build_engine_input
from ..data.views import classification_view, sep_inference_view, normal_flow_view, decision_view

from ..notifications.email_agent import draft_email, send_email

DEFAULT_ENROLLMENT_SOURCE = os.getenv("DEFAULT_ENROLLMENT_SOURCE", "Employer")


@register_agent("EnrollmentRouterAgent")
async def EnrollmentRouterAgent(query: str, **kwargs) -> str:
    """
    Stage-specific routing (Phase 3 - accepts pre-classified data from IntakeOrchestrator):
      1. Accept pre-classified data (file_classification already determined upstream)
      2. SEP inference OR normal flow
      3. Authority analysis
      4. Decision
      5. Evidence check (SEP only, when no hard blocks)
    
    Input JSON (from IntakeOrchestrator):
    {
        "subscriber_id": "SUB-12345",
        "file_classification": "enrollment_oep" or "enrollment_sep",
        "parsed_data": {...},
        "subscriber_context": {...},
        "business_metadata": {...}
    }
    
    OR (backward compatibility - legacy direct calls):
    {
        "subscriber_id": "SUB-12345",
        "history": {...}
    }
    """
    try:
        payload = json.loads(query)
        subscriber_id = payload.get("subscriber_id")
        
        # ---- DETERMINE INPUT SOURCE ----
        # Check if this is new pre-classified input from IntakeOrchestrator
        file_classification = payload.get("file_classification")
        parsed_data = payload.get("parsed_data")
        subscriber_context = payload.get("subscriber_context")
        business_metadata = payload.get("business_metadata")
        
        # If pre-classified data provided, use it; otherwise fall back to legacy flow
        if file_classification and parsed_data:
            # NEW FLOW: Pre-classified data from IntakeOrchestrator
            # Skip classification step - already done upstream
            classification = {
                "file_classification": file_classification,
                "sep_candidate": file_classification in ["enrollment_sep"],
                "is_within_oep": file_classification in ["enrollment_oep", "enrollment_sep"],
                "source": "intake_orchestrator_pre_classified"
            }
            full_record = parsed_data
        else:
            # LEGACY FLOW: Direct call with history (backward compatibility)
            full_record = build_engine_input(payload)
            
            if not (full_record.get("history") or {}):
                return json.dumps({
                    "subscriber_id": subscriber_id,
                    "root_status_recommended": "In Review",
                    "agent_analysis": {"error": "No history snapshots found", "history_dates": []},
                })

            # ---- 1) Classification (legacy path only)
            classification_record = classification_view(full_record)
            classification = json.loads(
                await EnrollmentClassifierAgent(json.dumps(classification_record))
            )

        # ---- 2) Branch analysis
        # For new pre-classified flow, determine branch based on file_classification
        # For legacy flow, use sep_candidate from classification
        is_sep_path = classification.get("sep_candidate", False)
        
        if is_sep_path:
            # SEP path: use SepInferenceAgent
            if file_classification and parsed_data:
                # New flow: build sep_record from parsed_data
                sep_record = parsed_data
            else:
                # Legacy flow: use sep_inference_view
                sep_record = sep_inference_view(full_record)
            
            branch_analysis = json.loads(
                await SepInferenceAgent(json.dumps({"record": sep_record, "classification": classification}))
            )
        else:
            # Normal/OEP path: use NormalEnrollmentAgent
            if file_classification and parsed_data:
                # New flow: build normal_record from parsed_data
                normal_record = parsed_data
            else:
                # Legacy flow: use normal_flow_view
                normal_record = normal_flow_view(full_record)
            
            branch_analysis = json.loads(
                await NormalEnrollmentAgent(json.dumps({"record": normal_record, "classification": classification}))
            )

        # ---- 3) Authority analysis
        source = full_record.get("source_system") or DEFAULT_ENROLLMENT_SOURCE
        payer_discretion = source not in ["Exchange", "CMS", "FFE", "SBE"]
        authority = {
            "authority_analysis": {
                "source": source,
                "payer_discretion": payer_discretion,
                "notes": "Add EDI envelope sender/receiver IDs to Mongo for deterministic classification.",
            }
        }

        # ---- 4) Decision
        if file_classification and parsed_data:
            # New flow: use parsed_data directly
            decision_record = parsed_data
        else:
            # Legacy flow: use decision_view
            decision_record = decision_view(full_record)
        
        decision = json.loads(
            await DecisionAgent(
                json.dumps({
                    "record": decision_record,
                    "classification": classification,
                    "analysis": branch_analysis,
                })
            )
        )

        # ---- 5) Evidence check + final status override
        root_status_recommended = decision.get("root_status_recommended", "In Review")
        evidence_check = None

        requires_evidence = decision.get("agent_analysis_patch", {}).get("requires_evidence_check", False)
        hard_blocks = decision.get("agent_analysis_patch", {}).get("hard_blocks", []) or []
        sep_confirmed = branch_analysis.get("sep_confirmed") is True

        if sep_confirmed and requires_evidence:
            sep_type = (branch_analysis.get("sep_causality") or {}).get("sep_candidate")
            evidence_check = json.loads(
                await EvidenceCheckAgent(
                    json.dumps({"subscriber_id": subscriber_id, "sep_type": sep_type})
                )
            )

            if hard_blocks:
                root_status_recommended = "In Review"
            else:
                root_status_recommended = (
                    "Enrolled (SEP)" if evidence_check.get("evidence_complete") is True else "In Review"
                )

        # Promote "Ready" → "Enrolled" for clean OEP path
        if root_status_recommended == "Ready" and not sep_confirmed:
            root_status_recommended = "Enrolled"

        # ---- Send email if SEP evidence is missing
        if evidence_check and evidence_check.get("email_triggered"):
            sep_type = (branch_analysis.get("sep_causality") or {}).get("sep_candidate")
            email = draft_email(
                template="sep_missing_documents",
                context={
                    "member_name": full_record.get("member_name", "Member"),
                    "sep_type": sep_type,
                    "missing_documents": "\n".join(evidence_check["missing_docs"]),
                },
            )
            send_email(to=full_record.get("email"), email_payload=email)

        # ---- 6) Diff explainability
        # For new pre-classified flow, skip diff (no history snapshots)
        # For legacy flow, compute diff from classification_record
        if file_classification and parsed_data:
            # New flow: no history snapshots available
            diff = {
                "history_dates": [],
                "diff": [],
                "semantic_flags": ["pre_classified_intake_flow"],
                "notes": "Pre-classified intake flow - no historical snapshots to diff.",
            }
        else:
            # Legacy flow: compute diff
            latest, prev, dates = _get_latest_two_snapshots(classification_record)
            if prev is None:
                diff = {
                    "history_dates": dates,
                    "diff": [],
                    "semantic_flags": ["first_snapshot_only"],
                    "notes": "Only one snapshot exists; nothing to diff yet.",
                }
            else:
                from ..core.utils import _deep_diff as _dd
                raw_diffs = _dd(prev, latest)
                flags = []
                if len(raw_diffs) == 0:
                    flags.append("exact_resend_or_duplicate")
                else:
                    non_status = [
                        d for d in raw_diffs
                        if not d["path"].endswith(".status") and d["path"] != "status"
                    ]
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
                    "semantic_flags": flags,
                }

        # ---- 5.5) SEP markers
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
            "enrollment_path": "SEP" if is_sep_confirmed else "OEP",
            "is_within_oep": classification.get("is_within_oep"),
        }

        agent_analysis = {
            "diff": diff,
            "classification": classification,
            "branch_analysis": branch_analysis,
            "authority": authority,
            "decision": decision,
            "evidence_check": evidence_check,
            "final_explain": {
                "final_root_status": root_status_recommended,
                "logic": (
                    "OEP clean path (no SEP, no hard blocks) => Enrolled. "
                    "SEP confirmed + evidence complete => Enrolled (SEP). "
                    "SEP confirmed + evidence missing => In Review + email triggered. "
                    "Hard blocks (validation issues / blocking status) => In Review."
                ),
            },
        }

        return json.dumps({
            "subscriber_id": subscriber_id,
            "root_status_recommended": root_status_recommended,
            "plain_english_summary": decision.get("plain_english_summary"),
            "markers": markers,
            "agent_analysis": agent_analysis,
        })

    except Exception as e:
        return json.dumps({
            "subscriber_id": None,
            "root_status_recommended": "In Review",
            "plain_english_summary": None,
            "agent_analysis": {
                "error": "EnrollmentRouterAgent failed",
                "exception": type(e).__name__,
                "message": str(e),
            },
        })
