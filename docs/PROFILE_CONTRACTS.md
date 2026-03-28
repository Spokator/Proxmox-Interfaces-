# Profile Contracts (core/full/pro)

This document defines the expected behavior for each community deployment profile.

## Core profile contract

Required:
- App API healthy via nginx (`/api/status`)
- App API healthy via node (`:3000/api/status`)
- Proxmox config endpoint available (`/api/proxmox/config-check`)
- DNS endpoints available:
  - `/api/dns/status`
  - `/api/dns/config-check`
- Power API route present (`/api/proxmox/guests/:type/:vmid/power`)

Optional:
- `smartctl_exporter` may be absent
- local Prometheus/Grafana stack is not required

## Full profile contract

Includes all Core requirements, plus:
- `smartctl_exporter` service active
- `smartctl_exporter` metrics reachable on `:9633/metrics`
- Prometheus ready on `:9090/-/ready`
- Grafana health on `:3001/api/health`
- Grafana datasource provisioned: `ProxmoxInterfacesPrometheus`
- Grafana starter dashboard provisioned: `proxmox-interfaces-overview`
- Prometheus targets include `smartctl`

## Pro profile contract

Includes all Core requirements, plus:
- `smartctl_exporter` service active
- `smartctl_exporter` metrics reachable on `:9633/metrics`
- Overview endpoint available (`/api/overview`)
- Watchers endpoint available (`/api/proxmox/watchers`)

Notes:
- Pro profile does not require local Prometheus/Grafana by contract.
- Pro integrations can target external monitoring systems.

## Validation command

Run inside installed instance:

```bash
bash /opt/proxmox-interfaces/scripts/validate-deployment.sh --profile core
bash /opt/proxmox-interfaces/scripts/validate-deployment.sh --profile full
bash /opt/proxmox-interfaces/scripts/validate-deployment.sh --profile pro
```

Optional report output:

```bash
bash /opt/proxmox-interfaces/scripts/validate-deployment.sh --profile full --report-file /tmp/validate-full.report
```
