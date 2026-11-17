import os
import platform
import uuid
from pathlib import Path


def _load_env_file(env_path: Path) -> None:
    """Lightweight .env parser that does not require python-dotenv."""
    if not env_path.is_file():
        return
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip("'\"")
                if k and k not in os.environ:
                    os.environ[k] = v
    except Exception:
        pass


# Automatically load .env from agent directory if present
_agent_dir = Path(__file__).resolve().parent
_load_env_file(_agent_dir / ".env")


def get_stable_device_id() -> str:
    """
    Retrieve or generate a stable, persistent device identifier:
    1. AGENT_DEVICE_ID environment variable.
    2. Linux /etc/machine-id.
    3. Persisted ~/.cloudsentinel-device-id.
    4. Fallback generated UUID.
    """
    env_id = os.getenv("AGENT_DEVICE_ID")
    if env_id:
        return env_id.strip()

    # Read standard Linux machine-id
    for machine_id_path in ["/etc/machine-id", "/var/lib/dbus/machine-id"]:
        try:
            if os.path.exists(machine_id_path):
                with open(machine_id_path, "r") as f:
                    content = f.read().strip()
                    if content:
                        return f"ubuntu-{content[:12]}"
        except Exception:
            pass

    # Read or create persistent fallback in user home
    fallback_file = Path.home() / ".cloudsentinel-device-id"
    try:
        if fallback_file.exists():
            return fallback_file.read_text().strip()
        new_id = f"ubuntu-{uuid.uuid4().hex[:12]}"
        fallback_file.write_text(new_id)
        return new_id
    except Exception:
        return f"ubuntu-{platform.node()}"


# Configuration Variables
BACKEND_URL: str = os.getenv("BACKEND_URL", "http://127.0.0.1:8000").rstrip("/")
AGENT_TOKEN: str = os.getenv("AGENT_TOKEN", "cloudsentinel-insecure-dev-token")
DEVICE_ID: str = get_stable_device_id()
TELEMETRY_INTERVAL: float = float(os.getenv("TELEMETRY_INTERVAL", "30.0"))
AUTH_LOG_PATH: str = os.getenv("AUTH_LOG_PATH", "/var/log/auth.log")
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
