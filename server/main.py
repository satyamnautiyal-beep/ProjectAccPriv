import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from server.routers import files, members, clarifications, batches, metrics, auth

app = FastAPI()

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
# allow_origins=["*"] is incompatible with allow_credentials=True — browsers
# reject that combination and block all credentialed requests (cookies).
# We explicitly list the allowed origins instead.
_RAW_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000"
)
ALLOWED_ORIGINS = [o.strip() for o in _RAW_ORIGINS.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "HealthEnroll FastAPI Backend is Running!"}

app.include_router(files.router)
app.include_router(members.router)
app.include_router(clarifications.router)
app.include_router(batches.router)
app.include_router(metrics.router)
app.include_router(auth.router)