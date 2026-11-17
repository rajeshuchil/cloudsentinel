import threading
import time
from collections import defaultdict
from typing import Dict, List, Optional, Tuple
from fastapi import HTTPException, Request, status

# In-memory sliding window rate limiter
# Tracks request timestamps per client IP. Thread-safe.
_RATE_LIMIT_LOCK = threading.Lock()
_IP_REQUEST_TIMESTAMPS: Dict[str, List[float]] = defaultdict(list)

# Default: 60 requests per minute for unauthenticated public requests
DEFAULT_WINDOW_SECONDS = 60
DEFAULT_MAX_REQUESTS = 60


def check_rate_limit(
    request: Request,
    is_admin: bool = False,
    max_requests: int = DEFAULT_MAX_REQUESTS,
    window_seconds: int = DEFAULT_WINDOW_SECONDS,
) -> None:
    """
    Enforce rate limits on public read-only endpoints.
    - If is_admin is True (authenticated with DASHBOARD_API_KEY), rate limit is bypassed.
    - Otherwise, allows up to `max_requests` per `window_seconds` per client IP.
    - Throws HTTP 429 Too Many Requests if the limit is exceeded.
    """
    if is_admin:
        return

    # Extract client IP (checking X-Forwarded-For if behind reverse proxy / Cloud Run)
    client_ip = "127.0.0.1"
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        client_ip = forwarded.split(",")[0].strip()
    elif request.client and request.client.host:
        client_ip = request.client.host

    now = time.time()
    cutoff = now - window_seconds

    with _RATE_LIMIT_LOCK:
        timestamps = _IP_REQUEST_TIMESTAMPS[client_ip]
        # Remove timestamps outside the sliding window
        valid_timestamps = [ts for ts in timestamps if ts > cutoff]
        if len(valid_timestamps) >= max_requests:
            retry_after = int(valid_timestamps[0] - cutoff) + 1
            _IP_REQUEST_TIMESTAMPS[client_ip] = valid_timestamps
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded. Please slow down your requests.",
                headers={"Retry-After": str(max(1, retry_after))},
            )
        valid_timestamps.append(now)
        _IP_REQUEST_TIMESTAMPS[client_ip] = valid_timestamps


def mask_ip_address(ip: Optional[str]) -> str:
    """
    Sanitize sensitive IP addresses for public responses.
    - Loopback 127.0.0.1 -> 127.0.0.1
    - IPv4 -> replaces last octet with '***' (e.g., 192.168.1.***)
    - IPv6 or other -> masks last segments
    """
    if not ip or not isinstance(ip, str):
        return "Protected"
    ip = ip.strip()
    if ip == "127.0.0.1" or ip == "::1":
        return ip
    if "." in ip:
        parts = ip.split(".")
        if len(parts) == 4:
            return f"{parts[0]}.{parts[1]}.{parts[2]}.***"
    return "Protected"
