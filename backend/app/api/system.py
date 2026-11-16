from typing import Any, Dict
from fastapi import APIRouter
from backend.app.collectors.system_collector import get_all_system_metrics

router = APIRouter(prefix="/api/system", tags=["System"])


@router.get("", summary="Get System Metrics", response_model=Dict[str, Any])
def read_system_metrics() -> Dict[str, Any]:
    """
    Retrieve real-time Linux host telemetry including CPU, memory, disk, network, and system metadata.
    """
    return get_all_system_metrics()
