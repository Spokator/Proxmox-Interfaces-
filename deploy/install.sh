#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  install.sh
#  Installation de Proxmox-Interfaces dans un conteneur LXC
#  Usage : bash /opt/proxmox-interfaces/deploy/install.sh
# ═══════════════════════════════════════════════════════════════

set -e

APP_DIR="/opt/proxmox-interfaces"
APP_USER="proxmox-interfaces"
APP_PORT=3000
DOMAIN="proxmox-interfaces.local"
SERVICE_NAME="proxmox-interfaces"
INSTALL_SYSTEM_UPGRADE="${INSTALL_SYSTEM_UPGRADE:-0}"
MANAGE_UFW="${MANAGE_UFW:-0}"
POST_INSTALL_WIZARD="${POST_INSTALL_WIZARD:-auto}"
POST_INSTALL_PROFILE="${POST_INSTALL_PROFILE:-auto}"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
step()    { echo -e "\n${BLUE}>>> $1${NC}"; }

ensure_utf8_locale() {
  local target_locale="en_US.UTF-8"

  if locale -a 2>/dev/null | tr '[:upper:]' '[:lower:]' | grep -q '^en_us\.utf-8$\|^en_us\.utf8$'; then
    export LANG="$target_locale"
    export LC_ALL="$target_locale"
    return
  fi

  info "Locale ${target_locale} absente, génération en cours"
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y -qq locales

  if [ -f /etc/locale.gen ]; then
    sed -i 's/^# *en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen
  else
    echo "en_US.UTF-8 UTF-8" > /etc/locale.gen
  fi

  locale-gen "$target_locale"
  update-locale LANG="$target_locale" LC_ALL="$target_locale"
  export LANG="$target_locale"
  export LC_ALL="$target_locale"
  success "Locale ${target_locale} configurée"
}

is_runtime_configured() {
  local env_file="$APP_DIR/.env"
  [ -f "$env_file" ] || return 1

  local pve_host pve_token_id pve_token_secret
  pve_host=$(grep -E '^PVE_HOST=' "$env_file" 2>/dev/null | head -n1 | cut -d= -f2-)
  pve_token_id=$(grep -E '^PVE_TOKEN_ID=' "$env_file" 2>/dev/null | head -n1 | cut -d= -f2-)
  pve_token_secret=$(grep -E '^PVE_TOKEN_SECRET=' "$env_file" 2>/dev/null | head -n1 | cut -d= -f2-)

  [ -n "$pve_host" ] || return 1
  [ -n "$pve_token_id" ] || return 1
  [ -n "$pve_token_secret" ] || return 1
  [ "$pve_token_secret" != "CHANGE_ME" ] || return 1
  return 0
}

run_post_install_wizard() {
  local wizard_script="$APP_DIR/deploy/configure-instance.sh"
  local mode
  local profile
  mode=$(echo "$POST_INSTALL_WIZARD" | tr '[:upper:]' '[:lower:]')
  profile=$(echo "$POST_INSTALL_PROFILE" | tr '[:upper:]' '[:lower:]')

  if [ "$profile" != "manual" ] && [ "$profile" != "manuel" ] && [ "$profile" != "auto" ] && [ "$profile" != "automatique" ]; then
    profile="auto"
  fi

  if [ "$profile" = "manuel" ]; then
    profile="manual"
  fi
  if [ "$profile" = "automatique" ]; then
    profile="auto"
  fi

  if [ ! -x "$wizard_script" ]; then
    info "Wizard post-install introuvable: $wizard_script"
    return 0
  fi

  if is_runtime_configured; then
    info "Configuration .env déjà détectée, wizard post-install ignoré"
    return 0
  fi

  if [ "$mode" = "0" ] || [ "$mode" = "false" ] || [ "$mode" = "no" ] || [ "$mode" = "off" ]; then
    info "Wizard post-install désactivé (POST_INSTALL_WIZARD=$POST_INSTALL_WIZARD)"
    return 0
  fi

  if [ "$mode" = "1" ] || [ "$mode" = "true" ] || [ "$mode" = "yes" ] || [ "$mode" = "on" ]; then
    step "Assistant de configuration (.env)"
    bash "$wizard_script" --mode "$profile"
    return 0
  fi

  if [ ! -t 0 ] && [ ! -r /dev/tty ]; then
    info "Session non interactive: wizard post-install ignoré (POST_INSTALL_WIZARD=auto)"
    return 0
  fi

  step "Assistant de configuration (.env)"
  echo -e "${YELLOW}[INFO]${NC} Lancer le wizard interactif maintenant ? [Y/n]"

  local answer=""
  if [ -r /dev/tty ]; then
    read -r answer < /dev/tty || true
  else
    read -r answer || true
  fi
  answer=$(echo "$answer" | tr '[:upper:]' '[:lower:]')

  if [ -z "$answer" ] || [ "$answer" = "y" ] || [ "$answer" = "yes" ] || [ "$answer" = "o" ] || [ "$answer" = "oui" ]; then
    echo -e "${YELLOW}[INFO]${NC} Mode de configuration : [A]utomatique (recommandé) / [M]anuel"
    local mode_answer=""
    if [ -r /dev/tty ]; then
      read -r mode_answer < /dev/tty || true
    else
      read -r mode_answer || true
    fi
    mode_answer=$(echo "$mode_answer" | tr '[:upper:]' '[:lower:]')

    if [ "$mode_answer" = "m" ] || [ "$mode_answer" = "manual" ] || [ "$mode_answer" = "manuel" ]; then
      profile="manual"
    else
      profile="auto"
    fi

    bash "$wizard_script" --mode "$profile"
  else
    info "Wizard post-install ignoré par l'utilisateur"
  fi
}

echo -e "\n${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Proxmox-Interfaces — Installation       ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}\n"

[ "$(id -u)" -ne 0 ] && { echo "Exécuter en root."; exit 1; }

# Évite les warnings apt/perl sur les CT Debian minimalistes
ensure_utf8_locale

# ─── Mise à jour système ──────────────────────────────────────
step "Mise à jour du système"
apt-get update -qq
if [ "$INSTALL_SYSTEM_UPGRADE" = "1" ]; then
  apt-get upgrade -y -qq
  success "Upgrade système appliqué"
else
  info "Upgrade système ignoré (INSTALL_SYSTEM_UPGRADE=0)"
fi
apt-get install -y -qq curl wget gnupg2 ca-certificates nginx ufw

# ─── Installation Node.js 20 LTS ──────────────────────────────
step "Installation Node.js 20 LTS"
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
NODE_VERSION=$(node -v)
success "Node.js $NODE_VERSION installé"

# ─── Création utilisateur applicatif ─────────────────────────
step "Création de l'utilisateur $APP_USER"
id "$APP_USER" &>/dev/null || useradd -r -s /bin/false -d "$APP_DIR" "$APP_USER"
success "Utilisateur $APP_USER prêt"

# ─── Copier les fichiers si ce script est exécuté depuis l'archive ──
if [ ! -d "$APP_DIR/public" ]; then
  echo -e "${RED}[ERR]${NC} Répertoire $APP_DIR/public introuvable."
  echo "Assurez-vous d'avoir copié les fichiers du projet dans $APP_DIR"
  exit 1
fi

chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# ─── Installation des dépendances Node.js ────────────────────
step "Installation des dépendances npm"
cd "$APP_DIR"
if [ -f "$APP_DIR/package-lock.json" ]; then
  npm ci --omit=dev
else
  npm install --production
fi
success "Dépendances installées"

# ─── Création des dossiers de données ────────────────────────
step "Initialisation des données"
mkdir -p "$APP_DIR/data"
mkdir -p "$APP_DIR/public/data"
[ ! -f "$APP_DIR/data/notes.json" ]     && echo "[]" > "$APP_DIR/data/notes.json"
[ ! -f "$APP_DIR/data/changelog.json" ] && echo "[]" > "$APP_DIR/data/changelog.json"
if [ ! -f "$APP_DIR/public/data/services.json" ]; then
cat > "$APP_DIR/public/data/services.json" << 'EOF'
{
  "categories": [
    {
      "id": "infrastructure",
      "name": "Infrastructure",
      "icon": "server",
      "color": "#22c55e",
      "description": "Hypervisor, network, and base services"
    },
    {
      "id": "monitoring",
      "name": "Monitoring",
      "icon": "activity",
      "color": "#ef4444",
      "description": "Metrics, health checks, and alerting"
    },
    {
      "id": "automation",
      "name": "Automation",
      "icon": "git-branch",
      "color": "#3b82f6",
      "description": "Workflows and integrations"
    }
  ],
  "services": []
}
EOF
fi
chown -R "$APP_USER":"$APP_USER" "$APP_DIR/data"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR/public/data"
success "Dossiers de données créés"

# ─── Service systemd ─────────────────────────────────────────
step "Configuration du service systemd"
# Préserver les variables PVE existantes si déjà présentes dans l'unité
EXISTING_PVE_ENV=""
if [ -f /etc/systemd/system/${SERVICE_NAME}.service ]; then
  EXISTING_PVE_ENV=$(grep -E '^Environment=PVE_(HOST|PORT|TOKEN_ID|TOKEN_SECRET)=' /etc/systemd/system/${SERVICE_NAME}.service || true)
fi

cat > /etc/systemd/system/${SERVICE_NAME}.service << EOF
[Unit]
Description=Proxmox-Interfaces
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/node ${APP_DIR}/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=${APP_PORT}
EnvironmentFile=-${APP_DIR}/.env
${EXISTING_PVE_ENV}
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ReadWritePaths=${APP_DIR} ${APP_DIR}/data
UMask=027
LimitNOFILE=65535
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}
systemctl start ${SERVICE_NAME}
sleep 2
systemctl is-active ${SERVICE_NAME} && success "Service ${SERVICE_NAME} demarre" || { echo "Erreur demarrage service"; journalctl -u ${SERVICE_NAME} -n 20; exit 1; }

# ─── Configuration Nginx (reverse proxy) ─────────────────────
step "Configuration Nginx"
cat > /etc/nginx/sites-available/${SERVICE_NAME} << EOF
server {
    listen 80 default_server;
    server_name ${DOMAIN} _;

    access_log /var/log/nginx/${SERVICE_NAME}_access.log;
    error_log  /var/log/nginx/${SERVICE_NAME}_error.log;

    # Compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
    gzip_min_length 1000;

    # Cache pour assets statiques
    location ~* \.(css|js|png|jpg|ico|woff2?)$ {
        proxy_pass http://localhost:${APP_PORT};
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    location / {
        proxy_pass         http://localhost:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection keep-alive;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 30s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/${SERVICE_NAME} /etc/nginx/sites-enabled/${SERVICE_NAME}
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl enable nginx && systemctl restart nginx
success "Nginx configuré et démarré"

# ─── Firewall UFW ─────────────────────────────────────────────
if [ "$MANAGE_UFW" = "1" ]; then
  step "Configuration du pare-feu"
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow ssh
  ufw allow 80/tcp    # HTTP (Nginx)
  ufw --force enable
  success "Pare-feu configuré"
else
  step "Configuration du pare-feu"
  info "Configuration UFW ignorée (MANAGE_UFW=0)"
fi

# ─── Outils d'exploitation ────────────────────────────────────
step "Activation des scripts d'exploitation"
chmod +x "$APP_DIR/deploy/diagnose.sh" "$APP_DIR/deploy/support-bundle.sh" "$APP_DIR/deploy/configure-instance.sh" 2>/dev/null || true
success "Scripts d'exploitation prêts"

# ─── Test final ───────────────────────────────────────────────
step "Test de l'application"
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:80/ || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  success "Application répond HTTP 200"
else
  echo -e "${YELLOW}[WARN]${NC} Code HTTP: $HTTP_CODE (peut être normal au premier démarrage)"
fi

# ─── Résumé ───────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  🎉 Proxmox-Interfaces installe avec succes !     ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Accès local  : ${BLUE}http://$(hostname -I | awk '{print $1}')${NC}"
echo -e "  Domaine .lan : ${BLUE}http://${DOMAIN}${NC} (après config DNS)"
echo ""
echo -e "${YELLOW}  Prochaine étape — Ajouter le DNS dans Technitium :${NC}"
echo -e "  Allez sur votre DNS interne → zones"
echo -e "  Ajoutez un enregistrement A pour ${DOMAIN} → $(hostname -I | awk '{print $1}')"
echo ""
echo -e "  Commandes utiles :"
echo -e "    systemctl status ${SERVICE_NAME}    # Statut de l'app"
echo -e "    journalctl -u ${SERVICE_NAME} -f    # Logs en temps reel"
echo -e "    systemctl restart ${SERVICE_NAME}   # Redemarrer"
echo -e "    bash ${APP_DIR}/deploy/diagnose.sh # Diagnostic rapide"
echo -e "    bash ${APP_DIR}/deploy/support-bundle.sh # Bundle support"
echo -e "    bash ${APP_DIR}/deploy/configure-instance.sh # Wizard .env"
if ! is_runtime_configured; then
  echo ""
  echo -e "${YELLOW}[INFO]${NC} Inventaire live Proxmox non configuré (.env incomplet)."
  echo -e "       Lancez : bash ${APP_DIR}/deploy/configure-instance.sh"
  echo -e "       Puis   : systemctl restart ${SERVICE_NAME}"
fi
echo ""

run_post_install_wizard
