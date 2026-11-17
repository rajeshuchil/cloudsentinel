import hashlib
import json
import logging
import sqlite3
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from backend.app.database.connection import get_db_connection

logger = logging.getLogger(__name__)


def _utc_now_iso() -> str:
    """Return current UTC time formatted as an ISO-8601 string."""
    return datetime.utcnow().isoformat() + "Z"


# ==============================================================================
# Security Event Repository
# ==============================================================================

def insert_security_event(event: Dict[str, Any], db_path: Optional[str] = None) -> bool:
    """
    Insert a single security event into the database.
    Ignores the insert if the deterministic event ID already exists.
    Returns True if inserted, False if it was a duplicate and ignored.
    """
    created_at = event.get("created_at") or _utc_now_iso()
    query = """
        INSERT OR IGNORE INTO security_events (
            id, timestamp, severity, category, source_ip,
            target_user, service, attempts, description, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    params = (
        event["id"],
        event["timestamp"],
        event["severity"],
        event["category"],
        event["source_ip"],
        event["target_user"],
        event["service"],
        event.get("attempts", 1),
        event["description"],
        created_at,
    )

    with get_db_connection(db_path) as conn:
        with conn:
            cursor = conn.execute(query, params)
            return cursor.rowcount > 0


def insert_security_events(events: List[Dict[str, Any]], db_path: Optional[str] = None) -> int:
    """
    Batch insert multiple security events within a single transaction.
    Safely ignores duplicates based on event ID.
    Returns the count of newly inserted records.
    """
    if not events:
        return 0

    query = """
        INSERT OR IGNORE INTO security_events (
            id, timestamp, severity, category, source_ip,
            target_user, service, attempts, description, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    inserted_count = 0

    with get_db_connection(db_path) as conn:
        with conn:
            for event in events:
                created_at = event.get("created_at") or _utc_now_iso()
                params = (
                    event["id"],
                    event["timestamp"],
                    event["severity"],
                    event["category"],
                    event["source_ip"],
                    event["target_user"],
                    event["service"],
                    event.get("attempts", 1),
                    event["description"],
                    created_at,
                )
                cursor = conn.execute(query, params)
                if cursor.rowcount > 0:
                    inserted_count += 1

    return inserted_count


def get_security_events(
    limit: int = 50,
    offset: int = 0,
    category: Optional[str] = None,
    severity: Optional[str] = None,
    source_ip: Optional[str] = None,
    db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Retrieve stored security events ordered by timestamp descending.
    Supports optional filtering by category, severity, and source IP.
    """
    conditions = []
    params: List[Any] = []

    if category:
        conditions.append("category = ?")
        params.append(category)
    if severity:
        conditions.append("severity = ?")
        params.append(severity)
    if source_ip:
        conditions.append("source_ip = ?")
        params.append(source_ip)

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    query = f"""
        SELECT id, timestamp, severity, category, source_ip,
               target_user, service, attempts, description, created_at
        FROM security_events
        {where_clause}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
    """
    params.extend([limit, offset])

    with get_db_connection(db_path) as conn:
        rows = conn.execute(query, params).fetchall()
        return [dict(row) for row in rows]


def get_security_event_by_id(event_id: str, db_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Retrieve a single security event by its deterministic ID.
    """
    query = """
        SELECT id, timestamp, severity, category, source_ip,
               target_user, service, attempts, description, created_at
        FROM security_events
        WHERE id = ?
    """
    with get_db_connection(db_path) as conn:
        row = conn.execute(query, (event_id,)).fetchone()
        return dict(row) if row else None


def count_security_events(
    category: Optional[str] = None,
    severity: Optional[str] = None,
    db_path: Optional[str] = None,
) -> int:
    """
    Return the total number of stored security events matching optional filters.
    """
    conditions = []
    params: List[Any] = []

    if category:
        conditions.append("category = ?")
        params.append(category)
    if severity:
        conditions.append("severity = ?")
        params.append(severity)

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    query = f"SELECT COUNT(*) FROM security_events {where_clause}"

    with get_db_connection(db_path) as conn:
        row = conn.execute(query, params).fetchone()
        return row[0] if row else 0


# ==============================================================================
# Alert Repository
# ==============================================================================

def create_alert(alert_data: Dict[str, Any], db_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Create a new operational or security alert.
    Initial status is always 'active'.
    """
    now = _utc_now_iso()
    alert_id = alert_data.get("id") or hashlib.sha256(str(uuid.uuid4()).encode()).hexdigest()[:16]
    status = alert_data.get("status", "active")
    if status not in ("active", "acknowledged", "resolved"):
        raise ValueError(f"Invalid alert status: {status}")

    query = """
        INSERT INTO alerts (
            id, title, description, severity, source,
            status, created_at, updated_at, acknowledged_at, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    params = (
        alert_id,
        alert_data["title"],
        alert_data["description"],
        alert_data["severity"],
        alert_data.get("source", "system"),
        status,
        now,
        now,
        alert_data.get("acknowledged_at"),
        alert_data.get("resolved_at"),
    )

    with get_db_connection(db_path) as conn:
        with conn:
            conn.execute(query, params)

    return get_alert_by_id(alert_id, db_path=db_path)  # type: ignore


def get_alerts(
    limit: int = 50,
    offset: int = 0,
    status: Optional[str] = None,
    severity: Optional[str] = None,
    db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Retrieve alerts ordered by creation time descending.
    Supports optional status and severity filters.
    """
    conditions = []
    params: List[Any] = []

    if status:
        conditions.append("status = ?")
        params.append(status)
    if severity:
        conditions.append("severity = ?")
        params.append(severity)

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    query = f"""
        SELECT id, title, description, severity, source,
               status, created_at, updated_at, acknowledged_at, resolved_at
        FROM alerts
        {where_clause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    """
    params.extend([limit, offset])

    with get_db_connection(db_path) as conn:
        rows = conn.execute(query, params).fetchall()
        return [dict(row) for row in rows]


def get_alert_by_id(alert_id: str, db_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Retrieve a single alert by its unique identifier.
    """
    query = """
        SELECT id, title, description, severity, source,
               status, created_at, updated_at, acknowledged_at, resolved_at
        FROM alerts
        WHERE id = ?
    """
    with get_db_connection(db_path) as conn:
        row = conn.execute(query, (alert_id,)).fetchone()
        return dict(row) if row else None


def acknowledge_alert(alert_id: str, db_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Transition an active alert to 'acknowledged'.
    Rules:
    - If alert does not exist: returns None.
    - If alert is already 'acknowledged': returns current record (idempotent).
    - If alert is already 'resolved': raises ValueError (invalid state transition).
    """
    current = get_alert_by_id(alert_id, db_path=db_path)
    if not current:
        return None

    if current["status"] == "resolved":
        raise ValueError("Cannot acknowledge an alert that has already been resolved.")

    if current["status"] == "acknowledged":
        return current

    now = _utc_now_iso()
    query = """
        UPDATE alerts
        SET status = 'acknowledged',
            acknowledged_at = ?,
            updated_at = ?
        WHERE id = ?
    """
    with get_db_connection(db_path) as conn:
        with conn:
            conn.execute(query, (now, now, alert_id))

    return get_alert_by_id(alert_id, db_path=db_path)


def resolve_alert(alert_id: str, db_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Transition an active or acknowledged alert to 'resolved'.
    Rules:
    - If alert does not exist: returns None.
    - If alert is already 'resolved': returns current record (idempotent).
    """
    current = get_alert_by_id(alert_id, db_path=db_path)
    if not current:
        return None

    if current["status"] == "resolved":
        return current

    now = _utc_now_iso()
    query = """
        UPDATE alerts
        SET status = 'resolved',
            resolved_at = ?,
            updated_at = ?
        WHERE id = ?
    """
    with get_db_connection(db_path) as conn:
        with conn:
            conn.execute(query, (now, now, alert_id))

    return get_alert_by_id(alert_id, db_path=db_path)


def reopen_alert(alert_id: str, db_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Transition a resolved or acknowledged alert back to 'active'.
    Rules:
    - If alert does not exist: returns None.
    - If alert is already 'active': returns current record (idempotent).
    """
    current = get_alert_by_id(alert_id, db_path=db_path)
    if not current:
        return None

    if current["status"] == "active":
        return current

    now = _utc_now_iso()
    query = """
        UPDATE alerts
        SET status = 'active',
            updated_at = ?
        WHERE id = ?
    """
    with get_db_connection(db_path) as conn:
        with conn:
            conn.execute(query, (now, alert_id))

    return get_alert_by_id(alert_id, db_path=db_path)



def get_open_alert_by_source(source: str, db_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Retrieve any currently open (active or acknowledged) alert for a specific source.
    """
    query = """
        SELECT id, title, description, severity, source,
               status, created_at, updated_at, acknowledged_at, resolved_at
        FROM alerts
        WHERE source = ? AND status IN ('active', 'acknowledged')
        ORDER BY created_at DESC
        LIMIT 1
    """
    with get_db_connection(db_path) as conn:
        row = conn.execute(query, (source,)).fetchone()
        return dict(row) if row else None


def update_alert_metrics(
    alert_id: str,
    severity: str,
    description: str,
    db_path: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Update the severity and description of an existing open alert while preserving its current status
    (e.g., acknowledged remains acknowledged).
    """
    now = _utc_now_iso()
    query = """
        UPDATE alerts
        SET severity = ?,
            description = ?,
            updated_at = ?
        WHERE id = ?
    """
    with get_db_connection(db_path) as conn:
        with conn:
            conn.execute(query, (severity, description, now, alert_id))

    return get_alert_by_id(alert_id, db_path=db_path)


# ==============================================================================
# Device & Telemetry Repositories (Agent Integration)
# ==============================================================================

def upsert_device(device_data: Dict[str, Any], db_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Insert or update a registered device record upon telemetry receipt or heartbeat.
    Updates last_seen and status to 'online'.
    """
    now = _utc_now_iso()
    created_at = device_data.get("created_at") or now
    last_telemetry = device_data.get("last_telemetry")
    if isinstance(last_telemetry, dict):
        last_telemetry_str = json.dumps(last_telemetry)
    else:
        last_telemetry_str = last_telemetry

    query = """
        INSERT INTO devices (
            id, hostname, ip_address, os, kernel, arch,
            status, last_seen, last_telemetry, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            hostname = excluded.hostname,
            ip_address = excluded.ip_address,
            os = excluded.os,
            kernel = excluded.kernel,
            arch = excluded.arch,
            status = excluded.status,
            last_seen = excluded.last_seen,
            last_telemetry = COALESCE(excluded.last_telemetry, devices.last_telemetry),
            updated_at = excluded.updated_at
    """
    params = (
        device_data["id"],
        device_data.get("hostname", "unknown"),
        device_data.get("ip_address", "127.0.0.1"),
        device_data.get("os", "Linux"),
        device_data.get("kernel", "unknown"),
        device_data.get("arch", "x86_64"),
        device_data.get("status", "online"),
        now,
        last_telemetry_str,
        created_at,
        now,
    )

    with get_db_connection(db_path) as conn:
        with conn:
            conn.execute(query, params)

    return get_device_by_id(device_data["id"], db_path=db_path)  # type: ignore


def get_device_by_id(
    device_id: str,
    offline_threshold_seconds: int = 60,
    db_path: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Retrieve a device by its identifier, evaluating whether it should be marked offline.
    """
    query = """
        SELECT id, hostname, ip_address, os, kernel, arch,
               status, last_seen, last_telemetry, created_at, updated_at
        FROM devices
        WHERE id = ?
    """
    try:
        with get_db_connection(db_path) as conn:
            row = conn.execute(query, (device_id,)).fetchone()
            if not row:
                # If not in devices, check if it exists in telemetry_history
                latest_th = get_latest_telemetry_for_device(device_id, db_path=db_path)
                if not latest_th:
                    return None
                raw = latest_th.get("raw_metrics", {})
                sys_info = raw.get("system", {}) if isinstance(raw, dict) else {}
                return {
                    "id": device_id,
                    "hostname": sys_info.get("hostname", device_id),
                    "ip_address": "127.0.0.1",
                    "os": sys_info.get("os_release") or sys_info.get("os") or "Ubuntu Linux",
                    "kernel": sys_info.get("kernel_version", "Linux"),
                    "arch": sys_info.get("architecture", "x86_64"),
                    "status": "offline",
                    "last_seen": latest_th.get("recorded_at", _utc_now_iso()),
                    "last_telemetry": raw,
                    "created_at": latest_th.get("recorded_at", _utc_now_iso()),
                    "updated_at": latest_th.get("recorded_at", _utc_now_iso()),
                }
            dev = dict(row)

        if not dev.get("last_telemetry"):
            latest_th = get_latest_telemetry_for_device(dev["id"], db_path=db_path)
            if latest_th and latest_th.get("raw_metrics"):
                dev["last_telemetry"] = latest_th["raw_metrics"]
        elif isinstance(dev.get("last_telemetry"), str):
            try:
                dev["last_telemetry"] = json.loads(dev["last_telemetry"])
            except Exception:
                pass

        return _evaluate_device_liveness(dev, offline_threshold_seconds, db_path=db_path)
    except Exception as e:
        logger.error("Database error retrieving device %s: %s", device_id, e)
        return None


def get_distinct_device_ids_from_telemetry(
    db_path: Optional[str] = None,
) -> List[str]:
    """
    Retrieve list of unique device IDs recorded in telemetry_history.
    """
    query = "SELECT DISTINCT device_id FROM telemetry_history ORDER BY device_id;"
    try:
        with get_db_connection(db_path) as conn:
            rows = conn.execute(query).fetchall()
            return [str(r[0]) for r in rows if r and r[0]]
    except Exception as e:
        logger.error("Database error retrieving distinct device IDs: %s", e)
        return []


def get_all_devices(
    offline_threshold_seconds: int = 60,
    db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Retrieve all registered devices, evaluating liveness status for each.
    If a device's last_telemetry column is null or empty, populate it from telemetry_history.
    Ensures any devices with historical telemetry records are included even if not yet in devices table.
    """
    query = """
        SELECT id, hostname, ip_address, os, kernel, arch,
               status, last_seen, last_telemetry, created_at, updated_at
        FROM devices
        ORDER BY last_seen DESC
    """
    try:
        with get_db_connection(db_path) as conn:
            rows = conn.execute(query).fetchall()
            devices = [dict(r) for r in rows]

        existing_ids = {d["id"] for d in devices}
        th_device_ids = get_distinct_device_ids_from_telemetry(db_path=db_path)
        for dev_id in th_device_ids:
            if dev_id not in existing_ids:
                synth = get_device_by_id(dev_id, offline_threshold_seconds=offline_threshold_seconds, db_path=db_path)
                if synth:
                    devices.append(synth)
                    existing_ids.add(dev_id)

        evaluated = []
        for d in devices:
            if not d.get("last_telemetry"):
                latest_th = get_latest_telemetry_for_device(d["id"], db_path=db_path)
                if latest_th and latest_th.get("raw_metrics"):
                    d["last_telemetry"] = latest_th["raw_metrics"]
            elif isinstance(d.get("last_telemetry"), str):
                try:
                    d["last_telemetry"] = json.loads(d["last_telemetry"])
                except Exception:
                    pass
            evaluated.append(_evaluate_device_liveness(d, offline_threshold_seconds, db_path=db_path))

        return evaluated
    except Exception as e:
        logger.error("Database error retrieving all devices: %s", e)
        return []


def get_latest_active_device(
    offline_threshold_seconds: int = 60,
    db_path: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Retrieve the most recently reporting device, updating status if stale.
    Falls back to latest record in telemetry_history if devices table is empty.
    """
    devices = get_all_devices(offline_threshold_seconds=offline_threshold_seconds, db_path=db_path)
    if devices:
        return devices[0]

    # Fallback to telemetry_history
    latest_th = get_latest_telemetry_any_device(db_path=db_path)
    if latest_th:
        raw = latest_th.get("raw_metrics", {})
        sys_info = raw.get("system", {}) if isinstance(raw, dict) else {}
        return {
            "id": latest_th["device_id"],
            "hostname": sys_info.get("hostname", latest_th["device_id"]),
            "ip_address": "127.0.0.1",
            "os": sys_info.get("os_release") or sys_info.get("os") or "Ubuntu Linux",
            "kernel": sys_info.get("kernel_version", "Linux"),
            "arch": sys_info.get("architecture", "x86_64"),
            "status": "offline",
            "last_seen": latest_th.get("recorded_at", _utc_now_iso()),
            "last_telemetry": raw,
            "created_at": latest_th.get("recorded_at", _utc_now_iso()),
            "updated_at": latest_th.get("recorded_at", _utc_now_iso()),
        }

    return None


def update_device_heartbeat(device_id: str, db_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Update device last_seen timestamp and mark status 'online'.
    """
    now = _utc_now_iso()
    query = """
        UPDATE devices
        SET status = 'online',
            last_seen = ?,
            updated_at = ?
        WHERE id = ?
    """
    with get_db_connection(db_path) as conn:
        with conn:
            cursor = conn.execute(query, (now, now, device_id))
            if cursor.rowcount == 0:
                return None

    return get_device_by_id(device_id, db_path=db_path)


def _evaluate_device_liveness(
    device: Dict[str, Any],
    threshold_seconds: int = 60,
    db_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Inspect device last_seen. If older than threshold_seconds, update to 'offline'.
    """
    last_seen_str = device.get("last_seen")
    if not last_seen_str:
        return device

    try:
        # Parse ISO timestamp (handling 'Z' suffix)
        clean_ts = last_seen_str.rstrip("Z")
        last_seen_dt = datetime.fromisoformat(clean_ts)
        elapsed = (datetime.utcnow() - last_seen_dt).total_seconds()
        if elapsed > threshold_seconds and device["status"] == "online":
            device["status"] = "offline"
            now = _utc_now_iso()
            with get_db_connection(db_path) as conn:
                with conn:
                    conn.execute(
                        "UPDATE devices SET status = 'offline', updated_at = ? WHERE id = ?",
                        (now, device["id"]),
                    )
    except Exception as e:
        logger.warning("Error evaluating device liveness for %s: %s", device.get("id"), e)

    return device


def insert_telemetry_record(
    device_id: str,
    metrics: Dict[str, Any],
    db_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Persist a telemetry sample in telemetry_history.
    """
    now = _utc_now_iso()
    recorded_at = metrics.get("timestamp") or metrics.get("recorded_at") or now
    record_id = hashlib.sha256(f"{device_id}_{recorded_at}_{uuid.uuid4().hex[:8]}".encode()).hexdigest()[:16]

    cpu = metrics.get("cpu", {})
    cpu_pct = cpu.get("usage_percent", 0.0) if isinstance(cpu, dict) else metrics.get("cpu_percent", 0.0)

    mem = metrics.get("memory", {})
    mem_pct = mem.get("usage_percent", 0.0) if isinstance(mem, dict) else metrics.get("memory_percent", 0.0)

    disk = metrics.get("disk", {})
    disk_pct = disk.get("usage_percent", 0.0) if isinstance(disk, dict) else metrics.get("disk_percent", 0.0)

    raw_str = json.dumps(metrics) if isinstance(metrics, dict) else str(metrics)

    query = """
        INSERT INTO telemetry_history (
            id, device_id, cpu_percent, memory_percent, disk_percent, recorded_at, raw_metrics
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    """
    params = (
        record_id,
        device_id,
        float(cpu_pct or 0.0),
        float(mem_pct or 0.0),
        float(disk_pct or 0.0),
        recorded_at,
        raw_str,
    )

    with get_db_connection(db_path) as conn:
        with conn:
            conn.execute(query, params)

    return {
        "id": record_id,
        "device_id": device_id,
        "cpu_percent": cpu_pct,
        "memory_percent": mem_pct,
        "disk_percent": disk_pct,
        "recorded_at": now,
    }


def get_latest_telemetry_for_device(
    device_id: str,
    db_path: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Retrieve the most recent telemetry sample for a device from telemetry_history.
    """
    query = """
        SELECT id, device_id, cpu_percent, memory_percent, disk_percent, recorded_at, raw_metrics
        FROM telemetry_history
        WHERE device_id = ?
        ORDER BY recorded_at DESC
        LIMIT 1
    """
    try:
        with get_db_connection(db_path) as conn:
            row = conn.execute(query, (device_id,)).fetchone()
            if not row:
                return None
            rec = dict(row)
            if isinstance(rec.get("raw_metrics"), str):
                try:
                    rec["raw_metrics"] = json.loads(rec["raw_metrics"])
                except Exception:
                    pass
            return rec
    except Exception as e:
        logger.error("Database error retrieving latest telemetry for device %s: %s", device_id, e)
        return None


def get_latest_telemetry_any_device(
    db_path: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Retrieve the most recent telemetry sample across all devices from telemetry_history.
    Used when the in-memory cache is empty (e.g. cold start) to reconstruct the active state.
    """
    query = """
        SELECT id, device_id, cpu_percent, memory_percent, disk_percent, recorded_at, raw_metrics
        FROM telemetry_history
        ORDER BY recorded_at DESC
        LIMIT 1
    """
    try:
        with get_db_connection(db_path) as conn:
            row = conn.execute(query).fetchone()
            if not row:
                return None
            rec = dict(row)
            if isinstance(rec.get("raw_metrics"), str):
                try:
                    rec["raw_metrics"] = json.loads(rec["raw_metrics"])
                except Exception:
                    pass
            return rec
    except Exception as e:
        logger.error("Database error retrieving latest telemetry record: %s", e)
        return None

