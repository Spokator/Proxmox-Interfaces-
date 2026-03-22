## Proxmox-Interfaces v1.0.8

### Highlights
- Added an optional interactive post-install assistant in `deploy/install.sh` to launch first-run configuration directly.
- Added automatic UTF-8 locale bootstrap on minimal Debian CTs to reduce apt/perl locale warnings.
- Improved installer guidance when `.env` is incomplete so users understand why live inventory may appear empty.

### What changed
- `deploy/install.sh`
  - New `POST_INSTALL_WIZARD` mode (`auto|true|false`, default `auto`).
  - Interactive prompt at end of install (TTY-aware) to run `deploy/configure-instance.sh`.
  - Added locale initialization helper (`en_US.UTF-8`) for fresh CT compatibility.
  - Added explicit post-install message when Proxmox runtime credentials are not configured yet.
- `README.md`
  - Documented first-run wizard expectation and `POST_INSTALL_WIZARD` automation toggle.

### Notes
- Existing automated pipelines remain compatible.
- To disable any interactive prompt in scripted installs, use:
  - `POST_INSTALL_WIZARD=false bash deploy/install.sh`
