"""
BigQuery table and view setup script.

Run once to create:
  - members table
  - batches table
  - members_current view
  - batches_current view

Usage:
    python db/bq_setup.py

Requires:
    GCP_PROJECT_ID and BQ_DATASET set in .env
    GOOGLE_APPLICATION_CREDENTIALS pointing to a valid service account JSON
"""

import os
from dotenv import load_dotenv
from google.cloud import bigquery

load_dotenv()

PROJECT_ID = os.getenv("GCP_PROJECT_ID", "")
DATASET    = os.getenv("BQ_DATASET", "health_enroll")


# ---------------------------------------------------------------------------
# Table DDL
# ---------------------------------------------------------------------------

MEMBERS_TABLE_DDL = f"""
CREATE TABLE IF NOT EXISTS `{PROJECT_ID}.{DATASET}.members` (
    subscriber_id   STRING    NOT NULL  OPTIONS(description="Primary key — EDI subscriber ID"),
    status          STRING              OPTIONS(description="Current member status"),
    batch_id        STRING              OPTIONS(description="Batch this member belongs to"),
    latest_update   STRING              OPTIONS(description="Most recent snapshot date YYYY-MM-DD"),
    lastProcessedAt TIMESTAMP           OPTIONS(description="When the AI pipeline last processed this member"),
    ingested_at     TIMESTAMP NOT NULL  OPTIONS(description="Row insert time — used by _current view"),
    data            JSON                OPTIONS(description="Full nested member document: history, agent_analysis, markers, validation_issues, coverages, dependents, etc.")
)
PARTITION BY DATE(ingested_at)
CLUSTER BY subscriber_id
OPTIONS(
    description="Append-only member records. Partitioned by ingested_at date, clustered by subscriber_id. Query members_current for latest state per subscriber."
);
"""

BATCHES_TABLE_DDL = f"""
CREATE TABLE IF NOT EXISTS `{PROJECT_ID}.{DATASET}.batches` (
    id              STRING    NOT NULL  OPTIONS(description="Primary key — batch ID e.g. BCH-20260428-123"),
    status          STRING              OPTIONS(description="Batch status: Awaiting Approval / Approved / Completed / Processing Failed"),
    batch_id        STRING              OPTIONS(description="Alias for id — kept for interface compatibility"),
    latest_update   STRING              OPTIONS(description="Not used for batches — kept for interface compatibility"),
    lastProcessedAt TIMESTAMP           OPTIONS(description="When the batch was last processed"),
    ingested_at     TIMESTAMP NOT NULL  OPTIONS(description="Row insert time — used by _current view"),
    data            JSON                OPTIONS(description="Full batch document: member_ids, membersCount, createdAt, approvedAt, completedAt, processedCount, failedCount, etc.")
)
PARTITION BY DATE(ingested_at)
CLUSTER BY id
OPTIONS(
    description="Append-only batch records. Partitioned by ingested_at date, clustered by id. Query batches_current for latest state per batch."
);
"""


# ---------------------------------------------------------------------------
# _current view DDL
# ---------------------------------------------------------------------------

MEMBERS_CURRENT_VIEW_DDL = f"""
CREATE OR REPLACE VIEW `{PROJECT_ID}.{DATASET}.members_current` AS
SELECT * EXCEPT(row_num)
FROM (
    SELECT
        *,
        ROW_NUMBER() OVER (
            PARTITION BY subscriber_id
            ORDER BY ingested_at DESC
        ) AS row_num
    FROM `{PROJECT_ID}.{DATASET}.members`
)
WHERE row_num = 1;
"""

BATCHES_CURRENT_VIEW_DDL = f"""
CREATE OR REPLACE VIEW `{PROJECT_ID}.{DATASET}.batches_current` AS
SELECT * EXCEPT(row_num)
FROM (
    SELECT
        *,
        ROW_NUMBER() OVER (
            PARTITION BY id
            ORDER BY ingested_at DESC
        ) AS row_num
    FROM `{PROJECT_ID}.{DATASET}.batches`
)
WHERE row_num = 1;
"""


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def run_ddl(client: bigquery.Client, sql: str, label: str) -> None:
    """Executes a DDL statement and prints the result."""
    try:
        job = client.query(sql)
        job.result()  # wait for completion
        print(f"  ✅  {label}")
    except Exception as exc:
        print(f"  ❌  {label} — {exc}")


def setup_bigquery() -> None:
    if not PROJECT_ID:
        print("❌  GCP_PROJECT_ID is not set in .env — aborting.")
        return

    print(f"\n🔧  Setting up tables in dataset '{PROJECT_ID}.{DATASET}'\n")

    client = bigquery.Client(project=PROJECT_ID)

    # Ensure dataset exists (exists_ok=True — safe to run even if already created)
    try:
        dataset_ref = bigquery.Dataset(f"{PROJECT_ID}.{DATASET}")
        dataset_ref.location = "US"
        client.create_dataset(dataset_ref, exists_ok=True)
        print(f"  ✅  Dataset '{DATASET}' ready")
    except Exception as exc:
        print(f"  ⚠️   Could not verify dataset (may already exist): {exc}")

    # Tables
    print("\n📋  Creating tables...")
    run_ddl(client, MEMBERS_TABLE_DDL, "members table")
    run_ddl(client, BATCHES_TABLE_DDL, "batches table")

    # Views
    print("\n👁   Creating _current views...")
    run_ddl(client, MEMBERS_CURRENT_VIEW_DDL, "members_current view")
    run_ddl(client, BATCHES_CURRENT_VIEW_DDL, "batches_current view")

    print("\n✅  BigQuery setup complete.\n")


if __name__ == "__main__":
    setup_bigquery()
