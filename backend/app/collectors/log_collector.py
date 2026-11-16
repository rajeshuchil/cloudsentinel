import collections
import logging
import os
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

DEFAULT_AUTH_LOG_PATH = "/var/log/auth.log"


def get_auth_log_path() -> str:
    """Return the configured path to the authentication log."""
    return os.getenv("AUTH_LOG_PATH", DEFAULT_AUTH_LOG_PATH)


def check_log_access(log_path: Optional[str] = None) -> Tuple[bool, Optional[str]]:
    """
    Check if the authentication log exists and is readable.
    Returns (is_accessible, error_message).
    """
    path = log_path or get_auth_log_path()
    if not os.path.exists(path):
        return False, f"Authentication log not found at '{path}'"
    if not os.access(path, os.R_OK):
        return False, f"Permission denied reading '{path}' (read access required)"
    return True, None


def read_recent_log_lines(
    log_path: Optional[str] = None, max_lines: int = 1000
) -> Tuple[List[str], Dict[str, Optional[str]]]:
    """
    Read the last `max_lines` lines from the authentication log in read-only mode.
    Handles missing files and permission errors gracefully without throwing unhandled exceptions.
    """
    path = log_path or get_auth_log_path()
    accessible, err_msg = check_log_access(path)

    if not accessible:
        logger.warning("Auth log inaccessible: %s", err_msg)
        return [], {
            "status": "unavailable",
            "source": path,
            "error": err_msg,
        }

    try:
        # Read the tail of the file safely using deque to limit memory footprint
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            lines = list(collections.deque(f, maxlen=max_lines))

        return lines, {
            "status": "available",
            "source": path,
            "error": None,
        }
    except Exception as e:
        logger.error("Error reading authentication log '%s': %s", path, e)
        return [], {
            "status": "error",
            "source": path,
            "error": f"Failed reading log: {str(e)}",
        }
