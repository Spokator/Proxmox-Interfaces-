# Chretieno.lan — Intranet Centralisé

Hub unique de toute l'infrastructure Proxmox.

## Services inclus

| Service | URL .lan | IP directe |
|---------|----------|-----------|
| Proxmox VE | https://proxmox.lan:8006 | 192.168.8.100:8006 |
| DNS Technitium | http://dns.lan | 192.168.8.150:5380 |
| Ollama (IA) | http://ia.lan | 192.168.8.165:80 |
| Athena IA | http://athena.lan | 192.168.8.165:9000 |
| ComfyUI/Shema | http://shema.lan | 192.168.8.165:8188 |
| GLPI Fake + IA | http://glpifake.lan | 192.168.8.165:80 |
| dataIA *(hors ligne)* | — | 192.168.8.102:80 |
| GLPI | http://glpi.lan | 192.168.8.103:8081 |
| n8n | http://n8n.lan | 192.168.8.103:5678 |
| Wiki | http://wiki.lan | 192.168.8.103:3000 |
| Grafana | http://monitoring.lan | 192.168.8.180:3000 |
| Prometheus | http://monitoring.lan:9090 | 192.168.8.180:9090 |
| Uptime Kuma | http://alerte.lan | 192.168.8.189:3001 |

## Déploiement

### Option A - Installation rapide Proxmox LXC (recommandé client)

Sur l'hôte Proxmox (root), lancez le script paramétrable:

```bash
bash /root/Chretieno.lan/deploy/proxmox-easy-install.sh \
    --ctid 190 \
    --name chretieno-client-a \
    --ip 192.168.8.190/24 \
    --gw 192.168.8.1 \
    --dns 192.168.8.150 \
    --source /root/Chretieno.lan
```

Variantes utiles:

```bash
# DHCP
bash /root/Chretieno.lan/deploy/proxmox-easy-install.sh --ctid 191 --ip dhcp --source /root/Chretieno.lan

# Créer le CT seulement (sans installer l'app)
bash /root/Chretieno.lan/deploy/proxmox-easy-install.sh --ctid 192 --no-install
```

Le script est conçu dans l'esprit "community scripts": création CT + installation + service systemd en une commande.

### Option A bis - Proxmox-Interfaces bootstrap (public script + private artefact)

Quand vous publiez le script et l'archive du projet (GitHub release, serveur web, etc.), vous pouvez déclencher l'installation en une ligne:

```bash
curl -fsSL https://VOTRE-URL/deploy/proxmox-interfaces-bootstrap.sh | bash -s -- \
    --artifact-url https://VOTRE-URL/prive/proxmox-interfaces-latest.tar.gz \
    --artifact-sha256-url https://VOTRE-URL/prive/proxmox-interfaces-latest.sha256 \
    --ctid 190 \
    --name proxmox-interfaces-a \
    --ip 192.168.8.190/24 \
    --gw 192.168.8.1 \
    --dns 192.168.8.150
```

Ce bootstrap exécute automatiquement `deploy/proxmox-easy-install.sh` après téléchargement de l'archive.

Version production (non interactive):

```bash
curl -fsSL https://VOTRE-URL/deploy/proxmox-interfaces-bootstrap.sh | bash -s -- \
    --yes \
    --artifact-url https://VOTRE-URL/prive/proxmox-interfaces-latest.tar.gz \
    --artifact-sha256-url https://VOTRE-URL/prive/proxmox-interfaces-latest.sha256 \
    --ctid 190 \
    --name proxmox-interfaces-a \
    --storage local-lvm \
    --bridge vmbr0 \
    --ip 192.168.8.190/24 \
    --gw 192.168.8.1 \
    --dns 192.168.8.150 \
    --cores 2 \
    --ram 1024 \
    --disk 12
```

Mode interactif (questions guidées, style helper script):

```bash
curl -fsSL https://VOTRE-URL/deploy/proxmox-interfaces-bootstrap.sh | bash
```

Options bootstrap utiles:

- `--yes`: pas de confirmation
- `--silent`: sortie minimale
- `--skip-checks`: saute les préchecks
- `--log-file /tmp/xxx.log`: log personnalisé

Si le projet est déjà présent sur l'hôte Proxmox:

```bash
bash /root/Chretieno.lan/deploy/proxmox-interfaces-bootstrap.sh --workdir /root/Chretieno.lan --ctid 191 --ip dhcp
```

Pour préparer les artefacts privés (tar.gz + sha256):

```bash
bash deploy/proxmox-interfaces-release.sh
```

Voir aussi: `PROXMOX_INTERFACES_DISTRIBUTION.md`

### Option B - Installation Docker (simple et portable)

Préparez la config puis lancez compose:

```bash
cp .env.example .env
# Adapter .env (PVE_HOST, PVE_TOKEN_ID, PVE_TOKEN_SECRET, etc.)
docker compose up -d --build
```

Vérification:

```bash
docker compose ps
curl -s http://127.0.0.1:3000/api/status
```

Les données runtime sont persistées dans `./data`.

### Étape 1 — Créer le conteneur sur Proxmox

```bash
ssh root@192.168.8.100
bash /tmp/create-container.sh
```

Note: ce flux historique reste disponible, mais pour les nouveaux clients préférez `deploy/proxmox-easy-install.sh`.

### Étape 2 — Déployer depuis Windows (PowerShell)

```powershell
cd "C:\Users\pierr\Desktop\Chretieno.lan"
.\deploy\deploy.ps1
```

Ou manuellement :
```powershell
# 1) Copier les fichiers sur l'hote Proxmox
scp .\public\js\app.js root@192.168.8.100:/root/chretieno-app.js
scp .\public\index.html root@192.168.8.100:/root/chretieno-index.html

# 2) Push vers CT 107 + restart service
ssh root@192.168.8.100 "pct push 107 /root/chretieno-app.js /opt/chretieno/public/js/app.js; pct push 107 /root/chretieno-index.html /opt/chretieno/public/index.html; pct exec 107 -- systemctl restart chretieno"
```

Option clé SSH explicite :
```powershell
.\deploy\deploy.ps1 -ProxmoxUser root -ProxmoxHost 192.168.8.100 -SSHKeyPath "C:\Users\pierr\.ssh\id_ed25519"
```

### Étape 3 — Configurer le DNS Technitium

1. Ouvrir http://dns.lan
2. Aller dans **Zones** → créer une zone `chretieno.lan`
3. Ajouter un enregistrement **A** : `chretieno.lan` → `192.168.8.107`
4. Tester : `nslookup chretieno.lan 192.168.8.150`

### Étape 4 — Ajouter dans Uptime Kuma

Ajouter un monitor HTTP pour `http://192.168.8.107` afin de recevoir des alertes Discord.

---

## Développement local

```powershell
npm install
npm run dev
# Site disponible sur http://localhost:3000
```

## Mode production conseillé (commercial)

- 1 client = 1 instance dédiée (LXC ou Docker)
- Configurer `.env` par client (token/API/monitoring/dns)
- Utiliser le module Admin > Migration Nouveau Client pour readiness GO/NO-GO

## Structure du projet

```
Chretieno.lan/
├── server.js              # Backend Express (API + health checks)
├── package.json
├── public/
│   ├── index.html         # SPA
│   ├── css/style.css      # Dark theme
│   ├── js/app.js          # Logique frontend
│   └── data/services.json # Configuration des services
├── data/                  # Données runtime (notes, changelog)
│   ├── notes.json
│   └── changelog.json
└── deploy/
    ├── create-container.sh  # Créer CT 107 sur Proxmox
    ├── install.sh           # Installer sur le conteneur
    └── deploy.ps1           # Déploiement depuis Windows
```

## API Backend

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/api/services` | GET | Tous les services |
| `/api/services` | POST | Ajouter un service |
| `/api/services/:id` | PUT | Modifier un service |
| `/api/services/:id` | DELETE | Supprimer un service |
| `/api/health` | GET | Statuts de tous les services |
| `/api/health/:id` | GET | Statut d'un service |
| `/api/notes` | GET/POST | Notes |
| `/api/notes/:id` | PUT/DELETE | Modifier/supprimer une note |
| `/api/changelog` | GET/POST | Journal de bord |
| `/api/status` | GET | Infos serveur |

## Raccourcis clavier

| Touche | Action |
|--------|--------|
| `Ctrl+K` | Ouvrir la recherche |
| `Escape` | Fermer modal / recherche |
| `1` | Dashboard |
| `2` | Services |
| `3` | Monitoring |
| `4` | Infrastructure |
| `5` | Notes |
| `6` | Journal |
| `7` | Admin |
