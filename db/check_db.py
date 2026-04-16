import sqlite3

conn = sqlite3.connect("edi_data.db")
cursor = conn.cursor()

# List tables
cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
print("Tables:")
for row in cursor.fetchall():
    print(row)

# Count records
tables = ["file_metadata", "transactions", "members", "coverages"]

for table in tables:
    cursor.execute(f"SELECT COUNT(*) FROM {table}")
    count = cursor.fetchone()[0]
    print(f"{table}: {count}")

# Sample data
print("\nSample Members:")
cursor.execute("SELECT * FROM members LIMIT 5")
for row in cursor.fetchall():
    print(row)

conn.close()