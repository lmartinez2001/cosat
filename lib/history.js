// Orbital decay history.
//
// Every object in low orbit is falling. Mean motion (revolutions per day) rises
// as an orbit shrinks, so by sampling it over time we can measure how fast a
// satellite is coming down, and estimate when it will burn up.
//
// Keeping a full time series for 13,000 objects would be megabytes, so we store
// a fixed-size summary per object: the first sample we ever saw, the most recent
// one, and how many samples went between them. That is all a decay rate needs,
// it never grows, and it survives across builds in data/cache.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'cache', 'history.json');
const MIN_SAMPLE_GAP_MS = 6 * 60 * 60 * 1000;   // don't record more than 4 samples a day
const FORGET_GONE_AFTER_MS = 180 * 24 * 60 * 60 * 1000;

const MU = 398600.4418, R_EARTH = 6371;
// mean motion (rev/day) -> semi-major axis altitude (km)
const altitudeOf = mm => { const n = mm * 2 * Math.PI / 86400; return Math.cbrt(MU / (n * n)) - R_EARTH; };

const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; } };
const log = (...a) => console.log(new Date().toISOString(), '[history]', ...a);

// objects: catalog records ({ c: noradId, mm: meanMotion, n: name })
function update(objects) {
  const prev = read() || { objects: {}, gone: {} };
  const now = Date.now();
  const out = { updatedAt: now, objects: {}, gone: { ...prev.gone } };
  const present = new Set();

  for (const o of objects) {
    const id = o.c, mm = +o.mm;
    if (!Number.isFinite(mm) || mm <= 0) continue;
    present.add(id);
    delete out.gone[id];                         // it is back (or never left)
    const old = prev.objects[id];
    if (!old) { out.objects[id] = { f: now, m0: mm, l: now, m1: mm, n: 1 }; continue; }
    // keep the original baseline; refresh the latest sample at most every few hours
    if (now - old.l >= MIN_SAMPLE_GAP_MS) out.objects[id] = { f: old.f, m0: old.m0, l: now, m1: mm, n: (old.n || 1) + 1 };
    else out.objects[id] = old;
  }

  // Anything we tracked before and cannot see now has most likely re-entered.
  let newlyGone = 0;
  for (const [id, rec] of Object.entries(prev.objects)) {
    if (present.has(+id)) continue;
    if (!out.gone[id]) { out.gone[id] = { lastSeen: rec.l, altAtEnd: +altitudeOf(rec.m1).toFixed(1) }; newlyGone++; }
    if (now - out.gone[id].lastSeen < FORGET_GONE_AFTER_MS) out.objects[id] = rec;   // keep its history a while
  }
  for (const [id, g] of Object.entries(out.gone)) if (now - g.lastSeen > FORGET_GONE_AFTER_MS) { delete out.gone[id]; delete out.objects[id]; }

  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(out));
  const withRate = Object.values(out.objects).filter(r => r.l - r.f >= MIN_SAMPLE_GAP_MS).length;
  log(`${Object.keys(out.objects).length} tracked · ${withRate} with a measurable sink rate · ${Object.keys(out.gone).length} gone (${newlyGone} new)`);
  return out;
}

module.exports = { update, read, altitudeOf, MIN_SAMPLE_GAP_MS };
