import json
import logging
import os
import time
from typing import Any, Dict, List, Optional, Tuple
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field

from backend.app.api.auth import verify_agent_token, verify_dashboard_access
from backend.app.database.repositories import (
    get_all_devices,
    get_device_by_id,
    insert_security_events,
    insert_telemetry_record,
    update_device_heartbeat,
    upsert_device,
)
from backend.app.services.alert_engine import evaluate_all_alerts

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent", tags=["Agent"])

# Maximum allowed payload size in bytes (1 MB)
MAX_PAYLOAD_BYTES = 1024 * 1024

# In-memory telemetry cache to avoid querying PostgreSQL on every 10s frontend poll
_LATEST_TELEMETRY_CACHE: Optional[Dict[str, Any]] = None
_LATEST_TELEMETRY_LOCAL_TIME: float = 0.0

# Timestamp tracker to throttle historical database writes (once per 60s per device)
_LAST_HISTORY_WRITE_TIME: Dict[str, float] = {}


def get_cached_telemetry() -> Optional[Tuple[Dict[str, Any], float]]:
    """Return in-memory cached telemetry and the local epoch timestamp when it was received."""
    if _LATEST_TELEMETRY_CACHE is None:
        return None
    return _LATEST_TELEMETRY_CACHE, _LATEST_TELEMETRY_LOCAL_TIME


def set_cached_telemetry(data: Dict[str, Any]) -> None:
    """Update in-memory telemetry cache."""
    global _LATEST_TELEMETRY_CACHE, _LATEST_TELEMETRY_LOCAL_TIME
    _LATEST_TELEMETRY_CACHE = data
    _LATEST_TELEMETRY_LOCAL_TIME = time.time()


# ==============================================================================
# Pydantic Schemas for Ingestion
# ==============================================================================

class SystemInfoPayload(BaseModel):
    hostname: Optional[str] = None
    os: Optional[str] = None
    os_release: Optional[str] = None
    kernel_version: Optional[str] = None
    architecture: Optional[str] = None
    uptime_seconds: Optional[float] = None


class CpuPayload(BaseModel):
    usage_percent: Optional[float] = None
    logical_cores: Optional[int] = None
    load_average: Optional[Dict[str, float]] = None


class MemoryPayload(BaseModel):
    total_bytes: Optional[int] = None
    used_bytes: Optional[int] = None
    available_bytes: Optional[int] = None
    usage_percent: Optional[float] = None


class DiskPayload(BaseModel):
    mount_point: Optional[str] = "/"
    total_bytes: Optional[int] = None
    used_bytes: Optional[int] = None
    free_bytes: Optional[int] = None
    usage_percent: Optional[float] = None


class NetworkAddressPayload(BaseModel):
    family: str
    address: str
    netmask: Optional[str] = None
    broadcast: Optional[str] = None


class NetworkInterfacePayload(BaseModel):
    name: str
    is_up: Optional[bool] = None
    speed_mbps: Optional[float] = None
    mtu: Optional[int] = None
    addresses: List[NetworkAddressPayload] = []


class NetworkPayload(BaseModel):
    interfaces: List[NetworkInterfacePayload] = []


class SecurityEventItemPayload(BaseModel):
    id: str = Field(..., min_length=1, max_length=128)
    timestamp: str
    severity: str
    category: str
    source_ip: str
    target_user: str
    service: str
    attempts: int = 1
    description: str
    created_at: Optional[str] = None


class AgentTelemetryPayload(BaseModel):
    device_id: str = Field(..., min_length=1, max_length=128)
    timestamp: str
    system: SystemInfoPayload
    cpu: CpuPayload
    memory: MemoryPayload
    disk: DiskPayload
    network: Optional[NetworkPayload] = None
    security_events: Optional[List[SecurityEventItemPayload]] = None


class HeartbeatPayload(BaseModel):
    device_id: str = Field(..., min_length=1, max_length=128)


# ==============================================================================
# Ingestion Endpoints
# ==============================================================================

@router.post("/telemetry", summary="Ingest Agent Telemetry")
async def ingest_telemetry(
    request: Request,
    payload: AgentTelemetryPayload,
    token: str = Depends(verify_agent_token),
) -> Dict[str, Any]:
    """
    Authenticated telemetry ingestion endpoint called by the Ubuntu monitoring agent every 15-30s.
    - Updates in-memory cache for zero-DB frontend reads.
    - Upserts device record (setting status to 'online' and updating last_seen).
    - Throttles telemetry_history database writes to once per 60s to optimize Neon free compute.
    - Deduplicates and persists any attached security events.
    - Evaluates alert thresholds on the newly received metrics.
    """
    # Enforce payload size limit
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_PAYLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Telemetry payload exceeds 1MB limit",
        )

    # Determine primary IP address from network payload or request client
    primary_ip = request.client.host if request.client else "127.0.0.1"
    if payload.network and payload.network.interfaces:
        for iface in payload.network.interfaces:
            for addr in iface.addresses:
                if addr.family in ("AF_INET", "IPv4") and not addr.address.startswith("127."):
                    primary_ip = addr.address
                    break

    # Build complete telemetry dict for persistence and frontend serving
    telemetry_data = {
        "system": payload.system.model_dump(),
        "cpu": payload.cpu.model_dump(),
        "memory": payload.memory.model_dump(),
        "disk": payload.disk.model_dump(),
        "network": payload.network.model_dump() if payload.network else {"interfaces": []},
        "device_status": "online",
        "timestamp": payload.timestamp,
    }

    # Store in memory for instant zero-compute frontend polling
    set_cached_telemetry(telemetry_data)

    # Upsert device registration in database
    device_record = {
        "id": payload.device_id,
        "hostname": payload.system.hostname or "ubuntu-laptop",
        "ip_address": primary_ip,
        "os": payload.system.os_release or payload.system.os or "Ubuntu Linux",
        "kernel": payload.system.kernel_version or "Linux",
        "arch": payload.system.architecture or "x86_64",
        "status": "online",
        "last_telemetry": telemetry_data,
    }
    upsert_device(device_record)

    # Ingest security events if attached
    ingested_events_count = 0
    if payload.security_events:
        events_dicts = [e.model_dump() for e in payload.security_events]
        ingested_events_count = insert_security_events(events_dicts)

    # Run automated alert evaluation against this fresh telemetry
    metrics_for_eval = {
        "cpu_percent": payload.cpu.usage_percent,
        "memory_percent": payload.memory.usage_percent,
        "disk_percent": payload.disk.usage_percent,
    }
    eval_result = evaluate_all_alerts(metrics_override=metrics_for_eval)

    # Optimize Neon Free Compute: throttle telemetry_history writes to at most once per 60s per device,
    # or immediately if an alert condition is triggered
    now_epoch = time.time()
    last_write = _LAST_HISTORY_WRITE_TIME.get(payload.device_id, 0.0)
    should_record_history = (now_epoch - last_write >= 60.0) or bool(eval_result.get("alerts_created"))
    if should_record_history:
        insert_telemetry_record(payload.device_id, telemetry_data)
        _LAST_HISTORY_WRITE_TIME[payload.device_id] = now_epoch

    return {
        "status": "success",
        "device_id": payload.device_id,
        "device_status": "online",
        "ingested_security_events": ingested_events_count,
        "alerts_created": len(eval_result.get("alerts_created", [])),
        "alerts_resolved": len(eval_result.get("alerts_resolved", [])),
    }


@router.post("/heartbeat", summary="Agent Heartbeat Ping")
async def agent_heartbeat(
    payload: HeartbeatPayload,
    token: str = Depends(verify_agent_token),
) -> Dict[str, Any]:
    """
    Liveness ping sent by the agent to refresh last_seen and maintain ONLINE status.
    """
    updated = update_device_heartbeat(payload.device_id)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device {payload.device_id} not registered yet",
        )
    return {
        "status": "success",
        "device_id": payload.device_id,
        "device_status": "online",
    }


@router.get("/devices", summary="List Registered Devices")
def list_devices(
    auth: bool = Depends(verify_dashboard_access),
) -> Dict[str, Any]:
    """
    Return all registered devices and their current online/offline status.
    Protected by DASHBOARD_API_KEY if configured.
    """
    devices = get_all_devices(offline_threshold_seconds=60)
    cleaned = []
    for d in devices:
        d_copy = dict(d)
        if isinstance(d_copy.get("last_telemetry"), str):
            try:
                d_copy["last_telemetry"] = json.loads(d_copy["last_telemetry"])
            except Exception:
                pass
        cleaned.append(d_copy)

    return {
        "status": "success",
        "total": len(cleaned),
        "devices": cleaned,
    }


@router.get("/devices/{device_id}", summary="Get Device Status")
def get_device(
    device_id: str,
    auth: bool = Depends(verify_dashboard_access),
) -> Dict[str, Any]:
    """
    Retrieve single device by ID with liveness evaluation.
    Protected by DASHBOARD_API_KEY if configured.
    """
    dev = get_device_by_id(device_id, offline_threshold_seconds=60)
    if not dev:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device {device_id} not found",
        )
    if isinstance(dev.get("last_telemetry"), str):
        try:
            dev["last_telemetry"] = json.loads(dev["last_telemetry"])
        except Exception:
            pass
    return {
        "status": "success",
        "device": dev,
    }
