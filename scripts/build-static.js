// Static build for GitHub Pages: fetches (politely, via the same cache as the
// server) and writes everything the page needs into public/data/.
//   public/data/catalog.json      merged orbital elements
//   public/data/status.json       per-group fetch times (for the methodology panel)
//   public/data/natal/<year>.json launches by date, one shard per year
//   public/data/videos.json      YouTube video pool for the Shorts feed
//
// It then stamps every local asset URL with a content hash and writes the result to
// dist/. Without that, GitHub Pages serves each file with a ten-minute cache and no
// version marker, so a phone can keep an old copy of the JavaScript indefinitely and
// module imports and workers resolve straight back to those stale URLs.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ct = require('../lib/celestrak');
const GROUPS = require('../lib/groups');
const { buildCatalog, natalShards } = require('../lib/catalog');
const videos = require('../lib/videos');

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
  try { const v = await videos.refreshVideos(); fs.writeFileSync(path.join(out, 'videos.json'), JSON.stringify(v)); console.log('videos:', v.videos.length); } catch (e) { console.error('videos failed (non-fatal):', e.message); }
  const missing = GROUPS.filter(g => !ct.get('gp-' + g.id).body).map(g => g.id);
  console.log(`static build: ${cat.count} objects, ${ns ? Object.keys(ns.years).length : 0} natal shards${missing.length ? '; MISSING groups: ' + missing.join(', ') : ''}`);
  buildDist();
})();

// ---------------------------------------------------------------------------
// Cache-busting build: copy public/ to dist/ and version every local reference.
// ---------------------------------------------------------------------------
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');

function walk(dir, base = dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

// Assets whose URL must change whenever their contents change. HTML files are left
// unversioned so links stay clean; they carry a short cache and pull everything else.
function versionedAssets(files) {
  return files.filter(f => /\.(js|css|json)$/.test(f) && !f.startsWith('data/natal/'));
}

function buildDist() {
  fs.rmSync(DIST, { recursive: true, force: true });
  const files = walk(PUBLIC);
  const hash = crypto.createHash('sha256');
  for (const f of files.slice().sort()) hash.update(f).update(fs.readFileSync(path.join(PUBLIC, f)));
  const v = hash.digest('hex').slice(0, 10);

  const assets = versionedAssets(files);
  const rewrite = text => {
    let out = text;
    for (const a of assets) {
      // "asset.js" / './asset.js' / `asset.js` in any quoting, not already versioned
      out = out.split('"' + a + '"').join('"' + a + '?v=' + v + '"')
        .split("'" + a + "'").join("'" + a + '?v=' + v + "'")
        .split('"./' + a + '"').join('"./' + a + '?v=' + v + '"')
        .split("'./" + a + "'").join("'./" + a + '?v=' + v + "'");
    }
    // the natal shards are addressed by a template literal
    out = out.split('data/natal/${year}.json').join('data/natal/${year}.json?v=' + v);
    return out;
  };

  for (const f of files) {
    const src = path.join(PUBLIC, f), dst = path.join(DIST, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (/\.(html|js|css)$/.test(f)) {
      let text = fs.readFileSync(src, 'utf8');
      text = rewrite(text);
      if (f.endsWith('.html')) text = text.replace('</head>', `<meta name="cosat-build" content="${v}">\n</head>`);
      fs.writeFileSync(dst, text);
    } else fs.copyFileSync(src, dst);
  }
  console.log(`dist: ${files.length} files, build ${v}`);
  return v;
}

module.exports = { buildDist };
