#!/usr/bin/env python3
"""
CloudSentinel — Lightweight Ubuntu Monitoring Agent
Collects host system telemetry via psutil and local auth log security events.
Transmits authenticated telemetry payloads to the CloudSentinel backend.
"""

import collections
import hashlib
import json
import logging
import os
import platform
import re
import signal
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import psutil

from config import (
    AGENT_TOKEN,
    AUTH_LOG_PATH,
    BACKEND_URL,
    DEVICE_ID,
    HEARTBEAT_INTERVAL,
    LOG_LEVEL,
    TELEMETRY_INTERVAL,
)

# Configure logging
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] [agent] %(message)s",
)
logger = logging.getLogger("agent")

# Regex patterns for SSH & auth log analysis
SSH_FAILED_REGEX = re.compile(
    r"(?:Failed password for (?:invalid user )?|Invalid user )(?P<user>[^\s]+) from (?P<ip>[\d\.\:a-fA-F]+)"
)
SSH_ACCEPTED_REGEX = re.compile(
    r"Accepted (?:password|publickey) for (?P<user>[^\s]+) from (?P<ip>[\d\.\:a-fA-F]+)"
)
SUDO_FAILURE_REGEX = re.compile(
    r"sudo:\s+(?P<user>[^\s]+)\s+:\s+(?:[0-9]+ incorrect password attempt|authentication failure)"
)
TIMESTAMP_REGEX = re.compile(
    r"^(?P<ts>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z)?|[A-Z][a-z]{2}\s+\d+\s+\d{2}:\d{2}:\d{2})"
)


def _utc_now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


class LogMonitor:
    """
    Monitors /var/log/auth.log for security events.
    Preserves file offset across polling cycles to read only newly appended lines.
    Handles logrotate automatically via inode tracking.
    """
    def __init__(self, log_path: str = AUTH_LOG_PATH):
        self.log_path = log_path
        self.last_pos = 0
        self.last_inode: Optional[int] = None
        self.seen_events: collections.deque = collections.deque(maxlen=2000)
        self._initial_seek()

    def _initial_seek(self) -> None:
        """Seek to the end of the log file on initial startup so past lines are not re-sent."""
        if not os.path.isfile(self.log_path):
            logger.warning("Auth log file not found at %s. Security monitoring will wait.", self.log_path)
            return

        try:
            stat = os.stat(self.log_path)
            self.last_inode = stat.st_ino
            # Start at end of file (monitoring new events from agent start time)
            self.last_pos = stat.st_size
            logger.info("Initialized auth log monitor on %s (inode=%s, pos=%s)", self.log_path, self.last_inode, self.last_pos)
        except Exception as e:
            logger.warning("Could not access %s: %s (Check adm group membership)", self.log_path, e)

    def read_new_events(self) -> List[Dict[str, Any]]:
        """Read newly appended lines and return structured security events."""
        if not os.path.isfile(self.log_path):
            return []

        try:
            stat = os.stat(self.log_path)
            current_inode = stat.st_ino

            # Detect logrotate: inode changed or file truncated
            if self.last_inode is not None and (current_inode != self.last_inode or stat.st_size < self.last_pos):
                logger.info("Detected logrotate for %s. Resetting read position.", self.log_path)
                self.last_pos = 0

            self.last_inode = current_inode

            if stat.st_size <= self.last_pos:
                return []

            new_lines: List[str] = []
            with open(self.log_path, "r", encoding="utf-8", errors="replace") as f:
                f.seek(self.last_pos)
                new_lines = f.readlines()
                self.last_pos = f.tell()

            events: List[Dict[str, Any]] = []
            for line in new_lines:
                parsed = self._parse_line(line.strip())
                if parsed:
                    event_id = parsed["id"]
                    if event_id not in self.seen_events:
                        self.seen_events.append(event_id)
                        events.append(parsed)

            return events

        except PermissionError:
            logger.error("Permission denied reading %s. Ensure user is in 'adm' group.", self.log_path)
            return []
        except Exception as e:
            logger.warning("Error reading auth log: %s", e)
            return []

    def _parse_line(self, line: str) -> Optional[Dict[str, Any]]:
        """Parse an auth.log line into a structured security event (sanitizing credentials)."""
        if not line or "sshd" not in line and "sudo" not in line:
            return None

        # Extract timestamp
        ts_match = TIMESTAMP_REGEX.match(line)
        timestamp = ts_match.group("ts") if ts_match else _utc_now_iso()

        # Check Failed SSH
        m_failed = SSH_FAILED_REGEX.search(line)
        if m_failed:
            user = m_failed.group("user")
            ip = m_failed.group("ip")
            category = "failed_ssh"
            severity = "warning"
            desc = f"Failed SSH authentication attempt for user '{user}' from {ip}"
            event_id = hashlib.sha256(f"{timestamp}_{ip}_{user}_failed_ssh".encode()).hexdigest()[:16]
            return {
                "id": event_id,
                "timestamp": timestamp,
                "severity": severity,
                "category": category,
                "source_ip": ip,
                "target_user": user,
                "service": "sshd",
                "attempts": 1,
                "description": desc,
                "created_at": _utc_now_iso(),
            }

        # Check Accepted SSH
        m_acc = SSH_ACCEPTED_REGEX.search(line)
        if m_acc:
            user = m_acc.group("user")
            ip = m_acc.group("ip")
            category = "successful_ssh"
            severity = "info"
            desc = f"Successful SSH login for user '{user}' from {ip}"
            event_id = hashlib.sha256(f"{timestamp}_{ip}_{user}_accepted_ssh".encode()).hexdigest()[:16]
            return {
                "id": event_id,
                "timestamp": timestamp,
                "severity": severity,
                "category": category,
                "source_ip": ip,
                "target_user": user,
                "service": "sshd",
                "attempts": 1,
                "description": desc,
                "created_at": _utc_now_iso(),
            }

        # Check Sudo failure
        m_sudo = SUDO_FAILURE_REGEX.search(line)
        if m_sudo:
            user = m_sudo.group("user")
            category = "auth_failure"
            severity = "warning"
            desc = f"Sudo privilege authentication failure for user '{user}'"
            event_id = hashlib.sha256(f"{timestamp}_localhost_{user}_sudo_fail".encode()).hexdigest()[:16]
            return {
                "id": event_id,
                "timestamp": timestamp,
                "severity": severity,
                "category": category,
                "source_ip": "127.0.0.1",
                "target_user": user,
                "service": "sudo",
                "attempts": 1,
                "description": desc,
                "created_at": _utc_now_iso(),
            }

        return None


def collect_system_metrics() -> Dict[str, Any]:
    """Collect real Linux host system metrics using psutil."""
    # 1. System info
    hostname = platform.node()
    os_name = platform.system()
    kernel = platform.release()
    arch = platform.machine()
    uptime = float(time.time() - psutil.boot_time())

    # Read Linux distribution info from /etc/os-release if available
    os_release = f"{os_name} {platform.version()}"
    try:
        if os.path.exists("/etc/os-release"):
            with open("/etc/os-release", "r") as f:
                for line in f:
                    if line.startswith("PRETTY_NAME="):
                        os_release = line.split("=", 1)[1].strip().strip('"')
                        break
    except Exception:
        pass

    # 2. CPU
    cpu_percent = psutil.cpu_percent(interval=None)
    cpu_cores = psutil.cpu_count(logical=True)
    try:
        l1, l5, l15 = os.getloadavg()
        load_avg = {"1m": round(l1, 2), "5m": round(l5, 2), "15m": round(l15, 2)}
    except Exception:
        load_avg = {"1m": 0.0, "5m": 0.0, "15m": 0.0}

    # 3. Memory
    vm = psutil.virtual_memory()

    # 4. Disk
    disk = psutil.disk_usage("/")

    # 5. Network interfaces
    interfaces = []
    try:
        net_addrs = psutil.net_if_addrs()
        net_stats = psutil.net_if_stats()
        for name, addrs in net_addrs.items():
            stats = net_stats.get(name)
            is_up = stats.isup if stats else None
            speed = float(stats.speed) if stats else None
            mtu = stats.mtu if stats else None

            addr_list = []
            for a in addrs:
                family_str = str(a.family).split(".")[-1]
                if a.family in (psutil.AF_LINK, 17):
                    family_str = "AF_PACKET"
                addr_list.append({
                    "family": family_str,
                    "address": a.address,
                    "netmask": a.netmask,
                    "broadcast": a.broadcast,
                })
            interfaces.append({
                "name": name,
                "is_up": is_up,
                "speed_mbps": speed,
                "mtu": mtu,
                "addresses": addr_list,
            })
    except Exception as e:
        logger.debug("Network collection note: %s", e)

    return {
        "system": {
            "hostname": hostname,
            "os": os_name,
            "os_release": os_release,
            "kernel_version": kernel,
            "architecture": arch,
            "uptime_seconds": uptime,
        },
        "cpu": {
            "usage_percent": cpu_percent,
            "logical_cores": cpu_cores,
            "load_average": load_avg,
        },
        "memory": {
            "total_bytes": vm.total,
            "used_bytes": vm.used,
            "available_bytes": vm.available,
            "usage_percent": vm.percent,
        },
        "disk": {
            "mount_point": "/",
            "total_bytes": disk.total,
            "used_bytes": disk.used,
            "free_bytes": disk.free,
            "usage_percent": disk.percent,
        },
        "network": {
            "interfaces": interfaces,
        },
    }


class AgentClient:
    """Manages telemetry transmission, heartbeat pings, and backoff recovery to CloudSentinel backend."""
    def __init__(self, backend_url: str = BACKEND_URL, token: str = AGENT_TOKEN, device_id: str = DEVICE_ID):
        self.telemetry_endpoint = f"{backend_url}/api/agent/telemetry"
        self.heartbeat_endpoint = f"{backend_url}/api/agent/heartbeat"
        self.token = token
        self.device_id = device_id
        self.backoff_delay = 0.0
        self.max_backoff = 30.0
        self.pending_security_events: collections.deque = collections.deque(maxlen=200)
        self.pending_event_ids: set = set()

    def send_telemetry(self, metrics: Dict[str, Any], security_events: List[Dict[str, Any]]) -> bool:
        """Transmit telemetry payload to backend. Buffers events if connection fails."""
        # Queue any new security events without duplicates
        for evt in security_events:
            evt_id = evt.get("id")
            if evt_id and evt_id not in self.pending_event_ids:
                self.pending_event_ids.add(evt_id)
                self.pending_security_events.append(evt)

        events_to_send = list(self.pending_security_events)

        payload = {
            "device_id": self.device_id,
            "timestamp": _utc_now_iso(),
            "system": metrics["system"],
            "cpu": metrics["cpu"],
            "memory": metrics["memory"],
            "disk": metrics["disk"],
            "network": metrics["network"],
            "security_events": events_to_send,
        }

        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            self.telemetry_endpoint,
            data=data_bytes,
            headers={
                "Content-Type": "application/json",
                "X-Agent-Token": self.token,
                "User-Agent": f"CloudSentinel-Agent/1.0 ({platform.node()})",
            },
            method="POST",
        )

        try:
            # 35s timeout to absorb Render cold boot latency (~30-50s)
            with urllib.request.urlopen(req, timeout=35.0) as resp:
                if resp.status in (200, 201):
                    self.pending_security_events.clear()
                    self.pending_event_ids.clear()
                    if self.backoff_delay > 0:
                        logger.info("Connection to CloudSentinel restored. Host is ONLINE.")
                        self.backoff_delay = 0.0
                    return True
                else:
                    logger.warning("Backend returned unexpected status: %s", resp.status)
                    self._increase_backoff()
                    return False

        except urllib.error.HTTPError as e:
            if e.code == 401:
                logger.error("Authentication failed: invalid AGENT_TOKEN / AGENT_API_KEY. Verify agent configuration.")
            elif e.code == 404:
                logger.warning("Endpoint %s not found (HTTP 404).", self.telemetry_endpoint)
            elif e.code == 413:
                logger.error("Payload too large (HTTP 413). Reducing security event queue.")
                self.pending_security_events.clear()
                self.pending_event_ids.clear()
            elif e.code in (502, 503, 504):
                logger.info("Render service waking up / gateway response (HTTP %s). Retrying...", e.code)
            else:
                logger.warning("HTTP error delivering telemetry (%s): %s", e.code, e.reason)
            self._increase_backoff()
            return False

        except urllib.error.URLError as e:
            logger.warning("Backend unreachable: %s (Render may be sleeping, will retry)", e.reason)
            self._increase_backoff()
            return False

        except TimeoutError:
            logger.warning("Request timed out (Render free-tier cold start in progress). Retrying...")
            self._increase_backoff()
            return False

        except Exception as e:
            logger.warning("Unexpected error sending telemetry: %s", e)
            self._increase_backoff()
            return False

    def send_heartbeat(self) -> bool:
        """Send lightweight heartbeat ping to refresh last_seen timestamp."""
        payload = {"device_id": self.device_id}
        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            self.heartbeat_endpoint,
            data=data_bytes,
            headers={
                "Content-Type": "application/json",
                "X-Agent-Token": self.token,
                "User-Agent": f"CloudSentinel-Agent/1.0 ({platform.node()})",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=15.0) as resp:
                if resp.status in (200, 201):
                    logger.debug("Heartbeat ping acknowledged (device: %s).", self.device_id)
                    return True
                return False
        except urllib.error.HTTPError as e:
            if e.code == 404:
                logger.debug("Heartbeat 404 (device pending initial telemetry registration).")
            elif e.code == 401:
                logger.error("Heartbeat authentication failed: invalid token.")
            else:
                logger.debug("Heartbeat HTTP status: %s", e.code)
            return False
        except Exception as e:
            logger.debug("Heartbeat transmission issue: %s", e)
            return False

    def _increase_backoff(self) -> None:
        """Apply exponential backoff on network failures."""
        if self.backoff_delay == 0.0:
            self.backoff_delay = 3.0
        else:
            self.backoff_delay = min(self.max_backoff, self.backoff_delay * 2)


def main():
    logger.info("Starting CloudSentinel Monitoring Agent...")
    logger.info("Device ID: %s", DEVICE_ID)
    logger.info("Backend Target: %s", BACKEND_URL)
    logger.info("Telemetry Interval: %s seconds", TELEMETRY_INTERVAL)
    logger.info("Heartbeat Interval: %s seconds", HEARTBEAT_INTERVAL)

    # Initial CPU sample
    psutil.cpu_percent(interval=None)

    log_monitor = LogMonitor(AUTH_LOG_PATH)
    client = AgentClient(BACKEND_URL, AGENT_TOKEN, DEVICE_ID)

    running = True

    def handle_signal(sig, frame):
        nonlocal running
        logger.info("Agent received shutdown signal (%s). Exiting gracefully.", sig)
        running = False

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    last_telemetry_time = 0.0
    last_heartbeat_time = 0.0

    while running:
        now = time.time()

        # 1. Telemetry transmission cycle (every TELEMETRY_INTERVAL seconds or after backoff)
        if now - last_telemetry_time >= (client.backoff_delay or TELEMETRY_INTERVAL):
            try:
                metrics = collect_system_metrics()
                new_events = log_monitor.read_new_events()
                success = client.send_telemetry(metrics, new_events)
                if success:
                    logger.info("Telemetry delivered (CPU: %.1f%%, RAM: %.1f%%, Disk: %.1f%%)",
                                metrics["cpu"]["usage_percent"],
                                metrics["memory"]["usage_percent"],
                                metrics["disk"]["usage_percent"])
                    last_telemetry_time = now
                    last_heartbeat_time = now
            except Exception as e:
                logger.error("Error in telemetry cycle: %s", e, exc_info=True)

        # 2. Heartbeat cycle (every HEARTBEAT_INTERVAL seconds)
        now = time.time()
        if now - last_heartbeat_time >= HEARTBEAT_INTERVAL:
            try:
                hb_success = client.send_heartbeat()
                if hb_success:
                    last_heartbeat_time = now
            except Exception as e:
                logger.debug("Error in heartbeat cycle: %s", e)

        # Responsive sleep
        time.sleep(1.0)

    logger.info("CloudSentinel Monitoring Agent stopped.")


if __name__ == "__main__":
    main()
