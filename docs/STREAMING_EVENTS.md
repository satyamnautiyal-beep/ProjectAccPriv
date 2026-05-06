# Streaming Events Reference

How SSE events are generated and sequenced across the three pipeline types and the AI assistant chat.

---

## Release Staging — Batch Pipeline Stream

**Endpoint:** `POST /api/batches/stream/{batch_id}`  
**Dispatcher:** `run_batch_streaming()` in `server/ai/workflows/enrollment_pipeline.py`

The dispatcher reads `routing_target` from the batch document and delegates to the correct pipeline:

| `routing_target` | Pipeline | File |
|---|---|---|
| `EnrollmentRouterAgent` | OEP / SEP | `enrollment_pipeline.py` |
| `RenewalProcessorAgent` | Renewal | `renewal_pipeline.py` |
| `RetroEnrollmentOrchestratorAgent` | Retro Coverage | `retro_pipeline.py` |

All three pipelines share the same event types. The sequence below repeats for every member in the batch.

---

### Common event types

| Type | Description | Key payload fields |
|---|---|---|
| `start` | Stream opened, before any processing | `batchId`, `memberCount`, `pipelineType`, `routingTarget` |
| `pipeline_progress` | After each member completes | `done`, `total`, `enrolled`, `inReview`, `failed` |
| `thinking` | Pipeline stage narrative | `message`, `scope` |
| `agent_call` | Before an agent is invoked | `agent`, `message` |
| `member_result` | Member pipeline complete | `subscriber_id`, `name`, `status`, `summary` |
| `done` | All members processed, batch marked Completed | `batchId`, `processed`, `failed` |

---

### OEP / SEP Enrollment pipeline

Five-stage AI pipeline using AI Refinery Distiller. Each stage emits `thinking` events before and after the LLM call.

```
start

── Per member ──────────────────────────────────────────────────────────

thinking  "-- Starting pipeline for <Name> (<ID>)"

thinking  "Reading enrollment history and checking for life-event signals..."
agent_call  EnrollmentClassifierAgent
thinking  [classification result — SEP candidate or OEP routing note]

  ── SEP path ──────────────────────────────────────────────────────────
  thinking  "Analysing what changed between snapshots..."
  agent_call  SepInferenceAgent
  thinking  [SEP confirmed/rejected with confidence and signals]

  ── OEP path ──────────────────────────────────────────────────────────
  thinking  "Building enrollment timeline from member history snapshots..."
  agent_call  NormalEnrollmentAgent
  thinking  [timeline summary — snapshot count, effective date]

thinking  [authority source — Employer vs Exchange/CMS]

thinking  "Evaluating eligibility: checking validation issues..."
agent_call  DecisionAgent
thinking  [decision result — hard blocks, SEP evidence required, or clean path]

  ── SEP + evidence required only ──────────────────────────────────────
  thinking  "Checking submitted documents against requirements for: <sep_type>..."
  agent_call  EvidenceCheckAgent
  thinking  [evidence result — docs verified or missing docs listed]

thinking  [final outcome message]

member_result  { subscriber_id, name, status, summary }
pipeline_progress

── End of member loop ──────────────────────────────────────────────────

done
```

**Possible statuses:** `Enrolled` / `Enrolled (SEP)` / `In Review` / `Processing Failed`

---

### Renewal pipeline

Two-stage pipeline: deterministic math followed by LLM contextual judgment.

```
start

── Per member ──────────────────────────────────────────────────────────

thinking  "-- Starting pipeline for <Name> (<ID>)"
thinking  "Analyzing renewal member record for premium changes..."
thinking  "Extracting renewal coverage data from member record..."
thinking  "Prior year coverage: Gross $X, APTC $X, Net $X"
thinking  "Current year coverage: Gross $X, APTC $X, Net $X"

agent_call  RenewalProcessorAgent  [Stage 1: deterministic math]
thinking  "Calculating premium change: $X - $X = $X (+/-Y%)"
thinking  "Deterministic priority: HIGH/MEDIUM/LOW — <threshold reason>"

  ── If anomalies detected ─────────────────────────────────────────────
  thinking  "⚠ Data anomaly: <flag description>"  (one per anomaly)

agent_call  RenewalProcessorAgent  [Stage 2: LLM contextual judgment]
thinking  "LLM confirmed priority: X — deterministic result stands."
       OR "LLM override: HIGH → MEDIUM. <override_reason>"

  ── If LLM unavailable ────────────────────────────────────────────────
  thinking  "LLM reasoning unavailable (<error>), using deterministic result."

  ── HIGH priority (In Review) ─────────────────────────────────────────
  thinking  "HIGH-priority change requires specialist review..."
  thinking  "Specialist note: <specialist_note>"  (if present)
  thinking  "Flagging case for specialist review: $X (+/-Y%)"

  ── MEDIUM/LOW priority (Enrolled) ────────────────────────────────────
  thinking  "MEDIUM/LOW-priority change within acceptable range..."
  thinking  "Verifying member eligibility and plan availability..."
  thinking  "All eligibility checks passed. Approving renewal effective <date>."

member_result  { subscriber_id, name, status, summary }
pipeline_progress

── End of member loop ──────────────────────────────────────────────────

done
```

**Possible statuses:** `Enrolled` / `In Review` / `Processing Failed`

**LLM override examples:**
- MEDIUM → HIGH: delta % > 35% even if absolute delta < $50 (small plan, large relative change)
- HIGH → MEDIUM: delta % < 10% and gross > $800 (large plan, small relative change)

---

### Retro Coverage pipeline

Two-stage pipeline: deterministic liability calculation followed by LLM risk assessment.

```
start

── Per member ──────────────────────────────────────────────────────────

thinking  "-- Starting pipeline for <Name> (<ID>)"
thinking  "Analyzing retroactive coverage member record..."
thinking  "Extracting retroactive coverage data from member record..."
thinking  "Retroactive effective date: <date>"
thinking  "Monthly coverage: Gross $X, APTC $X, Member Responsibility $X"

agent_call  RetroEnrollmentOrchestratorAgent  [Stage 1: deterministic]
thinking  "Calculating retroactive period: From <date> to today = N month(s)"
thinking  "Computing total retroactive liability: $X/month × N months = $X"
thinking  "Verifying retroactive authorization and policy activation..."
thinking  "Authorization verified. Policy activated retroactively to <date>."
thinking  "Calculating month-by-month APTC reconciliation table for N month(s)..."
thinking  "APTC table generated (N entries). CSR variant confirmed."

  ── If anomalies detected ─────────────────────────────────────────────
  thinking  "⚠ Data anomaly: <flag description>"  (one per anomaly)

agent_call  RetroEnrollmentOrchestratorAgent  [Stage 2: LLM risk assessment]
thinking  "Risk assessment: LOW/MEDIUM/HIGH risk [— <override_reason>]"
thinking  "Compliance: <compliance_note>"  (if present)

  ── Fully covered (liability == 0, Enrolled) ──────────────────────────
  thinking  "Member fully covered by APTC for entire retroactive period."
  thinking  "All retroactive coverage requirements satisfied. Approving."

  ── Overpayment (liability < 0, In Review) ────────────────────────────
  thinking  "Overpayment detected: Member paid $X more than owed."
  thinking  "Flagging for specialist review: refund processing required."
  thinking  "Specialist note: <specialist_note>"  (if present)

  ── Member owes (liability > 0, In Review) ────────────────────────────
  thinking  "Member liability identified: $X owed for retroactive period."
  thinking  "Generating billing adjustment and confirmation 834..."
  thinking  "Flagging for specialist review: 48-hour deadline."
  thinking  "Specialist note: <specialist_note>"  (if present)

  ── LLM override to Enrolled ──────────────────────────────────────────
  thinking  "LLM approved enrollment: <override_reason>"

member_result  { subscriber_id, name, status, summary }
pipeline_progress

── End of member loop ──────────────────────────────────────────────────

done
```

**Possible statuses:** `Enrolled` / `In Review` / `Processing Failed`

**LLM override examples:**
- In Review → Enrolled: liability > 0 but total < $50, period ≤ 3 months, no anomalies
- Enrolled → In Review: liability == 0 but period > 6 months, or APTC > gross, or gross == 0

---

## AI Assistant — Chat Stream

**Endpoint:** `POST /api/assistant/chat/llm`  
**Implementation:** `stream_chat_response()` in `server/ai/chat/stream.py`

Runs an agentic tool-calling loop (up to 8 rounds). The LLM decides which tools to call. If `process_batch` is called, the full batch stream is drained inline.

```
thinking  "Received your message — understanding your request..."
thinking  "Deciding what action to take..."

  [LLM call — decides: tool_call or final response]

── If LLM calls a tool (repeats up to 8 rounds) ───────────────────────

thinking  "Action: <tool label>"
thinking  "<pre-execution description>"
thinking  "<exec message>"

  [tool executes]

  ── If tool is process_batch ──────────────────────────────────────────
  │  Full batch stream drained inline — all thinking, agent_call,
  │  member_result events flow through exactly as above.
  │
  │  status_update  { message, details: { batchId, processed, failed } }
  └─────────────────────────────────────────────────────────────────────

status_update  { message, details }   (non-batch tools)
thinking  "Reviewing results and deciding next step..."

  [LLM call — next round]

── When LLM stops calling tools ───────────────────────────────────────

thinking  "Preparing response..."
  [LLM final text generation]

response  { message, suggestions }

done
```

---

## Key differences between surfaces

| | Release Staging | AI Assistant |
|---|---|---|
| Event sequence | Fixed per pipeline | Non-deterministic (LLM decides rounds) |
| `thinking` source | Hardcoded pipeline strings | Mix of orchestrator messages + tool labels |
| Batch processing | Primary purpose | Inline, triggered by `process_batch` tool |
| Final output | `done` with counts | `response` with LLM text + suggestions |
| Artificial delays | Yes (0.05–0.1s per event) | No — events fire as fast as LLM responds |
| LLM calls per member | 2 (renewal/retro) or 3–5 (OEP/SEP) | Varies (1–8 rounds total) |
