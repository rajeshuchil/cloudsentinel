import json
import logging
import time
from datetime import datetime
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query, Request

from backend.app.api.agent import get_cached_telemetry, set_cached_telemetry
from backend.app.api.auth import check_dashboard_access
from backend.app.collectors.system_collector import get_all_system_metrics
from backend.app.database.connection import get_db_type
from backend.app.database.repositories import (
    get_device_by_id,
    get_latest_active_device,
    get_latest_telemetry_any_device,
    get_latest_telemetry_for_device,
    get_telemetry_history_samples,
)
from backend.app.security.rate_limiter import check_rate_limit, mask_ip_address

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/system", tags=["System"])


def _calculate_liveness_from_timestamp(ts_str: Optional[str], threshold_seconds: int = 60) -> str:
    """Check whether a recorded timestamp is within threshold_seconds of now."""
    if not ts_str:
        return "offline"
    try:
        clean_ts = ts_str.rstrip("Z")
        dt = datetime.fromisoformat(clean_ts)
        elapsed = (datetime.utcnow() - dt).total_seconds()
        return "online" if elapsed <= threshold_seconds else "offline"
    except Exception:
        return "offline"


def _format_telemetry_payload(
    raw_metrics: Dict[str, Any],
    device_id: str,
    recorded_at: str,
    device_status: str,
    mask_ips: bool = False,
) -> Dict[str, Any]:
    """Ensure consistent telemetry structure with preserved device ID and timestamp."""
    system_info = raw_metrics.get("system", {})
    cpu_info = raw_metrics.get("cpu", {})
    mem_info = raw_metrics.get("memory", {})
    disk_info = raw_metrics.get("disk", {})
    net_info = raw_metrics.get("network", {"interfaces": []})

    interfaces = []
    if isinstance(net_info, dict) and "interfaces" in net_info:
        for iface in net_info["interfaces"]:
            iface_dict = dict(iface)
            if mask_ips and "addresses" in iface_dict:
                iface_dict["addresses"] = [
                    {**addr, "address": mask_ip_address(addr.get("address"))}
                    for addr in iface_dict["addresses"]
                ]
            interfaces.append(iface_dict)

    return {
        "device_id": device_id,
        "timestamp": recorded_at,
        "recorded_at": recorded_at,
        "device_status": device_status,
        "system": {
            "hostname": system_info.get("hostname") or device_id,
            "os": system_info.get("os") or "Ubuntu Linux",
            "os_release": system_info.get("os_release") or system_info.get("os") or "Ubuntu Linux",
            "kernel_version": system_info.get("kernel_version") or "Linux",
            "architecture": system_info.get("architecture") or "x86_64",
            "uptime_seconds": system_info.get("uptime_seconds") or 0.0,
        },
        "cpu": {
            "usage_percent": cpu_info.get("usage_percent", 0.0),
            "logical_cores": cpu_info.get("logical_cores", 1),
            "load_average": cpu_info.get("load_average", {"1m": 0.0, "5m": 0.0, "15m": 0.0}),
        },
        "memory": {
            "total_bytes": mem_info.get("total_bytes", 0),
            "used_bytes": mem_info.get("used_bytes", 0),
            "available_bytes": mem_info.get("available_bytes", 0),
            "usage_percent": mem_info.get("usage_percent", 0.0),
        },
        "disk": {
            "mount_point": disk_info.get("mount_point", "/"),
            "total_bytes": disk_info.get("total_bytes", 0),
            "used_bytes": disk_info.get("used_bytes", 0),
            "free_bytes": disk_info.get("free_bytes", 0),
            "usage_percent": disk_info.get("usage_percent", 0.0),
        },
        "network": {"interfaces": interfaces},
    }


@router.get("", summary="Get System Metrics", response_model=Dict[str, Any])
def read_system_metrics(
    request: Request = None,
    device_id: Optional[str] = Query(default=None, description="Optional target device ID to retrieve metrics for"),
    auth: Optional[bool] = None,
    is_admin: bool = Depends(check_dashboard_access),
) -> Dict[str, Any]:
    """
    Retrieve real-time or latest persisted Linux host telemetry.
    Publicly accessible without API key for live monitoring dashboard.
    Rate limited for anonymous requests; masks sensitive IP addresses when unauthenticated.
    """
    effective_admin = is_admin or bool(auth)
    if request:
        check_rate_limit(request, is_admin=effective_admin)

    try:
        # Sanitize device_id if called directly without query parameter
        if not isinstance(device_id, str):
            device_id = None

        # 1. In-memory cache check (only if no specific device requested or cache matches device)
        cached_info = get_cached_telemetry()
        if cached_info and (not device_id or cached_info[0].get("device_id") == device_id):
            data, received_at = cached_info
            elapsed = time.time() - received_at
            data_copy = dict(data)
            # Evaluate live status: offline after 60s silence
            data_copy["device_status"] = "offline" if elapsed > 60.0 else "online"

            if not effective_admin and "network" in data_copy and "interfaces" in data_copy["network"]:
                sanitized_ifaces = []
                for iface in data_copy["network"]["interfaces"]:
                    iface_dict = dict(iface)
                    if "addresses" in iface_dict:
                        iface_dict["addresses"] = [
                            {**addr, "address": mask_ip_address(addr.get("address"))}
                            for addr in iface_dict["addresses"]
                        ]
                    sanitized_ifaces.append(iface_dict)
                data_copy["network"] = {"interfaces": sanitized_ifaces}

            return data_copy

        # 2. Check telemetry_history for selected device or most recently recorded device
        telemetry_rec = None
        if device_id:
            telemetry_rec = get_latest_telemetry_for_device(device_id)
        if not telemetry_rec:
            telemetry_rec = get_latest_telemetry_any_device()

        if telemetry_rec and telemetry_rec.get("raw_metrics"):
            raw = telemetry_rec["raw_metrics"]
            target_id = telemetry_rec["device_id"]
            recorded_at = telemetry_rec.get("recorded_at") or raw.get("timestamp") or ""

            # Check device registration for liveness and last_seen
            dev = get_device_by_id(target_id, offline_threshold_seconds=60)
            status = dev.get("status") if dev else _calculate_liveness_from_timestamp(recorded_at)

            payload = _format_telemetry_payload(
                raw_metrics=raw,
                device_id=target_id,
                recorded_at=recorded_at,
                device_status=status,
                mask_ips=False,
            )

            # Update cache with unmasked data if device is currently online
            if status == "online":
                set_cached_telemetry(payload)

            if not effective_admin:
                return _format_telemetry_payload(
                    raw_metrics=raw,
                    device_id=target_id,
                    recorded_at=recorded_at,
                    device_status=status,
                    mask_ips=True,
                )

            return payload

        # 3. Check devices table fallback
        active_device = (
            get_device_by_id(device_id, offline_threshold_seconds=60)
            if device_id
            else get_latest_active_device(offline_threshold_seconds=60)
        )
        if active_device and active_device.get("last_telemetry"):
            telem = active_device["last_telemetry"]
            if isinstance(telem, str):
                telem = json.loads(telem)

            telem["device_status"] = active_device.get("status", "offline")
            telem["device_id"] = active_device.get("id")
            telem["timestamp"] = active_device.get("last_seen") or telem.get("timestamp")

            if not effective_admin and "network" in telem and "interfaces" in telem["network"]:
                sanitized_ifaces = []
                for iface in telem["network"]["interfaces"]:
                    iface_dict = dict(iface)
                    if "addresses" in iface_dict:
                        iface_dict["addresses"] = [
                            {**addr, "address": mask_ip_address(addr.get("address"))}
                            for addr in iface_dict["addresses"]
                        ]
                    sanitized_ifaces.append(iface_dict)
                telem["network"] = {"interfaces": sanitized_ifaces}

            if telem["device_status"] == "online":
                set_cached_telemetry(telem)
            return telem

        # 4. Production template when no device has registered yet
        if get_db_type() == "postgres":
            return {
                "device_id": device_id or "unregistered",
                "timestamp": None,
                "recorded_at": None,
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

        # 5. Local development fallback (SQLite): collect workstation metrics via psutil
        metrics = get_all_system_metrics()
        metrics["device_status"] = "online"
        metrics["device_id"] = device_id or "dev-workstation"
        if not effective_admin and "network" in metrics and "interfaces" in metrics["network"]:
            sanitized_ifaces = []
            for iface in metrics["network"]["interfaces"]:
                iface_dict = dict(iface)
                if "addresses" in iface_dict:
                    iface_dict["addresses"] = [
                        {**addr, "address": mask_ip_address(addr.get("address"))}
                        for addr in iface_dict["addresses"]
                    ]
                sanitized_ifaces.append(iface_dict)
            metrics["network"] = {"interfaces": sanitized_ifaces}
        return metrics

    except Exception as e:
        logger.error("Error in read_system_metrics: %s", e, exc_info=True)
        return {
            "device_id": device_id or "error",
            "timestamp": None,
            "recorded_at": None,
            "system": {
                "hostname": "Error Reading Telemetry",
                "os": "Ubuntu Linux",
                "os_release": str(e),
                "kernel_version": "—",
                "architecture": "—",
                "uptime_seconds": 0,
            },
            "cpu": {"usage_percent": 0.0, "logical_cores": 0, "load_average": {"1m": 0.0, "5m": 0.0, "15m": 0.0}},
            "memory": {"total_bytes": 0, "used_bytes": 0, "available_bytes": 0, "usage_percent": 0.0},
            "disk": {"mount_point": "/", "total_bytes": 0, "used_bytes": 0, "free_bytes": 0, "usage_percent": 0.0},
            "network": {"interfaces": []},
            "device_status": "offline",
            "error": str(e),
        }


@router.get("/history", summary="Get System Telemetry History", response_model=Dict[str, Any])
def read_system_history(
    request: Request = None,
    device_id: Optional[str] = Query(default=None, description="Optional target device ID to retrieve history for"),
    limit: int = Query(default=60, ge=1, le=200, description="Number of historical samples to retrieve"),
    auth: Optional[bool] = None,
    is_admin: bool = Depends(check_dashboard_access),
) -> Dict[str, Any]:
    """
    Retrieve historical telemetry records sorted chronologically ascending.
    Allows frontend charts to render real historical samples from Neon on load.
    Rate limited for public requests.
    """
    effective_admin = is_admin or bool(auth)
    if request:
        check_rate_limit(request, is_admin=effective_admin)

    if not isinstance(limit, int):
        limit = 60
    if not isinstance(device_id, str):
        device_id = None

    samples = get_telemetry_history_samples(device_id=device_id, limit=limit)
    return {
        "status": "success",
        "total": len(samples),
        "samples": samples,
    }
