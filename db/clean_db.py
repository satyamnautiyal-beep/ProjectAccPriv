import mysql.connector
import os
from dotenv import load_dotenv

load_dotenv()

def clean_database():
    print("Connecting to database...")
    try:
        conn = mysql.connector.connect(
            host=os.getenv("DB_HOST"),
            user=os.getenv("DB_USER"),
            password=os.getenv("DB_PASSWORD"),
            database=os.getenv("DB_NAME")
        )
        cursor = conn.cursor()

        print("Disabling foreign key checks to allow TRUNCATE...")
        cursor.execute("SET FOREIGN_KEY_CHECKS = 0;")

        tables = ["coverages", "members", "transactions", "file_metadata"]
        
        for table in tables:
            print(f"Emptying table: {table}")
            cursor.execute(f"TRUNCATE TABLE {table};")

        print("Re-enabling foreign key checks...")
        cursor.execute("SET FOREIGN_KEY_CHECKS = 1;")
        
        conn.commit()
        conn.close()
        
        print("SUCCESS: Database successfully wiped clean. All tables are intact but empty!")

    except mysql.connector.Error as err:
        print(f"Error: {err}")

if __name__ == "__main__":
    clean_database()
