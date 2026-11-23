// Posters: moving graphic posters of the age of dinosaurs. A national-park screenprint, a travel poster for Pangaea,
// art deco, Bauhaus, Swiss grid, Memphis, two-colour risograph, constructivist, a one-line minimal and a museum poster.
// The lettering is drawn on the canvas and always names the animal that is really on screen: its name, what the name
// means, its length, when and where it lived (all from species.js) or the era's name and span (time.js).
// World styles (wpa, travel, memphis, riso) restyle the shared world; the others pose one animal from the rig.
// In a combo everything above the horizon stays transparent: sky decoration lives in the sky painter, lettering sits
// on the painted ground or on its own solid plate, and grain and tints use source-atop.
import { clamp, lerp, smooth, fract, hash, rng, buffer, sky, TAU, energy } from '../util.js';
import { createWorld } from '../world.js';
import { paintWorld, drawParts, trace, paintFx } from '../draw.js';
import { species, standIn } from '../species.js';
import { pose, parts, bones, gait } from '../rig.js';

const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const DECO = 'Futura, "Century Gothic", "Avenir Next", "Gill Sans", "Trebuchet MS", sans-serif';
const COND = '"Avenir Next Condensed", "Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif';
const BLACK = 'Impact, "Haettenschweiler", "Arial Black", "Helvetica Neue", sans-serif';
const SERIF = 'Didot, "Bodoni 72", "Bodoni MT", "Playfair Display", Georgia, "Times New Roman", serif';

// ---------------------------------------------------------------- colour
const hx = c => { const p = parseInt(c.slice(1), 16); return [p >> 16, p >> 8 & 255, p & 255]; };
const mx = (a, b, t) => {
  if (t <= 0.004) return a;
  const A = hx(a), B = hx(b), u = Math.min(1, t);
  return '#' + ((1 << 24) | (lerp(A[0], B[0], u) | 0) << 16 | (lerp(A[1], B[1], u) | 0) << 8 | (lerp(A[2], B[2], u) | 0)).toString(16).slice(1);
};
const rgba = (c, a) => { const v = hx(c); return `rgba(${v[0]},${v[1]},${v[2]},${a})`; };

// ---------------------------------------------------------------- lettering
// Letter-spaced text with cached advances. o: { align, spacing (em), weight, maxW (shrinks to fit) }. Returns the size used.
const adv = new Map();
function advances(g, str, font, weight) {
  const key = weight + '|' + font + '|' + str;
  let a = adv.get(key);
  if (!a) { g.font = `${weight} 100px ${font}`; const ws = []; let sum = 0; for (const ch of str) { const w = g.measureText(ch).width / 100; ws.push(w); sum += w; } a = { ws, sum, n: ws.length }; if (adv.size > 600) adv.clear(); adv.set(key, a); }
  return a;
}
function label(g, str, x, y, size, font, color, o = {}) {
  if (!str) return 0;
  const weight = o.weight ?? 700, sp = o.spacing ?? 0.08, a = advances(g, str, font, weight);
  let total = (a.sum + sp * (a.n - 1)) * size;
  if (o.maxW && total > o.maxW) { size *= o.maxW / total; total = o.maxW; }
  g.font = `${weight} ${size}px ${font}`; g.fillStyle = color; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  let cx = o.align === 'center' ? x - total / 2 : o.align === 'right' ? x - total : x, i = 0;
  for (const ch of str) { g.fillText(ch, cx, y); cx += (a.ws[i++] + sp) * size; }
  return size;
}
const wraps = new Map();
function wrap(g, str, maxW, size, font, weight = 400) {
  const key = str + '|' + Math.round(maxW) + '|' + Math.round(size * 4) + font + weight;
  let L = wraps.get(key);
  if (!L) { g.font = `${weight} ${size}px ${font}`; L = []; let line = ''; for (const wd of str.split(' ')) { const t = line ? line + ' ' + wd : wd; if (line && g.measureText(t).width > maxW) { L.push(line); line = wd; } else line = t; } if (line) L.push(line); if (wraps.size > 200) wraps.clear(); wraps.set(key, L); }
  return L;
}
const up = s => (s || '').toUpperCase();
// what can truthfully be said about the animal on screen (or, with none alive, about the moment)
function info(f, sp) {
  const E = f.era, now = Math.round(E.ma) + ' million years ago';
  if (!sp) return { none: true, name: E.name, means: '', len: '', when: E.span, where: '', era: E.name, span: E.span, now, fact: E.text };
  return { name: sp.name, means: sp.means || '', len: sp.len + ' m', when: (sp.ma[0] === sp.ma[1] ? sp.ma[0] : sp.ma[0] + '–' + sp.ma[1]) + ' million years ago',
    where: sp.where || '', era: E.name, span: E.span, now, fact: sp.fact || '', group: sp.group };
}
const join = (...a) => a.filter(Boolean).join(' · ');

// ---------------------------------------------------------------- geometry helpers
const down = (g, pts, bottom) => { g.beginPath(); g.moveTo(pts[0][0], bottom); for (const p of pts) g.lineTo(p[0], p[1]); g.lineTo(pts[pts.length - 1][0], bottom); g.closePath(); };
const boxes = new Map();
function bbox(sp) {                                   // the animal's extent in metres, from its rest pose
  let b = boxes.get(sp.id); if (b) return b;
  b = { x0: 1e9, x1: -1e9, y0: 0, y1: -1e9 };
  const add = (x, y, r = 0) => { b.x0 = Math.min(b.x0, x - r); b.x1 = Math.max(b.x1, x + r); b.y1 = Math.max(b.y1, y + r); };
  for (const q of parts(pose(sp, {}))) { if (q.c) add(q.c[0], q.c[1], q.c[2]); else for (const v of q.p || q.l) add(v[0], v[1]); }
  boxes.set(sp.id, b); return b;
}
// fit an animal into a box (pixels) standing on baseY; room > 1 leaves headroom for a raised head
function fit(sp, x, y, bw, baseY, dir = 1, room = 1.08) {
  const b = bbox(sp), k = Math.min(bw / (b.x1 - b.x0), (baseY - y) / (b.y1 * room));
  return { x: x + bw / 2 - (b.x0 + b.x1) / 2 * k * dir, y: baseY, k, dir };
}

// halftone dot tiles (two staggered dots per tile) for a coverage 0..1
function dots(g, cell, cov, color) {
  const b = buffer(cell * 2, cell * 2), c = b.ctx, r = cell * Math.sqrt(2 * cov / Math.PI);
  c.fillStyle = color;
  for (const [x, y] of [[0.5, 0.5], [1.5, 1.5], [-0.5, 1.5], [1.5, -0.5], [2.5, 0.5], [0.5, 2.5]]) { c.beginPath(); c.arc(x * cell, y * cell, r, 0, TAU); c.fill(); }
  return g.createPattern(b.canvas, 'repeat');
}

// ---------------------------------------------------------------- palettes of the three flat world styles
const WP = {
  wpa: { night: '#141d3a', nsky: '#16244a', dusk: '#e8894a', sky: ['#6fa8a6', '#9cc4ad', '#cfd8a8', '#f0dfa4'], sun: '#f8efc8', cloud: '#f6efd6',
    far: ['#5d8e97', '#3d6c78'], ground: ['#d8b443', '#b3a23c', '#73893d', '#3f6a48', '#1f4943'], shadow: '#163631',
    plant: { trunk: '#3b2a1e', leaf: '#1f4a3a', leaf2: '#3f7a4a', flower: '#e0672a', rock: '#8c7c5c', rock2: '#b39c6c', egg: '#f3e7c4', bone: '#f3e7c4' },
    dino: { body: '#6e3b28', far: '#45241a', belly: '#d98a4a', mark: '#38190f', accent: '#e0562a', accentFar: '#a23c1e', horn: '#f6ecc8', eye: '#f6ecc8', mouth: '#3a1512' } },
  travel: { night: '#1a1440', nsky: '#231a52', dusk: '#f0703a', sky: ['#5b4a8e', '#b0608a', '#e8826a', '#f6b56a', '#fbdc92'], sun: '#fff3c4', cloud: '#fbdc92',
    far: ['#a04f7c', '#6e3a70'], ground: ['#f2b25e', '#e58c4b', '#c9603c', '#8c3b3d', '#4b2542'], shadow: '#3a1c36',
    plant: { trunk: '#3a1c36', leaf: '#3d2a55', leaf2: '#5f3a5e', flower: '#fbdc92', rock: '#8c3b3d', rock2: '#b85a44', egg: '#fbdc92', bone: '#fbdc92' },
    dino: { body: '#2c1a3c', far: '#1c1028', belly: '#5d3562', mark: '#120a1c', accent: '#f6b56a', accentFar: '#b0703f', horn: '#fbdc92', eye: '#fbdc92', mouth: '#8c3b3d' } },
  memphis: { night: '#2a1a5a', nsky: '#3a2a7a', dusk: '#ff9a6a', sky: ['#fdf5e6'], sun: '#ffd93b', cloud: '#ffffff',
    far: ['#ffc2d9', '#b9a4ee'], ground: ['#b9a4ee', '#7d5bd6', '#2ad1c9', '#ffd93b', '#fdf5e6'], shadow: '#111111',
    plant: { trunk: '#111111', leaf: '#1aa7a0', leaf2: '#8fe36a', flower: '#ff3d2e', rock: '#7d5bd6', rock2: '#b9a4ee', egg: '#ffffff', bone: '#ffffff' },
    dino: { body: '#ff6fa5', far: '#d6457f', belly: '#ffd93b', mark: '#7d5bd6', accent: '#2ad1c9', accentFar: '#1aa7a0', horn: '#ffffff', eye: '#ffffff', mouth: '#111111' } },
};

export default {
  id: 'poster',
  name: 'Posters',
  kind: '2d',
  sky: true,
  params: [
    { id: 'x1', label: 'Lettering', value: 0.5, tip: 'Size of the type; all the way down removes it' },
    { id: 'x2', label: 'Grain', value: 0.5, tip: 'Paper and ink grain' },
    { id: 'x3', label: 'Misregistration', value: 0.5, tip: 'How far the ink layers and type shadows sit off register' },
    { id: 'x4', label: 'Ornament', value: 0.5, tip: 'Rays, confetti, grids and other decoration' },
  ],
  create(ctx, opts) {
    const style = opts.style || 'wpa', g = ctx;
    const worldStyle = style === 'wpa' || style === 'travel' || style === 'memphis' || style === 'riso';
    const W = worldStyle ? createWorld(opts) : null;
    const base = species(opts.sp || 'tyrannosaurus');
    const st = { phase: 0, dist: 0, init: false, sp: null };
    let grainPat = null, tileKey = '', tiles = null, bufA = null, bufB = null, bufKey = '';

    // ---- the one animal of the rig-posed styles: the scene's species, or whoever filled its niche at this time
    function subject(f) {
      const sp = opts.lock ? base : standIn(base, f.era.ma);
      if (!sp || (sp.plan !== 'bird' && f.era.dinos < 0.5)) return null;
      return sp;
    }
    // walk on the spot: returns the pose, and keeps st.dist (metres travelled) for scrolling the ground
    function stride(f, sp, o = {}) {
      const run = o.run || 0, G = gait(sp, run), v = G.speed * (0.5 + 0.5 * energy(f)) * (o.pace ?? 1);
      if (!st.init || st.sp !== sp) { st.phase = f.t * v / G.stride + 0.13; st.dist = f.t * v; st.init = true; st.sp = sp; }
      else { st.phase += f.dt * v / G.stride; st.dist += f.dt * v; }
      if (f.sig) { f.sig.count = 1 / 16; f.sig.speed = clamp(v / G.top); if (o.jaw > 0.9) f.sig.roar = 1; }
      return pose(sp, { phase: st.phase, run, headTo: o.headTo || 0, jaw: o.jaw || 0, t: f.t });
    }
    const LS = f => lerp(0.72, 1.22, f.p.x1);                  // lettering scale
    const lettered = f => f.p.x1 > 0.03;

    function grain(f, amt = 1) {
      const a = f.p.x2 * amt; if (a < 0.02) return;
      if (!grainPat) { const b = buffer(160, 160), c = b.ctx, R = rng(977); for (let i = 0; i < 5200; i++) { c.fillStyle = R() < 0.55 ? `rgba(30,22,18,${R() * 0.5})` : `rgba(255,250,240,${R() * 0.5})`; c.fillRect(R() * 160 | 0, R() * 160 | 0, 1 + (R() < 0.15), 1); } grainPat = g.createPattern(b.canvas, 'repeat'); }
      g.save(); g.globalCompositeOperation = 'source-atop'; g.globalAlpha = Math.min(1, a * 0.55); g.fillStyle = grainPat; g.fillRect(0, 0, f.w, f.h); g.restore();
    }
    // the asteroid, the flash and the dark for the rig-posed styles, in the poster's own colours
    function impact(f, hz, col) {
      const { w, h } = f, E = f.era;
      if (E.meteor > 0) { const m = Math.min(1, E.meteor), x = lerp(w * 0.08, w * 0.74, m), y = lerp(-h * 0.05, hz, m * m), r = h * lerp(0.012, 0.035, m);
        g.fillStyle = col; g.beginPath(); g.moveTo(x - r * 12, y - r * 9.5); g.lineTo(x + r * 0.7, y - r * 0.7); g.lineTo(x - r * 0.7, y + r * 0.7); g.closePath(); g.fill(); g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
      if (E.flash > 0.01 || E.dark > 0.01) { g.save(); g.globalCompositeOperation = 'source-atop';
        if (E.dark > 0.01) { g.fillStyle = `rgba(24,18,16,${E.dark * 0.55})`; g.fillRect(0, 0, w, h); }
        if (E.flash > 0.01) { g.fillStyle = `rgba(255,240,205,${Math.min(0.85, E.flash)})`; g.fillRect(0, 0, w, h); } g.restore(); }
    }

    // posters keep the stage clear: no plants in front of the animals, and tall trees only well behind them
    const TALL = { treefern: 1, ginkgo: 1, conifer: 1, araucaria: 1, redwood: 1, magnolia: 1, palm: 1, deadtree: 1 };
    const hidePlant = (v, it, w) => it.x < -it.k * 16 || it.x > w + it.k * 16 || it.k > v.k0 * (TALL[it.kind] ? 0.6 : it.kind === 'nest' ? 9 : 0.97);

    // =========================================================== flat world styles (wpa, travel, memphis)
    function lit(P, v) {
      const n = v.day.night, du = v.day.dusk, dk = v.dark, ash = '#2b2522';
      const L = c => mx(mx(c, P.night, n * 0.62), ash, dk * 0.6), map = o => { const r = {}; for (const k in o) r[k] = L(o[k]); return r; };
      const ns = P.sky.length, flat = (o, c) => { const r = {}; for (const k in o) r[k] = c; return r; };
      const C = { sky: P.sky.map((c, i) => mx(mx(mx(c, P.dusk, du * 0.55 * (i + 1) / ns), P.nsky, n * 0.9), ash, dk * 0.75)),
        sun: n > 0.6 ? '#eef0f6' : mx(P.sun, '#ffc070', du * 0.4), cloud: L(P.cloud), far: P.far.map(L), ground: P.ground.map(L), shadow: L(P.shadow),
        plant: map(P.plant), dino: map(P.dino) };
      for (const k in C.dino) C.dino[k] = mx(mx(P.dino[k], P.night, n * 0.3), ash, dk * 0.5);
      if (n > 0.3) { C.dino.body = mx(C.dino.body, C.dino.belly, n * 0.35); C.dino.far = mx(C.dino.far, P.night, n * 0.3); }
      C.dinoFar = flat(P.dino, L(mx(P.dino.body, P.far[1], 0.55))); C.dinoFar.eye = C.dinoFar.horn = null;
      C.plantFar = flat(P.plant, L(mx(P.plant.leaf, P.far[1], 0.5)));
      return C;
    }
    function flatWorld(f, P, S = {}) {
      const { w, h } = f, v = W.frame(f), C = lit(P, v), N = C.ground.length;
      paintWorld(f, v, {
        sky() {
          const n = C.sky.length, bh = v.horizon * 1.03 / n;
          for (let i = 0; i < n; i++) { g.fillStyle = C.sky[i]; g.fillRect(0, Math.floor(bh * i), w, bh + 2); }
          S.sky?.(v, C);
        },
        sun() {
          const s = v.sun, r = h * (S.sunR || 0.06);
          if (s.moon) { g.fillStyle = C.sun; g.beginPath(); g.arc(s.x, s.y, r * 0.7, 0, TAU); g.fill(); g.fillStyle = C.sky[0]; g.beginPath(); g.arc(s.x + r * 0.3, s.y - r * 0.15, r * 0.6, 0, TAU); g.fill();
            g.fillStyle = C.sun; for (let i = 0; i < 26; i++) { const x = hash(i, 11) * w, y = hash(i, 12) * v.horizon * 0.8, q = h * 0.004 * (1 + (i % 3)); g.beginPath(); g.moveTo(x, y - q); g.lineTo(x + q * 0.6, y); g.lineTo(x, y + q); g.lineTo(x - q * 0.6, y); g.fill(); } return; }
          for (let i = 2; i >= 0; i--) { g.fillStyle = i ? rgba(C.sun, 0.22) : C.sun; g.beginPath(); g.arc(s.x, s.y, r * (1 + i * 0.5), 0, TAU); g.fill(); }
        },
        meteor() { const m = v.meteor, r = m.r * 1.4; g.fillStyle = '#fff3c4'; g.beginPath(); g.moveTo(m.x - Math.cos(m.ang) * m.len, m.y - Math.sin(m.ang) * m.len); g.lineTo(m.x + r * 0.7, m.y - r * 0.7); g.lineTo(m.x - r * 0.7, m.y + r * 0.7); g.closePath(); g.fill(); g.beginPath(); g.arc(m.x, m.y, r, 0, TAU); g.fill(); },
        far(f, v, l, i) { g.fillStyle = C.far[i % C.far.length]; down(g, l.pts, l.bottom); g.fill(); },
        ground(f, v, b) { const i = Math.min(N - 1, Math.floor(b.u * N * 0.999)); g.fillStyle = C.ground[i]; down(g, b.pts, h + 2); g.fill(); S.ground?.(v, b, i, C); },
        plant(f, v, it) { if (hidePlant(v, it, w)) return; drawParts(g, it.parts, { x: it.x, y: it.y, k: it.k, dir: 1 }, { pal: it.fog > 0.42 ? C.plantFar : C.plant }); },
        dino(f, v, it) {
          const T = it.T, a = it.fade ?? 1; if (a <= 0.01) return;
          g.globalAlpha = a;
          if (it.type === 'dino') { const rx = it.sp.len * it.pose.scale * T.k * 0.3; g.fillStyle = C.shadow; g.globalAlpha = a * 0.5; g.beginPath(); g.ellipse(T.x, T.y, rx, rx * 0.1, 0, 0, TAU); g.fill(); g.globalAlpha = a; }
          const far = it.fog > 0.3 || it.type === 'flyer';
          drawParts(g, it.parts, T, far ? { pal: C.dinoFar, pupil: false } : { pal: C.dino, stroke: S.line, lw: S.line ? Math.max(1, h * 0.0045) : 0, alpha: S.line ? { mark: 0.9 } : null, pupilCol: '#111' });
          g.globalAlpha = 1;
        },
        fx(f, v) { paintFx(f, v); },
      });
      return { v, C };
    }

    function wpa(f) {
      const { w, h } = f, { v } = flatWorld(f, WP.wpa, {
        sky(v, C) {                                              // flat screenprint clouds
          g.fillStyle = C.cloud;
          for (let i = 0; i < 3; i++) { const r = h * (0.03 + 0.012 * i), cx = fract(f.t * 0.004 * (i + 1) + hash(i, 4)) * (w + r * 12) - r * 6, cy = h * (0.1 + 0.11 * i);
            g.beginPath(); g.ellipse(cx, cy, r * 3, r * 0.55, 0, Math.PI, TAU); g.ellipse(cx - r * 0.9, cy - r * 0.35, r * 1.1, r * 0.9, 0, Math.PI, TAU); g.ellipse(cx + r * 0.7, cy - r * 0.4, r * 1.4, r * 1.2, 0, Math.PI, TAU); g.fill(); g.fillRect(cx - r * 3, cy - r * 0.42, r * 6, r * 0.44); }
        }, sunR: 0.07 });
      const I = info(f, v.lead?.sp), cream = '#efe3c3', ink = '#1f4943', b = h * 0.028, y0 = h * 0.815, s = LS(f);
      g.fillStyle = cream; g.fillRect(0, y0, w, h - y0); g.fillRect(0, 0, w, b); g.fillRect(0, 0, b, h); g.fillRect(w - b, 0, b, h);
      g.strokeStyle = ink; g.lineWidth = Math.max(1, h * 0.004); g.strokeRect(b, b, w - 2 * b, y0 - b);
      if (lettered(f)) {
        label(g, up(I.name), w / 2, h * 0.918, h * 0.098 * s, COND, ink, { align: 'center', spacing: 0.16, weight: 700, maxW: w * 0.86 });
        label(g, up(I.none ? I.span : join(I.where, I.now)), w / 2, h * 0.966, h * 0.03 * Math.min(1.1, s), SANS, '#8a3d22', { align: 'center', spacing: 0.3, weight: 700, maxW: w * 0.86 });
      }
      grain(f);
    }

    function travel(f) {
      const { w, h } = f, E = f.era;
      const { v } = flatWorld(f, WP.travel, { sunR: 0.11,
        sky(v, C) { const n = Math.round(3 + f.p.x4 * 6); g.strokeStyle = rgba(C.cloud, 0.5); g.lineWidth = Math.max(1, h * 0.005);     // thin bars of cloud
          for (let i = 0; i < n; i++) { const y = v.horizon * (0.42 + 0.5 * hash(i, 21)), x = fract(hash(i, 22) + f.t * 0.003 * (1 + i % 3)) * w * 1.4 - w * 0.2, l = w * (0.08 + 0.14 * hash(i, 23)); g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y); g.stroke(); } } });
      const sp = v.lead?.sp, I = info(f, sp), cream = '#fbe6b4', ink = '#2c1a3c', s = LS(f);
      const pang = E.pangaea > 0.6, title = pang ? 'PANGAEA' : I.none ? up(I.era) : up(I.where.split(',')[0]);
      const over = pang ? 'ALL THE LAND IN ONE CONTINENT' : up(I.none ? I.span : I.era);
      // top banner and bottom strip: solid, so a combo's sky can sit behind the picture
      const tb = h * 0.2, bb = h * 0.855;
      g.fillStyle = cream; g.fillRect(0, 0, w, tb); g.fillStyle = ink; g.fillRect(0, tb - h * 0.012, w, h * 0.006); g.fillRect(0, bb, w, h - bb);
      g.fillStyle = '#e8826a'; g.fillRect(0, bb, w, h * 0.008);
      if (lettered(f)) {
        label(g, over, w / 2, h * 0.052, h * 0.026 * Math.min(1.1, s), SANS, '#b0483a', { align: 'center', spacing: 0.42, weight: 700, maxW: w * 0.84 });
        label(g, title, w / 2, h * 0.166, h * 0.118 * Math.min(1.05, s), DECO, ink, { align: 'center', spacing: 0.3, weight: 700, maxW: w * 0.88 });
        if (!I.none) {
          label(g, up('Home of ' + I.name) + (I.means ? '  ·  “' + up(I.means) + '”' : ''), w / 2, h * 0.925, h * 0.04 * s, DECO, cream, { align: 'center', spacing: 0.18, weight: 700, maxW: w * 0.9 });
          label(g, up(join(I.len + ' long', I.when, pang ? I.where : I.era)), w / 2, h * 0.968, h * 0.026 * Math.min(1.1, s), SANS, '#f6b56a', { align: 'center', spacing: 0.26, weight: 700, maxW: w * 0.9 });
        } else label(g, up(I.span), w / 2, h * 0.945, h * 0.04 * s, DECO, cream, { align: 'center', spacing: 0.2, maxW: w * 0.9 });
      }
      grain(f);
    }

    function memphis(f) {
      const { w, h, t } = f, cols = ['#ff6fa5', '#2ad1c9', '#ffd93b', '#7d5bd6', '#111111', '#ff3d2e'];
      if (tileKey !== 'm' + h) { tileKey = 'm' + h; tiles = [dots(g, Math.max(4, Math.round(h / 60)), 0.1, '#111111')]; }
      const { v } = flatWorld(f, WP.memphis, { line: '#111111',
        sky(v, C) {                                             // confetti: squiggles, triangles, rings, zigzags, crosses
          const n = Math.round(8 + f.p.x4 * 34), hz = v.horizon, night = v.day.night;
          g.lineCap = 'round'; g.lineJoin = 'round';
          for (let i = 0; i < n; i++) {
            const kind = i % 6, c = cols[Math.floor(hash(i, 3) * cols.length)], s = h * (0.022 + 0.03 * hash(i, 5));
            const x = fract(hash(i, 1) + t * 0.004 * (hash(i, 7) - 0.5)) * w, y = hash(i, 2) * hz * 0.92 + Math.sin(t * 0.5 + i) * h * 0.006, a = hash(i, 4) * TAU + t * 0.12 * (hash(i, 8) - 0.5);
            g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = g.strokeStyle = night > 0.5 && c === '#111111' ? '#ffffff' : c; g.lineWidth = Math.max(1.5, s * 0.22);
            g.beginPath();
            if (kind === 0) { for (let j = 0; j <= 16; j++) { const u = j / 16 * 2 - 1; g.lineTo(u * s * 1.6, Math.sin(u * 7 + t * 2 + i) * s * 0.35); } g.stroke(); }
            else if (kind === 1) { g.moveTo(0, -s); g.lineTo(s * 0.9, s * 0.7); g.lineTo(-s * 0.9, s * 0.7); g.closePath(); g.fill(); }
            else if (kind === 2) { g.arc(0, 0, s * 0.7, 0, TAU); g.stroke(); }
            else if (kind === 3) { for (let j = 0; j < 6; j++) g.lineTo((j - 2.5) * s * 0.5, (j % 2 ? -1 : 1) * s * 0.3); g.stroke(); }
            else if (kind === 4) { g.moveTo(-s * 0.6, 0); g.lineTo(s * 0.6, 0); g.moveTo(0, -s * 0.6); g.lineTo(0, s * 0.6); g.stroke(); }
            else { g.arc(0, 0, s * 0.8, 0, Math.PI); g.closePath(); g.fill(); }
            g.restore();
          }
        },
        ground(v, b, i) { if (i === 2 || i === 4) { g.fillStyle = tiles[0]; down(g, b.pts, h + 2); g.fill(); } } });
      const I = info(f, v.lead?.sp), y0 = h * 0.825, s = LS(f), off = h * 0.004 + f.p.x3 * h * 0.014;
      g.fillStyle = '#111111'; g.fillRect(0, y0 - h * 0.012, w, h * 0.014);
      g.fillStyle = '#2ad1c9'; g.fillRect(0, y0, w, h - y0);
      g.fillStyle = '#111111'; g.beginPath(); const zn = 32; for (let i = 0; i <= zn; i++) { const x = i / zn * w; g.moveTo(x - w / zn / 2, y0); g.lineTo(x, y0 + h * 0.022); g.lineTo(x + w / zn / 2, y0); } g.fill();
      if (lettered(f)) {
        const size = h * 0.105 * Math.min(1.08, s), o = { align: 'center', spacing: 0.06, weight: 400, maxW: w * 0.84 };
        label(g, up(I.name), w / 2 + off, h * 0.935 + off, size, BLACK, '#111111', o);
        label(g, up(I.name), w / 2, h * 0.935, size, BLACK, '#ffd93b', o);
        const sub = up(I.none ? I.span : join(I.means, I.len + ' long', I.when));
        g.fillStyle = '#111111'; g.fillRect(0, h * 0.95, w, h * 0.05);
        label(g, sub, w / 2, h * 0.984, h * 0.027 * Math.min(1.1, s), SANS, '#ffffff', { align: 'center', spacing: 0.22, weight: 700, maxW: w * 0.92 });
      }
      grain(f, 0.6);
    }

    // =========================================================== two-colour risograph (the world in two inks)
    function riso(f) {
      const { w, h } = f, v = W.frame(f), PAPER = '#f4eddc', PINK = '#ff4f9e', BLUE = '#1f3fa6', hz = v.horizon;
      const key = w + 'x' + h;
      if (bufKey !== key) { bufKey = key; bufA = buffer(w, h); bufB = buffer(w, h); const c = Math.max(3, Math.round(h / 130));
        bufA.pat = [0.1, 0.24, 0.42, 0.62].map(q => dots(bufA.ctx, c, q, PINK)); bufB.pat = [0.12, 0.28, 0.5, 0.7].map(q => dots(bufB.ctx, c, q, BLUE)); }
      const A = bufA.ctx, B = bufB.ctx, pa = bufA.pat, pb = bufB.pat, night = v.day.night > 0.5;
      // one ink: fn(tone, part) → a fill, or 0 to knock a hole (so nothing behind prints through), or undefined to skip
      const ink = (c, list, T, fn) => { for (const q of list) { const col = fn(q.t, q); if (col === undefined) continue; c.beginPath(); trace(c, q, T);
        if (q.l) { c.lineCap = 'round'; c.lineWidth = Math.max(0.6, q.w * T.k); c.globalCompositeOperation = 'destination-out'; c.strokeStyle = '#000'; c.stroke(); c.globalCompositeOperation = 'source-over'; if (col) { c.strokeStyle = col; c.stroke(); } continue; }
        if (typeof col !== 'string') { c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000'; c.fill(); c.globalCompositeOperation = 'source-over'; }
        if (col) { c.fillStyle = col; c.fill(); } } };
      const band = (c, pts, bottom, col) => { down(c, pts, bottom); c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000'; c.fill(); c.globalCompositeOperation = 'source-over'; if (col) { c.fillStyle = col; c.fill(); } };
      const plantInk = (c, it, fn) => {                          // a plant prints as one knock-out and one fill per tone
        const T = { x: it.x, y: it.y, k: it.k, dir: 1 }, by = new Map(); let any = false;
        for (const q of it.parts) { if (q.l) continue; const col = fn(q.t); if (col === undefined) continue; any = true; if (!by.has(col)) by.set(col, []); by.get(col).push(q); }
        if (!any) return;
        c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000'; c.beginPath(); for (const l of by.values()) for (const q of l) trace(c, q, T); c.fill(); c.globalCompositeOperation = 'source-over';
        for (const [col, l] of by) if (col) { c.fillStyle = col; c.beginPath(); for (const q of l) trace(c, q, T); c.fill(); }
      };
      const pass = (c, S) => {
        c.clearRect(0, 0, w, h); S.sky?.();
        for (const it of v.flyers) S.dino(it);
        if (!f.backdrop) v.far.forEach((l, i) => band(c, l.pts, l.bottom, S.far(i)));
        for (const b of v.layers) { band(c, b.pts, h + 2, S.ground(b.u)); for (const it of b.items) { if (it.type === 'plant') { if (!hidePlant(v, it, w)) plantInk(c, it, S.plant); } else S.dino(it); } }
      };
      // pink: the sun, tints on the ground, the animals as solid shapes
      pass(A, { sky: () => { if (f.combo) return; const s = v.sun, r = h * 0.13; A.fillStyle = night ? pa[1] : PINK; A.beginPath(); A.arc(s.x, Math.min(s.y, hz - r * 0.3), r, 0, TAU); A.fill();
          if (v.meteor) { const m = v.meteor; A.fillStyle = PINK; A.beginPath(); A.arc(m.x, m.y, m.r * 3, 0, TAU); A.fill(); } },
        far: i => i ? pa[0] : null, ground: u => u < 0.45 ? pa[0] : u < 0.8 ? pa[1] : pa[0],
        plant: t => t === 'flower' || t === 'egg' ? PINK : t === 'leaf2' ? pa[2] : undefined,
        dino: it => ink(A, it.parts, it.T, (t, q) => it.type === 'flyer' ? undefined : t === 'horn' || t === 'eye' ? 0 : t === 'mark' ? undefined : PINK) });
      // blue: the drawing. Halftone on the bodies, solid in the far limbs, markings and trees
      pass(B, { sky: () => { if (f.combo || !night) return; B.fillStyle = pb[3]; B.fillRect(0, 0, w, hz * 1.05); },
        far: i => i ? pb[0] : null, ground: u => u > 0.8 ? pb[0] : null,
        plant: t => t === 'trunk' ? pb[3] : t === 'leaf' ? pb[2] : t === 'leaf2' ? pb[1] : t === 'rock' || t === 'rock2' ? pb[1] : 0,
        dino: it => ink(B, it.parts, it.T, (t, q) => it.type === 'flyer' ? BLUE : t === 'body' ? pb[2] : t === 'far' || t === 'mark' || t === 'eye' || t === 'mouth' || t === 'accentFar' ? BLUE : t === 'accent' ? pb[0] : 0) });
      // paper, then the two inks overprinted slightly off register
      sky(f, c => { c.fillStyle = PAPER; c.fillRect(0, 0, w, h); });
      if (f.combo) {                                            // solid paper under everything that prints, so the layer behind can't show through the dots
        g.fillStyle = PAPER;
        if (!f.backdrop) for (const l of v.far) { down(g, l.pts, l.bottom); g.fill(); }
        for (const b of v.layers) { down(g, b.pts, h + 2); g.fill(); for (const it of b.items) if (it.type !== 'plant' || !hidePlant(v, it, w)) drawParts(g, it.parts, it.T || { x: it.x, y: it.y, k: it.k, dir: 1 }, { fill: () => PAPER, pupil: false }); }
      }
      const m = f.p.x3 * h * 0.012, wob = Math.sin(Math.floor(f.t * 3) * 12.9898) * m * 0.15;
      g.save(); g.globalCompositeOperation = 'multiply';
      g.drawImage(bufA.canvas, -m * 0.5 + wob, m * 0.3); g.drawImage(bufB.canvas, m * 0.5, -m * 0.3 - wob);
      g.restore();
      if (v.dark > 0.01 || v.flash > 0.01) { g.save(); g.globalCompositeOperation = 'source-atop'; g.fillStyle = v.flash > 0.01 ? rgba(PINK, Math.min(0.7, v.flash)) : rgba(BLUE, v.dark * 0.45); g.fillRect(0, 0, w, h); g.restore(); }
      // lettering on a paper band
      const I = info(f, v.lead?.sp), y0 = h * 0.83, s = LS(f);
      g.fillStyle = PAPER; g.fillRect(0, y0, w, h - y0); g.fillStyle = BLUE; g.fillRect(0, y0, w, h * 0.007);
      if (lettered(f)) {
        g.save(); g.globalCompositeOperation = 'multiply';
        const size = h * 0.1 * Math.min(1.1, s), o = { spacing: 0.04, weight: 700, maxW: w * 0.6 };
        label(g, up(I.name), w * 0.045 + m * 1.2 + h * 0.004, h * 0.945 + m * 0.8 + h * 0.003, size, COND, PINK, o);
        label(g, up(I.name), w * 0.045, h * 0.945, size, COND, BLUE, o);
        const x = w * 0.955, fs = h * 0.027 * Math.min(1.1, s), oo = { align: 'right', spacing: 0.14, weight: 700, maxW: w * 0.3 };
        if (I.none) label(g, up(I.span), x, h * 0.93, fs, SANS, BLUE, oo);
        else { label(g, '“' + up(I.means) + '”', x, h * 0.888, fs, SANS, PINK, oo); label(g, up(I.len + ' long'), x, h * 0.928, fs, SANS, BLUE, oo); label(g, up(I.when), x, h * 0.968, fs, SANS, BLUE, oo); }
        g.restore();
      }
      grain(f, 1.5);
    }

    // =========================================================== art deco
    function deco(f) {
      const { w, h, t, p } = f, sp = subject(f), I = info(f, sp), hz = h * 0.56, baseY = h * 0.79, cx = w * 0.5;
      const NAVY = '#0e1428', GOLD = '#c9a24a', GOLD2 = '#e6c777', CREAM = '#f0e2bd', L = clamp(p.light);
      const q = sp && stride(f, sp, { run: 0.12, headTo: 0.12, jaw: 0.25 + 0.25 * Math.sin(t * 0.9) });
      sky(f, c => {
        const gr = c.createLinearGradient(0, 0, 0, hz); gr.addColorStop(0, mx('#0a0f22', '#1f4460', L)); gr.addColorStop(1, mx('#26305a', '#5d8f96', L)); c.fillStyle = gr; c.fillRect(0, 0, w, h);
        const n = Math.round(9 + p.x4 * 14), da = Math.PI / n, rot = fract(t * 0.012) * da, R = Math.hypot(w, h);
        for (let i = -1; i < n; i++) { const a0 = Math.PI + i * da + rot, a1 = a0 + da * 0.5; c.fillStyle = i & 1 ? GOLD : GOLD2; c.globalAlpha = 0.92; c.beginPath(); c.moveTo(cx, hz); c.lineTo(cx + Math.cos(a0) * R, hz + Math.sin(a0) * R); c.lineTo(cx + Math.cos(a1) * R, hz + Math.sin(a1) * R); c.closePath(); c.fill(); }
        c.globalAlpha = 1;
        c.fillStyle = CREAM; c.beginPath(); c.arc(cx, hz, h * 0.2, Math.PI, TAU); c.fill();
        c.strokeStyle = NAVY; c.lineWidth = Math.max(1, h * 0.004); for (let i = 1; i <= 3; i++) { c.beginPath(); c.arc(cx, hz, h * (0.2 + i * 0.022), Math.PI, TAU); c.stroke(); }
      });
      if (!f.backdrop) for (const sd of [-1, 1]) for (let j = 0; j < 5; j++) {          // stepped towers of rock on the horizon
        const x0 = cx + sd * w * (0.3 + j * 0.045), top = hz - h * (0.035 + j * 0.03 + 0.02 * (j === 4));
        g.fillStyle = mx('#1a2548', '#0e1428', j / 6); g.fillRect(sd > 0 ? x0 : 0, top, sd > 0 ? w - x0 : x0, hz - top + 1);
        g.fillStyle = GOLD; g.fillRect(sd > 0 ? x0 : 0, top, sd > 0 ? w - x0 : x0, Math.max(1, h * 0.004));
      }
      g.fillStyle = NAVY; g.fillRect(0, hz, w, h - hz);
      g.strokeStyle = rgba(GOLD, 0.55); g.lineWidth = Math.max(1, h * 0.003);
      for (let i = 0; i < 7; i++) { const u = fract(i / 7 + st.dist * 0.035), y = hz + (h * 0.84 - hz) * u * u; g.globalAlpha = 0.25 + 0.6 * u; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      g.globalAlpha = 0.5; for (let i = -8; i <= 8; i++) { g.beginPath(); g.moveTo(cx + i * w * 0.012, hz); g.lineTo(cx + i * w * 0.2, h); g.stroke(); } g.globalAlpha = 1;
      g.fillStyle = GOLD; g.fillRect(0, hz - h * 0.003, w, h * 0.006);
      if (q) {
        const T = fit(sp, w * 0.12, h * 0.13, w * 0.76, baseY);
        g.fillStyle = '#05070f'; g.beginPath(); g.ellipse(T.x + q.nodes[q.iSh].x * 0.4 * T.k, baseY + h * 0.004, sp.len * T.k * 0.3, h * 0.012, 0, 0, TAU); g.fill();
        drawParts(g, parts(q), T, { stroke: GOLD, lw: Math.max(1, h * 0.0032), alpha: { mark: 0.75 }, pupilCol: NAVY,
          pal: { body: '#101833', far: '#070b1a', belly: '#1c2a52', mark: GOLD, accent: GOLD, accentFar: '#8e7234', horn: CREAM, eye: GOLD2, mouth: '#9c2f25' } });
      }
      impact(f, hz, CREAM);
      // stepped frame and title panel
      const m = h * 0.03, y0 = h * 0.842;
      g.fillStyle = NAVY; g.fillRect(0, y0, w, h - y0);
      g.strokeStyle = GOLD; g.lineWidth = Math.max(1, h * 0.005); g.strokeRect(m, m, w - 2 * m, h - 2 * m);
      g.lineWidth = Math.max(1, h * 0.002); g.strokeRect(m * 1.5, m * 1.5, w - 3 * m, h - 3 * m);
      g.fillStyle = GOLD; for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) for (let j = 0; j < 3; j++) { const s = m * (1.6 - j * 0.45), x = sx ? w - m - s : m, y = sy ? h - m - s : m; g.globalAlpha = j === 1 ? 0 : 1; if (j === 1) { g.globalAlpha = 1; g.fillStyle = NAVY; } else g.fillStyle = GOLD; g.fillRect(x, y, s, s); }
      g.globalAlpha = 1; g.fillStyle = GOLD; g.fillRect(m * 1.5, y0, w - 3 * m, Math.max(1, h * 0.004)); g.fillRect(m * 1.5, y0 + h * 0.008, w - 3 * m, Math.max(1, h * 0.002));
      if (lettered(f)) {
        const s = LS(f);
        label(g, up(I.name), cx, h * 0.925, h * 0.07 * Math.min(1.08, s), DECO, GOLD2, { align: 'center', spacing: 0.3, weight: 500, maxW: w * 0.8 });
        label(g, up(I.none ? I.span : join(I.means, I.len + ' long', I.when)), cx, h * 0.958, h * 0.0245 * Math.min(1.08, s), DECO, CREAM, { align: 'center', spacing: 0.3, weight: 500, maxW: w * 0.8 });
      }
      grain(f, 0.7);
    }

    // =========================================================== Bauhaus: the animal from its joints
    function bauhausDino(q, T, C) {
      const k = T.k, X = x => T.x + x * k * T.dir, Y = y => T.y - y * k, n = q.nodes, hip = n[q.iHip], sh = n[q.iSh], hd = q.head, ft = q.sp.f;
      const circ = (x, y, r, c) => { g.fillStyle = c; g.beginPath(); g.arc(X(x), Y(y), Math.max(1, r * k), 0, TAU); g.fill(); };
      const tri = (a, b, d, c) => { g.fillStyle = c; g.beginPath(); g.moveTo(X(a[0]), Y(a[1])); g.lineTo(X(b[0]), Y(b[1])); g.lineTo(X(d[0]), Y(d[1])); g.closePath(); g.fill(); };
      const bar = (pts, wd, c) => { g.strokeStyle = c; g.lineWidth = Math.max(1.5, wd * k); g.lineCap = 'butt'; g.lineJoin = 'miter'; g.miterLimit = 3; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke(); };
      const limb = (L, c, jc) => { const wd = (L.R ? L.R[1] * 1.9 : L.r * 2.6); bar(L.pts, wd, c); if (L.tip) bar([L.pts[3], L.tip[0] - L.pts[3][0] > 0.01 ? L.tip : [L.pts[3][0] + wd * 0.9, L.pts[3][1]]], wd, c);
        if (jc) { circ(L.pts[1][0], L.pts[1][1], wd * 0.62, jc); circ(L.pts[0][0], L.pts[0][1], wd * 0.5, C.black); } };
      for (const L of [...q.legs, ...q.arms]) if (!L.near) limb(L, C.grey);
      // tail: one long black triangle; neck: a blue bar
      const tip = n[0], mxp = (hip.x + sh.x) / 2, myp = (hip.y + sh.y) / 2, R = Math.max(Math.hypot(sh.x - hip.x, sh.y - hip.y) / 2 + hip.r * 0.2, hip.r * 1.12);
      tri([tip.x, tip.y], [hip.x + hip.r * 0.5, hip.y + hip.r * 0.95], [hip.x + hip.r * 0.5, hip.y - hip.r * 0.75], C.black);
      if (ft.club) circ(tip.x, tip.y, hip.r * 0.5, C.red);
      if (ft.spikes) for (const u of [0.02, 0.1]) { const a = n[Math.round(q.iHip * u)]; tri([a.x - hip.r * 0.9, a.y + hip.r * 1.5], [a.x - hip.r * 0.15, a.y], [a.x + hip.r * 0.25, a.y], C.red); }
      bar([[sh.x, sh.y], [hd.x, hd.y]], Math.max(n[n.length - 2].r * 2.1, q.L * 0.012), C.blue);
      const plates = () => { for (let i = 3; i < n.length - 2; i += 2) {
        const a = n[i], b = n[i + 1], c = n[i - 1], env = Math.sin(Math.PI * clamp((i - 1) / (n.length - 4))), s = hip.r * 1.7 * ft.plates * (0.3 + 0.7 * env);
        let dx = b.x - c.x, dy = b.y - c.y, d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d, bx = a.x + nx * a.r * 0.7, by = a.y + ny * a.r * 0.7;
        if (i >= q.iHip && i <= q.iSh) { nx = a.x - mxp; ny = a.y + R - myp; d = Math.hypot(nx, ny) || 1; nx /= d; ny /= d; bx = mxp + nx * R * 0.93; by = myp + ny * R * 0.93; }
        tri([bx - ny * s * 0.5, by + nx * s * 0.5], [bx + ny * s * 0.5, by - nx * s * 0.5], [bx + nx * s * 1.25, by + ny * s * 1.25], C.yellow); } };
      if (ft.plates) plates();
      if (ft.sail) { g.fillStyle = C.yellow; g.beginPath(); g.arc(X(mxp), Y(myp), R * 1.55 * k, Math.PI, TAU); g.closePath(); g.fill(); }
      circ(mxp, myp, R, C.red);
      circ(hip.x, hip.y, hip.r * 0.3, C.paper);
      // head: a yellow triangle along the head's own angle
      const c = Math.cos(hd.a), s = Math.sin(hd.a), hl = hd.len, hw = hl * 0.36;
      if (ft.frill) circ(hd.x - c * hl * 0.1, hd.y - s * hl * 0.1 + hl * 0.15, hl * 0.62, C.blue);
      if (ft.crest) bar([[hd.x + c * hl * 0.2, hd.y + s * hl * 0.2 + hw * 0.4], [hd.x - c * hl * 0.55, hd.y - s * hl * 0.55 + hw * 1.3]], hl * 0.16, C.red);
      tri([hd.x - s * hw - c * hl * 0.12, hd.y + c * hw - s * hl * 0.12], [hd.x + s * hw - c * hl * 0.12, hd.y - c * hw - s * hl * 0.12], [hd.x + c * hl, hd.y + s * hl], C.yellow);
      if (ft.horns || ft.noseHorn) tri([hd.x + c * hl * 0.25 - s * hw * 0.5, hd.y + s * hl * 0.25 + c * hw * 0.5], [hd.x + c * hl * 0.45 - s * hw * 0.3, hd.y + s * hl * 0.45 + c * hw * 0.3], [hd.x + c * hl * 0.85 - s * hl * 0.55, hd.y + s * hl * 0.85 + c * hl * 0.55], C.black);
      circ(hd.x + c * hl * 0.22 - s * hw * 0.3, hd.y + s * hl * 0.22 + c * hw * 0.3, hl * 0.07, C.black);
      for (const L of [...q.legs, ...q.arms]) if (L.near) limb(L, C.black, C.red);
    }
    function bauhaus(f) {
      const { w, h, t, p } = f, sp = subject(f), I = info(f, sp), hz = h * 0.56, baseY = h * 0.755, night = 1 - smooth(0.1, 0.3, p.light);
      const PAPER = mx('#f1ede4', '#1b1b1f', night), INK = mx('#141414', '#f1ede4', night), C = { red: '#d8232a', yellow: '#f2c400', blue: '#1f4fb5', black: INK, grey: mx('#9a968e', '#5a5a62', night), paper: PAPER };
      const q = sp && stride(f, sp, { headTo: 0.1 + 0.15 * Math.sin(t * 0.4) });
      sky(f, c => {
        c.fillStyle = PAPER; c.fillRect(0, 0, w, h);
        const n = f.p.x4;
        c.fillStyle = C.yellow; c.beginPath(); c.arc(w * 0.84, h * 0.2, h * 0.115, 0, TAU); c.fill();
        if (n > 0.2) { c.strokeStyle = INK; c.lineWidth = Math.max(1, h * 0.004); for (let i = 1; i <= Math.round(n * 4); i++) { c.beginPath(); c.arc(w * 0.84, h * 0.2, h * (0.115 + i * 0.03), -0.3, 1.2); c.stroke(); } }
        if (n > 0.35) { c.save(); c.translate(w * 0.13, h * 0.2); c.rotate(-0.5 + Math.sin(t * 0.2) * 0.03); c.fillStyle = C.blue; c.fillRect(-h * 0.2, -h * 0.014, h * 0.4, h * 0.028); c.fillStyle = C.red; c.fillRect(-h * 0.06, h * 0.04, h * 0.2, h * 0.012); c.restore(); }
        if (n > 0.6) { c.fillStyle = INK; for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) c.fillRect(w * 0.05 + i * h * 0.03, h * 0.4 + j * h * 0.03, h * 0.012, h * 0.012); }
      });
      g.fillStyle = PAPER; g.fillRect(0, hz, w, h - hz);
      // the ground: one black rule, with a dashed measure that scrolls as the animal walks
      const T = sp && fit(sp, w * 0.1, h * 0.1, w * 0.8, baseY);
      g.fillStyle = INK; g.fillRect(0, baseY, w, Math.max(2, h * 0.012));
      if (T) { const stp = T.k * Math.max(0.5, Math.round(sp.len / 6)), o = (st.dist * T.k) % (stp * 2); g.fillStyle = C.red; for (let x = -o; x < w; x += stp * 2) g.fillRect(x, baseY + h * 0.02, stp, Math.max(2, h * 0.008)); }
      if (q) bauhausDino(q, T, C);
      impact(f, hz, C.red);
      if (lettered(f)) {
        const s = LS(f);
        g.fillStyle = C.red; g.fillRect(w * 0.06, h * 0.845, h * 0.05, h * 0.05);
        label(g, I.name.toLowerCase(), w * 0.06 + h * 0.075, h * 0.905, h * 0.1 * Math.min(1.1, s), DECO, INK, { spacing: 0.02, weight: 700, maxW: w * 0.56 });
        const x = w * 0.72, fs = h * 0.027 * Math.min(1.12, s), rows = I.none ? [I.span] : [I.means, I.len + ' long', I.when];
        g.fillStyle = INK; g.fillRect(x - h * 0.02, h * 0.835, Math.max(2, h * 0.006), h * 0.125);
        rows.forEach((r, i) => label(g, r.toLowerCase(), x, h * (0.868 + i * 0.04), fs, DECO, INK, { spacing: 0.1, weight: 500, maxW: w * 0.25 }));
      }
      grain(f, 0.7);
    }

    // =========================================================== Swiss typographic
    function swiss(f) {
      const { w, h, p } = f, sp = subject(f), I = info(f, sp), hz = h * 0.56, baseY = h * 0.77, mg = w * 0.05, night = 1 - smooth(0.1, 0.3, p.light);
      const PAPER = mx('#f5f4f0', '#131313', night), INK = mx('#111111', '#f5f4f0', night), RED = '#e2001a', GRID = mx('#cfcdc6', '#3a3a3a', night);
      const q = sp && stride(f, sp, { headTo: 0.05 });
      const T = sp && fit(sp, mg, h * 0.33, w - 2 * mg, baseY);
      // a metric grid that scrolls under the walking animal
      let stepM = 1; if (T) { let best = 1e9; for (const s of [0.1, 0.25, 0.5, 1, 2, 5, 10]) { const d = Math.abs(Math.log(s * T.k / (w / 10))); if (d < best) { best = d; stepM = s; } } }
      const stepPx = T ? stepM * T.k : w / 10, off = T ? (st.dist * T.k) % stepPx : 0, lw = Math.max(1, h * 0.0022);
      const grid = (c, y0, y1) => { c.fillStyle = GRID; if (p.x4 > 0.08) for (let x = mg - off; x < w; x += stepPx) if (x > 0) c.fillRect(x, y0, lw, y1 - y0); };
      sky(f, c => { c.fillStyle = PAPER; c.fillRect(0, 0, w, h); grid(c, 0, hz); });
      g.fillStyle = PAPER; g.fillRect(0, hz, w, h - hz); grid(g, hz, baseY);
      g.fillStyle = PAPER; g.fillRect(0, 0, w, h * 0.3);                                  // the title block is solid (it covers the sky in a combo)
      if (q) drawParts(g, parts(q), T, { pupilCol: INK, pal: { body: INK, far: mx(INK, PAPER, 0.3), belly: INK, accent: RED, accentFar: mx(RED, INK, 0.4), horn: mx(INK, PAPER, 0.55), eye: PAPER, mouth: RED } });
      g.fillStyle = INK; g.fillRect(0, baseY, w, Math.max(2, h * 0.008));
      for (let x = mg - off; x < w; x += stepPx) g.fillRect(x, baseY, lw * 1.5, h * 0.022);
      impact(f, hz, RED);
      if (lettered(f)) {
        const s = LS(f), size = label(g, I.name, mg - h * 0.008, h * 0.215, h * 0.2 * Math.min(1.1, s), SANS, INK, { spacing: -0.035, weight: 700, maxW: w - 2 * mg });
        g.fillStyle = RED; g.fillRect(mg, h * 0.248, h * 0.035, h * 0.035);
        label(g, I.none ? I.span : I.means + (I.group ? ' — ' + I.group : ''), mg + h * 0.055, h * 0.278, h * 0.036 * Math.min(1.1, s), SANS, RED, { spacing: 0, weight: 500, maxW: w * 0.7 });
        label(g, I.era, w - mg, h * 0.278, h * 0.026 * Math.min(1.1, s), SANS, INK, { align: 'right', spacing: 0.02, weight: 400, maxW: w * 0.3 });
        // the facts row, on the grid's columns
        const y = h * 0.855, fs = h * 0.025 * Math.min(1.12, s), big = h * 0.046 * Math.min(1.1, s), cw = (w - 2 * mg) / 4, grey = mx(INK, PAPER, 0.45);
        const col = (i, head, val, small) => { const x = mg + i * cw; g.fillStyle = INK; g.fillRect(x, y - h * 0.032, cw - w * 0.015, Math.max(1, h * 0.003)); label(g, head, x, y, fs, SANS, grey, { spacing: 0.02, weight: 500 });
          if (small) wrap(g, val, cw - w * 0.02, fs, SANS, 500).slice(0, 3).forEach((ln, j) => label(g, ln, x, y + h * 0.04 + j * fs * 1.25, fs, SANS, INK, { spacing: 0, weight: 500 }));
          else label(g, val, x, y + h * 0.058, big, SANS, INK, { spacing: -0.02, weight: 700, maxW: cw - w * 0.02 }); };
        if (I.none) { col(0, 'When', I.span, true); col(1, 'Grid', stepM + ' m'); }
        else { col(0, 'Length', I.len); col(1, 'Lived', I.when, true); col(2, 'Found', I.where, true); col(3, 'Grid', stepM + ' m'); }
        void size;
      }
      grain(f, 0.4);
    }

    // =========================================================== constructivist: a roaring head, red and black wedges
    function constr(f) {
      const { w, h, t, p } = f, sp = subject(f), I = info(f, sp), hz = h * 0.56;
      const PAPER = '#e6dcc3', RED = '#c8201c', INK = '#141210';
      const roar = Math.max(0, Math.sin(t * 0.8)) ** 0.6, jaw = 0.38 + 0.62 * roar * (0.85 + 0.15 * Math.sin(t * 23));
      let q = null, T = null, mouth = [w * 0.7, h * 0.3];
      if (sp) { q = stride(f, sp, { pace: 0, headTo: 0.55, jaw });
        const k = w * 0.8 / Math.max(q.head.len * 2.5, sp.len * 0.3);
        T = { x: w * 0.5 - q.head.x * k, y: h * 0.33 + q.head.y * k, k, dir: 1 };
        mouth = [T.x + (q.head.x + Math.cos(q.head.a) * q.head.len * 0.9) * k, T.y - (q.head.y + Math.sin(q.head.a) * q.head.len * 0.9) * k + q.head.len * 0.12 * k]; }
      sky(f, c => {
        c.fillStyle = PAPER; c.fillRect(0, 0, w, h);
        c.fillStyle = RED; c.beginPath(); c.arc(w * 0.56, h * 0.36, h * 0.33, 0, TAU); c.fill();
        c.fillStyle = INK; c.beginPath(); c.moveTo(0, 0); c.lineTo(w * 0.3, 0); c.lineTo(0, h * 0.5); c.closePath(); c.fill();
        // the roar: wedges fanning out of the mouth
        const n = Math.round(4 + p.x4 * 8), R = w, spread = 0.9;
        for (let i = 0; i < n; i++) { const a = -spread / 2 - 0.12 + (i + 0.5) / n * spread, da = spread / n * (0.16 + 0.22 * roar), r0 = h * (0.1 + 0.03 * Math.sin(t * 9 + i * 2) * roar);
          c.fillStyle = i % 3 === 1 ? RED : INK; c.beginPath(); c.moveTo(mouth[0] + Math.cos(a) * r0, mouth[1] + Math.sin(a) * r0); c.lineTo(mouth[0] + Math.cos(a - da) * R, mouth[1] + Math.sin(a - da) * R); c.lineTo(mouth[0] + Math.cos(a + da) * R, mouth[1] + Math.sin(a + da) * R); c.closePath(); c.fill(); }
      });
      // the ground: black, with a red wedge driving in from the left
      g.fillStyle = INK; g.fillRect(0, hz, w, h - hz);
      g.fillStyle = RED; g.beginPath(); g.moveTo(0, hz); g.lineTo(w * 0.46, hz); g.lineTo(w * 0.3, h); g.lineTo(0, h); g.closePath(); g.fill();
      g.fillStyle = PAPER; g.beginPath(); g.moveTo(w * 0.46, hz); g.lineTo(w * 0.49, hz); g.lineTo(w * 0.33, h); g.lineTo(w * 0.3, h); g.closePath(); g.fill();
      if (q) {                                                   // a cut-out photograph: greys, a paper edge, a coarse screen
        const key = w + 'x' + h; if (bufKey !== key) { bufKey = key; bufA = buffer(w, h); bufA.pat = dots(bufA.ctx, Math.max(3, Math.round(h / 150)), 0.3, INK); }
        const c = bufA.ctx, P = parts(q).filter(o => o.k !== 'mark' || o.t !== 'mark' || true);
        c.clearRect(0, 0, w, h);
        drawParts(c, P, T, { fill: () => PAPER, stroke: PAPER, lw: h * 0.022, pupil: false });
        drawParts(c, P, T, { pupilCol: INK, alpha: { mark: 0.8 }, pal: { body: '#77736b', far: '#2c2a27', belly: '#a9a498', mark: '#2c2a27', accent: '#4a4742', accentFar: '#2c2a27', horn: '#f3ecd8', eye: '#f3ecd8', mouth: RED } });
        c.save(); c.globalCompositeOperation = 'source-atop'; c.globalAlpha = 0.5; c.fillStyle = bufA.pat; c.fillRect(0, 0, w, h); c.restore();
        g.drawImage(bufA.canvas, 0, 0);
      }
      impact(f, hz, INK);
      if (lettered(f)) {
        const s = LS(f), off = h * 0.003 + p.x3 * h * 0.008;
        g.save(); g.translate(w * 0.955, h * 0.79); g.rotate(-0.09);
        const o = { align: 'right', spacing: 0.03, weight: 400, maxW: w * 0.5 }, size = h * 0.15 * Math.min(1.08, s);
        label(g, up(I.name), off, off, size, BLACK, RED, o);
        label(g, up(I.name), 0, 0, size, BLACK, PAPER, o);
        g.fillStyle = RED; g.fillRect(-w * 0.5, h * 0.022, w * 0.5, h * 0.058);
        label(g, up(I.none ? I.span : I.means), -h * 0.012, h * 0.066, h * 0.04 * Math.min(1.1, s), COND, PAPER, { align: 'right', spacing: 0.24, weight: 700, maxW: w * 0.48 });
        if (!I.none) label(g, up(join(I.len + ' long', I.when)), 0, h * 0.125, h * 0.028 * Math.min(1.1, s), SANS, PAPER, { align: 'right', spacing: 0.2, weight: 700, maxW: w * 0.5 });
        g.restore();
      }
      grain(f, 1.2);
    }

    // =========================================================== minimal: one outline on one field
    function minimal(f) {
      const { w, h, t, p } = f, sp = subject(f), I = info(f, sp), hz = h * 0.56, baseY = h * 0.74, L = clamp(p.light);
      const FIELD = mx(mx('#0f1a30', '#c2523a', smooth(0.05, 0.3, L)), '#1d5560', smooth(0.38, 0.7, L)), LINE = '#f4ead2';
      const drink = smooth(0.8, 0.98, Math.sin(t * 0.17));
      const q = sp && stride(f, sp, { pace: (1 - drink) * 0.8, headTo: lerp(0.12, -0.85, drink) });
      sky(f, c => { c.fillStyle = FIELD; c.fillRect(0, 0, w, h); c.strokeStyle = LINE; c.lineWidth = Math.max(1, h * 0.005); c.beginPath(); c.arc(w * 0.16, h * 0.17, h * 0.055, 0, TAU); c.stroke(); });
      g.fillStyle = FIELD; g.fillRect(0, hz, w, h - hz);
      const lw = Math.max(1.2, h * 0.0065);
      g.strokeStyle = LINE; g.lineWidth = lw; g.lineCap = 'round'; g.beginPath(); g.moveTo(w * 0.1, baseY + lw * 0.2); g.lineTo(w * 0.9, baseY + lw * 0.2); g.stroke();
      if (q) {
        const T = fit(sp, w * 0.14, h * 0.12, w * 0.72, baseY), P = parts(q).filter(o => o.k !== 'mark' && o.k !== 'eye' && o.k !== 'mouth' && o.k !== 'nostril' && o.k !== 'tooth' && o.k !== 'belly');
        const e = lw * 1.3; g.lineJoin = 'round';
        for (const o of P) { g.beginPath(); trace(g, o, T); g.strokeStyle = g.fillStyle = LINE; if (o.l) { g.lineWidth = Math.max(0.6, o.w * T.k) + (lw + e) * 2; g.stroke(); } else { g.lineWidth = (lw + e) * 2; g.fill(); g.stroke(); } }
        for (const o of P) { g.beginPath(); trace(g, o, T); g.strokeStyle = g.fillStyle = FIELD; if (o.l) { g.lineWidth = Math.max(0.6, o.w * T.k) + e * 2; g.stroke(); } else { g.lineWidth = e * 2; g.fill(); g.stroke(); } }
        const ey = parts(q).find(o => o.k === 'eye'); if (ey) { g.fillStyle = LINE; g.beginPath(); g.arc(T.x + ey.c[0] * T.k, T.y - ey.c[1] * T.k, Math.max(1.2, lw * 0.8), 0, TAU); g.fill(); }
      }
      impact(f, hz, LINE);
      if (lettered(f)) {
        const s = Math.min(1.15, LS(f));
        label(g, I.name, w * 0.1, h * 0.875, h * 0.034 * s, SANS, LINE, { spacing: 0.06, weight: 700, maxW: w * 0.8 });
        label(g, I.none ? I.span : join(I.means, I.len + ' long', I.when), w * 0.1, h * 0.915, h * 0.025 * s, SANS, LINE, { spacing: 0.06, weight: 400, maxW: w * 0.8 });
      }
      grain(f, 0.5);
    }

    // =========================================================== museum exhibition poster: the skeleton
    function museum(f) {
      const { w, h, t, p } = f, sp = subject(f), I = info(f, sp), hz = h * 0.56, baseY = h * 0.775, L = 0.35 + 0.65 * clamp(p.light);
      const WALL = mx('#0c0b0a', '#2a2622', L), BONE = '#efe6cf';
      const q = sp && stride(f, sp, { pace: 0.55, headTo: 0.15 + 0.1 * Math.sin(t * 0.3) });
      sky(f, c => { c.fillStyle = WALL; c.fillRect(0, 0, w, h);
        const gr = c.createRadialGradient(w * 0.5, h * 0.36, 0, w * 0.5, h * 0.36, w * 0.5); gr.addColorStop(0, `rgba(236,214,170,${0.3 * L})`); gr.addColorStop(1, 'rgba(236,214,170,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, hz + 2); });
      const fl = g.createLinearGradient(0, hz, 0, h); fl.addColorStop(0, mx('#080706', '#1c1917', L)); fl.addColorStop(1, '#070605'); g.fillStyle = fl; g.fillRect(0, hz, w, h - hz);
      g.fillStyle = mx('#1a1815', '#4a443b', L); g.fillRect(w * 0.08, baseY, w * 0.84, h * 0.03); g.fillStyle = mx('#2a2622', '#7a705f', L); g.fillRect(w * 0.08, baseY, w * 0.84, Math.max(1, h * 0.004));
      if (q) {
        const T = fit(sp, w * 0.12, h * 0.08, w * 0.76, baseY), B = bones(q);
        drawParts(g, B, T, { pal: { bone: BONE, boneFar: mx(BONE, WALL, 0.5), hole: WALL }, pupil: false });
      }
      impact(f, hz, BONE);
      if (lettered(f)) {
        const s = LS(f), y = h * 0.905;
        label(g, up(I.name), w / 2, y, h * 0.072 * Math.min(1.1, s), SERIF, BONE, { align: 'center', spacing: 0.26, weight: 400, maxW: w * 0.8 });
        g.fillStyle = '#b08a4a'; g.fillRect(w * 0.44, y + h * 0.018, w * 0.12, Math.max(1, h * 0.003));
        label(g, up(I.none ? I.span : join(I.means, I.len + ' long', I.when)), w / 2, y + h * 0.058, h * 0.0245 * Math.min(1.1, s), SANS, '#c9bea2', { align: 'center', spacing: 0.3, weight: 500, maxW: w * 0.84 });
      }
      grain(f, 0.5);
    }

    const draw = { wpa, travel, memphis, riso, deco, bauhaus, swiss, constr, minimal, museum }[style] || wpa;
    return { render(f) { g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.lineJoin = 'round'; draw(f); } };
  }
};

const S = (id, name, desc, tags, opts, params) => ({ id: 'poster-' + id, name, desc, tags: ['poster', '2d', ...tags], opts, params });
export const scenes = [
  S('wpa', 'Triceratops Country', 'A 1930s national-park screenprint: flat colours, layered hills, and a band that names whoever is grazing.', ['wpa', 'ceratopsian', 'cretaceous', 'family'],
    { style: 'wpa', cast: [{ sp: 'triceratops', n: 2, young: 1 }], biome: 'uplands', mode: 'wander', seed: 5, horizon: 0.54, foot: 0.75 }, { stage: 0.855, light: 0.75 }),
  S('pangaea', 'See Pangaea', 'A sunset travel poster for the one continent, with Coelophysis on the move.', ['travel', 'theropod', 'triassic', 'pack', 'desert'],
    { style: 'travel', cast: [{ sp: 'coelophysis', n: 5 }, { sp: 'plateosaurus', n: 2 }], biome: 'desert', seed: 2, flyers: 0, horizon: 0.56, foot: 0.78 }, { stage: 0.1, light: 0.3 }),
  S('deco', 'Tyrant Deco', 'Tyrannosaurus strides across a gold sunburst, with stepped borders and tall letters.', ['art deco', 'theropod', 'cretaceous'],
    { style: 'deco', sp: 'tyrannosaurus' }, { stage: 0.855, light: 0.3 }),
  S('bauhaus', 'Bauhaus Stegosaurus', 'Circles, triangles and bars in primary colours, built on the joints of the walking animal.', ['bauhaus', 'stegosaur', 'jurassic'],
    { style: 'bauhaus', sp: 'stegosaurus' }, { stage: 0.43 }),
  S('swiss', 'Swiss Diplodocus', 'A strict grid, a big grotesque name, one red, and 26 metres of sauropod walking through it.', ['swiss', 'typography', 'sauropod', 'jurassic'],
    { style: 'swiss', sp: 'diplodocus' }, { stage: 0.42 }),
  S('memphis', 'Memphis Duck-bills', 'Squiggles, confetti and clashing pastels around a herd of Parasaurolophus.', ['memphis', 'ornithopod', 'cretaceous', 'herd'],
    { style: 'memphis', cast: [{ sp: 'parasaurolophus', n: 3, young: 2 }], biome: 'plain', seed: 12, horizon: 0.54, foot: 0.76 }, { stage: 0.8 }),
  S('riso', 'Two-Colour Riso', 'Pink and blue inks overprinted a little off register, with halftone shading, in the conifers.', ['risograph', 'ankylosaur', 'cretaceous', 'forest'],
    { style: 'riso', cast: [{ sp: 'ankylosaurus', n: 2 }, { sp: 'pachycephalosaurus', n: 2 }], biome: { hills: 0.4, density: 0.4, tall: 0.5, far: 'hills', mult: { conifer: 2, fern: 2, cycad: 1 } }, mode: 'wander', seed: 23, horizon: 0.54, foot: 0.75 }, { stage: 0.86, light: 0.7 }),
  S('constructivist', 'Constructivist Roar', 'Red and black wedges and a cut-out Allosaurus head, roaring in diagonals.', ['constructivist', 'theropod', 'jurassic'],
    { style: 'constr', sp: 'allosaurus' }, { stage: 0.43 }),
  S('minimal', 'One Line', 'Spinosaurus as a single outline on one field of colour, with a tiny caption. Light changes the field.', ['minimal', 'theropod', 'cretaceous'],
    { style: 'minimal', sp: 'spinosaurus' }, { stage: 0.71, light: 0.3 }),
  S('museum', 'Exhibition Poster', 'A museum poster: the walking skeleton of Brachiosaurus under a spotlight and a plain title.', ['museum', 'skeleton', 'sauropod', 'jurassic'],
    { style: 'museum', sp: 'brachiosaurus' }, { stage: 0.425, light: 0.6 }),
  S('night', 'Moonlit Park', 'The park poster after dark: Velociraptors under a paper moon in the Gobi dunes.', ['wpa', 'theropod', 'cretaceous', 'night', 'pack', 'desert'],
    { style: 'wpa', cast: [{ sp: 'velociraptor', n: 4 }, { sp: 'protoceratops', n: 2 }], biome: 'desert', seed: 21, horizon: 0.54, foot: 0.75 }, { stage: 0.79, light: 0.08 }),
  S('deeptime', 'Park Through Time', 'One park poster through 180 million years: the cast and the lettering change with the eras.', ['wpa', 'time travel', 'herd'],
    { style: 'wpa', cast: 'era', biome: 'plain', seed: 1, horizon: 0.54, foot: 0.75 }, { stage: 0.02, grow: 0.5 }),
];
