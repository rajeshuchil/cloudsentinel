from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Query
from backend.app.collectors.log_collector import read_recent_log_lines
from backend.app.security.ssh_analyzer import analyze_log_lines

router = APIRouter(prefix="/api/security", tags=["Security"])


@router.get("/events", summary="Get Security Events", response_model=Dict[str, Any])
def get_security_events(
    limit: int = Query(default=50, ge=1, le=500, description="Maximum number of events to return"),
    max_log_lines: int = Query(default=1000, ge=50, le=10000, description="Number of recent log lines to inspect"),
    repeated_threshold: int = Query(default=5, ge=2, le=50, description="Threshold of failed attempts to trigger repeated attempt event"),
    window_minutes: int = Query(default=5, ge=1, le=60, description="Time window in minutes for repeated attempts correlation"),
) -> Dict[str, Any]:
    """
    Retrieve real authentication security events parsed from the host Linux authentication log (/var/log/auth.log).
    Identifies failed SSH logins, invalid usernames, sudo authentication failures, and correlated repeated attempts.
    """
    lines, log_info = read_recent_log_lines(max_lines=max_log_lines)

    if log_info.get("status") != "available":
        return {
            "status": log_info.get("status", "unavailable"),
            "log_source": log_info.get("source"),
            "error": log_info.get("error"),
            "total_events": 0,
            "events": [],
        }

    events: List[Dict[str, Any]] = analyze_log_lines(
        lines,
        repeated_threshold=repeated_threshold,
        window_seconds=window_minutes * 60,
    )

    limited_events = events[:limit]

    return {
        "status": "success",
        "log_source": log_info.get("source"),
        "total_events": len(events),
        "returned_events": len(limited_events),
        "events": limited_events,
    }
