import mysql.connector
import json
import glob
import os

from dotenv import load_dotenv
load_dotenv()

def insert_json_to_db(conn, json_data):
    cursor = conn.cursor()

    fm = json_data["file_metadata"]

    cursor.execute("""
    INSERT INTO file_metadata (
        sender_id, receiver_id, file_date, file_time,
        control_number, test_indicator, group_control_number, transaction_version
    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    """, (
        fm["sender_id"], fm["receiver_id"], fm["file_date"], fm["file_time"],
        fm["control_number"], fm["test_indicator"],
        fm["group_control_number"], fm["transaction_version"]
    ))

    file_id = cursor.lastrowid

    for txn in json_data["transactions"]:
        meta = txn["transaction_metadata"]

        cursor.execute("""
        INSERT INTO transactions (
            file_id, transaction_id, transaction_type, reference_number,
            transaction_date, transaction_time, transaction_action,
            policy_id, file_effective_date, segment_count
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            file_id,
            meta["transaction_id"],
            meta["transaction_type"],
            meta["reference_number"],
            meta["transaction_date"],
            meta["transaction_time"],
            meta["transaction_action"],
            meta["policy_id"],
            meta["file_effective_date"],
            meta["segment_count"]
        ))

        txn_id = cursor.lastrowid

        for member in txn["members"]:
            info = member["member_info"]

            cursor.execute("""
            INSERT INTO members (
                transaction_id, subscriber_id, first_name, last_name,
                ssn, dob, gender, employer_name, employer_id,
                insurer_name, insurer_id, relationship_code, employment_status
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                txn_id,
                info["subscriber_id"],
                info["first_name"],
                info["last_name"],
                info["ssn"],
                info["dob"],
                info["gender"],
                info["employer_name"],
                info["employer_id"],
                info["insurer_name"],
                info["insurer_id"],
                info["relationship_code"],
                info["employment_status"]
            ))

            member_id = cursor.lastrowid

            for cov in member["coverages"]:
                cursor.execute("""
                INSERT INTO coverages (
                    member_id, coverage_type, plan_code,
                    coverage_start_date, coverage_end_date
                ) VALUES (%s, %s, %s, %s, %s)
                """, (
                    member_id,
                    cov["coverage_type"],
                    cov["plan_code"],
                    cov["coverage_start_date"],
                    cov["coverage_end_date"]
                ))

    conn.commit()


def process_json_files():
    # Use project root as base, not the db folder
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    parsed_base = os.path.join(project_root, "parsed_data")

    if not os.path.exists(parsed_base):
        print("No parsed_data folder found.")
        return

    # Find the newest date folder
    subdirs = [d for d in os.listdir(parsed_base) 
               if os.path.isdir(os.path.join(parsed_base, d))]
    
    import re
    date_folders = [d for d in subdirs if re.match(r"^\d{4}-\d{2}-\d{2}$", d)]

    if not date_folders:
        print("No processed date folders found in parsed_data/.")
        return

    # Sort descending to natively get the most recent date string
    date_folders.sort(reverse=True)
    latest_folder_name = date_folders[0]
    latest_folder = os.path.join(parsed_base, latest_folder_name)

    files = glob.glob(os.path.join(latest_folder, "*.json"))

    print(f"Found Run Batch for Date: {latest_folder_name}. Processing {len(files)} files...")

    if not files:
        print(f"No JSON files found in folder: {latest_folder}")
        return

    conn = mysql.connector.connect(
        host=os.getenv("DB_HOST"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        database=os.getenv("DB_NAME")
    )

    for file in files:
        if os.path.getsize(file) == 0:
            print(f"Skipping empty file: {file}")
            continue

        with open(file, "r") as f:
            try:
                json_data = json.load(f)
            except json.JSONDecodeError:
                print(f"Skipping invalid JSON file: {file}")
                continue

        #print(f"Inserting: {file}")
        insert_json_to_db(conn, json_data)

    conn.close()
    print("✅ Data inserted successfully!")


if __name__ == "__main__":
    process_json_files()


