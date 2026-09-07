// "Natal wheel" sky chart: zenith at the centre, horizon at the inner ring,
// twelve houses around the rim. Everything is drawn from live az/el.
const D2R = Math.PI / 180;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export class Wheel {
  constructor(canvas) { this.c = canvas; this.ctx = canvas.getContext('2d'); this.cur = null; this.N = 0; this.bodies = []; this.resize(); new ResizeObserver(() => this.resize()).observe(canvas); }
  resize() { const dpr = Math.min(2, window.devicePixelRatio || 1); const w = this.c.clientWidth || 600; this.c.width = this.c.height = Math.round(w * dpr); this.dpr = dpr; this.w = w; this.cx = this.cy = w / 2; this.R = w * 0.46; this.Rin = this.R * 0.84; }
  setData(cur, N, domainIdx, colors) {
    this.cur = cur; this.N = N; this.domainIdx = domainIdx; this.colors = colors;
    const B = colors.length * 2;
    this.bufX = Array.from({ length: B }, () => new Float32Array(N));
    this.bufY = Array.from({ length: B }, () => new Float32Array(N));
    this.bn = new Int32Array(B);
  }
  // bodies: [{name, az, el, kind:'sun'|'moon'|'sat', color, label}]
  setBodies(b) { this.bodies = b; }
  setTracks(t) { this.tracks = t; }
  // az (deg from N clockwise) → screen: north up, east on the LEFT (we look up at the sky)
  xy(az, el, ringPos) {
    let r;
    if (el >= 0) r = this.Rin * (90 - el) / 90; else r = ringPos != null ? this.Rin + (this.R - this.Rin) * ringPos : this.Rin + (this.R - this.Rin) * Math.min(1, -el / 8);
    const a = az * D2R; return [this.cx - r * Math.sin(a), this.cy - r * Math.cos(a), r];
  }
  render(now) {
    const ctx = this.ctx, dpr = this.dpr, w = this.w; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, w);
    const { cx, cy, R, Rin } = this;
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(236,234,228,0.5)';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, Rin, 0, 6.2832); ctx.stroke();
    // elevation rings
    ctx.save(); ctx.setLineDash([2, 5]); ctx.strokeStyle = 'rgba(236,234,228,0.18)';
    for (const el of [30, 60]) { ctx.beginPath(); ctx.arc(cx, cy, Rin * (90 - el) / 90, 0, 6.2832); ctx.stroke(); }
    ctx.restore();
    // houses: 12 sectors starting at east (ASC), counter-clockwise on screen
    ctx.font = `${Math.max(10, w * 0.016)}px "JetBrains Mono", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let h = 0; h < 12; h++) {
      const az = (90 + h * 30) % 360; // east=90°, going through south (180), west (270), north (0)
      const [x1, y1] = this.xy(az, 0, 0), [x2, y2] = this.xy(az, 0, 1);
      ctx.strokeStyle = 'rgba(236,234,228,0.35)'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      const [tx, ty] = this.xy(az + 15, 0, 0.5); ctx.fillStyle = 'rgba(236,234,228,0.55)'; ctx.fillText(ROMAN[h], tx, ty);
      for (let m = 10; m < 30; m += 10) { const [a1, b1] = this.xy(az + m, 0, 0.85), [a2, b2] = this.xy(az + m, 0, 1); ctx.beginPath(); ctx.moveTo(a1, b1); ctx.lineTo(a2, b2); ctx.stroke(); }
    }
    // cardinal labels
    ctx.font = `${Math.max(10, w * 0.017)}px "Inter Tight", sans-serif`; ctx.fillStyle = '#8a877f';
    for (const [az, t] of [[0, 'N'], [90, 'E · ASC'], [180, 'S'], [270, 'W · DSC']]) { const a = az * D2R, r = R + w * 0.045; ctx.fillText(t, cx - r * Math.sin(a), cy - r * Math.cos(a)); }
    // satellites
    if (this.cur) {
      // bucketed by colour, same as the globe: one fillStyle change per bucket
      const cur = this.cur, dom = this.domainIdx, cols = this.colors, N = this.N;
      const bufX = this.bufX, bufY = this.bufY, bn = this.bn, Rin = this.Rin, Rr = this.R;
      bn.fill(0);
      for (let i = 0, o = 0; i < N; i++, o += 7) {
        const el = cur[o + 4]; if (el < -8 || cur[o + 2] < 0) continue;
        const r = el >= 0 ? Rin * (90 - el) / 90 : Rin + (Rr - Rin) * Math.min(1, -el / 8);
        const a = cur[o + 3] * D2R;
        const b = dom[i] * 2 + (el >= 0 ? 1 : 0), k = bn[b]++;
        bufX[b][k] = cx - r * Math.sin(a); bufY[b][k] = cy - r * Math.cos(a);
      }
      for (let b = 0, B = bn.length; b < B; b++) {
        const n = bn[b]; if (!n) continue;
        const up = b & 1, d = b >> 1;
        ctx.fillStyle = cols[d]; ctx.globalAlpha = up ? (d === 0 ? 0.55 : 0.9) : 0.25;
        const s = up ? 2 : 1.4, half = s / 2, X = bufX[b], Y = bufY[b];
        for (let k = 0; k < n; k++) ctx.fillRect(X[k] - half, Y[k] - half, s, s);
      }
      ctx.globalAlpha = 1;
    }
    // trails of the highlighted satellites (past and next minutes)
    if (this.tracks) for (const tr of this.tracks) {
      ctx.strokeStyle = tr.color; ctx.setLineDash([2, 3]); ctx.globalAlpha = 0.5; ctx.beginPath(); let pen = false;
      for (const [az, el] of tr.pts) { if (el < -8) { pen = false; continue; } const [x, y] = this.xy(az, el); if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y); }
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    // aspects between bodies
    const B = this.bodies.filter(b => b && b.az != null);
    ctx.save();
    for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
      const asp = aspect(B[i], B[j]); if (!asp) continue;
      const [x1, y1] = this.xy(B[i].az, Math.max(B[i].el, -8)), [x2, y2] = this.xy(B[j].az, Math.max(B[j].el, -8));
      ctx.strokeStyle = asp.color; ctx.setLineDash(asp.dash); ctx.lineWidth = 1; ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 0.7; ctx.fillStyle = asp.color; ctx.font = `italic ${Math.max(10, w * 0.016)}px "Instrument Serif", serif`; ctx.fillText(asp.name, (x1 + x2) / 2, (y1 + y2) / 2 - 7);
    }
    ctx.restore();
    // bodies
    const pulse = 0.5 + 0.5 * Math.sin(now / 450);
    for (const b of B) {
      const [x, y] = this.xy(b.az, Math.max(b.el, -8)); const col = b.color; ctx.globalAlpha = b.el >= 0 ? 1 : 0.45;
      if (b.kind === 'sun' || b.kind === 'moon') { ctx.font = `${w * 0.034}px serif`; ctx.fillStyle = col; ctx.fillText(b.kind === 'sun' ? '☉' : '☽', x, y); }
      else { ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(x, y, 4 + pulse * 3, 0, 6.2832); ctx.stroke(); ctx.fillStyle = col; ctx.fillRect(x - 1.5, y - 1.5, 3, 3); }
      if (b.el < 0 && b.kind === 'sat') continue; // below the horizon: glyph only, keeps the rim legible
      ctx.font = `${Math.max(9, w * 0.015)}px "JetBrains Mono", monospace`; ctx.fillStyle = col;
      const left = b.kind === 'sun' || b.kind === 'moon' || x > this.cx + this.R * 0.6; ctx.textAlign = left ? 'right' : 'left'; ctx.fillText(b.label, left ? x - 11 : x + 11, b.kind === 'sat' ? y - 9 : y + 14); ctx.textAlign = 'center';
    }
    ctx.globalAlpha = 1;
    // centre
    ctx.fillStyle = '#ECEAE4'; ctx.beginPath(); ctx.arc(cx, cy, 2, 0, 6.2832); ctx.fill();
    ctx.font = `italic ${Math.max(11, w * 0.02)}px "Instrument Serif", serif`; ctx.fillStyle = '#8a877f'; ctx.fillText('zenith (you)', cx, cy + 16);
  }
}
export function aspect(a, b) {
  const s = sep(a.az, a.el, b.az, b.el);
  const list = [[0, 8, 'conjunction', '#ffd166', []], [180, 8, 'opposition', '#ff7b7b', [6, 4]], [120, 6, 'trine', '#8de0a5', [2, 4]], [90, 6, 'square', '#7fd6ff', [1, 3]], [60, 4, 'sextile', '#b8a5ff', [1, 5]]];
  for (const [ang, orb, name, color, dash] of list) if (Math.abs(s - ang) <= orb) return { name, color, dash, sep: s };
  return null;
}
export function sep(az1, el1, az2, el2) { const a1 = az1 * D2R, e1 = el1 * D2R, a2 = az2 * D2R, e2 = el2 * D2R; return Math.acos(Math.max(-1, Math.min(1, Math.sin(e1) * Math.sin(e2) + Math.cos(e1) * Math.cos(e2) * Math.cos(a1 - a2)))) / D2R; }
