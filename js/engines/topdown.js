// From Above: herds seen from directly overhead, like drone footage.
// The engine runs its own small simulation: every animal is an agent on a plane (position, heading, speed) steered
// boids-style (cohesion, separation, alignment, a goal). Each is drawn with topParts(pose(…)) turned to its heading,
// with a shadow thrown by the sun. The gait phase advances with distance, so feet land where the rig puts them, and
// every footfall leaves a print that fades slowly: herds draw trackways across the ground.
// Ground is a noise texture baked into world-anchored tiles; plants are rosettes and tree crowns seen from above.
import { clamp, lerp, smooth, hash, rng, TAU, puff, energy, windDir, daylight } from '../util.js';
import { species, standIn } from '../species.js';
import { pose, topParts, gait } from '../rig.js';
import { palette, drawParts, trace } from '../draw.js';
import { flora } from '../flora.js';

const PI = Math.PI, FONT = 'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
const wrapA = a => { a = (a + PI) % TAU; return (a < 0 ? a + TAU : a) - PI; };
const css = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

// ---- fast tileable value noise (a lookup table: the ground is evaluated per pixel)
const NTAB = new Float32Array(65536); { const R = rng(90210); for (let i = 0; i < 65536; i++) NTAB[i] = R(); }
function vn(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const x0 = ix & 255, x1 = (ix + 1) & 255, y0 = (iy & 255) << 8, y1 = ((iy + 1) & 255) << 8;
  const a = NTAB[y0 | x0], b = NTAB[y0 | x1], c = NTAB[y1 | x0], d = NTAB[y1 | x1];
  return a + (b - a) * ux + (c - a + (a - b - c + d) * ux) * uy;
}
const fb2 = (x, y) => vn(x, y) * 0.67 + vn(x * 2.1 + 31.7, y * 2.1 + 11.3) * 0.33;
const fb3 = (x, y) => vn(x, y) * 0.57 + vn(x * 2.1 + 31.7, y * 2.1 + 11.3) * 0.29 + vn(x * 4.3 + 7.1, y * 4.3 + 53.9) * 0.14;

// thermal camera palette ("ironbow"): 0 cold … 1 hot
const IRON = [[0, 6, 5, 26], [0.2, 52, 14, 104], [0.4, 152, 26, 120], [0.6, 228, 82, 40], [0.8, 252, 182, 38], [1, 255, 255, 236]];
function iron(t) {
  t = clamp(t);
  for (let i = 1; i < IRON.length; i++) if (t <= IRON[i][0]) { const a = IRON[i - 1], b = IRON[i], u = (t - a[0]) / (b[0] - a[0]); return [lerp(a[1], b[1], u), lerp(a[2], b[2], u), lerp(a[3], b[3], u)]; }
  return [255, 255, 236];
}
const ironCss = (t, a = 1) => { const c = iron(t); return css(c[0], c[1], c[2], a); };

// ---- the ground: colour, how much grows there (veg) and water depth at a world point (metres).
// Lengths are measured in tenths of the main animal's body length, so every cast gets the same picture.
let gR = 0, gG = 0, gB = 0, gVeg = 0, gWat = 0;
function riverAt(x, y) {         // signed distance across the channel, in half-widths (0 mid-stream, 1 at the bank)
  const xc = 7 * Math.sin(y / 24) + 12 * (vn(3.3, y / 36) - 0.5), hw = 12 + 4 * Math.sin(y / 15 + 1);
  return (x - xc) / hw;
}
function ground(G, wx, wy) {
  const x = wx / G.fs + G.ox, y = wy / G.fs + G.oy, E = G.E, kind = G.kind;
  let r, g, b, veg = 0, wat = 0;
  const n = fb3(x / 22, y / 22), m = fb2(x / 5 + 9.3, y / 5 + 4.1), sp = vn(x * 1.1, y * 1.1);
  if (kind === 'mud') {
    const d = smooth(0.36, 0.74, n), rp = Math.sin((y * 0.9 + x * 0.28) * 1.5 + m * 7) * (1 - d);
    r = lerp(122, 170, d) + rp * 5; g = lerp(108, 153, d) + rp * 5; b = lerp(92, 126, d) + rp * 4;
    const pool = 1 - smooth(0.25, 0.295, n + (m - 0.5) * 0.06), rim = smooth(0.28, 0.38, n);
    r *= lerp(0.84, 1, rim); g *= lerp(0.85, 1, rim); b *= lerp(0.88, 1, rim);
    r = lerp(r, 128 + m * 26, pool * 0.85); g = lerp(g, 148 + m * 22, pool * 0.85); b = lerp(b, 150 + m * 18, pool * 0.85);
    wat = pool * 0.22; veg = smooth(0.6, 0.76, n) * (0.4 + m);
    r = lerp(r, 128, veg * 0.3); g = lerp(g, 136, veg * 0.3); b = lerp(b, 92, veg * 0.3);
  } else if (kind === 'dunes') {
    const u = (x * 0.93 + y * 0.36) / 11 + 1.7 * n, s = u - Math.floor(u);
    let sh = s < 0.76 ? lerp(0.86, 1.07, s / 0.76) : s < 0.84 ? lerp(1.07, 0.68, (s - 0.76) / 0.08) : lerp(0.68, 0.86, (s - 0.84) / 0.16);
    sh *= 1 + 0.025 * Math.sin((x * 0.9 + y * 0.42) * 4.4 + m * 9);
    const flat = smooth(0.56, 0.7, fb2(x / 38 + 5, y / 38 + 2));
    sh = lerp(sh, 0.94 + 0.05 * m, flat);
    r = lerp(226, 204, flat) * sh; g = lerp(194, 176, flat) * sh; b = lerp(138, 138, flat) * sh;
    veg = flat * 0.7 + 0.08;
  } else if (kind === 'playa') {
    r = 214 + n * 22 - m * 10; g = 200 + n * 18 - m * 10; b = 170 + n * 10 - m * 10;
    // drying cracks: cell edges of a jittered grid
    const cx = x / 4.6, cy = y / 4.6, ix = Math.floor(cx), iy = Math.floor(cy); let d1 = 9, d2 = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const px = ix + i, py = iy + j, q = NTAB[((py & 255) << 8) | (px & 255)], q2 = NTAB[(((py + 57) & 255) << 8) | ((px + 131) & 255)];
      const dx = px + q - cx, dy = py + q2 - cy, d = dx * dx + dy * dy; if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
    const crack = 1 - smooth(0.02, 0.1, Math.sqrt(d2) - Math.sqrt(d1)), wet = 1 - smooth(0.25, 0.4, n);
    const k = 1 - crack * 0.12 * (1 - wet) - wet * 0.07; r *= k; g *= k; b *= k * (1 + wet * 0.06);
    veg = smooth(0.7, 0.8, n) * 0.5;
  } else if (kind === 'stone') {
    const k = 0.93 + 0.12 * m + 0.03 * (sp - 0.5);
    r = lerp(172, 148, n) * k; g = lerp(166, 145, n) * k; b = lerp(154, 138, n) * k;
    const st = smooth(0.6, 0.82, fb2(x / 13 + 20, y / 13 + 8)) * 0.4; r = lerp(r, 182, st); g = lerp(g, 152, st); b = lerp(b, 116, st);
    const rp = smooth(0.45, 0.6, fb2(x / 30 + 7, y / 30)) * Math.sin((x * 0.5 - y * 0.86) * 2 + n * 6); r += rp * 5; g += rp * 5; b += rp * 5;
  } else {        // fern prairie, also the base for 'river' and 'nest'
    veg = smooth(0.34, 0.62, n * 0.72 + m * 0.28 + 0.1 - E.dry * 0.14);
    const sr = lerp(160, 184, m) + E.dry * 12, sg = lerp(134, 150, m), sb = lerp(92, 100, m) - E.dry * 8;
    const k = 0.9 + 0.2 * sp;
    r = lerp(sr, lerp(104, 70, m), veg * 0.88) * k; g = lerp(sg, lerp(132, 104, m), veg * 0.88) * k; b = lerp(sb, lerp(72, 58, m), veg * 0.88) * k;
    if (kind === 'river') {
      const ad = Math.abs(riverAt(wx / G.fs, wy / G.fs)), bar = smooth(0.52, 0.74, fb2(x / 8 + 40, y / 15 + 3));
      const depth = (1 - ad) * 1.5 - bar * 0.75, land = smooth(1.02, 1.5, ad + (m - 0.5) * 0.5);
      r = lerp(200 - m * 16, r, land); g = lerp(180 - m * 14, g, land); b = lerp(134 - m * 10, b, land); veg *= land;
      if (depth > -0.12) { const sh = smooth(-0.12, 0.06, depth), dp = smooth(0.05, 0.9, depth);
        r = lerp(r, lerp(138, 52, dp), sh * 0.94); g = lerp(g, lerp(158, 104, dp), sh * 0.94); b = lerp(b, lerp(138, 116, dp), sh * 0.94); wat = clamp(depth) * sh; veg = 0; }
    } else if (kind === 'nest') {
      const d = Math.hypot(wx, wy) / G.colony + (n - 0.5) * 0.5, col = 1 - smooth(0.8, 1.25, d);
      r = lerp(r, 186 + m * 14, col * 0.92); g = lerp(g, 160 + m * 12, col * 0.92); b = lerp(b, 114 + m * 8, col * 0.92); veg *= 1 - col;
    }
  }
  if (G.tint) { r *= G.tint[0]; g *= G.tint[1]; b *= G.tint[2]; }
  if (E.ferns > 0 && kind !== 'stone') { const k = E.ferns * 0.5 * (0.4 + veg * 0.6); r = lerp(r, 84, k); g = lerp(g, 128, k); b = lerp(b, 64, k); }
  if (G.burnt > 0 && kind !== 'stone') { const k = G.burnt * 0.78, a = 58 + n * 34 + sp * 10; r = lerp(r, a + 6, k); g = lerp(g, a, k); b = lerp(b, a - 4, k); }
  if (G.thermal) { const t = 0.1 + 0.42 * ((r * 0.3 + g * 0.59 + b * 0.11) / 255 - 0.42) + veg * 0.035 - wat * 0.3 + G.warm, c = iron(t); r = c[0]; g = c[1]; b = c[2]; }
  gR = r; gG = g; gB = b; gVeg = veg; gWat = wat;
}

// ---- plants from above. LOW grow as rosettes and clumps the animals walk over; TREES are crowns they walk around.
const LOW = { fern: 0.95, horsetail: 0.7, bush: 1.1, cycad: 1.5, flowers: 0.8, rock: 0.8, stump: 0.7 };
const TREE = { treefern: [2.5, 6], ginkgo: [4.4, 13], conifer: [3.6, 20], araucaria: [5, 26], magnolia: [3.6, 8], palm: [2.7, 9], deadtree: [3.2, 3] };
function pick(W, set, bias, q) {
  let tot = 0; for (const k in set) tot += (W[k] || 0) * (bias[k] ?? 1);
  if (tot <= 0) return null;
  let u = q * tot; for (const k in set) { u -= (W[k] || 0) * (bias[k] ?? 1); if (u <= 0) return k; }
  return null;
}
function makeSprites(burnt, thermal) {
  const out = {};
  const col = (r, g, b, a = 1) => {
    if (thermal) return ironCss(0.15 + 0.1 * (r * 0.3 + g * 0.59 + b * 0.11) / 255, a);
    const k = burnt * 0.82, m = (r + g + b) / 3 * 0.55 + 14; return css(lerp(r, m + 5, k), lerp(g, m, k), lerp(b, m - 4, k), a);
  };
  const mk = (kind, size, n, fn) => { out[kind] = []; for (let v = 0; v < n; v++) { const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); g.translate(size / 2, size / 2); g.scale(size * 0.46, size * 0.46); fn(g, rng(Math.imul(v + 3, 2654435761) ^ kind.length * 7919)); out[kind].push(c); } };
  const fronds = (g, R, n, len, wid, rot, c) => { g.fillStyle = c; g.beginPath(); for (let i = 0; i < n; i++) { const a = rot + i / n * TAU + (R() - 0.5) * 0.25, l = len * (0.78 + R() * 0.22);
    g.moveTo(0, 0); g.quadraticCurveTo(Math.cos(a - wid) * l * 0.6, Math.sin(a - wid) * l * 0.6, Math.cos(a) * l, Math.sin(a) * l); g.quadraticCurveTo(Math.cos(a + wid) * l * 0.6, Math.sin(a + wid) * l * 0.6, 0, 0); } g.fill(); };
  const star = (g, n, r0, r1, rot, c) => { g.fillStyle = c; g.beginPath(); for (let i = 0; i < n * 2; i++) { const a = rot + i * PI / n, r = i % 2 ? r1 : r0; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); };
  const dot = (g, x, y, r, c) => { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
  const lumps = (g, R, n, c1, c2, hi) => { for (let i = 0; i < n; i++) { const a = i / n * TAU + R(), d = 0.42 + R() * 0.12; dot(g, Math.cos(a) * d, Math.sin(a) * d, 0.34 + R() * 0.14, i % 2 ? c1 : c2); } dot(g, 0, 0, 0.5, c1);
    for (let i = 0; i < n; i++) { const a = R() * TAU, d = R() * 0.55; dot(g, Math.cos(a) * d - 0.12, Math.sin(a) * d - 0.12, 0.16 + R() * 0.1, hi); } };
  mk('fern', 48, 3, (g, R) => { fronds(g, R, 9, 1, 0.32, R() * 6, col(50, 96, 48)); fronds(g, R, 7, 0.66, 0.3, R() * 6, col(84, 136, 62)); });
  mk('cycad', 56, 3, (g, R) => { fronds(g, R, 14, 1, 0.14, R() * 6, col(40, 86, 50)); fronds(g, R, 11, 0.7, 0.14, R() * 6, col(72, 122, 60)); dot(g, 0, 0, 0.14, col(104, 80, 52)); });
  mk('horsetail', 40, 3, (g, R) => { for (let i = 0; i < 9; i++) { const a = R() * TAU, d = R() * 0.7; star(g, 6, 0.26, 0.09, R() * 3, col(i % 2 ? 96 : 70, i % 2 ? 146 : 122, 74)); g.translate(Math.cos(a) * d * 0.4, Math.sin(a) * d * 0.4); if (i % 3 === 2) g.setTransform(18.4, 0, 0, 18.4, 20, 20); } });
  mk('bush', 40, 3, (g, R) => lumps(g, R, 6, col(58, 100, 54), col(76, 118, 58), col(102, 142, 70, 0.8)));
  mk('flowers', 40, 3, (g, R) => { for (let i = 0; i < 5; i++) { const a = R() * TAU; dot(g, Math.cos(a) * 0.4, Math.sin(a) * 0.4, 0.4, col(78, 122, 60, 0.75)); }
    for (let i = 0; i < 16; i++) { const a = R() * TAU, d = R() * 0.8, c = [[244, 222, 232], [250, 244, 214], [236, 190, 96], [226, 150, 176]][i % 4]; dot(g, Math.cos(a) * d, Math.sin(a) * d, 0.085, col(c[0], c[1], c[2])); } });
  mk('rock', 40, 3, (g, R) => { const p = []; for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, r = 0.6 + R() * 0.38; p.push([Math.cos(a) * r, Math.sin(a) * r]); }
    g.fillStyle = col(112, 108, 100); g.beginPath(); for (const v of p) g.lineTo(v[0], v[1]); g.fill(); g.fillStyle = col(164, 160, 150); g.beginPath(); for (const v of p) g.lineTo(v[0] * 0.66 - 0.12, v[1] * 0.66 - 0.14); g.fill(); });
  mk('stump', 32, 2, (g, R) => { dot(g, 0, 0, 0.9, col(74, 60, 46)); dot(g, 0, 0, 0.66, col(128, 106, 80)); dot(g, 0.05, 0.05, 0.3, col(96, 78, 58)); });
  mk('treefern', 96, 3, (g, R) => { fronds(g, R, 12, 1, 0.16, R() * 6, col(44, 94, 50)); fronds(g, R, 10, 0.68, 0.16, R() * 6, col(78, 134, 62)); dot(g, 0, 0, 0.1, col(92, 72, 50)); });
  mk('palm', 96, 3, (g, R) => { fronds(g, R, 11, 1, 0.13, R() * 6, col(52, 100, 50)); fronds(g, R, 9, 0.62, 0.14, R() * 6, col(94, 142, 64)); dot(g, 0, 0, 0.09, col(110, 88, 58)); });
  mk('conifer', 96, 3, (g, R) => { star(g, 15, 1, 0.66, R(), col(30, 66, 44)); star(g, 12, 0.72, 0.44, R(), col(44, 86, 52)); star(g, 9, 0.44, 0.24, R(), col(66, 108, 60)); star(g, 6, 0.2, 0.1, R(), col(96, 134, 72)); });
  mk('araucaria', 112, 3, (g, R) => { const n = 13; g.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) { const a = i / n * TAU + pass * 0.24, l = pass ? 0.52 : 0.84, c = Math.cos(a), s = Math.sin(a);
      g.strokeStyle = col(70, 58, 44); g.lineWidth = 0.035; g.beginPath(); g.moveTo(0, 0); g.lineTo(c * l, s * l); g.stroke(); dot(g, c * l, s * l, pass ? 0.13 : 0.16, pass ? col(62, 110, 60) : col(36, 78, 50)); dot(g, c * l * 0.62, s * l * 0.62, 0.1, col(48, 92, 54)); }
    dot(g, 0, 0, 0.16, col(80, 126, 66)); });
  mk('ginkgo', 96, 3, (g, R) => lumps(g, R, 8, col(98, 130, 58), col(120, 148, 64), col(160, 176, 84, 0.85)));
  mk('magnolia', 96, 3, (g, R) => { lumps(g, R, 8, col(46, 98, 56), col(60, 112, 60), col(84, 136, 72, 0.85)); for (let i = 0; i < 12; i++) { const a = R() * TAU, d = R() * 0.8; dot(g, Math.cos(a) * d, Math.sin(a) * d, 0.055, col(246, 232, 236)); } });
  mk('deadtree', 96, 3, (g, R) => { g.lineCap = 'round'; const a0 = R() * TAU; g.strokeStyle = col(66, 56, 48); g.lineWidth = 0.09; g.beginPath(); g.moveTo(-Math.cos(a0) * 0.9, -Math.sin(a0) * 0.9); g.lineTo(Math.cos(a0) * 0.5, Math.sin(a0) * 0.5); g.stroke();
    g.lineWidth = 0.04; for (let i = 0; i < 6; i++) { const u = R() * 1.2 - 0.3, a = a0 + (R() < 0.5 ? 1 : -1) * (0.5 + R() * 0.5), l = 0.25 + R() * 0.3, x = Math.cos(a0) * u, y = Math.sin(a0) * u; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); } });
  const sh = document.createElement('canvas'); sh.width = sh.height = 64; const g = sh.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.62, 'rgba(0,0,0,.9)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); out.shadow = sh;
  return out;
}
let GRAIN = null;
function grain() {
  if (GRAIN) return GRAIN;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), R = rng(4711);
  for (let i = 0; i < 1500; i++) { const d = R() < 0.6; g.fillStyle = d ? `rgba(40,30,20,${0.1 + R() * 0.22})` : `rgba(255,250,235,${0.08 + R() * 0.2})`; const s = 0.6 + R() * R() * 2.4; g.fillRect(R() * 128, R() * 128, s, s * (0.7 + R() * 0.6)); }
  return GRAIN = c;
}

// ---- a top view with more character than the bare rig gives: pattern, horns, clubs, crests, feathers
function extras(q, P, small) {
  const { sp, L, nodes: n, iHip, iSh } = q, F = sp.f, h = q.head, e = n[n.length - 1], c = Math.cos(h.a) * h.len, w = e.r * 1.25;
  if (!small) {
    if (sp.pat === 'stripes' || sp.pat === 'bands') { const st = sp.pat === 'bands' ? 2 : 1; for (let i = 3; i < iSh + 2; i += st) { const o = n[i], r = o.r * (sp.P.biped ? 0.6 : 0.78); P.push({ k: 'mark', t: 'mark', l: [[o.x, o.z - r], [o.x, o.z + r]], w: L * (st === 2 ? 0.02 : 0.011) }); } }
    else if (sp.pat === 'spots') for (let i = 4; i < iSh + 2; i++) { const o = n[i], s = i % 2 ? 1 : -1; P.push({ k: 'mark', t: 'mark', c: [o.x, o.z + s * o.r * 0.42, o.r * 0.26] }); }
    if (F.scutes) for (let i = 3; i <= iSh; i++) { const o = n[i]; for (const s of [-0.5, 0, 0.5]) P.push({ k: 'scute', t: 'mark', c: [o.x, o.z + s * o.r, o.r * 0.14] }); }
  }
  if (F.sail || F.spines || F.neckSpines) { const i0 = F.neckSpines ? iSh : Math.round(iHip * 0.6), i1 = F.neckSpines ? n.length - 2 : iSh, l = []; for (let i = i0; i <= i1; i++) l.push([n[i].x, n[i].z]); P.push({ k: 'sail', t: 'accent', l, w: L * (F.sail ? 0.014 : 0.008) }); }
  if (F.club) P.push({ k: 'club', t: 'far', c: [n[0].x, n[0].z, L * 0.028 * F.club] });
  if (F.spikes) for (const i of [0, 1]) { const o = n[i], d = L * 0.045; for (const s of [-1, 1]) P.push({ k: 'spike', t: 'horn', l: [[o.x, o.z], [o.x - d * 0.35, o.z + s * d]], w: L * 0.008 }); }
  if (F.sideSpike) { const o = n[iSh - 1], d = L * 0.05; for (const s of [-1, 1]) P.push({ k: 'spike', t: 'horn', l: [[o.x, o.z + s * o.r * 0.8], [o.x - d * 0.5, o.z + s * (o.r + d)]], w: L * 0.009 }); }
  if (F.wings) { const o = n[iSh], d = L * 0.085 * F.wings, r = o.r * 0.7; for (const s of [-1, 1]) P.push({ k: 'wing', t: 'accent', p: [[o.x + d * 0.2, o.z + s * r], [o.x - d * 0.5, o.z + s * (r + d * 0.5)], [o.x - d * 1.7, o.z + s * (r + d * 0.2)], [o.x - d * 0.9, o.z + s * r * 0.6]], s: 1 }); }
  if (F.wingFold) { const o = n[iSh - 2], d = L * 0.16; for (const s of [-1, 1]) P.push({ k: 'wing', t: 'far', p: [[o.x + d, o.z + s * o.r * 0.5], [o.x, o.z + s * o.r * 1.05], [o.x - d * 1.3, o.z + s * o.r * 0.5]], s: 1 }); }
  if (F.tailFan) { const o = n[0], d = L * 0.09 * F.tailFan; P.push({ k: 'tailfan', t: 'accent', p: [[o.x + d, o.z], [o.x - d * 0.3, o.z + d * 0.36], [o.x - d, o.z], [o.x - d * 0.3, o.z - d * 0.36]], s: 1 }); }
  if (F.frillSpikes) for (let i = -2; i <= 2; i++) { const a = PI + i * 0.42; P.push({ k: 'horn', t: 'horn', l: [[h.x - c * 0.45 + Math.cos(a) * w * 0.3, Math.sin(a) * w * 1.7], [h.x - c * 0.45 + Math.cos(a) * w * 1.5, Math.sin(a) * w * 2.6]], w: w * 0.22 }); }
  if (F.horns) for (const s of [-1, 1]) P.push({ k: 'horn', t: 'horn', l: [[h.x + c * 0.22, s * w * 0.62], [h.x + c * 0.86, s * w * 0.86]], w: w * 0.24 });
  if (F.noseHorn) P.push({ k: 'horn', t: 'horn', c: [h.x + c * 0.78, 0, w * 0.2 * Math.min(1.4, 0.6 + F.noseHorn * 0.5)] });
  const cr = F.crest;
  if (cr === 'tube') P.push({ k: 'crest', t: 'accent', l: [[h.x + c * 0.35, 0], [h.x - c * 0.75, 0]], w: w * 0.5 });
  else if (cr === 'double') for (const s of [-1, 1]) P.push({ k: 'crest', t: 'accent', l: [[h.x + c * 0.15, s * w * 0.4], [h.x + c * 0.75, s * w * 0.25]], w: w * 0.24 });
  else if (cr === 'horns') for (const s of [-1, 1]) P.push({ k: 'horn', t: 'horn', c: [h.x + c * 0.3, s * w * 0.8, w * 0.26] });
  else if (cr) P.push({ k: 'crest', t: 'accent', c: [h.x + c * (cr === 'nose' ? 0.7 : cr === 'dome' ? 0.25 : 0.3), 0, w * (cr === 'helmet' || cr === 'dome' ? 0.62 : 0.4)] });
}
// swing the neck and the tail sideways (bn, bt: sideways shift at the tips as a fraction of their length)
function bend(P, q, bn, bt) {
  const xs = q.nodes[q.iSh].x, Ln = Math.max(0.01, q.head.x + q.head.len - xs), Lt = Math.max(0.01, -q.nodes[0].x), kn = bn / Ln, kt = bt / Lt;
  const f = v => { const x = v[0], z = v[1] * WIDE; return x > xs ? [x, z + kn * (x - xs) * (x - xs)] : x < 0 ? [x, z + kt * x * x] : [x, z]; };
  for (const p of P) { if (p.c) { const v = f(p.c); p.c = [v[0], v[1], p.c[2]]; } else if (p.p) p.p = p.p.map(f); else p.l = p.l.map(f); }
}
const WIDE = 1.3;      // bodies are drawn a little broader than life so they read from the air
const THERM = { body: 0.8, belly: 0.86, far: 0.6, mark: 0.93, accent: 0.68, accentFar: 0.6, horn: 0.36, eye: 1, mouth: 1 };
const thermPal = {}; for (const k in THERM) thermPal[k] = ironCss(THERM[k]);

const NP = 4200, ND = 160, NR = 90;

export default {
  id: 'topdown',
  name: 'From Above',
  kind: '2d',
  sky: false,
  params: [
    { id: 'x1', label: 'Trackways', value: 0.6, tip: 'How long footprints last before they fade' },
    { id: 'x2', label: 'Flocking', value: 0.5, tip: 'How tightly the animals keep together and move as one' },
    { id: 'x3', label: 'Altitude', value: 0.5, tip: 'How high the camera flies' },
    { id: 'x4', label: 'Survey', value: 0.3, tip: 'Scale bar, then name tags and a metre grid' },
  ],
  create(ctx, O) {
    const mode = O.mode || 'trek', style = O.style || 'drone', thermal = style === 'thermal', slab = style === 'slab';
    const seed = O.seed || 1, SP = O.space || 1;
    let S = null, A = [], T = 0, U = 10, sigSp = '', lastStage = -9, lastEpoch = -9, builtHerd = -9, nextId = 0, R = rng(1);
    let cam = { x: 0, y: 0 }, K = 1, cen = [], preds = [], trees = [], lunger = null;
    const tiles = new Map(), treeCache = new Map(), pals = new Map();
    let sprites = null, spriteKey = '', G = null, tileStage = -9;
    const pr = { x: new Float32Array(NP), y: new Float32Array(NP), a: new Float32Array(NP), s: new Float32Array(NP), t: new Float32Array(NP).fill(-1e9), k: new Uint8Array(NP), i: 0 };
    const dust = { x: new Float32Array(ND), y: new Float32Array(ND), r: new Float32Array(ND), t: new Float32Array(ND).fill(-1e9), i: 0 };
    const rings = { x: new Float32Array(NR), y: new Float32Array(NR), r: new Float32Array(NR), t: new Float32Array(NR).fill(-1e9), i: 0 };
    let events = [], nests = [], frameSig = null, en = 1, FL = 1, vw = 100, vh = 60, live = false;

    // ---------------------------------------------------------------- cast
    function plan(f) {
      const E = f.era, hf = 0.35 + 1.3 * f.p.herd, out = [];
      for (const c of O.cast) {
        const sp = c.lock ? species(c.sp) : standIn(c.sp, E.ma);
        if (!sp) { out.push(null); continue; }
        const al = sp.plan === 'bird' ? 1 : E.dinos;
        let n = Math.round((c.fixed ? c.n : Math.max(1, Math.round(c.n * hf))) * al);
        if (!n && al > 0.03 && !out.some(Boolean) && !c.fixed) n = 1;
        out.push({ sp, n, young: Math.round((c.young || 0) * hf * al), c });
      }
      return out;
    }
    function agent(sp, scale, young, role, g, x, y, hd) {
      const q = pose(sp, { scale, young }), G0 = gait(sp, 0, scale), L = sp.len * scale, ph = R() * 8;
      const offs = sp.P.biped ? [0.5, 0] : [0.25, 0.5, 0, 0.75];
      const a = { id: nextId++, sp, scale, young, role, g, x, y, hd, v: 0, om: 0, phase: ph, run: 0, L, H: q.H, vW: G0.vWalk, vTop: G0.top, tr: clamp(4.5 / Math.pow(L, 0.85), 0.2, 4),
        legs: q.legs.map((l, i) => ({ jx: l.pts[0][0], z: l.z * 1.5 * WIDE, front: l.front, r: l.R[3], off: offs[i] })), cyc: null, headTo: 0, crouch: 0, jaw: 0, look: 0, bn: 0, bt: 0,
        fx: 0, fy: 0, vt: 0, face: null, wH: 0, wC: 0, wJ: 0, wL: 0, sx: 0, sy: 0, st: '', tm: R() * 6, wade: 0, alpha: 1, dead: false, scare: 0, h1: R(), h2: R(), pace: G0.vWalk, mass: sp.mass * scale * scale * scale };
      a.cyc = a.legs.map(l => Math.floor(ph + l.off));
      return a;
    }
    const spawn = (c, ci, young, role, x, y, hd) => { const s = young ? 0.3 + R() * 0.22 : 0.9 + R() * 0.12; const a = agent(c.sp, s, young ? 0.8 : 0, role, c.c.g ?? 0, x, y, hd); a.ci = ci; a.kid = young; A.push(a); return a; };

    function build(f) {
      const E = f.era; R = rng(Math.imul(seed, 2654435761) ^ 0x9e37);
      const cast = plan(f); A = []; nextId = 0; T = 0; events = []; nests = []; lunger = null;
      pr.t.fill(-1e9); dust.t.fill(-1e9); rings.t.fill(-1e9);
      const first = cast.find(Boolean);
      U = first ? first.sp.len : species(O.cast[0].sp).len;
      S = { dir: O.dir ?? 0.18, view: (O.view || 5) * U, pace: 1, home: 0 };
      tiles.clear(); treeCache.clear(); tileStage = f.stage;
      G = { kind: O.ground || 'prairie', fs: U / 10, ox: seed * 37.7, oy: seed * 91.3, E, burnt: 0, thermal, warm: 0, tint: O.tint, colony: 1 };
      setEra(f); view(f);
      cast.forEach((c, ci) => { if (!c) return; const role = c.c.role || 'herd';
        for (let i = 0; i < c.n; i++) spawn(c, ci, false, role, 0, 0, 0).slot = i;
        for (let i = 0; i < c.young; i++) spawn(c, ci, true, role === 'pred' ? 'herd' : role, 0, 0, 0).slot = i; });
      // one walking pace per group: the slowest adult sets it
      const gp = {}; for (const a of A) if (!a.kid) gp[a.g + a.role] = Math.min(gp[a.g + a.role] ?? 99, a.vW);
      for (const a of A) a.pace = gp[a.g + a.role] ?? a.vW;
      init[mode]();
      sigSp = cast.map(c => c ? c.sp.id : '-').join(); builtHerd = f.p.herd;
      centroids(); cam.x = S.cx ?? 0; cam.y = S.cy ?? 0;
      const dt = 0.12, n = Math.round((O.warm ?? 60) / dt); live = false;
      for (let i = 0; i < n; i++) { live = i > n - 28; step(dt); if (mode === 'trek') follow(1); }
      for (const a of A) { a.headTo = a.wH; a.crouch = a.wC; }
    }
    function setEra(f) {
      const E = f.era; G.E = E; G.burnt = Math.min(1, E.dark * 1.3 + (1 - E.dinos) * (1 - E.ferns) * 0.45); G.warm = thermal ? f.p.light * 0.1 : 0;
      en = energy(f); FL = f.p.x2 * 2;
    }
    function view(f) {
      vh = S.view * lerp(0.6, 1.75, f.p.x3) * lerp(1.45, 0.69, f.p.scale); K = f.h / vh; vw = f.w / K;
    }

    // ---------------------------------------------------------------- where everyone starts
    const init = {
      trek() {
        const ad = A.filter(a => !a.kid), yo = A.filter(a => a.kid), n = ad.length, c = Math.cos(S.dir), s = Math.sin(S.dir);
        ad.forEach((a, i) => { const u = (i + 0.5) / n * TAU + R() * 0.5, rx = U * (0.35 + 0.2 * Math.sqrt(n)), ry = U * (0.16 + 0.13 * Math.sqrt(n)), l = Math.cos(u) * rx * (0.6 + R() * 0.4), w = Math.sin(u) * ry * (0.6 + R() * 0.4);
          a.x = l * c - w * s; a.y = l * s + w * c; a.hd = S.dir + (R() - 0.5) * 0.2; a.v = a.pace; });
        yo.forEach(a => { const l = (R() - 0.5) * U * 0.5, w = (R() - 0.5) * U * 0.3; a.x = l * c - w * s; a.y = l * s + w * c; a.hd = S.dir; a.v = a.pace; });
      },
      flock() { for (const a of A) { const u = R() * TAU, d = Math.sqrt(R()) * U * (0.6 + 0.22 * Math.sqrt(A.length)); a.x = Math.cos(u) * d - vh * 0.3; a.y = Math.sin(u) * d * 0.6; a.hd = 0.3 + (R() - 0.5) * 0.4; a.v = a.vW * 2; } },
      lanes() {
        const ext = extent(S.dir);
        const groups = {}; for (const a of A) (groups[a.ci] = groups[a.ci] || []).push(a);
        for (const ci in groups) { const L = groups[ci], c0 = L[0], d = S.dir + (O.cast[ci].turn || 0), c = Math.cos(d), s = Math.sin(d), gap = O.gap ?? 0.36, loose = O.loose ?? 0, lane0 = (O.cast[ci].lane || 0) * U;
          L.forEach((a, i) => { a.dir = d;
            if (loose) { a.lane = lane0 + (R() + R() + R() - 1.5) * U * loose; a.s0 = (R() * 2 - 1) * ext; }
            else { const k = a.kid ? (i - L.filter(b => !b.kid).length) + 0.5 : i, nA = L.filter(b => !b.kid).length; a.lane = lane0 + (k - (nA - 1) / 2) * U * gap * (a.kid ? 1 : 1) + (R() - 0.5) * U * 0.05; const run = a.pace * lerp(0.65, 1.5, (en - 0.4) / 1.2) * (O.warm ?? 60); a.s0 = ((((O.cast[ci].at ?? 0) * ext + (R() - 0.5) * U * 0.5 - (a.kid ? U * 0.35 : 0) - run + ext) % (2 * ext)) + 2 * ext) % (2 * ext) - ext; }
            a.x = c * a.s0 - s * a.lane; a.y = s * a.s0 + c * a.lane; a.hd = d; a.v = a.pace; }); }
      },
      siege() {
        const pd = A.filter(a => a.role === 'pred'), df = A.filter(a => a.role !== 'pred');
        df.forEach((a, i) => { const u = i / df.length * TAU; a.x = Math.cos(u) * U * 0.3; a.y = Math.sin(u) * U * 0.3; a.hd = u; });
        pd.forEach((a, i) => { const u = i / pd.length * TAU + 0.7 + R() * 0.5; a.or = (O.orbit || 2.2) * U * (0.8 + 0.45 * R()); a.x = Math.cos(u) * a.or; a.y = Math.sin(u) * a.or; a.sg = pd.length > 2 && i % 3 === 2 ? -1 : 1; a.hd = u + a.sg * PI / 2; a.tm = 2 + R() * 8; a.st = 'orbit'; });
        const ad = df.filter(a => !a.kid); ad.forEach((a, i) => { a.slot = i; a.nslot = ad.length; });
      },
      wander() {
        const hd = A.filter(a => a.role !== 'pred'); S.homeR = U * (0.5 + 0.42 * Math.sqrt(hd.length));
        for (const a of hd) { const u = R() * TAU, d = Math.sqrt(R()) * S.homeR; a.x = Math.cos(u) * d; a.y = Math.sin(u) * d * 0.8; a.hd = R() * TAU; a.st = R() < (O.rest ?? 0.3) ? 'rest' : 'graze'; a.tm = 4 + R() * 30; }
        A.filter(a => a.role === 'pred').forEach((a, i) => { const u = 0.9 + R(); a.or = S.homeR + U * (0.8 + i * 0.5); a.x = Math.cos(u) * a.or; a.y = Math.sin(u) * a.or; a.sg = i % 2 ? -1 : 1; a.hd = u + PI / 2; a.st = 'prowl'; });
      },
      nest() {
        const ad = A.filter(a => a.role === 'herd' && !a.kid), sp = U * (O.spacing || 1);
        // nests on a jittered hexagonal grid, about one body length apart, filled from the middle outwards
        const pts = []; for (let j = -7; j <= 7; j++) for (let i = -7; i <= 7; i++) { const x = (i + (j & 1) * 0.5) * sp, y = j * sp * 0.866; pts.push([x, y, Math.hypot(x, y * 1.15) + hash(i, j, seed) * sp * 0.3]); }
        pts.sort((a, b) => a[2] - b[2]);
        ad.forEach((a, i) => { const p = pts[i], nx = p[0] + (R() - 0.5) * sp * 0.22, ny = p[1] + (R() - 0.5) * sp * 0.22, th = R() * TAU, r = U * 0.135;
          const N = { x: nx, y: ny, r, th, eggs: R() < 0.42, n: 4 + Math.floor(R() * 5), h: R() * 100, feed: 0 }; nests.push(N); a.nest = N;
          a.px = nx + Math.cos(th) * (r + U * 0.2); a.py = ny + Math.sin(th) * (r + U * 0.2); a.pf = th + PI / 2 + (R() < 0.5 ? PI : 0);
          const u = R(); a.x = a.px; a.y = a.py; a.hd = a.pf; a.st = u < 0.5 ? 'sit' : u < 0.72 ? 'stand' : 'out'; a.tm = 5 + R() * 40;
          if (a.st === 'out') { a.tm = 0; a.st = 'stand'; } });
        S.colonyR = Math.max(U * 1.2, ad.length ? pts[ad.length - 1][2] + sp * 0.6 : U); G.colony = S.colonyR;
        A.filter(a => a.kid).forEach(a => { a.dead = true; });      // the young of this scene are in the nests
        A = A.filter(a => !a.dead);
        A.filter(a => a.role === 'pred').forEach((a, i) => { const u = R() * TAU; a.or = S.colonyR + U * (0.5 + 0.4 * i); a.x = Math.cos(u) * a.or; a.y = Math.sin(u) * a.or; a.sg = i % 2 ? -1 : 1; a.hd = u + PI / 2; a.st = 'prowl'; });
      },
    };
    const extent = d => (Math.abs(Math.cos(d)) * vw + Math.abs(Math.sin(d)) * vh) / 2 + U * 1.3;

    // ---------------------------------------------------------------- steering
    let sX = 0, sY = 0, sLat = 0, sLon = 0, cX = 0, cY = 0, aX = 0, aY = 0, nN = 0;
    function social(a) {
      sX = sY = sLat = sLon = cX = cY = aX = aY = nN = 0;
      const c = Math.cos(a.hd), s = Math.sin(a.hd), R2 = (a.L * 2 + U * 1.5) ** 2;
      for (const b of A) {
        if (b === a) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy; if (d2 > R2) continue;
        const m = (a.L + b.L) * 0.5, A1 = m * 0.95 * SP, B1 = m * 0.36 * SP, dl = dx * c + dy * s, dw = -dx * s + dy * c, e = (dl / A1) ** 2 + (dw / B1) ** 2;
        if (e < 1) { const w = (1 - e) * 2.2 * (b.L > a.L * 1.5 ? 1.8 : 1), d = Math.sqrt(d2) + 1e-6; sX -= dx / d * w; sY -= dy / d * w;
          sLat -= (dw > 0 ? 1 : dw < 0 ? -1 : a.id % 2 ? 1 : -1) * w; sLon -= dl / A1 * w; }
        if (b.g === a.g && (b.role === 'pred') === (a.role === 'pred')) { const w = b.kid ? 0.4 : 1; cX += b.x * w; cY += b.y * w; aX += Math.cos(b.hd) * w; aY += Math.sin(b.hd) * w; nN += w; }
      }
      if (nN) { cX = (cX / nN - a.x) / U; cY = (cY / nN - a.y) / U; const d = Math.hypot(cX, cY); if (d > 1) { cX /= d; cY /= d; } aX /= nN; aY /= nN; }
    }
    function centroids() {
      cen = []; preds = [];
      for (const a of A) { if (a.role === 'pred') { preds.push(a); continue; } const c = cen[a.g] || (cen[a.g] = { x: 0, y: 0, n: 0 }); if (!a.kid || !c.n) { c.x += a.x; c.y += a.y; c.n++; } }
      for (const c of cen) if (c && c.n) { c.x /= c.n; c.y /= c.n; }
      if (cen[0]) { S.cx = cen[0].x; S.cy = cen[0].y; }
    }
    const nearestPred = a => { let best = null, bd = 1e9; for (const p of preds) { const d = Math.hypot(p.x - a.x, p.y - a.y) - (p === lunger ? U : 0); if (d < bd) { bd = d; best = p; } } return best; };
    // walk to a spot; when close, shuffle onto it and turn to face `face`
    function goTo(a, x, y, face, speed) {
      const dx = x - a.x, dy = y - a.y, d = Math.hypot(dx, dy);
      if (d > a.L * 0.35 && (a.v > 0.1 || d > a.L * 0.6)) { a.fx = dx / d + sLat * -Math.sin(a.hd) * 0.8; a.fy = dy / d + sLat * Math.cos(a.hd) * 0.8; a.vt = speed * Math.min(1, 0.35 + d / a.L); return false; }
      const k = Math.min(1.2, a.vW * 0.5 / (d + 0.01)); a.sx = dx * k + sX * a.vW * 0.3; a.sy = dy * k + sY * a.vW * 0.3; a.vt = 0; a.face = face; return d < a.L * 0.2;
    }
    function prowl(a, cx, cy) {
      // an oval beat (wider than tall, like the frame), worked out on a circle and squashed
      const q = 0.62, dx = a.x - cx, dy = (a.y - cy) / q, d = Math.hypot(dx, dy) + 1e-6, rr = a.or * (1 + 0.15 * Math.sin(T * 0.07 + a.h1 * 9));
      const k = clamp((rr - d) / U, -1, 1);
      a.fx = -dy / d * a.sg + dx / d * k * 1.5; a.fy = (dx / d * a.sg + dy / d * k * 1.5) * q; a.vt = a.vW * 0.85 * en; a.wH = -0.25; a.wL = wrapA(Math.atan2(cy - a.y, cx - a.x) - a.hd);
    }
    const think = {
      trek(a) {
        const th = S.dir + 0.3 * Math.sin(T * 0.02 + seed), dx = Math.cos(th), dy = Math.sin(th), C = cen[a.g] || a;
        const lag = ((C.x - a.x) * dx + (C.y - a.y) * dy) / U;
        let kx = cX, ky = cY; if (a.kid) { kx = (C.x - a.x) / U * 2; ky = (C.y - a.y) / U * 2; }
        const wc = (a.kid ? 0.9 : 0.4) * FL, rx = -Math.sin(a.hd), ry = Math.cos(a.hd);
        const wv = Math.sin(T * (0.11 + a.h1 * 0.12) + a.h2 * 40) * (O.wobble ?? 0.12);
        a.fx = dx + kx * wc + aX * 0.5 * FL + rx * (sLat * 0.9 + wv); a.fy = dy + ky * wc + aY * 0.5 * FL + ry * (sLat * 0.9 + wv);
        a.vt = a.pace * lerp(0.65, 1.5, (en - 0.4) / 1.2) * (1 + clamp(lag * 0.6 * FL, -0.3, 0.6)) * clamp(1 + sLon * 0.5, 0.5, 1.3);
        a.wH = a.kid ? 0.2 : 0;
      },
      flock(a) {
        const gx = Math.cos(T * 0.17 * en + seed) * S.view * 0.52, gy = Math.sin(T * 0.26 * en + seed * 2) * S.view * 0.27;
        let dx = gx - a.x, dy = gy - a.y; const d = Math.hypot(dx, dy) + 1e-6; dx /= d; dy /= d;
        const rx = -Math.sin(a.hd), ry = Math.cos(a.hd), far = clamp(d / (S.view * 0.3));
        a.fx = dx * (0.5 + far) + aX * 1.5 * FL + cX * 0.5 * FL + rx * sLat * 1.2 + sX * 0.7 + (a.h1 - 0.5) * 0.3;
        a.fy = dy * (0.5 + far) + aY * 1.5 * FL + cY * 0.5 * FL + ry * sLat * 1.2 + sY * 0.7 + (a.h2 - 0.5) * 0.3;
        a.vt = lerp(a.vW * 1.5, a.vTop * 0.72, far) * (0.55 + 0.45 * en) * clamp(1 + sLon * 0.4, 0.6, 1.25); a.wH = 0.2;
      },
      lanes(a) {
        const c = Math.cos(a.dir), s = Math.sin(a.dir), along = a.x * c + a.y * s, ext = extent(a.dir);
        if (along > ext) { const j = O.loose ? (R() - 0.5) * U * 0.6 : 0; a.x -= c * 2 * ext + s * j; a.y -= s * 2 * ext - c * j; }
        const err = (-a.x * s + a.y * c - a.lane) / U, kl = O.loose ? 0.35 : 1.6, fl = O.loose ? FL : 0;
        const rx = -Math.sin(a.hd), ry = Math.cos(a.hd);
        a.fx = c + s * err * kl + cX * 0.35 * fl + aX * 0.4 * fl + rx * sLat * (O.loose ? 0.9 : 0.2);
        a.fy = s - c * err * kl + cY * 0.35 * fl + aY * 0.4 * fl + ry * sLat * (O.loose ? 0.9 : 0.2);
        a.vt = a.pace * lerp(0.65, 1.5, (en - 0.4) / 1.2) * (1 - 0.5 * a.wade) * (O.loose ? clamp(1 + sLon * 0.5, 0.45, 1.3) : 1) * (a.kid ? 1.04 : 1);
        a.wH = a.wade > 0.2 ? 0.5 : 0;
      },
      siege(a) {
        const Pc = { x: 0, y: 0 };
        if (a.role === 'pred') {
          const dx = a.x - Pc.x, dy = a.y - Pc.y, d = Math.hypot(dx, dy) + 1e-6, rx = -Math.sin(a.hd), ry = Math.cos(a.hd);
          a.wL = wrapA(Math.atan2(-dy, -dx) - a.hd); a.wJ = 0; a.wH = -0.2; a.tm -= a.dt * en;
          if (a.st === 'orbit') {
            const k = clamp((a.or - d) / U, -1, 1);
            a.fx = -dy / d * a.sg + dx / d * k * 1.6 + rx * sLat; a.fy = dx / d * a.sg + dy / d * k * 1.6 + ry * sLat;
            a.vt = lerp(a.vW, a.vTop, O.trot ?? 0.1) * (0.6 + 0.4 * en) * clamp(1 + sLon * 0.5, 0.5, 1.3);
            if (a.tm <= 0 && !lunger && d < a.or * 1.3) { a.st = 'lunge'; a.tm = 5; lunger = a; }
            else if (a.tm <= 0) a.tm = 1 + R() * 3;
            if (R() < a.dt * 0.03) a.sg = -a.sg;
          } else if (a.st === 'lunge') {
            let tg = null, bd = 1e9; for (const b of A) if (b.role !== 'pred' && !b.kid) { const q = Math.hypot(b.x - a.x, b.y - a.y); if (q < bd) { bd = q; tg = b; } }
            if (!tg) { a.st = 'orbit'; lunger = null; return; }
            a.fx = (tg.x - a.x) / bd; a.fy = (tg.y - a.y) / bd; a.vt = lerp(a.vW, a.vTop, O.rush ?? 0.5); a.wJ = 0.8; a.wH = -0.4;
            if (bd < (a.L + tg.L) * (O.reach ?? 0.62) || a.tm <= 0) { a.st = 'back'; a.tm = 2.2; }
          } else {
            a.fx = dx / d + rx * a.sg * 0.5; a.fy = dy / d + ry * a.sg * 0.5; a.vt = lerp(a.vW, a.vTop, (O.rush ?? 0.5) * 0.8);
            if (d > a.or * 0.92 || a.tm <= 0) { a.st = 'orbit'; a.tm = (3 + R() * 6) * (O.patience || 1); if (lunger === a) lunger = null; }
          }
          return;
        }
        const p = nearestPred(a);
        if (!p) { think.wander(a); return; }
        const dp = Math.hypot(p.x - a.x, p.y - a.y), fa = Math.atan2(p.y - a.y, p.x - a.x);
        let tx, ty;
        if (preds.length <= 2) {         // a line across the hunter's path, calves behind it
          let mx = 0, my = 0; for (const q of preds) { mx += q.x; my += q.y; } const ma = Math.atan2(my, mx), c = Math.cos(ma), s = Math.sin(ma);
          if (a.kid) { tx = -c * U * 0.55 - s * (a.slot - 0.5) * U * 0.3; ty = -s * U * 0.55 + c * (a.slot - 0.5) * U * 0.3; }
          else { const k = (a.slot - (a.nslot - 1) / 2) * U * (O.gap ?? 0.42), bow = -Math.abs(a.slot - (a.nslot - 1) / 2) * U * 0.1; tx = c * (U * 0.32 + bow) - s * k; ty = s * (U * 0.32 + bow) + c * k; }
        } else if (a.kid) { tx = 0; ty = 0; }
        else { const u = a.slot / a.nslot * TAU + 0.4, rr = a.nslot > 1 ? U * (0.3 + 0.14 * a.nslot) : 0; tx = Math.cos(u) * rr; ty = Math.sin(u) * rr; }
        const hot = p.st === 'lunge' && dp < U * 1.6 + p.L;
        goTo(a, tx, ty, fa, a.vW * 1.3);
        if (hot && !a.kid) { a.sx += Math.cos(fa) * a.vW * 0.9; a.sy += Math.sin(fa) * a.vW * 0.9; }
        a.wH = a.kid ? 0.3 : -0.25; a.wJ = hot ? 0.9 : 0; a.wL = wrapA(fa - a.hd) * 0.6;
      },
      wander(a) {
        if (a.role === 'pred') { prowl(a, 0, 0); return; }
        const p = nearestPred(a), dp = p ? Math.hypot(p.x - a.x, p.y - a.y) : 1e9;
        a.tm -= a.dt * en; a.wC = 0; a.wH = 0; a.wL = 0;
        if (dp < U * 1.1 + (p ? p.L * 0.5 : 0)) { a.st = 'flee'; a.tm = 3; }
        if (a.st === 'flee') { a.fx = (a.x - p.x) / dp + sX; a.fy = (a.y - p.y) / dp + sY; a.vt = lerp(a.vW, a.vTop, 0.5); a.wH = 0.4; if (a.tm <= 0) { a.st = 'graze'; a.tm = 4; } return; }
        if (dp < U * 2.4) { a.vt = 0; a.face = Math.atan2(p.y - a.y, p.x - a.x); a.wH = 1; a.sx = sX * a.vW * 0.3; a.sy = sY * a.vW * 0.3; if (a.st === 'rest') a.wC = 0.4; return; }
        if (a.st === 'walk') { if (goTo(a, a.gx, a.gy, a.hd, a.vW * 0.8 * en) || a.tm < -30) { a.st = 'graze'; a.tm = 5 + R() * 20; } return; }
        a.vt = 0; a.sx = sX * a.vW * 0.4; a.sy = sY * a.vW * 0.4;
        if (a.st === 'rest') { a.wC = 1; a.wH = -0.3; } else a.wH = Math.sin(T * 0.2 + a.h1 * 30) > 0.75 ? 0.8 : -1;
        if (a.tm <= 0) { const u = R(); if (u < (O.rest ?? 0.3)) { a.st = 'rest'; a.tm = 20 + R() * 60; } else if (u < 0.75) { a.st = 'walk'; const w = R() * TAU, d = Math.sqrt(R()) * S.homeR; a.gx = Math.cos(w) * d; a.gy = Math.sin(w) * d * 0.8; a.tm = 0; } else { a.st = 'graze'; a.tm = 5 + R() * 20; } }
      },
      nest(a) {
        if (a.role === 'pred') { prowl(a, 0, 0); return; }
        const N = a.nest, p = nearestPred(a), dp = p ? Math.hypot(p.x - a.x, p.y - a.y) : 1e9;
        a.tm -= a.dt * en; a.wC = 0; a.wH = 0; a.wL = 0; a.wJ = 0;
        const toNest = wrapA(Math.atan2(N.y - a.y, N.x - a.x) - a.hd);
        if (a.st === 'out' || a.st === 'home') {
          // keep off other animals' nests on the way
          let ox = 0, oy = 0; for (const M of nests) { const dx = a.x - M.x, dy = a.y - M.y, d = Math.hypot(dx, dy), rr = M.r + a.L * 0.28; if (M !== N || a.st === 'out') if (d < rr) { ox += dx / d * (1 - d / rr) * 3; oy += dy / d * (1 - d / rr) * 3; } }
          if (a.st === 'out') { if (goTo(a, a.gx, a.gy, a.hd, a.vW * en) ) { a.st = 'graze'; a.tm = 6 + R() * 14; } }
          else if (goTo(a, a.px, a.py, a.pf, a.vW * en)) { a.st = 'feed'; a.tm = 7 + R() * 5; }
          a.fx += ox; a.fy += oy; return;
        }
        if (a.st === 'graze') { a.vt = 0; a.wH = -1; a.sx = sX * a.vW * 0.4; a.sy = sY * a.vW * 0.4; if (a.tm <= 0) a.st = 'home'; return; }
        goTo(a, a.px, a.py, a.pf, a.vW);
        if (dp < U * 1.5) { a.wH = 0.8; a.wL = wrapA(Math.atan2(p.y - a.y, p.x - a.x) - a.hd); a.wJ = dp < U ? 0.8 : 0; return; }
        if (a.st === 'sit') { a.wC = 1; a.wH = -0.2; a.wL = toNest * 0.7; }
        else if (a.st === 'feed') { a.wH = -0.8; a.wL = toNest; a.wJ = 0.4; N.feed = 1; }
        else { a.wH = 0.5 + 0.4 * Math.sin(T * 0.3 + a.h1 * 20); a.wL = Math.sin(T * 0.21 + a.h2 * 20) * 0.6; }
        if (a.tm <= 0) {
          const u = R();
          if (a.st !== 'sit' && u < 0.3) { a.st = 'out'; const w = Math.atan2(N.y, N.x) + (R() - 0.5) * 1.6, d = S.colonyR + U * (0.5 + R() * 1.2); a.gx = Math.cos(w) * d; a.gy = Math.sin(w) * d; }
          else { a.st = a.st === 'sit' ? 'stand' : u < 0.8 ? 'sit' : 'stand'; a.tm = a.st === 'sit' ? 25 + R() * 60 : 6 + R() * 14; }
        }
      },
    };

    function step(dt) {
      T += dt; centroids();
      for (const N of nests) N.feed = Math.max(0, N.feed - dt * 0.5);
      for (const a of A) {
        a.dt = dt; a.fx = a.fy = 0; a.vt = 0; a.face = null; a.sx = a.sy = 0; a.wJ = 0; a.wC = 0; a.wL = 0;
        social(a); think[mode](a);
        // trees are walked around
        for (const t of trees) { const dx = a.x - t.x, dy = a.y - t.y, rr = t.r + a.L * 0.3, d2 = dx * dx + dy * dy; if (d2 < rr * rr) { const d = Math.sqrt(d2) + 1e-6, w = (1 - d / rr) * 4; a.fx += dx / d * w; a.fy += dy / d * w; } }
        // something dropped from the sky: run from it, or come and eat it
        a.scare = Math.max(0, a.scare - dt);
        for (const ev of events) {
          const dx = a.x - ev.x, dy = a.y - ev.y, d = Math.hypot(dx, dy) + 1e-6, age = T - ev.t;
          if (ev.type === 'scare') { if (age < 0.6 && d < U * 3.2 + a.L) a.scare = 3.5 + a.h1 * 2; if (a.scare > 0 && age < 8) { const k = a.scare > 1.5 ? 1 : a.scare / 1.5; a.fx = lerp(a.fx, dx / d * 3 + sX, k); a.fy = lerp(a.fy, dy / d * 3 + sY, k); a.vt = Math.max(a.vt, lerp(a.vW, a.vTop, 0.75) * k); a.face = null; a.wC = 0; a.wH = 0.5; if (a.st === 'rest' || a.st === 'sit') a.st = a.nest ? 'stand' : 'graze'; } }
          else if (a.role !== 'pred' && age < ev.life && d < U * 5 && a.st !== 'flee') {
            const rr = a.L * 0.42 + U * 0.08; a.wC = 0;
            if (d > rr * 1.4) { a.fx = -dx / d + (-Math.sin(a.hd)) * sLat * 1.2; a.fy = -dy / d + Math.cos(a.hd) * sLat * 1.2; a.vt = a.vW * 1.25 * Math.min(1, 0.3 + (d - rr) / a.L); a.face = null; a.wH = 0; }
            else { a.vt = 0; a.face = Math.atan2(-dy, -dx); a.wH = -1; a.wJ = 0.3 + 0.3 * Math.sin(T * 5 + a.id); a.sx = sX * a.vW * 0.5; a.sy = sY * a.vW * 0.5; }
          }
        }
      }
      for (const a of A) {
        const G1 = gait(a.sp, a.run, a.scale);
        let om = 0;
        const f2 = a.fx * a.fx + a.fy * a.fy;
        if (a.vt > 0.02 && f2 > 1e-6) { const dh = wrapA(Math.atan2(a.fy, a.fx) - a.hd); om = clamp(dh * 2.5, -a.tr, a.tr) * (0.7 + 0.3 * en); if (Math.abs(dh) > 1.2) a.vt *= 0.55; }
        else if (a.face != null) om = clamp(wrapA(a.face - a.hd) * 2, -a.tr * 0.8, a.tr * 0.8);
        a.om += (om - a.om) * Math.min(1, dt * 4); a.hd = wrapA(a.hd + a.om * dt);
        a.v += (a.vt - a.v) * Math.min(1, dt * (a.vt > a.v ? 1.2 : 2.2));
        const c = Math.cos(a.hd), s = Math.sin(a.hd), sl = Math.hypot(a.sx, a.sy);
        a.x += (c * a.v + a.sx) * dt; a.y += (s * a.v + a.sy) * dt;
        const run = clamp((a.v - a.vW) / (a.vTop - a.vW + 1e-6)); a.run += (run - a.run) * Math.min(1, dt * 3);
        if (a.crouch < 0.5) a.phase += (a.v + sl + (a.v < 0.1 ? Math.abs(a.om) * a.L * 0.3 : 0)) * dt / G1.stride;
        const e = Math.min(1, dt * 2.5);
        a.headTo += (a.wH - a.headTo) * e; a.crouch += (a.wC - a.crouch) * Math.min(1, dt * 1.2); a.jaw += (a.wJ - a.jaw) * Math.min(1, dt * 6);
        a.bn += (clamp(-a.om / a.tr * 0.22 - clamp(a.wL, -1.3, 1.3) * 0.5, -0.6, 0.6) - a.bn) * e; a.bt += (-a.om / a.tr * 0.3 - a.bt) * e;
        if (G.kind === 'river' || G.kind === 'mud') { ground(G, a.x + c * a.L * 0.1, a.y + s * a.L * 0.1); a.wade += (gWat - a.wade) * Math.min(1, dt * 3); }
        // footfalls: a leg touches down each time its cycle rolls over, half a step ahead of its joint
        const quad = a.legs.length === 4, half = G1.stride * G1.duty / 2;
        for (let i = 0; i < a.legs.length; i++) {
          const l = a.legs[i], off = quad && l.front ? (i === 0 ? lerp(0.25, 0, a.run) : lerp(0.75, 0.5, a.run)) : l.off, cy = Math.floor(a.phase + off);
          if (cy === a.cyc[i]) continue; a.cyc[i] = cy;
          const bx = l.jx + (l.front ? 0 : a.H * 0.04) + half, wx = a.x + c * bx + s * l.z, wy = a.y + s * bx - c * l.z, P = a.sp.P;
          let wet = 0; if (G.kind === 'river' || G.kind === 'mud') { ground(G, wx, wy); wet = gWat; }
          if (wet > 0.03) { const j = rings.i = (rings.i + 1) % NR; rings.x[j] = wx; rings.y[j] = wy; rings.r[j] = l.r * 2 + a.L * 0.03; rings.t[j] = T; }
          if (wet < 0.1 && a.v + sl > a.vW * 0.2) { const j = pr.i = (pr.i + 1) % NP, round = P.toes === 'pad' || P.foot < 0.1;
            pr.x[j] = wx; pr.y[j] = wy; pr.a[j] = a.hd; pr.t[j] = T; pr.k[j] = round ? 0 : P.toes === 'hoof' ? 2 : 1;
            pr.s[j] = round ? l.r * (l.front && P.toes === 'pad' ? 0.95 : 1.4) : Math.max(P.foot * a.H * 1.25, l.r * 2.2); }
          if (live && O.dusty && wet < 0.02 && (a.run > 0.12 || a.mass > 3000) && R() < 0.7) { const j = dust.i = (dust.i + 1) % ND; dust.x[j] = wx; dust.y[j] = wy; dust.r[j] = l.r * 3 + a.L * 0.05 * (0.5 + a.run); dust.t[j] = T; }
          if (live && frameSig && a.mass > 1500) frameSig.step = 1;
        }
      }
      if (events.length && T - events[0].t > (events[0].life || 10)) events.shift();
    }
    function follow(k) {
      const th = S.dir, tx = (S.cx ?? 0) - Math.cos(th) * vh * 0.16, ty = (S.cy ?? 0) - Math.sin(th) * vh * 0.08;
      cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
    }

    // ---------------------------------------------------------------- trees (pure function of the place, so the sim can avoid them)
    function treesNear(f) {
      trees.length = 0;
      const dens = (O.trees || 0) * (0.4 + f.p.detail);
      if (dens <= 0 || slab) return;
      const C = Math.max(13, S.view / 6), W = flora(f.era), clear = O.clear ? O.clear * U : 0;
      const x0 = Math.floor((cam.x - vw / 2 - 16) / C), x1 = Math.floor((cam.x + vw / 2 + 16) / C), y0 = Math.floor((cam.y - vh / 2 - 16) / C), y1 = Math.floor((cam.y + vh / 2 + 16) / C);
      if ((x1 - x0) * (y1 - y0) > 600) return;
      for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
        const key = i + ',' + j; let t = treeCache.get(key);
        if (t === undefined) {
          t = null; const q = hash(i + seed * 13, j, 3);
          if (q < dens) { const x = (i + 0.15 + 0.7 * hash(i, j + seed, 5)) * C, y = (j + 0.15 + 0.7 * hash(i + seed, j, 7)) * C; ground(G, x, y);
            if (gVeg > 0.35 && gWat <= 0 && Math.hypot(x, y) > clear && Math.abs(-x * Math.sin(S.dir) + y * Math.cos(S.dir)) > (O.corridor || 0) * U) { const kind = pick(W, TREE, O.flora || {}, hash(i, j, 11 + seed)); if (kind) { const s = 0.75 + 0.5 * hash(i, j, 13); t = { x, y, r: TREE[kind][0] * s, h: TREE[kind][1] * s, kind, v: (hash(i, j, 17) * 3) | 0 }; } } }
          if (treeCache.size > 4000) treeCache.clear();
          treeCache.set(key, t);
        }
        if (t) trees.push(t);
      }
    }

    // ---------------------------------------------------------------- ground tiles
    const TP = 104;
    function buildTile(tw, tx, ty, f) {
      const c = document.createElement('canvas'); c.width = c.height = TP; const g = c.getContext('2d'), im = g.createImageData(TP, TP), d = im.data;
      for (let y = 0, o = 0; y < TP; y++) for (let x = 0; x < TP; x++, o += 4) { ground(G, (tx + (x + 0.5) / TP) * tw, (ty + (y + 0.5) / TP) * tw); d[o] = gR; d[o + 1] = gG; d[o + 2] = gB; d[o + 3] = 255; }
      g.putImageData(im, 0, 0);
      // low plants in this tile
      const P = [], C = S.view / 17, W = flora(f.era), bias = O.flora || {}, dens = O.plants ?? 0.5;
      if (dens > 0 && !slab) for (let j = Math.floor(ty * tw / C); j * C < (ty + 1) * tw; j++) for (let i = Math.floor(tx * tw / C); i * C < (tx + 1) * tw; i++) {
        const q = hash(i, j, seed + 1); if (q > dens) continue;
        const x = (i + hash(i, j, 21) * 0.9) * C, y = (j + hash(i, j, 23) * 0.9) * C;
        if (x < tx * tw || x >= (tx + 1) * tw || y < ty * tw || y >= (ty + 1) * tw) continue;
        ground(G, x, y); if (gWat > 0.02 || hash(i, j, 29) > gVeg * 1.5) continue;
        const kind = pick(W, LOW, bias, hash(i, j, 31)); if (!kind) continue;
        P.push({ x, y, r: clamp(LOW[kind], C * 0.3, C * 0.62) * (0.7 + 0.6 * hash(i, j, 37)), kind, v: (hash(i, j, 41) * 3) | 0, q: q / dens });
      }
      return { c, P, stage: f.stage, used: 0 };
    }

    // ---------------------------------------------------------------- drawing
    const palOf = sp => { let p = pals.get(sp.id); if (!p) pals.set(sp.id, p = palette(sp, { light: 1 })); return p; };
    const ghostLook = { fill: (t, q) => q.k === 'mark' || q.k === 'eye' || q.k === 'scute' ? null : 'rgba(240,246,255,0.16)' };

    function render(f) {
      const { w, h, p } = f, E = f.era;
      frameSig = f.sig;
      // rebuild the simulation when time jumps or the cast changes; trim it when animals die out
      const pl = plan(f), sg = pl.map(c => c ? c.sp.id : '-').join();
      if (!S || sg !== sigSp || Math.abs(f.stage - lastStage) > 0.03 || f.epoch !== lastEpoch || Math.abs(p.herd - builtHerd) > 0.04) build(f);
      else pl.forEach((c, ci) => { if (!c) return; for (const kid of [false, true]) { const L = A.filter(a => a.ci === ci && a.kid === kid && !a.dead && a.role !== 'x'), want = kid ? c.young : c.n; if (mode === 'nest' && kid) continue; for (let i = want; i < L.length; i++) L[i].dead = true; } });
      lastStage = f.stage; lastEpoch = f.epoch;
      setEra(f); view(f);
      if (Math.abs(f.stage - tileStage) > 0.004) { tileStage = f.stage; treeCache.clear(); pals.clear(); }
      // clicks
      for (const c of f.pointer.clicks || []) { const x = cam.x + (c.x - 0.5) * vw, y = cam.y + (c.y - 0.5) * vh, type = O.click === 'food' ? 'food' : 'scare';
        events.push({ x, y, t: T, type, life: type === 'food' ? 26 : 10, h: R() }); if (events.length > 4) events.shift(); if (f.sig) f.sig.roar = 1; }
      // simulate
      live = true; treesNear(f);
      let dt = Math.min(f.dt, 0.4); const ns = Math.max(1, Math.ceil(dt / 0.07));
      if (dt > 0) for (let i = 0; i < ns; i++) step(dt / ns);
      for (const a of A) if (a.dead) a.alpha -= f.dt * 0.6;
      if (A.some(a => a.alpha <= 0)) A = A.filter(a => a.alpha > 0);
      if (mode === 'trek') follow(Math.min(1, f.dt * 0.9)); else { cam.x = 0; cam.y = 0; }
      const camx = cam.x - (f.pointer.dragX || 0) * vh, camy = cam.y - (f.pointer.dragY || 0) * vh;
      const X = x => (x - camx) * K + w / 2, Y = y => (y - camy) * K + h / 2;
      if (f.sig) { f.sig.count = Math.min(1, A.length / 40); let v = 0; for (const a of A) v = Math.max(v, a.run); f.sig.speed = v; }

      const L = clamp(p.light) * (1 - 0.45 * E.dark), dl = daylight(L);
      const sun = [0.72, 0.69], sLen = lerp(2.3, 0.4, smooth(0.12, 0.85, L)), shA = thermal || slab ? 0 : (0.3 + 0.12 * dl.dusk) * (0.45 + 0.55 * smooth(0, 0.3, L)) * (1 - 0.6 * E.dark);

      // ground
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.imageSmoothingEnabled = true;
      const tw = U * Math.pow(2, Math.round(Math.log2(vh / U / 1.9))), lv = Math.round(Math.log2(tw / U));
      const tx0 = Math.floor((camx - vw / 2) / tw), tx1 = Math.floor((camx + vw / 2) / tw), ty0 = Math.floor((camy - vh / 2) / tw), ty1 = Math.floor((camy + vh / 2) / tw);
      let stale = 1; const vis = [];
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        const key = lv + ',' + tx + ',' + ty; let t = tiles.get(key);
        if (!t || (stale > 0 && Math.abs(t.stage - f.stage) > 0.004 && stale--)) { t = buildTile(tw, tx, ty, f); tiles.set(key, t); }
        t.used = f.clock; vis.push(t);
        const x0 = Math.round(X(tx * tw)), y0 = Math.round(Y(ty * tw)), x1 = Math.round(X((tx + 1) * tw)), y1 = Math.round(Y((ty + 1) * tw));
        ctx.drawImage(t.c, 0.5, 0.5, TP - 1, TP - 1, x0, y0, x1 - x0, y1 - y0);
      }
      if (tiles.size > 90) for (const [k, t] of tiles) if (f.clock - t.used > 2 || t.used > f.clock) tiles.delete(k);
      // fine grain, anchored to the ground
      if (!thermal) { const gs = U * 0.9 * K / 128, pat = ctx.createPattern(grain(), 'repeat'), ox = (((-camx * K + w / 2) % (128 * gs)) + 128 * gs) % (128 * gs), oy = (((-camy * K + h / 2) % (128 * gs)) + 128 * gs) % (128 * gs);
        ctx.save(); ctx.translate(ox - 128 * gs, oy - 128 * gs); ctx.scale(gs, gs); ctx.fillStyle = pat; ctx.globalAlpha = O.grain ?? (slab ? 0.5 : 0.5); ctx.fillRect(0, 0, w / gs + 256, h / gs + 256); ctx.restore(); ctx.globalAlpha = 1; }
      if (slab) joints(f, X, Y, camx, camy);
      if (G.kind === 'river' && !thermal) glints(f, X, Y, camx, camy);

      // footprints
      const life = (O.printLife || 110) * lerp(0.12, 2.2, p.x1) * (thermal ? 0.25 : 1);
      if (p.x1 > 0.03) drawPrints(f, X, Y, life);
      // water rings
      ctx.lineWidth = Math.max(0.6, h * 0.0016);
      for (let i = 0; i < NR; i++) { const age = T - rings.t[i]; if (age > 2.4 || age < 0) continue; const u = age / 2.4; ctx.strokeStyle = thermal ? ironCss(0.3, (1 - u) * 0.5) : `rgba(255,255,255,${(1 - u) * 0.5})`; ctx.beginPath(); ctx.arc(X(rings.x[i]), Y(rings.y[i]), rings.r[i] * (0.6 + u * 2.2) * K, 0, TAU); ctx.stroke(); }

      // low plants
      const bk = Math.round(G.burnt * 4), sk = bk + (thermal ? 't' : 'd');
      if (sk !== spriteKey) { sprites = makeSprites(bk / 4, thermal); spriteKey = sk; }
      const pd = 0.25 + p.detail * 1.25;
      for (const t of vis) for (const q of t.P) { if (q.q > pd) continue; const r = q.r * K / 0.92, x = X(q.x), y = Y(q.y); if (x < -r || y < -r || x > w + r || y > h + r) continue;
        if (shA > 0 && r > 5) { ctx.globalAlpha = shA * 0.7; ctx.drawImage(sprites.shadow, x - r * 0.9 + sun[0] * r * 0.25 * sLen, y - r * 0.9 + sun[1] * r * 0.25 * sLen, r * 1.8, r * 1.8); ctx.globalAlpha = 1; }
        { const sp = sprites[q.kind]; ctx.drawImage(sp[q.v % sp.length], x - r, y - r, r * 2, r * 2); } }
      // nests and dropped things
      for (const N of nests) drawNest(f, N, X(N.x), Y(N.y), shA, sun);
      for (const ev of events) drawEvent(f, ev, X(ev.x), Y(ev.y));

      // animals: all the shadows first, then the bodies
      const list = [];
      for (const a of A) {
        const x = X(a.x), y = Y(a.y), m = a.L * K;
        if (x < -m || y < -m || x > w + m || y > h + m) continue;
        const q = pose(a.sp, { phase: a.phase, run: a.run, headTo: a.headTo, jaw: a.jaw, crouch: a.crouch, t: f.t + a.id * 1.7, scale: a.scale, young: a.young });
        let P = topParts(q); extras(q, P, m < 26);
        if (a.wade > 0.3) P = P.filter(o => o.k !== 'leg' && o.k !== 'foot');
        bend(P, q, a.bn, a.bt);
        list.push({ a, q, P, x, y });
      }
      list.sort((u, v) => u.a.L - v.a.L);
      const Tk = { x: 0, y: 0, k: K, dir: 1 };
      if (shA > 0) for (const o of list) {
        const a = o.a, c = Math.cos(a.hd), s = Math.sin(a.hd), d = a.H * (1 - 0.7 * a.crouch) * sLen * 0.55 * K * (1 - 0.6 * Math.min(1, a.wade * 2)), ox = sun[0] * d, oy = sun[1] * d;
        ctx.save(); ctx.translate(o.x + ox, o.y + oy); ctx.rotate(a.hd); ctx.fillStyle = `rgba(20,14,10,${shA * a.alpha})`; ctx.beginPath();
        for (const q of o.P) if (q.p && (q.k === 'body' || q.k === 'skull' || q.k === 'frill' || q.k === 'wing')) trace(ctx, q, Tk);
        ctx.fill(); ctx.restore();
      }
      for (const o of list) {
        const a = o.a, m = a.L * K;
        ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(a.hd);
        if (a.wade > 0.08 && !thermal) { ctx.strokeStyle = `rgba(255,255,255,${0.3 * Math.min(1, a.wade * 3)})`; ctx.lineWidth = Math.max(0.7, m * 0.012); ctx.beginPath(); ctx.ellipse(a.L * 0.08 * K, 0, m * (0.3 + 0.03 * Math.sin(f.t * 3 + a.id)), m * 0.11, 0, 0, TAU); ctx.stroke();
          if (a.v > 0.3) { ctx.beginPath(); ctx.moveTo(m * 0.3, 0); ctx.lineTo(-m * 0.25, -m * 0.2); ctx.moveTo(m * 0.3, 0); ctx.lineTo(-m * 0.25, m * 0.2); ctx.stroke(); } }
        ctx.globalAlpha = a.alpha;
        if (slab) { drawParts(ctx, o.P.filter(q => q.k !== 'mark' && q.k !== 'eye' && q.k !== 'scute'), Tk, ghostLook);
          ctx.strokeStyle = `rgba(255,255,255,${0.85 * a.alpha})`; ctx.lineWidth = Math.max(0.8, h * 0.003); ctx.beginPath(); for (const q of o.P) if (q.p && (q.k === 'body' || q.k === 'skull' || q.k === 'frill')) trace(ctx, q, Tk); ctx.stroke(); }
        else if (thermal) { ctx.fillStyle = ironCss(0.5, 0.25 * a.alpha); ctx.beginPath(); ctx.ellipse(a.L * 0.06 * K, 0, m * 0.34, m * 0.13, 0, 0, TAU); ctx.fill(); drawParts(ctx, o.P, Tk, { pal: thermPal, pupil: false, alpha: { mark: 0.8 } }); }
        else drawParts(ctx, o.P, Tk, { pal: palOf(a.sp), stroke: m > 14 ? palOf(a.sp).line : null, lw: clamp(m * 0.006, 0.5, 1.6), pupil: m > 60 });
        ctx.restore(); ctx.globalAlpha = 1;
      }

      // dust
      if (O.dusty && !thermal) { const wd = windDir(p.wind), img = puff(O.dust || '226,208,172', 64, 0.3);
        for (let i = 0; i < ND; i++) { const age = T - dust.t[i]; if (age > 3 || age < 0) continue; const u = age / 3, r = dust.r[i] * (1 + u * 3.2) * K; ctx.globalAlpha = (1 - u) * (1 - u) * 0.5;
          ctx.drawImage(img, X(dust.x[i] + wd[0] * age * U * 0.12) - r, Y(dust.y[i] + wd[1] * age * U * 0.12) - r, r * 2, r * 2); } ctx.globalAlpha = 1; }

      // tree crowns stand above everything
      for (const t of trees) { const r = t.r * K / 0.92, x = X(t.x), y = Y(t.y); if (x < -r * 3 || y < -r * 3 || x > w + r * 3 || y > h + r * 3) continue;
        if (shA > 0) { const d = Math.min(t.h * 0.3, t.r * 2.2) * sLen * K; ctx.globalAlpha = shA * 0.95; ctx.drawImage(sprites.shadow, x - r * 1.05 + sun[0] * d, y - r * 1.05 + sun[1] * d, r * 2.1, r * 2.1); ctx.globalAlpha = 1; }
        { const sp = sprites[t.kind]; ctx.drawImage(sp[t.v % sp.length], x - r, y - r, r * 2, r * 2); } }

      // light, the impact, ash
      if (!thermal) {
        const d = smooth(0, 0.42, L), r = lerp(92, 255, d), g = lerp(108, 255, d) * (1 - 0.1 * dl.dusk), b = lerp(158, 255, d) * (1 - 0.3 * dl.dusk), k = 1 - 0.18 * E.dark;
        if (r < 254 || dl.dusk > 0.02 || E.dark > 0.01) { ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = css(r * k, g * k * 0.96, b * k * 0.92); ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over'; }
      }
      if (E.meteor > 0) { const u = E.meteor / 1.25, gx = w * (0.1 + 0.8 * u), gy = h * (0.15 + 0.6 * u), gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, h * 0.9); gr.addColorStop(0, `rgba(255,236,190,${0.55 + 0.3 * u})`); gr.addColorStop(0.3, `rgba(255,170,80,${0.25 + 0.2 * u})`); gr.addColorStop(1, 'rgba(255,140,60,0)');
        ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over'; }
      if (E.flash > 0.01) { ctx.fillStyle = `rgba(255,244,214,${Math.min(0.92, E.flash)})`; ctx.fillRect(0, 0, w, h); }
      if (E.dark > 0.02) { ctx.fillStyle = `rgba(214,208,198,${E.dark * 0.55})`; const wd = windDir(p.wind); for (let i = 0; i < 90; i++) { const sp = 0.02 + 0.03 * hash(i, 9), x = ((hash(i, 3) + f.t * sp * (0.6 + wd[0])) % 1 + 1) % 1 * w, y = ((hash(i, 7) + f.t * sp * (0.8 + wd[1] * 0.5)) % 1 + 1) % 1 * h, s = h * (0.003 + 0.004 * hash(i, 1)); ctx.fillRect(x, y, s, s); } }

      hud(f, list, X, Y);
    }

    // footprints are stamped from a small sprite sheet (round pad, three clawed toes, three blunt toes): thousands of
    // tiny paths would be far slower than thousands of tiny images
    let stamps = null;
    function makeStamps() {
      const c = document.createElement('canvas'); c.width = 144; c.height = 48; const g = c.getContext('2d');
      const dark = thermal ? ironCss(0.45) : slab ? 'rgb(52,48,44)' : 'rgb(40,29,20)', rim = thermal ? 'rgba(0,0,0,0)' : 'rgba(255,250,236,0.5)';
      g.lineJoin = g.lineCap = 'round';
      for (let k = 0; k < 3; k++) {
        g.setTransform(24, 0, 0, 24, 24 + k * 48, 24);
        const shape = () => { g.beginPath(); if (k === 0) { g.arc(0, 0, 0.62, 0, TAU); return; }
          g.translate(-0.3, 0); const wd = k === 2 ? 0.17 : 0.085;
          for (let t = -1; t <= 1; t++) { const an = t * (k === 2 ? 0.5 : 0.56), l = (t ? 0.8 : 1) * 0.92, cs = Math.cos(an), sn = Math.sin(an);
            g.moveTo(-cs * 0.2 + sn * wd, -sn * 0.2 - cs * wd); g.lineTo(cs * l * 0.72 + sn * wd, sn * l * 0.72 - cs * wd); g.lineTo(cs * l, sn * l); g.lineTo(cs * l * 0.72 - sn * wd, sn * l * 0.72 + cs * wd); g.lineTo(-cs * 0.2 - sn * wd, -sn * 0.2 + cs * wd); g.closePath(); }
          g.translate(0.3, 0); };
        shape(); g.strokeStyle = rim; g.lineWidth = 0.26; g.stroke(); g.fillStyle = dark; g.fill();
      }
      return c;
    }
    function drawPrints(f, X, Y, life) {
      const { w, h } = f; stamps = stamps || makeStamps();
      const base = Math.min(1, thermal ? 0.55 : slab ? 0.6 : O.printAlpha || 0.3), m = ctx.getTransform();
      for (let i = 0; i < NP; i++) {
        const age = T - pr.t[i]; if (age >= life || age < 0) continue;
        const x = X(pr.x[i]), y = Y(pr.y[i]); if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
        const s = Math.max(1.2, pr.s[i] * K) * (pr.k[i] ? 1 : 1.6), a = pr.a[i], c = Math.cos(a) * s, sn = Math.sin(a) * s, u = age / life;
        ctx.globalAlpha = base * (1 - u * u);
        ctx.setTransform(m.a * c + m.c * sn, m.b * c + m.d * sn, -m.a * sn + m.c * c, -m.b * sn + m.d * c, m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f);
        ctx.drawImage(stamps, pr.k[i] * 48, 0, 48, 48, -1, -1, 2, 2);
      }
      ctx.setTransform(m); ctx.globalAlpha = 1;
    }
    function drawNest(f, N, x, y, shA, sun) {
      const r = N.r * K, { w, h } = f; if (x < -r * 3 || y < -r * 3 || x > w + r * 3 || y > h + r * 3) return;
      const C = (a, b, c, al = 1) => thermal ? ironCss(0.12 + 0.1 * (a + b + c) / 765, al) : css(a, b, c, al);
      if (shA > 0) { ctx.fillStyle = `rgba(30,20,10,${shA * 0.6})`; ctx.beginPath(); ctx.arc(x + sun[0] * r * 0.22, y + sun[1] * r * 0.22, r * 1.42, 0, TAU); ctx.fill(); }
      ctx.fillStyle = C(204, 178, 128); ctx.beginPath(); for (let i = 0; i < 14; i++) { const a = i / 14 * TAU, rr = r * (1.34 + 0.12 * hash(i, N.h)); ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.fill();
      ctx.fillStyle = C(112, 92, 62); ctx.beginPath(); ctx.arc(x + sun[0] * r * 0.06, y + sun[1] * r * 0.06, r * 0.98, 0, TAU); ctx.fill();
      ctx.fillStyle = C(96, 104, 58, 0.8); ctx.beginPath(); ctx.arc(x, y, r * 0.86, 0, TAU); ctx.fill();
      if (r < 3) return;
      const sp = A.length ? A[0].sp : null, t = f.t;
      if (N.eggs) { ctx.fillStyle = thermal ? ironCss(0.5) : 'rgb(236,228,204)'; ctx.beginPath(); for (let i = 0; i < 13; i++) { const a = i * 2.4 + N.h, d = r * 0.2 * Math.sqrt(i + 0.3), ex = x + Math.cos(a) * d, ey = y + Math.sin(a) * d; ctx.moveTo(ex + r * 0.13, ey); ctx.ellipse(ex, ey, r * 0.13, r * 0.095, a, 0, TAU); } ctx.fill(); return; }
      const body = thermal ? ironCss(0.9) : sp ? palOf(sp).belly : '#ccb', dark = thermal ? ironCss(0.75) : sp ? palOf(sp).body : '#775';
      for (let i = 0; i < N.n; i++) {
        const a0 = i / N.n * TAU + N.h, d = r * (0.45 + 0.12 * Math.sin(t * 0.7 + i * 2 + N.h)), hx = x + Math.cos(a0 + 0.2 * Math.sin(t * 0.9 + i)) * d, hy = y + Math.sin(a0 + 0.2 * Math.sin(t * 0.9 + i)) * d;
        const gape = N.feed > 0.1 ? N.th : a0 + PI * 0.6 + Math.sin(t * 1.3 + i * 3) * 0.8, c = Math.cos(gape), s = Math.sin(gape), l = r * 0.34;
        ctx.strokeStyle = dark; ctx.lineCap = 'round'; ctx.lineWidth = l * 0.3; ctx.beginPath(); ctx.moveTo(hx - c * l * 0.4, hy - s * l * 0.4); ctx.lineTo(hx - c * l * 1.5, hy - s * l * 1.5 + Math.sin(t * 3 + i) * l * 0.15); ctx.stroke();
        ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(hx, hy, l * 0.62, l * 0.34, gape, 0, TAU); ctx.fill();
        ctx.fillStyle = body; ctx.beginPath(); ctx.arc(hx + c * l * 0.72, hy + s * l * 0.72, l * 0.3, 0, TAU); ctx.fill();
      }
    }
    function drawEvent(f, ev, x, y) {
      const age = T - ev.t, u = U * K;
      if (ev.type === 'scare') {
        for (let i = 0; i < 2; i++) { const a = (age - i * 0.35) / 1.6; if (a < 0 || a > 1) continue; ctx.strokeStyle = thermal ? ironCss(0.7, (1 - a) * 0.8) : `rgba(255,248,230,${(1 - a) * 0.7})`; ctx.lineWidth = Math.max(1, u * 0.03 * (1 - a)); ctx.beginPath(); ctx.arc(x, y, u * (0.1 + a * 1.6), 0, TAU); ctx.stroke(); }
        const al = clamp((10 - age) / 2), r = u * 0.09;
        if (thermal) { const g = ctx.createRadialGradient(x, y, 0, x, y, r * 5); g.addColorStop(0, ironCss(1, al * Math.exp(-age * 0.4))); g.addColorStop(0.3, ironCss(0.75, al * 0.8 * Math.exp(-age * 0.4))); g.addColorStop(1, ironCss(0.5, 0)); ctx.fillStyle = g; ctx.fillRect(x - r * 5, y - r * 5, r * 10, r * 10); return; }
        ctx.globalAlpha = al; ctx.fillStyle = 'rgba(20,14,10,.35)'; ctx.beginPath(); ctx.arc(x + r * 0.35, y + r * 0.35, r * 1.05, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgb(118,112,104)'; ctx.beginPath(); for (let i = 0; i < 7; i++) { const a = i / 7 * TAU + ev.h * 6, rr = r * (0.8 + 0.3 * hash(i, ev.h * 99)); ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.fill();
        ctx.fillStyle = 'rgb(170,166,156)'; ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 0.22, r * 0.45, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      } else if (sprites) {
        const al = clamp((ev.life - age) / 4) * clamp(age * 3 + 0.2), r = u * 0.16 * (1 - 0.5 * clamp(age / ev.life));
        ctx.globalAlpha = al; for (let i = 0; i < 4; i++) { const a = i * 1.7 + ev.h * 6; ctx.drawImage(sprites.fern[i % 3], x + Math.cos(a) * r * 0.5 - r, y + Math.sin(a) * r * 0.5 - r, r * 2, r * 2); } ctx.globalAlpha = 1;
      }
    }
    // joints and cracks in the rock slab
    function joints(f, X, Y, camx, camy) {
      const { w, h } = f, D = Math.hypot(vw, vh) / 2 + U;
      for (const [ang, gap, sd] of [[0.42, 1.25, 1], [1.83, 2.1, 2]]) {
        const c = Math.cos(ang), s = Math.sin(ang), sp = gap * U, o0 = -camx * s + camy * c, a0 = camx * c + camy * s;
        for (let i = Math.floor((o0 - D) / sp); i <= (o0 + D) / sp; i++) {
          if (hash(i, sd, seed) < 0.3) continue;
          const off = (i + hash(i, sd + 5, seed) * 0.6) * sp, wob = U * 0.07;
          for (let pass = 0; pass < 2; pass++) { ctx.strokeStyle = pass ? 'rgba(52,48,44,.55)' : 'rgba(255,252,240,.28)'; ctx.lineWidth = Math.max(0.7, h * (pass ? 0.0022 : 0.0034)); ctx.beginPath();
            const a1 = Math.floor((a0 - D) / (U * 0.5)); for (let j = a1; j * U * 0.5 < a0 + D; j++) { const al = j * U * 0.5, o = off + (hash(j, i, sd) - 0.5) * wob, x = X(c * al - s * o) + (pass ? 0 : -1), y = Y(s * al + c * o) + (pass ? 0 : -1); j === a1 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke(); }
        }
      }
    }
    // sun glints drifting down the river
    function glints(f, X, Y, camx, camy) {
      const n = 110, per = vh * 1.4; ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = Math.max(0.7, f.h * 0.0018); ctx.beginPath();
      for (let i = 0; i < n; i++) { const wx = camx + (hash(i, 61) - 0.5) * vw * 0.75, wy = camy + ((((hash(i, 67) * per + f.t * U * (0.12 + 0.1 * hash(i, 71)) - camy) % per) + per) % per) - per / 2;
        ground(G, wx, wy); if (gWat < 0.25) continue; const l = U * (0.05 + 0.1 * hash(i, 73)) * K, x = X(wx), y = Y(wy); ctx.moveTo(x, y); ctx.lineTo(x + l * 0.15, y + l); }
      ctx.stroke();
    }
    function hud(f, list, X, Y) {
      const { w, h, p } = f, sv = p.x4; if (sv < 0.08) return;
      const fs = Math.max(8, h * 0.03), col = thermal ? 'rgba(120,255,160,.92)' : slab ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.92)', sh = 'rgba(0,0,0,.55)';
      ctx.font = `600 ${fs}px ${FONT}`; ctx.textBaseline = 'alphabetic'; ctx.lineCap = 'butt';
      let nice = 1; for (const v of [1, 2, 5, 10, 20, 50, 100, 200, 500]) if (v <= vw * 0.2) nice = v;
      if (sv > 0.62 && (slab || thermal)) {     // survey grid
        ctx.strokeStyle = thermal ? 'rgba(120,255,160,.14)' : 'rgba(255,255,255,.16)'; ctx.lineWidth = Math.max(0.5, h * 0.0012); ctx.beginPath();
        const cx = cam.x - (f.pointer.dragX || 0) * vh, cy = cam.y - (f.pointer.dragY || 0) * vh;
        for (let x = Math.ceil((cx - vw / 2) / nice) * nice; x < cx + vw / 2; x += nice) { ctx.moveTo(X(x), 0); ctx.lineTo(X(x), h); }
        for (let y = Math.ceil((cy - vh / 2) / nice) * nice; y < cy + vh / 2; y += nice) { ctx.moveTo(0, Y(y)); ctx.lineTo(w, Y(y)); }
        ctx.stroke();
      }
      const bx = h * 0.045, by = h - h * 0.05, bl = nice * K;
      for (const [c, o] of [[sh, 1], [col, 0]]) { ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = Math.max(1, h * 0.004); ctx.beginPath(); ctx.moveTo(bx + o, by - h * 0.012 + o); ctx.lineTo(bx + o, by + o); ctx.lineTo(bx + bl + o, by + o); ctx.lineTo(bx + bl + o, by - h * 0.012 + o); ctx.stroke(); ctx.fillText(nice + ' m', bx + o, by - h * 0.022 + o); }
      if (thermal) {
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, h * 0.003); const m = h * 0.05, l = h * 0.06; ctx.beginPath();
        for (const [x, y, sx, sy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) { if (sy < 0 && sx > 0) continue; ctx.moveTo(x + sx * l, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * l); }
        ctx.moveTo(w / 2 - l * 0.6, h / 2); ctx.lineTo(w / 2 - l * 0.2, h / 2); ctx.moveTo(w / 2 + l * 0.2, h / 2); ctx.lineTo(w / 2 + l * 0.6, h / 2); ctx.moveTo(w / 2, h / 2 - l * 0.6); ctx.lineTo(w / 2, h / 2 - l * 0.2); ctx.moveTo(w / 2, h / 2 + l * 0.2); ctx.lineTo(w / 2, h / 2 + l * 0.6); ctx.stroke();
        ctx.fillStyle = col; ctx.fillText('IR  WHITE-HOT', m + l * 0.3, m + fs * 1.2); ctx.textAlign = 'right'; ctx.fillText(`ALT ${Math.round(vh * 1.1)} m`, w - m - l * 0.3, m + fs * 1.2); ctx.textAlign = 'left';
      }
      if (sv > 0.5) {       // name tags: one animal of each species
        const seen = new Map();
        for (const o of list) { if (o.a.kid || o.a.dead) continue; const d = Math.hypot(o.x - w * 0.5, o.y - h * 0.45), b = seen.get(o.a.sp.id); if (!b || d < b.d) seen.set(o.a.sp.id, { o, d }); }
        for (const { o } of seen.values()) { const sp = o.a.sp, tx = o.x + h * 0.05, ty = o.y - Math.max(h * 0.07, o.a.L * K * 0.22), txt = `${sp.name} · ${sp.len} m`;
          for (const [c, k] of [[sh, 1], [col, 0]]) { ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = Math.max(1, h * 0.0025); ctx.beginPath(); ctx.moveTo(o.x + k, o.y + k); ctx.lineTo(tx + k, ty + k); ctx.lineTo(tx + ctx.measureText(txt).width + k, ty + k); ctx.stroke(); ctx.fillText(txt, tx + k, ty - fs * 0.35 + k); } }
      }
    }
    return { render, dispose() { tiles.clear(); treeCache.clear(); } };
  }
};

const Sc = (id, name, desc, tags, opts, params) => ({ id: 'topdown-' + id, name, desc, tags: ['from above', '2d', ...tags], opts, params });
export const scenes = [
  Sc('trackways', 'Sauropod Trackways', 'A Diplodocus herd crosses a mudflat with its young in the middle, printing a trackway as it goes.', ['sauropod', 'jurassic', 'herd', 'family', 'tracks'],
    { cast: [{ sp: 'diplodocus', n: 6, young: 4 }], mode: 'trek', ground: 'mud', view: 2.5, dir: 0.16, plants: 0.35, flora: { horsetail: 4, fern: 0.6, flowers: 0, bush: 0.3 }, printLife: 150, printAlpha: 0.4, grain: 0.22, warm: 80, click: 'food', seed: 4 },
    { stage: 0.42, light: 0.62, x1: 0.7 }),
  Sc('murmuration', 'Gallimimus Murmuration', 'A flock of ostrich mimics wheels across a dry lake bed like starlings, trailing dust.', ['theropod', 'cretaceous', 'herd', 'flock'],
    { cast: [{ sp: 'gallimimus', n: 34 }], mode: 'flock', ground: 'playa', view: 7.5, space: 2.3, dust: '255,251,240', plants: 0.1, flora: { bush: 2, fern: 0.2, flowers: 0 }, dusty: 1, printLife: 30, printAlpha: 0.2, warm: 40, seed: 7 },
    { stage: 0.83, light: 0.9, activity: 0.6, x1: 0.5, x2: 0.6 }),
  Sc('pack', 'Raptors Around a Protoceratops', 'Velociraptors circle a Protoceratops on the Gobi dunes at dusk. It keeps its beak towards them.', ['theropod', 'ceratopsian', 'cretaceous', 'hunt', 'pack', 'desert'],
    { cast: [{ sp: 'protoceratops', n: 1, fixed: 1 }, { sp: 'velociraptor', n: 5, role: 'pred', g: 1 }], mode: 'siege', ground: 'dunes', view: 4.6, orbit: 1.9, trot: 0.16, rush: 0.5, reach: 0.7, plants: 0.035, flora: { bush: 2, cycad: 0.4, fern: 0.1, horsetail: 0, flowers: 0 }, dusty: 1, dust: '232,206,160', printLife: 70, warm: 50, seed: 3 },
    { stage: 0.815, light: 0.3, activity: 0.6, x1: 0.6 }),
  Sc('ford', 'Duck-bills at the Ford', 'Parasaurolophus and Corythosaurus wade a river in a long column, slowing where the water deepens.', ['ornithopod', 'cretaceous', 'herd', 'family', 'water'],
    { cast: [{ sp: 'parasaurolophus', n: 14, young: 5 }, { sp: 'corythosaurus', n: 7, young: 2 }], mode: 'lanes', loose: 0.9, ground: 'river', view: 3.9, dir: 0.06, corridor: 1.1, plants: 0.6, trees: 0.4, flora: { horsetail: 2 }, printLife: 80, printAlpha: 0.3, warm: 70, seed: 6 },
    { stage: 0.80, light: 0.85 }),
  Sc('colony', 'Maiasaura Nesting Colony', 'Egg Mountain from the air: nests about one body length apart, a parent by each, hatchlings inside.', ['ornithopod', 'cretaceous', 'nest', 'family', 'herd'],
    { cast: [{ sp: 'maiasaura', n: 19 }, { sp: 'stenonychosaurus', n: 2, role: 'pred', fixed: 1, g: 1 }], mode: 'nest', ground: 'nest', view: 4.2, spacing: 1.02, plants: 0.6, trees: 0.35, clear: 4, printLife: 60, printAlpha: 0.2, warm: 30, click: 'food', seed: 9 },
    { stage: 0.798, light: 0.75, x1: 0.45 }),
  Sc('standoff', 'Tyrannosaurus Tests the Line', 'A T. rex circles a Triceratops herd. They wheel to keep their horns towards it, calves behind.', ['theropod', 'ceratopsian', 'cretaceous', 'hunt', 'herd', 'family'],
    { cast: [{ sp: 'triceratops', n: 4, young: 2 }, { sp: 'tyrannosaurus', n: 1, role: 'pred', fixed: 1, g: 1 }], mode: 'siege', ground: 'prairie', view: 4.7, orbit: 2.2, trot: 0.02, rush: 0.3, reach: 0.95, patience: 2.2, gap: 0.6, plants: 0.5, trees: 0.4, clear: 4.4, printLife: 140, printAlpha: 0.22, warm: 90, seed: 12 },
    { stage: 0.855, light: 0.38, x1: 0.65 }),
  Sc('slab', 'Fossil Trackway', 'A grey limestone slab. Ghost sauropods walk side by side, as real trackways show, and their prints stay. A hunter follows.', ['sauropod', 'theropod', 'jurassic', 'tracks', 'fossil', 'herd'],
    { cast: [{ sp: 'apatosaurus', n: 4, young: 1, at: 0.1 }, { sp: 'allosaurus', n: 1, role: 'herd', g: 1, fixed: 1, turn: 0.2, lane: 0.3, at: -0.75 }], mode: 'lanes', style: 'slab', ground: 'stone', view: 2.4, dir: -0.3, gap: 0.3, plants: 0, printLife: 520, warm: 150, seed: 5 },
    { stage: 0.44, light: 0.9, x1: 0.7, x4: 0.8 }),
  Sc('thermal', 'Night Thermal Camera', 'A Stegosaurus herd asleep at night, seen in infrared, while an Allosaurus prowls the edge.', ['stegosaur', 'theropod', 'jurassic', 'night', 'herd', 'thermal'],
    { cast: [{ sp: 'stegosaurus', n: 8, young: 3 }, { sp: 'allosaurus', n: 1, role: 'pred', fixed: 1, g: 1 }], mode: 'wander', style: 'thermal', ground: 'prairie', view: 4.6, rest: 0.55, plants: 0.6, trees: 0.4, clear: 2.5, printLife: 60, warm: 40, seed: 15 },
    { stage: 0.43, light: 0.08, x1: 0.6, x4: 0.8 }),
  Sc('redbeds', 'Triassic Red Beds', 'A Coelophysis pack trots over a drying red mudflat on Pangaea, leaving three-toed tracks.', ['theropod', 'triassic', 'pack', 'tracks'],
    { cast: [{ sp: 'coelophysis', n: 13 }], mode: 'trek', ground: 'mud', tint: [1.12, 0.8, 0.68], view: 4.8, dir: -0.2, wobble: 0.45, space: 1.5, plants: 0.14, flora: { horsetail: 2, cycad: 1, bush: 0.3 }, printLife: 90, printAlpha: 0.36, warm: 60, seed: 2 },
    { stage: 0.09, light: 0.7, activity: 0.62, x1: 0.7, x2: 0.3 }),
  Sc('deeptime', 'One Plain, 180 Million Years', 'The same drone, the same plain, the whole age of dinosaurs: the herd below is recast as the eras pass.', ['time travel', 'herd', 'impact', 'ornithopod'],
    { cast: [{ sp: 'edmontosaurus', n: 9, young: 3 }, { sp: 'ankylosaurus', n: 2, g: 1 }], mode: 'trek', ground: 'prairie', view: 4, dir: 0.1, plants: 0.5, trees: 0.3, printLife: 90, warm: 50, click: 'food', seed: 21 },
    { stage: 0.03, grow: 0.5, light: 0.8 }),
];
