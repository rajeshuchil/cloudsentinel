import hashlib
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Pattern to extract standard syslog header: timestamp, host, service, message
SYSLOG_LINE_REGEX = re.compile(
    r"^(?P<timestamp>(?:[A-Z][a-z]{2}\s+\d+\s+\d{2}:\d{2}:\d{2})|(?:\d{4}-\d{2}-\d{2}T\S+))\s+"
    r"(?P<host>\S+)\s+"
    r"(?P<service>[a-zA-Z0-9_\-]+)(?:\[\d+\])?:?\s*"
    r"(?P<message>.*)$"
)

# Authentication message patterns
SSH_FAILED_INVALID_USER = re.compile(
    r"Failed (?:password|none) for invalid user (?P<user>\S+) from (?P<ip>\S+) port (?P<port>\d+)"
)
SSH_FAILED_VALID_USER = re.compile(
    r"Failed (?:password|none) for (?P<user>\S+) from (?P<ip>\S+) port (?P<port>\d+)"
)
SSH_INVALID_USER_ONLY = re.compile(
    r"Invalid user (?P<user>\S+) from (?P<ip>\S+) port (?P<port>\d+)"
)
SSH_ACCEPTED_AUTH = re.compile(
    r"Accepted (?:password|publickey|keyboard-interactive) for (?P<user>\S+) from (?P<ip>\S+) port (?P<port>\d+)"
)
SUDO_AUTH_FAILURE = re.compile(
    r"pam_unix\(sudo:auth\): authentication failure;.*user=(?P<user>\S+)"
)
SUDO_INCORRECT_PASSWORD = re.compile(
    r"(?P<attempts>\d+)\s+incorrect password attempts?.*USER=(?P<target>\S+)"
)


def parse_timestamp(ts_str: str) -> Tuple[datetime, str]:
    """
    Parse syslog timestamp (either BSD 'Nov 17 03:00:01' or ISO-8601) to datetime and ISO string.
    """
    now = datetime.now()
    # 1. Try ISO format
    try:
        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            dt = dt.astimezone().replace(tzinfo=None)
        return dt, dt.isoformat()
    except ValueError:
        pass

    # 2. Try BSD syslog format (e.g., 'Nov 17 03:00:01' or 'Nov  1 03:00:01')
    try:
        cleaned_ts = re.sub(r"\s+", " ", ts_str.strip())
        dt = datetime.strptime(f"{now.year} {cleaned_ts}", "%Y %b %d %H:%M:%S")
        # Handle year boundary if log was recorded in previous year
        if dt > now and (dt - now).days > 1:
            dt = dt.replace(year=now.year - 1)
        return dt, dt.isoformat()
    except ValueError:
        return now, now.isoformat()


def generate_event_id(timestamp: str, source_ip: str, target_user: str, category: str, attempts: int = 1) -> str:
    """Generate a deterministic 16-character event ID based on key event attributes."""
    raw = f"{timestamp}:{source_ip}:{target_user}:{category}:{attempts}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def parse_single_line(line: str) -> Optional[Dict[str, Any]]:
    """
    Parse a single syslog line and identify authentication activity.
    Returns an intermediate record dict or None if line is irrelevant/malformed.
    """
    match = SYSLOG_LINE_REGEX.match(line.strip())
    if not match:
        return None

    groups = match.groupdict()
    raw_ts = groups["timestamp"]
    service = groups["service"]
    message = groups["message"]

    dt, iso_ts = parse_timestamp(raw_ts)

    # 1. Check for failed SSH with invalid user
    m_inv_failed = SSH_FAILED_INVALID_USER.search(message)
    if m_inv_failed:
        user = m_inv_failed.group("user")
        ip = m_inv_failed.group("ip")
        return {
            "dt": dt,
            "timestamp": iso_ts,
            "category": "invalid_user",
            "severity": "warning",
            "service": "sshd",
            "source_ip": ip,
            "target_user": user,
            "attempts": 1,
            "description": f"Failed SSH password attempt for invalid username '{user}' from {ip}",
            "is_failure": True,
        }

    # 2. Check for failed SSH with existing user
    m_failed = SSH_FAILED_VALID_USER.search(message)
    if m_failed:
        user = m_failed.group("user")
        ip = m_failed.group("ip")
        return {
            "dt": dt,
            "timestamp": iso_ts,
            "category": "failed_ssh",
            "severity": "warning",
            "service": "sshd",
            "source_ip": ip,
            "target_user": user,
            "attempts": 1,
            "description": f"Failed SSH password attempt for user '{user}' from {ip}",
            "is_failure": True,
        }

    # 3. Check for standalone invalid user message (if not followed by failed password)
    m_inv_only = SSH_INVALID_USER_ONLY.search(message)
    if m_inv_only:
        user = m_inv_only.group("user")
        ip = m_inv_only.group("ip")
        return {
            "dt": dt,
            "timestamp": iso_ts,
            "category": "invalid_user",
            "severity": "warning",
            "service": "sshd",
            "source_ip": ip,
            "target_user": user,
            "attempts": 1,
            "description": f"SSH connection attempt with non-existent username '{user}' from {ip}",
            "is_failure": True,
        }

    # 4. Check for successful SSH login
    m_acc = SSH_ACCEPTED_AUTH.search(message)
    if m_acc:
        user = m_acc.group("user")
        ip = m_acc.group("ip")
        return {
            "dt": dt,
            "timestamp": iso_ts,
            "category": "successful_login",
            "severity": "info",
            "service": "sshd",
            "source_ip": ip,
            "target_user": user,
            "attempts": 1,
            "description": f"Successful SSH authentication for user '{user}' from {ip}",
            "is_failure": False,
        }

    # 5. Check for sudo authentication failure
    m_sudo = SUDO_AUTH_FAILURE.search(message)
    if m_sudo or "sudo" in service.lower() and "authentication failure" in message.lower():
        user = m_sudo.group("user") if m_sudo else "unknown"
        return {
            "dt": dt,
            "timestamp": iso_ts,
            "category": "auth_failure",
            "severity": "warning",
            "service": "sudo",
            "source_ip": "127.0.0.1",
            "target_user": "root",
            "attempts": 1,
            "description": f"Sudo authentication failure for user '{user}'",
            "is_failure": True,
        }

    # 6. Check for sudo incorrect password attempt count
    m_sudo_pw = SUDO_INCORRECT_PASSWORD.search(message)
    if m_sudo_pw:
        target = m_sudo_pw.group("target")
        attempts = int(m_sudo_pw.group("attempts"))
        return {
            "dt": dt,
            "timestamp": iso_ts,
            "category": "auth_failure",
            "severity": "warning",
            "service": "sudo",
            "source_ip": "127.0.0.1",
            "target_user": target,
            "attempts": attempts,
            "description": f"Sudo rejected {attempts} incorrect password attempt(s) for target '{target}'",
            "is_failure": True,
        }

    return None


def analyze_log_lines(
    lines: List[str],
    repeated_threshold: int = 5,
    window_seconds: int = 300,
) -> List[Dict[str, Any]]:
    """
    Analyze authentication log lines, extract individual security events,
    and detect repeated failed attempts grouped by source IP within a sliding time window.
    """
    raw_events: List[Dict[str, Any]] = []

    for line in lines:
        try:
            parsed = parse_single_line(line)
            if parsed:
                raw_events.append(parsed)
        except Exception as e:
            logger.debug("Failed parsing log line: %s (error: %s)", line, e)

    # Track failed attempts per source IP for repeated attempt correlation
    failures_by_ip: Dict[str, List[Dict[str, Any]]] = {}
    for event in raw_events:
        if event.get("is_failure") and event.get("source_ip") and event["source_ip"] != "127.0.0.1":
            ip = event["source_ip"]
            failures_by_ip.setdefault(ip, []).append(event)

    correlated_repeated_events: List[Dict[str, Any]] = []

    # Check for bursts of failed attempts exceeding threshold within window_seconds
    for ip, events_for_ip in failures_by_ip.items():
        if len(events_for_ip) < repeated_threshold:
            continue

        events_for_ip.sort(key=lambda x: x["dt"])

        # Sliding window check
        i = 0
        while i < len(events_for_ip):
            window_start = events_for_ip[i]["dt"]
            window_events = [
                e for e in events_for_ip[i:]
                if 0 <= (e["dt"] - window_start).total_seconds() <= window_seconds
            ]
            if len(window_events) >= repeated_threshold:
                latest = window_events[-1]
                count = len(window_events)
                unique_users = sorted(list({e["target_user"] for e in window_events}))
                target_summary = unique_users[0] if len(unique_users) == 1 else "multiple"
                desc = (
                    f"Repeated failed SSH login attempts ({count} attempts) detected "
                    f"from source IP {ip} within {window_seconds // 60} minutes"
                )

                repeated_event = {
                    "id": generate_event_id(latest["timestamp"], ip, target_summary, "repeated_attempt", count),
                    "timestamp": latest["timestamp"],
                    "severity": "critical",
                    "category": "repeated_attempt",
                    "source_ip": ip,
                    "target_user": target_summary,
                    "service": "sshd",
                    "attempts": count,
                    "description": desc,
                }
                correlated_repeated_events.append(repeated_event)
                # Advance pointer past this window to avoid duplicate repeated alerts for same cluster
                i += len(window_events)
            else:
                i += 1

    # Format output events
    final_events: List[Dict[str, Any]] = []

    # Add repeated burst alerts first
    final_events.extend(correlated_repeated_events)

    # Add individual events (cleaned of internal fields)
    for ev in raw_events:
        final_events.append({
            "id": generate_event_id(ev["timestamp"], ev["source_ip"], ev["target_user"], ev["category"], ev["attempts"]),
            "timestamp": ev["timestamp"],
            "severity": ev["severity"],
            "category": ev["category"],
            "source_ip": ev["source_ip"],
            "target_user": ev["target_user"],
            "service": ev["service"],
            "attempts": ev["attempts"],
            "description": ev["description"],
        })

    # Sort newest first
    final_events.sort(key=lambda x: x["timestamp"], reverse=True)

    # De-duplicate by event ID while preserving sorted order
    seen_ids = set()
    deduped_events: List[Dict[str, Any]] = []
    for ev in final_events:
        if ev["id"] not in seen_ids:
            seen_ids.add(ev["id"])
            deduped_events.append(ev)

    return deduped_events
