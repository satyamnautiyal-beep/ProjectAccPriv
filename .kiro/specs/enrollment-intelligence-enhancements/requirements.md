# Requirements Document

## Introduction

This feature introduces three tightly coupled enhancements to the enrollment intelligence system that form the foundation for a conversational agentic UI:

1. **Fatal/Warning severity tiers in business validation** — `validate_member_record()` currently returns a flat list of string issues with no severity distinction. Each issue must be classified as FATAL (blocks enrollment) or WARNING (proceed with flag), and the resulting member status must reflect the highest severity present.

2. **Plain-English summary in DecisionAgent** — `DecisionAgent` currently returns structured JSON with no human-readable explanation. A `plain_english_summary` field must be composed deterministically from the existing classification, SEP type, evidence status, and hard-block data already available in the agent.

3. **Summary persistence on member record** — The `plain_english_summary` produced by `EnrollmentRouterAgent` must be stored on the member's MongoDB document as `agent_summary` so the chat agent can retrieve and surface it per-member without re-running the pipeline.

All changes must be backward compatible with existing MongoDB documents that lack the new fields.

---

## Glossary

- **Validator**: The `validate_member_record()` function in `server/business_logic.py` that performs business-level validation on a member document.
- **ValidationIssue**: A structured object containing a `message` (string) and a `severity` (`"FATAL"` or `"WARNING"`).
- **FATAL**: A severity level indicating a blocking issue that prevents enrollment (e.g., missing SSN, invalid DOB, missing address fields (street, city, or state), no coverage defined).
- **WARNING**: A severity level indicating a non-blocking issue that allows enrollment to proceed with a flag (e.g., unknown/invalid gender marker).
- **DecisionAgent**: The async agent function in `server/ai/agent.py` that aggregates deterministic blockers and produces a recommended enrollment status.
- **EnrollmentRouterAgent**: The top-level orchestration agent in `server/ai/agent.py` that coordinates all sub-agents and produces the final enrollment result.
- **plain_english_summary**: A 1–2 sentence human-readable explanation of the enrollment outcome, composed deterministically from structured agent data.
- **agent_summary**: The root-level MongoDB field on a member document where `plain_english_summary` is persisted.
- **ChatAgent**: The `stream_chat_response` function and its tool executors in `server/ai/chat_agent.py`.
- **Member**: A MongoDB document in the `members` collection identified by `subscriber_id`.

---

## Requirements

### Requirement 1: Structured Validation Issues with Severity Tiers

**User Story:** As an enrollment operations analyst, I want each business validation issue to carry a severity level, so that I can distinguish blocking problems from advisory flags without reading free-form text.

#### Acceptance Criteria

1. THE Validator SHALL return each validation issue as a structured object containing a `message` string and a `severity` field whose value is either `"FATAL"` or `"WARNING"`.
2. WHEN the Validator detects a missing or malformed SSN on the subscriber record, THE Validator SHALL classify that issue as `"FATAL"`.
3. WHEN the Validator detects a missing or invalid Date of Birth on the subscriber record, THE Validator SHALL classify that issue as `"FATAL"`.
4. WHEN the Validator detects that no coverage or plan is defined for the subscriber, THE Validator SHALL classify that issue as `"FATAL"`.
5. WHEN the Validator detects one or more missing address fields (street, city, or state) on the subscriber record, THE Validator SHALL classify that issue as `"FATAL"`.
6. WHEN the Validator detects an invalid or unrecognised gender marker on the subscriber or a dependent record, THE Validator SHALL classify that issue as `"WARNING"`.
7. WHEN the Validator detects a missing or malformed SSN on a dependent record, THE Validator SHALL classify that issue as `"FATAL"`.
8. WHEN the Validator detects a missing or invalid Date of Birth on a dependent record, THE Validator SHALL classify that issue as `"FATAL"`.
9. WHEN at least one `"FATAL"` issue is present, THE Validator SHALL return the status `"Awaiting Clarification"`.
10. WHEN all issues present are `"WARNING"` severity and no `"FATAL"` issues exist, THE Validator SHALL return the status `"Ready"`.
11. WHEN no issues are present, THE Validator SHALL return the status `"Ready"` and an empty issues list.
12. THE Validator SHALL remain callable with the same function signature `validate_member_record(member_doc)` and SHALL return a tuple of `(status: str, issues: list)` so that all existing callers require no signature changes.

---

### Requirement 2: Backward-Compatible Issue Consumption

**User Story:** As a developer maintaining the enrollment pipeline, I want existing code that reads `validation_issues` from MongoDB to continue working unchanged, so that the severity enhancement does not break any downstream consumers.

#### Acceptance Criteria

1. WHEN `parse_members()` in `server/routers/members.py` writes `validation_issues` to MongoDB, THE System SHALL store the full structured issue objects (with `message` and `severity`) rather than plain strings.
2. WHEN the `get_clarifications` tool in ChatAgent reads `validation_issues` from a member document, THE ChatAgent SHALL surface the `message` field of each issue so that the displayed text is equivalent to the previous plain-string behaviour.
3. WHEN a member document in MongoDB contains `validation_issues` as plain strings (legacy format), THE ChatAgent SHALL handle those strings without raising an error, treating them as issues with no severity field.
4. WHEN the `get_subscriber_details` tool in ChatAgent reads `validation_issues` from a member document, THE ChatAgent SHALL include the `severity` field in the returned data when it is present.

---

### Requirement 3: Plain-English Summary in DecisionAgent

**User Story:** As a chat agent consumer, I want each enrollment decision to include a concise human-readable explanation, so that the assistant can surface the outcome to a user without requiring them to parse structured JSON.

#### Acceptance Criteria

1. THE DecisionAgent SHALL include a `plain_english_summary` field in its JSON output.
2. THE DecisionAgent SHALL compose `plain_english_summary` deterministically from the structured data already present in its input: `classification`, `analysis` (branch analysis), `hard_blocks`, and `root_status_recommended`.
3. WHEN `root_status_recommended` is `"Enrolled"` and no hard blocks are present, THE DecisionAgent SHALL set `plain_english_summary` to a sentence indicating OEP enrollment with all fields valid.
4. WHEN `root_status_recommended` is `"Enrolled (SEP)"` and `sep_confirmed` is `true`, THE DecisionAgent SHALL set `plain_english_summary` to a sentence identifying the SEP type and confirming that required evidence was submitted.
5. WHEN `root_status_recommended` is `"In Review"` and `sep_confirmed` is `true` and evidence is incomplete, THE DecisionAgent SHALL set `plain_english_summary` to a sentence indicating review status and identifying the missing evidence type.
6. WHEN `root_status_recommended` is `"In Review"` and `hard_blocks` contains validation issues, THE DecisionAgent SHALL set `plain_english_summary` to a sentence listing the blocking issues, prefixed with their severity where available.
7. WHEN multiple hard blocks are present, THE DecisionAgent SHALL include all blocking reasons in `plain_english_summary` separated by `" and "`.
8. THE DecisionAgent SHALL NOT call any external service or LLM to produce `plain_english_summary`; the composition MUST be purely deterministic string construction.

---

### Requirement 4: Summary Propagation Through EnrollmentRouterAgent

**User Story:** As a developer integrating the pipeline output, I want the `plain_english_summary` to be available at the top level of the `EnrollmentRouterAgent` result, so that callers do not need to navigate nested agent output to find it.

#### Acceptance Criteria

1. WHEN `EnrollmentRouterAgent` receives the `DecisionAgent` output, THE EnrollmentRouterAgent SHALL extract `plain_english_summary` from the decision result and include it as a top-level field in its own JSON output.
2. IF `DecisionAgent` does not return a `plain_english_summary` field, THEN THE EnrollmentRouterAgent SHALL set `plain_english_summary` to `null` in its output rather than raising an error.
3. THE EnrollmentRouterAgent output object SHALL contain `plain_english_summary` alongside the existing `subscriber_id`, `root_status_recommended`, `markers`, and `agent_analysis` fields.

---

### Requirement 5: Persistence of agent_summary on Member Document

**User Story:** As a chat agent developer, I want the plain-English summary to be stored on the member's MongoDB document, so that the assistant can retrieve it instantly per-member without re-running the enrollment pipeline.

#### Acceptance Criteria

1. WHEN `initiate_batch` in `server/routers/batches.py` writes pipeline results to MongoDB, THE System SHALL include `agent_summary` in the `$set` update alongside `agent_analysis`, `markers`, and `status`.
2. WHEN `process_member_agent` in `server/routers/members.py` writes pipeline results to MongoDB, THE System SHALL include `agent_summary` in the `$set` update.
3. WHEN `_run_batch_in_background` in `server/ai/chat_agent.py` writes pipeline results to MongoDB, THE System SHALL include `agent_summary` in the `$set` update.
4. WHEN `reprocess_in_review` in `server/ai/chat_agent.py` writes pipeline results to MongoDB, THE System SHALL include `agent_summary` in the `$set` update.
5. THE System SHALL store `agent_summary` at the root level of the member document, not nested inside `agent_analysis` or `markers`.
6. IF the pipeline result does not contain a `plain_english_summary` field, THEN THE System SHALL store `agent_summary` as `null` rather than omitting the field, so that the presence of the key is consistent across all processed member documents.
7. WHEN a member document in MongoDB does not have an `agent_summary` field (legacy document), THE ChatAgent SHALL handle the absence of the field without raising an error.

---

### Requirement 6: Chat Agent Surfacing of New Fields

**User Story:** As an end user of the AI assistant, I want the chat agent to surface the plain-English summary and issue severities when I ask about a member, so that I receive a clear, actionable explanation without needing to understand the underlying data model.

#### Acceptance Criteria

1. WHEN the `get_subscriber_details` tool retrieves a member document that contains an `agent_summary` field, THE ChatAgent SHALL include `agent_summary` in the tool's return payload.
2. WHEN the `get_clarifications` tool retrieves members in `"Awaiting Clarification"` status, THE ChatAgent SHALL include the `severity` field alongside the `message` for each issue when the severity field is present on the stored issue object.
3. WHEN the `get_subscriber_details` tool retrieves a member document that does not contain an `agent_summary` field, THE ChatAgent SHALL return `null` for `agent_summary` without raising an error.
4. THE existing `get_subscriber_details` and `get_clarifications` tool signatures and return shapes SHALL remain backward compatible so that no changes to the LLM tool definitions or the SYSTEM_PROMPT are required.
