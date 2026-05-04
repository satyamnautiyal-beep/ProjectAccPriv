# Streaming Events Reference

How SSE events are generated and sequenced across the two streaming surfaces in the app.

---

## Release Staging — Batch Enrollment Stream

**Endpoint:** `POST /api/batches/stream/{batch_id}`  
**Implementation:** `_run_batch_streaming()` in `server/ai/chat_agent.py`

Processes members sequentially. Each member goes through a fixed 5-stage AI pipeline, with `thinking` events emitted before and after each LLM call. The sequence below repeats for every member in the batch.

### Event sequence

```
start
└─ fires immediately when the endpoint is hit, before any processing
   payload: { batchId, memberCount }

── Per member (repeated for each member) ──────────────────────────────

thinking  "-- Starting pipeline for <Name> (<ID>)"
└─ before the member's pipeline begins

thinking  "Reading enrollment history and checking for life-event signals..."
└─ before Stage 1 LLM call (EnrollmentClassifierAgent)

  [LLM call: EnrollmentClassifierAgent]

thinking  classification result
└─ after Stage 1 returns — either SEP candidate detected or OEP routing note

thinking  "Analysing what changed between snapshots..."   (SEP path)
       OR "Building enrollment timeline from member history snapshots..."  (OEP path)
└─ before Stage 2 LLM call (SepInferenceAgent or NormalEnrollmentAgent)

  [LLM call: SepInferenceAgent or NormalEnrollmentAgent]

thinking  branch analysis result
└─ after Stage 2 returns — SEP confirmed/rejected, or timeline summary

thinking  authority source note
└─ synchronous (no LLM) — fires immediately after Stage 2
   notes whether source is Employer (payer discretion) or Exchange/CMS (regulatory)

thinking  "Evaluating eligibility: checking validation issues, blocking conditions..."
└─ before Stage 4 LLM call (DecisionAgent)

  [LLM call: DecisionAgent]

thinking  decision result
└─ after Stage 4 returns — hard blocks, SEP evidence required, or clean path

thinking  "Checking submitted documents against requirements for: <sep_type>..."  (SEP + evidence required only)
└─ before Stage 5 LLM call (EvidenceCheckAgent)

  [LLM call: EvidenceCheckAgent]  (SEP path only)

thinking  evidence check result  (SEP path only)
└─ after Stage 5 returns — docs verified or missing docs listed

thinking  "All checks passed. Enrolling member via standard OEP path."
└─ after all stages complete, before MongoDB write

  [MongoDB write — member status updated]

member_result
└─ after DB is updated
   payload: { subscriber_id, name, status, summary }

── End of member loop ──────────────────────────────────────────────────

done
└─ after all members processed and batch marked Completed in MongoDB
   payload: { batchId, processed, failed }
```

### Notes

- `thinking` events with `"-- "` prefix are member headers (used by the frontend to group steps per member).
- Artificial delays of `0.05`–`0.1s` are added via `asyncio.sleep()` to pace the stream for readability.
- Stage 3 (authority check) is synchronous — no LLM call, fires immediately.
- Stage 5 (evidence check) only runs for SEP members where the Decision agent sets `requires_evidence_check: true`.

---

## AI Assistant — Chat Stream

**Endpoint:** `POST /api/assistant/chat/llm`  
**Implementation:** `stream_chat_response()` in `server/ai/chat_agent.py`

Runs an agentic tool-calling loop (up to 8 rounds). The LLM decides which tools to call and how many rounds are needed, so the event sequence varies per query. If `process_batch` is called, the full batch stream (same as above) is drained inline.

### Event sequence

```
thinking  "Received your message — routing to orchestrator..."
└─ fires immediately, before the first LLM call

thinking  "Orchestrator analysing intent and selecting tool..."
└─ before round 0 LLM call

  [LLM call — model decides: tool_call or final response]

── If LLM calls a tool (repeats up to 8 rounds) ───────────────────────

thinking  "Orchestrator dispatching → <tool name>"
└─ after LLM responds with a tool_call decision

thinking  "Tool: <tool_name> — <description>"
thinking  "<human-readable exec message>"
└─ two pre-execution thinking events, one technical and one plain-English

  [tool function executes]

  ── If tool is process_batch ──────────────────────────────────────────
  │  The batch queue is drained inline — all per-member thinking and
  │  member_result events flow through exactly as in the Release Staging
  │  stream above.
  │
  │  status_update
  │  └─ after batch drain completes
  │     payload: { message, details: { batchId, processed, failed } }
  └─────────────────────────────────────────────────────────────────────

thinking  "Orchestrator reviewing tool result (round N)..."
└─ before each subsequent LLM round

  [LLM call — model decides: another tool_call or final response]

── When LLM decides to stop calling tools ─────────────────────────────

thinking  "Orchestrator composing final response..."
└─ LLM is about to produce its text answer

  [LLM call — final text generation]

response
└─ the LLM's final answer
   payload: { message, suggestions }

done
└─ stream end signal
```

### Event types summary

| Type | Surface | Description |
|---|---|---|
| `start` | Release Staging | Stream opened, member count known |
| `thinking` | Both | Progress signal — before/after each LLM call or stage |
| `member_result` | Both | Single member pipeline complete with final status |
| `status_update` | AI Assistant | Batch drain complete, carries aggregate counts |
| `response` | AI Assistant | LLM's final text answer with suggestions |
| `done` | Both | Stream closed |

### Key differences

| | Release Staging | AI Assistant |
|---|---|---|
| Event sequence | Fixed — same stages every time | Non-deterministic — LLM decides tool rounds |
| `thinking` source | Hardcoded strings in `_run_batch_streaming` | Mix of hardcoded orchestrator messages + per-tool labels |
| Batch processing | Primary purpose | Inline, triggered when LLM calls `process_batch` |
| Final output | `done` with counts | `response` with LLM text + suggestions |
| Artificial delays | Yes (`0.05`–`0.1s` per event) | No — events fire as fast as LLM responds |
