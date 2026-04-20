import glob
import os
import json
from datetime import datetime
from io import StringIO

from pyx12.x12context import X12ContextReader
from pyx12.params import params
from pyx12.error_handler import errh_null


def format_date(date_str):
    try:
        return datetime.strptime(date_str, "%Y%m%d").strftime("%Y-%m-%d")
    except:
        return None


def safe_get(node, key):
    try:
        return node.get_value(key)
    except:
        return None


def parse_edi(edi_text):
    param = params()
    errh = errh_null()

    reader = X12ContextReader(param, errh, StringIO(edi_text))

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
    current_member = None
    current_coverage = None

    employer = {}
    insurer = {}

    for node in reader.iter_segments():
        seg_id = node.id

        # -----------------------------
        # ISA
        # -----------------------------
        if seg_id == "ISA":
            file_metadata["sender_id"] = safe_get(node, "ISA06")
            file_metadata["receiver_id"] = safe_get(node, "ISA08")
            file_metadata["file_date"] = format_date("20" + safe_get(node, "ISA09"))
            file_metadata["file_time"] = safe_get(node, "ISA10")
            file_metadata["control_number"] = safe_get(node, "ISA13")
            file_metadata["test_indicator"] = safe_get(node, "ISA15")

        # -----------------------------
        # GS
        # -----------------------------
        elif seg_id == "GS":
            file_metadata["group_control_number"] = safe_get(node, "GS06")
            file_metadata["transaction_version"] = safe_get(node, "GS08")

        # -----------------------------
        # ST
        # -----------------------------
        elif seg_id == "ST":
            if current_transaction:
                transactions.append(current_transaction)

            current_transaction = {
                "transaction_metadata": {
                    "transaction_id": safe_get(node, "ST02"),
                    "transaction_type": safe_get(node, "ST01"),
                    "reference_number": None,
                    "transaction_date": None,
                    "transaction_time": None,
                    "transaction_action": None,
                    "policy_id": None,
                    "file_effective_date": None,
                    "segment_count": None
                },
                "members": []
            }

        # -----------------------------
        # BGN
        # -----------------------------
        elif seg_id == "BGN":
            meta = current_transaction["transaction_metadata"]
            meta["reference_number"] = safe_get(node, "BGN02")
            meta["transaction_date"] = format_date(safe_get(node, "BGN03"))
            meta["transaction_time"] = safe_get(node, "BGN04")
            meta["transaction_action"] = safe_get(node, "BGN08")

        # -----------------------------
        # REF
        # -----------------------------
        elif seg_id == "REF":
            if safe_get(node, "REF01") == "38":
                current_transaction["transaction_metadata"]["policy_id"] = safe_get(node, "REF02")

            elif safe_get(node, "REF01") == "0F" and current_member:
                current_member["member_info"]["subscriber_id"] = safe_get(node, "REF02")

        # -----------------------------
        # DTP
        # -----------------------------
        elif seg_id == "DTP":
            code = safe_get(node, "DTP01")

            if code == "303":
                current_transaction["transaction_metadata"]["file_effective_date"] = format_date(
                    safe_get(node, "DTP03")
                )

            elif code == "348" and current_coverage:
                current_coverage["coverage_start_date"] = format_date(safe_get(node, "DTP03"))

            elif code == "349" and current_coverage:
                current_coverage["coverage_end_date"] = format_date(safe_get(node, "DTP03"))

        # -----------------------------
        # N1
        # -----------------------------
        elif seg_id == "N1":
            if safe_get(node, "N101") == "P5":
                employer = {
                    "employer_name": safe_get(node, "N102"),
                    "employer_id": safe_get(node, "N104")
                }
            elif safe_get(node, "N101") == "IN":
                insurer = {
                    "insurer_name": safe_get(node, "N102"),
                    "insurer_id": safe_get(node, "N104")
                }

        # -----------------------------
        # INS
        # -----------------------------
        elif seg_id == "INS":
            if current_member:
                if current_coverage:
                    current_member["coverages"].append(current_coverage)
                    current_coverage = None

                current_transaction["members"].append(current_member)

            current_member = {
                "member_info": {
                    "subscriber_indicator": safe_get(node, "INS01"),
                    "relationship_code": safe_get(node, "INS02"),
                    "employment_status": safe_get(node, "INS03"),
                    "student_status": safe_get(node, "INS04"),
                    "subscriber_id": None,
                    "first_name": None,
                    "last_name": None,
                    "ssn": None,
                    "dob": None,
                    "gender": None,
                    **employer,
                    **insurer
                },
                "coverages": []
            }

        # -----------------------------
        # NM1
        # -----------------------------
        elif seg_id == "NM1" and safe_get(node, "NM101") == "IL":
            info = current_member["member_info"]
            info["last_name"] = (safe_get(node, "NM103") or "").title()
            info["first_name"] = (safe_get(node, "NM104") or "").title()
            info["ssn"] = safe_get(node, "NM109")

        # -----------------------------
        # DMG
        # -----------------------------
        elif seg_id == "DMG":
            info = current_member["member_info"]
            info["dob"] = format_date(safe_get(node, "DMG02"))
            info["gender"] = safe_get(node, "DMG03")

        # -----------------------------
        # HD
        # -----------------------------
        elif seg_id == "HD":
            if current_coverage:
                current_member["coverages"].append(current_coverage)

            current_coverage = {
                "coverage_type": safe_get(node, "HD01"),
                "plan_code": safe_get(node, "HD03"),
                "coverage_start_date": None,
                "coverage_end_date": None
            }

        # -----------------------------
        # SE
        # -----------------------------
        elif seg_id == "SE":
            if current_coverage:
                current_member["coverages"].append(current_coverage)
                current_coverage = None

            if current_member:
                current_transaction["members"].append(current_member)
                current_member = None

            current_transaction["transaction_metadata"]["segment_count"] = safe_get(node, "SE01")

    if current_transaction:
        transactions.append(current_transaction)

    return {
        "file_metadata": file_metadata,
        "transactions": transactions
    }


def process_all_files():
    input_folder = "data/EDI_834_DATA"
    base_output_folder = "parsed_data"

    os.makedirs(base_output_folder, exist_ok=True)

    files = glob.glob(f"{input_folder}/**/*.edi", recursive=True)
    if not files:
        print("No .edi files found to process.")
        return

    today_str = datetime.now().strftime("%Y-%m-%d")
    run_output_folder = os.path.join(base_output_folder, today_str)
    os.makedirs(run_output_folder, exist_ok=True)

    existing_jsons = glob.glob(f"{run_output_folder}/EDI_834_MEMBER_*.json")
    max_num = 0
    for ej in existing_jsons:
        try:
            num = int(os.path.basename(ej).split("_")[-1].replace(".json", ""))
            max_num = max(max_num, num)
        except:
            pass

    next_num = max_num + 1

    for file in files:
        with open(file, "r") as f:
            edi_text = f.read()
            parsed = parse_edi(edi_text)

        output_path = os.path.join(
            run_output_folder,
            f"EDI_834_MEMBER_{next_num:04d}.json"
        )
        next_num += 1

        with open(output_path, "w") as out_file:
            json.dump(parsed, out_file, indent=2)

        print(f"Saved: {output_path}")

        try:
            os.remove(file)
        except Exception as e:
            print(f"Error deleting {file}: {e}")


if __name__ == "__main__":
    process_all_files()