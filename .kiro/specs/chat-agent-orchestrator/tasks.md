# Implementation Plan: Chat Agent Orchestrator

## Overview

Implement the Chat Agent Orchestrator in four files, in dependency order: backend helpers and new tool in `chat_agent.py`, then store changes in `uiStore.js`, then SSE handler and rendering updates in `page.jsx`, then CSS classes in `ai-assistant.module.css`. Each task builds on the previous so there is no orphaned code.

## Tasks

- [x] 1. Add `_extract_member_name` and `_build_sep_context` helpers to `chat_agent.py`
  - Add `_extract_member_name(member_doc: dict) -> str` above `_execute_tool()` — extracts display name from the member's `history[latest_update].member_info` snapshot, falling back to `"Unknown"` when any key is absent
  - Add `_build_sep_context(member_doc: dict) -> dict | None` above `_execute_tool()` — reuses the same SEP field extraction logic already present in the `get_subscriber_details` branch of `_execute_tool()` and returns the same shape (`sep_type`, `sep_confidence`, `supporting_signals`, `other_candidates`, `is_within_oep`, `evidence_status`, `required_docs`, `submitted_docs`, `missing_docs`, `evidence_complete`) or `None` when no SEP markers are present
  - Both helpers are pure functions with no side effects; they are used by the `analyze_member` branch and `_run_batch_streaming()`
  - _Requirements: 1.2, 1.3, 1.4_

- [x] 2. Add the `analyze_member` tool definition and its `_execute_tool()` branch
  - [x] 2.1 Add `analyze_member` entry to the `TOOLS` list in `chat_agent.py`
    - Insert after the existing `get_subscriber_details` entry
    - Tool description must instruct the LLM to call it when the user asks about a specific member's status, review reason, SEP details, or enrollment outcome
    - Single required parameter: `subscriber_id` (string)
    - _Requirements: 1.1, 2.1_

  - [x] 2.2 Implement the `analyze_member` branch inside `_execute_tool()`
    - Add `elif name == "analyze_member":` branch
    - Return `{"error": "subscriber_id is required"}` when `subscriber_id` is empty
    - Return `{"error": "Database not available"}` when `db` is `None`
    - Return `{"error": "No member found with subscriber_id '<id>'"}` when the document is not found
    - Cache hit path: when `m.get("agent_summary") is not None`, return the stored summary with all six required fields (`subscriber_id`, `name`, `status`, `agent_summary`, `validation_issues`, `sep`) without calling `EnrollmentRouterAgent`
    - Cache miss path: call `await EnrollmentRouterAgent(json.dumps(build_engine_input(m)))`, persist `agent_summary`, `status`, `agent_analysis`, `markers`, `lastProcessedAt` to MongoDB, then return the same six-field response
    - Wrap the cache-miss path in `try/except` and return `{"error": str(e), "agent_summary": null}` on failure
    - Use `_extract_member_name()` and `_build_sep_context()` from task 1
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ]* 2.3 Write property test for `analyze_member` cache hit (Property 1)
    - **Property 1: analyze_member cache hit never invokes the pipeline**
    - **Validates: Requirements 1.3**
    - File: `tests/test_analyze_member.py`
    - Use Hypothesis; mock MongoDB `find_one` to return a doc with non-null `agent_summary`; assert `EnrollmentRouterAgent` is never called and the returned JSON contains the stored summary

  - [ ]* 2.4 Write property test for `analyze_member` cache miss (Property 2)
    - **Property 2: analyze_member cache miss invokes and persists the pipeline**
    - **Validates: Requirements 1.4**
    - File: `tests/test_analyze_member.py`
    - Use Hypothesis; mock MongoDB `find_one` to return a doc with `agent_summary = None`; assert `EnrollmentRouterAgent` is called once and `update_one` is called with all five persisted fields

  - [ ]* 2.5 Write property test for `analyze_member` required fields (Property 3)
    - **Property 3: analyze_member response always contains all required fields**
    - **Validates: Requirements 1.2**
    - File: `tests/test_analyze_member.py`
    - Use Hypothesis; vary member doc shape (with/without SEP markers, partial history); assert the returned JSON always contains `subscriber_id`, `name`, `status`, `agent_summary`, `validation_issues`, and `sep`

  - [ ]* 2.6 Write property test for `analyze_member` not-found error shape (Property 4)
    - **Property 4: analyze_member not-found returns correct error shape**
    - **Validates: Requirements 1.5**
    - File: `tests/test_analyze_member.py`
    - Use Hypothesis; vary `subscriber_id` strings; mock `find_one` to return `None`; assert the returned JSON has `error` equal to `"No member found with subscriber_id '<id>'"`

- [x] 3. Implement `_run_batch_streaming()` in `chat_agent.py`
  - Add `async def _run_batch_streaming(batch_id: str, members: list, queue: asyncio.Queue) -> None` immediately after `_run_batch_in_background()` — do NOT modify `_run_batch_in_background()`
  - For each member: put a `{"type": "thinking", "message": "Processing <name> (<sid>)..."}` event on the queue before processing
  - Call `await process_records_batch([member], persist=False)` for each member individually
  - On success: validate `root_status` against `{"Enrolled", "Enrolled (SEP)", "In Review", "Processing Failed"}`, write the five fields to MongoDB, put a `member_result` event on the queue
  - On per-member exception: put a `member_result` event with `status = "Processing Failed"` and `summary = str(e)` on the queue; continue to the next member
  - After all members: put `None` (sentinel) on the queue, then update the batch document in MongoDB with `status = "Completed"`, `processedCount`, `failedCount`, `completedAt`
  - Use `_extract_member_name()` from task 1 to get the display name
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 4.1, 4.3, 4.4_

  - [ ]* 3.1 Write property test: N members → N `member_result` events (Property 5)
    - **Property 5: _run_batch_streaming emits exactly N member_result events for N members**
    - **Validates: Requirements 3.3, 3.7**
    - File: `tests/test_batch_streaming.py`
    - Use Hypothesis; vary member list length (1–20) and field values; assert exactly N `member_result` events appear in the queue before the sentinel

  - [ ]* 3.2 Write property test: sentinel is always last (Property 6)
    - **Property 6: _run_batch_streaming sentinel is always last**
    - **Validates: Requirements 3.4**
    - File: `tests/test_batch_streaming.py`
    - Use Hypothesis; vary member list length and inject exceptions for random members; assert `None` is the last item drained from the queue

  - [ ]* 3.3 Write property test: status is always a valid terminal status (Property 7)
    - **Property 7: member_result status is always a valid terminal status**
    - **Validates: Requirements 4.3**
    - File: `tests/test_batch_streaming.py`
    - Use Hypothesis; vary pipeline result shapes (missing keys, unexpected status strings); assert every `member_result` event's `status` is one of `{"Enrolled", "Enrolled (SEP)", "In Review", "Processing Failed"}`

  - [ ]* 3.4 Write property test: error resilience (Property 8)
    - **Property 8: _run_batch_streaming error resilience**
    - **Validates: Requirements 3.7**
    - File: `tests/test_batch_streaming.py`
    - Use Hypothesis; inject exceptions for a random subset of members; assert that all remaining members still produce `member_result` events and the sentinel is still emitted

- [x] 4. Update the `process_batch` branch in `_execute_tool()` and the drain loop in `stream_chat_response()`
  - [x] 4.1 Modify the `process_batch` branch in `_execute_tool()` to return the streaming sentinel
    - Replace the `asyncio.create_task(_run_batch_in_background(...))` call with a return of `{"status": "streaming", "batchId": batch_id, "memberCount": len(members_in_batch), "_members": members_in_batch}`
    - All other guard logic (no batch found, already running, no members) remains unchanged
    - _Requirements: 3.5, 8.2, 8.3_

  - [x] 4.2 Add the streaming drain loop inside `stream_chat_response()`
    - After `_execute_tool()` returns for any tool call, check if `parsed_result.get("status") == "streaming"`
    - If so: pop `_members` from the parsed result, create an `asyncio.Queue`, fire `asyncio.create_task(_run_batch_streaming(batch_id, members_in_batch, queue))`, then drain the queue in a `while True` loop — `yield send_event(event)` for each non-None event, break on `None`
    - Track `stream_processed` and `stream_failed` counts from `member_result` events
    - After draining: yield a `status_update` SSE event with the aggregate counts
    - Replace `tool_result` with a clean `{"status": "completed", "batchId": ..., "processed": ..., "failed": ...}` before appending to the LLM message history (strips `_members`)
    - _Requirements: 3.5, 3.8, 4.2_

- [x] 5. Add richer thinking events and update `SYSTEM_PROMPT` in `chat_agent.py`
  - [x] 5.1 Enrich the `thinking` SSE event emitted before each tool call in `stream_chat_response()`
    - Before calling `_execute_tool()`, compute `entity_hint` based on `tool_name`: `analyze_member` → `" — member <subscriber_id>"`; `process_batch` → `" — batch <batch_id or 'pending'>"`; `get_subscriber_details` → `" — <subscriber_id>"`; others → `""`
    - Yield `{"type": "thinking", "message": f"Running: {tool_name.replace('_', ' ')}{entity_hint}..."}` before the tool executes
    - _Requirements: 2.2, 2.3_

  - [x] 5.2 Append routing rules for `analyze_member` to `SYSTEM_PROMPT`
    - Add three bullet points to the existing `SYSTEM_PROMPT` string (do not replace existing content):
      - Call `analyze_member` when the user asks about a specific member by name or subscriber ID, asks why someone is in review, asks about SEP details for a member, or asks about a member's enrollment outcome
      - For batch processing requests, use `process_batch` (streaming results will appear automatically in the chat window as each member is processed)
      - Prefer `analyze_member` over `get_subscriber_details` when the user wants an explanation of why a member is in their current status, not just raw field data
    - _Requirements: 1.7, 2.1_

- [x] 6. Checkpoint — backend complete
  - Ensure all tests pass, ask the user if questions arise.
  - Smoke-check: `TOOLS` list contains `analyze_member`; `_run_batch_in_background` signature is unchanged; `_run_batch_streaming` exists; `SYSTEM_PROMPT` contains `analyze_member` routing rules.

- [x] 7. Update `uiStore.js` — replace `INITIAL_STEPS` with dynamic event log
  - Remove the `INITIAL_STEPS` constant
  - Change `chatProcessSteps` initial value from `INITIAL_STEPS` to `[]`
  - Add `appendEventLogEntry: (entry) => set((state) => ({ chatProcessSteps: [...state.chatProcessSteps, entry] }))` action
  - Add `resetEventLog: () => set({ chatProcessSteps: [], chatIsProcessing: false })` action
  - Replace `updateChatStep` implementation with a no-op stub: `updateChatStep: () => {}`
  - Replace `resetChatSteps` implementation to delegate: `resetChatSteps: () => get().resetEventLog()`
  - Update `startNewConversation`, `switchConversation`, and `clearChat` to reset `chatProcessSteps` to `[]` instead of `INITIAL_STEPS`
  - The `chatProcessSteps` key name is preserved — no rename
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 8.4, 8.5, 8.6_

  - [ ]* 7.1 Write property test: `appendEventLogEntry` grows log by exactly 1 (Property 9)
    - **Property 9: appendEventLogEntry always grows the log by exactly one**
    - **Validates: Requirements 5.2**
    - File: `tests/test_ui_store.js`
    - Use fast-check; vary entry content and initial log state; assert `chatProcessSteps.length` increases by exactly 1 after each call

  - [ ]* 7.2 Write property test: `resetEventLog` clears log and sets `chatIsProcessing` false (Property 10)
    - **Property 10: resetEventLog always produces an empty log with chatIsProcessing false**
    - **Validates: Requirements 5.3, 5.6**
    - File: `tests/test_ui_store.js`
    - Use fast-check; vary log length and `chatIsProcessing` value; assert `chatProcessSteps.length === 0` and `chatIsProcessing === false` after calling `resetEventLog()`

  - [ ]* 7.3 Write property test: `updateChatStep` is a safe no-op (Property 11)
    - **Property 11: updateChatStep is a safe no-op**
    - **Validates: Requirements 5.4, 8.4**
    - File: `tests/test_ui_store.js`
    - Use fast-check; vary `id`, `status`, and `detail` arguments; assert no exception is thrown and `chatProcessSteps` is unchanged after calling `updateChatStep()`

- [x] 8. Update `page.jsx` — SSE handler, Processing Panel, and member result cards
  - [x] 8.1 Destructure `appendEventLogEntry` and `resetEventLog` from `useUIStore` and update `streamLLMChat` to call `resetEventLog()` instead of `resetChatSteps()` at the start of each query
    - Remove the `updateChatStep('1', 'active', ...)` call that immediately follows `resetChatSteps()` — the event log replaces the fixed-step model
    - _Requirements: 6.7_

  - [x] 8.2 Add `appendEventLogEntry` calls to the existing `thinking` and `status_update` SSE handlers
    - `thinking` handler: call `appendEventLogEntry({ id: generateId(), timestamp: new Date().toISOString(), eventType: 'thinking', message: payload.message })` — keep existing `updateChatStep` calls as-is (they are now no-ops but removing them is optional cleanup)
    - `status_update` handler: call `appendEventLogEntry({ id: generateId(), timestamp: new Date().toISOString(), eventType: 'tool', message: payload.message })` — keep existing `setChatMessages` call unchanged
    - `response` handler: call `appendEventLogEntry({ id: generateId(), timestamp: new Date().toISOString(), eventType: 'result', message: 'Response generated' })` — keep existing `setChatMessages` call unchanged
    - _Requirements: 6.3, 6.4, 6.6_

  - [x] 8.3 Add `member_result` SSE case to the switch statement in `streamLLMChat`
    - New `case 'member_result':` block:
      - Call `appendEventLogEntry` with `eventType: 'member_result'` and `message: \`${payload.name}: ${payload.status} — ${payload.summary || 'No summary available'}\``
      - Call `setChatMessages` to append a message object with `isMemberResult: true`, `subscriber_id`, `name`, `status`, `summary`, and `timestamp`
    - _Requirements: 6.5, 7.1_

  - [x] 8.4 Replace the Processing Panel rendering in the right `<aside>` with the event log
    - Add `logContainerRef` and `logEndRef` refs
    - Add a `useEffect` that calls `logEndRef.current?.scrollIntoView({ behavior: 'smooth' })` whenever `chatProcessSteps` changes (auto-scroll)
    - Replace the existing `chatProcessSteps.map(step => ...)` block with the event log renderer: each entry shows a formatted `HH:MM:SS` timestamp, an event type badge (`styles['badge_' + entry.eventType]`), and the entry's `message`
    - When `chatProcessSteps.length === 0 && !chatIsProcessing`, render a `<div className={styles.emptyLog}>Waiting for activity...</div>` placeholder
    - _Requirements: 6.1, 6.2, 6.7, 6.8_

  - [x] 8.5 Add member result card rendering inside the chat message loop
    - Add a `statusBadgeClass(status)` helper function that maps `"Enrolled"` / `"Enrolled (SEP)"` → `badgeGreen`, `"In Review"` → `badgeAmber`, `"Processing Failed"` → `badgeRed`
    - Inside the `chatMessages.map()` block, add a conditional branch: when `msg.isMemberResult` is true, render a `<div className={styles.memberCard}>` containing member name, subscriber ID, a status badge using `statusBadgeClass`, summary text (or `"No summary available"` when `msg.summary` is null), and a formatted timestamp
    - Standard messages (non-`isMemberResult`) continue to render with the existing markup
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 9. Add CSS classes to `ai-assistant.module.css`
  - Add event log entry classes: `.logEntry` (flex row, gap, padding, border-bottom), `.logTimestamp` (monospace, muted, small), `.logBadge` (small pill/badge base style), `.logMessage` (flex-1, small text, truncate with ellipsis for long messages), `.emptyLog` (centered muted placeholder text)
  - Add badge variant classes: `.badge_thinking` (blue tint), `.badge_tool` (purple tint), `.badge_result` (green tint), `.badge_member_result` (amber tint)
  - Add member result card classes: `.memberCard` (surface background, border, border-radius, padding, margin-bottom), `.memberCardHeader` (flex row, space-between), `.memberName` (font-weight 600), `.memberSubId` (muted, small), `.statusBadge` (pill shape, font-size small, font-weight 500), `.badgeGreen` (green background/text), `.badgeAmber` (amber background/text), `.badgeRed` (red background/text), `.memberSummary` (small text, muted, margin-top)
  - Use CSS custom properties (`var(--primary)`, `var(--text-muted)`, `var(--border)`, etc.) consistent with the existing stylesheet
  - _Requirements: 6.1, 7.2, 7.3_

- [x] 10. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - Verify: `chatProcessSteps` initial value is `[]`; `updateChatStep` does not throw; `resetChatSteps` delegates to `resetEventLog`; `member_result` SSE case is handled; Processing Panel renders event log entries; member result cards render with correct status badge colors.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- `_run_batch_in_background()` must NOT be modified — it is used by `reprocess_in_review` and must remain unchanged (Requirement 8.2, 8.3)
- The `chatProcessSteps` key name is preserved in uiStore — only the initial value and action implementations change (Requirement 5.5)
- The streaming sentinel pattern (`{"status": "streaming", "_members": [...]}`) is an internal transport mechanism — `_members` is stripped before the result is forwarded to the LLM message history
- Property tests use Hypothesis (Python) and fast-check (JavaScript) with a minimum of 100 iterations per property
