import os
from typing import Dict, List
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Initialize FastAPI application
app = FastAPI(
    title="CloudSentinel API",
    description="Backend API for Linux Infrastructure and Security Monitoring Dashboard",
    version="0.1.0",
)

# Parse allowed CORS origins from environment or use local development defaults
raw_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
allowed_origins: List[str] = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", summary="Health Check")
def health_check() -> Dict[str, str]:
    """
    Returns service health status to confirm backend availability.
    """
    return {
        "status": "healthy",
        "service": "cloudsentinel-backend"
    }
