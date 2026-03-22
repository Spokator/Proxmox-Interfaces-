## Proxmox-Interfaces v1.0.10

### Fixes
- Fixed first-run wizard prompt handling in `deploy/configure-instance.sh` for piped/bootstrap and `pct exec` contexts.
- Prompts now render reliably and accept input consistently when stdin/tty behavior differs.

### Details
- Replaced low-level prompt reads with robust prompt helpers using `read -p` / `read -s -p`.
- Added safer fallback behavior when no direct tty is attached.

### Impact
- Prevents perceived wizard "freeze" right after banner display.
- Keeps guided credential validation flow introduced in v1.0.9.
