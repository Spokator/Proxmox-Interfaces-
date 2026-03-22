#!/usr/bin/env bash
# Interactive first-run configuration for Proxmox-Interfaces

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/proxmox-interfaces}"
ENV_FILE="$APP_DIR/.env"
SERVICE_NAME="proxmox-interfaces"

info() { echo "[INFO] $1"; }
ok() { echo "[OK] $1"; }
warn() { echo "[WARN] $1"; }
err() { echo "[ERR] $1" >&2; }

if [[ "$(id -u)" != "0" ]]; then
  err "Run as root."
  exit 1
fi

if [[ ! -d "$APP_DIR" ]]; then
  err "App directory not found: $APP_DIR"
  exit 1
fi

read_from_tty() {
  local out_var="$1"
  if [[ -r /dev/tty ]]; then
    IFS= read -r "$out_var" < /dev/tty
  else
    IFS= read -r "$out_var"
  fi
}

read_secret_from_tty() {
  local out_var="$1"
  if [[ -r /dev/tty ]]; then
    IFS= read -r -s "$out_var" < /dev/tty
  else
    IFS= read -r -s "$out_var"
  fi
}

get_env_value() {
  local key="$1"
  local file="$2"
  [[ -f "$file" ]] || return 1
  grep -E "^${key}=" "$file" | head -n1 | cut -d= -f2-
}

prompt_default() {
  local label="$1"
  local default="$2"
  local out

  if [[ -n "$default" ]]; then
    printf "%s [%s]: " "$label" "$default"
  else
    printf "%s: " "$label"
  fi
  read_from_tty out
  [[ -z "$out" ]] && echo "$default" || echo "$out"
}

prompt_secret() {
  local label="$1"
  local default="$2"
  local out
  local hint="required"
  [[ -n "$default" ]] && hint="leave empty to keep existing"

  printf "%s [%s]: " "$label" "$hint"
  read_secret_from_tty out
  echo ""
  [[ -z "$out" ]] && echo "$default" || echo "$out"
}

prompt_yes_no() {
  local label="$1"
  local default="$2"
  local out

  printf "%s [%s]: " "$label" "$default"
  read_from_tty out
  out="${out:-$default}"
  out="$(echo "$out" | tr '[:upper:]' '[:lower:]')"

  if [[ "$out" == "y" || "$out" == "yes" || "$out" == "o" || "$out" == "oui" ]]; then
    return 0
  fi
  return 1
}

mask_secret() {
  local value="$1"
  local len="${#value}"
  if (( len <= 6 )); then
    printf '%*s' "$len" '' | tr ' ' '*'
    return
  fi

  local middle=$((len - 6))
  local stars
  stars=$(printf '%*s' "$middle" '' | tr ' ' '*')
  echo "${value:0:3}${stars}${value: -3}"
}

validate_pve_credentials() {
  local host="$1"
  local port="$2"
  local token_id="$3"
  local token_secret="$4"

  if ! command -v curl >/dev/null 2>&1; then
    err "curl is required to validate Proxmox credentials."
    return 2
  fi

  local url="https://${host}:${port}/api2/json/version"
  local http_code
  http_code=$(curl -k -sS \
    --connect-timeout 5 \
    --max-time 12 \
    -H "Authorization: PVEAPIToken=${token_id}=${token_secret}" \
    -o /tmp/proxmox-interfaces-pve-check.json \
    -w "%{http_code}" \
    "$url" || echo "000")

  if [[ "$http_code" == "200" ]]; then
    if grep -q '"data"' /tmp/proxmox-interfaces-pve-check.json 2>/dev/null; then
      ok "Proxmox API validation succeeded (${host}:${port})"
      return 0
    fi
  fi

  err "Proxmox API validation failed (HTTP ${http_code})"
  if [[ -f /tmp/proxmox-interfaces-pve-check.json ]]; then
    warn "Response preview:"
    head -c 240 /tmp/proxmox-interfaces-pve-check.json || true
    echo ""
  fi
  return 1
}

echo ""
echo "=== Proxmox-Interfaces | First-run configuration ==="
echo "This writes $ENV_FILE"
echo ""

EXISTING_PORT="$(get_env_value "PORT" "$ENV_FILE" || true)"
EXISTING_PVE_HOST="$(get_env_value "PVE_HOST" "$ENV_FILE" || true)"
EXISTING_PVE_PORT="$(get_env_value "PVE_PORT" "$ENV_FILE" || true)"
EXISTING_PVE_TOKEN_ID="$(get_env_value "PVE_TOKEN_ID" "$ENV_FILE" || true)"
EXISTING_PVE_TOKEN_SECRET="$(get_env_value "PVE_TOKEN_SECRET" "$ENV_FILE" || true)"
EXISTING_TECHNITIUM_BASE_URL="$(get_env_value "TECHNITIUM_BASE_URL" "$ENV_FILE" || true)"
EXISTING_TECHNITIUM_ZONE_SUFFIX="$(get_env_value "TECHNITIUM_ZONE_SUFFIX" "$ENV_FILE" || true)"

while true; do
  PORT="$(prompt_default "App port" "${EXISTING_PORT:-3000}")"
  PVE_HOST="$(prompt_default "Proxmox host/IP" "${EXISTING_PVE_HOST:-10.0.0.10}")"
  PVE_PORT="$(prompt_default "Proxmox API port" "${EXISTING_PVE_PORT:-8006}")"
  PVE_TOKEN_ID="$(prompt_default "Proxmox token id" "${EXISTING_PVE_TOKEN_ID:-api-user@pve!proxmox-interfaces}")"
  PVE_TOKEN_SECRET="$(prompt_secret "Proxmox token secret" "${EXISTING_PVE_TOKEN_SECRET:-}")"
  TECHNITIUM_BASE_URL="$(prompt_default "Technitium base URL" "${EXISTING_TECHNITIUM_BASE_URL:-http://10.0.0.53:5380}")"
  TECHNITIUM_ZONE_SUFFIX="$(prompt_default "Technitium zone suffix" "${EXISTING_TECHNITIUM_ZONE_SUFFIX:-.internal}")"

  if [[ -z "$PVE_HOST" || -z "$PVE_TOKEN_ID" || -z "$PVE_TOKEN_SECRET" ]]; then
    warn "PVE_HOST, PVE_TOKEN_ID and PVE_TOKEN_SECRET are required."
    continue
  fi

  echo ""
  info "Configuration summary:"
  echo "  PORT=${PORT}"
  echo "  PVE_HOST=${PVE_HOST}"
  echo "  PVE_PORT=${PVE_PORT}"
  echo "  PVE_TOKEN_ID=${PVE_TOKEN_ID}"
  echo "  PVE_TOKEN_SECRET=$(mask_secret "$PVE_TOKEN_SECRET")"
  echo "  TECHNITIUM_BASE_URL=${TECHNITIUM_BASE_URL}"
  echo "  TECHNITIUM_ZONE_SUFFIX=${TECHNITIUM_ZONE_SUFFIX}"
  echo ""

  if prompt_yes_no "Validate Proxmox API credentials now?" "Y"; then
    if validate_pve_credentials "$PVE_HOST" "$PVE_PORT" "$PVE_TOKEN_ID" "$PVE_TOKEN_SECRET"; then
      break
    fi

    warn "Credentials validation failed."
    if prompt_yes_no "Retry configuration values?" "Y"; then
      echo ""
      continue
    fi

    if prompt_yes_no "Save anyway and restart service?" "N"; then
      warn "Proceeding without validated Proxmox credentials."
      break
    fi

    echo ""
    continue
  fi

  warn "Skipping Proxmox validation may lead to empty live inventory."
  if prompt_yes_no "Save anyway and restart service?" "N"; then
    break
  fi
  echo ""
done

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

ok "Wrote $ENV_FILE"
info "Restarting service..."
systemctl restart "$SERVICE_NAME"
sleep 2

if systemctl is-active --quiet "$SERVICE_NAME"; then
  ok "Service is active"
else
  err "Service failed to start"
  journalctl -u "$SERVICE_NAME" -n 80 --no-pager || true
  exit 1
fi

CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1/ || echo "000")
info "Local HTTP status: $CODE"
if [[ "$CODE" != "200" ]]; then
  warn "App did not return 200 yet. Check logs: journalctl -u ${SERVICE_NAME} -f"
fi

ok "First-run configuration completed."
