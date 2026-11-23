// Living Skeletons: the shared world, but the animals walk about as skeletons (rig.js bones()), sometimes with a ghost
// of the skin around them. One painter, eight sub-styles chosen by opts.style:
//   xray    a translucent body with the bones glowing inside, on dark film
//   night   bone white on a black night
//   scan    a scan line sweeps the picture: flesh on one side, X-ray on the other (two clipped drawings)
//   fossil  fossil-brown skeletons in the natural world
//   neon    glowing green bones on black, the hunters in acid yellow
//   plate   an anatomical plate on parchment, with labels and leader lines to the joints of the live pose
//   museum  mounts on plinths under spotlights at night (they stand still, but they are not quite dead)
//   chase   ivory skeletons at a flat run, with dust
import { createWorld } from '../world.js';
import { paintWorld, paintDino, drawParts, palette, trace, hazeRGB, feetY } from '../draw.js';
import { at, gait, size, CRESTS } from '../rig.js';
import { clamp, lerp, smooth, hash, puff, energy } from '../util.js';

const css = (c, a = 1) => a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, a).toFixed(3)})`;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mul = (a, k) => [Math.min(255, a[0] * k), Math.min(255, a[1] * k), Math.min(255, a[2] * k)];
const closeDown = (ctx, pts, bottom) => { ctx.beginPath(); ctx.moveTo(pts[0][0], bottom); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.lineTo(pts[pts.length - 1][0], bottom); ctx.closePath(); };
const MONO = 'ui-monospace, Menlo, Consolas, monospace', SERIF = 'Georgia, "Times New Roman", serif';

// world: 'natural' keeps draw.js's painter and only swaps the animals; 'mono' repaints everything from these colours.
// sky [top, bottom] · g0/g1 ground far/near · edge: line along the top of each ground band [r, g, b, a] · plant [r, g, b, a]
// bone / boneFar / hole / line (the outline round each bone) · ghost: the skin silhouette · glowK: strength of the halo
// add: halo is additive light · ink: outline weight · reveal: x1 → how much skin shows
const STYLES = {
  xray: { world: 'mono', sky: [[1, 6, 14], [10, 42, 61]], g0: [13, 50, 70], g1: [4, 18, 28], edge: [120, 220, 255, 0.28], plant: [110, 200, 235, 0.15], rock: [90, 160, 190, 0.22],
    far: [[8, 34, 50], [11, 44, 62]], bone: [228, 247, 255], boneFar: [92, 142, 168], hole: [5, 22, 33], line: [3, 18, 28], ghost: [120, 205, 240], ghostA: 0.62, ghostLine: [190, 235, 255],
    glow: [110, 215, 255], glowK: 1, add: true, ink: 1, text: [170, 235, 255], font: MONO, shadow: 0.35, pool: 0.1 },
  night: { world: 'mono', sky: [[0, 0, 0], [6, 8, 14]], g0: [17, 19, 26], g1: [3, 4, 6], edge: [190, 205, 235, 0.2], plant: [8, 10, 14, 1], rock: [22, 24, 30, 1], plantLine: [150, 165, 200, 0.16],
    far: [[7, 8, 12], [10, 12, 17]], bone: [248, 246, 238], boneFar: [118, 120, 126], hole: [0, 0, 0], line: [0, 0, 0], ghost: [70, 82, 110], ghostA: 0.6, ghostLine: [150, 165, 200],
    glow: [190, 210, 255], glowK: 0.7, add: true, ink: 1, text: [225, 228, 240], font: MONO, shadow: 0.5, pool: 0.05, stars: [255, 255, 255], moon: 1 },
  neon: { world: 'mono', sky: [[0, 0, 0], [3, 16, 9]], g0: [4, 24, 13], g1: [0, 6, 3], edge: [60, 255, 120, 0.5], plant: [4, 26, 13, 0.9], rock: [6, 34, 18, 0.9], plantLine: [50, 230, 110, 0.22],
    far: [[2, 12, 7], [3, 17, 9]], bone: [70, 255, 120], boneFar: [18, 120, 56], hole: [0, 8, 3], line: [0, 10, 4], ghost: [30, 200, 90], ghostA: 0.4, ghostLine: [90, 255, 140],
    pred: [232, 255, 70], predFar: [118, 132, 26], glow: [50, 255, 110], glowK: 1.15, add: true, ink: 1, text: [150, 255, 180], font: MONO, shadow: 0.2, pool: 0.16, stars: [90, 255, 140] },
  plate: { world: 'mono', sky: [[236, 224, 192], [229, 214, 178]], g0: [229, 214, 178], g1: [213, 194, 150], edge: [84, 54, 28, 0.6], plant: [219, 202, 160, 1], rock: [208, 190, 150, 1], plantLine: [84, 56, 30, 0.42],
    far: [[226, 211, 175], [222, 206, 168]], bone: [250, 244, 226], boneFar: [203, 186, 150], hole: [66, 42, 24], line: [52, 32, 18], ghost: [158, 118, 74], ghostA: 0.42, ghostLine: [70, 44, 24],
    glow: [255, 250, 235], glowK: 0.5, add: false, ink: 1.5, inkFar: true, text: [58, 36, 20], font: SERIF, shadow: 0.16, pool: 0, paper: 1, flat: 1 },
  museum: { world: 'mono', sky: [[3, 5, 11], [15, 22, 36]], g0: [35, 37, 46], g1: [15, 16, 21], edge: null, plant: [9, 15, 14, 1], rock: [26, 27, 32, 1], plantLine: [120, 130, 110, 0.14],
    far: [[8, 11, 18], [10, 14, 21]], bone: [246, 232, 198], boneFar: [118, 104, 82], hole: [14, 11, 8], line: [20, 15, 10], ghost: [110, 100, 84], ghostA: 0.5, ghostLine: [200, 184, 150],
    glow: [255, 226, 170], glowK: 0.7, add: true, ink: 1, text: [240, 226, 190], font: SERIF, shadow: 0.55, pool: 0, stars: [230, 236, 255], moon: 1, hall: 1 },
  fossil: { world: 'natural', bone: [176, 116, 66], boneFar: [104, 66, 38], hole: [44, 26, 16], line: [48, 28, 16], glow: [255, 214, 160], glowK: 0.6, add: false, ink: 1.2,
    text: [52, 30, 16], font: SERIF, shadow: 0.3, pool: 0 },
  chase: { world: 'natural', bone: [250, 242, 222], boneFar: [156, 142, 124], hole: [36, 26, 20], line: [40, 28, 20], glow: [255, 240, 210], glowK: 0.6, add: false, ink: 1.1,
    text: [40, 28, 20], font: MONO, shadow: 0.34, pool: 0, dust: 1 },
};
const REVEAL = { xray: 1, night: 1, neon: 1, plate: 1, museum: 1, fossil: 1, chase: 1 };

// ---------------------------------------------------------------- the animals
// one part added to the current path with a fixed winding, so a single non-zero fill gives the union of all parts
function traceUnion(ctx, q, T) {
  if (q.l) return;
  const k = T.k, sx = k * T.dir;
  if (q.c) { const r = Math.max(0.3, q.c[2] * k), x = T.x + q.c[0] * sx, y = T.y - q.c[1] * k; ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832); return; }
  const p = q.p, n = p.length; let A = 0;
  for (let i = 0; i < n; i++) { const a = p[i], b = p[(i + 1) % n]; A += a[0] * b[1] - b[0] * a[1]; }
  const rev = A * T.dir > 0, P = i => p[rev ? n - 1 - i : i];
  if (q.s && n > 3) {
    let a = P(n - 1), c = P(0), x = T.x + c[0] * sx, y = T.y - c[1] * k;
    ctx.moveTo((T.x + a[0] * sx + x) / 2, (T.y - a[1] * k + y) / 2);
    for (let i = 0; i < n; i++) { const d = P((i + 1) % n), nx = T.x + d[0] * sx, ny = T.y - d[1] * k; ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2); x = nx; y = ny; }
  } else { for (let i = 0; i < n; i++) { const c = P(i); i ? ctx.lineTo(T.x + c[0] * sx, T.y - c[1] * k) : ctx.moveTo(T.x + c[0] * sx, T.y - c[1] * k); } ctx.closePath(); }
}
const FLESH = new Set(['body', 'far']);
// the skin as one flat, translucent silhouette (overlapping parts must not double up), optionally with the
// species' own belly, markings and display colours laid over it
function skin(f, it, alpha, fill, pal, outline) {
  const ctx = f.ctx, T = it.T, px = it.pose.L * T.k;
  if (pal && alpha > 0.97) { drawParts(ctx, it.parts, T, { pal }); return; }
  ctx.globalAlpha = clamp(alpha);
  ctx.beginPath(); for (const q of it.parts) if (!pal || FLESH.has(q.t)) traceUnion(ctx, q, T);
  ctx.fillStyle = fill; ctx.fill('nonzero');
  if (pal) {
    for (const q of it.parts) { if (FLESH.has(q.t) || q.k === 'mouth') continue;
      ctx.beginPath(); trace(ctx, q, T); ctx.globalAlpha = clamp(alpha) * (q.k === 'mark' ? 0.55 : 1);
      if (q.l) { ctx.strokeStyle = pal[q.t]; ctx.lineWidth = Math.max(0.6, q.w * T.k); ctx.stroke(); } else { ctx.fillStyle = pal[q.t]; ctx.fill(); } }
  }
  if (outline) { ctx.globalAlpha = clamp(alpha * 1.7); ctx.strokeStyle = outline; ctx.lineWidth = Math.max(0.6, px * 0.0024); ctx.lineJoin = 'round';
    ctx.beginPath(); for (const q of it.parts) if (q.k === 'body' || q.k === 'skull' || q.k === 'leg' && q.t === 'body') trace(ctx, q, T); ctx.stroke(); }
  ctx.globalAlpha = 1;
}
// the bones: a halo, the far-side limbs dark, then every near bone outlined and shaded top to bottom
function drawBones(f, v, it, S, col) {
  const ctx = f.ctx, T = it.T, q = it.pose, k = T.k, px = q.L * k, fade = it.fade ?? 1;
  const nat = S.world === 'natural', Lk = nat ? 0.66 + 0.34 * v.light : 0.82 + 0.18 * v.light, hz = nat ? hazeRGB(v.light) : S.g0, fg = (it.fog || 0) * 0.85;
  const cN = mix(mul(col.bone, Lk), hz, fg), cF = mix(mul(col.far, Lk), hz, fg), sH = css(mix(S.hole, hz, fg)), sL = css(mix(S.line, hz, fg)), sF = css(cF);
  const bw = Math.pow(2.4, (f.p.x3 - 0.5) * 2), big = px > 70;
  const ol = big ? Math.max(0.5, px * 0.0016) * S.ink : 0, extra = bw > 1 ? (bw - 1) * px * 0.006 : 0, thin = bw < 1 && big ? (1 - bw) * px * 0.005 : 0;
  ctx.lineJoin = ctx.lineCap = 'round'; ctx.globalAlpha = fade;
  const g = f.p.x2 * S.glowK * (1 - fg);
  if (g > 0.02 && px > 20) {
    ctx.save(); if (S.add) ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath(); for (const b of it.bones) if (b.t !== 'hole' && (b.t !== 'boneFar' || big)) trace(ctx, b, T);
    const gc = mul(col.glow, Lk), a = Math.min(1, g * 1.4);
    ctx.strokeStyle = css(gc, 0.11 * a); ctx.lineWidth = px * 0.034 * (0.5 + g) + 1; ctx.stroke();
    ctx.strokeStyle = css(gc, 0.17 * a); ctx.lineWidth = px * 0.013 * (0.5 + g) + 1; ctx.stroke();
    ctx.restore();
  }
  const tall = size(it.sp).tall * q.scale * k, grad = ctx.createLinearGradient(0, T.y - tall, 0, T.y);
  grad.addColorStop(0, css(mix(cN, [255, 255, 255], 0.14))); grad.addColorStop(0.55, css(cN)); grad.addColorStop(1, css(mul(cN, 0.74)));
  for (const b of it.bones) {
    const far = b.t === 'boneFar';
    ctx.beginPath(); trace(ctx, b, T);
    if (b.t === 'hole') { ctx.fillStyle = sH; ctx.fill(); continue; }
    const c = far ? sF : grad, edge = ol && (!far || S.inkFar);
    if (b.l) { const lw = Math.max(0.7, b.w * k * bw); if (edge) { ctx.strokeStyle = sL; ctx.lineWidth = lw + ol * 2; ctx.stroke(); } ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.stroke(); continue; }
    if (edge) { ctx.strokeStyle = sL; ctx.lineWidth = extra + ol * 2; ctx.stroke(); }
    if (extra > 0.3) { ctx.strokeStyle = c; ctx.lineWidth = extra; ctx.stroke(); }
    ctx.fillStyle = c; ctx.fill();
    if (thin > 0.3) { ctx.strokeStyle = sL; ctx.lineWidth = thin; ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
}
// a soft shadow under the feet and, in the dark styles, a pool of the bones' own light
function groundShadow(f, v, it, S, col) {
  const ctx = f.ctx, T = it.T, q = it.pose, px = q.L * T.k, gy = T.y - feetY(q) * T.k, cx = T.x + q.nodes[q.iSh].x * 0.45 * T.k * T.dir, rx = px * 0.36, fade = (it.fade ?? 1) * (1 - (it.fog || 0) * 0.7);
  if (px < 6) return;
  const blob = (r, c0, c1) => { ctx.save(); ctx.translate(cx, gy); ctx.scale(1, 0.15); const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r); g.addColorStop(0, c0); g.addColorStop(0.55, c0); g.addColorStop(1, c1); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.2832); ctx.fill(); ctx.restore(); };
  const nat = S.world === 'natural', a = S.shadow * (nat ? 0.45 + 0.55 * v.light : 1) * fade;
  blob(rx, `rgba(0,0,0,${a.toFixed(3)})`, 'rgba(0,0,0,0)');
  if (S.pool && f.p.x2 > 0.02) blob(rx * 1.5, css(col.glow, S.pool * f.p.x2 * 2 * fade), css(col.glow, 0));
}
const colours = (S, it) => it.actor?.role === 'pred' && S.pred ? { bone: S.pred, far: S.predFar, glow: S.pred } : { bone: S.bone, far: S.boneFar, glow: S.glow };

function paintSkeleton(E, f, v, it, S, reveal) {
  const ctx = f.ctx, T = it.T;
  if (it.type !== 'dino') {                               // pterosaurs and birds in the sky have no rig skeleton: ghosts
    if (S.world === 'natural') return paintDino(f, v, it);
    const c = css(S.ghost || S.bone, 0.5 * (1 - it.fog * 0.5));
    return drawParts(ctx, it.parts, T, { fill: () => c, pupil: false });
  }
  const q = it.pose, px = q.L * T.k, fade = it.fade ?? 1;
  if (T.x < -px * 1.3 || T.x > f.w + px * 1.3 || fade <= 0.01) return;
  const col = colours(S, it);
  if (S.hall) mount(f, v, it, S);
  if (!it.wade) groundShadow(f, v, it, S, col);
  ctx.save();
  if (it.wade) { ctx.beginPath(); ctx.rect(0, 0, f.w, it.waterY); ctx.clip(); }
  if (S.dust) dust(f, v, it, S, col);
  if (reveal > 0.02 && px > 10) {
    if (S.world === 'natural') { const pal = palette(it.sp, { light: v.light, fog: it.fog * 0.8 }); skin(f, it, reveal * fade, pal.body, pal); }
    else skin(f, it, reveal * S.ghostA * fade, css(mix(S.ghost, S.g0, it.fog * 0.8)), null, css(S.ghostLine, 0.6));
  }
  drawBones(f, v, it, S, col);
  ctx.restore();
  if (it.wade) { ctx.strokeStyle = css(col.bone, 0.35); ctx.lineWidth = Math.max(1, T.k * 0.04); ctx.beginPath(); ctx.ellipse(T.x, it.waterY, px * 0.22, px * 0.02, 0, 0, 6.2832); ctx.stroke(); }
}

// ---------------------------------------------------------------- style extras
// chase: dust kicked up behind a running animal, and a few speed streaks (stateless, so any frame is a good frame)
function dust(f, v, it, S, col) {
  const a = it.actor, G = gait(it.sp, 0, a.scale), sp = clamp((a.v - G.vWalk * 0.8) / (G.top - G.vWalk * 0.8 + 0.01));
  if (sp < 0.05) return;
  const ctx = f.ctx, T = it.T, q = it.pose, px = q.L * T.k, gy = T.y - feetY(q) * T.k, d = Math.sign(T.dir) || 1, fade = (it.fade ?? 1) * (1 - it.fog * 0.6);
  const g = v.biome.ground, c = parseInt(g[0].slice(1), 16), L = 0.45 + 0.55 * v.light;
  const img = puff(`${Math.min(255, (c >> 16) * L * 1.12) | 0},${Math.min(255, (c >> 8 & 255) * L * 1.1) | 0},${Math.min(255, (c & 255) * L * 1.08) | 0}`, 64, 0.3), N = 9;
  for (let i = 0; i < N; i++) {
    const u = (f.t * 1.1 + i / N + a.seed) % 1, s = px * (0.07 + 0.3 * u) * (0.8 + 0.4 * hash(i, a.id));
    ctx.globalAlpha = 0.5 * (1 - u) * Math.min(1, u * 8) * sp * fade;
    ctx.drawImage(img, T.x - d * px * (0.02 + u * 1.05) - s / 2, gy - s * 0.62 - u * px * 0.07 * hash(i, 3, a.id), s, s * 0.8);
  }
  ctx.lineCap = 'round'; ctx.strokeStyle = css(col.bone, 1);
  for (let i = 0; i < 6; i++) {
    const u = (f.t * (1.4 + hash(i, a.id, 2)) + hash(i, a.id)) % 1, y = T.y - (0.15 + 0.8 * hash(i, a.id, 5)) * q.H * 1.5 * T.k, x = T.x - d * px * (0.45 + u * 0.7);
    ctx.globalAlpha = 0.3 * Math.sin(Math.PI * u) * sp * fade; ctx.lineWidth = Math.max(0.6, px * 0.003);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - d * px * 0.22, y); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
// museum: a spotlight from the ceiling, a plinth under the feet and a brass plaque with the animal's name
function mount(f, v, it, S) {
  const { ctx, h } = f, T = it.T, q = it.pose, k = T.k, px = q.L * k, d = Math.sign(T.dir) || 1, fade = (it.fade ?? 1) * (1 - it.fog * 0.5);
  let fx0 = 1e9, fx1 = -1e9; for (const g of q.legs) { fx0 = Math.min(fx0, g.pts[3][0], g.tip[0]); fx1 = Math.max(fx1, g.pts[3][0], g.tip[0]); }
  const m = q.H * 0.3, xa = T.x + (fx0 - m) * k * d, xb = T.x + (fx1 + m) * k * d, x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), cx = (x0 + x1) / 2;
  const dp = Math.max(1.5, q.H * 0.2 * k), ph = Math.max(2, Math.min(q.H * 0.24, 0.9) * k), sk = dp * 0.5, y = T.y;
  // beam
  const sx = cx + (hash(it.actor.id, 4) - 0.5) * px * 0.5, sy = -h * 0.03, rx = Math.max(px * 0.5, (x1 - x0) * 0.75);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const flick = 0.9 + 0.1 * Math.sin(f.clock * 0.7 + it.actor.id), gl = (0.35 + f.p.x2) * flick * fade;
  const bg = ctx.createLinearGradient(0, sy, 0, y); bg.addColorStop(0, css(S.glow, 0.2 * gl)); bg.addColorStop(1, css(S.glow, 0.035 * gl));
  ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(sx - px * 0.015, sy); ctx.lineTo(cx - rx, y); ctx.lineTo(cx + rx, y); ctx.lineTo(sx + px * 0.015, sy); ctx.fill();
  ctx.translate(cx, y + dp * 0.5); ctx.scale(1, 0.2);
  const pg = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * 1.15); pg.addColorStop(0, css(S.glow, 0.3 * gl)); pg.addColorStop(0.7, css(S.glow, 0.16 * gl)); pg.addColorStop(1, css(S.glow, 0));
  ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(0, 0, rx * 1.15, 0, 6.2832); ctx.fill();
  ctx.restore();
  // plinth
  ctx.globalAlpha = it.fade ?? 1;
  ctx.fillStyle = css(mix([34, 31, 30], S.g0, it.fog)); ctx.fillRect(x0 - sk, y + dp, x1 - x0 + sk * 2, ph);
  ctx.fillStyle = css(mix([96, 88, 78], S.g0, it.fog)); ctx.beginPath(); ctx.moveTo(x0 - sk, y + dp); ctx.lineTo(x0 + sk, y - dp); ctx.lineTo(x1 - sk, y - dp); ctx.lineTo(x1 + sk, y + dp); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x0 - sk, y + dp + ph, x1 - x0 + sk * 2, Math.max(1, ph * 0.25));
  const fs = ph * 0.62;
  if (fs >= 3.5) { ctx.font = `${fs.toFixed(1)}px ${SERIF}`; const name = it.sp.name, tw = ctx.measureText(name).width + fs * 1.2;
    if (tw < x1 - x0) { ctx.fillStyle = css([176, 142, 74]); ctx.fillRect(cx - tw / 2, y + dp + ph * 0.12, tw, ph * 0.76);
      ctx.fillStyle = '#2a1e0c'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(name, cx, y + dp + ph * 0.53); } }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- the world, repainted in a style's own colours
function paperSky(ctx, w, h, S) {
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, css(S.sky[0])); g.addColorStop(1, css(S.sky[1])); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 16; i++) { const x = hash(i, 11) * w, y = hash(i, 12) * h, r = h * (0.15 + 0.4 * hash(i, 13)), light = i % 3 === 0;
    const b = ctx.createRadialGradient(x, y, 0, x, y, r); b.addColorStop(0, light ? 'rgba(255,250,232,.2)' : 'rgba(150,108,58,.07)'); b.addColorStop(1, light ? 'rgba(255,250,232,0)' : 'rgba(150,108,58,0)');
    ctx.fillStyle = b; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
  ctx.fillStyle = 'rgba(120,80,40,.16)'; for (let i = 0; i < 40; i++) { const r = h * 0.0025 * (0.5 + hash(i, 23)); ctx.beginPath(); ctx.arc(hash(i, 21) * w, hash(i, 22) * h, r, 0, 6.2832); ctx.fill(); }
}
function monoHooks(E, f, S, reveal) {
  const ctx = f.ctx, { w, h } = f;
  return {
    sky(f, v) {
      if (S.paper) return paperSky(ctx, w, h, S);
      const g = ctx.createLinearGradient(0, 0, 0, v.horizon), Lk = 0.75 + 0.25 * v.light;
      g.addColorStop(0, css(mul(S.sky[0], Lk))); g.addColorStop(1, css(mul(S.sky[1], Lk))); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    },
    sun(f, v) {
      if (!S.stars) return;
      const a = 1 - v.dark;
      for (let i = 0; i < 110; i++) { const r = h * (hash(i, 5) < 0.12 ? 0.0034 : 0.0019), tw = 0.55 + 0.45 * Math.sin(f.clock * (0.6 + hash(i, 8)) + i);
        ctx.fillStyle = css(S.stars, a * tw * (0.35 + 0.65 * hash(i, 6))); ctx.beginPath(); ctx.arc(hash(i, 1) * w, hash(i, 2) * v.horizon * 0.96, r, 0, 6.2832); ctx.fill(); }
      if (S.moon) { const x = w * 0.78, y = h * 0.15, r = h * 0.042, g = ctx.createRadialGradient(x, y, 0, x, y, r * 6);
        g.addColorStop(0, `rgba(200,214,255,${0.3 * a})`); g.addColorStop(1, 'rgba(200,214,255,0)'); ctx.fillStyle = g; ctx.fillRect(x - r * 6, y - r * 6, r * 12, r * 12);
        ctx.fillStyle = `rgba(238,240,250,${a})`; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
        ctx.fillStyle = `rgba(190,196,214,${0.5 * a})`; for (const [dx, dy, s] of [[-0.3, -0.2, 0.22], [0.25, 0.3, 0.16], [0.1, -0.45, 0.12]]) { ctx.beginPath(); ctx.arc(x + dx * r, y + dy * r, r * s, 0, 6.2832); ctx.fill(); } }
    },
    far(f, v, l, i) {
      ctx.fillStyle = css(mul(S.far[i % 2], 0.8 + 0.2 * v.light)); closeDown(ctx, l.pts, l.bottom); ctx.fill();
      if (S.edge) { ctx.strokeStyle = css(S.edge, S.edge[3] * 0.5); ctx.lineWidth = Math.max(0.6, h * 0.0014); ctx.beginPath(); l.pts.forEach((p, j) => j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); }
    },
    sea(f, v) { ctx.fillStyle = css(mix(S.g0, S.glow, 0.12)); ctx.fillRect(0, v.sea.y0, w, v.sea.y1 - v.sea.y0 + 2);
      if (S.edge) { ctx.fillStyle = css(S.edge, S.edge[3] * 0.6); ctx.fillRect(0, v.sea.y0, w, Math.max(1, h * 0.002)); } },
    ground(f, v, b) {
      const Lk = 0.8 + 0.2 * v.light;
      ctx.fillStyle = css(mul(mix(S.g0, S.g1, b.u), Lk)); closeDown(ctx, b.pts, h + 2); ctx.fill();
      if (S.edge) { ctx.strokeStyle = css(S.edge, S.edge[3] * (0.3 + 0.7 * b.u)); ctx.lineWidth = Math.max(0.6, h * 0.0016 * (0.6 + b.u)); ctx.lineJoin = 'round';
        ctx.beginPath(); b.pts.forEach((p, j) => j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); }
      if (S.paper && b.u > 0.25) {                         // engraver's hatching under each ridge line
        ctx.strokeStyle = css(S.edge, 0.22); ctx.lineWidth = Math.max(0.5, h * 0.001); ctx.beginPath();
        const n = b.pts.length, hl = h * 0.012 * (0.5 + b.u);
        for (let j = 0; j < n - 1; j++) for (let s = 0; s < 3; s++) { if (hash(j, s, b.d | 0) > 0.55) continue; const u = (s + 0.5) / 3, x = lerp(b.pts[j][0], b.pts[j + 1][0], u), y = lerp(b.pts[j][1], b.pts[j + 1][1], u) + hl * 0.3; ctx.moveTo(x, y); ctx.lineTo(x - hl * 0.6, y + hl); }
        ctx.stroke();
      }
      if (S.hall) {                                         // a polished floor: tile lines running to the vanishing point
        const foot = h * (f.opts?.foot ?? 0.85), chm = (foot - v.horizon) / v.k0, step = 4 * Math.max(1, Math.round(v.viewM / 24)), y0 = b.level, half = w / 2 / v.k0 * (h - v.horizon) / (foot - v.horizon) + step;
        ctx.strokeStyle = `rgba(150,160,190,${0.05 + 0.07 * b.u})`; ctx.lineWidth = Math.max(0.5, h * 0.0012); ctx.beginPath();
        for (let X = Math.ceil((v.camX - half) / step) * step; X < v.camX + half; X += step) { const m = (X - v.camX) / chm; ctx.moveTo(w / 2 + m * (y0 - v.horizon), y0); ctx.lineTo(w / 2 + m * (h - v.horizon), h); }
        ctx.moveTo(0, y0); ctx.lineTo(w, y0); ctx.stroke();
      }
    },
    water(f, v, b) {
      const n = b.pts.length; ctx.fillStyle = css(mix(mix(S.g0, S.g1, b.u), S.glow, 0.2));
      for (let i = 0; i < n; i++) if (b.wet[i]) { const x0 = i ? (b.pts[i - 1][0] + b.pts[i][0]) / 2 : b.pts[i][0], x1 = i < n - 1 ? (b.pts[i][0] + b.pts[i + 1][0]) / 2 : b.pts[i][0]; ctx.fillRect(x0 - 0.5, b.level, x1 - x0 + 1, b.next - b.level + 1); }
    },
    plant(f, v, it) {
      if (it.x < -it.k * 14 || it.x > w + it.k * 14) return;
      const fg = it.fog || 0, op = S.plant[3] >= 0.85, pc = css(op ? mix(S.plant, S.g0, fg * 0.8) : S.plant, op ? 1 : S.plant[3] * (1 - fg * 0.5)), rc = css(op ? mix(S.rock, S.g0, fg * 0.8) : S.rock, op ? 1 : S.rock[3] * (1 - fg * 0.5));
      const light = S.paper ? css(S.bone, 0.9) : null;
      drawParts(ctx, it.parts, { x: it.x, y: it.y, k: it.k, dir: 1 }, { fill: t => t === 'rock' || t === 'rock2' || t === 'trunk' ? rc : (t === 'egg' || t === 'bone') && light ? light : pc,
        stroke: S.plantLine ? css(S.plantLine, S.plantLine[3] * (1 - fg * 0.6)) : null, lw: S.plantLine ? Math.max(0.5, h * 0.0013) : 0 });
    },
    dino: (f, v, it) => paintSkeleton(E, f, v, it, S, reveal),
  };
}
function paintStyle(E, f, v, S, reveal) {
  if (S.world === 'natural') paintWorld(f, v, { dino: (f, v, it) => paintSkeleton(E, f, v, it, S, reveal) });
  else paintWorld(f, v, monoHooks(E, f, S, reveal));
}

// ---------------------------------------------------------------- labels: leader lines to joints of the live pose
function anchors(q) {
  const { sp, P, L, nodes: n, iHip, iSh, iEnd } = q, ft = sp.f, hd = q.head, c = Math.cos(hd.a), s = Math.sin(hd.a), dd = hd.len * (P.hd || 1);
  const M = (lx, ly) => [hd.x + lx * hd.len * c - ly * dd * s, hd.y + lx * hd.len * s + ly * dd * c];
  const N = (i, up = 0) => { const o = at(n, i); return [o.x + o.nx * up, o.y + o.ny * up]; };
  const hind = q.legs.find(g => !g.front && g.near) || q.legs.find(g => !g.front), mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const out = [['skull', M(0.5, 0.2), 0]];
  if (ft.frill) out.push(['frill', M(-0.3 * ft.frill, 0.62 * ft.frill), 0]);
  if (ft.horns) out.push(['brow horn', M(0.8, 0.82 * ft.horns + 0.08), 0]);
  else if (ft.crest && CRESTS[ft.crest] && !/horns|brow|nose/.test(ft.crest)) { const C = CRESTS[ft.crest], m = C[C.length >> 1]; out.push(['crest', M(m[0], m[1] - 0.05), 0]); }
  out.push(['neck vertebrae', N((iSh + iEnd) / 2 + 0.3), 0]);
  if (ft.plates) { const o = at(n, lerp(iHip * 0.45, iEnd - 1.5, 5 / 9)); out.push(['plates', [o.x + o.nx * (o.r + L * 0.055 * ft.plates), o.y + o.ny * (o.r + L * 0.055 * ft.plates)], 0]); }
  if (ft.sail) { const o = at(n, (iHip + iSh) / 2); out.push(['neural spines', [o.x + o.nx * (o.r + L * 0.08 * ft.sail), o.y + o.ny * (o.r + L * 0.08 * ft.sail)], 0]); }
  out.push(['pelvis', [hind.pts[0][0] - n[iHip].r * 0.2, hind.pts[0][1] + n[iHip].r * 0.5], 0]);
  out.push(['tail vertebrae', N(iHip * 0.45), 0]);
  if (ft.spikes) { const o = at(n, iHip * 0.13); out.push(['tail spikes', [o.x - L * 0.025, o.y + L * 0.04], 0]); }
  if (ft.club) out.push(['tail club', [n[0].x, n[0].y], 0]);
  { const o = at(n, (iHip + iSh) / 2 + 0.2); out.push(['ribs', [o.x - o.nx * o.b * 0.45, o.y - o.ny * o.b * 0.45], 1]); }
  out.push(['femur', mid(hind.pts[0], hind.pts[1]), 1], ['tibia', mid(hind.pts[1], hind.pts[2]), 1]);
  const sh = q.legs.find(g => g.front && g.near) || q.arms.find(g => g.near);
  if (sh) out.push([P.biped ? 'arm' : 'humerus', mid(sh.pts[0], sh.pts[1]), 1]);
  return out;
}
function labels(f, v, S, amount) {
  const it = v.items.find(i => i.type === 'dino' && i.actor === v.lead);
  if (!it || (it.fade ?? 1) < 0.5 || Math.abs(it.T.dir) < 0.6) return;
  const { ctx, w, h } = f, T = it.T, q = it.pose, fs = Math.max(7, h * 0.03), pad = fs * 0.7, ink = S.text;
  let list = anchors(q); const keep = Math.max(1, Math.round(list.length * clamp(amount)));
  if (keep < list.length) list = list.slice().sort((a, b) => hash(a[0].length, a[0].charCodeAt(0)) - hash(b[0].length, b[0].charCodeAt(0))).slice(0, keep);
  ctx.font = `${S.font === SERIF ? 'italic ' : ''}${fs.toFixed(1)}px ${S.font}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  const L = list.map(([name, p, low]) => ({ name, low, ax: T.x + p[0] * T.k * T.dir, ay: T.y - p[1] * T.k, tw: ctx.measureText(name).width }));
  let top = 1e9; for (const g of q.nodes) top = Math.min(top, T.y - (g.y + g.r) * T.k);
  top = Math.min(top, T.y - (q.head.y + q.head.len) * T.k);
  const place = (row, y0, step) => {
    row.sort((a, b) => a.ax - b.ax);
    const lean = (i) => (i - (row.length - 1) / 2) * fs * 1.2;
    row.forEach((l, i) => { l.x = l.ax + lean(i); l.y = y0 + (i % 2) * step; });
    for (let i = 1; i < row.length; i++) row[i].x = Math.max(row[i].x, row[i - 1].x + (row[i].tw + row[i - 1].tw) / 2 + pad);
    const over = row.length ? row[row.length - 1].x + row[row.length - 1].tw / 2 - (w - pad) : 0;
    if (over > 0) { row[row.length - 1].x -= over; for (let i = row.length - 2; i >= 0; i--) row[i].x = Math.min(row[i].x, row[i + 1].x - (row[i].tw + row[i + 1].tw) / 2 - pad); }
    if (row.length && row[0].x - row[0].tw / 2 < pad) { row[0].x = pad + row[0].tw / 2; for (let i = 1; i < row.length; i++) row[i].x = Math.max(row[i].x, row[i - 1].x + (row[i].tw + row[i - 1].tw) / 2 + pad); }
  };
  const up = L.filter(l => !l.low), dn = L.filter(l => l.low);
  place(up, clamp(top - h * 0.1, h * 0.3, h * 0.6), -fs * 1.5);
  place(dn, Math.min(h - fs * 2.6, T.y + h * 0.075), fs * 1.5);
  const a = clamp(((it.fade ?? 1) - 0.5) * 2) * clamp((Math.abs(T.dir) - 0.6) * 4);
  ctx.lineWidth = Math.max(0.6, h * 0.0016); ctx.lineCap = 'round';
  for (const l of L) {
    const ly = l.low ? l.y - fs * 0.62 : l.y + fs * 0.62;
    ctx.strokeStyle = css(ink, 0.7 * a); ctx.beginPath(); ctx.moveTo(l.x, ly); ctx.lineTo(l.ax, l.ay); ctx.stroke();
    ctx.fillStyle = css(ink, a); ctx.beginPath(); ctx.arc(l.ax, l.ay, Math.max(1.2, h * 0.0042), 0, 6.2832); ctx.fill();
    if (!S.paper) { ctx.fillStyle = `rgba(0,0,0,${0.45 * a})`; ctx.fillRect(l.x - l.tw / 2 - fs * 0.3, l.y - fs * 0.62, l.tw + fs * 0.6, fs * 1.24); }
    ctx.fillStyle = css(S.world === 'natural' ? [250, 244, 230] : ink, a); ctx.fillText(l.name, l.x, l.y);
  }
  // title: the animal's own name, meaning, length and dates, and a one-metre scale bar
  const sp = it.sp, m = h * 0.045, big = Math.max(9, h * 0.056);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const tc = S.world === 'natural' ? [250, 244, 230] : ink;
  if (S.world === 'natural') { ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = h * 0.01; }
  ctx.fillStyle = css(tc, a); ctx.font = `${S.font === SERIF ? 'italic ' : 'bold '}${big.toFixed(1)}px ${S.font}`; ctx.fillText(sp.name, m, h * 0.1 + big * 0.8);
  ctx.font = `${fs.toFixed(1)}px ${S.font}`; ctx.fillStyle = css(tc, 0.85 * a);
  ctx.fillText(`“${sp.means}” · ${sp.len} m long · ${sp.ma[0]}–${sp.ma[1]} million years ago`, m, h * 0.1 + big * 0.8 + fs * 1.5);
  const bar = T.k, bx = w - m - Math.max(bar, fs * 2), by = h - m;
  if (bar > 6 && bar < w * 0.4) { ctx.strokeStyle = css(tc, a); ctx.lineWidth = Math.max(1, h * 0.003); ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + bar, by); ctx.moveTo(bx, by - fs * 0.3); ctx.lineTo(bx, by + fs * 0.3); ctx.moveTo(bx + bar, by - fs * 0.3); ctx.lineTo(bx + bar, by + fs * 0.3); ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillStyle = css(tc, a); ctx.fillText('1 m', bx + bar / 2, by - fs * 0.5); }
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
}

// ---------------------------------------------------------------- directing the cast (world.js has no knobs for these)
// chase: everyone runs flat out, in formation, the hunters behind. The world is in 'migrate' mode with a still camera;
// each frame this sets how hard every animal runs and where the camera looks.
function chasePre(W, f, st) {
  const A = W.actors.filter(a => !a.leaving && a.role !== 'young' && a._sk);
  if (!A.length || st.C == null) return;
  const dt = Math.min(0.25, f.dt || 0);
  let top = 1e9; for (const a of A) top = Math.min(top, gait(a.sp, 0, a.scale).top);
  const V = st.V = top * clamp(0.5 + 0.28 * energy(f), 0.45, 0.94);
  st.C += V * dt;
  for (const a of A) {
    const G = gait(a.sp, 0, a.scale), sway = a.role === 'pred' ? Math.sin(f.t * 0.33 + a.id) * a.sp.len * 0.45 : Math.sin(f.t * 0.5 + a.id * 2.3) * a.sp.len * 0.12;
    a.hurry = clamp((V + (st.C + a._off + sway - a.x) * 0.9 - G.vWalk) / (G.top - G.vWalk)); a.idle = null;
  }
  for (const G of W.groups) if (G) { G.anchor = st.C + 500; G.moving = true; G.timer = 99; }
  const G0 = W.groups.find(Boolean); if (G0) G0.home = st.C + V / 1.4;
}
function chasePost(W, f, st, v) {
  const A = W.actors.filter(a => !a.leaving && a.role !== 'young');
  if (!A.length || A.every(a => a._sk)) return false;
  const prey = A.filter(a => a.role !== 'pred'), pred = A.filter(a => a.role === 'pred');
  let x = 0, big = 0; for (const a of A) big = Math.max(big, a.sp.len * a.scale);
  prey.forEach((a, i) => { a._off = x; x += a.sp.len * a.scale * (0.5 + 0.25 * hash(i, a.id)); });
  let back = -big * 1.05; pred.forEach(a => { a._off = back; back -= a.sp.len * a.scale * 0.75; });
  const span = x - back, vw = v.w / v.k0, fit = Math.min(1, vw * 0.86 / span);
  for (const a of A) a._off *= fit;
  const mean = (Math.max(...A.map(a => a._off)) + Math.min(...A.map(a => a._off))) / 2 - vw * 0.04, c = W.cam.x;
  let top = 1e9; for (const a of A) top = Math.min(top, gait(a.sp, 0, a.scale).top);
  const V = st.V = top * clamp(0.5 + 0.28 * energy(f), 0.45, 0.94);
  for (const a of A) { const G = gait(a.sp, 0, a.scale); a._off -= mean; a._sk = 1; a.x = a.tx = c + a._off; a.dir = 1; a.v = V; a.run = clamp((V - G.vWalk) / (G.top - G.vWalk)); a.idle = null; a.fade = 1; }
  st.C = c;
  return true;
}
// museum: the mounts stay on their plinths (only heads, jaws and tails move), biggest at the back
const POSES = ['look', null, 'call', 'sniff', 'look', null, 'graze', 'look'];
function museumPre(W, f) {
  for (const a of W.actors) { if (a.leaving) continue; a.busy = 1; a.tx = a.x; a.hurry = 0; a.idle = POSES[Math.floor(hash(Math.floor(f.t / 5 + a.seed * 9), a.id) * POSES.length)]; }
}
function museumPost(W, f, v) {
  const A = W.actors.filter(a => !a.leaving && a.role !== 'young');
  if (!A.length || A.every(a => a._sk)) return false;
  const it = v.items.find(i => i.type === 'dino'); if (!it) return false;
  const d0 = it.k * it.actor.d / v.k0, home = W.groups.find(Boolean)?.home ?? 0, vw = v.w / v.k0;
  A.sort((a, b) => b.sp.len * b.scale - a.sp.len * a.scale);
  const front = A.length > 1 ? A.slice(1) : A, mid = a => { const P = a.sp.P, s = P.tail + P.torso + P.neck + P.head; return a.sp.len * a.scale * (P.torso + P.neck * 0.5 + P.head - P.tail) / (2 * s); };
  // the front row alternates left and right of the big one in the middle
  front.forEach((a, j) => { const u = front.length === 1 ? (A.length > 1 ? 0.2 : 0.5) : (j % 2 ? 1 - Math.floor(j / 2) / front.length - 0.5 / front.length : Math.floor(j / 2) / front.length + 0.5 / front.length);
    a.dir = u < 0.5 ? 1 : -1; if (A.length === 1) a.dir = 1;
    a.x = home + (u - 0.5) * vw * 0.86 - a.dir * mid(a); a.lane = a.d = d0 * (0.98 + 0.06 * (j % 3)); });
  if (A.length > 1) { const a = A[0]; a.dir = 1; a.lane = a.d = d0 * 1.38; a.x = home + vw * 0.07 - mid(a); }
  for (const a of A) { a.tx = a.x; a._sk = 1; a.v = 0; a.turn = 0; a.fade = 1; a.busy = 1; }
  return true;
}

// ---------------------------------------------------------------- engine
export default {
  id: 'skeleton',
  name: 'Living Skeletons',
  kind: '2d',
  sky: true,
  params: [
    { id: 'x1', label: 'Reveal', value: 0.3, tip: 'How much skin shows around the bones. In the scan scene it moves the scan line: flesh on the left, skeleton on the right' },
    { id: 'x2', label: 'Glow', value: 0.5, tip: 'The halo of light around the bones' },
    { id: 'x3', label: 'Bone weight', value: 0.5, tip: 'Thin, delicate bones → heavy ones' },
    { id: 'x4', label: 'Labels', value: 0, tip: 'Name the bones of the nearest animal, with leader lines to its joints' },
  ],
  create(ctx, opts) {
    const style = opts.style || 'xray', S = STYLES[style === 'scan' ? 'xray' : style] || STYLES.xray;
    const o = { ...opts };
    if (style === 'chase') Object.assign(o, { mode: 'migrate', cam: 'still', nonstop: true, dir: 1 });
    if (style === 'museum') Object.assign(o, { mode: 'wander', cam: 'still' });
    const W = createWorld(o), E = {}, st = { C: null, V: 0 };
    return {
      render(f) {
        const p = f.p, { w, h } = f;
        if (style === 'chase') chasePre(W, f, st); else if (style === 'museum') museumPre(W, f);
        let v = W.frame(f);
        // world.js frames the very first view of a new cast before it knows who is in it: ask again, without advancing time
        if (Math.abs(v.viewM * Math.pow(2, (p.scale - 0.5) * 2) - W.viewM) > W.viewM * 0.01) v = W.frame({ ...f, dt: 0 });
        if (style === 'chase' ? chasePost(W, f, st, v) : style === 'museum' ? museumPost(W, f, v) : false) v = W.frame({ ...f, dt: 0 });
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        if (style === 'scan') {
          // two whole pictures, clipped either side of the line: the living animal, and the same pose as an X-ray
          const x = w * clamp(lerp(0.04, 0.96, p.x1) + 0.012 * Math.sin(f.t * 0.6));
          paintWorld(f, v, {});
          ctx.save(); ctx.beginPath(); ctx.rect(x, 0, w - x, h); ctx.clip();
          paintStyle(E, f, v, S, 0.3);
          ctx.restore();
          const bw = h * 0.05, g = ctx.createLinearGradient(x - bw, 0, x + bw, 0), gl = 0.25 + 0.5 * p.x2;
          g.addColorStop(0, 'rgba(120,225,255,0)'); g.addColorStop(0.5, `rgba(150,235,255,${gl})`); g.addColorStop(1, 'rgba(120,225,255,0)');
          ctx.save(); if (f.combo) ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = g; ctx.fillRect(x - bw, 0, bw * 2, h); ctx.restore();
          ctx.fillStyle = 'rgba(235,252,255,.95)'; ctx.fillRect(x - Math.max(0.75, h * 0.002), 0, Math.max(1.5, h * 0.004), h);
        } else paintStyle(E, f, v, S, REVEAL[style] * p.x1);
        if (S.paper) {
          if (!f.combo) { const m = h * 0.022; ctx.strokeStyle = css(S.line, 0.7); ctx.lineWidth = Math.max(1, h * 0.004); ctx.strokeRect(m, m, w - m * 2, h - m * 2); ctx.lineWidth = Math.max(0.5, h * 0.0012); ctx.strokeRect(m * 1.5, m * 1.5, w - m * 3, h - m * 3); }
          const dim = (1 - smooth(0, 0.5, v.light)) * 0.5;      // by candle light
          if (dim > 0.01) { ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = `rgba(40,22,8,${dim})`; ctx.fillRect(0, 0, w, h); ctx.restore(); }
        }
        if (p.x4 > 0.05) labels(f, v, S, p.x4);
      }
    };
  }
};

const SC = (id, name, desc, tags, opts, params) => ({ id: 'skeleton-' + id, name, desc, tags: ['skeleton', '2d', ...tags], opts, params });
export const scenes = [
  SC('xray', 'X-ray Rex', 'Tyrannosaurus on film: a ghost of the body with the bones glowing inside it.', ['x-ray', 'theropod', 'cretaceous'],
    { style: 'xray', cast: [{ sp: 'tyrannosaurus', n: 1 }], biome: 'plain', seed: 3 }, { stage: 0.855, x1: 0.5, x2: 0.6 }),
  SC('night', 'Bone White Night', 'A Diplodocus herd and its young cross the dark as bare white bones under the moon.', ['night', 'sauropod', 'jurassic', 'herd', 'family'],
    { style: 'night', cast: [{ sp: 'diplodocus', n: 3, young: 2 }], biome: 'plain', seed: 11 }, { stage: 0.44, light: 0.08, x1: 0, x2: 0.35 }),
  SC('scan', 'Skin to Bone', 'A scan line splits the picture: living Triceratops on the left, their skeletons on the right. Reveal moves the line.', ['x-ray', 'ceratopsian', 'cretaceous', 'family'],
    { style: 'scan', cast: [{ sp: 'triceratops', n: 3, young: 1 }], biome: 'plain', seed: 5, frame: 1.8 }, { stage: 0.86, x1: 0.33, x2: 0.6 }),
  SC('fossil', 'Fossil Herd', 'Styracosaurus the colour of old bone, walking the badlands where their bone beds lie today.', ['fossil', 'ceratopsian', 'cretaceous', 'herd'],
    { style: 'fossil', cast: [{ sp: 'styracosaurus', n: 4, young: 1 }], biome: 'badlands', seed: 7, frame: 1.25 }, { stage: 0.805, light: 0.5, x1: 0, x2: 0.15 }),
  SC('neon', 'Neon Hunt', 'Utahraptors in acid yellow stalk green Iguanodon through the dark. Wait for the charge.', ['neon', 'theropod', 'ornithopod', 'cretaceous', 'hunt', 'night'],
    { style: 'neon', cast: [{ sp: 'iguanodon', n: 3 }, { sp: 'utahraptor', n: 3, role: 'pred' }], mode: 'hunt', biome: 'desert', seed: 14 }, { stage: 0.569, light: 0.1, activity: 0.7, x1: 0.12, x2: 0.7 }),
  SC('plate', 'Plate I: Stegosaurus', 'An anatomical plate on parchment. The leader lines follow the joints of the walking animal.', ['plate', 'diagram', 'stegosaur', 'jurassic'],
    { style: 'plate', cast: [{ sp: 'stegosaurus', n: 1 }], biome: 'plain', seed: 8, frame: 1.3, foot: 0.8 }, { stage: 0.44, x1: 0.35, x2: 0, x4: 1, detail: 0.4 }),
  SC('plate-trike', 'Plate II: Triceratops', 'The frill, the brow horns and the rest of a horned face, drawn from life and labelled.', ['plate', 'diagram', 'ceratopsian', 'cretaceous'],
    { style: 'plate', cast: [{ sp: 'triceratops', n: 1 }], biome: 'plain', seed: 12, frame: 1.3, foot: 0.8 }, { stage: 0.86, x1: 0.2, x2: 0, x4: 1, detail: 0.4 }),
  SC('museum', 'The Hall at Night', 'Morrison mounts on their plinths under the spotlights: Brachiosaurus, Stegosaurus, Allosaurus. They only look still.', ['museum', 'night', 'sauropod', 'stegosaur', 'theropod', 'jurassic'],
    { style: 'museum', cast: [{ sp: 'brachiosaurus', n: 1 }, { sp: 'stegosaurus', n: 1 }, { sp: 'allosaurus', n: 1 }], biome: { hills: 0, water: 0, density: 0.2, tall: 0.25, far: 'forest', ground: ['#3a3c46', '#16171c'], mult: { cycad: 3, treefern: 2, fern: 1, conifer: 0.4, rock: 0 } }, seed: 17, frame: 0.74 },
    { stage: 0.44, light: 0.1, x1: 0, x2: 0.55 }),
  SC('chase', 'Bone Run', 'Gallimimus skeletons at a flat run with an Albertosaurus right behind them, dust flying.', ['chase', 'theropod', 'cretaceous', 'hunt', 'herd'],
    { style: 'chase', cast: [{ sp: 'gallimimus', n: 5 }, { sp: 'albertosaurus', n: 1, role: 'pred' }], biome: 'desert', seed: 4, frame: 1.25 }, { stage: 0.83, light: 0.3, activity: 0.7, x1: 0, x2: 0.2 }),
  SC('deeptime', 'X-ray Safari', 'One valley X-rayed through 180 million years: the skeletons change as the eras go by, until the sky falls.', ['x-ray', 'time travel', 'herd', 'impact'],
    { style: 'xray', cast: 'era', biome: 'plain', seed: 1 }, { stage: 0.02, grow: 0.5, x1: 0.35, x2: 0.6 }),
];
