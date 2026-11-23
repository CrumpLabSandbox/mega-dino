// Field Guide: clean animated diagrams, like a museum panel. Paper by day, slate by night. The animals come from
// the rig and are always moving; every number and statement comes from the species data (species.js) or from deep
// time (time.js). Speeds come from the rig's gait() model and are labelled as estimates.
// Scenes 'card', 'size' and 'timeline' follow the Era control. The other diagrams keep the species they were
// drawn for at any Era, on purpose.
import { species, WALKERS, SPECIES, alive } from '../species.js';
import { pose, parts, bones, gait } from '../rig.js';
import { flyParts, swimParts } from '../swimfly.js';
import { trace, palette, mapPt } from '../draw.js';
import { clamp, lerp, smooth } from '../util.js';
import { era as eraOf, STAGES, stageOfMa } from '../time.js';

const SANS = 'system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif';
const SERIF = 'Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif';
const PAPER = { bg: [242, 235, 219], panel: [234, 225, 205], ink: [43, 38, 32], ink2: [112, 101, 85], accent: [176, 66, 44], accent2: [36, 108, 124],
  yes: [48, 118, 68], no: [176, 66, 44], bone: [253, 249, 236], boneFar: [205, 194, 166], hole: [60, 52, 44] };
const SLATE = { bg: [28, 34, 42], panel: [37, 45, 55], ink: [236, 231, 218], ink2: [150, 160, 172], accent: [234, 130, 98], accent2: [112, 192, 206],
  yes: [128, 202, 140], no: [234, 130, 98], bone: [240, 233, 212], boneFar: [128, 126, 116], hole: [20, 24, 30] };

// ---------------------------------------------------------------- words and numbers, all from the data
const fmtLen = m => m >= 1 ? `${+m.toFixed(1)} m` : `${Math.round(m * 100)} cm`;
const fmtMass = kg => { if (kg >= 1000) { const t = +(kg / 1000).toFixed(1); return t === 1 ? '1 tonne' : `${t} tonnes`; } return `${kg >= 10 ? Math.round(kg) : +kg.toFixed(1)} kg`; };
const fmtMa = sp => `${sp.ma[0]}–${sp.ma[1]} million years ago`;
const stageName = sp => eraOf(stageOfMa((sp.ma[0] + sp.ma[1]) / 2)).name;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const kmh = sp => Math.round(gait(sp, 1).top * 3.6);
const isBird = s => s.plan === 'bird' || s.plan === 'pbird';

// who to show for a moment in deep time: the walkers alive then. If the guide has nobody dated to that moment,
// the nearest in time are shown and `exact` is false (the scenes say so).
function aliveAt(f) {
  const ma = f.era.ma, pool = f.era.dinos < 0.5 ? WALKERS.filter(isBird) : WALKERS;
  for (const slack of [2, 6, 12, 25, 60, 300]) {
    const list = pool.filter(s => alive(s, ma, slack));
    if (list.length) return { list, exact: slack === 2 };
  }
  return { list: pool.length ? pool : WALKERS, exact: false };
}

// bounding box of an animal at rest, in metres (cached): for framing and centring so it doesn't jitter as it walks
const EXT = new Map();
function bbox(list) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  const add = (x, y, r = 0) => { x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r); };
  for (const q of list) { if (q.c) add(q.c[0], q.c[1], q.c[2]); else for (const v of q.p || q.l) add(v[0], v[1]); }
  return { x0, x1, y0, y1 };
}
function ext(sp) {
  let e = EXT.get(sp.id);
  if (!e) { e = bbox(parts(pose(sp, { phase: 0.1 }))); e.y0 = 0; EXT.set(sp.id, e); }
  return e;
}
// the same for flyers and swimmers, over a whole wing beat or tail stroke (their origin is mid-body, so y0 < 0)
function extMoving(sp, make) {
  let e = EXT.get(sp.id);
  if (!e) { const all = []; for (let i = 0; i < 10; i++) all.push(...make(i * 0.137 * (sp.kind === 'fly' ? Math.sqrt(Math.max(0.3, sp.span)) : 3))); e = bbox(all); EXT.set(sp.id, e); }
  return e;
}

// draw.js drawParts() sets globalAlpha back to 1 after every part, so an animal cannot be faded through it.
// This is the same painter with a base alpha `A` that it keeps to.
function drawParts(ctx, list, T, look = {}, A = 1) {
  const pal = look.pal || {}, lw = look.lw ?? 0;
  ctx.lineJoin = ctx.lineCap = 'round';
  for (const q of list) {
    const col = pal[q.t];
    if (col == null && !look.stroke) continue;
    ctx.globalAlpha = A * (q.k === 'mark' && q.t === 'mark' ? 0.55 : 1);
    ctx.beginPath(); trace(ctx, q, T);
    if (q.l) { ctx.strokeStyle = col || look.stroke; ctx.lineWidth = Math.max(0.6, q.w * T.k); ctx.stroke(); continue; }
    if (col != null) { ctx.fillStyle = col; ctx.fill(); }
    if (look.stroke && lw > 0 && q.k !== 'mark' && q.k !== 'belly') { ctx.globalAlpha = A; ctx.strokeStyle = look.stroke; ctx.lineWidth = lw; ctx.stroke(); }
    if (q.k === 'eye' && look.pupil !== false) { ctx.beginPath(); ctx.arc(T.x + q.c[0] * T.k * T.dir, T.y - q.c[1] * T.k, Math.max(0.4, q.c[2] * T.k * 0.5), 0, 6.2832); ctx.fillStyle = '#14110c'; ctx.fill(); }
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- the drawing kit for one frame
function kit(f) {
  const { ctx, w: W, h: H } = f, p = f.p;
  const u = Math.min(H / 540, W / 960), small = u < 0.62, fu = u * (small ? 1.5 : 1);
  const night = 1 - smooth(0.2, 0.36, p.light);
  const col = {}; for (const k in PAPER) col[k] = PAPER[k].map((v, i) => lerp(v, SLATE[k][i], night));
  const c = (k, a = 1) => { const v = col[k] || k; return a >= 1 ? `rgb(${v[0] | 0},${v[1] | 0},${v[2] | 0})` : `rgba(${v[0] | 0},${v[1] | 0},${v[2] | 0},${a})`; };
  const G = { f, ctx, W, H, u, fu, small, night, c, m: 40 * u, t: f.t, pace: 0.35 + 1.3 * p.x1, labels: p.x2, grid: p.x3, ink: p.x4,
    live: 0.4 + 1.2 * clamp(p.activity), zoom: 0.8 + 0.4 * p.scale };
  G.mix = (k0, k1, t) => `rgb(${col[k0].map((v, i) => lerp(v, col[k1][i], t) | 0).join(',')})`;
  G.font = (size, o = {}) => `${o.it ? 'italic ' : ''}${o.b ? (o.b === true ? 600 : o.b) : 400} ${Math.max(1, size * fu).toFixed(2)}px ${o.serif ? SERIF : SANS}`;
  // one line of text. o: { c: colour key, a: alpha, al: align, b: bold, it: italic, serif, ls: letter spacing (caps), max: shrink to this width }
  G.text = (s, x, y, size, o = {}) => {
    if (o.minor && small) return 0;
    s = o.ls ? String(s).toUpperCase() : String(s);
    ctx.font = G.font(size, o);
    if ('letterSpacing' in ctx) ctx.letterSpacing = o.ls ? `${(o.ls * fu).toFixed(2)}px` : '0px';
    let wd = ctx.measureText(s).width;
    if (o.max && wd > o.max) { ctx.font = G.font(size * o.max / wd, o); wd = o.max; }
    ctx.textAlign = o.al || 'left'; ctx.textBaseline = o.base || 'alphabetic';
    ctx.fillStyle = c(o.c || 'ink', o.a ?? 1); ctx.fillText(s, x, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    return wd;
  };
  G.width = (s, size, o = {}) => { ctx.font = G.font(size, o); if ('letterSpacing' in ctx) ctx.letterSpacing = o.ls ? `${(o.ls * fu).toFixed(2)}px` : '0px'; const wd = ctx.measureText(o.ls ? s.toUpperCase() : s).width; if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'; return wd; };
  // wrapped text; returns the y of the line after the last one
  G.wrap = (s, x, y, maxW, size, o = {}) => {
    if (o.minor && small) return y;
    ctx.font = G.font(size, o); if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    const lh = size * fu * (o.lh || 1.38), lines = []; let line = '';
    for (const word of String(s).split(' ')) { const t = line ? line + ' ' + word : word; if (line && ctx.measureText(t).width > maxW) { lines.push(line); line = word; } else line = t; }
    if (line) lines.push(line);
    if (o.lines && lines.length > o.lines) { lines.length = o.lines; lines[o.lines - 1] = lines[o.lines - 1].replace(/[\s,.;:]+\S*$/, '') + '…'; }
    ctx.textAlign = o.al || 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = c(o.c || 'ink', o.a ?? 1);
    for (const l of lines) { ctx.fillText(l, x, y); y += lh; }
    return y;
  };
  G.line = (x0, y0, x1, y1, k = 'ink', a = 0.3, lw = 1) => { ctx.strokeStyle = c(k, a); ctx.lineWidth = Math.max(0.5, lw * u); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
  G.look = sp => ({ pal: palette(sp, { light: 1 - 0.08 * night }), stroke: G.ink > 0.03 ? `rgba(${night > 0.5 ? '8,10,14' : '48,36,24'},${0.25 + 0.5 * G.ink})` : null, lw: Math.max(0.5, 1.5 * G.ink * u) });
  return G;
}

// background, title line and the note at the bottom
function chrome(G, title, right, note) {
  const { ctx, W, H, u, m } = G;
  ctx.globalAlpha = 1; ctx.fillStyle = G.c('bg'); ctx.fillRect(0, 0, W, H);
  G.text(title, m, 31 * u, 12.5, { b: 700, ls: 1.6 });
  if (right) G.text(right, W - m, 31 * u, 11.5, { c: 'ink2', al: 'right', minor: true });
  G.line(m, 42 * u, W - m, 42 * u, 'ink', 0.55, 1);
  if (note) G.text(note, m, H - 17 * u, 10.5, { c: 'ink2', minor: true, max: W - 2 * m });
}

// how a walker moves while it walks on the spot: stride phase from its own gait, a slow turn of the head, tail sway
function moving(G, sp, seed = 0, run = 0) {
  const g = gait(sp, run), t = G.t;
  return { phase: t * G.pace * g.speed / g.stride + seed * 0.37, run, t: t + seed * 7,
    headTo: run ? 0.1 : G.live * (0.2 * Math.sin(t * 0.43 + seed * 2.1) + 0.1 * Math.sin(t * 0.91 + seed)),
    look: G.live * 0.09 * Math.sin(t * 0.7 + seed * 1.3), jaw: clamp((Math.sin(t * 0.33 + seed * 3) - 0.9) * 9) * (run ? 0.3 : 0.8) };
}
// draw a walker centred on cx with its feet on gy. Returns its pose and transform.
function walker(G, sp, cx, gy, k, a, o = {}) {
  const { ctx } = G, e = ext(sp), dir = o.dir || 1, T = { x: cx - (e.x0 + e.x1) / 2 * k * dir, y: gy, k, dir };
  const q = pose(sp, a), alpha = o.alpha ?? 1;
  if (alpha <= 0.01) return { q, T };
  if (o.shadow !== false) { ctx.fillStyle = G.c('ink', 0.1 * alpha); ctx.beginPath(); ctx.ellipse(cx, gy + 1.5 * G.u, (e.x1 - e.x0) * k * 0.36, Math.max(1, (e.x1 - e.x0) * k * 0.025), 0, 0, 6.2832); ctx.fill(); }
  drawParts(ctx, o.bones ? bones(q) : parts(q), T, o.look || G.look(sp), alpha);
  return { q, T };
}
// steps through n things, `period` seconds each: i now, u 0..1 through it, a = fade in and out
function stepper(G, n, period) {
  const x = G.t * G.pace / period + 0.5, i = Math.floor(x), u = x - i;
  return { i: ((i % n) + n) % n, j: (((i + 1) % n) + n) % n, u, a: smooth(0, 0.04, u) * (1 - smooth(0.96, 1, u)) };
}
// a 1.8 m person, as a plain scale figure, feet at (x, gy)
function human(G, x, gy, k, a = 0.5) {
  const { ctx } = G, P = (px, py) => [x + px * k, gy - py * k];
  ctx.fillStyle = ctx.strokeStyle = G.mix('bg', 'ink2', a); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const seg = (a0, b0, wd) => { ctx.lineWidth = Math.max(0.6, wd * k); ctx.beginPath(); ctx.moveTo(...P(...a0)); ctx.lineTo(...P(...b0)); ctx.stroke(); };
  seg([-0.09, 0.9], [-0.1, 0.07], 0.14); seg([0.09, 0.9], [0.1, 0.07], 0.14);
  seg([-0.22, 1.42], [-0.27, 0.86], 0.09); seg([0.22, 1.42], [0.27, 0.86], 0.09);
  ctx.beginPath(); ctx.moveTo(...P(-0.2, 1.48)); ctx.lineTo(...P(0.2, 1.48)); ctx.lineTo(...P(0.16, 0.86)); ctx.lineTo(...P(-0.16, 0.86)); ctx.closePath(); ctx.fill();
  ctx.lineWidth = Math.max(0.5, 0.06 * k); ctx.stroke();
  ctx.beginPath(); ctx.arc(...P(0, 1.675), Math.max(0.6, 0.125 * k), 0, 6.2832); ctx.fill();
}
// a scale bar no longer than maxPx, labelled in metres
function scaleBar(G, x, y, k, maxPx, al = 'left') {
  let L = 0.1; for (const v of [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50]) if (v * k <= maxPx) L = v;
  const wd = L * k, x0 = al === 'right' ? x - wd : x, t = 3.5 * G.u;
  G.line(x0, y, x0 + wd, y, 'ink', 0.8, 1.2); G.line(x0, y - t, x0, y + t, 'ink', 0.8, 1.2); G.line(x0 + wd, y - t, x0 + wd, y + t, 'ink', 0.8, 1.2);
  G.text(fmtLen(L), x0 + wd / 2, y - 6 * G.u, 10.5, { al: 'center', c: 'ink2', minor: true });
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
const eraLine = f => `${f.era.ma >= 100 ? Math.round(f.era.ma) : +f.era.ma.toFixed(1)} million years ago · ${f.era.name}`;

// ---------------------------------------------------------------- 1. species card
function card(G) {
  const { ctx, W, H, u, fu, m, f } = G, { list, exact } = aliveAt(f);
  const st = stepper(G, list.length, 9), sp = list[st.i], e = ext(sp);
  chrome(G, 'Species card', eraLine(f), exact ? 'Follows the Era control: these are the species in the guide that were alive at that time.'
    : 'No species in this guide is dated to exactly this moment: these are the nearest in time.');
  const px0 = m, px1 = W * 0.565, py0 = 56 * u, py1 = H - 40 * u, gy = py0 + (py1 - py0) * 0.74;
  ctx.fillStyle = G.c('panel'); roundRect(ctx, px0, py0, px1 - px0, py1 - py0, 6 * u); ctx.fill();
  if (G.grid > 0.02) { ctx.save(); roundRect(ctx, px0, py0, px1 - px0, py1 - py0, 6 * u); ctx.clip();
    for (let x = px0 + 24 * u; x < px1; x += 24 * u) G.line(x, py0, x, gy, 'ink', 0.09 * G.grid, 1);
    for (let y = gy - 24 * u; y > py0; y -= 24 * u) G.line(px0, y, px1, y, 'ink', 0.09 * G.grid, 1); ctx.restore(); }
  G.line(px0 + 14 * u, gy, px1 - 14 * u, gy, 'ink', 0.5, 1);
  const k = Math.min((px1 - px0) * 0.84 / (e.x1 - e.x0), (gy - py0 - 26 * u) / e.y1) * Math.min(1.1, G.zoom);
  walker(G, sp, (px0 + px1) / 2, gy, k, moving(G, sp, st.i), { alpha: st.a });
  ctx.globalAlpha = st.a; scaleBar(G, px0 + 18 * u, py1 - 16 * u, k, (px1 - px0) * 0.3); ctx.globalAlpha = 1;
  // which one of how many
  const n = list.length, dx = Math.min(9 * u, (px1 - px0) * 0.45 / n);
  for (let i = 0; i < n; i++) { ctx.fillStyle = G.c(i === st.i ? 'accent' : 'ink', i === st.i ? 1 : 0.25); ctx.beginPath(); ctx.arc(px1 - 18 * u - (n - 1 - i) * dx, py1 - 16 * u, (i === st.i ? 2.6 : 1.7) * u, 0, 6.2832); ctx.fill(); }
  // the text column
  const x0 = W * 0.6, x1 = W - m, cw = x1 - x0; let y = py0 + 16 * fu;
  ctx.globalAlpha = st.a;
  G.text(`${sp.group} · ${isBird(sp) ? 'a living kind of dinosaur' : 'dinosaur'}`, x0, y, 10.5, { c: 'accent', b: 700, ls: 1.3, max: cw }); y += 36 * fu;
  G.text(sp.name, x0, y, 33, { serif: true, it: true, max: cw }); y += 24 * fu;
  G.text(`“${sp.means}”`, x0, y, 15, { serif: true, c: 'ink2', max: cw }); y += 14 * fu;
  G.line(x0, y, x1, y, 'ink', 0.3, 1); y += 20 * fu;
  const lab = 62 * fu, row = (name, val) => { G.text(name, x0, y, 9.5, { c: 'ink2', b: 700, ls: 1.1 }); y = G.wrap(val, x0 + lab, y, cw - lab, 12.5, { lh: 1.3 }) + 5 * fu; };
  row('Length', fmtLen(sp.len)); row('Mass', `about ${fmtMass(sp.mass)} (an estimate)`);
  row('When', `${fmtMa(sp)}, ${stageName(sp)}`); row('Where', sp.where); row('Diet', cap(sp.diet));
  y += 1 * fu; G.line(x0, y, x1, y, 'ink', 0.3, 1); y += 21 * fu;
  if (G.labels > 0.25) y = G.wrap(sp.fact, x0, y, cw, 13.5, { serif: true, minor: true, lh: 1.42 }) + 6 * fu;
  if (G.labels > 0.6 && y < py1 - 4 * u) G.wrap(sp.known === 'colour' ? 'This colouring is known from fossil pigment.' : 'Colours and pattern here are a guess.', x0, y, cw, 10.5, { c: 'ink2', it: true, minor: true });
  // when it lived, on a strip of the whole age of dinosaurs
  if (!G.small && G.labels > 0.15) { const by = py1 - 30 * u, bh = 7 * u, X = v => x0 + (MA0 - clamp(v, MA1, MA0)) / (MA0 - MA1) * cw;
    PERIODS.forEach(([name, a, b], i) => { ctx.fillStyle = G.c('ink', 0.1 + 0.07 * (i % 2)); ctx.fillRect(X(a), by, X(b) - X(a), bh);
      if (i < 3) G.text(name, (X(a) + X(b)) / 2, by + bh + 12 * u, 9, { al: 'center', c: 'ink2', ls: 1.1 }); });
    ctx.fillStyle = G.c('accent'); const bx = X(sp.ma[0]), bw = Math.max(3 * u, X(sp.ma[1]) - bx); ctx.fillRect(bx, by - 2 * u, bw, bh + 4 * u);
    G.line(X(66), by - 5 * u, X(66), by + bh + 3 * u, 'ink', 0.8, 1);
    G.text('impact', X(66), by - 9 * u, 9, { al: 'center', c: 'ink2', ls: 1.1 }); }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- 2. size chart
function sizeChart(G) {
  const { ctx, W, H, u, fu, m, f } = G, { list, exact } = aliveAt(f);
  const order = [...list].sort((a, b) => a.len - b.len), st = stepper(G, order.length, 8), sp = order[st.i], nx = order[st.j];
  chrome(G, 'Size chart', eraLine(f), (exact ? 'Species alive at the chosen Era, smallest to largest.' : 'Nobody in this guide is dated to exactly this moment: the nearest in time, smallest to largest.') + ' The person is 1.8 m tall.');
  const x0 = m + 26 * u, x1 = W - m, y0 = 112 * u, gy = H - 62 * u, lead = 2.6;             // metres kept for the person on the left
  const fit = s => { const e = ext(s); return Math.min((x1 - x0) / (lead + (e.x1 - e.x0) * 1.06), (gy - y0 - 22 * u) / Math.max(2.4, e.y1 * 1.08)); };
  const k = Math.exp(lerp(Math.log(fit(sp)), Math.log(fit(nx)), smooth(0.86, 1, st.u)));
  // metre grid: finer lines fade in as there is room for them
  if (G.grid > 0.02) for (const [stepM, a] of [[1, 0.1], [5, 0.16], [10, 0.22]]) {
    const vis = a * G.grid * 2 * smooth(5 * u, 13 * u, stepM * k); if (vis < 0.004) continue;
    for (let x = 0; x0 + x * k <= x1 + 0.5; x += stepM) G.line(x0 + x * k, y0, x0 + x * k, gy, 'ink', vis, 1);
    for (let y = stepM; gy - y * k >= y0 - 0.5; y += stepM) G.line(x0, gy - y * k, x1, gy - y * k, 'ink', vis, 1);
  }
  let lstep = 1; for (const v of [1, 2, 5, 10, 20]) { lstep = v; if (v * k >= 34 * fu) break; }
  for (let x = 0; x0 + x * k <= x1; x += lstep) { G.line(x0 + x * k, gy, x0 + x * k, gy + 4 * u, 'ink', 0.6, 1); G.text(x ? `${x} m` : '0', x0 + x * k, gy + 16 * u, 10, { al: 'center', c: 'ink2', minor: true }); }
  for (let y = lstep; gy - y * k >= y0; y += lstep) { G.line(x0 - 4 * u, gy - y * k, x0, gy - y * k, 'ink', 0.6, 1); G.text(`${y} m`, x0 - 7 * u, gy - y * k, 10, { al: 'right', base: 'middle', c: 'ink2', minor: true }); }
  G.line(x0, gy, x1, gy, 'ink', 0.75, 1.2); G.line(x0, y0, x0, gy, 'ink', 0.4, 1);
  // the person and the animal
  human(G, x0 + 1.1 * k, gy, k, 0.62);
  G.line(x0 + 1.75 * k, gy - 1.8 * k, x0 + 1.75 * k, gy, 'accent2', 0.9, 1); G.line(x0 + 1.6 * k, gy - 1.8 * k, x0 + 1.9 * k, gy - 1.8 * k, 'accent2', 0.9, 1);
  if (1.8 * k > 20 * fu) G.text('1.8 m', x0 + 1.75 * k + 4 * u, gy - 0.9 * k, 10.5, { c: 'accent2', base: 'middle', minor: true });
  const e = ext(sp), ax = x0 + (lead + (e.x1 - e.x0) / 2) * k;
  walker(G, sp, ax, gy, k, moving(G, sp, st.i), { alpha: st.a });
  ctx.globalAlpha = st.a;
  const dy = gy - e.y1 * k - 10 * u, d0 = x0 + lead * k, d1 = d0 + (e.x1 - e.x0) * k;
  G.line(d0, dy, d1, dy, 'accent', 0.9, 1); G.line(d0, dy - 4 * u, d0, dy + 4 * u, 'accent', 0.9, 1); G.line(d1, dy - 4 * u, d1, dy + 4 * u, 'accent', 0.9, 1);
  G.text(fmtLen(sp.len), (d0 + d1) / 2, dy - 5 * u, 11.5, { al: 'center', c: 'accent', b: 700 });
  const wn = G.text(sp.name, m, 76 * u, 26, { serif: true, it: true, max: W * 0.5 });
  G.text(`“${sp.means}”`, m + wn + 12 * fu, 76 * u, 13.5, { serif: true, c: 'ink2', minor: true });
  G.text(`${fmtLen(sp.len)} long · about ${fmtMass(sp.mass)} (an estimate) · ${sp.group}`, m, 96 * u, 12, { c: 'ink2', minor: true });
  ctx.globalAlpha = 1;
  G.text(`${st.i + 1} of ${order.length}`, W - m, 76 * u, 12, { al: 'right', c: 'ink2' });
}

// ---------------------------------------------------------------- 3. line-up, everything to one scale
function lineup(G) {
  const { W, H, u, fu, m, f } = G, rows = (f.opts.rows || [['velociraptor', 'stegosaurus', 'tyrannosaurus']]).map(r => r.map(species).sort((a, b) => a.len - b.len));
  chrome(G, f.opts.title || 'Line-up', 'all to one scale', 'Lengths from the species data. These species lived at different times and places: the row is for comparing size.');
  const x0 = m, x1 = W - m, gap = 1.2, minW = (G.labels > 0.2 && !G.small ? 78 : 22) * fu, lead = 14 * u + 2.2;
  // one scale for every row: the largest that lets the widest row fit, with room for each name
  const solve = r => { let k = (x1 - x0) / r.reduce((s, sp) => s + (ext(sp).x1 - ext(sp).x0) + gap, 3);
    for (let it = 0; it < 8; it++) { let fixed = 0, flex = 3; for (const sp of r) { const wd = ext(sp).x1 - ext(sp).x0 + gap; if (wd * k < minW) fixed += minW; else flex += wd; } k = (x1 - x0 - fixed) / flex; }
    return k; };
  const k = Math.min(...rows.map(solve)), nR = rows.length;
  const tall = rows.map(r => Math.max(...r.map(sp => ext(sp).y1)) * k), top = 58 * u, bot = H - 44 * u, labH = 32 * fu;
  const spare = Math.max(0, bot - top - tall.reduce((s, v) => s + v + labH, 0)) / (nR + 1);
  let y = top;
  rows.forEach((r, ri) => {
    y += spare + tall[ri]; const gy = y; y += labH;
    const widths = r.map(sp => Math.max(minW, (ext(sp).x1 - ext(sp).x0 + gap) * k)), total = widths.reduce((s, v) => s + v, 0) + 3 * k;
    let x = x0 + (x1 - x0 - total) / 2;
    G.line(x0, gy, x1, gy, 'ink', 0.6, 1);
    if (G.grid > 0.02) for (let i = 0; x0 + i * k < x1; i++) if (i % 5 === 0 || k > 7 * u) G.line(x0 + i * k, gy, x0 + i * k, gy + (i % 5 ? 2.5 : 5) * u, 'ink', (i % 5 ? 0.35 : 0.6) * Math.min(1, G.grid * 2), 1);
    if (ri === nR - 1) { human(G, x + 1.1 * k, gy, k, 0.62); if (!G.small && G.labels > 0.2) G.text('1.8 m', x + 1.1 * k, gy + 15 * fu, 10, { al: 'center', c: 'ink2' }); }
    x += 3 * k;
    r.forEach((sp, i) => {
      const cx = x + widths[i] / 2; x += widths[i];
      walker(G, sp, cx, gy, k, moving(G, sp, i + ri * 5));
      if (G.labels > 0.2) { G.text(sp.name, cx, gy + 15 * fu, 11, { al: 'center', serif: true, it: true, max: widths[i] - 4 * u, minor: true }); G.text(fmtLen(sp.len), cx, gy + 28 * fu, 10, { al: 'center', c: 'accent', b: 700, minor: true }); }
    });
  });
  scaleBar(G, x1, 62 * u + 8 * fu, k, 140 * u, 'right');
}

// ---------------------------------------------------------------- 4. timeline of the Mesozoic
const MA0 = 237, MA1 = 56;
const TL = [
  ['Theropods', s => s.group === 'theropod', [186, 88, 60]],
  ['Birds', s => s.group === 'bird', [44, 142, 152]],
  ['Sauropods and kin', s => s.group === 'sauropod' || s.group === 'sauropodomorph', [112, 140, 70]],
  ['Ornithopods and kin', s => s.group === 'ornithopod' || s.group === 'ornithischian', [76, 122, 178]],
  ['Armoured dinosaurs', s => ['stegosaur', 'ankylosaur', 'thyreophoran'].includes(s.group), [142, 108, 158]],
  ['Horned, dome-headed', s => s.group === 'ceratopsian' || s.group === 'pachycephalosaur', [196, 148, 48]],
  ['Pterosaurs *', s => s.group === 'pterosaur', [136, 136, 136], 1],
  ['Marine reptiles *', s => s.group === 'marine reptile', [136, 136, 136], 1],
].map(([name, test, col, hollow]) => {
  const list = SPECIES.filter(test).sort((a, b) => b.ma[0] - a.ma[0]), ends = [], bars = [];
  for (const sp of list) { let l = ends.findIndex(e => e > sp.ma[0] + 5); if (l < 0) l = ends.length; ends[l] = sp.ma[1]; bars.push({ sp, lane: l }); }
  return { name, col, hollow, bars, lanes: ends.length };
});
const PERIODS = [['Triassic', 237, 201.4], ['Jurassic', 201.4, 145], ['Cretaceous', 145, 66], ['after', 66, 56]];   // boundaries as in time.js
function timeline(G) {
  const { ctx, W, H, u, fu, m, f } = G, ma = f.era.ma, birdsOnly = f.era.dinos < 0.5;
  chrome(G, 'Timeline of the age of dinosaurs', 'one bar for each species · * not dinosaurs');
  const gut = (G.small ? 0 : 126) * u, x0 = m + gut, x1 = W - m, X = v => x0 + (MA0 - v) / (MA0 - MA1) * (x1 - x0);
  const yP = 52 * u, hP = 20 * u, yA = yP + hP, y0 = yA + 20 * u, y1 = H * 0.665;
  const here = s => alive(s, ma, 1) && !(birdsOnly && !isBird(s));
  // periods and the axis in millions of years
  PERIODS.forEach(([name, a, b], i) => {
    ctx.fillStyle = G.c(i === 3 ? 'accent' : 'ink', i === 3 ? 0.14 : 0.07 + 0.05 * (i % 2)); ctx.fillRect(X(a), yP, X(b) - X(a), hP);
    ctx.fillStyle = G.c('ink', 0.03 + 0.025 * (i % 2)); ctx.fillRect(X(a), yA, X(b) - X(a), y1 - yA);
    G.text(name, (X(a) + X(b)) / 2, yP + hP / 2 + 0.5 * u, i === 3 ? 9 : 10.5, { al: 'center', base: 'middle', b: 700, ls: i === 3 ? 0.4 : 1.6, max: X(b) - X(a) - 4 * u });
  });
  for (let v = 225; v >= 60; v -= 25) { G.line(X(v), yA, X(v), yA + 4 * u, 'ink', 0.6, 1); if (G.grid > 0.02) G.line(X(v), yA + 4 * u, X(v), y1, 'ink', 0.1 * Math.min(1, G.grid * 2), 1);
    G.text(String(v), X(v), yA + 14 * u, 9.5, { al: 'center', c: 'ink2', minor: true }); }
  G.text('million years ago', x0 - 8 * u, yA + 14 * u, 9.5, { al: 'right', c: 'ink2', minor: true });
  // the bars
  const rows = TL.reduce((s, g) => s + g.lanes, 0), rh = (y1 - y0) / (rows + (TL.length - 1) * 0.55), bh = Math.max(1.5, rh * 0.62);
  let y = y0; const named = [];
  for (const g of TL) {
    if (!G.small) G.text(g.name, x0 - 8 * u, y + g.lanes * rh / 2, 10.5, { al: 'right', base: 'middle', c: g.hollow ? 'ink2' : 'ink' });
    ctx.fillStyle = G.c(g.col); ctx.fillRect(x0 - 4 * u, y + rh * 0.15, 2 * u, g.lanes * rh - rh * 0.3);
    for (const b of g.bars) {
      const bx = X(b.sp.ma[0]), bw = Math.max(3.5 * u, X(Math.max(MA1, b.sp.ma[1])) - bx), by = y + b.lane * rh + (rh - bh) / 2, on = here(b.sp);
      if (g.hollow) { ctx.strokeStyle = G.c(on ? 'ink' : g.col, on ? 1 : 0.9); ctx.lineWidth = Math.max(0.6, u); ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1); }
      else { ctx.fillStyle = G.c(g.col, on ? 1 : 0.62); ctx.fillRect(bx, by, bw, bh);
        if (on) { ctx.strokeStyle = G.c('ink'); ctx.lineWidth = Math.max(0.6, 1.1 * u); ctx.strokeRect(bx, by, bw, bh); } }
      if (on) named.push({ sp: b.sp, x: bx + bw, x0: bx, y: by + bh / 2 });
    }
    y += (g.lanes + 0.55) * rh;
  }
  // the impact and the cursor
  const xi = X(66), xc = X(clamp(ma, MA1, MA0));
  ctx.setLineDash([4 * u, 3 * u]); G.line(xi, yP, xi, y1 + 4 * u, 'accent', 0.95, 1.4); ctx.setLineDash([]);
  if (!G.small) { ctx.fillStyle = G.c('bg'); ctx.fillRect(xi - 9 * u, yA + 6 * u, 18 * u, 11 * u); G.text('66', xi, yA + 14 * u, 9.5, { al: 'center', c: 'accent', b: 700 });
    ctx.save(); ctx.translate(xi + 11 * u, y0 + (y1 - y0) * 0.62); ctx.rotate(-Math.PI / 2); G.text('the impact', 0, 0, 9.5, { al: 'center', c: 'accent', b: 700, ls: 1.4 }); ctx.restore(); }
  G.line(xc, yP - 4 * u, xc, y1 + 4 * u, 'ink', 0.9, 1.4);
  ctx.fillStyle = G.c('ink'); ctx.beginPath(); ctx.moveTo(xc - 5 * u, yP - 7 * u); ctx.lineTo(xc + 5 * u, yP - 7 * u); ctx.lineTo(xc, yP); ctx.closePath(); ctx.fill();
  // names of the bars under the cursor, where there is room
  if (G.labels > 0.3 && !G.small) { const placed = [];
    for (const nm of named) { const wd = G.width(nm.sp.name, 9.5, { it: true }) + 8 * u; let lx = nm.x + 4 * u, al = 'left';
      if (lx + wd > x1) { lx = nm.x0 - 4 * u; al = 'right'; }
      const r = al === 'left' ? [lx, lx + wd] : [lx - wd, lx];
      if (placed.some(p => Math.abs(p.y - nm.y) < 9.5 * fu && p.r[0] < r[1] && r[0] < p.r[1])) continue;
      placed.push({ y: nm.y, r });
      ctx.fillStyle = G.c('bg', 0.82); ctx.fillRect(r[0] - 1 * u, nm.y - 5.5 * fu, wd, 11 * fu);
      G.text(nm.sp.name, lx, nm.y + 0.5 * u, 9.5, { al, base: 'middle', it: true }); } }
  // who was alive at the cursor, walking along the bottom
  const sy0 = y1 + 12 * u, gy = H - 40 * u, walkers = WALKERS.filter(here).sort((a, b) => a.len - b.len);
  G.line(m, gy, W - m, gy, 'ink', 0.5, 1);
  const maTxt = `${ma >= 100 ? Math.round(ma) : +ma.toFixed(1)} million years ago`;
  G.text(`${f.era.name} · ${maTxt}`, m, sy0 + 9 * u, 11.5, { b: 700, minor: true });
  if (!walkers.length) { G.text(birdsOnly ? 'After the impact only the birds are left. None in this guide is dated to this moment.' : 'No walking species in this guide is dated to this moment.', W / 2, (sy0 + gy) / 2 + 6 * u, 13, { al: 'center', serif: true, it: true, c: 'ink2', max: W - 2 * m }); return; }
  G.text(`alive then: ${walkers.length} in this guide · not to scale`, W - m, sy0 + 9 * u, 10.5, { c: 'ink2', al: 'right', minor: true });
  const maxN = Math.round(4 + 6 * f.p.herd), n = Math.min(maxN, walkers.length), show = n === walkers.length ? walkers : Array.from({ length: n }, (_, i) => walkers[Math.round(i * (walkers.length - 1) / (n - 1))]);
  const span = W - 2 * m + 120 * u, sw = span / n, sh = gy - sy0 - 20 * u, drift = G.t * G.pace * 7 * u;
  ctx.save(); ctx.beginPath(); ctx.rect(m, sy0, W - 2 * m, H - sy0); ctx.clip();
  show.forEach((sp, i) => {
    const e = ext(sp), pos = ((((i + 0.5) * sw + drift) % span) + span) % span, cx = m - 60 * u + pos, a = smooth(40 * u, 130 * u, pos) * smooth(40 * u, 130 * u, span - pos);
    const k = Math.min(Math.min(sw * 0.8, 170 * u) / (e.x1 - e.x0), sh / e.y1);
    walker(G, sp, cx, gy, k, moving(G, sp, i), { alpha: a });
    if (G.labels > 0.2) { ctx.globalAlpha = a; G.text(sp.name, cx, gy + 14 * fu, 10.5, { al: 'center', serif: true, it: true, max: sw - 6 * u, minor: true }); G.text(fmtLen(sp.len), cx, gy + 26 * fu, 9.5, { al: 'center', c: 'ink2', minor: true }); ctx.globalAlpha = 1; }
  });
  ctx.restore();
}

// ---------------------------------------------------------------- 5. family tree
const tip = (name, sp, note) => ({ name, sp: species(sp), note });
const node = (name, d, kids) => ({ name, d, kids });
const TREE = node('Dinosauria', 0, [
  node('Ornithischia', 1, [
    node('Thyreophora', 2, [tip('Stegosaurs', 'stegosaurus'), tip('Ankylosaurs', 'ankylosaurus')]),
    node('', 1.55, [tip('Ornithopods', 'parasaurolophus'), node('Marginocephalia', 2.1, [tip('Ceratopsians', 'triceratops'), tip('Pachycephalosaurs', 'pachycephalosaurus')])]),
  ]),
  node('Saurischia', 1, [
    tip('Sauropodomorphs', 'brachiosaurus'),
    node('Theropoda', 2, [tip('Theropods', 'tyrannosaurus'), tip('Birds', 'presbyornis', 'living dinosaurs')]),
  ]),
]);
const LIVING = STAGES[STAGES.length - 1].text.split('. ').pop();      // "Today there are about 11,000 species of living dinosaur."
function tree(G) {
  const { ctx, W, H, u, fu, m } = G;
  chrome(G, 'Family tree of the dinosaurs', 'a simple cladogram · animals not to scale', `Birds are dinosaurs. ${LIVING}`);
  const xr = m + 22 * u, xt = m + (W - 2 * m) * (G.small ? 0.6 : 0.5), top = 68 * u, bot = H - 46 * u, rh = (bot - top - 16 * u) / 8;
  const X = d => xr + (xt - xr) * d / 3.1;
  // lay out: tips get rows, clades sit between their children
  let r = 0; const tips = [], nodes = [];
  const place = (n, par) => { n.par = par;
    if (!n.kids) { n.x = xt; n.y = top + (r + 0.5) * rh + (r > 4 ? 16 * u : 0); n.row = r++; tips.push(n); }
    else { n.kids.forEach(k => place(k, n)); n.x = X(n.d); n.y = (n.kids[0].y + n.kids[n.kids.length - 1].y) / 2; nodes.push(n); } };
  place(TREE, null);
  // it draws itself from the root outwards, holds, then starts again
  const cyc = (((G.t * G.pace / 30 + 0.4) % 1) + 1) % 1, g = smooth(0, 0.3, cyc), fade = 1 - smooth(0.95, 1, cyc), xs = lerp(xr - 20 * u, xt + 4 * u, g);
  const seen = x => smooth(-14 * u, 6 * u, xs - x) * fade;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const branch = (n, k, key, lw) => { ctx.strokeStyle = G.c(key); ctx.lineWidth = Math.max(0.8, lw * u); ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(n.x, k.y); ctx.lineTo(k.x, k.y); ctx.stroke(); };
  ctx.globalAlpha = 0.13; for (const n of nodes) for (const k of n.kids) branch(n, k, 'ink', 1.8);       // a faint ghost of the whole tree is always there
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, xs, H); ctx.clip(); ctx.globalAlpha = fade;
  G.line(xr - 16 * u, TREE.y, xr, TREE.y, 'ink', 1, 1.8);
  for (const n of nodes) for (const k of n.kids) branch(n, k, 'ink', 1.8);
  const birds = tips[tips.length - 1]; branch(birds.par, birds, 'accent2', 2.6);
  ctx.restore();
  for (const n of nodes) { const a = seen(n.x); if (a < 0.01) continue; ctx.globalAlpha = a;
    ctx.fillStyle = G.c('bg'); ctx.beginPath(); ctx.arc(n.x, n.y, 3.6 * u, 0, 6.2832); ctx.fill(); ctx.strokeStyle = G.c('ink'); ctx.lineWidth = Math.max(0.8, 1.6 * u); ctx.stroke();
    if (n.name && G.labels > 0.15) G.text(n.name, n.x + 8 * u, n.y, n.d ? 11.5 : 13, { b: 700, base: 'middle', minor: n.d > 1 }); }
  // an animal and a name at every tip
  const slot = 96 * u;
  for (const n of tips) { const a = Math.max(0.3, seen(n.x));
    const e = ext(n.sp), k = Math.min(slot * 0.92 / (e.x1 - e.x0), rh * 0.8 / e.y1), gy = n.y + rh * 0.36;
    walker(G, n.sp, xt + 10 * u + slot / 2, gy, k, moving(G, n.sp, n.row), { alpha: a });
    ctx.globalAlpha = a; const lx = xt + slot + 24 * u;
    if (n.note) { const wn = G.text(n.name, lx, n.y - 3 * fu, 13.5, { b: 700, c: 'accent2' });
      if (!G.small) { const wd = G.width(n.note, 9, { b: 700, ls: 1.1 }) + 14 * fu; ctx.fillStyle = G.c('accent2'); roundRect(ctx, lx + wn + 10 * fu, n.y - 15 * fu, wd, 16 * fu, 8 * fu); ctx.fill();
        G.text(n.note, lx + wn + 17 * fu, n.y - 6.6 * fu, 9, { b: 700, ls: 1.1, c: 'bg', base: 'middle' }); } }
    else G.text(n.name, lx, n.y - 3 * fu, 13.5, { b: 700, max: W - m - lx });
    if (G.labels > 0.3) G.text(`such as ${n.sp.name}`, lx, n.y + 11 * fu, 11, { serif: true, it: true, c: 'ink2', minor: true });
    ctx.globalAlpha = 1; }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- 6. skin and bone
function skinBone(G) {
  const { ctx, W, H, u, fu, m, f } = G, list = (f.opts.sp || ['tyrannosaurus']).map(species);
  const st = stepper(G, list.length, 14), sp = list[st.i], e = ext(sp);
  chrome(G, 'Skin and bone', 'the same animal, inside and out', 'The skeleton is the rig that moves every animal in Mega-Dino, simplified: a diagram, not a cast of a real fossil.');
  const gy = H * 0.72, top = 124 * u, cx = W / 2;
  const k = Math.min((W - 2 * m - 60 * u) / (e.x1 - e.x0), (gy - top) / e.y1) * Math.min(1.08, G.zoom);
  const a = moving(G, sp, 2), look = G.look(sp);
  G.line(m, gy, W - m, gy, 'ink', 0.5, 1);
  const x0 = cx - (e.x1 - e.x0) * k / 2, x1 = cx + (e.x1 - e.x0) * k / 2, wipe = lerp(x0 - 12 * u, x1 + 12 * u, 0.5 + 0.5 * Math.sin(G.t * G.pace * 0.3 - 1.2));
  // faint skin, the skeleton over it, then the full skin to the left of the wipe line
  const { q, T } = walker(G, sp, cx, gy, k, a, { alpha: 0.2 * st.a });
  const bl = { pal: { bone: G.c('bone'), boneFar: G.c('boneFar'), hole: G.c('hole') }, stroke: G.c('ink', 0.75), lw: Math.max(0.5, 0.9 * u), pupil: false };
  drawParts(ctx, bones(q), T, bl, st.a);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, wipe, H); ctx.clip(); ctx.globalAlpha = 1; ctx.fillStyle = G.c('bg'); ctx.fillRect(x0 - 40 * u, top - 60 * u, wipe - x0 + 40 * u, gy - top + 59 * u);
  drawParts(ctx, parts(q), T, look, st.a); ctx.restore();
  ctx.globalAlpha = 1;
  G.line(wipe, top - 40 * u, wipe, gy + 24 * u, 'accent', 0.9, 1.2);
  G.text('skin', wipe - 7 * u, gy + 22 * u, 10, { al: 'right', c: 'accent', b: 700, ls: 1.2, minor: true }); G.text('bone', wipe + 7 * u, gy + 22 * u, 10, { c: 'accent', b: 700, ls: 1.2, minor: true });
  // labelled bones: anchors move with the animal, the words stay put
  if (G.labels > 0.15 && !G.small) {
    const anchors = qq => { const n = qq.nodes, mid = (i, j, t = 0.5) => [lerp(n[i].x, n[j].x, t), lerp(n[i].y, n[j].y, t)], hd = qq.head, hind = qq.legs.find(l => l.near && !l.front), fore = qq.legs.find(l => l.near && l.front) || qq.arms.find(l => l.near);
      const mp = (p0, p1) => [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2], iM = Math.round((qq.iHip + qq.iSh) / 2);
      const out = [
        ['Tail vertebrae', mid(Math.round(qq.iHip * 0.45), Math.round(qq.iHip * 0.45) + 1), 1],
        ['Hip', [n[qq.iHip].x, hind.pts[0][1] + n[qq.iHip].r * 0.4], 1],
        ['Backbone', [n[iM].x, n[iM].y + n[iM].r * 0.45], 1],
        ['Neck vertebrae', mid(qq.iSh + 3, qq.iSh + 4), 1],
        ['Skull', [hd.x + Math.cos(hd.a) * hd.len * 0.45, hd.y + Math.sin(hd.a) * hd.len * 0.45 + hd.len * 0.12], 1],
        ['Thigh bone', mp(hind.pts[0], hind.pts[1]), 0], ['Shin', mp(hind.pts[1], hind.pts[2]), 0], ['Toes', hind.tip, 0],
        ['Ribs', [n[iM].x + n[iM].r * 0.3, n[iM].y - (n[iM].b || n[iM].r) * 0.7], 0],
      ];
      if (fore) out.push([qq.P.biped ? 'Arm' : 'Front leg', mp(fore.pts[1], fore.pts[2]), 0]);
      return out; };
    const rest = anchors(pose(sp, { phase: 0.1 })), now = anchors(q), TR = { ...T };
    for (const side of [1, 0]) {
      const row = rest.map((r, i) => ({ name: r[0], rx: mapPt(r[1], TR)[0], p: mapPt(now[i][1], T), side: r[2] })).filter(r => r.side === side).sort((p0, p1) => p0.rx - p1.rx);
      const ws = row.map(r => G.width(r.name, 11.5, { b: 600 }) + 18 * u);
      row.forEach((r, i) => { r.lx = clamp(r.rx, m + ws[i] / 2, W - m - ws[i] / 2); });
      for (let i = 1; i < row.length; i++) row[i].lx = Math.max(row[i].lx, row[i - 1].lx + (ws[i] + ws[i - 1]) / 2);
      for (let i = row.length - 1; i >= 0; i--) { row[i].lx = Math.min(row[i].lx, i === row.length - 1 ? W - m - ws[i] / 2 : row[i + 1].lx - (ws[i] + ws[i + 1]) / 2); }
      const ly = side ? 76 * u : H - 58 * u;
      ctx.globalAlpha = st.a * Math.min(1, G.labels * 2);
      for (const r of row) {
        G.line(r.lx, ly + (side ? 6 : -13) * u, r.p[0], r.p[1], 'ink', 0.55, 0.8);
        ctx.fillStyle = G.c('accent'); ctx.beginPath(); ctx.arc(r.p[0], r.p[1], 2.4 * u, 0, 6.2832); ctx.fill();
        G.text(r.name, r.lx, ly, 11.5, { al: 'center', b: 600 });
      }
      ctx.globalAlpha = 1;
    }
  }
  G.text(sp.name, W - m, 64 * u, 17, { al: 'right', serif: true, it: true, a: st.a });
}

// ---------------------------------------------------------------- 7. who is a dinosaur?
function who(G) {
  const { ctx, W, H, u, fu, m, f } = G, ids = f.opts.sp || ['tyrannosaurus', 'ichthyornis', 'pteranodon', 'elasmosaurus'];
  chrome(G, 'Who is a dinosaur?', 'not to scale', 'Pterosaurs and marine reptiles lived alongside the dinosaurs, but they are separate groups of reptiles.');
  const WHY = { walk: 'Dinosaurs hold their legs straight under the body, like a bird or a horse, not out to the sides like a lizard.',
    bird: 'Birds are dinosaurs: the one branch that lived through the impact and is still alive today.',
    pterosaur: 'Pterosaurs are a separate group of flying reptiles. They shared the sky with the dinosaurs.',
    'marine reptile': 'Marine reptiles are separate groups of reptiles that went back to the sea.' };
  const n = ids.length, cw = (W - 2 * m) / n, top = 54 * u, boxH = (H - 100 * u) * 0.44, t = G.t;
  ids.map(species).forEach((sp, i) => {
    const x0 = m + i * cw, cx = x0 + cw / 2, yes = sp.dino, key = yes ? 'yes' : 'no', pad = 14 * u;
    if (i) G.line(x0, top + 6 * u, x0, H - 40 * u, 'ink', 0.25, 1);
    // the verdict
    let y = top + 34 * fu;
    const r = 11 * fu, mx = x0 + pad + r;
    ctx.fillStyle = G.c(key); ctx.beginPath(); ctx.arc(mx, y - 9 * fu, r, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = G.c('bg'); ctx.lineWidth = Math.max(1, 2.4 * fu); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
    if (yes) { ctx.moveTo(mx - 5 * fu, y - 9 * fu); ctx.lineTo(mx - 1.5 * fu, y - 5 * fu); ctx.lineTo(mx + 5.5 * fu, y - 13 * fu); }
    else { ctx.moveTo(mx - 4.5 * fu, y - 13.5 * fu); ctx.lineTo(mx + 4.5 * fu, y - 4.5 * fu); ctx.moveTo(mx + 4.5 * fu, y - 13.5 * fu); ctx.lineTo(mx - 4.5 * fu, y - 4.5 * fu); }
    ctx.stroke();
    G.text(yes ? 'Yes' : 'No', mx + r + 9 * fu, y, 27, { serif: true, c: key, b: 700 });
    // the animal
    const by0 = y + 14 * fu, gy = by0 + boxH, lookS = G.look(sp);
    ctx.fillStyle = G.c('panel'); roundRect(ctx, x0 + pad * 0.6, by0, cw - pad * 1.2, boxH, 6 * u); ctx.fill();
    ctx.save(); roundRect(ctx, x0 + pad * 0.6, by0, cw - pad * 1.2, boxH, 6 * u); ctx.clip();
    if (sp.kind === 'walk') {
      const e = ext(sp), k = Math.min((cw - pad * 2.4) / (e.x1 - e.x0), (boxH - 34 * u) / e.y1) * Math.min(1.05, G.zoom), fy = gy - 16 * u;
      G.line(x0 + pad, fy, x0 + cw - pad, fy, 'ink', 0.45, 1);
      const { q, T } = walker(G, sp, cx, fy, k, moving(G, sp, i));
      // the legs go straight down from the hip
      const hip = mapPt(q.legs.find(l => l.near && !l.front).pts[0], T);
      ctx.setLineDash([3 * u, 3 * u]); G.line(hip[0], hip[1], hip[0], fy, 'yes', 1, 1.4); ctx.setLineDash([]);
      ctx.fillStyle = G.c('yes'); ctx.beginPath(); ctx.arc(hip[0], hip[1], 2.6 * u, 0, 6.2832); ctx.fill();
    } else if (sp.kind === 'fly') {
      const fa = tt => ({ t: tt, glide: isBird(sp) ? 0.15 : 0.6, yaw: isBird(sp) ? 0.45 : 0.7, pitch: isBird(sp) ? 0.55 : 0.75 }), e = extMoving(sp, tt => flyParts(sp, fa(tt)));
      const k = Math.min((cw - pad * 2.4) / (e.x1 - e.x0), (boxH - 22 * u) / (e.y1 - e.y0)) * Math.min(1.05, G.zoom);
      const T = { x: cx - (e.x0 + e.x1) / 2 * k, y: by0 + boxH / 2 + (e.y0 + e.y1) / 2 * k + Math.sin(t * 0.9 + i) * 3 * u, k, dir: 1 };
      drawParts(ctx, flyParts(sp, { ...fa(t * G.pace), jaw: clamp((Math.sin(t * 0.4 + i) - 0.9) * 8) }), T, lookS);
    } else {
      const e = extMoving(sp, tt => swimParts(sp, { t: tt })), k = Math.min((cw - pad * 2.6) / (e.x1 - e.x0), (boxH - 30 * u) / (e.y1 - e.y0)) * Math.min(1.05, G.zoom);
      const T = { x: cx - (e.x0 + e.x1) / 2 * k, y: by0 + boxH / 2 + (e.y0 + e.y1) / 2 * k + Math.sin(t * 0.6 + i) * 3 * u, k, dir: 1 };
      for (let j = 0; j < 4; j++) { const wy = by0 + boxH * (0.14 + 0.24 * j); ctx.strokeStyle = G.c('accent2', 0.2); ctx.lineWidth = Math.max(0.6, u); ctx.beginPath();
        for (let x = x0; x <= x0 + cw; x += 6 * u) { const yy = wy + Math.sin(x / (22 * u) + t * 0.8 + j * 1.7) * 2.2 * u; x === x0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy); } ctx.stroke(); }
      drawParts(ctx, swimParts(sp, { t: t * G.pace, bend: 0.12 * Math.sin(t * 0.35), jaw: clamp((Math.sin(t * 0.4 + i) - 0.9) * 8) }), T, lookS);
    }
    ctx.restore();
    // what it is and why
    y = gy + 26 * fu;
    G.text(sp.name, x0 + pad, y, 18, { serif: true, it: true, max: cw - 2 * pad }); y += 17 * fu;
    G.text(sp.group, x0 + pad, y, 10, { c: key, b: 700, ls: 1.3, max: cw - 2 * pad }); y += 20 * fu;
    if (G.labels > 0.15) y = G.wrap((yes ? 'A dinosaur. ' : 'Not a dinosaur. ') + WHY[sp.kind === 'walk' ? 'walk' : sp.group], x0 + pad, y, cw - 2 * pad, 12, { minor: true, lh: 1.36 });
  });
}

// ---------------------------------------------------------------- 8. speed estimates
function speeds(G) {
  const { ctx, W, H, u, fu, m, f } = G, list = (f.opts.sp || ['gallimimus', 'tyrannosaurus', 'stegosaurus']).map(species).sort((a, b) => kmh(b) - kmh(a));
  chrome(G, 'How fast? Top speed estimates', 'estimates · animals not to scale', 'Estimates only: the top speeds this simulator works out from each animal’s build and leg length. Nobody has measured a dinosaur running.');
  const n = list.length, top = 56 * u, bot = H - 62 * u, lh = (bot - top) / n, xl = m + (G.small ? 0 : 150 * u), xr = W - m - 96 * fu, tw = xr - xl;
  const vmax = Math.ceil(kmh(list[0]) / 10) * 10, X = v => xl + tw * v / vmax;
  // the scale along the bottom
  for (let v = 0; v <= vmax; v += 10) { if (G.grid > 0.02) G.line(X(v), top + 4 * u, X(v), bot, 'ink', 0.13 * Math.min(1, G.grid * 2), 1); G.line(X(v), bot, X(v), bot + 4 * u, 'ink', 0.6, 1);
    G.text(String(v), X(v), bot + 16 * u, 10, { al: 'center', c: 'ink2', minor: true }); }
  G.line(xl, bot, xr, bot, 'ink', 0.6, 1); G.text('km/h', xr + 10 * u, bot + 16 * u, 10, { c: 'ink2', minor: true });
  list.forEach((sp, i) => {
    const gy = top + (i + 1) * lh - 9 * u, v = kmh(sp), g = gait(sp, 1), e = ext(sp);
    const k = Math.min(lh * 0.74 / e.y1, 120 * u / (e.x1 - e.x0));
    // the lane: a bar as long as the speed, then a dotted run-off
    ctx.fillStyle = G.c('accent', 0.2); ctx.fillRect(xl, gy, X(v) - xl, 5 * u);
    ctx.fillStyle = G.c('accent'); ctx.fillRect(X(v) - 1.5 * u, gy - 4 * u, 3 * u, 13 * u);
    ctx.setLineDash([2 * u, 4 * u]); G.line(X(v), gy + 0.5 * u, xr, gy + 0.5 * u, 'ink', 0.35, 1); ctx.setLineDash([]);
    // the runner crosses the lane at a pace in proportion to its speed
    const span = tw + 60 * u, pos = (((G.t * G.pace * g.top * 9 * u + i * 211 * u) % span) + span) % span, cx = xl - 30 * u + pos;
    const a = smooth(40 * u, 130 * u, pos) * smooth(40 * u, 130 * u, span - pos);
    ctx.save(); ctx.beginPath(); ctx.rect(xl - 2 * u, 0, tw + 4 * u, H); ctx.clip();
    ctx.strokeStyle = G.c('ink', 0.22 * a); ctx.lineWidth = Math.max(0.6, u); ctx.lineCap = 'round';
    for (let j = 0; j < 3; j++) { const sx = cx - (e.x1 - e.x0) * k * 0.55 - j * 7 * u, sy = gy - e.y1 * k * (0.3 + 0.2 * j), len = g.top * (2 + j) * u; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - len, sy); ctx.stroke(); }
    walker(G, sp, cx, gy, k, moving(G, sp, i, 1), { alpha: a });
    ctx.restore();
    if (!G.small) { G.text(sp.name, m, gy - lh * 0.36, 14, { serif: true, it: true, max: 142 * u }); G.text(sp.group, m, gy - lh * 0.36 + 14 * fu, 9.5, { c: 'ink2', b: 700, ls: 1.1 }); }
    const wv = G.text(`≈ ${v}`, xr + 12 * fu, gy - lh * 0.3, 22, { serif: true, b: 700, c: 'accent' });
    G.text('km/h', xr + 16 * fu + wv, gy - lh * 0.3, 10.5, { c: 'accent', b: 700 });
    G.text('estimate', xr + 12 * fu, gy - lh * 0.3 + 13 * fu, 9.5, { c: 'ink2', ls: 1.1, minor: true });
  });
}

const VIEWS = { card, size: sizeChart, lineup, timeline, tree, bone: skinBone, who, speed: speeds };

export default {
  id: 'guide',
  name: 'Field Guide',
  kind: '2d',
  sky: false,
  params: [
    { id: 'x1', label: 'Pace', value: 0.5, tip: 'How fast the animals step and the diagrams move on' },
    { id: 'x2', label: 'Labels', value: 1, tip: 'How much is written on the diagram' },
    { id: 'x3', label: 'Grid', value: 0.5, tip: 'Grid lines and tick marks' },
    { id: 'x4', label: 'Ink', value: 0.45, tip: 'Outline around the animals' },
  ],
  create(ctx, opts) {
    const view = VIEWS[opts.view] || card;
    return {
      render(f) {
        const G = kit(f);
        ctx.save(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.setLineDash([]);
        try { view(G); } finally { ctx.restore(); }
      }
    };
  }
};

const S = (id, name, desc, tags, opts, params) => ({ id: 'guide-' + id, name, desc, tags: ['diagram', '2d', ...tags], opts, params });
export const scenes = [
  S('card', 'Species Card', 'One animal at a time with its name, size, time, place, diet and a fact. Drag Era to meet who was alive then.', ['theropod', 'sauropod', 'ceratopsian', 'cretaceous', 'jurassic', 'triassic'],
    { view: 'card' }, { stage: 0.855 }),
  S('size', 'Size Chart', 'Each animal against a 1.8 m person and a metre grid, smallest to largest for the chosen Era.', ['sauropod', 'theropod', 'stegosaur', 'jurassic', 'scale'],
    { view: 'size' }, { stage: 0.43 }),
  S('lineup', 'The Line-up', 'Thirteen dinosaurs to one scale, from Compsognathus to Argentinosaurus. Diagram species: they stay at any Era.', ['sauropod', 'theropod', 'ceratopsian', 'stegosaur', 'ankylosaur', 'scale'],
    { view: 'lineup', title: 'The line-up', rows: [['brachiosaurus', 'diplodocus', 'argentinosaurus'], ['compsognathus', 'velociraptor', 'pachycephalosaurus', 'ankylosaurus', 'stegosaurus', 'triceratops', 'parasaurolophus', 'tyrannosaurus', 'spinosaurus']] }, { stage: 0.855 }),
  S('hunters', 'Hunters to Scale', 'Eleven hunters to one scale, from little Compsognathus to Spinosaurus. Diagram species: they stay at any Era.', ['theropod', 'scale', 'cretaceous', 'jurassic'],
    { view: 'lineup', title: 'Hunters to scale', rows: [['allosaurus', 'tyrannosaurus', 'giganotosaurus', 'spinosaurus'], ['compsognathus', 'velociraptor', 'deinonychus', 'utahraptor', 'ceratosaurus', 'carnotaurus', 'baryonyx']] }, { stage: 0.8 }),
  S('timeline', 'Timeline of the Mesozoic', 'A bar for every species across the Triassic, Jurassic and Cretaceous. The cursor is the Era; whoever was alive walks along the bottom.', ['time travel', 'triassic', 'jurassic', 'cretaceous', 'impact', 'pterosaur', 'marine reptile'],
    { view: 'timeline' }, { stage: 0.03, grow: 0.45 }),
  S('tree', 'Family Tree', 'A cladogram that draws itself: two great branches of dinosaurs, and the one twig still alive. Diagram species stay at any Era.', ['bird', 'theropod', 'sauropod', 'ornithopod', 'ceratopsian', 'stegosaur', 'ankylosaur'],
    { view: 'tree' }, { stage: 0.855 }),
  S('bone', 'Skin and Bone', 'The skeleton inside the animal, with the main bones named, as a wipe passes over it. Diagram species stay at any Era.', ['skeleton', 'theropod', 'stegosaur', 'ceratopsian', 'sauropod'],
    { view: 'bone', sp: ['tyrannosaurus', 'stegosaurus', 'triceratops', 'brachiosaurus'] }, { stage: 0.855 }),
  S('who', 'Who Is a Dinosaur?', 'A dinosaur, a bird, a pterosaur and a marine reptile side by side: yes or no, and why. Diagram species stay at any Era.', ['bird', 'pterosaur', 'marine reptile', 'theropod'],
    { view: 'who', sp: ['tyrannosaurus', 'ichthyornis', 'pteranodon', 'elasmosaurus'] }, { stage: 0.8 }),
  S('speed', 'Speed Estimates', 'Six dinosaurs run their lanes at their estimated top speeds, in km/h. Diagram species stay at any Era.', ['theropod', 'ceratopsian', 'stegosaur', 'sauropod', 'run'],
    { view: 'speed', sp: ['gallimimus', 'velociraptor', 'tyrannosaurus', 'triceratops', 'stegosaurus', 'diplodocus'] }, { stage: 0.82, activity: 0.7 }),
  S('night', 'Night Shift at the Museum', 'The species card on slate, working its way through the Late Jurassic.', ['night', 'jurassic', 'sauropod', 'stegosaur', 'theropod'],
    { view: 'card' }, { stage: 0.43, light: 0.08 }),
];
