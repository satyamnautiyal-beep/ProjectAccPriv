from fastapi import APIRouter, HTTPException
from db.mongo_connection import get_database
from agent import orchestrate_enrollment
from server.business_logic import validate_member_record

router = APIRouter(prefix="/api")

@router.get("/members")
def get_members():
    """Returns all members stored in MongoDB."""
    db = get_database()
    if db is not None:
        return list(db.members.find({}, {"_id": 0}))
    return []

@router.post("/parse-members")
def parse_members():
    """
    Triggers the Business Rule Engine over all newly ingested members.
    Instead of file-parsing (which now happens at upload), it validates content.
    """
    db = get_database()
    if db is None:
         return {"error": "Database not available"}
    
    collection = db["members"]
    # Scan for records that were auto-parsed but haven't been business-validated yet
    pending_members = collection.find({"status": "Pending Business Validation"})
    
    validated_count = 0
    clarification_count = 0

    for m_doc in pending_members:
        # Run Rule Engine (SSN, DOB, Address, etc.)
        new_status, issues = validate_member_record(m_doc)
        
        # Update MongoDB with the result
        collection.update_one(
            {"subscriber_id": m_doc["subscriber_id"]},
            {"$set": {
                "status": new_status,
                "validation_issues": issues
            }}
        )
        
        if new_status == "Ready":
            validated_count += 1
        else:
            clarification_count += 1
            
    return {"validated": validated_count, "clarifications": clarification_count}

@router.get("/agent/process/{subscriber_id}")
def process_member_agent(subscriber_id: str):
    """
    Fetches a member by subscriber_id and triggers the AI Refinery workflow.
    Only intended for 'Ready' members.
    """
    db = get_database()
    if db is None:
        raise HTTPException(status_code=500, detail="Database connection failed")
    
    member = db.members.find_one({"subscriber_id": subscriber_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    
    # Trigger AI Refinery
    result = orchestrate_enrollment(member)
    
    # Update status based on AI analysis
    db.members.update_one(
        {"subscriber_id": subscriber_id},
        {"$set": {"agent_analysis": result, "status": result.get("status")}}
    )
    
    return {"subscriber_id": subscriber_id, "analysis": result}
