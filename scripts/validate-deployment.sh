#!/usr/bin/env bash
set -euo pipefail

PROFILE="${PROFILE:-core}"
APP_PORT="${APP_PORT:-3000}"
NGINX_PORT="${NGINX_PORT:-80}"
SMARTCTL_PORT="${SMARTCTL_PORT:-9633}"
PROM_PORT="${PROM_PORT:-9090}"
GRAFANA_PORT="${GRAFANA_PORT:-3001}"
MONITORING_DIR="${MONITORING_DIR:-/opt/monitoring}"
STACK_DIR="${STACK_DIR:-$MONITORING_DIR/stack}"
GRAFANA_ADMIN_USER="${GRAFANA_ADMIN_USER:-admin}"
GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-admin}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --app-port)
      APP_PORT="$2"
      shift 2
      ;;
    --nginx-port)
      NGINX_PORT="$2"
      shift 2
      ;;
    --smartctl-port)
      SMARTCTL_PORT="$2"
      shift 2
      ;;
    --prom-port)
      PROM_PORT="$2"
      shift 2
      ;;
    --grafana-port)
      GRAFANA_PORT="$2"
      shift 2
      ;;
    --monitoring-dir)
      MONITORING_DIR="$2"
      STACK_DIR="$MONITORING_DIR/stack"
      shift 2
      ;;
    --grafana-admin-user)
      GRAFANA_ADMIN_USER="$2"
      shift 2
      ;;
    --grafana-admin-password)
      GRAFANA_ADMIN_PASSWORD="$2"
      shift 2
      ;;
    -h|--help)
      cat <<'EOF'
Usage: validate-deployment.sh [options]

Options:
  --profile <core|full|pro>       Deployment profile to validate (default: core)
  --app-port <port>               App node port (default: 3000)
  --nginx-port <port>             Nginx port (default: 80)
  --smartctl-port <port>          smartctl_exporter port (default: 9633)
  --prom-port <port>              Prometheus port (default: 9090)
  --grafana-port <port>           Grafana port (default: 3001)
  --monitoring-dir <path>         Monitoring base directory (default: /opt/monitoring)
  --grafana-admin-user <user>     Grafana admin user override
  --grafana-admin-password <pass> Grafana admin password override
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

PROFILE="$(echo "$PROFILE" | tr '[:upper:]' '[:lower:]')"
case "$PROFILE" in
  core|full|pro) ;;
  *) PROFILE="core" ;;
esac

if [[ -f "$STACK_DIR/.env" ]]; then
  # shellcheck disable=SC1090
  set +u
  source "$STACK_DIR/.env"
  set -u
fi

ok() { echo "[OK] $*"; }
warn() { echo "[WARN] $*"; }
fail() { echo "[FAIL] $*"; FAILURES=$((FAILURES + 1)); }

check_http_ok() {
  local url="$1"
  local label="$2"
  if curl -fsS "$url" >/dev/null 2>&1; then
    ok "$label"
  else
    fail "$label"
  fi
}

FAILURES=0

echo "[INFO] Validation profile=$PROFILE"

check_http_ok "http://127.0.0.1:${NGINX_PORT}/api/status" "API status via nginx on :${NGINX_PORT}"
check_http_ok "http://127.0.0.1:${APP_PORT}/api/status" "API status via node on :${APP_PORT}"

smartctl_load_state="$(systemctl show -p LoadState --value smartctl_exporter 2>/dev/null || echo not-found)"
if [[ "$smartctl_load_state" != "not-found" ]]; then
  if systemctl is-active --quiet smartctl_exporter; then
    ok "smartctl_exporter service active"
  else
    fail "smartctl_exporter service inactive"
  fi
  check_http_ok "http://127.0.0.1:${SMARTCTL_PORT}/metrics" "smartctl_exporter metrics on :${SMARTCTL_PORT}"
else
  if [[ "$PROFILE" == "core" ]]; then
    warn "smartctl_exporter not installed (expected for core profile)"
  else
    fail "smartctl_exporter not installed"
  fi
fi

if [[ "$PROFILE" == "full" ]]; then
  check_http_ok "http://127.0.0.1:${PROM_PORT}/-/ready" "Prometheus ready on :${PROM_PORT}"
  check_http_ok "http://127.0.0.1:${GRAFANA_PORT}/api/health" "Grafana health on :${GRAFANA_PORT}"

  if curl -fsS -u "${GRAFANA_ADMIN_USER}:${GRAFANA_ADMIN_PASSWORD}" \
    "http://127.0.0.1:${GRAFANA_PORT}/api/datasources/name/ProxmoxInterfacesPrometheus" >/dev/null 2>&1; then
    ok "Grafana datasource ProxmoxInterfacesPrometheus provisioned"
  else
    fail "Grafana datasource ProxmoxInterfacesPrometheus missing"
  fi

  if curl -fsS -u "${GRAFANA_ADMIN_USER}:${GRAFANA_ADMIN_PASSWORD}" \
    "http://127.0.0.1:${GRAFANA_PORT}/api/search?query=Proxmox%20Interfaces%20Monitoring%20Overview" | grep -q "proxmox-interfaces-overview"; then
    ok "Grafana dashboard proxmox-interfaces-overview provisioned"
  else
    fail "Grafana dashboard proxmox-interfaces-overview missing"
  fi

  if curl -fsS "http://127.0.0.1:${PROM_PORT}/api/v1/targets?state=any" | grep -q "smartctl"; then
    ok "Prometheus target list contains smartctl job"
  else
    fail "Prometheus target list missing smartctl job"
  fi
fi

if [[ "$FAILURES" -gt 0 ]]; then
  echo "[ERR] Validation failed with $FAILURES issue(s)."
  exit 1
fi

echo "[OK] Validation successful"
