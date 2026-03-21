# Proxmox-Interfaces v1.0.1

Sanitized public baseline.

## Highlights

- Final public sanitization applied across docs, scripts, UI labels, and examples
- Generic network/demo values replaced internal references
- Proxmox-Interfaces naming normalized in deployment and compose files
- Release publishing scripts hardened for safer reuse

## Security posture

- Public repository contains generic examples only
- Customer-specific runbooks and internal data removed
- Recommended model remains: public bootstrap + private artifact + SHA256 verification

## Artifacts

- proxmox-interfaces-v1.0.1.tar.gz
- proxmox-interfaces-v1.0.1.sha256
- proxmox-interfaces-latest.tar.gz
- proxmox-interfaces-latest.sha256

## Install example (non-interactive)

curl -fsSL https://raw.githubusercontent.com/Spokator/Proxmox-Interfaces-/v1.0.1/deploy/proxmox-interfaces-bootstrap.sh | bash -s -- --yes --artifact-url https://YOUR-PRIVATE-DIST/proxmox-interfaces-latest.tar.gz --artifact-sha256-url https://YOUR-PRIVATE-DIST/proxmox-interfaces-latest.sha256 --ctid 190 --name proxmox-interfaces-a --storage local-lvm --bridge vmbr0 --ip dhcp --cores 2 --ram 1024 --disk 12
