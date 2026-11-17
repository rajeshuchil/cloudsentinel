# CloudSentinel — Render Free + Neon PostgreSQL Deployment Guide

This guide covers deploying the CloudSentinel Python FastAPI backend to **Render (Free Tier)** and connecting it to a persistent **Neon (Free Tier)** PostgreSQL database, with the React frontend hosted on Google AI Studio and telemetry reported by the Ubuntu monitoring agent.

---

## Architecture Overview

```
+------------------------------------+
|  Google AI Studio Starter Tier     |
|  React + TypeScript + Vite         |
|  (Frontend UI — HTTPS)             |
+-----------------+------------------+
                  | REST API / Polling (10s)
                  | Header: X-API-Key (DASHBOARD_API_KEY)
                  v
+------------------------------------+
|  Render Free Web Service           |
|  FastAPI Backend (Uvicorn)         |
|  In-Memory Telemetry Cache         |
+-----------------+------------------+
       |                         ^
       | SQL (Pooled SSL)        | HTTPS Telemetry (every 30s)
       | Throttled History (60s) | Header: X-Agent-Token
       v                         |
+----------------------+   +------------------------------------+
|  Neon PostgreSQL     |   |  Ubuntu Laptop                     |
|  (Free Serverless)   |   |  cloudsentinel-agent.service       |
|  cloudsentinel-db    |   |  psutil metrics + /var/log/auth.log|
+----------------------+   +------------------------------------+
```

---

## 1. Neon Free Compute Optimization & Math

Neon's Free Tier includes **100 compute hours (CU-hours)** per month, operating at a minimum compute size of **0.25 CU** with a **5-minute (300-second) auto-suspend** when idle.

### Monthly Compute Usage Math
| Usage Profile | Active Hours/Month | Compute Usage (at 0.25 CU) | Free Tier Status |
|---|---|---|---|
| **Daily Workstation Usage (8 hrs/day)** | 240 hours | 240 × 0.25 = **60 CU-hours** | **Fits comfortably within 100 CU-hr limit** |
| **Extended Workstation Usage (12 hrs/day)** | 360 hours | 360 × 0.25 = **90 CU-hours** | **Fits within 100 CU-hr limit** |
| **Unthrottled Continuous 24/7 Monitoring** | 720 hours | 720 × 0.25 = **180 CU-hours** | **Exceeds free limit (~day 17 exhausted)** |

### How CloudSentinel Optimizes Free Compute
1. **In-Memory Telemetry Caching:**
   When the React dashboard is open, it polls `GET /api/system` every 10 seconds. The FastAPI backend serves this request directly from an **in-memory cache** updated by the agent. This means frontend polling generates **zero database queries and zero database wakeups**.
2. **Throttled Historical Writes:**
   The agent transmits live telemetry every 30 seconds to maintain responsive real-time metrics, but the backend throttles writes to `telemetry_history` to **at most once per 60 seconds** per device (or immediately when an alert condition is triggered). This cuts database write I/O by over 75%.
3. **Auto-Suspend on Workstation Sleep:**
   When you close your laptop or shut it down at the end of the day, agent transmissions stop. After 5 minutes of inactivity, Neon's compute endpoint automatically enters suspended sleep mode, preserving your monthly compute quota.

> [!IMPORTANT]
> **Trade-Off for 24/7 Servers:**
> If you require continuous 24/7/365 server monitoring without interruption, a free serverless database with a 100 CU-hour cap will exhaust its free quota midway through the month if kept actively awake. For true 24/7 monitoring, either run the agent during operational hours, or upgrade Neon to the Launch tier ($19/mo) which includes continuous compute.

---

## 2. Neon PostgreSQL Setup (Free Tier)

### Step 2.1 — Create Neon Project
1. Navigate to [console.neon.tech](https://console.neon.tech) and sign up for a free account.
2. Click **Create Project**:
   - **Project Name:** `cloudsentinel-db`
   - **Postgres Version:** `16` (or `17`)
   - **Region:** Choose the region closest to your Render service (e.g. `US East (Ohio)` / `AWS us-east-2`).
3. Click **Create Project**.

### Step 2.2 — Obtain Pooled Connection String
1. In the Neon Console dashboard, locate **Connection Details**.
2. Ensure the **Pooled connection** checkbox is checked (enables PgBouncer, optimized for serverless applications).
3. Copy the connection string:
   ```
   postgresql://user:password@ep-xyz-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
4. **Never commit this string or expose it in public code.**

> [!NOTE]
> The FastAPI backend automatically initializes the database schema (`security_events`, `alerts`, `devices`, `telemetry_history`) upon its first startup.

### Step 2.3 — (Optional) Migrate Existing Local SQLite Records
If you have historical security events or alerts in `backend/data/cloudsentinel.db` that you wish to transfer to Neon:

```bash
DATABASE_URL="postgresql://user:password@ep-xyz-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require" \
./backend/.venv/bin/python3 backend/scripts/migrate_sqlite_to_postgres.py
```

---

## 3. Render Web Service Deployment (Free Tier)

### Step 3.1 — Connect Repository
1. Navigate to [dashboard.render.com](https://dashboard.render.com) and log in.
2. Click **New +** > **Web Service**.
3. Select your GitHub repository containing the CloudSentinel project.

### Step 3.2 — Configure Web Service
Configure the service parameters:
- **Name:** `cloudsentinel-backend`
- **Region:** Choose the same or closest region to your Neon DB (e.g. `Oregon (US West)` or `Ohio (US East)`).
- **Branch:** `main`
- **Root Directory:** *(leave blank — repository root)*
- **Runtime:** `Python 3`
- **Build Command:**
  ```bash
  pip install -r backend/requirements.txt
  ```
- **Start Command:**
  ```bash
  uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips='*'
  ```
- **Instance Type:** `Free`

### Step 3.3 — Configure Environment Variables
In the **Environment Variables** tab, add the following:

| Variable | Value | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://...sslmode=require` | Pooled connection string from Neon |
| `AGENT_API_KEY` | *(Generate via `openssl rand -hex 24`)* | Secret token for agent telemetry ingestion |
| `DASHBOARD_API_KEY` | *(Generate via `openssl rand -hex 24`)* | Secret key for frontend dashboard access |
| `CORS_ORIGINS` | `https://cloudsentinel.aistudio.google.com` | Exact deployed frontend origin (no wildcards) |
| `PYTHON_VERSION` | `3.10.12` | Python runtime version |

### Step 3.4 — Configure Health Check
- Under **Advanced Settings**, set **Health Check Path** to `/api/health`.
- Click **Create Web Service**.

### Free Tier Sleep Behavior & Connection Recovery
- Render Free web services spin down after 15 minutes of inactivity.
- Initial cold-start wake-up takes ~30–50 seconds.
- When Neon wakes up from auto-suspend, previous pooled TCP sockets become stale. CloudSentinel's database adapter automatically probes connections with `SELECT 1;` and re-establishes stale connections without throwing 500 errors to clients.

---

## 4. Frontend Configuration (Google AI Studio)

1. In your frontend environment configuration (`.env` or AI Studio Build Mode settings):
   ```ini
   VITE_API_BASE_URL=https://cloudsentinel-backend.onrender.com
   VITE_API_KEY=your-generated-dashboard-api-key
   ```
2. Rebuild and republish the frontend:
   - Re-deploy to Google AI Studio / Cloud Run.
3. Open the web app: the connection status will show **LIVE HOST DATA** (or **CONNECTING** while the free Render service warms up).

---

## 5. Ubuntu Laptop Agent Deployment

Run on your Ubuntu laptop:

```bash
# 1. Ensure user is in the 'adm' group to read /var/log/auth.log without root
sudo usermod -aG adm $USER
# (Log out and back in if this group was newly added)

# 2. Enter agent directory and run installer
cd agent
./install.sh

# 3. Configure backend URL and secret token
nano .env
# Set BACKEND_URL=https://cloudsentinel-backend.onrender.com
# Set AGENT_TOKEN=<your_agent_api_key>
# Set TELEMETRY_INTERVAL=30

# 4. Install and enable background systemd service
sudo cp /tmp/cloudsentinel-agent.service /etc/systemd/system/cloudsentinel-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now cloudsentinel-agent.service

# 5. Verify agent status and logs
sudo systemctl status cloudsentinel-agent.service
journalctl -u cloudsentinel-agent.service -f
```

---

## 6. Verification Checklist

1. **Backend Health Check:**
   ```bash
   curl -s https://cloudsentinel-backend.onrender.com/api/health
   # Returns: {"status":"healthy","service":"cloudsentinel-backend","database":"postgres"}
   ```
2. **Device Registered:**
   ```bash
   curl -s -H "X-API-Key: <your_dashboard_key>" https://cloudsentinel-backend.onrender.com/api/agent/devices
   # Returns list of devices with status: "online"
   ```
3. **Frontend Dashboard:**
   - Hostname, OS, IP, and specs reflect your real Ubuntu laptop.
   - Status badge shows `ONLINE`.
   - CPU line chart accumulates real samples.
   - Closing the laptop or stopping the agent causes the status badge to switch to `OFFLINE` after 60s.
   - Re-opening the laptop returns the status automatically to `ONLINE`.
   - Render's container metrics are **never** displayed.
