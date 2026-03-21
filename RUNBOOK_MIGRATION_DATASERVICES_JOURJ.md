# RUNBOOK — Migration Jour J (Dataservices)

Document opérationnel **non destructif par défaut**.

Ce runbook est prévu pour la cible Dataservices, sans impacter l’infrastructure maison.

Légende:
- `LECTURE SEULE ✅` = contrôle/diagnostic uniquement
- `MODIFIE L'INFRA ⚠️` = écrit/modifie la cible

Rappel:
- Modifier ce fichier `.md` n’exécute rien.

---

## 0) Règles de sécurité (obligatoires)

- Ne jamais exécuter ce runbook sur l’hôte maison (`192.168.8.100`) sans l’avoir explicitement choisi.
- Vérifier la cible avant chaque commande:
  - `PROXMOX_TARGET_HOST`
  - `CTID_TARGET`
- Commencer par les étapes **lecture seule** (préflight).
- Ne passer aux étapes de modification qu’après validation explicite de l’équipe.

Variables à renseigner:

- `PROXMOX_TARGET_HOST=<IP_HOTE_DATASERVICES>`
- `PROXMOX_TARGET_USER=root`
- `CTID_TARGET=<ID_CT_CIBLE>`
- `APP_DIR=/opt/chretieno`

---

## 1) Préflight (lecture seule)
Statut: `LECTURE SEULE ✅`

### 1.1 Vérifier qu’on est sur la bonne cible

```bash
ssh ${PROXMOX_TARGET_USER}@${PROXMOX_TARGET_HOST} "hostname; pveversion -v | head -n 3"
```

### 1.2 Vérifier accès réseau/API Proxmox depuis la cible

```bash
ssh ${PROXMOX_TARGET_USER}@${PROXMOX_TARGET_HOST} "curl -k -s -o /dev/null -w '%{http_code}' https://127.0.0.1:8006/api2/json/version"
```

Attendu: `200`.

### 1.3 Vérifier présence du CT cible

```bash
ssh ${PROXMOX_TARGET_USER}@${PROXMOX_TARGET_HOST} "pct list | grep -E '^\s*${CTID_TARGET}\s'"
```

---

## 2) Préparation Proxmox API (Dataservices)
Statut: `MODIFIE L'INFRA ⚠️`

Créer (ou vérifier) l’utilisateur API lecture:

```bash
ssh ${PROXMOX_TARGET_USER}@${PROXMOX_TARGET_HOST} "pveum user add chretieno@pve --comment 'Chretieno Intranet read-only' || true"
ssh ${PROXMOX_TARGET_USER}@${PROXMOX_TARGET_HOST} "pveum aclmod / -user chretieno@pve -role PVEAuditor"
ssh ${PROXMOX_TARGET_USER}@${PROXMOX_TARGET_HOST} "pveum user token add chretieno@pve intranet --privsep 0"
```

Conserver:
- `PVE_TOKEN_ID=chretieno@pve!intranet`
- `PVE_TOKEN_SECRET=<valeur retournée>`

---

## 3) Déploiement applicatif côté Dataservices
Statut: `MODIFIE L'INFRA ⚠️`

Depuis le poste d’administration:

```powershell
cd "C:\Users\pierr\Desktop\Chretieno.lan"
```

### 3.1 Préparer un `.env` dédié Dataservices

Créer/adapter `.env` local avec les valeurs cible (jamais maison):

```env
PORT=3000
PVE_HOST=<IP_OU_DNS_PROXMOX_DATASERVICES>
PVE_PORT=8006
PVE_TOKEN_ID=chretieno@pve!intranet
PVE_TOKEN_SECRET=<SECRET_DATASERVICES>
PVE_WATCH_TASKS_ENABLED=true
PVE_WATCH_SYSLOG_ENABLED=true
PVE_WATCH_INTERVAL_MS=20000
TECHNITIUM_BASE_URL=<URL_TECHNITIUM_DATASERVICES>
TECHNITIUM_TOKEN=
TECHNITIUM_USER=
TECHNITIUM_PASS=
TECHNITIUM_TOTP=
TECHNITIUM_ZONE_SUFFIX=.lan
```

### 3.2 Déployer vers la cible

```powershell
.\deploy\deploy.ps1 -ProxmoxHost <IP_HOTE_DATASERVICES> -CTID <CTID_TARGET>
```

---

## 4) Validation post-déploiement (obligatoire)
Statut: `LECTURE SEULE ✅`

### 4.1 Santé service

```bash
ssh ${PROXMOX_TARGET_USER}@${PROXMOX_TARGET_HOST} "pct exec ${CTID_TARGET} -- systemctl is-active chretieno"
```

Attendu: `active`.

### 4.2 Endpoints critiques

```bash
ssh ${PROXMOX_TARGET_USER}@${PROXMOX_TARGET_HOST} "pct exec ${CTID_TARGET} -- curl -s http://127.0.0.1:3000/api/proxmox/config-check"
ssh ${PROXMOX_TARGET_USER}@${PROXMOX_TARGET_HOST} "pct exec ${CTID_TARGET} -- curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/proxmox/containers"
ssh ${PROXMOX_TARGET_USER}@${PROXMOX_TARGET_HOST} "pct exec ${CTID_TARGET} -- curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/overview"
```

Attendu:
- `config-check`: `configured=true` et `connectivity.ok=true`
- `containers`: `200`
- `overview`: `200`

### 4.3 Validation UI

- Admin > Connexion API Proxmox: doit être `Connecté`.
- Monitoring: courbes actives.
- Monitoring Stockage: pools visibles.
- Journal: watchers actifs.

---

## 5) Rollback rapide
Statut: `MODIFIE L'INFRA ⚠️`

Si régression:

1. Couper trafic utilisateur vers la cible.
2. Revenir au DNS/accès précédent.
3. Restaurer le dernier backup CT validé.
4. Vérifier logs:

```bash
ssh ${PROXMOX_TARGET_USER}@${PROXMOX_TARGET_HOST} "pct exec ${CTID_TARGET} -- journalctl -u chretieno -n 200 --no-pager"
```

---

## 6) Clôture

Migration validée seulement si:
- API Proxmox connectée,
- monitoring complet remonté,
- stockage visible,
- watchers et journal opérationnels,
- test utilisateur métier validé.
