// Static build for GitHub Pages: fetches (politely, via the same cache as the
// server) and writes everything the page needs into public/data/.
//   public/data/catalog.json      merged orbital elements
//   public/data/status.json       per-group fetch times (for the methodology panel)
//   public/data/natal/<year>.json launches by date, one shard per year
const fs = require('fs');
const path = require('path');
const ct = require('../lib/celestrak');
const GROUPS = require('../lib/groups');
const { buildCatalog, natalShards } = require('../lib/catalog');

(async () => {
  await ct.refreshSatcat();
  for (const g of GROUPS) await ct.refreshGroup(g.id);
  const out = path.join(__dirname, '..', 'public', 'data');
  fs.mkdirSync(path.join(out, 'natal'), { recursive: true });
  const cat = buildCatalog();
  if (!cat.count) { console.error('no catalog data; aborting'); process.exit(1); }
  fs.writeFileSync(path.join(out, 'catalog.json'), JSON.stringify(cat));
  const st = ct.status(GROUPS);
  fs.writeFileSync(path.join(out, 'status.json'), JSON.stringify({ ...st, catalog: { builtAt: Date.now(), count: cat.count }, static: true }));
  const ns = natalShards();
  if (ns) for (const [y, byDate] of Object.entries(ns.years)) fs.writeFileSync(path.join(out, 'natal', y + '.json'), JSON.stringify({ year: +y, total: ns.total, fetchedAt: ns.fetchedAt, byDate }));
  const missing = GROUPS.filter(g => !ct.get('gp-' + g.id).body).map(g => g.id);
  console.log(`static build: ${cat.count} objects, ${ns ? Object.keys(ns.years).length : 0} natal shards${missing.length ? '; MISSING groups: ' + missing.join(', ') : ''}`);
})();
