"""
RenewalProcessorAgent — processes renewal members with deterministic math
followed by LLM reasoning for contextual judgment.

Pipeline:
  Stage 1 (deterministic) — extract coverage, calculate delta, classify priority
  Stage 2 (LLM)           — contextual review: proportionality, anomaly detection,
                             nuanced status recommendation, member-facing explanation

The LLM can override the deterministic priority when context warrants it:
  - Downgrade HIGH → MEDIUM if delta is large in absolute terms but tiny as a % of plan value
  - Upgrade MEDIUM → HIGH if member is on a low-cost plan where $30 is a significant burden
  - Flag data anomalies (prior_gross=0, APTC > gross, negative net premiums)
  - Produce a plain-English explanation a specialist can act on immediately
"""
import json
import os
from datetime import datetime as _dt
from typing import Any, Dict

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


def _calc_delta_pct(delta: float, prior_net: float) -> float:
    if prior_net != 0:
        return delta / prior_net * 100
    if delta != 0:
        return 100.0 if delta > 0 else -100.0
    return 0.0


def _classify_priority(abs_delta: float) -> str:
    if abs_delta > 50:
        return "HIGH"
    if abs_delta > 20:
        return "MEDIUM"
    return "LOW"


def _detect_anomalies(
    prior_gross: float, prior_aptc: float, prior_net: float,
    new_gross: float, new_aptc: float, new_net: float,
) -> list[str]:
    flags = []
    if prior_gross == 0 and prior_aptc > 0:
        flags.append("prior_gross_zero_with_aptc: prior gross premium is $0 but APTC is non-zero — possible data quality issue")
    if new_gross == 0 and new_aptc > 0:
        flags.append("new_gross_zero_with_aptc: new gross premium is $0 but APTC is non-zero — possible data quality issue")
    if prior_aptc > prior_gross > 0:
        flags.append("prior_aptc_exceeds_gross: prior APTC exceeds gross premium — APTC should not exceed plan cost")
    if new_aptc > new_gross > 0:
        flags.append("new_aptc_exceeds_gross: new APTC exceeds gross premium — APTC should not exceed plan cost")
    if prior_net < 0:
        flags.append(f"prior_net_negative: prior net premium is ${prior_net:.2f} — member was receiving more APTC than plan cost")
    if new_net < 0:
        flags.append(f"new_net_negative: new net premium is ${new_net:.2f} — member is receiving more APTC than plan cost")
    return flags


# ── LLM reasoning prompt ─────────────────────────────────────────────────────

_RENEWAL_SYSTEM_PROMPT = """You are a health insurance renewal specialist AI. You receive the output of a deterministic premium change calculator and apply contextual judgment.

Return ONLY a valid JSON object. No prose, no markdown, no explanation outside the JSON.

Output schema (all fields required, keep strings under 120 chars):
{
  "final_priority": "HIGH" | "MEDIUM" | "LOW",
  "final_status": "In Review" | "Enrolled",
  "override_reason": "short reason string or null",
  "anomaly_flags": ["short flag strings"],
  "specialist_note": "1 sentence for the specialist",
  "member_summary": "1 sentence for the member"
}

Priority rules:
- HIGH → In Review; MEDIUM/LOW → Enrolled (default)
- Override HIGH→MEDIUM only if delta_pct < 10% AND gross > $800 (large plan, small relative change)
- Override MEDIUM→HIGH if delta_pct > 35% even if abs delta < $50 (small plan, large relative change)
- Always flag anomalies (APTC > gross, negative net, zero gross with non-zero APTC)
- Keep specialist_note and member_summary under 120 characters each"""


def _build_renewal_llm_prompt(
    member_name: str,
    subscriber_id: str,
    prior_gross: float, prior_aptc: float, prior_net: float,
    new_gross: float, new_aptc: float, new_net: float,
    delta: float, delta_pct: float,
    deterministic_priority: str,
    deterministic_status: str,
    anomalies: list[str],
    coverage_start: str,
    plan_code: str,
) -> str:
    return f"""Renewal case for {member_name} ({subscriber_id}), effective {coverage_start}.

DETERMINISTIC CALCULATION:
  Prior year:   Gross ${prior_gross:.2f}, APTC ${prior_aptc:.2f}, Net ${prior_net:.2f}
  Current year: Gross ${new_gross:.2f}, APTC ${new_aptc:.2f}, Net ${new_net:.2f}
  Delta:        ${delta:+.2f} ({delta_pct:+.1f}% change in net premium)
  Plan code:    {plan_code or "unknown"}

DETERMINISTIC RESULT:
  Priority: {deterministic_priority}
  Status:   {deterministic_status}
  Threshold logic: HIGH if |delta| > $50, MEDIUM if > $20, LOW otherwise

ANOMALIES DETECTED BY CALCULATOR:
{chr(10).join(f"  - {a}" for a in anomalies) if anomalies else "  None"}

Apply contextual judgment and return your assessment as JSON."""


# ── Agent ────────────────────────────────────────────────────────────────────

@register_agent("RenewalProcessorAgent")
async def RenewalProcessorAgent(query: str, **kwargs) -> str:
    """
    Input JSON:
    {
        "subscriber_id": "REN00001",
        "member": { ...full member doc from MongoDB... }
    }

    Output JSON:
    {
        "subscriber_id": "REN00001",
        "root_status_recommended": "In Review" | "Enrolled",
        "plain_english_summary": "...",
        "renewal_analysis": {
            "prior_gross": 800.0, "prior_aptc": 400.0, "prior_net": 400.0,
            "new_gross": 750.0, "new_aptc": 500.0, "new_net": 250.0,
            "delta": -150.0, "delta_pct": -37.5,
            "deterministic_priority": "HIGH",
            "final_priority": "HIGH",
            "override_reason": null,
            "anomaly_flags": [],
            "specialist_note": "...",
            "coverage_start_date": "2026-05-01"
        }
    }
    """
    payload = {}
    try:
        payload = json.loads(query)
        subscriber_id = payload.get("subscriber_id", "")
        member = payload.get("member", payload)

        # ── Stage 1: Deterministic math ──────────────────────────────────────
        coverage = _extract_coverage(member)
        if not coverage:
            return json.dumps({
                "subscriber_id": subscriber_id,
                "root_status_recommended": "Processing Failed",
                "plain_english_summary": "Renewal processing failed: no coverage data found in member record.",
                "renewal_analysis": None,
            })

        member_info   = _extract_member_info(member)
        member_name   = f"{member_info.get('first_name', '')} {member_info.get('last_name', '')}".strip() or subscriber_id
        prior_aptc    = float(coverage.get("prior_aptc")         or 0)
        prior_gross   = float(coverage.get("prior_gross_premium") or 0)
        new_aptc      = float(coverage.get("aptc")               or 0)
        new_gross     = float(coverage.get("gross_premium")      or 0)
        coverage_start = coverage.get("coverage_start_date", "")
        plan_code     = coverage.get("plan_code", "")

        prior_net = prior_gross - prior_aptc
        new_net   = new_gross   - new_aptc
        delta     = new_net - prior_net
        delta_pct = _calc_delta_pct(delta, prior_net)
        det_priority = _classify_priority(abs(delta))
        det_status   = "In Review" if det_priority == "HIGH" else "Enrolled"
        anomalies    = _detect_anomalies(prior_gross, prior_aptc, prior_net, new_gross, new_aptc, new_net)

        # ── Stage 2: LLM contextual reasoning ───────────────────────────────
        api_key = (
            os.getenv("AI_REFINERY_KEY")
            or os.getenv("AI_REFINERY_API_KEY")
            or os.getenv("API_KEY")
        )

        llm_result = None
        llm_error = None

        if api_key:
            try:
                from air import AsyncAIRefinery
                client = AsyncAIRefinery(api_key=api_key)

                user_prompt = _build_renewal_llm_prompt(
                    member_name, subscriber_id,
                    prior_gross, prior_aptc, prior_net,
                    new_gross, new_aptc, new_net,
                    delta, delta_pct,
                    det_priority, det_status,
                    anomalies, coverage_start, plan_code,
                )

                response = await client.chat.completions.create(
                    messages=[
                        {"role": "system", "content": _RENEWAL_SYSTEM_PROMPT},
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
            final_priority    = llm_result.get("final_priority", det_priority)
            final_status      = llm_result.get("final_status", det_status)
            override_reason   = llm_result.get("override_reason")
            extra_anomalies   = llm_result.get("anomaly_flags") or []
            specialist_note   = llm_result.get("specialist_note", "")
            member_summary    = llm_result.get("member_summary", "")
            all_anomalies     = list(dict.fromkeys(anomalies + extra_anomalies))  # dedupe, preserve order
        else:
            # Fallback to deterministic if LLM unavailable
            final_priority  = det_priority
            final_status    = det_status
            override_reason = None
            all_anomalies   = anomalies
            specialist_note = ""
            member_summary  = ""

        # Build plain-English summary (prefer LLM member_summary, fall back to template)
        if member_summary:
            plain_summary = member_summary
        elif final_priority == "HIGH":
            plain_summary = (
                f"Renewal flagged for specialist review: HIGH priority premium change "
                f"${delta:+.2f} ({delta_pct:+.1f}%). "
                f"Prior net: ${prior_net:.2f}, New net: ${new_net:.2f}."
            )
        else:
            plain_summary = (
                f"Renewal approved: {final_priority} priority premium change "
                f"${delta:+.2f} ({delta_pct:+.1f}%). "
                f"Effective {coverage_start}."
            )

        if specialist_note:
            plain_summary = f"{plain_summary} {specialist_note}"

        return json.dumps({
            "subscriber_id": subscriber_id,
            "root_status_recommended": final_status,
            "plain_english_summary": plain_summary,
            "renewal_analysis": {
                "prior_gross":            prior_gross,
                "prior_aptc":             prior_aptc,
                "prior_net":              prior_net,
                "new_gross":              new_gross,
                "new_aptc":               new_aptc,
                "new_net":                new_net,
                "delta":                  delta,
                "delta_pct":              delta_pct,
                "deterministic_priority": det_priority,
                "final_priority":         final_priority,
                "override_reason":        override_reason,
                "anomaly_flags":          all_anomalies,
                "specialist_note":        specialist_note,
                "coverage_start_date":    coverage_start,
                "plan_code":              plan_code,
                "llm_error":              llm_error,
            },
        })

    except Exception as e:
        return json.dumps({
            "subscriber_id": payload.get("subscriber_id") if isinstance(payload, dict) else None,
            "root_status_recommended": "Processing Failed",
            "plain_english_summary": f"RenewalProcessorAgent error: {e}",
            "renewal_analysis": None,
        })
