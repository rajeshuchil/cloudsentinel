#!/usr/bin/env bash
# ==============================================================================
# CloudSentinel Ubuntu Agent Installation Script
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURRENT_USER="$(id -un)"

echo "=== CloudSentinel Ubuntu Monitoring Agent Setup ==="
echo "Agent Directory: ${SCRIPT_DIR}"
echo "Current User:    ${CURRENT_USER}"

# 1. Check Python 3
if ! command -v python3 &>/dev/null; then
    echo "❌ Error: python3 is not installed. Please install Python 3.9+ first."
    exit 1
fi

# 2. Check /var/log/auth.log access and 'adm' group
echo "--> Checking log access..."
if [ -r "/var/log/auth.log" ]; then
    echo "✓ /var/log/auth.log is readable by ${CURRENT_USER}."
else
    echo "⚠️  Note: /var/log/auth.log is not directly readable by ${CURRENT_USER}."
    echo "    On Ubuntu/Debian, log files are readable by members of the 'adm' group."
    echo "    To add your user to 'adm', run:"
    echo "      sudo usermod -aG adm ${CURRENT_USER}"
    echo "    Then log out and back in."
fi

# 3. Create virtual environment
echo "--> Creating Python virtual environment..."
if [ ! -d "${SCRIPT_DIR}/venv" ]; then
    python3 -m venv "${SCRIPT_DIR}/venv"
fi

# 4. Install dependencies
echo "--> Installing agent dependencies..."
"${SCRIPT_DIR}/venv/bin/pip" install --upgrade pip
"${SCRIPT_DIR}/venv/bin/pip" install -r "${SCRIPT_DIR}/requirements.txt"

# 5. Setup configuration
if [ ! -f "${SCRIPT_DIR}/.env" ]; then
    echo "--> Creating .env from .env.example..."
    cp "${SCRIPT_DIR}/.env.example" "${SCRIPT_DIR}/.env"
    echo "✓ Created ${SCRIPT_DIR}/.env. Please configure your BACKEND_URL and AGENT_TOKEN."
else
    echo "✓ Existing .env found."
fi

# 6. Generate systemd unit file
SERVICE_FILE="/tmp/cloudsentinel-agent.service"
sed -e "s|%USER%|${CURRENT_USER}|g" \
    -e "s|%AGENT_DIR%|${SCRIPT_DIR}|g" \
    "${SCRIPT_DIR}/cloudsentinel-agent.service" > "${SERVICE_FILE}"

echo "
=== Agent Setup Complete ==="
echo "To install and start the agent as a background systemd service, run:"
echo "  sudo cp ${SERVICE_FILE} /etc/systemd/system/cloudsentinel-agent.service"
echo "  sudo systemctl daemon-reload"
echo "  sudo systemctl enable --now cloudsentinel-agent.service"
echo ""
echo "To test run the agent in the foreground:"
echo "  cd ${SCRIPT_DIR}"
echo "  ./venv/bin/python3 agent.py"
echo ""
echo "To check service status:"
echo "  sudo systemctl status cloudsentinel-agent.service"
echo ""
echo "To inspect live logs:"
echo "  journalctl -u cloudsentinel-agent.service -f"
