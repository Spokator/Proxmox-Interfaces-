## Proxmox-Interfaces v1.0.12

### Highlights
- Added dual first-run setup profiles to simplify community onboarding:
  - `auto`: default-driven setup with validation-first behavior.
  - `manual`: full field-by-field guided configuration.

### What changed
- `deploy/configure-instance.sh`
  - New `--mode auto|manual` profile selection.
  - Automatic mode pre-fills key values (port, PVE host/port/token ID, Technitium base URL/suffix) using existing `.env` and runtime context.
  - Keeps mandatory credential validation against Proxmox API with clear fallback to manual mode.
  - Added optional preseeding flags for automation scenarios.
- `deploy/install.sh`
  - Post-install wizard now asks user to choose profile: automatic (recommended) or manual.
  - Added `POST_INSTALL_PROFILE=auto|manual` to preselect profile in scripted flows.
- `README.md`
  - Documented auto/manual first-run profiles and `POST_INSTALL_PROFILE` behavior.

### Why this matters
- Community users can install faster with sensible defaults.
- Advanced users still keep full manual control.
