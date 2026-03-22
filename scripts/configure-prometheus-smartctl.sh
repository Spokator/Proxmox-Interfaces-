#!/usr/bin/env bash
set -euo pipefail

CTID="${CTID:-105}"
TARGET="${TARGET:-10.0.0.10:9633}"
CFG="${CFG:-/opt/monitoring/prometheus/prometheus.yml}"
CONTAINER_NAME="${CONTAINER_NAME:-prometheus}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ctid)
      CTID="$2"
      shift 2
      ;;
    --target)
      TARGET="$2"
      shift 2
      ;;
    --config)
      CFG="$2"
      shift 2
      ;;
    --container)
      CONTAINER_NAME="$2"
      shift 2
      ;;
    -h|--help)
      cat <<'EOF'
Usage: configure-prometheus-smartctl.sh [options]

Options:
  --ctid <id>          CTID where Prometheus stack runs (default: 105)
  --target <host:port> smartctl_exporter target (default: 10.0.0.10:9633)
  --config <path>      Prometheus config path
  --container <name>   Prometheus docker container name
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

BAK="${CFG}.bak.$(date +%Y%m%d%H%M%S)"

pct exec "$CTID" -- sh -lc "cp '$CFG' '$BAK'"

if pct exec "$CTID" -- sh -lc "grep -q \"job_name: 'smartctl'\" '$CFG'"; then
  echo "Job smartctl déjà présent dans prometheus.yml"
else
  pct exec "$CTID" -- sh -lc "cat >> '$CFG' <<'EOF'

  - job_name: 'smartctl'
    scrape_interval: 60s
    static_configs:
      - targets:
          - '$TARGET'
EOF"
  echo "Job smartctl ajouté dans prometheus.yml"
fi

pct exec "$CTID" -- sh -lc "docker restart '$CONTAINER_NAME' >/dev/null"
sleep 3
pct exec "$CTID" -- sh -lc "docker ps --filter name='$CONTAINER_NAME' --format '{{.Names}} {{.Status}}'"

# Vérification de la cible smartctl via API Prometheus
echo "--- Target smartctl ---"
pct exec "$CTID" -- sh -lc "curl -fsS 'http://127.0.0.1:9090/api/v1/targets?state=any' | sed 's/},{/},\n{/g' | grep -n smartctl | head -n 5 || true"
