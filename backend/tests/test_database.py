import os
import shutil
import tempfile
import unittest

from backend.app.database.connection import get_db_connection, init_db
from backend.app.database.repositories import (
    acknowledge_alert,
    count_security_events,
    create_alert,
    get_alert_by_id,
    get_alerts,
    get_security_event_by_id,
    get_security_events,
    insert_security_event,
    insert_security_events,
    resolve_alert,
)


class TestDatabaseAndRepositories(unittest.TestCase):
    def setUp(self):
        # Create a temporary directory and SQLite database file for isolation
        self.test_dir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.test_dir, "test_cloudsentinel.db")
        init_db(self.db_path)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_database_initialization(self):
        """Verify schema tables and indexes exist after init_db."""
        with get_db_connection(self.db_path) as conn:
            tables = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
            ).fetchall()
            table_names = [row["name"] for row in tables]
            self.assertIn("security_events", table_names)
            self.assertIn("alerts", table_names)

            indices = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index';"
            ).fetchall()
            index_names = [row["name"] for row in indices]
            self.assertIn("idx_sec_events_timestamp", index_names)
            self.assertIn("idx_alerts_status", index_names)

    def test_security_event_insert_and_retrieve(self):
        """Verify single insert and retrieval by ID."""
        event = {
            "id": "evt_test_001",
            "timestamp": "2026-11-17T03:00:00",
            "severity": "warning",
            "category": "failed_ssh",
            "source_ip": "198.51.100.10",
            "target_user": "root",
            "service": "sshd",
            "attempts": 1,
            "description": "Failed SSH password attempt for root",
        }
        inserted = insert_security_event(event, db_path=self.db_path)
        self.assertTrue(inserted)

        retrieved = get_security_event_by_id("evt_test_001", db_path=self.db_path)
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved["id"], "evt_test_001")
        self.assertEqual(retrieved["category"], "failed_ssh")
        self.assertEqual(retrieved["source_ip"], "198.51.100.10")

    def test_duplicate_security_event_prevention(self):
        """Verify duplicate event IDs are safely ignored without error."""
        event = {
            "id": "evt_duplicate_test",
            "timestamp": "2026-11-17T03:00:00",
            "severity": "warning",
            "category": "invalid_user",
            "source_ip": "198.51.100.20",
            "target_user": "guest",
            "service": "sshd",
            "attempts": 1,
            "description": "Failed password for invalid user guest",
        }
        # First insertion succeeds
        first_insert = insert_security_event(event, db_path=self.db_path)
        self.assertTrue(first_insert)

        # Duplicate insertion is safely ignored
        second_insert = insert_security_event(event, db_path=self.db_path)
        self.assertFalse(second_insert)
        self.assertEqual(count_security_events(db_path=self.db_path), 1)

        # Batch insert with duplicates
        batch = [
            event,  # Duplicate
            {
                "id": "evt_new_002",
                "timestamp": "2026-11-17T03:01:00",
                "severity": "critical",
                "category": "repeated_attempt",
                "source_ip": "198.51.100.20",
                "target_user": "guest",
                "service": "sshd",
                "attempts": 5,
                "description": "5 repeated failed attempts",
            },
        ]
        newly_inserted = insert_security_events(batch, db_path=self.db_path)
        self.assertEqual(newly_inserted, 1)
        self.assertEqual(count_security_events(db_path=self.db_path), 2)

    def test_security_event_filtering_and_pagination(self):
        """Verify filtering by severity/category and limit/offset pagination."""
        events = [
            {
                "id": f"evt_{i}",
                "timestamp": f"2026-11-17T03:0{i}:00",
                "severity": "critical" if i % 2 == 0 else "warning",
                "category": "repeated_attempt" if i % 2 == 0 else "failed_ssh",
                "source_ip": f"192.168.1.{i}",
                "target_user": "admin",
                "service": "sshd",
                "attempts": i,
                "description": f"Test event {i}",
            }
            for i in range(1, 6)
        ]
        insert_security_events(events, db_path=self.db_path)

        all_events = get_security_events(limit=10, db_path=self.db_path)
        self.assertEqual(len(all_events), 5)
        # Should be sorted timestamp DESC (evt_5 first)
        self.assertEqual(all_events[0]["id"], "evt_5")

        critical_events = get_security_events(severity="critical", db_path=self.db_path)
        self.assertEqual(len(critical_events), 2)

        failed_ssh_count = count_security_events(category="failed_ssh", db_path=self.db_path)
        self.assertEqual(failed_ssh_count, 3)

    def test_alert_lifecycle(self):
        """Verify full alert transition lifecycle: active -> acknowledged -> resolved."""
        created = create_alert({
            "title": "High CPU Spike",
            "description": "CPU exceeded 95% threshold for 2 minutes",
            "severity": "critical",
            "source": "metrics",
        }, db_path=self.db_path)

        alert_id = created["id"]
        self.assertEqual(created["status"], "active")
        self.assertIsNone(created["acknowledged_at"])
        self.assertIsNone(created["resolved_at"])

        # Acknowledge
        acknowledged = acknowledge_alert(alert_id, db_path=self.db_path)
        self.assertIsNotNone(acknowledged)
        self.assertEqual(acknowledged["status"], "acknowledged")
        self.assertIsNotNone(acknowledged["acknowledged_at"])

        # Resolve
        resolved = resolve_alert(alert_id, db_path=self.db_path)
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved["status"], "resolved")
        self.assertIsNotNone(resolved["resolved_at"])

    def test_alert_direct_resolve(self):
        """Verify an active alert can be directly resolved without prior acknowledgment."""
        created = create_alert({
            "title": "Direct Resolution Test",
            "description": "Alert resolved directly from active state",
            "severity": "warning",
            "source": "system",
        }, db_path=self.db_path)
        alert_id = created["id"]
        self.assertEqual(created["status"], "active")
        self.assertIsNone(created["resolved_at"])

        resolved = resolve_alert(alert_id, db_path=self.db_path)
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved["status"], "resolved")
        self.assertIsNotNone(resolved["resolved_at"])

        # Once resolved directly, must not transition to acknowledged
        with self.assertRaises(ValueError):
            acknowledge_alert(alert_id, db_path=self.db_path)

    def test_alert_idempotent_transitions(self):
        """Verify redundant transitions return the current record safely."""
        alert = create_alert({
            "title": "Disk Space Warning",
            "description": "Root partition over 85%",
            "severity": "warning",
            "source": "disk",
        }, db_path=self.db_path)
        alert_id = alert["id"]

        ack1 = acknowledge_alert(alert_id, db_path=self.db_path)
        ack2 = acknowledge_alert(alert_id, db_path=self.db_path)
        self.assertEqual(ack1["acknowledged_at"], ack2["acknowledged_at"])

        res1 = resolve_alert(alert_id, db_path=self.db_path)
        res2 = resolve_alert(alert_id, db_path=self.db_path)
        self.assertEqual(res1["resolved_at"], res2["resolved_at"])

    def test_invalid_alert_id(self):
        """Verify operations on non-existent alert IDs return None."""
        self.assertIsNone(get_alert_by_id("non_existent_id", db_path=self.db_path))
        self.assertIsNone(acknowledge_alert("non_existent_id", db_path=self.db_path))
        self.assertIsNone(resolve_alert("non_existent_id", db_path=self.db_path))

    def test_invalid_status_transition(self):
        """Verify that acknowledging an already resolved alert is rejected."""
        alert = create_alert({
            "title": "Security Incident",
            "description": "SSH brute force mitigated",
            "severity": "critical",
            "source": "auth",
        }, db_path=self.db_path)
        alert_id = alert["id"]

        # Resolve first
        resolve_alert(alert_id, db_path=self.db_path)

        # Attempt to transition resolved back to acknowledged
        with self.assertRaises(ValueError):
            acknowledge_alert(alert_id, db_path=self.db_path)

    def test_persistence_across_connection_restarts(self):
        """Verify data persists when database is reopened with a fresh connection."""
        event = {
            "id": "persistent_event_1",
            "timestamp": "2026-11-17T03:30:00",
            "severity": "warning",
            "category": "auth_failure",
            "source_ip": "127.0.0.1",
            "target_user": "root",
            "service": "sudo",
            "attempts": 1,
            "description": "Sudo authentication failure",
        }
        insert_security_event(event, db_path=self.db_path)
        alert = create_alert({
            "id": "persistent_alert_1",
            "title": "Sudo alert",
            "description": "Sudo failed attempt",
            "severity": "warning",
            "source": "sudo",
        }, db_path=self.db_path)

        # Simulate fresh process opening the same file
        event_reopened = get_security_event_by_id("persistent_event_1", db_path=self.db_path)
        alert_reopened = get_alert_by_id("persistent_alert_1", db_path=self.db_path)

        self.assertIsNotNone(event_reopened)
        self.assertEqual(event_reopened["id"], "persistent_event_1")
        self.assertIsNotNone(alert_reopened)
        self.assertEqual(alert_reopened["title"], "Sudo alert")


if __name__ == "__main__":
    unittest.main()
