import asyncio
import json
import os
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from backend.app.api.agent import (
    AgentTelemetryPayload,
    CpuPayload,
    DiskPayload,
    HeartbeatPayload,
    MemoryPayload,
    NetworkAddressPayload,
    NetworkInterfacePayload,
    NetworkPayload,
    SecurityEventItemPayload,
    SystemInfoPayload,
    agent_heartbeat,
    get_device,
    ingest_telemetry,
    list_devices,
)
from backend.app.api.auth import verify_agent_token, verify_dashboard_access
from backend.app.api.system import read_system_metrics
from backend.app.database.connection import (
    UnifiedRow,
    get_db_connection,
    init_db,
    translate_sql_for_postgres,
)
from backend.app.database.repositories import (
    get_all_devices,
    get_device_by_id,
    get_latest_active_device,
    get_latest_telemetry_for_device,
    get_security_events,
    insert_security_event,
    insert_telemetry_record,
    update_device_heartbeat,
    upsert_device,
)


class TestPostgreSQLAdapterDialectParity(unittest.TestCase):
    """
    Unit tests verifying PostgreSQL SQL dialect translation and UnifiedRow data access parity.
    NOTE: These tests verify the syntax transformation and row abstraction using an isolated local SQLite
    engine; live end-to-end integration with Neon requires a running PostgreSQL instance and DATABASE_URL.
    """

    def test_sql_translation_placeholders(self):
        sql = "SELECT * FROM security_events WHERE category = ? AND severity = ?;"
        translated = translate_sql_for_postgres(sql)
        self.assertIn("category = %s", translated)
        self.assertIn("severity = %s", translated)
        self.assertNotIn("?", translated)

    def test_sql_translation_insert_or_ignore(self):
        sql = """
            INSERT OR IGNORE INTO security_events (
                id, timestamp, severity, category, source_ip
            ) VALUES (?, ?, ?, ?, ?)
        """
        translated = translate_sql_for_postgres(sql)
        self.assertIn("INSERT INTO security_events", translated)
        self.assertIn("ON CONFLICT (id) DO NOTHING;", translated)
        self.assertNotIn("INSERT OR IGNORE", translated)

    def test_unified_row_access(self):
        keys = ["id", "hostname", "count"]
        values = ["dev-001", "ubuntu-host", 42]
        row = UnifiedRow(keys, values)

        # Access by string key
        self.assertEqual(row["id"], "dev-001")
        self.assertEqual(row["hostname"], "ubuntu-host")
        self.assertEqual(row["count"], 42)

        # Access by integer index
        self.assertEqual(row[0], "dev-001")
        self.assertEqual(row[1], "ubuntu-host")
        self.assertEqual(row[2], 42)

        # Conversion to standard dictionary
        d = dict(row)
        self.assertEqual(d, {"id": "dev-001", "hostname": "ubuntu-host", "count": 42})


class TestDeviceAndTelemetryRepositories(unittest.TestCase):
    """Test device registration, online/offline liveness tracking, and telemetry history."""

    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.test_dir, "test_repo.db")
        init_db(self.db_path)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_upsert_device_and_retrieve(self):
        device_data = {
            "id": "laptop-101",
            "hostname": "workstation-ubuntu",
            "ip_address": "192.168.1.50",
            "os": "Ubuntu 24.04 LTS",
            "kernel": "6.8.0-generic",
            "arch": "x86_64",
            "status": "online",
            "last_telemetry": {"cpu": {"usage_percent": 15.5}},
        }
        upsert_device(device_data, db_path=self.db_path)

        retrieved = get_device_by_id("laptop-101", db_path=self.db_path)
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved["hostname"], "workstation-ubuntu")
        self.assertEqual(retrieved["status"], "online")

    def test_device_offline_transition_after_sixty_seconds(self):
        stale_time = (datetime.utcnow() - timedelta(seconds=90)).isoformat() + "Z"
        device_data = {
            "id": "laptop-stale",
            "hostname": "stale-host",
            "ip_address": "192.168.1.99",
            "status": "online",
            "created_at": stale_time,
        }
        upsert_device(device_data, db_path=self.db_path)

        with get_db_connection(self.db_path) as conn:
            with conn:
                conn.execute("UPDATE devices SET last_seen = ? WHERE id = ?", (stale_time, "laptop-stale"))

        dev = get_device_by_id("laptop-stale", offline_threshold_seconds=60, db_path=self.db_path)
        self.assertIsNotNone(dev)
        self.assertEqual(dev["status"], "offline")

        update_device_heartbeat("laptop-stale", db_path=self.db_path)
        dev_recovered = get_device_by_id("laptop-stale", offline_threshold_seconds=60, db_path=self.db_path)
        self.assertEqual(dev_recovered["status"], "online")

    def test_telemetry_history_persistence(self):
        metrics = {
            "cpu": {"usage_percent": 45.2},
            "memory": {"usage_percent": 68.0},
            "disk": {"usage_percent": 72.1},
        }
        rec = insert_telemetry_record("dev-001", metrics, db_path=self.db_path)
        self.assertEqual(rec["cpu_percent"], 45.2)

        latest = get_latest_telemetry_for_device("dev-001", db_path=self.db_path)
        self.assertIsNotNone(latest)
        self.assertEqual(latest["cpu_percent"], 45.2)


class TestAgentAPIEndpointsAndSecurity(unittest.TestCase):
    """Test authenticated telemetry ingestion, dashboard access controls, and production metric isolation."""

    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.test_dir, "test_api.db")
        os.environ["SQLITE_DB_PATH"] = self.db_path
        os.environ["AGENT_API_KEY"] = "secret-agent-token-test-123"
        os.environ["DASHBOARD_API_KEY"] = "secret-dashboard-key-456"
        init_db(self.db_path)

    def tearDown(self):
        os.environ.pop("AGENT_API_KEY", None)
        os.environ.pop("DASHBOARD_API_KEY", None)
        os.environ.pop("SQLITE_DB_PATH", None)
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_agent_token_validation(self):
        # Missing token rejected
        with self.assertRaises(HTTPException) as ctx:
            verify_agent_token(None, None)
        self.assertEqual(ctx.exception.status_code, 401)

        # Invalid token rejected
        with self.assertRaises(HTTPException) as ctx:
            verify_agent_token("wrong-token", None)
        self.assertEqual(ctx.exception.status_code, 401)

        # Valid token accepted
        token = verify_agent_token("secret-agent-token-test-123", None)
        self.assertEqual(token, "secret-agent-token-test-123")

    def test_dashboard_api_key_validation(self):
        # Missing key rejected when DASHBOARD_API_KEY is configured
        with self.assertRaises(HTTPException) as ctx:
            verify_dashboard_access(None, None)
        self.assertEqual(ctx.exception.status_code, 401)

        # Wrong key rejected
        with self.assertRaises(HTTPException) as ctx:
            verify_dashboard_access("bad-key", None)
        self.assertEqual(ctx.exception.status_code, 401)

        # Valid key accepted
        self.assertTrue(verify_dashboard_access("secret-dashboard-key-456", None))
        self.assertTrue(verify_dashboard_access(None, "Bearer secret-dashboard-key-456"))

        # Unset key permits development requests
        with patch.dict(os.environ, {"DASHBOARD_API_KEY": ""}):
            self.assertTrue(verify_dashboard_access(None, None))

    def test_telemetry_ingestion_and_caching(self):
        payload = AgentTelemetryPayload(
            device_id="laptop-office",
            timestamp="2026-11-17T06:00:00Z",
            system=SystemInfoPayload(
                hostname="ubuntu-zenbook",
                os="Linux",
                os_release="Ubuntu 24.04.1 LTS",
                kernel_version="6.8.0-48-generic",
                architecture="x86_64",
                uptime_seconds=3600.0,
            ),
            cpu=CpuPayload(
                usage_percent=18.5,
                logical_cores=8,
                load_average={"1m": 0.42, "5m": 0.55, "15m": 0.60},
            ),
            memory=MemoryPayload(
                total_bytes=16 * 1024 * 1024 * 1024,
                used_bytes=8 * 1024 * 1024 * 1024,
                available_bytes=8 * 1024 * 1024 * 1024,
                usage_percent=50.0,
            ),
            disk=DiskPayload(
                mount_point="/",
                total_bytes=500 * 1024 * 1024 * 1024,
                used_bytes=200 * 1024 * 1024 * 1024,
                free_bytes=300 * 1024 * 1024 * 1024,
                usage_percent=40.0,
            ),
            network=NetworkPayload(
                interfaces=[
                    NetworkInterfacePayload(
                        name="wlo1",
                        is_up=True,
                        addresses=[NetworkAddressPayload(family="AF_INET", address="192.168.1.150")],
                    )
                ]
            ),
            security_events=[
                SecurityEventItemPayload(
                    id="evt-agent-001",
                    timestamp="2026-11-17T06:00:00Z",
                    severity="warning",
                    category="failed_ssh",
                    source_ip="203.0.113.88",
                    target_user="ubuntu",
                    service="sshd",
                    attempts=1,
                    description="Failed SSH authentication attempt for user 'ubuntu' from 203.0.113.88",
                )
            ],
        )

        mock_request = MagicMock()
        mock_request.headers = {}
        mock_request.client.host = "192.168.1.150"

        # Ingest telemetry
        result = asyncio.run(ingest_telemetry(mock_request, payload, "secret-agent-token-test-123"))
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["device_status"], "online")
        self.assertEqual(result["ingested_security_events"], 1)

        # Verify device list returns it as online
        devices_data = list_devices(auth=True)
        self.assertEqual(devices_data["status"], "success")
        self.assertEqual(len(devices_data["devices"]), 1)
        self.assertEqual(devices_data["devices"][0]["hostname"], "ubuntu-zenbook")
        self.assertEqual(devices_data["devices"][0]["status"], "online")

        # Verify GET /api/system serves this agent's telemetry with device_status='online'
        sys_data = read_system_metrics(auth=True)
        self.assertEqual(sys_data["system"]["hostname"], "ubuntu-zenbook")
        self.assertEqual(sys_data["device_status"], "online")

    def test_production_metric_isolation_when_agent_unregistered(self):
        """In production (PostgreSQL), unconfigured agents must never return Render container metrics."""
        with patch("backend.app.api.system.get_db_type", return_value="postgres"), \
             patch("backend.app.api.system.get_cached_telemetry", return_value=None), \
             patch("backend.app.api.system.get_latest_active_device", return_value=None):
            metrics = read_system_metrics(auth=True)
            self.assertEqual(metrics["device_status"], "offline")
            self.assertEqual(metrics["system"]["hostname"], "Awaiting Agent Registration...")
            self.assertEqual(metrics["cpu"]["usage_percent"], 0.0)

    def test_duplicate_security_events_prevented_through_agent(self):
        payload = AgentTelemetryPayload(
            device_id="laptop-dedup",
            timestamp="2026-11-17T06:05:00Z",
            system=SystemInfoPayload(),
            cpu=CpuPayload(),
            memory=MemoryPayload(),
            disk=DiskPayload(),
            security_events=[
                SecurityEventItemPayload(
                    id="evt-repeat-100",
                    timestamp="2026-11-17T06:05:00Z",
                    severity="warning",
                    category="failed_ssh",
                    source_ip="198.51.100.44",
                    target_user="root",
                    service="sshd",
                    description="Failed attempt",
                )
            ],
        )

        mock_request = MagicMock()
        mock_request.headers = {}
        mock_request.client.host = "127.0.0.1"

        res1 = asyncio.run(ingest_telemetry(mock_request, payload, "secret-agent-token-test-123"))
        self.assertEqual(res1["ingested_security_events"], 1)

        res2 = asyncio.run(ingest_telemetry(mock_request, payload, "secret-agent-token-test-123"))
        self.assertEqual(res2["ingested_security_events"], 0)

    def test_heartbeat_updates_liveness(self):
        upsert_device({"id": "dev-hb", "hostname": "hb-host", "status": "online"})
        hb_payload = HeartbeatPayload(device_id="dev-hb")
        res = asyncio.run(agent_heartbeat(hb_payload, "secret-agent-token-test-123"))
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["device_status"], "online")


class TestAgentLogParser(unittest.TestCase):
    """Test agent local log parsing logic and credential stripping."""

    def test_ssh_failed_parsing(self):
        import sys
        sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "agent")))
        from agent import LogMonitor

        monitor = LogMonitor(log_path="/tmp/non_existent.log")
        line = "2026-11-17T03:15:22.123456+00:00 server sshd[1234]: Failed password for invalid user admin from 198.51.100.77 port 48212 ssh2"
        evt = monitor._parse_line(line)
        self.assertIsNotNone(evt)
        self.assertEqual(evt["category"], "failed_ssh")
        self.assertEqual(evt["source_ip"], "198.51.100.77")
        self.assertEqual(evt["target_user"], "admin")
        self.assertNotIn("password", evt["description"].lower().replace("failed ssh password attempt", ""))

    def test_ssh_accepted_parsing(self):
        import sys
        sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "agent")))
        from agent import LogMonitor

        monitor = LogMonitor(log_path="/tmp/non_existent.log")
        line = "2026-11-17T03:20:00+00:00 host sshd[5678]: Accepted publickey for rajesh from 192.168.1.10 port 51234 ssh2: RSA SHA256:abc"
        evt = monitor._parse_line(line)
        self.assertIsNotNone(evt)
        self.assertEqual(evt["category"], "successful_ssh")
        self.assertEqual(evt["target_user"], "rajesh")
        self.assertEqual(evt["source_ip"], "192.168.1.10")
        self.assertEqual(evt["severity"], "info")
