#!/usr/bin/env bash
# Community profile certification runner (Proxmox host)
# Runs end-to-end installs for core/full/pro and validates each CT.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOOTSTRAP_SCRIPT="$SCRIPT_DIR/proxmox-interfaces-bootstrap.sh"

ARTIFACT_URL="${ARTIFACT_URL:-}"
ARTIFACT_SHA256_URL="${ARTIFACT_SHA256_URL:-}"
STORAGE="${STORAGE:-local-lvm}"
BRIDGE="${BRIDGE:-vmbr0}"
IP_MODE="${IP_MODE:-dhcp}"
CORES="${CORES:-2}"
RAM_MB="${RAM_MB:-2048}"
DISK_GB="${DISK_GB:-16}"
BASE_CTID="${BASE_CTID:-290}"
NAME_PREFIX="${NAME_PREFIX:-proxmox-interfaces-cert}"
PROFILE_SET="${PROFILE_SET:-core,full,pro}"
DESTROY_EXISTING="${DESTROY_EXISTING:-0}"
SKIP_VALIDATION="${SKIP_VALIDATION:-0}"

usage() {
  cat <<'EOF'
Usage: certify-community-profiles.sh [options]

Runs a certification matrix on a Proxmox host:
  - deploys CT for each profile in PROFILE_SET
  - runs post-setup validator in each CT
  - outputs a pass/fail summary

Options:
  --artifact-url <url>            Release artifact URL (.tar.gz)
  --artifact-sha256-url <url>     SHA256 manifest URL
  --storage <name>                Proxmox storage (default: local-lvm)
  --bridge <name>                 Bridge (default: vmbr0)
  --ip <dhcp|cidr>                IP mode/value forwarded to installer (default: dhcp)
  --cores <n>                     vCPU per CT (default: 2)
  --ram <mb>                      RAM MB per CT (default: 2048)
  --disk <gb>                     Disk GB per CT (default: 16)
  --base-ctid <n>                 Base CTID (default: 290)
  --name-prefix <value>           CT name prefix (default: proxmox-interfaces-cert)
  --profiles <csv>                Profiles to run (default: core,full,pro)
  --destroy-existing              Destroy existing CTIDs before install
  --skip-validation               Only install, do not run validator
  -h, --help                      Show help
EOF
}

info() { echo "[INFO] $*"; }
ok() { echo "[OK] $*"; }
warn() { echo "[WARN] $*"; }
err() { echo "[ERR] $*" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact-url) ARTIFACT_URL="$2"; shift 2 ;;
    --artifact-sha256-url) ARTIFACT_SHA256_URL="$2"; shift 2 ;;
    --storage) STORAGE="$2"; shift 2 ;;
    --bridge) BRIDGE="$2"; shift 2 ;;
    --ip) IP_MODE="$2"; shift 2 ;;
    --cores) CORES="$2"; shift 2 ;;
    --ram) RAM_MB="$2"; shift 2 ;;
    --disk) DISK_GB="$2"; shift 2 ;;
    --base-ctid) BASE_CTID="$2"; shift 2 ;;
    --name-prefix) NAME_PREFIX="$2"; shift 2 ;;
    --profiles) PROFILE_SET="$2"; shift 2 ;;
    --destroy-existing) DESTROY_EXISTING="1"; shift ;;
    --skip-validation) SKIP_VALIDATION="1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) err "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if [[ "$(id -u)" != "0" ]]; then
  err "Run as root on Proxmox host."
  exit 1
fi

for cmd in pct pveam pvesm ip awk grep sed; do
  command -v "$cmd" >/dev/null 2>&1 || { err "Missing command: $cmd"; exit 1; }
done

[[ -x "$BOOTSTRAP_SCRIPT" ]] || { err "Bootstrap script not executable: $BOOTSTRAP_SCRIPT"; exit 1; }
[[ -n "$ARTIFACT_URL" ]] || { err "Missing --artifact-url"; exit 1; }
[[ -n "$ARTIFACT_SHA256_URL" ]] || warn "No --artifact-sha256-url provided (integrity verification in bootstrap may be weaker)."

profiles=()
IFS=',' read -r -a raw_profiles <<< "$PROFILE_SET"
for p in "${raw_profiles[@]}"; do
  n="$(echo "$p" | tr '[:upper:]' '[:lower:]' | xargs)"
  case "$n" in
    core|full|pro) profiles+=("$n") ;;
    *) err "Invalid profile in --profiles: $p"; exit 1 ;;
  esac
done

[[ "${#profiles[@]}" -gt 0 ]] || { err "No profiles to run."; exit 1; }

declare -A profile_ctid
declare -A profile_name
declare -A profile_result

index=0
for profile in "${profiles[@]}"; do
  ctid=$((BASE_CTID + index))
  name="${NAME_PREFIX}-${profile}"

  profile_ctid["$profile"]="$ctid"
  profile_name["$profile"]="$name"

  info "Profile=$profile CTID=$ctid Name=$name"

  if pct status "$ctid" >/dev/null 2>&1; then
    if [[ "$DESTROY_EXISTING" == "1" ]]; then
      warn "CT $ctid exists, destroying because --destroy-existing is set."
      pct stop "$ctid" >/dev/null 2>&1 || true
      pct destroy "$ctid" --purge >/dev/null
    else
      err "CT $ctid already exists. Use --destroy-existing or choose another --base-ctid."
      exit 1
    fi
  fi

  args=(
    --yes
    --profile "$profile"
    --artifact-url "$ARTIFACT_URL"
    --ctid "$ctid"
    --name "$name"
    --storage "$STORAGE"
    --bridge "$BRIDGE"
    --ip "$IP_MODE"
    --cores "$CORES"
    --ram "$RAM_MB"
    --disk "$DISK_GB"
  )

  if [[ -n "$ARTIFACT_SHA256_URL" ]]; then
    args+=(--artifact-sha256-url "$ARTIFACT_SHA256_URL")
  fi

  bash "$BOOTSTRAP_SCRIPT" "${args[@]}"

  if [[ "$SKIP_VALIDATION" == "1" ]]; then
    profile_result["$profile"]="SKIPPED"
    ok "Validation skipped for profile=$profile"
  else
    if pct exec "$ctid" -- bash -lc "bash /opt/proxmox-interfaces/scripts/validate-deployment.sh --profile '$profile'"; then
      profile_result["$profile"]="PASS"
      ok "Validation PASS for profile=$profile"
    else
      profile_result["$profile"]="FAIL"
      warn "Validation FAIL for profile=$profile"
    fi
  fi

  index=$((index + 1))
done

echo ""
echo "=== Certification summary ==="
failed=0
for profile in "${profiles[@]}"; do
  echo "- $profile: ${profile_result[$profile]} (ctid=${profile_ctid[$profile]}, name=${profile_name[$profile]})"
  [[ "${profile_result[$profile]}" == "FAIL" ]] && failed=$((failed + 1))
done

if [[ "$failed" -gt 0 ]]; then
  err "Certification completed with $failed failure(s)."
  exit 1
fi

ok "Certification completed successfully."
