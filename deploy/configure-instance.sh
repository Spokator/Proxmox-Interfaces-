#!/usr/bin/env bash
# Interactive first-run configuration for Proxmox-Interfaces

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/proxmox-interfaces}"
ENV_FILE="$APP_DIR/.env"

if [[ "$(id -u)" != "0" ]]; then
  echo "[ERR] Run as root." >&2
  exit 1
fi

if [[ ! -d "$APP_DIR" ]]; then
  echo "[ERR] App directory not found: $APP_DIR" >&2
  exit 1
fi

prompt_default() {
  local label="$1"
  local default="$2"
  local out
  read -r -p "$label [$default]: " out
  [[ -z "$out" ]] && echo "$default" || echo "$out"
}

echo ""
echo "=== Proxmox-Interfaces | First-run configuration ==="
echo "This writes $ENV_FILE"
echo ""

PORT="$(prompt_default "App port" "3000")"
PVE_HOST="$(prompt_default "Proxmox host/IP" "10.0.0.10")"
PVE_PORT="$(prompt_default "Proxmox API port" "8006")"
PVE_TOKEN_ID="$(prompt_default "Proxmox token id" "api-user@pve!proxmox-interfaces")"
read -r -s -p "Proxmox token secret [required]: " PVE_TOKEN_SECRET
echo ""

TECHNITIUM_BASE_URL="$(prompt_default "Technitium base URL" "http://10.0.0.53:5380")"
TECHNITIUM_ZONE_SUFFIX="$(prompt_default "Technitium zone suffix" ".internal")"

cat > "$ENV_FILE" <<EOF
PORT=${PORT}

PVE_HOST=${PVE_HOST}
PVE_PORT=${PVE_PORT}
PVE_TOKEN_ID=${PVE_TOKEN_ID}
PVE_TOKEN_SECRET=${PVE_TOKEN_SECRET}

PVE_WATCH_TASKS_ENABLED=true
PVE_WATCH_SYSLOG_ENABLED=true
PVE_WATCH_INTERVAL_MS=20000

TECHNITIUM_BASE_URL=${TECHNITIUM_BASE_URL}
TECHNITIUM_TOKEN=
TECHNITIUM_USER=
TECHNITIUM_PASS=
TECHNITIUM_TOTP=
TECHNITIUM_ZONE_SUFFIX=${TECHNITIUM_ZONE_SUFFIX}
EOF

chmod 600 "$ENV_FILE"

echo "[OK] Wrote $ENV_FILE"
echo "[INFO] Restarting service..."
systemctl restart proxmox-interfaces
sleep 2

if systemctl is-active --quiet proxmox-interfaces; then
  echo "[OK] Service is active"
else
  echo "[ERR] Service failed to start" >&2
  journalctl -u proxmox-interfaces -n 80 --no-pager || true
  exit 1
fi

CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1/ || echo "000")
echo "[INFO] Local HTTP status: $CODE"
if [[ "$CODE" != "200" ]]; then
  echo "[WARN] App did not return 200 yet. Check logs: journalctl -u proxmox-interfaces -f"
fi

echo "[DONE] First-run configuration completed."
