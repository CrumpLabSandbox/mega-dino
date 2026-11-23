// Paper & Craft: the shared world rebuilt from craft materials. One engine, eight sub-styles chosen by opts.style:
// layered cut paper, origami, stained glass, mosaic, felt appliqué, a pop-up book, paper quilling and a back-lit
// shadow box. Every style walks the same view (world.js) and the same rig parts, and only changes how a piece is made.
import { createWorld } from '../world.js';
import { trace, groundRGB } from '../draw.js';
import { clamp, lerp, smooth, hash, rng, buffer } from '../util.js';

const TAU = Math.PI * 2;
// ---------------------------------------------------------------- colour (arrays [r, g, b])
const hx = c => { const p = parseInt(c.slice(1), 16); return [p >> 16, p >> 8 & 255, p & 255]; };
const css = (c, a = 1) => a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, k) => k <= 1 ? [a[0] * k, a[1] * k, a[2] * k] : mix(a, [255, 255, 255], Math.min(1, k - 1));
const luma = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const sat = (c, k) => { const l = luma(c); return [clamp(l + (c[0] - l) * k, 0, 255), clamp(l + (c[1] - l) * k, 0, 255), clamp(l + (c[2] - l) * k, 0, 255)]; };
const CREAM = [246, 240, 226], WHITE = [252, 250, 244];

const TONES = new Map();
function tonesOf(sp) {
  let t = TONES.get(sp.id);
  if (!t) { const [b, be, m, a] = sp.c.map(hx);
    t = { body: b, belly: be, far: mul(b, 0.7), mark: mix(b, m, 0.75), accent: a, accentFar: mul(a, 0.66), horn: [236, 228, 204], eye: [246, 218, 90], mouth: [134, 38, 44] };
    TONES.set(sp.id, t); }
  return t;
}
function plantTones(E) {
  const burnt = Math.min(1, E.dark * 1.2), b = c => mix(c, [74, 64, 58], burnt * 0.8);
  return { trunk: b([120, 88, 60]), leaf: b([54, 122, 66]), leaf2: b([98, 158, 72]), flower: b([244, 160, 196]), rock: b([146, 140, 134]), rock2: b([182, 176, 166]), egg: [240, 232, 208], bone: [236, 230, 208] };
}
function skyCols(v) {
  const n = v.day.night, du = v.day.dusk * (1 - n);
  let top = mix(mix([100, 172, 224], [126, 104, 168], du), [34, 42, 92], n), bot = mix(mix([214, 236, 244], [255, 200, 134], du), [70, 82, 140], n);
  if (v.dark > 0) { top = mix(top, [58, 44, 40], v.dark * 0.85); bot = mix(bot, [104, 74, 56], v.dark * 0.85); }
  return [top, bot];
}

// ---------------------------------------------------------------- geometry helpers
const MAJOR = { body: 1, leg: 1, arm: 1, wing: 1, plate: 1, sail: 1, frill: 1, skull: 1, jaw: 1, crest: 1, tailfan: 1, club: 1, foot: 1, horn: 1, spike: 1, beak: 1 };
const INNER = { body: 1, leg: 1, arm: 1, wing: 1, plate: 1, sail: 1, frill: 1, skull: 1, crest: 1, tailfan: 1 };
const TMP = { x: 0, y: 0, k: 1, dir: 1 };
const sT = (T, dx, dy) => { TMP.x = T.x + dx; TMP.y = T.y + dy; TMP.k = T.k; TMP.dir = T.dir; return TMP; };
const itT = it => it.T || { x: it.x, y: it.y, k: it.k, dir: 1 };
function bandPath(g, pts, bottom, dy = 0, step = 1) {
  const n = pts.length; g.beginPath(); g.moveTo(pts[0][0], bottom);
  for (let i = 0; i < n; i += step) g.lineTo(pts[i][0], pts[i][1] + dy);
  if ((n - 1) % step) g.lineTo(pts[n - 1][0], pts[n - 1][1] + dy);
  g.lineTo(pts[n - 1][0], bottom); g.closePath();
}
function topLine(g, pts, dy = 0) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1] + dy); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1] + dy); }
function unionPath(g, parts, T, all) { g.beginPath(); for (const q of parts) if (!q.l && (all || MAJOR[q.k])) trace(g, q, T); }
function waterRects(g, b, col) {
  const n = b.pts.length; g.fillStyle = col;
  for (let i = 0; i < n; i++) if (b.wet[i]) { const x0 = i ? (b.pts[i - 1][0] + b.pts[i][0]) / 2 : b.pts[i][0], x1 = i < n - 1 ? (b.pts[i][0] + b.pts[i + 1][0]) / 2 : b.pts[i][0]; g.fillRect(x0 - 0.5, b.level, x1 - x0 + 1, b.next - b.level + 1); }
}
function pupil(g, q, T, col = '#17120e') { const r = Math.max(0.4, q.c[2] * T.k * 0.5); g.beginPath(); g.arc(T.x + q.c[0] * T.k * T.dir, T.y - q.c[1] * T.k, r, 0, TAU); g.fillStyle = col; g.fill(); }
function flatParts(g, parts, T, pal) {
  g.lineJoin = g.lineCap = 'round';
  for (const q of parts) {
    const c = pal[q.t]; if (!c) continue;
    g.beginPath(); trace(g, q, T);
    if (q.l) { g.strokeStyle = c; g.lineWidth = Math.max(0.6, q.w * T.k); g.stroke(); continue; }
    g.fillStyle = c; g.fill();
    if (q.k === 'eye') pupil(g, q, T);
  }
}
function cloudPath(g, cx, cy, r) {
  g.beginPath();
  for (const [dx, dy, k] of [[-1.2, 0.15, 0.6], [-0.45, -0.3, 0.85], [0.4, -0.2, 0.75], [1.15, 0.2, 0.55], [0, 0.25, 0.7]]) { g.moveTo(cx + dx * r + k * r, cy + dy * r); g.arc(cx + dx * r, cy + dy * r, k * r, 0, TAU); }
}
const cloudAt = (K, i) => { const { w, h } = K; return [((hash(i, 3) + K.t * 0.004 * (1 + hash(i, 5))) % 1) * w * 1.3 - w * 0.15, h * (0.07 + 0.3 * hash(i, 7)), h * (0.03 + 0.03 * hash(i, 9))]; };
function stars(K, n, col, r) { const { g, w, v } = K; g.fillStyle = col; for (let i = 0; i < n; i++) { g.beginPath(); g.arc(hash(i, 1) * w, hash(i, 2) * v.horizon * 0.95, r * (0.6 + hash(i, 5)), 0, TAU); g.fill(); } }
function pal(K, tones, fog) { const o = {}; for (const k in tones) o[k] = K.col(tones[k], fog); return o; }
function wash(K, style) { const { g, w, h } = K; g.fillStyle = style; g.fillRect(0, 0, w, h); }
function grainPattern(g) {
  const b = buffer(160, 160), c = b.ctx, R = rng(977);
  for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(${R() < 0.5 ? '255,255,255' : '50,40,30'},${0.04 + R() * 0.1})`; c.fillRect(R() * 160, R() * 160, 1, 1); }
  c.lineWidth = 0.7;
  for (let i = 0; i < 150; i++) { const x = R() * 160, y = R() * 160, a = R() * TAU, l = 3 + R() * 9; c.strokeStyle = `rgba(${R() < 0.6 ? '255,255,255' : '60,45,30'},${0.05 + R() * 0.1})`; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + R() * 2, y + Math.sin(a) * l * 0.5 + R() * 2, x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); }
  return g.createPattern(b.canvas, 'repeat');
}
function grain(K, amount, scale = 1) {
  if (amount < 0.02) return;
  const { g, w, h, st } = K; st.grain ||= grainPattern(g);
  st.grain.setTransform(new DOMMatrix().scale(h / 540 * scale));
  g.save(); g.globalCompositeOperation = 'source-atop'; g.globalAlpha = Math.min(1, amount); g.fillStyle = st.grain; g.fillRect(0, 0, w, h); g.restore();
}

// ---------------------------------------------------------------- the shared drawing order
function drawItems(K, b) { for (const it of b.items) it.type === 'plant' ? (it.x > -it.k * 14 && it.x < K.w + it.k * 14 && K.S.plant(K, it)) : dino(K, it); }
function dino(K, it) {
  const g = K.g, a = it.fade ?? 1; if (a <= 0.01) return;
  if (a < 1) g.globalAlpha = a;
  if (it.wade) { g.save(); g.beginPath(); g.rect(0, 0, K.w, it.waterY); g.clip(); K.S.dino(K, it); g.restore(); } else K.S.dino(K, it);
  g.globalAlpha = 1;
}
function drawScene(K) {
  const { f, v, S } = K;
  if (!f.combo) S.sky(K);
  for (const it of v.flyers) S.flyer(K, it);
  if (v.meteor) meteor(K);
  if (!f.backdrop) { v.far.forEach((l, i) => S.far(K, l, i)); if (v.sea) (S.sea || sea)(K); }
  v.layers.forEach((b, i) => { K.band = b; S.band(K, b, i); if (b.anyWet) (S.water || water)(K, b); drawItems(K, b); });
}
function sea(K) { const { g, w, v } = K; g.fillStyle = K.col([72, 150, 184], 0.2); g.fillRect(0, v.sea.y0, w, v.sea.y1 - v.sea.y0 + 2); if (K.S.lead) { g.strokeStyle = K.S.lead; g.lineWidth = K.lw; g.strokeRect(-9, v.sea.y0, w + 18, v.sea.y1 - v.sea.y0 + 2); } }
function water(K, b) { waterRects(K.g, b, K.col([84, 150, 186], (1 - b.u) * 0.3)); }
function meteor(K) {
  const g = K.g, m = K.v.meteor, dx = -Math.cos(m.ang) * m.len, dy = -Math.sin(m.ang) * m.len, nx = -dy / m.len, ny = dx / m.len;
  for (const [wd, c] of [[1.7, [255, 140, 56]], [1.05, [255, 196, 104]], [0.5, [255, 240, 204]]]) {
    g.beginPath(); g.moveTo(m.x + nx * m.r * wd, m.y + ny * m.r * wd); g.lineTo(m.x + dx * wd / 1.7, m.y + dy * wd / 1.7); g.lineTo(m.x - nx * m.r * wd, m.y - ny * m.r * wd); g.closePath(); g.fillStyle = css(c); g.fill();
    if (K.S.lead) { g.strokeStyle = K.S.lead; g.lineWidth = K.lw; g.stroke(); }
  }
  g.beginPath(); g.arc(m.x, m.y, m.r * 1.9, 0, TAU); g.fillStyle = '#fff6d8'; g.fill(); if (K.S.lead) g.stroke();
}
// day and night, the impact flash and winter: tints that only touch what is already painted
function post(K) {
  const { g, w, h, v, f } = K;
  g.save(); g.globalCompositeOperation = 'source-atop';
  if (!K.S.noNight) { const n = v.day.night, du = v.day.dusk * (1 - n); if (n > 0.02) wash(K, `rgba(12,16,56,${n * 0.5})`); if (du > 0.02) wash(K, `rgba(255,136,56,${du * 0.13})`); }
  if (v.dark > 0.02) wash(K, `rgba(36,26,22,${v.dark * 0.5})`);
  if (v.flash > 0.01 || v.meteor) {
    const gx = v.meteor ? v.meteor.glowX : w * 0.74, a = Math.max(v.flash, v.meteor ? v.meteor.x / w * 0.15 : 0), gr = g.createRadialGradient(gx, v.horizon, 0, gx, v.horizon, w * (0.3 + v.flash));
    gr.addColorStop(0, `rgba(255,250,225,${Math.min(1, a * 1.5)})`); gr.addColorStop(0.4, `rgba(255,190,90,${a * 0.8})`); gr.addColorStop(1, `rgba(255,120,40,${a * 0.25})`); wash(K, gr);
  }
  g.restore();
  if (v.dark > 0.02) { g.fillStyle = `rgba(214,208,198,${v.dark * 0.6})`; const s = h * 0.006; for (let i = 0; i < 60; i++) { const x = (hash(i, 3) * w + K.t * 14 * (hash(i, 4) - 0.5) + w * 9) % w, y = (hash(i, 7) * h + K.t * (18 + 30 * hash(i, 9))) % h; g.fillRect(x, y, s, s * 0.7); } }
}
function stdRender(K) {
  const { f, g, w, h, S } = K;
  if (f.combo) g.clearRect(0, 0, w, h);
  S.begin?.(K); drawScene(K); post(K); S.end?.(K);
}

// ================================================================ 1. layered cut paper
function paperItem(K, parts, T, P, inner, all) {
  const g = K.g, sh = Math.min(K.sh, T.k * 0.4 + 1.2), s2 = sh * 0.42;
  g.lineJoin = g.lineCap = 'round';
  g.fillStyle = K.shadow; unionPath(g, parts, sT(T, sh * 0.6, sh), all); g.fill();
  for (const q of parts) {
    const c = P[q.t]; if (!c) continue;
    if (q.l) { g.beginPath(); trace(g, q, T); g.strokeStyle = c; g.lineWidth = Math.max(0.6, q.w * T.k); g.stroke(); continue; }
    if (inner && INNER[q.k] && q.t !== 'far' && q.t !== 'accentFar') { g.beginPath(); trace(g, q, sT(T, s2 * 0.6, s2)); g.fillStyle = 'rgba(30,18,40,0.24)'; g.fill(); }
    g.beginPath(); trace(g, q, T); g.fillStyle = c; g.fill();
    if (q.k === 'eye') pupil(g, q, T);
  }
}
function paperSky(K, flat) {
  const { g, w, h, v, p } = K, [top, bot] = K.sky, s = v.sun, n = 3 + Math.round(p.x4 * 5);
  g.fillStyle = css(top); g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const u = (i + 1) / n, r = h * lerp(1.7, 0.2, Math.pow(u, 0.75));
    if (!flat) { g.fillStyle = 'rgba(20,24,70,0.13)'; g.beginPath(); g.arc(s.x, s.y, r + K.sh * 0.8, 0, TAU); g.fill(); }
    g.fillStyle = css(mix(top, bot, u)); g.beginPath(); g.arc(s.x, s.y, r, 0, TAU); g.fill();
  }
  if (s.night > 0.3) stars(K, 50, `rgba(255,250,224,${s.night})`, h * 0.004);
  const sc = s.moon ? [248, 246, 232] : mix([255, 240, 176], [255, 176, 96], s.dusk), sr = s.r * (flat ? 1.8 : 1.6);
  if (!flat) { g.fillStyle = K.shadow; g.beginPath(); g.arc(s.x + K.sh * 0.6, s.y + K.sh, sr, 0, TAU); g.fill(); }
  g.fillStyle = css(sc); g.beginPath(); g.arc(s.x, s.y, sr, 0, TAU); g.fill();
  if (s.moon) { g.fillStyle = css(top); g.beginPath(); g.arc(s.x + sr * 0.45, s.y - sr * 0.2, sr * 0.82, 0, TAU); g.fill(); }
  const cc = css(mix(WHITE, bot, 0.25 + 0.5 * s.night));
  for (let i = 0; i < Math.round(p.x4 * 5); i++) { const [cx, cy, r] = cloudAt(K, i);
    if (!flat) { g.fillStyle = K.shadow; cloudPath(g, cx + K.sh * 0.6, cy + K.sh, r); g.fill(); }
    g.fillStyle = cc; cloudPath(g, cx, cy, r); g.fill(); }
}
const farCol = (K, i) => mix(mix(hx(K.v.biome.ground[0]), [104, 118, 150], 0.5), K.sky[1], 0.5 - i * 0.22);
const PAPER = {
  tr: c => sat(c, 1.18),
  sky: K => paperSky(K, false),
  far(K, l, i) { const g = K.g; g.fillStyle = K.shadow; bandPath(g, l.pts, l.bottom, -K.sh * 0.7); g.fill(); g.fillStyle = K.col(farCol(K, i)); bandPath(g, l.pts, l.bottom); g.fill(); },
  band(K, b) {
    const g = K.g, h = K.h;
    g.fillStyle = 'rgba(24,16,44,0.16)'; bandPath(g, b.pts, h + 2, -K.sh * 1.1); g.fill(); bandPath(g, b.pts, h + 2, -K.sh * 0.5); g.fill();
    g.fillStyle = K.col(groundRGB(K.f, K.gv, b.u)); bandPath(g, b.pts, h + 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = Math.max(1, h * 0.002); topLine(g, b.pts, g.lineWidth * 0.5); g.stroke();
  },
  plant(K, it) { paperItem(K, it.parts, itT(it), pal(K, K.plantT, it.fog * 0.7), false, true); },
  dino(K, it) { paperItem(K, it.parts, it.T, pal(K, tonesOf(it.sp), it.fog * 0.7), true); },
  flyer(K, it) { paperItem(K, it.parts, it.T, pal(K, tonesOf(it.sp), it.fog * 0.5), false); },
  end(K) { grain(K, K.p.x2 * 1.5); },
};

// ================================================================ 2. origami
const ORI = new Map();
function oriCol(sp) {
  let c = ORI.get(sp.id);
  if (!c) { const a = hx(sp.c[3]), b = hx(sp.c[0]), sa = Math.max(...a) - Math.min(...a), sb = Math.max(...b) - Math.min(...b);
    c = sat(sa > sb * 0.9 ? a : b, 1.5); const l = luma(c); c = l < 120 ? mix(c, [255, 255, 255], (120 - l) / 250) : l > 175 ? mul(c, 175 / l) : c; ORI.set(sp.id, c); }
  return c;
}
// a flat polygon folded once: one half lighter, one darker, with a crease from the apex to the base
function foldPoly(g, P, a, b) {
  const n = P.length, ia = n >> 1, mx = (P[0][0] + P[n - 1][0]) / 2, my = (P[0][1] + P[n - 1][1]) / 2;
  g.beginPath(); g.moveTo(P[0][0], P[0][1]); for (let i = 1; i < n; i++) g.lineTo(P[i][0], P[i][1]); g.closePath(); g.fillStyle = a; g.fill(); g.stroke();
  g.beginPath(); g.moveTo(P[ia][0], P[ia][1]); for (let i = ia + 1; i < n; i++) g.lineTo(P[i][0], P[i][1]); g.lineTo(mx, my); g.closePath(); g.fillStyle = b; g.fill(); g.stroke();
}
function foldPart(g, q, T, a, b) {
  const sx = T.k * T.dir;
  if (q.l) { g.beginPath(); trace(g, q, T); g.save(); g.strokeStyle = a; g.lineWidth = Math.max(0.7, q.w * T.k); g.stroke(); g.restore(); return; }
  let P;
  if (q.c) { P = []; const r = Math.max(0.6, q.c[2] * T.k), cx = T.x + q.c[0] * sx, cy = T.y - q.c[1] * T.k; for (let i = 0; i < 6; i++) P.push([cx + Math.cos(i * 1.047 + 0.5) * r, cy + Math.sin(i * 1.047 + 0.5) * r]); }
  else P = q.p.map(v => [T.x + v[0] * sx, T.y - v[1] * T.k]);
  foldPoly(g, P, a, b);
}
function crease(K, T) { const g = K.g; g.lineJoin = 'bevel'; g.strokeStyle = 'rgba(70,50,40,0.3)'; g.lineWidth = clamp((T ? T.k * 0.02 : 1), 0.4, K.h * 0.0022); }
function origamiDino(K, it) {
  const g = K.g, q = it.pose, T = it.T, n = q.nodes, parts = it.parts, fog = it.fog * 0.6;
  const base = oriCol(it.sp), C = k => K.col(mul(base, k), fog), Wc = k => K.col(mul(WHITE, k), fog);
  const M = (x, y) => [T.x + x * T.k * T.dir, T.y - y * T.k];
  const tri = (a, b, c, col) => { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.closePath(); g.fillStyle = col; g.fill(); g.stroke(); };
  // soft shadow on the table
  const sh = Math.min(K.sh, T.k * 0.4 + 1); g.fillStyle = K.shadow; unionPath(g, parts, sT(T, sh * 0.7, sh * 0.8)); g.fill();
  crease(K, T);
  const limb = (pts, R, k0) => {
    for (let i = 0; i < pts.length - 1; i++) { const A = pts[i], B = pts[i + 1], dx = B[0] - A[0], dy = B[1] - A[1], d = Math.hypot(dx, dy) || 1, px = -dy / d, py = dx / d, ra = R[i] * 1.1, rb = R[i + 1] * (i === pts.length - 2 ? 0.7 : 1.1);
      const a1 = M(A[0] + px * ra, A[1] + py * ra), a2 = M(A[0] - px * ra, A[1] - py * ra), b1 = M(B[0] + px * rb, B[1] + py * rb), b2 = M(B[0] - px * rb, B[1] - py * rb);
      tri(a1, b1, a2, C(k0 * (i % 2 ? 0.92 : 1.06))); tri(a2, b1, b2, C(k0 * (i % 2 ? 0.78 : 0.86))); }
  };
  const leg = (l, k0) => { limb(l.pts, l.R, k0); const A = l.pts[3], r = l.R[3]; tri(M(A[0], A[1] + r), M(l.tip[0], l.tip[1] - r * 0.6), M(A[0] - r * 0.8, A[1] - r), C(k0 * 0.8)); };
  const arm = (a, k0) => limb(a.pts, [a.r * 1.5, a.r * 1.1, a.r * 0.8, a.r * 0.5], k0);
  for (const l of q.legs) if (!l.near) leg(l, 0.66);
  for (const a of q.arms) if (!a.near) arm(a, 0.66);
  const FEAT = { plate: 1, spike: 1, sail: 1, frill: 1, crest: 1, horn: 1, club: 1, tailfan: 1, wing: 1, beak: 1, quill: 1 };
  const feat = (qq, far) => { const w = qq.t === 'horn' || qq.k === 'beak'; foldPart(g, qq, T, w ? Wc(far ? 0.8 : 1) : C(far ? 0.6 : 1.16), w ? Wc(far ? 0.7 : 0.86) : C(far ? 0.5 : 0.84)); };
  let ib = parts.findIndex(x => x.k === 'body'); if (ib < 0) ib = 0;
  for (let i = 0; i < ib; i++) if (FEAT[parts[i].k] && parts[i].k !== 'wing') feat(parts[i], parts[i].t === 'accentFar');
  // the body: a strip of facets along the spine, coloured above a white underside
  const set = new Set([0, q.iHip, q.iSh, q.iEnd, Math.round(q.iHip * 0.5), Math.round((q.iHip + q.iSh) / 2), Math.round((q.iSh + q.iEnd) / 2)]);
  if (q.iHip > 7) { set.add(Math.round(q.iHip * 0.25)); set.add(Math.round(q.iHip * 0.75)); }
  if (q.iEnd - q.iSh > 6) { set.add(Math.round(lerp(q.iSh, q.iEnd, 0.25))); set.add(Math.round(lerp(q.iSh, q.iEnd, 0.75))); }
  const idx = [...set].sort((a, b) => a - b), top = [], mid = [], bot = [];
  for (const i of idx) { const A = n[Math.max(0, i - 1)], B = n[Math.min(q.iEnd, i + 1)], c = n[i]; let tx = B.x - A.x, ty = B.y - A.y; const d = Math.hypot(tx, ty) || 1; tx /= d; ty /= d;
    const r = i === 0 ? 0 : c.r * 1.06, b = i === 0 ? 0 : (c.b ?? c.r) * 1.06, t = [c.x - ty * r, c.y + tx * r], o = [c.x + ty * b, c.y - tx * b];
    top.push(M(t[0], t[1])); bot.push(M(o[0], o[1])); mid.push(M(lerp(o[0], t[0], 0.36), lerp(o[1], t[1], 0.36))); }
  for (let j = 0; j < idx.length - 1; j++) {
    tri(top[j], top[j + 1], mid[j], C(j % 2 ? 1.2 : 1.04)); tri(top[j + 1], mid[j + 1], mid[j], C(j % 2 ? 0.94 : 0.8));
    tri(mid[j], mid[j + 1], bot[j], Wc(j % 2 ? 1 : 0.92)); tri(mid[j + 1], bot[j + 1], bot[j], Wc(j % 2 ? 0.86 : 0.8));
  }
  for (let i = ib; i < parts.length; i++) if (parts[i].k === 'frill') feat(parts[i]);
  // the head: three folds to a crisp point
  { const H = q.head, c = Math.cos(H.a), s = Math.sin(H.a), d = H.len * (q.P.hd || 1), Hm = (lx, ly) => M(H.x + lx * H.len * c - ly * d * s, H.y + lx * H.len * s + ly * d * c);
    const a = Hm(-0.04, 0.34), b = Hm(0.42, 0.3), tip = Hm(1.02, 0.04), j = Hm(-0.02, -0.3), jm = Hm(0.5, -0.24);
    tri(a, b, j, C(0.92)); tri(b, tip, j, C(1.18)); tri(j, tip, jm, Wc(0.9)); }
  for (let i = ib; i < parts.length; i++) { const qq = parts[i]; if (FEAT[qq.k] && qq.k !== 'frill' && !(qq.k === 'wing' && qq.t !== 'accent')) feat(qq, false); }
  for (const l of q.legs) if (l.near) leg(l, 1);
  for (const a of q.arms) if (a.near) arm(a, 1);
}
const ORIGAMI = {
  tr: c => sat(c, 1.1),
  sky(K) {
    const { g, w, h, v } = K, s = v.sun, paper = mix(CREAM, K.sky[1], 0.4 + 0.5 * s.night);
    g.fillStyle = css(paper); g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(120,100,80,0.14)'; g.lineWidth = Math.max(1, h * 0.0016); g.beginPath();
    for (let i = -2; i < 7; i++) { g.moveTo(i * w * 0.2, 0); g.lineTo(i * w * 0.2 + h * 0.9, h); g.moveTo(i * w * 0.2 + h * 0.9, 0); g.lineTo(i * w * 0.2, h); } g.stroke();
    if (s.night > 0.3) stars(K, 40, `rgba(255,252,236,${s.night})`, h * 0.004);
    const r = s.r * 2, col = s.moon ? [250, 248, 238] : mix([238, 86, 62], [246, 150, 60], 1 - s.dusk);
    g.fillStyle = K.shadow; g.beginPath(); g.arc(s.x + K.sh * 0.6, s.y + K.sh, r * 0.97, 0, TAU); g.fill();
    crease(K);
    for (let i = 0; i < 8; i++) { const a0 = i * TAU / 8 + 0.2, a1 = a0 + TAU / 8; g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x + Math.cos(a0) * r, s.y + Math.sin(a0) * r); g.lineTo(s.x + Math.cos(a1) * r, s.y + Math.sin(a1) * r); g.closePath(); g.fillStyle = css(mul(col, [1.12, 0.9, 1, 0.82][i % 4])); g.fill(); g.stroke(); }
    // folded paper clouds
    for (let i = 0; i < Math.round(K.p.x4 * 4); i++) { const [cx, cy, cr] = cloudAt(K, i), P = [[cx - cr * 2, cy + cr * 0.5], [cx - cr * 0.9, cy - cr * 0.5], [cx - cr * 0.2, cy - cr * 0.1], [cx + cr * 0.6, cy - cr * 0.9], [cx + cr * 2, cy + cr * 0.5]];
      foldPoly(g, P, css(mix(WHITE, paper, 0.1)), css(mix(mul(WHITE, 0.86), paper, 0.2))); }
  },
  far(K, l, i) { const g = K.g, c = mix(farCol(K, i), CREAM, 0.35); crease(K); g.fillStyle = K.col(c); bandPath(g, l.pts, l.bottom, 0, 4); g.fill();
    for (let j = 0; j + 4 < l.pts.length; j += 4) { const a = l.pts[j], b = l.pts[j + 4]; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(a[1] < b[1] ? b[0] : a[0], l.bottom); g.closePath(); g.fillStyle = (j >> 2) % 2 ? 'rgba(255,255,255,0.2)' : 'rgba(40,30,60,0.1)'; g.fill(); } },
  band(K, b, i) {
    const g = K.g, h = K.h, P = b.pts, c = mix(groundRGB(K.f, K.gv, b.u), CREAM, 0.3), dep = h * (0.05 + 0.1 * b.u);
    g.fillStyle = 'rgba(40,30,50,0.13)'; bandPath(g, P, h + 2, -K.sh * 0.7, 3); g.fill();
    g.fillStyle = K.col(c); bandPath(g, P, h + 2, 0, 3); g.fill();
    for (let j = 0; j + 3 < P.length; j += 3) { const a = P[j], q = P[j + 3], k = (j / 3 + i) % 2;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(q[0], q[1]); g.lineTo(k ? a[0] : q[0], Math.max(a[1], q[1]) + dep); g.closePath(); g.fillStyle = k ? 'rgba(255,255,255,0.17)' : 'rgba(40,30,60,0.08)'; g.fill(); }
  },
  plant(K, it) {
    const g = K.g, T = itT(it), P = pal(K, K.plantT, it.fog * 0.7), D = K.plantD ||= {}; crease(K, T);
    for (const q of it.parts) { const c = P[q.t]; if (c) foldPart(g, q, T, c, D[q.t + it.fog.toFixed(1)] ||= K.col(mul(K.plantT[q.t], 0.78), it.fog * 0.7)); }
  },
  dino: origamiDino,
  flyer(K, it) {
    const g = K.g, T = it.T, base = oriCol(it.sp), fog = it.fog * 0.4; crease(K, T);
    for (const q of it.parts) { if (q.k === 'eye' || q.k === 'mark') continue; const w = q.t === 'belly' || q.t === 'horn', far = q.t === 'far', c = w ? WHITE : base;
      foldPart(g, q, T, K.col(mul(c, far ? 0.7 : w ? 1 : 1.12), fog), K.col(mul(c, far ? 0.58 : 0.84), fog)); }
  },
  end(K) { grain(K, K.p.x2 * 1.1); },
};

// ================================================================ 3. stained glass
function winPath(g, w, h) { const x0 = w * 0.035, x1 = w * 0.965, ys = h * 0.5, yt = h * 0.035; g.beginPath(); g.moveTo(x0, h * 0.965); g.lineTo(x0, ys); g.bezierCurveTo(x0, yt + h * 0.1, w * 0.3, yt, w / 2, yt); g.bezierCurveTo(w * 0.7, yt, x1, yt + h * 0.1, x1, ys); g.lineTo(x1, h * 0.965); g.closePath(); }
function glassItem(K, parts, T, P, thin) {
  const g = K.g, lw = clamp(T.k * 0.07, 0.5, K.lw) * (thin ? 0.7 : 1);
  g.lineJoin = g.lineCap = 'round'; g.strokeStyle = GLASS.lead;
  for (const q of parts) {
    const c = P[q.t]; if (!c) continue;
    g.beginPath(); trace(g, q, T);
    if (q.l) { g.strokeStyle = thin ? c : GLASS.lead; g.lineWidth = Math.max(0.7, q.w * T.k); g.stroke(); g.strokeStyle = GLASS.lead; continue; }
    g.fillStyle = c; g.fill();
    if (q.k === 'eye') { pupil(g, q, T); continue; }
    g.lineWidth = q.k === 'mark' || q.k === 'tooth' || q.k === 'belly' || q.k === 'scute' ? lw * 0.45 : lw; g.stroke();
  }
}
const GLASS = {
  lead: '#17131a',
  tr: c => mul(sat(c, 1.75), 1.1),
  begin(K) {
    const { g, w, h, f } = K;
    if (!f.combo) { g.fillStyle = '#231f26'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = Math.max(1, h * 0.003); g.beginPath();
      for (let j = 0; j < 9; j++) { const y = j * h / 8; g.moveTo(0, y); g.lineTo(w, y); for (let i = 0; i < 12; i++) { const x = (i + (j % 2) * 0.5) * w / 11; g.moveTo(x, y); g.lineTo(x, y + h / 8); } } g.stroke(); }
    g.save(); winPath(g, w, h); g.clip();
  },
  sky(K) {
    const { g, w, h, v } = K, [top, bot] = K.sky, s = v.sun, R = [s.r * 2, h * 0.2, h * 0.38, h * 0.62, h * 0.95, h * 1.4, Math.hypot(w, h) * 1.1];
    g.strokeStyle = GLASS.lead; g.lineWidth = K.lw; g.lineJoin = 'round';
    for (let i = 0; i < R.length - 1; i++) { const N = 8 + i * 3, off = i * 0.37;
      for (let j = 0; j < N; j++) { const a0 = off + j * TAU / N, a1 = a0 + TAU / N, u = (i + 0.5) / (R.length - 1);
        let c = mix(mix(bot, [255, 226, 150], (1 - u) * 0.5 * (1 - s.night)), top, Math.pow(u, 0.8)); c = mul(sat(c, 1.5), 0.82 + 0.36 * hash(i, j, 3));
        g.beginPath(); g.arc(s.x, s.y, R[i + 1], a0, a1); g.arc(s.x, s.y, R[i], a1, a0, true); g.closePath(); g.fillStyle = css(c); g.fill(); g.stroke(); } }
    g.beginPath(); g.arc(s.x, s.y, R[0], 0, TAU); g.fillStyle = s.moon ? '#f4f2e2' : css(mix([255, 226, 96], [255, 150, 60], s.dusk)); g.fill(); g.stroke();
  },
  far(K, l, i) { const g = K.g; g.fillStyle = K.col(sat(farCol(K, i), 0.7)); bandPath(g, l.pts, l.bottom); g.fill(); g.strokeStyle = GLASS.lead; g.lineWidth = K.lw; g.stroke();
    g.beginPath(); for (let j = 3 + i * 2; j < l.pts.length; j += 6) { g.moveTo(l.pts[j][0], l.pts[j][1]); g.lineTo(l.pts[j][0] + K.h * 0.02, l.bottom); } g.stroke(); },
  band(K, b, i) {
    const { g, h, v, w } = K, P = b.pts, n = P.length, base = groundRGB(K.f, K.gv, b.u), step = w / (n - 3);
    // panes: seams fixed to the ground, so they travel with the camera
    const sp = v.viewM * 0.34 * (0.6 + K.p.x3 * 0.8) * (b.d / (v.layers[v.layers.length - 1].d * 1.35)), kd = (v.sx(1, b.d) - v.sx(0, b.d)), c0 = Math.floor((v.camX - w / kd) / sp);
    const yAt = x => { const fx = clamp(x / step + 1, 0, n - 1.001), j = Math.floor(fx); return lerp(P[j][1], P[j + 1][1], fx - j); };
    g.strokeStyle = GLASS.lead; g.lineWidth = K.lw; g.lineJoin = 'round';
    let px = -w * 0.1, c = c0;
    for (let guard = 0; guard < 40 && px < w; guard++, c++) {
      const nx = Math.max(px + 1, v.sx((c + 1 + 0.5 * hash(c, i, 7)) * sp, b.d)), x0 = px, x1 = Math.min(nx, w * 1.1);
      g.beginPath(); g.moveTo(x0, h + 4); g.lineTo(x0, yAt(x0));
      const j0 = Math.ceil(x0 / step + 1), j1 = Math.floor(x1 / step + 1); for (let j = Math.max(0, j0); j <= Math.min(n - 1, j1); j++) g.lineTo(P[j][0], P[j][1]);
      g.lineTo(x1, yAt(x1)); g.lineTo(x1, h + 4); g.closePath();
      g.fillStyle = K.col(mul(base, 0.84 + 0.34 * hash(c, i, 1))); g.fill(); g.stroke(); px = nx;
    }
  },
  water(K, b) { waterRects(K.g, b, K.col([50, 130, 200])); },
  plant(K, it) { glassItem(K, it.parts, itT(it), pal(K, K.plantT, it.fog * 0.5), true); },
  dino(K, it) { glassItem(K, it.parts, it.T, pal(K, tonesOf(it.sp), it.fog * 0.4)); },
  flyer(K, it) { glassItem(K, it.parts, it.T, pal(K, tonesOf(it.sp), 0.1)); },
  end(K) {
    const { g, w, h, v, f } = K, s = v.sun;
    g.globalCompositeOperation = 'source-atop';
    const gl = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, h * 1.1); gl.addColorStop(0, `rgba(255,244,200,${0.42 * (1 - v.dark)})`); gl.addColorStop(0.45, 'rgba(255,236,180,0.1)'); gl.addColorStop(1, 'rgba(10,0,40,0.22)'); wash(K, gl);
    g.globalCompositeOperation = 'source-over';
    grain(K, K.p.x2 * 0.9, 2.2);
    g.restore();
    winPath(g, w, h); g.lineJoin = 'round'; g.strokeStyle = '#120f14'; g.lineWidth = h * 0.03; g.stroke(); g.strokeStyle = '#4a4248'; g.lineWidth = h * 0.006; g.stroke();
  },
};

// ================================================================ 4. mosaic (a flat picture, rebuilt from tesserae)
const FLAT = {
  tr: c => mul(sat(c, 1.7), 1.1),
  sky: K => paperSky(K, true),
  far(K, l, i) { const g = K.g; g.fillStyle = K.col(farCol(K, i)); bandPath(g, l.pts, l.bottom); g.fill(); },
  band(K, b, i) { const g = K.g; g.fillStyle = K.col(mul(groundRGB(K.f, K.gv, b.u), i % 2 ? 1 : 0.9)); bandPath(g, b.pts, K.h + 2); g.fill(); },
  plant(K, it) { flatParts(K.g, it.parts, itT(it), pal(K, K.plantT, it.fog * 0.6)); },
  dino(K, it) { const g = K.g; g.lineJoin = 'round'; g.strokeStyle = '#2c2226'; g.lineWidth = K.ts * 1.3; unionPath(g, it.parts, it.T); g.stroke(); flatParts(g, it.parts, it.T, pal(K, tonesOf(it.sp), it.fog * 0.4)); },
  flyer(K, it) { flatParts(K.g, it.parts, it.T, pal(K, tonesOf(it.sp), 0.1)); },
};
const TILE_CSS = new Array(32768);
function mosaicRender(K) {
  const { g, w, h, p, st, f, v } = K, N = Math.round(lerp(96, 48, p.x3)), ts = h / N, bw = Math.ceil(w / ts), bh = N;
  if (!st.buf || st.buf.width !== bw || st.buf.height !== bh) { st.buf = document.createElement('canvas'); st.buf.width = bw; st.buf.height = bh; st.bctx = st.buf.getContext('2d', { willReadFrequently: true }); }
  const b = st.bctx; b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, bw, bh); b.setTransform(1 / ts, 0, 0, 1 / ts, 0, 0);
  const K2 = { ...K, g: b, S: FLAT, ts, col: K.col }; drawScene(K2); post(K2);
  const d = b.getImageData(0, 0, bw, bh).data, grout = '#8a8078', gap = ts * 0.13, jit = p.x2 * 0.5, sz = ts - gap;
  g.clearRect(0, 0, w, h); g.fillStyle = grout;
  if (!f.combo) g.fillRect(0, 0, w, h);
  else for (let j = 0; j < bh; j++) { let run = -1; for (let i = 0; i <= bw; i++) { const on = i < bw && d[(j * bw + i) * 4 + 3] >= 128; if (on && run < 0) run = i; else if (!on && run >= 0) { g.fillRect(run * ts, j * ts, (i - run) * ts, ts + 0.5); run = -1; } } }
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
    const o = (j * bw + i) * 4; if (d[o + 3] < 128) continue;
    const n = hash(i, j), k = 1 + (n - 0.5) * jit, r = Math.min(255, d[o] * k), gg = Math.min(255, d[o + 1] * k), bb = Math.min(255, d[o + 2] * k), key = (r >> 3) << 10 | (gg >> 3) << 5 | (bb >> 3);
    g.fillStyle = TILE_CSS[key] ||= `rgb(${r & 248 | 4},${gg & 248 | 4},${bb & 248 | 4})`;
    g.fillRect(i * ts + gap * (0.2 + 0.6 * n), j * ts + gap * (0.2 + 0.6 * ((n * 7) % 1)), sz, sz);
  }
  // a light sheen across the tiles
  g.save(); g.globalCompositeOperation = 'source-atop'; const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, 'rgba(255,255,255,0.1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,20,0.1)'); wash(K, gr); g.restore();
}

// ================================================================ 5. felt appliqué
function feltPiece(K, build, col, stitch, thread) {
  const g = K.g, sh = K.sh * 0.6, tk = K.stitch;
  if (stitch) { g.fillStyle = K.shadow; g.beginPath(); build(g, sh * 0.5, sh); g.fill(); }
  g.beginPath(); build(g, 0, 0); g.fillStyle = css(col); g.fill();
  g.strokeStyle = css(mul(col, 1.14), 0.55); g.lineWidth = tk * 0.9; g.stroke();          // the fuzzy edge
  if (stitch === 2) { g.save(); g.clip(); g.setLineDash([tk * 0.55, tk * 2.9]); g.lineWidth = tk * 5.5; g.strokeStyle = thread; g.stroke(); g.restore(); g.lineWidth = tk * 0.35; g.strokeStyle = thread; g.stroke(); }
  else if (stitch === 1) { g.setLineDash([tk * 1.6, tk * 1.4]); g.lineWidth = tk * 0.45; g.strokeStyle = thread; g.stroke(); g.setLineDash([]); }
}
function feltItem(K, parts, T, tones, fog, isDino) {
  const g = K.g, big = T.k * (isDino ? 1 : 0.5) > K.stitch * 9;
  g.lineJoin = g.lineCap = 'round';
  for (const q of parts) {
    const c = tones[q.t]; if (!c) continue;
    const col = K.colA(c, fog);
    if (q.l) { g.beginPath(); trace(g, q, T); g.strokeStyle = css(col); g.lineWidth = Math.max(0.8, q.w * T.k * 1.3); g.stroke(); continue; }
    if (q.k === 'eye') { const r = Math.max(q.c[2] * T.k * 1.7, K.h * 0.004), x = T.x + q.c[0] * T.k * T.dir, y = T.y - q.c[1] * T.k;      // a button
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.arc(x + r * 0.2, y + r * 0.3, r, 0, TAU); g.fill();
      g.fillStyle = '#2b2530'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.strokeStyle = '#6a6070'; g.lineWidth = r * 0.22; g.beginPath(); g.arc(x, y, r * 0.72, 0, TAU); g.stroke();
      g.strokeStyle = '#f4ecd8'; g.lineWidth = r * 0.2; g.beginPath(); g.moveTo(x - r * 0.3, y - r * 0.3); g.lineTo(x + r * 0.3, y + r * 0.3); g.moveTo(x + r * 0.3, y - r * 0.3); g.lineTo(x - r * 0.3, y + r * 0.3); g.stroke(); continue; }
    const far = q.t === 'far' || q.t === 'accentFar', main = isDino ? (q.k === 'body' || q.k === 'skull' || q.k === 'frill' || q.k === 'sail' || q.k === 'plate' || q.k === 'leg' || q.k === 'wing' || q.k === 'crest') : q.t !== 'flower' && q.t !== 'egg';
    const blanket = q.k === 'body' || q.k === 'frill' || q.k === 'sail' || q.k === 'wing';
    feltPiece(K, (gg, dx, dy) => trace(gg, q, dx || dy ? sT(T, dx, dy) : T), col, !main || !big ? (isDino && MAJOR[q.k] ? 0.5 : 0) : far || !isDino || !blanket ? 1 : 2, luma(col) > 170 ? 'rgba(120,90,70,0.85)' : 'rgba(255,246,222,0.9)');
  }
}
function fuzzPattern(g) {
  const b = buffer(128, 128), c = b.ctx, R = rng(4242); c.lineWidth = 0.8; c.lineCap = 'round';
  for (let i = 0; i < 1100; i++) { const x = R() * 128, y = R() * 128, a = R() * TAU, l = 2 + R() * 5; c.strokeStyle = `rgba(${R() < 0.55 ? '255,255,255' : '30,20,30'},${0.08 + R() * 0.16})`; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); }
  return g.createPattern(b.canvas, 'repeat');
}
const FELT = {
  tr: c => mul(sat(c, 1.3), 1.06),
  sky(K) {
    const { g, w, h, v } = K, s = v.sun, c = mix(K.sky[0], K.sky[1], 0.45);
    g.fillStyle = css(c); g.fillRect(0, 0, w, h);
    if (s.night > 0.3) stars(K, 30, `rgba(255,246,200,${s.night})`, h * 0.006);
    const r = s.r * 2.1; feltPiece(K, (gg, dx, dy) => { gg.moveTo(s.x + dx + r, s.y + dy); gg.arc(s.x + dx, s.y + dy, r, 0, TAU); }, s.moon ? [246, 244, 230] : mix([255, 214, 84], [255, 160, 80], s.dusk), 2, 'rgba(255,255,255,0.9)');
    for (let i = 0; i < Math.round(K.p.x4 * 5); i++) { const [cx, cy, cr] = cloudAt(K, i); g.fillStyle = K.shadow; cloudPath(g, cx + K.sh * 0.4, cy + K.sh * 0.7, cr); g.fill(); g.fillStyle = css(mix(WHITE, c, 0.12 + 0.4 * s.night)); cloudPath(g, cx, cy, cr); g.fill();
      g.setLineDash([K.stitch * 1.6, K.stitch * 1.4]); g.lineWidth = K.stitch * 0.45; g.strokeStyle = css(mix(c, [60, 90, 140], 0.4)); g.beginPath(); g.arc(cx - cr * 0.45, cy - cr * 0.3, cr * 0.6, 3.4, 5.6); g.stroke(); g.beginPath(); g.arc(cx + cr * 0.4, cy - cr * 0.2, cr * 0.5, 4, 6); g.stroke(); g.setLineDash([]); }
  },
  far(K, l, i) { feltPiece(K, (g, dx, dy) => { const n = l.pts.length; g.moveTo(l.pts[0][0], l.bottom); for (const q of l.pts) g.lineTo(q[0] + dx, q[1] - dy); g.lineTo(l.pts[n - 1][0], l.bottom); }, K.colA(farCol(K, i), 0), 0); },
  band(K, b, i) {
    const g = K.g, h = K.h, tk = K.stitch, c = K.colA(groundRGB(K.f, K.gv, b.u), 0);
    g.fillStyle = 'rgba(30,20,40,0.2)'; bandPath(g, b.pts, h + 2, -K.sh * 0.6); g.fill();
    g.fillStyle = css(c); bandPath(g, b.pts, h + 2); g.fill();
    g.lineJoin = 'round'; g.strokeStyle = css(mul(c, 1.14), 0.55); g.lineWidth = tk * 0.9; topLine(g, b.pts); g.stroke();
    const th = 'rgba(255,246,222,0.7)'; g.strokeStyle = th;
    if (i % 2) { g.setLineDash([tk * 0.55, tk * 2.9]); g.lineWidth = tk * 2.8; topLine(g, b.pts, tk * 1.6); g.stroke(); g.setLineDash([]); g.lineWidth = tk * 0.35; topLine(g, b.pts, tk * 0.3); g.stroke(); }
    else { g.setLineDash([tk * 1.8, tk * 1.5]); g.lineWidth = tk * 0.45; topLine(g, b.pts, tk * 1.6); g.stroke(); g.setLineDash([]); }
  },
  plant(K, it) { feltItem(K, it.parts, itT(it), K.plantT, it.fog * 0.6, false); },
  dino(K, it) { feltItem(K, it.parts, it.T, tonesOf(it.sp), it.fog * 0.5, true); },
  flyer(K, it) { feltItem(K, it.parts, it.T, tonesOf(it.sp), 0.1, true); },
  end(K) { const { g, w, h, st, p } = K; st.fuzz ||= fuzzPattern(g); st.fuzz.setTransform(new DOMMatrix().scale(h / 600)); g.save(); g.globalCompositeOperation = 'source-atop'; g.globalAlpha = Math.min(1, p.x2 * 1.6); g.fillStyle = st.fuzz; g.fillRect(0, 0, w, h); g.restore(); },
};

// ================================================================ 6. pop-up book
const pageX = (K, y, side) => { const u = clamp((y - K.pageTop) / (K.h - K.pageTop)); return side < 0 ? lerp(K.w * 0.05, -K.w * 0.03, u) : lerp(K.w * 0.95, K.w * 1.03, u); };
function pagePath(K) { const { g, w, h } = K; g.beginPath(); g.moveTo(w * 0.05, K.pageTop); g.lineTo(w * 0.95, K.pageTop); g.lineTo(w * 1.03, h + 2); g.lineTo(-w * 0.03, h + 2); g.closePath(); }
// how far a piece has unfolded: the book opens, the pieces swing up one after another, overshoot and settle
function openAt(K, x, depth) {
  const per = 30, tt = ((K.t % per) + per) % per, d = (1 - depth) * 0.5 + Math.abs(x / K.w - 0.5) * 1.1, u = tt - d;
  const a = u <= 0 ? 0 : 1 - Math.exp(-3 * u) * Math.cos(6.5 * u);
  return clamp(a * (1 - smooth(per - 1.6, per - 0.5, tt)), 0.04, 1.3);
}
function standUp(K, x, y, depth, fn) {
  const g = K.g, o = openAt(K, x, depth);
  g.save(); g.translate(x, y); g.transform(1, 0, (1 - o) * (x < K.w / 2 ? -0.5 : 0.5), o, 0, 0); g.translate(-x, -y); fn(o); g.restore();
}
function popItem(K, parts, T, P, isDino, depth, tabW) {
  const g = K.g, bw = clamp(T.k * (isDino ? 0.09 : 0.05), 0.8, K.h * 0.009), o = openAt(K, T.x, depth);
  // the cast shadow lies on the page in front of the piece; the tab is glued to the page
  g.save(); g.translate(T.x, T.y); g.transform(1, 0, 0.55, -0.24 * o, 0, 0); g.translate(-T.x, -T.y); g.fillStyle = K.pageShadow; g.lineJoin = 'round';
  for (const q of parts) if (!q.l && (!isDino || MAJOR[q.k])) { g.beginPath(); trace(g, q, T); g.fill(); } g.restore();
  if (tabW) { const tw = tabW, th = Math.max(2, T.k * 0.16); g.fillStyle = 'rgba(60,40,30,0.25)'; g.fillRect(T.x - tw + 1, T.y - th * 0.2 + 1.5, tw * 2, th); g.fillStyle = '#fbf8ef'; g.fillRect(T.x - tw, T.y - th * 0.2, tw * 2, th); g.strokeStyle = 'rgba(120,100,80,0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(T.x - tw, T.y - th * 0.2); g.lineTo(T.x + tw, T.y - th * 0.2); g.stroke(); }
  standUp(K, T.x, T.y, depth, () => {
    g.lineJoin = g.lineCap = 'round';
    unionPath(g, parts, sT(T, bw * 0.8, bw * 0.8), !isDino); g.strokeStyle = 'rgba(40,24,30,0.22)'; g.lineWidth = bw * 2; g.stroke();
    unionPath(g, parts, T, !isDino); g.strokeStyle = '#fbf8ef'; g.lineWidth = bw * 2; g.stroke(); g.fillStyle = '#fbf8ef'; g.fill();
    const s2 = bw * 0.5;
    for (const q of parts) {
      const c = P[q.t]; if (!c) continue;
      if (q.l) { g.beginPath(); trace(g, q, T); g.strokeStyle = c; g.lineWidth = Math.max(0.6, q.w * T.k); g.stroke(); continue; }
      if (isDino && INNER[q.k] && q.t !== 'far' && q.t !== 'accentFar') { g.beginPath(); trace(g, q, sT(T, s2 * 0.6, s2)); g.fillStyle = 'rgba(30,18,40,0.2)'; g.fill(); }
      g.beginPath(); trace(g, q, T); g.fillStyle = c; g.fill();
      if (q.k === 'eye') pupil(g, q, T);
    }
  });
}
const POPUP = {
  tr: c => sat(c, 1.22),
  begin(K) { K.pageTop = K.v.horizon - K.h * 0.012; K.pageShadow = 'rgba(70,50,60,0.2)'; },
  sky(K) { const { g, w, h } = K, gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, css(mix(K.sky[0], [90, 80, 110], 0.35))); gr.addColorStop(0.6, css(mix(K.sky[1], [200, 180, 170], 0.3))); gr.addColorStop(1, '#5a4438'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    if (K.v.sun.night > 0.3) stars(K, 40, `rgba(255,250,224,${K.v.sun.night})`, h * 0.004); },
  far(K, l, i) {
    const g = K.g, y = K.pageTop; standUp(K, K.w / 2, y, 0.05 + i * 0.1, () => {
      g.lineJoin = 'round'; bandPath(g, l.pts, y + 2, K.h * 0.004 - (i ? 0 : K.h * 0.02)); g.strokeStyle = '#fbf8ef'; g.lineWidth = K.h * 0.012; g.fillStyle = 'rgba(40,24,30,0.2)'; g.fill(); g.stroke();
      g.fillStyle = K.col(farCol(K, i)); g.fill(); });
  },
  band(K, b, i) {
    const { g, w, h, v } = K, n = v.layers.length;
    if (i === 0) { // the open book: page edges, then the cream spread
      g.fillStyle = '#3a2a26'; g.beginPath(); g.moveTo(w * 0.035, K.pageTop - h * 0.012); g.lineTo(w * 0.965, K.pageTop - h * 0.012); g.lineTo(w * 1.06, h + 2); g.lineTo(-w * 0.06, h + 2); g.closePath(); g.fill();
      g.fillStyle = '#e4dccb'; g.beginPath(); g.moveTo(w * 0.043, K.pageTop - h * 0.006); g.lineTo(w * 0.957, K.pageTop - h * 0.006); g.lineTo(w * 1.045, h + 2); g.lineTo(-w * 0.045, h + 2); g.closePath(); g.fill();
      g.fillStyle = css(CREAM); pagePath(K); g.fill();
    }
    g.save(); pagePath(K); g.clip();
    g.fillStyle = K.col(mix(groundRGB(K.f, K.gv, b.u), CREAM, 0.3)); bandPath(g, b.pts, h + 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = Math.max(1, h * 0.002); topLine(g, b.pts, 1); g.stroke();
    // the centre fold
    const y0 = Math.min(b.pts[18][1], b.pts[19][1]) - h * 0.02, gr = g.createLinearGradient(w * 0.44, 0, w * 0.56, 0);
    gr.addColorStop(0, 'rgba(60,40,40,0)'); gr.addColorStop(0.47, 'rgba(60,40,40,0.16)'); gr.addColorStop(0.5, 'rgba(40,24,24,0.42)'); gr.addColorStop(0.53, 'rgba(255,255,255,0.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.save(); bandPath(g, b.pts, h + 2); g.clip(); g.fillStyle = gr; g.fillRect(w * 0.44, y0, w * 0.12, h - y0); g.restore();
    if (i === n - 1 && v.lead) { const sp = v.lead.sp; g.fillStyle = 'rgba(50,36,30,0.78)'; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
      g.font = `italic ${Math.round(h * 0.042)}px Georgia, serif`; g.fillText(sp.name, w * 0.045, h * 0.945);
      if (sp.means) { g.font = `${Math.round(h * 0.026)}px Georgia, serif`; g.fillText(`“${sp.means}”`, w * 0.045, h * 0.98); } }
    g.restore();
  },
  water(K, b) { const g = K.g; g.save(); pagePath(K); g.clip(); waterRects(g, b, K.col([120, 176, 206])); g.restore(); },
  plant(K, it) { if (it.x < pageX(K, it.y, -1) + it.k || it.x > pageX(K, it.y, 1) - it.k) return; const big = it.k * 3 > K.h * 0.02; popItem(K, it.parts, itT(it), pal(K, K.plantT, it.fog * 0.6), false, 1 - it.fog, big ? it.k * 0.5 : 0); },
  dino(K, it) { popItem(K, it.parts, it.T, pal(K, tonesOf(it.sp), it.fog * 0.5), true, 1 - it.fog, it.sp.len * it.pose.scale * it.T.k * 0.16); },
  flyer(K, it) { const g = K.g, T = it.T; g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = Math.max(1, K.h * 0.0016); g.beginPath(); g.moveTo(T.x, T.y); g.lineTo(T.x + (T.x - K.w / 2) * 0.1, -4); g.stroke(); paperItem(K, it.parts, T, pal(K, tonesOf(it.sp), 0.1), false); },
  end(K) { grain(K, K.p.x2 * 1.3); },
};

// ================================================================ 7. quilling
function quillPatterns(g) {
  const mk = (w, h, draw) => { const b = buffer(w, h), c = b.ctx; c.lineCap = 'round';
    for (const [col, lw, o] of [['rgba(30,16,10,0.5)', 3, 0], ['rgba(255,255,255,0.62)', 1.5, -1.1]]) { c.strokeStyle = col; c.lineWidth = lw; c.save(); c.translate(o, o); draw(c); c.restore(); }
    return g.createPattern(b.canvas, 'repeat'); };
  const spiral = (c, x, y, R, turns, a0 = 0) => { c.beginPath(); for (let a = 0; a <= turns * TAU; a += 0.22) { const r = R * a / (turns * TAU); c.lineTo(x + Math.cos(a + a0) * r, y + Math.sin(a + a0) * r); } c.arc(x, y, R, turns * TAU + a0, turns * TAU + a0 + TAU); c.stroke(); };
  return {
    coil: mk(64, 111, c => { spiral(c, 32, 27.75, 30, 2.7); spiral(c, 0, 83.25, 30, 2.7, 2); spiral(c, 64, 83.25, 30, 2.7, 2); }),
    ring: mk(64, 111, c => { for (const [x, y] of [[32, 27.75], [0, 83.25], [64, 83.25]]) for (let r = 30; r > 3; r -= 9.5) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke(); } }),
    scroll: mk(128, 64, c => { c.beginPath(); for (let a = 0; a <= 2.3 * TAU; a += 0.2) { const r = 26 * (1 - a / (2.3 * TAU)) + 2; c.lineTo(36 + Math.cos(a + 1.57) * r, 34 + Math.sin(a + 1.57) * r); } c.stroke();
      c.beginPath(); for (let a = 0; a <= 2.3 * TAU; a += 0.2) { const r = 26 * (1 - a / (2.3 * TAU)) + 2; c.lineTo(98 - Math.cos(a + 1.57) * r, 30 - Math.sin(a + 1.57) * r); } c.stroke(); }),
    leaf: mk(40, 72, c => { for (const [x, y] of [[20, 18], [0, 54], [40, 54]]) for (const k of [1, 0.55, 0.2]) { c.beginPath(); c.moveTo(x, y - 17); c.quadraticCurveTo(x + 18 * k, y, x, y + 17); c.quadraticCurveTo(x - 18 * k, y, x, y - 17); c.stroke(); } }),
  };
}
function quillFill(K, col, pat, s, ax, ay, strip) {
  const g = K.g;
  g.fillStyle = css(mul(col, 0.86)); g.fill();
  if (K.p.x2 > 0.03) { pat.setTransform(new DOMMatrix([s, 0, 0, s, ax, ay])); g.fillStyle = pat; if (K.p.x2 < 0.5) { const a = g.globalAlpha; g.globalAlpha = a * K.p.x2 * 2; g.fill(); g.globalAlpha = a; } else g.fill(); }
  if (strip) { g.strokeStyle = css(mul(col, 0.52)); g.lineWidth = strip; g.stroke(); g.strokeStyle = css(mul(col, 1.4)); g.lineWidth = strip * 0.45; g.stroke(); }
}
function quillItem(K, parts, T, tones, fog, D, isDino) {
  const g = K.g, Q = K.st.quill, s = D / 64, strip = clamp(D * 0.14, 0.7, K.h * 0.0045);
  g.lineJoin = g.lineCap = 'round';
  for (const q of parts) {
    const c = tones[q.t]; if (!c) continue;
    const col = K.colA(c, fog);
    g.beginPath(); trace(g, q, T);
    if (q.l) { const lw = Math.max(1, q.w * T.k * 1.2); g.strokeStyle = css(mul(col, 0.55)); g.lineWidth = lw + strip * 0.6; g.stroke(); g.strokeStyle = css(mul(col, 1.25)); g.lineWidth = lw * 0.6; g.stroke(); continue; }
    if (q.k === 'eye') { g.fillStyle = '#fbf6e8'; g.fill(); pupil(g, q, T); continue; }
    const small = q.k === 'tooth' || q.k === 'claw' || q.k === 'mark' || q.k === 'scute' || q.k === 'fuzz' || q.k === 'nostril';
    if (small) { g.fillStyle = css(col); g.fill(); g.strokeStyle = css(mul(col, 0.55)); g.lineWidth = strip * 0.5; g.stroke(); continue; }
    if (D < K.h * 0.0125) { g.fillStyle = css(col); g.fill(); g.strokeStyle = css(mul(col, 0.55)); g.lineWidth = strip * 0.6; g.stroke(); continue; }
    const leafy = !isDino && (q.t === 'leaf' || q.t === 'leaf2') && !q.c, limbs = q.k === 'leg' || q.k === 'arm' || q.k === 'foot';
    quillFill(K, col, leafy ? Q.leaf : q.t === 'belly' || q.t === 'accent' || q.c ? Q.ring : Q.coil, (leafy ? 1.1 : limbs ? 0.62 : q.t === 'belly' ? 0.55 : 1) * s, T.x, T.y, strip * (q.k === 'belly' ? 0.5 : 1));
  }
}
const QUILL = {
  tr: c => mul(sat(c, 1.45), 1.08),
  begin(K) { K.st.quill ||= quillPatterns(K.g); },
  sky(K) {
    const { g, w, h, v } = K, s = v.sun, card = mix(CREAM, K.sky[0], 0.12 + 0.75 * s.night), lw = h * 0.006;
    g.fillStyle = css(card); g.fillRect(0, 0, w, h);
    const strip = (col, build) => { g.beginPath(); build(); g.strokeStyle = css(mul(col, 0.6)); g.lineWidth = lw; g.stroke(); g.beginPath(); build(); g.strokeStyle = css(mul(col, 1.3)); g.lineWidth = lw * 0.45; g.stroke(); };
    g.lineCap = 'round';
    // wind scrolls across the sky
    for (let i = 0; i < Math.round(2 + K.p.x4 * 8); i++) { const x = ((hash(i, 21) + K.t * 0.003) % 1) * w * 1.2 - w * 0.1, y = h * (0.06 + 0.4 * hash(i, 22)), r = h * (0.03 + 0.04 * hash(i, 23)), dir = i % 2 ? 1 : -1;
      strip(mix(K.sky[0], [120, 170, 220], 0.5), () => { g.moveTo(x - dir * r * 4, y + r); for (let a = 0; a <= 2.2 * TAU; a += 0.25) { const rr = r * (1 - a / (2.25 * TAU)); g.lineTo(x + dir * Math.sin(a) * rr, y + Math.cos(a) * rr); } }); }
    const sc = s.moon ? [236, 232, 214] : mix([250, 190, 60], [246, 120, 60], s.dusk), R = s.r * 1.9;
    for (let i = 0; i < 12; i++) { const a = i * TAU / 12 + K.t * 0.05, c = Math.cos(a), sn = Math.sin(a); if (!s.moon) strip(mix(sc, [255, 230, 120], 0.5), () => { g.moveTo(s.x + c * R * 1.15, s.y + sn * R * 1.15); g.quadraticCurveTo(s.x + c * R * 1.5 - sn * R * 0.22, s.y + sn * R * 1.5 + c * R * 0.22, s.x + c * R * 1.9, s.y + sn * R * 1.9); g.quadraticCurveTo(s.x + c * R * 1.5 + sn * R * 0.22, s.y + sn * R * 1.5 - c * R * 0.22, s.x + c * R * 1.15, s.y + sn * R * 1.15); }); }
    strip(sc, () => { for (let a = 0; a <= 5 * TAU; a += 0.2) { const rr = R * a / (5 * TAU); g.lineTo(s.x + Math.cos(a) * rr, s.y + Math.sin(a) * rr); } g.arc(s.x, s.y, R, 0, TAU); });
  },
  far(K, l, i) { const g = K.g, c = K.colA(mix(farCol(K, i), CREAM, 0.15), 0); bandPath(g, l.pts, l.bottom); quillFill(K, c, K.st.quill.scroll, K.h / 540 * 0.8, -K.v.camX * (i + 1) * 0.3, l.bottom, K.h * 0.004); },
  band(K, b, i) {
    const g = K.g, h = K.h, c = K.colA(groundRGB(K.f, K.gv, b.u), 0), s = h / 540 * lerp(0.45, 1.25, b.u) * (0.6 + K.p.x3 * 0.8);
    g.lineJoin = 'round'; bandPath(g, b.pts, h + 8); quillFill(K, c, K.st.quill.scroll, s, K.v.sx(0, b.d) + i * 37, b.level, h * 0.0045);
  },
  water(K, b) { waterRects(K.g, b, K.col([110, 180, 220])); },
  plant(K, it) { quillItem(K, it.parts, itT(it), K.plantT, it.fog * 0.5, clamp(it.k * 0.8, K.h * 0.01, K.h * 0.034) * (0.6 + K.p.x3 * 0.8), false); },
  dino(K, it) { quillItem(K, it.parts, it.T, tonesOf(it.sp), it.fog * 0.4, clamp(it.sp.len * it.pose.scale * it.T.k * 0.1, K.h * 0.018, K.h * 0.065) * (0.6 + K.p.x3 * 0.8), true); },
  flyer(K, it) { quillItem(K, it.parts, it.T, tonesOf(it.sp), 0.05, clamp(it.sp.span * it.T.k * 0.1, K.h * 0.012, K.h * 0.03), true); },
  end(K) { grain(K, K.p.x2 * 0.5); },
};

// ================================================================ 8. shadow box at night
const boxCol = (K, t) => mix(mix(K.warm, [70, 30, 36], 0.72), [9, 7, 14], Math.pow(clamp(t), 0.75));
function glowEdge(K, pts, bottom) {
  const g = K.g, e = K.h * 0.016 * (0.3 + K.p.x1 * 1.4);
  g.save(); if (K.f.combo) g.globalCompositeOperation = 'source-atop';
  g.fillStyle = css(K.warm, 0.14); bandPath(g, pts, bottom, -e * 2.4); g.fill(); bandPath(g, pts, bottom, -e * 1.3); g.fill(); g.fillStyle = css(K.warm, 0.3); bandPath(g, pts, bottom, -e * 0.45); g.fill(); g.restore();
}
function shadowItem(K, parts, T, t, rim) {
  const g = K.g, c = boxCol(K, t), e = Math.min(K.h * 0.004, T.k * 0.05) * (0.4 + K.p.x1 * 1.2);
  g.lineJoin = g.lineCap = 'round';
  if (rim) { g.fillStyle = css(K.warm, 0.5); unionPath(g, parts, sT(T, -e * 0.4, -e)); g.fill(); }
  const body = css(c), far = css(mix(c, K.warm, 0.13));
  for (const q of parts) {
    if (q.k === 'mark' || q.k === 'belly' || q.k === 'mouth' || q.k === 'nostril' || q.t === 'flower') continue;
    g.beginPath(); trace(g, q, T);
    if (q.l) { g.strokeStyle = body; g.lineWidth = Math.max(0.7, q.w * T.k); g.stroke(); continue; }
    if (q.k === 'eye') { g.fillStyle = css(mix(K.warm, [255, 255, 240], 0.5)); g.fill(); continue; }
    g.fillStyle = q.t === 'far' || q.t === 'accentFar' ? far : body; g.fill();
  }
}
const SHADOW = {
  noNight: true, tr: c => c,
  begin(K) { K.warm = mix([255, 150, 70], [255, 222, 170], clamp(K.p.light * 1.4)); if (K.v.dark > 0) K.warm = mix(K.warm, [200, 80, 50], K.v.dark * 0.7); },
  sky(K) {
    const { g, w, h, v } = K, cx = w * 0.5, cy = v.horizon, gr = g.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w * 0.6, h * 0.7));
    gr.addColorStop(0, css(mix(K.warm, [255, 250, 230], 0.55))); gr.addColorStop(0.3, css(K.warm)); gr.addColorStop(0.62, css(mix(K.warm, [110, 40, 70], 0.72))); gr.addColorStop(1, '#150f26');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    // sheets of paper sky, each a little darker towards the corners
    for (let i = 0; i < 2 + Math.round(K.p.x4 * 4); i++) { const r = h * (0.62 + i * 0.2); g.fillStyle = 'rgba(16,10,32,0.2)'; g.beginPath(); g.rect(0, 0, w, h); g.ellipse(cx, cy, r * 1.25, r, 0, 0, TAU, true); g.fill(); }
    stars(K, 60, 'rgba(255,240,206,0.9)', h * 0.003);
    const mx = w * 0.7, my = h * 0.2, mr = h * 0.075, hl = g.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 3.2); hl.addColorStop(0, 'rgba(255,236,190,0.5)'); hl.addColorStop(1, 'rgba(255,220,160,0)');
    g.fillStyle = hl; g.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8); g.fillStyle = '#fff3d2'; g.beginPath(); g.arc(mx, my, mr, 0, TAU); g.fill();
  },
  far(K, l, i) { const g = K.g; glowEdge(K, l.pts, l.bottom); g.fillStyle = css(boxCol(K, 0.06 + i * 0.1)); bandPath(g, l.pts, l.bottom); g.fill(); },
  band(K, b) { const g = K.g; glowEdge(K, b.pts, K.h + 2); g.fillStyle = css(boxCol(K, 0.22 + b.u * 0.56)); bandPath(g, b.pts, K.h + 2); g.fill(); },
  water(K, b) { waterRects(K.g, b, css(mix(K.warm, [60, 30, 50], 0.55))); },
  plant(K, it) { shadowItem(K, it.parts, itT(it), 0.3 + (1 - it.fog / 0.75) * 0.62, false); },
  dino(K, it) { shadowItem(K, it.parts, it.T, 0.42 + (1 - it.fog / 0.75) * 0.58, true); },
  flyer(K, it) { shadowItem(K, it.parts, it.T, 0.5, false); },
  end(K) {
    const { g, w, h } = K;
    // fireflies, then the box itself
    for (let i = 0; i < 26; i++) { const x = (hash(i, 31) + 0.01 * Math.sin(K.t * 0.3 + i)) * w, y = h * (0.5 + 0.42 * hash(i, 32)) + Math.sin(K.t * 0.5 + i * 2) * h * 0.012, a = 0.35 + 0.65 * Math.abs(Math.sin(K.f.clock * (0.6 + hash(i, 33)) + i));
      g.fillStyle = `rgba(255,230,150,${a * 0.22})`; g.beginPath(); g.arc(x, y, h * 0.007, 0, TAU); g.fill(); g.fillStyle = `rgba(255,244,200,${a})`; g.beginPath(); g.arc(x, y, h * 0.0022, 0, TAU); g.fill(); }
    const t = h * 0.035; g.fillStyle = '#120c0c'; g.fillRect(0, 0, w, t); g.fillRect(0, h - t, w, t); g.fillRect(0, 0, t, h); g.fillRect(w - t, 0, t, h);
    g.strokeStyle = 'rgba(160,110,70,0.5)'; g.lineWidth = Math.max(1, h * 0.003); g.strokeRect(t, t, w - 2 * t, h - 2 * t);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = h * 0.012; g.strokeRect(t + h * 0.007, t + h * 0.007, w - 2 * t - h * 0.014, h - 2 * t - h * 0.014);
  },
};

const STYLES = { paper: PAPER, origami: ORIGAMI, glass: GLASS, mosaic: FLAT, felt: FELT, popup: POPUP, quill: QUILL, shadow: SHADOW };

export default {
  id: 'papercut',
  name: 'Paper & Craft',
  kind: '2d',
  sky: true,
  params: [
    { id: 'x1', label: 'Shadow depth', value: 0.5, tip: 'How far the pieces stand off the sheet below: drop shadows, lead lines, back-light' },
    { id: 'x2', label: 'Texture', value: 0.5, tip: 'Paper fibre, felt fuzz, glass streaks, tile colour variation, quilling coils' },
    { id: 'x3', label: 'Piece size', value: 0.5, tip: 'Size of the tiles, stitches, coils and glass panes' },
    { id: 'x4', label: 'Layers', value: 0.5, tip: 'Sheets of sky, clouds and scrolls behind the scene' },
  ],
  create(ctx, opts) {
    const W = createWorld(opts), style = STYLES[opts.style] ? opts.style : 'paper', S = STYLES[style], st = {};
    return {
      render(f) {
        const v = W.frame(f), { w, h, p } = f, sky = skyCols(v), haze = mix(sky[1], [226, 226, 230], 0.4), tr = S.tr;
        const colA = (c, fog) => { c = tr(c); return fog > 0 ? mix(c, haze, fog) : c; };
        const K = { f, g: f.ctx, v, w, h, p, t: f.t, E: f.era, S, st, sky, haze, gv: { biome: v.biome, light: 1 }, sh: h * 0.024 * p.x1, lw: h * (0.0028 + 0.005 * p.x1), stitch: h * 0.0042 * (0.6 + p.x3 * 0.8),
          shadow: `rgba(26,16,44,${style === 'origami' ? 0.2 : 0.3})`, plantT: plantTones(f.era), colA, col: (c, fog) => css(colA(c, fog)) };
        if (style === 'mosaic') mosaicRender(K); else stdRender(K);
      }
    };
  }
};

const S = (id, name, desc, tags, opts, params) => ({ id: 'papercut-' + id, name, desc, tags: [...tags, '2d'], opts, params });
export const scenes = [
  S('layers', 'Cut-Paper Triceratops', 'A horned family on the move, every hill, fern and frill a sheet of coloured paper with a shadow under it.', ['paper', 'ceratopsian', 'cretaceous', 'herd', 'family'],
    { style: 'paper', cast: [{ sp: 'triceratops', n: 3, young: 2 }], biome: 'plain', seed: 5, flyers: 1 }, { stage: 0.855, light: 0.8 }),
  S('origami', 'Origami Dawn', 'The first dinosaurs folded from single sheets: Plateosaurus and a pack of Coelophysis in Triassic badlands.', ['origami', 'sauropod', 'theropod', 'triassic', 'pack'],
    { style: 'origami', cast: [{ sp: 'plateosaurus', n: 2 }, { sp: 'coelophysis', n: 4 }], biome: 'badlands', seed: 2, flyers: 2 }, { stage: 0.1, light: 0.75 }),
  S('glass', 'Stained-Glass Stegosaurus', 'Plates like window panes: a Stegosaurus and her calf leaded into an arched window, the low sun glowing through.', ['stained glass', 'stegosaur', 'jurassic', 'family'],
    { style: 'glass', cast: [{ sp: 'stegosaurus', n: 2, young: 1 }], biome: 'plain', seed: 8, flyers: 1, pace: 0.6, frame: 1.15 }, { stage: 0.43, light: 0.42 }),
  S('mosaic', 'Mosaic Styracosaurus', 'A spiked herd crossing the fern plain, laid in small square tiles like a Roman floor.', ['mosaic', 'ceratopsian', 'cretaceous', 'herd', 'family'],
    { style: 'mosaic', cast: [{ sp: 'styracosaurus', n: 3, young: 1 }], biome: 'plain', seed: 4, flyers: 2, frame: 0.85 }, { stage: 0.82 }),
  S('felt', 'Felt Nursery', 'Good mother lizards and their hatchlings in appliqué felt, blanket-stitched, with button eyes.', ['felt', 'ornithopod', 'cretaceous', 'family', 'nest'],
    { style: 'felt', cast: [{ sp: 'maiasaura', n: 3, young: 5 }], mode: 'nest', biome: 'plain', seed: 9, frame: 1.25 }, { stage: 0.795, herd: 0.55 }),
  S('popup', 'Pop-Up Tyrant', 'Open the book: T. rex stalks two Ankylosaurus, all of them swinging up on paper tabs and settling on the spread.', ['pop-up book', 'theropod', 'ankylosaur', 'cretaceous', 'hunt'],
    { style: 'popup', cast: [{ sp: 'ankylosaurus', n: 2 }, { sp: 'tyrannosaurus', n: 1, role: 'pred' }], mode: 'hunt', biome: 'plain', seed: 3, flyers: 2 }, { stage: 0.855, light: 0.85 }),
  S('quilling', 'Quilled Shore', 'Crested duck-bills on the beach and pterosaurs overhead, coiled from paper strips.', ['quilling', 'ornithopod', 'cretaceous', 'flyers', 'coast'],
    { style: 'quill', cast: [{ sp: 'parasaurolophus', n: 3, young: 1 }], biome: 'coast', seed: 12, flyers: 5 }, { stage: 0.8, light: 0.9 }),
  S('shadowbox', 'Shadow Box Long-Necks', 'A Diplodocus herd crosses a shadow box at night: black card silhouettes with warm light between the layers.', ['shadow box', 'sauropod', 'jurassic', 'herd', 'night'],
    { style: 'shadow', cast: [{ sp: 'diplodocus', n: 3, young: 2 }], biome: 'forest', seed: 11, flyers: 2 }, { stage: 0.42, light: 0.12 }),
  S('deeptime', 'Paper Deep Time', 'One cut-paper valley through 180 million years: the cast changes with the eras until the sky falls.', ['paper', 'time travel', 'herd', 'impact'],
    { style: 'paper', cast: 'era', biome: 'floodplain', seed: 1 }, { stage: 0.02, grow: 0.5, light: 0.7 }),
];
