import os
from datetime import datetime
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

def get_mongo_client():
    """
    Connects to MongoDB using credentials from environment variables.
    """
    try:
        connection_string = os.getenv("MONGO_URI", "mongodb://localhost:27017")
        client = MongoClient(connection_string)
        # Test connection
        client.admin.command('ping')
        print("Successfully connected to MongoDB.")
        return client
    except Exception as e:
        print(f"Error connecting to MongoDB: {e}")
        return None

def get_database():
    client = get_mongo_client()
    if client is not None:
        return client[os.getenv("MONGO_DB_NAME", "health_enroll")]
    return None

def save_member_to_mongo(member_data):
    """
    Saves a fully parsed member document to MongoDB using a history/snapshot pattern.
    The primary key is subscriber_id. Each run's data is stored under a date-keyed branch.
    """
    db = get_database()
    if db is not None:
        collection = db["members"]
        # Determine the primary identifier
        sub_id = member_data.get("subscriber_id") or member_data.get("member_info", {}).get("subscriber_id")
        
        if sub_id:
            # We use YYYY-MM-DD as the key for the history snapshot
            today_str = datetime.now().strftime("%Y-%m-%d")
            
            # Update the specific snapshot for today and set latest_update
            # We use dot notation 'history.2026-04-16' to avoid overwriting other dates
            update_op = {
                "$set": {
                    f"history.{today_str}": member_data,
                    "latest_update": today_str,
                    "subscriber_id": sub_id,
                    "status": member_data.get("status", "Pending")
                }
            }
            
            result = collection.update_one(
                {"subscriber_id": sub_id},
                update_op,
                upsert=True
            )
            return sub_id
    return None
