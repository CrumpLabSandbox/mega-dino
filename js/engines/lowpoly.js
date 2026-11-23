// Low Poly: faceted 3D dioramas drawn on the 2D canvas with a tiny software renderer.
// Each animal is a flat-shaded mesh built every frame from the shared rig: capsules(pose(…)) are joined into tapered
// prisms (spine, legs, arms), the skull profile is extruded into a bevelled head, and plates, sails, frills, horns,
// spikes, scutes and clubs are added as facets where the species has them (sp.f). The animals walk on a low-poly
// terrain: a hex or round tile floating in the sky, or a rolling triangulated plain reaching the horizon. The ground
// scrolls under their feet like a treadmill (phase comes from gait(), so feet do not slide), or a pack runs round a
// ring, bent along its path. A turntable camera turns slowly (drag to orbit); faces are sorted back to front and shaded
// by their normal against a sun set by Light.
import { pose, parts, capsules, gait, size, HEADS, CRESTS, at } from '../rig.js';
import { species, standIn } from '../species.js';
import { flora, PLANTS } from '../flora.js';
import { clamp, lerp, smooth, hash, fbm2, TAU, sky, daylight, energy, windX } from '../util.js';

const PI = Math.PI;

// ---------------------------------------------------------------- mesh buffers (shared scratch, rebuilt every frame)
const MAXV = 1 << 16, MAXF = 1 << 15, MAXI = MAXF * 4 + 8192;
const WX = new Float32Array(MAXV), WY = new Float32Array(MAXV), WZ = new Float32Array(MAXV);
const SX = new Float32Array(MAXV), SY = new Float32Array(MAXV), SD = new Float32Array(MAXV);
const FS = new Int32Array(MAXF), FC = new Uint8Array(MAXF), IDX = new Int32Array(MAXI);
const FR = new Float32Array(MAXF), FG = new Float32Array(MAXF), FB = new Float32Array(MAXF);
const FIX = new Float32Array(MAXF), FIY = new Float32Array(MAXF), FIZ = new Float32Array(MAXF);
const FBI = new Float32Array(MAXF), FAL = new Float32Array(MAXF), FD = new Float32Array(MAXF), FFL = new Uint8Array(MAXF);
const ORD = [new Int32Array(MAXF), new Int32Array(MAXF), new Int32Array(MAXF)], ON = [0, 0, 0];
const FCS = new Array(MAXF), FSS = new Array(MAXF);
let nV = 0, nF = 0, nI = 0;
const DS = 1, EM = 2, TERR = 4, UNDER = 8, ANIM = 16;           // double-sided · unlit · terrain layer · underside layer

// current emit state
let bR = 0, bG = 0, bB = 0, cFl = 0, cBias = 0, cAl = 1, inX = 0, inY = 0, inZ = 0, jSeed = 1, jN = 0, jAmt = 0.1;
const setCol = (c, k = 1) => { bR = c[0] * k; bG = c[1] * k; bB = c[2] * k; };
const setIn = (x, y, z) => { inX = x; inY = y; inZ = z; };
function V(x, y, z) { if (nV >= MAXV) return 0; WX[nV] = x; WY[nV] = y; WZ[nV] = z; return nV++; }
function fhead(n) {
  if (nF >= MAXF || nI + n > MAXI) return false;
  const k = jAmt ? 1 - jAmt + 2 * jAmt * hash(jSeed, jN++) : 1;
  FS[nF] = nI; FC[nF] = n; FR[nF] = bR * k; FG[nF] = bG * k; FB[nF] = bB * k; FFL[nF] = cFl; FBI[nF] = cBias; FAL[nF] = cAl;
  FIX[nF] = inX; FIY[nF] = inY; FIZ[nF] = inZ; nF++; return true;
}
function F3(a, b, c) { if (fhead(3)) { IDX[nI++] = a; IDX[nI++] = b; IDX[nI++] = c; } }
function F4(a, b, c, d) { if (fhead(4)) { IDX[nI++] = a; IDX[nI++] = b; IDX[nI++] = c; IDX[nI++] = d; } }
function FP(arr, n) { if (n >= 3 && n < 40 && fhead(n)) for (let i = 0; i < n; i++) IDX[nI++] = arr[i]; }

// local → world transform of the animal being built: straight (position + heading) or bent along a ring
let tMode = 0, tPX = 0, tPZ = 0, tC = 1, tS = 0, tR = 1, tA = 0, oX = 0, oY = 0, oZ = 0;
function xf(x, y, z) {
  if (tMode) { const a = tA + x / tR, r = tR - z; oX = r * Math.cos(a); oY = y; oZ = r * Math.sin(a); }
  else { oX = tPX + x * tC - z * tS; oY = y; oZ = tPZ + x * tS + z * tC; }
}
const tv = (x, y, z) => { xf(x, y, z); return V(oX, oY, oZ); };
const tin = (x, y, z) => { xf(x, y, z); inX = oX; inY = oY; inZ = oZ; };

// ---------------------------------------------------------------- primitives (animal space, through tv)
const RG = new Int32Array(64 * 12), TMP = new Int32Array(64);
// a chain of points [x, y, z, r]… joined into one tapered prism of S sides; mitred at the joints
function tubeChain(P4, m, S, cap, segK, flare = 1) {
  let pdx = 0, pdy = 0, pdz = 0;
  for (let i = 0; i < m; i++) {
    const o = i * 4, x = P4[o], y = P4[o + 1], z = P4[o + 2], r = P4[o + 3];
    let ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0, d;
    if (i > 0) { ax = x - P4[o - 4]; ay = y - P4[o - 3]; az = z - P4[o - 2]; d = Math.hypot(ax, ay, az) || 1; ax /= d; ay /= d; az /= d; }
    if (i < m - 1) { bx = P4[o + 4] - x; by = P4[o + 5] - y; bz = P4[o + 6] - z; d = Math.hypot(bx, by, bz) || 1; bx /= d; by /= d; bz /= d; }
    if (i === 0) { ax = bx; ay = by; az = bz; } if (i === m - 1) { bx = ax; by = ay; bz = az; }
    let tx = ax + bx, ty = ay + by, tz = az + bz; d = Math.hypot(tx, ty, tz);
    if (d < 1e-5) { tx = ax; ty = ay; tz = az; d = 1; } tx /= d; ty /= d; tz /= d;
    const mit = 1 / Math.max(0.6, tx * ax + ty * ay + tz * az);
    // B: sideways (z) made perpendicular to the tangent; N = B × T
    let Bx = -tz * tx, By = -tz * ty, Bz = 1 - tz * tz; d = Math.hypot(Bx, By, Bz);
    if (d < 0.05) { Bx = 1 - tx * tx; By = -tx * ty; Bz = -tx * tz; d = Math.hypot(Bx, By, Bz); } Bx /= d; By /= d; Bz /= d;
    const Nx = By * tz - Bz * ty, Ny = Bz * tx - Bx * tz, Nz = Bx * ty - By * tx;
    const fl = i === m - 1 ? flare : 1;
    for (let k = 0; k < S; k++) { const a = (k + 0.5) / S * TAU, c = Math.cos(a) * r * mit, s = Math.sin(a) * r * fl;
      RG[i * 12 + k] = tv(x + Nx * c + Bx * s, y + Ny * c + By * s, z + Nz * c + Bz * s); }
    pdx = bx; pdy = by; pdz = bz;
  }
  const r0 = bR, g0 = bG, b0 = bB;
  for (let i = 0; i < m - 1; i++) {
    const o = i * 4; tin((P4[o] + P4[o + 4]) / 2, (P4[o + 1] + P4[o + 5]) / 2, (P4[o + 2] + P4[o + 6]) / 2);
    if (segK) { const k = segK[i] ?? 1; bR = r0 * k; bG = g0 * k; bB = b0 * k; }
    for (let k = 0; k < S; k++) { const k2 = (k + 1) % S; F4(RG[i * 12 + k], RG[i * 12 + k2], RG[i * 12 + 12 + k2], RG[i * 12 + 12 + k]); }
  }
  if (cap && P4[(m - 1) * 4 + 3] > 1e-4) { const o = (m - 2) * 4; tin(P4[o], P4[o + 1], P4[o + 2]); for (let k = 0; k < S; k++) TMP[k] = RG[(m - 1) * 12 + k]; FP(TMP, S); }
  bR = r0; bG = g0; bB = b0;
}
const C4 = new Float32Array(64);
function cone(x0, y0, z0, x1, y1, z1, r, S = 3) { C4[0] = x0; C4[1] = y0; C4[2] = z0; C4[3] = r; C4[4] = x1; C4[5] = y1; C4[6] = z1; C4[7] = 0; tubeChain(C4, 2, S, false); }
// a faceted gem: two poles and two offset rings
function gem(cx, cy, cz, rx, ry, rz, S, seed, noBottom) {
  tin(cx, cy, cz);
  const top = tv(cx, cy + ry, cz), bot = noBottom ? 0 : tv(cx, cy - ry, cz);
  for (let k = 0; k < S; k++) {
    const a = k / S * TAU, a2 = (k + 0.5) / S * TAU, j1 = 0.82 + 0.3 * hash(seed, k), j2 = 0.82 + 0.3 * hash(seed, k + 31);
    RG[k] = tv(cx + Math.cos(a) * rx * 0.86 * j1, cy + ry * 0.42, cz + Math.sin(a) * rz * 0.86 * j1);
    RG[12 + k] = tv(cx + Math.cos(a2) * rx * (noBottom ? 1 : 0.86) * j2, cy - ry * (noBottom ? 0.25 : 0.42), cz + Math.sin(a2) * rz * (noBottom ? 1 : 0.86) * j2);
  }
  for (let k = 0; k < S; k++) { const k2 = (k + 1) % S;
    F3(top, RG[k], RG[k2]); F3(RG[k], RG[12 + k], RG[k2]); F3(RG[k2], RG[12 + k], RG[12 + k2]);
    if (!noBottom) F3(bot, RG[12 + k], RG[12 + k2]); }
}
// a 2D outline (already mapped to body x, y) extruded sideways into a bevelled slab: full outline at ±0.6 w, a
// smaller cap at ±w. wz[i] is the half-width at each point, zc the centre plane.
const EXA = new Int32Array(40), EXB = new Int32Array(40), EXC = new Int32Array(40), EXD = new Int32Array(40);
function extrude(pts, wz, zc, shrink = 0.7) {
  const n = pts.length; let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= n; cy /= n;
  tin(cx, cy, zc);
  for (let i = 0; i < n; i++) { const p = pts[i], w = wz[i], sx = cx + (p[0] - cx) * shrink, sy = cy + (p[1] - cy) * shrink;
    EXA[i] = tv(p[0], p[1], zc + w * 0.6); EXB[i] = tv(sx, sy, zc + w); EXC[i] = tv(p[0], p[1], zc - w * 0.6); EXD[i] = tv(sx, sy, zc - w); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n;
    F4(EXA[i], EXA[j], EXC[j], EXC[i]); F4(EXA[i], EXA[j], EXB[j], EXB[i]); F4(EXC[i], EXC[j], EXD[j], EXD[i]); }
  FP(EXB, n); FP(EXD, n);
}

// ---------------------------------------------------------------- the animals
const HORN = [233, 224, 200], EYE = [246, 214, 70], PUPIL = [22, 18, 14], MOUTH = [128, 34, 40];
const hex3 = c => { const p = parseInt(c.slice(1), 16); return [p >> 16, p >> 8 & 255, p & 255]; };
const COLS = new Map();
function colours(sp) {
  let c = COLS.get(sp.id);
  if (!c) { const [body, belly, mark, accent] = sp.c.map(hex3); c = { body, belly, mark, accent, jaw: [0, 1, 2].map(i => lerp(body[i], belly[i], 0.35)) }; COLS.set(sp.id, c); }
  return c;
}
const WIDE = { ankylosaur: 1.55, ceratopsian: 1.14, stegosaur: 0.95, sauropod: 1, brachiosaur: 1, titanosaur: 1.05, camarasaur: 1.05, iguanodont: 0.9 };
const HEADW = { cerat: [1.2, 0.3], anky: [1.5, 0.75], duck: [1, 0.75], theropod: [0.95, 0.5], raptor: [0.9, 0.4], spino: [0.8, 0.4], sauro: [1.1, 0.75], brachio: [1.1, 0.75],
  stego: [1, 0.5], pachy: [1.1, 0.5], ornitho: [1, 0.35], bird: [1, 0.3] };
const P4 = new Float32Array(64);

function buildDino(q, seed, sides, coarse) {
  const sp = q.sp, P = q.P, f = sp.f, n = q.nodes, N = n.length, L = q.L, C = colours(sp), { iHip, iSh, iEnd } = q;
  const S = sides, Wd = WIDE[sp.plan] ?? (P.biped ? 0.82 : 1), pat = sp.pat;
  jSeed = seed; jN = 0; jAmt = 0.09; cFl = 0; cBias = 0;

  // ---- spine: tail tip → neck, one ring per node
  const ids = []; for (let i = 0; i < N; i += (coarse && i > 1 && i < N - 2 ? 2 : 1)) ids.push(i);
  if (ids[ids.length - 1] !== N - 1) ids.push(N - 1);
  const widthAt = i => { const u = (i - iHip) / (iSh - iHip); return lerp(0.85, Wd, smooth(-0.6, 0.15, u) * (1 - smooth(0.85, 1.5, u))); };
  for (let a = 0; a < ids.length; a++) {
    const i = ids[a], c = n[i], A = n[Math.max(0, i - 1)], B = n[Math.min(N - 1, i + 1)];
    let tx = B.x - A.x, ty = B.y - A.y; const d = Math.hypot(tx, ty) || 1; tx /= d; ty /= d;
    const rw = c.r * widthAt(i), rb = c.b ?? c.r;
    for (let k = 0; k < S; k++) { const ang = k / S * TAU, ca = Math.cos(ang), sa = Math.sin(ang), rv = ca >= 0 ? c.r : rb;
      RG[a * 12 + k] = tv(c.x - ty * ca * rv, c.y + tx * ca * rv, c.z + sa * rw); }
  }
  for (let a = 0; a < ids.length - 1; a++) {
    const i0 = ids[a], i1 = ids[a + 1], s = (i0 + i1) / 2, A = n[i0], B = n[i1];
    tin((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
    for (let k = 0; k < S; k++) {
      const k2 = (k + 1) % S, cm = Math.cos((k + 0.5) / S * TAU);
      let col = C.body;
      if (cm < -0.45 && s >= iHip * 0.55) col = C.belly;
      else if (pat === 'saddle') { if (cm > 0.45 && s > iHip * 0.2) col = C.mark; }
      else if (pat === 'stripes') { if (cm > -0.1 && (i0 & 1) && s > iHip * 0.15 && s < iSh + 2) col = C.mark; }
      else if (pat === 'bands') { if (s < iHip + 0.5 ? (i0 & 1) && cm > -0.45 : (i0 & 1) && cm > 0.45 && s < iSh + 1) col = C.mark; }
      else if (pat === 'spots') { if (cm > -0.1 && s > iHip * 0.3 && s < iSh + 3 && hash(i0 * 3.1 + k, 9.2) < 0.3) col = C.mark; }
      setCol(col);
      const p = RG[a * 12 + k], q1 = RG[a * 12 + k2], r = RG[a * 12 + 12 + k2], t = RG[a * 12 + 12 + k];
      if ((a + k) & 1) { F3(p, q1, r); F3(p, r, t); } else { F3(p, q1, t); F3(q1, r, t); }
    }
  }

  // ---- limbs: the capsules after the spine and the head, joined where one ends and the next begins
  const caps = capsules(q);
  let i = N;
  while (i < caps.length) {
    let m = 0, j = i;
    const put = (x, y, z, r) => { P4[m * 4] = x; P4[m * 4 + 1] = y; P4[m * 4 + 2] = z; P4[m * 4 + 3] = r; m++; };
    put(caps[i][0], caps[i][1], caps[i][2], caps[i][6]);
    for (; j < caps.length; j++) {
      const c = caps[j];
      if (j > i && (Math.abs(c[0] - caps[j - 1][3]) > 1e-6 || Math.abs(c[1] - caps[j - 1][4]) > 1e-6)) break;
      if (Math.hypot(c[3] - c[0], c[4] - c[1]) > 1e-4) put(c[3], c[4], c[5], c[7]);
    }
    const leg = m >= 4 && caps[i][6] > L * 0.012;
    setCol(C.body);
    if (m >= 2) tubeChain(P4, m, leg ? 5 : 4, true, leg ? [1, 0.94, 0.86, 0.74] : null, leg && P.toes === 'claw' ? 1.9 : 1);
    i = j;
  }
  // big hand claws (therizinosaurs) and thumb spikes
  if (f.claws) { setCol(HORN); for (const g of q.arms) { const Hd = g.pts[3], cl = L * 0.085 * f.claws;
    for (let k = 0; k < 3; k++) { const an = g.fa - 0.5 - k * 0.22; cone(Hd[0], Hd[1], g.z * 1.1 + (k - 1) * g.r, Hd[0] + Math.cos(an) * cl, Hd[1] + Math.sin(an) * cl, g.z * 1.1 + (k - 1) * g.r * 2, g.r * 0.7); } } }

  // ---- plates, spikes, sails, feathers: the rig's side-view shapes, stood up in 3D
  const zb = L * 0.012;
  let afterHead = false;
  if (f.plates || f.spikes || f.sail || f.paddleTail || f.neckSpines || f.spines || f.quills || f.wings || f.wingFold || f.legWings) for (const pt of parts(q)) {
    const k = pt.k;
    if (k === 'skull') { afterHead = true; continue; }
    if (k === 'plate') {
      const p = pt.p, side = pt.t === 'accentFar' ? -1 : 1, bx = (p[0][0] + p[4][0]) / 2, by = (p[0][1] + p[4][1]) / 2;
      const hgt = Math.hypot(p[2][0] - bx, p[2][1] - by), th = hgt * 0.06, lean = [0, 0.5, 1, 0.5, 0];
      const cx = (bx + p[2][0]) / 2, cy = (by + p[2][1]) / 2, cz = side * (zb + hgt * 0.13);
      tin(cx, cy, cz);
      for (let j = 0; j < 5; j++) RG[j] = tv(p[j][0], p[j][1], side * (zb + lean[j] * hgt * 0.26));
      const c1 = tv(cx, cy, cz + th), c2 = tv(cx, cy, cz - th);
      setCol(C.accent);
      for (let j = 0; j < 4; j++) { F3(c1, RG[j], RG[j + 1]); F3(c2, RG[j], RG[j + 1]); }
    } else if (k === 'spike' && !afterHead) {
      const p = pt.p, mid = pt.t === 'mark', side = mid ? 0 : pt.t === 'accentFar' ? -1 : 1, bx = (p[0][0] + p[2][0]) / 2, by = (p[0][1] + p[2][1]) / 2;
      const len = Math.hypot(p[1][0] - bx, p[1][1] - by), out = f.neckSpines && bx > n[iSh].x ? 0.14 : 0.5;
      setCol(pt.t === 'mark' ? C.mark : f.neckSpines && bx > n[iSh].x ? C.accent : HORN);
      cone(bx, by, side * zb, p[1][0], p[1][1], side * (zb + len * out), Math.max(Math.hypot(p[2][0] - p[0][0], p[2][1] - p[0][1]) * 0.75, len * 0.09), 3);
    } else if (k === 'sail') {
      const p = pt.p, m = p.length >> 1; cFl = DS;
      for (let j = 0; j < m; j++) { const zz = (j & 1 ? 1 : -1) * L * 0.007; RG[j] = tv(p[j][0], p[j][1], zz); RG[40 + j] = tv(p[2 * m - 1 - j][0], p[2 * m - 1 - j][1], 0); }
      for (let j = 0; j < m - 1; j++) { setCol(j % 3 === 1 ? C.mark : C.accent, j & 1 ? 0.9 : 1); F4(RG[j], RG[j + 1], RG[41 + j], RG[40 + j]); }
      cFl = 0;
    } else if (k === 'quill') { const l = pt.l; cFl = DS; setCol(C.accent); F3(tv(l[0][0] - pt.w, l[0][1], 0), tv(l[0][0] + pt.w, l[0][1], 0), tv(l[1][0], l[1][1], 0)); cFl = 0; }
    else if (k === 'wing') {
      const p = pt.p, both = pt.t === 'mark', side = pt.t === 'accentFar' ? -1 : 1, zz = (both ? n[iHip + 2].r * Wd * 0.8 : P.rSh * L * 0.95);
      cFl = DS; setCol(both ? C.mark : C.accent);
      for (const sg of both ? [1, -1] : [side]) { for (let j = 0; j < p.length; j++) TMP[j] = tv(p[j][0], p[j][1], sg * zz); FP(TMP, p.length); }
      cFl = 0;
    }
  }
  if (f.sideSpike) { const o = at(n, iSh - 0.4), d = L * 0.07 * f.sideSpike, rw = o.r * Wd; setCol(HORN);
    for (const sg of [1, -1]) cone(o.x, o.y, sg * rw * 0.75, o.x - d * 0.3, o.y + d * 0.3, sg * (rw + d), d * 0.2, 4); }
  if (f.tailFan) { const Nn = iHip * 0.42; cFl = DS; setCol(C.accent);
    for (let j = 0; j <= 6; j++) { const u = j / 6, o = at(n, Nn * (1 - u)), r = L * 0.03 * f.tailFan * Math.sin(PI * (0.12 + 0.88 * (1 - u))) + 0.002;
      RG[j] = tv(o.x, o.y + o.r * 0.3, o.z + r * 1.5); RG[12 + j] = tv(o.x, o.y + o.r * 0.3, o.z - r * 1.5); RG[24 + j] = tv(o.x, o.y + o.r * 0.6 + r * 0.2, o.z); }
    for (let j = 0; j < 6; j++) { F4(RG[j], RG[j + 1], RG[25 + j], RG[24 + j]); F4(RG[12 + j], RG[13 + j], RG[25 + j], RG[24 + j]); }
    cFl = 0; }
  if (f.scutes) { // rows of bony studs over the back
    const hgt = L * 0.026 * f.scutes, bw = L * 0.02 * Math.sqrt(f.scutes), rows = [0.42, 1.08, -0.42, -1.08];
    let j = 0;
    for (let s = iHip * 0.25; s < iEnd - 0.6; s += coarse ? 1.3 : 0.9, j++) {
      const o = at(n, s), rw = o.r * widthAt(s), tailK = s < iHip ? 0.75 : 1;
      for (let k = 0; k < 4; k++) { if (s < iHip - 2 && (k & 1)) continue;
        const a = rows[k] + ((j & 1) ? 0.16 : -0.16) * Math.sign(rows[k]), ca = Math.cos(a), sa = Math.sin(a);
        const bx = o.x + o.nx * ca * o.r * 0.93, by = o.y + o.ny * ca * o.r * 0.93, bz = sa * rw * 0.93, hh = hgt * tailK * (Math.abs(rows[k]) > 1 ? 1.5 : 1);
        setCol(Math.abs(rows[k]) > 1 ? HORN : C.mark, Math.abs(rows[k]) > 1 ? 0.9 : 1.15);
        cone(bx, by, bz, bx + o.nx * ca * hh, by + o.ny * ca * hh, bz + sa * hh * 1.3, bw * tailK, 3); }
    }
  }
  if (f.club) { const e = n[0], r = L * 0.036 * f.club; setCol(HORN, 0.86);
    gem(e.x - r * 0.2, e.y, e.z + r * 0.75, r * 1.15, r * 0.75, r * 0.95, 5, seed + 3); gem(e.x - r * 0.2, e.y, e.z - r * 0.75, r * 1.15, r * 0.75, r * 0.95, 5, seed + 4); }

  // ---- head: the skull and jaw profiles extruded, then horns, frill, crest, beak, eyes, teeth
  const Hd = HEADS[P.headT] || HEADS.theropod, hd = q.head, hl = hd.len, dd = hl * (P.hd || 1), ch = Math.cos(hd.a), sh = Math.sin(hd.a);
  const M = (lx, ly) => [hd.x + lx * hl * ch - ly * dd * sh, hd.y + lx * hl * sh + ly * dd * ch];
  const jawA = -hd.jaw * 0.62, pv = [0.08, -0.07], cj = Math.cos(jawA), sj = Math.sin(jawA);
  const J = (lx, ly) => { const dx = lx - pv[0], dy = ly - pv[1]; return M(pv[0] + dx * cj - dy * sj, pv[1] + dx * sj + dy * cj); };
  const hw0 = HEADW[P.headT] || HEADW.theropod, hw = Math.max(n[iEnd].r * 1.02, hl * 0.2 * (P.hd || 1)) * hw0[0] * (1 + 0.15 * q.young);
  const wAt = lx => hw * lerp(1, hw0[1], smooth(0.2, 1, lx));
  const slab = (pl, map, k, zc, shrink, wConst) => extrude(pl.map(p => map(p[0], p[1])), pl.map(p => wConst ?? wAt(p[0]) * k), zc || 0, shrink);
  if (f.frill) { // a shield fanning out behind the skull: an inner cone in the body colour and a display rim
    const k = f.frill, NF = 7, rr = (0.4 + 0.6 * k) * 0.54, a0 = M(0.14, 0.2); cFl = DS;
    const apex = tv(a0[0], a0[1], 0);
    for (let j = 0; j < NF; j++) { const b = lerp(-2.05, 2.05, j / (NF - 1)), cb = Math.cos(b), sb = Math.sin(b);
      const pi = M(-0.1 * k - 0.16 * k * cb, 0.16 + rr * 0.55 * cb), po = M(-0.22 * k - 0.4 * k * cb, 0.14 + rr * cb);
      RG[j] = tv(pi[0], pi[1], sb * hl * 0.32 * k); RG[12 + j] = tv(po[0], po[1], sb * hl * 0.52 * k);
      if (f.frillSpikes && j > 0 && j < NF - 1) { const pe = M(-0.24 * k - 0.6 * k * cb - 0.12, 0.14 + (rr + 0.42) * cb); cFl = 0; setCol(HORN); cone(po[0], po[1], sb * hl * 0.5 * k, pe[0], pe[1], sb * hl * 0.8 * k, hl * 0.05, 3); cFl = DS; } }
    for (let j = 0; j < NF - 1; j++) { setCol(C.body, 1.05); F3(apex, RG[j], RG[j + 1]); setCol(C.accent, j & 1 ? 1 : 0.8); F4(RG[j], RG[j + 1], RG[13 + j], RG[12 + j]); }
    cFl = 0; }
  if (hd.jaw > 0.04) { cFl = DS | EM; setCol(MOUTH); const pl = [M(pv[0], pv[1]), M(0.5, 0.02), M(0.98, 0.02), J(0.97, -0.02), J(0.5, -0.04)];
    for (let j = 0; j < 5; j++) TMP[j] = tv(pl[j][0], pl[j][1], 0); FP(TMP, 5); cFl = 0; }
  setCol(C.body); slab(Hd.up, M, 1);
  setCol(C.jaw); slab(Hd.jaw, J, 0.9);
  if (Hd.beak) { setCol(HORN, 0.92); slab(Hd.beak, M, 1.08, 0, 0.8); }
  if (Hd.teeth && sp.diet !== 'herbivore') { const [x0, x1] = Hd.teeth, NT = 6, tw = (x1 - x0) / NT; cFl = DS; setCol(HORN, 1.05);
    for (const sg of [1, -1]) for (let j = 0; j < NT; j++) { const x = x0 + (j + 0.5) * tw, hh = 0.06 + 0.05 * Math.sin(PI * (j + 0.5) / NT), zz = sg * wAt(x) * 0.62;
      const a = M(x - tw * 0.36, 0.015), b = M(x, 0.015 - hh), c = M(x + tw * 0.36, 0.015); F3(tv(a[0], a[1], zz), tv(b[0], b[1], zz * 0.96), tv(c[0], c[1], zz)); }
    cFl = 0; }
  if (f.crest && CRESTS[f.crest]) { const cr = CRESTS[f.crest], hornish = f.crest === 'horns' || f.crest === 'brow' || f.crest === 'nose';
    setCol(hornish ? HORN : C.accent);
    if (f.crest === 'double' || f.crest === 'horns' || f.crest === 'brow') { slab(cr, M, 0, hw * 0.55, 0.75, hw * 0.16); slab(cr, M, 0, -hw * 0.55, 0.75, hw * 0.16); }
    else slab(cr, M, 0, 0, 0.75, hw * (f.crest === 'dome' ? 0.8 : f.crest === 'tube' ? 0.3 : 0.2)); }
  if (f.horns) { setCol(HORN); for (const sg of [1, -1]) { const a = M(0.43, 0.4), b = M(0.64, 0.73 * f.horns + 0.1), c = M(1.0, 1.02 * f.horns + 0.08);
    P4.set([a[0], a[1], sg * hw * 0.5, hl * 0.085, b[0], b[1], sg * hw * 0.8, hl * 0.05, c[0], c[1], sg * hw * 0.85, 0]); tubeChain(P4, 3, 4, false); } }
  if (f.noseHorn) { setCol(HORN); const a = M(0.785, 0.28), b = M(0.82, 0.34 + 0.42 * f.noseHorn); cone(a[0], a[1], 0, b[0], b[1], 0, hl * 0.075, 4); }
  if (P.headT === 'anky') { setCol(HORN); for (const sg of [1, -1]) { let a = M(0.05, 0.34), b = M(-0.16, 0.48); cone(a[0], a[1], sg * hw * 0.7, b[0], b[1], sg * hw * 1.25, hl * 0.09, 3);
    a = M(0.06, -0.1); b = M(-0.1, -0.2); cone(a[0], a[1], sg * hw * 0.7, b[0], b[1], sg * hw * 1.3, hl * 0.08, 3); } }
  // eyes
  { const e = Hd.eye, er = Math.max(e[2] * hl * (1 + q.young * 0.6) * (P.hd || 1) * 1.7, L * 0.006), c0 = M(e[0], e[1]), cc = M(0.5, 0.15);
    cBias = hl * 0.6; jAmt = 0; tin(cc[0], cc[1], 0);
    for (const sg of [1, -1]) { const zz = sg * wAt(e[0]) * 1.04;
      cFl = EM; setCol(EYE); F4(tv(c0[0] - er, c0[1], zz), tv(c0[0], c0[1] + er * 0.8, zz), tv(c0[0] + er, c0[1], zz), tv(c0[0], c0[1] - er * 0.8, zz));
      cBias = hl * 0.7; setCol(PUPIL); const pr = er * 0.45, z2 = zz * 1.02;
      F4(tv(c0[0] - pr * 0.6, c0[1], z2), tv(c0[0], c0[1] + pr, z2), tv(c0[0] + pr * 0.6, c0[1], z2), tv(c0[0], c0[1] - pr, z2)); cBias = hl * 0.6; }
    cBias = 0; cFl = 0; jAmt = 0.09; }
}

// ---------------------------------------------------------------- terrain: a scrolling, clamped triangle grid
const GS = 64, GX = new Float32Array(GS * GS), GY = new Float32Array(GS * GS), GZ = new Float32Array(GS * GS), GI = new Int32Array(GS * GS);
let GJ = 1, Gcs = 1, Gcz = 1, Gs = 0, GiBase = 0, Gncol = 2, GR = 1, Ghex = false, Gamp = 0, Gunit = 1, Gfade = 0.22, Gseed = 0;
const xmaxAt = z => Ghex ? Math.max(0, GR - Math.abs(z) / 1.7320508) : Math.sqrt(Math.max(0, GR * GR - z * z));
const edgeDist = (x, z) => Ghex ? Math.min(GR * 0.8660254 - Math.abs(z), (xmaxAt(z) - Math.abs(x)) * 0.8660254) : GR - Math.hypot(x, z);
// the endless ground the tile is a window on (tx = x + scroll)
const rawH = (tx, z) => Gamp * ((fbm2(tx / Gunit * 0.9 + Gseed, z / Gunit * 0.9 + 3.7, 3) - 0.5) * 2 + 0.25 * Math.sin(tx / Gunit * 2.1 + z / Gunit * 1.3));
function buildGrid() {
  Gncol = Math.min(GS, Math.ceil(2 * GR / Gcs) + 4); GiBase = Math.floor((Gs - GR) / Gcs) - 1;
  for (let jj = 0; jj <= 2 * GJ; jj++) {
    const j = jj - GJ, z0 = j * Gcz, edgeRow = Math.abs(j) === GJ;
    for (let ii = 0; ii < Gncol; ii++) {
      const iG = GiBase + ii, x0 = iG * Gcs - Gs + (hash(iG, j) - 0.5) * 0.5 * Gcs;
      const fz = edgeRow ? 0 : smooth(0, Gcs, xmaxAt(z0) - Math.abs(x0));
      const z = z0 + (hash(iG, j, 7) - 0.5) * 0.5 * Gcz * fz, xm = xmaxAt(z), x = clamp(x0, -xm, xm), o = jj * GS + ii;
      GX[o] = x; GZ[o] = z; GY[o] = rawH(x + Gs, z) * smooth(0, Gfade * GR, edgeDist(x, z));
    }
  }
}
function triY(a, b, c, x, z) {
  const ax = GX[a], az = GZ[a], d = (GZ[b] - GZ[c]) * (ax - GX[c]) + (GX[c] - GX[b]) * (az - GZ[c]);
  if (Math.abs(d) < 1e-9) return NaN;
  const u = ((GZ[b] - GZ[c]) * (x - GX[c]) + (GX[c] - GX[b]) * (z - GZ[c])) / d, v = ((GZ[c] - az) * (x - GX[c]) + (ax - GX[c]) * (z - GZ[c])) / d, w = 1 - u - v;
  if (u < -1e-4 || v < -1e-4 || w < -1e-4) return NaN;
  return u * GY[a] + v * GY[b] + w * GY[c];
}
const D3 = [0, -1, 1];
function groundH(x, z) {
  const jj0 = Math.floor(z / Gcz) + GJ, ii0 = Math.floor((x + Gs) / Gcs) - GiBase;
  for (let dj = 0; dj < 3; dj++) { const jj = jj0 + D3[dj]; if (jj < 0 || jj >= 2 * GJ) continue;
    for (let di = 0; di < 3; di++) { const ii = ii0 + D3[di]; if (ii < 0 || ii >= Gncol - 1) continue;
      const a = jj * GS + ii, b = a + 1, c = a + GS + 1, d = a + GS;
      let y = (GiBase + ii + jj) & 1 ? triY(a, b, c, x, z) : triY(a, b, d, x, z); if (y === y) return y;
      y = (GiBase + ii + jj) & 1 ? triY(a, c, d, x, z) : triY(b, c, d, x, z); if (y === y) return y; } }
  return 0;
}
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function emitTerrain(G, lanes) {
  cFl = DS | TERR; jAmt = 0; cBias = 0; cAl = 1;
  for (let jj = 0; jj <= 2 * GJ; jj++) for (let ii = 0; ii < Gncol; ii++) { const o = jj * GS + ii; GI[o] = V(GX[o], GY[o], GZ[o]); }
  const minA = Gcs * Gcz * 0.004;
  const tri = (a, b, c, hs) => {
    const ar = Math.abs((GX[b] - GX[a]) * (GZ[c] - GZ[a]) - (GX[c] - GX[a]) * (GZ[b] - GZ[a])); if (ar < minA) return;
    const cx = (GX[a] + GX[b] + GX[c]) / 3, cz = (GZ[a] + GZ[b] + GZ[c]) / 3, tx = cx + Gs;
    let g = G.green + (fbm2(tx / Gunit * 1.4 + 9, cz / Gunit * 1.4, 2) - 0.5) * 1.3 + (hs - 0.5) * 0.35;
    let lane = 0; for (const l of lanes) lane = Math.max(lane, l.ring ? 1 - smooth(l.w * 0.5, l.w * 1.5, Math.abs(Math.hypot(cx, cz) - l.r)) : 1 - smooth(l.w * 0.5, l.w * 1.6, Math.abs(cz - l.z)));
    g -= lane * 0.75;
    const t = clamp(g), k = 0.9 + 0.2 * hs;
    bR = lerp(G.earth[0], G.cover[0], t) * k; bG = lerp(G.earth[1], G.cover[1], t) * k; bB = lerp(G.earth[2], G.cover[2], t) * k;
    F3(GI[a], GI[b], GI[c]);
  };
  for (let jj = 0; jj < 2 * GJ; jj++) for (let ii = 0; ii < Gncol - 1; ii++) {
    const a = jj * GS + ii, b = a + 1, c = a + GS + 1, d = a + GS, iG = GiBase + ii, j = jj - GJ, h1 = hash(iG, j, 3), h2 = hash(iG, j, 5);
    if ((iG + jj) & 1) { tri(a, b, c, h1); tri(a, c, d, h2); } else { tri(a, b, d, h1); tri(b, c, d, h2); }
  }
}
// the underside of a floating tile: a soil band, then rock narrowing to a point
function emitUnder(G) {
  const n = 2 * (2 * GJ + 1), R = GR, dep = G.depth * R;
  cFl = UNDER; jAmt = 0.07; jSeed = 77; jN = 0; setIn(0, -dep * 0.3, 0);
  const px = i => { const jj = i < n / 2 ? i : n - 1 - i, z = (jj - GJ) * Gcz; return [(i < n / 2 ? 1 : -1) * xmaxAt(z), z]; };
  const apex = V(R * 0.08, -dep, -R * 0.05);
  for (let i = 0; i < n; i++) { const [x, z] = px(i), hk = hash(i >> 1, 11), h2 = hash(i >> 1, 23);
    RG[i] = V(x, 0, z); RG[100 + i] = V(x * 1.005, -R * 0.07, z * 1.005);
    RG[200 + i] = V(x * (0.84 + 0.1 * hk), -dep * (0.3 + 0.14 * h2), z * (0.84 + 0.1 * hk));
    RG[300 + i] = V(x * (0.48 + 0.16 * h2), -dep * (0.66 + 0.16 * hk), z * (0.48 + 0.16 * h2)); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n;
    setCol(G.soil); F4(RG[i], RG[j], RG[100 + j], RG[100 + i]);
    setCol(G.rock, 1.08); F4(RG[100 + i], RG[100 + j], RG[200 + j], RG[200 + i]);
    setCol(G.rock, 0.86); F4(RG[200 + i], RG[200 + j], RG[300 + j], RG[300 + i]);
    setCol(G.rock, 0.7); F3(RG[300 + i], RG[300 + j], apex); }
}

// ---------------------------------------------------------------- plants (world space, standing on the terrain)
let PAL = null;       // plant palette for this frame
function wprism(x, y, z, r0, r1, hgt, S, rot, sx, sz, cap) {
  setIn(x + sx * 0.5, y + hgt * 0.5, z + sz * 0.5);
  for (let k = 0; k < S; k++) { const a = rot + k / S * TAU, c = Math.cos(a), s = Math.sin(a); RG[k] = V(x + c * r0, y, z + s * r0); RG[12 + k] = V(x + sx + c * r1, y + hgt, z + sz + s * r1); }
  for (let k = 0; k < S; k++) { const k2 = (k + 1) % S; F4(RG[k], RG[k2], RG[12 + k2], RG[12 + k]); }
  if (cap) { for (let k = 0; k < S; k++) TMP[k] = RG[12 + k]; setIn(x, y, z); FP(TMP, S); }
}
function wcone(x, y, z, r, hgt, S, rot, ax, az) {
  setIn(x, y + hgt * 0.3, z); const ap = V(x + ax, y + hgt, z + az);
  for (let k = 0; k < S; k++) { const a = rot + k / S * TAU; RG[k] = V(x + Math.cos(a) * r, y, z + Math.sin(a) * r); }
  for (let k = 0; k < S; k++) F3(RG[k], RG[(k + 1) % S], ap);
}
function wgem(cx, cy, cz, rx, ry, rz, S, seed, noBottom) { const m = tMode, a = tPX, b = tPZ, c = tC, s = tS; tMode = 0; tPX = 0; tPZ = 0; tC = 1; tS = 0; gem(cx, cy, cz, rx, ry, rz, S, seed, noBottom); tMode = m; tPX = a; tPZ = b; tC = c; tS = s; }
function fronds(x, y, z, n, len, rise, droop, wid, rot, seed) {
  cFl = DS;
  for (let k = 0; k < n; k++) {
    const a = rot + (k + 0.3 * hash(seed, k)) / n * TAU, c = Math.cos(a), s = Math.sin(a), l = len * (0.8 + 0.4 * hash(seed, k + 9));
    const mx = x + c * l * 0.5, mz = z + s * l * 0.5, my = y + rise, ex = x + c * l, ez = z + s * l, ey = y + rise - droop;
    const b = V(x, y, z), m1 = V(mx - s * wid, my, mz + c * wid), m2 = V(mx + s * wid, my, mz - c * wid), e = V(ex, ey, ez);
    setCol(k & 1 ? PAL.leaf : PAL.leaf2); F3(b, m1, m2); F3(m1, e, m2);
  }
  cFl = 0;
}
function buildPlant(kind, x, y, z, hgt, seed, sway, lod) {
  jSeed = seed; jN = 0; jAmt = 0.1; cFl = 0; cBias = 0;
  const rot = hash(seed, 1) * TAU, S = lod ? 4 : 6, sx = sway * hgt, T = PAL.trunk;
  switch (kind) {
    case 'conifer': case 'redwood': { const slim = kind === 'redwood' ? 0.62 : 1, tiers = kind === 'redwood' ? 4 : 3;
      setCol(kind === 'redwood' ? PAL.red : T); wprism(x, y, z, hgt * 0.04, hgt * 0.03, hgt * 0.3, lod ? 3 : 4, rot, 0, 0);
      for (let i = 0; i < tiers; i++) { const u = i / tiers, r = hgt * lerp(0.27, 0.13, u) * slim, y0 = y + hgt * lerp(0.2, 0.68, u), hh = hgt * (1 - lerp(0.2, 0.68, u)) * (i === tiers - 1 ? 1 : 0.62);
        setCol(i & 1 ? PAL.pine2 : PAL.pine); wcone(x + sx * u, y0, z, r, hh, S, rot + i * 0.5, sx * 0.4, 0); }
      break; }
    case 'araucaria': { setCol(T); wprism(x, y, z, hgt * 0.035, hgt * 0.022, hgt * 0.74, lod ? 3 : 4, rot, sx * 0.6, 0);
      for (let i = 0; i < 3; i++) { const r = hgt * [0.26, 0.2, 0.11][i], y0 = y + hgt * [0.6, 0.74, 0.86][i]; setCol(i & 1 ? PAL.pine2 : PAL.pine); wcone(x + sx * (0.6 + i * 0.15), y0, z, r, hgt * 0.15, S, rot + i, sx * 0.1, 0); }
      break; }
    case 'ginkgo': case 'magnolia': { setCol(T); wprism(x, y, z, hgt * 0.045, hgt * 0.03, hgt * 0.5, 4, rot, sx * 0.4, 0);
      setCol(kind === 'ginkgo' ? PAL.ginkgo : PAL.leaf); wgem(x + sx * 0.7, y + hgt * 0.7, z, hgt * 0.3, hgt * 0.32, hgt * 0.3, lod ? 5 : 6, seed);
      if (kind === 'magnolia' && !lod) { cFl = DS | EM; setCol(PAL.flower); for (let k = 0; k < 5; k++) { const a = rot + k * 1.3, yy = y + hgt * (0.62 + 0.3 * hash(seed, k + 40)), r = hgt * 0.3, e = hgt * 0.05;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; F3(V(px - e, yy, pz), V(px + e, yy + e * 0.4, pz + e), V(px, yy + e * 1.6, pz - e)); } cFl = 0; }
      break; }
    case 'treefern': case 'palm': { setCol(T); wprism(x, y, z, hgt * 0.04, hgt * 0.03, hgt * 0.78, 4, rot, sx * 0.5, 0);
      fronds(x + sx * 0.5, y + hgt * 0.78, z, lod ? 5 : 7, hgt * 0.42, hgt * 0.14, hgt * 0.2, hgt * 0.07, rot, seed); break; }
    case 'cycad': { setCol(T, 0.85); wprism(x, y, z, hgt * 0.15, hgt * 0.12, hgt * 0.42, 5, rot, 0, 0, true);
      fronds(x, y + hgt * 0.4, z, lod ? 5 : 7, hgt * 0.6, hgt * 0.42, hgt * 0.18, hgt * 0.09, rot, seed); break; }
    case 'fern': fronds(x, y, z, lod ? 4 : 6, hgt * 0.9, hgt * 0.75, hgt * 0.45, hgt * 0.17, rot, seed); break;
    case 'horsetail': case 'reed': setCol(PAL.leaf2); for (let k = 0; k < 4; k++) { const a = rot + k * 1.7, d = hgt * 0.12; wcone(x + Math.cos(a) * d, y, z + Math.sin(a) * d, hgt * 0.05, hgt * (0.7 + 0.3 * hash(seed, k)), 3, a, sx, 0); } break;
    case 'bush': setCol(PAL.leaf); wgem(x, y + hgt * 0.2, z, hgt * 0.6, hgt * 0.75, hgt * 0.6, 5, seed, true); break;
    case 'flowers': { setCol(PAL.leaf2); wgem(x, y + hgt * 0.1, z, hgt * 0.8, hgt * 0.5, hgt * 0.8, 5, seed, true);
      cFl = DS | EM; for (let k = 0; k < 5; k++) { const a = rot + k * 1.26, r = hgt * 0.5 * hash(seed, k + 3), e = hgt * 0.2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, yy = y + hgt * 0.55;
        setCol(k % 3 ? PAL.flower : PAL.flower2); F4(V(px - e, yy, pz), V(px, yy + e * 0.7, pz + e), V(px + e, yy, pz), V(px, yy + e * 0.7, pz - e)); } cFl = 0; break; }
    case 'deadtree': { setCol(PAL.dead); wprism(x, y, z, hgt * 0.045, hgt * 0.012, hgt, 4, rot, hgt * 0.06, 0);
      for (let k = 0; k < 3; k++) { const a = rot + k * 2.2, yy = y + hgt * (0.45 + 0.17 * k), l = hgt * 0.22; wprism(x + hgt * 0.03, yy, z, hgt * 0.02, hgt * 0.006, l * 0.8, 3, a, Math.cos(a) * l, Math.sin(a) * l); }
      break; }
    case 'stump': setCol(PAL.dead); wprism(x, y, z, hgt * 0.4, hgt * 0.32, hgt, 5, rot, 0, 0, true); break;
    default: setCol(PAL.rock); wgem(x, y + hgt * 0.3, z, hgt * 0.75, hgt * 0.7, hgt * 0.6, 5, seed);
  }
}

// ---------------------------------------------------------------- camera, shading, drawing
let cX = 0, cY = 0, cZ = 0, rX = 0, rZ = 0, uX = 0, uY = 0, uZ = 0, fX = 0, fY = 0, fZ = 0, FOC = 1, CX = 0, CY = 0;
function project(x, y, z, out) {
  const dx = x - cX, dy = y - cY, dz = z - cZ, zc = dx * fX + dy * fY + dz * fZ;
  out[0] = CX + FOC * (dx * rX + dz * rZ) / zc; out[1] = CY - FOC * (dx * uX + dy * uY + dz * uZ) / zc; out[2] = zc; return out;
}
const cmp = (a, b) => FD[b] - FD[a];
// Lt: all the lighting and style for this frame
function shadeAll(Lt) {
  const near = Lt.near;
  for (let i = 0; i < nV; i++) { const dx = WX[i] - cX, dy = WY[i] - cY, dz = WZ[i] - cZ, zc = dx * fX + dy * fY + dz * fZ, k = FOC / (zc > near ? zc : near);
    SX[i] = CX + (dx * rX + dz * rZ) * k; SY[i] = CY - (dx * uX + dy * uY + dz * uZ) * k; SD[i] = zc; }
  ON[0] = ON[1] = ON[2] = 0;
  const { sun, sc, as, ag, rim, rc, rk, fogC, fogK, f0, f1, style, paper, edge, lineC, wireBg } = Lt;
  for (let fi = 0; fi < nF; fi++) {
    const s = FS[fi], n = FC[fi], fl = FFL[fi], a = IDX[s], b = IDX[s + 1], c = IDX[s + 2];
    let e1x, e1y, e1z, e2x, e2y, e2z;
    if (n > 3) { const d = IDX[s + 3]; e1x = WX[c] - WX[a]; e1y = WY[c] - WY[a]; e1z = WZ[c] - WZ[a]; e2x = WX[d] - WX[b]; e2y = WY[d] - WY[b]; e2z = WZ[d] - WZ[b]; }
    else { e1x = WX[b] - WX[a]; e1y = WY[b] - WY[a]; e1z = WZ[b] - WZ[a]; e2x = WX[c] - WX[a]; e2y = WY[c] - WY[a]; e2z = WZ[c] - WZ[a]; }
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x; const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-12) continue; nx /= nl; ny /= nl; nz /= nl;
    let mx = 0, my = 0, mz = 0, md = 0, clip = false;
    for (let k = 0; k < n; k++) { const v = IDX[s + k]; mx += WX[v]; my += WY[v]; mz += WZ[v]; md += SD[v]; if (SD[v] < near) clip = true; }
    if (clip) continue; mx /= n; my /= n; mz /= n; md /= n;
    const vx = cX - mx, vy = cY - my, vz = cZ - mz, facing = nx * vx + ny * vy + nz * vz;
    if (fl & DS) { if (facing < 0) { nx = -nx; ny = -ny; nz = -nz; } }
    else { if ((mx - FIX[fi]) * nx + (my - FIY[fi]) * ny + (mz - FIZ[fi]) * nz < 0) { if (facing > 0) continue; nx = -nx; ny = -ny; nz = -nz; } else if (facing < 0) continue; }
    let r = FR[fi], g = FG[fi], bl = FB[fi];
    if (paper) { if (fl & (TERR | UNDER)) { r = lerp(r, 212, 0.7); g = lerp(g, 196, 0.7); bl = lerp(bl, 166, 0.7); } else { r = lerp(r, 250, 0.72); g = lerp(g, 244, 0.72); bl = lerp(bl, 230, 0.72); } }
    let lum = 1;
    if (!(fl & EM)) {
      const ndl = Math.max(0, nx * sun[0] + ny * sun[1] + nz * sun[2]), hm = ny * 0.5 + 0.5;
      let lr = ag[0] + (as[0] - ag[0]) * hm + sc[0] * ndl, lg = ag[1] + (as[1] - ag[1]) * hm + sc[1] * ndl, lb = ag[2] + (as[2] - ag[2]) * hm + sc[2] * ndl;
      if (rk > 0) { const rr = Math.max(0, nx * rim[0] + ny * rim[1] + nz * rim[2]), q = rk * rr * rr; lr += rc[0] * q; lg += rc[1] * q; lb += rc[2] * q; r += 26 * q * rc[0]; g += 26 * q * rc[1]; bl += 26 * q * rc[2]; }
      r *= lr; g *= lg; bl *= lb; lum = (lr + lg + lb) / 3;
    } else { r *= Lt.em; g *= Lt.em; bl *= Lt.em; }
    if (fogK > 0) { const t = fogK * smooth(f0, f1, Math.hypot(mx, mz)); r += (fogC[0] - r) * t; g += (fogC[1] - g) * t; bl += (fogC[2] - bl) * t; }
    r = r > 255 ? 255 : r | 0; g = g > 255 ? 255 : g | 0; bl = bl > 255 ? 255 : bl | 0;
    if (style === 2) { const an = fl & ANIM, k = an ? clamp(0.62 + 0.45 * lum) : fl & (TERR | UNDER) ? 0.34 : 0.5; FCS[fi] = an ? Lt.wireBg2 : wireBg;
      FSS[fi] = an ? `rgb(${lerp(235, r, 0.25) * k | 0},${lerp(250, g, 0.25) * k | 0},${255 * k | 0})` : `rgb(${lineC[0] * k | 0},${lineC[1] * k | 0},${lineC[2] * k | 0})`; }
    else { const cs = `rgb(${r},${g},${bl})`; FCS[fi] = cs;
      FSS[fi] = edge < 0.04 ? cs : `rgb(${lerp(r, lineC[0], edge) | 0},${lerp(g, lineC[1], edge) | 0},${lerp(bl, lineC[2], edge) | 0})`; }
    FD[fi] = md - FBI[fi];
    const layer = fl & UNDER ? 0 : fl & TERR ? 1 : 2; ORD[layer][ON[layer]++] = fi;
  }
  for (let l = 0; l < 3; l++) ORD[l].subarray(0, ON[l]).sort(cmp);
}
function drawLayer(ctx, l) {
  const o = ORD[l], cnt = ON[l];
  for (let i = 0; i < cnt; i++) {
    const fi = o[i], s = FS[fi], n = FC[fi], al = FAL[fi];
    if (al < 1) ctx.globalAlpha = al;
    ctx.beginPath(); let v = IDX[s]; ctx.moveTo(SX[v], SY[v]);
    for (let k = 1; k < n; k++) { v = IDX[s + k]; ctx.lineTo(SX[v], SY[v]); }
    ctx.closePath(); ctx.fillStyle = FCS[fi]; ctx.fill(); ctx.strokeStyle = FSS[fi]; ctx.stroke();
    if (al < 1) ctx.globalAlpha = 1;
  }
}
const css = (c, a = 1) => a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const PT = [0, 0, 0];
function ngon(ctx, x, y, r, n, rot = 0, sy = 1) { ctx.beginPath(); for (let k = 0; k < n; k++) { const a = rot + k / n * TAU; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * sy); } ctx.closePath(); }

// ---------------------------------------------------------------- the engine
export default {
  id: 'lowpoly',
  name: 'Low Poly',
  kind: '2d',
  sky: true,
  params: [
    { id: 'x1', label: 'Spin', value: 0.5, tip: 'How fast the turntable turns (0 stops it; drag to orbit)' },
    { id: 'x2', label: 'Facets', value: 0.5, tip: 'Chunky to fine: sides on the bodies, triangles in the ground' },
    { id: 'x3', label: 'Edges', value: 0.15, tip: 'Visible edges on every facet: none → paper model' },
    { id: 'x4', label: 'Relief', value: 0.5, tip: 'How hilly the ground is' },
  ],
  create(ctx, opts) {
    const O = { ground: 'hex', mode: 'tread', Rk: 0.64, pitch: 0.4, yaw: 0, run: 0, head: 0, depth: 0.62, dens: 1, ...opts };
    const cast = O.cast || [{ sp: 'tyrannosaurus', n: 1 }];
    const plain = O.ground === 'plain', ring = O.mode === 'ring', style = O.style === 'wire' ? 2 : O.style === 'paper' ? 1 : 0;
    const seed = O.seed || 1;
    let actors = [], sig = '', U = 0, scroll = hash(seed, 3) * 400, lastStage = -1, lastEpoch = -1, roarT = -99, lastT = null;
    const phases = [];
    const restX = new Map();
    const midX = (sp, sc, yg) => { const k = sp.id + sc; if (!restX.has(k)) { const q = pose(sp, { scale: sc, young: yg }), h = q.head; restX.set(k, (q.nodes[0].x + h.x + Math.cos(h.a) * h.len) / 2); } return restX.get(k); };

    function recast(f) {
      const ma = f.era.ma, herd = lerp(0.5, 1.5, f.p.herd), list = [];
      for (const c of cast) {
        const sp = c.lock ? species(c.sp) : standIn(c.sp, ma); if (!sp) continue;
        list.push({ sp, n: Math.max(1, Math.round((c.n || 1) * herd)), young: c.young ? Math.max(1, Math.round(c.young * herd)) : 0 });
      }
      const s = list.map(l => l.sp.id + l.n + '.' + l.young).join('|');
      if (s === sig) return;
      sig = s; actors = [];
      let L0 = 0; for (const l of list) L0 = Math.max(L0, l.sp.len);
      const adults = [], young = [];
      for (const l of list) { for (let i = 0; i < l.n; i++) adults.push({ sp: l.sp, scale: 1, young: 0 }); for (let i = 0; i < l.young; i++) young.push({ sp: l.sp, scale: 0.42, young: 1 }); }
      const nA = adults.length, nY = young.length;
      let lane = 0.3 * L0; for (const a of adults) lane = Math.max(lane, 3.3 * a.sp.P.r * a.sp.len * (WIDE[a.sp.plan] ?? 1));
      lane *= 1.12;
      adults.forEach((a, i) => { a.z = (i - (nA - 1) / 2) * lane; a.x = nA > 1 ? ((i * 0.618 + 0.3) % 1 - 0.5) * 0.5 * L0 : 0; });
      young.forEach((a, j) => { const sd = j & 1 ? 1 : -1;
        if (nA >= 2) { a.z = (j - (nY - 1) / 2) * lane * 0.55; a.x = -(0.62 + 0.14 * (j % 3)) * L0; }
        else { a.z = sd * lane * 0.7 * (1 + (j >> 1) * 0.5); a.x = (-0.12 - (j >> 1) * 0.3 + (j & 1) * 0.2) * L0; } });
      actors = adults.concat(young);
      let lo = 1e9, hi = -1e9, zm = 0;
      for (const a of actors) { const hl = a.sp.len * a.scale * 0.5; lo = Math.min(lo, a.x - hl); hi = Math.max(hi, a.x + hl); zm = Math.max(zm, Math.abs(a.z)); }
      actors.forEach((a, i) => { a.i = i; if (!ring) a.x -= (lo + hi) / 2 + midX(a.sp, a.scale, a.young); if (phases[i] == null) phases[i] = hash(i, seed) * 3; a.prev = 0; });
      actors.L0 = L0; actors.lane = lane; actors.nA = nA;
      const n = actors.length;
      actors.ringR = ring ? Math.max(0.8 * L0, L0 * n * 1.16 / TAU) : 0;
      actors.R = ring ? actors.ringR + 0.36 * L0 : Math.max(O.Rk * L0, (hi - lo) * 0.5 * O.Rk / 0.6, zm + 0.3 * L0);
      let tall = 0; for (const a of actors) tall = Math.max(tall, size(a.sp).tall * a.scale);
      actors.R = Math.max(actors.R, tall * 1.05); actors.tall = tall;
      if (!n) { actors.R = 6; actors.tall = 0; }
    }

    function render(f) {
      const { w, h, p } = f, E = f.era, t = f.t, dt = Math.min(0.1, Math.max(0, lastT == null ? 0 : f.t - lastT)); lastT = f.t;
      recast(f);
      const jump = Math.abs(f.stage - lastStage) > 0.03 || f.epoch !== lastEpoch || U === 0; lastStage = f.stage; lastEpoch = f.epoch;
      U = jump ? actors.R : U + (actors.R - U) * (1 - Math.exp(-dt * 2.5));
      const fac = p.x2, edgeP = style === 1 ? Math.max(p.x3, 0.5) : p.x3;
      const sides = Math.round(lerp(4, 8, fac)), coarse = fac < 0.3;

      // ---- light
      const dark = E.dark, light = clamp(p.light) * (1 - 0.55 * dark), dl = daylight(light), el = lerp(0.28, 0.95, smooth(0.15, 1, light));
      const yaw = O.yaw + (O.swing ? O.swing * Math.sin(t * 0.16 * (p.x1 * 2)) : t * 0.2 * p.x1 * (O.spin ?? 1)) + f.pointer.dragX * 2.6;
      const back = f.backdrop && plain;
      const pitch = clamp((back ? O.pitch * 0.5 : O.pitch) + f.pointer.dragY * 1.3, 0.03, 1.35);
      const cy_ = Math.cos(yaw), sy_ = Math.sin(yaw), cp = Math.cos(pitch), sp_ = Math.sin(pitch);
      const saz = O.sunAz ?? -0.85;      // sun to the left of the camera and a little in front of the subject
      const hx = Math.cos(saz) * sy_ + Math.sin(saz) * cy_, hz = Math.cos(saz) * cy_ - Math.sin(saz) * sy_;
      const sun = [hx * Math.cos(el), Math.sin(el), hz * Math.cos(el)];
      const nt = dl.night, dk = dl.dusk * (1 - nt);
      const sc = mix3(mix3([0.86, 0.83, 0.76], [1.0, 0.62, 0.36], dk), [0.2, 0.26, 0.46], nt);
      const as = mix3(mix3([0.56, 0.62, 0.72], [0.56, 0.44, 0.5], dk), [0.12, 0.16, 0.32], nt);
      const ag = mix3(mix3([0.4, 0.38, 0.36], [0.36, 0.26, 0.26], dk), [0.06, 0.07, 0.15], nt);
      const dim = 1 - 0.3 * dark; for (let i = 0; i < 3; i++) { sc[i] *= dim * (style === 1 ? 0.6 : 1); as[i] = as[i] * dim + (style === 1 ? 0.2 : 0); ag[i] = ag[i] * dim + (style === 1 ? 0.2 : 0); }
      const rimK = (O.rim ?? 0) * 0.5 + nt * 1.5;
      let rim = [-sy_ * 0.8 + cy_ * 0.25, 0.55, -cy_ * 0.8 - sy_ * 0.25]; { const d = Math.hypot(rim[0], rim[1], rim[2]); rim = rim.map(v => v / d); }
      const rc = mix3([1, 0.86, 0.7], [0.62, 0.78, 1.0], nt);

      // ---- sky colours
      const day = smooth(0.25, 0.6, light);
      let skyT = mix3(mix3(mix3([70, 84, 150], [84, 152, 222], day), [58, 60, 120], dk), [7, 10, 30], nt);
      let skyB = mix3(mix3(mix3([240, 190, 150], [200, 228, 240], day), [250, 168, 106], dk), [30, 40, 86], nt);
      if (O.skyT) { skyT = mix3(O.skyT, [7, 10, 30], nt * 0.8); skyB = mix3(O.skyB || O.skyT, [30, 40, 86], nt * 0.8); }
      if (style === 1) { skyT = [226, 216, 196]; skyB = [240, 232, 214]; }
      if (style === 2) { skyT = [8, 20, 44]; skyB = [14, 34, 66]; }
      if (dark > 0) { skyT = mix3(skyT, [40, 28, 24], dark * 0.8); skyB = mix3(skyB, [104, 62, 38], dark * 0.8); }

      // ---- geometry of the diorama
      const zoom = 0.6 + 0.8 * p.scale;
      FOC = (plain ? 1.5 : 2.3) * h;
      const ppu = Math.min(0.37 * w, (plain ? 0.62 : 0.56) * h) / U * zoom * (O.zoom || 1), D = FOC / ppu;
      const ty = (O.ty ?? (plain ? 0.2 : 0.06)) * U + Math.max(0, (actors.tall || 0) - 0.62 * U) * 0.5;
      cX = D * cp * sy_; cY = ty + D * sp_; cZ = D * cp * cy_;
      fX = -cp * sy_; fY = -sp_; fZ = -cp * cy_; rX = cy_; rZ = -sy_; uX = -sy_ * sp_; uY = cp; uZ = -cy_ * sp_;
      CX = w * 0.5; CY = plain ? (back ? 0.56 : O.horizon ?? 0.4) * h + FOC * Math.tan(pitch) : h * (O.cy ?? 0.47);
      const horizonY = CY - FOC * Math.tan(pitch);

      // ---- ground model
      const J = plain ? Math.round(lerp(9, 17, fac)) : Math.round(lerp(3, 8, fac));
      Ghex = O.ground === 'hex'; GR = plain ? U * 4.6 : U; GJ = J; Gunit = U; Gseed = seed * 7.1;
      Gcz = (Ghex ? GR * 0.8660254 : GR * 0.97) / J; Gcs = GR / J * (Ghex ? 1 : 1.05);
      Gamp = U * (plain ? 0.11 : 0.075) * p.x4 * 2 * (O.relief ?? 1); Gfade = plain ? 0.3 : 0.25;
      // how fast the ground goes by
      const alive = a => a.sp.plan === 'bird' && f.stage > 0.86 ? smooth(0.925, 0.95, f.stage) : E.dinos;
      const lead = actors[0], en = energy(f);
      let move = 1, act = 0;
      if (O.pause && lead) { const [tw, ts] = O.pause, tc = (t / Math.sqrt(en) + hash(seed, 8) * 40) % (tw + ts);
        if (tc < tw) move = Math.min(1, tc / 1.2, (tw - tc) / 1.2); else { move = 0; act = Math.sin(PI * (tc - tw) / ts); act = smooth(0, 0.7, act); } }
      for (const c of f.pointer.clicks || []) { roarT = f.clock; if (f.sig) f.sig.roar = 1; }
      const roar = Math.max(0, 1 - Math.abs((f.clock - roarT) - 0.7) / 0.7);
      let speed = 0;
      if (lead) { const g = gait(lead.sp, O.run, 1); speed = g.speed * (0.55 + 0.45 * en) * move * smooth(0, 0.6, alive(lead)); }
      if (jump && lead && dt === 0) scroll = hash(seed, 3) * 400;
      if (!ring) scroll += speed * dt;
      Gs = ring ? 0 : scroll;
      buildGrid();

      // ground colours for the era
      const burnt = clamp(dark * 1.1 + (1 - E.dinos) * (1 - E.ferns) * 0.45);
      let earth = mix3([186, 158, 116], [204, 142, 96], clamp(E.dry * 1.6 - 0.45)), cover = mix3([112, 150, 82], [150, 158, 92], clamp(E.dry * 1.5 - 0.3));
      if (O.sand) { earth = [224, 196, 146]; cover = [206, 172, 120]; }
      cover = mix3(cover, [96, 156, 84], E.ferns * 0.8);
      earth = mix3(earth, [82, 74, 70], burnt * 0.85); cover = mix3(cover, [66, 62, 60], burnt * (1 - E.ferns * 0.7));
      const G = { earth, cover, green: clamp(1.3 - E.dry * 1.25) + (O.sand ? -0.2 : 0.1), soil: mix3([126, 92, 62], [60, 52, 48], burnt * 0.7), rock: mix3([146, 136, 126], [96, 90, 88], burnt * 0.6), depth: O.depth };
      PAL = { trunk: [122, 92, 62], red: [150, 86, 60], pine: [50, 110, 70], pine2: [72, 132, 76], leaf: [70, 136, 62], leaf2: [112, 160, 70], ginkgo: [150, 170, 70],
        flower: [244, 190, 214], flower2: [250, 226, 130], dead: [104, 94, 86], rock: [150, 144, 136] };
      if (burnt > 0) for (const k of ['pine', 'pine2', 'leaf', 'leaf2', 'ginkgo', 'trunk', 'red']) PAL[k] = mix3(PAL[k], [70, 62, 56], burnt * (k === 'leaf2' ? 1 - E.ferns : 0.9));

      nV = nF = nI = 0; cAl = 1;
      const lanes = [];
      if (ring) lanes.push({ ring: 1, r: actors.ringR, w: actors.L0 * 0.16 });
      else for (const a of actors) if (!a.young) lanes.push({ z: a.z, w: Math.max(0.1 * U, a.sp.P.r * a.sp.len * 1.6) });
      emitTerrain(G, lanes);
      if (!plain) emitUnder(G);

      // ---- plants: one per cell of the endless ground, chosen by the era
      const shadows = [];
      {
        const fl = flora(E), W8 = O.flora || {}, kinds = Object.keys(fl), wts = kinds.map(k => fl[k] * (W8[k] ?? 1)); let tot = 0; for (const v of wts) tot += v;
        const pc = U * (plain ? 0.62 : 0.3), dens = clamp(lerp(0.2, 0.75, p.detail) * O.dens * (plain ? 0.75 : 1), 0, 0.95), ext = plain ? GR * 0.86 : GR;
        const i0 = Math.floor((Gs - ext) / pc), i1 = Math.ceil((Gs + ext) / pc), j1 = Math.ceil(ext / pc), cap = (O.tree ?? (plain ? 1.5 : 0.7)) * U, wx = windX(p.wind);
        for (let ci = i0; ci <= i1; ci++) for (let cj = -j1; cj <= j1; cj++) {
          const h1 = hash(ci, cj, seed + 0.5); if (h1 > dens) continue;
          const x = (ci + 0.15 + 0.7 * hash(ci, cj, 2.5)) * pc - Gs, z = (cj + 0.15 + 0.7 * hash(ci, cj, 4.5)) * pc;
          const ed = plain ? ext - Math.hypot(x, z) : edgeDist(x, z); if (ed < 0.04 * U) continue;
          let pick = hash(ci, cj, 6.5) * tot, ki = 0; while (ki < wts.length - 1 && pick > wts[ki]) pick -= wts[ki++];
          let kind = kinds[ki]; if (kind === 'rock' && hash(ci, cj, 8.5) < 0.4) kind = 'boulder';
          const tall = !PLANTS[kind]?.low, hk = 0.75 + 0.5 * hash(ci, cj, 10.5);
          let hgt = Math.max(Math.min((PLANTS[kind]?.h || 1) * hk, (tall ? cap : 0.2 * U) * hk), U * 0.05);
          // keep the animals' way clear, and tall trees off the middle of a tile
          let clear = 1e9;
          for (const l of lanes) clear = Math.min(clear, (l.ring ? Math.abs(Math.hypot(x, z) - l.r) : Math.abs(z - l.z)) - l.w * 1.5);
          if (ring ? clear < (tall ? 0.16 * U : 0.02 * U) || Math.hypot(x, z) < 0.3 * U : clear < (tall ? 0.12 * U : 0.03 * U) + hgt * (tall ? 0.22 : 0.3)) continue;
          if (!plain && !ring && tall && Math.abs(z) < 0.34 * U) continue;
          let k = plain ? smooth(0, 0.5 * U, ed) : smooth(0.03 * U, 0.2 * U, ed);
          // tall plants duck out of the way between the camera and the animals
          if (tall) { const along = x * sy_ + z * cy_, dC = along > 0 ? Math.abs(x * cy_ - z * sy_) : Math.hypot(x, z); k *= plain ? smooth(0.75 * U, 1.3 * U, dC) : smooth(0.45 * U, 0.8 * U, dC); }
          if (k < 0.08) continue;
          hgt *= k;
          const far = plain && Math.hypot(x - cX, z - cZ) > D * 1.4, y = groundH(x, z);
          buildPlant(kind, x, y, z, hgt, ci * 131 + cj * 17 + 5, (tall ? 0.012 : 0.03) * Math.sin(t * 1.4 + ci + cj * 1.7) * (0.4 + Math.abs(wx)) * Math.sign(wx || 1), far);
          if (!far || tall) shadows.push(x, y, z, hgt * (tall ? 0.26 : 0.5));
        }
        if (ring) { // something to run round
          const y = groundH(0, 0); buildPlant('boulder', 0, y, 0, U * 0.17, 91, 0, false); buildPlant(fl.cycad > 0.3 ? 'cycad' : 'fern', U * 0.16, groundH(U * 0.16, U * 0.08), U * 0.08, U * 0.26, 92, 0, false);
          shadows.push(0, y, 0, U * 0.2); }
      }

      // ---- animals
      let count = 0;
      const shA = [];
      for (const a of actors) {
        const al = alive(a); if (al < 0.03) continue; count++;
        const sp = a.sp, run = clamp(O.run + (a.young ? 0.2 : 0));
        const g = gait(sp, run, a.scale);
        phases[a.i] = (phases[a.i] || 0) + speed * dt / g.stride;
        const k = a.i * 1.7, mine = clamp(act * (0.75 + 0.5 * hash(a.i, 5)));
        let headTo = O.head + 0.12 * Math.sin(t * 0.5 + k), jaw = 0;
        const actK = O.pause ? O.pause[2] : '';
        if (actK === 'graze') headTo = lerp(headTo, -1, mine); else if (actK === 'browse') headTo = lerp(headTo, 1, mine);
        else if (actK === 'roar') { headTo = lerp(headTo, 0.6, mine); jaw = mine * (0.75 + 0.25 * Math.sin(f.clock * 17)); if (f.sig && act > 0.5 && act < 0.6) f.sig.roar = 1; }
        else if (actK === 'look') headTo = lerp(headTo, 0.8, mine);
        if (roar > 0) { jaw = Math.max(jaw, roar); headTo = lerp(headTo, 0.5, roar); }
        if (run > 0.4 && sp.diet === 'carnivore') jaw = Math.max(jaw, 0.25 + 0.2 * Math.sin(t * 3 + k));
        let gy;
        if (ring) { tMode = 1; tR = actors.ringR; tA = (a.i / actors.length) * TAU + (O.yaw0 || 0) + (ringDist / tR); const A0 = tA, R0 = tR; gy = dx => groundH(R0 * Math.cos(A0 + dx / R0), R0 * Math.sin(A0 + dx / R0)); }
        else { tMode = 0; tPX = a.x; tPZ = a.z; tC = 1; tS = 0; const ax = a.x, az = a.z; gy = dx => groundH(ax + dx, az); }
        const q = pose(sp, { phase: phases[a.i], run, headTo, jaw, t: t + k, scale: a.scale, young: a.young, gy, crouch: 1 - smooth(0.2, 0.9, al) });
        cAl = al < 0.98 ? al : 1;
        const f0 = nF;
        buildDino(q, 100 + a.i * 13, a.young ? Math.max(4, sides - 1) : sides, coarse || (a.young && sides < 7));
        for (let i = f0; i < nF; i++) FFL[i] |= ANIM;
        cAl = 1;
        // shadow outline: an ellipse under the body, bent the same way
        { const n = q.nodes, x0 = n[0].x * 0.8, x1 = q.head.x + q.head.len * 0.6, wd = n[q.iHip + 2].r * (WIDE[sp.plan] ?? 0.85) * 1.5, pts = [];
          for (let i = 0; i < 12; i++) { const an = i / 12 * TAU, lx = (x0 + x1) / 2 + Math.cos(an) * (x1 - x0) / 2, lz = Math.sin(an) * wd * (0.55 + 0.45 * smooth(-1, 0.2, Math.cos(an - 0.4)));
            xf(lx, 0, lz); pts.push(oX - sun[0] * q.H * 0.35, oZ - sun[2] * q.H * 0.35); }
          shA.push(pts); }
        // footfalls and signals
        let st = 0; q.legs.forEach((l, i) => { if (l.stance) st |= 1 << i; });
        if (f.sig && (st & ~a.prev) && sp.mass > 1500 && speed > 0 && dt > 0) f.sig.step = 1;
        a.prev = st;
      }
      if (ring) ringDist += gait(lead ? lead.sp : 'velociraptor', O.run, 1).speed * (0.55 + 0.45 * en) * dt * (lead ? smooth(0, 0.6, alive(lead)) : 0);
      if (ring && lead) { const g = gait(lead.sp, O.run, 1); for (const a of actors) phases[a.i] += g.speed * (0.55 + 0.45 * en) * dt * smooth(0, 0.6, alive(lead)) / gait(a.sp, O.run, a.scale).stride; }
      if (f.sig) { f.sig.count = clamp(count / 8); f.sig.speed = clamp(speed / 8 + (ring ? O.run : 0)); }

      // ---- shade, sort and draw
      const lineC = style === 2 ? [120, 214, 255] : style === 1 ? [84, 66, 54] : [24, 22, 30];
      const fogC = mix3(skyB, G.cover, 0.12);
      shadeAll({ sun, sc, as, ag, rim, rc, rk: rimK, fogC, fogK: plain ? 0.94 : 0, f0: GR * 0.22, f1: GR * 0.98, style, paper: style === 1, edge: style === 2 ? 1 : clamp(edgeP * 0.9), lineC,
        wireBg: css(mix3(skyT, skyB, 0.5)), wireBg2: css(mix3(mix3(skyT, skyB, 0.5), [60, 110, 170], 0.3)), near: D * 0.08, em: 0.45 + 0.55 * light });

      const combo = f.combo;
      sky(f, () => {
        const g = ctx.createLinearGradient(0, 0, 0, plain ? horizonY : h);
        g.addColorStop(0, css(skyT)); g.addColorStop(1, css(skyB)); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        if (style === 2) { ctx.strokeStyle = 'rgba(120,200,255,0.09)'; ctx.lineWidth = Math.max(1, h / 540); const st = h / 12; ctx.beginPath();
          for (let x = (w / 2) % st; x < w; x += st) { ctx.moveTo(x, 0); ctx.lineTo(x, h); } for (let y = st / 2; y < h; y += st) { ctx.moveTo(0, y); ctx.lineTo(w, y); } ctx.stroke(); return; }
        if (style === 1) return;
        // stars, then a faceted sun or moon with a glow
        const a = 1 - dark;
        if (nt > 0.2) { ctx.fillStyle = `rgba(230,236,255,${(nt - 0.2) * a})`; for (let i = 0; i < 70; i++) { const r = h * (0.002 + 0.004 * hash(i, 5)) * (0.7 + 0.3 * Math.sin(f.clock * 2 + i)); ngon(ctx, hash(i, 1) * w, hash(i, 2) * h * 0.8, r, 4); ctx.fill(); } }
        const mx = w * (O.sunX ?? 0.2), my = h * (nt > 0.5 ? O.moonY ?? 0.24 : lerp(0.5, 0.16, smooth(0.1, 0.9, light))), mr = h * (nt > 0.5 ? O.moonR ?? 0.085 : 0.06);
        const gc = nt > 0.5 ? [200, 216, 255] : mix3([255, 236, 190], [255, 190, 120], dk);
        const gl = ctx.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 4.5); gl.addColorStop(0, css(gc, 0.55 * a)); gl.addColorStop(1, css(gc, 0));
        ctx.fillStyle = gl; ctx.fillRect(mx - mr * 5, my - mr * 5, mr * 10, mr * 10);
        if (nt > 0.5) { ctx.fillStyle = css([236, 240, 250], a); ngon(ctx, mx, my, mr, 9, 0.3); ctx.fill();
          ctx.fillStyle = css([206, 214, 234], a); for (let k = 0; k < 4; k++) { ngon(ctx, mx + mr * [0.3, -0.35, 0.05, -0.1][k], my + mr * [-0.3, 0.1, 0.45, -0.5][k], mr * [0.22, 0.28, 0.16, 0.12][k], 5, k); ctx.fill(); }
          ctx.fillStyle = css([250, 252, 255], a * 0.8); ctx.beginPath(); ctx.moveTo(mx, my); for (let k = 0; k <= 3; k++) { const an = 0.3 + (k + 5.5) / 9 * TAU; ctx.lineTo(mx + Math.cos(an) * mr, my + Math.sin(an) * mr); } ctx.fill(); }
        else { ctx.fillStyle = css(mix3([255, 246, 214], [255, 214, 150], dk), a); ngon(ctx, mx, my, mr, 8, t * 0.05); ctx.fill(); ctx.fillStyle = css([255, 255, 240], a * 0.7); ngon(ctx, mx, my, mr * 0.62, 8, -t * 0.05); ctx.fill(); }
        // faceted clouds drifting behind the tile
        if (!plain || !back) { const wxd = windX(p.wind), cc = mix3(mix3([255, 255, 255], skyB, 0.25 + 0.5 * nt), [60, 50, 46], dark * 0.8), cs = mix3(cc, skyT, 0.3);
          for (let i = 0; i < 5; i++) { const u = (hash(i, 31) + t * 0.006 * (0.5 + hash(i, 32)) * (wxd || 1)) % 1, x = ((u + 1) % 1) * w * 1.4 - w * 0.2, y = h * (plain ? 0.08 + 0.22 * hash(i, 33) : 0.12 + 0.76 * hash(i, 33)), s = h * (0.05 + 0.05 * hash(i, 34));
            ctx.globalAlpha = (0.5 + 0.4 * hash(i, 35)) * (1 - 0.6 * nt);
            ctx.fillStyle = css(cs); ctx.beginPath(); ctx.moveTo(x - s * 2.2, y); ctx.lineTo(x - s * 1.4, y - s * 0.7); ctx.lineTo(x - s * 0.5, y - s * 0.6); ctx.lineTo(x + s * 0.2, y - s * 1.3); ctx.lineTo(x + s * 1.3, y - s * 0.8); ctx.lineTo(x + s * 2.3, y); ctx.fill();
            ctx.fillStyle = css(cc); ctx.beginPath(); ctx.moveTo(x - s * 1.4, y - s * 0.7); ctx.lineTo(x - s * 0.5, y - s * 0.6); ctx.lineTo(x + s * 0.2, y - s * 1.3); ctx.lineTo(x + s * 0.5, y - s * 0.3); ctx.lineTo(x - s * 0.9, y - s * 0.2); ctx.fill(); }
          ctx.globalAlpha = 1; }
      });

      // the fireball
      if (E.meteor > 0 && E.meteor < 1.05) { const u = E.meteor, x = lerp(w * 1.02, w * 0.3, u), y = lerp(-h * 0.05, plain ? horizonY : h * 0.62, u), r = h * 0.035;
        ctx.fillStyle = 'rgba(255,150,60,0.55)'; ctx.beginPath(); ctx.moveTo(x - r * 0.5, y + r * 0.8); ctx.lineTo(x + r * 0.8, y - r * 0.5); ctx.lineTo(x + w * 0.2, y - h * 0.19); ctx.fill();
        ctx.fillStyle = 'rgba(255,214,130,0.8)'; ctx.beginPath(); ctx.moveTo(x - r * 0.2, y + r * 0.5); ctx.lineTo(x + r * 0.5, y - r * 0.2); ctx.lineTo(x + w * 0.1, y - h * 0.095); ctx.fill();
        ctx.fillStyle = '#fff6da'; ngon(ctx, x, y, r, 6, t * 3); ctx.fill(); }

      ctx.lineJoin = 'round';
      if (plain) { // the far ground out to the horizon, and a ring of faceted hills on it
        const far = shadeFar(G, fogC, light, as, sc);
        const g = ctx.createLinearGradient(0, horizonY, 0, h); g.addColorStop(0, css(mix3(far, skyB, 0.55))); g.addColorStop(0.25, css(far)); g.addColorStop(1, css(far));
        if (!f.backdrop && style !== 2) { for (let i = 0; i < 26; i++) { const az = (i + hash(i, seed + 2) * 0.6) / 26 * TAU, bw = 0.09 + 0.1 * hash(i, 41), ph = 0.035 + 0.06 * hash(i, 42), Rm = 1e5;
          const a0 = project(Math.sin(az - bw) * Rm, 0, Math.cos(az - bw) * Rm, [0, 0, 0]), a1 = project(Math.sin(az + bw) * Rm, 0, Math.cos(az + bw) * Rm, [0, 0, 0]), ap = project(Math.sin(az + bw * 0.2) * Rm, ph * Rm, Math.cos(az + bw * 0.2) * Rm, [0, 0, 0]);
          if (a0[2] < 1 || a1[2] < 1 || ap[2] < 1) continue;
          const mc = mix3(mix3([112, 124, 150], skyB, 0.45 + 0.3 * hash(i, 43)), [40, 32, 30], dark * 0.7), md = [(a0[0] + a1[0]) / 2 + (ap[0] - (a0[0] + a1[0]) / 2) * 0.2, a0[1]];
          ctx.fillStyle = css(mc, style === 1 ? 0.35 : 1); ctx.beginPath(); ctx.moveTo(a0[0], a0[1] + 1); ctx.lineTo(ap[0], ap[1]); ctx.lineTo(md[0], md[1] + 1); ctx.fill();
          ctx.fillStyle = css(mix3(mc, skyT, 0.25), style === 1 ? 0.35 : 1); ctx.beginPath(); ctx.moveTo(md[0], md[1] + 1); ctx.lineTo(ap[0], ap[1]); ctx.lineTo(a1[0], a1[1] + 1); ctx.fill(); } }
        ctx.fillStyle = style === 2 ? css(mix3(skyT, skyB, 0.5)) : g; ctx.fillRect(0, horizonY, w, h - horizonY);
        if (style === 2) { ctx.strokeStyle = 'rgba(120,214,255,0.5)'; ctx.lineWidth = Math.max(1, h / 400); ctx.beginPath(); ctx.moveTo(0, horizonY); ctx.lineTo(w, horizonY); ctx.stroke(); }
      }
      ctx.lineWidth = Math.max(0.6, (style === 2 ? 0.9 : 0.6 + 1.1 * edgeP) * h / 540);
      drawLayer(ctx, 0); drawLayer(ctx, 1);
      // soft flat shadows on the ground
      if (style !== 2) { ctx.fillStyle = `rgba(${style === 1 ? '70,56,44' : '14,18,34'},${(0.2 + 0.14 * (1 - nt)) * (1 - 0.5 * dark) * (style === 1 ? 0.6 : 1)})`;
        for (const pts of shA) { ctx.beginPath(); let ok = true; for (let i = 0; i < pts.length; i += 2) { project(pts[i], groundH(pts[i], pts[i + 1]) + U * 0.004, pts[i + 1], PT); if (PT[2] < D * 0.08) ok = false; ctx.lineTo(PT[0], PT[1]); } if (ok) ctx.fill(); }
        for (let i = 0; i < shadows.length; i += 4) { const r = shadows[i + 3], x = shadows[i] - sun[0] * r * 0.5, z = shadows[i + 2] - sun[2] * r * 0.5; ctx.beginPath(); let ok = true;
          for (let k = 0; k < 6; k++) { const an = k / 6 * TAU; project(x + Math.cos(an) * r, shadows[i + 1] + U * 0.004, z + Math.sin(an) * r, PT); if (PT[2] < D * 0.08) ok = false; ctx.lineTo(PT[0], PT[1]); } if (ok) ctx.fill(); } }
      drawLayer(ctx, 2);

      // ---- the impact: ash in the air, and the flash
      if (dark > 0.05) { ctx.fillStyle = `rgba(190,180,170,${0.5 * dark})`; for (let i = 0; i < 46; i++) { const x = (hash(i, 51) + 0.02 * Math.sin(t * 0.7 + i)) * w, y = ((hash(i, 52) + t * (0.03 + 0.03 * hash(i, 53))) % 1) * h; ngon(ctx, x, y, h * (0.003 + 0.004 * hash(i, 54)), 4); ctx.fill(); } }
      if (E.flash > 0.01) { if (combo) ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = `rgba(255,244,214,${E.flash * 0.85})`; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over'; }
    }
    let ringDist = hash(seed, 12) * 50;
    const shadeFar = (G, fogC, light, as, sc) => { const k = (as[0] + as[1] + as[2]) / 3 + (sc[0] + sc[1] + sc[2]) / 3 * 0.6; return mix3(mix3(G.earth, G.cover, clamp(G.green)).map(v => Math.min(255, v * k)), fogC, 0.94); };
    return { render };
  }
};

// ---------------------------------------------------------------- scenes
const S = (id, name, desc, tags, opts, params) => ({ id: 'lowpoly-' + id, name, desc, tags: ['low poly', '3d', ...tags], opts, params });
export const scenes = [
  S('rex', 'T. rex on a Hex Tile', 'A faceted Tyrannosaurus strides across a hexagonal slice of Late Cretaceous Montana floating in the sky, and stops to roar. Drag to orbit.',
    ['theropod', 'cretaceous'],
    { cast: [{ sp: 'tyrannosaurus', n: 1 }], ground: 'hex', pause: [10, 3.5, 'roar'], yaw: -0.55, pitch: 0.36, seed: 3 },
    { stage: 0.855, light: 0.85 }),
  S('trike', 'Triceratops Family', 'Two adults and their calves cross a round island tile at golden hour, stopping to graze on ferns.',
    ['ceratopsian', 'cretaceous', 'family', 'herd'],
    { cast: [{ sp: 'triceratops', n: 2, young: 2 }], ground: 'round', pause: [12, 5, 'graze'], yaw: -0.7, pitch: 0.42, Rk: 0.6, seed: 5 },
    { stage: 0.855, light: 0.34 }),
  S('stego', 'Stegosaurus Among Conifers', 'A plated Stegosaurus walks a rolling triangulated plain of the Late Jurassic Morrison, between low-poly conifers that reach to the horizon.',
    ['stegosaur', 'jurassic'],
    { cast: [{ sp: 'stegosaurus', n: 1 }], ground: 'plain', pause: [14, 5, 'graze'], yaw: -0.5, pitch: 0.2, swing: 0.9, Rk: 0.74, flora: { conifer: 5, araucaria: 2, redwood: 2, fern: 1.5 }, dens: 1.3, seed: 8 },
    { stage: 0.43, light: 0.8 }),
  S('brachio', 'Brachiosaurus Pair', 'Two giant Brachiosaurus browse their way across an open plain, heads far above the monkey-puzzle trees.',
    ['sauropod', 'jurassic', 'herd'],
    { cast: [{ sp: 'brachiosaurus', n: 2 }], ground: 'plain', pause: [12, 6, 'browse'], head: 0.3, yaw: -0.75, pitch: 0.17, swing: 0.8, Rk: 0.62, ty: 0.32, tree: 0.7, flora: { araucaria: 4, conifer: 2, cycad: 2 }, seed: 11 },
    { stage: 0.447, light: 0.62 }),
  S('raptors', 'Raptor Ring', 'A pack of feathered Velociraptor runs nose to tail round a boulder on a desert tile, bodies bent into the turn.',
    ['theropod', 'cretaceous', 'herd'],
    { cast: [{ sp: 'velociraptor', n: 5 }], ground: 'round', mode: 'ring', run: 0.7, sand: 1, yaw: 0.3, pitch: 0.5, dens: 0.7, depth: 0.42, seed: 13 },
    { stage: 0.806, light: 0.9, activity: 0.6 }),
  S('anky', 'Ankylosaurus', 'The living tank on its own hex tile: rows of bony studs, horned head and a tail club, low to the ground.',
    ['ankylosaur', 'cretaceous'],
    { cast: [{ sp: 'ankylosaurus', n: 1 }], ground: 'hex', pause: [11, 5, 'graze'], yaw: -0.9, pitch: 0.5, Rk: 0.6, sunAz: -0.5, seed: 17 },
    { stage: 0.86, light: 0.7, x2: 0.6 }),
  S('night', 'Moonlit Spinosaurus', 'A night diorama: Spinosaurus under a glowing faceted moon, its sail and back picked out by cold rim light.',
    ['theropod', 'cretaceous', 'night'],
    { cast: [{ sp: 'spinosaurus', n: 1 }], ground: 'round', pause: [12, 4, 'look'], yaw: -0.6, pitch: 0.3, sunX: 0.72, moonY: 0.2, moonR: 0.11, rim: 1, tree: 0.42, flora: { ginkgo: 0, magnolia: 0 }, seed: 21 },
    { stage: 0.71, light: 0.04, x3: 0.1 }),
  S('paper', 'Paper Model', 'Parasaurolophus and its young as a papercraft kit: pale card facets with every fold line drawn.',
    ['ornithopod', 'cretaceous', 'family', 'paper'],
    { cast: [{ sp: 'parasaurolophus', n: 1, young: 2 }], ground: 'hex', style: 'paper', pause: [10, 4, 'look'], yaw: -0.65, pitch: 0.4, Rk: 0.66, seed: 23 },
    { stage: 0.81, light: 0.85, x3: 0.75 }),
  S('wire', 'Wireframe Diplodocus', 'A hidden-line wireframe on blueprint blue: every triangle of a 26-metre Diplodocus and the plain it walks on.',
    ['sauropod', 'jurassic', 'wireframe'],
    { cast: [{ sp: 'diplodocus', n: 1 }], ground: 'plain', style: 'wire', yaw: -0.6, pitch: 0.34, swing: 1.1, Rk: 0.42, ty: 0.1, dens: 0.5, tree: 0.5, horizon: 0.3, seed: 27 },
    { stage: 0.43, light: 0.8, x3: 1 }),
  S('lapse', 'Turntable Through Time', 'One tile, 180 million years: the top predator of each age takes its turn on the turntable as the plants change, until the asteroid falls and the birds inherit the tile.',
    ['theropod', 'triassic', 'jurassic', 'cretaceous', 'time travel'],
    { cast: [{ sp: 'tyrannosaurus', n: 1 }], ground: 'round', yaw: -0.5, pitch: 0.4, seed: 31 },
    { stage: 0.05, grow: 0.5, light: 0.75 }),
];
