import glob
import os
import json
from datetime import datetime


def format_date(date_str):
    try:
        return datetime.strptime(date_str, "%Y%m%d").strftime("%Y-%m-%d")
    except:
        return None


def parse_edi(edi_text):
    segments = [seg.strip() for seg in edi_text.strip().split("~") if seg.strip()]

    # -----------------------------
    # FILE LEVEL (ISA / GS)
    # -----------------------------
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

    for seg in segments:
        elements = [e.strip() for e in seg.split("*")]
        seg_id = elements[0]

        # -----------------------------
        # ISA (File Metadata)
        # -----------------------------
        if seg_id == "ISA":
            file_metadata["sender_id"] = elements[6]
            file_metadata["receiver_id"] = elements[8]
            file_metadata["file_date"] = format_date("20" + elements[9])
            file_metadata["file_time"] = elements[10]
            file_metadata["control_number"] = elements[13]
            file_metadata["test_indicator"] = elements[15]

        # -----------------------------
        # GS (Group Metadata)
        # -----------------------------
        elif seg_id == "GS":
            file_metadata["group_control_number"] = elements[6]
            file_metadata["transaction_version"] = elements[8]

        # -----------------------------
        # ST (Start Transaction)
        # -----------------------------
        elif seg_id == "ST":
            if current_transaction:
                transactions.append(current_transaction)

            current_transaction = {
                "transaction_metadata": {
                    "transaction_id": elements[2],
                    "transaction_type": elements[1],
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
            meta["reference_number"] = elements[2]
            meta["transaction_date"] = format_date(elements[3])
            meta["transaction_time"] = elements[4]
            meta["transaction_action"] = elements[8] if len(elements) > 8 else None

        # -----------------------------
        # REF (Policy)
        # -----------------------------
        elif seg_id == "REF" and elements[1] == "38":
            current_transaction["transaction_metadata"]["policy_id"] = elements[2]

        # -----------------------------
        # DTP (File Effective Date)
        # -----------------------------
        elif seg_id == "DTP" and elements[1] == "303":
            current_transaction["transaction_metadata"]["file_effective_date"] = format_date(elements[3])

        # -----------------------------
        # N1 (Employer / Insurer)
        # -----------------------------
        elif seg_id == "N1":
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

        # -----------------------------
        # INS (New Member)
        # -----------------------------
        elif seg_id == "INS":
            if current_member:
                current_transaction["members"].append(current_member)

            current_member = {
                "member_info": {
                    "subscriber_indicator": elements[1],
                    "relationship_code": elements[2],
                    "employment_status": elements[3],
                    "student_status": elements[4] if len(elements) > 4 else None,
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
        # REF (Subscriber ID)
        # -----------------------------
        elif seg_id == "REF" and elements[1] == "0F":
            current_member["member_info"]["subscriber_id"] = elements[2]

        # -----------------------------
        # NM1 (Name)
        # -----------------------------
        elif seg_id == "NM1" and elements[1] == "IL":
            info = current_member["member_info"]
            info["last_name"] = elements[3].title()
            info["first_name"] = elements[4].title()
            info["ssn"] = elements[9] if len(elements) > 9 else None

        # -----------------------------
        # DMG (Demographics)
        # -----------------------------
        elif seg_id == "DMG":
            info = current_member["member_info"]
            info["dob"] = format_date(elements[2])
            info["gender"] = elements[3]

        # -----------------------------
        # HD (Coverage)
        # -----------------------------
        elif seg_id == "HD":
            current_coverage = {
                "coverage_type": elements[1],
                "plan_code": elements[3] if len(elements) > 3 else None,
                "coverage_start_date": None,
                "coverage_end_date": None
            }

        # -----------------------------
        # DTP (Coverage Dates)
        # -----------------------------
        elif seg_id == "DTP":
            if elements[1] == "348":
                current_coverage["coverage_start_date"] = format_date(elements[3])
            elif elements[1] == "349":
                current_coverage["coverage_end_date"] = format_date(elements[3])

            if current_coverage:
                current_member["coverages"].append(current_coverage)
                current_coverage = None

        # -----------------------------
        # SE (Transaction Trailer)
        # -----------------------------
        elif seg_id == "SE":
            current_transaction["transaction_metadata"]["segment_count"] = elements[1]

    # finalize last objects
    if current_member:
        current_transaction["members"].append(current_member)

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

    # Determine starting sequential number just for today's folder
    existing_jsons = glob.glob(f"{run_output_folder}/EDI_834_MEMBER_*.json")
    max_num = 0
    for ej in existing_jsons:
        filename = os.path.basename(ej)
        try:
            num = int(filename.replace("EDI_834_MEMBER_", "").replace(".json", ""))
            if num > max_num:
                max_num = num
        except ValueError:
            pass
            
    next_num = max_num + 1

    for file in files:
        with open(file, "r") as f:
            edi_text = f.read()
            parsed = parse_edi(edi_text)

        # Generate sequential filename inside the run folder
        base_name = f"EDI_834_MEMBER_{next_num:04d}.json"
        next_num += 1

        output_path = os.path.join(run_output_folder, base_name)

        # Save JSON file
        with open(output_path, "w") as out_file:
            json.dump(parsed, out_file, indent=2)

        print(f"Saved: {output_path}")
        
        # Delete original file
        try:
            os.remove(file)
            print(f"Deleted original: {file}")
        except Exception as e:
            print(f"Error deleting {file}: {e}")

if __name__ == "__main__":
    process_all_files()