import logging
import os
import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Generator, List, Optional, Tuple, Union

logger = logging.getLogger(__name__)

DEFAULT_DB_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "data", "cloudsentinel.db")
)

# Global connection pool for PostgreSQL
_PG_POOL: Optional[Any] = None

try:
    import psycopg2
    import psycopg2.extras
    import psycopg2.pool
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False


def get_database_url() -> Optional[str]:
    """Return the configured DATABASE_URL environment variable if set."""
    url = os.getenv("DATABASE_URL")
    if not url:
        return None
    url = url.strip()
    # Normalize postgres:// to postgresql:// for compatibility with psycopg2
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return url


def get_db_type() -> str:
    """Return 'postgres' if DATABASE_URL is set for PostgreSQL, else 'sqlite'."""
    url = get_database_url()
    if url and url.startswith("postgresql://"):
        return "postgres"
    return "sqlite"


def get_db_path() -> str:
    """Return the configured path to the SQLite database file."""
    return os.getenv("SQLITE_DB_PATH", DEFAULT_DB_PATH)


def ensure_db_directory(db_path: Optional[str] = None) -> None:
    """Ensure the directory for the SQLite database exists."""
    path_str = db_path or get_db_path()
    parent_dir = Path(path_str).parent
    parent_dir.mkdir(parents=True, exist_ok=True)


class UnifiedRow(dict):
    """
    Row wrapper compatible with both dict access (row['col']) and integer indexing (row[0]),
    providing parity between sqlite3.Row and PostgreSQL result sets.
    """
    def __init__(self, keys: List[str], values: Union[List[Any], Tuple[Any, ...]]):
        super().__init__()
        self._keys = keys
        self._values = list(values)
        for k, v in zip(self._keys, self._values):
            self[k] = v

    def __getitem__(self, item: Union[str, int]) -> Any:
        if isinstance(item, int):
            return self._values[item]
        return super().__getitem__(item)


def translate_sql_for_postgres(sql: str) -> str:
    """
    Translate SQLite-compatible SQL into PostgreSQL syntax:
    1. Replaces ? with %s placeholders.
    2. Replaces INSERT OR IGNORE INTO <table> (<cols>) VALUES (...)
       with INSERT INTO <table> (<cols>) VALUES (...) ON CONFLICT (id) DO NOTHING.
    """
    translated = sql.replace("?", "%s")
    if "INSERT OR IGNORE INTO" in translated:
        translated = translated.replace("INSERT OR IGNORE INTO", "INSERT INTO")
        if "ON CONFLICT" not in translated:
            cleaned = translated.rstrip().rstrip(";")
            translated = f"{cleaned} ON CONFLICT (id) DO NOTHING;"
    return translated


class PostgresCursorWrapper:
    """Wraps a psycopg2 cursor to return UnifiedRow instances and expose rowcount."""
    def __init__(self, cursor: Any):
        self._cursor = cursor

    @property
    def rowcount(self) -> int:
        return self._cursor.rowcount

    def fetchone(self) -> Optional[UnifiedRow]:
        row = self._cursor.fetchone()
        if row is None:
            return None
        keys = [d[0] for d in self._cursor.description]
        return UnifiedRow(keys, row)

    def fetchall(self) -> List[UnifiedRow]:
        rows = self._cursor.fetchall()
        if not rows:
            return []
        keys = [d[0] for d in self._cursor.description]
        return [UnifiedRow(keys, r) for r in rows]

    def close(self) -> None:
        try:
            self._cursor.close()
        except Exception:
            pass


class PostgresConnectionWrapper:
    """
    Wraps a pooled psycopg2 connection to support:
    - Transaction management via `with conn:`
    - Query execution via `conn.execute(sql, params)`
    - Script execution via `conn.executescript(script)`
    """
    def __init__(self, raw_conn: Any):
        self._raw_conn = raw_conn
        self._active_cursor: Optional[Any] = None

    def __enter__(self) -> "PostgresConnectionWrapper":
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> bool:
        if exc_type is not None:
            self._raw_conn.rollback()
        else:
            self._raw_conn.commit()
        if self._active_cursor:
            try:
                self._active_cursor.close()
            except Exception:
                pass
            self._active_cursor = None
        return False

    def execute(self, query: str, params: Optional[Union[List[Any], Tuple[Any, ...]]] = None) -> PostgresCursorWrapper:
        sql = translate_sql_for_postgres(query)
        cursor = self._raw_conn.cursor()
        self._active_cursor = cursor
        if params is not None:
            p_tuple = tuple(params) if isinstance(params, list) else params
            cursor.execute(sql, p_tuple)
        else:
            cursor.execute(sql)
        return PostgresCursorWrapper(cursor)

    def executescript(self, sql_script: str) -> None:
        cursor = self._raw_conn.cursor()
        try:
            cursor.execute(sql_script)
            self._raw_conn.commit()
        finally:
            cursor.close()


def _get_pg_pool() -> Any:
    """Initialize or return the thread-safe connection pool for PostgreSQL."""
    global _PG_POOL
    if _PG_POOL is None or _PG_POOL.closed:
        if not HAS_PSYCOPG2:
            raise RuntimeError("psycopg2 is not installed. Please install psycopg2-binary for PostgreSQL support.")
        db_url = get_database_url()
        if not db_url:
            raise ValueError("DATABASE_URL is not set.")
        logger.info("Initializing PostgreSQL connection pool...")
        # Neon supports min 1, max 10 for free tier connection limits
        _PG_POOL = psycopg2.pool.ThreadedConnectionPool(minconn=1, maxconn=10, dsn=db_url)
    return _PG_POOL


def close_pg_pool() -> None:
    """Close all PostgreSQL pool connections safely on application shutdown."""
    global _PG_POOL
    if _PG_POOL is not None and not _PG_POOL.closed:
        logger.info("Closing PostgreSQL connection pool...")
        _PG_POOL.closeall()
        _PG_POOL = None


@contextmanager
def get_db_connection(db_path: Optional[str] = None) -> Generator[Any, None, None]:
    """
    Provide a transactional database connection.
    - If db_path is explicitly provided, always connects to that SQLite database.
    - If db_path is None and DATABASE_URL is set, connects to PostgreSQL via connection pool.
    - Otherwise connects to default SQLite database.
    """
    # Explicit SQLite path requested (e.g. unit tests or local override)
    if db_path is not None:
        ensure_db_directory(db_path)
        conn = sqlite3.connect(db_path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA foreign_keys=ON;")
            yield conn
        finally:
            conn.close()
        return

    # Check for PostgreSQL configuration
    if get_db_type() == "postgres":
        pool = _get_pg_pool()
        raw_conn = pool.getconn()
        try:
            # Check for stale connection resulting from Neon serverless auto-suspend
            if raw_conn.closed != 0:
                raise psycopg2.OperationalError("Connection is closed")
            with raw_conn.cursor() as cur:
                cur.execute("SELECT 1;")
        except Exception:
            logger.warning("Stale PostgreSQL connection detected (Neon auto-suspend resume). Refreshing connection...")
            try:
                pool.putconn(raw_conn, close=True)
            except Exception:
                pass
            raw_conn = pool.getconn()

        wrapper = PostgresConnectionWrapper(raw_conn)
        try:
            yield wrapper
        finally:
            if raw_conn.closed == 0:
                pool.putconn(raw_conn)
            else:
                try:
                    pool.putconn(raw_conn, close=True)
                except Exception:
                    pass
        return

    # Default SQLite fallback
    path = get_db_path()
    ensure_db_directory(path)
    conn = sqlite3.connect(path, timeout=10.0)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        yield conn
    finally:
        conn.close()


def init_db(db_path: Optional[str] = None) -> None:
    """
    Initialize database schema, tables, and indexes.
    Supports both SQLite and PostgreSQL.
    """
    # Explicit SQLite path (unit tests)
    if db_path is not None or get_db_type() == "sqlite":
        target = db_path or get_db_path()
        logger.info("Initializing SQLite database at: %s", target)
        with get_db_connection(db_path) as conn:
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

                    CREATE INDEX IF NOT EXISTS idx_devices_status
                        ON devices(status);
                    CREATE INDEX IF NOT EXISTS idx_devices_last_seen
                        ON devices(last_seen DESC);

                    CREATE TABLE IF NOT EXISTS telemetry_history (
                        id TEXT PRIMARY KEY,
                        device_id TEXT NOT NULL,
                        cpu_percent REAL NOT NULL,
                        memory_percent REAL NOT NULL,
                        disk_percent REAL NOT NULL,
                        recorded_at TEXT NOT NULL,
                        raw_metrics TEXT NOT NULL
                    );

                    CREATE INDEX IF NOT EXISTS idx_telemetry_device_id
                        ON telemetry_history(device_id);
                    CREATE INDEX IF NOT EXISTS idx_telemetry_recorded_at
                        ON telemetry_history(recorded_at DESC);
                """)
        logger.info("SQLite database schema initialized successfully.")
        return

    # PostgreSQL initialization
    logger.info("Initializing PostgreSQL (Neon) database schema...")
    with get_db_connection() as conn:
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
            """)
    logger.info("PostgreSQL database schema initialized successfully.")
