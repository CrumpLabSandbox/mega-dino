// Ready-made ways to put rig parts on a 2D canvas. Engines can use these as they are, restyle them through the
// `look` object, or ignore them and walk the parts themselves.
import { clamp, lerp, smooth, hash, sky, skyGradient } from './util.js';
import { plantPalette } from './flora.js';

// T = { x, y, k, dir }: where the animal's ground origin sits on the canvas (pixels), pixels per metre, and
// facing (+1 right, −1 left; values in between squash it, for a paper-flat turn).
export const mapPt = (v, T) => [T.x + v[0] * T.k * T.dir, T.y - v[1] * T.k];
// parts in metres → the same parts in canvas pixels (for engines that want raw geometry)
export function mapParts(parts, T) {
  return parts.map(q => q.p ? { ...q, p: q.p.map(v => mapPt(v, T)) } : q.c ? { ...q, c: [...mapPt(q.c, T), q.c[2] * T.k] }
    : { ...q, l: q.l.map(v => mapPt(v, T)), w: q.w * T.k });
}
// add one part's outline to the current path
export function trace(ctx, q, T) {
  const k = T.k, sx = k * T.dir;
  if (q.c) { const r = Math.max(0.3, q.c[2] * k); ctx.moveTo(T.x + q.c[0] * sx + r, T.y - q.c[1] * k); ctx.arc(T.x + q.c[0] * sx, T.y - q.c[1] * k, r, 0, 6.2832); return; }
  const p = q.p || q.l, n = p.length;
  if (q.p && q.s && n > 3) {
    let px = T.x + p[n - 1][0] * sx, py = T.y - p[n - 1][1] * k, x = T.x + p[0][0] * sx, y = T.y - p[0][1] * k;
    ctx.moveTo((px + x) / 2, (py + y) / 2);
    for (let i = 0; i < n; i++) { const b = p[(i + 1) % n], nx = T.x + b[0] * sx, ny = T.y - b[1] * k; ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2); x = nx; y = ny; }
  } else {
    ctx.moveTo(T.x + p[0][0] * sx, T.y - p[0][1] * k);
    for (let i = 1; i < n; i++) ctx.lineTo(T.x + p[i][0] * sx, T.y - p[i][1] * k);
    if (q.p) ctx.closePath();
  }
}

const rgb = c => { const p = parseInt(c.slice(1), 16); return [p >> 16, p >> 8 & 255, p & 255]; };
const css = (c, a = 1) => a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
// haze colour of the air for a light level: what distant things fade towards
export const hazeRGB = light => mix([22, 28, 48], mix([236, 178, 130], [184, 204, 222], smooth(0.25, 0.6, light)), smooth(0, 0.3, light));

// colours for a species: its own palette, lit by `light` (0 night … 1 day) and faded by `fog` (0..1) into the haze
export function palette(sp, o = {}) {
  const light = clamp(o.light ?? 1), L = 0.3 + 0.7 * light, fog = o.fog || 0, hz = o.tint ? rgb(o.tint) : hazeRGB(light);
  const C = (c, k = 1) => css(mix(mul(rgb(c), k * L), hz, fog));
  const [body, belly, mark, accent] = sp.c;
  return { body: C(body), belly: C(belly), far: C(body, 0.66), mark: C(mark), accent: C(accent), accentFar: C(accent, 0.62), horn: C('#e9e0c8'),
    eye: C('#f2d24a'), mouth: C('#7a1f24'), bone: C('#efe6cf'), boneFar: C('#efe6cf', 0.62), hole: C('#1a1612'), line: C(mark, 0.45) };
}

// Fill (and optionally outline) a list of parts. look: { pal, stroke (css) , lw (px), alpha: { tone: a }, fill(tone, part) → css | null }
export function drawParts(ctx, parts, T, look = {}) {
  const pal = look.pal || {}, lw = look.lw ?? 0, base = ctx.globalAlpha;     // the caller's globalAlpha fades the whole thing
  ctx.lineJoin = ctx.lineCap = 'round';
  for (const q of parts) {
    const col = look.fill ? look.fill(q.t, q) : pal[q.t];
    if (col == null && !look.stroke) continue;
    const a = look.alpha?.[q.t] ?? (q.k === 'mark' && q.t === 'mark' ? 0.55 : 1);
    ctx.beginPath(); trace(ctx, q, T);
    if (q.l) { ctx.strokeStyle = col || look.stroke; ctx.lineWidth = Math.max(0.6, q.w * T.k); ctx.globalAlpha = a * base; ctx.stroke(); ctx.globalAlpha = base; continue; }
    if (col != null) { ctx.fillStyle = col; if (a < 1) ctx.globalAlpha = a * base; ctx.fill(); ctx.globalAlpha = base; }
    if (look.stroke && lw > 0 && q.k !== 'mark' && q.k !== 'belly') { ctx.strokeStyle = look.stroke; ctx.lineWidth = lw; ctx.stroke(); }
    if (q.k === 'eye' && look.pupil !== false) { const r = Math.max(0.4, q.c[2] * T.k * 0.5); ctx.beginPath(); ctx.arc(T.x + q.c[0] * T.k * T.dir, T.y - q.c[1] * T.k, r, 0, 6.2832); ctx.fillStyle = look.pupilCol || '#14110c'; ctx.fill(); }
  }
}

// ---------------------------------------------------------------- painting a whole world (see world.js)
// paintWorld(f, v, S) draws the view `v` far to near. S overrides any step; every default is exported so an engine
// can restyle one thing and keep the rest:
//   S.sky(f, v) · S.sun(f, v) · S.flyer(f, v, item) · S.meteor(f, v) · S.far(f, v, layer, i) · S.sea(f, v)
//   S.ground(f, v, band) · S.water(f, v, band) · S.plant(f, v, item) · S.dino(f, v, item) · S.fx(f, v)
// In a combo (f.combo) the sky, sun and stars are skipped; with a volcano backdrop (f.backdrop) the far ridges and
// sea are skipped too, so the volcano shows above the horizon.
export function paintWorld(f, v, S = {}) {
  sky(f, () => (S.sky || paintSky)(f, v));
  if (!f.combo) (S.sun || paintSun)(f, v);
  for (const it of v.flyers) (S.flyer || S.dino || paintDino)(f, v, it);
  if (v.meteor) (S.meteor || paintMeteor)(f, v);
  if (!f.backdrop) { v.far.forEach((l, i) => (S.far || paintFar)(f, v, l, i)); if (v.sea) (S.sea || paintSea)(f, v); }
  for (const b of v.layers) {
    (S.ground || paintGround)(f, v, b);
    if (b.anyWet) (S.water || paintWater)(f, v, b);
    for (const it of b.items) it.type === 'plant' ? (S.plant || paintPlant)(f, v, it) : (S.dino || paintDino)(f, v, it);
  }
  (S.fx || paintFx)(f, v);
}
export function paintSky(f, v) {
  const { ctx, w, h } = f;
  skyGradient(ctx, w, h, v.light);
  if (v.dark > 0) { ctx.fillStyle = `rgba(38,26,20,${v.dark * 0.75})`; ctx.fillRect(0, 0, w, h); }
}
export function paintSun(f, v) {
  const { ctx, w, h } = f, s = v.sun, a = 1 - v.dark;
  if (s.night > 0.3) { ctx.fillStyle = `rgba(255,255,255,${(s.night - 0.3) * a})`; for (let i = 0; i < 90; i++) { const r = hash(i, 5) < 0.1 ? 1.6 : 0.9; ctx.fillRect(hash(i, 1) * w, hash(i, 2) * v.horizon, r, r); } }
  const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 5);
  g.addColorStop(0, s.moon ? `rgba(230,236,255,${0.5 * a})` : `rgba(255,236,190,${0.7 * a})`); g.addColorStop(1, 'rgba(255,220,160,0)');
  ctx.fillStyle = g; ctx.fillRect(s.x - s.r * 5, s.y - s.r * 5, s.r * 10, s.r * 10);
  ctx.fillStyle = s.moon ? `rgba(240,242,250,${a})` : `rgba(255,${240 - s.dusk * 60 | 0},${200 - s.dusk * 90 | 0},${a})`;
  ctx.beginPath(); ctx.arc(s.x, s.y, s.r * (s.moon ? 0.8 : 1), 0, 6.2832); ctx.fill();
}
export function paintMeteor(f, v) {
  const { ctx, h } = f, m = v.meteor, dx = -Math.cos(m.ang) * m.len, dy = -Math.sin(m.ang) * m.len;
  const g = ctx.createLinearGradient(m.x, m.y, m.x + dx, m.y + dy);
  g.addColorStop(0, 'rgba(255,244,210,.95)'); g.addColorStop(0.25, 'rgba(255,170,70,.6)'); g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.strokeStyle = g; ctx.lineCap = 'round'; ctx.lineWidth = m.r * 1.6; ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x + dx, m.y + dy); ctx.stroke();
  const r = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 6);
  r.addColorStop(0, 'rgba(255,255,240,1)'); r.addColorStop(0.2, 'rgba(255,220,140,.8)'); r.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = r; ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 6, 0, 6.2832); ctx.fill();
}
const closeDown = (ctx, pts, bottom) => { ctx.beginPath(); ctx.moveTo(pts[0][0], bottom); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.lineTo(pts[pts.length - 1][0], bottom); ctx.closePath(); };
// ground colour at depth u (0 far … 1 near), with the daylight, distance haze and the burnt world after the impact
export function groundRGB(f, v, u) {
  const E = f.era, g = v.biome.ground, L = 0.3 + 0.7 * v.light;
  let c = mul(mix(rgb(g[0]), rgb(g[1]), u), L);
  const burnt = Math.min(1, E.dark * 1.3 + (1 - E.dinos) * (1 - E.ferns) * 0.4);
  if (burnt > 0) c = mix(c, mul([70, 60, 54], L), burnt * 0.8);
  if (E.ferns > 0) c = mix(c, mul([70, 120, 60], L), E.ferns * 0.5);
  return mix(c, hazeRGB(v.light), (1 - u) * 0.45);
}
export function paintFar(f, v, l, i) {
  const c = mix(mix(rgb(v.biome.ground[0]), [96, 110, 128], 0.5), hazeRGB(v.light), 0.62 - i * 0.22);
  f.ctx.fillStyle = css(mul(c, (0.45 + 0.55 * v.light) * (1 - 0.4 * v.dark)));
  closeDown(f.ctx, l.pts, l.bottom); f.ctx.fill();
}
export function paintSea(f, v) {
  const { ctx, w } = f, g = ctx.createLinearGradient(0, v.sea.y0, 0, v.sea.y1), L = 0.25 + 0.75 * v.light;
  g.addColorStop(0, css(mix(mul([60, 120, 150], L), hazeRGB(v.light), 0.45))); g.addColorStop(1, css(mul([40, 130, 150], L)));
  ctx.fillStyle = g; ctx.fillRect(0, v.sea.y0, w, v.sea.y1 - v.sea.y0 + 2);
}
export function paintGround(f, v, b) {
  f.ctx.fillStyle = css(groundRGB(f, v, b.u));
  closeDown(f.ctx, b.pts, f.h + 2); f.ctx.fill();
}
export function paintWater(f, v, b) {
  const { ctx } = f, L = 0.25 + 0.75 * v.light, n = b.pts.length;
  ctx.fillStyle = css(mix(mul([70, 120, 140], L), hazeRGB(v.light), 0.35 + (1 - b.u) * 0.3));
  for (let i = 0; i < n; i++) if (b.wet[i]) { const x0 = i ? (b.pts[i - 1][0] + b.pts[i][0]) / 2 : b.pts[i][0], x1 = i < n - 1 ? (b.pts[i][0] + b.pts[i + 1][0]) / 2 : b.pts[i][0]; ctx.fillRect(x0 - 0.5, b.level, x1 - x0 + 1, b.next - b.level + 1); }
}
export function paintPlant(f, v, it) {
  if (it.x < -it.k * 14 || it.x > f.w + it.k * 14) return;
  drawParts(f.ctx, it.parts, { x: it.x, y: it.y, k: it.k, dir: 1 }, { pal: plantPalette(v.light, f.era, it.fog * 0.8) });
}
// ground height under the animal in its own frame (metres), for shadows
export const feetY = q => { let y = 1e9; for (const g of q.legs) y = Math.min(y, g.pts[3][1] - g.R[3]); return y; };
export function paintDino(f, v, it) {
  const { ctx } = f, T = it.T;
  if (it.fade < 1) ctx.globalAlpha = it.fade ?? 1;
  if (it.type === 'dino') {
    const q = it.pose, gy = T.y - feetY(q) * T.k, rx = it.sp.len * q.scale * T.k * 0.3;
    if (!it.wade) { ctx.fillStyle = `rgba(0,0,0,${0.22 * (0.4 + 0.6 * v.light) * (it.fade ?? 1)})`; ctx.beginPath(); ctx.ellipse(T.x + q.nodes[q.iSh].x * 0.5 * T.k * T.dir, gy, rx, rx * 0.14, 0, 0, 6.2832); ctx.fill(); }
  }
  const look = { pal: palette(it.sp, { light: v.light, fog: it.fog * 0.8 }) };
  if (it.wade) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, f.w, it.waterY); ctx.clip(); drawParts(ctx, it.parts, T, look); ctx.restore();
    ctx.strokeStyle = `rgba(255,255,255,${0.35 * v.light})`; ctx.lineWidth = Math.max(1, T.k * 0.04); ctx.beginPath(); ctx.ellipse(T.x, it.waterY, it.sp.len * T.k * 0.22, it.sp.len * T.k * 0.02, 0, 0, 6.2832); ctx.stroke(); }
  else drawParts(ctx, it.parts, T, look);
  ctx.globalAlpha = 1;
}
// the impact flash, the dark that follows, and falling ash; only ever paints over what is already drawn
export function paintFx(f, v) {
  const { ctx, w, h } = f;
  if (v.dark > 0.02) { ctx.fillStyle = `rgba(210,205,196,${v.dark * 0.5})`; for (let i = 0; i < 70; i++) { const x = (hash(i, 3) * w + f.t * 14 * (hash(i, 4) - 0.5)) % w, y = (hash(i, 7) * h + f.t * (18 + 30 * hash(i, 9))) % h; ctx.fillRect(x, y, 1.5 + hash(i, 1), 1.5); } }
  if (v.flash > 0.01 || v.meteor) {
    ctx.save(); ctx.globalCompositeOperation = f.combo ? 'source-atop' : 'source-over';
    const gx = v.meteor ? v.meteor.glowX : w * 0.74, a = Math.max(v.flash, v.meteor ? v.meteor.x / w * 0.15 : 0);
    const g = ctx.createRadialGradient(gx, v.horizon, 0, gx, v.horizon, w * (0.3 + v.flash));
    g.addColorStop(0, `rgba(255,250,225,${Math.min(1, a * 1.5)})`); g.addColorStop(0.4, `rgba(255,190,90,${a * 0.8})`); g.addColorStop(1, `rgba(255,120,40,${a * 0.25})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore();
  }
}
