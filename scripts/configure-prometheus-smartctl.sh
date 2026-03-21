#!/usr/bin/env bash
set -euo pipefail

CFG="/opt/monitoring/prometheus/prometheus.yml"
BAK="/opt/monitoring/prometheus/prometheus.yml.bak.$(date +%Y%m%d%H%M%S)"

pct exec 105 -- sh -lc "cp '$CFG' '$BAK'"

if pct exec 105 -- sh -lc "grep -q \"job_name: 'smartctl'\" '$CFG'"; then
  echo "Job smartctl déjà présent dans prometheus.yml"
else
  pct exec 105 -- sh -lc "cat >> '$CFG' <<'EOF'

  - job_name: 'smartctl'
    scrape_interval: 60s
    static_configs:
      - targets:
          - '192.168.8.100:9633'
EOF"
  echo "Job smartctl ajouté dans prometheus.yml"
fi

pct exec 105 -- sh -lc "docker restart prometheus >/dev/null"
sleep 3
pct exec 105 -- sh -lc "docker ps --filter name=prometheus --format '{{.Names}} {{.Status}}'"

# Vérification de la cible smartctl via API Prometheus
echo "--- Target smartctl ---"
pct exec 105 -- sh -lc "curl -fsS 'http://127.0.0.1:9090/api/v1/targets?state=any' | sed 's/},{/},\n{/g' | grep -n smartctl | head -n 5 || true"
