# HealthEnroll — Setup Guide

Full-stack agentic enrollment platform. Next.js 16 frontend + FastAPI backend + MongoDB + AI Refinery.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Python | 3.10+ | 3.10 minimum — async patterns require it |
| Node.js | 18+ | With npm |
| MongoDB | 6+ | Local Community Edition or Atlas URI |
| Git | any | |
| AI Refinery account | — | Get API key from https://sdk.airefinery.accenture.com |

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
- `OEP_START_DATE` / `OEP_END_DATE` — set to the current open enrollment window. Controls whether the AI pipeline treats member changes as SEP or OEP.

Everything else has sensible defaults and can be left as-is to start.

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
```

---

## 3. Frontend setup

```bash
cd client
npm install
cd ..
```

---

## 4. MongoDB

Start your local MongoDB service before running the backend. The app auto-creates the `health_enroll` database and `members` / `batches` collections on first use.

**Local (Windows):**
```bash
net start MongoDB
```

**Local (macOS):**
```bash
brew services start mongodb-community
```

**Atlas:** just set `MONGO_URI` in `.env` to your Atlas connection string — no local install needed.

---

## 5. Run the application

You need two terminals running simultaneously.

**Terminal 1 — Backend** (from repo root, venv activated):
```bash
uvicorn server.main:app --reload
```
- API: `http://localhost:8000`
- Swagger docs: `http://localhost:8000/docs`

**Terminal 2 — Frontend** (from repo root):
```bash
cd client && npm run dev
```
- App: `http://localhost:3000`

**Login credentials (demo):**
- Email: `admin@demo.com`
- Password: `admin123`

---

## 6. Test the workflow

Sample EDI 834 files are in `test_data/demo/`. Two categories:

- `test_data/demo/non_sep/` — standard OEP members, should enroll cleanly
- `test_data/demo/sep/` — SEP members (household change, move, loss of coverage), triggers evidence check

### Manual workflow (UI)

1. **Batch Onboard** — upload `.edi` files, click "Check Batch Health" to validate and ingest
2. **Integrity Workbench** — review members, click "Run Business Validation"
3. **Release Staging** — generate a batch from Ready members, click "Initiate Enrollment"
4. **Approval** — approve or hold batches before release
5. **Enrollment Monitoring** — track batch status

### AI Assistant workflow

Open the **AI Assistant** page and chat naturally:
- *"Check for new EDI files"*
- *"Run business validation"*
- *"Create a batch and process it"*
- *"Show me the current system status"*

The assistant uses AI Refinery tool-calling to execute real actions. Chat history persists across page navigation.

---

## 7. Project structure

```
├── server/                  # FastAPI backend
│   ├── main.py              # App entry point
│   ├── business_logic.py    # Member validation rules
│   ├── edi_validator.py     # EDI structural checks
│   ├── database.py          # Data directory config
│   ├── requirements.txt
│   ├── routers/
│   │   ├── members.py       # Members + LLM chat endpoint
│   │   ├── batches.py       # Batch create/approve/initiate
│   │   ├── files.py         # EDI upload/check/reject
│   │   ├── clarifications.py
│   │   ├── metrics.py
│   │   └── auth.py
│   └── ai/
│       ├── agent.py         # AI Refinery enrollment pipeline
│       ├── chat_agent.py    # LLM chat agent with tool calling
│       ├── config.yaml      # Distiller project config
│       ├── email_agent.py   # SEP email drafting
│       ├── sep_required_docs.json
│       └── mock_submitted_docs.json
├── client/                  # Next.js 16 frontend
│   └── src/
│       ├── app/             # Page routes
│       ├── components/      # Shared components + layout
│       └── store/           # Zustand global state
├── db/                      # MongoDB utilities
├── data/                    # EDI data directory (gitignored)
├── test_data/demo/          # Sample EDI files for testing
├── parser.py                # EDI 834 parser
└── .env.example
```

---

## 8. Member status flow

```
Upload EDI → Pending Business Validation
                ↓
         Business Validation
          ↙              ↘
       Ready        Awaiting Clarification
         ↓
      In Batch (batch created)
         ↓
   AI Enrollment Pipeline
    ↙          ↓          ↘
Enrolled   Enrolled (SEP)  In Review
(OEP)      evidence complete  (SEP missing docs
                               or hard blocks)
```

`Processing Failed` — pipeline error, use "Retry failed members" in the AI assistant.

---

## 9. Troubleshooting

**`AI_REFINERY_KEY` missing error**
The backend will refuse to start the chat agent. Set the key in `.env`.

**MongoDB connection refused**
Make sure MongoDB is running before starting the backend. Check with `mongosh` or MongoDB Compass.

**`asyncio.run() cannot be called from a running event loop`**
Never call `asyncio.run()` inside FastAPI route handlers — use `await` directly. This is already handled in the codebase.

**Members stuck as `"In Batch"` after processing**
The pipeline sweep handles this automatically — stuck members are marked `"Processing Failed"`. Use the AI assistant to retry them.

**`pyx12` or `google-cloud-storage` import errors**
These are removed from `requirements.txt`. If you have an older install, run `pip install -r server/requirements.txt` again.

**Next.js `Module not found`**
Run `npm install` inside the `client/` folder.

**OEP dates not set**
If `OEP_START_DATE` / `OEP_END_DATE` are blank, `is_within_oep()` returns `None` and the pipeline treats all SEP candidates as requiring evidence check regardless of timing. Set them to your actual enrollment window.
