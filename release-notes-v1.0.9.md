## Proxmox-Interfaces v1.0.9

### Highlights
- First-run configuration wizard is now more guided and safer for community installs.
- Proxmox credentials are validated against the API before service restart.

### What changed
- `deploy/configure-instance.sh`
  - Reuses existing `.env` values as defaults when re-running the wizard.
  - Adds interactive configuration summary before save.
  - Adds live Proxmox API validation (`/api2/json/version`) using token auth.
  - Requires explicit confirmation to continue when validation fails or is skipped.
  - Keeps guided flow before restarting `proxmox-interfaces` service.
- `README.md`
  - Documents credential validation behavior in first-run setup section.

### Operational notes
- This keeps automated installation paths compatible.
- For fastest onboarding after install, keep `POST_INSTALL_WIZARD=auto` or `true`.
