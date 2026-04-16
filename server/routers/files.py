from fastapi import APIRouter, UploadFile, File, HTTPException
import os
import time
import json
import random
from datetime import datetime
from db.mongo_connection import save_member_to_mongo
from parser import parse_edi

router = APIRouter(prefix="/api")

def generate_random_name():
    # Note: random removed to simplify, using static for now or could re-import
    return "New Batch"

def get_todays_dir():
    # from datetime import datetime was used, so we use datetime.now()
    today_str = datetime.now().strftime("%Y-%m-%d")
    from server.database import DATA_DIR
    target_dir = os.path.join(DATA_DIR, today_str)
    os.makedirs(target_dir, exist_ok=True)
    return target_dir

def get_statuses():
    target_dir = get_todays_dir()
    status_path = os.path.join(target_dir, "statuses.json")
    if os.path.exists(status_path):
        with open(status_path, "r") as f:
            return json.load(f)
    return {}

def save_statuses(statuses):
    target_dir = get_todays_dir()
    status_path = os.path.join(target_dir, "statuses.json")
    with open(status_path, "w") as f:
        json.dump(statuses, f, indent=2)

@router.get("/files")
def get_files():
    target_dir = get_todays_dir()
    statuses = get_statuses()
    files_list = []
    
    if os.path.exists(target_dir):
        for fname in os.listdir(target_dir):
            if fname.endswith(".edi"):
                st = statuses.get(fname, {"status": "Unchecked", "id": fname})
                files_list.append({
                    "id": st["id"],
                    "fileName": fname,
                    "status": st["status"]
                })
    return files_list

@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    target_dir = get_todays_dir()
    file_path = os.path.join(target_dir, file.filename)
    try:
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)
    except Exception as e:
        print(f"Upload Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload file")

    statuses = get_statuses()
    file_id = str(int(time.time()*1000)) + str(random.randint(100,999))
    statuses[file.filename] = {"status": "Unchecked", "id": file_id}
    save_statuses(statuses)
    
    return {"success": True, "fileId": file_id}

def check_file_integrity(filepath):
    """
    Physically validates the EDI file structure and envelopes.
    """
    try:
        if not os.path.exists(filepath):
            return "File Missing"
        
        with open(filepath, 'r') as f:
            content = f.read().strip()
            # Split into segments by the standard X12 terminator '~'
            segments = [s.strip() for s in content.split('~') if s.strip()]
            
            if not segments:
                return "Empty File"

            # 1. ISA/IEA Envelope Check
            if not segments[0].startswith('ISA'):
                return "Missing ISA Header"
            if not segments[-1].startswith('IEA'):
                return "Missing IEA Trailer"

            # 2. Segment Splitting for Control Number check
            isa_elements = segments[0].split('*')
            iea_elements = segments[-1].split('*')

            if len(isa_elements) < 14:
                return "Truncated ISA Segment"
            if len(iea_elements) < 3:
                return "Truncated IEA Segment"

            # 3. Control Number Integrity Check
            # ISA13 must match IEA02
            isa_control = isa_elements[13].strip()
            iea_control = iea_elements[2].strip()

            if isa_control != iea_control:
                return f"Control Number Mismatch (ISA:{isa_control} != IEA:{iea_control})"

            return "Healthy"
    except Exception as e:
        return f"Structure Error: {str(e)}"

@router.post("/check-structure")
def check_structure():
    target_dir = get_todays_dir()
    statuses = get_statuses()
    results = []
    
    # Identify files that need checking or parsing
    files_to_check = []
    if os.path.exists(target_dir):
        for fname in os.listdir(target_dir):
            if fname.endswith(".edi"):
                st = statuses.get(fname, {"status": "Unchecked", "id": fname})
                if st["status"] in ["Unchecked", "Healthy"]:
                    files_to_check.append(fname)
                else:
                    results.append({"id": st["id"], "fileName": fname, "status": st["status"]})

    new_healthy = 0
    new_issues = 0
    
    # Process each file with real integrity logic
    for fname in files_to_check:
        filepath = os.path.join(target_dir, fname)
        st = statuses.get(fname, {"status": "Unchecked", "id": str(int(time.time()*1000))})
        
        # Call the real validator
        validation_status = check_file_integrity(filepath)
        
        st["status"] = validation_status
        if validation_status == "Healthy":
            try:
                with open(filepath, 'r') as f:
                    edi_text = f.read()
                parsed_data = parse_edi(edi_text)
                
                for transaction in parsed_data.get("transactions", []):
                    for m_data in transaction.get("members", []):
                        info = m_data.get("member_info", {})
                        sub_id = info.get("subscriber_id") or f"MEM-{os.urandom(4).hex()}"
                        m_data["subscriber_id"] = sub_id
                        m_data["status"] = "Pending Business Validation"
                        save_member_to_mongo(m_data)
                
                os.remove(filepath)
                st["status"] = "Parsed & Ingested"
                new_healthy += 1
            except Exception as e:
                print(f"Auto-Parse Error for {fname}: {e}")
                st["status"] = f"Parsing Failed: {str(e)}"
                new_issues += 1
        else:
            new_issues += 1
            
        statuses[fname] = st
        results.append({"id": st["id"], "fileName": fname, "status": st["status"]})

    save_statuses(statuses)
    
    return {
        "healthy": new_healthy,
        "issues": new_issues,
        "results": results
    }

@router.post("/reject-corrupt")
def reject_corrupt():
    target_dir = get_todays_dir()
    statuses = get_statuses()
    
    deleted_count = 0
    to_delete = [fname for fname, st in list(statuses.items()) if st.get("status") in ["Corrupt", "Broken"]]
    
    for fname in to_delete:
        filepath = os.path.join(target_dir, fname)
        if os.path.exists(filepath):
            try:
                os.remove(filepath)
                deleted_count += 1
            except Exception:
                pass
        del statuses[fname]
        
    save_statuses(statuses)
    return {"deleted": deleted_count}
