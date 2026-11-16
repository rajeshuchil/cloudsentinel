import logging
import os
import platform
import socket
import time
from typing import Any, Dict, List, Optional

import psutil

logger = logging.getLogger(__name__)


def _family_to_name(family: int) -> str:
    """Map socket address family integer to human-readable string."""
    if family == socket.AF_INET:
        return "IPv4"
    if family == socket.AF_INET6:
        return "IPv6"
    if hasattr(socket, "AF_PACKET") and family == socket.AF_PACKET:
        return "MAC"
    return f"family_{family}"


def collect_cpu_metrics(interval: Optional[float] = 0.1) -> Dict[str, Any]:
    """
    Collect current CPU utilization, logical core count, and system load averages.
    """
    try:
        # Measures CPU utilization over the provided sample interval
        usage_percent = psutil.cpu_percent(interval=interval)
        logical_cores = psutil.cpu_count(logical=True)

        load_averages: Optional[Dict[str, float]] = None
        if hasattr(os, "getloadavg"):
            try:
                l1, l5, l15 = os.getloadavg()
                load_averages = {
                    "1m": round(l1, 2),
                    "5m": round(l5, 2),
                    "15m": round(l15, 2),
                }
            except OSError as e:
                logger.warning("Failed to retrieve system load averages: %s", e)

        return {
            "usage_percent": usage_percent,
            "logical_cores": logical_cores,
            "load_average": load_averages,
        }
    except Exception as e:
        logger.error("Error collecting CPU metrics: %s", e)
        return {
            "error": "Failed to collect CPU metrics",
            "detail": str(e),
            "usage_percent": None,
            "logical_cores": None,
            "load_average": None,
        }


def collect_memory_metrics() -> Dict[str, Any]:
    """
    Collect virtual RAM memory utilization statistics.
    """
    try:
        vm = psutil.virtual_memory()
        return {
            "total_bytes": vm.total,
            "used_bytes": vm.used,
            "available_bytes": vm.available,
            "usage_percent": vm.percent,
        }
    except Exception as e:
        logger.error("Error collecting memory metrics: %s", e)
        return {
            "error": "Failed to collect memory metrics",
            "detail": str(e),
            "total_bytes": None,
            "used_bytes": None,
            "available_bytes": None,
            "usage_percent": None,
        }


def collect_disk_metrics(path: str = "/") -> Dict[str, Any]:
    """
    Collect disk space usage for the root filesystem.
    """
    try:
        usage = psutil.disk_usage(path)
        return {
            "mount_point": path,
            "total_bytes": usage.total,
            "used_bytes": usage.used,
            "free_bytes": usage.free,
            "usage_percent": usage.percent,
        }
    except Exception as e:
        logger.error("Error collecting disk metrics for path '%s': %s", path, e)
        return {
            "error": f"Failed to collect disk metrics for {path}",
            "detail": str(e),
            "mount_point": path,
            "total_bytes": None,
            "used_bytes": None,
            "free_bytes": None,
            "usage_percent": None,
        }


def collect_system_info() -> Dict[str, Any]:
    """
    Collect host metadata including OS distribution, kernel, architecture, and uptime.
    """
    try:
        hostname = platform.node()
        system_os = platform.system()
        kernel_version = platform.release()
        architecture = platform.machine()

        # Retrieve detailed OS release information if available
        os_release = platform.version()
        if hasattr(platform, "freedesktop_os_release"):
            try:
                distro_info = platform.freedesktop_os_release()
                os_release = distro_info.get("PRETTY_NAME", os_release)
            except Exception:
                pass

        boot_time = psutil.boot_time()
        uptime_seconds = round(time.time() - boot_time, 2)

        return {
            "hostname": hostname,
            "os": system_os,
            "os_release": os_release,
            "kernel_version": kernel_version,
            "architecture": architecture,
            "uptime_seconds": uptime_seconds,
        }
    except Exception as e:
        logger.error("Error collecting system metadata: %s", e)
        return {
            "error": "Failed to collect system info",
            "detail": str(e),
            "hostname": None,
            "os": None,
            "os_release": None,
            "kernel_version": None,
            "architecture": None,
            "uptime_seconds": None,
        }


def collect_network_metrics() -> Dict[str, Any]:
    """
    Collect active network interfaces, IP addresses, and operational statuses.
    """
    try:
        stats = psutil.net_if_stats()
        addrs = psutil.net_if_addrs()

        interfaces: List[Dict[str, Any]] = []

        all_names = sorted(set(stats.keys()) | set(addrs.keys()))
        for name in all_names:
            if_stat = stats.get(name)
            is_up = if_stat.isup if if_stat else None
            speed_mbps = if_stat.speed if if_stat else None

            interface_addresses: List[Dict[str, Any]] = []
            for addr in addrs.get(name, []):
                interface_addresses.append({
                    "family": _family_to_name(addr.family),
                    "address": addr.address,
                    "netmask": addr.netmask,
                    "broadcast": addr.broadcast,
                })

            interfaces.append({
                "name": name,
                "is_up": is_up,
                "speed_mbps": speed_mbps,
                "addresses": interface_addresses,
            })

        return {
            "interfaces": interfaces,
        }
    except Exception as e:
        logger.error("Error collecting network metrics: %s", e)
        return {
            "error": "Failed to collect network metrics",
            "detail": str(e),
            "interfaces": [],
        }


def get_all_system_metrics() -> Dict[str, Any]:
    """
    Aggregate all host metrics into a structured dictionary.
    Each section is isolated so a failure in one does not break others.
    """
    return {
        "system": collect_system_info(),
        "cpu": collect_cpu_metrics(),
        "memory": collect_memory_metrics(),
        "disk": collect_disk_metrics("/"),
        "network": collect_network_metrics(),
    }
