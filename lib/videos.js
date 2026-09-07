// Real video pool for the Shorts feed, gathered server-side (GitHub Action or the
// local server) because YouTube cannot be searched from a browser without a key.
// We scrape YouTube's search result page for a handful of queries, spaced out,
// parse the embedded ytInitialData JSON, and keep {id, title, channel, views}.
// Cached on disk for 12 h. Failures are non-fatal: the feed also has Commons
// and Internet Archive videos fetched directly by the browser.
const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, '..', 'data', 'cache', 'videos.json');
const TTL_MS = 12 * 60 * 60 * 1000;
const SPACING_MS = 1500;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const QUERIES = [
  'ufo satellite conspiracy', 'black knight satellite', 'starlink ufo sighting', 'pentagon uap footage', 'project blue beam satellites',
  'flying saucer footage', 'ufo documentary declassified', 'satellite conspiracy theory', 'iss ufo sighting', 'ufo sighting 2025',
  'uap hearing congress', 'iridium flare ufo', 'starlink train mistaken ufo', 'secret military satellites', 'alien spacecraft evidence',
  'project blue book', 'roswell incident', 'phoenix lights', 'tic tac ufo navy', 'ufo shorts',
];
const log = (...a) => console.log(new Date().toISOString(), '[videos]', ...a);

function readCache() { try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { return null; } }

function parseSearch(html) {
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s); if (!m) return [];
  let data; try { data = JSON.parse(m[1]); } catch { return []; }
  const out = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.videoRenderer && node.videoRenderer.videoId) {
      const v = node.videoRenderer; const text = r => (r && r.runs ? r.runs.map(x => x.text).join('') : (r && r.simpleText) || '');
      out.push({ id: v.videoId, title: text(v.title), channel: text(v.ownerText || v.longBylineText), views: text(v.viewCountText), length: text(v.lengthText), published: text(v.publishedTimeText) });
      return;
    }
    if (node.reelItemRenderer && node.reelItemRenderer.videoId) { const v = node.reelItemRenderer; out.push({ id: v.videoId, title: (v.headline && (v.headline.simpleText || (v.headline.runs || []).map(x => x.text).join(''))) || '', channel: '', views: (v.viewCountText && v.viewCountText.simpleText) || '', length: 'short', published: '' }); return; }
    if (node.shortsLockupViewModel) { const v = node.shortsLockupViewModel; const id = v.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId; if (id) out.push({ id, title: v.overlayMetadata?.primaryText?.content || '', channel: '', views: v.overlayMetadata?.secondaryText?.content || '', length: 'short', published: '' }); return; }
    for (const k in node) walk(node[k]);
  })(data);
  return out;
}

async function fetchQuery(q, shorts) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=${shorts ? 'EgIYAQ%253D%253D' : 'EgIQAQ%253D%253D'}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return parseSearch(await res.text()).map(v => ({ ...v, query: q }));
}

async function refreshVideos({ force = false } = {}) {
  const cached = readCache();
  if (!force && cached && Date.now() - cached.fetchedAt < TTL_MS) return cached;
  const seen = new Map(); let failures = 0;
  for (const q of QUERIES) {
    for (const shorts of [true, false]) {
      try { for (const v of await fetchQuery(q, shorts)) if (v.id && !seen.has(v.id)) seen.set(v.id, v); }
      catch (e) { failures++; log('FAIL', q, shorts ? '(shorts)' : '', e.message); }
      await new Promise(r => setTimeout(r, SPACING_MS));
    }
  }
  const videos = [...seen.values()];
  if (!videos.length) { log('no videos parsed; keeping previous cache'); return cached || { fetchedAt: 0, videos: [] }; }
  const out = { fetchedAt: Date.now(), videos, failures, queries: QUERIES.length };
  fs.mkdirSync(path.dirname(CACHE), { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify(out));
  log('ok', videos.length, 'videos from', QUERIES.length, 'queries,', failures, 'failures');
  return out;
}

module.exports = { refreshVideos, readCache, parseSearch, QUERIES };
