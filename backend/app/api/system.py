import json
import logging
import time
from typing import Any, Dict
from fastapi import APIRouter, Depends

from backend.app.api.agent import get_cached_telemetry, set_cached_telemetry
from backend.app.api.auth import verify_dashboard_access
from backend.app.collectors.system_collector import get_all_system_metrics
from backend.app.database.connection import get_db_type
from backend.app.database.repositories import get_latest_active_device

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/system", tags=["System"])


@router.get("", summary="Get System Metrics", response_model=Dict[str, Any])
def read_system_metrics(
    auth: bool = Depends(verify_dashboard_access),
) -> Dict[str, Any]:
    """
    Retrieve real-time Linux host telemetry.
    1. Checks in-memory cache to serve telemetry without hitting Neon database on every poll.
    2. Dynamically evaluates 'online' vs 'offline' liveness (offline after 60s silence).
    3. In production (Neon PostgreSQL), returns preserved laptop telemetry or awaiting template,
       never returning Render container metrics.
    4. In local development (SQLite), falls back to local psutil collection if no agent is running.
    """
    # 1. Check in-memory telemetry cache (zero database compute wakeup)
    cached_info = get_cached_telemetry()
    if cached_info:
        data, received_at = cached_info
        elapsed = time.time() - received_at
        data_copy = dict(data)
        data_copy["device_status"] = "offline" if elapsed > 60.0 else "online"
        return data_copy

    # 2. Check persistent database for most recently active device
    active_device = get_latest_active_device(offline_threshold_seconds=60)
    if active_device and active_device.get("last_telemetry"):
        try:
            telem = active_device["last_telemetry"]
            if isinstance(telem, str):
                telem = json.loads(telem)

            telem["device_status"] = active_device.get("status", "offline")
            # Populate in-memory cache for subsequent 10s polls
            set_cached_telemetry(telem)
            return telem
        except Exception as e:
            logger.warning("Failed to deserialize agent telemetry for %s: %s", active_device.get("id"), e)

    # 3. In production on Render (PostgreSQL enabled), do not return Render container metrics
    if get_db_type() == "postgres":
        return {
            "system": {
                "hostname": "Awaiting Agent Registration...",
                "os": "Ubuntu Linux",
                "os_release": "Agent disconnected or pending initial telemetry",
                "kernel_version": "—",
                "architecture": "—",
                "uptime_seconds": 0,
            },
            "cpu": {
                "usage_percent": 0.0,
                "logical_cores": 0,
                "load_average": {"1m": 0.0, "5m": 0.0, "15m": 0.0},
            },
            "memory": {
                "total_bytes": 0,
                "used_bytes": 0,
                "available_bytes": 0,
                "usage_percent": 0.0,
            },
            "disk": {
                "mount_point": "/",
                "total_bytes": 0,
                "used_bytes": 0,
                "free_bytes": 0,
                "usage_percent": 0.0,
            },
            "network": {
                "interfaces": [],
            },
            "device_status": "offline",
        }

    # 4. Local development mode fallback (SQLite): collect local workstation metrics via psutil
    metrics = get_all_system_metrics()
    metrics["device_status"] = "online"
    return metrics
