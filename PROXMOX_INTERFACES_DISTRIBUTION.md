# Proxmox-Interfaces - Distribution privee avec bootstrap public

Objectif:
- Script bootstrap public (simple comme un community script)
- Code source et artefacts prives
- Verification SHA256 avant installation

## Architecture recommandee

1. Repo source prive (GitHub prive)
2. Build artefact tar.gz + sha256
3. Publication artefact sur backend prive (URL signee/tokenisee)
4. Publication du bootstrap `deploy/proxmox-interfaces-bootstrap.sh` sur URL publique

## Etape 1 - Generer l'artefact

Depuis Linux:

```bash
bash deploy/proxmox-interfaces-release.sh
```

Sortie:
- `dist/proxmox-interfaces-latest.tar.gz`
- `dist/proxmox-interfaces-latest.sha256`

## Etape 2 - Publier

- Publier `proxmox-interfaces-latest.tar.gz` et `.sha256` sur votre distribution privee
- Publier `deploy/proxmox-interfaces-bootstrap.sh` sur une URL publique stable

## Etape 3 - Installation client (PVE root)

### Mode non interactif (production)

```bash
curl -fsSL https://YOUR-PUBLIC-BOOTSTRAP/proxmox-interfaces-bootstrap.sh | bash -s -- \
  --yes \
  --artifact-url https://YOUR-PRIVATE-DIST/proxmox-interfaces-latest.tar.gz \
  --artifact-sha256-url https://YOUR-PRIVATE-DIST/proxmox-interfaces-latest.sha256 \
  --ctid 190 \
  --name proxmox-interfaces-a \
  --storage local-lvm \
  --bridge vmbr0 \
  --ip 10.0.0.190/24 \
  --gw 10.0.0.1 \
  --dns 10.0.0.53 \
  --cores 2 \
  --ram 1024 \
  --disk 12
```

### Mode interactif

```bash
curl -fsSL https://YOUR-PUBLIC-BOOTSTRAP/proxmox-interfaces-bootstrap.sh | bash
```

## Auth artefact prive

Le bootstrap supporte:
- `--auth-header "Authorization: Bearer <token>"`
- ou variable `GITHUB_TOKEN` (ajoute un header Authorization)

Exemple:

```bash
export GITHUB_TOKEN="<token>"
curl -fsSL https://YOUR-PUBLIC-BOOTSTRAP/proxmox-interfaces-bootstrap.sh | bash -s -- \
  --artifact-url https://YOUR-PRIVATE-DIST/proxmox-interfaces-latest.tar.gz \
  --artifact-sha256-url https://YOUR-PRIVATE-DIST/proxmox-interfaces-latest.sha256 \
  --ctid 190 --ip dhcp
```

## Notes

- Le bootstrap public ne contient pas ton code metier.
- La verification SHA256 est recommandee en production.
- Le script legacy `deploy/community-install.sh` reste disponible et redirige vers le nouveau bootstrap.
