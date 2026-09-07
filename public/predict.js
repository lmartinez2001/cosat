// Prediction worker.
//
// Everything expensive and one-off lives here so the 60 fps render loop and the
// 1 Hz propagation worker are never blocked: visible-pass search, satellite-to-
// satellite close approaches, and orbital plane geometry.
//
// A "visible pass" is the real thing, not just "above the horizon": the satellite
// must be in sunlight while the observer is in darkness, which is why satellites
// are seen just after dusk and before dawn and not at midnight.
importScripts('vendor/satellite.min.js');

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const R_EARTH = 6378.137;         // equatorial, matches satellite.js earth radius
const ATMOSPHERE = 100;           // km of atmosphere that still blocks sunlight

// --- low-precision solar position, good to a fraction of a degree ---
function sunEci(date) {
  const jd = date.getTime() / 86400000 + 2440587.5, n = jd - 2451545.0;
  const L = (280.460 + 0.9856474 * n) * D2R;
  const g = (357.528 + 0.9856003 * n) * D2R;
  const lon = L + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 0.0000004 * n) * D2R;
  return { x: Math.cos(lon), y: Math.cos(eps) * Math.sin(lon), z: Math.sin(eps) * Math.sin(lon) };
}
// Sun elevation at the observer, in degrees.
function sunElevation(date, gmst, latRad, lonRad) {
  const s = sunEci(date);
  const ra = Math.atan2(s.y, s.x), dec = Math.asin(s.z);
  const h = gmst + lonRad - ra;
  return Math.asin(Math.sin(latRad) * Math.sin(dec) + Math.cos(latRad) * Math.cos(dec) * Math.cos(h)) * R2D;
}
// Is the satellite in sunlight? Cylindrical shadow model with an atmospheric margin.
function sunlit(posEci, date) {
  const s = sunEci(date);
  const proj = posEci.x * s.x + posEci.y * s.y + posEci.z * s.z;
  if (proj > 0) return true;                       // on the day side of the terminator plane
  const r2 = posEci.x * posEci.x + posEci.y * posEci.y + posEci.z * posEci.z;
  return Math.sqrt(Math.max(0, r2 - proj * proj)) > R_EARTH + ATMOSPHERE;
}

function satrecOf(o) {
  return satellite.json2satrec({ OBJECT_NAME: o.n, OBJECT_ID: o.i, EPOCH: o.e, MEAN_MOTION: o.mm, ECCENTRICITY: o.ec, INCLINATION: o.in, RA_OF_ASC_NODE: o.ra, ARG_OF_PERICENTER: o.ap, MEAN_ANOMALY: o.ma, NORAD_CAT_ID: o.c, BSTAR: o.bs, MEAN_MOTION_DOT: o.nd, MEAN_MOTION_DDOT: o.ndd });
}
// look angles + eci position in one propagation
function sample(rec, date, obs) {
  const pv = satellite.propagate(rec, date);
  if (!pv || !pv.position || typeof pv.position !== 'object') return null;
  const gmst = satellite.gstime(date);
  const la = satellite.ecfToLookAngles(obs, satellite.eciToEcf(pv.position, gmst));
  return { el: la.elevation * R2D, az: ((la.azimuth * R2D) % 360 + 360) % 360, range: la.rangeSat, pos: pv.position, gmst };
}

// Adaptive stepping: crawl only when the satellite is near the horizon, stride when
// it is on the far side of the planet. Cuts a week-long search by roughly 5x.
function stepFor(el) { return el < -35 ? 300_000 : el < -8 ? 60_000 : 15_000; }

function findPasses({ obj, observer, days = 7, minEl = 10, needVisible = true, limit = 8 }) {
  const rec = satrecOf(obj);
  const obs = { latitude: observer.lat * D2R, longitude: observer.lon * D2R, height: (observer.alt || 0) / 1000 };
  const latRad = obs.latitude, lonRad = obs.longitude;
  const t0 = Date.now(), tEnd = t0 + days * 86400_000;
  const out = []; let t = t0, prev = null, steps = 0;

  while (t < tEnd && out.length < limit) {
    const d = new Date(t), s = sample(rec, d, obs); steps++;
    if (!s) { t += 60_000; continue; }
    if (prev && prev.el < minEl && s.el >= minEl) {
      // refine the rise moment, then walk the pass at fine resolution
      let lo = t - stepFor(prev.el), hi = t;
      for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2; const m = sample(rec, new Date(mid), obs); if (m && m.el >= minEl) hi = mid; else lo = mid; }
      const riseAt = hi;
      let peak = { el: -90 }, peakAt = riseAt, tt = riseAt, last = null, anyLit = false, anyDark = false;
      while (tt < tEnd) {
        const dd = new Date(tt), m = sample(rec, dd, obs); steps++;
        if (!m) break;
        if (m.el < minEl && tt > riseAt + 20_000) { last = { t: tt, ...m }; break; }
        if (m.el > peak.el) { peak = m; peakAt = tt; }
        const lit = sunlit(m.pos, dd), dark = sunElevation(dd, m.gmst, latRad, lonRad) < -6;
        if (lit) anyLit = true; if (dark) anyDark = true;
        if (lit && dark) { m.visibleHere = true; if (!peak.visibleAt || m.el > peak.el) peak.visibleAt = tt; }
        tt += 5_000;
      }
      const peakDate = new Date(peakAt);
      const peakSun = sunElevation(peakDate, peak.gmst || satellite.gstime(peakDate), latRad, lonRad);
      const litAtPeak = peak.pos ? sunlit(peak.pos, peakDate) : false;
      const visible = litAtPeak && peakSun < -6;
      if (!needVisible || visible) {
        out.push({ rise: riseAt, peak: peakAt, set: last ? last.t : tt, maxEl: +peak.el.toFixed(1), azRise: null, azPeak: +peak.az.toFixed(0), range: Math.round(peak.range), visible, sunElAtPeak: +peakSun.toFixed(1), sunlitAtPeak: litAtPeak, anyLit, anyDark });
      }
      t = (last ? last.t : tt) + 60_000; prev = null; continue;
    }
    prev = s; t += stepFor(s.el);
  }
  return { passes: out, steps };
}

// Closest approach between two satellites over the next `hours`, sampled coarsely
// then refined. Distances are real, in kilometres.
function closeApproach({ a, b, hours = 72 }) {
  const ra = satrecOf(a), rb = satrecOf(b);
  const t0 = Date.now(), tEnd = t0 + hours * 3600_000;
  const dist = t => {
    const d = new Date(t);
    const pa = satellite.propagate(ra, d), pb = satellite.propagate(rb, d);
    if (!pa?.position || !pb?.position || typeof pa.position !== 'object' || typeof pb.position !== 'object') return null;
    const dx = pa.position.x - pb.position.x, dy = pa.position.y - pb.position.y, dz = pa.position.z - pb.position.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  let best = Infinity, bestT = null;
  for (let t = t0; t < tEnd; t += 60_000) { const v = dist(t); if (v != null && v < best) { best = v; bestT = t; } }
  if (bestT == null) return null;
  for (let span = 30_000; span >= 500; span /= 2) {           // refine around the minimum
    for (const t of [bestT - span, bestT + span]) { const v = dist(t); if (v != null && v < best) { best = v; bestT = t; } }
  }
  return { km: Math.round(best), at: bestT };
}

// Angle between two orbital planes, from the orbit normals. Two planes that are not
// identical always intersect along a line, so the paths always cross: only the angle
// and the timing differ.
function planeGeometry({ a, b }) {
  const norm = o => { const i = o.in * D2R, r = o.ra * D2R; return { x: Math.sin(r) * Math.sin(i), y: -Math.cos(r) * Math.sin(i), z: Math.cos(i) }; };
  const na = norm(a), nb = norm(b);
  const dot = Math.max(-1, Math.min(1, na.x * nb.x + na.y * nb.y + na.z * nb.z));
  return { angle: +(Math.acos(dot) * R2D).toFixed(1) };
}

onmessage = e => {
  const { id, type, payload } = e.data;
  let result = null, error = null;
  try {
    if (type === 'passes') result = findPasses(payload);
    else if (type === 'approach') result = closeApproach(payload);
    else if (type === 'planes') result = planeGeometry(payload);
  } catch (err) { error = String(err && err.message || err); }
  postMessage({ id, type, result, error });
};
