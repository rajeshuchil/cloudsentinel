from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.app.api.auth import verify_dashboard_access
from backend.app.collectors.log_collector import read_recent_log_lines
from backend.app.database.repositories import (
    count_security_events,
    get_security_event_by_id,
    get_security_events as fetch_stored_events,
    insert_security_events,
)
from backend.app.security.ssh_analyzer import analyze_log_lines

router = APIRouter(prefix="/api/security", tags=["Security"], dependencies=[Depends(verify_dashboard_access)])


@router.get("/events", summary="Get Security Events", response_model=Dict[str, Any])
def get_security_events(
    limit: int = Query(default=50, ge=1, le=500, description="Maximum number of events to return"),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    category: Optional[str] = Query(default=None, description="Filter by event category"),
    severity: Optional[str] = Query(default=None, description="Filter by severity level"),
    max_log_lines: int = Query(default=1000, ge=50, le=10000, description="Number of recent log lines to inspect"),
    repeated_threshold: int = Query(default=5, ge=2, le=50, description="Threshold of failed attempts for repeated burst alert"),
    window_minutes: int = Query(default=5, ge=1, le=60, description="Time window in minutes for repeated attempts correlation"),
) -> Dict[str, Any]:
    """
    Retrieve security events from persistent SQLite storage.
    Automatically parses the latest authentication log entries, persists newly discovered events,
    and returns historical stored records sorted newest first.
    """
    newly_ingested = 0
    lines, log_info = read_recent_log_lines(max_lines=max_log_lines)

    if log_info.get("status") == "available":
        analyzed_events: List[Dict[str, Any]] = analyze_log_lines(
            lines,
            repeated_threshold=repeated_threshold,
            window_seconds=window_minutes * 60,
        )
        if analyzed_events:
            newly_ingested = insert_security_events(analyzed_events)

    # Retrieve persistent events from SQLite
    stored_events = fetch_stored_events(
        limit=limit,
        offset=offset,
        category=category,
        severity=severity,
    )
    total_stored = count_security_events(category=category, severity=severity)

    status_str = "success" if log_info.get("status") == "available" else "degraded"

    return {
        "status": status_str,
        "log_source": log_info.get("source"),
        "error": log_info.get("error"),
        "newly_ingested": newly_ingested,
        "total_events": total_stored,
        "returned_events": len(stored_events),
        "events": stored_events,
    }


@router.get("/events/{event_id}", summary="Get Security Event by ID", response_model=Dict[str, Any])
def get_security_event(event_id: str) -> Dict[str, Any]:
    """
    Retrieve a specific security event by its deterministic ID.
    """
    event = get_security_event_by_id(event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Security event '{event_id}' not found",
        )
    return event
