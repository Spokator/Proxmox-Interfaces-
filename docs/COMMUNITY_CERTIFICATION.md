# Community Certification Matrix

This runbook certifies community deployment profiles end-to-end on a Proxmox host.

Profiles covered:
- core: app only (no embedded monitoring stack)
- full: app + local Prometheus + Grafana + smartctl exporter
- pro: app + external monitoring integration hooks

Profile contract reference:
- `docs/PROFILE_CONTRACTS.md`

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
- `--report-dir /tmp/proxmox-interfaces-cert` to control host-side report location

Result artifacts:
- one report per profile is exported on host (`core.report`, `full.report`, `pro.report`)
- report format:
  - `profile=<name>`
  - `failures=<n>`
  - `warnings=<n>`
  - `timestamp=<iso8601>`

## 3) PASS criteria

- core profile: post-setup validator returns PASS, including API/status endpoints, Proxmox config-check, DNS status/config-check, and power route availability.
- full profile: all core checks PASS, plus:
  - smartctl exporter active and metrics reachable
  - Prometheus ready
  - Grafana health
  - provisioned datasource
  - provisioned starter dashboard
  - smartctl target present in Prometheus
- pro profile: all core checks PASS, plus:
  - smartctl exporter active and metrics reachable
  - overview endpoint available
  - watchers endpoint available

Evidence requirement:
- each selected profile must show `failures=0` in its exported report file.

## 4) FAIL handling

When a profile fails:
- gather logs via:
  - `pct exec <ctid> -- journalctl -u proxmox-interfaces -n 200 --no-pager`
  - `pct exec <ctid> -- bash /opt/proxmox-interfaces/deploy/diagnose.sh`
  - `pct exec <ctid> -- bash /opt/proxmox-interfaces/deploy/support-bundle.sh`
- attach evidence in PR before release tagging.

## 5) Release gate recommendation

Run this matrix before each public release tag. A release should not be tagged if any profile fails certification.
