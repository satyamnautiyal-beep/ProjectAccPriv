"""
Input sanitizer — strips PII and internal DB fields before sending to Distiller.
"""
import copy
from typing import Any, Dict


def build_engine_input(record: dict) -> dict:
    """
    Removes internal DB fields (_id) and strips PII (ssn, dob) from
    subscriber + dependents before sending to Distiller.
    """
    r = copy.deepcopy(record)

    # Remove internal DB id
    r.pop("_id", None)

    history = r.get("history") or {}
    for _, snap in history.items():
        # Subscriber PII
        mi = snap.get("member_info") or {}
        mi.pop("ssn", None)
        mi.pop("dob", None)

        # Dependent PII
        for dep in (snap.get("dependents") or []):
            dmi = dep.get("member_info") or {}
            dmi.pop("ssn", None)
            dmi.pop("dob", None)

    return r
