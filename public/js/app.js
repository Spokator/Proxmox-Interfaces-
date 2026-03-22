/* ═══════════════════════════════════════════════════════════════
  Proxmox-Interfaces — App.js
  Logic: routing, state, API, views, search
  ═══════════════════════════════════════════════════════════════ */

'use strict';

// ─── État global ─────────────────────────────────────────────────
const State = {
  data: null,           // services.json complet
  statuses: {},         // { serviceId: 'up'|'down'|'unknown' }
  favorites: new Set(), // IDs des favoris (localStorage)
  favoritesSeeded: false,
  currentView: 'dashboard',
  filterCategory: 'all',
  filterStatus: 'all',
  healthInterval: null,
  overviewInterval: null,
  overviewHistory: {
    cpu: [],
    ram: [],
    disk: [],
    vram: [],
  },
  overviewPoints: {
    cpu: [],
    ram: [],
    disk: [],
    vram: [],
  },
  storagePoolsHistory: {},
  storagePoolsPoints: {},
  storagePoolsLatest: [],
  latestOverviewProxmox: null,
  overviewRangeMin: 5,
  noteColor: '#6366f1',
  editingNoteId: null,
  changelogEntries: [],
  changelogFilterType: 'all',
  changelogSearch: '',
  changelogPage: 1,
  changelogFiltersBound: false,
  containerColorMap: {},
  guestPowerTransitions: {},
  migrationLastAudit: null,
  migrationAutoAuditInterval: null,
};

const GUEST_POWER_TRANSITION_TTL_MS = 120000;
const MIGRATION_PROFILE_KEY = 'proxmox_interfaces_migration_profile_v1';
const MIGRATION_AUTO_AUDIT_KEY = 'proxmox_interfaces_migration_auto_audit_v1';
const MIGRATION_AUTO_AUDIT_MS = 15000;

// ─── Icônes par service ───────────────────────────────────────────
const ICON_MAP = {
  'server': 'server', 'globe': 'globe', 'cpu': 'cpu', 'sparkles': 'sparkles',
  'image': 'image', 'bot': 'bot', 'ticket': 'ticket', 'git-branch': 'git-branch',
  'book-open': 'book-open', 'bar-chart-2': 'bar-chart-2', 'database': 'database',
  'bell': 'bell', 'activity': 'activity', 'workflow': 'git-branch',
  'clipboard-list': 'clipboard-list', 'palette': 'palette', 'brain': 'brain',
};

// ─── Utilitaires ─────────────────────────────────────────────────
function qs(sel, ctx = document)  { return ctx.querySelector(sel); }
function qsa(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

function fmt(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function toast(msg, type = 'info') {
  const icons = { success: 'check-circle-2', error: 'x-circle', info: 'info' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i data-lucide="${icons[type] || 'info'}"></i><span>${escHtml(msg)}</span>`;
  qs('#toast-container').appendChild(el);
  lucide.createIcons({ nodes: [el] });
  setTimeout(() => el.remove(), 3500);
}

function lucideRefresh(ctx = document) {
  lucide.createIcons({ nodes: qsa('[data-lucide]', ctx) });
}

function getCatColor(catId) {
  const cat = State.data?.categories.find(c => c.id === catId);
  return cat?.color || '#6366f1';
}
function getCatName(catId) {
  const cat = State.data?.categories.find(c => c.id === catId);
  return cat?.name || catId;
}

function buildContainerColorMap(containers) {
  const sorted = (containers || []).slice().sort((a, b) => {
    const av = Number.isFinite(a?.vmid) ? a.vmid : Number.MAX_SAFE_INTEGER;
    const bv = Number.isFinite(b?.vmid) ? b.vmid : Number.MAX_SAFE_INTEGER;
    if (av !== bv) return av - bv;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });

  const palette = [
    '#3b82f6', // bleu
    '#8b5cf6', // violet
    '#22c55e', // vert
    '#f59e0b', // orange
    '#ef4444', // rouge
    '#06b6d4', // cyan
    '#eab308', // jaune
    '#ec4899', // rose
    '#14b8a6', // teal
    '#f97316', // orange foncé
  ];

  const map = {};
  sorted.forEach((ct, index) => {
    map[ct.id] = palette[index % palette.length];
  });
  return map;
}

function refreshContainerColorMap() {
  State.containerColorMap = buildContainerColorMap(State.data?.containers || []);
}

function getContainerColor(container) {
  if (!container) return '#475569';
  return State.containerColorMap?.[container.id] || container.color || '#475569';
}

function sortContainersByVmid(containers) {
  return (containers || []).slice().sort((a, b) => {
    const aVmid = Number.parseInt(String(a?.vmid ?? ''), 10);
    const bVmid = Number.parseInt(String(b?.vmid ?? ''), 10);
    const aHas = Number.isFinite(aVmid);
    const bHas = Number.isFinite(bVmid);
    if (aHas && bHas && aVmid !== bVmid) return aVmid - bVmid;
    if (aHas !== bHas) return aHas ? -1 : 1;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
}

// ─── Favoris ─────────────────────────────────────────────────────
function loadFavorites() {
  try {
    const raw = localStorage.getItem('proxmox_interfaces_favorites');
    if (raw !== null) {
      JSON.parse(raw).forEach(id => State.favorites.add(id));
      State.favoritesSeeded = true;
    }
  } catch(e) {}
}

function seedFavoritesFromDataIfNeeded() {
  if (State.favoritesSeeded) return;
  if (!State.data) return;

  // 1er lancement: on initialise depuis services.json (champ favorite)
  (State.data.services || []).forEach(s => {
    if (s.favorite) State.favorites.add(s.id);
  });

  State.favoritesSeeded = true;
  saveFavorites();
}

function saveFavorites() {
  localStorage.setItem('proxmox_interfaces_favorites', JSON.stringify([...State.favorites]));
}
function toggleFavorite(id) {
  if (State.favorites.has(id)) State.favorites.delete(id);
  else State.favorites.add(id);
  saveFavorites();
}
function isFavorite(id) {
  return State.favorites.has(id);
}

// ─── Cache local (évite unknown au reload) ───────────────────────
function loadStatusCache() {
  try {
    const raw = localStorage.getItem('proxmox_interfaces_statuses');
    const ts = parseInt(localStorage.getItem('proxmox_interfaces_statuses_ts') || '0', 10);
    if (!raw || !ts) return;
    // 10 minutes max
    if ((Date.now() - ts) > 10 * 60 * 1000) return;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') {
      State.statuses = obj;
    }
  } catch {}
}

function saveStatusCache() {
  try {
    localStorage.setItem('proxmox_interfaces_statuses', JSON.stringify(State.statuses || {}));
    localStorage.setItem('proxmox_interfaces_statuses_ts', String(Date.now()));
  } catch {}
}

function loadOverviewCache() {
  try {
    const raw = localStorage.getItem('proxmox_interfaces_overview');
    if (!raw) return;
    const obj = JSON.parse(raw);
    const ts = obj?.ts || 0;
    if (!ts) return;
    // Historique conservé jusqu'à 8 jours
    if ((Date.now() - ts) > 8 * 24 * 60 * 60 * 1000) return;

    const rangeMin = parseInt(localStorage.getItem('proxmox_interfaces_overview_range_min') || '', 10);
    if (rangeMin) State.overviewRangeMin = rangeMin;

    const hist = obj?.history;
    if (hist?.cpu) State.overviewHistory.cpu = normalizeHistory(hist.cpu);
    if (hist?.ram) State.overviewHistory.ram = normalizeHistory(hist.ram);
    if (hist?.disk) State.overviewHistory.disk = normalizeHistory(hist.disk);
    if (hist?.vram) State.overviewHistory.vram = normalizeHistory(hist.vram);
    if (obj?.storagePools && typeof obj.storagePools === 'object') {
      State.storagePoolsHistory = {};
      Object.entries(obj.storagePools).forEach(([k, arr]) => {
        State.storagePoolsHistory[k] = normalizeHistory(arr);
      });
    }

    const t = obj?.texts || {};
    if (t.cpuText) qs('#ov-cpu-text') && (qs('#ov-cpu-text').textContent = t.cpuText);
    if (t.ramText) qs('#ov-ram-text') && (qs('#ov-ram-text').textContent = t.ramText);
    if (t.diskText) qs('#ov-disk-text') && (qs('#ov-disk-text').textContent = t.diskText);
    if (t.vramText) qs('#ov-vram-text') && (qs('#ov-vram-text').textContent = t.vramText);

    // Dessine immédiatement les sparklines
    renderOverviewSparks();
  } catch {}
}

function saveOverviewCache(texts) {
  try {
    localStorage.setItem('proxmox_interfaces_overview', JSON.stringify({
      ts: Date.now(),
      history: State.overviewHistory,
      storagePools: State.storagePoolsHistory,
      texts: texts || {}
    }));
  } catch {}
}

// ─── API ─────────────────────────────────────────────────────────
async function fetchServices(live = false) {
  const url = live ? `/api/data?live=1&t=${Date.now()}` : '/api/data';
  const res = await fetch(url, live ? { cache: 'no-store' } : undefined);
  if (!res.ok) throw new Error('Erreur chargement services');
  return res.json();
}
async function fetchHealth() {
  const res = await fetch('/api/health');
  if (!res.ok) return [];
  return res.json();
}

async function fetchOverview() {
  const res = await fetch('/api/overview');
  return res.ok ? res.json() : null;
}
async function fetchNotes() {
  const res = await fetch('/api/notes');
  return res.ok ? res.json() : [];
}
async function saveNote(data) {
  const res = await fetch('/api/notes', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
  if (!res.ok) throw new Error('Erreur sauvegarde note');
  return res.json();
}
async function deleteNote(id) {
  const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Erreur suppression note');
}
async function fetchChangelog() {
  const res = await fetch('/api/changelog');
  return res.ok ? res.json() : [];
}
async function addChangelogEntry(data) {
  const res = await fetch('/api/changelog', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
  if (!res.ok) throw new Error('Erreur ajout journal');
  return res.json();
}
async function addService(data) {
  const res = await fetch('/api/services', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Erreur ajout service'); }
  return res.json();
}
async function deleteService(id) {
  const res = await fetch(`/api/services/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Erreur suppression service');
}

async function updateService(id, data) {
  const res = await fetch(`/api/services/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || 'Erreur modification service');
  }
  return res.json();
}

async function promoteAutoService(id) {
  const res = await fetch(`/api/services/${id}/promote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Erreur de validation du service auto');
  return body;
}

async function rejectAutoService(id) {
  const res = await fetch(`/api/services/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Erreur de refus du service auto');
  return body;
}

async function fetchProxmoxWatchers() {
  const res = await fetch('/api/proxmox/watchers');
  if (!res.ok) throw new Error('Erreur récupération watchers');
  return res.json();
}

async function fetchProxmoxConfigCheck() {
  const res = await fetch('/api/proxmox/config-check');
  if (!res.ok) throw new Error('Erreur récupération config Proxmox');
  return res.json();
}

async function fetchProxmoxContainersLive() {
  const res = await fetch(`/api/proxmox/containers?live=1&t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Erreur récupération conteneurs Proxmox');
  return res.json();
}

async function fetchDnsStatus() {
  const res = await fetch('/api/dns/status');
  if (!res.ok) throw new Error('Erreur récupération statut DNS');
  return res.json();
}

async function fetchDnsConfigCheck() {
  const res = await fetch('/api/dns/config-check');
  if (!res.ok) throw new Error('Erreur récupération config DNS');
  return res.json();
}

async function setGuestPowerState(type, vmid, action) {
  const res = await fetch(`/api/proxmox/guests/${encodeURIComponent(type)}/${encodeURIComponent(String(vmid))}/power`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Erreur action power Proxmox');
  return body;
}

// ─── Health checks ────────────────────────────────────────────────
async function refreshHealth() {
  const refreshBtn = qs('#refresh-btn');
  refreshBtn?.classList.add('spinning');
  try {
    const results = await fetchHealth();
    results.forEach(r => { State.statuses[r.id] = r.status; });
    saveStatusCache();
    updateHealthUI();
    updateStatCounts();
  } catch(e) {
    console.warn('Health check failed:', e);
  } finally {
    refreshBtn?.classList.remove('spinning');
  }
}

async function refreshLiveData() {
  try {
    const data = await fetchServices(true);
    if (data) State.data = data;
  } catch {}
}

function getContainerStatusRaw(container) {
  return String(container?.resources?.status || 'unknown').toLowerCase();
}

function hasKnownContainerIp(container) {
  const ip = String(container?.ip || '').trim();
  if (!ip) return false;
  const lowered = ip.toLowerCase();
  return lowered !== '—' && lowered !== '-' && lowered !== 'unknown' && lowered !== 'inconnue';
}

function setGuestTransitionState(containerId, state, ttlMs = GUEST_POWER_TRANSITION_TTL_MS) {
  if (!containerId) return;
  if (!state) {
    delete State.guestPowerTransitions[containerId];
    return;
  }
  State.guestPowerTransitions[containerId] = {
    state,
    expiresAt: Date.now() + ttlMs,
  };
}

function getGuestTransitionState(containerId) {
  if (!containerId) return null;
  const current = State.guestPowerTransitions[containerId];
  if (!current) return null;
  if (!current.expiresAt || current.expiresAt < Date.now()) {
    delete State.guestPowerTransitions[containerId];
    return null;
  }
  return current.state || null;
}

function getContainerDisplayStatus(container) {
  const raw = getContainerStatusRaw(container);
  const transition = getGuestTransitionState(container?.id);

  if (raw === 'backup' || raw === 'prelaunch' || raw === 'paused') {
    setGuestTransitionState(container?.id, null);
    return raw;
  }

  if (transition === 'starting') {
    if (raw === 'running') {
      setGuestTransitionState(container?.id, null);
      return 'running';
    }
    return 'starting';
  }

  if (transition === 'stopping') {
    if (raw === 'stopped') {
      setGuestTransitionState(container?.id, null);
      return 'stopped';
    }
    return 'stopping';
  }

  return raw;
}

function getInfraDotStatus(status) {
  if (status === 'running') return 'up';
  if (status === 'stopped' || status === 'stopping') return 'down';
  if (status === 'starting' || status === 'backup' || status === 'prelaunch' || status === 'paused') return 'starting';
  return 'unknown';
}

function getInfraStatusLabel(status) {
  if (status === 'running') return 'running';
  if (status === 'stopped') return 'stopped';
  if (status === 'starting') return 'starting';
  if (status === 'stopping') return 'stopping';
  if (status === 'backup') return 'backup';
  if (status === 'prelaunch') return 'prelaunch';
  if (status === 'paused') return 'paused';
  return 'unknown';
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isContainerModalOpen(containerId = null) {
  const modal = qs('#container-modal');
  if (!modal || modal.classList.contains('hidden')) return false;
  if (!containerId) return true;
  return String(modal.dataset.ctId || '') === String(containerId);
}

async function refreshAfterPowerStart(containerId, timeoutMs = 90000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await refreshLiveData();
    renderMonitoringInfraMetrics();
    renderInfrastructure();
    renderIpTable();
    if (isContainerModalOpen(containerId)) openContainerModal(containerId);

    const container = State.data?.containers?.find(c => c.id === containerId);
    if (container && getContainerStatusRaw(container) === 'running' && hasKnownContainerIp(container)) {
      setGuestTransitionState(containerId, null);
      return;
    }

    await wait(4000);
  }

  setGuestTransitionState(containerId, null);
  await refreshLiveData();
  renderMonitoringInfraMetrics();
  renderInfrastructure();
  renderIpTable();
  if (isContainerModalOpen(containerId)) openContainerModal(containerId);
}

function updateHealthUI() {
  const activeServiceIds = new Set((State.data?.services || []).map(s => s.id));

  // Mise à jour des dots sur les cartes
  qsa('.service-card').forEach(card => {
    const id = card.dataset.id;
    const status = State.statuses[id] || 'unknown';
    const dot = card.querySelector('.status-dot');
    const lbl = card.querySelector('.status-label');
    if (dot) { dot.className = `status-dot ${status}`; }
    if (lbl) {
      lbl.className = `status-label ${status}`;
      lbl.textContent = status === 'up' ? 'En ligne' : status === 'down' ? 'Hors ligne' : 'Inconnu';
    }
  });

  // Mise à jour de la liste monitoring (scopée + 1 seul refresh d'icônes)
  const monitoringList = qs('#monitoring-status-list');
  if (monitoringList) {
    qsa('.status-list-item[data-id]', monitoringList).forEach(item => {
      const id = item.dataset.id;
      const status = State.statuses[id] || 'unknown';
      const dot = item.querySelector('.status-dot');
      const badge = item.querySelector('.sli-badge');
      if (dot) dot.className = `status-dot ${status}`;
      if (badge) {
        badge.className = `sli-badge ${status}`;
        const icon = status === 'up' ? 'check-circle-2' : status === 'down' ? 'x-circle' : 'help-circle';
        const label = status === 'up' ? 'UP' : status === 'down' ? 'DOWN' : 'UNKNOWN';
        badge.innerHTML = `<i data-lucide="${icon}"></i>${label}`;
      }
    });
    lucideRefresh(monitoringList);
  }

  // Mise à jour de la liste services du conteneur (modal)
  const ctServicesList = qs('#ct-modal-services');
  if (ctServicesList) {
    qsa('.status-list-item[data-svc-open]', ctServicesList).forEach(item => {
      const id = item.dataset.svcOpen;
      const status = State.statuses[id] || 'unknown';
      const dot = item.querySelector('.status-dot');
      const badge = item.querySelector('.sli-badge');
      if (dot) dot.className = `status-dot ${status}`;
      if (badge) {
        badge.className = `sli-badge ${status}`;
        const icon = status === 'up' ? 'check-circle-2' : status === 'down' ? 'x-circle' : 'help-circle';
        const label = status === 'up' ? 'UP' : status === 'down' ? 'DOWN' : 'UNKNOWN';
        badge.innerHTML = `<i data-lucide="${icon}"></i>${label}`;
      }
    });
    lucideRefresh(ctServicesList);
  }

  // Sidebar health dot
  const activeStatuses = Object.entries(State.statuses)
    .filter(([id]) => activeServiceIds.has(id))
    .map(([, status]) => status);
  const upCount = activeStatuses.filter(s => s === 'up').length;
  const downCount = activeStatuses.filter(s => s === 'down').length;
  const total = activeStatuses.length;
  const dot = qs('#global-health-dot');
  const lbl = qs('#global-health-label');
  if (dot && lbl) {
    if (total === 0) { dot.className = 'health-dot'; lbl.textContent = 'Vérification...'; }
    else if (downCount === 0) { dot.className = 'health-dot up'; lbl.textContent = `${upCount} UP`; }
    else if (upCount === 0) { dot.className = 'health-dot down'; lbl.textContent = 'Tout DOWN'; }
    else { dot.className = 'health-dot partial'; lbl.textContent = `${downCount} DOWN`; }
  }

  // Topbar badge
  updateTopbarStatus();
}

function updateStatCounts() {
  const ids = new Set((State.data?.services || []).map(s => s.id));
  const statuses = Object.entries(State.statuses)
    .filter(([id]) => ids.has(id))
    .map(([, status]) => status);
  const total = ids.size;
  const up = statuses.filter(s => s === 'up').length;
  const down = statuses.filter(s => s === 'down').length;

  const statUp   = qs('#stat-up');
  const statDown = qs('#stat-down');
  const statTot  = qs('#stat-total');
  if (statUp)   statUp.textContent   = up;
  if (statDown) statDown.textContent = down;
  if (statTot)  statTot.textContent  = total;
}

function updateTopbarStatus() {
  const ids = new Set((State.data?.services || []).map(s => s.id));
  const statuses = Object.entries(State.statuses)
    .filter(([id]) => ids.has(id))
    .map(([, status]) => status);
  const total = statuses.length;
  const up = statuses.filter(s => s === 'up').length;
  const down = statuses.filter(s => s === 'down').length;
  const el = qs('#topbar-status');
  const txt = qs('#topbar-status-text');
  if (!el || total === 0) return;
  if (down === 0) { el.className = 'status-badge'; txt.textContent = `${up}/${total} en ligne`; }
  else { el.className = `status-badge ${down === total ? 'down' : 'partial'}`; txt.textContent = `${down} DOWN`; }
}

// ─── Routing (hash-based) ─────────────────────────────────────────
const VIEWS = ['dashboard', 'services', 'monitoring', 'infrastructure', 'notes', 'changelog', 'admin'];
const BREADCRUMBS = {
  dashboard: 'Dashboard',
  services: 'Services',
  monitoring: 'Monitoring',
  infrastructure: 'Infrastructure',
  notes: 'Notes',
  changelog: 'Journal de bord',
  admin: 'Administration',
};

function navigateTo(viewId) {
  if (!VIEWS.includes(viewId)) viewId = 'dashboard';

  // Cacher toutes les vues
  qsa('.view').forEach(v => v.classList.remove('active'));
  // Montrer la vue cible
  const el = qs(`#view-${viewId}`);
  if (el) el.classList.add('active');

  // Nav actif
  qsa('.nav-item').forEach(n => n.classList.remove('active'));
  const navEl = qs(`.nav-item[data-view="${viewId}"]`);
  if (navEl) navEl.classList.add('active');

  // Breadcrumb
  const bc = qs('#breadcrumb');
  if (bc) bc.textContent = BREADCRUMBS[viewId] || viewId;

  State.currentView = viewId;
  window.location.hash = viewId;

  // Charger le contenu spécifique
  if (viewId === 'notes')          loadNotesView();
  if (viewId === 'changelog')      loadChangelogView();
  if (viewId === 'admin') {
    renderAdminServicesList();
    renderAdminProxmoxConfigStatus();
    renderAdminWatchersStatus();
    renderAdminMigrationPanel();
  }
  if (viewId === 'monitoring')     renderMonitoringStatusList();
  if (viewId === 'infrastructure') renderInfrastructure();

  if (viewId === 'monitoring')     renderMonitoringOverview();
}

// ─── Rendu d'une service card ─────────────────────────────────────
function renderServiceCard(service, size = 'normal') {
  const status = State.statuses[service.id] || 'unknown';
  const fav = isFavorite(service.id);
  const catColor = getCatColor(service.category);
  const catName  = getCatName(service.category);
  const icon = ICON_MAP[service.icon] || 'server';
  const tags = (service.tags || []).slice(0, 3);
  const statusLabel = status === 'up' ? 'En ligne' : status === 'down' ? 'Hors ligne' : 'Inconnu';

  return `
    <div class="service-card ${size}" data-id="${service.id}" style="border-top:3px solid ${catColor}22">
      <button class="star-btn ${fav ? 'active' : ''}" data-star="${service.id}" title="Favori">
        <i data-lucide="${fav ? 'star' : 'star'}"></i>
      </button>
      <div class="card-header">
        <div class="card-icon" style="background:${catColor}18;color:${catColor}">
          <i data-lucide="${icon}"></i>
        </div>
        <div class="card-status">
          <span class="status-dot ${status}"></span>
          <span class="status-label ${status}">${statusLabel}</span>
        </div>
      </div>
      <div class="card-name">${escHtml(service.name)}</div>
      <div class="card-cat">${escHtml(catName)}</div>
      <div class="card-desc">${escHtml(service.description)}</div>
      <div class="card-footer">
        <div class="card-tags">
          ${tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join('')}
        </div>
        <a href="${escHtml(service.url)}" target="_blank" class="card-open-btn" title="Ouvrir ${escHtml(service.name)}" onclick="event.stopPropagation()">
          <i data-lucide="external-link"></i>
        </a>
      </div>
    </div>`;
}

// ─── Dashboard ───────────────────────────────────────────────────
function renderDashboard() {
  updateStatCounts();
  renderFavorites();
  renderCategoriesOverview();
}

function renderFavorites() {
  const grid = qs('#favorites-grid');
  if (!grid || !State.data) return;
  const favs = State.data.services.filter(s => isFavorite(s.id));
  if (favs.length === 0) {
    grid.innerHTML = `<div class="empty-state"><i data-lucide="star"></i><p>Aucun favori. Cliquez sur ★ sur une carte service.</p></div>`;
  } else {
    grid.innerHTML = favs.map(s => renderServiceCard(s)).join('');
  }
  lucideRefresh(grid);
  attachCardEvents(grid);
}

function renderCategoriesOverview() {
  const overview = qs('#categories-overview');
  if (!overview || !State.data) return;
  overview.innerHTML = State.data.categories.map(cat => {
    const count = State.data.services.filter(s => s.category === cat.id).length;
    return `
      <div class="cat-overview-card" data-cat="${cat.id}" style="--cat-color:${cat.color}">
        <div class="cat-overview-header">
          <div class="cat-overview-icon"><i data-lucide="${cat.icon}"></i></div>
          <div class="cat-overview-name">${escHtml(cat.name)}</div>
        </div>
        <div class="cat-overview-desc">${escHtml(cat.description)}</div>
        <div class="cat-overview-count">${count} service${count > 1 ? 's' : ''}</div>
      </div>`;
  }).join('');
  lucideRefresh(overview);

  qsa('.cat-overview-card', overview).forEach(card => {
    card.addEventListener('click', () => {
      navigateTo('services');
      setTimeout(() => {
        State.filterCategory = card.dataset.cat;
        applyFilters();
        qsa('.filter-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.cat === card.dataset.cat);
        });
      }, 50);
    });
  });
}

// ─── Services view ────────────────────────────────────────────────
function renderServicesView() {
  renderCategoryFilters();
  renderServiceCards();
}

function renderCategoryFilters() {
  const container = qs('#category-filters');
  if (!container || !State.data) return;
  container.innerHTML = State.data.categories.map(cat => `
    <button class="filter-btn" data-cat="${cat.id}" style="--cat-c:${cat.color}">
      <i data-lucide="${cat.icon}"></i> ${escHtml(cat.name)}
    </button>`).join('');
  lucideRefresh(container);

  qsa('.filter-btn[data-cat]', container).forEach(btn => {
    btn.addEventListener('click', () => {
      State.filterCategory = btn.dataset.cat;
      qsa('.filter-btn[data-cat]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyFilters();
    });
  });
}

function applyFilters() {
  if (!State.data) return;
  let services = [...State.data.services];
  if (State.filterStatus === 'up')   services = services.filter(s => State.statuses[s.id] === 'up');
  if (State.filterStatus === 'down') services = services.filter(s => State.statuses[s.id] === 'down');
  if (State.filterCategory !== 'all') services = services.filter(s => s.category === State.filterCategory);

  const grid = qs('#services-grid');
  if (!grid) return;
  grid.innerHTML = services.length
    ? services.map(s => renderServiceCard(s, 'large')).join('')
    : `<div class="empty-state"><i data-lucide="search-x"></i><p>Aucun service ne correspond au filtre.</p></div>`;
  lucideRefresh(grid);
  attachCardEvents(grid);
}

function renderServiceCards() {
  State.filterCategory = 'all';
  State.filterStatus   = 'all';
  applyFilters();
}

function attachCardEvents(ctx = document) {
  qsa('.service-card', ctx).forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.star-btn') || e.target.closest('.card-open-btn')) return;
      openServiceModal(card.dataset.id);
    });
  });
  qsa('.star-btn', ctx).forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.star;
      toggleFavorite(id);
      btn.classList.toggle('active', isFavorite(id));
      if (State.currentView === 'dashboard') renderFavorites();
    });
  });
}

// ─── Service Modal ────────────────────────────────────────────────
function openServiceModal(id) {
  const service = State.data?.services.find(s => s.id === id);
  if (!service) return;
  const modal = qs('#service-modal');
  const status = State.statuses[id] || 'unknown';
  const icon = ICON_MAP[service.icon] || 'server';
  const catColor = getCatColor(service.category);
  const catName  = getCatName(service.category);
  const statusLabel = status === 'up' ? '● En ligne' : status === 'down' ? '● Hors ligne' : '● Inconnu';

  // Header
  qs('#modal-icon').innerHTML = `<i data-lucide="${icon}"></i>`;
  qs('#modal-icon').style.background = `${catColor}18`;
  qs('#modal-icon').style.color = catColor;
  qs('#modal-name').textContent = service.name;
  qs('#modal-category-badge').textContent = catName;
  qs('#modal-status-badge').className    = `status-badge-modal ${status}`;
  qs('#modal-status-badge').textContent  = statusLabel;

  const promoteBtn = qs('#modal-promote-btn');
  const rejectBtn = qs('#modal-reject-btn');
  if (promoteBtn) {
    promoteBtn.dataset.serviceId = service.id;
    promoteBtn.classList.toggle('hidden', !service.autoDiscovered);
    promoteBtn.disabled = false;
  }
  if (rejectBtn) {
    rejectBtn.dataset.serviceId = service.id;
    rejectBtn.classList.toggle('hidden', !service.autoDiscovered);
    rejectBtn.disabled = false;
  }

  // Body
  qs('#modal-long-desc').textContent = service.longDescription || service.description;
  const domainEl = qs('#modal-domain');
  domainEl.textContent = service.domain || service.url;
  domainEl.href = service.domain || service.url;

  const urlEl = qs('#modal-url');
  urlEl.textContent = `${service.ip || '—'}:${service.port || '—'}`;
  urlEl.href = service.url;

  qs('#modal-container').textContent = service.container || '—';
  qs('#modal-protocol').textContent  = (service.protocol || 'http').toUpperCase();

  // Fonctionnalités
  const feats = (Array.isArray(service.features) && service.features.length)
    ? service.features
    : inferServiceFeatures(service);
  const featsSection = qs('#modal-features-section');
  if (feats.length) {
    qs('#modal-features').innerHTML = feats.map(f => `<li>${escHtml(f)}</li>`).join('');
    featsSection.classList.remove('hidden');
  } else { featsSection.classList.add('hidden'); }

  // Tags
  const tags = service.tags || [];
  qs('#modal-tags').innerHTML = tags.map(t => `<span class="badge" style="background:${catColor}15;color:${catColor};border-color:${catColor}30">${escHtml(t)}</span>`).join('');

  // Dashboards Grafana
  const dashSection = qs('#modal-dashboards-section');
  if (service.dashboards?.length) {
    qs('#modal-dashboards').innerHTML = service.dashboards.map(d => `
      <a href="${escHtml(d.url)}" target="_blank" class="dashboard-link">
        <i data-lucide="${d.icon || 'bar-chart-2'}"></i>
        ${escHtml(d.name)}
        <i data-lucide="external-link" style="margin-left:auto;opacity:.5"></i>
      </a>`).join('');
    dashSection.classList.remove('hidden');
  } else { dashSection.classList.add('hidden'); }

  // Credentials
  const credsSection = qs('#modal-creds-section');
  if (service.credentials) {
    const lines = Object.entries(service.credentials).map(([k, v]) => `${k}: ${v}`).join('\n');
    qs('#modal-creds').textContent = lines;
    credsSection.classList.remove('hidden');
  } else { credsSection.classList.add('hidden'); }

  // Bouton accès
  const openBtn = qs('#modal-open-btn');
  openBtn.href = service.url;
  openBtn.textContent = '';
  openBtn.innerHTML = `<i data-lucide="external-link"></i> Ouvrir ${escHtml(service.name)}`;

  modal.classList.remove('hidden');
  lucideRefresh(modal);
}

function closeModal() {
  qs('#service-modal')?.classList.add('hidden');
}

function inferServiceFeatures(service) {
  if (!service || typeof service !== 'object') return [];
  const features = [];

  if (service.autoDiscovered) features.push('Service détecté automatiquement par la découverte live.');
  if (service.domain) features.push(`Accès interne via domaine: ${service.domain}`);
  if (service.ip || service.port) features.push(`Accès direct: ${service.ip || 'IP inconnue'}:${service.port || 'port inconnu'}`);
  if (service.protocol) features.push(`Protocole: ${String(service.protocol).toUpperCase()}`);
  if (Array.isArray(service.tags) && service.tags.length) features.push(`Mots-clés: ${service.tags.slice(0, 4).join(', ')}`);
  if (Array.isArray(service.dashboards) && service.dashboards.length) features.push(`Dashboards liés: ${service.dashboards.length}`);

  return features;
}

// ─── Container Modal ──────────────────────────────────────────────
function openContainerModal(containerId) {
  const ct = State.data?.containers?.find(c => c.id === containerId);
  if (!ct) return;

  setCtModalPowerState('');

  const modal = qs('#container-modal');
  if (modal) modal.dataset.ctId = String(ct.id || '');
  const ctColor = getContainerColor(ct) || '#6366f1';

  const iconEl = qs('#ct-modal-icon');
  if (iconEl) {
    iconEl.style.background = `${ctColor}18`;
    iconEl.style.color = ctColor;
  }

  qs('#ct-modal-name').textContent = ct.name || ct.id;

  const displayStatus = getContainerDisplayStatus(ct);
  const isRunning = displayStatus === 'running';
  const isStarting = displayStatus === 'starting';
  const isStopping = displayStatus === 'stopping';
  const isBusy = isStarting || isStopping || displayStatus === 'backup' || displayStatus === 'prelaunch' || displayStatus === 'paused';
  const startBtn = qs('#ct-modal-start-btn');
  const stopBtn = qs('#ct-modal-stop-btn');
  if (startBtn) {
    startBtn.dataset.ctType = ct.type || 'lxc';
    startBtn.dataset.ctVmid = String(ct.vmid || '');
    startBtn.dataset.ctId = ct.id || '';
    startBtn.disabled = isRunning || isBusy;
  }
  if (stopBtn) {
    stopBtn.dataset.ctType = ct.type || 'lxc';
    stopBtn.dataset.ctVmid = String(ct.vmid || '');
    stopBtn.dataset.ctId = ct.id || '';
    stopBtn.disabled = !isRunning || isBusy;
  }

  const ip = ct.ip || '—';
  const os = ct.os || '—';
  qs('#ct-modal-ip').textContent = ip;
  qs('#ct-modal-os').textContent = os;
  qs('#ct-modal-ip-value').textContent = ip;
  qs('#ct-modal-os-value').textContent = os;
  qs('#ct-modal-desc').textContent = ct.description || '';

  const resources = ct.resources || {};
  qs('#ct-modal-cpu').textContent = resources.cpu ? String(resources.cpu) : '—';
  qs('#ct-modal-ram').textContent = resources.ram ? String(resources.ram) : '—';

  const resEl = qs('#ct-modal-resources');
  const resEntries = Object.entries(resources);
  if (resEntries.length) {
    resEl.innerHTML = resEntries.map(([k, v]) =>
      `<span class="badge" style="background:${ctColor}15;color:${ctColor};border-color:${ctColor}30">${escHtml(k)}: ${escHtml(String(v))}</span>`
    ).join('');
    qs('#ct-modal-resources-section').classList.remove('hidden');
  } else {
    resEl.innerHTML = '';
    qs('#ct-modal-resources-section').classList.add('hidden');
  }

  const servicesEl = qs('#ct-modal-services');
  const serviceIds = (ct.services || []).filter(Boolean);
  const services = serviceIds
    .map(id => State.data?.services?.find(s => s.id === id))
    .filter(Boolean);

  if (!services.length) {
    servicesEl.innerHTML = `<div class="empty-state" style="padding:16px"><p>Aucun service déclaré pour ce conteneur.</p></div>`;
  } else {
    servicesEl.innerHTML = services.map(s => {
      const status = State.statuses[s.id] || 'unknown';
      const badgeLabel = status === 'up' ? 'UP' : status === 'down' ? 'DOWN' : 'UNKNOWN';
      const icon = status === 'up' ? 'check-circle-2' : status === 'down' ? 'x-circle' : 'help-circle';
      return `
        <div class="status-list-item" data-svc-open="${s.id}" style="cursor:pointer">
          <span class="status-dot ${status}"></span>
          <span class="sli-name">${escHtml(s.name)}</span>
          <span class="sli-ip">${escHtml(s.ip || '—')}:${s.port || '—'}</span>
          <span class="sli-badge ${status}"><i data-lucide="${icon}"></i>${badgeLabel}</span>
          <a href="${escHtml(s.url)}" target="_blank" class="card-open-btn" title="Ouvrir" onclick="event.stopPropagation()" style="margin-left:8px">
            <i data-lucide="external-link"></i>
          </a>
        </div>`;
    }).join('');

    qsa('[data-svc-open]', servicesEl).forEach(row => {
      row.addEventListener('click', () => openServiceModal(row.dataset.svcOpen));
    });
  }

  modal.classList.remove('hidden');
  lucideRefresh(modal);
}

function closeContainerModal() {
  const modal = qs('#container-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  delete modal.dataset.ctId;
}

function setCtModalPowerState(label = '') {
  const el = qs('#ct-modal-power-state');
  if (!el) return;
  const text = String(label || '').trim();
  if (!text) {
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  el.textContent = text;
  el.classList.remove('hidden');
}

// ─── Monitoring view ──────────────────────────────────────────────
function renderMonitoringStatusList() {
  const list = qs('#monitoring-status-list');
  if (!list || !State.data) return;
  list.innerHTML = State.data.services.map(s => {
    const status = State.statuses[s.id] || 'unknown';
    const icon = status === 'up' ? 'check-circle-2' : status === 'down' ? 'x-circle' : 'help-circle';
    const label = status === 'up' ? 'UP' : status === 'down' ? 'DOWN' : 'UNKNOWN';
    return `
      <div class="status-list-item" data-id="${s.id}">
        <span class="status-dot ${status}"></span>
        <span class="sli-name">${escHtml(s.name)}</span>
        <span class="sli-ip">${escHtml(s.ip || '—')}:${s.port || '—'}</span>
        <span class="sli-badge ${status}"><i data-lucide="${icon}"></i>${label}</span>
      </div>`;
  }).join('');
  lucideRefresh(list);
}

function humanOrDash(v) {
  return (v === null || v === undefined || v === '' ? '—' : String(v));
}

function getStoragePoolKey(pool) {
  return String(pool?.name || pool?.id || 'storage');
}

function pushStoragePoolHistory(poolName, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  if (!State.storagePoolsHistory[poolName]) State.storagePoolsHistory[poolName] = [];
  pushHistory(State.storagePoolsHistory[poolName], value);
}

const STORAGE_MODAL_PREFS_KEY = 'proxmox_interfaces_storage_modal_sections';
let currentStorageModalPoolKey = null;
const MONITORING_COLLAPSIBLE_PREFS_KEY = 'proxmox_interfaces_monitoring_collapsible_sections';

function loadMonitoringCollapsiblePrefs() {
  try {
    const raw = localStorage.getItem(MONITORING_COLLAPSIBLE_PREFS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch {
    return {};
  }
}

function saveMonitoringCollapsiblePrefs(prefs) {
  try {
    localStorage.setItem(MONITORING_COLLAPSIBLE_PREFS_KEY, JSON.stringify(prefs || {}));
  } catch {
    // ignore quota/security errors
  }
}

function setupMonitoringCollapsibles() {
  const prefs = loadMonitoringCollapsiblePrefs();
  const sections = qsa('details[data-collapsible-key]');
  sections.forEach((el) => {
    const key = el.dataset.collapsibleKey;
    if (!key) return;

    if (Object.prototype.hasOwnProperty.call(prefs, key)) {
      el.open = !!prefs[key];
    }

    el.addEventListener('toggle', () => {
      const next = loadMonitoringCollapsiblePrefs();
      next[key] = !!el.open;
      saveMonitoringCollapsiblePrefs(next);
    });
  });
}

function loadStorageModalSectionPrefs(poolKey) {
  try {
    const raw = localStorage.getItem(STORAGE_MODAL_PREFS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;

    const entry = poolKey ? obj[poolKey] : null;
    if (!entry || typeof entry !== 'object') return null;

    return {
      maintenanceOpen: entry.maintenanceOpen !== false,
      detailsOpen: !!entry.detailsOpen,
    };
  } catch {
    return null;
  }
}

function saveStorageModalSectionPrefs() {
  const maintenance = qs('#sp-modal-maintenance-section');
  const details = qs('#sp-modal-details-section');
  if (!maintenance || !details || !currentStorageModalPoolKey) return;
  try {
    const raw = localStorage.getItem(STORAGE_MODAL_PREFS_KEY);
    const prefs = raw ? JSON.parse(raw) : {};
    const next = (prefs && typeof prefs === 'object') ? prefs : {};

    next[currentStorageModalPoolKey] = {
      maintenanceOpen: !!maintenance.open,
      detailsOpen: !!details.open,
    };

    localStorage.setItem(STORAGE_MODAL_PREFS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function openStoragePoolModal(pool) {
  const modal = qs('#storage-pool-modal');
  if (!modal || !pool) return;

  const poolKey = getStoragePoolKey(pool);
  currentStorageModalPoolKey = poolKey;

  const prefs = loadStorageModalSectionPrefs(poolKey);
  const maintenanceSection = qs('#sp-modal-maintenance-section');
  const detailsSection = qs('#sp-modal-details-section');
  if (maintenanceSection && detailsSection) {
    maintenanceSection.open = prefs ? !!prefs.maintenanceOpen : true;
    detailsSection.open = prefs ? !!prefs.detailsOpen : false;
  }

  const contentMap = {
    images: 'disques VM',
    rootdir: 'disques CT',
    vztmpl: 'templates CT',
    iso: 'images ISO',
    backup: 'sauvegardes',
    snippets: 'snippets cloud-init',
    import: 'imports',
  };

  const usedGB = (typeof pool.used === 'number') ? (pool.used / (1024 * 1024 * 1024)) : null;
  const totalGB = (typeof pool.total === 'number') ? (pool.total / (1024 * 1024 * 1024)) : null;
  const availGB = (typeof pool.avail === 'number') ? (pool.avail / (1024 * 1024 * 1024)) : null;
  const pct = Number.isFinite(pool.usedPct)
    ? pool.usedPct
    : ((usedGB !== null && totalGB && totalGB > 0) ? +((usedGB / totalGB) * 100).toFixed(1) : null);

  const formatBytes = (bytes) => {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i += 1;
    }
    return `${v.toFixed(v >= 10 ? 1 : 2)} ${units[i]}`;
  };

  const formatDuration = (days) => {
    if (!Number.isFinite(days) || days <= 0) return '—';
    if (days < 1) return `${Math.round(days * 24)} h`;
    if (days < 30) return `${days.toFixed(1)} j`;
    const months = days / 30;
    if (months < 12) return `${months.toFixed(1)} mois`;
    return `${(months / 12).toFixed(1)} ans`;
  };

  const formatRate = (bps) => {
    if (typeof bps !== 'number' || !Number.isFinite(bps)) return '—';
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    let v = bps;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i += 1;
    }
    return `${v.toFixed(v >= 10 ? 1 : 2)} ${units[i]}`;
  };

  const funcs = (Array.isArray(pool.content) ? pool.content : [])
    .map(x => String(x || '').trim())
    .filter(Boolean)
    .map(x => contentMap[x] || x);

  const hist = (State.storagePoolsHistory[poolKey] || []).filter(
    (p) => typeof p?.t === 'number' && typeof p?.v === 'number'
  );

  let trendPctPerDay = null;
  let eta95 = null;
  if (hist.length >= 2) {
    const first = hist[0];
    const last = hist[hist.length - 1];
    const deltaPct = last.v - first.v;
    const deltaDays = (last.t - first.t) / (1000 * 60 * 60 * 24);
    if (deltaDays > 0) {
      trendPctPerDay = deltaPct / deltaDays;
      if (Number.isFinite(pct) && trendPctPerDay > 0 && pct < 95) {
        eta95 = (95 - pct) / trendPctPerDay;
      }
    }
  }

  const level = !Number.isFinite(pct)
    ? 'inconnu'
    : pct >= 95
      ? 'critique'
      : pct >= 85
        ? 'élevé'
        : pct >= 70
          ? 'surveillance'
          : 'normal';

  const levelClass = level === 'élevé' ? 'eleve' : (level === 'inconnu' ? 'unknown' : level);

  const maintenanceTips = [];
  if (pool?.active === 0) maintenanceTips.push('- Pool inactif: vérifier montage/service stockage côté Proxmox.');
  if (pool?.enabled === 0) maintenanceTips.push('- Pool désactivé: confirmer si c’est intentionnel (maintenance) ou incident.');
  if (Number.isFinite(pct) && pct >= 95) maintenanceTips.push('- URGENT: libérer de l’espace immédiatement ou étendre le volume.');
  else if (Number.isFinite(pct) && pct >= 85) maintenanceTips.push('- Recommandé: planifier purge/rotation et vérifier la croissance hebdomadaire.');
  else if (Number.isFinite(pct) && pct >= 70) maintenanceTips.push('- Surveillance: définir un seuil d’alerte à 80-85%.');
  if (funcs.includes('sauvegardes')) maintenanceTips.push('- Sauvegardes: contrôler rétention/rotation et validité des derniers backups.');
  if (pool?.shared === 0 && funcs.includes('sauvegardes')) maintenanceTips.push('- Copie externe: vérifier qu’une réplication/offsite des sauvegardes est bien active.');
  if (pool?.shared === 1) maintenanceTips.push('- Pool partagé: vérifier latence/réseau et disponibilité du backend.');
  if (!maintenanceTips.length) maintenanceTips.push('- Aucun signal de risque immédiat détecté sur ce pool.');

  const details = {
    pool: poolKey,
    type: pool?.type || null,
    shared: pool?.shared,
    active: pool?.active,
    enabled: pool?.enabled,
    content: Array.isArray(pool.content) ? pool.content : [],
    path: pool?.path || null,
    usedBytes: pool?.used ?? null,
    totalBytes: pool?.total ?? null,
    availBytes: pool?.avail ?? null,
    usedPercent: pct,
    trendPercentPerDay: Number.isFinite(trendPctPerDay) ? +trendPctPerDay.toFixed(4) : null,
    etaTo95Days: Number.isFinite(eta95) ? +eta95.toFixed(3) : null,
    samples: hist.length,
    lastSampleAt: hist.length ? new Date(hist[hist.length - 1].t).toISOString() : null,
  };

  const host = State.latestOverviewProxmox || {};
  const ioRead = formatRate(host.ioReadBps);
  const ioWrite = formatRate(host.ioWriteBps);
  const ioPerDisk = Array.isArray(host.ioPerDisk) ? host.ioPerDisk : [];
  const disks = Array.isArray(host.physicalDisks) ? host.physicalDisks : [];
  const hostPools = Array.isArray(host.storagePools) ? host.storagePools : [];
  const smartHoursSummary = host.smartPowerOnHoursSummary || null;
  const mappedDiskKeys = Array.isArray(pool?.mappedDiskKeys) ? pool.mappedDiskKeys : [];
  const normalizeDiskKey = (value) => String(value || '').toLowerCase().trim();
  const mappedSet = new Set(mappedDiskKeys.map(normalizeDiskKey));
  const poolDisks = mappedSet.size
    ? disks.filter((d) => mappedSet.has(normalizeDiskKey(d?.devPath)))
    : [];

  const sharedWithPools = hostPools
    .filter((p) => String(p?.name || '') !== poolKey)
    .filter((p) => {
      const keys = new Set((Array.isArray(p?.mappedDiskKeys) ? p.mappedDiskKeys : []).map(normalizeDiskKey));
      for (const key of mappedSet) {
        if (keys.has(key)) return true;
      }
      return false;
    })
    .map((p) => String(p?.name || '').trim())
    .filter(Boolean);

  const associationText = mappedDiskKeys.length
    ? `${mappedDiskKeys.join(', ')} (méthode: ${pool?.mappingMethod || 'unknown'})${sharedWithPools.length ? ` · partagé avec: ${sharedWithPools.join(', ')}` : ''}`
    : `non corrélé (méthode: ${pool?.mappingMethod || 'none'})`;

  const associationState = !mappedDiskKeys.length
    ? 'non-correle'
    : (sharedWithPools.length ? 'partage' : 'dedie');
  const associationLabel = associationState === 'dedie'
    ? 'Association: dédié'
    : associationState === 'partage'
      ? 'Association: partagé'
      : 'Association: non corrélé';

  const badSmart = poolDisks.filter((d) => {
    const s = String(d?.smartStatus || '').toLowerCase();
    return s && !['passed', 'ok', 'healthy', 'good'].includes(s);
  });

  const diskSummary = poolDisks.length
    ? poolDisks.map((d) => {
      const status = d.smartStatus || 'inconnu';
      const hours = Number.isFinite(d.powerOnHours) ? `${Math.round(d.powerOnHours)}h` : 'h?';
      const wear = Number.isFinite(d.wearout) ? `${d.wearout}%` : 'wear?';
      const temp = Number.isFinite(d.temperatureC) ? `${Math.round(d.temperatureC)}°C` : 'temp?';
      const ident = d.model || d.serial || d.devPath || 'disk';
      return `${ident} [SMART:${status} · ${hours} · ${temp} · ${wear}]`;
    }).join('\n')
    : `Aucune corrélation fiable pool → disque physique (méthode: ${pool?.mappingMethod || 'none'}). Données SMART non affichées pour éviter une fausse association.`;

  const ioPerDiskSummary = ioPerDisk.length
    ? ioPerDisk.slice(0, 12).map((row) => {
      const name = row.disk || 'disk';
      return `${name} [read:${formatRate(row.readBps)} · write:${formatRate(row.writeBps)}]`;
    }).join('\n')
    : 'Aucune donnée I/O par disque remontée (fallback total hôte uniquement).';

  const shortDiskName = (d) => {
    const raw = d?.devPath || d?.serial || d?.model || 'disk';
    if (typeof raw !== 'string') return 'disk';
    const clean = raw.replace(/^\/dev\//, '').trim();
    return clean || 'disk';
  };

  const thermalLevel = (tempC) => {
    if (!Number.isFinite(tempC)) return 'inconnu';
    if (tempC >= 60) return 'critique';
    if (tempC >= 50) return 'élevé';
    if (tempC >= 40) return 'surveillance';
    return 'normal';
  };

  const diskSmartLines = poolDisks
    .map((d) => {
      const name = shortDiskName(d);
      const hours = Number.isFinite(d?.powerOnHours) ? `${Math.round(d.powerOnHours)} h` : 'h?';
      const tempValue = Number.isFinite(d?.temperatureC) ? Math.round(d.temperatureC) : null;
      const temp = tempValue !== null ? `${tempValue}°C` : 'temp?';
      const tempLevel = thermalLevel(tempValue);
      const status = d?.smartStatus || 'inconnu';
      return `${name}: ${hours} · ${temp} (${tempLevel}) · SMART ${status}`;
    })
    .filter(Boolean);

  const hotDisks = poolDisks.filter((d) => {
    const tempValue = Number.isFinite(d?.temperatureC) ? Math.round(d.temperatureC) : null;
    const level = thermalLevel(tempValue);
    return level === 'élevé' || level === 'critique';
  });

  if (hotDisks.length) {
    maintenanceTips.unshift(`- Température disque: ${hotDisks.length} disque(s) en niveau élevé/critique.`);
  }
  if (badSmart.length) {
    maintenanceTips.unshift(`- ATTENTION: ${badSmart.length} disque(s) avec statut SMART non nominal.`);
  }

  const diskHours = poolDisks
    .map((d) => d?.powerOnHours)
    .filter((h) => Number.isFinite(h));

  let diskHoursText = 'non disponible';
  if (diskSmartLines.length) {
    diskHoursText = `\n- ${diskSmartLines.join('\n- ')}`;
  } else if (poolDisks.length === 0) {
    diskHoursText = 'non corrélé à ce pool';
  } else if (diskHours.length === 1) {
    diskHoursText = `${diskHours[0]} h`;
  } else if (diskHours.length > 1) {
    const minHours = Math.min(...diskHours);
    const maxHours = Math.max(...diskHours);
    const avgHours = Math.round(diskHours.reduce((sum, h) => sum + h, 0) / diskHours.length);
    diskHoursText = `min ${minHours} h · moy ${avgHours} h · max ${maxHours} h`;
  } else if (smartHoursSummary && Number.isFinite(smartHoursSummary.min) && Number.isFinite(smartHoursSummary.max)) {
    const minHours = Math.round(smartHoursSummary.min);
    const maxHours = Math.round(smartHoursSummary.max);
    const avgHours = Number.isFinite(smartHoursSummary.avg) ? Math.round(smartHoursSummary.avg) : null;
    diskHoursText = avgHours !== null
      ? `min ${minHours} h · moy ${avgHours} h · max ${maxHours} h`
      : `min ${minHours} h · max ${maxHours} h`;
  }

  const maintenanceText = [
    `Occupation: ${Number.isFinite(pct) ? `${pct}%` : '—'}`,
    `Association disque: ${associationText}`,
    `Tendance: ${Number.isFinite(trendPctPerDay) ? `${trendPctPerDay >= 0 ? '+' : ''}${trendPctPerDay.toFixed(2)} point(s)/jour` : 'insuffisante'}`,
    `Disques (SMART): ${diskHoursText}`,
    '',
    ...maintenanceTips,
  ].join('\n');

  qs('#sp-modal-title').textContent = `Pool ${getStoragePoolKey(pool)}`;
  qs('#sp-modal-name').textContent = getStoragePoolKey(pool);
  qs('#sp-modal-type').textContent = `type:${pool?.type || 'n/a'}`;
  qs('#sp-modal-mode').textContent = pool?.shared === 1 ? 'partagé' : pool?.shared === 0 ? 'local' : 'mode inconnu';
  qs('#sp-modal-state').textContent = pool?.active === 1 ? 'actif' : pool?.active === 0 ? 'inactif' : 'état inconnu';
  qs('#sp-modal-enabled').textContent = pool?.enabled === 1 ? 'activé' : pool?.enabled === 0 ? 'désactivé' : 'enable inconnu';
  qs('#sp-modal-usage').textContent = (usedGB !== null && totalGB !== null)
    ? `${usedGB.toFixed(1)} / ${totalGB.toFixed(1)} GB${pct !== null ? ` (${pct}%)` : ''}`
    : '—';
  qs('#sp-modal-total').textContent = formatBytes(pool?.total) + (totalGB !== null ? ` (${totalGB.toFixed(1)} GB)` : '');
  qs('#sp-modal-free').textContent = formatBytes(pool?.avail) + (availGB !== null ? ` (${availGB.toFixed(1)} GB)` : '');
  qs('#sp-modal-path').textContent = pool?.path || '—';
  qs('#sp-modal-functions').textContent = funcs.length ? funcs.join(', ') : 'Non remontées';

  const levelEl = qs('#sp-modal-level');
  if (levelEl) {
    levelEl.className = `sp-maintenance-level ${levelClass}`;
    levelEl.textContent = `Niveau: ${level}`;
  }

  const associationEl = qs('#sp-modal-association-level');
  if (associationEl) {
    associationEl.className = `sp-maintenance-level ${associationState}`;
    associationEl.textContent = associationLabel;
  }

  qs('#sp-modal-maintenance').textContent = maintenanceText;
  qs('#sp-modal-details').textContent = [
    JSON.stringify(details, null, 2),
    '',
    `Association pool/disque: ${associationText}`,
    '',
    `I/O hôte globale (instantané): read=${ioRead} | write=${ioWrite}`,
    '',
    'I/O par disque (best effort):',
    ioPerDiskSummary,
    '',
    'Disques physiques (best effort):',
    diskSummary,
  ].join('\n');

  modal.classList.remove('hidden');
  lucideRefresh(modal);
}

function closeStoragePoolModal() {
  qs('#storage-pool-modal')?.classList.add('hidden');
  currentStorageModalPoolKey = null;
}

function renderMonitoringStorage(pools) {
  const grid = qs('#monitoring-storage-grid');
  State.storagePoolsLatest = Array.isArray(pools) ? pools.slice() : [];

  const validPools = Array.isArray(pools)
    ? pools
      .filter(p => p && typeof p.total === 'number' && Number.isFinite(p.total) && p.total > 0)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    : [];

  if (!validPools.length) {
    grid.innerHTML = `<div class="empty-state" style="padding:20px"><p>Aucun pool de stockage disponible.</p></div>`;
    State.storagePoolsPoints = {};
    return;
  }

  const activeKeys = new Set(validPools.map(getStoragePoolKey));
  Object.keys(State.storagePoolsHistory).forEach((k) => {
    if (!activeKeys.has(k)) delete State.storagePoolsHistory[k];
  });

  validPools.forEach((pool) => {
    const key = getStoragePoolKey(pool);
    const pct = Number.isFinite(pool.usedPct)
      ? pool.usedPct
      : ((typeof pool.used === 'number' && typeof pool.total === 'number' && pool.total > 0)
        ? (pool.used / pool.total) * 100
        : null);
    pushStoragePoolHistory(key, pct);
  });

  // Si la vue Monitoring n'est pas affichée, on conserve quand même l'historique
  // (alimenté en arrière-plan via renderMonitoringOverview), sans tenter de dessiner.
  if (!grid) return;

  const buildPoolChips = (pool) => {
    const chips = [];
    if (pool?.type) chips.push({ label: `type:${String(pool.type)}`, kind: 'type' });

    if (pool?.active === 1) chips.push({ label: 'actif', kind: 'state' });
    else if (pool?.active === 0) chips.push({ label: 'inactif', kind: 'state' });

    if (pool?.shared === 1) chips.push({ label: 'partagé', kind: 'mode' });
    else if (pool?.shared === 0) chips.push({ label: 'local', kind: 'mode' });

    if (!chips.length) chips.push({ label: 'métadonnées indisponibles', kind: 'unknown' });
    return chips;
  };

  grid.innerHTML = validPools.map((pool, idx) => {
    const usedGB = (typeof pool.used === 'number') ? (pool.used / (1024 * 1024 * 1024)) : null;
    const totalGB = (typeof pool.total === 'number') ? (pool.total / (1024 * 1024 * 1024)) : null;
    const pct = Number.isFinite(pool.usedPct)
      ? pool.usedPct
      : ((usedGB !== null && totalGB && totalGB > 0) ? +((usedGB / totalGB) * 100).toFixed(1) : null);
    const chipItems = buildPoolChips(pool);
    const chips = chipItems
      .map((chip) => `<span class="storage-cap-chip ${chip.kind}">${escHtml(chip.label)}</span>`)
      .join('');
    const chipsTitle = chipItems.map((chip) => chip.label).join(' · ');

    return `
      <div class="storage-monitor-card">
        <div class="overview-header">
          <span class="overview-label"><i data-lucide="database"></i> ${escHtml(getStoragePoolKey(pool))}</span>
          <span class="overview-value">${usedGB !== null && totalGB !== null ? `${usedGB.toFixed(1)} / ${totalGB.toFixed(1)} GB` : '—'}</span>
        </div>
        <div class="spark" style="--c: rgba(245,158,11,0.95);">
          <svg class="sparkline" id="storage-pool-spark-${idx}" viewBox="0 0 100 30" preserveAspectRatio="none">
            <path class="spark-area" d=""></path>
            <path class="spark-line" d=""></path>
            <line class="spark-cursor" x1="0" y1="0" x2="0" y2="30"></line>
            <circle class="spark-dot" cx="0" cy="0" r="2.5"></circle>
          </svg>
        </div>
        <div class="storage-monitor-meta">Utilisation: ${pct !== null ? `${pct}%` : '—'}</div>
        <div class="storage-capabilities" title="${escHtml(chipsTitle)}">
          ${chips}
          <button type="button" class="storage-cap-chip more" data-storage-more="${idx}" title="Voir le détail du disque" aria-label="Voir le détail du disque">
            <i data-lucide="plus"></i>
          </button>
        </div>
      </div>`;
  }).join('');

  State.storagePoolsPoints = {};
  validPools.forEach((pool, idx) => {
    const key = getStoragePoolKey(pool);
    const history = getWindowedHistory(State.storagePoolsHistory[key] || []);
    const points = drawSparkline(`#storage-pool-spark-${idx}`, history) || [];
    State.storagePoolsPoints[key] = points;
    setupSparkTooltip(`#storage-pool-spark-${idx}`, () => State.storagePoolsPoints[key] || []);
  });

  qsa('[data-storage-more]', grid).forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = Number.parseInt(btn.dataset.storageMore || '', 10);
      if (!Number.isFinite(idx) || !validPools[idx]) return;
      openStoragePoolModal(validPools[idx]);
    });
  });

  lucideRefresh(grid);
}

function renderMonitoringInfraMetrics() {
  const list = qs('#monitoring-infra-list');
  if (!list || !State.data) return;
  const containers = (State.data.containers || []).slice().sort((a, b) => (a.vmid || 0) - (b.vmid || 0));
  if (!containers.length) {
    list.innerHTML = `<div class="empty-state"><p>Aucune machine détectée.</p></div>`;
    return;
  }

  list.innerHTML = containers.map(c => {
    const r = c.resources || {};
    const status = getContainerDisplayStatus(c);
    const statusLabel = getInfraStatusLabel(status);
    const dotStatus = getInfraDotStatus(status);
    const typePill = c.type === 'qemu' ? 'VM' : 'CT';
    const cpu = humanOrDash(r.cpu);
    const mem = `${humanOrDash(r.memUsed)} / ${humanOrDash(r.ram)}`;
    const disk = `${humanOrDash(r.diskUsed)} / ${humanOrDash(r.disk)}`;
    const uptime = humanOrDash(r.uptime);

    // Desktop layout (grid)
    const row = `
      <div class="infra-row" data-ct="${escHtml(c.id)}">
        <div class="infra-name" data-k="Machine"><span>${escHtml(c.hostname || c.name || c.id)}</span><span class="mini-pill">${typePill} ${c.vmid || ''}</span></div>
        <div class="infra-ip" data-k="IP">${escHtml(c.ip || '—')}</div>
        <div class="infra-stat" data-k="Statut"><span class="infra-badge ${statusLabel}"><span class="status-dot ${dotStatus}"></span>${escHtml(statusLabel)}</span></div>
        <div class="infra-cpu" data-k="CPU">${escHtml(cpu)}</div>
        <div class="infra-mem" data-k="RAM">${escHtml(mem)}</div>
        <div class="infra-disk" data-k="Disque">${escHtml(disk)}</div>
        <div class="infra-uptime" data-k="Uptime">${escHtml(uptime)}</div>
      </div>`;
    return row;
  }).join('');

  // clic -> modal conteneur
  qsa('.infra-row[data-ct]', list).forEach(row => {
    row.addEventListener('click', () => openContainerModal(row.dataset.ct));
  });
}

// ─── Monitoring overview (jauges) ────────────────────────────────
function toGB(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return null;
  return bytes / (1024 * 1024 * 1024);
}

async function renderMonitoringOverview() {
  const overview = await fetchOverview();
  if (!overview?.proxmox) return;
  State.latestOverviewProxmox = overview.proxmox;

  const cpuText = qs('#ov-cpu-text');
  const ramText = qs('#ov-ram-text');
  const diskText = qs('#ov-disk-text');
  const vramText = qs('#ov-vram-text');
  const vramHint = qs('#ov-vram-hint');

  const cpuPercent = overview.proxmox.cpuPercent;
  if (cpuText) cpuText.textContent = cpuPercent !== null ? `${cpuPercent}%` : '—';

  const memUsedGB = toGB(overview.proxmox.memUsed);
  const memTotalGB = toGB(overview.proxmox.memTotal);
  if (ramText) {
    ramText.textContent = (memUsedGB !== null && memTotalGB !== null)
      ? `${memUsedGB.toFixed(1)} / ${memTotalGB.toFixed(1)} GB`
      : '—';
  }

  const diskUsedGB = toGB(overview.proxmox.diskUsed);
  const diskTotalGB = toGB(overview.proxmox.diskTotal);
  if (diskText) {
    diskText.textContent = (diskUsedGB !== null && diskTotalGB !== null)
      ? `${diskUsedGB.toFixed(1)} / ${diskTotalGB.toFixed(1)} GB`
      : '—';
  }

  const storagePools = Array.isArray(overview.proxmox.storagePools) ? overview.proxmox.storagePools : [];
  State.storagePoolsLatest = storagePools;
  renderMonitoringStorage(storagePools);

  const v = overview.vram;
  if (v && typeof v.usedMB === 'number' && typeof v.totalMB === 'number') {
    if (vramText) vramText.textContent = `${v.usedMB.toFixed(0)} / ${v.totalMB.toFixed(0)} MB`;
    if (vramHint) vramHint.textContent = '';
  } else {
    if (vramText) vramText.textContent = 'Non dispo';
    if (vramHint) vramHint.textContent = '';
  }

  if (vramHint) {
    vramHint.classList.toggle('hidden', !vramHint.textContent.trim());
  }

  // Historique (en %) pour la tendance
  const ramPct = (memUsedGB !== null && memTotalGB) ? (memUsedGB / memTotalGB) * 100 : null;
  const diskPct = (diskUsedGB !== null && diskTotalGB) ? (diskUsedGB / diskTotalGB) * 100 : null;
  const vramPct = (v && typeof v.usedMB === 'number' && typeof v.totalMB === 'number' && v.totalMB) ? (v.usedMB / v.totalMB) * 100 : null;

  pushHistory(State.overviewHistory.cpu, cpuPercent);
  pushHistory(State.overviewHistory.ram, ramPct);
  pushHistory(State.overviewHistory.disk, diskPct);
  pushHistory(State.overviewHistory.vram, vramPct);

  renderOverviewSparks();

  saveOverviewCache({
    cpuText: cpuText?.textContent || '',
    ramText: ramText?.textContent || '',
    diskText: diskText?.textContent || '',
    vramText: vramText?.textContent || '',
  });
}

function getWindowedHistory(values) {
  const ms = (State.overviewRangeMin || 5) * 60_000;
  const cutoff = Date.now() - ms;
  const window = (values || []).filter(p => typeof p?.t === 'number' ? p.t >= cutoff : true);

  // Downsampling progressif: détaillé pour 6h/12h, compact seulement sur longues durées
  let bucketMs = 15_000;
  if (State.overviewRangeMin >= 720) bucketMs = 30_000;        // >= 12h : 30 s
  if (State.overviewRangeMin >= 1440) bucketMs = 60_000;       // >= 24h : 1 min
  if (State.overviewRangeMin >= 2880) bucketMs = 2 * 60_000;   // >= 48h : 2 min
  if (State.overviewRangeMin >= 10080) bucketMs = 10 * 60_000; // 7j : 10 min

  return downsample(window, bucketMs);
}

function downsample(points, bucketMs) {
  if (!Array.isArray(points) || points.length < 2) return points || [];
  if (!bucketMs || bucketMs <= 0) return points;

  const buckets = new Map();
  for (const p of points) {
    const t = p?.t;
    const v = p?.v;
    if (typeof t !== 'number' || typeof v !== 'number') continue;
    const k = Math.floor(t / bucketMs) * bucketMs;
    const b = buckets.get(k) || { t: k, sum: 0, n: 0 };
    b.sum += v;
    b.n += 1;
    buckets.set(k, b);
  }

  return [...buckets.values()]
    .sort((a, b) => a.t - b.t)
    .map(b => ({ t: b.t, v: b.n ? (b.sum / b.n) : 0 }));
}

function renderOverviewSparks() {
  const cpu = getWindowedHistory(State.overviewHistory.cpu);
  const ram = getWindowedHistory(State.overviewHistory.ram);
  const disk = getWindowedHistory(State.overviewHistory.disk);
  const vram = getWindowedHistory(State.overviewHistory.vram);

  State.overviewPoints.cpu = drawSparkline('#ov-cpu-spark', cpu) || [];
  State.overviewPoints.ram = drawSparkline('#ov-ram-spark', ram) || [];
  State.overviewPoints.disk = drawSparkline('#ov-disk-spark', disk) || [];
  State.overviewPoints.vram = drawSparkline('#ov-vram-spark', vram) || [];
}

function normalizeHistory(arr) {
  if (!Array.isArray(arr)) return [];
  // ancien format: [number, number, ...]
  if (typeof arr[0] === 'number') {
    const now = Date.now();
    return arr.filter(v => typeof v === 'number' && Number.isFinite(v)).map((v, i) => ({
      t: now - (arr.length - 1 - i) * 15_000,
      v: Math.max(0, Math.min(100, v))
    }));
  }
  // nouveau format: [{t,v}, ...]
  return arr
    .filter(x => x && typeof x.v === 'number' && Number.isFinite(x.v))
    .map(x => ({ t: typeof x.t === 'number' ? x.t : Date.now(), v: Math.max(0, Math.min(100, x.v)) }));
}

function pushHistory(arr, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  arr.push({ t: Date.now(), v: Math.max(0, Math.min(100, value)) });
  // Garde ~7 jours à 15s: 7*24*60*4 = 40320 points max
  const MAX_POINTS = 40320;
  if (arr.length > MAX_POINTS) arr.splice(0, arr.length - MAX_POINTS);
}

function calcSparkPoints(values) {
  const w = 100;
  const h = 30;
  const stamped = values
    .map((p, i) => ({
      idx: i,
      v: (typeof p === 'number') ? p : p?.v,
      t: (typeof p?.t === 'number') ? p.t : null,
    }))
    .filter(p => typeof p.v === 'number' && Number.isFinite(p.v));

  if (!stamped.length) return [];

  const hasTime = stamped.every(p => typeof p.t === 'number');
  const minT = hasTime ? Math.min(...stamped.map(p => p.t)) : null;
  const maxT = hasTime ? Math.max(...stamped.map(p => p.t)) : null;
  const spanT = (hasTime && maxT !== null && minT !== null) ? Math.max(1, maxT - minT) : null;
  const maxIdx = Math.max(1, stamped.length - 1);

  return stamped.map((p) => {
    let x;
    if (hasTime && spanT !== null && minT !== null) {
      x = ((p.t - minT) / spanT) * w;
    } else {
      x = (p.idx / maxIdx) * w;
    }

    x = Math.max(0, Math.min(w, x));
    const v = p.v;
    const y = h - ((v - 0) / (100 - 0)) * (h - 4) - 2;
    return { x, y, v, t: p.t };
  }).sort((a, b) => a.x - b.x);
}

function sampleSparkAtX(points, targetX) {
  if (!Array.isArray(points) || !points.length) return null;
  if (points.length === 1) return points[0];

  const x = Math.max(0, Math.min(100, targetX));
  if (x <= points[0].x) return points[0];
  if (x >= points[points.length - 1].x) return points[points.length - 1];

  for (let i = 1; i < points.length; i += 1) {
    const left = points[i - 1];
    const right = points[i];
    if (x <= right.x) {
      const dx = Math.max(0.0001, right.x - left.x);
      const ratio = (x - left.x) / dx;
      const v = left.v + ((right.v - left.v) * ratio);
      const y = left.y + ((right.y - left.y) * ratio);
      const t = (typeof left.t === 'number' && typeof right.t === 'number')
        ? Math.round(left.t + ((right.t - left.t) * ratio))
        : (left.t ?? right.t ?? null);
      return { x, y, v, t };
    }
  }

  return points[points.length - 1];
}

function drawSparkline(sel, values) {
  const svg = qs(sel);
  if (!svg) return;
  const area = svg.querySelector('.spark-area');
  const line = svg.querySelector('.spark-line');
  const cursor = svg.querySelector('.spark-cursor');
  const dot = svg.querySelector('.spark-dot');
  if (!area || !line) return;

  if (!values || values.length < 2) {
    area.setAttribute('d', '');
    line.setAttribute('d', '');
    if (cursor) cursor.setAttribute('x1', '0');
    if (cursor) cursor.setAttribute('x2', '0');
    if (dot) dot.setAttribute('cx', '0');
    if (dot) dot.setAttribute('cy', '0');
    return;
  }

  const pts = calcSparkPoints(values);
  const dLine = `M ${pts.map(p => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')}`;
  line.setAttribute('d', dLine);

  const dArea = `M 0 30 L ${pts.map(p => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')} L 100 30 Z`;
  area.setAttribute('d', dArea);

  // place cursor/dot sur le dernier point par défaut
  if (cursor) {
    cursor.setAttribute('x1', String(pts[pts.length - 1].x));
    cursor.setAttribute('x2', String(pts[pts.length - 1].x));
  }
  if (dot) {
    dot.setAttribute('cx', String(pts[pts.length - 1].x));
    dot.setAttribute('cy', String(pts[pts.length - 1].y));
  }

  return pts;
}

// ─── Tooltip sparklines ─────────────────────────────────────────
function ensureSparkTooltip() {
  let el = qs('#spark-tooltip');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'spark-tooltip';
  el.className = 'spark-tooltip hidden';
  document.body.appendChild(el);
  return el;
}

function setupSparkTooltip(svgSel, valuesGetter) {
  const svg = qs(svgSel);
  if (!svg || svg.dataset.tooltipBound === '1') return;
  svg.dataset.tooltipBound = '1';
  const tip = ensureSparkTooltip();

  const cursor = svg.querySelector('.spark-cursor');
  const dot = svg.querySelector('.spark-dot');

  const hide = () => tip.classList.add('hidden');
  const showAt = (x, y, text) => {
    tip.textContent = text;
    tip.style.left = `${x + 12}px`;
    tip.style.top = `${y + 12}px`;
    tip.classList.remove('hidden');
  };

  svg.addEventListener('mouseleave', hide);
  svg.addEventListener('touchend', hide);
  svg.addEventListener('mousemove', (e) => {
    const vals = valuesGetter();
    if (!vals || vals.length < 2) return hide();
    const rect = svg.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetX = ratio * 100;
    const p = sampleSparkAtX(vals, targetX);
    if (!p) return hide();
    const v = (typeof p === 'number') ? p : p?.v;
    if (typeof v !== 'number') return hide();

    // position curseur/dot
    const x = typeof p?.x === 'number' ? p.x : targetX;
    const y = 30 - ((v - 0) / (100 - 0)) * (30 - 4) - 2;
    if (cursor) { cursor.setAttribute('x1', String(x)); cursor.setAttribute('x2', String(x)); }
    if (dot) { dot.setAttribute('cx', String(x)); dot.setAttribute('cy', String(y)); }

    const age = (typeof p?.t === 'number') ? formatAge(Date.now() - p.t) : null;
    showAt(e.clientX, e.clientY, age ? `${v.toFixed(1)}% · ${age}` : `${v.toFixed(1)}%`);
  });

  svg.addEventListener('touchmove', (e) => {
    const vals = valuesGetter();
    if (!vals || vals.length < 2) return hide();
    const t = e.touches?.[0];
    if (!t) return hide();
    const rect = svg.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (t.clientX - rect.left) / rect.width));
    const targetX = ratio * 100;
    const p = sampleSparkAtX(vals, targetX);
    if (!p) return hide();
    const v = (typeof p === 'number') ? p : p?.v;
    if (typeof v !== 'number') return hide();

    const x = typeof p?.x === 'number' ? p.x : targetX;
    const y = 30 - ((v - 0) / (100 - 0)) * (30 - 4) - 2;
    if (cursor) { cursor.setAttribute('x1', String(x)); cursor.setAttribute('x2', String(x)); }
    if (dot) { dot.setAttribute('cx', String(x)); dot.setAttribute('cy', String(y)); }

    const age = (typeof p?.t === 'number') ? formatAge(Date.now() - p.t) : null;
    showAt(t.clientX, t.clientY, age ? `${v.toFixed(1)}% · ${age}` : `${v.toFixed(1)}%`);
  }, { passive: true });
}

function setOverviewRange(min) {
  State.overviewRangeMin = min;
  try { localStorage.setItem('proxmox_interfaces_overview_range_min', String(min)); } catch {}
  qsa('#overview-range-panel .range-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.rangeMin, 10) === min));
  renderOverviewSparks();
  renderMonitoringStorage(State.storagePoolsLatest || []);

  const panel = qs('#overview-range-panel');
  panel?.classList.add('hidden');
  qs('#overview-range-toggle')?.classList.remove('open');
}

function formatAge(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) {
    const mins = m % 60;
    return mins ? `il y a ${h}h${String(mins).padStart(2, '0')}` : `il y a ${h}h`;
  }
  if (m > 0) return `il y a ${m} min`;
  return `il y a ${s} s`;
}

// ─── Infrastructure view ──────────────────────────────────────────
function renderInfrastructure() {
  refreshContainerColorMap();
  renderTopology();
  renderIpTable();
  renderContainersGrid();
}

function renderTopology() {
  const topo = qs('#infra-topology');
  if (!topo || !State.data) return;

  const containers = sortContainersByVmid(State.data.containers || []);
  const containersHtml = containers.map(ct => {
    const ctColor = getContainerColor(ct);
    const services = (ct.services || []).map(sid => {
      const s = State.data.services.find(x => x.id === sid);
      return s ? `<span class="topo-service-chip">${escHtml(s.name)}</span>` : '';
    }).join('');
    const hasSvcs = ct.services.length > 0;
    return `
      <div class="topo-container-card" data-ct="${escHtml(ct.id)}" style="--cat-color:${ctColor}; cursor:pointer;">
        <div class="topo-ct-dot"></div>
        <div class="topo-ct-header">
          <span class="topo-ct-name">${escHtml(ct.name)}</span>
          <span class="topo-ct-ip">${escHtml(ct.ip || '—')}</span>
        </div>
        <div class="topo-ct-desc">${escHtml(ct.description || '')}</div>
        ${hasSvcs ? `<div class="topo-ct-services">${services}</div>` : '<div class="topo-ct-services"><span class="topo-service-chip" style="opacity:.4">disponible</span></div>'}
      </div>`;
  }).join('');

  topo.innerHTML = `
    <div class="topo-host">
      <div class="topo-host-box">
        <i data-lucide="server"></i>
        <div>
          <div class="topo-host-name">Proxmox VE — Hôte principal</div>
          <div class="topo-host-ip">proxmox-host — 10.0.0.0/24</div>
        </div>
      </div>
      <div class="topo-line"></div>
      <div class="topo-containers">${containersHtml}</div>
    </div>`;
  lucideRefresh(topo);

  qsa('.topo-container-card', topo).forEach(card => {
    card.addEventListener('click', () => openContainerModal(card.dataset.ct));
  });
}

function renderIpTable() {
  const tbody = qs('#ip-table-body');
  if (!tbody || !State.data) return;
  const rows = State.data.services.map(s => {
    const status = State.statuses[s.id] || 'unknown';
    const statusHtml = `<span class="sli-badge ${status}" style="font-size:.7rem;padding:2px 8px">${status.toUpperCase()}</span>`;
    const autoBadge = s.autoDiscovered ? '<span class="ip-auto-badge" title="Découverte automatique">AUTO</span>' : '';
    return `
      <tr data-svc-open="${escHtml(s.id)}" style="cursor:pointer">
        <td><div class="ip-service-cell">${escHtml(s.name)}${autoBadge}</div></td>
        <td><a href="${escHtml(s.domain || s.url)}" target="_blank" class="domain-link">${escHtml(s.domain || '—')}</a></td>
        <td class="mono">${escHtml(s.ip || '—')}</td>
        <td class="mono">${escHtml(String(s.port || '—'))}</td>
        <td>${escHtml(s.container || '—')}</td>
        <td><a href="${escHtml(s.url)}" target="_blank" class="domain-link"><i data-lucide="external-link" style="width:12px;height:12px;display:inline"></i></a></td>
        <td>${statusHtml}</td>
      </tr>`;
  }).join('');
  tbody.innerHTML = rows;

  qsa('tr[data-svc-open]', tbody).forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      openServiceModal(row.dataset.svcOpen);
    });
  });

  lucideRefresh(tbody);
}

function renderContainersGrid() {
  const grid = qs('#containers-grid');
  if (!grid || !State.data) return;
  const containers = sortContainersByVmid(State.data.containers || []);
  grid.innerHTML = containers.map(ct => {
    const ctColor = getContainerColor(ct);
    const resources = ct.resources || {};
    const chips = Object.entries(resources).map(([k, v]) => `<span class="ct-resource-chip">${k}: ${escHtml(String(v))}</span>`).join('');
    const serviceTags = (ct.services || []).map(sid => {
      const s = State.data.services.find(x => x.id === sid);
      return s ? `<span class="ct-service-tag">${escHtml(s.name)}</span>` : '';
    }).join('');
    return `
      <div class="ct-card" data-ct="${escHtml(ct.id)}" style="border-top:3px solid ${ctColor}; cursor:pointer;">
        <div class="ct-card-header">
          <span class="ct-card-name">${escHtml(ct.name)}</span>
          <span class="ct-card-ip">${escHtml(ct.ip || '—')}</span>
        </div>
        <div class="ct-card-desc">${escHtml(ct.description || '')}</div>
        ${chips ? `<div class="ct-card-resources">${chips}</div>` : ''}
        ${serviceTags ? `<div class="ct-card-services">${serviceTags}</div>` : ''}
      </div>`;
  }).join('');
  lucideRefresh(grid);

  qsa('.ct-card', grid).forEach(card => {
    card.addEventListener('click', () => openContainerModal(card.dataset.ct));
  });
}

// ─── Notes view ───────────────────────────────────────────────────
async function loadNotesView() {
  const grid = qs('#notes-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading-spinner">Chargement...</div>';
  try {
    const notes = await fetchNotes();
    renderNotes(notes);
  } catch(e) {
    grid.innerHTML = `<div class="empty-state"><i data-lucide="alert-circle"></i><p>Erreur de chargement des notes.</p></div>`;
    lucideRefresh(grid);
  }
}

function renderNotes(notes) {
  const grid = qs('#notes-grid');
  if (!grid) return;
  if (!notes.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><i data-lucide="sticky-note"></i><p>Aucune note. Cliquez sur "Nouvelle note" pour commencer.</p></div>`;
    lucideRefresh(grid);
    return;
  }
  grid.innerHTML = notes.map(n => `
    <div class="note-card" style="--nc:${n.color || '#6366f1'}">
      <div class="note-title">${escHtml(n.title)}</div>
      <div class="note-date">${fmt(n.createdAt)}</div>
      <div class="note-content">${escHtml(n.content)}</div>
      <div class="note-actions">
        <button class="note-del-btn" data-note-del="${n.id}"><i data-lucide="trash-2"></i> Supprimer</button>
      </div>
    </div>`).join('');
  lucideRefresh(grid);

  qsa('[data-note-del]', grid).forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Supprimer cette note ?')) return;
      try {
        await deleteNote(parseInt(btn.dataset.noteDel));
        toast('Note supprimée', 'success');
        loadNotesView();
      } catch(e) { toast('Erreur suppression', 'error'); }
    });
  });
}

// ─── Changelog view ───────────────────────────────────────────────
async function loadChangelogView() {
  const list = qs('#changelog-list');
  if (!list) return;
  if (!State.changelogFiltersBound) {
    setupChangelogFilters();
    State.changelogFiltersBound = true;
  }
  list.innerHTML = '<div class="loading-spinner">Chargement...</div>';
  try {
    const entries = await fetchChangelog();
    State.changelogEntries = entries || [];
    renderChangelog(entries);
  } catch(e) {
    State.changelogEntries = [];
    list.innerHTML = `<div class="empty-state"><i data-lucide="alert-circle"></i><p>Erreur de chargement.</p></div>`;
    lucideRefresh(list);
  }
}

const CL_CONFIG = {
  info:   { icon: 'ℹ️', color: '#6366f1' },
  add:    { icon: '➕', color: '#22c55e' },
  update: { icon: '🔄', color: '#f59e0b' },
  delete: { icon: '❌', color: '#ef4444' },
  fix:    { icon: '🔧', color: '#06b6d4' },
  alert:  { icon: '⚠️', color: '#f59e0b' },
};
const CL_LABELS = { info:'Info', add:'Ajout', update:'Mise à jour', delete:'Suppression', fix:'Correction', alert:'Alerte' };
const CHANGELOG_PAGE_SIZE = 50;

function setupChangelogFilters() {
  const searchInput = qs('#changelog-search');
  const typeSelect = qs('#changelog-filter-type');

  if (searchInput) {
    searchInput.value = State.changelogSearch || '';
    searchInput.addEventListener('input', () => {
      State.changelogSearch = searchInput.value || '';
      State.changelogPage = 1;
      renderChangelog(State.changelogEntries || []);
    });
  }

  if (typeSelect) {
    typeSelect.value = State.changelogFilterType || 'all';
    typeSelect.addEventListener('change', () => {
      State.changelogFilterType = typeSelect.value || 'all';
      State.changelogPage = 1;
      renderChangelog(State.changelogEntries || []);
    });
  }
}

function filterChangelogEntries(entries) {
  const typeFilter = State.changelogFilterType || 'all';
  const search = String(State.changelogSearch || '').trim().toLowerCase();

  return (entries || []).filter((entry) => {
    if (typeFilter !== 'all' && String(entry?.type || '') !== typeFilter) return false;
    if (!search) return true;

    const haystack = [
      entry?.message,
      entry?.service,
      entry?.author,
      entry?.entity,
      entry?.entityId,
      entry?.source,
      CL_LABELS[entry?.type] || entry?.type,
    ].map(v => String(v || '').toLowerCase()).join(' ');

    return haystack.includes(search);
  });
}

function renderChangelogPagination(totalItems, currentPage, totalPages) {
  const box = qs('#changelog-pagination');
  if (!box) return;

  if (!totalItems) {
    box.innerHTML = '';
    return;
  }

  const start = (currentPage - 1) * CHANGELOG_PAGE_SIZE + 1;
  const end = Math.min(currentPage * CHANGELOG_PAGE_SIZE, totalItems);

  const pages = [];
  const pushPage = (p) => {
    pages.push(`<button class="changelog-page-btn ${p === currentPage ? 'active' : ''}" data-cl-page="${p}">${p}</button>`);
  };

  pushPage(1);
  if (totalPages > 1) {
    const from = Math.max(2, currentPage - 1);
    const to = Math.min(totalPages - 1, currentPage + 1);
    if (from > 2) pages.push('<span class="changelog-page-info">…</span>');
    for (let p = from; p <= to; p += 1) pushPage(p);
    if (to < totalPages - 1) pages.push('<span class="changelog-page-info">…</span>');
    pushPage(totalPages);
  }

  box.innerHTML = `
    <div class="changelog-page-info">Entrées ${start}-${end} sur ${totalItems} · page ${currentPage}/${totalPages}</div>
    <div class="changelog-page-actions">
      <button class="changelog-page-btn" data-cl-page-prev ${currentPage <= 1 ? 'disabled' : ''}>Précédent</button>
      ${pages.join('')}
      <button class="changelog-page-btn" data-cl-page-next ${currentPage >= totalPages ? 'disabled' : ''}>Suivant</button>
    </div>
  `;

  qsa('[data-cl-page]', box).forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.clPage, 10);
      if (!Number.isFinite(p) || p === State.changelogPage) return;
      State.changelogPage = p;
      renderChangelog(State.changelogEntries || []);
    });
  });
  qs('[data-cl-page-prev]', box)?.addEventListener('click', () => {
    if (State.changelogPage <= 1) return;
    State.changelogPage -= 1;
    renderChangelog(State.changelogEntries || []);
  });
  qs('[data-cl-page-next]', box)?.addEventListener('click', () => {
    const max = Math.max(1, Math.ceil(totalItems / CHANGELOG_PAGE_SIZE));
    if (State.changelogPage >= max) return;
    State.changelogPage += 1;
    renderChangelog(State.changelogEntries || []);
  });
}

function renderChangelog(entries) {
  const list = qs('#changelog-list');
  const pagination = qs('#changelog-pagination');
  if (!list) return;
  const filtered = filterChangelogEntries(entries || []);
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><i data-lucide="clock"></i><p>Aucune entrée dans le journal.</p></div>`;
    if (pagination) pagination.innerHTML = '';
    lucideRefresh(list);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / CHANGELOG_PAGE_SIZE));
  if (State.changelogPage > totalPages) State.changelogPage = totalPages;
  if (State.changelogPage < 1) State.changelogPage = 1;
  const start = (State.changelogPage - 1) * CHANGELOG_PAGE_SIZE;
  const pageEntries = filtered.slice(start, start + CHANGELOG_PAGE_SIZE);

  list.innerHTML = pageEntries.map(e => {
    const cfg = CL_CONFIG[e.type] || CL_CONFIG.info;
    const label = CL_LABELS[e.type] || e.type;
    const entryId = escHtml(String(e.id || e.date || Math.random()));
    return `
      <div class="cl-item" style="--cl-color:${cfg.color}" data-cl-open="${entryId}">
        <span class="cl-type-icon">${cfg.icon}</span>
        <div class="cl-body">
          <div class="cl-message">${escHtml(e.message || e.service || '—')}</div>
          <div class="cl-meta">${fmt(e.date)}</div>
        </div>
        <span class="cl-type-badge ${e.type}">${label}</span>
      </div>`;
  }).join('');

  qsa('[data-cl-open]', list).forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.clOpen;
      const entry = (State.changelogEntries || []).find(x => String(x.id || x.date) === id);
      if (entry) openChangelogModal(entry);
    });
  });

  renderChangelogPagination(filtered.length, State.changelogPage, totalPages);

  lucideRefresh(list);
}

function openChangelogModal(entry) {
  const modal = qs('#changelog-modal');
  if (!modal || !entry) return;

  const labels = { info:'Info', add:'Ajout', update:'Mise à jour', delete:'Suppression', fix:'Correction', alert:'Alerte' };
  const typeLabel = labels[entry.type] || (entry.type || 'info');

  qs('#cl-modal-title').textContent = entry.message || entry.service || 'Événement';
  qs('#cl-modal-type').textContent = typeLabel;
  qs('#cl-modal-type').className = `cl-type-badge ${entry.type || 'info'}`;
  qs('#cl-modal-date').textContent = entry.date ? fmt(entry.date) : '—';
  qs('#cl-modal-service').textContent = entry.service || '—';
  qs('#cl-modal-author').textContent = entry.author || 'system';
  qs('#cl-modal-id').textContent = entry.id ? String(entry.id) : '—';
  qs('#cl-modal-source').textContent = entry.source || 'application';
  qs('#cl-modal-entity').textContent = entry.entity
    ? `${entry.entity}${entry.entityId ? ` (${entry.entityId})` : ''}`
    : (entry.entityId ? String(entry.entityId) : '—');
  qs('#cl-modal-message').textContent = entry.message || '—';

  const changedWrap = qs('#cl-modal-changed-section');
  const changedEl = qs('#cl-modal-changed');
  const changed = Array.isArray(entry.changedFields) ? entry.changedFields.filter(Boolean) : [];
  if (changed.length) {
    changedEl.innerHTML = changed.map(field => `<span class="badge">${escHtml(String(field))}</span>`).join('');
    changedWrap.classList.remove('hidden');
  } else {
    changedEl.innerHTML = '';
    changedWrap.classList.add('hidden');
  }

  const formatDiffValue = (value) => {
    if (value === undefined) return '—';
    if (value === null) return 'null';
    if (typeof value === 'string') return value || '""';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value, null, 2);
  };

  const diffWrap = qs('#cl-modal-diff-section');
  const diffEl = qs('#cl-modal-diff');
  const beforeObj = (entry.before && typeof entry.before === 'object') ? entry.before : null;
  const afterObj = (entry.after && typeof entry.after === 'object') ? entry.after : null;
  const diffKeys = changed.length
    ? changed
    : ((beforeObj && afterObj)
      ? [...new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]).values()]
      : []);

  if (beforeObj && afterObj && diffKeys.length) {
    diffEl.innerHTML = diffKeys.map((field) => {
      const beforeVal = formatDiffValue(beforeObj[field]);
      const afterVal = formatDiffValue(afterObj[field]);
      return `
        <div class="cl-diff-item">
          <div class="cl-diff-field">${escHtml(String(field))}</div>
          <div class="cl-diff-values">
            <div class="cl-diff-before"><span class="cl-diff-label">Avant</span><pre>${escHtml(beforeVal)}</pre></div>
            <div class="cl-diff-after"><span class="cl-diff-label">Après</span><pre>${escHtml(afterVal)}</pre></div>
          </div>
        </div>`;
    }).join('');
    diffWrap.classList.remove('hidden');
  } else {
    diffEl.innerHTML = '';
    diffWrap.classList.add('hidden');
  }

  const detailsWrap = qs('#cl-modal-details-section');
  const detailsEl = qs('#cl-modal-details');
  if (entry.details && typeof entry.details === 'object') {
    detailsEl.textContent = JSON.stringify(entry.details, null, 2);
    detailsWrap.classList.remove('hidden');
  } else {
    detailsEl.textContent = '—';
    detailsWrap.classList.add('hidden');
  }

  const beforeWrap = qs('#cl-modal-before-section');
  const beforeEl = qs('#cl-modal-before');
  if (entry.before && typeof entry.before === 'object') {
    beforeEl.textContent = JSON.stringify(entry.before, null, 2);
    beforeWrap.classList.remove('hidden');
  } else {
    beforeEl.textContent = '—';
    beforeWrap.classList.add('hidden');
  }

  const afterWrap = qs('#cl-modal-after-section');
  const afterEl = qs('#cl-modal-after');
  if (entry.after && typeof entry.after === 'object') {
    afterEl.textContent = JSON.stringify(entry.after, null, 2);
    afterWrap.classList.remove('hidden');
  } else {
    afterEl.textContent = '—';
    afterWrap.classList.add('hidden');
  }

  const rawEl = qs('#cl-modal-raw');
  if (rawEl) rawEl.textContent = JSON.stringify(entry, null, 2);

  const copyBtn = qs('#cl-modal-copy-btn');
  if (copyBtn) copyBtn.dataset.payload = JSON.stringify(entry, null, 2);

  modal.classList.remove('hidden');
  lucideRefresh(modal);
}

function closeChangelogModal() {
  qs('#changelog-modal')?.classList.add('hidden');
}

// ─── Admin view ───────────────────────────────────────────────────
function renderAdminServicesList() {
  const list = qs('#admin-services-list');
  if (!list || !State.data) return;
  list.innerHTML = State.data.services.map(s => `
    <div class="admin-svc-item ${s.autoDiscovered ? 'is-auto' : ''}" data-edit-svc="${s.id}" data-is-auto="${s.autoDiscovered ? '1' : '0'}">
      <span class="admin-svc-name">${escHtml(s.name)}</span>
      ${s.autoDiscovered ? '<span class="admin-svc-state auto">AUTO non validé</span>' : ''}
      <span class="admin-svc-cat" style="color:${getCatColor(s.category)}">${escHtml(getCatName(s.category))}</span>
      <button class="admin-del-btn" data-del-svc="${s.id}" title="${s.autoDiscovered ? 'Validez d\'abord ce service depuis sa fiche' : `Supprimer ${escHtml(s.name)}`}" ${s.autoDiscovered ? 'disabled' : ''}>
        <i data-lucide="trash-2"></i>
      </button>
    </div>`).join('');
  lucideRefresh(list);

  qsa('[data-edit-svc]', list).forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-del-svc]')) return;
      if (row.dataset.isAuto === '1') {
        toast('Service AUTO: ouvrez la fiche pour Valider, Refuser, ou modifier avant validation.', 'info');
        return;
      }
      openEditServiceModal(row.dataset.editSvc);
    });
  });

  qsa('[data-del-svc]', list).forEach(btn => {
    btn.addEventListener('click', async () => {
      const svc = State.data.services.find(s => s.id === btn.dataset.delSvc);
      if (!svc || !confirm(`Supprimer le service "${svc.name}" ?`)) return;
      try {
        await deleteService(svc.id);
        State.data.services = State.data.services.filter(s => s.id !== svc.id);
        if (State.favorites.has(svc.id)) {
          State.favorites.delete(svc.id);
          saveFavorites();
        }
        toast(`Service "${svc.name}" supprimé`, 'success');
        renderAdminServicesList();
        if (State.currentView === 'services') renderServiceCards();
        if (State.currentView === 'dashboard') renderDashboard();
      } catch(e) { toast('Erreur suppression', 'error'); }
    });
  });
}

async function renderAdminWatchersStatus() {
  const box = qs('#admin-watchers-status');
  if (!box) return;

  box.innerHTML = '<div class="watcher-item"><div class="watcher-name">Chargement…</div><div class="watcher-desc">Récupération des métriques en cours.</div></div>';

  const boolText = (value) => {
    if (value === true) return 'Oui';
    if (value === false) return 'Non';
    return '—';
  };

  const fmtTs = (value) => {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('fr-FR');
  };

  const readNumber = (value) => (Number.isFinite(value) ? value : null);

  const normalizeWatchers = (payload) => {
    const runtimeRaw = (payload && typeof payload.runtime === 'object' && payload.runtime)
      || (payload && typeof payload.watchers === 'object' && payload.watchers)
      || {};
    const persistedRaw = (payload && typeof payload.persisted === 'object' && payload.persisted) || {};
    const config = (payload && typeof payload.config === 'object' && payload.config) || {};

    const hasNested = ['infra', 'tasks', 'syslog'].some(
      key => runtimeRaw[key] && typeof runtimeRaw[key] === 'object'
    );

    if (hasNested) {
      return {
        infra: {
          ...(runtimeRaw.infra || {}),
          ...(persistedRaw.infra || {}),
          ...(runtimeRaw.infra || {}),
          primed: runtimeRaw.infra?.primed,
        },
        tasks: {
          ...(runtimeRaw.tasks || {}),
          ...(persistedRaw.tasks || {}),
          ...(runtimeRaw.tasks || {}),
          primed: runtimeRaw.tasks?.primed,
        },
        syslog: {
          ...(runtimeRaw.syslog || {}),
          ...(persistedRaw.syslog || {}),
          ...(runtimeRaw.syslog || {}),
          primed: runtimeRaw.syslog?.primed,
        }
      };
    }

    const persistedTs = persistedRaw.ts || null;
    const intervalMs = Number.isFinite(config.intervalMs) ? config.intervalMs : null;
    const taskStatesCount = readNumber(runtimeRaw.taskStatesCount) || 0;
    const syslogSeenCount = readNumber(runtimeRaw.syslogSeenCount) || 0;
    const tasksPrimedEffective = !!runtimeRaw.tasksWatcherStarted && (taskStatesCount > 0 || !!persistedTs || runtimeRaw.tasksWatcherPrimed === true);
    const syslogPrimedEffective = !!runtimeRaw.syslogWatcherStarted && (syslogSeenCount > 0 || !!persistedTs || runtimeRaw.syslogWatcherPrimed === true);

    return {
      infra: {
        enabled: true,
        running: runtimeRaw.infraWatcherStarted,
        intervalMs,
        processedCount: null,
        errorCount: null,
        lastSuccessAt: persistedTs,
        lastErrorAt: null,
        lastError: null,
        primed: null,
      },
      tasks: {
        enabled: config.enabledTasks,
        running: runtimeRaw.tasksWatcherStarted,
        intervalMs,
        processedCount: readNumber(runtimeRaw.taskStatesCount),
        errorCount: null,
        lastSuccessAt: persistedTs,
        lastErrorAt: null,
        lastError: null,
        primed: tasksPrimedEffective,
      },
      syslog: {
        enabled: config.enabledSyslog,
        running: runtimeRaw.syslogWatcherStarted,
        intervalMs,
        processedCount: readNumber(runtimeRaw.syslogSeenCount),
        errorCount: null,
        lastSuccessAt: persistedTs,
        lastErrorAt: null,
        lastError: null,
        primed: syslogPrimedEffective,
      }
    };
  };

  try {
    const payload = await fetchProxmoxWatchers();
    const normalized = normalizeWatchers(payload);

    const labels = {
      infra: 'Infrastructure',
      tasks: 'Tâches Proxmox',
      syslog: 'Logs Proxmox',
    };
    const descriptions = {
      infra: 'Surveille les changements CT/VM, IP et hostname.',
      tasks: 'Collecte les tâches Proxmox (start, stop, migrate...).',
      syslog: 'Collecte les logs système Proxmox récents.',
    };
    const keys = ['infra', 'tasks', 'syslog'];

    box.innerHTML = keys.map((key) => {
      const w = normalized[key] || {};
      const enabled = w.enabled;
      const running = w.running;
      const primed = w.primed;
      const intervalMs = readNumber(w.intervalMs);
      const processedCount = readNumber(w.processedCount);
      const errorCount = readNumber(w.errorCount);
      const lastSuccessAt = w.lastSuccessAt;
      const lastErrorAt = w.lastErrorAt;
      const lastError = w.lastError;

      const badgeClass = (value) => (value === true ? 'yes' : value === false ? 'no' : '');
      const metrics = [];
      metrics.push({
        label: 'Actif',
        value: `<span class="watcher-bool ${badgeClass(enabled)}">${boolText(enabled)}</span>`
      });
      metrics.push({
        label: 'En cours',
        value: `<span class="watcher-bool ${badgeClass(running)}">${boolText(running)}</span>`
      });
      if (primed !== null && primed !== undefined) {
        metrics.push({
          label: 'Initialisé',
          value: `<span class="watcher-bool ${badgeClass(primed)}">${boolText(primed)}</span>`
        });
      }
      if (intervalMs !== null) metrics.push({ label: 'Intervalle', value: `${Math.round(intervalMs / 1000)}s` });
      if (processedCount !== null) metrics.push({ label: 'Événements', value: `${processedCount}` });
      if (errorCount !== null) metrics.push({ label: 'Erreurs', value: `${errorCount}` });
      metrics.push({ label: 'Dernier succès', value: escHtml(fmtTs(lastSuccessAt)) });
      if (lastErrorAt) metrics.push({ label: 'Dernière erreur', value: escHtml(fmtTs(lastErrorAt)) });

      const metricsHtml = metrics.map((item) => `
        <div class="watcher-metric">
          <span class="watcher-label">${item.label}</span>
          <span class="watcher-value">${item.value}</span>
        </div>`).join('');

      const errorHtml = lastError
        ? `<div class="watcher-error">${escHtml(String(lastError))}</div>`
        : '';

      return `
        <div class="watcher-item">
          <div class="watcher-name">${escHtml(labels[key] || key)}</div>
          <div class="watcher-desc">${escHtml(descriptions[key] || '')}</div>
          <div class="watcher-meta">${metricsHtml}</div>
          ${errorHtml}
        </div>`;
    }).join('');

    lucideRefresh(box);
  } catch (err) {
    box.innerHTML = `
      <div class="watcher-item">
        <div class="watcher-name">Erreur</div>
        <div class="watcher-meta"><span>Impossible de charger l'état des watchers.</span></div>
        <div class="watcher-error">${escHtml(err?.message || 'Erreur inconnue')}</div>
      </div>`;
  }
}

async function renderAdminProxmoxConfigStatus() {
  const box = qs('#admin-proxmox-config-status');
  if (!box) return;

  box.innerHTML = '<div class="admin-proxmox-config-card"><div class="admin-proxmox-config-title">Vérification configuration Proxmox...</div></div>';

  try {
    const cfg = await fetchProxmoxConfigCheck();
    const configured = !!cfg?.configured;
    const connected = !!cfg?.connectivity?.ok;
    const stateClass = (configured && connected) ? 'ok' : 'ko';
    const stateText = (configured && connected) ? 'Connecté' : (configured ? 'Config OK, connexion KO' : 'Configuration manquante');

    box.innerHTML = `
      <div class="admin-proxmox-config-card">
        <div class="admin-proxmox-config-header">
          <span class="admin-proxmox-config-title">Connexion API Proxmox</span>
          <span class="admin-proxmox-config-pill ${stateClass}">${escHtml(stateText)}</span>
        </div>
        <div class="admin-proxmox-config-meta">
          <div><strong>Host</strong> : ${escHtml(cfg?.host || '—')}</div>
          <div><strong>Port</strong> : ${escHtml(String(cfg?.port || '—'))}</div>
          <div><strong>Token ID</strong> : ${escHtml(cfg?.tokenIdMasked || '—')}</div>
          <div><strong>Token secret</strong> : ${cfg?.tokenSecretPresent ? 'Présent' : 'Absent'}</div>
          <div><strong>Nœud détecté</strong> : ${escHtml(cfg?.connectivity?.node || '—')}</div>
          <div><strong>Erreur</strong> : ${escHtml(cfg?.connectivity?.error || 'Aucune')}</div>
        </div>
      </div>
    `;
  } catch (e) {
    box.innerHTML = `
      <div class="admin-proxmox-config-card">
        <div class="admin-proxmox-config-header">
          <span class="admin-proxmox-config-title">Connexion API Proxmox</span>
          <span class="admin-proxmox-config-pill ko">Erreur</span>
        </div>
        <div class="admin-proxmox-config-meta">
          <div><strong>Détail</strong> : ${escHtml(e?.message || 'Impossible de vérifier la configuration')}</div>
        </div>
      </div>
    `;
  }
}

function getMigrationDefaultProfile() {
  return {
    clientName: '',
    projectCode: '',
    proxmoxHost: '',
    proxmoxPort: '8006',
    tokenId: '',
    networkSubnet: '',
    gateway: '',
    dns: '',
    compatibilityMode: true,
    requirePowerMgmt: true,
    requirePrometheus: false,
    requireTechnitium: false,
    rollbackReady: false,
    businessSignoff: false,
    notes: '',
  };
}

function loadMigrationAutoAuditEnabled() {
  try {
    return localStorage.getItem(MIGRATION_AUTO_AUDIT_KEY) === '1';
  } catch {
    return false;
  }
}

function saveMigrationAutoAuditEnabled(enabled) {
  try {
    localStorage.setItem(MIGRATION_AUTO_AUDIT_KEY, enabled ? '1' : '0');
  } catch {
    // ignore
  }
}

function loadMigrationProfile() {
  const defaults = getMigrationDefaultProfile();
  try {
    const raw = localStorage.getItem(MIGRATION_PROFILE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return { ...defaults, ...(parsed || {}) };
  } catch {
    return defaults;
  }
}

function saveMigrationProfile(profile) {
  try {
    localStorage.setItem(MIGRATION_PROFILE_KEY, JSON.stringify(profile || getMigrationDefaultProfile()));
  } catch {
    // ignore storage issues
  }
}

function readMigrationProfileFromForm() {
  const form = qs('#admin-migration-form');
  if (!form) return getMigrationDefaultProfile();
  const fd = new FormData(form);
  const profile = getMigrationDefaultProfile();
  fd.forEach((v, k) => {
    if (Object.prototype.hasOwnProperty.call(profile, k)) profile[k] = String(v || '').trim();
  });

  ['compatibilityMode', 'requirePowerMgmt', 'requirePrometheus', 'requireTechnitium', 'rollbackReady', 'businessSignoff'].forEach((name) => {
    profile[name] = !!form.querySelector(`input[name="${name}"]`)?.checked;
  });

  return profile;
}

function writeMigrationProfileToForm(profile) {
  const form = qs('#admin-migration-form');
  if (!form || !profile) return;
  Object.entries(profile).forEach(([k, v]) => {
    const input = form.querySelector(`[name="${k}"]`);
    if (!input) return;
    if (input.type === 'checkbox') {
      input.checked = !!v;
    } else {
      input.value = v ?? '';
    }
  });
}

function migrationCheck(id, title, status, blocking, detail, recommendation) {
  return { id, title, status, blocking, detail, recommendation };
}

function getMigrationWizardSteps(profile, audit) {
  const checks = Array.isArray(audit?.checks) ? audit.checks : [];
  const map = new Map(checks.map((c) => [c.id, c]));

  const step = (id, title, done, detail) => ({ id, title, done, detail });

  return [
    step('client', 'Infos client', !!profile.clientName, profile.clientName || 'Nom client requis'),
    step('proxmox', 'Connexion Proxmox', map.get('proxmox-api')?.status === 'pass', map.get('proxmox-api')?.detail || 'Audit requis'),
    step('network', 'Réseau DNS', map.get('network-fields')?.status === 'pass', map.get('network-fields')?.detail || 'Audit requis'),
    step('monitoring', 'Monitoring', (profile.requirePrometheus ? map.get('overview-ready')?.status === 'pass' : true), map.get('overview-ready')?.detail || 'Audit requis'),
    step('validation', 'Validation readiness', audit?.decision === 'GO', audit ? `${audit.decision} (${audit.score}%)` : 'Audit requis'),
    step('delivery', 'Livrables export', !!audit, audit ? 'JSON + Runbook exportables' : 'Lancer audit d abord'),
  ];
}

function renderMigrationWizardSteps(profile, audit) {
  const root = qs('#admin-migration-steps');
  if (!root) return;
  const steps = getMigrationWizardSteps(profile, audit);
  root.innerHTML = steps.map((s, idx) => `
    <div class="migration-step ${s.done ? 'done' : 'todo'}">
      <div class="migration-step-index">${idx + 1}</div>
      <div class="migration-step-body">
        <div class="migration-step-title">${escHtml(s.title)}</div>
        <div class="migration-step-detail">${escHtml(s.detail || '')}</div>
      </div>
    </div>
  `).join('');
}

function inferNetworkDefaultsFromContainers(containers = []) {
  const ipv4 = containers
    .map((c) => String(c?.ip || '').trim())
    .filter((ip) => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip));
  if (!ipv4.length) return { subnet: '', gateway: '', dns: '' };

  const first = ipv4[0].split('.').map((x) => parseInt(x, 10));
  const base = `${first[0]}.${first[1]}.${first[2]}`;
  const subnet = `${base}.0/24`;
  const gateway = `${base}.1`;

  const dnsCandidate = ipv4.find((ip) => ip.endsWith('.150')) || ipv4[0];
  const dns = `${dnsCandidate},1.1.1.1`;

  return { subnet, gateway, dns };
}

async function prefillMigrationProfileFromLive() {
  const profile = readMigrationProfileFromForm();
  const [cfgRes, liveRes] = await Promise.allSettled([
    fetchProxmoxConfigCheck(),
    fetchProxmoxContainersLive(),
  ]);

  if (cfgRes.status === 'fulfilled') {
    const cfg = cfgRes.value;
    if (!profile.proxmoxHost && cfg?.host) profile.proxmoxHost = String(cfg.host);
    if ((!profile.proxmoxPort || profile.proxmoxPort === '8006') && cfg?.port) profile.proxmoxPort = String(cfg.port);
    if (!profile.tokenId && cfg?.tokenId) profile.tokenId = String(cfg.tokenId);
  }

  if (liveRes.status === 'fulfilled') {
    const containers = Array.isArray(liveRes.value?.data) ? liveRes.value.data : [];
    const net = inferNetworkDefaultsFromContainers(containers);
    if (!profile.networkSubnet) profile.networkSubnet = net.subnet;
    if (!profile.gateway) profile.gateway = net.gateway;
    if (!profile.dns) profile.dns = net.dns;
  }

  saveMigrationProfile(profile);
  writeMigrationProfileToForm(profile);
  renderMigrationWizardSteps(profile, State.migrationLastAudit);
  return profile;
}

function buildMigrationActionPlan(profile, audit) {
  if (!audit || !Array.isArray(audit.checks)) return [];
  return audit.checks
    .filter((c) => c.status !== 'pass')
    .map((c, index) => {
      let actionId = '';
      if (c.id === 'rollback-ready') actionId = 'rollbackReady';
      if (c.id === 'business-signoff') actionId = 'businessSignoff';
      if (c.id === 'network-fields') actionId = 'fill-network';
      if (c.id === 'technitium-dns') actionId = 'requireTechnitium';
      if (c.id === 'power-mgmt') actionId = 'requirePowerMgmt';

      return {
        id: `plan-${index + 1}`,
        title: c.title,
        blocking: !!c.blocking,
        severity: c.status,
        detail: c.detail,
        recommendation: c.recommendation,
        actionId,
      };
    });
}

function renderMigrationActionPlan(profile, audit) {
  const root = qs('#admin-migration-plan');
  if (!root) return;
  const plan = buildMigrationActionPlan(profile, audit);
  if (!plan.length) {
    root.innerHTML = '<div class="migration-plan-empty">Plan d\'actions vide: tous les contrôles sont OK.</div>';
    return;
  }

  root.innerHTML = plan.map((p) => {
    const klass = p.severity === 'fail' ? 'ko' : 'warn';
    const quickBtn = p.actionId
      ? `<button type="button" class="btn-ghost" data-migration-quick-action="${escHtml(p.actionId)}">Appliquer action rapide</button>`
      : '';
    return `
      <div class="migration-plan-item ${klass}">
        <div class="migration-plan-head">
          <span class="migration-plan-title">${escHtml(p.title)}</span>
          <span class="migration-plan-pill ${klass}">${p.blocking ? 'BLOQUANT' : 'A FAIRE'}</span>
        </div>
        <div class="migration-plan-detail">${escHtml(p.detail || '—')}</div>
        <div class="migration-plan-rec">${escHtml(p.recommendation || 'Aucune')}</div>
        <div class="migration-plan-actions">${quickBtn}</div>
      </div>
    `;
  }).join('');
}

function buildMigrationRunbook(profile, audit) {
  const checks = Array.isArray(audit?.checks) ? audit.checks : [];
  const lines = [];
  lines.push('# Runbook migration nouveau client');
  lines.push('');
  lines.push(`Client: ${profile.clientName || 'N/A'}`);
  lines.push(`Projet: ${profile.projectCode || 'N/A'}`);
  lines.push(`Date audit: ${audit?.timestamp ? new Date(audit.timestamp).toLocaleString('fr-FR') : 'N/A'}`);
  lines.push(`Decision readiness: ${audit?.decision || 'NO-GO'}`);
  lines.push(`Score readiness: ${Number.isFinite(audit?.score) ? `${audit.score}%` : 'N/A'}`);
  lines.push('');
  lines.push('## Cible Proxmox');
  lines.push(`- Host: ${profile.proxmoxHost || 'N/A'}`);
  lines.push(`- Port: ${profile.proxmoxPort || 'N/A'}`);
  lines.push(`- Token ID attendu: ${profile.tokenId || 'N/A'}`);
  lines.push('');
  lines.push('## Reseau');
  lines.push(`- Subnet: ${profile.networkSubnet || 'N/A'}`);
  lines.push(`- Gateway: ${profile.gateway || 'N/A'}`);
  lines.push(`- DNS: ${profile.dns || 'N/A'}`);
  lines.push('');
  lines.push('## Exigences');
  lines.push(`- Mode compatibilite: ${profile.compatibilityMode ? 'Oui' : 'Non'}`);
  lines.push(`- Power Mgmt: ${profile.requirePowerMgmt ? 'Oui' : 'Non'}`);
  lines.push(`- Prometheus: ${profile.requirePrometheus ? 'Oui' : 'Non'}`);
  lines.push(`- Technitium: ${profile.requireTechnitium ? 'Oui' : 'Non'}`);
  lines.push(`- Rollback pret: ${profile.rollbackReady ? 'Oui' : 'Non'}`);
  lines.push(`- Validation metier: ${profile.businessSignoff ? 'Oui' : 'Non'}`);
  lines.push('');
  lines.push('## Checklist readiness');
  checks.forEach((c) => {
    lines.push(`- [${c.status === 'pass' ? 'OK' : c.status === 'warn' ? 'WARN' : 'FAIL'}] ${c.title}${c.blocking ? ' (bloquant)' : ''}`);
    if (c.detail) lines.push(`  Detail: ${String(c.detail)}`);
    if (c.recommendation) lines.push(`  Action: ${String(c.recommendation)}`);
  });
  lines.push('');
  if (profile.notes) {
    lines.push('## Notes');
    lines.push(profile.notes);
    lines.push('');
  }
  return lines.join('\n');
}

function downloadTextFile(fileName, content, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function evaluateMigrationReadiness(profile, ctx) {
  const checks = [];
    checks.push(migrationCheck(
      'compatibility-mode',
      'Mode compatibilite infra actuelle',
      profile.compatibilityMode ? 'pass' : 'warn',
      false,
      profile.compatibilityMode ? 'Mode safe actif (recommande).' : 'Mode safe desactive.',
      'Conserver ce mode actif tant que la cible commerciale n est pas validee.'
    ));

  const cfg = ctx.cfg || null;
  const watchers = ctx.watchers || null;
  const live = ctx.live || null;
  const overview = ctx.overview || null;
  const dns = ctx.dns || null;
  const dnsCfg = ctx.dnsCfg || null;

  const configured = !!cfg?.configured;
  const connected = !!cfg?.connectivity?.ok;
  checks.push(migrationCheck(
    'proxmox-api',
    'Connectivite API Proxmox',
    configured && connected ? 'pass' : 'fail',
    true,
    configured ? (connected ? `Noeud detecte: ${cfg?.connectivity?.node || 'N/A'}` : `Erreur: ${cfg?.connectivity?.error || 'connexion KO'}`) : 'Configuration PVE_* manquante',
    'Renseigner host/token et verifier l acces API Proxmox.'
  ));

  const hostMatch = !profile.proxmoxHost || !cfg?.host || profile.proxmoxHost === cfg.host;
  checks.push(migrationCheck(
    'proxmox-host-match',
    'Host cible coherent avec la connexion active',
    hostMatch ? 'pass' : 'warn',
    false,
    `Saisi: ${profile.proxmoxHost || 'N/A'} | Actif: ${cfg?.host || 'N/A'}`,
    'Verifier que le profil client pointe vers le bon Proxmox.'
  ));

  const tokenLooksOk = !profile.tokenId || (String(cfg?.tokenId || '') === String(profile.tokenId));
  checks.push(migrationCheck(
    'token-id',
    'Token ID attendu',
    tokenLooksOk ? 'pass' : 'warn',
    false,
    `Saisi: ${profile.tokenId || 'N/A'} | Actif: ${cfg?.tokenIdMasked || cfg?.tokenId || 'N/A'}`,
    'Aligner le token de la cible avant livraison.'
  ));

  const hasNetworkFields = !!profile.networkSubnet && !!profile.gateway && !!profile.dns;
  checks.push(migrationCheck(
    'network-fields',
    'Reseau client renseigne',
    hasNetworkFields ? 'pass' : 'warn',
    false,
    `Subnet=${profile.networkSubnet || 'N/A'}, GW=${profile.gateway || 'N/A'}, DNS=${profile.dns || 'N/A'}`,
    'Renseigner subnet/gateway/dns pour un runbook exploitable.'
  ));

  const containers = Array.isArray(live?.data) ? live.data : [];
  checks.push(migrationCheck(
    'inventory-live',
    'Inventaire Proxmox live detecte',
    containers.length > 0 ? 'pass' : 'fail',
    true,
    `${containers.length} CT/VM detectes`,
    'Verifier droits de lecture Proxmox et endpoint /api/proxmox/containers?live=1.'
  ));

  const unknownStatuses = containers.filter((c) => String(c?.resources?.status || 'unknown').toLowerCase() === 'unknown').length;
  checks.push(migrationCheck(
    'status-quality',
    'Qualite des statuts live',
    unknownStatuses === 0 ? 'pass' : 'warn',
    false,
    `${unknownStatuses} statut(s) unknown sur ${containers.length || 0}`,
    'Verifier guest agent VM, locks et etats transitoires Proxmox.'
  ));

  const runningVms = containers.filter((c) => c.type === 'qemu' && String(c?.resources?.status || '').toLowerCase() === 'running');
  const vmWithIp = runningVms.filter((c) => {
    const ip = String(c?.ip || '').trim().toLowerCase();
    return ip && ip !== '—' && ip !== 'unknown';
  }).length;
  const vmCoverage = runningVms.length ? (vmWithIp / runningVms.length) : 1;
  checks.push(migrationCheck(
    'vm-ip-coverage',
    'Couverture IP des VM en execution',
    vmCoverage >= 0.7 ? 'pass' : (runningVms.length ? 'warn' : 'pass'),
    false,
    `${vmWithIp}/${runningVms.length} VM running avec IP visible`,
    'Activer qemu-guest-agent dans les VM clientes (recommande).'
  ));

  const tasksRunning = !!watchers?.runtime?.tasksWatcherStarted;
  const syslogRunning = !!watchers?.runtime?.syslogWatcherStarted;
  checks.push(migrationCheck(
    'watchers-runtime',
    'Watchers Proxmox actifs',
    (tasksRunning && syslogRunning) ? 'pass' : 'warn',
    false,
    `tasks=${tasksRunning ? 'on' : 'off'}, syslog=${syslogRunning ? 'on' : 'off'}`,
    'Activer les watchers pour une observabilite complete en production.'
  ));

  const overviewOk = !!overview?.proxmox;
  checks.push(migrationCheck(
    'overview-ready',
    'Overview Proxmox exploitable',
    profile.requirePrometheus ? (overviewOk ? 'pass' : 'fail') : (overviewOk ? 'pass' : 'warn'),
    !!profile.requirePrometheus,
    overviewOk ? 'Mesures Proxmox disponibles.' : 'Overview incomplet ou indisponible.',
    'Verifier Prometheus/exporters si ce module est contractuel.'
  ));

  if (profile.requireTechnitium) {
    const dnsOk = !!dns?.ok
      && dns?.provider === 'technitium'
      && dns?.source !== 'error'
      && dns?.source !== 'disabled';
    checks.push(migrationCheck(
      'technitium-dns',
      'Integration DNS Technitium',
      dnsOk ? 'pass' : 'fail',
      true,
      dnsOk
        ? `Provider=${dns?.provider || 'N/A'} · Source=${dns?.source || 'N/A'} (${dns?.zones || 0} zone(s))`
        : `Provider=${dns?.provider || 'N/A'} · Source=${dns?.source || 'N/A'}`,
      'Configurer TECHNITIUM_* et verifier les zones cibles.'
    ));
  }

  if (dnsCfg) {
    const dnsCfgOk = !!dnsCfg.ok && !!dnsCfg.configReady && !!dnsCfg.healthy;
    checks.push(migrationCheck(
      'dns-provider-health',
      'Sante provider DNS actif',
      dnsCfgOk ? 'pass' : 'warn',
      false,
      `Provider=${dnsCfg?.provider || 'N/A'} · Source=${dnsCfg?.source || 'N/A'}`,
      dnsCfg?.recommendation || 'Aucune action DNS immediate.'
    ));
  }

  checks.push(migrationCheck(
    'power-mgmt',
    'Permission power management',
    profile.requirePowerMgmt ? (connected ? 'warn' : 'fail') : 'pass',
    !!profile.requirePowerMgmt,
    profile.requirePowerMgmt ? 'Validation destructive non executee automatiquement.' : 'Non requis.',
    'Verifier role VM.PowerMgmt sur la cible avant livraison.'
  ));

  checks.push(migrationCheck(
    'rollback-ready',
    'Plan de rollback',
    profile.rollbackReady ? 'pass' : 'fail',
    true,
    profile.rollbackReady ? 'Plan rollback confirme.' : 'Rollback non confirme.',
    'Documenter et tester une procedure de retour arriere.'
  ));

  checks.push(migrationCheck(
    'business-signoff',
    'Validation metier finale',
    profile.businessSignoff ? 'pass' : 'fail',
    true,
    profile.businessSignoff ? 'Validation metier cochee.' : 'Validation metier absente.',
    'Obtenir un GO metier signe avant bascule client.'
  ));

  const scoreRaw = checks.reduce((sum, c) => sum + (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0), 0);
  const score = Math.round((scoreRaw / Math.max(checks.length, 1)) * 100);
  const hasBlockingFail = checks.some((c) => c.blocking && c.status === 'fail');
  const decision = hasBlockingFail ? 'NO-GO' : 'GO';

  return {
    timestamp: new Date().toISOString(),
    score,
    decision,
    checks,
    snapshot: {
      containers: containers.length,
      connected,
    }
  };
}

function renderMigrationAuditUI(profile, audit) {
  const summary = qs('#admin-migration-summary');
  const checklist = qs('#admin-migration-checklist');
  if (!summary || !checklist) return;

  renderMigrationWizardSteps(profile, audit);

  if (!audit) {
    summary.innerHTML = '<div class="loading-spinner">Audit non lance</div>';
    checklist.innerHTML = '<div class="empty-state" style="padding:18px"><p>Renseignez le profil puis lancez l\'audit readiness.</p></div>';
    renderMigrationActionPlan(profile, null);
    return;
  }

  const go = audit.decision === 'GO';
  summary.innerHTML = `
    <div class="migration-score ${go ? 'go' : 'nogo'}">
      <div class="migration-score-title">Decision readiness</div>
      <div class="migration-score-value">${escHtml(audit.decision)}</div>
      <div class="migration-score-sub">Score ${audit.score}% · ${escHtml(profile.clientName || 'Client non renseigne')}</div>
    </div>
  `;

  checklist.innerHTML = audit.checks.map((c) => {
    const klass = c.status === 'pass' ? 'ok' : (c.status === 'warn' ? 'warn' : 'ko');
    const statusTxt = c.status === 'pass' ? 'OK' : (c.status === 'warn' ? 'WARN' : 'FAIL');
    return `
      <div class="migration-check-item ${klass}">
        <div class="migration-check-head">
          <span class="migration-check-title">${escHtml(c.title)}</span>
          <span class="migration-check-pill ${klass}">${statusTxt}${c.blocking ? ' · BLOQUANT' : ''}</span>
        </div>
        <div class="migration-check-detail">${escHtml(c.detail || '—')}</div>
        <div class="migration-check-rec">Action: ${escHtml(c.recommendation || 'Aucune')}</div>
      </div>
    `;
  }).join('');

  renderMigrationActionPlan(profile, audit);
}

function applyMigrationQuickAction(actionId) {
  const profile = readMigrationProfileFromForm();
  if (actionId === 'rollbackReady') profile.rollbackReady = true;
  if (actionId === 'businessSignoff') profile.businessSignoff = true;
  if (actionId === 'requireTechnitium') profile.requireTechnitium = true;
  if (actionId === 'requirePowerMgmt') profile.requirePowerMgmt = true;
  if (actionId === 'fill-network') {
    if (!profile.networkSubnet) profile.networkSubnet = '192.168.0.0/24';
    if (!profile.gateway) profile.gateway = '192.168.0.1';
    if (!profile.dns) profile.dns = '192.168.0.1,1.1.1.1';
  }
  saveMigrationProfile(profile);
  writeMigrationProfileToForm(profile);
}

async function runAdminMigrationAudit(options = {}) {
  const silent = !!options.silent;
  const profile = readMigrationProfileFromForm();
  saveMigrationProfile(profile);

  const resultEl = qs('#admin-migration-result');
  if (resultEl && !silent) {
    resultEl.className = 'form-result';
    resultEl.textContent = 'Audit en cours...';
    resultEl.classList.remove('hidden');
  }

  const calls = await Promise.allSettled([
    fetchProxmoxConfigCheck(),
    fetchProxmoxWatchers(),
    fetchProxmoxContainersLive(),
    fetchOverview(),
    profile.requireTechnitium ? fetchDnsStatus() : Promise.resolve(null),
    fetchDnsConfigCheck(),
  ]);

  const ctx = {
    cfg: calls[0].status === 'fulfilled' ? calls[0].value : null,
    watchers: calls[1].status === 'fulfilled' ? calls[1].value : null,
    live: calls[2].status === 'fulfilled' ? calls[2].value : null,
    overview: calls[3].status === 'fulfilled' ? calls[3].value : null,
    dns: calls[4].status === 'fulfilled' ? calls[4].value : null,
    dnsCfg: calls[5].status === 'fulfilled' ? calls[5].value : null,
  };

  const audit = evaluateMigrationReadiness(profile, ctx);
  State.migrationLastAudit = audit;
  renderMigrationAuditUI(profile, audit);

  if (resultEl && !silent) {
    resultEl.className = audit.decision === 'GO' ? 'form-result success' : 'form-result error';
    resultEl.textContent = `${audit.decision} · score ${audit.score}% (${audit.checks.length} controles)`;
    resultEl.classList.remove('hidden');
  }

  return audit;
}

function setMigrationAutoAudit(enabled) {
  if (State.migrationAutoAuditInterval) {
    clearInterval(State.migrationAutoAuditInterval);
    State.migrationAutoAuditInterval = null;
  }

  saveMigrationAutoAuditEnabled(enabled);
  if (!enabled) return;

  State.migrationAutoAuditInterval = setInterval(async () => {
    if (State.currentView !== 'admin') return;
    if (!qs('#view-admin.active')) return;
    await runAdminMigrationAudit({ silent: true });
  }, MIGRATION_AUTO_AUDIT_MS);
}

function renderAdminMigrationPanel() {
  const form = qs('#admin-migration-form');
  if (!form) return;
  const profile = loadMigrationProfile();
  writeMigrationProfileToForm(profile);
  renderMigrationAuditUI(profile, State.migrationLastAudit);
  const autoToggle = qs('#admin-migration-auto-audit');
  if (autoToggle) autoToggle.checked = loadMigrationAutoAuditEnabled();
}

function setupAdminMigrationPanel() {
  const form = qs('#admin-migration-form');
  if (!form || form.dataset.bound === '1') return;
  form.dataset.bound = '1';

  qs('#admin-migration-save')?.addEventListener('click', () => {
    const profile = readMigrationProfileFromForm();
    saveMigrationProfile(profile);
    const result = qs('#admin-migration-result');
    if (result) {
      result.className = 'form-result success';
      result.textContent = 'Profil migration sauvegarde.';
      result.classList.remove('hidden');
    }
  });

  qs('#admin-migration-audit')?.addEventListener('click', async () => {
    await runAdminMigrationAudit();
  });

  qs('#admin-migration-autofill')?.addEventListener('click', async () => {
    const result = qs('#admin-migration-result');
    try {
      if (result) {
        result.className = 'form-result';
        result.textContent = 'Préremplissage en cours...';
        result.classList.remove('hidden');
      }
      await prefillMigrationProfileFromLive();
      if (result) {
        result.className = 'form-result success';
        result.textContent = 'Profil prérempli depuis l\'infra active.';
      }
    } catch (e) {
      if (result) {
        result.className = 'form-result error';
        result.textContent = `Préremplissage impossible: ${e?.message || 'erreur'}`;
      }
    }
  });

  qs('#admin-migration-auto-audit')?.addEventListener('change', (e) => {
    setMigrationAutoAudit(!!e.currentTarget?.checked);
  });

  qs('#admin-migration-reset')?.addEventListener('click', () => {
    const defaults = getMigrationDefaultProfile();
    saveMigrationProfile(defaults);
    State.migrationLastAudit = null;
    writeMigrationProfileToForm(defaults);
    renderMigrationAuditUI(defaults, null);
    const result = qs('#admin-migration-result');
    if (result) {
      result.className = 'form-result';
      result.textContent = 'Profil reinitialise.';
      result.classList.remove('hidden');
    }
  });

  qs('#admin-migration-export-json')?.addEventListener('click', () => {
    const profile = readMigrationProfileFromForm();
    const payload = {
      profile,
      audit: State.migrationLastAudit,
      exportedAt: new Date().toISOString(),
    };
    const name = `migration-${(profile.clientName || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'client'}.json`;
    downloadTextFile(name, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  });

  qs('#admin-migration-export-runbook')?.addEventListener('click', () => {
    const profile = readMigrationProfileFromForm();
    const audit = State.migrationLastAudit || {
      timestamp: new Date().toISOString(),
      score: 0,
      decision: 'NO-GO',
      checks: [],
    };
    const text = buildMigrationRunbook(profile, audit);
    const name = `runbook-migration-${(profile.clientName || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'client'}.md`;
    downloadTextFile(name, text);
  });

  qs('#admin-migration-plan')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-migration-quick-action]');
    if (!btn) return;
    applyMigrationQuickAction(btn.dataset.migrationQuickAction);
    await runAdminMigrationAudit({ silent: true });
    toast('Action rapide appliquée au profil migration', 'success');
  });

  setMigrationAutoAudit(loadMigrationAutoAuditEnabled());
}

// ─── Edit Service Modal ───────────────────────────────────────────
function openEditServiceModal(serviceId) {
  const svc = State.data?.services?.find(s => s.id === serviceId);
  if (!svc) return;

  qs('#edit-modal-id').textContent = svc.id;
  qs('#edit-name').value = svc.name || '';
  qs('#edit-url').value = svc.url || '';
  qs('#edit-domain').value = svc.domain || '';
  qs('#edit-description').value = svc.description || '';
  qs('#edit-tags').value = Array.isArray(svc.tags) ? svc.tags.join(', ') : '';

  const catSel = qs('#edit-category');
  catSel.innerHTML = (State.data?.categories || []).map(c =>
    `<option value="${escHtml(c.id)}">${escHtml(c.name)}</option>`
  ).join('');
  catSel.value = svc.category || (State.data?.categories?.[0]?.id ?? '');

  qs('#edit-service-modal').dataset.serviceId = svc.id;
  qs('#edit-service-result')?.classList.add('hidden');
  qs('#edit-service-modal').classList.remove('hidden');
  lucideRefresh(qs('#edit-service-modal'));
}

function closeEditServiceModal() {
  qs('#edit-service-modal')?.classList.add('hidden');
}

async function saveEditServiceModal() {
  const modal = qs('#edit-service-modal');
  const id = modal?.dataset.serviceId;
  if (!id) return;

  const payload = {
    name: qs('#edit-name')?.value?.trim(),
    category: qs('#edit-category')?.value,
    url: qs('#edit-url')?.value?.trim(),
    domain: qs('#edit-domain')?.value?.trim() || undefined,
    description: qs('#edit-description')?.value?.trim() || undefined,
    tags: (qs('#edit-tags')?.value || '').split(',').map(t => t.trim()).filter(Boolean),
  };

  const result = qs('#edit-service-result');
  try {
    if (!payload.name || !payload.category || !payload.url) throw new Error('Nom, catégorie et URL sont requis');
    await updateService(id, payload);
    State.data = await fetchServices();
    toast(`Service "${payload.name}" modifié`, 'success');
    if (State.currentView === 'admin') renderAdminServicesList();
    if (State.currentView === 'services') renderServicesView();
    if (State.currentView === 'dashboard') renderDashboard();
    if (State.currentView === 'infrastructure') renderInfrastructure();
    closeEditServiceModal();
  } catch (e) {
    if (result) {
      result.textContent = `✗ ${e.message}`;
      result.className = 'form-result error';
      result.classList.remove('hidden');
    }
    toast(e.message, 'error');
  }
}

// ─── Recherche globale ────────────────────────────────────────────
function setupSearch() {
  const input = qs('#global-search');
  const overlay = qs('#search-overlay');
  const results = qs('#search-results');

  if (!input) return;

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q || !State.data) { overlay.classList.add('hidden'); return; }

    const matches = State.data.services.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      (s.tags || []).some(t => t.toLowerCase().includes(q)) ||
      (s.domain || '').toLowerCase().includes(q)
    ).slice(0, 8);

    if (!matches.length) {
      results.innerHTML = `<div class="empty-state" style="padding:20px"><p>Aucun résultat pour "${escHtml(q)}"</p></div>`;
    } else {
      results.innerHTML = matches.map(s => `
        <div class="search-result-item" data-open="${s.id}">
          <span class="sr-icon" style="color:${getCatColor(s.category)}">
            <i data-lucide="${ICON_MAP[s.icon] || 'server'}"></i>
          </span>
          <span class="sr-name">${escHtml(s.name)}</span>
          <span class="sr-cat">${escHtml(getCatName(s.category))}</span>
        </div>`).join('');
      lucideRefresh(results);
      qsa('.search-result-item', results).forEach(item => {
        item.addEventListener('click', () => {
          openServiceModal(item.dataset.open);
          input.value = '';
          overlay.classList.add('hidden');
        });
      });
    }
    overlay.classList.remove('hidden');
  });

  input.addEventListener('blur', () => {
    setTimeout(() => overlay.classList.add('hidden'), 150);
  });
  input.addEventListener('focus', () => {
    if (input.value.trim()) overlay.classList.remove('hidden');
  });
}

// ─── Clock ────────────────────────────────────────────────────────
function startClock() {
  const el = qs('#sidebar-clock');
  if (!el) return;
  const update = () => {
    const now = new Date();
    el.textContent = now.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  };
  update();
  setInterval(update, 1000);
}

// ─── Keyboard shortcuts ───────────────────────────────────────────
function setupKeyboard() {
  document.addEventListener('keydown', e => {
    // Ctrl+K : focus recherche
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      qs('#global-search')?.focus();
    }
    // Escape : fermer modal / overlay
    if (e.key === 'Escape') {
      closeModal();
      closeContainerModal();
      closeChangelogModal();
      closeStoragePoolModal();
      qs('#search-overlay')?.classList.add('hidden');
      qs('#global-search').value = '';
    }
    // Chiffres 1-7 : navigation rapide
    const navKeys = ['1','2','3','4','5','6','7'];
    if (navKeys.includes(e.key) && !e.target.matches('input,textarea')) {
      const views = VIEWS;
      const idx = parseInt(e.key) - 1;
      if (views[idx]) navigateTo(views[idx]);
    }
  });
}

// ─── Setup des boutons de filtre ──────────────────────────────────
function setupFilterButtons() {
  qsa('.filter-btn[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.filter === 'all' || btn.dataset.filter === 'up' || btn.dataset.filter === 'down') {
        State.filterStatus = btn.dataset.filter;
        qsa('.filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyFilters();
      }
    });
  });
}

// ─── Formulaire Add Service (Admin) ──────────────────────────────
function setupAdminForm() {
  const form = qs('#add-service-form');
  const result = qs('#add-service-result');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const data = {};
    fd.forEach((v, k) => { data[k] = v || undefined; });
    if (data.tags) data.tags = data.tags.split(',').map(t => t.trim()).filter(Boolean);
    if (data.port) data.port = parseInt(data.port);
    data.favorite = !!form.querySelector('[name="favorite"]')?.checked;
    data.status = 'unknown';
    data.icon = 'server';

    try {
      await addService(data);
      State.data = await fetchServices(); // Recharger
      // Si l'utilisateur coche "favori", on l'ajoute aussi à la liste locale.
      if (data.favorite) {
        State.favorites.add(data.id);
        saveFavorites();
      }
      form.reset();
      result.textContent = `✓ Service "${data.name}" ajouté avec succès !`;
      result.className = 'form-result success';
      result.classList.remove('hidden');
      toast(`Service "${data.name}" ajouté`, 'success');
      renderAdminServicesList();
      setTimeout(() => result.classList.add('hidden'), 4000);
    } catch(err) {
      result.textContent = `✗ ${err.message}`;
      result.className = 'form-result error';
      result.classList.remove('hidden');
      toast(err.message, 'error');
    }
  });
}

// ─── Formulaire Notes ─────────────────────────────────────────────
function setupNotesForm() {
  const btn      = qs('#new-note-btn');
  const form     = qs('#note-form');
  const saveBtn  = qs('#save-note-btn');
  const cancelBtn = qs('#cancel-note-btn');

  btn?.addEventListener('click', () => {
    form?.classList.toggle('hidden');
    qs('#note-title')?.focus();
  });
  cancelBtn?.addEventListener('click', () => form?.classList.add('hidden'));

  qsa('.color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      qsa('.color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      State.noteColor = dot.dataset.color;
    });
  });

  saveBtn?.addEventListener('click', async () => {
    const title   = qs('#note-title')?.value.trim();
    const content = qs('#note-content')?.value.trim();
    if (!content) { toast('Le contenu ne peut pas être vide', 'error'); return; }
    try {
      await saveNote({ title: title || 'Note sans titre', content, color: State.noteColor });
      toast('Note sauvegardée', 'success');
      qs('#note-title').value = '';
      qs('#note-content').value = '';
      form?.classList.add('hidden');
      loadNotesView();
    } catch(e) { toast('Erreur sauvegarde', 'error'); }
  });
}

// ─── Formulaire Changelog ─────────────────────────────────────────
function setupChangelogForm() {
  const btn       = qs('#new-log-btn');
  const form      = qs('#log-form');
  const saveBtn   = qs('#save-log-btn');
  const cancelBtn = qs('#cancel-log-btn');

  btn?.addEventListener('click', () => { form?.classList.toggle('hidden'); qs('#log-message')?.focus(); });
  cancelBtn?.addEventListener('click', () => form?.classList.add('hidden'));

  saveBtn?.addEventListener('click', async () => {
    const message = qs('#log-message')?.value.trim();
    const type    = qs('#log-type')?.value;
    if (!message) { toast('Le message ne peut pas être vide', 'error'); return; }
    try {
      await addChangelogEntry({ message, type });
      toast('Entrée ajoutée au journal', 'success');
      qs('#log-message').value = '';
      form?.classList.add('hidden');
      loadChangelogView();
    } catch(e) { toast('Erreur ajout journal', 'error'); }
  });
}

// ─── Sidebar toggle ───────────────────────────────────────────────
function setupSidebar() {
  qs('#sidebar-toggle')?.addEventListener('click', () => {
    const sidebar = qs('#sidebar');
    if (window.innerWidth <= 768) {
      sidebar.classList.toggle('mobile-open');
      document.body.classList.toggle('has-sidebar-drawer', sidebar.classList.contains('mobile-open'));
    } else {
      sidebar.classList.toggle('collapsed');
    }
  });

  // Clic sur l'overlay (fond) => ferme le drawer
  document.addEventListener('click', (e) => {
    const sidebar = qs('#sidebar');
    if (!sidebar || window.innerWidth > 768) return;
    if (!sidebar.classList.contains('mobile-open')) return;
    const insideSidebar = e.target.closest('#sidebar');
    const isToggle = e.target.closest('#sidebar-toggle');
    if (!insideSidebar && !isToggle) {
      sidebar.classList.remove('mobile-open');
      document.body.classList.remove('has-sidebar-drawer');
    }
  });
}

// ─── Spinning animation pour refresh ─────────────────────────────
const spinStyle = document.createElement('style');
spinStyle.textContent = `.spinning svg { animation: spin .6s linear infinite; }`;
document.head.appendChild(spinStyle);

// ═══════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════
async function init() {
  console.log('%cProxmox-Interfaces v1.0.0', 'color:#6366f1;font-weight:bold;font-size:14px');

  loadFavorites();
  loadStatusCache();
  loadOverviewCache();
  startClock();
  setupSearch();
  setupKeyboard();
  setupSidebar();
  setupMonitoringCollapsibles();
  setupNotesForm();
  setupChangelogForm();
  setupAdminMigrationPanel();

  // Chargement des données
  try {
    State.data = await fetchServices();
    seedFavoritesFromDataIfNeeded();
  } catch(e) {
    console.error('Impossible de charger les services:', e);
    toast('Erreur de chargement des données', 'error');
  }

  // Rendu initial
  if (State.data) {
    renderDashboard();
    renderServicesView();
    setupFilterButtons();
    setupAdminForm();
    updateStatCounts();
  }

  // Navigation initiale
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  navigateTo(hash);

  // Nav click events
  qsa('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(item.dataset.view);
    });
  });

  // Modal events
  qs('#modal-overlay')?.addEventListener('click', closeModal);
  qs('#modal-close')?.addEventListener('click', closeModal);
  qs('#modal-close-footer')?.addEventListener('click', closeModal);

  // Container modal events
  qs('#ct-modal-overlay')?.addEventListener('click', closeContainerModal);
  qs('#ct-modal-close')?.addEventListener('click', closeContainerModal);
  qs('#ct-modal-close-footer')?.addEventListener('click', closeContainerModal);
  qs('#ct-modal-start-btn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const btn = e.currentTarget;
    const type = btn?.dataset?.ctType;
    const vmid = btn?.dataset?.ctVmid;
    const ctId = btn?.dataset?.ctId;
    if (!type || !vmid || !ctId) return;
    if (!confirm(`Allumer ${ctId.toUpperCase()} ?`)) return;

    const stopBtn = qs('#ct-modal-stop-btn');
    const previousHtml = btn.innerHTML;
    btn.disabled = true;
    if (stopBtn) stopBtn.disabled = true;
    setGuestTransitionState(ctId, 'starting');
    setCtModalPowerState('Action en cours : démarrage...');
    btn.innerHTML = '<i data-lucide="loader-circle"></i> Démarrage...';
    lucideRefresh(btn);

    try {
      await setGuestPowerState(type, vmid, 'start');
      toast(`${ctId.toUpperCase()} en démarrage`, 'success');
      await refreshAfterPowerStart(ctId);
    } catch (err) {
      setGuestTransitionState(ctId, null);
      toast(err?.message || 'Erreur démarrage CT/VM', 'error');
      setCtModalPowerState('Échec du démarrage');
    } finally {
      btn.disabled = false;
      btn.innerHTML = previousHtml;
      lucideRefresh(btn);
    }
  });

  qs('#ct-modal-stop-btn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const btn = e.currentTarget;
    const type = btn?.dataset?.ctType;
    const vmid = btn?.dataset?.ctVmid;
    const ctId = btn?.dataset?.ctId;
    if (!type || !vmid || !ctId) return;
    if (!confirm(`Éteindre ${ctId.toUpperCase()} ?`)) return;

    const startBtn = qs('#ct-modal-start-btn');
    const previousHtml = btn.innerHTML;
    btn.disabled = true;
    if (startBtn) startBtn.disabled = true;
    setGuestTransitionState(ctId, 'stopping');
    setCtModalPowerState('Action en cours : arrêt...');
    btn.innerHTML = '<i data-lucide="loader-circle"></i> Arrêt...';
    lucideRefresh(btn);

    try {
      await setGuestPowerState(type, vmid, 'stop');
      toast(`${ctId.toUpperCase()} en arrêt`, 'success');
      await refreshLiveData();
      renderMonitoringInfraMetrics();
      renderInfrastructure();
      renderIpTable();
      openContainerModal(ctId);
    } catch (err) {
      setGuestTransitionState(ctId, null);
      toast(err?.message || 'Erreur arrêt CT/VM', 'error');
      setCtModalPowerState('Échec de l’arrêt');
    } finally {
      btn.disabled = false;
      btn.innerHTML = previousHtml;
      lucideRefresh(btn);
    }
  });

  // Changelog modal events
  qs('#cl-modal-overlay')?.addEventListener('click', closeChangelogModal);
  qs('#cl-modal-close')?.addEventListener('click', closeChangelogModal);
  qs('#cl-modal-close-footer')?.addEventListener('click', closeChangelogModal);
  qs('#cl-modal-copy-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const payload = btn?.dataset?.payload || '';
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
      toast('Détail de l\'événement copié', 'success');
    } catch {
      toast('Impossible de copier automatiquement', 'error');
    }
  });

  // Storage pool modal events
  qs('#sp-modal-overlay')?.addEventListener('click', closeStoragePoolModal);
  qs('#sp-modal-close')?.addEventListener('click', closeStoragePoolModal);
  qs('#sp-modal-close-footer')?.addEventListener('click', closeStoragePoolModal);
  qs('#sp-modal-maintenance-section')?.addEventListener('toggle', saveStorageModalSectionPrefs);
  qs('#sp-modal-details-section')?.addEventListener('toggle', saveStorageModalSectionPrefs);

  // Edit service modal events
  qs('#edit-modal-overlay')?.addEventListener('click', closeEditServiceModal);
  qs('#edit-modal-close')?.addEventListener('click', closeEditServiceModal);
  qs('#edit-cancel-btn')?.addEventListener('click', (e) => { e.preventDefault(); closeEditServiceModal(); });
  qs('#edit-save-btn')?.addEventListener('click', (e) => { e.preventDefault(); saveEditServiceModal(); });

  qs('#modal-promote-btn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const btn = e.currentTarget;
    const serviceId = btn?.dataset?.serviceId;
    if (!serviceId) return;

    const svc = State.data?.services?.find(s => s.id === serviceId);
    if (!svc || !svc.autoDiscovered) return;
    if (!confirm(`Valider définitivement le service auto "${svc.name}" ?`)) return;

    btn.disabled = true;
    const previousHtml = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="loader-circle"></i> Validation...';
    lucideRefresh(btn);

    try {
      const result = await promoteAutoService(serviceId);
      const promoted = result?.service;

      if (promoted?.id && State.statuses[serviceId]) {
        State.statuses[promoted.id] = State.statuses[serviceId];
        delete State.statuses[serviceId];
        saveStatusCache();
      }

      State.data = await fetchServices();
      updateStatCounts();
      renderDashboard();
      renderServicesView();
      renderMonitoringStatusList();
      renderMonitoringInfraMetrics();
      renderInfrastructure();
      renderIpTable();
      if (State.currentView === 'admin') renderAdminServicesList();

      closeModal();
      if (promoted?.id) openServiceModal(promoted.id);
      toast(result?.alreadyExists ? 'Service déjà validé' : 'Service auto validé avec succès', 'success');
      await refreshHealth();
    } catch (err) {
      toast(err.message || 'Erreur lors de la validation', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = previousHtml;
      lucideRefresh(btn);
    }
  });

  qs('#modal-reject-btn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const btn = e.currentTarget;
    const serviceId = btn?.dataset?.serviceId;
    if (!serviceId) return;

    const svc = State.data?.services?.find(s => s.id === serviceId);
    if (!svc || !svc.autoDiscovered) return;
    if (!confirm(`Refuser ce service auto "${svc.name}" ? Il sera masqué des découvertes.`)) return;

    btn.disabled = true;
    const previousHtml = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="loader-circle"></i> Refus...';
    lucideRefresh(btn);

    try {
      await rejectAutoService(serviceId);
      State.data = await fetchServices();
      updateStatCounts();
      renderDashboard();
      renderServicesView();
      renderMonitoringStatusList();
      renderMonitoringInfraMetrics();
      renderInfrastructure();
      renderIpTable();
      if (State.currentView === 'admin') renderAdminServicesList();

      closeModal();
      toast('Service auto refusé et masqué', 'success');
      await refreshHealth();
    } catch (err) {
      toast(err.message || 'Erreur lors du refus', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = previousHtml;
      lucideRefresh(btn);
    }
  });

  // Refresh btn
  qs('#refresh-btn')?.addEventListener('click', refreshHealth);
  qs('#admin-watchers-refresh')?.addEventListener('click', (e) => {
    e.preventDefault();
    renderAdminProxmoxConfigStatus();
    renderAdminWatchersStatus();
  });

  // Premier health check
  await refreshHealth();

  // Mettre à jour les vues qui dépendent des statuts
  renderFavorites();
  renderMonitoringStatusList();
  renderMonitoringInfraMetrics();
  renderIpTable();

  // Applique immédiatement le cache statuts (évite l'écran unknown au reload)
  updateHealthUI();
  updateStatCounts();

  // Auto-refresh toutes les 30 secondes
  State.healthInterval = setInterval(refreshHealth, 30000);

  // Auto-refresh overview toutes les 15 secondes (historique maintenu même hors Monitoring)
  State.overviewInterval = setInterval(async () => {
    await renderMonitoringOverview();

    if (State.currentView === 'monitoring') {
      await refreshLiveData();
      renderMonitoringInfraMetrics();
      renderMonitoringStatusList();
    }
  }, 15000);

  lucide.createIcons();

  // Tooltips sparklines (Monitoring)
  setupSparkTooltip('#ov-cpu-spark', () => State.overviewPoints.cpu);
  setupSparkTooltip('#ov-ram-spark', () => State.overviewPoints.ram);
  setupSparkTooltip('#ov-disk-spark', () => State.overviewPoints.disk);
  setupSparkTooltip('#ov-vram-spark', () => State.overviewPoints.vram);

  // Range buttons
  const panel = qs('#overview-range-panel');
  const toggle = qs('#overview-range-toggle');
  toggle?.addEventListener('click', (e) => {
    e.preventDefault();
    panel?.classList.toggle('hidden');
    toggle.classList.toggle('open', !panel.classList.contains('hidden'));
  });

  qsa('#overview-range-panel .range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = parseInt(btn.dataset.rangeMin, 10);
      if (m) setOverviewRange(m);
    });
  });

  // Clic en dehors => ferme
  document.addEventListener('click', (e) => {
    if (!panel || !toggle) return;
    if (panel.classList.contains('hidden')) return;
    const inside = e.target.closest('#overview-range');
    if (!inside) {
      panel.classList.add('hidden');
      toggle.classList.remove('open');
    }
  });

  setOverviewRange(State.overviewRangeMin || 5);

  console.log('%c✓ Intranet prêt', 'color:#22c55e;font-weight:bold');
}

// Démarrage
document.addEventListener('DOMContentLoaded', init);
