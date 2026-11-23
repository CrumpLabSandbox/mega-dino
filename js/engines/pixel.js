// Pixel Art: the shared world painted with flat fills into a small off-screen buffer, then locked to a fixed retro
// palette with ordered (Bayer) dithering and blown up with hard pixels. The animals get a 1-pixel dark outline from a
// second, mask buffer. The sky (bands, a fat sun, twinkling stars, chunky clouds) is written straight into the pixel
// data, so in a combo it simply stays transparent (alpha is snapped to 0 or 255).
import { createWorld } from '../world.js';
import { paintWorld, trace, palette, groundRGB, hazeRGB, feetY } from '../draw.js';
import { plantPalette, PLANTS } from '../flora.js';
import { clamp, lerp, hash, fract } from '../util.js';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
const rgbOf = s => { const n = parseInt(s.slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255]; };
const pack = c => ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
const u32of = s => pack(rgbOf(s));
const css = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const grey = v => css([v, v, v]);

// ---- styles: a palette, how natural colours are graded before matching, sky ramps (top → horizon) per time of day
const DB32 = ['#000000', '#222034', '#45283c', '#663931', '#8f563b', '#df7126', '#d9a066', '#eec39a', '#fbf236', '#99e550', '#6abe30', '#37946e', '#4b692f', '#524b24', '#323c39', '#3f3f74',
  '#306082', '#5b6ee1', '#639bff', '#5fcde4', '#cbdbfc', '#ffffff', '#9badb7', '#847e87', '#696a6a', '#595652', '#76428a', '#ac3232', '#d95763', '#d77bba', '#8f974a', '#8a6f30'];
const STYLES = {
  nes: { pal: ['#000000', '#7c7c7c', '#bcbcbc', '#fcfcfc', '#5c94fc', '#0058f8', '#0000a8', '#a4e4fc', '#3cbcfc', '#005800', '#00a800', '#58d854', '#b8f818', '#008888', '#f83800', '#a81000', '#881400',
      '#503000', '#ac7c00', '#fca044', '#f8d878', '#fcd8a8', '#6844fc', '#f878f8', '#e45c10'],
    sat: 1.5, con: 1.15, dd: 0, wd: 0.45,
    sky: { day: ['#5c94fc', '#5c94fc', '#5c94fc', '#a4e4fc'], dusk: ['#0000a8', '#6844fc', '#f878f8', '#fca044', '#f8d878'], night: ['#000000', '#000000', '#0000a8'] },
    sun: ['#f8d878', '#fcfcfc', '#fcfcfc'], cloud: [['#fcfcfc', '#a4e4fc'], ['#fcd8a8', '#f878f8'], ['#0058f8', '#0000a8']], star: '#fcfcfc', outline: '#000000', white: '#fcfcfc' },
  gb: { pal: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'], mono: [0, 85, 170, 255], con: 1.25, bri: 6, dd: 1, wd: 0.6,
    sky: { day: ['#9bbc0f', '#9bbc0f', '#9bbc0f', '#8bac0f'], dusk: ['#8bac0f', '#9bbc0f', '#8bac0f', '#306230'], night: ['#0f380f', '#0f380f', '#306230'] },
    sun: ['#9bbc0f', '#9bbc0f', '#9bbc0f'], ring: '#0f380f', cloud: [['#9bbc0f', '#8bac0f'], ['#9bbc0f', '#306230'], ['#306230', '#306230']], cloudRing: 1, star: '#9bbc0f', outline: '#0f380f', white: '#9bbc0f',
    tones: { body: grey(170), belly: grey(255), far: grey(85), mark: grey(85), accent: grey(255), accentFar: grey(170), horn: grey(255), eye: grey(255), mouth: grey(0) } },
  c64: { pal: ['#000000', '#ffffff', '#68372b', '#70a4b2', '#6f3d86', '#588d43', '#352879', '#b8c76f', '#6f4f25', '#433900', '#9a6759', '#444444', '#6c6c6c', '#9ad284', '#6c5eb5', '#959595'],
    sat: 1.25, con: 1.1, dd: 0, wd: 0.5,
    sky: { day: ['#6c5eb5', '#6c5eb5', '#6c5eb5', '#70a4b2'], dusk: ['#352879', '#6f3d86', '#9a6759', '#b8c76f'], night: ['#000000', '#000000', '#352879'] },
    sun: ['#b8c76f', '#ffffff', '#ffffff'], cloud: [['#ffffff', '#959595'], ['#b8c76f', '#9a6759'], ['#352879', '#444444']], star: '#ffffff', outline: '#000000', white: '#ffffff' },
  pico: { pal: ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'],
    sat: 1.4, con: 1.1, dd: 0, wd: 0.45,
    sky: { day: ['#29adff', '#29adff', '#29adff', '#fff1e8'], dusk: ['#1d2b53', '#7e2553', '#ff004d', '#ffa300', '#ffec27'], night: ['#000000', '#000000', '#1d2b53'] },
    sun: ['#ffec27', '#fff1e8', '#fff1e8'], cloud: [['#fff1e8', '#c2c3c7'], ['#ffccaa', '#ff77a8'], ['#1d2b53', '#1d2b53']], star: '#fff1e8', outline: '#000000', white: '#fff1e8' },
  cga: { pal: ['#000000', '#55ffff', '#ff55ff', '#ffffff'], cga: 1, con: 1.1, dd: 1,
    sky: { day: ['#55ffff'], dusk: ['#000000', '#ff55ff', '#ffffff'], night: ['#000000'] },
    sun: ['#ffffff', '#ffffff', '#ffffff'], cloud: [['#ffffff', '#ffffff'], ['#ff55ff', '#ff55ff'], ['#000000', '#000000']], star: '#ffffff', outline: '#000000', white: '#ffffff',
    tones: { body: '#ffffff', belly: '#ffffff', far: '#55ffff', mark: '#ff55ff', accent: '#ff55ff', accentFar: '#ff55ff', horn: '#ffffff', eye: '#ffffff', mouth: '#000000' } },
  mac: { pal: ['#000000', '#ffffff'], mono: [0, 255], con: 1.2, bri: 14, dd: 1,
    sky: { day: ['#ffffff'], dusk: ['#ffffff', '#ffffff', '#ffffff', '#000000'], night: ['#000000'] },
    sun: ['#ffffff', '#ffffff', '#ffffff'], ring: '#000000', cloud: [['#ffffff', '#ffffff'], ['#ffffff', '#ffffff'], ['#000000', '#000000']], cloudRing: 1, star: '#ffffff', outline: '#000000', white: '#ffffff',
    tones: { body: grey(255), belly: grey(255), far: grey(140), mark: grey(150), accent: grey(90), accentFar: grey(40), horn: grey(255), eye: grey(255), mouth: grey(0) }, night: [0.55, 0.55, 0.55] },
  snes: { pal: DB32, sat: 1.2, con: 1.05, dd: 0.3, wd: 0.55,
    sky: { day: ['#5b6ee1', '#639bff', '#639bff', '#5fcde4', '#cbdbfc'], dusk: ['#222034', '#3f3f74', '#76428a', '#d95763', '#df7126', '#fbf236'], night: ['#000000', '#222034', '#222034', '#3f3f74'] },
    sun: ['#fbf236', '#eec39a', '#cbdbfc'], cloud: [['#ffffff', '#cbdbfc'], ['#d77bba', '#76428a'], ['#3f3f74', '#222034']], star: '#cbdbfc', outline: '#222034', white: '#ffffff', stripes: 1 },
};
const TINT = { day: [1, 1, 1], dusk: [1.08, 0.9, 0.76], night: [0.5, 0.62, 1.05] };

// natural colour → [nearest palette colour, partner to dither with, how much of the partner (0..0.5)]
function buildLUT(st, tint, gain) {
  const P = (st.mono ? st.mono.map(v => [v, v, v]) : st.pal.map(rgbOf)), n = P.length, lut = new Uint32Array(32768);
  const sat = st.sat ?? 1, con = st.con ?? 1, bri = st.bri ?? 0, cy = [85, 255, 255], mg = [255, 85, 255];
  for (let i = 0; i < 32768; i++) {
    let r = ((i >> 10 & 31) * 8 + 4) * tint[0] * gain, g = ((i >> 5 & 31) * 8 + 4) * tint[1] * gain, b = ((i & 31) * 8 + 4) * tint[2] * gain;
    let l = 0.3 * r + 0.59 * g + 0.11 * b;
    if (st.mono) { r = g = b = (l - 128) * con + 128 + bri; }
    else if (st.cga) {
      const warm = (r - Math.max(g, b)) / 255, hue = warm > 0.02 ? mg : cy, s = clamp(Math.abs(warm) * 5 + 0.45), u = clamp(((l - 128) * con + 128) / 255);
      const hc = u < 0.62 ? mix([0, 0, 0], hue, u / 0.62) : mix(hue, [255, 255, 255], (u - 0.62) / 0.38), c = mix([u * 255, u * 255, u * 255], hc, s);
      r = c[0]; g = c[1]; b = c[2];
    } else { r = ((l + (r - l) * sat) - 128) * con + 128 + bri; g = ((l + (g - l) * sat) - 128) * con + 128 + bri; b = ((l + (b - l) * sat) - 128) * con + 128 + bri; }
    r = clamp(r, 0, 255); g = clamp(g, 0, 255); b = clamp(b, 0, 255);
    let c1 = 0, best = 1e12;
    for (let j = 0; j < n; j++) { const dr = r - P[j][0], dg = g - P[j][1], db = b - P[j][2], d = 2 * dr * dr + 4 * dg * dg + 3 * db * db; if (d < best) { best = d; c1 = j; } }
    let c2 = c1, t2 = 0, e2 = best;
    const p1 = P[c1];
    for (let j = 0; j < n; j++) if (j !== c1) {
      const sr = P[j][0] - p1[0], sg = P[j][1] - p1[1], sb = P[j][2] - p1[2], ss = 2 * sr * sr + 4 * sg * sg + 3 * sb * sb;
      const t = clamp((2 * (r - p1[0]) * sr + 4 * (g - p1[1]) * sg + 3 * (b - p1[2]) * sb) / ss, 0, 0.5);
      const dr = r - p1[0] - sr * t, dg = g - p1[1] - sg * t, db = b - p1[2] - sb * t, e = 2 * dr * dr + 4 * dg * dg + 3 * db * db + ss * t * 0.05;
      if (e < e2) { e2 = e; c2 = j; t2 = t; }
    }
    if (t2 < 0.04) c2 = c1;
    lut[i] = c1 | c2 << 8 | Math.round(t2 * 255) << 16;
  }
  return lut;
}

// a 3×5 pixel font for the few captions
const FONT = { A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110', 4: '101101111001001', 5: '111100110001110',
  6: '011100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001110', '.': '000000000000010', '-': '000000111000000', '!': '010010010000010' };

export default {
  id: 'pixel',
  name: 'Pixel Art',
  kind: '2d',
  sky: true,
  nearest: true,
  params: [
    { id: 'x1', label: 'Pixel size', value: 0.5, tip: 'Smaller or chunkier pixels' },
    { id: 'x2', label: 'Dither', value: 0.7, tip: 'Ordered dithering between palette colours; 0 gives hard bands' },
    { id: 'x3', label: 'Outline', value: 1, tip: 'The dark 1-pixel outline around the animals' },
    { id: 'x4', label: 'Sky', value: 0.5, tip: 'Clouds and stars' },
  ],
  create(ctx, opts) {
    const W = createWorld(opts), st = STYLES[opts.style] || STYLES.nes, wide = opts.wide || 1;
    const pal32 = Uint32Array.from(st.pal.map(u32of)), OUT = u32of(st.outline), WHITE = u32of(st.white), STAR = u32of(st.star), RING = st.ring ? u32of(st.ring) : 0;
    const skyR = {}; for (const k in st.sky) skyR[k] = st.sky[k].map(u32of);
    const luts = {};
    const lutFor = (bucket, dino) => luts[bucket + dino] ||= buildLUT(st, bucket === 'night' ? (dino ? mix(st.night || TINT.night, [1, 1, 1], 0.55) : st.night || TINT.night) : TINT[bucket], dino ? (bucket === 'day' ? 1.06 : 1.15) : bucket === 'dusk' ? 0.94 : 1);
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    let bw = 0, bh = 0, cv = null, g = null, mv = null, m = null, out = null, o32 = null, kind = null, ids = null;
    function alloc(w, h) {
      bw = w; bh = h; cv = mk(w, h); mv = mk(w, h);
      g = cv.getContext('2d', { willReadFrequently: true }); m = mv.getContext('2d', { willReadFrequently: true });
      out = g.createImageData(w, h); o32 = new Uint32Array(out.data.buffer); kind = new Uint8Array(w * h); ids = new Uint8Array(w * h);
    }
    let fat = 0, nDino = 0, maskOn = false, lightL = 1, bias = 0, lastStage = -9, lastEpoch = -9;

    // flat fill of a parts list; thin shapes are fattened so they survive the low resolution
    function flat(c, parts, T, colOf, fatten) {
      for (const q of parts) {
        const col = colOf(q); if (!col) continue;
        c.beginPath(); trace(c, q, T);
        if (q.l) { c.strokeStyle = col; c.lineWidth = Math.max(1, q.w * T.k); c.stroke(); continue; }
        c.fillStyle = col; c.fill();
        if (fatten && q.k !== 'mark' && q.k !== 'belly' && q.k !== 'eye') { c.strokeStyle = col; c.lineWidth = fatten; c.stroke(); }
      }
    }
    const down = (c, pts, bottom) => { c.beginPath(); c.moveTo(pts[0][0], bottom); for (const p of pts) c.lineTo(p[0], p[1]); c.lineTo(pts[pts.length - 1][0], bottom); c.closePath(); c.fill(); };
    const px1 = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.floor(x / wide) * wide, Math.floor(y), Math.max(1, Math.round(w / wide)) * wide, Math.max(1, Math.round(h))); };

    const S = {
      sky() {}, sun() {}, fx() {},
      meteor(f, v) {
        const mt = v.meteor, dx = -Math.cos(mt.ang) * mt.len, dy = -Math.sin(mt.ang) * mt.len, nx = -dy / mt.len, ny = dx / mt.len;
        for (const [r, col, k] of [[mt.r * 1.5, '#ff7a28', 1], [mt.r * 0.8, '#ffd060', 0.6]]) { g.fillStyle = col; g.beginPath(); g.moveTo(mt.x + nx * r, mt.y + ny * r); g.lineTo(mt.x + dx * k, mt.y + dy * k); g.lineTo(mt.x - nx * r, mt.y - ny * r); g.closePath(); g.fill(); }
        g.fillStyle = '#ff7a28'; g.beginPath(); g.arc(mt.x, mt.y, Math.max(2, mt.r * 2.4), 0, 6.2832); g.fill();
        g.fillStyle = '#fff6d8'; g.beginPath(); g.arc(mt.x, mt.y, Math.max(1.2, mt.r * 1.5), 0, 6.2832); g.fill();
      },
      far(f, v, l, i) {
        const c = mix(mix(rgbOf(v.biome.ground[0]), [96, 110, 128], 0.5), hazeRGB(1), 0.62 - i * 0.22);
        g.fillStyle = css(c); down(g, l.pts, l.bottom);
        if (maskOn) { m.fillStyle = '#000'; down(m, l.pts, l.bottom); }
      },
      sea(f, v) {
        const y0 = Math.round(v.sea.y0), y1 = v.sea.y1 + 2, ym = Math.round(lerp(y0, y1, 0.4));
        g.fillStyle = css(mix([60, 120, 150], hazeRGB(1), 0.4)); g.fillRect(0, y0, f.w, ym - y0);
        g.fillStyle = css([40, 130, 150]); g.fillRect(0, ym, f.w, y1 - ym);
        for (let i = 0; i < 14; i++) px1(g, hash(i, 3, Math.floor(f.t * 2 + i * 0.37)) * f.w, lerp(y0 + 1, y1, hash(i, 5)), 3 * wide + hash(i, 8) * 4, 1, '#e8f6ff');
        if (maskOn) { m.fillStyle = '#000'; m.fillRect(0, y0, f.w, y1 - y0); }
      },
      ground(f, v, b) {
        g.fillStyle = css(mix(groundRGB(f, { biome: v.biome, light: 1 }, 1), groundRGB(f, { biome: v.biome, light: 1 }, b.u), st.haze ?? 0.6)); down(g, b.pts, f.h + 2);
        if (maskOn) { m.fillStyle = '#000'; down(m, b.pts, f.h + 2); }
      },
      water(f, v, b) {
        const n = b.pts.length, col = css(mix([70, 130, 160], hazeRGB(1), 0.2 + (1 - b.u) * 0.3)), y0 = Math.floor(b.level), hh = Math.ceil(b.next - b.level) + 1;
        for (const [c, cl] of maskOn ? [[g, col], [m, '#000']] : [[g, col]]) { c.fillStyle = cl;
          for (let i = 0; i < n; i++) if (b.wet[i]) { const x0 = i ? (b.pts[i - 1][0] + b.pts[i][0]) / 2 : b.pts[i][0], x1 = i < n - 1 ? (b.pts[i][0] + b.pts[i + 1][0]) / 2 : b.pts[i][0]; c.fillRect(x0 - 0.5, y0, x1 - x0 + 1, hh); } }
        // glints that jump by frame
        const tick = Math.floor(f.t * 3);
        for (let i = 0; i < n; i += 2) if (b.wet[i] && hash(i, b.d, tick) < 0.3 * (0.4 + 0.6 * lightL)) px1(g, b.pts[i][0] + hash(i, tick) * 6, y0 + 1 + hash(i, tick, 2) * Math.max(0, hh - 3), (2 + 3 * b.u) * wide, 1, '#e8f6ff');
      },
      plant(f, v, it) {
        const r = it.k * 14; if (it.x < -r || it.x > f.w + r) return;
        if (it.k > v.k0 * 0.62 && PLANTS[it.kind] && !PLANTS[it.kind].low) return;
        if (it.k > v.k0 && (it.kind === 'cycad' || it.kind === 'bush' || it.kind === 'boulder' || it.kind === 'log' || it.kind === 'stump')) return;      // no tree trunks across the stage: the animals are the picture
        const pal = plantPalette(1, f.era, it.fog * 0.6), T = { x: it.x, y: it.y, k: it.k, dir: 1 };
        flat(g, it.parts, T, q => pal[q.t], it.k < 6 ? fat : 0);
        if (maskOn) flat(m, it.parts, T, () => '#000', it.k < 6 ? fat : 0);
      },
      dino(f, v, it) {
        const T = it.T, fade = it.fade ?? 1; if (fade < 0.4) return;
        const isD = it.type === 'dino', len = (isD ? it.sp.len * it.pose.scale : it.sp.span || it.sp.len) * T.k;
        if (isD && !it.wade) { const q = it.pose, gy = T.y - feetY(q) * T.k, rx = len * 0.3;
          g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(T.x + q.nodes[q.iSh].x * 0.5 * T.k * T.dir, gy + 0.5, rx, Math.max(1, rx * 0.12), 0, 0, 6.2832); g.fill(); }
        const pal = st.tones || palette(it.sp, { light: 1, fog: it.fog * (isD ? 0.45 : 0.3) });
        const fatten = len < bh * 0.9 ? fat : 0, id = 60 + (nDino++ % 5) * 40, mc = `rgb(255,${id},0)`;
        const skip = q => q.k === 'mark' || q.k === 'belly' || q.k === 'eye' || q.k === 'nostril' ? null : mc;
        if (it.wade) for (const c of [g, m]) { c.save(); c.beginPath(); c.rect(0, 0, f.w, it.waterY); c.clip(); }
        flat(g, it.parts, T, q => pal[q.t], fatten);
        flat(m, it.parts, T, skip, fatten); maskOn = true;
        // the eye: always at least one clear pixel
        const e = it.parts.find(q => q.k === 'eye');
        if (e && len > 12) { const ex = T.x + e.c[0] * T.k * T.dir, ey = T.y - e.c[1] * T.k, s = Math.round(e.c[2] * T.k * 2);
          if (s >= 2) { px1(g, ex - s / 2 * wide, ey - s / 2, s * wide, s, st.tones ? st.tones.eye : '#fff6c8'); px1(g, ex + (T.dir > 0 ? 0 : -wide), ey - s / 2 + (s > 2 ? 1 : 0), wide * Math.max(1, s >> 1), Math.max(1, s - 1), '#000'); }
          else px1(g, ex, ey, wide, 1, '#000'); }
        if (it.wade) { g.restore(); m.restore(); px1(g, T.x - len * 0.25, it.waterY, len * 0.5, 1, '#e8f6ff'); }
      },
    };

    function text(s, x, y, col, shadow) {
      s = String(s).toUpperCase();
      for (let i = 0; i < s.length; i++) { const gl = FONT[s[i]]; if (!gl) continue;
        for (let k = 0; k < 15; k++) if (gl[k] === '1') { const X = x + i * 4 + k % 3, Y = y + (k / 3 | 0);
          if (X < 0 || Y < 0 || X >= bw || Y >= bh) continue;
          if (shadow !== undefined && Y + 1 < bh && X + 1 < bw) o32[(Y + 1) * bw + X + 1] = shadow;
          o32[Y * bw + X] = col; } }
    }
    const rect = (x0, y0, x1, y1, c) => { x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(bw, x1 | 0); y1 = Math.min(bh, y1 | 0); for (let y = y0; y < y1; y++) o32.fill(c, y * bw + x0, y * bw + x1); };

    return {
      render(f) {
        const p = f.p, aspect = f.w / f.h;
        // buffer size: the scene's base height, the Pixel size and Detail controls
        const want = clamp(Math.round((opts.px || 144) * Math.pow(2, (0.5 - p.x1) * 1.8) * (0.76 + 0.4 * p.detail)), 32, Math.max(32, Math.min(300, f.h)));
        const ww = Math.max(16, Math.round(want * aspect / wide));
        if (ww !== bw || want !== bh) alloc(ww, want);
        const fw = bw * wide, fb = { ...f, ctx: g, w: fw, h: bh };
        g.setTransform(1 / wide, 0, 0, 1, 0, 0); m.setTransform(1 / wide, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, fw, bh); m.clearRect(0, 0, fw, bh);
        g.lineJoin = g.lineCap = m.lineJoin = m.lineCap = 'round';
        // keep the cast in the picture: nudge the world's camera (through its drag offset) towards the animals
        const drag0 = f.pointer?.dragX || 0, ptr = b => ({ ...(f.pointer || {}), dragX: drag0 - b });
        const aim = v => { const A = v.actors.filter(a => !a.leaving && a.role !== 'young'); if (!A.length || !v.lead) return 0;
          const hw = fw / 2 / v.k0, cam = v.camX + (drag0 - bias) * v.viewM, mean = A.reduce((s, a) => s + a.x, 0) / A.length;
          return clamp((clamp((mean + v.lead.x) / 2, v.lead.x - hw * 0.5, v.lead.x + hw * 0.5) - cam) / v.viewM, -1.2, 1.2); };
        const jump = lastStage < -1 || Math.abs(f.stage - lastStage) > 0.03 || f.epoch !== lastEpoch; lastStage = f.stage; lastEpoch = f.epoch;
        fb.pointer = ptr(bias);
        if (jump) { bias = 0; fb.pointer = ptr(0); const v0 = W.frame({ ...fb, dt: 0, sig: null, pointer: { ...fb.pointer, clicks: [] } }); bias = aim(v0); fb.pointer = ptr(bias); }
        const v = W.frame(fb);
        bias += (aim(v) - bias) * Math.min(1, (f.dt || 0) * 1.2);
        fat = 0.9; nDino = 0; maskOn = false; lightL = v.light;
        paintWorld(fb, v, S);

        // ---- quantise
        const bucket = v.light < 0.2 ? 'night' : v.light < 0.45 ? 'dusk' : 'day';
        const lw = lutFor(bucket, 0), ld = lutFor(bucket, 1), src = g.getImageData(0, 0, bw, bh).data, msk = m.getImageData(0, 0, bw, bh).data;
        const d = clamp(p.x2) * 1.43, dW = d * (st.wd ?? 1), invW = dW > 0.02 ? 1 / dW : 1e6, dD = d * (st.dd ?? 0), invD = dD > 0.02 ? 1 / dD : 1e6, N = bw * bh;
        const ramp = skyR[bucket], rn = ramp.length, skyH = Math.max(4, v.horizon + 1), combo = !!f.combo;
        const flash = clamp((v.flash - 0.07) * 1.4, 0, 0.88);
        for (let y = 0, i = 0; y < bh; y++) {
          const fv = clamp(y / skyH) * (rn - 1), i0 = Math.min(rn - 1, Math.floor(fv)), s = clamp((fv - i0 - 0.5) * (1 + 3 * (1 - clamp(d))) + 0.5), by = (y & 3) * 4;
          for (let x = 0; x < bw; x++, i++) {
            const j = i * 4, B = BAYER[by + (x & 3)];
            if (src[j + 3] < 128) { kind[i] = 0; o32[i] = combo ? 0 : (rn > 1 && d > 0.02 ? (B < s && i0 + 1 < rn ? ramp[i0 + 1] : ramp[i0]) : ramp[Math.min(rn - 1, Math.round(fv))]); continue; }
            const dn = msk[j] > 110, e = (dn ? ld : lw)[(src[j] >> 3) << 10 | (src[j + 1] >> 3) << 5 | src[j + 2] >> 3];
            kind[i] = dn ? 2 : 1; ids[i] = msk[j + 1];
            o32[i] = pal32[B < 0.5 - (0.5 - (e >>> 16) / 255) * (dn ? invD : invW) ? e >> 8 & 255 : e & 255];
          }
        }

        // ---- sky furniture, only on open sky and never in a combo (the layers behind bring their own)
        if (!combo) {
          const sx = v.sun.x / wide, sy = v.sun.y, bi = bucket === 'day' ? 0 : bucket === 'dusk' ? 1 : 2, amt = clamp(p.x4 * 2, 0, 2);
          if (bucket === 'night' && v.dark < 0.5) {
            const ns = Math.round(bw * skyH / 260 * amt), tick = f.t * 3;
            for (let k = 0; k < ns; k++) { const X = hash(k, 1.3) * bw | 0, Y = hash(k, 2.7) * skyH | 0, ph = hash(k, 9.1);
              if (hash(k, Math.floor(tick * (0.4 + ph) + ph * 7)) < 0.22 || Y >= bh) continue;
              const q = Y * bw + X; if (kind[q] === 0) { o32[q] = STAR;
                if (ph > 0.9 && bh > 100 && X > 0 && X < bw - 1 && Y > 0 && Y < bh - 1 && fract(tick * 0.3 + ph * 9) < 0.5) for (const o of [-1, 1, -bw, bw]) if (kind[q + o] === 0) o32[q + o] = STAR; } }
          }
          // a fat sun, or a crescent moon
          if (v.dark < 0.6) {
            const R = Math.max(3, bh * (v.sun.moon ? 0.075 : 0.085)), SUN = u32of(st.sun[bi]), striped = st.stripes && bucket === 'dusk';
            for (let Y = Math.max(0, Math.floor(sy - R - 1)); Y <= Math.min(bh - 1, sy + R + 1); Y++) for (let X = Math.max(0, Math.floor(sx - (R + 1) / wide)); X <= Math.min(bw - 1, sx + (R + 1) / wide); X++) {
              const dx = (X + 0.5 - sx) * wide, dy = Y + 0.5 - sy, r2 = dx * dx + dy * dy, q = Y * bw + X;
              if (kind[q] !== 0 || r2 > (R + 1) * (R + 1)) continue;
              if (r2 > R * R) { if (RING && r2 <= (R + 1) * (R + 1)) o32[q] = RING; continue; }
              if (v.sun.moon) { const mx = dx - R * 0.45, my = dy + R * 0.2; if (mx * mx + my * my < R * R * 0.72) continue; }
              if (striped && dy > 0 && ((Y - Math.floor(sy)) % 3 === 2)) continue;
              o32[q] = SUN;
            }
          }
          // chunky clouds that drift with the wind
          const nc = Math.round((opts.clouds ?? 4) * amt * (1 - 0.6 * v.dark));
          const c0 = u32of(st.cloud[bi][0]), c1 = u32of(st.cloud[bi][1]);
          for (let k = 0; k < nc; k++) {
            const cwid = Math.round(bh * (0.14 + 0.16 * hash(k, 4.4)) / wide), lap = bw + cwid * 2, strata = opts.strata && k % 2;
            const cx = Math.floor(fract(hash(k, 7.7) + (f.t * (0.004 + 0.004 * hash(k, 3)) * (v.wind || 1) - v.camX * 0.0006) * (0.6 + 0.4 * hash(k, 5))) * lap) - cwid, cy = Math.floor(skyH * (0.1 + 0.55 * hash(k, 6.1)));
            if (strata) { const hh = Math.max(1, bh / 90 | 0); for (let r = 0; r < 3; r++) { const off = (hash(k, r) - 0.5) * cwid, wd = cwid * (1.6 - r * 0.4);
              for (let Y = cy + r * hh * 2; Y < cy + r * hh * 2 + hh; Y++) for (let X = Math.floor(cx + off); X < cx + off + wd; X++) if (X >= 0 && X < bw && Y >= 0 && Y < bh && kind[Y * bw + X] === 0) o32[Y * bw + X] = r ? c1 : c0; } continue; }
            const ch = Math.max(3, Math.round(cwid * wide * 0.3)), lumps = [[0.26, 0.8, 0.24], [0.52, 0.45, 0.3], [0.76, 0.85, 0.2]];
            for (let Y = -1; Y <= ch; Y++) for (let X = -1; X <= cwid; X++) {
              const PX = cx + X, PY = cy + Y - ch; if (PX < 0 || PX >= bw || PY < 0 || PY >= bh || kind[PY * bw + PX] !== 0) continue;
              const inside = (xx, yy) => { if (yy >= ch || yy < 0) return false; for (const [lx, ly, lr] of lumps) { const ddx = (xx + 0.5 - lx * cwid) * wide, ddy = yy + 0.5 - ly * ch, rr = lr * cwid * wide; if (ddx * ddx + ddy * ddy < rr * rr) return true; } return yy >= ch - 2 && xx > cwid * 0.1 && xx < cwid * 0.9; };
              if (inside(X, Y)) o32[PY * bw + PX] = Y >= ch - 1 - (ch > 5 ? 1 : 0) ? c1 : c0;
              else if (st.cloudRing && (inside(X - 1, Y) || inside(X + 1, Y) || inside(X, Y - 1) || inside(X, Y + 1))) o32[PY * bw + PX] = OUT;
            }
          }
        }

        // ---- outline: a dark pixel wherever something that is not the animal touches it
        if (p.x3 > 0.15) {
          const inner = p.x3 > 0.5;
          for (let y = 0, i = 0; y < bh; y++) for (let x = 0; x < bw; x++, i++) {
            const k = kind[i];
            if (k !== 2) { if ((x > 0 && kind[i - 1] === 2) || (x < bw - 1 && kind[i + 1] === 2) || (y > 0 && kind[i - bw] === 2) || (y < bh - 1 && kind[i + bw] === 2)) o32[i] = OUT; }
            else if (inner) { const a = ids[i] + 17; if ((x < bw - 1 && kind[i + 1] === 2 && ids[i + 1] > a) || (x > 0 && kind[i - 1] === 2 && ids[i - 1] > a) || (y > 0 && kind[i - bw] === 2 && ids[i - bw] > a) || (y < bh - 1 && kind[i + bw] === 2 && ids[i + bw] > a)) o32[i] = OUT; }
          }
        }

        // ---- the impact: a dithered flash, then ash falling in the dark (only over what is painted when in a combo)
        if (flash > 0.02) for (let y = 0, i = 0; y < bh; y++) for (let x = 0; x < bw; x++, i++) if (BAYER[(y & 3) * 4 + (x & 3)] < flash && (!combo || kind[i])) o32[i] = WHITE;
        if (v.dark > 0.05) { const na = Math.round(bw * bh / 500 * v.dark);
          for (let k = 0; k < na; k++) { const X = Math.floor(fract(hash(k, 3) + f.t * 0.03 * (hash(k, 4) - 0.5)) * bw), Y = Math.floor(fract(hash(k, 7) + f.t * (0.05 + 0.08 * hash(k, 9))) * bh), q = Y * bw + X; if (!combo || kind[q]) o32[q] = k % 3 ? WHITE : pal32[Math.min(pal32.length - 1, 1)]; } }

        // ---- captions
        if (opts.hud === 'boss' && v.lead) {
          const full = v.lead.sp.name.toUpperCase(), name = full.length * 4 < bw - 6 ? full : full.split(' ')[0], y0 = bh - 10, BL = u32of(st.pal[0]);
          rect(0, y0, bw, bh, BL); rect(0, y0, bw, y0 + 1, WHITE);
          text(name, Math.round((bw - name.length * 4 + 1) / 2), y0 + 3, WHITE);
          if (fract(f.t * 1.2) < 0.6) { const wtx = 'WARNING!', x0 = Math.round((bw - wtx.length * 4 + 1) / 2); rect(x0 - 2, 1, x0 + wtx.length * 4 + 1, 9, BL); text(wtx, x0, 3, u32of(st.warn || st.pal[8])); }
        } else if (opts.hud === 'era') {
          text(f.era.name, 3, 3, WHITE, u32of(st.pal[0])); text(Math.round(f.era.ma) + ' MA', 3, 10, WHITE, u32of(st.pal[0]));
        }

        g.setTransform(1, 0, 0, 1, 0, 0);
        g.putImageData(out, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, f.w, f.h);
        ctx.drawImage(cv, 0, 0, f.w, f.h);
      },
      dispose() { cv = mv = g = m = out = o32 = null; }
    };
  }
};

const S = (id, name, desc, tags, opts, params) => ({ id: 'pixel-' + id, name, desc, tags: ['pixel', '2d', ...tags], opts, params });
export const scenes = [
  S('nes', '8-Bit Triceratops Trail', 'A horned herd and its calves march across the fern prairie in bright console colours with black outlines.', ['nes', 'ceratopsian', 'cretaceous', 'herd', 'family'],
    { style: 'nes', px: 144, cast: [{ sp: 'triceratops', n: 3, young: 2 }], biome: 'plain', seed: 5, frame: 1, flyers: 1 }, { stage: 0.86, light: 0.85 }),
  S('gameboy', 'Pocket Stegosaurus', 'Four shades of green: plated dinosaurs browsing among Late Jurassic conifers on a handheld screen.', ['game boy', 'stegosaur', 'jurassic', 'forest'],
    { style: 'gb', px: 108, cast: [{ sp: 'stegosaurus', n: 2, young: 1 }], biome: { hills: 0.3, density: 0.6, tall: 0.5, far: 'forest', ground: ['#5f7a48', '#3c5630'], mult: { conifer: 2, treefern: 1.5, fern: 2, araucaria: 1.5 } }, mode: 'wander', seed: 8, frame: 1.05, clouds: 3 }, { stage: 0.43 }),
  S('c64', 'Maiasaura Nest, 64 Colours Short', 'Good mother lizards tend their hatchlings in the fat, double-wide pixels of an 8-bit home computer.', ['c64', 'ornithopod', 'cretaceous', 'nest', 'family'],
    { style: 'c64', px: 120, wide: 2, cast: [{ sp: 'maiasaura', n: 3, young: 6 }], mode: 'nest', biome: 'floodplain', seed: 9, frame: 1 }, { stage: 0.795, herd: 0.55 }),
  S('pico', 'Raptor Hunt, 16 Colours', 'A feathered Velociraptor pack tests a Protoceratops herd in the dunes of the Gobi, on a fantasy console.', ['pico-8', 'theropod', 'ceratopsian', 'cretaceous', 'hunt', 'desert'],
    { style: 'pico', px: 96, cast: [{ sp: 'protoceratops', n: 3, young: 1 }, { sp: 'velociraptor', n: 3, role: 'pred' }], mode: 'hunt', biome: 'desert', seed: 21, frame: 0.9 }, { stage: 0.79, activity: 0.65, light: 0.75 }),
  S('cga', 'Ankylosaurus in CGA', 'Cyan, magenta, white and black: a club-tailed tank and some dome-heads in the badlands of a 1984 PC.', ['cga', 'ankylosaur', 'cretaceous'],
    { style: 'cga', px: 144, cast: [{ sp: 'ankylosaurus', n: 2 }, { sp: 'pachycephalosaurus', n: 3 }], mode: 'wander', biome: 'badlands', seed: 23, frame: 0.95, clouds: 3 }, { stage: 0.86 }),
  S('mac', '1-Bit Triassic', 'Black and white with dither, like an early desktop: Coelophysis and Plateosaurus at the dawn of the dinosaurs.', ['1-bit', 'theropod', 'triassic', 'pack'],
    { style: 'mac', px: 168, cast: [{ sp: 'coelophysis', n: 4 }, { sp: 'plateosaurus', n: 2 }], biome: 'badlands', seed: 2, frame: 0.95, clouds: 3 }, { stage: 0.1, light: 0.7 }),
  S('sunset', '16-Bit Sunset Migration', 'A Diplodocus herd crosses the floodplain under a striped sun, with parallax hills and long evening clouds.', ['16-bit', 'sauropod', 'jurassic', 'herd', 'family', 'sunset'],
    { style: 'snes', px: 180, cast: [{ sp: 'diplodocus', n: 4, young: 2 }], biome: 'floodplain', seed: 11, strata: 1, clouds: 8, flyers: 2 }, { stage: 0.42, light: 0.3 }),
  S('boss', 'Boss Intro: T. rex', 'Very few pixels, one very large animal. Tyrannosaurus fills the screen (drag Era and the boss changes).', ['low-res', 'theropod', 'cretaceous', 'boss'],
    { style: 'pico', px: 60, cast: [{ sp: 'tyrannosaurus', n: 1 }], mode: 'wander', biome: 'plain', seed: 3, frame: 0.78, foot: 0.74, horizon: 0.5, hud: 'boss', clouds: 2, flyers: 0 }, { stage: 0.855, light: 0.34, activity: 0.7, x2: 0.35 }),
  S('night', 'Spinosaurus by Moonlight', 'The sail-backed fisher wades a North African delta under a crescent moon and twinkling stars.', ['16-bit', 'theropod', 'cretaceous', 'night', 'water'],
    { style: 'snes', px: 150, cast: [{ sp: 'spinosaurus', n: 1 }], mode: 'wander', biome: 'swamp', seed: 6, frame: 1, clouds: 3, flyers: 0 }, { stage: 0.71, light: 0.08, x4: 0.7 }),
  S('time', 'Deep Time Cartridge', 'The whole age of dinosaurs on one 8-bit cartridge: the cast changes with the eras until the sky falls.', ['nes', 'time travel', 'herd', 'impact'],
    { style: 'nes', px: 132, cast: 'era', biome: 'plain', seed: 1, hud: 'era' }, { stage: 0.02, grow: 0.5 }),
];
