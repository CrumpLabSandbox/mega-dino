// Pterosaur Skies: the sky is the stage. Pterosaurs (flying reptiles, not dinosaurs) and early birds from flyParts(),
// flying as flocks with a small closed-form flight model: circling on thermals, gliding lines along a coast, bounding
// flap-glides, dips to the water and skimming. A true perspective camera gives depth (far ones smaller and hazier),
// headings give yaw, turns give bank, and the ground is only a strip (a sea horizon, a cliff, a treeline) or nothing
// at all, so a Mega-Clouds sky can fill the rest.
import { flyParts } from '../swimfly.js';
import { species, standIn } from '../species.js';
import { pose, parts, gait } from '../rig.js';
import { plantParts, plantPalette, flora, PLANTS } from '../flora.js';
import { drawParts, palette } from '../draw.js';
import { clamp, lerp, smooth, fract, wrap, hash, rng, TAU, sky, daylight, energy, windX, puff, fbm2 } from '../util.js';

// ---------------------------------------------------------------- colour
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const css = (c, a = 1) => a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const hex = c => '#' + c.map(v => clamp(v | 0, 0, 255).toString(16).padStart(2, '0')).join('');
const RGB = new Map();
const rgb = c => { let v = RGB.get(c); if (!v) { const p = parseInt(c.slice(1), 16); RGB.set(c, v = [p >> 16, p >> 8 & 255, p & 255]); } return v; };

// ---------------------------------------------------------------- the cast
// Walkers with wings (Archaeopteryx, Microraptor) and the wading bird Presbyornis, given a flying body plan. The
// neck/head ratios are for flyParts only; Presbyornis' wingspan is a drawing proportion, not a measured figure.
const flyCopy = (id, extra) => { const s = species(id); return { ...s, plan: 'pbird', kind: 'fly', span: s.span || s.len * 1.3, o: { neck: 1.3, head: 1 }, group: 'bird', dino: true, ...extra }; };
const OWN = { archaeopteryx: flyCopy('archaeopteryx'), microraptor: flyCopy('microraptor'), presbyornis: flyCopy('presbyornis', { o: { neck: 2.6, head: 1.15 } }) };
const baseOf = id => OWN[id] || species(id);
const FEMALE = new Map();      // Pteranodon females: smaller, with a short crest
const female = sp => { let v = FEMALE.get(sp.id); if (!v) FEMALE.set(sp.id, v = { ...sp, crest: sp.crest * 0.35 }); return v; };
// who flies in this slot now: itself when alive, a stand-in from the same sky otherwise. Nothing with a backbone
// flew before about 228 Ma, and after the impact only birds are left.
const CASTC = new Map();
function recast(base, E) {
  let ma = E.ma; if (E.dinos < 0.5) ma = Math.min(ma, 65.99);
  if (ma > 228) return null;
  if (ma < 66) return OWN.presbyornis;
  const key = base.id + '|' + Math.round(ma * 2);
  if (!CASTC.has(key)) CASTC.set(key, standIn(base, ma));
  return CASTC.get(key);
}
const WALKC = new Map();
function recastWalk(base, ma) { const key = base.id + '|' + Math.round(ma * 2); if (!WALKC.has(key)) WALKC.set(key, standIn(base, ma)); return WALKC.get(key); }

function birdPal(sp, L, fog, haze, glow, sun) {
  const k = 0.3 + 0.7 * L, C = (c, m = 1) => css(mix(mul(c, m * k), haze, fog));
  const body = rgb(sp.c[0]), belly = rgb(sp.c[1]), mark = rgb(sp.c[2]), acc = rgb(sp.c[3]);
  let wing = mix(body, belly, 0.14), wingFar = mul(wing, 0.72);
  if (glow > 0) { wing = mix(wing, mul(sun, 1 / k), glow * 0.42); wingFar = mix(wingFar, mul(sun, 1 / k), glow * 0.3); }
  return { body: C(body), belly: C(belly), far: C(body, 0.66), mark: C(mark), accent: C(acc), accentFar: C(acc, 0.62), horn: C([233, 224, 200]),
    eye: C([242, 210, 74]), mouth: C([122, 31, 36]), line: C(mark, 0.45), wing: C(wing), wingFar: C(wingFar) };
}

// ---------------------------------------------------------------- flight paths (closed form: any t gives a full sky)
// Positions are metres relative to the camera: x right, y up (0 = sea or ground level), z away from the viewer.
function path(b, T, V, o) {
  const g = b.g;
  o.jaw = 0; o.wet = 0; o.look = 0;
  switch (g.b) {
    case 'soar': case 'kettle': {
      const up = g.b === 'kettle', R = lerp(g.R[0], g.R[1], up ? 0.25 * b.a + 0.75 * b.b : b.a), ph = b.ph * TAU + g.v / R * b.turn * T;
      o.x = g.at[0] + R * Math.cos(ph) + R * 0.25 * Math.sin(T * 0.045 + b.c * 9);
      o.z = g.at[1] + R * (g.flat ?? 1) * Math.sin(ph) + (up ? R * 0.2 * Math.cos(T * 0.037 + b.c * 5) : 0);
      o.y = (lerp(g.y[0], g.y[1], b.b) + (g.y[1] - g.y[0]) * 0.1 * Math.sin(T * 0.09 + b.c * TAU)) * (up ? V.altK : 1);
      o.ux = o.x; o.glide = 1 - 0.75 * smooth(0.93, 1, Math.sin(T * 0.37 + b.c * 40)); break; }
    case 'line': case 'fish': case 'bound': {
      const z0 = lerp(g.z[0], g.z[1], b.a), hr = z0 * V.hw + g.span * 0.7, v = b.dir * g.v * (0.85 + 0.3 * b.c) - V.camV;
      o.ux = (fract((b.i + 0.25 + b.d * 0.5) / g.n + b.gi2 * 0.37) * 2 - 1) * hr + v * T; o.x = wrap(o.ux, -hr, hr);
      o.z = z0 * (1 + 0.05 * Math.sin(T * 0.17 + b.ph * TAU));
      const yc = lerp(g.y[0], g.y[1], b.b);
      if (g.b === 'line') { o.y = yc + (g.wave ?? g.span * 0.25) * Math.sin(T * 0.31 + b.ph * 9); o.glide = clamp((g.glide ?? 0.6) + 0.6 * Math.sin(T * 0.29 + b.ph * 23)); }
      else if (g.b === 'fish') {       // cruise, slide down to the water, dip the beak, flap back up
        const u = fract(T / (g.period || 15) * (0.85 + 0.3 * b.c) + b.ph), d = smooth(0.42, 0.62, u) * (1 - smooth(0.74, 0.94, u));
        o.y = lerp(yc, g.low ?? g.span * 0.1, d) + (1 - d) * g.span * 0.08 * Math.sin(T * 0.4 + b.ph * 9);
        o.jaw = smooth(0.56, 0.64, u) * (1 - smooth(0.74, 0.8, u)); o.wet = smooth(0.93, 1, d); o.look = -0.35 * smooth(0.5, 0.62, u) * (1 - smooth(0.72, 0.8, u));
        o.glide = 1 - smooth(0.72, 0.76, u) * (1 - smooth(0.94, 1, u)) * 0.95;
      } else {                         // bounding flight: a flapping climb, then a long glide down
        const u = fract(T / (g.period || 5) * (0.85 + 0.3 * b.c) + b.ph), A = g.drop ?? 2.5;
        const s = u < 0.36 ? smooth(0, 0.36, u) : 1 - smooth(0.36, 1, u);
        o.y = yc + A * (s - 0.5); o.glide = u < 0.34 ? 0 : smooth(0.34, 0.42, u);
      }
      break; }
    case 'cruise': case 'skim': {      // a formation the camera keeps pace with
      const k = b.i, row = Math.ceil(k / 2), side = k % 2 ? 1 : -1, gap = g.gap ?? g.span * 0.8;
      o.x = g.at[0] - row * gap + (g.sway ?? gap) * Math.sin(T * 0.07 + b.c * 6) + 0.3 * gap * Math.sin(T * 0.19 + k * 2);
      o.z = Math.max(g.span * 0.4, g.at[1] + (side > 0 ? 0.75 : -0.28) * row * gap + 0.12 * gap * Math.sin(T * 0.23 + k * 1.7));
      o.ux = o.x;
      if (g.b === 'cruise') { o.y = g.at[2] + row * gap * 0.07 * side + g.span * 0.07 * Math.sin(T * 0.4 + k * 1.3); o.glide = clamp(0.75 + 0.7 * Math.sin(T * 0.21 + k * 2.4)); }
      else { const wet = smooth(-0.35, 0.1, Math.sin(T * 0.22 + k * 2.6 + b.c * 3));       // lower jaw in the water
        o.y = g.span * lerp(0.2, 0.082, wet) + g.span * 0.006 * Math.sin(T * 1.1 + k); o.wet = smooth(0.85, 1, wet); o.jaw = 0.75 * smooth(0.5, 0.9, wet); o.look = -0.3 * smooth(0.4, 0.9, wet);
        o.glide = clamp(1.25 - smooth(0.6, 0.1, wet) * 0.9); }
      break; }
    default: {                         // 'loop': wheeling around a point (a cliff face, a colony)
      const s = 0.6 + 0.5 * b.a, w = g.v / g.R[0] / s * b.turn, ph = b.ph * TAU + w * T;
      o.x = g.at[0] + g.R[0] * s * (Math.sin(ph) + 0.3 * Math.sin(ph * 0.43 + b.c * 7)) + (b.d - 0.5) * g.R[0] * 0.8;
      o.y = Math.max(g.span * 0.3, g.at[1] + g.R[1] * (0.9 * Math.sin(ph * 0.61 + b.b * TAU) + (b.b - 0.5)));
      o.z = Math.max(g.span * 0.9, g.at[2] + g.R[2] * s * Math.cos(ph) + (b.c - 0.5) * g.R[2] * 0.7);
      o.ux = o.x; o.glide = clamp((g.glide ?? 0.3) + 0.7 * Math.sin(T * 0.5 + b.ph * 31));
    }
  }
}

// ---------------------------------------------------------------- air, sky, clouds
function air(f) {
  const E = f.era, L0 = clamp(f.p.light), a = smooth(0.04, 0.3, L0), b = smooth(0.3, 0.62, L0), dl = daylight(L0);
  let zen = mix(mix([7, 10, 26], [50, 64, 122], a), [56, 122, 202], b), hor = mix(mix([24, 32, 60], [247, 170, 108], a), [180, 214, 236], b);
  let mid = mix(mix([14, 20, 44], [176, 116, 132], a), [112, 170, 222], b);
  hor = mix(hor, [228, 204, 168], E.dry * 0.3 * b);
  const soot = E.dark * 0.8;
  zen = mix(zen, [34, 24, 20], soot); mid = mix(mid, [52, 34, 26], soot); hor = mix(hor, [84, 50, 32], soot);
  if (E.flash > 0) { hor = mix(hor, [255, 236, 180], E.flash * 0.85); mid = mix(mid, [255, 190, 110], E.flash * 0.6); zen = mix(zen, [200, 120, 70], E.flash * 0.4); }
  const sun = mix(mix([120, 140, 200], [255, 190, 120], a), [255, 244, 214], b);
  const light = L0 * (1 - 0.6 * E.dark);
  return { zen, mid, hor, sun, dl, L0, light, pl: light - 0.3 * dl.night, haze: mix(hor, mid, 0.3) };
}
function paintSky(f, V, A, o) {
  const { ctx, w, h } = f; let g;
  if (o.ground === 'up') { g = ctx.createRadialGradient(V.sunX, V.sunY, 0, V.sunX, V.sunY, Math.hypot(w, h)); g.addColorStop(0, css(mix(A.mid, A.hor, 0.75))); g.addColorStop(0.35, css(A.mid)); g.addColorStop(1, css(A.zen)); }
  else { const e = clamp(V.hz / h, 0.3, 1); g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, css(A.zen)); g.addColorStop(e * 0.62, css(A.mid)); g.addColorStop(e, css(A.hor));
    if (e < 0.999) g.addColorStop(1, css(o.ground === 'none' ? mix(A.hor, A.mid, 0.35) : A.hor)); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
function paintSun(f, V, A, o) {
  const { ctx, w, h } = f, n = A.dl.night, vis = 1 - f.era.dark;
  if (n > 0.3) { ctx.fillStyle = `rgba(255,255,255,${(n - 0.3) * vis})`; const top = o.ground === 'none' || o.ground === 'up' ? h : V.hz;
    for (let i = 0; i < 110; i++) { const r = (hash(i, 5) < 0.12 ? 1.7 : 0.9) * Math.max(1, h / 540); ctx.fillRect(hash(i, 1) * w, hash(i, 2) * top, r, r); } }
  const moon = n > 0.6, x = moon ? w - V.sunX : V.sunX, y = moon ? h * 0.2 : V.sunY, r = h * (o.ground === 'up' ? 0.05 : 0.034);
  if (y > h + r * 5) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 7), c = moon ? [226, 232, 255] : A.sun;
  g.addColorStop(0, css(c, (moon ? 0.4 : 0.75) * vis)); g.addColorStop(0.3, css(c, 0.22 * vis)); g.addColorStop(1, css(c, 0));
  ctx.fillStyle = g; ctx.fillRect(x - r * 7, y - r * 7, r * 14, r * 14);
  ctx.fillStyle = css(moon ? [240, 242, 250] : mix(A.sun, [255, 255, 255], 0.5), vis); ctx.beginPath(); ctx.arc(x, y, r * (moon ? 0.8 : 1), 0, TAU); ctx.fill();
}
// Our own clouds, only when no cloud layer is behind us: soft banks at three depths that slide past with the camera.
function paintClouds(f, V, A, o, T) {
  const amt = o.clouds ?? 0.4; if (amt <= 0) return;
  const { ctx, w, h } = f, q = Math.round(A.L0 * 12) / 12, dk = Math.round(f.era.dark * 4) / 4;
  const a = smooth(0.04, 0.3, q), b = smooth(0.3, 0.62, q);
  const lit = mix(mix(mix([44, 52, 80], [255, 206, 160], a), [255, 255, 255], b), [70, 52, 44], dk * 0.8), shade = mix(mix(mix([24, 30, 54], [150, 110, 130], a), [168, 190, 214], b), [44, 34, 30], dk * 0.8);
  const sl = puff(css(lit).slice(4, -1), 96, 0.45), ss = puff(css(shade).slice(4, -1), 96, 0.45);
  const open = o.ground === 'none', up = o.ground === 'up', top = open || up ? h * 1.05 : V.hz, wx = windX(f.p.wind);
  const n = Math.round((2 + amt * 7) * (0.6 + 0.7 * f.p.detail));
  for (let L = 0; L < 3; L++) {
    const par = [0.12, 0.3, 0.7][L], size = h * [0.07, 0.12, 0.2][L] * (up ? 1.3 : 1);
    for (let i = 0; i < n; i++) {
      const s0 = hash(i, L, 17 + (o.seed || 0)), W2 = w + size * 8, sz = size * (0.7 + 0.8 * hash(i, L, 3));
      const x = wrap(s0 * W2 - (V.camX * par * V.F / 60 + wx * T * par * h * 0.012) - (up ? 0 : 0), 0, W2) - size * 4;
      const band = open || up ? hash(i, L, 9) : lerp(0.92 - L * 0.22, 0.99 - L * 0.3, hash(i, L, 9));
      const y = open ? h * lerp(-0.05, 1.05, band) : up ? h * band : top * band - sz * 0.3;
      ctx.globalAlpha = (open ? 0.6 : 0.8) * (0.5 + 0.5 * amt) * (L === 0 ? 0.7 : 1);
      const m = 6;
      for (let j = 0; j < m; j++) { const u = j / (m - 1) - 0.5, r = sz * (0.75 - Math.abs(u) * 0.7 + 0.25 * hash(i, j, L)); ctx.drawImage(ss, x + u * sz * 3.4 - r, y + sz * 0.16 - r * 0.72, r * 2, r * 1.44); }
      for (let j = 0; j < m; j++) { const u = j / (m - 1) - 0.5, r = sz * (0.7 - Math.abs(u) * 0.75 + 0.3 * hash(i, j, L + 5)); ctx.drawImage(sl, x + u * sz * 3 - r, y - sz * 0.2 * hash(j, i, 2) - r * 0.8, r * 2, r * 1.6); }
    }
  }
  ctx.globalAlpha = 1;
}
function paintMeteor(f, V) {
  const { ctx, w, h } = f, E = f.era; if (!(E.meteor > 0)) return;
  const m = Math.min(1, E.meteor), hz = Math.min(V.hz, h * 1.02), x = lerp(w * 0.08, w * 0.74, m), y = lerp(-h * 0.05, hz, m * m), r = h * lerp(0.008, 0.03, m);
  const ang = Math.atan2(hz + h * 0.05, w * 0.66), len = h * lerp(0.25, 0.7, m), dx = -Math.cos(ang) * len, dy = -Math.sin(ang) * len;
  const g = ctx.createLinearGradient(x, y, x + dx, y + dy);
  g.addColorStop(0, 'rgba(255,244,210,.95)'); g.addColorStop(0.25, 'rgba(255,170,70,.6)'); g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.strokeStyle = g; ctx.lineCap = 'round'; ctx.lineWidth = r * 1.6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy); ctx.stroke();
  const q = ctx.createRadialGradient(x, y, 0, x, y, r * 6);
  q.addColorStop(0, 'rgba(255,255,240,1)'); q.addColorStop(0.2, 'rgba(255,220,140,.8)'); q.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = q; ctx.beginPath(); ctx.arc(x, y, r * 6, 0, TAU); ctx.fill();
}
function paintFx(f, V) {
  const { ctx, w, h } = f, E = f.era;
  if (E.dark > 0.02) { ctx.fillStyle = `rgba(210,205,196,${E.dark * 0.5})`; const u = Math.max(1, h / 400);
    for (let i = 0; i < 80; i++) { const x = wrap(hash(i, 3) * w + f.t * 14 * (hash(i, 4) - 0.5), 0, w), y = (hash(i, 7) * h + f.t * (18 + 30 * hash(i, 9))) % h; ctx.fillRect(x, y, (1.5 + hash(i, 1)) * u, 1.5 * u); } }
  if (E.flash > 0.01) {
    ctx.save(); ctx.globalCompositeOperation = f.combo ? 'source-atop' : 'source-over';
    const gx = w * 0.74, gy = Math.min(V.hz, h), g = ctx.createRadialGradient(gx, gy, 0, gx, gy, w * (0.3 + E.flash));
    g.addColorStop(0, `rgba(255,250,225,${Math.min(1, E.flash * 1.5)})`); g.addColorStop(0.4, `rgba(255,190,90,${E.flash * 0.8})`); g.addColorStop(1, `rgba(255,120,40,${E.flash * 0.25})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore();
  }
}

// ---------------------------------------------------------------- ground strips
const SEAS = { inland: [[52, 118, 128], [24, 86, 108]], lagoon: [[84, 150, 150], [36, 104, 116]], ocean: [[50, 104, 140], [18, 62, 104]], tethys: [[70, 140, 150], [28, 96, 120]] };
function seaCols(f, A, o) { const S = SEAS[o.tone] || SEAS.inland, L = 0.22 + 0.78 * A.light, d = f.era.dark; return [mix(mix(mul(S[0], L), A.hor, 0.55), [60, 50, 46], d * 0.5), mix(mul(S[1], L), [30, 30, 34], d * 0.5)]; }
function paintSea(f, V, A, o, T, flock) {
  const { ctx, w, h } = f, hz = V.hz; if (hz >= h) return;
  const [c0, c1] = seaCols(f, A, o), g = ctx.createLinearGradient(0, hz, 0, h);
  g.addColorStop(0, css(c0)); g.addColorStop(Math.min(1, 0.12 + 40 / (h - hz + 40) * 0.3), css(mix(c0, c1, 0.55))); g.addColorStop(1, css(c1));
  ctx.fillStyle = g; ctx.fillRect(0, hz, w, h - hz + 1);
  // swell: light crests and dark troughs, scrolling in true perspective
  const rows = Math.round(10 + f.p.detail * 22), drift = V.camX + windX(f.p.wind) * T * 1.2, bright = css(mix(c0, [255, 255, 255], 0.5), 0.2 + 0.3 * A.light), darkc = css(mul(c1, 0.6), 0.35);
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    for (let j = 0; j < rows; j++) {
      const u = (j + 0.5) / rows, dy = (h - hz) * u * u, s = dy / V.eyeY, y = hz + dy, len = clamp(s * 1.6, h * 0.006, w * 0.09), th = Math.max(0.6, Math.min(len * 0.12, s * 0.07)), W2 = w + len * 2, m = Math.round(lerp(9, 4, u) * w / h * 0.8);
      for (let i = 0; i < m; i++) { const x = wrap(hash(i, j, pass + 1) * W2 - drift * s, 0, W2) - len, l2 = len * (0.5 + hash(i, j, 7)), bob = Math.sin(T * 1.2 + i * 2.1 + j) * s * 0.06;
        ctx.rect(x, y + bob + (pass ? th * 1.5 : 0), l2, th); }
    }
    ctx.fillStyle = pass ? darkc : bright; ctx.fill();
  }
  // the sun's (or moon's) glitter path; a cloud layer brings its own light, so not in a combo
  if (!f.combo && f.era.dark < 0.5) {
    const moon = A.dl.night > 0.6, gx = moon ? w - V.sunX : V.sunX, low = clamp(1 - (hz - V.sunY) / (h * 0.5), 0.15, 1);
    ctx.fillStyle = css(moon ? [220, 228, 255] : mix(A.sun, [255, 255, 255], 0.3), (moon ? 0.35 : 0.55) * (1 - f.era.dark * 2)); ctx.beginPath();
    for (let i = 0; i < 70; i++) { const u = hash(i, 41), dy = (h - hz) * u * u, sp = w * (0.012 + 0.07 * u) * (1.4 - low), l = h * 0.004 + (h - hz) * 0.05 * u;
      if (Math.sin(T * (1.5 + hash(i, 2) * 2) + i * 5) < -0.2) continue;
      ctx.rect(gx + (hash(i, 43) - 0.5) * 2 * sp - l, hz + dy, l * 2, Math.max(0.7, l * 0.14)); }
    ctx.fill();
  }
  // shadows, wakes and splashes
  for (const q of flock) {
    if (q.up || q.a <= 0) continue;
    const gy = hz + V.eyeY * q.s, rx = q.sp.span * q.vis * q.s * 0.42; if (gy > h + rx || q.y > q.sp.span * q.vis * 6) continue;
    const fl = clamp(V.eyeY / q.z * 1.6, 0.04, 0.5);
    ctx.fillStyle = css(mul(c1, 0.35), 0.4 * q.a * (0.35 + 0.65 * A.light) / (1 + q.y / (q.sp.span * q.vis) * 2.5)); ctx.beginPath(); ctx.ellipse(q.px, gy, rx, Math.max(0.7, rx * fl), 0, 0, TAU); ctx.fill();
    if (q.wet > 0.02) {
      const tip = q.px + q.dir * q.sp.span * q.vis * q.s * (q.g.b === 'skim' ? 0.33 : 0.3), ww = q.sp.span * q.vis * q.s;
      ctx.strokeStyle = `rgba(255,255,255,${0.45 * q.wet * q.a * (0.4 + 0.6 * A.light)})`; ctx.lineWidth = Math.max(0.7, ww * 0.005); ctx.lineCap = 'round';
      ctx.beginPath(); for (const sd of [-1, 1]) { ctx.moveTo(tip, gy); ctx.quadraticCurveTo(tip - q.dir * ww * 0.2, gy + sd * ww * fl * 0.02, tip - q.dir * ww * (0.32 + 0.05 * Math.sin(T * 3 + sd)), gy + sd * ww * fl * 0.07); } ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${0.8 * q.wet * q.a * (0.4 + 0.6 * A.light)})`; ctx.beginPath();
      for (let i = 0; i < 7; i++) { const a2 = fract(T * 2.2 + i * 0.37), bx = tip - q.dir * ww * a2 * 0.22 * (1 + hash(i, 3)), by = gy - ww * 0.07 * Math.sin(a2 * Math.PI) * (0.4 + hash(i, 5)); ctx.moveTo(bx, by); ctx.arc(bx, by, Math.max(0.5, ww * 0.005 * (1.5 - a2)), 0, TAU); }
      ctx.fill();
    }
  }
}
const TREES = ['conifer', 'araucaria', 'ginkgo', 'treefern', 'cycad', 'bush', 'magnolia', 'palm', 'deadtree', 'redwood'];
function pickPlant(E, r, kinds) { const W = flora(E); W.redwood = (W.conifer || 0) * 0.25; let sum = 0; for (const k of kinds) sum += W[k] || 0; let t = r * sum; for (const k of kinds) { t -= W[k] || 0; if (t <= 0) return k; } return kinds[0]; }
const PARTC = new Map();
const plantCached = (kind, seed) => { const key = kind + seed; let v = PARTC.get(key); if (!v) { if (PARTC.size > 600) PARTC.clear(); PARTC.set(key, v = plantParts(kind, seed, 0)); } return v; };
function ridge(ctx, w, h, y0, amp, seed, off, fr) { ctx.beginPath(); ctx.moveTo(0, y0 + 2); for (let c = 0; c <= 48; c++) { const x = c / 48 * w; ctx.lineTo(x, y0 - amp * fbm2(x / h * fr + off, seed * 9.1, 4)); } ctx.lineTo(w, y0 + 2); ctx.closePath(); }
function groundRGB(f, A, o, u) {
  const E = f.era, G = o.groundCol || [[150, 150, 104], [104, 118, 66]], L = (0.3 + 0.7 * A.light) * (1 - 0.45 * A.dl.night);
  let c = mul(mix(G[0], G[1], u), L);
  const burnt = Math.min(1, E.dark * 1.3 + (1 - E.dinos) * (1 - E.ferns) * 0.4);
  if (burnt > 0) c = mix(c, mul([70, 60, 54], L), burnt * 0.8);
  if (E.ferns > 0) c = mix(c, mul([70, 120, 60], L), E.ferns * 0.5);
  return mix(c, A.haze, (1 - u) * 0.6);
}
// A plain seen from the air: far hills, mottled ground, era-correct trees and small dinosaurs for scale.
function paintPlain(f, V, A, o, T, flock, S) {
  const { ctx, w, h } = f, hz = V.hz, E = f.era; if (hz >= h) return;
  if (!f.backdrop && o.hills !== 0) for (let i = 0; i < 2; i++) { ctx.fillStyle = css(mix(mul(groundRGB(f, A, o, 0), 0.8 - i * 0.05), A.haze, 0.6 - i * 0.25)); ridge(ctx, w, h, hz, h * (0.07 - i * 0.035) * (o.hills ?? 1), 3 + i + (o.seed || 0), V.camX * 0.0004 * (i + 1), 1.4 + i); ctx.fill(); }
  const g = ctx.createLinearGradient(0, hz, 0, h); g.addColorStop(0, css(groundRGB(f, A, o, 0))); g.addColorStop(0.35, css(groundRGB(f, A, o, 0.5))); g.addColorStop(1, css(groundRGB(f, A, o, 1)));
  ctx.fillStyle = g; ctx.fillRect(0, hz, w, h - hz + 1);
  const zn = V.eyeY * V.F / (h - hz) * 0.8, hw = V.hw;
  // mottling: darker fern flats and pale bare patches, flattened by perspective
  ctx.save(); ctx.beginPath(); ctx.rect(0, hz, w, h - hz + 1); ctx.clip();
  for (let i = 0; i < 46; i++) { const r = hash(i, 71), z = zn / lerp(0.05, 1, r * r + 0.02), s = V.F / z, per = z * hw * 2.6 + 200, x = V.cx + wrap(hash(i, 72) * per - V.camX, -per / 2, per / 2) * s, y = hz + V.eyeY * s, rx = (40 + 160 * hash(i, 73)) * s;
    ctx.fillStyle = i % 3 ? css(mul(groundRGB(f, A, o, clamp((y - hz) / (h - hz))), 0.84), 0.5) : css(mix(groundRGB(f, A, o, 0.5), [222, 208, 170], 0.4), 0.3);
    ctx.beginPath(); ctx.ellipse(x, y, rx, Math.max(0.6, rx * clamp(V.eyeY / z * 1.2, 0.02, 0.4)), 0, 0, TAU); ctx.fill(); }
  // shadows of the flyers on the ground
  for (const q of flock) { if (q.up || q.a <= 0) continue; const gy = hz + V.eyeY * q.s, rx = q.sp.span * q.vis * q.s * 0.45; if (gy > h + rx || rx < 0.7) continue;
    ctx.fillStyle = `rgba(0,0,0,${0.26 * q.a * (0.3 + 0.7 * A.light)})`; ctx.beginPath(); ctx.ellipse(q.px + q.y * q.s * 0.25, gy, rx, Math.max(0.6, rx * clamp(V.eyeY / q.z * 1.5, 0.05, 0.5)), 0, 0, TAU); ctx.fill(); }
  ctx.restore();
  const items = [], pp = plantPalette(A.pl, E, 0), tint = hex(A.haze);
  const N = Math.round((o.trees ?? 60) * (0.4 + f.p.detail));
  for (let i = 0; i < N; i++) {
    const r = hash(i, 81, o.seed || 0), z = lerp(zn, o.far || 1500, Math.pow(r, 1.7)), s = V.F / z, per = z * hw * 2.5 + 120, x = V.cx + wrap(hash(i, 82) * per - V.camX, -per / 2, per / 2) * s, y = hz + V.eyeY * s;
    const kind = pickPlant(E, hash(i, 83), TREES); if (PLANTS[kind].h * s < 1.2 || x < -60 * s || x > w + 60 * s) continue;
    items.push({ z, fn: () => drawParts(ctx, plantCached(kind, i + 1), { x, y, k: s, dir: 1 }, { pal: plantPalette(A.pl, E, clamp(z / (V.hazeD * 2.2)) * 0.8) }) });
  }
  let cnt = 0;
  for (const wk of S.walkers) {
    const sp = recastWalk(wk.base, E.ma), keep = (1 - 0.8 * E.dark) * (0.5 + f.p.herd); if (!sp || wk.r > keep) continue;
    const z = wk.z, s = V.F / z, G = gait(sp, 0, wk.scale), per = z * hw * 2 + sp.len * 3, ux = wk.x0 * per + wk.dir * G.vWalk * T - V.camX, x = V.cx + wrap(ux, -per / 2, per / 2) * s, y = hz + V.eyeY * s;
    if (y > h + sp.len * s || sp.len * s < 1.5) continue;
    cnt++;
    items.push({ z, fn: () => {
      const rx = sp.len * wk.scale * s * 0.32; ctx.fillStyle = `rgba(0,0,0,${0.25 * (0.4 + 0.6 * A.light)})`; ctx.beginPath(); ctx.ellipse(x + rx * 0.3 * wk.dir, y, rx, Math.max(0.6, rx * 0.16), 0, 0, TAU); ctx.fill();
      drawParts(ctx, parts(pose(sp, { phase: (wk.x0 * per + wk.dir * G.vWalk * T) / G.stride * wk.dir, t: T + wk.i * 3, scale: wk.scale, headTo: 0.25 * Math.sin(T * 0.2 + wk.i) })), { x, y, k: s, dir: wk.dir }, { pal: palette(sp, { light: A.light, fog: clamp(z / (V.hazeD * 2.2)) * 0.7, tint }) });
    } });
  }
  S.dinos = cnt;
  return items;
}
// Low islands in a lagoon or along a shore (scenery: dropped when a volcano stands behind).
function islands(f, V, A, o, items) {
  const { ctx, w, h } = f, E = f.era, isl = o.islands; if (!isl || f.backdrop) return;
  const sand = mix(mul(isl.col || [226, 208, 160], 0.3 + 0.7 * A.light), [80, 70, 64], E.dark * 0.6);
  for (let i = 0; i < isl.n; i++) {
    const z = lerp(isl.z[0], isl.z[1], hash(i, 91, o.seed)), s = V.F / z, per = z * V.hw * 2 + 400, x = V.cx + wrap(hash(i, 92, o.seed) * per - V.camX, -per / 2, per / 2) * s, y = V.hz + V.eyeY * s, R = lerp(isl.R[0], isl.R[1], hash(i, 93)) * s;
    if (x < -R * 1.3 || x > w + R * 1.3 || y > h + R * 0.2) continue;
    const fog = clamp(z / (V.hazeD * 1.6)) * 0.85, hgt = Math.max(1.5, R * 0.07);
    items.push({ z, fn: () => {
      ctx.fillStyle = css(mul(seaCols(f, A, o)[1], 0.7), 0.35 * (1 - fog)); ctx.beginPath(); ctx.ellipse(x, y + hgt * 0.5, R * 1.02, hgt * 1.2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = css(mix(sand, A.haze, fog)); ctx.beginPath(); ctx.moveTo(x - R, y + 1); ctx.bezierCurveTo(x - R * 0.6, y - hgt * 1.6, x + R * 0.5, y - hgt * 2.2, x + R, y + 1); ctx.closePath(); ctx.fill();
      const np = Math.round(isl.plants ?? 6), pal = plantPalette(A.pl, E, fog * 0.8);
      for (let j = 0; j < np; j++) { const u = (j + 0.5 + (hash(i, j, 4) - 0.5) * 0.8) / np * 2 - 1, kind = pickPlant(E, hash(i, j, 5), isl.kinds || ['cycad', 'bush', 'treefern', 'conifer', 'araucaria', 'palm', 'deadtree', 'fern']);
        drawParts(ctx, plantCached(kind, i * 31 + j + 1), { x: x + u * R * 0.8, y: y - hgt * 1.25 * (1 - u * u), k: s * (isl.scale ?? 1), dir: 1 }, { pal }); }
    } });
  }
}
// A rock face in screen space (a sea cliff, a sea stack): bedded rock, ledges, plants on top. Returns perches.
function crag(f, V, A, c, o) {
  const { ctx, w, h } = f, n = 18, top = h * c.top, base = c.base ?? V.hz + (h - V.hz) * 0.5, L = (0.3 + 0.7 * A.light) * (1 - 0.4 * A.dl.night), amp = (c.rough ?? 1) * h * 0.035, sd = c.seed || 1;
  const xl = v => w * c.x0 - (c.spread ?? 0.04) * w * Math.pow(v, 1.6) + (fbm2(v * 5, sd, 3) - 0.5) * amp * (0.4 + v), xr = v => w * c.x1 + (c.spread ?? 0.04) * w * Math.pow(v, 1.6) + (fbm2(v * 5 + 9, sd + 3, 3) - 0.5) * amp * (0.4 + v);
  const topY = u => top - h * 0.03 * (c.rough ?? 1) * (fbm2(u * 4, sd + 7, 3) - 0.3) - h * 0.02 * Math.sin(u * Math.PI);
  const yv = v => lerp(top, base, v);
  const rock = mix(mix(mul(c.col || [150, 152, 150], L), A.haze, c.fog || 0), [60, 54, 50], f.era.dark * 0.5);
  ctx.save(); ctx.beginPath(); ctx.moveTo(xl(1), base + h * 0.02);
  for (let j = n; j >= 0; j--) ctx.lineTo(xl(j / n), yv(j / n));
  for (let j = 1; j < 12; j++) { const u = j / 12; ctx.lineTo(lerp(xl(0), xr(0), u), topY(u)); }
  for (let j = 0; j <= n; j++) ctx.lineTo(xr(j / n), yv(j / n));
  ctx.lineTo(xr(1), base + h * 0.02); ctx.closePath();
  const sunRight = V.sunX > w * (c.x0 + c.x1) / 2, g = ctx.createLinearGradient(w * c.x0 - w * 0.06, 0, w * c.x1 + w * 0.06, 0);
  g.addColorStop(sunRight ? 0 : 1, css(mul(rock, 0.62))); g.addColorStop(sunRight ? 1 : 0, css(mix(rock, mul(A.sun, L), 0.22)));
  ctx.fillStyle = g; ctx.fill(); ctx.clip();
  // beds of rock, a few joints, and pale ledges
  const beds = c.beds ?? 13, tilt = (c.tilt ?? 0.04), x0 = w * c.x0 - w * 0.2, x1 = w * c.x1 + w * 0.2;
  for (let k = 0; k < beds; k++) { const y = lerp(top - h * 0.04, base, (k + hash(k, sd) * 0.6) / beds), th = (base - top) / beds * (0.25 + 0.5 * hash(k, sd, 2));
    ctx.fillStyle = k % 2 ? `rgba(0,0,0,${0.1 + 0.1 * hash(k, 4)})` : `rgba(255,255,255,${0.06 + 0.1 * hash(k, 5)})`;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y + (x1 - x0) * tilt); ctx.lineTo(x1, y + th + (x1 - x0) * tilt); ctx.lineTo(x0, y + th); ctx.closePath(); ctx.fill(); }
  ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = Math.max(0.6, h * 0.0022); ctx.beginPath();
  for (let k = 0; k < 9; k++) { const x = lerp(w * c.x0, w * c.x1, hash(k, sd, 6)), y = lerp(top, base, hash(k, sd, 7) * 0.8); ctx.moveTo(x, y); ctx.lineTo(x + (hash(k, 8) - 0.5) * h * 0.02, y + h * (0.05 + 0.1 * hash(k, 9))); } ctx.stroke();
  if (c.guano) { ctx.fillStyle = `rgba(255,255,255,${0.3 * L})`; for (let k = 0; k < 16; k++) { const x = lerp(w * c.x0, w * c.x1, hash(k, sd, 11)), y = lerp(top, base, hash(k, sd, 12) * 0.6); ctx.fillRect(x, y, h * 0.004 * (1 + hash(k, 3) * 2), h * (0.02 + 0.06 * hash(k, 13))); } }
  const g2 = ctx.createLinearGradient(0, base - h * 0.12, 0, base + h * 0.02); g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,10,20,0.4)'); ctx.fillStyle = g2; ctx.fillRect(x0, base - h * 0.12, x1 - x0, h * 0.16);
  ctx.restore();
  // surf at the foot
  if (o.ground === 'sea') { ctx.fillStyle = `rgba(255,255,255,${0.55 * L})`; ctx.beginPath(); const a = xl(1) - w * 0.02, b = xr(1) + w * 0.02;
    for (let k = 0; k < 14; k++) { const u = hash(k, sd, 20), x = lerp(a, b, u), rx = h * (0.012 + 0.03 * hash(k, 21)) * (0.8 + 0.3 * Math.sin(f.t * 1.4 + k * 2)); ctx.moveTo(x + rx, base + h * 0.022); ctx.ellipse(x, base + h * 0.02 + h * 0.008 * hash(k, 22), rx, rx * 0.22, 0, 0, TAU); } ctx.fill(); }
  // plants along the top (era-correct), then the perches: the top edge and the ledges
  const pal = plantPalette(A.pl, f.era, (c.fog || 0) * 0.8), np = c.plants ?? 7, k = h * (c.plantK ?? 0.02);
  for (let j = 0; j < np; j++) { const u = (j + 0.3 + 0.4 * hash(j, sd, 30)) / np, x = lerp(xl(0), xr(0), u); if (x < -k * 3 || x > w + k * 3) continue;
    drawParts(ctx, plantCached(pickPlant(f.era, hash(j, sd, 31), c.kinds || ['fern', 'cycad', 'bush', 'fern', 'treefern']), j + sd * 7), { x, y: topY(u) + h * 0.004, k, dir: 1 }, { pal }); }
  const perches = [];
  for (let j = 0; j < (c.perch || 0); j++) { const onTop = j % 3 === 0, u = 0.08 + 0.84 * hash(j, sd, 40);
    if (onTop) perches.push([lerp(xl(0), xr(0), u), topY(u) + h * 0.004, j]); else { const v = 0.08 + 0.6 * hash(j, sd, 41), a = xl(v), b = xr(v); perches.push([lerp(a, b, 0.12 + 0.76 * u), yv(v), j, 1]); } }
  return perches;
}
function perched(f, A, sp, x, y, u, dir, t, ledge) {
  const { ctx } = f, P = birdPal(sp, A.light, 0, A.haze, 0, A.sun), nod = Math.sin(t * 0.7 + x) > 0.8 ? 0.12 : 0;
  if (ledge) { ctx.fillStyle = 'rgba(245,245,238,0.5)'; ctx.fillRect(x - u * 0.9, y, u * 1.8, u * 0.14); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x - u * 0.9, y + u * 0.14, u * 1.8, u * 0.12); }
  ctx.fillStyle = P.far; ctx.beginPath(); ctx.moveTo(x - dir * u * 0.3, y - u * 0.5); ctx.lineTo(x - dir * u * 1.05, y - u * 0.05); ctx.lineTo(x - dir * u * 0.2, y - u * 0.2); ctx.fill();
  ctx.fillStyle = P.body; ctx.beginPath(); ctx.ellipse(x, y - u * 0.55, u * 0.42, u * 0.6, dir * 0.5, 0, TAU); ctx.fill();
  ctx.fillStyle = P.belly; ctx.beginPath(); ctx.ellipse(x + dir * u * 0.14, y - u * 0.5, u * 0.22, u * 0.45, dir * 0.5, 0, TAU); ctx.fill();
  const hx = x + dir * u * (0.3 + nod), hy = y - u * 1.12;
  ctx.fillStyle = P.body; ctx.beginPath(); ctx.arc(hx, hy, u * 0.24, 0, TAU); ctx.fill();
  ctx.fillStyle = P.horn; ctx.beginPath(); ctx.moveTo(hx + dir * u * 0.16, hy - u * 0.1); ctx.lineTo(hx + dir * u * 0.75, hy + u * 0.06); ctx.lineTo(hx + dir * u * 0.16, hy + u * 0.12); ctx.fill();
  ctx.fillStyle = '#14110c'; ctx.beginPath(); ctx.arc(hx + dir * u * 0.07, hy - u * 0.04, Math.max(0.5, u * 0.05), 0, TAU); ctx.fill();
}
// Inside a forest canopy: trunks and crowns at every depth, mixed with the flyers by distance.
function paintForest(f, V, A, o, T, S) {
  const { ctx, w, h } = f, hz = V.hz, E = f.era, items = [];
  if (!f.backdrop) for (let i = 0; i < 2; i++) { ctx.fillStyle = css(mix(mul([70, 104, 76], (0.3 + 0.7 * A.light) * (1 - 0.5 * E.dark)), A.haze, 0.62 - i * 0.26)); ridge(ctx, w, h, hz, h * (0.11 - i * 0.03), 5 + i, V.camX * 0.002 * (i + 1), 5 + i * 4); ctx.fill(); }
  if (hz < h) { const g = ctx.createLinearGradient(0, hz, 0, h), c = mix(mul([58, 92, 56], 0.3 + 0.7 * A.light), [56, 50, 46], Math.min(1, E.dark * 1.2) * 0.8); g.addColorStop(0, css(mix(c, A.haze, 0.45))); g.addColorStop(1, css(mul(c, 0.8))); ctx.fillStyle = g; ctx.fillRect(0, hz, w, h - hz + 1); }
  const N = Math.round((o.trees ?? 22) * (0.5 + 0.8 * f.p.detail)), sway = windX(f.p.wind) * (0.5 + 0.5 * Math.sin(T * 0.6));
  for (let i = 0; i < N; i++) {
    const r = hash(i, 51, o.seed || 0), z = lerp(o.treeZ?.[0] ?? 11, o.treeZ?.[1] ?? 170, r * r), s = V.F / z, per = z * V.hw * 2 + 70, x = V.cx + wrap(hash(i, 52, o.seed || 0) * per - V.camX, -per / 2, per / 2) * s, y = hz + V.eyeY * s;
    const kind = pickPlant(E, hash(i, 53), ['conifer', 'araucaria', 'ginkgo', 'araucaria', 'treefern', 'magnolia', 'palm', 'deadtree', 'redwood']);
    if (x < -PLANTS[kind].h * s * 0.4 || x > w + PLANTS[kind].h * s * 0.4) continue;
    items.push({ z, fn: () => drawParts(ctx, plantParts(kind, i + 1, sway * (0.6 + 0.4 * Math.sin(T * 0.9 + i))), { x, y, k: s, dir: 1 }, { pal: plantPalette(A.pl, E, clamp(z / V.hazeD) * 0.85) }) });
  }
  return items;
}

// ---------------------------------------------------------------- the engine
const P0 = {}, P1 = {}, P2 = {}, DT = 0.12;
export default {
  id: 'flyers',
  name: 'Pterosaur Skies',
  kind: '2d',
  sky: true,
  params: [
    { id: 'x1', label: 'Flock size', value: 0.5, tip: 'How many are in the air (multiplies with Herd)' },
    { id: 'x2', label: 'Soaring', value: 0.5, tip: 'Low: hard flapping. High: wings held still, riding the air' },
    { id: 'x3', label: 'Altitude', value: 0.5, tip: 'How high the view is: higher pushes the sea or land down and out of the picture' },
    { id: 'x4', label: 'Haze', value: 0.5, tip: 'How quickly distant flyers fade into the air' },
  ],
  create(ctx, opts) {
    const o = opts, R = rng(Math.imul((o.seed || 1) + 7, 2654435761)), birds = [];
    (o.cast || []).forEach((g0, gi) => {
      const base = baseOf(g0.sp), g = { ...g0, base, span: base.span }, max = Math.ceil(g.n * 2.6) + 1;
      for (let i = 0; i < max; i++) birds.push({ g, gi, i, gi2: gi, a: R(), b: R(), c: R(), d: R(), ph: R(), turn: (g.turn || 1) * (R() < 0.82 ? 1 : -1), dir: g.dir || (R() < 0.5 ? -1 : 1), size: 0.86 + 0.24 * R(), fem: R() < 0.45, call: -9 });
    });
    const S = { walkers: [], dinos: 0 };
    (o.walkers || []).forEach((wk, wi) => { const base = species(wk.sp); for (let i = 0; i < wk.n * 2; i++) S.walkers.push({ base, i: S.walkers.length, r: (i + 0.5) / wk.n / 1.5 * 0.999, x0: R(), z: lerp(wk.z?.[0] ?? 260, wk.z?.[1] ?? 620, R()), dir: wk.dir || 1, scale: i % 4 === 3 ? 0.5 : 0.9 + 0.2 * R() }); });
    let T = null;
    const flock = [];
    return {
      render(f) {
        const { w, h } = f, p = f.p, E = f.era;
        T = T === null || f.dt > 2 ? f.t : T + f.dt * energy(f);
        const A = air(f), up = o.ground === 'up', none = o.ground === 'none';
        const V = { w, h, cx: w / 2, F: h * (o.F || 1.1) * lerp(0.7, 1.42, p.scale), camV: o.camV || 0, altK: lerp(0.62, 1.6, p.x3) };
        V.hw = w / (2 * V.F);
        V.hz = none || up ? h * (0.5 + (p.x3 - 0.5) * 0.3) : h * clamp((o.hz ?? 0.76) + (p.x3 - 0.5) * 0.44, 0.34, 1.3);
        V.eyeY = (o.eye ?? 3) * lerp(0.55, 1.45, p.x3);
        V.camX = V.camV * T - (f.pointer?.dragX || 0) * h / V.F * (o.zRef || 20);
        V.hazeD = (o.haze || 500) * lerp(2.6, 0.38, p.x4);
        V.sunX = w * (o.sunX ?? 0.74); V.sunY = up ? h * 0.3 : Math.min(V.hz, h * 0.86) - h * (A.L0 - 0.2) * 0.95;

        // ---- who is flying, and where
        const thin = (1 - 0.85 * E.dark) * Math.abs(2 * E.dinos - 1), mult = (0.45 + 1.1 * p.herd) * (0.45 + 1.1 * p.x1) * thin;
        flock.length = 0;
        for (const b of birds) {
          const g = b.g, a = clamp(g.n * mult - b.i + (b.i === 0 && thin > 0.1 ? 1 : 0)); if (a <= 0) continue;
          let sp = recast(g.base, E); if (!sp) continue;
          const vis = sp === g.base ? 1 : clamp(Math.pow(g.span / sp.span, 0.85), 0.04, 8);
          let size = b.size; if (sp.id === 'pteranodon' && b.fem) { sp = female(sp); size *= 0.74; }
          path(b, T - DT, V, P0); path(b, T + DT, V, P2); path(b, T, V, P1);
          const vx = (P2.ux - P0.ux) / (2 * DT) + V.camV, vy = (P2.y - P0.y) / (2 * DT), vz = (P2.z - P0.z) / (2 * DT);
          const ax = (P2.ux - 2 * P1.ux + P0.ux) / (DT * DT), az = (P2.z - 2 * P1.z + P0.z) / (DT * DT), vh = Math.hypot(vx, vz) || 1e-6;
          const al = (ax * vx + az * vz) / (vh * vh), lx = ax - al * vx, lz = az - al * vz;      // sideways pull of the turn
          const lift = o.eye > 0 && !up ? (V.eyeY - o.eye) * clamp(P1.y / o.eye) : 0;      // Altitude carries the flock up with the view
          const q = { b, g, sp, a, vis, size, x: P1.x, y: P1.y + lift, z: P1.z, wet: P1.wet, jaw: P1.jaw, look: P1.look, glide: P1.glide, up };
          if (up) { q.s = V.F / Math.max(4, q.y); q.px = V.cx + q.x * q.s; q.py = h * 0.5 - q.z * q.s; q.dir = 1; q.rot = Math.atan2(-vz, vx); q.yaw = 0;
            q.pitch = 1.24 + clamp(Math.atan2(Math.hypot(lx, lz), 9.8), 0, 0.5) * 0.3 * b.turn; q.depth = q.y; }
          else {
            q.s = V.F / q.z; q.px = V.cx + q.x * q.s; q.py = V.hz - (q.y - V.eyeY) * q.s; q.dir = vx >= 0 ? 1 : -1; q.depth = q.z;
            const be = Math.atan2(q.x, q.z), cb = Math.cos(be), sb = Math.sin(be), va = vx * sb + vz * cb, vc = vx * cb - vz * sb, la = lx * sb + lz * cb, lc = lx * cb - lz * sb;
            q.dir = vc >= 0 ? 1 : -1;
            const away = clamp(Math.atan2(va, Math.abs(vc)), -1.05, 1.05), climb = Math.atan2(vy, vh);
            q.yaw = away;
            let pit = 0.4 + 0.75 * Math.atan2(q.y - V.eyeY, q.z) + clamp(Math.atan2(la, 9.8), -0.8, 0.8) * Math.cos(away) * 1.1;
            pit += 0.26 * Math.exp(-pit * pit / 0.06); q.pitch = clamp(pit, -1.15, 1.3);
            q.rot = -q.dir * clamp(climb, -0.7, 0.7) * 0.9 * Math.cos(away) + clamp(Math.atan2(lc, 9.8), -0.7, 0.7) * Math.abs(Math.sin(away)) * 0.9;
            if (climb > 0.08) q.glide *= 1 - smooth(0.08, 0.3, climb) * 0.8;
          }
          q.fog = clamp(1 - Math.exp(-q.depth / V.hazeD)) * 0.86;
          const m = sp.span * vis * q.s; if (q.px < -m || q.px > w + m || q.py < -m || q.py > h + m || m < 1.6) continue;
          flock.push(q);
        }
        for (const c of f.pointer?.clicks || []) { let best = null, bd = 1e9; for (const q of flock) { const d = Math.hypot(q.px - c.x * w, q.py - c.y * h); if (d < bd) { bd = d; best = q; } } if (best) { best.b.call = T; if (f.sig) f.sig.roar = 1; } }
        if (f.sig) { f.sig.count = clamp(flock.length / 24); f.sig.speed = clamp(0.3 + 0.4 * (1 - p.x2)); }

        // ---- sky
        sky(f, () => paintSky(f, V, A, o));
        if (!f.combo) { paintSun(f, V, A, o); paintClouds(f, V, A, o, T); }
        paintMeteor(f, V);

        // ---- the strip of world under the sky, then everything by distance
        let items = [];
        if (o.ground === 'sea') { paintSea(f, V, A, o, T, flock); islands(f, V, A, o, items); }
        else if (o.ground === 'plain') items = paintPlain(f, V, A, o, T, flock, S) || [];
        else if (o.ground === 'forest') items = paintForest(f, V, A, o, T, S);
        for (const c of o.crags || []) { if (c.far && f.backdrop) continue;
          items.push({ z: c.z ?? 60, fn: () => { const per = crag(f, V, A, c, o), sp = c.perch ? recast(baseOf(c.percher || 'ichthyornis'), E) : null;
            if (sp && sp.plan === 'pbird') for (const q of per) { if (q[2] / c.perch > (0.5 + p.herd * 0.5) * (1 - 0.85 * E.dark) * Math.abs(2 * E.dinos - 1)) continue; perched(f, A, sp, q[0], q[1], h * (c.birdK ?? 0.028), hash(q[2], 3) < 0.5 ? -1 : 1, T, q[3]); } } }); }
        const glow = (o.glow ?? 0) + A.dl.dusk * 0.5;
        for (const q of flock) items.push({ z: q.up ? -1 / q.y : q.z, fn: () => {
          const sp = q.sp, k = q.s * q.vis * q.size, px = sp.span * k, call = clamp(1 - (T - q.b.call) / 0.9) * (T - q.b.call < 0.9 ? 1 : 0);
          const P = birdPal(sp, A.light * (o.shade ?? 1), q.fog, A.haze, sp.plan === 'pbird' ? glow * 0.3 : glow, A.sun);
          const pr = flyParts(sp, { t: T * 1.0 + q.b.ph * 20, glide: clamp(q.glide + (p.x2 - 0.5) * 1.1), yaw: q.yaw, pitch: q.pitch, jaw: Math.max(q.jaw, call * 0.9), look: q.look, rate: q.g.rate ?? 1 });
          ctx.save(); ctx.translate(q.px, q.py); ctx.rotate(q.rot); if (q.a < 1) ctx.globalAlpha = q.a;
          drawParts(ctx, pr, { x: 0, y: 0, k, dir: q.dir }, { pal: P, fill: (t, part) => part.k === 'wing' ? (t === 'far' ? P.wingFar : P.wing) : P[t], stroke: px > 46 ? P.line : null, lw: px > 46 ? clamp(px * 0.004, 0.5, 1.8) : 0, alpha: q.a < 1 ? { body: q.a, far: q.a, belly: q.a, mark: q.a, accent: q.a, horn: q.a, eye: q.a } : undefined });
          ctx.restore(); ctx.globalAlpha = 1;
        } });
        items.sort((a, b) => b.z - a.z);
        for (const it of items) it.fn();
        paintFx(f, V);
      }
    };
  }
};

const S = (id, name, desc, tags, opts, params) => ({ id: 'flyers-' + id, name, desc, tags: ['natural', '2d', ...tags], opts, params });
export const scenes = [
  S('pteranodon', 'Pteranodon over the Inland Sea', 'Flying reptiles fish the Western Interior Seaway: a long glide down, a dip of the beak, a flapping climb.', ['pterosaur', 'cretaceous', 'coast', 'flock'],
    { ground: 'sea', tone: 'inland', hz: 0.74, eye: 1.9, F: 1.1, camV: 3, clouds: 0.5, haze: 300, seed: 3, zRef: 10,
      cast: [{ sp: 'pteranodon', n: 2, b: 'fish', z: [8.5, 11], y: [3.4, 5], v: 10, dir: 1, period: 13 }, { sp: 'pteranodon', n: 2, b: 'line', z: [9, 16], y: [4.5, 8.5], v: 11, dir: 1, glide: 0.8 },
        { sp: 'pteranodon', n: 5, b: 'line', z: [26, 110], y: [5, 40], v: 12, glide: 0.8 }, { sp: 'pteranodon', n: 4, b: 'soar', at: [-50, 200], R: [28, 60], y: [45, 110], v: 13 },
        { sp: 'ichthyornis', n: 4, b: 'line', z: [2.6, 6], y: [1.5, 3.3], v: 8, dir: -1, glide: 0.2 }] },
    { stage: 0.756, light: 0.85 }),
  S('quetzalcoatlus', 'Quetzalcoatlus, Giants on the Wind', 'The largest flying animals known circle on a thermal, far above the sauropods and tyrannosaurs of Texas.', ['pterosaur', 'cretaceous', 'giant', 'scale'],
    { ground: 'plain', hz: 0.77, eye: 46, F: 1.1, clouds: 0.45, haze: 700, seed: 5, trees: 70, zRef: 60,
      cast: [{ sp: 'quetzalcoatlus', n: 2, b: 'soar', at: [0, 25], R: [9, 11], y: [46, 51], v: 12, flat: 0.75 }, { sp: 'quetzalcoatlus', n: 2, b: 'line', z: [55, 130], y: [40, 80], v: 15, glide: 0.9 },
        { sp: 'quetzalcoatlus', n: 3, b: 'soar', at: [160, 380], R: [50, 110], y: [60, 170], v: 16 }],
      walkers: [{ sp: 'alamosaurus', n: 3, z: [300, 520] }, { sp: 'edmontosaurus', n: 4, z: [250, 420], dir: 1 }, { sp: 'tyrannosaurus', n: 1, z: [260, 330], dir: -1 }] },
    { stage: 0.86, light: 0.55 }),
  S('lagoon', 'Rhamphorhynchus at Dusk', 'Long-tailed flying reptiles leave the islands of the Solnhofen lagoon as the light goes. Their eyes suggest they hunted at night.', ['pterosaur', 'jurassic', 'flock', 'coast', 'dusk'],
    { ground: 'sea', tone: 'lagoon', hz: 0.72, eye: 1.2, F: 1.15, clouds: 0.55, haze: 110, seed: 8, sunX: 0.3, zRef: 5,
      islands: { n: 5, z: [45, 150], R: [14, 40], plants: 7, scale: 0.6, kinds: ['cycad', 'bush', 'treefern', 'conifer', 'fern', 'cycad', 'deadtree'] },
      cast: [{ sp: 'rhamphorhynchus', n: 3, b: 'line', z: [2.7, 4.2], y: [1.1, 2.1], v: 7, dir: -1, glide: 0.35 }, { sp: 'rhamphorhynchus', n: 1, b: 'fish', z: [5.6, 6.6], y: [2, 2.6], v: 7, dir: -1, period: 11 },
        { sp: 'rhamphorhynchus', n: 9, b: 'line', z: [6, 28], y: [1.5, 9], v: 8, dir: -1, glide: 0.4 }, { sp: 'pterodactylus', n: 5, b: 'loop', at: [4, 4.5, 15], R: [6, 2, 4], v: 6 }] },
    { stage: 0.466, light: 0.3 }),
  S('dimorphodon', 'Dimorphodon on the Cliffs', 'Big-headed flying reptiles flap between the ledges of an Early Jurassic sea cliff, where Mary Anning would one day find them.', ['pterosaur', 'jurassic', 'coast', 'cliff'],
    { ground: 'sea', tone: 'ocean', hz: 0.73, eye: 5, F: 1.1, clouds: 0.4, haze: 160, seed: 12, sunX: 0.8, zRef: 5,
      crags: [{ x0: -0.2, x1: 0.24, top: 0.2, seed: 4, col: [128, 132, 140], plants: 6, plantK: 0.03, z: 26, tilt: 0.03 }, { x0: 0.84, x1: 0.99, top: 0.56, seed: 9, col: [128, 132, 140], fog: 0.45, far: 1, z: 200, plants: 3, plantK: 0.012, spread: 0.02, rough: 0.6 }],
      cast: [{ sp: 'dimorphodon', n: 3, b: 'loop', at: [0.3, 5.5, 3.1], R: [2.0, 0.8, 0.9], v: 5, glide: 0.15 }, { sp: 'dimorphodon', n: 6, b: 'loop', at: [-2, 7.5, 8.5], R: [5, 2.4, 2.6], v: 6, glide: 0.15 },
        { sp: 'dimorphodon', n: 4, b: 'line', z: [14, 40], y: [5, 18], v: 7, glide: 0.2 }] },
    { stage: 0.196, light: 0.62 }),
  S('tropeognathus', 'Tropeognathus Skims the Waves', 'Eight metres of wing a hand above the swell: a keel-jawed flying reptile trails its beak through the water for fish.', ['pterosaur', 'cretaceous', 'coast', 'close-up'],
    { ground: 'sea', tone: 'ocean', hz: 0.6, eye: 1.5, F: 1.0, camV: 12, clouds: 0.5, haze: 240, seed: 14, sunX: 0.24, zRef: 8,
      cast: [{ sp: 'tropeognathus', n: 2, b: 'skim', at: [1, 7], gap: 5.5, sway: 1.2 }, { sp: 'tropeognathus', n: 3, b: 'line', z: [30, 110], y: [4, 28], v: 13, dir: 1, glide: 0.85 },
        { sp: 'tropeognathus', n: 2, b: 'soar', at: [50, 190], R: [30, 60], y: [30, 80], v: 14 }] },
    { stage: 0.642, light: 0.42 }),
  S('kettle', 'The Kettle', 'Lie on your back: giant flying reptiles turn in a rising column of warm air, sunlight through their wings.', ['pterosaur', 'cretaceous', 'flock', 'from below', 'backlit'],
    { ground: 'up', F: 1.0, clouds: 0.3, haze: 300, seed: 21, glow: 0.8, shade: 0.8, sunX: 0.66,
      cast: [{ sp: 'quetzalcoatlus', n: 9, b: 'kettle', at: [0, 0], R: [5, 30], y: [12, 78], v: 11 }] },
    { stage: 0.862, light: 0.95, x2: 0.7 }),
  S('open', 'Eye Level', 'No ground at all: you are in the air beside a formation of Pteranodon. Put a Mega-Clouds sky behind them.', ['pterosaur', 'cretaceous', 'flock', 'open sky', 'clouds'],
    { ground: 'none', F: 1.05, eye: 0, camV: 13, clouds: 0.75, haze: 260, seed: 25, zRef: 8, sunX: 0.8,
      cast: [{ sp: 'pteranodon', n: 5, b: 'cruise', at: [2.2, 7.5, 0.3], gap: 4.4, sway: 1.2 }, { sp: 'pteranodon', n: 6, b: 'line', z: [22, 60], y: [-12, 14], v: 14.5, dir: 1, glide: 0.85 },
        { sp: 'pteranodon', n: 6, b: 'line', z: [70, 240], y: [-50, 60], v: 16, dir: 1, glide: 0.9 }] },
    { stage: 0.758, light: 0.8 }),
  S('ichthyornis', 'Ichthyornis Colony', 'Toothed seabirds wheel around a chalk stack in the inland sea, with Pteranodon passing far out.', ['bird', 'cretaceous', 'flock', 'coast', 'colony'],
    { ground: 'sea', tone: 'inland', hz: 0.72, eye: 2.2, F: 1.1, clouds: 0.5, haze: 120, seed: 31, sunX: 0.22, zRef: 3,
      crags: [{ x0: 0.66, x1: 0.9, top: 0.26, seed: 6, col: [206, 200, 184], perch: 16, guano: 1, plants: 0, z: 9.5, spread: 0.035, beds: 16 }, { x0: 0.08, x1: 0.15, top: 0.5, seed: 14, col: [206, 200, 184], fog: 0.4, far: 1, z: 80, plants: 0, spread: 0.015, rough: 0.5, perch: 5, birdK: 0.008 }],
      cast: [{ sp: 'ichthyornis', n: 2, b: 'loop', at: [-0.5, 2.5, 2.0], R: [1.2, 0.4, 0.5], v: 3.2, glide: 0.25 }, { sp: 'ichthyornis', n: 12, b: 'loop', at: [1.2, 3.3, 4], R: [2.4, 1.2, 1.3], v: 4.5, glide: 0.3 },
        { sp: 'ichthyornis', n: 6, b: 'line', z: [5, 18], y: [0.8, 4.5], v: 7, glide: 0.2 }, { sp: 'pteranodon', n: 2, b: 'line', z: [70, 160], y: [14, 50], v: 12, glide: 0.9 }] },
    { stage: 0.742, light: 0.72 }),
  S('archaeopteryx', 'Archaeopteryx in the Canopy', 'The first birds flap up and glide down between the conifers, while flying reptiles own the sky above the trees.', ['bird', 'jurassic', 'forest', 'flock'],
    { ground: 'forest', hz: 0.68, eye: 13, F: 1.1, camV: 0.4, clouds: 0.35, haze: 150, seed: 37, zRef: 3, trees: 60, treeZ: [9, 220],
      cast: [{ sp: 'archaeopteryx', n: 2, b: 'bound', z: [1.05, 1.5], y: [12.9, 13.3], v: 3.2, period: 3.4, drop: 0.35, rate: 0.8 }, { sp: 'archaeopteryx', n: 4, b: 'bound', z: [2.4, 6], y: [12.2, 15], v: 4, period: 4, drop: 0.8, rate: 0.8 },
        { sp: 'pterodactylus', n: 3, b: 'line', z: [14, 40], y: [22, 34], v: 7, glide: 0.4 }] },
    { stage: 0.466, light: 0.66 }),
  S('first', 'The First Wings', 'Late Triassic: Eudimorphodon, one of the earliest flying reptiles, flaps along a hot shore of Pangaea.', ['pterosaur', 'triassic', 'coast', 'flock'],
    { ground: 'sea', tone: 'tethys', hz: 0.75, eye: 0.9, F: 1.1, clouds: 0.3, haze: 90, seed: 41, sunX: 0.7, zRef: 3,
      islands: { n: 4, z: [50, 160], R: [20, 60], plants: 6, col: [214, 150, 110], kinds: ['cycad', 'conifer', 'fern', 'treefern', 'bush', 'deadtree'] },
      cast: [{ sp: 'eudimorphodon', n: 3, b: 'line', z: [1.5, 2.4], y: [1.0, 1.9], v: 4.5, dir: 1, glide: 0.1 }, { sp: 'eudimorphodon', n: 1, b: 'fish', z: [4.3, 5], y: [1.4, 1.8], v: 5, dir: 1, period: 9 },
        { sp: 'eudimorphodon', n: 7, b: 'line', z: [4, 18], y: [1.2, 6], v: 5.5, glide: 0.15 }] },
    { stage: 0.11, light: 0.7 }),
  S('deeptime', 'Sky Through Deep Time', 'One sky for 170 million years: the first flying reptiles, the giants, the birds, the impact, and who is left after.', ['pterosaur', 'bird', 'time travel', 'flock', 'impact'],
    { ground: 'plain', hz: 0.8, eye: 16, F: 1.1, clouds: 0.5, haze: 300, seed: 43, trees: 90, far: 900, zRef: 20, hills: 1.4,
      cast: [{ sp: 'pteranodon', n: 2, b: 'soar', at: [0, 15], R: [6, 8], y: [16, 20], v: 8, flat: 0.8 }, { sp: 'rhamphorhynchus', n: 5, b: 'line', z: [3, 9], y: [14.5, 19], v: 7, glide: 0.4 },
        { sp: 'dimorphodon', n: 6, b: 'line', z: [12, 50], y: [12, 34], v: 8, glide: 0.4 }, { sp: 'quetzalcoatlus', n: 3, b: 'soar', at: [80, 200], R: [30, 60], y: [40, 100], v: 14 }],
      walkers: [{ sp: 'diplodocus', n: 3, z: [110, 220] }, { sp: 'stegosaurus', n: 3, z: [90, 160], dir: -1 }, { sp: 'allosaurus', n: 1, z: [95, 130] }] },
    { stage: 0.06, grow: 0.5, light: 0.75 }),
];
