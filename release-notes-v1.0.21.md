## Proxmox-Interfaces v1.0.21

### Fixes
- Hardened non-interactive installation flow to prevent `/dev/tty` wizard blocking during automated deployments and certification runs.
- Improved monitoring stack robustness for community profile validation.
- Reduced false negatives in deployment validation for the `pro` profile.

### Details
- `deploy/install.sh`
  - Better non-interactive/TTY handling in post-install setup prompts.
  - Safer fallback behavior when interactive input is unavailable.
- `deploy/proxmox-easy-install.sh`
  - Explicit propagation of post-install wizard mode for automated flows.
- `scripts/install-monitoring-stack.sh`
  - Better Docker Compose compatibility/fallback handling.
  - Additional hardening around Grafana startup/provisioning checks.
- `scripts/validate-deployment.sh`
  - More reliable `pro` profile checks for monitoring components.

### Why this matters
- Makes one-line community deployments more deterministic in real automation contexts.
- Improves final certification reliability for `core/full/pro` profiles.
