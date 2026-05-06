"""
RetroEnrollmentOrchestratorAgent — processes retroactive coverage members with
deterministic liability calculation followed by LLM risk assessment.

Pipeline:
  Stage 1 (deterministic) — extract coverage, calculate retroactive period,
                             compute liability, build APTC table
  Stage 2 (LLM)           — risk assessment: evaluate whether the retroactive
                             period is unusual, whether liability is proportionate,
                             detect APTC/data quality issues, produce compliance-aware
                             recommendation with specialist-actionable reasoning

The LLM can override the deterministic outcome when context warrants it:
  - Approve low-liability cases (< $50 total) that the calculator flags as "In Review"
  - Escalate cases with very long retroactive periods (> 6 months) even if liability is zero
  - Flag APTC > gross as a data quality issue requiring investigation before enrollment
  - Produce a compliance-aware note the specialist can use to justify their decision
"""
import json
import os
from datetime import datetime as _dt
from typing import Any, Dict, List

from dotenv import load_dotenv

from .base import register_agent
from ..core.utils import extract_json_from_llm

load_dotenv()

# ── Deterministic helpers ────────────────────────────────────────────────────

def _extract_coverage(member: Dict[str, Any]) -> Dict[str, Any] | None:
    latest_date = member.get("latest_update")
    snapshot = (member.get("history") or {}).get(latest_date, {})
    coverages = snapshot.get("coverages") or []
    return coverages[0] if coverages else None


def _extract_member_info(member: Dict[str, Any]) -> Dict[str, Any]:
    latest_date = member.get("latest_update")
    snapshot = (member.get("history") or {}).get(latest_date, {})
    return snapshot.get("member_info") or {}


def _build_aptc_table(
    coverage_start: str,
    gross_premium: float,
    aptc: float,
    today: _dt,
) -> List[Dict[str, Any]]:
    """Month-by-month APTC reconciliation from coverage_start to today."""
    try:
        retro_date = _dt.strptime(coverage_start, "%Y-%m-%d")
    except ValueError:
        return []

    table = []
    current = retro_date
    while current <= today:
        net = gross_premium - aptc
        table.append({
            "month":         current.strftime("%Y-%m"),
            "gross_premium": gross_premium,
            "aptc":          aptc,
            "net_premium":   net,
        })
        month = current.month + 1
        year  = current.year + (1 if month > 12 else 0)
        month = month if month <= 12 else 1
        current = current.replace(year=year, month=month)
    return table


def _detect_anomalies(
    gross_premium: float,
    aptc: float,
    monthly_net: float,
    months_back: int,
    total_liability: float,
) -> list[str]:
    flags = []
    if aptc > gross_premium > 0:
        flags.append(
            f"aptc_exceeds_gross: APTC ${aptc:.2f} exceeds gross premium ${gross_premium:.2f} "
            f"— APTC should never exceed plan cost; investigate before enrolling"
        )
    if gross_premium == 0 and aptc > 0:
        flags.append(
            f"gross_premium_zero: Gross premium is $0 but APTC is ${aptc:.2f} "
            f"— possible missing premium data in EDI file"
        )
    if months_back > 12:
        flags.append(
            f"long_retroactive_period: {months_back} months retroactive exceeds 12-month threshold "
            f"— unusual; verify authorization is still valid"
        )
    if months_back > 6:
        flags.append(
            f"extended_retroactive_period: {months_back} months retroactive — "
            f"review authorization source and confirm member eligibility throughout period"
        )
    if monthly_net < 0:
        flags.append(
            f"negative_monthly_net: Monthly net is ${monthly_net:.2f} "
            f"— APTC exceeds gross; member would receive a net credit each month"
        )
    if abs(total_liability) > 5000:
        flags.append(
            f"high_liability_amount: Total liability ${abs(total_liability):.2f} exceeds $5,000 "
            f"— high-value case requiring senior specialist review"
        )
    return flags


# ── LLM reasoning prompt ─────────────────────────────────────────────────────

_RETRO_SYSTEM_PROMPT = """You are a health insurance retroactive enrollment specialist AI. You receive the output of a deterministic liability calculator and apply risk-based judgment.

Return ONLY a valid JSON object. No prose, no markdown, no explanation outside the JSON.

Output schema (all fields required, keep strings under 120 chars):
{
  "final_status": "In Review" | "Enrolled",
  "risk_level": "LOW" | "MEDIUM" | "HIGH",
  "override_reason": "short reason string or null",
  "anomaly_flags": ["short flag strings"],
  "compliance_note": "1 sentence on ACA compliance",
  "specialist_note": "1 sentence for the specialist",
  "member_summary": "1 sentence for the member"
}

Rules:
- Default: liability != 0 → In Review; liability == 0 → Enrolled
- Override to Enrolled if: liability > 0 AND total < $50 AND months <= 3 AND no anomalies
- Override to In Review if: liability == 0 BUT (months > 6 OR APTC > gross OR gross == 0)
- risk_level: LOW = clean short period; MEDIUM = some concerns; HIGH = anomalies/long period/high liability
- Keep all string fields under 120 characters"""


def _build_retro_llm_prompt(
    member_name: str,
    subscriber_id: str,
    coverage_start: str,
    gross_premium: float,
    aptc: float,
    monthly_net: float,
    months_back: int,
    total_liability: float,
    liability_reason: str,
    deterministic_status: str,
    anomalies: list[str],
    aptc_table_len: int,
    today_str: str,
    plan_code: str,
    state: str,
) -> str:
    return f"""Retroactive enrollment case for {member_name} ({subscriber_id}).

DETERMINISTIC CALCULATION:
  Coverage start date:    {coverage_start}
  Today's date:           {today_str}
  Retroactive period:     {months_back} month(s)
  Plan code:              {plan_code or "unknown"}
  Member state:           {state or "unknown"}

  Monthly gross premium:  ${gross_premium:.2f}
  Monthly APTC:           ${aptc:.2f}
  Monthly net (member):   ${monthly_net:.2f}

  Total liability:        ${total_liability:.2f}
  Liability reason:       {liability_reason}
  APTC table entries:     {aptc_table_len}

DETERMINISTIC RESULT:
  Status: {deterministic_status}
  Logic: liability == 0 → Enrolled; liability != 0 → In Review

ANOMALIES DETECTED BY CALCULATOR:
{chr(10).join(f"  - {a}" for a in anomalies) if anomalies else "  None"}

Apply risk-based judgment and return your assessment as JSON."""


# ── Agent ────────────────────────────────────────────────────────────────────

@register_agent("RetroEnrollmentOrchestratorAgent")
async def RetroEnrollmentOrchestratorAgent(query: str, **kwargs) -> str:
    """
    Input JSON:
    {
        "subscriber_id": "RET00001",
        "member": { ...full member doc from MongoDB... }
    }

    Output JSON:
    {
        "subscriber_id": "RET00001",
        "root_status_recommended": "In Review" | "Enrolled",
        "plain_english_summary": "...",
        "retro_analysis": {
            "coverage_start_date": "2026-03-01",
            "months_retroactive": 2,
            "gross_premium": 0.0,
            "aptc": 300.0,
            "monthly_net": -300.0,
            "total_liability": -600.0,
            "aptc_table": [...],
            "liability_reason": "overpayment" | "member_owes" | "fully_covered",
            "risk_level": "LOW" | "MEDIUM" | "HIGH",
            "override_reason": null,
            "anomaly_flags": [],
            "compliance_note": "...",
            "specialist_note": "..."
        }
    }
    """
    payload = {}
    try:
        payload = json.loads(query)
        subscriber_id = payload.get("subscriber_id", "")
        member = payload.get("member", payload)

        # ── Stage 1: Deterministic calculation ───────────────────────────────
        coverage = _extract_coverage(member)
        if not coverage:
            return json.dumps({
                "subscriber_id": subscriber_id,
                "root_status_recommended": "Processing Failed",
                "plain_english_summary": "Retro processing failed: no coverage data found in member record.",
                "retro_analysis": None,
            })

        member_info    = _extract_member_info(member)
        member_name    = f"{member_info.get('first_name', '')} {member_info.get('last_name', '')}".strip() or subscriber_id
        state          = member_info.get("state", "")
        coverage_start = coverage.get("coverage_start_date", "")
        gross_premium  = float(coverage.get("gross_premium") or 0)
        aptc           = float(coverage.get("aptc")          or 0)
        plan_code      = coverage.get("plan_code", "")

        if not coverage_start:
            return json.dumps({
                "subscriber_id": subscriber_id,
                "root_status_recommended": "Processing Failed",
                "plain_english_summary": "Retro processing failed: coverage start date missing.",
                "retro_analysis": None,
            })

        today = _dt.now()
        try:
            retro_date = _dt.strptime(coverage_start, "%Y-%m-%d")
        except ValueError:
            return json.dumps({
                "subscriber_id": subscriber_id,
                "root_status_recommended": "Processing Failed",
                "plain_english_summary": f"Retro processing failed: invalid coverage start date '{coverage_start}'.",
                "retro_analysis": None,
            })

        months_back     = (today.year - retro_date.year) * 12 + (today.month - retro_date.month)
        monthly_net     = gross_premium - aptc
        total_liability = monthly_net * months_back
        aptc_table      = _build_aptc_table(coverage_start, gross_premium, aptc, today)
        anomalies       = _detect_anomalies(gross_premium, aptc, monthly_net, months_back, total_liability)

        if total_liability == 0:
            liability_reason = "fully_covered"
            det_status = "Enrolled"
        elif total_liability < 0:
            liability_reason = "overpayment"
            det_status = "In Review"
        else:
            liability_reason = "member_owes"
            det_status = "In Review"

        # ── Stage 2: LLM risk assessment ─────────────────────────────────────
        api_key = (
            os.getenv("AI_REFINERY_KEY")
            or os.getenv("AI_REFINERY_API_KEY")
            or os.getenv("API_KEY")
        )

        llm_result = None
        llm_error  = None

        if api_key:
            try:
                from air import AsyncAIRefinery
                client = AsyncAIRefinery(api_key=api_key)

                user_prompt = _build_retro_llm_prompt(
                    member_name, subscriber_id,
                    coverage_start, gross_premium, aptc, monthly_net,
                    months_back, total_liability, liability_reason,
                    det_status, anomalies, len(aptc_table),
                    today.strftime("%Y-%m-%d"), plan_code, state,
                )

                response = await client.chat.completions.create(
                    messages=[
                        {"role": "system", "content": _RETRO_SYSTEM_PROMPT},
                        {"role": "user",   "content": user_prompt},
                    ],
                    model="openai/gpt-oss-120b",
                    temperature=0.1,
                    max_completion_tokens=800,
                )

                raw = response.choices[0].message.content or ""
                llm_result = extract_json_from_llm(raw)

            except Exception as e:
                llm_error = str(e)

        # ── Stage 3: Merge deterministic + LLM results ───────────────────────
        if llm_result:
            final_status     = llm_result.get("final_status", det_status)
            risk_level       = llm_result.get("risk_level", "MEDIUM")
            override_reason  = llm_result.get("override_reason")
            extra_anomalies  = llm_result.get("anomaly_flags") or []
            compliance_note  = llm_result.get("compliance_note", "")
            specialist_note  = llm_result.get("specialist_note", "")
            member_summary   = llm_result.get("member_summary", "")
            all_anomalies    = list(dict.fromkeys(anomalies + extra_anomalies))
        else:
            final_status    = det_status
            risk_level      = "HIGH" if anomalies or months_back > 6 else ("MEDIUM" if total_liability != 0 else "LOW")
            override_reason = None
            all_anomalies   = anomalies
            compliance_note = ""
            specialist_note = ""
            member_summary  = ""

        # Build plain-English summary
        if member_summary:
            plain_summary = member_summary
        elif liability_reason == "fully_covered":
            plain_summary = (
                f"Retro coverage approved: {months_back} month(s) retroactive effective {coverage_start}. "
                f"Member fully covered by APTC — no liability."
            )
        elif liability_reason == "overpayment":
            plain_summary = (
                f"Retro coverage flagged: {months_back} month(s) retroactive, "
                f"overpayment ${abs(total_liability):.2f}. "
                f"Awaiting specialist review for refund processing."
            )
        else:
            plain_summary = (
                f"Retro coverage processed: {months_back} month(s) retroactive effective {coverage_start}. "
                f"Member liability ${total_liability:.2f}. "
                f"Awaiting specialist approval for exchange submission."
            )

        if specialist_note:
            plain_summary = f"{plain_summary} {specialist_note}"

        return json.dumps({
            "subscriber_id": subscriber_id,
            "root_status_recommended": final_status,
            "plain_english_summary": plain_summary,
            "retro_analysis": {
                "coverage_start_date":  coverage_start,
                "months_retroactive":   months_back,
                "gross_premium":        gross_premium,
                "aptc":                 aptc,
                "monthly_net":          monthly_net,
                "total_liability":      total_liability,
                "aptc_table":           aptc_table,
                "liability_reason":     liability_reason,
                "risk_level":           risk_level,
                "override_reason":      override_reason,
                "anomaly_flags":        all_anomalies,
                "compliance_note":      compliance_note,
                "specialist_note":      specialist_note,
                "plan_code":            plan_code,
                "state":                state,
                "llm_error":            llm_error,
            },
        })

    except Exception as e:
        return json.dumps({
            "subscriber_id": payload.get("subscriber_id") if isinstance(payload, dict) else None,
            "root_status_recommended": "Processing Failed",
            "plain_english_summary": f"RetroEnrollmentOrchestratorAgent error: {e}",
            "retro_analysis": None,
        })
