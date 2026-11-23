// Silhouettes & Sunsets: the shared world as dark shapes against light. Every animal is one solid silhouette, the
// land is a stack of hazy layers with ground fog between them, and the sky is the show: a huge low sun, a haloed
// moon, aurora, storm light, a lit cloth screen. In a combo the sky is left fully transparent, so the same dark
// layers stand in front of a Mega-Volcano or a Mega-Clouds sky.
import { createWorld, BIOMES } from '../world.js';
import { trace, paintMeteor } from '../draw.js';
import { clamp, lerp, smooth, hash, noise2, sky, windX, buffer } from '../util.js';

const TAU = Math.PI * 2;
const H = c => { const p = parseInt(c.slice(1), 16); return [p >> 16, p >> 8 & 255, p & 255]; };
const mx = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c, a = 1) => a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, a).toFixed(3)})`;
const pal = o => { const r = {}; for (const k in o) r[k] = H(o[k]); return r; };
const KEYS = ['top', 'mid', 'low', 'glow', 'ink'];

// night and day ends of every style; each style supplies its own dusk (K) and may override these
const N0 = pal({ top: '#03040d', mid: '#0a1436', low: '#2a4484', glow: '#d2deff', ink: '#02030a' });
const D0 = pal({ top: '#3f7cc4', mid: '#93bfe3', low: '#f3e4c2', glow: '#fff7de', ink: '#131b27' });
const ASH = pal({ top: '#2f2a27', mid: '#4f4640', low: '#7b6c5d', glow: '#b9552c', ink: '#100d0c' });

// sunX: where the sun stands · sunR: [base, extra with Sun size] in screen heights · lift: how much of the disc clears
// the horizon at golden hour · moon: [x, y as a fraction of the horizon, size] · gl: how light the ground is (snow)
const STY = {
  sun: { K: { top: '#2a1658', mid: '#b5356c', low: '#ff8a3a', glow: '#ffdc8c', ink: '#150a1b' }, sunX: 0.5, sunR: [0.1, 0.32], lift: 0.42, moon: [0.72, 0.3, 1], clouds: 1, bars: 1 },
  blood: { K: { top: '#12040c', mid: '#7a0f1c', low: '#e2381c', glow: '#ff9a3a', ink: '#0a0205' }, N: { low: '#3a2c6e' }, sunX: 0.3, sunR: [0.05, 0.16], lift: 0.1, moon: [0.26, 0.4, 1.2], clouds: 1.6 },
  mist: { K: { top: '#62799f', mid: '#c4aebd', low: '#f8dcb6', glow: '#fff3d8', ink: '#1b2233' }, D: { top: '#7fa3cc', mid: '#c3d6e2', low: '#f4ead6', ink: '#1c2634' }, sunX: 0.7, sunR: [0.03, 0.1], lift: 3.2, moon: [0.3, 0.35, 0.9], clouds: 0.4, fogK: 1.5, layers: 5 },
  moon: { K: { top: '#191747', mid: '#5a3f7e', low: '#e08a6a', glow: '#ffe0a8', ink: '#0b0716' }, N: { top: '#030511', mid: '#0b1a44', low: '#2f5196', glow: '#dfe8ff' }, sunX: 0.7, sunR: [0.06, 0.2], lift: 0.3, moon: [0.66, 0.58, 2.6], clouds: 0.5, eyes: 1 },
  storm: { K: { top: '#090c14', mid: '#262f3e', low: '#6f7c8d', glow: '#e6ecff', ink: '#04050a' }, N: { top: '#04060b', mid: '#131a26', low: '#3d4a5e' }, D: { top: '#2a3340', mid: '#5b6878', low: '#a9b4bf', ink: '#0b0f15' }, sunX: 0.5, sunR: [0, 0], lift: 0, moon: [0.5, -1, 0], storm: 1, nosun: 1, fogK: 0.6 },
  puppet: { K: { top: '#8a5320', mid: '#e0a04a', low: '#f6cf86', glow: '#fff2c8', ink: '#0d0603' }, N: { top: '#2c1606', mid: '#6b3d12', low: '#a86a26', glow: '#ffd994', ink: '#070301' }, D: { top: '#b98a48', mid: '#f1d596', low: '#fbeec6', glow: '#ffffff', ink: '#120a05' }, sunX: 0.5, sunR: [0, 0], lift: 0, moon: [0.5, -1, 0], puppet: 1, nosun: 1, fogK: 0.25 },
  aurora: { K: { top: '#101a3c', mid: '#3b4f86', low: '#e2a58c', glow: '#ffe6c0', ink: '#0a0e1c' }, N: { top: '#01060f', mid: '#04202f', low: '#0e5a58', glow: '#9dffd0', ink: '#01050a' }, sunX: 0.3, sunR: [0.04, 0.12], lift: 0.2, moon: [0.84, 0.2, 0.7], aurora: 1, gl: 0.3, stars: 1.6, fogK: 0.7 },
  last: { K: { top: '#31205f', mid: '#c2506a', low: '#ffa046', glow: '#ffe6a0', ink: '#170b16' }, sunX: 0.3, sunR: [0.07, 0.2], lift: 0.5, moon: [0.3, 0.3, 1], clouds: 1.2, bars: 1 },
  dust: { K: { top: '#7a3a22', mid: '#d0703a', low: '#f6b868', glow: '#fff0c4', ink: '#2a0f0a' }, D: { top: '#b98a5c', mid: '#e6c08a', low: '#f8e6bd', ink: '#2c1a12' }, sunX: 0.58, sunR: [0.1, 0.3], lift: 0.75, moon: [0.7, 0.3, 1], clouds: 0.3, fogK: 1.1, dusty: 1 },
};
for (const k in STY) { const s = STY[k]; s.K = pal(s.K); s.N = { ...N0, ...pal(s.N || {}) }; s.D = { ...D0, ...pal(s.D || {}) }; }

const NORIM = new Set(['fuzz', 'quill', 'tooth', 'claw', 'foot']);
const SKIP = new Set(['mark', 'belly', 'mouth', 'eye']);    // tones that are inside the outline or would close the open jaw

// a lightning strike from f.t: returns { a: light 0..1, inv: the first instant, when the picture is a negative, c: which strike }
function strike(t, seed) {
  const per = 3.4, c = Math.floor(t / per), dt = t - (c + 0.08 + 0.55 * hash(c, seed, 3)) * per;
  if (dt < 0) return { a: 0, inv: false, c };
  const flick = dt < 0.28 ? 1 : dt < 0.36 ? 0.25 : dt < 0.5 ? 0.85 : Math.exp(-(dt - 0.5) * 4.5) * 0.85;
  return { a: clamp(flick), inv: dt < 0.07, c, dt };
}

export default {
  id: 'silhouette',
  name: 'Silhouettes & Sunsets',
  kind: '2d',
  sky: true,
  params: [
    { id: 'x1', label: 'Fog', value: 0.5, tip: 'Ground fog lying between the layers of land' },
    { id: 'x2', label: 'Sun size', value: 0.5, tip: 'How big the sun or moon is' },
    { id: 'x3', label: 'Rim light', value: 0.5, tip: 'The thin edge of light on the side facing the sun or moon' },
    { id: 'x4', label: 'Haze', value: 0.5, tip: 'How quickly farther layers fade towards the colour of the sky' },
  ],
  create(ctx0, opts) {
    let ctx = ctx0;
    const soft = buffer(4, 4);      // everything soft in the sky is painted small and scaled up: one blit instead of many full-frame gradients
    const st = STY[opts.style] || STY.sun, seed = opts.seed ?? 1;
    const W0 = createWorld(opts);
    let Wb = null, wasCalling = false;
    // behind a volcano the horizons have to line up, so scenes with their own horizon get a second world for that case
    const worldFor = f => f.backdrop && Math.abs((opts.horizon ?? 0.56) - 0.56) > 0.03 ? (Wb ||= createWorld({ ...opts, horizon: 0.56, foot: 0.85 })) : W0;

    // ------------------------------------------------------------ colours for this frame
    function colours(f, B) {
      const light = clamp(f.p.light), E = f.era;
      const nW = 1 - smooth(0.05, 0.24, light), dW = smooth(0.42, 0.85, light), kW = Math.max(0, 1 - nW - dW);
      const C = { nW, dW, kW };
      for (const k of KEYS) { const n = st.N[k], d = st.D[k], q = st.K[k]; C[k] = [n[0] * nW + q[0] * kW + d[0] * dW, n[1] * nW + q[1] * kW + d[1] * dW, n[2] * nW + q[2] * kW + d[2] * dW]; }
      if (E.dark > 0) for (const k of KEYS) C[k] = mx(C[k], ASH[k], E.dark * 0.9);
      const m = Math.min(1, E.meteor);
      if (m > 0) { C.low = mx(C.low, [255, 218, 150], m * 0.5); C.mid = mx(C.mid, [255, 170, 110], m * 0.3); }
      if (B && B.a > 0 && !B.inv) { const L = [232, 238, 255]; C.top = mx(C.top, L, B.a * 0.8); C.mid = mx(C.mid, L, B.a * 0.9); C.low = mx(C.low, [255, 255, 255], B.a * 0.95); C.ink = mx(C.ink, [0, 0, 0], B.a); }
      const fl = E.flash;
      if (fl > 0) { const Wt = [255, 253, 244]; C.top = mx(C.top, Wt, fl); C.mid = mx(C.mid, Wt, fl); C.low = mx(C.low, Wt, fl); C.ink = mx(C.ink, [0, 0, 0], fl); }
      C.haze = mx(C.low, C.mid, 0.3);
      if (B && B.inv) { C.top = [6, 7, 12]; C.mid = [10, 11, 18]; C.low = [16, 18, 28]; C.haze = [34, 37, 52]; C.ink = [246, 248, 255]; }
      C.inv = !!(B && B.inv);
      C.rim = (kW + nW * 0.75 + dW * 0.35) * (1 - fl) * (1 - E.dark * 0.7) * (C.inv ? 0 : 1) * clamp(f.p.x3 * 2, 0, 2);
      return C;
    }

    // ------------------------------------------------------------ the sky (never in a combo)
    function paintSky(f, v, C, S, B) {
      const { w, h } = f, hor = v.horizon, E = f.era, t = f.t;
      const bw = Math.max(64, Math.ceil(w / 3)), bh = Math.max(36, Math.ceil(h / 3));
      if (soft.canvas.width !== bw || soft.canvas.height !== bh) { soft.canvas.width = bw; soft.canvas.height = bh; }
      ctx = soft.ctx; ctx.setTransform(bw / w, 0, 0, bh / h, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      try { softSky(f, v, C, S, B); } finally { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx = ctx0; }
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low';
      ctx.drawImage(soft.canvas, 0, 0, bw, bh, 0, 0, w, h);
      if (st.puppet) return paintWeave(f, C);
      // stars
      const sa = C.nW * (1 - E.dark) * (1 - E.flash) * (C.inv ? 0 : 1) * (B ? 0 : 1);
      if (sa > 0.05) {
        const n = Math.round(150 * (st.stars || 1)), u = Math.max(1, h * 0.0026);
        ctx.fillStyle = css(C.glow);
        for (let i = 0; i < n; i++) {
          const y = hash(i, 2, seed) * hor * 0.97, big = hash(i, 5) < 0.09 ? 1.9 : 1;
          ctx.globalAlpha = sa * (0.35 + 0.65 * hash(i, 9)) * (0.65 + 0.35 * Math.sin(t * (1 + 2 * hash(i, 4)) + i)) * (1 - 0.7 * y / hor);
          ctx.fillRect(hash(i, 1, seed) * w, y, u * big, u * big);
        }
        ctx.globalAlpha = 1;
      }
      if (!st.nosun) { paintSunDisc(f, v, C, S, false); paintMoon(f, v, C, S, false); }
      if (st.storm) paintBolt(f, v, C, B);
      // long thin clouds, lit from below
      if (st.clouds) {
        const n = Math.round(5 * st.clouds + 2), wx = windX(f.p.wind);
        for (let i = 0; i < n; i++) {
          const rx = w * (0.1 + 0.2 * hash(i, 3, seed)), span = w + rx * 2, x = ((hash(i, 1, seed) * span + t * h * 0.004 * wx * (0.5 + hash(i, 6))) % span + span) % span - rx;
          const y = hor * (0.2 + 0.68 * hash(i, 2, seed)), ry = h * (0.006 + 0.012 * hash(i, 4, seed)), near = clamp(1 - Math.abs(y - S.y) / (h * 0.4));
          ctx.fillStyle = css(mx(mx(C.mid, C.ink, 0.42), C.top, 0.25), 0.62);
          ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.ellipse(x + rx * 0.35, y - ry * 0.8, rx * 0.55, ry * 0.8, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = css(C.glow, 0.5 * (1 - C.nW) * (0.3 + 0.7 * near) * (1 - E.dark));
          ctx.beginPath(); ctx.ellipse(x, y + ry * 0.75, rx * 0.86, ry * 0.3, 0, 0, TAU); ctx.fill();
        }
      }
    }
    // the soft parts of the sky, painted into the small buffer (ctx is swapped to it while this runs)
    function softSky(f, v, C, S, B) {
      const { w, h } = f, hor = v.horizon, E = f.era;
      if (st.puppet) return paintCloth(f, v, C);
      const g = ctx.createLinearGradient(0, 0, 0, hor);
      g.addColorStop(0, css(C.top)); g.addColorStop(0.58, css(C.mid)); g.addColorStop(1, css(C.low));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      if (st.aurora) paintAurora(f, v, C);
      // the glow that spreads along the horizon from the sun
      if (!st.nosun && C.nW < 0.95) {
        const gy = Math.min(S.y, hor), R = w * 0.62, a = (1 - C.nW) * (0.25 + 0.4 * C.kW) * (1 - E.dark * 0.8);
        const r = ctx.createRadialGradient(S.x, gy, 0, S.x, gy, R);
        r.addColorStop(0, css(C.glow, a)); r.addColorStop(0.35, css(mx(C.glow, C.low, 0.6), a * 0.45)); r.addColorStop(1, css(C.low, 0));
        ctx.save(); ctx.translate(0, gy); ctx.scale(1, 0.6); ctx.translate(0, -gy); ctx.fillStyle = r; ctx.fillRect(0, gy - R, w, R * 2); ctx.restore();
      }
      if (!st.nosun) { paintSunDisc(f, v, C, S, true); paintMoon(f, v, C, S, true); }
      if (st.storm) paintStormSky(f, v, C, B);
      if (st.dusty) {       // the air itself: veils of dust across the sky
        for (let i = 0; i < 4; i++) { const y = hor * (0.5 + 0.13 * i), g2 = ctx.createLinearGradient(0, y - h * 0.07, 0, y + h * 0.07);
          g2.addColorStop(0, css(C.low, 0)); g2.addColorStop(0.5, css(C.low, 0.28)); g2.addColorStop(1, css(C.low, 0));
          ctx.fillStyle = g2; ctx.fillRect(0, y - h * 0.07, w, h * 0.14); }
      }
      if (v.meteor) { const mt = v.meteor, r = ctx.createRadialGradient(mt.x, mt.y, 0, mt.x, mt.y, h * 0.8);
        r.addColorStop(0, 'rgba(255,240,200,0.55)'); r.addColorStop(0.3, 'rgba(255,190,110,0.22)'); r.addColorStop(1, 'rgba(255,160,80,0)');
        ctx.fillStyle = r; ctx.fillRect(0, 0, w, h); }
    }
    function paintSunDisc(f, v, C, S, glow) {
      if (C.nW > 0.97 || S.r < 1) return;
      const { h } = f, a = (1 - C.nW) * (1 - f.era.dark * 0.55), r = S.r;
      if (glow) {
      const halo = ctx.createRadialGradient(S.x, S.y, r * 0.8, S.x, S.y, r * 2.4);
      halo.addColorStop(0, css(C.glow, 0.55 * a)); halo.addColorStop(1, css(C.glow, 0));
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(S.x, S.y, r * 2.4, 0, TAU); ctx.fill(); return; }
      const g = ctx.createLinearGradient(0, S.y - r, 0, S.y + r), hot = mx(C.glow, [255, 255, 255], 0.35 + 0.5 * C.dW), deep = mx(C.glow, C.low, 0.85 * C.kW);
      g.addColorStop(0, css(hot, a)); g.addColorStop(0.55, css(mx(hot, deep, 0.6), a)); g.addColorStop(1, css(deep, a));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(S.x, S.y, r, 0, TAU); ctx.fill();
      if (st.bars && C.kW > 0.2 && r > h * 0.05) {      // thin bars of cloud across the lower half of a big sun
        ctx.save(); ctx.beginPath(); ctx.arc(S.x, S.y, r, 0, TAU); ctx.clip();
        ctx.fillStyle = css(mx(C.low, C.mid, 0.45), 0.55 * C.kW);
        for (let i = 0; i < 5; i++) { const y = S.y + r * (0.08 + 0.17 * i) + Math.sin(f.t * 0.05 + i) * r * 0.01, th = r * (0.012 + 0.012 * i); ctx.fillRect(S.x - r, y, r * 2, th); }
        ctx.restore();
      }
    }
    function paintMoon(f, v, C, S, glow) {
      const a = smooth(0.45, 0.9, C.nW) * (1 - f.era.dark) * (1 - f.era.flash);
      if (a < 0.02 || S.mr < 0.5) return;
      const x = S.mx, y = S.my, r = S.mr, G = C.glow;
      if (glow) {
      const hg = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * 5);
      hg.addColorStop(0, css(G, 0.34 * a)); hg.addColorStop(0.35, css(G, 0.1 * a)); hg.addColorStop(1, css(G, 0));
      ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(x, y, r * 5, 0, TAU); ctx.fill(); return; }
      ctx.strokeStyle = css(G, 0.16 * a); ctx.lineWidth = Math.max(1, r * 0.09); ctx.beginPath(); ctx.arc(x, y, r * 3.1, 0, TAU); ctx.stroke();   // the ice halo
      ctx.fillStyle = css(mx(G, [255, 255, 255], 0.5), a); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.fillStyle = css(mx(G, C.mid, 0.55), 0.3 * a);
      for (const [dx, dy, k] of [[-0.3, -0.25, 0.3], [0.22, -0.4, 0.2], [0.3, 0.2, 0.26], [-0.25, 0.4, 0.17], [-0.6, 0.05, 0.12]]) { ctx.beginPath(); ctx.arc(x + dx * r, y + dy * r, r * k, 0, TAU); ctx.fill(); }
    }
    function paintAurora(f, v, C) {
      const { w, h } = f, hor = v.horizon, t = f.t, K = C.nW * (1 - f.era.dark) * (1 - f.era.flash);
      if (K < 0.03) return;
      const g = ctx.createLinearGradient(0, 0, 0, 1);
      g.addColorStop(0, 'rgba(150,70,230,0)'); g.addColorStop(0.35, 'rgba(120,110,235,0.22)'); g.addColorStop(0.72, 'rgba(60,235,160,0.55)'); g.addColorStop(0.94, 'rgba(170,255,200,0.95)'); g.addColorStop(1, 'rgba(120,255,190,0)');
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g;
      const N = 110, sw = w * 1.2 / N;
      for (let c = 0; c < 3; c++) for (let s = 0; s < N; s++) {
        const u = s / N, x = u * w * 1.2 - w * 0.1;
        const yb = hor * (0.5 + 0.16 * c) + Math.sin(u * 5 + t * 0.12 + c * 2.1) * h * 0.07 + Math.sin(u * 13 - t * 0.2 + c) * h * 0.02;
        const hg = h * (0.2 + 0.3 * noise2(u * 5 + t * 0.07 + c * 9, c * 5 + t * 0.04)), a = noise2(u * 8 - t * 0.16 + c * 11, t * 0.06 + c) * (0.6 + 0.4 * noise2(u * 46 + c * 3, t * 0.5));
        if (a < 0.08) continue;
        ctx.globalAlpha = clamp(a * 1.5 * K * (0.9 - 0.2 * c));
        ctx.save(); ctx.translate(x, yb - hg); ctx.scale(sw * 1.01, hg); ctx.fillRect(0, 0, 1, 1); ctx.restore();
      }
      ctx.restore(); ctx.globalAlpha = 1;
    }
    function paintBolt(f, v, C, B) {
      const { w, h } = f;
      if (B.a > 0.2 && B.dt < 0.5) {
        const bx = w * (0.15 + 0.7 * hash(B.c, seed, 7)), R = (i, k) => hash(B.c * 7.3 + i, k, seed) - 0.5;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        const path = (x, y, y1, wob, id) => { ctx.beginPath(); ctx.moveTo(x, y); let i = 0; while (y < y1) { y += h * (0.025 + 0.03 * hash(B.c, i, id)); x += R(i + id * 31, 2) * wob; ctx.lineTo(x, y); i++; if (id === 0 && i % 5 === 3) branches.push([x, y, i]); } };
        const branches = [];
        const col = B.inv ? '#05060c' : '#ffffff';
        path(bx, h * 0.2, v.horizon, h * 0.09, 0);
        ctx.strokeStyle = B.inv ? 'rgba(0,0,0,0.5)' : 'rgba(190,205,255,0.35)'; ctx.lineWidth = h * 0.02; ctx.stroke();
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.2, h * 0.006); ctx.stroke();
        for (const [x, y, i] of branches.slice(0, 3)) { path(x, y, y + h * (0.1 + 0.12 * hash(i, B.c)), h * 0.07, i + 1); ctx.strokeStyle = col; ctx.lineWidth = Math.max(0.8, h * 0.003); ctx.stroke(); }
      }
    }
    function paintStormSky(f, v, C, B) {
      const { w, h } = f, t = f.t, wx = windX(f.p.wind), lit = B.inv ? 0 : B.a;
      const base = B.inv ? [20, 22, 32] : mx(mx(C.top, C.ink, 0.35), [200, 210, 235], lit * 0.55), edge = B.inv ? [44, 48, 66] : mx(C.mid, [255, 255, 255], lit * 0.8);
      for (let i = 0; i < 16; i++) {
        const r = h * (0.16 + 0.2 * hash(i, 3, seed)), span = w + r * 2, x = ((hash(i, 1, seed) * span + t * h * 0.02 * wx * (0.6 + hash(i, 8))) % span + span) % span - r, y = h * (-0.04 + 0.2 * hash(i, 2, seed));
        const g = ctx.createRadialGradient(x, y - r * 0.2, r * 0.2, x, y, r);
        g.addColorStop(0, css(base, 0.96)); g.addColorStop(0.7, css(mx(base, edge, 0.35), 0.8)); g.addColorStop(1, css(edge, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      }
    }
    // the shadow theatre: a lamp behind a stretched cloth
    function paintCloth(f, v, C) {
      const { w, h } = f, fk = 0.96 + 0.04 * Math.sin(f.clock * 9.1) * Math.sin(f.clock * 3.7);
      const lx = w * (0.5 + 0.01 * Math.sin(f.t * 0.7)), ly = h * 0.44, R = Math.hypot(w, h) * 0.62;
      ctx.fillStyle = css(C.top); ctx.fillRect(0, 0, w, h);
      const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, R);
      g.addColorStop(0, css(mx(C.low, C.glow, 0.7 * fk))); g.addColorStop(0.18, css(mx(C.low, C.glow, 0.25 * fk))); g.addColorStop(0.5, css(C.mid)); g.addColorStop(0.85, css(C.top)); g.addColorStop(1, css(mx(C.top, C.ink, 0.45)));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 7; i++) { const x = w * (0.06 + 0.88 * hash(i, 4, seed)) + Math.sin(f.t * 0.4 + i * 2) * w * 0.004, ww = w * (0.02 + 0.03 * hash(i, 5)), g2 = ctx.createLinearGradient(x - ww, 0, x + ww, 0);
        g2.addColorStop(0, css(C.ink, 0)); g2.addColorStop(0.5, css(C.ink, 0.07)); g2.addColorStop(1, css(C.ink, 0)); ctx.fillStyle = g2; ctx.fillRect(x - ww, 0, ww * 2, h); }
    }
    function paintWeave(f, C) {      // the weave of the cloth
      const { w, h } = f, u = Math.max(2, h / 110);
      ctx.fillStyle = css(C.ink, 0.045); for (let y = 0; y < h; y += u) ctx.fillRect(0, y, w, Math.max(0.5, u * 0.3));
      ctx.fillStyle = css(C.glow, 0.05); for (let x = 0; x < w; x += u) ctx.fillRect(x, 0, Math.max(0.5, u * 0.3), h);
    }
    function paintFrame(f, C) {       // the wooden frame and the valance of the theatre
      const { w, h } = f, b = h * 0.045, wood = mx(C.ink, [70, 34, 14], 0.5), red = mx(C.ink, [120, 22, 20], 0.7);
      ctx.fillStyle = css(red); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, b * 2.1);
      const n = Math.max(6, Math.round(w / (h * 0.16))); for (let i = n; i > 0; i--) { const x1 = i / n * w, x0 = (i - 1) / n * w; ctx.quadraticCurveTo((x0 + x1) / 2, b * 3.6, x0, b * 2.1); }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = css(mx(red, [230, 180, 90], 0.5), 0.8); ctx.lineWidth = Math.max(1, h * 0.003); ctx.beginPath(); ctx.moveTo(w, b * 2.1);
      for (let i = n; i > 0; i--) { const x1 = i / n * w, x0 = (i - 1) / n * w; ctx.quadraticCurveTo((x0 + x1) / 2, b * 3.6, x0, b * 2.1); } ctx.stroke();
      ctx.fillStyle = css(wood); ctx.fillRect(0, 0, w, b); ctx.fillRect(0, h - b, w, b); ctx.fillRect(0, 0, b, h); ctx.fillRect(w - b, 0, b, h);
      ctx.strokeStyle = css(mx(wood, [240, 190, 110], 0.4), 0.7); ctx.lineWidth = Math.max(1, h * 0.003); ctx.strokeRect(b, b, w - b * 2, h - b * 2);
    }

    // ------------------------------------------------------------ silhouettes
    const keep = it => it._s ||= it.parts.filter(q => !SKIP.has(q.t) && q.k !== 'ray');
    function fillParts(list, T, col, colFar, nearOnly) {
      let cur = null;
      for (const q of list) {
        const far = q.t === 'far' || q.t === 'accentFar';
        if (nearOnly && (far || q.l || NORIM.has(q.k))) continue;
        const c = far ? colFar : col;
        ctx.beginPath(); trace(ctx, q, T);
        if (q.l) { ctx.strokeStyle = c; ctx.lineWidth = Math.max(0.6, q.w * T.k); ctx.stroke(); continue; }
        if (c !== cur) ctx.fillStyle = cur = c;
        ctx.fill();
      }
    }
    // one animal: a rim of light on the side facing the sun, then the solid dark shape, a hair's breadth away from it
    function silhouette(f, v, C, S, it, hz, B) {
      const T = it.T, list = keep(it), far = it.type === 'flyer';
      const col = mx(C.ink, C.haze, hz), colFar = mx(col, C.haze, 0.2 + 0.1 * (1 - hz));
      const fade = it.fade ?? 1;
      if (fade <= 0.01) return;
      ctx.lineJoin = ctx.lineCap = 'round';
      const wob = st.puppet ? 1 : 0;
      let TT = T, saved = false;
      if (it.wade || wob) { ctx.save(); saved = true; }
      if (it.wade) { ctx.beginPath(); ctx.rect(0, 0, f.w, it.waterY); ctx.clip(); }
      if (wob) {            // a puppet on a stick is never quite still
        const id = it.actor?.id ?? it.sp.len * 7, px = T.x, py = T.y - (it.pose ? it.pose.H : 0.5) * T.k;
        const a = 0.035 * Math.sin(f.t * 1.7 + id * 2.3) + 0.015 * Math.sin(f.t * 4.3 + id);
        ctx.translate(px, py + Math.sin(f.t * 2.3 + id) * f.h * 0.004); ctx.rotate(a); ctx.translate(-px, -py);
      }
      if (fade < 1) ctx.globalAlpha = fade;
      const rimA = C.rim * (far ? 0.5 : 1) * (1 - hz * 1.1), rw = Math.max(0.9, Math.min(f.h * 0.0034, T.k * it.sp.len * (it.pose?.scale ?? 1) * 0.012)) * (0.6 + 0.5 * f.p.x3);
      if (rimA > 0.06 && !st.puppet) {
        const lx = S.lx, ly = S.ly, dx = lx - T.x, dy = ly - (T.y - T.k * (it.sp.len || 1) * 0.2), dl = Math.hypot(dx, dy) || 1;
        fillParts(list, T, css(mx(col, C.glow, clamp(rimA, 0, 0.8))), null, true);
        TT = { x: T.x - dx / dl * rw, y: T.y - dy / dl * rw * 0.8 + rw * 0.35, k: T.k, dir: T.dir };
      }
      fillParts(list, TT, css(col), css(colFar), false);
      if (it.type === 'dino') {
        const eye = it.parts.find(q => q.k === 'eye');
        if (st.puppet) puppetGear(f, C, it, T, col, eye);
        else if (eye && st.eyes && C.nW > 0.25 && !C.inv && Math.abs(T.dir) > 0.4) {      // eyes that catch the moon
          const ex = T.x + eye.c[0] * T.k * T.dir, ey = T.y - eye.c[1] * T.k, r = Math.max(f.h * 0.0032, eye.c[2] * T.k * 1.15), a = C.nW * (1 - hz) * fade * (1 - f.era.flash);
          const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, r * 4.5);
          g.addColorStop(0, `rgba(200,255,170,${0.75 * a})`); g.addColorStop(0.3, `rgba(150,255,120,${0.28 * a})`); g.addColorStop(1, 'rgba(120,255,100,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ex, ey, r * 4.5, 0, TAU); ctx.fill();
          ctx.fillStyle = `rgba(240,255,210,${a})`; ctx.beginPath(); ctx.arc(ex, ey, r, 0, TAU); ctx.fill();
        } else if (eye && (B ? B.a > 0.3 : false) && !C.inv) { /* the flash leaves no eye-shine */ }
      } else if (st.puppet) { ctx.strokeStyle = css(col, 0.85); ctx.lineWidth = Math.max(1, f.h * 0.0035); ctx.beginPath(); ctx.moveTo(T.x, T.y); ctx.lineTo(T.x + f.h * 0.03, f.h); ctx.stroke(); }
      ctx.globalAlpha = 1;
      if (saved) ctx.restore();
    }
    // rods to work the puppet, pins at its joints and the punched holes that let the lamp through
    function puppetGear(f, C, it, T, col, eye) {
      const q = it.pose, P = (x, y) => [T.x + x * T.k * T.dir, T.y - y * T.k], L = it.sp.len * q.scale * T.k;
      const cloth = css(mx(C.low, C.glow, 0.3)), rodW = Math.max(1, f.h * 0.0036);
      ctx.strokeStyle = css(col, 0.9); ctx.lineWidth = rodW; ctx.lineCap = 'round';
      const hip = q.nodes[q.iHip], sh = q.nodes[q.iSh], hd = q.head;
      const rods = [[hip.x * 0.5 + sh.x * 0.5, (hip.y + sh.y) / 2 - hip.r * 0.5, 0.02], [hd.x, hd.y, 0.07 * T.dir]];
      for (const [x, y, lean] of rods) { const a = P(x, y); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0] + lean * f.h, f.h * 1.02); ctx.stroke(); }
      if (L < f.h * 0.06) return;
      ctx.fillStyle = cloth;
      const pr = Math.max(0.9, Math.min(L * 0.009, f.h * 0.006));
      const pin = (x, y, k = 1) => { const a = P(x, y); ctx.beginPath(); ctx.arc(a[0], a[1], pr * k, 0, TAU); ctx.fill(); };
      for (const g of q.legs) if (g.near) { pin(g.pts[0][0], g.pts[0][1], 1.25); pin(g.pts[1][0], g.pts[1][1]); }
      pin(sh.x, sh.y + sh.r * 0.3, 1.25); pin(hd.x, hd.y);
      if (eye) pin(eye.c[0], eye.c[1], 1.1);
      // a row of punched holes along the back and tail
      const n = q.nodes; for (let i = 2; i < n.length - 1; i += 2) if (n[i].r * T.k > pr * 3) pin(n[i].x, n[i].y + n[i].r * 0.45, 0.7);
    }
    function plant(f, v, C, it, hz) {
      if (it.x < -it.k * 16 || it.x > f.w + it.k * 16) return;
      const c = css(mx(C.ink, C.haze, hz)), T = { x: it.x, y: it.y, k: it.k, dir: 1 };
      ctx.fillStyle = c;
      for (const q of it.parts) { ctx.beginPath(); trace(ctx, q, T); if (q.l) { ctx.strokeStyle = c; ctx.lineWidth = Math.max(0.6, q.w * T.k); ctx.stroke(); } else ctx.fill(); }
    }

    // ------------------------------------------------------------ one frame
    function render(f) {
      const W = worldFor(f), p = f.p, { w, h } = f, E = f.era;
      const M = W.sil ||= { stage: -9, epoch: -9, herd: -9 };
      const jump = Math.abs(f.stage - M.stage) > 0.03 || f.epoch !== M.epoch || Math.abs(p.herd - M.herd) > 0.2;
      M.stage = f.stage; M.epoch = f.epoch; M.herd = p.herd;
      // world.js frames its first picture (and the one after a jump in time) before it has a cast, so that frame comes
      // out far too close; a frozen frame first lets it settle the framing
      if (jump) W.frame({ ...f, dt: 0 });
      const v = W.frame(f);
      // a scene can ask its lead animal to stop and call (the open jaw is the picture)
      if (opts.calls) {
        const a = v.lead, on = f.t % 9 < 5.5 && E.meteor <= 0 && a && !a.leaving;
        if (on) { a.tx = a.x; a.idle = 'call'; a.timer = Math.max(a.timer, 0.5);
          if (jump) { a.v = 0; a.headTo = 0.75; a.jaw = 1; a.rear = a.sp.P.biped ? 0.15 : 0; }
          if (!wasCalling && f.sig) f.sig.roar = 1; }
        wasCalling = !!on;
      }
      const B = st.storm ? strike(f.t, seed) : null;
      const C = colours(f, B);
      const hor = v.horizon, L = v.layers, d0 = L[L.length - 1].d / 0.74;
      // sun, moon and where the light comes from
      const sunR = h * (st.sunR[0] + st.sunR[1] * p.x2) * lerp(1, 0.4, C.dW);
      const S = { x: w * st.sunX, r: sunR, y: hor - h * (clamp(p.light) - 0.3) * (p.light < 0.3 ? 2.6 : 0.95) - sunR * st.lift * smooth(0.1, 0.3, p.light),
        mx: w * st.moon[0], my: hor * st.moon[1], mr: h * (0.022 + 0.05 * p.x2) * st.moon[2] };
      const moonLit = C.nW > 0.5;
      S.lx = st.puppet ? w * 0.5 : st.storm ? w * 0.5 : moonLit ? S.mx : S.x; S.ly = st.puppet || st.storm ? 0 : moonLit ? S.my : Math.min(S.y, hor);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      sky(f, () => paintSky(f, v, C, S, B));
      const hk = 0.35 + 1.3 * p.x4;
      const hzA = d => clamp(1 - Math.exp(-Math.max(0, d / d0 - 1) * 0.5 * hk), 0, 0.85);      // animals and plants
      const hzG = d => 1 - Math.exp(-(d / d0 - 0.74) * 0.75 * hk);                             // the ground under them
      const gl = st.gl || 0;
      const ground = d => mx(C.ink, C.haze, gl + (1 - gl) * (0.16 + 0.5 * hzG(d)));

      for (const it of v.flyers) silhouette(f, v, C, S, it, clamp(0.25 + it.fog * 0.6), B);
      if (v.meteor) paintMeteor(f, v);
      if (!f.backdrop) v.far.forEach((l, i) => {
        ctx.fillStyle = css(mx(C.haze, C.ink, (0.13 + 0.12 * i) * (1 + gl * -0.5)));
        ctx.beginPath(); ctx.moveTo(l.pts[0][0], l.bottom); for (const q of l.pts) ctx.lineTo(q[0], q[1]); ctx.lineTo(l.pts[l.pts.length - 1][0], l.bottom); ctx.closePath(); ctx.fill();
      });

      const fogA = clamp(p.x1 * 1.6 * (st.fogK ?? 1), 0, 1.5), nB = L.length, every = st.layers ? Math.max(1, Math.round((nB - 1) / st.layers)) : nB > 8 ? 2 : 1;
      const wx = windX(p.wind), rimG = C.rim * 0.3;
      for (let i = 0; i < nB; i++) {
        const b = L[i], gc = ground(b.d);
        ctx.fillStyle = css(gc);
        ctx.beginPath(); ctx.moveTo(b.pts[0][0], h + 2); for (const q of b.pts) ctx.lineTo(q[0], q[1]); ctx.lineTo(b.pts[b.pts.length - 1][0], h + 2); ctx.closePath(); ctx.fill();
        if (rimG > 0.05 && !st.puppet && !st.storm) {       // the crest of each rise catches the light, most under the sun
          const g = ctx.createLinearGradient(S.lx - w * 0.45, 0, S.lx + w * 0.45, 0), rc = mx(gc, C.glow, 0.8);
          g.addColorStop(0, css(rc, 0)); g.addColorStop(0.5, css(rc, clamp(rimG * (0.35 + 0.65 * b.u)))); g.addColorStop(1, css(rc, 0));
          ctx.strokeStyle = g; ctx.lineWidth = Math.max(1, h * 0.0028); ctx.lineJoin = 'round';
          ctx.beginPath(); ctx.moveTo(b.pts[0][0], b.pts[0][1] + ctx.lineWidth * 0.5); for (const q of b.pts) ctx.lineTo(q[0], q[1] + ctx.lineWidth * 0.5); ctx.stroke();
        }
        if (b.anyWet) {       // still water is a mirror of the sky: the brightest thing on the ground
          const n = b.pts.length, wc = mx(mx(C.low, C.glow, 0.3), gc, 0.1 + 0.55 * b.u * b.u);
          ctx.fillStyle = css(wc);
          for (let c = 0; c < n; c++) if (b.wet[c]) { const x0 = c ? (b.pts[c - 1][0] + b.pts[c][0]) / 2 : b.pts[c][0], x1 = c < n - 1 ? (b.pts[c][0] + b.pts[c + 1][0]) / 2 : b.pts[c][0]; ctx.fillRect(x0 - 0.5, b.level, x1 - x0 + 1, b.next - b.level + 1); }
          // the sun's path on the water
          ctx.fillStyle = css(mx(C.glow, [255, 255, 255], 0.3), 0.75 * (1 - E.dark) * (C.inv ? 0 : 1));
          const hh = Math.max(1, (b.next - b.level) * 0.16), reach = Math.max(S.r, h * 0.08) * 1.1;
          for (let k = 0; k < 7; k++) { const x = S.lx + (hash(k, i, 3) - 0.5) * 2 * reach * (0.4 + 0.6 * b.u), c = Math.round(x / w * 36) + 1; if (!b.wet[c]) continue;
            const ww = w * (0.012 + 0.03 * hash(k, i, 5)) * (0.6 + 0.4 * Math.sin(f.t * (1.5 + hash(k, i)) + k * 3)); ctx.fillRect(x - ww, b.level + (b.next - b.level) * hash(k, i, 8) * 0.8, ww * 2, hh); }
        }
        for (const it of b.items) { const z = hzA(it.d); if (it.type === 'plant') plant(f, v, C, it, z * 0.9 + (it.d > d0 * 1.05 ? 0.06 : 0)); else silhouette(f, v, C, S, it, z, B); }
        // ground fog lying in front of this layer; the next rise of land cuts it off cleanly
        if (fogA > 0.02 && i < nB - 1 && (nB - 2 - i) % every === 0) {
          const lv = b.next, fh = (lv - hor) * (0.4 + 0.5 * Math.min(1, fogA)) + h * 0.012, a = clamp(fogA * (0.3 + 0.38 * (1 - b.u)), 0, 0.92);
          const top = lv - fh * 1.15, g = ctx.createLinearGradient(0, top, 0, lv + fh * 0.2), fc = mx(C.haze, C.glow, 0.12 * (1 - C.nW));
          g.addColorStop(0, css(fc, 0)); g.addColorStop(0.55, css(fc, a * 0.55)); g.addColorStop(1, css(fc, a));
          ctx.fillStyle = g;
          if (f.combo) ctx.globalCompositeOperation = 'source-atop';
          let yb = lv; for (const q of L[i + 1].pts) if (q[1] > yb) yb = q[1]; yb = Math.min(h + 2, yb + 3);
          ctx.beginPath(); ctx.moveTo(0, yb);
          for (let c = 0; c <= 18; c++) { const x = c / 18 * w; ctx.lineTo(x, lv - fh * (0.25 + 0.9 * noise2(x / h * 1.6 + i * 7.3 + f.t * 0.035 * (wx || 0.3), i * 3.1 + f.t * 0.01))); }
          ctx.lineTo(w, yb); ctx.closePath(); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        }
      }

      // ---- weather and the theatre, over the top (only ever on what is already painted in a combo)
      if (f.combo) ctx.globalCompositeOperation = 'source-atop';
      if (st.storm) {
        const n = Math.round(110 * (0.5 + p.detail)), sl = (wx || 0.4) * 0.28;
        ctx.strokeStyle = C.inv ? 'rgba(10,10,20,0.5)' : css(mx(C.low, [255, 255, 255], 0.3 + 0.5 * B.a), 0.3 + 0.3 * B.a); ctx.lineWidth = Math.max(0.7, h * 0.0016); ctx.lineCap = 'butt';
        ctx.beginPath();
        for (let i = 0; i < n; i++) { const sp = 1.4 + hash(i, 2), y = ((hash(i, 7) + f.t * sp) % 1) * h * 1.15 - h * 0.1, x = ((hash(i, 3) * w * 1.3 + y * sl) % (w * 1.3)) - w * 0.15, len = h * (0.03 + 0.04 * hash(i, 5)); ctx.moveTo(x, y); ctx.lineTo(x + len * sl, y + len); }
        ctx.stroke();
      }
      if (E.dark > 0.02) {          // ash
        ctx.fillStyle = css(mx(C.low, [225, 220, 210], 0.6), E.dark * 0.6); const u = Math.max(1.2, h * 0.004);
        for (let i = 0; i < 80; i++) { const x = (((hash(i, 3) * w + f.t * h * 0.03 * (hash(i, 4) - 0.5 + wx * 0.6)) % w) + w) % w, y = (hash(i, 7) * h + f.t * h * (0.04 + 0.07 * hash(i, 9))) % h; ctx.fillRect(x, y, u * (0.6 + hash(i, 1)), u * 0.7); }
      }
      if (st.dusty && !f.combo) {      // dust hanging low over the plain
        const g = ctx.createLinearGradient(0, hor - h * 0.08, 0, h); g.addColorStop(0, css(C.haze, 0)); g.addColorStop(0.3, css(C.haze, 0.2 * p.x1 * 2)); g.addColorStop(1, css(C.haze, 0));
        ctx.fillStyle = g; ctx.fillRect(0, hor - h * 0.08, w, h);
      }
      ctx.globalCompositeOperation = 'source-over';
      if (st.puppet && !f.combo) paintFrame(f, C);
      ctx.globalAlpha = 1;
    }
    return { render };
  }
};

const S = (id, name, desc, tags, opts, params) => ({ id: 'silhouette-' + id, name, desc, tags: ['silhouette', '2d', ...tags], opts, params });
export const scenes = [
  S('sun', 'Long Necks, Setting Sun', 'Brachiosaurus and Diplodocus wade across a giant setting sun on the Morrison floodplain.', ['sauropod', 'jurassic', 'herd', 'family', 'sunset'],
    { style: 'sun', cast: [{ sp: 'brachiosaurus', n: 3, young: 1 }, { sp: 'diplodocus', n: 2, young: 1 }], biome: { ...BIOMES.floodplain, tall: 0.12 }, seed: 11, flyers: 3, horizon: 0.66, foot: 0.87 },
    { stage: 0.42, light: 0.3, x1: 0.4, x2: 0.7, x3: 0.6 }),
  S('rex', 'Blood-Red Dusk', 'A Tyrannosaurus stops on a ridge and calls into a red sky, jaws wide open.', ['theropod', 'cretaceous', 'sunset'],
    { style: 'blood', cast: [{ sp: 'tyrannosaurus', n: 1 }], mode: 'wander', biome: { ...BIOMES.badlands, density: 0.16, mult: { cycad: 1, deadtree: 1, fern: 0.6, rock: 0, boulder: 0 } }, seed: 3, calls: 1, flyers: 1, horizon: 0.7, foot: 0.84 },
    { stage: 0.855, light: 0.27, herd: 0.4, x1: 0.25, x2: 0.5, x3: 0.7 }),
  S('mist', 'Valley of Mist', 'Dawn in the uplands: a Triceratops family grazes between five layers of fog.', ['ceratopsian', 'cretaceous', 'family', 'herd', 'fog'],
    { style: 'mist', cast: [{ sp: 'triceratops', n: 3, young: 2 }], mode: 'wander', biome: { ...BIOMES.uplands, tall: 0.22, density: 0.4 }, seed: 5, horizon: 0.46, foot: 0.84, frame: 1.35 },
    { stage: 0.86, light: 0.36, x1: 0.85, x2: 0.5, x3: 0.35, x4: 0.6 }),
  S('moon', 'Raptor Moon', 'A Velociraptor pack crosses the Gobi dunes under a haloed moon, eyes shining.', ['theropod', 'cretaceous', 'pack', 'night', 'desert'],
    { style: 'moon', cast: [{ sp: 'velociraptor', n: 5 }], biome: 'desert', seed: 21, horizon: 0.64, foot: 0.86 },
    { stage: 0.79, light: 0.06, activity: 0.65, x1: 0.3, x2: 0.6, x3: 0.7 }),
  S('storm', 'Lightning Hunt', 'Allosaurus tests a Stegosaurus herd in a thunderstorm; each flash turns the hunt to a negative, then to white.', ['theropod', 'stegosaur', 'jurassic', 'hunt', 'storm', 'night'],
    { style: 'storm', cast: [{ sp: 'stegosaurus', n: 3, young: 1 }, { sp: 'allosaurus', n: 1, role: 'pred' }], mode: 'hunt', biome: { ...BIOMES.plain, tall: 0.08 }, seed: 14, flyers: 0, horizon: 0.6, foot: 0.86 },
    { stage: 0.43, light: 0.2, activity: 0.7, x1: 0.4, x3: 0.5 }),
  S('puppet', 'Shadow Theatre', 'Shadow puppets on a lamp-lit cloth, with rods, hinge pins and a wobble. The cast is fixed: these are puppets, not a herd.', ['ankylosaur', 'ornithopod', 'ceratopsian', 'theropod', 'cretaceous', 'puppet', 'theatre'],
    { style: 'puppet', cast: [{ sp: 'ankylosaurus', n: 1, lock: true }, { sp: 'parasaurolophus', n: 2, lock: true }, { sp: 'styracosaurus', n: 1, lock: true }, { sp: 'pachycephalosaurus', n: 1, lock: true }],
      mode: 'wander', biome: { ...BIOMES.plain, tall: 0.12, density: 0.35 }, seed: 8, flyers: 2, horizon: 0.72, foot: 0.86 },
    { stage: 0.82, light: 0.5, x1: 0.3, x4: 0.4 }),
  S('aurora', 'Polar Night', 'Leaellynasaura, small ornithopods of the Antarctic Circle, under the southern lights.', ['ornithopod', 'cretaceous', 'night', 'aurora', 'snow', 'herd'],
    { style: 'aurora', cast: [{ sp: 'leaellynasaura', n: 6 }], mode: 'wander', biome: { ...BIOMES.polar, tall: 0.1, density: 0.3, mult: { conifer: 3, fern: 0.6, bush: 0, cycad: 0, palm: 0, flowers: 0, magnolia: 0 } }, seed: 7, flyers: 0, horizon: 0.62, foot: 0.86, frame: 0.6 },
    { stage: 0.63, light: 0.04, x1: 0.35, x2: 0.4, x3: 0.6 }),
  S('last', 'The Last Sunset', 'Hell Creek at sundown, 66 million years ago. A fireball crosses the sky, the flash burns everything to black on white, then ash greys the light.', ['ornithopod', 'ceratopsian', 'ankylosaur', 'cretaceous', 'impact', 'time travel', 'sunset'],
    { style: 'last', cast: [{ sp: 'edmontosaurus', n: 3, young: 1 }, { sp: 'triceratops', n: 2 }, { sp: 'ankylosaurus', n: 1 }], mode: 'wander', biome: 'plain', seed: 30, flyers: 3, horizon: 0.62, foot: 0.86 },
    { stage: 0.866, grow: 0.15, light: 0.31, x1: 0.4, x2: 0.55, x3: 0.6 }),
  S('dust', 'Pangaea Dust', 'Coelophysis and Plateosaurus cross a white-hot sun in the dust of the Late Triassic desert.', ['theropod', 'triassic', 'pack', 'desert'],
    { style: 'dust', cast: [{ sp: 'coelophysis', n: 5 }, { sp: 'plateosaurus', n: 2 }], biome: 'desert', seed: 2, horizon: 0.64, foot: 0.86 },
    { stage: 0.1, light: 0.36, x1: 0.5, x2: 0.6, x3: 0.5 }),
];
