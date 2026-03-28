# Community Certification Matrix

This runbook certifies community deployment profiles end-to-end on a Proxmox host.

Profiles covered:
- core: app only (no embedded monitoring stack)
- full: app + local Prometheus + Grafana + smartctl exporter
- pro: app + external monitoring integration hooks

## 1) Prerequisites

- Run on a Proxmox VE host as root.
- Ensure enough free resources for 3 test CTs.
- Have release artifact URLs ready:
  - proxmox-interfaces-latest.tar.gz
  - proxmox-interfaces-latest.sha256

## 2) Execute certification

```bash
bash /opt/proxmox-interfaces/deploy/certify-community-profiles.sh \
  --artifact-url https://github.com/Spokator/Proxmox-Interfaces-/releases/latest/download/proxmox-interfaces-latest.tar.gz \
  --artifact-sha256-url https://github.com/Spokator/Proxmox-Interfaces-/releases/latest/download/proxmox-interfaces-latest.sha256 \
  --base-ctid 290 \
  --name-prefix proxmox-interfaces-cert \
  --storage local-lvm \
  --bridge vmbr0 \
  --ip dhcp \
  --cores 2 \
  --ram 2048 \
  --disk 16
```

Optional flags:
- `--profiles core,full,pro` to customize matrix
- `--destroy-existing` to recreate existing CTIDs
- `--skip-validation` to only install CTs

## 3) PASS criteria

- core profile: post-setup validator returns PASS.
- full profile: post-setup validator returns PASS, including:
  - Prometheus ready
  - Grafana health
  - provisioned datasource
  - provisioned starter dashboard
  - smartctl target present in Prometheus
- pro profile: post-setup validator returns PASS for expected profile checks.

## 4) FAIL handling

When a profile fails:
- gather logs via:
  - `pct exec <ctid> -- journalctl -u proxmox-interfaces -n 200 --no-pager`
  - `pct exec <ctid> -- bash /opt/proxmox-interfaces/deploy/diagnose.sh`
  - `pct exec <ctid> -- bash /opt/proxmox-interfaces/deploy/support-bundle.sh`
- attach evidence in PR before release tagging.

## 5) Release gate recommendation

Run this matrix before each public release tag. A release should not be tagged if any profile fails certification.
