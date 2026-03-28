#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/proxmox-interfaces}"
MONITORING_DIR="${MONITORING_DIR:-/opt/monitoring}"
STACK_DIR="${STACK_DIR:-$MONITORING_DIR/stack}"
PROM_DIR="${PROM_DIR:-$MONITORING_DIR/prometheus}"
GRAFANA_DIR="${GRAFANA_DIR:-$MONITORING_DIR/grafana}"
SMARTCTL_TARGET="${SMARTCTL_TARGET:-$(hostname -I 2>/dev/null | awk '{print $1}'):9633}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --smartctl-target)
      SMARTCTL_TARGET="$2"
      shift 2
      ;;
    --monitoring-dir)
      MONITORING_DIR="$2"
      STACK_DIR="$MONITORING_DIR/stack"
      PROM_DIR="$MONITORING_DIR/prometheus"
      GRAFANA_DIR="$MONITORING_DIR/grafana"
      shift 2
      ;;
    -h|--help)
      cat <<'EOF'
Usage: install-monitoring-stack.sh [options]

Options:
  --smartctl-target <host:port>  smartctl exporter target (default: CT_IP:9633)
  --monitoring-dir <path>        Base monitoring directory (default: /opt/monitoring)
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "$(id -u)" != "0" ]]; then
  echo "[ERR] Run as root." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl docker.io docker-compose-plugin

systemctl enable docker >/dev/null 2>&1 || true
systemctl restart docker
sleep 2

mkdir -p "$STACK_DIR" "$PROM_DIR" "$GRAFANA_DIR/data"

cat > "$PROM_DIR/prometheus.yml" <<EOF
global:
  scrape_interval: 30s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['prometheus:9090']

  - job_name: 'smartctl'
    scrape_interval: 60s
    static_configs:
      - targets: ['${SMARTCTL_TARGET}']
EOF

cat > "$STACK_DIR/docker-compose.yml" <<'EOF'
services:
  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    restart: unless-stopped
    volumes:
      - ../prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus-data:/prometheus
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    restart: unless-stopped
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_USERS_ALLOW_SIGN_UP=false
    volumes:
      - ../grafana/data:/var/lib/grafana
    ports:
      - "3001:3000"
    depends_on:
      - prometheus

volumes:
  prometheus-data:
EOF

cd "$STACK_DIR"
docker compose up -d

for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:9090/-/ready >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! curl -fsS http://127.0.0.1:9090/-/ready >/dev/null 2>&1; then
  echo "[WARN] Prometheus not ready on 127.0.0.1:9090" >&2
fi
if ! curl -fsS http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
  echo "[WARN] Grafana not ready on 127.0.0.1:3001" >&2
fi

if [[ -f "$APP_DIR/public/data/services.json" ]]; then
  APP_DIR="$APP_DIR" HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')" node <<'EOF'
const fs = require('fs');
const path = process.env.APP_DIR || '/opt/proxmox-interfaces';
const file = `${path}/public/data/services.json`;
const hostIp = (process.env.HOST_IP || '').trim();

try {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data.services)) data.services = [];

  const upsert = (svc) => {
    const idx = data.services.findIndex((s) => s.id === svc.id);
    if (idx >= 0) data.services[idx] = { ...data.services[idx], ...svc };
    else data.services.push(svc);
  };

  upsert({
    id: 'prometheus',
    name: 'Prometheus',
    category: 'monitoring',
    description: 'Prometheus metrics backend',
    url: hostIp ? `http://${hostIp}:9090` : 'http://127.0.0.1:9090',
    domain: hostIp ? `http://${hostIp}:9090` : 'http://127.0.0.1:9090',
    ip: hostIp || '127.0.0.1',
    port: 9090,
    protocol: 'http',
    icon: 'activity',
    tags: ['monitoring', 'prometheus', 'auto'],
    status: 'unknown',
    favorite: false,
  });

  upsert({
    id: 'grafana',
    name: 'Grafana',
    category: 'monitoring',
    description: 'Grafana dashboards',
    url: hostIp ? `http://${hostIp}:3001` : 'http://127.0.0.1:3001',
    domain: hostIp ? `http://${hostIp}:3001` : 'http://127.0.0.1:3001',
    ip: hostIp || '127.0.0.1',
    port: 3001,
    protocol: 'http',
    icon: 'bar-chart-2',
    tags: ['monitoring', 'grafana', 'auto'],
    status: 'unknown',
    favorite: false,
  });

  fs.writeFileSync(file, JSON.stringify(data, null, 2));
} catch (e) {
  console.error(`[WARN] Failed to register monitoring services: ${e.message}`);
}
EOF
fi

echo "[OK] Monitoring stack installed"
echo "[OK] Prometheus: http://127.0.0.1:9090"
echo "[OK] Grafana:    http://127.0.0.1:3001 (admin/admin)"
echo "[INFO] smartctl target configured: $SMARTCTL_TARGET"
