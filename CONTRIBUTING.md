# Contributing

Thank you for contributing to Proxmox-Interfaces.

## Development setup

1. Install Node.js 20+
2. Install dependencies:

```bash
npm ci
```

3. Start in development mode:

```bash
npm run dev
```

## Quality checks

Before opening a PR, run:

```bash
npm run ci
```

This validates:
- server syntax (`node --check`)
- a smoke test against `/api/status`

## Pull request guidelines

- Keep PRs focused and small when possible.
- Describe behavior changes and migration impact.
- Update documentation when user-facing behavior changes.
- Never commit secrets or client-specific infrastructure data.

## Release process

- Build release artifacts with `deploy/proxmox-interfaces-release.sh`
- Publish GitHub release and upload assets with scripts in `deploy/`
