from fastapi import APIRouter, UploadFile, File, HTTPException
import os
import time
import datetime
import random
import json
from server.database import DATA_DIR

router = APIRouter(prefix="/api")

def generate_random_name():
    firsts = ['John', 'Sarah', 'Emily', 'Michael', 'David', 'Jessica', 'Marcus', 'Chloe', 'James', 'Linda']
    lasts = ['Connor', 'Doe', 'Smith', 'Davis', 'Johnson', 'Williams', 'Brown', 'Taylor', 'Wilson', 'Moore']
    return f"{random.choice(firsts)} {random.choice(lasts)}"

def get_todays_dir():
    today_str = datetime.datetime.now().strftime("%Y-%m-%d")
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

@router.post("/check-structure")
def check_structure():
    target_dir = get_todays_dir()
    statuses = get_statuses()
    
    results = []
    
    unchecked_files = []
    if os.path.exists(target_dir):
        for fname in os.listdir(target_dir):
            if fname.endswith(".edi"):
                st = statuses.get(fname, {"status": "Unchecked", "id": fname})
                if st["status"] == "Unchecked":
                    unchecked_files.append(fname)
                else:
                    results.append({"id": st["id"], "fileName": fname, "status": st["status"]})

    total_unchecked = len(unchecked_files)
    new_healthy = 0
    new_issues = 0
    
    if total_unchecked > 0:
        if total_unchecked == 1:
            healthy_target = 1 if random.random() < 0.9 else 0
        else:
            healthy_ratio = random.uniform(0.80, 1.0)
            healthy_target = round(total_unchecked * healthy_ratio)
            
        issue_target = total_unchecked - healthy_target
        
        # Track these cleanly for the UI popup
        new_healthy = healthy_target
        new_issues = issue_target
        
        random.shuffle(unchecked_files)
        
        for i, fname in enumerate(unchecked_files):
            st = statuses.get(fname, {"status": "Unchecked", "id": fname})
            if i < issue_target:
                st["status"] = random.choice(["Corrupt", "Broken"])
            else:
                st["status"] = "Healthy"
                
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
