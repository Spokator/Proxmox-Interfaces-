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

Deployment profiles:
- `--profile core` (default): app only, no embedded monitoring stack.
- `--profile full`: app + local Prometheus + Grafana in the same CT, with Grafana datasource/dashboard pre-provisioned.
- `--profile pro`: app CT + external monitoring integration hooks.

```bash
curl -fsSL https://YOUR-PUBLIC-BOOTSTRAP/proxmox-interfaces-bootstrap.sh | bash -s -- \
  --yes \
  --profile core \
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

Production hardening options:
- add `--system-upgrade` to run apt upgrade inside the CT,
- add `--manage-ufw` to apply UFW rules inside the CT.

Example:

```bash
curl -fsSL https://YOUR-PUBLIC-BOOTSTRAP/proxmox-interfaces-bootstrap.sh | bash -s -- \
  --yes \
  --artifact-url https://YOUR-PRIVATE-DIST/proxmox-interfaces-latest.tar.gz \
  --artifact-sha256-url https://YOUR-PRIVATE-DIST/proxmox-interfaces-latest.sha256 \
  --ctid 190 --name proxmox-interfaces-a --storage local-lvm --bridge vmbr0 --ip dhcp \
  --cores 2 --ram 1024 --disk 12 \
  --system-upgrade --manage-ufw
```

Community helper-style one-liner (full stack in one CT):

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Spokator/Proxmox-Interfaces-/main/deploy/community-install.sh)" -- \
  --yes \
  --profile full \
  --ctid 190 --name proxmox-interfaces-full --storage local-lvm --bridge vmbr0 --ip dhcp \
  --cores 2 --ram 2048 --disk 16
```

Interactive mode:

```bash
curl -fsSL https://YOUR-PUBLIC-BOOTSTRAP/proxmox-interfaces-bootstrap.sh | bash
```

After install, inside instance:

```bash
bash /opt/proxmox-interfaces/deploy/configure-instance.sh
bash /opt/proxmox-interfaces/deploy/setup-platform.sh
bash /opt/proxmox-interfaces/deploy/diagnose.sh
bash /opt/proxmox-interfaces/deploy/support-bundle.sh
```

Important:
- run `configure-instance.sh` right after install to set `PVE_HOST`, `PVE_TOKEN_ID`, and `PVE_TOKEN_SECRET`.
- `PVE_TOKEN_ID` must be in token format `user@realm!tokenname` (example: `api-user@pve!proxmox-interfaces`).
- without this step, the web UI starts correctly but live Proxmox inventory and auto-discovered services remain empty.
- at the end of `deploy/install.sh`, an interactive prompt can launch this wizard automatically.
- for automation, control this behavior with `POST_INSTALL_WIZARD=auto|true|false` (default: `auto`).
- the wizard now validates Proxmox credentials against the API before restarting the service (with explicit confirmation required to skip).
- the wizard now supports two profiles: `--mode auto` (recommended defaults + validation) and `--mode manual` (full field-by-field input).
- you can preselect post-install profile with `POST_INSTALL_PROFILE=auto|manual` (default: `auto`).
- DNS setup in the wizard is provider-based (`none|technitium|custom`) so environments without Technitium can still be configured cleanly.
- runtime DNS auto-discovery now uses a provider selector: `DNS_PROVIDER=none|technitium|custom`.
- provider fallback is backward-compatible: if `DNS_PROVIDER` is unset and `TECHNITIUM_*` is present, Technitium is used automatically.
- generic DNS status endpoint is available at `/api/dns/status` for readiness/audit checks.
- DNS provider diagnostics endpoint is available at `/api/dns/config-check`.
- for `DNS_PROVIDER=custom`, `DNS_API_URL` must return JSON in this shape:
  - `{"byIp":{"10.0.0.20":["svc-a.internal"]},"byDomain":{"svc-a.internal":["10.0.0.20"]},"byDomainPorts":{"svc-a.internal":[80,443]}}`
- full custom provider contract: `docs/DNS_CUSTOM_PROVIDER_CONTRACT.md`.
- a full setup orchestrator is available with `deploy/setup-platform.sh` (core config + optional monitoring stack hooks).
- `deploy/setup-platform.sh` now supports `--profile core|full|pro` and `--install-monitoring-stack auto|true|false`.
- in `--profile full`, Grafana is auto-provisioned with Prometheus datasource and a starter dashboard.
- control full setup prompt with `POST_INSTALL_PLATFORM_SETUP=auto|true|false` (default: `auto`).

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
- `deploy/setup-platform.sh`: complete platform setup orchestrator (auto/manual)
- `deploy/diagnose.sh`: quick runtime diagnostics
- `deploy/support-bundle.sh`: support bundle export
- `scripts/install-monitoring-stack.sh`: local Prometheus + Grafana stack installer (profile `full`)
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

Dependency review note:
- `dependency-review` runs only if repository variable `ENABLE_DEPENDENCY_REVIEW=true`.
- Enable it after turning on Dependency graph in repository security settings.

## 10) Architecture

- Technical architecture overview: `docs/ARCHITECTURE.md`

## 11) Maintenance checklist

- Operational maintenance checklist: `docs/MAINTENANCE_CHECKLIST.md`

## 12) Main branch protection

This repository should keep `main` protected.

Current goal:
- no force-push on `main`,
- no branch deletion,
- pull request reviews required,
- required status checks before merge.

Automated setup script:

```powershell
$env:GITHUB_TOKEN = "<admin-token>"
./deploy/set-branch-protection.ps1 -Repo "Spokator/Proxmox-Interfaces-" -Branch "main"
```

Dry-run verification:

```powershell
./deploy/set-branch-protection.ps1 -Repo "Spokator/Proxmox-Interfaces-" -Branch "main" -CheckOnly
```

Default required checks configured by the script:
- `test`
- `npm-audit`
- `Analyze`

Notes:
- The token must have repository admin rights to configure branch protection.
- For fine-grained PAT, repository permission `Administration: Read and write` is required.
- If your token is read/write only (without admin scope), GitHub API returns 403.
