## Proxmox-Interfaces v1.0.23

### Features
- Formalized deployment contracts by profile (`core`, `full`, `pro`) with explicit acceptance criteria.
- Added profile-aware certification reporting with exported report artifacts per profile.

### Details
- `docs/PROFILE_CONTRACTS.md`
  - New reference contract for what must be created/configured/validated in each profile.
- `deploy/certify-community-profiles.sh`
  - Adds report export support (`--report-dir`) and per-profile summaries (`failures`, `warnings`, report path).
- `scripts/validate-deployment.sh`
  - Strengthened profile checks and reporting fields used by certification.
- `docs/COMMUNITY_CERTIFICATION.md`
  - Updated runbook to include contract-based certification evidence.
- `docs/MAINTENANCE_CHECKLIST.md`
  - Adds release gate requirements tied to certification artifacts.
- `README.md`
  - Aligns public documentation with profile contract and certification workflow.

### Why this matters
- Moves community deployment from "best effort" to explicit contract validation.
- Improves reproducibility and auditability before final release decisions.
