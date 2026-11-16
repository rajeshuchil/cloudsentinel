import os
from contextlib import asynccontextmanager
from typing import Dict, List
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api.alerts import router as alerts_router
from backend.app.api.security import router as security_router
from backend.app.api.system import router as system_router
from backend.app.database.connection import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan handler.
    Initializes database schema and tables upon startup.
    """
    init_db()
    yield


# Initialize FastAPI application
app = FastAPI(
    title="CloudSentinel API",
    description="Backend API for Linux Infrastructure and Security Monitoring Dashboard",
    version="0.1.0",
    lifespan=lifespan,
)

# Parse allowed CORS origins from environment or use local development defaults
raw_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173")
allowed_origins: List[str] = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(system_router)
app.include_router(security_router)
app.include_router(alerts_router)


@app.get("/api/health", summary="Health Check")
def health_check() -> Dict[str, str]:
    """
    Returns service health status to confirm backend availability.
    """
    return {
        "status": "healthy",
        "service": "cloudsentinel-backend"
    }
