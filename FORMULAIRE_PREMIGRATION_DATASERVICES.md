# Formulaire pré-migration — Dataservices

Objectif: collecter toutes les informations nécessaires avant exécution du runbook.

Important:
- Ce formulaire ne déploie rien et ne modifie aucune infrastructure.
- Il sert uniquement à préparer et sécuriser le Jour J.

---

## A) Identification projet

- Nom client: Dataservices
- Responsable technique:
- Responsable validation métier:
- Date cible migration:
- Fenêtre de maintenance:

---

## B) Infrastructure cible

- Hôte Proxmox cible (IP/FQDN):
- Version Proxmox:
- Bridge réseau cible (`vmbrX`):
- VLAN (si applicable):
- Plage IP cible:
- Passerelle:
- DNS primaire/secondaire:

---

## C) Conteneur applicatif

- CTID cible:
- IP CT cible:
- Ressources (CPU/RAM/Disque):
- Storage Proxmox cible:

---

## D) API Proxmox

- Utilisateur API dédié créé (`chretieno@pve`): Oui / Non
- ACL `PVEAuditor` sur `/`: Oui / Non
- Token ID:
- Token Secret:

---

## E) Observabilité

- Prometheus disponible: Oui / Non
- URL Prometheus:
- pve-exporter disponible: Oui / Non
- smartctl-exporter disponible: Oui / Non
- Grafana disponible: Oui / Non
- URL Grafana:

---

## F) DNS / découverte

- DNS interne (Technitium): Oui / Non
- URL Technitium:
- Mode auth Technitium (token/user-pass):
- Zone suffixe (ex: `.lan`):

---

## G) Sécurité / accès

- SSH admin disponible sur hôte cible: Oui / Non
- Politique firewall validée: Oui / Non
- Certificats TLS/API Proxmox validés: Oui / Non

---

## H) Plan de sauvegarde et rollback

- Backup source CT réalisé: Oui / Non
- Backup logique data/.env réalisé: Oui / Non
- Procédure rollback validée: Oui / Non
- Critères GO/NO-GO définis: Oui / Non

---

## I) Paramètres `.env` cible (à préparer)

```env
PORT=3000
PVE_HOST=
PVE_PORT=8006
PVE_TOKEN_ID=
PVE_TOKEN_SECRET=
PVE_WATCH_TASKS_ENABLED=true
PVE_WATCH_SYSLOG_ENABLED=true
PVE_WATCH_INTERVAL_MS=20000
TECHNITIUM_BASE_URL=
TECHNITIUM_TOKEN=
TECHNITIUM_USER=
TECHNITIUM_PASS=
TECHNITIUM_TOTP=
TECHNITIUM_ZONE_SUFFIX=.lan
```

---

## J) Validation finale pré-Jour J

- [ ] Toutes les infos ci-dessus complétées
- [ ] Credentials testés
- [ ] Réseau validé
- [ ] Fenêtre de migration approuvée
- [ ] Plan de communication prêt
