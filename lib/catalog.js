// Builds the merged, compact catalog (shared by the live server and the static build).
const ct = require('./celestrak');
const satcat = require('./satcat');
const GROUPS = require('./groups');

let satcatIndex = null, satcatBuiltFrom = 0;
function getSatcat() {
  const s = ct.get('satcat');
  if (s.body && s.fetchedAt !== satcatBuiltFrom) { satcatIndex = satcat.parse(s.body); satcatBuiltFrom = s.fetchedAt; }
  return satcatIndex;
}

function buildCatalog() {
  const idx = getSatcat();
  const seen = new Map();
  for (const g of GROUPS) {
    const body = ct.get('gp-' + g.id).body; if (!body) continue;
    for (const o of body) {
      let rec = seen.get(o.NORAD_CAT_ID);
      if (!rec) {
        const sc = idx ? idx.byNorad.get(o.NORAD_CAT_ID) : null;
        rec = {
          n: o.OBJECT_NAME, i: o.OBJECT_ID, c: o.NORAD_CAT_ID, e: o.EPOCH,
          mm: o.MEAN_MOTION, ec: o.ECCENTRICITY, in: o.INCLINATION, ra: o.RA_OF_ASC_NODE, ap: o.ARG_OF_PERICENTER, ma: o.MEAN_ANOMALY,
          bs: o.BSTAR, nd: o.MEAN_MOTION_DOT, ndd: o.MEAN_MOTION_DDOT, g: [],
          o: sc ? sc.owner : null, l: sc ? sc.launch : null, s: sc ? sc.site : null, t: sc ? sc.type : null,
        };
        seen.set(o.NORAD_CAT_ID, rec);
      }
      rec.g.push(g.id);
    }
  }
  const objects = [...seen.values()];
  const freshness = Object.fromEntries(GROUPS.map(g => [g.id, ct.get('gp-' + g.id).fetchedAt || null]));
  return { generatedAt: Date.now(), count: objects.length, groups: GROUPS, freshness, satcatFetchedAt: ct.get('satcat').fetchedAt || null, objects };
}

// Static "natal" shards: one file per launch year, keyed by launch date.
function natalShards() {
  const idx = getSatcat(); if (!idx) return null;
  const years = {};
  for (const [date, list] of idx.byLaunch) {
    const y = date.slice(0, 4); (years[y] ||= {})[date] = list.map(r => ({ ...r, ownerName: satcat.ownerName(r.owner), siteName: satcat.siteName(r.site), typeName: satcat.typeName(r.type) }));
  }
  return { years, total: idx.total, fetchedAt: ct.get('satcat').fetchedAt };
}

module.exports = { buildCatalog, getSatcat, natalShards };
