## Proxmox-Interfaces v1.0.20

### Features
- Adds an automated community certification runner for deployment profiles (`core`, `full`, `pro`).
- Adds a dedicated certification runbook with GO/NO-GO criteria.

### Details
- `deploy/certify-community-profiles.sh`
  - New host-side runner that executes profile certification flows in sequence.
  - Produces profile-specific summaries and a final certification verdict.
- `docs/COMMUNITY_CERTIFICATION.md`
  - New operations guide for running and interpreting certification campaigns.
- `deploy/install.sh`
  - Includes the certification script in executable setup and post-install useful commands.
- `README.md`
  - Documents certification usage and expected validation flow.
- `docs/MAINTENANCE_CHECKLIST.md`
  - Adds profile certification checks to the maintenance/release gate.

### Why this matters
- Makes community deployment quality verifiable and repeatable.
- Reduces uncertainty before publishing releases and helper scripts.
- Moves the project closer to a reliable one-line “community script” experience.
