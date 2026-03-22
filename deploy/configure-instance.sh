#!/usr/bin/env bash
# Interactive first-run configuration for Proxmox-Interfaces

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/proxmox-interfaces}"
ENV_FILE="$APP_DIR/.env"
SERVICE_NAME="proxmox-interfaces"
CONFIG_MODE="${CONFIG_MODE:-manual}"
NON_INTERACTIVE="${NON_INTERACTIVE:-0}"

PRESET_PORT=""
PRESET_PVE_HOST=""
PRESET_PVE_PORT=""
PRESET_PVE_TOKEN_ID=""
PRESET_PVE_TOKEN_NAME=""
PRESET_PVE_TOKEN_SECRET=""
PRESET_TECHNITIUM_BASE_URL=""
PRESET_TECHNITIUM_ZONE_SUFFIX=""
PRESET_DNS_PROVIDER=""
PRESET_DNS_API_URL=""
PRESET_DNS_API_TOKEN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      CONFIG_MODE="$2"
      shift 2
      ;;
    --non-interactive)
      NON_INTERACTIVE="1"
      shift
      ;;
    --pve-host)
      PRESET_PVE_HOST="$2"
      shift 2
      ;;
    --pve-port)
      PRESET_PVE_PORT="$2"
      shift 2
      ;;
    --pve-token-id)
      PRESET_PVE_TOKEN_ID="$2"
      shift 2
      ;;
    --pve-token-name)
      PRESET_PVE_TOKEN_NAME="$2"
      shift 2
      ;;
    --pve-token-secret)
      PRESET_PVE_TOKEN_SECRET="$2"
      shift 2
      ;;
    --dns-provider)
      PRESET_DNS_PROVIDER="$2"
      shift 2
      ;;
    --dns-api-url)
      PRESET_DNS_API_URL="$2"
      shift 2
      ;;
    --dns-api-token)
      PRESET_DNS_API_TOKEN="$2"
      shift 2
      ;;
    --technitium-base-url)
      PRESET_TECHNITIUM_BASE_URL="$2"
      shift 2
      ;;
    --technitium-zone-suffix)
      PRESET_TECHNITIUM_ZONE_SUFFIX="$2"
      shift 2
      ;;
    --port)
      PRESET_PORT="$2"
      shift 2
      ;;
    -h|--help)
      cat <<'EOF'
Usage: configure-instance.sh [options]

Options:
  --mode <auto|manual>            Configuration mode (default: manual)
  --non-interactive               Do not ask follow-up confirmations
  --port <value>                  Preseed app port
  --pve-host <value>              Preseed PVE_HOST
  --pve-port <value>              Preseed PVE_PORT
  --pve-token-id <value>          Preseed PVE_TOKEN_ID
  --pve-token-name <value>        Token name if id is provided as user@realm only
  --pve-token-secret <value>      Preseed PVE_TOKEN_SECRET
  --dns-provider <none|technitium|custom>
  --dns-api-url <value>           For custom DNS integration
  --dns-api-token <value>         For custom DNS integration
  --technitium-base-url <value>   Preseed TECHNITIUM_BASE_URL
  --technitium-zone-suffix <val>  Preseed TECHNITIUM_ZONE_SUFFIX
EOF
      exit 0
      ;;
    *)
      echo "[ERR] Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

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

read_prompt_value() {
  local out_var="$1"
  local prompt="$2"
  local reply=""

  if [[ -t 0 ]]; then
    read -r -p "$prompt" reply
  elif [[ -r /dev/tty ]]; then
    read -r -p "$prompt" reply < /dev/tty
  else
    printf "%s" "$prompt" >&2
    read -r reply
  fi

  printf -v "$out_var" '%s' "$reply"
}

read_secret_value() {
  local out_var="$1"
  local prompt="$2"
  local reply=""

  if [[ -t 0 ]]; then
    read -r -s -p "$prompt" reply
    echo ""
  elif [[ -r /dev/tty ]]; then
    read -r -s -p "$prompt" reply < /dev/tty
    echo ""
  else
    printf "%s" "$prompt" >&2
    read -r -s reply
    echo ""
  fi

  printf -v "$out_var" '%s' "$reply"
}

get_env_value() {
  local key="$1"
  local file="$2"
  [[ -f "$file" ]] || return 1
  grep -E "^${key}=" "$file" | head -n1 | cut -d= -f2-
}

normalize_mode() {
  local m
  m="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
  case "$m" in
    a|auto|automatique) echo "auto" ;;
    m|manual|manuel) echo "manual" ;;
    *) echo "manual" ;;
  esac
}

normalize_dns_provider() {
  local p
  p="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
  case "$p" in
    ""|none|no|off|disabled) echo "none" ;;
    technitium|tech) echo "technitium" ;;
    custom|generic|api) echo "custom" ;;
    *) echo "none" ;;
  esac
}

sanitize_single_line() {
  printf '%s' "$1" | tr -d '\r\n'
}

ensure_token_id_format() {
  local token_id="$1"
  local token_name="$2"

  if [[ "$token_id" == *"!"* ]]; then
    echo "$token_id"
    return 0
  fi

  if [[ "$token_id" == *@* ]]; then
    if [[ -z "$token_name" ]]; then
      return 1
    fi
    echo "${token_id}!${token_name}"
    return 0
  fi

  return 1
}

is_valid_token_id() {
  local token_id="$1"
  [[ "$token_id" == *@*'!'* ]]
}

default_gateway_ip() {
  ip route 2>/dev/null | awk '/^default /{print $3; exit}'
}

default_dns_ip() {
  local ns
  ns="$(awk '/^nameserver /{print $2; exit}' /etc/resolv.conf 2>/dev/null || true)"
  if [[ -n "$ns" ]]; then
    echo "$ns"
    return
  fi
  default_gateway_ip
}

prompt_default() {
  local label="$1"
  local default="$2"
  local out=""

  if [[ -n "$default" ]]; then
    read_prompt_value out "$label [$default]: "
  else
    read_prompt_value out "$label: "
  fi

  [[ -z "$out" ]] && echo "$default" || echo "$out"
}

prompt_secret() {
  local label="$1"
  local default="$2"
  local out=""
  local hint="required"
  [[ -n "$default" ]] && hint="leave empty to keep existing"

  read_secret_value out "$label [$hint]: "
  [[ -z "$out" ]] && echo "$default" || echo "$out"
}

prompt_yes_no() {
  local label="$1"
  local default="$2"
  local out=""

  read_prompt_value out "$label [$default]: "
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
  local http_code="000"
  local curl_out
  curl_out=$(curl -k -sS \
    --connect-timeout 5 \
    --max-time 12 \
    -H "Authorization: PVEAPIToken=${token_id}=${token_secret}" \
    -o /tmp/proxmox-interfaces-pve-check.json \
    -w "%{http_code}" \
    "$url" || true)
  if [[ -n "$curl_out" ]]; then
    http_code="$curl_out"
  fi

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

configure_dns_settings() {
  local mode="$1"
  local provider_default="$2"
  local provider=""

  if [[ "$mode" == "manual" ]]; then
    provider="$(prompt_default "DNS provider (none|technitium|custom)" "$provider_default")"
  else
    if [[ "$NON_INTERACTIVE" == "1" ]]; then
      provider="$provider_default"
    else
      provider="$(prompt_default "DNS provider (none|technitium|custom)" "$provider_default")"
    fi
  fi

  DNS_PROVIDER="$(normalize_dns_provider "$provider")"

  if [[ "$DNS_PROVIDER" == "technitium" ]]; then
    if [[ "$NON_INTERACTIVE" == "1" && "$mode" != "manual" ]]; then
      TECHNITIUM_BASE_URL="${EXISTING_TECHNITIUM_BASE_URL:-http://10.0.0.53:5380}"
      TECHNITIUM_ZONE_SUFFIX="${EXISTING_TECHNITIUM_ZONE_SUFFIX:-.internal}"
    else
      TECHNITIUM_BASE_URL="$(prompt_default "Technitium base URL" "${EXISTING_TECHNITIUM_BASE_URL:-http://10.0.0.53:5380}")"
      TECHNITIUM_ZONE_SUFFIX="$(prompt_default "Technitium zone suffix" "${EXISTING_TECHNITIUM_ZONE_SUFFIX:-.internal}")"
    fi
    DNS_API_URL=""
    DNS_API_TOKEN=""
  elif [[ "$DNS_PROVIDER" == "custom" ]]; then
    if [[ "$NON_INTERACTIVE" == "1" && "$mode" != "manual" ]]; then
      DNS_API_URL="${EXISTING_DNS_API_URL:-http://dns-api.local}"
      DNS_API_TOKEN="${EXISTING_DNS_API_TOKEN:-}"
    else
      DNS_API_URL="$(prompt_default "Custom DNS API URL" "${EXISTING_DNS_API_URL:-http://dns-api.local}")"
      DNS_API_TOKEN="$(prompt_secret "Custom DNS API token" "${EXISTING_DNS_API_TOKEN:-}")"
    fi
    TECHNITIUM_BASE_URL=""
    TECHNITIUM_ZONE_SUFFIX="${EXISTING_TECHNITIUM_ZONE_SUFFIX:-.internal}"
  else
    DNS_PROVIDER="none"
    DNS_API_URL=""
    DNS_API_TOKEN=""
    TECHNITIUM_BASE_URL=""
    TECHNITIUM_ZONE_SUFFIX="${EXISTING_TECHNITIUM_ZONE_SUFFIX:-.internal}"
  fi
}

write_env_and_restart() {
  cat > "$ENV_FILE" <<EOF
PORT=${PORT}

PVE_HOST=${PVE_HOST}
PVE_PORT=${PVE_PORT}
PVE_TOKEN_ID=${PVE_TOKEN_ID}
PVE_TOKEN_SECRET=${PVE_TOKEN_SECRET}

PVE_WATCH_TASKS_ENABLED=true
PVE_WATCH_SYSLOG_ENABLED=true
PVE_WATCH_INTERVAL_MS=20000

DNS_PROVIDER=${DNS_PROVIDER}
DNS_API_URL=${DNS_API_URL}
DNS_API_TOKEN=${DNS_API_TOKEN}

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
}

run_manual_configuration() {
  while true; do
    PORT="$(prompt_default "App port" "${EXISTING_PORT:-3000}")"
    PVE_HOST="$(prompt_default "Proxmox host/IP" "${EXISTING_PVE_HOST:-10.0.0.10}")"
    PVE_PORT="$(prompt_default "Proxmox API port" "${EXISTING_PVE_PORT:-8006}")"
    PVE_TOKEN_ID="$(prompt_default "Proxmox token id (user@realm!tokenname)" "${EXISTING_PVE_TOKEN_ID:-api-user@pve!proxmox-interfaces}")"
    PVE_TOKEN_SECRET="$(prompt_secret "Proxmox token secret" "${EXISTING_PVE_TOKEN_SECRET:-}")"

    PVE_HOST="$(sanitize_single_line "$PVE_HOST")"
    PVE_PORT="$(sanitize_single_line "$PVE_PORT")"
    PVE_TOKEN_ID="$(sanitize_single_line "$PVE_TOKEN_ID")"
    PVE_TOKEN_SECRET="$(sanitize_single_line "$PVE_TOKEN_SECRET")"

    if [[ "$PVE_TOKEN_ID" != *"!"* && "$PVE_TOKEN_ID" == *@* ]]; then
      PVE_TOKEN_NAME="$(prompt_default "Proxmox token name" "${PRESET_PVE_TOKEN_NAME:-proxmox-interfaces}")"
      PVE_TOKEN_NAME="$(sanitize_single_line "$PVE_TOKEN_NAME")"
      PVE_TOKEN_ID="$(ensure_token_id_format "$PVE_TOKEN_ID" "$PVE_TOKEN_NAME" || true)"
    fi

    configure_dns_settings "manual" "${EXISTING_DNS_PROVIDER:-none}"

    if [[ -z "$PVE_HOST" || -z "$PVE_TOKEN_ID" || -z "$PVE_TOKEN_SECRET" ]]; then
      warn "PVE_HOST, PVE_TOKEN_ID and PVE_TOKEN_SECRET are required."
      continue
    fi

    if ! is_valid_token_id "$PVE_TOKEN_ID"; then
      warn "PVE_TOKEN_ID format invalid. Expected user@realm!tokenname"
      continue
    fi

    echo ""
    info "Configuration summary:"
    echo "  PORT=${PORT}"
    echo "  PVE_HOST=${PVE_HOST}"
    echo "  PVE_PORT=${PVE_PORT}"
    echo "  PVE_TOKEN_ID=${PVE_TOKEN_ID}"
    echo "  PVE_TOKEN_SECRET=$(mask_secret "$PVE_TOKEN_SECRET")"
    echo "  DNS_PROVIDER=${DNS_PROVIDER}"
    if [[ "$DNS_PROVIDER" == "technitium" ]]; then
      echo "  TECHNITIUM_BASE_URL=${TECHNITIUM_BASE_URL}"
      echo "  TECHNITIUM_ZONE_SUFFIX=${TECHNITIUM_ZONE_SUFFIX}"
    fi
    if [[ "$DNS_PROVIDER" == "custom" ]]; then
      echo "  DNS_API_URL=${DNS_API_URL}"
      echo "  DNS_API_TOKEN=$(mask_secret "$DNS_API_TOKEN")"
    fi
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
}

run_auto_configuration() {
  local gw dns_ip auto_host dns_provider_default

  gw="$(default_gateway_ip || true)"
  dns_ip="$(default_dns_ip || true)"
  auto_host="${EXISTING_PVE_HOST:-10.0.0.10}"

  PORT="${PRESET_PORT:-${EXISTING_PORT:-3000}}"
  PVE_HOST="${PRESET_PVE_HOST:-${EXISTING_PVE_HOST:-$auto_host}}"
  PVE_PORT="${PRESET_PVE_PORT:-${EXISTING_PVE_PORT:-8006}}"
  PVE_TOKEN_ID="${PRESET_PVE_TOKEN_ID:-${EXISTING_PVE_TOKEN_ID:-api-user@pve!proxmox-interfaces}}"
  PVE_TOKEN_SECRET="${PRESET_PVE_TOKEN_SECRET:-${EXISTING_PVE_TOKEN_SECRET:-}}"

  if [[ "$NON_INTERACTIVE" != "1" ]]; then
    PVE_HOST="$(prompt_default "Proxmox host/IP" "$PVE_HOST")"
    PVE_PORT="$(prompt_default "Proxmox API port" "$PVE_PORT")"
    PVE_TOKEN_ID="$(prompt_default "Proxmox token id (user@realm!tokenname)" "$PVE_TOKEN_ID")"
  fi

  PVE_HOST="$(sanitize_single_line "$PVE_HOST")"
  PVE_PORT="$(sanitize_single_line "$PVE_PORT")"
  PVE_TOKEN_ID="$(sanitize_single_line "$PVE_TOKEN_ID")"
  PVE_TOKEN_SECRET="$(sanitize_single_line "$PVE_TOKEN_SECRET")"

  if [[ "$PVE_TOKEN_ID" != *"!"* && "$PVE_TOKEN_ID" == *@* ]]; then
    if [[ "$NON_INTERACTIVE" == "1" ]]; then
      PVE_TOKEN_ID="$(ensure_token_id_format "$PVE_TOKEN_ID" "${PRESET_PVE_TOKEN_NAME:-proxmox-interfaces}" || true)"
    else
      PVE_TOKEN_NAME="$(prompt_default "Proxmox token name" "${PRESET_PVE_TOKEN_NAME:-proxmox-interfaces}")"
      PVE_TOKEN_NAME="$(sanitize_single_line "$PVE_TOKEN_NAME")"
      PVE_TOKEN_ID="$(ensure_token_id_format "$PVE_TOKEN_ID" "$PVE_TOKEN_NAME" || true)"
    fi
  fi

  if [[ -n "${PRESET_DNS_PROVIDER:-}" ]]; then
    dns_provider_default="$PRESET_DNS_PROVIDER"
  elif [[ -n "${EXISTING_DNS_PROVIDER:-}" ]]; then
    dns_provider_default="$EXISTING_DNS_PROVIDER"
  elif [[ -n "${EXISTING_TECHNITIUM_BASE_URL:-}" ]]; then
    dns_provider_default="technitium"
  else
    dns_provider_default="none"
  fi

  if [[ -n "${PRESET_TECHNITIUM_BASE_URL:-}" ]]; then
    EXISTING_TECHNITIUM_BASE_URL="$PRESET_TECHNITIUM_BASE_URL"
  elif [[ -z "${EXISTING_TECHNITIUM_BASE_URL:-}" && -n "$dns_ip" ]]; then
    EXISTING_TECHNITIUM_BASE_URL="http://${dns_ip}:5380"
  fi

  if [[ -n "${PRESET_TECHNITIUM_ZONE_SUFFIX:-}" ]]; then
    EXISTING_TECHNITIUM_ZONE_SUFFIX="$PRESET_TECHNITIUM_ZONE_SUFFIX"
  fi

  if [[ -n "${PRESET_DNS_API_URL:-}" ]]; then
    EXISTING_DNS_API_URL="$PRESET_DNS_API_URL"
  fi
  if [[ -n "${PRESET_DNS_API_TOKEN:-}" ]]; then
    EXISTING_DNS_API_TOKEN="$PRESET_DNS_API_TOKEN"
  fi

  configure_dns_settings "auto" "$dns_provider_default"

  if [[ -z "$PVE_TOKEN_SECRET" ]]; then
    if [[ "$NON_INTERACTIVE" == "1" ]]; then
      err "Auto mode requires PVE token secret (existing .env or --pve-token-secret)."
      exit 1
    fi
    warn "PVE token secret is missing."
    PVE_TOKEN_SECRET="$(prompt_secret "Proxmox token secret" "")"
    if [[ -z "$PVE_TOKEN_SECRET" ]]; then
      err "PVE token secret is required."
      exit 1
    fi
  fi

  echo ""
  info "Automatic profile summary:"
  echo "  PORT=${PORT}"
  echo "  PVE_HOST=${PVE_HOST}"
  echo "  PVE_PORT=${PVE_PORT}"
  echo "  PVE_TOKEN_ID=${PVE_TOKEN_ID}"
  echo "  PVE_TOKEN_SECRET=$(mask_secret "$PVE_TOKEN_SECRET")"
  echo "  DNS_PROVIDER=${DNS_PROVIDER}"
  if [[ "$DNS_PROVIDER" == "technitium" ]]; then
    echo "  TECHNITIUM_BASE_URL=${TECHNITIUM_BASE_URL}"
    echo "  TECHNITIUM_ZONE_SUFFIX=${TECHNITIUM_ZONE_SUFFIX}"
  fi
  if [[ "$DNS_PROVIDER" == "custom" ]]; then
    echo "  DNS_API_URL=${DNS_API_URL}"
    echo "  DNS_API_TOKEN=$(mask_secret "$DNS_API_TOKEN")"
  fi
  echo ""

  if ! is_valid_token_id "$PVE_TOKEN_ID"; then
    err "PVE_TOKEN_ID format invalid. Expected user@realm!tokenname"
    if [[ "$NON_INTERACTIVE" == "1" ]]; then
      exit 1
    fi
    warn "Switching to manual mode to fix token format."
    run_manual_configuration
    return
  fi

  if ! validate_pve_credentials "$PVE_HOST" "$PVE_PORT" "$PVE_TOKEN_ID" "$PVE_TOKEN_SECRET"; then
    if [[ "$NON_INTERACTIVE" == "1" ]]; then
      err "Automatic mode aborted because Proxmox validation failed."
      exit 1
    fi

    warn "Automatic mode validation failed."
    if prompt_yes_no "Switch to manual mode now?" "Y"; then
      run_manual_configuration
      return
    fi

    if ! prompt_yes_no "Save automatic values anyway and restart service?" "N"; then
      err "Automatic configuration cancelled."
      exit 1
    fi
  fi
}

echo ""
echo "=== Proxmox-Interfaces | First-run configuration ==="
echo "This writes $ENV_FILE"
echo ""

CONFIG_MODE="$(normalize_mode "$CONFIG_MODE")"

EXISTING_PORT="$(get_env_value "PORT" "$ENV_FILE" || true)"
EXISTING_PVE_HOST="$(get_env_value "PVE_HOST" "$ENV_FILE" || true)"
EXISTING_PVE_PORT="$(get_env_value "PVE_PORT" "$ENV_FILE" || true)"
EXISTING_PVE_TOKEN_ID="$(get_env_value "PVE_TOKEN_ID" "$ENV_FILE" || true)"
EXISTING_PVE_TOKEN_SECRET="$(get_env_value "PVE_TOKEN_SECRET" "$ENV_FILE" || true)"
EXISTING_DNS_PROVIDER="$(get_env_value "DNS_PROVIDER" "$ENV_FILE" || true)"
EXISTING_DNS_API_URL="$(get_env_value "DNS_API_URL" "$ENV_FILE" || true)"
EXISTING_DNS_API_TOKEN="$(get_env_value "DNS_API_TOKEN" "$ENV_FILE" || true)"
EXISTING_TECHNITIUM_BASE_URL="$(get_env_value "TECHNITIUM_BASE_URL" "$ENV_FILE" || true)"
EXISTING_TECHNITIUM_ZONE_SUFFIX="$(get_env_value "TECHNITIUM_ZONE_SUFFIX" "$ENV_FILE" || true)"

if [[ -z "$EXISTING_DNS_PROVIDER" ]]; then
  if [[ -n "$EXISTING_TECHNITIUM_BASE_URL" ]]; then
    EXISTING_DNS_PROVIDER="technitium"
  else
    EXISTING_DNS_PROVIDER="none"
  fi
fi

if [[ "$CONFIG_MODE" == "auto" ]]; then
  run_auto_configuration
else
  run_manual_configuration
fi

write_env_and_restart
