#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  install.sh
#  Installation de Chretieno.lan sur le conteneur CT 107
#  Usage : bash /opt/chretieno/deploy/install.sh
# ═══════════════════════════════════════════════════════════════

set -e

APP_DIR="/opt/chretieno"
APP_USER="chretieno"
APP_PORT=3000
DOMAIN="chretieno.lan"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
step()    { echo -e "\n${BLUE}>>> $1${NC}"; }

echo -e "\n${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Chretieno.lan — Installation            ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}\n"

[ "$(id -u)" -ne 0 ] && { echo "Exécuter en root."; exit 1; }

# ─── Mise à jour système ──────────────────────────────────────
step "Mise à jour du système"
apt-get update -qq
apt-get upgrade -y -qq
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
npm install --production
success "Dépendances installées"

# ─── Création des dossiers de données ────────────────────────
step "Initialisation des données"
mkdir -p "$APP_DIR/data"
[ ! -f "$APP_DIR/data/notes.json" ]     && echo "[]" > "$APP_DIR/data/notes.json"
[ ! -f "$APP_DIR/data/changelog.json" ] && echo "[]" > "$APP_DIR/data/changelog.json"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR/data"
success "Dossiers de données créés"

# ─── Service systemd ─────────────────────────────────────────
step "Configuration du service systemd"
# Préserver les variables PVE existantes si déjà présentes dans l'unité
EXISTING_PVE_ENV=""
if [ -f /etc/systemd/system/chretieno.service ]; then
  EXISTING_PVE_ENV=$(grep -E '^Environment=PVE_(HOST|PORT|TOKEN_ID|TOKEN_SECRET)=' /etc/systemd/system/chretieno.service || true)
fi

cat > /etc/systemd/system/chretieno.service << EOF
[Unit]
Description=Chretieno.lan Intranet
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
StandardOutput=journal
StandardError=journal
SyslogIdentifier=chretieno

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable chretieno
systemctl start chretieno
sleep 2
systemctl is-active chretieno && success "Service chretieno démarré" || { echo "Erreur démarrage service"; journalctl -u chretieno -n 20; exit 1; }

# ─── Configuration Nginx (reverse proxy) ─────────────────────
step "Configuration Nginx"
cat > /etc/nginx/sites-available/chretieno << EOF
server {
    listen 80 default_server;
    server_name ${DOMAIN} _;

    access_log /var/log/nginx/chretieno_access.log;
    error_log  /var/log/nginx/chretieno_error.log;

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

ln -sf /etc/nginx/sites-available/chretieno /etc/nginx/sites-enabled/chretieno
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl enable nginx && systemctl restart nginx
success "Nginx configuré et démarré"

# ─── Firewall UFW ─────────────────────────────────────────────
step "Configuration du pare-feu"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp    # HTTP (Nginx)
ufw --force enable
success "Pare-feu configuré"

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
echo -e "${GREEN}║  🎉 Chretieno.lan installé avec succès !          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Accès local  : ${BLUE}http://$(hostname -I | awk '{print $1}')${NC}"
echo -e "  Domaine .lan : ${BLUE}http://${DOMAIN}${NC} (après config DNS)"
echo ""
echo -e "${YELLOW}  Prochaine étape — Ajouter le DNS dans Technitium :${NC}"
echo -e "  Allez sur http://dns.lan → Zones → chretieno.lan"
echo -e "  Ajoutez un enregistrement A : chretieno.lan → $(hostname -I | awk '{print $1}')"
echo ""
echo -e "  Commandes utiles :"
echo -e "    systemctl status chretieno    # Statut de l'app"
echo -e "    journalctl -u chretieno -f    # Logs en temps réel"
echo -e "    systemctl restart chretieno   # Redémarrer"
echo ""
