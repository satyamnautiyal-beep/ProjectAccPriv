from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api")

@router.get("/batches")
def get_batches():
    return []

@router.post("/batches")
def create_batch():
    raise HTTPException(status_code=400, detail="Mock capability disabled. Pending real DB.")

class ApproveBatchRequest(BaseModel):
    batchId: str

@router.post("/approve-batch")
def approve_batch(req: ApproveBatchRequest):
    raise HTTPException(status_code=400, detail="Mock capability disabled. Pending real DB.")
