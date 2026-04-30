# Requirements Document

## Introduction

The Recon Agent is a new async agent in the enrollment intelligence system that closes the loop between what the `EnrollmentClassifierAgent` detects (duplicate submissions, status-only resends, cross-record mismatches) and what actually persists in MongoDB. Currently, `save_member_to_mongo` performs a blind upsert with no duplicate detection, and the semantic flags `exact_resend_or_duplicate` and `status_only_change` computed by the classifier are never acted upon. The Recon Agent will scan member records in MongoDB, detect reconciliation issues, apply structured flags, and route affected records to the appropriate downstream status — fitting the existing `agent.py` async-function / JSON-in / JSON-out / `executor_dict` pattern.

---

## Glossary

- **Recon_Agent**: The new async reconciliation agent defined in `agent.py` and registered in `executor_dict`.
- **Member_Record**: A MongoDB document in the `members` collection keyed by `subscriber_id`, containing a `history` map of date-keyed snapshots, a `status` field, and a `markers` dict.
- **Snapshot**: A single date-keyed entry inside `Member_Record.history` representing one ingestion of an EDI 834 transaction for that subscriber.
- **Semantic_Flag**: A string label attached to a diff result by `EnrollmentClassifierAgent`; currently `exact_resend_or_duplicate`, `status_only_change`, `household_structure_change`, `coverage_change`, or `first_snapshot_only`.
- **Recon_Flag**: A structured object written to `Member_Record.markers.recon` by the Recon_Agent describing the detected issue type, severity, and recommended action.
- **Duplicate_Record**: A Member_Record whose latest two snapshots produce zero field-level diffs (Semantic_Flag `exact_resend_or_duplicate`).
- **Status_Only_Resend**: A Member_Record whose latest two snapshots differ only in the `status` field (Semantic_Flag `status_only_change`).
- **Cross_Record_Duplicate**: Two or more Member_Records that share identical `member_info` fields (first name, last name, DOB, and SSN) but have different `subscriber_id` values.
- **Recon_Status**: The recommended `status` value the Recon_Agent assigns after reconciliation; one of `Enrolled`, `Enrolled (SEP)`, `In Review`, `Duplicate — Suppressed`, or the record's existing status when no action is needed.
- **Markers_Dict**: The `markers` field on a Member_Record; already contains `is_sep_candidate`, `is_sep_confirmed`, `sep_type`, `evidence_status`, and `enrollment_path`.
- **Executor_Dict**: The `executor_dict` mapping in `agent.py` that registers all callable agents by name.
- **Deep_Diff**: The `_deep_diff` helper in `agent.py` that returns a list of field-level change objects between two snapshots.

---

## Requirements

### Requirement 1: Duplicate Snapshot Detection

**User Story:** As an enrollment operations analyst, I want the system to automatically detect and flag exact-resend submissions, so that duplicate records do not advance through the enrollment pipeline and inflate batch counts.

#### Acceptance Criteria

1. WHEN the Recon_Agent processes a Member_Record whose latest two Snapshots produce zero field-level diffs from Deep_Diff, THE Recon_Agent SHALL set `markers.recon.flag` to `"exact_resend_or_duplicate"` on that Member_Record.
2. WHEN the Recon_Agent sets `markers.recon.flag` to `"exact_resend_or_duplicate"`, THE Recon_Agent SHALL set the recommended Recon_Status to `"Duplicate — Suppressed"`.
3. WHEN the Recon_Agent sets `markers.recon.flag` to `"exact_resend_or_duplicate"`, THE Recon_Agent SHALL set `markers.recon.suppressed_at` to the UTC ISO-8601 timestamp of detection.
4. IF a Member_Record has only one Snapshot, THEN THE Recon_Agent SHALL skip duplicate-snapshot detection for that record and set `markers.recon.flag` to `"first_snapshot_only"`.

---

### Requirement 2: Status-Only Resend Detection

**User Story:** As an enrollment operations analyst, I want the system to identify submissions where only the status field changed, so that administrative resends are handled without triggering a full re-enrollment pipeline run.

#### Acceptance Criteria

1. WHEN the Recon_Agent processes a Member_Record whose latest two Snapshots differ only in the `status` field (all non-status diffs are empty), THE Recon_Agent SHALL set `markers.recon.flag` to `"status_only_change"` on that Member_Record.
2. WHEN the Recon_Agent sets `markers.recon.flag` to `"status_only_change"` and the Member_Record's current `status` is `"Enrolled"` or `"Enrolled (SEP)"`, THE Recon_Agent SHALL preserve the existing status as the Recon_Status without escalating to `"In Review"`.
3. WHEN the Recon_Agent sets `markers.recon.flag` to `"status_only_change"` and the Member_Record's current `status` is not a terminal enrolled status, THE Recon_Agent SHALL set the Recon_Status to `"In Review"`.
4. THE Recon_Agent SHALL record `markers.recon.status_only_change_detected_at` as the UTC ISO-8601 timestamp when a status-only resend is detected.

---

### Requirement 3: Cross-Record Duplicate Detection

**User Story:** As an enrollment data steward, I want the system to identify member records that share the same identity fields but carry different subscriber IDs, so that duplicate enrollments caused by re-keying or EDI sender errors are surfaced for manual review.

#### Acceptance Criteria

1. WHEN the Recon_Agent scans the `members` collection, THE Recon_Agent SHALL group Member_Records by the combination of `member_info.first_name`, `member_info.last_name`, `member_info.dob`, and `member_info.ssn` from the latest Snapshot.
2. WHEN two or more Member_Records share the same identity group and have different `subscriber_id` values, THE Recon_Agent SHALL set `markers.recon.flag` to `"cross_record_duplicate"` on each affected Member_Record.
3. WHEN the Recon_Agent flags a Member_Record as `"cross_record_duplicate"`, THE Recon_Agent SHALL set `markers.recon.duplicate_group_ids` to the list of all `subscriber_id` values in the same identity group.
4. WHEN the Recon_Agent flags a Member_Record as `"cross_record_duplicate"`, THE Recon_Agent SHALL set the Recon_Status to `"In Review"` for all records in the group.
5. IF a Member_Record is missing any of the four identity fields in its latest Snapshot, THEN THE Recon_Agent SHALL skip cross-record duplicate detection for that record and record `markers.recon.skip_reason` as `"incomplete_identity_fields"`.

---

### Requirement 4: Recon Flag Persistence

**User Story:** As a system integrator, I want all reconciliation findings written back to MongoDB atomically, so that downstream agents and the UI can read a consistent recon state without partial updates.

#### Acceptance Criteria

1. WHEN the Recon_Agent completes analysis for a Member_Record, THE Recon_Agent SHALL write all Recon_Flag fields to `markers.recon` using a single MongoDB `$set` operation on that record.
2. WHEN the Recon_Agent writes a Recon_Flag, THE Recon_Agent SHALL include `markers.recon.recon_run_at` set to the UTC ISO-8601 timestamp of the current run.
3. WHEN the Recon_Agent writes a Recon_Flag, THE Recon_Agent SHALL include `markers.recon.recon_version` set to a string identifying the agent version (e.g., `"1.0"`).
4. IF the MongoDB write operation fails for a Member_Record, THEN THE Recon_Agent SHALL include that `subscriber_id` in the output `errors` list and continue processing remaining records without aborting the run.

---

### Requirement 5: Routing Integration

**User Story:** As an enrollment pipeline engineer, I want the Recon_Agent to emit a recommended status for each processed record, so that the existing router and batch endpoints can apply the outcome without additional logic.

#### Acceptance Criteria

1. THE Recon_Agent SHALL return a JSON object containing a `results` array where each element includes `subscriber_id`, `recon_flag`, `recon_status_recommended`, and `recon_markers`.
2. WHEN the Recon_Agent produces a `recon_status_recommended` of `"Duplicate — Suppressed"`, THE Recon_Agent SHALL not alter the Member_Record's root `status` field in MongoDB; the caller is responsible for applying the recommendation.
3. THE Recon_Agent SHALL return a top-level `summary` object in its output containing `total_processed`, `duplicates_suppressed`, `status_only_resends`, `cross_record_duplicates`, `errors_count`, and `run_at`.
4. WHEN no reconciliation issues are found for a Member_Record, THE Recon_Agent SHALL set `recon_flag` to `"clean"` and `recon_status_recommended` to the record's existing `status`.

---

### Requirement 6: Agent Registration and Interface Contract

**User Story:** As a backend developer, I want the Recon_Agent to follow the same async function signature and JSON contract as all other agents in `agent.py`, so that it can be registered in `executor_dict` and invoked by the Distiller pipeline without special-casing.

#### Acceptance Criteria

1. THE Recon_Agent SHALL be implemented as an `async` Python function with the signature `async def ReconAgent(query: str, **kwargs) -> str`.
2. THE Recon_Agent SHALL accept a JSON string as `query` containing at minimum a `subscriber_ids` array (list of strings) or a `scope` field set to `"all"` to process all members.
3. THE Recon_Agent SHALL return a valid JSON string as its output.
4. THE Recon_Agent SHALL be registered in `executor_dict` under the key `"ReconAgent"`.
5. WHEN `query` contains an unrecognised field or malformed JSON, THE Recon_Agent SHALL return a JSON error object with `"error": "invalid_input"` and a descriptive `"message"` field rather than raising an unhandled exception.

---

### Requirement 7: Idempotency

**User Story:** As an operations engineer, I want running the Recon_Agent multiple times on the same data to produce the same outcome, so that scheduled or retry runs do not corrupt the recon state.

#### Acceptance Criteria

1. WHEN the Recon_Agent is run on a Member_Record that already has a `markers.recon` entry from a previous run with identical snapshot data, THE Recon_Agent SHALL overwrite the existing `markers.recon` entry with the new run's output rather than appending or merging.
2. FOR ALL Member_Records, running the Recon_Agent twice in succession on unchanged data SHALL produce identical `markers.recon` content (excluding timestamp fields `recon_run_at`, `suppressed_at`, and `status_only_change_detected_at`).
