import hashlib
import logging
import sqlite3
import uuid
from datetime import datetime
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
