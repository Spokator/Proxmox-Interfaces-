## Proxmox-Interfaces v1.0.22

### Fixes
- Certification runner no longer requires executable permission bit on bootstrap script.

### Details
- `deploy/certify-community-profiles.sh`
  - Uses explicit `bash <script>` invocation for bootstrap execution.
  - Avoids false failures on environments where executable bit or mount permissions differ.

### Why this matters
- Improves reliability of final certification runs on heterogeneous Proxmox hosts.
- Reduces friction during non-interactive QA gates before release.
