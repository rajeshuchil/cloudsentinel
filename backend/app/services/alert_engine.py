import hashlib
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from backend.app.collectors.log_collector import read_recent_log_lines
from backend.app.collectors.system_collector import (
    collect_cpu_metrics,
    collect_disk_metrics,
    collect_memory_metrics,
)
from backend.app.config import (
    CPU_CRITICAL_THRESHOLD,
    CPU_WARNING_THRESHOLD,
    DISK_CRITICAL_THRESHOLD,
    DISK_WARNING_THRESHOLD,
    MEMORY_CRITICAL_THRESHOLD,
    MEMORY_WARNING_THRESHOLD,
    SSH_REPEATED_ATTEMPTS_THRESHOLD,
    SSH_WINDOW_SECONDS,
)
from backend.app.database.repositories import (
    create_alert,
    get_alert_by_id,
    get_alerts,
    get_open_alert_by_source,
    get_security_events,
    insert_security_events,
    resolve_alert,
    update_alert_metrics,
)
from backend.app.security.ssh_analyzer import analyze_log_lines

logger = logging.getLogger(__name__)


def _utc_now_iso() -> str:
    """Return current UTC timestamp in ISO-8601 format."""
    return datetime.utcnow().isoformat() + "Z"


def evaluate_metric_threshold(
    metric_name: str,
    source_key: str,
    current_value: Optional[float],
    warning_threshold: float,
    critical_threshold: float,
    unit: str = "%",
    db_path: Optional[str] = None,
) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """
    Evaluate a system metric against warning and critical thresholds.
    Handles duplicate prevention, severity escalation/de-escalation while preserving acknowledgment,
    and automatic resolution when values recover.

    Returns: (created_alert, updated_alert, resolved_alert)
    """
    if current_value is None:
        return None, None, None

    open_alert = get_open_alert_by_source(source_key, db_path=db_path)

    # Condition is normal (< warning threshold)
    if current_value < warning_threshold:
        if open_alert:
            # Auto-resolve recovered alert
            resolved = resolve_alert(open_alert["id"], db_path=db_path)
            logger.info("Auto-resolved %s alert %s: usage dropped to %.1f%s", metric_name, open_alert["id"], current_value, unit)
            return None, None, resolved
        return None, None, None

    # Condition breached threshold
    severity = "critical" if current_value >= critical_threshold else "warning"
    threshold_value = critical_threshold if severity == "critical" else warning_threshold
    title = f"High {metric_name} Usage ({severity.capitalize()})"
    desc = (
        f"{metric_name} usage is currently at {current_value:.1f}{unit}, "
        f"exceeding the {severity} threshold of {threshold_value:.1f}{unit}."
    )

    if open_alert:
        # Prevent duplicate: update existing open alert (preserves active vs acknowledged status)
        if open_alert["severity"] != severity or open_alert["description"] != desc:
            updated = update_alert_metrics(open_alert["id"], severity=severity, description=desc, db_path=db_path)
            return None, updated, None
        return None, None, None

    # No existing open alert: create new incident
    new_alert = create_alert({
        "title": title,
        "description": desc,
        "severity": severity,
        "source": source_key,
        "status": "active",
    }, db_path=db_path)
    return new_alert, None, None


def evaluate_security_alerts(
    security_events: List[Dict[str, Any]],
    db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Evaluate security events for repeated failed authentication attempts.
    Creates a critical security alert if not already alerted, preventing duplicates.
    """
    created_security_alerts: List[Dict[str, Any]] = []

    for event in security_events:
        if event.get("category") == "repeated_attempt":
            source_key = f"ssh_repeated:{event['source_ip']}"
            deterministic_alert_id = "alert_" + hashlib.sha256(f"sec_{event['id']}".encode()).hexdigest()[:12]

            # Check if this exact incident or open alert for this source IP already exists
            existing_by_id = get_alert_by_id(deterministic_alert_id, db_path=db_path)
            existing_open = get_open_alert_by_source(source_key, db_path=db_path)

            if existing_by_id or existing_open:
                # Duplicate prevented
                continue

            alert = create_alert({
                "id": deterministic_alert_id,
                "title": f"Repeated SSH Login Failures from {event['source_ip']}",
                "description": (
                    f"Detected {event['attempts']} failed SSH login attempts from {event['source_ip']}. "
                    f"Target username(s): {event.get('target_user', 'multiple')}. Event ID: {event['id']}."
                ),
                "severity": "critical",
                "source": source_key,
                "status": "active",
            }, db_path=db_path)
            created_security_alerts.append(alert)

    return created_security_alerts


def evaluate_all_alerts(
    db_path: Optional[str] = None,
    metrics_override: Optional[Dict[str, Any]] = None,
    security_events_override: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Run a full evaluation cycle:
    1. Collect live system metrics (CPU, Memory, Disk).
    2. Evaluate metric thresholds (create, update, or resolve).
    3. Process recent auth log entries and correlate repeated attempt security events.
    4. Return summary of actions taken.
    """
    created_alerts: List[Dict[str, Any]] = []
    updated_alerts: List[Dict[str, Any]] = []
    resolved_alerts: List[Dict[str, Any]] = []

    # 1. Gather or use overridden metrics
    if metrics_override is not None:
        cpu_val = metrics_override.get("cpu_percent")
        mem_val = metrics_override.get("memory_percent")
        disk_val = metrics_override.get("disk_percent")
    else:
        cpu_metrics = collect_cpu_metrics(interval=0.1)
        mem_metrics = collect_memory_metrics()
        disk_metrics = collect_disk_metrics()
        cpu_val = cpu_metrics.get("usage_percent")
        mem_val = mem_metrics.get("usage_percent")
        disk_val = disk_metrics.get("usage_percent")

    # 2. Evaluate CPU
    c_alert, u_alert, r_alert = evaluate_metric_threshold(
        metric_name="CPU",
        source_key="cpu",
        current_value=cpu_val,
        warning_threshold=CPU_WARNING_THRESHOLD,
        critical_threshold=CPU_CRITICAL_THRESHOLD,
        db_path=db_path,
    )
    if c_alert: created_alerts.append(c_alert)
    if u_alert: updated_alerts.append(u_alert)
    if r_alert: resolved_alerts.append(r_alert)

    # 3. Evaluate Memory
    c_alert, u_alert, r_alert = evaluate_metric_threshold(
        metric_name="Memory",
        source_key="memory",
        current_value=mem_val,
        warning_threshold=MEMORY_WARNING_THRESHOLD,
        critical_threshold=MEMORY_CRITICAL_THRESHOLD,
        db_path=db_path,
    )
    if c_alert: created_alerts.append(c_alert)
    if u_alert: updated_alerts.append(u_alert)
    if r_alert: resolved_alerts.append(r_alert)

    # 4. Evaluate Disk
    c_alert, u_alert, r_alert = evaluate_metric_threshold(
        metric_name="Disk",
        source_key="disk",
        current_value=disk_val,
        warning_threshold=DISK_WARNING_THRESHOLD,
        critical_threshold=DISK_CRITICAL_THRESHOLD,
        db_path=db_path,
    )
    if c_alert: created_alerts.append(c_alert)
    if u_alert: updated_alerts.append(u_alert)
    if r_alert: resolved_alerts.append(r_alert)

    # 5. Evaluate Security Events
    if security_events_override is not None:
        sec_events = security_events_override
    else:
        # Ingest and analyze live log lines
        lines, log_info = read_recent_log_lines(max_lines=1000)
        if log_info.get("status") == "available":
            parsed_events = analyze_log_lines(
                lines,
                repeated_threshold=SSH_REPEATED_ATTEMPTS_THRESHOLD,
                window_seconds=SSH_WINDOW_SECONDS,
            )
            if parsed_events:
                insert_security_events(parsed_events, db_path=db_path)

        # Retrieve recent stored repeated attempts
        sec_events = get_security_events(
            limit=50,
            category="repeated_attempt",
            db_path=db_path,
        )

    sec_created = evaluate_security_alerts(sec_events, db_path=db_path)
    created_alerts.extend(sec_created)

    # Fetch total currently active alerts count
    active_alerts = get_alerts(status="active", db_path=db_path)

    return {
        "status": "success",
        "evaluated_at": _utc_now_iso(),
        "metrics": {
            "cpu_percent": cpu_val,
            "memory_percent": mem_val,
            "disk_percent": disk_val,
        },
        "alerts_created": created_alerts,
        "alerts_updated": updated_alerts,
        "alerts_resolved": resolved_alerts,
        "active_alerts_count": len(active_alerts),
    }
