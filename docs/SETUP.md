# HealthEnroll — Setup Guide

Full-stack agentic enrollment platform. Next.js 16 frontend + FastAPI backend + MongoDB + AI Refinery.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Python | 3.10+ | Async patterns require 3.10 minimum |
| Node.js | 18+ | With npm |
| MongoDB | 6+ | Local Community Edition or Atlas URI |
| AI Refinery account | — | Get API key from [sdk.airefinery.accenture.com](https://sdk.airefinery.accenture.com) |

---

## 1. Clone & configure environment

```bash
git clone <repository_url>
cd <repo-folder>
cp .env.example .env
```

Open `.env` and fill in:

- `AI_REFINERY_KEY` — **required**. Your key from the AI Refinery portal.
- `MONGO_URI` — MongoDB connection string. Default `mongodb://localhost:27017` works for local installs.
- `OEP_START_DATE` / `OEP_END_DATE` — set to the current open enrollment window. Controls whether the AI pipeline treats member changes as SEP or OEP. Leave blank to disable OEP gating.

---

## 2. Backend setup

All commands run from the **repo root**.

```bash
# Create and activate virtual environment
python -m venv venv

# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate

# Install dependencies
pip install -r server/requirements.txt

# Start the backend
uvicorn server.main:app --reload
# API: http://localhost:8000
# Swagger: http://localhost:8000/docs
```

---

## 3. Frontend setup

```bash
cd client
npm install
npm run dev
# App: http://localhost:3000
```

**Demo login:** `admin@demo.com` / `admin123`

---

## 4. MongoDB

Start your local MongoDB service before running the backend. The app auto-creates the `health_enroll` database and collections on first use.

**Local (Windows):**
```bash
net start MongoDB
```

**Local (macOS):**
```bash
brew services start mongodb-community
```

**Atlas:** set `MONGO_URI` in `.env` to your Atlas connection string — no local install needed.

---

## 5. Test the workflow

Sample EDI 834 files are in `data/test_data/renewal_and_retro_pipeline_testing/` (18 files covering renewal, retro, OEP, and mixed scenarios).

### UI workflow

1. **File Intake** — upload `.edi` files, click "Check Structure" to validate and ingest
2. **Integrity Workbench** — review members, click "Initiate Member Validations"
3. **Classifier** — click "Run Classifier" to classify all Ready members
4. **Release Staging** — generate batches (one per pipeline type), click "Initiate" to run
5. **Dashboard / Members** — track results

### AI Assistant workflow

Open the **AI Assistant** page and chat naturally:
- *"Check for new EDI files"*
- *"Run business validation"*
- *"Create a batch and process it"*
- *"Show me the current system status"*

---

## 6. Member status flow

```
Upload EDI → Pending Business Validation
                    ↓
           Business Validation
            ↙              ↘
         Ready        Awaiting Clarification
            ↓
       Classification
    ↙       ↓       ↓       ↘
RENEWAL  RETRO   OEP_ENR  SEP_ENR
    ↓       ↓       ↓       ↘
  In Batch (batch created per pipeline type)
    ↓
  Agent Pipeline (streaming)
    ↙           ↓           ↘
Enrolled   Enrolled (SEP)  In Review
```

`Processing Failed` — pipeline error. Use the AI assistant: *"Retry failed members"*.

---

## 7. Project structure

```
├── parser.py                        # EDI 834 parser
├── server/
│   ├── main.py                      # FastAPI app entry point
│   ├── business_logic.py            # Member validation rules
│   ├── edi_validator.py             # EDI structural checks
│   ├── database.py                  # Data directory config
│   ├── requirements.txt
│   ├── routers/
│   │   ├── members.py               # Members, validation, classification
│   │   ├── batches.py               # Batch create + streaming pipeline
│   │   ├── files.py                 # EDI upload + structure check
│   │   ├── renewals.py              # Renewal alert management
│   │   ├── retro_enrollments.py     # Retro case management
│   │   ├── clarifications.py
│   │   ├── metrics.py
│   │   └── auth.py
│   └── ai/
│       ├── agent.py                 # Backward-compat shim
│       ├── chat_agent.py            # Backward-compat shim
│       ├── config.yaml              # AI Refinery Distiller config
│       ├── agents/
│       │   ├── base.py              # @register_agent + registry
│       │   ├── classifier.py        # EnrollmentClassifierAgent
│       │   ├── sep_inference.py     # SepInferenceAgent
│       │   ├── normal_enrollment.py # NormalEnrollmentAgent
│       │   ├── decision.py          # DecisionAgent
│       │   ├── evidence_check.py    # EvidenceCheckAgent
│       │   ├── router.py            # EnrollmentRouterAgent
│       │   ├── renewal_agent.py     # RenewalProcessorAgent
│       │   └── retro_agent.py       # RetroEnrollmentOrchestratorAgent
│       ├── workflows/
│       │   ├── enrollment_pipeline.py  # OEP/SEP runner + dispatcher
│       │   ├── renewal_pipeline.py     # Renewal streaming runner
│       │   └── retro_pipeline.py       # Retro streaming runner
│       ├── core/
│       │   ├── client.py            # AI Refinery client
│       │   ├── distiller.py         # Distiller session management
│       │   └── utils.py             # Shared utilities
│       ├── data/
│       │   ├── sanitizer.py         # PII stripping
│       │   └── views.py             # Stage-specific data slices
│       ├── chat/
│       │   ├── stream.py            # Chat streaming loop
│       │   ├── tools.py             # Tool definitions
│       │   ├── tool_executor.py     # Tool implementations
│       │   ├── system_prompt.py     # System prompt
│       │   ├── helpers.py
│       │   └── batch_jobs.py        # In-memory job registry
│       └── notifications/
│           └── email_agent.py       # SEP email (stubbed)
├── client/
│   └── src/
│       ├── app/                     # Next.js page routes
│       ├── components/              # Shared UI components
│       ├── hooks/                   # Custom React hooks
│       └── store/
│           └── uiStore.js           # Zustand global state
├── db/
│   └── mongo_connection.py          # MongoDB client
├── data/
│   └── test_data/
│       └── renewal_and_retro_pipeline_testing/  # 18 EDI test files
└── docs/
    ├── SETUP.md                     # This file
    └── STREAMING_EVENTS.md          # SSE event reference
```

---

## 8. Troubleshooting

**`AI_REFINERY_KEY` missing**
Backend starts but LLM calls in renewal/retro agents fall back to deterministic results. Set the key in `.env`.

**MongoDB connection refused**
Make sure MongoDB is running before starting the backend. Check with `mongosh` or MongoDB Compass.

**Members stuck as `In Batch`**
The pipeline marks stuck members as `Processing Failed` automatically. Use the AI assistant to retry them.

**OEP dates not set**
`is_within_oep()` returns `None` — all SEP candidates trigger evidence check regardless of timing. Set `OEP_START_DATE` / `OEP_END_DATE` in `.env`.

**`asyncio.run()` error in FastAPI**
Never call `asyncio.run()` inside route handlers — use `await` directly. Already handled in the codebase.

**`next build` fails**
Run `npm install` inside `client/`. Ensure Node.js 18+.
