# Design Document: Enrollment Intelligence Enhancements

## Overview

This document describes the technical design for three tightly coupled enhancements to the enrollment intelligence system:

1. **Severity-tiered validation issues** — `validate_member_record()` returns structured `{"message", "severity"}` dicts instead of plain strings, with FATAL/WARNING classification driving member status.
2. **Plain-English summary in DecisionAgent** — a deterministic `plain_english_summary` string is composed from data already in scope at decision time.
3. **Summary persistence and surfacing** — `plain_english_summary` is lifted to the top of `EnrollmentRouterAgent` output, stored as `agent_summary` on the member document by all four write paths, and surfaced by the chat agent's `get_subscriber_details` and `get_clarifications` tools.

All changes are backward compatible with existing MongoDB documents that predate these fields.

---

## Architecture

The changes slot into the existing pipeline at well-defined seams. No new services, queues, or data stores are introduced.

```
EDI file uploaded → disk
        │
        ▼
POST /api/check-structure
  edi_validator.py  ─── SNIP Level 1 structural check
  parser.py         ─── extract members/coverages/dependents
  save_member_to_mongo() ─── upsert, status = "Pending Business Validation"
        │
        ▼
POST /api/parse-members
  business_logic.validate_member_record()   ◄── CHANGE 1
    returns (status, List[{"message","severity"}])
  members.py writes status + validation_issues to Mongo
        │
        ▼
POST /api/batches
  bundles "Ready" members → status = "In Batch"
        │
        ▼
POST /api/initiate-batch  (or chat agent process_batch)
  process_records_batch() → EnrollmentRouterAgent per member
    ├── EnrollmentClassifierAgent
    ├── SepInferenceAgent OR NormalEnrollmentAgent
    ├── DecisionAgent              ◄── CHANGE 2 (plain_english_summary)
    └── EvidenceCheckAgent (if SEP)
  EnrollmentRouterAgent lifts plain_english_summary  ◄── CHANGE 3
  All 4 write paths store agent_summary              ◄── CHANGE 4
        │
        ▼
Chat agent get_subscriber_details / get_clarifications  ◄── CHANGE 5
  surface agent_summary + structured severity
```

### Key Design Decisions

**Why FATAL for missing address?** State determines plan network assignment; without state a member cannot be assigned to a plan. Street + city + state missing also blocks mailing of ID cards and EOBs. This is a blocking condition, not advisory.

**Why WARNING for invalid gender?** EDI 834 allows `"U"` (Unknown) as a valid value. Many payers process enrollments with unknown gender and resolve later. It does not affect plan assignment or network routing. A completely absent or unrecognised value (not in `["M","F","U","O","X"]`) is still flagged, but as non-blocking.

**Why deterministic string construction for `plain_english_summary`?** The requirement explicitly prohibits LLM calls for this field. All data needed (classification, sep_type, hard_blocks, root_status) is already in scope at the end of `DecisionAgent`. Deterministic construction guarantees idempotency and zero latency overhead.

**Why `null` rather than omitting `agent_summary`?** Consistent key presence simplifies downstream consumers — a `None` check is cheaper and safer than a `KeyError` guard. Legacy documents that predate this field are handled by `.get("agent_summary")` returning `None` naturally.

---

## Components and Interfaces

### Change 1 — `server/business_logic.py`

**Current signature:** `validate_member_record(member_doc) -> (str, List[str])`  
**New signature (externally identical):** `validate_member_record(member_doc) -> (str, List[dict])`

Each issue dict:
```python
{"message": "Subscriber: Missing SSN", "severity": "FATAL" | "WARNING"}
```

FATAL conditions (block enrollment → `"Awaiting Clarification"`):
- Missing or malformed SSN — subscriber and dependent
- Missing, invalid, or future DOB — subscriber and dependent
- Missing address fields: street, city, or state — subscriber only
- No coverage/plan defined
- Coverage end date before start date
- Dependent over-26 (relationship_code `"19"`, age ≥ 26 × 365.25 days)

WARNING conditions (non-blocking → status stays `"Ready"` if no FATAL present):
- Invalid or unrecognised gender marker (not in `["M","F","U","O","X"]`) — subscriber or dependent

Status derivation:
```
any FATAL present  →  "Awaiting Clarification"
WARNING-only       →  "Ready"  (issues list still populated)
no issues          →  "Ready", []
```

The function signature `validate_member_record(member_doc)` and return type `(str, list)` are unchanged. All existing callers (`parse_members()` in `members.py`) require no modification.

### Change 2 — `DecisionAgent` in `server/ai/agent.py`

After `root_status_recommended` and `hard_blocks` are finalised, append deterministic string construction:

```python
sep_confirmed = analysis.get("sep_confirmed")
sep_type = analysis.get("sep_causality", {}).get("sep_candidate")

if root_status_recommended == "Enrolled" and not hard_blocks:
    plain_english_summary = "Member enrolled under OEP — all fields valid, no issues found."

elif root_status_recommended == "Enrolled (SEP)" and sep_confirmed:
    plain_english_summary = (
        f"Member enrolled under SEP — {sep_type} confirmed. "
        "Required evidence submitted."
    )

elif root_status_recommended == "In Review" and sep_confirmed:
    plain_english_summary = (
        f"Placed in review — {sep_type} detected but required evidence is missing."
    )

else:  # hard blocks
    def _humanise(block: str) -> str:
        if block == "validation_issues_present":
            return "validation issues present"
        if block.startswith("root_status_blocks:"):
            status_val = block.split(":", 1)[1]
            return f"status blocked: {status_val}"
        return block

    human_blocks = " and ".join(_humanise(b) for b in hard_blocks)
    plain_english_summary = f"Placed in review — {human_blocks}."
```

`plain_english_summary` is added to the `DecisionAgent` return dict. No external calls are made.

### Change 3 — `EnrollmentRouterAgent` in `server/ai/agent.py`

After receiving the `decision` result, extract and propagate:

```python
return json.dumps({
    "subscriber_id": subscriber_id,
    "root_status_recommended": root_status_recommended,
    "plain_english_summary": decision.get("plain_english_summary"),  # null-safe
    "markers": markers,
    "agent_analysis": agent_analysis
})
```

The `except` branch also needs `"plain_english_summary": None` added to its error return dict for consistency.

### Change 4 — Four write paths store `agent_summary`

All four locations add `"agent_summary": result.get("plain_english_summary")` to their `$set` update:

| File | Function |
|------|----------|
| `server/routers/batches.py` | `initiate_batch()` |
| `server/routers/members.py` | `process_member_agent()` |
| `server/ai/chat_agent.py` | `_run_batch_in_background()` |
| `server/ai/chat_agent.py` | `reprocess_in_review()` (covered by `_run_batch_in_background` since it calls it) |

`result.get("plain_english_summary")` returns `None` when the key is absent, so `agent_summary` is always written — never omitted.

### Change 5 — Chat agent tool updates

**`get_subscriber_details` executor:**

```python
# Add to return dict:
"agent_summary": m.get("agent_summary"),

# Normalise validation_issues for backward compatibility:
raw_issues = m.get("validation_issues") or []
normalised_issues = []
for issue in raw_issues:
    if isinstance(issue, dict):
        normalised_issues.append(issue)          # new format: pass through
    else:
        normalised_issues.append({"message": issue, "severity": None})  # legacy string

# Use normalised_issues in the return dict instead of raw_issues
"validation_issues": normalised_issues,
```

**`get_clarifications` executor:**

```python
# When building each member's issues list:
raw_issues = m.get("validation_issues") or []
issues_out = []
for issue in raw_issues:
    if isinstance(issue, dict):
        issues_out.append({
            "message": issue.get("message", ""),
            "severity": issue.get("severity"),   # present for new format
        })
    else:
        issues_out.append({"message": issue, "severity": None})  # legacy string

# Use issues_out in the results list
```

No changes to TOOLS definitions or SYSTEM_PROMPT are required.

---

## Data Models

### ValidationIssue (new)

```python
{
    "message": str,          # human-readable description, e.g. "Subscriber: Missing SSN"
    "severity": "FATAL" | "WARNING"
}
```

Stored in MongoDB under `validation_issues` on the member document. Replaces the previous `List[str]`.

### Member document additions

```
member_document {
    ...existing fields...
    "validation_issues": List[ValidationIssue],   # was List[str]
    "agent_summary":     str | null,              # NEW — plain_english_summary from pipeline
}
```

`agent_summary` is stored at root level, not nested inside `agent_analysis` or `markers`.

### EnrollmentRouterAgent output (updated)

```json
{
    "subscriber_id": "EMP00030",
    "root_status_recommended": "Enrolled",
    "plain_english_summary": "Member enrolled under OEP — all fields valid, no issues found.",
    "markers": { ... },
    "agent_analysis": { ... }
}
```

`plain_english_summary` is `null` when `DecisionAgent` did not produce one (error path).

### DecisionAgent output (updated)

```json
{
    "root_status_current": "Ready",
    "root_status_recommended": "Enrolled",
    "plain_english_summary": "Member enrolled under OEP — all fields valid, no issues found.",
    "agent_analysis_patch": {
        "hard_blocks": [],
        "requires_evidence_check": false,
        ...
    }
}
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Validation issue shape invariant

*For any* member document passed to `validate_member_record`, every element in the returned issues list SHALL be a dict containing a `"message"` key (string) and a `"severity"` key whose value is either `"FATAL"` or `"WARNING"`.

**Validates: Requirements 1.1**

---

### Property 2: FATAL triggers "Awaiting Clarification"

*For any* member document that causes `validate_member_record` to produce at least one issue with `severity == "FATAL"`, the returned status SHALL be `"Awaiting Clarification"`.

**Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 1.9**

---

### Property 3: WARNING-only yields "Ready" with non-empty issues

*For any* member document that causes `validate_member_record` to produce at least one issue and all issues have `severity == "WARNING"` (no FATAL present), the returned status SHALL be `"Ready"` and the issues list SHALL be non-empty.

**Validates: Requirements 1.6, 1.10**

---

### Property 4: Clean document yields ("Ready", [])

*For any* fully valid member document (all required fields present and well-formed), `validate_member_record` SHALL return `("Ready", [])`.

**Validates: Requirements 1.11**

---

### Property 5: validate_member_record is idempotent

*For any* member document, calling `validate_member_record` twice on the same input SHALL produce identical output both times — same status string and same issues list.

**Validates: Requirements 1.12**

---

### Property 6: Return type contract

*For any* member document, `validate_member_record` SHALL return a 2-tuple where the first element is a `str` and the second element is a `list`.

**Validates: Requirements 1.12**

---

### Property 7: DecisionAgent always emits plain_english_summary key

*For any* valid `DecisionAgent` input payload, the returned JSON object SHALL contain a `"plain_english_summary"` key (value may be a string or null, but the key must be present).

**Validates: Requirements 3.1, 3.2**

---

### Property 8: DecisionAgent is deterministic

*For any* `DecisionAgent` input payload, calling `DecisionAgent` twice with the same payload SHALL produce identical `plain_english_summary` values.

**Validates: Requirements 3.2, 3.8**

---

### Property 9: Hard blocks all appear in summary

*For any* `DecisionAgent` payload where `hard_blocks` is non-empty, the `plain_english_summary` SHALL contain a human-readable representation of every block in `hard_blocks`.

**Validates: Requirements 3.6, 3.7**

---

### Property 10: EnrollmentRouterAgent output shape

*For any* member record processed by `EnrollmentRouterAgent`, the returned JSON object SHALL contain all five required top-level keys: `"subscriber_id"`, `"root_status_recommended"`, `"plain_english_summary"`, `"markers"`, and `"agent_analysis"`.

**Validates: Requirements 4.1, 4.2, 4.3**

---

### Property 11: agent_summary key always present after write

*For any* pipeline result written to MongoDB by any of the four write paths, the member document SHALL contain an `"agent_summary"` key at root level (value may be `null` but the key must be present).

**Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**

---

### Property 12: get_subscriber_details includes agent_summary

*For any* member document retrieved by `get_subscriber_details`, the tool return payload SHALL contain an `"agent_summary"` key (value is the stored string or `null`).

**Validates: Requirements 6.1, 6.3**

---

### Property 13: get_clarifications surfaces severity

*For any* member in `"Awaiting Clarification"` status whose `validation_issues` contains structured dicts, the `get_clarifications` tool SHALL include a `"severity"` field alongside `"message"` for each issue.

**Validates: Requirements 6.2**

---

## Error Handling

### Legacy document compatibility

Both `get_subscriber_details` and `get_clarifications` must handle two formats of `validation_issues`:

- **New format** (post-enhancement): `[{"message": "...", "severity": "FATAL"}, ...]`
- **Legacy format** (pre-enhancement): `["Subscriber: Missing SSN", ...]`

Detection: `isinstance(issue, dict)`. Legacy strings are wrapped as `{"message": issue, "severity": None}` before being returned to the LLM. This ensures the LLM always receives a consistent shape.

### Missing `agent_summary` on legacy documents

`m.get("agent_summary")` returns `None` naturally when the key is absent. No special handling needed — the tool returns `null` for `agent_summary`, which satisfies Requirement 6.3.

### `plain_english_summary` absent from pipeline result

`result.get("plain_english_summary")` returns `None` when the key is absent (e.g., error path in `EnrollmentRouterAgent`). All four write paths use `.get()` so `agent_summary` is stored as `null` rather than raising a `KeyError`.

### `DecisionAgent` edge cases

- `hard_blocks` is empty and `root_status_recommended` is `"In Review"` (e.g., SEP with missing evidence but no validation issues): the SEP branch handles this — `sep_confirmed` is `True` so the third pattern applies.
- `sep_type` is `None`: the f-string produces `"None"` which is acceptable; the pipeline should not reach this branch without a sep_type, but if it does the summary is still non-null.
- `hard_blocks` is `None`: guarded by `hard_blocks or []` before iteration.

---

## Testing Strategy

### Unit tests (example-based)

These cover specific scenarios and edge cases:

- `validate_member_record` with a fully valid document → `("Ready", [])`
- `validate_member_record` with missing SSN → FATAL issue, `"Awaiting Clarification"`
- `validate_member_record` with missing state → FATAL issue, `"Awaiting Clarification"`
- `validate_member_record` with invalid gender only → WARNING issue, `"Ready"`
- `validate_member_record` with both FATAL and WARNING → `"Awaiting Clarification"`, both issues present
- `DecisionAgent` OEP clean path → summary matches expected string
- `DecisionAgent` SEP confirmed + evidence complete → summary contains sep_type
- `DecisionAgent` SEP + missing evidence → summary contains "review"
- `DecisionAgent` hard blocks → summary contains humanised block text
- `get_subscriber_details` on legacy document (string issues, no `agent_summary`) → no exception, `agent_summary` is `null`
- `get_clarifications` on legacy document → no exception, issues returned with `severity: null`

### Property-based tests

Property-based testing is appropriate here because:
- `validate_member_record` is a pure function with clear input/output behaviour
- The input space (member documents with varying field combinations) is large
- Universal properties (severity shape, status derivation, idempotency) hold across all inputs
- `DecisionAgent` summary construction is deterministic and testable with generated payloads

**Library:** `hypothesis` (Python)  
**Minimum iterations:** 100 per property test  
**Tag format:** `# Feature: enrollment-intelligence-enhancements, Property {N}: {property_text}`

Each correctness property above maps to one property-based test. The generators needed:

- `member_doc_strategy()` — generates member documents with varying combinations of missing/malformed fields
- `fatal_member_doc_strategy()` — generates member documents guaranteed to trigger at least one FATAL issue
- `warning_only_member_doc_strategy()` — generates member documents with only WARNING-triggering conditions (invalid gender, all other fields valid)
- `clean_member_doc_strategy()` — generates fully valid member documents
- `decision_payload_strategy()` — generates valid `DecisionAgent` input payloads with varying `hard_blocks`, `sep_confirmed`, and `root_status_recommended`

### Integration tests

- `parse_members()` end-to-end: write structured issues to Mongo, read back, assert shape
- `initiate_batch()` end-to-end: run pipeline, read back member doc, assert `agent_summary` key present at root
- `_run_batch_in_background()`: same assertion

Integration tests use a test MongoDB instance (or `mongomock`) and run 1–3 representative examples each.
