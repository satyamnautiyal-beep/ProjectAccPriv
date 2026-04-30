from datetime import datetime


def _fatal(message):
    return {"message": message, "severity": "FATAL"}


def _warning(message):
    return {"message": message, "severity": "WARNING"}


def validate_member_record(member_doc):
    """
    Performs business-level validation on a member document (subscriber + dependents).
    Returns a status ('Ready' or 'Awaiting Clarification') and a list of structured
    issue dicts, each with 'message' (str) and 'severity' ('FATAL' or 'WARNING').

    FATAL issues block enrollment → "Awaiting Clarification".
    WARNING issues are non-blocking → status stays "Ready" if no FATAL present.
    """
    issues = []

    latest_date = member_doc.get("latest_update")
    if not latest_date or not member_doc.get("history") or latest_date not in member_doc["history"]:
        return "Cannot Process", [_fatal("No data snapshots found")]

    data = member_doc["history"][latest_date]
    info = data.get("member_info", {})
    dependents = data.get("dependents", [])
    coverages = data.get("coverages", [])

    # -----------------------------------------------------------------------
    # SUBSCRIBER CHECKS
    # -----------------------------------------------------------------------

    # 1. Name
    first = (info.get("first_name") or "").strip()
    last = (info.get("last_name") or "").strip()
    if not first or not last:
        missing = []
        if not first:
            missing.append("first name")
        if not last:
            missing.append("last name")
        issues.append(_fatal(f"Subscriber: Missing {' and '.join(missing)}"))

    # 2. SSN
    ssn = (info.get("ssn") or "").replace("-", "").strip()
    if not ssn:
        issues.append(_fatal("Subscriber: Missing SSN"))
    elif len(ssn) != 9:
        issues.append(_fatal(f"Subscriber: Invalid SSN format — must be 9 digits (got {len(ssn)})"))

    # 3. Date of Birth
    dob_str = info.get("dob")
    if not dob_str:
        issues.append(_fatal("Subscriber: Missing Date of Birth"))
    else:
        try:
            dob = datetime.strptime(dob_str, "%Y-%m-%d")
            if dob > datetime.now():
                issues.append(_fatal(f"Subscriber: Invalid DOB ({dob_str}) — future date"))
        except Exception:
            issues.append(_fatal(f"Subscriber: Malformed DOB ({dob_str})"))

    # 4. Address — FATAL (state required for plan assignment; address required for mailing)
    addr = (info.get("address_line_1") or "").strip()
    city = (info.get("city") or "").strip()
    state = (info.get("state") or "").strip()
    missing_addr = [f for f, v in [("street", addr), ("city", city), ("state", state)] if not v]
    if missing_addr:
        issues.append(_fatal(f"Subscriber: Missing address fields — {', '.join(missing_addr)}"))

    # 5. Gender — WARNING (non-blocking; EDI 834 allows "U" for Unknown)
    gender = info.get("gender", "")
    if gender not in ["M", "F", "U", "O", "X"]:
        issues.append(_warning(f"Subscriber: Invalid or missing gender marker ('{gender}')"))

    # 6. Coverage
    if not coverages:
        issues.append(_fatal("Subscriber: No coverage/plan defined"))
    else:
        for plan in coverages:
            eff_str = plan.get("coverage_start_date")
            term_str = plan.get("coverage_end_date")
            if not eff_str:
                issues.append(_fatal("Subscriber: Missing coverage start date"))
            elif eff_str and term_str:
                try:
                    eff = datetime.strptime(eff_str, "%Y-%m-%d")
                    term = datetime.strptime(term_str, "%Y-%m-%d")
                    if term < eff:
                        issues.append(_fatal("Subscriber: Coverage end date is before start date"))
                except Exception:
                    pass

    # -----------------------------------------------------------------------
    # DEPENDENT CHECKS
    # -----------------------------------------------------------------------
    for dep in dependents:
        dep_info = dep.get("member_info", {})
        dep_first = (dep_info.get("first_name") or "").strip()
        dep_last = (dep_info.get("last_name") or "").strip()
        dep_label = f"{dep_first} {dep_last}".strip() or f"Dependent ({dep_info.get('subscriber_id', 'unknown')})"

        # Name
        if not dep_first or not dep_last:
            missing = []
            if not dep_first:
                missing.append("first name")
            if not dep_last:
                missing.append("last name")
            issues.append(_fatal(f"Dependent ({dep_label}): Missing {' and '.join(missing)}"))

        # SSN
        dep_ssn = (dep_info.get("ssn") or "").replace("-", "").strip()
        if not dep_ssn:
            issues.append(_fatal(f"Dependent ({dep_label}): Missing SSN"))
        elif len(dep_ssn) != 9:
            issues.append(_fatal(f"Dependent ({dep_label}): Invalid SSN format — must be 9 digits"))

        # Gender — WARNING (non-blocking)
        dep_gender = dep_info.get("gender", "")
        if dep_gender not in ["M", "F", "U", "O", "X"]:
            issues.append(_warning(f"Dependent ({dep_label}): Invalid or missing gender marker ('{dep_gender}')"))

        # DOB
        dep_dob_str = dep_info.get("dob")
        if not dep_dob_str:
            issues.append(_fatal(f"Dependent ({dep_label}): Missing Date of Birth"))
        else:
            try:
                dep_dob = datetime.strptime(dep_dob_str, "%Y-%m-%d")
                if dep_dob > datetime.now():
                    issues.append(_fatal(f"Dependent ({dep_label}): Invalid DOB — future date"))
                # ACA over-26 child check
                age_days = (datetime.now() - dep_dob).days
                if dep_info.get("relationship_code") == "19" and age_days >= (26 * 365.25):
                    issues.append(_fatal(f"Dependent ({dep_label}): Exceeds maximum dependent age of 26"))
            except Exception:
                issues.append(_fatal(f"Dependent ({dep_label}): Malformed DOB ({dep_dob_str})"))

    # -----------------------------------------------------------------------
    # STATUS DERIVATION
    # -----------------------------------------------------------------------
    # Any FATAL present → "Awaiting Clarification"
    # WARNING-only (no FATAL) → "Ready" (issues list still populated with warnings)
    # No issues → "Ready", []
    if any(issue["severity"] == "FATAL" for issue in issues):
        return "Awaiting Clarification", issues
    return "Ready", issues
