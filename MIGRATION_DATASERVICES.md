# Procédure de migration complète vers un autre Proxmox (autre réseau / autre entreprise)

Objectif: migrer l’ensemble du système Chretieno.lan (application, données, monitoring, intégrations) vers une nouvelle infrastructure Proxmox sans perte de fonctionnalités.

Important:
- Ce document est un guide. Le simple fait de le lire/remplir ne déclenche aucun déploiement.
- Seules les commandes exécutées manuellement modifient l’infrastructure.

---

## 1) Périmètre à migrer

- Application Chretieno (CT 107)
- Données applicatives (`/opt/chretieno/data`)
- Configuration d’environnement (`/opt/chretieno/.env`)
- Nginx + service systemd du CT
- Intégrations externes:
  - Proxmox API (token dédié)
  - Prometheus / Grafana
  - Technitium DNS (si utilisé)
  - Uptime Kuma (si utilisé)

---

## 2) Pré-requis sur la nouvelle infra (Dataservices)

### 2.1 Nouveau Proxmox prêt

- Proxmox installé et à jour
- Bridge réseau (ex: `vmbr0`) fonctionnel
- Plan IP et DNS entreprise validés
- Horloge/NTP correcte

### 2.2 Compte API Proxmox pour Chretieno

Créer un utilisateur dédié en lecture:

```bash
pveum user add chretieno@pve --comment "Chretieno Intranet read-only"
pveum aclmod / -user chretieno@pve -role PVEAuditor
pveum user token add chretieno@pve intranet --privsep 0
```

Noter:
- `PVE_TOKEN_ID` ex: `chretieno@pve!intranet`
- `PVE_TOKEN_SECRET` (affiché une seule fois)

---

## 3) Sauvegarde côté source (avant migration)

### 3.1 Snapshot applicatif CT 107

Depuis l’hôte Proxmox source:

```bash
vzdump 107 --mode snapshot --compress zstd --storage <votre-storage-backup>
```

### 3.2 Sauvegarde logique supplémentaire (recommandée)

```bash
pct exec 107 -- tar -czf /tmp/chretieno-data-backup.tgz -C /opt/chretieno data .env
pct pull 107 /tmp/chretieno-data-backup.tgz ./chretieno-data-backup.tgz
```

Conserver aussi:
- `/etc/systemd/system/chretieno.service`
- `/etc/systemd/system/chretieno.service.d/*.conf` (si présents)
- config Nginx du CT

---

## 4) Restauration sur le Proxmox cible

### 4.1 Restaurer le CT

```bash
qmrestore <backup-file> <new-vmid>   # si VM
# ou
pct restore <new-vmid> <backup-file> # si CT
```

Pour Chretieno, conserver l’équivalent de CT 107 (ou adapter dans vos docs internes).

### 4.2 Réseau du CT

- Attribuer IP cible de l’entreprise Dataservices
- Vérifier passerelle + DNS
- Vérifier accès sortant vers:
  - API Proxmox cible (`https://<PVE_HOST>:8006`)
  - Prometheus/Technitium (si utilisés)

---

## 5) Reconfiguration applicative

## 5.1 Fichier `.env`

Dans le CT cible, mettre à jour `/opt/chretieno/.env`:

```env
PORT=3000

PVE_HOST=<IP_OU_DNS_PROXMOX_CIBLE>
PVE_PORT=8006
PVE_TOKEN_ID=chretieno@pve!intranet
PVE_TOKEN_SECRET=<SECRET_TOKEN>

PVE_WATCH_TASKS_ENABLED=true
PVE_WATCH_SYSLOG_ENABLED=true
PVE_WATCH_INTERVAL_MS=20000

TECHNITIUM_BASE_URL=<URL_TECHNITIUM>
TECHNITIUM_TOKEN=
TECHNITIUM_USER=
TECHNITIUM_PASS=
TECHNITIUM_TOTP=
TECHNITIUM_ZONE_SUFFIX=.lan
```

### 5.2 Vérifier systemd

Le service doit charger le `.env`:

- via `EnvironmentFile=-/opt/chretieno/.env`
- ou via override `/etc/systemd/system/chretieno.service.d/envfile.conf`

Puis:

```bash
systemctl daemon-reload
systemctl restart chretieno
systemctl is-active chretieno
```

---

## 6) Déploiement applicatif (code)

Depuis le poste d’administration:

```powershell
cd "C:\Users\pierr\Desktop\Chretieno.lan"
.\deploy\deploy.ps1 -ProxmoxHost <IP_HOTE_CIBLE> -CTID <VMID_CIBLE>
```

Le script prend en compte `.env` local s’il existe.

Attention:
- Cette étape est modifiante (écriture sur la cible + redémarrage service).
- Vérifier 2 fois l’hôte cible avant exécution.

---

## 7) Validation post-migration (obligatoire)

Cette section est majoritairement en lecture seule (contrôles/constats), sauf si vous corrigez ensuite la configuration.

## 7.1 Santé API

- `GET /api/proxmox/config-check` → `configured=true` et connectivité OK
- `GET /api/proxmox/containers` → HTTP 200
- `GET /api/overview` → HTTP 200
- `GET /api/data` → HTTP 200

### 7.2 UI

- Dashboard: statuts présents
- Monitoring: courbes qui remontent
- Monitoring stockage: pools visibles
- Admin > Santé des watchers: actifs
- Journal: entrées nouvelles lors d’actions infra

### 7.3 Intégrations

- Prometheus scrape OK
- Dashboards Grafana alimentés
- DNS interne résout les domaines entreprise

---

## 8) Plan de rollback

Si anomalie bloquante:

1. Stopper le CT cible
2. Rebasculer DNS/accès vers source
3. Redémarrer CT source (si besoin)
4. Analyser:
   - `/api/proxmox/config-check`
   - logs `journalctl -u chretieno -n 200`

---

## 9) Checklist rapide (copiable en ticket)

- [ ] Backup CT 107 réalisé
- [ ] Backup logique data/.env exporté
- [ ] Proxmox cible prêt (réseau + NTP)
- [ ] Token API `chretieno@pve` créé sur cible
- [ ] CT restauré et joignable
- [ ] `.env` ajusté aux valeurs Dataservices
- [ ] `chretieno` actif après restart
- [ ] `/api/proxmox/config-check` OK
- [ ] `/api/overview` OK
- [ ] Pools stockage visibles en UI
- [ ] Watchers OK
- [ ] Validation métier finale effectuée

---

## 10) Notes importantes

- Ne pas redéployer en réexécutant une installation qui écrase systemd sans préserver l’environnement.
- Toujours vérifier la présence des variables `PVE_*` après migration.
- Pour une migration “sans surprise”, valider d’abord sur un environnement de préproduction Dataservices.
