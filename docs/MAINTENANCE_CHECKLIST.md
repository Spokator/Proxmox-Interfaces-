# Maintenance Checklist

Use this checklist at least once per month and before each public release.

## A) Monthly maintenance (30-45 min)

1. Verify GitHub repository health
- Confirm `main` branch is still protected.
- Confirm no critical warning appears on repository home.
- Confirm latest release page is accessible.

2. Verify GitHub Actions health
- Check recent `CI` runs are green.
- Check `Security` workflow is green (`npm-audit` at minimum).
- Check `CodeQL` has no new alerts.

3. Review dependency updates
- Review open Dependabot pull requests.
- Merge safe patch/minor updates after checks pass.

4. Run local quality gate
- Run `npm run ci` locally.
- Confirm smoke test passes on `/api/status`.

5. Verify Proxmox deployment path
- Re-check bootstrap command in docs.
- Confirm installer defaults are still safe (`--system-upgrade` and `--manage-ufw` are opt-in).
- Confirm docs match actual installer behavior.

6. Verify release pipeline
- Confirm semantic version and tag policy are still respected.
- Confirm release workflow remains green on latest tag.
- Confirm 4 expected assets are published per release.

7. Verify documentation quality
- Confirm README quickstart still works as written.
- Confirm architecture and support docs are still current.
- Remove stale examples and placeholders.

8. Verify repository security hygiene
- Ensure no secrets, tokens, or customer data are committed.
- Ensure `.env`, runtime data, and backups stay ignored.
- Confirm security policy remains accurate.

9. Verify operations tooling
- Confirm `deploy/diagnose.sh` is still usable.
- Confirm `deploy/support-bundle.sh` still produces useful output.
- Confirm runbook commands still match current scripts.

10. Plan next iteration (keep focus)
- Pick 1 product improvement.
- Pick 1 operations improvement.
- Pick 1 security/governance improvement.
- Defer non-critical ideas to backlog.

## B) Mandatory pre-release gate (quick)

Run this sequence for every release:

1. Local validation
- `npm run ci`

2. Version and notes
- Confirm `package.json` version is correct.
- Ensure `release-notes-vX.Y.Z.md` exists and is complete.

3. Release publication check
- Confirm tag `vX.Y.Z` exists.
- Confirm release `vX.Y.Z` is created.
- Confirm these assets exist:
  - `proxmox-interfaces-vX.Y.Z.tar.gz`
  - `proxmox-interfaces-vX.Y.Z.sha256`
  - `proxmox-interfaces-latest.tar.gz`
  - `proxmox-interfaces-latest.sha256`

4. Governance check
- Confirm `main` branch protection is active.
- Confirm required status checks are still configured.

5. Documentation check
- Update README only if behavior changed.
- Keep installation command examples aligned with reality.

## C) Solo maintainer safe branch rule profile

If you are the only maintainer, use this to avoid self-blocking:

Enable:
- Require pull request before merging
- Require status checks to pass
- Require branches to be up to date
- Require conversation resolution
- Require linear history
- Do not allow bypassing

Disable for solo mode:
- Require approvals
- Require review from Code Owners
- Require approval of most recent reviewable push

Required checks:
- `CI / test (pull_request)`
- `Security / npm-audit (pull_request)`
- `CodeQL / Analyze (javascript) (pull_request)`

Optional/non-required:
- `Security / dependency-review (pull_request)`
- `Code scanning results / CodeQL`
