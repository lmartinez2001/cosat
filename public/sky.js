// Shared data pipeline: catalog loading (live server or static files), the
// propagation worker, and per-frame interpolation. Used by the Shorts feed.
export const PRESETS = [['Paris', 48.8566, 2.3522], ['London', 51.5072, -0.1276], ['New York', 40.7128, -74.006], ['Los Angeles', 34.0522, -118.2437], ['São Paulo', -23.5505, -46.6333], ['Mexico City', 19.4326, -99.1332], ['Lagos', 6.5244, 3.3792], ['Nairobi', -1.2921, 36.8219], ['Cairo', 30.0444, 31.2357], ['Berlin', 52.52, 13.405], ['Madrid', 40.4168, -3.7038], ['Reykjavik', 64.1466, -21.9426], ['Moscow', 55.7558, 37.6173], ['Mumbai', 19.076, 72.8777], ['Singapore', 1.3521, 103.8198], ['Tokyo', 35.6762, 139.6503], ['Seoul', 37.5665, 126.978], ['Sydney', -33.8688, 151.2093], ['Auckland', -36.8485, 174.7633], ['Honolulu', 21.3069, -157.8583]];
const TZ_GUESS = { 'Europe/Paris': 'Paris', 'Europe/London': 'London', 'America/New_York': 'New York', 'America/Los_Angeles': 'Los Angeles', 'America/Sao_Paulo': 'São Paulo', 'America/Mexico_City': 'Mexico City', 'Africa/Lagos': 'Lagos', 'Africa/Nairobi': 'Nairobi', 'Africa/Cairo': 'Cairo', 'Europe/Berlin': 'Berlin', 'Europe/Madrid': 'Madrid', 'Atlantic/Reykjavik': 'Reykjavik', 'Europe/Moscow': 'Moscow', 'Asia/Kolkata': 'Mumbai', 'Asia/Singapore': 'Singapore', 'Asia/Tokyo': 'Tokyo', 'Asia/Seoul': 'Seoul', 'Australia/Sydney': 'Sydney', 'Pacific/Auckland': 'Auckland', 'Pacific/Honolulu': 'Honolulu' };
export const DOMAINS = ['social', 'routine', 'money', 'spirit', 'work', 'mind', 'love', 'self', 'change', 'shadow'];
export const DOMAIN_COLORS = { social: '#a09d95', routine: '#7fd6ff', money: '#ffd166', spirit: '#b8a5ff', work: '#8de0a5', mind: '#ff9de2', love: '#ff7b7b', self: '#ffffff', change: '#ffb36b', shadow: '#666' };
const GROUP_PRIORITY = ['stations', 'science', 'weather', 'iridium-NEXT', 'globalstar', 'planet', 'spire', 'gps-ops', 'galileo', 'glo-ops', 'beidou', 'geo', 'last-30-days', 'amateur', 'military', 'oneweb', 'starlink'];

export function guessObserver() {
  try { const saved = JSON.parse(localStorage.getItem('cosat-form') || 'null'); if (saved && saved.lat != null) return { lat: +saved.lat, lon: +saved.lon, name: saved.name || '', bdate: saved.bdate || null, city: null }; } catch { }
  const city = TZ_GUESS[Intl.DateTimeFormat().resolvedOptions().timeZone] || 'London'; const p = PRESETS.find(x => x[0] === city);
  return { lat: p[1], lon: p[2], name: '', bdate: null, city };
}

// Published builds carry a content hash in a meta tag; the dev server does not.
export async function detectStatic() { return !!document.querySelector('meta[name="cosat-build"]'); }

export async function loadSky({ observer, onTick, onProgress }) {
  const STATIC = await detectStatic();
  const url = STATIC ? 'data/catalog.json' : 'api/catalog';
  let cat = null;
  for (let attempt = 0; !cat; attempt++) {
    onProgress?.(attempt ? `waiting for orbital elements… (retry ${attempt})` : 'loading orbital elements…');
    try { const r = await fetch(url); if (r.ok) cat = await r.json(); } catch { }
    if (!cat) await new Promise(res => setTimeout(res, Math.min(15000, 2000 * (attempt + 1))));
  }
  const N = cat.objects.length; const groupIds = cat.groups.map(g => g.id); const domainOfGroup = Object.fromEntries(cat.groups.map(g => [g.id, g.domain]));
  const sky = { STATIC, catalog: cat, N, groupIds, objects: cat.objects, names: new Array(N), domainIdx: new Uint8Array(N), ecc: new Float32Array(N), inc: new Float32Array(N), cur: new Float32Array(N * 7).fill(-99), fa: null, ta: 0, fb: null, tb: 0, stats: null, issIdx: -1, observer, worker: null };
  cat.objects.forEach((o, i) => { const g = GROUP_PRIORITY.find(p => o.g.includes(p)) || o.g[0]; sky.domainIdx[i] = DOMAINS.indexOf(domainOfGroup[g] || 'social'); sky.ecc[i] = o.ec; sky.inc[i] = o.in; sky.names[i] = o.n; if (o.c === 25544) sky.issIdx = i; });
  const w = new Worker('worker.js'); sky.worker = w;
  w.onmessage = e => { const m = e.data; if (m.type === 'tick') { sky.fa = sky.fb; sky.ta = sky.tb; sky.fb = m.pos; sky.tb = m.t; sky.stats = m.stats; if (!sky.fa) sky.cur.set(sky.fb); onTick?.(sky); } };
  w.postMessage({ type: 'init', objects: cat.objects, groups: groupIds, observer });
  sky.setObserver = o => { sky.observer = o; sky.fa = sky.fb = null; w.postMessage({ type: 'observer', observer: o }); };
  sky.lerp = now => {
    const cur = sky.cur; if (!sky.fb) return; if (!sky.fa) { cur.set(sky.fb); return; }
    const f = Math.max(0, Math.min(1.5, (now - 1000 - sky.ta) / Math.max(1, sky.tb - sky.ta))); const a = sky.fa, b = sky.fb;
    for (let i = 0; i < N * 7; i += 7) {
      if (b[i + 2] < 0 || a[i + 2] < 0) { for (let k = 0; k < 7; k++) cur[i + k] = b[i + k]; continue; }
      cur[i] = a[i] + (b[i] - a[i]) * f; let dl = b[i + 1] - a[i + 1]; if (dl > 180) dl -= 360; else if (dl < -180) dl += 360; cur[i + 1] = a[i + 1] + dl * f;
      cur[i + 2] = a[i + 2] + (b[i + 2] - a[i + 2]) * f; let da = b[i + 3] - a[i + 3]; if (da > 180) da -= 360; else if (da < -180) da += 360; cur[i + 3] = a[i + 3] + da * f;
      cur[i + 4] = a[i + 4] + (b[i + 4] - a[i + 4]) * f; cur[i + 5] = a[i + 5] + (b[i + 5] - a[i + 5]) * f; cur[i + 6] = b[i + 6];
    }
  };
  const satrecs = new Map();
  sky.satrec = i => { if (!satrecs.has(i)) { const o = cat.objects[i]; satrecs.set(i, satellite.json2satrec({ OBJECT_NAME: o.n, OBJECT_ID: o.i, EPOCH: o.e, MEAN_MOTION: o.mm, ECCENTRICITY: o.ec, INCLINATION: o.in, RA_OF_ASC_NODE: o.ra, ARG_OF_PERICENTER: o.ap, MEAN_ANOMALY: o.ma, NORAD_CAT_ID: o.c, BSTAR: o.bs, MEAN_MOTION_DOT: o.nd, MEAN_MOTION_DDOT: o.ndd })); } return satrecs.get(i); };
  // ground track (lat, lon, alt) for ±minutes around now
  sky.track = (i, minutes, steps = 40) => { const rec = sky.satrec(i), pts = []; for (let k = 0; k <= steps; k++) { const d = new Date(Date.now() + (-minutes + 2 * minutes * k / steps) * 60000); let pv; try { pv = satellite.propagate(rec, d); } catch { continue; } if (!pv || !pv.position || typeof pv.position !== 'object') continue; const geo = satellite.eciToGeodetic(pv.position, satellite.gstime(d)); pts.push([geo.latitude * 180 / Math.PI, geo.longitude * 180 / Math.PI, geo.height]); } return pts; };
  return sky;
}

export const OWNER_SHORT = { US: 'the US', CIS: 'Russia', PRC: 'China', FR: 'France', ESA: 'ESA', JPN: 'Japan', IND: 'India', UK: 'the UK', GER: 'Germany', CA: 'Canada', IT: 'Italy', SES: 'SES', ITSO: 'Intelsat', EUME: 'EUMETSAT', EUTE: 'Eutelsat', IRID: 'Iridium', GLOB: 'Globalstar', O3B: 'O3b', KOR: 'South Korea', SKOR: 'South Korea', ISS: 'the ISS partners', ORB: 'Orbcomm', ARGN: 'Argentina', BRAZ: 'Brazil', AUS: 'Australia', TWN: 'Taiwan', TURK: 'Turkey', ISRA: 'Israel', SPN: 'Spain', NETH: 'the Netherlands', SWED: 'Sweden', NOR: 'Norway', LUXE: 'Luxembourg', UAE: 'the UAE', SAUD: 'Saudi Arabia', THAI: 'Thailand', INDO: 'Indonesia', TBD: 'someone who will not say', AB: 'Arabsat', IM: 'Inmarsat', SING: 'Singapore', NZ: 'New Zealand', MEX: 'Mexico', KAZ: 'Kazakhstan', QAT: 'Qatar', FIN: 'Finland', POL: 'Poland', BEL: 'Belgium', DEN: 'Denmark', SWTZ: 'Switzerland', UKR: 'Ukraine', IRAN: 'Iran', PAKI: 'Pakistan', EGYP: 'Egypt', NIG: 'Nigeria', SAFR: 'South Africa', ALG: 'Algeria', MA: 'Morocco', VTNM: 'Vietnam', PHL: 'the Philippines', MALA: 'Malaysia', BGD: 'Bangladesh', LTU: 'Lithuania', EST: 'Estonia', CZCH: 'Czechia', HUN: 'Hungary', GREC: 'Greece', POR: 'Portugal', ASRA: 'Austria', IRL: 'Ireland', CHLE: 'Chile', PERU: 'Peru', COL: 'Colombia', URY: 'Uruguay', KEN: 'Kenya', RWA: 'Rwanda', ETH: 'Ethiopia', MNG: 'Mongolia', NPL: 'Nepal', ARM: 'Armenia', AZER: 'Azerbaijan', BELA: 'Belarus', SEAL: 'Sea Launch', AC: 'AsiaSat', ABS: 'ABS', NATO: 'NATO', NKOR: 'North Korea', CUB: 'Cuba', ROM: 'Romania', BGR: 'Bulgaria', SRB: 'Serbia', SVN: 'Slovenia', SVK: 'Slovakia', HRV: 'Croatia', LVA: 'Latvia', ISL: 'Iceland', MLT: 'Malta', CYP: 'Cyprus', JOR: 'Jordan', KWT: 'Kuwait', BHR: 'Bahrain', OMN: 'Oman', LAOS: 'Laos', KHM: 'Cambodia', MMR: 'Myanmar', BTN: 'Bhutan', LKA: 'Sri Lanka', TUN: 'Tunisia', SDN: 'Sudan', ANG: 'Angola', GHA: 'Ghana', ZWE: 'Zimbabwe', UGA: 'Uganda', MUS: 'Mauritius', CRI: 'Costa Rica', GUAT: 'Guatemala', ECU: 'Ecuador', BOL: 'Bolivia', PRY: 'Paraguay', VENZ: 'Venezuela', MCO: 'Monaco', MDA: 'Moldova', GEO: 'Georgia', TTO: 'Trinidad and Tobago', DJI: 'Djibouti', MDG: 'Madagascar', IRAQ: 'Iraq', SYR: 'Syria' };
export const SITE_SHORT = { AFETR: 'Cape Canaveral', AFWTR: 'Vandenberg', KSCUT: 'Kennedy Space Center', TYMSC: 'Baikonur', PLMSC: 'Plesetsk', VOSTO: 'Vostochny', FRGUI: 'Kourou', TAISC: 'Taiyuan', XICLF: 'Xichang', JSC: 'Jiuquan', WENCH: 'Wenchang', SRILR: 'Sriharikota', TANSC: 'Tanegashima', KSCUK: 'Uchinoura', WLPIS: 'Wallops', KODAK: 'Kodiak', RLLB: 'Mahia', SEAL: 'a Sea Launch platform', DLS: 'Dombarovsky', KYMSC: 'Kapustin Yar', SVOBO: 'Svobodny', NSC: 'Naro', SEMLS: 'Semnan', YAVNE: 'Palmachim', ERAS: 'an aircraft over the Atlantic', WRAS: 'an aircraft over the Pacific', SUBL: 'a submarine', SMTS: 'Sohae', SCSLA: 'a ship in the Yellow Sea', HAIYA: 'a ship at sea', ANDOY: 'Andøya', ESRAN: 'Esrange', KWAJ: 'Kwajalein', OMELON: 'Omelek Island', SPKII: 'Spaceport Cornwall', CAS: 'an aircraft over the Canaries', WOMRA: 'Woomera', SNMLP: 'San Marco', HGSTR: 'Hammaguir', OREN: 'Orenburg', SADOL: 'Sary Shagan' };
export const prettyName = n => n.replace(/\s*\[.*?\]\s*$/, '').replace(/\s*\(.*\)$/, '').replace(/^STARLINK-/, 'Starlink-').replace(/^ONEWEB-/, 'OneWeb-').replace(/^GALILEO-/, 'Galileo-').replace(/^NAVSTAR/, 'Navstar').replace(/^COSMOS/, 'Cosmos').replace(/^METEOSAT/, 'Meteosat').replace(/^FLOCK/, 'Flock');
export const dirName = az => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(az / 45) % 8];
