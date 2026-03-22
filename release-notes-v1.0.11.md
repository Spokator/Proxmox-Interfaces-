## Proxmox-Interfaces v1.0.11

### Fixes
- Fixed first-run wizard crash when pressing Enter on default prompts with `set -u` enabled.
- Default values (for example `App port [3000]`) now work correctly when left empty.

### Context
- This patch follows v1.0.10 wizard prompt reliability improvements.
- Goal: make guided installation resilient for community users with minimal friction.

### Technical change
- `deploy/configure-instance.sh`
  - Prompt capture logic no longer leaves variables uninitialized in empty-input paths.
