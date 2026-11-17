import os
from contextlib import asynccontextmanager
from typing import Dict, List
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api.agent import router as agent_router
from backend.app.api.alerts import router as alerts_router
from backend.app.api.security import router as security_router
from backend.app.api.system import router as system_router
from backend.app.database.connection import close_pg_pool, get_db_type, init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan handler.
    Initializes database schema upon startup, and cleans up connection pool on shutdown.
    """
    init_db()
    yield
    close_pg_pool()


# Initialize FastAPI application
app = FastAPI(
    title="CloudSentinel API",
    description="Backend API for Linux Infrastructure and Security Monitoring Dashboard",
    version="0.2.0",
    lifespan=lifespan,
)

# Parse allowed CORS origins from environment or use local development defaults.
# Wildcard origins are disallowed to prevent cross-origin abuse.
raw_origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173,https://cloudsentinel.ai.studio,https://cloudsentinel.aistudio.google.com",
)
if raw_origins.strip() == "*":
    allowed_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://cloudsentinel.ai.studio",
        "https://cloudsentinel.aistudio.google.com",
    ]
else:
    allowed_origins: List[str] = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(system_router)
app.include_router(security_router)
app.include_router(alerts_router)
app.include_router(agent_router)


@app.get("/api/health", summary="Health Check")
def health_check() -> Dict[str, str]:
    """
    Returns service health status and database backend type.
    """
    return {
        "status": "healthy",
        "service": "cloudsentinel-backend",
        "database": get_db_type(),
    }


if __name__ == "__main__":
    import uvicorn

    bind_host = os.getenv("HOST", "0.0.0.0")
    bind_port = int(os.getenv("PORT", "8000"))
    uvicorn.run("backend.app.main:app", host=bind_host, port=bind_port)
