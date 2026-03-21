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
systemctl is-active smartctl_exporter
curl -fsS http://127.0.0.1:9633/metrics | head -n 25
