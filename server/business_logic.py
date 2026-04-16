from datetime import datetime

def validate_member_record(member_doc):
    """
    Performs Business-Level validation on a member document (Subscriber + Dependents).
    Returns a status ('Ready' or 'Awaiting Clarification') and a list of issues found.
    """
    issues = []
    
    # We check the latest history snapshot
    latest_date = member_doc.get("latest_update")
    if not latest_date or not member_doc.get("history") or latest_date not in member_doc["history"]:
        return "Cannot Process", ["No data snapshots found"]
    
    data = member_doc["history"][latest_date]
    info = data.get("member_info", {})
    dependents = data.get("dependents", [])
    coverages = data.get("coverages", [])

    # --- SUBSCRIBER CHECKS ---
    
    # 1. SSN Check
    if not info.get("ssn"):
        issues.append("Subscriber: Missing SSN")
    
    # 2. DOB Check
    dob_str = info.get("dob")
    if not dob_str:
        issues.append("Subscriber: Missing Date of Birth")
    else:
        try:
            dob = datetime.strptime(dob_str, "%Y-%m-%d")
            if dob > datetime.now():
                issues.append(f"Subscriber: Invalid DOB ({dob_str}) - Future date")
        except:
             issues.append(f"Subscriber: Malformed DOB ({dob_str})")

    # 3. Address Check
    if not info.get("address_line_1") or not info.get("city"):
         issues.append("Subscriber: Incomplete Address")

    # 4. Coverage Check
    if not coverages:
        issues.append("Subscriber: No Coverage/Plan defined")

    # --- DEPENDENT CHECKS ---
    for dep in dependents:
        dep_info = dep.get("member_info", {})
        dep_name = f"{dep_info.get('first_name')} {dep_info.get('last_name')}"
        
        if not dep_info.get("ssn"):
             issues.append(f"Dependent ({dep_name}): Missing SSN")
        
        dep_dob_str = dep_info.get("dob")
        if not dep_dob_str:
             issues.append(f"Dependent ({dep_name}): Missing Date of Birth")
        else:
            try:
                dep_dob = datetime.strptime(dep_dob_str, "%Y-%m-%d")
                if dep_dob > datetime.now():
                    issues.append(f"Dependent ({dep_name}): Invalid DOB - Future date")
            except:
                 issues.append(f"Dependent ({dep_name}): Malformed DOB")

    if issues:
        return "Awaiting Clarification", issues
    else:
        return "Ready", []
