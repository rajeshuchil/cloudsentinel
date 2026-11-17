import logging
import os
from typing import Optional
from fastapi import Header, HTTPException, status

logger = logging.getLogger(__name__)


def get_agent_api_key() -> str:
    """Read expected agent authentication token from environment."""
    key = os.getenv("AGENT_API_KEY")
    if not key:
        return "cloudsentinel-insecure-dev-token"
    return key


def verify_agent_token(
    x_agent_token: Optional[str] = Header(None, alias="X-Agent-Token"),
    authorization: Optional[str] = Header(None),
) -> str:
    """
    Validate agent authentication token passed via X-Agent-Token or Authorization Bearer header.
    Rejects unauthorized agents with HTTP 401.
    """
    expected_key = get_agent_api_key()

    token = x_agent_token
    if not token and authorization and isinstance(authorization, str):
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1]

    if not token or token != expected_key:
        logger.warning("Rejected unauthorized agent request (invalid or missing token)")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing agent authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return token


def verify_dashboard_access(
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None),
) -> bool:
    """
    Validate dashboard API access key.
    If DASHBOARD_API_KEY is configured in the environment, protects system metrics,
    security events, operational alerts, and device info against unauthorized discovery/scraping.
    If DASHBOARD_API_KEY is not set (e.g. local development), permits requests.
    """
    required_key = os.getenv("DASHBOARD_API_KEY")
    if not required_key:
        # Development mode without dashboard key configured
        return True

    token = x_api_key
    if not token and authorization and isinstance(authorization, str):
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1]

    if not token or token != required_key:
        logger.warning("Rejected unauthorized dashboard request (missing or invalid X-API-Key)")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing dashboard API authentication key",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return True


def check_dashboard_access(
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None),
) -> bool:
    """
    Check whether dashboard access key is valid without throwing HTTPException.
    Returns True if authenticated as administrator, False if anonymous or invalid.
    Allows endpoints to serve public/sanitized metrics to anonymous visitors while
    providing administrative visibility to authenticated users.
    """
    required_key = os.getenv("DASHBOARD_API_KEY")
    if not required_key:
        # Development mode without key configured -> full access
        return True

    token = x_api_key
    if not token and authorization and isinstance(authorization, str):
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1]

    return bool(token and token == required_key)

