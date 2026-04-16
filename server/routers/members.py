import json
import os
import random
import time
import datetime
from fastapi import APIRouter
from server.routers.files import get_todays_dir, get_statuses, generate_random_name

router = APIRouter(prefix="/api")

def get_members_file():
    return os.path.join(get_todays_dir(), "members.json")

def read_members():
    mf = get_members_file()
    if os.path.exists(mf):
        with open(mf, "r") as f:
            return json.load(f)
    return []

def write_members(members):
    with open(get_members_file(), "w") as f:
        json.dump(members, f)

@router.get("/members")
def get_members():
    return read_members()

@router.post("/parse-members")
def parse_members():
    import sys
    sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))
    try:
        from parser import parse_edi
    except ImportError:
        parse_edi = None

    statuses = get_statuses()
    target_dir = get_todays_dir()

    today_str = datetime.datetime.now().strftime("%Y-%m-%d")
    parsed_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "parsed_data", today_str))
    os.makedirs(parsed_dir, exist_ok=True)
    
    if parse_edi:
        for fname, st in statuses.items():
            if st.get("status") == "Healthy":
                out_name = fname.replace(".edi", ".json")
                out_path = os.path.join(parsed_dir, out_name)
                if not os.path.exists(out_path):
                    filepath = os.path.join(target_dir, fname)
                    if os.path.exists(filepath):
                        try:
                            with open(filepath, "r") as f:
                                edi_text = f.read()
                            parsed_data = parse_edi(edi_text)
                            with open(out_path, "w") as jf:
                                json.dump(parsed_data, jf, indent=2)
                        except Exception as e:
                            print(f"Error executing parse_edi for {fname}: {e}")

    members = read_members()
    existing_file_ids = set(m.get("fileId") for m in members)
    
    from server.routers.clarifications import read_clarifications, write_clarifications
    clarifications = read_clarifications()
    
    new_members_count = 0
    
    for fname in os.listdir(parsed_dir):
        if fname.endswith(".json") and fname not in existing_file_ids:
            filepath = os.path.join(parsed_dir, fname)
            try:
                with open(filepath, 'r') as f:
                    parsed_json = json.load(f)
                    
                for t in parsed_json.get("transactions", []):
                    action = t.get("transaction_metadata", {}).get("transaction_action")
                    etype = "New Enrollment"
                    if action == "2": etype = "Updates"
                    if action == "4": etype = "Updates"
                    if action == "3": etype = "Termination"
                    
                    for m in t.get("members", []):
                        minfo = m.get("member_info", {})
                        
                        mstatus = "Ready"
                        needs_clari = False
                        missing_fields = []
                        if not minfo.get("ssn"): missing_fields.append("SSN Missing")
                        if not minfo.get("dob"): missing_fields.append("DOB Missing")
                        
                        if missing_fields:
                            mstatus = "Awaiting Input"
                            needs_clari = True
                            
                        member_id = minfo.get("subscriber_id")
                        if not member_id:
                            member_id = f"MEM-{int(time.time()*1000)}-{random.randint(1000,9999)}"
                            
                        first = minfo.get("first_name") or ""
                        last = minfo.get("last_name") or ""
                        name = f"{first} {last}".strip() or "UNKNOWN MEMBER"
                        
                        new_member = {
                            "id": member_id,
                            "name": name,
                            "enrollmentType": etype,
                            "status": mstatus,
                            "needsClarification": needs_clari,
                            "fileId": fname
                        }
                        members.insert(0, new_member)
                        new_members_count += 1
                        
                        if needs_clari:
                            for issue in missing_fields:
                                clarifications.insert(0, {
                                    "id": f"CLR-{int(time.time()*1000)}-{random.randint(10000,99999)}",
                                    "memberId": member_id,
                                    "memberName": name,
                                    "issueType": issue,
                                    "status": 'Awaiting Response'
                                })
            except Exception as e:
                print(f"Error parsing json {fname}: {e}")
                
    write_members(members)
    write_clarifications(clarifications)
    return {"parsed": new_members_count}
