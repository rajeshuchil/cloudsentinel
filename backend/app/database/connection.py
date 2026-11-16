import logging
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Generator, Optional

logger = logging.getLogger(__name__)

DEFAULT_DB_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "data", "cloudsentinel.db")
)


def get_db_path() -> str:
    """Return the configured path to the SQLite database file."""
    return os.getenv("SQLITE_DB_PATH", DEFAULT_DB_PATH)


def ensure_db_directory(db_path: Optional[str] = None) -> None:
    """Ensure the directory for the SQLite database exists."""
    path_str = db_path or get_db_path()
    parent_dir = Path(path_str).parent
    parent_dir.mkdir(parents=True, exist_ok=True)


@contextmanager
def get_db_connection(db_path: Optional[str] = None) -> Generator[sqlite3.Connection, None, None]:
    """
    Provide a transactional SQLite database connection with row factory configured.
    Ensures WAL mode and foreign key constraints are enabled.
    """
    path = db_path or get_db_path()
    ensure_db_directory(path)

    conn = sqlite3.connect(path, timeout=10.0)
    conn.row_factory = sqlite3.Row

    # Performance and constraint pragmas
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        yield conn
    finally:
        conn.close()


def init_db(db_path: Optional[str] = None) -> None:
    """
    Initialize SQLite database schema and indexes if they do not exist.
    """
    path = db_path or get_db_path()
    logger.info("Initializing SQLite database at: %s", path)

    with get_db_connection(path) as conn:
        with conn:
            conn.executescript("""
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

                CREATE INDEX IF NOT EXISTS idx_sec_events_timestamp
                    ON security_events(timestamp DESC);

                CREATE INDEX IF NOT EXISTS idx_sec_events_category
                    ON security_events(category);

                CREATE INDEX IF NOT EXISTS idx_sec_events_severity
                    ON security_events(severity);

                CREATE INDEX IF NOT EXISTS idx_sec_events_source_ip
                    ON security_events(source_ip);

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

                CREATE INDEX IF NOT EXISTS idx_alerts_status
                    ON alerts(status);

                CREATE INDEX IF NOT EXISTS idx_alerts_created_at
                    ON alerts(created_at DESC);

                CREATE INDEX IF NOT EXISTS idx_alerts_severity
                    ON alerts(severity);
            """)

    logger.info("Database schema initialized successfully.")
