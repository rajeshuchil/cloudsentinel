from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from backend.app.database.repositories import (
    acknowledge_alert as repo_acknowledge,
    create_alert as repo_create,
    get_alert_by_id,
    get_alerts as repo_get_alerts,
    resolve_alert as repo_resolve,
)

router = APIRouter(prefix="/api/alerts", tags=["Alerts"])


class AlertCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200, description="Short summary of the alert")
    description: str = Field(..., min_length=1, description="Detailed alert description")
    severity: str = Field(..., description="Alert severity: info, warning, critical")
    source: str = Field(default="system", description="Alert source component (e.g. system, ssh, auth)")


@router.get("", summary="List Alerts", response_model=Dict[str, Any])
def list_alerts(
    limit: int = Query(default=50, ge=1, le=500, description="Maximum number of alerts to return"),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    status_filter: Optional[str] = Query(default=None, alias="status", description="Filter by status (active, acknowledged, resolved)"),
    severity: Optional[str] = Query(default=None, description="Filter by severity level"),
) -> Dict[str, Any]:
    """
    Retrieve operational and security alerts ordered by creation time descending.
    """
    alerts = repo_get_alerts(
        limit=limit,
        offset=offset,
        status=status_filter,
        severity=severity,
    )
    return {
        "status": "success",
        "total_returned": len(alerts),
        "alerts": alerts,
    }


@router.post("", summary="Create Alert", status_code=status.HTTP_201_CREATED, response_model=Dict[str, Any])
def create_new_alert(payload: AlertCreate) -> Dict[str, Any]:
    """
    Create a new alert in persistent storage.
    """
    if payload.severity not in ("info", "warning", "critical"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid severity '{payload.severity}'. Allowed values: info, warning, critical",
        )

    alert = repo_create({
        "title": payload.title,
        "description": payload.description,
        "severity": payload.severity,
        "source": payload.source,
        "status": "active",
    })
    return alert


@router.get("/{alert_id}", summary="Get Alert by ID", response_model=Dict[str, Any])
def get_single_alert(alert_id: str) -> Dict[str, Any]:
    """
    Retrieve a single alert by its unique identifier.
    """
    alert = get_alert_by_id(alert_id)
    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert with ID '{alert_id}' was not found",
        )
    return alert


@router.patch("/{alert_id}/acknowledge", summary="Acknowledge Alert", response_model=Dict[str, Any])
def acknowledge_single_alert(alert_id: str) -> Dict[str, Any]:
    """
    Transition an active alert to 'acknowledged'.
    Returns 404 if not found, or 400 if the alert is already resolved.
    """
    try:
        updated = repo_acknowledge(alert_id)
        if not updated:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Alert with ID '{alert_id}' was not found",
            )
        return updated
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.patch("/{alert_id}/resolve", summary="Resolve Alert", response_model=Dict[str, Any])
def resolve_single_alert(alert_id: str) -> Dict[str, Any]:
    """
    Transition an active or acknowledged alert to 'resolved'.
    Returns 404 if not found.
    """
    updated = repo_resolve(alert_id)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert with ID '{alert_id}' was not found",
        )
    return updated
