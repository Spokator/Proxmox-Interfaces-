## Proxmox-Interfaces v1.0.15

### Features
- Introduced provider-based DNS runtime architecture (`none|technitium|custom`) for auto-discovery and readiness checks.
- Added provider-neutral DNS status endpoint for audits and operations (`/api/dns/status`).
- Added DNS configuration diagnostics endpoint with actionable guidance (`/api/dns/config-check`).

### Details
- `server.js`
  - Refactors DNS index loading behind provider selection and shared cache.
  - Preserves Technitium integration while adding a generic custom provider path.
  - Adds custom provider HTTP contract support via `DNS_API_URL` (+ optional bearer token).
  - Adds runtime diagnostics and recommendations through `getDnsConfigCheck()` and `/api/dns/config-check`.
- `public/js/app.js`
  - Migration readiness now consumes provider-neutral DNS status.
  - Adds explicit health check for active DNS provider with actionable recommendation rendering.
  - Keeps strict requirement logic when Technitium is explicitly required.
- `docs/DNS_CUSTOM_PROVIDER_CONTRACT.md`
  - New contract document for custom DNS provider API payloads (`byIp`, `byDomain`, `byDomainPorts`).
- `README.md`, `.env.example`, `SUPPORT_RUNBOOK.md`
  - Updated to document provider selection, diagnostics endpoints, and operational usage.

### Why this matters
- Enables clean operation in mixed DNS environments (Technitium or non-Technitium).
- Improves troubleshooting speed with explicit provider diagnostics.
- Provides a stable contract for integrating custom DNS backends safely.
