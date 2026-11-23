// Arcade & LCD: dinosaurs as old video games and handheld toys that play themselves. Every animal is drawn from the
// shared rig (pose / parts), rasterised into a small palette-locked buffer, stroked as glowing vectors or cut into
// fixed LCD segments. A simple AI plays each game; clicks jump, feed, roar or drop a coin. Original designs only.
import { clamp, lerp, smooth, fract, hash, rng, noise2 } from '../util.js';
import { pose, parts, gait, size } from '../rig.js';
import { flyParts } from '../swimfly.js';
import { species, standIn, castAt } from '../species.js';
import { plantParts, plantPalette, flora, PLANTS } from '../flora.js';
import { drawParts, palette, trace } from '../draw.js';

const TAU = Math.PI * 2;
const css = (c, a = 1) => a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgbOf = c => { const n = parseInt(c.slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255]; };
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return { canvas: c, ctx: c.getContext('2d', { willReadFrequently: true }) }; };
const seeded = (opts, n) => rng(Math.imul((opts.seed || 1) + n, 2654435761));
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

// ---------------------------------------------------------------- fonts
// 3×5 pixel font: five rows of three bits per glyph
const F35 = {};
('A25755 B65656 C34443 D65556 E74647 F74644 G34553 H55755 I72227 J11152 K55655 L44447 M57755 N57775 O25552 P65644 Q25563 R65655 S34216 T72222 ' +
  'U55557 V55552 W55775 X55255 Y55222 Z71247 075557 126227 261247 361216 455711 574616 634757 771222 875757 975716 .00002 -00700 :02020 !22202 \'22000 /11244 +02720 >42124 <12421')
  .split(' ').forEach(s => { F35[s[0]] = s.slice(1); });
function txt(c, s, x, y, col, sc = 1) {
  c.fillStyle = col; x = Math.round(x); y = Math.round(y);
  for (const ch of String(s).toUpperCase()) { const g = F35[ch]; if (g) for (let r = 0; r < 5; r++) { const b = +g[r]; for (let i = 0; i < 3; i++) if (b & (4 >> i)) c.fillRect(x + i * sc, y + r * sc, sc, sc); } x += 4 * sc; }
}
const tw = (s, sc = 1) => String(s).length * 4 * sc - sc;
const ctxt = (c, s, cx, y, col, sc = 1) => txt(c, s, cx - tw(s, sc) / 2, y, col, sc);
const fitName = (name, max) => { let s = name.toUpperCase(); if (s.length > max) s = s.split(' ')[0]; return s.slice(0, Math.max(1, max)); };
const pad = (n, d) => String(Math.max(0, n | 0)).padStart(d, '0');

// stroke font for the vector monitor: points on a 3×5 grid (index = x + 3y, hex), spaces lift the pen
const VF = { A: 'c3152e 68', B: 'c01576 7bdc', C: '20ce', D: 'c015bdc', E: '20ce 67', F: '20c 67', G: '20ce87', H: '0c 2e 68', I: '02 1d ce', J: '2bdc9', K: '0c 26e', L: '0ce', M: 'c072e',
  N: 'c0e2', O: '02ec0', P: 'c0286', Q: '02ec0 7e', R: 'c0286 7e', S: '2068ec', T: '02 1d', U: '0ce2', V: '0d2', W: '0c7e2', X: '0e 2c', Y: '072 7d', Z: '02ce',
  0: '02ec0 2c', 1: '1d', 2: '0286ce', 3: '02ec 68', 4: '068 2e', 5: '2068ec', 6: '20ce86', 7: '02d', 8: '02ec0 68', 9: '8602e', '-': '68', '.': 'dd', ':': '44 aa' };
function vtext(c, s, x, y, u) {
  c.beginPath();
  for (const ch of String(s).toUpperCase()) { const g = VF[ch];
    if (g) for (const st of g.split(' ')) for (let i = 0; i < st.length; i++) { const n = parseInt(st[i], 16), px = x + (n % 3) * u, py = y + Math.floor(n / 3) * u; if (i) c.lineTo(px, py); else { c.moveTo(px, py); if (st.length === 2 && st[0] === st[1]) c.lineTo(px + u * 0.3, py); } }
    x += u * 3.3; }
  c.stroke();
}
// seven-segment digit; mask 127 draws the ghost "8"
const SEG7 = [63, 6, 91, 79, 102, 109, 125, 7, 127, 111];
function seg7(c, x, y, w, h, mask) {
  const t = w * 0.2, g = t * 0.18, hh = h / 2;
  const R = (a, b, cw, ch) => c.rect(x + a, y + b, cw, ch);
  if (mask & 1) R(t + g, 0, w - 2 * t - 2 * g, t); if (mask & 64) R(t + g, hh - t / 2, w - 2 * t - 2 * g, t); if (mask & 8) R(t + g, h - t, w - 2 * t - 2 * g, t);
  if (mask & 32) R(0, t * 0.5 + g, t, hh - t - g); if (mask & 2) R(w - t, t * 0.5 + g, t, hh - t - g);
  if (mask & 16) R(0, hh + t * 0.5, t, hh - t - g); if (mask & 4) R(w - t, hh + t * 0.5, t, hh - t - g);
}
function digits(c, n, d, x, y, w, h, ghost) { c.beginPath(); const s = pad(n, d).slice(-d); for (let i = 0; i < d; i++) seg7(c, x + i * w * 1.35, y, w, h, ghost ? 127 : SEG7[+s[i]]); c.fill(); }

// ---------------------------------------------------------------- the low-resolution screen
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const PAL8 = ['#000000', '#fcfcfc', '#bcbcbc', '#7c7c7c', '#3cbcfc', '#a4e4fc', '#0058f8', '#00a800', '#58d854', '#b8f818', '#f8b800', '#fca044', '#e45c10', '#881400', '#503000',
  '#ac7c00', '#f87858', '#005800', '#f8d878', '#6844fc', '#2c2c3c', '#806040', '#d8a068'];
const PAL16 = ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'];
function makeLUT(pal) {
  const P = pal.map(rgbOf), lut = new Uint32Array(32768);
  for (let i = 0; i < 32768; i++) {
    const r = (i >> 10 & 31) * 8 + 4, g = (i >> 5 & 31) * 8 + 4, b = (i & 31) * 8 + 4; let bd = 1e9, bi = 0;
    for (let k = 0; k < P.length; k++) { const p = P[k], d = (r - p[0]) ** 2 * 0.3 + (g - p[1]) ** 2 * 0.59 + (b - p[2]) ** 2 * 0.11; if (d < bd) { bd = d; bi = k; } }
    const p = P[bi]; lut[i] = (255 << 24 | p[2] << 16 | p[1] << 8 | p[0]) >>> 0;
  }
  return lut;
}
// Two layers: a background (dithered and quantised) and sprites (alpha-tested to hard pixels, with a 1 px outline)
function pixelScreen() {
  let bw = 0, bh = 0, bg, sp, out;
  return {
    size(w, h) { if (w !== bw || h !== bh) { bw = w; bh = h; bg = mk(w, h); sp = mk(w, h); out = mk(w, h); } sp.ctx.clearRect(0, 0, w, h); return { B: bg.ctx, P: sp.ctx }; },
    flush(o) {
      const a = bg.ctx.getImageData(0, 0, bw, bh), A = a.data, D = sp.ctx.getImageData(0, 0, bw, bh).data, U = new Uint32Array(A.buffer), row = bw * 4, lut = o.lut, m = o.mask || 0xf0, dz = (o.dither ?? 24) / 8;
      for (let y = 0, i = 0; y < bh; y++) for (let x = 0; x < bw; x++, i++) {
        const j = i * 4; let r, g, b;
        if (D[j + 3] > 100) { r = D[j]; g = D[j + 1]; b = D[j + 2]; }
        else if (o.line != null && ((x > 0 && D[j - 1] > 100) || (x < bw - 1 && D[j + 7] > 100) || (y > 0 && D[j - row + 3] > 100) || (y < bh - 1 && D[j + row + 3] > 100))) { U[i] = o.line; continue; }
        else { const d = (BAYER[(y & 3) * 4 + (x & 3)] - 7.5) * dz; r = A[j] + d; g = A[j + 1] + d; b = A[j + 2] + d; r = r < 0 ? 0 : r > 255 ? 255 : r; g = g < 0 ? 0 : g > 255 ? 255 : g; b = b < 0 ? 0 : b > 255 ? 255 : b; }
        U[i] = lut ? lut[(r >> 3) << 10 | (g >> 3) << 5 | (b >> 3)] : (255 << 24 | (b & m) << 16 | (g & m) << 8 | (r & m)) >>> 0;
      }
      out.ctx.putImageData(a, 0, 0); return out;
    }
  };
}
const screenRect = f => { const m = Math.round(f.h * lerp(0.13, 0.02, f.p.scale)); return { x: m, y: m, w: f.w - 2 * m, h: f.h - 2 * m }; };
function pix(f, scr) {
  const r = screenRect(f), s = Math.max(1, Math.ceil(r.h / lerp(170, 84, f.p.x4) - 0.35)), bw = Math.ceil(r.w / s), bh = Math.ceil(r.h / s);
  return { r, s, bw, bh, ...scr.size(bw, bh) };
}
// the cabinet around a CRT: dark plastic lit by the room (Light) and by the screen
function bezel(f, r, glow) {
  const { ctx, w, h } = f, L = 0.1 + 0.9 * f.p.light, g = ctx.createLinearGradient(0, 0, 0, h), rad = h * 0.035, m = Math.max(1, r.y), n = 6;
  g.addColorStop(0, css([78 * L, 72 * L, 68 * L])); g.addColorStop(1, css([36 * L, 33 * L, 32 * L]));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = m / n * 1.3;
  for (let i = 0; i < n; i++) { const d = (i + 0.5) * m / n; ctx.strokeStyle = `rgba(${glow},${0.2 * (1 - i / n) ** 2 * (1.2 - f.p.light * 0.8)})`; rr(ctx, r.x - d, r.y - d, r.w + 2 * d, r.h + 2 * d, rad + d); ctx.stroke(); }
  ctx.fillStyle = '#040405'; rr(ctx, r.x - 2, r.y - 2, r.w + 4, r.h + 4, rad + 2); ctx.fill();
}
function glass(f, r, amt) {
  const { ctx } = f, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const g = ctx.createRadialGradient(cx, cy, r.h * 0.35, cx, cy, Math.hypot(r.w, r.h) * 0.56);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${0.55 * amt})`); ctx.fillStyle = g; ctx.fillRect(r.x, r.y, r.w, r.h);
  const l = ctx.createLinearGradient(r.x, r.y, r.x + r.w * 0.5, r.y + r.h * 0.9);
  l.addColorStop(0, `rgba(255,255,255,${0.09 * amt})`); l.addColorStop(0.35, 'rgba(255,255,255,0)'); ctx.fillStyle = l; ctx.fillRect(r.x, r.y, r.w, r.h);
}
function present(f, V, cv, amt) {
  const { ctx } = f, { r, s } = V;
  ctx.save(); rr(ctx, r.x, r.y, r.w, r.h, f.h * 0.035); ctx.clip();
  ctx.imageSmoothingEnabled = false; ctx.drawImage(cv, r.x, r.y, cv.width * s, cv.height * s);
  if (amt > 0.02) {
    ctx.imageSmoothingEnabled = true; ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(0.5, 0.16 * amt); ctx.drawImage(cv, r.x, r.y, cv.width * s, cv.height * s);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    if (s >= 2) { ctx.fillStyle = `rgba(0,0,0,${Math.min(0.5, (s > 2 ? 0.24 : 0.13) * amt)})`; const t = Math.max(1, Math.round(s * 0.25)); for (let y = r.y + s - t; y < r.y + r.h; y += s) ctx.fillRect(r.x, y, r.w, t); }
    glass(f, r, amt);
  }
  ctx.restore(); ctx.imageSmoothingEnabled = true;
}
// the room light on a toy that does not glow by itself
function dimRoom(f) {
  const { ctx, w, h } = f, d = 1 - f.p.light;
  if (d < 0.03) return;
  const g = ctx.createRadialGradient(w * 0.5, h * 0.42, h * 0.1, w * 0.5, h * 0.5, Math.hypot(w, h) * 0.6);
  g.addColorStop(0, `rgba(8,8,20,${d * 0.55})`); g.addColorStop(1, `rgba(4,4,12,${d * 0.9})`); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
function pickPlant(E, u, tall) {
  const W = flora(E), ks = []; let tot = 0;
  for (const k in W) if (PLANTS[k] && W[k] > 0 && (tall == null || !PLANTS[k].low === tall)) { ks.push(k); tot += W[k]; }
  let a = u * tot; for (const k of ks) { a -= W[k]; if (a <= 0) return k; }
  return ks[0] || (tall ? 'deadtree' : 'fern');
}
const snout = q => [q.head.x + Math.cos(q.head.a) * q.head.len, q.head.y + Math.sin(q.head.a) * q.head.len];
const burntOf = E => clamp(E.dark * 1.2 + (1 - E.dinos) * (1 - E.ferns) * 0.4);
function meteorPix(c, E, bw, bh) {
  if (!(E.meteor > 0)) return;
  const m = E.meteor, x = lerp(0.05, 0.8, m / 1.25) * bw, y = lerp(0.02, 0.62, m / 1.25) * bh;
  c.strokeStyle = '#fca044'; c.lineWidth = 2; c.beginPath(); c.moveTo(x - bw * 0.2, y - bh * 0.16); c.lineTo(x, y); c.stroke();
  c.fillStyle = '#fcfcfc'; c.fillRect(x - 2, y - 2, 4, 4);
}

// ================================================================ 1. endless runner
function runGame(opts) {
  const R = seeded(opts, 11), scr = pixelScreen(), lut = makeLUT(PAL8);
  let sp = species(opts.sp || 'velociraptor'), fly = species(opts.fly || 'pteranodon'), canFly = true, S = null;
  const reset = hi => { S = { x: 0, y: 0, vy: 0, duck: 0, obs: [], next: 10, score: 0, hi, dead: 0, v: 7, ph: 0, t: S ? S.t : 0, n: 0 }; };
  const jump = () => { if (S.y === 0 && !S.dead) S.vy = 6.4; };
  reset(0);
  return {
    pre(f) { sp = standIn(opts.sp || 'velociraptor', f.era.ma) || sp; const fl = standIn(opts.fly || 'pteranodon', f.era.ma); canFly = !!fl; if (fl) fly = fl; },
    click: jump,
    step(h, f) {
      const diff = f.p.x3; S.t += h;
      if (S.dead > 0) { S.dead -= h; if (S.dead <= 0) reset(Math.max(S.hi, S.score | 0)); return; }
      S.v = (6.5 + Math.min(4, S.score / 250)) * (0.8 + 0.45 * diff);
      S.x += S.v * h; S.score += S.v * h; S.ph += h * (2.3 + S.v * 0.07);
      while (S.next < S.x + 24) {
        const q = R(), k = q < 0.24 && canFly && S.n > 1 ? 3 : q < 0.5 ? 0 : q < 0.78 ? 1 : 2;
        S.obs.push({ x: S.next, k, seed: 1 + (R() * 999 | 0), w: [0.8, 0.7, 1.7, 1][k], h: [0.5, 0.8, 0.42, 0][k] * (0.85 + R() * 0.3), miss: R() < 0.015 + 0.2 * diff * diff });
        S.n++; S.next += S.v * (0.95 + R() * 1.1) + 1.5;
      }
      if (S.vy !== 0 || S.y > 0) { S.y += S.vy * h; S.vy -= 21 * h; if (S.y <= 0) { S.y = 0; S.vy = 0; if (f.sig) f.sig.step = 1; } }
      let want = 0, hit = false;
      for (const o of S.obs) {
        const dx = o.x - S.x;
        if (o.k === 3) { if (!o.miss && dx < S.v * 0.28 + 0.8 && dx > -1.4) want = 1; if (Math.abs(dx) < 0.5 && S.duck < 0.5 && S.y < 1.5) hit = true; }
        else { if (!o.miss && !want && dx > 0 && dx < S.v * 0.3 + o.w * 0.25) jump(); if (Math.abs(dx) < o.w * 0.5 + 0.15 && S.y < o.h * 0.7) hit = true; }
      }
      S.duck += (want - S.duck) * Math.min(1, h * 16);
      if (hit) S.dead = 1.7;
      if (S.obs.length && S.obs[0].x < S.x - 9) S.obs.shift();
    },
    draw(f) {
      const E = f.era, V = pix(f, scr), { B, P, bw, bh } = V, U = Math.max(6, Math.round(bh * 0.17)), gy = Math.round(bh * 0.8), rx = Math.round(bw * 0.25);
      const X = wx => rx + (wx - S.x) * U, burnt = burntOf(E), dk = E.dark * 0.9, pp = plantPalette(1, E, 0);
      const top = mix3(mix3([60, 188, 252], [252, 160, 68], E.dry * 0.3), [26, 20, 20], dk), bot = mix3(mix3([164, 228, 252], [252, 216, 168], E.dry * 0.8), [80, 52, 40], dk);
      for (let y = 0; y < gy; y++) { B.fillStyle = css(mix3(mix3(top, bot, Math.pow(y / gy, 1.4)), [255, 255, 255], E.flash)); B.fillRect(0, y, bw, 1); }
      if (dk < 0.4) { B.fillStyle = '#f8d878'; B.beginPath(); B.arc(bw * 0.8, bh * 0.2, bh * 0.07, 0, TAU); B.fill();
        B.fillStyle = '#fcfcfc'; for (let i = 0; i < 4; i++) { const cw = bh * (0.16 + 0.1 * hash(i, 4)), cx = ((i * bw * 0.37 + hash(i, 2) * 40 - S.x * U * 0.04) % (bw + cw * 2) + bw + cw * 2) % (bw + cw * 2) - cw, cy = Math.round(bh * (0.1 + 0.3 * hash(i, 8)));
          B.fillRect(cx | 0, cy, cw | 0, 3); B.fillRect((cx + cw * 0.2) | 0, cy - 2, (cw * 0.5) | 0, 2); } }
      meteorPix(B, E, bw, bh);
      B.fillStyle = css(mix3(mix3([88, 216, 84], [228, 148, 88], E.dry), [70, 62, 58], Math.max(burnt, dk)));
      for (let x = 0; x < bw; x++) { const u = x + S.x * U * 0.1, hg = (noise2(u * 0.025, 7) * 0.75 + noise2(u * 0.09, 3) * 0.25) * bh * 0.34; B.fillRect(x, (gy - hg) | 0, 1, hg + 1); }
      const sx0 = S.x * U * 0.4, gap = bh * 0.42, far = plantPalette(0.8, E, 0);
      for (let i = Math.floor(sx0 / gap) - 1; i * gap - sx0 < bw + gap; i++) {
        if (hash(i, 31) > 0.25 + f.p.detail) continue;
        const tall = hash(i, 17) < 0.65, kind = pickPlant(E, hash(i, 12), tall), hp = tall ? bh * (0.3 + 0.24 * hash(i, 5)) : bh * 0.1;
        drawParts(B, plantParts(kind, i + 50, 0), { x: i * gap - sx0 + hash(i, 9) * gap * 0.5, y: gy + 1, k: hp / PLANTS[kind].h, dir: 1 }, { pal: far });
      }
      const g1 = mix3(mix3([108, 68, 20], [200, 140, 60], E.dry), [56, 50, 48], burnt);
      B.fillStyle = css(g1); B.fillRect(0, gy, bw, bh - gy); B.fillStyle = css(mix3(g1, [252, 224, 168], 0.45)); B.fillRect(0, gy, bw, 1);
      B.fillStyle = css(mix3(g1, [0, 0, 0], 0.4));
      for (let i = Math.floor((S.x * U - rx) / 9) - 1, n = 0; n < bw / 9 + 3; i++, n++) B.fillRect(Math.round(i * 9 + hash(i, 1) * 6 - S.x * U + rx), gy + 2 + Math.floor(hash(i, 2) * (bh - gy - 3)), 1 + (hash(i, 3) * 2 | 0), 1);
      for (const o of S.obs) {
        const x = X(o.x); if (x < -40 || x > bw + 40) continue;
        if (o.k === 3) drawParts(P, flyParts(fly, { t: S.t + o.seed, glide: 0.1, yaw: 0.3, pitch: 0.3 }), { x, y: gy - U * 1.42, k: U * 2.3 / fly.span, dir: -1 }, { pal: palette(fly) });
        else { const kind = ['rock', burnt > 0.5 ? 'stump' : 'cycad', 'log'][o.k]; drawParts(P, plantParts(kind, o.seed, 0), { x, y: gy + 1, k: o.h * U / PLANTS[kind].h * 0.95, dir: 1 }, { pal: pp }); }
      }
      if (!(S.dead > 0) || fract(S.dead * 5) < 0.6) {
        const k = U / size(sp).hip, air = S.y > 0;
        drawParts(P, parts(pose(sp, { phase: air ? 0.12 : S.ph, run: 1, t: S.t, crouch: S.duck * 0.6, headTo: S.dead > 0 ? 0.8 : -0.55 * S.duck + (air ? 0.25 : 0), jaw: S.dead > 0 ? 1 : 0, rear: S.dead > 0 ? 0.6 : 0 })),
          { x: rx, y: gy - Math.round(S.y * U), k, dir: 1 }, { pal: palette(sp) });
        if (!air && !S.dead) { P.fillStyle = '#d8a068'; const a = Math.floor(S.ph * 4) % 3; P.fillRect(rx - U * 0.7 - a * 2, gy - 1 - a, 2, 2); P.fillRect(rx - U * 1.1 - a * 3, gy - 2, 1, 1); }
      }
      const O = scr.flush({ lut, dither: 22, line: 0xff000000 }).ctx, ma = E.ma.toFixed(1) + ' MA';
      txt(O, ma, bw - tw(ma, 2) - 3, 4, '#000000', 2); txt(O, ma, bw - tw(ma, 2) - 4, 3, '#fcfcfc', 2);
      txt(O, 'SCORE ' + pad(S.score, 5), 4, 3, '#000000');
      txt(O, 'HI ' + pad(Math.max(S.hi, S.score), 5), 4, 10, '#881400');
      txt(O, fitName(sp.name, (bw - 8) >> 2), 4, bh - 8, '#f8d878');
      if (S.dead > 0) { ctxt(O, 'GAME OVER', bw / 2 + 1, bh * 0.4 + 1, '#000000', 2); ctxt(O, 'GAME OVER', bw / 2, bh * 0.4, '#fcfcfc', 2); }
      bezel(f, V.r, '120,190,255'); present(f, V, O.canvas, f.p.x2 * 2);
    }
  };
}

// ================================================================ 5. boss fight
const reachOf = sp => sp._arcReach ?? (sp._arcReach = snout(pose(sp, {}))[0]);
function bossGame(opts) {
  const R = seeded(opts, 23), scr = pixelScreen();
  let A = species(opts.a || 'tyrannosaurus'), Bq = species(opts.b || 'triceratops');
  const mkF = () => ({ hp: 100, lag: 100, st: 'idle', tm: 0, ph: 0, flash: 0, off: 0, done: 0 });
  const S = { f: [mkF(), mkF()], turn: 0, wait: 1, round: 1, wins: [0, 0], ko: 0, win: 0, fx: [], t: 0, shake: 0 };
  const set = (a, st) => { a.st = st; a.tm = 0; a.done = 0; };
  const geo = () => { const la = A.len, lb = Bq.len, Wm = 1.15 * (la + lb); return { Wm, ha: 0.4 * la, hb: Wm - 0.42 * lb, gap: Math.max(0.1 * (la + lb), Wm - 0.4 * la - reachOf(A) - 0.42 * lb - reachOf(Bq)) }; };
  return {
    pre(f) { A = standIn(opts.a || 'tyrannosaurus', f.era.ma) || A; Bq = standIn(opts.b || 'triceratops', f.era.ma) || Bq; },
    click() { if (S.f[0].st === 'idle' && !(S.ko > 0)) set(S.f[0], 'roar'); },
    step(h, f) {
      const F = S.f, diff = f.p.x3, { gap } = geo();
      const hurt = (o, by, d) => { d *= by === 0 ? lerp(1.3, 0.8, diff) : lerp(0.7, 1.5, diff); o.hp = Math.max(0, o.hp - d); o.flash = 0.25; S.fx.push({ k: 2, i: 1 - by, t: 0, d: Math.round(d) });
        if (o.hp <= 0 && !(S.ko > 0)) { S.ko = 3.8; S.win = by; S.wins[by]++; } if (f.sig) f.sig.step = 1; };
      S.t += h; S.shake = Math.max(0, S.shake - h * 4);
      for (let i = 0; i < 2; i++) {
        const a = F[i], o = F[1 - i]; a.tm += h; a.flash = Math.max(0, a.flash - h); a.lag += (a.hp - a.lag) * Math.min(1, h * 2.5);
        if (a.st === 'wind') { if (a.tm > 0.4) set(a, 'charge'); }
        else if (a.st === 'charge') { a.off += gap / 0.38 * h; a.ph += h * 3.2;
          if (a.off + o.off >= gap) { a.off = gap - o.off; hurt(o, i, 11 + R() * 9); set(a, 'back'); set(o, 'hit'); S.shake = 1; S.fx.push({ k: 0, i, t: 0 }); } }
        else if (a.st === 'hit') { a.off -= gap * 1.3 * h * Math.max(0, 1 - a.tm * 3); if (a.tm > 0.5) set(a, 'back'); }
        else if (a.st === 'back') { const v = gap / 0.9 * h; if (Math.abs(a.off) <= v) { a.off = 0; set(a, 'idle'); } else { a.off -= Math.sign(a.off) * v; a.ph -= Math.sign(a.off) * h * 1.6; } }
        else if (a.st === 'roar') { if (!a.done && a.tm > 0.45) { a.done = 1; hurt(o, i, 4 + R() * 4); if (o.st === 'idle') set(o, 'flinch'); S.fx.push({ k: 1, i, t: 0 }); if (f.sig) f.sig.roar = 1; } if (a.tm > 1.1) set(a, 'idle'); }
        else if (a.st === 'flinch') { if (a.tm > 0.5) set(a, 'idle'); }
      }
      for (const e of S.fx) e.t += h; while (S.fx.length && S.fx[0].t > 0.9) S.fx.shift();
      if (S.ko > 0) {
        S.ko -= h;
        for (let i = 0; i < 2; i++) if (F[i].st === 'idle') set(F[i], i === S.win ? 'win' : 'ko');
        if (S.ko <= 0) { S.round++; for (const a of F) { a.hp = 100; set(a, 'back'); } S.wait = 1.2; }
      } else if (F[0].st === 'idle' && F[1].st === 'idle') {
        S.wait -= h * (0.6 + 0.8 * f.p.activity);
        if (S.wait <= 0) { const i = S.turn; S.turn = R() < 0.72 ? 1 - i : i; set(F[i], R() < 0.62 ? 'wind' : 'roar'); S.wait = 0.4 + R() * 0.7; }
      }
    },
    draw(f) {
      const E = f.era, V = pix(f, scr), { B, P, bw, bh } = V, F = S.f, G = geo(), k = Math.min(bw / G.Wm, bh * 0.5 / Math.max(size(A).tall, size(Bq).tall)), ax = (bw - G.Wm * k) / 2, gy = Math.round(bh * 0.87), dk = E.dark * 0.85, burnt = burntOf(E);
      // backdrop: dusk bands, a low sun, far ridges, a line of era-correct trees, a striped arena floor
      const c0 = mix3([44, 30, 110], [20, 16, 24], dk), c1 = mix3([204, 84, 130], [50, 34, 34], dk), c2 = mix3([255, 190, 100], [90, 60, 44], dk);
      for (let y = 0; y < gy; y++) { const u = y / gy; B.fillStyle = css(mix3(u < 0.55 ? mix3(c0, c1, u / 0.55) : mix3(c1, c2, (u - 0.55) / 0.45), [255, 255, 255], E.flash)); B.fillRect(0, y, bw, 1); }
      if (dk < 0.5) { const sr = bh * 0.2, sy = gy - bh * 0.2; B.fillStyle = '#ffe890'; B.beginPath(); B.arc(bw * 0.5, sy, sr, 0, TAU); B.fill();
        for (let i = 0; i < 4; i++) { B.fillStyle = css(mix3(c1, c2, 0.5 + i * 0.12)); B.fillRect(bw * 0.5 - sr, Math.round(sy + sr * (0.15 + i * 0.22)), sr * 2, 1 + i * 0.6 | 0); } }
      meteorPix(B, E, bw, bh);
      for (let l = 0; l < 2; l++) { B.fillStyle = css(mix3(l ? [58, 34, 86] : [112, 60, 120], [24, 20, 24], dk));
        for (let x = 0; x < bw; x++) { const hg = (noise2(x * (0.02 + l * 0.015) + l * 9, 4 + l) * 0.7 + noise2(x * 0.11, l) * 0.12 + (l ? 0 : 0.5 * Math.max(0, 1 - Math.abs(x - bw * 0.22) / (bw * 0.16)))) * bh * (0.3 - l * 0.1); B.fillRect(x, (gy - hg) | 0, 1, hg + 1); } }
      const tp = plantPalette(0.45, E, 0), n = 5 + Math.round(f.p.detail * 8);
      for (let i = 0; i < n; i++) { const kind = pickPlant(E, hash(i, 41 + (opts.seed || 0)), hash(i, 8) < 0.7), tall = !PLANTS[kind].low;
        drawParts(B, plantParts(kind, i + 9, 0), { x: bw * ((i + 0.3 + 0.4 * hash(i, 3)) / n), y: gy + 1, k: (tall ? bh * (0.28 + 0.2 * hash(i, 6)) : bh * 0.1) / PLANTS[kind].h, dir: 1 }, { pal: tp }); }
      const g1 = mix3(mix3([116, 84, 60], [196, 140, 84], E.dry), [60, 54, 52], burnt);
      for (let y = gy; y < bh; y++) { const u = (y - gy) / (bh - gy); B.fillStyle = css(mix3(g1, [40, 24, 40], 0.5 - 0.5 * u + ((y - gy) % 3 === 0 ? 0.14 : 0))); B.fillRect(0, y, bw, 1); }
      // the fighters
      const sh = S.shake > 0 ? Math.round(Math.sin(S.t * 90) * 2 * S.shake) : 0, Ts = [], Qs = [];
      for (const i of [1, 0]) {
        const a = F[i], sp = i ? Bq : A, e = Math.min(1, a.tm / 0.2), horn = sp.niche === 'horned' || sp.group === 'ceratopsian' || sp.diet !== 'carnivore';
        const o = { t: S.t + i * 3, phase: a.ph, headTo: 0.08 * Math.sin(S.t * 1.3 + i * 2) };
        if (a.st === 'wind') { o.crouch = 0.3 * e; o.headTo = -0.3 * e; }
        else if (a.st === 'charge') { o.run = 1; o.headTo = horn ? -0.3 : 0.15; o.jaw = horn ? 0 : 0.8; }
        else if (a.st === 'hit') { o.rear = 0.45 * Math.sin(Math.min(1, a.tm * 2) * Math.PI); o.headTo = 0.5; o.jaw = 0.5; }
        else if (a.st === 'flinch') { o.crouch = 0.25 * Math.sin(Math.min(1, a.tm * 2) * Math.PI); o.headTo = -0.3; }
        else if (a.st === 'roar' || a.st === 'win') { o.headTo = 0.65 * e; o.jaw = e * (0.75 + 0.25 * Math.sin(S.t * 30)); o.rear = 0.1 * e; }
        else if (a.st === 'ko') { o.crouch = e; o.headTo = -0.8 * e; }
        const q = pose(sp, o), T = { x: Math.round(ax + (i ? G.hb - a.off : G.ha + a.off) * k) + sh, y: gy + 2, k, dir: i ? -1 : 1 };
        Ts[i] = T; Qs[i] = q;
        drawParts(P, parts(q), T, a.flash > 0 && fract(a.flash * 12) < 0.5 ? { fill: () => '#ffffff', pupil: false } : { pal: palette(sp) });
      }
      const mouth = i => { const s = snout(Qs[i]), T = Ts[i]; return [T.x + T.dir * s[0] * k, T.y - s[1] * k]; };
      P.lineWidth = 1;
      for (const e of S.fx) {
        if (e.k === 0) { const a = mouth(e.i), b = mouth(1 - e.i), x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2, r = 3 + e.t * 40; if (e.t < 0.3) { P.strokeStyle = '#fff8c0'; P.beginPath(); for (let j = 0; j < 8; j++) { const an = j * TAU / 8 + 0.3; P.moveTo(x + Math.cos(an) * r * 0.4, y + Math.sin(an) * r * 0.4); P.lineTo(x + Math.cos(an) * r, y + Math.sin(an) * r); } P.stroke(); } }
        else if (e.k === 1 && e.t < 0.7) { const m = mouth(e.i), d = Ts[e.i].dir; P.strokeStyle = '#ffffff'; for (let j = 0; j < 3; j++) { const r = (e.t * 1.6 - j * 0.12) * bw * 0.3; if (r > 2) { P.beginPath(); P.arc(m[0], m[1], r, d > 0 ? -0.6 : Math.PI - 0.6, d > 0 ? 0.5 : Math.PI + 0.5); P.stroke(); } } }
      }
      const O = scr.flush({ mask: 0xf0, dither: 14, line: 0xff100818 }).ctx;
      for (const e of S.fx) if (e.k === 2) { const T = Ts[e.i], s = '-' + e.d; ctxt(O, s, T.x + T.dir * k * 2 + 1, gy - bh * 0.42 - e.t * 14 + 1, '#200818'); ctxt(O, s, T.x + T.dir * k * 2, gy - bh * 0.42 - e.t * 14, e.d > 9 ? '#ffe040' : '#ffffff'); }
      // health bars drain towards the outside
      const bwid = Math.floor(bw * 0.4), by = 10;
      for (let i = 0; i < 2; i++) {
        const a = F[i], sp = i ? Bq : A, x0 = i ? bw - 4 - bwid : 4, name = fitName(sp.name, (bwid >> 2));
        txt(O, name, i ? bw - 4 - tw(name) : 4, 3, '#ffffff');
        O.fillStyle = '#ffffff'; O.fillRect(x0 - 1, by - 1, bwid + 2, 7); O.fillStyle = '#501028'; O.fillRect(x0, by, bwid, 5);
        const wl = Math.round(bwid * a.lag / 100), wh = Math.round(bwid * a.hp / 100);
        O.fillStyle = '#ffffff'; O.fillRect(i ? x0 : x0 + bwid - wl, by, wl, 5);
        O.fillStyle = a.hp > 35 ? '#f8d030' : '#f04030'; O.fillRect(i ? x0 : x0 + bwid - wh, by, wh, 5); O.fillStyle = a.hp > 35 ? '#fff8a0' : '#ff9080'; O.fillRect(i ? x0 : x0 + bwid - wh, by, wh, 1);
        for (let j = 0; j < Math.min(S.wins[i], 9); j++) { O.fillStyle = '#f8d030'; O.fillRect(i ? bw - 7 - j * 5 : 4 + j * 5, by + 8, 3, 3); }
      }
      ctxt(O, 'VS', bw / 2 + 0.5, by, '#ffffff'); ctxt(O, 'ROUND ' + S.round, bw / 2 + 0.5, by + 9, '#f8d030');
      ctxt(O, E.ma.toFixed(1) + ' MA', bw / 2, bh - 7, '#ffd8a0');
      if (S.ko > 0 && S.ko < 3.3) { const s = fitName((S.win ? Bq : A).name, (bw >> 2) - 6) + ' WINS'; O.fillStyle = '#100818'; O.fillRect(0, Math.round(bh * 0.36) - 3, bw, 17); ctxt(O, s, bw / 2, bh * 0.36, fract(S.ko * 3) < 0.5 ? '#ffffff' : '#f8d030'); ctxt(O, 'NOBODY IS HURT - NEXT ROUND', bw / 2, bh * 0.36 + 7, '#ff9080'); }
      bezel(f, V.r, '255,150,110'); present(f, V, O.canvas, f.p.x2 * 2);
    }
  };
}

// ================================================================ 6. long-neck snake
function snakeGame(opts) {
  const GW = 20, GH = 11, R = seeded(opts, 37), scr = pixelScreen(), rocks = new Set(), id = (x, y) => y * GW + x;
  let sp = species(opts.sp || 'diplodocus'), S = null;
  for (let i = 0; i < 7; i++) { const x = 2 + (R() * (GW - 4) | 0), y = 1 + (R() * (GH - 2) | 0); if (y !== 5) rocks.add(id(x, y)); }
  const inBody = (x, y, skipTail) => { for (let i = 0; i < S.body.length - (skipTail ? 1 : 0); i++) if (S.body[i][0] === x && S.body[i][1] === y) return true; return false; };
  const free = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH && !rocks.has(id(x, y)) && !inBody(x, y, S.grow === 0);
  const addFood = (x, y) => { for (let n = 0; n < 60; n++) { const fx = x ?? (R() * GW | 0), fy = y ?? (R() * GH | 0); if (!rocks.has(id(fx, fy)) && !inBody(fx, fy) && !S.food.some(q => q[0] === fx && q[1] === fy)) { S.food.push([fx, fy, 1 + (R() * 99 | 0)]); return; } if (x != null) return; } };
  const reset = hi => { S = { body: [[5, 5], [4, 5], [3, 5], [2, 5]], old: null, dir: [1, 0], food: [], acc: 0, score: 0, hi, dead: 0, grow: 0, t: S ? S.t : 0, msg: '' }; S.old = S.body.map(b => b.slice()); for (let i = 0; i < 3; i++) addFood(); };
  reset(0);
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  function think() {
    const [hx, hy] = S.body[0], isFood = new Set(S.food.map(q => id(q[0], q[1]))), seen = new Int8Array(GW * GH).fill(-1), qx = [], area = [0, 0, 0, 0];
    const d0 = Math.max(0, DIRS.indexOf(S.dir));
    for (let e = 0; e < 4; e++) { const d = (d0 + e) % 4, x = hx + DIRS[d][0], y = hy + DIRS[d][1]; if (free(x, y)) { seen[id(x, y)] = d; qx.push(x, y); } }
    let best = -1;
    for (let i = 0; i < qx.length; i += 2) { const x = qx[i], y = qx[i + 1], d = seen[id(x, y)]; area[d]++; if (best < 0 && isFood.has(id(x, y))) best = d;
      for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy; if (free(nx, ny) && seen[id(nx, ny)] < 0) { seen[id(nx, ny)] = d; qx.push(nx, ny); } } }
    if (best >= 0 && area[best] < S.body.length * 0.5) best = -1;       // do not walk into a pocket
    if (best < 0) { let m = 0; for (let d = 0; d < 4; d++) if (area[d] > m) { m = area[d]; best = d; } }
    return best;
  }
  return {
    pre(f) { const c = standIn(opts.sp || 'diplodocus', f.era.ma); if (c && /sauropod/.test(c.group)) sp = c; },
    click(x, y, f) { if (!S.geo) return; const g = S.geo, cx = Math.floor((x * f.w - g.x) / g.t), cy = Math.floor((y * f.h - g.y) / g.t); if (cx >= 0 && cy >= 0 && cx < GW && cy < GH) addFood(cx, cy); },
    step(h, f) {
      S.t += h;
      if (S.dead > 0) { S.dead -= h; if (S.dead <= 0) reset(Math.max(S.hi, S.score)); return; }
      S.acc += h; const iv = lerp(0.22, 0.09, f.p.x3);
      while (S.acc >= iv) {
        S.acc -= iv;
        const d = think(); S.old = S.body.map(b => b.slice());
        if (d < 0) { S.dead = 1.8; S.msg = 'BOXED IN!'; S.acc = 0; return; }
        S.dir = DIRS[d]; const nx = S.body[0][0] + S.dir[0], ny = S.body[0][1] + S.dir[1], fi = S.food.findIndex(q => q[0] === nx && q[1] === ny);
        S.body.unshift([nx, ny]);
        if (fi >= 0) { S.food.splice(fi, 1); S.score++; S.grow += 2; if (S.food.length < 3) addFood(); if (f.sig) f.sig.step = 1; }
        if (S.grow > 0) S.grow--; else S.body.pop();
        if (S.body.length > 78) { S.dead = 2.2; S.msg = 'WELL FED!'; S.acc = 0; return; }
      }
    },
    draw(f) {
      const E = f.era, V = pix(f, scr), { B, P, bw, bh } = V, t = Math.max(3, Math.floor(Math.min(bw / GW, (bh - 9) / GH))), ox = (bw - GW * t) >> 1, oy = 9 + ((bh - 9 - GH * t) >> 1);
      S.geo = { x: V.r.x + ox * V.s, y: V.r.y + oy * V.s, t: t * V.s };
      const burnt = burntOf(E), a = mix3(mix3([0, 135, 81], [171, 82, 54], E.dry * 0.8), [70, 66, 62], burnt), b = mix3(a, [0, 0, 0], 0.16);
      B.fillStyle = '#1d2b53'; B.fillRect(0, 0, bw, bh); B.fillStyle = '#000000'; B.fillRect(ox - 2, oy - 2, GW * t + 4, GH * t + 4);
      for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { B.fillStyle = css((x + y) & 1 ? a : b); B.fillRect(ox + x * t, oy + y * t, t, t); if (hash(x, y, 5) < 0.25) { B.fillStyle = css(mix3(a, [255, 240, 200], 0.2)); B.fillRect(ox + x * t + (hash(x, y) * (t - 1) | 0), oy + y * t + (hash(y, x) * (t - 1) | 0), 1, 1); } }
      const pp = plantPalette(1, E, 0), C = (x, y) => [ox + (x + 0.5) * t, oy + (y + 0.5) * t];
      for (const r of rocks) { const c = C(r % GW, Math.floor(r / GW)); drawParts(P, plantParts('rock', r + 3, 0), { x: c[0], y: c[1] + t * 0.42, k: t * 0.62, dir: 1 }, { pal: pp }); }
      for (const q of S.food) { const c = C(q[0], q[1]); drawParts(P, plantParts('fern', q[2], Math.sin(S.t * 2 + q[2])), { x: c[0], y: c[1] + t * 0.42, k: t * 0.85, dir: 1 }, { pal: { ...pp, leaf: '#30e050', leaf2: '#c8f070' } }); }
      // the animal: a chain of cells with a sauropod's width profile (thin neck, fat body, whip tail)
      if (!(S.dead > 0) || fract(S.dead * 5) < 0.6) {
        const u = S.dead > 0 ? 1 : clamp(S.acc / lerp(0.22, 0.09, f.p.x3)), n = S.body.length, pts = [];
        for (let i = 0; i < n; i++) { const o = S.old[Math.min(i, S.old.length - 1)], c = S.body[i]; pts.push(C(lerp(o[0], c[0], u), lerp(o[1], c[1], u))); }
        const M = (n - 1) * 3, at = v => { const s = clamp(v) * (n - 1), i = Math.min(n - 2, Math.floor(s)), fr = s - i; return [lerp(pts[i][0], pts[i + 1][0], fr), lerp(pts[i][1], pts[i + 1][1], fr), pts[i][0] - pts[i + 1][0], pts[i][1] - pts[i + 1][1]]; };
        const ib = Math.max(1, Math.round((n - 1) * 0.4)), ub = ib / (n - 1), wid = v => t * (0.14 + 0.22 * (1 - v) + 0.7 * Math.exp(-((((v - ub) * (n - 1)) / (1.3 + n * 0.035)) ** 2)));
        const bc = rgbOf(sp.c[0]), body = css(mix3(bc, [255, 226, 170], 0.45)), dark = css(mix3(bc, [60, 30, 20], 0.35)), mark = css(mix3(rgbOf(sp.c[2]), [120, 60, 30], 0.3));
        P.lineCap = P.lineJoin = 'round';
        for (const [v, ph] of [[ub - 1.1 / (n - 1), 0], [ub + 1.1 / (n - 1), 0.5]]) { const q = at(v), l = Math.hypot(q[2], q[3]) || 1, tx = q[2] / l, ty = q[3] / l;
          for (const sd of [-1, 1]) { const sw = Math.sin((S.t * 6 + ph * TAU) + (sd > 0 ? 0 : Math.PI)) * t * 0.22; P.fillStyle = dark; P.beginPath(); P.arc(q[0] - ty * sd * t * 0.58 + tx * sw, q[1] + tx * sd * t * 0.58 + ty * sw, Math.max(1.2, t * 0.24), 0, TAU); P.fill(); } }
        P.strokeStyle = body;
        for (let i = M - 1; i >= 0; i--) { const v0 = i / M, v1 = (i + 1) / M, p0 = at(v0), p1 = at(v1); P.lineWidth = Math.max(1.5, wid((v0 + v1) / 2)); P.beginPath(); P.moveTo(p0[0], p0[1]); P.lineTo(p1[0], p1[1]); P.stroke(); }
        P.strokeStyle = mark; P.lineWidth = Math.max(1, t * 0.12); P.beginPath(); for (let i = Math.round(M * Math.max(0, ub - 1.6 / (n - 1))); i <= M * Math.min(0.9, ub + 3 / (n - 1)); i++) { const p0 = at(i / M); if (P.__m) P.lineTo(p0[0], p0[1]); else { P.moveTo(p0[0], p0[1]); P.__m = 1; } } P.__m = 0; P.stroke();
        const hd = at(0), l = Math.hypot(hd[2], hd[3]) || 1, hx = hd[2] / l, hy = hd[3] / l;
        P.fillStyle = mark; P.beginPath(); P.ellipse(hd[0] + hx * t * 0.15, hd[1] + hy * t * 0.15, t * 0.42, t * 0.3, Math.atan2(hy, hx), 0, TAU); P.fill();
        P.fillStyle = '#fff8e0'; for (const sd of [-1, 1]) P.fillRect(Math.round(hd[0] + hx * t * 0.22 - hy * sd * t * 0.2 - 0.5), Math.round(hd[1] + hy * t * 0.22 + hx * sd * t * 0.2 - 0.5), Math.max(1, t >> 3), Math.max(1, t >> 3));
      }
      const O = scr.flush({ mask: 0xf8, dither: 0, line: 0xff000000 }).ctx;
      txt(O, 'FERNS ' + pad(S.score, 3), 3, 2, '#ffec27'); const hs = 'HI ' + pad(Math.max(S.hi, S.score), 3); txt(O, hs, bw - tw(hs) - 3, 2, '#ff77a8');
      const nm = fitName(sp.name, Math.max(4, ((bw - 100) >> 2))); ctxt(O, nm, bw / 2, 2, '#fff1e8');
      if (S.dead > 0) { O.fillStyle = '#000000'; O.fillRect(bw / 2 - 30, bh / 2 - 5, 60, 11); ctxt(O, S.msg, bw / 2, bh / 2 - 2, '#ffec27'); }
      bezel(f, V.r, '90,230,150'); present(f, V, O.canvas, f.p.x2 * 2);
    }
  };
}

// ================================================================ 7. attract mode
function titleGame(opts) {
  const scr = pixelScreen(), lut = makeLUT(PAL16), S = { t: 0, credits: 0, coin: 0, idx: 0, sw: 0 };
  const RAIN = ['#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#ff77a8', '#ffccaa', '#c2c3c7'];
  return {
    click(x, y, f) { S.credits = Math.min(99, S.credits + 1); S.coin = 1; if (f.sig) f.sig.roar = 1; },
    step(h) { S.t += h; S.coin = Math.max(0, S.coin - h); S.sw += h; if (S.sw > 5) { S.sw = 0; S.idx++; } },
    draw(f) {
      const E = f.era, V = pix(f, scr), { B, P, bw, bh } = V, sc = Math.max(2, Math.floor(bw / 44)), ly = 4, y1 = ly + 5 * sc + 4, gy = bh - 25, x0 = Math.floor(bw * 0.47);
      let list = castAt(E.ma, 'walk').sort((a, b) => b.len - a.len);
      if (!list.length) { const s = standIn(opts.sp || 'tyrannosaurus', E.ma); if (s) list = [s]; }
      const N = Math.max(1, Math.min(8, Math.floor((gy - 24 - y1) / 7) + 1)); list = list.slice(0, N);
      const cur = list.length ? S.idx % list.length : 0, sp = list[cur], roar = S.coin > 0 || (S.sw > 2 && S.sw < 3.1), cx = (x0 - 2) / 2;
      B.fillStyle = '#1d2b53'; B.fillRect(0, 0, bw, bh);
      B.fillStyle = '#7e2553'; for (let i = 0; i < 12; i++) { const a0 = i * TAU / 12 + S.t * 0.12, a1 = a0 + TAU / 24, r = bw; B.beginPath(); B.moveTo(cx, gy - 4); B.lineTo(cx + Math.cos(a0) * r, gy - 4 + Math.sin(a0) * r); B.lineTo(cx + Math.cos(a1) * r, gy - 4 + Math.sin(a1) * r); B.fill(); }
      B.fillStyle = '#000000'; B.globalAlpha = 0.82; B.fillRect(x0 - 3, y1 + 7, bw - x0, 12 + list.length * 7 + (E.dinos < 0.5 ? 16 : 0)); B.globalAlpha = 1;
      B.fillStyle = '#008751'; B.fillRect(0, gy, bw, bh - gy); B.fillStyle = '#00e436'; B.fillRect(0, gy, bw, 1); B.fillStyle = '#000000'; B.fillRect(0, gy + 12, bw, bh);
      for (let i = 0; i < bw / 12 + 2; i++) { B.fillStyle = '#1d2b53'; B.fillRect(Math.round(i * 12 - (S.t * 14) % 12), gy + 3 + (i % 3) * 3, 4, 1); }
      if (sp) {
        const q0 = pose(sp, {}), mn = q0.nodes[0].x, mx = snout(q0)[0], k = Math.min((x0 - 8) / (mx - mn), (gy - y1 - 12) / size(sp).tall);
        const q = pose(sp, { phase: S.t * 0.55, t: S.t, headTo: roar ? 0.6 : 0.1 * Math.sin(S.t * 0.7), jaw: roar ? 0.8 + 0.2 * Math.sin(S.t * 30) : 0 });
        drawParts(P, parts(q), { x: Math.round(cx - (mn + mx) / 2 * k), y: gy + 1, k, dir: 1 }, S.sw < 0.12 ? { fill: () => '#fff1e8', pupil: false } : { pal: palette(sp) });
      }
      const O = scr.flush({ lut, dither: 0, line: 0xff000000 }).ctx, title = 'MEGA-DINO', lx = Math.round((bw - tw(title, sc)) / 2);
      txt(O, title, lx + sc, ly + sc, '#7e2553', sc); txt(O, title, lx, ly, '#ffa300', sc);
      O.save(); O.beginPath(); O.rect(0, ly, bw, Math.round(sc * 2.5)); O.clip(); txt(O, title, lx, ly, '#ffec27', sc); O.restore();
      O.save(); O.beginPath(); const shx = lx + ((S.t * 60) % (bw * 1.6)) - 10; O.moveTo(shx, ly); O.lineTo(shx + sc * 2, ly); O.lineTo(shx + sc * 2 - 6, ly + 5 * sc); O.lineTo(shx - 6, ly + 5 * sc); O.clip(); txt(O, title, lx, ly, '#fff1e8', sc); O.restore();
      ctxt(O, E.name + '  ' + E.ma.toFixed(0) + ' MA', bw / 2, y1, '#29adff');
      const tx = x0, tr = bw - 4, maxN = Math.floor((tr - tx) / 4) - 8;
      txt(O, 'HI-SCORES', tx, y1 + 9, '#ff77a8'); txt(O, 'LENGTH', tr - tw('LENGTH'), y1 + 9, '#83769c');
      list.forEach((s, i) => { const y = y1 + 17 + i * 7, col = i === cur && fract(S.t * 3) < 0.5 ? '#fff1e8' : RAIN[i % 8], sco = s.len.toFixed(1) + 'M';
        txt(O, (i + 1) + ' ' + fitName(s.name, maxN), tx, y, col); txt(O, sco, tr - tw(sco), y, col); });
      if (sp) ctxt(O, fitName(sp.name, (x0 >> 2) - 1), cx, gy + 3, '#fff1e8');
      if (E.dinos < 0.5) { txt(O, 'ONLY THE BIRDS', tx, y1 + 20 + list.length * 7, '#c2c3c7'); txt(O, 'ARE LEFT', tx, y1 + 27 + list.length * 7, '#c2c3c7'); }
      if (fract(S.t * 1.1) < 0.62) ctxt(O, 'PRESS START', bw / 2, bh - 9, '#ffec27');
      txt(O, 'CREDIT ' + pad(S.credits, 2), bw - tw('CREDIT 00') - 4, bh - 9, '#c2c3c7'); txt(O, '1UP', 4, bh - 9, '#ff004d');
      if (S.coin > 0.8) { O.fillStyle = 'rgba(255,255,255,0.5)'; O.fillRect(0, 0, bw, bh); }
      bezel(f, V.r, '255,200,90'); present(f, V, O.canvas, f.p.x2 * 2);
    }
  };
}

// ================================================================ 4. vector monitor
function wire(c, ps, T, col, lw) {
  c.lineJoin = c.lineCap = 'round'; c.lineWidth = lw; c.fillStyle = '#000'; c.strokeStyle = col;
  for (const q of ps) {
    if (q.k === 'mark' || q.k === 'belly' || q.k === 'fuzz' || q.k === 'nostril' || (q.t === 'mark' && !q.l)) continue;
    c.beginPath(); trace(c, q, T); if (!q.l) c.fill();
    c.globalAlpha = q.t === 'far' || q.t === 'accentFar' ? 0.45 : 1; c.stroke(); c.globalAlpha = 1;
  }
}
function vectorGame(opts) {
  const R = seeded(opts, 53), cast = opts.cast || ['triceratops'];
  let sps = cast.map(species), V = null, Q = null, vw = 0, vh = 0, asp = 16 / 9;
  const D = []; for (let i = 0; i < 8; i++) D.push({ x: i ? 0.06 + 0.9 * fract(i * 0.618 + 0.33) : 0.27, z: i ? 0.08 + 0.8 * hash(i, 77) : 1, ph: hash(i, 3), si: i % cast.length });
  const S = { t: 0, cam: 0, met: [], rings: [], frag: [], imp: [], score: 0, hits: 0, cool: 0, roar: 0, flinch: 0, spawn: 1, head: [0.6, 0.62] };
  const fire = (tx, ty, f) => { S.rings.push({ x: S.head[0], y: S.head[1], a: Math.atan2(ty - S.head[1], tx - S.head[0]), r: 0.02 }); S.cool = 0.55; S.roar = 0.6; if (f.sig) f.sig.roar = 1; };
  return {
    pre(f) { sps = cast.map((c, i) => standIn(c, f.era.ma) || sps[i]); },
    click(x, y, f) { if (vh) fire((x * f.w - S.rx) / vh, (y * f.h - S.ry) / vh, f); },
    step(h, f) {
      S.t += h; S.cam += gait(sps[0], 0).vWalk * h; S.cool -= h; S.roar = Math.max(0, S.roar - h); S.flinch = Math.max(0, S.flinch - h * 1.5);
      for (const d of D) { const g = gait(sps[d.si], 0); d.ph += h * g.vWalk / g.stride; }
      S.spawn -= h * (1 + 7 * clamp(f.era.meteor) + 4 * f.era.flash);
      if (S.spawn <= 0) { S.spawn = lerp(2.4, 0.55, f.p.x3) * (0.6 + R() * 0.8); const v = 0.42 + R() * 0.25, a = 2.05 + R() * 0.5;
        S.met.push({ x: asp * (0.4 + R() * 0.85), y: -0.05, vx: Math.cos(a) * v, vy: Math.sin(a) * v, gy: 0.66 + R() * 0.26, s: R() }); }
      for (let i = S.met.length - 1; i >= 0; i--) { const m = S.met[i]; m.x += m.vx * h; m.y += m.vy * h;
        if (m.y >= m.gy) { S.imp.push({ x: m.x, y: m.gy, t: 0 }); S.hits++; S.flinch = 1; S.met.splice(i, 1); if (f.sig) f.sig.step = 1; continue; }
        if (S.cool <= 0 && m.y > 0.05 && m.y < m.gy - 0.08 && Math.hypot(m.x - S.head[0], m.y - S.head[1]) < 0.62) fire(m.x + m.vx * 0.3, m.y + m.vy * 0.3, f); }
      for (let i = S.rings.length - 1; i >= 0; i--) { const r = S.rings[i]; r.r += 1.15 * h;
        for (let j = S.met.length - 1; j >= 0; j--) { const m = S.met[j], d = Math.hypot(m.x - r.x, m.y - r.y); let da = Math.atan2(m.y - r.y, m.x - r.x) - r.a; da = Math.atan2(Math.sin(da), Math.cos(da));
          if (Math.abs(d - r.r) < 0.04 && Math.abs(da) < 0.55) { for (let k = 0; k < 7; k++) { const a = R() * TAU, v = 0.1 + R() * 0.3; S.frag.push({ x: m.x, y: m.y, vx: Math.cos(a) * v + m.vx * 0.3, vy: Math.sin(a) * v + m.vy * 0.3, a: R() * TAU, va: (R() - 0.5) * 12, t: 0 }); } S.score += 100; S.met.splice(j, 1); } }
        if (r.r > 0.8) S.rings.splice(i, 1); }
      for (let i = S.frag.length - 1; i >= 0; i--) { const g = S.frag[i]; g.x += g.vx * h; g.y += g.vy * h; g.vy += 0.3 * h; g.a += g.va * h; g.t += h; if (g.t > 0.9) S.frag.splice(i, 1); }
      for (let i = S.imp.length - 1; i >= 0; i--) { S.imp[i].t += h; if (S.imp[i].t > 0.9) S.imp.splice(i, 1); }
    },
    draw(f) {
      const { ctx } = f, E = f.era, r = screenRect(f), w = Math.round(r.w), h = Math.round(r.h), crt = f.p.x2;
      let fresh = false;
      if (w !== vw || h !== vh) { vw = w; vh = h; V = mk(w, h); Q = mk(w / 4, h / 4); fresh = true; }
      asp = w / h; S.rx = r.x; S.ry = r.y;
      const c = V.ctx, lw = Math.max(1, h * 0.0032 * (0.5 + 1.1 * f.p.x4)), hz = 0.6 * h, n = 2 + Math.round(f.p.herd * 6);
      c.globalCompositeOperation = 'source-over'; c.fillStyle = `rgba(0,0,0,${fresh ? 1 : lerp(0.6, 0.14, crt)})`; c.fillRect(0, 0, w, h);
      c.lineWidth = lw * 0.8; c.lineCap = c.lineJoin = 'round';
      c.fillStyle = '#5a6a9a'; for (let i = 0; i < 40; i++) c.fillRect(hash(i, 1) * w, hash(i, 2) * hz * 0.9, lw, lw);
      // far ridge with a volcano, a ground grid that scrolls with the herd
      const kN = 0.2 * h / size(sps[0]).tall, scroll = S.cam * kN;
      c.strokeStyle = '#2a3fae'; c.beginPath(); const mw = h * 0.16, m0 = Math.floor(scroll * 0.08 / mw);
      for (let i = m0 - 1; (i - 1) * mw - scroll * 0.08 < w; i++) { const x = i * mw - scroll * 0.08, y = hz - (i % 7 === 0 ? 0.2 : 0.03 + 0.1 * hash(i, 9)) * h; if (i === m0 - 1) c.moveTo(x, y); else c.lineTo(x, y); if (i % 7 === 0) { c.lineTo(x + mw * 0.25, y + h * 0.015); c.lineTo(x + mw * 0.5, y); } }
      c.stroke();
      c.strokeStyle = '#123a80'; c.beginPath(); c.moveTo(0, hz); c.lineTo(w, hz);
      for (let j = 1; j <= 5; j++) { const y = hz + (h - hz) * Math.pow(j / 5, 1.7); c.moveTo(0, y); c.lineTo(w, y); }
      const gs = h * 0.42; for (let i = -6; i <= 6 + w / gs; i++) { const xb = i * gs - (scroll % gs); c.moveTo(w / 2 + (xb - w / 2) * 0.25, hz); c.lineTo(w / 2 + (xb - w / 2) * 1.6, h); }
      c.stroke();
      c.strokeStyle = '#1c8a4a'; const ps = h * 0.5, sc2 = scroll * 0.45;
      for (let i = Math.floor(sc2 / ps) - 1; i * ps - sc2 < w + ps; i++) { if (hash(i, 61) > 0.2 + f.p.detail * 0.8) continue; const kind = pickPlant(E, hash(i, 62), hash(i, 63) < 0.6), tall = !PLANTS[kind].low, T = { x: i * ps - sc2 + hash(i, 64) * ps * 0.6, y: hz + h * 0.03, k: (tall ? h * (0.16 + 0.12 * hash(i, 65)) : h * 0.05) / PLANTS[kind].h, dir: 1 };
        for (const q of plantParts(kind, i + 7, 0)) { c.beginPath(); trace(c, q, T); c.fillStyle = '#000'; if (!q.l) c.fill(); c.stroke(); } }
      // the herd, far to near; the leader (front, gold) roars at the meteors
      const order = D.slice(0, n).sort((a, b) => a.z - b.z);
      for (const d of order) {
        const sp = sps[d.si], lead = d === D[0], kk = kN * lerp(0.5, 1, d.z), T = { x: d.x * w, y: lerp(0.67, 0.9, d.z) * h, k: kk, dir: 1 };
        const q = pose(sp, { phase: d.ph, t: S.t + d.ph * 9, headTo: lead ? (S.roar > 0 ? 0.75 : 0.15) : 0.3 * S.flinch, jaw: lead && S.roar > 0 ? 1 : 0, rear: S.flinch * (lead ? 0.05 : 0.12 * hash(d.si, d.z * 9)) });
        if (lead) { const s = snout(q); S.head = [(T.x + s[0] * kk) / h, (T.y - s[1] * kk) / h]; }
        const b = lerp(0.45, 1, d.z); wire(c, parts(q), T, lead ? '#ffd640' : css([60 * b, 255 * b, 140 * b]), lw * lerp(0.7, 1, d.z));
      }
      c.lineWidth = lw * 1.2;
      for (const m of S.met) { c.strokeStyle = '#ff9a3a'; c.beginPath(); c.moveTo(m.x * h, m.y * h); c.lineTo((m.x - m.vx * 0.28) * h, (m.y - m.vy * 0.28) * h); c.stroke();
        c.strokeStyle = '#fff4d0'; c.beginPath(); const rad = h * 0.012; for (let k = 0; k <= 5; k++) { const a = S.t * 5 + m.s * 9 + k * TAU / 5, rr2 = rad * (k % 2 ? 0.7 : 1.2); c[k ? 'lineTo' : 'moveTo'](m.x * h + Math.cos(a) * rr2, m.y * h + Math.sin(a) * rr2); } c.stroke(); }
      c.strokeStyle = '#ffd640'; for (const g of S.rings) for (let j = 0; j < 3; j++) { const rad = (g.r - j * 0.035) * h; if (rad > 2) { c.globalAlpha = clamp(1.2 - g.r * 1.4); c.beginPath(); c.arc(g.x * h, g.y * h, rad, g.a - 0.5, g.a + 0.5); c.stroke(); } }
      c.globalAlpha = 1; c.strokeStyle = '#ffb060';
      for (const g of S.frag) { c.globalAlpha = clamp(1.1 - g.t * 1.2); const l = h * 0.012; c.beginPath(); c.moveTo(g.x * h - Math.cos(g.a) * l, g.y * h - Math.sin(g.a) * l); c.lineTo(g.x * h + Math.cos(g.a) * l, g.y * h + Math.sin(g.a) * l); c.stroke(); }
      c.strokeStyle = '#ff5a3a';
      for (const g of S.imp) { c.globalAlpha = clamp(1.1 - g.t * 1.2); c.beginPath(); c.ellipse(g.x * h, g.y * h, g.t * h * 0.16 + 2, g.t * h * 0.045 + 1, 0, 0, TAU); c.stroke();
        c.beginPath(); for (let k = 0; k < 6; k++) { const a = -0.4 - k * 0.46, l0 = g.t * h * 0.1, l1 = l0 + h * 0.03; c.moveTo(g.x * h + Math.cos(a) * l0, g.y * h + Math.sin(a) * l0); c.lineTo(g.x * h + Math.cos(a) * l1, g.y * h + Math.sin(a) * l1); } c.stroke(); }
      c.globalAlpha = 1; c.lineWidth = lw;
      const u = h * 0.011; c.strokeStyle = '#7fe0ff'; vtext(c, 'SCORE ' + pad(S.score, 6), h * 0.04, h * 0.045, u);
      const s2 = 'HITS ' + pad(S.hits, 3); vtext(c, s2, w - h * 0.04 - s2.length * u * 3.3, h * 0.045, u);
      c.strokeStyle = '#ffd640'; vtext(c, sps[0].name, h * 0.04, h * 0.93, u * 0.8);
      const s3 = E.ma.toFixed(1) + ' MA'; c.strokeStyle = '#ff7a5a'; vtext(c, s3, w - h * 0.04 - s3.length * u * 2.64, h * 0.93, u * 0.8);
      if (E.flash > 0.02) { c.fillStyle = `rgba(255,240,210,${E.flash * 0.5})`; c.fillRect(0, 0, w, h); }
      // to the canvas: the tube, a soft bloom, the glass
      bezel(f, r, '90,210,255');
      ctx.save(); rr(ctx, r.x, r.y, r.w, r.h, f.h * 0.035); ctx.clip();
      ctx.drawImage(V.canvas, r.x, r.y);
      Q.ctx.globalCompositeOperation = 'copy'; Q.ctx.drawImage(V.canvas, 0, 0, Q.canvas.width, Q.canvas.height);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 + 0.7 * crt; ctx.imageSmoothingEnabled = true; ctx.drawImage(Q.canvas, r.x, r.y, w, h);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; glass(f, r, 0.4 + crt); ctx.restore();
    }
  };
}

// ================================================================ 2. virtual pet
const ICONS = [[6, 15, 31, 62, 60, 88, 64], [28, 56, 112, 112, 113, 62, 28], [28, 38, 71, 79, 127, 62, 28], [54, 127, 127, 127, 62, 28, 8], [28, 34, 65, 65, 65, 34, 28], [28, 28, 28, 28, 0, 28, 28]];
function petGame(opts) {
  const R = seeded(opts, 71), sp = species(opts.sp || 'triceratops'), MW = 40, MH = 24, GY = 22;   // the species is locked: it is a toy
  let M = null; const fitC = {};
  const S = { t: 0, age: 0, stage: 0, x: 20, dir: 1, act: 'walk', tm: 2, food: null, meals: 0, pop: 0 };
  const YOUNG = [1, 1, 0.6, 0.25], TALL = [0, 9, 13, 18];
  const fit = st => fitC[st] || (fitC[st] = (() => { const q = pose(sp, { young: YOUNG[st] }); let top = q.head.y + q.head.len * 0.7; for (const n of q.nodes) top = Math.max(top, n.y + n.r); const mn = q.nodes[0].x, mx = snout(q)[0], k = Math.min(TALL[st] / top, (st === 3 ? 34 : 28) / (mx - mn)); return { k, mid: (mn + mx) / 2 * k, half: (mx - mn) / 2 * k }; })());
  const choose = () => { const r = R(); if (r < 0.45) { S.food = { x: 6 + R() * 28 }; S.act = 'seek'; S.tm = 9; } else if (r < 0.65) { S.act = 'walk'; S.tm = 2 + R() * 2; } else if (r < 0.82) { S.act = 'sleep'; S.tm = 4.5; } else { S.act = 'play'; S.tm = 2.4; } };
  return {
    click(x) { if (S.stage > 0 && S.act !== 'eat') { S.food = { x: clamp(S.lx != null ? (x - S.lx) / S.lw * MW : 20, 5, 35) }; S.act = 'seek'; S.tm = 9; } },
    step(h, f) {
      S.t += h; S.age += h; S.tm -= h; S.pop = Math.max(0, S.pop - h);
      if (S.stage === 0) { if (S.age > 7) { S.stage = 1; S.age = 0; S.act = 'happy'; S.tm = 1.5; S.x = 20; S.pop = 0.8; if (f.sig) f.sig.roar = 1; } return; }
      if (S.stage < 3 && S.age > 15 * S.stage) { S.stage++; S.pop = 0.9; }
      if (S.stage === 3 && S.age > 50 && S.act === 'walk') { S.stage = 0; S.age = 0; S.food = null; return; }
      const F = fit(S.stage), lo = F.half + 1, hi = MW - F.half - 1;
      if (S.act === 'walk') { S.x += S.dir * 5 * h; if (S.x > hi) { S.x = hi; S.dir = -1; } if (S.x < lo) { S.x = lo; S.dir = 1; } if (S.tm <= 0) choose(); }
      else if (S.act === 'seek') { const d = S.food.x - S.x; if (Math.abs(d) > 0.5) S.dir = d > 0 ? 1 : -1; const tx = clamp(S.food.x - S.dir * (F.half + 3), lo, hi);
        if (Math.abs(tx - S.x) > 0.6 && S.tm > 0) S.x += Math.sign(tx - S.x) * Math.min(7 * h, Math.abs(tx - S.x)); else { S.act = 'eat'; S.tm = 2.4; } }
      else if (S.act === 'eat') { if (S.tm <= 0) { S.food = null; S.meals++; S.act = 'happy'; S.tm = 1.3; } }
      else if (S.tm <= 0) { S.act = 'walk'; S.tm = 1.5 + R() * 2; }
    },
    draw(f) {
      const { ctx, w, h } = f, E = f.era, cx = w / 2, cy = h * 0.5, eh = h * lerp(0.4, 0.52, f.p.scale), ew = eh * 0.84, shell = rgbOf(opts.shell || '#2fb7a8');
      // the desk and the toy's shadow
      const dg = ctx.createLinearGradient(0, 0, 0, h); dg.addColorStop(0, '#cfc3ad'); dg.addColorStop(1, '#a8997f'); ctx.fillStyle = dg; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(90,70,50,0.12)'; ctx.lineWidth = Math.max(1, h * 0.004); for (let i = 0; i < 9; i++) { const y = h * (0.06 + i * 0.115 + 0.03 * hash(i, 4)); ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(w * 0.3, y + h * 0.02 * (hash(i, 1) - 0.5), w * 0.6, y - h * 0.03 * (hash(i, 2) - 0.5), w, y + h * 0.01); ctx.stroke(); }
      const egg = (ox, oy, s) => { ctx.beginPath(); ctx.moveTo(cx + ox, cy + oy - eh * s); ctx.bezierCurveTo(cx + ox + ew * 0.62 * s, cy + oy - eh * s, cx + ox + ew * s, cy + oy - eh * 0.45 * s, cx + ox + ew * s, cy + oy + eh * 0.12 * s);
        ctx.bezierCurveTo(cx + ox + ew * s, cy + oy + eh * 0.68 * s, cx + ox + ew * 0.6 * s, cy + oy + eh * s, cx + ox, cy + oy + eh * s); ctx.bezierCurveTo(cx + ox - ew * 0.6 * s, cy + oy + eh * s, cx + ox - ew * s, cy + oy + eh * 0.68 * s, cx + ox - ew * s, cy + oy + eh * 0.12 * s);
        ctx.bezierCurveTo(cx + ox - ew * s, cy + oy - eh * 0.45 * s, cx + ox - ew * 0.62 * s, cy + oy - eh * s, cx + ox, cy + oy - eh * s); ctx.closePath(); };
      ctx.fillStyle = 'rgba(40,28,16,0.28)'; egg(eh * 0.07, eh * 0.06, 1.02); ctx.fill();
      // key chain
      ctx.strokeStyle = '#8d8a84'; ctx.lineWidth = eh * 0.018; ctx.beginPath(); ctx.arc(cx, cy - eh * 1.03, eh * 0.06, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#b9b6ae'; for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.arc(cx + eh * (0.05 + i * 0.07 + 0.02 * i * i * 0.3), cy - eh * (1.1 + i * 0.045), eh * 0.022, 0, TAU); ctx.fill(); }
      const sg = ctx.createRadialGradient(cx - ew * 0.35, cy - eh * 0.45, eh * 0.05, cx, cy, eh * 1.1);
      sg.addColorStop(0, css(mix3(shell, [255, 255, 255], 0.5))); sg.addColorStop(0.35, css(shell)); sg.addColorStop(1, css(mix3(shell, [0, 0, 0], 0.45)));
      ctx.fillStyle = sg; egg(0, 0, 1); ctx.fill();
      ctx.save(); egg(0, 0, 1); ctx.clip(); ctx.fillStyle = css(mix3(shell, [0, 0, 0], 0.22), 0.55);
      for (let i = 0; i < 16; i++) { const a = hash(i, 3) * TAU, d = 0.55 + 0.42 * hash(i, 5); ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * ew * d, cy + Math.sin(a) * eh * d, eh * (0.03 + 0.05 * hash(i, 7)), eh * (0.025 + 0.035 * hash(i, 8)), a, 0, TAU); ctx.fill(); }
      ctx.restore();
      // faceplate and the LCD
      const lw = ew * 1.34, lh = lw * 0.84, lx = cx - lw / 2, ly = cy - eh * 0.12 - lh / 2, fp = lw * 0.09;
      ctx.fillStyle = css(mix3(shell, [0, 0, 0], 0.35)); rr(ctx, lx - fp - 2, ly - fp, lw + 2 * fp + 4, lh + 2 * fp + 4, fp * 1.3); ctx.fill();
      ctx.fillStyle = '#f1ead6'; rr(ctx, lx - fp, ly - fp, lw + 2 * fp, lh + 2 * fp, fp * 1.2); ctx.fill();
      ctx.fillStyle = '#39382f'; rr(ctx, lx - fp * 0.3, ly - fp * 0.3, lw + fp * 0.6, lh + fp * 0.6, fp * 0.4); ctx.fill();
      const lg = ctx.createLinearGradient(lx, ly, lx, ly + lh); lg.addColorStop(0, '#aebb98'); lg.addColorStop(1, '#c3cdaa'); ctx.fillStyle = lg; ctx.fillRect(lx, ly, lw, lh);
      S.lx = lx / w; S.lw = lw / w;
      const band = lh * 0.19, px = Math.min(lw * 0.94 / MW, (lh - 2 * band) / MH), mx0 = cx - px * MW / 2, my0 = ly + band + (lh - 2 * band - px * MH) / 2, ip = band * 0.66 / 7;
      const ON = 'rgba(22,30,26,0.9)', GH = `rgba(22,30,26,${0.03 + 0.09 * f.p.x2})`;
      // the dot matrix: rasterise the rig into 40×24, at four frames a second like the real thing
      if (!M) M = mk(MW, MH); const m = M.ctx, tq = Math.floor(S.t * 4) / 4;
      m.clearRect(0, 0, MW, MH); m.fillStyle = '#000';
      if (S.stage === 0) {
        const wob = S.age > 2 ? Math.sin(tq * 9) * 0.16 * Math.min(1, (S.age - 2) / 3) : 0;
        m.save(); m.translate(20, GY); m.rotate(wob); m.beginPath(); m.ellipse(0, -7, 5.5, 7, 0, 0, TAU); m.fill(); m.fillStyle = '#fff'; m.beginPath(); m.ellipse(0, -7, 4.2, 5.7, 0, 0, TAU); m.fill();
        m.fillStyle = '#000'; m.fillRect(-2, -10, 1, 1); m.fillRect(1, -5, 2, 1); m.fillRect(-3, -4, 1, 1);
        if (S.age > 3.5) { m.strokeStyle = '#000'; m.lineWidth = 1; m.beginPath(); const nz = Math.min(9, Math.floor((S.age - 3.5) * 3) + 2); for (let i = 0; i < nz; i++) m[i ? 'lineTo' : 'moveTo'](-4.5 + i, -8 + (i % 2) * 2); m.stroke(); }
        m.restore();
      } else if (!(S.pop > 0) || fract(S.pop * 6) < 0.5) {
        const F = fit(S.stage), hop = S.act === 'happy' || S.act === 'play' ? Math.abs(Math.sin(tq * 6)) * 3 : 0, chomp = S.act === 'eat' ? Math.floor(tq * 4) % 2 : 0;
        const q = pose(sp, { young: YOUNG[S.stage], t: tq, phase: S.act === 'walk' || S.act === 'seek' ? tq * 1.3 : 0, crouch: S.act === 'sleep' ? 0.95 : 0, headTo: S.act === 'sleep' ? -0.7 : S.act === 'eat' ? -0.55 - 0.3 * chomp : S.act === 'happy' ? 0.6 : 0, jaw: S.act === 'eat' ? 1 - chomp : S.act === 'happy' ? 0.8 : 0 });
        const T = { x: Math.round(S.x) - S.dir * F.mid, y: GY - Math.round(hop), k: F.k, dir: S.dir }, ps = parts(q);
        drawParts(m, ps.filter(p => p.k !== 'mark' && p.k !== 'belly'), T, { fill: () => '#000', pupil: false });
        const e = ps.find(p => p.k === 'eye'); if (e) { m.fillStyle = '#fff'; const es = S.stage > 1 ? 2 : 1; if (S.act !== 'sleep') m.fillRect(Math.round(T.x + T.dir * e.c[0] * T.k - es / 2), Math.round(T.y - e.c[1] * T.k - es / 2), es, es); }
        if (S.food) { const b = S.act === 'eat' ? Math.min(3, Math.floor((2.4 - S.tm) / 0.8)) : 0, ic = ICONS[0]; m.fillStyle = '#000'; for (let r = b * 2; r < 7; r++) for (let i = 0; i < 7; i++) if (ic[r] & (64 >> i)) m.fillRect(Math.round(S.food.x) - 3 + i, GY - 7 + r, 1, 1); }
        if (S.act === 'sleep') for (let i = 0; i < 2; i++) { const u = fract(tq * 0.4 + i * 0.5); txt(m, 'Z', Math.round(S.x + S.dir * F.half * 0.6 + u * 6), Math.round(GY - TALL[S.stage] * 0.6 - 4 - u * 8), '#000'); }
        if (S.act === 'happy' && S.pop <= 0) { const ic = ICONS[3]; for (let r = 0; r < 7; r++) for (let i = 0; i < 7; i++) if (ic[r] & (64 >> i)) m.fillRect(Math.round(S.x) - 3 + i, Math.max(0, GY - TALL[S.stage] - 11) + r, 1, 1); }
      }
      const d = m.getImageData(0, 0, MW, MH).data, g = px * 0.1;
      ctx.fillStyle = GH; ctx.beginPath(); for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) ctx.rect(mx0 + x * px + g, my0 + y * px + g, px - 2 * g, px - 2 * g); ctx.fill();
      for (const pass of [0, 1]) { ctx.fillStyle = pass ? ON : 'rgba(30,40,30,0.18)'; ctx.beginPath(); const o = pass ? 0 : px * 0.22;
        for (let y = 0, j = 0; y < MH; y++) for (let x = 0; x < MW; x++, j += 4) if (d[j + 3] > 90 && d[j] < 128) ctx.rect(mx0 + x * px + g + o, my0 + y * px + g + o, px - 2 * g, px - 2 * g); ctx.fill(); }
      // segmented icons above and below, and two counters
      const lit = [S.act === 'seek' || S.act === 'eat', S.act === 'sleep', S.act === 'play', S.act === 'happy' && S.stage > 0, S.stage === 0, S.act === 'seek' && fract(S.t * 2) < 0.5];
      for (let i = 0; i < 6; i++) { const ix = lx + lw * (0.07 + (i % 3) * 0.17), iy = (i < 3 ? ly + (band - ip * 7) / 2 + lh * 0.01 : ly + lh - band + (band - ip * 7) / 2 - lh * 0.01), ic = ICONS[i];
        ctx.fillStyle = lit[i] ? ON : GH; ctx.beginPath(); for (let r = 0; r < 7; r++) for (let x = 0; x < 7; x++) if (ic[r] & (64 >> x)) ctx.rect(ix + x * ip, iy + r * ip, ip * 0.94, ip * 0.94); ctx.fill(); }
      const dh = band * 0.62, dw = dh * 0.5, dy0 = ly + (band - dh) / 2 + lh * 0.01, dy1 = ly + lh - band + (band - dh) / 2 - lh * 0.01, dx2 = lx + lw * 0.94 - dw * 1.35 * 2, dx3 = lx + lw * 0.94 - dw * 1.35 * 3;
      ctx.fillStyle = GH; digits(ctx, 0, 2, dx2, dy0, dw, dh, true); digits(ctx, 0, 3, dx3, dy1, dw, dh, true);
      ctx.fillStyle = ON; digits(ctx, S.meals % 100, 2, dx2, dy0, dw, dh); digits(ctx, Math.round(E.ma), 3, dx3, dy1, dw, dh);
      ctx.fillStyle = 'rgba(22,30,26,0.75)'; ctx.font = `bold ${Math.max(5, dh * 0.5)}px system-ui, sans-serif`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText('MEALS', dx2 - dw * 0.4, dy0 + dh / 2); ctx.fillText('Ma', dx3 - dw * 0.4, dy1 + dh / 2); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      const gl = ctx.createLinearGradient(lx, ly, lx + lw * 0.6, ly + lh); gl.addColorStop(0, 'rgba(255,255,255,0.22)'); gl.addColorStop(0.4, 'rgba(255,255,255,0)'); ctx.fillStyle = gl; ctx.fillRect(lx, ly, lw, lh);
      // three buttons
      for (let i = -1; i <= 1; i++) { const bx = cx + i * ew * 0.36, by = cy + eh * (0.66 + (i ? 0 : 0.05)), br = ew * 0.095, press = (i === 0 && S.act === 'eat') || (i === -1 && S.act === 'seek');
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(bx + br * 0.12, by + br * 0.2, br * 1.08, 0, TAU); ctx.fill();
        const bg = ctx.createRadialGradient(bx - br * 0.3, by - br * 0.4, br * 0.1, bx, by, br); bg.addColorStop(0, press ? '#f3d98a' : '#fff3c4'); bg.addColorStop(1, press ? '#b98f2c' : '#e2b23c'); ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(bx, by + (press ? br * 0.1 : 0), br, 0, TAU); ctx.fill(); }
      dimRoom(f);
    }
  };
}

// ================================================================ 3. fixed-segment LCD handheld
function lcdGame(opts) {
  const R = seeded(opts, 97), sp = species(opts.sp || 'oviraptor');                 // locked: a toy has one printed animal
  let on = null, ghost = null, lw = 0, lh = 0, G = null;
  const S = { t: 0, acc: 0, eggs: [], pos: 1, score: 0, hi: 0, miss: 0, over: 0, tick: 0, hold: 0, crack: [0, 0], caught: 0 };
  function tick(f) {
    const diff = f.p.x3; S.tick++; S.crack[0] = Math.max(0, S.crack[0] - 1); S.crack[1] = Math.max(0, S.crack[1] - 1); S.caught = Math.max(0, S.caught - 1);
    if (S.hold > 0) S.hold--; else { let best = null; for (const e of S.eggs) if (!e.miss && (!best || e.j > best.j)) best = e; if (best) S.pos = best.c; }
    for (let i = S.eggs.length - 1; i >= 0; i--) { const e = S.eggs[i]; if (++e.j >= 5) { S.eggs.splice(i, 1); if (S.pos === e.c) { S.score++; S.caught = 1; if (f.sig) f.sig.step = 1; } else { S.miss++; S.crack[e.c >> 1] = 2; } } }
    if (S.miss >= 3) { S.over = 3.2; return; }
    if (S.tick % 2 === 0 || R() < 0.15 + 0.5 * f.p.herd * diff) S.eggs.push({ c: R() * 4 | 0, j: 0, miss: R() < 0.012 + 0.2 * diff * diff });
  }
  // every segment that exists on the glass; `sel(kind, a, b)` says which to draw
  function segs(c, sel, W, H) {
    c.fillStyle = c.strokeStyle = '#000'; c.lineJoin = c.lineCap = 'round';
    for (let m = 0; m < 4; m++) if (sel('mom', m)) {
      const T = G.T[m], ps = G.parts[m & 1];
      for (const q of ps) { if (q.k === 'mark' || q.k === 'belly' || q.k === 'eye' || q.k === 'nostril') continue;
        c.beginPath(); trace(c, q, T);
        if (q.l) { c.lineWidth = Math.max(1, q.w * T.k); c.stroke(); } else { c.globalCompositeOperation = 'destination-out'; c.lineWidth = Math.max(1.5, H * 0.012); c.stroke(); c.globalCompositeOperation = 'source-over'; c.fill(); } }
      const e = ps.find(q => q.k === 'eye'); if (e) { c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(T.x + T.dir * e.c[0] * T.k, T.y - e.c[1] * T.k, Math.max(1.2, e.c[2] * T.k * 1.5), 0, TAU); c.fill(); c.globalCompositeOperation = 'source-over'; }
    }
    const rx = H * 0.03, ry = H * 0.04;
    for (let ch = 0; ch < 4; ch++) for (let j = 0; j < 5; j++) if (sel('egg', ch, j)) { const p = G.egg(ch, j); c.beginPath(); c.ellipse(p[0], p[1], rx, ry, (ch < 2 ? 1 : -1) * j * 0.75, 0, TAU); c.fill();
      c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(p[0] - rx * 0.3, p[1] - ry * 0.3, rx * 0.28, 0, TAU); c.fill(); c.globalCompositeOperation = 'source-over'; }
    for (let s = 0; s < 2; s++) if (sel('crack', s)) { const x = W * (s ? 0.74 : 0.26), y = G.gy; c.beginPath(); c.ellipse(x, y - ry * 0.25, rx * 1.9, ry * 0.4, 0, 0, TAU); c.fill();
      c.beginPath(); c.moveTo(x - rx * 1.1, y - ry * 0.4); c.lineTo(x - rx * 0.9, y - ry * 1.5); c.lineTo(x - rx * 0.45, y - ry * 0.9); c.lineTo(x - rx * 0.1, y - ry * 1.4); c.lineTo(x + rx * 0.1, y - ry * 0.4); c.fill();
      c.beginPath(); c.moveTo(x + rx * 0.5, y - ry * 0.5); c.lineTo(x + rx * 0.8, y - ry * 1.3); c.lineTo(x + rx * 1.3, y - ry * 0.5); c.fill(); }
    for (let i = 0; i < 3; i++) if (sel('miss', i)) { const x = W * (0.76 + i * 0.07), y = H * 0.11; c.beginPath(); c.ellipse(x, y, rx * 0.8, ry * 0.8, 0, 0, Math.PI); c.fill();
      c.beginPath(); c.moveTo(x - rx * 0.8, y - ry * 0.25); c.lineTo(x - rx * 0.4, y - ry * 0.9); c.lineTo(x, y - ry * 0.3); c.lineTo(x + rx * 0.4, y - ry * 0.9); c.lineTo(x + rx * 0.8, y - ry * 0.25); c.fill(); }
    const dh = H * 0.13, dw = dh * 0.52;
    for (let i = 0; i < 3; i++) { const mask = sel('digit', i); if (mask) { c.beginPath(); seg7(c, W * 0.5 - dw * 2.02 + i * dw * 1.35, H * 0.045, dw, dh, mask); c.fill(); } }
  }
  function build(W, H) {
    lw = W; lh = H; on = mk(W, H); ghost = mk(W, H);
    const up = pose(sp, { headTo: 1, jaw: 0.7, rear: 0.9 }), low = pose(sp, { headTo: -0.25, jaw: 0.7, crouch: 0.15 }), su = snout(up), sl = snout(low), gy = H * 0.9, k = Math.min(H * 0.5 / su[1], W * 0.56 / (snout(low)[0] - low.nodes[0].x));
    G = { gy, parts: [parts(up), parts(low)], T: [], catch: [] };
    for (let m = 0; m < 4; m++) { const dir = m < 2 ? -1 : 1, s = m & 1 ? sl : su, T = { x: W * 0.5 - dir * W * 0.035, y: gy, k, dir }; G.T.push(T); G.catch.push([T.x + dir * s[0] * k, gy - s[1] * k]); }
    G.start = m => [m < 2 ? W * 0.085 : W * 0.915, G.catch[m][1] - H * 0.17];
    G.egg = (m, j) => { const a = G.start(m), b = G.catch[m], u = (j + 0.4) / 5; return [lerp(a[0], b[0], u), lerp(a[1], b[1], u) - H * 0.035]; };
    ghost.ctx.clearRect(0, 0, W, H); segs(ghost.ctx, (k2) => k2 === 'digit' ? 127 : true, W, H);
  }
  return {
    click(x, y) { if (S.win) { const u = (x - S.win[0]) / S.win[2], v = (y - S.win[1]) / S.win[3]; S.pos = (u < 0.5 ? 0 : 2) + (v < 0.55 ? 0 : 1); S.hold = 3; } },
    step(h, f) {
      S.t += h;
      if (S.over > 0) { S.over -= h; if (S.over <= 0) { S.hi = Math.max(S.hi, S.score); S.score = 0; S.miss = 0; S.eggs.length = 0; S.crack = [0, 0]; } return; }
      S.acc += h; const iv = lerp(0.62, 0.27, f.p.x3) * Math.max(0.6, 1 - S.score * 0.003);
      while (S.acc >= iv && !(S.over > 0)) { S.acc -= iv; tick(f); }
    },
    draw(f) {
      const { ctx, w, h } = f, E = f.era, bw = Math.min(w * 0.97, h * 1.66) * lerp(0.8, 1, f.p.scale), bh = bw / 1.66, bx = (w - bw) / 2, by = (h - bh) / 2;
      const W = Math.round(bw * 0.56), H = Math.round(bh * 0.7), X = Math.round((w - W) / 2), Y = Math.round(by + bh * 0.17), body = rgbOf(opts.shell || '#c9372c');
      if (W !== lw || H !== lh) build(W, H);
      S.win = [X / w, Y / h, W / w, H / h];
      const dg = ctx.createLinearGradient(0, 0, 0, h); dg.addColorStop(0, '#6f7f8d'); dg.addColorStop(1, '#4d5a66'); ctx.fillStyle = dg; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(10,14,20,0.35)'; rr(ctx, bx + bh * 0.03, by + bh * 0.05, bw, bh, bh * 0.13); ctx.fill();
      const sg = ctx.createLinearGradient(0, by, 0, by + bh); sg.addColorStop(0, css(mix3(body, [255, 255, 255], 0.25))); sg.addColorStop(0.12, css(body)); sg.addColorStop(1, css(mix3(body, [0, 0, 0], 0.35)));
      ctx.fillStyle = sg; rr(ctx, bx, by, bw, bh, bh * 0.13); ctx.fill();
      // brushed faceplate, window, buttons
      const fpx = X - bh * 0.045, fpy = by + bh * 0.055, fpw = W + bh * 0.09, fph = bh * 0.89, mg = ctx.createLinearGradient(fpx, fpy, fpx + fpw, fpy + fph);
      mg.addColorStop(0, '#e9e4d6'); mg.addColorStop(0.5, '#cfc8b6'); mg.addColorStop(1, '#e2dccb'); ctx.fillStyle = mg; rr(ctx, fpx, fpy, fpw, fph, bh * 0.03); ctx.fill();
      ctx.fillStyle = '#5a2019'; ctx.font = `bold ${Math.max(6, bh * 0.055)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('EGG RESCUE', w / 2, by + bh * 0.115); ctx.font = `${Math.max(5, bh * 0.032)}px system-ui, sans-serif`; ctx.fillStyle = '#6b6658'; ctx.fillText('MEGA-DINO  ·  WIDE LCD', w / 2, Y + H + bh * 0.04);
      ctx.fillStyle = '#23241f'; rr(ctx, X - bh * 0.018, Y - bh * 0.018, W + bh * 0.036, H + bh * 0.036, bh * 0.015); ctx.fill();
      for (const sd of [-1, 1]) for (const up of [0, 1]) { const cxb = w / 2 + sd * (W / 2 + (bw - W) / 4 + bh * 0.01), cyb = by + bh * (up ? 0.44 : 0.72), br = bh * 0.085, press = S.pos === (sd < 0 ? 0 : 2) + (up ? 0 : 1) && fract(S.acc * 3) < 0.5;
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(cxb + br * 0.1, cyb + br * 0.16, br * 1.12, 0, TAU); ctx.fill();
        const bg = ctx.createRadialGradient(cxb - br * 0.3, cyb - br * 0.4, br * 0.1, cxb, cyb, br); bg.addColorStop(0, press ? '#d9d3c0' : '#fbf6e6'); bg.addColorStop(1, press ? '#9a9482' : '#c4bda8'); ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(cxb, cyb + (press ? br * 0.08 : 0), br, 0, TAU); ctx.fill(); }
      for (let i = 0; i < 3; i++) { const px2 = bx + bw - (bw - W) / 4 - bh * 0.01 + (i - 1) * bh * 0.09, py2 = by + bh * 0.16; ctx.fillStyle = '#3a3a36'; rr(ctx, px2 - bh * 0.032, py2 - bh * 0.014, bh * 0.064, bh * 0.028, bh * 0.014); ctx.fill(); }
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      // the glass: pale LCD, a printed colour scene, then ghost and lit segments
      const lg = ctx.createLinearGradient(X, Y, X, Y + H); lg.addColorStop(0, '#c9d2bb'); lg.addColorStop(1, '#b3bea3'); ctx.fillStyle = lg; ctx.fillRect(X, Y, W, H);
      ctx.save(); ctx.beginPath(); ctx.rect(X, Y, W, H); ctx.clip(); ctx.translate(X, Y);
      ctx.fillStyle = 'rgba(120,170,200,0.2)'; ctx.fillRect(0, 0, W, H * 0.5);
      ctx.strokeStyle = 'rgba(150,110,90,0.3)'; ctx.lineWidth = Math.max(1, H * 0.008); ctx.beginPath(); ctx.moveTo(W * 0.3, G.gy - H * 0.02); ctx.lineTo(W * 0.46, H * 0.3); ctx.lineTo(W * 0.5, H * 0.33); ctx.lineTo(W * 0.54, H * 0.3); ctx.lineTo(W * 0.72, G.gy - H * 0.02); ctx.stroke();
      ctx.fillStyle = 'rgba(96,150,84,0.55)'; ctx.fillRect(0, G.gy, W, H - G.gy);
      const pp = { trunk: 'rgba(130,96,60,0.75)', leaf: 'rgba(70,140,80,0.7)', leaf2: 'rgba(110,165,84,0.7)', rock: 'rgba(150,112,70,0.85)', rock2: 'rgba(150,112,70,0.85)', egg: 'rgba(250,244,224,0.95)', flower: 'rgba(230,150,170,0.8)' };
      for (let i = 0; i < 6; i++) { const kind = i % 2 ? 'fern' : pickPlant(E, hash(i, 91), false); drawParts(ctx, plantParts(kind, i + 4, 0), { x: W * (0.06 + 0.176 * i + 0.03 * hash(i, 2)), y: G.gy + H * 0.02, k: H * 0.075 / PLANTS[kind].h, dir: 1 }, { pal: pp }); }
      ctx.lineCap = 'round';
      for (let m = 0; m < 4; m++) { const a = G.start(m), b = G.catch[m], dir = m < 2 ? -1 : 1, ex = b[0] + dir * W * 0.015;
        ctx.strokeStyle = 'rgba(130,96,60,0.85)'; ctx.lineWidth = Math.max(1.5, H * 0.016); ctx.beginPath(); ctx.moveTo(m < 2 ? 0 : W, a[1]); ctx.lineTo(a[0], a[1]); ctx.lineTo(ex, b[1] + H * 0.012); ctx.stroke();
        ctx.lineWidth = Math.max(1, H * 0.008); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0], a[1] + H * 0.07); ctx.lineTo(m < 2 ? 0 : W, a[1] + H * 0.12); ctx.stroke();
        drawParts(ctx, plantParts('nest', m + 2, 0), { x: m < 2 ? W * 0.04 : W * 0.96, y: a[1] - H * 0.004, k: H * 0.055, dir: 1 }, { pal: pp }); }
      ctx.restore();
      const blink = S.over > 0 && fract(S.over * 2) < 0.4, sc = pad(S.score, 3);
      on.ctx.clearRect(0, 0, W, H);
      if (!blink) segs(on.ctx, (k2, a, b) => k2 === 'mom' ? a === S.pos : k2 === 'egg' ? S.eggs.some(e => e.c === a && e.j === b) : k2 === 'crack' ? S.crack[a] > 0 : k2 === 'miss' ? a < S.miss : SEG7[+sc[a]], W, H);
      ctx.globalAlpha = 0.03 + 0.1 * f.p.x2; ctx.drawImage(ghost.canvas, X, Y);
      ctx.globalAlpha = 0.16; ctx.drawImage(on.canvas, X + H * 0.012, Y + H * 0.014); ctx.globalAlpha = 0.9; ctx.drawImage(on.canvas, X, Y); ctx.globalAlpha = 1;
      const gl = ctx.createLinearGradient(X, Y, X + W * 0.5, Y + H); gl.addColorStop(0, 'rgba(255,255,255,0.2)'); gl.addColorStop(0.35, 'rgba(255,255,255,0)'); ctx.fillStyle = gl; ctx.fillRect(X, Y, W, H);
      dimRoom(f);
    }
  };
}

const GAMES = { run: runGame, pet: petGame, lcd: lcdGame, vector: vectorGame, boss: bossGame, snake: snakeGame, title: titleGame };

export default {
  id: 'arcade',
  name: 'Arcade & LCD',
  kind: '2d',
  sky: false,
  params: [
    { id: 'x1', label: 'Game speed', value: 0.5, tip: 'How fast the games run' },
    { id: 'x2', label: 'CRT', value: 0.5, tip: 'Scanlines, glow and phosphor trails; on the LCD toys, how visible the unlit segments are' },
    { id: 'x3', label: 'Difficulty', value: 0.5, tip: 'Faster games and a player that makes more mistakes' },
    { id: 'x4', label: 'Pixels', value: 0.5, tip: 'Chunkier pixels, or thicker beams on the vector monitor' },
  ],
  create(ctx, opts) {
    const game = (GAMES[opts.game] || runGame)(opts);
    let acc = 0, warmed = false;
    return {
      render(f) {
        game.pre?.(f);
        if (!warmed) { warmed = true; const n = (opts.warm ?? 24) * 30; for (let i = 0; i < n; i++) game.step(1 / 30, f); }
        for (const c of f.pointer?.clicks || []) game.click?.(c.x, c.y, f);
        acc = Math.min(0.6, acc + f.dt * (0.35 + 1.3 * f.p.x1) * (0.75 + 0.5 * f.p.activity));
        while (acc >= 1 / 60) { game.step(1 / 60, f); acc -= 1 / 60; }
        if (f.sig) { f.sig.count = 0.3; f.sig.speed = 0.5; }
        game.draw(f);
      }
    };
  }
};

const Sc = (id, name, desc, tags, opts, params) => ({ id: 'arcade-' + id, name, desc, tags: [...tags, '2d'], opts, params });
export const scenes = [
  Sc('runner', 'Raptor Run', 'An endless runner: a small theropod hops rocks, cycads and logs and ducks under pterosaurs. Click to jump.', ['game', '8-bit', 'theropod', 'pterosaur', 'cretaceous'],
    { game: 'run', sp: 'velociraptor', fly: 'pteranodon', seed: 3 }, { stage: 0.79, light: 0.4 }),
  Sc('pet', 'Pocket Hatchling', 'A pocket LCD pet: a Triceratops hatches, eats, naps and grows through three sizes (the toy keeps its species). Click to feed.', ['lcd', 'toy', 'ceratopsian', 'cretaceous', 'family'],
    { game: 'pet', sp: 'triceratops', shell: '#2fb7a8', seed: 5, warm: 30 }, { stage: 0.855, light: 0.85 }),
  Sc('lcd', 'Egg Rescue', 'A fixed-segment handheld: a mother Oviraptor catches eggs rolling from four nests (species printed on the glass). Click a corner to move her.', ['lcd', 'toy', 'game', 'theropod', 'cretaceous', 'nest'],
    { game: 'lcd', sp: 'oviraptor', shell: '#c9372c', seed: 8, warm: 18 }, { stage: 0.8, light: 0.85 }),
  Sc('vector', 'Vector Stampede', 'A glowing wireframe herd crosses a black vector screen while the lead animal roars meteors out of the sky. Click to roar.', ['game', 'vector', 'ceratopsian', 'ornithopod', 'herd', 'cretaceous', 'impact'],
    { game: 'vector', cast: ['triceratops', 'triceratops', 'edmontosaurus', 'triceratops', 'ankylosaurus', 'edmontosaurus', 'triceratops', 'pachycephalosaurus'], seed: 13 }, { stage: 0.865, light: 0.15, herd: 0.6 }),
  Sc('boss', 'Hell Creek Showdown', 'A 16-bit boss fight: T. rex and Triceratops trade charges and roars. Nobody dies; the round resets. Click to roar.', ['game', '16-bit', 'theropod', 'ceratopsian', 'cretaceous'],
    { game: 'boss', a: 'tyrannosaurus', b: 'triceratops', seed: 17 }, { stage: 0.855, light: 0.35 }),
  Sc('snake', 'Long-Neck', 'A top-down grid game: a sauropod whose neck and tail grow with every fern it eats. Click to plant a fern.', ['game', '8-bit', 'sauropod', 'jurassic', 'top-down'],
    { game: 'snake', sp: 'diplodocus', seed: 21 }, { stage: 0.42, light: 0.4 }),
  Sc('title', 'Insert Coin', 'Attract mode: PRESS START, and a high-score table of the longest dinosaurs alive in the chosen era, scored in metres. Click for a credit.', ['game', '8-bit', 'title', 'theropod', 'sauropod'],
    { game: 'title', seed: 2, warm: 8 }, { stage: 0.855, light: 0.3 }),
  Sc('timerun', 'Deep Time Dash', 'The runner sprints through the whole age of dinosaurs: the counter falls from 237 to 56 million years ago and the runner changes with it.', ['game', '8-bit', 'theropod', 'time travel', 'triassic', 'jurassic', 'cretaceous', 'impact'],
    { game: 'run', sp: 'coelophysis', fly: 'rhamphorhynchus', seed: 29 }, { stage: 0.02, grow: 0.5, light: 0.4 }),
];
