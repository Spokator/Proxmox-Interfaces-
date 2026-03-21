# Proxmox-Interfaces v1.0.2

Operations and reliability upgrade.

## Highlights

- Added first-run interactive environment wizard:
  - `deploy/configure-instance.sh`
- Added quick diagnostics script:
  - `deploy/diagnose.sh`
- Added support bundle export with secret redaction:
  - `deploy/support-bundle.sh`
- Hardened systemd service profile in installer:
  - `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem`, `ProtectHome`, `UMask`, bounded write paths
- Installer reliability improvement:
  - prefers `npm ci --omit=dev` when lockfile exists

## Security and support impact

- Faster incident triage with a standard diagnostics workflow
- Safer default runtime posture on installed instances
- Easier onboarding via guided first-run setup

## Artifacts

- proxmox-interfaces-v1.0.2.tar.gz
- proxmox-interfaces-v1.0.2.sha256
- proxmox-interfaces-latest.tar.gz
- proxmox-interfaces-latest.sha256

## Recommended install command

curl -fsSL https://raw.githubusercontent.com/Spokator/Proxmox-Interfaces-/v1.0.2/deploy/proxmox-interfaces-bootstrap.sh | bash -s -- --yes --artifact-url https://github.com/Spokator/Proxmox-Interfaces-/releases/download/v1.0.2/proxmox-interfaces-latest.tar.gz --artifact-sha256-url https://github.com/Spokator/Proxmox-Interfaces-/releases/download/v1.0.2/proxmox-interfaces-latest.sha256 --ctid 190 --name proxmox-interfaces-a --storage local-lvm --bridge vmbr0 --ip dhcp --cores 2 --ram 1024 --disk 12
