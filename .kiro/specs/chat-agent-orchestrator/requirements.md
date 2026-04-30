# Requirements Document

## Introduction

The Chat Agent Orchestrator evolves the existing flat tool-calling loop in `server/ai/chat_agent.py` into a proper intent-routing orchestrator. It adds three interconnected capabilities: (1) an `analyze_member` tool that lets users ask conversational questions about individual members and get back a rich AI-generated summary on demand; (2) per-member SSE streaming during batch processing so the frontend can render a live feed of results as each member is processed; and (3) a dynamic, append-only event log in the right-side "AI Processing" panel that replaces the current four fixed steps with a growing timeline of timestamped events.

All changes must be backward-compatible: existing SSE event types (`thinking`, `status_update`, `response`, `done`) and the existing background batch job path must continue to work without modification.

---

## Glossary

- **Chat_Agent**: The module `server/ai/chat_agent.py` that owns `stream_chat_response()`, the tool-calling loop, and all tool implementations.
- **Orchestrator**: The upgraded Chat_Agent that classifies user intent and routes to the appropriate tool or sub-agent team.
- **EnrollmentRouterAgent**: The async function in `server/ai/agent.py` that runs the full AI enrollment pipeline for a single member record.
- **analyze_member Tool**: A new tool registered in `TOOLS` and `_execute_tool()` that fetches a member from MongoDB and returns their `agent_summary`, current status, SEP info, and validation issues; runs `EnrollmentRouterAgent` on-demand if `agent_summary` is null.
- **Streaming Batch Job**: A variant of `_run_batch_in_background()` that accepts an async queue and emits per-member SSE events as each member is processed, rather than running silently.
- **SSE Event**: A server-sent event in the format `data: {json}\n\n` yielded by `stream_chat_response()`.
- **member_result Event**: A new SSE event type emitted once per member during a streaming batch run: `{"type": "member_result", "subscriber_id": "...", "name": "...", "status": "...", "summary": "..."}`.
- **Event_Log**: The dynamic, append-only list of timestamped log entries that replaces `INITIAL_STEPS` in `uiStore.js` and drives the right-side "AI Processing" panel.
- **Event_Log_Entry**: A single row in the Event_Log: `{ id, timestamp, eventType, message }`.
- **Processing_Panel**: The right-side `<aside>` in `client/src/app/ai-assistant/page.jsx` that renders the Event_Log.
- **uiStore**: The Zustand store at `client/src/store/uiStore.js` that holds all AI assistant UI state.
- **INITIAL_STEPS**: The four-item fixed array currently used to seed `chatProcessSteps` in uiStore; replaced by an empty Event_Log on reset.
- **Subscriber_ID**: The unique member identifier (e.g. `EMP00030`) used as the primary key in MongoDB.

---

## Requirements

### Requirement 1: analyze_member Tool

**User Story:** As an enrollment operator, I want to ask the AI assistant about a specific member by name or subscriber ID, so that I can quickly understand why they are in their current status without navigating to a separate screen.

#### Acceptance Criteria

1. THE Chat_Agent SHALL expose an `analyze_member` tool in the `TOOLS` list with a `subscriber_id` parameter of type string marked as required.
2. WHEN the `analyze_member` tool is called with a valid `subscriber_id`, THE Chat_Agent SHALL query MongoDB for the member document and return a JSON object containing: `subscriber_id`, `name`, `status`, `agent_summary`, `validation_issues`, and `sep` (the full SEP context object as returned by `get_subscriber_details`).
3. WHEN the member document exists and `agent_summary` is a non-null string, THE Chat_Agent SHALL return the stored `agent_summary` without re-running the pipeline.
4. WHEN the member document exists and `agent_summary` is null or absent, THE Chat_Agent SHALL invoke `EnrollmentRouterAgent` with the member record, persist the result to MongoDB (`agent_summary`, `status`, `agent_analysis`, `markers`, `lastProcessedAt`), and return the freshly computed `plain_english_summary` as `agent_summary` in the response.
5. IF the member document is not found in MongoDB, THEN THE Chat_Agent SHALL return a JSON error object: `{"error": "No member found with subscriber_id '<id>'"}`.
6. IF `EnrollmentRouterAgent` raises an exception during on-demand processing, THEN THE Chat_Agent SHALL return a JSON error object containing the exception message and set `agent_summary` to null.
7. THE Chat_Agent SYSTEM_PROMPT SHALL instruct the LLM to call `analyze_member` when the user asks about a specific member's status, review reason, SEP details, or enrollment outcome.

---

### Requirement 2: Intent Routing in the Orchestrator

**User Story:** As an enrollment operator, I want the AI assistant to automatically route my query to the right tool or sub-agent, so that I get accurate, contextual answers without having to know which tool to invoke.

#### Acceptance Criteria

1. THE Chat_Agent SYSTEM_PROMPT SHALL define routing rules that map user intent patterns to specific tools: member-specific queries (name or subscriber ID mentioned) → `analyze_member`; batch processing requests → `process_batch`; status/count queries → `get_system_status`; clarification queries → `get_clarifications`.
2. WHEN the LLM selects `analyze_member` in the tool-calling loop, THE Chat_Agent SHALL emit a `thinking` SSE event with a message that includes the member name or subscriber ID being looked up (e.g. `"Looking up member EMP00030..."`).
3. WHEN the LLM selects any tool in the tool-calling loop, THE Chat_Agent SHALL emit a `thinking` SSE event whose `message` field names the tool and, where applicable, the target entity (member name, batch ID, etc.).
4. THE Chat_Agent tool-calling loop SHALL continue to support up to 8 rounds without breaking existing tool flows (`check_edi_structure`, `run_business_validation`, `create_batch`, `process_batch`, `get_batch_result`, `get_system_status`, `get_clarifications`, `get_enrolled_members`, `retry_failed_members`, `reprocess_in_review`, `get_subscriber_details`).
5. THE Chat_Agent SHALL NOT break backward compatibility of existing SSE event types: `thinking`, `status_update`, `response`, and `done` MUST continue to be emitted with their current JSON shapes.

---

### Requirement 3: Per-Member SSE Streaming During Batch Processing

**User Story:** As an enrollment operator, I want to see each member's result appear in the chat window as the batch pipeline processes them, so that I can monitor progress in real time instead of waiting for a final count.

#### Acceptance Criteria

1. THE Chat_Agent SHALL implement a streaming variant of the batch runner, `_run_batch_streaming()`, that accepts an `asyncio.Queue` in addition to `batch_id` and `members` parameters.
2. WHEN `_run_batch_streaming()` begins processing a member, THE Chat_Agent SHALL put a `thinking` SSE payload onto the queue: `{"type": "thinking", "message": "Processing <name> (<subscriber_id>)..."}`.
3. WHEN `_run_batch_streaming()` finishes processing a member, THE Chat_Agent SHALL put a `member_result` SSE payload onto the queue: `{"type": "member_result", "subscriber_id": "...", "name": "...", "status": "...", "summary": "..."}` where `summary` is the member's `plain_english_summary`.
4. WHEN `_run_batch_streaming()` completes all members, THE Chat_Agent SHALL put a sentinel value (`None`) onto the queue to signal completion.
5. WHEN the `process_batch` tool is called from within `stream_chat_response()`, THE Chat_Agent SHALL use `_run_batch_streaming()` and yield each queued SSE event to the client before yielding the final `response` event with the aggregate summary.
6. THE existing `_run_batch_in_background()` function SHALL remain unchanged and SHALL continue to be used for non-chat-triggered batch runs (e.g. `reprocess_in_review`).
7. IF `_run_batch_streaming()` encounters an error processing a member, THEN THE Chat_Agent SHALL put a `member_result` payload onto the queue with `status` set to `"Processing Failed"` and `summary` set to the error message, and SHALL continue processing remaining members.
8. WHEN all `member_result` events have been yielded, THE Chat_Agent SHALL yield a `status_update` SSE event with the aggregate counts (processed, failed) before yielding the final `response`.

---

### Requirement 4: member_result SSE Event Type

**User Story:** As a frontend developer, I want a well-defined `member_result` SSE event type, so that I can render per-member result cards in the chat window as they arrive.

#### Acceptance Criteria

1. THE Chat_Agent SHALL emit `member_result` events with exactly this JSON shape: `{"type": "member_result", "subscriber_id": string, "name": string, "status": string, "summary": string | null}`.
2. THE Chat_Agent SHALL NOT emit `member_result` events outside of a streaming batch run (i.e. single-member `analyze_member` calls use the standard `response` event).
3. THE `status` field in a `member_result` event SHALL be one of the valid terminal statuses: `"Enrolled"`, `"Enrolled (SEP)"`, `"In Review"`, `"Processing Failed"`.
4. THE `summary` field in a `member_result` event SHALL be the `plain_english_summary` string from the pipeline result, or `null` if the pipeline did not produce one.

---

### Requirement 5: Dynamic Event Log in uiStore

**User Story:** As a frontend developer, I want the uiStore to manage a dynamic, append-only event log instead of a fixed four-step array, so that the Processing Panel can grow in real time as SSE events arrive.

#### Acceptance Criteria

1. THE uiStore SHALL replace `INITIAL_STEPS` with an empty array `[]` as the initial value for `chatProcessSteps` (renamed to `eventLog` in the store state).
2. THE uiStore SHALL expose an `appendEventLogEntry(entry)` action that appends a new `Event_Log_Entry` object `{ id, timestamp, eventType, message }` to `eventLog`.
3. THE uiStore SHALL expose a `resetEventLog()` action that sets `eventLog` back to `[]`.
4. THE uiStore SHALL retain `updateChatStep(id, status, detail)` and `resetChatSteps()` as no-op stubs (functions that do nothing) to avoid breaking any existing call sites during the transition period.
5. THE uiStore SHALL expose `chatProcessSteps` as a computed alias that returns `eventLog`, so that existing read references in `page.jsx` continue to work without modification.
6. WHEN `resetEventLog()` is called, THE uiStore SHALL set `chatIsProcessing` to `false`.

---

### Requirement 6: Dynamic Processing Panel on the Frontend

**User Story:** As an enrollment operator, I want the right-side "AI Processing" panel to show a live, scrollable feed of timestamped events as they arrive, so that I can follow the assistant's reasoning step by step.

#### Acceptance Criteria

1. THE Processing_Panel SHALL render each `Event_Log_Entry` as a row containing: a formatted timestamp (HH:MM:SS), an event type badge (`thinking` / `tool` / `result` / `member_result`), and the entry's `message` string.
2. WHEN a new `Event_Log_Entry` is appended, THE Processing_Panel SHALL automatically scroll to the bottom of the log.
3. WHEN the frontend receives a `thinking` SSE event, THE page.jsx SHALL call `appendEventLogEntry` with `eventType: "thinking"` and the event's `message`.
4. WHEN the frontend receives a `status_update` SSE event, THE page.jsx SHALL call `appendEventLogEntry` with `eventType: "tool"` and the event's `message`.
5. WHEN the frontend receives a `member_result` SSE event, THE page.jsx SHALL call `appendEventLogEntry` with `eventType: "member_result"` and a message formatted as `"<name>: <status> — <summary>"`.
6. WHEN the frontend receives a `response` SSE event, THE page.jsx SHALL call `appendEventLogEntry` with `eventType: "result"` and the message `"Response generated"`.
7. WHEN `resetChatSteps()` or `resetEventLog()` is called (at the start of a new query), THE Processing_Panel SHALL display an empty log.
8. THE Processing_Panel SHALL display a placeholder message (e.g. `"Waiting for activity..."`) WHEN `eventLog` is empty and `chatIsProcessing` is false.

---

### Requirement 7: member_result Cards in the Chat Window

**User Story:** As an enrollment operator, I want each member's result to appear as a compact card in the chat window during batch processing, so that I can see individual outcomes without scrolling through a wall of text.

#### Acceptance Criteria

1. WHEN the frontend receives a `member_result` SSE event, THE page.jsx SHALL append a message to `chatMessages` with `isMemberResult: true`, containing `subscriber_id`, `name`, `status`, and `summary` fields.
2. THE chat window SHALL render `isMemberResult` messages as compact cards distinct from standard AI text messages, showing: member name, subscriber ID, status badge, and summary text.
3. THE status badge on a member result card SHALL use a color that reflects the status: green for `"Enrolled"` or `"Enrolled (SEP)"`, amber for `"In Review"`, red for `"Processing Failed"`.
4. IF `summary` is null on a `member_result` message, THEN THE card SHALL display `"No summary available"` in place of the summary text.
5. THE member result cards SHALL be rendered inline in the chat message stream, interleaved with `thinking` and `status_update` messages in chronological order.

---

### Requirement 8: Backward Compatibility

**User Story:** As a developer, I want all existing chat flows and non-chat batch jobs to continue working without modification, so that the new orchestrator features are purely additive.

#### Acceptance Criteria

1. THE Chat_Agent SHALL continue to emit `thinking`, `status_update`, `response`, and `done` SSE events with their existing JSON shapes for all tool flows that do not involve `analyze_member` or streaming batch processing.
2. THE `_run_batch_in_background()` function SHALL remain unchanged and SHALL be callable independently of `stream_chat_response()`.
3. THE `reprocess_in_review` tool handler SHALL continue to use `asyncio.create_task(_run_batch_in_background(...))` and SHALL NOT use `_run_batch_streaming()`.
4. THE uiStore `updateChatStep(id, status, detail)` function SHALL remain callable without throwing errors, even after the transition to the Event_Log model.
5. THE uiStore `resetChatSteps()` function SHALL remain callable without throwing errors and SHALL delegate to `resetEventLog()`.
6. WHEN the frontend is loaded with persisted `chatHistory` from a previous session that used the old four-step model, THE uiStore SHALL initialize `eventLog` as an empty array without crashing.
