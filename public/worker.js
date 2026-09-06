// Propagation worker. Receives the catalog once, then every TICK ms propagates
// every object with SGP4 (satellite.js) and reports, per object:
//   lat, lon, alt(km), az, el, range(km), elevation rate (deg/s)
// plus per-group visibility statistics. All maths happens here, on the
// client, so no network traffic is needed for live positions.
importScripts('vendor/satellite.min.js');

const TICK = 1000;
let recs = [], meta = [], observer = null, timer = null;
let prevEl = null, prevT = 0;
let groupIds = [];

function setObserver(o) {
  observer = { latitude: o.lat * Math.PI / 180, longitude: o.lon * Math.PI / 180, height: (o.alt || 0) / 1000 };
  // "Ring" of comparison observers at the same latitude, every 45° of longitude,
  // used to normalise counts (how crowded is *your* sky vs. a typical sky at your latitude).
  ring = [];
  for (let k = 1; k < 8; k++) ring.push({ latitude: observer.latitude, longitude: observer.longitude + k * Math.PI / 4, height: observer.height });
}
let ring = [];

function propagateAll() {
  const now = new Date();
  const t = now.getTime();
  const gmst = satellite.gstime(now);
  const N = recs.length;
  const out = new Float32Array(N * 7);
  const dt = prevT ? (t - prevT) / 1000 : 0;
  const G = groupIds.length;
  const above = new Int32Array(G), high = new Int32Array(G), ringAbove = new Float32Array(G);
  let bad = 0;
  for (let i = 0; i < N; i++) {
    const r = recs[i];
    let pv;
    try { pv = satellite.propagate(r, now); } catch { pv = null; }
    const o = i * 7;
    if (!pv || !pv.position || typeof pv.position !== 'object') { out[o + 4] = -99; out[o + 2] = -1; bad++; continue; }
    const ecf = satellite.eciToEcf(pv.position, gmst);
    const geo = satellite.eciToGeodetic(pv.position, gmst);
    const la = satellite.ecfToLookAngles(observer, ecf);
    const el = la.elevation * 180 / Math.PI;
    out[o] = geo.latitude * 180 / Math.PI; out[o + 1] = geo.longitude * 180 / Math.PI; out[o + 2] = geo.height;
    out[o + 3] = ((la.azimuth * 180 / Math.PI) % 360 + 360) % 360; out[o + 4] = el; out[o + 5] = la.rangeSat;
    out[o + 6] = prevEl && dt > 0 && prevEl[i] > -90 ? (el - prevEl[i]) / dt : 0;
    const gs = meta[i].gi;
    if (el > 0) for (const gi of gs) { above[gi]++; if (el > 30) high[gi]++; }
    for (const obs of ring) { if (satellite.ecfToLookAngles(obs, ecf).elevation > 0) for (const gi of gs) ringAbove[gi] += 1 / ring.length; }
  }
  // keep only the elevations (the big buffer is transferred and becomes unusable here)
  if (!prevEl || prevEl.length !== N) prevEl = new Float32Array(N);
  for (let i = 0; i < N; i++) prevEl[i] = out[i * 7 + 4];
  prevT = t;
  postMessage({ type: 'tick', t, pos: out, stats: { above: Array.from(above), high: Array.from(high), ringAvg: Array.from(ringAbove), bad } }, [out.buffer]);
}

onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    groupIds = m.groups;
    const gindex = Object.fromEntries(groupIds.map((g, i) => [g, i]));
    recs = []; meta = [];
    for (const o of m.objects) {
      try {
        recs.push(satellite.json2satrec({ OBJECT_NAME: o.n, OBJECT_ID: o.i, EPOCH: o.e, MEAN_MOTION: o.mm, ECCENTRICITY: o.ec, INCLINATION: o.in, RA_OF_ASC_NODE: o.ra, ARG_OF_PERICENTER: o.ap, MEAN_ANOMALY: o.ma, NORAD_CAT_ID: o.c, BSTAR: o.bs, MEAN_MOTION_DOT: o.nd, MEAN_MOTION_DDOT: o.ndd }));
        meta.push({ gi: o.g.map(g => gindex[g]) });
      } catch { /* skip unparseable */ }
    }
    setObserver(m.observer);
    prevEl = null; prevT = 0;
    if (timer) clearInterval(timer);
    propagateAll();
    timer = setInterval(propagateAll, TICK);
    postMessage({ type: 'ready', count: recs.length });
  } else if (m.type === 'observer') {
    setObserver(m.observer); prevEl = null; prevT = 0; propagateAll();
  }
};
