// Sketch & Notebook: the animals as drawings by hand. The core tool is a wobbly line: every outline is stroked a few
// times, each pass slightly offset and overshooting, with seeded jitter that re-seeds a few times a second so the
// line "boils" like hand-drawn animation; shapes are shaded with hatching clipped to their polygons (denser on far
// limbs and undersides). Styles: a pencil field notebook, an ink-and-wash journal, a blueprint, a chalkboard lesson,
// a ballpoint doodle, charcoal, stipple, a flip-book and a red-chalk anatomical study.
// Everything written on the page comes from the species data (name, meaning, length, age, fact); nothing is invented.
import { clamp, lerp, smooth, hash, buffer, puff } from '../util.js';
import { createWorld } from '../world.js';
import { mapParts, mapPt, palette } from '../draw.js';
import { pose, parts, bones, topParts, gait } from '../rig.js';
import { species, standIn } from '../species.js';
import { plantParts } from '../flora.js';

const TAU = Math.PI * 2;
const HAND = '"Bradley Hand","Segoe Print","Chalkboard SE","Comic Sans MS",cursive';
const BIRO = '"Noteworthy","Marker Felt","Bradley Hand","Comic Sans MS",cursive';
const CHALKF = '"Chalkboard SE","Chalkboard","Comic Sans MS",cursive';
const TECH = '"Menlo","Consolas","DejaVu Sans Mono",monospace';
const SERIF = '"Baskerville","Palatino","Palatino Linotype","Georgia",serif';

const STYLES = {
  notebook: { world: 1, paper: '#f2ecd9', far: '#e9e2cb', ink: '#34343b', soft: '#6c6c76', accent: '#9a3b2b', rule: 'rgba(96,140,180,.3)', font: HAND, bold: 1, lw: 1.25, passes: 2, hatch: 1, gap: 4.6 },
  wash: { world: 1, paper: '#efe5cb', far: '#e5dabb', ink: '#463021', soft: '#7a5d44', accent: '#8c3a24', font: HAND, bold: 1, lw: 1.15, passes: 2, hatch: 0.55, gap: 6, wash: 1, stains: 1 },
  biro: { world: 1, paper: '#fbfaf2', far: '#f0f1f0', ink: '#1c3a9c', soft: '#4a63b5', accent: '#c7372c', rule: 'rgba(80,150,215,.42)', font: BIRO, lw: 0.95, passes: 3, hatch: 1, gap: 4.2, cross: 1, margin: 1, wob: 1.3 },
  charcoal: { world: 1, paper: '#d6cfbe', ink: '#131110', soft: '#3a3632', accent: '#131110', font: HAND, bold: 1, lw: 2.5, passes: 2, hatch: 1, gap: 5.5, charcoal: 1, dash: [9, 1.2, 4, 0.8, 13, 1.6], wob: 1.5 },
  blueprint: { paper: '#1c4c94', far: '#1a4587', ink: '#eef5ff', soft: '#a9c6ee', accent: '#ffe9a0', font: TECH, lw: 1.1, passes: 1, hatch: 0.6, gap: 5, farOnly: 1, wob: 0.3 },
  chalk: { paper: '#22362d', far: '#1e3028', ink: '#f2efe4', soft: '#c3c9ba', accent: '#f6d56b', font: CHALKF, lw: 2.1, passes: 2, hatch: 0.7, gap: 6, dash: [7, 1, 3, 0.7, 11, 1.3], wob: 0.9 },
  stipple: { paper: '#fbf8ed', ink: '#161616', soft: '#4c4c4c', accent: '#161616', font: SERIF, lw: 1, passes: 1, wob: 0.3 },
  flip: { paper: '#f8f3e4', far: '#eee8d6', ink: '#33333b', soft: '#777783', accent: '#b3402e', font: HAND, bold: 1, lw: 1.35, passes: 2, hatch: 0.8, gap: 5, wob: 1.5, fps: 8 },
  anatomy: { paper: '#d9c197', far: '#cfb689', ink: '#8a3a20', soft: '#9f5a3e', accent: '#5e2a17', font: SERIF, italic: 1, lw: 1.15, passes: 2, hatch: 1, gap: 4.2, stains: 1 },
};

export default {
  id: 'sketch',
  name: 'Sketch & Notebook',
  kind: '2d',
  sky: true,
  params: [
    { id: 'x1', label: 'Wobble', value: 0.45, tip: 'How much the hand-drawn lines wander and boil' },
    { id: 'x2', label: 'Hatching', value: 0.5, tip: 'How densely the shading is hatched or stippled' },
    { id: 'x3', label: 'Notes', value: 0.8, tip: 'How much is written on the page: labels, arrows, studies in the margin' },
    { id: 'x4', label: 'Line weight', value: 0.45, tip: 'Thickness of the pencil, pen or chalk' },
  ],
  create(ctx, opts) {
    const S = STYLES[opts.style] || STYLES.notebook;
    const st = { S, opts, W: S.world ? createWorld(opts) : null, pan: 0, leadId: 0, seen: null, buf: null };
    return { render(f) { comboBg = f.combo && !S.charcoal ? mixc(S.paper, S.paper, 0, 0.85) : null; (RENDER[opts.style] || renderWorld)(f, st); } };
  },
};

// ---------------------------------------------------------------- small helpers
const ih = (a, b = 0) => { let n = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0; n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967296; };
// value noise on an integer hash (cheaper than util's noise2, called for every vertex of every stroke)
function vn(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = ih(ix, iy), b = ih(ix + 1, iy), c = ih(ix, iy + 1), d = ih(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a + (a - b - c + d) * ux) * uy;
}
const rgb = c => { const p = parseInt(c.slice(1), 16); return [p >> 16, p >> 8 & 255, p & 255]; };
const mixc = (a, b, t, al = 1) => { const A = typeof a === 'string' ? rgb(a) : a, B = typeof b === 'string' ? rgb(b) : b; return `rgba(${lerp(A[0], B[0], t) | 0},${lerp(A[1], B[1], t) | 0},${lerp(A[2], B[2], t) | 0},${al})`; };
const cssRGB = s => { const m = s.match(/[\d.]+/g); return s[0] === '#' ? rgb(s) : [+m[0], +m[1], +m[2]]; };
const CIRC = Array.from({ length: 12 }, (_, i) => [Math.cos(i / 12 * TAU), Math.sin(i / 12 * TAU)]);
const ptsOf = m => m.c ? CIRC.map(c => [m.c[0] + c[0] * m.c[2], m.c[1] + c[1] * m.c[2]]) : (m.p || m.l);
function bbox(m) {
  if (m.c) return [m.c[0] - m.c[2], m.c[1] - m.c[2], m.c[0] + m.c[2], m.c[1] + m.c[2]];
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of m.p || m.l) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return [x0, y0, x1, y1];
}
const bboxAll = M => { const b = [1e9, 1e9, -1e9, -1e9]; for (const m of M) { const c = bbox(m); b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[2]); b[3] = Math.max(b[3], c[3]); } return b; };
// add one pixel-space part to the current path, exactly (for fills and clips)
function tr(ctx, m) {
  if (m.c) { const r = Math.max(0.3, m.c[2]); ctx.moveTo(m.c[0] + r, m.c[1]); ctx.arc(m.c[0], m.c[1], r, 0, TAU); return; }
  const p = m.p || m.l, n = p.length;
  if (m.p && m.s && n > 3) {
    ctx.moveTo((p[n - 1][0] + p[0][0]) / 2, (p[n - 1][1] + p[0][1]) / 2);
    for (let i = 0; i < n; i++) { const a = p[i], b = p[(i + 1) % n]; ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
  } else { ctx.moveTo(p[0][0], p[0][1]); for (let i = 1; i < n; i++) ctx.lineTo(p[i][0], p[i][1]); if (m.p) ctx.closePath(); }
}
const chaikin = p => { const o = [], n = p.length; for (let i = 0; i < n; i++) { const a = p[i], b = p[(i + 1) % n]; o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); } return o; };
const ell = (cx, cy, rx, ry, n = 16) => Array.from({ length: n }, (_, i) => [cx + Math.cos(i / n * TAU) * rx, cy + Math.sin(i / n * TAU) * ry]);
const below = (ctx, pts, bottom) => { ctx.beginPath(); ctx.moveTo(pts[0][0], bottom); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.lineTo(pts[pts.length - 1][0], bottom); ctx.closePath(); };
const fmtLen = sp => `${sp.len} m`;
const fmtMass = sp => !sp.mass ? '' : sp.mass >= 1000 ? `${+(sp.mass / 1000).toFixed(1)} t` : `${sp.mass} kg`;
const fmtAge = sp => sp.ma[0] === sp.ma[1] ? `${sp.ma[0]}` : `${sp.ma[0]}–${sp.ma[1]}`;
const DIET = { herbivore: 'plant eater', carnivore: 'meat eater', omnivore: 'ate plants and meat', 'fish eater': 'fish eater' };
const dietOf = sp => DIET[sp.diet] || sp.diet || '';

// ---------------------------------------------------------------- the pen
function makePen(f, S, fps) {
  const { ctx, h, p } = f, u = h / 540;
  const boil = Math.floor(f.t * (fps || S.fps || 6));
  const amp = u * lerp(0.15, 4.6, p.x1) * (S.wob ?? 1), fq = 0.02 / u, bx = (boil % 61) * 5.37, by = (boil % 53) * 2.91;
  const lw = Math.max(0.7, u * S.lw * lerp(0.6, 1.7, p.x4));
  const X = [], Y = [], dash = S.dash ? S.dash.map(d => d * u * 1.2) : null;
  const pen = { u, boil, amp, lw, S };
  const disp = (pts, n, seed, k) => {
    const sx = (seed % 97) * 3.17 + bx, sy = (seed % 89) * 1.71 + by, a = amp * k * 2;
    for (let i = 0; i < n; i++) { const x = pts[i][0], y = pts[i][1]; X[i] = x + (vn(x * fq + sx, y * fq + sy) - 0.5) * a; Y[i] = y + (vn(x * fq + sy + 40, y * fq + sx + 9) - 0.5) * a; }
  };
  // add a wobbly, overshooting version of a polyline or polygon to the current path
  pen.path = (pts, closed, sm, seed = 1, k = 1) => {
    const n = pts.length; if (n < 2) return;
    disp(pts, n, seed, k);
    if (closed && n > 2) {
      if (sm && n > 3) {                       // a closed curve: start anywhere and run a little past the start
        const s0 = Math.floor(ih(seed, boil) * n), b0 = (s0 + 1) % n, d = amp * 0.5 + lw * 0.4;
        ctx.moveTo((X[s0] + X[b0]) / 2, (Y[s0] + Y[b0]) / 2);
        for (let j = 1; j <= n + 2; j++) { const i = (s0 + j) % n, i2 = (i + 1) % n, o = j > n ? d : 0; ctx.quadraticCurveTo(X[i] + o, Y[i] - o, (X[i] + X[i2]) / 2 + o, (Y[i] + Y[i2]) / 2 - o); }
      } else for (let i = 0; i < n; i++) {      // a polygon: each edge on its own, overshooting the corners
        const j = (i + 1) % n, dx = X[j] - X[i], dy = Y[j] - Y[i], L = Math.hypot(dx, dy) || 1, e = Math.min(L * 0.14, amp * 0.9 + lw) / L;
        ctx.moveTo(X[i] - dx * e, Y[i] - dy * e); ctx.lineTo(X[j] + dx * e, Y[j] + dy * e);
      }
    } else {
      ctx.moveTo(X[0], Y[0]);
      if (sm && n > 2) { for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(X[i], Y[i], (X[i] + X[i + 1]) / 2, (Y[i] + Y[i + 1]) / 2); ctx.lineTo(X[n - 1], Y[n - 1]); }
      else for (let i = 1; i < n; i++) ctx.lineTo(X[i], Y[i]);
    }
  };
  pen.stroke = (pts, o = {}) => {
    const n = o.passes ?? S.passes ?? 2, w = (o.w ?? 1) * lw, a = o.a ?? 1, seed = o.seed || 1;
    ctx.strokeStyle = o.col || S.ink; ctx.lineCap = ctx.lineJoin = 'round';
    if (dash && !o.solid) ctx.setLineDash(dash);
    for (let i = 0; i < n; i++) {
      ctx.beginPath(); pen.path(pts, o.closed, o.sm, seed + i * 57, (o.k ?? 1) * (1 + i * 0.8));
      ctx.globalAlpha = a * (i ? 0.5 : 1); ctx.lineWidth = Math.max(0.5, w * (i ? 0.7 : 1));
      if (dash) ctx.lineDashOffset = (seed % 13) * 3.1 + i * 5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1; if (dash) ctx.setLineDash([]);
  };
  pen.line = (pts, o = {}) => pen.stroke(pts, { sm: 1, ...o, closed: false });
  pen.part = (m, o = {}) => m.l ? pen.stroke(m.l, { ...o, closed: false, sm: m.l.length > 2 }) : pen.stroke(ptsOf(m), { ...o, closed: true, sm: m.c || m.s });
  // parallel hand hatching, clipped to whatever `clip` traces
  pen.hatch = (clip, bb, ang, gap, seed, o = {}) => {
    gap = Math.max(1.5, gap);
    const c = Math.cos(ang), s = Math.sin(ang), cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2, R = Math.hypot(bb[2] - bb[0], bb[3] - bb[1]) / 2 + gap;
    if (R / gap > 400) return;
    ctx.save(); ctx.beginPath(); clip(); ctx.clip();
    ctx.beginPath();
    for (let d = -R, i = 0; d <= R; d += gap, i++) {
      const r1 = ih(i, seed * 31 + boil), r2 = ih(i + 99, seed * 17 + boil), dd = d + (r1 - 0.5) * gap * 0.7, px = cx - s * dd, py = cy + c * dd, bend = (r2 - 0.5) * gap * 1.4, tw = (r1 - 0.5) * 0.08;
      ctx.moveTo(px - (c - s * tw) * R, py - (s + c * tw) * R); ctx.quadraticCurveTo(px - s * bend, py + c * bend, px + (c + s * tw) * R, py + (s - c * tw) * R);
    }
    ctx.strokeStyle = o.col || S.ink; ctx.lineWidth = Math.max(0.5, lw * (o.w ?? 0.7)); ctx.globalAlpha = o.a ?? 0.6; ctx.lineCap = 'round';
    if (dash) ctx.setLineDash(dash);
    ctx.stroke(); ctx.restore(); ctx.globalAlpha = 1;
  };
  // a curved arrow from a label to the thing it names
  pen.arrow = (x0, y0, x1, y1, o = {}) => {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, b = (o.bend ?? 0.14) * L * (ih(x0, y0) < 0.5 ? -1 : 1), mx = (x0 + x1) / 2 - dy / L * b, my = (y0 + y1) / 2 + dx / L * b;
    pen.stroke([[x0, y0], [mx, my], [x1, y1]], { sm: 1, passes: 1, a: o.a ?? 0.85, w: o.w ?? 0.8, col: o.col, seed: (x0 + y1) | 0 });
    const a = Math.atan2(y1 - my, x1 - mx), hl = (o.head ?? 7) * u;
    for (const s of [-0.45, 0.45]) pen.stroke([[x1, y1], [x1 - Math.cos(a + s) * hl, y1 - Math.sin(a + s) * hl]], { passes: 1, a: o.a ?? 0.85, w: o.w ?? 0.8, col: o.col, seed: 3, k: 0.3 });
  };
  // a dimension line with end ticks and a label in the middle
  pen.dim = (x0, x1, y, label, o = {}) => {
    const t = (o.tick ?? 6) * u, col = o.col || S.ink;
    pen.stroke([[x0, y], [x1, y]], { passes: 1, w: 0.8, col, seed: 5 });
    for (const x of [x0, x1]) { pen.stroke([[x, y - t], [x, y + t]], { passes: 1, w: 0.8, col, seed: 6, k: 0.3 }); const s = x === x0 ? 1 : -1; pen.stroke([[x + s * t * 1.4, y - t * 0.6], [x, y], [x + s * t * 1.4, y + t * 0.6]], { passes: 1, w: 0.8, col, seed: 7, k: 0.3 }); }
    if (o.ext) for (const x of [x0, x1]) pen.stroke([[x, y - o.ext], [x, y - t]], { passes: 1, w: 0.5, a: 0.6, col, seed: 8, k: 0.4 });
    if (label) write(ctx, label, (x0 + x1) / 2, y - t * 0.9, { px: o.px || 15 * u, font: o.font || S.font, col: o.tcol || col, align: 'center', bold: S.bold, italic: S.italic, bg: o.bg });
  };
  return pen;
}

// ---------------------------------------------------------------- writing
const wrapCache = new Map();
let comboBg = null;        // in a combo, writing that lands on the open sky gets a scrap of paper behind it
function wrap(ctx, str, maxW) {
  const key = ctx.font + '|' + Math.round(maxW) + '|' + str;
  let out = wrapCache.get(key); if (out) return out;
  out = []; let line = '';
  for (const word of String(str).split(' ')) { const t = line ? line + ' ' + word : word; if (line && ctx.measureText(t).width > maxW) { out.push(line); line = word; } else line = t; }
  if (line) out.push(line);
  if (wrapCache.size > 400) wrapCache.clear();
  wrapCache.set(key, out); return out;
}
// write text (handwriting tilts each line a hair); returns the y under the last line
function write(ctx, str, x, y, o) {
  const px = Math.max(5, o.px);
  ctx.font = `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${px}px ${o.font}`;
  ctx.textAlign = o.align || 'left'; ctx.textBaseline = 'alphabetic';
  const lines = o.maxW ? wrap(ctx, str, o.maxW) : [str], lh = px * (o.lh || 1.22);
  lines.slice(0, o.max || 99).forEach((ln, i) => {
    const yy = y + i * lh, rot = o.tilt === 0 ? 0 : (hash(ln.length, i, px | 0) - 0.5) * (o.tilt ?? 0.02);
    ctx.save(); ctx.translate(x, yy); if (rot) ctx.rotate(rot);
    const bgc = o.bg || comboBg;
    if (bgc) { const wd = ctx.measureText(ln).width, x0 = o.align === 'center' ? -wd / 2 : o.align === 'right' ? -wd : 0; ctx.fillStyle = bgc; ctx.fillRect(x0 - px * 0.2, -px * 0.85, wd + px * 0.4, px * 1.1); }
    ctx.globalAlpha = o.a ?? 1; ctx.fillStyle = o.col; ctx.fillText(ln, 0, 0);
    if (o.dust) { ctx.globalAlpha = 0.25; ctx.fillText(ln, px * 0.04, px * 0.03); }
    ctx.restore();
  });
  ctx.globalAlpha = 1;
  return y + Math.min(lines.length, o.max || 99) * lh;
}
const textW = (ctx, str, o) => { ctx.font = `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${Math.max(5, o.px)}px ${o.font}`; return ctx.measureText(str).width; };

// labels in a row above and a row below the drawing, each with an arrow to its joint. labels: [{ t, x, y, up }]
function callouts(f, pen, S, labels, yTop, yBot, x0, x1, o = {}) {
  const { ctx } = f, px = o.px || 16 * pen.u, T = { px, font: S.font, col: o.col || S.ink, align: 'center', bold: S.bold, italic: S.italic, dust: o.dust, bg: o.bg };
  for (const up of [true, false]) {
    const L = labels.filter(l => !!l.up === up).sort((a, b) => a.x - b.x); if (!L.length) continue;
    const y = up ? yTop : yBot, ws = L.map(l => textW(ctx, l.t, T)), gap = px * 0.9;
    const xs = L.map((l, i) => clamp(l.x + (l.dx || 0) * pen.u, x0 + ws[i] / 2, x1 - ws[i] / 2));
    for (let i = 1; i < L.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + (ws[i - 1] + ws[i]) / 2 + gap);
    for (let i = L.length - 1; i >= 0; i--) { xs[i] = Math.min(xs[i], i === L.length - 1 ? x1 - ws[i] / 2 : xs[i + 1] - (ws[i + 1] + ws[i]) / 2 - gap); }
    L.forEach((l, i) => {
      write(ctx, l.t, xs[i], y, T);
      const sy = up ? y + px * 0.35 : y - px * 0.95, dx = l.x - xs[i], dy = l.y - sy, d = Math.hypot(dx, dy) || 1, stop = Math.min(d * 0.3, 5 * pen.u);
      if (d > px) pen.arrow(xs[i], sy, l.x - dx / d * stop, l.y - dy / d * stop, { col: o.acol || S.ink, head: 6, a: 1, w: 0.9 });
    });
  }
}

// what to point at on this animal: its features (from the species data) and real joints from the pose, in metres
function anatomy(sp, q, o = {}) {
  const n = q.nodes, f = sp.f, hd = q.head, ca = Math.cos(hd.a), sa = Math.sin(hd.a), out = [];
  const top = (i, k = 1.15) => { const a = n[Math.max(0, i - 1)], b = n[Math.min(n.length - 1, i + 1)], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1; return [n[i].x - dy / L * n[i].r * k, n[i].y + dx / L * n[i].r * k]; };
  const H = (lx, ly) => [hd.x + lx * hd.len * ca - ly * hd.len * sa, hd.y + lx * hd.len * sa + ly * hd.len * ca];
  const mid = (q.iHip + q.iSh) >> 1, feat = [];
  if (f.plates) feat.push(['plates', top(mid, 2.2), 1]);
  if (f.sail) feat.push(['sail', top(mid, 2.4), 1]);
  if (f.frill) feat.push(['frill', H(-0.25, 0.75), 1]);
  if (f.horns) feat.push(['brow horns', H(0.75, 0.8), 1]); else if (f.noseHorn) feat.push(['nose horn', H(0.8, 0.6), 1]);
  if (f.crest) feat.push(['crest', H(0.2, 0.55), 1]);
  if (f.club) feat.push(['tail club', [n[0].x, n[0].y + n[0].r], 1]);
  if (f.spikes) feat.push(['tail spikes', top(1, 2.5), 1]);
  if (f.scutes) feat.push(['armour', top(mid, 1.05), 1]);
  if (f.sickle) { const g = q.legs.find(g => g.near && !g.front); if (g) feat.push(['sickle claw', g.tip, 0]); }
  if (f.wings || f.fuzz || f.tailFan) feat.push(['feathers', top(q.iSh - 1, 1.1), 1]);
  if (f.quills) feat.push(['bristles', top(Math.round(q.iHip * 0.55), 1.6), 1]);
  for (const [t, p, up] of feat.slice(0, o.feats ?? 2)) out.push({ t, p, up });
  const g = q.legs.find(g => g.near && !g.front);
  if (o.skull) out.push({ t: 'skull', p: H(0.45, 0.3), up: 1 });
  if (o.spine) out.push({ t: 'backbone', p: top(q.iHip + 1, 0.9), up: 1 });
  if (!o.noHip) out.push({ t: 'hip', p: [n[q.iHip].x, n[q.iHip].y], up: 1 });
  if (o.tail && !f.club && !f.spikes) out.push({ t: 'tail', p: top(Math.round(q.iHip * 0.4), 1), up: 1 });
  if (g) { out.push({ t: 'knee', p: g.pts[1], up: 0 }, { t: 'ankle', p: g.pts[2], up: 0 }); if (o.toes) out.push({ t: 'toes', p: g.tip, up: 0 }); }
  return out;
}
const toPx = (labels, T) => labels.map(l => { const p = mapPt(l.p, T); return { ...l, x: p[0], y: p[1] }; });

// ---------------------------------------------------------------- drawing an animal (or a plant) by hand
// the shaded strip along the underside of the body, from the spine nodes
function underside(q, T, k0, k1) {
  const n = q.nodes, a = [], b = [];
  for (let i = 0; i < n.length; i++) {
    const p = n[Math.max(0, i - 1)], c = n[Math.min(n.length - 1, i + 1)], dx = c.x - p.x, dy = c.y - p.y, L = Math.hypot(dx, dy) || 1, nx = dy / L, ny = -dx / L, r = n[i].b || n[i].r;
    a.push(mapPt([n[i].x + nx * r * k0, n[i].y + ny * r * k0], T)); b.push(mapPt([n[i].x + nx * r * k1, n[i].y + ny * r * k1], T));
  }
  return a.concat(b.reverse());
}
const ACC = new Set(['plate', 'sail', 'frill', 'crest', 'wing', 'tailfan', 'spike']);
// o: { a, seed, pal (for washes), q (pose, for the underside shading), light: fewer passes }
function drawAnimal(f, pen, S, src, T, o = {}) {
  const { ctx } = f, M = T ? mapParts(src, T) : src, u = pen.u, a = o.a ?? 1, sd = (o.seed || 1) * 13, q = o.q;
  const gap = S.gap * u * lerp(2.1, 0.55, f.p.x2), hat = S.hatch && f.p.x2 > 0.04 && !o.noHatch, passes = o.passes ?? S.passes;
  const fillOf = t => S.charcoal ? null : t === 'far' || t === 'accentFar' || t === 'boneFar' ? S.far : S.paper;
  const wash = (m, t, al) => { if (!o.pal || !o.pal[t]) return; ctx.beginPath(); tr(ctx, m); ctx.fillStyle = o.pal[t]; ctx.globalAlpha = al * a; ctx.fill(); ctx.globalAlpha = 1; };
  for (let i = 0; i < M.length; i++) {
    const m = M[i], t = m.t, k = m.k, seed = sd + i;
    if (m.l) { pen.stroke(m.l, { passes: 1, w: clamp(m.w / pen.lw * 0.6, 0.6, 2.2), a: a * (t === 'far' || t === 'boneFar' ? 0.6 : 0.9), seed, sm: m.l.length > 2, col: o.col }); continue; }
    if (k === 'belly') { if (S.wash) wash(m, t, 0.5); continue; }
    const bb = bbox(m), sz = Math.max(bb[2] - bb[0], bb[3] - bb[1]);
    if (sz < 1.1 * u) continue;
    if (k === 'mark' || k === 'scute' || k === 'fuzz') {
      if (S.wash) wash(m, t, 0.4);
      if (S.charcoal) continue;
      if (k === 'fuzz') { pen.part(m, { passes: 1, w: 0.6, a: a * 0.6, seed, col: o.col }); continue; }
      if (hat && sz > 3 * u && !S.farOnly) pen.hatch(() => tr(ctx, m), bb, 0.35, gap * 0.7, seed, { a: 0.55 * a, col: o.col });
      if (k === 'scute' || !hat || S.farOnly) pen.part(m, { passes: 1, w: 0.6, a: a * 0.55, seed, col: o.col });
      continue;
    }
    const far = t === 'far' || t === 'accentFar' || t === 'boneFar', fc = fillOf(t);
    if (fc) { ctx.beginPath(); tr(ctx, m); ctx.fillStyle = fc; ctx.fill(); }
    if (S.wash) wash(m, t, far ? 0.6 : 0.5);
    if (k === 'eye') { ctx.beginPath(); ctx.arc(m.c[0], m.c[1], Math.max(0.6, m.c[2] * 0.75), 0, TAU); ctx.fillStyle = o.col || S.ink; ctx.globalAlpha = a; ctx.fill(); ctx.globalAlpha = 1; if (m.c[2] > 2.5 * u) { ctx.beginPath(); ctx.arc(m.c[0] + m.c[2] * 0.25, m.c[1] - m.c[2] * 0.25, m.c[2] * 0.22, 0, TAU); ctx.fillStyle = S.charcoal ? '#f4efe2' : S.paper; ctx.fill(); } pen.part(m, { passes: 1, w: 0.7, a, seed, col: o.col }); continue; }
    if (k === 'mouth' || t === 'hole') { ctx.beginPath(); tr(ctx, m); ctx.fillStyle = o.col || S.ink; ctx.globalAlpha = 0.55 * a; ctx.fill(); ctx.globalAlpha = 1; continue; }
    if (S.charcoal && (k === 'tooth' || k === 'claw' || k === 'horn')) { ctx.beginPath(); tr(ctx, m); ctx.fillStyle = '#f1ecdf'; ctx.globalAlpha = 0.9 * a; ctx.fill(); ctx.globalAlpha = 1; }
    if (hat && sz > 5 * u) {
      const clip = () => tr(ctx, m);
      if (far) { pen.hatch(clip, bb, -0.95, gap * 0.72, seed, { a: 0.62 * a, col: o.col }); if (S.cross) pen.hatch(clip, bb, 0.6, gap * 0.9, seed + 5, { a: 0.45 * a, col: o.col }); }
      else if (S.farOnly) { /* drafting: only the far side is toned */ }
      else if (k === 'body' && q) {
        const st = underside(q, T, 0.42, 1.9), sb = bboxAll([{ p: st }]);
        ctx.save(); ctx.beginPath(); tr(ctx, m); ctx.clip();
        pen.hatch(() => tr(ctx, { p: st }), sb, -0.95, gap, seed, { a: 0.6 * a, col: o.col });
        if (S.cross || S.charcoal) pen.hatch(() => tr(ctx, { p: underside(q, T, 0.7, 1.9) }), sb, 0.5, gap * 1.1, seed + 3, { a: 0.5 * a, col: o.col });
        ctx.restore();
      }
      else if (k === 'leg' || k === 'arm' || k === 'jaw') pen.hatch(clip, [bb[0], bb[1], bb[0] + (bb[2] - bb[0]) * 0.55, bb[3]], -0.95, gap * 1.25, seed, { a: 0.42 * a, col: o.col });
      else if (ACC.has(k)) pen.hatch(clip, bb, 1.25, gap * 1.5, seed, { a: 0.4 * a, col: o.accentCol || o.col });
    }
    const small = sz < 9 * u;
    pen.part(m, { passes: small || far ? Math.min(passes, 1) : passes, w: (far ? 0.75 : k === 'body' || k === 'skull' || k === 'leg' ? 1.1 : 0.85) * (o.w ?? 1), a: a * (far ? 0.75 : 1), seed, col: ACC.has(k) && o.accentCol ? o.accentCol : o.col });
  }
}
// a scribbled shadow on the ground under an animal
function groundShadow(f, pen, S, T, q, o = {}) {
  const u = pen.u, len = q.L * T.k, cx = T.x + q.nodes[q.iSh].x * 0.5 * T.k * T.dir, e = ell(cx, T.y + len * 0.008, len * 0.33, Math.max(2 * u, len * 0.028));
  pen.hatch(() => tr(f.ctx, { p: e, s: 1 }), bboxAll([{ p: e }]), 0.06, S.gap * u * lerp(1.6, 0.6, f.p.x2) * 0.8, 77, { a: (o.a ?? 0.5), col: o.col });
}
function sketchPlant(f, pen, S, it, o = {}) {
  const { ctx } = f, hgt = it.k * 2;
  if (it.x < -it.k * 16 || it.x > f.w + it.k * 16) return;
  const a = (o.a ?? 1) * lerp(0.8, 0.28, clamp(it.fog / 0.75));
  if (hgt < 3 * pen.u) return;
  const M = mapParts(it.parts, { x: it.x, y: it.y, k: it.k, dir: 1 });
  ctx.beginPath(); for (const m of M) if (!m.l) tr(ctx, m);
  if (S.wash && o.pal) { ctx.fillStyle = S.paper; ctx.fill(); ctx.globalAlpha = 0.4 * a; for (const m of M) if (!m.l && o.pal[m.t]) { ctx.beginPath(); tr(ctx, m); ctx.fillStyle = o.pal[m.t]; ctx.fill(); } ctx.globalAlpha = 1; }
  else { ctx.fillStyle = S.paper; ctx.fill(); }
  ctx.beginPath();
  M.forEach((m, i) => { if (m.l) pen.path(m.l, false, m.l.length > 2, it.seed + i, 0.7); else pen.path(ptsOf(m), true, m.c || m.s, it.seed + i, 0.7); });
  ctx.strokeStyle = S.ink; ctx.lineWidth = Math.max(0.5, pen.lw * 0.7); ctx.globalAlpha = a; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke(); ctx.globalAlpha = 1;
  if (S.hatch && it.k > 9 * pen.u && f.p.x2 > 0.2) { const tk = M.find(m => m.t === 'trunk' && m.p); if (tk) pen.hatch(() => tr(ctx, tk), bbox(tk), -0.9, S.gap * pen.u * 0.9, it.seed, { a: 0.45 * a }); }
}

// ---------------------------------------------------------------- paper
function paper(f, S, top, extra) {
  const { ctx, w, h } = f;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.save();
  if (f.combo) { ctx.clearRect(0, 0, w, h); below(ctx, top, h + 4); ctx.clip(); }
  ctx.fillStyle = S.paper; ctx.fillRect(0, 0, w, h);
  if (S.stains) for (let i = 0; i < 7; i++) { ctx.globalAlpha = 0.05 + 0.05 * hash(i, 7); const r = h * (0.2 + 0.5 * hash(i, 3)); ctx.drawImage(puff('120,84,40', 128, 0.2), hash(i, 1) * w - r / 2, hash(i, 2) * h - r / 2, r * 1.6, r); }
  ctx.globalAlpha = 1;
  if (S.rule) { ctx.strokeStyle = S.rule; ctx.lineWidth = Math.max(0.6, h / 540); ctx.beginPath(); const n = S.margin ? 17 : 15; for (let i = 1; i <= n; i++) { const y = Math.round(h * (0.045 + i / (n + 0.6) * 0.96)) + 0.5; ctx.moveTo(0, y); ctx.lineTo(w, y); } ctx.stroke(); }
  if (S.margin) { ctx.strokeStyle = 'rgba(214,70,70,.55)'; ctx.lineWidth = Math.max(0.7, h / 400); ctx.beginPath(); ctx.moveTo(w * 0.135, 0); ctx.lineTo(w * 0.135, h); ctx.stroke();
    ctx.fillStyle = 'rgba(40,40,50,.5)'; for (const y of [0.16, 0.5, 0.84]) { ctx.beginPath(); ctx.arc(w * 0.03, h * y, h * 0.016, 0, TAU); ctx.fill(); } }
  extra && extra();
  ctx.restore();
}
const flatTop = f => [[-4, f.h * 0.56], [f.w + 4, f.h * 0.56]];
// night, the impact flash and the soot afterwards, as tints that only touch what is already drawn in a combo
function tints(f, light, flash = 0, dark = 0, k = 1) {
  const { ctx, w, h } = f, n = smooth(0.34, 0.04, light) * k;
  ctx.save(); ctx.globalCompositeOperation = f.combo ? 'source-atop' : 'source-over';
  if (n > 0.01) { if (!f.combo) ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = `rgba(${lerp(255, 96, n) | 0},${lerp(255, 108, n) | 0},${lerp(255, 150, n) | 0},1)`; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = f.combo ? 'source-atop' : 'source-over'; }
  else if (light < 0.45 && light > 0.15) { ctx.fillStyle = `rgba(255,170,90,${0.1 * (1 - Math.abs(light - 0.3) / 0.15)})`; ctx.fillRect(0, 0, w, h); }
  if (dark > 0.01) { ctx.fillStyle = `rgba(52,44,40,${dark * 0.45})`; ctx.fillRect(0, 0, w, h); }
  if (flash > 0.01) { ctx.fillStyle = `rgba(255,236,190,${Math.min(0.85, flash)})`; ctx.fillRect(0, 0, w, h); }
  ctx.restore();
}

// ---------------------------------------------------------------- the world, drawn by hand
function pickLead(st, v) { let a = v.actors.find(a => a.id === st.leadId && !a.leaving && a.role !== 'young'); if (!a) { a = v.lead; st.leadId = a ? a.id : 0; } return a; }
// run the world one frame, keeping the lead animal at a fixed place on the page (tx: fraction of the width)
function frameWorld(st, f, tx) {
  const W = st.W, p = f.p, ptr = f.pointer || { x: 0.5, y: 0.5, dragX: 0, dragY: 0, clicks: [] };
  const jump = !st.seen || Math.abs(f.stage - st.seen.stage) > 0.03 || f.epoch !== st.seen.epoch || Math.abs(p.herd - st.seen.herd) > 0.2;
  st.seen = { stage: f.stage, epoch: f.epoch, herd: p.herd };
  const shift = v => { const a = pickLead(st, v); if (!a) return 0; const x = v.sx(a.x, a.d), k = v.sx(a.x + 1, a.d) - x; return (tx * f.w - x) / (v.viewM * k); };
  if (jump) { st.pan = 0; st.leadId = 0; st.fresh = true; st.pan = shift(W.frame({ ...f, dt: 0, sig: null, pointer: { ...ptr, clicks: [] } })); }
  else if (W.view) st.pan += shift(W.view) * Math.min(1, (f.dt || 0) * 2.5);
  return W.frame({ ...f, pointer: { ...ptr, dragX: (ptr.dragX || 0) + st.pan } });
}
function plantPal(f, v) {
  const b = f.era.dark + (1 - f.era.dinos) * (1 - f.era.ferns) * 0.5, g = b > 0.5 ? '#6b6258' : '#5f7d3c';
  return { trunk: '#7a5f43', leaf: g, leaf2: b > 0.5 ? '#574f47' : '#7c9648', flower: '#c9577a', rock: '#8d887c', rock2: '#77736a', egg: '#e7dfc8', bone: '#e7dfc8' };
}
function renderWorld(f, st) {
  const { ctx, w, h } = f, S = st.S, v = frameWorld(st, f, S.margin ? 0.5 : 0.36), pen = makePen(f, S), u = pen.u, E = f.era;
  const lead = pickLead(st, v), leadIt = lead && v.items.find(it => it.actor === lead);
  if (S.charcoal) return charcoalWorld(f, st, v, pen, lead, leadIt);
  paper(f, S, v.layers[0].pts);
  const pp = S.wash ? plantPal(f, v) : null;
  ctx.save();
  if (S.margin) { ctx.beginPath(); ctx.rect(w * 0.142, 0, w, h); ctx.clip(); }
  // sun or moon, pterosaurs, the meteor
  if (!f.combo) {
    const s = { ...v.sun, x: w * (S.margin ? 0.66 : 0.725), y: Math.max(h * 0.1, v.sun.y) }, r = s.r * 1.2;
    if (S.wash) { ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.fillStyle = s.moon ? 'rgba(120,130,170,.25)' : 'rgba(226,150,60,.35)'; ctx.fill(); }
    pen.stroke(ell(s.x, s.y, r, r, 14), { closed: 1, sm: 1, a: 0.6, seed: 4 });
    if (s.moon) pen.hatch(() => { ctx.arc(s.x + r * 0.5, s.y - r * 0.2, r, 0, TAU); }, [s.x - r, s.y - r, s.x + r, s.y + r], -0.8, 3 * u, 4, { a: 0.45 });
    else for (let i = 0; i < 10; i++) { const a = i / 10 * TAU + 0.2, r0 = r * 1.35, r1 = r * (1.8 + 0.5 * ih(i, pen.boil)); pen.stroke([[s.x + Math.cos(a) * r0, s.y + Math.sin(a) * r0], [s.x + Math.cos(a) * r1, s.y + Math.sin(a) * r1]], { passes: 1, a: 0.5, w: 0.8, seed: i }); }
  }
  for (const it of v.flyers) drawAnimal(f, pen, S, it.parts, it.T, { a: 0.7, seed: 50, passes: 1, noHatch: it.k * it.sp.span < 30 * u, pal: S.wash ? palette(it.sp, { light: 1 }) : null });
  if (v.meteor) { const m = v.meteor, dx = -Math.cos(m.ang), dy = -Math.sin(m.ang);
    for (let i = -2; i <= 2; i++) pen.stroke([[m.x - dy * i * m.r * 0.5, m.y + dx * i * m.r * 0.5], [m.x + dx * m.len * (1 - Math.abs(i) * 0.2) - dy * i * m.r, m.y + dy * m.len * (1 - Math.abs(i) * 0.2) + dx * i * m.r]], { passes: 2, a: 0.8, col: S.accent, seed: i + 9 });
    pen.stroke(ell(m.x, m.y, m.r * 1.6, m.r * 1.6, 10), { closed: 1, sm: 1, col: S.accent, w: 1.4, seed: 2 }); }
  // the horizon
  if (!f.backdrop) {
    v.far.forEach((l, i) => { below(ctx, l.pts, l.bottom); ctx.fillStyle = S.wash ? mixc(S.paper, '#7f93a0', 0.22 + 0.1 * i) : S.paper; ctx.fill(); pen.line(l.pts, { passes: 1, a: 0.3 + 0.12 * i, w: 0.8, seed: 20 + i });
      if (S.hatch && f.p.x2 > 0.15) pen.hatch(() => { below(ctx, l.pts, l.bottom); }, [0, v.horizon - h * 0.3, w, v.horizon], -1.1, S.gap * u * (2.6 - i * 0.8), 30 + i, { a: 0.18 }); });
    if (v.sea) for (let i = 0; i < 5; i++) { const y = lerp(v.sea.y0, v.sea.y1, i / 4); pen.line([[0, y], [w * 0.3, y + u], [w * 0.7, y - u], [w, y]], { passes: 1, a: 0.3, w: 0.7, seed: 40 + i }); }
  }
  // ground bands, plants and animals, far to near
  for (const b of v.layers) {
    below(ctx, b.pts, h + 4); ctx.fillStyle = S.wash ? mixc(S.paper, mixc(cssRGB(v.biome.ground[0]), cssRGB(v.biome.ground[1]), b.u), 0.3 * (1 - E.dark * 0.6)) : S.paper; ctx.fill();
    pen.line(b.pts, { passes: 1, a: lerp(0.16, 0.5, b.u), w: 0.8, seed: 60 + (b.u * 50 | 0), sm: 0 });
    if (b.anyWet) { const n = b.pts.length; for (let i = 1; i < n - 1; i++) if (b.wet[i] && i % 2) { const x = b.pts[i][0], y = lerp(b.level, Math.min(b.next, h), 0.5), l = w / 30; if (S.wash) { ctx.fillStyle = 'rgba(96,140,170,.18)'; ctx.fillRect(x - l * 1.2, b.level, l * 2.4, b.next - b.level); } pen.line([[x - l, y], [x - l / 3, y - 1.5 * u], [x + l / 3, y + 1.5 * u], [x + l, y]], { passes: 1, a: 0.35, w: 0.7, seed: i }); } }
    for (const it of b.items) {
      if (it.type === 'plant') { sketchPlant(f, pen, S, it, { pal: pp, a: S.wash ? 0.8 : S.margin ? 0.6 : 0.42 }); continue; }
      const main = it.actor === lead, a = (it.fade ?? 1) * lerp(1, 0.4, clamp(it.fog / 0.6)) * (main || S.margin ? 1 : 0.72);
      if (a < 0.03) continue;
      if (!it.wade) groundShadow(f, pen, S, it.T, it.pose, { a: 0.45 * a });
      drawAnimal(f, pen, S, it.parts, it.T, { q: it.pose, a, seed: it.actor.id, passes: main ? S.passes : Math.min(2, S.passes), pal: S.wash ? palette(it.sp, { light: 1, fog: it.fog * 0.5 }) : null });
      if (it.wade) { const l = it.sp.len * it.T.k * 0.24; ctx.fillStyle = S.paper; ctx.fillRect(it.T.x - l * 1.6, it.waterY, l * 3.2, h); for (let i = 0; i < 3; i++) pen.line([[it.T.x - l * (1.5 - i * 0.2), it.waterY + i * 3 * u], [it.T.x, it.waterY + i * 3 * u - u], [it.T.x + l * (1.5 - i * 0.2), it.waterY + i * 3 * u]], { passes: 1, a: 0.5, w: 0.7, seed: i }); }
    }
  }
  ctx.restore();
  if (S.margin) biroMargin(f, pen, S, st, lead);
  if (f.p.x3 > 0.04) fieldNotes(f, pen, S, v, st, lead, leadIt);
  tints(f, v.light / (1 - 0.75 * E.dark || 1), v.flash, v.dark);
  st.fresh = false;
}

const HEADK = new Set(['skull', 'jaw', 'tooth', 'crest', 'horn', 'beak', 'eye', 'nostril', 'frill', 'mouth']);
const restCache = new Map();
// a species at rest: its parts, where its head is, and its extent in metres (for framing and for margin studies)
function rest(sp) {
  let r = restCache.get(sp.id); if (r) return r;
  const q = pose(sp, { jaw: 0.12 }), P = parts(q), b = bboxAll(P), head = P.filter(m => HEADK.has(m.k) && (m.k !== 'horn' || true));
  r = { q, P, x0: b[0], x1: b[2], top: b[3], head, hb: bboxAll(head) };
  restCache.set(sp.id, r); return r;
}
// fit a species into a pixel box (feet on the bottom edge)
function fit(sp, box, dir = 1, grow = 1.06) {
  const r = rest(sp), k = Math.min((box[2] - box[0]) / ((r.x1 - r.x0) * grow), (box[3] - box[1]) / (r.top * grow));
  return { x: (box[0] + box[2]) / 2 - dir * (r.x0 + r.x1) / 2 * k, y: box[3], k, dir };
}
// a footprint, drawn from the kind of foot the species has (unit box, toes up)
function track(sp) {
  const t = sp.P.toes, toe = (a, l, wd) => { const c = Math.cos(a), s = Math.sin(a); return { s: 1, p: [[-c * wd, 0.1 + s * wd * 0.2], [s * l * 0.5 - c * wd * 1.1, -l * 0.5 * c], [s * l, -l * c], [s * l * 0.5 + c * wd * 1.1, -l * 0.5 * c], [c * wd, 0.1 - s * wd * 0.2]].map(p => [p[0], p[1] + 0.25]) }; };
  if (t === 'pad') return [{ s: 1, p: ell(0, 0.05, 0.42, 0.5, 10) }, ...[-0.3, -0.1, 0.1, 0.3].map(x => ({ c: [x * 1.1, -0.5 + Math.abs(x) * 0.35, 0.09] }))];
  if (t === 'hoof') return [{ s: 1, p: ell(0, 0.14, 0.4, 0.36, 10) }, ...[[-0.33, -0.27], [0, -0.42], [0.33, -0.27]].map(([x, y]) => ({ s: 1, p: ell(x, y, 0.15, 0.17, 8) }))];
  return [toe(-0.5, 0.78, 0.09), toe(0, 0.95, 0.1), toe(0.5, 0.78, 0.09), { s: 1, p: ell(0, 0.32, 0.13, 0.12, 8) }];
}
const TOOTH = [{ s: 1, p: [[-0.3, -0.5], [0.3, -0.5], [0.28, -0.2], [0.16, 0.2], [-0.06, 0.6], [-0.2, 0.2], [-0.32, -0.2]] }, { l: [[-0.34, -0.2], [0.3, -0.2]], w: 0.01 }];
const toBox = (M, b, box) => { const k = Math.min((box[2] - box[0]) / (b[2] - b[0]), (box[3] - box[1]) / (b[3] - b[1])), ox = (box[0] + box[2]) / 2 - (b[0] + b[2]) / 2 * k, oy = (box[1] + box[3]) / 2 - (b[1] + b[3]) / 2 * k; return M.map(m => m.c ? { ...m, c: [ox + m.c[0] * k, oy + m.c[1] * k, m.c[2] * k] } : m.p ? { ...m, p: m.p.map(p => [ox + p[0] * k, oy + p[1] * k]) } : { ...m, l: m.l.map(p => [ox + p[0] * k, oy + p[1] * k]), w: 1 }); };

// handwritten notes for the notebook and the journal: who this is, what is known, labels, studies in the margin
function fieldNotes(f, pen, S, v, st, lead, it) {
  const { ctx, w, h } = f, E = f.era, n = f.p.x3, u = pen.u, T = { font: S.font, col: S.ink, bold: S.bold };
  if (S.margin) return biroNotes(f, pen, S, v, lead, it);
  const bg = mixc(S.paper, S.paper, 0, f.combo ? 0.85 : 0.72);
  write(ctx, `${E.name} · ${Math.round(E.ma)} million years ago`, w * 0.965, h * 0.075, { ...T, px: h * 0.032, col: S.soft, align: 'right', bg });
  if (!lead) { write(ctx, E.text, w * 0.05, h * 0.16, { ...T, px: h * 0.036, maxW: w * 0.62, max: 5, bg }); return; }
  const sp = lead.sp, x0 = w * 0.045;
  write(ctx, sp.name, x0, h * 0.125, { ...T, px: h * 0.085, col: S.accent, tilt: 0.012, bg });
  const nw = textW(ctx, sp.name, { ...T, px: h * 0.085 });
  pen.line([[x0, h * 0.142], [x0 + nw * 0.5, h * 0.147], [x0 + nw * 1.03, h * 0.14]], { col: S.accent, a: 0.8, seed: 3 });
  write(ctx, `“${sp.means}”  ·  ${fmtLen(sp)} long  ·  ${dietOf(sp)}`, x0, h * 0.2, { ...T, px: h * 0.037, col: S.soft, bg });
  if (n > 0.2) write(ctx, sp.fact, x0, h * 0.262, { ...T, px: h * 0.036, maxW: w * 0.66, max: 3, bg });
  if (n > 0.3) write(ctx, `Fossils: ${sp.where}. ${fmtAge(sp)} million years ago. Colour: ${sp.known === 'colour' ? 'known from fossil pigment' : S.wash ? 'a guess' : 'not known'}.`, x0, h * 0.972, { ...T, px: h * 0.03, col: S.soft, maxW: w * 0.74, max: 1, bg });
  if (it && n > 0.4 && Math.abs(it.T.dir) > 0.6) {
    const q = it.pose, bb = bboxAll(mapParts(it.parts, it.T)), L = toPx(anatomy(sp, q, { feats: 2 }), it.T).filter(l => l.x > w * 0.02 && l.x < w * 0.75);
    const yb = Math.min(h * 0.93, it.T.y + h * 0.1);
    callouts(f, pen, S, L, Math.max(h * 0.4, bb[1] - h * 0.035), yb, w * 0.03, w * 0.76, { px: h * 0.034, bg });
    const xa = mapPt([q.nodes[0].x, 0], it.T)[0], xb = mapPt([q.head.x + Math.cos(q.head.a) * q.head.len, 0], it.T)[0];
    if (!lead.young) pen.dim(Math.min(xa, xb), Math.max(xa, xb), Math.min(h * 0.885, it.T.y + h * 0.045), '', {});
    if (!lead.young) write(ctx, `about ${fmtLen(sp)}`, Math.max(xa, xb) + 10 * u, Math.min(h * 0.885, it.T.y + h * 0.045) + h * 0.012, { ...T, px: h * 0.034, bg });
  }
  // studies in the margin: the skull, a footprint, and a tooth (meat eaters) or what it ate
  if (n > 0.6) {
    const flipY = M => M.map(m => m.c ? { ...m, c: [m.c[0], -m.c[1], m.c[2]] } : m.p ? { ...m, p: m.p.map(p => [p[0], -p[1]]) } : { ...m, l: m.l.map(p => [p[0], -p[1]]) });
    const r = rest(sp), cx0 = w * 0.795, cx1 = w * 0.975, cards = [['skull', flipY(r.head)], ['footprint', track(sp)]];
    const meat = sp.diet === 'carnivore' || sp.diet === 'fish eater';
    if (meat && r.P.some(m => m.k === 'tooth')) cards.push(['tooth', TOOTH]);
    else if (sp.diet === 'herbivore') cards.push(['ate plants', flipY(plantParts('fern', 5, 0))]);
    cards.forEach(([label, M0], i) => {
      const y0 = h * (0.12 + i * 0.245), y1 = y0 + h * 0.2, card = [[cx0, y0], [cx1, y0 + 2 * u], [cx1 - u, y1], [cx0 + 2 * u, y1 - u]];
      ctx.beginPath(); tr(ctx, { p: card }); ctx.fillStyle = S.far; ctx.fill();
      pen.stroke(card, { closed: 1, passes: 1, a: 0.45, w: 0.8, seed: 80 + i });
      const b = bboxAll(M0), M = toBox(M0, b, [cx0 + w * 0.02, y0 + h * 0.015, cx1 - w * 0.02, y1 - h * 0.05]);
      drawAnimal(f, pen, { ...S, paper: S.far, wash: 0 }, M, null, { seed: 90 + i, passes: 2 });
      const mb = bboxAll(M); if (i) pen.hatch(() => tr(ctx, { p: ell((mb[0] + mb[2]) / 2, (mb[1] + mb[3]) / 2, (mb[2] - mb[0]) * 0.75, (mb[3] - mb[1]) * 0.62) }), mb, -0.9, S.gap * u * 1.6, 5 + i, { a: 0.22 });
      write(ctx, label, (cx0 + cx1) / 2, y1 - h * 0.014, { ...T, px: h * 0.031, col: S.soft, align: 'center' });
    });
  }
}

// ---------------------------------------------------------------- ballpoint doodle
function biroNotes(f, pen, S, v, lead, it) {
  const { ctx, w, h } = f, n = f.p.x3, u = pen.u, T = { font: S.font, col: S.ink }, bg = f.combo ? 'rgba(251,250,242,.8)' : null;
  if (!lead) { write(ctx, f.era.name + '.', w * 0.17, h * 0.13, { ...T, px: h * 0.07, bg }); write(ctx, f.era.text, w * 0.17, h * 0.21, { ...T, px: h * 0.034, maxW: w * 0.7, max: 4, bg }); return; }
  const sp = lead.sp, x0 = w * 0.165, name = sp.name.toUpperCase() + '!';
  write(ctx, name, x0, h * 0.125, { ...T, px: h * 0.074, tilt: 0.02, bg });
  const nw = textW(ctx, name, { ...T, px: h * 0.074 });
  for (let i = 0; i < 2; i++) pen.line([[x0, h * (0.145 + i * 0.014)], [x0 + nw * 0.5, h * (0.15 + i * 0.014)], [x0 + nw, h * (0.143 + i * 0.014)]], { passes: 1, col: i ? S.accent : S.ink, seed: i + 1 });
  write(ctx, `= “${sp.means}”   ${fmtLen(sp)} long!!   ${dietOf(sp)}`, x0, h * 0.215, { ...T, px: h * 0.036, bg });
  if (n > 0.3) write(ctx, sp.fact, x0, h * 0.955, { ...T, px: h * 0.033, maxW: w * 0.8, max: 2, lh: 1.1, bg });
  if (it && n > 0.5 && Math.abs(it.T.dir) > 0.6) {
    const bb = bboxAll(mapParts(it.parts, it.T)), L = toPx(anatomy(sp, it.pose, { feats: 2, noHip: 1 }), it.T).filter(l => l.up && l.x > w * 0.16 && l.x < w * 0.96);
    callouts(f, pen, S, L, Math.max(h * 0.3, bb[1] - h * 0.05), 0, w * 0.16, w * 0.97, { px: h * 0.036, col: S.accent, acol: S.accent, bg });
  }
  // doodles: a star, a spiral, a boxed age
  if (n > 0.6) {
    const cx = w * 0.9, cy = h * 0.14, r = h * 0.045, star = Array.from({ length: 11 }, (_, i) => { const a = i * TAU * 2 / 5 - Math.PI / 2; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
    pen.stroke(star, { passes: 2, sm: 0, seed: 12 });
    const sx = w * 0.79, sp2 = Array.from({ length: 40 }, (_, i) => { const a = i * 0.55, rr = h * 0.0011 * i; return [sx + Math.cos(a) * rr, cy + Math.sin(a) * rr]; });
    pen.stroke(sp2, { passes: 1, sm: 1, seed: 14 });
  }
}
// a herd of little ones walking down the margin, and loops
function biroMargin(f, pen, S, st, lead) {
  const { ctx, w, h } = f, u = pen.u;
  const sp = lead ? lead.sp : null;
  if (sp && f.p.x3 > 0.15) {
    const g = gait(sp, 0), r = rest(sp), k = w * 0.085 / (r.x1 - r.x0);
    for (let i = 0; i < 5; i++) {
      const y = h * (0.3 + i * 0.125), ph = f.t * g.vWalk * 0.8 / g.stride + i * 0.37, q = pose(sp, { phase: ph, t: f.t + i * 3, headTo: i % 3 === 1 ? -0.8 : 0.1, scale: i === 3 ? 0.55 : 1, young: i === 3 ? 0.7 : 0 });
      const T = { x: w * 0.072 - (r.x0 + r.x1) / 2 * k * (i === 3 ? 0.5 : 1), y, k, dir: 1 };
      pen.line([[w * 0.02, y + u], [w * 0.07, y], [w * 0.125, y + u]], { passes: 1, a: 0.6, w: 0.7, seed: i });
      drawAnimal(f, pen, S, parts(q), T, { q, seed: 200 + i, passes: 1, noHatch: f.h < 300 });
    }
  }
  const loops = Array.from({ length: 60 }, (_, i) => { const a = i * 0.7; return [w * (0.03 + i * 0.0016) + Math.cos(a) * h * 0.022, h * 0.2 + Math.sin(a) * h * 0.022]; });
  pen.stroke(loops, { passes: 1, sm: 1, a: 0.8, w: 0.8, seed: 31 });
}

// ---------------------------------------------------------------- charcoal
function charcoalWorld(f, st, v, pen, lead, leadIt) {
  const { ctx, w, h } = f, S = st.S, u = pen.u, sc = 1 / 4, bw = Math.ceil(w * sc), bh = Math.ceil(h * sc), E = f.era;
  // the T. rex stops and calls: roughly half the time, and at once on a first frame
  if (lead && E.meteor <= 0) {
    const calling = (f.t / 12) % 1 < 0.58;
    if (calling) { lead.tx = lead.x; lead.idle = 'call'; lead.timer = Math.max(lead.timer, 1); if (st.fresh) { lead.v = 0; lead.headTo = 0.75; lead.jaw = 1; lead.rear = lead.sp.P.biped ? 0.15 : 0; } if (!st.called && f.sig) f.sig.roar = 1; }
    st.called = calling;
    if (st.fresh && calling && leadIt) { leadIt._q = leadIt._p = null; const a = lead; Object.defineProperty(leadIt, 'pose', { value: pose(a.sp, { phase: a.phase, run: 0, headTo: 0.75, jaw: 1, rear: a.rear, t: f.t + a.id, scale: a.scale }) }); Object.defineProperty(leadIt, 'parts', { value: parts(leadIt.pose) }); }
  }
  if (!st.buf || st.buf.canvas.width !== bw || st.buf.canvas.height !== bh) st.buf = buffer(bw, bh);
  const g = st.buf.ctx, P = rgb(S.paper), I = rgb(S.ink), tone = (k, a = 1) => mixc(P, I, clamp(k), a), night = 1 - clamp(v.light * 2.4);
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, bw, bh); g.setTransform(sc, 0, 0, sc, 0, 0);
  if (!f.combo) {
    const gr = g.createLinearGradient(0, 0, 0, v.horizon); gr.addColorStop(0, tone(0.5 + 0.35 * night)); gr.addColorStop(0.7, tone(0.18 + 0.3 * night)); gr.addColorStop(1, tone(0.06 + 0.2 * night));
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) { const x = hash(i, 3) * w * 1.2 - w * 0.1, y = hash(i, 5) * v.horizon * 0.7, r = h * (0.25 + 0.3 * hash(i, 8)); g.globalAlpha = 0.16; g.drawImage(puff(i % 3 ? '19,17,16' : '240,234,220', 128, 0.2), x - r, y - r * 0.3, r * 2.4, r * 0.7); }
    g.globalAlpha = 1;
    const s = v.sun, sg = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 4); sg.addColorStop(0, 'rgba(250,246,236,.95)'); sg.addColorStop(0.28, 'rgba(250,246,236,.8)'); sg.addColorStop(1, 'rgba(250,246,236,0)');
    g.fillStyle = sg; g.fillRect(s.x - s.r * 4, s.y - s.r * 4, s.r * 8, s.r * 8);
    if (leadIt) { const r = h * 0.75; g.globalAlpha = 0.55 * (1 - 0.5 * night); g.drawImage(puff('246,241,228', 128, 0.25), leadIt.T.x + leadIt.sp.len * leadIt.T.k * 0.15 * leadIt.T.dir - r, v.horizon - h * 0.12 - r * 0.6, r * 2, r * 1.2); g.globalAlpha = 1; }    // light behind the animal
  }
  const poly = (m) => { g.beginPath(); tr(g, m); };
  if (!f.backdrop) { v.far.forEach((l, i) => { g.fillStyle = tone(0.34 + 0.14 * i + 0.25 * night); below(g, l.pts, l.bottom); g.fill(); }); g.fillRect(0, v.horizon, w, h * 0.08); }
  for (const b of v.layers) {
    g.fillStyle = tone(lerp(0.46, 0.2, b.u) + 0.25 * night + 0.2 * E.dark); below(g, b.pts, h + 4); g.fill();
    for (const it of b.items) {
      if (it.type === 'plant') { if (it.x < -it.k * 16 || it.x > w + it.k * 16) continue; g.fillStyle = g.strokeStyle = tone(0.58 - it.fog * 0.5 + 0.2 * night); g.lineCap = 'round';
        for (const m of mapParts(it.parts, { x: it.x, y: it.y, k: it.k, dir: 1 })) { poly(m); if (m.l) { g.lineWidth = Math.max(1, m.w); g.stroke(); } else g.fill(); } continue; }
      const M = mapParts(it.parts, it.T), fg = it.fog * 0.6; g.globalAlpha = it.fade ?? 1;
      const q = it.pose, len = q.L * it.T.k; g.fillStyle = tone(0.7, 0.5); g.beginPath(); g.ellipse(it.T.x + q.nodes[q.iSh].x * 0.5 * it.T.k * it.T.dir, it.T.y, len * 0.36, len * 0.03, 0, 0, TAU); g.fill();
      for (const m of M) { if (m.l) continue; const k = m.t === 'far' || m.t === 'accentFar' ? 0.95 : m.t === 'belly' ? 0.52 : m.t === 'horn' ? 0.05 : m.t === 'eye' ? 0.1 : m.t === 'mouth' ? 1 : m.t === 'accent' ? 0.66 : m.t === 'mark' ? 0.95 : 0.84;
        g.fillStyle = tone(lerp(k, 0.4, fg), m.k === 'mark' ? 0.5 : 1); poly(m); g.fill(); }
      g.globalAlpha = 1;
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, w, h); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(st.buf.canvas, 0, 0, bw, bh, 0, 0, bw / sc, bh / sc);
  ctx.globalAlpha = 0.3; ctx.drawImage(st.buf.canvas, 0, 0, bw, bh, 5 * u, -1 * u, bw / sc, bh / sc); ctx.globalAlpha = 1;     // a smear of the hand
  // the tooth of the paper: flecks where the charcoal skipped
  ctx.save(); ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = 'rgba(232,226,210,.16)'; ctx.beginPath(); for (let i = 0; i < 900; i++) { const x = ih(i, 1) * w, y = ih(i, 2) * h, r = (0.6 + ih(i, 3) * 1.6) * u; ctx.rect(x, y, r * 2.4, r); } ctx.fill();
  ctx.fillStyle = 'rgba(15,13,12,.1)'; ctx.beginPath(); for (let i = 0; i < 500; i++) { const x = ih(i, 4) * w, y = ih(i, 5) * h, r = (0.6 + ih(i, 6) * 1.4) * u; ctx.rect(x, y, r * 2, r); } ctx.fill();
  ctx.restore();
  // strong darks on top
  for (const b of v.layers) {
    if (b.u > 0.5) pen.line(b.pts, { passes: 1, a: 0.3 * b.u, w: 0.8, seed: 60 + (b.u * 50 | 0), sm: 0 });
    for (const it of b.items) if (it.type === 'dino') {
      const main = it.actor === lead, a = (it.fade ?? 1) * lerp(1, 0.3, clamp(it.fog / 0.5));
      if (main) { ctx.globalAlpha = 0.3 * a; ctx.fillStyle = S.ink; ctx.beginPath(); for (const m of mapParts(it.parts, it.T)) if (!m.l && (m.t === 'body' || m.t === 'far')) tr(ctx, m); ctx.fill(); ctx.globalAlpha = 1; }
      drawAnimal(f, pen, S, it.parts, it.T, { q: it.pose, a: a * 0.92, seed: it.actor.id, passes: main ? 2 : 1 });
      if (main) { const q = it.pose, n = q.nodes, hi = []; for (let i = q.iHip - 3; i <= q.iSh + 1; i++) hi.push(mapPt([n[i].x - 0.02 * q.L, n[i].y + n[i].r * 0.72], it.T));       // a wipe of the eraser along the back
        pen.stroke(hi, { sm: 1, passes: 1, col: '#efe9d9', a: 0.2, w: 2.4, seed: 9, solid: 1 }); }
    }
  }
  if (lead && f.p.x3 > 0.3) {
    const sp = lead.sp, bg = null;
    write(ctx, `${sp.name}, “${sp.means}”`, w * 0.96, h * 0.93, { font: S.font, bold: 1, px: h * 0.045, col: night > 0.5 ? '#ece6d6' : S.ink, align: 'right', a: 0.9, bg });
    if (f.p.x3 > 0.6) write(ctx, `${fmtLen(sp)} long · ${fmtAge(sp)} million years ago`, w * 0.96, h * 0.972, { font: S.font, bold: 1, px: h * 0.03, col: night > 0.5 ? '#d8d2c2' : S.soft, align: 'right', a: 0.9 });
  }
  tints(f, 1, v.flash, v.dark * 0.5);
  st.fresh = false;
}

// ---------------------------------------------------------------- one animal on the page (the rig, no world)
// who is on the page at this moment of deep time: the scene's species, or whoever filled its niche; after the
// extinction a non-bird is drawn from its bones
function hero(f, st, o = {}) {
  const base = species(st.opts.sp), E = f.era, sp = st.opts.lock ? base : standIn(base, E.ma);
  if (!sp) return null;
  const fossil = sp.plan !== 'bird' && E.dinos < 0.5, run = o.run || 0, g = gait(sp, run), t = o.t ?? f.t, e = 0.4 + 1.2 * clamp(f.p.activity);
  const phase = t * g.speed * (o.pace ?? 0.75) * (o.fixed ? 1 : e) / g.stride;
  const q = pose(sp, { phase, run, headTo: o.headTo ?? 0.12 * Math.sin(t * 0.45), jaw: o.jaw ?? Math.max(0, Math.sin(t * 0.3) - 0.8) * 2, t });
  return { sp, q, fossil, same: sp === base, src: fossil || o.bones ? bones(q) : parts(q), speed: g.speed * (o.pace ?? 0.75) * (o.fixed ? 1 : e) };
}
function nobody(f, S, pen) {
  write(f.ctx, `Nothing like this animal is known from ${Math.round(f.era.ma)} million years ago.`, f.w * 0.5, f.h * 0.48, { font: S.font, bold: S.bold, italic: S.italic, px: f.h * 0.042, col: S.ink, align: 'center', maxW: f.w * 0.7 });
}
const HUMAN = [{ c: [0, 1.67, 0.12] }, { s: 1, p: [[-0.2, 1.5], [0.2, 1.5], [0.25, 0.95], [0.17, 0.02], [0.04, 0.02], [0, 0.82], [-0.04, 0.02], [-0.17, 0.02], [-0.25, 0.95]] }];

function blueprint(f, st) {
  const { ctx, w, h } = f, S = st.S, pen = makePen(f, S), u = pen.u, n = f.p.x3, H = hero(f, st), gy = h * 0.69;
  const T = H ? fit(H.sp, [w * 0.06, h * 0.1, w * 0.84, gy]) : { x: w / 2, y: gy, k: h / 20, dir: 1 };
  let gm = 10; for (const s of [0.1, 0.25, 0.5, 1, 2, 5, 10]) if (s * T.k >= 15 * u) { gm = s; break; }
  paper(f, S, flatTop(f), () => {
    const gp = gm * T.k;
    for (const major of [0, 1]) { ctx.beginPath(); ctx.strokeStyle = major ? 'rgba(200,225,255,.3)' : 'rgba(200,225,255,.13)'; ctx.lineWidth = Math.max(0.6, u * (major ? 1 : 0.7));
      for (let i = Math.ceil(-T.x / gp); i * gp + T.x < w; i++) if (!major || i % 5 === 0) { const x = Math.round(T.x + i * gp) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let i = Math.ceil(-gy / gp); i * gp + gy < h; i++) if (!major || i % 5 === 0) { const y = Math.round(gy + i * gp) + 0.5; ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke(); }
  });
  const fr = h * 0.03; pen.stroke([[fr, fr], [w - fr, fr], [w - fr, h - fr], [fr, h - fr]], { closed: 1, w: 1.5, seed: 1, a: f.combo ? 0.5 : 1 });
  if (!H) { nobody(f, S, pen); return tints(f, f.p.light, 0, 0, 0.6); }
  const { sp, q } = H, r = rest(sp);
  // ground line with drafting ticks
  pen.stroke([[w * 0.045, gy], [w * 0.955, gy]], { w: 1.2, seed: 2 });
  ctx.beginPath(); for (let x = w * 0.05; x < w * 0.95; x += 9 * u) { ctx.moveTo(x, gy + 1.5 * u); ctx.lineTo(x - 5 * u, gy + 7 * u); } ctx.strokeStyle = S.soft; ctx.globalAlpha = 0.5; ctx.lineWidth = Math.max(0.5, 0.7 * u); ctx.stroke(); ctx.globalAlpha = 1;
  drawAnimal(f, pen, S, H.src, T, { q, seed: 3 });
  const tf = { font: S.font, col: S.ink, tilt: 0 }, bgc = S.paper;
  if (n > 0.25) {
    // centre marks on the hip and shoulder, a centre line along the spine
    for (const i of [q.iHip, q.iSh]) { const p = mapPt([q.nodes[i].x, q.nodes[i].y], T), c = 6 * u; pen.stroke(ell(p[0], p[1], c, c, 10), { closed: 1, sm: 1, col: S.accent, w: 0.8, seed: 4 }); ctx.beginPath(); ctx.moveTo(p[0] - c * 2, p[1]); ctx.lineTo(p[0] + c * 2, p[1]); ctx.moveTo(p[0], p[1] - c * 2); ctx.lineTo(p[0], p[1] + c * 2); ctx.strokeStyle = S.accent; ctx.lineWidth = Math.max(0.5, 0.8 * u); ctx.stroke(); }
    ctx.setLineDash([14 * u, 4 * u, 3 * u, 4 * u]); ctx.beginPath(); q.nodes.forEach((nd, i) => { const p = mapPt([nd.x, nd.y], T); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }); ctx.strokeStyle = S.accent; ctx.globalAlpha = 0.7; ctx.lineWidth = Math.max(0.5, 0.8 * u); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    // the real length, nose to tail
    const xa = T.x + r.x0 * T.k, xb = T.x + r.x1 * T.k, yd = gy + h * 0.075;
    pen.dim(xa, xb, yd, '', { ext: h * 0.07, tick: 5 });
    write(ctx, `LENGTH ${fmtLen(sp)}`, (xa + xb) / 2, yd + h * 0.012, { ...tf, px: h * 0.034, align: 'center', bg: bgc });
    // a person for scale
    const hx = w * 0.905, hT = { x: hx, y: gy, k: T.k, dir: 1 };
    if (1.8 * T.k > 9 * u && 1.8 * T.k < h * 0.5) { drawAnimal(f, pen, S, HUMAN, hT, { seed: 6, noHatch: 1 }); const hy = gy - 1.8 * T.k; pen.stroke([[hx + 0.45 * T.k + 4 * u, hy], [hx + 0.45 * T.k + 4 * u, gy]], { w: 0.7, seed: 7 }); for (const y of [hy, gy]) pen.stroke([[hx + 0.45 * T.k, y], [hx + 0.45 * T.k + 8 * u, y]], { w: 0.7, seed: 8 });
      write(ctx, '1.8 m', hx, Math.min(hy - 8 * u, gy - h * 0.05), { ...tf, px: h * 0.026, align: 'center', col: S.soft, bg: bgc }); write(ctx, 'person', hx, Math.min(hy - 8 * u, gy - h * 0.05) - h * 0.03, { ...tf, px: h * 0.026, align: 'center', col: S.soft, bg: bgc }); }
  }
  if (n > 0.45) {
    const L = toPx(anatomy(sp, q, { feats: 2, skull: 1, spine: 1, tail: 1 }), T).filter(l => l.up).map(l => ({ ...l, t: l.t.toUpperCase() }));
    const bb = bboxAll(mapParts(r.P, T));
    callouts(f, pen, S, L, Math.max(h * 0.085, bb[1] - h * 0.03), 0, w * 0.05, w * 0.8, { px: h * 0.026, col: S.accent, acol: S.accent, bg: bgc });
  }
  // plan view, half size, under the tail
  if (n > 0.55) {
    const pk = T.k * 0.5, pT = { x: w * 0.06 - r.x0 * pk, y: h * 0.885, k: pk, dir: 1 };
    drawAnimal(f, pen, S, topParts(q), pT, { seed: 9, noHatch: 1, passes: 1 });
    write(ctx, 'PLAN, HALF SIZE', w * 0.06, h * 0.955, { ...tf, px: h * 0.024, col: S.soft });
  }
  // title block
  const bx0 = w * 0.565, bx1 = w * 0.962, by0 = h * 0.805, by1 = h * 0.955, mid = by0 + (by1 - by0) * 0.56;
  ctx.fillStyle = f.combo ? S.paper : S.far; ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
  pen.stroke([[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]], { closed: 1, w: 1.2, seed: 11 });
  pen.stroke([[bx0, mid], [bx1, mid]], { w: 0.8, seed: 12 });
  const cells = [['LENGTH', fmtLen(sp)], ['MASS', fmtMass(sp)], ['AGE', `${fmtAge(sp)} Ma`], ['GRID', `${gm} m`]], cw = (bx1 - bx0) / cells.length;
  cells.forEach(([k, val], i) => { const x = bx0 + cw * i; if (i) pen.stroke([[x, mid], [x, by1]], { w: 0.8, seed: 13 + i }); write(ctx, k, x + 5 * u, mid + h * 0.024, { ...tf, px: h * 0.019, col: S.soft }); write(ctx, val, x + 5 * u, mid + h * 0.054, { ...tf, px: h * 0.026 }); });
  write(ctx, sp.name.toUpperCase(), bx0 + 7 * u, by0 + h * 0.042, { ...tf, px: Math.min(h * 0.038, (bx1 - bx0) / (sp.name.length * 0.66)), col: S.ink });
  write(ctx, `“${sp.means}”` + (H.fossil ? ' · EXTINCT, FROM FOSSILS' : ` · ${sp.group}`), bx0 + 7 * u, by0 + h * 0.074, { ...tf, px: h * 0.023, col: S.accent });
  tints(f, f.p.light, 0, 0, 0.6);
}

function chalkboard(f, st) {
  const { ctx, w, h } = f, S = st.S, pen = makePen(f, S), u = pen.u, n = f.p.x3, H = hero(f, st, { headTo: 0.1 });
  paper(f, S, flatTop(f), () => {
    for (let i = 0; i < 16; i++) { const r = h * (0.25 + 0.5 * hash(i, 3)); ctx.globalAlpha = 0.035 + 0.05 * hash(i, 9); ctx.drawImage(puff('236,233,220', 128, 0.12), hash(i, 1) * w * 1.2 - r, hash(i, 2) * h - r * 0.3, r * 2.2, r * (0.3 + 0.4 * hash(i, 5))); }
    ctx.globalAlpha = 1;
    // the tray, a stick of chalk and the duster
    const ty = h * 0.955; ctx.fillStyle = '#6a4a2e'; ctx.fillRect(0, ty, w, h - ty); ctx.fillStyle = '#84603d'; ctx.fillRect(0, ty, w, h * 0.009);
    ctx.fillStyle = '#f2efe4'; ctx.fillRect(w * 0.2, ty - h * 0.012, w * 0.045, h * 0.012); ctx.fillStyle = '#f6d56b'; ctx.fillRect(w * 0.26, ty - h * 0.011, w * 0.03, h * 0.011);
    ctx.fillStyle = '#3a3a3a'; ctx.fillRect(w * 0.8, ty - h * 0.03, w * 0.09, h * 0.018); ctx.fillStyle = '#9a8f7c'; ctx.fillRect(w * 0.8, ty - h * 0.012, w * 0.09, h * 0.012);
  });
  if (!H) { nobody(f, S, pen); return tints(f, f.p.light, 0, 0, 0.6); }
  const { sp, q } = H, T = fit(sp, [w * 0.14, h * 0.33, w * 0.86, h * 0.71]), tf = { font: S.font, col: S.ink, dust: 1 };
  write(ctx, sp.name, w * 0.05, h * 0.13, { ...tf, px: h * 0.085 });
  const nw = textW(ctx, sp.name, { ...tf, px: h * 0.085 });
  pen.line([[w * 0.05, h * 0.152], [w * 0.05 + nw * 0.5, h * 0.157], [w * 0.05 + nw, h * 0.15]], { col: S.accent, w: 1.2, seed: 2 });
  write(ctx, `means “${sp.means}”`, w * 0.05, h * 0.215, { ...tf, px: h * 0.042, col: S.accent });
  write(ctx, `${fmtAge(sp)} million years ago`, w * 0.955, h * 0.095, { ...tf, px: h * 0.036, align: 'right', col: S.soft });
  write(ctx, `${dietOf(sp)} · ${sp.where}`, w * 0.955, h * 0.145, { ...tf, px: h * 0.032, align: 'right', col: S.soft, maxW: w * 0.42, max: 2 });
  // floor line and the animal
  pen.line([[w * 0.08, T.y + 2 * u], [w * 0.5, T.y], [w * 0.92, T.y + 2 * u]], { a: 0.7, seed: 5 });
  groundShadow(f, pen, S, T, q, { a: 0.3 });
  drawAnimal(f, pen, S, H.src, T, { q, seed: 7, accentCol: H.fossil ? null : '#9fd3ee' });
  if (n > 0.3) {
    const bb = bboxAll(mapParts(rest(sp).P, T)), L = toPx(anatomy(sp, q, { feats: 3, skull: 1, tail: 1, toes: 1 }), T);
    callouts(f, pen, S, L, Math.max(h * 0.285, bb[1] - h * 0.04), T.y + h * 0.085, w * 0.04, w * 0.96, { px: h * 0.037, col: S.accent, acol: S.soft, dust: 1 });
  }
  if (n > 0.2) { const r = rest(sp), xa = T.x + r.x0 * T.k, xb = T.x + r.x1 * T.k; pen.dim(xa, xb, T.y + h * 0.125, '', { col: '#9fd3ee' }); write(ctx, `${fmtLen(sp)} long`, xb + 10 * u, T.y + h * 0.137, { ...tf, px: h * 0.037, col: '#9fd3ee' }); }
  if (n > 0.5) write(ctx, (H.fossil ? 'Extinct 66 million years ago. ' : '') + sp.fact, w * 0.05, h * 0.885, { ...tf, px: h * 0.033, maxW: w * 0.72, max: 2, lh: 1.15 });
  tints(f, f.p.light, 0, 0, 0.6);
}

// dots only: every part is scanned in strips and dotted by tone, darker towards the underside and the edges
function stippleParts(f, pen, S, M, o = {}) {
  const { ctx } = f, u = pen.u, cell = Math.max(1.2, 1.8 * u * lerp(1.5, 0.72, f.p.x2)), dot = Math.max(1, 1.1 * u * lerp(0.8, 1.3, f.p.x4)), bs = pen.boil * 977;
  const BASE = { far: 0.55, accentFar: 0.55, body: 0.09, accent: 0.26, horn: 0.02, mark: 0.3, bone: 0.05, boneFar: 0.42, hole: 0.85, mouth: 0.8, leaf: 0.22, leaf2: 0.36, trunk: 0.4, flower: 0.1, rock: 0.2, rock2: 0.35, shadow: 0.3 };
  const SH = { far: 0.3, accentFar: 0.3, body: 0.72, accent: 0.3, horn: 0.25, bone: 0.4, boneFar: 0.25, leaf: 0.35, leaf2: 0.3, trunk: 0.3, rock: 0.5, rock2: 0.4 };
  const ys = [];
  ctx.fillStyle = S.ink; ctx.beginPath();
  const put = (x, y) => ctx.rect(x - dot / 2, y - dot / 2, dot, dot);
  M.forEach((m, pi) => {
    const t = m.t, k = m.k;
    if (m.l) { for (let i = 1; i < m.l.length; i++) { const a = m.l[i - 1], b = m.l[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, L / (cell * 0.8) | 0); for (let j = 0; j <= n; j++) put(a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n); } return; }
    if (k === 'belly' || k === 'nostril') return;
    let P = ptsOf(m); if (m.s && P.length > 3) P = chaikin(chaikin(P));
    const n = P.length, bb = bbox({ p: P }), bw = bb[2] - bb[0], bh = bb[3] - bb[1];
    if (Math.max(bw, bh) < 1.2) return;
    if (k === 'eye') { ctx.fill(); ctx.beginPath(); ctx.arc(m.c[0], m.c[1], Math.max(0.8, m.c[2] * 0.8), 0, TAU); ctx.fill(); ctx.beginPath(); return; }
    const overlay = k === 'mark' || k === 'scute' || k === 'fuzz' || t === 'shadow';
    if (!overlay) { ctx.fill(); ctx.beginPath(); tr(ctx, { p: P }); ctx.fillStyle = S.paper; ctx.fill(); ctx.fillStyle = S.ink; ctx.beginPath(); }
    const base = (BASE[t] ?? 0.1) * (o.k ?? 1), sh = overlay ? 0 : (SH[t] ?? 0.3), cols = bw >= bh * 0.75 || k === 'body';
    const lo = cols ? bb[0] : bb[1], hi = cols ? bb[2] : bb[3], A = cols ? 0 : 1, B = 1 - A;
    for (let s = lo + cell * 0.3, si = 0; s < hi; s += cell, si++) {
      ys.length = 0;
      for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; if ((a[A] <= s) !== (b[A] <= s)) ys.push(a[B] + (s - a[A]) / (b[A] - a[A]) * (b[B] - a[B])); }
      ys.sort((a, b) => a - b);
      for (let e = 0; e + 1 < ys.length; e += 2) {
        const y0 = ys[e], y1 = ys[e + 1], len = y1 - y0; if (len < 0.5) continue;
        for (let y = y0 + cell * 0.25, yi = 0; y < y1; y += cell, yi++) {
          const tt = (y - y0) / len, edge = Math.min(y - y0, y1 - y) < cell * 1.3 ? 0.22 : 0, d = base + sh * (cols ? tt * tt : (1 - tt) * (1 - tt)) + (overlay ? 0 : edge);
          const r = ih(si * 7919 + pi * 131 + yi, yi * 31 + pi + bs);
          if (r < d) { const j1 = (ih(si + yi * 57, pi + bs) - 0.5) * cell * 0.8, j2 = (r / d - 0.5) * cell * 0.8; cols ? put(s + j1, y + j2) : put(y + j2, s + j1); }
        }
      }
    }
    if (!overlay && !o.noLine) for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]), c = Math.max(1, Math.round(L / (cell * (t === 'far' || t === 'accentFar' ? 0.75 : 0.62)))); for (let j = 0; j < c; j++) { const jj = (ih(i * 13 + j, pi + bs) - 0.5) * dot * 0.5; put(a[0] + (b[0] - a[0]) * j / c + jj, a[1] + (b[1] - a[1]) * j / c - jj); } }
  });
  ctx.fill();
}
function stipple(f, st) {
  const { ctx, w, h } = f, S = st.S, pen = makePen(f, S, 4), u = pen.u, n = f.p.x3, H = hero(f, st, { pace: 0.6 });
  paper(f, S, flatTop(f));
  if (!f.combo) { ctx.strokeStyle = S.ink; ctx.lineWidth = Math.max(0.7, u); ctx.strokeRect(w * 0.045 + 0.5, h * 0.06 + 0.5, w * 0.91, h * 0.78); }
  if (!H) { nobody(f, S, pen); return tints(f, f.p.light, 0, 0, 0.6); }
  const { sp, q } = H, gy = h * 0.74, T = fit(sp, [w * 0.13, h * 0.12, w * 0.87, gy]), len = q.L * T.k;
  const cx = T.x + q.nodes[q.iSh].x * 0.5 * T.k, E = f.era, burnt = E.dark > 0.3 || (E.dinos < 0.5 && E.ferns < 0.3);
  // ground: a dotted shadow, the soil line, a few plants of the time (ferns, cycads, horsetails: all of them older than the dinosaurs)
  const ground = [{ t: 'shadow', k: 'shadow', s: 1, p: ell(cx, gy + len * 0.012, len * 0.4, Math.max(3 * u, len * 0.03), 14) }, { t: 'shadow', k: 'shadow', p: [[w * 0.07, gy], [w * 0.93, gy], [w * 0.93, gy + 5 * u], [w * 0.07, gy + 5 * u]] }];
  stippleParts(f, pen, S, ground, { k: 1.2 });
  const kinds = burnt ? ['stump', 'rock', 'fern'] : ['cycad', 'fern', 'horsetail', 'fern'], pk = Math.min(T.k, h * 0.11);
  [[0.1, 0], [0.9, 1], [0.84, 2], [0.17, 3]].forEach(([x, i]) => stippleParts(f, pen, S, mapParts(plantParts(kinds[i % kinds.length], 11 + i * 7, 0.3 * Math.sin(f.t * 0.8 + i)), { x: w * x, y: gy + (i > 1 ? 4 * u : 0), k: pk * (i > 1 ? 0.8 : 1), dir: 1 }), { k: 1 }));
  stippleParts(f, pen, S, mapParts(H.src, T));
  // scale bar and caption
  const tf = { font: S.font, col: S.ink, tilt: 0 };
  let bar = 1; for (const s of [5, 2, 1, 0.5, 0.2, 0.1]) if (s * T.k < w * 0.16) { bar = s; break; }
  if (n > 0.2) { const bx = w * 0.07, by = h * 0.8, bl = bar * T.k; ctx.fillStyle = S.ink; ctx.fillRect(bx, by, bl, Math.max(1, 1.4 * u)); for (const x of [bx, bx + bl / 2, bx + bl]) ctx.fillRect(x - 0.5 * u, by - 4 * u, Math.max(1, u), 5 * u);
    write(ctx, `${bar} m`, bx + bl + 8 * u, by + 4 * u, { ...tf, px: h * 0.03 }); }
  if (n > 0.35) {
    const y = write(ctx, `Fig. 1.  ${sp.name}, “${sp.means}”.`, w * 0.5, h * 0.895, { ...tf, italic: 1, px: h * 0.043, align: 'center' });
    write(ctx, `Length ${fmtLen(sp)} · ${fmtAge(sp)} million years ago · ${sp.where}` + (H.fossil ? ' · drawn from the skeleton' : ''), w * 0.5, y - h * 0.004, { ...tf, px: h * 0.03, align: 'center', col: S.soft, maxW: w * 0.86, max: 1 });
  }
  tints(f, f.p.light, 0, 0, 0.6);
}

function flipbook(f, st) {
  const { ctx, w, h } = f, S = st.S, pen = makePen(f, S, 8), u = pen.u, fr = Math.floor(f.t * 8), n = f.p.x3;
  const run = lerp(0.35, 0.95, clamp(f.p.activity)), H = hero(f, st, { t: fr / 8, run, pace: 1, fixed: 1, headTo: 0.05, jaw: 0 });
  const px0 = w * 0.1, py0 = h * 0.085, px1 = w * 0.9, py1 = h * 0.86;
  // the desk and the pad: a stack of page edges, a bound end, the top sheet
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.save();
  if (f.combo) { ctx.clearRect(0, 0, w, h); below(ctx, flatTop(f), h + 4); ctx.clip(); }
  ctx.fillStyle = '#57422f'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(30,20,10,.25)'; ctx.lineWidth = Math.max(0.6, u); ctx.beginPath(); for (let i = 0; i < 14; i++) { const y = h * (0.03 + i * 0.074 + 0.02 * hash(i, 2)); ctx.moveTo(0, y); ctx.bezierCurveTo(w * 0.3, y + 6 * u * hash(i, 3), w * 0.6, y - 6 * u * hash(i, 4), w, y + 3 * u); } ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(px0 + 10 * u, py0 + 14 * u, px1 - px0 + 14 * u, py1 - py0 + 14 * u);
  for (let i = 9; i >= 0; i--) { const o = i * 1.6 * u, fl = i < 4 ? (((fr + i) % 4) - 1.5) * 1.1 * u : 0; ctx.fillStyle = i % 2 ? '#e9e2cf' : '#f4eedd'; ctx.beginPath(); ctx.moveTo(px0, py0 + o); ctx.lineTo(px1 + o + fl, py0 + o * 0.6); ctx.lineTo(px1 + o * 1.4 + fl * 2, py1 + o); ctx.lineTo(px0, py1 + o * 1.3); ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(90,80,60,.35)'; ctx.lineWidth = Math.max(0.5, 0.6 * u); ctx.stroke(); }
  ctx.fillStyle = S.paper; ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
  ctx.fillStyle = '#2c2c30'; ctx.fillRect(px0 - 4 * u, py0 - 3 * u, w * 0.035, py1 - py0 + 16 * u);            // the bound edge
  ctx.restore();
  // the page that is turning: a pale sheet sweeping off the corner, 8 times a second
  const ph = (f.t * 8) % 1;
  if (!f.combo) { ctx.save(); ctx.globalAlpha = 0.5 * (1 - ph); ctx.fillStyle = '#fffaf0'; ctx.beginPath(); ctx.moveTo(px1, py1); ctx.quadraticCurveTo(px1 - w * 0.1 * ph, py1 - h * 0.5 * (1 - ph), px1 - w * 0.02, py0 + h * 0.2 * ph); ctx.lineTo(px1 + w * 0.04 * (1 - ph), py0 + h * 0.3); ctx.closePath(); ctx.fill(); ctx.restore(); }
  if (!H) { nobody(f, S, pen); return tints(f, f.p.light, 0, 0, 0.6); }
  const { sp } = H, box = [px0 + w * 0.07, py0 + h * 0.15, px1 - w * 0.07, py1 - h * 0.14], T0 = fit(sp, box, 1, 1.12), gy = T0.y;
  const reg = k => ({ ...T0, x: T0.x + (ih(k, 1) - 0.5) * 4 * u, y: T0.y + (ih(k, 2) - 0.5) * 3 * u });
  // the drawing two pages down shows through
  if (f.p.x2 > 0.1) { const g2 = hero(f, st, { t: (fr - 1) / 8, run, pace: 1, fixed: 1, headTo: 0.05, jaw: 0 }); const pen2 = { ...makePen({ ...f, t: f.t - 1 / 8 }, S, 8) }; drawAnimal(f, pen2, S, g2.src.filter(m => m.k !== 'mark' && m.k !== 'belly'), reg(fr - 1), { a: 0.13, seed: 3, passes: 1, noHatch: 1 }); }
  // ground: a line and speed ticks sliding back under the runner
  const T = reg(fr), slide = (fr / 8 * H.speed * T.k) % (w * 0.12);
  pen.line([[px0 + w * 0.05, gy + u], [w * 0.5, gy - u], [px1 - w * 0.03, gy + u]], { a: 0.7, seed: 4 });
  for (let i = 0; i < 8; i++) { const x = px1 - w * 0.04 - i * w * 0.12 - slide; if (x > px0 + w * 0.06) pen.line([[x, gy + 7 * u], [x - w * 0.035, gy + 8 * u]], { passes: 1, a: 0.5, seed: i }); }
  groundShadow(f, pen, S, T, H.q, { a: 0.4 });
  drawAnimal(f, pen, S, H.src, T, { q: H.q, seed: 3 });
  const tf = { font: S.font, bold: 1, col: S.ink };
  if (n > 0.2) { write(ctx, `${sp.name}: ${H.fossil ? 'skeleton, ' : ''}run cycle`, px0 + w * 0.06, py0 + h * 0.08, { ...tf, px: h * 0.045 }); write(ctx, `“${sp.means}” · ${fmtLen(sp)} long`, px0 + w * 0.06, py0 + h * 0.13, { ...tf, px: h * 0.032, col: S.soft }); }
  if (n > 0.5) write(ctx, '8 drawings a second', px0 + w * 0.06, py1 - h * 0.035, { ...tf, px: h * 0.03, col: S.soft });
  write(ctx, String((fr % 96 + 96) % 96 + 1), px1 - w * 0.05, py0 + h * 0.085, { ...tf, px: h * 0.045, col: S.accent, align: 'center' });
  pen.stroke(ell(px1 - w * 0.05, py0 + h * 0.07, w * 0.03, h * 0.04, 12), { closed: 1, sm: 1, passes: 1, col: S.accent, a: 0.7, seed: 5 });
  // the thumb that flips the pages
  if (!f.combo) {
    const tx = px1 - w * 0.06, ty = py1 + h * 0.02 - Math.sin(ph * Math.PI) * 3 * u;
    ctx.save(); ctx.translate(tx, ty); ctx.rotate(-0.5);
    ctx.fillStyle = 'rgba(40,25,10,.22)'; ctx.beginPath(); ctx.ellipse(5 * u, h * 0.17, w * 0.053, h * 0.245, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e3b190'; ctx.strokeStyle = '#8a5a3c'; ctx.lineWidth = Math.max(0.7, 1.2 * u); ctx.beginPath(); ctx.ellipse(0, h * 0.16, w * 0.05, h * 0.24, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f3d6c2'; ctx.beginPath(); ctx.ellipse(0, -h * 0.01, w * 0.03, h * 0.05, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-w * 0.03, h * 0.1); ctx.quadraticCurveTo(0, h * 0.115, w * 0.03, h * 0.1); ctx.stroke();
    ctx.restore();
  }
  tints(f, f.p.light, 0, 0, 0.6);
}

function anatomyStudy(f, st) {
  const { ctx, w, h } = f, S = st.S, pen = makePen(f, S), u = pen.u, n = f.p.x3, H = hero(f, st, { pace: 0.55 });
  paper(f, S, flatTop(f), () => { ctx.fillStyle = 'rgba(90,60,30,.1)'; for (let i = 0; i < 160; i++) ctx.fillRect(hash(i, 1) * w, hash(i, 2) * h, (1 + 3 * hash(i, 3)) * u, u); });
  if (!H) { nobody(f, S, pen); return tints(f, f.p.light, 0, 0, 0.6); }
  const { sp, q } = H, r = rest(sp), tall = r.top / (r.x1 - r.x0) > 0.62;
  const A = tall ? [w * 0.03, h * 0.12, w * 0.4, h * 0.86] : [w * 0.04, h * 0.1, w * 0.64, h * 0.47], B = tall ? [w * 0.38, h * 0.12, w * 0.75, h * 0.86] : [w * 0.3, h * 0.5, w * 0.95, h * 0.89];
  const k = Math.min(fit(sp, A).k, fit(sp, B).k), T1 = fit(sp, A), T2 = fit(sp, B); T1.k = T2.k = k;
  T1.x = (A[0] + A[2]) / 2 - (r.x0 + r.x1) / 2 * k; T2.x = (B[0] + B[2]) / 2 - (r.x0 + r.x1) / 2 * k;
  const tf = { font: S.font, italic: 1, col: S.accent, tilt: 0.006 };
  // the living animal (shown as bones only once its kind is extinct), then its skeleton in the same stride
  for (const [T, src, i] of [[T1, H.fossil ? null : parts(q), 0], [T2, bones(q), 1]]) {
    if (!src) continue;
    pen.line([[T.x + (r.x0 - 0.3) * k, T.y + u], [T.x + (r.x0 + r.x1) / 2 * k, T.y - u], [T.x + (r.x1 + 0.3) * k, T.y + u]], { a: 0.6, w: 0.8, seed: 3 + i });
    groundShadow(f, pen, S, T, q, { a: 0.4 });
    drawAnimal(f, pen, S, src, T, { q: i ? null : q, seed: 5 + i * 40, passes: i ? 1 : 2, noHatch: false });
  }
  if (n > 0.35) {
    const g = q.legs.find(g => g.near && !g.front), hd = q.head, nd = q.nodes, md = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], L = [];
    L.push({ t: 'skull', p: [hd.x + Math.cos(hd.a) * hd.len * 0.4, hd.y + Math.sin(hd.a) * hd.len * 0.4 + hd.len * 0.25], up: 1 });
    L.push({ t: 'vertebrae', p: [nd[q.iHip + 2].x, nd[q.iHip + 2].y + nd[q.iHip + 2].r * 0.5], up: 1 }, { t: 'pelvis', p: [nd[q.iHip].x, nd[q.iHip].y], up: 1 }, { t: 'tail vertebrae', p: [nd[3].x, nd[3].y], up: 1 });
    L.push({ t: 'ribs', p: [nd[q.iSh - 1].x, nd[q.iSh - 1].y - nd[q.iSh - 1].r * 0.7], up: 0 });
    if (g) L.push({ t: 'femur', p: md(g.pts[0], g.pts[1]), up: 0 }, { t: 'tibia', p: md(g.pts[1], g.pts[2]), up: 0 });
    const bb = bboxAll(mapParts(bones(r.q), T2));
    callouts(f, pen, S, toPx(L, T2), Math.max(tall ? h * 0.06 : h * 0.5, bb[1] - h * 0.03), Math.min(h * 0.965, T2.y + h * 0.065), tall ? w * 0.3 : w * 0.26, tall ? w * 0.76 : w * 0.97, { px: h * 0.031, col: S.accent, acol: S.soft });
  }
  const nx = tall ? w * 0.775 : w * 0.67, nw = w * 0.97 - nx;
  let y = write(ctx, sp.name, nx, h * 0.12, { ...tf, px: Math.min(h * 0.062, nw / (sp.name.length * 0.48)) });
  y = write(ctx, `“${sp.means}”`, nx, y + h * 0.008, { ...tf, px: h * 0.036, col: S.ink });
  if (n > 0.2) y = write(ctx, `Length ${fmtLen(sp)}; ${dietOf(sp)}; found in ${sp.where}; ${fmtAge(sp)} million years ago.`, nx, y + h * 0.012, { ...tf, px: h * 0.03, col: S.ink, maxW: nw, max: 5 });
  if (n > 0.5) write(ctx, sp.fact + (H.fossil ? ' Its kind died out 66 million years ago; the bones remain.' : ''), tall ? nx : w * 0.045, tall ? y + h * 0.03 : h * 0.6, { ...tf, px: h * 0.03, col: S.ink, maxW: tall ? nw : w * 0.24, max: 9 });
  if (n > 0.7 && !tall) write(ctx, 'the same stride, in the bone', w * 0.045, h * 0.56, { ...tf, px: h * 0.028, col: S.soft });
  tints(f, f.p.light, 0, 0, 0.6);
}

const RENDER = { blueprint, chalk: chalkboard, stipple, flip: flipbook, anatomy: anatomyStudy };

// ---------------------------------------------------------------- scenes
const SC = (id, name, desc, tags, opts, params) => ({ id: 'sketch-' + id, name, desc, tags: ['sketch', '2d', ...tags], opts, params });
export const scenes = [
  SC('notebook', 'Field Notebook', 'A pencil page on the lead animal: its name, what the name means, its real length, labelled joints, and a skull and footprint in the margin.', ['notebook', 'stegosaur', 'jurassic', 'family'],
    { style: 'notebook', cast: [{ sp: 'stegosaurus', n: 1, young: 1 }], biome: 'plain', seed: 8, foot: 0.84, frame: 1.25, flyers: 1 }, { stage: 0.42, light: 0.8, detail: 0.45 }),
  SC('blueprint', 'Brachiosaurus Blueprint', 'White lines on blue: elevation and plan on a metre grid, the real length dimensioned, a person for scale.', ['blueprint', 'diagram', 'sauropod', 'jurassic'],
    { style: 'blueprint', sp: 'brachiosaurus' }, { stage: 0.425, x1: 0.3 }),
  SC('chalk', 'Chalkboard Lesson', 'Today’s lesson in chalk: an Ankylosaurus with its parts labelled and a fact to copy down.', ['chalkboard', 'diagram', 'ankylosaur', 'cretaceous'],
    { style: 'chalk', sp: 'ankylosaurus' }, { stage: 0.86, x1: 0.4 }),
  SC('biro', 'Ballpoint Doodle', 'Blue biro on lined school paper: cross-hatched duck-bills on the shore and a little herd walking down the margin.', ['ballpoint', 'doodle', 'ornithopod', 'cretaceous', 'herd', 'coast'],
    { style: 'biro', cast: [{ sp: 'parasaurolophus', n: 3, young: 1 }], biome: 'coast', seed: 12, foot: 0.82, frame: 1.25, flyers: 3 }, { stage: 0.8, x1: 0.55, x2: 0.5, detail: 0.5 }),
  SC('charcoal', 'Charcoal Tyrant', 'Smudged charcoal at dusk: a Tyrannosaurus stops among the trees, lifts its head and calls.', ['charcoal', 'theropod', 'cretaceous', 'dusk'],
    { style: 'charcoal', cast: [{ sp: 'tyrannosaurus', n: 1 }], mode: 'wander', biome: 'forest', seed: 6, frame: 0.92, flyers: 0 }, { stage: 0.855, light: 0.3, x1: 0.5, x2: 0.6, x4: 0.55, detail: 0.5 }),
  SC('stipple', 'Stippled Triceratops', 'Dots only, as in a scientific plate: tone from the density of the dots, with a scale bar and a figure caption.', ['stipple', 'illustration', 'ceratopsian', 'cretaceous'],
    { style: 'stipple', sp: 'triceratops' }, { stage: 0.86, x2: 0.55 }),
  SC('flipbook', 'Flip-book Coelophysis', 'A pad of page corners under a thumb: a small Triassic hunter runs, redrawn a little differently eight times a second.', ['flip-book', 'animation', 'theropod', 'triassic', 'run'],
    { style: 'flip', sp: 'coelophysis' }, { stage: 0.1, activity: 0.6, x1: 0.5 }),
  SC('anatomy', 'Anatomical Study', 'Red chalk on tan paper in the manner of a Renaissance study: an Iguanodon walking, and its skeleton in the same stride.', ['red chalk', 'anatomy', 'skeleton', 'ornithopod', 'cretaceous'],
    { style: 'anatomy', sp: 'iguanodon' }, { stage: 0.58, x2: 0.55 }),
  SC('journal', 'Deep-Time Journal', 'An ink-and-wash travel journal that walks through the whole age of dinosaurs; the notes change with whoever is on the page.', ['ink and wash', 'notebook', 'time travel', 'herd'],
    { style: 'wash', cast: 'era', biome: 'floodplain', seed: 3, foot: 0.84, frame: 1.25 }, { stage: 0.2, grow: 0.5, light: 0.7, detail: 0.5 }),
];
