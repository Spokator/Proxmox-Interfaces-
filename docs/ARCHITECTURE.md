# Architecture

## Overview

Proxmox-Interfaces is a Node.js + Express control plane exposing:
- a REST API for infrastructure and operational data,
- a static frontend SPA served by the backend,
- deployment and operations scripts for Proxmox and Docker.

## Runtime components

1. Backend API (`server.js`)
- Serves static frontend assets from `public/`
- Exposes operational endpoints (`/api/*`)
- Aggregates local service definitions and live infrastructure signals
- Stores mutable state in `data/`

2. Frontend SPA (`public/`)
- Operator dashboard and migration-readiness workflows
- Reads data from backend endpoints and renders operational state

3. Deployment scripts (`deploy/`)
- Proxmox bootstrap + LXC install flows
- Release packaging and GitHub release upload helpers
- Instance diagnostics and support bundle generation

## Data model and persistence

Persistent files under `data/` include:
- notes and changelog
- cached health results
- automation/watcher state

Design intent:
- keep state lightweight and transparent,
- avoid external DB requirements for first deployment,
- support easy backup and support extraction.

## Deployment patterns

1. Proxmox (recommended)
- Public bootstrap script
- Private tarball artifacts with SHA256 verification
- LXC instance installation with systemd service hardening

2. Docker
- Single service deployment via `docker-compose.yml`
- Runtime data persisted through mounted `data/`

## Security model

- Secrets are externalized via `.env`
- Public repository must remain free of client-specific data
- SHA256 integrity checks are recommended for all artifact installs
- CI, release, and security workflows enforce quality and guardrails

## CI/CD model

- `ci.yml`: syntax + smoke + Docker build checks
- `release.yml`: automated artifact build and release on tag `v*`
- `security.yml`: npm audit and dependency review
- `codeql.yml`: static analysis on JavaScript code

## Future evolution

- Optional external datastore for larger-scale deployments
- Role-based access control and audit enrichment
- Plugin system for additional infrastructure connectors
