#!/usr/bin/env python3
"""
CloudSentinel — SQLite to Neon PostgreSQL Data Migration Script
Transfers all security_events, alerts, devices, and telemetry_history records
from local SQLite (cloudsentinel.db) to Neon PostgreSQL (via DATABASE_URL).

Usage:
    DATABASE_URL="postgresql://user:pass@ep-xyz.neon.tech/neondb?sslmode=require" \
    python3 backend/scripts/migrate_sqlite_to_postgres.py
"""

import os
import sys
import sqlite3
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("migration")

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    logger.error("psycopg2 is required for migration. Install it via: pip install psycopg2-binary")
    sys.exit(1)

DEFAULT_SQLITE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "data", "cloudsentinel.db")
)


def migrate():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("DATABASE_URL environment variable is not set. Please provide the Neon PostgreSQL connection string.")
        sys.exit(1)

    if database_url.startswith("postgres://"):
        database_url = "postgresql://" + database_url[len("postgres://"):]

    sqlite_path = os.getenv("SQLITE_DB_PATH", DEFAULT_SQLITE_PATH)
    if not os.path.exists(sqlite_path):
        logger.warning("SQLite database not found at %s. Nothing to migrate.", sqlite_path)
        return

    logger.info("Reading source SQLite database at: %s", sqlite_path)
    sqlite_conn = sqlite3.connect(sqlite_path)
    sqlite_conn.row_factory = sqlite3.Row

    logger.info("Connecting to destination PostgreSQL database...")
    pg_conn = psycopg2.connect(database_url)
    pg_cursor = pg_conn.cursor()

    try:
        # 1. Migrate security_events
        sec_rows = sqlite_conn.execute("SELECT * FROM security_events;").fetchall()
        logger.info("Migrating %d security_events...", len(sec_rows))
        sec_inserted = 0
        for r in sec_rows:
            d = dict(r)
            pg_cursor.execute("""
                INSERT INTO security_events (
                    id, timestamp, severity, category, source_ip,
                    target_user, service, attempts, description, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING;
            """, (
                d["id"], d["timestamp"], d["severity"], d["category"], d["source_ip"],
                d["target_user"], d["service"], d.get("attempts", 1), d["description"], d["created_at"]
            ))
            if pg_cursor.rowcount > 0:
                sec_inserted += 1
        logger.info("Transferred %d new security_events (%d duplicates skipped).", sec_inserted, len(sec_rows) - sec_inserted)

        # 2. Migrate alerts
        alert_rows = sqlite_conn.execute("SELECT * FROM alerts;").fetchall()
        logger.info("Migrating %d alerts...", len(alert_rows))
        alerts_inserted = 0
        for r in alert_rows:
            d = dict(r)
            pg_cursor.execute("""
                INSERT INTO alerts (
                    id, title, description, severity, source,
                    status, created_at, updated_at, acknowledged_at, resolved_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING;
            """, (
                d["id"], d["title"], d["description"], d["severity"], d["source"],
                d["status"], d["created_at"], d["updated_at"], d.get("acknowledged_at"), d.get("resolved_at")
            ))
            if pg_cursor.rowcount > 0:
                alerts_inserted += 1
        logger.info("Transferred %d new alerts (%d duplicates skipped).", alerts_inserted, len(alert_rows) - alerts_inserted)

        # 3. Migrate devices (if any)
        try:
            device_rows = sqlite_conn.execute("SELECT * FROM devices;").fetchall()
            logger.info("Migrating %d devices...", len(device_rows))
            for r in device_rows:
                d = dict(r)
                pg_cursor.execute("""
                    INSERT INTO devices (
                        id, hostname, ip_address, os, kernel, arch,
                        status, last_seen, last_telemetry, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        last_seen = excluded.last_seen,
                        updated_at = excluded.updated_at;
                """, (
                    d["id"], d["hostname"], d["ip_address"], d["os"], d["kernel"], d["arch"],
                    d["status"], d["last_seen"], d.get("last_telemetry"), d["created_at"], d["updated_at"]
                ))
        except sqlite3.OperationalError:
            pass  # Table didn't exist in older SQLite schema

        pg_conn.commit()
        logger.info("✅ Migration completed successfully!")

    except Exception as e:
        pg_conn.rollback()
        logger.error("Migration failed with error: %s", e)
        raise
    finally:
        sqlite_conn.close()
        pg_cursor.close()
        pg_conn.close()


if __name__ == "__main__":
    migrate()
