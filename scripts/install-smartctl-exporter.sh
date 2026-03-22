#!/usr/bin/env bash
set -euo pipefail

apt-get update
apt-get install -y curl tar smartmontools

URL="$(curl -fsSL https://api.github.com/repos/prometheus-community/smartctl_exporter/releases/latest | sed -n 's/.*"browser_download_url": "\(https:\/\/[^\"]*linux-amd64.tar.gz\)".*/\1/p' | head -n 1)"
if [ -z "$URL" ]; then
  echo "Impossible de récupérer l'URL de la release smartctl_exporter" >&2
  exit 1
fi

rm -rf /tmp/smartctl_exporter-install
mkdir -p /tmp/smartctl_exporter-install
cd /tmp/smartctl_exporter-install
curl -fL -o smartctl_exporter.tar.gz "$URL"
tar -xzf smartctl_exporter.tar.gz
BIN="$(find . -type f -name smartctl_exporter | head -n 1)"
if [ -z "$BIN" ]; then
  echo "Binaire smartctl_exporter introuvable dans l'archive" >&2
  exit 1
fi
install -m 0755 "$BIN" /usr/local/bin/smartctl_exporter

cat >/etc/systemd/system/smartctl_exporter.service <<'EOF'
[Unit]
Description=Prometheus smartctl exporter
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=root
Group=root
ExecStart=/usr/local/bin/smartctl_exporter --web.listen-address=0.0.0.0:9633 --smartctl.path=/usr/sbin/smartctl
Restart=on-failure
RestartSec=5s
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/run /var/lib

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now smartctl_exporter

# Le service peut démarrer avec un petit délai: on attend brièvement avant de vérifier /metrics.
attempt=1
max_attempts=15
while [ "$attempt" -le "$max_attempts" ]; do
  if curl -fsS http://127.0.0.1:9633/metrics >/tmp/smartctl_exporter_metrics.txt 2>/dev/null; then
    head -n 25 /tmp/smartctl_exporter_metrics.txt
    exit 0
  fi
  sleep 2
  attempt=$((attempt + 1))
done

echo "smartctl_exporter n'a pas répondu sur 127.0.0.1:9633 après plusieurs tentatives" >&2
systemctl status --no-pager smartctl_exporter || true
journalctl -u smartctl_exporter -n 80 --no-pager || true
exit 1
