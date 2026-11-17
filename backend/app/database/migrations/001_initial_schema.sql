-- CloudSentinel Initial Database Schema Migration
-- Compatible with PostgreSQL (Neon) and SQLite

CREATE TABLE IF NOT EXISTS security_events (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    severity TEXT NOT NULL,
    category TEXT NOT NULL,
    source_ip TEXT NOT NULL,
    target_user TEXT NOT NULL,
    service TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 1,
    description TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sec_events_timestamp ON security_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sec_events_category ON security_events(category);
CREATE INDEX IF NOT EXISTS idx_sec_events_severity ON security_events(severity);
CREATE INDEX IF NOT EXISTS idx_sec_events_source_ip ON security_events(source_ip);

CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    severity TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    acknowledged_at TEXT,
    resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    hostname TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    os TEXT NOT NULL,
    kernel TEXT NOT NULL,
    arch TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
    last_seen TEXT NOT NULL,
    last_telemetry TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen DESC);

CREATE TABLE IF NOT EXISTS telemetry_history (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    cpu_percent REAL NOT NULL,
    memory_percent REAL NOT NULL,
    disk_percent REAL NOT NULL,
    recorded_at TEXT NOT NULL,
    raw_metrics TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_device_id ON telemetry_history(device_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_recorded_at ON telemetry_history(recorded_at DESC);
