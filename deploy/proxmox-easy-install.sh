#!/usr/bin/env bash
# Easy installer style "community script" for Proxmox LXC
# Run on Proxmox host as root.

set -euo pipefail

CT_ID="${CT_ID:-190}"
CT_NAME="${CT_NAME:-proxmox-interfaces}"
CT_STORAGE="${CT_STORAGE:-local-lvm}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
TEMPLATE="${TEMPLATE:-debian-12-standard_12.7-1_amd64.tar.zst}"
CT_BRIDGE="${CT_BRIDGE:-vmbr0}"
CT_CORES="${CT_CORES:-2}"
CT_RAM="${CT_RAM:-1024}"
CT_SWAP="${CT_SWAP:-512}"
CT_DISK_GB="${CT_DISK_GB:-12}"
CT_IP_CIDR="${CT_IP_CIDR:-dhcp}"
CT_GATEWAY="${CT_GATEWAY:-}"
CT_DNS="${CT_DNS:-1.1.1.1}"
CT_PASSWORD="${CT_PASSWORD:-}"
APP_DIR="${APP_DIR:-/opt/proxmox-interfaces}"
SOURCE_DIR="${SOURCE_DIR:-}"
START_NOW="${START_NOW:-1}"
INSTALL_NOW="${INSTALL_NOW:-1}"

usage() {
  cat <<'EOF'
Usage:
  bash proxmox-easy-install.sh [options]

Options:
  --ctid <id>                 Container ID (default: 190)
  --name <name>               Hostname (default: proxmox-interfaces)
  --storage <storage>         Rootfs storage (default: local-lvm)
  --template-storage <store>  Template storage (default: local)
  --bridge <bridge>           Network bridge (default: vmbr0)
  --ip <cidr|dhcp>            Container IP (default: dhcp)
  --gw <ip>                   Gateway IP
  --dns <ip[,ip2]>            DNS server(s)
  --cores <n>                 vCPU count (default: 2)
  --ram <mb>                  RAM in MB (default: 1024)
  --swap <mb>                 Swap in MB (default: 512)
  --disk <gb>                 Disk size in GB (default: 12)
  --password <pwd>            Root password (optional)
  --source <path>             Source project folder on Proxmox host (required for install)
  --no-install                Create/start CT only
  --no-start                  Do not start CT after creation
  -h, --help                  Show this help

Examples:
  bash proxmox-easy-install.sh --ctid 190 --ip 10.0.0.190/24 --gw 10.0.0.1 --dns 10.0.0.53 --source /root/Proxmox-Interfaces
  CT_ID=190 CT_IP_CIDR=dhcp SOURCE_DIR=/root/Proxmox-Interfaces bash proxmox-easy-install.sh
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ctid) CT_ID="$2"; shift 2 ;;
    --name) CT_NAME="$2"; shift 2 ;;
    --storage) CT_STORAGE="$2"; shift 2 ;;
    --template-storage) TEMPLATE_STORAGE="$2"; shift 2 ;;
    --bridge) CT_BRIDGE="$2"; shift 2 ;;
    --ip) CT_IP_CIDR="$2"; shift 2 ;;
    --gw) CT_GATEWAY="$2"; shift 2 ;;
    --dns) CT_DNS="$2"; shift 2 ;;
    --cores) CT_CORES="$2"; shift 2 ;;
    --ram) CT_RAM="$2"; shift 2 ;;
    --swap) CT_SWAP="$2"; shift 2 ;;
    --disk) CT_DISK_GB="$2"; shift 2 ;;
    --password) CT_PASSWORD="$2"; shift 2 ;;
    --source) SOURCE_DIR="$2"; shift 2 ;;
    --no-install) INSTALL_NOW="0"; shift ;;
    --no-start) START_NOW="0"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if [[ "$(id -u)" != "0" ]]; then
  echo "[ERR] Run as root on Proxmox host." >&2
  exit 1
fi

if pct status "$CT_ID" >/dev/null 2>&1; then
  echo "[ERR] CT $CT_ID already exists." >&2
  exit 1
fi

if ! pveam list "$TEMPLATE_STORAGE" | grep -q "$TEMPLATE"; then
  echo "[INFO] Downloading template $TEMPLATE..."
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE"
fi

NET_ARG="name=eth0,bridge=${CT_BRIDGE},ip=${CT_IP_CIDR}"
if [[ -n "$CT_GATEWAY" && "$CT_IP_CIDR" != "dhcp" ]]; then
  NET_ARG+="\,gw=${CT_GATEWAY}"
fi

CREATE_ARGS=(
  "$CT_ID"
  "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}"
  --hostname "$CT_NAME"
  --cores "$CT_CORES"
  --memory "$CT_RAM"
  --swap "$CT_SWAP"
  --rootfs "${CT_STORAGE}:${CT_DISK_GB}"
  --net0 "$NET_ARG"
  --nameserver "$CT_DNS"
  --unprivileged 1
  --features nesting=1
  --onboot 1
)

if [[ -n "$CT_PASSWORD" ]]; then
  CREATE_ARGS+=(--password "$CT_PASSWORD")
fi

echo "[INFO] Creating CT $CT_ID ($CT_NAME)..."
pct create "${CREATE_ARGS[@]}"

if [[ "$START_NOW" == "1" ]]; then
  echo "[INFO] Starting CT $CT_ID..."
  pct start "$CT_ID"
  sleep 4
fi

if [[ "$INSTALL_NOW" == "1" ]]; then
  if [[ -z "$SOURCE_DIR" || ! -d "$SOURCE_DIR" ]]; then
    echo "[ERR] --source <path> is required for install and must exist on Proxmox host." >&2
    exit 1
  fi

  echo "[INFO] Syncing project into CT..."
  pct exec "$CT_ID" -- bash -lc "mkdir -p '${APP_DIR}'"

  TMP_ARCHIVE="/tmp/chretieno-install-${CT_ID}.tgz"
  tar -czf "$TMP_ARCHIVE" -C "$SOURCE_DIR" package.json package-lock.json server.js public deploy .env .env.example 2>/dev/null || \
  tar -czf "$TMP_ARCHIVE" -C "$SOURCE_DIR" package.json package-lock.json server.js public deploy .env.example

  pct push "$CT_ID" "$TMP_ARCHIVE" "$TMP_ARCHIVE"
  pct exec "$CT_ID" -- bash -lc "tar -xzf '$TMP_ARCHIVE' -C '${APP_DIR}' && rm -f '$TMP_ARCHIVE'"
  rm -f "$TMP_ARCHIVE"

  echo "[INFO] Installing app in CT..."
  pct exec "$CT_ID" -- bash -lc "chmod +x '${APP_DIR}/deploy/install.sh' && bash '${APP_DIR}/deploy/install.sh'"
fi

echo "[OK] Done."
echo "CT: $CT_ID"
pct status "$CT_ID" || true
