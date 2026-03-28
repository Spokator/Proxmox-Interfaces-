## Proxmox-Interfaces v1.0.19

### Features
- Added a profile-aware post-setup validator for `core`, `full`, and `pro` deployments.
- Improved setup flow to automatically run deployment validation and surface actionable outcomes.

### Details
- `scripts/validate-deployment.sh` (new)
  - Validates runtime readiness according to deployment profile.
  - Checks core API status for all profiles.
  - Adds monitoring checks for `full` profile (Prometheus/Grafana/smartctl target path).
- `deploy/setup-platform.sh`
  - Integrates post-setup validation in the platform setup flow.
- `deploy/install.sh`
  - Exposes validator usage in post-install guidance.
- `scripts/install-monitoring-stack.sh`
  - Ensures monitoring stack env/config handling remains aligned with validator checks.
- `README.md`
  - Documents validator execution and expected behavior.

### Why this matters
- Makes one-line community deployments more deterministic.
- Provides immediate, profile-specific feedback after installation.
- Reduces troubleshooting time by standardizing readiness checks.
