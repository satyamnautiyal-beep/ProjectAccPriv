import sqlite3

# Connect to your database
conn = sqlite3.connect("edi_data.db")
cursor = conn.cursor()

# Disable foreign key checks temporarily
cursor.execute("PRAGMA foreign_keys = OFF;")

# Delete data from all tables
tables = ["coverages", "members", "transactions", "file_metadata"]
for table in tables:
    cursor.execute(f"DELETE FROM {table};")

# Reset AUTOINCREMENT counters (optional)
for table in tables:
    cursor.execute(f"DELETE FROM sqlite_sequence WHERE name='{table}';")

# Re-enable foreign key checks
cursor.execute("PRAGMA foreign_keys = ON;")

conn.commit()
conn.close()

print("Database cleared successfully.")