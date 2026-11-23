// Vector & Neon: the shared world as light on black. The animals are glowing outlines stroked from the rig's parts,
// and the ground is a wire mesh over the same terrain the other engines paint.
// opts.style: wave (synthwave sunset) · vector (phosphor vector monitor; col 'green' | 'amber') · scope (oscilloscope
// XY beam) · vapor (vaporwave pastel) · glitch (RGB split, tears) · thermal (false-colour heat camera) · laser (laser
// show) use the world; sign (neon tubes on a brick wall) and holo (hologram on a projector) pose one animal directly.
// In a combo the sky stays transparent: glow is added with 'lighter', never as a dark rectangle.
import { createWorld } from '../world.js';
import { trace, drawParts } from '../draw.js';
import { pose, parts, gait } from '../rig.js';
import { species, standIn } from '../species.js';
import { PLANTS } from '../flora.js';
import { clamp, lerp, smooth, hash, fract, buffer, sky } from '../util.js';

const TAU = Math.PI * 2;
const rgbOf = c => { const p = parseInt(c.slice(1), 16); return [p >> 16, p >> 8 & 255, p & 255]; };
const rgba = (c, a = 1) => { const [r, g, b] = typeof c === 'string' ? rgbOf(c) : c; return `rgba(${r | 0},${g | 0},${b | 0},${a})`; };
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
// a species colour pushed to a neon version of itself: full brightness, more saturated
const neon = (c, l = 60, turn = 0) => { const [r, g, b] = rgbOf(c), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn || 1;
  const hh = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return `hsl(${Math.round(hh * 60 + turn + 360) % 360},100%,${l}%)`; };

// false-colour heat palette, 0 cold … 1 hot
const HEAT = [[0, [3, 4, 18]], [0.14, [24, 10, 84]], [0.32, [104, 18, 138]], [0.52, [214, 44, 96]], [0.7, [250, 126, 30]], [0.87, [255, 220, 70]], [1, [255, 255, 240]]];
function heat(t, a = 1) {
  t = clamp(t);
  for (let i = 1; i < HEAT.length; i++) if (t <= HEAT[i][0]) return rgba(mix3(HEAT[i - 1][1], HEAT[i][1], (t - HEAT[i - 1][0]) / (HEAT[i][0] - HEAT[i - 1][0])), a);
  return rgba(HEAT[HEAT.length - 1][1], a);
}

// which parts make the outline, and which are small extras drawn faint
const MAIN = new Set(['body', 'leg', 'arm', 'skull', 'jaw', 'plate', 'spike', 'sail', 'frill', 'crest', 'horn', 'club', 'foot', 'wing', 'tailfan', 'beak', 'claw', 'tail', 'fin']);
const FAINT = new Set(['eye', 'tooth', 'quill', 'ray']);
const HALO = new Set(['body', 'skull', 'sail', 'frill', 'plate', 'crest']);
const BEAM = new Set(['body', 'leg', 'skull', 'jaw', 'plate', 'spike', 'sail', 'frill', 'crest', 'horn', 'club', 'tailfan', 'wing', 'scute']);
const HOT = { body: 0.56, skull: 0.64, jaw: 0.6, leg: 0.5, arm: 0.5, foot: 0.42, plate: 0.46, spike: 0.36, sail: 0.5, frill: 0.52, crest: 0.5, horn: 0.34, club: 0.4,
  wing: 0.5, tailfan: 0.42, beak: 0.4, claw: 0.32, tooth: 0.36, mouth: 0.96, eye: 1, quill: 0.4, fuzz: 0.6, tail: 0.6, fin: 0.5 };

const closeDown = (g, pts, bottom) => { g.beginPath(); g.moveTo(pts[0][0], bottom); for (const p of pts) g.lineTo(p[0], p[1]); g.lineTo(pts[pts.length - 1][0], bottom); g.closePath(); };
const line = (g, pts) => { g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); };
// one round of corner cutting on a closed polygon
const chaikin = P => { const o = []; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); } return o; };
const MONO = 'ui-monospace, Menlo, Consolas, monospace';
const SCRIPT = '"Snell Roundhand", "Brush Script MT", "Segoe Script", "Lucida Handwriting", cursive';

function make(ctx, opts) {
  const style = opts.style || 'wave', solo = style === 'sign' || style === 'holo';
  const W = solo ? null : createWorld(opts);
  const multi = !Array.isArray(opts.cast) || opts.cast.length > 1;
  const B = {};
  const buf = (name, bw, bh) => { bw = Math.max(1, bw | 0); bh = Math.max(1, bh | 0); let b = B[name]; if (!b || b.canvas.width !== bw || b.canvas.height !== bh) { b = B[name] = buffer(bw, bh); b.fresh = true; } return b; };
  const S = { kick: 0, steps: new Map(), lastStage: -9, phase: 0, callAt: -99, d0: 1 };
  let f, v, g, w, h, lw, fx, scen, glow, M, frameN;

  const reset = () => { g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.setLineDash([]); g.lineJoin = g.lineCap = 'round'; };
  const ci = it => multi ? it.actor.group : it.actor.id;

  // ------------------------------------------------------------ shared drawing
  // glowing outline of one animal: dark fill (so nearer shapes hide farther lines), then additive strokes
  function neonDino(it, c, o = {}) {
    const T = it.T, a = (it.fade ?? 1) * (o.alpha ?? 1); if (a < 0.02) return;
    const P = it.parts, px = T.k * it.sp.len * (it.type === 'dino' ? it.pose.scale : 0.5), small = px < lw * 26, wt = o.lw ?? lw;
    let clip = false;
    if (it.wade) { g.save(); g.beginPath(); g.rect(-9, -9, w + 18, it.waterY + 9); g.clip(); clip = true; }
    if (o.halo) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = a * o.halo; g.strokeStyle = c.main; g.lineWidth = wt * 5; g.beginPath();
      for (const q of P) if (HALO.has(q.k) && q.t !== 'accentFar' || q.k === 'leg' && q.t === 'body') trace(g, q, T); g.stroke(); }
    for (const q of P) {
      const main = MAIN.has(q.k);
      if (!main && (small || !FAINT.has(q.k))) continue;
      if (small && q.k === 'claw') continue;
      const far = q.t === 'far' || q.t === 'accentFar';
      const col = q.t === 'accent' || q.t === 'accentFar' ? c.accent : q.t === 'horn' || q.t === 'eye' ? c.horn : c.main;
      g.beginPath(); trace(g, q, T);
      if (q.l) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = a * 0.5; g.strokeStyle = col; g.lineWidth = wt * 0.6; g.stroke(); continue; }
      if (q.k === 'eye') { g.globalCompositeOperation = 'lighter'; g.globalAlpha = a; g.fillStyle = col; g.fill(); continue; }
      if (main && c.fill) { g.globalCompositeOperation = 'source-over'; g.globalAlpha = a; g.fillStyle = c.fill; g.fill(); }
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = a * (far ? 0.42 : main ? 1 : 0.5); g.strokeStyle = col; g.lineWidth = main ? (far ? wt * 0.75 : wt) : wt * 0.6; g.stroke();
    }
    if (o.dots) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = a; g.fillStyle = o.dots; const r = wt * 1.15;
      for (const q of P) if ((o.dotAll ? MAIN.has(q.k) : HALO.has(q.k) || q.k === 'leg') && q.p && q.t !== 'far' && q.t !== 'accentFar' && !(small && q.k !== 'body')) { const p = q.p[0]; g.fillRect(T.x + p[0] * T.k * T.dir - r, T.y - p[1] * T.k - r, r * 2, r * 2); } }
    if (clip) g.restore();
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  // plants: trees only far away and shrunk, nothing big in front of the animals
  function plantT(it) {
    const P = PLANTS[it.kind]; if (!P) return null;
    let k = it.k;
    if (it.kind !== 'nest') {
      if (hash(it.seed, 3.7) > scen * 1.3) return null;
      if (!P.low) { if (it.d < S.d0 * 2.1) return null; k = Math.min(k, h * 0.2 / P.h); }
      else if (it.d < S.d0 * 0.97 && P.h * k > h * 0.045) return null;
    }
    if (it.x < -P.h * k * 1.5 || it.x > w + P.h * k * 1.5) return null;
    return { x: it.x, y: it.y, k, dir: 1 };
  }
  function linePlant(it, col, a, fill, wt = lw * 0.6) {
    const T = plantT(it); if (!T) return;
    const P = it.parts;
    g.beginPath(); for (const q of P) if (!q.l) trace(g, q, T);
    if (fill) { g.fillStyle = fill; g.fill(); }
    for (const q of P) if (q.l) trace(g, q, T);
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = a * (1 - 0.5 * it.fog); g.strokeStyle = col; g.lineWidth = wt; g.stroke();
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  // the terrain as a grid: columns of constant world x at each band's depth (plus one row below the screen)
  function buildMesh() {
    const L = v.layers, n = L.length, wl = v.biome.water || 0, cam = v.camX, ds = L.map(b => b.d); ds.push(L[n - 1].d * 0.5);
    let s = Math.pow(2, Math.round(Math.log2(v.viewM * 0.22)));
    const half = w / 2 / (v.sx(cam + 1, ds[0]) - v.sx(cam, ds[0]));
    while (2 * half / s > 150) s *= 2;
    const j0 = Math.floor((cam - half) / s) - 1, j1 = Math.ceil((cam + half) / s) + 1;
    const rows = ds.map(d => { const X = [], Y = []; for (let j = j0; j <= j1; j++) { const x = j * s; let y = W.land(x, d); if (wl && y < 0) y = 0; X.push(v.sx(x, d)); Y.push(v.sy(x, d, y)); } return { X, Y }; });
    return { rows, j0, n: j1 - j0 + 1 };
  }
  // the lines from band i to the next one nearer
  function meshRow(i, every = 1) {
    const A = M.rows[i], C = M.rows[i + 1]; g.beginPath();
    for (let j = 0; j < M.n; j++) { if ((M.j0 + j) % every) continue; const x0 = A.X[j], x1 = C.X[j]; if (x0 < -4 && x1 < -4 || x0 > w + 4 && x1 > w + 4) continue; g.moveTo(x0, A.Y[j]); g.lineTo(x1, C.Y[j]); }
  }
  const edge = b => { g.beginPath(); line(g, b.pts); };
  function glowLine(col, a, wt = lw) {
    g.globalCompositeOperation = 'lighter'; g.strokeStyle = col;
    g.globalAlpha = a * 0.22; g.lineWidth = wt * 4; g.stroke();
    g.globalAlpha = a; g.lineWidth = wt; g.stroke();
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  function stars(n, col, hz = v.horizon) {
    g.fillStyle = col; const s = Math.max(1, h / 400);
    for (let i = 0; i < n; i++) { const tw = 0.6 + 0.4 * Math.sin(f.t * (1 + hash(i, 8) * 2) + i); g.globalAlpha = tw * (0.3 + 0.7 * hash(i, 4)); g.fillRect(hash(i, 1) * w, hash(i, 2) * hz * 0.92, s * (hash(i, 5) < 0.12 ? 1.8 : 1), s * (hash(i, 5) < 0.12 ? 1.8 : 1)); }
    g.globalAlpha = 1;
  }
  // soft glow: the frame shrunk in steps (which blurs it) and added back
  function bloom(amt) {
    if (amt < 0.02) return;
    const b1 = buf('b1', w / 4, h / 4), b2 = buf('b2', w / 8, h / 8), b3 = buf('b3', w / 16, h / 16);
    for (const [b, src] of [[b1, g.canvas], [b2, b1.canvas], [b3, b2.canvas]]) { const c = b.ctx; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.globalCompositeOperation = 'copy'; c.drawImage(src, 0, 0, b.canvas.width, b.canvas.height); }
    g.save(); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.globalCompositeOperation = 'lighter';
    g.globalAlpha = Math.min(1, amt * 0.4); g.drawImage(b1.canvas, 0, 0, w, h);
    g.globalAlpha = Math.min(1, amt * 0.4); g.drawImage(b2.canvas, 0, 0, w, h);
    g.globalAlpha = Math.min(1, amt * 0.3); g.drawImage(b3.canvas, 0, 0, w, h);
    g.restore();
  }
  // a tint that only touches what is already painted when the sky must stay clear
  const over = () => { g.globalCompositeOperation = f.combo ? 'source-atop' : 'source-over'; };
  function vignette(a) {
    over(); const r = Math.hypot(w, h) / 2, gr = g.createRadialGradient(w / 2, h / 2, r * 0.55, w / 2, h / 2, r * 1.02);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${a})`); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over';
  }
  function label(txt, x, y, col, size, align = 'left', font = MONO) {
    g.font = `${Math.max(7, size) | 0}px ${font}`; g.textAlign = align; g.textBaseline = 'alphabetic'; g.fillStyle = col; g.fillText(txt, x, y);
  }
  function meteorLines(col) {
    const m = v.meteor; if (!m) return;
    const dx = -Math.cos(m.ang) * m.len, dy = -Math.sin(m.ang) * m.len;
    g.beginPath(); for (const o of [-1, 0, 1]) { g.moveTo(m.x + o * m.r * 0.5, m.y - o * m.r * 0.3); g.lineTo(m.x + dx * (1 - Math.abs(o) * 0.35) + o * m.r, m.y + dy * (1 - Math.abs(o) * 0.35)); }
    g.moveTo(m.x + m.r * 1.6, m.y); g.arc(m.x, m.y, m.r * 1.6, 0, TAU); glowLine(col, 1, lw * 1.4);
  }
  function flash() {
    if (v.flash > 0.01) { over(); g.fillStyle = `rgba(255,250,235,${Math.min(0.92, v.flash)})`; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over'; }
    if (v.dark > 0.02) { over(); g.fillStyle = `rgba(0,0,0,${v.dark * 0.35})`; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over'; }
  }
  const flyers = (c, o) => { for (const it of v.flyers) neonDino(it, c, o); };
  const farLines = (col, fill, a = 0.7) => { if (f.backdrop || scen < 0.08) return; v.far.forEach((l, i) => { closeDown(g, l.pts, l.bottom); g.fillStyle = fill; g.fill(); g.beginPath(); line(g, l.pts); glowLine(col, a * (0.5 + 0.5 * i), lw * 0.8); }); };
  // walk the bands far → near
  function ground(bandFn, plantFn, dinoFn) {
    for (let i = 0; i < v.layers.length; i++) { const b = v.layers[i]; bandFn(b, i); for (const it of b.items) it.type === 'plant' ? plantFn && plantFn(it) : dinoFn(it); }
  }

  // ------------------------------------------------------------ the styles that draw the world
  const R = {
    // ---- synthwave: magenta grid floor, striped sun, chrome mountains
    wave() {
      const hz = v.horizon, PAL = [{ main: '#ff3bd4', accent: '#ffe14a', horn: '#ffffff', fill: 'rgba(12,3,30,0.94)' }, { main: '#2ce8ff', accent: '#ff6be0', horn: '#ffffff', fill: 'rgba(12,3,30,0.94)' }];
      if (sky(f, () => { const gr = g.createLinearGradient(0, 0, 0, hz); gr.addColorStop(0, '#07011a'); gr.addColorStop(0.45, '#1d0640'); gr.addColorStop(0.82, '#5c1466'); gr.addColorStop(1, '#ff4f8e'); g.fillStyle = gr; g.fillRect(0, 0, w, h); })) {
        stars(70, '#ffd6ff');
        // the sun: bands that thin towards the bottom and slide down
        const r = h * 0.21, sx = w * 0.66, sy = hz - r * lerp(0.45, 1.05, clamp(f.p.light * 1.6));
        g.save(); g.beginPath(); g.arc(sx, sy, r, 0, TAU); g.clip();
        const gr = g.createLinearGradient(0, sy - r, 0, sy + r); gr.addColorStop(0, '#fff27a'); gr.addColorStop(0.45, '#ff9a3c'); gr.addColorStop(1, '#ff2a8a'); g.fillStyle = gr;
        g.fillRect(sx - r, sy - r, r * 2, r * 1.05);
        const n = 7, sl = fract(f.t * 0.12);
        for (let i = 0; i < n; i++) { const u = (i + sl) / n, y = sy + r * 0.05 + u * r * 0.95, th = r * 0.95 / n * (0.82 - 0.6 * u); g.fillRect(sx - r, y, r * 2, Math.max(0.5, th)); }
        g.restore();
        const hg = g.createRadialGradient(sx, sy, r * 0.9, sx, sy, r * 2.4); hg.addColorStop(0, 'rgba(255,90,160,0.3)'); hg.addColorStop(1, 'rgba(255,90,160,0)'); g.fillStyle = hg; g.fillRect(sx - r * 2.4, sy - r * 2.4, r * 4.8, r * 2.4 + (hz - sy));
      }
      flyers(PAL[1]); meteorLines('#fff27a');
      if (!f.backdrop && scen > 0.08) v.far.forEach((l, i) => {       // chrome: dark sky reflected on top, a bright band, a hot ground reflection
        let top = h; for (const p of l.pts) top = Math.min(top, p[1]);
        const gr = g.createLinearGradient(0, top, 0, l.bottom); gr.addColorStop(0, i ? '#1c1466' : '#0c0f3c'); gr.addColorStop(0.42, i ? '#5a78d8' : '#34489c'); gr.addColorStop(0.5, i ? '#cfe6ff' : '#7f9ce0'); gr.addColorStop(0.55, '#2a0a40'); gr.addColorStop(1, i ? '#b02a80' : '#5c1668');
        closeDown(g, l.pts, l.bottom); g.fillStyle = gr; g.fill(); g.beginPath(); line(g, l.pts); glowLine(i ? '#9ff6ff' : '#6aa8ff', 0.8, lw * 0.7);
      });
      g.fillStyle = '#0b0220'; g.fillRect(0, hz, w, h - hz);
      ground((b, i) => {
        closeDown(g, b.pts, h + 2); g.fillStyle = rgba(mix3([30, 6, 58], [9, 2, 26], b.u)); g.fill();
        const a = (0.12 + 0.88 * Math.pow(b.u, 1.3)) * (0.25 + 0.75 * scen);
        edge(b); glowLine('#ff3bd4', a, lw * (0.4 + 0.6 * b.u));
        meshRow(i); glowLine('#b44cff', a * 0.9, lw * (0.35 + 0.6 * b.u));
      }, it => linePlant(it, '#56c8ff', 0.55, '#0b0220'), it => neonDino(it, PAL[ci(it) & 1], { halo: 0.16 }));
      g.beginPath(); g.moveTo(0, hz); g.lineTo(w, hz); if (!f.backdrop) glowLine('#ff9ad8', 0.35, lw * 0.6); else g.beginPath();
      bloom(glow);
    },
    // ---- vector monitor: one phosphor colour, bright vertices, persistence trails
    vector() {
      const amber = opts.col === 'amber', col = amber ? '#ffb02e' : '#46ff7c', hot = amber ? '#fff0c8' : '#dcffe6', dark = amber ? 'rgba(10,6,0,0.94)' : 'rgba(0,8,3,0.94)';
      const c = { main: col, accent: col, horn: hot, fill: dark }, hz = v.horizon;
      if (sky(f, () => { g.fillStyle = amber ? '#070400' : '#000503'; g.fillRect(0, 0, w, h); })) {
        stars(40, col);
        const s = v.sun; g.beginPath(); g.moveTo(s.x + s.r, s.y); g.arc(s.x, s.y, s.r, 0, TAU); if (s.moon) { g.moveTo(s.x + s.r * 0.3, s.y - s.r * 0.95); g.quadraticCurveTo(s.x - s.r * 0.5, s.y, s.x + s.r * 0.3, s.y + s.r * 0.95); } glowLine(col, 0.6, lw * 0.8);
      }
      flyers(c, { dots: hot }); meteorLines(hot);
      farLines(col, dark, 0.55);
      g.fillStyle = dark; g.fillRect(0, hz, w, h - hz);
      const dinos = [];
      ground((b, i) => {
        closeDown(g, b.pts, h + 2); g.fillStyle = dark; g.fill();
        const a = (0.2 + 0.5 * b.u) * (0.2 + 0.8 * scen);
        edge(b); glowLine(col, a, lw * 0.7);
        meshRow(i, 2); glowLine(col, a * 0.45, lw * 0.55);
      }, it => linePlant(it, col, 0.4, dark, lw * 0.5), it => { neonDino(it, c, { dots: hot, halo: 0.1 }); dinos.push(it); });
      // phosphor persistence: earlier frames fade out in a half-size buffer
      const tb = buf('trail', w / 2, h / 2), tc = tb.ctx;
      if (tb.fresh || Math.abs(f.stage - S.lastStage) > 0.03) { tc.clearRect(0, 0, w, h); tb.fresh = false; }
      if (f.dt > 0) { tc.globalCompositeOperation = 'destination-out'; tc.globalAlpha = 1; tc.fillStyle = `rgba(0,0,0,${clamp(1 - Math.pow(0.02 + 0.5 * fx * fx, f.dt * 6), 0.02, 1)})`; tc.fillRect(0, 0, tb.canvas.width, tb.canvas.height); }
      tc.globalCompositeOperation = 'lighter'; tc.strokeStyle = col; tc.lineWidth = Math.max(0.6, lw * 0.4); tc.lineJoin = 'round';
      for (const it of dinos) { const T = { x: it.T.x / 2, y: it.T.y / 2, k: it.T.k / 2, dir: it.T.dir }; tc.globalAlpha = 0.5 * (it.fade ?? 1); tc.beginPath(); for (const q of it.parts) if (MAIN.has(q.k) && !q.l && q.t !== 'far' && q.t !== 'accentFar' && q.k !== 'claw') trace(tc, q, T); tc.stroke(); }
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.15 + 0.45 * fx; g.drawImage(tb.canvas, 0, 0, w, h); reset();
      bloom(glow);
      if (v.lead) { const sp = v.lead.sp, fs = h * 0.03; label(`${sp.name.toUpperCase()}  ${sp.len} M`, w * 0.03, h * 0.07, rgba(col, 0.85), fs); label(`${f.era.ma.toFixed(0)} MA`, w * 0.97, h * 0.07, rgba(col, 0.85), fs, 'right'); }
      vignette(0.6);
    },
    // ---- oscilloscope: each animal one continuous jittering beam, the ground a second trace
    scope() {
      const col = '#8dffb5', col2 = '#ffd45a', hz = v.horizon, amp = lw * (0.25 + 1.5 * fx);
      const jx = (i, s) => (hash(i * 1.37 + s, frameN) - 0.5) * amp + Math.sin(i * 0.35 + f.clock * 11 + s) * amp * 0.35;
      if (sky(f, () => { g.fillStyle = '#010604'; g.fillRect(0, 0, w, h); })) {
        // the sun as a Lissajous figure
        const s = v.sun, r = s.r * 1.5, ph = f.t * 0.6; g.beginPath();
        for (let i = 0; i <= 96; i++) { const a = i / 96 * TAU, x = s.x + Math.sin(3 * a + ph) * r, y = s.y + Math.sin(2 * a) * r; i ? g.lineTo(x, y) : g.moveTo(x, y); } glowLine(col2, 0.55, lw * 0.7);
      }
      g.fillStyle = 'rgba(1,6,4,0.96)'; g.fillRect(0, hz, w, h - hz);
      meteorLines(col2);
      const L = v.layers, nL = L.length; let stageI = 0; L.forEach((b, i) => { if (b.d >= S.d0 * 1.02) stageI = i; });
      // ground traces: a few band edges drawn as noisy waveforms
      L.forEach((b, i) => {
        closeDown(g, b.pts, h + 2); g.fillStyle = 'rgba(1,6,4,0.96)'; g.fill();
        if (i !== 0 && i !== nL - 1 && i !== stageI || scen < 0.05 && i !== stageI) return;
        g.beginPath(); const n = 120;
        for (let k = 0; k <= n; k++) { const u = k / n * (b.pts.length - 1), a = b.pts[Math.floor(u)], c = b.pts[Math.min(b.pts.length - 1, Math.floor(u) + 1)], t = u - Math.floor(u);
          const x = lerp(a[0], c[0], t), y = lerp(a[1], c[1], t) + jx(k, i * 31) * (0.5 + b.u); k ? g.lineTo(x, y) : g.moveTo(x, y); }
        glowLine(col2, 0.25 + 0.5 * b.u, lw * (0.5 + 0.4 * b.u));
      });
      let n = 0;
      for (const b of L) for (const it of b.items) {
        if (it.type !== 'dino') continue; n++;
        const T = it.T, a = it.fade ?? 1, segs = [], small = T.k * it.sp.len * it.pose.scale < lw * 26; if (a < 0.02) continue;
        for (const q of it.parts) {
          if (!BEAM.has(q.k) || q.t === 'far' || q.t === 'accentFar' || q.k === 'scute' && q.c || small && q.k !== 'body' && q.k !== 'leg' && q.k !== 'skull') continue;
          let P = q.c ? Array.from({ length: 9 }, (_, i) => [q.c[0] + Math.cos(i / 8 * TAU) * q.c[2], q.c[1] + Math.sin(i / 8 * TAU) * q.c[2]]) : q.p || q.l;
          if (q.p && q.s && q.p.length > 3) P = chaikin(P);
          P = P.map((p, i) => [T.x + p[0] * T.k * T.dir + jx(i + segs.length * 17, n * 5), T.y - p[1] * T.k + jx(i + segs.length * 13, n * 9 + 3)]);
          if (q.p) P.push(P[0]);
          segs.push(P);
        }
        if (!segs.length) continue;
        g.globalCompositeOperation = 'lighter'; g.strokeStyle = col;
        g.beginPath(); let first = true; for (const P of segs) for (const p of P) { first ? g.moveTo(p[0], p[1]) : g.lineTo(p[0], p[1]); first = false; }   // the retrace between shapes
        g.globalAlpha = a * 0.16; g.lineWidth = lw * 0.6; g.stroke();
        g.beginPath(); for (const P of segs) line(g, P); glowLine(col, a);
        const all = segs.flat(), p = all[Math.floor(fract(f.t * 0.45 + n * 0.37) * all.length)];                   // where the beam is now
        g.globalCompositeOperation = 'lighter'; g.fillStyle = '#ffffff'; g.beginPath(); g.arc(p[0], p[1], lw * 1.8, 0, TAU); g.fill(); reset();
      }
      flyers({ main: col, accent: col, horn: col });
      bloom(glow);
      // graticule
      g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'rgba(120,255,180,0.14)'; g.lineWidth = Math.max(1, h / 540); g.beginPath();
      const nx = 10, ny = 6; for (let i = 0; i <= nx; i++) { const x = Math.round(i / nx * (w - 1)) + 0.5; g.moveTo(x, 0); g.lineTo(x, h); } for (let i = 0; i <= ny; i++) { const y = Math.round(i / ny * (h - 1)) + 0.5; g.moveTo(0, y); g.lineTo(w, y); }
      const tk = h * 0.008; for (let i = 0; i <= nx * 5; i++) { const x = i / (nx * 5) * w; g.moveTo(x, h / 2 - tk); g.lineTo(x, h / 2 + tk); } for (let i = 0; i <= ny * 5; i++) { const y = i / (ny * 5) * h; g.moveTo(w / 2 - tk, y); g.lineTo(w / 2 + tk, y); }
      g.stroke(); reset();
      if (v.lead) label(`CH1 ${v.lead.sp.name.toUpperCase()}   CH2 GROUND   X-Y`, w * 0.02, h * 0.965, rgba(col, 0.8), h * 0.028);
      vignette(0.5);
    },
    // ---- vaporwave: pastel sky, checkerboard floor, floating shapes
    vapor() {
      const hz = v.horizon, hazeC = [255, 214, 236];
      if (sky(f, () => { const gr = g.createLinearGradient(0, 0, 0, hz); gr.addColorStop(0, '#7fb8f5'); gr.addColorStop(0.5, '#c8b4f8'); gr.addColorStop(1, '#ffd6ec'); g.fillStyle = gr; g.fillRect(0, 0, w, h); })) {
        const r = h * 0.17, sx = w * 0.3, sy = hz - r * 0.9, gr = g.createLinearGradient(0, sy - r, 0, sy + r); gr.addColorStop(0, '#fffbe0'); gr.addColorStop(1, '#ff9fd0');
        g.save(); g.beginPath(); g.arc(sx, sy, r, 0, TAU); g.clip(); g.fillStyle = gr; g.fillRect(sx - r, sy - r, r * 2, r * 1.1);
        for (let i = 0; i < 6; i++) { const u = (i + fract(f.t * 0.05)) / 6; g.fillRect(sx - r, sy + r * 0.1 + u * r * 0.9, r * 2, r * 0.15 * (0.75 - 0.6 * u)); } g.restore();
      }
      // floating shapes
      const nS = Math.round((f.combo ? 4 : 9) * clamp(scen * 1.6));
      for (let i = 0; i < nS; i++) {
        const x = fract(hash(i, 21) + f.t * 0.004 * (hash(i, 22) - 0.5)) * w, y = hz * (0.1 + 0.62 * hash(i, 23)) + Math.sin(f.t * 0.5 + i * 2.1) * h * 0.012, r = h * (0.025 + 0.04 * hash(i, 24)), a = f.t * 0.25 * (hash(i, 25) - 0.5) + i, k = i % 4;
        const cols = ['#7af5e6', '#ff8fd0', '#fff3a8', '#b79bff'];
        const shape = (ox, oy) => { g.beginPath(); if (k === 1) { g.arc(x + ox, y + oy, r, 0, TAU); } else { const n = k === 0 ? 3 : k === 2 ? 4 : 6; for (let j = 0; j < n; j++) { const b = a + j / n * TAU, px = x + ox + Math.cos(b) * r, py = y + oy + Math.sin(b) * r * (k === 3 ? 0.55 : 1); j ? g.lineTo(px, py) : g.moveTo(px, py); } g.closePath(); } };
        shape(lw * 2.5, lw * 2.5); g.fillStyle = 'rgba(90,70,190,0.35)'; g.fill();
        shape(0, 0); g.fillStyle = cols[i % 4]; g.globalAlpha = 0.85; g.fill(); g.globalAlpha = 1; g.strokeStyle = '#ffffff'; g.lineWidth = lw; g.stroke();
      }
      for (const it of v.flyers) { drawParts(g, it.parts, it.T, { fill: () => '#ffffff', stroke: '#8f7cf0', lw: lw * 0.6 }); }
      if (v.meteor) meteorLines('#fff3a8');
      if (!f.backdrop && scen > 0.08) v.far.forEach((l, i) => { closeDown(g, l.pts, l.bottom); g.fillStyle = i ? '#b9a0f5' : '#cdbcf9'; g.fill(); g.beginPath(); line(g, l.pts); g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = lw * 0.7; g.stroke(); });
      g.fillStyle = rgba(hazeC); g.fillRect(0, hz, w, h - hz);
      const PALS = { body: '#a493ff', belly: '#ffd6f2', far: '#7868d6', mark: '#7af5e6', accent: '#5fe9dc', accentFar: '#46b8c4', horn: '#ffffff', eye: '#fff3a8', mouth: '#ff6fb0' };
      ground((b, i) => {
        const fade = Math.pow(1 - b.u, 2.2) * 0.8, cA = rgba(mix3([255, 143, 208], hazeC, fade)), cB = rgba(mix3([255, 250, 253], hazeC, fade));
        closeDown(g, b.pts, h + 2); g.fillStyle = cB; g.fill();
        const A = M.rows[i], C = M.rows[i + 1]; g.beginPath();
        for (let j = 0; j < M.n - 1; j++) { if ((M.j0 + j + i) & 1) continue; if (A.X[j + 1] < 0 && C.X[j + 1] < 0 || A.X[j] > w && C.X[j] > w) continue; g.moveTo(A.X[j], A.Y[j]); g.lineTo(A.X[j + 1], A.Y[j + 1]); g.lineTo(C.X[j + 1], C.Y[j + 1]); g.lineTo(C.X[j], C.Y[j]); g.closePath(); }
        g.fillStyle = cA; g.fill();
      }, it => { const T = plantT(it); if (!T) return; g.beginPath(); for (const q of it.parts) if (!q.l) trace(g, q, T); g.fillStyle = rgba(mix3([70, 214, 196], hazeC, it.fog * 0.8)); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = lw * 0.5; g.stroke(); },
      it => {
        const T = it.T, a = it.fade ?? 1, q = it.pose; if (a < 0.02) return;
        g.globalAlpha = a * 0.3; g.fillStyle = '#6a4fd0'; g.beginPath(); g.ellipse(T.x + q.nodes[q.iSh].x * 0.5 * T.k * T.dir, T.y, it.sp.len * q.scale * T.k * 0.3, it.sp.len * q.scale * T.k * 0.03, 0, 0, TAU); g.fill();
        const off = lw * 3, T2 = { x: T.x + off, y: T.y - off * 0.2, k: T.k, dir: T.dir };          // the offset cyan echo
        g.globalAlpha = a * 0.6; g.fillStyle = '#4fe3e0'; g.beginPath(); for (const p of it.parts) if (MAIN.has(p.k) && !p.l) trace(g, p, T2); g.fill();
        g.globalAlpha = a; drawParts(g, it.parts.filter(p => p.k !== 'fuzz'), T, { pal: PALS, stroke: '#ffffff', lw, pupilCol: '#5a3fb8', alpha: { mark: 0.45 * a, body: a, belly: a, far: a, accent: a, accentFar: a, horn: a, eye: a, mouth: a } }); g.globalAlpha = 1;
      });
      bloom(glow * 0.3);
    },
    // ---- glitch: neon in the animals' own colours, torn up when they call or stamp
    glitch() {
      const hz = v.horizon, cache = new Map();
      const pal = sp => { let c = cache.get(sp); if (!c) cache.set(sp, c = { main: neon(sp.c[0], 66), accent: neon(sp.c[3], 60), horn: '#ffffff', fill: 'rgba(6,6,12,0.94)' }); return c; };
      if (sky(f, () => { g.fillStyle = '#04040a'; g.fillRect(0, 0, w, h); })) stars(50, '#9fb4ff');
      flyers({ main: '#9fd0ff', accent: '#ff7ad0', horn: '#fff' }); meteorLines('#ffffff');
      farLines('#5d6cff', '#05050c', 0.5);
      g.fillStyle = '#05050c'; g.fillRect(0, hz, w, h - hz);
      let kick = 0;
      ground((b, i) => {
        closeDown(g, b.pts, h + 2); g.fillStyle = '#05050c'; g.fill();
        const a = (0.2 + 0.5 * b.u) * (0.2 + 0.8 * scen);
        edge(b); glowLine('#3fd0ff', a, lw * 0.7); meshRow(i); glowLine('#4a58d8', a * 0.7, lw * 0.5);
      }, it => linePlant(it, '#58e0a8', 0.4, '#05050c', lw * 0.5), it => {
        neonDino(it, pal(it.sp), { halo: 0.14 });
        const a = it.actor, big = clamp(a.sp.len * a.scale / 9, 0.2, 1);
        if (it.state === 'call' && a.jaw > 0.35) kick = Math.max(kick, big * (0.7 + 0.3 * hash(frameN, a.id)));
        const st = S.steps.get(a.id); if (st !== undefined && st !== a.steps && a.v > 0.2) kick = Math.max(kick, big * (0.3 + 0.4 * a.run)); S.steps.set(a.id, a.steps);
      });
      if (S.steps.size > 200) S.steps.clear();
      S.kick = Math.max(kick, S.kick * Math.exp(-(f.dt || 0) * 5));
      const burst = hash(Math.floor(f.clock * 2.3), 7) > 0.8 ? 0.35 * hash(Math.floor(f.clock * 9), 3) : 0;
      const amt = clamp((0.16 + S.kick + burst) * fx * 2, 0, 1.4), fr = Math.floor(f.clock * 14);
      // tears and blocks: strips of the picture slid sideways (rows keep their own sky, so nothing lands on it)
      const cp = buf('copy', w, h), cc = cp.ctx; cc.globalCompositeOperation = 'copy'; cc.drawImage(g.canvas, 0, 0);
      const nT = Math.floor(amt * 7 + hash(fr, 1));
      for (let i = 0; i < nT; i++) {
        const blk = i % 3 === 2, y = Math.floor(hash(fr, i, 2) * h), sh = Math.ceil(h * (blk ? 0.04 + 0.1 * hash(fr, i, 3) : 0.006 + 0.05 * hash(fr, i, 3))), dx = (hash(fr, i, 4) - 0.5) * w * 0.16 * amt;
        const x0 = blk ? hash(fr, i, 5) * w * 0.7 : 0, bw = blk ? w * (0.1 + 0.25 * hash(fr, i, 6)) : w;
        if (!blk) { g.clearRect(0, y, w, sh); if (!f.combo) { g.fillStyle = '#04040a'; g.fillRect(0, y, w, sh); } }
        g.drawImage(cp.canvas, x0, y, bw, sh, x0 + dx, y, bw, sh);
      }
      // colour channels pulled apart: red one way, green and blue the other
      const off = Math.round(h * (0.0025 + 0.012 * amt) * (hash(fr, 9) > 0.5 ? 1 : -1)) || 1;
      cc.drawImage(g.canvas, 0, 0);
      const rb = buf('red', w, h), rc = rb.ctx; rc.globalCompositeOperation = 'copy'; rc.drawImage(cp.canvas, 0, 0); rc.globalCompositeOperation = 'multiply'; rc.fillStyle = '#ff0000'; rc.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'multiply'; g.fillStyle = '#00ffff'; g.fillRect(0, 0, w, h);
      if (f.combo) { rc.globalCompositeOperation = 'destination-in'; rc.drawImage(cp.canvas, 0, 0); g.globalCompositeOperation = 'destination-in'; g.drawImage(cp.canvas, 0, 0); }
      g.globalCompositeOperation = 'lighter'; g.drawImage(rb.canvas, off, 0); reset();
      bloom(glow);
      // scanlines and a rolling bright bar
      over(); const sl = Math.max(2, Math.round(h / 180)); let pt = B.scan;
      if (!pt || pt.sl !== sl) { const c = buffer(1, sl); c.ctx.fillStyle = 'rgba(0,0,0,0.3)'; c.ctx.fillRect(0, 0, 1, Math.ceil(sl / 2)); pt = B.scan = { sl, pat: g.createPattern(c.canvas, 'repeat') }; }
      g.fillStyle = pt.pat; g.fillRect(0, 0, w, h);
      const by = fract(f.clock * 0.13) * h * 1.3 - h * 0.15, bg = g.createLinearGradient(0, by - h * 0.08, 0, by + h * 0.08); bg.addColorStop(0, 'rgba(255,255,255,0)'); bg.addColorStop(0.5, `rgba(255,255,255,${0.05 + 0.1 * amt})`); bg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = bg; g.fillRect(0, by - h * 0.08, w, h * 0.16); reset();
    },
    // ---- thermal camera: warm bodies on cool ground. Body temperatures are an artist's guess.
    thermal() {
      const hz = v.horizon, day = v.light, gT = 0.1 + 0.16 * day;
      if (sky(f, () => { const gr = g.createLinearGradient(0, 0, 0, hz); gr.addColorStop(0, heat(0.0)); gr.addColorStop(1, heat(0.05 + 0.05 * day)); g.fillStyle = gr; g.fillRect(0, 0, w, h); })) {
        const s = v.sun; if (!s.moon) { const gr = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 3.5); gr.addColorStop(0, heat(1)); gr.addColorStop(0.3, heat(0.85)); gr.addColorStop(0.45, heat(0.5, 0.6)); gr.addColorStop(1, heat(0.3, 0)); g.fillStyle = gr; g.fillRect(s.x - s.r * 4, s.y - s.r * 4, s.r * 8, s.r * 8); }
        else { g.fillStyle = heat(0.2); g.beginPath(); g.arc(s.x, s.y, s.r * 0.8, 0, TAU); g.fill(); }
      }
      const hotDino = it => {
        const T = it.T, a = it.fade ?? 1, dim = 1 - 0.22 * it.fog; if (a < 0.02) return;
        let clip = false; if (it.wade) { g.save(); g.beginPath(); g.rect(-9, -9, w + 18, it.waterY + 9); g.clip(); clip = true; }
        g.globalAlpha = a;
        for (const q of it.parts) {
          let t = HOT[q.k]; if (t === undefined) continue;
          if (q.t === 'far' || q.t === 'accentFar') t -= 0.14;
          g.beginPath(); trace(g, q, T);
          if (q.l) { g.strokeStyle = heat(t * dim); g.lineWidth = Math.max(0.6, q.w * T.k); g.stroke(); } else { g.fillStyle = heat(t * dim); g.fill(); }
        }
        if (it.type === 'dino') {         // warmer towards the core: nested bands along the spine
          const q = it.pose, n = q.nodes, N = n.length - 1;
          for (const [i0, i1, k, t] of [[q.iHip * 0.6, N, 0.62, 0.66], [q.iHip * 0.85, Math.min(N, q.iSh + 2), 0.42, 0.76], [q.iHip - 0.5, q.iSh + 0.5, 0.24, 0.87], [q.iHip + 0.3, q.iSh - 0.3, 0.1, 0.97]]) {
            g.beginPath();
            for (let s = i0; s <= i1; s += 0.34) { const i = Math.min(N - 1, Math.floor(s)), u = s - i, A = n[i], C = n[i + 1], x = lerp(A.x, C.x, u), y = lerp(A.y, C.y, u), r = lerp(A.r, C.r, u) * k * T.k;
              if (r < 0.4) continue; const X = T.x + x * T.k * T.dir, Y = T.y - y * T.k; g.moveTo(X + r, Y); g.arc(X, Y, r, 0, TAU); }
            g.fillStyle = heat(t * dim); g.fill();
          }
          for (const p of it.parts) if (p.k === 'eye') { g.beginPath(); trace(g, p, T); g.fillStyle = heat(1); g.fill(); }
        }
        if (clip) g.restore(); g.globalAlpha = 1;
      };
      for (const it of v.flyers) hotDino(it);
      if (v.meteor) { const m = v.meteor, gr = g.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 7); gr.addColorStop(0, heat(1)); gr.addColorStop(0.4, heat(0.8, 0.8)); gr.addColorStop(1, heat(0.5, 0)); g.fillStyle = gr; g.fillRect(m.x - m.r * 7, m.y - m.r * 7, m.r * 14, m.r * 14); }
      if (!f.backdrop && scen > 0.08) v.far.forEach((l, i) => { closeDown(g, l.pts, l.bottom); g.fillStyle = heat(gT * (0.55 + 0.15 * i)); g.fill(); });
      g.fillStyle = heat(gT * 0.8); g.fillRect(0, hz, w, h - hz);
      ground((b, i) => {
        closeDown(g, b.pts, h + 2); g.fillStyle = heat(gT * (0.8 + 0.3 * b.u) + 0.02 * Math.sin(i * 2.4)); g.fill();
        if (b.anyWet) { g.fillStyle = heat(gT * 0.45); const n = b.pts.length; for (let k = 0; k < n; k++) if (b.wet[k]) { const x0 = k ? (b.pts[k - 1][0] + b.pts[k][0]) / 2 : b.pts[k][0], x1 = k < n - 1 ? (b.pts[k][0] + b.pts[k + 1][0]) / 2 : b.pts[k][0]; g.fillRect(x0 - 0.5, b.level, x1 - x0 + 1, b.next - b.level + 1); } }
      }, it => { const T = plantT(it); if (!T) return; g.beginPath(); for (const q of it.parts) if (!q.l) trace(g, q, T); g.fillStyle = heat(gT * 0.62 + 0.03 * hash(it.seed, 2)); g.fill(); }, hotDino);
      bloom(glow * 0.7);
      // the temperature bar
      const bx = w * 0.955, by = h * 0.16, bh = h * 0.6, bw = Math.max(4, w * 0.012), gr = g.createLinearGradient(0, by, 0, by + bh);
      for (let i = 0; i <= 10; i++) gr.addColorStop(i / 10, heat(1 - i / 10));
      g.fillStyle = gr; g.fillRect(bx, by, bw, bh); g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = Math.max(1, h / 500); g.strokeRect(bx, by, bw, bh);
      g.beginPath(); for (let i = 0; i <= 4; i++) { const y = by + bh * i / 4; g.moveTo(bx - bw * 0.5, y); g.lineTo(bx, y); } g.stroke();
      const fs = h * 0.028; label('WARM', bx + bw, by - fs * 0.5, 'rgba(255,255,255,0.9)', fs, 'right'); label('COOL', bx + bw, by + bh + fs * 1.2, 'rgba(255,255,255,0.9)', fs, 'right');
      label('FALSE COLOUR · body heat is an artist’s guess', w * 0.02, h * 0.965, 'rgba(255,255,255,0.75)', fs);
      g.beginPath(); const cx = w / 2, cy = h / 2, cr = h * 0.03; g.moveTo(cx - cr, cy); g.lineTo(cx - cr * 0.35, cy); g.moveTo(cx + cr * 0.35, cy); g.lineTo(cx + cr, cy); g.moveTo(cx, cy - cr); g.lineTo(cx, cy - cr * 0.35); g.moveTo(cx, cy + cr * 0.35); g.lineTo(cx, cy + cr); g.strokeStyle = 'rgba(255,255,255,0.5)'; g.stroke();
    },
    // ---- laser show: three colours, beams from one projector, haze
    laser() {
      const hz = v.horizon, COLS = ['#3dff6a', '#ff3048', '#4d86ff'], px = w * 0.5, py = h * 0.985;
      if (sky(f, () => { g.fillStyle = '#020207'; g.fillRect(0, 0, w, h); })) stars(30, '#8890c0');
      const dk = 'rgba(2,2,8,0.95)';
      g.fillStyle = dk; g.fillRect(0, hz, w, h - hz);
      const beams = [[], [], []], nL = v.layers.length;
      ground((b, i) => {
        closeDown(g, b.pts, h + 2); g.fillStyle = dk; g.fill();
        if (scen > 0.05 && (i === nL - 4 || i === 1)) { edge(b); glowLine(COLS[2], 0.2 + 0.4 * b.u, lw * 0.6); }
      }, null, it => {
        const k = Math.abs(ci(it)) % 3, col = COLS[k], T = it.T, a = it.fade ?? 1;
        g.setLineDash([lw * 46, lw * 3]); g.lineDashOffset = -f.t * lw * 60 - it.actor.id * 37;
        neonDino(it, { main: col, accent: col, horn: col, fill: dk }, { dots: '#ffffff', halo: 0.12, lw: lw * 1.15 }); g.setLineDash([]);
        // the points the scanner dwells on: around the body outline
        const body = it.parts.find(q => q.k === 'body'); if (!body || a < 0.5) return;
        const n = body.p.length, st = Math.max(1, Math.floor(n / 9)), o = Math.floor(f.t * 9) % st;
        for (let j = o; j < n; j += st) beams[k].push(T.x + body.p[j][0] * T.k * T.dir, T.y - body.p[j][1] * T.k);
      });
      flyers({ main: COLS[1], accent: COLS[1], horn: COLS[1] });
      meteorLines('#ffffff');
      // beams through the haze from the projector to the animals, and fans sweeping the sky
      const hzA = 0.25 + 0.75 * fx;
      g.globalCompositeOperation = 'lighter'; g.lineCap = 'butt';
      beams.forEach((bm, k) => { if (!bm.length) return; g.beginPath(); for (let j = 0; j < bm.length; j += 2) { g.moveTo(px, py); g.lineTo(bm[j], bm[j + 1]); } g.strokeStyle = COLS[k]; g.globalAlpha = 0.05 * hzA; g.lineWidth = lw * 5; g.stroke(); g.globalAlpha = 0.2 * hzA; g.lineWidth = lw * 0.7; g.stroke(); });
      for (let k = 0; k < 2; k++) {
        const mid = -Math.PI / 2 + (k ? 1 : -1) * (0.75 + 0.2 * Math.sin(f.t * 0.31 + k * 2)), spread = 0.2 + 0.14 * Math.sin(f.t * 0.53 + k), nb = 7, len = Math.hypot(w, h);
        g.beginPath(); for (let j = 0; j < nb; j++) { const a = mid + (j / (nb - 1) - 0.5) * 2 * spread; g.moveTo(px, py); g.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); }
        g.strokeStyle = COLS[k ? 1 : 2]; g.globalAlpha = 0.045 * hzA; g.lineWidth = lw * 6; g.stroke(); g.globalAlpha = 0.3 * hzA; g.lineWidth = lw * 0.6; g.stroke();
      }
      // haze drifting through the light
      for (let i = 0; i < 4; i++) { const x = fract(hash(i, 41) + f.t * 0.006 * (i % 2 ? 1 : -1)) * w * 1.4 - w * 0.2, y = hz * (0.75 + 0.3 * hash(i, 42)), rx = w * 0.3, gr = g.createRadialGradient(x, y, 0, x, y, rx);
        gr.addColorStop(0, `rgba(90,120,200,${0.07 * hzA})`); gr.addColorStop(1, 'rgba(90,120,200,0)'); g.fillStyle = gr; g.globalAlpha = 1; g.save(); g.translate(0, y * 0.72); g.scale(1, 0.28); g.fillRect(x - rx, y - rx, rx * 2, rx * 2); g.restore(); }
      reset();
      g.fillStyle = '#0a0a12'; g.fillRect(px - h * 0.03, py - h * 0.012, h * 0.06, h * 0.03); g.fillStyle = '#ffffff'; g.beginPath(); g.arc(px, py - h * 0.008, h * 0.006, 0, TAU); g.fill();
      bloom(glow);
    },
  };

  // ------------------------------------------------------------ one animal posed directly
  const boxes = new Map();
  function boxOf(sp) {
    let b = boxes.get(sp.id); if (b) return b;
    b = { x0: 1e9, x1: -1e9, y0: 0, y1: -1e9 };
    for (const ph of [0.12, 0.62]) for (const q of parts(pose(sp, { phase: ph, headTo: 0.3 }))) for (const p of q.c ? [[q.c[0] - q.c[2], q.c[1] - q.c[2]], [q.c[0] + q.c[2], q.c[1] + q.c[2]]] : q.p || q.l) {
      b.x0 = Math.min(b.x0, p[0]); b.x1 = Math.max(b.x1, p[0]); b.y0 = Math.min(b.y0, p[1]); b.y1 = Math.max(b.y1, p[1]); }
    boxes.set(sp.id, b); return b;
  }
  const who = () => { const sp0 = species(opts.sp); return { sp0, sp: opts.lock ? sp0 : standIn(sp0, f.era.ma) }; };

  // ---- neon sign: bent glass tubes with gaps on a brick wall, a two-pose animation, the name in script
  function sign() {
    const { sp0, sp: now } = who(), sp = now || sp0, lit = !!now, night = 1 - smooth(0.1, 0.9, f.p.light);
    const tw = lw * 2.6, bx = boxOf(sp), k = Math.min(w * 0.76 / (bx.x1 - bx.x0), h * 0.5 / (bx.y1 - bx.y0));
    const T = { x: w / 2 - (bx.x0 + bx.x1) / 2 * k, y: h * 0.66, k, dir: 1 };
    if (!f.combo) {
      const wb = buf('wall', w, h);
      if (wb.fresh) { wb.fresh = false; const c = wb.ctx, bh = h / 22, bw = bh * 2.6; c.fillStyle = '#2a1c1c'; c.fillRect(0, 0, w, h);
        for (let r = 0; r * bh < h; r++) for (let q = -1; q * bw < w; q++) { const x = (q + (r % 2) * 0.5) * bw, n = hash(q, r, 5), m = hash(q, r, 9); c.fillStyle = rgba(mix3([92, 42, 36], [58, 30, 34], n).map(u => u * (0.8 + 0.4 * m))); c.fillRect(x + bh * 0.06, r * bh + bh * 0.06, bw - bh * 0.12, bh - bh * 0.12); } }
      g.drawImage(wb.canvas, 0, 0);
      g.fillStyle = `rgba(4,3,10,${lerp(0.25, 0.78, night)})`; g.fillRect(0, 0, w, h);
    } else {            // against an open sky: a rooftop sign on a steel frame
      g.clearRect(0, 0, w, h);
      const x0 = w * 0.08, x1 = w * 0.92, y0 = h * 0.08, y1 = h * 0.97; g.strokeStyle = '#0d0f16'; g.lineWidth = Math.max(2, h * 0.012); g.lineCap = 'butt'; g.beginPath();
      for (let i = 0; i <= 8; i++) { const x = lerp(x0, x1, i / 8); g.moveTo(x, y0); g.lineTo(x, y1); if (i < 8) for (let j = 0; j < 4; j++) { const ya = lerp(y0, y1, j / 4), yb = lerp(y0, y1, (j + 1) / 4), xb = lerp(x0, x1, (i + 1) / 8); (i + j) % 2 ? (g.moveTo(x, ya), g.lineTo(xb, yb)) : (g.moveTo(x, yb), g.lineTo(xb, ya)); } }
      for (let j = 0; j <= 4; j++) { const y = lerp(y0, y1, j / 4); g.moveTo(x0, y); g.lineTo(x1, y); } g.stroke();
      g.fillStyle = '#090a10'; g.fillRect(0, h * 0.94, w, h * 0.06);
    }
    const A = neon(sp.c[0], 56), Bc = neon(sp.c[3], 56, 0), C = '#fff1cf', fr = Math.floor(f.t * 1.4) & 1;
    const on = lit ? 1 : 0, buzz = lit && Math.sin(f.clock * 0.9) > -0.3 && hash(Math.floor(f.clock * 13), 3) < 0.3 + 0.5 * fx ? 0.12 : 1;
    const hasAcc = sp.f.sail || sp.f.plates || sp.f.frill || sp.f.crest;
    // a tube: wall glow, coloured glass, hot core; unlit glass is a dull grey line
    const tube = (col, a, wt = tw) => {
      if (a < 0.2) { g.globalCompositeOperation = 'source-over'; g.globalAlpha = 0.75; g.strokeStyle = '#3d3a48'; g.lineWidth = wt; g.stroke(); g.globalAlpha = 0.5; g.strokeStyle = '#77738a'; g.lineWidth = wt * 0.3; g.stroke(); g.globalAlpha = 1; return; }
      g.globalCompositeOperation = 'lighter'; g.strokeStyle = col; g.globalAlpha = 0.1 * a; g.lineWidth = wt * 4.2; g.stroke(); g.globalAlpha = 0.22 * a; g.lineWidth = wt * 2.2; g.stroke();
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = a; g.lineWidth = wt; g.stroke();
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.55 * a; g.strokeStyle = '#ffffff'; g.lineWidth = wt * 0.26; g.stroke(); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    };
    const q1 = pose(sp, { phase: 0.12 + fr * 0.5, headTo: 0.3, jaw: fr ? 0.75 : 0.08, t: 0 }), q0 = pose(sp, { phase: 0.62 - fr * 0.5, headTo: 0.3, jaw: fr ? 0.08 : 0.75, t: 0 });
    g.lineCap = 'round'; g.lineJoin = 'round';
    // the other pose's legs and jaw wait, unlit
    g.setLineDash([]); for (const q of parts(q0)) if ((q.k === 'leg' || q.k === 'jaw') && q.t === 'body') { g.beginPath(); trace(g, q, T); tube(A, 0, tw * 0.8); }
    const P = parts(q1), gap = [k * sp.len * 0.27, tw * 2], clips = [];
    for (const q of P) {
      if (!MAIN.has(q.k) && q.k !== 'eye' && q.k !== 'tooth' && q.k !== 'ray') continue;
      if (q.k === 'claw' && q.t !== 'horn') continue;
      const far = q.t === 'far' || q.t === 'accentFar', acc = q.t === 'accent' || q.t === 'accentFar' || q.k === 'ray';
      const col = acc ? Bc : q.t === 'horn' || q.k === 'eye' ? C : A;
      const flick = hasAcc ? acc : q.k === 'jaw';
      const a = on * (far ? 0.55 : 1) * (flick ? buzz : 1);
      g.beginPath(); trace(g, q, T);
      if (q.k === 'eye') { g.fillStyle = on ? C : '#55505e'; g.fill(); continue; }
      if (!q.l && !far) { g.fillStyle = 'rgba(8,6,12,0.8)'; g.fill(); }
      const thin = q.k === 'tooth' || q.k === 'ray' || q.k === 'claw' || q.k === 'spike';
      g.setLineDash(thin ? [] : gap); tube(col, a, thin ? tw * 0.5 : far ? tw * 0.8 : tw);
      if (!thin && !far && q.p) for (let i = 1; i < q.p.length; i += 4) clips.push(T.x + q.p[i][0] * k, T.y - q.p[i][1] * k);
    }
    g.setLineDash([]);
    g.fillStyle = '#16141c'; g.beginPath(); for (let i = 0; i < clips.length; i += 2) { g.moveTo(clips[i] + tw * 0.75, clips[i + 1]); g.arc(clips[i], clips[i + 1], tw * 0.75, 0, TAU); } g.fill();
    g.fillStyle = '#8c8798'; g.beginPath(); for (let i = 0; i < clips.length; i += 2) { g.moveTo(clips[i], clips[i + 1]); g.arc(clips[i] - tw * 0.15, clips[i + 1] - tw * 0.15, tw * 0.28, 0, TAU); } g.fill();
    // the name, from the species data, as script tubing; what the name means underneath
    const text = (txt, y, size, font, col, a, wt) => {
      g.font = `${font.includes('cursive') ? 'italic ' : '600 '}${size | 0}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      const m = g.measureText(txt).width; if (m > w * 0.86) { size *= w * 0.86 / m; g.font = `${font.includes('cursive') ? 'italic ' : '600 '}${size | 0}px ${font}`; }
      const st = (c, al, lwd, op) => { g.globalCompositeOperation = op; g.globalAlpha = al; g.strokeStyle = c; g.lineWidth = lwd; g.strokeText(txt, w / 2, y); };
      if (a < 0.2) { st('#3d3a48', 0.8, wt, 'source-over'); } else { st(col, 0.1 * a, wt * 4.5, 'lighter'); st(col, 0.25 * a, wt * 2.3, 'lighter'); st(col, a, wt, 'source-over'); st('#ffffff', 0.75 * a, wt * 0.3, 'lighter'); }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    };
    const flick2 = lit && hash(Math.floor(f.clock * 0.7), 11) > 0.8 && hash(Math.floor(f.clock * 17), 5) < 0.4 ? 0.1 : 1;
    text(sp.name, h * 0.845, h * 0.14, SCRIPT, '#ff4fd0', on * flick2, tw * 0.62);
    if (sp.means) text(`“${sp.means}”`.toUpperCase(), h * 0.93, h * 0.045, 'system-ui, sans-serif', '#39e6ff', on, tw * 0.3);
    reset(); bloom(glow * (lit ? 0.75 : 0.25));
    if (!f.combo) vignette(0.55);
  }

  // ---- hologram: translucent cyan slices with scanlines, rising from a projector base
  function holo() {
    const { sp } = who(), hz = h * 0.56, cx = w / 2, by = h * 0.87, rx = w * 0.17, ry = rx * 0.2;
    const flick = 0.82 + 0.18 * hash(Math.floor(f.clock * 24), 1) - (hash(Math.floor(f.clock * 3), 2) > 0.93 ? 0.35 * fx : 0);
    if (sky(f, () => { const gr = g.createLinearGradient(0, 0, 0, hz); gr.addColorStop(0, '#02040a'); gr.addColorStop(1, '#07131f'); g.fillStyle = gr; g.fillRect(0, 0, w, h); })) stars(26, '#5fb8d8', hz);
    const fg = g.createLinearGradient(0, hz, 0, h); fg.addColorStop(0, '#04101a'); fg.addColorStop(1, '#02060c'); g.fillStyle = fg; g.fillRect(0, hz, w, h - hz);
    if (scen > 0.05) { g.beginPath(); for (let i = -14; i <= 14; i++) { g.moveTo(cx + i * w * 0.012, hz); g.lineTo(cx + i * w * 0.14, h); } for (let i = 1; i <= 7; i++) { const y = hz + (h - hz) * Math.pow(i / 7, 1.9); g.moveTo(0, y); g.lineTo(w, y); } glowLine('#1c8fb4', 0.3 * scen, lw * 0.5); }
    // projector
    g.fillStyle = '#0a1018'; g.beginPath(); g.ellipse(cx, by + h * 0.03, rx, ry, 0, 0, TAU); g.fill(); g.fillRect(cx - rx, by, rx * 2, h * 0.03);
    g.fillStyle = '#121b27'; g.beginPath(); g.ellipse(cx, by, rx, ry, 0, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(cx, by, rx, ry, 0, 0, TAU); g.moveTo(cx + rx, by + h * 0.03); g.ellipse(cx, by + h * 0.03, rx, ry, 0, 0, Math.PI); glowLine('#35d6ff', 0.8, lw * 0.8);
    const eg = g.createRadialGradient(cx, by, 0, cx, by, rx * 0.8); eg.addColorStop(0, `rgba(220,255,255,${0.9 * flick})`); eg.addColorStop(0.5, `rgba(60,210,255,${0.5 * flick})`); eg.addColorStop(1, 'rgba(60,210,255,0)');
    g.save(); g.translate(cx, by); g.scale(1, ry / rx); g.fillStyle = eg; g.beginPath(); g.arc(0, 0, rx * 0.8, 0, TAU); g.fill(); g.restore();
    const top = h * 0.1, wt = w * 0.4;
    // the cone of light
    g.globalCompositeOperation = 'lighter'; const cg = g.createLinearGradient(0, by, 0, top); cg.addColorStop(0, `rgba(70,220,255,${0.26 * flick})`); cg.addColorStop(1, 'rgba(70,220,255,0.015)');
    g.fillStyle = cg; g.beginPath(); g.moveTo(cx - rx * 0.7, by); g.lineTo(cx - wt, top); g.lineTo(cx + wt, top); g.lineTo(cx + rx * 0.7, by); g.closePath(); g.fill();
    g.fillStyle = 'rgba(160,240,255,0.5)'; for (let i = 0; i < 26; i++) { const u = fract(hash(i, 3) + f.t * (0.03 + 0.05 * hash(i, 4))), y = lerp(by, top, u), hw2 = lerp(rx * 0.7, wt, u); g.globalAlpha = 0.6 * (1 - u); g.fillRect(cx + (hash(i, 5) - 0.5) * 2 * hw2, y, lw * 0.8, lw * 0.8); }
    reset();
    if (sp) {
      const bx = boxOf(sp), k = Math.min(w * 0.62 / (bx.x1 - bx.x0), h * 0.56 / (bx.y1 - bx.y0)), G = gait(sp, 0, 1);
      // a short programme: walk on the spot, stop and call, turn round
      const cyc = 16, tc = ((f.t % cyc) + cyc) % cyc, sinceCall = f.t - S.callAt;
      for (const c of f.pointer?.clicks || []) S.callAt = f.t;
      const calling = smooth(8.6, 9.4, tc) * (1 - smooth(11.6, 12.4, tc)), call = Math.max(calling, sinceCall >= 0 && sinceCall < 2.4 ? smooth(0, 0.5, sinceCall) * (1 - smooth(1.9, 2.4, sinceCall)) : 0);
      S.phase += (f.dt || 0) * G.vWalk / G.stride * (1 - call);
      if (call > 0.6 && f.sig && !S.wasCall) f.sig.roar = 1; S.wasCall = call > 0.6;
      const turn = smooth(14.2, 15.2, tc), half = Math.floor(f.t / cyc) & 1, dir0 = half ? -1 : 1, dir = dir0 * Math.cos(Math.PI * turn), d2 = Math.abs(dir) < 0.1 ? 0.1 * (Math.sign(dir) || 1) : dir;
      const q = pose(sp, { phase: S.phase, headTo: lerp(0.12 * Math.sin(f.t * 0.6), 0.75, call), jaw: call * (0.65 + 0.35 * Math.sin(f.t * 9)), rear: sp.P.biped ? 0.12 * call : 0, t: f.t });
      const T = { x: cx - (bx.x0 + bx.x1) / 2 * k * d2, y: by - h * 0.045, k, dir: d2 };
      const hb = buf('holo', w, h), c = hb.ctx; c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.clearRect(0, 0, w, h); c.lineJoin = 'round';
      const FILL = { body: 'rgba(40,200,255,0.3)', far: 'rgba(40,170,255,0.16)', accent: 'rgba(150,255,225,0.42)', accentFar: 'rgba(150,255,225,0.2)', horn: 'rgba(255,255,255,0.6)', mark: 'rgba(210,250,255,0.14)', eye: 'rgba(255,255,255,0.95)', mouth: 'rgba(255,255,255,0.3)' };
      for (const p of parts(q)) {
        const col = FILL[p.t]; if (!col || p.k === 'fuzz') continue;
        c.beginPath(); trace(c, p, T);
        if (p.l) { c.strokeStyle = col; c.lineWidth = Math.max(0.6, p.w * k); c.stroke(); continue; }
        c.fillStyle = col; c.fill();
        if (MAIN.has(p.k)) { c.strokeStyle = p.t === 'far' || p.t === 'accentFar' ? 'rgba(120,225,255,0.35)' : 'rgba(170,245,255,0.95)'; c.lineWidth = lw * 0.8; c.stroke(); }
      }
      // scanlines cut out of the figure, drifting upwards
      const sl = Math.max(3, Math.round(h / 120)), yT = Math.max(0, Math.floor(T.y - bx.y1 * k - h * 0.03)), yB = Math.min(h, Math.ceil(T.y + h * 0.02)), o = sl - Math.floor(f.t * sl * 3) % sl;
      c.globalCompositeOperation = 'destination-out'; c.fillStyle = 'rgba(0,0,0,0.5)'; for (let y = yT - sl + o; y < yB; y += sl) c.fillRect(0, y, w, Math.max(1, sl * 0.4));
      // onto the picture in slices that slip sideways now and then
      g.globalCompositeOperation = 'lighter'; const sh = Math.max(4, Math.round(h / 40)), fr = Math.floor(f.clock * 11);
      for (let y = yT; y < yB; y += sh) { const sl2 = hash(fr, y, 3) < 0.06 * fx * 2 ? (hash(fr, y, 4) - 0.5) * w * 0.05 : Math.sin(y * 0.09 + f.clock * 5) * lw * 0.35;
        g.globalAlpha = clamp(flick * (0.86 + 0.14 * hash(fr, y, 6))); g.drawImage(hb.canvas, 0, y, w, sh, sl2, y, w, sh); }
      g.globalAlpha = 0.16 * flick; g.drawImage(hb.canvas, -lw * 2.5, 0);
      // a sweep plane climbing the cone
      const u = fract(f.t * 0.11), ys = lerp(by, top, u), ws = lerp(rx * 0.7, wt, u); g.globalAlpha = 1; g.beginPath(); g.ellipse(cx, ys, ws, ws * 0.07, 0, 0, TAU); glowLine('#9ff2ff', 0.35 * (1 - u) * flick, lw * 0.7);
      reset();
      const fs = h * 0.034, tx = w * 0.04; let ty = h * 0.12; const a = 0.9 * flick;
      g.font = `600 ${Math.max(9, h * 0.062) | 0}px system-ui, sans-serif`; g.textAlign = 'left'; g.fillStyle = `rgba(150,240,255,${a})`; g.fillText(sp.name, tx, ty);
      for (const s of [sp.means ? `“${sp.means}”` : null, `${sp.len} m long`, `${sp.ma[0]}–${sp.ma[1]} million years ago`, sp.where]) if (s) { ty += fs * 1.45; label(s, tx, ty, `rgba(110,215,245,${a * 0.9})`, fs); }
      g.beginPath(); g.moveTo(tx, h * 0.135); g.lineTo(tx + w * 0.2, h * 0.135); g.strokeStyle = `rgba(110,215,245,${a * 0.6})`; g.lineWidth = Math.max(1, lw * 0.5); g.stroke();
    } else {
      label('NO SIGNAL', cx, h * 0.42, `rgba(150,240,255,${0.8 * flick})`, h * 0.07, 'center');
      label(`nothing like ${species(opts.sp).name} was alive ${f.era.ma.toFixed(0)} million years ago`, cx, h * 0.5, 'rgba(110,215,245,0.8)', h * 0.03, 'center');
    }
    reset(); bloom(glow);
    if (!f.combo) vignette(0.5);
  }

  return {
    render(F) {
      f = F; g = f.ctx; w = f.w; h = f.h;
      const p = f.p;
      lw = Math.max(0.8, h * 0.0034 * (0.35 + 1.3 * p.x2)); fx = clamp(p.x3); scen = clamp(p.x4); glow = clamp(p.x1) * 1.5; frameN = Math.floor(f.clock * 24);
      reset();
      if (solo) { style === 'sign' ? sign() : holo(); }
      else {
        v = W.frame(f);
        S.d0 = v.layers[v.layers.length - 1].d / 0.74;
        M = buildMesh();
        (R[style] || R.wave)();
        reset(); flash();
      }
      S.lastStage = f.stage;
      reset();
    },
    dispose() { for (const k in B) delete B[k]; }
  };
}

export default {
  id: 'synth',
  name: 'Vector & Neon',
  kind: '2d',
  sky: true,
  params: [
    { id: 'x1', label: 'Glow', value: 0.6, tip: 'How much the lines bloom' },
    { id: 'x2', label: 'Line weight', value: 0.5, tip: 'Thickness of the beams and tubes' },
    { id: 'x3', label: 'Trails / FX', value: 0.5, tip: 'The style’s own effect: persistence trails, beam jitter, glitches, flicker, haze' },
    { id: 'x4', label: 'Scenery', value: 0.6, tip: 'Grid, plants and distant shapes around the animals' },
  ],
  create: make,
};

const FLAT = { hills: 0.1, density: 0.2, tall: 0.2, far: 'mountains' };
const S = (id, name, desc, tags, opts, params) => ({ id: 'synth-' + id, name, desc, tags: [...tags, '2d'], opts, params });
export const scenes = [
  S('wave', 'Synthwave Raptors', 'A Utahraptor pack crosses a neon grid under a striped sun and chrome mountains.', ['synthwave', 'neon', 'theropod', 'cretaceous', 'pack'],
    { style: 'wave', cast: [{ sp: 'utahraptor', n: 5 }], biome: FLAT, seed: 5, nonstop: true, frame: 1.5 }, { stage: 0.53, light: 0.3, activity: 0.6 }),
  S('vector', 'Vector Standoff', 'Green phosphor lines with persistence trails: Allosaurus tests a Stegosaurus herd.', ['vector', 'neon', 'theropod', 'stegosaur', 'jurassic', 'hunt'],
    { style: 'vector', col: 'green', cast: [{ sp: 'stegosaurus', n: 3, young: 1 }, { sp: 'allosaurus', n: 1, role: 'pred' }], mode: 'hunt', biome: 'uplands', seed: 14, frame: 1.3 }, { stage: 0.43, activity: 0.6, light: 0.2 }),
  S('scope', 'Oscilloscope Ankylosaurus', 'One jittering beam traces the whole animal, club and all, on an X-Y scope.', ['oscilloscope', 'neon', 'ankylosaur', 'cretaceous'],
    { style: 'scope', cast: [{ sp: 'ankylosaurus', n: 1 }], biome: 'plain', seed: 23, frame: 1.2 }, { stage: 0.855, light: 0.6 }),
  S('vapor', 'Vaporwave Brachiosaurus', 'Slow giants on a pink checkerboard, with floating shapes in a pastel sky.', ['vaporwave', 'pastel', 'sauropod', 'jurassic', 'family'],
    { style: 'vapor', cast: [{ sp: 'brachiosaurus', n: 2, young: 1 }], biome: { ...FLAT, hills: 0.05, far: 'hills' }, seed: 17, frame: 1.15 }, { stage: 0.425, light: 0.6, activity: 0.25, x1: 0.4 }),
  S('glitch', 'Signal Lost', 'T. rex faces Triceratops. Every roar and footfall tears the picture apart.', ['glitch', 'neon', 'theropod', 'ceratopsian', 'cretaceous', 'hunt', 'night'],
    { style: 'glitch', cast: [{ sp: 'triceratops', n: 2, young: 1 }, { sp: 'tyrannosaurus', n: 1, role: 'pred' }], mode: 'hunt', biome: 'badlands', seed: 31, frame: 1.2 }, { stage: 0.855, light: 0.12, activity: 0.75 }),
  S('thermal', 'Thermal Camera', 'A Maiasaura herd at night in false colour. How warm dinosaurs ran is debated: this is an artist’s guess.', ['thermal', 'ornithopod', 'cretaceous', 'herd', 'family', 'night'],
    { style: 'thermal', cast: [{ sp: 'maiasaura', n: 4, young: 4 }], biome: 'plain', seed: 9, frame: 1.25 }, { stage: 0.795, light: 0.08, x1: 0.45 }),
  S('sign', 'Neon Sign', 'Spinosaurus in bent glass tubes on a brick wall, its name in script. Drag Era to rewire the sign.', ['neon', 'sign', 'theropod', 'cretaceous', 'night'],
    { style: 'sign', sp: 'spinosaurus' }, { stage: 0.71, light: 0.1 }),
  S('holo', 'Hologram', 'A Parasaurolophus projected in cyan slices: it walks, calls and turns. Click to make it call.', ['hologram', 'neon', 'ornithopod', 'cretaceous'],
    { style: 'holo', sp: 'parasaurolophus' }, { stage: 0.8, light: 0.1 }),
  S('laser', 'Laser Show Herd', 'Three laser colours draw a Diplodocus herd on the night haze.', ['laser', 'neon', 'sauropod', 'jurassic', 'herd', 'night'],
    { style: 'laser', cast: [{ sp: 'diplodocus', n: 3, young: 1 }], biome: { ...FLAT, far: 'none' }, seed: 11, frame: 1.1 }, { stage: 0.435, light: 0.05 }),
  S('deeptime', 'Amber Deep Time', 'An amber vector monitor scans 180 million years: the cast changes as the eras go by.', ['vector', 'neon', 'triassic', 'time travel', 'herd'],
    { style: 'vector', col: 'amber', cast: 'era', biome: 'plain', seed: 1 }, { stage: 0.02, grow: 0.5, light: 0.2 }),
];
