# Proxmox-Interfaces

Proxmox-Interfaces is a web control plane for Proxmox environments:
- live inventory of CT/VM,
- infrastructure and service visibility,
- migration readiness checks,
- community-style deployment scripts.

This public repository contains generic examples only.
No client-specific infrastructure details should be committed.

## Quick install on Proxmox (community-style)

### Public bootstrap + private artifact (recommended)

```bash
curl -fsSL https://YOUR-PUBLIC-BOOTSTRAP/proxmox-interfaces-bootstrap.sh | bash -s -- \
  --yes \
  --artifact-url https://YOUR-PRIVATE-DIST/proxmox-interfaces-latest.tar.gz \
  --artifact-sha256-url https://YOUR-PRIVATE-DIST/proxmox-interfaces-latest.sha256 \
  --ctid 190 \
  --name proxmox-interfaces-a \
  --storage local-lvm \
  --bridge vmbr0 \
  --ip dhcp \
  --cores 2 \
  --ram 1024 \
  --disk 12
```

### Interactive helper mode

```bash
curl -fsSL https://YOUR-PUBLIC-BOOTSTRAP/proxmox-interfaces-bootstrap.sh | bash
```

### First-run configuration (inside installed instance)

After deployment, run the guided environment wizard:

```bash
bash /opt/proxmox-interfaces/deploy/configure-instance.sh
```

Useful runtime commands:

```bash
bash /opt/proxmox-interfaces/deploy/diagnose.sh
bash /opt/proxmox-interfaces/deploy/support-bundle.sh
```

## Build private artifacts

Run on Linux from repository root:

```bash
bash deploy/proxmox-interfaces-release.sh
```

Outputs in `dist/`:
- `proxmox-interfaces-latest.tar.gz`
- `proxmox-interfaces-latest.sha256`
- versioned artifact and checksum

## Docker deployment

```bash
cp .env.example .env
# edit .env

docker compose up -d --build
```

## Security notes

- Do not commit `.env`, runtime `data/`, backups, or customer runbooks.
- Prefer private artifact distribution with checksum verification.
- Keep bootstrap script public and generic; keep source artifacts private.

## Operations

- Runtime support guide: `SUPPORT_RUNBOOK.md`
- Quick diagnosis: `bash /opt/proxmox-interfaces/deploy/diagnose.sh`
- Bundle export: `bash /opt/proxmox-interfaces/deploy/support-bundle.sh`

## Repository structure

- `server.js`: backend API
- `public/`: frontend SPA
- `deploy/proxmox-interfaces-bootstrap.sh`: production bootstrap entrypoint
- `deploy/proxmox-easy-install.sh`: LXC installer
- `deploy/proxmox-interfaces-release.sh`: artifact packager
- `deploy/configure-instance.sh`: first-run `.env` wizard
- `deploy/diagnose.sh`: quick runtime diagnostics
- `deploy/support-bundle.sh`: support bundle export
- `PROXMOX_INTERFACES_DISTRIBUTION.md`: private distribution model
