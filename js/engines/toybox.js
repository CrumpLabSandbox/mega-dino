// Toy Box: dinosaurs as toys on a table top. The animals come from the shared rig (pose / parts) but are restyled as
// materials (moulded plastic, plywood, lithographed tin, studded bricks, plush, balloons, cardboard, bath rubber,
// glow-in-the-dark) and they move the way toys move: hopped by an invisible hand, pulled on a string, wound up.
// The species are chosen as toys, so they are locked: the Era control changes the play mat and the toy trees instead,
// and at the impact a rubber ball rolls in as the "asteroid", the lamp flickers and the toys get knocked over.
// Each toy is rendered once into a sprite (so the material can be rich) and then moved as a rigid thing, as toys are.
import { clamp, lerp, smooth, fract, hash, rng, buffer, sky, daylight, energy, windX, wrap } from '../util.js';
import { pose, parts, bones, tube } from '../rig.js';
import { species } from '../species.js';
import { trace, feetY } from '../draw.js';
import { plantParts, flora, PLANTS } from '../flora.js';

const TAU = Math.PI * 2, PI = Math.PI;
const sm = t => t * t * (3 - 2 * t);

// ---------------------------------------------------------------- colour
const hx = c => { const p = parseInt(c.slice(1), 16); return [p >> 16, p >> 8 & 255, p & 255]; };
const A = c => typeof c === 'string' ? hx(c) : c;
const css = (c, a = 1) => { c = A(c); return a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; };
const mix = (a, b, t) => { a = A(a); b = A(b); return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; };
const lit = (c, k) => { c = A(c); return k <= 1 ? [c[0] * k, c[1] * k, c[2] * k] : mix(c, [255, 255, 255], k - 1); };
const vivid = (c, s) => { c = A(c); const g = (c[0] + c[1] + c[2]) / 3; return c.map(v => clamp(g + (v - g) * s, 0, 255)); };
// toy colours for a species: its own palette pushed towards paint-pot colours, or built around one given colour
function toyPal(sp, s = 1.5, over, acc) {
  const [b, be, m, a] = sp.c.map(c => lit(vivid(c, s), 1.1));
  const body = over ? A(over) : b, accent = acc ? A(acc) : over ? lit(vivid(a, s), 1.15) : a;
  return { body, belly: over ? lit(body, 1.38) : be, far: lit(body, 0.66), mark: over ? lit(body, 0.62) : m, accent, accentFar: lit(accent, 0.66),
    horn: [242, 234, 210], eye: [250, 250, 245], mouth: [150, 40, 44], bone: [236, 232, 212], boneFar: [170, 168, 150] };
}
// the play mat follows deep time: dry sand, fern green, flowers, burnt after the impact, ferns again
function matRGB(E) {
  let c = mix([208, 150, 98], [102, 164, 92], smooth(0.7, 0.3, E.dry));
  c = mix(c, [72, 148, 86], E.giants * 0.3);
  c = mix(c, [128, 178, 100], E.flowers * 0.3);
  c = mix(c, [74, 66, 62], Math.min(1, E.dark * 0.85 + (1 - E.dinos) * (1 - E.ferns) * 0.35));
  return mix(c, [100, 150, 94], E.ferns * 0.5);
}

// ---------------------------------------------------------------- geometry helpers
function boxOf(ps) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  const add = (x, y, r) => { if (x - r < x0) x0 = x - r; if (x + r > x1) x1 = x + r; if (y - r < y0) y0 = y - r; if (y + r > y1) y1 = y + r; };
  for (const q of ps) { if (q.c) add(q.c[0], q.c[1], q.c[2]); else { const m = q.l ? q.w / 2 : 0; for (const v of q.p || q.l) add(v[0], v[1], m); } }
  return { x0, x1, y0, y1 };
}
const LEGK = /^(leg|foot)$/;
// the pose a toy was "made" in (bricks get four walk frames and two roaring ones for stop motion)
function poseOf(toy, fr = 0) {
  const c = toy._p || (toy._p = {});
  if (c[fr]) return c[fr];
  const sp = species(toy.sp), roar = fr >= 4, ph = toy.phase ?? 0.1;
  const q = pose(sp, { phase: roar ? ph : ph + fr / 4, jaw: roar ? (fr === 4 ? 0.9 : 0.35) : toy.jaw || 0, headTo: roar ? 0.45 : toy.head || 0, young: toy.young || 0, rear: toy.rear || 0, t: 2 });
  const ps = toy.bones ? bones(q) : parts(q), b = boxOf(ps);
  b.fy = feetY(q); b.cx = (b.x0 + b.x1) / 2;
  return c[fr] = { sp, q, ps, box: b };
}
// pull-toys lose their legs: the body sits on a plank with wheels. Everything in metres, in the animal's frame.
function woodGeom(P) {
  if (P.wood) return P.wood;
  const { q } = P, n = q.nodes, len = q.L, keep = P.ps.filter(p => !/^(leg|foot|claw|arm)$/.test(p.k));
  let belly = 1e9; for (let i = q.iHip; i <= q.iSh; i++) belly = Math.min(belly, n[i].y - (n[i].b ?? n[i].r));
  const wr = len * 0.042, pt = len * 0.02, top = belly + len * 0.012, bot = top - pt, b = boxOf(keep);
  const xa = n[q.iHip].x - len * 0.07, xb = n[q.iSh].x + len * 0.07;
  b.fy = bot - wr * 1.15; b.cx = (b.x0 + b.x1) / 2;
  return P.wood = { keep, box: b, wr, top, bot, xa, xb, wheels: [n[q.iHip].x - len * 0.01, n[q.iSh].x + len * 0.01], wy: b.fy + wr };
}
function balloonGeom(P) {
  if (P.bal) return P.bal;
  const { q } = P, n = q.nodes, len = q.L, R = clamp(n[q.iHip].r * 0.72, len * 0.032, len * 0.056);
  const pt = i => [n[i].x, n[i].y], seg = [];
  const run = (a, b, st) => { const o = []; for (let i = a; i <= b; i += st) o.push(pt(i)); if ((b - a) % st) o.push(pt(b)); return o; };
  for (const g of q.legs) if (!g.near) seg.push({ l: [g.pts[0], [lerp(g.pts[0][0], g.pts[3][0], 0.5) + (g.pts[1][0] - g.pts[0][0]) * 0.3, lerp(g.pts[0][1], g.pts[3][1], 0.5)], g.pts[3]], r: R * 0.82, far: 1 });
  seg.push({ l: run(1, q.iHip, 2), r: R * 0.8, tail: 1 });
  seg.push({ l: run(q.iHip, q.iSh, 2), r: R * 1.2 });
  seg.push({ l: run(q.iSh, q.iEnd, 2), r: R * 0.85 });
  const h = q.head, hl = Math.max(h.len, R * 2.6);
  seg.push({ l: [[h.x, h.y], [h.x + Math.cos(h.a) * hl, h.y + Math.sin(h.a) * hl]], r: R * 0.95, head: 1 });
  for (const g of q.legs) if (g.near) seg.push({ l: [g.pts[0], [lerp(g.pts[0][0], g.pts[3][0], 0.5) + (g.pts[1][0] - g.pts[0][0]) * 0.3, lerp(g.pts[0][1], g.pts[3][1], 0.5)], g.pts[3]], r: R * 0.82 });
  for (const g of q.arms) if (g.near) seg.push({ l: [g.pts[0], g.pts[2]], r: R * 0.5 });
  const b = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 }; let fy = 1e9;
  for (const s of seg) for (const v of s.l) { b.x0 = Math.min(b.x0, v[0] - s.r); b.x1 = Math.max(b.x1, v[0] + s.r); b.y0 = Math.min(b.y0, v[1] - s.r); b.y1 = Math.max(b.y1, v[1] + s.r); }
  for (const g of q.legs) fy = Math.min(fy, g.pts[3][1] - R * 0.82);
  b.fy = fy; b.cx = (b.x0 + b.x1) / 2;
  return P.bal = { seg, box: b, R };
}
const bellyOf = P => { if (P.belly == null) { const q = P.q, n = q.nodes; let b = 1e9; for (let i = q.iHip; i <= q.iSh; i++) b = Math.min(b, n[i].y - (n[i].b ?? n[i].r)); P.belly = b; } return P.belly; };
const sizeBox = (mode, P) => mode === 'pull' ? woodGeom(P).box : mode === 'balloon' ? balloonGeom(P).box : P.box;

// a sprite: the toy drawn once at k pixels per metre, facing dir, with its pivot under the middle of the feet
function sprite(box, k, dir, pad, below, draw) {
  const W = Math.ceil((box.x1 - box.x0) * k + pad * 2), H = Math.ceil((box.y1 - box.fy) * k + pad * 2 + below);
  const b = buffer(W, H), px = W / 2, py = pad + (box.y1 - box.fy) * k;
  const T = { x: px - box.cx * k * dir, y: py + box.fy * k, k, dir };
  b.ctx.lineJoin = b.ctx.lineCap = 'round';
  draw(b.ctx, T, W, H);
  return { c: b.canvas, px, py, k, W, H, m: (x, y) => [T.x + x * k * dir - px, T.y - y * k - py] };
}
// fill (and optionally outline) parts with fn(part) → css | null
function paint(g, ps, T, fn, stroke, lw) {
  for (const q of ps) {
    const c = fn(q); if (!c) continue;
    g.beginPath(); trace(g, q, T);
    if (q.l) { g.strokeStyle = c; g.lineWidth = Math.max(0.7, q.w * T.k); g.stroke(); continue; }
    g.fillStyle = c; g.fill();
    if (stroke && lw && q.k !== 'mark' && q.k !== 'belly') { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
  }
}
// every part filled and fattened by lw in one colour: a silhouette with a margin
function fatten(g, ps, T, col, lw) {
  g.fillStyle = g.strokeStyle = col;
  for (const q of ps) { g.beginPath(); trace(g, q, T); g.lineWidth = q.l ? q.w * T.k + lw : lw; if (!q.l) g.fill(); g.stroke(); }
}
function topLight(g, W, H, a = 0.3, b = 0.36) {
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.45, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(0,0,20,0)'); gr.addColorStop(1, `rgba(0,0,20,${b})`);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
}
// highlight ribbons riding along the top of the spine, tapered at both ends
function specular(g, T, q, gloss, soft) {
  const n = q.nodes, k = T.k;
  const streak = (i0, i1, off, wid, a) => {
    if (i1 - i0 < 2) return;
    const top = [], bot = [];
    for (let i = i0; i <= i1; i++) { const u = (i - i0) / (i1 - i0), w = n[i].r * k * wid * Math.pow(Math.sin(PI * u), 0.6), x = T.x + n[i].x * k * T.dir - n[i].r * k * 0.12, y = T.y - n[i].y * k - n[i].r * k * off;
      top.push([x, y - w / 2]); bot.push([x, y + w / 2]); }
    g.fillStyle = `rgba(255,255,255,${a * gloss})`; g.beginPath(); top.concat(bot.reverse()).forEach((v, i) => i ? g.lineTo(v[0], v[1]) : g.moveTo(v[0], v[1])); g.fill();
  };
  for (const [a, b] of [[2, q.iHip - 1], [q.iHip, q.iSh], [q.iSh + 1, q.iEnd]]) { streak(a, b, 0.45, soft ? 0.8 : 0.6, soft ? 0.2 : 0.22); streak(a, b, 0.55, soft ? 0.3 : 0.2, soft ? 0.4 : 0.8); }
  const h = q.head, hx = T.x + (h.x + Math.cos(h.a) * h.len * 0.4) * k * T.dir, hy = T.y - (h.y + Math.sin(h.a) * h.len * 0.4 + h.len * 0.27) * k;
  g.fillStyle = `rgba(255,255,255,${0.7 * gloss})`; g.beginPath(); g.ellipse(hx, hy, h.len * k * 0.2, h.len * k * 0.035, -h.a * T.dir, 0, TAU); g.fill();
  g.lineCap = 'round'; g.strokeStyle = `rgba(255,255,255,${0.4 * gloss})`;
  for (const L of q.legs) if (L.near) { const a = L.pts[0], b = L.pts[1], o = L.R[0] * 0.35 * k * T.dir; g.lineWidth = Math.max(0.6, L.R[0] * k * 0.3);
    g.beginPath(); g.moveTo(T.x + lerp(a[0], b[0], 0.2) * k * T.dir + o, T.y - lerp(a[1], b[1], 0.2) * k); g.lineTo(T.x + lerp(a[0], b[0], 0.8) * k * T.dir + o, T.y - lerp(a[1], b[1], 0.8) * k); g.stroke(); }
}
const eyeOf = ps => ps.find(p => p.k === 'eye');
function paintedEye(g, T, P, big = 1, white = false) {
  const e = eyeOf(P.ps); if (!e) return;
  const x = T.x + e.c[0] * T.k * T.dir, y = T.y - e.c[1] * T.k, r = Math.max(e.c[2] * big, P.q.L * 0.006 * big) * T.k;
  if (white) { g.fillStyle = '#fffdf4'; g.beginPath(); g.arc(x, y, r * 1.5, 0, TAU); g.fill(); }
  g.fillStyle = '#17120e'; g.beginPath(); g.arc(x + (white ? r * 0.3 * T.dir : 0), y, r, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.35, r * 0.32, 0, TAU); g.fill();
}
// the moulded base under a plastic figure
function slab(g, T, q, fy, col, label) {
  let a = 1e9, b = -1e9; const k = T.k, len = q.L;
  for (const L of q.legs) { a = Math.min(a, L.pts[3][0], L.tip[0]); b = Math.max(b, L.pts[3][0], L.tip[0]); }
  const mid = (a + b) / 2, half = Math.max((b - a) / 2 + len * 0.04, len * 0.13);
  const xc = T.x + mid * k * T.dir, rx = half * k, y = T.y - fy * k, ry = len * k * 0.03, tk = len * k * 0.014;
  g.fillStyle = css(lit(col, 0.55)); g.beginPath(); g.ellipse(xc, y + tk, rx, ry, 0, 0, TAU); g.fill(); g.fillRect(xc - rx, y, rx * 2, tk);
  g.fillStyle = css(lit(col, 0.86)); g.beginPath(); g.ellipse(xc, y, rx, ry, 0, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = Math.max(0.6, tk * 0.25); g.beginPath(); g.ellipse(xc, y, rx * 0.97, ry * 0.9, 0, PI * 1.05, PI * 1.95); g.stroke();
  if (label && ry > 7) { g.font = `bold ${ry * 0.62}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,255,255,.3)'; g.fillText(label, xc + 0.6, y + ry * 0.5 + 0.6); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillText(label, xc, y + ry * 0.5); }
}

// ---------------------------------------------------------------- materials
// 1. moulded plastic (also bath rubber and glow-in-the-dark): one colour, sculpted lines, a hard highlight, a seam
function bPlastic(P, k, dir, o) {
  const { q, ps, box, sp } = P, len = q.L, col = A(o.col), below = o.noBase ? 0 : len * k * 0.05;
  return sprite(box, k, dir, Math.ceil(len * k * 0.012) + 2, below, (g, T, W, H) => {
    const lw = Math.max(0.5, len * k * 0.0035), dark = css(lit(col, 0.72)), mid = css(col);
    if (!o.noBase) slab(g, T, q, box.fy, o.rubber ? col : lit(col, 0.9), sp.name.toUpperCase());
    paint(g, ps, T, p => /^(eye|nostril|mark|belly|ray)$/.test(p.k) ? null : p.t === 'far' || p.t === 'accentFar' ? dark : p.t === 'mouth' ? css(lit(col, 0.42)) : p.k === 'tooth' ? css(lit(col, 1.55)) : mid, css(lit(col, 0.5), o.rubber ? 0.3 : 0.5), lw);
    g.globalCompositeOperation = 'source-atop';
    paint(g, ps, T, p => p.k === 'mark' ? 'rgba(0,0,0,.09)' : p.k === 'belly' ? (o.rubber ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.09)') : null);
    topLight(g, W, H, o.rubber ? 0.22 : 0.3, o.rubber ? 0.26 : 0.4);
    specular(g, T, q, o.gloss, o.rubber);
    if (!o.rubber) {       // the mould seam down the middle of the back and tail
      const n = q.nodes; g.lineWidth = Math.max(0.5, lw * 0.8);
      for (const [dy, c] of [[0, 'rgba(0,0,0,.2)'], [lw, 'rgba(255,255,255,.22)']]) { g.strokeStyle = c; g.beginPath(); for (let i = 1; i < n.length; i++) g.lineTo(T.x + n[i].x * k * dir, T.y - (n[i].y + n[i].r * 0.12) * k + dy); g.stroke(); }
    }
    g.globalCompositeOperation = 'source-over';
    paintedEye(g, T, P, o.rubber ? 2.4 : 1.2, o.rubber);
  });
}
// glow-in-the-dark skeleton kit
function bBones(P, k, dir, o) {
  const { q, ps, box } = P, len = q.L, col = A(o.col);
  return sprite(box, k, dir, 3, len * k * 0.05, (g, T, W, H) => {
    slab(g, T, q, box.fy, [70, 74, 80], P.sp.name.toUpperCase());
    paint(g, ps, T, p => p.t === 'hole' ? null : p.t === 'boneFar' ? css(lit(col, 0.6)) : css(col), css(lit(col, 0.5), 0.5), Math.max(0.4, len * k * 0.002));
    g.globalCompositeOperation = 'destination-out'; paint(g, ps, T, p => p.t === 'hole' ? '#000' : null);
    g.globalCompositeOperation = 'source-atop'; topLight(g, W, H, 0.25, 0.25);
    g.globalCompositeOperation = 'source-over';
  });
}
// 2. plywood profile on a wheeled plank (the wheels are drawn live, so they can turn)
function bWood(P, k, dir, o) {
  const G = woodGeom(P), { q } = P, len = q.L, pal = toyPal(P.sp, 1.5, o.col);
  return sprite(G.box, k, dir, Math.ceil(len * k * 0.02) + 3, 2, (g, T, W, H) => {
    const th = Math.max(1.5, len * k * 0.011), R = rng(Math.imul(P.sp.len * 100 | 0, 2654435761));
    for (let i = 3; i >= 1; i--) { g.save(); g.translate(th * i / 3 * 0.7, th * i / 3); fatten(g, G.keep, T, i % 2 ? '#7e5a34' : '#c9a36c', th * 0.5); g.restore(); }
    fatten(g, G.keep, T, '#5a3a1c', th * 0.55);
    const fb = buffer(W, H), a = fb.ctx; a.lineJoin = a.lineCap = 'round';
    paint(a, G.keep, T, () => '#e6c590');
    a.globalCompositeOperation = 'source-atop';
    a.fillStyle = css(pal.body, 0.42); a.fillRect(0, 0, W, H);
    paint(a, G.keep, T, p => p.t === 'accent' || p.t === 'accentFar' ? css(pal.accent, 0.9) : p.t === 'horn' ? css(pal.horn, 0.9) : null);
    paint(a, P.ps, T, p => p.k === 'belly' ? 'rgba(255,244,214,.6)' : p.k === 'mark' ? css(pal.body, 0.85) : null);
    for (let i = 0; i < 46 * o.detail + 10; i++) {    // wood grain running along the board
      const y0 = R() * H, fr = 2 + R() * 4, ph = R() * 6, am = H * (0.01 + R() * 0.03);
      a.strokeStyle = R() < 0.3 ? `rgba(255,236,200,${0.08 + R() * 0.1})` : `rgba(84,48,18,${0.05 + R() * 0.11})`; a.lineWidth = Math.max(0.5, th * (0.15 + R() * 0.35));
      a.beginPath(); for (let j = 0; j <= 14; j++) a.lineTo(W * j / 14, y0 + Math.sin(j / 14 * fr + ph) * am); a.stroke();
    }
    paint(a, G.keep, T, () => null, null, 0);
    a.strokeStyle = 'rgba(70,38,12,.4)'; a.lineWidth = Math.max(0.6, th * 0.3);      // burnt-in outlines
    for (const p of G.keep) if (!p.l && /^(skull|jaw|plate|frill|crest|horn|sail)$/.test(p.k)) { a.beginPath(); trace(a, p, T); a.stroke(); }
    const gr = a.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, `rgba(255,255,255,${0.08 + 0.2 * o.gloss})`); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(40,20,0,.2)');
    a.fillStyle = gr; a.fillRect(0, 0, W, H);
    g.drawImage(fb.canvas, 0, 0);
    paintedEye(g, T, P, 1.8);
    // the plank
    const x0 = T.x + G.xa * k * dir, x1 = T.x + G.xb * k * dir, xl = Math.min(x0, x1), pw = Math.abs(x1 - x0), yt = T.y - G.top * k, ph = (G.top - G.bot) * k;
    g.fillStyle = '#8a6238'; g.fillRect(xl + th * 0.6, yt + th * 0.7, pw, ph);
    const pg = g.createLinearGradient(0, yt, 0, yt + ph); pg.addColorStop(0, '#edd0a0'); pg.addColorStop(0.25, '#d9b47c'); pg.addColorStop(1, '#b98c56');
    g.fillStyle = pg; g.fillRect(xl, yt, pw, ph);
    g.strokeStyle = 'rgba(90,54,22,.3)'; g.lineWidth = Math.max(0.5, ph * 0.06); g.beginPath(); g.moveTo(xl, yt + ph * 0.5); g.lineTo(xl + pw, yt + ph * 0.56); g.stroke();
  });
}
// 3. lithographed tin: printed colours and outlines, bands of reflection, rivets and tabs. Legs and key are drawn live.
function bTin(P, k, dir, o) {
  const { q, ps, box } = P, len = q.L, pal = toyPal(P.sp, 1.9, o.col, o.acc);
  const keep = ps.filter(p => !LEGK.test(p.k) && !(p.k === 'claw' && !q.arms.length));
  return sprite(box, k, dir, 3, 0, (g, T, W, H) => {
    const lw = Math.max(0.6, len * k * 0.004);
    paint(g, keep, T, p => p.k === 'eye' || p.k === 'nostril' ? null : css(pal[p.t] || pal.body), '#2a1c14', lw);
    g.globalCompositeOperation = 'source-atop';
    const d = Math.max(3, Math.round(len * k * 0.012)), hb = buffer(d, d);          // printed halftone
    hb.ctx.fillStyle = 'rgba(40,10,0,.16)'; hb.ctx.beginPath(); hb.ctx.arc(d / 2, d / 2, d * 0.24, 0, TAU); hb.ctx.fill();
    g.fillStyle = g.createPattern(hb.canvas, 'repeat'); g.fillRect(0, 0, W, H);
    const gr = g.createLinearGradient(0, 0, W * 0.9, H * 0.5), G = o.gloss;
    for (const [s, c] of [[0, 'rgba(255,255,255,0)'], [0.16, `rgba(255,255,255,${0.42 * G})`], [0.24, 'rgba(255,255,255,0)'], [0.42, 'rgba(0,0,30,.14)'], [0.55, `rgba(255,255,255,${0.3 * G})`], [0.62, 'rgba(255,255,255,0)'], [0.8, 'rgba(0,0,30,.16)'], [0.9, `rgba(255,255,255,${0.34 * G})`], [1, 'rgba(255,255,255,0)']]) gr.addColorStop(s, c);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    topLight(g, W, H, 0.12, 0.3);
    const n = q.nodes, rr = Math.max(1, len * k * 0.0055);
    g.strokeStyle = 'rgba(30,20,10,.35)'; g.lineWidth = lw * 0.8; g.beginPath();             // the seam where the two halves fold together
    for (let i = 3; i <= q.iEnd; i++) g.lineTo(T.x + n[i].x * k * dir, T.y - (n[i].y - (n[i].b ?? n[i].r) * 0.62) * k); g.stroke();
    g.globalCompositeOperation = 'source-over';
    for (let i = 4; i <= q.iEnd; i += 2) {                  // rivets along it
      const x = T.x + n[i].x * k * dir, y = T.y - (n[i].y - (n[i].b ?? n[i].r) * 0.62) * k;
      g.fillStyle = '#6b6a66'; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill(); g.fillStyle = '#f3f1e8'; g.beginPath(); g.arc(x - rr * 0.3, y - rr * 0.3, rr * 0.45, 0, TAU); g.fill();
    }
    for (let i = q.iHip - 2; i <= q.iSh + 1; i += 2) {      // folded tabs on the back
      const x = T.x + n[i].x * k * dir, y = T.y - (n[i].y + n[i].r * 0.72) * k; g.fillStyle = '#d9d6cc'; g.fillRect(x - rr * 1.6, y - rr * 0.5, rr * 3.2, rr); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x - rr * 1.6, y + rr * 0.5, rr * 3.2, Math.max(0.5, rr * 0.3));
    }
    paintedEye(g, T, P, 2.1, true);
  });
}
// 4. building bricks: the parts rasterised to a coarse grid, every run of cells a studded brick
function pip(x, y, p) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function brickSprite(ps, box, k, dir, cell, idx, cols, extra, gloss) {
  const ch = cell * 1.12, c0 = Math.floor(box.x0 / cell) - 1, nc = Math.ceil(box.x1 / cell) + 1 - c0, nr = Math.ceil((box.y1 - box.fy) / ch) + 1;
  const G = new Uint8Array(nc * nr);
  const set = (x, y, v) => { const c = Math.floor(x / cell) - c0, r = Math.floor((y - box.fy) / ch); if (c >= 0 && c < nc && r >= 0 && r < nr) G[r * nc + c] = v; };
  const line = (pts, v) => { for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (cell * 0.45)) || 1; for (let j = 0; j <= n; j++) set(lerp(a[0], b[0], j / n), lerp(a[1], b[1], j / n), v); } };
  if (extra) extra(line, set, 0);
  for (const p of ps) {
    const v = idx(p); if (!v) continue;
    if (p.l) { if (p.w > cell * 0.4) line(p.l, v); continue; }
    if (p.c) { const r = Math.max(p.c[2], cell * 0.3); for (let y = p.c[1] - r; y <= p.c[1] + r; y += ch * 0.5) for (let x = p.c[0] - r; x <= p.c[0] + r; x += cell * 0.5) if (Math.hypot(x - p.c[0], y - p.c[1]) <= r) set(x, y, v); continue; }
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const q of p.p) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    const ca = Math.floor(x0 / cell), cb = Math.floor(x1 / cell), ra = Math.floor((y0 - box.fy) / ch), rb = Math.floor((y1 - box.fy) / ch); let hit = 0;
    for (let r = ra; r <= rb; r++) for (let c = ca; c <= cb; c++) { const x = (c + 0.5) * cell, y = box.fy + (r + 0.5) * ch; if (pip(x, y, p.p)) { set(x, y, v); hit++; } }
    if (/^(horn|spike|plate|crest|claw)$/.test(p.k) && hit < 2) { let mx = 0, my = 0; for (const q of p.p) { mx += q[0]; my += q[1]; } mx /= p.p.length; my /= p.p.length; for (const q of p.p) line([[mx, my], [lerp(mx, q[0], 0.8), lerp(my, q[1], 0.8)]], v); }
    if (extra && p.k === 'body') extra(line, set, 1);
  }
  if (extra) extra(line, set, 2);
  const cw = Math.max(2, Math.round(cell * k)), chp = Math.max(2, Math.round(ch * k)), sh = Math.max(1, Math.round(chp * 0.2)), pad = 3;
  const W = nc * cw + pad * 2, H = nr * chp + pad * 2 + sh, b = buffer(W, H), g = b.ctx;
  const X = c => dir > 0 ? pad + c * cw : W - pad - (c + 1) * cw, py = H - pad;
  const at = (r, c) => r < nr && c >= 0 && c < nc ? G[r * nc + c] : 0;
  const ol = Math.max(1, cw * 0.09); g.fillStyle = 'rgba(30,24,40,.5)';       // a dark line round the whole model
  for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) if (G[r * nc + c]) g.fillRect(X(c) - ol, py - (r + 1) * chp - ol, cw + ol * 2, chp + ol * 2);
  for (let r = 0; r < nr; r++) {
    const y = py - (r + 1) * chp;
    for (let c = 0; c < nc;) {
      const v = G[r * nc + c]; if (!v) { c++; continue; }
      let e = c + 1; while (e < nc && G[r * nc + e] === v && (e + r * 2) % 3 !== 0) e++;
      const xa = Math.min(X(c), X(e - 1)), bw = (e - c) * cw, col = cols[v];
      g.fillStyle = css(col); g.fillRect(xa, y, bw, chp);
      g.fillStyle = `rgba(255,255,255,${0.2 + 0.25 * gloss})`; g.fillRect(xa, y, bw, Math.max(1, chp * 0.14)); g.fillRect(xa, y, Math.max(1, cw * 0.08), chp);
      g.fillStyle = 'rgba(0,0,20,.26)'; g.fillRect(xa, y + chp - Math.max(1, chp * 0.12), bw, Math.max(1, chp * 0.12)); g.fillRect(xa + bw - Math.max(1, cw * 0.08), y, Math.max(1, cw * 0.08), chp);
      if (gloss > 0.1 && bw > cw) { g.fillStyle = `rgba(255,255,255,${0.16 * gloss})`; g.fillRect(xa + cw * 0.25, y + chp * 0.26, bw - cw * 0.5, chp * 0.16); }
      for (let i = c; i < e; i++) if (!at(r + 1, i)) { const sx = X(i) + cw * 0.2; g.fillStyle = css(col); g.fillRect(sx, y - sh, cw * 0.6, sh + 1); g.fillStyle = 'rgba(255,255,255,.42)'; g.fillRect(sx, y - sh, cw * 0.6, Math.max(1, sh * 0.35)); g.fillStyle = 'rgba(0,0,20,.2)'; g.fillRect(sx + cw * 0.5, y - sh, cw * 0.1, sh); }
      c = e;
    }
  }
  return { c: b.canvas, px: dir > 0 ? pad - c0 * cw : W - pad + c0 * cw, py, k: cw / cell, W, H, cw, chp, m: (x, y) => [x * (cw / cell) * dir, -(y - box.fy) * (chp / ch)] };
}
const BI = { body: 1, belly: 2, far: 3, mark: 4, accent: 5, accentFar: 6, horn: 7, eye: 8, mouth: 9 };
function bBrick(P, k, dir, o) {
  const { q, ps, box } = P, pal = toyPal(P.sp, 1.7, o.col, o.acc), cell = (box.y1 - box.fy) / o.rows;
  const cols = [0, pal.body, pal.belly, pal.far, pal.mark, pal.accent, pal.accentFar, [244, 240, 226], [24, 22, 26], [196, 40, 44]];
  const S = brickSprite(ps, box, k, dir, cell, p => p.k === 'tooth' || p.k === 'nostril' || p.k === 'eye' || p.k === 'ray' ? 0 : BI[p.t] || 1, cols, (line, set, st) => {
    const fat = (g, v) => { for (const dx of [-0.9, 0, 0.9]) line(g.pts.map(a => [a[0] + dx * cell, a[1]]), v); line([g.pts[3], g.tip], v); };
    if (st === 0) for (const g of q.legs) if (!g.near) fat(g, 3);
    if (st === 1) { line(q.nodes.map(n => [n.x, n.y]), 1); for (let i = 2; i < q.nodes.length - 1; i++) { const n = q.nodes[i], r = n.r * 1.18; for (let y = -r; y <= r; y += cell * 0.5) for (let x = -r; x <= r; x += cell * 0.5) if (x * x + y * y <= r * r) set(n.x + x, n.y + y * (y < 0 ? (n.b ?? n.r) / n.r : 1), y < -r * 0.45 && i > q.iHip * 0.55 ? 2 : 1); } }
    if (st === 2) for (const g of q.legs) if (g.near) fat(g, 1);
  }, o.gloss);
  const e = eyeOf(ps);
  if (e) { const g = S.c.getContext('2d'), col = Math.floor(e.c[0] / cell), row = Math.floor((e.c[1] - box.fy) / (cell * 1.12));
    const x = S.px + (col + 0.5) * S.cw * dir, y = S.py - (row + 0.5) * S.chp, r = S.cw * 0.42;
    g.fillStyle = '#fffdf2'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.fillStyle = '#15131a'; g.beginPath(); g.arc(x + r * 0.2 * dir, y, r * 0.55, 0, TAU); g.fill(); }
  return S;
}
// 5. plush: corduroy and felt (as pattern fills), fat seams, stitches, a button eye
function cloth(g, col, kind, u) {
  col = A(col);
  if (kind === 'cord') { const s = Math.max(3, Math.round(u)), b = buffer(s, 4), c = b.ctx; c.fillStyle = css(col); c.fillRect(0, 0, s, 4); c.fillStyle = 'rgba(255,255,255,.2)'; c.fillRect(0, 0, s * 0.4, 4); c.fillStyle = 'rgba(0,0,30,.2)'; c.fillRect(s * 0.7, 0, Math.max(1, s * 0.3), 4); return g.createPattern(b.canvas, 'repeat'); }
  const b = buffer(32, 32), c = b.ctx, R = rng(77); c.fillStyle = css(col); c.fillRect(0, 0, 32, 32);
  for (let i = 0; i < 170; i++) { c.fillStyle = R() < 0.5 ? `rgba(255,255,255,${R() * 0.2})` : `rgba(0,0,20,${R() * 0.14})`; c.fillRect(R() * 32, R() * 32, 1 + R() * 2, 1); }
  return g.createPattern(b.canvas, 'repeat');
}
function bPlush(P, k, dir, o) {
  const { q, ps, box } = P, len = q.L, pal = toyPal(P.sp, 1.3, o.col, o.acc), fat = len * k * 0.016;
  const keep = ps.filter(p => !/^(tooth|claw|nostril|eye|mouth|ray|fuzz|quill|scute)$/.test(p.k));
  return sprite(box, k, dir, Math.ceil(fat * 2) + 3, fat, (g, T, W, H) => {
    const rib = len * k * 0.014, F = {};
    const fab = (t, kind) => F[t + kind] || (F[t + kind] = cloth(g, pal[t] || pal.body, kind, rib));
    for (const p of keep) {
      const felt = p.k === 'belly' || p.k === 'mark' || /^accent|horn/.test(p.t);
      g.fillStyle = g.strokeStyle = fab(p.t, felt ? 'felt' : 'cord');
      g.beginPath(); trace(g, p, T);
      if (p.l) { g.lineWidth = p.w * k + fat; g.stroke(); continue; }
      g.fill(); if (p.k !== 'mark' && p.k !== 'belly') { g.lineWidth = fat * (felt ? 0.7 : 1.5); g.stroke(); }
      g.save(); g.clip(); g.strokeStyle = 'rgba(40,20,40,.16)'; g.lineWidth = fat * 2.2; g.stroke(); g.restore();   // padded edge
    }
    g.globalCompositeOperation = 'source-atop'; topLight(g, W, H, 0.16, 0.3);
    // stitches: a dashed thread just inside the body seam, around the belly and every felt patch
    const th = Math.max(0.8, len * k * 0.0035), dash = [th * 3.2, th * 2.6];
    g.setLineDash(dash); g.lineWidth = th; g.strokeStyle = css(lit(pal.body, 1.7), 0.9);
    g.beginPath(); trace(g, { p: tube(q.nodes, 2, q.iEnd, 0.72, 0.8), s: 1 }, T); g.stroke();
    for (const p of keep) if (!p.l && (p.k === 'belly' || p.k === 'plate' || p.k === 'frill' || p.k === 'crest' || p.k === 'sail' || p.k === 'skull')) { g.strokeStyle = p.k === 'skull' ? css(lit(pal.body, 0.6), 0.7) : 'rgba(255,255,255,.75)'; g.beginPath(); trace(g, p, T); g.stroke(); }
    g.setLineDash([]); g.globalCompositeOperation = 'source-over';
    const e = eyeOf(ps);
    if (e) { const x = T.x + e.c[0] * k * dir, y = T.y - e.c[1] * k, r = Math.max(e.c[2] * 2.3, len * 0.014) * k;      // a button eye
      g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.arc(x + r * 0.12, y + r * 0.18, r, 0, TAU); g.fill();
      g.fillStyle = '#1d1a20'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = r * 0.16; g.beginPath(); g.arc(x, y, r * 0.72, 0, TAU); g.stroke();
      g.fillStyle = '#e9e4d8'; for (const s of [-1, 1]) { g.beginPath(); g.arc(x + s * r * 0.26, y, r * 0.13, 0, TAU); g.fill(); }
      g.strokeStyle = '#e9e4d8'; g.lineWidth = r * 0.1; g.beginPath(); g.moveTo(x - r * 0.26, y); g.lineTo(x + r * 0.26, y); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.ellipse(x - r * 0.4, y - r * 0.45, r * 0.3, r * 0.16, -0.6, 0, TAU); g.fill(); }
    const n = q.nodes[3], tx = T.x + n.x * k * dir, ty = T.y - (n.y - n.r) * k, s = fat * 1.3;                          // the sewn-in label
    g.fillStyle = '#fbf8ee'; g.fillRect(tx - s, ty - s * 0.2, s * 2, s * 1.5); g.fillStyle = '#d6453c'; g.fillRect(tx - s * 0.7, ty + s * 0.35, s * 1.4, s * 0.25);
  });
}
// 6. balloon animals: sausages of one diameter twisted together
function bBalloon(P, k, dir, o) {
  const G = balloonGeom(P), col = A(o.col), R0 = G.R * k;
  return sprite(G.box, k, dir, 4, 0, (g, T) => {
    const M = v => [T.x + v[0] * k * dir, T.y - v[1] * k];
    for (const s of G.seg) {
      const r = s.r * k, base = s.far ? lit(col, 0.72) : col;
      let pts = s.l.map(M);
      // pull the ends in so the round caps meet at the twist
      const trim = (a, b, d) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, t = Math.min(0.45, d / L); return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]; };
      pts[0] = trim(pts[0], pts[1], r * 0.8); pts[pts.length - 1] = trim(pts[pts.length - 1], pts[pts.length - 2], s.head ? 0 : r * 0.8);
      if (s.tail) { const a = pts[0], b = pts[1]; g.strokeStyle = css(lit(col, 0.6)); g.lineWidth = r * 0.3; g.beginPath(); g.moveTo(a[0] - (b[0] - a[0]) * 0.5, a[1] - (b[1] - a[1]) * 0.5 - r * 0.2); g.lineTo(a[0], a[1]); g.stroke(); }
      const path = (dx, dy) => { g.beginPath(); g.moveTo(pts[0][0] + dx, pts[0][1] + dy); if (pts.length === 2) g.lineTo(pts[1][0] + dx, pts[1][1] + dy); else { for (let i = 1; i < pts.length - 1; i++) { const m = i === pts.length - 2 ? pts[i + 1] : [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2]; g.quadraticCurveTo(pts[i][0] + dx, pts[i][1] + dy, m[0] + dx, m[1] + dy); } } };
      let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      g.setLineDash([]);
      g.strokeStyle = css(lit(base, 0.6)); g.lineWidth = r * 2; path(0, 0); g.stroke();
      g.strokeStyle = css(base); g.lineWidth = r * 1.78; path(-r * 0.04, -r * 0.05); g.stroke();
      g.strokeStyle = css(lit(base, 1.3), 0.55); g.lineWidth = r * 0.95; path(-r * 0.16, -r * 0.3); g.stroke();
      g.strokeStyle = css(lit(base, 1.25), 0.35); g.lineWidth = r * 0.22; path(r * 0.2, r * 0.74); g.stroke();
      if (!s.far) { g.strokeStyle = `rgba(255,255,255,${0.35 + 0.6 * o.gloss})`; g.lineWidth = r * 0.26; g.setLineDash([Math.max(1, L * 0.5), L * 4]); g.lineDashOffset = -L * 0.16; path(-r * 0.22, -r * 0.52); g.stroke();
        g.strokeStyle = `rgba(255,255,255,${0.2 + 0.4 * o.gloss})`; g.setLineDash([Math.max(1, L * 0.08), L * 4]); g.lineDashOffset = -L * 0.76; g.stroke(); g.setLineDash([]); }
      if (s.head) { const a = pts[pts.length - 1], b = pts[pts.length - 2], L2 = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, ux = (a[0] - b[0]) / L2, uy = (a[1] - b[1]) / L2;          // the knot on the nose
        g.fillStyle = css(lit(col, 0.6)); g.beginPath(); g.arc(a[0] + ux * r * 1.05, a[1] + uy * r * 1.05, r * 0.24, 0, TAU); g.fill();
        g.beginPath(); g.moveTo(a[0] + ux * r * 1.1, a[1] + uy * r * 1.1 - r * 0.2); g.lineTo(a[0] + ux * r * 1.55, a[1] + uy * r * 1.55 - r * 0.3); g.lineTo(a[0] + ux * r * 1.55, a[1] + uy * r * 1.55 + r * 0.3); g.lineTo(a[0] + ux * r * 1.1, a[1] + uy * r * 1.1 + r * 0.2); g.fill();
        const ex = b[0] + ux * L2 * 0.45, ey = b[1] + uy * L2 * 0.45 - r * 0.3;                                              // an eye drawn on with marker
        g.fillStyle = '#17131a'; g.beginPath(); g.ellipse(ex, ey, r * 0.2, r * 0.27, 0, 0, TAU); g.fill(); }
    }
    g.fillStyle = css(lit(col, 0.5));                      // the twists
    for (const i of [P.q.iHip, P.q.iSh, P.q.iEnd]) { const n = P.q.nodes[i], v = M([n.x, n.y]); g.beginPath(); g.ellipse(v[0], v[1], R0 * 0.2, R0 * 0.5, 0, 0, TAU); g.fill(); }
  });
}
// 7. cardboard cut-out: poster paint on card, cut with a margin, standing on a folded tab
function bCard(P, k, dir, o) {
  const { q, ps, box, sp } = P, len = q.L, pal = toyPal(sp, 1.35, o.col), m = Math.max(2, len * k * 0.016), below = len * k * 0.05;
  return sprite(box, k, dir, Math.ceil(m * 2) + 3, below, (g, T, W, H) => {
    let a = box.x0 + (box.x1 - box.x0) * 0.25, b = box.x1 - (box.x1 - box.x0) * 0.25;
    for (const L of q.legs) { a = Math.min(a, L.pts[3][0] - len * 0.03); b = Math.max(b, L.tip[0] + len * 0.03); }
    const x0 = T.x + a * k * dir, x1 = T.x + b * k * dir, xl = Math.min(x0, x1), sw = Math.abs(x1 - x0), y = T.y - box.fy * k;
    g.save(); g.translate(m * 0.4, m * 0.4); fatten(g, ps, T, '#8f6c42', m * 2); g.fillRect(xl, y - m, sw, below * 0.8 + m); g.restore();
    fatten(g, ps, T, '#f5efe0', m * 2);
    g.fillStyle = '#f5efe0'; g.fillRect(xl, y - m, sw, below * 0.8 + m);
    g.fillStyle = 'rgba(120,90,50,.25)'; g.fillRect(xl, y + m * 0.4, sw, Math.max(1, m * 0.15));
    if (below > 12) { g.fillStyle = '#4a4a5a'; g.font = `italic ${below * 0.46}px "Marker Felt","Comic Sans MS",cursive`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(sp.name, xl + sw / 2, y + below * 0.42); }
    const fb = buffer(W, H), c = fb.ctx, R = rng(Math.imul(sp.len * 77 | 0, 2654435761)); c.lineJoin = c.lineCap = 'round';
    paint(c, ps, T, p => p.k === 'nostril' ? null : css(pal[p.t] || pal.body, p.k === 'mark' ? 0.75 : 1), '#3a2a26', Math.max(0.7, len * k * 0.0045));
    c.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 90 * o.detail + 20; i++) {        // brush and crayon strokes
      const x = R() * W, yy = R() * H, l = W * (0.04 + R() * 0.1); c.strokeStyle = R() < 0.55 ? `rgba(255,255,255,${0.05 + R() * 0.12})` : `rgba(30,10,40,${0.03 + R() * 0.07})`;
      c.lineWidth = Math.max(0.8, m * (0.3 + R() * 0.8)); c.beginPath(); c.moveTo(x, yy); c.lineTo(x + l, yy - l * (0.25 + R() * 0.3)); c.stroke();
    }
    g.drawImage(fb.canvas, 0, 0);
    paintedEye(g, T, P, 1.5, true);
  });
}
// toy trees and rocks (plantParts), as plastic set dressing, card cut-outs or brick builds
const PLANTPAL = { trunk: [140, 92, 54], leaf: [58, 150, 74], leaf2: [104, 186, 86], flower: [244, 140, 180], rock: [150, 146, 138], rock2: [186, 182, 172], egg: [240, 232, 208], bone: [236, 230, 208] };
function bPlant(mode, kind, seed, k) {
  const ps = plantParts(kind, seed, 0), box = boxOf(ps); box.fy = 0; box.cx = (box.x0 + box.x1) / 2;
  const hgt = box.y1, burnt = kind === 'deadtree' || kind === 'stump';
  if (mode === 'brick') {
    const cell = hgt / (PLANTS[kind].low ? 5 : 13), I = { trunk: 1, leaf: 2, leaf2: 3, flower: 4, rock: 5, rock2: 6, egg: 7, bone: 7 };
    return brickSprite(ps, box, k, 1, cell, p => I[p.t] || 2, [0, burnt ? [70, 60, 56] : [150, 96, 56], [40, 150, 70], [96, 190, 80], [246, 120, 170], [150, 148, 144], [186, 184, 178], [244, 240, 226]],
      (line, set, st) => { if (st === 0) for (const p of ps) if (p.l) line(p.l, I[p.t] || 2); }, 0.5);
  }
  const card = mode === 'card', m = card ? Math.max(1.5, hgt * k * 0.03) : 0;
  return sprite(box, k, 1, Math.ceil(m * 2) + 3, hgt * k * 0.08, (g, T, W, H) => {
    const bx = T.x + box.cx * k, rx = Math.max((box.x1 - box.x0) * k * 0.3, hgt * k * 0.12), ry = hgt * k * 0.035;
    const col = p => css(burnt && p.t === 'trunk' ? [72, 62, 58] : PLANTPAL[p.t] || PLANTPAL.leaf);
    if (card) { g.save(); g.translate(m * 0.4, m * 0.4); fatten(g, ps, T, '#8f6c42', m * 2); g.restore(); fatten(g, ps, T, '#f5efe0', m * 2); g.fillStyle = '#f5efe0'; g.fillRect(bx - rx, T.y - m, rx * 2, hgt * k * 0.06 + m); }
    else { g.fillStyle = mode === 'glow' ? '#3a4a40' : '#3d7a48'; g.beginPath(); g.ellipse(bx, T.y + ry * 0.4, rx, ry, 0, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,255,255,.2)'; g.beginPath(); g.ellipse(bx, T.y + ry * 0.2, rx * 0.9, ry * 0.7, 0, PI, TAU); g.fill(); }
    const fb = buffer(W, H), c = fb.ctx; c.lineJoin = c.lineCap = 'round';
    paint(c, ps, T, col, card ? '#3a2a26' : 'rgba(20,50,30,.45)', Math.max(0.5, hgt * k * 0.008));
    c.globalCompositeOperation = 'source-atop'; topLight(c, W, H, card ? 0.08 : 0.3, card ? 0.1 : 0.32);
    g.drawImage(fb.canvas, 0, 0);
  });
}
function shadowOf(S) {
  if (S.sh) return S.sh;
  const d = 5, b = buffer(S.W / d + 2, S.H / d + 2), g = b.ctx;
  g.drawImage(S.c, 1, 1, S.W / d, S.H / d); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#000'; g.fillRect(0, 0, b.canvas.width, b.canvas.height);
  return S.sh = b.canvas;
}
function haloOf(S, col) {
  if (S.halo) return S.halo;
  const d = 6, m = Math.max(S.W, S.H) * 0.1, w = (S.W + m * 2) / d, h = (S.H + m * 2) / d, a = buffer(w, h), b = buffer(w / 3, h / 3);
  a.ctx.drawImage(S.c, m / d, m / d, S.W / d, S.H / d); a.ctx.globalCompositeOperation = 'source-in'; a.ctx.fillStyle = col; a.ctx.fillRect(0, 0, w, h);
  b.ctx.drawImage(a.canvas, 0, 0, b.canvas.width, b.canvas.height);
  a.ctx.globalCompositeOperation = 'source-over'; a.ctx.globalAlpha = 0.9; a.ctx.drawImage(b.canvas, 0, 0, a.canvas.width, a.canvas.height);
  S.haloM = m; return S.halo = a.canvas;
}

// ---------------------------------------------------------------- the room
// per mode: wall, table top, play mat [half width, far z, near z, scrolls], where the feet line sits, lamp, clutter kinds
const MODES = {
  plastic: { wall: 'stripes', ground: 'desk', mat: [1.0, 0.93, -0.34], lamp: 1, clutter: ['block', 'marble', 'crayon'] },
  pull: { wall: 'skirt', ground: 'floor', mat: [9, 0.6, -0.26, 1], scroll: 1, clutter: ['block', 'marble', 'block', 'crayon'] },
  tin: { wall: 'dado', ground: 'cloth', mat: [0.92, 0.84, -0.3], lamp: 1, clutter: ['marble', 'block', 'crayon', 'key'] },
  brick: { wall: 'clouds', ground: 'plate', clutter: ['brick', 'brick', 'marble', 'brick'] },
  plush: { wall: 'dots', ground: 'quilt', clutter: ['block', 'button', 'marble', 'button'] },
  balloon: { wall: 'party', ground: 'party', mat: [9, 0.7, -0.22, 1], clutter: ['confetti', 'marble', 'block', 'confetti'] },
  card: { wall: 'box', ground: 'box', clutter: ['crayon', 'crayon', 'marble'], near: 1 },
  bath: { wall: 'tiles', ground: 'water', clutter: ['foam', 'bubble', 'duck', 'foam', 'bubble', 'foam'], noShadow: 1, noPlants: 1 },
  glow: { wall: 'night', ground: 'shelf', mat: [0.86, 0.86, -0.2], foot: 0.8, zNear: -0.2, clutter: ['marble', 'block', 'crayon'] },
};
function view(f, M) {
  const { w, h } = f, fit = clamp(w / h / 1.55, 0.5, 1), zoom = lerp(0.74, 1.3, f.p.scale) * fit;
  const Y0 = h * 0.56, Yf = h * (M.foot || 0.86), U = h * zoom, cx = w / 2;
  const sc = z => 1 - 0.5 * z, sy = z => Yf + (Y0 - Yf) * z;
  return { w, h, Y0, Yf, U, cx, zoom, sc, sy, zB: -(h - Yf) / (Yf - Y0) - 0.03 };
}
function quad(ctx, V, a, b, z0, z1) {
  ctx.beginPath(); ctx.moveTo(V.cx + a * V.U * V.sc(z0), V.sy(z0)); ctx.lineTo(V.cx + b * V.U * V.sc(z0), V.sy(z0));
  ctx.lineTo(V.cx + b * V.U * V.sc(z1), V.sy(z1)); ctx.lineTo(V.cx + a * V.U * V.sc(z1), V.sy(z1)); ctx.closePath();
}
function windowAt(ctx, x, y, ww, wh, light, h) {
  const d = daylight(light), g = ctx.createLinearGradient(0, y, 0, y + wh);
  g.addColorStop(0, css(mix(mix([14, 20, 48], [92, 160, 228], d.day), [236, 150, 100], d.dusk * 0.5))); g.addColorStop(1, css(mix(mix([34, 40, 76], [200, 228, 246], d.day), [255, 204, 150], d.dusk * 0.7)));
  ctx.fillStyle = g; ctx.fillRect(x, y, ww, wh);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, ww, wh); ctx.clip();
  if (d.night > 0.3) { ctx.fillStyle = `rgba(255,255,255,${d.night})`; for (let i = 0; i < 26; i++) ctx.fillRect(x + hash(i, 1) * ww, y + hash(i, 2) * wh, h * 0.004, h * 0.004);
    ctx.fillStyle = `rgba(250,246,220,${d.night})`; ctx.beginPath(); ctx.arc(x + ww * 0.68, y + wh * 0.3, wh * 0.11, 0, TAU); ctx.fill(); }
  else { ctx.fillStyle = `rgba(255,255,255,${0.75 * d.day})`; for (const [a, b, r] of [[0.25, 0.35, 0.12], [0.36, 0.3, 0.15], [0.47, 0.36, 0.11], [0.72, 0.6, 0.1], [0.82, 0.57, 0.12]]) { ctx.beginPath(); ctx.ellipse(x + a * ww, y + b * wh, r * ww, r * wh * 0.5, 0, 0, TAU); ctx.fill(); } }
  ctx.restore();
  ctx.strokeStyle = '#fbf8f0'; ctx.lineWidth = h * 0.014; ctx.strokeRect(x, y, ww, wh); ctx.lineWidth = h * 0.008; ctx.beginPath(); ctx.moveTo(x + ww / 2, y); ctx.lineTo(x + ww / 2, y + wh); ctx.moveTo(x, y + wh * 0.5); ctx.lineTo(x + ww, y + wh * 0.5); ctx.stroke();
  ctx.fillStyle = '#efe9da'; ctx.fillRect(x - h * 0.02, y + wh, ww + h * 0.04, h * 0.018);
}
// the wall above the far edge of the table (only painted when no sky or volcano will show there)
function paintWall(ctx, f, V, M, st) {
  const { w, h } = V, Y0 = V.Y0 + 1, L = f.p.light, off = -st.scroll * V.U * 0.5;
  const fill = c => { ctx.fillStyle = c; ctx.fillRect(0, 0, w, Y0); };
  switch (M.wall) {
    case 'stripes': { fill('#efe3c8'); const s = h * 0.085; ctx.fillStyle = '#e2d1ac'; for (let x = -s / 2; x < w; x += s) ctx.fillRect(x, 0, s * 0.5, Y0);
      ctx.fillStyle = 'rgba(196,120,90,.5)'; for (let x = -s / 2; x < w; x += s) ctx.fillRect(x + s * 0.72, 0, s * 0.05, Y0);
      windowAt(ctx, w * 0.64, h * 0.07, w * 0.27, h * 0.36, L, h); break; }
    case 'skirt': { fill('#d4e3da'); const s = h * 0.11; ctx.fillStyle = 'rgba(120,160,150,.5)';
      for (let j = 0; j < 5; j++) for (let x = wrap(off + (j % 2) * s / 2, -s, 0); x < w + s; x += s) { const y = j * s + s * 0.3; ctx.beginPath(); ctx.moveTo(x, y - s * 0.16); ctx.lineTo(x + s * 0.12, y); ctx.lineTo(x, y + s * 0.16); ctx.lineTo(x - s * 0.12, y); ctx.fill(); }
      ctx.fillStyle = '#f7f3ea'; ctx.fillRect(0, Y0 - h * 0.085, w, h * 0.085); ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(0, Y0 - h * 0.085, w, h * 0.006); ctx.fillRect(0, Y0 - h * 0.012, w, h * 0.012); break; }
    case 'dado': { fill('#f2e8d2'); const y = Y0 - h * 0.24; ctx.fillStyle = '#86aa9c'; ctx.fillRect(0, y, w, Y0 - y); ctx.fillStyle = 'rgba(0,0,0,.1)'; for (let x = h * 0.03; x < w; x += h * 0.09) ctx.fillRect(x, y, h * 0.006, Y0 - y);
      ctx.fillStyle = '#fbf6ea'; ctx.fillRect(0, y - h * 0.018, w, h * 0.026); ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(0, y + h * 0.008, w, h * 0.006);
      ctx.fillStyle = '#7a5236'; ctx.fillRect(w * 0.62, h * 0.06, w * 0.2, h * 0.17); ctx.fillStyle = '#f4ecd6'; ctx.fillRect(w * 0.62 + h * 0.015, h * 0.075, w * 0.2 - h * 0.03, h * 0.14);
      ctx.fillStyle = '#c8553d'; ctx.beginPath(); ctx.moveTo(w * 0.66, h * 0.2); ctx.lineTo(w * 0.72, h * 0.1); ctx.lineTo(w * 0.78, h * 0.2); ctx.fill(); ctx.fillStyle = '#f3ead0'; ctx.beginPath(); ctx.arc(w * 0.72, h * 0.085, h * 0.016, 0, TAU); ctx.fill(); break; }
    case 'clouds': { const g = ctx.createLinearGradient(0, 0, 0, Y0); g.addColorStop(0, '#9fd0f2'); g.addColorStop(1, '#d3ebfa'); fill(g); ctx.fillStyle = 'rgba(255,255,255,.85)';
      for (const [a, b, r] of [[0.16, 0.16, 0.07], [0.5, 0.1, 0.05], [0.8, 0.22, 0.08], [0.36, 0.36, 0.045]]) for (const [dx, dy, k] of [[-0.9, 0.1, 0.55], [-0.3, -0.25, 0.75], [0.35, -0.2, 0.7], [0.9, 0.15, 0.5], [0, 0.25, 0.6]]) { ctx.beginPath(); ctx.arc(a * w + dx * r * h, b * h + dy * r * h, k * r * h, 0, TAU); ctx.fill(); } break; }
    case 'dots': { fill('#f6e2e6'); const s = h * 0.075; ctx.fillStyle = 'rgba(255,255,255,.75)'; for (let j = 0; j * s < Y0; j++) for (let x = (j % 2) * s / 2; x < w + s; x += s) { ctx.beginPath(); ctx.arc(x, j * s + s * 0.4, s * 0.13, 0, TAU); ctx.fill(); }
      const y = h * 0.3; ctx.fillStyle = '#b98558'; ctx.fillRect(w * 0.06, y, w * 0.88, h * 0.035); ctx.fillStyle = '#a57448'; for (let x = w * 0.08; x < w * 0.93; x += w * 0.072) ctx.fillRect(x, y, w * 0.022, Y0 - y);
      ctx.fillStyle = '#8a5f3a'; ctx.fillRect(w * 0.05, y - h * 0.04, w * 0.03, Y0 - y + h * 0.04); ctx.fillRect(w * 0.92, y - h * 0.04, w * 0.03, Y0 - y + h * 0.04); break; }
    case 'party': { fill('#fdf2d8'); ctx.fillStyle = 'rgba(244,196,120,.35)'; const s = h * 0.13; for (let x = 0; x < w; x += s) ctx.fillRect(x, 0, s * 0.5, Y0);
      const sway = windX(f.p.wind) * Math.sin(f.t * 1.3) * h * 0.004, cols = ['#ef5b5b', '#f7c948', '#4fb0e8', '#6cc56a', '#b678e0'];
      const yy = x => h * 0.05 + Math.sin(x / w * PI) * h * 0.09; ctx.strokeStyle = '#8a7a66'; ctx.lineWidth = h * 0.004; ctx.beginPath(); for (let i = 0; i <= 24; i++) ctx.lineTo(i / 24 * w, yy(i / 24 * w)); ctx.stroke();
      for (let i = 0; i < 15; i++) { const x = (i + 0.5) / 15 * w, y = yy(x), s2 = w / 15 * 0.42; ctx.fillStyle = cols[i % 5]; ctx.beginPath(); ctx.moveTo(x - s2, y); ctx.lineTo(x + s2, y); ctx.lineTo(x + sway * (1 + i % 3), y + s2 * 2.1); ctx.fill(); } break; }
    case 'box': { const mg = w * 0.07, tm = h * 0.07, g = ctx.createLinearGradient(0, tm, 0, Y0); g.addColorStop(0, '#7ec3ee'); g.addColorStop(1, '#cdeaf6'); fill('#b8935f'); ctx.fillStyle = g; ctx.fillRect(mg, tm, w - mg * 2, Y0 - tm);
      ctx.save(); ctx.beginPath(); ctx.rect(mg, tm, w - mg * 2, Y0 - tm); ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = h * 0.02; for (let i = 0; i < 16; i++) { const x = hash(i, 4) * w, y = tm + hash(i, 8) * (Y0 - tm) * 0.8; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + h * 0.16, y - h * 0.01); ctx.stroke(); }
      const sx = w * 0.2, sy = h * 0.19; ctx.strokeStyle = '#f6b93b'; ctx.lineWidth = h * 0.008; for (let i = 0; i < 12; i++) { const a = i / 12 * TAU + 0.2; ctx.beginPath(); ctx.moveTo(sx + Math.cos(a) * h * 0.065, sy + Math.sin(a) * h * 0.065); ctx.lineTo(sx + Math.cos(a) * h * (0.085 + (i % 2) * 0.02), sy + Math.sin(a) * h * (0.085 + (i % 2) * 0.02)); ctx.stroke(); }
      ctx.fillStyle = '#f9d24a'; ctx.beginPath(); ctx.arc(sx, sy, h * 0.052, 0, TAU); ctx.fill();
      ctx.fillStyle = '#6fae62'; ctx.beginPath(); ctx.moveTo(0, Y0); for (let i = 0; i <= 20; i++) ctx.lineTo(i / 20 * w, Y0 - h * (0.05 + 0.035 * Math.sin(i * 0.9) + 0.02 * Math.sin(i * 2.3))); ctx.lineTo(w, Y0); ctx.fill();
      const vx = w * 0.72, vy = Y0; ctx.fillStyle = '#8a5a44'; ctx.beginPath(); ctx.moveTo(vx - h * 0.2, vy); ctx.lineTo(vx - h * 0.04, vy - h * 0.2); ctx.lineTo(vx + h * 0.04, vy - h * 0.2); ctx.lineTo(vx + h * 0.2, vy); ctx.fill();
      ctx.fillStyle = '#e8553a'; ctx.beginPath(); ctx.moveTo(vx - h * 0.04, vy - h * 0.2); ctx.lineTo(vx - h * 0.055, vy - h * 0.13); ctx.lineTo(vx - h * 0.02, vy - h * 0.16); ctx.lineTo(vx + h * 0.005, vy - h * 0.1); ctx.lineTo(vx + h * 0.025, vy - h * 0.16); ctx.lineTo(vx + h * 0.05, vy - h * 0.14); ctx.lineTo(vx + h * 0.04, vy - h * 0.2); ctx.fill();
      for (let i = 0; i < 5; i++) cotton(ctx, vx + Math.sin(i * 1.7 + f.t * 0.3) * h * 0.02 + i * h * 0.012, vy - h * (0.23 + i * 0.045) + Math.sin(f.t * 0.7 + i) * h * 0.004, h * (0.03 + i * 0.006));
      ctx.restore(); break; }
    case 'tiles': { fill('#e9f4f5'); const s = h * 0.094; for (let j = 0; j * s < Y0; j++) for (let i = 0; i * s < w; i++) { const r = hash(i, j, 3); if (j === 3 || r < 0.16) { ctx.fillStyle = j === 3 ? (i % 2 ? '#7cc4cf' : '#a7dbe1') : r < 0.08 ? '#c5e6ea' : '#d8eef0'; ctx.fillRect(i * s, j * s, s, s); } }
      ctx.fillStyle = 'rgba(255,255,255,.5)'; for (let j = 0; j * s < Y0; j++) for (let i = 0; i * s < w; i++) ctx.fillRect(i * s + s * 0.08, j * s + s * 0.08, s * 0.5, s * 0.06);
      ctx.fillStyle = '#b9cdd2'; for (let x = 0; x < w; x += s) ctx.fillRect(x, 0, Math.max(1, h * 0.004), Y0); for (let y = 0; y < Y0; y += s) ctx.fillRect(0, y, w, Math.max(1, h * 0.004)); break; }
    default: { fill('#aab6d2'); windowAt(ctx, w * 0.08, h * 0.06, w * 0.24, h * 0.38, L, h);
      ctx.fillStyle = '#8d6a4a'; ctx.fillRect(w * 0.52, h * 0.2, w * 0.4, h * 0.022); ctx.fillStyle = 'rgba(0,0,0,.15)'; ctx.fillRect(w * 0.52, h * 0.222, w * 0.4, h * 0.012);
      const bc = ['#c8553d', '#4c7fb0', '#e0b84a', '#5f9a68', '#8a68b0', '#d9824a']; let x = w * 0.55; for (let i = 0; i < 9; i++) { const bw = h * (0.022 + hash(i, 5) * 0.02), bh = h * (0.09 + hash(i, 9) * 0.05); ctx.fillStyle = bc[i % 6]; ctx.fillRect(x, h * 0.2 - bh, bw, bh); x += bw + h * 0.003; } }
  }
}
function cotton(ctx, x, y, r) {
  for (const [dx, dy, k] of [[-0.7, 0.2, 0.6], [0.6, 0.25, 0.62], [-0.2, -0.3, 0.75], [0.35, -0.25, 0.6], [0, 0.3, 0.7]]) {
    ctx.fillStyle = 'rgba(160,170,190,.5)'; ctx.beginPath(); ctx.arc(x + dx * r + r * 0.08, y + dy * r + r * 0.1, k * r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fbfbf8'; ctx.beginPath(); ctx.arc(x + dx * r, y + dy * r, k * r, 0, TAU); ctx.fill(); }
}
let studStrip = null;
function paintGround(ctx, f, V, M, st, E) {
  const { w, h, Y0, U, cx, sc, sy, zB } = V, bot = h + 2 - Y0, mc = matRGB(E), sX = st.scroll;
  const line = (X, z0, z1) => { ctx.moveTo(cx + X * U * sc(z0), sy(z0)); ctx.lineTo(cx + X * U * sc(z1), sy(z1)); };
  const grad = (a, b) => { const g = ctx.createLinearGradient(0, Y0, 0, h); g.addColorStop(0, a); g.addColorStop(1, b); ctx.fillStyle = g; ctx.fillRect(0, Y0, w, bot); };
  switch (M.ground) {
    case 'desk': case 'shelf': {
      grad(M.ground === 'shelf' ? '#a47648' : '#b88652', M.ground === 'shelf' ? '#c09058' : '#d6a56c');
      ctx.strokeStyle = 'rgba(84,46,18,.3)'; ctx.lineWidth = Math.max(1, h * 0.003); ctx.beginPath(); for (let X = -4.41; X <= 4.5; X += 0.42) line(X, 1, zB); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,232,196,.16)'; ctx.lineWidth = Math.max(1, h * 0.002); ctx.beginPath(); for (let i = 0; i < 40; i++) { const X = (hash(i, 3) - 0.5) * 6, z0 = hash(i, 5) * 1.3 - 0.3; line(X, z0, z0 - 0.2 - hash(i, 7) * 0.3); } ctx.stroke();
      ctx.strokeStyle = 'rgba(84,46,18,.14)'; ctx.beginPath(); for (let i = 0; i < 30; i++) { const X = (hash(i, 13) - 0.5) * 6, z0 = hash(i, 15) * 1.3 - 0.3; line(X, z0, z0 - 0.15 - hash(i, 17) * 0.3); } ctx.stroke();
      break; }
    case 'floor': {
      grad('#b98a5a', '#d2a674'); ctx.strokeStyle = 'rgba(84,46,18,.32)'; ctx.lineWidth = Math.max(1, h * 0.003); ctx.beginPath();
      for (let j = 0; j < 10; j++) { const z = 1 - j * 0.16; if (z < zB) break; ctx.moveTo(0, sy(z)); ctx.lineTo(w, sy(z)); for (let n = 0; n < 6; n++) line(wrap(hash(j, n) * 5 - sX, -2.5, 2.5), z, z - 0.16); } ctx.stroke(); break; }
    case 'cloth': {
      ctx.fillStyle = '#f6f1e6'; ctx.fillRect(0, Y0, w, bot); ctx.fillStyle = 'rgba(206,52,48,.34)';
      for (let i = -24; i < 24; i += 2) { quad(ctx, V, i * 0.11, (i + 1) * 0.11, 1, zB); ctx.fill(); }
      for (let j = 0; j < 14; j += 2) { const z = 1 - j * 0.11; if (z < zB) break; ctx.fillRect(0, sy(z), w, sy(z - 0.11) - sy(z)); } break; }
    case 'plate': {
      const c = mix(mc, [226, 214, 180], 0.42); grad(css(lit(c, 0.9)), css(c));
      const pitch = Math.max(4, Math.round(U * 0.046)), N = 96;
      if (!studStrip || studStrip.pitch !== pitch) { const b = buffer(N * pitch, Math.ceil(pitch * 0.62)), g = b.ctx, hh = b.canvas.height;
        for (let i = 0; i < N; i++) { const x = (i + 0.5) * pitch; g.fillStyle = 'rgba(0,0,20,.13)'; g.beginPath(); g.ellipse(x + pitch * 0.04, hh * 0.62, pitch * 0.32, hh * 0.34, 0, 0, TAU); g.fill();
          g.fillStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.ellipse(x, hh * 0.42, pitch * 0.3, hh * 0.32, 0, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,255,255,.2)'; g.beginPath(); g.ellipse(x - pitch * 0.06, hh * 0.32, pitch * 0.16, hh * 0.12, 0, 0, TAU); g.fill(); }
        studStrip = { c: b.canvas, pitch }; }
      const S = studStrip, dz = pitch / (V.Yf - Y0) * 0.56;
      for (let z = 0.97; z > zB; z -= dz * sc(z)) { const s = sc(z); ctx.drawImage(S.c, cx - S.c.width / 2 * s, sy(z) - S.c.height * s * 0.5, S.c.width * s, S.c.height * s); }
      break; }
    case 'quilt': {
      const pal = ['#f4cdd4', '#c5e3da', '#fbe8b2', '#cfc8ec', css(lit(mc, 1.45))], zs = [1, 0.8, 0.6, 0.4, 0.2, 0, -0.22, zB];
      for (let j = 0; j < zs.length - 1; j++) for (let i = -9; i < 9; i++) { quad(ctx, V, i * 0.36, (i + 1) * 0.36, zs[j], zs[j + 1]); ctx.fillStyle = pal[Math.floor(hash(i, j, 9) * 4.99)]; ctx.fill(); }
      ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = Math.max(1, h * 0.003); ctx.setLineDash([h * 0.012, h * 0.01]); ctx.beginPath();
      for (let i = -9; i <= 9; i++) line(i * 0.36, 1, zB); for (const z of zs) { ctx.moveTo(0, sy(z)); ctx.lineTo(w, sy(z)); } ctx.stroke(); ctx.setLineDash([]);
      const g = ctx.createLinearGradient(0, Y0, 0, h); g.addColorStop(0, 'rgba(120,90,110,.16)'); g.addColorStop(0.4, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, Y0, w, bot); break; }
    case 'party': {
      grad('#f1eee6', '#fdfcf8'); ctx.strokeStyle = 'rgba(160,150,140,.2)'; ctx.lineWidth = Math.max(1, h * 0.003); ctx.beginPath(); for (let X = -4; X <= 4; X += 1) line(wrap(X - sX, -4, 4), 1, zB); ctx.stroke(); break; }
    case 'box': {
      grad(css(lit(mc, 0.9)), css(lit(mc, 1.12)));
      for (let i = 0; i < 46; i++) { const X = (hash(i, 31) - 0.5) * 3.6, z = hash(i, 33) * 1.4 - 0.4, s = U * sc(z); ctx.fillStyle = hash(i, 35) < 0.5 ? 'rgba(255,255,220,.13)' : 'rgba(40,40,0,.09)'; ctx.beginPath(); ctx.ellipse(cx + X * s, sy(z), s * (0.05 + hash(i, 37) * 0.08), s * 0.012, 0, 0, TAU); ctx.fill(); }
      // the inside of the shoebox: side walls and lid
      const mg = w * 0.07, tm = h * 0.07, yl = Y0 + (V.Yf - Y0) * mg / (cx - mg);
      for (const sgn of [0, 1]) { const X = x => sgn ? w - x : x; ctx.fillStyle = sgn ? '#b08a58' : '#a37e4e'; ctx.beginPath(); ctx.moveTo(X(0), 0); ctx.lineTo(X(mg), tm); ctx.lineTo(X(mg), Y0); ctx.lineTo(X(0), yl); ctx.fill();
        ctx.strokeStyle = 'rgba(70,45,20,.22)'; ctx.lineWidth = Math.max(1, h * 0.002); ctx.beginPath(); for (let i = 1; i < 6; i++) { ctx.moveTo(X(mg * i / 6), tm * i / 6); ctx.lineTo(X(mg * i / 6), lerp(yl, Y0, i / 6)); } ctx.stroke(); }
      ctx.fillStyle = '#8f6c42'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w - mg, tm); ctx.lineTo(mg, tm); ctx.fill();
      if (!f.backdrop) for (const [a, b, r, ph] of [[0.3, 0.2, 0.05, 0], [0.52, 0.15, 0.04, 2], [0.86, 0.24, 0.045, 4]]) { const x = a * w + Math.sin(f.t * 0.6 + ph) * h * 0.006 * st.wob, y = b * h; ctx.strokeStyle = 'rgba(90,90,90,.6)'; ctx.lineWidth = Math.max(1, h * 0.002); ctx.beginPath(); ctx.moveTo(a * w, tm * 0.7); ctx.lineTo(x, y); ctx.stroke(); cotton(ctx, x, y, r * h); }
      break; }
    case 'water': {
      const a = mix([150, 214, 228], mc, 0.12), b = mix([64, 168, 204], mc, 0.12); grad(css(a), css(b));
      ctx.lineWidth = Math.max(1, h * 0.004);
      for (let j = 0; j < 9; j++) { const z = 0.94 - j * 0.16; if (z < zB) break; const y = sy(z), s = sc(z); ctx.strokeStyle = `rgba(255,255,255,${0.2 + 0.05 * (j % 3)})`; ctx.beginPath();
        for (let x = -s * 20; x <= w + 20; x += w / 40) ctx.lineTo(x, y + Math.sin(x / (h * 0.09 * s) + f.t * (1 + j * 0.13) + j * 2) * h * 0.006 * s * (0.5 + st.wob)); ctx.stroke(); }
      ctx.fillStyle = '#fbfdfd'; ctx.fillRect(0, Y0 - h * 0.004, w, h * 0.03); ctx.fillStyle = 'rgba(80,120,140,.25)'; ctx.fillRect(0, Y0 + h * 0.02, w, h * 0.012); break; }
  }
  if (M.ground !== 'water' && M.ground !== 'box') { ctx.fillStyle = 'rgba(255,244,220,.3)'; ctx.fillRect(0, Y0, w, Math.max(1, h * 0.004)); }
}
function paintMat(ctx, f, V, M, E, st) {
  const { cx, U, sc, sy, h } = V, c = matRGB(E), [xm, zf, zn, scr] = M.mat, sX = scr ? st.scroll : 0;
  quad(ctx, V, -xm, xm, zf, zn); ctx.save(); ctx.translate(0, h * 0.006); ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fill(); ctx.restore();
  ctx.fillStyle = css(c); ctx.fill();
  const b = 0.045; ctx.strokeStyle = css(lit(c, 1.4), 0.75); ctx.lineWidth = Math.max(1, h * 0.005);
  if (scr) { ctx.beginPath(); for (const z of [zf - b, zn + b]) { ctx.moveTo(0, sy(z)); ctx.lineTo(V.w, sy(z)); } ctx.stroke(); } else { quad(ctx, V, -xm + b, xm - b, zf - b * 1.1, zn + b * 1.1); ctx.stroke(); }
  const dk = css(lit(c, 0.72), 0.55), lt = css(lit(c, 1.3), 0.6), half = scr ? 2.4 : xm - 0.12, fc = ['#f7a8c4', '#fff4c8', '#ffffff', '#f6d04a'];
  for (let i = 0; i < 40; i++) {
    const X = scr ? wrap(hash(i, 11) * 4.8 - sX, -2.4, 2.4) : (hash(i, 11) * 2 - 1) * half, z = lerp(zn + 0.09, zf - 0.09, hash(i, 17)), kind = hash(i, 23), s = U * sc(z) * 0.03;
    ctx.save(); ctx.translate(cx + X * U * sc(z), sy(z)); ctx.scale(1, 0.5);
    if (hash(i, 29) < E.flowers * 0.55) { ctx.fillStyle = fc[i % 4]; for (let j = 0; j < 5; j++) { ctx.beginPath(); ctx.arc(Math.cos(j * 1.257) * s * 0.55, Math.sin(j * 1.257) * s * 0.55, s * 0.36, 0, TAU); ctx.fill(); } ctx.fillStyle = '#e8963a'; ctx.beginPath(); ctx.arc(0, 0, s * 0.3, 0, TAU); ctx.fill(); }
    else if (kind < 0.4 + E.ferns * 0.4) { ctx.strokeStyle = i % 2 ? lt : dk; ctx.lineWidth = s * 0.3; ctx.lineCap = 'round'; ctx.beginPath(); for (let j = -2; j <= 2; j++) { ctx.moveTo(0, 0); ctx.quadraticCurveTo(j * s * 0.5, -s * 1.2, j * s * 1.1, -s * (1.5 - Math.abs(j) * 0.4)); } ctx.stroke(); }
    else if (kind < 0.72) { ctx.fillStyle = dk; ctx.rotate(hash(i, 41) * 2 - 1); for (const j of [-1, 0, 1]) { ctx.beginPath(); ctx.ellipse(j * s * 0.5, -s * (0.9 - Math.abs(j) * 0.25), s * 0.2, s * 0.55, j * 0.5, 0, TAU); ctx.fill(); } ctx.beginPath(); ctx.arc(0, 0, s * 0.42, 0, TAU); ctx.fill(); }
    else { ctx.fillStyle = dk; ctx.beginPath(); ctx.ellipse(0, 0, s * (0.6 + hash(i, 43)), s * 0.6, 0, 0, TAU); ctx.fill(); }
    ctx.restore();
  }
  if (!scr) { const z = zn + 0.105, fs = U * sc(z) * 0.036; ctx.save(); ctx.translate(cx, sy(z)); ctx.scale(1, 0.6); ctx.font = `bold ${fs}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = css(lit(c, 0.55), 0.8); ctx.fillText(`${E.name}  ·  ${E.span}`.toUpperCase(), 0, 0); ctx.restore(); }
}

// ---------------------------------------------------------------- things left lying about
const BLOCKC = ['#e2543e', '#3f8fd4', '#f3bd3a', '#57ad5c', '#9a68c4', '#ee8a3a'], LET = 'DINOSAURTREX';
function drawClutter(ctx, kind, x, y, s, i, V, t) {
  const r1 = hash(i, 51), r2 = hash(i, 53), side = x < V.cx ? 1 : -1;
  const shadow = (rx, ry = rx * 0.3, dy = 0) => { ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(x + rx * 0.2, y + dy, rx, ry, 0, 0, TAU); ctx.fill(); };
  switch (kind) {
    case 'block': { const c = BLOCKC[i % 6], ox = s * 0.24 * side, oy = s * 0.3, a = x - s / 2, b = x + s / 2, top = y - s;
      shadow(s * 0.75, s * 0.18);
      ctx.fillStyle = css(lit(c, 1.3)); ctx.beginPath(); ctx.moveTo(a, top); ctx.lineTo(b, top); ctx.lineTo(b + ox, top - oy); ctx.lineTo(a + ox, top - oy); ctx.fill();
      const e = side > 0 ? b : a; ctx.fillStyle = css(lit(c, 0.66)); ctx.beginPath(); ctx.moveTo(e, top); ctx.lineTo(e + ox, top - oy); ctx.lineTo(e + ox, y - oy); ctx.lineTo(e, y); ctx.fill();
      ctx.fillStyle = c; ctx.fillRect(a, top, s, s); ctx.strokeStyle = css(lit(c, 1.35)); ctx.lineWidth = s * 0.06; ctx.strokeRect(a + s * 0.11, top + s * 0.11, s * 0.78, s * 0.78);
      ctx.fillStyle = '#fff6e2'; ctx.font = `bold ${s * 0.6}px Georgia,serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(LET[i % LET.length], x, top + s * 0.54); break; }
    case 'marble': { const r = s * 0.3, hue = r1 * 360, cy = y - r; shadow(r * 1.1, r * 0.3);
      const g = ctx.createRadialGradient(x - r * 0.35, cy - r * 0.4, r * 0.05, x, cy, r); g.addColorStop(0, `hsl(${hue},80%,82%)`); g.addColorStop(0.5, `hsl(${hue},75%,52%)`); g.addColorStop(1, `hsl(${hue + 20},70%,26%)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, cy, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = `hsla(${hue + 150},90%,80%,.7)`; ctx.lineWidth = r * 0.22; ctx.beginPath(); ctx.arc(x + r * 0.1, cy + r * 0.5, r * 0.6, PI * 1.1, PI * 1.8); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(x - r * 0.38, cy - r * 0.42, r * 0.16, 0, TAU); ctx.fill(); break; }
    case 'crayon': { const L = s * 1.7, rc = s * 0.13, c = BLOCKC[(i * 5 + 2) % 6], ang = (r1 - 0.5) * 0.9; shadow(L * 0.5, rc * 0.9, rc * 0.4);
      ctx.save(); ctx.translate(x, y - rc); ctx.rotate(ang);
      ctx.fillStyle = c; ctx.fillRect(-L / 2, -rc, L * 0.84, rc * 2); ctx.beginPath(); ctx.moveTo(L * 0.34, -rc); ctx.lineTo(L / 2, -rc * 0.25); ctx.lineTo(L / 2, rc * 0.25); ctx.lineTo(L * 0.34, rc); ctx.fill();
      ctx.fillStyle = css(lit(c, 1.5)); ctx.fillRect(-L * 0.34, -rc, L * 0.52, rc * 2); ctx.fillStyle = css(lit(c, 0.6)); ctx.fillRect(-L * 0.3, -rc, L * 0.02, rc * 2); ctx.fillRect(L * 0.12, -rc, L * 0.02, rc * 2);
      ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fillRect(-L / 2, -rc * 0.75, L * 0.84, rc * 0.4); ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(-L / 2, rc * 0.45, L * 0.84, rc * 0.55); ctx.restore(); break; }
    case 'brick': { const c = BLOCKC[i % 6], n = 2 + (i % 3), cw = s * 0.42, bw = n * cw, bh = s * 0.46, a = x - bw / 2; shadow(bw * 0.6, s * 0.12);
      ctx.fillStyle = c; ctx.fillRect(a, y - bh, bw, bh); for (let j = 0; j < n; j++) ctx.fillRect(a + (j + 0.2) * cw, y - bh - s * 0.1, cw * 0.6, s * 0.11);
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(a, y - bh, bw, bh * 0.14); for (let j = 0; j < n; j++) ctx.fillRect(a + (j + 0.2) * cw, y - bh - s * 0.1, cw * 0.6, s * 0.035);
      ctx.fillStyle = 'rgba(0,0,20,.25)'; ctx.fillRect(a, y - bh * 0.13, bw, bh * 0.13); break; }
    case 'button': { const r = s * 0.3, c = BLOCKC[(i * 3 + 1) % 6]; shadow(r * 1.1, r * 0.4);
      ctx.fillStyle = css(lit(c, 0.7)); ctx.beginPath(); ctx.ellipse(x, y - r * 0.12, r, r * 0.5, 0, 0, TAU); ctx.fill(); ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, y - r * 0.26, r, r * 0.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.4)'; for (const d of [-1, 1]) { ctx.beginPath(); ctx.ellipse(x + d * r * 0.28, y - r * 0.26, r * 0.1, r * 0.06, 0, 0, TAU); ctx.fill(); } break; }
    case 'confetti': { ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.5); for (let j = 0; j < 7; j++) { ctx.fillStyle = BLOCKC[(i + j) % 6]; ctx.save(); ctx.translate((hash(i, j, 3) - 0.5) * s * 3, (hash(i, j, 5) - 0.5) * s * 2); ctx.rotate(hash(i, j, 7) * 6); ctx.fillRect(-s * 0.12, -s * 0.07, s * 0.24, s * 0.14); ctx.restore(); } ctx.restore(); break; }
    case 'key': { shadow(s * 0.6, s * 0.1); ctx.save(); ctx.translate(x, y - s * 0.05); ctx.scale(1, 0.5); ctx.rotate(r1 * 3); ctx.strokeStyle = '#b9b3a2'; ctx.lineWidth = s * 0.12;
      for (const d of [-1, 1]) { ctx.beginPath(); ctx.ellipse(d * s * 0.3, 0, s * 0.26, s * 0.2, 0, 0, TAU); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, s * 0.7); ctx.stroke(); ctx.restore(); break; }
    case 'bubble': { const r = s * (0.14 + r2 * 0.2), yy = y - r * 0.5 + Math.sin(t * 1.3 + i) * s * 0.03; ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = Math.max(0.6, r * 0.1);
      ctx.beginPath(); ctx.arc(x, yy, r, 0, TAU); ctx.fill(); ctx.stroke(); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(x - r * 0.35, yy - r * 0.35, r * 0.2, 0, TAU); ctx.fill(); break; }
    case 'foam': { const yy = y + Math.sin(t * 1.1 + i) * s * 0.03; for (let j = 0; j < 9; j++) { const a = hash(i, j, 2) * TAU, d = hash(i, j, 4) * s * 0.7, r = s * (0.16 + hash(i, j, 6) * 0.2), bx = x + Math.cos(a) * d * 1.5, by = yy - r * 0.6 + Math.sin(a) * d * 0.25;
        ctx.fillStyle = 'rgba(190,220,232,.9)'; ctx.beginPath(); ctx.arc(bx + r * 0.08, by + r * 0.12, r, 0, TAU); ctx.fill(); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(bx, by, r, 0, TAU); ctx.fill(); } break; }
    case 'duck': { const d = side, yy = y + Math.sin(t * 1.5 + i) * s * 0.04, r = s * 0.42; ctx.save(); ctx.translate(x, yy); ctx.rotate(Math.sin(t * 1.1 + i) * 0.08);
      ctx.fillStyle = '#f4b92e'; ctx.beginPath(); ctx.ellipse(0, -r * 0.45, r * 1.15, r * 0.7, 0, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.moveTo(-d * r * 0.8, -r * 0.7); ctx.lineTo(-d * r * 1.5, -r * 1.15); ctx.lineTo(-d * r * 0.9, -r * 0.2); ctx.fill();
      ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.ellipse(0, -r * 0.55, r * 1.05, r * 0.6, 0, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.arc(d * r * 0.7, -r * 1.35, r * 0.58, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ef7d2a'; ctx.beginPath(); ctx.ellipse(d * r * 1.35, -r * 1.25, r * 0.34, r * 0.15, 0, 0, TAU); ctx.fill(); ctx.fillStyle = '#1a1612'; ctx.beginPath(); ctx.arc(d * r * 0.85, -r * 1.5, r * 0.09, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.ellipse(d * r * 0.5, -r * 1.6, r * 0.2, r * 0.1, -0.5 * d, 0, TAU); ctx.fill(); ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = Math.max(0.6, s * 0.03); ctx.beginPath(); ctx.ellipse(x, y, r * 1.4, r * 0.22, 0, 0, TAU); ctx.stroke(); break; }
  }
}
function drawBall(ctx, x, y, r, roll, shadowY) {
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(x + r * 0.2, shadowY, r * 1.05, r * 0.28, 0, 0, TAU); ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r); g.addColorStop(0, '#ff9a6a'); g.addColorStop(0.55, '#e2412c'); g.addColorStop(1, '#8a1c18');
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip(); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.translate(x, y); ctx.rotate(roll); ctx.fillStyle = 'rgba(255,214,74,.92)'; ctx.fillRect(-r, -r * 0.2, r * 2, r * 0.4);
  ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = i / 10 * TAU, rr = i % 2 ? r * 0.2 : r * 0.48; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr - r * 0.02); } ctx.fill(); ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.beginPath(); ctx.ellipse(x - r * 0.38, y - r * 0.45, r * 0.22, r * 0.13, -0.6, 0, TAU); ctx.fill();
}

// ---------------------------------------------------------------- how each kind of toy moves
// → { X (table units), lift (units of the toy's height), rot, sx, sy, face (−1..1: a paper-flat turn), dir, fr, leg, key }
function motion(mode, toy, i, t, en, wob, f) {
  const m = { X: toy.X, lift: 0, rot: 0, sx: 1, sy: 1, face: 1, dir: toy.dir, fr: 0, leg: 0, key: 0, e: 1 }, d = toy.dir;
  switch (mode) {
    case 'plastic': case 'glow': {
      if (toy.reach == null) { const T = mode === 'glow' ? 7 : 3.4, u = fract(t * en / T + i * 0.37), w = mode === 'glow' ? 0.1 : 0.24; if (u < w) { const a = u / w; m.lift = Math.sin(PI * a) * 0.1 * wob; m.rot = Math.sin(TAU * a * (mode === 'glow' ? 2 : 1)) * 0.07 * wob; } break; }
      const u = fract(t * en / 7.5), n = 3; let prog = 0, lift = 0, rot = 0;
      if (u < 0.44) { const hu = clamp(u / 0.44 * (n + 0.45) - 0.45 * (i % 2), 0, n), j = Math.min(n - 1, Math.floor(hu)), a = clamp((hu - j - 0.12) / 0.76); prog = (j + sm(a)) / n; lift = Math.sin(PI * a); rot = -Math.sin(TAU * a) * 0.08; }
      else if (u < 0.6) { const c = (u - 0.44) / 0.16; prog = 1 + 0.07 * Math.sin(c * PI * 3) * (1 - c); rot = Math.sin(c * PI * 6 + i) * 0.1 * (1 - c); lift = Math.abs(Math.sin(c * PI * 3)) * 0.4 * (1 - c); }
      else if (u < 0.88) { const hu = (u - 0.6) / 0.28 * 2, j = Math.min(1, Math.floor(hu)), a = clamp((hu - j - 0.1) / 0.8); prog = 1 - (j + sm(a)) / 2; lift = Math.sin(PI * a) * 1.25; rot = Math.sin(TAU * a) * 0.07; }
      else { const c = (u - 0.88) / 0.12; rot = Math.sin(c * PI * 4) * 0.03 * (1 - c); }
      m.X += d * toy.reach * prog; m.lift = lift * 0.2 * wob; m.rot = rot * d * wob; break; }
    case 'pull': { const ph = t * 1.4 * en - i * 0.6; m.rot = -0.022 * wob * Math.cos(ph) * d; m.X += 0.012 * Math.sin(ph) * wob; m.lift = Math.abs(Math.sin(t * 5 * en + i * 2)) * 0.012 * wob; break; }
    case 'tin': {
      const c = t * en / 9 + i * 0.43, n = Math.floor(c), u = c - n, par = n % 2 ? -1 : 1, D = toy.run ?? 0.8, wd = 0.2;
      let dd = 0;
      if (u < wd) { const a = u / wd, s6 = a * 6; m.key = (Math.floor(s6) + sm(clamp(fract(s6) * 1.8))) / 6 * 3; m.lift = Math.sin(PI * a) * 0.1; m.face = -Math.cos(PI * sm(clamp(a * 1.8 - 0.2))); m.rot = Math.sin(a * PI * 12) * 0.02 * wob; m.e = 0; }
      else { const ur = (u - wd) / (1 - wd); dd = 1 - Math.pow(1 - ur, 2.3); m.key = 3 * (1 - dd); m.e = Math.pow(1 - ur, 1.2); m.leg = dd * D / 0.085; m.rot = Math.sin(TAU * m.leg) * 0.055 * wob * (0.35 + 0.65 * m.e); m.lift = Math.abs(Math.sin(TAU * m.leg)) * 0.015 * wob; }
      m.dir = d * par; m.X += m.dir * D * (dd - 0.5); break; }
    case 'brick': {
      const nf = Math.floor(t * 5 * en + i * 7), N = toy.steps || 10, cyc = 2 * (N + 3), k = ((nf % cyc) + cyc) % cyc; let pos, dr = 1, roar = 0;
      if (k < N) pos = k; else if (k < N + 3) { pos = N; roar = 1; dr = k === N + 2 ? -1 : 1; } else if (k < 2 * N + 3) { pos = N - (k - N - 3); dr = -1; } else { pos = 0; roar = 1; dr = k === cyc - 1 ? 1 : -1; }
      m.pos = pos - N / 2; m.dir = d * dr; m.fr = roar ? 4 + (k % 2) : (dr > 0 ? pos : 400 - pos) % 4; m.step = nf; break; }
    case 'plush': { const u = fract(t * en / 2.6 + i * 0.5 + (i > 1 ? 0.27 : 0));
      if (u < 0.42) { const a = u / 0.42; m.lift = Math.sin(PI * a) * 0.2 * wob; m.sy = 1 + 0.1 * wob * Math.sin(PI * a); }
      else { const b = (u - 0.42) / 0.58; m.sy = 1 - 0.2 * wob * Math.exp(-5 * b) * Math.cos(b * 15); }
      m.sx = 1 / Math.pow(m.sy, 0.8); m.rot = Math.sin(t * 0.9 * en + i * 1.7) * 0.05 * wob; break; }
    case 'balloon': { const wx = windX(f.p.wind), u = fract(t * en / 5.5 + i * 0.41);
      m.rot = (0.07 * Math.sin(t * 1.1 + i * 2.1) + 0.03 * Math.sin(t * 2.7 + i)) * wob + wx * 0.05; m.lift = (0.5 + 0.5 * Math.sin(t * 1.7 + i * 1.3)) * 0.035 * wob;
      if (u < 0.4) { const a = u / 0.4; m.lift += Math.sin(PI * a) * 0.3 * wob; m.rot += Math.sin(TAU * a) * 0.1 * wob * d; }
      m.X += Math.sin(t * 0.5 + i * 2) * 0.02 * wob + wx * 0.02 * Math.sin(t * 0.8 + i); m.sy = 1 + 0.03 * wob * Math.sin(t * 3.1 + i); m.sx = 2 - m.sy; break; }
    case 'card': { m.X += (toy.slide ?? 0.1) * Math.sin(t * 0.55 * en + i * 2.2) * d; m.rot = (0.05 * Math.sin(t * 2.3 * en + i * 1.9) + 0.02 * Math.sin(t * 5.1 + i)) * wob; break; }
    case 'bath': { m.lift = Math.sin(t * 1.4 * en + i * 2.2) * 0.035 * wob; m.rot = (Math.sin(t * 0.9 * en + i * 1.4) * 0.08 + Math.sin(t * 2.2 + i) * 0.02) * wob; m.X += 0.06 * Math.sin(t * 0.3 * en + i * 2.5); break; }
  }
  return m;
}

export default {
  id: 'toybox',
  name: 'Toy Box',
  kind: '2d',
  sky: true,
  params: [
    { id: 'x1', label: 'Wobble', value: 0.5, tip: 'How hard the toys are hopped, rocked, bounced and wound' },
    { id: 'x2', label: 'Gloss', value: 0.6, tip: 'Shine on the plastic, tin, bricks and balloons' },
    { id: 'x3', label: 'Clutter', value: 0.5, tip: 'Blocks, marbles, crayons and whatever else was left out' },
  ],
  create(ctx, opts) {
    const mode = MODES[opts.mode] ? opts.mode : 'plastic', M = MODES[mode], seed = opts.seed || 1;
    const toys = (opts.toys || []).map(t => ({ dir: 1, z: 0.05, need: 0, ...t }));
    const cache = new Map();
    const spr = (key, build) => { let s = cache.get(key); if (!s) { if (cache.size > 90) cache.clear(); s = build(); cache.set(key, s); } return s; };
    const quant = k => Math.pow(2, Math.ceil(Math.log2(Math.max(k, 1e-3)) * 3) / 3);
    let tp = null, lastStage = 0;

    function toySprite(toy, i, fr, dir, k, gloss, detail) {
      const kq = quant(k), gq = Math.round(gloss * 5) / 5, dq = Math.round(detail * 3) / 3;
      return spr(`t${i}|${fr}|${dir}|${kq.toFixed(3)}|${gq}|${dq}`, () => {
        const P = poseOf(toy, fr), o = { col: toy.col, acc: toy.acc, gloss: gq, detail: dq };
        switch (mode) {
          case 'pull': return bWood(P, kq, dir, o);
          case 'tin': return bTin(P, kq, dir, o);
          case 'brick': return bBrick(P, kq, dir, { ...o, rows: Math.round(lerp(11, 22, dq) * (toy.rows || 1)) });
          case 'plush': return bPlush(P, kq, dir, o);
          case 'balloon': return bBalloon(P, kq, dir, o);
          case 'card': return bCard(P, kq, dir, o);
          case 'bath': return bPlastic(P, kq, dir, { ...o, rubber: 1, noBase: 1, gloss: gq * 0.8 });
          case 'glow': return toy.bones ? bBones(P, kq, dir, { ...o, col: '#dcefc4' }) : bPlastic(P, kq, dir, { ...o, col: toy.col || '#d3eab8', gloss: gq * 0.6 });
          default: return bPlastic(P, kq, dir, o);
        }
      });
    }

    return {
      render(f) {
        const { w, h, p } = f, E = f.era, V = view(f, M), { U, cx, sc, sy } = V;
        // play time stops while the toys lie knocked over
        const tip = sm(smooth(0.05, 0.5, E.dark));
        if (tp == null || Math.abs(f.stage - lastStage) > 0.03 && tip === 0) tp = f.t; else tp += f.dt * (1 - tip);
        lastStage = f.stage;
        const t = tp, en = energy(f), wob = p.x1 * 2, gloss = p.x2, detail = p.detail;
        const pan = clamp(f.pointer?.dragX || 0, -0.5, 0.5);
        const scroll = M.scroll ? (mode === 'pull' ? 0.17 * en * (t + 0.5 * Math.sin(t * 1.4 * en) / (1.4 * en)) : 0.03 * en * t) : 0;
        const st = { scroll, wob, tip };
        // room light: day from the window, a lamp when it is dim; the lamp flickers at the impact
        const dl = daylight(p.light), buzz = Math.max(E.dark, E.flash) > 0.02 ? 1 - Math.max(E.dark, E.flash) * 0.75 * (0.3 + 0.7 * (hash(Math.floor(f.clock * 14), 3) > 0.45 ? 1 : 0.15)) : 1;
        const lampOn = M.lamp ? clamp(1 - smooth(0.2, 0.55, p.light) + E.dark) * buzz : 0, amb = lerp(0.14, 1, smooth(0, 0.55, p.light)) * (1 - 0.45 * E.dark);

        sky(f, () => paintWall(ctx, f, V, M, st));
        ctx.lineJoin = ctx.lineCap = 'round';
        paintGround(ctx, f, V, M, st, E);
        if (M.mat) paintMat(ctx, f, V, M, E, st);

        const list = [], glows = [], shA = (M.noShadow ? 0 : 0.3) * (0.5 + 0.5 * amb);
        // the "asteroid": a rubber ball thrown in from the top left, bouncing among the toys, rolling away again
        const bz = 0.3, br = U * sc(bz) * 0.085; let ballX = 0.05;
        if (f.stage > 0.872 && f.stage < 0.978) {
          const s = f.stage, gy = sy(bz); let bx, by, roll;
          if (s < 0.88) { const m = (s - 0.872) / 0.008; bx = lerp(-0.12 * w, cx + ballX * U * sc(bz), m); by = lerp(-0.1 * h, gy - br, m * m); roll = m * 9; }
          else { const b = (s - 0.88) / 0.012, X = ballX + 0.42 * (1 - Math.exp(-b * 1.6)) + smooth(0.938, 0.978, s) * 2.6; ballX = X;
            bx = cx + X * U * sc(bz); by = gy - br - Math.abs(Math.cos(b * PI * 1.6)) * Math.exp(-b * 1.5) * h * 0.3; roll = X * U * sc(bz) / br + 9; }
          list.push({ z: bz, draw: () => drawBall(ctx, bx, by, br, roll, gy) });
        }
        // toy trees for the era (locked species, so deep time shows in the dressing)
        if (!M.noPlants) {
          const fl = flora(E), kinds = Object.keys(fl).filter(k => PLANTS[k] && (!f.backdrop || PLANTS[k].low)), tot = kinds.reduce((a, k) => a + fl[k], 0), n = Math.round(lerp(2, 7, detail));
          for (let i = 0; i < n && tot > 0; i++) {
            let r = hash(i, seed, 61) * tot, kind = kinds[0]; for (const k of kinds) { r -= fl[k]; if (r <= 0) { kind = k; break; } }
            const z = 0.62 + hash(i, seed, 63) * 0.33, X0 = ((i + 0.5) / n * 2 - 1) * 1.25 + (hash(i, seed, 65) - 0.5) * 0.2, X = M.scroll ? wrap(X0 * 1.6 - scroll, -2.2, 2.2) : X0;
            const low = PLANTS[kind].low, tall = (low ? 0.1 + hash(i, 67) * 0.05 : 0.27 + hash(i, 67) * 0.1) * U * sc(z), k = tall / PLANTS[kind].h;
            list.push({ z, draw: () => {
              const S = spr(`p${mode === 'brick' || mode === 'card' || mode === 'glow' ? mode : ''}|${kind}|${i}|${quant(k).toFixed(3)}`, () => bPlant(mode, kind, i + seed * 7, quant(k))), s = k / S.k, x = cx + (X + pan) * U * sc(z), y = sy(z);
              if (shA) { ctx.save(); ctx.globalAlpha = shA * 0.8; ctx.translate(x, y); ctx.transform(1, 0, -0.5, -0.26, 0, 0); ctx.scale(s, s); ctx.drawImage(shadowOf(S), -S.px, -S.py, S.W, S.H); ctx.restore(); }
              ctx.drawImage(S.c, x - S.px * s, y - S.py * s, S.W * s, S.H * s);
            } });
          }
        }
        // clutter: far and near, and off to the sides, never where the toys play
        const nc = Math.round(p.x3 * 24), kinds = M.clutter;
        for (let i = 0; i < nc; i++) {
          const R = rng(Math.imul(i + 1 + seed * 131, 2654435761)), zone = M.near ? 0.9 : R(); let X, z;
          if (zone < 0.4) { z = 0.6 + R() * 0.36; X = (R() - 0.5) * 3; } else if (zone < 0.72) { z = lerp(0.02, 0.5, R()); X = (R() < 0.5 ? -1 : 1) * (1.0 + R() * 0.45); } else { z = lerp(M.zNear ?? -0.38, -0.2, R()); X = (R() - 0.5) * 2.6; }
          if (mode === 'bath') { z = lerp(-0.35, 0.95, R()); X = (R() - 0.5) * 3; }
          if (M.scroll) X = wrap(X * 1.5 - scroll, -2.3, 2.3);
          const kind = kinds[i % kinds.length], s = U * sc(z) * (0.085 + R() * 0.03);
          list.push({ z: z + 0.001, draw: () => drawClutter(ctx, kind, cx + (X + pan) * U * sc(z), sy(z), s, i + seed * 17, V, f.t) });
        }
        // the toys
        if (f.pointer?.clicks?.length) for (const c of f.pointer.clicks) { let best = null, bd = 1e9; for (const toy of toys) if (toy._x != null) { const d = Math.abs(toy._x - c.x * w); if (d < bd) { bd = d; best = toy; } } if (best) { best.poke = f.t; if (f.sig) f.sig.roar = 1; } }
        let shown = 0, landed = false;
        toys.forEach((toy, i) => {
          if (p.herd < toy.need) { toy._x = null; return; }
          shown++;
          const P0 = poseOf(toy, 0), bx = sizeBox(mode, P0), z = toy.z, kpm = toy.L * U * sc(z) / (bx.x1 - bx.x0);
          const m = motion(mode, toy, i, t, en, wob, f);
          if (f.sig && f.dt > 0) { const m0 = motion(mode, toy, i, t - f.dt, en, wob, f); if (m0.lift > 0.004 && m.lift <= 0.004 || mode === 'brick' && m0.step !== m.step && !(m.step % 2)) landed = true; }
          if (toy.poke != null) { const a = (f.t - toy.poke) / 0.55; if (a >= 0 && a < 1) { m.lift += Math.sin(PI * a) * 0.35; m.rot += Math.sin(TAU * a) * 0.12; } else toy.poke = null; }
          const S = toySprite(toy, i, m.fr, m.dir, kpm, gloss, detail), s = kpm / S.k, hgt = S.py * s;
          let X = m.X;
          if (mode === 'brick') X += m.pos * P0.q.stride / 4 * toy.L / (bx.x1 - bx.x0) * toy.dir;
          if (toy.parked && M.scroll) X = wrap(X - scroll, -2.2, 2.2);
          const x = cx + (X + pan) * U * sc(z), gy = sy(z); toy._x = x;
          // knocked over by the ball: falls away from it and lies there
          const td = (X >= ballX ? 1 : -1), live = 1 - tip;
          let rot = m.rot * live, lift = m.lift * hgt * live, sqy = lerp(m.sy, 1, tip), sqx = lerp(m.sx, 1, tip) * (tip > 0 ? lerp(m.face, Math.sign(m.face) || 1, tip) : m.face), flat = 1;
          if (tip > 0) { if (mode === 'bath') rot += td * 0.6 * tip; else { flat = lerp(1, 0.6, tip); rot += td * 0.42 * tip; lift += Math.sin(0.42 * tip) * S.W * s * 0.16; } }
          const sink = mode === 'bath' ? (bellyOf(P0) - bx.fy) * kpm * 1.12 : 0, y = gy + sink - lift;
          const body = () => {
            ctx.save(); ctx.translate(x, y); ctx.rotate(rot); if (flat < 1) ctx.transform(1, 0, -0.75 * (1 - flat) * td, flat, 0, 0); ctx.scale(s * sqx, s * sqy);
            if (mode === 'tin') tinLegs(ctx, S, P0, toy, m, false);
            if (mode === 'pull') wheels(ctx, S, P0, false, scroll * U * sc(z) / s + (toy.parked ? 0 : 0));
            ctx.drawImage(S.c, -S.px, -S.py);
            if (mode === 'tin') { tinLegs(ctx, S, P0, toy, m, true); tinKey(ctx, S, P0, m.key * TAU); }
            if (mode === 'pull') wheels(ctx, S, P0, true, toy.parked ? 0 : scroll * U * sc(z) / s);
            ctx.restore();
          };
          list.push({ z: z - i * 1e-4, draw: () => {
            if (shA) { const a = shA * clamp(1 - lift / (hgt * 0.9), 0.35, 1) * (1 - 0.8 * tip); ctx.save(); ctx.globalAlpha = a; ctx.translate(x + lift * 0.5, gy + lift * 0.26); ctx.rotate(rot * 0.3); ctx.transform(1, 0, -0.5, -0.26, 0, 0); ctx.scale(s * sqx, s);
              ctx.drawImage(shadowOf(S), -S.px, -S.py, S.W, S.H); ctx.restore();
              ctx.fillStyle = `rgba(0,0,0,${a * 0.5})`; ctx.beginPath(); ctx.ellipse(x, gy + hgt * 0.01, S.W * s * 0.3, S.W * s * 0.035, 0, 0, TAU); ctx.fill(); }
            if (mode === 'bath') {
              ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, gy); ctx.clip(); body(); ctx.restore();
              ctx.save(); ctx.beginPath(); ctx.rect(0, gy, w, h); ctx.clip(); ctx.globalAlpha = 0.22; body(); ctx.restore();
              ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = Math.max(1, h * 0.004);
              for (const [k2, a2] of [[0.42, 0.75], [0.56, 0.35]]) { ctx.globalAlpha = a2; ctx.beginPath(); ctx.ellipse(x, gy, S.W * s * (k2 + 0.03 * Math.sin(t * 2 + i)), S.W * s * 0.045, 0, 0, TAU); ctx.stroke(); } ctx.globalAlpha = 1;
            } else body();
            if (mode === 'glow') glows.push({ S, x, y, s: s, rot, sqx, sqy, flat, td });
            if (mode === 'pull') toy._hitch = [x, gy - (woodGeom(P0).top - woodGeom(P0).box.fy - woodGeom(P0).wr * 0.5) * kpm, Math.abs(woodGeom(P0).xb - woodGeom(P0).xa) * kpm, woodGeom(P0), kpm];
          } });
        });
        list.sort((a, b) => b.z - a.z);
        for (const d of list) d.draw();
        // the string: car to car, then off to whoever is pulling
        if (mode === 'pull') {
          const cars = toys.filter(t => !t.parked && t._x != null && t._hitch && p.herd >= t.need).sort((a, b) => b._x - a._x);
          const ends = c => { const [x, y, , G, k] = c._hitch, mid = (G.xa + G.xb) / 2 - G.box.cx; return [x + (G.xb - G.box.cx) * k * c.dir, x + (G.xa - G.box.cx) * k * c.dir, y, mid]; };
          ctx.lineWidth = Math.max(1, h * 0.0045);
          const str = (x0, y0, x1, y1, sag) => { for (const [c, dash] of [['#b53a2e', []], ['#f6efe0', [h * 0.012, h * 0.012]]]) { ctx.strokeStyle = c; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2, Math.max(y0, y1) + sag, x1, y1); ctx.stroke(); } ctx.setLineDash([]); };
          cars.forEach((c, j) => { const [fx, bx2, y] = ends(c); if (j === 0) { if (tip < 0.5) str(fx, y, w + h * 0.05, y - h * (0.3 + 0.02 * Math.sin(t * 1.4 * en)) * (1 - tip), h * 0.02 * (1 + Math.cos(t * 1.4 * en))); else str(fx, y, fx + h * 0.4, V.Yf + h * 0.05, h * 0.06); }
            const nx = cars[j + 1]; if (nx) { const [fx2, , y2] = ends(nx); str(bx2, y, fx2, y2, h * 0.012 * (1.5 + Math.cos(t * 1.4 * en - j))); } });
        }
        if (M.ground === 'shelf') {      // the front lip of the shelf, and the dark under it
          const yl = sy(M.zNear - 0.1), lh = h * 0.05; const g = ctx.createLinearGradient(0, yl, 0, yl + lh); g.addColorStop(0, '#d8a870'); g.addColorStop(0.15, '#a87646'); g.addColorStop(1, '#7a5230');
          ctx.fillStyle = g; ctx.fillRect(0, yl, w, lh); ctx.fillStyle = '#2c2430'; ctx.fillRect(0, yl + lh, w, h - yl - lh + 2);
        }
        // the lamp itself (left out when a volcano needs the space above the table)
        if (M.lamp && !f.backdrop) {
          const lx = h * 0.2, ly = h * 0.1, s = h; ctx.save(); ctx.translate(lx, ly); ctx.rotate(0.5);
          ctx.strokeStyle = '#3a3f4a'; ctx.lineWidth = s * 0.016; ctx.beginPath(); ctx.moveTo(-s * 0.02, -s * 0.03); ctx.lineTo(-s * 0.28, -s * 0.2); ctx.stroke();
          ctx.fillStyle = '#d2473a'; ctx.beginPath(); ctx.moveTo(-s * 0.035, -s * 0.045); ctx.lineTo(s * 0.035, -s * 0.045); ctx.lineTo(s * 0.085, s * 0.05); ctx.lineTo(-s * 0.085, s * 0.05); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.moveTo(-s * 0.02, -s * 0.04); ctx.lineTo(0, -s * 0.04); ctx.lineTo(-s * 0.02, s * 0.045); ctx.lineTo(-s * 0.065, s * 0.045); ctx.fill();
          ctx.fillStyle = css(mix([120, 110, 100], [255, 240, 190], lampOn)); ctx.beginPath(); ctx.ellipse(0, s * 0.05, s * 0.085, s * 0.018, 0, 0, TAU); ctx.fill(); ctx.restore();
        }
        // light: only ever tints what is already painted, so a sky behind stays clean
        ctx.save(); ctx.globalCompositeOperation = 'source-atop';
        const dkA = (1 - amb) * 0.9;
        if (dkA > 0.01 || lampOn > 0.01) {
          const px = M.lamp ? h * 0.2 + (cx - h * 0.2) * 0.75 : cx, py = V.Yf - h * 0.04, g = ctx.createRadialGradient(px, py, 0, px, py, h * 1.15), ins = dkA * (1 - 0.9 * lampOn);
          g.addColorStop(0, `rgba(40,26,20,${ins})`); g.addColorStop(0.3, `rgba(30,24,30,${lerp(ins, dkA, 0.25)})`); g.addColorStop(1, `rgba(8,10,34,${dkA})`);
          ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
          if (lampOn > 0.01) { const g2 = ctx.createRadialGradient(px, py, 0, px, py, h * 0.8); g2.addColorStop(0, `rgba(255,196,110,${0.2 * lampOn})`); g2.addColorStop(1, 'rgba(255,196,110,0)'); ctx.fillStyle = g2; ctx.fillRect(0, 0, w, h); }
        }
        if (dl.dusk > 0.02) { ctx.fillStyle = `rgba(255,150,80,${0.13 * dl.dusk})`; ctx.fillRect(0, 0, w, h); }
        if (E.dark > 0.02) { ctx.fillStyle = `rgba(60,40,30,${E.dark * 0.25})`; ctx.fillRect(0, 0, w, h); }
        if (E.flash > 0.01) { ctx.fillStyle = `rgba(255,244,214,${Math.min(0.85, E.flash * 0.8)})`; ctx.fillRect(0, 0, w, h); }
        ctx.restore();
        // glow-in-the-dark: the figures (and stars stuck on the wall) give back their light when the room is dim
        if (mode === 'glow') {
          const ga = clamp((1 - amb) * 1.5) * (0.85 + 0.15 * Math.sin(f.t * 0.8));
          if (ga > 0.02) {
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            for (const G of glows) { const hl = haloOf(G.S, '#8dff9a'), mm = G.S.haloM; ctx.save(); ctx.translate(G.x, G.y); ctx.rotate(G.rot); if (G.flat < 1) ctx.transform(1, 0, -0.75 * (1 - G.flat) * G.td, G.flat, 0, 0); ctx.scale(G.s * G.sqx, G.s * G.sqy);
              ctx.globalAlpha = ga * 0.55; ctx.drawImage(hl, -G.S.px - mm, -G.S.py - mm, G.S.W + mm * 2, G.S.H + mm * 2); ctx.globalAlpha = ga * 0.8; ctx.drawImage(G.S.c, -G.S.px, -G.S.py); ctx.restore(); }
            ctx.restore();
            if (!f.combo) { ctx.fillStyle = `rgba(170,255,170,${ga * 0.9})`; for (let i = 0; i < 16; i++) { const x = (0.36 + hash(i, 81) * 0.62) * w, y = (0.03 + hash(i, 83) * 0.13 + (hash(i, 81) < 0.25 ? 0.25 : 0)) * h, r = h * (0.008 + hash(i, 85) * 0.012);
              ctx.beginPath(); for (let j = 0; j < 10; j++) { const a = j / 10 * TAU + i, rr = j % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.fill(); } }
          }
        }
        if (f.sig) { if (landed && tip < 0.5) f.sig.step = 1; f.sig.count = clamp(shown / 6); f.sig.speed = clamp(en * 0.5 * (1 - tip)); }
      },
      dispose() { cache.clear(); }
    };
  }
};

// stiff tin legs that swing from a rivet at the hip (drawn in the sprite's own pixels, around its pivot)
function tinLegs(ctx, S, P, toy, m, near) {
  const q = P.q, pal = toyPal(P.sp, 1.9, toy.col, toy.acc), k = S.k;
  for (const g of q.legs) {
    if (g.near !== near) continue;
    const [jx, jy] = S.m(g.pts[0][0], g.pts[0][1]), L = (g.pts[0][1] - P.box.fy) * k, wt = g.R[0] * k * 1.1, wb = Math.max(g.R[2] * k * 1.3, wt * 0.5), d = Math.sign(S.m(1, 0)[0] - S.m(0, 0)[0]);
    const a = Math.sin(TAU * m.leg + (g.front ? PI : 0) + (g.near ? 0 : PI)) * 0.22 * (m.e > 0 ? 1 : 0);
    ctx.save(); ctx.translate(jx, jy); ctx.rotate(a * d);
    ctx.fillStyle = css(near ? pal.body : pal.far); ctx.strokeStyle = '#2a1c14'; ctx.lineWidth = Math.max(0.6, q.L * k * 0.004);
    ctx.beginPath(); ctx.arc(0, 0, wt, PI, TAU); ctx.lineTo(wb, L * 0.88); ctx.lineTo(wb + wb * 0.8 * d, L * 0.93); ctx.lineTo(wb + wb * 0.8 * d, L); ctx.lineTo(-wb, L); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(-wt * 0.5, 0, wt * 0.35, L * 0.85);
    if (near) { const r = Math.max(1, q.L * k * 0.007); ctx.fillStyle = '#6b6a66'; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.fillStyle = '#f3f1e8'; ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.3, r * 0.45, 0, TAU); ctx.fill(); }
    ctx.restore();
  }
}
function tinKey(ctx, S, P, ang) {
  const q = P.q, n = q.nodes, a = n[q.iHip], b = n[q.iSh], [x, y] = S.m((a.x * 0.6 + b.x * 0.4), (a.y + b.y) / 2 - a.r * 0.1), r = q.L * S.k * 0.062;
  ctx.fillStyle = '#3a3836'; ctx.beginPath(); ctx.arc(x, y, r * 0.36, 0, TAU); ctx.fill();
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  for (const [c, lw, o] of [['#6f6a5c', r * 0.3, r * 0.05], ['#d8d2bc', r * 0.22, 0]]) { ctx.strokeStyle = c; ctx.lineWidth = lw; for (const d of [-1, 1]) { ctx.beginPath(); ctx.ellipse(d * r * 0.72, o, r * 0.5, r * 0.4, 0, 0, TAU); ctx.stroke(); } }
  ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = r * 0.07; for (const d of [-1, 1]) { ctx.beginPath(); ctx.ellipse(d * r * 0.72, 0, r * 0.5, r * 0.4, 0, PI * 1.1, PI * 1.6); ctx.stroke(); }
  ctx.restore(); ctx.fillStyle = '#d8d2bc'; ctx.beginPath(); ctx.arc(x, y, r * 0.22, 0, TAU); ctx.fill(); ctx.fillStyle = '#6f6a5c'; ctx.beginPath(); ctx.arc(x, y, r * 0.09, 0, TAU); ctx.fill();
}
// pull-toy wheels: painted discs that really turn (dist = how far the toy has rolled, in sprite pixels)
function wheels(ctx, S, P, near, dist) {
  const G = woodGeom(P), r = G.wr * S.k, d = Math.sign(S.m(1, 0)[0] - S.m(0, 0)[0]) || 1;
  for (const wx of G.wheels) {
    let [x, y] = S.m(wx, G.wy);
    if (!near) { x += r * 0.5; y -= r * 0.32; }
    const a = dist / r * d;
    ctx.fillStyle = near ? '#c53b30' : '#7e241e'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    if (!near) continue;
    ctx.fillStyle = '#e8574a'; ctx.beginPath(); ctx.arc(x - r * 0.04, y - r * 0.05, r * 0.86, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillStyle = '#fbe9c6'; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(Math.cos(i * PI / 2) * r * 0.52, Math.sin(i * PI / 2) * r * 0.52, r * 0.17, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#f3bd3a'; ctx.beginPath(); ctx.arc(r * 0.52, 0, r * 0.17, 0, TAU); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#e2c08a'; ctx.beginPath(); ctx.arc(x, y, r * 0.2, 0, TAU); ctx.fill(); ctx.fillStyle = 'rgba(90,50,20,.5)'; ctx.beginPath(); ctx.arc(x, y, r * 0.08, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = r * 0.08; ctx.beginPath(); ctx.arc(x, y, r * 0.86, PI * 1.1, PI * 1.6); ctx.stroke();
  }
}

const S = (id, name, desc, tags, opts, params) => ({ id: 'toybox-' + id, name, desc, tags: ['toy', '2d', ...tags], opts, params });
export const scenes = [
  S('plastic', 'Plastic Figures', 'Glossy moulded T. rex and Triceratops, hopped at each other by an invisible hand. The toys stay put in time: Era changes the play mat.', ['theropod', 'ceratopsian', 'plastic'],
    { mode: 'plastic', seed: 1, toys: [
      { sp: 'parasaurolophus', X: 0.1, z: 0.62, L: 0.5, dir: -1, col: '#3c7fd0', need: 0.35 },
      { sp: 'stegosaurus', X: -0.95, z: 0.5, L: 0.46, dir: 1, col: '#8a5cc0', need: 0.9 },
      { sp: 'velociraptor', X: 1.05, z: 0.42, L: 0.3, dir: -1, col: '#e9b528', need: 0.7 },
      { sp: 'tyrannosaurus', X: -0.5, z: 0.08, L: 0.8, dir: 1, col: '#3f9d4c', jaw: 0.75, head: 0.15, reach: 0.17 },
      { sp: 'triceratops', X: 0.5, z: 0.04, L: 0.66, dir: -1, col: '#dd5230', head: -0.1, reach: 0.15 }] }, { stage: 0.855 }),
  S('pull', 'Wooden Pull-Toys', 'A train of plywood long-necks on wheels, tugged along the floorboards on a string.', ['sauropod', 'herd', 'wood'],
    { mode: 'pull', seed: 2, toys: [
      { sp: 'stegosaurus', X: 0.9, z: 0.72, L: 0.5, col: '#d98a3a', need: 0.75, parked: 1 },
      { sp: 'brachiosaurus', X: 0.47, z: 0.05, L: 0.62, col: '#2f7fd0' },
      { sp: 'diplodocus', X: -0.2, z: 0.05, L: 0.68, col: '#e2a11e', head: 0.7 },
      { sp: 'camarasaurus', X: -0.74, z: 0.05, L: 0.33, col: '#d8432e', need: 0.2 }] }, { stage: 0.42, light: 0.7 }),
  S('tin', 'Wind-Up Tin Stegosaurus', 'Lithographed tin with rivets and a key in its side: it waddles, runs down and gets wound up again.', ['stegosaur', 'ankylosaur', 'tin'],
    { mode: 'tin', seed: 3, toys: [
      { sp: 'ankylosaurus', X: 0.55, z: 0.55, L: 0.5, dir: -1, need: 0.35, run: 0.6 },
      { sp: 'stegosaurus', X: 0, z: 0.05, L: 0.8, dir: 1, col: '#3aa06a', acc: '#f08a2a', run: 0.5 }] }, { stage: 0.43, light: 0.45 }),
  S('bricks', 'Brick-Built Rex', 'Tyrannosaurus and Ankylosaurus built from studded bricks, walking in stop motion across a baseplate.', ['theropod', 'ankylosaur', 'bricks'],
    { mode: 'brick', seed: 4, toys: [
      { sp: 'triceratops', X: -0.75, z: 0.6, L: 0.5, dir: 1, col: '#e8a020', need: 0.7, steps: 6, rows: 0.8 },
      { sp: 'ankylosaurus', X: 0.6, z: 0.36, L: 0.6, dir: -1, col: '#3b78c8', acc: '#f0c030', steps: 4, rows: 0.62 },
      { sp: 'tyrannosaurus', X: -0.26, z: 0.02, L: 0.92, dir: 1, col: '#dc3c2c', acc: '#f0c030', steps: 6, rear: 1, head: -0.25, young: 0.5 }] }, { stage: 0.86 }),
  S('plush', 'Plush Pals', 'Corduroy and felt dinosaurs with stitched seams and button eyes, bouncing on the quilt.', ['ceratopsian', 'ornithopod', 'plush'],
    { mode: 'plush', seed: 5, toys: [
      { sp: 'stegosaurus', X: 0.02, z: 0.6, L: 0.56, dir: 1, col: '#e0a43a', acc: '#d8563a', need: 0.75, young: 0.6 },
      { sp: 'triceratops', X: -0.46, z: 0.08, L: 0.68, dir: 1, col: '#7a68c8', acc: '#f0c040', young: 0.8 },
      { sp: 'parasaurolophus', X: 0.46, z: 0.05, L: 0.72, dir: -1, col: '#3aa58c', acc: '#ef7a5a', young: 0.8 },
      { sp: 'tyrannosaurus', X: 0.02, z: -0.16, L: 0.36, dir: 1, col: '#e8744a', need: 0.35, young: 1 }] }, { stage: 0.8, light: 0.75 }),
  S('balloon', 'Balloon Animals', 'Twisted balloon dinosaurs made of shiny sausages, drifting on a party table. Wind leans them.', ['sauropod', 'theropod', 'balloon'],
    { mode: 'balloon', seed: 6, toys: [
      { sp: 'parasaurolophus', X: 0.95, z: 0.55, L: 0.5, dir: -1, col: '#57b85a', need: 0.75 },
      { sp: 'diplodocus', X: 0.05, z: 0.5, L: 0.8, dir: 1, col: '#f3c12a', need: 0.35 },
      { sp: 'brachiosaurus', X: -0.42, z: 0.06, L: 0.64, dir: 1, col: '#f0528a' },
      { sp: 'velociraptor', X: 0.46, z: 0.02, L: 0.62, dir: -1, col: '#35a8ea' }] }, { stage: 0.43 }),
  S('diorama', 'Shoebox Diorama', 'A school project: painted cardboard Allosaurus and Stegosaurus on stands, a paper volcano and cotton-wool smoke.', ['theropod', 'stegosaur', 'sauropod', 'cardboard'],
    { mode: 'card', seed: 7, toys: [
      { sp: 'diplodocus', X: 0.05, z: 0.7, L: 1.05, dir: 1, need: 0.3, slide: 0.05 },
      { sp: 'allosaurus', X: -0.43, z: 0.08, L: 0.72, dir: 1, jaw: 0.6, slide: 0.07 },
      { sp: 'stegosaurus', X: 0.45, z: 0.04, L: 0.66, dir: -1, slide: 0.04 },
      { sp: 'compsognathus', X: 0.02, z: -0.14, L: 0.24, dir: -1, need: 0.75, slide: 0.12 }] }, { stage: 0.43 }),
  S('bath', 'Bath Time', 'Squeaky rubber dinosaurs bobbing in the tub: a duck-billed Edmontosaurus, a Spinosaurus and a real duck (a living dinosaur).', ['ornithopod', 'theropod', 'rubber', 'water'],
    { mode: 'bath', seed: 8, toys: [
      { sp: 'brachiosaurus', X: 0.02, z: 0.55, L: 0.4, dir: 1, col: '#59b86a', need: 0.35 },
      { sp: 'triceratops', X: -0.95, z: 0.62, L: 0.42, dir: 1, col: '#ef6aa0', need: 0.75 },
      { sp: 'edmontosaurus', X: -0.5, z: 0.12, L: 0.62, dir: 1, col: '#ffd034' },
      { sp: 'spinosaurus', X: 0.48, z: 0.03, L: 0.7, dir: -1, col: '#ff8438', jaw: 0.4 }] }, { stage: 0.72, light: 0.85 }),
  S('glow', 'Glow in the Dark', 'A skeleton kit and moulded figures on a shelf, glowing green after lights out. Turn Light up to see them by day.', ['theropod', 'ceratopsian', 'stegosaur', 'night', 'glow'],
    { mode: 'glow', seed: 9, toys: [
      { sp: 'stegosaurus', X: 0.05, z: 0.55, L: 0.6, dir: 1, bones: 1, need: 0.3 },
      { sp: 'tyrannosaurus', X: -0.44, z: 0.08, L: 0.8, dir: 1, bones: 1, jaw: 0.6 },
      { sp: 'triceratops', X: 0.48, z: 0.04, L: 0.6, dir: -1 },
      { sp: 'velociraptor', X: 0.03, z: -0.08, L: 0.3, dir: -1, need: 0.7 }] }, { stage: 0.855, light: 0.08 }),
];
