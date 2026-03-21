# Proxmox-Interfaces v1.0.0

Initial public baseline for Proxmox-Interfaces.

## Included

- Community-style bootstrap installer for Proxmox LXC
- Private artifact distribution model (public bootstrap + private tarball)
- SHA256 verification in bootstrap flow
- Proxmox-Interfaces migration and readiness module in Admin UI
- Docker deployment files (Dockerfile + docker-compose)
- Public repository sanitization (no customer-specific runbooks/docs)

## Security model

- Public: bootstrap script only
- Private: application artifact tar.gz + sha256
- Integrity: SHA256 check before install

## Artifacts

- proxmox-interfaces-v1.0.0.tar.gz
- proxmox-interfaces-v1.0.0.sha256
- proxmox-interfaces-latest.tar.gz
- proxmox-interfaces-latest.sha256

## Install example (non-interactive)

curl -fsSL https://raw.githubusercontent.com/Spokator/Proxmox-Interfaces-/v1.0.0/deploy/proxmox-interfaces-bootstrap.sh | bash -s -- --yes --artifact-url https://YOUR-PRIVATE-DIST/proxmox-interfaces-latest.tar.gz --artifact-sha256-url https://YOUR-PRIVATE-DIST/proxmox-interfaces-latest.sha256 --ctid 190 --name proxmox-interfaces-a --storage local-lvm --bridge vmbr0 --ip dhcp --cores 2 --ram 1024 --disk 12
