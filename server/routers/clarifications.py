import json
import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from server.routers.files import get_todays_dir

router = APIRouter(prefix="/api")

def get_clarifications_file():
    return os.path.join(get_todays_dir(), "clarifications.json")

def read_clarifications():
    cf = get_clarifications_file()
    if os.path.exists(cf):
        with open(cf, "r") as f:
            return json.load(f)
    return []

def write_clarifications(clari):
    with open(get_clarifications_file(), "w") as f:
        json.dump(clari, f)

class ClarificationUpdate(BaseModel):
    id: str

@router.get("/clarifications")
def get_clarifications():
    return read_clarifications()

@router.patch("/clarifications")
def update_clarification(update: ClarificationUpdate):
    claris = read_clarifications()
    for c in claris:
        if c["id"] == update.id:
            if c["status"] == 'Awaiting Response':
                # Update BigQuery FIRST — only mark resolved if DB write succeeds
                from db.bq_connection import get_database
                db = get_database()
                if db is None:
                    raise HTTPException(status_code=503, detail="Database unavailable — cannot resolve clarification")
                db.members.update_one(
                    {"subscriber_id": c["memberId"]},
                    {"$set": {"status": "Ready"}}
                )
                # DB write succeeded — now update disk state
                c["status"] = 'Resolved'
                write_clarifications(claris)
                return {"success": True}
    raise HTTPException(status_code=400, detail="Clarification not found")
