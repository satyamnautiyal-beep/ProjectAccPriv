"""
Shared utility functions used across agents and workflows.
"""
import json
import os
import re
from datetime import datetime, timezone, date
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# OEP CONFIG (ENV-DRIVEN)
OEP_START_DATE = os.getenv("OEP_START_DATE")  # YYYY-MM-DD
OEP_END_DATE = os.getenv("OEP_END_DATE")      # YYYY-MM-DD


# ---------------------------------------------------------------------------
# DATE / TIME HELPERS
# ---------------------------------------------------------------------------

def _utc_now_z() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------------------
# LLM RESPONSE HELPERS
# ---------------------------------------------------------------------------

def extract_json_from_llm(text: str) -> dict:
    """
    Robustly extract a JSON object from an LLM response.

    Handles:
    - Plain JSON:           {"key": "value"}
    - Markdown fenced:      ```json\\n{...}\\n```
    - Fenced without lang:  ```\\n{...}\\n```
    - JSON embedded in prose: some text {"key": "value"} more text
    - Escaped apostrophes:  {\\'key\\': \\'value\\'} (model quirk)

    Raises json.JSONDecodeError if no valid JSON object is found.
    """
    text = text.strip()

    # 1. Try the whole string first (fastest path for clean responses)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2. Strip markdown code fences and retry
    fenced = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    fenced = re.sub(r"\s*```\s*$", "", fenced).strip()
    try:
        return json.loads(fenced)
    except json.JSONDecodeError:
        pass

    # 3. Fix escaped apostrophes that some models emit (\' → ')
    fixed = fenced.replace("\\'", "'")
    try:
        return json.loads(fixed)
    except json.JSONDecodeError:
        pass

    # 4. Extract the first {...} block using regex (handles prose wrapping)
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        candidate = match.group(0)
        # Try as-is, then with apostrophe fix
        for attempt in (candidate, candidate.replace("\\'", "'")):
            try:
                return json.loads(attempt)
            except json.JSONDecodeError:
                pass

    raise json.JSONDecodeError("No valid JSON object found in LLM response", text, 0)


def _parse_date(d: Optional[str]) -> Optional[date]:
    if not d:
        return None
    return datetime.strptime(d, "%Y-%m-%d").date()


def is_within_oep(today: date) -> Optional[bool]:
    """
    True  -> within OEP
    False -> outside OEP
    None  -> OEP not configured
    """
    start = _parse_date(OEP_START_DATE)
    end = _parse_date(OEP_END_DATE)
    if not start or not end:
        return None
    return start <= today <= end


# ---------------------------------------------------------------------------
# DIFF HELPERS
# ---------------------------------------------------------------------------

def _deep_diff(a: Any, b: Any, path: str = "") -> List[Dict[str, Any]]:
    diffs: List[Dict[str, Any]] = []

    if type(a) != type(b):
        diffs.append({"path": path, "from": a, "to": b, "type": "type_change"})
        return diffs

    if isinstance(a, dict):
        keys = set(a.keys()) | set(b.keys())
        for k in sorted(keys):
            p = f"{path}.{k}" if path else k
            if k not in a:
                diffs.append({"path": p, "from": None, "to": b[k], "type": "added"})
            elif k not in b:
                diffs.append({"path": p, "from": a[k], "to": None, "type": "removed"})
            else:
                diffs.extend(_deep_diff(a[k], b[k], p))
        return diffs

    if isinstance(a, list):
        if a != b:
            diffs.append({"path": path, "from": a, "to": b, "type": "list_changed"})
        return diffs

    if a != b:
        diffs.append({"path": path, "from": a, "to": b, "type": "value_changed"})
    return diffs


# ---------------------------------------------------------------------------
# HISTORY HELPERS
# ---------------------------------------------------------------------------

def _sorted_history_dates(record: Dict[str, Any]) -> List[str]:
    return sorted((record.get("history") or {}).keys())


def _get_latest_two_snapshots(
    record: Dict[str, Any],
) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]], List[str]]:
    dates = _sorted_history_dates(record)
    if len(dates) == 0:
        return None, None, dates
    if len(dates) == 1:
        return record["history"][dates[-1]], None, dates
    return record["history"][dates[-1]], record["history"][dates[-2]], dates


# ---------------------------------------------------------------------------
# JSON FILE LOADERS
# ---------------------------------------------------------------------------

_DEFAULT_SEP_REQUIRED_DOCS = {
    "Permanent move / relocation": ["Proof of new address", "Date of move"],
    "Household change (marriage/birth/adoption/divorce)": ["Marriage certificate or birth/adoption record"],
    "Loss of coverage": ["Termination letter", "Prior coverage end"],
}
_DEFAULT_MOCK_SUBMITTED_DOCS = {
    "SUB123": ["Proof of new address"]
}


def _load_json_file(path: Path, default: Any) -> Tuple[Any, Optional[str]]:
    """
    Returns (data, warning). If file missing/invalid, returns (default, warning).
    """
    try:
        if not path.exists():
            return default, f"file_missing:{str(path)}"
        raw = path.read_text(encoding="utf-8")
        return json.loads(raw), None
    except Exception as e:
        return default, f"file_load_failed:{str(path)}:{type(e).__name__}:{str(e)}"
