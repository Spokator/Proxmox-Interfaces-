## Proxmox-Interfaces v1.0.16

### Fixes
- Hardened smartctl exporter setup to avoid transient startup race failures.
- Improved platform setup resilience by making optional monitoring steps non-blocking.

### Details
- `scripts/install-smartctl-exporter.sh`
  - Replaces one-shot `/metrics` check with retry loop.
  - Prints actionable diagnostics (`systemctl status` + `journalctl`) on persistent failure.
- `deploy/setup-platform.sh`
  - Keeps full setup running if smartctl installation/check fails (warn + continue).
  - Keeps full setup running if Prometheus scrape configuration fails (warn + continue).

### Why this matters
- Reduces false negatives during first-run setup.
- Prevents optional monitoring failures from blocking core platform bootstrap.
- Improves field diagnostics when smartctl exporter startup is genuinely broken.
