## Proxmox-Interfaces v1.0.14

### Fixes
- Improved Proxmox wizard validation to prevent malformed API auth headers.
- Improved automatic mode defaults to avoid selecting incorrect Proxmox host values.
- Added DNS provider flexibility in wizard (`none|technitium|custom`) for broader environments.

### Details
- `deploy/configure-instance.sh`
  - Enforces/assists proper `PVE_TOKEN_ID` format (`user@realm!tokenname`).
  - Handles token-name completion when user only provides `user@realm`.
  - Sanitizes user input to avoid hidden newline/carriage-return issues.
  - Improves API validation HTTP code handling for connection failures.
  - Adds provider-based DNS setup (`none`, `technitium`, `custom`).
  - Persists generic DNS settings: `DNS_PROVIDER`, `DNS_API_URL`, `DNS_API_TOKEN`.
- `.env.example`
  - Documents new generic DNS settings.
- `README.md`
  - Clarifies token format and provider-based DNS setup.

### Why this matters
- Reduces setup failures in heterogeneous infrastructures.
- Better supports non-Technitium DNS ecosystems.
