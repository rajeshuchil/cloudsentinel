import os
import shutil
import tempfile
import unittest

from backend.app.database.connection import init_db
from backend.app.database.repositories import (
    acknowledge_alert,
    get_alert_by_id,
    get_alerts,
)
from backend.app.services.alert_engine import evaluate_all_alerts


class TestAlertEngine(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.test_dir, "test_alerts.db")
        init_db(self.db_path)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_cpu_warning_alert_creation(self):
        """CPU >= 75% should create a warning alert."""
        result = evaluate_all_alerts(
            db_path=self.db_path,
            metrics_override={"cpu_percent": 78.5, "memory_percent": 40.0, "disk_percent": 50.0},
            security_events_override=[],
        )
        self.assertEqual(len(result["alerts_created"]), 1)
        alert = result["alerts_created"][0]
        self.assertEqual(alert["source"], "cpu")
        self.assertEqual(alert["severity"], "warning")
        self.assertIn("78.5%", alert["description"])
        self.assertEqual(alert["status"], "active")

    def test_cpu_critical_alert_creation(self):
        """CPU >= 90% should create a critical alert."""
        result = evaluate_all_alerts(
            db_path=self.db_path,
            metrics_override={"cpu_percent": 94.2, "memory_percent": 40.0, "disk_percent": 50.0},
            security_events_override=[],
        )
        self.assertEqual(len(result["alerts_created"]), 1)
        alert = result["alerts_created"][0]
        self.assertEqual(alert["source"], "cpu")
        self.assertEqual(alert["severity"], "critical")
        self.assertIn("94.2%", alert["description"])

    def test_memory_warning_and_critical_alerts(self):
        """Memory >= 80% creates warning; >= 92% creates critical."""
        # Warning
        res1 = evaluate_all_alerts(
            db_path=self.db_path,
            metrics_override={"cpu_percent": 20.0, "memory_percent": 82.0, "disk_percent": 50.0},
            security_events_override=[],
        )
        self.assertEqual(len(res1["alerts_created"]), 1)
        self.assertEqual(res1["alerts_created"][0]["source"], "memory")
        self.assertEqual(res1["alerts_created"][0]["severity"], "warning")

        # Escalate to critical
        res2 = evaluate_all_alerts(
            db_path=self.db_path,
            metrics_override={"cpu_percent": 20.0, "memory_percent": 94.0, "disk_percent": 50.0},
            security_events_override=[],
        )
        self.assertEqual(len(res2["alerts_created"]), 0)  # No duplicate alert
        self.assertEqual(len(res2["alerts_updated"]), 1)   # Escalated
        self.assertEqual(res2["alerts_updated"][0]["severity"], "critical")

    def test_disk_warning_and_critical_alerts(self):
        """Disk >= 75% creates warning; >= 90% creates critical."""
        # Warning
        res1 = evaluate_all_alerts(
            db_path=self.db_path,
            metrics_override={"cpu_percent": 20.0, "memory_percent": 40.0, "disk_percent": 76.0},
            security_events_override=[],
        )
        self.assertEqual(len(res1["alerts_created"]), 1)
        self.assertEqual(res1["alerts_created"][0]["source"], "disk")
        self.assertEqual(res1["alerts_created"][0]["severity"], "warning")

        # Escalate to critical
        res2 = evaluate_all_alerts(
            db_path=self.db_path,
            metrics_override={"cpu_percent": 20.0, "memory_percent": 40.0, "disk_percent": 92.5},
            security_events_override=[],
        )
        self.assertEqual(len(res2["alerts_created"]), 0)
        self.assertEqual(len(res2["alerts_updated"]), 1)
        self.assertEqual(res2["alerts_updated"][0]["severity"], "critical")

    def test_duplicate_active_alert_prevention(self):
        """Evaluating continuous high load should not create duplicate active alerts."""
        res1 = evaluate_all_alerts(
            db_path=self.db_path,
            metrics_override={"cpu_percent": 85.0, "memory_percent": 40.0, "disk_percent": 50.0},
            security_events_override=[],
        )
        self.assertEqual(len(res1["alerts_created"]), 1)

        # Second evaluation with same condition
        res2 = evaluate_all_alerts(
            db_path=self.db_path,
            metrics_override={"cpu_percent": 85.0, "memory_percent": 40.0, "disk_percent": 50.0},
            security_events_override=[],
        )
        self.assertEqual(len(res2["alerts_created"]), 0)
        self.assertEqual(len(res2["alerts_updated"]), 0)
        self.assertEqual(res2["active_alerts_count"], 1)

        all_alerts = get_alerts(db_path=self.db_path)
        self.assertEqual(len(all_alerts), 1)

    def test_automatic_resolution_after_recovery(self):
        """When metric drops below warning threshold, active alert resolves automatically."""
        # 1. Breach
        evaluate_all_alerts(
            db_path=self.db_path,
            metrics_override={"cpu_percent": 82.0, "memory_percent": 40.0, "disk_percent": 50.0},
            security_events_override=[],
        )
        active = get_alerts(status="active", db_path=self.db_path)
        self.assertEqual(len(active), 1)

        # 2. Recovery
        res_rec = evaluate_all_alerts(
            db_path=self.db_path,
            metrics_override={"cpu_percent": 45.0, "memory_percent": 40.0, "disk_percent": 50.0},
            security_events_override=[],
        )
        self.assertEqual(len(res_rec["alerts_resolved"]), 1)
        self.assertEqual(res_rec["active_alerts_count"], 0)

        resolved = get_alert_by_id(active[0]["id"], db_path=self.db_path)
        self.assertEqual(resolved["status"], "resolved")
        self.assertIsNotNone(resolved["resolved_at"])

    def test_acknowledged_alert_remains_acknowledged(self):
        """An acknowledged alert must NOT be reset to active on repeated evaluations."""
        # 1. Create alert
        res = evaluate_all_alerts(
            db_path=self.db_path,
            metrics_override={"cpu_percent": 85.0, "memory_percent": 40.0, "disk_percent": 50.0},
            security_events_override=[],
        )
        alert_id = res["alerts_created"][0]["id"]

        # 2. Operator acknowledges it
        acknowledge_alert(alert_id, db_path=self.db_path)
        alert_ack = get_alert_by_id(alert_id, db_path=self.db_path)
        self.assertEqual(alert_ack["status"], "acknowledged")

        # 3. Next evaluation cycle (CPU still high)
        evaluate_all_alerts(
            db_path=self.db_path,
            metrics_override={"cpu_percent": 86.0, "memory_percent": 40.0, "disk_percent": 50.0},
            security_events_override=[],
        )

        alert_after = get_alert_by_id(alert_id, db_path=self.db_path)
        self.assertEqual(alert_after["status"], "acknowledged")  # Not reset to active

    def test_resolved_alert_history_preserved(self):
        """Historical resolved alerts remain in SQLite and can be retrieved."""
        # Create and resolve
        evaluate_all_alerts(
            db_path=self.db_path,
            metrics_override={"cpu_percent": 80.0, "memory_percent": 40.0, "disk_percent": 50.0},
            security_events_override=[],
        )
        evaluate_all_alerts(
            db_path=self.db_path,
            metrics_override={"cpu_percent": 30.0, "memory_percent": 40.0, "disk_percent": 50.0},
            security_events_override=[],
        )
        resolved_alerts = get_alerts(status="resolved", db_path=self.db_path)
        self.assertEqual(len(resolved_alerts), 1)

    def test_new_incident_creates_new_alert_after_recovery(self):
        """If metric breaches again after being resolved, create a new incident."""
        # 1. Breach -> resolved
        evaluate_all_alerts(
            db_path=self.db_path,
            metrics_override={"cpu_percent": 80.0, "memory_percent": 40.0, "disk_percent": 50.0},
            security_events_override=[],
        )
        evaluate_all_alerts(
            db_path=self.db_path,
            metrics_override={"cpu_percent": 30.0, "memory_percent": 40.0, "disk_percent": 50.0},
            security_events_override=[],
        )

        # 2. New breach later
        res_new = evaluate_all_alerts(
            db_path=self.db_path,
            metrics_override={"cpu_percent": 88.0, "memory_percent": 40.0, "disk_percent": 50.0},
            security_events_override=[],
        )
        self.assertEqual(len(res_new["alerts_created"]), 1)
        self.assertEqual(res_new["active_alerts_count"], 1)

        total_alerts = get_alerts(db_path=self.db_path)
        self.assertEqual(len(total_alerts), 2)  # 1 historical resolved, 1 new active

    def test_repeated_ssh_security_alert_and_deduplication(self):
        """Repeated SSH attempts generate a critical alert; duplicate runs do not duplicate it."""
        sec_event = {
            "id": "sec_evt_burst_01",
            "timestamp": "2026-11-17T03:00:00",
            "severity": "critical",
            "category": "repeated_attempt",
            "source_ip": "198.51.100.77",
            "target_user": "admin",
            "service": "sshd",
            "attempts": 6,
            "description": "Repeated failed SSH login attempts (6 attempts) detected",
        }

        # First evaluation: creates security alert
        res1 = evaluate_all_alerts(
            db_path=self.db_path,
            metrics_override={"cpu_percent": 20.0, "memory_percent": 40.0, "disk_percent": 50.0},
            security_events_override=[sec_event],
        )
        self.assertEqual(len(res1["alerts_created"]), 1)
        sec_alert = res1["alerts_created"][0]
        self.assertEqual(sec_alert["severity"], "critical")
        self.assertIn("198.51.100.77", sec_alert["title"])
        self.assertIn("6 failed SSH login attempts", sec_alert["description"])

        # Second evaluation with same security event: no duplicate alert created
        res2 = evaluate_all_alerts(
            db_path=self.db_path,
            metrics_override={"cpu_percent": 20.0, "memory_percent": 40.0, "disk_percent": 50.0},
            security_events_override=[sec_event],
        )
        self.assertEqual(len(res2["alerts_created"]), 0)
        all_alerts = get_alerts(db_path=self.db_path)
        self.assertEqual(len(all_alerts), 1)

    def test_monitored_disk_path_resolution(self):
        """Verify that get_monitored_disk_path resolves to a valid filesystem path."""
        from backend.app.config import get_monitored_disk_path
        path = get_monitored_disk_path()
        self.assertTrue(os.path.exists(path))

        # Test environment variable override
        old_env = os.environ.get("DISK_MONITOR_PATH")
        try:
            os.environ["DISK_MONITOR_PATH"] = "/tmp"
            self.assertEqual(get_monitored_disk_path(), "/tmp")
        finally:
            if old_env is not None:
                os.environ["DISK_MONITOR_PATH"] = old_env
            else:
                os.environ.pop("DISK_MONITOR_PATH", None)

    def test_disk_usage_above_ninety_percent_creates_critical_alert(self):
        """Verify that 97.9% disk usage triggers a critical alert with exact observed value."""
        res = evaluate_all_alerts(
            db_path=self.db_path,
            metrics_override={"cpu_percent": 15.0, "memory_percent": 40.0, "disk_percent": 97.9},
            security_events_override=[],
        )
        self.assertEqual(len(res["alerts_created"]), 1)
        alert = res["alerts_created"][0]
        self.assertEqual(alert["source"], "disk")
        self.assertEqual(alert["severity"], "critical")
        self.assertIn("97.9%", alert["description"])
        self.assertIn("critical", alert["title"].lower())


if __name__ == "__main__":
    unittest.main()
