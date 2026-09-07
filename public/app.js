import { Globe } from './globe.js';
import { Wheel, sep } from './wheel.js';
import * as astro from './astro.js';
const D2R = Math.PI / 180;
import { buildReport, natalCopy, CATEGORIES, prettyName, dirName } from './report.js';
import { initFeatures, buildRitual, prefillCompat, applyCompatLink } from './features.js';

const $ = s => document.querySelector(s);
const DOMAINS = ['social', 'routine', 'money', 'spirit', 'work', 'mind', 'love', 'self', 'change', 'shadow'];
const DOMAIN_COLORS = { social: '#a09d95', routine: '#7fd6ff', money: '#ffd166', spirit: '#b8a5ff', work: '#8de0a5', mind: '#ff9de2', love: '#ff7b7b', self: '#ffffff', change: '#ffb36b', shadow: '#666' };
const GROUP_PRIORITY = ['stations', 'science', 'weather', 'iridium-NEXT', 'globalstar', 'planet', 'spire', 'gps-ops', 'galileo', 'glo-ops', 'beidou', 'geo', 'last-30-days', 'amateur', 'military', 'oneweb', 'starlink'];
const PRESETS = [['Paris', 48.8566, 2.3522], ['London', 51.5072, -0.1276], ['New York', 40.7128, -74.006], ['Los Angeles', 34.0522, -118.2437], ['São Paulo', -23.5505, -46.6333], ['Mexico City', 19.4326, -99.1332], ['Lagos', 6.5244, 3.3792], ['Nairobi', -1.2921, 36.8219], ['Cairo', 30.0444, 31.2357], ['Berlin', 52.52, 13.405], ['Madrid', 40.4168, -3.7038], ['Reykjavik', 64.1466, -21.9426], ['Moscow', 55.7558, 37.6173], ['Mumbai', 19.076, 72.8777], ['Singapore', 1.3521, 103.8198], ['Tokyo', 35.6762, 139.6503], ['Seoul', 37.5665, 126.978], ['Sydney', -33.8688, 151.2093], ['Auckland', -36.8485, 174.7633], ['Honolulu', 21.3069, -157.8583], ['Ushuaia', -54.8019, -68.303], ['Longyearbyen', 78.2232, 15.6267]];
const TZ_GUESS = { 'Europe/Paris': 'Paris', 'Europe/London': 'London', 'America/New_York': 'New York', 'America/Los_Angeles': 'Los Angeles', 'America/Sao_Paulo': 'São Paulo', 'America/Mexico_City': 'Mexico City', 'Africa/Lagos': 'Lagos', 'Africa/Nairobi': 'Nairobi', 'Africa/Cairo': 'Cairo', 'Europe/Berlin': 'Berlin', 'Europe/Madrid': 'Madrid', 'Atlantic/Reykjavik': 'Reykjavik', 'Europe/Moscow': 'Moscow', 'Asia/Kolkata': 'Mumbai', 'Asia/Singapore': 'Singapore', 'Asia/Tokyo': 'Tokyo', 'Asia/Seoul': 'Seoul', 'Australia/Sydney': 'Sydney', 'Pacific/Auckland': 'Auckland', 'Pacific/Honolulu': 'Honolulu' };

// Static mode (GitHub Pages): no /api, data comes from files written by scripts/build-static.js.
const STATIC = await fetch('api/status', { method: 'HEAD', cache: 'no-store' }).then(r => !r.ok).catch(() => true);
const URLS = STATIC
  ? { catalog: 'data/catalog.json', status: 'data/status.json', iss: 'https://api.wheretheiss.at/v1/satellites/25544' }
  : { catalog: 'api/catalog', status: 'api/status', iss: 'api/iss' };
const S = {
  catalog: null, N: 0, domainIdx: null, ecc: null, groupsOf: null, names: null, worker: null,
  fa: null, ta: 0, fb: null, tb: 0, cur: null, stats: null, groupIds: [],
  observer: { lat: 48.8566, lon: 2.3522 }, birth: null, name: '', natal: null, report: null, reportShown: false,
  hi: { sun: null, moon: null, rising: null, iss: null, names: {} }, issIdx: -1, issTelemetry: null, status: null, lastReportBuild: 0, lastConj: 0, conj: {}, zenith: {},
};
const globe = new Globe($("#globe")); window.__S = S; window.__globe = globe;
const wheel = new Wheel($('#wheel'));

// ---------- clock / topbar ----------
setInterval(() => { $('#clock').textContent = new Date().toISOString().slice(11, 19) + ' UTC'; }, 1000);

// ---------- form ----------
const presetEl = $('#preset');
for (const [n] of PRESETS) presetEl.append(new Option(n, n));
presetEl.onchange = () => { const p = PRESETS.find(x => x[0] === presetEl.value); if (p) { $('#lat').value = p[1]; $('#lon').value = p[2]; } };
$('#geo').onclick = () => { if (!navigator.geolocation) return; $('#geo').textContent = '…'; navigator.geolocation.getCurrentPosition(p => { $('#lat').value = p.coords.latitude.toFixed(4); $('#lon').value = p.coords.longitude.toFixed(4); presetEl.value = ''; $('#geo').textContent = '◎ located'; }, () => { $('#geo').textContent = '◎ denied'; }, { timeout: 8000 }); };
(function restore() {
  try { const saved = JSON.parse(localStorage.getItem('cosat-form') || 'null'); if (saved) { for (const k of ['name', 'bdate', 'btime', 'lat', 'lon']) if (saved[k] != null) $('#' + k).value = saved[k]; if (saved.lat) S.observer = { lat: +saved.lat, lon: +saved.lon }; return; } } catch { }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; const city = TZ_GUESS[tz] || 'London'; const p = PRESETS.find(x => x[0] === city);
  presetEl.value = city; $('#lat').value = p[1]; $('#lon').value = p[2]; S.observer = { lat: p[1], lon: p[2] };
})();
globe.setObserver(S.observer.lat, S.observer.lon);

const OWNER_LABEL = { US: 'the United States', CIS: 'Russia', PRC: 'China', FR: 'France', ESA: 'the European Space Agency', JPN: 'Japan', IND: 'India', UK: 'the United Kingdom', GER: 'Germany', CA: 'Canada', IT: 'Italy', SES: 'SES', ITSO: 'Intelsat', EUME: 'EUMETSAT', EUTE: 'Eutelsat', IRID: 'Iridium', GLOB: 'Globalstar', O3B: 'O3b', SKOR: 'South Korea', KOR: 'South Korea', ORB: 'Orbcomm', LUXE: 'Luxembourg', NOR: 'Norway', SPN: 'Spain', TBD: 'an undisclosed party' };
const ownerShort = code => OWNER_LABEL[code] || code || 'an unknown operator';

$('#birth-form').onsubmit = async e => {
  e.preventDefault();
  const f = { name: $('#name').value.trim(), bdate: $('#bdate').value, btime: $('#btime').value || '12:00', lat: +$('#lat').value, lon: +$('#lon').value };
  if (!f.bdate || isNaN(f.lat) || isNaN(f.lon)) return;
  localStorage.setItem('cosat-form', JSON.stringify(f));
  S.name = f.name; S.birth = { date: f.bdate, time: f.btime };
  if (f.lat !== S.observer.lat || f.lon !== S.observer.lon) { S.observer = { lat: f.lat, lon: f.lon }; globe.setObserver(f.lat, f.lon); S.worker?.postMessage({ type: 'observer', observer: S.observer }); S.fa = S.fb = null; }
  $('#submit').disabled = true; $('#submit').textContent = 'Reading…';
  try { S.natal = await fetchNatal(f.bdate); } catch { S.natal = null; }
  S.lastReportBuild = 0; S.hi.rising = null;
  const show = () => { if (!S.cur) return setTimeout(show, 200); updateLive(true); $('#report').hidden = false; prefillCompat(S.birth, S.name); buildRitual(S.birth, S.natal); if (!S.reportShown) { S.reportShown = true; pollIss(true); } S.reportShown = true; $('#submit').disabled = false; $('#submit').textContent = 'Read my sky again'; setTimeout(() => $('#report').scrollIntoView({ behavior: 'smooth' }), 50); };
  show();
};

// ---------- catalog ----------
async function loadCatalog(attempt = 0) {
  $('#form-note').textContent = attempt ? `Server is still fetching elements from CelesTrak… (retry ${attempt})` : 'Loading orbital elements…';
  let res; try { res = await fetch(URLS.catalog); } catch { res = null; }
  if (!res || res.status !== 200) { $('#datastate').textContent = 'waiting for upstream…'; return setTimeout(() => loadCatalog(attempt + 1), Math.min(15000, 2000 * (attempt + 1))); }
  const cat = await res.json();
  S.catalog = cat; S.N = cat.objects.length; S.groupIds = cat.groups.map(g => g.id);
  const domainOfGroup = Object.fromEntries(cat.groups.map(g => [g.id, g.domain]));
  S.domainIdx = new Uint8Array(S.N); S.ecc = new Float32Array(S.N); S.names = new Array(S.N);
  cat.objects.forEach((o, i) => { const g = GROUP_PRIORITY.find(p => o.g.includes(p)) || o.g[0]; S.domainIdx[i] = DOMAINS.indexOf(domainOfGroup[g] || 'social'); S.ecc[i] = o.ec; S.names[i] = o.n; if (o.c === 25544) S.issIdx = i; });
  const colors = DOMAINS.map(d => DOMAIN_COLORS[d]);
  S.cur = new Float32Array(S.N * 7).fill(-99);
  globe.setData(S.cur, S.N, S.domainIdx, colors); wheel.setData(S.cur, S.N, S.domainIdx, colors);
  $('#hero-count').textContent = words(S.N);
  $('#wheel-legend').innerHTML = CATEGORIES.map(c => `<span style="--c:${DOMAIN_COLORS[c.key]}">${c.ruler}</span>`).join('') + `<span style="--c:${DOMAIN_COLORS.shadow}">military</span>`;
  startWorker();
  initFeatures({ S, prettyName, dirName, ownerShort, fetchNatal, STATIC });
  if (applyCompatLink()) $('#compat').scrollIntoView({ behavior: 'smooth' });
  $('#form-note').textContent = `${S.N.toLocaleString()} objects loaded. Positions are computed on this device every second; nothing is polled.`;
  $('#submit').disabled = false;
  refreshStatus();
}
function words(n) { const th = Math.round(n / 1000); const w = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty']; return (w[th] || th) + ' thousand'; }

function startWorker() {
  if (S.worker) S.worker.terminate();
  S.worker = new Worker('worker.js');
  S.worker.onmessage = e => {
    const m = e.data;
    if (m.type === 'tick') { S.fa = S.fb; S.ta = S.tb; S.fb = m.pos; S.tb = m.t; S.stats = m.stats; $('#livedot').classList.add('live'); onTick(); }
  };
  S.worker.postMessage({ type: 'init', objects: S.catalog.objects, groups: S.groupIds, observer: S.observer });
}
$('#submit').disabled = true;
loadCatalog();

// ---------- interpolation + render loop ----------
function lerpFrames(now) {
  const N = S.N, cur = S.cur; if (!S.fb) return;
  if (!S.fa) { cur.set(S.fb); return; }
  const f = Math.max(0, Math.min(1.5, (now - 1000 - S.ta) / Math.max(1, S.tb - S.ta)));
  const a = S.fa, b = S.fb;
  for (let i = 0; i < N * 7; i += 7) {
    if (b[i + 2] < 0 || a[i + 2] < 0) { for (let k = 0; k < 7; k++) cur[i + k] = b[i + k]; continue; }
    cur[i] = a[i] + (b[i] - a[i]) * f;
    let dl = b[i + 1] - a[i + 1]; if (dl > 180) dl -= 360; else if (dl < -180) dl += 360; cur[i + 1] = a[i + 1] + dl * f;
    cur[i + 2] = a[i + 2] + (b[i + 2] - a[i + 2]) * f;
    let da = b[i + 3] - a[i + 3]; if (da > 180) da -= 360; else if (da < -180) da += 360; cur[i + 3] = a[i + 3] + da * f;
    cur[i + 4] = a[i + 4] + (b[i + 4] - a[i + 4]) * f; cur[i + 5] = a[i + 5] + (b[i + 5] - a[i + 5]) * f; cur[i + 6] = b[i + 6];
  }
}
let loopErrors = 0;
function loop() {
  try {
    const now = Date.now();
    const globeOn = isVisible($('#globe')), wheelOn = S.reportShown && isVisible($('#wheel'));
    // Interpolating 13k objects is only worth doing if something is actually drawing them.
    if (globeOn || wheelOn) {
      lerpFrames(now);
      if (globeOn) globe.render(now);
      if (wheelOn) wheel.render(now);
    }
  } catch (e) { if (loopErrors++ < 3) console.error('render error', e); }
  requestAnimationFrame(loop);
}
function isVisible(el) { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }
requestAnimationFrame(loop);

// ---------- live sky analysis (1 Hz) ----------
function skyBodies(now) {
  const d = new Date(now), { lat, lon } = S.observer;
  const sun = astro.sunPosition(d), moon = astro.moonPosition(d);
  return { sun: astro.toHorizontal(sun.ra, sun.dec, d, lat, lon), moon: astro.toHorizontal(moon.ra, moon.dec, d, lat, lon), phase: astro.moonPhase(d) };
}
function nearest(az, el, keep, margin) {
  const cur = S.cur; let best = -1, bd = 1e9;
  for (let i = 0; i < S.N; i++) { const o = i * 7; if (cur[o + 2] < 0) continue; const s = sep(az, el, cur[o + 3], cur[o + 4]); if (s < bd) { bd = s; best = i; } }
  if (keep != null && keep >= 0 && S.cur[keep * 7 + 2] >= 0) { const ks = sep(az, el, S.cur[keep * 7 + 3], S.cur[keep * 7 + 4]); if (ks - bd < margin) return keep; }
  return best;
}
function pickRising() {
  const cur = S.cur; const k = S.hi.rising;
  if (k != null && k >= 0) { const o = k * 7; if (cur[o + 4] >= 0 && cur[o + 4] < 12 && cur[o + 6] > 0) return k; }
  let best = -1, be = 99;
  for (let i = 0; i < S.N; i++) { const o = i * 7; const el = cur[o + 4]; if (el >= 0 && el < 12 && cur[o + 6] > 0.005 && el < be) { be = el; best = i; } }
  return best;
}
function onTick() {
  if (!S.fb) return; if (!S.fa) S.cur.set(S.fb);
  const now = Date.now(); const bodies = skyBodies(now);
  analyse(bodies);
  globe.refreshScale();
  S.hi.sun = scan.sunIdx; S.hi.moon = scan.moonIdx; S.hi.rising = scan.risingIdx; S.hi.iss = S.issIdx >= 0 ? S.issIdx : null;
  S.hi.names = { sun: 'SUN · ' + prettyName(S.names[S.hi.sun] || ''), moon: 'MOON · ' + prettyName(S.names[S.hi.moon] || ''), rising: 'RISING · ' + prettyName(S.names[S.hi.rising] || ''), iss: 'ISS' };
  globe.setHighlights(S.hi);
  updateTracks(now);
  heroLive();
  if (S.reportShown) updateLive(false, bodies);
}

// Ground tracks / sky trails for the highlighted satellites: ±8 min, computed
// on the main thread with satellite.js for just these few objects.
const satrecCache = new Map();
function satrecFor(i) { if (!satrecCache.has(i)) { const o = S.catalog.objects[i]; satrecCache.set(i, satellite.json2satrec({ OBJECT_NAME: o.n, OBJECT_ID: o.i, EPOCH: o.e, MEAN_MOTION: o.mm, ECCENTRICITY: o.ec, INCLINATION: o.in, RA_OF_ASC_NODE: o.ra, ARG_OF_PERICENTER: o.ap, MEAN_ANOMALY: o.ma, NORAD_CAT_ID: o.c, BSTAR: o.bs, MEAN_MOTION_DOT: o.nd, MEAN_MOTION_DDOT: o.ndd })); } return satrecCache.get(i); }
let lastTracks = 0;
function updateTracks(now) {
  if (now - lastTracks < 5000) return; lastTracks = now;
  const obs = { latitude: S.observer.lat * Math.PI / 180, longitude: S.observer.lon * Math.PI / 180, height: 0 };
  const colors = { sun: '#ffd166', moon: '#cfd8ff', rising: '#7fd6ff', iss: '#ffffff' };
  const gT = [], wT = [];
  for (const k of ['sun', 'moon', 'rising', 'iss']) {
    const i = S.hi[k]; if (i == null || i < 0) continue; const rec = satrecFor(i); const gp = [], wp = [];
    const alt0 = S.cur[i * 7 + 2]; const span = alt0 > 5000 ? 90 : 8; // minutes; MEO/GEO barely move
    for (let m = -span; m <= span; m += span / 24) {
      const d = new Date(now + m * 60000); let pv; try { pv = satellite.propagate(rec, d); } catch { continue; } if (!pv || !pv.position || typeof pv.position !== 'object') continue;
      const gmst = satellite.gstime(d); const geo = satellite.eciToGeodetic(pv.position, gmst); const la = satellite.ecfToLookAngles(obs, satellite.eciToEcf(pv.position, gmst));
      gp.push([geo.latitude * 180 / Math.PI, geo.longitude * 180 / Math.PI, geo.height]); wp.push([((la.azimuth * 180 / Math.PI) % 360 + 360) % 360, la.elevation * 180 / Math.PI]);
    }
    gT.push({ color: colors[k], pts: gp }); wT.push({ color: colors[k], pts: wp });
  }
  globe.setTracks(gT); wheel.setTracks(wT);
}
function heroLive() {
  const el = $('#hero-live'); if (!S.stats) return;
  const iss = S.issIdx >= 0 ? S.cur[S.issIdx * 7 + 4] : null;
  const above = countAbove();
  el.innerHTML = `<span><b>${above}</b>above your horizon</span><span><b>${S.hi.rising != null && S.hi.rising >= 0 ? prettyName(S.names[S.hi.rising]) : '—'}</b>rising now</span>${iss != null ? `<span><b>ISS</b>${iss > 0 ? 'up, ' + iss.toFixed(0) + '° above your horizon' : Math.round(-iss) + '° below your horizon'}</span>` : ''}<span><b>${S.hi.sun != null && S.hi.sun >= 0 ? prettyName(S.names[S.hi.sun]) : '—'}</b>with the Sun</span>`;
}
function catStats() {
  const st = S.stats; const gi = Object.fromEntries(S.groupIds.map((g, i) => [g, i])); const out = {};
  for (const c of CATEGORIES) { let above = 0, expected = 0; for (const g of c.groups) { const i = gi[g]; if (i == null) continue; above += st.above[i]; expected += st.ringAvg[i]; } out[c.key] = { above, expected, conj: !!S.conj[c.key], zenith: !!S.zenith[c.key] }; }
  return out;
}
function computeConjunctions() {
  // pairs of same-domain satellites within 1° of each other, above the horizon. O(n²) per domain, run every 5 s.
  const cur = S.cur; const byDom = DOMAINS.map(() => []); S.conj = {}; S.zenith = {};
  for (let i = 0; i < S.N; i++) { const o = i * 7; if (cur[o + 4] > 0) { byDom[S.domainIdx[i]].push(i); if (cur[o + 4] > (S.domainIdx[i] === 0 ? 88.5 : 85)) S.zenith[DOMAINS[S.domainIdx[i]]] = true; } }
  // dense constellations need a much tighter orb, and colocated GEO satellites are *always* within 0.1°, so the belt is exempt.
  const ORB = { social: 0.15, money: 0, routine: 1, self: 0.5 };
  byDom.forEach((list, di) => { const key = DOMAINS[di]; const orb = ORB[key] ?? 1; if (!orb) return; for (let a = 0; a < list.length && !S.conj[key]; a++) for (let b = a + 1; b < list.length; b++) { const oa = list[a] * 7, ob = list[b] * 7; if (Math.abs(cur[oa + 4] - cur[ob + 4]) > orb) continue; if (sep(cur[oa + 3], cur[oa + 4], cur[ob + 3], cur[ob + 4]) < orb) { S.conj[key] = true; break; } } });
}
function elements() { return { counts: { fire: scan.fire, air: scan.air, earth: scan.earth, water: scan.water }, n: scan.above }; }
const fmtT = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function updateLive(force, bodies) {
  const now = Date.now(); bodies = bodies || skyBodies(now);
  if (force || now - S.lastConj > 5000) { computeConjunctions(); S.lastConj = now; }
  const cur = S.cur; const cs = catStats(); const el = elements();
  const above = S.stats ? countAbove() : 0;
  const get = i => i == null || i < 0 ? { name: '—', az: 0, el: 0, rate: 0, alt: 0, i: -1 } : { name: prettyName(S.names[i]), az: cur[i * 7 + 3], el: cur[i * 7 + 4], rate: cur[i * 7 + 6], alt: cur[i * 7 + 2], range: cur[i * 7 + 5], i };
  const sunS = get(S.hi.sun), moonS = get(S.hi.moon), risS = get(S.hi.rising);
  // big three
  setB3('sun', sunS, `${Math.round(sep(bodies.sun.az, bodies.sun.el, sunS.az, sunS.el))}° from the Sun · ${owner(sunS.i)}`);
  setB3('moon', moonS, `${Math.round(sep(bodies.moon.az, bodies.moon.el, moonS.az, moonS.el))}° from the ${bodies.phase.name} · ${owner(moonS.i)}`);
  setB3('rising', risS, risS.i >= 0 ? `${dirName(risS.az)} · el ${risS.el.toFixed(1)}° ↑ ${(risS.rate * 60).toFixed(1)}°/min · ${owner(risS.i)}` : 'nothing rising this second');
  // wheel bodies
  wheel.setBodies([
    { kind: 'sun', az: bodies.sun.az, el: bodies.sun.el, color: '#ffd166', label: 'Sun' }, { kind: 'moon', az: bodies.moon.az, el: bodies.moon.el, color: '#cfd8ff', label: 'Moon' },
    sunS.i >= 0 && { kind: 'sat', az: sunS.az, el: sunS.el, color: '#ffd166', label: sunS.name }, moonS.i >= 0 && { kind: 'sat', az: moonS.az, el: moonS.el, color: '#cfd8ff', label: moonS.name }, risS.i >= 0 && { kind: 'sat', az: risS.az, el: risS.el, color: '#7fd6ff', label: risS.name },
  ].filter(Boolean));
  // report copy (rebuilt every 60 s, or on demand)
  if (force || now - S.lastReportBuild > 60000 || (S.reportNoRising && risS.i >= 0)) {
    S.reportNoRising = risS.i < 0;
    const ratios = CATEGORIES.map(c => [c.key, cs[c.key].above / Math.max(0.6, cs[c.key].expected)]).sort((a, b) => b[1] - a[1]);
    const el4 = el.counts; const elem = Object.entries(el4).sort((a, b) => b[1] - a[1])[0][0];
    const nc = natalCopy(S.natal, S.birth);
    S.report = buildReport({ name: S.name, birth: S.birth, today: new Date().toISOString().slice(0, 10), orbitsLife: nc.orbitsLife ? nc.orbitsLife.toLocaleString() : 'many',
      sky: { above, total: S.N, sun: sunS, moon: { ...moonS, phase: bodies.phase.name, illum: bodies.phase.illuminated }, rising: risS, dominant: ratios[0][0], element: elem, tNext: fmtT(now + 90000), tNext2: fmtT(now + 7 * 60000) },
      cats: cs, counts: { routine: cs.routine.above, social: cs.social.above, work: cs.work.above } });
    renderReport(S.report, nc, el); S.lastReportBuild = now;
  }
  renderMeters(cs); renderElements(el); renderTransits();
}
// A single pass over the catalog per tick, feeding everything that used to walk the
// array separately: horizon count, orbit-class histogram, the satellites nearest the
// Sun and Moon, the rising pick, and the rise/set lists. One scan instead of six.
const scan = { above: 0, fire: 0, air: 0, earth: 0, water: 0, sunIdx: -1, sunSep: 1e9, moonIdx: -1, moonSep: 1e9, risingIdx: -1, risingEl: 99, rising: [], setting: [], at: 0 };
function analyse(bodies) {
  const cur = S.cur, N = S.N, ecc = S.ecc;
  const sunAz = bodies.sun.az * D2R, sunEl = bodies.sun.el * D2R, moonAz = bodies.moon.az * D2R, moonEl = bodies.moon.el * D2R;
  const sinSunEl = Math.sin(sunEl), cosSunEl = Math.cos(sunEl), sinMoonEl = Math.sin(moonEl), cosMoonEl = Math.cos(moonEl);
  let above = 0, fire = 0, air = 0, earth = 0, water = 0;
  let sunIdx = -1, sunBest = -2, moonIdx = -1, moonBest = -2, risingIdx = -1, risingEl = 99;
  const rising = [], setting = [];
  const keepSun = S.hi.sun, keepMoon = S.hi.moon, keepRise = S.hi.rising;
  for (let i = 0, o = 0; i < N; i++, o += 7) {
    const alt = cur[o + 2]; if (alt < 0) continue;
    const el = cur[o + 4], rate = cur[o + 6];
    if (el > 0) {
      above++;
      const e = ecc[i];
      if (e > 0.25) water++; else if (alt < 2000) fire++; else if (alt > 35000 && alt < 36500) earth++; else air++;
      if (el < 12 && rate > 0.005 && el < risingEl) { risingEl = el; risingIdx = i; }
      if (el < 6 && rate < -0.002) setting.push(i, (el / -rate) | 0);
    } else if (el > -6 && rate > 0.002) rising.push(i, (-el / rate) | 0);
    // cosine of the angular separation from each body; bigger is closer
    const az = cur[o + 3] * D2R, elR = el * D2R, sinEl = Math.sin(elR), cosEl = Math.cos(elR);
    const cs = sinEl * sinSunEl + cosEl * cosSunEl * Math.cos(az - sunAz);
    if (cs > sunBest) { sunBest = cs; sunIdx = i; }
    const cm = sinEl * sinMoonEl + cosEl * cosMoonEl * Math.cos(az - moonAz);
    if (cm > moonBest) { moonBest = cm; moonIdx = i; }
  }
  // hysteresis: keep the current pick unless another is clearly closer, so labels stop flickering
  const stick = (keep, idx, best, cosBody) => { if (keep == null || keep < 0 || S.cur[keep * 7 + 2] < 0) return idx; return cosBody(keep) > best - 6e-4 ? keep : idx; };
  const cosTo = (bAz, bEl) => k => { const o = k * 7, elR = S.cur[o + 4] * D2R; return Math.sin(elR) * Math.sin(bEl * D2R) + Math.cos(elR) * Math.cos(bEl * D2R) * Math.cos(S.cur[o + 3] * D2R - bAz * D2R); };
  scan.above = above; scan.fire = fire; scan.air = air; scan.earth = earth; scan.water = water;
  scan.sunIdx = stick(keepSun, sunIdx, sunBest, cosTo(bodies.sun.az, bodies.sun.el));
  scan.moonIdx = stick(keepMoon, moonIdx, moonBest, cosTo(bodies.moon.az, bodies.moon.el));
  const keptRise = keepRise != null && keepRise >= 0 && cur[keepRise * 7 + 4] >= 0 && cur[keepRise * 7 + 4] < 12 && cur[keepRise * 7 + 6] > 0;
  scan.risingIdx = keptRise ? keepRise : risingIdx;
  scan.rising = rising; scan.setting = setting; scan.at = Date.now();
  return scan;
}
function countAbove() { return scan.above; }
function owner(i) { if (i < 0) return ''; const o = S.catalog.objects[i]; const m = { US: 'US', CIS: 'RU', PRC: 'CN', FR: 'FR', ESA: 'ESA', JPN: 'JP', IND: 'IN', UK: 'UK', GER: 'DE', CA: 'CA', IT: 'IT' }; return (o.o ? (m[o.o] || o.o) : '??') + (o.l ? ' · launched ' + o.l.slice(0, 4) : ''); }
function setB3(k, s, sub) { const b = $('#b3-' + k); if (b.textContent !== s.name) { b.textContent = s.name; b.classList.remove('changed'); void b.offsetWidth; b.classList.add('changed'); } $('#b3-' + k + '-sub').textContent = sub; }

function renderReport(r, nc, el) {
  $('#rep-name').textContent = (S.name ? S.name + ' · ' : '') + `born ${S.birth.date} · formerly a ${r.zodiac}`;
  $('#glance').textContent = r.glance;
  $('#do').innerHTML = r.dos.map(t => `<li>${esc(t)}</li>`).join(''); $('#dont').innerHTML = r.donts.map(t => `<li>${esc(t)}</li>`).join('');
  $('#cats').innerHTML = r.categories.map(c => `<div class="cat" data-key="${c.key}"><div class="cat-head"><div class="cat-title">${c.title}</div>${c.tag !== 'neutral' ? `<div class="cat-tag ${c.tag}">${c.tag}</div>` : ''}</div><div class="cat-ruler">ruled by ${c.ruler}</div><div class="cat-count"><span class="n">${c.above}</span><small>overhead · typical ${c.expected.toFixed(1)}</small></div><div class="cat-meter"><i style="width:0"></i><b style="left:50%"></b></div><div class="cat-line">${esc(c.line)}</div></div>`).join('');
  const mil = S.stats ? S.stats.above[S.groupIds.indexOf('military')] : 0;
  $('#shadow').textContent = `${mil} military satellite${mil === 1 ? '' : 's'} ${mil === 1 ? 'is' : 'are'} above you right now. ${mil ? 'They are not thinking about you. Probably.' : 'Enjoy it.'}`;
  // natal
  const objs = nc.list || [];
  let html = `<p class="serif">${esc(nc.lead)}</p>`;
  if (objs.length) html += `<p class="fine">Catalogued launches from ${nc.main ? nc.main.launch : ''} (source: CelesTrak SATCAT, ${S.natal.totalCatalogued.toLocaleString()} objects). Rocket bodies and debris count too. They were also there.</p>` + objs.slice(0, 12).map((o, i) => `<div class="natal-obj"><span class="idx">${String(i + 1).padStart(2, '0')}</span><span>${esc(prettyName(o.name))} <span class="dim">· ${esc(o.typeName)} · ${esc(o.ownerName)} · from ${esc(o.siteName)}</span></span><span class="st ${o.decay ? '' : 'alive'}">${o.decay ? 'decayed ' + o.decay : 'still in orbit'}</span></div>`).join('') + (objs.length > 12 ? `<p class="fine natal-more">…and ${objs.length - 12} more, mostly debris. Same.</p>` : '');
  $('#natal-body').innerHTML = html;
}
function renderMeters(cs) { for (const c of CATEGORIES) { const d = cs[c.key]; const card = document.querySelector(`.cat[data-key="${c.key}"]`); if (!card) continue; card.querySelector('.n').textContent = d.above; const ratio = d.above / Math.max(0.6, d.expected); card.querySelector('.cat-meter i').style.width = Math.min(100, ratio * 50) + '%'; } }
function renderElements(el) {
  const map = [['fire', 'Fire', 'Low Earth Orbit'], ['air', 'Air', 'Medium Earth Orbit'], ['earth', 'Earth', 'Geostationary'], ['water', 'Water', 'Eccentric orbits']];
  const n = Math.max(1, el.n); const box = $('#elements');
  if (!box.children.length) box.innerHTML = map.map(([k, t, s]) => `<div data-el="${k}"><div class="el-name">${t}</div><div class="el-val">0%</div><div class="el-bar"><i></i></div><div class="el-sub">${s}</div></div>`).join('');
  for (const [k] of map) { const pct = Math.round(100 * el.counts[k] / n); const d = box.querySelector(`[data-el="${k}"]`); d.querySelector('.el-val').textContent = pct + '%'; d.querySelector('.el-bar i').style.width = pct + '%'; }
}
function renderTransits() {
  const cur = S.cur;
  const pairs = flat => { const out = []; for (let k = 0; k < flat.length; k += 2) out.push([flat[k], flat[k + 1]]); return out; };
  const rising = pairs(scan.rising), setting = pairs(scan.setting);
  rising.sort((a, b) => a[1] - b[1]); setting.sort((a, b) => a[1] - b[1]);
  const li = ([i, eta]) => `<li><span>${esc(prettyName(S.names[i]))} <span class="dim">· ${dirName(cur[i * 7 + 3])}</span></span><span>${eta < 60 ? Math.round(eta) + ' s' : Math.round(eta / 60) + ' min'}</span></li>`;
  $('#rising').innerHTML = rising.slice(0, 6).map(li).join('') || '<li><span class="dim">nothing within reach</span></li>';
  $('#setting').innerHTML = setting.slice(0, 6).map(li).join('') || '<li><span class="dim">nothing leaving</span></li>';
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---------- ISS reality check (1 request / 60 s, only while the report is on screen) ----------
let issTimer = null;
async function pollIss(immediate) {
  if (issTimer) clearTimeout(issTimer);
  if (S.reportShown && S.issIdx >= 0) {
    try {
      let r;
      if (STATIC) { const res = await fetch(URLS.iss); const t = res.ok ? await res.json() : null; r = { telemetry: t, rateLimitRemaining: res.headers.get('x-rate-limit-remaining'), lastError: res.ok ? null : 'HTTP ' + res.status }; }
      else r = await (await fetch(URLS.iss)).json();
      S.issTelemetry = r;
      const t = r.telemetry;
      if (t) {
        // compare at the telemetry's own timestamp: the ISS moves ~7.7 km every second
        const d = new Date(t.timestamp * 1000); const pv = satellite.propagate(satrecFor(S.issIdx), d); const gmst = satellite.gstime(d); const geo = satellite.eciToGeodetic(pv.position, gmst);
        const pLat = geo.latitude * 180 / Math.PI, pLon = geo.longitude * 180 / Math.PI, pAlt = geo.height;
        const dGround = haversine(t.latitude, t.longitude, pLat, pLon) * (6371 + t.altitude) / 6371;
        const dAlt = Math.abs(t.altitude - pAlt); const age = Math.round((Date.now() / 1000 - t.timestamp));
        $('#iss-body').innerHTML = `<div><div class="k">Δ along track</div><div class="v">${dGround.toFixed(1)} km</div></div><div><div class="k">Δ altitude</div><div class="v">${dAlt.toFixed(2)} km</div></div><div><div class="k">Telemetry age</div><div class="v">${age} s</div></div><div class="fine" style="grid-column:1/-1">At ${d.toISOString().slice(11, 19)} UTC — propagated: ${pLat.toFixed(2)}°, ${pLon.toFixed(2)}°, ${pAlt.toFixed(0)} km · telemetry: ${t.latitude.toFixed(2)}°, ${t.longitude.toFixed(2)}°, ${t.altitude.toFixed(0)} km · ${dGround < 25 ? 'The universe agrees with us to within a city.' : 'A disagreement of note. Mercury is probably retrograde too.'} · quota left: ${r.rateLimitRemaining ?? '?'}/350 per 5 min</div>`;
      } else $('#iss-body').innerHTML = `<div class="fine" style="grid-column:1/-1">Telemetry unavailable (${esc(r.lastError || 'no data')}). We remain confident.</div>`;
    } catch { }
  }
  issTimer = setTimeout(pollIss, 60000);
}
function haversine(a1, o1, a2, o2) { const R = 6371, d = Math.PI / 180; const dA = (a2 - a1) * d, dO = (o2 - o1) * d; const h = Math.sin(dA / 2) ** 2 + Math.cos(a1 * d) * Math.cos(a2 * d) * Math.sin(dO / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }


// ---------- data status (every 5 min) ----------
async function refreshStatus() {
  try {
    const st = await (await fetch(URLS.status)).json(); if (STATIC) st.now = Date.now(); S.status = st;
    const ages = Object.values(st.groups).filter(g => g.fetchedAt).map(g => st.now - g.fetchedAt); const oldest = Math.max(...ages) / 3600000;
    $('#datastate').textContent = `${st.catalog.count.toLocaleString()} objects · elements ≤ ${oldest.toFixed(1)} h old`;
    $('#livedot').classList.toggle('stale', oldest > 6);
    const rows = Object.entries(st.groups).map(([id, g]) => `<tr><td>${esc(g.label)}</td><td>${g.count.toLocaleString()}</td><td>${g.fetchedAt ? ago(st.now - g.fetchedAt) + ' ago' : '—'}</td><td>${g.nextRefreshAt ? 'in ' + ago(g.nextRefreshAt - st.now) : 'pending'}</td><td>${g.lastError ? esc(g.lastError) : g.cooldownUntil ? 'backing off' : 'ok'}</td></tr>`).join('');
    $('#method-body').innerHTML = `<table><tr><th>CelesTrak group</th><th>objects</th><th>fetched</th><th>next fetch</th><th>state</th></tr>${rows}<tr><td>SATCAT (launch dates)</td><td>${(st.satcat.bytes / 1e6).toFixed(1)} MB</td><td>${st.satcat.fetchedAt ? ago(st.now - st.satcat.fetchedAt) + ' ago' : '—'}</td><td>${st.satcat.nextRefreshAt ? 'in ' + ago(st.satcat.nextRefreshAt - st.now) : 'pending'}</td><td>${st.satcat.lastError ? esc(st.satcat.lastError) : 'ok'}</td></tr></table><p>Upstream requests are serialized with ${st.spacingMs / 1000} s spacing, cached on disk for ${st.gpTtlMs / 3600000} h (elements) / ${st.satcatTtlMs / 3600000} h (SATCAT), served with ETag + max-age so reloads cost nothing, and exponentially backed off on any error. ISS telemetry is fetched at most once per 30 s server-side and once per minute per open report.</p>${STATIC ? '<p>This copy is hosted statically: a scheduled GitHub Action does the fetching every 3 hours and publishes the files above; your browser only reads them (plus one ISS telemetry request per minute).</p>' : ''}`;
  } catch { }
  setTimeout(refreshStatus, 5 * 60000);
}
function ago(ms) { const m = Math.round(Math.abs(ms) / 60000); return m < 1 ? 'now' : m < 60 ? m + ' min' : (Math.abs(ms) / 3600000).toFixed(1) + ' h'; }


// ---------- natal lookup: server endpoint, or static per-year shards ----------
const natalShardCache = new Map();
async function natalShard(year) {
  if (!natalShardCache.has(year)) natalShardCache.set(year, fetch(`data/natal/${year}.json`).then(r => r.ok ? r.json() : null).catch(() => null));
  return natalShardCache.get(year);
}
async function fetchNatal(date) {
  if (!STATIC) return (await fetch('api/natal?date=' + date)).json();
  const base = new Date(date + 'T00:00:00Z'); let total = 0, fetchedAt = null;
  for (let d = 0; d <= 400; d++) for (const sign of d === 0 ? [0] : [-1, 1]) {
    const day = new Date(base.getTime() + sign * d * 86400000).toISOString().slice(0, 10);
    const sh = await natalShard(day.slice(0, 4)); if (!sh) continue; total = sh.total; fetchedAt = sh.fetchedAt;
    const list = sh.byDate[day]; if (list && list.length) return { date: day, offsetDays: sign * d, objects: list, satcatFetchedAt: fetchedAt, totalCatalogued: total };
  }
  return { date: null, offsetDays: null, objects: [], satcatFetchedAt: fetchedAt, totalCatalogued: total };
}
