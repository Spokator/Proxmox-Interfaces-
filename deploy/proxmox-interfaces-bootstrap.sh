#!/usr/bin/env bash
# Proxmox-Interfaces - Public bootstrap installer (community-style)
# Designed for: public bootstrap script + private source archive.

set -euo pipefail

ARTIFACT_URL="${ARTIFACT_URL:-}"
ARTIFACT_SHA256="${ARTIFACT_SHA256:-}"
ARTIFACT_SHA256_URL="${ARTIFACT_SHA256_URL:-}"
WORKDIR="${WORKDIR:-}"
INSTALLER_REL_PATH="${INSTALLER_REL_PATH:-deploy/proxmox-easy-install.sh}"
AUTH_HEADER="${AUTH_HEADER:-}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

SILENT="0"
AUTO_YES="0"
SKIP_CHECKS="0"
LOG_FILE=""

pass_args=()
TMP_DIR=""

usage() {
  cat <<'EOF'
Proxmox-Interfaces bootstrap installer

Purpose:
  1) Download/reuse application sources
  2) Verify artifact integrity (optional but recommended)
  3) Execute deploy/proxmox-easy-install.sh with your CT parameters

Bootstrap options:
  --artifact-url <url>         Source archive (.tar.gz/.tgz)
  --artifact-sha256 <hash>     Expected SHA256 hash
  --artifact-sha256-url <url>  URL that returns SHA256 hash (first token used)
  --workdir <path>             Use local source directory already present on PVE
  --installer-path <path>      Installer path inside archive (default: deploy/proxmox-easy-install.sh)
  --auth-header <value>        Extra auth header, ex: "Authorization: Bearer <token>"
  --yes                        Non-interactive confirmation
  --silent                     Minimal output
  --skip-checks                Skip preflight checks
  --log-file <path>            Custom log path
  -h, --help                   Show this help

All other arguments are forwarded to proxmox-easy-install.sh.

Forwarded examples:
  --ctid 190 --name proxmox-interfaces-a --ip 192.168.8.190/24 --gw 192.168.8.1 --dns 192.168.8.150
  --storage local-lvm --bridge vmbr0 --cores 2 --ram 1024 --disk 12
EOF
}

info() { [[ "$SILENT" == "1" ]] || echo "[INFO] $*"; }
warn() { echo "[WARN] $*" >&2; }
err() { echo "[ERR] $*" >&2; }

cleanup() {
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

has_forwarded_flag() {
  local flag="$1"
  local x
  for x in "${pass_args[@]}"; do
    [[ "$x" == "$flag" ]] && return 0
  done
  return 1
}

get_forwarded_value() {
  local key="$1"
  local i
  for ((i = 0; i < ${#pass_args[@]}; i++)); do
    if [[ "${pass_args[$i]}" == "$key" && $((i + 1)) -lt ${#pass_args[@]} ]]; then
      echo "${pass_args[$((i + 1))]}"
      return 0
    fi
  done
  return 1
}

set_forwarded_default() {
  local key="$1"
  local value="$2"
  has_forwarded_flag "$key" || pass_args+=("$key" "$value")
}

prompt_default() {
  local label="$1"
  local default="$2"
  local out
  read -r -p "$label [$default]: " out
  [[ -z "$out" ]] && echo "$default" || echo "$out"
}

download_with_auth() {
  local url="$1"
  local out="$2"
  local -a headers=()

  if [[ -n "$AUTH_HEADER" ]]; then
    headers+=("-H" "$AUTH_HEADER")
  fi
  if [[ -n "$GITHUB_TOKEN" ]]; then
    headers+=("-H" "Authorization: Bearer ${GITHUB_TOKEN}")
  fi

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${headers[@]}" "$url" -o "$out"
    return 0
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -qO "$out" "$url"
    return 0
  fi

  return 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact-url) ARTIFACT_URL="$2"; shift 2 ;;
    --artifact-sha256) ARTIFACT_SHA256="$2"; shift 2 ;;
    --artifact-sha256-url) ARTIFACT_SHA256_URL="$2"; shift 2 ;;
    --workdir) WORKDIR="$2"; shift 2 ;;
    --installer-path) INSTALLER_REL_PATH="$2"; shift 2 ;;
    --auth-header) AUTH_HEADER="$2"; shift 2 ;;
    --yes) AUTO_YES="1"; shift ;;
    --silent) SILENT="1"; shift ;;
    --skip-checks) SKIP_CHECKS="1"; shift ;;
    --log-file) LOG_FILE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) pass_args+=("$1"); shift ;;
  esac
done

if [[ -z "$LOG_FILE" ]]; then
  LOG_FILE="/tmp/proxmox-interfaces-$(date +%Y%m%d-%H%M%S).log"
fi
exec > >(tee -a "$LOG_FILE") 2>&1

if [[ "$(id -u)" != "0" ]]; then
  err "Run as root on Proxmox host."
  exit 1
fi

if [[ "$AUTO_YES" != "1" && -t 0 && -t 1 ]]; then
  info "Interactive mode enabled."

  if [[ -z "$WORKDIR" && -z "$ARTIFACT_URL" ]]; then
    read -r -p "Use local source directory already on host? (y/N): " ans
    if [[ "${ans,,}" == "y" || "${ans,,}" == "yes" ]]; then
      WORKDIR="$(prompt_default "Project directory" "/root/Proxmox-Interfaces")"
    else
      ARTIFACT_URL="$(prompt_default "Artifact URL" "https://example.com/proxmox-interfaces-latest.tar.gz")"
      ARTIFACT_SHA256_URL="$(prompt_default "SHA256 URL (optional)" "")"
    fi
  fi

  set_forwarded_default "--ctid" "$(prompt_default "CTID" "190")"
  set_forwarded_default "--name" "$(prompt_default "Hostname" "proxmox-interfaces")"
  set_forwarded_default "--storage" "$(prompt_default "Storage" "local-lvm")"
  set_forwarded_default "--bridge" "$(prompt_default "Bridge" "vmbr0")"

  if ! has_forwarded_flag "--ip"; then
    ip_choice="$(prompt_default "Container IP (CIDR or dhcp)" "dhcp")"
    pass_args+=("--ip" "$ip_choice")
    if [[ "$ip_choice" != "dhcp" ]]; then
      set_forwarded_default "--gw" "$(prompt_default "Gateway" "192.168.8.1")"
      set_forwarded_default "--dns" "$(prompt_default "DNS" "1.1.1.1")"
    fi
  fi

  set_forwarded_default "--cores" "$(prompt_default "vCPU" "2")"
  set_forwarded_default "--ram" "$(prompt_default "RAM MB" "1024")"
  set_forwarded_default "--disk" "$(prompt_default "Disk GB" "12")"
fi

if [[ "$SKIP_CHECKS" != "1" ]]; then
  info "Running preflight checks..."
  for cmd in pct pveam pvesm ip tar find awk grep sha256sum; do
    command -v "$cmd" >/dev/null 2>&1 || { err "Missing command: $cmd"; exit 1; }
  done

  ctid="$(get_forwarded_value "--ctid" || echo "")"
  bridge="$(get_forwarded_value "--bridge" || echo "vmbr0")"
  storage="$(get_forwarded_value "--storage" || echo "local-lvm")"

  [[ -n "$ctid" ]] && pct status "$ctid" >/dev/null 2>&1 && { err "CT $ctid already exists."; exit 1; }
  ip link show "$bridge" >/dev/null 2>&1 || { err "Bridge not found: $bridge"; exit 1; }
  pvesm status | awk '{print $1}' | grep -qx "$storage" || { err "Storage not found: $storage"; exit 1; }

  if [[ -n "$WORKDIR" ]]; then
    [[ -d "$WORKDIR" ]] || { err "--workdir not found: $WORKDIR"; exit 1; }
  else
    [[ -n "$ARTIFACT_URL" ]] || { err "Missing --artifact-url (or ARTIFACT_URL env var)."; exit 1; }
  fi
fi

if [[ -n "$WORKDIR" ]]; then
  PROJECT_DIR="$WORKDIR"
else
  TMP_DIR="$(mktemp -d /tmp/proxmox-interfaces-bootstrap-XXXXXX)"
  ARCHIVE_PATH="$TMP_DIR/project.tgz"

  info "Downloading artifact..."
  download_with_auth "$ARTIFACT_URL" "$ARCHIVE_PATH" || { err "Download failed."; exit 1; }

  if [[ -n "$ARTIFACT_SHA256_URL" && -z "$ARTIFACT_SHA256" ]]; then
    SHA_FILE="$TMP_DIR/sha256.txt"
    info "Downloading SHA256 manifest..."
    download_with_auth "$ARTIFACT_SHA256_URL" "$SHA_FILE" || { err "SHA256 manifest download failed."; exit 1; }
    ARTIFACT_SHA256="$(awk '{print $1}' "$SHA_FILE" | head -n 1 | tr -d '\r\n')"
  fi

  if [[ -n "$ARTIFACT_SHA256" ]]; then
    info "Verifying artifact checksum..."
    REAL_SHA="$(sha256sum "$ARCHIVE_PATH" | awk '{print $1}')"
    if [[ "$REAL_SHA" != "$ARTIFACT_SHA256" ]]; then
      err "SHA256 mismatch. Expected=$ARTIFACT_SHA256 Got=$REAL_SHA"
      exit 1
    fi
  else
    warn "No SHA256 provided. Integrity verification skipped."
  fi

  info "Extracting artifact..."
  mkdir -p "$TMP_DIR/src"
  tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR/src"

  if [[ -f "$TMP_DIR/src/$INSTALLER_REL_PATH" ]]; then
    PROJECT_DIR="$TMP_DIR/src"
  else
    CANDIDATE="$(find "$TMP_DIR/src" -maxdepth 5 -type f -path "*/$INSTALLER_REL_PATH" | head -n 1 || true)"
    [[ -n "$CANDIDATE" ]] || { err "Installer not found: $INSTALLER_REL_PATH"; exit 1; }
    PROJECT_DIR="$(cd "$(dirname "$CANDIDATE")/.." && pwd)"
  fi
fi

INSTALLER="$PROJECT_DIR/$INSTALLER_REL_PATH"
[[ -f "$INSTALLER" ]] || { err "Installer missing: $INSTALLER"; exit 1; }

if [[ "$AUTO_YES" != "1" && -t 0 && -t 1 ]]; then
  echo ""
  echo "========== Proxmox-Interfaces =========="
  echo "Project dir : $PROJECT_DIR"
  echo "Installer   : $INSTALLER_REL_PATH"
  echo "Log file    : $LOG_FILE"
  echo "Args        : ${pass_args[*]}"
  echo "========================================"
  read -r -p "Continue installation? (y/N): " go
  if [[ "${go,,}" != "y" && "${go,,}" != "yes" ]]; then
    warn "Installation aborted by user."
    exit 0
  fi
fi

info "Running installer..."
bash "$INSTALLER" "${pass_args[@]}" --source "$PROJECT_DIR"

echo "[OK] Proxmox-Interfaces bootstrap finished."
echo "[OK] Log file: $LOG_FILE"
