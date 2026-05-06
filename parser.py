import json
from datetime import datetime


def format_date(date_str):
    try:
        if date_str and len(date_str) == 8:
            return datetime.strptime(date_str, "%Y%m%d").strftime("%Y-%m-%d")
        return None
    except Exception:
        return None


def parse_edi(edi_text):
    segments = [seg.strip() for seg in edi_text.strip().split("~") if seg.strip()]

    file_metadata = {
        "sender_id": None,
        "receiver_id": None,
        "file_date": None,
        "file_time": None,
        "control_number": None,
        "test_indicator": None,
        "group_control_number": None,
        "transaction_version": None
    }

    transactions = []
    current_transaction = None
    current_subscriber = None
    current_member = None
    
    # Store renewal signals that appear before INS segment
    pending_renewal_signals = {}

    employer = {}
    insurer = {}

    for seg in segments:
        elements = [e.strip() for e in seg.split("*")]
        if not elements:
            continue

        seg_id = elements[0]

        # ===================== FILE LEVEL =====================

        if seg_id == "ISA" and len(elements) > 15:
            file_metadata["sender_id"] = elements[6]
            file_metadata["receiver_id"] = elements[8]
            file_metadata["file_date"] = format_date("20" + elements[9])
            file_metadata["file_time"] = elements[10]
            file_metadata["control_number"] = elements[13]
            file_metadata["test_indicator"] = elements[15]

        elif seg_id == "GS" and len(elements) > 8:
            file_metadata["group_control_number"] = elements[6]
            file_metadata["transaction_version"] = elements[8]

        # ===================== TRANSACTION =====================

        elif seg_id == "ST":
            if current_transaction:
                if current_member:
                    if current_member["_is_sub"]:
                        current_subscriber = current_member
                    elif current_subscriber:
                        current_subscriber.setdefault("dependents", []).append(current_member)

                if current_subscriber:
                    current_transaction["members"].append(current_subscriber)

                transactions.append(current_transaction)

            current_transaction = {
                "transaction_metadata": {
                    "transaction_id": elements[2] if len(elements) > 2 else None,
                    "policy_id": None,
                    "insurer_group_id": None,
                    "effective_date": None
                },
                "members": []
            }

            current_subscriber = None
            current_member = None

        # ===================== EMPLOYER / INSURER =====================

        elif seg_id == "N1" and len(elements) > 2:
            if elements[1] == "P5":
                employer = {
                    "employer_name": elements[2],
                    "employer_id": elements[4] if len(elements) > 4 else None
                }
            elif elements[1] == "IN":
                insurer = {
                    "insurer_name": elements[2],
                    "insurer_id": elements[4] if len(elements) > 4 else None
                }

        # ===================== MEMBER LOOP =====================

        elif seg_id == "INS" and len(elements) > 3:
            if current_member:
                if current_member["_is_sub"]:
                    current_subscriber = current_member
                elif current_subscriber:
                    current_subscriber.setdefault("dependents", []).append(current_member)

            is_sub = elements[1] == "Y"

            current_member = {
                "_is_sub": is_sub,
                "member_info": {
                    "subscriber_indicator": elements[1],
                    "relationship_code": elements[2],
                    "maintenance_type": elements[3],  # ✅ FIXED (was wrongly named employment_status)
                    "subscriber_id": None,
                    "first_name": None,
                    "last_name": None,
                    "ssn": None,
                    "dob": None,
                    "gender": None,
                    "address_line_1": None,
                    "city": None,
                    "state": None,
                    "zip": None,
                    **employer,
                    **insurer
                },
                "coverages": [],
                "_pending_ref": pending_renewal_signals.copy()  # Apply any pending renewal signals
            }
            pending_renewal_signals = {}  # Reset for next member

        elif seg_id == "REF" and len(elements) > 2:
            if elements[1] == "38" and current_transaction:
                current_transaction["transaction_metadata"]["policy_id"] = elements[2]
            elif elements[1] == "6P" and current_transaction:
                current_transaction["transaction_metadata"]["insurer_group_id"] = elements[2]
            elif elements[1] == "0F" and current_member:
                current_member["member_info"]["subscriber_id"] = elements[2]
            
            # NEW: Renewal-specific REF codes - store in pending until member is created
            elif elements[1] == "1L":  # Prior year APTC
                pending_renewal_signals["prior_aptc"] = elements[2]
            
            elif elements[1] == "1M":  # Prior year premium
                pending_renewal_signals["prior_gross_premium"] = elements[2]

        elif seg_id == "NM1" and current_member and len(elements) > 4:
            if elements[1] in ("IL", "03"):
                info = current_member["member_info"]
                info["last_name"] = elements[3].title()
                info["first_name"] = elements[4].title()
                info["ssn"] = elements[9] if len(elements) > 9 else None

        elif seg_id == "N3" and current_member:
            current_member["member_info"]["address_line_1"] = elements[1]

        elif seg_id == "N4" and current_member:
            info = current_member["member_info"]
            info["city"] = elements[1] if len(elements) > 1 else None
            info["state"] = elements[2] if len(elements) > 2 else None
            info["zip"] = elements[3] if len(elements) > 3 else None

        elif seg_id == "DMG" and current_member and len(elements) > 3:
            info = current_member["member_info"]
            info["dob"] = format_date(elements[2])
            info["gender"] = elements[3]

        # ===================== COVERAGE =====================

        elif seg_id == "HD" and current_member:
            coverage = {
                "coverage_type": elements[1] if len(elements) > 1 else None,
                "plan_code": elements[3] if len(elements) > 3 else None,
                "coverage_start_date": None,
                "coverage_end_date": None,
                # NEW: Renewal-specific fields
                "gross_premium": None,
                "aptc": None,
                "prior_gross_premium": None,
                "prior_aptc": None
            }
            # Apply any pending REF values (renewal signals from earlier in the file)
            if current_member.get("_pending_ref"):
                for key, value in current_member["_pending_ref"].items():
                    coverage[key] = value
                current_member["_pending_ref"] = {}
            
            current_member["coverages"].append(coverage)

        elif seg_id == "DTP" and len(elements) > 3:
            if elements[1] == "348" and current_member and current_member["coverages"]:
                current_member["coverages"][-1]["coverage_start_date"] = format_date(elements[3])

            elif elements[1] == "349" and current_member and current_member["coverages"]:
                current_member["coverages"][-1]["coverage_end_date"] = format_date(elements[3])

            elif elements[1] == "303" and current_transaction:
                current_transaction["transaction_metadata"]["effective_date"] = format_date(elements[3])

        # ===================== RENEWAL-SPECIFIC: AMOUNTS =====================

        elif seg_id == "AMT" and current_member and len(elements) > 2:
            """
            AMT segment contains monetary amounts.
            Qualifier codes:
            - B9 = APTC (Advanced Premium Tax Credit)
            - B10 = Net premium (member responsibility after APTC)
            - AAE = Gross premium
            - AAD = Prior year gross premium
            """
            if current_member["coverages"]:
                coverage = current_member["coverages"][-1]
                
                if elements[1] == "B9":  # Current APTC
                    coverage["aptc"] = elements[2] if len(elements) > 2 else None
                
                elif elements[1] == "B10":  # Current net premium (member responsibility)
                    # Net premium = Gross premium - APTC
                    # So: Gross premium = Net premium + APTC
                    net_premium = float(elements[2]) if len(elements) > 2 else 0
                    aptc = float(coverage.get("aptc") or 0)
                    coverage["gross_premium"] = str(net_premium + aptc)
                
                elif elements[1] == "AAE":  # Current gross premium
                    coverage["gross_premium"] = elements[2] if len(elements) > 2 else None
                
                elif elements[1] == "AAD":  # Prior year gross premium
                    coverage["prior_gross_premium"] = elements[2] if len(elements) > 2 else None

    # ===================== FINAL FLUSH =====================

    if current_member:
        if current_member["_is_sub"]:
            current_subscriber = current_member
        elif current_subscriber:
            current_subscriber.setdefault("dependents", []).append(current_member)

    if current_subscriber and current_transaction:
        current_transaction["members"].append(current_subscriber)

    if current_transaction:
        transactions.append(current_transaction)

    return {
        "file_metadata": file_metadata,
        "transactions": transactions
    }