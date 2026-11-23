// Fossils & Digs: what is left of the dinosaurs, and how we know. Rock layers, a dig, the road from death to
// discovery, famous slabs, a trackway, amber, a museum drawer and a CT scan. No shared world here: every scene is a
// diagram or a specimen drawn straight from the rig (bones(pose(...)) posed as a carcass).
// Controls: Uncovered (x1), Dust (x2), Depth (x3), Labels (x4). Light runs from a lamp-lit night to noon.
import { clamp, lerp, smooth, fract, rng, hash, noise2, buffer, puff, skyGradient, daylight, windX, energy } from '../util.js';
import { species, standIn } from '../species.js';
import { pose, parts, bones, topParts, gait, size } from '../rig.js';
import { drawParts, palette, trace } from '../draw.js';
import { plantParts, plantPalette, flora, PLANTS } from '../flora.js';

const PI = Math.PI, TAU = PI * 2;
const FONT = '"Avenir Next","Helvetica Neue",Helvetica,Arial,system-ui,sans-serif';
const SERIF = 'Georgia,"Times New Roman",serif';
const MONO = 'ui-monospace,Menlo,Consolas,monospace';

// ---------------------------------------------------------------- small helpers
// drawParts resets globalAlpha for every part; this keeps whatever alpha is set (and drops outlines while faded)
const fadeAlpha = a => new Proxy({}, { get: () => a });
function dp(ctx, ps, T, look = {}) {
  const a = ctx.globalAlpha;
  if (a >= 0.995) return drawParts(ctx, ps, T, look);
  drawParts(ctx, ps, T, { ...look, alpha: fadeAlpha(a), lw: a > 0.6 ? look.lw : 0, pupil: false }); ctx.globalAlpha = a;
}
function text(ctx, s, x, y, px, col, o = {}) {
  ctx.font = `${o.italic ? 'italic ' : ''}${o.bold ? '600 ' : ''}${Math.max(5, px).toFixed(1)}px ${o.font || FONT}`;
  ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'alphabetic';
  if (o.halo) { ctx.strokeStyle = o.halo; ctx.lineWidth = px * 0.32; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y); }
  ctx.fillStyle = col; ctx.fillText(s, x, y);
}
const hex = c => { const p = parseInt(c.slice(1), 16); return [p >> 16, p >> 8 & 255, p & 255]; };
const mixC = (a, b, t, al = 1) => { const A = hex(a), B = hex(b); return `rgba(${lerp(A[0], B[0], t) | 0},${lerp(A[1], B[1], t) | 0},${lerp(A[2], B[2], t) | 0},${al})`; };
const maSpan = sp => `${sp.ma[0]}–${sp.ma[1]} million years ago`;
const pick = (f, id) => f.opts.lock ? species(id) : (standIn(id, f.era.ma) || species(id));

let GRAIN = null;
function grainTile() {
  if (GRAIN) return GRAIN;
  const b = buffer(128, 128), im = b.ctx.createImageData(128, 128), R = rng(77);
  for (let i = 0; i < 128 * 128; i++) { const v = R() < 0.5 ? 0 : 255; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = R() * R() * 110; }
  b.ctx.putImageData(im, 0, 0);
  return GRAIN = b.canvas;
}
function grain(ctx, x, y, w, h, alpha, s = 1) {
  const g = grainTile(), sz = Math.max(48, 128 * s);
  ctx.save(); ctx.globalAlpha = alpha; ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  for (let yy = y; yy < y + h; yy += sz) for (let xx = x; xx < x + w; xx += sz) ctx.drawImage(g, xx, yy, sz, sz);
  ctx.restore();
}
// soft colour blotches (staining, mottling)
function blotches(ctx, R, x, y, w, h, n, cols, r0, r1, alpha) {
  for (let i = 0; i < n; i++) {
    const cx = x + R() * w, cy = y + R() * h, r = lerp(r0, r1, R() * R()), c = cols[(R() * cols.length) | 0], g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(${c},${alpha * (0.4 + 0.6 * R())})`); g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
}
// per-instance cache of pre-painted canvases, dropped when the size changes
function buf(st, key, w, h, paint) {
  st.cache = st.cache || new Map();
  if (st.cw !== w || st.ch !== h) { st.cache.clear(); st.cw = w; st.ch = h; }
  let c = st.cache.get(key);
  if (!c) { if (st.cache.size > 10) st.cache.clear(); const b = buffer(w, h); paint(b.ctx, w, h); c = b.canvas; st.cache.set(key, c); }
  return c;
}
function memo(st, key, make) { st.memo = st.memo || new Map(); if (!st.memo.has(key)) { if (st.memo.size > 40) st.memo.clear(); st.memo.set(key, make()); } return st.memo.get(key); }

// night lamp and golden-hour tint over a finished picture; (cx, cy) is where the lamp shines
function lighting(f, cx, cy, rad) {
  const { ctx, w, h } = f, d = daylight(f.p.light);
  if (d.dusk > 0.01) { ctx.fillStyle = `rgba(255,150,60,${d.dusk * 0.14})`; ctx.fillRect(0, 0, w, h); }
  if (d.night > 0.01) {
    const fl = 1 + 0.02 * Math.sin(f.clock * 9) + 0.015 * Math.sin(f.clock * 23), g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad * fl);
    g.addColorStop(0, `rgba(255,190,110,${0.12 * d.night})`); g.addColorStop(0.4, `rgba(70,40,30,${0.3 * d.night})`); g.addColorStop(1, `rgba(5,7,18,${0.93 * d.night})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
}

// ---------------------------------------------------------------- carcasses
// The classic death pose: the neck curls back over the body and the tail lifts, as tendons dry and shorten.
function deathPose(q, k = 1, kt = 0.6) {
  const n = q.nodes, { iSh, iEnd, iHip } = q;
  let per = k * 1.9 / (iEnd - iSh), px = n[iSh].x, py = n[iSh].y, ox = px, oy = py;
  for (let i = iSh + 1; i <= iEnd; i++) {
    const dx = n[i].x - ox, dy = n[i].y - oy, a = per * (i - iSh), c = Math.cos(a), s = Math.sin(a);
    ox = n[i].x; oy = n[i].y; px += dx * c - dy * s; py += dx * s + dy * c; n[i].x = px; n[i].y = py;
  }
  q.head.x = px; q.head.y = py; q.head.a += per * (iEnd - iSh) + 0.3 * k;
  per = -kt * 1.1 / iHip; px = ox = n[iHip].x; py = oy = n[iHip].y;
  for (let i = iHip - 1; i >= 0; i--) {
    const dx = n[i].x - ox, dy = n[i].y - oy, a = per * (iHip - i), c = Math.cos(a), s = Math.sin(a);
    ox = n[i].x; oy = n[i].y; px += dx * c - dy * s; py += dx * s + dy * c; n[i].x = px; n[i].y = py;
  }
  return q;
}
function corpse(sp, o = {}) {
  return deathPose(pose(sp, { crouch: o.crouch ?? 1, headTo: o.headTo ?? 0.5, jaw: o.jaw ?? 0.45, phase: o.phase ?? 0.12, t: o.seed ?? 1 }), o.arch ?? 1, o.tail ?? 0.6);
}
const BODYK = new Set(['bone', 'toe', 'rib', 'vert', 'spine', 'chevron', 'pelvis', 'scapula', 'plate', 'spike', 'club']);
const isHead = q => !BODYK.has(q.k);
// shift and turn each bone a little, as a carcass that lay in the open for a while; the skull stays in one piece
function scatter(ps, L, seed, amt, lose = 0) {
  let lastVert = 0;
  const out = [];
  ps.forEach((q, i) => {
    if (q.k === 'vert') lastVert = i;
    const head = isHead(q), j = head ? 9999 : q.k === 'spine' || q.k === 'chevron' ? lastVert : q.k === 'pelvis' ? 9998 : i;
    if (lose && (q.k === 'toe' || q.k === 'rib') && hash(i, seed + 3) < lose) return;
    const r = amt * L * (head ? 0.012 : q.k === 'rib' || q.k === 'toe' ? 0.022 : 0.011);
    const dx = (hash(j, seed) - 0.5) * 2 * r, dy = (hash(j, seed + 7) - 0.5) * 2 * r, a = head ? 0 : (hash(j, seed + 13) - 0.5) * amt * 0.45;
    if (q.c) { out.push({ ...q, c: [q.c[0] + dx, q.c[1] + dy, q.c[2]] }); return; }
    const pts = q.p || q.l; let cx = 0, cy = 0; for (const v of pts) { cx += v[0]; cy += v[1]; } cx /= pts.length; cy /= pts.length;
    const c = Math.cos(a), s = Math.sin(a), m = pts.map(v => [cx + (v[0] - cx) * c - (v[1] - cy) * s + dx, cy + (v[0] - cx) * s + (v[1] - cy) * c + dy]);
    out.push(q.p ? { ...q, p: m } : { ...q, l: m });
  });
  return out;
}
// screen-space bounding box (per metre) of parts turned by rot and facing dir
function extent(ps, rot = 0, dir = 1) {
  const c = Math.cos(rot), s = Math.sin(rot); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const add = (x, y, r) => { const X = x * dir * c + y * s, Y = x * dir * s - y * c; if (X - r < x0) x0 = X - r; if (X + r > x1) x1 = X + r; if (Y - r < y0) y0 = Y - r; if (Y + r > y1) y1 = Y + r; };
  for (const q of ps) { if (q.c) add(q.c[0], q.c[1], q.c[2]); else for (const v of (q.p || q.l)) add(v[0], v[1], 0); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}
// fit parts into a box centred on (cx, cy)
function place(ps, cx, cy, bw, bh, rot = 0, dir = 1) {
  const e = extent(ps, rot, dir), k = Math.min(bw / e.w, bh / e.h);
  return { x: cx - (e.x0 + e.x1) / 2 * k, y: cy - (e.y0 + e.y1) / 2 * k, k, dir, rot, hw: e.w * k / 2, hh: e.h * k / 2 };
}
function drawAt(ctx, ps, P, look, dx = 0, dy = 0) {
  ctx.save(); ctx.translate(P.x + dx, P.y + dy); ctx.rotate(P.rot); dp(ctx, ps, { x: 0, y: 0, k: P.k, dir: P.dir }, look); ctx.restore();
}
const toScreen = (P, x, y) => { const c = Math.cos(P.rot), s = Math.sin(P.rot); return [P.x + (x * P.dir * c + y * s) * P.k, P.y + (x * P.dir * s - y * c) * P.k]; };
const toLocal = (P, X, Y) => { const u = (X - P.x) / P.k, v = (Y - P.y) / P.k, c = Math.cos(P.rot), s = Math.sin(P.rot); return [(u * c + v * s) * P.dir, u * s - v * c]; };
const boneLook = (bone, far, hole, stroke, lw = 0) => ({ pal: { bone, boneFar: far, hole }, stroke: lw > 0 ? stroke : undefined, lw, pupil: false });
const flat = col => ({ fill: () => col, pupil: false });

function ik(a, b, l1, l2, bend) {
  const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1e-6, dm = clamp(d, Math.abs(l1 - l2) * 1.02, (l1 + l2) * 0.998), ux = dx / d, uy = dy / d;
  const m = (l1 * l1 - l2 * l2 + dm * dm) / (2 * dm), hh = Math.sqrt(Math.max(0, l1 * l1 - m * m));
  return { j: [a[0] + ux * m - uy * hh * bend, a[1] + uy * m + ux * hh * bend], e: [a[0] + ux * dm, a[1] + uy * dm] };
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// stretch a limb (hip/knee/ankle/toe or shoulder/elbow/wrist/tip) so its end touches a target (body frame)
function reach(g, target, bend) {
  const p = g.pts, l1 = dist(p[0], p[1]), l2 = dist(p[1], p[2]), l3 = dist(p[2], p[3]);
  const d = dist(p[0], target) || 1e-6, ux = (target[0] - p[0][0]) / d, uy = (target[1] - p[0][1]) / d;
  const wr = [target[0] - ux * l3, target[1] - uy * l3], k = ik(p[0], wr, l1, l2, bend);
  g.pts = [p[0], k.j, k.e, [k.e[0] + ux * l3, k.e[1] + uy * l3]];
  if (g.tip) g.tip = [g.pts[3][0] + ux * l3 * 0.5, g.pts[3][1] + uy * l3 * 0.5];
}
// rebuild a limb from its root with absolute joint angles
function setLimb(g, angs, scale = 1) {
  const p = g.pts, out = [p[0]];
  for (let i = 0; i < 3; i++) { const l = dist(p[i], p[i + 1]) * scale, a = out[i]; out.push([a[0] + l * Math.cos(angs[i]), a[1] + l * Math.sin(angs[i])]); }
  g.pts = out; if (g.tip) { const l = dist(p[2], p[3]) * 0.6; g.tip = [out[3][0] + l * Math.cos(angs[2]), out[3][1] + l * Math.sin(angs[2])]; }
}

// ---------------------------------------------------------------- slabs and specimen cards
// an irregular slab outline inside a box
function slabPoly(x, y, w, h, seed, rough = 1) {
  const pts = [], N = 56, R = rng(Math.imul(seed + 1, 2654435761)), chip = [R() * N | 0, R() * N | 0];
  for (let i = 0; i < N; i++) {
    const a = i / N * TAU, c = Math.cos(a), s = Math.sin(a), e = 5, m = Math.pow(Math.pow(Math.abs(c), e) + Math.pow(Math.abs(s), e), -1 / e);
    let r = m * (1 - 0.035 * rough * noise2(i * 0.55, seed * 3.1) - 0.02 * rough * noise2(i * 2.1, seed + 9));
    for (const ch of chip) { const dd = Math.min(Math.abs(i - ch), N - Math.abs(i - ch)); if (dd < 3) r *= 1 - 0.05 * rough * (3 - dd) / 3; }
    pts.push([x + w / 2 + c * r * w / 2, y + h / 2 + s * r * h / 2]);
  }
  return pts;
}
const polyPath = (ctx, pts, dx = 0, dy = 0) => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0] + dx, p[1] + dy) : ctx.moveTo(p[0] + dx, p[1] + dy)); ctx.closePath(); };
function dendrite(ctx, R, x, y, a, len, depth) {
  if (depth <= 0 || len < 1) return;
  const x1 = x + Math.cos(a) * len, y1 = y + Math.sin(a) * len;
  ctx.moveTo(x, y); ctx.lineTo(x1, y1);
  const n = depth > 3 ? 3 : 2;
  for (let i = 0; i < n; i++) dendrite(ctx, R, lerp(x, x1, 0.4 + 0.6 * R()), lerp(y, y1, 0.4 + 0.6 * R()), a + (R() - 0.5) * 1.9, len * (0.5 + 0.25 * R()), depth - 1);
}
// a slab on a dark cloth: o = { box: [x, y, w, h], seed, top, low (face colours), side, bg, stains, veins, dendrites, beds }
function paintSlab(c, w, h, o) {
  const R = rng(Math.imul(o.seed + 11, 2246822519)), [x, y, bw, bh] = o.box, pts = slabPoly(x, y, bw, bh, o.seed, o.rough ?? 1), u = h / 540;
  const g0 = c.createLinearGradient(0, 0, 0, h); g0.addColorStop(0, o.bg[0]); g0.addColorStop(1, o.bg[1]); c.fillStyle = g0; c.fillRect(0, 0, w, h);
  grain(c, 0, 0, w, h, 0.25, u);
  c.fillStyle = 'rgba(0,0,0,.45)'; polyPath(c, pts, 10 * u, 14 * u); c.fill();
  c.fillStyle = o.side; polyPath(c, pts, 3 * u, 6 * u); c.fill();
  const g = c.createLinearGradient(x, y, x + bw, y + bh); g.addColorStop(0, o.top); g.addColorStop(1, o.low);
  c.save(); polyPath(c, pts); c.fillStyle = g; c.fill(); c.clip();
  blotches(c, R, x, y, bw, bh, 46, o.stains, bh * 0.05, bh * 0.3, 0.16);
  if (o.beds) { c.lineWidth = Math.max(0.6, u); for (let i = 0; i < 46; i++) { const yy = y + R() * bh, tilt = (R() - 0.5) * bh * 0.16 + bh * 0.05; c.strokeStyle = `rgba(${i % 2 ? '255,236,200' : '110,62,24'},${0.05 + 0.1 * R()})`; c.beginPath(); c.moveTo(x, yy); c.bezierCurveTo(x + bw * 0.3, yy + tilt * 0.3, x + bw * 0.7, yy + tilt * 0.8, x + bw, yy + tilt); c.stroke(); } }
  c.strokeStyle = o.vein || 'rgba(90,70,50,.3)'; c.lineWidth = Math.max(0.5, 0.8 * u);
  for (let i = 0; i < (o.veins ?? 4); i++) { let px = x + R() * bw, py = y + (R() < 0.5 ? 0 : bh), a = Math.atan2(y + bh / 2 - py, x + bw / 2 - px) + (R() - 0.5); c.beginPath(); c.moveTo(px, py); for (let j = 0; j < 22; j++) { a += (R() - 0.5) * 0.7; px += Math.cos(a) * bh * 0.035; py += Math.sin(a) * bh * 0.035; c.lineTo(px, py); } c.stroke(); }
  if (o.dendrites) { c.strokeStyle = 'rgba(40,28,20,.55)'; c.lineWidth = Math.max(0.5, 0.7 * u); c.beginPath();
    for (let i = 0; i < o.dendrites; i++) { const j = R() * pts.length | 0, p = pts[j]; dendrite(c, R, p[0], p[1], Math.atan2(y + bh / 2 - p[1], x + bw / 2 - p[0]) + (R() - 0.5), bh * (0.03 + 0.04 * R()), 5); } c.stroke(); }
  grain(c, x, y, bw, bh, 0.5, u * 0.8);
  c.restore();
  c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = Math.max(0.8, 1.2 * u); polyPath(c, pts, -0.6 * u, -0.8 * u); c.stroke();
  c.strokeStyle = 'rgba(0,0,0,.3)'; polyPath(c, pts); c.stroke();
}
// a paper specimen card; lines = [[text, opts]]; returns nothing. (x, y) is the top-left corner
function card(ctx, x, y, cw, lines, px, alpha = 1, tone = '#f1ead8') {
  if (alpha <= 0.02) return;
  const pad = px * 0.9, lh = px * 1.38, ch = pad * 1.7 + lines.reduce((s, l) => s + lh * (l[1]?.k || 1), 0);
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x + px * 0.25, y + px * 0.35, cw, ch);
  ctx.fillStyle = tone; ctx.fillRect(x, y, cw, ch);
  ctx.strokeStyle = 'rgba(60,40,20,.35)'; ctx.lineWidth = Math.max(0.5, px * 0.06); ctx.strokeRect(x + px * 0.3, y + px * 0.3, cw - px * 0.6, ch - px * 0.6);
  let yy = y + pad * 0.9;
  for (const [s, o = {}] of lines) { const k = o.k || 1; yy += lh * k; text(ctx, s, x + pad, yy - lh * k * 0.25, px * k, o.col || '#2c241a', { font: SERIF, ...o }); }
  ctx.restore();
}
// wrap a sentence to a width (in characters), for cards
function wrap(s, n) { const out = []; let line = ''; for (const wd of s.split(' ')) { if ((line + ' ' + wd).length > n && line) { out.push(line); line = wd; } else line = line ? line + ' ' + wd : wd; } if (line) out.push(line); return out; }

// ================================================================ 1. rock layers
const COLUMN = [['herrerasaurus', 0.22], ['plateosaurus', 0.62], ['dilophosaurus', 0.36], ['shunosaurus', 0.74], ['allosaurus', 0.2], ['stegosaurus', 0.52],
  ['iguanodon', 0.8], ['deinonychus', 0.33], ['spinosaurus', 0.6], ['velociraptor', 0.14], ['parasaurolophus', 0.4], ['triceratops', 0.64], ['tyrannosaurus', 0.88], ['presbyornis', 0.45]];
// [older, younger, colour]: a schematic column, red beds below, chalk high in the Cretaceous
const BEDS = [[237, 228, '#9a4a36'], [228, 219, '#b35d41'], [219, 210, '#8e4433'], [210, 201.4, '#a9573e'],
  [201.4, 190, '#b99a6b'], [190, 174, '#8b8c79'], [174, 163.5, '#a59c83'], [163.5, 152, '#c4a46c'], [152, 145, '#98a08a'],
  [145, 125, '#c7b68d'], [125, 113, '#b3a078'], [113, 100.5, '#d3ccb4'], [100.5, 84, '#e4e0d0'], [84, 72, '#cbbd96'], [72, 66, '#b39d72'],
  [66, 61.6, '#8b745a'], [61.6, 50, '#9f8868']];
const PERIODS = [['Triassic', 252, 201.4, '#8e4a9e'], ['Jurassic', 201.4, 145, '#34a6c0'], ['Cretaceous', 145, 66, '#7fbf4e'], ['Paleogene', 66, 23, '#f09a52']];

function strata(f, st) {
  const { ctx, w, h, p } = f, E = f.era, ma = E.ma, d = daylight(p.light), u = h / 540;
  const z = 1 + 1.6 * (1 - smooth(0, 0.5, p.x3)), ppm = 0.6 * h / 181 * z;
  const ys = lerp(0.87 * h - (237 - ma) * 0.6 * h / 181, 0.36 * h, smooth(1, 1.5, z)), amp = h * 0.012, NX = 32;
  const wob = (x, m) => (noise2(x / w * 5 + m * 0.07, m * 0.13) - 0.5) * 2 * amp;
  const yOf = (m, x) => ys + (m - ma) * ppm + wob(x, m);
  const L = p.light * (1 - 0.8 * E.dark), top = ys + amp * 2;
  // sky, the fireball, far hills
  skyGradient(ctx, w, top, L);
  if (E.dark > 0) { ctx.fillStyle = `rgba(38,26,20,${E.dark * 0.75})`; ctx.fillRect(0, 0, w, top); }
  if (E.meteor > 0) { const m = E.meteor / 1.25, mx = lerp(0.05, 0.86, m) * w, my = lerp(-0.05, 0.9, m) * ys, g = ctx.createLinearGradient(mx, my, mx - w * 0.3, my - ys * 0.34);
    g.addColorStop(0, 'rgba(255,246,214,.95)'); g.addColorStop(0.3, 'rgba(255,170,70,.55)'); g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.strokeStyle = g; ctx.lineCap = 'round'; ctx.lineWidth = h * 0.012; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx - w * 0.3, my - ys * 0.34); ctx.stroke();
    ctx.fillStyle = 'rgba(255,250,230,.95)'; ctx.beginPath(); ctx.arc(mx, my, h * 0.012, 0, TAU); ctx.fill(); }
  ctx.fillStyle = mixC('#6f7f8f', '#b9c7d2', L, 0.55 * (1 - E.dark * 0.6)); ctx.beginPath(); ctx.moveTo(0, top);
  for (let i = 0; i <= NX; i++) { const x = i / NX * w; ctx.lineTo(x, ys - h * (0.03 + 0.09 * noise2(i * 0.22 + 4, 1.7)) * Math.min(1, ys / (h * 0.3))); }
  ctx.lineTo(w, top); ctx.fill();
  // plants of the moment (no flowers before the Cretaceous: flora() knows)
  const FW = flora(E), kinds = Object.keys(FW).filter(k => PLANTS[k] && FW[k] > 0.02), tot = kinds.reduce((s, k) => s + FW[k], 0), pal = plantPalette(L, E, 0.3);
  for (let i = 0; i < 9; i++) {
    let r = hash(i, 31) * tot, kind = kinds[0]; for (const k of kinds) { r -= FW[k]; if (r <= 0) { kind = k; break; } }
    const x = (i + 0.2 + 0.6 * hash(i, 5)) / 9 * w, tall = PLANTS[kind].h > 3, px = h * (tall ? 0.09 + 0.1 * hash(i, 8) : 0.03 + 0.03 * hash(i, 8)) * Math.min(1, ys / (h * 0.3));
    dp(ctx, memo(st, 'pl' + kind + i, () => plantParts(kind, i * 7 + 3, 0)), { x, y: yOf(ma, x) + 2, k: px / PLANTS[kind].h, dir: 1 }, { pal });
  }
  // who walks on top: the animal about to be buried next (or whoever filled its place at this moment)
  let next = null; for (const [id] of COLUMN) { const s = species(id), bm = Math.max(s.ma[1], 59); if (bm <= ma + 0.5 && (!next || bm > Math.max(next.ma[1], 59))) next = s; }
  const live = standIn(next || 'presbyornis', ma);
  if (live && ys > h * 0.12) {
    const bird = live.plan === 'bird', alpha = bird ? 1 : E.dinos, sz = size(live), k = Math.min(0.2 * w / live.len, Math.min(0.17 * h, ys * 0.6) / sz.tall), G = gait(live, 0), v = G.vWalk * energy(f);
    if (alpha > 0.02) for (let i = 0; i < 2; i++) {
      const sc = i ? 0.72 : 1, span = w + live.len * k * 1.6, x = ((f.t * v * k + i * span * 0.46 + hash(live.len, 2) * span) % span) - live.len * k * 0.6, y = yOf(ma, x) + 1;
      const q = pose(live, { phase: f.t * v / G.stride / sc + i * 0.37, t: f.t + i * 3, scale: sc, headTo: 0.1 * Math.sin(f.t * 0.4 + i) });
      ctx.globalAlpha = alpha; ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(x + live.len * k * 0.08, y, live.len * k * 0.3 * sc, h * 0.006, 0, 0, TAU); ctx.fill();
      dp(ctx, parts(q), { x, y, k, dir: 1 }, { pal: palette(live, { light: L }) }); ctx.globalAlpha = 1;
      if (!i && p.x4 > 0.05) text(ctx, live.name, clamp(x, w * 0.14, w * 0.9), y - Math.min(sz.tall * k, ys * 0.62) - 6 * u, 12 * u, `rgba(255,255,255,${p.x4 * 1.6 * alpha})`, { align: 'center', halo: `rgba(20,24,30,${0.6 * alpha})`, italic: true });
    }
  }
  // the column, youngest bed first, each filled down to the bottom of the frame
  const edge = m => { const o = []; for (let i = 0; i <= NX; i++) { const x = i / NX * w; o.push([x, yOf(m, x)]); } return o; };
  const fillDown = (pts, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, h + 2); for (const q of pts) ctx.lineTo(q[0], q[1]); ctx.lineTo(w, h + 2); ctx.fill(); };
  const surf = edge(ma);
  for (let i = BEDS.length - 1; i >= 0; i--) { const [m0, m1, col] = BEDS[i]; if (m0 > ma) fillDown(m1 <= ma ? surf : edge(m1), col); }
  fillDown(edge(237), '#57525c');
  ctx.save(); ctx.beginPath(); ctx.moveTo(0, h); for (const q of surf) ctx.lineTo(q[0], q[1]); ctx.lineTo(w, h); ctx.clip();
  ctx.lineWidth = Math.max(0.6, u);
  for (let m = 236, i = 0; m > ma; m -= 2.4, i++) { ctx.strokeStyle = i % 2 ? 'rgba(0,0,0,.075)' : 'rgba(255,255,255,.07)'; ctx.beginPath(); for (let j = 0; j <= NX; j++) { const x = j / NX * w, y = yOf(m, x) + amp * 0.5 * Math.sin(j * 0.9 + m); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
  for (let i = 0; i < 26; i++) { const x = hash(i, 71) * w, y = yOf(239 + hash(i, 72) * 30, x); ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.beginPath(); ctx.moveTo(x - 4 * u, y); ctx.lineTo(x + 4 * u, y); ctx.moveTo(x, y - 4 * u); ctx.lineTo(x, y + 4 * u); ctx.stroke(); }
  grain(ctx, 0, ys - amp, w, h - ys + amp, 0.5, u);
  const sh = ctx.createLinearGradient(0, ys, 0, h); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(10,6,14,.3)'); ctx.fillStyle = sh; ctx.fillRect(0, ys - amp, w, h);
  // soil, or ash and ferns after the impact
  ctx.strokeStyle = E.dark > 0.3 ? 'rgba(40,36,34,.9)' : mixC('#4c3a26', '#3f5a2c', clamp(1 - E.dry + E.ferns), 0.9); ctx.lineWidth = h * 0.012; ctx.beginPath(); surf.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.stroke();
  // the impact layer
  if (ma <= 66.04) { ctx.strokeStyle = '#1d1a19'; ctx.lineWidth = Math.max(1.5, h * 0.0055); ctx.beginPath(); for (let j = 0; j <= NX; j++) { const x = j / NX * w, y = yOf(66, x); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
    ctx.strokeStyle = 'rgba(190,200,210,.5)'; ctx.lineWidth = Math.max(0.5, h * 0.0012); ctx.setLineDash([h * 0.004, h * 0.01]); ctx.stroke(); ctx.setLineDash([]); }
  // the buried
  const show = lerp(0.6, 1, p.x1), zs = Math.pow(z, 0.6), lab = [];
  for (let i = 0; i < COLUMN.length; i++) {
    const sp = species(COLUMN[i][0]), bm = Math.max(sp.ma[1], 59), a = clamp((bm + 0.05 - ma) / 1.2) * show;
    if (a <= 0.01) continue;
    const c = memo(st, 'col' + sp.id, () => { const ps = scatter(bones(corpse(sp, { seed: i + 2, arch: 0.7 + 0.5 * hash(i, 3) })), sp.len, i + 11, 0.7, 0.12), rot = (hash(i, 9) - 0.5) * 0.5 + (i % 3 === 0 ? PI : 0); return { ps, rot, dir: hash(i, 4) < 0.5 ? -1 : 1 }; });
    const cx = (0.16 + 0.8 * COLUMN[i][1]) * w, t = clamp(Math.log(sp.len / 0.9) / Math.log(33)), P = place(c.ps, cx, 0, w * lerp(0.085, 0.19, t) * zs, h * lerp(0.06, 0.115, t) * zs, c.rot, c.dir);
    const yt = ys + (bm - ma) * ppm + amp + 3 * u; P.y += yt + P.hh;
    if (yt > h) continue;
    ctx.globalAlpha = a * 0.5; drawAt(ctx, c.ps, P, flat('rgba(255,244,220,.5)'), 0, 1.2 * u);
    ctx.globalAlpha = a; drawAt(ctx, c.ps, P, boneLook('#35271f', '#54423a', '#8a7460'));
    ctx.globalAlpha = 1; lab.push([sp, cx, yt + P.hh * 2 + 11 * u, a / show]);
  }
  ctx.restore();
  if (d.night > 0.01) { ctx.fillStyle = `rgba(8,10,28,${0.55 * d.night})`; ctx.fillRect(0, 0, w, h); }
  if (E.flash > 0.01) { ctx.fillStyle = `rgba(255,236,190,${E.flash * 0.6})`; ctx.fillRect(0, 0, w, h); }
  // labels: names, the time scale, the clay
  const la = clamp(p.x4 * 2);
  if (la > 0.03) {
    for (const [sp, x, y, a] of lab) { text(ctx, sp.name, x, y, 10.5 * u * Math.sqrt(zs), `rgba(255,250,236,${a * la})`, { align: 'center', halo: `rgba(30,20,16,${0.55 * a * la})`, italic: true });
      text(ctx, `${sp.ma[0]}–${sp.ma[1]} Ma`, x, y + 11 * u * Math.sqrt(zs), 8.5 * u * Math.sqrt(zs), `rgba(255,250,236,${0.8 * a * la})`, { align: 'center', halo: `rgba(30,20,16,${0.5 * a * la})` }); }
    const bx = w * 0.012, bw = w * 0.034;
    for (const [name, m0, m1, col] of PERIODS) {
      if (m0 <= ma) continue;
      const y0 = Math.max(ys + (Math.max(m1, ma) - ma) * ppm, 0), y1 = Math.min(h, ys + (Math.min(m0, 237) - ma) * ppm);
      if (y1 <= y0) continue;
      ctx.globalAlpha = la * 0.92; ctx.fillStyle = col; ctx.fillRect(bx, y0, bw, y1 - y0); ctx.globalAlpha = 1;
      ctx.strokeStyle = `rgba(20,20,24,${0.6 * la})`; ctx.lineWidth = Math.max(0.6, u); ctx.strokeRect(bx, y0, bw, y1 - y0);
      if (y1 - y0 > 46 * u) { ctx.save(); ctx.translate(bx + bw / 2, (y0 + y1) / 2); ctx.rotate(-PI / 2); text(ctx, name, 0, 0, 12 * u, `rgba(18,18,22,${la})`, { align: 'center', base: 'middle', bold: true }); ctx.restore(); }
      else if (y1 - y0 > 9 * u) text(ctx, name, bx + bw + 5 * u, (y0 + y1) / 2, 10.5 * u, `rgba(255,255,255,${la})`, { base: 'middle', halo: 'rgba(20,20,24,.6)', bold: true });
      if (m1 > ma && m1 !== 66) text(ctx, `${Math.round(m1)} Ma`, bx + bw + 5 * u, y0, 9.5 * u, `rgba(255,255,255,${la})`, { base: 'middle', halo: 'rgba(20,20,24,.6)' });
    }
    text(ctx, ma < 66.05 && ma > 65.99 ? '66 Ma' : `${Math.round(ma)} Ma`, bx, ys - 9 * u, 11 * u, `rgba(255,255,255,${la})`, { halo: 'rgba(20,20,24,.6)', bold: true });
    if (ma <= 66.04) { const y = ys + (66 - ma) * ppm; text(ctx, '66 Ma: a thin clay rich in iridium, the dust of the asteroid', w * 0.985, y - 5 * u, 10.5 * u, `rgba(255,255,255,${la})`, { align: 'right', halo: 'rgba(20,16,14,.7)' }); }
    text(ctx, E.name, w * 0.985, 20 * u, 14 * u, `rgba(255,255,255,${la})`, { align: 'right', halo: 'rgba(20,24,30,.5)', bold: true });
    text(ctx, 'Deeper is older: each animal lies in the layer of its own time', w * 0.985, 35 * u, 10 * u, `rgba(255,255,255,${0.9 * la})`, { align: 'right', halo: 'rgba(20,24,30,.5)' });
  }
}

// ================================================================ 2. dig site
function brushTool(ctx, x, y, a, s) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-s * 0.16 + s * 0.06, -s * 1.5 + s * 0.08, s * 0.32, s * 1.5);
  ctx.fillStyle = '#7b4a25'; ctx.beginPath(); ctx.roundRect(-s * 0.11, -s * 1.55, s * 0.22, s * 1.0, s * 0.1); ctx.fill();
  ctx.fillStyle = '#b9bcc0'; ctx.fillRect(-s * 0.17, -s * 0.62, s * 0.34, s * 0.24);
  ctx.fillStyle = '#d9c08a'; ctx.beginPath(); ctx.moveTo(-s * 0.17, -s * 0.38); ctx.lineTo(s * 0.17, -s * 0.38); ctx.lineTo(s * 0.26, 0); ctx.lineTo(-s * 0.26, 0); ctx.fill();
  ctx.strokeStyle = 'rgba(90,60,20,.4)'; ctx.lineWidth = s * 0.02; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * s * 0.06, -s * 0.36); ctx.lineTo(i * s * 0.09, -s * 0.02); ctx.stroke(); }
  ctx.restore();
}
function trowel(ctx, x, y, a, s) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.moveTo(s * 0.06, s * 0.08); ctx.lineTo(s * 0.36, s * 0.6); ctx.lineTo(s * 0.06, s * 1.3); ctx.lineTo(-s * 0.24, s * 0.6); ctx.fill();
  ctx.fillStyle = '#aeb3b8'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s * 0.3, s * 0.5); ctx.lineTo(0, s * 1.25); ctx.lineTo(-s * 0.3, s * 0.5); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s * 0.3, s * 0.5); ctx.lineTo(0, s * 1.25); ctx.fill();
  ctx.fillStyle = '#6b6f73'; ctx.fillRect(-s * 0.04, -s * 0.3, s * 0.08, s * 0.32);
  ctx.fillStyle = '#8a4f24'; ctx.beginPath(); ctx.roundRect(-s * 0.1, -s * 1.0, s * 0.2, s * 0.75, s * 0.09); ctx.fill();
  ctx.restore();
}
function dig(f, st) {
  const { ctx, w, h, p } = f, sp = pick(f, f.opts.sp || 'tyrannosaurus'), u = h / 540;
  const cols = 8, rows = 5, g = Math.min(w * 0.8 / cols, h * 0.78 / rows), gw = cols * g, gh = rows * g, gx = (w - gw) / 2, gy = (h - gh) / 2 - h * 0.012, FS = 6, FW = cols * FS, FH = rows * FS, N = cols * rows;
  if (st.sp !== sp.id) { st.sp = sp.id; st.brush = new Float32Array(FW * FH); st.mask = buffer(FW, FH); st.img = st.mask.ctx.createImageData(FW, FH); st.lastU = 0; }
  if (!st.scr || st.scr.canvas.width !== w || st.scr.canvas.height !== h) st.scr = buffer(w, h);
  const C = memo(st, 'dig' + sp.id, () => { const q = corpse(sp, { seed: 3, arch: 1 }); return { q, ps: scatter(bones(q), sp.len, 5, 0.55, 0.05) }; });
  const P = place(C.ps, w / 2, gy + gh / 2, gw * 0.92, gh * 0.84, -0.05, 1);
  // the order the squares are opened in: outward from the skull
  const ord = memo(st, 'ord' + sp.id + '|' + w + '|' + h, () => {
    const hs = toScreen(P, C.q.head.x + Math.cos(C.q.head.a) * C.q.head.len * 0.5, C.q.head.y + Math.sin(C.q.head.a) * C.q.head.len * 0.5), list = [];
    for (let i = 0; i < N; i++) { const cx = gx + (i % cols + 0.5) * g, cy = gy + ((i / cols | 0) + 0.5) * g; list.push([i, Math.hypot(cx - hs[0], cy - hs[1]) / g + hash(i, 17) * 1.3]); }
    list.sort((a, b) => a[1] - b[1]); const rank = new Float32Array(N); list.forEach((e, r) => rank[e[0]] = r); return { rank, seq: list.map(e => e[0]) };
  });
  const T = 80, uu = fract(f.t / T), anim = uu < 0.8 ? lerp(0.14, 1, uu / 0.8) : uu < 0.95 ? 1 : lerp(1, 0.14, (uu - 0.95) / 0.05), prog = clamp(anim + (p.x1 - 0.5) * 2);
  if (uu < st.lastU) st.brush.fill(0); st.lastU = uu;
  const ptr = f.pointer, bx = (ptr.x * w - gx) / g * FS, by = (ptr.y * h - gy) / g * FS, brushing = ptr.down && bx > -3 && by > -3 && bx < FW + 3 && by < FH + 3;
  if (brushing) for (let y = Math.max(0, by - 4 | 0); y < Math.min(FH, by + 5); y++) for (let x = Math.max(0, bx - 4 | 0); x < Math.min(FW, bx + 5); x++) { const dd = Math.hypot(x + 0.5 - bx, y + 0.5 - by); if (dd < 4) st.brush[y * FW + x] = Math.min(1, st.brush[y * FW + x] + 0.14 * (1 - dd / 4)); }
  const data = st.img.data;
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    const sq = (y / FS | 0) * cols + (x / FS | 0), r = clamp(prog * (N + 1.5) - ord.rank[sq]), a = (x % FS + 0.5) / FS, b = (y % FS + 0.5) / FS;
    const rev = Math.max(clamp(r * 1.75 - (a * 0.45 + b * 0.25) - 0.25 * hash(x, y)) * 4, st.brush[y * FW + x] * 1.6);
    data[(y * FW + x) * 4 + 3] = 255 * smooth(0, 1, 1 - rev);
  }
  st.mask.ctx.putImageData(st.img, 0, 0);
  // floor
  ctx.drawImage(buf(st, 'floor', w, h, (c) => {
    const R = rng(9124); c.fillStyle = '#8f7650'; c.fillRect(0, 0, w, h);
    blotches(c, R, 0, 0, w, h, 70, ['70,52,30', '170,140,96', '120,96,60'], h * 0.04, h * 0.22, 0.3);
    for (let i = 0; i < 260; i++) { const x = R() * w, y = R() * h, r = (1 + R() * R() * 7) * u; c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(x + r * 0.3, y + r * 0.4, r, r * 0.8, 0, 0, TAU); c.fill(); { const v = R(); c.fillStyle = `rgb(${120 + v * 60 | 0},${102 + v * 50 | 0},${74 + v * 44 | 0})`; } c.beginPath(); c.ellipse(x, y, r, r * 0.8, R() * 3, 0, TAU); c.fill(); }
    // the pit: a clean, lower floor
    const m = g * 0.16, px = gx - m, py = gy - m, pw = gw + 2 * m, ph = gh + 2 * m;
    c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(px - 3 * u, py - 3 * u, pw + 6 * u, ph + 6 * u);
    const gr = c.createLinearGradient(px, py, px + pw, py + ph); gr.addColorStop(0, '#cbb083'); gr.addColorStop(1, '#bda070'); c.fillStyle = gr; c.fillRect(px, py, pw, ph);
    c.save(); c.beginPath(); c.rect(px, py, pw, ph); c.clip();
    blotches(c, R, px, py, pw, ph, 50, ['236,214,170', '150,118,74', '176,150,110'], h * 0.03, h * 0.16, 0.22);
    c.strokeStyle = 'rgba(110,84,50,.16)'; c.lineWidth = Math.max(0.5, u); for (let i = 0; i < 40; i++) { const x = px + R() * pw, y = py + R() * ph, l = (10 + R() * 40) * u, a = -0.5 + R() * 0.4; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); }
    const s1 = c.createLinearGradient(0, py, 0, py + h * 0.05); s1.addColorStop(0, 'rgba(30,18,6,.5)'); s1.addColorStop(1, 'rgba(30,18,6,0)'); c.fillStyle = s1; c.fillRect(px, py, pw, h * 0.05);
    const s2 = c.createLinearGradient(px, 0, px + h * 0.04, 0); s2.addColorStop(0, 'rgba(30,18,6,.4)'); s2.addColorStop(1, 'rgba(30,18,6,0)'); c.fillStyle = s2; c.fillRect(px, py, h * 0.04, ph);
    c.restore(); grain(c, 0, 0, w, h, 0.55, u);
  }), 0, 0);
  // the skeleton, then what still covers it
  const depth = lerp(0.4, 1.6, p.x3);
  drawAt(ctx, C.ps, P, flat('rgba(40,22,8,.42)'), 2 * u * depth, 3 * u * depth);
  drawAt(ctx, C.ps, P, boneLook('#8f6e4a', '#5e452e', '#c2a678', 'rgba(34,20,8,.85)', Math.max(0.5, 0.7 * u)));
  drawAt(ctx, C.ps.filter(q => q.t === 'bone' && q.p), P, { fill: () => null, stroke: 'rgba(214,180,130,.3)', lw: Math.max(0.4, 0.5 * u), pupil: false }, -0.7 * u, -0.9 * u);
  const sc = st.scr.ctx; sc.globalCompositeOperation = 'source-over'; sc.clearRect(0, 0, w, h);
  sc.drawImage(buf(st, 'over', w, h, (c) => {
    const R = rng(4411); c.fillStyle = '#a58a5e'; c.fillRect(0, 0, w, h);
    blotches(c, R, 0, 0, w, h, 90, ['86,64,38', '196,168,120', '128,100,62'], h * 0.02, h * 0.14, 0.35);
    for (let i = 0; i < 500; i++) { const x = gx + R() * gw, y = gy + R() * gh, r = (0.8 + R() * R() * 5) * u; c.fillStyle = 'rgba(40,24,8,.3)'; c.beginPath(); c.arc(x + r * 0.4, y + r * 0.5, r, 0, TAU); c.fill(); { const v = R(); c.fillStyle = `rgb(${150 + v * 60 | 0},${126 + v * 52 | 0},${88 + v * 44 | 0})`; } c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
    grain(c, 0, 0, w, h, 0.7, u * 0.8);
  }), 0, 0);
  sc.globalCompositeOperation = 'destination-in'; sc.imageSmoothingEnabled = true; sc.drawImage(st.mask.canvas, gx, gy, gw, gh); sc.globalCompositeOperation = 'source-over';
  ctx.save(); ctx.shadowColor = 'rgba(30,16,4,.7)'; ctx.shadowOffsetX = 2.5 * u * depth; ctx.shadowOffsetY = 4 * u * depth; ctx.shadowBlur = 5 * u; ctx.drawImage(st.scr.canvas, 0, 0); ctx.restore();
  // string grid, pegs, square names
  const la = clamp(p.x4 * 2);
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? 'rgba(248,244,228,.92)' : 'rgba(30,18,6,.4)'; ctx.lineWidth = Math.max(0.8, 1.3 * u); ctx.beginPath();
    const o = pass ? 0 : 2.2 * u;
    for (let i = 0; i <= cols; i++) { const x = gx + i * g; ctx.moveTo(x + o, gy - g * 0.2 + o); ctx.quadraticCurveTo(x + o + 2 * u * Math.sin(i * 2.1), gy + gh / 2 + o, x + o, gy + gh + g * 0.2 + o); }
    for (let j = 0; j <= rows; j++) { const y = gy + j * g; ctx.moveTo(gx - g * 0.2 + o, y + o); ctx.quadraticCurveTo(gx + gw / 2 + o, y + o + 2 * u * Math.sin(j * 1.7), gx + gw + g * 0.2 + o, y + o); }
    ctx.stroke();
  }
  for (let i = 0; i <= cols; i++) for (const y of [gy - g * 0.2, gy + gh + g * 0.2]) { ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.arc(gx + i * g + u, y + 1.5 * u, 3 * u, 0, TAU); ctx.fill(); ctx.fillStyle = '#d8d3c6'; ctx.beginPath(); ctx.arc(gx + i * g, y, 2.6 * u, 0, TAU); ctx.fill(); }
  for (let j = 0; j <= rows; j++) for (const x of [gx - g * 0.2, gx + gw + g * 0.2]) { ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.arc(x + u, gy + j * g + 1.5 * u, 3 * u, 0, TAU); ctx.fill(); ctx.fillStyle = '#d8d3c6'; ctx.beginPath(); ctx.arc(x, gy + j * g, 2.6 * u, 0, TAU); ctx.fill(); }
  // the brush at the working edge (or under the pointer), and its dust
  const at = Math.min(N - 1, Math.floor(prog * (N + 1.5))), sq = ord.seq[at], r = clamp(prog * (N + 1.5) - at), working = prog < 0.995 && prog > 0.005;
  let wx = gx + (sq % cols + clamp(r * 1.3)) * g, wy = gy + ((sq / cols | 0) + 0.3 + 0.4 * r) * g;
  if (brushing) { wx = ptr.x * w; wy = ptr.y * h; }
  if (working || brushing) {
    const sw = Math.sin(f.t * 9) * g * 0.07, wd = windX(p.wind), dust = puff('226,204,160', 64);
    for (let i = 0; i < 16; i++) { const life = fract(f.t * 0.55 + i / 16), s = g * (0.15 + 0.5 * life) * (0.6 + p.x2); ctx.globalAlpha = (1 - life) * 0.5 * clamp(p.x2 * 1.6);
      ctx.drawImage(dust, wx + sw + wd * life * g * 1.1 + (hash(i, 3) - 0.5) * g * 0.3 - s / 2, wy - life * g * 0.5 + (hash(i, 4) - 0.5) * g * 0.3 - s / 2, s, s); }
    ctx.globalAlpha = 1; brushTool(ctx, wx + sw, wy, 0.5 + Math.sin(f.t * 9) * 0.12, g * 0.42);
  }
  trowel(ctx, gx - g * 0.72, gy + gh * 0.3, 0.5, g * 0.42);
  brushTool(ctx, gx + gw + g * 0.75, gy + gh * 0.72, -0.4, g * 0.36);
  { const x = gx + gw + g * 0.72, y = gy + gh * 0.22, rr = g * 0.36; ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.arc(x + 3 * u, y + 5 * u, rr, 0, TAU); ctx.fill(); ctx.fillStyle = '#5d6f7c'; ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fill();
    ctx.fillStyle = '#a58a5e'; ctx.beginPath(); ctx.arc(x, y, rr * 0.84, 0, TAU); ctx.fill(); ctx.fillStyle = 'rgba(60,40,16,.35)'; ctx.beginPath(); ctx.arc(x - rr * 0.2, y - rr * 0.2, rr * 0.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#c9ccd0'; ctx.lineWidth = 1.6 * u; ctx.beginPath(); ctx.arc(x, y, rr * 1.02, 0.4, 2.2); ctx.stroke(); }
  lighting(f, gx + gw * 0.42, gy + gh * 0.45, w * 0.62);
  if (la > 0.03) {
    for (let i = 0; i < cols; i++) text(ctx, String.fromCharCode(65 + i), gx + (i + 0.5) * g, gy - g * 0.26, 10 * u, `rgba(255,252,240,${la})`, { align: 'center', halo: 'rgba(30,20,8,.5)', bold: true });
    for (let j = 0; j < rows; j++) text(ctx, String(j + 1), gx - g * 0.3, gy + (j + 0.5) * g, 10 * u, `rgba(255,252,240,${la})`, { align: 'right', base: 'middle', halo: 'rgba(30,20,8,.5)', bold: true });
    const nice = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10].find(v => v * P.k > w * 0.06) || 10, bl = nice * P.k, by2 = gy + gh + g * 0.52, bx2 = gx;
    ctx.fillStyle = `rgba(20,14,8,${la})`; ctx.fillRect(bx2 - u, by2 - u, bl + 2 * u, 6 * u); ctx.fillStyle = `rgba(250,246,232,${la})`; ctx.fillRect(bx2, by2, bl / 2, 4 * u);
    text(ctx, nice < 1 ? `${Math.round(nice * 100)} cm` : `${nice} m`, bx2 + bl + 7 * u, by2 + 5 * u, 10.5 * u, `rgba(255,252,240,${la})`, { halo: 'rgba(30,20,8,.6)' });
    text(ctx, `${sp.name}  ·  ${sp.where}  ·  ${maSpan(sp)}`, gx + gw, by2 + 5 * u, 11 * u, `rgba(255,252,240,${la})`, { align: 'right', halo: 'rgba(30,20,8,.6)', bold: true });
    text(ctx, 'Square by square: every bone is mapped before it is lifted', gx + gw, gy - g * 0.26, 10 * u, `rgba(255,252,240,${la * 0.9})`, { align: 'right', halo: 'rgba(30,20,8,.5)' });
  }
}

// ================================================================ 3. from death to discovery
const SILT = ['#b79e72', '#a38a62', '#c6b086', '#99876a', '#b3a482', '#8f8468', '#c2b393', '#a39678'];
const STEPS = [['Death', 'An animal dies beside a river.'], ['Burial', 'A flood buries the body in silt before scavengers can scatter it.'],
  ['Turning to stone', 'Layers pile up. Minerals from groundwater fill the bones and turn them to stone.'],
  ['Uplift and erosion', 'Millions of years later the land is pushed up, and wind and rain wear it away.'],
  ['Discovery', 'A few bones show at the surface. Someone has to find them before they crumble.']];
function taph(f, st) {
  const { ctx, w, h, p } = f, sp = pick(f, f.opts.sp || 'edmontosaurus'), E = f.era, u = h / 540, L = p.light;
  const uu = fract(f.t / 76);
  const lie = smooth(0.075, 0.115, uu), dead = smooth(0.12, 0.2, uu), flood = smooth(0.2, 0.25, uu) * (1 - smooth(0.3, 0.37, uu)), bury = smooth(0.235, 0.6, uu);
  const stone = smooth(0.34, 0.6, uu), up = smooth(0.6, 0.8, uu), found = smooth(0.82, 0.9, uu), out = smooth(0.975, 1, uu) + (1 - smooth(0, 0.012, uu));
  const step = uu < 0.2 ? 0 : uu < 0.37 ? 1 : uu < 0.6 ? 2 : uu < 0.82 ? 3 : 4;
  const gs = 0.47 * h, Dmax = lerp(0.2, 0.34, p.x3) * h, D = Dmax * bury, U = 0.13 * h * up, th = -0.2 * up, cx = 0.44 * w, k = 0.36 * w / sp.len;
  const comp = lerp(1, 0.62, smooth(0.25, 0.5, uu));
  // the animal: walks in, lies down, dies; then only its bones
  const G = gait(sp, 0), walkT = clamp(uu / 0.085), sx = lerp(-0.55 * w, 0, smooth(0, 1, walkT) * 0.5 + walkT * 0.5);
  const q = pose(sp, { phase: sx / k / G.stride, crouch: lie, headTo: lerp(0, -0.3, lie) + dead * 0.6, jaw: dead * 0.45, t: uu < 0.12 ? f.t : 3 });
  if (dead > 0) deathPose(q, dead * 0.9, dead * 0.5);
  const B = dead > 0 ? bones(q) : null, e = extent(B || [{ c: [0, sp.len * 0.15, sp.len * 0.15] }]), bodyTop = -e.y0 * k * comp, bcx = cx + (e.x0 + e.x1) / 2 * k;
  const yS = gs + Dmax - 0.13 * h;      // where the skeleton ends up on screen
  const chan = x => smooth(0.66 * w, 0.82 * w, x) * 0.085 * h * (1 - smooth(0.24, 0.42, uu));
  const hill = x => clamp(yS - bodyTop - 0.035 * h + (x - cx) / w * 0.46 * h + (noise2(x / w * 7, 3.3) - 0.5) * 0.035 * h + found * bodyTop * 0.95 * Math.exp(-Math.pow((x - bcx) / (0.17 * w), 2)), 0.16 * h, 0.9 * h);
  const prof = x => lerp(gs + chan(x), hill(x), up);
  const NX = 48, line = []; for (let i = 0; i <= NX; i++) { const x = i / NX * w; line.push([x, prof(x)]); }
  // sky and far country
  skyGradient(ctx, w, h * 0.95, L * (1 - 0.6 * E.dark));
  ctx.fillStyle = mixC('#5f6f7c', '#a9b9c2', L, 0.5); ctx.beginPath(); ctx.moveTo(0, h); for (let i = 0; i <= NX; i++) ctx.lineTo(i / NX * w, gs - h * (0.02 + 0.1 * noise2(i * 0.3 + 2 + up * 0.6, 5.1)) + up * h * 0.1); ctx.lineTo(w, h); ctx.fill();
  // plants on the bank, while there is a bank
  const pa = (1 - smooth(0.2, 0.27, uu)), pal = plantPalette(L, E, 0.15), FWt = flora(E);
  if (pa > 0.01) { ctx.globalAlpha = pa; const kinds = ['treefern', 'conifer', 'cycad', 'fern', 'horsetail', 'ginkgo', 'fern', 'bush', 'horsetail'].map(kd => (FWt[kd] ?? 1) > 0.15 ? kd : 'fern');
    kinds.forEach((kd, i) => { const x = (0.03 + 0.07 * i + (i > 4 ? 0.2 : 0)) * w * (i > 6 ? 1.08 : 1), tall = PLANTS[kd].h > 3; dp(ctx, memo(st, 'tp' + kd + i, () => plantParts(kd, i * 5 + 2, 0)), { x, y: prof(x) + 2, k: h * (tall ? 0.2 + 0.06 * (i % 3) : 0.06) / PLANTS[kd].h, dir: 1 }, { pal }); });
    ctx.globalAlpha = 1; }
  // the ground: flat beds in their own frame, tilted by the uplift, cut by the land surface
  ctx.save(); ctx.beginPath(); ctx.moveTo(0, h + 2); for (const v of line) ctx.lineTo(v[0], v[1]); ctx.lineTo(w, h + 2); ctx.clip();
  ctx.fillStyle = '#a89a7c'; ctx.fillRect(0, 0, w, h);
  ctx.save(); ctx.translate(cx, gs + D - U); ctx.rotate(th);
  ctx.fillStyle = '#7d6a55'; ctx.fillRect(-2 * w, 0, 4 * w, 2 * h);
  for (let i = 0; i < 14; i++) { ctx.fillStyle = i % 2 ? 'rgba(0,0,0,.09)' : 'rgba(255,240,210,.07)'; ctx.fillRect(-2 * w, (0.03 + i * 0.055 + 0.02 * hash(i, 2)) * h, 4 * w, h * (0.012 + 0.02 * hash(i, 4))); }
  const NLy = SILT.length;
  for (let i = 0; i < NLy; i++) { const b0 = Dmax * i / NLy, t1 = Math.min(D, Dmax * (i + 1) / NLy); if (t1 <= b0) break;
    ctx.fillStyle = SILT[i]; ctx.fillRect(-2 * w, -t1, 4 * w, t1 - b0 + 0.6);
    ctx.fillStyle = 'rgba(60,40,20,.14)'; ctx.fillRect(-2 * w, -b0 - 1.2 * u, 4 * w, 1.2 * u); ctx.fillStyle = 'rgba(255,245,220,.1)'; ctx.fillRect(-2 * w, -lerp(b0, t1, 0.5), 4 * w, u); }
  ctx.restore();
  grain(ctx, 0, 0, w, h, 0.45, u);
  ctx.restore();
  // the skeleton in the rock (drawn over the cut so the weathering-out bones show)
  if (B) {
    const bc = mixC('#efe6cf', '#3f2d22', stone), bf = mixC('#b8ad94', '#5b473a', stone), xr = lerp(0.75, 1, p.x1);
    ctx.save(); ctx.translate(cx, gs + D - U); ctx.rotate(th); ctx.scale(1, comp);
    ctx.globalAlpha = dead * (bury > 0.05 ? lerp(1, xr, smooth(0.05, 0.3, bury)) : 1);
    dp(ctx, B, { x: 0, y: 0, k, dir: 1 }, boneLook(bc, bf, mixC('#2a2018', '#a08a68', stone), 'rgba(30,20,12,.5)', Math.max(0.4, 0.6 * u)));
    ctx.restore(); ctx.globalAlpha = 1;
  }
  if (dead < 1) { ctx.globalAlpha = 1 - dead; ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(cx + sx + sp.len * k * 0.06, gs + 1, sp.len * k * 0.3, h * 0.008, 0, 0, TAU); ctx.fill();
    dp(ctx, parts(q), { x: cx + sx, y: gs, k, dir: 1 }, { pal: palette(sp, { light: L }) }); ctx.globalAlpha = 1; }
  // river and flood
  const wa = 1 - smooth(0.3, 0.4, uu);
  if (wa > 0.01) { const yw = gs + 0.03 * h - flood * 0.17 * h; ctx.fillStyle = mixC('#5f8fa3', '#86775a', clamp(flood * 1.5), (0.6 + 0.18 * flood) * wa); ctx.beginPath(); let open = false;
    for (let i = 0; i <= NX; i++) { const x = i / NX * w, yy = yw + Math.sin(x / w * 40 + f.t * 2) * 1.5 * u * (1 + flood * 2); if (i) ctx.lineTo(x, yy); else ctx.moveTo(x, yy); }
    for (let i = NX; i >= 0; i--) ctx.lineTo(line[i][0], Math.max(line[i][1], yw)); ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${0.35 * wa})`; ctx.lineWidth = u; ctx.beginPath(); for (let i = 0; i <= NX; i++) { const x = i / NX * w, yy = yw + Math.sin(x / w * 40 + f.t * 2) * 1.5 * u * (1 + flood * 2); if (line[i][1] > yy) { open ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); open = true; } else open = false; } ctx.stroke(); }
  // the land surface: soil, later scrub; and the finder
  ctx.strokeStyle = mixC('#4a3b25', '#6b5a3c', up, 1); ctx.lineWidth = h * 0.009; ctx.lineJoin = 'round'; ctx.beginPath(); line.forEach((v, i) => i ? ctx.lineTo(v[0], v[1]) : ctx.moveTo(v[0], v[1])); ctx.stroke();
  if (up > 0.3) { ctx.globalAlpha = smooth(0.3, 0.8, up); const pl2 = plantPalette(L, null, 0.1);
    for (let i = 0; i < 7; i++) { const x = (0.04 + 0.15 * i + 0.05 * hash(i, 6)) * w; if (Math.abs(x - bcx) < 0.2 * w) continue; dp(ctx, memo(st, 'sb' + i, () => plantParts('bush', i * 3 + 1, 0)), { x, y: prof(x) + 2, k: h * 0.035 / PLANTS.bush.h, dir: 1 }, { pal: pl2 }); }
    ctx.globalAlpha = 1; }
  if (p.x2 > 0.02 && up > 0.05 && up < 1) { const dust = puff('214,196,160', 64), wd = windX(p.wind); for (let i = 0; i < 18; i++) { const life = fract(f.t * 0.2 + i / 18), x = ((hash(i, 2) + wd * life * 0.3 + 1) % 1) * w, s = h * 0.12 * (0.5 + life); ctx.globalAlpha = Math.sin(PI * life) * 0.35 * p.x2 * Math.sin(PI * up); ctx.drawImage(dust, x - s / 2, prof(x) - s * 0.6, s, s); } ctx.globalAlpha = 1; }
  if (found > 0.02) { const m = 1.7 * k, x = bcx + Math.max(0.17 * w, e.w * k * 0.62), y = prof(x); ctx.globalAlpha = found; ctx.fillStyle = '#2c2a2e'; ctx.strokeStyle = '#2c2a2e'; ctx.lineCap = 'round';
    ctx.lineWidth = m * 0.11; ctx.beginPath(); ctx.moveTo(x - m * 0.07, y); ctx.lineTo(x - m * 0.02, y - m * 0.48); ctx.lineTo(x + m * 0.1, y); ctx.stroke();
    ctx.lineWidth = m * 0.17; ctx.beginPath(); ctx.moveTo(x - m * 0.02, y - m * 0.48); ctx.lineTo(x - m * 0.08, y - m * 0.8); ctx.stroke();
    ctx.lineWidth = m * 0.07; ctx.beginPath(); ctx.moveTo(x - m * 0.08, y - m * 0.76); ctx.lineTo(x - m * 0.26, y - m * 0.56); ctx.lineTo(x - m * 0.4, y - m * 0.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(x - m * 0.12, y - m * 0.92, m * 0.085, 0, TAU); ctx.fill(); ctx.fillRect(x - m * 0.29, y - m * 0.985, m * 0.34, m * 0.035); ctx.fillRect(x - m * 0.2, y - m * 1.05, m * 0.16, m * 0.08); ctx.globalAlpha = 1; }
  if (f.p.light < 0.25) { ctx.fillStyle = `rgba(8,10,28,${0.5 * daylight(L).night})`; ctx.fillRect(0, 0, w, h); }
  if (out > 0.01) { ctx.fillStyle = mixC('#b79e72', '#cfc4a8', 0.5, out); ctx.fillRect(0, 0, w, h); }
  // the story so far
  const la = clamp(p.x4 * 2);
  if (la > 0.03) {
    ctx.fillStyle = `rgba(22,18,14,${0.62 * la})`; ctx.fillRect(0, h * 0.885, w, h * 0.115);
    STEPS.forEach((s, i) => { const x = w * (0.1 + 0.2 * i), on = i === step; ctx.fillStyle = on ? `rgba(255,214,130,${la})` : `rgba(255,255,255,${(i < step ? 0.6 : 0.28) * la})`; ctx.beginPath(); ctx.arc(x - w * 0.075, h * 0.957, (on ? 4.5 : 3) * u, 0, TAU); ctx.fill();
      text(ctx, `${i + 1}  ${s[0]}`, x - w * 0.062, h * 0.957, 10.5 * u, ctx.fillStyle, { base: 'middle', bold: on }); });
    text(ctx, STEPS[step][1], w * 0.025, h * 0.918, 12.5 * u, `rgba(255,250,236,${la})`, { base: 'middle' });
    text(ctx, `${sp.name}  ·  ${maSpan(sp)}`, w * 0.975, h * 0.918, 10.5 * u, `rgba(255,250,236,${0.8 * la})`, { base: 'middle', align: 'right', italic: true });
    if (step === 2) text(ctx, 'millions of years', w * 0.975, h * 0.06, 12 * u, `rgba(255,255,255,${la * Math.sin(PI * smooth(0.37, 0.6, uu))})`, { align: 'right', halo: 'rgba(20,24,30,.4)', italic: true });
  }
}

// ================================================================ 4. the Berlin slab
function feather(base, a, len, wid, bend) {
  const p = [], r = [], c = Math.cos(a), s = Math.sin(a), n = 7, at = t => [base[0] + c * len * t - s * bend * len * t * t, base[1] + s * len * t + c * bend * len * t * t];
  for (let i = 0; i <= n; i++) { const t = i / n, m = at(t), hw = wid * Math.pow(Math.sin(PI * Math.pow(t, 0.75)), 0.8) + wid * 0.08; p.push([m[0] - s * hw, m[1] + c * hw]); r.push([m[0] + s * hw, m[1] - c * hw]); }
  return { p: p.concat(r.reverse()), l: [at(0), at(0.33), at(0.66), at(1)], a, len, wid };
}
function berlinFossil(sp) {
  const q = pose(sp, { crouch: 0.12, phase: 0.22, jaw: 0.12, t: 2 }), L = q.L;
  deathPose(q, 1.15, 0.12);
  // legs trail back, wings open on either side of the body, as on the slab
  for (const g of q.legs) { const a = g.near ? -0.95 : -0.55, o = g.pts[0], c = Math.cos(a), s = Math.sin(a), R = v => [o[0] + (v[0] - o[0]) * c - (v[1] - o[1]) * s, o[1] + (v[0] - o[0]) * s + (v[1] - o[1]) * c]; g.pts = g.pts.map(R); g.tip = R(g.tip); }
  const wings = [[q.arms[1], [2.25, 0.95, 0.35], 1], [q.arms[0], [-2.5, -1.05, -0.5], -1]], fe = [];
  for (const [g, angs, side] of wings) {
    if (!g) continue;
    setLimb(g, angs, 1.7);
    const [, El, Wr, Hd] = g.pts, a1 = Math.atan2(Wr[1] - El[1], Wr[0] - El[0]), a2 = Math.atan2(Hd[1] - Wr[1], Hd[0] - Wr[0]), n = 15;
    for (let j = 0; j < n; j++) { const t = j / (n - 1), b = t < 0.5 ? [lerp(El[0], Wr[0], t * 2), lerp(El[1], Wr[1], t * 2)] : [lerp(Wr[0], Hd[0], t * 2 - 1), lerp(Wr[1], Hd[1], t * 2 - 1)];
      fe.push(feather(b, lerp(a1 + side * 1.85, a2 + side * 0.3, Math.pow(t, 1.15)), L * (0.2 + 0.2 * Math.sin(PI * (0.12 + 0.8 * t))), L * 0.021, -side * 0.12)); }
  }
  const n = q.nodes;
  for (let i = q.iHip - 2; i >= 0; i--) { const A = n[i + 1], Bn = n[i], a = Math.atan2(Bn.y - A.y, Bn.x - A.x), t = 1 - i / (q.iHip - 2);
    for (const sd of [-1, 1]) fe.push(feather([Bn.x, Bn.y], a + sd * (0.5 - 0.2 * t), L * (0.1 + 0.05 * Math.sin(PI * t)), L * 0.016, -sd * 0.1)); }
  fe.push(feather([n[0].x, n[0].y], Math.atan2(n[0].y - n[1].y, n[0].x - n[1].x), L * 0.13, L * 0.017, 0));
  for (const g of q.legs) { const [, K, A] = g.pts, a = Math.atan2(A[1] - K[1], A[0] - K[0]); for (let j = 0; j < 4; j++) fe.push(feather([lerp(K[0], A[0], j / 4), lerp(K[1], A[1], j / 4)], a - 0.9, L * 0.06, L * 0.01, 0.1)); }
  return { q, B: bones(q), fe, body: parts(q).filter(x => x.k === 'body') };
}
function imprint(ctx, fe, T, fill, stroke, lw, barbs) {
  ctx.lineWidth = lw; ctx.lineCap = 'round';
  ctx.fillStyle = fill; ctx.beginPath(); for (const q of fe) trace(ctx, { p: q.p, s: 1 }, T); ctx.fill();
  ctx.strokeStyle = stroke; ctx.beginPath(); for (const q of fe) { trace(ctx, { p: q.p, s: 1 }, T); trace(ctx, { l: q.l }, T); } ctx.stroke();
  if (barbs) { ctx.lineWidth = lw * 0.6; ctx.beginPath();
    for (const q of fe) { const [a, , , b] = q.l, c = Math.cos(q.a), s = Math.sin(q.a); for (let i = 1; i < 9; i++) { const t = i / 9, x = lerp(a[0], b[0], t), y = lerp(a[1], b[1], t), hw = q.wid * Math.sin(PI * Math.pow(t, 0.75)) * 0.9;
      for (const sd of [-1, 1]) trace(ctx, { l: [[x, y], [x + c * hw * 0.8 - sd * s * hw, y + s * hw * 0.8 + sd * c * hw]] }, T); } }
    ctx.stroke(); }
}
function berlin(f, st) {
  const { ctx, w, h, p } = f, sp = species('archaeopteryx'), u = h / 540, box = [w * 0.07, h * 0.05, w * 0.86, h * 0.9];
  ctx.drawImage(buf(st, 'berlin', w, h, c => paintSlab(c, w, h, { box, seed: 5, top: '#eadfc6', low: '#d6c8a6', side: '#8f8468', bg: ['#262321', '#161413'], stains: ['196,150,84', '236,226,200', '170,150,110', '214,180,120'], veins: 5, vein: 'rgba(120,84,40,.35)', dendrites: 14 })), 0, 0);
  const F = memo(st, 'berlin', () => berlinFossil(sp)), all = F.B.concat(F.fe.map(q => ({ p: q.p })));
  const P = place(all, w * 0.43, h * 0.48, w * 0.7, h * 0.8, -0.62, 1), T = { x: 0, y: 0, k: P.k, dir: 1 }, show = lerp(0.3, 1, p.x1), depth = lerp(0.3, 1.7, p.x3);
  // raking light: its direction drifts slowly, and follows Light
  const la0 = -2.2 + 0.5 * Math.sin(f.t * 0.12) + p.light, lx = Math.cos(la0), ly = Math.sin(la0);
  ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(P.rot);
  ctx.globalAlpha = 0.13 * show; dp(ctx, F.body, T, flat('#7a5a34'));
  ctx.globalAlpha = show;
  imprint(ctx, F.fe, T, 'rgba(126,92,52,.2)', 'rgba(96,66,34,.55)', Math.max(0.5, 0.8 * u), p.detail > 0.3);
  ctx.restore();
  ctx.globalAlpha = 0.4 * show; drawAt(ctx, F.B, P, flat('#3a2816'), -lx * 2.2 * u * depth, -ly * 2.2 * u * depth);
  ctx.globalAlpha = 0.5 * show; drawAt(ctx, F.B, P, flat('#fff6dc'), lx * 1.1 * u * depth, ly * 1.1 * u * depth);
  ctx.globalAlpha = show; drawAt(ctx, F.B, P, boneLook('#7a5433', '#94704a', '#d9caa6', 'rgba(50,30,14,.6)', Math.max(0.4, 0.6 * u)));
  ctx.globalAlpha = 1;
  // a soft pool of light that wanders over the stone, and dust in it
  const gx = w * (0.5 + 0.28 * Math.sin(f.t * 0.1)), gy = h * (0.45 + 0.2 * Math.cos(f.t * 0.13)), g = ctx.createRadialGradient(gx, gy, 0, gx, gy, w * 0.5);
  g.addColorStop(0, 'rgba(255,244,214,.16)'); g.addColorStop(1, 'rgba(255,244,214,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  motes(f, p.x2);
  lighting(f, gx, gy, w * 0.7);
  const la = clamp(p.x4 * 2);
  card(ctx, w * 0.655, h * 0.735, w * 0.325, [[sp.name, { k: 1.35, italic: true, bold: true }], [`“${sp.means}”  ·  Solnhofen limestone`, {}], [`${sp.where}  ·  ${maSpan(sp)}`, {}],
    ['The Berlin specimen, found in the 1870s:', { col: '#5a4a36' }], ['feathered wings, a long bony tail, clawed', { col: '#5a4a36' }], ['fingers and teeth in one animal.', { col: '#5a4a36' }]], 9.6 * u, la);
}
function motes(f, amt) {
  if (amt < 0.02) return;
  const { ctx, w, h } = f, wd = windX(f.p.wind);
  for (let i = 0; i < 40 * amt; i++) { const x = fract(hash(i, 1) + f.t * 0.006 * wd * (0.5 + hash(i, 2))) * w, y = fract(hash(i, 3) + f.t * 0.004 * (hash(i, 4) - 0.3)) * h, a = 0.5 + 0.5 * Math.sin(f.t * 0.7 + i * 2.1);
    ctx.fillStyle = `rgba(255,246,220,${0.3 * a * amt})`; ctx.beginPath(); ctx.arc(x, y, (0.7 + hash(i, 5) * 1.3) * h / 540, 0, TAU); ctx.fill(); }
}

// ================================================================ 5. the fighting dinosaurs
function fighters(w, h) {
  const k = 0.2 * w;
  const qP = pose('protoceratops', { crouch: 0.8, headTo: -0.25, jaw: 0.75, phase: 0.3, t: 1 }); deathPose(qP, 0, 0.35);
  const PP = { x: w * 0.67, y: h * 0.5, k, dir: -1, rot: 0.12 };
  const qV = pose('velociraptor', { crouch: 0.35, headTo: 0.2, jaw: 0.5, phase: 0.2, t: 4 }); deathPose(qV, 0.45, -0.9);
  const PV = { x: w * 0.425, y: h * 0.45, k, dir: -1, rot: PI - 0.55 };
  // targets on the Protoceratops, in the Velociraptor's own frame
  const hd = qP.head, hp = (lx, ly) => { const c = Math.cos(hd.a), s = Math.sin(hd.a); return toLocal(PV, ...toScreen(PP, hd.x + lx * hd.len * c - ly * hd.len * s, hd.y + lx * hd.len * s + ly * hd.len * c)); };
  const beak = hp(0.8, -0.06), throat = hp(-0.05, -0.3), face = hp(0.45, 0.3), belly = toLocal(PV, ...toScreen(PP, qP.nodes[qP.iSh].x - 0.1, qP.nodes[qP.iSh].y - 0.2));
  const near = qV.arms.find(g => g.near), far = qV.arms.find(g => !g.near), ln = qV.legs.find(g => g.near), lf = qV.legs.find(g => !g.near);
  if (near) reach(near, beak, -1); if (far) reach(far, face, -1);
  reach(ln, throat, 1); reach(lf, belly, 1);
  return { qP, PP, qV, PV, BP: bones(qP), BV: bones(qV) };
}
function fighting(f, st) {
  const { ctx, w, h, p } = f, u = h / 540, box = [w * 0.07, h * 0.08, w * 0.86, h * 0.8], vr = species('velociraptor'), pr = species('protoceratops');
  ctx.drawImage(buf(st, 'fight', w, h, c => paintSlab(c, w, h, { box, seed: 12, rough: 1.6, top: '#d6a66c', low: '#b98450', side: '#7c5732', bg: ['#1f1c1b', '#0f0e0e'], stains: ['236,196,136', '150,96,50', '196,140,84'], veins: 3, vein: 'rgba(110,64,26,.35)', beds: 1 })), 0, 0);
  const F = memo(st, 'fight|' + w + '|' + h, () => fighters(w, h)), show = lerp(0.3, 1, p.x1), depth = lerp(0.3, 1.7, p.x3);
  const la0 = -2.3 + 0.4 * Math.sin(f.t * 0.11) + p.light * 0.8, lx = Math.cos(la0), ly = Math.sin(la0);
  for (const [B, P, c1, c2] of [[F.BP, F.PP, '#efe2c4', '#b9a37c'], [F.BV, F.PV, '#f6ecd2', '#c4ae86']]) {
    ctx.globalAlpha = 0.5 * show; drawAt(ctx, B, P, flat('#4a2a10'), -lx * 3 * u * depth, -ly * 3 * u * depth);
    ctx.globalAlpha = show; drawAt(ctx, B, P, boneLook(c1, c2, '#8a5c34', 'rgba(70,40,16,.7)', Math.max(0.5, 0.75 * u)));
  }
  ctx.globalAlpha = 1;
  // loose sand still lying in the hollows
  if (p.x2 > 0.02) { const R = rng(31); ctx.fillStyle = `rgba(226,180,120,${0.5 * p.x2})`; for (let i = 0; i < 260; i++) { const x = box[0] + (0.1 + 0.8 * R()) * box[2], y = box[1] + (0.12 + 0.76 * R()) * box[3]; ctx.fillRect(x, y, (1 + R() * 1.6) * u, (1 + R()) * u); } }
  const gx = w * (0.48 + 0.25 * Math.sin(f.t * 0.09)), gy = h * (0.45 + 0.15 * Math.cos(f.t * 0.12)), g = ctx.createRadialGradient(gx, gy, 0, gx, gy, w * 0.5);
  g.addColorStop(0, 'rgba(255,236,200,.15)'); g.addColorStop(1, 'rgba(255,236,200,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  motes(f, p.x2 * 0.7);
  lighting(f, gx, gy, w * 0.7);
  const la = clamp(p.x4 * 2);
  card(ctx, w * 0.605, h * 0.715, w * 0.335, [['The Fighting Dinosaurs', { k: 1.3, bold: true }], [`${vr.name} and ${pr.name}`, { italic: true }], [`Gobi Desert, Mongolia  ·  found in 1971`, {}], [`${maSpan(vr)}`, {}],
    ['Buried by sand in mid-fight: a foot claw at', { col: '#5a4a36' }], ['the throat, an arm caught in the beak.', { col: '#5a4a36' }]], 9.6 * u, la);
  if (la > 0.03) { const a = toScreen(F.PV, F.qV.head.x + 0.1, F.qV.head.y + 0.3), b = toScreen(F.PP, F.qP.nodes[F.qP.iHip].x, F.qP.nodes[F.qP.iHip].y + 0.45);
    text(ctx, vr.name, a[0], a[1], 10.5 * u, `rgba(60,34,14,${la})`, { italic: true, align: 'center' }); text(ctx, pr.name, b[0], b[1] - 16 * u, 10.5 * u, `rgba(60,34,14,${la})`, { italic: true, align: 'center' }); }
}

// ================================================================ 6. trackway
function printPath(ctx, type, s) {      // toes point along +x; s = foot length in pixels
  if (type === 'three' || type === 'blunt') {
    const wd = type === 'three' ? 0.14 : 0.19, ln = type === 'three' ? [0.78, 1, 0.78] : [0.6, 0.78, 0.6];
    [-0.44, 0, 0.44].forEach((a, i) => { const c = Math.cos(a), sn = Math.sin(a), l = ln[i] * s, hw = wd * s, bx = s * 0.12 * c, by = s * 0.12 * sn;
      ctx.moveTo(bx - sn * hw, by + c * hw); ctx.quadraticCurveTo(bx + c * l * 0.7 - sn * hw * 1.1, by + sn * l * 0.7 + c * hw * 1.1, bx + c * l, by + sn * l);
      ctx.quadraticCurveTo(bx + c * l * 0.7 + sn * hw * 1.1, by + sn * l * 0.7 - c * hw * 1.1, bx + sn * hw, by - c * hw); ctx.closePath(); });
    ctx.moveTo(s * 0.3, 0); ctx.ellipse(s * 0.1, 0, s * 0.2, s * 0.2, 0, 0, TAU);
  } else if (type === 'round') {
    ctx.moveTo(s * 0.5, 0); ctx.ellipse(0, 0, s * 0.5, s * 0.42, 0, 0, TAU);
    for (const a of [-0.55, 0, 0.55]) { ctx.moveTo(Math.cos(a) * s * 0.62, Math.sin(a) * s * 0.5); ctx.arc(Math.cos(a) * s * 0.5, Math.sin(a) * s * 0.4, s * 0.12, 0, TAU); }
  } else {                               // crescent: the front foot of a four-legged walker
    ctx.moveTo(s * 0.1, -s * 0.5); ctx.quadraticCurveTo(s * 0.62, 0, s * 0.1, s * 0.5); ctx.quadraticCurveTo(s * 0.3, 0, s * 0.1, -s * 0.5); ctx.closePath();
  }
}
function tracks(f, st) {
  const { ctx, w, h, p } = f, sp = pick(f, f.opts.sp || 'allosaurus'), u = h / 540, P = sp.P, quad = !P.biped;
  const G = gait(sp, 0), S = G.stride, k = Math.min(w * 0.62 / sp.len, w / (3.1 * S)), Np = Math.ceil(2 * (0.82 * w / k + sp.len) / S);
  const TR = memo(st, 'tr' + sp.id + Np, () => {
    const list = [], prev = [];
    for (let ph = 0; ph <= Np; ph += 0.02) { const q = pose(sp, { phase: ph }), X = (ph - Np / 2) * S;
      q.legs.forEach((g, i) => { if (g.stance && prev[i] === false) list.push({ x: X + g.pts[3][0], z: g.z * 1.5, front: g.front, ph, i }); prev[i] = g.stance; }); }
    const hR = P.legR[3] * G.H, fl = Math.max(P.foot * G.H, hR * 2.4) * 1.8;
    return { list, fl, type: P.toes === 'pad' ? 'round' : P.toes === 'hoof' && quad ? 'blunt' : 'three' };
  });
  const uu = fract(f.t / 60), walk = clamp(uu / 0.3), dry = smooth(0.3, 0.6, uu), stone = smooth(0.66, 0.8, uu), out = smooth(0.97, 1, uu) + (1 - smooth(0, 0.012, uu));
  const ph = walk * Np, ang = -0.2, ox = w * 0.5, oy = h * 0.5;
  // the ground: wet mud → pale dry mud → stone
  const base = stone > 0 ? mixC('#bfa67e', '#a9a295', stone) : mixC('#5a4533', '#bfa67e', dry);
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.5 + 0.3 * dry; ctx.drawImage(buf(st, 'mud', w, h, c => { const R = rng(808); blotches(c, R, 0, 0, w, h, 90, ['40,26,14', '255,236,200', '110,84,56'], h * 0.04, h * 0.3, 0.2); grain(c, 0, 0, w, h, 0.5, u); }), 0, 0);
  ctx.globalAlpha = (1 - dry) * 0.3; ctx.drawImage(buf(st, 'wet', w, h, c => { const R = rng(515); blotches(c, R, 0, 0, w, h, 16, ['150,176,196', '190,206,216'], h * 0.2, h * 0.6, 0.4); }), 0, 0);
  ctx.globalAlpha = 1;
  if (stone > 0) grain(ctx, 0, 0, w, h, 0.5 * stone, u * 0.7);
  // mud cracks: a honeycomb that opens as the mud shrinks
  if (dry > 0.02) {
    const rh = h * 0.115, q3 = Math.sqrt(3), V = (vx, vy) => { const ix = Math.round(vx / (rh * 0.5)), iy = Math.round(vy / (rh * q3 / 2)); return [vx + (hash(ix, iy, 1) - 0.5) * rh * 0.55, vy + (hash(ix, iy, 2) - 0.5) * rh * 0.55]; };
    const dark = mixC('#2e2116', '#7f786c', stone, 0.85), lite = `rgba(255,244,220,${0.25 * (1 - stone * 0.5)})`;
    for (let c = -1; c * 1.5 * rh < w + rh; c++) for (let r = -1; r * q3 * rh < h + rh; r++) {
      const cx = c * 1.5 * rh, cy = (r + (c & 1) / 2) * q3 * rh;
      for (let i = 0; i < 3; i++) { const t = hash(c * 3 + i, r, 9), op = clamp((dry * 1.5 - t * 0.9) * 2.2); if (op <= 0) continue;
        const a = V(cx + rh * Math.cos(i * PI / 3), cy + rh * Math.sin(i * PI / 3)), b = V(cx + rh * Math.cos((i + 1) * PI / 3), cy + rh * Math.sin((i + 1) * PI / 3));
        const mx = (a[0] + b[0]) / 2 + (hash(c + i, r, 4) - 0.5) * rh * 0.22, my = (a[1] + b[1]) / 2 + (hash(c + i, r, 5) - 0.5) * rh * 0.22, lw = (0.8 + 3.2 * op * (0.4 + 0.6 * hash(c, r + i, 6))) * u * (1 - 0.45 * stone);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = lite; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(a[0] + lw * 0.6, a[1] + lw * 0.7); ctx.lineTo(mx + lw * 0.6, my + lw * 0.7); ctx.lineTo(b[0] + lw * 0.6, b[1] + lw * 0.7); ctx.stroke();
        ctx.strokeStyle = dark; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(mx, my); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    }
  }
  // prints
  ctx.save(); ctx.translate(ox, oy); ctx.rotate(ang);
  const depth = lerp(0.4, 1.5, p.x3), fs = TR.fl * k, o = Math.max(1, fs * 0.07) * depth;
  for (const pr of TR.list) {
    if (pr.ph > ph) continue;
    const fresh = clamp((ph - pr.ph) * 6), type = pr.front && quad ? 'crescent' : TR.type, s = fs * (pr.front && quad ? 0.75 : 1);
    ctx.save(); ctx.translate(pr.x * k, -pr.z * k); ctx.rotate((pr.z > 0 ? -1 : 1) * (quad ? 0.2 : 0.09)); ctx.globalAlpha = fresh;
    ctx.fillStyle = `rgba(255,244,222,${0.3 + 0.1 * dry})`; ctx.beginPath(); ctx.translate(o, o); printPath(ctx, type, s * 1.06); ctx.fill();
    ctx.fillStyle = stone > 0 ? mixC('#5a4838', '#6e6a62', stone, 0.75) : mixC('#2c1f14', '#5a4838', dry, 0.8); ctx.beginPath(); ctx.translate(-o, -o); printPath(ctx, type, s); ctx.fill();
    ctx.fillStyle = `rgba(0,0,0,${0.22 * depth})`; ctx.save(); ctx.beginPath(); printPath(ctx, type, s); ctx.clip(); ctx.beginPath(); ctx.translate(-o * 1.4, -o * 1.4); printPath(ctx, type, s); ctx.rect(-s * 3, -s * 3, s * 6, s * 6); ctx.fill('evenodd'); ctx.restore();
    if (dry < 1) { ctx.fillStyle = `rgba(120,146,160,${0.38 * (1 - dry)})`; ctx.beginPath(); printPath(ctx, type, s * 0.8); ctx.fill(); }
    ctx.restore();
  }
  // the track-maker, from above
  if (walk < 1) {
    const q = pose(sp, { phase: ph, t: f.t }), X = (ph - Np / 2) * S * k, tp = topParts(q);
    ctx.globalAlpha = 0.3; dp(ctx, tp.filter(x => x.k === 'body' || x.k === 'skull'), { x: X + 0.02 * w, y: 0.03 * w, k, dir: 1 }, flat('#1a1008'));
    ctx.globalAlpha = 1; dp(ctx, tp, { x: X, y: 0, k, dir: 1 }, { pal: palette(sp, { light: lerp(0.5, 1, p.light) }) });
  }
  ctx.restore();
  if (p.x2 > 0.02 && dry > 0.05) { const dust = puff('230,214,180', 64), wd = windX(p.wind); for (let i = 0; i < 14; i++) { const life = fract(f.t * 0.12 + i / 14), x = fract(hash(i, 2) + wd * life * 0.4) * w, s = h * 0.3 * (0.5 + life); ctx.globalAlpha = Math.sin(PI * life) * 0.22 * p.x2 * dry * (1 - stone); ctx.drawImage(dust, x - s / 2, hash(i, 7) * h - s / 2, s, s); } ctx.globalAlpha = 1; }
  lighting(f, w * 0.5, h * 0.5, w * 0.7);
  if (out > 0.01) { ctx.fillStyle = `rgba(90,69,51,${out})`; ctx.fillRect(0, 0, w, h); }
  const la = clamp(p.x4 * 2);
  if (la > 0.03) {
    const names = ['Wet mud', 'The mud dries and cracks', 'Buried, and turned to stone'], si = stone > 0.5 ? 2 : dry > 0.15 ? 1 : 0;
    text(ctx, names[si], w * 0.025, h * 0.065, 14 * u, `rgba(255,252,240,${la})`, { halo: 'rgba(30,20,10,.55)', bold: true });
    names.forEach((n, i) => { ctx.fillStyle = i === si ? `rgba(255,214,130,${la})` : `rgba(255,255,255,${0.4 * la})`; ctx.beginPath(); ctx.arc(w * 0.03 + i * 12 * u, h * 0.095, 3.2 * u, 0, TAU); ctx.fill(); });
    card(ctx, w * 0.64, h * 0.78, w * 0.335, [['Trackway', { k: 1.3, bold: true }], [`made here by ${sp.name}`, { italic: true }], ['Tracks show how an animal moved: its', { col: '#5a4a36' }], ['stride, its speed, whether it walked alone.', { col: '#5a4a36' }], ['They can rarely be matched to one species.', { col: '#5a4a36' }]], 9.6 * u, la * stone);
  }
}

// ================================================================ 7. amber
function ant(ctx, x, y, s, rot) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = 'rgba(34,14,4,.9)'; ctx.strokeStyle = 'rgba(34,14,4,.85)'; ctx.lineWidth = s * 0.07; ctx.lineCap = 'round';
  for (const [ex, rx, ry] of [[-s * 0.62, s * 0.36, s * 0.24], [0, s * 0.26, s * 0.15], [s * 0.42, s * 0.2, s * 0.17]]) { ctx.beginPath(); ctx.ellipse(ex, 0, rx, ry, 0, 0, TAU); ctx.fill(); }
  ctx.beginPath(); for (const sd of [-1, 1]) { for (let i = -1; i <= 1; i++) { ctx.moveTo(i * s * 0.14, 0); ctx.lineTo(i * s * 0.34, sd * s * 0.36); ctx.lineTo(i * s * 0.52 - s * 0.1, sd * s * 0.7); }
    ctx.moveTo(s * 0.55, sd * s * 0.06); ctx.quadraticCurveTo(s * 0.8, sd * s * 0.4, s * 1.05, sd * s * 0.3); } ctx.stroke(); ctx.restore();
}
function amber(f, st) {
  const { ctx, w, h, p } = f, u = h / 540, cx = w * 0.5, cy = h * 0.47, Rb = h * 0.33, L = p.light, t = f.t;
  const bgL = smooth(0.45, 1, L), g0 = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.7);
  g0.addColorStop(0, mixC('#2a1708', '#e9e4d8', bgL)); g0.addColorStop(1, mixC('#070403', '#b9b4a8', bgL)); ctx.fillStyle = g0; ctx.fillRect(0, 0, w, h);
  grain(ctx, 0, 0, w, h, 0.2, u);
  const la0 = t * 0.22, lx = cx + Math.cos(la0) * Rb * 0.75, ly = cy + Math.sin(la0 * 0.8) * Rb * 0.4 - Rb * 0.1;
  const pts = []; for (let i = 0; i < 48; i++) { const a = i / 48 * TAU, r = Rb * (1 + 0.1 * Math.sin(2 * a + 1) + 0.06 * Math.sin(3 * a + 2.2) + 0.025 * Math.sin(5 * a + 0.4)); pts.push([cx + Math.cos(a) * r * 1.42, cy + Math.sin(a) * r * 0.9]); }
  const blob = () => { ctx.beginPath(); const n = pts.length; ctx.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2); for (let i = 0; i < n; i++) { const b = pts[(i + 1) % n]; ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + b[0]) / 2, (pts[i][1] + b[1]) / 2); } };
  // the glow it throws, and its shadow or light pool on the table
  const glow = 0.25 + 0.75 * (1 - bgL);
  ctx.globalCompositeOperation = bgL > 0.5 ? 'source-over' : 'lighter';
  const gg = ctx.createRadialGradient(lx, ly, Rb * 0.3, cx, cy, Rb * 2.7); gg.addColorStop(0, `rgba(255,160,40,${0.42 * glow})`); gg.addColorStop(0.5, `rgba(255,110,10,${0.14 * glow})`); gg.addColorStop(1, 'rgba(255,110,10,0)'); ctx.fillStyle = gg; ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(0,0,0,${0.3 + 0.2 * bgL})`; ctx.beginPath(); ctx.ellipse(cx + (cx - lx) * 0.12, cy + Rb * 0.98, Rb * 1.25, Rb * 0.12, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = `rgba(255,170,50,${0.3})`; ctx.beginPath(); ctx.ellipse(cx + (cx - lx) * 0.3, cy + Rb * 1.0, Rb * 0.9, Rb * 0.07, 0, 0, TAU); ctx.fill();
  // the resin
  const deep = p.x3, gr = ctx.createRadialGradient(lx, ly, 0, cx, cy, Rb * 1.75);
  gr.addColorStop(0, '#fff3b4'); gr.addColorStop(0.16, '#ffcf52'); gr.addColorStop(0.5, mixC('#f39a1c', '#d86c0c', deep)); gr.addColorStop(1, mixC('#a04d0a', '#6a2804', deep));
  blob(); ctx.fillStyle = gr; ctx.fill();
  ctx.save(); blob(); ctx.clip();
  const R = rng(2016);
  // flow lines in the resin
  for (let i = 0; i < 9; i++) { const y0 = cy + (R() - 0.5) * Rb * 1.6, b1 = (R() - 0.5) * Rb, b2 = (R() - 0.5) * Rb; ctx.strokeStyle = i % 2 ? `rgba(255,232,160,${0.1 + 0.08 * R()})` : `rgba(120,50,4,${0.1 + 0.08 * R()})`; ctx.lineWidth = Rb * (0.02 + 0.07 * R());
    ctx.beginPath(); ctx.moveTo(cx - Rb * 1.6, y0); ctx.bezierCurveTo(cx - Rb * 0.5, y0 + b1, cx + Rb * 0.5, y0 + b2, cx + Rb * 1.6, y0 + (R() - 0.5) * Rb * 0.5); ctx.stroke(); }
  // stress discs that flash as the light swings round
  for (let i = 0; i < 9; i++) { const x = cx + (R() - 0.5) * Rb * 2.3, y = cy + (R() - 0.5) * Rb * 1.4, r = Rb * (0.05 + 0.1 * R()), a = R() * PI, sh = Math.pow(Math.max(0, Math.cos(la0 * 1.5 - a * 2)), 6);
    ctx.fillStyle = `rgba(255,236,170,${0.07 + 0.4 * sh})`; ctx.strokeStyle = `rgba(255,246,200,${0.12 + 0.4 * sh})`; ctx.lineWidth = u; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.33, a, 0, TAU); ctx.fill(); ctx.stroke(); }
  // debris and bubbles
  const nb = 6 + p.x2 * 46 | 0;
  for (let i = 0; i < nb; i++) { const x = cx + (R() - 0.5) * Rb * 2.5, y = cy + (R() - 0.5) * Rb * 1.6, r = Rb * (0.006 + 0.03 * R() * R());
    if (i % 3 === 0) { ctx.fillStyle = `rgba(50,22,6,${0.35 + 0.4 * R()})`; ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r * 0.6, R() * PI, 0, TAU); ctx.fill(); }
    else { ctx.strokeStyle = 'rgba(255,240,200,.5)'; ctx.fillStyle = 'rgba(255,224,150,.14)'; ctx.lineWidth = Math.max(0.5, r * 0.25); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.stroke(); ctx.fillStyle = 'rgba(255,255,240,.75)'; ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.25, 0, TAU); ctx.fill(); } }
  // the tail: a string of small vertebrae, feathers down both sides, dark above and pale below
  const tl = Rb * 1.55, rot = -0.14, sc = Math.cos(rot), ss = Math.sin(rot);
  const at = s => { const x = (s - 0.5) * tl, y = Rb * 0.17 * Math.sin(s * 2.6 + 0.3) - Rb * 0.08; return [cx - Rb * 0.08 + x * sc - y * ss, cy + x * ss + y * sc]; };
  ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(70,28,4,.1)'; ctx.lineWidth = Rb * 0.2; ctx.beginPath(); for (let i = 0; i <= 20; i++) { const v = at(i / 20); i ? ctx.lineTo(v[0], v[1]) : ctx.moveTo(v[0], v[1]); } ctx.stroke();
  const NF = 78;
  for (const side of [1, -1]) {
    ctx.strokeStyle = side > 0 ? 'rgba(255,238,196,.62)' : 'rgba(64,28,8,.8)'; ctx.lineWidth = Math.max(0.5, Rb * 0.0045); ctx.beginPath();
    for (let i = 0; i < NF; i++) { const s = i / (NF - 1), a = at(s), b = at(Math.min(1, s + 0.02)), ta = Math.atan2(b[1] - a[1], b[0] - a[0]) || rot, an = ta + side * (0.62 + 0.25 * Math.sin(i * 1.7)), ln = Rb * (0.11 + 0.1 * Math.sin(PI * Math.pow(s, 0.7))) * (0.8 + 0.4 * hash(i, side + 3));
      const ex = a[0] + Math.cos(an) * ln, ey = a[1] + Math.sin(an) * ln; ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(a[0] + Math.cos(an - side * 0.3) * ln * 0.55, a[1] + Math.sin(an - side * 0.3) * ln * 0.55, ex, ey);
      if (i % 2 === 0) for (let j = 1; j < 4; j++) { const m = j / 4, mx = lerp(a[0], ex, m), my = lerp(a[1], ey, m); ctx.moveTo(mx, my); ctx.lineTo(mx + Math.cos(an + side * 0.6) * ln * 0.16, my + Math.sin(an + side * 0.6) * ln * 0.16); } }
    ctx.stroke();
  }
  for (let i = 0; i < 8; i++) { const a = at(0.02 + i * 0.122), b = at(0.02 + i * 0.122 + 0.1); ctx.strokeStyle = 'rgba(38,16,4,.9)'; ctx.lineWidth = Rb * lerp(0.03, 0.017, i / 7); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  ant(ctx, cx + Rb * 0.78, cy - Rb * 0.45, Rb * 0.07, 0.6); ant(ctx, cx - Rb * 0.95, cy + Rb * 0.3, Rb * 0.06, 2.4);
  // cloudiness, the dark rim, and light on the polished face
  if (p.x1 < 0.98) { ctx.fillStyle = `rgba(226,150,44,${(1 - p.x1) * 0.62})`; ctx.fillRect(cx - Rb * 2, cy - Rb * 1.2, Rb * 4, Rb * 2.4); }
  blob(); ctx.strokeStyle = 'rgba(84,30,0,.34)'; ctx.lineWidth = Rb * 0.26; ctx.stroke(); ctx.strokeStyle = 'rgba(60,20,0,.5)'; ctx.lineWidth = Rb * 0.07; ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  const hx = cx - Rb * 0.5 + Math.cos(la0) * Rb * 0.2, hy = cy - Rb * 0.5, hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, Rb * 0.7); hg.addColorStop(0, 'rgba(255,255,236,.42)'); hg.addColorStop(1, 'rgba(255,255,236,0)');
  ctx.fillStyle = hg; ctx.beginPath(); ctx.ellipse(hx, hy, Rb * 0.7, Rb * 0.22, -0.25, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,240,.35)'; ctx.lineWidth = Rb * 0.02; ctx.beginPath(); ctx.ellipse(cx, cy, Rb * 1.25, Rb * 0.74, 0, PI * 1.08 + 0.2 * Math.sin(la0), PI * 1.42 + 0.2 * Math.sin(la0)); ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
  motes(f, p.x2 * 0.5 * (1 - bgL));
  const la = clamp(p.x4 * 2), ink = bgL > 0.5 ? '40,30,20' : '255,236,200';
  if (la > 0.03) {
    text(ctx, 'A feathered dinosaur tail in amber', w * 0.5, h * 0.895, 14 * u, `rgba(${ink},${la})`, { align: 'center', font: SERIF, bold: true });
    text(ctx, 'Myanmar  ·  about 99 million years old  ·  described in 2016', w * 0.5, h * 0.932, 10.5 * u, `rgba(${ink},${0.85 * la})`, { align: 'center', font: SERIF });
    text(ctx, 'Eight small vertebrae of a young theropod, feathers chestnut above and pale below, in fossil tree resin.', w * 0.5, h * 0.965, 9.8 * u, `rgba(${ink},${0.7 * la})`, { align: 'center', font: SERIF, italic: true });
    const cm = tl / 3.7, bx = cx + Rb * 1.05, by = cy + Rb * 1.12; ctx.fillStyle = `rgba(${ink},${0.85 * la})`; ctx.fillRect(bx, by, cm, 2 * u); ctx.fillRect(bx, by - 3 * u, u, 8 * u); ctx.fillRect(bx + cm - u, by - 3 * u, u, 8 * u);
    text(ctx, '1 cm', bx + cm / 2, by - 6 * u, 9.5 * u, `rgba(${ink},${0.85 * la})`, { align: 'center', font: SERIF });
  }
}

// ================================================================ 8. museum drawer
function turn(list, ang) {      // turn parts by ang (y up), centre them on their bounding box
  const c = Math.cos(ang), s = Math.sin(ang), R = v => [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
  const ps = list.map(q => q.c ? { ...q, c: [...R(q.c), q.c[2]] } : q.p ? { ...q, p: q.p.map(R) } : { ...q, l: q.l.map(R) }), e = extent(ps), mx = (e.x0 + e.x1) / 2, my = -(e.y0 + e.y1) / 2, M = v => [v[0] - mx, v[1] - my];
  return { ps: ps.map(q => q.c ? { ...q, c: [...M(q.c), q.c[2]] } : q.p ? { ...q, p: q.p.map(M) } : { ...q, l: q.l.map(M) }), w: e.w, h: e.h };
}
function drawerLayout(sp, aspect) {
  const q = pose(sp, { phase: 0.25, t: 1, jaw: 0.25 }), B = bones(q).map(x => ({ ...x, t: x.t === 'boneFar' ? 'bone' : x.t })), L = q.L, biped = !!sp.P.biped;
  const G = { skull: [], neck: [], back: [], tail: [], ribs: [], limbs: [], toes: [], hips: [], blade: [], armour: [] };
  const head = B.filter(isHead); if (head.length) G.skull.push(turn(head, -q.head.a));
  let vi = 0, cur = null, pel = [];
  for (const b of B) {
    if (b.k === 'vert') { const s = 0.3 + 0.45 * vi++, a = Math.atan2(b.p[1][1] - b.p[0][1], b.p[1][0] - b.p[0][0]); cur = { list: [b], a, s }; (s < q.iHip - 0.5 ? G.tail : s > q.iSh + 0.5 ? G.neck : G.back).push(cur); }
    else if ((b.k === 'spine' || b.k === 'chevron') && cur) cur.list.push(b);
    else if (b.k === 'rib') G.ribs.push(turn([b], -PI / 2 - Math.atan2(b.l[2][1] - b.l[0][1], b.l[2][0] - b.l[0][0])));
    else if (b.k === 'bone' || b.k === 'scapula') { const a = [(b.p[0][0] + b.p[11][0]) / 2, (b.p[0][1] + b.p[11][1]) / 2], e = [(b.p[5][0] + b.p[6][0]) / 2, (b.p[5][1] + b.p[6][1]) / 2]; (b.k === 'bone' ? G.limbs : G.blade).push(turn([b], PI / 2 - Math.atan2(e[1] - a[1], e[0] - a[0]))); }
    else if (b.k === 'toe') G.toes.push(turn([b], PI / 2 - Math.atan2(b.l[1][1] - b.l[0][1], b.l[1][0] - b.l[0][0])));
    else if (b.k === 'pelvis') pel.push(b);
    else if (b.k === 'plate') G.armour.push(turn([b], -Math.atan2(b.p[4][1] - b.p[0][1], b.p[4][0] - b.p[0][0])));
    else if (b.k === 'spike' || b.k === 'club') G.armour.push(turn([b], 0));
  }
  if (pel.length) G.hips.push(turn(pel, 0));
  for (const k of ['neck', 'back', 'tail']) G[k] = G[k].map(v => turn(v.list, -v.a)); G.tail.reverse(); G.neck.reverse();
  G.limbs.sort((a, b) => b.h - a.h); G.toes.sort((a, b) => b.h - a.h);
  const names = { skull: 'skull and lower jaw', neck: 'neck vertebrae', back: 'back vertebrae', tail: 'tail vertebrae', ribs: 'ribs', limbs: biped ? 'arm and leg bones' : 'leg bones', toes: biped ? 'finger and toe bones' : 'toe bones', hips: 'hip bones', blade: 'shoulder blade',
    armour: sp.f.plates ? 'plates and spikes' : sp.f.club ? 'tail club' : 'armour' };
  const gap = L * 0.012, pad = L * 0.022, lab = L * 0.034;
  const build = Wm => {
    const boxes = [];
    for (const key of ['skull', 'limbs', 'hips', 'blade', 'neck', 'back', 'ribs', 'tail', 'toes', 'armour']) {
      const items = G[key]; if (!items.length) continue;
      let x = 0, y = 0, rowH = 0, bw = 0; const pos = [];
      for (const it of items) { if (x > 0 && x + it.w > Wm - 2 * pad) { x = 0; y += rowH + gap; rowH = 0; } pos.push([it, x, y]); x += it.w + gap; rowH = Math.max(rowH, it.h); bw = Math.max(bw, x - gap); }
      boxes.push({ key, name: names[key], pos, rows: y, w: Math.max(bw, L * 0.13) + 2 * pad, h: y + rowH + 2 * pad + lab });
    }
    let x = 0, y = 0, rowH = 0, W = 0;
    for (const b of boxes) { if (x > 0 && x + b.w > Wm) { x = 0; y += rowH + gap * 1.5; rowH = 0; } b.x = x; b.y = y; x += b.w + gap * 1.5; rowH = Math.max(rowH, b.h); W = Math.max(W, x - gap * 1.5); }
    return { boxes, W, H: y + rowH, pad, lab, L };
  };
  let best = null, bs = 0;
  for (let m = 0.35; m < 3.6; m *= 1.06) { const lay = build(L * m), s = Math.min(aspect / lay.W, 1 / lay.H); if (s > bs) { bs = s; best = lay; } }
  return best;
}
function drawer(f, st) {
  const { ctx, w, h, p } = f, sp = pick(f, f.opts.sp || 'tyrannosaurus'), u = h / 540, xq = Math.round(p.x1 * 20), lq = Math.round(clamp(p.x4 * 2) * 4), dq = Math.round(p.x3 * 6);
  ctx.drawImage(buf(st, `dr|${sp.id}|${xq}|${lq}|${dq}`, w, h, c => {
    const R = rng(77123), fr = h * 0.055, ix = fr, iy = fr, iw = w - 2 * fr, ih = h - 2 * fr - h * 0.085;
    // the wood
    const wg = c.createLinearGradient(0, 0, 0, h); wg.addColorStop(0, '#6a4a2f'); wg.addColorStop(1, '#4f3521'); c.fillStyle = wg; c.fillRect(0, 0, w, h);
    c.lineWidth = Math.max(0.5, u); for (let i = 0; i < 110; i++) { const y = R() * h; c.strokeStyle = `rgba(${i % 2 ? '30,16,6' : '170,120,70'},${0.06 + 0.1 * R()})`; c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(w * 0.3, y + (R() - 0.5) * 14 * u, w * 0.7, y + (R() - 0.5) * 14 * u, w, y + (R() - 0.5) * 8 * u); c.stroke(); }
    // the lining
    c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(ix - 2 * u, iy - 2 * u, iw + 4 * u, ih + 4 * u);
    c.fillStyle = '#d5d2c8'; c.fillRect(ix, iy, iw, ih); c.save(); c.beginPath(); c.rect(ix, iy, iw, ih); c.clip();
    blotches(c, R, ix, iy, iw, ih, 30, ['255,255,250', '170,166,156'], h * 0.05, h * 0.3, 0.2); grain(c, ix, iy, iw, ih, 0.45, u * 0.6);
    const s1 = c.createLinearGradient(0, iy, 0, iy + h * 0.06); s1.addColorStop(0, 'rgba(20,12,6,.5)'); s1.addColorStop(1, 'rgba(20,12,6,0)'); c.fillStyle = s1; c.fillRect(ix, iy, iw, h * 0.06);
    const s2 = c.createLinearGradient(ix, 0, ix + h * 0.04, 0); s2.addColorStop(0, 'rgba(20,12,6,.4)'); s2.addColorStop(1, 'rgba(20,12,6,0)'); c.fillStyle = s2; c.fillRect(ix, iy, h * 0.04, ih);
    // the bones, group by group
    const m = h * 0.03, lay = memo(st, 'lay' + sp.id + Math.round(w / h * 20), () => drawerLayout(sp, (iw - 2 * m) / (ih - 2 * m))), k = Math.min((iw - 2 * m) / lay.W, (ih - 2 * m) / lay.H);
    const ox = ix + (iw - lay.W * k) / 2, oy = iy + (ih - lay.H * k) / 2, la = lq / 4, depth = lerp(0.4, 1.6, dq / 6);
    let n = 0;
    for (const b of lay.boxes) {
      const bx = ox + b.x * k, by = oy + b.y * k, bw = b.w * k, bh = b.h * k;
      c.fillStyle = 'rgba(40,36,30,.16)'; c.beginPath(); c.roundRect(bx, by, bw, bh, 5 * u); c.fill();
      c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = Math.max(0.5, u); c.beginPath(); c.moveTo(bx + 4 * u, by + bh); c.lineTo(bx + bw - 4 * u, by + bh); c.stroke();
      c.strokeStyle = 'rgba(40,30,20,.3)'; c.beginPath(); c.moveTo(bx + 4 * u, by); c.lineTo(bx + bw - 4 * u, by); c.stroke();
      for (const [it, x, y] of b.pos) {
        const T = { x: bx + (lay.pad + x + it.w / 2) * k, y: by + (lay.pad + y + it.h / 2) * k, k, dir: 1 }, here = hash(n++, 41) < p.x1 * 1.25 || b.key === 'skull' && p.x1 > 0.15;
        if (!here) { c.setLineDash([2 * u, 2 * u]); dp(c, it.ps.filter(q => q.t !== 'hole'), T, { fill: (t, q) => q.l ? 'rgba(70,60,50,.3)' : null, stroke: 'rgba(70,60,50,.45)', lw: Math.max(0.5, 0.7 * u), pupil: false }); c.setLineDash([]); continue; }
        dp(c, it.ps, { ...T, x: T.x + 2 * u * depth, y: T.y + 3 * u * depth }, flat('rgba(30,24,18,.3)'));
        dp(c, it.ps, T, boneLook('#6e5740', '#6e5740', '#d5d2c8', 'rgba(36,24,14,.6)', Math.max(0.4, 0.6 * u)));
        dp(c, it.ps.filter(q => q.p && q.t === 'bone'), { ...T, x: T.x - 0.7 * u, y: T.y - 0.8 * u }, { fill: () => null, stroke: 'rgba(220,196,160,.35)', lw: Math.max(0.4, 0.5 * u), pupil: false });
      }
      if (la > 0.03) { const px = clamp(lay.lab * k * 0.5, 6.5 * u, 10.5 * u), tw = Math.min(bw - 6 * u, b.name.length * px * 0.56 + 8 * u); c.globalAlpha = la; c.fillStyle = '#f4efe0'; c.fillRect(bx + 3 * u, by + bh - px * 1.5 - 2 * u, tw, px * 1.5);
        c.save(); c.beginPath(); c.rect(bx + 3 * u, by + bh - px * 1.5 - 2 * u, tw, px * 1.5); c.clip(); text(c, b.name, bx + 6 * u, by + bh - px * 0.75 - 2 * u, px, '#3a2e22', { base: 'middle', font: SERIF }); c.restore(); c.globalAlpha = 1; }
    }
    c.restore();
    // the brass label holder on the front edge
    const hy = h - fr - h * 0.085 + h * 0.012, hh = h * 0.085 + fr - h * 0.03, hw = w * 0.56, hx = (w - hw) / 2;
    const bg = c.createLinearGradient(0, hy, 0, hy + hh); bg.addColorStop(0, '#c9a654'); bg.addColorStop(0.5, '#8f7230'); bg.addColorStop(1, '#b8974a'); c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(hx + 2 * u, hy + 3 * u, hw, hh); c.fillStyle = bg; c.fillRect(hx, hy, hw, hh);
    c.fillStyle = '#f1ead8'; c.fillRect(hx + 5 * u, hy + 5 * u, hw - 10 * u, hh - 10 * u);
    text(c, sp.name, hx + 14 * u, hy + hh * 0.42, 14 * u, '#2c241a', { font: SERIF, italic: true, bold: true, base: 'middle' });
    text(c, `“${sp.means}”`, hx + 14 * u, hy + hh * 0.72, 10 * u, '#5a4a36', { font: SERIF, base: 'middle' });
    text(c, `${sp.where}  ·  ${maSpan(sp)}`, hx + hw - 14 * u, hy + hh * 0.42, 10 * u, '#2c241a', { font: SERIF, align: 'right', base: 'middle' });
    text(c, `${sp.len} m long  ·  bones simplified, laid out by kind`, hx + hw - 14 * u, hy + hh * 0.72, 9.5 * u, '#5a4a36', { font: SERIF, align: 'right', base: 'middle' });
    for (const x of [hx - 16 * u, hx + hw + 16 * u]) { c.fillStyle = '#b8974a'; c.beginPath(); c.arc(x, hy + hh / 2, 5 * u, 0, TAU); c.fill(); c.fillStyle = 'rgba(255,240,190,.6)'; c.beginPath(); c.arc(x - u, hy + hh / 2 - u, 2 * u, 0, TAU); c.fill(); }
  }), 0, 0);
  const gx = w * (0.5 + 0.3 * Math.sin(f.t * 0.1)), gy = h * (0.42 + 0.18 * Math.cos(f.t * 0.13)), g = ctx.createRadialGradient(gx, gy, 0, gx, gy, w * 0.5);
  g.addColorStop(0, 'rgba(255,246,220,.14)'); g.addColorStop(1, 'rgba(255,246,220,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  motes(f, p.x2 * 0.6);
  lighting(f, gx, gy, w * 0.7);
}

// ================================================================ 9. CT scan
const inPoly = (pts, x, y) => { let inside = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; };
function scan(f, st) {
  const { ctx, w, h, p } = f, sp = pick(f, f.opts.sp || 'tyrannosaurus'), u = h / 540;
  const S = memo(st, 'scan' + sp.id, () => { const q = pose(sp, { jaw: 0.22, headTo: 0.1, t: 1 }); const all = bones(q); return { q, B: all.filter(isHead), rest: all.filter(x => !isHead(x)), flesh: parts(q).filter(x => x.t !== 'eye' && x.t !== 'mouth' && x.k !== 'mark') }; });
  const P = place(S.B, w * 0.44, h * 0.47, w * 0.56, h * 0.56, S.q.head.a * 0.6, 1), x0 = P.x - 0, bl = w * 0.44 - P.hw, br = w * 0.44 + P.hw;
  ctx.fillStyle = '#03060a'; ctx.fillRect(0, 0, w, h);
  const vg = ctx.createRadialGradient(w * 0.45, h * 0.47, 0, w * 0.45, h * 0.47, w * 0.6); vg.addColorStop(0, `rgba(20,46,62,${0.5 + 0.4 * p.light})`); vg.addColorStop(1, 'rgba(3,6,10,0)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(90,170,200,.09)'; ctx.lineWidth = Math.max(0.5, u); ctx.beginPath(); const gs = h / 12; for (let x = gs / 2; x < w; x += gs) { ctx.moveTo(x, 0); ctx.lineTo(x, h); } for (let y = gs / 2; y < h; y += gs) { ctx.moveTo(0, y); ctx.lineTo(w, y); } ctx.stroke();
  const tt = f.t * 0.11 + p.x3, tri = Math.abs(fract(tt) * 2 - 1), xs = lerp(bl - w * 0.03, br + w * 0.03, smooth(0, 1, tri));
  drawAt(ctx, S.flesh, P, flat('rgba(70,150,190,.07)'));
  ctx.globalCompositeOperation = 'lighter'; drawAt(ctx, S.rest, P, flat('rgba(110,160,190,.16)')); ctx.globalCompositeOperation = 'source-over';
  const holes = S.B.filter(q => q.t === 'hole'), solid = S.B.filter(q => q.t !== 'hole');
  ctx.globalCompositeOperation = 'lighter';
  drawAt(ctx, solid, P, { fill: () => 'rgba(110,160,190,.2)', pupil: false });
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, xs, h); ctx.clip();
  drawAt(ctx, solid, P, { fill: () => 'rgba(140,205,240,.4)', stroke: 'rgba(210,240,255,.7)', lw: Math.max(0.5, 0.9 * u), pupil: false });
  ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(3,8,14,.2)'; for (let y = 0; y < h; y += 3 * u) ctx.fillRect(0, y, xs, u);
  ctx.restore(); ctx.globalCompositeOperation = 'source-over';
  drawAt(ctx, holes, P, flat('rgba(3,8,14,.86)'));
  // the beam
  ctx.globalCompositeOperation = 'lighter';
  const bg = ctx.createLinearGradient(xs - w * 0.05, 0, xs + w * 0.012, 0); bg.addColorStop(0, 'rgba(60,255,220,0)'); bg.addColorStop(0.8, 'rgba(60,255,220,.16)'); bg.addColorStop(1, 'rgba(60,255,220,0)'); ctx.fillStyle = bg; ctx.fillRect(xs - w * 0.05, h * 0.06, w * 0.062, h * 0.82);
  ctx.fillStyle = 'rgba(190,255,240,.85)'; ctx.fillRect(xs - u * 0.8, h * 0.06, 1.6 * u, h * 0.82);
  ctx.globalCompositeOperation = 'source-over';
  // the slice at the beam: where the line meets bone, shown as a ring of bone about the midline (schematic)
  const polys = solid.filter(q => q.p).map(q => q.p.map(v => toScreen(P, v[0], v[1]))), hc = holes.map(q => [...toScreen(P, q.c[0], q.c[1]), q.c[2] * P.k]);
  const y0 = h * 0.47 - P.hh - 4 * u, y1 = h * 0.47 + P.hh + 4 * u, NS = 90, runs = []; let start = -1;
  for (let i = 0; i <= NS; i++) { const y = lerp(y0, y1, i / NS), inside = i < NS && polys.some(pl => inPoly(pl, xs, y)) && !hc.some(c => Math.hypot(xs - c[0], y - c[1]) < c[2]); if (inside && start < 0) start = i; if (!inside && start >= 0) { runs.push([start / NS, i / NS]); start = -1; } }
  const sx = w * 0.865, sy = h * 0.4, sr = h * 0.2;
  ctx.fillStyle = 'rgba(6,14,20,.9)'; ctx.strokeStyle = 'rgba(90,190,210,.5)'; ctx.lineWidth = u; ctx.beginPath(); ctx.roundRect(sx - sr * 0.95, sy - sr * 1.15, sr * 1.9, sr * 2.3, 6 * u); ctx.fill(); ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  for (const [a, b] of runs) { const cyy = sy + ((a + b) / 2 - 0.5) * sr * 2, ry = Math.max(1.5 * u, (b - a) * sr), rx = Math.min(sr * 0.75, ry * 1.25 + sr * 0.05);
    ctx.strokeStyle = 'rgba(170,225,250,.8)'; ctx.lineWidth = Math.max(1.2 * u, Math.min(ry * 0.45, 5 * u)); ctx.fillStyle = 'rgba(90,150,190,.22)'; ctx.beginPath(); ctx.ellipse(sx, cyy, rx, ry, 0, 0, TAU); ctx.fill(); ctx.stroke(); }
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 40 * p.x2; i++) { ctx.fillStyle = `rgba(160,230,250,${0.25 * hash(i, f.t * 30 | 0)})`; ctx.fillRect(hash(i, (f.t * 30 | 0) + 5) * w, hash(i, (f.t * 30 | 0) + 9) * h, 1.5 * u, 1.5 * u); }
  const la = clamp(p.x4 * 2), ink = a => `rgba(150,225,240,${a * la})`;
  if (la > 0.03) {
    text(ctx, 'CT SCAN  ·  SKULL', w * 0.03, h * 0.08, 12 * u, ink(1), { font: MONO, bold: true });
    text(ctx, sp.name, w * 0.03, h * 0.125, 15 * u, ink(1), { italic: true });
    text(ctx, `${sp.where}  ·  ${maSpan(sp)}`, w * 0.03, h * 0.16, 10 * u, ink(0.75));
    text(ctx, 'slice at the beam (schematic)', sx, sy + sr * 1.15 + 14 * u, 9 * u, ink(0.8), { align: 'center', font: MONO });
    text(ctx, 'X-rays map the inside of a fossil skull without cutting it: the braincase, the air spaces, teeth still in the jaw.', w * 0.03, h * 0.945, 10.5 * u, ink(0.85));
    text(ctx, `${Math.round(clamp((xs - bl) / (br - bl)) * 100)}%`, xs + 5 * u, h * 0.905, 9 * u, ink(0.9), { font: MONO });
  }
  void x0;
}

// ================================================================ engine
const MODES = { strata, dig, taph, berlin, fighting, tracks, amber, drawer, scan };
export default {
  id: 'fossil',
  name: 'Fossils & Digs',
  kind: '2d',
  sky: false,
  params: [
    { id: 'x1', label: 'Uncovered', value: 0.5, tip: 'How much has been dug, cleaned or prepared: the dig runs ahead or behind, bones show more clearly, amber clears' },
    { id: 'x2', label: 'Dust', value: 0.5, tip: 'Brush dust, blowing sand, motes in the light, specks in the amber' },
    { id: 'x3', label: 'Depth', value: 0.5, tip: 'How deep: the cut through the rock, the burial, the relief of the bones, the colour of the amber, the scan position' },
    { id: 'x4', label: 'Labels', value: 0.5, tip: 'Names, ages and notes' },
  ],
  create(ctx, opts) {
    const st = {}, R = MODES[opts.mode] || strata;
    return {
      render(f) { ctx.save(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; try { R(f, st); } finally { ctx.restore(); } },
      dispose() { st.cache?.clear(); st.memo?.clear(); }
    };
  }
};

const S = (id, name, desc, tags, opts, params) => ({ id: 'fossil-' + id, name, desc, tags: ['fossil', '2d', ...tags], opts, params });
export const scenes = [
  S('strata', 'Rock Layers', 'A cliff builds up through 180 million years; each animal is buried in the layer of its own time, with the dark impact clay at 66 Ma.', ['diagram', 'triassic', 'jurassic', 'cretaceous', 'time travel', 'impact', 'theropod', 'sauropod'],
    { mode: 'strata' }, { stage: 0.82, grow: 0.45, light: 0.8, x1: 0.95 }),
  S('dig', 'Dig Site', 'A quarry floor under a string grid: the skeleton comes out square by square. Drag to brush it clean; Era changes whose bones they are.', ['dig', 'theropod', 'cretaceous'],
    { mode: 'dig', sp: 'tyrannosaurus' }, { stage: 0.855, light: 0.75 }),
  S('nightdig', 'Night Dig', 'Working late by lamplight on a horned dinosaur. Drag to brush.', ['dig', 'night', 'ceratopsian', 'cretaceous'],
    { mode: 'dig', sp: 'triceratops' }, { stage: 0.86, light: 0.06, x2: 0.8 }),
  S('discovery', 'From Death to Discovery', 'How a fossil is made: death by a river, burial, turning to stone, uplift, erosion and a lucky find.', ['diagram', 'ornithopod', 'cretaceous', 'story'],
    { mode: 'taph', sp: 'edmontosaurus' }, { stage: 0.85, light: 0.8 }),
  S('berlin', 'The Berlin Slab', 'Archaeopteryx splayed on pale Solnhofen limestone, feathers pressed into the stone (always this fossil, whatever the Era).', ['specimen', 'bird', 'theropod', 'jurassic', 'feathers'],
    { mode: 'berlin', lock: true }, { stage: 0.47, light: 0.7, x1: 0.9 }),
  S('fighting', 'The Fighting Dinosaurs', 'Velociraptor and Protoceratops locked together in Gobi sandstone, as they were found in 1971 (always this fossil).', ['specimen', 'theropod', 'ceratopsian', 'cretaceous', 'desert'],
    { mode: 'fighting', lock: true }, { stage: 0.79, light: 0.6, x1: 0.95 }),
  S('tracks', 'Trackway', 'An animal walks across wet mud; the mud dries, cracks and turns to stone with the footprints still in it.', ['tracks', 'theropod', 'jurassic', 'from above'],
    { mode: 'tracks', sp: 'allosaurus' }, { stage: 0.43, light: 0.8 }),
  S('amber', 'Tail in Amber', 'A small feathered dinosaur tail in glowing amber, like the real 99-million-year-old piece from Myanmar (always this fossil).', ['specimen', 'amber', 'feathers', 'cretaceous', 'theropod'],
    { mode: 'amber', lock: true }, { stage: 0.68, light: 0.2, x1: 0.9, x2: 0.4 }),
  S('drawer', 'Museum Drawer', 'A specimen drawer with the bones laid out by kind and labelled. Era changes whose drawer it is.', ['museum', 'specimen', 'stegosaur', 'jurassic'],
    { mode: 'drawer', sp: 'stegosaurus' }, { stage: 0.43, light: 0.85, x1: 1 }),
  S('scan', 'CT Scan', 'An X-ray beam sweeps through a skull and shows the slice it is reading. Era changes the skull.', ['museum', 'scan', 'theropod', 'cretaceous', 'x-ray'],
    { mode: 'scan', sp: 'tyrannosaurus' }, { stage: 0.86, light: 0.5 }),
];
