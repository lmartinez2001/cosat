// CO—SAT server: static files + a small JSON API backed by the polite cache.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ct = require('./lib/celestrak');
const satcat = require('./lib/satcat');
const GROUPS = require('./lib/groups');
const videos = require('./lib/videos');

const PORT = +process.env.PORT || 4321;
const PUBLIC = path.join(__dirname, 'public');
const log = (...a) => console.log(new Date().toISOString(), '[server]', ...a);

const { buildCatalog: buildCatalogPayload, getSatcat } = require('./lib/catalog');

// ---------- merged catalog (rebuilt lazily when any group changes) ----------
let catalogCache = { key: '', gz: null, etag: '', builtAt: 0, count: 0 };
function buildCatalog() {
  const key = GROUPS.map(g => ct.get('gp-' + g.id).fetchedAt).join(':') + ':' + ct.get('satcat').fetchedAt;
  if (key === catalogCache.key && catalogCache.gz) return catalogCache;
  const payload = buildCatalogPayload();
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(payload)), { level: 6 });
  catalogCache = { key, gz, etag: '"' + Buffer.from(key).toString('base64url').slice(0, 32) + '"', builtAt: Date.now(), count: payload.count };
  log('catalog built:', payload.count, 'objects,', (gz.length / 1024).toFixed(0), 'KB gzipped');
  return catalogCache;
}

// ---------- ISS live telemetry (independent source, throttled) ----------
// wheretheiss.at allows 350 requests / 5 min. We allow ourselves at most one
// per 30 s regardless of how many browser tabs are open.
let iss = { body: null, fetchedAt: 0, inflight: null, lastError: null, remaining: null };
async function getIss() {
  if (Date.now() - iss.fetchedAt < 30_000) return iss;
  if (iss.inflight) return iss.inflight;
  iss.inflight = (async () => {
    try {
      const res = await fetch('https://api.wheretheiss.at/v1/satellites/25544', { headers: { 'User-Agent': 'cosat-parody/0.1' }, signal: AbortSignal.timeout(10_000) });
      iss.remaining = res.headers.get('x-rate-limit-remaining');
      if (res.status !== 200) throw new Error('HTTP ' + res.status);
      iss.body = await res.json(); iss.fetchedAt = Date.now(); iss.lastError = null;
    } catch (e) { iss.lastError = String(e.message || e); iss.fetchedAt = Date.now(); /* also throttles retries on failure */ }
    finally { iss.inflight = null; }
    return iss;
  })();
  return iss.inflight;
}

// ---------- video pool (YouTube search scrape, 12 h cache) ----------
let videoRefresh = null;
function getVideos() { if (!videoRefresh) videoRefresh = videos.refreshVideos().catch(e => { log('videos error', e.message); return videos.readCache(); }).finally(() => { setTimeout(() => { videoRefresh = null; }, 60_000); }); return videoRefresh; }
setTimeout(getVideos, 5000);

// ---------- refresh scheduler ----------
async function refreshAll() {
  // sequential, spaced by the client; stale groups only.
  await ct.refreshSatcat();
  for (const g of GROUPS) await ct.refreshGroup(g.id);
}
refreshAll().catch(e => log('refresh error', e));
setInterval(() => refreshAll().catch(e => log('refresh error', e)), 10 * 60 * 1000); // checks every 10 min; only fetches what is stale

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/catalog') {
      const c = buildCatalog();
      if (!c.count) return send(res, 503, { error: 'catalog not ready yet; upstream fetch in progress', status: ct.status(GROUPS) }, { 'Retry-After': '5' });
      if (req.headers['if-none-match'] === c.etag) { res.writeHead(304, { ETag: c.etag }); return res.end(); }
      const nextRefresh = Math.min(...GROUPS.map(g => (ct.get('gp-' + g.id).fetchedAt || 0) + ct.GP_TTL_MS));
      const maxAge = Math.max(60, Math.floor((nextRefresh - Date.now()) / 1000));
      return send(res, 200, c.gz, { 'Content-Encoding': 'gzip', ETag: c.etag, 'Cache-Control': 'public, max-age=' + maxAge, 'X-Object-Count': String(c.count) });
    }
    if (url.pathname === '/api/status') return send(res, 200, { ...ct.status(GROUPS), iss: { fetchedAt: iss.fetchedAt || null, lastError: iss.lastError, rateLimitRemaining: iss.remaining }, catalog: { builtAt: catalogCache.builtAt, count: catalogCache.count } }, { 'Cache-Control': 'no-store' });
    if (url.pathname === '/api/natal') {
      const idx = getSatcat();
      if (!idx) return send(res, 503, { error: 'SATCAT not loaded yet' }, { 'Retry-After': '5' });
      const date = url.searchParams.get('date') || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { error: 'date must be YYYY-MM-DD' });
      const r = satcat.natal(idx, date);
      return send(res, 200, { ...r, satcatFetchedAt: ct.get('satcat').fetchedAt, totalCatalogued: idx.total }, { 'Cache-Control': 'public, max-age=3600' });
    }
    if (url.pathname === '/api/videos') {
      const cached = videos.readCache(); getVideos();
      if (!cached) return send(res, 503, { error: 'video pool warming up' }, { 'Retry-After': '30' });
      return send(res, 200, cached, { 'Cache-Control': 'public, max-age=1800' });
    }
    if (url.pathname === '/api/iss') {
      const s = await getIss();
      return send(res, s.body ? 200 : 503, { telemetry: s.body, fetchedAt: s.fetchedAt, lastError: s.lastError, rateLimitRemaining: s.remaining, source: 'https://wheretheiss.at' }, { 'Cache-Control': 'no-store' });
    }
    // static
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    p = path.normalize(p).replace(/^(\.\.[\/\\])+/, '');
    const file = path.join(PUBLIC, p);
    if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'forbidden' });
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, { error: 'not found' });
      const ext = path.extname(file);
      const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': file.includes('/vendor/') ? 'public, max-age=86400' : 'no-cache' };
      if (/\.(js|css|html|json)$/.test(ext) && /gzip/.test(req.headers['accept-encoding'] || '')) { headers['Content-Encoding'] = 'gzip'; data = zlib.gzipSync(data); }
      res.writeHead(200, headers); res.end(data);
    });
  } catch (e) {
    log('error', e); send(res, 500, { error: String(e.message || e) });
  }
});
server.listen(PORT, () => log(`CO—SAT listening on http://localhost:${PORT}`));
