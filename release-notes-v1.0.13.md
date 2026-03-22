## Proxmox-Interfaces v1.0.13

### Highlights
- Added a full platform setup orchestrator to cover core and optional operational components from one guided flow.
- Setup is now available in both automatic and manual modes to support fast onboarding and expert control.

### What changed
- `deploy/setup-platform.sh` (new)
  - Orchestrates full setup workflow in `auto` or `manual` mode.
  - Can run core app configuration wizard, smartctl exporter installation, and optional Prometheus job wiring.
  - Supports non-interactive and preseeded parameters for automation.
- `deploy/install.sh`
  - Integrates optional post-install full platform setup prompt.
  - Adds `POST_INSTALL_PLATFORM_SETUP=auto|true|false` control.
- `deploy/proxmox-easy-install.sh`
  - Includes `scripts/` in payload copied into CT so setup components are executable post-install.
- `scripts/configure-prometheus-smartctl.sh`
  - Reworked with configurable args (`--ctid`, `--target`, `--config`, `--container`) to avoid hardcoded environments.
- `deploy/configure-instance.sh`
  - Minor argument parsing robustness fix for unknown options before logger initialization.
- `README.md`
  - Documents full setup orchestrator usage and post-install controls.

### Why this matters
- Moves installation closer to an end-to-end platform bootstrap experience.
- Keeps flexibility for different infrastructures while reducing manual drift.
