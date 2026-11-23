// Cartoon: the shared world drawn as cartoons. One engine, many sub-styles (opts.style): picture book, cel, chibi,
// sticker sheet, clay stop-motion, crayon, Saturday-morning chase and comic-book page.
// Every animal is drawn into an off-screen buffer (ink outline around the union of its parts, flat fills, then
// style passes: two-tone shade, halftone, rim light, texture, die-cut border) and stamped on the picture with big
// friendly eyes on top. Scenery is restyled through paintWorld's hooks: rounded hills, lollipop trees, curly ferns.
import { clamp, lerp, smooth, fract, hash, buffer } from '../util.js';
import { createWorld } from '../world.js';
import { paintWorld, paintMeteor, paintFx, paintSea, trace, feetY } from '../draw.js';
import { pose, parts, gait } from '../rig.js';
import { PLANTS } from '../flora.js';

const TAU = Math.PI * 2, PI = Math.PI;
const rgb = c => { const p = parseInt(c.slice(1), 16); return [p >> 16, p >> 8 & 255, p & 255]; };
const css = (c, a = 1) => a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, k) => [Math.min(255, a[0] * k), Math.min(255, a[1] * k), Math.min(255, a[2] * k)];

// sat / gain / pastel reshape every colour (animals and ground); ow scales the Outline control
const STYLES = {
  picture: { sky: ['#8fd0f0', '#eef7e6'], sat: 1.3, gain: 1.12, pastel: 0.12, ink: '#4a3528', ow: 0.8, leaf: '#6fba5a', leaf2: '#9bd475', trunk: '#a8754a', face: 1, tex: 'blotch', texA: 0.28, soft: 1 },
  cel: { sky: ['#3f9be8', '#c6e9ff'], sat: 1.65, gain: 1.15, pastel: 0, ink: '#15110f', ow: 1.15, leaf: '#3faa4c', leaf2: '#6fd05a', trunk: '#8a5a38', shade: 0.3, brow: 1 },
  chibi: { sky: ['#ffd6ea', '#fff5dc'], sat: 1.25, gain: 1.18, pastel: 0.36, ink: '#6b4a5a', ow: 0.9, leaf: '#9ad9a0', leaf2: '#c4ecb4', trunk: '#c9a184', face: 1, young: 1, eye: 1.45, cheeks: 1, soft: 1 },
  sticker: { sky: ['#e8e2f7', '#e8e2f7'], sat: 1.3, gain: 1.15, pastel: 0.28, ink: '#5b4a6b', ow: 0.6, leaf: '#8fd3a0', leaf2: '#b9e8b5', trunk: '#b9916f', sticker: 1, flat: 1, soft: 1 },
  clay: { sky: ['#86c0e8', '#dfeef5'], sat: 1.35, gain: 1.05, pastel: 0.04, ink: '#4a3024', ow: 0.4, leaf: '#58a655', leaf2: '#86c765', trunk: '#99664a', shade: 0.3, rim: 0.4, tex: 'thumb', texA: 0.6, fps: 9, soft: 1 },
  crayon: { sky: ['#b5def5', '#fdf6e3'], sat: 1.55, gain: 1.1, pastel: 0.06, ink: '#3b3030', ow: 0.9, leaf: '#4fae52', leaf2: '#8fd060', trunk: '#9a6238', wob: 1, tex: 'scribble', texA: 0.55 },
  chase: { sky: ['#2fa8f0', '#cdf1ff'], sat: 1.75, gain: 1.2, pastel: 0, ink: '#111111', ow: 1.25, leaf: '#35b24a', leaf2: '#7fdc50', trunk: '#8f5a30', shade: 0.24, brow: 1, lines: 1 },
  comic: { sky: ['#58b4ea', '#f7e7a6'], sat: 1.55, gain: 1.1, pastel: 0, ink: '#000000', ow: 1.35, leaf: '#3c9c48', leaf2: '#6cc452', trunk: '#7c5030', shade: 0.6, half: 1, brow: 1, panel: 1 },
};
const HEADK = new Set(['skull', 'jaw', 'tooth', 'mouth', 'beak', 'crest', 'horn', 'frill', 'eye', 'nostril']);
const TREES = new Set(['treefern', 'ginkgo', 'conifer', 'araucaria', 'redwood', 'magnolia', 'palm', 'deadtree']);
const NIGHT = [36, 46, 112], BURNT = [62, 54, 52];

function word(sp) {
  switch (sp.group) {
    case 'theropod': return sp.diet === 'herbivore' || sp.diet === 'omnivore' ? 'SQUAWK!' : sp.len > 4.5 ? 'ROAR!' : sp.len > 1.6 ? 'SCREECH!' : 'SQUEAK!';
    case 'bird': return 'SQUAWK!';
    case 'sauropod': return 'BWOOOM!';
    case 'sauropodomorph': return 'HOOOT!';
    case 'ornithopod': return 'HONK!';
    case 'ceratopsian': return 'BELLOW!';
    case 'stegosaur': return 'GRONK!';
    case 'ankylosaur': case 'thyreophoran': return 'GRUNT!';
    case 'pachycephalosaur': return 'BONK!';
    default: return 'HONK!';
  }
}

// one part's outline, with optional crayon wobble (px) seeded so it boils a few times a second
function tr(g, q, T, wob, sd) {
  if (!wob) return trace(g, q, T);
  const k = T.k, sx = k * T.dir, J = (i, a) => (hash(i + a * 31.7, sd) - 0.5) * 2 * wob;
  if (q.c) { const r = Math.max(0.4, q.c[2] * k + J(3, 1) * 0.4), cx = T.x + q.c[0] * sx + J(1, 1) * 0.5, cy = T.y - q.c[1] * k + J(2, 1) * 0.5; g.moveTo(cx + r, cy); g.arc(cx, cy, r, 0, TAU); return; }
  const p = q.p || q.l, n = p.length, X = i => T.x + p[i][0] * sx + J(i, 2), Y = i => T.y - p[i][1] * k + J(i, 3);
  if (q.p && n > 3) {
    let x = X(0), y = Y(0); const lx = X(n - 1), ly = Y(n - 1), x00 = x, y00 = y;
    g.moveTo((lx + x) / 2, (ly + y) / 2);
    for (let i = 0; i < n; i++) { const nx = i + 1 < n ? X(i + 1) : x00, ny = i + 1 < n ? Y(i + 1) : y00; g.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2); x = nx; y = ny; }
  } else { g.moveTo(X(0), Y(0)); for (let i = 1; i < n; i++) g.lineTo(X(i), Y(i)); if (q.p) g.closePath(); }
}
function bounds(ps, T) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; const k = T.k, sx = k * T.dir;
  for (const q of ps) {
    if (q.c) { const x = T.x + q.c[0] * sx, y = T.y - q.c[1] * k, r = q.c[2] * k; if (x - r < x0) x0 = x - r; if (x + r > x1) x1 = x + r; if (y - r < y0) y0 = y - r; if (y + r > y1) y1 = y + r; continue; }
    const p = q.p || q.l, r = q.l ? q.w * k * 0.5 : 0;
    for (let i = 0; i < p.length; i++) { const x = T.x + p[i][0] * sx, y = T.y - p[i][1] * k; if (x - r < x0) x0 = x - r; if (x + r > x1) x1 = x + r; if (y - r < y0) y0 = y - r; if (y + r > y1) y1 = y + r; }
  }
  return [x0, y0, x1, y1];
}
const smoothTop = (g, pts) => { g.lineTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length - 1; i++) g.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2); g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]); };
function starburst(g, x, y, rx, ry, n, rot, sd) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = rot + i / (n * 2) * TAU, r = i % 2 ? 0.74 : 1 + 0.16 * hash(i, sd); g.lineTo(x + Math.cos(a) * rx * r, y + Math.sin(a) * ry * r); }
  g.closePath();
}

export default {
  id: 'cartoon',
  name: 'Cartoon',
  kind: '2d',
  sky: true,
  params: [
    { id: 'x1', label: 'Outline', value: 0.5, tip: 'Thickness of the ink lines' },
    { id: 'x2', label: 'Bounce', value: 0.5, tip: 'Squash, stretch and hop in every step' },
    { id: 'x3', label: 'Lettering', value: 0.6, tip: 'Comic lettering when an animal calls (click one to make it call); 0 turns it off' },
    { id: 'x4', label: 'Dust', value: 0.5, tip: 'Puffs of dust at footfalls and speed lines behind runners' },
  ],
  create(ctx, opts) {
    const W = createWorld(opts);
    const sname = STYLES[opts.style] ? opts.style : 'picture', st = STYLES[sname];
    const INK = rgb(st.ink), SKY0 = rgb(st.sky[0]), SKY1 = rgb(st.sky[1]);
    let A = null, B = null, bw0 = 0, bh0 = 0, pat = {}, patH = 0;
    let acc = 0, lastQ = -1e9, heldT = 0;
    const tone = c => {                       // the style's colour reshaping
      const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
      let o = [clamp(l + (c[0] - l) * st.sat, 0, 255), clamp(l + (c[1] - l) * st.sat, 0, 255), clamp(l + (c[2] - l) * st.sat, 0, 255)];
      o = mul(o, st.gain);
      return st.pastel ? mix(o, [255, 250, 245], st.pastel) : o;
    };
    function patterns(h) {
      if (patH === h) return; patH = h; pat = {};
      { const c = Math.max(3, Math.round(h / 95)), b = buffer(c, c); b.ctx.fillStyle = '#000'; b.ctx.beginPath(); b.ctx.arc(c / 2, c / 2, c * 0.33, 0, TAU); b.ctx.fill(); pat.half = ctx.createPattern(b.canvas, 'repeat'); }
      { const s = Math.max(48, Math.round(h * 0.2)), b = buffer(s, s), g = b.ctx;                 // soft blotches / thumb prints
        for (let i = 0; i < 26; i++) { const x = hash(i, 1) * s, y = hash(i, 2) * s, r = s * (0.06 + 0.1 * hash(i, 3)), lightC = i % 2;
          for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) { const gr = g.createRadialGradient(x + ox * s, y + oy * s, 0, x + ox * s, y + oy * s, r);
            gr.addColorStop(0, lightC ? 'rgba(255,255,255,.2)' : 'rgba(0,0,0,.16)'); gr.addColorStop(0.7, lightC ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.07)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = gr; g.fillRect(x + ox * s - r, y + oy * s - r, r * 2, r * 2); } }
        pat.blotch = pat.thumb = ctx.createPattern(b.canvas, 'repeat'); }
      { const s = Math.max(40, Math.round(h * 0.11)), b = buffer(s, s), g = b.ctx, n = 14, step = s / n; g.lineCap = 'round';       // waxy diagonal scribble
        for (let i = -n; i < n * 2; i++) { const j = ((i % n) + n) % n; g.strokeStyle = `rgba(255,252,240,${0.1 + 0.5 * hash(j, 7)})`; g.lineWidth = step * (0.2 + 0.5 * hash(j, 8));
          g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step - s, s); g.stroke(); }
        pat.scribble = ctx.createPattern(b.canvas, 'repeat'); }
    }

    return {
      render(f0) {
        // clay: stop-motion. Hold time and let the world jump a few times a second.
        let f = f0;
        if (st.fps) {
          const q = Math.floor(f0.t * st.fps); acc += f0.dt || 0;
          if (q !== lastQ) { heldT = q / st.fps; f = { ...f0, t: heldT, dt: Math.abs(q - lastQ) > 3 ? f0.dt : acc }; f.sig = f0.sig; acc = 0; lastQ = q; }
          else f = { ...f0, t: heldT, dt: 0 };
        }
        const { w, h, p } = f, g = ctx, t = f.t, era = f.era;
        if (!A || bw0 !== w || bh0 !== h) { A = buffer(w, h); B = buffer(w, h); bw0 = w; bh0 = h; }
        patterns(h);
        const v = W.frame(f);
        const light = v.light, night = v.sun.night, dusk = v.sun.dusk, dark = v.dark;
        const Lm = lerp(0.74, 1, smooth(0, 0.6, light));
        const top = mix(mix(mix(SKY0, [128, 108, 186], dusk * 0.55), [16, 22, 66], night), [52, 40, 38], dark * 0.85);
        const bot = mix(mix(mix(SKY1, [255, 176, 118], dusk * 0.8), [58, 70, 140], night), [84, 62, 52], dark * 0.85);
        const lit = (c, fog = 0, pop = 0) => { let o = mix(mul(c, pop ? lerp(Lm, 1, 0.6) : Lm), NIGHT, night * (pop ? 0.2 : 0.42)); if (dusk) o = mix(o, [255, 170, 110], dusk * 0.12); if (dark) o = mix(o, BURNT, dark * 0.6); return fog ? mix(o, bot, fog) : o; };
        const ow = h * (0.0012 + p.x1 * 0.0062) * st.ow, ink = css(lit(INK, 0)), inkRGB = lit(INK, 0);
        const bf = Math.floor(t * 5), letters = []; let nBand = 0;
        const burnt = Math.min(1, era.dark * 1.3 + (1 - era.dinos) * (1 - era.ferns) * 0.4);
        const groundAt = u => { let c = tone(mix(rgb(v.biome.ground[0]), rgb(v.biome.ground[1]), st.flat ? 0.35 : u)); if (burnt > 0) c = mix(c, [96, 84, 78], burnt * 0.8); if (era.ferns > 0) c = mix(c, tone([96, 160, 84]), era.ferns * 0.5); return c; };
        const leafC = (hex, fog) => css(lit(burnt > 0 ? mix(rgb(hex), [104, 92, 84], Math.min(1, era.dark * 1.2) * 0.8) : rgb(hex), fog));
        g.lineJoin = g.lineCap = 'round';

        // ------------------------------------------------------------ sky
        const S = {};
        S.sky = () => {
          const gr = g.createLinearGradient(0, 0, 0, v.horizon * 1.05); gr.addColorStop(0, css(top)); gr.addColorStop(1, css(bot));
          g.fillStyle = gr; g.fillRect(0, 0, w, h);
          if (st.half) { g.save(); g.globalAlpha = 0.1; g.fillStyle = pat.half; g.fillRect(0, 0, w, v.horizon); g.restore(); }
          if (night > 0.3) { g.fillStyle = `rgba(255,250,214,${(night - 0.3) * 1.4 * (1 - dark)})`;
            for (let i = 0; i < 46; i++) { const x = hash(i, 11) * w, y = hash(i, 12) * v.horizon * 0.92, r = h * (0.003 + 0.005 * hash(i, 13)) * (0.75 + 0.25 * Math.sin(f.clock * 2 + i));
              g.beginPath(); if (i % 3) g.arc(x, y, r * 0.5, 0, TAU); else { g.moveTo(x, y - r * 1.6); g.quadraticCurveTo(x, y, x + r * 1.6, y); g.quadraticCurveTo(x, y, x, y + r * 1.6); g.quadraticCurveTo(x, y, x - r * 1.6, y); g.quadraticCurveTo(x, y, x, y - r * 1.6); } g.fill(); } }
          // puffy clouds
          const cc = css(mix(lit([255, 255, 255]), bot, 0.25 + night * 0.3)), cl = st.soft ? 0 : Math.min(ow, h * 0.004);
          for (let i = 0; i < 4; i++) { const r = h * (0.035 + 0.03 * hash(i, 6)), x = fract(t * 0.004 * (1 + hash(i, 3)) * (v.wind || 1) + hash(i, 4)) * (w + r * 6) - r * 3, y = h * (0.07 + 0.26 * hash(i, 5));
            g.beginPath(); for (const [dx, dy, k] of [[-0.9, 0.1, 0.55], [-0.3, -0.25, 0.75], [0.4, -0.18, 0.7], [0.95, 0.15, 0.5], [0, 0.25, 0.6]]) { g.moveTo(x + dx * r + k * r, y + dy * r); g.arc(x + dx * r, y + dy * r, k * r, 0, TAU); }
            if (cl > 0.4) { g.lineWidth = cl * 2; g.strokeStyle = ink; g.stroke(); } g.fillStyle = cc; g.fill(); }
        };
        S.sun = () => {
          const s = v.sun, a = 1 - dark; if (a < 0.03) return;
          const r = h * 0.062, lw = Math.max(1, Math.min(ow, h * 0.005));
          g.save(); g.globalAlpha = a;
          if (s.moon) {
            const mc = '#fff6cf';
            g.fillStyle = 'rgba(255,246,207,0.12)'; g.beginPath(); g.arc(s.x, s.y, r * 1.9, 0, TAU); g.fill();
            g.save(); g.beginPath(); g.rect(s.x - r * 3, s.y - r * 3, r * 6, r * 6); g.arc(s.x + r * 0.55, s.y - r * 0.28, r * 0.88, 0, TAU); g.clip('evenodd');
            g.beginPath(); g.arc(s.x, s.y, r, 0, TAU); g.fillStyle = mc; g.fill(); if (!st.soft) { g.lineWidth = lw * 2; g.strokeStyle = ink; g.stroke(); }
            g.restore();
            if (st.face) { g.strokeStyle = '#8a7a5a'; g.lineWidth = lw; g.beginPath(); g.arc(s.x - r * 0.52, s.y - r * 0.05, r * 0.14, 0.15, PI - 0.15); g.stroke(); g.beginPath(); g.arc(s.x - r * 0.5, s.y + r * 0.3, r * 0.2, 0.3, PI - 0.5); g.stroke(); }
          } else {
            const sc = css(mix([255, 214, 74], [255, 150, 70], dusk * 0.7));
            g.strokeStyle = st.soft ? sc : ink; g.lineWidth = st.soft ? r * 0.16 : lw * 1.5;
            g.beginPath(); for (let i = 0; i < 12; i++) { const an = i / 12 * TAU + t * 0.15, r0 = r * 1.28, r1 = r * (i % 2 ? 1.55 : 1.8); g.moveTo(s.x + Math.cos(an) * r0, s.y + Math.sin(an) * r0); g.lineTo(s.x + Math.cos(an) * r1, s.y + Math.sin(an) * r1); } g.stroke();
            g.beginPath(); g.arc(s.x, s.y, r, 0, TAU); g.fillStyle = sc; g.fill(); if (!st.soft) { g.lineWidth = lw * 1.5; g.strokeStyle = ink; g.stroke(); }
            if (st.face) { g.fillStyle = '#6a3d1c'; g.beginPath(); g.arc(s.x - r * 0.34, s.y - r * 0.14, r * 0.1, 0, TAU); g.arc(s.x + r * 0.34, s.y - r * 0.14, r * 0.1, 0, TAU); g.fill();
              g.strokeStyle = '#6a3d1c'; g.lineWidth = Math.max(1, r * 0.08); g.beginPath(); g.arc(s.x, s.y + r * 0.02, r * 0.48, 0.35, PI - 0.35); g.stroke();
              g.fillStyle = 'rgba(255,120,110,.45)'; g.beginPath(); g.arc(s.x - r * 0.6, s.y + r * 0.2, r * 0.15, 0, TAU); g.arc(s.x + r * 0.6, s.y + r * 0.2, r * 0.15, 0, TAU); g.fill(); }
          }
          g.restore();
        };
        S.meteor = () => { paintMeteor(f, v); const m = v.meteor; g.fillStyle = '#fff6c8'; g.strokeStyle = ink; g.lineWidth = Math.max(1, ow); g.beginPath(); g.arc(m.x, m.y, m.r * 1.6, 0, TAU); g.fill(); g.stroke(); };

        // ------------------------------------------------------------ land
        S.far = (f, v, l, i) => {
          const c = lit(mix(groundAt(0), mix(SKY1, SKY0, 0.4), 0.6 - i * 0.22));
          g.beginPath(); g.moveTo(l.pts[0][0], l.bottom); smoothTop(g, l.pts); g.lineTo(l.pts[l.pts.length - 1][0], l.bottom); g.closePath();
          g.fillStyle = css(c); g.fill();
          if (!st.flat) { g.beginPath(); g.moveTo(l.pts[0][0], l.pts[0][1]); smoothTop(g, l.pts); g.strokeStyle = st.soft ? css(mul(c, 0.86)) : css(mix(c, inkRGB, 0.55)); g.lineWidth = Math.max(0.8, ow * 0.6); g.stroke(); }
        };
        S.sea = () => { paintSea(f, v); };
        S.ground = (f, v, b) => {
          const c = lit(groundAt(b.u), (1 - b.u) * 0.22);
          g.beginPath(); g.moveTo(b.pts[0][0], h + 2); smoothTop(g, b.pts); g.lineTo(b.pts[b.pts.length - 1][0], h + 2); g.closePath();
          g.fillStyle = css(c); g.fill();
          if (st.half && (nBand++ % 3) === 0) { g.globalAlpha = 0.1 + 0.08 * b.u; g.fillStyle = pat.half; g.fill(); g.globalAlpha = 1; }
          if (st.tex === 'scribble') { g.globalAlpha = 0.5; g.fillStyle = pat.scribble; g.fill(); g.globalAlpha = 1; }
          if (st.flat) return;
          g.beginPath(); g.moveTo(b.pts[0][0], b.pts[0][1]); smoothTop(g, b.pts);
          g.strokeStyle = st.soft ? css(mul(c, 0.88)) : css(mix(c, inkRGB, 0.5 + 0.2 * b.u)); g.lineWidth = Math.max(0.8, ow * (0.45 + 0.4 * b.u)); g.stroke();
        };
        S.water = (f, v, b) => {
          const n = b.pts.length, c = lit(tone([92, 176, 226]), (1 - b.u) * 0.25);
          g.fillStyle = css(c);
          for (let i = 0; i < n; i++) if (b.wet[i]) { const x0 = i ? (b.pts[i - 1][0] + b.pts[i][0]) / 2 : b.pts[i][0], x1 = i < n - 1 ? (b.pts[i][0] + b.pts[i + 1][0]) / 2 : b.pts[i][0]; g.fillRect(x0 - 0.5, b.level, x1 - x0 + 1, b.next - b.level + 1); }
          g.strokeStyle = css(mix(c, [255, 255, 255], 0.55)); g.lineWidth = Math.max(1, ow * 0.6); g.beginPath();
          const yy = (b.level + b.next) / 2, wl = h * 0.02;
          for (let i = 1; i < n - 1; i += 2) if (b.wet[i] && b.wet[i - 1] && b.wet[i + 1] && hash(i, b.d | 0) < 0.6) { const x = b.pts[i][0] + Math.sin(t * 0.8 + i) * wl * 0.5; g.moveTo(x - wl, yy); g.quadraticCurveTo(x - wl * 0.5, yy - wl * 0.25, x, yy); g.quadraticCurveTo(x + wl * 0.5, yy + wl * 0.25, x + wl, yy); }
          g.stroke();
        };

        // ------------------------------------------------------------ plants: lollipop trees, curly ferns
        const fronds = (x, y, n, len, a0, a1, wd, col, lw, sd, sway) => {
          for (let pass = lw > 0.4 ? 0 : 1; pass < 2; pass++) {
            g.beginPath();
            for (let i = 0; i < n; i++) { const a = lerp(a0, a1, n > 1 ? i / (n - 1) : 0.5) + (hash(sd, i, 3) - 0.5) * 0.25, L = len * (0.75 + 0.4 * hash(sd, i, 4)), cx = Math.cos(a), sy = Math.sin(a), sg = cx >= 0 ? 1 : -1;
              const ex = x + cx * L + sway * L * 0.3, ey = y + sy * L * 0.75 + Math.abs(cx) * L * 0.12, cr = L * 0.14;
              g.moveTo(x, y); g.quadraticCurveTo(x + cx * L * 0.55, y + sy * L * 1.05 - L * 0.12, ex, ey); g.arc(ex, ey + cr, cr, -PI / 2, -PI / 2 + sg * PI * 1.35, sg < 0); }
            if (!pass) { g.strokeStyle = ink; g.lineWidth = wd + lw * 2; } else { g.strokeStyle = col; g.lineWidth = wd; }
            g.stroke();
          }
        };
        const blobs = (list, col, lw) => {
          g.beginPath(); for (const c of list) { g.moveTo(c[0] + c[2], c[1]); g.arc(c[0], c[1], c[2], 0, TAU); }
          if (lw > 0.4) { g.strokeStyle = ink; g.lineWidth = lw * 2; g.stroke(); } g.fillStyle = col; g.fill();
        };
        const stem = (x0, y0, x1, y1, wd, col, lw, bend = 0) => {
          g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2 + bend, (y0 + y1) / 2, x1, y1);
          if (lw > 0.4) { g.strokeStyle = ink; g.lineWidth = wd + lw * 2; g.lineCap = 'butt'; g.stroke(); g.lineCap = 'round'; } g.strokeStyle = col; g.lineWidth = wd; g.stroke();
        };
        S.plant = (f, v, it) => {
          const P = PLANTS[it.kind] || PLANTS.fern, sd = it.seed, tree = TREES.has(it.kind), x = it.x, y = it.y;
          const s0 = P.h * (0.75 + 0.5 * hash(sd, 1)) * it.k; let s = s0;
          if (tree) { s *= 0.62; const cap = h * 0.46; if (s > cap) s = cap + (s - cap) * 0.2; } else { const cap = h * 0.085; if (s > cap) s = cap + (s - cap) * 0.25; }
          if (x < -s * 1.2 - it.k * 3 || x > w + s * 1.2 + it.k * 3 || s < 1.2) return;
          const fog = it.fog * 0.75, lw = Math.min(ow * 0.8, s * (tree ? 0.022 : 0.05)) * (st.soft ? 0.7 : 1);
          const leaf = leafC(st.leaf, fog), leaf2 = leafC(st.leaf2, fog), trunk = css(lit(rgb(st.trunk), fog)), sw = it.sway * s * 0.04;
          switch (it.kind) {
            case 'fern': fronds(x, y, 5, s * 1.05, -PI + 0.25, -0.25, Math.max(1, s * 0.11), hash(sd, 2) < 0.5 ? leaf : leaf2, lw, sd, it.sway * 0.2); break;
            case 'cycad': { const th = s * 0.34; fronds(x + sw, y - th, 7, s * 0.7, -PI + 0.15, -0.15, Math.max(1, s * 0.07), leaf, lw, sd, it.sway * 0.2);
              g.beginPath(); g.ellipse(x, y - th * 0.5, s * 0.12, th * 0.62, 0, 0, TAU); if (lw > 0.4) { g.strokeStyle = ink; g.lineWidth = lw * 2; g.stroke(); } g.fillStyle = trunk; g.fill(); break; }
            case 'treefern': case 'palm': { const lean = (hash(sd, 5) - 0.5) * s * 0.3, tx = x + lean + sw * 2, ty = y - s * 0.82;
              stem(x, y, tx, ty, Math.max(1.2, s * 0.05), trunk, lw, -lean * 0.4);
              fronds(tx, ty, 7, s * 0.34, -PI - 0.2, 0.2, Math.max(1, s * 0.045), leaf, lw, sd, it.sway * 0.3); blobs([[tx, ty, s * 0.035]], leaf2, 0); break; }
            case 'ginkgo': case 'magnolia': { const cx = x + sw * 2, cy = y - s * 0.66, r = s * 0.3;
              stem(x, y, cx, cy, Math.max(1.5, s * 0.06), trunk, lw);
              blobs(it.kind === 'ginkgo' ? [[cx, cy, r], [cx - r * 0.75, cy + r * 0.3, r * 0.6], [cx + r * 0.75, cy + r * 0.25, r * 0.62], [cx + r * 0.1, cy - r * 0.55, r * 0.7]] : [[cx, cy, r * 1.05]], leaf, lw);
              blobs([[cx - r * 0.3, cy - r * 0.32, r * 0.42]], leaf2, 0);
              if (it.kind === 'magnolia') { const fl = css(lit([255, 214, 232], fog)); for (let i = 0; i < 6; i++) { const a = hash(sd, i, 8) * TAU, d = r * 0.75 * Math.sqrt(hash(sd, i, 9)); blobs([[cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * 0.13]], fl, 0); } }
              break; }
            case 'conifer': case 'redwood': { const bare = it.kind === 'redwood' ? 0.4 : 0.16, hw = s * (it.kind === 'redwood' ? 0.12 : 0.17), n = 3, th = s * (1 - bare) / n;
              stem(x, y, x + sw, y - s * (bare + 0.1), Math.max(1.5, s * 0.05), trunk, lw);
              g.beginPath();
              for (let i = 0; i < n; i++) { const yb = y - s * bare - th * i * 0.82, k2 = 1 - i * 0.24, xx = x + sw * (1 + i); g.moveTo(xx - hw * k2, yb); g.quadraticCurveTo(xx - hw * k2 * 0.3, yb - th * 0.7, xx, yb - th * 1.45); g.quadraticCurveTo(xx + hw * k2 * 0.3, yb - th * 0.7, xx + hw * k2, yb); g.quadraticCurveTo(xx, yb + th * 0.22, xx - hw * k2, yb); }
              if (lw > 0.4) { g.strokeStyle = ink; g.lineWidth = lw * 2; g.stroke(); } g.fillStyle = leaf; g.fill();
              g.beginPath(); for (let i = 0; i < n; i++) { const yb = y - s * bare - th * i * 0.82, k2 = 1 - i * 0.24, xx = x + sw * (1 + i); g.moveTo(xx - hw * k2 * 0.72, yb - th * 0.08); g.quadraticCurveTo(xx - hw * k2 * 0.25, yb - th * 0.62, xx - hw * 0.04, yb - th * 1.2); g.quadraticCurveTo(xx - hw * k2 * 0.1, yb - th * 0.3, xx - hw * k2 * 0.72, yb - th * 0.08); }
              g.fillStyle = leaf2; g.fill(); break; }
            case 'araucaria': { const tx = x + sw * 2, ty = y - s * 0.88;
              stem(x, y, tx, ty, Math.max(1.5, s * 0.035), trunk, lw);
              blobs([[tx - s * 0.11, ty + s * 0.1, s * 0.07], [tx + s * 0.12, ty + s * 0.13, s * 0.065], [tx - s * 0.09, ty, s * 0.1], [tx + s * 0.09, ty, s * 0.1], [tx, ty - s * 0.05, s * 0.11]], leaf, lw);
              blobs([[tx - s * 0.05, ty - s * 0.07, s * 0.05]], leaf2, 0); break; }
            case 'deadtree': { const c = css(lit([126, 108, 96], fog)), wd = Math.max(1.2, s * 0.045);
              stem(x, y, x + s * 0.03, y - s * 0.8, wd, c, lw); stem(x + s * 0.01, y - s * 0.4, x - s * 0.2, y - s * 0.66, wd * 0.6, c, lw, -s * 0.05); stem(x + s * 0.02, y - s * 0.55, x + s * 0.2, y - s * 0.84, wd * 0.6, c, lw, s * 0.05); break; }
            case 'bush': { const r = s * 0.36; blobs([[x - r * 0.8 + sw, y - r * 0.7, r * 0.75], [x + r * 0.85 + sw, y - r * 0.65, r * 0.7], [x + sw, y - r * 1.05, r]], leaf, lw); blobs([[x - r * 0.25 + sw, y - r * 1.3, r * 0.4]], leaf2, 0); break; }
            case 'flowers': { const cols = [[255, 190, 214], [255, 240, 170], [255, 255, 255], [214, 180, 255]];
              for (let i = 0; i < 4; i++) { const fx = x + (hash(sd, i, 2) - 0.5) * s * 2.4, fh = s * (0.7 + 0.7 * hash(sd, i, 3)), r = Math.max(1, s * 0.24);
                stem(fx, y, fx + sw * 3, y - fh, Math.max(0.8, s * 0.08), leaf, 0);
                blobs([[fx + sw * 3, y - fh, r]], css(lit(cols[(sd + i) & 3], fog)), Math.min(lw, r * 0.3)); blobs([[fx + sw * 3, y - fh, r * 0.4]], css(lit([255, 200, 60], fog)), 0); }
              break; }
            case 'reed': case 'horsetail': { const n = it.kind === 'reed' ? 5 : 3, wd = Math.max(1, s * (it.kind === 'reed' ? 0.05 : 0.09));
              for (let pass = lw > 0.4 ? 0 : 1; pass < 2; pass++) { g.beginPath();
                for (let i = 0; i < n; i++) { const bx = x + (i - (n - 1) / 2) * s * 0.16, hh = s * (0.6 + 0.5 * hash(sd, i, 2)), lean = (hash(sd, i, 3) - 0.5) * s * 0.25 + sw * 4; g.moveTo(bx, y); g.quadraticCurveTo(bx, y - hh * 0.6, bx + lean, y - hh);
                  }
                if (!pass) { g.strokeStyle = ink; g.lineWidth = wd + lw * 2; } else { g.strokeStyle = leaf; g.lineWidth = wd; } g.stroke(); }
              break; }
            default: {     // rocks, logs, stumps, bones, nests: the shared shapes, outlined as one
              const T = { x, y, k: it.kind === 'nest' ? it.k : it.k * s / s0, dir: 1 }, ps = it.parts, pal = { trunk, leaf, leaf2, rock: css(lit(tone([150, 146, 150]), fog)), rock2: css(lit(tone([186, 182, 184]), fog)), egg: css(lit([255, 250, 232], fog)), bone: css(lit([246, 240, 220], fog)), flower: css(lit([255, 200, 220], fog)) };
              if (it.kind === 'nest') { pal.rock = css(lit(tone([176, 134, 84]), fog)); }
              const l2 = Math.min(ow * 0.8, T.k * 0.12);
              if (l2 > 0.4) { g.strokeStyle = ink; g.beginPath(); for (const q of ps) if (!q.l) trace(g, q, T); g.lineWidth = l2 * 2; g.stroke(); for (const q of ps) if (q.l) { g.beginPath(); trace(g, q, T); g.lineWidth = q.w * T.k + l2 * 2; g.stroke(); } }
              for (const q of ps) { g.beginPath(); trace(g, q, T); if (q.l) { g.strokeStyle = pal[q.t] || leaf; g.lineWidth = Math.max(0.8, q.w * T.k); g.stroke(); } else { g.fillStyle = pal[q.t] || leaf; g.fill(); } }
              if (it.kind === 'nest' && l2 > 0.4) { g.strokeStyle = ink; g.lineWidth = l2; for (const q of ps) if (q.t === 'egg') { g.beginPath(); trace(g, q, T); g.stroke(); } }
            }
          }
        };

        // ------------------------------------------------------------ animals
        const dustC = css(mix(lit(groundAt(1)), [255, 255, 255], 0.55));
        const puffAt = (x, y, r, a) => {
          g.globalAlpha = a; g.beginPath();
          for (const [dx, dy, k] of [[-0.7, 0, 0.6], [0, -0.35, 0.8], [0.7, 0.05, 0.55]]) { g.moveTo(x + dx * r + k * r, y + dy * r); g.arc(x + dx * r, y + dy * r, k * r, 0, TAU); }
          const l = Math.min(ow * 0.7, r * 0.2); if (l > 0.4 && !st.soft) { g.strokeStyle = ink; g.lineWidth = l * 2; g.stroke(); } g.fillStyle = dustC; g.fill(); g.globalAlpha = 1;
        };
        S.dino = (f, v, it) => {
          const a = it.actor, isD = it.type === 'dino', fade = it.fade ?? 1;
          if (fade <= 0.01) return;
          if (isD && st.young) {            // chibi: everyone gets baby proportions, and an even bigger head
            const sp = a.sp, deep = -sp.P.hipH * sp.len * a.scale * 0.55, wet = v.biome.water > 0;
            const gy = dx => { const y = W.land(a.x + a.dir * dx, a.d); return wet ? Math.max(deep, y) : y; };
            const q = pose(sp, { phase: a.phase, run: a.run, headTo: a.headTo, jaw: a.jaw, crouch: a.crouch, rear: a.rear, t: t + a.id, gy, scale: a.scale, young: 1 });
            const hx = q.head.x, hy = q.head.y, hs = 1.4, M = pt => [hx + (pt[0] - hx) * hs, hy + (pt[1] - hy) * hs];
            it._q = q; it._p = parts(q).map(o => !HEADK.has(o.k) ? o : o.c ? { ...o, c: [...M(o.c), o.c[2] * hs] } : o.p ? { ...o, p: o.p.map(M) } : { ...o, l: o.l.map(M), w: o.w * hs });
          }
          const T = it.T, ps = it.parts, q = isD ? it.pose : null, k = T.k, ds = T.dir < 0 ? -1 : 1;
          const Hpx = isD ? q.H * k : it.sp.span * k * 0.12, lw = Math.max(0.5, Math.min(ow, Hpx * 0.085));
          const border = st.sticker ? Math.max(1.5, Math.min(h * 0.011, Hpx * 0.22)) : 0;
          const [x0, y0, x1, y1] = bounds(ps, T), pad = lw * 2 + border * 2 + 3;
          const bx = Math.floor(Math.max(0, x0 - pad)), by = Math.floor(Math.max(0, y0 - pad)), bw = Math.ceil(Math.min(w, x1 + pad)) - bx, bh = Math.ceil(Math.min(h, y1 + pad)) - by;
          if (bw <= 1 || bh <= 1) return;
          const run = isD ? a.run : 0, moving = isD && a.v > 0.12, G = isD ? gait(a.sp, run, a.scale) : null;
          const gyPx = isD ? T.y - feetY(q) * k : T.y, Lpx = isD ? a.sp.len * a.scale * k : it.sp.span * k;

          // the colours of this animal
          const sc = it.sp.c, fog = (it.fog || 0) * 0.55, C = (c, m = 1) => css(lit(tone(mul(rgb(c), m)), fog, 1));
          const pal = { body: C(sc[0]), belly: C(sc[1]), far: C(sc[0], 0.74), mark: C(sc[2]), accent: C(sc[3]), accentFar: C(sc[3], 0.72), horn: css(lit([250, 240, 214], fog, 1)), mouth: css(lit([206, 62, 72], fog, 1)), eye: '#fff' };

          // ground shadow, dust and speed lines go under the animal
          if (isD && !it.wade && !st.sticker) { g.fillStyle = `rgba(20,20,40,${0.2 * fade})`; g.beginPath(); g.ellipse(T.x + q.nodes[q.iSh].x * 0.5 * k * ds, gyPx, Lpx * 0.28, Math.max(1, Lpx * 0.035), 0, 0, TAU); g.fill(); }
          if (moving && !it.wade && p.x4 > 0.03 && (run > 0.12 || G.H > 1.3)) {
            const u = fract(a.phase * 2), n = run > 0.3 ? 3 : 1, half = G.stride * 0.5 * k;
            for (let j = n - 1; j >= 0; j--) { const age = (u + j) / n, r = Hpx * (0.1 + 0.2 * run) * (0.6 + age) * (0.5 + p.x4);
              puffAt(T.x - ds * ((u + j) * half * (run > 0.3 ? 1 : 0.35) + Lpx * 0.05), gyPx - r * (0.5 + age * 0.8), r, (1 - age) * 0.9 * fade); }
          }
          if (moving && run > 0.3 && p.x4 > 0.03) {
            g.strokeStyle = st.lines || !st.soft ? ink : 'rgba(255,255,255,.85)'; g.lineWidth = Math.max(1, lw * 0.8); g.globalAlpha = fade * clamp(run * 1.5) * 0.8; g.beginPath();
            const n = st.lines ? 6 : 4, top = y0, bot2 = gyPx - Hpx * 0.15;
            for (let i = 0; i < n; i++) { const hsh = hash(i, a.id, Math.floor(t * 10)), yy = lerp(top, bot2, (i + 0.5 * hsh) / n), xs = T.x - ds * Lpx * (0.42 + 0.2 * hash(i, a.id)), len = Lpx * (0.15 + 0.4 * hsh) * (0.5 + p.x4) * (st.lines ? 1.4 : 1);
              g.moveTo(xs, yy); g.lineTo(xs - ds * len, yy); }
            g.stroke(); g.globalAlpha = 1;
          }

          // draw the animal on buffer A
          const c = A.ctx, sd0 = (isD ? a.id : 7) * 13.1 + bf * 7.7, wob = st.wob ? Math.min(h * 0.004, Hpx * 0.05) : 0;
          c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(bx - 3, by - 3, bw + 6, bh + 6); c.beginPath(); c.rect(bx, by, bw, bh); c.clip();
          c.lineJoin = c.lineCap = 'round';
          const strokeAll = (col, width) => {
            c.strokeStyle = col; c.fillStyle = col; c.lineWidth = width * 2; c.beginPath();
            ps.forEach((o, i) => { if (!o.l && o.k !== 'mark' && o.k !== 'eye' && o.k !== 'nostril') tr(c, o, T, wob, sd0 + i); });
            c.stroke(); c.fill();
            ps.forEach((o, i) => { if (o.l) { c.beginPath(); tr(c, o, T, wob, sd0 + i); c.lineWidth = o.w * k + width * 2; c.stroke(); } });
          };
          if (border) strokeAll('#ffffff', lw + border);
          strokeAll(ink, lw);
          const inner = Math.max(0.5, lw * 0.55);
          ps.forEach((o, i) => {
            if (o.k === 'eye' || o.k === 'nostril') return;
            const col = pal[o.t] || pal.body;
            c.beginPath(); tr(c, o, T, wob, sd0 + i);
            if (o.l) { c.strokeStyle = col; c.lineWidth = Math.max(0.6, o.w * k); c.stroke(); return; }
            if (o.k === 'mark') c.globalAlpha = 0.8;
            c.fillStyle = col; c.fill(); c.globalAlpha = 1;
            // a thinner inside line where a near limb, jaw or plate overlaps the body
            if (Hpx > 9 && (o.t === 'body' && (o.k === 'leg' || o.k === 'arm' || o.k === 'jaw' || o.k === 'foot') || o.k === 'wing' && o.t === 'accent' || o.k === 'plate' || o.k === 'frill' || o.k === 'horn' || o.k === 'beak' || o.k === 'tooth' || o.k === 'spike' || o.k === 'sail' || o.k === 'crest' || o.k === 'club')) {
              c.strokeStyle = ink; c.lineWidth = o.k === 'tooth' ? inner * 0.5 : inner; c.globalAlpha = st.soft ? 0.5 : 0.85; c.stroke(); c.globalAlpha = 1; }
          });
          // style passes that only touch the animal
          const crescent = (dx, dy, fill, alpha) => {
            const b = B.ctx; b.setTransform(1, 0, 0, 1, 0, 0); b.globalCompositeOperation = 'source-over'; b.globalAlpha = 1; b.clearRect(bx, by, bw, bh);
            b.drawImage(A.canvas, bx, by, bw, bh, bx, by, bw, bh);
            b.globalCompositeOperation = 'destination-out'; b.drawImage(A.canvas, bx, by, bw, bh, bx + dx, by + dy, bw, bh);
            b.globalCompositeOperation = 'source-in'; b.fillStyle = fill; b.fillRect(bx, by, bw, bh); b.globalCompositeOperation = 'source-over';
            c.globalCompositeOperation = 'source-atop'; c.globalAlpha = alpha; c.drawImage(B.canvas, bx, by, bw, bh, bx, by, bw, bh); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
          };
          if (Hpx > 6) {
            const sh = clamp(Hpx * 0.17, 1.5, h * 0.03);
            if (st.shade) crescent(-ds * sh * 0.45, -sh, st.half ? pat.half : '#0a0a30', st.shade);
            if (st.rim) crescent(ds * sh * 0.3, sh * 0.55, '#ffffff', st.rim);
            if (st.tex) { c.globalCompositeOperation = 'source-atop'; c.globalAlpha = st.texA; c.fillStyle = pat[st.tex];
              const ox = Math.round(T.x + (st.wob ? hash(bf, 3) * 40 : 0)), oy = Math.round(T.y + (st.wob ? hash(bf, 4) * 40 : 0));
              c.translate(ox, oy); c.fillRect(bx - ox, by - oy, bw, bh); c.translate(-ox, -oy); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; }
          }
          c.restore();

          // stamp it on the picture, with squash and stretch
          g.save();
          if (it.wade) { g.beginPath(); g.rect(0, 0, w, it.waterY); g.clip(); }
          if (isD && p.x2 > 0.02) {
            const kb = p.x2 * 2 / (1 + q.H / 2.2), ph = a.phase * TAU;
            const sy = 1 + (moving ? 0.045 * Math.sin(ph * 2 + 0.6) : 0.014 * Math.sin(t * 2.2 + a.id)) * kb, hop = moving ? -Math.abs(Math.sin(ph)) * Hpx * 0.07 * kb * (0.5 + run) : 0;
            g.translate(T.x, gyPx + hop); g.scale(1 / sy, sy); g.translate(-T.x, -gyPx);
          }
          g.globalAlpha = fade;
          if (st.sticker) { g.shadowColor = 'rgba(60,40,90,0.35)'; g.shadowBlur = h * 0.012; g.shadowOffsetY = h * 0.007; g.shadowOffsetX = h * 0.003; }
          g.drawImage(A.canvas, bx, by, bw, bh, bx, by, bw, bh);
          if (st.sticker) { g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = g.shadowOffsetX = 0; }

          // big friendly eyes
          const eye = ps.find(o => o.k === 'eye');
          if (eye && fade > 0.4) {
            const hl = isD ? q.head.len * k : eye.c[2] * k * 9;
            let R = Math.max(eye.c[2] * k * 2.3, hl * 0.17) * (st.eye || 1); R = Math.min(R, hl * 0.42);
            const ex = T.x + eye.c[0] * k * T.dir, ey = T.y - eye.c[1] * k - R * 0.15;
            if (R < 1.1) { g.fillStyle = ink; g.beginPath(); g.arc(ex, ey, Math.max(0.7, R), 0, TAU); g.fill(); }
            else {
              const id = isD ? a.id : 3, asleep = isD && it.state === 'rest' && a.crouch > 0.5, blink = asleep || fract((t + id * 1.37) / (2.6 + hash(id, 9) * 2)) < 0.045;
              const el = Math.max(0.6, Math.min(lw * 0.8, R * 0.3));
              if (blink) { g.fillStyle = pal.body; g.strokeStyle = ink; g.lineWidth = el; g.beginPath(); g.arc(ex, ey, R, 0, TAU); g.fill(); g.beginPath(); g.arc(ex, ey - R * 0.2, R * 0.8, 0.25, PI - 0.25); g.stroke(); }
              else {
                g.fillStyle = '#ffffff'; g.strokeStyle = ink; g.lineWidth = el; g.beginPath(); g.arc(ex, ey, R, 0, TAU); g.fill(); g.stroke();
                const look = isD ? clamp(a.headTo, -1, 1) : 0, px = ex + ds * R * 0.3, py = ey - look * R * 0.18 + R * 0.05, pr = R * (st.young ? 0.62 : 0.52);
                g.fillStyle = '#1a1414'; g.beginPath(); g.arc(px, py, pr, 0, TAU); g.fill();
                if (R > 2.2) { g.fillStyle = '#ffffff'; g.beginPath(); g.arc(px - pr * 0.3, py - pr * 0.35, pr * 0.34, 0, TAU); g.fill(); }
                if (st.brow && isD && a.sp.diet !== 'herbivore' && a.sp.len > 3 && R > 2) { g.strokeStyle = ink; g.lineWidth = Math.max(1, R * 0.34); g.beginPath(); g.moveTo(ex - ds * R * 1.15, ey - R * 1.45); g.lineTo(ex + ds * R * 1.2, ey - R * 0.55); g.stroke(); }
              }
              if (st.cheeks && R > 2) { g.fillStyle = 'rgba(255,120,150,.5)'; g.beginPath(); g.ellipse(ex - ds * R * 0.5, ey + R * 1.55, R * 0.62, R * 0.4, 0, 0, TAU); g.fill(); }
            }
          }
          g.restore();
          if (it.wade) { g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = Math.max(1, lw * 0.7); g.beginPath(); g.ellipse(T.x, it.waterY, Lpx * 0.2, Math.max(1, Lpx * 0.018), 0, 0, TAU); g.stroke(); }

          // lettering, drawn last of all
          if (isD && p.x3 > 0.04 && fade > 0.6 && Hpx > 5) {
            const hx = T.x + q.head.x * k * T.dir, hy = T.y - q.head.y * k;
            if (it.state === 'call' && a.jaw > 0.3) letters.push({ k: 0, x: hx, y: hy, ds, hl: q.head.len * k, txt: word(a.sp), id: a.id, a: clamp((a.jaw - 0.3) * 4), big: clamp(0.55 + Hpx / (h * 0.3), 0.6, 1.25) });
            else if (it.state === 'rest' && a.crouch > 0.6) letters.push({ k: 1, x: hx, y: hy, ds, hl: q.head.len * k, id: a.id });
          }
        };
        S.flyer = S.dino;

        // ------------------------------------------------------------ on top of everything
        S.fx = () => {
          paintFx(f, v);
          if (st.tex === 'blotch') { g.save(); g.globalCompositeOperation = f.combo ? 'source-atop' : 'source-over'; g.globalAlpha = 0.1; g.fillStyle = pat.blotch; g.fillRect(0, 0, w, h); g.restore(); }
          for (const L of letters) {
            if (L.k === 1) {           // a sleeper
              g.fillStyle = st.soft ? '#ffffff' : ink; g.textAlign = 'center'; g.textBaseline = 'middle';
              for (let i = 0; i < 3; i++) { const u = fract(t * 0.35 + i / 3 + L.id * 0.13), fs = h * (0.014 + 0.022 * u) * (0.5 + p.x3);
                g.globalAlpha = Math.sin(u * PI) * 0.9; g.font = `italic 900 ${fs.toFixed(1)}px "Arial Rounded MT Bold","Trebuchet MS",sans-serif`;
                g.fillText(i % 2 ? 'z' : 'Z', L.x + L.ds * L.hl * 0.3 + Math.sin(u * 6 + i) * h * 0.012 + u * h * 0.03, L.y - L.hl * 0.6 - u * h * 0.09); }
              g.globalAlpha = 1; continue;
            }
            const fs = h * 0.05 * (0.45 + p.x3 * 0.95) * L.big; g.font = `italic 900 ${fs.toFixed(1)}px Impact,"Arial Black","Helvetica Neue",sans-serif`;
            const tw = g.measureText(L.txt).width, rx = tw * 0.82 + fs * 0.3, ry = fs * 1.25, pop = L.a * (1 + 0.05 * Math.sin(t * 15 + L.id));
            let cx = L.x + L.ds * (L.hl * 0.9 + rx * 0.55), cy = L.y - L.hl * 0.7 - ry * 0.85;
            cx = clamp(cx, rx * 1.25, w - rx * 1.25); cy = clamp(cy, ry * 1.4, h - ry * 1.4);
            g.save(); g.translate(cx, cy); g.rotate(-0.09 * L.ds); g.scale(pop, pop);
            const il = Math.max(1.2, ow * 1.1);
            if (st.sticker) { starburst(g, 0, 0, rx, ry, 11, 0.2, L.id); g.lineWidth = il * 5; g.strokeStyle = '#fff'; g.stroke(); }
            starburst(g, fs * 0.08, fs * 0.1, rx, ry, 11, 0.2, L.id); g.fillStyle = 'rgba(0,0,0,.25)'; g.fill();
            starburst(g, 0, 0, rx, ry, 11, 0.2, L.id); g.fillStyle = st.pastel > 0.2 ? '#fff7c9' : '#ffe94a'; g.fill(); g.lineWidth = il * 1.6; g.strokeStyle = st.ink; g.lineJoin = 'miter'; g.miterLimit = 3; g.stroke();
            if (st.half) { g.save(); starburst(g, 0, 0, rx, ry, 11, 0.2, L.id); g.clip(); g.globalAlpha = 0.25; g.fillStyle = pat.half; g.fillRect(-rx * 1.3, 0, rx * 2.6, ry * 1.3); g.restore(); }
            g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
            g.lineWidth = Math.max(2, fs * 0.16); g.strokeStyle = st.ink; g.strokeText(L.txt, 0, fs * 0.06);
            g.fillStyle = st.pastel > 0.2 ? '#ff7fa8' : '#f0342c'; g.fillText(L.txt, 0, fs * 0.06);
            g.restore();
          }
          if (st.panel) {            // comic page: gutter, panel border, caption box
            const m = h * 0.022, bl = Math.max(2, h * 0.007);
            g.fillStyle = '#fbf6e6'; g.fillRect(0, 0, w, m); g.fillRect(0, h - m, w, m); g.fillRect(0, 0, m, h); g.fillRect(w - m, 0, m, h);
            g.strokeStyle = '#000'; g.lineWidth = bl; g.lineJoin = 'miter'; g.strokeRect(m, m, w - m * 2, h - m * 2);
            const fs = h * 0.03, ma = era.ma, txt = (ma >= 66.02 ? 'MEANWHILE, ' : 'LATER, ') + (ma >= 99.5 ? Math.round(ma) : ma.toFixed(ma > 66.5 || ma < 65.9 ? 0 : 1)) + ' MILLION YEARS AGO…';
            g.font = `italic 700 ${fs.toFixed(1)}px "Comic Sans MS","Chalkboard SE","Trebuchet MS",sans-serif`; g.textAlign = 'left'; g.textBaseline = 'middle';
            const tw = g.measureText(txt).width, bx = m + bl * 0.5, by = m + bl * 0.5, bh = fs * 1.7;
            g.fillStyle = '#ffe66a'; g.fillRect(bx, by, tw + fs * 1.2, bh); g.lineWidth = bl * 0.7; g.strokeRect(bx, by, tw + fs * 1.2, bh);
            g.fillStyle = '#111'; g.fillText(txt, bx + fs * 0.6, by + bh * 0.54);
            g.lineJoin = 'round';
          }
        };

        paintWorld(f, v, S);
      },
      dispose() { A = B = null; }
    };
  }
};

const S = (id, name, desc, tags, opts, params) => ({ id: 'cartoon-' + id, name, desc, tags: [...tags, '2d'], opts, params });
export const scenes = [
  S('storybook', 'Picture-Book Triceratops', 'A horned-face family ambles over round green hills under a smiling sun.', ['picture book', 'ceratopsian', 'cretaceous', 'family', 'herd'],
    { style: 'picture', cast: [{ sp: 'triceratops', n: 3, young: 2 }], biome: 'plain', seed: 5 }, { stage: 0.855, light: 0.85 }),
  S('cel-rex', 'Cel-Shaded Rex', 'Tyrannosaurus in hard two-tone cel shading with a thick ink line. Click it for a ROAR!', ['cel', 'theropod', 'cretaceous'],
    { style: 'cel', cast: [{ sp: 'tyrannosaurus', n: 1 }], biome: 'uplands', mode: 'wander', seed: 3 }, { stage: 0.855, light: 0.8, activity: 0.7 }),
  S('chibi', 'Kawaii Club-Tails', 'Chibi Ankylosaurus and dome-headed Pachycephalosaurus: baby proportions, pastel colours, rosy cheeks.', ['chibi', 'kawaii', 'ankylosaur', 'pachycephalosaur', 'cretaceous', 'family'],
    { style: 'chibi', cast: [{ sp: 'ankylosaurus', n: 2, young: 1 }, { sp: 'pachycephalosaurus', n: 3 }], biome: 'plain', mode: 'wander', seed: 23 }, { stage: 0.86, light: 0.85 }),
  S('stickers', 'Duck-Bill Sticker Sheet', 'A Parasaurolophus herd as die-cut stickers with white borders on flat pastel paper.', ['sticker', 'ornithopod', 'cretaceous', 'herd'],
    { style: 'sticker', cast: [{ sp: 'parasaurolophus', n: 4, young: 2 }], biome: 'plain', seed: 12, flyers: 2 }, { stage: 0.8, light: 0.9, x1: 0.5 }),
  S('clay', 'Plasticine Long-Necks', 'Brachiosaurus in modelling clay, thumb prints and all, animated in jerky stop motion.', ['clay', 'stop motion', 'sauropod', 'jurassic', 'family'],
    { style: 'clay', cast: [{ sp: 'brachiosaurus', n: 2, young: 1 }], biome: 'forest', mode: 'wander', seed: 17, frame: 0.82 }, { stage: 0.425, light: 0.75, x1: 0.4 }),
  S('crayon', 'Crayon Nest', 'A wax-crayon drawing of Maiasaura mothers and their hatchlings, with outlines that boil.', ['crayon', 'ornithopod', 'cretaceous', 'nest', 'family'],
    { style: 'crayon', cast: [{ sp: 'maiasaura', n: 3, young: 6 }], mode: 'nest', biome: 'plain', seed: 9 }, { stage: 0.795, light: 0.85, herd: 0.55 }),
  S('chase', 'Saturday-Morning Chase', 'Gallimimus bolt from an Albertosaurus in a cloud of dust and speed lines.', ['saturday morning', 'theropod', 'cretaceous', 'hunt', 'herd'],
    { style: 'chase', cast: [{ sp: 'gallimimus', n: 6 }, { sp: 'albertosaurus', n: 1, role: 'pred' }], mode: 'hunt', biome: 'desert', seed: 4 }, { stage: 0.82, light: 0.9, activity: 0.8, x4: 0.7 }),
  S('comic', 'Comic Page: Standoff', 'Allosaurus tests a Stegosaurus herd in halftone dots, inside a panel border.', ['comic', 'halftone', 'theropod', 'stegosaur', 'jurassic', 'hunt'],
    { style: 'comic', cast: [{ sp: 'stegosaurus', n: 3, young: 1 }, { sp: 'allosaurus', n: 1, role: 'pred' }], mode: 'hunt', biome: 'plain', seed: 14 }, { stage: 0.43, light: 0.7, activity: 0.65, x3: 0.7 }),
  S('moon', 'Goodnight, Coelophysis', 'A bedtime picture book of the Triassic: little hunters and Plateosaurus under a sleepy crescent moon.', ['picture book', 'night', 'theropod', 'sauropodomorph', 'triassic', 'herd'],
    { style: 'picture', cast: [{ sp: 'coelophysis', n: 5 }, { sp: 'plateosaurus', n: 2, young: 1 }], biome: 'badlands', mode: 'wander', seed: 2 }, { stage: 0.09, light: 0.06, activity: 0.35 }),
  S('sauropods', 'Diplodocus Parade', 'A cel-cartoon herd of long-necks wades the floodplain with the young in the middle.', ['cel', 'sauropod', 'jurassic', 'herd', 'family'],
    { style: 'cel', cast: [{ sp: 'diplodocus', n: 4, young: 3 }], biome: 'floodplain', seed: 11 }, { stage: 0.42, light: 0.55 }),
  S('deeptime', 'Cartoon Time Machine', 'One storybook valley through the whole age of dinosaurs: the cast changes with the eras, until the sky falls.', ['picture book', 'time travel', 'herd', 'impact'],
    { style: 'picture', cast: 'era', biome: 'plain', seed: 1 }, { stage: 0.02, grow: 0.5 }),
];
