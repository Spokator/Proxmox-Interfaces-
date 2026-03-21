#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  create-container.sh
#  Creates a Proxmox-Interfaces LXC container on Proxmox host
#  Usage : bash create-container.sh   (sur l'hôte Proxmox)
# ═══════════════════════════════════════════════════════════════

set -e

# ─── Configuration ────────────────────────────────────────────
CT_ID=190
CT_NAME="proxmox-interfaces"
CT_IP="dhcp"
CT_GW=""
CT_DNS="1.1.1.1"
CT_BRIDGE="vmbr0"
CT_CORES=1
CT_RAM=512
CT_SWAP=512
CT_DISK=10
CT_STORAGE="local-lvm"          # Adapter si besoin (local-lvm, local-zfs, etc.)
CT_PASSWORD="" # optional: set via env/CLI wrapper if needed
TEMPLATE="debian-12-standard_12.7-1_amd64.tar.zst"
TEMPLATE_STORAGE="local"

# ─── Couleurs ─────────────────────────────────────────────────
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERR]${NC} $1"; exit 1; }

echo -e "\n${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Proxmox-Interfaces — Création CT ${CT_ID}     ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}\n"

# ─── Vérifications préalables ─────────────────────────────────
[ "$(id -u)" -ne 0 ] && error "Ce script doit être exécuté en tant que root sur l'hôte Proxmox."

if pct status $CT_ID &>/dev/null; then
  warn "CT $CT_ID existe déjà. Arrêt."
  exit 1
fi

PASSWORD_ARGS=()
if [ -n "$CT_PASSWORD" ]; then
  PASSWORD_ARGS=(--password "$CT_PASSWORD")
fi

# ─── Téléchargement du template si nécessaire ─────────────────
if ! pveam list $TEMPLATE_STORAGE | grep -q "$TEMPLATE"; then
  info "Téléchargement du template Debian 12..."
  pveam download $TEMPLATE_STORAGE debian-12-standard_12.7-1_amd64.tar.zst || {
    warn "Template Debian 12 non trouvé. Tentative avec Debian 11..."
    TEMPLATE="debian-11-standard_11.7-1_amd64.tar.zst"
    pveam download $TEMPLATE_STORAGE $TEMPLATE || error "Impossible de télécharger le template."
  }
fi

# ─── Création du conteneur ────────────────────────────────────
info "Création du conteneur CT $CT_ID ($CT_NAME)..."
pct create $CT_ID \
  "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" \
  --hostname $CT_NAME \
  --cores $CT_CORES \
  --memory $CT_RAM \
  --swap $CT_SWAP \
  --rootfs ${CT_STORAGE}:${CT_DISK} \
  --net0 name=eth0,bridge=$CT_BRIDGE,ip=$CT_IP${CT_GW:+,gw=$CT_GW} \
  --nameserver $CT_DNS \
  "${PASSWORD_ARGS[@]}" \
  --unprivileged 1 \
  --features nesting=1 \
  --onboot 1 \
  --start 0

success "Conteneur CT $CT_ID créé."

# ─── Démarrage ────────────────────────────────────────────────
info "Démarrage du conteneur..."
pct start $CT_ID
sleep 5

success "Conteneur démarré sur $CT_IP"

echo -e "\n${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}  CT $CT_ID créé et démarré avec succès !${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo ""
echo -e "  IP : ${BLUE}${CT_IP%/*}${NC}"
if [ -n "$CT_PASSWORD" ]; then
  echo -e "  Mot de passe root : ${YELLOW}${CT_PASSWORD}${NC}"
fi
echo ""
echo -e "${YELLOW}  Prochaine étape :${NC}"
echo -e "  1. Copiez les fichiers du site vers le conteneur :"
echo -e "     ${BLUE}scp -r /path/to/Proxmox-Interfaces root@${CT_IP%/*}:/opt/proxmox-interfaces${NC}"
echo -e "  2. Exécutez le script d'installation :"
echo -e "     ${BLUE}ssh root@${CT_IP%/*} 'bash /opt/proxmox-interfaces/deploy/install.sh'${NC}"
echo ""
