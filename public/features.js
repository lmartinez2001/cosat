// The three rituals: go outside, watch it die, compare orbits.
//
// All three run off the same real data the rest of the app uses, and all three
// push their heavy maths into the prediction worker so the render loop never
// stutters. Nothing here is invented: every number shown is either propagated
// from current orbital elements or read from the catalogue.
const D2R = Math.PI / 180;
const MU = 398600.4418, R_EARTH = 6371;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = n => String(n).padStart(2, '0');
const altitudeOf = mm => { const n = mm * 2 * Math.PI / 86400; return Math.cbrt(MU / (n * n)) - R_EARTH; };
const fmtLocal = ms => new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtClock = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtDate = d => new Date(d).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------- prediction worker, promise-wrapped ----------
let worker = null, seq = 0; const pending = new Map();
function predictor() {
  if (!worker) {
    worker = new Worker('predict.js');
    worker.onmessage = e => { const { id, result, error } = e.data; const p = pending.get(id); if (!p) return; pending.delete(id); error ? p.reject(new Error(error)) : p.resolve(result); };
  }
  return worker;
}
function ask(type, payload) {
  const id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); predictor().postMessage({ id, type, payload }); });
}

// ---------- shared context, injected by app.js ----------
let ctx = null;                       // { S, prettyName, dirName, ownerShort, fetchNatal }
const state = { guardian: null, passes: [], nextPass: null, timer: null, history: null, natal: null, birth: null, aiming: false };

export function initFeatures(context) {
  ctx = context;
  $('#add-cal').addEventListener('click', downloadIcs);
  $('#saw-it').addEventListener('click', () => logSighting('manual'));
  $('#aim-btn').addEventListener('click', toggleAiming);
  $('#compat-form').addEventListener('submit', onCompatSubmit);
  window.addEventListener('cosat:tonight', () => drawArc());
  window.addEventListener('cosat:fate', () => buildMortality());
  window.addEventListener('resize', () => { if (state.nextPass) drawArc(); });
  window.addEventListener('hashchange', applyCompatLink);
}

// ---------- guardian selection ----------
// The object launched on your birthday is usually dead. The guardian is the one
// still in orbit that comes closest to it, preferring an exact date, then the same
// day of the year in another year, then simply the nearest launch.
let launchIndex = null;
function buildLaunchIndex() {
  if (launchIndex) return launchIndex;
  const byDate = new Map(), byMonthDay = new Map(), all = [];
  ctx.S.catalog.objects.forEach((o, i) => {
    if (!o.l) return;
    all.push(i);
    if (!byDate.has(o.l)) byDate.set(o.l, []);
    byDate.get(o.l).push(i);
    const md = o.l.slice(5);
    if (!byMonthDay.has(md)) byMonthDay.set(md, []);
    byMonthDay.get(md).push(i);
  });
  launchIndex = { byDate, byMonthDay, all };
  return launchIndex;
}
function guardianCandidates(birthDate) {
  const idx = buildLaunchIndex(), objs = ctx.S.catalog.objects;
  const bt = Date.parse(birthDate + 'T00:00:00Z');
  const rank = list => list.map(i => ({ i, days: Math.round(Math.abs(Date.parse(objs[i].l + 'T00:00:00Z') - bt) / 86400000) }));
  let pool = [], kind = '';
  if (idx.byDate.has(birthDate)) { pool = rank(idx.byDate.get(birthDate)); kind = 'exact'; }
  else if (idx.byMonthDay.has(birthDate.slice(5))) { pool = rank(idx.byMonthDay.get(birthDate.slice(5))); kind = 'birthday'; }
  else {
    // nearest launch date overall: scan once, keep the best handful
    pool = rank(idx.all).sort((a, b) => a.days - b.days).slice(0, 40); kind = 'nearest';
  }
  // Prefer something you can actually go and watch: a payload, in low orbit (geostationary
  // satellites never rise or set, so there is no appointment to keep), large enough to be
  // visible, and launched as near your birthday as possible.
  const score = c => {
    const o = objs[c.i], alt = altitudeOf(+o.mm);
    const type = o.t === 'PAY' ? 0 : o.t === 'R/B' ? 1 : 2;
    const regime = alt < 2000 ? 0 : alt < 30000 ? 1 : 2;
    return regime * 1e9 + type * 1e7 + c.days * 100 - Math.min(9, o.r || 0) * 20;
  };
  pool.sort((a, b) => score(a) - score(b));
  // If nothing from your birthday is in low orbit, there is no pass to keep, so offer the
  // nearest low-orbit objects as alternatives rather than a satellite you can never watch.
  const isLow = c => altitudeOf(+objs[c.i].mm) < 2000;
  if (!pool.some(isLow)) {
    const low = rank(idx.all.filter(i => objs[i].t === 'PAY' && altitudeOf(+objs[i].mm) < 2000)).sort((a, b) => a.days - b.days).slice(0, 4);
    pool = pool.slice(0, 2).concat(low);
  }
  return { kind, list: pool.slice(0, 6) };
}
function pickGuardian(birthDate) {
  const saved = +localStorage.getItem('cosat-guardian') || 0;
  const cands = guardianCandidates(birthDate);
  const objs = ctx.S.catalog.objects;
  let chosen = cands.list[0];
  if (saved) { const k = objs.findIndex(o => o.c === saved); if (k >= 0) chosen = { i: k, days: Math.round(Math.abs(Date.parse(objs[k].l + 'T00:00:00Z') - Date.parse(birthDate + 'T00:00:00Z')) / 86400000) }; }
  return { ...chosen, kind: cands.kind, candidates: cands.list };
}

// ---------- section 1: go outside ----------
export async function buildRitual(birth, natal) {
  state.birth = birth; state.natal = natal;
  if (!ctx.S.catalog) return;
  state.guardian = pickGuardian(birth.date);
  renderGuardian();
  await requestPasses();
  renderLogbook();
  buildMortality();
}
function guardianObj() { return state.guardian ? ctx.S.catalog.objects[state.guardian.i] : null; }

function renderGuardian() {
  const g = guardianObj(); if (!g) return;
  const d = state.guardian.days;
  const rel = state.guardian.kind === 'exact' ? 'launched on the day you were born'
    : state.guardian.kind === 'birthday' ? `launched on your birthday, ${plural(Math.round(d / 365.25), 'year')} ${Date.parse(g.l) > Date.parse(state.birth.date) ? 'after' : 'before'} you`
      : `the nearest survivor, launched ${d < 400 ? plural(d, 'day') : plural(Math.round(d / 365.25), 'year')} from your birthday`;
  $('#guardian-box').innerHTML = `<span class="g-name">${esc(ctx.prettyName(g.n))}</span><span class="g-meta">${esc(rel)} · ${esc(ctx.ownerShort(g.o))} · ${esc(g.l)}</span><button type="button" class="g-swap" id="g-swap">choose another</button>`;
  $('#g-swap').onclick = renderGuardianChoices;
}
function renderGuardianChoices() {
  const objs = ctx.S.catalog.objects, cur = ctx.S.cur;
  const html = state.guardian.candidates.map(c => {
    const o = objs[c.i], alt = cur[c.i * 7 + 2];
    return `<button type="button" data-i="${c.i}"><span>${esc(ctx.prettyName(o.n))}</span><span class="gc-meta">${esc(o.l)} · ${esc(ctx.ownerShort(o.o))} · ${alt > 0 ? Math.round(alt) + ' km' : 'below'}</span></button>`;
  }).join('');
  const box = document.createElement('div'); box.className = 'g-choices'; box.innerHTML = html;
  $('#guardian-box').after(box);
  box.querySelectorAll('button').forEach(b => b.onclick = async () => {
    const i = +b.dataset.i; state.guardian = { ...state.guardian, i, days: state.guardian.candidates.find(c => c.i === i).days };
    localStorage.setItem('cosat-guardian', String(ctx.S.catalog.objects[i].c));
    box.remove(); renderGuardian(); await requestPasses(); buildMortality();
  });
}

async function requestPasses() {
  const g = guardianObj(); if (!g) return;
  const box = $('#pass-main'); box.innerHTML = '<div class="pass-none">Searching the next week of orbits…</div>';
  const observer = { lat: ctx.S.observer.lat, lon: ctx.S.observer.lon, alt: 0 };
  let res = await ask('passes', { obj: g, observer, days: 10, minEl: 10, needVisible: true, limit: 6 }).catch(() => null);
  let visibleOnly = true;
  if (!res || !res.passes.length) { res = await ask('passes', { obj: g, observer, days: 3, minEl: 10, needVisible: false, limit: 6 }).catch(() => null); visibleOnly = false; }
  state.passes = res ? res.passes : []; state.visibleOnly = visibleOnly;
  state.nextPass = state.passes[0] || null;
  renderPass(); try { drawArc(); } catch { } renderPassList();
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(tickCountdown, 1000);
  tickCountdown();
}

function brightnessHint(g, pass) {
  if (pass && !pass.visible) return 'in daylight or in shadow, so not visible to the eye';
  const rcs = g.r;                                  // radar cross-section in m², when the catalogue has one
  if (rcs != null) return rcs > 5 ? 'large object, usually an easy naked-eye point of light' : rcs > 1 ? 'medium object, visible on a clear night away from streetlights' : 'small object, faint; binoculars help';
  const grp = g.g || [];
  if (grp.includes('stations')) return 'a space station, brighter than any star in the sky';
  if (grp.includes('starlink') || grp.includes('oneweb')) return 'a flat-panel comms satellite, normally an easy naked-eye point of light';
  if (grp.includes('iridium-NEXT') || grp.includes('globalstar')) return 'a comms satellite, usually visible to the naked eye';
  if (grp.includes('planet') || grp.includes('spire')) return 'a shoebox-sized imager, faint; binoculars help';
  if (g.t === 'R/B') return 'a spent rocket stage, big and often easy to see';
  return 'no size on file; look for a steady moving point that never blinks';
}
function renderPass() {
  const box = $('#pass-main'), g = guardianObj();
  if (!state.nextPass) {
    const o = state.guardian.i * 7, el = ctx.S.cur[o + 4], alt = ctx.S.cur[o + 2];
    const geo = alt > 30000;
    box.innerHTML = geo && el > 0
      ? `<div class="pass-none"><b>${esc(ctx.prettyName(g.n))} never rises and never sets.</b> It is ${Math.round(alt).toLocaleString()} km up, turning at exactly the speed of the ground, so from where you stand it simply hangs at ${el.toFixed(1)}° above your ${esc(ctx.dirName(ctx.S.cur[o + 3]))} horizon, permanently. There is no appointment to keep: it is already there, and it will be there tomorrow. Too far to see with the eye. Pick a low-orbit guardian above if you want one you can actually watch move.</div>`
      : geo ? `<div class="pass-none"><b>${esc(ctx.prettyName(g.n))} is below your horizon and will stay there.</b> It is geostationary, parked over a longitude you cannot see from your latitude. Choose a low-orbit guardian above for one that comes to you.</div>`
        : `<div class="pass-none">No pass over you in the next ten days. ${esc(ctx.prettyName(g.n))} is in an orbit that misses your latitude, which is its problem, not yours. Choose another guardian above.</div>`;
    $('#teaser').hidden = true; return;
  }
  const p = state.nextPass;
  const dur = Math.round((p.set - p.rise) / 1000);
  box.innerHTML = `<div class="pass-count" id="pass-countdown">—</div>
    <div class="pass-when">${esc(fmtLocal(p.rise))}</div>
    <div class="pass-facts">
      <span>rises <b>${esc(ctx.dirName(p.azPeak))}</b></span>
      <span>peaks <b>${p.maxEl}°</b> up</span>
      <span>lasts <b>${dur < 90 ? dur + ' s' : Math.round(dur / 60) + ' min'}</b></span>
      <span>range <b>${p.range} km</b></span>
      <span>sun <b>${p.sunElAtPeak}°</b></span>
    </div>
    <div class="fine">${state.visibleOnly ? 'Sunlit satellite, dark sky: this one is actually visible.' : 'Nothing visible in the next ten days, so this is the next pass overhead regardless of light.'} ${esc(brightnessHint(g, p))}.</div>`;
  const t = $('#teaser'); t.hidden = false;
  t.textContent = `↓ ${ctx.prettyName(g.n)} crosses your sky ${fmtLocal(p.rise)} — go outside`;
}
function tickCountdown() {
  const el = $('#pass-countdown');
  if (!state.nextPass) { setBadge(null); return; }
  const ms = state.nextPass.rise - Date.now();
  window.__nextPassIn = ms;
  let s = Math.round(ms / 1000);
  if (s < -600) { requestPasses(); return; }                    // pass is over: find the next one
  if (s < 0) { if (el) el.textContent = 'HAPPENING NOW · LOOK UP'; setBadge(ms); return; }
  const d = Math.floor(s / 86400); let r = s - d * 86400;
  const h = Math.floor(r / 3600); r -= h * 3600;
  const m = Math.floor(r / 60), sec = r - m * 60;
  if (el) el.textContent = `IN ${d ? d + 'd ' : ''}${pad(h)}:${pad(m)}:${pad(sec)}`;
  setBadge(ms);
}
// The tab badge is the whole retention idea in one glyph: a real countdown to a real
// event, visible from every screen, that nobody wrote by hand.
function setBadge(ms) {
  const badge = $('#tab-badge'), banner = $('#imminent');
  if (!badge) return;
  if (ms == null) { badge.hidden = true; if (banner) banner.hidden = true; return; }
  const g = guardianObj();
  const mins = ms / 60000;
  badge.hidden = false;
  badge.classList.toggle('now', ms < 0);
  badge.textContent = ms < 0 ? 'NOW' : mins < 60 ? Math.max(1, Math.round(mins)) + 'm' : mins < 1440 ? Math.round(mins / 60) + 'h' : Math.round(mins / 1440) + 'd';
  if (banner) {
    const soon = ms < 30 * 60000;
    banner.hidden = !soon;
    if (soon) banner.innerHTML = ms < 0
      ? `<b>${esc(ctx.prettyName(g.n))} is crossing your sky now.</b> Look ${esc(ctx.dirName(state.nextPass.azPeak))}, ${state.nextPass.maxEl}° up.`
      : `<b>${esc(ctx.prettyName(g.n))} rises in ${Math.max(1, Math.round(mins))} min.</b> Look ${esc(ctx.dirName(state.nextPass.azPeak))}. Tap to open.`;
  }
}

// A profile of the pass: elevation against compass direction, the way you would see it.
function drawArc() {
  const c = $('#pass-arc'); if (!c || !state.nextPass) return;
  const dpr = Math.min(2, devicePixelRatio || 1), w = c.clientWidth, h = Math.round(w / 2);
  if (w < 40) return;                       // the view is not on screen yet
  c.width = w * dpr; c.height = h * dpr;
  const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
  const pad = 26, gy = h - 20, R = Math.min((w - pad * 2) / 2, gy - 14);
  const cx = w / 2;
  x.strokeStyle = 'rgba(236,234,228,.5)'; x.lineWidth = 1;
  x.beginPath(); x.moveTo(pad, gy); x.lineTo(w - pad, gy); x.stroke();
  x.strokeStyle = 'rgba(236,234,228,.14)'; x.setLineDash([2, 4]);
  for (const el of [30, 60]) { x.beginPath(); x.arc(cx, gy, R * (90 - el) / 90 === 0 ? R : R * (1 - (90 - el) / 90) + R * 0, 0, 0); }
  x.setLineDash([]);
  // half-dome: horizon to horizon, elevation as height
  x.strokeStyle = 'rgba(236,234,228,.16)'; x.beginPath(); x.arc(cx, gy, R, Math.PI, 0); x.stroke();
  const p = state.nextPass;
  // approximate the visible arc: rise at the horizon, peak at max elevation, set at the horizon
  const peakX = cx, peakY = gy - R * (p.maxEl / 90);
  x.strokeStyle = '#ffd166'; x.lineWidth = 2; x.beginPath();
  x.moveTo(cx - R, gy); x.quadraticCurveTo(cx - R / 2, peakY - (gy - peakY) * .25, peakX, peakY);
  x.quadraticCurveTo(cx + R / 2, peakY - (gy - peakY) * .25, cx + R, gy); x.stroke();
  x.fillStyle = '#ffd166'; x.beginPath(); x.arc(peakX, peakY, 4, 0, 6.2832); x.fill();
  x.font = '10px "JetBrains Mono", monospace'; x.fillStyle = '#8a877f'; x.textAlign = 'center';
  x.fillText('horizon', cx - R, gy + 14); x.fillText('horizon', cx + R, gy + 14);
  x.fillStyle = '#ffd166'; x.fillText(`${p.maxEl}° · ${ctx.dirName(p.azPeak)}`, peakX, peakY - 10);
}
function renderPassList() {
  const list = $('#pass-list');
  if (!state.passes.length) { list.innerHTML = ''; return; }
  list.innerHTML = state.passes.slice(0, 5).map(p => `<li><span>${esc(fmtLocal(p.rise))}</span><span>${p.maxEl}° ${esc(ctx.dirName(p.azPeak))}${p.visible ? '' : ' · not visible'}</span></li>`).join('');
}

// ---------- calendar export: the app moves into their calendar ----------
function icsEscape(t) { return String(t).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n'); }
const icsTime = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function downloadIcs() {
  const g = guardianObj(); if (!g || !state.passes.length) return;
  const name = ctx.prettyName(g.n);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CO-SAT//Satellite passes//EN', 'CALSCALE:GREGORIAN'];
  for (const p of state.passes.slice(0, 5)) {
    lines.push('BEGIN:VEVENT', `UID:cosat-${g.c}-${Math.round(p.rise)}@cosat`, `DTSTAMP:${icsTime(Date.now())}`, `DTSTART:${icsTime(p.rise)}`, `DTEND:${icsTime(p.set)}`,
      `SUMMARY:${icsEscape('Look up: ' + name + ' crosses your sky')}`,
      `DESCRIPTION:${icsEscape(`Rises in the ${ctx.dirName(p.azPeak)}, peaks ${p.maxEl}° above the horizon, ${p.range} km away. ${brightnessHint(g, p)}. Computed by CO-SAT from current orbital elements.`)}`,
      'BEGIN:VALARM', 'TRIGGER:-PT10M', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(name + ' in 10 minutes. Go outside.')}`, 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `cosat-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-passes.ics`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  flash($('#add-cal'), `${Math.min(5, state.passes.length)} passes saved`);
}
function flash(btn, msg) { const old = btn.textContent; btn.textContent = msg; setTimeout(() => btn.textContent = old, 2200); }

// ---------- sighting log ----------
const readLog = () => { try { return JSON.parse(localStorage.getItem('cosat-log') || '[]'); } catch { return []; } };
function logSighting(how) {
  const g = guardianObj(); if (!g) return;
  const i = state.guardian.i, o = i * 7, cur = ctx.S.cur;
  const entry = { c: g.c, n: ctx.prettyName(g.n), at: Date.now(), el: +cur[o + 4].toFixed(1), az: +cur[o + 3].toFixed(0), how };
  const log = readLog(); log.unshift(entry); localStorage.setItem('cosat-log', JSON.stringify(log.slice(0, 200)));
  renderLogbook(); flash($('#saw-it'), 'logged ✓');
}
function renderLogbook() {
  const log = readLog(), box = $('#logbook');
  if (!log.length) { box.innerHTML = `<p class="fine">Nothing logged yet. When you actually see it, press “I saw it”. This is the only horoscope in the world that can be confirmed.</p>`; return; }
  const days = [...new Set(log.map(e => new Date(e.at).toDateString()))];
  let streak = 0; const d = new Date();
  for (; ; streak++) { if (!days.includes(d.toDateString())) break; d.setDate(d.getDate() - 1); }
  const sats = new Set(log.map(e => e.c)).size;
  box.innerHTML = `<div class="lb-stats">
      <div class="lb-stat"><b>${log.length}</b><span>confirmed</span></div>
      <div class="lb-stat"><b>${sats}</b><span>satellites seen</span></div>
      <div class="lb-stat"><b>${streak}</b><span>day streak</span></div>
      <div class="lb-stat"><b>${days.length}</b><span>nights out</span></div>
    </div>
    <ul class="lb-list">${log.slice(0, 5).map(e => `<li><span>${esc(e.n)}</span><span>${esc(fmtLocal(e.at))} · ${e.el}° ${esc(ctx.dirName(e.az))}${e.how === 'aim' ? ' · aimed' : ''}</span></li>`).join('')}</ul>`;
}

// ---------- point the phone at it ----------
let aimHandler = null;
async function toggleAiming() {
  if (state.aiming) return stopAiming();
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) { $('#aim').hidden = false; $('#aim-note').textContent = 'This device has no orientation sensors. Use the compass direction above, then press “I saw it”.'; return; }
  try { if (DOE.requestPermission) { const r = await DOE.requestPermission(); if (r !== 'granted') throw new Error('denied'); } }
  catch { $('#aim').hidden = false; $('#aim-note').textContent = 'Orientation access was declined. Use the compass direction above instead.'; return; }
  state.aiming = true; $('#aim').hidden = false; $('#aim-btn').textContent = '◎ stop aiming';
  aimHandler = ev => onOrientation(ev);
  window.addEventListener('deviceorientationabsolute', aimHandler, true);
  window.addEventListener('deviceorientation', aimHandler, true);
}
function stopAiming() {
  state.aiming = false; $('#aim-btn').textContent = '◎ Point my phone at it';
  window.removeEventListener('deviceorientationabsolute', aimHandler, true);
  window.removeEventListener('deviceorientation', aimHandler, true);
  $('#aim').hidden = true;
}
// Where is the back of the phone pointing? Rotate the device axis into the world frame.
function deviceAim(ev) {
  const a = (ev.alpha || 0) * D2R, b = (ev.beta || 0) * D2R, g = (ev.gamma || 0) * D2R;
  const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
  // R = Rz(alpha)Rx(beta)Ry(gamma) applied to the outward camera axis (0,0,-1)
  const x = -(cA * sG - sA * sB * cG), y = -(sA * sG + cA * sB * cG), z = -(cB * cG);
  const el = Math.asin(Math.max(-1, Math.min(1, -z))) / D2R;
  let az = Math.atan2(x, y) / D2R;
  if (typeof ev.webkitCompassHeading === 'number') az = ev.webkitCompassHeading + Math.atan2(x, y) / D2R - (360 - (ev.alpha || 0));
  return { az: ((az % 360) + 360) % 360, el };
}
function angularGap(az1, el1, az2, el2) {
  const c = Math.sin(el1 * D2R) * Math.sin(el2 * D2R) + Math.cos(el1 * D2R) * Math.cos(el2 * D2R) * Math.cos((az1 - az2) * D2R);
  return Math.acos(Math.max(-1, Math.min(1, c))) / D2R;
}
function onOrientation(ev) {
  const g = guardianObj(); if (!g) return;
  const o = state.guardian.i * 7, cur = ctx.S.cur;
  const target = { az: cur[o + 3], el: cur[o + 4] };
  const aim = deviceAim(ev);
  const gap = angularGap(aim.az, aim.el, target.az, target.el);
  drawAim(aim, target, gap);
  const note = $('#aim-note');
  if (target.el < 0) note.textContent = `${ctx.prettyName(g.n)} is ${Math.round(-target.el)}° below your horizon right now. Come back at the pass time.`;
  else if (gap < 12) { note.textContent = `ON TARGET · ${Math.round(gap)}° off. That is it.`; if (!state.aimLogged) { state.aimLogged = true; logSighting('aim'); } }
  else note.textContent = `${Math.round(gap)}° off · aim ${gap > 60 ? 'well ' : ''}${aim.el < target.el ? 'higher' : 'lower'} and toward ${ctx.dirName(target.az)}`;
}
function drawAim(aim, target, gap) {
  const c = $('#aim-canvas'); const dpr = Math.min(2, devicePixelRatio || 1), w = c.clientWidth;
  if (w < 40) return;
  c.width = c.height = w * dpr; const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, w);
  const cx = w / 2, cy = w / 2, R = w * 0.44;
  const place = (az, el) => { const r = R * (90 - Math.max(-10, el)) / 100; const a = az * D2R; return [cx - r * Math.sin(a), cy - r * Math.cos(a)]; };
  x.strokeStyle = 'rgba(236,234,228,.25)'; x.beginPath(); x.arc(cx, cy, R, 0, 6.2832); x.stroke();
  x.beginPath(); x.arc(cx, cy, R * 0.55, 0, 6.2832); x.stroke();
  x.font = '10px "JetBrains Mono", monospace'; x.fillStyle = '#8a877f'; x.textAlign = 'center';
  x.fillText('N', cx, cy - R - 6); x.fillText('S', cx, cy + R + 13); x.fillText('E', cx - R - 10, cy + 4); x.fillText('W', cx + R + 10, cy + 4);
  const [tx, ty] = place(target.az, target.el), [ax, ay] = place(aim.az, aim.el);
  x.strokeStyle = gap < 12 ? '#8de0a5' : '#ffd166'; x.lineWidth = 2; x.beginPath(); x.arc(tx, ty, 9, 0, 6.2832); x.stroke();
  x.fillStyle = x.strokeStyle; x.fillRect(tx - 2, ty - 2, 4, 4);
  x.strokeStyle = '#7fd6ff'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(ax - 7, ay); x.lineTo(ax + 7, ay); x.moveTo(ax, ay - 7); x.lineTo(ax, ay + 7); x.stroke();
}

// ---------- section 2: memento mori ----------
export function buildMortality() {
  const box = $('#mortality-body'); if (!box) return;
  const g = guardianObj(); if (!g) { box.innerHTML = ''; return; }
  const i = state.guardian.i, alt = ctx.S.cur[i * 7 + 2];
  const rec = g.h ? { f: g.h * 1000, m0: g.hm, l: Date.now(), m1: +g.mm } : null;   // baseline shipped with the catalogue
  const decay = decayEstimate(g, rec);
  const natalDead = state.natal && state.natal.objects && state.natal.objects.find(o => o.decay);
  let html = '';

  if (natalDead) {
    const lifeDays = Math.round((Date.parse(natalDead.decay) - Date.parse(natalDead.launch)) / 86400000);
    html += `<div class="memorial"><span class="m-lbl">Your natal satellite is gone</span>
      ${esc(ctx.prettyName(natalDead.name))}, launched ${esc(fmtDate(natalDead.launch))} by ${esc(natalDead.ownerName)}, re-entered the atmosphere on <b>${esc(fmtDate(natalDead.decay))}</b> after ${lifeDays < 400 ? plural(lifeDays, 'day') : plural(Math.round(lifeDays / 365.25), 'year')} in orbit. It burned up. Nothing was recovered. This is the normal outcome for things we put in the sky, and for most things generally.</div>`;
  }

  html += `<p class="decay-head">${esc(ctx.prettyName(g.n))} is falling out of the sky.</p>`;
  html += `<div class="decay-grid">
      <div><div class="dk">Altitude now</div><div class="dv">${alt > 0 ? Math.round(alt) + ' km' : '—'}</div><div class="ds">measured from its current orbit</div></div>
      <div><div class="dk">Sinking</div><div class="dv">${decay.rateText}</div><div class="ds">${esc(decay.method)}</div></div>
      <div><div class="dk">Time left</div><div class="dv">${decay.lifeText}</div><div class="ds">${esc(decay.lifeNote)}</div></div>
    </div>
    <canvas id="decay-chart"></canvas>
    <p class="fine">${esc(decay.copy)}</p>`;

  const gone = (ctx.S.catalog.gone || []).slice(0, 3);
  if (gone.length) {
    html += `<p class="inmem">In memoriam: ${gone.length} tracked object${gone.length === 1 ? '' : 's'} stopped appearing in the catalogue recently, last seen at ${gone.map(r => Math.round(r.alt) + ' km').join(', ')}. They came down while you were reading other things.</p>`;
  }
  box.innerHTML = html;
  drawDecayChart(g, rec, alt, decay);
}
// Two ways to know how fast something is coming down, in order of confidence:
// measure it ourselves across successive element sets, or read the drag term
// carried in today's elements.
function decayEstimate(g, rec) {
  const alt = altitudeOf(+g.mm);
  let kmPerDay = null, method = '', measured = false;
  if (rec && rec.l - rec.f > 6 * 3600e3 && rec.m1 !== rec.m0) {
    const days = (rec.l - rec.f) / 86400e3;
    kmPerDay = (altitudeOf(rec.m1) - altitudeOf(rec.m0)) / days;
    method = `measured over ${days < 2 ? Math.round(days * 24) + ' hours' : Math.round(days) + ' days'} of elements`;
    measured = true;
  } else {
    const n = +g.mm, dn = 2 * +g.nd;                 // rev/day², the drag term carried in the elements
    const a = Math.cbrt(MU / Math.pow(n * 2 * Math.PI / 86400, 2));
    kmPerDay = -(2 / 3) * (a / n) * dn;
    method = 'from the drag term in today’s elements';
  }
  const sinkMPerDay = -kmPerDay * 1000;
  const MEANINGFUL = 5;                              // m/day; below this the number is noise, not decay
  const maintained = (g.g || []).some(x => ['starlink', 'oneweb', 'gps-ops', 'galileo', 'glo-ops', 'beidou', 'geo', 'iridium-NEXT', 'globalstar'].includes(x));
  const rateText = sinkMPerDay >= MEANINGFUL ? (sinkMPerDay < 1000 ? Math.round(sinkMPerDay) + ' m/day' : (sinkMPerDay / 1000).toFixed(1) + ' km/day') : (sinkMPerDay <= -MEANINGFUL ? 'climbing' : 'holding');
  let lifeText, lifeNote, copy;

  if (alt > 30000) {
    lifeText = 'forever, near enough'; lifeNote = 'no atmosphere left to slow it down';
    copy = `${ctx.prettyName(g.n)} orbits ${Math.round(alt).toLocaleString()} km up, where there is effectively no air. It is not coming down. At the end of its working life it will be nudged a few hundred kilometres higher into a graveyard orbit and left there, intact, long after everyone who built it is gone.`;
  } else if (sinkMPerDay >= MEANINGFUL) {
    const days = (alt - 130) / (sinkMPerDay / 1000);
    lifeText = days < 90 ? plural(Math.round(days), 'day') : days < 900 ? plural(Math.round(days / 30.4), 'month') : days > 73000 ? 'centuries' : plural(Math.round(days / 365.25), 'year');
    lifeNote = 'at today’s rate; drag grows as it falls, so sooner';
    copy = `It is losing ${rateText}. At that rate ${ctx.prettyName(g.n)} reaches the top of the atmosphere in about ${lifeText}, and the real date is earlier than that, because the lower it gets the thicker the air and the faster it falls. It will not land. It will burn, most likely over an ocean, in daylight, watched by nobody. ${measured ? 'That rate was measured by comparing its orbit now against the first one we recorded.' : 'That rate comes from the drag term in its current elements, and sharpens as this page keeps watching it.'}`;
  } else if (maintained) {
    lifeText = 'held'; lifeNote = 'something is actively keeping it up';
    copy = `${ctx.prettyName(g.n)} is not falling, and that is the interesting part: at ${Math.round(alt)} km there is still enough air to drag it down, so it must be pushing back. Satellites in this constellation hold their altitude with thrusters. The day the fuel runs out, or the day someone decides it is finished, the pushing stops and the air wins. We do not put a date on that here, because the data cannot support one.`;
  } else {
    lifeText = 'not yet measurable'; lifeNote = 'we have not watched it long enough';
    copy = `${ctx.prettyName(g.n)} shows no clear sink yet. Either it is being held up, or this page has not watched it for long enough to see the sag. Its orbit is re-measured every three hours and compared against the first one we recorded, so this number gets sharper the longer you keep coming back.`;
  }
  return { kmPerDay, rateText, lifeText, lifeNote, copy, method, measured, alt };
}
function drawDecayChart(g, rec, altNow, decay) {
  const c = $('#decay-chart'); if (!c) return;
  const dpr = Math.min(2, devicePixelRatio || 1), w = c.clientWidth, h = 110;
  if (w < 40) return;
  c.width = w * dpr; c.height = h * dpr; const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
  const padL = 8, padR = 8, top = 14, bot = h - 20;
  const start = rec ? rec.f : Date.now() - 86400e3, end = Date.now();
  const a0 = rec ? altitudeOf(rec.m0) : altNow, a1 = altNow || (rec ? altitudeOf(rec.m1) : a0);
  // project forward a year so the slope is legible even when it is small
  const future = end + 365 * 86400e3;
  const aF = decay.kmPerDay < 0 ? Math.max(120, a1 + decay.kmPerDay * 365) : a1;
  const lo = Math.min(a0, a1, aF) - 2, hi = Math.max(a0, a1, aF) + 2;
  const px = t => padL + (w - padL - padR) * (t - start) / (future - start);
  const py = a => bot - (bot - top) * (a - lo) / Math.max(0.001, hi - lo);
  x.strokeStyle = 'rgba(236,234,228,.15)'; x.beginPath(); x.moveTo(padL, bot); x.lineTo(w - padR, bot); x.stroke();
  x.strokeStyle = 'rgba(236,234,228,.7)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(px(start), py(a0)); x.lineTo(px(end), py(a1)); x.stroke();
  x.setLineDash([3, 4]); x.strokeStyle = 'rgba(255,123,123,.75)'; x.beginPath(); x.moveTo(px(end), py(a1)); x.lineTo(px(future), py(aF)); x.stroke(); x.setLineDash([]);
  x.fillStyle = '#ECEAE4'; x.beginPath(); x.arc(px(end), py(a1), 3, 0, 6.2832); x.fill();
  x.font = '10px "JetBrains Mono", monospace'; x.fillStyle = '#8a877f'; x.textAlign = 'left';
  x.fillText(rec ? 'first seen ' + new Date(start).toLocaleDateString() : 'today', padL, h - 6);
  x.textAlign = 'right'; x.fillText('a year from now', w - padR, h - 6);
  x.textAlign = 'left'; x.fillStyle = '#ECEAE4'; x.fillText(Math.round(a1) + ' km', padL, top - 2);
}

// ---------- section 3: compatibility ----------
function periodMinutes(rec) { return rec.period || (rec.mm ? 1440 / +rec.mm : null); }
function meanAlt(rec) { if (rec.apogee != null && rec.perigee != null) return (rec.apogee + rec.perigee) / 2; if (rec.mm) return altitudeOf(+rec.mm); return null; }
function liveRecordFor(norad) { const i = ctx.S.catalog.objects.findIndex(o => o.c === norad); return i >= 0 ? { i, o: ctx.S.catalog.objects[i] } : null; }

async function onCompatSubmit(e) {
  e.preventDefault();
  const a = { name: $('#c-name-a').value.trim() || 'You', date: $('#c-date-a').value };
  const b = { name: $('#c-name-b').value.trim() || 'Them', date: $('#c-date-b').value };
  if (!a.date || !b.date) return;
  const btn = $('#compat-go'); btn.disabled = true; btn.textContent = 'Computing…';
  try { await renderCompat(a, b); } finally { btn.disabled = false; btn.textContent = 'Compare our orbits'; }
}
async function renderCompat(a, b) {
  const out = $('#compat-out');
  out.innerHTML = '<p class="fine">Looking up what was launched on both birthdays…</p>';
  const [na, nb] = await Promise.all([ctx.fetchNatal(a.date), ctx.fetchNatal(b.date)]);
  const pick = n => (n && n.objects && n.objects.length) ? (n.objects.find(o => o.type === 'PAY') || n.objects[0]) : null;
  const oa = pick(na), ob = pick(nb);
  if (!oa || !ob) { out.innerHTML = '<p class="fine">Nothing was launched anywhere near one of those dates. Orbitally speaking, one of you is unaccounted for.</p>'; return; }
  const liveA = liveRecordFor(oa.norad), liveB = liveRecordFor(ob.norad);
  const axes = [];

  // Rhythm: the periods are real, so the beat between them is too.
  const pa = periodMinutes(oa), pb = periodMinutes(ob);
  if (pa && pb) {
    const ratio = Math.max(pa, pb) / Math.min(pa, pb);
    const near = [1, 1.5, 2, 3].reduce((best, r) => Math.abs(ratio - r) < Math.abs(ratio - best) ? r : best, 1);
    const off = Math.abs(ratio - near);
    const synodic = Math.abs(1 / (1 / pa - 1 / pb));
    axes.push({ key: 'Rhythm', score: Math.round(100 * Math.max(0, 1 - off / 0.5)), value: ratio.toFixed(2) + ' : 1',
      note: `One orbit takes ${Math.round(pa)} minutes for ${a.name}, ${Math.round(pb)} for ${b.name}. ${isFinite(synodic) && synodic < 1e5 ? `You realign every ${synodic < 1440 ? Math.round(synodic) + ' minutes' : Math.round(synodic / 1440) + ' days'}.` : 'You almost never realign.'} ${off < 0.06 ? 'That is a resonance. You keep the same time without trying.' : off < 0.2 ? 'Close to a simple ratio: your rhythms rhyme, roughly.' : 'No resonance. One of you is always arriving as the other leaves.'}` });
  }
  // Alignment: inclination always, true plane angle when both are still up there.
  let planeAngle = null;
  if (liveA && liveB) { const g = await ask('planes', { a: liveA.o, b: liveB.o }).catch(() => null); if (g) planeAngle = g.angle; }
  const incGap = (oa.inc != null && ob.inc != null) ? Math.abs(oa.inc - ob.inc) : null;
  const angle = planeAngle != null ? planeAngle : incGap;
  if (angle != null) {
    axes.push({ key: 'Alignment', score: Math.round(100 * (1 - Math.min(angle, 180) / 180)), value: angle.toFixed(1) + '°',
      note: planeAngle != null ? `The real angle between your two orbital planes is ${angle.toFixed(1)}°. Two planes that are not identical always intersect, so you cross twice every revolution, whether or not you are there at the same moment.` : `Your orbits are inclined ${oa.inc}° and ${ob.inc}° to the equator, ${angle.toFixed(1)}° apart. One of the two is no longer in orbit, so this is the last angle it held.` });
  }
  // Altitude: how far apart you live.
  const aa = meanAlt(oa), ab = meanAlt(ob);
  if (aa && ab) {
    const ratio = Math.abs(Math.log10(aa / ab));
    axes.push({ key: 'Altitude', score: Math.round(100 * Math.max(0, 1 - ratio)), value: `${Math.round(aa)} vs ${Math.round(ab)} km`,
      note: ratio < 0.08 ? 'You occupy the same shell of space. Same air, same drag, same problems.' : ratio < 0.5 ? 'Different heights, same neighbourhood. One of you experiences noticeably more atmosphere.' : 'You live in different regimes entirely. One of you is fast and doomed, the other slow and distant.' });
  }
  // Origin.
  const sameOwner = oa.owner === ob.owner, sameSite = oa.site === ob.site;
  const rivals = new Set(['US|CIS', 'CIS|US', 'US|PRC', 'PRC|US']);
  const rival = rivals.has(oa.owner + '|' + ob.owner);
  axes.push({ key: 'Origin', score: sameOwner ? 100 : sameSite ? 80 : rival ? 30 : 50, value: sameOwner ? 'same programme' : rival ? 'rival programmes' : 'different',
    note: sameOwner ? `You were both put up by ${esc(oa.ownerName)}, probably on adjacent paperwork. Same institution, same assumptions, same acronyms.` : sameSite ? `Different programmes, but you both left the ground from ${esc(oa.siteName)}. You have heard the same countdown.` : rival ? `${oa.ownerName} and ${ob.ownerName} spent decades watching each other. You will get on fine, but neither of you will explain everything.` : `${oa.ownerName} and ${ob.ownerName}: unrelated programmes, unrelated goals, occasionally the same orbit.` });
  // Fate.
  const deadA = !!oa.decay, deadB = !!ob.decay;
  axes.push({ key: 'Fate', score: deadA && deadB ? 75 : deadA || deadB ? 55 : 95, value: deadA && deadB ? 'both gone' : deadA || deadB ? 'one still up' : 'both still up',
    note: deadA && deadB ? 'Both of your satellites have burned up. You are two ghosts comparing notes, which is a real kind of compatibility.' : deadA || deadB ? `${ctx.prettyName(deadA ? oa.name : ob.name)} came down on ${esc(fmtDate(deadA ? oa.decay : ob.decay))}. The other is still up there. One of you has already learned something the other has not.` : 'Both of your satellites are still in orbit. Nothing has been decided yet, for either of you.' });

  const weights = { Rhythm: 0.2, Alignment: 0.3, Altitude: 0.2, Origin: 0.15, Fate: 0.15 };
  const total = axes.reduce((s, x) => s + x.score * (weights[x.key] || 0.2), 0) / axes.reduce((s, x) => s + (weights[x.key] || 0.2), 0);
  const score = Math.round(total);
  const verdict = score >= 85 ? 'Two objects in near-identical orbits. You will spend years within sight of each other and still call it a coincidence.'
    : score >= 70 ? 'Compatible orbits with a real crossing angle. You meet often, at speed, and it works.'
      : score >= 55 ? 'Different planes, same planet. This takes fuel, and both of you have some.'
        : score >= 40 ? 'Your orbits intersect twice per revolution and you are almost never at the intersection together. Timing is the whole problem.'
          : 'Geometrically, this is a plane change. Plane changes are the most expensive manoeuvre in spaceflight. Not impossible. Expensive.';

  let approach = null;
  if (liveA && liveB && oa.norad !== ob.norad) approach = await ask('approach', { a: liveA.o, b: liveB.o, hours: 72 }).catch(() => null);

  out.innerHTML = `
    <div class="compat-score">
      <div class="cs-pair">${esc(a.name)} × ${esc(b.name)}</div>
      <div class="cs-num">${score}%</div>
      <div class="cs-verdict">${esc(verdict)}</div>
    </div>
    <div class="compat-pair">
      <div><div class="cp-who">${esc(a.name)} · ${esc(a.date)}</div><div class="cp-sat">${esc(ctx.prettyName(oa.name))}</div><div class="cp-meta">${esc(oa.ownerName)} · ${esc(oa.launch)}${oa.decay ? ' · re-entered ' + esc(oa.decay) : ' · still in orbit'}</div></div>
      <div><div class="cp-who">${esc(b.name)} · ${esc(b.date)}</div><div class="cp-sat">${esc(ctx.prettyName(ob.name))}</div><div class="cp-meta">${esc(ob.ownerName)} · ${esc(ob.launch)}${ob.decay ? ' · re-entered ' + esc(ob.decay) : ' · still in orbit'}</div></div>
    </div>
    <div class="compat-axes">${axes.map(x => `<div class="ax"><div class="ax-top"><span class="ax-name">${esc(x.key)}</span><span class="ax-val">${esc(x.value)}</span></div><div class="ax-bar"><i style="width:${x.score}%"></i></div><div class="ax-note">${x.note}</div></div>`).join('')}</div>
    ${approach ? `<p class="fine" style="margin-top:14px">Your two satellites come within <b>${approach.km.toLocaleString()} km</b> of each other on ${esc(fmtLocal(approach.at))}. That is the closest you get in the next three days, and it is a real number, computed from both orbits.</p>` : ''}
    <div class="compat-share"><button type="button" class="ghost" id="compat-copy">Copy our link</button></div>`;
  const link = `${location.origin}${location.pathname}#pair=${encodeURIComponent(a.date)},${encodeURIComponent(b.date)},${encodeURIComponent(a.name)},${encodeURIComponent(b.name)}`;
  $('#compat-copy').onclick = async () => { try { if (navigator.share) await navigator.share({ title: 'CO—SAT compatibility', text: `${a.name} × ${b.name}: ${score}%`, url: link }); else { await navigator.clipboard.writeText(link); flash($('#compat-copy'), 'copied ✓'); } } catch { } };
  history.replaceState(null, '', link);
}
export function applyCompatLink() {
  const m = /#pair=([^,]*),([^,]*)(?:,([^,]*))?(?:,([^,]*))?/.exec(location.hash);
  if (!m) return false;
  const [, da, db, na, nb] = m.map(x => x == null ? x : decodeURIComponent(x));
  $('#c-date-a').value = da; $('#c-date-b').value = db;
  if (na) $('#c-name-a').value = na; if (nb) $('#c-name-b').value = nb;
  renderCompat({ date: da, name: na || 'You' }, { date: db, name: nb || 'Them' });
  return true;
}
export function prefillCompat(birth, name) {
  if (!$('#c-date-a').value) $('#c-date-a').value = birth.date;
  if (!$('#c-name-a').value && name) $('#c-name-a').value = name;
}
export function featuresTick() {
  if (state.aiming) return;                       // the orientation handler drives its own redraw
}
