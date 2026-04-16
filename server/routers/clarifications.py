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
                c["status"] = 'Resolved'
                # Mutate member back to ready
                from server.routers.members import read_members, write_members
                members = read_members()
                for m in members:
                    if m["id"] == c["memberId"]:
                        m["status"] = 'Ready'
                        m["needsClarification"] = False
                write_members(members)
                write_clarifications(claris)
                return {"success": True}
    raise HTTPException(status_code=400, detail="Clarification not found")
