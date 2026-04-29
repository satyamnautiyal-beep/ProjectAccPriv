from datetime import datetime


def validate_member_record(member_doc):
    """
    Performs business-level validation on a member document (subscriber + dependents).
    Returns a status ('Ready' or 'Awaiting Clarification') and a list of issues found.
    """
    issues = []

    latest_date = member_doc.get("latest_update")
    if not latest_date or not member_doc.get("history") or latest_date not in member_doc["history"]:
        return "Cannot Process", ["No data snapshots found"]

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
        issues.append(f"Subscriber: Missing {' and '.join(missing)}")

    # 2. SSN
    ssn = (info.get("ssn") or "").replace("-", "").strip()
    if not ssn:
        issues.append("Subscriber: Missing SSN")
    elif len(ssn) != 9:
        issues.append(f"Subscriber: Invalid SSN format — must be 9 digits (got {len(ssn)})")

    # 3. Date of Birth
    dob_str = info.get("dob")
    if not dob_str:
        issues.append("Subscriber: Missing Date of Birth")
    else:
        try:
            dob = datetime.strptime(dob_str, "%Y-%m-%d")
            if dob > datetime.now():
                issues.append(f"Subscriber: Invalid DOB ({dob_str}) — future date")
        except Exception:
            issues.append(f"Subscriber: Malformed DOB ({dob_str})")

    # 4. Address
    addr = (info.get("address_line_1") or "").strip()
    city = (info.get("city") or "").strip()
    state = (info.get("state") or "").strip()
    missing_addr = [f for f, v in [("street", addr), ("city", city), ("state", state)] if not v]
    if missing_addr:
        issues.append(f"Subscriber: Missing address fields — {', '.join(missing_addr)}")

    # 5. Gender
    gender = info.get("gender", "")
    if gender not in ["M", "F", "U", "O", "X"]:
        issues.append(f"Subscriber: Invalid or missing gender marker ('{gender}')")

    # 6. Coverage
    if not coverages:
        issues.append("Subscriber: No coverage/plan defined")
    else:
        for plan in coverages:
            eff_str = plan.get("coverage_start_date")
            term_str = plan.get("coverage_end_date")
            if not eff_str:
                issues.append("Subscriber: Missing coverage start date")
            elif eff_str and term_str:
                try:
                    eff = datetime.strptime(eff_str, "%Y-%m-%d")
                    term = datetime.strptime(term_str, "%Y-%m-%d")
                    if term < eff:
                        issues.append("Subscriber: Coverage end date is before start date")
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
            issues.append(f"Dependent ({dep_label}): Missing {' and '.join(missing)}")

        # SSN
        dep_ssn = (dep_info.get("ssn") or "").replace("-", "").strip()
        if not dep_ssn:
            issues.append(f"Dependent ({dep_label}): Missing SSN")
        elif len(dep_ssn) != 9:
            issues.append(f"Dependent ({dep_label}): Invalid SSN format — must be 9 digits")

        # Gender
        dep_gender = dep_info.get("gender", "")
        if dep_gender not in ["M", "F", "U", "O", "X"]:
            issues.append(f"Dependent ({dep_label}): Invalid or missing gender marker ('{dep_gender}')")

        # DOB
        dep_dob_str = dep_info.get("dob")
        if not dep_dob_str:
            issues.append(f"Dependent ({dep_label}): Missing Date of Birth")
        else:
            try:
                dep_dob = datetime.strptime(dep_dob_str, "%Y-%m-%d")
                if dep_dob > datetime.now():
                    issues.append(f"Dependent ({dep_label}): Invalid DOB — future date")
                # ACA over-26 child check
                age_days = (datetime.now() - dep_dob).days
                if dep_info.get("relationship_code") == "19" and age_days >= (26 * 365.25):
                    issues.append(f"Dependent ({dep_label}): Exceeds maximum dependent age of 26")
            except Exception:
                issues.append(f"Dependent ({dep_label}): Malformed DOB ({dep_dob_str})")

    if issues:
        return "Awaiting Clarification", issues
    return "Ready", []
