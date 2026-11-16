import unittest
from backend.app.collectors.log_collector import check_log_access, read_recent_log_lines
from backend.app.security.ssh_analyzer import analyze_log_lines, parse_single_line


class TestSecurityAnalyzer(unittest.TestCase):
    def test_failed_ssh_valid_user(self):
        line = "Nov 17 03:00:01 myhost sshd[12345]: Failed password for root from 192.168.1.100 port 51234 ssh2"
        res = parse_single_line(line)
        self.assertIsNotNone(res)
        self.assertEqual(res["category"], "failed_ssh")
        self.assertEqual(res["severity"], "warning")
        self.assertEqual(res["service"], "sshd")
        self.assertEqual(res["target_user"], "root")
        self.assertEqual(res["source_ip"], "192.168.1.100")
        self.assertTrue(res["is_failure"])

    def test_invalid_ssh_username(self):
        line = "Nov 17 03:00:02 myhost sshd[12346]: Failed password for invalid user admin from 10.0.0.99 port 41234 ssh2"
        res = parse_single_line(line)
        self.assertIsNotNone(res)
        self.assertEqual(res["category"], "invalid_user")
        self.assertEqual(res["severity"], "warning")
        self.assertEqual(res["target_user"], "admin")
        self.assertEqual(res["source_ip"], "10.0.0.99")
        self.assertTrue(res["is_failure"])

    def test_successful_ssh_login(self):
        line = "Nov 17 03:00:03 myhost sshd[12347]: Accepted publickey for rajesh from 192.168.1.50 port 45231 ssh2"
        res = parse_single_line(line)
        self.assertIsNotNone(res)
        self.assertEqual(res["category"], "successful_login")
        self.assertEqual(res["severity"], "info")
        self.assertEqual(res["target_user"], "rajesh")
        self.assertEqual(res["source_ip"], "192.168.1.50")
        self.assertFalse(res["is_failure"])

    def test_sudo_authentication_failure(self):
        line = "Nov 17 03:00:04 myhost sudo: pam_unix(sudo:auth): authentication failure; logname=rajesh uid=1000 euid=0 tty=/dev/pts/1 ruser=rajesh rhost=  user=rajesh"
        res = parse_single_line(line)
        self.assertIsNotNone(res)
        self.assertEqual(res["category"], "auth_failure")
        self.assertEqual(res["severity"], "warning")
        self.assertEqual(res["service"], "sudo")
        self.assertTrue(res["is_failure"])

    def test_repeated_failed_attempts_detection(self):
        # 6 failed attempts from 203.0.113.50 within 1 minute
        lines = [
            f"Nov 17 03:10:0{i} myhost sshd[{1000+i}]: Failed password for invalid user bot from 203.0.113.50 port 5000{i} ssh2"
            for i in range(6)
        ]
        # 2 failed attempts from 198.51.100.20 (below threshold)
        lines.extend([
            "Nov 17 03:10:10 myhost sshd[2001]: Failed password for root from 198.51.100.20 port 50010 ssh2",
            "Nov 17 03:10:15 myhost sshd[2002]: Failed password for root from 198.51.100.20 port 50011 ssh2",
        ])

        events = analyze_log_lines(lines, repeated_threshold=5, window_seconds=300)

        # Look for repeated attempt category
        repeated_events = [e for e in events if e["category"] == "repeated_attempt"]
        self.assertEqual(len(repeated_events), 1)
        self.assertEqual(repeated_events[0]["source_ip"], "203.0.113.50")
        self.assertEqual(repeated_events[0]["severity"], "critical")
        self.assertEqual(repeated_events[0]["attempts"], 6)

        # Verify 198.51.100.20 does NOT have a repeated_attempt event
        non_threshold_repeated = [e for e in repeated_events if e["source_ip"] == "198.51.100.20"]
        self.assertEqual(len(non_threshold_repeated), 0)

    def test_malformed_and_irrelevant_lines(self):
        lines = [
            "",
            "   ",
            "Not a syslog line at all",
            "Nov 17 03:00:00 myhost CRON[123]: pam_unix(cron:session): session closed for user root",
            "Nov 17 03:00:01 myhost systemd-logind[100]: Watching system buttons",
            "Nov 17 03:00:02 myhost kernel: [12345.678] USB disconnect",
        ]
        events = analyze_log_lines(lines)
        self.assertEqual(len(events), 0)

    def test_mixed_iso_and_bsd_timestamps(self):
        # Ensure offset-aware ISO and offset-naive BSD timestamps do not trigger TypeError
        lines = [
            "2026-11-17T03:00:00+05:30 myhost sshd[1001]: Failed password for root from 192.0.2.1 port 50001 ssh2",
            "Nov 17 03:00:05 myhost sshd[1002]: Failed password for root from 192.0.2.1 port 50002 ssh2",
            "2026-11-17T03:00:10+05:30 myhost sshd[1003]: Failed password for root from 192.0.2.1 port 50003 ssh2",
            "Nov 17 03:00:15 myhost sshd[1004]: Failed password for root from 192.0.2.1 port 50004 ssh2",
            "2026-11-17T03:00:20+05:30 myhost sshd[1005]: Failed password for root from 192.0.2.1 port 50005 ssh2",
        ]
        events = analyze_log_lines(lines, repeated_threshold=5, window_seconds=300)
        rep = [e for e in events if e["category"] == "repeated_attempt"]
        self.assertEqual(len(rep), 1)
        self.assertEqual(rep[0]["attempts"], 5)

    def test_missing_or_inaccessible_log_source(self):
        non_existent_path = "/tmp/does_not_exist_auth_log_test.log"
        accessible, err_msg = check_log_access(non_existent_path)
        self.assertFalse(accessible)
        self.assertIn("not found", err_msg.lower())

        lines, info = read_recent_log_lines(log_path=non_existent_path)
        self.assertEqual(len(lines), 0)
        self.assertEqual(info["status"], "unavailable")
        self.assertIsNotNone(info["error"])


if __name__ == "__main__":
    unittest.main()
