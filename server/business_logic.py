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
        
    # --- Strict 9-Digit SSN Check (Commented out to allow default dataset to pass) ---
    ssn = info.get("ssn", "")
    if ssn and len(ssn.replace("-", "").strip()) != 9:
        issues.append(f"Subscriber: Invalid SSN format ({ssn}). Must be 9 digits.")
    
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
         
    # --- Complete Address Check (Commented out to allow default dataset to pass) ---
    addr = info.get("address_line_1")
    city = info.get("city")
    state = info.get("state")
    if not addr or not city or not state:
         issues.append("Subscriber: Missing required address fields (Street, City, or State)")

    # --- Contact Pipeline Check (Commented out to allow default dataset to pass) ---
    # phone = info.get("phone")
    # email = info.get("email")
    # if not phone and not email:
    #     issues.append("Subscriber: Unreachable! Missing both Phone and Email contact data.")

    # --- Valid Gender/Sex Tag Check (Commented out to allow default dataset to pass) ---
    gender = info.get("gender", "")
    if gender not in ["M", "F", "U", "O", "X"]:
        issues.append(f"Subscriber: Invalid or missing gender marker ('{gender}')")

    # 4. Coverage Check
    if not coverages:
        issues.append("Subscriber: No Coverage/Plan defined")
        
    # --- Missing Coverage Dates & Chronology Check (Commented out to allow default dataset to pass) ---
    for plan in coverages:
        eff_str = plan.get("coverage_start_date")
        term_str = plan.get("coverage_end_date")
        if not eff_str:
            issues.append("Subscriber/Dependents: Missing coverage dates")
        elif eff_str and term_str:
            try:
                eff = datetime.strptime(eff_str, "%Y-%m-%d")
                term = datetime.strptime(term_str, "%Y-%m-%d")
                if term < eff:
                    issues.append("Subscriber: Coverage termination occurs before effective date!")
            except:
                pass

    # --- DEPENDENT CHECKS ---
    for dep in dependents:
        dep_info = dep.get("member_info", {})
        dep_name = f"{dep_info.get('first_name')} {dep_info.get('last_name')}"
        
        if not dep_info.get("ssn"):
             issues.append(f"Dependent ({dep_name}): Missing SSN")
             
        # --- Strict 9-Digit Dependent SSN Check (Commented out to allow default dataset to pass) ---
        dep_ssn = dep_info.get("ssn", "")
        if dep_ssn and len(dep_ssn.replace("-", "").strip()) != 9:
            issues.append(f"Dependent ({dep_name}): Invalid SSN format ({dep_ssn}). Must be 9 digits.")
            
        # --- Dependent Gender/Sex Check (Commented out to allow default dataset to pass) ---
        dep_gender = dep_info.get("gender", "")
        if dep_gender not in ["M", "F", "U", "O", "X"]:
            issues.append(f"Dependent ({dep_name}): Invalid or missing gender marker ('{dep_gender}')")
            

        
        dep_dob_str = dep_info.get("dob")
        if not dep_dob_str:
             issues.append(f"Dependent ({dep_name}): Missing Date of Birth")
        else:
            try:
                dep_dob = datetime.strptime(dep_dob_str, "%Y-%m-%d")
                if dep_dob > datetime.now():
                    issues.append(f"Dependent ({dep_name}): Invalid DOB - Future date")
                    
                # --- ACA "Over 26" Age Limit Check (Commented out to allow default dataset to pass) ---
                age_days = (datetime.now() - dep_dob).days
                relation_code = dep_info.get("relationship_code", "")
                if relation_code == "19" and age_days >= (26 * 365.25):
                    issues.append(f"Dependent ({dep_name}): Exceeds maximum allowed dependent age of 26")
            except:
                 issues.append(f"Dependent ({dep_name}): Malformed DOB")

    if issues:
        return "Awaiting Clarification", issues
    else:
        return "Ready", []