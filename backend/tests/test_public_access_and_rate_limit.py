import asyncio
import os
import shutil
import tempfile
import unittest
from unittest.mock import MagicMock
from fastapi import HTTPException

from backend.app.api.agent import (
    AgentTelemetryPayload,
    CpuPayload,
    DiskPayload,
    MemoryPayload,
    SystemInfoPayload,
    ingest_telemetry,
    list_devices,
    set_cached_telemetry,
)
from backend.app.api.alerts import list_alerts
from backend.app.api.auth import check_dashboard_access, verify_agent_token, verify_dashboard_access
from backend.app.api.security import get_security_events
from backend.app.api.system import read_system_history, read_system_metrics
from backend.app.database.connection import init_db
from backend.app.database.repositories import insert_telemetry_record, upsert_device
from backend.app.security.rate_limiter import (
    _IP_REQUEST_TIMESTAMPS,
    _RATE_LIMIT_LOCK,
    check_rate_limit,
    mask_ip_address,
)


class TestPublicAccessAndRateLimit(unittest.TestCase):
    """
    Verifies:
    1. Anonymous access to read_system_metrics succeeds and masks sensitive IP addresses.
    2. Authenticated access to read_system_metrics reveals unmasked IP addresses.
    3. Anonymous access to read_system_history returns historical samples.
    4. Anonymous access to list_devices returns device list with masked IP addresses.
    5. Agent telemetry ingestion requires valid agent token (verify_agent_token).
    6. Security events endpoint requires DASHBOARD_API_KEY (verify_dashboard_access).
    7. Alerts endpoint requires DASHBOARD_API_KEY (verify_dashboard_access).
    8. Rate limiter restricts excessive anonymous requests.
    """

    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.test_dir, "test_public.db")
        os.environ["SQLITE_DB_PATH"] = self.db_path
        os.environ["DASHBOARD_API_KEY"] = "secret-dashboard-key-12345"
        os.environ["AGENT_API_KEY"] = "secret-agent-key-67890"
        init_db(self.db_path)
        set_cached_telemetry(None)

        with _RATE_LIMIT_LOCK:
            _IP_REQUEST_TIMESTAMPS.clear()

        # Seed telemetry and device
        self.device_id = "ubuntu-1d77207cd91e"
        self.sample_telemetry = {
            "device_id": self.device_id,
            "timestamp": "2026-11-17T14:00:00Z",
            "system": {
                "hostname": "rajesh-VivoBook-ASUSLaptop-X515EA-X515EA",
                "os": "Ubuntu 22.04.5 LTS",
                "kernel_version": "6.8.0-generic",
                "architecture": "x86_64",
                "uptime_seconds": 3600.0,
            },
            "cpu": {
                "usage_percent": 8.5,
                "logical_cores": 8,
                "load_average": {"1m": 0.5, "5m": 0.6, "15m": 0.5},
            },
            "memory": {
                "total_bytes": 16000000000,
                "used_bytes": 8000000000,
                "available_bytes": 8000000000,
                "usage_percent": 50.0,
            },
            "disk": {
                "mount_point": "/",
                "total_bytes": 500000000000,
                "used_bytes": 250000000000,
                "free_bytes": 250000000000,
                "usage_percent": 50.0,
            },
            "network": {
                "interfaces": [
                    {
                        "name": "wlo1",
                        "is_up": True,
                        "addresses": [{"family": "IPv4", "address": "192.168.1.105"}],
                    }
                ]
            },
        }
        insert_telemetry_record(self.device_id, self.sample_telemetry, db_path=self.db_path)
        upsert_device({
            "id": self.device_id,
            "hostname": "rajesh-VivoBook-ASUSLaptop-X515EA-X515EA",
            "ip_address": "192.168.1.105",
            "os": "Ubuntu 22.04 LTS",
            "kernel": "6.8.0",
            "arch": "x86_64",
            "status": "online",
            "last_telemetry": self.sample_telemetry,
        }, db_path=self.db_path)

    def tearDown(self):
        set_cached_telemetry(None)
        os.environ.pop("SQLITE_DB_PATH", None)
        os.environ.pop("DASHBOARD_API_KEY", None)
        os.environ.pop("AGENT_API_KEY", None)
        with _RATE_LIMIT_LOCK:
            _IP_REQUEST_TIMESTAMPS.clear()
        if os.path.exists(self.test_dir):
            shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_anonymous_can_read_system_metrics_with_masked_ip(self):
        """Anonymous access returns live metrics with masked IP without requiring a key."""
        res = read_system_metrics(is_admin=False)
        self.assertEqual(res["device_id"], self.device_id)
        self.assertEqual(res["system"]["hostname"], "rajesh-VivoBook-ASUSLaptop-X515EA-X515EA")
        self.assertEqual(res["cpu"]["usage_percent"], 8.5)
        # IP must be masked
        ifaces = res["network"]["interfaces"]
        self.assertGreaterEqual(len(ifaces), 1)
        addr = ifaces[0]["addresses"][0]["address"]
        self.assertEqual(addr, "192.168.1.***")

    def test_authenticated_admin_gets_unmasked_ip(self):
        """Authenticated admin access returns unmasked IP."""
        res = read_system_metrics(is_admin=True)
        self.assertEqual(res["device_id"], self.device_id)
        ifaces = res["network"]["interfaces"]
        addr = ifaces[0]["addresses"][0]["address"]
        self.assertEqual(addr, "192.168.1.105")

    def test_anonymous_can_read_telemetry_history(self):
        """Anonymous access can read telemetry history samples."""
        res = read_system_history(is_admin=False)
        self.assertEqual(res["status"], "success")
        self.assertGreaterEqual(res["total"], 1)
        self.assertEqual(res["samples"][0]["device_id"], self.device_id)
        self.assertEqual(res["samples"][0]["cpu_percent"], 8.5)

    def test_anonymous_can_list_devices_with_masked_ip(self):
        """Anonymous access can list devices; IP address is sanitized."""
        res = list_devices(is_admin=False)
        self.assertEqual(res["status"], "success")
        self.assertGreaterEqual(res["total"], 1)
        dev = res["devices"][0]
        self.assertEqual(dev["hostname"], "rajesh-VivoBook-ASUSLaptop-X515EA-X515EA")
        self.assertEqual(dev["ip_address"], "192.168.1.***")

    def test_admin_can_list_devices_with_unmasked_ip(self):
        """Admin access can list devices with full unmasked IP address."""
        res = list_devices(is_admin=True)
        dev = res["devices"][0]
        self.assertEqual(dev["ip_address"], "192.168.1.105")

    def test_telemetry_ingestion_requires_agent_token(self):
        """verify_agent_token rejects missing or wrong tokens with 401."""
        with self.assertRaises(HTTPException) as cm:
            verify_agent_token(x_agent_token=None)
        self.assertEqual(cm.exception.status_code, 401)

        with self.assertRaises(HTTPException) as cm:
            verify_agent_token(x_agent_token="wrong-token")
        self.assertEqual(cm.exception.status_code, 401)

        # Valid token passes
        token = verify_agent_token(x_agent_token="secret-agent-key-67890")
        self.assertEqual(token, "secret-agent-key-67890")

    def test_security_events_requires_dashboard_key(self):
        """verify_dashboard_access rejects missing or wrong keys with 401."""
        with self.assertRaises(HTTPException) as cm:
            verify_dashboard_access(x_api_key=None)
        self.assertEqual(cm.exception.status_code, 401)

        with self.assertRaises(HTTPException) as cm:
            verify_dashboard_access(x_api_key="wrong-key")
        self.assertEqual(cm.exception.status_code, 401)

        # Valid key passes
        self.assertTrue(verify_dashboard_access(x_api_key="secret-dashboard-key-12345"))

    def test_rate_limiter_blocks_excessive_anonymous_requests(self):
        """Rate limiter raises 429 when anonymous requests exceed limit."""
        mock_req = MagicMock()
        mock_req.headers.get.return_value = None
        mock_req.client.host = "203.0.113.99"

        # Allow 5 requests in a 10s window
        for _ in range(5):
            check_rate_limit(mock_req, is_admin=False, max_requests=5, window_seconds=10)

        # 6th request should fail with 429
        with self.assertRaises(HTTPException) as cm:
            check_rate_limit(mock_req, is_admin=False, max_requests=5, window_seconds=10)
        self.assertEqual(cm.exception.status_code, 429)

        # Admin requests bypass rate limit
        check_rate_limit(mock_req, is_admin=True, max_requests=5, window_seconds=10)


if __name__ == "__main__":
    unittest.main()
