// Voxel: block-built dinosaurs on an isometric diorama. Every frame each animal is voxelised from the shared rig:
// the cells inside capsules(pose(…)) fill a small 3D grid (z is sideways, so the animals have real width), the skull,
// plates, sails, frills, crests, horns and spikes are added from the pose as slabs and cones of cells, and each cell is
// coloured from the species' palette (pale belly, markings along the spine, display colours). The exposed cubes are
// then drawn back to front as pre-shaded three-face sprites. The ground is a terraced block of soil with water tiles
// and block plants picked with flora(f.era); it scrolls under the walkers like a conveyor, or sits still while they
// circle it. Nothing here uses world.js: the cast is recast for the Era control with standIn().
import { clamp, lerp, smooth, fract, hash, noise2, rng, sky, daylight, windX } from '../util.js';
import { pose, capsules, gait, size, HEADS, CRESTS, at } from '../rig.js';
import { species, standIn } from '../species.js';
import { flora } from '../flora.js';

const PI = Math.PI, ISO = 0.8;
const FRILL = [[.2, .36], [-.05, .74], [-.3, .84], [-.5, .68], [-.52, .32], [-.34, .04], [0, -.06]];
const hex = c => { const p = parseInt(c.slice(1), 16); return [p >> 16, p >> 8 & 255, p & 255]; };
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const css = (c, a = 1) => `rgba(${clamp(c[0], 0, 255) | 0},${clamp(c[1], 0, 255) | 0},${clamp(c[2], 0, 255) | 0},${a})`;
const sat3 = (c, k) => { const g = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11; return [g + (c[0] - g) * k, g + (c[1] - g) * k, g + (c[2] - g) * k]; };
const mod = (a, n) => ((a % n) + n) % n;
const ih = (i, j, k) => { let n = Math.imul(i * 374761393 + j * 668265263 ^ k * 2147483647, 1274126177); n ^= n >>> 13; n = Math.imul(n, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967296; };

// animal materials (cell value = material + 1)
const BODY = 1, BELLY = 2, MARK = 3, ACC = 4, HORN = 5, EYE = 6, LIMB = 7, MOUTH = 8, ACC2 = 9, TOOTH = 10, NMAT = 10;
// prop and terrain colours (palette indices)
const TRUNK = 0, LEAF = 1, LEAF2 = 2, FLOWER = 3, ROCK = 4, ROCK2 = 5, EGG = 6, BONE = 7, NEST = 8, DEAD = 9, LEAF3 = 10, FLOWER2 = 11, ASH = 12, FIRE = 13, NPROP = 16;
const SPBASE = 16, SPN = NMAT * 2, MAXSP = 12;

// ---------------------------------------------------------------- block plants and props (in prop cubes)
const TALL = ['conifer', 'araucaria', 'ginkgo', 'treefern', 'magnolia', 'palm', 'deadtree'];
const LOW = ['fern', 'horsetail', 'cycad', 'bush', 'flowers', 'stump', 'rock'];
const modelCache = new Map();
function model(kind, variant) {
  const key = kind + variant;
  if (modelCache.has(key)) return modelCache.get(key);
  const R = rng(Math.imul(variant + 3, 2654435761) ^ kind.length * 7919 ^ kind.charCodeAt(0) * 131), m = new Map();
  const put = (x, y, z, c) => { if (y >= 0) m.set(x + ',' + y + ',' + z, [x, y, z, c]); };
  const disc = (y, r, c, c2) => { for (let x = -Math.ceil(r); x <= r; x++) for (let z = -Math.ceil(r); z <= r; z++) if (x * x + z * z <= r * r + 0.6) put(x, y, z, c2 != null && (x + z + y) % 2 ? c2 : c); };
  const cross = (y, r, c, c2, droop = 1) => { put(0, y, 0, c2);
    for (let i = 1; i <= r; i++) { const yy = y - (i === r && r > 1 ? droop : 0), cc = i % 2 ? c : c2; put(i, yy, 0, cc); put(-i, yy, 0, cc); put(0, yy, i, cc); put(0, yy, -i, cc); }
    if (r > 1) { put(1, y, 1, c2); put(-1, y, 1, c2); put(1, y, -1, c2); put(-1, y, -1, c2); } };
  const trunk = (h, c = TRUNK) => { for (let y = 0; y < h; y++) put(0, y, 0, c); };
  switch (kind) {
    case 'fern': cross(0, 1, LEAF, LEAF2, 0); if (variant % 2) { put(0, 1, 0, LEAF); put(1, 0, 1, LEAF2); } else put(-1, 0, -1, LEAF); break;
    case 'horsetail': for (let y = 0; y < 4; y++) put(0, y, 0, y % 2 ? LEAF3 : LEAF); for (let y = 0; y < 2 + variant % 2; y++) put(1, y, 1, y % 2 ? LEAF : LEAF3); put(-1, 0, 0, LEAF3); break;
    case 'bush': for (let x = 0; x < 2; x++) for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) if (y === 0 || R() < 0.7) put(x, y, z, R() < 0.5 ? LEAF : LEAF2); put(-1, 0, 0, LEAF); put(1, 0, 2, LEAF2); break;
    case 'flowers': put(0, 0, 0, LEAF); put(0, 1, 0, FLOWER); put(-1, 0, 1, FLOWER2); put(1, 0, -1, LEAF); put(1, 1, -1, variant % 2 ? FLOWER2 : FLOWER); put(1, 0, 1, LEAF2); break;
    case 'cycad': trunk(2); cross(2, 2, LEAF, LEAF2); put(0, 3, 0, LEAF2); break;
    case 'treefern': { const h = 5 + variant % 3; trunk(h); cross(h, 3, LEAF2, LEAF, 1); put(0, h + 1, 0, LEAF); } break;
    case 'palm': { const h = 6 + variant % 2; trunk(h); cross(h, 3, LEAF, LEAF3, 2); put(2, h - 1, 0, LEAF3); put(-2, h - 1, 0, LEAF3); put(0, h - 1, 2, LEAF3); put(0, h - 1, -2, LEAF3); } break;
    case 'conifer': { const n = 11 + (variant % 3) * 2, R0 = n > 12 ? 3.2 : 2.4; trunk(3);
      for (let i = 0; i < n; i++) { const u = i / (n - 1), r = R0 * (1 - u) * (i % 2 ? 0.72 : 1) + (i < n - 2 ? 0.5 : 0); disc(2 + i, r, i % 2 ? LEAF : LEAF3); } put(0, n + 2, 0, LEAF); } break;
    case 'araucaria': { const h = 11 + (variant % 2) * 2; trunk(h); disc(h - 3, 1.2, LEAF3); disc(h - 2, 2.4, LEAF, LEAF3); disc(h - 1, 3.1, LEAF3, LEAF); disc(h, 2.2, LEAF); disc(h + 1, 1, LEAF2);
      put(1, h - 6, 0, TRUNK); put(2, h - 5, 0, LEAF3); put(-1, h - 7, 0, TRUNK); put(-2, h - 6, 0, LEAF3); } break;
    case 'ginkgo': case 'magnolia': { const h = 3 + variant % 2, c0 = kind === 'ginkgo' ? LEAF2 : LEAF, c1 = kind === 'ginkgo' ? LEAF : LEAF3; trunk(h);
      for (let y = 0; y < 5; y++) { const r = [1.5, 2.3, 2.5, 2, 1][y]; disc(h + y, r, c0, c1); }
      if (kind === 'magnolia') for (const [x, y, z] of [[2, 2, 1], [-1, 4, 0], [1, 3, 2], [-2, 1, 1], [0, 4, 1], [2, 1, -1], [-1, 2, 2]]) put(x, h + y, z, FLOWER); } break;
    case 'deadtree': trunk(6 + variant % 2, DEAD); put(1, 4, 0, DEAD); put(2, 5, 0, DEAD); put(-1, 3, 0, DEAD); put(-2, 4, 0, DEAD); put(0, 5, 1, DEAD); put(0, 6, 2, DEAD); break;
    case 'stump': put(0, 0, 0, DEAD); put(0, 1, 0, TRUNK); put(1, 0, 0, DEAD); if (variant % 2) put(0, 0, 1, TRUNK); break;
    case 'rock': put(0, 0, 0, ROCK); put(1, 0, 0, ROCK2); put(0, 0, 1, ROCK); put(0, 1, 0, ROCK2); if (variant % 2) { put(1, 0, 1, ROCK); put(1, 1, 0, ROCK); put(-1, 0, 0, ROCK2); } break;
    case 'nest': for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) { const d = Math.abs(x) + Math.abs(z), e = Math.max(Math.abs(x), Math.abs(z)); if (d === 4) continue; put(x, 0, z, NEST); if (e === 2) put(x, 1, z, NEST); else if ((x + z + 2) % 2 === 0 || !x && !z) put(x, 1, z, EGG); }
      put(0, 2, 0, EGG); break;
    case 'bones': for (let i = -2; i <= 2; i++) { put(i * 2, 0, 0, BONE); put(i * 2, 1, 0, BONE); put(i * 2, 2, 1, BONE); put(i * 2, 0, 2, BONE); put(i * 2, 1, 2, BONE); put(i * 2 + 1, 0, 1, ASH); } put(5, 0, 1, BONE); put(6, 0, 1, BONE); put(6, 1, 1, BONE); put(-5, 0, 1, BONE); break;
  }
  const cells = [...m.values()].filter(c => !(m.has(c[0] + ',' + (c[1] + 1) + ',' + c[2]) && m.has((c[0] + 1) + ',' + c[1] + ',' + c[2]) && m.has(c[0] + ',' + c[1] + ',' + (c[2] + 1))));
  cells.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
  let x0 = 0, x1 = 1, z0 = 0, z1 = 1, h = 1;
  for (const c of cells) { h = Math.max(h, c[1] + 1); x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0] + 1); z0 = Math.min(z0, c[2]); z1 = Math.max(z1, c[2] + 1); }
  const out = { cells: new Int8Array(cells.flat()), x0, x1, z0, z1, h };
  modelCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------- the engine
export default {
  id: 'voxel',
  name: 'Voxel',
  kind: '2d',
  sky: true,
  params: [
    { id: 'x1', label: 'Block size', value: 0.5, tip: 'How big the cubes are: fine → chunky. Detail makes them finer too' },
    { id: 'x2', label: 'Tilt', value: 0.5, tip: 'Camera height: low and side-on → looking down on the block' },
    { id: 'x3', label: 'Outline', value: 0.4, tip: 'Seams between the cubes' },
    { id: 'x4', label: 'Plants', value: 0.5, tip: 'How thickly the diorama is planted' },
  ],
  create(ctx, opts) {
    const ring = opts.mode === 'ring', NX = opts.nx || (ring ? 13 : 12), NZ = opts.nz || (ring ? 13 : 7), seed = opts.seed || 1, toy = opts.style === 'toy';
    const BT = opts.base ?? 1.5, NC = NX + 1;
    // the cast, one slot per animal
    const slots = [];
    for (const c of opts.cast || [{ sp: 'tyrannosaurus', at: [[0, 0]] }]) {
      const list = c.at || c.ring || c.idle || [[0, 0]];
      list.forEach((a, i) => slots.push({ base: species(c.sp), kind: c.ring ? 'ring' : c.idle ? 'idle' : 'walk', a, i, n: list.length, scale: c.scale || 1, young: c.young || 0, lock: !!c.lock, run: c.run || 0, r: c.r,
        off: hash(slots.length, seed, 3), G: new Uint8Array(4096), cur: null, since: -9, eyes: [] }));
    }
    const midCache = new Map();
    const midOf = sp => { if (!midCache.has(sp.id)) { const q = pose(sp, {}); midCache.set(sp.id, (q.nodes[0].x + q.head.x + q.head.len * Math.cos(q.head.a)) / 2); } return midCache.get(sp.id); };

    // ---- per-frame geometry
    let W = 1, Hh = 1, hx = 4, ux = 4, uy = 2, zx = 4, zy = 2, ch = 4, X0 = 0, Y0 = 0, m = 5, pm = 2, hu = 2.5, v = 0.25, Nvox = 44, scroll = 0, frac = 0, wx0 = 0;
    const PXs = (x, z) => X0 + x * ux - z * zx, PYs = (x, y, z) => Y0 + x * uy + z * zy - y * ch;
    let LT = [[1, 1, 1], [0.8, 0.8, 0.8], [0.6, 0.6, 0.6]];
    const lit = (c, face) => [c[0] * LT[face][0], c[1] * LT[face][1], c[2] * LT[face][2]];

    // ---- palette and sprite atlas
    const PAL = [], EM = [];
    const atl = [0, 1].map(() => { const cv = document.createElement('canvas'); return { cv, g: cv.getContext('2d'), cw: 1, chh: 1, ax: 0, ay: 0, K: 1, n: 0, slot: new Int16Array(SPBASE + SPN * MAXSP) }; });
    let atlKey = '', outline = 0.4;
    const spSlot = new Map();
    function resetAtlas() {
      for (const a of atl) { a.cw = Math.ceil((ux + zx) * a.K) + 4; a.chh = Math.ceil((uy + zy + ch) * a.K) + 4; a.ax = Math.ceil(zx * a.K) + 2; a.ay = Math.ceil(ch * a.K) + 2;
        const cw = a.cw * 16, chh = a.chh * 16; if (a.cv.width !== cw || a.cv.height !== chh) { a.cv.width = cw; a.cv.height = chh; } else a.g.clearRect(0, 0, cw, chh);
        a.n = 0; a.slot.fill(-1); }
      spSlot.clear();
    }
    function sprite(c, pi) {
      const a = atl[c]; let s = a.slot[pi];
      if (s >= 0) return s;
      s = a.slot[pi] = a.n < 255 ? a.n++ : 255;
      const g = a.g, K = a.K, X = hx * K, C = ch * K, ax = ux * K, ay = uy * K, bx = -zx * K, by = zy * K, cx = ax + bx, cy = ay + by, ox = (s % 16) * a.cw + a.ax, oy = (s >> 4) * a.chh + a.ay, col = PAL[pi] || [255, 0, 255];
      g.clearRect(ox - a.ax, oy - a.ay, a.cw, a.chh);
      const face = (fc, pts) => { g.beginPath(); g.moveTo(ox + pts[0], oy + pts[1]); for (let i = 2; i < 8; i += 2) g.lineTo(ox + pts[i], oy + pts[i + 1]); g.closePath();
        g.fillStyle = g.strokeStyle = css(EM[pi] ? col : lit(col, fc)); g.lineWidth = 1; g.fill(); g.stroke(); };
      face(1, [ax, ay - C, cx, cy - C, cx, cy, ax, ay]); face(2, [bx, by - C, cx, cy - C, cx, cy, bx, by]); face(0, [0, -C, ax, ay - C, cx, cy - C, bx, by - C]);
      const ol = outline * clamp((X - 2.5) / 7);
      if (ol > 0.02 && !EM[pi]) {
        g.lineWidth = Math.max(1, X * 0.09); g.lineCap = 'round';
        g.strokeStyle = `rgba(0,0,0,${ol * 0.42})`; g.beginPath(); g.moveTo(ox, oy - C); g.lineTo(ox + ax, oy + ay - C); g.lineTo(ox + ax, oy + ay); g.lineTo(ox + cx, oy + cy); g.lineTo(ox + bx, oy + by); g.lineTo(ox + bx, oy + by - C); g.closePath(); g.stroke();
        g.strokeStyle = `rgba(255,255,255,${ol * 0.22})`; g.beginPath(); g.moveTo(ox + ax, oy + ay - C); g.lineTo(ox + cx, oy + cy - C); g.lineTo(ox + bx, oy + by - C); g.moveTo(ox + cx, oy + cy - C); g.lineTo(ox + cx, oy + cy); g.stroke();
      }
      return s;
    }
    const blit = (c, pi, x, y) => { const a = atl[c], s = sprite(c, pi); ctx.drawImage(a.cv, (s & 15) * a.cw, (s >> 4) * a.chh, a.cw, a.chh, Math.round(x) - a.ax, Math.round(y) - a.ay, a.cw, a.chh); };
    // a species' colours → 20 palette entries (10 materials × 2 shades)
    function spPal(sp, grey) {
      const key = sp.id; let b = spSlot.get(key);
      if (b != null) return b;
      if (spSlot.size >= MAXSP) { atlKey = ''; return SPBASE; }
      b = SPBASE + spSlot.size * SPN; spSlot.set(key, b);
      let [body, belly, mark, acc] = sp.c.map(hex);
      body = sat3(mul3(body, 1.25), 1.15); belly = mul3(belly, 1.1); mark = mul3(mark, 1.1); acc = sat3(mul3(acc, 1.08), 1.15);
      if (toy) { body = sat3(mul3(body, 1.3), 1.6); belly = sat3(mul3(belly, 1.08), 1.3); mark = sat3(mark, 1.4); acc = sat3(mul3(acc, 1.1), 1.5); }
      const base = [body, belly, mix3(body, mark, 0.72), acc, [236, 226, 200], [255, 208, 60], mul3(body, 0.86), [128, 32, 40], mix3(mul3(acc, 0.7), mark, 0.25), [250, 246, 232]];
      for (let i = 0; i < NMAT; i++) { let c = base[i]; if (grey > 0) c = mix3(c, [96, 92, 88], grey);
        PAL[b + i * 2] = c; PAL[b + i * 2 + 1] = i === EYE - 1 || i === TOOTH - 1 ? c : mul3(c, 0.94); EM[b + i * 2] = EM[b + i * 2 + 1] = i === EYE - 1 ? glowEyes : 0;
        for (const a of atl) a.slot[b + i * 2] = a.slot[b + i * 2 + 1] = -1; }
      return b;
    }
    let glowEyes = 0;

    // ---- terrain (heights in units of half a block)
    let lo = 3, hi = 4, river = opts.water === 'river', pond = opts.water === 'pond', backdrop = false, backMax = 3, ringR0 = 0, ringR1 = 0;
    const tH = new Float32Array(NC * NZ), tW = new Uint8Array(NC * NZ), tOff = new Float32Array(NC * NZ), busy = new Uint8Array(NC * NZ);
    const depth = opts.depth || 1, Pr = opts.riverEvery || 13, Wr = opts.riverWide || 5, WSURF = -0.4;
    const inRiver = (wx, bz) => mod(wx + Math.round(1.4 * Math.sin(bz * 0.8 + seed)), Pr) < Wr;
    let cW = 0;
    function column(wx, bz) {     // → height in units; cW set to 1 for water
      cW = 0;
      if (ring) {
        const dc = Math.hypot(wx + 0.5 - NX / 2, bz + 0.5 - NZ / 2);
        if (pond && dc < (opts.pondR || 2.3) + 0.5 * noise2(wx * 0.9 + seed, bz * 0.9)) { cW = 1; return -depth; }
        const e = Math.min(wx, bz), far = toy || dc < ringR1 + 0.7 ? 0 : e < 1 ? 2 : e < 2 ? 1 : 0;
        let h = Math.min(backMax, far + (far && hash(wx, bz, seed) < 0.3 ? 1 : 0));
        if (!h && !toy && (wx >= NX - 1 || bz >= NZ - 1) && hash(wx + 3, bz, seed) < 0.45) h = -1;
        if (!h && !toy && dc > ringR1 + 0.6 && Math.min(wx, bz) > 1 && noise2(wx * 0.5 + seed * 3, bz * 0.5) > 0.74) { cW = 1; return -1; }
        return h;
      }
      if (river && inRiver(wx, bz)) { cW = 1; return -depth; }
      if (bz >= lo && bz <= hi) return 0;
      if (bz < lo) return clamp(Math.floor((lo - bz) * 0.6 + noise2(wx * 0.3 + seed, bz * 0.45) * 2 - 0.55), 0, backMax);
      if (noise2(wx * 0.33 + seed * 2, bz * 0.5 + 4) > 0.7) { cW = 1; return -1; }
      return bz - hi >= 2 && hash(wx, bz, seed) < 0.35 ? -1 : 0;
    }
    // ground (or water surface) height in voxels at a point of the diorama, and the smoothed bed height for the rig
    function topAt(x, z) {
      const bz = Math.floor(z / m), c = Math.floor(x / m + frac);
      if (bz < 0 || bz >= NZ || c < 0 || c >= NC || x < 0 || x > NX * m) return -1e3;
      const i = bz * NC + c;
      return (tW[i] ? WSURF : tH[i]) * hu;
    }
    function bedAt(x, bz) {
      const u = x / m + scroll - 0.5, i = Math.floor(u), t = u - i, a = column(i, bz), b = column(i + 1, bz);
      return lerp(a, b, t * t * (3 - 2 * t)) * hu;
    }

    // ---- voxeliser
    const capA = [], capB = [], polys = [];
    let bx0, bx1, by0, by1, bz0, bz1;
    const ext = (x, y, z, r) => { if (x - r < bx0) bx0 = x - r; if (x + r > bx1) bx1 = x + r; if (y - r < by0) by0 = y - r; if (y + r > by1) by1 = y + r; if (z - r < bz0) bz0 = z - r; if (z + r > bz1) bz1 = z + r; };
    function prims(q) {
      const { sp, P, L, nodes: n, iHip, iSh, iEnd } = q, ft = sp.f, hd = q.head;
      capA.length = capB.length = polys.length = 0; bx0 = by0 = bz0 = 1e9; bx1 = by1 = bz1 = -1e9;
      const cap = (arr, ax, ay, az, bx, by, bz, ra, rb, mat, mode = 0, s0 = 0) => { arr.push(ax, ay, az, bx, by, bz, ra, rb, mat, mode, s0); ext(ax, ay, az, ra + v); ext(bx, by, bz, rb + v); };
      const poly = (pts, z0, hw, mat, o) => { polys.push({ pts, z0, hw, mat, ...o }); const r = (o && o.hwMax) || hw; for (const p of pts) { ext(p[0], p[1], z0, v); ext(p[0], p[1], z0 - r, 0); ext(p[0], p[1], z0 + r, 0); } };
      const thin = 0.5 * v;
      // ---- head: the skull profile from the rig, given width
      const Hd = HEADS[P.headT] || HEADS.theropod, d = hd.len * (P.hd || 1), ca = Math.cos(hd.a), sa = Math.sin(hd.a), e = n[iEnd];
      const M = (lx, ly) => [hd.x + lx * hd.len * ca - ly * d * sa, hd.y + lx * hd.len * sa + ly * d * ca], mp = pl => pl.map(p => M(p[0], p[1]));
      const Wh = Math.max(e.r * 1.05, 0.21 * d) * (P.headT === 'anky' ? 1.4 : P.headT === 'cerat' ? 1.15 : P.headT === 'duck' ? 1.1 : 1);
      const taper = P.headT === 'duck' || P.headT === 'anky' ? 0.8 : P.headT === 'cerat' ? 0.4 : P.headT === 'spino' ? 0.42 : 0.55;
      const lxOf = (x, y) => ((x - hd.x) * ca + (y - hd.y) * sa) / hd.len, lyOf = (x, y) => (-(x - hd.x) * sa + (y - hd.y) * ca) / d;
      const hwHead = (x, y) => Wh * lerp(1, taper, clamp(lxOf(x, y)));
      const jawA = -hd.jaw * 0.62, pv = [0.08, -0.07], cj = Math.cos(jawA), sj = Math.sin(jawA);
      const J = (lx, ly) => { const dx = lx - pv[0], dy = ly - pv[1]; return M(pv[0] + dx * cj - dy * sj, pv[1] + dx * sj + dy * cj); };
      const hcap = (a, b, z0, z1, ra, rb, mat) => { const A = M(a[0], a[1]), B = M(b[0], b[1]); cap(capA, A[0], A[1], z0, B[0], B[1], z1, ra, rb, mat); };
      const meat = Hd.teeth && sp.diet !== 'herbivore';
      if (meat && hd.len / v >= 7) { const [x0, x1] = Hd.teeth, N = Math.max(2, Math.min(Hd.teeth[2], Math.floor((x1 - x0) * hd.len / (2 * v))));
        for (let i = 0; i < N; i++) { const lx = x0 + (i + 0.5) * (x1 - x0) / N, p = M(lx, -0.02), w = Wh * lerp(1, taper, lx) * 0.9; for (const s of [-1, 1]) cap(capA, p[0], p[1], s * w, p[0], p[1], s * w, thin, thin, TOOTH); } }
      if (ft.horns) for (const s of [-1, 1]) { hcap([.43, .4], [.62, .74 * ft.horns + .1], s * Wh * 0.55, s * Wh * 0.72, hd.len * 0.07, hd.len * 0.05, HORN); hcap([.62, .74 * ft.horns + .1], [1.0, 1.02 * ft.horns + .08], s * Wh * 0.72, s * Wh * 0.8, hd.len * 0.05, 0, HORN); }
      if (ft.noseHorn) hcap([.78, .28], [.8, .34 + .42 * ft.noseHorn], 0, 0, hd.len * 0.06, 0, HORN);
      if (ft.frill && ft.frillSpikes) for (let i = 0; i < 5; i++) { const z = (i - 2) / 2 * Wh * 1.3 * ft.frill, k = ft.frill, ky = 0.4 + 0.6 * k, el = 0.5 - Math.abs(i - 2) * 0.08, u = 1 - Math.abs(i - 2) * 0.16; hcap([lerp(0.2, -.46 * k, u), .86 * ky * u], [lerp(0.2, -.46 * k, u) - el * 0.5, .86 * ky * u + el], z, z * 1.45, hd.len * 0.05, 0, HORN); }
      if (P.headT === 'anky') for (const s of [-1, 1]) hcap([.05, .3], [-.12, .44], s * Wh * 0.8, s * Wh * 1.15, hd.len * 0.07, 0, HORN);
      if (Hd.beak) poly(mp(Hd.beak), 0, Wh, HORN, { hwFn: (x, y) => hwHead(x, y) * 1.02, hwMax: Wh * 1.05 });
      if (ft.crest && CRESTS[ft.crest]) { const c = ft.crest, pts = mp(CRESTS[c]), horn = c === 'horns' || c === 'brow' || c === 'nose';
        if (c === 'double' || c === 'horns' || c === 'brow') for (const s of [-1, 1]) poly(pts, s * Wh * 0.6, Math.max(thin, Wh * 0.14), horn ? HORN : ACC);
        else poly(pts, 0, c === 'dome' ? Wh * 0.85 : Math.max(thin, Wh * (c === 'helmet' || c === 'casque' ? 0.3 : 0.2)), horn ? HORN : ACC); }
      if (hd.jaw > 0.05) poly([M(pv[0], pv[1]), M(0.5, 0.02), M(0.98, 0.02), J(0.97, -0.02), J(0.5, -0.04)], 0, Wh, MOUTH, { hwFn: (x, y) => hwHead(x, y) * 0.75, hwMax: Wh });
      poly(mp(Hd.up), 0, Wh, BODY, { hwFn: hwHead, hwMax: Wh, head: 1 });
      poly(Hd.jaw.map(p => J(p[0], p[1])), 0, Wh, BELLY, { hwFn: (x, y) => hwHead(x, y) * 0.9, hwMax: Wh });
      if (ft.frill) { const k = ft.frill, ky = 0.4 + 0.6 * k, Wf = Wh * 1.7 * k, A0 = [0.2, 0.0], B0 = [-0.46 * k, 0.86 * ky], th = Math.max(0.09, 1.3 * v / hd.len);
        const ux = B0[0] - A0[0], uy = B0[1] - A0[1], ul = Math.hypot(ux, uy), px = -uy / ul * th, py = ux / ul * th;
        poly([M(A0[0] - px, A0[1] - py), M(B0[0] - px, B0[1] - py), M(B0[0] + px, B0[1] + py), M(A0[0] + px, A0[1] + py)], 0, Wf, ACC, { hwMax: Wf, rim: 1,
          hwFn: (x, y) => { const u = ((lxOf(x, y) - A0[0]) * ux + (lyOf(x, y) - A0[1]) * uy) / (ul * ul); return Wf * Math.sqrt(Math.max(0.06, 1 - Math.pow((u - 0.52) / 0.6, 2))); } }); }
      q._eye = [M(Hd.eye[0], Hd.eye[1]), Hd.eye[2] * hd.len * (1 + q.young * 0.6) * (P.hd || 1), Wh];
      // ---- things standing on the back
      const stand = (s, h, lean, k) => { const o = at(n, s), c = Math.cos(lean), sn = Math.sin(lean); return { o, bx: o.x + o.nx * o.r * k, by: o.y + o.ny * o.r * k, dx: o.nx * c - o.ny * sn, dy: o.ny * c + o.nx * sn }; };
      const spike = (s, h, w, lean, k, z, zt, mat) => { const g = stand(s, h, lean, k); cap(capA, g.bx, g.by, z, g.bx + g.dx * h, g.by + g.dy * h, zt, w, 0, mat); };
      for (const near of [true, false]) {
        const off = near ? 0 : 0.5, sg = near ? 1 : -1;
        if (ft.plates) { const s0 = iHip * 0.45, s1 = iEnd - 1.5, N = 9;
          for (let i = 0; i < N; i++) { const s = lerp(s0, s1, (i + off) / N), u = (s - s0) / (s1 - s0), bell = Math.pow(Math.sin(PI * clamp(0.08 + u * 0.8)), 1.3), h = L * 0.105 * ft.plates * (0.3 + 0.7 * bell);
            if (ft.backSpikes && s < iHip + 2.5) { const o = at(n, s); spike(s, h * 1.5, h * 0.16, 0.25, 0.6, sg * o.r * 0.3, sg * (o.r * 0.3 + h * 0.5), HORN); continue; }
            const g = stand(s, h, 0, 0.55), o = g.o, w = h * 0.42;
            poly([[g.bx - o.tx * w * 0.55, g.by - o.ty * w * 0.55], [g.bx - o.tx * w + g.dx * h * 0.5, g.by - o.ty * w + g.dy * h * 0.5], [g.bx + g.dx * h * 1.1, g.by + g.dy * h * 1.1], [g.bx + o.tx * w + g.dx * h * 0.5, g.by + o.ty * w + g.dy * h * 0.5], [g.bx + o.tx * w * 0.55, g.by + o.ty * w * 0.55]], sg * Math.max(o.r * 0.3, 0.55 * v), Math.max(thin, L * 0.005), i % 2 ? ACC : ACC2); } }
        if (ft.spikes) for (const u of [0.8, 0.93]) spike(iHip * (1 - u), L * 0.085, L * 0.011, 0.5, 0.3, sg * L * 0.005, sg * L * 0.06, HORN);
        if (ft.neckSpines) for (let i = 0; i < 7; i++) { const s = iSh + 0.6 + i * 0.75 + off * 0.3, o = at(n, s); spike(s, L * 0.06 * (1 - i * 0.07), L * 0.007, near ? 0.5 : 0.3, 0.7, sg * o.r * 0.4, sg * o.r * 0.5, ACC); }
        if (ft.sideSpike) { const o = at(n, iSh - 0.4), dd = L * 0.07 * ft.sideSpike; cap(capA, o.x, o.y, sg * o.r * 0.7, o.x - dd * 0.3, o.y + dd * 0.35, sg * (o.r + dd * 0.85), dd * 0.16, 0, HORN); }
      }
      if (ft.sail) { const s0 = ft.paddleTail ? iHip - 1.5 : iHip - 0.6, s1 = iSh + 0.6, top = [], base = [];
        for (let i = 0; i <= 12; i++) { const u = i / 12, o = at(n, lerp(s0, s1, u)), h = L * 0.135 * ft.sail * Math.pow(Math.sin(PI * u), 0.55); base.push([o.x + o.nx * o.r * 0.5, o.y + o.ny * o.r * 0.5]); top.push([o.x + o.nx * (o.r + h), o.y + o.ny * (o.r + h)]); }
        poly(top.concat(base.reverse()), 0, Math.max(thin, L * 0.004), ACC, { ray: L * 0.05 }); }
      if (ft.paddleTail) { const top = [], base = []; for (let i = 0; i <= 8; i++) { const u = i / 8, o = at(n, iHip * (1 - (0.12 + u * 0.86))), h = L * 0.035 * Math.sin(PI * u) + 0.001; base.push([o.x, o.y]); top.push([o.x + o.nx * (o.r + h), o.y + o.ny * (o.r + h)]); }
        poly(top.concat(base.reverse()), 0, thin, ACC, null); }
      if (ft.tailFan) { const N = iHip * 0.42; let pr = null; for (let i = 0; i <= 6; i++) { const u = i / 6, o = at(n, N * (1 - u)), r = L * 0.022 * ft.tailFan * Math.sin(PI * (0.12 + 0.88 * (1 - u))) + 0.002; if (pr) cap(capA, pr[0], pr[1], pr[2], o.x, o.y, n[0].z * (1 - u), pr[3], r, ACC); pr = [o.x, o.y, n[0].z * (1 - u), r]; } }
      if (ft.quills) for (let u = 0.15; u < 0.8; u += 0.1) { const o = at(n, iHip * (1 - u)); cap(capA, o.x, o.y, 0, o.x + o.nx * (o.r + L * 0.05 * ft.quills) - o.tx * L * 0.02, o.y + o.ny * (o.r + L * 0.05 * ft.quills), 0, thin, thin, ACC); }
      if (ft.scutes) for (let s = iHip * 0.25; s < iEnd - 0.8; s += 0.8) { const o = at(n, s), r = Math.max(0.62 * v, L * 0.017 * ft.scutes);
        cap(capA, o.x + o.nx * o.r, o.y + o.ny * o.r, 0, o.x + o.nx * o.r, o.y + o.ny * o.r, 0, r, r, MARK);
        if (s > iHip - 1) for (const sg of [-1, 1]) cap(capA, o.x + o.nx * o.r * 0.72, o.y + o.ny * o.r * 0.72, sg * o.r * 0.72, o.x, o.y + o.r * 0.72, sg * o.r * 0.72, r, r, MARK); }
      if (ft.club) { const c = n[0], r = L * 0.04 * ft.club; cap(capA, c.x - r * 0.4, c.y, c.z - r * 0.5, c.x - r * 0.4, c.y, c.z + r * 0.5, r, r, HORN); }
      for (const g of q.arms) { const [S0, E, Wr, Hn] = g.pts;
        if (ft.wings) { const dd = L * 0.1 * ft.wings, an = PI + 0.25 + q.th, c = Math.cos(an), s = Math.sin(an);
          poly([S0, E, Wr, Hn, [Wr[0] + c * dd * 1.25, Wr[1] + s * dd * 1.25], [E[0] + c * dd * 0.9, E[1] + s * dd * 0.9 - dd * 0.12], [S0[0] + c * dd * 0.35, S0[1] + s * dd * 0.35 - dd * 0.1]], g.z * 1.35, thin, ACC, null); }
        if (ft.claws) { const cl = L * 0.085 * ft.claws; for (let i = 0; i < 3; i++) { const an = g.fa - 0.5 - i * 0.22; cap(capA, Hn[0], Hn[1], g.z * 1.1, Hn[0] + Math.cos(an) * cl, Hn[1] + Math.sin(an) * cl, g.z * (1.1 + (i - 1) * 0.25), L * 0.008, 0, HORN); } } }
      // ---- body and limbs
      for (let i = 0; i < n.length - 1; i++) { const A = n[i], B = n[i + 1], ba = A.b ?? A.r, bb = B.b ?? B.r;
        cap(capB, A.x, A.y - (ba - A.r) / 2, A.z, B.x, B.y - (bb - B.r) / 2, B.z, (A.r + ba) / 2, (B.r + bb) / 2, BODY, 1, i); }
      for (const c of capsules(q)) if (c[8] === 1) cap(capB, c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], LIMB);
    }
    function voxelise(A, q) {
      prims(q);
      const { sp, iHip, iSh, iEnd } = q, pat = sp.pat, cy = Math.cos(A.yaw), sy = Math.sin(A.yaw), iv = 1 / v;
      let ox = 1e9, oz = 1e9, x1 = -1e9, z1 = -1e9;
      for (const [x, z] of [[bx0, bz0], [bx1, bz0], [bx0, bz1], [bx1, bz1]]) { const X = (x * cy - z * sy) * iv, Z = (x * sy + z * cy) * iv; ox = Math.min(ox, X); x1 = Math.max(x1, X); oz = Math.min(oz, Z); z1 = Math.max(z1, Z); }
      // snap the grid to the animal's own origin so the cells do not crawl as it stands or scrolls
      ox = Math.floor(ox) - 1; oz = Math.floor(oz) - 1; const oy = Math.floor(by0 * iv) - 1;
      const GX = Math.min(260, Math.ceil(x1 - ox) + 2), GZ = Math.min(260, Math.ceil(z1 - oz) + 2), GY = Math.min(200, Math.ceil(by1 * iv - oy) + 2), NN = GX * GY * GZ;
      if (A.G.length < NN) A.G = new Uint8Array(NN + (NN >> 2)); else A.G.fill(0, 0, NN);
      const G = A.G; Object.assign(A, { GX, GY, GZ, ox, oy, oz });
      const put = (x, y, z, mat) => { const i = Math.floor((x * cy - z * sy) * iv - ox), j = Math.floor(y * iv - oy), k = Math.floor((x * sy + z * cy) * iv - oz);
        if (i < 0 || j < 0 || k < 0 || i >= GX || j >= GY || k >= GZ) return; const id = (k * GX + i) * GY + j; if (!G[id]) G[id] = mat; };
      const sper = Math.max(1.3, 4.4 * v / (q.L * 0.045));
      const bodyMat = (s, dyr, lat) => {
        if (pat === 'saddle') { if (dyr > 0.3 && s > iHip * 0.2) return MARK; }
        else if (pat === 'stripes') { if (s > iHip * 0.15 && s < iSh + 2 && dyr > 0 && fract(s / sper) < 0.4) return MARK; }
        else if (pat === 'bands') { if (s < iHip + 0.5 ? fract(s / Math.max(2, sper * 1.4)) < 0.45 && s > iHip * 0.1 : s < iSh + 1 && dyr > 0.4 && fract(s / Math.max(1.8, sper * 1.3)) < 0.45) return MARK; }
        else if (pat === 'spots') { if (s > iHip * 0.3 && s < iSh + 3 && dyr > -0.1 && hash(Math.floor(s * 1.5), Math.floor(dyr * 2.5) + (lat > 0 ? 9 : 0), 3) < 0.3) return MARK; }
        return dyr < -0.3 && s > iHip * 0.55 ? BELLY : BODY;
      };
      const caps = arr => {
        for (let c = 0; c < arr.length; c += 11) {
          const X0c = (arr[c] * cy - arr[c + 2] * sy) * iv - ox, Y0c = arr[c + 1] * iv - oy, Z0c = (arr[c] * sy + arr[c + 2] * cy) * iv - oz;
          const X1c = (arr[c + 3] * cy - arr[c + 5] * sy) * iv - ox, Y1c = arr[c + 4] * iv - oy, Z1c = (arr[c + 3] * sy + arr[c + 5] * cy) * iv - oz;
          const ra = Math.max(arr[c + 6] * iv, 0.62), rb = Math.max(arr[c + 7] * iv, 0.56), rm = Math.max(ra, rb), mat = arr[c + 8], mode = arr[c + 9], s0 = arr[c + 10];
          const dx = X1c - X0c, dy = Y1c - Y0c, dz = Z1c - Z0c, dd = dx * dx + dy * dy + dz * dz || 1e-9;
          const i0 = Math.max(0, Math.floor(Math.min(X0c, X1c) - rm)), i1 = Math.min(GX - 1, Math.floor(Math.max(X0c, X1c) + rm));
          const j0 = Math.max(0, Math.floor(Math.min(Y0c, Y1c) - rm)), j1 = Math.min(GY - 1, Math.floor(Math.max(Y0c, Y1c) + rm));
          const k0 = Math.max(0, Math.floor(Math.min(Z0c, Z1c) - rm)), k1 = Math.min(GZ - 1, Math.floor(Math.max(Z0c, Z1c) + rm));
          for (let k = k0; k <= k1; k++) { const pz = k + 0.5 - Z0c;
            for (let i = i0; i <= i1; i++) { const px = i + 0.5 - X0c, col = (k * GX + i) * GY, pd = px * dx + pz * dz;
              for (let j = j0; j <= j1; j++) { if (G[col + j]) continue;
                const py = j + 0.5 - Y0c; let t = (pd + py * dy) / dd; t = t < 0 ? 0 : t > 1 ? 1 : t;
                const qx = px - t * dx, qy = py - t * dy, qz = pz - t * dz, r = ra + (rb - ra) * t;
                if (qx * qx + qy * qy + qz * qz < r * r) G[col + j] = mode === 1 ? bodyMat(s0 + t, qy / r, qz * cy - qx * sy) : mat; } } }
        }
      };
      caps(capA);
      const st = 0.5 * v;
      for (const P of polys) {
        const pts = P.pts, np = pts.length; let ax = 1e9, bx = -1e9, ay = 1e9, by = -1e9;
        for (const p of pts) { ax = Math.min(ax, p[0]); bx = Math.max(bx, p[0]); ay = Math.min(ay, p[1]); by = Math.max(by, p[1]); }
        for (let y = ay + st * 0.5; y < by; y += st) for (let x = ax + st * 0.5; x < bx; x += st) {
          let inside = false;
          for (let i = 0, j = np - 1; i < np; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; }
          if (!inside) continue;
          const hw = P.hwFn ? P.hwFn(x, y) : P.hw; let mat = P.mat;
          if (P.ray && fract(x / P.ray) < 0.3) mat = ACC2;
          for (let z = -hw; z <= hw + 1e-6; z += st) { let mm = mat; if (P.rim && Math.abs(z) > hw - v * 1.3) mm = ACC2; put(x, y, P.z0 + z, mm); if (hw < st) break; }
        }
      }
      caps(capB);
      // eyes: the outermost filled cell at the eye, on both sides
      const [ep, er, Wh] = q._eye, big = er > v * 0.75 ? 1 : 0;
      for (const sg of [-1, 1]) for (let b = 0; b <= big; b++) for (let z = Wh * 1.3; z > 0; z -= st) {
        const x = ep[0] + b * v, i = Math.floor((x * cy - sg * z * sy) * iv - ox), j = Math.floor(ep[1] * iv - oy), k = Math.floor((x * sy + sg * z * cy) * iv - oz);
        if (i < 0 || j < 0 || k < 0 || i >= GX || j >= GY || k >= GZ) continue;
        const id = (k * GX + i) * GY + j; if (G[id]) { G[id] = EYE; break; }
      }
    }
    function drawActor(A) {
      const { G, GX, GY, GZ, ox, oy, oz } = A, a = atl[0], cv = a.cv, cw = a.cw, chh = a.chh, slot = a.slot, pal = A.pal - 2, GXY = GX * GY;
      const wxo = A.px + ox, wzo = A.pz + oz, bx = PXs(wxo, wzo) - a.ax, by = PYs(wxo, oy, wzo) - a.ay, alive = A.alive, clip = A.clip;
      A.eyes.length = 0;
      for (let k = 0; k < GZ; k++) for (let i = 0; i < GX; i++) {
        const col = (k * GX + i) * GY, sx = Math.round(bx + i * ux - k * zx), sy0 = by + i * uy + k * zy;
        if (sx < -cw || sx > W) continue;
        let j = 0; if (clip) j = Math.max(0, Math.ceil(topAt(wxo + i + 0.5, wzo + k + 0.5) - oy - 0.5));
        for (; j < GY; j++) {
          const mt = G[col + j]; if (!mt) continue;
          if (j + 1 < GY && G[col + j + 1] && i + 1 < GX && G[col + GY + j] && k + 1 < GZ && G[col + GXY + j]) continue;
          if (alive < 1 && ih(i, j, k) > alive) continue;
          const pi = pal + mt * 2 + ((i * 7 + j * 13 + k * 29) % 5 === 0 ? 1 : 0), sy = Math.round(sy0 - j * ch);
          let s = slot[pi]; if (s < 0) s = sprite(0, pi);
          ctx.drawImage(cv, (s & 15) * cw, (s >> 4) * chh, cw, chh, sx, sy, cw, chh);
          if (mt === EYE) A.eyes.push(sx + a.ax + (ux - zx) / 2, sy + a.ay + (uy + zy - ch) / 2);
        }
      }
    }

    // ---- sky
    function paintSky(f, L, E) {
      const c = f.ctx, w = f.w, h = f.h, dl = daylight(L), q = Math.max(2, Math.round(h / 40));
      { const g = c.createLinearGradient(0, 0, 0, h), T = mix3(mix3([12, 16, 40], [52, 116, 204], dl.day), [64, 72, 140], dl.dusk * 0.7), Bm = mix3(mix3([28, 36, 72], [160, 210, 238], dl.day), [252, 176, 120], dl.dusk * 0.85);
        g.addColorStop(0, css(T)); g.addColorStop(0.6, css(mix3(T, Bm, 0.6))); g.addColorStop(1, css(Bm)); c.fillStyle = g; c.fillRect(0, 0, w, h); }
      if (E.dark > 0) { c.fillStyle = `rgba(40,28,22,${E.dark * 0.75})`; c.fillRect(0, 0, w, h); }
      const a = 1 - E.dark;
      if (dl.night > 0.3) { const u = Math.max(1, Math.round(h / 200)); c.fillStyle = `rgba(255,255,255,${(dl.night - 0.3) * a})`;
        for (let i = 0; i < 80; i++) { const s = hash(i, 5) < 0.15 ? u * 2 : u; c.fillRect(Math.round(hash(i, 1) * w / u) * u, Math.round(hash(i, 2) * h * 0.8 / u) * u, s, s); } }
      const moon = dl.night > 0.5, fx = opts.flip ? -1 : 1;
      const cx = w * (0.5 - fx * (moon ? 0.33 : lerp(0.42, 0.3, L))), cy = h * (moon ? 0.17 : lerp(0.42, 0.13, smooth(0.1, 0.9, L)));
      for (let gy = -5; gy <= 5; gy++) for (let gx = -5; gx <= 5; gx++) {
        const dd = gx * gx + gy * gy; if (dd > 21) continue;
        const halo = dd > 11.5;
        if (halo) c.fillStyle = moon ? `rgba(200,214,255,${0.1 * a})` : `rgba(255,230,170,${0.16 * a})`;
        else if (moon) { const k = hash(gx, gy, 7) < 0.22 ? 0.82 : 1; c.fillStyle = `rgba(${236 * k | 0},${240 * k | 0},${250 * k | 0},${a})`; }
        else c.fillStyle = `rgba(255,${(dd > 6 ? 226 : 240) - dl.dusk * 70 | 0},${(dd > 6 ? 150 : 190) - dl.dusk * 90 | 0},${a})`;
        c.fillRect(Math.round(cx) + gx * q, Math.round(cy) + gy * q, q, q);
      }
      if (dl.night < 0.7) for (let i = 0; i < 4; i++) {       // block clouds
        const x = mod(hash(i, seed, 11) * w * 1.4 + f.t * q * 0.35 * windX(f.p.wind) * (0.6 + hash(i, 3)), w * 1.4) - w * 0.2, y = h * (0.07 + 0.2 * hash(i, seed, 13)), n = 3 + (hash(i, 2) * 3 | 0);
        c.fillStyle = `rgba(${250 - dl.dusk * 10 | 0},${250 - dl.dusk * 40 | 0},${252 - dl.dusk * 70 | 0},${0.8 * (1 - dl.night) * a})`;
        c.fillRect(Math.round(x / q) * q, Math.round(y / q) * q, n * 2 * q, q); c.fillRect(Math.round(x / q) * q + q, Math.round(y / q) * q - q, (n * 2 - 3) * q, q);
      }
    }

    let lastStage = -1, lastEpoch = -1, lastStep = 0, roarAt = -9, jawWas = 0;
    return {
      render(f) {
        const p = f.p, E = f.era, w = f.w, h = f.h, t = f.t;
        W = w; Hh = h; backdrop = !!f.backdrop; backMax = backdrop ? 1 : opts.backMax ?? 3;
        const jump = Math.abs(f.stage - lastStage) > 0.03 || f.epoch !== lastEpoch; lastStage = f.stage; lastEpoch = f.epoch;
        // ---- who is on stage
        const shown = [], nShow = Math.max(1, Math.round(slots.length * Math.min(1, p.herd * 2)));
        slots.forEach((s, i) => {
          if (i >= nShow) return;
          const sp = s.lock ? s.base : standIn(s.base, E.ma);
          if (!sp || sp.kind !== 'walk') { s.cur = null; return; }
          if (sp !== s.cur) { s.since = jump || !s.cur ? -9 : f.clock; s.cur = sp; }
          shown.push(s);
        });
        let F = 0; for (const s of shown) { const z = size(s.cur); s.F = Math.max(z.len * 0.9, z.tall * 1.7) * s.scale * (s.young ? 0.42 : 1); if (!s.young) F = Math.max(F, s.F); }
        if (!F) F = shown.length ? shown[0].F : 8;
        // ---- voxel size and the camera
        Nvox = Math.round(clamp(lerp(26, 84, p.detail) * lerp(1.7, 0.5, p.x1) * (opts.vox || 1), 9, 118 / Math.sqrt(Math.max(1, shown.filter(q => !q.young).length))));
        v = F / Nvox; m = Math.max(2, Math.round(Nvox / (opts.per || 8))); pm = Math.max(1, Math.round(m / 3)); hu = m / 2;
        const phi = lerp(0.36, 0.86, p.x2), th = opts.turn ?? 0.5, kx = Math.cos(th) * 1.13, kz = Math.sin(th) * 1.13, sp_ = Math.sin(phi), c = Math.cos(phi);
        const S = Math.min(w * 0.96 / ((NX * kx + NZ * kz) * m), h * 0.9 / ((NX * kz + NZ * kx) * m * sp_ + (BT * m + Nvox * 0.55) * c)) * lerp(0.8, 1.8, p.scale) * (opts.zoom || 1);
        ux = kx * S; zx = kz * S; uy = kz * S * sp_; zy = kx * S * sp_; ch = c * S; hx = (ux + zx) / 2;
        const lead = shown[0], lrun = lead ? clamp(lead.run + (p.activity - 0.5) * (lead.run ? 0.6 : 0.5)) : 0;
        const act = lerp(0.55, 1.5, p.activity), speed = lead ? gait(lead.cur, lrun, lead.scale).speed * act : 1, D = t * speed;
        scroll = ring ? 0 : D / (v * m) + f.pointer.dragX * -8 + seed * 40; wx0 = Math.floor(scroll); frac = scroll - wx0;
        // ---- place the animals (voxel units; x along the block, z across it)
        const cxv = NX * m * (opts.cx ?? 0.5), czv = NZ * m * (opts.lane ?? (ring ? 0.5 : 0.56));
        let zmin = 1e9, zmax = -1e9, rr0 = 1e9, rr1 = 0;
        for (const s of shown) {
          const sp = s.cur, sc = s.scale * (s.young ? 0.42 : 1), mid = midOf(sp) * sc / v, half = sp.len * sc * (sp.P.rHip * 1.3 + 0.06) / v + 1;
          s.sc = sc;
          if (s.kind === 'ring') { const R = (s.r || opts.ring || 0.6) * Nvox, th = s.a * 2 * PI - D / (R * v) + f.pointer.dragX * 3 + seed;
            s.yaw = th - PI / 2; s.px = cxv + R * Math.cos(th) - Math.cos(s.yaw) * mid; s.pz = czv + R * Math.sin(th) - Math.sin(s.yaw) * mid; rr0 = Math.min(rr0, R - half); rr1 = Math.max(rr1, R + half); }
          else if (s.kind === 'idle') { s.yaw = (s.a[2] || 0) * PI / 180; s.px = cxv + s.a[0] * Nvox - Math.cos(s.yaw) * mid; s.pz = czv + s.a[1] * Nvox - Math.sin(s.yaw) * mid; }
          else { s.yaw = 0; s.px = cxv + s.a[0] * Nvox - mid; s.pz = czv + s.a[1] * Nvox; zmin = Math.min(zmin, s.pz - half); zmax = Math.max(zmax, s.pz + half); }
        }
        if (zmin > zmax) { zmin = czv - m; zmax = czv + m; }
        lo = clamp(Math.floor(zmin / m), 1, NZ - 2); hi = clamp(Math.floor(zmax / m), lo, NZ - 1); ringR0 = rr0 / m; ringR1 = rr1 / m;
        // camera: centre the block, or aim at a point of the lead animal (portraits)
        X0 = w / 2 - (NX * ux - NZ * zx) * m / 2; Y0 = h * (opts.cy ?? 0.56) - (NX * uy + NZ * zy) * m / 2;
        if (opts.aim && lead) { const ax = lead.px + (midOf(lead.cur) * lead.sc + opts.aim[0] * F) / v, ay = opts.aim[1] * F / v; X0 += w / 2 - PXs(ax, lead.pz); Y0 += h * (opts.cy ?? 0.56) - PYs(ax, ay, lead.pz); }
        // ---- light
        const Lg = clamp(p.light) * (1 - 0.72 * E.dark), dl = daylight(Lg), amb = 0.74 + 0.26 * smooth(0, 0.5, Lg);
        const tint = mix3(mix3([1, 1, 1], [1.1, 0.86, 0.64], dl.dusk * 0.8), [0.66, 0.8, 1.16], dl.night * 0.85);
        const fl = E.flash * 0.5;
        LT = [lerp(0.86, 1.07, dl.day) - dl.dusk * 0.1, lerp(0.5, 0.62, dl.day) - dl.dusk * 0.04, lerp(0.66, 0.84, dl.day) + dl.dusk * 0.2].map(k => [k * amb * tint[0] + fl, k * amb * tint[1] + fl * 0.8, k * amb * tint[2] + fl * 0.5]);
        glowEyes = opts.glow !== 0 && dl.night > 0.5 ? 1 : 0;
        outline = p.x3;
        // ---- palette for this moment, and the sprite atlas
        const burnt = clamp(E.dark * 1.2 + (1 - E.dinos) * (1 - E.ferns) * 0.35), fernK = E.ferns;
        const key = [ux.toFixed(2), uy.toFixed(2), zx.toFixed(2), zy.toFixed(2), ch.toFixed(2), pm, (Lg * 80 | 0), (E.flash * 30 | 0), (burnt * 24 | 0), (fernK * 12 | 0), (E.flowers * 8 | 0), (E.dinos * 20 | 0), (E.dry * 12 | 0), (outline * 30 | 0), glowEyes].join('|');
        if (key !== atlKey) {
          atlKey = key; atl[0].K = 1; atl[1].K = pm; resetAtlas();
          const ashC = [104, 100, 96], B = c0 => mix3(toy ? sat3(mul3(c0, 1.1), 1.35) : c0, ashC, burnt * 0.82);
          PAL[TRUNK] = B([104, 76, 50]); PAL[LEAF] = B(mix3([52, 112, 56], [70, 130, 50], fernK)); PAL[LEAF2] = B(mix3([86, 142, 62], [104, 164, 66], fernK)); PAL[LEAF3] = B([36, 88, 60]);
          PAL[FLOWER] = B([238, 150, 190]); PAL[FLOWER2] = B([248, 222, 110]); PAL[ROCK] = B([126, 122, 116]); PAL[ROCK2] = B([160, 156, 146]); PAL[EGG] = [238, 230, 206]; PAL[BONE] = [226, 220, 198];
          PAL[NEST] = B([134, 104, 64]); PAL[DEAD] = mix3([88, 76, 66], [58, 54, 52], burnt); PAL[ASH] = [150, 146, 140]; PAL[FIRE] = [255, 190, 80];
          for (let i = 0; i < NPROP; i++) EM[i] = i === FIRE ? 1 : 0;
        }
        const G = opts.ground || 'earth';
        const dryC = G === 'desert' ? [214, 176, 118] : G === 'red' ? [196, 124, 86] : [188, 150, 100], wetC = G === 'desert' ? [206, 180, 124] : G === 'red' ? [176, 128, 88] : G === 'moss' ? [96, 134, 80] : [122, 142, 84];
        let gC = toy ? [150, 200, 110] : mix3(wetC, dryC, smooth(0.3, 0.7, E.dry));
        gC = mix3(mix3(gC, [108, 104, 100], burnt * 0.85), [84, 138, 70], fernK * 0.55);
        const soilC = mix3(toy ? [196, 150, 100] : [124, 88, 60], [84, 78, 74], burnt * 0.7), stoneC = toy ? [222, 196, 150] : mix3([112, 108, 106], [80, 78, 78], burnt * 0.6);
        const waterC = mix3(toy ? [90, 180, 230] : [58, 138, 186], [74, 82, 90], burnt * 0.75), rockC = mix3([138, 132, 122], [100, 98, 96], burnt);

        // ---- animals: pose, voxelise
        const wet = river && !ring;
        for (const s of shown) {
          const sp = s.cur, G1 = gait(sp, lrun, s.sc), herb = sp.diet === 'herbivore';
          let phase = 0, headTo, jaw = 0, run = lrun;
          const nz = noise2(t * 0.22 + s.off * 31, s.off * 7);
          if (s.kind === 'idle') { const gz = smooth(0.42, 0.62, noise2(t * 0.11 + s.off * 17, 3.1)); headTo = herb ? lerp(0.25 * nz, -1, gz) : lerp(-0.2, 0.5, nz); phase = 0.13 + s.off; run = 0; }
          else { phase = D / G1.stride + s.off * (s === lead ? 0 : 1); headTo = lerp(-0.28, 0.32, nz) + (s.young ? 0.2 : 0) + (sp.group === 'sauropod' ? 0.35 : 0); }
          if (!herb && !s.young) { const k = mod(t + s.off * 40, 9 + s.off * 5); jaw = k < 1.6 ? Math.sin(PI * k / 1.6) : 0.06; }
          if (s === lead) { if (f.pointer.clicks && f.pointer.clicks.length) roarAt = f.clock; const k = f.clock - roarAt; if (k >= 0 && k < 1.4) jaw = Math.max(jaw, Math.sin(PI * k / 1.4)); if (jaw > 0.5 && jawWas <= 0.5 && f.sig) f.sig.roar = 1; jawWas = jaw; if (jaw > 0.3) headTo = Math.max(headTo, 0.3);
            const st = Math.floor(phase * 2); if (st !== lastStep && f.sig && sp.mass > 800 && s.kind !== 'idle') f.sig.step = 1; lastStep = st; }
          const row = clamp(Math.floor(s.pz / m), 0, NZ - 1);
          const q = pose(sp, { phase, run, headTo, jaw, t: t + s.off * 9, scale: s.sc, young: s.young ? 1 : 0, gy: wet ? dx => bedAt(s.px + dx / v, row) * v : undefined });
          s.A = s; s.clip = wet;
          const bird = sp.plan === 'bird';
          s.alive = clamp((f.clock - s.since) / 0.7) * (bird ? 1 : lerp(0.05, 1, E.dinos)) * (bird || E.dinos > 0.02 ? 1 : 0);
          s.pal = spPal(sp, bird ? 0 : (1 - E.dinos) * 0.75 + E.dark * 0.2);
          voxelise(s, q);
          s.x0 = s.px + s.ox + 1; s.x1 = s.px + s.ox + s.GX - 1; s.z0 = s.pz + s.oz + 1; s.z1 = s.pz + s.oz + s.GZ - 1;
          if (s.kind === 'walk') { zmin = Math.min(zmin, s.z0); zmax = Math.max(zmax, s.z1); }
        }
        if (!wet) { lo = clamp(Math.floor(zmin / m), 1, lo); hi = clamp(Math.floor(zmax / m), hi, NZ - 1); }
        if (f.sig) { f.sig.count = clamp(shown.length / 6); f.sig.speed = clamp(speed / 8); }

        // ---- terrain columns for this frame
        busy.fill(0);
        for (let bz = 0; bz < NZ; bz++) for (let cI = 0; cI < NC; cI++) {
          const i = bz * NC + cI; tH[i] = column(wx0 + cI, bz); tW[i] = cW; tOff[i] = 0;
          const bxc = (cI + 0.5 - frac) * m, bzc = (bz + 0.5) * m;
          if (ring) { const dc = Math.hypot(bxc - cxv, bzc - czv) / m; if (dc > ringR0 - 0.6 && dc < ringR1 + 0.6) busy[i] = 1; }
          else if (bz >= lo && bz <= hi) busy[i] = 1;
          for (const s of shown) if (s.kind === 'idle' && bxc > s.x0 - m && bxc < s.x1 + m && bzc > s.z0 - m && bzc < s.z1 + m) busy[i] = 1;
        }

        // ---- draw
        const painted = sky(f, () => paintSky(f, Lg, E));
        if (E.meteor > 0) {       // the asteroid: a block fireball with a tail of cubes
          const q = Math.max(2, Math.round(h / 60)), mx = w * lerp(0.08, 0.7, E.meteor / 1.25), my = h * lerp(0.02, 0.5, E.meteor / 1.25);
          for (let i = 14; i >= 0; i--) { const s = Math.max(1, Math.round(q * (i ? 2.4 - i * 0.14 : 3.4)));
            ctx.fillStyle = i ? `rgba(255,${200 - i * 8},${110 - i * 6},${0.9 - i * 0.055})` : '#fffbe6'; ctx.fillRect(Math.round(mx - i * q * 2.3 - s / 2 + (i ? (hash(i, t * 9 | 0) - 0.5) * q : 0)), Math.round(my - i * q * 1.7 - s / 2), s, s); }
        }
        ctx.save();
        if (opts.flip) { ctx.translate(w, 0); ctx.scale(-1, 1); }
        ctx.lineJoin = 'round';
        const ol = outline * clamp((hx * m - 4) / 10) * 0.3, yBase = -BT * m - hu * depth;
        const quad = (x0, y0, x1, y1, x2, y2, x3, y3, col) => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath(); ctx.fillStyle = ctx.strokeStyle = col; ctx.fill(); ctx.lineWidth = 0.8; ctx.stroke(); };
        // a side wall between heights yt > yb, in strata: turf, soil, stone
        const wall = (xa, za, xb, zb, yt, yb, face, top, off) => {
          const sx0 = PXs(xa, za), sx1 = PXs(xb, zb), ya = xa * uy + za * zy + Y0, yb2 = xb * uy + zb * zy + Y0;
          const band = (t0, t1, col) => { if (t0 - t1 > 0.01) quad(sx0, ya - t0 * ch, sx1, yb2 - t0 * ch, sx1, yb2 - t1 * ch, sx0, ya - t1 * ch, css(lit(col, face))); };
          const y1 = Math.max(yb, yt - 0.3 * m), y2 = Math.max(yb, Math.min(y1, -0.9 * m + off));
          band(yt, y1, mul3(top, 0.86)); band(y1, y2, soilC); band(y2, yb, stoneC);
        };
        for (let bz = 0; bz < NZ; bz++) for (let cI = 0; cI < NC; cI++) {
          if (cI === NX && (ring || frac < 0.004)) continue;
          const i = bz * NC + cI, off = tOff[i], wtr = tW[i], x0 = Math.max(0, (cI - frac) * m), x1 = Math.min(NX * m, (cI + 1 - frac) * m), z0 = bz * m, z1 = z0 + m;
          const yt = (wtr ? WSURF : tH[i]) * hu + off, bot = yBase + off, wx = wx0 + cI;
          let top = wtr ? mix3(waterC, [150, 214, 236], (0.1 + 0.14 * hash(wx, bz, Math.floor(t * 1.6 + hash(wx, bz) * 5))) * (1 - burnt)) : tH[i] >= 3 ? rockC : mul3(gC, ((wx + bz) & 1 ? 0.95 : 1.02) * (1 + tH[i] * 0.03) * (0.96 + 0.08 * hash(wx, bz, 5)));
          if (!wtr && tH[i] < 0) top = mix3(top, soilC, 0.3);
          // neighbours towards the camera decide how much wall shows
          const nx = cI + 1 < NC && !(cI + 1 === NX && (ring || frac < 0.004)) ? i + 1 : -1, nz = bz + 1 < NZ ? i + NC : -1;
          const yx = nx < 0 ? bot : Math.max(bot, (tW[nx] ? WSURF : tH[nx]) * hu + tOff[nx]), yz = nz < 0 ? bot : Math.max(bot, (tW[nz] ? WSURF : tH[nz]) * hu + tOff[nz]);
          if (yx < yt) wall(x1, z0, x1, z1, yt, yx, 1, wtr ? mul3(waterC, 0.9) : top, off);
          if (yz < yt) wall(x0, z1, x1, z1, yt, yz, 2, wtr ? mul3(waterC, 0.9) : top, off);
          ctx.beginPath(); ctx.moveTo(PXs(x0, z0), PYs(x0, yt, z0)); ctx.lineTo(PXs(x1, z0), PYs(x1, yt, z0)); ctx.lineTo(PXs(x1, z1), PYs(x1, yt, z1)); ctx.lineTo(PXs(x0, z1), PYs(x0, yt, z1)); ctx.closePath();
          ctx.fillStyle = ctx.strokeStyle = css(lit(top, 0)); ctx.lineWidth = 0.8; ctx.fill(); ctx.stroke();
          if (ol > 0.01) { ctx.strokeStyle = `rgba(0,0,0,${ol})`; ctx.lineWidth = Math.max(0.6, hx * 0.1); ctx.stroke(); }
        }
        // shadows: one cube-sized patch of shade under every occupied column
        const stp = Math.max(1, pm);
        ctx.beginPath();
        for (const s of shown) { if (s.alive < 0.5) continue; const { G: Gd, GX, GY, GZ } = s;
          for (let k = 0; k < GZ; k += stp) for (let i = 0; i < GX; i += stp) {
            const ii = Math.min(GX - 1, i + (stp >> 1)), kk = Math.min(GZ - 1, k + (stp >> 1)), col = (kk * GX + ii) * GY; let hit = false;
            for (let j = 0; j < GY; j++) if (Gd[col + j]) { hit = true; break; }
            if (!hit) continue;
            const x = s.px + s.ox + i, z = s.pz + s.oz + k, y = topAt(x + stp / 2, z + stp / 2); if (y < -500) continue;
            ctx.moveTo(PXs(x, z), PYs(x, y, z)); ctx.lineTo(PXs(x + stp, z), PYs(x + stp, y, z)); ctx.lineTo(PXs(x + stp, z + stp), PYs(x + stp, y, z + stp)); ctx.lineTo(PXs(x, z + stp), PYs(x, y, z + stp)); ctx.closePath();
          } }
        ctx.fillStyle = `rgba(10,14,30,${0.2 + 0.1 * dl.day})`; ctx.fill();

        // ---- plants and props, chosen per block from the era's flora
        const objs = [], FW = flora(E), dens = (0.2 + 0.6 * p.x4) * (0.6 + 0.6 * p.detail) * (opts.plants ?? 1);
        const pick = (set, r) => { let tot = 0; for (const k of set) tot += FW[k] || 0; if (tot <= 0) return null; r *= tot; for (const k of set) { r -= FW[k] || 0; if (r <= 0) return k; } return set[0]; };
        const prop = (kind, variant, x, y, z, g = 1) => { const md = model(kind, variant); objs.push({ md, x, y, z, g, x0: x + md.x0 * pm, x1: x + md.x1 * pm, z0: z + md.z0 * pm, z1: z + md.z1 * pm }); };
        for (let bz = 0; bz < NZ; bz++) for (let cI = 0; cI < NC; cI++) {
          const i = bz * NC + cI; if (tW[i] || busy[i] || (cI === NX && ring)) continue;
          const xc = cI + 0.5 - frac, grow = ring ? 1 : smooth(0, 1.1, Math.min(xc, NX - xc)); if (grow <= 0.02) continue;
          const wx = wx0 + cI, r = hash(wx, bz, seed + 1), x = (cI + 0.5 - frac) * m - pm / 2, z = (bz + 0.5) * m - pm / 2, y = tH[i] * hu + tOff[i];
          const back = ring ? Math.min(cI, bz) < 2 : bz < lo - 1 || bz === 0;
          const nest = opts.nest && (ring ? cI === (opts.nest[0] ?? NX >> 1) && bz === (opts.nest[1] ?? NZ >> 1) : bz === Math.min(NZ - 1, hi + 1) && mod(wx, opts.nest === true ? 9 : opts.nest) === 3);
          if (nest) { prop('nest', 0, x, y, z, grow); continue; }
          let kind = null;
          if (back && !backdrop && r < dens * (ring ? 1 : 0.7) && !toy) kind = pick(TALL, hash(wx, bz, seed + 2));
          else if (back && !backdrop && r < dens * 0.9) kind = hash(wx, bz, 4) < 0.5 ? 'conifer' : 'ginkgo';
          else if (r < dens * 0.62) kind = pick(LOW, hash(wx, bz, seed + 2));
          if (kind) prop(kind, hash(wx, bz, 9) * 4 | 0, x, y, z, grow);
        }
        for (const s of shown) { objs.push(s);
          if (s.alive < 0.6 && s.cur.plan !== 'bird' && E.dinos < 0.6) prop('bones', 0, s.px + s.GX * 0.3 + s.ox, Math.max(0, topAt(s.px, s.pz)), s.pz - pm); }
        // back-to-front: an object goes first when nothing left must be drawn before it
        const before = (a, c2) => a.x1 <= c2.x0 + 0.01 || a.z1 <= c2.z0 + 0.01;
        objs.sort((a, c2) => (a.x0 + a.x1 + a.z0 + a.z1) - (c2.x0 + c2.x1 + c2.z0 + c2.z1));
        const a1 = atl[1];
        while (objs.length) {
          let pk = 0;
          for (let i = 0; i < objs.length; i++) { let ok = true; const o = objs[i];
            for (let j = 0; j < objs.length; j++) if (j !== i && before(objs[j], o) && !before(o, objs[j])) { ok = false; break; }
            if (ok) { pk = i; break; } }
          const o = objs.splice(pk, 1)[0];
          if (o.md) { const cs = o.md.cells, sx0 = PXs(o.x, o.z), sy0 = PYs(o.x, o.y, o.z), X = hx * pm, C = ch * pm;
            if (sx0 < -X * 12 || sx0 > w + X * 12) continue;
            const sink = o.g < 1 ? Math.ceil((1 - o.g) * o.md.h) : 0;
            for (let i = 0; i < cs.length; i += 4) { if (cs[i + 1] < sink) continue; const s = a1.slot[cs[i + 3]] >= 0 ? a1.slot[cs[i + 3]] : sprite(1, cs[i + 3]);
              ctx.drawImage(a1.cv, (s & 15) * a1.cw, (s >> 4) * a1.chh, a1.cw, a1.chh, Math.round(sx0 + (cs[i] * ux - cs[i + 2] * zx) * pm) - a1.ax, Math.round(sy0 + (cs[i] * uy + cs[i + 2] * zy) * pm - (cs[i + 1] - sink) * C) - a1.ay, a1.cw, a1.chh); } }
          else drawActor(o);
        }

        // ---- ash, glowing eyes, the flash
        if (E.dark > 0.02) { const n = Math.round(90 * E.dark), top = Nvox * 1.3;
          for (let i = 0; i < n; i++) { const x = hash(i, 1, seed) * NX * m, z = hash(i, 2, seed) * NZ * m, y = top - mod(t * (5 + 6 * hash(i, 3)) * m * 0.2 + hash(i, 4) * top, top);
            blit(0, i % 3 ? ASH : DEAD, PXs(x, z) + Math.sin(t + i) * hx, PYs(x, y, z)); } }
        if (glowEyes) { ctx.globalCompositeOperation = 'lighter';
          for (const s of shown) for (let i = 0; i < s.eyes.length; i += 2) { const x = s.eyes[i], y = s.eyes[i + 1], r = Math.max(4, hx * 5 + h * 0.012), g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, 'rgba(255,214,90,0.75)'); g.addColorStop(0.3, 'rgba(255,170,50,0.3)'); g.addColorStop(1, 'rgba(255,140,30,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
          ctx.globalCompositeOperation = 'source-over'; }
        ctx.restore();
        if (E.flash > 0.01) { ctx.save(); ctx.globalCompositeOperation = painted ? 'source-over' : 'source-atop';
          const g = ctx.createRadialGradient(w * 0.7, h * 0.5, 0, w * 0.7, h * 0.5, w * (0.4 + E.flash));
          g.addColorStop(0, `rgba(255,250,225,${Math.min(1, E.flash * 1.2)})`); g.addColorStop(0.5, `rgba(255,190,90,${E.flash * 0.6})`); g.addColorStop(1, `rgba(255,120,40,${E.flash * 0.2})`);
          ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore(); }
      }
    };
  }
};

const S = (id, name, desc, tags, opts, params) => ({ id: 'voxel-' + id, name, desc, tags: ['voxel', '2d', ...tags], opts, params });
export const scenes = [
  S('trex', 'Block Rex', 'Tyrannosaurus rex stomps across a diorama block that builds itself under its feet.', ['theropod', 'cretaceous'],
    { cast: [{ sp: 'tyrannosaurus', at: [[0, 0]] }], seed: 3 }, { stage: 0.855 }),
  S('stego', 'Stegosaurus Pair', 'Two roof lizards circle a pond in the Morrison, plates catching the low sun.', ['stegosaur', 'jurassic', 'herd'],
    { mode: 'ring', cast: [{ sp: 'stegosaurus', ring: [0.02, 0.52] }], water: 'pond', pondR: 1.7, ring: 0.52, zoom: 1.1, seed: 8 }, { stage: 0.43, light: 0.36 }),
  S('ford', 'Long-neck Ford', 'A Brachiosaurus and its calf wade across the water tiles of a Jurassic floodplain.', ['sauropod', 'jurassic', 'family', 'water'],
    { cast: [{ sp: 'brachiosaurus', at: [[0, -0.08]] }, { sp: 'brachiosaurus', young: 1, at: [[0.22, 0.24]] }], water: 'river', ground: 'moss', nx: 11, cy: 0.66, zoom: 1.2, seed: 11 }, { stage: 0.42, light: 0.7 }),
  S('trike', 'Triceratops and Calf', 'Three horns and a frill, with a calf keeping up past the nests.', ['ceratopsian', 'cretaceous', 'family'],
    { cast: [{ sp: 'triceratops', at: [[0.05, -0.12]] }, { sp: 'triceratops', young: 1, at: [[0.3, 0.2]] }], nest: 9, seed: 5 }, { stage: 0.86 }),
  S('raptors', 'Raptor Run', 'Three feathered Velociraptors at full tilt over the Gobi sand.', ['theropod', 'cretaceous', 'pack', 'desert'],
    { cast: [{ sp: 'velociraptor', run: 0.8, at: [[0.25, 0], [-0.3, -0.36], [-0.42, 0.34]] }], ground: 'desert', plants: 0.6, backMax: 2, seed: 21 }, { stage: 0.79, light: 0.4, activity: 0.7 }),
  S('portrait', 'Fine-grain Spinosaurus', 'A close portrait in tiny voxels: the sail-backed fisher, snout to shoulder.', ['theropod', 'cretaceous', 'portrait', 'water'],
    { cast: [{ sp: 'spinosaurus', at: [[0, 0]] }], vox: 1.9, zoom: 2.1, aim: [0.22, 0.12], water: 'river', riverEvery: 10, riverWide: 4, ground: 'moss', seed: 6 }, { stage: 0.71, x3: 0.25, activity: 0.35 }),
  S('toy', 'Chunky Ankylosaurus', 'A big-block toy that stays an Ankylosaurus at any Era: tail club, armour and all, on a play mat.', ['ankylosaur', 'cretaceous', 'toy'],
    { style: 'toy', cast: [{ sp: 'ankylosaurus', lock: true, at: [[0, 0]] }], vox: 0.27, nx: 8, nz: 5, per: 5, plants: 0.8, seed: 23 }, { stage: 0.855, x3: 0.7, light: 0.9 }),
  S('night', 'Triassic Night', 'A Coelophysis pack trots under a block moon, eyes glowing.', ['theropod', 'triassic', 'pack', 'night'],
    { cast: [{ sp: 'coelophysis', at: [[0.2, 0.02], [-0.32, -0.3], [-0.4, 0.32]] }], ground: 'red', flip: true, seed: 2 }, { stage: 0.1, light: 0.06 }),
  S('nest', 'Good Mother Lizards', 'Maiasaura stand guard at the nest while a hatchling does laps around the eggs.', ['ornithopod', 'cretaceous', 'family', 'nest'],
    { mode: 'ring', cast: [{ sp: 'maiasaura', idle: [[-0.1, -0.5, 0], [0.12, 0.5, 180]] }, { sp: 'maiasaura', young: 1, ring: [0.2, 0.7], r: 0.2 }], nest: [6, 6], ring: 0.2, seed: 9 }, { stage: 0.795, light: 0.62 }),
  S('time', 'Deep Time Diorama', 'One block, 180 million years: the hunter and the plated plant-eater are recast as the eras drift by, until the ash falls.', ['time travel', 'theropod', 'stegosaur', 'impact'],
    { mode: 'ring', cast: [{ sp: 'allosaurus', ring: [0.05] }, { sp: 'stegosaurus', ring: [0.55] }], water: 'pond', pondR: 1.7, ring: 0.52, zoom: 1.1, seed: 14 }, { stage: 0.04, grow: 0.5 }),
];
