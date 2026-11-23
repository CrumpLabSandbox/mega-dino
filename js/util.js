// Shared helpers for canvas-2D engines: seeded randomness, value noise, colour, puff sprites, sky and daylight.

export const clamp = (v, lo = 0, hi = 1) => v < lo ? lo : v > hi ? hi : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
export const fract = x => x - Math.floor(x);
export const wrap = (x, lo, hi) => { const r = hi - lo; return ((((x - lo) % r) + r) % r) + lo; };
export const TAU = Math.PI * 2;

// mulberry32: deterministic random stream from an integer seed
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export const hash = (x, y = 0, z = 0) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };

export function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}
export function noise3(x, y, z) {
  const iz = Math.floor(z), fz = z - iz, u = fz * fz * (3 - 2 * fz);
  return lerp(noise2(x + iz * 17.13, y + iz * 31.7), noise2(x + (iz + 1) * 17.13, y + (iz + 1) * 31.7), u);
}
export function fbm2(x, y, oct = 4) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise2(x, y); n += a; x = x * 2.03 + 17.1; y = y * 2.03 + 9.7; a *= 0.5; }
  return s / n;
}
export function fbm3(x, y, z, oct = 4) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise3(x, y, z); n += a; x = x * 2.03 + 17.1; y = y * 2.03 + 9.7; z *= 2.03; a *= 0.5; }
  return s / n;
}

export function hsl(h, s, l, a = 1) { return `hsla(${(h % 360 + 360) % 360},${s}%,${l}%,${a})`; }
const hexRGB = c => { const p = parseInt(c.slice(1), 16); return [p >> 16, p >> 8 & 255, p & 255]; };
// blend two '#rrggbb' colours
export function mixHex(a, b, t) {
  const A = hexRGB(a), B = hexRGB(b);
  return `rgb(${lerp(A[0], B[0], t) | 0},${lerp(A[1], B[1], t) | 0},${lerp(A[2], B[2], t) | 0})`;
}
// multiply a '#rrggbb' colour's brightness (k > 1 lightens towards white)
export function shade(c, k, a = 1) {
  const [r, g, b] = hexRGB(c);
  const f = v => k <= 1 ? v * k : v + (255 - v) * (k - 1);
  return `rgba(${f(r) | 0},${f(g) | 0},${f(b) | 0},${a})`;
}

// A soft round puff, pre-rendered once per colour and size, for dust and ash. Cached.
const puffCache = new Map();
export function puff(color = '255,255,255', size = 128, hardness = 0.35) {
  const key = color + '|' + size + '|' + hardness;
  if (puffCache.has(key)) return puffCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), r = size / 2;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, `rgba(${color},1)`); grd.addColorStop(hardness, `rgba(${color},0.8)`);
  grd.addColorStop(0.75, `rgba(${color},0.25)`); grd.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  puffCache.set(key, c);
  return c;
}

// Off-screen canvas helper (low-res buffers for pixel art, masks, etc.)
export function buffer(w, h) {
  const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
  return { canvas: c, ctx: c.getContext('2d') };
}

// Wind control → direction vector (0.5 = blowing right; full turn across the range)
export const windDir = w => { const a = (w - 0.5) * Math.PI * 2; return [Math.cos(a), Math.sin(a)]; };
// Horizontal drift sign from the wind control: left half blows left, right half blows right.
export const windX = w => Math.cos((w - 0.5) * Math.PI * 2);

// Sky gradient helper for 2D engines: light 0 = night, 0.25 = dawn/dusk, 1 = noon.
export function skyGradient(ctx, w, h, light, top, bottom) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  if (top && bottom) { g.addColorStop(0, top); g.addColorStop(1, bottom); }
  else {
    // blended in RGB (a hue blend between blue and orange would pass through green)
    const day = clamp(light), dusk = Math.max(0, 1 - Math.abs(day - 0.3) / 0.22), k = smooth(0.02, 0.6, day);
    const mix3 = (a, b, t) => `rgb(${lerp(a[0], b[0], t) | 0},${lerp(a[1], b[1], t) | 0},${lerp(a[2], b[2], t) | 0})`;
    const m = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    const top = m([8, 12, 32], [58, 118, 204], k), mid = m([16, 22, 52], [128, 178, 228], k), low = m([24, 30, 60], [198, 222, 240], k);
    g.addColorStop(0, mix3(top, [58, 52, 104], dusk * 0.5));
    g.addColorStop(0.7, mix3(mid, [226, 138, 104], dusk * 0.7));
    g.addColorStop(1, mix3(low, [250, 186, 110], dusk * 0.9));
  }
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

// ---- dinosaur helpers

export { era, STAGES, maOf } from './time.js';

// The sky behind a side-on scene. In a combo (f.combo) the sky must be left transparent so the Mega-Clouds sky or
// the Mega-Volcano backdrop shows through: this clears instead of painting. Pass your own painter, or get the default.
export function sky(f, paint) {
  const { ctx, w, h } = f;
  if (f.combo) { ctx.clearRect(0, 0, w, h); return false; }
  if (paint) paint(ctx, w, h); else skyGradient(ctx, w, h, f.p.light * (1 - 0.8 * (f.era?.dark || 0)));
  return true;
}

// Day, dusk and night weights from the Light control: 0 night, ~0.3 golden hour, 1 noon.
export function daylight(light) {
  const day = clamp(light), dusk = Math.max(0, 1 - Math.abs(day - 0.3) / 0.2), night = 1 - smooth(0, 0.25, day);
  return { day, dusk, night };
}

// How lively the animals are: the Activity control (0.5 = natural) as a multiplier 0.4..1.6
export const energy = f => 0.4 + 1.2 * clamp(f.p.activity);
