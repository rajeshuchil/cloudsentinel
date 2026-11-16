# CloudSentinel Security Model & Operational Guidelines

## Overview

CloudSentinel is designed with defense-in-depth principles appropriate for single-host Linux infrastructure monitoring. This document details the permissions model, log access strategy, data protection mechanisms, and forensic nuances of security telemetry.

---

## 1. Authentication Log Access & Linux Permissions

On Debian and Ubuntu systems, authentication activity is written by `systemd-journald` / `rsyslog` to `/var/log/auth.log`. Standard file permissions on Ubuntu are typically:

```text
-rw-r----- 1 syslog adm /var/log/auth.log
```

This permission mask means:
- The `syslog` user has read and write access.
- Members of the **`adm` group** have **read-only** access.
- All other non-root users have no read permissions.

### Safe Non-Root Execution
CloudSentinel does **NOT** require root privileges to read authentication logs. Instead, add the service execution user to the `adm` group:

```bash
sudo usermod -aG adm $USER
```

After updating group membership, log out and log back in, or run `newgrp adm` in your shell session to apply the group change.

### Graceful Fallback
If the authentication log is missing, unreadable, or permission is denied:
- The backend catches `PermissionError` and missing file exceptions safely.
- `GET /api/security/events` returns `"status": "degraded"` with a human-readable error explanation.
- System metrics and historical SQLite events remain fully functional.
- The service **never** crashes due to missing log permissions.

---

## 2. Why the Backend Should Not Run as Root

Running monitoring daemons or web APIs as `root` violates the **Principle of Least Privilege** and introduces severe security risks:

1. **Reduced Attack Surface**: The backend parses text and syslog lines using regular expressions. If an unexpected format string or parser vulnerability were exploited, running as a standard non-privileged user ensures the attacker does not gain root access.
2. **Filesystem Integrity**: A non-root process cannot accidentally modify or truncate host system files, kernel parameters, or system binaries.
3. **Audit Compliance**: System monitoring should record administrative actions, not perform actions with superuser authority.

> [!CAUTION]
> Never launch the FastAPI backend with `sudo uvicorn ...` or as the `root` user.

---

## 3. Data Protection & SQLite Storage

### Local-Only Persistence
- Security events and alerts are persisted in an embedded SQLite database (`backend/data/cloudsentinel.db`).
- The database is stored locally on the monitored machine and is not exposed directly to the network.

### No Storage of Raw Credentials or Sensitive Payloads
- CloudSentinel extracts only structured metadata:
  - Timestamp
  - Source IP
  - Target username
  - Target service (e.g. `sshd`, `sudo`)
  - Attempt count
  - Sanitized event summary
- CloudSentinel **never** stores passwords, password attempts, key material, authentication tokens, or raw syslog lines.

### Idempotent Event Deduplication
- Each security event receives an ID derived from a cryptographic hash (MD5/SHA256) of its immutable properties:
  `hash(timestamp + source_ip + target_user + category + attempts)`
- SQLite inserts use `INSERT OR IGNORE` with `id` as the primary key.
- Repeated polling of the same log entries never creates duplicate records in SQLite.

---

## 4. Environment Variables & Secret Handling

- CloudSentinel does not store or require third-party API keys, cloud tokens, or database passwords.
- All configuration is supplied via environment variables (`.env` file or process environment).
- `.gitignore` explicitly prevents `.env` and local database files from being committed to source control.
- Configuration templates (`.env.example` and `backend/.env.example`) contain only non-sensitive configuration defaults.

---

## 5. Network Exposure & CORS Configuration

### Loopback Binding
- During development and local deployment, both the FastAPI backend (`127.0.0.1:8000`) and the Vite frontend (`localhost:3000` / `localhost:5173`) bind to local loopback addresses.
- CloudSentinel is not intended to be exposed directly to the public internet without an authenticating reverse proxy (such as NGINX or Caddy with TLS and HTTP Basic / OAuth authentication).

### Strict CORS Policy
The backend explicitly validates the `Origin` header against an allowed whitelist configured via `CORS_ORIGINS`:
```bash
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173
```
Wildcard origins (`*`) are not used in production configurations.

---

## 6. Security Event Provenance & Forensic Nuance

### Background Scanners vs. Confirmed Compromise
An essential principle in Linux server security is that **failed authentication attempts do not prove a system intrusion**:
- Any internet-facing Linux server with an open SSH port (port 22) routinely receives automated scanning activity from bots, brute-force tools, and internet research crawlers.
- Failed password attempts for nonexistent accounts (e.g. `admin`, `guest`, `test`) indicate indiscriminate scanning, not necessarily a targeted attack or compromised credentials.
- A legitimate compromise typically exhibits:
  - Sudo privilege escalation failures after successful login.
  - Unexpected successful logins from anomalous geographic regions or outside business hours.
  - Rapid file alterations or unusual outbound network connections.
- CloudSentinel labels repeated authentication failures neutrally as **"Recorded security events awaiting operator verification"** rather than claiming a confirmed security breach.

### Identification of Test and Documentation Addresses
- The database or test logs may contain IP addresses from RFC 5737 documentation/test ranges (such as `198.51.100.99` from `198.51.100.0/24` TEST-NET-2).
- CloudSentinel recognizes these ranges and marks their provenance neutrally (`"Historical record (TEST-NET-2 · Unverified provenance)"`) to prevent false alarms during audit reviews.

---

## 7. Client-Side vs. Backend State Boundaries

- **Alert Lifecycle**: Operational and threshold alerts have full server-side persistence in SQLite. When an operator clicks **Acknowledge** or **Resolve**, the change is committed to the database via `PATCH /api/alerts/{id}/acknowledge` and `PATCH /api/alerts/{id}/resolve`.
- **Security Event Mitigation**: In Phase 6, marking a security event as "Mitigated" in the Security Events view updates client-side React state for the duration of the operator's browser session. Security event log entries themselves are immutable audit records in SQLite.
