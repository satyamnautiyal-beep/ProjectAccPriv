# HealthEnroll

AI-powered health insurance enrollment processing platform. Parses EDI 834 files, classifies members into the correct pipeline (OEP, SEP, Renewal, Retro Coverage), runs them through dedicated agentic workflows, and streams real-time results to the UI.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React, Zustand, TanStack Query |
| Backend | FastAPI (Python 3.10+) |
| Database | MongoDB |
| AI | AI Refinery (Distiller + Chat Completions) |
| EDI Parsing | Custom EDI 834 parser (`parser.py`) |

---

## Quick start

### Prerequisites

- Python 3.10+
- Node.js 18+
- MongoDB 6+ (local or Atlas)
- AI Refinery API key — [sdk.airefinery.accenture.com](https://sdk.airefinery.accenture.com)

### 1. Environment

```bash
cp .env.example .env
# Fill in AI_REFINERY_KEY and MONGO_URI
```

### 2. Backend

```bash
python -m venv venv
# Windows: venv\Scripts\activate
# macOS/Linux: source venv/bin/activate

pip install -r server/requirements.txt
uvicorn server.main:app --reload
# → http://localhost:8000
```

### 3. Frontend

```bash
cd client
npm install
npm run dev
# → http://localhost:3000
```

**Demo login:** `admin@demo.com` / `admin123`

---

## How it works

### Member lifecycle

```
Upload EDI 834
      ↓
Structure validation + parse → MongoDB
      ↓
Business validation (SSN, DOB, address, coverage)
      ↓           ↓
   Ready    Awaiting Clarification
      ↓
Classification (RENEWAL / RETRO_COVERAGE / OEP / SEP)
      ↓
Batch creation (one batch per pipeline type)
      ↓
Release Staging → Initiate pipeline
      ↓
Agent pipeline (streaming SSE)
      ↓
Enrolled / In Review / Processing Failed
```

### Classification logic (priority order)

| Priority | Signal | Classification | Agent |
|---|---|---|---|
| 1 | `prior_aptc` or `prior_gross_premium` present | `RENEWAL` | `RenewalProcessorAgent` |
| 2 | `coverage_start_date` < today | `RETRO_COVERAGE` | `RetroEnrollmentOrchestratorAgent` |
| 3 | SEP indicator / life event | `SEP_ENROLLMENT` | `EnrollmentRouterAgent` |
| 4 | Default | `OEP_ENROLLMENT` | `EnrollmentRouterAgent` |

---

## Agent pipelines

### OEP / SEP Enrollment

Five-stage pipeline using AI Refinery Distiller:

```
EnrollmentClassifierAgent   → detect SEP signals, enrollment type
SepInferenceAgent           → identify qualifying life event (SEP path)
NormalEnrollmentAgent       → build OEP timeline (OEP path)
DecisionAgent               → evaluate eligibility, hard blocks
EvidenceCheckAgent          → verify submitted documents (SEP only)
```

Outcome: `Enrolled` / `Enrolled (SEP)` / `In Review`

### Renewal

Two-stage pipeline per member:

```
Stage 1 (deterministic)
  Extract prior/current coverage → calculate premium delta
  Classify priority: HIGH (|Δ| > $50) / MEDIUM (> $20) / LOW

Stage 2 (LLM — openai/gpt-oss-120b)
  Contextual judgment:
  - Override priority if % change is disproportionate to plan value
  - Detect data anomalies (APTC > gross, negative net premiums)
  - Produce specialist note + member-facing explanation
```

Outcome: `In Review` (HIGH priority) / `Enrolled` (MEDIUM/LOW)

### Retro Coverage

Two-stage pipeline per member:

```
Stage 1 (deterministic)
  Extract coverage start date → calculate retroactive months
  Compute total liability (monthly_net × months)
  Build month-by-month APTC reconciliation table

Stage 2 (LLM — openai/gpt-oss-120b)
  Risk assessment:
  - Override status for low-liability cases (< $50, ≤ 3 months, no anomalies) → Enrolled
  - Escalate zero-liability cases with long periods (> 6 months) → In Review
  - Flag APTC > gross as data quality issue
  - Produce compliance note + specialist recommendation
```

Outcome: `Enrolled` (no/low liability, clean) / `In Review` (liability, anomalies, or long period)

---

## Project structure

```
├── parser.py                        # EDI 834 parser
├── server/
│   ├── main.py                      # FastAPI app, router registration
│   ├── business_logic.py            # Member validation rules
│   ├── edi_validator.py             # EDI structural checks
│   ├── database.py                  # Data directory config
│   ├── requirements.txt
│   ├── routers/
│   │   ├── members.py               # /api/members, /api/parse-members, /api/classify-members
│   │   ├── batches.py               # /api/batches, /api/batches/stream/{id}
│   │   ├── files.py                 # /api/upload, /api/check-structure
│   │   ├── renewals.py              # /api/renewals/alerts
│   │   ├── retro_enrollments.py     # /api/retro
│   │   ├── clarifications.py        # /api/clarifications
│   │   ├── metrics.py               # /api/metrics
│   │   └── auth.py                  # /api/login, /api/logout
│   └── ai/
│       ├── agent.py                 # Backward-compat shim, exports all agents
│       ├── chat_agent.py            # Backward-compat shim for streaming
│       ├── config.yaml              # AI Refinery Distiller project config
│       ├── agents/
│       │   ├── base.py              # @register_agent decorator + registry
│       │   ├── classifier.py        # EnrollmentClassifierAgent
│       │   ├── sep_inference.py     # SepInferenceAgent
│       │   ├── normal_enrollment.py # NormalEnrollmentAgent
│       │   ├── decision.py          # DecisionAgent
│       │   ├── evidence_check.py    # EvidenceCheckAgent
│       │   ├── router.py            # EnrollmentRouterAgent (OEP/SEP orchestrator)
│       │   ├── renewal_agent.py     # RenewalProcessorAgent (deterministic + LLM)
│       │   └── retro_agent.py       # RetroEnrollmentOrchestratorAgent (deterministic + LLM)
│       ├── workflows/
│       │   ├── enrollment_pipeline.py  # OEP/SEP streaming runner + dispatcher
│       │   ├── renewal_pipeline.py     # Renewal streaming runner
│       │   └── retro_pipeline.py       # Retro coverage streaming runner
│       ├── core/
│       │   ├── client.py            # AI Refinery client lifecycle
│       │   ├── distiller.py         # Distiller session management
│       │   └── utils.py             # Shared utilities (extract_json_from_llm, etc.)
│       ├── data/
│       │   ├── sanitizer.py         # PII stripping before Distiller
│       │   └── views.py             # Stage-specific data slices
│       ├── chat/
│       │   ├── stream.py            # AI assistant chat loop
│       │   ├── tools.py             # Tool definitions
│       │   ├── tool_executor.py     # Tool implementations
│       │   ├── system_prompt.py     # System prompt
│       │   ├── helpers.py           # Message building
│       │   └── batch_jobs.py        # In-memory batch job registry
│       └── notifications/
│           └── email_agent.py       # SEP missing-docs email (stubbed)
├── client/
│   └── src/
│       ├── app/                     # Next.js page routes
│       │   ├── file-intake/         # EDI upload + structure check
│       │   ├── integrity-workbench/ # Business validation
│       │   ├── classifier/          # Classification runner
│       │   ├── release-staging/     # Batch generation + pipeline execution
│       │   ├── dashboard/           # System overview
│       │   ├── members/             # Member list
│       │   ├── clarifications/      # Members needing attention
│       │   ├── ai-assistant/        # Chat interface
│       │   └── ...
│       ├── components/              # Shared UI components
│       ├── hooks/                   # useFilters, usePagination, etc.
│       └── store/
│           └── uiStore.js           # Zustand: completed batch run state
├── db/
│   └── mongo_connection.py          # MongoDB client + save_member_to_mongo
├── data/                            # EDI data directory (gitignored)
│   └── test_data/
│       └── renewal_and_retro_pipeline_testing/  # 18 EDI test files
└── docs/
    ├── SETUP.md                     # Detailed setup guide
    └── STREAMING_EVENTS.md          # SSE event reference
```

---

## API reference

### Core workflow

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/files` | List uploaded EDI files |
| `POST` | `/api/upload` | Upload an EDI file |
| `POST` | `/api/check-structure` | Validate + parse all uploaded files |
| `GET` | `/api/members` | List all members |
| `POST` | `/api/parse-members` | Run business validation |
| `POST` | `/api/classify-members` | Classify all Ready members |
| `GET` | `/api/batches` | List all batches |
| `POST` | `/api/batches` | Create batches from classified members |
| `POST` | `/api/batches/stream/{id}` | Stream pipeline execution (SSE) |
| `GET` | `/api/metrics` | System-wide counts |

### Renewals & retro (read/manage)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/renewals/alerts` | List premium change alerts |
| `GET` | `/api/renewals/alerts/{id}` | Get alert details |
| `POST` | `/api/renewals/alerts/{id}/approve` | Approve / hold / reject alert |
| `GET` | `/api/retro` | List retro cases |
| `GET` | `/api/retro/{id}` | Get retro case details |
| `POST` | `/api/retro/{id}/step/{step}/confirm` | Confirm a retro workflow step |

### AI assistant

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/assistant/chat/llm` | Streaming chat with tool-calling (SSE) |

---

## Streaming events (SSE)

The batch pipeline endpoint (`POST /api/batches/stream/{id}`) emits these event types:

| Event | When | Payload |
|---|---|---|
| `start` | Stream opens | `{ batchId, memberCount, pipelineType, routingTarget }` |
| `pipeline_progress` | After each member | `{ done, total, enrolled, inReview, failed }` |
| `thinking` | Each pipeline stage | `{ message, scope, agent? }` |
| `agent_call` | Before LLM agent call | `{ agent, message }` |
| `member_result` | Member complete | `{ subscriber_id, name, status, summary }` |
| `done` | All members processed | `{ batchId, processed, failed }` |

See `docs/STREAMING_EVENTS.md` for the full per-pipeline event sequence.

---

## Configuration

### Environment variables (`.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `AI_REFINERY_KEY` | ✅ | — | AI Refinery API key |
| `MONGO_URI` | ✅ | `mongodb://localhost:27017` | MongoDB connection string |
| `MONGO_DB_NAME` | | `health_enroll` | Database name |
| `MONGO_COLLECTION` | | `members` | Members collection name |
| `OEP_START_DATE` | | — | OEP window start (YYYY-MM-DD) |
| `OEP_END_DATE` | | — | OEP window end (YYYY-MM-DD) |
| `DEFAULT_ENROLLMENT_SOURCE` | | `Employer` | Fallback enrollment source |

### AI Refinery config (`server/ai/config.yaml`)

Defines the three Distiller pipelines and their agents. The config hash is cached — the project is only re-created when the file changes.

---

## Test data

18 EDI 834 test files in `data/test_data/renewal_and_retro_pipeline_testing/`:

- **7 renewal files** (`REN00001`–`REN00007`) — various premium delta scenarios
- **8 retro files** (`RET00001`–`RET00008`) — various retroactive period lengths
- **1 OEP file** (`OEP00001`) — standard open enrollment
- **2 mixed files** (`MIX00001`–`MIX00005`) — multiple classification types in one file

All subscriber IDs are unique across files to prevent MongoDB overwrites.

---

## Troubleshooting

**`AI_REFINERY_KEY` missing**
Backend starts but LLM calls fall back to deterministic results. Set the key in `.env`.

**MongoDB connection refused**
Start MongoDB before the backend. Check with `mongosh` or MongoDB Compass.

**Members stuck as `In Batch`**
The pipeline marks stuck members as `Processing Failed` automatically. Use the AI assistant: *"Retry failed members"*.

**OEP dates not set**
`is_within_oep()` returns `None` — all SEP candidates trigger evidence check regardless of timing. Set `OEP_START_DATE` / `OEP_END_DATE` in `.env`.

**LLM returns empty response for renewal/retro**
The agents fall back to deterministic results and log `llm_error` in the analysis. Check the `agent_summary` field in MongoDB for the fallback summary.

**`next build` fails**
Run `npm install` inside `client/`. Ensure Node.js 18+.
