import os
import json
from datetime import datetime, timedelta
from typing import Dict, Any
from google.cloud import storage

# Mock current date for testing (OEP is Nov 1 - Jan 15)
# Set this to a date outside OEP to test SEP flow
CURRENT_DATE = datetime(2026, 5, 1) 

def enrollment_triage_logic(query: str) -> str:
    """
    Determines if the request should go to OEP or SEP flow.
    """
    oep_start = datetime(2025, 11, 1)
    oep_end = datetime(2026, 1, 15)
    
    if oep_start <= CURRENT_DATE <= oep_end:
        return "OEP: Request falls within Open Enrollment Period."
    else:
        return "SEP: Request triggered outside OEP. Special Enrollment Period workflow initiated."

def gcp_document_retrieval_agent(member_id: str) -> Dict[str, Any]:
    """
    Fetches supporting documentation for the SEP event from GCP Storage.
    """
    print(f"Agent: Fetching proof for subscriber {member_id} from GCP...")
    # placeholder for actual GCP logic
    # bucket_name = os.getenv("GCP_DOCS_BUCKET")
    # storage_client = storage.Client()
    # bucket = storage_client.bucket(bucket_name)
    # blob = bucket.blob(f"proofs/{member_id}/life_event_cert.pdf")
    
    # Mocking the discovery of a document
    return {
        "document_found": True,
        "document_name": "marriage_certificate.pdf",
        "storage_path": f"gs://enrollment-docs/proofs/{member_id}/cert.pdf",
        "metadata": {"upload_date": "2026-04-10", "type": "Certification"}
    }

def doc_analysis_summarizer_agent(doc_info: Dict[str, Any]) -> str:
    """
    Simulates a Document Intelligence / Vision LLM agent that processes the retrieved proof.
    """
    if not doc_info.get("document_found"):
        return "Error: No supporting documentation found for this SEP request."
    
    # Simulating OCR/Extraction results
    event_detected = "Marriage"
    event_date = "2026-04-05"
    confidence = 0.98
    
    return f"Doc Analysis: Verified {event_detected} certificate dated {event_date} (Confidence: {confidence})."

def sep_enrollment_agent_logic(member_id: str, edi_reason_code: str, edi_event_date: str) -> Dict[str, Any]:
    """
    The main SEP agent that coordinates document retrieval and final validation.
    """
    # 1. Fetch Docs
    doc_info = gcp_document_retrieval_agent(member_id)
    
    # 2. Analyze Docs
    doc_summary = doc_analysis_summarizer_agent(doc_info)
    
    # 3. Final Validation Logic
    # Check if doc analysis matches EDI reason
    is_valid = False
    if "Marriage" in doc_summary and edi_reason_code == "25":
        is_valid = True
    elif "Loss of Coverage" in doc_summary and edi_reason_code in ["14", "32"]:
        is_valid = True
        
    # Check 60-day window
    event_date = datetime.strptime(edi_event_date, "%Y-%m-%d")
    delta = CURRENT_DATE - event_date
    within_window = 0 <= delta.days <= 60
    
    final_status = "Approved" if (is_valid and within_window) else "Flagged for Manual Review"
    
    return {
        "status": final_status,
        "doc_verification": doc_summary,
        "timeline_check": f"{delta.days} days since event (Within 60d: {within_window})",
        "audit_trail": f"Automated SEP check for code {edi_reason_code} completed."
    }

# AI Refinery Executor Dictionary
executor_dict = {
    "Triage Agent": enrollment_triage_logic,
    "GCP Retrieval Agent": gcp_document_retrieval_agent,
    "Doc Analysis Agent": doc_analysis_summarizer_agent,
    "SEP Validation Sub-Agent": sep_enrollment_agent_logic
}

def orchestrate_enrollment(member_data: Dict[str, Any]):
    """
    Simulated Orchestrator for the New Enrollment Flow.
    """
    triage = enrollment_triage_logic("")
    
    if "SEP" in triage:
        # Get necessary info from member_data (parsed via pyx12)
        member_id = member_data.get("subscriber_id", "UNKNOWN")
        reason_code = member_data.get("maintenance_reason_code", "00")
        event_date = member_data.get("event_date", "2000-01-01")
        
        return sep_enrollment_agent_logic(member_id, reason_code, event_date)
    else:
        return {"status": "Approved", "period": "OEP"}
