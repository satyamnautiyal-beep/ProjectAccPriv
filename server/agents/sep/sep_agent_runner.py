"""
SEP Agent runner. Wires executor_dict tools to the Distiller project
and exposes a process_sep_case() entry point for the API layer.
"""
import os
from datetime import date, datetime
from air import AsyncAIRefinery


# ---------------------------------------------------------------------------
# Tool implementations — called by Distiller via executor_dict
# ---------------------------------------------------------------------------

async def search_sep_knowledge(query: str) -> str:
    """
    Searches the SEP Agent SOP knowledge base in Azure AI Search.
    Returns the top matching rule sections as plain text.
    """
    from azure.search.documents.aio import SearchClient
    from azure.core.credentials import AzureKeyCredential

    endpoint = os.environ["AZURE_SEARCH_ENDPOINT"]
    index = "sep-agent-sop"
    key = os.environ["AZURE_SEARCH_KEY"]

    async with SearchClient(endpoint, index, AzureKeyCredential(key)) as sc:
        results = await sc.search(search_text=query, top=5)
        chunks = []
        async for r in results:
            chunks.append(r.get("content", r.get("text", "")))

    return "\n\n---\n\n".join(chunks) if chunks else "No relevant rules found."


async def calculate_enrollment_window(event_date: str, sep_type: str) -> dict:
    """
    Calculates whether today falls within the valid enrollment window
    for the given SEP type, based on the event date.
    Returns: { within_window: bool, days_elapsed: int, window_end_date: str }
    """
    event = datetime.strptime(event_date, "%Y-%m-%d").date()
    today = date.today()
    days_elapsed = (today - event).days

    # Window lengths by SEP type (in days). Source: SEP_AGENT_SOP.md
    windows = {
        "SEP-01-MA": 60,       # Loss of GHP — MA/Part D
        "SEP-01-PARTB": 240,   # Loss of GHP — Part A/B (8 months)
        "SEP-02": 90,          # Move (approx 3 months)
        "SEP-03": None,        # Dual Eligible — ongoing monthly
        "SEP-04": None,        # LIS — ongoing monthly
        "SEP-05": 90,          # Institutionalized (2 months post-discharge)
        "SEP-06": 365,         # Incarceration release (12 months)
        "SEP-07": None,        # Disaster — determined by declaration dates
        "SEP-08": None,        # 5-Star — fixed annual window Dec 8–Nov 30
        "SEP-09": 90,          # Plan termination
        "SEP-10": 90,          # Seamless conversion (3 months)
        "SEP-11": 60,          # Federal error (2 months from CMS notice)
        "SEP-12": None,        # Exceptional — CMS determines
        "SEP-13": None,        # SPAP — once per calendar year
        "SEP-14": 365,         # Trial period (12 months)
    }

    window_days = windows.get(sep_type)
    if window_days is None:
        return {"within_window": True, "days_elapsed": days_elapsed, "window_end_date": "ongoing"}

    from datetime import timedelta
    window_end = event + timedelta(days=window_days)
    return {
        "within_window": today <= window_end,
        "days_elapsed": days_elapsed,
        "window_end_date": window_end.isoformat(),
    }


async def check_standard_enrollment_periods() -> dict:
    """
    Returns which standard enrollment periods are currently active.
    """
    today = date.today()
    month, day = today.month, today.day

    aep_active = (month == 10 and day >= 15) or (month == 11) or (month == 12 and day <= 7)
    ma_oep_active = month in (1, 2, 3)

    return {
        "aep_active": aep_active,
        "ma_oep_active": ma_oep_active,
        "today": today.isoformat(),
    }


async def extract_document_fields(document_text: str) -> dict:
    """
    Extracts key fields from a submitted document:
    name, date_of_birth, event_date, coverage_end_date, issuer.
    """
    # In production this calls the OCR/NLP extraction pipeline.
    # Stub for illustration — replace with actual extraction service call.
    return {
        "name": None,
        "date_of_birth": None,
        "event_date": None,
        "coverage_end_date": None,
        "issuer": None,
        "raw_text_preview": document_text[:200],
    }


async def match_member_identity(extracted_fields: dict, mbi: str) -> dict:
    """
    Compares extracted document fields against the member's record
    (looked up by Medicare Beneficiary Identifier).
    Returns match confidence per field.
    """
    # In production this queries the member platform API.
    # Stub for illustration.
    return {
        "mbi": mbi,
        "name_match": "UNKNOWN",
        "dob_match": "UNKNOWN",
        "overall_confidence": "LOW",
        "notes": "Member platform lookup not yet wired.",
    }


# ---------------------------------------------------------------------------
# Executor dict — maps tool names used in sep_agent.yaml to callables above
# ---------------------------------------------------------------------------

executor_dict = {
    "search_sep_knowledge": search_sep_knowledge,
    "calculate_enrollment_window": calculate_enrollment_window,
    "check_standard_enrollment_periods": check_standard_enrollment_periods,
    "extract_document_fields": extract_document_fields,
    "match_member_identity": match_member_identity,
}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def process_sep_case(case: dict) -> dict:
    """
    Main entry point. Accepts a case dict and returns the SEP determination.

    case = {
        "member_id": str,
        "mbi": str,
        "qualifying_event": str,          # plain text description
        "event_date": str,                # ISO 8601 e.g. "2025-11-15"
        "submitted_documents": list[str], # document texts or file paths
        "broker_id": str | None,
    }
    """
    client = AsyncAIRefinery(api_key=os.environ["AIREFINERY_API_KEY"])

    query = (
        f"Evaluate this SEP case:\n"
        f"Member ID: {case['member_id']}\n"
        f"MBI: {case['mbi']}\n"
        f"Qualifying event: {case['qualifying_event']}\n"
        f"Event date: {case['event_date']}\n"
        f"Documents submitted: {len(case['submitted_documents'])} document(s)\n"
        f"Broker ID: {case.get('broker_id', 'None')}"
    )

    async with client.distiller(
        project="sep_agent",
        uuid=case["member_id"],
        executor_dict=executor_dict,
    ) as dc:
        # Inject the member's documents into session memory so agents can access them
        await dc.add_memory(
            source="env_variable",
            variables_dict={
                "submitted_documents": "\n\n---\n\n".join(case["submitted_documents"]),
                "member_id": case["member_id"],
                "mbi": case["mbi"],
            },
        )

        responses = await dc.query(query=query)
        result_text = ""
        async for response in responses:
            result_text += response.get("content", "")

    return {"member_id": case["member_id"], "determination": result_text}
