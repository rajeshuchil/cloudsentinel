# CloudSentinel — Google Compute Engine (GCE) Deployment Guide

This guide documents the step-by-step procedure for deploying the **CloudSentinel** FastAPI backend to an **Ubuntu Linux Virtual Machine** hosted on **Google Compute Engine (GCE)**.

The deployed backend monitors its own Linux host hardware telemetry (`psutil`), inspects system authentication logs (`/var/log/auth.log`), evaluates automated alert thresholds, and exposes a secure HTTPS REST API consumed by your deployed React frontend.

---

## Architecture Overview in Production

```
[ Deployed React Frontend (HTTPS) ]
                │
                │ HTTPS (Port 443)
                ▼
[ GCE VPC Firewall (Ports 80 & 443 Open; Port 8000 BLOCKED) ]
                │
                ▼
[ Nginx Reverse Proxy & TLS Termination (Let's Encrypt) ]
                │
                │ HTTP Proxy (http://127.0.0.1:8000)
                ▼
[ systemd: cloudsentinel.service (User: cloudsentinel, Non-Root) ]
       ├── Uvicorn ASGI Server (FastAPI)
       ├── psutil (Linux /proc & /sys Telemetry)
       ├── Safe Tail /var/log/auth.log (adm group read-only)
       └── SQLite Persistent Database (/var/lib/cloudsentinel/cloudsentinel.db)
```

---

## 1. GCE VM Prerequisites

### 1.1 Compute Instance Specification
- **Compute Engine Instance**: `e2-small` (2 vCPU, 2 GB RAM) or `e2-medium` (2 vCPU, 4 GB RAM) is recommended.
- **Operating System**: Ubuntu 24.04 LTS or Ubuntu 22.04 LTS (x86_64).
- **Boot Disk**: Standard Persistent Disk (20 GB or larger).
- **Network Tags**: Apply network tags `http-server` and `https-server` to allow web traffic.
- **Static External IP**: Reserve and assign a **Static External IP address** in the GCP Console under *VPC Network → IP Addresses* to ensure DNS stability.
- **DNS Record**: Create an `A` record pointing your domain (e.g., `api.yourdomain.com`) to the VM's static external IP.

---

## 2. Linux System Dependencies

Connect to your GCE VM via SSH and update system packages:

```bash
# Update package indices and upgrade existing packages
sudo apt update && sudo apt upgrade -y

# Install Python 3, venv, Git, Nginx, and Certbot
sudo apt install -y python3 python3-venv python3-pip git nginx certbot python3-certbot-nginx
```

---

## 3. Dedicated Service User & Log Access Permissions

Following the **Principle of Least Privilege**, the backend service must run as an unprivileged dedicated system user rather than `root`.

### 3.1 Create the System User
```bash
sudo useradd -r -s /usr/sbin/nologin -d /var/lib/cloudsentinel cloudsentinel
```

### 3.2 Grant Read Access to Authentication Logs
On Ubuntu, `/var/log/auth.log` is readable by the `adm` group (`-rw-r----- 1 syslog adm`). Add the `cloudsentinel` user to the `adm` group:

```bash
sudo usermod -aG adm cloudsentinel
```

Verify that the user belongs to `adm`:
```bash
id cloudsentinel
# Expected output: uid=... gid=...(cloudsentinel) groups=...(cloudsentinel),4(adm)
```

---

## 4. Deploying the Application Code

Deploy the repository to the standard `/opt/cloudsentinel` directory:

```bash
# Create directory and assign initial ownership to your deployer user
sudo mkdir -p /opt/cloudsentinel
sudo chown -R $USER:$USER /opt/cloudsentinel

# Clone the repository
git clone https://github.com/your-username/cloudsentinel.git /opt/cloudsentinel

# Change to the application directory
cd /opt/cloudsentinel
```

---

## 5. Python Virtual Environment Setup

Create an isolated virtual environment and install the verified backend requirements:

```bash
# Create virtual environment in backend/.venv
python3 -m venv /opt/cloudsentinel/backend/.venv

# Upgrade pip inside the virtual environment
/opt/cloudsentinel/backend/.venv/bin/pip install --upgrade pip

# Install backend dependencies
/opt/cloudsentinel/backend/.venv/bin/pip install -r /opt/cloudsentinel/backend/requirements.txt
```

---

## 6. Persistent SQLite Storage Directory

The SQLite database must be stored in a dedicated persistent directory outside the codebase:

```bash
# Create persistent state directory
sudo mkdir -p /var/lib/cloudsentinel

# Set ownership to the dedicated service user
sudo chown -R cloudsentinel:cloudsentinel /var/lib/cloudsentinel

# Restrict permissions so only the service user can access it
sudo chmod 750 /var/lib/cloudsentinel
```

---

## 7. Production Environment Variable Configuration

Create a dedicated environment configuration file at `/etc/cloudsentinel/cloudsentinel.env`:

```bash
sudo mkdir -p /etc/cloudsentinel
sudo nano /etc/cloudsentinel/cloudsentinel.env
```

Populate `/etc/cloudsentinel/cloudsentinel.env` with your production settings:

```ini
# Server Binding (local loopback behind Nginx)
HOST=127.0.0.1
PORT=8000

# CORS Whitelist: specify the exact origin(s) of your deployed frontend.
# Replace with your deployed frontend URL (e.g. from Google AI Studio / Cloud Run / custom domain)
CORS_ORIGINS=https://your-frontend-app.web.app,https://my-dashboard.aistudio.google.com

# Persistent SQLite Database Location
SQLITE_DB_PATH=/var/lib/cloudsentinel/cloudsentinel.db

# Authentication Log Source
AUTH_LOG_PATH=/var/log/auth.log

# Monitored Root Filesystem Mount
DISK_MONITOR_PATH=/

# Operational Alert Thresholds
CPU_WARNING_THRESHOLD=75.0
CPU_CRITICAL_THRESHOLD=90.0
MEMORY_WARNING_THRESHOLD=80.0
MEMORY_CRITICAL_THRESHOLD=92.0
DISK_WARNING_THRESHOLD=75.0
DISK_CRITICAL_THRESHOLD=90.0

# Security Burst Correlation
SSH_REPEATED_ATTEMPTS_THRESHOLD=5
SSH_WINDOW_SECONDS=300
```

Secure the environment file so only root and the service user can read it:

```bash
sudo chown root:cloudsentinel /etc/cloudsentinel/cloudsentinel.env
sudo chmod 640 /etc/cloudsentinel/cloudsentinel.env
```

---

## 8. Systemd Service Installation

Install the production service unit file:

```bash
# Copy the provided service file to systemd directory
sudo cp /opt/cloudsentinel/deploy/cloudsentinel.service /etc/systemd/system/cloudsentinel.service

# Reload systemd daemon
sudo systemctl daemon-reload

# Enable service to start automatically on system boot
sudo systemctl enable cloudsentinel

# Start the service
sudo systemctl start cloudsentinel
```

Verify service status:
```bash
sudo systemctl status cloudsentinel
```

### Local API Verification
Test that the service is running locally on the VM:
```bash
curl -s http://127.0.0.1:8000/api/health
# Expected: {"status":"healthy","service":"cloudsentinel-backend"}

curl -s http://127.0.0.1:8000/api/system
# Expected: Full JSON telemetry response with real CPU, RAM, and Disk values
```

---

## 9. Google Cloud VPC Firewall Configuration

Ensure port 8000 is **NEVER** accessible from the public internet. Only ports 80 and 443 must be opened.

### Using Google Cloud Console:
1. Navigate to **VPC network → Firewall**.
2. Confirm or create rules allowing ingress on `tcp:80` and `tcp:443` for targets tagged `http-server` and `https-server`.
3. Verify that `tcp:8000` is **NOT** exposed.

### Using Google Cloud CLI (`gcloud`):
```bash
gcloud compute firewall-rules create allow-cloudsentinel-web \
    --direction=INGRESS \
    --priority=1000 \
    --network=default \
    --action=ALLOW \
    --rules=tcp:80,tcp:443 \
    --target-tags=http-server,https-server \
    --description="Allow HTTP and HTTPS ingress for CloudSentinel"
```

---

## 10. Reverse Proxy (Nginx) & HTTPS (Let's Encrypt) Setup

Nginx handles SSL/TLS termination, HTTP-to-HTTPS redirection, and proxies API requests locally to Uvicorn at `http://127.0.0.1:8000`.

### 10.1 Create Nginx Site Configuration
Create `/etc/nginx/sites-available/cloudsentinel`:

```bash
sudo nano /etc/nginx/sites-available/cloudsentinel
```

Insert the following configuration (replace `api.yourdomain.com` with your registered domain):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name api.yourdomain.com;

    # Security headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Maximum client request body size
    client_max_body_size 5M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;

        # Forward headers for proxy-aware client resolution
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Connection timeouts
        proxy_connect_timeout 10s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
}
```

### 10.2 Enable the Site & Restart Nginx
```bash
# Enable site configuration
sudo ln -s /etc/nginx/sites-available/cloudsentinel /etc/nginx/sites-enabled/

# Remove default site if present
sudo rm -f /etc/nginx/sites-enabled/default

# Test Nginx syntax
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

### 10.3 Provision HTTPS with Certbot
Obtain and configure an SSL certificate from Let's Encrypt:

```bash
sudo certbot --nginx -d api.yourdomain.com
```

Certbot will:
1. Validate domain ownership.
2. Install the TLS certificates.
3. Automatically configure HTTP-to-HTTPS 301 redirection.
4. Set up a systemd timer for automated certificate renewal (`systemctl list-timers | grep certbot`).

### 10.4 Verify Public HTTPS Endpoint
Test from any external computer:
```bash
curl -I https://api.yourdomain.com/api/health
# Expected: HTTP/2 200 OK
```

---

## 11. Connecting the Deployed Frontend

In your deployed React application environment (e.g. Google Cloud Run, AI Studio, or Static Web App):

1. Set the environment variable:
   ```env
   VITE_API_BASE_URL=https://api.yourdomain.com
   ```
2. Ensure the VM's `/etc/cloudsentinel/cloudsentinel.env` includes your frontend origin in `CORS_ORIGINS`:
   ```ini
   CORS_ORIGINS=https://your-frontend-app.web.app
   ```
3. Restart the backend if `CORS_ORIGINS` was modified:
   ```bash
   sudo systemctl restart cloudsentinel
   ```
4. Open the frontend dashboard in your browser. The connection badge in the sidebar will indicate **LIVE HOST DATA**, showing live metrics collected from your GCE Ubuntu VM.

---

## 12. Maintenance, Updates, and Logs

### Viewing Service Logs
Stream live backend application logs via `journalctl`:
```bash
sudo journalctl -u cloudsentinel -f
```

View Nginx access and error logs:
```bash
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### Applying Application Updates
When pulling updates from Git:

```bash
cd /opt/cloudsentinel

# Pull latest code
git pull origin main

# Update Python dependencies if requirements changed
/opt/cloudsentinel/backend/.venv/bin/pip install -r backend/requirements.txt

# Restart the service (zero configuration disruption)
sudo systemctl restart cloudsentinel

# Verify service is running
sudo systemctl status cloudsentinel
```

### Manual Database Backups
To create an offline or live backup of your SQLite database:
```bash
# Create a timestamped backup copy
sudo sqlite3 /var/lib/cloudsentinel/cloudsentinel.db ".backup /var/backups/cloudsentinel_$(date +%F).db"
```

---

## 13. Security Hardening Checklist

- [x] Dedicated unprivileged system user (`cloudsentinel`) with `/usr/sbin/nologin`.
- [x] Backend bound to local loopback (`127.0.0.1:8000`).
- [x] Port 8000 blocked from internet access via GCE VPC Firewall rules.
- [x] HTTPS enforced via Let's Encrypt TLS certificate and Nginx reverse proxy.
- [x] Strict CORS origin validation preventing unauthorized cross-origin API abuse.
- [x] Read-only `/var/log/auth.log` access via `adm` group membership.
- [x] Systemd security sandboxing enabled (`NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=strict`).
- [x] Persistent SQLite database stored in `/var/lib/cloudsentinel` with `0750` permissions.
