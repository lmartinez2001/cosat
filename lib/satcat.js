// SATCAT index: launch dates, owners, object types for every catalogued object.
// Parsed once per download into two indexes: by NORAD id (to enrich the live
// catalog) and by launch date (for "natal" lookups).
const OWNERS = {
  US: 'the United States', CIS: 'the Soviet Union / Russia', PRC: 'China', FR: 'France', JPN: 'Japan', IND: 'India', UK: 'the United Kingdom',
  ESA: 'the European Space Agency', GER: 'Germany', CA: 'Canada', IT: 'Italy', ITSO: 'Intelsat', ORB: 'Orbcomm', SES: 'SES', GLOB: 'Globalstar',
  IRID: 'Iridium', O3B: 'O3b', EUME: 'EUMETSAT', EUTE: 'Eutelsat', ISRO: 'India', KOR: 'South Korea', ISS: 'the International Space Station partners',
  NATO: 'NATO', ARGN: 'Argentina', BRAZ: 'Brazil', AUS: 'Australia', TWN: 'Taiwan', TURK: 'Turkey', IRAN: 'Iran', ISRA: 'Israel', SKOR: 'South Korea',
  NKOR: 'North Korea', SPN: 'Spain', NETH: 'the Netherlands', SWED: 'Sweden', NOR: 'Norway', LUXE: 'Luxembourg', UAE: 'the United Arab Emirates',
  SAUD: 'Saudi Arabia', SAFR: 'South Africa', THAI: 'Thailand', INDO: 'Indonesia', MALA: 'Malaysia', PAKI: 'Pakistan', EGYP: 'Egypt', NIG: 'Nigeria',
  TBD: 'an undisclosed party', SEAL: 'Sea Launch', AB: 'the Arab Satellite Communications Organization', IM: 'Inmarsat', ASRA: 'Austria',
  BEL: 'Belgium', CHLE: 'Chile', CZCH: 'the Czech Republic', DEN: 'Denmark', FIN: 'Finland', GREC: 'Greece', HUN: 'Hungary', POL: 'Poland',
  POR: 'Portugal', SWTZ: 'Switzerland', UKR: 'Ukraine', VENZ: 'Venezuela', VTNM: 'Vietnam', PHL: 'the Philippines', SING: 'Singapore', NZ: 'New Zealand',
  MEX: 'Mexico', COL: 'Colombia', PERU: 'Peru', BOL: 'Bolivia', KAZ: 'Kazakhstan', BELA: 'Belarus', AZER: 'Azerbaijan', ALG: 'Algeria', MA: 'Morocco',
  QAT: 'Qatar', BGD: 'Bangladesh', LTU: 'Lithuania', EST: 'Estonia', LKA: 'Sri Lanka', RWA: 'Rwanda', KEN: 'Kenya', GHA: 'Ghana', ETH: 'Ethiopia',
  SDN: 'Sudan', TUN: 'Tunisia', ANG: 'Angola', PRY: 'Paraguay', URY: 'Uruguay', ECU: 'Ecuador', CRI: 'Costa Rica', GUAT: 'Guatemala', MCO: 'Monaco',
  IRL: 'Ireland', SVN: 'Slovenia', SVK: 'Slovakia', BGR: 'Bulgaria', ROM: 'Romania', HRV: 'Croatia', SRB: 'Serbia', LAOS: 'Laos', MNG: 'Mongolia',
  NPL: 'Nepal', MMR: 'Myanmar', KHM: 'Cambodia', BTN: 'Bhutan', JOR: 'Jordan', KWT: 'Kuwait', BHR: 'Bahrain', OMN: 'Oman', ARM: 'Armenia', GEO: 'Georgia',
  MDA: 'Moldova', LVA: 'Latvia', ISL: 'Iceland', MLT: 'Malta', CYP: 'Cyprus', ZWE: 'Zimbabwe', UGA: 'Uganda', MUS: 'Mauritius', TTO: 'Trinidad and Tobago',
  AC: 'AsiaSat', RASC: 'RascomStar', STCT: 'Singapore/Taiwan', NICO: 'New ICO', GRSA: 'Globalstar', RP: 'the Philippines', CHBZ: 'China/Brazil', FGER: 'France/Germany',
  FRIT: 'France/Italy', USBZ: 'the US/Brazil', ABS: 'Asia Broadcast Satellite', EUTE2: 'Eutelsat', IRAQ: 'Iraq', SYR: 'Syria', CUB: 'Cuba', DJI: 'Djibouti', MDG: 'Madagascar',
};
const SITES = {
  AFETR: 'Cape Canaveral', AFWTR: 'Vandenberg', KSCUT: 'Kennedy Space Center', TYMSC: 'Baikonur', PLMSC: 'Plesetsk', VOSTO: 'Vostochny', SVOBO: 'Svobodny',
  KYMSC: 'Kapustin Yar', DLS: 'Dombarovsky', FRGUI: 'Kourou', TAISC: 'Taiyuan', XICLF: 'Xichang', JSC: 'Jiuquan', WENCH: 'Wenchang', SRILR: 'Sriharikota',
  TANSC: 'Tanegashima', KSCUK: 'Kagoshima / Uchinoura', WLPIS: 'Wallops Island', KODAK: 'Kodiak', RLLB: 'Mahia (Rocket Lab)', SEAL: 'the Sea Launch platform',
  OREN: 'Orenburg', SNMLP: 'San Marco', HGSTR: 'Hammaguir', WOMRA: 'Woomera', NSC: 'Naro', SEMLS: 'Semnan', YAVNE: 'Palmachim', ERAS: 'a converted airliner',
  WRAS: 'a converted airliner (west)', SUBL: 'a submarine', YUN: 'Yunsong', SMTS: 'Sohae', SCSLA: 'a sea platform in the Yellow Sea', HAIYA: 'a sea platform', 
  CAS: 'Canary Islands (air launch)', WSC: 'Wenchang', VOSTO2: 'Vostochny', SADOL: 'Sary Shagan', SPKII: 'Spaceport Cornwall', ANDOY: 'Andøya', ESRAN: 'Esrange', KWAJ: 'Kwajalein', OMELON: 'Kwajalein (Omelek)',
};
const TYPES = { PAY: 'payload', 'R/B': 'rocket body', DEB: 'debris', UNK: 'unknown object' };

function parse(csv) {
  const lines = csv.split('\n');
  const header = lines[0].trim().split(',');
  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  const byNorad = new Map();
  const byLaunch = new Map();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]; if (!line) continue;
    const f = line.split(',');
    if (f.length < header.length) continue;
    const rec = {
      name: f[col.OBJECT_NAME], intl: f[col.OBJECT_ID], norad: +f[col.NORAD_CAT_ID], type: f[col.OBJECT_TYPE], ops: f[col.OPS_STATUS_CODE],
      owner: f[col.OWNER], launch: f[col.LAUNCH_DATE], site: f[col.LAUNCH_SITE], decay: f[col.DECAY_DATE] || null,
      period: +f[col.PERIOD] || null, inc: +f[col.INCLINATION] || null, apogee: +f[col.APOGEE] || null, perigee: +f[col.PERIGEE] || null,
      rcs: f[col.RCS] ? +f[col.RCS] : null, center: f[col.ORBIT_CENTER], orbit: f[col.ORBIT_TYPE],
    };
    byNorad.set(rec.norad, rec);
    if (rec.launch) {
      if (!byLaunch.has(rec.launch)) byLaunch.set(rec.launch, []);
      byLaunch.get(rec.launch).push(rec);
    }
  }
  return { byNorad, byLaunch, total: byNorad.size };
}

function ownerName(code) { return OWNERS[code] || code; }
function siteName(code) { return SITES[code] || code; }
function typeName(code) { return TYPES[code] || code; }

// Objects launched on `date` (YYYY-MM-DD); if none, walk outward day by day.
function natal(index, date, maxDays = 400) {
  const base = new Date(date + 'T00:00:00Z');
  if (isNaN(base)) return null;
  for (let d = 0; d <= maxDays; d++) {
    for (const sign of d === 0 ? [0] : [-1, 1]) {
      const day = new Date(base.getTime() + sign * d * 86400000).toISOString().slice(0, 10);
      const list = index.byLaunch.get(day);
      if (list && list.length) {
        return { date: day, offsetDays: sign * d, objects: list.map(r => ({ ...r, ownerName: ownerName(r.owner), siteName: siteName(r.site), typeName: typeName(r.type) })) };
      }
    }
  }
  return { date: null, offsetDays: null, objects: [] };
}

module.exports = { parse, natal, ownerName, siteName, typeName };
