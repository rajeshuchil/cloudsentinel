# CloudSentinel Ubuntu Monitoring Agent

A lightweight, non-root Python telemetry and security monitoring agent designed for Ubuntu Linux.

## Features

- **System Telemetry:** Real-time CPU usage, load average, RAM, disk partitions, and network interface metrics using `psutil`.
- **Security Monitoring:** Monitors `/var/log/auth.log` for failed SSH attempts, invalid usernames, successful SSH logins, and sudo privilege events.
- **Sanitized Events:** Transmits structured event metadata only. Never collects, transmits, or logs passwords, private keys, or raw authentication secrets.
- **Incremental Log Ingestion:** Inode-aware log tailing reads only newly appended entries after startup and handles `logrotate` automatically.
- **Resilient Delivery:** Transmits telemetry every 15 seconds with exponential backoff and event queuing during network interruptions.
- **Zero Heavy Dependencies:** Relies purely on `psutil` and standard Python libraries (`urllib.request`).

---

## Prerequisites

1. Ubuntu Linux (20.04 LTS, 22.04 LTS, 24.04 LTS)
2. Python 3.9+ with `python3-venv`
3. Membership in the `adm` group (for reading `/var/log/auth.log` without root privileges):
   ```bash
   sudo usermod -aG adm $USER
   ```
   *(Log out and back in after running this command for group membership to take effect)*

---

## Quick Installation

Run the automated installer from the `agent/` directory:

```bash
cd agent
./install.sh
```

---

## Configuration (`.env`)

Configure the agent's target backend and secret token in `agent/.env`:

```ini
# Backend URL (Render production URL or local development server)
BACKEND_URL=https://cloudsentinel-backend.onrender.com

# Device-specific authentication token (must match AGENT_API_KEY in backend)
AGENT_TOKEN=your-secure-agent-token-here

# Telemetry transmission interval in seconds
TELEMETRY_INTERVAL=15

# Path to Linux authentication log
AUTH_LOG_PATH=/var/log/auth.log

# Optional: Custom device identifier
# AGENT_DEVICE_ID=ubuntu-workstation
```

---

## Running as a Background Systemd Service

To keep the agent running persistently without keeping a terminal window open:

```bash
# 1. Copy the prepared service unit to systemd
sudo cp /tmp/cloudsentinel-agent.service /etc/systemd/system/cloudsentinel-agent.service

# 2. Reload systemd daemon
sudo systemctl daemon-reload

# 3. Enable and start the agent service
sudo systemctl enable --now cloudsentinel-agent.service
```

### Management Commands

- **Check Service Status:**
  ```bash
  sudo systemctl status cloudsentinel-agent.service
  ```

- **Inspect Live Agent Logs:**
  ```bash
  journalctl -u cloudsentinel-agent.service -f
  ```

- **Restart the Agent:**
  ```bash
  sudo systemctl restart cloudsentinel-agent.service
  ```

- **Stop the Agent:**
  ```bash
  sudo systemctl stop cloudsentinel-agent.service
  ```

- **Uninstall the Service:**
  ```bash
  sudo systemctl disable --now cloudsentinel-agent.service
  sudo rm /etc/systemd/system/cloudsentinel-agent.service
  sudo systemctl daemon-reload
  ```

---

## Manual Testing (Foreground Mode)

You can run the agent in the foreground to verify telemetry collection and network delivery:

```bash
cd agent
./venv/bin/python3 agent.py
```
