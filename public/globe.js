// Orthographic globe with ~13k live satellites, drawn on a 2D canvas.
import { subSolarPoint } from './astro.js';

const D2R = Math.PI / 180;
let coastlines = null;
fetch('vendor/coastlines.json').then(r => r.json()).then(d => { coastlines = d; });

export const altScale = alt => 1 + 0.5 * Math.log10(1 + Math.max(0, alt) / 200); // LEO ≈1.29, MEO ≈2.0, GEO ≈2.13

export class Globe {
  constructor(canvas) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.lat0 = 45; this.lon0 = 0; this.spin = 0; this.tilt = 0; this.autoSpin = 0.012; this.idleSince = 0;
    this.cur = null; this.N = 0; this.colors = null; this.domainIdx = null; this.highlights = {};
    this.stars = []; this.shadeCanvas = document.createElement('canvas'); this.shadeKey = '';
    this.frame = 0; this.dragging = false;
    this.resize(); new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.bindDrag();
  }
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.c.clientWidth || this.c.parentElement.clientWidth, h = this.c.clientHeight || this.c.parentElement.clientHeight;
    this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr); this.dpr = dpr; this.w = w; this.h = h;
    const narrow = w < 900; // matches the CSS breakpoint where the hero stacks
    const vh = Math.min(h, window.innerHeight || h); // stacked hero grows with content; size the globe to the viewport
    this.cx = narrow ? w * 0.5 : w * 0.72; this.cy = narrow ? vh * 0.25 : h * 0.5;
    this.R = Math.max(40, narrow ? Math.min(w * 0.34, vh * 0.19) : Math.min(w * 0.21, h * 0.31));
    this.stars = []; let s = 12345; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 420; i++) this.stars.push([rnd() * w, rnd() * h, 0.3 + rnd() * 1.1, rnd() * 6.28]);
    this.shadeKey = '';
  }
  setObserver(lat, lon) { this.lat0 = lat; this.lon0 = lon; this.spin = 0; this.tilt = 0; this.shadeKey = ''; }
  setData(cur, N, domainIdx, colors) { this.cur = cur; this.N = N; this.domainIdx = domainIdx; this.colors = colors; }
  setHighlights(h) { this.highlights = h; }
  setTracks(t) { this.tracks = t; }
  drawTracks() {
    const ctx = this.ctx; if (!this.tracks) return;
    for (const tr of this.tracks) {
      ctx.strokeStyle = tr.color; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.globalAlpha = 0.55; ctx.beginPath(); let pen = false;
      for (const [lat, lon, alt] of tr.pts) { const p = this.project(lat, lon, altScale(alt)); if (this.hidden(p)) { pen = false; continue; } if (!pen) { ctx.moveTo(p[0], p[1]); pen = true; } else ctx.lineTo(p[0], p[1]); }
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
  }
  bindDrag() {
    let px = 0, py = 0;
    const down = e => { this.dragging = true; px = e.clientX; py = e.clientY; this.c.style.cursor = 'grabbing'; };
    const move = e => { if (!this.dragging) return; this.spin -= (e.clientX - px) * 0.25; this.tilt = Math.max(-60, Math.min(60, this.tilt + (e.clientY - py) * 0.25)); px = e.clientX; py = e.clientY; this.idleSince = performance.now(); };
    const up = () => { this.dragging = false; this.c.style.cursor = 'grab'; };
    this.c.style.cursor = 'grab';
    this.c.addEventListener('pointerdown', down); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  // view rotation: center on (lat0 - tilt, lon0 + spin)
  project(lat, lon, rho) {
    const la = lat * D2R, lo = lon * D2R, la0 = this.vlat, lo0 = this.vlon;
    const cl = Math.cos(la), dl = lo - lo0;
    const x = cl * Math.sin(dl);
    const y = Math.cos(la0) * Math.sin(la) - Math.sin(la0) * cl * Math.cos(dl);
    const z = Math.sin(la0) * Math.sin(la) + Math.cos(la0) * cl * Math.cos(dl);
    return [this.cx + x * rho * this.R, this.cy - y * rho * this.R, z * rho, x * rho, y * rho];
  }
  hidden(p) { return p[2] < 0 && (p[3] * p[3] + p[4] * p[4]) < 1; }
  drawShade(now) {
    const key = `${this.vlat.toFixed(2)}|${this.vlon.toFixed(2)}|${Math.floor(now / 60000)}|${this.R | 0}`;
    if (key === this.shadeKey) return; this.shadeKey = key;
    const size = Math.max(4, Math.min(512, Math.round(this.R * 2 * this.dpr))); const sc = this.shadeCanvas; sc.width = sc.height = size;
    const img = sc.getContext('2d').createImageData(size, size); const d = img.data;
    const sun = subSolarPoint(new Date(now)); const sl = sun.lat * D2R, sn = sun.lon * D2R;
    const la0 = this.vlat, lo0 = this.vlon; const half = size / 2;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const x = (i - half) / half, y = -(j - half) / half; const rr = x * x + y * y; if (rr > 1) continue;
      const z = Math.sqrt(1 - rr);
      const lat = Math.asin(y * Math.cos(la0) + z * Math.sin(la0));
      const lon = lo0 + Math.atan2(x, z * Math.cos(la0) - y * Math.sin(la0));
      const cosS = Math.sin(lat) * Math.sin(sl) + Math.cos(lat) * Math.cos(sl) * Math.cos(lon - sn);
      const day = Math.max(0, Math.min(1, (cosS + 0.12) / 0.24)); // twilight band
      const limb = 0.55 + 0.45 * z;
      const v = (16 + 34 * day) * limb; const o = (j * size + i) * 4;
      d[o] = v * 0.9; d[o + 1] = v * 0.95; d[o + 2] = v * 1.15; d[o + 3] = 255;
    }
    sc.getContext('2d').putImageData(img, 0, 0);
  }
  render(now) {
    const ctx = this.ctx, dpr = this.dpr; this.frame++;
    if (!this.dragging && performance.now() - this.idleSince > 4000) this.spin += this.autoSpin;
    this.vlat = Math.max(-89, Math.min(89, this.lat0 - this.tilt)) * D2R; this.vlon = (this.lon0 + this.spin) * D2R;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, this.w, this.h);
    // stars
    ctx.fillStyle = '#fff';
    for (const s of this.stars) { const tw = 0.35 + 0.65 * Math.abs(Math.sin(now / 1400 + s[3])); ctx.globalAlpha = tw * 0.6; ctx.fillRect(s[0], s[1], s[2], s[2]); }
    ctx.globalAlpha = 1;
    // earth
    this.drawShade(now);
    ctx.save(); ctx.beginPath(); ctx.arc(this.cx, this.cy, this.R, 0, 6.2832); ctx.clip();
    ctx.drawImage(this.shadeCanvas, this.cx - this.R, this.cy - this.R, this.R * 2, this.R * 2);
    ctx.restore();
    // graticule
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
    for (let lat = -60; lat <= 60; lat += 30) this.polyline(Array.from({ length: 73 }, (_, k) => [lat, -180 + k * 5]));
    for (let lon = -180; lon < 180; lon += 30) this.polyline(Array.from({ length: 37 }, (_, k) => [-90 + k * 5, lon]));
    // coastlines
    if (coastlines) { ctx.strokeStyle = 'rgba(236,234,228,0.55)'; ctx.lineWidth = 0.8; for (const ring of coastlines) this.polyline(ring.map(([x, y]) => [y, x])); }
    // limb
    ctx.beginPath(); ctx.arc(this.cx, this.cy, this.R, 0, 6.2832); ctx.strokeStyle = 'rgba(236,234,228,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    // observer horizon ring (for 550 km) and marker
    const th = Math.acos(6371 / (6371 + 550)) / D2R; this.smallCircle(this.lat0, this.lon0, th, 'rgba(255,209,102,0.55)', [3, 4]);
    const po = this.project(this.lat0, this.lon0, 1.0);
    if (!this.hidden(po)) { ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(po[0] - 6, po[1]); ctx.lineTo(po[0] + 6, po[1]); ctx.moveTo(po[0], po[1] - 6); ctx.lineTo(po[0], po[1] + 6); ctx.stroke(); this.label('you', po[0] + 8, po[1] - 6, '#ffd166'); }
    // satellites
    if (this.cur) {
      const cur = this.cur, N = this.N, cols = this.colors, dom = this.domainIdx;
      const hi = this.highlights; const hiSet = new Set(Object.values(hi).filter(v => v != null));
      for (let i = 0; i < N; i++) {
        const o = i * 7; const alt = cur[o + 2]; if (alt < 0) continue;
        const p = this.project(cur[o], cur[o + 1], altScale(alt));
        if (this.hidden(p)) continue;
        if (p[0] < -4 || p[1] < -4 || p[0] > this.w + 4 || p[1] > this.h + 4) continue;
        const above = cur[o + 4] > 0; const d = dom[i];
        ctx.fillStyle = cols[d]; ctx.globalAlpha = above ? 0.95 : (d === 0 ? 0.28 : 0.5);
        const sz = above ? 1.8 : 1.2; ctx.fillRect(p[0] - sz / 2, p[1] - sz / 2, sz, sz);
      }
      ctx.globalAlpha = 1;
      this.drawTracks();
      const pulse = 0.5 + 0.5 * Math.sin(now / 500);
      for (const [k, idx] of Object.entries(hi)) {
        if (idx == null) continue; const o = idx * 7; if (this.cur[o + 2] < 0) continue;
        const p = this.project(cur[o], cur[o + 1], altScale(cur[o + 2])); if (this.hidden(p)) continue;
        const col = k === 'iss' ? '#fff' : k === 'sun' ? '#ffd166' : k === 'moon' ? '#cfd8ff' : '#7fd6ff';
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p[0], p[1], 4 + pulse * 3, 0, 6.2832); ctx.stroke();
        ctx.fillStyle = col; ctx.fillRect(p[0] - 1.5, p[1] - 1.5, 3, 3);
        this.label((hi.names && hi.names[k]) || k.toUpperCase(), p[0] + 10, p[1] + 3, col);
      }
    }
  }
  label(text, x, y, col) { const ctx = this.ctx; ctx.font = '10px "JetBrains Mono", monospace'; ctx.fillStyle = col; ctx.globalAlpha = 0.9; ctx.fillText(text, x, y); ctx.globalAlpha = 1; }
  polyline(pts) {
    const ctx = this.ctx; ctx.beginPath(); let pen = false;
    for (const [lat, lon] of pts) { const p = this.project(lat, lon, 1.0); if (p[2] < -0.02) { pen = false; continue; } if (!pen) { ctx.moveTo(p[0], p[1]); pen = true; } else ctx.lineTo(p[0], p[1]); }
    ctx.stroke();
  }
  smallCircle(lat, lon, radDeg, style, dash) {
    const pts = []; const la = lat * D2R, lo = lon * D2R, r = radDeg * D2R;
    for (let k = 0; k <= 72; k++) { const b = k * 5 * D2R; const la2 = Math.asin(Math.sin(la) * Math.cos(r) + Math.cos(la) * Math.sin(r) * Math.cos(b)); const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(r) * Math.cos(la), Math.cos(r) - Math.sin(la) * Math.sin(la2)); pts.push([la2 / D2R, lo2 / D2R]); }
    const ctx = this.ctx; ctx.save(); ctx.strokeStyle = style; ctx.setLineDash(dash || []); ctx.lineWidth = 1; this.polyline(pts); ctx.restore();
  }
}
