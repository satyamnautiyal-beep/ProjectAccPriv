from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from server.routers import files, members, clarifications, batches, metrics, auth

app = FastAPI()

# Allow client to access the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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