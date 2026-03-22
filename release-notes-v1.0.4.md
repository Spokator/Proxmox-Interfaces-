# Proxmox-Interfaces v1.0.4

Consolidation release focused on reliability, governance, and safer installation defaults.

## Highlights

- Strengthened project governance on GitHub:
  - CI workflow on push/pull request
  - automated release workflow on `v*` tags
  - Dependabot updates for npm and Actions
  - issue templates and pull request template
  - CODEOWNERS support

- Added security automation:
  - npm audit workflow
  - dependency review on pull requests
  - CodeQL analysis workflow

- Improved onboarding and maintainability:
  - expanded README with release/governance details
  - architecture documentation in `docs/ARCHITECTURE.md`
  - contributor and security policy docs

- Safer Proxmox installation behavior by default:
  - system upgrade is now opt-in (`--system-upgrade`)
  - UFW management is now opt-in (`--manage-ufw`)
  - branch protection setup script added for repositories with admin token rights

## Artifacts

- proxmox-interfaces-v1.0.4.tar.gz
- proxmox-interfaces-v1.0.4.sha256
- proxmox-interfaces-latest.tar.gz
- proxmox-interfaces-latest.sha256

## Notes

- Main branch protection can be configured with:
  - `deploy/set-branch-protection.ps1`
- This operation requires a GitHub token with repository admin privileges.
