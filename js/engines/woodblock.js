// Woodblock & Ink: the shared world in the manner of traditional prints and ink painting. One engine, eight
// manners (opts.style): ukiyo-e print, sumi-e ink wash, shan shui scroll, linocut, Victorian steel engraving,
// blue-and-white porcelain, black-figure vase band and ochre cave painting. Everything is drawn from world.js;
// each style is a set of painters for the sky, the ground bands, the plants and the animals.
import { createWorld } from '../world.js';
import { trace, groundRGB } from '../draw.js';
import { clamp, lerp, smooth, hash, rng, fbm2, noise2, fract, buffer, sky } from '../util.js';

const TAU = Math.PI * 2;
const hx = c => { const p = parseInt(c.slice(1), 16); return [p >> 16, p >> 8 & 255, p & 255]; };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const css = (c, a = 1) => a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, a).toFixed(3)})`;
const lum = c => (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255;
const grey = c => { const l = lum(c) * 255; return [l, l, l]; };
const sat = (c, k) => mix(grey(c), c, k);

// ---------------------------------------------------------------- shared geometry helpers
const below = (ctx, pts, bottom) => { ctx.beginPath(); ctx.moveTo(pts[0][0], bottom); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.lineTo(pts[pts.length - 1][0], bottom); ctx.closePath(); };
const along = (ctx, pts, dy = 0) => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1] + dy); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1] + dy); };
const topY = pts => { let y = 1e9; for (const p of pts) if (p[1] < y) y = p[1]; return y; };
const SOLID = q => !q.l && q.k !== 'mark' && q.k !== 'belly' && q.k !== 'eye' && q.k !== 'nostril' && q.k !== 'mouth';
// every solid part of an animal or plant as one path: fill it for a silhouette, stroke it for a key line
const outline = (ctx, parts, T) => { ctx.beginPath(); for (const q of parts) if (SOLID(q)) trace(ctx, q, T); };
// like drawParts in draw.js, with a base alpha `A` that survives the whole call (drawParts resets globalAlpha)
function paint(ctx, parts, T, look) {
  const A = look.A ?? 1, lw = look.lw ?? 0, k = Math.abs(T.k);
  ctx.lineJoin = ctx.lineCap = 'round';
  for (const q of parts) {
    const col = look.fill ? look.fill(q.t, q) : look.pal[q.t];
    if (col == null && !look.stroke) continue;
    const a = (look.alpha?.[q.t] ?? (q.k === 'mark' && q.t === 'mark' ? 0.55 : 1)) * A * (q.c && look.round ? look.round : 1);
    ctx.beginPath(); trace(ctx, q, T);
    if (q.l) { ctx.strokeStyle = col || look.stroke; ctx.lineWidth = Math.max(0.6, q.w * k); ctx.globalAlpha = a; ctx.stroke(); continue; }
    if (col != null) { ctx.fillStyle = col; ctx.globalAlpha = a; ctx.fill(); }
    if (look.stroke && lw > 0 && q.k !== 'mark' && q.k !== 'belly') { ctx.globalAlpha = A; ctx.strokeStyle = look.stroke; ctx.lineWidth = lw; ctx.stroke(); }
    if (q.k === 'eye' && look.pupil !== false) { const r = Math.max(0.4, q.c[2] * k * 0.5); ctx.beginPath(); ctx.arc(T.x + q.c[0] * T.k * T.dir, T.y - q.c[1] * T.k, r, 0, TAU); ctx.fillStyle = look.pupilCol || '#14110c'; ctx.fill(); }
  }
  ctx.globalAlpha = 1;
}
// ground colour by era and biome, in full daylight: each style brings its own night
const gRGB = (f, v, u) => groundRGB(f, { biome: v.biome, light: Math.max(v.light, 0.8) }, u);
const offscreen = (f, it) => it.x < -it.k * 16 || it.x > f.w + it.k * 16;
const PT = it => ({ x: it.x, y: it.y, k: it.k, dir: 1 });
// pixels per metre along the ground at a band's depth (to tie dashes and marks to the ground, not the screen)
const kdOf = (v, b) => v.sx(1, b.d) - v.sx(0, b.d);
function wading(f, it, fn) {
  const { ctx } = f;
  if (it.wade) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, f.w, it.waterY); ctx.clip(); fn(); ctx.restore(); } else fn();
}
// a line along the animal's body, `off` body radii above (+) or below (−) the spine, in pixels
function spine(q, T, off, i0 = 0, i1 = q.nodes.length - 1) {
  const n = q.nodes, out = [], sx = T.k * T.dir;
  for (let i = i0; i <= i1; i++) {
    const a = n[Math.max(0, i - 1)], b = n[Math.min(n.length - 1, i + 1)], c = n[i];
    let tx = b.x - a.x, ty = b.y - a.y; const d = Math.hypot(tx, ty) || 1; tx /= d; ty /= d;
    const r = off < 0 ? (c.b ?? c.r) : c.r;
    out.push([T.x + (c.x - ty * r * off) * sx, T.y - (c.y + tx * r * off) * T.k]);
  }
  return out;
}
const poly = (ctx, pts) => { ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); };
function pill(ctx, x, y, w, h) { const r = h / 2; ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2); ctx.lineTo(x + r, y + h); ctx.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5); ctx.closePath(); }
function waterRects(ctx, b, pad = 0) {
  const n = b.pts.length; ctx.beginPath();
  for (let i = 0; i < n; i++) if (b.wet[i]) { const x0 = i ? (b.pts[i - 1][0] + b.pts[i][0]) / 2 : b.pts[i][0], x1 = i < n - 1 ? (b.pts[i][0] + b.pts[i + 1][0]) / 2 : b.pts[i][0]; ctx.rect(x0 - 0.5, b.level + pad, x1 - x0 + 1, b.next - b.level + 1 - pad); }
}
// short horizontal strokes on the wet parts of a band
function ripples(ctx, f, v, b, n, len) {
  const kd = kdOf(v, b), cols = b.pts.length; ctx.beginPath();
  for (let j = 0; j < n; j++) {
    const y = lerp(b.level, Math.min(b.next, f.h), (j + 0.5) / n), cell = len * 2.6, off = fract((v.camX * kd + j * 37) / cell) * cell;
    for (let x = -off; x < f.w; x += cell) { const xx = x + hash(Math.round((x + v.camX * kd) / cell), j) * cell * 0.4, c = clamp(Math.round(xx / f.w * 36) + 1, 0, cols - 1); if (b.wet[c]) { ctx.moveTo(xx, y); ctx.lineTo(xx + len, y); } }
  }
}

// tone colours straight from the species (no lighting): the styles bend these to their own inks
const FIXED = { horn: [233, 224, 200], eye: [242, 210, 74], mouth: [140, 40, 40], bone: [239, 230, 207] };
function toneRGB(sp, t) {
  const c = sp._wb || (sp._wb = sp.c.map(hx));
  switch (t) { case 'body': return c[0]; case 'belly': return c[1]; case 'far': return mul(c[0], 0.68); case 'mark': return c[2]; case 'accent': return c[3]; case 'accentFar': return mul(c[3], 0.64); }
  return FIXED[t] || c[0];
}
const PLANT = { trunk: [92, 70, 48], leaf: [52, 104, 52], leaf2: [74, 128, 60], flower: [236, 196, 214], rock: [128, 124, 116], rock2: [158, 154, 144], egg: [232, 224, 200], bone: [232, 226, 204] };
const dayOf = v => ({ night: 1 - smooth(0.04, 0.3, v.light), dusk: Math.max(0, 1 - Math.abs(v.light - 0.3) / 0.2) * (1 - v.dark) });

// ---------------------------------------------------------------- shared textures and ornaments
let GRAIN = null;
function grainTile() {
  if (GRAIN) return GRAIN;
  const b = buffer(256, 256), g = b.ctx, R = rng(977);
  for (let i = 0; i < 7000; i++) { const a = R(); g.fillStyle = R() < 0.6 ? `rgba(70,48,24,${a * 0.3})` : `rgba(255,250,236,${a * 0.3})`; g.fillRect(R() * 256, R() * 256, 1 + R() * 1.6, 1 + R() * 0.6); }
  g.lineWidth = 1;
  for (let i = 0; i < 90; i++) { const x = R() * 256, y = R() * 256, l = 5 + R() * 18, a = (R() - 0.5) * 1.2; g.strokeStyle = R() < 0.5 ? 'rgba(90,66,34,0.16)' : 'rgba(255,252,240,0.2)'; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5, y + Math.sin(a) * l * 0.5 + (R() - 0.5) * 4, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  return GRAIN = b.canvas;
}
// paper grain over whatever is painted (never over transparent sky)
function grain(f, amt) {
  if (amt < 0.02) return;
  const { ctx, w, h } = f; ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.globalAlpha = Math.min(1, amt * 0.6 * clamp(h / 640, 0.45, 1));
  const s = Math.max(1, h / 720); ctx.scale(s, s); ctx.fillStyle = ctx.createPattern(grainTile(), 'repeat'); ctx.fillRect(0, 0, w / s + 1, h / s + 1); ctx.restore();
}
function tint(f, col, a) { if (a <= 0.004) return; const { ctx } = f; ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = css(col, a); ctx.fillRect(0, 0, f.w, f.h); ctx.restore(); }
// diagonal, crossed or level ruling as a repeating pattern: n lines per tile of S pixels
function hatch(ctx, S, n, col, lw, kind) {
  S = Math.max(4, Math.round(S)); const b = buffer(S, S), g = b.ctx; g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'square'; g.beginPath();
  if (kind === 'level') for (let j = 0; j < n; j++) { const y = (j + 0.5) * S / n; g.moveTo(-1, y); g.lineTo(S + 1, y); }
  else {
    for (let j = 0; j <= 2 * n; j++) { const c = j * S / n; g.moveTo(c + S, -S); g.lineTo(c - S, S); }
    if (kind === 'cross') for (let j = -n; j <= n; j++) { const c = j * S / n; g.moveTo(c - S, -S); g.lineTo(c + S, S); }
  }
  g.stroke(); return ctx.createPattern(b.canvas, 'repeat');
}
// a red seal with a three-toed footprint cut out of it
function seal(ctx, x, y, s, red, paper) {
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = css(red);
  ctx.beginPath(); ctx.moveTo(-s * 0.5, -s * 0.44); ctx.quadraticCurveTo(0, -s * 0.54, s * 0.5, -s * 0.46); ctx.quadraticCurveTo(s * 0.55, 0, s * 0.48, s * 0.5); ctx.quadraticCurveTo(0, s * 0.55, -s * 0.5, s * 0.47); ctx.quadraticCurveTo(-s * 0.55, 0, -s * 0.5, -s * 0.44); ctx.fill();
  ctx.strokeStyle = css(paper); ctx.lineCap = 'round'; ctx.lineWidth = s * 0.11; ctx.beginPath();
  for (const a of [-0.62, 0, 0.62]) { ctx.moveTo(0, s * 0.2); ctx.lineTo(Math.sin(a) * s * 0.5, s * 0.2 - Math.cos(a) * s * 0.52); }
  ctx.moveTo(0, s * 0.2); ctx.lineTo(-s * 0.05, s * 0.36); ctx.stroke();
  ctx.lineWidth = s * 0.05; ctx.strokeRect(-s * 0.37, -s * 0.36, s * 0.74, s * 0.74); ctx.restore();
}
// a column of made-up brush characters (shapes, not writing)
function glyphs(ctx, x, y, s, n, seed, col) {
  const R = rng(Math.imul(seed + 11, 2654435761)); ctx.save(); ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = 0; i < n; i++) {
    const cy = y + i * s * 1.18, m = 3 + Math.floor(R() * 3);
    for (let j = 0; j < m; j++) {
      const t = R(), a = R(), b = R(); ctx.lineWidth = s * (0.07 + 0.07 * R()); ctx.beginPath();
      if (t < 0.4) { const yy = cy + (a - 0.5) * s * 0.8; ctx.moveTo(x - s * (0.2 + 0.25 * b), yy); ctx.quadraticCurveTo(x, yy - s * 0.06, x + s * (0.2 + 0.25 * b), yy + s * 0.03); }
      else if (t < 0.7) { const xx = x + (a - 0.5) * s * 0.6; ctx.moveTo(xx, cy - s * (0.2 + 0.25 * b)); ctx.lineTo(xx - s * 0.02, cy + s * (0.2 + 0.25 * b)); }
      else if (t < 0.88) { ctx.moveTo(x + (a - 0.3) * s * 0.4, cy - s * 0.3); ctx.quadraticCurveTo(x + (a - 0.5) * s * 0.3, cy + s * 0.1, x - s * 0.42 * (b > 0.5 ? 1 : -1), cy + s * 0.44); }
      else { const xx = x + (a - 0.5) * s * 0.7, yy = cy + (b - 0.5) * s * 0.7; ctx.moveTo(xx, yy); ctx.lineTo(xx + s * 0.07, yy + s * 0.09); }
      ctx.stroke();
    }
  }
  ctx.restore();
}
// the asteroid, the flash and the dark, in the style's own colours; tints only touch what is painted
function meteor(f, v, S) {
  const { ctx } = f, m = v.meteor, dx = -Math.cos(m.ang) * m.len, dy = -Math.sin(m.ang) * m.len, fire = S.fire || [200, 60, 40], line = S.line || [30, 26, 30], lw = Math.max(1, f.h * 0.0035);
  ctx.save(); ctx.lineCap = 'round';
  for (let j = -1; j <= 1; j++) { ctx.strokeStyle = css(j ? line : fire, j ? 0.8 : 1); ctx.lineWidth = j ? lw : m.r * 1.2; ctx.beginPath(); ctx.moveTo(m.x + j * dy / m.len * m.r * 1.3, m.y - j * dx / m.len * m.r * 1.3); ctx.lineTo(m.x + dx * (j ? 0.75 : 1), m.y + dy * (j ? 0.75 : 1)); ctx.stroke(); }
  ctx.fillStyle = css(fire); ctx.strokeStyle = css(line); ctx.lineWidth = lw * 1.4; ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 2.2, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = css(S.paper || [240, 230, 200]); ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 1.1, 0, TAU); ctx.fill(); ctx.restore();
}
function fx(f, v, S) {
  if (v.flash > 0.01) { const { ctx, w, h } = f; ctx.save(); ctx.globalCompositeOperation = 'source-atop'; const g = ctx.createRadialGradient(w * 0.74, v.horizon, 0, w * 0.74, v.horizon, w * (0.3 + v.flash)); const c = S.fire || [220, 90, 40];
    g.addColorStop(0, css(mix(c, [255, 250, 230], 0.8), Math.min(1, v.flash * 1.4))); g.addColorStop(1, css(c, v.flash * 0.35)); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore(); }
  if (v.dark > 0.02) tint(f, S.soot || [34, 28, 30], v.dark * (S.sootA ?? 0.42));
}
// far → near, like paintWorld, with a few more places to hook into
function walk(f, v, S) {
  sky(f, () => S.sky(f, v));
  if (!f.combo && S.sun) S.sun(f, v);
  if (!f.backdrop) { if (S.peaks) S.peaks(f, v); if (S.far) v.far.forEach((l, i) => S.far(f, v, l, i)); }
  for (const it of v.flyers) S.dino(f, v, it);
  if (v.meteor) (S.meteor || meteor)(f, v, S);
  if (S.pre) S.pre(f, v);
  v.layers.forEach((b, i) => {
    S.ground(f, v, b, i);
    if (b.anyWet && S.water) S.water(f, v, b);
    for (const it of b.items) { if (it.type !== 'plant') S.dino(f, v, it); else if (S.plant && !offscreen(f, it)) S.plant(f, v, it); }
  });
  fx(f, v, S);
  if (S.over) S.over(f, v);
}

// ================================================================ ukiyo-e
function ukiyoe(E) {
  const PAPER = [239, 227, 198], INK = [28, 34, 62], BLUE = [27, 58, 107], RED = [196, 52, 40], NIGHT = [40, 58, 104];
  let D, air, lws, colr;
  const key = a => css(mix(INK, [8, 10, 22], D.night * 0.6), a);
  const fogged = (c, fog) => mix(mix(c, NIGHT, D.night * 0.55), air, fog);
  const S = {
    paper: PAPER, fire: RED, line: INK, soot: [30, 30, 44],
    begin(f, v) { D = dayOf(v); lws = 0.45 + 1.1 * f.p.x1; colr = f.p.x4;
      air = mix(mix(mix(PAPER, [236, 190, 150], D.dusk * 0.5), [150, 160, 172], v.dark * 0.6), [70, 84, 118], D.night * 0.85); },
    sky(f, v) {
      const { ctx, w, h } = f, top = mix(mix(BLUE, [150, 50, 40], D.dusk * 0.45), [10, 14, 32], D.night * 0.85), mid = mix(PAPER, [52, 66, 104], D.night * 0.9), low = mix(mix(PAPER, [238, 160, 110], 0.12 + D.dusk * 0.6), [112, 126, 156], D.night * 0.85);
      const g = ctx.createLinearGradient(0, 0, 0, v.horizon + h * 0.02);
      g.addColorStop(0, css(top)); g.addColorStop(0.16, css(mix(top, mid, 0.35))); g.addColorStop(0.42, css(mid)); g.addColorStop(0.75, css(mix(mid, low, 0.7))); g.addColorStop(1, css(low));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      if (v.dark > 0) { ctx.fillStyle = css([40, 36, 44], v.dark * 0.6); ctx.fillRect(0, 0, w, h); }
    },
    sun(f, v) {
      const { ctx, h } = f, s = v.sun, a = 1 - v.dark;
      if (s.moon || D.night > 0.6) {
        const r = h * 0.075; ctx.fillStyle = css([236, 232, 212], 0.16 * a); ctx.beginPath(); ctx.arc(s.x, s.y, r * 1.5, 0, TAU); ctx.fill();
        ctx.fillStyle = css([238, 234, 214], a); ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.fill();
        ctx.fillStyle = css([200, 204, 200], 0.5 * a); ctx.beginPath(); ctx.ellipse(s.x - r * 0.25, s.y + r * 0.15, r * 0.3, r * 0.22, 0.4, 0, TAU); ctx.ellipse(s.x + r * 0.3, s.y - r * 0.3, r * 0.2, r * 0.14, -0.3, 0, TAU); ctx.fill();
      } else { ctx.fillStyle = css(mix(RED, [214, 96, 50], D.dusk * 0.4), a); ctx.beginPath(); ctx.arc(s.x, s.y, h * 0.05, 0, TAU); ctx.fill(); }
    },
    far(f, v, l, i) {
      const { ctx, h } = f, y0 = topY(l.pts), c = fogged(mix([70, 98, 136], PAPER, 0.3 - 0.22 * i), 0.3 - 0.2 * i), g = ctx.createLinearGradient(0, y0, 0, l.bottom);
      g.addColorStop(0, css(c)); g.addColorStop(1, css(mix(c, air, 0.75))); ctx.fillStyle = g; below(ctx, l.pts, l.bottom); ctx.fill();
      along(ctx, l.pts); ctx.strokeStyle = key(0.55); ctx.lineWidth = Math.max(0.7, h * 0.0022 * lws); ctx.lineJoin = 'round'; ctx.stroke();
    },
    pre(f, v) { S.mist(f, v, v.horizon - (f.combo ? -f.h * 0.012 : f.h * 0.03), 3, 1); },
    mist(f, v, y, n, big) {
      const m = f.p.x3; if (m < 0.04) return; const { ctx, w, h } = f; ctx.fillStyle = css(mix(PAPER, [150, 164, 196], D.night * 0.75), Math.min(1, 0.35 + m)); ctx.beginPath();
      for (let j = 0; j < n; j++) {
        const sd = j * 5.3 + y * 0.01 + (E.opts.seed || 0), bw = w * (0.22 + 0.3 * hash(sd, 1)) * big * (0.5 + m), x = fract(hash(sd, 2) + f.t * 0.0035 * (0.5 + hash(sd, 4)) - v.camX * 0.0008) * (w + bw * 1.6) - bw * 1.3, bh = h * 0.02 * big, yy = y + j * bh * 1.7;
        pill(ctx, x, yy, bw, bh); pill(ctx, x + bw * 0.28, yy + bh * 0.82, bw * 0.9, bh); if (hash(sd, 3) > 0.4) pill(ctx, x - bw * 0.2, yy - bh * 0.82, bw * 0.6, bh);
      }
      ctx.fill();
    },
    ground(f, v, b, i) {
      const { ctx, h } = f;
      if (i === Math.round(v.layers.length * 0.3)) S.mist(f, v, b.level - h * 0.05, 2, 0.8);
      const c = fogged(sat(mix(gRGB(f, v, b.u), PAPER, 0.16), 0.75 + 0.3 * colr), 0), y0 = topY(b.pts), g = ctx.createLinearGradient(0, y0, 0, Math.max(y0 + h * 0.05, b.next + h * 0.02));
      g.addColorStop(0, css(mix(mul(c, 0.8), BLUE, 0.1))); g.addColorStop(0.45, css(c)); g.addColorStop(1, css(mix(c, air, 0.3)));
      ctx.fillStyle = g; below(ctx, b.pts, h + 2); ctx.fill();
      along(ctx, b.pts); ctx.strokeStyle = key(0.3 + 0.4 * b.u); ctx.lineWidth = Math.max(0.6, h * (0.0012 + 0.002 * b.u) * lws); ctx.lineJoin = 'round'; ctx.stroke();
    },
    water(f, v, b) {
      const { ctx, h } = f; ctx.fillStyle = css(fogged(mix([52, 100, 150], PAPER, 0.12), (1 - b.u) * 0.4)); waterRects(ctx, b); ctx.fill();
      ctx.strokeStyle = css(mix(PAPER, air, 0.3), 0.75); ctx.lineWidth = Math.max(0.7, h * 0.0025); ctx.lineCap = 'round'; ripples(ctx, f, v, b, 2, h * 0.03 * (0.5 + b.u)); ctx.stroke();
    },
    plant(f, v, it) {
      const { ctx, h } = f, burnt = Math.min(1, f.era.dark * 1.2), fog = it.fog * 0.9;
      const col = t => css(fogged(mix(sat(mix(PLANT[t] || PLANT.leaf, t === 'leaf' ? [48, 92, 78] : t === 'leaf2' ? [96, 132, 82] : PAPER, 0.3), 0.8 + 0.4 * colr), [84, 78, 74], burnt * 0.8), fog));
      if (it.kind === 'fern') return S.fern(f, it, col('leaf'), col('leaf2'));
      paint(ctx, it.parts, PT(it), { fill: col, stroke: key(0.75 * (1 - fog)), lw: clamp(it.k * 0.03, 0.5, h * 0.003) * lws });
    },
    // ferns as curling claws, like the foam of a printed wave
    fern(f, it, c1, c2) {
      const { ctx, h } = f, R = rng(Math.imul(it.seed | 0, 2654435761)), n = 6, k = it.k;
      ctx.lineJoin = 'round'; ctx.strokeStyle = key(0.7 * (1 - it.fog)); ctx.lineWidth = clamp(k * 0.03, 0.5, h * 0.0028) * lws;
      for (let i = 0; i < n; i++) {
        const a = ((i * 2 + 1) % n / (n - 1) - 0.5) * 2.3 + (R() - 0.5) * 0.25, len = k * (0.75 + R() * 0.55), s = Math.sign(a) || 1, wd = len * 0.13;
        const tx = it.x + Math.sin(a) * len * 0.75 + it.sway * len * 0.08, ty = it.y - Math.cos(a) * len * 0.55 - len * 0.5, cr = len * 0.16;
        ctx.beginPath(); ctx.moveTo(it.x - s * wd * 0.2, it.y); ctx.quadraticCurveTo(it.x + Math.sin(a) * len * 0.1, ty - len * 0.15, tx, ty);
        ctx.arc(tx, ty + cr, cr, -Math.PI / 2, s > 0 ? Math.PI * 0.75 : Math.PI * 0.25, s < 0);
        ctx.quadraticCurveTo(tx - s * cr * 0.2, ty + cr * 0.5, tx - s * cr * 0.9, ty + cr * 0.9);
        ctx.quadraticCurveTo(it.x + Math.sin(a) * len * 0.12 + s * wd, ty + len * 0.3, it.x + s * wd * 0.8, it.y); ctx.closePath();
        ctx.fillStyle = i % 2 ? c1 : c2; ctx.fill(); ctx.stroke();
      }
    },
    dino(f, v, it) {
      const { ctx, h } = f, T = it.T, fog = (it.fog || 0) * 0.85, lw = clamp(Math.abs(T.k) * 0.05, 0.9, h * 0.0075) * lws;
      const pal = {}; for (const t of ['body', 'belly', 'far', 'mark', 'accent', 'accentFar', 'horn', 'eye', 'mouth']) pal[t] = css(mix(mix(mix(sat(toneRGB(it.sp, t), 0.55 + 0.6 * colr), PAPER, 0.1), [150, 176, 204], D.night * 0.5), air, fog));
      const ink = key(1), a = (it.fade ?? 1);
      ctx.globalAlpha = a * (1 - fog * 0.6); ctx.lineJoin = ctx.lineCap = 'round';
      wading(f, it, () => {
        outline(ctx, it.parts, T); ctx.fillStyle = ctx.strokeStyle = ink; ctx.lineWidth = lw * 2; ctx.stroke(); ctx.fill();
        ctx.save(); ctx.translate(lw * 0.25, lw * 0.75); ctx.lineWidth = lw * 1.5; ctx.stroke(); ctx.restore();      // the line swells on the under side
        paint(ctx, it.parts, T, { pal, stroke: ink, lw: lw * 0.42, pupilCol: ink, A: a });
      });
      if (it.wade) { ctx.strokeStyle = css(PAPER, 0.8); ctx.lineWidth = lw * 0.6; ctx.beginPath(); for (const s of [1, 0.6]) ctx.ellipse(T.x, it.waterY + lw, it.sp.len * T.k * 0.24 * s, it.sp.len * T.k * 0.022 * s, 0, 0, TAU); ctx.stroke(); }
      ctx.globalAlpha = 1;
    },
    over(f, v) {
      const { ctx, w, h } = f, s = h * 0.052, x = w - h * 0.1, y = h * 0.06, nn = 5;
      ctx.fillStyle = css(RED); ctx.fillRect(x - s * 0.72, y, s * 1.44, s * (nn * 1.18 + 0.5));
      ctx.strokeStyle = css(mix(PAPER, [255, 255, 255], 0.2)); ctx.lineWidth = Math.max(0.6, h * 0.0016); ctx.strokeRect(x - s * 0.58, y + s * 0.14, s * 1.16, s * (nn * 1.18 + 0.22));
      glyphs(ctx, x, y + s * 0.85, s * 0.9, nn, (E.opts.seed || 1) * 3, css(PAPER));
      ctx.fillStyle = css(mix(PAPER, [228, 196, 120], 0.7)); ctx.fillRect(x - s * 1.75, y + s * 0.4, s * 0.86, s * 3.4); ctx.strokeStyle = key(0.8); ctx.strokeRect(x - s * 1.75, y + s * 0.4, s * 0.86, s * 3.4);
      glyphs(ctx, x - s * 1.32, y + s * 0.95, s * 0.56, 4, (E.opts.seed || 1) * 7 + 2, key(0.9));
      seal(ctx, x - s * 1.32, y + s * 4.6, s * 0.9, RED, PAPER);
      grain(f, f.p.x2);
    }
  };
  return S;
}

// ================================================================ sumi-e
function sumie(E) {
  const PAPER = [241, 234, 217], INK = [26, 24, 26], RED = [186, 48, 38];
  let D, ink, inkA, paper, mistK;
  const S = {
    paper: PAPER, fire: RED, line: INK, soot: [60, 58, 60], sootA: 0.3,
    begin(f, v) { D = dayOf(v); inkA = 0.55 + 0.6 * f.p.x1; mistK = 0.5 + f.p.x3; paper = mix(PAPER, [150, 152, 160], D.night * 0.35); ink = INK; },
    sky(f, v) {
      const { ctx, w, h } = f; ctx.fillStyle = css(PAPER); ctx.fillRect(0, 0, w, h);
      const g = ctx.createLinearGradient(0, 0, 0, v.horizon); g.addColorStop(0, css(INK, 0.07 + D.night * 0.78 + v.dark * 0.4)); g.addColorStop(0.55, css(INK, 0.02 + D.night * 0.5 + v.dark * 0.3)); g.addColorStop(1, css(INK, D.night * 0.22 + v.dark * 0.15));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, v.horizon + 2);
    },
    sun(f, v) {
      const { ctx, h } = f, s = v.sun, r = h * 0.055;
      if (D.night > 0.6) { const g = ctx.createRadialGradient(s.x, s.y, r * 0.8, s.x, s.y, r * 2.2); g.addColorStop(0, css(PAPER, 0.5)); g.addColorStop(1, css(PAPER, 0)); ctx.fillStyle = g; ctx.fillRect(s.x - r * 3, s.y - r * 3, r * 6, r * 6); ctx.fillStyle = css(PAPER); }
      else ctx.fillStyle = css(RED, 0.72 * (1 - v.dark));
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.fill();
    },
    far(f, v, l, i) {
      const { ctx } = f, y0 = topY(l.pts), g = ctx.createLinearGradient(0, y0, 0, l.bottom), a = (0.2 + 0.16 * i) * inkA * (1 + D.night * 0.8);
      g.addColorStop(0, css(INK, a)); g.addColorStop(0.5, css(INK, a * 0.35)); g.addColorStop(1, css(INK, 0)); ctx.fillStyle = g; below(ctx, l.pts, l.bottom); ctx.fill();
    },
    ground(f, v, b, i) {
      const { ctx, h } = f, y0 = topY(b.pts), u = b.u, kd = kdOf(v, b);
      ctx.fillStyle = css(paper); below(ctx, b.pts, h + 2); ctx.fill();
      const g = ctx.createLinearGradient(0, y0, 0, y0 + h * (0.05 + 0.1 * u)); g.addColorStop(0, css(INK, (0.05 + 0.15 * u * u) * inkA)); g.addColorStop(1, css(INK, 0)); ctx.fillStyle = g; ctx.fill();
      // a dry brush dragged along the edge of the ground: broken, and moving with the land
      ctx.lineCap = 'butt'; ctx.lineJoin = 'round'; const z = h * (0.4 + u);
      for (let j = 0; j < 2; j++) {
        along(ctx, b.pts, j * h * 0.004 * (0.5 + u)); ctx.setLineDash(j ? [z * 0.05, z * 0.21, z * 0.11, z * 0.34] : [z * 0.16, z * 0.07, z * 0.03, z * 0.12, z * 0.25, z * 0.2]);
        ctx.lineDashOffset = v.camX * kd + i * 37; ctx.strokeStyle = css(INK, (j ? 0.22 : 0.12 + 0.45 * u) * inkA); ctx.lineWidth = Math.max(0.6, h * (j ? 0.006 : 0.0028) * (0.4 + u)); ctx.stroke();
      }
      ctx.setLineDash([]);
    },
    water(f, v, b) {
      const { ctx, h } = f; ctx.fillStyle = css(mix(paper, [120, 126, 130], 0.3)); waterRects(ctx, b, 1); ctx.fill();
      ctx.strokeStyle = css(INK, 0.22 * inkA); ctx.lineWidth = Math.max(0.6, h * 0.002); ripples(ctx, f, v, b, 2, h * 0.05 * (0.4 + b.u)); ctx.stroke();
    },
    plant(f, v, it) {
      const fa = clamp(1 - it.fog * 1.25 * mistK) * inkA, { ctx } = f, T = PT(it), tall = it.kind !== 'rock' && it.kind !== 'boulder' && it.kind !== 'nest' && it.kind !== 'log';
      if (fa < 0.03) return;
      // one wet mass per plant (no darker overlaps), the trunk loaded with more ink, stems as single strokes
      outline(ctx, it.parts, T); ctx.fillStyle = css(INK, (tall ? 0.42 : 0.2) * fa); ctx.fill();
      ctx.beginPath(); let any = 0; for (const q of it.parts) if (!q.l && (q.t === 'trunk' || q.t === 'leaf' && q.c)) { trace(ctx, q, T); any = 1; } if (any) { ctx.fillStyle = css(INK, 0.3 * fa); ctx.fill(); }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const q of it.parts) { if (q.l) { ctx.beginPath(); trace(ctx, q, T); ctx.strokeStyle = css(INK, (q.t === 'leaf2' ? 0.4 : 0.7) * fa); ctx.lineWidth = Math.max(0.6, q.w * it.k); ctx.stroke(); } else if (q.t === 'flower') { ctx.beginPath(); trace(ctx, q, T); ctx.fillStyle = css(RED, 0.6 * fa); ctx.fill(); } }
    },
    dino(f, v, it) {
      const { ctx } = f, T = it.T, k = Math.abs(T.k), fa = (it.fade ?? 1) * clamp(1 - (it.fog || 0) * 1.1 * mistK, 0.12, 1) * inkA;
      const c = mix(INK, mul(toneRGB(it.sp, 'body'), 0.45), f.p.x4 * 0.8), A = { body: 0.8, far: 0.42, mark: 0.45, accent: 0.6, accentFar: 0.3, horn: 0.9, mouth: 0.8 };
      ctx.lineJoin = ctx.lineCap = 'round';
      wading(f, it, () => {
        outline(ctx, it.parts, T); ctx.strokeStyle = css(c, 0.1 * fa); ctx.lineWidth = k * 0.2; ctx.stroke(); ctx.lineWidth = k * 0.08; ctx.stroke(); ctx.fillStyle = css(paper, it.fade ?? 1); ctx.fill();       // the wet edge bleeding into the paper
        paint(ctx, it.parts, T, { fill: t => t === 'belly' ? css(PAPER, 0.4) : t === 'eye' ? css(PAPER, 0.95) : t === 'mouth' ? css(RED, 0.8 * fa) : css(c, Math.min(1, (A[t] ?? 0.7) * fa)), alpha: { mark: 1 }, pupil: false });
        if (it.type === 'dino' && k * it.sp.len > 30) {                 // dry-brush streaks of bare paper along the body, and one loaded stroke down the back
          const q = it.pose, z = k * it.sp.len * 0.1;
          ctx.strokeStyle = css(PAPER, 0.5); ctx.lineCap = 'butt';
          [[0.55, [z * 1.6, z * 0.5, z * 0.3, z * 0.9]], [0.1, [z * 0.7, z * 1.1, z * 1.4, z * 0.6]], [-0.35, [z * 0.4, z * 1.5]]].forEach(([o, d], j) => { ctx.beginPath(); poly(ctx, spine(q, T, o, 2, q.iEnd - 1)); ctx.setLineDash(d); ctx.lineDashOffset = it.actor.id * 13 + j * 7; ctx.lineWidth = Math.max(0.5, k * (0.03 - j * 0.006)); ctx.stroke(); });
          ctx.beginPath(); poly(ctx, spine(q, T, 0.98, 1, q.iEnd)); ctx.setLineDash([z * 3, z * 0.25, z * 1.2, z * 0.5]); ctx.strokeStyle = css(INK, 0.85 * fa); ctx.lineWidth = Math.max(0.6, k * 0.035); ctx.stroke(); ctx.setLineDash([]);
        }
      });
      if (it.wade) { ctx.strokeStyle = css(INK, 0.3 * fa); ctx.lineWidth = Math.max(0.6, k * 0.03); ctx.beginPath(); ctx.ellipse(T.x, it.waterY + 1, it.sp.len * k * 0.26, it.sp.len * k * 0.02, 0, 0.2, 2.6); ctx.stroke(); }
    },
    over(f, v) {
      const { ctx, w, h } = f, s = h * 0.05;
      glyphs(ctx, w * 0.07, h * 0.1, s, 4, (E.opts.seed || 1) * 5, css(D.night > 0.5 ? PAPER : INK, 0.85));
      seal(ctx, w * 0.07, h * 0.1 + s * 4.9, s * 0.95, RED, PAPER);
      if (D.night > 0.02) tint(f, [20, 22, 34], D.night * 0.12);
      grain(f, f.p.x2);
    }
  };
  return S;
}

// ================================================================ shan shui scroll
function shanshui(E) {
  const SILK = [228, 214, 180], INK = [36, 44, 42], AZ = [50, 104, 122], MAL = [92, 138, 108], RED = [176, 50, 38];
  let D, inkA, mist, silk;
  const S = {
    paper: SILK, fire: RED, line: INK, soot: [52, 50, 48],
    begin(f, v) { D = dayOf(v); inkA = 0.5 + 0.7 * f.p.x1; mist = f.p.x3; silk = mix(mix(SILK, [232, 180, 130], D.dusk * 0.3), [96, 106, 122], D.night * 0.7); },
    sky(f, v) {
      const { ctx, w, h } = f, g = ctx.createLinearGradient(0, 0, 0, v.horizon); g.addColorStop(0, css(mix(silk, [150, 130, 96], 0.3 + v.dark * 0.4))); g.addColorStop(0.6, css(silk)); g.addColorStop(1, css(mix(silk, [246, 238, 216], 0.5 * (1 - D.night))));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    },
    sun(f, v) { const { ctx, h } = f, s = v.sun; ctx.fillStyle = D.night > 0.6 ? css([240, 236, 214], 0.9) : css(RED, 0.6 * (1 - v.dark)); ctx.beginPath(); ctx.arc(s.x, s.y, h * 0.032, 0, TAU); ctx.fill(); },
    // our own peaks: steep, layered, each fading into the mist at its foot
    peaks(f, v) {
      const { ctx, w, h } = f, hz = v.horizon, sd = (E.opts.seed || 0) * 3.7;
      for (let j = 0; j < 3; j++) {
        const pts = [], par = 0.015 + 0.03 * j, fr = 2.3 + j * 0.8, amp = 0.5 - 0.11 * j;
        for (let c = -1; c <= 81; c++) {
          const px = c / 80 * w, u = px / h * fr + v.camX / v.viewM * par + sd + j * 13.1, n = fbm2(u, j * 7.3, 3);
          const spire = Math.pow(1 - Math.abs(2 * fract(u * 0.9 + 0.3 * noise2(u * 0.6, j)) - 1), 1.6), pk = clamp(n * 1.7 - 0.4) * (0.22 + 0.95 * spire * spire) + 0.04 * noise2(u * 9, 3);
          pts.push([px, hz - h * (0.02 + amp * pk)]);
        }
        const c = mix(mix(AZ, MAL, j * 0.4), silk, 0.5 - 0.17 * j), g = ctx.createLinearGradient(0, hz - h * amp * 0.8, 0, hz + h * 0.01);
        g.addColorStop(0, css(mix(c, INK, 0.25), 0.9)); g.addColorStop(0.45, css(c, 0.7)); g.addColorStop(0.85, css(mix(c, silk, 0.6), 0.12 + 0.3 * (1 - mist))); g.addColorStop(1, css(silk, 0));
        ctx.fillStyle = g; below(ctx, pts, hz + 2); ctx.fill();
        along(ctx, pts); ctx.strokeStyle = css(INK, (0.25 + 0.15 * j) * inkA); ctx.lineWidth = Math.max(0.5, h * 0.0016); ctx.lineJoin = 'round'; ctx.stroke();
      }
    },
    far(f, v, l, i) {
      const { ctx } = f, y0 = topY(l.pts), c = mix(MAL, silk, 0.45 - i * 0.15), g = ctx.createLinearGradient(0, y0, 0, l.bottom);
      g.addColorStop(0, css(c, 0.85)); g.addColorStop(1, css(mix(c, silk, 0.8), 0.25)); ctx.fillStyle = g; below(ctx, l.pts, l.bottom); ctx.fill();
    },
    pre(f, v) { if (!f.backdrop) S.mistBand(f, v.horizon - f.h * 0.035, f.h * 0.06, 0.75); },
    mistBand(f, y, hh, a) {
      if (mist < 0.04) return; const { ctx, w } = f, g = ctx.createLinearGradient(0, y - hh, 0, y + hh), c = mix(silk, [250, 244, 226], 0.5 * (1 - D.night));
      g.addColorStop(0, css(c, 0)); g.addColorStop(0.5, css(c, Math.min(1, a * mist * 1.5))); g.addColorStop(1, css(c, 0)); ctx.fillStyle = g; ctx.fillRect(0, y - hh, w, hh * 2);
    },
    ground(f, v, b, i) {
      const { ctx, h } = f, y0 = topY(b.pts), base = mix(sat(gRGB(f, v, b.u), 0.8), b.u < 0.4 ? AZ : MAL, 0.3), c = mix(base, silk, 0.42 - 0.1 * b.u);
      ctx.fillStyle = css(mix(c, silk, 0.6)); below(ctx, b.pts, h + 2); ctx.fill();
      const g = ctx.createLinearGradient(0, y0, 0, Math.max(b.next, y0 + h * 0.03) + h * 0.03); g.addColorStop(0, css(mix(c, INK, 0.12))); g.addColorStop(0.5, css(c, 0.7)); g.addColorStop(1, css(c, 0.05 + 0.5 * (1 - mist)));
      ctx.fillStyle = g; ctx.fill();
      along(ctx, b.pts); ctx.strokeStyle = css(INK, (0.3 + 0.3 * b.u) * inkA); ctx.lineWidth = Math.max(0.5, h * (0.001 + 0.0016 * b.u)); ctx.lineJoin = 'round'; ctx.stroke();
    },
    water(f, v, b) { const { ctx, h } = f; ctx.fillStyle = css(mix(silk, [140, 176, 176], 0.5)); waterRects(ctx, b, 1); ctx.fill(); ctx.strokeStyle = css(INK, 0.25); ctx.lineWidth = Math.max(0.5, h * 0.0016); ripples(ctx, f, v, b, 2, h * 0.04 * (0.4 + b.u)); ctx.stroke(); },
    plant(f, v, it) {
      const fog = clamp(it.fog * (0.7 + 0.8 * mist)), burnt = Math.min(1, f.era.dark * 1.2);
      const C = { trunk: mix(INK, [80, 60, 44], 0.4), leaf: mix(INK, MAL, 0.45), leaf2: mix(INK, MAL, 0.75), flower: [214, 150, 140], rock: mix(AZ, silk, 0.45), rock2: mix(AZ, silk, 0.7), egg: [240, 234, 214], bone: [240, 234, 214] };
      paint(f.ctx, it.parts, PT(it), { fill: t => css(mix(mix(C[t] || C.leaf, [70, 66, 62], burnt * 0.8), silk, fog)) });
    },
    dino(f, v, it) {
      const { ctx, h } = f, T = it.T, k = Math.abs(T.k), fog = clamp((it.fog || 0) * (0.6 + 0.8 * mist), 0, 0.85), lw = clamp(k * 0.035, 0.7, h * 0.004) * (0.5 + f.p.x1);
      const pal = {}; for (const t of ['body', 'belly', 'far', 'mark', 'accent', 'accentFar', 'horn', 'eye', 'mouth']) pal[t] = css(mix(mix(sat(toneRGB(it.sp, t), 0.5 + 0.6 * f.p.x4), silk, 0.3), silk, fog));
      const line = css(mix(INK, silk, fog * 0.8));
      ctx.globalAlpha = it.fade ?? 1; ctx.lineJoin = ctx.lineCap = 'round';
      wading(f, it, () => { outline(ctx, it.parts, T); ctx.strokeStyle = ctx.fillStyle = line; ctx.lineWidth = lw * 2; ctx.stroke(); ctx.fill(); paint(ctx, it.parts, T, { pal, stroke: line, lw: lw * 0.4, pupilCol: line, A: it.fade ?? 1 }); });
      ctx.globalAlpha = 1;
    },
    over(f, v) {
      const { ctx, w, h } = f, bh = h * 0.05, s = h * 0.036;
      if (!f.combo) S.mistBand(f, v.horizon - h * 0.2, h * 0.05, 0.35);
      glyphs(ctx, w * 0.045, bh + h * 0.07, s, 6, (E.opts.seed || 1) * 9, css(INK, 0.85)); glyphs(ctx, w * 0.045 + s * 1.3, bh + h * 0.07, s * 0.8, 4, (E.opts.seed || 1) * 4, css(INK, 0.7));
      seal(ctx, w * 0.045 + s * 1.3, bh + h * 0.07 + s * 4.3, s, RED, SILK);
      if (D.night > 0.02) tint(f, [24, 30, 52], D.night * 0.3);
      grain(f, f.p.x2 * 1.2);
      // the brocade mount of the scroll, top and bottom
      for (const y of [0, h - bh]) {
        ctx.fillStyle = css([44, 62, 70]); ctx.fillRect(0, y, w, bh); ctx.fillStyle = css([196, 160, 92]); ctx.fillRect(0, y ? y : bh - h * 0.006, w, h * 0.006);
        ctx.strokeStyle = css([196, 160, 92], 0.55); ctx.lineWidth = Math.max(0.6, h * 0.0016); ctx.beginPath(); const d = bh * 0.5, y1 = y ? y + h * 0.006 + (bh - h * 0.006) / 2 : (bh - h * 0.006) / 2, off = fract(v.camX / v.viewM * 0.5) * d * 2;
        for (let x = -off; x < w + d; x += d * 2) { ctx.moveTo(x, y1 - d * 0.5); ctx.lineTo(x + d * 0.5, y1); ctx.lineTo(x, y1 + d * 0.5); ctx.lineTo(x - d * 0.5, y1); ctx.closePath(); ctx.moveTo(x + d + d * 0.12, y1); ctx.arc(x + d, y1, d * 0.12, 0, TAU); }
        ctx.stroke();
      }
    }
  };
  return S;
}

// ================================================================ linocut
function linocut(E) {
  const K0 = [24, 22, 22], P0 = [240, 230, 208], C1 = hx(E.opts.ink2 || '#c2502c'), C2 = hx(E.opts.ink3 || '#d9a441');
  const R = rng(4242), gouges = []; for (let i = 0; i < 520; i++) gouges.push([R() * TAU, 0.1 + Math.pow(R(), 0.7) * 1.5, 0.4 + R(), R()]);
  let D, K, P, A, B, mx, my, lws, night;
  const S = {
    paper: P0, fire: C1, line: K0, soot: [24, 22, 22], sootA: 0.3,
    begin(f, v) {
      D = dayOf(v); night = D.night > 0.5; lws = 0.5 + f.p.x1; K = K0; P = P0; const dull = c => mix(sat(c, Math.min(1, f.p.x4 * 2)), [96, 90, 86], Math.min(1, v.dark * 0.9 + D.night * 0.35));
      A = dull(C1); B = dull(C2); mx = f.h * 0.0045; my = f.h * 0.003;
    },
    sky(f, v) {
      const { ctx, w, h } = f, s = v.sun, m = f.p.x3; ctx.fillStyle = css(night ? K : P); ctx.fillRect(0, 0, w, h);
      // what the gouge left standing when the sky was cleared: short ridges swirling round the sun
      ctx.strokeStyle = css(night ? P : K); ctx.lineCap = 'round'; ctx.lineWidth = Math.max(0.8, h * 0.0034 * lws); ctx.beginPath();
      const n = Math.round(gouges.length * clamp(0.25 + m * 0.9));
      for (let i = 0; i < n; i++) { const [a, r, l, q] = gouges[i], rr = h * r, x = s.x + Math.cos(a) * rr * 1.25, y = s.y + Math.sin(a) * rr; if (y > v.horizon || y < -9 || x < -9 || x > w + 9 || rr < h * 0.11) continue; const da = h * 0.02 * l / rr * (0.6 + r); ctx.moveTo(x, y); ctx.lineTo(s.x + Math.cos(a + da) * rr * 1.25, s.y + Math.sin(a + da) * rr + (q - 0.5) * h * 0.004); }
      ctx.stroke();
    },
    sun(f, v) {
      const { ctx, h } = f, s = v.sun, r = h * 0.06; ctx.fillStyle = css(night ? P : B); ctx.beginPath(); ctx.arc(s.x + mx * 1.4, s.y + my * 1.4, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = css(night ? P : K); ctx.lineWidth = Math.max(1, h * 0.005 * lws); ctx.beginPath(); ctx.arc(s.x, s.y, r, 0.5, TAU - 0.4); ctx.stroke();
    },
    far(f, v, l, i) {
      const { ctx, h } = f; ctx.fillStyle = css(i ? K : mix(K, P, night ? 0.3 : 0)); below(ctx, l.pts, l.bottom); ctx.fill();
      ctx.strokeStyle = css(P); ctx.lineCap = 'butt'; ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(0.7, h * 0.0028);
      for (let j = 0; j < 3; j++) { along(ctx, l.pts, h * (0.006 + 0.016 * j + (night ? -0.004 : 0))); ctx.setLineDash([h * (0.05 + 0.03 * j), h * (0.012 + 0.012 * j)]); ctx.lineDashOffset = v.camX * (i ? 1.2 : 0.5) + j * 31 + i * 17; ctx.stroke(); }
      ctx.setLineDash([]);
    },
    ground(f, v, b, i) {
      const { ctx, h } = f, kd = kdOf(v, b), u = b.u;
      ctx.save(); ctx.translate(mx, my); ctx.fillStyle = css(u < 0.42 ? B : A); below(ctx, b.pts, h + 2); ctx.fill(); ctx.restore();
      ctx.lineJoin = 'round'; ctx.lineCap = 'butt'; along(ctx, b.pts); ctx.strokeStyle = css(K); ctx.lineWidth = Math.max(1, h * (0.002 + 0.004 * u) * lws); ctx.stroke();
      const z = h * (0.3 + u), gap = Math.max(h * 0.012, (b.next - b.level) * 0.3);
      for (let j = 1; j <= 2; j++) { along(ctx, b.pts, gap * j * 0.9); ctx.setLineDash(j === 1 ? [z * 0.07, z * 0.03, z * 0.12, z * 0.05] : [z * 0.04, z * 0.09]); ctx.lineDashOffset = v.camX * kd + i * 41 + j * 13; ctx.strokeStyle = css(j === 1 ? K : P, j === 1 ? 0.9 : 0.8); ctx.lineWidth = Math.max(0.7, h * 0.003 * (0.4 + u)); ctx.stroke(); }
      ctx.setLineDash([]);
    },
    water(f, v, b) { const { ctx, h } = f; ctx.fillStyle = css(P); waterRects(ctx, b, h * 0.003); ctx.fill(); ctx.strokeStyle = css(K); ctx.lineWidth = Math.max(0.8, h * 0.003); ctx.lineCap = 'round'; ripples(ctx, f, v, b, 3, h * 0.035 * (0.4 + b.u)); ctx.stroke(); },
    plant(f, v, it) {
      const { ctx, h } = f, T = PT(it), big = it.k > h * 0.012;
      if (big) { ctx.save(); ctx.translate(mx, my); paint(ctx, it.parts, T, { fill: t => t === 'leaf2' || t === 'flower' || t === 'rock2' || t === 'egg' ? css(t === 'flower' || t === 'egg' ? P : B) : null }); ctx.restore(); }
      paint(ctx, it.parts, T, { fill: t => t === 'leaf2' || t === 'flower' || t === 'rock2' || t === 'egg' ? (big ? null : css(K)) : css(K) });
      if (big && (it.kind === 'rock' || it.kind === 'boulder' || it.kind === 'nest')) { outline(ctx, it.parts, T); ctx.strokeStyle = css(K); ctx.lineWidth = Math.max(1, h * 0.003); ctx.stroke(); }
    },
    dino(f, v, it) {
      const { ctx, h } = f, T = it.T, k = Math.abs(T.k), sz = k * it.sp.len, tiny = sz < h * 0.05, fly = it.type !== 'dino', fa = it.fade ?? 1;
      ctx.globalAlpha = fa; ctx.lineJoin = ctx.lineCap = 'round';
      wading(f, it, () => {
        outline(ctx, it.parts, T);
        if (!fly || !night) { ctx.strokeStyle = ctx.fillStyle = css(P); ctx.lineWidth = clamp(k * 0.11, 2, h * 0.012); ctx.stroke(); }        // cleared wood round the figure
        if (tiny || fly) { ctx.fillStyle = css(fly && night ? P : K); ctx.fill(); return; }
        ctx.save(); ctx.translate(mx * 1.3, my * 1.3); ctx.fillStyle = css(B); ctx.fill(); ctx.restore();
        const col = { belly: B, accent: A, accentFar: mix(A, K, 0.45), horn: P, eye: P, mouth: A };
        paint(ctx, it.parts, T, { fill: (t, q) => col[t] || t === 'mark' ? null : css(K), A: fa });
        ctx.save(); ctx.translate(mx, my); paint(ctx, it.parts, T, { fill: t => col[t] ? css(col[t]) : null, pupilCol: css(K), A: fa }); ctx.restore(); ctx.globalAlpha = fa;
        // white lines cut along the body, broken like gouge strokes; stripes and spots cut out too
        const q = it.pose, z = sz * 0.1; ctx.strokeStyle = css(P); ctx.lineCap = 'butt';
        [[0.62, [z * 1.3, z * 0.35]], [0.22, [z * 0.8, z * 0.5, z * 0.4, z * 0.5]], [-0.12, [z * 0.5, z * 0.7]]].forEach(([o, d], j) => { ctx.beginPath(); poly(ctx, spine(q, T, o, 1, q.iEnd - 1)); ctx.setLineDash(d); ctx.lineDashOffset = j * z * 0.6; ctx.lineWidth = Math.max(0.8, k * (0.034 - j * 0.007)); ctx.stroke(); });
        ctx.setLineDash([]); ctx.lineWidth = Math.max(0.7, k * 0.022); ctx.beginPath(); for (const p of it.parts) if (p.k === 'mark' && !p.l || p.k === 'leg' && p.t === 'body' || p.k === 'jaw') trace(ctx, p, T); ctx.stroke();
      });
      if (it.wade) { ctx.strokeStyle = css(K); ctx.lineWidth = Math.max(1, h * 0.003); ctx.beginPath(); ctx.ellipse(T.x, it.waterY + 1, sz * 0.26, sz * 0.02, 0, 0, TAU); ctx.stroke(); }
      ctx.globalAlpha = 1;
    },
    over(f, v) {
      grain(f, f.p.x2 * 0.9);
      if (f.combo) return;
      const { ctx, w, h } = f, m = h * 0.028; ctx.fillStyle = css(P0); ctx.beginPath(); ctx.rect(0, 0, w, h);          // the paper margin, with a slightly ragged block edge
      ctx.moveTo(m, m); for (let y = m; y <= h - m; y += h * 0.04) ctx.lineTo(m + (hash(y, 1) - 0.5) * h * 0.004, y);
      for (let x = m; x <= w - m; x += h * 0.04) ctx.lineTo(x, h - m + (hash(x, 2) - 0.5) * h * 0.004);
      for (let y = h - m; y >= m; y -= h * 0.04) ctx.lineTo(w - m + (hash(y, 3) - 0.5) * h * 0.004, y);
      for (let x = w - m; x >= m; x -= h * 0.04) ctx.lineTo(x, m + (hash(x, 4) - 0.5) * h * 0.004);
      ctx.closePath(); ctx.fill('evenodd');
    }
  };
  return S;
}

// ================================================================ Victorian steel engraving
function engraving(E) {
  const SEP = [62, 44, 30], CREAM = [244, 236, 214];
  let D, pat = null, patH = 0, lws, sp, colr;
  const pats = (ctx, h) => {
    if (pat && patH === h) return; patH = h; sp = Math.max(2.4, h / 190); const lw = Math.max(0.55, h / 1300), col = css(SEP);
    pat = { a: hatch(ctx, sp * 2 * 1.414, 2, col, lw, 'diag'), x: hatch(ctx, sp * 2 * 1.414, 2, col, lw, 'cross'), l: hatch(ctx, sp * 2.4, 2, col, lw, 'level'), f: hatch(ctx, sp * 3 * 1.414, 2, col, lw * 0.8, 'diag') };
  };
  const shadeBody = (ctx, q, T, k) => {            // ruled lines that wrap the body: dense under the belly, crossed in the deepest shade
    const n = q.nodes, sx = k * T.dir, X = (x) => T.x + x * sx, Y = y => T.y - y * k;
    for (let pass = 0; pass < 3; pass++) {
      const step = sp * (pass === 2 ? 2.4 : 1.25), frac = pass === 0 ? 0.62 : pass === 1 ? 0.3 : 0.1, bend = pass === 1 ? -0.35 : 0.3; ctx.beginPath();
      for (let i = 0; i < n.length - 1; i++) {
        const a = n[i], b = n[i + 1]; let tx = b.x - a.x, ty = b.y - a.y; const d = Math.hypot(tx, ty) || 1; tx /= d; ty /= d;
        const m = Math.max(1, Math.round(d * k / step));
        for (let j = 0; j < m; j++) {
          const u = j / m, r = lerp(a.r, b.r, u), rb = lerp(a.b ?? a.r, b.b ?? b.r, u); if (r * k < 1.6) continue;
          const x = lerp(a.x, b.x, u), y = lerp(a.y, b.y, u), wob = 0.85 + 0.3 * hash(i * 31 + j, pass);
          let x0, y0, x1, y1;
          if (pass < 2) { x0 = x + ty * rb * 0.97; y0 = y - tx * rb * 0.97; const e = -rb + (r + rb) * frac * wob; x1 = x - ty * e; y1 = y + tx * e; }
          else { x0 = x - ty * r * 0.97; y0 = y + tx * r * 0.97; const e = r * (1 - 2 * frac * wob); x1 = x - ty * e; y1 = y + tx * e; }
          ctx.moveTo(X(x0), Y(y0)); ctx.quadraticCurveTo(X((x0 + x1) / 2 + tx * r * bend), Y((y0 + y1) / 2 + ty * r * bend), X(x1), Y(y1));
        }
      }
      ctx.stroke();
    }
  };
  const S = {
    paper: CREAM, fire: SEP, line: SEP, soot: [70, 54, 40], sootA: 0.25,
    begin(f, v) { D = dayOf(v); pats(f.ctx, f.h); lws = 0.5 + f.p.x1; colr = f.p.x4; },
    sky(f, v) {
      const { ctx, w, h } = f; ctx.fillStyle = css(CREAM); ctx.fillRect(0, 0, w, h);
      const n = Math.round(v.horizon / (sp * 1.5)), dk = D.night * 0.6 + v.dark * 0.5; ctx.strokeStyle = css(SEP); ctx.lineWidth = Math.max(0.5, h / 1300);
      for (let i = 0; i < n; i++) { const u = i / n, a = (Math.pow(1 - u, 1.6) * 0.6 + dk) * (0.5 + 0.5 * lws); if (a < 0.03) continue; ctx.globalAlpha = Math.min(1, a); ctx.beginPath(); ctx.moveTo(0, i * sp * 1.5 + 1); ctx.lineTo(w, i * sp * 1.5 + 1); ctx.stroke(); }
      ctx.globalAlpha = 1;
      if (dk > 0.2) { ctx.globalAlpha = Math.min(1, dk); ctx.fillStyle = pat.a; ctx.fillRect(0, 0, w, v.horizon); ctx.globalAlpha = 1; }
      // banks of cloud left white, with a ruled shadow under each
      for (let i = 0; i < 4; i++) {
        const cw = h * (0.2 + 0.16 * hash(i, 3, E.opts.seed)), cx = fract(hash(i, 1, E.opts.seed) + f.t * 0.0015 - v.camX * 0.0005) * (w + cw * 2) - cw, cy = v.horizon * (0.2 + 0.5 * hash(i, 2, E.opts.seed));
        ctx.fillStyle = css(CREAM); ctx.beginPath(); for (let j = 0; j < 5; j++) { const u = j / 4 - 0.5; ctx.moveTo(cx + u * cw * 1.5 + cw * 0.3, cy); ctx.arc(cx + u * cw * 1.5, cy - cw * 0.1 * (1 - 3 * u * u), cw * (0.3 - 0.3 * u * u), 0, TAU); } ctx.fill();
        ctx.strokeStyle = css(SEP, 0.7); ctx.beginPath(); for (let j = 0; j < 4; j++) { const yy = cy + cw * 0.1 + j * sp * 1.5, hw2 = cw * (0.8 - j * 0.17); ctx.moveTo(cx - hw2, yy); ctx.lineTo(cx + hw2, yy); } ctx.stroke();
      }
    },
    sun(f, v) {
      const { ctx, h } = f, s = v.sun, r = h * 0.04; ctx.fillStyle = css(CREAM); ctx.strokeStyle = css(SEP); ctx.lineWidth = Math.max(0.6, h / 900);
      ctx.beginPath(); ctx.arc(s.x, s.y, r * 1.5, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.stroke();
      ctx.beginPath(); if (D.night > 0.6) ctx.arc(s.x + r * 0.35, s.y - r * 0.1, r * 0.85, 0.9, 4.4, true); else for (let i = 0; i < 40; i++) { const a = i / 40 * TAU, r1 = r * (i % 2 ? 2.1 : 2.8); ctx.moveTo(s.x + Math.cos(a) * r * 1.3, s.y + Math.sin(a) * r * 1.3); ctx.lineTo(s.x + Math.cos(a) * r1, s.y + Math.sin(a) * r1); } ctx.stroke();
    },
    far(f, v, l, i) {
      const { ctx, h } = f; ctx.fillStyle = css(CREAM); below(ctx, l.pts, l.bottom); ctx.fill(); ctx.globalAlpha = 0.4 + 0.25 * i; ctx.fillStyle = i ? pat.a : pat.f; ctx.fill(); ctx.globalAlpha = 1;
      along(ctx, l.pts); ctx.strokeStyle = css(SEP, 0.7); ctx.lineWidth = Math.max(0.5, h / 1000); ctx.lineJoin = 'round'; ctx.stroke();
    },
    ground(f, v, b, i) {
      const { ctx, h } = f, u = b.u; ctx.fillStyle = css(CREAM); below(ctx, b.pts, h + 2); ctx.fill();
      ctx.globalAlpha = clamp(0.28 + 0.6 * u); ctx.fillStyle = pat.l; ctx.fill();
      if (i % 2) { ctx.globalAlpha = clamp(0.12 + 0.4 * u); ctx.fillStyle = pat.f; ctx.fill(); }
      ctx.globalAlpha = 1; along(ctx, b.pts); ctx.strokeStyle = css(SEP, 0.5 + 0.5 * u); ctx.lineWidth = Math.max(0.5, h * (0.0009 + 0.0014 * u) * lws); ctx.lineJoin = 'round'; ctx.stroke();
    },
    water(f, v, b) { const { ctx, h } = f; ctx.fillStyle = css(CREAM); waterRects(ctx, b, 1); ctx.fill(); ctx.strokeStyle = css(SEP, 0.8); ctx.lineWidth = Math.max(0.5, h / 1100); ripples(ctx, f, v, b, 5, h * 0.05 * (0.4 + b.u)); ctx.stroke(); },
    plant(f, v, it) {
      const { ctx, h } = f, T = PT(it), a = clamp(1 - it.fog * 0.9, 0.25, 1), P2 = { trunk: pat.x, leaf: pat.a, rock: pat.f, leaf2: pat.f };
      ctx.lineJoin = ctx.lineCap = 'round'; outline(ctx, it.parts, T); ctx.strokeStyle = css(mix(SEP, CREAM, 1 - a)); ctx.lineWidth = clamp(it.k * 0.04, 0.9, h * 0.0036) * lws; ctx.stroke(); ctx.fillStyle = css(CREAM); ctx.fill();
      if (colr > 0.03) { ctx.globalAlpha = colr * 0.5; ctx.fillStyle = css(it.kind === 'rock' || it.kind === 'boulder' ? [150, 140, 124] : [96, 128, 76]); ctx.fill(); }
      ctx.globalAlpha = a; ctx.strokeStyle = css(SEP);
      for (const t in P2) { let any = 0; ctx.beginPath(); for (const q of it.parts) if (q.t === t && !q.l) { trace(ctx, q, T); any = 1; } if (any) { ctx.fillStyle = P2[t]; ctx.globalAlpha = a * (t === 'leaf2' ? 0.45 : 0.75); ctx.fill(); } }
      ctx.globalAlpha = a; for (const q of it.parts) if (q.l) { ctx.beginPath(); trace(ctx, q, T); ctx.lineWidth = Math.max(0.5, q.w * it.k); ctx.stroke(); }
      ctx.globalAlpha = 1;
    },
    dino(f, v, it) {
      const { ctx, h } = f, T = it.T, k = Math.abs(T.k), fa = (it.fade ?? 1), far = clamp(1 - (it.fog || 0) * 0.8, 0.3, 1), lw = clamp(k * 0.028, 0.6, h * 0.0034) * lws, line = css(SEP);
      const tp = { far: pat.x, accentFar: pat.x, mark: pat.a, accent: pat.f, mouth: pat.x }, ta = { far: 0.95, accentFar: 0.8, mark: 0.9, accent: 0.8, mouth: 1 };
      ctx.lineJoin = ctx.lineCap = 'round';
      wading(f, it, () => {
        ctx.globalAlpha = fa; outline(ctx, it.parts, T); ctx.fillStyle = css(CREAM); ctx.fill(); ctx.strokeStyle = line; ctx.lineWidth = lw * 2.2; ctx.stroke();
        for (const q of it.parts) {
          ctx.beginPath(); trace(ctx, q, T);
          if (q.l) { ctx.strokeStyle = line; ctx.lineWidth = Math.max(0.5, q.w * k); ctx.stroke(); continue; }
          if (q.k === 'eye') { ctx.fillStyle = line; ctx.fill(); continue; }
          if (q.k !== 'mark' && q.k !== 'belly') { ctx.fillStyle = css(CREAM); ctx.fill(); }
          if (colr > 0.03 && q.k !== 'belly') { ctx.globalAlpha = fa * colr * (q.k === 'mark' ? 0.3 : 0.55); ctx.fillStyle = css(toneRGB(it.sp, q.t)); ctx.fill(); }      // hand colouring
          if (tp[q.t]) { ctx.globalAlpha = fa * ta[q.t] * far; ctx.fillStyle = tp[q.t]; ctx.fill(); }
          ctx.globalAlpha = fa;
          if (q.k !== 'mark' && q.k !== 'belly') { ctx.strokeStyle = line; ctx.lineWidth = lw * 0.7; ctx.stroke(); }
          if (q.k === 'body' && it.type === 'dino' && k * it.sp.len > 24) { ctx.strokeStyle = line; ctx.lineWidth = Math.max(0.5, h / 1300); ctx.globalAlpha = fa * far; ctx.save(); ctx.clip(); shadeBody(ctx, it.pose, T, k); ctx.restore(); ctx.globalAlpha = fa; }
          else if ((q.k === 'leg' || q.k === 'skull' || q.k === 'jaw' || q.k === 'arm') && q.t === 'body') { ctx.globalAlpha = fa * 0.55 * far; ctx.fillStyle = pat.f; ctx.fill(); ctx.globalAlpha = fa; }
        }
      });
      if (it.type === 'dino' && !it.wade) { const q = it.pose, L = it.sp.len * q.scale * k; ctx.globalAlpha = fa * 0.8; ctx.strokeStyle = line; ctx.lineWidth = Math.max(0.5, h / 1200); ctx.beginPath(); for (let j = 0; j < 4; j++) { const y = T.y + j * sp * 1.1 + 1, hw2 = L * (0.3 - j * 0.05); ctx.moveTo(T.x - hw2 + L * 0.1 * T.dir, y); ctx.lineTo(T.x + hw2 + L * 0.1 * T.dir, y); } ctx.stroke(); }
      ctx.globalAlpha = 1;
    },
    over(f, v) {
      const { ctx, w, h } = f, m = f.p.x3;
      if (D.night > 0.02) tint(f, [44, 34, 30], D.night * 0.22);
      grain(f, f.p.x2);
      // the oval vignette: the plate fades into bare paper
      ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.translate(w / 2, h * 0.47); ctx.scale(w * 0.5, h * 0.5);
      const g = ctx.createRadialGradient(0, 0, lerp(1.0, 0.7, m), 0, 0, lerp(1.25, 0.95, m)); g.addColorStop(0, css(CREAM, 0)); g.addColorStop(0.6, css(CREAM, 0.8)); g.addColorStop(1, css(CREAM, 1));
      ctx.fillStyle = g; ctx.fillRect(-1.2, -1.2, 2.4, 2.4); ctx.restore();
      const sp1 = v.lead?.sp, s = h * 0.03; ctx.fillStyle = css(SEP, 0.92); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.font = `italic ${Math.round(s * 0.72)}px Georgia, 'Times New Roman', serif`; ctx.fillText('Plate ' + ['IV', 'VII', 'IX', 'XII', 'XVI', 'XXIII'][(E.opts.seed || 0) % 6] + '.', w / 2, h * 0.925);
      ctx.font = `${Math.round(s)}px Georgia, 'Times New Roman', serif`; const name = (sp1 ? sp1.name : f.era.name).toUpperCase().split('').join(' ');
      ctx.fillText(name + (sp1?.means ? '  —  “' + sp1.means + '”' : ''), w / 2, h * 0.968);
    }
  };
  return S;
}

// ================================================================ blue-and-white porcelain
function porcelain(E) {
  const W0 = [246, 247, 242], DEEP = [22, 46, 126], MID = [58, 94, 178], PALE = [146, 172, 222], WASH = [206, 218, 240], RED = [176, 50, 38];
  let D, lws, acc;
  const S = {
    paper: W0, fire: DEEP, line: DEEP, soot: [40, 50, 90], sootA: 0.3, plate: true,
    begin(f, v) { D = dayOf(v); lws = 0.5 + f.p.x1; acc = mix(mix(PALE, MID, 0.75), RED, smooth(0.5, 0.95, f.p.x4)); },
    sky(f, v) {
      const { ctx, w, h } = f; ctx.fillStyle = css(W0); ctx.fillRect(0, 0, w, h);
      const g = ctx.createLinearGradient(0, h * 0.1, 0, v.horizon); g.addColorStop(0, css(MID, 0.3 + D.night * 0.6 + v.dark * 0.3)); g.addColorStop(0.6, css(PALE, 0.12 + D.night * 0.6)); g.addColorStop(1, css(PALE, D.night * 0.3)); ctx.fillStyle = g; ctx.fillRect(0, 0, w, v.horizon + 1);
      // scroll clouds, drawn with the brush
      ctx.strokeStyle = css(MID, 0.8); ctx.lineWidth = Math.max(0.7, h * 0.003 * lws); ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) { const r = h * (0.022 + 0.014 * hash(i, 5)), x = fract(hash(i, 1, E.opts.seed) + f.t * 0.002 * (0.6 + hash(i, 2))) * w * 0.9 + w * 0.05, y = h * (0.2 + 0.18 * hash(i, 3, E.opts.seed));
        ctx.beginPath(); for (let j = -1; j <= 1; j++) { const cx = x + j * r * 1.9, cy = y - (j ? 0 : r * 0.5); ctx.moveTo(cx + r, cy); for (let a = 0; a <= 9; a++) { const t = a / 9 * TAU * 1.25, rr = r * (1 - a / 14); ctx.lineTo(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr); } }
        ctx.moveTo(x - r * 3.4, y + r * 1.05); ctx.quadraticCurveTo(x, y + r * 1.5, x + r * 3.4, y + r * 1.05); ctx.stroke(); }
    },
    sun(f, v) { const { ctx, h } = f, s = v.sun, r = h * 0.036; ctx.fillStyle = css(D.night > 0.6 ? W0 : acc); ctx.strokeStyle = css(DEEP); ctx.lineWidth = Math.max(0.8, h * 0.003); ctx.beginPath(); ctx.arc(s.x, Math.max(s.y, h * 0.2), r, 0, TAU); ctx.fill(); ctx.stroke(); },
    far(f, v, l, i) {
      const { ctx, h } = f, y0 = topY(l.pts), g = ctx.createLinearGradient(0, y0, 0, l.bottom); g.addColorStop(0, css(i ? PALE : WASH)); g.addColorStop(1, css(W0)); ctx.fillStyle = g; below(ctx, l.pts, l.bottom); ctx.fill();
      along(ctx, l.pts); ctx.strokeStyle = css(MID, 0.8); ctx.lineWidth = Math.max(0.6, h * 0.002 * lws); ctx.lineJoin = 'round'; ctx.stroke();
    },
    ground(f, v, b, i) {
      const { ctx, h } = f, y0 = topY(b.pts), u = b.u, g = ctx.createLinearGradient(0, y0, 0, Math.max(b.next, y0 + h * 0.03) + h * 0.02);
      g.addColorStop(0, css(mix(WASH, MID, 0.12 + 0.5 * u))); g.addColorStop(0.5, css(mix(WASH, PALE, 0.2 + 0.5 * u))); g.addColorStop(1, css(mix(W0, PALE, 0.15 + 0.3 * u))); ctx.fillStyle = g; below(ctx, b.pts, h + 2); ctx.fill();
      along(ctx, b.pts); ctx.strokeStyle = css(DEEP, 0.55 + 0.4 * u); ctx.lineWidth = Math.max(0.6, h * (0.0014 + 0.002 * u) * lws); ctx.lineJoin = 'round'; ctx.stroke();
    },
    water(f, v, b) { const { ctx, h } = f; ctx.fillStyle = css(W0); waterRects(ctx, b, 1); ctx.fill(); ctx.strokeStyle = css(MID); ctx.lineWidth = Math.max(0.6, h * 0.002); ctx.lineCap = 'round'; ripples(ctx, f, v, b, 3, h * 0.04 * (0.4 + b.u)); ctx.stroke(); },
    plant(f, v, it) {
      const fog = it.fog * 0.8, C = { trunk: MID, leaf: mix(DEEP, MID, 0.35), leaf2: PALE, flower: W0, rock: WASH, rock2: W0, egg: W0, bone: W0 };
      paint(f.ctx, it.parts, PT(it), { fill: t => css(mix(C[t] || MID, W0, fog)), stroke: css(mix(DEEP, W0, fog)), lw: clamp(it.k * 0.022, 0.45, f.h * 0.0022) * lws });
    },
    dino(f, v, it) {
      const { ctx, h } = f, T = it.T, k = Math.abs(T.k), fog = (it.fog || 0) * 0.7, lw = clamp(k * 0.04, 0.8, h * 0.0052) * lws, line = css(mix(DEEP, W0, fog));
      const C = { body: mix(W0, WASH, 0.45), belly: W0, far: mix(WASH, PALE, 0.7), mark: mix(PALE, MID, 0.5), accent: acc, accentFar: mix(acc, W0, 0.45), horn: W0, eye: W0, mouth: DEEP }, pal = {}; for (const t in C) pal[t] = css(mix(C[t], W0, fog));
      ctx.globalAlpha = it.fade ?? 1; ctx.lineJoin = ctx.lineCap = 'round';
      wading(f, it, () => { outline(ctx, it.parts, T); ctx.strokeStyle = ctx.fillStyle = line; ctx.lineWidth = lw * 2; ctx.stroke(); ctx.fill(); paint(ctx, it.parts, T, { pal, stroke: line, lw: lw * 0.45, pupilCol: css(DEEP), alpha: { mark: 0.8 }, A: it.fade ?? 1 }); ctx.globalAlpha = it.fade ?? 1;
        if (it.type === 'dino' && k * it.sp.len > 40) { const q = it.pose, z = k * it.sp.len * 0.02; ctx.strokeStyle = css(MID, 0.7); ctx.lineWidth = Math.max(0.6, lw * 0.4); ctx.setLineDash([z, z * 1.6]); ctx.beginPath(); poly(ctx, spine(q, T, 0.45, 2, q.iEnd - 1)); poly(ctx, spine(q, T, -0.05, 4, q.iEnd - 2)); ctx.stroke(); ctx.setLineDash([]); } });
      ctx.globalAlpha = 1;
    },
    over(f, v) { if (D.night > 0.02) tint(f, DEEP, D.night * 0.25); }
  };
  // the plate itself: cut the picture to the well, then paint the rim round it and (alone) the table underneath
  S.frame = (f) => {
    const { ctx, w, h } = f, cx = w / 2, cy = h / 2, ry = h * 0.485, rx = Math.min(w * 0.49, ry * 1.72), k = 0.79, ell = s => { ctx.beginPath(); ctx.ellipse(cx, cy, rx * s, ry * s, 0, 0, TAU); };
    ctx.save(); ctx.globalCompositeOperation = 'destination-in'; ell(k); ctx.fillStyle = '#000'; ctx.fill(); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'source-atop'; const sh = ctx.createRadialGradient(cx, cy, ry * k * 0.82, cx, cy, ry * k * 1.02); sh.addColorStop(0, css(DEEP, 0)); sh.addColorStop(1, css(DEEP, 0.2)); ctx.translate(cx, cy); ctx.scale(rx / ry, 1); ctx.translate(-cx, -cy); ctx.fillStyle = sh; ctx.fillRect(0, 0, w, h); ctx.restore();
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); ctx.ellipse(cx, cy, rx * k, ry * k, 0, 0, TAU); ctx.fillStyle = css(W0); ctx.fill('evenodd');
    ctx.strokeStyle = css(DEEP); ctx.lineWidth = Math.max(1, h * 0.006); ell(k); ctx.stroke(); ctx.lineWidth = Math.max(0.7, h * 0.0025); ell(k + 0.022); ctx.stroke(); ell(0.955); ctx.stroke(); ctx.lineWidth = Math.max(1, h * 0.007); ell(0.985); ctx.stroke();
    // lappets round the rim, a wave line and dots
    const N = 44, r0 = k + 0.035, r1 = 0.945, P = (a, s) => [cx + Math.cos(a) * rx * s, cy + Math.sin(a) * ry * s];
    ctx.lineWidth = Math.max(0.7, h * 0.0028); ctx.lineJoin = 'round'; ctx.fillStyle = css(MID);
    for (let i = 0; i < N; i++) {
      const a0 = i / N * TAU, a1 = (i + 1) / N * TAU, am = (a0 + a1) / 2, A = P(a0, r0), B = P(a1, r0), C = P(am, r1), c1 = P(a0, lerp(r0, r1, 0.75)), c2 = P(a1, lerp(r0, r1, 0.75));
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.quadraticCurveTo(c1[0], c1[1], C[0], C[1]); ctx.quadraticCurveTo(c2[0], c2[1], B[0], B[1]); ctx.fillStyle = css(i % 2 ? WASH : PALE); ctx.fill(); ctx.stroke();
      const I1 = P(am, lerp(r0, r1, 0.2)), I2 = P(am, lerp(r0, r1, 0.72)), d1 = P(lerp(a0, a1, 0.3), lerp(r0, r1, 0.45)), d2 = P(lerp(a0, a1, 0.7), lerp(r0, r1, 0.45));
      ctx.beginPath(); ctx.moveTo(I1[0], I1[1]); ctx.quadraticCurveTo(d1[0], d1[1], I2[0], I2[1]); ctx.quadraticCurveTo(d2[0], d2[1], I1[0], I1[1]); ctx.fillStyle = css(DEEP); ctx.fill();
    }
    // the gloss of the glaze, and the turn of the rim
    ctx.save(); ctx.globalCompositeOperation = 'source-atop'; const gl = ctx.createLinearGradient(cx - rx, cy - ry, cx + rx * 0.4, cy + ry); gl.addColorStop(0, 'rgba(255,255,255,0.3)'); gl.addColorStop(0.3, 'rgba(255,255,255,0)'); gl.addColorStop(0.75, 'rgba(40,60,110,0)'); gl.addColorStop(1, css([40, 60, 110], 0.2 * (0.4 + f.p.x3)));
    ctx.fillStyle = gl; ctx.fillRect(0, 0, w, h); ctx.restore();
    grain(f, f.p.x2 * 0.35);
    if (!f.combo) {
      ctx.save(); ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = 'rgba(30,24,20,0.3)'; ctx.beginPath(); ctx.ellipse(cx + h * 0.012, cy + h * 0.02, rx * 1.005, ry * 1.005, 0, 0, TAU); ctx.fill();
      const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#6f5a48'); g.addColorStop(1, '#4a3a30'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore();
    }
  };
  return S;
}

// ================================================================ black-figure vase band
function vase(E) {
  const TERRA = [206, 112, 56], BLK = [26, 19, 17], RED = [124, 34, 30], WHT = [238, 226, 198];
  let D, y0, yT, yB, lws, add;
  const meander = (ctx, w, y, hh, off) => {
    const u = hh / 5, cw = u * 6; ctx.strokeStyle = css(BLK); ctx.lineWidth = u * 0.8; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'; ctx.beginPath();
    for (let x = -cw - off; x < w + cw; x += cw) { ctx.moveTo(x, y + u * 4.5); ctx.lineTo(x, y + u * 0.5); ctx.lineTo(x + u * 4, y + u * 0.5); ctx.lineTo(x + u * 4, y + u * 3); ctx.lineTo(x + u * 2, y + u * 3); ctx.lineTo(x + u * 2, y + u * 1.9); ctx.moveTo(x - u * 0.4, y + u * 4.5); ctx.lineTo(x + cw, y + u * 4.5); }
    ctx.stroke();
  };
  const flat = (v, it) => { const r = clamp((it.k / v.k0 - 0.55) / 0.5); return { x: it.x, y: y0, k: v.k0 * lerp(0.78, 1, r), dir: it.T ? it.T.dir : 1 }; };
  const S = {
    paper: TERRA, fire: RED, line: BLK, soot: [20, 14, 12], sootA: 0.3,
    begin(f, v) { D = dayOf(v); const h = f.h; yT = h * 0.15; yB = h * 0.87; y0 = h * 0.8; lws = 0.5 + f.p.x1; add = Math.min(1, f.p.x4 * 2); },
    sky(f, v) { const { ctx, w, h } = f, g = ctx.createLinearGradient(0, yT, 0, yB); g.addColorStop(0, css(mix(TERRA, [224, 138, 72], 0.5))); g.addColorStop(1, css(mix(TERRA, [176, 86, 44], 0.4))); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); },
    sun(f, v) {
      const { ctx, h } = f, s = v.sun, x = s.x, y = lerp(yT, y0, 0.22), r = h * 0.035; ctx.fillStyle = css(BLK); ctx.strokeStyle = css(BLK); ctx.lineWidth = Math.max(1, h * 0.004);
      ctx.beginPath(); if (D.night > 0.6) { ctx.arc(x, y, r, 0.6, 5.2); ctx.arc(x + r * 0.5, y - r * 0.15, r * 0.8, 4.6, 1.0, true); ctx.fill(); }
      else { ctx.arc(x, y, r * 0.62, 0, TAU); ctx.fill(); ctx.beginPath(); for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; ctx.moveTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9); ctx.lineTo(x + Math.cos(a) * r * 1.45, y + Math.sin(a) * r * 1.45); } ctx.stroke(); }
    },
    pre(f, v) {
      const { ctx, w, h } = f; ctx.fillStyle = css(mix(TERRA, [176, 86, 44], 0.4)); ctx.fillRect(0, y0, w, yB - y0 + 1);
      ctx.fillStyle = css(BLK); ctx.fillRect(0, y0, w, h * 0.012); ctx.fillRect(0, y0 + h * 0.022, w, h * 0.004);
    },
    ground() {},
    plant(f, v, it) {
      const r = it.k / v.k0; if (r < 0.62 || r > 1.02 || !/fern|cycad|horsetail|reed|flowers|nest/.test(it.kind)) return;
      const { ctx } = f, T = { x: it.x, y: y0, k: v.k0 * 0.9, dir: 1 };
      paint(ctx, it.parts, T, { fill: t => t === 'flower' || t === 'egg' ? css(WHT) : t === 'leaf2' ? css(mix(BLK, RED, add)) : css(BLK) });
    },
    dino(f, v, it) {
      const { ctx, h } = f, fly = it.type !== 'dino', T = fly ? { ...it.T, y: lerp(yT + h * 0.06, y0 - h * 0.3, clamp(it.y / v.horizon)) } : flat(v, it), k = Math.abs(T.k), lw = clamp(k * 0.016, 0.7, h * 0.0026) * lws;
      ctx.globalAlpha = it.fade ?? 1; ctx.lineJoin = ctx.lineCap = 'round';
      outline(ctx, it.parts, T); ctx.fillStyle = ctx.strokeStyle = css(BLK); ctx.lineWidth = lw; ctx.fill(); ctx.stroke();
      const C = { accent: RED, accentFar: mix(RED, BLK, 0.5), horn: WHT, eye: WHT, mouth: RED, mark: RED };
      if (add > 0.02) { const al = {}; for (const t in C) al[t] = add * (t === 'mark' ? 0.75 : 1); paint(ctx, it.parts, T, { fill: t => C[t] ? css(C[t]) : null, alpha: al, pupilCol: css(BLK), A: it.fade ?? 1 }); ctx.globalAlpha = it.fade ?? 1; }
      // detail scratched through the black to the clay
      ctx.strokeStyle = css(mix(TERRA, [232, 150, 84], 0.5)); ctx.lineWidth = lw; ctx.beginPath();
      for (const q of it.parts) if (!q.l && (q.t === 'body' && (q.k === 'leg' || q.k === 'arm' || q.k === 'jaw' || q.k === 'skull') || q.k === 'plate' || q.k === 'frill' || q.k === 'sail' || q.k === 'crest' || q.k === 'wing' || q.k === 'scute' || q.k === 'club')) trace(ctx, q, T);
      if (!fly && k * it.sp.len > 30) {
        const q = it.pose, n = q.nodes, sx = k * T.dir;
        poly(ctx, spine(q, T, -0.5, Math.max(1, q.iHip - 3), q.iSh + 1)); poly(ctx, spine(q, T, 0.55, 2, q.iHip - 1));
        for (const i of [q.iHip, q.iSh]) { const c = n[i], r = c.r * k * 0.62, X = T.x + c.x * sx, Y = T.y - c.y * k; ctx.moveTo(X + r, Y); for (let a = 0; a <= 10; a++) { const t = a / 10 * TAU * 1.2, rr = r * (1 - a / 16); ctx.lineTo(X + Math.cos(t) * rr * Math.sign(T.dir || 1), Y + Math.sin(t) * rr); } }
        for (let i = q.iHip + 1; i < q.iSh; i++) { const a = spine(q, T, -0.1, i, i)[0], b = spine(q, T, -0.75, i, i)[0]; ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo((a[0] + b[0]) / 2 - k * n[i].r * 0.2 * T.dir, (a[1] + b[1]) / 2, b[0], b[1]); }
      }
      ctx.stroke(); ctx.globalAlpha = 1;
    },
    over(f, v) {
      const { ctx, w, h } = f, off = fract(v.camX / v.viewM * 0.4) * (yT - h * 0.05) / 5 * 6;
      // the bands above and below the frieze: clay strips with a running key, then black glaze
      for (const [a, b] of [[h * 0.05, yT], [yB, h * 0.955]]) { ctx.fillStyle = css(mix(TERRA, [224, 138, 72], 0.3)); ctx.fillRect(0, a, w, b - a); ctx.fillStyle = css(BLK); ctx.fillRect(0, a, w, h * 0.008); ctx.fillRect(0, b - h * 0.008, w, h * 0.008); meander(ctx, w, a + h * 0.014, b - a - h * 0.028, a < yT ? off : -off + h * 0.03); }
      ctx.fillStyle = css(BLK); ctx.fillRect(0, 0, w, h * 0.05); ctx.fillRect(0, h * 0.955, w, h * 0.05);
      ctx.fillStyle = css(RED); ctx.fillRect(0, h * 0.036, w, h * 0.006); ctx.fillRect(0, h * 0.963, w, h * 0.006);
      if (D.night > 0.02) tint(f, [20, 10, 20], D.night * 0.3);
      // the curve of the pot: darker to the sides, a soft shine left of centre
      ctx.save(); ctx.globalCompositeOperation = 'source-atop'; const g = ctx.createLinearGradient(0, 0, w, 0), m = 0.3 + 0.6 * f.p.x3;
      g.addColorStop(0, css([20, 8, 4], 0.5 * m)); g.addColorStop(0.22, css([20, 8, 4], 0)); g.addColorStop(0.33, css([255, 236, 200], 0.16 * m)); g.addColorStop(0.45, css([255, 236, 200], 0)); g.addColorStop(0.8, css([20, 8, 4], 0)); g.addColorStop(1, css([20, 8, 4], 0.55 * m));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore();
      grain(f, f.p.x2 * 1.1);
    }
  };
  return S;
}

// ================================================================ ochre cave painting
function cave(E) {
  const ROCK = [176, 146, 110], CHAR = [34, 26, 22], OCH = [[168, 74, 36], [206, 150, 60], [126, 62, 36]], PALEO = [228, 204, 160];
  let wall = null, D, lws, colr;
  const build = () => {
    const W = 320, H = 180, b = buffer(W, H), g = b.ctx, im = g.createImageData(W, H), d = im.data, sd = (E.opts.seed || 0) * 1.7;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = x / 60 + sd, t = y / 60, n = fbm2(u + 0.4 * noise2(u * 1.3, t * 1.3), t * 1.4, 4), n2 = fbm2(u * 3.1 + 9, t * 3.1, 3), crack = Math.pow(1 - Math.abs(2 * fbm2(u * 2.2 + 4, t * 0.7 + 2, 4) - 1), 90);
      const stain = smooth(0.52, 0.75, fbm2(u * 0.5 + 20, t * 0.35, 3)), L = 0.8 + 0.3 * n + 0.22 * (n2 - 0.5) - 0.1 * crack;
      const c = mix(mul(mix(ROCK, [196, 172, 140], n2), L), [120, 84, 60], stain * 0.25), i = (y * W + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
    g.putImageData(im, 0, 0); return b.canvas;
  };
  const S = {
    paper: PALEO, fire: OCH[0], line: CHAR, soot: [20, 12, 8], sootA: 0.3,
    begin(f, v) { D = dayOf(v); wall = wall || build(); lws = 0.5 + f.p.x1; colr = f.p.x4; },
    sky(f, v) { const { ctx, w, h } = f; ctx.imageSmoothingEnabled = true; ctx.drawImage(wall, 0, 0, w, h); },
    pre(f, v) {
      const { ctx, w, h } = f;
      if (f.combo) { ctx.save(); below(ctx, v.layers[0].pts, h + 2); ctx.clip(); ctx.imageSmoothingEnabled = true; ctx.drawImage(wall, 0, 0, w, h); ctx.restore(); }
      // signs: rows of dots and tally strokes in red ochre
      const R = rng(Math.imul((E.opts.seed || 1) + 5, 2654435761)); ctx.fillStyle = css(OCH[0], 0.6); ctx.strokeStyle = css(OCH[0], 0.55); ctx.lineCap = 'round'; ctx.lineWidth = h * 0.006;
      for (let g = 0; g < 4; g++) { const x = w * (0.08 + 0.84 * R()), y = lerp(v.horizon + h * 0.04, h * 0.95, R()), n = 4 + Math.floor(R() * 5), dots = R() < 0.6; ctx.beginPath();
        for (let i = 0; i < n; i++) { const xx = x + i * h * 0.022, yy = y + Math.sin(i * 0.9 + g) * h * 0.006; if (dots) { ctx.moveTo(xx + h * 0.006, yy); ctx.arc(xx, yy, h * 0.006, 0, TAU); } else { ctx.moveTo(xx, yy); ctx.lineTo(xx + h * 0.004, yy - h * 0.03); } }
        dots ? ctx.fill() : ctx.stroke(); }
    },
    ground() {},
    meteor(f, v) { const { ctx, h } = f, m = v.meteor; ctx.fillStyle = css(OCH[0], 0.9); ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 2, 0, TAU); for (let i = 1; i < 9; i++) { const x = m.x - Math.cos(m.ang) * m.len * i / 9, y = m.y - Math.sin(m.ang) * m.len * i / 9, r = m.r * (1.2 - i * 0.1); ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); } ctx.fill(); },
    plant(f, v, it) {
      if (it.kind !== 'fern' && it.kind !== 'cycad' && it.kind !== 'horsetail' && it.kind !== 'reed' || it.fog > 0.3) return;
      const { ctx, h } = f, R = rng(Math.imul(it.seed | 0, 2654435761)); ctx.strokeStyle = css(mix(CHAR, OCH[2], 0.5), 0.4 * (1 - it.fog * 2)); ctx.lineWidth = Math.max(0.7, h * 0.0028); ctx.lineCap = 'round'; ctx.beginPath();
      for (let i = 0; i < 5; i++) { const a = (i / 4 - 0.5) * 1.6 + (R() - 0.5) * 0.2, l = it.k * (0.7 + R() * 0.5); ctx.moveTo(it.x, it.y); ctx.quadraticCurveTo(it.x + Math.sin(a) * l * 0.4, it.y - l * 0.8, it.x + Math.sin(a) * l, it.y - Math.cos(a) * l * 0.8); }
      ctx.stroke();
    },
    dino(f, v, it) {
      const { ctx, h } = f, T = it.T, k = Math.abs(T.k), a = (it.fade ?? 1) * clamp(1 - (it.fog || 0) * 0.75, 0.3, 1), lw = clamp(k * 0.04, 1, h * 0.006) * lws;
      const id = Math.floor(hash(it.sp.len, it.sp.mass || 1) * 2.99), base = mix(grey(OCH[id]), OCH[id], 0.4 + 1.1 * colr), alt = OCH[(id + 1) % 3];
      const C = { body: base, belly: mix(base, PALEO, 0.55), far: mix(base, CHAR, 0.4), mark: CHAR, accent: mix(alt, base, 0.2), accentFar: mix(alt, CHAR, 0.45), horn: PALEO, eye: CHAR, mouth: CHAR };
      paint(ctx, it.parts, T, { fill: t => css(C[t] || base), alpha: { mark: 0.45 }, pupil: false, A: a * 0.9 });
      const z = Math.max(4, k * it.sp.len * 0.12); outline(ctx, it.parts, T); ctx.strokeStyle = css(CHAR);
      ctx.globalAlpha = a * 0.85; ctx.lineWidth = lw; ctx.setLineDash([z * 2.2, z * 0.12, z * 0.9, z * 0.2]); ctx.stroke();
      ctx.save(); ctx.translate(lw * 0.7, -lw * 0.5); ctx.globalAlpha = a * 0.35; ctx.lineWidth = lw * 0.7; ctx.setLineDash([z * 0.7, z * 0.5]); ctx.stroke(); ctx.restore();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    },
    over(f, v) {
      const { ctx, w, h } = f, c = f.clock ?? f.t, fl = 0.82 + 0.1 * noise2(c * 7, 1.3) + 0.08 * Math.sin(c * 23) * noise2(c * 3, 7), m = (0.35 + 0.65 * f.p.x3) * lerp(1, 0.7, clamp(v.light));
      grain(f, f.p.x2);
      ctx.save(); ctx.globalCompositeOperation = 'source-atop'; const x = w * (0.5 + 0.03 * Math.sin(c * 1.3)), y = h * 0.66;
      const g = ctx.createRadialGradient(x, y, h * 0.1, x, y, h * 1.25 * fl); g.addColorStop(0, css([255, 176, 84], 0.2 * fl)); g.addColorStop(0.35, css([120, 60, 20], 0.12)); g.addColorStop(0.75, css([16, 8, 4], 0.72 * m)); g.addColorStop(1, css([8, 4, 2], 0.95 * m));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore();
    }
  };
  return S;
}

const STYLES = { ukiyoe, sumie, shanshui, linocut, engraving, porcelain, vase, cave };

export default {
  id: 'woodblock',
  name: 'Woodblock & Ink',
  kind: '2d',
  sky: true,
  params: [
    { id: 'x1', label: 'Ink', value: 0.5, tip: 'Weight of the key lines, brush strokes and hatching' },
    { id: 'x2', label: 'Paper grain', value: 0.5, tip: 'Fibres and speckle of the paper, clay or rock' },
    { id: 'x3', label: 'Mist', value: 0.5, tip: 'Mist bands, wash, gouge marks, vignette or torch shadow, depending on the style' },
    { id: 'x4', label: 'Colour', value: 0.5, tip: 'How much of each animal’s own colour comes through the style’s inks' },
  ],
  create(ctx, opts) {
    const W = createWorld(opts), S = (STYLES[opts.style] || ukiyoe)({ ctx, opts });
    return {
      render(f) {
        const v = W.frame(f);
        ctx.save(); ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        S.begin(f, v);
        if (S.plate) {            // the picture lives inside the plate: paint it whole (sky and all), then cut it to the well
          const g = Object.create(f); g.combo = false; g.backdrop = false;
          ctx.clearRect(0, 0, f.w, f.h); walk(g, v, S); S.frame(f);
        } else walk(f, v, S);
        ctx.restore();
      }
    };
  }
};

const SC = (id, name, desc, tags, opts, params) => ({ id: 'woodblock-' + id, name, desc, tags: [...tags, '2d'], opts, params });
export const scenes = [
  SC('ukiyoe', 'Tyrannosaurus, Floating World', 'A ukiyo-e print: flat mineral colours, a graded sky, key-block outlines and a red seal.', ['ukiyo-e', 'print', 'theropod', 'cretaceous'],
    { style: 'ukiyoe', cast: [{ sp: 'tyrannosaurus', n: 1 }], biome: 'plain', mode: 'wander', seed: 15, horizon: 0.58 }, { stage: 0.855, light: 0.75 }),
  SC('moon', 'Crested Herd under the Moon', 'A night print: a Parasaurolophus family calling under a pale moon.', ['ukiyo-e', 'print', 'ornithopod', 'cretaceous', 'night', 'family', 'herd'],
    { style: 'ukiyoe', cast: [{ sp: 'parasaurolophus', n: 3, young: 2 }], biome: { hills: 0.25, water: 0.36, density: 0.4, tall: 0.12, far: 'hills', ground: ['#80925a', '#566f3c'], mult: { reed: 3, horsetail: 2 } }, mode: 'wander', seed: 26, horizon: 0.58 }, { stage: 0.805, light: 0.08, activity: 0.6, x3: 0.65 }),
  SC('sumie', 'Spinosaurus in the Reeds', 'Sumi-e: grey ink on off-white paper, a few wet brush masses and a lot of empty paper.', ['ink wash', 'sumi-e', 'theropod', 'cretaceous', 'water'],
    { style: 'sumie', cast: [{ sp: 'spinosaurus', n: 1 }], biome: { hills: 0.5, water: 0.45, density: 0.5, tall: 0.06, far: 'hills', mult: { horsetail: 4, reed: 5, fern: 1, conifer: 2 } }, mode: 'migrate', pace: 0.7, seed: 13, flyers: 2 }, { stage: 0.71, light: 0.7, x4: 0.1, detail: 0.45 }),
  SC('scroll', 'Long-Necks among Misty Peaks', 'A shan shui scroll: a Mamenchisaurus herd winds through blue-green mountains.', ['ink wash', 'shan shui', 'sauropod', 'jurassic', 'herd', 'family'],
    { style: 'shanshui', cast: [{ sp: 'mamenchisaurus', n: 4, young: 2 }], biome: 'uplands', mode: 'migrate', seed: 51, frame: 1.5, horizon: 0.6, foot: 0.84, flyers: 3 }, { stage: 0.42, light: 0.7, x1: 0.45 }),
  SC('linocut', 'Linocut: Allosaurus and Stegosaurus', 'Three flat inks, white lines cut along the bodies and a hunter testing a herd that fights back.', ['linocut', 'print', 'theropod', 'stegosaur', 'jurassic', 'hunt'],
    { style: 'linocut', cast: [{ sp: 'stegosaurus', n: 2, young: 1 }, { sp: 'allosaurus', n: 1, role: 'pred' }], mode: 'hunt', biome: 'plain', seed: 25 }, { stage: 0.43, light: 0.7, activity: 0.6, x4: 0.6 }),
  SC('engraving', 'Iguanodon, Plate from a Natural History', 'A steel engraving of the 1850s: sepia hatching that follows the form, inside an oval vignette.', ['engraving', 'victorian', 'ornithopod', 'cretaceous', 'family'],
    { style: 'engraving', cast: [{ sp: 'iguanodon', n: 2, young: 1 }], mode: 'wander', biome: { hills: 0.3, density: 0.55, tall: 0.5, far: 'forest', ground: ['#5f7a48', '#3c5630'], mult: { conifer: 1, treefern: 2, fern: 2, cycad: 2, ginkgo: 1.5 } }, seed: 31, frame: 1.2, horizon: 0.54, foot: 0.8 }, { stage: 0.585, light: 0.8, x4: 0.15 }),
  SC('porcelain', 'Triceratops Platter', 'Blue-and-white porcelain: a Triceratops family in cobalt, inside a lappet rim.', ['porcelain', 'blue and white', 'ceratopsian', 'cretaceous', 'family'],
    { style: 'porcelain', cast: [{ sp: 'triceratops', n: 2, young: 2 }], mode: 'wander', biome: 'plain', seed: 11, frame: 1.45, horizon: 0.5, foot: 0.72 }, { stage: 0.86, light: 0.8, x4: 0.3 }),
  SC('vase', 'Black-Figure Frieze', 'A Greek vase band: black dinosaurs with scratched detail walk between two meanders.', ['greek vase', 'black-figure', 'ankylosaur', 'ornithopod', 'cretaceous', 'herd', 'frieze'],
    { style: 'vase', cast: [{ sp: 'ankylosaurus', n: 1 }, { sp: 'pachycephalosaurus', n: 2 }, { sp: 'edmontosaurus', n: 2 }], mode: 'migrate', nonstop: true, biome: { hills: 0, density: 0.3, tall: 0, far: 'none' }, seed: 7, frame: 1.25, horizon: 0.5, foot: 0.8, flyers: 2 }, { stage: 0.855, light: 0.8 }),
  SC('cave', 'Ochre on the Cave Wall', 'Cave painting as an art style: charcoal outlines and ochre fills by torchlight. Coelophysis and Plateosaurus cross the rock.', ['cave painting', 'ochre', 'theropod', 'sauropod', 'triassic', 'herd', 'pack'],
    { style: 'cave', cast: [{ sp: 'plateosaurus', n: 2, young: 1 }, { sp: 'coelophysis', n: 4 }], mode: 'migrate', biome: 'badlands', seed: 2, frame: 1.15, foot: 0.8 }, { stage: 0.09, light: 0.6, activity: 0.65 }),
  SC('deeptime', 'One Hundred Views of Deep Time', 'A print that changes its cast as 180 million years go by, until the sky falls.', ['ukiyo-e', 'print', 'time travel', 'herd', 'impact'],
    { style: 'ukiyoe', cast: 'era', biome: 'plain', seed: 7, horizon: 0.58 }, { stage: 0.02, grow: 0.5, light: 0.45 }),
];
