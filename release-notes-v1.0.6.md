# Proxmox-Interfaces v1.0.6

Reliability patch release for community-style Proxmox CT deployment.

## Highlights

- Fixed interactive bootstrap behavior when launched with pipe syntax:
  - `curl ... | bash` now keeps interactive prompts available.

- Improved Debian template compatibility in CT installer:
  - if the default Debian 12 template is unavailable, installer auto-detects and uses the latest available Debian 12 template.

- Hardened first-run data initialization:
  - `public/data/services.json` is auto-created if missing,
  - prevents HTTP 500 on `/api/status` caused by missing service catalog file.

## Operational impact

- Better out-of-the-box behavior on fresh Proxmox nodes.
- Fewer installation interruptions due to template drift.
- Safer startup even if release artifact misses optional static data file.

## Artifacts

- proxmox-interfaces-v1.0.6.tar.gz
- proxmox-interfaces-v1.0.6.sha256
- proxmox-interfaces-latest.tar.gz
- proxmox-interfaces-latest.sha256
