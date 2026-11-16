import os

# Centralized Alert Engine Configuration and Thresholds

CPU_WARNING_THRESHOLD: float = float(os.getenv("CPU_WARNING_THRESHOLD", "75.0"))
CPU_CRITICAL_THRESHOLD: float = float(os.getenv("CPU_CRITICAL_THRESHOLD", "90.0"))

MEMORY_WARNING_THRESHOLD: float = float(os.getenv("MEMORY_WARNING_THRESHOLD", "80.0"))
MEMORY_CRITICAL_THRESHOLD: float = float(os.getenv("MEMORY_CRITICAL_THRESHOLD", "92.0"))

DISK_WARNING_THRESHOLD: float = float(os.getenv("DISK_WARNING_THRESHOLD", "75.0"))
DISK_CRITICAL_THRESHOLD: float = float(os.getenv("DISK_CRITICAL_THRESHOLD", "90.0"))

# Security thresholds
SSH_REPEATED_ATTEMPTS_THRESHOLD: int = int(os.getenv("SSH_REPEATED_ATTEMPTS_THRESHOLD", "5"))
SSH_WINDOW_SECONDS: int = int(os.getenv("SSH_WINDOW_SECONDS", "300"))


def get_monitored_disk_path() -> str:
    """
    Determine the filesystem path to monitor.
    1. Respects DISK_MONITOR_PATH environment variable if set.
    2. If '/' is a virtual/sandbox filesystem (<10GB) while the workspace is mounted on the host drive,
       monitors the actual host drive path ('.').
    3. Defaults to '/'.
    """
    configured = os.getenv("DISK_MONITOR_PATH")
    if configured:
        return configured
    try:
        import psutil
        root_usage = psutil.disk_usage("/")
        if root_usage.total < 10 * 1024 * 1024 * 1024:
            cwd_usage = psutil.disk_usage(".")
            if cwd_usage.total > root_usage.total:
                return "."
    except Exception:
        pass
    return "/"
