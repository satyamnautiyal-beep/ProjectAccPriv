import json
from datetime import datetime
from typing import Dict, Any, List, Tuple


# ===================== AGENT REGISTRATION =====================

def register_agent(name: str):
    """Decorator to register an agent."""
    def decorator(func):
        return func
    return decorator


@register_agent("BusinessValidator")
async def BusinessValidator(query: str) -> str:
    """
    Validates business rules and data consistency.
    Wraps existing validate_member_record() function.
    
    Input:
    {
        "parsed_data": {...},
        "file_type": "edi_834",
        "subscriber_context": {...}
    }
    
    Output:
    {
        "success": true,
        "business_metadata": {
            "member_count": 5,
            "coverage_count": 8,
            "validation_errors": [],
            "validation_warnings": []
        }
    }
    """
    try:
        payload = json.loads(query)
        parsed_data = payload.get("parsed_data", {})
        file_type = payload.get("file_type", "edi_834")
        
        # Initialize business metadata
        business_metadata = {
            "file_type": file_type,
            "member_count": 0,
            "coverage_count": 0,
            "total_premium": 0.0,
            "date_range": {
                "earliest_effective": None,
                "latest_effective": None
            },
            "is_within_oep": True,
            "has_duplicates": False,
            "has_conflicts": False,
            "validation_errors": [],
            "validation_warnings": []
        }
        
        # For EDI 834 files
        if file_type == "edi_834":
            transactions = parsed_data.get("transactions", [])
            seen_members = set()
            
            for transaction in transactions:
                for member in transaction.get("members", []):
                    # Use existing validation function
                    status, issues = validate_member_record(member)
                    
                    # Collect errors and warnings
                    for issue in issues:
                        if issue["severity"] == "FATAL":
                            business_metadata["validation_errors"].append(issue["message"])
                        else:
                            business_metadata["validation_warnings"].append(issue["message"])
                    
                    # Check for duplicates
                    member_id = member.get("member_info", {}).get("subscriber_id")
                    if member_id in seen_members:
                        business_metadata["has_duplicates"] = True
                        business_metadata["validation_errors"].append(
                            f"Duplicate member found: {member_id}"
                        )
                    seen_members.add(member_id)
                    
                    # Count members and coverages
                    business_metadata["member_count"] += 1
                    coverages = member.get("coverages", [])
                    business_metadata["coverage_count"] += len(coverages)
                    
                    # Track premium and dates
                    for coverage in coverages:
                        gross = coverage.get("gross_premium")
                        if gross:
                            try:
                                business_metadata["total_premium"] += float(gross)
                            except (ValueError, TypeError):
                                pass
                        
                        start_date = coverage.get("coverage_start_date")
                        end_date = coverage.get("coverage_end_date")
                        
                        if start_date:
                            if not business_metadata["date_range"]["earliest_effective"] or \
                               start_date < business_metadata["date_range"]["earliest_effective"]:
                                business_metadata["date_range"]["earliest_effective"] = start_date
                        
                        if end_date:
                            if not business_metadata["date_range"]["latest_effective"] or \
                               end_date > business_metadata["date_range"]["latest_effective"]:
                                business_metadata["date_range"]["latest_effective"] = end_date
        
        # For retro requests
        elif file_type == "retro_request":
            # Validate retro-specific business rules
            retro_date = parsed_data.get("retro_effective_date")
            auth_source = parsed_data.get("auth_source")
            
            # Validate retro date
            if retro_date:
                try:
                    retro_dt = datetime.strptime(retro_date, "%Y-%m-%d")
                    if retro_dt > datetime.now():
                        business_metadata["validation_errors"].append(
                            "Retroactive date cannot be in the future"
                        )
                    if (datetime.now() - retro_dt).days > 365:
                        business_metadata["validation_errors"].append(
                            "Retroactive date cannot be more than 1 year in the past"
                        )
                except ValueError:
                    business_metadata["validation_errors"].append(
                        "Invalid retro date format. Use YYYY-MM-DD"
                    )
            
            # Validate authorization
            if not auth_source:
                business_metadata["validation_errors"].append(
                    "Authorization source is required"
                )
            elif not (auth_source.startswith("HICS-") or auth_source.startswith("INTERNAL-")):
                business_metadata["validation_errors"].append(
                    f"Invalid authorization source: {auth_source}"
                )
            
            business_metadata["member_count"] = 1
        
        # Check if there are fatal errors
        if business_metadata["validation_errors"]:
            return json.dumps({
                "success": False,
                "validation_errors": business_metadata["validation_errors"],
                "business_metadata": business_metadata
            })
        
        return json.dumps({
            "success": True,
            "business_metadata": business_metadata
        })
    
    except json.JSONDecodeError as e:
        return json.dumps({
            "success": False,
            "error": f"Invalid JSON input: {str(e)}"
        })
    except Exception as e:
        return json.dumps({
            "success": False,
            "error": f"Business validation error: {str(e)}"
        })


# ===================== EXISTING VALIDATION FUNCTIONS =====================

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
