import os
import shutil
import tempfile
import time
import unittest
from datetime import datetime, timedelta

from backend.app.api.agent import set_cached_telemetry, list_devices, get_device
from backend.app.api.system import read_system_metrics
from backend.app.database.connection import init_db
from backend.app.database.repositories import (
    insert_telemetry_record,
    upsert_device,
    get_latest_telemetry_for_device,
    get_latest_telemetry_any_device,
    get_all_devices,
    get_device_by_id,
)


class TestSystemTelemetryHistoryIntegration(unittest.TestCase):
    """
    Unit and integration tests verifying:
    1. GET /api/system recovers telemetry from telemetry_history when in-memory cache is empty.
    2. Device ID, timestamp, hostname, and exact metrics (CPU, RAM, Disk) are preserved.
    3. Live vs offline distinction: older than 60s is marked offline, never online.
    4. Registered devices retrieval via list_devices and get_device.
    """

    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.test_dir, "test_system.db")
        os.environ["SQLITE_DB_PATH"] = self.db_path
        init_db(self.db_path)
        # Clear in-memory cache
        set_cached_telemetry(None)

    def tearDown(self):
        set_cached_telemetry(None)
        os.environ.pop("SQLITE_DB_PATH", None)
        if os.path.exists(self.test_dir):
            shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_system_metrics_retrieval_from_telemetry_history_when_cache_empty(self):
        """Verify GET /api/system retrieves real historical metrics when memory cache is empty."""
        # Insert historical telemetry matching user's confirmed laptop
        device_id = "ubuntu-1d77207cd91e"
        past_time = (datetime.utcnow() - timedelta(minutes=10)).isoformat() + "Z"
        telemetry_payload = {
            "device_id": device_id,
            "timestamp": past_time,
            "system": {
                "hostname": "rajesh-VivoBook-ASUSLaptop-X515EA-X515EA",
                "os": "Linux",
                "os_release": "Ubuntu 22.04.5 LTS",
                "kernel_version": "6.8.0-generic",
                "architecture": "x86_64",
                "uptime_seconds": 32000.0,
            },
            "cpu": {
                "usage_percent": 5.9,
                "logical_cores": 8,
                "load_average": {"1m": 0.45, "5m": 0.62, "15m": 0.58},
            },
            "memory": {
                "total_bytes": 16000000000,
                "used_bytes": 9696000000,
                "available_bytes": 6304000000,
                "usage_percent": 60.6,
            },
            "disk": {
                "mount_point": "/",
                "total_bytes": 500000000000,
                "used_bytes": 489500000000,
                "free_bytes": 10500000000,
                "usage_percent": 97.9,
            },
            "network": {
                "interfaces": [
                    {
                        "name": "wlo1",
                        "is_up": True,
                        "speed_mbps": 866.0,
                        "addresses": [{"family": "IPv4", "address": "192.168.1.100"}],
                    }
                ]
            },
        }

        # 1. Persist directly into telemetry_history
        insert_telemetry_record(device_id, telemetry_payload, db_path=self.db_path)

        # Ensure in-memory cache is empty
        set_cached_telemetry(None)

        # 2. Call read_system_metrics without specific device_id
        res = read_system_metrics(auth=True)

        self.assertEqual(res["device_id"], device_id)
        self.assertEqual(res["system"]["hostname"], "rajesh-VivoBook-ASUSLaptop-X515EA-X515EA")
        self.assertEqual(res["cpu"]["usage_percent"], 5.9)
        self.assertEqual(res["memory"]["usage_percent"], 60.6)
        self.assertEqual(res["disk"]["usage_percent"], 97.9)
        self.assertEqual(res["timestamp"], past_time)
        # Because data is 10 minutes old, must be marked 'offline'
        self.assertEqual(res["device_status"], "offline")

    def test_live_device_status_when_recent(self):
        """Verify device reporting within 60s is marked 'online'."""
        device_id = "ubuntu-live-node"
        now_time = datetime.utcnow().isoformat() + "Z"
        telemetry_payload = {
            "device_id": device_id,
            "timestamp": now_time,
            "system": {"hostname": "live-ubuntu-box"},
            "cpu": {"usage_percent": 12.3},
            "memory": {"usage_percent": 45.0},
            "disk": {"usage_percent": 55.0},
        }

        # Also register in devices table with recent last_seen
        upsert_device({
            "id": device_id,
            "hostname": "live-ubuntu-box",
            "ip_address": "192.168.1.120",
            "os": "Ubuntu Linux",
            "kernel": "6.8.0",
            "arch": "x86_64",
            "status": "online",
            "last_telemetry": telemetry_payload,
        }, db_path=self.db_path)

        insert_telemetry_record(device_id, telemetry_payload, db_path=self.db_path)

        res = read_system_metrics(device_id=device_id, auth=True)
        self.assertEqual(res["device_status"], "online")
        self.assertEqual(res["cpu"]["usage_percent"], 12.3)

    def test_devices_listing_endpoint_includes_telemetry_history_devices(self):
        """Verify GET /api/agent/devices surfaces devices even if only present in telemetry_history."""
        device_id = "ubuntu-1d77207cd91e"
        past_time = (datetime.utcnow() - timedelta(minutes=5)).isoformat() + "Z"
        telemetry_payload = {
            "device_id": device_id,
            "timestamp": past_time,
            "system": {
                "hostname": "rajesh-VivoBook-ASUSLaptop-X515EA-X515EA",
                "os": "Ubuntu 22.04 LTS",
            },
            "cpu": {"usage_percent": 5.9},
            "memory": {"usage_percent": 60.6},
            "disk": {"usage_percent": 97.9},
        }

        insert_telemetry_record(device_id, telemetry_payload, db_path=self.db_path)

        devices_res = list_devices(auth=True)
        self.assertEqual(devices_res["status"], "success")
        self.assertGreaterEqual(devices_res["total"], 1)

        found = next((d for d in devices_res["devices"] if d["id"] == device_id), None)
        self.assertIsNotNone(found)
        self.assertEqual(found["hostname"], "rajesh-VivoBook-ASUSLaptop-X515EA-X515EA")
        self.assertEqual(found["status"], "offline")

        # Test single device lookup
        single_res = get_device(device_id, auth=True)
        self.assertEqual(single_res["status"], "success")
        self.assertEqual(single_res["device"]["id"], device_id)
        self.assertEqual(single_res["device"]["hostname"], "rajesh-VivoBook-ASUSLaptop-X515EA-X515EA")


if __name__ == "__main__":
    unittest.main()
