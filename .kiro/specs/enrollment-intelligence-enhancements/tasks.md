# Implementation Plan: Enrollment Intelligence Enhancements

## Overview

Five tightly coupled changes across five files, implemented in dependency order:
1. Severity-tiered validation issues in `business_logic.py`
2. `plain_english_summary` in `DecisionAgent` + propagation through `EnrollmentRouterAgent` in `agent.py`
3. `agent_summary` persistence in `batches.py` and `members.py`
4. `agent_summary` persistence + tool surfacing in `chat_agent.py`

Property-based tests use `hypothesis`. All changes are backward compatible with existing MongoDB documents.

## Tasks

- [x] 1. Severity-tiered validation issues in `server/business_logic.py`
  - Modify `validate_member_record()` to return `List[dict]` instead of `List[str]`
  - Each issue dict: `{"message": str, "severity": "FATAL" | "WARNING"}`
  - Classify all existing subscriber checks: SSN (FATAL), DOB (FATAL), address fields (FATAL), no coverage (FATAL), coverage end before start (FATAL), gender (WARNING)
  - Classify all existing dependent checks: SSN (FATAL), DOB (FATAL), over-26 dependent (FATAL), gender (WARNING)
  - Derive status from highest severity: any FATAL → `"Awaiting Clarification"`, WARNING-only → `"Ready"`, no issues → `"Ready"`
  - Function signature `validate_member_record(member_doc)` and return type `(str, list)` remain unchanged
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12_

  - [ ]* 1.1 Write property test — Property 1: Validation issue shape invariant
    - **Property 1: Every element in the returned issues list is a dict with `"message"` (str) and `"severity"` in `{"FATAL", "WARNING"}`**
    - Use `hypothesis` with a `member_doc_strategy()` that generates documents with varying combinations of missing/malformed fields
    - Tag: `# Feature: enrollment-intelligence-enhancements, Property 1: Validation issue shape invariant`
    - **Validates: Requirements 1.1**

  - [ ]* 1.2 Write property test — Property 2: FATAL triggers "Awaiting Clarification"
    - **Property 2: Any document producing at least one FATAL issue returns status `"Awaiting Clarification"`**
    - Use `fatal_member_doc_strategy()` that guarantees at least one FATAL-triggering condition (missing SSN, missing DOB, missing address field, no coverage)
    - Tag: `# Feature: enrollment-intelligence-enhancements, Property 2: FATAL triggers Awaiting Clarification`
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 1.9**

  - [ ]* 1.3 Write property test — Property 3: WARNING-only yields "Ready" with non-empty issues
    - **Property 3: A document with only WARNING issues (no FATAL) returns `"Ready"` with a non-empty issues list**
    - Use `warning_only_member_doc_strategy()` that sets all required fields valid but uses an invalid gender marker
    - Tag: `# Feature: enrollment-intelligence-enhancements, Property 3: WARNING-only yields Ready with non-empty issues`
    - **Validates: Requirements 1.6, 1.10**

  - [ ]* 1.4 Write property test — Property 4: Clean document yields ("Ready", [])
    - **Property 4: A fully valid document returns `("Ready", [])`**
    - Use `clean_member_doc_strategy()` that generates documents with all required fields present and well-formed
    - Tag: `# Feature: enrollment-intelligence-enhancements, Property 4: Clean document yields (Ready, [])`
    - **Validates: Requirements 1.11**

  - [ ]* 1.5 Write property test — Property 5: validate_member_record is idempotent
    - **Property 5: Calling `validate_member_record` twice on the same input produces identical output**
    - Use `member_doc_strategy()` and assert `result1 == result2`
    - Tag: `# Feature: enrollment-intelligence-enhancements, Property 5: validate_member_record is idempotent`
    - **Validates: Requirements 1.12**

  - [ ]* 1.6 Write property test — Property 6: Return type contract
    - **Property 6: `validate_member_record` always returns a 2-tuple of `(str, list)`**
    - Use `member_doc_strategy()` and assert `isinstance(status, str)` and `isinstance(issues, list)`
    - Tag: `# Feature: enrollment-intelligence-enhancements, Property 6: Return type contract`
    - **Validates: Requirements 1.12**

- [x] 2. Checkpoint — Validate business logic changes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. `plain_english_summary` in `DecisionAgent` and `EnrollmentRouterAgent` in `server/ai/agent.py`
  - [x] 3.1 Add `plain_english_summary` construction to `DecisionAgent`
    - After `root_status_recommended` and `hard_blocks` are finalised, add deterministic string construction using `classification`, `analysis`, `hard_blocks`, and `root_status_recommended`
    - Four branches: OEP enrolled (no hard blocks), SEP enrolled (`sep_confirmed` + `root_status_recommended == "Enrolled (SEP)"`), SEP in review (sep confirmed + evidence missing), hard blocks present
    - Multi-block case: join all humanised blocks with `" and "`
    - Add `_humanise(block)` helper: `"validation_issues_present"` → `"validation issues present"`, `"root_status_blocks:<val>"` → `"status blocked: <val>"`, else pass through
    - Guard `hard_blocks or []` before iteration
    - Include `"plain_english_summary"` in the `DecisionAgent` return dict alongside existing keys
    - No external calls or LLM invocations — purely deterministic string construction
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [ ]* 3.2 Write property test — Property 7: DecisionAgent always emits plain_english_summary key
    - **Property 7: For any valid `DecisionAgent` input payload, the returned JSON contains a `"plain_english_summary"` key**
    - Use `decision_payload_strategy()` generating payloads with varying `hard_blocks`, `sep_confirmed`, and `root_status_recommended`
    - Assert key presence (value may be string or null)
    - Tag: `# Feature: enrollment-intelligence-enhancements, Property 7: DecisionAgent always emits plain_english_summary key`
    - **Validates: Requirements 3.1, 3.2**

  - [ ]* 3.3 Write property test — Property 8: DecisionAgent is deterministic
    - **Property 8: Calling `DecisionAgent` twice with the same payload produces identical `plain_english_summary` values**
    - Use `decision_payload_strategy()` and call `DecisionAgent` twice, asserting equality
    - Tag: `# Feature: enrollment-intelligence-enhancements, Property 8: DecisionAgent is deterministic`
    - **Validates: Requirements 3.2, 3.8**

  - [ ]* 3.4 Write property test — Property 9: Hard blocks all appear in summary
    - **Property 9: When `hard_blocks` is non-empty, `plain_english_summary` contains a human-readable representation of every block**
    - Use `decision_payload_strategy()` filtered to payloads with non-empty `hard_blocks`
    - Assert each humanised block string appears in the summary
    - Tag: `# Feature: enrollment-intelligence-enhancements, Property 9: Hard blocks all appear in summary`
    - **Validates: Requirements 3.6, 3.7**

  - [x] 3.5 Propagate `plain_english_summary` through `EnrollmentRouterAgent`
    - After receiving the `decision` result, extract `decision.get("plain_english_summary")` (null-safe)
    - Add `"plain_english_summary"` as a top-level field in the `EnrollmentRouterAgent` return dict alongside `subscriber_id`, `root_status_recommended`, `markers`, and `agent_analysis`
    - Add `"plain_english_summary": None` to the `except` branch error return dict for consistency
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 3.6 Write property test — Property 10: EnrollmentRouterAgent output shape
    - **Property 10: For any member record processed by `EnrollmentRouterAgent`, the returned JSON contains all five required top-level keys: `subscriber_id`, `root_status_recommended`, `plain_english_summary`, `markers`, `agent_analysis`**
    - Use a minimal valid member record strategy and call `EnrollmentRouterAgent` directly (bypassing Distiller)
    - Assert all five keys are present in the parsed result
    - Tag: `# Feature: enrollment-intelligence-enhancements, Property 10: EnrollmentRouterAgent output shape`
    - **Validates: Requirements 4.1, 4.2, 4.3**

- [x] 4. Checkpoint — Validate agent changes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Persist `agent_summary` in `server/routers/batches.py`
  - In `initiate_batch()`, add `"agent_summary": result.get("plain_english_summary")` to the `$set` update dict alongside `agent_analysis`, `markers`, and `status`
  - Use `.get()` so `agent_summary` is stored as `null` when the key is absent (never omitted)
  - _Requirements: 5.1, 5.5, 5.6_

- [x] 6. Persist `agent_summary` in `server/routers/members.py`
  - In `process_member_agent()`, add `"agent_summary": result.get("plain_english_summary")` to the `$set` update dict alongside `agent_analysis`, `markers`, and `status`
  - Store at root level of the member document, not nested inside `agent_analysis` or `markers`
  - _Requirements: 5.2, 5.5, 5.6_

- [x] 7. Persist `agent_summary` in `server/ai/chat_agent.py` (`_run_batch_in_background`)
  - In `_run_batch_in_background()`, add `"agent_summary": r.get("plain_english_summary")` to the `$set` update dict in the per-member `update_one` call
  - This also covers `reprocess_in_review` since it delegates to `_run_batch_in_background`
  - _Requirements: 5.3, 5.4, 5.5, 5.6_

  - [ ]* 7.1 Write property test — Property 11: agent_summary key always present after write
    - **Property 11: For any pipeline result written to MongoDB by any write path, the member document contains an `"agent_summary"` key at root level (value may be `null`)**
    - Use `mongomock` or a test MongoDB instance; generate pipeline results with and without `plain_english_summary`
    - Assert `"agent_summary" in member_doc` after each write path
    - Tag: `# Feature: enrollment-intelligence-enhancements, Property 11: agent_summary key always present after write`
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**

- [x] 8. Surface `agent_summary` and structured severity in `server/ai/chat_agent.py` tools
  - [x] 8.1 Update `get_subscriber_details` executor
    - Add `"agent_summary": m.get("agent_summary")` to the return dict (returns `null` when key absent — satisfies legacy document handling)
    - Normalise `validation_issues` for backward compatibility: iterate `raw_issues`, wrap plain strings as `{"message": issue, "severity": None}`, pass dicts through unchanged
    - Replace `"validation_issues": m.get("validation_issues") or []` with the normalised list in the return dict
    - _Requirements: 2.4, 6.1, 6.3, 6.4_

  - [x] 8.2 Update `get_clarifications` executor
    - Replace `"issues": m.get("validation_issues") or []` with a normalised list: iterate raw issues, for dicts emit `{"message": issue.get("message", ""), "severity": issue.get("severity")}`, for strings emit `{"message": issue, "severity": None}`
    - No changes to TOOLS definitions or SYSTEM_PROMPT
    - _Requirements: 2.2, 2.3, 6.2, 6.4_

  - [ ]* 8.3 Write property test — Property 12: get_subscriber_details includes agent_summary
    - **Property 12: For any member document retrieved by `get_subscriber_details`, the tool return payload contains an `"agent_summary"` key**
    - Test with documents that have `agent_summary` set, set to `null`, and absent (legacy)
    - Assert key presence and that no exception is raised
    - Tag: `# Feature: enrollment-intelligence-enhancements, Property 12: get_subscriber_details includes agent_summary`
    - **Validates: Requirements 6.1, 6.3**

  - [ ]* 8.4 Write property test — Property 13: get_clarifications surfaces severity
    - **Property 13: For any member in `"Awaiting Clarification"` status whose `validation_issues` contains structured dicts, `get_clarifications` includes a `"severity"` field alongside `"message"` for each issue**
    - Test with new-format issues (dicts with severity), legacy-format issues (plain strings), and mixed
    - Assert `"severity"` key present in every emitted issue object; assert no exception for legacy strings
    - Tag: `# Feature: enrollment-intelligence-enhancements, Property 13: get_clarifications surfaces severity`
    - **Validates: Requirements 6.2**

- [x] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Property tests use `hypothesis` with a minimum of 100 iterations per property
- `mongomock` is recommended for Property 11 to avoid a live database dependency in tests
- All write paths use `result.get("plain_english_summary")` — never direct key access — so `agent_summary` is always written as `null` rather than omitted when the pipeline error path is hit
- No changes to TOOLS definitions or SYSTEM_PROMPT in `chat_agent.py` are required
- `reprocess_in_review` is covered by task 7 because it delegates to `_run_batch_in_background`
