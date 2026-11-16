# CloudSentinel

**A lightweight, real-time Linux infrastructure and security monitoring dashboard built with FastAPI, SQLite, psutil, and React.**

CloudSentinel provides single-host visibility into Linux system resources, authentication logs, and operational alerts. Designed specifically for Ubuntu/Debian servers, it collects genuine hardware metrics, parses SSH and sudo authentication events, evaluates threshold rules, and persists alerts without external database dependencies or enterprise complexity.

---

## 1. Project Overview

Modern Linux server administration requires prompt awareness of resource bottlenecks and suspicious authentication patterns without the overhead of heavy monitoring agents or complex time-series infrastructure.

CloudSentinel bridges this gap with an efficient architecture:
- A non-root Python **FastAPI backend** that reads local system statistics directly from `/proc` and `/sys` via `psutil`, tails `/var/log/auth.log` safely in read-only mode, and manages alert state transitions in a local **SQLite** database.
- A modern **React 19 + TypeScript + Vite** frontend that delivers an intuitive administrative dashboard with real-time SVG CPU charts, dark mode support, and an operational alert log.

> [!NOTE]
> CloudSentinel currently monitors the single Linux host running the backend service. It is not a distributed multi-host or cloud agent.

---

## 2. Key Features

- **Live Linux System Metrics via psutil**: Real-time extraction of CPU utilization, logical core count, load averages (1m, 5m, 15m), virtual memory (used, total, available), filesystem disk capacity, and active network interfaces.
- **CPU, RAM, and Disk Monitoring**: Visual gauge cards with threshold-based color states (nominal, elevated, critical).
- **Interactive CPU Usage Chart**: Real-time SVG line chart that accumulates live CPU telemetry points directly from the host API.
- **Intelligent Network Interface Selection**: Automatically scores and prioritizes physical Wi-Fi (`wl*`) and Ethernet (`en*`, `eth*`) interfaces over Docker bridges, container virtual interfaces, and loopback.
- **Linux SSH & Authentication Log Analysis**: Automated ingestion and regex parsing of `/var/log/auth.log` identifying failed passwords for valid/invalid users and sudo authorization failures.
- **Repeated Failed-Login Burst Detection**: Sliding time-window correlation (default: 5 attempts within 5 minutes) that groups brute-force attempts from a single IP into a single prioritized critical event.
- **Automated Threshold-Based Alert Engine**: Background evaluation cycle that monitors resource usage against configurable warning and critical thresholds, escalates active alerts without creating duplicates, and auto-resolves alerts once metrics recover.
- **Embedded SQLite Persistence**: Zero-configuration, local SQLite database with Write-Ahead Logging (WAL) and idempotent event deduplication via deterministic cryptographic hashes.
- **Full Alert Lifecycle Management**: Operators can review, acknowledge, and resolve operational and security alerts directly from the dashboard via RESTful endpoints.
- **Responsive Dark/Light Mode Dashboard**: Accessible user interface built with Tailwind CSS, Lucide icons, and keyboard-friendly navigation.

---

## 3. Screenshots

*Dashboard screenshots will be added below:*

### Overview View
*Real-time host resource metrics, live CPU history chart, and operational alert banner.*

```
+-----------------------------------------------------------------------------------+
|  [Screenshot Placeholder: CloudSentinel Overview View - Host Telemetry & Gauges]  |
+-----------------------------------------------------------------------------------+
```

### Security Events & Authentication View
*Structured authentication failure log, burst correlation, and detailed event inspector.*

```
+-----------------------------------------------------------------------------------+
|  [Screenshot Placeholder: Security Events View - Log Inspection & Filters]        |
+-----------------------------------------------------------------------------------+
```

### Operational Alert Log
*Active, acknowledged, and resolved operational alert management table.*

```
+-----------------------------------------------------------------------------------+
|  [Screenshot Placeholder: Alert Log View - Lifecycle State Management]            |
+-----------------------------------------------------------------------------------+
```

---

## 4. Technology Stack

### Backend
- **Python 3.10+**
- **FastAPI 0.110+**: Asynchronous web framework with automatic OpenAPI documentation.
- **Uvicorn**: High-performance ASGI web server.
- **psutil 5.9+**: Cross-platform system and process telemetry library.
- **SQLite 3**: Standard library database engine with Write-Ahead Logging (WAL) mode.
- **Pydantic v2**: Request validation and response serialization.

### Frontend
- **React 19**: Modern component architecture using functional hooks.
- **TypeScript**: Static typing across all components, API schemas, and telemetry models.
- **Vite 8**: Rapid development bundler with native ES modules.
- **Tailwind CSS 4**: Utility-first responsive styling with dark-mode support.
- **Lucide React**: Clean, accessible iconography.

---

## 5. Architecture Overview

CloudSentinel operates as a two-tier application:

```
[ Ubuntu Host Kernel & /var/log/auth.log ]
                   │
                   ▼
       [ Python FastAPI Backend ]
       ├── collectors/system_collector.py (psutil)
       ├── collectors/log_collector.py (safe tailing)
       ├── security/ssh_analyzer.py (regex & burst correlation)
       ├── services/alert_engine.py (thresholds & auto-resolve)
       └── database/ (SQLite with WAL mode)
                   ▲
                   │ HTTP REST API (localhost:8000)
                   ▼
     [ React + TypeScript Dashboard ]
       ├── src/services/api.ts (typed client & network interface scoring)
       ├── src/components/CpuLineChart.tsx (in-memory SVG line graph)
       └── src/App.tsx (10s telemetry polling, 60s alert evaluation)
```

For complete architectural details, module breakdowns, and sequence diagrams, refer to [Architecture Documentation](docs/architecture.md).

---

## 6. Project Directory Structure

```text
cloudsentinel/
├── backend/                        # FastAPI backend application
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                 # FastAPI application bootstrap & CORS
│   │   ├── config.py               # Environment configuration & threshold values
│   │   ├── api/                    # REST API route handlers
│   │   │   ├── alerts.py           # /api/alerts endpoints
│   │   │   ├── security.py         # /api/security endpoints
│   │   │   └── system.py           # /api/system endpoint
│   │   ├── collectors/             # Host telemetry & log collectors
│   │   │   ├── log_collector.py    # Safe tailing of /var/log/auth.log
│   │   │   └── system_collector.py # psutil Linux system telemetry
│   │   ├── database/               # SQLite persistence layer
│   │   │   ├── connection.py       # Connection management, WAL mode, DDL
│   │   │   └── repositories.py     # Parameterized SQL CRUD queries
│   │   ├── security/               # Security log analysis
│   │   │   └── ssh_analyzer.py     # Regex parsing & burst correlation
│   │   └── services/               # Background services
│   │       └── alert_engine.py     # Threshold evaluation & auto-resolution
│   ├── data/                       # Local SQLite database directory (git-ignored)
│   ├── tests/                      # Automated test suite (unittest)
│   │   ├── test_alert_engine.py
│   │   ├── test_database.py
│   │   └── test_security.py
│   ├── .env.example                # Backend environment template
│   └── requirements.txt            # Python dependencies
├── docs/                           # Technical documentation
│   ├── api.md                      # Full REST API endpoint reference
│   ├── architecture.md             # System data flow & component design
│   └── security.md                 # Security model, log permissions & least privilege
├── src/                            # React + TypeScript frontend
│   ├── components/                 # UI components
│   │   ├── AlertsTable.tsx         # Operational alerts table with actions
│   │   ├── CpuLineChart.tsx        # Dynamic SVG CPU telemetry chart
│   │   ├── MetricCard.tsx          # Resource gauge cards
│   │   ├── SecurityEventsView.tsx  # Detailed security log audit view
│   │   ├── SecuritySummarySection.tsx # Security metrics summary strip
│   │   └── SystemHealthBanner.tsx  # Composite health banner
│   ├── data/                       # Initial data models & health calculation
│   │   └── mockTelemetry.ts
│   ├── services/                   # Frontend API integration
│   │   └── api.ts                  # Typed HTTP client & interface selection
│   ├── types/                      # TypeScript type definitions
│   │   └── monitoring.ts           # Shared data interfaces
│   ├── App.tsx                     # Main application controller & state
│   ├── main.tsx                    # React application entry point
│   └── index.css                   # Global styles & Tailwind configuration
├── .env.example                    # Frontend environment template
├── .gitignore                      # Git exclusion rules
├── package.json                    # Node.js dependencies & scripts
├── tsconfig.json                   # TypeScript compiler configuration
└── vite.config.ts                  # Vite build configuration
```

---

## 7. Prerequisites

Before installing CloudSentinel, ensure your environment meets the following requirements:

- **Operating System**: Ubuntu 22.04 LTS / 24.04 LTS or Debian 12.
- **Python**: Python 3.10 or higher with `python3-venv` installed.
- **Node.js**: Node.js 18.x or higher with `npm`.
- **User Permissions**: A standard non-root user with membership in the `adm` group (required for read-only access to `/var/log/auth.log`).

```bash
# Verify adm group membership
groups | grep -w "adm" || sudo usermod -aG adm $USER
```

---

## 8. Installation & Setup

### Step 1: Clone the Repository
```bash
git clone https://github.com/your-username/cloudsentinel.git
cd cloudsentinel
```

### Step 2: Set Up Backend Virtual Environment
```bash
# Create Python virtual environment inside backend/
python3 -m venv backend/.venv

# Activate the virtual environment
source backend/.venv/bin/activate

# Install required Python packages
pip install -r backend/requirements.txt
```

### Step 3: Install Frontend Dependencies
```bash
# From the project root
npm install
```

### Step 4: Configure Environment Files
```bash
# Frontend environment
cp .env.example .env

# Backend environment
cp backend/.env.example backend/.env
```

---

## 9. Starting the Application

For development or local testing, launch the backend and frontend in separate terminal windows:

### Terminal 1: Start Backend Service
```bash
cd cloudsentinel
source backend/.venv/bin/activate
python3 -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```
- API root: `http://127.0.0.1:8000`
- Interactive OpenAPI documentation: `http://127.0.0.1:8000/docs`

### Terminal 2: Start Frontend Dashboard
```bash
cd cloudsentinel
npm run dev
```
- Dashboard URL: `http://localhost:3000` (or `http://localhost:5173` if port 3000 is occupied).

---

## 10. API Endpoint Reference Summary

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health status. |
| `GET` | `/api/system` | Live host CPU, RAM, disk, network, and OS telemetry. |
| `GET` | `/api/security/events` | Historical and recent authentication events from SQLite. |
| `GET` | `/api/alerts` | List operational and security alerts with status/severity filters. |
| `POST` | `/api/alerts` | Manually insert an operational alert. |
| `GET` | `/api/alerts/{id}` | Retrieve an alert by unique identifier. |
| `POST` | `/api/alerts/evaluate` | Evaluate resource thresholds and correlate security events. |
| `PATCH` | `/api/alerts/{id}/acknowledge` | Transition an active alert to acknowledged. |
| `PATCH` | `/api/alerts/{id}/resolve` | Transition an active or acknowledged alert to resolved. |

For detailed request/response schemas and example payloads, see [API Documentation](docs/api.md).

---

## 11. Configuration & Environment Variables

### Backend Configuration (`backend/.env`)

| Variable | Type | Default | Description |
|---|---|---|---|
| `HOST` | string | `127.0.0.1` | Binding address for Uvicorn server. |
| `PORT` | integer | `8000` | Port for Uvicorn server. |
| `CORS_ORIGINS` | string | `http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173` | Comma-separated list of allowed frontend origins. |
| `SQLITE_DB_PATH` | string | `backend/data/cloudsentinel.db` | Path to persistent SQLite database file. |
| `AUTH_LOG_PATH` | string | `/var/log/auth.log` | Path to system authentication log. |
| `DISK_MONITOR_PATH`| string | `/` | Target filesystem mount point to monitor. |
| `CPU_WARNING_THRESHOLD` | float | `75.0` | CPU utilization percentage to trigger warning alert. |
| `CPU_CRITICAL_THRESHOLD` | float | `90.0` | CPU utilization percentage to trigger critical alert. |
| `MEMORY_WARNING_THRESHOLD` | float | `80.0` | RAM utilization percentage to trigger warning alert. |
| `MEMORY_CRITICAL_THRESHOLD` | float | `92.0` | RAM utilization percentage to trigger critical alert. |
| `DISK_WARNING_THRESHOLD` | float | `75.0` | Disk usage percentage to trigger warning alert. |
| `DISK_CRITICAL_THRESHOLD` | float | `90.0` | Disk usage percentage to trigger critical alert. |
| `SSH_REPEATED_ATTEMPTS_THRESHOLD` | integer | `5` | Failed attempts from an IP to trigger burst alert. |
| `SSH_WINDOW_SECONDS` | integer | `300` | Sliding window in seconds for burst correlation. |

### Frontend Configuration (`.env`)

| Variable | Type | Default | Description |
|---|---|---|---|
| `VITE_API_BASE_URL` | string | `http://127.0.0.1:8000` | Base URL of the FastAPI backend. |

---

## 12. Testing

CloudSentinel includes a comprehensive automated test suite covering database operations, log analysis, and the alert evaluation engine.

### Running Backend Unit Tests
```bash
# Ensure virtual environment is activated
source backend/.venv/bin/activate

# Execute all backend tests
python3 -m unittest discover -s backend/tests -v
```
All tests use isolated temporary databases (`:memory:` or temporary disk files) to ensure the live database is never modified during test runs.

### Running Frontend Verification
```bash
# Type check without emitting code
npm run lint   # (tsc --noEmit)

# Build production bundle
npm run build
```

---

## 13. Security Considerations

- **Least Privilege Execution**: CloudSentinel does not require and should **never** be run as root. Access to `/var/log/auth.log` is provided via standard Linux `adm` group membership.
- **Sanitized Metadata Storage**: No passwords, authentication tokens, or raw sensitive log strings are ever stored in SQLite. Only structured metadata (timestamp, user, IP, attempts) is recorded.
- **Deterministic Deduplication**: Event IDs are cryptographically hashed, preventing database inflation or duplicate records from repeated log inspection.
- **Forensic Nuance**: High failure rates on public SSH ports often reflect background automated scanning rather than a compromised host. CloudSentinel labels events neutrally as recorded items requiring operator verification.

For a full security breakdown, see [Security Documentation](docs/security.md).

---

## 14. Current Limitations & Future Roadmap

### Current Limitations
- **Single-Host Architecture**: CloudSentinel monitors only the single Linux machine where the backend process is running.
- **In-Memory CPU History**: The real-time CPU chart accumulates points in frontend memory during an active browser session; metrics prior to opening the dashboard are not graphed.
- **Client-Side Event Mitigation**: Marking a security event as "Mitigated" in the Security Events view updates client-side state for the session; alert state changes (acknowledge/resolve) are fully persisted in SQLite.
- **No Native Authentication**: The backend binds to loopback (`127.0.0.1`). If exposed across a network, an authenticating reverse proxy (NGINX/Caddy with TLS and auth) must be placed in front.

### Future Roadmap
- [ ] Persistent time-series storage for historical metric aggregation (e.g. SQLite RRD or lightweight time-series table).
- [ ] Dedicated `PATCH /api/security/events/{id}` endpoint for persisted security event mitigation notes.
- [ ] Automated log rotation support (`/var/log/auth.log.1` inspection).
- [ ] Webhook notifications (Slack, Discord, PagerDuty, or email) upon critical alert creation.
- [ ] Systemd service unit files and deb packaging for background daemon deployment.

---

## License

This project is open-source under the [MIT License](LICENSE).
