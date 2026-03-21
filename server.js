'use strict';

const express = require('express');
const http = require('http');
const https = require('https');
const net = require('net');
const dns = require('dns').promises;
const { execFile } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');

const execFileAsync = util.promisify(execFile);

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Middlewares ----------
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Chemins de données ----------
const SERVICES_FILE = path.join(__dirname, 'public', 'data', 'services.json');
const NOTES_FILE    = path.join(__dirname, 'data', 'notes.json');
const CHANGELOG_FILE = path.join(__dirname, 'data', 'changelog.json');
const HEALTH_FILE = path.join(__dirname, 'data', 'health.json');
const PROMOTIONS_FILE = path.join(__dirname, 'data', 'service-promotions.json');
const PVE_WATCH_STATE_FILE = path.join(__dirname, 'data', 'pve-watch-state.json');
const AUTO_REJECTIONS_FILE = path.join(__dirname, 'data', 'auto-service-rejections.json');

// Créer les dossiers/fichiers si nécessaire
[path.join(__dirname, 'data')].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});
if (!fs.existsSync(NOTES_FILE))     fs.writeFileSync(NOTES_FILE,     JSON.stringify([], null, 2));
if (!fs.existsSync(CHANGELOG_FILE)) fs.writeFileSync(CHANGELOG_FILE, JSON.stringify([], null, 2));
if (!fs.existsSync(HEALTH_FILE))    fs.writeFileSync(HEALTH_FILE,    JSON.stringify({ ts: 0, results: [] }, null, 2));
if (!fs.existsSync(PROMOTIONS_FILE)) fs.writeFileSync(PROMOTIONS_FILE, JSON.stringify([], null, 2));
if (!fs.existsSync(AUTO_REJECTIONS_FILE)) fs.writeFileSync(AUTO_REJECTIONS_FILE, JSON.stringify([], null, 2));
if (!fs.existsSync(PVE_WATCH_STATE_FILE)) {
  fs.writeFileSync(PVE_WATCH_STATE_FILE, JSON.stringify({
    ts: 0,
    taskStates: {},
    syslogSeen: []
  }, null, 2));
}

// ---------- Helpers ----------
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function readAutoServiceRejections() {
  try {
    const data = readJson(AUTO_REJECTIONS_FILE);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function toPlainObject(value) {
  return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : undefined;
}

function buildChangedFields(beforeObj, afterObj) {
  const before = beforeObj || {};
  const after = afterObj || {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [];
  for (const key of keys) {
    const b = before[key];
    const a = after[key];
    if (JSON.stringify(b) !== JSON.stringify(a)) changed.push(key);
  }
  return changed;
}

function appendChangelog(entry) {
  const cl = readJson(CHANGELOG_FILE);
  const before = toPlainObject(entry.before);
  const after = toPlainObject(entry.after);
  const details = toPlainObject(entry.details);
  const meta = toPlainObject(entry.meta);
  const changedFields = Array.isArray(entry.changedFields)
    ? entry.changedFields
    : (before && after ? buildChangedFields(before, after) : undefined);

  const normalized = {
    id: Date.now(),
    type: entry.type || 'info',
    message: entry.message || entry.service || 'Événement',
    service: entry.service || null,
    date: new Date().toISOString(),
    author: entry.author || 'system',
    source: entry.source || 'application',
    entity: entry.entity || null,
    entityId: entry.entityId || null,
    details,
    meta,
    before,
    after,
    changedFields,
  };
  cl.unshift(normalized);
  writeJson(CHANGELOG_FILE, cl.slice(0, 200));
}

function readPveWatchState() {
  try {
    const raw = readJson(PVE_WATCH_STATE_FILE);
    return {
      ts: Number(raw?.ts || 0),
      taskStates: raw?.taskStates && typeof raw.taskStates === 'object' ? raw.taskStates : {},
      syslogSeen: Array.isArray(raw?.syslogSeen) ? raw.syslogSeen : []
    };
  } catch {
    return { ts: 0, taskStates: {}, syslogSeen: [] };
  }
}

function writePveWatchState(taskStatesMap, syslogSeenSet) {
  try {
    const taskEntries = Array.from(taskStatesMap.entries()).slice(-2000);
    const taskStates = {};
    taskEntries.forEach(([upid, state]) => {
      taskStates[upid] = {
        status: state?.status || 'unknown',
        endtime: state?.endtime || null
      };
    });

    const syslogSeen = Array.from(syslogSeenSet).slice(-2000);
    writeJson(PVE_WATCH_STATE_FILE, {
      ts: Date.now(),
      taskStates,
      syslogSeen
    });
  } catch {
    // silence
  }
}

// ---------- Health cache ----------
let healthCache = { ts: 0, results: [] };
try {
  healthCache = readJson(HEALTH_FILE);
} catch {
  healthCache = { ts: 0, results: [] };
}

async function runHealthChecks() {
  try {
    const data = await getMergedData();
    const checks = (data.services || []).map(s => checkService(s));
    const results = await Promise.all(checks);
    healthCache = { ts: Date.now(), results };
    writeJson(HEALTH_FILE, healthCache);
  } catch {
    // keep last
  }
}

function isIPv4(host) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

function safeUrlParse(urlStr) {
  try {
    return new URL(urlStr);
  } catch {
    return null;
  }
}

async function resolveHostnameToIPv4(hostname) {
  if (!hostname) return null;
  if (isIPv4(hostname)) return hostname;
  try {
    const res = await dns.lookup(hostname, { family: 4 });
    return res?.address || null;
  } catch {
    return null;
  }
}

function normalizeHostname(hostname) {
  if (!hostname) return null;
  let h = String(hostname).trim().toLowerCase().replace(/\.$/, '');
  if (!h || h === 'localhost' || h === '—') return null;
  if (isIPv4(h)) return null;
  if (!h.includes('.')) h = `${h}.lan`;
  if (!/^[a-z0-9.-]+$/.test(h)) return null;
  return h;
}

function slugifyId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'service';
}

function toDnsLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\.lan$/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'service';
}

function makeUniqueServiceId(baseId, usedIds) {
  let id = baseId;
  let i = 2;
  while (usedIds.has(id)) {
    id = `${baseId}-${i}`;
    i += 1;
  }
  usedIds.add(id);
  return id;
}

function getServiceIdentityKey(service) {
  if (!service) return null;
  const domainParsed = safeUrlParse(service.domain || '');
  const urlParsed = safeUrlParse(service.url || '');

  const host = normalizeHostname(domainParsed?.hostname)
    || normalizeHostname(urlParsed?.hostname)
    || null;

  const protocol = String(service.protocol || urlParsed?.protocol || 'http').replace(':', '').toLowerCase();
  const port = Number(urlParsed?.port)
    || Number(service.port)
    || (protocol === 'https' ? 443 : 80);

  if (!host || !Number.isFinite(port)) return null;
  return `${host}:${port}`;
}

function invalidateLiveCaches() {
  mergedCache = { ts: 0, data: null };
  healthCache = { ts: 0, results: [] };
}

function buildPromotedServiceFromAuto(autoService, base, usedIds) {
  const categories = base?.categories || [];
  const categoryIds = new Set(categories.map(c => c.id));
  const fallbackCategory = categories[0]?.id || 'infrastructure';
  const category = categoryIds.has(autoService.category)
    ? autoService.category
    : (categoryIds.has('infrastructure') ? 'infrastructure' : fallbackCategory);

  const domainParsed = safeUrlParse(autoService.domain || '');
  const domainHost = normalizeHostname(domainParsed?.hostname);
  const protocol = String(autoService.protocol || domainParsed?.protocol || 'http').replace(':', '').toLowerCase();
  const port = Number(autoService.port) || Number(domainParsed?.port) || (protocol === 'https' ? 443 : 80);
  const isDefaultPort = (protocol === 'http' && port === 80) || (protocol === 'https' && port === 443);

  const baseId = domainHost
    ? slugifyId(isDefaultPort ? domainHost.replace(/\.lan$/i, '') : `${domainHost.replace(/\.lan$/i, '')}-${port}`)
    : slugifyId(autoService.name || autoService.id || 'service');

  const id = makeUniqueServiceId(baseId, usedIds);

  const domain = autoService.domain || autoService.url;
  const url = domain || autoService.url;

  return {
    id,
    name: autoService.name,
    category,
    description: autoService.description || `Service validé automatiquement depuis ${autoService.container || 'conteneur inconnu'}`,
    longDescription: autoService.longDescription || autoService.description || 'Service découvert en live puis validé.',
    url,
    domain,
    ip: autoService.ip || '—',
    port,
    protocol,
    icon: autoService.icon || 'server',
    tags: Array.from(new Set([...(autoService.tags || []), 'validated'])),
    container: autoService.container || '—',
    favorite: !!autoService.favorite,
    status: 'unknown',
    promotedFromAuto: true,
    promotedAt: new Date().toISOString(),
    autoSource: autoService.autoSource || 'live-discovery'
  };
}

async function resolvePtrHostnames(ip) {
  if (!isIPv4(ip)) return [];
  try {
    const names = await dns.reverse(ip);
    const uniq = Array.from(new Set((names || [])
      .map(normalizeHostname)
      .filter(Boolean)));
    return uniq;
  } catch {
    return [];
  }
}

const COMMON_SERVICE_PORTS = [80, 81, 3000, 3001, 5380, 5678, 8080, 8081, 8188, 9090, 9443, 443];
let endpointDiscoveryCache = { ts: 0, byIp: new Map() };
let hostProbeCache = { ts: 0, map: new Map() };

function isOpenTcpPort(ip, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));

    try {
      socket.connect(port, ip);
    } catch {
      finish(false);
    }
  });
}

function probeHttpLike(protocol, host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const mod = protocol === 'https' ? https : http;
    const req = mod.request({
      hostname: host,
      port,
      method: 'HEAD',
      path: '/',
      timeout: timeoutMs,
      rejectUnauthorized: false
    }, (res) => {
      // Toute réponse HTTP valide (même 401/403/5xx) confirme le protocole.
      res.resume();
      resolve(true);
    });

    req.once('timeout', () => { req.destroy(); resolve(false); });
    req.once('error', () => resolve(false));
    req.end();
  });
}

async function detectEndpointProtocol(ip, port) {
  const httpsFirst = port === 443 || port === 9443;
  const first = httpsFirst ? 'https' : 'http';
  const second = httpsFirst ? 'http' : 'https';

  if (await probeHttpLike(first, ip, port)) return first;
  if (await probeHttpLike(second, ip, port)) return second;
  return httpsFirst ? 'https' : 'http';
}

function signatureFromResponse(res) {
  return {
    ok: true,
    code: res.statusCode || 0,
    location: String(res.headers?.location || ''),
    server: String(res.headers?.server || ''),
    poweredBy: String(res.headers?.['x-powered-by'] || ''),
    contentType: String(res.headers?.['content-type'] || '')
  };
}

function signaturesEqual(a, b) {
  if (!a || !b) return false;
  return a.ok === b.ok
    && a.code === b.code
    && a.location === b.location
    && a.server === b.server
    && a.poweredBy === b.poweredBy
    && a.contentType === b.contentType;
}

function probeHostSignature(protocol, ip, port, hostHeader, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const mod = protocol === 'https' ? https : http;
    const req = mod.request({
      hostname: ip,
      port,
      method: 'HEAD',
      path: '/',
      timeout: timeoutMs,
      rejectUnauthorized: false,
      servername: hostHeader,
      headers: {
        Host: hostHeader
      }
    }, (res) => {
      res.resume();
      resolve(signatureFromResponse(res));
    });

    req.once('timeout', () => { req.destroy(); resolve({ ok: false, code: 0 }); });
    req.once('error', () => resolve({ ok: false, code: 0 }));
    req.end();
  });
}

async function getHostSignature(protocol, ip, port, hostHeader) {
  const now = Date.now();
  if ((now - hostProbeCache.ts) > 30_000) hostProbeCache = { ts: now, map: new Map() };

  const key = `${protocol}|${ip}|${port}|${hostHeader}`;
  const cached = hostProbeCache.map.get(key);
  if (cached && (now - cached.ts) < 30_000) return cached.sig;

  const sig = await probeHostSignature(protocol, ip, port, hostHeader);
  hostProbeCache.map.set(key, { ts: now, sig });
  return sig;
}

async function selectHostsForEndpoint(domainHosts, ip, port, protocol) {
  if (!domainHosts.length) return [];
  if (domainHosts.length === 1 || !isIPv4(ip)) return domainHosts;

  const randomHost = `unknown-${Date.now()}.invalid.lan`;
  const baseline = await getHostSignature(protocol, ip, port, randomHost);

  const selected = [];
  for (const host of domainHosts) {
    const sig = await getHostSignature(protocol, ip, port, host);
    if (!sig.ok) continue;
    if (!baseline.ok || !signaturesEqual(sig, baseline)) {
      selected.push(host);
    }
  }

  // Si aucun host ne se distingue du fallback, on garde le canonique uniquement pour éviter les faux positifs.
  return selected.length ? selected : [domainHosts[0]];
}

async function discoverServiceEndpoints(ip) {
  if (!isIPv4(ip)) return [];

  const now = Date.now();
  const cacheHit = endpointDiscoveryCache.byIp.get(ip);
  if (cacheHit && (now - cacheHit.ts) < 30_000) return cacheHit.endpoints;
  if ((now - endpointDiscoveryCache.ts) > 30_000) {
    endpointDiscoveryCache = { ts: now, byIp: new Map() };
  }

  const isOpen = await Promise.all(COMMON_SERVICE_PORTS.map(async (p) => ({
    port: p,
    open: await isOpenTcpPort(ip, p)
  })));

  const openPorts = isOpen.filter(x => x.open).map(x => x.port).sort((a, b) => a - b);

  const endpoints = await Promise.all(openPorts.map(async (port) => ({
    port,
    protocol: await detectEndpointProtocol(ip, port)
  })));

  if (!endpoints.length) {
    endpoints.push({ port: 80, protocol: 'http', fallback: true });
  }

  endpointDiscoveryCache.byIp.set(ip, { ts: now, endpoints });
  return endpoints;
}

async function buildAutoDiscoveredServices(containers, existingServices, categories, dnsIndex) {
  const categoryIds = new Set((categories || []).map(c => c.id));
  const defaultCategory = categoryIds.has('infrastructure')
    ? 'infrastructure'
    : ((categories || [])[0]?.id || 'infrastructure');

  const usedIds = new Set((existingServices || []).map(s => s.id));
  const knownHostPorts = new Set();
  const knownIpPorts = new Set();
  const knownContainerIpPorts = new Map();
  const existingDomainPorts = new Map();
  const existingDomains = new Set();

  const addExistingDomainPort = (host, port) => {
    const normalized = normalizeHostname(host);
    if (!normalized || !Number.isFinite(port)) return;
    if (!existingDomainPorts.has(normalized)) existingDomainPorts.set(normalized, new Set());
    existingDomainPorts.get(normalized).add(port);
  };

  (existingServices || []).forEach((s) => {
    const domainUrl = safeUrlParse(s.domain || '');
    const urlParsed = safeUrlParse(s.url || '');
    const protocol = (s.protocol || urlParsed?.protocol || 'http').replace(':', '');
    const port = urlParsed?.port
      ? parseInt(urlParsed.port, 10)
      : (s.port || (protocol === 'https' ? 443 : 80));

    const domainHost = normalizeHostname(domainUrl?.hostname);
    const urlHost = normalizeHostname(urlParsed?.hostname);
    const ip = isIPv4(s?.ip) ? s.ip : (isIPv4(urlParsed?.hostname) ? urlParsed.hostname : null);
    const hasIpHost = isIPv4(domainUrl?.hostname) || isIPv4(urlParsed?.hostname) || isIPv4(s?.ip);
    const containerKey = String((s?.container || '')).trim().toLowerCase();

    if (domainHost && Number.isFinite(port)) knownHostPorts.add(`${domainHost}:${port}`);
    if (urlHost && Number.isFinite(port)) knownHostPorts.add(`${urlHost}:${port}`);
    if (ip && Number.isFinite(port)) knownIpPorts.add(`${ip}:${port}`);
    if (hasIpHost && containerKey && Number.isFinite(port)) {
      if (!knownContainerIpPorts.has(containerKey)) knownContainerIpPorts.set(containerKey, new Set());
      knownContainerIpPorts.get(containerKey).add(port);
    }
    if (domainHost) existingDomains.add(domainHost);
    if (urlHost) existingDomains.add(urlHost);

    addExistingDomainPort(domainHost, port);
    addExistingDomainPort(urlHost, port);
  });

  const autoServices = [];
  const rejected = readAutoServiceRejections();
  const rejectedBySourceId = new Set(rejected.map(x => String(x?.sourceId || '')).filter(Boolean));
  const rejectedBySourceKey = new Set(rejected.map(x => String(x?.sourceKey || '')).filter(Boolean));

  for (const ct of (containers || [])) {
    const ip = isIPv4(ct?.ip) ? ct.ip : null;
    const containerId = ct?.id || null;
    const containerName = ct?.name || 'Conteneur';
    const displayName = (ct?.hostname || containerName || 'service').replace(/\.lan$/i, '');

    const hostCandidates = new Set();
    const technitiumHosts = ip ? (dnsIndex?.byIp?.get(ip) || new Set()) : new Set();
    technitiumHosts.forEach((h) => {
      const normalized = normalizeHostname(h);
      if (normalized) hostCandidates.add(normalized);
    });

    const ptrHosts = ip ? await resolvePtrHostnames(ip) : [];
    ptrHosts.forEach((h) => {
      const normalized = normalizeHostname(h);
      if (normalized) hostCandidates.add(normalized);
    });

    const normalizedCtHost = normalizeHostname(ct?.hostname);
    const ctHostKnownInDns = !!(normalizedCtHost && dnsIndex?.byDomain?.get(normalizedCtHost)?.size);
    const ctHostInTechnitiumByIp = !!(normalizedCtHost && technitiumHosts.has(normalizedCtHost));
    const ctHostInPtr = !!(normalizedCtHost && ptrHosts.includes(normalizedCtHost));
    if (normalizedCtHost && (ctHostKnownInDns || ctHostInTechnitiumByIp || ctHostInPtr)) {
      hostCandidates.add(normalizedCtHost);
    }

    const endpoints = ip ? await discoverServiceEndpoints(ip) : [{ port: 80, protocol: 'http', fallback: true }];
    const domainHosts = Array.from(hostCandidates).sort();
    if (!domainHosts.length) {
      continue;
    }

    for (const ep of endpoints) {
      const port = ep.port;
      const protocol = ep.protocol;
      const isDefaultPort = (protocol === 'http' && port === 80) || (protocol === 'https' && port === 443);
      const explicitPortHosts = domainHosts.filter((host) => {
        const set = dnsIndex?.byDomainPorts?.get(host);
        return !!(set && set.has(port));
      });

      let hostsForEndpoint = [];
      if (explicitPortHosts.length) {
        hostsForEndpoint = explicitPortHosts;
      } else {
        const allowedByStatic = domainHosts.filter((host) => {
          const set = existingDomainPorts.get(host);
          return !!(set && set.has(port));
        });

        if (allowedByStatic.length) {
          hostsForEndpoint = allowedByStatic;
        } else if (isDefaultPort) {
          // Port web standard accepté pour découverte automatique.
          hostsForEndpoint = await selectHostsForEndpoint(domainHosts, ip, port, protocol);
        } else {
          // Port non standard sans preuve explicite (SRV/service existant) => ignore pour éviter faux positifs proxy.
          hostsForEndpoint = [];
        }
      }

      for (const domainHost of hostsForEndpoint) {
        const resolvedIp = ip || await resolveHostnameToIPv4(domainHost);
        const ctKey = String(containerName || '').trim().toLowerCase();
        if (existingDomains.has(domainHost)) continue;

        const staticIpPorts = knownContainerIpPorts.get(ctKey);
        if (staticIpPorts && staticIpPorts.has(port)) continue;

        if (resolvedIp && knownIpPorts.has(`${resolvedIp}:${port}`)) continue;

        const domain = `${protocol}://${domainHost}${isDefaultPort ? '' : `:${port}`}`;
        const url = resolvedIp ? `${protocol}://${resolvedIp}${isDefaultPort ? '' : `:${port}`}` : domain;
        const sourceKey = getServiceIdentityKey({ domain, url, protocol, port, ip: resolvedIp || null });

        const hostPortKey = `${domainHost}:${port}`;
        if (knownHostPorts.has(hostPortKey)) continue;

        const hostLabel = domainHost.replace(/\.lan$/i, '');
        const baseName = hostLabel || displayName;
        const id = makeUniqueServiceId(`auto-${slugifyId(domainHost)}-${port}`, usedIds);

        if (rejectedBySourceId.has(id)) continue;
        if (sourceKey && rejectedBySourceKey.has(sourceKey)) continue;

        autoServices.push({
          id,
          name: isDefaultPort ? baseName : `${baseName} :${port}`,
          category: defaultCategory,
          description: `Service détecté automatiquement sur ${containerName}`,
          longDescription: `Service découvert automatiquement via la CT/VM ${containerName} (${ip || 'IP inconnue'}) avec détection port/protocole en direct.`,
          url,
          domain,
          ip: resolvedIp || '—',
          port,
          protocol,
          icon: 'server',
          tags: ['auto', 'proxmox', 'dns', 'live', ...(dnsIndex?.source === 'technitium-api' ? ['technitium'] : [])],
          container: containerName,
          containerId,
          status: 'unknown',
          favorite: false,
          autoDiscovered: true,
          sourceKey,
          autoSource: ep.fallback
            ? (dnsIndex?.source === 'technitium-api' ? 'technitium+fallback' : 'container-fallback')
            : (dnsIndex?.source === 'technitium-api' ? 'technitium+portscan' : 'container-portscan')
        });

        knownHostPorts.add(hostPortKey);
        if (resolvedIp) knownIpPorts.add(`${resolvedIp}:${port}`);
      }
    }
  }

  return autoServices;
}

// Vérification de disponibilité d'un service
function checkService(service) {
  return new Promise((resolve) => {
    const u = safeUrlParse(service.url);
    const isHttps = (u?.protocol || service.protocol || 'http:') === 'https:' || service.protocol === 'https';
    const protocol = isHttps ? https : http;
    const hostname = u?.hostname || service.ip;
    const port = u?.port ? parseInt(u.port, 10) : (service.port || (isHttps ? 443 : 80));
    const pathName = '/';

    const options = {
      hostname,
      port,
      path: pathName,
      method: 'HEAD',
      timeout: 4000,
      rejectUnauthorized: false
    };

    const req = protocol.request(options, (res) => {
      resolve({ id: service.id, status: 'up', code: res.statusCode, ts: Date.now() });
    });

    req.on('error', () => {
      resolve({ id: service.id, status: 'down', ts: Date.now() });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ id: service.id, status: 'down', ts: Date.now() });
    });

    req.end();
  });
}

// ---------- Proxmox API (live) ----------

const PVE_HOST = process.env.PVE_HOST;
const PVE_PORT = parseInt(process.env.PVE_PORT || '8006', 10);
const PVE_TOKEN_ID = process.env.PVE_TOKEN_ID;
const PVE_TOKEN_SECRET = process.env.PVE_TOKEN_SECRET;

const PVE_WATCH_TASKS_ENABLED = String(process.env.PVE_WATCH_TASKS_ENABLED || 'true').toLowerCase() !== 'false';
const PVE_WATCH_SYSLOG_ENABLED = String(process.env.PVE_WATCH_SYSLOG_ENABLED || 'true').toLowerCase() !== 'false';
const PVE_WATCH_INTERVAL_MS = Math.max(5_000, Math.min(120_000, parseInt(process.env.PVE_WATCH_INTERVAL_MS || '20000', 10)));

const TECHNITIUM_BASE_URL = process.env.TECHNITIUM_BASE_URL || 'http://10.0.0.53:5380';
const TECHNITIUM_TOKEN = process.env.TECHNITIUM_TOKEN || '';
const TECHNITIUM_USER = process.env.TECHNITIUM_USER || '';
const TECHNITIUM_PASS = process.env.TECHNITIUM_PASS || '';
const TECHNITIUM_TOTP = process.env.TECHNITIUM_TOTP || '';
const TECHNITIUM_ZONE_SUFFIX = (process.env.TECHNITIUM_ZONE_SUFFIX || '.lan').toLowerCase();

function zoneMatchesSuffix(zoneName, suffix) {
  const z = String(zoneName || '').trim().toLowerCase().replace(/\.$/, '');
  const sRaw = String(suffix || '').trim().toLowerCase().replace(/\.$/, '');
  if (!z || !sRaw) return false;

  const s = sRaw.startsWith('.') ? sRaw.slice(1) : sRaw;
  return z === s || z.endsWith(`.${s}`);
}


function havePveConfig() {
  return !!(PVE_HOST && PVE_TOKEN_ID && PVE_TOKEN_SECRET);
}

function maskSecret(value) {
  const raw = String(value || '');
  if (!raw) return '';
  if (raw.length <= 6) return '*'.repeat(raw.length);
  return `${raw.slice(0, 3)}${'*'.repeat(Math.max(3, raw.length - 6))}${raw.slice(-3)}`;
}

function pveApiRequest(pathname) {
  return new Promise((resolve, reject) => {
    if (!havePveConfig()) {
      return reject(new Error('PVE API non configurée (PVE_HOST/PVE_TOKEN_ID/PVE_TOKEN_SECRET)'));
    }

    const options = {
      hostname: PVE_HOST,
      port: PVE_PORT,
      path: `/api2/json${pathname}`,
      method: 'GET',
      timeout: 6000,
      rejectUnauthorized: false,
      headers: {
        Authorization: `PVEAPIToken=${PVE_TOKEN_ID}=${PVE_TOKEN_SECRET}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.data);
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error(`PVE API HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout PVE API'));
    });

    req.end();
  });
}

function pveApiPostRequest(pathname, formData = null) {
  return new Promise((resolve, reject) => {
    if (!havePveConfig()) {
      return reject(new Error('PVE API non configurée (PVE_HOST/PVE_TOKEN_ID/PVE_TOKEN_SECRET)'));
    }

    const payload = formData && typeof formData === 'object'
      ? new URLSearchParams(Object.entries(formData).map(([k, v]) => [k, String(v)])).toString()
      : '';

    const headers = {
      Authorization: `PVEAPIToken=${PVE_TOKEN_ID}=${PVE_TOKEN_SECRET}`
    };
    if (payload) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const options = {
      hostname: PVE_HOST,
      port: PVE_PORT,
      path: `/api2/json${pathname}`,
      method: 'POST',
      timeout: 10000,
      rejectUnauthorized: false,
      headers
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          if (!data) return resolve(null);
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.data);
          } catch {
            resolve(null);
          }
        } else {
          reject(new Error(`PVE API HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout PVE API'));
    });

    if (payload) req.write(payload);
    req.end();
  });
}

let pveNodeReportCache = { ts: 0, node: null, text: '' };
async function getPveNodeReportText(nodeName) {
  const now = Date.now();
  if (pveNodeReportCache.node === nodeName && (now - pveNodeReportCache.ts) < 5 * 60_000) {
    return pveNodeReportCache.text;
  }
  const report = await pveApiRequest(`/nodes/${nodeName}/report`).catch(() => null);
  let text = typeof report === 'string'
    ? report
    : (typeof report?.report === 'string' ? report.report : '');
  if (text && !text.includes('\n') && text.includes('\\n')) {
    text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  }
  pveNodeReportCache = { ts: now, node: nodeName, text };
  return text;
}

async function getPveNodeOverview() {
  const nodes = await pveApiRequest('/nodes');
  const n = nodes?.[0];
  if (!n) return null;

  const nodeName = n.node;
  const [nodeStatus, storages, disksList, rrdData, storageConfigs] = await Promise.all([
    pveApiRequest(`/nodes/${nodeName}/status`).catch(() => null),
    pveApiRequest(`/nodes/${nodeName}/storage`).catch(() => []),
    pveApiRequest(`/nodes/${nodeName}/disks/list`).catch(() => []),
    pveApiRequest(`/nodes/${nodeName}/rrddata?timeframe=hour&cf=AVERAGE`).catch(() => []),
    pveApiRequest('/storage').catch(() => []),
  ]);

  const normalize = (value) => String(value || '').toLowerCase().trim();
  const storageConfigMap = new Map((Array.isArray(storageConfigs) ? storageConfigs : [])
    .map((cfg) => [String(cfg?.storage || ''), cfg]));

  const memoryUsed = (typeof nodeStatus?.memory?.used === 'number')
    ? nodeStatus.memory.used
    : (typeof n.mem === 'number' ? n.mem : null);
  const memoryTotal = (typeof nodeStatus?.memory?.total === 'number')
    ? nodeStatus.memory.total
    : (typeof n.maxmem === 'number' ? n.maxmem : null);

  const storagePools = (Array.isArray(storages) ? storages : [])
    .filter(s => typeof s?.total === 'number' && Number.isFinite(s.total) && s.total > 0)
    .map(s => {
      const cfg = storageConfigMap.get(String(s.storage || s.id || '')) || {};
      const used = (typeof s.used === 'number' && Number.isFinite(s.used)) ? s.used : null;
      const total = s.total;
      const avail = (typeof s.avail === 'number' && Number.isFinite(s.avail)) ? s.avail : null;
      const usedPct = (used !== null && total > 0) ? +((used / total) * 100).toFixed(1) : null;

      const contentRaw = (typeof s.content === 'string') ? s.content : '';
      const content = contentRaw
        .split(',')
        .map(x => x.trim())
        .filter(Boolean);

      return {
        name: s.storage || s.id || 'storage',
        type: s.type || cfg.type || null,
        used,
        total,
        avail,
        usedPct,
        content,
        shared: (typeof s.shared === 'number') ? s.shared : null,
        active: (typeof s.active === 'number') ? s.active : null,
        enabled: (typeof s.enabled === 'number') ? s.enabled : null,
        path: s.path || cfg.path || null,
        zfsPool: cfg.pool || s.pool || null,
      };
    });

  const storageUsed = storagePools.length
    ? storagePools.reduce((sum, s) => sum + (typeof s.used === 'number' ? s.used : 0), 0)
    : (typeof n.disk === 'number' ? n.disk : null);
  const storageTotal = storagePools.length
    ? storagePools.reduce((sum, s) => sum + (typeof s.total === 'number' ? s.total : 0), 0)
    : (typeof n.maxdisk === 'number' ? n.maxdisk : null);

  const points = Array.isArray(rrdData) ? rrdData : [];
  const latestPoint = points.length ? points[points.length - 1] : null;
  const ioReadBps = (typeof latestPoint?.diskread === 'number' && Number.isFinite(latestPoint.diskread))
    ? latestPoint.diskread
    : null;
  const ioWriteBps = (typeof latestPoint?.diskwrite === 'number' && Number.isFinite(latestPoint.diskwrite))
    ? latestPoint.diskwrite
    : null;

  const physicalDisks = (Array.isArray(disksList) ? disksList : [])
    .map((d) => {
      const smartStatus = String(d?.health || d?.smart_status || d?.smart || '').toLowerCase() || null;
      const powerOnHours = Number.isFinite(d?.power_on_hours) ? d.power_on_hours
        : Number.isFinite(d?.poweronhours) ? d.poweronhours
          : Number.isFinite(d?.hours) ? d.hours
            : null;

      return {
        devPath: d?.devpath || d?.name || d?.by_id_link || null,
        byIdPath: d?.by_id_link || null,
        model: d?.model || null,
        serial: d?.serial || null,
        type: d?.type || d?.rotational || null,
        size: Number.isFinite(d?.size) ? d.size : null,
        smartStatus,
        wearout: Number.isFinite(d?.wearout) ? d.wearout : null,
        powerOnHours,
        temperatureC: Number.isFinite(d?.temperature) ? d.temperature
          : Number.isFinite(d?.temp) ? d.temp
            : null,
      };
    })
    .filter((d) => d.devPath || d.model || d.serial || d.size);

  const leafNamesFromZfsNode = (node) => {
    if (!node || typeof node !== 'object') return [];
    const children = Array.isArray(node.children) ? node.children : [];
    if (!children.length && typeof node.name === 'string') return [node.name];
    const out = [];
    for (const c of children) out.push(...leafNamesFromZfsNode(c));
    return out;
  };

  const matchLeafToDiskKey = (leafRaw) => {
    const leaf = normalize(leafRaw).replace(/-part\d+$/, '');
    if (!leaf) return null;
    for (const d of physicalDisks) {
      const dev = normalize(d.devPath);
      const byId = normalize(d.byIdPath);
      const serial = normalize(d.serial);
      if (byId && leaf.includes(byId.replace(/-part\d+$/, ''))) return d.devPath;
      if (serial && leaf.includes(serial)) return d.devPath;
      if (dev && (leaf.includes(dev) || leaf.endsWith(dev.replace('/dev/', '')))) return d.devPath;
    }
    return null;
  };

  const sizeMatchDiskKey = (poolTotal) => {
    if (typeof poolTotal !== 'number' || !Number.isFinite(poolTotal) || poolTotal <= 0) return null;
    const candidates = physicalDisks
      .filter((d) => typeof d.size === 'number' && Number.isFinite(d.size) && d.size > 0)
      .map((d) => {
        const ratio = Math.abs(poolTotal - d.size) / Math.max(poolTotal, d.size);
        return { key: d.devPath, ratio };
      })
      .sort((a, b) => a.ratio - b.ratio);
    if (!candidates.length) return null;
    const best = candidates[0];
    const second = candidates[1];
    if (best.ratio > 0.12) return null;
    if (second && (second.ratio - best.ratio) < 0.04) return null;
    return best.key || null;
  };

  const zfsRootDiskMap = new Map();
  const zfsRoots = [...new Set(storagePools
    .filter((p) => p?.type === 'zfspool' && typeof p?.zfsPool === 'string' && p.zfsPool)
    .map((p) => String(p.zfsPool).split('/')[0])
    .filter(Boolean))];

  for (const zfsRoot of zfsRoots) {
    const zfsDetail = await pveApiRequest(`/nodes/${nodeName}/disks/zfs/${encodeURIComponent(zfsRoot)}`).catch(() => null);
    const leafNames = leafNamesFromZfsNode(zfsDetail);
    const keys = [...new Set(leafNames.map((leaf) => matchLeafToDiskKey(leaf)).filter(Boolean))];
    zfsRootDiskMap.set(zfsRoot, keys);
  }

  const stripPartitionSuffix = (sourcePath) => {
    const s = normalize(sourcePath);
    if (!s) return s;
    if (s.startsWith('/dev/disk/by-id/')) return s.replace(/-part\d+$/, '');
    if (/^\/dev\/(nvme\d+n\d+)p\d+$/.test(s)) return s.replace(/p\d+$/, '');
    if (/^\/dev\/(mmcblk\d+)p\d+$/.test(s)) return s.replace(/p\d+$/, '');
    return s.replace(/\d+$/, '');
  };

  const sourceToDiskKeys = (sourceRaw) => {
    const source = String(sourceRaw || '').trim();
    if (!source) return [];

    if (source.startsWith('/dev/')) {
      const base = stripPartitionSuffix(source);
      const keys = physicalDisks
        .filter((d) => {
          const dev = normalize(d?.devPath);
          const byId = normalize(d?.byIdPath);
          return dev === base || byId === base;
        })
        .map((d) => d.devPath)
        .filter(Boolean);
      return [...new Set(keys)];
    }

    if (!source.startsWith('/')) {
      const zfsRoot = source.split('/')[0];
      return zfsRootDiskMap.get(zfsRoot) || [];
    }

    return [];
  };

  const extractFindmntMap = (reportText) => {
    const map = new Map();
    if (!reportText || typeof reportText !== 'string') return map;
    const lines = reportText.split(/\r?\n/);
    const start = lines.findIndex((line) => line.includes('# findmnt --ascii'));
    if (start < 0) return map;

    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i] || '';
      if (i > start + 1 && line.startsWith('# ')) break;
      if (line.includes('TARGET') && line.includes('SOURCE')) continue;

      const cleaned = line.replace(/^[\s|`\\-]+/, '').trim();
      if (!cleaned.startsWith('/')) continue;

      const cols = cleaned.split(/\s{2,}/).map((x) => x.trim()).filter(Boolean);
      if (cols.length < 2) continue;

      const target = cols[0];
      const source = cols[1];
      if (target && source) map.set(target, source);
    }
    return map;
  };

  const reportText = await getPveNodeReportText(nodeName).catch(() => '');
  const mountSourceByPath = extractFindmntMap(reportText);

  for (const pool of storagePools) {
    const mappedDiskKeys = new Set();
    let mappingMethod = 'none';

    if (pool?.type === 'zfspool' && typeof pool.zfsPool === 'string' && pool.zfsPool) {
      const zfsRoot = String(pool.zfsPool).split('/')[0];
      if (zfsRoot) {
        const keys = zfsRootDiskMap.get(zfsRoot) || [];
        for (const key of keys) mappedDiskKeys.add(key);
        if (mappedDiskKeys.size) mappingMethod = 'zfs';
      }
    }

    if (!mappedDiskKeys.size && pool?.type === 'dir' && typeof pool?.path === 'string' && pool.path) {
      const source = mountSourceByPath.get(pool.path);
      const keys = sourceToDiskKeys(source);
      for (const key of keys) mappedDiskKeys.add(key);
      if (mappedDiskKeys.size) {
        mappingMethod = source && source.startsWith('/dev/') ? 'findmnt-dev' : 'findmnt-zfs';
      }
    }

    if (!mappedDiskKeys.size && pool?.type === 'dir' && typeof pool?.path === 'string' && pool.path === '/var/lib/vz') {
      const zfsKeys = zfsRootDiskMap.get('rpool') || [];
      for (const key of zfsKeys) mappedDiskKeys.add(key);
      if (mappedDiskKeys.size) mappingMethod = 'zfs-host-root';
    }

    if (!mappedDiskKeys.size && pool?.type === 'dir') {
      const key = sizeMatchDiskKey(pool.total);
      if (key) {
        mappedDiskKeys.add(key);
        mappingMethod = 'size';
      }
    }

    pool.mappedDiskKeys = [...mappedDiskKeys];
    pool.mappingMethod = mappingMethod;
  }

  return {
    node: nodeName,
    cpuPercent: typeof n.cpu === 'number' ? +(n.cpu * 100).toFixed(1) : null,
    memUsed: memoryUsed,
    memTotal: memoryTotal,
    diskUsed: storageUsed,
    diskTotal: storageTotal,
    storagePools,
    ioReadBps,
    ioWriteBps,
    physicalDisks,
    uptime: typeof n.uptime === 'number' ? n.uptime : null
  };
}

function promBaseFromConfig() {
  try {
    const base = readJson(SERVICES_FILE);
    const p = (base.services || []).find(s => s.id === 'prometheus');
    const u = safeUrlParse(p?.url);
    if (!u) return null;
    return { hostname: u.hostname, port: parseInt(u.port || '9090', 10) };
  } catch {
    return null;
  }
}

function promInstantQuery(hostname, port, query) {
  return new Promise((resolve, reject) => {
    const path = `/api/v1/query?query=${encodeURIComponent(query)}`;
    const req = http.request({ hostname, port, path, method: 'GET', timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.status !== 'success') return resolve(null);
          const r = parsed.data?.result;
          if (!Array.isArray(r) || !r[0]?.value?.[1]) return resolve(null);
          resolve(Number(r[0].value[1]));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

function promInstantVectorQuery(hostname, port, query) {
  return new Promise((resolve) => {
    const path = `/api/v1/query?query=${encodeURIComponent(query)}`;
    const req = http.request({ hostname, port, path, method: 'GET', timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.status !== 'success') return resolve([]);
          const r = parsed.data?.result;
          if (!Array.isArray(r) || !r.length) return resolve([]);

          const rows = r
            .map((row) => {
              const v = Number(row?.value?.[1]);
              return {
                metric: row?.metric || {},
                value: Number.isFinite(v) ? v : null,
              };
            })
            .filter((row) => typeof row.value === 'number' && Number.isFinite(row.value));

          resolve(rows);
        } catch {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.end();
  });
}

async function promFirstNumber(hostname, port, queries) {
  for (const q of (queries || [])) {
    const v = await promInstantQuery(hostname, port, q);
    if (typeof v === 'number' && Number.isFinite(v)) return { value: v, query: q };
  }
  return { value: null, query: null };
}

async function promFirstVector(hostname, port, queries) {
  for (const q of (queries || [])) {
    const rows = await promInstantVectorQuery(hostname, port, q);
    if (Array.isArray(rows) && rows.length) return { rows, query: q };
  }
  return { rows: [], query: null };
}

let overviewCache = { ts: 0, data: null };
async function getOverview() {
  const now = Date.now();
  if (overviewCache.data && (now - overviewCache.ts) < 10_000) return overviewCache.data;

  const proxmox = havePveConfig() ? await getPveNodeOverview() : null;
  let guestsMemUsed = null;
  let guestsMemTotal = null;

  if (havePveConfig()) {
    try {
      const liveContainers = await getLiveContainers();
      let usedSum = 0;
      let totalSum = 0;
      for (const c of (liveContainers || [])) {
        const used = c?.resources?.memUsedBytes;
        const total = c?.resources?.memTotalBytes;
        if (typeof used === 'number' && Number.isFinite(used)) usedSum += used;
        if (typeof total === 'number' && Number.isFinite(total)) totalSum += total;
      }
      guestsMemUsed = usedSum > 0 ? usedSum : null;
      guestsMemTotal = totalSum > 0 ? totalSum : null;
    } catch {
      // ignore
    }
  }

  if (proxmox) {
    proxmox.guestsMemUsed = guestsMemUsed;
    proxmox.guestsMemTotal = guestsMemTotal;
  }

  const prom = promBaseFromConfig();
  // Enrichissement Prometheus best-effort pour disque (sans casser l'existant)
  if (prom?.hostname && proxmox) {
    try {
      // I/O par disque (best effort) depuis pve-exporter
      const diskReadVectorCandidates = [
        'pve_disk_read_bytes',
        'rate(pve_disk_read_bytes_total[5m])',
      ];
      const diskWriteVectorCandidates = [
        'pve_disk_write_bytes',
        'rate(pve_disk_written_bytes_total[5m])',
      ];

      const [readVecRes, writeVecRes] = await Promise.all([
        promFirstVector(prom.hostname, prom.port, diskReadVectorCandidates),
        promFirstVector(prom.hostname, prom.port, diskWriteVectorCandidates),
      ]);

      const perDiskMap = new Map();
      const readRows = Array.isArray(readVecRes.rows) ? readVecRes.rows : [];
      const writeRows = Array.isArray(writeVecRes.rows) ? writeVecRes.rows : [];

      const pickDiskKey = (metric = {}) => {
        return metric.disk || metric.device || metric.dev || metric.name || metric.id || metric.instance || null;
      };

      for (const row of readRows) {
        const key = pickDiskKey(row.metric);
        if (!key) continue;
        const current = perDiskMap.get(key) || { disk: String(key), readBps: null, writeBps: null };
        current.readBps = row.value;
        perDiskMap.set(key, current);
      }
      for (const row of writeRows) {
        const key = pickDiskKey(row.metric);
        if (!key) continue;
        const current = perDiskMap.get(key) || { disk: String(key), readBps: null, writeBps: null };
        current.writeBps = row.value;
        perDiskMap.set(key, current);
      }

      const ioPerDisk = [...perDiskMap.values()]
        .map((x) => ({
          disk: x.disk,
          readBps: Number.isFinite(x.readBps) ? x.readBps : null,
          writeBps: Number.isFinite(x.writeBps) ? x.writeBps : null,
        }))
        .filter((x) => typeof x.readBps === 'number' || typeof x.writeBps === 'number')
        .sort((a, b) => {
          const at = (a.readBps || 0) + (a.writeBps || 0);
          const bt = (b.readBps || 0) + (b.writeBps || 0);
          return bt - at;
        });

      if (ioPerDisk.length) {
        proxmox.ioPerDisk = ioPerDisk;
        proxmox.ioPerDiskSource = 'prometheus';
      }

      const normalizeDiskKey = (value) => {
        if (typeof value !== 'string' || !value) return null;
        const clean = value.trim().toLowerCase();
        if (!clean) return null;
        const noPrefix = clean.replace(/^\/dev\//, '');
        const token = noPrefix.split(/[\s/:]+/).filter(Boolean).pop();
        return token || noPrefix;
      };

      const pickMetricDisk = (metric = {}) => {
        return metric.device || metric.disk || metric.dev || metric.name || metric.id || null;
      };

      const [smartStatusRes, smartTempRes, smartHoursDetailRes] = await Promise.all([
        promFirstVector(prom.hostname, prom.port, ['smartctl_device_smart_status']),
        promFirstVector(prom.hostname, prom.port, [
          'smartctl_device_temperature{temperature_type="current"}',
          'smartctl_device_temperature',
        ]),
        promFirstVector(prom.hostname, prom.port, [
          'smartctl_device_power_on_seconds / 3600',
          'smartctl_device_power_on_hours',
          'smartmon_power_on_hours',
        ]),
      ]);

      const smartByDisk = new Map();
      const upsertSmart = (diskRaw, updater) => {
        const key = normalizeDiskKey(String(diskRaw || ''));
        if (!key) return;
        const current = smartByDisk.get(key) || {
          key,
          smartStatus: null,
          powerOnHours: null,
          temperatureC: null,
        };
        updater(current);
        smartByDisk.set(key, current);
      };

      for (const row of (smartStatusRes.rows || [])) {
        const disk = pickMetricDisk(row.metric);
        upsertSmart(disk, (cur) => {
          if (typeof row.value !== 'number' || !Number.isFinite(row.value)) return;
          cur.smartStatus = row.value >= 1 ? 'passed' : 'failed';
        });
      }
      for (const row of (smartTempRes.rows || [])) {
        const disk = pickMetricDisk(row.metric);
        upsertSmart(disk, (cur) => {
          if (typeof row.value !== 'number' || !Number.isFinite(row.value)) return;
          cur.temperatureC = row.value;
        });
      }
      for (const row of (smartHoursDetailRes.rows || [])) {
        const disk = pickMetricDisk(row.metric);
        upsertSmart(disk, (cur) => {
          if (typeof row.value !== 'number' || !Number.isFinite(row.value)) return;
          cur.powerOnHours = row.value;
        });
      }

      if (!Array.isArray(proxmox.physicalDisks)) proxmox.physicalDisks = [];

      const existingKeyToIndex = new Map();
      proxmox.physicalDisks.forEach((d, idx) => {
        const key = normalizeDiskKey(d?.devPath || d?.serial || d?.model || '');
        if (key && !existingKeyToIndex.has(key)) existingKeyToIndex.set(key, idx);
      });

      for (const item of smartByDisk.values()) {
        const idx = existingKeyToIndex.get(item.key);
        if (typeof idx === 'number') {
          const disk = proxmox.physicalDisks[idx] || {};
          if (!disk.smartStatus && item.smartStatus) disk.smartStatus = item.smartStatus;
          if (!Number.isFinite(disk.powerOnHours) && Number.isFinite(item.powerOnHours)) disk.powerOnHours = item.powerOnHours;
          if (!Number.isFinite(disk.temperatureC) && Number.isFinite(item.temperatureC)) disk.temperatureC = item.temperatureC;
          proxmox.physicalDisks[idx] = disk;
        } else {
          proxmox.physicalDisks.push({
            devPath: `/dev/${item.key}`,
            model: null,
            serial: null,
            type: null,
            size: null,
            smartStatus: item.smartStatus,
            wearout: null,
            powerOnHours: Number.isFinite(item.powerOnHours) ? item.powerOnHours : null,
            temperatureC: Number.isFinite(item.temperatureC) ? item.temperatureC : null,
          });
        }
      }

      // Fallback I/O hôte si absent côté Proxmox API
      if (typeof proxmox.ioReadBps !== 'number' || typeof proxmox.ioWriteBps !== 'number') {
        const readCandidates = [
          'sum(pve_disk_read_bytes)',
          'sum(rate(pve_disk_read_bytes_total[5m]))',
          'sum(rate(node_disk_read_bytes_total{device!~"loop.*|ram.*|fd.*|dm-.*"}[5m]))',
          'sum(irate(node_disk_read_bytes_total{device!~"loop.*|ram.*|fd.*|dm-.*"}[5m]))',
        ];
        const writeCandidates = [
          'sum(pve_disk_write_bytes)',
          'sum(rate(pve_disk_written_bytes_total[5m]))',
          'sum(rate(node_disk_written_bytes_total{device!~"loop.*|ram.*|fd.*|dm-.*"}[5m]))',
          'sum(irate(node_disk_written_bytes_total{device!~"loop.*|ram.*|fd.*|dm-.*"}[5m]))',
        ];

        const [readRes, writeRes] = await Promise.all([
          promFirstNumber(prom.hostname, prom.port, readCandidates),
          promFirstNumber(prom.hostname, prom.port, writeCandidates),
        ]);

        if (typeof proxmox.ioReadBps !== 'number' && typeof readRes.value === 'number') {
          proxmox.ioReadBps = readRes.value;
          proxmox.ioReadSource = 'prometheus';
        }
        if (typeof proxmox.ioWriteBps !== 'number' && typeof writeRes.value === 'number') {
          proxmox.ioWriteBps = writeRes.value;
          proxmox.ioWriteSource = 'prometheus';
        }
      }

      // Résumé heures SMART depuis Prometheus (fallback maintenance)
      const smartHoursCandidates = [
        'smartctl_device_power_on_seconds / 3600',
        'smartctl_device_power_on_hours',
        'smartmon_power_on_hours',
      ];
      const smartRowsRes = await promFirstVector(prom.hostname, prom.port, smartHoursCandidates);
      const smartValues = (smartRowsRes.rows || []).map(r => r.value).filter(v => typeof v === 'number' && Number.isFinite(v));

      if (smartValues.length) {
        const min = Math.min(...smartValues);
        const max = Math.max(...smartValues);
        const avg = smartValues.reduce((sum, v) => sum + v, 0) / smartValues.length;
        proxmox.smartPowerOnHoursSummary = {
          min,
          avg,
          max,
          count: smartValues.length,
          source: 'prometheus',
          query: smartRowsRes.query,
        };
      }
    } catch {
      // no-op
    }
  }

  // VRAM best-effort via Prometheus (si dispo)
  let vram = null;
  if (prom?.hostname) {
    const instance = '10.0.0.20:9400';
    const used = await promInstantQuery(prom.hostname, prom.port, `DCGM_FI_DEV_FB_USED{instance="${instance}"}`);
    let total = await promInstantQuery(prom.hostname, prom.port, `DCGM_FI_DEV_FB_TOTAL{instance="${instance}"}`);
    const free = await promInstantQuery(prom.hostname, prom.port, `DCGM_FI_DEV_FB_FREE{instance="${instance}"}`);

    // Certains exporters n'exposent pas TOTAL, mais exposent FREE.
    if (typeof total !== 'number' && typeof used === 'number' && typeof free === 'number') {
      total = used + free;
    }

    // Fallback: sans filtre d'instance (si label différent)
    let usedAny = used;
    let totalAny = total;
    if (typeof usedAny !== 'number') usedAny = await promInstantQuery(prom.hostname, prom.port, 'DCGM_FI_DEV_FB_USED');
    if (typeof totalAny !== 'number') {
      const totalMetric = await promInstantQuery(prom.hostname, prom.port, 'DCGM_FI_DEV_FB_TOTAL');
      const freeMetric = await promInstantQuery(prom.hostname, prom.port, 'DCGM_FI_DEV_FB_FREE');
      if (typeof totalMetric === 'number') totalAny = totalMetric;
      else if (typeof usedAny === 'number' && typeof freeMetric === 'number') totalAny = usedAny + freeMetric;
    }

    if (typeof usedAny === 'number' && typeof totalAny === 'number') {
      vram = { usedMB: usedAny, totalMB: totalAny, source: 'prometheus:dcgm' };
    }
  }

  const data = {
    ts: now,
    proxmox,
    vram
  };
  overviewCache = { ts: now, data };
  return data;
}

let pveNodeCache = { ts: 0, node: null };
async function getPveNodeName() {
  const now = Date.now();
  if (pveNodeCache.node && (now - pveNodeCache.ts) < 60_000) return pveNodeCache.node;
  const nodes = await pveApiRequest('/nodes');
  const node = nodes?.[0]?.node;
  pveNodeCache = { ts: now, node };
  return node;
}

function bytesToHuman(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '—';
  const gib = 1024 * 1024 * 1024;
  const mib = 1024 * 1024;
  if (bytes >= gib) return `${(bytes / gib).toFixed(1)} GB`;
  return `${Math.round(bytes / mib)} MB`;
}

function pickIPv4FromInterfaces(interfaces) {
  if (!Array.isArray(interfaces)) return null;
  const eth0 = interfaces.find(i => i?.name === 'eth0') || interfaces.find(i => i?.name?.startsWith('eth'));
  const inet = eth0?.['ip-addresses']?.find(x => x?.['ip-address-type'] === 'inet');
  return inet?.['ip-address'] || eth0?.inet?.split('/')[0] || null;
}

function pickIPv4FromLxcConfig(config = {}) {
  const netKeys = Object.keys(config || {}).filter(k => /^net\d+$/i.test(k));
  for (const key of netKeys) {
    const netCfg = String(config[key] || '');
    if (!netCfg) continue;

    const ipMatch = netCfg.match(/(?:^|,)ip=([^,]+)/i);
    if (!ipMatch?.[1]) continue;

    const raw = String(ipMatch[1]).trim();
    if (!raw || raw.toLowerCase() === 'dhcp' || raw.toLowerCase() === 'auto') continue;

    const ip = raw.split('/')[0].trim();
    if (isIPv4(ip)) return ip;
  }
  return null;
}

function isUsableIPv4(ip) {
  if (!isIPv4(ip)) return false;
  if (ip.startsWith('127.')) return false;
  if (ip.startsWith('169.254.')) return false;
  return true;
}

function pickIPv4FromQemuAgent(agentPayload) {
  const list = Array.isArray(agentPayload?.result)
    ? agentPayload.result
    : (Array.isArray(agentPayload) ? agentPayload : []);

  for (const iface of list) {
    const addrs = iface?.['ip-addresses'];
    if (!Array.isArray(addrs)) continue;
    for (const addr of addrs) {
      if (String(addr?.['ip-address-type'] || '').toLowerCase() !== 'ipv4') continue;
      const ip = String(addr?.['ip-address'] || '').trim();
      if (isUsableIPv4(ip)) return ip;
    }
  }

  return null;
}

function getEffectiveGuestStatus(baseStatus, lockValue, qmpStatus = null) {
  const base = String(baseStatus || 'unknown').toLowerCase();
  const lock = String(lockValue || '').toLowerCase();
  const qmp = String(qmpStatus || '').toLowerCase();

  if (lock.includes('backup')) return 'backup';
  if (lock.includes('snapshot')) return 'backup';
  if (qmp === 'prelaunch') return 'prelaunch';
  if (qmp === 'paused') return 'paused';
  if (base === 'prelaunch') return 'prelaunch';
  if (base === 'paused') return 'paused';

  return base || 'unknown';
}

let neighCache = { ts: 0, map: null };
async function getNeighborMap() {
  const now = Date.now();
  if (neighCache.map && (now - neighCache.ts) < 10_000) return neighCache.map;

  let stdout = '';
  try {
    const res = await execFileAsync('ip', ['-4', 'neigh', 'show'], { timeout: 3000, maxBuffer: 1024 * 1024 });
    stdout = res.stdout || '';
  } catch {
    stdout = '';
  }

  // Example line: "10.0.0.20 dev eth0 lladdr aa:bb:cc:dd:ee:ff REACHABLE"
  const map = new Map();
  stdout.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
    const parts = line.split(/\s+/);
    const ip = parts[0];
    const lladdrIdx = parts.indexOf('lladdr');
    if (isIPv4(ip) && lladdrIdx !== -1 && parts[lladdrIdx + 1]) {
      map.set(parts[lladdrIdx + 1].toLowerCase(), ip);
    }
  });

  neighCache = { ts: now, map };
  return map;
}

let liveContainersCache = { ts: 0, data: null };
async function getLiveContainers(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && liveContainersCache.data && (now - liveContainersCache.ts) < 15_000) return liveContainersCache.data;

  const node = await getPveNodeName();
  if (!node) return [];

  const lxcs = await pveApiRequest(`/nodes/${node}/lxc`);
  const qemus = await pveApiRequest(`/nodes/${node}/qemu`).catch(() => []);

  const lxcItems = await Promise.all((lxcs || []).map(async (ct) => {
    const vmid = ct.vmid;
    const config = await pveApiRequest(`/nodes/${node}/lxc/${vmid}/config`).catch(() => ({}));
    const interfaces = await pveApiRequest(`/nodes/${node}/lxc/${vmid}/interfaces`).catch(() => null);
    const current = await pveApiRequest(`/nodes/${node}/lxc/${vmid}/status/current`).catch(() => null);
    const ip = pickIPv4FromInterfaces(interfaces) || pickIPv4FromLxcConfig(config);

    const maxMemBytes = typeof current?.maxmem === 'number'
      ? current.maxmem
      : (typeof ct.maxmem === 'number' ? ct.maxmem : (typeof config.memory === 'number' ? config.memory * 1024 * 1024 : NaN));
    const memBytes = typeof current?.mem === 'number' ? current.mem : ct.mem;
    const maxDiskBytes = typeof current?.maxdisk === 'number' ? current.maxdisk : ct.maxdisk;
    const diskBytes = typeof current?.disk === 'number' ? current.disk : ct.disk;

    const effectiveStatus = getEffectiveGuestStatus(
      current?.status || ct.status || 'unknown',
      config?.lock || current?.lock || ct?.lock,
      current?.qmpstatus || ct?.qmpstatus || null
    );

    const resources = {
      status: effectiveStatus,
      cpu: typeof ct.cpu === 'number' ? `${(ct.cpu * 100).toFixed(1)}%` : '—',
      cpus: ct.cpus || config.cores || '—',
      ram: bytesToHuman(maxMemBytes),
      memUsed: bytesToHuman(memBytes),
      memTotalBytes: Number.isFinite(maxMemBytes) ? maxMemBytes : null,
      memUsedBytes: Number.isFinite(memBytes) ? memBytes : null,
      swap: bytesToHuman(ct.maxswap),
      disk: bytesToHuman(maxDiskBytes),
      diskUsed: bytesToHuman(diskBytes),
      diskTotalBytes: Number.isFinite(maxDiskBytes) ? maxDiskBytes : null,
      diskUsedBytes: Number.isFinite(diskBytes) ? diskBytes : null,
      uptime: typeof (current?.uptime ?? ct.uptime) === 'number' ? `${Math.floor((current?.uptime ?? ct.uptime) / 3600)}h` : '—',
      tags: config.tags || ct.tags || '—',
      lock: config?.lock || current?.lock || ct?.lock || null,
    };

    return {
      id: `ct${vmid}`,
      vmid,
      type: 'lxc',
      name: `CT ${vmid}`,
      hostname: config.hostname || ct.name || `ct-${vmid}`,
      ip: ip || '—',
      os: config.ostype || '—',
      description: ct.name || config.hostname || '',
      color: '#64748b',
      services: [],
      resources
    };
  }));

  const neigh = await getNeighborMap();
  const vmItems = await Promise.all((qemus || []).map(async (vm) => {
    const vmid = vm.vmid;
    const config = await pveApiRequest(`/nodes/${node}/qemu/${vmid}/config`).catch(() => ({}));
    const current = await pveApiRequest(`/nodes/${node}/qemu/${vmid}/status/current`).catch(() => null);

    // Extraire MAC depuis net0/net1...
    const netKeys = Object.keys(config).filter(k => /^net\d+$/.test(k));
    let mac = null;
    for (const k of netKeys) {
      const v = String(config[k] || '');
      const m = v.match(/(?:virtio|e1000|rtl8139|vmxnet3)=([0-9A-Fa-f:]{17})/);
      if (m?.[1]) { mac = m[1].toLowerCase(); break; }
    }

    let agentIp = null;
    const vmIsRunning = String(current?.status || vm.status || '').toLowerCase() === 'running';
    if (vmIsRunning) {
      const agent = await pveApiRequest(`/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`).catch(() => null);
      agentIp = pickIPv4FromQemuAgent(agent);
    }

    const arpIp = (vmIsRunning && mac) ? (neigh.get(mac) || null) : null;
    const ip = agentIp || arpIp || null;

    const effectiveStatus = getEffectiveGuestStatus(
      current?.status || vm.status || 'unknown',
      config?.lock || current?.lock || vm?.lock,
      current?.qmpstatus || vm?.qmpstatus || null
    );

    const resources = {
      status: effectiveStatus,
      cpu: typeof vm.cpu === 'number' ? `${(vm.cpu * 100).toFixed(1)}%` : '—',
      cpus: vm.cpus || config.cores || '—',
      ram: bytesToHuman(typeof current?.maxmem === 'number' ? current.maxmem : vm.maxmem),
      memUsed: bytesToHuman(typeof current?.mem === 'number' ? current.mem : vm.mem),
      memTotalBytes: Number.isFinite(typeof current?.maxmem === 'number' ? current.maxmem : vm.maxmem)
        ? (typeof current?.maxmem === 'number' ? current.maxmem : vm.maxmem)
        : null,
      memUsedBytes: Number.isFinite(typeof current?.mem === 'number' ? current.mem : vm.mem)
        ? (typeof current?.mem === 'number' ? current.mem : vm.mem)
        : null,
      disk: bytesToHuman(typeof current?.maxdisk === 'number' ? current.maxdisk : vm.maxdisk),
      diskUsed: bytesToHuman(typeof current?.disk === 'number' ? current.disk : vm.disk),
      diskTotalBytes: Number.isFinite(typeof current?.maxdisk === 'number' ? current.maxdisk : vm.maxdisk)
        ? (typeof current?.maxdisk === 'number' ? current.maxdisk : vm.maxdisk)
        : null,
      diskUsedBytes: Number.isFinite(typeof current?.disk === 'number' ? current.disk : vm.disk)
        ? (typeof current?.disk === 'number' ? current.disk : vm.disk)
        : null,
      uptime: typeof (current?.uptime ?? vm.uptime) === 'number' ? `${Math.floor((current?.uptime ?? vm.uptime) / 3600)}h` : '—',
      tags: config.tags || vm.tags || '—',
      mac: mac || '—',
      lock: config?.lock || current?.lock || vm?.lock || null,
    };

    return {
      id: `vm${vmid}`,
      vmid,
      type: 'qemu',
      name: `VM ${vmid}`,
      hostname: vm.name || config.name || `vm-${vmid}`,
      ip: ip || '—',
      os: config.ostype || '—',
      description: vm.name || '',
      color: '#8b5cf6',
      services: [],
      resources
    };
  }));

  const containers = [...lxcItems, ...vmItems];

  liveContainersCache = { ts: now, data: containers };
  return containers;
}

let mergedCache = { ts: 0, data: null };
let technitiumDnsCache = { ts: 0, data: { byIp: new Map(), byDomain: new Map(), byDomainPorts: new Map(), source: 'none' } };

function haveTechnitiumConfig() {
  return Boolean(TECHNITIUM_BASE_URL && (TECHNITIUM_TOKEN || (TECHNITIUM_USER && TECHNITIUM_PASS)));
}

let technitiumSessionCache = { token: null, ts: 0 };

function technitiumRequestRaw(pathname, query = {}) {
  const url = new URL(pathname, TECHNITIUM_BASE_URL);
  const params = new URLSearchParams(query);
  url.search = params.toString();

  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;
    const req = mod.request({
      hostname: url.hostname,
      port: url.port ? parseInt(url.port, 10) : (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      timeout: 5000,
      rejectUnauthorized: false
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (json?.status && json.status !== 'ok') {
            return reject(new Error(`Technitium API status=${json.status}`));
          }
          resolve(json);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Technitium API timeout')); });
    req.end();
  });
}

async function getTechnitiumAuthToken() {
  if (TECHNITIUM_TOKEN) return TECHNITIUM_TOKEN;
  if (!(TECHNITIUM_USER && TECHNITIUM_PASS)) return null;

  const now = Date.now();
  if (technitiumSessionCache.token && (now - technitiumSessionCache.ts) < 20 * 60 * 1000) {
    return technitiumSessionCache.token;
  }

  const login = await technitiumRequestRaw('/api/user/login', {
    user: TECHNITIUM_USER,
    pass: TECHNITIUM_PASS,
    ...(TECHNITIUM_TOTP ? { totp: TECHNITIUM_TOTP } : {}),
    includeInfo: 'false'
  });

  const token = login?.token || login?.response?.token || null;
  if (!token) return null;

  technitiumSessionCache = { token, ts: now };
  return token;
}

async function technitiumApiGet(pathname, query = {}) {
  const token = await getTechnitiumAuthToken();
  if (!token) throw new Error('Technitium auth indisponible (token ou user/pass requis)');
  return technitiumRequestRaw(pathname, { token, ...query });
}

function toFqdnFromTechnitiumName(name, zone) {
  const n = String(name || '').trim().replace(/\.$/, '').toLowerCase();
  const z = String(zone || '').trim().replace(/\.$/, '').toLowerCase();
  if (!n) return null;
  if (n === '@') return normalizeHostname(z);
  if (n.endsWith(`.${z}`)) return normalizeHostname(n);
  return normalizeHostname(`${n}.${z}`);
}

function parseTechnitiumARecords(records, zone, byIp, byDomain) {
  (records || []).forEach((rec) => {
    if (!rec || rec.disabled) return;
    if (String(rec.type || '').toUpperCase() !== 'A') return;

    const domain = toFqdnFromTechnitiumName(rec.name, zone);
    const ip = rec?.rData?.ipAddress;
    if (!domain || !isIPv4(ip)) return;

    if (!byIp.has(ip)) byIp.set(ip, new Set());
    byIp.get(ip).add(domain);

    if (!byDomain.has(domain)) byDomain.set(domain, new Set());
    byDomain.get(domain).add(ip);
  });
}

function addDomainPortMapping(byDomainPorts, domain, port) {
  if (!domain || !Number.isFinite(port) || port <= 0 || port > 65535) return;
  if (!byDomainPorts.has(domain)) byDomainPorts.set(domain, new Set());
  byDomainPorts.get(domain).add(port);
}

function normalizeSrvOwnerToHost(owner) {
  const host = normalizeHostname(owner);
  if (!host) return null;
  const m = host.match(/^_[^.]+\._(?:tcp|udp)\.(.+)$/i);
  return normalizeHostname(m?.[1] || host);
}

function parseTechnitiumSrvRecords(records, zone, byDomainPorts) {
  (records || []).forEach((rec) => {
    if (!rec || rec.disabled) return;
    if (String(rec.type || '').toUpperCase() !== 'SRV') return;

    const owner = normalizeSrvOwnerToHost(toFqdnFromTechnitiumName(rec.name, zone));
    const target = normalizeHostname(rec?.rData?.target);
    const port = Number(rec?.rData?.port);

    if (owner) addDomainPortMapping(byDomainPorts, owner, port);
    if (target) addDomainPortMapping(byDomainPorts, target, port);
  });
}

function applyTechnitiumCnames(records, zone, byIp, byDomain) {
  const cnames = [];
  (records || []).forEach((rec) => {
    if (!rec || rec.disabled) return;
    if (String(rec.type || '').toUpperCase() !== 'CNAME') return;

    const alias = toFqdnFromTechnitiumName(rec.name, zone);
    const target = normalizeHostname(rec?.rData?.cname);
    if (!alias || !target) return;
    cnames.push({ alias, target });
  });

  // Résolution itérative simple alias -> cible -> IP
  for (let i = 0; i < 5; i += 1) {
    let changed = false;
    for (const item of cnames) {
      const ips = byDomain.get(item.target);
      if (!ips || !ips.size) continue;

      if (!byDomain.has(item.alias)) byDomain.set(item.alias, new Set());
      const aliasIps = byDomain.get(item.alias);

      ips.forEach((ip) => {
        if (!aliasIps.has(ip)) {
          aliasIps.add(ip);
          changed = true;
        }
        if (!byIp.has(ip)) byIp.set(ip, new Set());
        if (!byIp.get(ip).has(item.alias)) {
          byIp.get(ip).add(item.alias);
          changed = true;
        }
      });
    }
    if (!changed) break;
  }
}

async function getTechnitiumDnsIndex() {
  const now = Date.now();
  if (technitiumDnsCache.data && (now - technitiumDnsCache.ts) < 30_000) return technitiumDnsCache.data;

  if (!haveTechnitiumConfig()) {
    const none = { byIp: new Map(), byDomain: new Map(), byDomainPorts: new Map(), source: 'disabled' };
    technitiumDnsCache = { ts: now, data: none };
    return none;
  }

  try {
    const zonesRes = await technitiumApiGet('/api/zones/list');
    const zones = zonesRes?.response?.zones || [];
    const wantedZones = zones
      .map(z => z?.name)
      .filter(Boolean)
      .map(z => String(z).toLowerCase())
      .filter(z => zoneMatchesSuffix(z, TECHNITIUM_ZONE_SUFFIX));

    const byIp = new Map();
    const byDomain = new Map();
    const byDomainPorts = new Map();

    for (const zone of wantedZones) {
      const recRes = await technitiumApiGet('/api/zones/records/get', {
        zone,
        domain: zone,
        listZone: 'true'
      });
      const records = recRes?.response?.records || [];
      parseTechnitiumARecords(records, zone, byIp, byDomain);
      applyTechnitiumCnames(records, zone, byIp, byDomain);
      parseTechnitiumSrvRecords(records, zone, byDomainPorts);
    }

    const data = { byIp, byDomain, byDomainPorts, source: 'technitium-api', zones: wantedZones.length };
    technitiumDnsCache = { ts: now, data };
    return data;
  } catch {
    const fallback = { byIp: new Map(), byDomain: new Map(), byDomainPorts: new Map(), source: 'error' };
    technitiumDnsCache = { ts: now, data: fallback };
    return fallback;
  }
}

async function getMergedData(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && mergedCache.data && (now - mergedCache.ts) < 10_000) return mergedCache.data;

  const base = readJson(SERVICES_FILE);
  const containers = havePveConfig() ? await getLiveContainers(forceRefresh) : (base.containers || []);

  // Couleurs par CT depuis config existante (si présentes)
  const staticColors = new Map((base.containers || []).map(c => [c.id, c.color]));
  containers.forEach(c => { c.color = staticColors.get(c.id) || c.color || '#64748b'; });

  // Services: IP/port/protocol live depuis URL + mapping conteneur live par IP
  const services = await Promise.all((base.services || []).map(async (s) => {
    const u = safeUrlParse(s.url);
    const hostname = u?.hostname || null;
    const ip = hostname ? await resolveHostnameToIPv4(hostname) : (s.ip || null);
    const protocol = (u?.protocol || (s.protocol ? `${s.protocol}:` : 'http:')).replace(':', '');
    const port = u?.port ? parseInt(u.port, 10) : (s.port || (protocol === 'https' ? 443 : 80));

    const ct = ip ? containers.find(c => c.ip === ip) : null;

    return {
      ...s,
      protocol,
      port,
      ip: ip || s.ip || '—',
      container: ct ? ct.name : (s.container || '—'),
      containerId: ct ? ct.id : null
    };
  }));

  const dnsIndex = await getTechnitiumDnsIndex();
  const autoServices = await buildAutoDiscoveredServices(containers, services, base.categories || [], dnsIndex);
  const mergedServices = [...services, ...autoServices];

  // Remplir services[] dans chaque conteneur en live
  const byContainer = new Map(containers.map(c => [c.id, []]));
  mergedServices.forEach(s => {
    if (s.containerId && byContainer.has(s.containerId)) byContainer.get(s.containerId).push(s.id);
  });
  containers.forEach(c => { c.services = byContainer.get(c.id) || []; });

  const merged = {
    ...base,
    services: mergedServices,
    containers
  };

  mergedCache = { ts: now, data: merged };
  return merged;
}

// ---------- Auto journal (infra) ----------
let lastInfraSnapshot = null;
let infraWatcherStarted = false;
let pveTasksWatcherStarted = false;
let pveTasksWatcherPrimed = false;
const persistedWatchState = readPveWatchState();
let pveTaskStates = new Map(
  Object.entries(persistedWatchState.taskStates || {}).map(([upid, state]) => [
    upid,
    { status: state?.status || 'unknown', endtime: state?.endtime || null }
  ])
);
let pveSyslogWatcherStarted = false;
let pveSyslogWatcherPrimed = false;
let pveSyslogSeen = new Set(persistedWatchState.syslogSeen || []);
let pveTaskLogCache = new Map();

function snapshotFromContainers(containers) {
  const map = new Map();
  (containers || []).forEach(c => {
    map.set(c.id, {
      id: c.id,
      type: c.type || 'lxc',
      vmid: c.vmid,
      name: c.name,
      hostname: c.hostname,
      ip: c.ip,
      status: c.resources?.status || 'unknown',
    });
  });
  return map;
}

function startInfraWatcher() {
  if (infraWatcherStarted) return;
  infraWatcherStarted = true;
  if (!havePveConfig()) return;

  const intervalMs = 20_000;
  setInterval(async () => {
    try {
      const live = await getLiveContainers();
      const snap = snapshotFromContainers(live);

      if (!lastInfraSnapshot) {
        lastInfraSnapshot = snap;
        return;
      }

      // Ajouts
      for (const [id, cur] of snap.entries()) {
        if (!lastInfraSnapshot.has(id)) {
          appendChangelog({
            type: 'add',
            message: `${cur.type === 'qemu' ? 'VM' : 'CT'} ${cur.vmid} détecté : ${cur.hostname || cur.name} (${cur.ip || '—'})`,
            source: 'infra-watcher',
            entity: cur.type === 'qemu' ? 'vm' : 'ct',
            entityId: String(cur.vmid || cur.id || ''),
            meta: { current: cur }
          });
        }
      }

      // Suppressions
      for (const [id, prev] of lastInfraSnapshot.entries()) {
        if (!snap.has(id)) {
          appendChangelog({
            type: 'delete',
            message: `${prev.type === 'qemu' ? 'VM' : 'CT'} ${prev.vmid} n'est plus présent dans Proxmox`,
            source: 'infra-watcher',
            entity: prev.type === 'qemu' ? 'vm' : 'ct',
            entityId: String(prev.vmid || prev.id || ''),
            meta: { previous: prev }
          });
        }
      }

      // Changements
      for (const [id, cur] of snap.entries()) {
        const prev = lastInfraSnapshot.get(id);
        if (!prev) continue;

        if (prev.status !== cur.status) {
          appendChangelog({
            type: cur.status === 'running' ? 'info' : 'alert',
            message: `${cur.type === 'qemu' ? 'VM' : 'CT'} ${cur.vmid} : ${prev.status} → ${cur.status}`,
            source: 'infra-watcher',
            entity: cur.type === 'qemu' ? 'vm' : 'ct',
            entityId: String(cur.vmid || cur.id || ''),
            changedFields: ['status'],
            before: { status: prev.status },
            after: { status: cur.status },
            meta: { previous: prev, current: cur }
          });
        }
        if ((prev.ip || '—') !== (cur.ip || '—')) {
          appendChangelog({
            type: 'update',
            message: `${cur.type === 'qemu' ? 'VM' : 'CT'} ${cur.vmid} : IP ${prev.ip || '—'} → ${cur.ip || '—'}`,
            source: 'infra-watcher',
            entity: cur.type === 'qemu' ? 'vm' : 'ct',
            entityId: String(cur.vmid || cur.id || ''),
            changedFields: ['ip'],
            before: { ip: prev.ip || '—' },
            after: { ip: cur.ip || '—' },
            meta: { previous: prev, current: cur }
          });
        }
        if ((prev.hostname || '') !== (cur.hostname || '')) {
          appendChangelog({
            type: 'update',
            message: `${cur.type === 'qemu' ? 'VM' : 'CT'} ${cur.vmid} : hostname ${prev.hostname || '—'} → ${cur.hostname || '—'}`,
            source: 'infra-watcher',
            entity: cur.type === 'qemu' ? 'vm' : 'ct',
            entityId: String(cur.vmid || cur.id || ''),
            changedFields: ['hostname'],
            before: { hostname: prev.hostname || '—' },
            after: { hostname: cur.hostname || '—' },
            meta: { previous: prev, current: cur }
          });
        }
      }

      lastInfraSnapshot = snap;
    } catch {
      // silence
    }
  }, intervalMs);
}

function parsePveUpid(upid) {
  // Format usuel: UPID:node:pid:pstart:starttime:type:id:user:
  const parts = String(upid || '').split(':');
  if (!String(upid || '').startsWith('UPID:') || parts.length < 9) {
    return { raw: upid || null };
  }

  const node = parts[1] || null;
  const type = parts[6] || null;
  const entityId = parts[7] || null;
  const user = parts[8] || null;
  const startHex = parts[5] || null;

  let startIso = null;
  if (startHex && /^[0-9a-fA-F]+$/.test(startHex)) {
    const sec = parseInt(startHex, 16);
    if (Number.isFinite(sec)) startIso = new Date(sec * 1000).toISOString();
  }

  return {
    raw: upid,
    node,
    type,
    entityId,
    user,
    startIso
  };
}

function mapPveTaskTypeToEntity(taskType) {
  const t = String(taskType || '').toLowerCase();
  if (['qmstart', 'qmstop', 'qmshutdown', 'qmreboot', 'qmdestroy', 'qmclone', 'qmrestore', 'qmigrate'].includes(t)) return 'vm';
  if (['vzstart', 'vzstop', 'vzshutdown', 'vzreboot', 'vzdestroy', 'vzcreate', 'vzmigrate', 'pctexec'].includes(t)) return 'ct';
  if (['vzdump', 'backup'].includes(t)) return 'backup';
  return 'proxmox-task';
}

function pveTaskMessage(task) {
  const type = String(task.type || '').toLowerCase();
  const id = task.id || '—';
  const status = task.status || 'unknown';
  const user = task.user || 'system';
  if (status === 'running') return `Tâche Proxmox démarrée : ${type} (${id}) par ${user}`;
  if (status === 'OK') return `Tâche Proxmox terminée avec succès : ${type} (${id})`;
  return `Tâche Proxmox en erreur : ${type} (${id}) — ${status}`;
}

function pveTaskLevel(status) {
  if (status === 'running') return 'info';
  if (status === 'OK') return 'add';
  return 'alert';
}

async function getPveTaskLogExcerpt(task, parsed) {
  const upid = task?.upid;
  if (!upid) return null;

  const now = Date.now();
  const cached = pveTaskLogCache.get(upid);
  if (cached && (now - cached.ts) < 60_000) return cached.lines;

  const node = task?.node || parsed?.node || await getPveNodeName().catch(() => null);
  if (!node) return null;

  try {
    const encodedUpid = encodeURIComponent(upid);
    const lines = await pveApiRequest(`/nodes/${node}/tasks/${encodedUpid}/log?limit=200`).catch(() => []);
    if (!Array.isArray(lines)) return null;
    const excerpt = lines
      .map(l => (typeof l?.t === 'string' ? l.t : null))
      .filter(Boolean)
      .slice(-20);
    pveTaskLogCache.set(upid, { ts: now, lines: excerpt });
    return excerpt;
  } catch {
    return null;
  }
}

async function getRecentPveTasks(limit = 100) {
  if (!havePveConfig()) return [];
  const bounded = Math.max(10, Math.min(500, limit));
  let tasks = [];

  try {
    tasks = await pveApiRequest(`/cluster/tasks?limit=${bounded}`);
  } catch {
    const node = await getPveNodeName().catch(() => null);
    if (node) {
      tasks = await pveApiRequest(`/nodes/${node}/tasks?limit=${bounded}`).catch(() => []);
    }
  }

  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter(t => t && t.upid)
    .sort((a, b) => {
      const at = Number(a.starttime || 0);
      const bt = Number(b.starttime || 0);
      return at - bt;
    });
}

function startPveTasksWatcher() {
  if (pveTasksWatcherStarted) return;
  pveTasksWatcherStarted = true;
  if (!havePveConfig() || !PVE_WATCH_TASKS_ENABLED) return;

  const intervalMs = PVE_WATCH_INTERVAL_MS;

  const tick = async () => {
    try {
      const tasks = await getRecentPveTasks(120);

      // Premier passage: on prime l'état sans polluer le journal avec l'historique.
      if (!pveTasksWatcherPrimed && pveTaskStates.size === 0) {
        pveTaskStates = new Map(tasks.map(t => [t.upid, { status: t.status || 'unknown', endtime: t.endtime || null }]));
        pveTasksWatcherPrimed = true;
        writePveWatchState(pveTaskStates, pveSyslogSeen);
        return;
      }
      pveTasksWatcherPrimed = true;

      for (const task of tasks) {
        const upid = task.upid;
        const currentStatus = task.status || 'unknown';
        const prev = pveTaskStates.get(upid);
        const parsed = parsePveUpid(upid);
        const entity = mapPveTaskTypeToEntity(task.type || parsed.type);
        const taskLogLines = await getPveTaskLogExcerpt(task, parsed);

        if (!prev) {
          appendChangelog({
            type: pveTaskLevel(currentStatus),
            message: pveTaskMessage(task),
            service: task.id ? `Proxmox ${task.id}` : 'Proxmox',
            author: task.user || parsed.user || 'proxmox',
            source: 'proxmox-tasks',
            entity,
            entityId: String(task.id || parsed.entityId || ''),
            details: {
              upid,
              node: task.node || parsed.node,
              type: task.type || parsed.type,
              status: currentStatus,
              starttime: task.starttime || null,
              endtime: task.endtime || null,
              parsedUpid: parsed,
              taskLogLines,
            },
            after: task
          });
        } else if (prev.status !== currentStatus) {
          appendChangelog({
            type: pveTaskLevel(currentStatus),
            message: `Tâche Proxmox: ${task.type || parsed.type} (${task.id || parsed.entityId || '—'}) ${prev.status} → ${currentStatus}`,
            service: task.id ? `Proxmox ${task.id}` : 'Proxmox',
            author: task.user || parsed.user || 'proxmox',
            source: 'proxmox-tasks',
            entity,
            entityId: String(task.id || parsed.entityId || ''),
            changedFields: ['status'],
            before: { status: prev.status, endtime: prev.endtime || null },
            after: { status: currentStatus, endtime: task.endtime || null },
            details: {
              upid,
              node: task.node || parsed.node,
              type: task.type || parsed.type,
              starttime: task.starttime || null,
              endtime: task.endtime || null,
              parsedUpid: parsed,
              taskLogLines,
            },
            meta: { task: toPlainObject(task) }
          });
        }

        pveTaskStates.set(upid, { status: currentStatus, endtime: task.endtime || null });
      }

      // Évite croissance infinie du map local
      if (pveTaskStates.size > 2000) {
        const keep = new Set(tasks.map(t => t.upid));
        pveTaskStates.forEach((_, key) => {
          if (!keep.has(key)) pveTaskStates.delete(key);
        });
      }

      writePveWatchState(pveTaskStates, pveSyslogSeen);
    } catch {
      // silence
    }
  };

  tick();
  setInterval(tick, intervalMs);
}

async function getRecentPveSyslog(limit = 120) {
  if (!havePveConfig()) return [];
  const bounded = Math.max(20, Math.min(500, limit));
  let logs = [];

  try {
    logs = await pveApiRequest(`/cluster/log?limit=${bounded}`);
  } catch {
    const node = await getPveNodeName().catch(() => null);
    if (node) {
      logs = await pveApiRequest(`/nodes/${node}/syslog?limit=${bounded}`).catch(() => []);
    }
  }

  if (!Array.isArray(logs)) return [];
  return logs
    .filter(x => x && (x.msg || x.message))
    .sort((a, b) => Number(a.n || a.time || 0) - Number(b.n || b.time || 0));
}

function inferEntityFromSyslog(msg = '') {
  const text = String(msg || '');
  const ctMatch = text.match(/\b(?:CT|LXC|pct)\s*([0-9]{2,5})\b/i)
    || text.match(/\bvz(?:start|stop|shutdown|reboot|create|destroy|migrate)\b[^0-9]*([0-9]{2,5})/i)
    || text.match(/\bvmid\s*[:=]\s*([0-9]{2,5})\b/i);

  if (ctMatch?.[1]) return { entity: 'ct', entityId: ctMatch[1] };

  const vmMatch = text.match(/\b(?:VM|QEMU|qm)\s*([0-9]{2,5})\b/i)
    || text.match(/\bqm(?:start|stop|shutdown|reboot|clone|restore|destroy|migrate)\b[^0-9]*([0-9]{2,5})/i);
  if (vmMatch?.[1]) return { entity: 'vm', entityId: vmMatch[1] };

  return { entity: 'proxmox-log', entityId: null };
}

function levelFromSyslog(entry) {
  const pri = Number(entry?.pri);
  const text = String(entry?.msg || entry?.message || '').toLowerCase();
  if (Number.isFinite(pri) && pri <= 3) return 'alert';
  if (text.includes('error') || text.includes('failed') || text.includes('échec')) return 'alert';
  if (text.includes('warning') || text.includes('warn')) return 'fix';
  if (text.includes('start') || text.includes('started') || text.includes('created')) return 'add';
  if (text.includes('stop') || text.includes('stopped') || text.includes('destroy')) return 'delete';
  return 'info';
}

function startPveSyslogWatcher() {
  if (pveSyslogWatcherStarted) return;
  pveSyslogWatcherStarted = true;
  if (!havePveConfig() || !PVE_WATCH_SYSLOG_ENABLED) return;

  const intervalMs = PVE_WATCH_INTERVAL_MS;

  const tick = async () => {
    try {
      const logs = await getRecentPveSyslog(180);

      if (!pveSyslogWatcherPrimed && pveSyslogSeen.size === 0) {
        pveSyslogSeen = new Set(logs.map((e) => `${e.n || ''}|${e.time || ''}|${e.node || ''}|${e.tag || ''}|${e.msg || e.message || ''}`));
        pveSyslogWatcherPrimed = true;
        writePveWatchState(pveTaskStates, pveSyslogSeen);
        return;
      }
      pveSyslogWatcherPrimed = true;

      const nowSec = Math.floor(Date.now() / 1000);
      for (const entry of logs) {
        const message = String(entry.msg || entry.message || '').trim();
        if (!message) continue;

        const key = `${entry.n || ''}|${entry.time || ''}|${entry.node || ''}|${entry.tag || ''}|${message}`;
        if (pveSyslogSeen.has(key)) continue;

        // Ignore les vieilles lignes si le poll a raté un cycle.
        const t = Number(entry.time || 0);
        if (Number.isFinite(t) && t > 0 && (nowSec - t) > 300) {
          pveSyslogSeen.add(key);
          continue;
        }

        const inferred = inferEntityFromSyslog(message);
        appendChangelog({
          type: levelFromSyslog(entry),
          message: `Proxmox log: ${message}`,
          service: inferred.entityId ? `Proxmox ${inferred.entityId}` : 'Proxmox',
          author: entry.user || 'proxmox',
          source: 'proxmox-syslog',
          entity: inferred.entity,
          entityId: inferred.entityId,
          details: {
            n: entry.n,
            node: entry.node,
            time: entry.time,
            tag: entry.tag,
            pid: entry.pid,
            pri: entry.pri,
            user: entry.user,
          },
          meta: {
            raw: toPlainObject(entry)
          }
        });

        pveSyslogSeen.add(key);
      }

      if (pveSyslogSeen.size > 5000) {
        const lastKeys = logs
          .slice(-1000)
          .map((e) => `${e.n || ''}|${e.time || ''}|${e.node || ''}|${e.tag || ''}|${e.msg || e.message || ''}`);
        pveSyslogSeen = new Set(lastKeys);
      }

      writePveWatchState(pveTaskStates, pveSyslogSeen);
    } catch {
      // silence
    }
  };

  tick();
  setInterval(tick, intervalMs);
}

// ---------- API : Services ----------

// Lister tous les services avec leurs catégories
app.get('/api/services', (req, res) => {
  try {
    res.json(readJson(SERVICES_FILE));
  } catch (e) {
    res.status(500).json({ error: 'Lecture impossible' });
  }
});

// Données fusionnées (services.json + Proxmox live)
app.get('/api/data', async (req, res) => {
  try {
    const forceLive = String(req.query?.live || '').toLowerCase() === '1';
    if (forceLive) res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    const data = await getMergedData(forceLive);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Erreur génération data live' });
  }
});

// Debug live Proxmox
app.get('/api/proxmox/containers', async (req, res) => {
  try {
    const forceLive = String(req.query?.live || '').toLowerCase() === '1';
    if (forceLive) res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    const data = await getLiveContainers(forceLive);
    res.json({ ok: true, count: data.length, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Action power sur un guest Proxmox (LXC/VM)
app.post('/api/proxmox/guests/:type/:vmid/power', async (req, res) => {
  try {
    const rawType = String(req.params.type || '').toLowerCase();
    const vmid = parseInt(req.params.vmid, 10);
    const action = String(req.body?.action || '').toLowerCase();

    if (!Number.isFinite(vmid) || vmid <= 0) {
      return res.status(400).json({ error: 'VMID invalide' });
    }

    const type = rawType === 'vm' ? 'qemu' : rawType;
    if (!['lxc', 'qemu'].includes(type)) {
      return res.status(400).json({ error: 'Type invalide (lxc/vm/qemu attendu)' });
    }
    if (!['start', 'stop'].includes(action)) {
      return res.status(400).json({ error: 'Action invalide (start/stop attendu)' });
    }

    const node = await getPveNodeName();
    if (!node) return res.status(500).json({ error: 'Nœud Proxmox introuvable' });

    const basePath = `/nodes/${node}/${type}/${vmid}/status`;
    let result = null;
    if (action === 'start') {
      try {
        result = await pveApiPostRequest(`${basePath}/start`);
      } catch (e) {
        const msg = String(e?.message || e).toLowerCase();
        if (msg.includes('already running') || msg.includes('is running')) {
          result = null;
        } else {
          throw e;
        }
      }
    } else {
      try {
        result = await pveApiPostRequest(`${basePath}/shutdown`);
      } catch (e) {
        const msg = String(e?.message || e).toLowerCase();
        if (msg.includes('not running') || msg.includes('already stopped') || msg.includes('is stopped')) {
          result = null;
        } else {
          result = await pveApiPostRequest(`${basePath}/stop`);
        }
      }
    }

    appendChangelog({
      type: action === 'start' ? 'add' : 'delete',
      message: `Action Proxmox: ${action === 'start' ? 'démarrage' : 'arrêt'} ${type === 'lxc' ? 'CT' : 'VM'} ${vmid}`,
      service: `Proxmox ${vmid}`,
      author: 'admin',
      source: 'proxmox-power-api',
      entity: type === 'lxc' ? 'ct' : 'vm',
      entityId: String(vmid),
      details: {
        node,
        type,
        vmid,
        action,
        task: result || null
      }
    });

    liveContainersCache = { ts: 0, data: null };
    invalidateLiveCaches();
    res.json({ ok: true, node, type, vmid, action, task: result || null });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Vérification explicite de la configuration Proxmox
app.get('/api/proxmox/config-check', async (req, res) => {
  try {
    const configured = havePveConfig();
    const payload = {
      ok: true,
      configured,
      host: PVE_HOST || null,
      port: PVE_PORT || null,
      tokenId: PVE_TOKEN_ID || null,
      tokenSecretPresent: !!PVE_TOKEN_SECRET,
      tokenIdMasked: maskSecret(PVE_TOKEN_ID),
      tokenSecretMasked: maskSecret(PVE_TOKEN_SECRET),
      connectivity: {
        ok: false,
        node: null,
        error: configured ? 'Test non exécuté' : 'PVE_* manquantes'
      }
    };

    if (!configured) return res.json(payload);

    try {
      const node = await getPveNodeName();
      payload.connectivity = {
        ok: !!node,
        node: node || null,
        error: node ? null : 'Nœud Proxmox introuvable'
      };
    } catch (e) {
      payload.connectivity = {
        ok: false,
        node: null,
        error: String(e?.message || e)
      };
    }

    res.json(payload);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Debug tâches Proxmox observables
app.get('/api/proxmox/tasks', async (req, res) => {
  try {
    const tasks = await getRecentPveTasks(50);
    res.json({ ok: true, count: tasks.length, sample: tasks.slice(0, 10) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Debug logs système Proxmox (cluster/node syslog)
app.get('/api/proxmox/logs', async (req, res) => {
  try {
    const logs = await getRecentPveSyslog(80);
    res.json({ ok: true, count: logs.length, sample: logs.slice(0, 20) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Debug statut des watchers Proxmox (future-proof)
app.get('/api/proxmox/watchers', (req, res) => {
  try {
    const persisted = readPveWatchState();
    res.json({
      ok: true,
      config: {
        enabledTasks: PVE_WATCH_TASKS_ENABLED,
        enabledSyslog: PVE_WATCH_SYSLOG_ENABLED,
        intervalMs: PVE_WATCH_INTERVAL_MS
      },
      runtime: {
        infraWatcherStarted,
        tasksWatcherStarted: pveTasksWatcherStarted,
        tasksWatcherPrimed: pveTasksWatcherPrimed,
        taskStatesCount: pveTaskStates.size,
        taskLogCacheCount: pveTaskLogCache.size,
        syslogWatcherStarted: pveSyslogWatcherStarted,
        syslogWatcherPrimed: pveSyslogWatcherPrimed,
        syslogSeenCount: pveSyslogSeen.size,
      },
      persisted: {
        ts: persisted.ts,
        taskStatesCount: Object.keys(persisted.taskStates || {}).length,
        syslogSeenCount: Array.isArray(persisted.syslogSeen) ? persisted.syslogSeen.length : 0
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Debug DNS Technitium utilisé pour la découverte auto
app.get('/api/dns/technitium', async (req, res) => {
  try {
    const index = await getTechnitiumDnsIndex();
    const byIp = {};
    index.byIp.forEach((domains, ip) => { byIp[ip] = Array.from(domains).sort(); });
    const authMode = TECHNITIUM_TOKEN
      ? 'static-token'
      : ((TECHNITIUM_USER && TECHNITIUM_PASS) ? 'user-pass' : 'none');
    res.json({
      ok: true,
      source: index.source,
      authMode,
      zones: index.zones || 0,
      countIps: Object.keys(byIp).length,
      byIp
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Vue d'ensemble (graphiques)
app.get('/api/overview', async (req, res) => {
  try {
    res.json(await getOverview());
  } catch (e) {
    res.status(500).json({ error: 'Erreur overview' });
  }
});

// Ajouter un service
app.post('/api/services', (req, res) => {
  const data = readJson(SERVICES_FILE);
  const s = req.body;
  if (!s.id || !s.name || !s.url || !s.category) {
    return res.status(400).json({ error: 'Champs requis : id, name, url, category' });
  }
  if (data.services.find(x => x.id === s.id)) {
    return res.status(409).json({ error: 'Un service avec cet identifiant existe déjà' });
  }
  s.status = 'unknown';
  data.services.push(s);
  writeJson(SERVICES_FILE, data);

  appendChangelog({
    type: 'add',
    service: s.name,
    message: `Service ajouté : ${s.name}`,
    author: 'admin',
    source: 'admin-api',
    entity: 'service',
    entityId: s.id,
    after: s,
    details: {
      id: s.id,
      name: s.name,
      category: s.category,
      url: s.url,
      domain: s.domain,
      container: s.container
    }
  });

  res.status(201).json(s);
});

// Modifier un service
app.put('/api/services/:id', (req, res) => {
  const data = readJson(SERVICES_FILE);
  const idx = data.services.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Service introuvable' });
  const before = data.services[idx];
  data.services[idx] = { ...data.services[idx], ...req.body };
  writeJson(SERVICES_FILE, data);

  appendChangelog({
    type: 'update',
    service: before?.name,
    message: `Service modifié : ${before?.name || req.params.id}`,
    author: 'admin',
    source: 'admin-api',
    entity: 'service',
    entityId: req.params.id,
    before,
    after: data.services[idx],
    details: {
      requestBody: toPlainObject(req.body)
    }
  });
  res.json(data.services[idx]);
});

// Supprimer un service
app.delete('/api/services/:id', (req, res) => {
  const data = readJson(SERVICES_FILE);
  const idx = data.services.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Service introuvable' });
  const [removed] = data.services.splice(idx, 1);
  writeJson(SERVICES_FILE, data);

  appendChangelog({
    type: 'delete',
    service: removed.name,
    message: `Service supprimé : ${removed.name}`,
    author: 'admin',
    source: 'admin-api',
    entity: 'service',
    entityId: removed.id,
    before: removed
  });

  res.json({ success: true });
});

// Promouvoir un service auto-découvert en service validé persistant
app.post('/api/services/:id/promote', async (req, res) => {
  try {
    const merged = await getMergedData();
    const candidate = (merged.services || []).find(s => s.id === req.params.id);

    if (!candidate) return res.status(404).json({ error: 'Service introuvable' });
    if (!candidate.autoDiscovered) {
      return res.status(400).json({ error: 'Seuls les services auto peuvent être promus' });
    }

    const base = readJson(SERVICES_FILE);
    const usedIds = new Set((base.services || []).map(s => s.id));

    const candidateKey = getServiceIdentityKey(candidate);
    if (candidateKey) {
      const existing = (base.services || []).find(s => getServiceIdentityKey(s) === candidateKey);
      if (existing) {
        return res.status(200).json({
          ok: true,
          alreadyExists: true,
          message: 'Service déjà validé',
          service: existing
        });
      }
    }

    const promoted = buildPromotedServiceFromAuto(candidate, base, usedIds);
    base.services.push(promoted);
    writeJson(SERVICES_FILE, base);

    const promotions = readJson(PROMOTIONS_FILE);
    promotions.unshift({
      id: Date.now(),
      promotedId: promoted.id,
      promotedName: promoted.name,
      sourceId: candidate.id,
      sourceName: candidate.name,
      sourceKey: candidateKey,
      ts: new Date().toISOString(),
      mode: 'manual'
    });
    writeJson(PROMOTIONS_FILE, promotions.slice(0, 500));

    appendChangelog({
      type: 'add',
      service: promoted.name,
      message: `Service auto validé : ${promoted.name}`,
      author: 'admin',
      source: 'auto-promotion',
      entity: 'service',
      entityId: promoted.id,
      before: candidate,
      after: promoted,
      details: {
        sourceId: candidate.id,
        sourceName: candidate.name,
        sourceKey: candidateKey,
        mode: 'manual'
      }
    });

    invalidateLiveCaches();
    res.status(201).json({ ok: true, promoted: true, service: promoted });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Refuser un service auto-découvert (masquage persistant)
app.post('/api/services/:id/reject', async (req, res) => {
  try {
    const merged = await getMergedData();
    const candidate = (merged.services || []).find(s => s.id === req.params.id);

    if (!candidate) return res.status(404).json({ error: 'Service introuvable' });
    if (!candidate.autoDiscovered) {
      return res.status(400).json({ error: 'Seuls les services auto peuvent être refusés' });
    }

    const sourceKey = getServiceIdentityKey(candidate);
    const rejections = readAutoServiceRejections();
    const exists = rejections.some((r) => (
      String(r?.sourceId || '') === String(candidate.id)
      || (sourceKey && String(r?.sourceKey || '') === sourceKey)
    ));

    if (!exists) {
      rejections.unshift({
        id: Date.now(),
        sourceId: candidate.id,
        sourceName: candidate.name,
        sourceKey,
        domain: candidate.domain || null,
        url: candidate.url || null,
        container: candidate.container || null,
        ts: new Date().toISOString(),
        mode: 'manual'
      });
      writeJson(AUTO_REJECTIONS_FILE, rejections.slice(0, 1000));
    }

    appendChangelog({
      type: 'delete',
      service: candidate.name,
      message: `Service auto refusé : ${candidate.name}`,
      author: 'admin',
      source: 'auto-rejection',
      entity: 'service',
      entityId: candidate.id,
      before: candidate,
      details: {
        sourceId: candidate.id,
        sourceName: candidate.name,
        sourceKey,
        mode: 'manual'
      }
    });

    invalidateLiveCaches();
    res.status(200).json({ ok: true, rejected: true, alreadyRejected: exists });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---------- API : Health Check ----------
app.get('/api/health', async (req, res) => {
  const maxAgeMs = 30_000;
  const age = Date.now() - (healthCache.ts || 0);
  if (age > maxAgeMs) {
    runHealthChecks();
  }
  res.json(healthCache.results || []);
});

// Health check d'un seul service
app.get('/api/health/:id', async (req, res) => {
  try {
    const data = await getMergedData();
    const service = (data.services || []).find(s => s.id === req.params.id);
    if (!service) return res.status(404).json({ error: 'Service introuvable' });
    const result = await checkService(service);
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Erreur health check' });
  }
});

// ---------- API : Notes ----------
app.get('/api/notes', (req, res) => {
  res.json(readJson(NOTES_FILE));
});

app.post('/api/notes', (req, res) => {
  const { title, content, color } = req.body;
  if (!content) return res.status(400).json({ error: 'Le contenu est requis' });
  const notes = readJson(NOTES_FILE);
  const note = {
    id: Date.now(),
    title: title || 'Note sans titre',
    content,
    color: color || '#6366f1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  notes.unshift(note);
  writeJson(NOTES_FILE, notes);
  res.status(201).json(note);
});

app.put('/api/notes/:id', (req, res) => {
  const notes = readJson(NOTES_FILE);
  const idx = notes.findIndex(n => n.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Note introuvable' });
  notes[idx] = { ...notes[idx], ...req.body, updatedAt: new Date().toISOString() };
  writeJson(NOTES_FILE, notes);
  res.json(notes[idx]);
});

app.delete('/api/notes/:id', (req, res) => {
  let notes = readJson(NOTES_FILE);
  notes = notes.filter(n => n.id !== parseInt(req.params.id));
  writeJson(NOTES_FILE, notes);
  res.json({ success: true });
});

// ---------- API : Changelog ----------
app.get('/api/changelog', (req, res) => {
  res.json(readJson(CHANGELOG_FILE));
});

app.post('/api/changelog', (req, res) => {
  const { message, type, service, author, source, entity, entityId, details, meta } = req.body;
  if (!message) return res.status(400).json({ error: 'Le message est requis' });
  const entry = {
    id: Date.now(),
    type: type || 'info',
    message,
    service: service || null,
    author: author || 'admin',
    source: source || 'manual',
    entity: entity || null,
    entityId: entityId || null,
    details: toPlainObject(details),
    meta: toPlainObject(meta),
    date: new Date().toISOString()
  };
  appendChangelog(entry);
  res.status(201).json(entry);
});

// ---------- API : Statut global ----------
app.get('/api/status', (req, res) => {
  const data = readJson(SERVICES_FILE);
  res.json({
    total: data.services.length,
    categories: data.categories.length,
    uptime: process.uptime(),
    serverTime: new Date().toISOString(),
    version: '1.0.0'
  });
});

// ---------- SPA fallback ----------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- Démarrage ----------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔═══════════════════════════════════════╗`);
  console.log(`║    Proxmox-Interfaces - v1.0.0        ║`);
  console.log(`╚═══════════════════════════════════════╝`);
  console.log(`  Serveur démarré sur http://0.0.0.0:${PORT}`);
  console.log(`  Accès local : http://localhost:${PORT}\n`);

  startInfraWatcher();
  startPveTasksWatcher();
  startPveSyslogWatcher();
  runHealthChecks();
  setInterval(runHealthChecks, 30000);
});
