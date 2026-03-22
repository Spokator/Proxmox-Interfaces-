# Proxmox-Interfaces

[![CI](https://github.com/Spokator/Proxmox-Interfaces-/actions/workflows/ci.yml/badge.svg)](https://github.com/Spokator/Proxmox-Interfaces-/actions/workflows/ci.yml)
[![Release](https://github.com/Spokator/Proxmox-Interfaces-/actions/workflows/release.yml/badge.svg)](https://github.com/Spokator/Proxmox-Interfaces-/actions/workflows/release.yml)
[![Security](https://github.com/Spokator/Proxmox-Interfaces-/actions/workflows/security.yml/badge.svg)](https://github.com/Spokator/Proxmox-Interfaces-/actions/workflows/security.yml)
[![CodeQL](https://github.com/Spokator/Proxmox-Interfaces-/actions/workflows/codeql.yml/badge.svg)](https://github.com/Spokator/Proxmox-Interfaces-/actions/workflows/codeql.yml)

Proxmox-Interfaces is an operations-focused web control plane for Proxmox environments.

Main capabilities:
- live inventory for CT/VM and exposed services,
- infrastructure visibility and migration readiness checks,
- community-style deployment for Proxmox LXC,
- practical operations tooling (diagnose, support bundle, first-run wizard).

This public repository must stay generic.
Do not commit client-specific infrastructure details.

## 1) Quickstart (Proxmox host)

Recommended model: public bootstrap + private release artifact.

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

Interactive mode:

```bash
curl -fsSL https://YOUR-PUBLIC-BOOTSTRAP/proxmox-interfaces-bootstrap.sh | bash
```

After install, inside instance:

```bash
bash /opt/proxmox-interfaces/deploy/configure-instance.sh
bash /opt/proxmox-interfaces/deploy/diagnose.sh
bash /opt/proxmox-interfaces/deploy/support-bundle.sh
```

## 2) Local development

Requirements:
- Node.js 20+

```bash
npm ci
npm run dev
```

Quality checks:

```bash
npm run ci
```

The CI command runs:
- syntax validation on `server.js`,
- smoke test against `/api/status`.

## 3) Docker deployment

```bash
cp .env.example .env
# edit .env
docker compose up -d --build
```

## 4) Release and GitHub publication

Build private artifacts (Linux):

```bash
bash deploy/proxmox-interfaces-release.sh
```

Output files in `dist/`:
- `proxmox-interfaces-latest.tar.gz`
- `proxmox-interfaces-latest.sha256`
- `proxmox-interfaces-vX.Y.Z.tar.gz`
- `proxmox-interfaces-vX.Y.Z.sha256`

Publish on GitHub:

```powershell
$env:GITHUB_TOKEN = "<token>"
./deploy/publish-github-release.ps1 -Repo "<owner>/<repo>" -Tag "vX.Y.Z" -Name "vX.Y.Z" -NotesFile ".\release-notes-vX.Y.Z.md"
./deploy/upload-release-assets.ps1 -Repo "<owner>/<repo>" -Tag "vX.Y.Z"
```

Detailed distribution model:
- `PROXMOX_INTERFACES_DISTRIBUTION.md`

## 5) Operations

- Support runbook: `SUPPORT_RUNBOOK.md`
- Quick diagnosis: `bash /opt/proxmox-interfaces/deploy/diagnose.sh`
- Support bundle export: `bash /opt/proxmox-interfaces/deploy/support-bundle.sh`

## 6) Security

- Never commit `.env`, runtime `data/`, backups, or customer runbooks.
- Always verify SHA256 checksums in production install flows.
- Keep bootstrap script public and generic; keep application artifacts private.
- See `SECURITY.md` for reporting and operational recommendations.

## 7) Project structure

- `server.js`: backend API and SPA serving
- `public/`: frontend app and static resources
- `deploy/proxmox-interfaces-bootstrap.sh`: public bootstrap entrypoint
- `deploy/proxmox-easy-install.sh`: Proxmox LXC installer
- `deploy/proxmox-interfaces-release.sh`: artifact packager
- `deploy/configure-instance.sh`: first-run `.env` wizard
- `deploy/diagnose.sh`: quick runtime diagnostics
- `deploy/support-bundle.sh`: support bundle export
- `deploy/publish-github-release.ps1`: release creation helper
- `deploy/upload-release-assets.ps1`: release assets uploader

## 8) Contributing

See `CONTRIBUTING.md`.

## 9) GitHub workflow and governance

- CI runs on push and pull request to `main`.
- Release workflow runs automatically when pushing a tag like `v1.0.3`.
- Security workflow runs npm audit and dependency review checks.
- CodeQL analyzes JavaScript code for security and quality issues.
- Issue templates are available for bug reports and feature requests.
- Pull request template enforces validation and deployment impact checks.
- Dependabot updates npm dependencies and GitHub Actions weekly.

## 10) Architecture

- Technical architecture overview: `docs/ARCHITECTURE.md`
