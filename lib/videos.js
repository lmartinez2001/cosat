// Video pool for the Shorts feed: real YouTube videos SHORTER THAN 30 SECONDS.
//
// Browsers cannot search YouTube without an API key, so the pool is gathered
// server-side (by the GitHub Action, or the local dev server) and published as
// a plain list of video ids. Nothing is ever downloaded: the feed embeds these
// ids in YouTube's own player.
//
// Durations are exact, never guessed:
//   * search results that carry a "0:24"-style label are parsed directly;
//   * everything else (Shorts, which show no label) is verified by reading
//     "lengthSeconds" from the watch page, once per video, and remembered in a
//     duration cache that survives across runs so we never re-check an id.
// Only videos under MAX_SECONDS survive into the published pool.
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');
const CACHE = path.join(CACHE_DIR, 'videos.json');
const DURATIONS = path.join(CACHE_DIR, 'durations.json');
// Committed to the repo so a fresh CI runner starts with known durations instead of
// re-reading hundreds of watch pages. The runtime cache layers on top of it.
const DURATIONS_SEED = path.join(__dirname, '..', 'data', 'durations-seed.json');

const MAX_SECONDS = 30;
const FORMAT = 2;   // bump when the shape of videos.json changes, so stale caches are rebuilt
const TTL_MS = 12 * 60 * 60 * 1000;
const SEARCH_SPACING_MS = 1200;
const VERIFY_SPACING_MS = 550;
const VERIFY_BUDGET = 700;          // watch-page checks per run; cached ids are free
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Short-form-oriented queries. "#shorts" biases YouTube toward vertical clips,
// and every search is additionally filtered to "under 4 minutes".
const QUERIES = [
  'ufo #shorts', 'uap #shorts', 'ufo sighting #shorts', 'ufo caught on camera #shorts', 'alien #shorts',
  'black knight satellite #shorts', 'starlink ufo #shorts', 'starlink train sighting #shorts', 'satellite conspiracy #shorts',
  'project blue beam #shorts', 'pentagon uap footage #shorts', 'tic tac ufo #shorts', 'roswell #shorts', 'phoenix lights #shorts',
  'area 51 #shorts', 'ufo disclosure #shorts', 'uap hearing #shorts', 'ufo debunked #shorts', 'iridium flare #shorts',
  'space debris reentry #shorts', 'satellite flare #shorts', 'ufo drone sighting #shorts', 'unidentified flying object #shorts',
  'ufo footage', 'ufo sighting clip', 'uap footage navy', 'starlink satellites sky', 'satellite passing overhead',
  'iss flyover timelapse', 'rocket launch ufo sighting', 'meteor or ufo', 'strange lights in the sky', 'ufo shorts compilation',
  'ufo mystery explained short', 'black knight satellite explained', 'alien conspiracy short', 'weather balloon ufo',
  'military satellite secret', 'space conspiracy short', 'ufo hoax exposed',
];

const log = (...a) => console.log(new Date().toISOString(), '[videos]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJSON = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o)); };

// "1:04" / "0:22" / "1:02:03" -> seconds
function labelSeconds(text) {
  if (!text) return null;
  const parts = String(text).trim().split(':').map(Number);
  if (!parts.length || parts.some(n => !Number.isFinite(n))) return null;
  return parts.reduce((a, b) => a * 60 + b, 0);
}

function parseSearch(html) {
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) return [];
  let data; try { data = JSON.parse(m[1]); } catch { return []; }
  const text = r => (r && r.runs ? r.runs.map(x => x.text).join('') : (r && r.simpleText) || '');
  const out = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.videoRenderer && node.videoRenderer.videoId) {
      const v = node.videoRenderer;
      out.push({ id: v.videoId, title: text(v.title), channel: text(v.ownerText || v.longBylineText), views: text(v.viewCountText), published: text(v.publishedTimeText), label: text(v.lengthText) });
      return;
    }
    if (node.reelItemRenderer && node.reelItemRenderer.videoId) {
      const v = node.reelItemRenderer;
      out.push({ id: v.videoId, title: text(v.headline), channel: '', views: text(v.viewCountText), published: '', label: null });
      return;
    }
    if (node.shortsLockupViewModel) {
      const v = node.shortsLockupViewModel;
      const id = v.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId;
      if (id) out.push({ id, title: v.overlayMetadata?.primaryText?.content || '', channel: '', views: v.overlayMetadata?.secondaryText?.content || '', published: '', label: null });
      return;
    }
    for (const k in node) walk(node[k]);
  })(data);
  return out;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

// Exact duration from the watch page. "lengthSeconds" sits near the top of the
// document, so we stream the response and stop as soon as we have it instead of
// pulling the whole ~1 MB page. Returns seconds, or null if unreadable.
async function watchSeconds(id) {
  const res = await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = '', read = 0;
  try {
    while (read < 700_000) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.length; buf += dec.decode(value, { stream: true });
      const m = buf.match(/"lengthSeconds":"(\d+)"/);
      if (m) return +m[1];
      if (buf.length > 400_000) buf = buf.slice(-2000); // keep only a joint between chunks
    }
  } finally { try { await reader.cancel(); } catch { } }
  return null;
}

async function refreshVideos({ force = false } = {}) {
  const cached = readJSON(CACHE);
  const usable = cached && cached.format === FORMAT && cached.maxSeconds === MAX_SECONDS;
  if (!force && usable && Date.now() - cached.fetchedAt < TTL_MS) return cached;
  if (cached && !usable) log('cached pool is from an older format; rebuilding');

  const durations = { ...(readJSON(DURATIONS_SEED) || {}), ...(readJSON(DURATIONS) || {}) };  // id -> seconds (-1 = unreadable)
  const candidates = new Map();
  let searchFails = 0;

  for (const q of QUERIES) {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIYAQ%253D%253D`; // under 4 minutes
    try {
      for (const v of parseSearch(await fetchText(url))) {
        if (!v.id || !v.title) continue;
        if (!candidates.has(v.id)) candidates.set(v.id, { ...v, query: q.replace(' #shorts', '') });
      }
    } catch (e) { searchFails++; log('search FAIL', q, e.message); }
    await sleep(SEARCH_SPACING_MS);
  }

  // Resolve durations: label first (free), then the cache, then the watch page.
  const needVerify = [];
  for (const v of candidates.values()) {
    const fromLabel = labelSeconds(v.label);
    if (fromLabel != null) { v.seconds = fromLabel; durations[v.id] = fromLabel; }
    else if (durations[v.id] != null) v.seconds = durations[v.id];
    else needVerify.push(v);
  }
  log(`${candidates.size} candidates · ${candidates.size - needVerify.length} durations known · ${needVerify.length} to verify`);

  let verified = 0, verifyFails = 0;
  for (const v of needVerify) {
    if (verified >= VERIFY_BUDGET) break;
    try { const s = await watchSeconds(v.id); v.seconds = s; durations[v.id] = s == null ? -1 : s; }
    catch (e) { verifyFails++; durations[v.id] = -1; }
    verified++;
    await sleep(VERIFY_SPACING_MS);
  }
  writeJSON(DURATIONS, durations);

  const videos = [...candidates.values()]
    .filter(v => Number.isFinite(v.seconds) && v.seconds > 0 && v.seconds < MAX_SECONDS)
    .map(v => ({ id: v.id, title: v.title, channel: v.channel, views: v.views, published: v.published, seconds: v.seconds, query: v.query }));

  if (!videos.length) { log('no short videos found; keeping previous pool'); return usable ? cached : { fetchedAt: 0, format: FORMAT, maxSeconds: MAX_SECONDS, videos: [] }; }

  // Keep previously published clips that are still known-short, so the pool grows run over run.
  const merged = new Map(videos.map(v => [v.id, v]));
  if (usable) for (const v of cached.videos) if (!merged.has(v.id) && v.seconds > 0 && v.seconds < MAX_SECONDS) merged.set(v.id, v);

  const out = { fetchedAt: Date.now(), format: FORMAT, maxSeconds: MAX_SECONDS, videos: [...merged.values()], stats: { candidates: candidates.size, verified, searchFails, verifyFails, durationsKnown: Object.keys(durations).length } };
  writeJSON(CACHE, out);
  log(`ok ${out.videos.length} videos under ${MAX_SECONDS}s (${videos.length} this run, ${verified} verified, ${verifyFails} unreadable)`);
  return out;
}

module.exports = { refreshVideos, readCache: () => readJSON(CACHE), parseSearch, labelSeconds, QUERIES, MAX_SECONDS };
