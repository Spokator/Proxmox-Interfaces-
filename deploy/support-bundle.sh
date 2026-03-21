#!/usr/bin/env bash
# Collect runtime diagnostics for support

set -euo pipefail

OUT_DIR="${1:-/tmp/proxmox-interfaces-support-$(date +%Y%m%d-%H%M%S)}"
SERVICE="proxmox-interfaces"
APP_DIR="/opt/proxmox-interfaces"

mkdir -p "$OUT_DIR"

{
  echo "timestamp=$(date -Iseconds)"
  echo "hostname=$(hostname)"
  echo "kernel=$(uname -a)"
} > "$OUT_DIR/system.txt"

systemctl status "$SERVICE" --no-pager > "$OUT_DIR/systemd-status.txt" 2>&1 || true
journalctl -u "$SERVICE" -n 300 --no-pager > "$OUT_DIR/systemd-log.txt" 2>&1 || true

if [[ -f /etc/systemd/system/${SERVICE}.service ]]; then
  cp /etc/systemd/system/${SERVICE}.service "$OUT_DIR/${SERVICE}.service"
fi

if [[ -f /etc/nginx/sites-available/${SERVICE} ]]; then
  cp /etc/nginx/sites-available/${SERVICE} "$OUT_DIR/nginx-site.conf"
fi

if [[ -f "$APP_DIR/.env" ]]; then
  sed -E 's/(TOKEN_SECRET=).*/\1***REDACTED***/g; s/(TECHNITIUM_(TOKEN|PASS|TOTP)=).*/\1***REDACTED***/g' "$APP_DIR/.env" > "$OUT_DIR/env.redacted"
fi

curl -sS http://127.0.0.1/api/status > "$OUT_DIR/api-status.json" 2>/dev/null || true
curl -sS http://127.0.0.1/api/proxmox/config-check > "$OUT_DIR/proxmox-config-check.json" 2>/dev/null || true
curl -sS http://127.0.0.1/api/proxmox/watchers > "$OUT_DIR/proxmox-watchers.json" 2>/dev/null || true

ARCHIVE="${OUT_DIR}.tar.gz"
tar -czf "$ARCHIVE" -C "$(dirname "$OUT_DIR")" "$(basename "$OUT_DIR")"

echo "[OK] Support bundle created: $ARCHIVE"
