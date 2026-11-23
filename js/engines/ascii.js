// Text Mode: the shared world as characters on a grid. The world is painted twice into tiny off-screen buffers (a few
// pixels per character cell): once as scenery, colour-coded by what each thing is (ground, ridge, plant, rock, water),
// and once for the animals alone, so they can be drawn brighter and on top. Each cell then picks a glyph: line
// characters / \ | _ - from the direction of the animals' outline, denser characters for their fills, quiet marks for
// the scenery. Nine renderings share that: phosphor terminals, ANSI blocks, Braille dots, a Teletext page, a
// typewriter, the DINO-OS database, symbol rain over a skeleton, and animals spelled with their own names.
// Glyphs are cached in an atlas and drawn with drawImage. In a combo, empty sky cells draw nothing at all.
import { createWorld } from '../world.js';
import { paintWorld, drawParts, palette, groundRGB } from '../draw.js';
import { PLANTS } from '../flora.js';
import { SPECIES } from '../species.js';
import { clamp, lerp, fract, hash } from '../util.js';

const MONO = '"Menlo","SF Mono","Consolas","DejaVu Sans Mono","Courier New",monospace';
const TYPE = '"American Typewriter","Courier New","Courier",monospace';
const GROUND = 1, FAR = 2, PLANT = 3, ROCK = 4, WATER = 5, SUN = 6;
const EDGE = [' ', '|', '/', '\\', '_', '-', '¯', 'o'];
const BLOCKS = '░▒▓█▀▄▌▐';
const ANSI = [[0, 0, 0], [170, 0, 0], [0, 170, 0], [170, 85, 0], [0, 0, 170], [170, 0, 170], [0, 170, 170], [170, 170, 170],
  [85, 85, 85], [255, 85, 85], [85, 255, 85], [255, 255, 85], [85, 85, 255], [255, 85, 255], [85, 255, 255], [255, 255, 255]];
const TT = [[0, 0, 0], [255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255]];
const RAIN = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789Z:=*+<>|';
const css = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

export default {
  id: 'ascii',
  name: 'Text Mode',
  kind: '2d',
  sky: true,
  params: [
    { id: 'x1', label: 'Cell size', value: 0.5, tip: 'Size of the characters: small and fine → big and chunky' },
    { id: 'x2', label: 'Contrast', value: 0.5, tip: 'How hard the animals are driven up the character ramp, and how faint the scenery is' },
    { id: 'x3', label: 'Colour', value: 0.5, tip: 'Phosphor or ink hue in the one-colour styles; colour strength in the others' },
    { id: 'x4', label: 'Screen', value: 0.5, tip: 'Glow, scanlines and uneven strikes (0 is clean)' },
  ],
  create(ctx, opts) {
    const st = { style: opts.style || 'green', W: createWorld(opts), opts, bufs: {}, at: null, lv: new Map(), rec: { id: null, t0: 0 } };
    const draw = STYLES[st.style] || STYLES.green;
    return { render(f) { draw(f, st); } };
  },
};

// ---------------------------------------------------------------- grid, atlas, text
function grid(f, base, aspect = 0.6) {
  const rows = Math.round(clamp(base * lerp(1.5, 0.62, f.p.x1), 10, f.h / 4)), ch = f.h / rows, cw = ch * aspect;
  return { rows, cols: Math.ceil(f.w / cw - 0.02), vis: Math.floor(f.w / cw + 0.02), cw, ch };
}
const full = g => ({ i0: 0, j0: 0, cols: g.cols, rows: g.rows });
function canvasFor(st, key, w, h) {
  let b = st.bufs[key];
  if (!b || b.canvas.width !== w || b.canvas.height !== h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    b = st.bufs[key] = { canvas: c, ctx: c.getContext('2d', { willReadFrequently: key === 'S' || key === 'D' }) };
  }
  return b;
}
// one sheet holds every glyph + colour drawn so far at this cell size; it is rebuilt when the cell or font changes
function useFont(st, g, font, weight = '') {
  const tw = Math.ceil(g.cw) + 2, th = Math.ceil(g.ch) + 2, key = tw + '|' + th + '|' + font + weight;
  if (!st.at || st.at.key !== key) {
    const size = 2048, b = st.at?.b || canvasFor(st, 'atlas', size, size);
    b.ctx.clearRect(0, 0, size, size);
    const px = Math.max(4, Math.min(g.ch * 0.96, g.cw / 0.6 * 1.02));
    st.at = { key, b, tw, th, per: Math.floor(size / tw), cap: Math.floor(size / tw) * Math.floor(size / th), n: 0, map: new Map(), px, font: `${weight} ${px.toFixed(1)}px ${font}`,
      sx: clamp(g.cw / (0.6 * px), 1, 1.6) };
  }
  st.g = g;
}
function tile(st, chr, col) {
  const A = st.at, key = chr + col;
  let t = A.map.get(key);
  if (t) return t;
  if (A.n >= A.cap) { A.b.ctx.clearRect(0, 0, 2048, 2048); A.map.clear(); A.n = 0; }
  const i = A.n++, x = (i % A.per) * A.tw, y = Math.floor(i / A.per) * A.th, c = A.b.ctx, g = st.g, cw = Math.ceil(g.cw), chh = Math.ceil(g.ch);
  c.save(); c.beginPath(); c.rect(x, y, A.tw, A.th); c.clip(); c.fillStyle = col;
  const bi = chr.length === 1 ? BLOCKS.indexOf(chr) : -1;
  if (chr.charCodeAt(0) === 1) {                                   // Braille: \x01 + mask char (2 × 4 dots)
    const m = chr.charCodeAt(1) - 32, dx = g.cw / 2, dy = g.ch / 4, r = Math.max(0.55, Math.min(dx, dy) * 0.36);
    c.beginPath();
    for (let b = 0; b < 8; b++) if (m >> b & 1) { const cx = x + 1 + (b & 1) * dx + dx / 2, cy = y + 1 + (b >> 1) * dy + dy / 2; c.moveTo(cx + r, cy); c.arc(cx, cy, r, 0, 6.2832); }
    c.fill();
  } else if (bi >= 3) {
    const X = x + 1, Y = y + 1, hw = Math.round(g.cw / 2), hh = Math.round(g.ch / 2);
    if (bi === 3) c.fillRect(X, Y, cw, chh); else if (bi === 4) c.fillRect(X, Y, cw, hh); else if (bi === 5) c.fillRect(X, Y + hh, cw, chh - hh);
    else if (bi === 6) c.fillRect(X, Y, hw, chh); else c.fillRect(X + hw, Y, cw - hw, chh);
  } else if (bi >= 0) {                                            // ░ ▒ ▓ as dither patterns
    const q = Math.max(1, Math.round(g.ch / 9));
    for (let yy = 0, r = 0; yy < chh; yy += q, r++) for (let xx = 0, k = 0; xx < cw; xx += q, k++) {
      const on = bi === 0 ? (r & 1) === 0 && ((k + (r >> 1)) & 1) === 0 : bi === 1 ? ((k + r) & 1) === 0 : !((r & 1) === 0 && ((k + (r >> 1)) & 1) === 0);
      if (on) c.fillRect(x + 1 + xx, y + 1 + yy, Math.min(q, cw - xx), Math.min(q, chh - yy));
    }
  } else {
    c.font = A.font; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.translate(x + 1 + g.cw / 2, y + 1 + g.ch / 2 + A.px * 0.04); c.scale(A.sx, 1); c.fillText(chr, 0, 0);
  }
  c.restore();
  t = { x, y }; A.map.set(key, t);
  return t;
}
function put(ctx, st, chr, col, i, j, dy = 0) {
  const A = st.at, t = tile(st, chr, col), g = st.g;
  ctx.drawImage(A.b.canvas, t.x, t.y, A.tw, A.th, Math.round(i * g.cw) - 1, Math.round(j * g.ch + dy) - 1, A.tw, A.th);
}
const cellRect = (ctx, g, i, j, n = 1, m = 1) => { const x = Math.round(i * g.cw), y = Math.round(j * g.ch); ctx.fillRect(x, y, Math.round((i + n) * g.cw) - x, Math.round((j + m) * g.ch) - y); };
function text(ctx, st, i, j, s, col, bg) {
  const g = st.g;
  if (bg) { ctx.fillStyle = bg; cellRect(ctx, g, i, j, s.length); }
  for (let k = 0; k < s.length; k++) if (s[k] !== ' ' && i + k < g.cols + 1) put(ctx, st, s[k], col, i + k, j);
}
// n brightness steps of one colour (cached)
function levels(st, rgb, n = 8, bg = [0, 0, 0]) {
  const key = rgb.join() + n + bg.join();
  let L = st.lv.get(key);
  if (!L) { L = []; for (let i = 0; i < n; i++) { const t = i / (n - 1); L.push(css([lerp(bg[0], rgb[0], t), lerp(bg[1], rgb[1], t), lerp(bg[2], rgb[2], t)])); } if (st.lv.size > 60) st.lv.clear(); st.lv.set(key, L); }
  return L;
}
// rotate a colour's hue by the Colour control (0.5 = as designed); quantised so the atlas stays small
function hue(rgb, x3) {
  const a = Math.round((x3 - 0.5) * 24) / 24 * 5.2;
  if (!a) return rgb;
  const c = Math.cos(a), s = Math.sin(a), [r, g, b] = rgb, k = (1 - c) / 3, q = s * 0.57735;
  return [clamp(r * (c + k) + g * (k - q) + b * (k + q), 0, 255), clamp(r * (k + q) + g * (c + k) + b * (k - q), 0, 255), clamp(r * (k - q) + g * (k + q) + b * (c + k), 0, 255)];
}
function nearest(pal, set, r, g, b) {
  let best = set[0], bd = 1e9;
  for (const i of set) { const c = pal[i], d = (c[0] - r) * (c[0] - r) * 0.9 + (c[1] - g) * (c[1] - g) * 1.2 + (c[2] - b) * (c[2] - b) * 0.8; if (d < bd) { bd = d; best = i; } }
  return best;
}
// push a colour away from grey and up to full brightness, so quantising to a few inks keeps its hue
function vivid(r, g, b, sat, lift = 1) {
  const m = (r + g + b) / 3; r = m + (r - m) * sat; g = m + (g - m) * sat; b = m + (b - m) * sat;
  const mx = Math.max(r, g, b, 1), k = lerp(1, 255 / mx, lift);
  return [clamp(r * k, 0, 255), clamp(g * k, 0, 255), clamp(b * k, 0, 255)];
}
const fmtLen = sp => `${sp.len} m`;
const fmtMass = sp => sp.mass >= 1000 ? `${+(sp.mass / 1000).toFixed(1)} t` : `${sp.mass} kg`;
const period = ma => ma > 201.4 ? 'Triassic' : ma > 145 ? 'Jurassic' : ma >= 66 ? 'Cretaceous' : 'Paleogene';
const when = sp => { const a = period(sp.ma[0]), b = period(sp.ma[1]); return `${sp.ma[0]}-${sp.ma[1]} Ma, ${a === b ? a : a + ' to ' + b}`; };
const maText = E => E.ma >= 100 ? E.ma.toFixed(0) : E.ma.toFixed(1);
function wrap(s, n) {
  const out = []; let line = '';
  for (const w of s.split(' ')) { if (line && (line + ' ' + w).length > n) { out.push(line); line = w; } else line = line ? line + ' ' + w : w; }
  if (line) out.push(line);
  return out;
}

// ---------------------------------------------------------------- the world → two small buffers → per-cell facts
const TONE = { body: 0.8, belly: 0.92, far: 0.45, mark: 0.5, accent: 1, accentFar: 0.6, horn: 1, eye: 0.04, mouth: 0.2, bone: 1, boneFar: 0.55, hole: 0.05 };
const PTONE = { leaf: [PLANT, 150], leaf2: [PLANT, 105], flower: [PLANT, 255], trunk: [ROCK, 90], rock: [ROCK, 170], rock2: [ROCK, 120], egg: [ROCK, 255], bone: [ROCK, 235] };
const closeDown = (ctx, pts, bottom) => { ctx.beginPath(); ctx.moveTo(pts[0][0], bottom); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.lineTo(pts[pts.length - 1][0], bottom); ctx.closePath(); };
const code = (c, v) => `rgb(${clamp(v, 0, 255) | 0},${c * 40},0)`;

// o: { ssx, ssy (samples per cell), natural (animals in their own colours, else tone / id / accent in r / g / b), bones, plants (size factor, 0 = none) }
function sample(f, st, g, R, o = {}) {
  const ssx = o.ssx || 2, ssy = o.ssy || 4, bw = R.cols * ssx, bh = R.rows * ssy, pw = R.cols * g.cw, ph = R.rows * g.ch;
  const S = canvasFor(st, 'S', bw, bh), D = canvasFor(st, 'D', bw, bh), sc = S.ctx, dc = D.ctx;
  const f2 = Object.create(f); f2.w = pw; f2.h = ph; f2.combo = true; f2.ctx = sc;
  const v = st.W.frame(f2), items = [], plantK = o.plants ?? 1;
  sc.setTransform(1, 0, 0, 1, 0, 0); sc.clearRect(0, 0, bw, bh); sc.setTransform(bw / pw, 0, 0, bh / ph, 0, 0);
  paintWorld(f2, v, {
    sky() {}, sun() {}, fx() {},
    far(f, v, l, i) { sc.fillStyle = code(FAR, 90 + 70 * i); closeDown(sc, l.pts, l.bottom); sc.fill(); },
    sea(f, v) { sc.fillStyle = code(WATER, 70); sc.fillRect(0, v.sea.y0, pw, v.sea.y1 - v.sea.y0 + 2); },
    ground(f, v, b) { if (!b.u) { sc.fillStyle = code(FAR, 200); sc.fillRect(0, v.horizon, pw, ph); } sc.fillStyle = code(GROUND, 255 * b.u); closeDown(sc, b.pts, ph + 2); sc.fill(); },
    water(f, v, b) { sc.fillStyle = code(WATER, 130 + 110 * b.u); const n = b.pts.length;
      for (let i = 0; i < n; i++) if (b.wet[i]) { const x0 = i ? (b.pts[i - 1][0] + b.pts[i][0]) / 2 : b.pts[i][0], x1 = i < n - 1 ? (b.pts[i][0] + b.pts[i + 1][0]) / 2 : b.pts[i][0]; sc.fillRect(x0 - 0.5, b.level, x1 - x0 + 1, b.next - b.level + 1); } },
    plant(f, v, it) {
      // tall trees are shrunk to shrubs and big foreground plants thinned, so nothing competes with the animals
      if (!plantK || it.x < -it.k * 14 || it.x > pw + it.k * 14) return;
      const tall = !PLANTS[it.kind]?.low, near = it.fog <= 0.001;
      if (tall && it.fog < 0.06) return;
      const k = it.k * plantK * (tall ? 0.3 : near ? 0.6 : 1);
      drawParts(sc, it.parts, { x: it.x, y: it.y, k, dir: 1 }, { fill: t => { const c = PTONE[t] || PTONE.leaf; return code(c[0], c[1]); }, pupil: false });
    },
    dino(f, v, it) { items.push(it); },
    meteor() { items.push({ type: 'meteor' }); },
  });
  if (!f.combo) {                                                  // our own sun or moon, behind everything
    const s = v.sun; sc.globalCompositeOperation = 'destination-over'; sc.fillStyle = code(SUN, s.moon ? 120 : 255);
    sc.beginPath(); sc.arc(s.x, s.y, s.r * (s.moon ? 1.1 : 1.5), 0, 6.2832); sc.fill();
    if (s.moon) { sc.globalCompositeOperation = 'destination-out'; sc.beginPath(); sc.arc(s.x + s.r * 0.6, s.y - s.r * 0.25, s.r * 1.0, 0, 6.2832); sc.fill(); }
    sc.globalCompositeOperation = 'source-over';
  }
  // the animals alone
  dc.setTransform(1, 0, 0, 1, 0, 0); dc.clearRect(0, 0, bw, bh); dc.setTransform(bw / pw, 0, 0, bh / ph, 0, 0);
  const ids = [null]; let nid = 0;
  for (const it of items) {
    if (it.type === 'meteor') { const m = v.meteor; if (!m) continue;
      const dx = -Math.cos(m.ang) * m.len, dy = -Math.sin(m.ang) * m.len, gr = dc.createLinearGradient(m.x, m.y, m.x + dx, m.y + dy);
      gr.addColorStop(0, o.natural ? 'rgba(255,250,200,1)' : 'rgba(255,248,255,1)'); gr.addColorStop(1, o.natural ? 'rgba(255,120,30,0)' : 'rgba(140,248,255,0)');
      dc.strokeStyle = gr; dc.lineCap = 'round'; dc.lineWidth = m.r * 2.2; dc.beginPath(); dc.moveTo(m.x, m.y); dc.lineTo(m.x + dx, m.y + dy); dc.stroke();
      dc.fillStyle = o.natural ? '#fffbe0' : 'rgb(255,248,255)'; dc.beginPath(); dc.arc(m.x, m.y, m.r * 2.4, 0, 6.2832); dc.fill(); continue; }
    const T = it.T, id = 1 + (nid++ % 30); ids[id] = it.sp;
    dc.globalAlpha = it.fade ?? 1;
    const dim = 1 - (it.fog || 0) * 0.45;
    const look = o.natural ? { pal: palette(it.sp, { light: 1, fog: (it.fog || 0) * 0.3 }) }
      : { fill: (t, q) => `rgb(${(TONE[t] ?? 0.7) * dim * 255 | 0},${id * 8},${t === 'accent' || t === 'accentFar' || q.k === 'horn' ? 255 : 0})`, pupil: false };
    let parts = it.parts;
    if (o.bones && it.type === 'dino') parts = it.bones;
    const go = () => {
      if (o.bones && it.type === 'dino') drawParts(dc, it.parts, T, { fill: () => `rgb(46,${id * 8},0)`, pupil: false, alpha: { mark: 0 } });
      drawParts(dc, parts, T, look);
    };
    if (it.wade) { dc.save(); dc.beginPath(); dc.rect(0, 0, pw, it.waterY); dc.clip(); go(); dc.restore(); } else go();
    dc.globalAlpha = 1;
  }
  // ---- per-cell facts
  const sd = sc.getImageData(0, 0, bw, bh).data, dd = dc.getImageData(0, 0, bw, bh).data, n = R.cols * R.rows;
  let C = st.C;
  if (!C || C.n !== n) C = st.C = { n, cls: new Uint8Array(n), sv: new Float32Array(n), smask: new Uint8Array(n), cov: new Float32Array(n), dal: new Float32Array(n), dv: new Float32Array(n),
    dr: new Float32Array(n), dg: new Float32Array(n), db: new Float32Array(n), did: new Uint8Array(n), acc: new Float32Array(n), dmask: new Uint8Array(n), edge: new Uint8Array(n), hi: new Float32Array(n) };
  const per = ssx * ssy, ay = (g.cw / ssx) / (g.ch / ssy), cnt = new Int16Array(8), vsum = new Float32Array(8);
  const A = (x, y) => x < 0 || y < 0 || x >= bw || y >= bh ? 0 : dd[(x + y * bw) * 4 + 3];
  for (let j = 0, k = 0; j < R.rows; j++) for (let i = 0; i < R.cols; i++, k++) {
    cnt.fill(0); vsum.fill(0);
    let cov = 0, al = 0, r = 0, gg = 0, b = 0, mask = 0, smask = 0, any = 0, idv = 0, idn = -1, hi = 0;
    for (let yy = 0; yy < ssy; yy++) for (let xx = 0; xx < ssx; xx++) {
      const x = i * ssx + xx, y = j * ssy + yy, q = (x + y * bw) * 4, bit = 1 << (yy * ssx + xx);
      if (sd[q + 3] > 128) { smask |= bit; const c = Math.round(sd[q + 1] / 40); if (c > 0 && c < 8) { cnt[c]++; vsum[c] += sd[q]; } }
      const a = dd[q + 3];
      if (a > 12) { any = 1; al += a; r += dd[q] * a; gg += dd[q + 1] * a; b += dd[q + 2] * a; if (a > 110) { cov++; mask |= bit; if (dd[q] > 84) hi++; if (a > idn) { idn = a; idv = dd[q + 1]; } } }
    }
    let c = 0; for (let m = 1; m < 8; m++) if (cnt[m] > cnt[c] || !c && cnt[m]) c = m;
    C.cls[k] = cnt[c] * 2 >= per * 0.75 || (c && cnt[c] >= 2) ? c : 0; C.sv[k] = c ? vsum[c] / cnt[c] / 255 : 0; C.smask[k] = smask;
    C.cov[k] = cov / per; C.dmask[k] = mask; C.edge[k] = 0; C.hi[k] = hi / per;
    if (!any) { C.dal[k] = C.dv[k] = C.acc[k] = 0; C.did[k] = 0; continue; }
    C.dal[k] = al / per / 255; C.dr[k] = r / al; C.dg[k] = gg / al; C.db[k] = b / al; C.dv[k] = r / al / 255; C.acc[k] = b / al / 255; C.did[k] = Math.round(idv / 8);
    if (o.edges === false || cov === per && A(i * ssx - 1, j * ssy + 1) > 200 && A(i * ssx + ssx, j * ssy + 1) > 200 && A(i * ssx, j * ssy - 1) > 200 && A(i * ssx, j * ssy + ssy) > 200) continue;
    // structure tensor of the alpha gradient: the direction of the outline through this cell, even for thin limbs
    let jxx = 0, jyy = 0, jxy = 0, wy = 0;
    for (let yy = 0; yy < ssy; yy++) for (let xx = 0; xx < ssx; xx++) {
      const x = i * ssx + xx, y = j * ssy + yy, gx = (A(x + 1, y) - A(x - 1, y)) / 255, gy = (A(x, y + 1) - A(x, y - 1)) / 255 * ay;
      jxx += gx * gx; jyy += gy * gy; jxy += gx * gy; wy += gy * gy * (yy + 0.5);
    }
    const E = jxx + jyy;
    if (E < 0.25) continue;
    const coh = Math.hypot(jxx - jyy, 2 * jxy) / E, phi = 0.5 * Math.atan2(2 * jxy, jxx - jyy) * 57.2958, ap = Math.abs(phi);
    if (coh < 0.22) C.edge[k] = 7;
    else if (ap < 20) C.edge[k] = 1;
    else if (ap > 60) { const yc = wy / jyy / ssy; C.edge[k] = yc < 0.36 ? 6 : yc < 0.66 ? 5 : 4; }
    else C.edge[k] = phi > 0 ? 2 : 3;
  }
  C.v = v; C.R = R; C.ids = ids; C.sd = sd; C.dd = dd; C.bw = bw; C.bh = bh; C.ssx = ssx; C.ssy = ssy;
  C.lead = v.lead ? v.lead.sp : null;
  // how far the ground texture has scrolled under each row (so its marks move with the camera, with parallax)
  const foot = ph * (st.opts.foot ?? 0.85);
  C.scroll = j => Math.round(v.camX * v.k0 * clamp(((j + 0.5) * g.ch - v.horizon) / (foot - v.horizon), 0.04, 2.5) / g.cw);
  return C;
}

// background: everything in a normal view; in a combo only the cells that hold something, so the sky stays clear
function background(f, st, C, bg) {
  const { ctx, w, h } = f, g = st.g, R = C.R;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  if (!f.combo) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); return; }
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = bg;
  for (let j = 0, k = 0; j < R.rows; j++) { let run = -1;
    for (let i = 0; i <= R.cols; i++, k++) { const on = i < R.cols && (C.cls[k] || C.cov[k] > 0.05 || C.dal[k] > 0.12);
      if (on && run < 0) run = i; else if (!on && run >= 0) { cellRect(ctx, g, R.i0 + run, R.j0 + j, i - run); run = -1; } }
    k--; }
}
// quiet marks for the scenery: [char, brightness 0..1] or null
function sceneGlyph(C, k, i, j, f) {
  const c = C.cls[k]; if (!c) return null;
  const R = C.R, up = j > 0 ? C.cls[k - R.cols] : c, sv = C.sv[k], ii = i + C.scroll(j), h = hash(ii, j * 1.7), h2 = hash(ii * 3.1, j, 5);
  switch (c) {
    case GROUND: { if (!up || up === SUN) return ['_', 0.55]; const d = 0.07 + 0.2 * sv;
      return h < d ? [",.'`:;"[h2 * 6 | 0], 0.3 + 0.3 * sv] : h < d * 2.2 ? ['.', 0.22 + 0.25 * sv] : null; }
    case FAR: return !up || up === SUN ? [h2 < 0.5 ? '^' : h2 < 0.8 ? '-' : '~', 0.4] : h < (sv > 0.7 ? 0.05 : 0.14) ? [h2 < 0.5 ? ':' : '.', 0.22] : null;
    case PLANT: return sv > 0.85 ? ['*', 0.75] : up !== PLANT ? ['Yv"^W'[h2 * 5 | 0], 0.6] : ['|v%:'[h2 * 4 | 0], 0.45];
    case ROCK: return up !== ROCK ? ['n', 0.5] : h < 0.4 ? ['o.O:'[h2 * 4 | 0], 0.35] : null;
    case WATER: { const m = (ii + j * 3 + Math.floor(f.t * 1.5 + h * 2)) & 3; return m < 2 ? ['~', 0.45] : m === 2 ? ['-', 0.35] : null; }
    case SUN: return [sv > 0.7 ? '@' : 'O', 1];
  }
  return null;
}
// the animals: outline characters where the silhouette's edge passes, a ramp by tone inside
const RAMP = ' .:-=+x*#%@';
function animalGlyph(C, k, p) {
  const cov = C.cov[k];
  if (cov < 0.1 && C.dal[k] < 0.14) return null;
  const e = C.edge[k], v = clamp((C.dv[k] - 0.5) * lerp(0.6, 1.5, p.x2) + 0.5);
  if (e && e < 7 && cov < 0.82) return [EDGE[e], 1];
  if (cov < 0.3) return ['.', 0.8];
  if (e === 7 && cov < 0.6) return ['o', 0.9];
  const ch = RAMP[Math.round(v * 10)];
  return ch === ' ' ? null : [ch, 0.55 + 0.45 * v];
}
function stars(f, st, C, col, bright) {
  const v = C.v, R = C.R, g = st.g;
  if (f.combo || v.sun.night < 0.25) return;
  const top = Math.floor(v.horizon / g.ch);
  for (let j = 0; j < Math.min(top, R.rows); j++) for (let i = 0; i < R.cols; i++) {
    const h = hash(i * 1.3, j * 2.1, 3); if (h < 0.972) continue;
    const k = i + j * R.cols; if (C.cls[k] || C.cov[k] > 0) continue;
    const tw = Math.sin(f.clock * (1 + h * 30) + i) > -0.4;
    put(f.ctx, st, h > 0.992 ? (tw ? '*' : '+') : tw ? '.' : ' ', h > 0.992 ? bright : col, R.i0 + i, R.j0 + j);
  }
}
// falling ash after the impact
function ash(f, st, C, col) {
  const v = C.v, R = C.R; if (v.dark < 0.03) return;
  for (let i = 0; i < R.cols; i++) for (let d = 0; d < 2; d++) {
    if (hash(i, d, 7) > v.dark * 0.7) continue;
    const j = Math.floor(fract(f.t * (0.08 + 0.1 * hash(i, d)) + hash(i, d, 3)) * R.rows), k = i + j * R.cols;
    if (C.cov[k] > 0 || f.combo && !C.cls[k]) continue;
    put(f.ctx, st, hash(i, d, 9) < 0.5 ? '.' : ',', col, R.i0 + i, R.j0 + j);
  }
}
function bloom(f, st, amt) {
  if (amt <= 0.02) return;
  const { ctx, w, h } = f, b = canvasFor(st, 'bloom', Math.max(8, w / 5 | 0), Math.max(8, h / 5 | 0)), bc = b.ctx;
  bc.globalCompositeOperation = 'copy'; bc.filter = `blur(${Math.max(1, h / 300)}px)`; bc.drawImage(ctx.canvas, 0, 0, b.canvas.width, b.canvas.height); bc.filter = 'none';
  ctx.save(); ctx.globalCompositeOperation = f.combo ? 'source-atop' : 'lighter'; ctx.globalAlpha = Math.min(1, amt * (f.combo ? 0.45 : 0.8)); ctx.drawImage(b.canvas, 0, 0, w, h); ctx.restore();
}
function scanlines(f, st, amt) {
  if (amt <= 0.02) return;
  const { ctx, w, h } = f, per = Math.max(1, Math.round(h / 240));
  if (!st.scan || st.scanPer !== per) { const c = canvasFor(st, 'scan', 4, per * 2); c.ctx.clearRect(0, 0, 4, per * 2); c.ctx.fillStyle = '#000'; c.ctx.fillRect(0, per, 4, per); st.scan = ctx.createPattern(c.canvas, 'repeat'); st.scanPer = per; }
  ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.globalAlpha = amt * 0.42; ctx.fillStyle = st.scan; ctx.fillRect(0, 0, w, h);
  const y = fract(f.clock * 0.09) * h * 1.4 - h * 0.2, gr = ctx.createLinearGradient(0, y - h * 0.1, 0, y + h * 0.1);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${0.07 * amt})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalAlpha = 1; ctx.fillStyle = gr; ctx.fillRect(0, y - h * 0.1, w, h * 0.2); ctx.restore();
}
const leadLine = (C, f) => C.lead ? `${C.lead.name.toUpperCase()}  LEN ${fmtLen(C.lead)}  MASS ${fmtMass(C.lead)}` : f.era.dinos < 0.5 ? 'NO LARGE DINOSAURS IN VIEW' : 'SCANNING...';

// ---------------------------------------------------------------- phosphor terminals
function terminal(f, st, amber) {
  const { ctx, p } = f, g = grid(f, 46);
  useFont(st, g, MONO);
  const C = sample(f, st, g, full(g)), R = C.R, v = C.v;
  const fg = hue(amber ? [255, 182, 56] : [96, 255, 138], p.x3), L = levels(st, fg, 10, amber ? [26, 12, 2] : [2, 14, 7]);
  background(f, st, C, L[0]);
  const flash = v.flash * 3, sceneGain = lerp(1.25, 0.75, p.x2);
  const lvl = b => L[clamp(Math.round(b * 9), 1, 9)];
  stars(f, st, C, L[4], L[8]);
  for (let j = 0, k = 0; j < R.rows; j++) for (let i = 0; i < R.cols; i++, k++) {
    const a = animalGlyph(C, k, p);
    if (a) { put(ctx, st, a[0], lvl(a[1]), i, j); continue; }
    const s = sceneGlyph(C, k, i, j, f);
    if (s) put(ctx, st, s[0], lvl(Math.min(s[0] === '@' || s[0] === 'O' ? 1 : 0.62, s[1] * 0.78 * sceneGain + flash)), i, j);
  }
  ash(f, st, C, L[4]);
  // status line and prompt
  const E = f.era, bar = ` ${amber ? 'FIELD TELETYPE' : 'MEGA-DINO TRACKER 6.6'}  ${leadLine(C, f)}  ${E.name.toUpperCase()} ${maText(E)} Ma `;
  text(ctx, st, 0, 0, bar.padEnd(g.cols + 1).slice(0, g.cols + 1), L[0], L[9]);
  const cur = fract(f.clock * 1.1) < 0.55 ? '█' : ' ', sp = C.lead;
  const cmd = amber ? `>> ${sp ? `${sp.name}: "${sp.means}". ${sp.where}.` : E.name} ` : `dino:~$ track ${sp ? sp.id : '--all'} --era ${E.id} --state ${v.lead ? (v.hunt && v.hunt !== 'calm' ? v.hunt : v.lead.idle || (v.lead.v > 0.1 ? 'walk' : 'stand')) : 'none'} `;
  text(ctx, st, 0, g.rows - 1, (' ' + cmd.slice(0, g.cols - 3) + cur).padEnd(g.cols + 1), L[9], L[0]);
  bloom(f, st, p.x4 * 1.1); scanlines(f, st, p.x4);
}

// ---------------------------------------------------------------- 16-colour ANSI art
const DIMSET = [1, 2, 3, 6, 7, 8], BRIGHTSET = [1, 3, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
function ansi(f, st) {
  const { ctx, p } = f, g = grid(f, 44);
  useFont(st, g, MONO);
  const C = sample(f, st, g, full(g), { natural: true, edges: false }), R = C.R, v = C.v;
  background(f, st, C, '#000');
  const A = ANSI.map(css), sat = lerp(0.6, 3, p.x3), gr = [0, 0.5, 1].map(u => { const c = groundRGB(f, v, u), q = vivid(c[0], c[1], c[2], 3.5, 0.3); return nearest(ANSI, DIMSET, q[0], q[1], q[2]); });
  if (!f.combo && v.sun.night > 0.25) stars(f, st, C, A[8], A[15]);
  for (let j = 0, k = 0; j < R.rows; j++) for (let i = 0; i < R.cols; i++, k++) {
    const cov = C.cov[k];
    if (cov > 0.1) {
      const q = vivid(C.dr[k], C.dg[k], C.db[k], sat, 0.75), ci = nearest(ANSI, BRIGHTSET, q[0], q[1], q[2]), m = C.dmask[k];
      const lum = (C.dr[k] * 0.3 + C.dg[k] * 0.6 + C.db[k] * 0.1) / 255, top = bits(m & 15), bot = bits(m >> 4), lf = bits(m & 0x55), rt = bits(m & 0xaa);
      let chr;
      if (cov > 0.8) chr = lum * lerp(0.7, 1.5, p.x2) > 0.33 ? '█' : lum * lerp(0.7, 1.5, p.x2) > 0.2 ? '▓' : '▒';
      else if (bot >= 3 && top <= 1) chr = '▄'; else if (top >= 3 && bot <= 1) chr = '▀'; else if (lf >= 3 && rt <= 1) chr = '▌'; else if (rt >= 3 && lf <= 1) chr = '▐';
      else chr = cov > 0.55 ? '▓' : cov > 0.3 ? '▒' : '░';
      put(ctx, st, chr, A[ci], i, j); continue;
    }
    const c = C.cls[k]; if (!c) continue;
    const up = j > 0 ? C.cls[k - R.cols] : c, sv = C.sv[k], ii = i + C.scroll(j), h = hash(ii, j * 1.7), h2 = hash(ii * 3.1, j, 5);
    let chr = null, ci = 8;
    if (c === GROUND) { ci = gr[sv < 0.33 ? 0 : sv < 0.7 ? 1 : 2]; chr = !up ? '▄' : h < 0.08 + 0.3 * sv ? '░' : h < 0.3 + 0.2 * sv ? ".,:;'"[h2 * 5 | 0] : null; if (v.flash > 0.3 && h2 < v.flash) ci = 11; }
    else if (c === FAR) { ci = sv > 0.7 ? gr[0] : sv > 0.5 ? 8 : 4; chr = !up ? '▄' : h < (sv > 0.7 ? 0.2 : 0.55) ? '░' : null; }
    else if (c === PLANT) { if (sv > 0.85) { ci = 5; chr = '*'; } else { ci = 2; chr = up !== PLANT ? (h2 < 0.5 ? '▒' : 'Y') : h2 < 0.6 ? '▓' : '▒'; } }
    else if (c === ROCK) { ci = sv > 0.5 ? 7 : 3; chr = sv > 0.5 ? '▒' : '▓'; }
    else if (c === WATER) { const m = (ii + j * 3 + Math.floor(f.t * 1.5 + h * 2)) & 3; ci = m === 0 ? 6 : 4; chr = m === 3 ? '░' : m === 2 ? '-' : '~'; }
    else if (c === SUN) { ci = sv > 0.7 ? 11 : 15; chr = '█'; }
    if (chr) put(ctx, st, chr, A[ci], i, j);
  }
  ash(f, st, C, A[7]);
  const E = f.era, sp = C.lead, j = g.rows - 1;
  ctx.fillStyle = A[4]; cellRect(ctx, g, 0, j, g.cols + 1);
  text(ctx, st, 1, j, '▌MEGA-DINO BBS▐', A[11]);
  text(ctx, st, 18, j, (sp ? `${sp.name} · "${sp.means}" · ${fmtLen(sp)} · ${fmtMass(sp)} · ` : '') + `${E.name}, ${maText(E)} Ma`, A[15]);
  if (p.x4 > 0.6) scanlines(f, st, (p.x4 - 0.6) * 1.5);
}
const bits = m => { let n = 0; while (m) { n += m & 1; m >>= 1; } return n; };

// ---------------------------------------------------------------- Braille dots, white on blue
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function braille(f, st) {
  const { ctx, p } = f, g = grid(f, 38, 0.5);
  useFont(st, g, MONO);
  const C = sample(f, st, g, full(g), { edges: false }), R = C.R, v = C.v, { sd, dd, bw, bh } = C;
  const bg = hue([18, 52, 158], p.x3), night = v.sun.night;
  background(f, st, C, css([bg[0] * (1 - 0.5 * night), bg[1] * (1 - 0.5 * night), bg[2] * (1 - 0.35 * night)]));
  const white = '#ffffff', pale = css([lerp(bg[0], 255, 0.34), lerp(bg[1], 255, 0.4), lerp(bg[2], 255, 0.5)]);
  const gain = lerp(0.6, 1.5, p.x2), dA = (x, y) => x < 0 || y < 0 || x >= bw || y >= bh ? 0 : dd[(x + y * bw) * 4 + 3];
  const sA = (x, y) => y < 0 ? 255 : y >= bh || x < 0 || x >= bw ? 255 : sd[(x + y * bw) * 4 + 3];
  stars(f, st, C, pale, white);
  for (let j = 0, k = 0; j < R.rows; j++) for (let i = 0; i < R.cols; i++, k++) {
    let m = 0, col = pale;
    if (C.cov[k] > 0 || C.dal[k] > 0.1) {                           // animal: solid outline, tone dithered inside
      col = white;
      for (let b = 0; b < 8; b++) { const x = i * 2 + (b & 1), y = j * 4 + (b >> 1), q = (x + y * bw) * 4, a = dd[q + 3];
        if (a < 90) continue;
        const edge = dA(x - 1, y) < 90 || dA(x + 1, y) < 90 || dA(x, y - 1) < 90 || dA(x, y + 1) < 90;
        if (edge || clamp((dd[q] / 255 - 0.5) * gain + 0.5) * 17 > BAYER[(x & 3) + (y & 3) * 4] + 1) m |= 1 << b; }
      if (!m) m = 1 << (C.dmask[k] ? 0 : 3);
    } else if (C.cls[k]) {
      const sx = C.scroll(j) * 2;
      for (let b = 0; b < 8; b++) { const x = i * 2 + (b & 1), y = j * 4 + (b >> 1), q = (x + y * bw) * 4;
        if (sd[q + 3] < 128) continue;
        const c = Math.round(sd[q + 1] / 40), val = sd[q] / 255, top = sA(x, y - 1) < 128, X = x + sx;
        let d = 0;
        if (c === GROUND) d = top ? 1 : 0.03 + 0.07 * val; else if (c === FAR) d = top ? 1 : val > 0.7 ? 0.02 : 0.07; else if (c === PLANT) d = 0.4; else if (c === ROCK) d = 0.25;
        else if (c === WATER) d = (y & 3) === 1 && ((X + (y >> 2) * 3 + Math.floor(f.t * 2)) & 7) < 5 ? 1 : 0; else if (c === SUN) d = 1;
        if (d >= 1 || d * 16 > BAYER[(X & 3) + (y & 3) * 4] + (hash(X, y) < 0.5 ? 0 : 0.6)) m |= 1 << b; }
      if (C.cls[k] === SUN) col = white;
    }
    if (m) put(ctx, st, '\x01' + String.fromCharCode(32 + m), col, i, j);
  }
  ash(f, st, C, pale);
  const E = f.era, sp = C.lead, s = ` ${sp ? `${sp.name} · ${fmtLen(sp)} · ${sp.group}` : E.name} · ${maText(E)} Ma `, j = g.rows - 2;
  text(ctx, st, 1, j, s.slice(0, g.cols - 2), css(bg), white);
  if (p.x4 > 0.6) scanlines(f, st, (p.x4 - 0.6) * 1.2);
}

// ---------------------------------------------------------------- Teletext: 2 × 3 mosaics in eight colours
function teletext(f, st) {
  const { ctx, w, p } = f, g = grid(f, 27, 0.8);
  useFont(st, g, MONO, 'bold');
  const top = 3, R = { i0: 0, j0: top, cols: g.cols, rows: g.rows - top - 2 };
  const C = sample(f, st, g, R, { ssx: 2, ssy: 3, natural: true, edges: false, plants: 0.8 }), v = C.v, { sd, dd, bw } = C;
  background(f, st, C, '#000');
  const T = TT.map(css), sat = lerp(0.8, 4, p.x3), gq = (() => { const c = groundRGB(f, v, 0.6), q = vivid(c[0], c[1], c[2], 2.2, 1); return nearest(TT, [1, 2, 3, 6, 7], q[0], q[1], q[2]); })();
  const dx = g.cw / 2, dy = g.ch / 3, paths = TT.map(() => []);
  for (let j = 0, k = 0; j < R.rows; j++) for (let i = 0; i < R.cols; i++, k++) {
    const X = Math.round(i * g.cw), Y = Math.round((j + top) * g.ch);
    if (C.cov[k] > 0.1 || C.dal[k] > 0.2) {
      const q = vivid(C.dr[k], C.dg[k], C.db[k], sat, 1); let ci = nearest(TT, [1, 3, 5, 6, 7, 2], q[0], q[1], q[2]);
      if (ci === gq) ci = gq === 3 ? 7 : gq === 2 ? 3 : ci;
      let any = 0;
      for (let b = 0; b < 6; b++) { const x = i * 2 + (b & 1), y = j * 3 + (b >> 1); if (dd[(x + y * bw) * 4 + 3] > 96) { paths[ci].push(X + (b & 1) * dx, Y + (b >> 1) * dy, dx + 0.6, dy + 0.6); any = 1; } }
      if (!any) paths[ci].push(X, Y + 2 * dy, dx + 0.6, dy + 0.6);
      continue;
    }
    if (!C.cls[k]) continue;
    const sx = C.scroll(j) * 2;
    for (let b = 0; b < 6; b++) { const x = i * 2 + (b & 1), y = j * 3 + (b >> 1), q = (x + y * bw) * 4;
      if (sd[q + 3] < 128) continue;
      const c = Math.round(sd[q + 1] / 40), val = sd[q] / 255, h = hash(x + sx, y * 1.3);
      let ci = -1, sep = true;
      if (c === GROUND) { if (h < 0.3 + 0.3 * val) ci = v.flash > 0.4 ? 3 : gq; } else if (c === FAR) { if (h < 0.5) ci = 4; } else if (c === PLANT) { ci = val > 0.85 ? 5 : gq === 2 ? 6 : 2; sep = false; }
      else if (c === ROCK) { if (h < 0.7) ci = 7; } else if (c === WATER) { ci = ((x + sx + y + Math.floor(f.t * 2)) & 3) === 0 ? 6 : 4; sep = (y % 3) !== 1; } else if (c === SUN) { ci = v.sun.moon ? 7 : 3; sep = false; }
      if (ci < 0) continue;
      const gx = sep ? dx * 0.2 : 0, gy = sep ? dy * 0.2 : 0;                    // separated mosaics for the scenery
      paths[ci].push(X + (b & 1) * dx + gx, Y + (b >> 1) * dy + gy, dx - 2 * gx + (sep ? 0 : 0.6), dy - 2 * gy + (sep ? 0 : 0.6)); }
  }
  for (let c = 1; c < 8; c++) { const P = paths[c]; if (!P.length) continue; ctx.fillStyle = T[c]; ctx.beginPath(); for (let i = 0; i < P.length; i += 4) ctx.rect(P[i], P[i + 1], P[i + 2], P[i + 3]); ctx.fill(); }
  // page furniture: header row, a double-height title, a caption and the coloured Fastext keys
  const E = f.era, sp = C.lead, page = 'P' + Math.round(E.ma), d = new Date(2000, 0, 1, 0, 0, Math.floor(f.t) % 86400), clockS = d.toTimeString().slice(0, 8);
  ctx.fillStyle = '#000'; cellRect(ctx, g, 0, 0, g.cols + 1, 1); cellRect(ctx, g, 0, g.rows - 2, g.cols + 1, 2);
  text(ctx, st, 1, 0, page, T[7]); text(ctx, st, 6, 0, 'DINOFAX', T[3]); text(ctx, st, 15, 0, `${maText(E)} Ma`, T[6]); text(ctx, st, g.vis - 9, 0, clockS, T[7]);
  ctx.fillStyle = T[4]; cellRect(ctx, g, 0, 1, g.cols + 1, 2);
  const title = E.name.toUpperCase();
  ctx.save(); ctx.font = st.at.font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = T[3];
  for (let i = 0; i < title.length; i++) { ctx.setTransform(st.at.sx, 0, 0, 2, (2 + i + 0.5) * g.cw, 2 * g.ch + st.at.px * 0.08); ctx.fillText(title[i], 0, 0); }
  ctx.restore();
  if (g.vis - title.length - 5 > E.span.length) text(ctx, st, g.vis - E.span.length - 1, 2, E.span, T[6]);
  const cap = sp ? `${sp.name}, "${sp.means}", ${fmtLen(sp)} long` : f.era.dinos < 0.5 ? 'No dinosaurs but the birds remain' : '';
  text(ctx, st, 1, g.rows - 2, cap.slice(0, g.cols - 1), T[7]);
  const keys = [['Triassic', 1, 0], ['Jurassic', 2, 0.14], ['Cretaceous', 3, 0.5], ['Impact', 6, 0.88]]; let x = 1;
  for (const [name, c, at] of keys) { const on = E.stage >= at && (at === 0 ? E.stage < 0.14 : at === 0.14 ? E.stage < 0.5 : at === 0.5 ? E.stage < 0.88 : true);
    text(ctx, st, x, g.rows - 1, name, on ? '#000' : T[c], on ? T[c] : null); x += name.length + 2; }
  if (p.x4 > 0.02) scanlines(f, st, p.x4 * 0.7);
}

// ---------------------------------------------------------------- typewriter page
function typewriter(f, st) {
  const { ctx, w, h, p } = f, g = grid(f, 42);
  useFont(st, g, TYPE, 'bold');
  const C = sample(f, st, g, full(g)), R = C.R, v = C.v;
  const paper = [238, 229, 207], ink = hue([30, 28, 40], p.x3), red = [176, 34, 28];
  background(f, st, C, css(paper));
  const K = [0.34, 0.5, 0.72, 0.95].map(a => `rgba(${ink[0] | 0},${ink[1] | 0},${ink[2] | 0},${a})`), RD = [0.6, 0.95].map(a => `rgba(${red[0]},${red[1]},${red[2]},${a})`);
  const un = p.x4, off = chr => (hash(chr.charCodeAt(0), 3) - 0.5) * g.ch * 0.16 * un;
  const strike = (chr, lv, i, j, r) => { const d = hash(i, j, 11); lv = clamp(lv + (d < 0.18 * un * 2 ? -1 : d > 1 - 0.1 * un ? 1 : 0), 0, 3); put(ctx, st, chr, r ? RD[lv > 1 ? 1 : 0] : K[lv], i, j, off(chr)); };
  const sg = lerp(1.3, 0.6, p.x2);
  for (let j = 0, k = 0; j < R.rows; j++) for (let i = 0; i < R.cols; i++, k++) {
    const cov = C.cov[k];
    if (cov >= 0.1 || C.dal[k] >= 0.14) {
      const e = C.edge[k], val = C.dv[k], r = C.acc[k] > 0.5;
      if (e && e < 7 && cov < 0.82) { strike(EDGE[e], 3, i, j, r); continue; }
      if (cov < 0.3) { strike('.', 2, i, j, r); continue; }
      if (r) { strike('X', 3, i, j, 1); strike('M', 2, i, j, 1); }
      else if (val > 0.86) strike(':', 2, i, j);
      else if (val > 0.7) strike(p.x2 > 0.75 ? 'X' : 'x', 2, i, j);
      else if (val > 0.5) { strike('M', 3, i, j); strike('W', 2, i, j); }
      else if (val > 0.3) strike('=', 1, i, j);
      continue;
    }
    const s = sceneGlyph(C, k, i, j, f);
    if (s) strike(s[0], s[0] === '@' ? 2 : s[1] * sg > 0.5 ? 1 : 0, i, j, s[0] === '*');
  }
  ash(f, st, C, K[1]);
  // heading, typed in the top-left corner, with the red half of the ribbon for the name
  const E = f.era, sp = C.lead, l1 = `FIELD NOTES.  ${E.name}, ${maText(E)} million years ago.`, l2 = sp ? `${sp.name}` : '', l3 = sp ? ` "${sp.means}", ${fmtLen(sp)}, ${fmtMass(sp)}. ${sp.where}.` : '';
  const pb = css(paper), put2 = (i, j, s, col) => { ctx.fillStyle = pb; if (f.combo) cellRect(ctx, g, i - 1, j, s.length + 2); for (let q = 0; q < s.length; q++) if (s[q] !== ' ') put(ctx, st, s[q], col, i + q, j, off(s[q])); };
  put2(3, 1, l1.slice(0, g.cols - 5), K[3]);
  if (sp) { put2(3, 2, l2, RD[1]); put2(3, 2, '_'.repeat(l2.length), RD[1]); put2(3 + l2.length, 2, l3.slice(0, g.cols - 5 - l2.length), K[2]); }
  // paper: a soft shade toward the edges and a few fibres, only over what is painted
  ctx.save(); ctx.globalCompositeOperation = 'source-atop';
  const gr = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.75); gr.addColorStop(0, 'rgba(120,90,40,0)'); gr.addColorStop(1, `rgba(120,90,40,${0.1 + 0.12 * un})`);
  ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(110,90,60,0.16)'; for (let i = 0; i < 90 * un; i++) ctx.fillRect(hash(i, 1) * w, hash(i, 2) * h, 1 + hash(i, 3) * h * 0.012, 1);
  ctx.restore();
}

// ---------------------------------------------------------------- DINO-OS: a specimen database
function dinoos(f, st) {
  const { ctx, p } = f, g = grid(f, 38);
  useFont(st, g, MONO);
  const wc = Math.max(20, Math.round(g.vis * 0.6) - 2), R = { i0: 1, j0: 3, cols: wc, rows: g.rows - 6 };
  const C = sample(f, st, g, R), v = C.v, E = f.era;
  const bgc = [8, 14, 40], frame = hue([92, 214, 232], p.x3), lab = hue([255, 196, 72], p.x3), val = [232, 244, 236], an = hue([150, 255, 170], p.x3);
  const BG = css(bgc), FR = css(frame), LB = css(lab), VL = css(val), LA = levels(st, an, 10, bgc), LS = levels(st, frame, 10, bgc);
  // solid everywhere except the open sky inside the window
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  if (f.combo) { ctx.clearRect(0, 0, f.w, f.h); ctx.fillStyle = BG; cellRect(ctx, g, 0, 0, g.cols + 1, R.j0); cellRect(ctx, g, 0, R.j0 + R.rows, g.cols + 1, g.rows - R.j0 - R.rows + 1);
    cellRect(ctx, g, 0, R.j0, R.i0, R.rows); cellRect(ctx, g, R.i0 + R.cols, R.j0, g.cols + 1 - R.i0 - R.cols, R.rows);
    for (let j = 0, k = 0; j < R.rows; j++) for (let i = 0; i < R.cols; i++, k++) if (C.cls[k] || C.cov[k] > 0.05 || C.dal[k] > 0.12) cellRect(ctx, g, R.i0 + i, R.j0 + j);
  } else { ctx.fillStyle = BG; ctx.fillRect(0, 0, f.w, f.h); }
  if (!f.combo && v.sun.night > 0.25) stars(f, st, C, LS[4], LS[8]);
  const sgain = lerp(1.25, 0.75, p.x2);
  for (let j = 0, k = 0; j < R.rows; j++) for (let i = 0; i < R.cols; i++, k++) {
    const a = animalGlyph(C, k, p);
    if (a) { put(ctx, st, a[0], LA[clamp(Math.round(a[1] * 9), 1, 9)], R.i0 + i, R.j0 + j); continue; }
    const s = sceneGlyph(C, k, i, j, f);
    if (s) put(ctx, st, s[0], LS[clamp(Math.round(Math.min(0.6, s[1] * 0.7 * sgain + v.flash * 2) * 9), 1, 9)], R.i0 + i, R.j0 + j);
  }
  ash(f, st, C, LS[4]);
  const sp = C.lead, idx = sp ? SPECIES.indexOf(sp) + 1 : 0;
  // chrome
  text(ctx, st, 0, 0, ` DINO-OS 6.6   SPECIMEN DATABASE   ${String(SPECIES.length)} RECORDS   ${E.name.toUpperCase()}  ${maText(E)} Ma`.padEnd(g.cols + 1).slice(0, g.cols + 1), BG, FR);
  const box = (i0, j0, n, m, title) => {
    const t = `[ ${title} ]`.slice(0, n - 4);
    text(ctx, st, i0, j0, '+' + ('-' + t).padEnd(n - 2, '-') + '+', FR); text(ctx, st, i0 + 2, j0, t, LB);
    text(ctx, st, i0, j0 + m - 1, '+' + '-'.repeat(n - 2) + '+', FR);
    for (let j = 1; j < m - 1; j++) { put(ctx, st, '|', FR, i0, j0 + j); put(ctx, st, '|', FR, i0 + n - 1, j0 + j); }
  };
  box(0, R.j0 - 1, R.cols + 2, R.rows + 2, sp ? `LIVE VIEW: ${sp.name.toUpperCase()}` : 'LIVE VIEW');
  const px = R.cols + 3, pn = g.vis - px, tw = pn - 4;
  if (pn > 14) {
    box(px, R.j0 - 1, pn, R.rows + 2, sp ? `RECORD ${String(idx).padStart(3, '0')}/${String(SPECIES.length).padStart(3, '0')}` : 'RECORD');
    // the record, typed out; it starts again whenever the animal in view changes
    const rec = st.rec, id = sp ? sp.id : 'none';
    if (rec.id !== id) { rec.t0 = rec.id === null ? f.clock - 5 : f.clock; rec.id = id; }
    const lines = [];
    const field = (name, s) => { const L = wrap(String(s), tw - 10); L.forEach((l, i) => lines.push([i ? '' : name, l])); };
    if (sp) {
      field('NAME', sp.name); field('MEANS', `"${sp.means}"`); field('GROUP', sp.group + (sp.plan === 'bird' ? ' (a dinosaur)' : '')); field('LENGTH', fmtLen(sp)); field('MASS', fmtMass(sp) + ` (${sp.mass.toLocaleString('en-US')} kg)`);
      field('WHEN', when(sp)); field('WHERE', sp.where); field('DIET', sp.diet);
      lines.push(['', '']); lines.push(['FACT', '']); for (const l of wrap(sp.fact, tw)) lines.push([null, l]);
    } else {
      lines.push(['STATUS', 'no record']); lines.push(['', '']);
      for (const l of wrap(E.dinos < 0.5 ? 'No large dinosaurs in view. ' + E.text : 'Searching...', tw)) lines.push([null, l]);
    }
    let budget = Math.floor((f.clock - rec.t0) * 60), row = R.j0 + 1, cx = -1, cy = -1;
    for (const [name, s] of lines) {
      if (row >= R.j0 + R.rows - 1 || budget <= 0) break;
      if (name) { const nm = (name + '........').slice(0, 8) + ':'; text(ctx, st, px + 2, row, nm, LB); }
      const shown = s.slice(0, budget), x0 = px + 2 + (name === null ? 0 : 10);
      text(ctx, st, x0, row, shown, VL); budget -= s.length + 4; cx = x0 + shown.length; cy = row; row++;
    }
    if (cy >= 0 && fract(f.clock * 1.2) < 0.55 && cx < px + pn - 1) put(ctx, st, '█', LB, cx, cy);
  }
  const keys = ' F1 HELP  F2 PREV  F3 NEXT  F5 ERA  F7 FIND  F10 QUIT ', state = v.lead ? `STATE: ${(v.lead.idle || (v.lead.v > 0.1 ? 'walk' : 'stand')).toUpperCase()}` : '';
  text(ctx, st, 0, g.rows - 1, (keys + ' '.repeat(Math.max(1, g.vis - 1 - keys.length - state.length)) + state + '  ').slice(0, g.cols + 1), BG, FR);
  text(ctx, st, 1, g.rows - 2, `> SELECT * FROM DINOSAURS WHERE MA = ${maText(E)}`.slice(0, g.cols - 2), LS[6]);
  bloom(f, st, p.x4 * 0.7); scanlines(f, st, p.x4 * 0.8);
}

// ---------------------------------------------------------------- symbol rain over a walking skeleton
function rain(f, st) {
  const { ctx, p } = f, g = grid(f, 62);
  useFont(st, g, MONO);
  const C = sample(f, st, g, full(g), { bones: true, plants: 0, edges: false }), R = C.R, v = C.v;
  const fg = hue([70, 255, 120], p.x3), L = levels(st, fg, 12, [0, 8, 3]), W = levels(st, [240, 255, 244], 10, [fg[0] * 0.45, fg[1] * 0.45, fg[2] * 0.45]);
  background(f, st, C, '#000804');
  if (!f.combo) { ctx.fillStyle = '#000804'; ctx.fillRect(0, 0, f.w, f.h); }
  const t = f.t, trail = R.rows * 0.45, P = R.rows + trail, gain = lerp(0.4, 1.4, p.x2), nG = RAIN.length;
  for (let i = 0; i < R.cols; i++) {
    const s1 = (5 + 9 * hash(i, 1)) / P, o1 = hash(i, 2), s2 = (4 + 7 * hash(i, 3)) / P, o2 = hash(i, 4);
    const h1 = fract(t * s1 + o1) * P, h2 = fract(t * s2 + o2) * P;
    for (let j = 0; j < R.rows; j++) {
      const k = i + j * R.cols, d1 = h1 - j, d2 = h2 - j;
      let b = 0, head = false;
      if (d1 >= 0 && d1 < trail) { b = Math.pow(1 - d1 / trail, 1.6); head = d1 < 1; }
      if (d2 >= 0 && d2 < trail) { const b2 = Math.pow(1 - d2 / trail, 1.6) * 0.8; if (b2 > b) b = b2; head ||= d2 < 1; }
      const sk = clamp(C.hi[k] * gain), c = C.cls[k], body = C.cov[k] > 0.3 || C.dal[k] > 0.3;
      let lv = body ? b * 0.1 + sk : b * 0.3;
      const ground = c === GROUND && !(j > 0 ? C.cls[k - R.cols] : 1) && sk < 0.1;
      if (c === GROUND) lv = lv * 0.7 + (ground ? 0.4 : 0.03);
      if (lv < 0.1) continue;
      const chr = ground ? '=' : RAIN[hash(i, j, Math.floor(t * (sk > 0.2 ? 1.2 : 3) + hash(i, j) * 9)) * nG | 0];
      const col = sk > 0.1 ? W[clamp(Math.round(3 + sk * 6.5 + b), 1, 9)] : L[clamp(Math.round((head && !body ? 0.6 : lv) * 11), 1, 11)];
      put(ctx, st, chr, col, i, j);
    }
  }
  const sp = C.lead, s = sp ? ` ${sp.name.toUpperCase()} // ${fmtLen(sp)} // skeleton ` : ` ${f.era.name.toUpperCase()} `;
  text(ctx, st, 1, g.rows - 2, s.slice(0, g.cols - 2), '#000804', L[10]);
  bloom(f, st, p.x4 * 1.3); if (p.x4 > 0.5) scanlines(f, st, (p.x4 - 0.5) * 1.2);
}

// ---------------------------------------------------------------- big letters: each animal spelled with its own name
function letters(f, st) {
  const { ctx, p } = f, g = grid(f, 30);
  useFont(st, g, MONO, 'bold');
  const C = sample(f, st, g, full(g), { edges: false, plants: 0.8 }), R = C.R, v = C.v;
  const bgc = [14, 14, 24], night = v.sun.night;
  background(f, st, C, css(bgc));
  const LS = levels(st, hue([120, 140, 190], p.x3), 8, bgc), sat = lerp(0.8, 3.2, p.x3), cols = new Map();
  const colOf = sp => { let L = cols.get(sp); if (!L) { const c = sp.c, m = [parseInt(c[0].slice(1, 3), 16) * 0.6 + parseInt(c[3].slice(1, 3), 16) * 0.4, parseInt(c[0].slice(3, 5), 16) * 0.6 + parseInt(c[3].slice(3, 5), 16) * 0.4, parseInt(c[0].slice(5, 7), 16) * 0.6 + parseInt(c[3].slice(5, 7), 16) * 0.4];
    const q = vivid(m[0], m[1], m[2], sat, 1).map(x => Math.round(x / 16) * 16); L = levels(st, q, 8, bgc); cols.set(sp, L); } return L; };
  const FIRE = levels(st, [255, 220, 120], 8, bgc);
  stars(f, st, C, LS[4], LS[7]);
  for (let j = 0, k = 0; j < R.rows; j++) { let run = 0, last = -1;
    for (let i = 0; i < R.cols; i++, k++) {
      if (C.cov[k] >= 0.3) {
        const id = C.did[k], sp = C.ids[id], name = sp ? sp.name.toUpperCase().replace(/[^A-Z]/g, '') : 'ASTEROID';
        if (id !== last) { run = 0; last = id; }
        const n = name.length, rep = Math.floor(run / n), val = clamp((C.dv[k] - 0.5) * lerp(0.6, 1.6, p.x2) + 0.5);
        const lv = clamp(Math.round((0.5 + 0.5 * val) * 7 - (rep & 1) * 1.6), 2, 7);
        put(ctx, st, name[run % n], (sp ? colOf(sp) : FIRE)[lv], i, j); run++; continue;
      }
      last = -1;
      const s = sceneGlyph(C, k, i, j, f);
      if (s) put(ctx, st, s[0], LS[clamp(Math.round(Math.min(0.75, s[1] * 0.9 + v.flash * 2) * 7), 1, 7)], i, j);
    } }
  ash(f, st, C, LS[4]);
  const sp = C.lead, E = f.era, s = sp ? ` ${sp.name.toUpperCase()}: "${sp.means}" · ${fmtLen(sp)} · ${E.name} ` : ` ${E.name} · ${maText(E)} Ma `;
  text(ctx, st, 1, g.rows - 2, s.slice(0, g.cols - 2), css(bgc), sp ? colOf(sp)[7] : LS[7]);
  if (p.x4 > 0.5) bloom(f, st, (p.x4 - 0.5) * 1.2);
}

const STYLES = { green: (f, st) => terminal(f, st, false), amber: (f, st) => terminal(f, st, true), ansi, braille, teletext, typewriter, dinoos, rain, letters };

const S = (id, name, desc, tags, opts, params) => ({ id: 'ascii-' + id, name, desc, tags: ['text', '2d', ...tags], opts, params });
export const scenes = [
  S('terminal', 'Green Screen Rex', 'A Tyrannosaurus in phosphor-green ASCII, close up, with a status line and a blinking cursor.', ['terminal', 'theropod', 'cretaceous'],
    { style: 'green', cast: [{ sp: 'tyrannosaurus', n: 1 }], biome: 'plain', seed: 3, frame: 0.8, nonstop: true }, { stage: 0.855, detail: 0.5 }),
  S('ansi', 'ANSI Standoff', 'Allosaurus tests a Stegosaurus herd in 16-colour block art, as on a 1990s bulletin board.', ['ansi', 'theropod', 'stegosaur', 'jurassic', 'hunt'],
    { style: 'ansi', cast: [{ sp: 'stegosaurus', n: 2, young: 1 }, { sp: 'allosaurus', n: 1, role: 'pred' }], mode: 'hunt', biome: 'plain', seed: 14, frame: 1.45 }, { stage: 0.43, activity: 0.6 }),
  S('braille', 'Braille Long-necks', 'A Diplodocus herd in Braille dots, eight to a cell, white on blue.', ['braille', 'sauropod', 'jurassic', 'herd'],
    { style: 'braille', cast: [{ sp: 'diplodocus', n: 3, young: 2 }], biome: 'floodplain', seed: 11 }, { stage: 0.42, light: 0.7 }),
  S('teletext', 'Dinofax', 'A Teletext page of block mosaics that runs through deep time: the header names the era and the cast changes with it.', ['teletext', 'time travel', 'herd', 'impact'],
    { style: 'teletext', cast: 'era', biome: 'plain', seed: 1 }, { stage: 0.03, grow: 0.5 }),
  S('typewriter', 'Field Notes', 'Crested duck-bills typed in black ink on paper, overstruck for the darks, with the red ribbon for their crests.', ['typewriter', 'ornithopod', 'cretaceous', 'herd', 'coast'],
    { style: 'typewriter', cast: [{ sp: 'parasaurolophus', n: 2, young: 1 }], biome: 'coast', seed: 12, flyers: 2 }, { stage: 0.80, x4: 0.6 }),
  S('dinoos', 'DINO-OS', 'A retro database terminal: an ASCII Ankylosaurus walks in one window while its record types out beside it. Drag Era to load whoever filled its place.', ['terminal', 'ankylosaur', 'cretaceous', 'database'],
    { style: 'dinoos', cast: [{ sp: 'ankylosaurus', n: 1 }], biome: 'uplands', seed: 23, nonstop: true, horizon: 0.5, foot: 0.8 }, { stage: 0.86, detail: 0.4 }),
  S('rain', 'Bone Rain', 'Falling symbols light up where they cross the bones of a walking Triceratops.', ['rain', 'ceratopsian', 'cretaceous', 'skeleton', 'night'],
    { style: 'rain', cast: [{ sp: 'triceratops', n: 1 }], biome: 'plain', seed: 5, frame: 0.72, nonstop: true }, { stage: 0.86, light: 0.1 }),
  S('letters', 'Spelled Out', 'Brachiosaurus drawn with the letters of its own name, over and over.', ['letters', 'sauropod', 'jurassic', 'family'],
    { style: 'letters', cast: [{ sp: 'brachiosaurus', n: 2, young: 1 }], biome: 'forest', seed: 17 }, { stage: 0.425, light: 0.6 }),
  S('amber', 'Ghost Ranch, Night Shift', 'A Coelophysis pack crosses the Triassic badlands under the stars, on an amber teletype.', ['terminal', 'theropod', 'triassic', 'night', 'pack'],
    { style: 'amber', cast: [{ sp: 'coelophysis', n: 5 }], biome: 'badlands', seed: 2 }, { stage: 0.1, light: 0.06, activity: 0.65 }),
];
