"""
Input sanitization — strips PII and Mongo internals before sending to Distiller.
"""
import copy
from typing import Any


def build_engine_input(record: dict) -> dict:
    """
    Removes Mongo _id and strips PII (ssn, dob) from subscriber + dependents
    before sending to Distiller.
    """
    r = copy.deepcopy(record)

    # Remove Mongo internal id (ObjectId or {"$oid": "..."} export)
    r.pop("_id", None)

    history = r.get("history") or {}
    for _, snap in history.items():
        # subscriber PII
        mi = snap.get("member_info") or {}
        mi.pop("ssn", None)
        mi.pop("dob", None)

        # dependents PII
        for dep in (snap.get("dependents") or []):
            dmi = dep.get("member_info") or {}
            dmi.pop("ssn", None)
            dmi.pop("dob", None)

    return r
