## Proxmox-Interfaces v1.0.17

### Features
- Added community deployment profiles to support one-line installation strategies:
  - `core`: lightweight app-only profile
  - `full`: app + local monitoring stack (Prometheus + Grafana)
  - `pro`: app profile compatible with external monitoring integration workflows

### Details
- `deploy/proxmox-interfaces-bootstrap.sh`
  - Adds profile selection and forwards it through installation chain.
- `deploy/proxmox-easy-install.sh`
  - Propagates selected profile into CT runtime install step.
- `deploy/install.sh`
  - Integrates profile-driven post-install behavior.
- `deploy/setup-platform.sh`
  - Adds profile-aware defaults and monitoring setup controls.
  - Keeps optional monitoring steps resilient.
- `scripts/install-monitoring-stack.sh` (new)
  - Installs local Prometheus/Grafana stack for `full` profile.
  - Prepares scrape wiring and service registration for community-ready full stack setup.
- `README.md`
  - Documents `core/full/pro` profile behavior and usage.

### Why this matters
- Improves community onboarding with a clearer deployment model.
- Enables one-command full-stack experience when desired.
- Preserves a lightweight default for users who do not need bundled monitoring.
