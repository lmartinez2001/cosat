// CO—SAT Shorts: an endless vertical feed of UFO / satellite conspiracy
// theories, each pinned to a real satellite over your head right now, each
// ending with the boring truth. Parody. Every theory is false; every number is live.
import { loadSky, guessObserver, prettyName, dirName, OWNER_SHORT, SITE_SHORT, DOMAINS } from './sky.js';

const $ = s => document.querySelector(s);
const feed = $('#feed');
const R_EARTH = 6371, MU = 398600.4418;
let sky = null, coast = null; const cards = []; let cardSeq = 0; let believedTotal = 0;
fetch('vendor/coastlines.json').then(r => r.json()).then(d => { coast = d; }).catch(() => { });

// ---------------- helpers ----------------
const rnd = a => a[Math.floor(Math.random() * a.length)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cur = i => { const o = i * 7, c = sky.cur; return { lat: c[o], lon: c[o + 1], alt: c[o + 2], az: c[o + 3], el: c[o + 4], range: c[o + 5], rate: c[o + 6] }; };
const meta = i => sky.objects[i];
const name = i => prettyName(sky.names[i]);
const owner = i => OWNER_SHORT[meta(i).o] || meta(i).o || 'an unknown party';
const site = i => SITE_SHORT[meta(i).s] || meta(i).s || 'an undisclosed site';
const year = i => meta(i).l ? +meta(i).l.slice(0, 4) : null;
const inGroup = (i, g) => meta(i).g.includes(g);
const speed = alt => Math.sqrt(MU / (R_EARTH + Math.max(150, alt)));
const fmtT = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const mins = s => s < 90 ? Math.round(s) + ' s' : Math.round(s / 60) + ' min';
function above(filter, minEl = 0) { const out = []; for (let i = 0; i < sky.N; i++) { const c = cur(i); if (c.alt >= 0 && c.el > minEl && (!filter || filter(i, c))) out.push(i); } return out; }
function risingSoon(filter, maxMin = 12) { let best = -1, be = 1e9; for (let i = 0; i < sky.N; i++) { const c = cur(i); if (c.alt < 0 || c.alt > 2500 || c.el >= 0 || c.rate <= 0.004) continue; if (filter && !filter(i, c)) continue; const eta = -c.el / c.rate; if (eta < be && eta < maxMin * 60) { be = eta; best = i; } } return best >= 0 ? { i: best, eta: be } : null; }
const lineOf = (i) => { const c = cur(i); return `<b>${esc(name(i))}</b> · el ${c.el.toFixed(1)}° ${dirName(c.az)} · ${c.alt.toFixed(0)} km · ${speed(c.alt).toFixed(2)} km/s`; };
const setOrClimb = i => { const c = cur(i); return c.rate < -0.002 ? `sets in ${mins(c.el / -c.rate)}` : c.rate > 0.002 ? `still climbing` : `hanging there`; };
const believes = i => (meta(i).c * 7919) % 4200 + 37, doubts = i => (meta(i).c * 104729) % 900 + 12;

// ---------------- real content sources ----------------
// Everything shown is real, fetched live in the browser from sources that allow it:
//  * Wikipedia: a walk through the UFO / ufology category tree plus rolling searches (CC BY-SA)
//  * Internet Archive: UFO documents, declassified files and films (title-matched)
//  * Hacker News: stories about UFOs / UAP / satellites (via Algolia)
// The only thing CO—SAT adds is the live line about what is really above you.
const enc = encodeURIComponent;
async function getJSON(url) { try { const r = await fetch(url, { headers: { Accept: 'application/json' } }); if (!r.ok) return null; return await r.json(); } catch { return null; } }
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const strip = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const trunc = (t, n) => t.length <= n ? t : t.slice(0, n).replace(/\s+\S*$/, '') + '…';

const WIKI_SEEDS = ['Category:UFO conspiracy theories', 'Category:UFO sightings', 'Category:Ufology', 'Category:Unidentified flying objects', 'Category:UFO culture', 'Category:Alien abduction'];
const WIKI_SEARCHES = ['UFO sighting', 'unidentified flying object', 'flying saucer', 'unidentified anomalous phenomena', 'satellite conspiracy theory', 'UFO conspiracy', 'Project Blue Book', 'alien abduction claim', 'UFO hoax', 'UFO documentary', 'ufologist', 'UFO incident'];
const SKIP_TITLE = /^(List of|Category:|Template:|Portal:|Wikipedia:|Draft:|File:)/;
const wiki = { queue: [], seen: new Set(), cats: WIKI_SEEDS.slice(), catSeen: new Set(), si: 0, offsets: {}, exhausted: false };
async function wikiFill() {
  let guard = 0;
  while (wiki.queue.length < 6 && guard++ < 8) {
    if (wiki.cats.length) {
      const c = wiki.cats.shift(); if (wiki.catSeen.has(c)) continue; wiki.catSeen.add(c);
      const d = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=${enc(c)}&cmlimit=200&cmtype=page|subcat&format=json&origin=*`);
      const fresh = [];
      for (const m of d?.query?.categorymembers || []) { if (m.ns === 14) { if (!wiki.catSeen.has(m.title)) wiki.cats.push(m.title); } else if (m.ns === 0 && !SKIP_TITLE.test(m.title) && !wiki.seen.has(m.title)) { wiki.seen.add(m.title); fresh.push(m.title); } }
      wiki.queue.push(...shuffle(fresh)); shuffle(wiki.cats);
    } else {
      const q = WIKI_SEARCHES[wiki.si % WIKI_SEARCHES.length]; wiki.si++; const off = wiki.offsets[q] || 0;
      const d = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc(q)}&srlimit=50&sroffset=${off}&srnamespace=0&format=json&origin=*`);
      const hits = d?.query?.search || []; wiki.offsets[q] = off + 50;
      const fresh = hits.map(h => h.title).filter(t => !SKIP_TITLE.test(t) && !wiki.seen.has(t)); fresh.forEach(t => wiki.seen.add(t)); wiki.queue.push(...shuffle(fresh));
      if (!hits.length && wiki.si % WIKI_SEARCHES.length === 0) { wiki.offsets = {}; wiki.seen.clear(); wiki.cats = WIKI_SEEDS.slice(); wiki.catSeen.clear(); } // start over: the feed is a loop, like the sky
    }
  }
}
async function wikiCard() {
  for (let tries = 0; tries < 4; tries++) {
    await wikiFill(); const title = wiki.queue.shift(); if (!title) return null;
    const s = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${enc(title.replace(/ /g, '_'))}`);
    if (!s || s.type === 'disambiguation' || !s.extract || s.extract.length < 80) continue;
    let image = null; if (s.thumbnail?.source && s.originalimage?.width) { const w = Math.min(900, s.originalimage.width); image = s.thumbnail.source.replace(/\/\d+px-/, `/${w}px-`); }
    return { source: 'wikipedia', kicker: `Wikipedia · ${s.description || 'article'}`, title: s.title, body: trunc(s.extract, 330), image, url: s.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${enc(title)}`, credit: 'Text: Wikipedia contributors, CC BY-SA 4.0', id: 'wiki:' + s.title };
  }
  return null;
}
const archive = { page: 1, items: [], seen: new Set() };
async function archiveCard() {
  if (!archive.items.length) {
    const q = 'title:(UFO OR UFOs OR "flying saucer" OR "flying saucers" OR "unidentified flying" OR "Project Blue Book" OR UAP) AND mediatype:(texts OR movies) AND NOT collection:(speedruns)';
    const d = await getJSON(`https://archive.org/advancedsearch.php?q=${enc(q)}&fl[]=identifier&fl[]=title&fl[]=description&fl[]=date&fl[]=mediatype&fl[]=creator&fl[]=downloads&rows=40&page=${archive.page}&output=json&sort[]=downloads+desc`);
    const docs = d?.response?.docs || []; archive.page = docs.length ? archive.page + 1 : 1;
    archive.items = shuffle(docs.filter(x => !archive.seen.has(x.identifier))); if (!archive.items.length) return null;
  }
  const it = archive.items.shift(); archive.seen.add(it.identifier);
  const desc = strip(Array.isArray(it.description) ? it.description.join(' ') : it.description); const year = (it.date || '').slice(0, 4);
  const kind = it.mediatype === 'movies' ? 'film' : 'document';
  return { source: 'archive', kicker: `Internet Archive · ${kind}${year ? ' · ' + year : ''}${it.creator ? ' · ' + strip(Array.isArray(it.creator) ? it.creator[0] : it.creator) : ''}`, title: strip(it.title), body: trunc(desc || `A ${kind} from the Internet Archive with ${(it.downloads || 0).toLocaleString()} downloads.`, 300), image: it.mediatype === 'texts' ? `https://archive.org/download/${it.identifier}/page/cover_w800.jpg` : `https://archive.org/services/img/${it.identifier}`, imageFallback: `https://archive.org/services/img/${it.identifier}`, url: `https://archive.org/details/${it.identifier}`, credit: `Internet Archive · ${(it.downloads || 0).toLocaleString()} downloads`, id: 'archive:' + it.identifier };
}
const hn = { page: 0, items: [], qi: 0, queries: ['UFO', 'UAP', 'unidentified aerial', 'flying saucer', 'alien spacecraft', 'Pentagon UFO', 'satellite conspiracy'] };
async function hnCard() {
  if (!hn.items.length) {
    const q = hn.queries[hn.qi % hn.queries.length]; const d = await getJSON(`https://hn.algolia.com/api/v1/search?query=${enc(q)}&tags=story&hitsPerPage=30&page=${hn.page}`);
    const hits = (d?.hits || []).filter(h => h.title && h.points >= 20 && /ufo|uap|saucer|alien|unidentified|anomalous|extraterrestrial|satellite/i.test(h.title));
    hn.items = shuffle(hits); hn.qi++; if (hn.qi % hn.queries.length === 0) hn.page = (hn.page + 1) % 5; if (!hn.items.length) return null;
  }
  const h = hn.items.shift(); let host = ''; try { host = new URL(h.url).hostname.replace(/^www\./, ''); } catch { }
  return { source: 'hn', kicker: `Hacker News · ${h.points} points · ${h.num_comments || 0} comments`, title: strip(h.title), body: `${host ? 'From ' + host + '. ' : ''}Posted ${new Date(h.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}. Read the story, then the thread, then remember which one you believed first.`, image: null, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, discuss: `https://news.ycombinator.com/item?id=${h.objectID}`, credit: 'Hacker News via Algolia', id: 'hn:' + h.objectID };
}
const PATTERN = ['wikipedia', 'wikipedia', 'archive', 'wikipedia', 'hn', 'wikipedia', 'archive', 'wikipedia', 'wikipedia', 'hn'];
let patternPos = Math.floor(Math.random() * PATTERN.length); const usedIds = new Set();
async function nextContent() {
  for (let k = 0; k < 6; k++) {
    const src = PATTERN[(patternPos + k) % PATTERN.length];
    const c = await (src === 'wikipedia' ? wikiCard() : src === 'archive' ? archiveCard() : hnCard());
    if (c && !usedIds.has(c.id)) { usedIds.add(c.id); patternPos = (patternPos + k + 1) % PATTERN.length; return c; }
  }
  return null;
}
// live tie-in: a satellite that is really above you, for the radar + the live line
function liveSat() { const list = above((i, c) => c.alt < 2500 && c.el > 8); return list.length ? rnd(list) : (above().length ? rnd(above()) : -1); }
function liveLine(i) { const n = above().length; if (i < 0) return `<b>${n}</b> catalogued objects above your horizon right now`; return `<b>${n}</b> objects above you · nearest to this reel: ${lineOf(i)} · ${setOrClimb(i)}`; }

// ---------------- rendering ----------------
function addCard(c) {
  const n = ++cardSeq; const el = document.createElement('section'); el.className = 'short' + (c.image ? ' has-img' : ''); el.dataset.source = c.source;
  const sat = liveSat(); const bel = (n * 7919 + (sat >= 0 ? meta(sat).c : 0)) % 4200 + 37, dou = (n * 104729) % 900 + 12;
  el.innerHTML = `${c.image ? `<img class="bg" alt="" src="${c.image}" loading="lazy" decoding="async">` : ''}<canvas></canvas><div class="grain"></div><div class="shade"></div>
    <div class="top"><span><span class="brand">CO—SAT Shorts · </span>#${n}</span><span class="stamp">Real sources</span></div>
    <div class="text"><div class="kicker">${esc(c.kicker)}</div><h1 class="title">${esc(c.title)}</h1><p class="body">${esc(c.body)}</p><p class="credit">${esc(c.credit)}</p><div class="reality"><span class="lbl">Meanwhile, above you</span><span class="rtxt">${liveLine(sat)}</span></div></div>
    <div class="rail"><div><button class="believe" title="believe">👁</button><small>${bel.toLocaleString()}</small></div><div><button class="doubt" title="doubt">🛰</button><small>${dou.toLocaleString()}</small></div><div><a class="src" href="${c.url}" target="_blank" rel="noopener" title="open source">↗</a><small>source</small></div><div><button class="share" title="share">⇪</button><small>share</small></div></div>`;
  const canvas = el.querySelector('canvas'); const ctx = canvas.getContext('2d');
  const card = { el, canvas, ctx, spec: { viz: { kind: c.image ? 'radar' : rnd(['radar', 'globe', 'radar', 'ping']), sat } }, content: c, state: { trail: [], t0: Date.now(), stars: null, track: null }, visible: false, n };
  if (card.spec.viz.kind === 'globe' && sat < 0) card.spec.viz.kind = 'radar';
  card.resize = () => { const dpr = Math.min(2, devicePixelRatio || 1); const w = el.clientWidth, h = el.clientHeight; if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); } card.w = w; card.h = h; card.dpr = dpr; };
  card.tick = () => { if (sat >= 0) { const s = cur(sat); if (s.el > -10) card.state.trail.push([s.az, s.el]); if (card.state.trail.length > 240) card.state.trail.shift(); } el.querySelector('.rtxt').innerHTML = liveLine(sat); };
  const img = el.querySelector('img.bg'); if (img) img.onerror = () => { if (c.imageFallback && img.src !== c.imageFallback) { img.src = c.imageFallback; return; } img.remove(); el.classList.remove('has-img'); };
  el.querySelector('.believe').onclick = e => toggle(e.currentTarget, bel, '👁'); el.querySelector('.doubt').onclick = e => toggle(e.currentTarget, dou, '🛰');
  el.querySelector('.share').onclick = async () => { const url = location.href.split('#')[0] + '#' + enc(c.id); try { if (navigator.share) await navigator.share({ title: 'CO—SAT Shorts', text: c.title, url }); else { await navigator.clipboard.writeText(url); flash(el.querySelector('.share'), 'copied'); } } catch { } };
  feed.appendChild(el); cards.push(card); io.observe(el); card.resize();
  return card;
}
let filling = false;
async function fillAhead(target = 3) {
  if (filling) return; filling = true;
  try { while (cards.length && cardSeq - currentIndex() < target) { const c = await nextContent(); if (!c) break; addCard(c); } } finally { filling = false; }
}
function currentIndex() { let best = 0, bd = 1e9; for (const c of cards) { const d = Math.abs(c.el.getBoundingClientRect().top); if (d < bd) { bd = d; best = c.n; } } return best; }
const io = new IntersectionObserver(entries => {
  for (const e of entries) { const card = cards.find(c => c.el === e.target); if (!card) continue; card.visible = e.intersectionRatio > 0.5; if (card.visible) { $('#hint').classList.add('gone'); fillAhead(3); } }
}, { root: feed, threshold: [0.5] });

// ---------------- canvas visuals ----------------
const D2R = Math.PI / 180;
function skyXY(card, az, el, cx, cy, R) { const r = el >= 0 ? R * (90 - el) / 90 : R * (1 + Math.min(0.25, -el / 40)); const a = az * D2R; return [cx - r * Math.sin(a), cy - r * Math.cos(a)]; }
function stars(card) { if (!card.state.stars) { const s = []; for (let i = 0; i < 160; i++) s.push([Math.random(), Math.random(), 0.4 + Math.random() * 1.2, Math.random() * 6.3]); card.state.stars = s; } return card.state.stars; }
function drawStars(card, now) { const { ctx, w, h } = card; ctx.fillStyle = '#fff'; for (const s of stars(card)) { ctx.globalAlpha = 0.25 + 0.5 * Math.abs(Math.sin(now / 1500 + s[3])); ctx.fillRect(s[0] * w, s[1] * h, s[2], s[2]); } ctx.globalAlpha = 1; }
function drawRadar(card, now) {
  const { ctx, w, h, spec } = card; const tall = h / w > 1.6; const cx = w / 2, cy = h * (tall ? 0.30 : 0.38), R = Math.min(w, h * 0.5) * (tall ? 0.34 : 0.40);
  drawStars(card, now);
  ctx.strokeStyle = 'rgba(120,255,160,0.35)'; ctx.lineWidth = 1;
  for (const el of [0, 30, 60]) { ctx.beginPath(); ctx.arc(cx, cy, R * (90 - el) / 90, 0, 6.2832); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
  ctx.font = '10px "JetBrains Mono", monospace'; ctx.fillStyle = 'rgba(120,255,160,0.7)'; ctx.textAlign = 'center'; ctx.fillText('N', cx, cy - R - 8); ctx.fillText('S', cx, cy + R + 16); ctx.fillText('E', cx - R - 12, cy + 4); ctx.fillText('W', cx + R + 12, cy + 4);
  // sweep
  const ang = (now / 2500) % 1 * Math.PI * 2; const grad = ctx.createConicGradient ? ctx.createConicGradient(ang - Math.PI / 2, cx, cy) : null;
  if (grad) { grad.addColorStop(0, 'rgba(120,255,160,0.0)'); grad.addColorStop(0.8, 'rgba(120,255,160,0.0)'); grad.addColorStop(1, 'rgba(120,255,160,0.25)'); ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fill(); }
  ctx.strokeStyle = 'rgba(120,255,160,0.8)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + R * Math.cos(ang - Math.PI / 2), cy + R * Math.sin(ang - Math.PI / 2)); ctx.stroke();
  // every satellite above the horizon, faint
  if (spec.viz.all || true) { ctx.fillStyle = 'rgba(200,255,220,0.5)'; const c = sky.cur; for (let i = 0; i < sky.N; i++) { const o = i * 7; if (c[o + 2] < 0 || c[o + 4] <= 0) continue; const [x, y] = skyXY(card, c[o + 3], c[o + 4], cx, cy, R); ctx.fillRect(x - 0.7, y - 0.7, 1.4, 1.4); } }
  // trail + target
  const s = spec.viz.sat; if (s >= 0) {
    const tr = card.state.trail; if (tr.length > 1) { ctx.strokeStyle = 'rgba(255,77,77,0.6)'; ctx.setLineDash([2, 3]); ctx.beginPath(); tr.forEach(([az, el], k) => { const [x, y] = skyXY(card, az, el, cx, cy, R); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.setLineDash([]); }
    const c = cur(s); const [x, y] = skyXY(card, c.az, c.el, cx, cy, R); const p = 0.5 + 0.5 * Math.sin(now / 300);
    ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 6 + p * 5, 0, 6.2832); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - 12, y); ctx.lineTo(x - 6, y); ctx.moveTo(x + 6, y); ctx.lineTo(x + 12, y); ctx.moveTo(x, y - 12); ctx.lineTo(x, y - 6); ctx.moveTo(x, y + 6); ctx.lineTo(x, y + 12); ctx.stroke();
    ctx.fillStyle = '#ff4d4d'; ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    ctx.font = 'bold 10px "JetBrains Mono", monospace'; ctx.textAlign = 'left'; ctx.fillText(spec.viz.redact ? '█████ ' + meta(s).c : name(s).toUpperCase(), x + 14, y - 10);
    ctx.fillStyle = 'rgba(255,77,77,0.7)'; ctx.fillText(`EL ${c.el.toFixed(1)}  AZ ${c.az.toFixed(0)}  RNG ${c.range.toFixed(0)} KM`, x + 14, y + 3);
  }
}
function project(lat, lon, lat0, lon0) { const la = lat * D2R, lo = lon * D2R, la0 = lat0 * D2R, lo0 = lon0 * D2R; const cl = Math.cos(la), dl = lo - lo0; return [cl * Math.sin(dl), Math.cos(la0) * Math.sin(la) - Math.sin(la0) * cl * Math.cos(dl), Math.sin(la0) * Math.sin(la) + Math.cos(la0) * cl * Math.cos(dl)]; }
function drawGlobe(card, now) {
  const { ctx, w, h, spec } = card; const s = spec.viz.sat; const c = cur(s); const tall = h / w > 1.6; const cx = w / 2, cy = h * (tall ? 0.29 : 0.36), R = Math.min(w, h * 0.5) * (tall ? 0.30 : 0.36);
  drawStars(card, now);
  const lat0 = c.lat, lon0 = c.lon;
  ctx.fillStyle = '#0c0e14'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fill();
  const line = pts => { ctx.beginPath(); let pen = false; for (const [la, lo] of pts) { const [x, y, z] = project(la, lo, lat0, lon0); if (z < 0) { pen = false; continue; } const X = cx + x * R, Y = cy - y * R; pen ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); pen = true; } ctx.stroke(); };
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; for (let la = -60; la <= 60; la += 30) line(Array.from({ length: 73 }, (_, k) => [la, -180 + k * 5])); for (let lo = -180; lo < 180; lo += 30) line(Array.from({ length: 37 }, (_, k) => [-90 + k * 5, lo]));
  if (coast) { ctx.strokeStyle = 'rgba(236,234,228,0.6)'; ctx.lineWidth = 0.9; for (const ring of coast) line(ring.map(([x, y]) => [y, x])); }
  ctx.strokeStyle = 'rgba(236,234,228,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.stroke();
  if (!card.state.track || now - card.state.trackAt > 20000) { card.state.track = sky.track(s, c.alt > 5000 ? 240 : 45); card.state.trackAt = now; }
  ctx.strokeStyle = 'rgba(255,77,77,0.7)'; ctx.setLineDash([3, 3]); line(card.state.track.map(p => [p[0], p[1]])); ctx.setLineDash([]);
  // observer
  const [ox, oy, oz] = project(sky.observer.lat, sky.observer.lon, lat0, lon0); if (oz > 0) { ctx.strokeStyle = '#ffd166'; ctx.beginPath(); ctx.moveTo(cx + ox * R - 5, cy - oy * R); ctx.lineTo(cx + ox * R + 5, cy - oy * R); ctx.moveTo(cx + ox * R, cy - oy * R - 5); ctx.lineTo(cx + ox * R, cy - oy * R + 5); ctx.stroke(); ctx.fillStyle = '#ffd166'; ctx.font = '10px "JetBrains Mono", monospace'; ctx.textAlign = 'left'; ctx.fillText('you', cx + ox * R + 7, cy - oy * R - 5); }
  const p = 0.5 + 0.5 * Math.sin(now / 300); ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, 6 + p * 5, 0, 6.2832); ctx.stroke(); ctx.fillStyle = '#ff4d4d'; ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
  ctx.font = 'bold 10px "JetBrains Mono", monospace'; ctx.textAlign = 'left'; ctx.fillText(name(s).toUpperCase(), cx + 14, cy - 8); ctx.fillStyle = 'rgba(255,77,77,0.7)'; ctx.fillText(`${c.lat.toFixed(1)}°, ${c.lon.toFixed(1)}° · ${c.alt.toFixed(0)} KM`, cx + 14, cy + 5);
}
function drawTrain(card, now) {
  const { ctx, w, h, spec } = card; drawStars(card, now); const n = 22; const t = (now - card.state.t0) / 1000;
  ctx.fillStyle = '#fff'; for (let k = 0; k < n; k++) { const u = ((t * 0.06 + k * 0.028) % 1.3) - 0.15; const x = w * (0.1 + u * 0.8), y = h * (0.5 - u * 0.28) + Math.sin(k) * 2; const a = 0.5 + 0.5 * Math.sin(now / 400 + k); ctx.globalAlpha = 0.5 + 0.5 * a; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 0.15; ctx.beginPath(); ctx.arc(x, y, 6, 0, 6.2832); ctx.fill(); }
  ctx.globalAlpha = 1; ctx.font = 'bold 10px "JetBrains Mono", monospace'; ctx.fillStyle = '#ff4d4d'; ctx.textAlign = 'left'; ctx.fillText('WITNESS FOOTAGE · ENHANCED', 18, h * 0.16); ctx.fillStyle = 'rgba(255,77,77,.6)'; ctx.fillText('REC ● ' + new Date(now).toISOString().slice(11, 19), 18, h * 0.16 + 14);
  drawHorizonSats(card, now);
}
function drawHorizonSats(card, now) { const { ctx, w, h } = card; const c = sky.cur; ctx.fillStyle = 'rgba(255,255,255,0.35)'; for (let i = 0; i < sky.N; i += 3) { const o = i * 7; if (c[o + 2] < 0 || c[o + 4] <= 0) continue; const x = w * (0.5 - 0.48 * Math.sin(c[o + 3] * D2R)), y = h * (0.62 - 0.5 * c[o + 4] / 90); ctx.fillRect(x, y, 1, 1); } }
function drawPolar(card, now) {
  const { ctx, w, h, spec } = card; drawStars(card, now); const cx = w / 2, cy = h * 0.40, R = Math.min(w, h * 0.5) * 0.22; const t = (now - card.state.t0) / 1000;
  ctx.fillStyle = '#0c0e14'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fill(); ctx.strokeStyle = 'rgba(236,234,228,.5)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.strokeStyle = 'rgba(236,234,228,.2)'; ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
  for (let k = 0; k < 4; k++) { const rot = t * 0.08 + k * 0.5; ctx.save(); ctx.translate(cx, cy); ctx.rotate(0.15 * Math.sin(rot)); ctx.scale(0.35 + 0.25 * Math.abs(Math.cos(rot)), 1); ctx.strokeStyle = k === 0 ? 'rgba(255,77,77,.8)' : 'rgba(120,255,160,.3)'; ctx.setLineDash(k === 0 ? [] : [2, 4]); ctx.beginPath(); ctx.arc(0, 0, R * 1.45, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]); const a = t * (0.9 + k * 0.2); ctx.fillStyle = k === 0 ? '#ff4d4d' : '#9f9'; ctx.beginPath(); ctx.arc(R * 1.45 * Math.cos(a), R * 1.45 * Math.sin(a), k === 0 ? 3 : 1.5, 0, 6.2832); ctx.fill(); ctx.restore(); }
  ctx.font = 'bold 10px "JetBrains Mono", monospace'; ctx.fillStyle = '#ff4d4d'; ctx.textAlign = 'center'; ctx.fillText('POLAR ORBIT · INCLINATION ~90°', cx, cy + R * 1.9);
}
function drawDome(card, now) {
  const { ctx, w, h, spec } = card; drawStars(card, now); const gy = h * 0.55; const t = (now - card.state.t0) / 1000;
  ctx.strokeStyle = 'rgba(236,234,228,.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(w * 0.08, gy); ctx.lineTo(w * 0.92, gy); ctx.stroke();
  ctx.strokeStyle = 'rgba(120,255,160,.5)'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(w / 2, gy, w * 0.42, Math.PI, 0); ctx.stroke(); ctx.setLineDash([]);
  ctx.font = '10px "JetBrains Mono", monospace'; ctx.fillStyle = 'rgba(120,255,160,.8)'; ctx.textAlign = 'center'; ctx.fillText('"THE DOME"', w / 2, gy - w * 0.42 - 8); ctx.fillStyle = 'rgba(236,234,228,.6)'; ctx.fillText('"THE PLANE"', w / 2, gy + 16);
  const s = spec.viz.sat; if (s >= 0) { const c = cur(s); const a = Math.PI + (c.az > 180 ? 1 : -1) * 0; const x = w / 2 - Math.cos((90 - c.el) * D2R) * Math.sign(Math.sin(c.az * D2R)) * w * 0.42 * 0.9, y = gy - Math.sin(Math.max(2, c.el) * D2R) * w * 0.42; const p = 0.5 + 0.5 * Math.sin(now / 300); ctx.strokeStyle = '#ff4d4d'; ctx.beginPath(); ctx.arc(x, y, 5 + p * 4, 0, 6.2832); ctx.stroke(); ctx.fillStyle = '#ff4d4d'; ctx.fillRect(x - 1.5, y - 1.5, 3, 3); ctx.font = 'bold 10px "JetBrains Mono", monospace'; ctx.textAlign = 'left'; ctx.fillText(name(s).toUpperCase() + ' (NAILED)', x + 10, y - 6); }
  if (spec.viz.moon) { ctx.fillStyle = '#cfd8ff'; ctx.beginPath(); ctx.arc(w * 0.8, h * 0.16, 9, 0, 6.2832); ctx.fill(); ctx.fillStyle = '#050505'; ctx.beginPath(); ctx.arc(w * 0.8 + 4, h * 0.16 - 2, 8, 0, 6.2832); ctx.fill(); ctx.font = '10px "JetBrains Mono", monospace'; ctx.fillStyle = 'rgba(207,216,255,.7)'; ctx.textAlign = 'center'; ctx.fillText('"RELAY"', w * 0.8, h * 0.16 + 22); }
  drawHorizonSats(card, now);
}
function drawFlare(card, now) {
  const { ctx, w, h } = card; drawStars(card, now); const t = (now - card.state.t0) / 1000; const ph = t % 6; if (ph < 1.2) { const k = Math.sin(ph / 1.2 * Math.PI); const x = w * (0.3 + 0.4 * ((t / 6) % 1)), y = h * 0.3; const g = ctx.createRadialGradient(x, y, 0, x, y, 60 * k + 1); g.addColorStop(0, 'rgba(255,255,255,' + k + ')'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 60 * k + 1, 0, 6.2832); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,' + k * 0.8 + ')'; ctx.beginPath(); ctx.moveTo(x - 40 * k, y); ctx.lineTo(x + 40 * k, y); ctx.moveTo(x, y - 40 * k); ctx.lineTo(x, y + 40 * k); ctx.stroke(); }
  ctx.font = 'bold 10px "JetBrains Mono", monospace'; ctx.fillStyle = '#ff4d4d'; ctx.textAlign = 'left'; ctx.fillText('NEXT "SIGNAL" IN ' + (6 - ph).toFixed(1) + ' S', 18, h * 0.16);
  drawHorizonSats(card, now);
}
function drawPing(card, now) { const { ctx, w, h, spec } = card; drawRadar(card, now); const s = spec.viz.sat; if (s < 0) return; const c = cur(s); const tall = h / w > 1.6; const cx = w / 2, cy = h * (tall ? 0.30 : 0.38), R = Math.min(w, h * 0.5) * (tall ? 0.34 : 0.40); const [x, y] = skyXY(card, c.az, c.el, cx, cy, R); for (let k = 0; k < 3; k++) { const ph = ((now / 1500) + k / 3) % 1; ctx.strokeStyle = `rgba(127,214,255,${1 - ph})`; ctx.beginPath(); ctx.arc(x, y, 4 + ph * 90, 0, 6.2832); ctx.stroke(); } }
const DRAW = { radar: drawRadar, globe: drawGlobe, train: drawTrain, polar: drawPolar, dome: drawDome, flare: drawFlare, ping: drawPing, stars: (c, n) => { drawStars(c, n); drawHorizonSats(c, n); } };

function loop() {
  const now = Date.now(); if (sky) sky.lerp(now);
  for (const card of cards) { if (!card.visible) continue; card.resize(); const { ctx, dpr, w, h } = card; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); try { (DRAW[card.spec.viz.kind] || drawRadar)(card, now); } catch (e) { } }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------------- navigation ----------------
function step(dir) { feed.scrollBy({ top: dir * feed.clientHeight, behavior: 'smooth' }); }
$('#next').onclick = () => step(1); $('#prev').onclick = () => step(-1);
window.addEventListener('keydown', e => { if (['ArrowDown', 'j', ' ', 'PageDown'].includes(e.key)) { e.preventDefault(); step(1); } if (['ArrowUp', 'k', 'PageUp'].includes(e.key)) { e.preventDefault(); step(-1); } });
feed.addEventListener('scroll', () => $('#hint').classList.add('gone'), { passive: true });
window.addEventListener('resize', () => cards.forEach(c => c.resize()));

// ---------------- boot ----------------
(async () => {
  const obs = guessObserver(); let first = true;
  sky = await loadSky({ observer: { lat: obs.lat, lon: obs.lon }, onProgress: m => { $('#load-note').textContent = m; }, onTick: () => {
    if (first) { first = false; (async () => {
      $('#load-note').textContent = 'contacting Wikipedia, the Internet Archive and Hacker News…';
      // deep link: #wiki:Title opens that article first
      const m = decodeURIComponent(location.hash.slice(1)); if (m.startsWith('wiki:')) { wiki.queue.unshift(m.slice(5)); }
      const c0 = await nextContent(); if (c0) addCard(c0); $('#loading').remove(); fillAhead(4);
    })(); }
    for (const c of cards) if (c.visible) c.tick();
  } });
  $('#load-note').textContent = `${sky.N.toLocaleString()} objects loaded · computing who is above ${obs.city || 'you'}…`;
})();
