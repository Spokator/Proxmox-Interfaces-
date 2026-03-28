#!/usr/bin/env bash
# Full platform setup orchestrator (manual or automatic)

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/proxmox-interfaces}"
CONFIG_WIZARD="$APP_DIR/deploy/configure-instance.sh"
SMARTCTL_INSTALLER="$APP_DIR/scripts/install-smartctl-exporter.sh"
PROM_SETUP_SCRIPT="$APP_DIR/scripts/configure-prometheus-smartctl.sh"
LOCAL_MONITORING_INSTALLER="$APP_DIR/scripts/install-monitoring-stack.sh"
ENV_FILE="$APP_DIR/.env"

MODE="${MODE:-auto}"
PLATFORM_PROFILE="${PLATFORM_PROFILE:-${COMMUNITY_PROFILE:-core}}"
NON_INTERACTIVE="${NON_INTERACTIVE:-0}"
RUN_CORE_CONFIG="${RUN_CORE_CONFIG:-auto}"
INSTALL_SMARTCTL="${INSTALL_SMARTCTL:-auto}"
INSTALL_MONITORING_STACK="${INSTALL_MONITORING_STACK:-auto}"
CONFIGURE_PROMETHEUS="${CONFIGURE_PROMETHEUS:-auto}"
PROMETHEUS_CTID="${PROMETHEUS_CTID:-}"
PROMETHEUS_TARGET="${PROMETHEUS_TARGET:-$(hostname -I 2>/dev/null | awk '{print $1}'):9633}"
PROMETHEUS_CONFIG="${PROMETHEUS_CONFIG:-/opt/monitoring/prometheus/prometheus.yml}"
PROMETHEUS_CONTAINER="${PROMETHEUS_CONTAINER:-prometheus}"

log_info() { echo "[INFO] $1"; }
log_ok() { echo "[OK] $1"; }
log_warn() { echo "[WARN] $1"; }
log_err() { echo "[ERR] $1" >&2; }

normalize_mode() {
  case "$(echo "$1" | tr '[:upper:]' '[:lower:]')" in
    m|manual|manuel) echo "manual" ;;
    *) echo "auto" ;;
  esac
}

normalize_switch() {
  local raw
  raw="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
  case "$raw" in
    1|true|yes|y|on|oui|o) echo "1" ;;
    0|false|no|n|off|non) echo "0" ;;
    *) echo "auto" ;;
  esac
}

normalize_profile() {
  local p
  p="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
  case "$p" in
    full|pro) echo "$p" ;;
    *) echo "core" ;;
  esac
}

read_prompt() {
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

ask_yes_no() {
  local label="$1"
  local default="$2"
  local out=""
  read_prompt out "$label [$default]: "
  out="${out:-$default}"
  out="$(echo "$out" | tr '[:upper:]' '[:lower:]')"
  [[ "$out" == "y" || "$out" == "yes" || "$out" == "o" || "$out" == "oui" ]]
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --profile) PLATFORM_PROFILE="$2"; shift 2 ;;
    --non-interactive) NON_INTERACTIVE="1"; shift ;;
    --run-core-config) RUN_CORE_CONFIG="$2"; shift 2 ;;
    --install-smartctl) INSTALL_SMARTCTL="$2"; shift 2 ;;
    --install-monitoring-stack) INSTALL_MONITORING_STACK="$2"; shift 2 ;;
    --configure-prometheus) CONFIGURE_PROMETHEUS="$2"; shift 2 ;;
    --prometheus-ctid) PROMETHEUS_CTID="$2"; shift 2 ;;
    --prometheus-target) PROMETHEUS_TARGET="$2"; shift 2 ;;
    --prometheus-config) PROMETHEUS_CONFIG="$2"; shift 2 ;;
    --prometheus-container) PROMETHEUS_CONTAINER="$2"; shift 2 ;;
    -h|--help)
      cat <<'EOF'
Usage: setup-platform.sh [options]

Options:
  --mode <auto|manual>                Setup mode (default: auto)
  --profile <core|full|pro>           Deployment profile (default: core)
  --non-interactive                   Do not ask for confirmations
  --run-core-config <auto|true|false> Run configure-instance wizard
  --install-smartctl <auto|true|false>
  --install-monitoring-stack <auto|true|false> Install local Prometheus+Grafana stack
  --configure-prometheus <auto|true|false>
  --prometheus-ctid <id>              Monitoring CTID for Prometheus
  --prometheus-target <host:port>     smartctl exporter target (default: this CT IP:9633)
  --prometheus-config <path>          Prometheus config path
  --prometheus-container <name>       Prometheus docker container name
EOF
      exit 0
      ;;
    *)
      log_err "Unknown option: $1"
      exit 1
      ;;
  esac
done

if [[ "$(id -u)" != "0" ]]; then
  log_err "Run as root."
  exit 1
fi

if [[ ! -d "$APP_DIR" ]]; then
  log_err "App directory not found: $APP_DIR"
  exit 1
fi

MODE="$(normalize_mode "$MODE")"
PLATFORM_PROFILE="$(normalize_profile "$PLATFORM_PROFILE")"
RUN_CORE_CONFIG="$(normalize_switch "$RUN_CORE_CONFIG")"
INSTALL_SMARTCTL="$(normalize_switch "$INSTALL_SMARTCTL")"
INSTALL_MONITORING_STACK="$(normalize_switch "$INSTALL_MONITORING_STACK")"
CONFIGURE_PROMETHEUS="$(normalize_switch "$CONFIGURE_PROMETHEUS")"

if [[ "$RUN_CORE_CONFIG" == "auto" ]]; then
  if [[ -f "$ENV_FILE" ]] && grep -q '^PVE_TOKEN_SECRET=' "$ENV_FILE" && ! grep -q '^PVE_TOKEN_SECRET=\s*$' "$ENV_FILE"; then
    RUN_CORE_CONFIG="0"
  else
    RUN_CORE_CONFIG="1"
  fi
fi

if [[ "$INSTALL_SMARTCTL" == "auto" ]]; then
  if [[ "$PLATFORM_PROFILE" == "core" ]]; then
    INSTALL_SMARTCTL="0"
  else
    INSTALL_SMARTCTL="1"
  fi
fi

if [[ "$INSTALL_MONITORING_STACK" == "auto" ]]; then
  if [[ "$PLATFORM_PROFILE" == "full" ]]; then
    INSTALL_MONITORING_STACK="1"
  else
    INSTALL_MONITORING_STACK="0"
  fi
fi

if [[ "$CONFIGURE_PROMETHEUS" == "auto" ]]; then
  if [[ "$PLATFORM_PROFILE" == "pro" && -n "$PROMETHEUS_CTID" ]]; then
    CONFIGURE_PROMETHEUS="1"
  else
    CONFIGURE_PROMETHEUS="0"
  fi
fi

if [[ "$MODE" == "manual" && "$NON_INTERACTIVE" != "1" ]]; then
  echo ""
  log_info "Platform setup profile (manual)"
  if ask_yes_no "Run core app configuration wizard now?" "Y"; then
    RUN_CORE_CONFIG="1"
  else
    RUN_CORE_CONFIG="0"
  fi

  if ask_yes_no "Install smartctl exporter on this instance?" "Y"; then
    INSTALL_SMARTCTL="1"
  else
    INSTALL_SMARTCTL="0"
  fi

  if ask_yes_no "Install local Prometheus + Grafana stack on this instance?" "N"; then
    INSTALL_MONITORING_STACK="1"
  else
    INSTALL_MONITORING_STACK="0"
  fi

  if ask_yes_no "Configure Prometheus scrape job from Proxmox host?" "N"; then
    default_target="$PROMETHEUS_TARGET"
    CONFIGURE_PROMETHEUS="1"
    read_prompt PROMETHEUS_CTID "Prometheus CTID (required): "
    read_prompt PROMETHEUS_TARGET "smartctl target host:port [$default_target]: "
    PROMETHEUS_TARGET="${PROMETHEUS_TARGET:-$default_target}"
  else
    CONFIGURE_PROMETHEUS="0"
  fi
fi

echo ""
log_info "Platform setup summary"
echo "  PROFILE=$PLATFORM_PROFILE"
echo "  MODE=$MODE"
echo "  RUN_CORE_CONFIG=$RUN_CORE_CONFIG"
echo "  INSTALL_SMARTCTL=$INSTALL_SMARTCTL"
echo "  INSTALL_MONITORING_STACK=$INSTALL_MONITORING_STACK"
echo "  CONFIGURE_PROMETHEUS=$CONFIGURE_PROMETHEUS"
if [[ "$CONFIGURE_PROMETHEUS" == "1" ]]; then
  echo "  PROMETHEUS_CTID=$PROMETHEUS_CTID"
  echo "  PROMETHEUS_TARGET=$PROMETHEUS_TARGET"
fi
echo ""

if [[ "$RUN_CORE_CONFIG" == "1" ]]; then
  if [[ ! -x "$CONFIG_WIZARD" ]]; then
    log_err "Missing core config wizard: $CONFIG_WIZARD"
    exit 1
  fi
  log_info "Running core configuration wizard..."
  bash "$CONFIG_WIZARD" --mode "$MODE"
fi

if [[ "$INSTALL_SMARTCTL" == "1" ]]; then
  if [[ ! -x "$SMARTCTL_INSTALLER" ]]; then
    log_warn "smartctl installer not found: $SMARTCTL_INSTALLER"
  else
    log_info "Installing smartctl exporter..."
    if ! bash "$SMARTCTL_INSTALLER"; then
      log_warn "smartctl exporter installation/check failed (continuing)."
    fi
  fi
fi

if [[ "$INSTALL_MONITORING_STACK" == "1" ]]; then
  if [[ ! -x "$LOCAL_MONITORING_INSTALLER" ]]; then
    log_warn "Monitoring stack installer not found: $LOCAL_MONITORING_INSTALLER"
  else
    log_info "Installing local Prometheus + Grafana stack..."
    if ! bash "$LOCAL_MONITORING_INSTALLER" --smartctl-target "$PROMETHEUS_TARGET"; then
      log_warn "Local monitoring stack installation failed (continuing)."
    fi
  fi
fi

if [[ "$CONFIGURE_PROMETHEUS" == "1" ]]; then
  if [[ -z "$PROMETHEUS_CTID" ]]; then
    log_err "PROMETHEUS_CTID is required when CONFIGURE_PROMETHEUS=true"
    exit 1
  fi
  if [[ ! -x "$PROM_SETUP_SCRIPT" ]]; then
    log_warn "Prometheus setup script not found: $PROM_SETUP_SCRIPT"
  else
    log_info "Configuring Prometheus scrape job..."
    if ! bash "$PROM_SETUP_SCRIPT" \
      --ctid "$PROMETHEUS_CTID" \
      --target "$PROMETHEUS_TARGET" \
      --config "$PROMETHEUS_CONFIG" \
      --container "$PROMETHEUS_CONTAINER"; then
      log_warn "Prometheus scrape configuration failed (continuing)."
    fi
  fi
fi

log_ok "Platform setup completed."
