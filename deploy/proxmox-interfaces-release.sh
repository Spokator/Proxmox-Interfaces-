#!/usr/bin/env bash
# Build private release artifact + checksum for Proxmox-Interfaces distribution.
# Run from repository root on Linux.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${DIST_DIR:-$ROOT_DIR/dist}"
VERSION="${VERSION:-$(date +%Y.%m.%d-%H%M)}"
NAME="proxmox-interfaces-${VERSION}"
ARCHIVE="$DIST_DIR/${NAME}.tar.gz"
LATEST_ARCHIVE="$DIST_DIR/proxmox-interfaces-latest.tar.gz"
SHA_FILE="$DIST_DIR/${NAME}.sha256"
LATEST_SHA="$DIST_DIR/proxmox-interfaces-latest.sha256"

mkdir -p "$DIST_DIR"

cd "$ROOT_DIR"

echo "[INFO] Building archive: $ARCHIVE"

tar -czf "$ARCHIVE" \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='backup' \
  --exclude='data' \
  --exclude='dist' \
  --exclude='.env' \
  --exclude='.vscode' \
  .

cp "$ARCHIVE" "$LATEST_ARCHIVE"

sha256sum "$ARCHIVE" | awk '{print $1}' > "$SHA_FILE"
sha256sum "$LATEST_ARCHIVE" | awk '{print $1}' > "$LATEST_SHA"

echo "[OK] Release files generated:"
echo "  $ARCHIVE"
echo "  $SHA_FILE"
echo "  $LATEST_ARCHIVE"
echo "  $LATEST_SHA"

echo ""
echo "[INFO] Example bootstrap command (private artifact URL + checksum):"
echo "curl -fsSL https://YOUR-PUBLIC-BOOTSTRAP-URL/proxmox-interfaces-bootstrap.sh | bash -s -- --yes --artifact-url https://YOUR-PRIVATE-DISTRIBUTION/proxmox-interfaces-latest.tar.gz --artifact-sha256-url https://YOUR-PRIVATE-DISTRIBUTION/proxmox-interfaces-latest.sha256 --ctid 190 --ip dhcp"
