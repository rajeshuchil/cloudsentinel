# CloudSentinel REST API Reference

The CloudSentinel backend provides a RESTful HTTP API built with FastAPI. All endpoints return JSON responses.

**Base URL**: `http://127.0.0.1:8000`

---

## Table of Endpoints

| Method | Path | Summary | Description |
|---|---|---|---|
| `GET` | `/api/health` | Health Check | Validates that the API service is alive. |
| `GET` | `/api/system` | Host Metrics | Returns live Linux CPU, RAM, disk, network, and OS statistics. |
| `GET` | `/api/security/events` | Security Events | Retrieves parsed authentication events from SQLite. |
| `GET` | `/api/alerts` | List Alerts | Returns persistent operational and security alerts. |
| `POST` | `/api/alerts` | Create Alert | Manually creates an alert record. |
| `GET` | `/api/alerts/{alert_id}` | Get Alert | Retrieves a single alert record by ID. |
| `POST` | `/api/alerts/evaluate` | Evaluate Alerts | Runs a full metric threshold and security correlation cycle. |
| `PATCH` | `/api/alerts/{alert_id}/acknowledge` | Acknowledge Alert | Transitions an active alert to acknowledged. |
| `PATCH` | `/api/alerts/{alert_id}/resolve` | Resolve Alert | Transitions an active or acknowledged alert to resolved. |

---

## Endpoint Details

### 1. Health Check
`GET /api/health`

Validates that the FastAPI application is running.

#### Parameters
None.

#### Success Response
**Status Code**: `200 OK`
```json
{
  "status": "healthy",
  "service": "cloudsentinel-backend"
}
```

---

### 2. Live System Metrics
`GET /api/system`

Collects and returns real-time hardware telemetry from the Ubuntu machine running the backend using Python's `psutil`.

#### Parameters
None.

#### Success Response
**Status Code**: `200 OK`
```json
{
  "system": {
    "hostname": "ubuntu-srv-01",
    "os": "Linux",
    "os_release": "Ubuntu 24.04.1 LTS",
    "kernel_version": "6.8.0-45-generic",
    "architecture": "x86_64",
    "uptime_seconds": 1234567.89
  },
  "cpu": {
    "usage_percent": 14.2,
    "logical_cores": 8,
    "load_average": {
      "1m": 0.45,
      "5m": 0.52,
      "15m": 0.61
    }
  },
  "memory": {
    "total_bytes": 16777216000,
    "used_bytes": 8388608000,
    "available_bytes": 8388608000,
    "usage_percent": 50.0
  },
  "disk": {
    "mount_point": "/",
    "total_bytes": 512000000000,
    "used_bytes": 501248000000,
    "free_bytes": 10752000000,
    "usage_percent": 97.9
  },
  "network": {
    "interfaces": [
      {
        "name": "wlo1",
        "is_up": true,
        "speed_mbps": 0,
        "mtu": 1500,
        "addresses": [
          {
            "family": "IPv4",
            "address": "192.168.1.120",
            "netmask": "255.255.255.0",
            "broadcast": "192.168.1.255"
          }
        ]
      }
    ]
  }
}
```

---

### 3. Get Security Events
`GET /api/security/events`

Safely reads the tail of `/var/log/auth.log`, identifies authentication failure patterns and repeated burst clusters, persists newly discovered events into SQLite (`INSERT OR IGNORE`), and returns the stored audit log sorted by timestamp descending.

#### Query Parameters
| Parameter | Type | Required | Default | Constraints | Description |
|---|---|---|---|---|---|
| `limit` | integer | No | `50` | `1 <= limit <= 500` | Maximum number of records to return. |
| `offset` | integer | No | `0` | `offset >= 0` | Pagination offset. |
| `category` | string | No | `null` | | Filter by category (`failed_ssh`, `repeated_attempt`, `auth_failure`, `suspicious_ip`). |
| `severity` | string | No | `null` | | Filter by severity (`info`, `warning`, `critical`). |
| `max_log_lines` | integer | No | `1000` | `50 <= max_log_lines <= 10000` | Number of recent log lines to read. |
| `repeated_threshold`| integer | No | `5` | `2 <= repeated_threshold <= 50` | Threshold count of failed attempts for burst correlation. |
| `window_minutes` | integer | No | `5` | `1 <= window_minutes <= 60` | Time window in minutes for correlation. |

#### Success Response
**Status Code**: `200 OK`
```json
{
  "status": "success",
  "log_source": "/var/log/auth.log",
  "error": null,
  "newly_ingested": 0,
  "total_events": 7,
  "returned_events": 7,
  "events": [
    {
      "id": "e3b0c44298fc1c149afbf4c8996fb924",
      "timestamp": "2026-11-17T03:45:00",
      "severity": "critical",
      "category": "repeated_attempt",
      "source_ip": "198.51.100.99",
      "target_user": "root",
      "service": "sshd",
      "attempts": 5,
      "description": "Repeated failed SSH login attempts (5 attempts) detected from source IP 198.51.100.99 within 5 minutes",
      "created_at": "2026-11-17T03:45:01.123456"
    }
  ]
}
```

*Note: If the auth log is missing or unreadable, `"status": "degraded"` is returned alongside an explanatory `"error"` message. Historical events stored in SQLite remain accessible.*

---

### 4. List Alerts
`GET /api/alerts`

Retrieves persistent operational and security alerts ordered by creation time descending.

#### Query Parameters
| Parameter | Type | Required | Default | Constraints | Description |
|---|---|---|---|---|---|
| `limit` | integer | No | `50` | `1 <= limit <= 500` | Maximum number of alerts to return. |
| `offset` | integer | No | `0` | `offset >= 0` | Pagination offset. |
| `status` | string | No | `null` | `active`, `acknowledged`, `resolved` | Filter alerts by current lifecycle state. |
| `severity` | string | No | `null` | `info`, `warning`, `critical` | Filter alerts by severity level. |

#### Success Response
**Status Code**: `200 OK`
```json
{
  "status": "success",
  "total_returned": 1,
  "alerts": [
    {
      "id": "alert-c4ca4238a0b9",
      "title": "Critical Disk Space Usage",
      "description": "Disk space on / has reached 97.9% (critical threshold: 90.0%)",
      "severity": "critical",
      "source": "system_disk",
      "status": "active",
      "created_at": "2026-11-17T03:45:00Z",
      "updated_at": "2026-11-17T03:45:00Z",
      "acknowledged_at": null,
      "resolved_at": null
    }
  ]
}
```

---

### 5. Create Manual Alert
`POST /api/alerts`

Manually creates an alert record in SQLite.

#### Request Body
```json
{
  "title": "Scheduled Maintenance In Progress",
  "description": "Kernel patch updates are being applied.",
  "severity": "info",
  "source": "manual_operator"
}
```

#### Success Response
**Status Code**: `201 Created`
```json
{
  "id": "alert-7a1b2c3d4e5f",
  "title": "Scheduled Maintenance In Progress",
  "description": "Kernel patch updates are being applied.",
  "severity": "info",
  "source": "manual_operator",
  "status": "active",
  "created_at": "2026-11-17T03:50:00Z",
  "updated_at": "2026-11-17T03:50:00Z",
  "acknowledged_at": null,
  "resolved_at": null
}
```

#### Error Response
- `422 Unprocessable Entity`: If `severity` is not one of `info`, `warning`, `critical`, or if required fields are missing.

---

### 6. Get Alert by ID
`GET /api/alerts/{alert_id}`

Retrieves an alert by its unique identifier.

#### Path Parameters
- `alert_id` (string, required): The alert ID.

#### Success Response
**Status Code**: `200 OK`
```json
{
  "id": "alert-c4ca4238a0b9",
  "title": "Critical Disk Space Usage",
  "description": "Disk space on / has reached 97.9% (critical threshold: 90.0%)",
  "severity": "critical",
  "source": "system_disk",
  "status": "active",
  "created_at": "2026-11-17T03:45:00Z",
  "updated_at": "2026-11-17T03:45:00Z",
  "acknowledged_at": null,
  "resolved_at": null
}
```

#### Error Response
- `404 Not Found`:
```json
{
  "detail": "Alert with ID 'alert-xyz' was not found"
}
```

---

### 7. Evaluate Alerts
`POST /api/alerts/evaluate`

Triggers an automated evaluation cycle:
1. Samples CPU, memory, and disk utilization.
2. Compares metrics against warning and critical thresholds.
3. Automatically creates new alerts, updates existing open alerts, or resolves alerts whose metrics have recovered.
4. Analyzes recent log entries and alerts on repeated SSH failure bursts.
5. Returns a summary of created, updated, and resolved alert objects.

#### Parameters
None.

#### Success Response
**Status Code**: `200 OK`
```json
{
  "status": "success",
  "evaluated_at": "2026-11-17T03:55:00.123456Z",
  "metrics": {
    "cpu_percent": 14.2,
    "memory_percent": 68.5,
    "disk_percent": 97.9
  },
  "alerts_created": [
    {
      "id": "alert-c4ca4238a0b9",
      "title": "Critical Disk Space Usage",
      "description": "Disk space on / has reached 97.9% (critical threshold: 90.0%)",
      "severity": "critical",
      "source": "system_disk",
      "status": "active",
      "created_at": "2026-11-17T03:55:00Z",
      "updated_at": "2026-11-17T03:55:00Z",
      "acknowledged_at": null,
      "resolved_at": null
    }
  ],
  "alerts_updated": [],
  "alerts_resolved": [],
  "active_alerts_count": 1
}
```

---

### 8. Acknowledge Alert
`PATCH /api/alerts/{alert_id}/acknowledge`

Transitions an `active` alert to `acknowledged`.

#### Path Parameters
- `alert_id` (string, required): The alert ID.

#### Success Response
**Status Code**: `200 OK`
```json
{
  "id": "alert-c4ca4238a0b9",
  "title": "Critical Disk Space Usage",
  "description": "Disk space on / has reached 97.9% (critical threshold: 90.0%)",
  "severity": "critical",
  "source": "system_disk",
  "status": "acknowledged",
  "created_at": "2026-11-17T03:45:00Z",
  "updated_at": "2026-11-17T03:56:00Z",
  "acknowledged_at": "2026-11-17T03:56:00.000000Z",
  "resolved_at": null
}
```

#### Error Responses
- `404 Not Found`: Alert does not exist.
- `400 Bad Request`: If the alert is already resolved:
```json
{
  "detail": "Cannot acknowledge an alert that is already resolved"
}
```

---

### 9. Resolve Alert
`PATCH /api/alerts/{alert_id}/resolve`

Transitions an `active` or `acknowledged` alert to `resolved`.

#### Path Parameters
- `alert_id` (string, required): The alert ID.

#### Success Response
**Status Code**: `200 OK`
```json
{
  "id": "alert-c4ca4238a0b9",
  "title": "Critical Disk Space Usage",
  "description": "Disk space on / has reached 97.9% (critical threshold: 90.0%)",
  "severity": "critical",
  "source": "system_disk",
  "status": "resolved",
  "created_at": "2026-11-17T03:45:00Z",
  "updated_at": "2026-11-17T03:58:00Z",
  "acknowledged_at": "2026-11-17T03:56:00.000000Z",
  "resolved_at": "2026-11-17T03:58:00.000000Z"
}
```

#### Error Response
- `404 Not Found`: Alert does not exist.
