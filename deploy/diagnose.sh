#!/usr/bin/env bash
# Quick diagnostics for install/runtime validation

set -euo pipefail

SERVICE="proxmox-interfaces"

echo "== Proxmox-Interfaces diagnostics =="

echo "[1] Service status"
systemctl is-active "$SERVICE" || true


echo "[2] Local HTTP"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1/ || echo "000")
echo "http://127.0.0.1 -> $HTTP_CODE"


echo "[3] API status"
curl -fsS http://127.0.0.1/api/status | sed -n '1,120p' || echo "API status unavailable"


echo "[4] Proxmox config check"
curl -fsS http://127.0.0.1/api/proxmox/config-check | sed -n '1,120p' || echo "Proxmox config-check unavailable"


echo "[5] Last logs"
journalctl -u "$SERVICE" -n 40 --no-pager || true

echo "[DONE]"
