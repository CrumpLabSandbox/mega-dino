// The dinosaur rig: one skeleton model for every walking species, shared by all engines.
//   pose(species, { phase, run, headTo, jaw, crouch, rear, t, gy, scale, young }) → joints in metres
//   parts(pose)    → what to draw, back to front, as polygons / circles / lines tagged with a kind and a tone
//   bones(pose)    → the same animal as a skeleton
//   topParts(pose) → seen from above        capsules(pose) → 3D capsules for raymarchers and voxelisers
// Body frame: x forward (the animal faces +x), y up, origin on the ground under the hips, units metres.
// Nothing here touches a canvas: engines style the parts however they like (see draw.js for ready-made stylers).
import { clamp, lerp, fract } from './util.js';
import { species } from './species.js';

const TAU = Math.PI * 2, PI = Math.PI;
const sm = t => t * t * (3 - 2 * t);
const ZERO = () => 0;
const NT = 5, NN = 6, NL = 10;      // torso, neck and tail segments

// How a species moves at a given effort: run 0 = walk … 1 = flat out. Speeds in m/s, stride in metres per cycle.
export function gait(spIn, run = 0, scale = 1) {
  const sp = species(spIn), P = sp.P, H = P.hipH * sp.len * scale;
  const vWalk = 1.05 * Math.sqrt(H) * (P.toes === 'pad' ? 0.8 : 1);
  const top = Math.max(vWalk * 1.25, P.top * Math.sqrt(Math.min(1, scale * 1.4)));
  return { H, stride: H * P.stride * lerp(1.55, 2.9, run), duty: lerp(0.66, 0.4, run), vWalk, top, speed: lerp(vWalk, top, run) };
}
// shoulder height, top of the head at rest and overall height: for framing a species (metres at scale 1)
export function size(spIn) {
  const sp = species(spIn);
  if (sp._size) return sp._size;
  if (sp.kind !== 'walk') return sp._size = { len: sp.len, hip: sp.len * 0.2, tall: sp.len * 0.35 };
  const p = pose(sp, {});
  let tall = 0; for (const n of p.nodes) tall = Math.max(tall, n.y + n.r);
  tall = Math.max(tall, p.head.y + p.head.len * 0.5);
  return sp._size = { len: sp.len, hip: p.H, tall };
}

// joint of a two-bone chain from a to b; bend = +1 puts the joint to the left of a→b (a knee, pointing forward)
function ik2(ax, ay, bx, by, l1, l2, bend) {
  const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 1e-6;
  const dm = Math.max(Math.abs(l1 - l2) * 1.02, Math.min(d, (l1 + l2) * 0.998));
  const a = (l1 * l1 - l2 * l2 + dm * dm) / (2 * dm), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const ux = dx / d, uy = dy / d;
  return { x: ax + ux * a - uy * h * bend, y: ay + uy * a + ux * h * bend, ex: ax + ux * dm, ey: ay + uy * dm, far: d > dm };
}

export function pose(spIn, a = {}) {
  const sp = species(spIn), P = sp.P;
  const scale = a.scale ?? 1, young = a.young || 0, L = sp.len * scale;
  const phase = a.phase || 0, run = clamp(a.run || 0), t = a.t || 0;
  const crouch = clamp(a.crouch || 0), rear = clamp(a.rear || 0), headTo = clamp(a.headTo || 0, -1, 1), jaw = clamp(a.jaw || 0);
  const gy = a.gy || ZERO, quad = !P.biped;
  const headK = P.head * (1 + 0.35 * young), sum = P.tail + P.torso + P.neck + headK;
  const Lt = P.torso / sum * L, Ln = P.neck / sum * L, Lh = headK / sum * L, Ll = P.tail / sum * L;
  const H = P.hipH * L, G = gait(sp, run, scale), S = G.stride, duty = G.duty;
  const rHip = P.rHip * L, rSh = P.rSh * L;
  const g0 = gy(0), g1 = quad ? gy(Lt) : g0;
  const lie = Math.min(H, P.r * L * (1 + P.belly) * 1.02);
  const hipY = g0 + lerp(H, lie, crouch) - Math.cos(2 * TAU * phase) * H * lerp(0.012, 0.035, run) * (1 - crouch);
  let th = P.pitch + rear * (quad ? 0.75 : 0.35) + (quad ? Math.atan2(g1 - g0, Lt) * 0.8 : 0) + Math.sin(2 * TAU * phase + 1) * lerp(0.008, 0.03, run);
  if (!quad && headTo < 0) th += headTo * 0.5;                    // bipeds bow to reach the ground
  if (crouch) th = lerp(th, quad ? Math.min(th, 0.02) : th * 0.5, crouch);
  const cy = hipY + rHip * 0.15, ct = Math.cos(th), st = Math.sin(th);

  // torso: hips → shoulders
  const torso = [];
  for (let j = 0; j <= NT; j++) {
    const u = j / NT, bow = P.arch * L * Math.sin(PI * u);
    const r = L * (lerp(P.rHip, P.rSh, u) + (P.r - (P.rHip + P.rSh) / 2) * Math.sin(PI * u));
    torso.push({ x: u * Lt * ct - bow * st, y: cy + u * Lt * st + bow * ct, z: 0, r, b: r * (1 + P.belly * Math.sin(PI * u)) });
  }
  const sh = torso[NT];
  // neck and head; delta bends the neck up (+) or down (−)
  const neckFor = delta => {
    const out = []; let x = sh.x, y = sh.y;
    for (let k = 1; k <= NN; k++) {
      const u = (k - 0.5) / NN, ang = Math.max(-1.95, lerp(P.neckA[0], P.neckA[1], u) + th * (1 - u) * 0.6 + delta * (0.35 + 0.9 * u));
      x += Ln / NN * Math.cos(ang); y += Ln / NN * Math.sin(ang);
      out.push({ x, y, z: 0, r: L * lerp(lerp(P.rSh, P.rNeck[0], 0.6), P.rNeck[1], k / NN) });
    }
    const ha = Math.max(-1.5, P.headA + delta * 0.55 + th * 0.3 + (a.look || 0));
    return { out, ha, tipY: y + Lh * Math.sin(ha), tipX: x + Lh * Math.cos(ha) };
  };
  let delta = headTo > 0 ? headTo * P.up : 0;
  if (headTo < 0) {
    const rest = neckFor(0), want = lerp(rest.tipY, gy(rest.tipX) + 0.03 * L, -headTo);
    let lo = -2.6, hi = 0;
    for (let i = 0; i < 9; i++) { const m = (lo + hi) / 2; if (neckFor(m).tipY > want) hi = m; else lo = m; }
    delta = hi;
  }
  const nk = neckFor(delta), neck = nk.out, nEnd = neck[NN - 1];
  // tail: hips → tip
  const tail = []; { let x = 0, y = cy;
    for (let m = 1; m <= NL; m++) {
      const u = m / NL;
      const beta = lerp(P.tailA[0], P.tailA[1], u) - th * (1 - u) * 0.9 + 0.05 * Math.sin(t * 1.1 - u * 4) * u + run * 0.05 * Math.sin(2 * TAU * phase - u * 3) * u;
      x -= Ll / NL * Math.cos(beta); y += Ll / NL * Math.sin(beta);
      const r = L * (lerp(P.rHip * 0.92, P.rTail, sm(Math.min(1, u * 3))) * Math.pow(1 - u, P.taper) + 0.004);
      const floor = (a.gy ? gy(x) : g0) + r * 1.05; if (y < floor) y = floor;
      tail.push({ x, y, z: L * 0.035 * Math.sin(t * 0.8 + TAU * phase - u * 3.2) * Math.pow(u, 1.4) * (1 + run), r });
    } }
  const nodes = [...tail.reverse(), ...torso, ...neck];
  const iHip = NL, iSh = NL + NT, iEnd = nodes.length - 1;

  // legs
  const legs = [];
  const leg = (front, near, jx, jy, len, R, off, bend, footLen) => {
    const p = fract(phase + off), half = S * duty / 2, bias = front ? 0 : H * 0.04;
    let fx, lift = 0, m, q = 0, stance = p < duty;
    if (stance) { const s = p / duty; fx = bias + half * (1 - 2 * s); m = lerp(P.lean[0], P.lean[1], s * s); }
    else { q = (p - duty) / (1 - duty); const e = sm(q); fx = bias + half * (2 * e - 1); lift = P.lift * H * Math.sin(PI * q); m = lerp(P.lean[1], P.lean[0], e) + 0.35 * Math.sin(PI * q); }
    if (front) m *= 0.45;
    fx = lerp(fx, bias + H * 0.12, crouch); m = lerp(m, front ? 0.9 : 1.35, crouch); lift *= 1 - crouch;
    let tx = jx + fx, ty = gy(tx) + R[3] * 0.9 + lift;
    if (front && rear) { ty += rear * Lt * 0.62; tx += rear * H * 0.1; m += rear * 0.6; }
    let ax = tx - len[2] * Math.sin(m), ay = ty + len[2] * Math.cos(m);
    const k = ik2(jx, jy, ax, ay, len[0], len[1], bend);
    if (k.far) { tx += k.ex - ax; ty += k.ey - ay; ax = k.ex; ay = k.ey; }
    const ta = stance ? 0 : -1.0 * Math.sin(PI * q);
    const z = (near ? 1 : -1) * rHip * (quad ? 0.8 : 0.55);
    legs.push({ front, near, stance, q, z, R, pts: [[jx, jy], [k.x, k.y], [ax, ay], [tx, ty]], tip: [tx + footLen * Math.cos(ta), ty + footLen * Math.sin(ta)] });
  };
  const hl = P.leg.map(v => v * H), hR = P.legR.map(v => v * H);
  const fOff = quad ? [lerp(0.75, 0.5, run), lerp(0.25, 0, run)] : null;
  let arms = [];
  const sj = { x: sh.x - 0.01 * L, y: sh.y - 0.55 * rSh };
  // far side first, so drawing in order puts near limbs on top
  if (quad) {
    const Hs = restShoulder(sp) * scale, fl = P.arm.map(v => v * Hs), fR = (Array.isArray(P.armR) ? P.armR : [P.armR, P.armR, P.armR, P.armR]).map(v => v * H);
    leg(true, false, sj.x, sj.y, fl, fR, fOff[1], -1, P.foot * H * 0.8);
    leg(false, false, 0, hipY, hl, hR, 0.5, 1, P.foot * H);
    leg(false, true, 0, hipY, hl, hR, 0, 1, P.foot * H);
    leg(true, true, sj.x, sj.y, fl, fR, fOff[0], -1, P.foot * H * 0.8);
  } else {
    leg(false, false, 0, hipY, hl, hR, 0.5, 1, P.foot * H);
    leg(false, true, 0, hipY, hl, hR, 0, 1, P.foot * H);
    if (P.arm) for (const near of [false, true]) {
      const sw = Math.sin(TAU * phase + (near ? 0 : PI)) * (0.1 + 0.3 * run);
      const ua = -1.95 + sw + th, fa = -0.7 + sw * 0.5 + th + jaw * 0.3;
      const l = P.arm.map(v => v * L);
      const e = [sj.x + l[0] * Math.cos(ua), sj.y + l[0] * Math.sin(ua)], w = [e[0] + l[1] * Math.cos(fa), e[1] + l[1] * Math.sin(fa)];
      arms.push({ near, z: (near ? 1 : -1) * rSh * 0.7, r: P.armR * L, fa, pts: [[sj.x, sj.y], e, w, [w[0] + l[2] * Math.cos(fa - 0.6), w[1] + l[2] * Math.sin(fa - 0.6)]] });
    }
  }
  return { sp, P, L, H, scale, young, nodes, iHip, iSh, iEnd, th, phase, run, t, stride: S, crouch,
    head: { x: nEnd.x, y: nEnd.y, a: nk.ha, len: Lh, jaw }, legs, arms };
}
function restShoulder(sp) {
  if (sp._rs) return sp._rs;
  const P = sp.P, L = sp.len, sum = P.tail + P.torso + P.neck + P.head;
  return sp._rs = P.hipH * L + P.rHip * L * 0.15 + P.torso / sum * L * Math.sin(P.pitch) - 0.55 * P.rSh * L;
}

// ---------------------------------------------------------------- outlines
// outline of a chain of nodes { x, y, r, b? } (b = radius on the under side when it differs)
export function tube(n, i0 = 0, i1 = n.length - 1, kTop = 1, kBot = 1) {
  const top = [], bot = [];
  for (let i = i0; i <= i1; i++) {
    const A = n[Math.max(i0, i - 1)], B = n[Math.min(i1, i + 1)], c = n[i];
    let tx = B.x - A.x, ty = B.y - A.y; const d = Math.hypot(tx, ty) || 1; tx /= d; ty /= d;
    top.push([c.x - ty * c.r * kTop, c.y + tx * c.r * kTop]); bot.push([c.x + ty * (c.b ?? c.r) * kBot, c.y - tx * (c.b ?? c.r) * kBot]);
  }
  return top.concat(bot.reverse());
}
// frame at a fractional node index: position, tangent, normal (pointing to the animal's back) and radii
function at(n, s) {
  s = clamp(s, 0, n.length - 1.001);
  const i = Math.floor(s), f = s - i, A = n[i], B = n[i + 1];
  let tx = B.x - A.x, ty = B.y - A.y; const d = Math.hypot(tx, ty) || 1; tx /= d; ty /= d;
  const r = lerp(A.r, B.r, f);
  return { x: lerp(A.x, B.x, f), y: lerp(A.y, B.y, f), tx, ty, nx: -ty, ny: tx, r, b: lerp(A.b ?? A.r, B.b ?? B.r, f), seg: d };
}
const limb = (pts, R) => tube(pts.map((p, i) => ({ x: p[0], y: p[1], r: R[i] })));

// skull shapes in head space: x from the back of the skull (0) to the snout tip (1), y up, in head lengths.
const HEADS = {
  theropod: { up: [[0, .26], [.12, .36], [.3, .4], [.42, .36], [.62, .33], [.86, .27], [1, .17], [1.01, .03], [.8, 0], [.45, -.02], [.2, -.04], [0, -.1]],
    jaw: [[.04, -.06], [.45, -.03], [.97, 0], [.98, -.07], [.8, -.13], [.45, -.17], [.15, -.2], [0, -.14]], eye: [.33, .24, .035], teeth: [.4, .98, 9], nose: [.9, .16] },
  raptor: { up: [[0, .2], [.12, .28], [.3, .3], [.45, .25], [.7, .2], [.9, .17], [1, .1], [1, .02], [.8, 0], [.4, -.02], [0, -.08]],
    jaw: [[.04, -.05], [.5, -.03], [.97, 0], [.97, -.05], [.7, -.1], [.3, -.13], [0, -.11]], eye: [.3, .17, .045], teeth: [.45, .97, 9], nose: [.9, .1] },
  spino: { up: [[0, .2], [.1, .3], [.22, .34], [.32, .27], [.5, .2], [.75, .15], [.9, .17], [1, .12], [1, .02], [.86, 0], [.76, .04], [.5, 0], [0, -.08]],
    jaw: [[.04, -.05], [.5, -.02], [.76, .02], [.98, -.01], [.98, -.06], [.7, -.09], [.3, -.12], [0, -.1]], eye: [.24, .2, .03], teeth: [.4, .98, 12], nose: [.7, .13] },
  sauro: { up: [[0, .2], [.15, .34], [.4, .4], [.6, .3], [.85, .2], [1, .12], [1, 0], [.5, -.02], [0, -.08]],
    jaw: [[.05, -.05], [.98, -.01], [.95, -.09], [.5, -.14], [0, -.13]], eye: [.38, .22, .045], nose: [.6, .3] },
  brachio: { up: [[0, .2], [.15, .36], [.33, .62], [.52, .62], [.68, .36], [.9, .22], [1, .12], [1, 0], [.5, -.02], [0, -.08]],
    jaw: [[.05, -.05], [.98, -.01], [.95, -.1], [.5, -.16], [0, -.14]], eye: [.3, .24, .045], nose: [.45, .5] },
  duck: { up: [[0, .24], [.12, .36], [.35, .4], [.6, .3], [.82, .2], [.95, .2], [1.04, .12], [1.02, .02], [.85, -.01], [.5, -.02], [0, -.08]],
    jaw: [[.04, -.05], [.9, -.02], [1, -.04], [.92, -.11], [.5, -.16], [.1, -.2], [0, -.13]], eye: [.3, .24, .04], nose: [.9, .15],
    beak: [[.8, .2], [.95, .2], [1.04, .12], [1.02, .02], [.85, -.01], [.78, .06]] },
  cerat: { up: [[0, .3], [.2, .44], [.5, .44], [.72, .36], [.86, .22], [.96, .1], [1, -.08], [.9, -.02], [.6, -.02], [0, -.08]],
    jaw: [[.04, -.06], [.6, -.03], [.9, -.03], [.96, 0], [.9, -.12], [.5, -.2], [.1, -.24], [0, -.15]], eye: [.36, .28, .035], nose: [.82, .16],
    beak: [[.8, .28], [.86, .22], [.96, .1], [1, -.08], [.9, -.02], [.78, 0]] },
  stego: { up: [[0, .18], [.2, .3], [.5, .28], [.8, .18], [1, .08], [1, 0], [.5, -.03], [0, -.08]],
    jaw: [[.04, -.05], [.95, -.01], [.9, -.08], [.4, -.13], [0, -.12]], eye: [.34, .17, .045], nose: [.85, .1],
    beak: [[.8, .18], [1, .08], [1, 0], [.8, -.01]] },
  anky: { up: [[0, .28], [.15, .42], [.5, .4], [.8, .28], [1, .12], [1, -.02], [.5, -.03], [0, -.1]],
    jaw: [[.04, -.06], [.95, -.03], [.9, -.12], [.4, -.18], [0, -.16]], eye: [.36, .22, .035], nose: [.88, .12],
    beak: [[.84, .25], [1, .12], [1, -.02], [.84, -.02]] },
  pachy: { up: [[0, .2], [.1, .32], [.5, .34], [.75, .26], [1, .12], [1, 0], [.5, -.03], [0, -.08]],
    jaw: [[.04, -.05], [.95, -.01], [.9, -.09], [.4, -.14], [0, -.12]], eye: [.4, .18, .04], nose: [.88, .12] },
  ornitho: { up: [[0, .2], [.15, .32], [.4, .34], [.6, .22], [1, .06], [1, .02], [.5, -.02], [0, -.08]],
    jaw: [[.04, -.05], [1, .01], [.5, -.1], [0, -.12]], eye: [.33, .2, .06], nose: [.7, .14], beak: [[.6, .22], [1, .06], [1, .02], [.6, -.02]] },
  bird: { up: [[0, .2], [.12, .36], [.35, .4], [.52, .34], [.75, .3], [1, .08], [.98, 0], [.5, -.02], [0, -.08]],
    jaw: [[.04, -.05], [.98, -.01], [.6, -.14], [0, -.12]], eye: [.3, .22, .05], nose: [.62, .2], beak: [[.5, .34], [.75, .3], [1, .08], [.98, 0], [.5, -.02]] },
};
const CRESTS = {
  double: [[.28, .36], [.36, .6], [.55, .68], [.75, .56], [.88, .26]],
  fan: [[.26, .37], [.28, .62], [.37, .68], [.46, .62], [.46, .37]],
  brow: [[.26, .37], [.34, .52], [.44, .37]],
  nose: [[.68, .3], [.75, .5], [.87, .26]],
  horns: [[.26, .38], [.26, .7], [.34, .62], [.42, .4]],
  tube: [[.42, .38], [.1, .6], [-.4, .82], [-.82, .82], [-.84, .7], [-.4, .68], [.05, .42], [.2, .36]],
  helmet: [[.04, .3], [.08, .7], [.3, .88], [.5, .74], [.6, .34]],
  comb: [[.1, .36], [.2, .5], [.35, .5], [.42, .4]],
  dome: [[.0, .28], [.06, .5], [.2, .64], [.38, .66], [.52, .56], [.6, .36]],
  casque: [[.28, .36], [.42, .64], [.62, .6], [.82, .22]],
};
const FRILL = [[.2, .36], [-.05, .74], [-.3, .84], [-.5, .68], [-.52, .32], [-.34, .04], [0, -.06]];

// ---------------------------------------------------------------- parts
// → [{ k: kind, t: tone, p: polygon | c: [x, y, r] | l: polyline (+ w: width in metres), s: 1 when it should be smoothed }]
// tones: body, belly, far (limbs on the far side), mark, accent (display structures), accentFar, horn (horn, claw, beak,
// tooth), eye, mouth. kinds: leg, arm, wing, body, belly, mark, plate, spike, sail, frill, skull, jaw, tooth, crest, horn,
// beak, eye, nostril, foot, claw, club, scute, quill, fuzz, tailfan
export function parts(q) {
  const { sp, P, L, H, nodes: n, iHip, iSh, iEnd } = q, f = sp.f, out = [];
  const add = (k, t, p, s) => { out.push(s ? { k, t, p, s: 1 } : { k, t, p }); };
  const tailAt = u => at(n, iHip * (1 - u));               // u: 0 at the hips … 1 at the tail tip
  const drawLeg = g => {
    const tone = g.near ? 'body' : 'far', T = g.pts[3], r = g.R[3];
    if (f.legWings && !g.front) { const [K, A] = [g.pts[1], g.pts[2]], d = L * 0.16 * f.legWings; add('wing', g.near ? 'accent' : 'accentFar', [K, A, [A[0] - d, A[1] - d * 0.25], [K[0] - d * 0.8, K[1] - d * 0.1]], 1); }
    add('leg', tone, limb(g.pts, g.R), 1);
    if (P.toes === 'pad') out.push({ k: 'foot', t: tone, c: [T[0], T[1], r * 1.05] });
    else {
      const dx = g.tip[0] - T[0], dy = g.tip[1] - T[1], d = Math.hypot(dx, dy) || 1, px = -dy / d * r, py = dx / d * r;
      if (P.toes === 'hoof') add('foot', tone, [[T[0] - dx * 0.3 + px, T[1] - dy * 0.3 + py], [g.tip[0] + px * 0.7, g.tip[1] + py * 0.7], [g.tip[0] - px * 0.9, g.tip[1] - py * 0.9], [T[0] - dx * 0.3 - px, T[1] - dy * 0.3 - py]], 1);
      else {
        add('foot', tone, [[T[0] - dx * 0.25 + px, T[1] - dy * 0.25 + py], [T[0] + dx * 0.7 + px * 0.6, T[1] + dy * 0.7 + py * 0.6], [g.tip[0], g.tip[1] - r * 0.5], [T[0] + dx * 0.6 - px, T[1] + dy * 0.6 - py], [T[0] - dx * 0.25 - px, T[1] - dy * 0.25 - py]]);
        if (f.sickle && !g.front) { const c = H * 0.07 * f.sickle; add('claw', 'horn', [[T[0], T[1] + r * 0.6], [T[0] + c * 0.5, T[1] + r + c], [T[0] + c * 1.1, T[1] + r * 0.4 + c * 0.35], [T[0] + c * 0.45, T[1] + r * 0.5]]); }
      }
    }
  };
  const drawArm = g => {
    const tone = g.near ? 'body' : 'far', [, E, W, Hd] = g.pts;
    if (f.wings) { const d = L * 0.1 * f.wings, an = PI + 0.25 + q.th, c = Math.cos(an), s = Math.sin(an);
      add('wing', g.near ? 'accent' : 'accentFar', [g.pts[0], E, W, Hd, [W[0] + c * d * 1.25, W[1] + s * d * 1.25], [E[0] + c * d * 0.9, E[1] + s * d * 0.9 - d * 0.12], [g.pts[0][0] + c * d * 0.35, g.pts[0][1] + s * d * 0.35 - d * 0.1]]); }
    add('arm', tone, limb(g.pts, [g.r * 1.5, g.r * 1.1, g.r * 0.8, g.r * 0.5]), 1);
    const cl = (f.claws ? L * 0.085 * f.claws : 0) || (f.thumb ? L * 0.02 * f.thumb : 0) || g.r * 1.6;
    for (let i = 0; i < (f.claws ? 3 : 2); i++) { const an = g.fa - 0.5 - i * (f.claws ? 0.22 : 0.5);
      add('claw', 'horn', [[Hd[0] - g.r * 0.4, Hd[1] + g.r * 0.4], [Hd[0] + Math.cos(an) * cl, Hd[1] + Math.sin(an) * cl], [Hd[0] + g.r * 0.4, Hd[1] - g.r * 0.4]]); }
  };
  // spikes and plates standing on the back at fractional node s
  const stand = (kind, tone, s, h, w, lean = 0, k = 0.9) => {
    const o = at(n, s), bx = o.x + o.nx * o.r * k, by = o.y + o.ny * o.r * k, dx = o.nx * Math.cos(lean) - o.ny * Math.sin(lean), dy = o.ny * Math.cos(lean) + o.nx * Math.sin(lean);
    if (kind === 'plate') add('plate', tone, [[bx - o.tx * w * 0.55, by - o.ty * w * 0.55], [bx - o.tx * w + dx * h * 0.5, by - o.ty * w + dy * h * 0.5], [bx + dx * h, by + dy * h], [bx + o.tx * w + dx * h * 0.5, by + o.ty * w + dy * h * 0.5], [bx + o.tx * w * 0.55, by + o.ty * w * 0.55]]);
    else add(kind, tone, [[bx - o.tx * w, by - o.ty * w], [bx + dx * h, by + dy * h], [bx + o.tx * w, by + o.ty * w]]);
  };
  const backRow = near => {
    const tone = near ? 'accent' : 'accentFar', off = near ? 0 : 0.5;
    if (f.plates) {
      const s0 = iHip * 0.45, s1 = iEnd - 1.5, N = 9;
      for (let i = 0; i < N; i++) {
        const s = lerp(s0, s1, (i + off) / N), u = (s - s0) / (s1 - s0), bell = Math.pow(Math.sin(PI * clamp(0.08 + u * 0.8)), 1.3);
        const h = L * 0.105 * f.plates * (0.3 + 0.7 * bell);
        if (f.backSpikes && s < iHip + 2.5) stand('spike', near ? 'horn' : 'accentFar', s, h * 1.5, h * 0.13, 0.25);
        else stand('plate', tone, s, h, h * 0.42);
      }
    }
    if (f.spikes) for (const u of [0.8, 0.93]) stand('spike', near ? 'horn' : 'accentFar', iHip * (1 - u), L * 0.085, L * 0.008, near ? 0.45 : 0.75, 0.3);
    if (f.neckSpines) for (let i = 0; i < 7; i++) stand('spike', tone, iSh + 0.6 + i * 0.75 + off * 0.3, L * 0.06 * (1 - i * 0.07), L * 0.006, near ? 0.5 : 0.3);
  };

  for (const g of q.legs) if (!g.near) drawLeg(g);
  for (const g of q.arms) if (!g.near) drawArm(g);
  backRow(false);
  if (f.tailFan) { const N = iHip * 0.42, fan = []; for (let i = 0; i <= 6; i++) { const u = i / 6; const o = at(n, N * (1 - u)); fan.push({ x: o.x, y: o.y, r: L * 0.028 * f.tailFan * Math.sin(PI * (0.12 + 0.88 * (1 - u))) + 0.002 }); }
    fan.reverse(); add('tailfan', 'accent', tube(fan), 1); }
  if (f.sail) { const s0 = f.paddleTail ? iHip - 1.5 : iHip - 0.6, s1 = iSh + 0.6, top = [], base = [];
    for (let i = 0; i <= 12; i++) { const u = i / 12, o = at(n, lerp(s0, s1, u)), h = L * 0.135 * f.sail * Math.pow(Math.sin(PI * u), 0.55);
      base.push([o.x + o.nx * o.r * 0.7, o.y + o.ny * o.r * 0.7]); top.push([o.x + o.nx * (o.r + h), o.y + o.ny * (o.r + h)]);
      if (i % 2 === 1) out.push({ k: 'ray', t: 'mark', l: [base[i], top[i]], w: L * 0.004 }); }
    out.splice(out.length - 6, 0, { k: 'sail', t: 'accent', p: top.concat(base.reverse()), s: 1 }); }
  if (f.paddleTail) { const top = [], base = []; for (let i = 0; i <= 8; i++) { const u = i / 8, o = tailAt(0.12 + u * 0.86), h = L * 0.035 * Math.sin(PI * u) + 0.001;
    base.push([o.x, o.y]); top.push([o.x + o.nx * (o.r + h), o.y + o.ny * (o.r + h)]); } add('sail', 'accent', top.concat(base.reverse()), 1); }

  add('body', 'body', tube(n), 1);
  // pale underside from mid-tail to the throat
  { const lo = [], hi = []; for (let s = iHip * 0.55; s <= iEnd; s += 0.5) { const o = at(n, s); lo.push([o.x - o.nx * o.b, o.y - o.ny * o.b]); hi.push([o.x - o.nx * o.b * 0.45, o.y - o.ny * o.b * 0.45]); }
    add('belly', 'belly', hi.concat(lo.reverse()), 1); }
  // markings
  const pat = sp.pat;
  if (pat === 'saddle') { const hi = [], lo = []; for (let s = iHip * 0.2; s <= iEnd; s += 0.5) { const o = at(n, s); hi.push([o.x + o.nx * o.r, o.y + o.ny * o.r]); lo.push([o.x + o.nx * o.r * 0.25, o.y + o.ny * o.r * 0.25]); }
    add('mark', 'mark', hi.concat(lo.reverse()), 1); }
  else if (pat === 'stripes' || pat === 'bands') {
    const s0 = iHip * 0.15, s1 = pat === 'bands' ? iHip + 0.5 : iSh + 2;
    for (let s = s0; s <= s1; s += pat === 'bands' ? 1 : 0.62) { const o = at(n, s), w = o.seg * (pat === 'bands' ? 0.24 : 0.13), dn = pat === 'bands' ? -o.b : -o.r * 0.15;
      add('mark', 'mark', [[o.x - o.tx * w + o.nx * o.r, o.y - o.ty * w + o.ny * o.r], [o.x + o.tx * w + o.nx * o.r, o.y + o.ty * w + o.ny * o.r], [o.x + o.tx * w * (pat === 'bands' ? 1 : 0.2) + o.nx * dn, o.y + o.ty * w * (pat === 'bands' ? 1 : 0.2) + o.ny * dn], [o.x - o.tx * w * (pat === 'bands' ? 1 : 0.2) + o.nx * dn, o.y - o.ty * w * (pat === 'bands' ? 1 : 0.2) + o.ny * dn]]); }
    if (pat === 'bands') for (let s = iHip + 1; s <= iSh + 1; s += 0.9) { const o = at(n, s), w = o.seg * 0.14; add('mark', 'mark', [[o.x - o.tx * w + o.nx * o.r, o.y - o.ty * w + o.ny * o.r], [o.x + o.tx * w + o.nx * o.r, o.y + o.ty * w + o.ny * o.r], [o.x + o.nx * o.r * 0.1, o.y + o.ny * o.r * 0.1]]); }
  } else if (pat === 'spots') { let i = 0; for (let s = iHip * 0.3; s <= iSh + 3; s += 0.55, i++) { const o = at(n, s), k = [0.55, 0.1, 0.75, 0.32][i % 4]; out.push({ k: 'mark', t: 'mark', c: [o.x + o.nx * o.r * k, o.y + o.ny * o.r * k, o.r * 0.17] }); } }
  if (f.wingFold) { const a0 = at(n, iSh - 0.3), b0 = at(n, iHip + 0.3), r = a0.r * 0.7 * f.wingFold;
    add('wing', 'mark', [[a0.x, a0.y + r * 0.9], [lerp(a0.x, b0.x, 0.5), a0.y + r * 0.7], [b0.x - r * 0.9, b0.y - r * 0.1], [lerp(a0.x, b0.x, 0.55), b0.y - r * 0.9], [a0.x + r * 0.2, a0.y - r * 0.8]], 1); }
  if (f.spines) for (let s = iHip * 0.35; s < iEnd - 0.5; s += 0.42) stand('spike', 'mark', s, L * 0.011, L * 0.006, -0.3, 0.95);
  if (f.fuzz) for (let s = iHip * 0.25; s < iEnd; s += 0.34) { const o = at(n, s), h = o.r * 0.34 * f.fuzz, bx = o.x + o.nx * o.r * 0.9, by = o.y + o.ny * o.r * 0.9;
    add('fuzz', 'body', [[bx + o.tx * o.seg * 0.2, by + o.ty * o.seg * 0.2], [bx - o.tx * o.seg * 0.3 + o.nx * h, by - o.ty * o.seg * 0.3 + o.ny * h], [bx - o.tx * o.seg * 0.25, by - o.ty * o.seg * 0.25]]); }
  if (f.scutes) { for (let s = iHip * 0.2; s < iEnd - 0.8; s += 0.4) stand('scute', 'mark', s, L * 0.02 * f.scutes, L * 0.013, 0, 0.9);
    for (let s = iHip * 0.35; s < iSh + 0.5; s += 0.5) { const o = at(n, s); out.push({ k: 'scute', t: 'mark', c: [o.x + o.nx * o.r * 0.35, o.y + o.ny * o.r * 0.35, o.r * 0.1] }); } }
  if (f.quills) for (let u = 0.15; u < 0.8; u += 0.07) { const o = tailAt(u); out.push({ k: 'quill', t: 'accent', l: [[o.x + o.nx * o.r, o.y + o.ny * o.r], [o.x + o.nx * (o.r + L * 0.05 * f.quills) - o.tx * L * 0.02, o.y + o.ny * (o.r + L * 0.05 * f.quills) - o.ty * L * 0.02]], w: L * 0.006 }); }
  backRow(true);
  if (f.club) { const e = n[0], r = L * 0.036 * f.club; out.push({ k: 'club', t: 'horn', c: [e.x - r * 0.5, e.y, r] }, { k: 'club', t: 'horn', c: [e.x + r * 0.3, e.y + r * 0.5, r * 0.6] }); }

  headParts(q, out);
  for (const g of q.legs) if (g.near) drawLeg(g);
  if (f.sideSpike) { const o = at(n, iSh - 0.4), d = L * 0.07 * f.sideSpike; add('spike', 'horn', [[o.x - d * 0.25, o.y - o.r * 0.1], [o.x - d * 0.7, o.y + d * 0.9], [o.x + d * 0.25, o.y]]); }
  for (const g of q.arms) if (g.near) drawArm(g);
  return out;
}

// head space → body space
function headMap(q) {
  const { x, y, a, len } = q.head, c = Math.cos(a), s = Math.sin(a), d = len * (q.P.hd || 1);
  return (lx, ly) => [x + lx * len * c - ly * d * s, y + lx * len * s + ly * d * c];
}
function headParts(q, out, bone) {
  const { sp, P } = q, f = sp.f, Hd = HEADS[P.headT] || HEADS.theropod, M = headMap(q), mp = pl => pl.map(p => M(p[0], p[1]));
  const body = bone ? 'bone' : 'body', horn = bone ? 'bone' : 'horn', acc = bone ? 'bone' : 'accent';
  const jawA = -q.head.jaw * 0.62, pv = [0.08, -0.07], cj = Math.cos(jawA), sj = Math.sin(jawA);
  const J = (lx, ly) => { const dx = lx - pv[0], dy = ly - pv[1]; return M(pv[0] + dx * cj - dy * sj, pv[1] + dx * sj + dy * cj); };
  if (f.frill) { const k = f.frill; out.push({ k: 'frill', t: acc, p: FRILL.map(p => M(p[0] * k, p[1] * (0.4 + 0.6 * k))), s: 1 });
    if (bone && !/^tricer/.test(sp.id)) out.push({ k: 'hole', t: 'hole', c: [...M(-0.26 * k, 0.5 * k), q.head.len * 0.1 * k] });
    if (f.frillSpikes) for (let i = 0; i < 5; i++) { const a = 1.2 + i * 0.42, bx = -0.24 * k + Math.cos(a) * 0.3 * k, by = 0.46 * k + Math.sin(a) * 0.3 * k, e = 0.45 - Math.abs(i - 2) * 0.07;
      out.push({ k: 'horn', t: horn, p: [M(bx - Math.sin(a) * 0.06, by + Math.cos(a) * 0.06), M(bx + Math.cos(a) * e, by + Math.sin(a) * e), M(bx + Math.sin(a) * 0.06, by - Math.cos(a) * 0.06)] }); } }
  if (q.head.jaw > 0.04 && !bone) out.push({ k: 'mouth', t: 'mouth', p: [M(pv[0], pv[1]), M(0.5, 0.02), M(0.98, 0.02), J(0.97, -0.02), J(0.5, -0.04)] });
  const meat = Hd.teeth && sp.diet !== 'herbivore';
  if (meat) { const [x0, x1, N] = Hd.teeth, w = (x1 - x0) / N;
    for (let i = 0; i < N; i++) { const x = x0 + (i + 0.5) * w, h = 0.045 + 0.03 * Math.sin(PI * (i + 0.5) / N);
      if (q.head.jaw > 0.12 || bone) out.push({ k: 'tooth', t: horn, p: [J(x - w * 0.3, -0.03), J(x, -0.03 + h * 0.8), J(x + w * 0.3, -0.03)] }); } }
  out.push({ k: 'skull', t: body, p: mp(Hd.up), s: 1 });
  if (meat) { const [x0, x1, N] = Hd.teeth, w = (x1 - x0) / N;
    for (let i = 0; i < N; i++) { const x = x0 + (i + 0.5) * w, h = 0.05 + 0.04 * Math.sin(PI * (i + 0.5) / N); out.push({ k: 'tooth', t: horn, p: [M(x - w * 0.32, 0.01), M(x, 0.01 - h), M(x + w * 0.32, 0.01)] }); } }
  out.push({ k: 'jaw', t: body, p: Hd.jaw.map(p => J(p[0], p[1])), s: 1 });
  if (Hd.beak && !bone) out.push({ k: 'beak', t: 'horn', p: mp(Hd.beak), s: 1 });
  if (f.crest && CRESTS[f.crest]) out.push({ k: 'crest', t: f.crest === 'horns' || f.crest === 'brow' || f.crest === 'nose' ? horn : acc, p: mp(CRESTS[f.crest]), s: 1 });
  if (f.crest === 'dome') for (const [x, y] of [[-.03, .3], [.02, .2], [.7, .3], [.84, .22]]) out.push({ k: 'horn', t: horn, c: [...M(x, y), q.head.len * 0.035] });
  if (f.horns) out.push({ k: 'horn', t: horn, p: mp([[.34, .42], [.56, .8 * f.horns + .1], [1.0, 1.02 * f.horns + .08], [.72, .66 * f.horns + .1], [.52, .44]]), s: 1 });
  if (f.noseHorn) out.push({ k: 'horn', t: horn, p: mp([[.7, .35], [.8, .34 + .42 * f.noseHorn], [.87, .25]]) });
  if (P.headT === 'anky') out.push({ k: 'horn', t: horn, p: mp([[0, .3], [-.14, .44], [.12, .38]]) }, { k: 'horn', t: horn, p: mp([[.04, -.08], [-.1, -.2], [.16, -.1]]) });
  const e = Hd.eye, er = e[2] * q.head.len * (1 + q.young * 0.6) * (P.hd || 1);
  if (bone) { out.push({ k: 'hole', t: 'hole', c: [...M(e[0], e[1]), er * 2] }, { k: 'hole', t: 'hole', c: [...M(Hd.nose[0], Hd.nose[1]), er * 1.1] });
    if (Hd.teeth) out.push({ k: 'hole', t: 'hole', c: [...M(lerp(e[0], Hd.nose[0], 0.5), e[1] * 0.9), er * 1.5] }); }
  else { out.push({ k: 'eye', t: 'eye', c: [...M(e[0], e[1]), er] }); out.push({ k: 'nostril', t: 'mark', c: [...M(Hd.nose[0], Hd.nose[1]), er * 0.35] }); }
}

// ---------------------------------------------------------------- skeleton
// tones: bone, boneFar, hole (openings in the skull). Lines carry a width in metres.
const boneShape = (a, b, w) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1, px = -dy / d * w, py = dx / d * w, P = (t, k) => [a[0] + dx * t + px * k, a[1] + dy * t + py * k];
  return [P(0, 1.5), P(0.07, 1.6), P(0.2, 0.7), P(0.8, 0.7), P(0.93, 1.6), P(1, 1.5), P(1, -1.5), P(0.93, -1.6), P(0.8, -0.7), P(0.2, -0.7), P(0.07, -1.6), P(0, -1.5)];
};
export function bones(q) {
  const { sp, P, L, nodes: n, iHip, iSh, iEnd } = q, f = sp.f, out = [];
  const limbBones = (g, tone) => {
    const R = g.R || [g.r * 1.5, g.r * 1.1, g.r * 0.8, g.r * 0.5];
    for (let i = 0; i < 3; i++) out.push({ k: 'bone', t: tone, p: boneShape(g.pts[i], g.pts[i + 1], Math.max(L * 0.004, R[i + 1] * 0.36)), s: 1 });
    const T = g.pts[3], tip = g.tip || [T[0] + (g.pts[3][0] - g.pts[2][0]) * 0.6, T[1] + (g.pts[3][1] - g.pts[2][1]) * 0.6];
    for (const k of [-0.5, 0, 0.5]) out.push({ k: 'toe', t: tone, l: [T, [tip[0], tip[1] + k * R[3] * 1.2]], w: Math.max(L * 0.003, R[3] * 0.32) });
  };
  for (const g of q.legs) if (!g.near) limbBones(g, 'boneFar');
  for (const g of q.arms) if (!g.near) limbBones(g, 'boneFar');
  // ribs first, then the column over them
  for (let s = iHip + 0.5; s < iSh + 0.2; s += 0.5) { const o = at(n, s), k = Math.sin(PI * (s - iHip) / (iSh - iHip + 0.4));
    const a = [o.x + o.nx * o.r * 0.45, o.y + o.ny * o.r * 0.45], d = o.b * (0.5 + 0.75 * k);
    out.push({ k: 'rib', t: 'bone', l: [a, [a[0] + o.tx * d * 0.25 - o.nx * d * 0.5, a[1] + o.ty * d * 0.25 - o.ny * d * 0.5], [a[0] - o.tx * d * 0.12 - o.nx * d * 1.15, a[1] - o.ty * d * 0.12 - o.ny * d * 1.15]], w: L * 0.0055 }); }
  for (let s = 0.3; s < iEnd; s += 0.45) {
    const o = at(n, s), inTorso = s > iHip - 0.5 && s < iSh + 0.5, up = inTorso ? 0.45 : 0, cx = o.x + o.nx * o.r * up, cy = o.y + o.ny * o.r * up;
    const hl = o.seg * 0.19, hh = Math.max(L * 0.003, o.r * (inTorso ? 0.16 : 0.3));
    out.push({ k: 'vert', t: 'bone', p: [[cx - o.tx * hl + o.nx * hh, cy - o.ty * hl + o.ny * hh], [cx + o.tx * hl + o.nx * hh, cy + o.ty * hl + o.ny * hh], [cx + o.tx * hl - o.nx * hh, cy + o.ty * hl - o.ny * hh], [cx - o.tx * hl - o.nx * hh, cy - o.ty * hl - o.ny * hh]] });
    let sp1 = o.r * (inTorso ? 0.55 : 0.6);
    if (f.sail && s > iHip - (f.paddleTail ? 1.5 : 0.6) && s < iSh + 0.6) sp1 += L * 0.135 * f.sail * Math.pow(Math.sin(PI * clamp((s - iHip + 0.6) / (iSh - iHip + 1.2))), 0.55);
    if (f.neckSpines && s > iSh + 0.4) sp1 += L * 0.05;
    out.push({ k: 'spine', t: 'bone', l: [[cx + o.nx * hh, cy + o.ny * hh], [cx + o.nx * (hh + sp1) - o.tx * sp1 * 0.15, cy + o.ny * (hh + sp1) - o.ty * sp1 * 0.15]], w: L * 0.005 });
    if (s < iHip - 0.6) out.push({ k: 'chevron', t: 'bone', l: [[cx - o.nx * hh, cy - o.ny * hh], [cx - o.nx * (hh + o.r * 0.7) - o.tx * o.r * 0.3, cy - o.ny * (hh + o.r * 0.7) - o.ty * o.r * 0.3]], w: L * 0.004 });
  }
  { const h = n[iHip], r = h.r, hy = q.legs.find(g => !g.front).pts[0][1];       // pelvis
    out.push({ k: 'pelvis', t: 'bone', p: [[-r * 0.9, hy + r * 0.25], [-r * 0.5, hy + r * 0.75], [r * 0.6, hy + r * 0.8], [r * 1.0, hy + r * 0.35], [r * 0.2, hy - r * 0.05], [-r * 0.4, hy]], s: 1 });
    out.push({ k: 'pelvis', t: 'bone', l: [[0, hy], [r * 0.75, hy - r * 0.85]], w: L * 0.008 }, { k: 'pelvis', t: 'bone', l: [[0, hy], [-r * 0.85, hy - r * 0.6]], w: L * 0.007 }); }
  { const s = n[iSh], j = q.legs.find(g => g.front)?.pts[0] || q.arms[0]?.pts[0] || [s.x, s.y - s.r * 0.5];      // shoulder blade
    out.push({ k: 'scapula', t: 'bone', p: boneShape(j, [j[0] - s.r * 1.0, j[1] + s.r * 0.75], s.r * 0.09), s: 1 }); }
  if (f.plates) for (let i = 0; i < 9; i++) { const s = lerp(iHip * 0.45, iEnd - 1.5, i / 9), o = at(n, s), u = i / 9, h = L * 0.105 * f.plates * (0.3 + 0.7 * Math.pow(Math.sin(PI * clamp(0.08 + u * 0.8)), 1.3)), w = h * 0.42, bx = o.x + o.nx * o.r * 1.05, by = o.y + o.ny * o.r * 1.05;
    out.push({ k: 'plate', t: 'bone', p: [[bx - o.tx * w * 0.55, by - o.ty * w * 0.55], [bx - o.tx * w + o.nx * h * 0.5, by - o.ty * w + o.ny * h * 0.5], [bx + o.nx * h, by + o.ny * h], [bx + o.tx * w + o.nx * h * 0.5, by + o.ty * w + o.ny * h * 0.5], [bx + o.tx * w * 0.55, by + o.ty * w * 0.55]] }); }
  if (f.spikes) for (const u of [0.8, 0.93]) { const o = at(n, iHip * (1 - u)); out.push({ k: 'spike', t: 'bone', p: [[o.x - L * 0.008, o.y], [o.x - L * 0.05, o.y + L * 0.07], [o.x + L * 0.008, o.y]] }); }
  if (f.club) out.push({ k: 'club', t: 'bone', c: [n[0].x, n[0].y, L * 0.036 * f.club] });
  headParts(q, out, true);
  for (const g of q.legs) if (g.near) limbBones(g, 'bone');
  for (const g of q.arms) if (g.near) limbBones(g, 'bone');
  return out;
}

// ---------------------------------------------------------------- other views
// The animal from above: polygons in [x forward, z sideways] metres, same part format as parts().
export function topParts(q) {
  const { L, P, nodes: n, iHip, iSh } = q, out = [];
  const flat = n.map(o => ({ x: o.x, y: o.z, r: o.r * (P.biped ? 0.75 : 0.95) }));
  for (const g of q.legs) { const T = g.pts[3], j = g.pts[0];
    out.push({ k: 'leg', t: 'far', l: [[j[0], g.z * 0.6], [T[0], g.z * 1.5]], w: g.R[1] * 1.6 });
    out.push({ k: 'foot', t: g.stance ? 'far' : 'body', c: [T[0], g.z * 1.5, g.R[3] * (g.stance ? 1.5 : 1.1)] }); }
  out.push({ k: 'body', t: 'body', p: tube(flat), s: 1 });
  const hi = [], lo = []; for (let i = Math.round(iHip * 0.3); i < flat.length; i++) { hi.push([flat[i].x, flat[i].y + flat[i].r * 0.35]); lo.push([flat[i].x, flat[i].y - flat[i].r * 0.35]); }
  out.push({ k: 'mark', t: 'mark', p: hi.concat(lo.reverse()), s: 1 });
  const h = q.head, e = n[n.length - 1], c = Math.cos(h.a) * h.len, w = e.r * 1.25;
  out.push({ k: 'skull', t: 'body', p: [[h.x - w * 0.3, w], [h.x + c * 0.5, w * 0.8], [h.x + c, w * 0.35], [h.x + c, -w * 0.35], [h.x + c * 0.5, -w * 0.8], [h.x - w * 0.3, -w]], s: 1 });
  if (q.sp.f.frill) out.push({ k: 'frill', t: 'accent', p: [[h.x, w * 2.2], [h.x - c * 0.5, w * 1.8], [h.x - c * 0.6, 0], [h.x - c * 0.5, -w * 1.8], [h.x, -w * 2.2]], s: 1 });
  if (q.sp.f.plates) for (let i = 0; i < 8; i++) { const o = n[Math.round(lerp(iHip * 0.5, iSh + 2, i / 7))]; out.push({ k: 'plate', t: 'accent', c: [o.x, o.z, L * 0.012] }); }
  out.push({ k: 'eye', t: 'eye', c: [h.x + c * 0.3, w * 0.7, w * 0.16] }, { k: 'eye', t: 'eye', c: [h.x + c * 0.3, -w * 0.7, w * 0.16] });
  return out;
}

// The animal as 3D capsules [ax, ay, az, bx, by, bz, ra, rb, tone] (tone 0 body, 1 limb, 2 head), z sideways.
export function capsules(q) {
  const out = [], n = q.nodes;
  for (let i = 0; i < n.length - 1; i++) out.push([n[i].x, n[i].y, n[i].z, n[i + 1].x, n[i + 1].y, n[i + 1].z, n[i].r, n[i + 1].r, 0]);
  const h = q.head, e = n[n.length - 1], d = q.P.hd || 1;
  out.push([h.x, h.y + h.len * 0.08, 0, h.x + Math.cos(h.a) * h.len * 0.85, h.y + Math.sin(h.a) * h.len * 0.85 + h.len * 0.05, 0, Math.max(e.r, h.len * 0.2 * d), h.len * 0.11 * d, 2]);
  for (const g of q.legs) { for (let i = 0; i < 3; i++) out.push([...g.pts[i], g.z * (i ? 1.15 : 0.9), ...g.pts[i + 1], g.z * 1.15, g.R[i], g.R[i + 1], 1]);
    out.push([...g.pts[3], g.z * 1.15, ...g.tip, g.z * 1.15, g.R[3], g.R[3] * 0.6, 1]); }
  for (const g of q.arms) for (let i = 0; i < 3; i++) out.push([...g.pts[i], g.z, ...g.pts[i + 1], g.z * 1.1, g.r * 1.4, g.r, 1]);
  return out;
}
export { HEADS, CRESTS, at };
