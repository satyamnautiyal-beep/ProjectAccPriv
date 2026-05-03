"""
BigQuery connection layer — drop-in replacement for mongo_connection.py.

Architecture (Approach 2 — Native BigQuery JSON Column):
─────────────────────────────────────────────────────────
Table schema (members / batches):
    subscriber_id   STRING      ← flat operational column (primary key for members)
    id              STRING      ← flat operational column (primary key for batches)
    status          STRING      ← flat operational column
    batch_id        STRING      ← flat operational column
    latest_update   STRING      ← flat operational column (YYYY-MM-DD)
    lastProcessedAt TIMESTAMP   ← flat operational column
    ingested_at     TIMESTAMP   ← row insert time (used by _current view)
    data            JSON        ← full nested document (history, agent_analysis,
                                   markers, validation_issues, dependents, etc.)

Append-only constraint:
    BigQuery does not support UPDATE/DELETE.
    Every "update" reads the current document, merges changes, then inserts
    a new row. The _current view always surfaces the latest row per primary key.

_current view pattern:
    SELECT * EXCEPT(row_num)
    FROM (
        SELECT *, ROW_NUMBER() OVER (
            PARTITION BY subscriber_id ORDER BY ingested_at DESC
        ) AS row_num
        FROM `project.dataset.members`
    )
    WHERE row_num = 1

All READ operations go through the _current view.
All WRITE operations insert into the base table.
"""

import copy
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from google.cloud import bigquery

load_dotenv()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "")
BQ_DATASET     = os.getenv("BQ_DATASET", "health_enroll")

# Flat columns that are promoted out of the document to top-level BQ columns.
# Everything else is packed into the `data` JSON column.
FLAT_FIELDS = {
    "subscriber_id",   # members primary key
    "id",              # batches primary key
    "status",
    "batch_id",
    "latest_update",
    "lastProcessedAt",
}

# Internal BQ / row-tracking fields — never passed back to the application.
_INTERNAL_FIELDS = {"ingested_at", "row_num"}


# ---------------------------------------------------------------------------
# Client factory
# ---------------------------------------------------------------------------
def get_bq_client() -> Optional[bigquery.Client]:
    """Returns an authenticated BigQuery client, or None on failure."""
    try:
        creds_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        if creds_path:
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = creds_path
        client = bigquery.Client(project=GCP_PROJECT_ID)
        print(f"[BQ] Connected — project='{GCP_PROJECT_ID}' dataset='{BQ_DATASET}'")
        return client
    except Exception as exc:
        print(f"[BQ] Connection error: {exc}")
        return None


def get_database() -> Optional["BQDatabase"]:
    """
    Drop-in replacement for mongo_connection.get_database().
    Returns a BQDatabase wrapper, or None if the connection fails.
    """
    client = get_bq_client()
    if client is None:
        return None
    return BQDatabase(client, GCP_PROJECT_ID, BQ_DATASET)


# ---------------------------------------------------------------------------
# Document packing / unpacking
# ---------------------------------------------------------------------------
def _pack_row(doc: dict) -> dict:
    """
    Converts a full member/batch document into a BQ row dict.

    Flat operational fields are extracted to top-level columns.
    Everything else is placed into the `data` column as a native Python dict
    (the BQ Python client serialises this to BigQuery's JSON type automatically).
    ingested_at is set to the current UTC time.
    """
    flat   = {}
    nested = {}

    for key, value in doc.items():
        if key in _INTERNAL_FIELDS or key == "_id":
            continue
        if key in FLAT_FIELDS:
            flat[key] = value
        else:
            nested[key] = value

    # data column — native Python dict, NOT json.dumps.
    # The google-cloud-bigquery client handles JSON serialisation internally.
    flat["data"]        = nested
    flat["ingested_at"] = datetime.now(timezone.utc)

    return flat


def _unpack_row(row: dict) -> dict:
    """
    Converts a BQ row back into the full document the application expects.

    1. Copies all flat columns to the output dict.
    2. Merges the `data` JSON column back into the top level.
    3. Strips internal BQ fields (ingested_at, row_num).
    4. Normalises TIMESTAMP flat columns to ISO strings for consistent
       downstream handling (e.g. [:10] date slicing in chat_agent.py).
    """
    out = {}

    # Copy flat columns — normalise datetime objects to ISO strings
    for key, value in row.items():
        if key in _INTERNAL_FIELDS or key == "data":
            continue
        if isinstance(value, datetime):
            out[key] = value.isoformat()
        else:
            out[key] = value

    # Merge `data` JSON column back into the top level
    raw_data = row.get("data")
    if raw_data:
        # BQ returns JSON columns as strings in some client versions
        if isinstance(raw_data, str):
            try:
                raw_data = json.loads(raw_data)
            except Exception:
                raw_data = {}
        if isinstance(raw_data, dict):
            out.update(raw_data)

    return out


# ---------------------------------------------------------------------------
# WHERE clause builder
# ---------------------------------------------------------------------------
def _build_where(filter_dict: dict) -> str:
    """
    Translates a MongoDB-style filter dict into a BigQuery WHERE clause string.

    Supported patterns:
        {"field": "value"}              → field = 'value'
        {"field": None}                 → field IS NULL
        {"field": {"$in": [...]}}       → field IN ('a', 'b', ...)
        {"field": {"$regex": "^pfx"}}   → REGEXP_CONTAINS(CAST(field AS STRING), r'pfx')
    """
    if not filter_dict:
        return ""

    clauses = []
    for key, value in filter_dict.items():
        if isinstance(value, dict):
            if "$in" in value:
                items = value["$in"]
                if not items:
                    clauses.append("FALSE")
                else:
                    escaped = ", ".join(
                        f"'{str(v).replace(chr(39), chr(39) * 2)}'" for v in items
                    )
                    clauses.append(f"{key} IN ({escaped})")

            elif "$regex" in value:
                pattern = value["$regex"].replace("'", "\\'")
                clauses.append(
                    f"REGEXP_CONTAINS(CAST({key} AS STRING), r'{pattern}')"
                )
            else:
                print(f"[BQ] Warning: unsupported filter operator on '{key}': {value}")

        elif value is None:
            clauses.append(f"{key} IS NULL")

        else:
            escaped = str(value).replace("'", "''")
            clauses.append(f"{key} = '{escaped}'")

    return " AND ".join(clauses)


# ---------------------------------------------------------------------------
# Dot-notation $set merger
# ---------------------------------------------------------------------------
def _apply_dot_notation(existing: dict, set_fields: dict) -> dict:
    """
    Merges $set fields (including MongoDB dot-notation keys) into an existing doc.

    Example:
        existing   = {"history": {"2026-04-10": {...}}}
        set_fields = {"history.2026-04-22.business_validation": {"result": "Ready"}}
        result     = {"history": {"2026-04-10": {...},
                                  "2026-04-22": {"business_validation": {...}}}}

    Dot-notation keys navigate into nested dicts without overwriting sibling keys.
    """
    result = copy.deepcopy(existing)

    for key, value in set_fields.items():
        if "." in key:
            parts = key.split(".")
            node  = result
            for part in parts[:-1]:
                if part not in node or not isinstance(node[part], dict):
                    node[part] = {}
                node = node[part]
            node[parts[-1]] = value
        else:
            result[key] = value

    return result


# ---------------------------------------------------------------------------
# BQDatabase
# ---------------------------------------------------------------------------
class BQDatabase:
    """
    Top-level wrapper that mimics the pymongo Database interface.

    Attributes:
        members  — BQCollection for the members table
        batches  — BQCollection for the batches table
    """

    def __init__(
        self,
        client: bigquery.Client,
        project: str,
        dataset: str,
    ) -> None:
        self._client  = client
        self._project = project
        self._dataset = dataset
        self.members  = BQCollection(client, project, dataset, "members",  pk="subscriber_id")
        self.batches  = BQCollection(client, project, dataset, "batches",  pk="id")


# ---------------------------------------------------------------------------
# BQCollection
# ---------------------------------------------------------------------------
class BQCollection:
    """
    Mimics the pymongo Collection interface for a single BQ table.

    READ  operations → always query the `<table>_current` view
    WRITE operations → always INSERT into the base `<table>` table
    """

    def __init__(
        self,
        client: bigquery.Client,
        project: str,
        dataset: str,
        table: str,
        pk: str = "id",
    ) -> None:
        self._client    = client
        self._project   = project
        self._dataset   = dataset
        self._table     = table
        self._pk        = pk
        # Fully-qualified identifiers (backtick-quoted for BQ)
        self._table_ref = f"`{project}.{dataset}.{table}`"
        self._view_ref  = f"`{project}.{dataset}.{table}_current`"
        # Streaming insert table reference (no backticks for the API call)
        self._insert_ref = f"{project}.{dataset}.{table}"

    # ------------------------------------------------------------------ #
    # READ operations                                                      #
    # ------------------------------------------------------------------ #

    def find(
        self,
        filter_dict: Optional[dict] = None,
        projection: Optional[dict] = None,
    ) -> List[dict]:
        """
        Returns all documents matching filter_dict from the _current view.
        projection is accepted for interface compatibility but ignored
        (BQ returns all columns; the application filters as needed).
        """
        where = _build_where(filter_dict or {})
        sql   = f"SELECT * FROM {self._view_ref}"
        if where:
            sql += f" WHERE {where}"

        try:
            rows = list(self._client.query(sql).result())
            return [_unpack_row(dict(row)) for row in rows]
        except Exception as exc:
            print(f"[BQ] find() error on '{self._table}': {exc}")
            return []

    def find_one(
        self,
        filter_dict: Optional[dict] = None,
        projection: Optional[dict] = None,
    ) -> Optional[dict]:
        """Returns the first matching document from the _current view, or None."""
        where = _build_where(filter_dict or {})
        sql   = f"SELECT * FROM {self._view_ref}"
        if where:
            sql += f" WHERE {where}"
        sql += " LIMIT 1"

        try:
            rows = list(self._client.query(sql).result())
            return _unpack_row(dict(rows[0])) if rows else None
        except Exception as exc:
            print(f"[BQ] find_one() error on '{self._table}': {exc}")
            return None

    def count_documents(self, filter_dict: Optional[dict] = None) -> int:
        """Returns the count of matching documents in the _current view."""
        where = _build_where(filter_dict or {})
        sql   = f"SELECT COUNT(*) AS cnt FROM {self._view_ref}"
        if where:
            sql += f" WHERE {where}"

        try:
            rows = list(self._client.query(sql).result())
            return int(rows[0]["cnt"]) if rows else 0
        except Exception as exc:
            print(f"[BQ] count_documents() error on '{self._table}': {exc}")
            return 0

    def count_by_status(self) -> Dict[str, int]:
        """
        Optimised single-query aggregation: returns {status: count}.
        Used by summarize_system_status() instead of iterating all rows.
        """
        sql = f"""
            SELECT status, COUNT(*) AS cnt
            FROM {self._view_ref}
            GROUP BY status
        """
        try:
            rows = list(self._client.query(sql).result())
            return {
                row["status"]: int(row["cnt"])
                for row in rows
                if row["status"] is not None
            }
        except Exception as exc:
            print(f"[BQ] count_by_status() error on '{self._table}': {exc}")
            return {}

    # ------------------------------------------------------------------ #
    # WRITE operations                                                     #
    # ------------------------------------------------------------------ #

    def insert_one(self, doc: dict) -> None:
        """
        Inserts a single document into the base table.
        The `data` column receives a native Python dict — the BQ client
        serialises it to BigQuery's JSON type automatically.
        """
        row    = _pack_row(doc)
        errors = self._client.insert_rows_json(self._insert_ref, [row])
        if errors:
            raise RuntimeError(
                f"[BQ] insert_one() error on '{self._table}': {errors}"
            )

    def update_one(
        self,
        filter_dict: dict,
        update_dict: dict,
        upsert: bool = False,
    ) -> None:
        """
        Simulates MongoDB update_one() on an append-only table.

        Steps:
          1. Read the current document via find_one() (from _current view)
          2. Merge $set fields (supports dot-notation) into the existing doc
          3. Insert the merged document as a new row

        The _current view will automatically surface this new row as the
        latest version because its ingested_at will be the most recent.

        If no document is found and upsert=True, a new document is created.
        """
        existing = self.find_one(filter_dict)

        if existing is None:
            if upsert:
                set_fields = update_dict.get("$set", {})
                new_doc    = _apply_dot_notation({}, set_fields)
                # Ensure primary key from filter is present
                for k, v in filter_dict.items():
                    if not isinstance(v, dict):
                        new_doc.setdefault(k, v)
                self.insert_one(new_doc)
            else:
                print(
                    f"[BQ] update_one(): no document found for {filter_dict} "
                    f"on '{self._table}', skipping."
                )
            return

        set_fields = update_dict.get("$set", {})
        merged     = _apply_dot_notation(existing, set_fields)
        self.insert_one(merged)

    def update_many(
        self,
        filter_dict: dict,
        update_dict: dict,
    ) -> None:
        """
        Applies update_one() to every document matching filter_dict.
        Used for bulk status changes (e.g. marking all Ready members as In Batch).
        """
        docs = self.find(filter_dict)
        for doc in docs:
            pk_val = doc.get(self._pk)
            if pk_val:
                self.update_one({self._pk: pk_val}, update_dict)


# ---------------------------------------------------------------------------
# save_member_to_bq  (drop-in for save_member_to_mongo)
# ---------------------------------------------------------------------------
def save_member_to_bq(member_data: dict) -> Optional[str]:
    """
    Saves a parsed member document to BigQuery using the history/snapshot pattern.

    - Resolves subscriber_id from the document
    - Fetches any existing history snapshots for this subscriber
    - Adds today's snapshot under the YYYY-MM-DD key
    - Inserts a new row (append-only)

    Drop-in replacement for mongo_connection.save_member_to_mongo().
    """
    db = get_database()
    if db is None:
        print("[BQ] save_member_to_bq(): database unavailable.")
        return None

    sub_id = (
        member_data.get("subscriber_id")
        or (member_data.get("member_info") or {}).get("subscriber_id")
    )
    if not sub_id:
        print("[BQ] save_member_to_bq(): no subscriber_id found, skipping.")
        return None

    today_str = datetime.now().strftime("%Y-%m-%d")

    # Preserve existing history snapshots
    existing = db.members.find_one({"subscriber_id": sub_id}) or {}
    history  = existing.get("history") or {}
    if isinstance(history, str):
        try:
            history = json.loads(history)
        except Exception:
            history = {}

    # Add today's snapshot
    history[today_str] = member_data

    new_doc = {
        **existing,
        "subscriber_id": sub_id,
        "status":        member_data.get("status", "Pending Business Validation"),
        "latest_update": today_str,
        "history":       history,
    }

    db.members.insert_one(new_doc)
    return sub_id


# ---------------------------------------------------------------------------
# Backwards-compatible alias
# ---------------------------------------------------------------------------
save_member_to_mongo = save_member_to_bq
