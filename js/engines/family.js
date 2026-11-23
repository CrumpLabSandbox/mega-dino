// Families & Nests: dinosaur family life in a warm, soft, storybook-naturalistic light.
// Built on the shared world (world.js) with a painter of its own: bodies shaded by a soft top light with a rim of
// sun (or moon), dappled ground, dust at the footfalls, breath in cold air and, now and then, a small heart.
// Two scenes are close-ups drawn here from the rig: an Oviraptor on its ring of eggs, and a clutch hatching.
import { createWorld } from '../world.js';
import { paintWorld, drawParts, trace, feetY, paintMeteor, paintFx } from '../draw.js';
import { pose, parts, gait } from '../rig.js';
import { species, standIn } from '../species.js';
import { plantParts } from '../flora.js';
import { clamp, lerp, smooth, hash, fract, daylight, windX } from '../util.js';

const TAU = Math.PI * 2, PI = Math.PI, SQ = 0.3;         // SQ: how flat a circle on the ground looks from the side
const hex = c => { const p = parseInt(c.slice(1), 16); return [p >> 16, p >> 8 & 255, p & 255]; };
const css = (c, a = 1) => a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const HORN = [233, 224, 200], EYE = [242, 210, 74], MOUTH = [122, 31, 36];
const spCols = new Map();
const colsOf = sp => { let c = spCols.get(sp.id); if (!c) spCols.set(sp.id, c = sp.c.map(hex)); return c; };

// soft round sprites for dust, breath and clouds; colours are quantised so the cache stays small
const sprites = new Map();
function sprite(c) {
  const q = [c[0] >> 4, c[1] >> 4, c[2] >> 4].map(v => clamp(v, 0, 15)), key = q.join();
  let s = sprites.get(key);
  if (!s) {
    if (sprites.size > 64) sprites.clear();
    s = document.createElement('canvas'); s.width = s.height = 64;
    const g = s.getContext('2d'), col = q.map(v => v * 17).join(), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${col},1)`); gr.addColorStop(0.35, `rgba(${col},0.7)`); gr.addColorStop(0.75, `rgba(${col},0.2)`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); sprites.set(key, s);
  }
  return s;
}
const puffAt = (ctx, c, x, y, rx, a, ry = rx) => { if (a <= 0.004 || rx < 0.5) return; ctx.globalAlpha = Math.min(1, a); ctx.drawImage(sprite(c), x - rx, y - ry, rx * 2, ry * 2); ctx.globalAlpha = 1; };

// ---------------------------------------------------------------- the light
// One colour pipeline for everything: brightness for the time of day, a warm tint by day and at dusk, a blue one at
// night, haze for distance. C(rgb, k, fog) → rgb.
function lighting(f, v, warmth) {
  const light = v.light, dl = daylight(light), dark = v.dark || 0, wk = 0.2 + 1.6 * warmth;
  let t = mix([1.04, 1.0, 0.92], [1.16, 0.95, 0.76], dl.dusk).map(x => 1 + (x - 1) * wk);
  t = mix(t, [0.5, 0.66, 1.04], dl.night * 0.92);
  t = mix(t, [0.62, 0.56, 0.53], dark * 0.6);
  const lum = lerp(0.7, 1, smooth(0.02, 0.5, light));
  let haze = mix(mix([228, 228, 214], [250, 206, 160], dl.dusk), [44, 58, 100], dl.night);
  haze = mix(haze, [62, 54, 50], dark * 0.8);
  const sun = mix(mix([255, 248, 226], [255, 214, 146], dl.dusk), [186, 204, 255], dl.night);
  const C = (c, k = 1, fog = 0) => {
    const m = k * lum, r = [Math.min(255, c[0] * m * t[0]), Math.min(255, c[1] * m * t[1]), Math.min(255, c[2] * m * t[2])];
    return fog > 0 ? mix(r, haze, fog) : r;
  };
  return { C, t, lum, haze, sun, dl, light, dark, night: dl.night, dusk: dl.dusk, gl: 1 + 0.5 * dl.night, rimA: (0.34 + 0.22 * dl.dusk + 0.4 * dl.night) * (1 - dark * 0.7), pp: new Map() };
}
const PT = { trunk: [98, 74, 52], leaf: [60, 110, 56], leaf2: [88, 138, 64], flower: [240, 188, 204], rock: [138, 130, 118], rock2: [170, 162, 148], egg: [236, 228, 204], bone: [232, 226, 204] };
function plantPal(Lk, fog, E) {
  const key = Math.round(fog * 12); let p = Lk.pp.get(key);
  if (!p) { p = {}; const b = E ? Math.min(1, E.dark * 1.2) * 0.8 : 0; for (const k in PT) p[k] = css(Lk.C(mix(PT[k], [60, 55, 50], b), 1, key / 12)); Lk.pp.set(key, p); }
  return p;
}
function groundBase(f, v, u) {
  const E = f.era, g = v.biome._g ||= v.biome.ground.map(hex);
  let c = mix(g[0], g[1], u);
  const burnt = Math.min(1, E.dark * 1.3 + (1 - E.dinos) * (1 - E.ferns) * 0.4);
  if (burnt > 0) c = mix(c, [70, 60, 54], burnt * 0.8);
  if (E.ferns > 0) c = mix(c, [70, 120, 60], E.ferns * 0.5);
  return c;
}

// ---------------------------------------------------------------- a softly shaded animal
const EDGE = new Set(['body', 'leg', 'arm', 'skull', 'jaw', 'frill', 'plate', 'sail', 'crest', 'horn', 'spike', 'club', 'wing', 'tailfan', 'beak']);
// o: { L: body length in metres, fog, alpha, asleep, flat }
function softDino(ctx, P, T, sp, Lk, o = {}) {
  const fog = o.fog || 0, k = T.k, big = (o.L || sp.len) * k, A = o.alpha ?? 1, flat = o.flat || big < 30;
  const [cb, cl, cm, ca] = colsOf(sp), C = Lk.C;
  let y1 = -1e9, body = null;
  for (const q of P) if (q.k === 'body' && q.p) { body = q; for (const p of q.p) if (p[1] > y1) y1 = p[1]; break; }
  const yt = T.y - (body ? y1 : 1) * k, yb = Math.max(T.y, yt + 2);
  const grad = (c, kk) => {
    if (flat) return css(C(c, kk, fog));
    const g = ctx.createLinearGradient(0, yt, 0, yb);
    g.addColorStop(0, css(mix(C(c, kk * 1.22, fog), Lk.sun, 0.14 * (1 - fog)))); g.addColorStop(0.4, css(C(c, kk, fog))); g.addColorStop(1, css(C(c, kk * 0.7, fog)));
    return g;
  };
  const tone = { body: grad(cb, 1), far: grad(cb, 0.62), belly: grad(cl, 1), mark: css(C(cm, 1, fog)), accent: grad(ca, 1), accentFar: css(C(ca, 0.6, fog)),
    horn: css(C(HORN, 1, fog)), eye: css(C(EYE, 1.1, fog)), mouth: css(C(MOUTH, 1, fog)) };
  const line = css(C(cm, 0.5, fog), 0.42), lw = clamp(big * 0.0045, 0.5, 2.2), rw = clamp(big * 0.012, 1, 7), edge = !flat && big > 46;
  ctx.lineJoin = ctx.lineCap = 'round'; ctx.globalAlpha = A;
  for (const q of P) {
    const col = tone[q.t]; if (!col) continue;
    if (q.k === 'eye') {
      const ex = T.x + q.c[0] * k * T.dir, ey = T.y - q.c[1] * k, r = Math.max(0.5, q.c[2] * k);
      if (o.asleep) {
        ctx.fillStyle = css(C(cb, 0.9, fog)); ctx.beginPath(); ctx.arc(ex, ey, r, 0, TAU); ctx.fill();
        if (r > 1.2) { ctx.strokeStyle = css(C(cm, 0.4, fog)); ctx.lineWidth = Math.max(0.6, r * 0.34); ctx.beginPath(); ctx.arc(ex, ey - r * 0.25, r * 0.9, 0.12 * PI, 0.88 * PI); ctx.stroke(); }
      } else {
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(ex, ey, r, 0, TAU); ctx.fill();
        ctx.fillStyle = '#17120c'; ctx.beginPath(); ctx.arc(ex + r * 0.08 * T.dir, ey, r * 0.6, 0, TAU); ctx.fill();
        if (r > 1.6) { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(ex - r * 0.2, ey - r * 0.28, r * 0.24, 0, TAU); ctx.fill(); }
      }
      continue;
    }
    ctx.beginPath(); trace(ctx, q, T);
    if (q.l) { ctx.strokeStyle = col; ctx.lineWidth = Math.max(0.6, q.w * k); ctx.stroke(); continue; }
    if (q.k === 'mark') { ctx.globalAlpha = A * 0.5; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = A; continue; }
    ctx.fillStyle = col; ctx.fill();
    if (edge && EDGE.has(q.k)) { ctx.strokeStyle = line; ctx.lineWidth = lw; ctx.stroke(); }
    if (q === body && !flat) {                       // the rim of light along the back, tail to head
      const n = q.p.length >> 1; ctx.beginPath();
      for (let i = 3; i < n; i++) { const p = q.p[i], x = T.x + p[0] * k * T.dir, y = T.y - p[1] * k + rw * 0.62; i === 3 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.strokeStyle = css(Lk.sun, Lk.rimA * (1 - fog)); ctx.lineWidth = rw; ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
const softShadow = (ctx, x, y, rx, a) => { if (a <= 0.01) return; ctx.fillStyle = `rgba(20,14,30,${a * 0.55})`; ctx.beginPath(); ctx.ellipse(x, y, rx, rx * 0.15, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = `rgba(20,14,30,${a * 0.6})`; ctx.beginPath(); ctx.ellipse(x, y, rx * 0.7, rx * 0.09, 0, 0, TAU); ctx.fill(); };
function heart(ctx, x, y, s, a) {
  if (a <= 0.01) return;
  ctx.globalAlpha = a; ctx.fillStyle = '#e8566e'; ctx.beginPath(); ctx.moveTo(x, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 1.5, y - s * 0.1, x - s * 0.7, y - s * 1.1, x, y - s * 0.35); ctx.bezierCurveTo(x + s * 0.7, y - s * 1.1, x + s * 1.5, y - s * 0.1, x, y + s * 0.9); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.arc(x - s * 0.42, y - s * 0.3, s * 0.2, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
}
// warm breath from the snout: a short plume every few seconds
function breath(ctx, q, T, Lk, t, id, amt, h) {
  const hd = q.head, tipX = hd.x + Math.cos(hd.a) * hd.len, tipY = hd.y + Math.sin(hd.a) * hd.len * 0.9 + hd.len * 0.08, k = T.k;
  const per = 3 + (id % 5) * 0.35, ph = fract(t / per + id * 0.37); if (ph > 0.6) return;
  const s = clamp(hd.len * k, h * 0.012, h * 0.11), col = Lk.C([236, 240, 250], 1.5);
  for (let i = 0; i < 4; i++) { const u = ph / 0.6 - i * 0.13; if (u <= 0 || u >= 1) continue;
    puffAt(ctx, col, T.x + (tipX * k + s * (0.15 + 1.1 * u)) * T.dir, T.y - tipY * k - s * 0.55 * u * u, s * (0.16 + 0.42 * u), amt * 0.5 * (1 - u) * Math.min(1, u * 6)); }
}

// ---------------------------------------------------------------- nests and eggs
function nestFloor(ctx, x, y, R, Lk, earth, fog) { ctx.fillStyle = css(Lk.C(earth, 0.66, fog)); ctx.beginPath(); ctx.ellipse(x, y, R * 0.92, R * 0.92 * SQ, 0, 0, TAU); ctx.fill(); }
function nestRim(ctx, x, y, R, Lk, earth, fog, near, seed = 1) {
  const lw = R * 0.22, a0 = near ? 0 : PI, a1 = near ? PI : TAU;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.ellipse(x, y, R, R * SQ, 0, a0, a1); ctx.strokeStyle = css(Lk.C(earth, near ? 0.88 : 0.76, fog)); ctx.lineWidth = lw; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(x, y - lw * 0.26, R, R * SQ, 0, a0 + 0.05, a1 - 0.05); ctx.strokeStyle = css(mix(Lk.C(earth, near ? 1.14 : 0.98, fog), Lk.sun, 0.1)); ctx.lineWidth = lw * 0.42; ctx.stroke();
  if (R > 26) {                                     // bits of plant lining woven into the rim
    ctx.lineWidth = Math.max(0.8, R * 0.016);
    for (let i = 0; i < 16; i++) { const a = lerp(a0 + 0.08, a1 - 0.08, hash(i, seed, near ? 3 : 5)), px = x + Math.cos(a) * R * (0.96 + 0.1 * hash(i, 2, seed)), py = y + Math.sin(a) * R * SQ - lw * (0.1 + 0.3 * hash(i, 4, seed)), d = (hash(i, 9, seed) - 0.5) * R * 0.3;
      ctx.strokeStyle = css(Lk.C(i % 3 ? [112, 122, 66] : [128, 98, 62], near ? 1 : 0.8, fog)); ctx.beginPath(); ctx.moveTo(px - d, py + lw * 0.1); ctx.quadraticCurveTo(px, py - lw * 0.3, px + d, py - lw * 0.05); ctx.stroke(); }
  }
}
function eggShape(ctx, rx, ryT, ryB) { ctx.beginPath(); ctx.ellipse(0, 0, rx, ryB, 0, 0, PI); ctx.ellipse(0, 0, rx, ryT, 0, PI, TAU); ctx.closePath(); }
function eggFill(ctx, rx, ry, base, Lk, fog = 0) {
  const g = ctx.createRadialGradient(-rx * 0.3, -ry * 0.4, ry * 0.08, 0, 0, Math.max(rx, ry) * 1.15);
  g.addColorStop(0, css(mix(Lk.C(base, 1.2, fog), Lk.sun, 0.2))); g.addColorStop(0.55, css(Lk.C(base, 1, fog))); g.addColorStop(1, css(Lk.C(base, 0.66, fog)));
  return g;
}
// a whole egg lying on its side (rot) or standing (rot 0 with ryT > ryB)
function egg(ctx, x, y, rx, ry, rot, base, Lk, fog = 0, a = 1) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.globalAlpha = a;
  ctx.fillStyle = eggFill(ctx, rx, ry, base, Lk, fog); ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, TAU); ctx.fill();
  ctx.restore(); ctx.globalAlpha = 1;
}
function mound(f, Lk, earth, yM, seed) {
  const { ctx, w, h } = f, top = x => yM + h * 0.012 * Math.sin(x / w * 7 + seed) - h * 0.018 * Math.exp(-Math.pow(x / w - 0.5, 2) / 0.06);
  const g = ctx.createLinearGradient(0, yM - h * 0.02, 0, h);
  g.addColorStop(0, css(mix(Lk.C(earth, 1.12), Lk.sun, 0.08))); g.addColorStop(0.3, css(Lk.C(earth, 1))); g.addColorStop(1, css(Lk.C(earth, 0.74)));
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, h + 2);
  for (let i = 0; i <= 32; i++) ctx.lineTo(i / 32 * w, top(i / 32 * w));
  ctx.lineTo(w, h + 2); ctx.closePath(); ctx.fill();
  for (let i = 0; i < 46; i++) {                    // dapples and pebbles
    const x = hash(i, seed, 1) * w, u = hash(i, seed, 2), y = lerp(top(x) + h * 0.012, h, u * u), r = h * (0.012 + 0.05 * hash(i, seed, 3)) * (0.5 + u);
    if (i % 5 === 0) { ctx.fillStyle = css(Lk.C([150, 140, 126], 0.95)); ctx.beginPath(); ctx.ellipse(x, y, r * 0.22, r * 0.14, 0, 0, TAU); ctx.fill(); continue; }
    ctx.fillStyle = i % 2 ? css(Lk.sun, 0.07 + 0.05 * (1 - Lk.night)) : 'rgba(40,24,30,.07)'; ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r * 0.3, 0, 0, TAU); ctx.fill();
  }
  ctx.strokeStyle = css(Lk.sun, 0.22); ctx.lineWidth = Math.max(1, h * 0.004); ctx.beginPath();
  for (let i = 0; i <= 32; i++) { const x = i / 32 * w; i ? ctx.lineTo(x, top(x) + h * 0.002) : ctx.moveTo(x, top(x) + h * 0.002); } ctx.stroke();
  return top;
}
function sprig(f, Lk, kind, seed, x, y, k, flip) {
  const sway = windX(f.p.wind) * (0.4 + 0.6 * Math.sin(f.t * 1.2 + seed)), pal = {};
  const b = Math.min(1, f.era.dark * 1.2) * 0.8;
  for (const t in PT) pal[t] = css(Lk.C(mix(PT[t], [60, 55, 50], b), 0.8));
  drawParts(f.ctx, plantParts(kind, seed, sway), { x, y, k, dir: flip }, { pal });
}

// ---------------------------------------------------------------- close-up: an Oviraptor brooding
const SMALL = new Set(['fern', 'flowers', 'rock', 'reed', 'horsetail', 'bones', 'log']);
const LOW = new Set(['bush', 'cycad', 'boulder', 'stump']);
const EGG_BLUE = [150, 200, 190], EGG_BUFF = [226, 206, 170];
function drawBrood(f, v, Lk, babies, hearts) {
  const { ctx, w, h, p } = f, t = f.t, E = f.era, sp = species('oviraptor'), earth = groundBase(f, v, 1);
  const zoom = Math.pow(2, (p.scale - 0.5) * 1.2), k = Math.min(w * 0.44, h * 0.8) * zoom, cx = w * 0.5, gy = h * 0.84;
  mound(f, Lk, earth, h * 0.665, 3);
  sprig(f, Lk, 'rock', 5, w * 0.1, h * 0.8, k * 0.5, 1); sprig(f, Lk, 'fern', 11, w * 0.93, h * 0.97, k * 0.5, -1); sprig(f, Lk, 'rock', 8, w * 0.84, h * 0.76, k * 0.22, 1);
  const R = 0.62 * k, N = Math.round(lerp(8, 22, babies) / 2) * 2, er = 0.47 * k;
  softShadow(ctx, cx, gy + R * SQ * 0.3, R * 1.5, 0.3 * (0.4 + 0.6 * Lk.light));
  nestFloor(ctx, cx, gy, R, Lk, earth, 0); nestRim(ctx, cx, gy, R, Lk, earth, 0, false, 3);
  const eggs = [];
  for (let i = 0; i < N; i++) { const a = (i + 0.5 + (i % 2 ? -0.17 : 0.17)) / N * TAU + 0.2; eggs.push({ a, z: Math.sin(a), i }); }
  const drawEgg = e => { const c = Math.cos(e.a), s = e.z, x = cx + c * er, y = gy + s * er * SQ - 0.02 * k, len = 0.088 * k * (0.5 + 0.5 * Math.abs(c)) + 0.03 * k, rot = Math.atan2(s * SQ + 0.12 * Math.abs(c), c);
    egg(ctx, x, y, len, 0.04 * k, c < 0 ? rot + PI : rot, EGG_BLUE, Lk); };
  for (const e of eggs) if (e.z < 0) drawEgg(e);
  // the adult, folded down over the middle of the ring; it watches, dozes and looks down at the eggs
  const alive = E.dinos;
  if (alive > 0.02) {
    const peek = smooth(0.55, 0.9, Math.sin(t * 0.17 + 1)), headTo = lerp(0.22 + 0.25 * Math.sin(t * 0.31), -0.5, peek);
    const q = pose(sp, { crouch: 0.93, headTo, t, phase: 0.1, jaw: 0.05 * Math.max(0, Math.sin(t * 0.9)) });
    const T = { x: cx - 0.2 * k, y: gy - 0.035 * k, k, dir: 1 };
    softDino(ctx, parts(q), T, sp, Lk, { L: q.L, alpha: alive });
    if (Lk.cold > 0.05) breath(ctx, q, T, Lk, t, 3, Lk.cold * alive, h);
    const hc = fract(t / 11); if (hearts > 0.02 && peek > 0.5 && hc < 0.5) heart(ctx, T.x + (q.head.x + q.head.len * 0.4) * k, T.y - (q.head.y + q.head.len * 0.9) * k - hc * h * 0.12, h * 0.016 * (0.6 + hearts), Math.sin(PI * hc / 0.5) * 0.9 * alive);
  }
  for (const e of eggs) if (e.z >= 0) drawEgg(e);
  nestRim(ctx, cx, gy, R, Lk, earth, 0, true, 3);
  sprig(f, Lk, 'fern', 4, w * 0.04, h * 1.0, k * 0.55, 1);
}

// ---------------------------------------------------------------- close-up: a clutch hatching
const refTip = new Map();
function drawHatch(f, v, Lk, babies, hearts) {
  const { ctx, w, h, p } = f, t = f.t, E = f.era, e = 0.4 + 1.2 * clamp(p.activity), earth = groundBase(f, v, 1);
  const zoom = Math.pow(2, (p.scale - 0.5) * 1.2), k = Math.min(w * 0.4, h * 0.72) * zoom, cx = w * 0.45, gy = h * 0.84;
  const sp = standIn('maiasaura', E.ma), alive = sp ? (sp.plan === 'bird' ? 1 : E.dinos) : 0;
  mound(f, Lk, earth, h * 0.665, 7);
  sprig(f, Lk, 'fern', 21, w * 0.08, h * 0.78, k * 0.4, 1); sprig(f, Lk, 'fern', 23, w * 0.9, h * 0.8, k * 0.34, -1);
  const R = 0.78 * k, headX = cx + 0.3 * k;
  // the parent: body out of frame, the head comes down over the nest
  if (alive > 0.02) {
    let tip = refTip.get(sp.id);
    if (tip == null) { const q0 = pose(sp, { headTo: -0.7 }); refTip.set(sp.id, tip = q0.head.x + Math.cos(q0.head.a) * q0.head.len); }
    const nuzzle = 0.5 + 0.5 * Math.sin(t * 0.33 * e), headTo = lerp(-0.62, -0.97, smooth(0.15, 0.85, nuzzle)), kp = k * 0.62;
    const q = pose(sp, { headTo, t, phase: 0.3, jaw: 0.12 * Math.max(0, Math.sin(t * 1.7)) * nuzzle });
    const T = { x: headX + tip * kp, y: gy - 0.25 * R * SQ, k: kp, dir: -1 };
    softShadow(ctx, T.x - q.nodes[q.iSh].x * kp, T.y, q.L * kp * 0.2, 0.25 * alive * (0.4 + 0.6 * Lk.light));
    softDino(ctx, parts(q), T, sp, Lk, { L: q.L, alpha: alive });
    if (Lk.cold > 0.05) breath(ctx, q, T, Lk, t, 5, Lk.cold * alive, h);
    const hc = fract(t / 9 + 0.3); if (hearts > 0.02 && hc < 0.45) heart(ctx, headX + 0.1 * k, T.y - (q.head.y + q.head.len * 0.9) * kp - hc * h * 0.14, h * 0.017 * (0.6 + hearts), Math.sin(PI * hc / 0.45) * 0.9 * alive);
  }
  softShadow(ctx, cx, gy + R * SQ * 0.35, R * 1.45, 0.3 * (0.4 + 0.6 * Lk.light));
  nestFloor(ctx, cx, gy, R, Lk, earth, 0); nestRim(ctx, cx, gy, R, Lk, earth, 0, false, 7);
  const N = Math.round(lerp(4, 10, babies)), rx = 0.06 * k, ryT = 0.1 * k, ryB = 0.072 * k, list = [];
  const hs = sp ? clamp(0.37 / sp.len, 0.012, 0.3) : 0.05, P1 = 46 / e;
  const shellIn = css(Lk.C([120, 100, 84], 0.8)), crackC = css(Lk.C([92, 70, 56], 0.9));
  const zig = (ctx, amp, c = 1) => { const n = 8; for (let j = 0; j <= n; j++) { const u = j / n; if (Math.abs(u - 0.5) * 2 > c + 0.001) continue; const x = lerp(-rx, rx, u) * 0.985, y = (j % 2 ? -1 : 1) * amp * (j === 0 || j === n ? 0 : 1); ctx.lineTo(x, y); } };
  for (let i = 0; i < N; i++) {
    const ang = i * 2.39996 + 0.6, rad = Math.sqrt((i + 0.5) / N) * 0.5, ex = Math.cos(ang) * rad * 1.3, ez = Math.sin(ang) * rad;
    const X = cx + ex * k, Y = gy + ez * SQ * k + 0.01 * k, u = alive > 0.5 ? fract(t / P1 + hash(i, 17) + i * 0.618) : 0.1;
    const crack = smooth(0.26, 0.44, u), open = smooth(0.44, 0.48, u), rise = smooth(0.45, 0.57, u), climb = smooth(0.57, 0.69, u), gone = smooth(0.93, 0.985, u), born = smooth(0.955, 1, u);
    const wob = (smooth(0.14, 0.26, u) * 0.05 + crack * 0.11) * (1 - open) * Math.sin(t * 9 + i * 2) * Math.max(0, Math.sin(t * 1.3 + i * 2.1));
    const side = ex < 0.15 ? 1 : -1, eqY = Y - ryB;
    const eggAt = (a, rot, withCrack) => { ctx.save(); ctx.translate(X, Y); ctx.rotate(rot); ctx.translate(0, -ryB); ctx.globalAlpha = a;
      eggShape(ctx, rx, ryT, ryB); ctx.fillStyle = eggFill(ctx, rx, ryT, EGG_BUFF, Lk); ctx.fill();
      ctx.fillStyle = css(Lk.C([150, 120, 96]), 0.5); for (let j = 0; j < 7; j++) { ctx.beginPath(); ctx.arc((hash(i, j, 1) - 0.5) * rx * 1.4, (hash(i, j, 2) - 0.55) * ryT * 1.3, rx * 0.05, 0, TAU); ctx.fill(); }
      if (withCrack > 0.02) { ctx.strokeStyle = crackC; ctx.lineWidth = Math.max(0.8, rx * 0.06); ctx.lineJoin = 'round'; ctx.beginPath(); zig(ctx, rx * 0.17, withCrack); ctx.stroke();
        if (withCrack > 0.5) { ctx.beginPath(); ctx.moveTo(rx * 0.1, -rx * 0.17); ctx.lineTo(rx * 0.25, -ryT * 0.45 * withCrack); ctx.lineTo(rx * 0.05, -ryT * 0.7 * withCrack); ctx.stroke(); } }
      ctx.restore(); ctx.globalAlpha = 1; };
    const cup = (a, front) => { ctx.save(); ctx.translate(X, eqY); ctx.globalAlpha = a;
      if (!front) { ctx.fillStyle = shellIn; ctx.beginPath(); ctx.ellipse(0, 0, rx * 0.97, rx * 0.3, 0, 0, TAU); ctx.fill(); }
      else { ctx.fillStyle = eggFill(ctx, rx, ryT, EGG_BUFF, Lk); ctx.beginPath(); ctx.moveTo(-rx, 0); zig(ctx, rx * 0.17); ctx.ellipse(0, 0, rx, ryB, 0, 0, PI); ctx.closePath(); ctx.fill(); }
      ctx.restore(); ctx.globalAlpha = 1; };
    const cap = a => { const o = smooth(0.44, 0.6, u), px = X - side * rx * (0.3 + 2.1 * o), py = lerp(eqY, Y + 0.012 * k, o * o) - Math.sin(PI * Math.min(1, o)) * ryT * 0.9;
      ctx.save(); ctx.translate(px, py); ctx.rotate(-side * o * 2.5); ctx.globalAlpha = a; ctx.fillStyle = eggFill(ctx, rx, ryT, EGG_BUFF, Lk);
      ctx.beginPath(); ctx.moveTo(rx, 0); for (let j = 7; j >= 1; j--) ctx.lineTo(lerp(-rx, rx, j / 8), (j % 2 ? -1 : 1) * rx * 0.17); ctx.lineTo(-rx, 0); ctx.ellipse(0, 0, rx, ryT, 0, PI, TAU); ctx.closePath(); ctx.fill(); ctx.restore(); ctx.globalAlpha = 1; };
    if (open <= 0) { list.push({ z: ez, fn: () => eggAt(1, wob, crack) }); continue; }
    const fade = 1 - gone;
    list.push({ z: ez - 0.02, fn: () => { cup(fade, false); if (born > 0) eggAt(born, 0, 0); } });
    list.push({ z: ez + 0.06, fn: () => cap(fade) });
    // the hatchling: up through the hole, over the edge, then at home in the nest
    const out = smooth(0.69, 0.74, u), sits = i % 2 === 0, dir = X < headX ? 1 : -1;
    const toddle = sits ? 0 : out, sx = toddle * Math.sin(t * 0.5 + i * 2.4) * 0.11 * k, vx = toddle * Math.cos(t * 0.5 + i * 2.4);
    const crouch = sits ? out * 0.85 : 0, qh = sp && pose(sp, { scale: hs, young: 1, t: t + i * 3, phase: climb > 0 ? t * 1.5 * e + i + sx / (k * 0.2) : 0.2, rear: 0.55 * (1 - climb), headTo: lerp(0.7, sits ? 0.75 : 0.25, out), crouch,
      jaw: sits ? out * 0.6 * Math.max(0, Math.sin(t * 3.1 + i)) : 0.3 * (1 - climb) * Math.max(0, Math.sin(t * 5 + i)) });
    if (!qh) continue;
    const Hk = qh.H * k, Xs = X + side * 0.21 * k, Ys = Y + 0.03 * k, mid = qh.nodes[qh.iSh].x * 0.5 * k;
    const tx = lerp(X - dir * mid, Xs, climb) + sx, ty = lerp(eqY + Hk * lerp(1.9, 0.45, rise), Ys, climb) - Math.sin(PI * climb) * 0.07 * k;
    const tdir = toddle > 0.5 ? clamp(vx * 5, -1, 1) || 1 : dir, T = { x: tx, y: ty, k, dir: Math.abs(tdir) < 0.14 ? 0.14 * Math.sign(tdir || 1) : tdir };
    list.push({ z: ez + lerp(0, 0.1, climb), fn: () => {
      if (climb > 0.5) softShadow(ctx, tx + mid * T.dir, ty, qh.L * k * 0.3, 0.22 * fade * (0.4 + 0.6 * Lk.light));
      if (climb < 0.02) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, eqY + rx * 0.1); ctx.clip(); }
      softDino(ctx, parts(qh), T, sp, Lk, { L: Math.max(qh.L, 60 / k), alpha: fade });
      if (climb < 0.02) ctx.restore();
      if (hearts > 0.02 && out > 0.9 && sits) { const hc = fract(t / 8 + i * 0.41); if (hc < 0.4 && hash(i, Math.floor(t / 8 + i * 0.41)) < 0.3 + hearts * 0.6) heart(ctx, tx + qh.head.x * k * T.dir, ty - (qh.head.y + qh.head.len * 1.6) * k - hc * h * 0.1, h * 0.011 * (0.6 + hearts), Math.sin(PI * hc / 0.4) * 0.9 * fade); }
    } });
    list.push({ z: ez + (climb < 0.5 ? 0.02 : -0.01), fn: () => cup(fade, true) });
  }
  list.sort((a, b) => a.z - b.z);
  for (const it of list) it.fn();
  nestRim(ctx, cx, gy, R, Lk, earth, 0, true, 7);
  sprig(f, Lk, 'fern', 4, w * 0.02, h * 1.01, k * 0.5, 1); sprig(f, Lk, 'fern', 9, w * 0.985, h * 1.02, k * 0.45, -1);
}

// ---------------------------------------------------------------- family manners on top of the world's behaviour
// Each is switched on by a scene opt. They only steer the world's actors (targets, idles, postures); the world
// still does the walking, turning and animation.
function manners(W, f, after) {
  const o = W.opts, A = W.actors, t = f.t;
  if (!A.length) return;
  const adults = A.filter(a => a.role !== 'young' && a.role !== 'pred' && !a.leaving);
  for (const a of A) if (!a._fam) {                  // once per new arrival
    a._fam = 1;
    if (o.grown && a.role === 'young') { a.scale = lerp(o.grown[0], o.grown[1], a.seed); a.young = 0.3; }
    if (o.middle && a.role !== 'young') a._new = 1;
  }
  if (o.middle && adults.length) {                   // the young walk in the middle of the herd, between the adults' lanes
    const G0 = W.groups.find(Boolean); for (const G of W.groups) if (G && G0) { G.anchor = G0.anchor; G.moving = G0.moving; G.timer = G0.timer; G.dir = G0.dir; }
    let lo = 1e9, hi = 0; for (const a of adults) { const l = a._lane ??= a.lane; lo = Math.min(lo, l); hi = Math.max(hi, l); }
    const L0 = adults[0].sp.len, far = adults.filter(a => a._lane > (lo + hi) / 2 - 0.01), near = adults.filter(a => !far.includes(a));
    far.forEach((a, j) => { a.ox = (j - (far.length - 1) / 2) * L0 * 0.8 + L0 * 0.12; });
    near.forEach((a, j) => { a.ox = (j % 2 ? 1 : -1) * L0 * (0.78 + 0.5 * (j >> 1)) - L0 * 0.05; });
    for (const a of adults) if (a._new) { a._new = 0; a.lane = a._lane * (0.96 + 0.08 * a.seed); if (after) { a.d = a.lane; a.x = a.tx = G0.anchor + a.ox; a.dir = G0.dir; } }
    const mid = lerp(lo, hi, 0.3), kids = A.filter(a => a.role === 'young' && !a.leaving), len = adults[0].sp.len;
    kids.forEach((a, i) => {
      if (a.parent && a.parent._proxy && !after) return;
      const G = W.groups[a.group]; if (!G) return;
      const off = lerp(-0.12, 0.62, (i + 0.5) / kids.length) * len * (near.length ? -Math.sign(near[0].ox) : 1) , back = len * (0.25 + a.seed * 0.5);
      a.parent = { _proxy: 1, sp: a.sp, leaving: false, idle: 'graze', get dir() { return G.dir; }, get x() { return G.anchor + off + G.dir * back; }, get lane() { return mid * (0.96 + 0.08 * a.seed) / (0.92 + a.seed * 0.14); }, get v() { return G.moving ? 1 : 0; } };
      if (after) { a.x = a.tx = G.anchor + off; a.d = a.lane = mid * (0.96 + 0.08 * a.seed); a.dir = G.dir; }
    });
  }
  if (o.crowd) for (const a of A) if (a.role === 'young' && a.parent && !a.parent._proxy) {     // a loose crowd around the adult, not a queue behind it
    const pr = a.parent, len = pr.sp.len, ox = (hash(a.id, 3) - 0.5) * len * o.crowd + pr.dir * len * (0.25 + a.seed * 0.5), lk = lerp(0.88, 1.3, hash(a.id, 5)) / (0.92 + a.seed * 0.14);
    a.parent = { _proxy: 1, sp: pr.sp, get leaving() { return pr.leaving; }, get idle() { return pr.idle; }, get dir() { return pr.dir; }, get x() { return pr.x + ox; }, get lane() { return pr.lane * lk; }, get v() { return pr.v; } };
    if (after) { a.x = a.tx = pr.x + ox - pr.dir * len * (0.25 + a.seed * 0.5); a.d = a.lane = pr.lane * lk * (0.92 + a.seed * 0.14); }
  }
  if (o.centre && after && adults.length) { const G = W.groups.find(Boolean), m = adults.reduce((s, a) => s + a.x, 0) / adults.length - (G?.home ?? 0); for (const a of A) { a.x -= m; a.tx -= m; }
    if (adults.length > 1) [...adults].sort((a, b) => a.seed - b.seed).forEach((a, i) => { const x = (G?.home ?? 0) + (i - (adults.length - 1) / 2) * a.sp.len * o.centre, dx = x - a.x; a.x = a.tx = x; for (const b of A) if (b.role === 'young' && b.parent === a) { b.x += dx; b.tx += dx; } }); }
  if (o.tend && W.nests) adults.slice(0, W.nests.length).forEach((a, i) => {      // a parent at each nest, bringing food
    const n = W.nests[i], home = W.groups.find(Boolean)?.home ?? 0, di = n.x > home + 1 ? 1 : -1;
    a.busy = 1; a.lane = n.d * 1.03; a.tx = n.x - di * a.sp.len * a.scale * 0.47;
    if (!a._tend || after) { a._tend = 1; a.x = a.tx; a.d = a.lane; a.dir = di; a.turn = 0; }
    const c = fract(t * 0.045 + i * 0.37); a.idle = c < 0.5 ? 'feed' : c < 0.74 ? 'look' : c < 0.8 ? 'call' : 'feed';
  });
  if (o.sleep) {                                     // everyone lies down but one
    adults.forEach((a, i) => { a.tx = a.x; a.timer = 5; a.idle = i === 0 ? 'look' : 'rest'; a.asleep = i !== 0; if (after && i) { a.crouch = 1; a.headTo = -0.2; } });
    if (after !== undefined) for (const a of A) if (a.role === 'young') { a.asleep = true; a.crouch = 1; a.headTo = -0.3; a.jaw = 0; if (a._pin == null || after) a._pin = a.x; a.x = a.tx = a._pin; a.v = 0; }
  }
  if (o.standoff && W.hunt) {                        // the horned ones are already facing the hunter down
    const H = W.hunt, preds = A.filter(a => a.role === 'pred' && !a.leaving);
    if (preds.length && adults.length) {
      const qx = adults.reduce((s, a) => s + a.x, 0) / adults.length, px = preds[0].x, away = Math.sign(qx - px) || 1, big = preds[0].sp.len;
      if (after) {                                   // line the adults up, shoulder to shoulder in depth
        H.phase = 'wall'; H.wall = 0;
        [...adults].sort((a, b) => a.lane - b.lane).forEach((a, i) => { a.x = a.tx = qx + (i - (adults.length - 1) / 2) * a.sp.len * 0.3 * away; a.dir = -away; a.turn = 0; });
        preds.forEach((a, i) => { a.x = a.tx = qx - away * (big * 1.3 + a.sp.len * i); a.dir = away; a.turn = 0; });
        for (const a of A) if (a.role === 'young' && a.parent) { a.x = a.tx = a.parent.x + away * a.parent.sp.len * (0.3 + a.seed * 0.45); a.dir = -away; }
      }
      if (H.phase === 'standoff') { H.phase = 'wall'; H.wall = 0; }
      if (H.phase === 'wall') {                      // (a phase of our own: the world's hunt logic leaves it alone)
        H.wall += f.dt || 0; H.timer = 9;
        for (const a of adults) { a.busy = 1; a.tx = a.x; a.idle = 'guard'; if (a.dir !== -away && !a.turn) a.turn = 0.001; }
        preds.forEach((a, i) => { const gap = Math.abs(qx - a.x); a.busy = 1; a.hurry = 0.2; a.tx = gap > big * 1.8 ? qx - away * big * 1.35 : gap < big * 1.0 ? a.x - away * big * 0.3 : a.x;
          const c = fract(t * 0.11 + i * 0.3); a.idle = c < 0.28 ? 'call' : c < 0.55 ? 'stalk' : c < 0.8 ? 'look' : 'sniff';
          if (a.v < 0.05 && a.dir !== away && !a.turn && gap >= big * 1.0) a.turn = 0.001; });
        if (H.wall > 34) { H.phase = 'tired'; H.timer = 5; }
      } else if (H.phase === 'calm' && H.timer > 4) H.timer = 4;
    }
  }
}

const castWith = (cast, babies) => { const k = Math.round(lerp(0.35, 1.65, babies) * 20) / 20; return cast.map(e => e.young ? { ...e, young: Math.max(1, e.young * k) } : e); };

export default {
  id: 'family',
  name: 'Families & Nests',
  kind: '2d',
  sky: true,
  params: [
    { id: 'x1', label: 'Babies', value: 0.5, tip: 'How many young (or eggs in the close-ups)' },
    { id: 'x2', label: 'Dust', value: 0.5, tip: 'Dust kicked up at each footfall, and breath in cold air' },
    { id: 'x3', label: 'Warmth', value: 0.6, tip: 'How golden the light is' },
    { id: 'x4', label: 'Hearts', value: 0.3, tip: 'A small heart now and then, when the young are close to a parent (0 = none)' },
  ],
  create(ctx, opts) {
    let W = null, key = '';
    const noClicks = { x: 0.5, y: 0.5, down: false, moved: false, dragX: 0, dragY: 0, clicks: [] };
    return {
      render(f) {
        const p = f.p, { w, h } = f, t = f.t, E = f.era;
        // Babies changes the cast, so it rebuilds the world
        const cast = castWith(opts.cast || [], p.x1), ck = cast.map(e => e.young || 0).join();
        if (!W || ck !== key) { W = createWorld({ ...opts, cast }); key = ck; }
        const fresh = Math.abs(f.stage - W.lastStage) > 0.03 || f.epoch !== W.lastEpoch || W.lastStage < -1 || Math.abs((W.lastHerd ?? p.herd) - p.herd) > 0.2;
        manners(W, f);
        let v = W.frame(f);
        if (fresh) {                                 // a new cast: put everyone in their places and let them settle
          manners(W, f, true);
          for (let i = 6; i > 0; i--) { const g = { ...f, dt: 0.4, t: t - i * 0.4, sig: null, pointer: noClicks }; manners(W, g, false); W.frame(g); }
          manners(W, f, false);
          v = W.frame({ ...f, dt: 0 });
        }
        manners(W, f, false);
        const Lk = lighting(f, v, p.x3), C = Lk.C, dustAmt = p.x2 * 2, hearts = p.x4;
        const polar = v.biome.far === 'mountains' && v.biome.ground[0] === '#e6eef2';
        Lk.cold = clamp(Math.max(Lk.night * 1.2, Lk.dark * 1.3, polar ? 1 : 0, 0.7 - E.warm)) * (0.4 + 1.2 * p.x2);
        const dusty = clamp(1.15 - v.biome.density * 0.9, 0.2, 1) * (v.biome.water ? 0.6 : 1), dustC = polar ? C([240, 244, 250]) : C(mix(groundBase(f, v, 0.8), [255, 240, 214], 0.45), 1.05);
        const land = W.land, wet = v.biome.water > 0;
        let nearD = 1e9, farD = 0; for (const a of v.actors) if (!a.leaving) { if (a.d < nearD) nearD = a.d; if (a.d > farD) farD = a.d; }

        paintWorld(f, v, {
          sky() {
            const top = mix(mix([100, 158, 212], [92, 100, 164], Lk.dusk), [8, 12, 34], Lk.night), mid = mix(mix([178, 208, 224], [238, 158, 128], Lk.dusk), [22, 30, 68], Lk.night);
            const hor = mix(mix([244, 236, 206], [255, 218, 152], Lk.dusk), [56, 70, 116], Lk.night), wm = (p.x3 - 0.5) * 0.3 * (1 - Lk.night);
            const g = ctx.createLinearGradient(0, 0, 0, v.horizon);
            g.addColorStop(0, css(mix(top, [150, 150, 170], Math.max(0, wm)))); g.addColorStop(0.62, css(mix(mid, [255, 214, 170], Math.max(0, wm)))); g.addColorStop(1, css(hor));
            ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
            if (v.dark > 0) { ctx.fillStyle = `rgba(38,26,20,${v.dark * 0.78})`; ctx.fillRect(0, 0, w, h); }
            // long soft clouds low in the sky
            const cc = mix(mix([255, 252, 244], [255, 206, 170], Lk.dusk), [70, 84, 130], Lk.night), drift = t * windX(p.wind) * h * 0.004;
            for (let i = 0; i < 7; i++) { const cw = h * (0.35 + 0.5 * hash(i, 31)), span = w + cw * 2, x = ((hash(i, 32) * span + drift * (0.5 + hash(i, 33))) % span + span) % span - cw, y = v.horizon * (0.25 + 0.62 * hash(i, 34));
              puffAt(ctx, cc, x, y, cw, (0.5 - 0.25 * Lk.night) * (1 - v.dark), h * (0.018 + 0.03 * hash(i, 35))); puffAt(ctx, cc, x + cw * 0.3, y - h * 0.012, cw * 0.55, (0.45 - 0.2 * Lk.night) * (1 - v.dark), h * 0.03); }
          },
          sun() {
            const s = v.sun, a = 1 - v.dark;
            if (s.night > 0.3) { for (let i = 0; i < 110; i++) { const tw = 0.6 + 0.4 * Math.sin(t * (1 + hash(i, 6) * 2) + i), r = h * (hash(i, 5) < 0.12 ? 0.0042 : 0.0026);
              ctx.fillStyle = `rgba(236,240,255,${(s.night - 0.3) * 1.3 * a * tw * (0.4 + 0.6 * hash(i, 8))})`; ctx.fillRect(hash(i, 1) * w, hash(i, 2) * v.horizon * 0.96, r, r); } }
            const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 8), gc = s.moon ? '214,226,255' : `255,${232 - s.dusk * 30 | 0},${186 - s.dusk * 50 | 0}`;
            g.addColorStop(0, `rgba(${gc},${0.75 * a})`); g.addColorStop(0.25, `rgba(${gc},${0.3 * a})`); g.addColorStop(1, `rgba(${gc},0)`);
            ctx.fillStyle = g; ctx.fillRect(s.x - s.r * 8, s.y - s.r * 8, s.r * 16, s.r * 16);
            ctx.fillStyle = s.moon ? `rgba(244,246,252,${a})` : `rgba(255,${246 - s.dusk * 40 | 0},${214 - s.dusk * 70 | 0},${a})`;
            ctx.beginPath(); ctx.arc(s.x, s.y, s.r * (s.moon ? 0.85 : 1.1), 0, TAU); ctx.fill();
            if (s.moon) { ctx.fillStyle = `rgba(200,208,230,${0.5 * a})`; ctx.beginPath(); ctx.arc(s.x - s.r * 0.25, s.y - s.r * 0.15, s.r * 0.2, 0, TAU); ctx.arc(s.x + s.r * 0.25, s.y + s.r * 0.3, s.r * 0.14, 0, TAU); ctx.fill(); }
          },
          meteor: paintMeteor,
          far(f, v, l, i) {
            let top = 1e9; for (const q of l.pts) if (q[1] < top) top = q[1];
            const base = Lk.C(mix(groundBase(f, v, 0), [104, 114, 140], 0.5), 0.95, 0.56 - i * 0.2), g = ctx.createLinearGradient(0, top, 0, l.bottom);
            g.addColorStop(0, css(base)); g.addColorStop(1, css(mix(base, Lk.haze, 0.55)));
            ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(l.pts[0][0], l.bottom); for (const q of l.pts) ctx.lineTo(q[0], q[1]); ctx.lineTo(l.pts[l.pts.length - 1][0], l.bottom); ctx.closePath(); ctx.fill();
          },
          sea() {
            const g = ctx.createLinearGradient(0, v.sea.y0, 0, v.sea.y1);
            g.addColorStop(0, css(mix(C([70, 130, 160]), Lk.haze, 0.5))); g.addColorStop(1, css(C([52, 138, 156])));
            ctx.fillStyle = g; ctx.fillRect(0, v.sea.y0, w, v.sea.y1 - v.sea.y0 + 2);
            ctx.fillStyle = css(Lk.sun, 0.25 * (1 - v.dark)); for (let i = 0; i < 14; i++) { const y = lerp(v.sea.y0, v.sea.y1, hash(i, 41)), x = v.sun.x + (hash(i, 42) - 0.5) * w * 0.3 * (0.3 + hash(i, 41)); ctx.fillRect(x, y, w * (0.01 + 0.03 * hash(i, 43)), Math.max(1, h * 0.003)); }
          },
          ground(f, v, b) {
            const i = v.layers.indexOf(b), nx = v.layers[i + 1], base = groundBase(f, v, b.u), fog = (1 - b.u) * 0.42;
            let top = 1e9; for (const q of b.pts) if (q[1] < top) top = q[1];
            const g = ctx.createLinearGradient(0, top, 0, Math.max(top + 4, Math.min(h, b.next + h * 0.05)));
            g.addColorStop(0, css(mix(C(base, 1.1 * Lk.gl, fog), Lk.sun, 0.06 + 0.1 * Lk.night))); g.addColorStop(1, css(C(base, 0.93 * Lk.gl, fog)));
            ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(b.pts[0][0], h + 2); for (const q of b.pts) ctx.lineTo(q[0], q[1]); ctx.lineTo(b.pts[b.pts.length - 1][0], h + 2); ctx.closePath(); ctx.fill();
            if (b.u > 0.2 && p.detail > 0.15) {        // dapples: flecks of light and shade lying on the ground
              const dn = nx ? nx.d : b.d * 0.8, dm = (b.d + dn) / 2, kd = v.sx(1, dm) - v.sx(0, dm), xl = v.camX - w / 2 / kd, span = w / kd;
              const cs = Math.pow(2, Math.round(Math.log2(span / 9))), c0 = Math.floor(xl / cs) - 1, c1 = Math.ceil((xl + span) / cs) + 1;
              ctx.save(); ctx.clip();
              const lightC = css(Lk.sun, (0.1 + 0.05 * Lk.dusk) * (1 - v.dark)), darkC = `rgba(30,24,44,${0.085})`;
              for (let c = c0; c <= c1; c++) for (let j = 0; j < 2; j++) {
                const x = (c + hash(c, i, 51 + j)) * cs, dd = lerp(b.d, dn, hash(c, i, 53 + j)), y = land(x, dd); if (wet && y < 0) continue;
                const rx = cs * kd * (0.22 + 0.34 * hash(c, i, 55 + j)) * (v.sx(1, dd) - v.sx(0, dd)) / kd;
                ctx.fillStyle = j ? darkC : lightC; ctx.beginPath(); ctx.ellipse(v.sx(x, dd), v.sy(x, dd, y) + rx * 0.1, rx, rx * 0.15, 0, 0, TAU); ctx.fill();
              }
              ctx.restore();
            }
            ctx.strokeStyle = css(Lk.sun, 0.16 * (0.3 + 0.7 * b.u) * (1 - v.dark)); ctx.lineWidth = Math.max(1, h * 0.0035); ctx.lineJoin = 'round';
            ctx.beginPath(); b.pts.forEach((q, j) => j ? ctx.lineTo(q[0], q[1] + ctx.lineWidth * 0.5) : ctx.moveTo(q[0], q[1] + ctx.lineWidth * 0.5)); ctx.stroke();
          },
          water(f, v, b) {
            const n = b.pts.length, col = mix(C([84, 132, 150]), Lk.haze, 0.3 + (1 - b.u) * 0.3);
            const g = ctx.createLinearGradient(0, b.level, 0, b.next + 1); g.addColorStop(0, css(mix(col, Lk.sun, 0.22))); g.addColorStop(1, css(col));
            ctx.fillStyle = g;
            for (let i = 0; i < n; i++) if (b.wet[i]) { const x0 = i ? (b.pts[i - 1][0] + b.pts[i][0]) / 2 : b.pts[i][0], x1 = i < n - 1 ? (b.pts[i][0] + b.pts[i + 1][0]) / 2 : b.pts[i][0]; ctx.fillRect(x0 - 0.5, b.level, x1 - x0 + 1, b.next - b.level + 1); }
          },
          plant(f, v, it) {
            if (it.x < -it.k * 14 || it.x > w + it.k * 14) return;
            if (it.kind === 'nest') {                // the colony's nests: a ring of earth with the clutch inside
              const R = it.k * 1.15, y = it.y + R * 0.08, earth = groundBase(f, v, 0.9), n = 5 + (it.seed % 3);
              softShadow(ctx, it.x, y + R * 0.2, R * 1.3, 0.2 * (0.4 + 0.6 * Lk.light));
              nestFloor(ctx, it.x, y, R, Lk, earth, it.fog * 0.6); nestRim(ctx, it.x, y, R, Lk, earth, it.fog * 0.6, false, it.seed);
              for (let i = 0; i < n; i++) { const a = i * 2.4 + it.seed, r = Math.sqrt((i + 0.5) / n) * R * 0.6; egg(ctx, it.x + Math.cos(a) * r, y + Math.sin(a) * r * SQ - R * 0.1, R * 0.085, R * 0.11, 0, EGG_BUFF, Lk, it.fog * 0.6); }
              nestRim(ctx, it.x, y, R, Lk, earth, it.fog * 0.6, true, it.seed);
              return;
            }
            if (!SMALL.has(it.kind) && (it.d < nearD * 1.04 || it.d < farD * 1.03 && LOW.has(it.kind))) return;      // nothing big in front of the family
            drawParts(ctx, it.parts, { x: it.x, y: it.y, k: it.k, dir: 1 }, { pal: plantPal(Lk, it.fog * 0.8, E) });
          },
          dino(f, v, it) {
            const T = it.T, A = it.fade ?? 1; if (A <= 0.01) return;
            if (it.type !== 'dino') { softDino(ctx, it.parts, T, it.sp, Lk, { fog: it.fog * 0.85, alpha: A, flat: true }); return; }
            const a = it.actor, q = it.pose, k = T.k, fog = it.fog * 0.8, gy = T.y - feetY(q) * k, shX = q.nodes[q.iSh].x, big = q.L * k;
            if (it.wade) {
              ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, it.waterY); ctx.clip(); softDino(ctx, it.parts, T, it.sp, Lk, { L: q.L, fog, alpha: A, asleep: a.asleep }); ctx.restore();
              ctx.strokeStyle = css(Lk.sun, 0.4 * v.light * A); ctx.lineWidth = Math.max(1, k * 0.04); ctx.beginPath(); ctx.ellipse(T.x, it.waterY, it.sp.len * q.scale * k * 0.24, it.sp.len * q.scale * k * 0.02, 0, 0, TAU); ctx.stroke();
            } else {
              softShadow(ctx, T.x + shX * 0.5 * k * T.dir, gy, big * 0.31, 0.24 * (0.4 + 0.6 * v.light) * A * (1 - fog));
              softDino(ctx, it.parts, T, it.sp, Lk, { L: q.L, fog, alpha: A, asleep: a.asleep });
              // dust where the feet came down: worked out from the stride, so it needs no memory
              const G = gait(a.sp, a.run, a.scale);
              if (dustAmt > 0.02 && a.v > G.vWalk * 0.25 && big > 14) {
                const s2 = a.phase * 2, wgt = clamp(0.3 + Math.log10(Math.max(2, a.sp.mass * Math.pow(a.scale, 3))) / 5.5) * (1 + a.run), fs = q.H * k * 0.36 * (0.7 + wgt), life = 1.5 + wgt;
                for (let j = 0; j < 3; j++) for (let fr = 0; fr < (a.sp.P.biped ? 1 : 2); fr++) {
                  const age = s2 - Math.floor(s2) + j + (fr ? 0.5 : 0), dist = age * G.stride / 2, u = dist / a.v / life; if (u >= 1) continue;
                  const x = T.x + ((fr ? shX : 0) + G.stride * G.duty / 2 - dist) * k * T.dir + v.wind * u * fs * 1.5, al = dusty * dustAmt * 0.34 * wgt * Math.pow(1 - u, 1.4) * Math.min(1, u * 9) * A * (1 - fog);
                  puffAt(ctx, dustC, x, gy - fs * (0.25 + 0.9 * u), fs * (0.45 + 1.5 * u), al, fs * (0.3 + 0.9 * u)); puffAt(ctx, dustC, x - T.dir * fs * 0.7, gy - fs * (0.15 + 0.5 * u), fs * (0.35 + 1.1 * u), al * 0.8, fs * (0.22 + 0.6 * u));
                }
              }
            }
            if (Lk.cold > 0.05 && big > 26) breath(ctx, q, T, Lk, t, a.id, Lk.cold * A * (1 - fog), h);
            if (hearts > 0.02 && it.young && a.v < 0.15 && E.dinos > 0.9 && E.meteor <= 0) {
              const per = 9, u = fract(t / per + a.seed * 7), n = Math.floor(t / per + a.seed * 7);
              if (u < 0.4 && hash(a.id, n) < 0.1 + hearts * 0.45) heart(ctx, T.x + q.head.x * k * T.dir, T.y - (q.head.y + q.head.len * 1.3) * k - u * h * 0.09, clamp(big * 0.05, h * 0.007, h * 0.016) * (0.7 + hearts * 0.6), Math.sin(PI * u / 0.4) * 0.9 * A);
            }
          },
          fx() {}
        });
        if (opts.close === 'brood') drawBrood(f, v, Lk, p.x1, hearts);
        else if (opts.close === 'hatch') drawHatch(f, v, Lk, p.x1, hearts);
        paintFx(f, v);
      }
    };
  }
};

const S = (id, name, desc, tags, opts, params) => ({ id: 'family-' + id, name, desc, tags: ['storybook', '2d', 'family', ...tags], opts, params });
export const scenes = [
  S('maiasaura', 'Good Mother Lizards', 'A Maiasaura colony: a parent at each nest bringing food, hatchlings waiting in the bowl.', ['ornithopod', 'cretaceous', 'nest', 'herd'],
    { cast: [{ sp: 'maiasaura', n: 2.4, young: 7 }], mode: 'nest', tend: true, biome: { hills: 0.3, density: 0.3, tall: 0.2, far: 'hills', ground: ['#d6c79a', '#b39c68'], mult: { fern: 2 } }, seed: 9, nests: 3, frame: 1.8 }, { stage: 0.798, light: 0.72, herd: 0.5 }),
  S('sauropods', 'Young in the Middle', 'A Diplodocus herd on the march, the little ones walking between the adults.', ['sauropod', 'jurassic', 'herd'],
    { cast: [{ sp: 'diplodocus', n: 2, young: 3, lane: 1.5 }, { sp: 'diplodocus', n: 1, lane: 1.0 }], middle: true, grown: [0.3, 0.46], nonstop: true, frame: 1.3, biome: { hills: 0.4, density: 0.22, tall: 0.2, far: 'mesas', ground: ['#cdae7e', '#a47c52'], mult: { araucaria: 2, cycad: 1.5, fern: 0.6, rock: 2 } }, seed: 11 }, { stage: 0.44, light: 0.36, x2: 0.7 }),
  S('brood', 'Oviraptor on the Nest', 'Close up: an Oviraptor (species locked) broods its ring of eggs, as fossils found on their nests show.', ['theropod', 'cretaceous', 'nest'],
    { close: 'brood', cast: [{ sp: 'oviraptor', n: 2, lock: true, lane: 1.35 }], mode: 'wander', biome: 'desert', seed: 4, horizon: 0.5, foot: 0.64, frame: 2.4 }, { stage: 0.812, light: 0.42 }),
  S('hatch', 'Hatching Day', 'Close up: eggs crack, hatchlings climb out, and a parent lowers its head to the nest.', ['ornithopod', 'cretaceous', 'nest'],
    { close: 'hatch', cast: [{ sp: 'maiasaura', n: 2, lane: 1.4 }], mode: 'wander', biome: 'floodplain', seed: 6, horizon: 0.5, foot: 0.64, frame: 1.7 }, { stage: 0.798, light: 0.85 }),
  S('raptors', 'Deinonychus and Chicks', 'Feathered parents lead a brood of downy chicks through the conifer wood.', ['theropod', 'cretaceous', 'forest'],
    { cast: [{ sp: 'deinonychus', n: 1.6, young: 5 }], mode: 'wander', biome: 'forest', seed: 21, centre: 0.95 }, { stage: 0.633, light: 0.55, activity: 0.55 }),
  S('standoff', 'Wall of Horns', 'Triceratops adults face a Tyrannosaurus down while the calves keep behind them.', ['ceratopsian', 'theropod', 'cretaceous', 'hunt', 'herd'],
    { cast: [{ sp: 'triceratops', n: 3, young: 3 }, { sp: 'tyrannosaurus', n: 1, role: 'pred' }], mode: 'hunt', standoff: true, biome: 'plain', seed: 14, frame: 1.9 }, { stage: 0.855, light: 0.62, activity: 0.55 }),
  S('psittacosaurus', 'Thirty-Four Young', 'One fossil from China holds a Psittacosaurus with 34 young around it. This is that crowd alive.', ['ceratopsian', 'cretaceous', 'herd'],
    { cast: [{ sp: 'psittacosaurus', n: 1, young: 26.7, lane: 1.0 }], mode: 'wander', biome: { hills: 0.4, density: 0.3, tall: 0.5, far: 'forest', ground: ['#8e9a62', '#5c7040'], mult: { ginkgo: 2, conifer: 1.5, fern: 2 } }, seed: 5, centre: 1, crowd: 2.6, grown: [0.2, 0.3], frame: 0.72 }, { stage: 0.6, light: 0.9, herd: 0.5 }),
  S('night', 'One Keeps Watch', 'A Plateosaurus herd asleep under the Triassic stars, breath steaming, one adult awake.', ['sauropod', 'triassic', 'night', 'herd'],
    { cast: [{ sp: 'plateosaurus', n: 4, young: 3 }], mode: 'wander', sleep: true, biome: 'badlands', seed: 19, centre: 0.5, frame: 1.4 }, { stage: 0.1, light: 0.07 }),
  S('rex', 'Tyrant Family', 'A Tyrannosaurus rex along the shore at dusk with her half-grown, long-legged young.', ['theropod', 'cretaceous', 'coast'],
    { cast: [{ sp: 'tyrannosaurus', n: 1, young: 3 }], grown: [0.42, 0.6], crowd: 1.3, biome: 'coast', seed: 3, flyers: 2 }, { stage: 0.855, light: 0.3, herd: 0.5 }),
];
