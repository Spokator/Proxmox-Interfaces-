## Proxmox-Interfaces v1.0.18

### Features
- Full profile monitoring stack now auto-provisions Grafana datasource and starter dashboard.
- Added end-to-end readiness checks for Prometheus, Grafana, datasource and smartctl target visibility.

### Details
- `scripts/install-monitoring-stack.sh`
  - Adds Grafana provisioning files for Prometheus datasource and dashboard provider.
  - Adds starter dashboard JSON focused on smartctl exporter and Prometheus target health.
  - Extends post-install health checks to validate:
    - Prometheus ready endpoint
    - Grafana health endpoint
    - Grafana datasource existence
    - Grafana dashboard presence
    - smartctl target visibility in Prometheus
- `README.md`
  - Clarifies that `--profile full` provides auto-provisioned monitoring stack experience.

### Why this matters
- Delivers a closer one-line community deployment experience.
- Reduces manual Grafana/Prometheus setup steps for non-expert users.
- Improves confidence in first-run monitoring setup with explicit checks.
