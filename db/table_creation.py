import mysql.connector
import os

from dotenv import load_dotenv
load_dotenv()

def create_tables(conn):
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS file_metadata (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sender_id VARCHAR(50),
        receiver_id VARCHAR(50),
        file_date VARCHAR(20),
        file_time VARCHAR(20),
        control_number VARCHAR(50),
        test_indicator VARCHAR(10),
        group_control_number VARCHAR(50),
        transaction_version VARCHAR(50)
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        file_id INT,
        transaction_id VARCHAR(50),
        transaction_type VARCHAR(50),
        reference_number VARCHAR(50),
        transaction_date VARCHAR(20),
        transaction_time VARCHAR(20),
        transaction_action VARCHAR(50),
        policy_id VARCHAR(50),
        file_effective_date VARCHAR(20),
        segment_count VARCHAR(20),
        FOREIGN KEY (file_id) REFERENCES file_metadata(id)
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS members (
        id INT AUTO_INCREMENT PRIMARY KEY,
        transaction_id INT,
        subscriber_id VARCHAR(50),
        first_name VARCHAR(50),
        last_name VARCHAR(50),
        ssn VARCHAR(20),
        dob VARCHAR(20),
        gender VARCHAR(10),
        employer_name VARCHAR(100),
        employer_id VARCHAR(50),
        insurer_name VARCHAR(100),
        insurer_id VARCHAR(50),
        relationship_code VARCHAR(10),
        employment_status VARCHAR(20),
        FOREIGN KEY (transaction_id) REFERENCES transactions(id)
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS coverages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        member_id INT,
        coverage_type VARCHAR(50),
        plan_code VARCHAR(50),
        coverage_start_date VARCHAR(20),
        coverage_end_date VARCHAR(20),
        FOREIGN KEY (member_id) REFERENCES members(id)
    )
    """)

    conn.commit()


if __name__ == "__main__":
    conn = mysql.connector.connect(
        host=os.getenv("DB_HOST"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        database=os.getenv("DB_NAME")
    )

    create_tables(conn)
    conn.close()

    print("Tables created successfully in MySQL.")