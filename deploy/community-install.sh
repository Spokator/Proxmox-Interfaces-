#!/usr/bin/env bash
# Backward-compatible wrapper.
# Use deploy/proxmox-interfaces-bootstrap.sh for the production entrypoint.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/proxmox-interfaces-bootstrap.sh" "$@"
