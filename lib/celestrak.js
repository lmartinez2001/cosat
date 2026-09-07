// Polite CelesTrak client.
//
// CelesTrak asks that GP (orbital element) data be pulled no more than once
// every 2 hours per query, and SATCAT is only regenerated daily. We therefore:
//   * cache every response on disk with its fetch time (survives restarts)
//   * refresh a group only when its cache is older than the TTL
//   * refresh groups sequentially with a pause between requests (no bursts)
//   * on 403/429/5xx, keep serving the stale copy and back off exponentially
//   * identify ourselves with a User-Agent and accept gzip
// The browser never talks to CelesTrak directly; it talks to this server,
// which answers from cache.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');
const UA = 'cosat-parody/0.1 (+local astrology-with-satellites experiment; contact: local)';

const GP_TTL_MS = 3 * 60 * 60 * 1000;      // 3h  (policy minimum is 2h; we add margin)
const SATCAT_TTL_MS = 24 * 60 * 60 * 1000; // 24h (SATCAT is regenerated daily)
const SPACING_MS = 2500;                   // pause between consecutive upstream requests
const BASE_BACKOFF_MS = 30 * 60 * 1000;    // 30 min, doubles per consecutive failure, capped at 12h
const MAX_BACKOFF_MS = 12 * 60 * 60 * 1000;

fs.mkdirSync(CACHE_DIR, { recursive: true });

function cachePath(key) { return path.join(CACHE_DIR, key.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json'); }

function readCache(key) {
  try { return JSON.parse(fs.readFileSync(cachePath(key), 'utf8')); } catch { return null; }
}
function writeCache(key, entry) {
  const tmp = cachePath(key) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(entry));
  fs.renameSync(tmp, cachePath(key));
}

// In-memory state per key: { body, fetchedAt, status, failures, cooldownUntil, lastError }
const state = new Map();
const log = (...a) => console.log(new Date().toISOString(), '[celestrak]', ...a);

function get(key) {
  if (!state.has(key)) {
    const c = readCache(key);
    state.set(key, c ? { ...c, failures: 0, cooldownUntil: 0, lastError: null } : { body: null, fetchedAt: 0, failures: 0, cooldownUntil: 0, lastError: null });
  }
  return state.get(key);
}

function isStale(key, ttl) {
  const s = get(key);
  return !s.body || (Date.now() - s.fetchedAt) > ttl;
}

async function fetchUpstream(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip', 'Accept': 'application/json, text/csv;q=0.9, */*;q=0.5' },
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

// Serialized queue so we never have two upstream requests in flight.
let chain = Promise.resolve();
let lastRequestAt = 0;
function enqueue(fn) {
  const p = chain.then(async () => {
    const wait = Math.max(0, lastRequestAt + SPACING_MS - Date.now());
    if (wait) await new Promise(r => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  chain = p.catch(() => {});
  return p;
}

const inflight = new Map();
function refresh(key, url, ttl, parse) {
  const s = get(key);
  if (!isStale(key, ttl)) return Promise.resolve(s);
  if (Date.now() < s.cooldownUntil) return Promise.resolve(s);
  if (inflight.has(key)) return inflight.get(key);
  const p = enqueue(async () => {
    log('GET', url);
    try {
      const r = await fetchUpstream(url);
      if (r.status !== 200) throw new Error('HTTP ' + r.status + (r.status === 403 || r.status === 429 ? ' (rate limited?)' : ''));
      // CelesTrak replies with this plain-text notice, not an error, when the dataset has not
      // changed since our last successful pull. Our cached copy is therefore current: mark it
      // fresh so the TTL restarts and we do not ask again for another full interval.
      if (/GP data has not updated/i.test(r.text.slice(0, 200))) {
        if (s.body) { s.fetchedAt = Date.now(); s.failures = 0; s.cooldownUntil = 0; s.lastError = null; writeCache(key, { body: s.body, fetchedAt: s.fetchedAt }); log('unchanged upstream,', key, 'stays current'); return s; }
        throw new Error('upstream says unchanged but we hold no copy');
      }
      const body = parse(r.text);
      Object.assign(s, { body, fetchedAt: Date.now(), failures: 0, cooldownUntil: 0, lastError: null });
      writeCache(key, { body, fetchedAt: s.fetchedAt });
      log('ok', key, Array.isArray(body) ? body.length + ' records' : '', (r.text.length / 1024).toFixed(0) + ' KB');
    } catch (e) {
      s.failures += 1;
      const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (s.failures - 1));
      s.cooldownUntil = Date.now() + backoff;
      s.lastError = String(e.message || e);
      log('FAIL', key, s.lastError, 'backing off', Math.round(backoff / 60000) + ' min; serving stale copy if any');
    } finally {
      inflight.delete(key);
    }
    return s;
  });
  inflight.set(key, p);
  return p;
}

function gpUrl(group) { return `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=json`; }

function refreshGroup(group) {
  return refresh('gp-' + group, gpUrl(group), GP_TTL_MS, t => JSON.parse(t));
}
function refreshSatcat() {
  return refresh('satcat', 'https://celestrak.org/pub/satcat.csv', SATCAT_TTL_MS, t => t);
}

function status(groups) {
  const out = { now: Date.now(), gpTtlMs: GP_TTL_MS, satcatTtlMs: SATCAT_TTL_MS, spacingMs: SPACING_MS, groups: {}, satcat: null };
  for (const g of groups) {
    const s = get('gp-' + g.id);
    out.groups[g.id] = {
      label: g.label, domain: g.domain,
      count: s.body ? s.body.length : 0,
      fetchedAt: s.fetchedAt || null,
      nextRefreshAt: s.fetchedAt ? s.fetchedAt + GP_TTL_MS : null,
      failures: s.failures, cooldownUntil: s.cooldownUntil || null, lastError: s.lastError,
    };
  }
  const sc = get('satcat');
  out.satcat = { fetchedAt: sc.fetchedAt || null, nextRefreshAt: sc.fetchedAt ? sc.fetchedAt + SATCAT_TTL_MS : null, failures: sc.failures, lastError: sc.lastError, bytes: sc.body ? sc.body.length : 0 };
  return out;
}

module.exports = { get, refreshGroup, refreshSatcat, status, GP_TTL_MS, SATCAT_TTL_MS, gzip: zlib.gzipSync };
