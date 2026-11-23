// Painterly: the shared world as paintings. Each frame the world is painted flat into a small off-screen buffer (with
// its alpha kept, so in combos the sky stays transparent), graded to the style's palette and read back. The picture is
// then rebuilt on the main canvas from brush marks on a fixed, seeded, jittered grid: every mark takes its colour and
// alpha from the buffer and its direction from the local image gradient, so the marks stay put while their colours
// change (it shimmers like paint and does not swim). The animals get a second set of marks that live in the animal's
// own frame and run along its spine and limbs, lit from above, so the brushwork follows the form.
// opts.style: impress · point · water · impasto · turner · gouache · nocturne · mural
import { createWorld } from '../world.js';
import { paintWorld, paintPlant, paintGround, drawParts, palette, feetY, hazeRGB, trace } from '../draw.js';
import { clamp, lerp, smooth, hash, rng, fbm2, skyGradient, wrap } from '../util.js';

const TAU = Math.PI * 2;
const mk = (w, h, o) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return { canvas: c, ctx: c.getContext('2d', o) }; };
const css = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`;

// ---------------------------------------------------------------- the styles
// cell: grid spacing as a fraction of the height · fine: spacing of the second (detail) pass relative to the first
// under: how the flat buffer goes down first · jit: broken-colour amount · tex: canvas | paper | plaster
const STYLES = {
  impress: { cell: 0.026, fine: 0.5, jit: 0.16, tex: 'canvas', light: 1, fogK: 0.7, mist: [0, 0.4] },
  point: { cell: 0.0145, fine: 0, jit: 0, tex: 'canvas', light: 1, fogK: 0.6, mist: [0, 0.35] },
  water: { cell: 0.036, fine: 0.4, jit: 0.06, tex: 'paper', light: 1, fogK: 0.8, mist: [[246, 242, 232], 0.45] },
  impasto: { cell: 0.03, fine: 0.5, jit: 0.13, tex: 'canvas', light: 1, fogK: 0.6, mist: [0, 0.3] },
  turner: { cell: 0.034, fine: 0.5, jit: 0.07, tex: 'canvas', light: 0.5, fogK: 0.9, tint: '#f6d590', mist: [[255, 216, 142], 0.9], glaze: ['rgba(64,34,18,', 0.5] },
  gouache: { cell: 0.03, fine: 0.5, jit: 0.02, tex: 'paper', light: 1, fogK: 0.5, mist: [0, 0.5] },
  nocturne: { cell: 0.03, fine: 0.5, jit: 0.05, tex: 'canvas', light: 0.8, fogK: 0.8, mist: [[156, 178, 224], 0.72], glaze: ['rgba(6,10,30,', 0.6] },
  mural: { cell: 0.022, fine: 0.5, jit: 0.07, tex: 'plaster', light: 1, fogK: 0.6, mist: [[236, 222, 190], 0.45] },
};

// ---------------------------------------------------------------- textures (one 256px tile each, built once)
const texCache = {};
function texture(kind) {
  if (texCache[kind]) return texCache[kind];
  const n = 256, { canvas, ctx } = mk(n, n), im = ctx.createImageData(n, n), d = im.data, R = rng(kind.length * 7919 + 13);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let v;
    if (kind === 'canvas') v = (Math.sin(x * Math.PI / 2 + 0.6 * Math.sin(y * 0.39)) + Math.sin(y * Math.PI / 2 + 0.6 * Math.sin(x * 0.29))) * 0.3 + (R() - 0.5) * 0.5;
    else if (kind === 'paper') v = (R() - 0.5) * 0.7 + (fbm2(x / 256 * 24, y / 256 * 40, 2) - 0.5) * 1.1 + (R() < 0.012 ? -0.6 : 0);
    else { const c = fbm2(x / 256 * 9, y / 256 * 9, 3), k = Math.abs(fbm2(x / 256 * 6 + 9, y / 256 * 6 + 4, 3) - 0.5); v = (c - 0.5) * 1.3 + (R() - 0.5) * 0.35 - (k < 0.006 ? 0.5 : 0); }
    const i = (y * n + x) * 4, c = v > 0 ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = c; d[i + 3] = Math.min(255, Math.abs(v) * 190);
  }
  ctx.putImageData(im, 0, 0);
  return texCache[kind] = canvas;
}

// ---------------------------------------------------------------- the fixed grid of marks
// [x, y, r1, r2, r3, flow] per mark, in a shuffled order so overlaps are even; jitter and flow never change
function makeGrid(w, h, cell, seed) {
  const nx = Math.ceil(w / cell) + 1, ny = Math.ceil(h / cell) + 1, n = nx * ny, R = rng(Math.imul(seed + 11, 2654435761)), g = new Float32Array(n * 6);
  const ord = new Uint32Array(n); for (let i = 0; i < n; i++) ord[i] = i;
  for (let i = n - 1; i > 0; i--) { const j = (R() * (i + 1)) | 0, t = ord[i]; ord[i] = ord[j]; ord[j] = t; }
  for (let q = 0; q < n; q++) {
    const i = ord[q] % nx, j = (ord[q] / nx) | 0, o = q * 6;
    const x = (i + (R() - 0.5) * 0.95) * cell, y = (j + (R() - 0.5) * 0.95) * cell;
    g[o] = x; g[o + 1] = y; g[o + 2] = R(); g[o + 3] = R(); g[o + 4] = R();
    g[o + 5] = fbm2(x / h * 2.3 + seed * 1.7, y / h * 2.3 + 4.1, 2);
  }
  return g;
}

// pointillist palette: a handful of pure hues at a few values, so the dots can be batched by colour
function rgb2hsv(r, g, b, o) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d > 0) { if (mx === r) h = ((g - b) / d + 6) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; }
  o[0] = h * 60; o[1] = mx ? d / mx : 0; o[2] = mx / 255;
}
const dotCss = new Map();
function dotColour(key) {
  let c = dotCss.get(key); if (c) return c;
  const hq = (key / 100) | 0, sq = ((key / 10) | 0) % 10, vq = key % 10, h = hq * 15, s = sq / 9, v = vq / 9;
  const f = n => { const k = (n + h / 60) % 6; return 255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1))); };
  c = css(f(5), f(3), f(1)); dotCss.set(key, c); return c;
}

export default {
  id: 'painterly',
  name: 'Painterly',
  kind: '2d',
  sky: true,
  params: [
    { id: 'x1', label: 'Brush size', value: 0.5, tip: 'Size of the brush marks' },
    { id: 'x2', label: 'Looseness', value: 0.5, tip: 'How freely the marks wander from the forms' },
    { id: 'x3', label: 'Texture', value: 0.5, tip: 'Canvas weave, paper grain or plaster' },
    { id: 'x4', label: 'Finish', value: 0.6, tip: 'How much fine work goes into edges and animals' },
  ],
  create(ctx, opts) {
    const W = createWorld(opts), style = STYLES[opts.style] ? opts.style : 'impress', ST = STYLES[style], seed = opts.seed ?? 1;
    const B = mk(8, 8, { willReadFrequently: true }), M = mk(8, 8);
    let g1 = null, g2 = null, key1 = '', key2 = '', pat = null, D = null, bw = 8, bh = 8, kx = 1, ky = 1;
    const hsv = [0, 0, 0], buckets = new Map();
    let cr = 0, cg = 0, cb = 0;

    // ---- flat painters for the buffer
    function flatSky(f, v) {
      const c = f.ctx, { w, h } = f;
      // (not util.skyGradient: its hue interpolation passes through green on the way into dusk)
      const day = smooth(0.02, 0.62, v.light), dk = Math.max(0, 1 - Math.abs(v.light - 0.3) / 0.22), m3 = (a, b2, d) => { const o = [0, 0, 0]; for (let i = 0; i < 3; i++) o[i] = lerp(lerp(a[i], b2[i], day), d[i], dk * 0.85); return css(o[0], o[1], o[2]); };
      const sg = c.createLinearGradient(0, 0, 0, v.horizon * 1.05);
      sg.addColorStop(0, m3([6, 10, 28], [70, 136, 212], [58, 78, 138])); sg.addColorStop(0.6, m3([14, 22, 48], [142, 190, 232], [222, 140, 104])); sg.addColorStop(1, m3([26, 36, 64], [204, 226, 240], [250, 200, 128]));
      c.fillStyle = sg; c.fillRect(0, 0, w, h);
      if (v.dark > 0) { c.fillStyle = `rgba(38,26,20,${v.dark * 0.75})`; c.fillRect(0, 0, w, h); }
      // a few banks of cloud give the sky something for the brush to follow
      const hz = hazeRGB(v.light), L = v.light, cl = [lerp(hz[0], 255, 0.25 + 0.5 * L), lerp(hz[1], 250, 0.25 + 0.5 * L), lerp(hz[2], 244, 0.25 + 0.5 * L)];
      for (let i = 0; i < 8; i++) {
        const s = h * (0.045 + 0.06 * hash(i, 4, seed)), cx = wrap(hash(i, 1, seed) * w * 1.5 + f.t * h * 0.006 * (v.wind || 0.5) * (0.5 + hash(i, 2)), -w * 0.25, w * 1.25), cy = v.horizon * (0.1 + 0.62 * hash(i, 3, seed));
        for (let j = 0; j < 6; j++) {
          const u = j / 5, sh = 0.82 + 0.18 * (j % 2);
          c.fillStyle = `rgba(${cl[0] * sh | 0},${cl[1] * sh | 0},${cl[2] * sh | 0},${(0.42 + 0.3 * hash(i, j)) * (1 - v.dark)})`;
          c.beginPath(); c.ellipse(cx + (u - 0.5) * s * 5, cy - Math.sin(u * Math.PI) * s * 0.5 + (j % 2) * s * 0.3, s * (1 + 0.6 * hash(i, j + 5)), s * (0.36 + 0.2 * hash(j, i)), 0, 0, TAU); c.fill();
        }
      }
    }
    // plants further back than the stage go paler, so the animals stand clear of them
    function flatPlant(f, v, it) { const fog = it.fog; it.fog = fog > 0.02 ? Math.min(0.92, fog * 1.8 + 0.1) : fog; paintPlant(f, v, it); it.fog = fog; }
    // each ground band lays a little of the style's air over everything behind it (never over open sky in a combo)
    function flatGround(f, v, b) {
      paintGround(f, v, b);
      const c = f.ctx, n = v.layers.length, [mc, tot] = ST.mist;
      if (b.u > 0.999 || tot <= 0) return;
      const a = 1 - Math.pow(1 - tot, 1.6 / n), m = mc || hazeRGB(v.light).map(x => x + (255 - x) * 0.2 * v.light), top = v.horizon - f.h * 0.3;
      const g = c.createLinearGradient(0, top, 0, v.horizon); g.addColorStop(0, `rgba(${m[0] | 0},${m[1] | 0},${m[2] | 0},0)`); g.addColorStop(1, `rgba(${m[0] | 0},${m[1] | 0},${m[2] | 0},${a})`);
      const L = mc ? 0.35 + 0.65 * Math.max(v.light, style === 'nocturne' ? 0.5 : 0) : 1;
      c.globalCompositeOperation = 'source-atop'; c.globalAlpha = L * (1 - 0.7 * v.dark); c.fillStyle = g; c.fillRect(0, top, f.w, Math.min(f.h, b.next + f.h * 0.02) - top);
      c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    }
    function flatDino(f, v, it) {
      const c = f.ctx, T = it.T, fade = it.fade ?? 1;
      const fog = clamp(it.fog * ST.fogK, 0, 0.86), light = lerp(v.light, 1, 0.45) * ST.light;
      if (fade < 1) c.globalAlpha = fade;
      if (it.type === 'dino') {
        const q = it.pose, gy = T.y - feetY(q) * T.k, rx = it.sp.len * q.scale * T.k * 0.32;
        if (!it.wade) { c.fillStyle = style === 'impress' || style === 'point' ? `rgba(40,30,110,${0.3 * (0.4 + 0.6 * v.light) * fade})` : `rgba(10,8,20,${0.28 * (0.4 + 0.6 * v.light) * fade})`;
          c.beginPath(); c.ellipse(T.x + q.nodes[q.iSh].x * 0.5 * T.k * T.dir, gy, rx, rx * 0.15, 0, 0, TAU); c.fill(); }
      }
      const look = { pal: palette(it.sp, { light, fog, tint: ST.tint }) };
      if (it.wade) { c.save(); c.beginPath(); c.rect(0, 0, f.w, it.waterY); c.clip(); drawParts(c, it.parts, T, look); c.restore();
        c.strokeStyle = `rgba(255,255,255,${0.4 * v.light})`; c.lineWidth = Math.max(1, T.k * 0.05); c.beginPath(); c.ellipse(T.x, it.waterY, it.sp.len * T.k * 0.22, it.sp.len * T.k * 0.02, 0, 0, TAU); c.stroke(); }
      else drawParts(c, it.parts, T, look);
      if (ST.glaze && it.type === 'dino' && !it.wade) { const col = ST.glaze[0] + (ST.glaze[1] * (1 - fog) * fade).toFixed(3) + ')'; drawParts(c, it.parts.filter(q => !q.l && q.t !== 'eye' && q.k !== 'mark' && q.k !== 'belly'), T, { fill: () => col, pupil: false }); }
      c.globalAlpha = 1;
    }

    // ---- the style's palette, applied to the whole buffer with blend modes
    function grade(f, v) {
      const b = B.ctx, tint = (op, col, a) => { b.globalCompositeOperation = op; b.globalAlpha = a; b.fillStyle = col; b.fillRect(0, 0, bw, bh); };
      b.setTransform(1, 0, 0, 1, 0, 0);
      const sx = v.sun.x * kx, sy = v.sun.y * ky;
      if (style === 'impress') { tint('saturation', '#ff0000', 0.16); tint('soft-light', '#fff2c8', 0.35); }
      else if (style === 'point') { tint('saturation', '#ff0000', 0.22); tint('screen', '#fff0d0', 0.1); }
      else if (style === 'water') { tint('saturation', '#ff0000', 0.1); tint('screen', '#ffffff', 0.2); }
      else if (style === 'impasto') { tint('saturation', '#ff0000', 0.3); b.globalCompositeOperation = 'soft-light'; b.globalAlpha = 0.55; b.drawImage(B.canvas, 0, 0); }
      else if (style === 'turner') {
        tint('color', '#d9a550', 0.5);
        const hz = v.horizon * ky, g = b.createLinearGradient(0, hz - bh * 0.3, 0, hz + bh * 0.22);
        g.addColorStop(0, 'rgba(255,214,140,0)'); g.addColorStop(0.58, 'rgba(255,224,160,0.16)'); g.addColorStop(1, 'rgba(255,214,140,0)');
        tint('screen', g, 1);
        const r = b.createRadialGradient(sx, sy, 0, sx, sy, bh * 0.75);
        r.addColorStop(0, 'rgba(255,248,214,0.95)'); r.addColorStop(0.2, 'rgba(255,226,150,0.4)'); r.addColorStop(1, 'rgba(255,200,120,0)');
        tint('screen', r, 1);
      }
      else if (style === 'gouache') tint('saturation', '#ff0000', 0.12);
      else if (style === 'nocturne') {
        tint('color', '#3f6aa6', 0.72); tint('multiply', '#93a8d6', 0.45);
        const r = b.createRadialGradient(sx, sy, 0, sx, sy, bh * 0.6);
        r.addColorStop(0, 'rgba(200,216,240,0.4)'); r.addColorStop(1, 'rgba(160,190,230,0)');
        tint('screen', r, 1);
      }
      else if (style === 'mural') { tint('saturation', '#808080', 0.3); tint('soft-light', '#e9c487', 0.6); tint('multiply', '#f6e6c6', 0.6); }
      b.globalAlpha = 1;
      if (f.combo) { b.globalCompositeOperation = 'destination-in'; b.drawImage(M.canvas, 0, 0); }
      b.globalCompositeOperation = 'source-over';
    }

    // ---- sampling
    const lum = i => D[i] * 0.3 + D[i + 1] * 0.59 + D[i + 2] * 0.11;
    function sample(x, y) {           // canvas pixels → cr, cg, cb; returns alpha
      let bx = (x * kx) | 0, by = (y * ky) | 0;
      if (bx < 0) bx = 0; else if (bx >= bw) bx = bw - 1; if (by < 0) by = 0; else if (by >= bh) by = bh - 1;
      const i = (by * bw + bx) * 4; cr = D[i]; cg = D[i + 1]; cb = D[i + 2]; return D[i + 3];
    }
    // broken colour for the style: (r1..r3 are the mark's own fixed random numbers)
    function broken(r1, r2, r3, amt) {
      const l = (cr * 0.3 + cg * 0.59 + cb * 0.11) / 255;
      if (style === 'impress') {            // violet-blue shadows, warm lights
        if (l < 0.45) { const t = (0.45 - l) * (0.6 + 0.9 * r3); cr = lerp(cr, 70, t); cg = lerp(cg, 52, t); cb = lerp(cb, 150, t); }
        else if (l > 0.62) { const t = (l - 0.62) * 0.7 * r3; cr = lerp(cr, 255, t); cg = lerp(cg, 236, t); cb = lerp(cb, 170, t); }
      }
      const k = 1 + (r2 - 0.5) * amt * 1.3, a = amt * 255;
      cr = cr * k + (r1 - 0.5) * a; cg = cg * k + (r3 - 0.5) * a * 0.7; cb = cb * k + (0.5 - r1) * a;
    }
    function dotKey(r1, r2) {               // pick one pure-colour dot for the colour in cr, cg, cb
      rgb2hsv(cr, cg, cb, hsv);
      let h = hsv[0], s = hsv[1], v = hsv[2];
      if (s < 0.16) { h = r1 < 0.34 ? 215 : r1 < 0.6 ? 30 : r1 < 0.82 ? 320 : 55; s = 0.22 + 0.2 * r2; v = Math.min(1, v * 1.04); }
      else { if (r1 < 0.56) { } else if (r1 < 0.76) { h += 18; v *= 1.06; } else if (r1 < 0.96) { h -= 18; v *= 1.06; } else { h += 180; v *= 0.9; s *= 0.6; }
        s = Math.min(0.74, s + 0.06); v = Math.min(1, v * (0.94 + 0.14 * r2)); }
      const hq = Math.round(((h % 360) + 360) % 360 / 15) % 24, sq = Math.round(s * 9), vq = Math.round(v * 9);
      return hq * 100 + sq * 10 + vq;
    }
    const line = (x, y, dx, dy, wd, col) => { ctx.lineWidth = wd; ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(x - dx, y - dy); ctx.lineTo(x + dx, y + dy); ctx.stroke(); };

    // one brush mark of the current style. pass 1 = the broad lay-in, 2 = fine work on edges, 3 = on an animal
    // (sh = −1 underside … +1 back, for modelling the form)
    function mark(x, y, ang, cell, pass, r1, r2, r3, sh, len0, wid0) {
      const body = pass === 3, fine = pass === 2, ca = Math.cos(ang), sa = Math.sin(ang);
      if (body) { const k = 1 + sh * 0.27; cr *= k; cg *= k; cb *= k; }
      switch (style) {
        case 'impress': {
          broken(r1, r2, r3, ST.jit * (body ? 0.7 : 1));
          const l = body ? len0 * 0.7 : cell * (fine ? 0.6 : 0.95) * (0.7 + 0.6 * r2), wd = body ? wid0 : cell * (fine ? 0.42 : 0.85);
          line(x, y, ca * l, sa * l, wd, css(cr, cg, cb)); break; }
        case 'point': {
          ctx.fillStyle = dotColour(dotKey(r1, r2)); ctx.beginPath(); ctx.arc(x, y, Math.max(0.7, wid0 * 0.5), 0, TAU); ctx.fill(); break; }
        case 'water': {
          if (body) { ctx.globalAlpha *= 0.6; broken(r1, r2, r3, 0.05); line(x, y, ca * len0, sa * len0, wid0 * 1.2, css(cr * 0.86, cg * 0.86, cb * 0.88)); }
          else if (fine) { ctx.globalAlpha = 0.34 + 0.3 * r2; line(x, y, ca * cell * 1.1, sa * cell * 1.1, cell * (0.1 + 0.16 * r1), css(cr * 0.62, cg * 0.62, cb * 0.68)); }
          else { broken(r1, r2, r3, ST.jit); ctx.globalAlpha = 0.16 + 0.16 * r3; ctx.fillStyle = css(cr * 0.94, cg * 0.94, cb * 0.96);
            ctx.beginPath(); ctx.ellipse(x, y, cell * (0.8 + 0.7 * r1), cell * (0.5 + 0.5 * r2), ang, 0, TAU); ctx.fill(); }
          break; }
        case 'impasto': {
          broken(r1, r2, r3, ST.jit * (body ? 0.6 : 1));
          const l = body ? len0 * 1.1 : cell * (fine ? 0.9 : 1.9) * (0.7 + 0.6 * r2), wd = body ? wid0 : cell * (fine ? 0.4 : 0.8);
          const dx = ca * l, dy = sa * l, ox = -sa * wd * 0.3, oy = ca * wd * 0.3, up = oy < 0 ? 1 : -1;      // the ridge catches light from above
          line(x, y, dx, dy, wd, css(cr, cg, cb));
          line(x + ox * up, y + oy * up, dx * 0.82, dy * 0.82, wd * 0.2, css(cr * 1.16 + 34, cg * 1.16 + 32, cb * 1.12 + 24));
          line(x - ox * up, y - oy * up, dx * 0.86, dy * 0.86, wd * 0.16, css(cr * 0.68, cg * 0.66, cb * 0.72));
          break; }
        case 'turner': {
          broken(r1, r2, r3, ST.jit);
          if (body) { ctx.globalAlpha = 0.8; line(x, y, ca * len0, sa * len0, wid0, css(cr, cg, cb)); }
          else { ctx.globalAlpha = fine ? 0.5 : 0.3 + 0.2 * r3; const l = cell * (fine ? 0.8 : 1.9) * (0.6 + 0.8 * r2); line(x, y, ca * l, sa * l, cell * (fine ? 0.4 : 1.15), css(cr, cg, cb)); }
          break; }
        case 'gouache': {
          const k = 1 + (r2 - 0.5) * 0.07; cr *= k; cg *= k; cb *= k;
          if (body) line(x, y, ca * len0, sa * len0, wid0, css(cr, cg, cb));
          else if (fine) { const l = cell * (1 + 1.3 * r2), c = css(cr, cg, cb), wd = Math.max(0.6, cell * 0.09);      // dry brush: a few dragged hairs
            for (let j = -1; j <= 1; j++) { const o = (j + (r1 - 0.5) * 0.6) * cell * 0.24, lj = l * (0.55 + 0.45 * hash(j, r3 * 91)); line(x - sa * o + ca * (r3 - 0.5) * cell, y + ca * o + sa * (r3 - 0.5) * cell, ca * lj, sa * lj, wd, c); } }
          else { const l = cell * 0.8; line(x, y, ca * l, sa * l, cell * 1.05, css(cr, cg, cb)); }
          break; }
        case 'nocturne': {
          broken(r1, r2, r3, ST.jit);
          if (body) { let wd = wid0; if (sh > 0.55) { const t = Math.min(1, (sh - 0.55) * 3); cr = lerp(cr, 186, t); cg = lerp(cg, 204, t); cb = lerp(cb, 232, t); wd = wid0 * lerp(1, 0.4, t); } line(x, y, ca * len0, sa * len0, wd, css(cr, cg, cb)); }
          else { ctx.globalAlpha = fine ? 0.75 : 0.62; const l = cell * (fine ? 0.8 : 2.2) * (0.6 + 0.8 * r2); line(x, y, ca * l, sa * l, cell * (fine ? 0.3 : 0.62), css(cr, cg, cb)); }
          break; }
        default: {                            // mural: quiet tempera hatching
          broken(r1, r2, r3, ST.jit * (body ? 0.6 : 1));
          const l = body ? len0 * 0.8 : cell * (fine ? 0.6 : 1) * (0.7 + 0.6 * r2), wd = body ? wid0 * 0.8 : cell * (fine ? 0.34 : 0.72);
          ctx.globalAlpha = body ? 0.9 : 0.85; line(x, y, ca * l, sa * l, wd, css(cr, cg, cb)); }
      }
    }

    // direction for a mark where the picture has no edge to follow
    function flow(x, y, nz, v) {
      if (style === 'turner') { const a = Math.atan2(y - v.sun.y, x - v.sun.x); return y < v.horizon ? a + Math.PI / 2 + (nz - 0.5) * 1.6 : (nz - 0.5) * 0.7; }
      if (style === 'nocturne') return (nz - 0.5) * 0.35;
      if (style === 'impasto') return y < v.horizon ? (nz - 0.5) * 7 + Math.sin(x / v.h * 2.2) * 0.7 : (nz - 0.5) * 1.3;
      if (style === 'mural') return y < v.horizon ? -0.5 + (nz - 0.5) * 0.8 : (nz - 0.5) * 0.7;
      return y < v.horizon ? -0.35 + (nz - 0.5) * 2.4 : (nz - 0.5) * 1.1;
    }

    function gridPass(f, v, g, cell, pass, loose, thr2) {
      const n = g.length / 6, gd = Math.max(1, Math.round(cell * 0.45 * kx)), edge = style === 'gouache' ? 9 : style === 'impasto' ? 26 : 14, w = f.w, h = f.h;
      const point = style === 'point', water = style === 'water', pr = cell * 0.47;
      if (point) buckets.forEach(a => { a.length = 0; });
      for (let q = 0; q < n; q++) {
        const o = q * 6, x = g[o], y = g[o + 1];
        let bx = (x * kx) | 0, by = (y * ky) | 0;
        if (bx < 0 || by < 0 || bx >= bw || by >= bh) continue;
        const i = (by * bw + bx) * 4;
        if (D[i + 3] < 170) continue;
        const r1 = g[o + 2], r2 = g[o + 3], r3 = g[o + 4];
        cr = D[i]; cg = D[i + 1]; cb = D[i + 2];
        if (point) { const k = dotKey(r1, r2); let a = buckets.get(k); if (!a) buckets.set(k, a = []); a.push(x, y, pr * (0.8 + 0.4 * r3)); continue; }
        const xl = bx - gd < 0 ? 0 : bx - gd, xr = bx + gd >= bw ? bw - 1 : bx + gd, yu = by - gd < 0 ? 0 : by - gd, yd = by + gd >= bh ? bh - 1 : by + gd;
        const gx = lum((by * bw + xr) * 4) - lum((by * bw + xl) * 4), gy = lum((yd * bw + bx) * 4) - lum((yu * bw + bx) * 4), mag = Math.abs(gx) + Math.abs(gy);
        if (pass === 2 && mag < thr2) continue;
        if (water && pass === 1) {            // leave paper showing in the lights, at the edges of the sheet and here and there
          if (r3 < 0.1 || lum(i) > 222 && r2 < 0.7) continue;
          if (!f.combo) { const m = Math.min(x, y, w - x, h - y) / (h * 0.07); if (m < 1 && r1 > m) continue; }
        }
        const ang = (mag > edge ? Math.atan2(gy, gx) + Math.PI / 2 : flow(x, y, g[o + 5], v)) + (r2 - 0.5) * loose * 1.5;
        mark(x, y, ang, cell, pass, r1, r2, r3, 0, 0, 0);
      }
      if (point) for (const [k, a] of buckets) { if (!a.length) continue; ctx.fillStyle = dotColour(k); ctx.beginPath(); for (let j = 0; j < a.length; j += 3) { ctx.moveTo(a[j] + a[j + 2], a[j + 1]); ctx.arc(a[j], a[j + 1], a[j + 2], 0, TAU); } ctx.fill(); }
      ctx.globalAlpha = 1;
    }

    // marks that belong to one animal: seeded by the actor, placed along the spine and the near limbs in the
    // animal's own frame, coloured from the buffer where they land (so plants in front still cover it)
    function animalMarks(f, v, it, cell, loose, finish, cap) {
      const q = it.pose, T = it.T, N = q.nodes, nn = N.length, k = T.k, sxk = k * T.dir, fade = it.fade ?? 1;
      const Lpx = it.sp.len * q.scale * k;
      if (Lpx < cell * 1.2 || T.x < -Lpx || T.x > f.w + Lpx) return;
      const R = rng(Math.imul((it.actor?.id ?? 1) + 5, 2654435761));
      const n = Math.round(clamp(Lpx / cell * 15, 16, cap) * (0.45 + 0.75 * finish) * (style === 'point' ? 1.5 : 1));
      const lenS = Lpx * (style === 'impasto' ? 0.05 : 0.036), base = fade * (style === 'water' ? 1 : 1);
      ctx.globalAlpha = base;
      for (let j = 0; j < n; j++) {
        const s = R() * (nn - 1.001), u = R() * 2 - 1, r1 = R(), r2 = R(), i0 = s | 0, t = s - i0, a = N[i0], b = N[i0 + 1];
        const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t, rr = (u < 0 ? (a.b ?? a.r) + ((b.b ?? b.r) - (a.b ?? a.r)) * t : a.r + (b.r - a.r) * t);
        let tx = b.x - a.x, ty = b.y - a.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        const off = u * rr * 0.8, X = T.x + (px - ty * off) * sxk, Y = T.y - (py + tx * off) * k;
        if (it.wade && Y > it.waterY) continue;
        if (sample(X, Y) < 170) continue;
        const wid = clamp(rr * k * 0.55, Math.max(0.8, cell * 0.12), cell * 0.7);
        ctx.globalAlpha = base;
        mark(X, Y, Math.atan2(-ty, tx * T.dir) + (r2 - 0.5) * loose * 0.7, cell, 3, r1, r2, R(), u, Math.max(lenS, wid * 0.9) * (0.6 + 0.8 * r1), wid);
      }
      // limbs: a few marks down each near leg and arm
      const limb = (g, rad) => {
        for (let sgm = 0; sgm < 3; sgm++) {
          const a = g.pts[sgm], b = g.pts[sgm + 1], dx = (b[0] - a[0]) * sxk, dy = -(b[1] - a[1]) * k, sl = Math.hypot(dx, dy);
          const wid = clamp(rad(sgm) * k * 1.1, Math.max(0.8, cell * 0.1), cell * 0.6), m = Math.max(1, Math.min(4, Math.round(sl / (wid * 2.2))));
          if (sl < 1.5) continue;
          for (let c = 0; c < m; c++) {
            const t = (c + 0.2 + 0.6 * R()) / m, X = T.x + a[0] * sxk + dx * t, Y = T.y - a[1] * k + dy * t, r1 = R();
            if (it.wade && Y > it.waterY) continue;
            if (sample(X, Y) < 170) continue;
            ctx.globalAlpha = base;
            mark(X, Y, Math.atan2(dy, dx), cell, 3, r1, R(), R(), g.near ? 0.1 : -0.5, sl / m * 0.5, wid);
          }
        }
      };
      for (const g of q.legs) limb(g, s => g.R[s] ?? g.R[2]);
      for (const g of q.arms || []) if (g.near && g.pts) limb(g, () => g.r);
      ctx.globalAlpha = 1;
    }

    // put the animal's own shape back, crisp, from the buffer (which already has whatever stands in front of it)
    function restore(f, it) {
      const T = it.T, big = it.sp.len * T.k;
      if (T.x < -big || T.x > f.w + big || big < 6) return false;
      ctx.save(); ctx.beginPath();
      if (it.wade) { ctx.rect(0, 0, f.w, it.waterY); ctx.clip(); ctx.beginPath(); }
      for (const q of it.parts) if (!q.l && q.k !== 'mark' && q.k !== 'belly' && q.k !== 'eye') trace(ctx, q, T);
      ctx.clip('nonzero');
      const x0 = Math.max(0, T.x - big * 1.1), x1 = Math.min(f.w, T.x + big * 1.1), y0 = Math.max(0, T.y - big * 1.2), y1 = Math.min(f.h, T.y + big * 0.3);
      if (x1 > x0 && y1 > y0) ctx.drawImage(B.canvas, x0 * kx, y0 * ky, (x1 - x0) * kx, (y1 - y0) * ky, x0, y0, x1 - x0, y1 - y0);
      return true;
    }

    // the last touches on an animal: eye, teeth, horns and claws put in crisply, and the style's own drawing
    const OUT = new Set(['body', 'skull', 'jaw', 'leg', 'arm', 'plate', 'frill', 'sail', 'crest', 'horn', 'spike', 'club', 'beak', 'wing']);
    function accents(f, v, it, finish) {
      const T = it.T, fade = it.fade ?? 1, h = f.h, big = it.sp.len * T.k;
      if (T.x < -big || T.x > f.w + big) return;
      if (it.wade) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, f.w, it.waterY); ctx.clip(); }
      if (style === 'water') {              // pencil under-drawing, a little out of register with the washes
        const ps = it.parts.filter(p => !p.l && OUT.has(p.k) && p.t !== 'far' && p.t !== 'accentFar'), off = h * 0.0022;
        ctx.globalAlpha = fade * 0.62 * (1 - 0.6 * it.fog); drawParts(ctx, ps, { x: T.x + off, y: T.y - off * 0.6, k: T.k, dir: T.dir }, { stroke: '#4a4440', lw: Math.max(0.6, h * 0.0015), fill: () => null });
        ctx.globalAlpha = fade * 0.3 * (1 - 0.6 * it.fog); drawParts(ctx, ps.filter(p => p.k === 'body' || p.k === 'skull'), { x: T.x - off * 0.4, y: T.y + off * 0.5, k: T.k * 1.006, dir: T.dir }, { stroke: '#4a4440', lw: Math.max(0.5, h * 0.0011), fill: () => null });
      } else if (style === 'mural' || style === 'gouache') {      // a soft drawn contour, as on the old murals
        const ps = it.parts.filter(p => !p.l && (p.k === 'body' || p.k === 'skull' || p.k === 'jaw' || p.k === 'leg' && p.t === 'body'));
        ctx.globalAlpha = fade * (style === 'mural' ? 0.42 : 0.2) * finish * (1 - it.fog); drawParts(ctx, ps, T, { stroke: style === 'mural' ? '#3a2616' : '#1c1a22', lw: Math.max(0.6, Math.min(h * 0.003, big * 0.006)), fill: () => null });
      }
      if (style !== 'point' || big > h * 0.25) {
        const night = style === 'nocturne', pal = palette(it.sp, { light: Math.max(0.5, lerp(v.light, 1, 0.35) * ST.light), fog: clamp(it.fog * ST.fogK, 0, 0.8), tint: ST.tint });
        if (night) { pal.eye = '#e9f0ff'; pal.horn = '#9fb2d2'; } else if (style === 'mural') pal.horn = '#d9c79c';
        ctx.globalAlpha = fade * clamp(0.35 + finish);
        drawParts(ctx, it.parts.filter(p => p.t === 'eye' || p.t === 'horn' && !p.l), T, { pal, pupil: !night });
      }
      ctx.globalAlpha = 1;
      if (it.wade) ctx.restore();
    }

    function extras(f, v, cell) {
      const { w, h } = f;
      if (style === 'nocturne') {           // a few lit points: stars, the moon's path on any water
        if (!f.combo) {
          const s = v.sun, mg = ctx.createRadialGradient(s.x, s.y, s.r * 0.5, s.x, s.y, s.r * 3.5); mg.addColorStop(0, 'rgba(214,226,250,0.5)'); mg.addColorStop(1, 'rgba(214,226,250,0)');
          ctx.globalAlpha = 1 - v.dark; ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 3.5, 0, TAU); ctx.fill();
          ctx.fillStyle = '#eef2fc'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 0.85, 0, TAU); ctx.fill();
          for (let i = 0; i < 26; i++) { const x = hash(i, 11, seed) * w, y = hash(i, 12, seed) * v.horizon * 0.86, tw = 0.55 + 0.45 * Math.sin(f.t * (0.7 + hash(i, 3)) + i * 9);
            if (sample(x, y) < 10) continue; const l = (cr + cg + cb) / 3; if (l > 120) continue;
            ctx.globalAlpha = (0.35 + 0.65 * hash(i, 13)) * tw * (1 - v.dark); ctx.fillStyle = hash(i, 14) < 0.2 ? '#ffe9b8' : '#eef3ff';
            ctx.beginPath(); ctx.arc(x, y, h * (0.0022 + 0.003 * hash(i, 15)), 0, TAU); ctx.fill(); }
        }
        ctx.strokeStyle = '#dfe8fa'; ctx.lineCap = 'round';
        for (const b of v.layers) if (b.anyWet) for (let i = 0; i < 14; i++) {
          const x = v.sun.x + (hash(i, b.d, 1) - 0.5) * w * 0.3, y = lerp(b.level, Math.min(b.next, h), hash(i, b.d, 2)), ci = Math.round(x / w * 36) + 1;
          if (!b.wet[ci]) continue;
          ctx.globalAlpha = (0.25 + 0.5 * hash(i, b.d, 3)) * (0.5 + 0.5 * Math.sin(f.t * 1.7 + i * 5 + b.d));
          const l = cell * (0.5 + hash(i, b.d, 4)) * (0.4 + b.u); ctx.lineWidth = Math.max(0.7, cell * 0.14); ctx.beginPath(); ctx.moveTo(x - l, y); ctx.lineTo(x + l, y); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }

    function frieze(f) {                    // the mural's painted border and label
      const { w, h } = f, bh2 = Math.round(h * 0.05), E = f.era;
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      const band = y => {
        ctx.fillStyle = '#4b3524'; ctx.fillRect(0, y, w, bh2);
        ctx.fillStyle = '#c9a868'; ctx.fillRect(0, y + (y ? 0 : bh2 - Math.max(1, h * 0.004)), w, Math.max(1, h * 0.004));
        ctx.fillStyle = '#a9823f'; const s = bh2 * 0.3;
        for (let x = bh2; x < w; x += bh2 * 1.6) { if (y && Math.abs(x - w / 2) < w * 0.24) continue; ctx.beginPath(); ctx.moveTo(x - s, y + bh2 / 2); ctx.lineTo(x, y + bh2 / 2 - s * 0.7); ctx.lineTo(x + s, y + bh2 / 2); ctx.lineTo(x, y + bh2 / 2 + s * 0.7); ctx.closePath(); ctx.fill(); }
      };
      if (!f.combo) band(0);
      band(h - bh2);
      if (E && E.name) {
        ctx.fillStyle = '#ead9b0'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `${Math.max(7, bh2 * 0.56)}px Georgia, 'Times New Roman', serif`;
        const ma = E.ma >= 100 ? Math.round(E.ma) : Math.round(E.ma * 10) / 10;
        ctx.fillText(`${String(E.name).toUpperCase()}  ·  ${ma} MILLION YEARS AGO`, w / 2, h - bh2 / 2 + 1, w * 0.46);
      }
    }

    return {
      render(f) {
        const v = W.frame(f), p = f.p, { w, h } = f;
        // ---- 1. the flat picture, small
        const nbh = Math.min(h, Math.max(200, Math.round(h * 0.42))), nbw = Math.max(8, Math.round(w * nbh / h));
        if (nbw !== bw || nbh !== bh) { bw = B.canvas.width = nbw; bh = B.canvas.height = nbh; M.canvas.width = bw; M.canvas.height = bh; }
        kx = bw / w; ky = bh / h;
        const b = B.ctx;
        b.setTransform(kx, 0, 0, ky, 0, 0); b.globalAlpha = 1; b.globalCompositeOperation = 'source-over';
        const f2 = { ...f, ctx: b };
        paintWorld(f2, v, { sky: flatSky, dino: flatDino, plant: flatPlant, ground: flatGround });
        b.setTransform(1, 0, 0, 1, 0, 0);
        if (f.combo) { M.ctx.clearRect(0, 0, bw, bh); M.ctx.drawImage(B.canvas, 0, 0); }
        grade(f, v);
        const img = b.getImageData(0, 0, bw, bh); D = img.data;
        if (style === 'gouache') {          // flat poster shapes
          for (let i = 0, n = D.length; i < n; i += 4) { D[i] = ((D[i] + 21) / 42 | 0) * 42; D[i + 1] = ((D[i + 1] + 21) / 42 | 0) * 42; D[i + 2] = ((D[i + 2] + 21) / 42 | 0) * 42; }
          b.putImageData(img, 0, 0);
        }

        // ---- 2. the ground the marks go on
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.imageSmoothingEnabled = true;
        if (f.combo) ctx.clearRect(0, 0, w, h);
        if (style === 'water') {
          const paper = '#f6f0e2';
          if (f.combo) { ctx.drawImage(B.canvas, 0, 0, w, h); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = paper; ctx.fillRect(0, 0, w, h); }
          else { ctx.fillStyle = paper; ctx.fillRect(0, 0, w, h); }
          ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.6; ctx.drawImage(B.canvas, 0, 0, w, h);
          ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
          if (!f.combo) {                   // the wash thins out towards the edge of the sheet
            const m = h * 0.075, e = (x0, y0, x1, y1, rx, ry, rw, rh) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, 'rgba(246,240,226,0.96)'); g.addColorStop(1, 'rgba(246,240,226,0)'); ctx.fillStyle = g; ctx.fillRect(rx, ry, rw, rh); };
            e(0, 0, m, 0, 0, 0, m, h); e(w, 0, w - m, 0, w - m, 0, m, h); e(0, 0, 0, m, 0, 0, w, m); e(0, h, 0, h - m, 0, h - m, w, m);
          }
        } else ctx.drawImage(B.canvas, 0, 0, w, h);

        // ---- 3. brush marks on the fixed grid
        const det = lerp(0.72, 1.3, clamp(p.detail)), loose = clamp(p.x2), finish = clamp(p.x4);
        const cell = Math.max(2.2, h * ST.cell * lerp(0.55, 1.75, clamp(p.x1)) / det);
        const k1 = `${w}|${h}|${cell.toFixed(2)}`;
        if (k1 !== key1) { g1 = makeGrid(w, h, cell, seed); key1 = k1; }
        const dinos = []; for (const band of v.layers) for (const it of band.items) if (it.type === 'dino') dinos.push(it);
        if (style === 'point') for (const it of dinos) if (restore(f, it)) ctx.restore();
        gridPass(f, v, g1, cell, 1, loose, 0);
        let cell2 = cell;
        if (ST.fine && finish > 0.04) {
          cell2 = Math.max(1.8, cell * ST.fine);
          if (k1 !== key2) { g2 = makeGrid(w, h, cell2, seed + 77); key2 = k1; }
          gridPass(f, v, g2, cell2, 2, loose * 0.6, lerp(60, 12, finish));
        }

        // ---- 4. the animals, far to near
        const cap = clamp(1500 * det / Math.max(1, dinos.length), 70, 260);
        const acell = style === 'point' ? cell * 0.8 : cell2;
        for (const it of dinos) { const cl = style !== 'point' && restore(f, it); if (cl && loose > 0.75) { ctx.restore(); } animalMarks(f, v, it, acell, loose, finish, cap); if (cl && loose <= 0.75) ctx.restore(); accents(f, v, it, finish); }
        extras(f, v, cell);

        // ---- 5. canvas, paper or plaster (only on what is painted)
        if (p.x3 > 0.02) {
          if (!pat) pat = ctx.createPattern(texture(ST.tex), 'repeat');
          const s = Math.max(1, h / 620);
          ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.globalAlpha = clamp(p.x3) * (ST.tex === 'plaster' ? 0.5 : 0.42) * clamp(h / 560, 0.5, 1);
          ctx.scale(s, s); ctx.fillStyle = pat; ctx.fillRect(0, 0, w / s + 1, h / s + 1); ctx.restore();
        }
        if (style === 'mural') frieze(f);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      },
      dispose() { B.canvas.width = B.canvas.height = M.canvas.width = M.canvas.height = 1; D = null; }
    };
  }
};

const S = (id, name, desc, tags, opts, params) => ({ id: 'painterly-' + id, name, desc, tags: [...tags, '2d'], opts, params });
export const scenes = [
  S('impression', 'Impression, Triceratops', 'Short thick dabs of broken colour with violet shadows: a horned family grazing in morning light.', ['impressionist', 'ceratopsian', 'cretaceous', 'family', 'herd'],
    { style: 'impress', cast: [{ sp: 'triceratops', n: 3, young: 2 }], biome: 'plain', seed: 5, frame: 1.2 }, { stage: 0.86, light: 0.72 }),
  S('points', 'Duck-bills in Dots', 'Pointillism: pure-colour dots that mix in the eye. Crested hadrosaurs stroll the shore of the inland sea.', ['pointillist', 'ornithopod', 'cretaceous', 'herd', 'coast'],
    { style: 'point', cast: [{ sp: 'parasaurolophus', n: 4, young: 2 }, { sp: 'corythosaurus', n: 2 }], biome: 'coast', seed: 12, flyers: 3 }, { stage: 0.8, light: 0.85 }),
  S('watercolour', 'Long-necks at the River', 'Watercolour: pale washes over a pencil drawing, paper left white. Diplodocus wade and drink.', ['watercolour', 'sauropod', 'jurassic', 'herd', 'family', 'water'],
    { style: 'water', cast: [{ sp: 'diplodocus', n: 3, young: 2 }], mode: 'wander', biome: 'floodplain', seed: 11 }, { stage: 0.42, light: 0.8 }),
  S('impasto', 'Tyrannosaurus in Oils', 'Impasto: long loaded strokes with a ridge of light. A lone T. rex under a turning evening sky.', ['oil', 'impasto', 'theropod', 'cretaceous'],
    { style: 'impasto', cast: [{ sp: 'tyrannosaurus', n: 1 }], biome: 'plain', seed: 3 }, { stage: 0.855, light: 0.36 }),
  S('haze', 'Herd in Gold Light', 'After Turner: a herd of Edmontosaurus dissolves into the haze of a low sun.', ['turner', 'haze', 'ornithopod', 'cretaceous', 'herd'],
    { style: 'turner', cast: [{ sp: 'edmontosaurus', n: 7, young: 2 }], biome: 'plain', seed: 16, nonstop: true }, { stage: 0.86, light: 0.3, herd: 0.6 }),
  S('gouache', 'Stegosaurus in the Forest', 'Gouache: flat opaque shapes with dry-brush edges. Plated dinosaurs among the Morrison conifers.', ['gouache', 'stegosaur', 'jurassic', 'forest', 'family'],
    { style: 'gouache', cast: [{ sp: 'stegosaurus', n: 2, young: 1 }], mode: 'wander', biome: 'forest', seed: 8, frame: 1.25 }, { stage: 0.43, light: 0.8 }),
  S('nocturne', 'Nocturne in Blue and Silver', 'A hunt by moonlight: Utahraptors close on Iguanodon at the water, picked out by a few lit points.', ['nocturne', 'theropod', 'ornithopod', 'cretaceous', 'hunt', 'night'],
    { style: 'nocturne', cast: [{ sp: 'iguanodon', n: 2, young: 1 }, { sp: 'utahraptor', n: 3, role: 'pred' }], mode: 'hunt', biome: 'floodplain', seed: 21, frame: 1.35 }, { stage: 0.56, light: 0.1, activity: 0.6 }),
  S('ankylo', 'Armoured, Dusk', 'Impressionist dabs at the end of the day: an Ankylosaurus goes its slow way across the fern prairie.', ['impressionist', 'ankylosaur', 'cretaceous'],
    { style: 'impress', cast: [{ sp: 'ankylosaurus', n: 2 }], mode: 'wander', biome: 'plain', seed: 23 }, { stage: 0.86, light: 0.36 }),
  S('triassic', 'Red Desert Sketch', 'A quick watercolour of the Triassic badlands: Coelophysis on the move past Plateosaurus.', ['watercolour', 'theropod', 'triassic', 'pack', 'desert'],
    { style: 'water', cast: [{ sp: 'coelophysis', n: 5 }, { sp: 'plateosaurus', n: 2 }], biome: 'badlands', seed: 2 }, { stage: 0.1, light: 0.7 }),
  S('mural', 'The Age of Reptiles', 'A museum mural in warm earth colours that walks through deep time: the cast changes as the eras pass.', ['mural', 'time travel', 'herd', 'triassic', 'jurassic', 'cretaceous'],
    { style: 'mural', cast: 'era', biome: 'plain', seed: 1, pace: 0.7 }, { stage: 0.02, grow: 0.5 }),
];
