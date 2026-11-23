// The animals that are not walkers: pterosaurs and flying birds (flyParts) and marine reptiles (swimParts).
// Both return the same part format as rig.js parts(), in metres, origin at the middle of the body, facing +x.
import { clamp, lerp } from './util.js';
import { species } from './species.js';
import { tube } from './rig.js';

const TAU = Math.PI * 2, PI = Math.PI;

// a: { t (seconds), glide 0..1 (1 = soaring, wings almost still), yaw (−0.8..0.8, 0 = side on), pitch (0 = level
// with the animal, 0.6 = seen from below), scale, jaw }
export function flyParts(spIn, a = {}) {
  const sp = species(spIn), o = sp.o || {}, scale = a.scale ?? 1, span = sp.span * scale, half = span / 2, bird = sp.plan === 'pbird';
  const b = span * (bird ? 0.34 : 0.15), glide = clamp(a.glide ?? 0.5), t = a.t || 0;
  const ya = a.yaw ?? 0.3, pi = a.pitch ?? 0.5, ca = Math.cos(ya), sa = Math.sin(ya), cr = Math.cos(pi), sr = Math.sin(pi);
  const P = (x, y, z) => [x * ca + z * sa, y * cr - (-x * sa + z * ca) * sr];
  const f = (a.rate ?? 1) * 2.4 / Math.sqrt(Math.max(0.3, sp.span)), amp = lerp(0.8, 0.1, glide), ph = TAU * f * t;
  const A = amp * Math.sin(ph), inner = A * 0.6 + 0.12, outer = A * 1.25 - 0.3 * amp * Math.cos(ph) + 0.05;
  const out = [], bob = -A * b * 0.12;
  const wing = s => {
    const tone = s > 0 ? 'body' : 'far', mid = (inner + outer) / 2;
    const S = [b * 0.25, bob, s * b * 0.12], l1 = half * 0.22, l2 = half * 0.27, l3 = half * 0.55;
    const E = [S[0] + l1 * 0.2, S[1] + l1 * Math.sin(inner), S[2] + s * l1 * Math.cos(inner)];
    const W = [E[0] + l2 * 0.25, E[1] + l2 * Math.sin(mid), E[2] + s * l2 * Math.cos(mid)];
    const T = [W[0] - l3 * 0.4, W[1] + l3 * Math.sin(outer), W[2] + s * l3 * Math.cos(outer)];
    let poly;
    if (bird) { const c = half * 0.34; poly = [S, E, W, T, [T[0] - c * 0.5, T[1], T[2] - s * l3 * 0.15], [W[0] - c * 1.1, W[1], W[2]], [E[0] - c * 1.2, E[1], E[2]], [S[0] - c, S[1], S[2]]]; }
    else { const An = [-b * 0.6, bob - b * 0.05, s * b * 0.22], M = [lerp(T[0], An[0], 0.55) + half * 0.05, lerp(T[1], An[1], 0.55), lerp(T[2], An[2], 0.5)];
      poly = [S, E, W, T, M, An, [-b * 0.3, bob, s * b * 0.08]]; }
    out.push({ k: 'wing', t: tone, p: poly.map(v => P(...v)), s: bird ? 1 : 0 });
    out.push({ k: 'arm', t: s > 0 ? 'mark' : 'far', l: [S, E, W, T].map(v => P(...v)), w: span * 0.008 });
    if (!bird) out.push({ k: 'claw', t: 'horn', l: [P(...W), P(W[0] + half * 0.04, W[1] - half * 0.01, W[2])], w: span * 0.006 });
  };
  wing(-1);
  // body, neck and head along x
  const nl = b * (bird ? 0.3 : 0.5) * (o.neck || 1), hl = b * (bird ? 0.45 : 0.95) * (o.head || 1), nodes = [];
  for (let i = 0; i <= 6; i++) { const u = i / 6, x = lerp(-b * 0.6, b * 0.35, u), c = P(x, bob, 0); nodes.push({ x: c[0], y: c[1], r: b * (bird ? 0.16 : 0.13) * Math.pow(Math.sin(PI * (0.12 + 0.8 * u)), 0.7) }); }
  const na = 0.45 - A * 0.1; let nx = b * 0.35, ny = bob;
  for (let i = 1; i <= 3; i++) { nx += nl / 3 * Math.cos(na); ny += nl / 3 * Math.sin(na); const c = P(nx, ny, 0); nodes.push({ x: c[0], y: c[1], r: b * 0.055 }); }
  if (sp.tailVane) { const tl = b * 1.5 * sp.tailVane, e = P(-b * 0.6 - tl, bob + b * 0.1 * Math.sin(ph * 0.5), 0), s0 = P(-b * 0.6, bob, 0), d = b * 0.16;
    out.push({ k: 'tail', t: 'body', l: [s0, e], w: span * 0.006 }, { k: 'tailfan', t: 'accent', p: [[e[0] + d, e[1]], [e[0], e[1] + d * 0.55], [e[0] - d, e[1]], [e[0], e[1] - d * 0.55]] }); }
  if (bird) { const e = P(-b * 0.6, bob, 0), d = b * 0.5; out.push({ k: 'tailfan', t: 'far', p: [[e[0] + d * 0.2, e[1] + d * 0.12], [e[0] - d, e[1] + d * 0.3], [e[0] - d * 1.1, e[1] - d * 0.15], [e[0] + d * 0.2, e[1] - d * 0.12]] }); }
  else for (const s of [-1, 1]) out.push({ k: 'leg', t: 'far', l: [P(-b * 0.45, bob - b * 0.05, s * b * 0.1), P(-b * 0.95, bob - b * 0.1, s * b * 0.2)], w: span * 0.007 });
  out.push({ k: 'body', t: 'body', p: tube(nodes), s: 1 });
  { const lo = [], hi = []; for (const n of nodes.slice(1, 8)) { lo.push([n.x, n.y - n.r]); hi.push([n.x, n.y - n.r * 0.3]); } out.push({ k: 'belly', t: 'belly', p: hi.concat(lo.reverse()), s: 1 }); }
  const hb = nodes[nodes.length - 1], ha = -0.18 + (a.look || 0), hc = Math.cos(ha) * ca, hs = Math.sin(ha), dp = hl * 0.16 * (o.hd || 1);
  const H = (lx, ly) => [hb.x + lx * hl * hc - ly * dp * hs, hb.y + lx * hl * hs + ly * dp * Math.cos(ha)];
  if (sp.crest) out.push({ k: 'crest', t: 'accent', p: [H(0.25, 0.9), H(-0.55 * sp.crest, 1.6 + sp.crest * 1.2), H(-0.1, 0.2), H(0.05, 0.7)], s: 1 });
  out.push({ k: 'skull', t: 'body', p: [H(-0.05, 0.8), H(0.2, 1), H(0.45, 0.6), H(0.3, -0.5), H(-0.05, -0.7)], s: 1 });
  const jw = (a.jaw || 0) * 0.5;
  out.push({ k: 'beak', t: 'horn', p: [H(0.3, 0.75), H(1, 0.05 + jw), H(0.3, -0.1)] }, { k: 'jaw', t: 'horn', p: [H(0.28, -0.1), H(0.97, -0.05 - jw * 2), H(0.3, -0.55)] });
  if (sp.keel) out.push({ k: 'crest', t: 'accent', c: [...H(0.86, 0.5), hl * 0.07] }, { k: 'crest', t: 'accent', c: [...H(0.84, -0.6), hl * 0.06] });
  out.push({ k: 'eye', t: 'eye', c: [...H(0.2, 0.35), hl * 0.035] });
  wing(1);
  return out;
}

// a: { t, phase (stroke cycles), scale, jaw, bend (−1..1: curve the body up or down, for turning and diving) }
const SWIM = {
  ichthyo: { tail: 0.34, body: 0.38, neck: 0.04, head: 0.24, r: 0.1, rn: 0.085, wave: 0.03, fluke: 'moon', dorsal: 1, flip: [0.16, 0.09], snout: 1 },
  mosa: { tail: 0.42, body: 0.36, neck: 0.06, head: 0.16, r: 0.07, rn: 0.055, wave: 0.045, fluke: 'low', dorsal: 0, flip: [0.1, 0.09], snout: 0 },
  plesio: { tail: 0.16, body: 0.36, neck: 0.4, head: 0.07, r: 0.115, rn: 0.028, wave: 0.008, fluke: null, dorsal: 0, flip: [0.24, 0.22], snout: 0 },
  plio: { tail: 0.18, body: 0.44, neck: 0.1, head: 0.28, r: 0.125, rn: 0.085, wave: 0.01, fluke: null, dorsal: 0, flip: [0.24, 0.24], snout: 0 },
};
export function swimParts(spIn, a = {}) {
  const sp = species(spIn), o = sp.o || {}, S = SWIM[sp.plan] || SWIM.ichthyo, L = sp.len * (a.scale ?? 1), t = a.t || 0, ph = TAU * (a.phase ?? t * 0.6), bend = a.bend || 0;
  const neckL = S.neck * (o.neck || 1), sum = S.tail + S.body + neckL + S.head, k = L / sum, deep = o.deep || 1;
  const out = [], N = 22, nodes = [];
  const x0 = -(S.tail + S.body * 0.5) * k;
  for (let i = 0; i <= N; i++) {
    const u = i / N, d = u * sum, x = x0 + d * k;
    let r;
    if (d < S.tail) { const v = d / S.tail; r = lerp(0.012, S.r * 0.7, Math.pow(v, 0.8)); }
    else if (d < S.tail + S.body) { const v = (d - S.tail) / S.body; r = lerp(S.r * 0.7, S.rn, v) + (S.r - (S.r * 0.7 + S.rn) / 2) * Math.sin(PI * v); }
    else if (d < S.tail + S.body + neckL) r = S.rn * (S.neck > 0.3 ? 1 : lerp(1, 0.95, (d - S.tail - S.body) / neckL));
    else { const v = (d - S.tail - S.body - neckL) / S.head; r = lerp(S.rn * (S.neck > 0.3 ? 1.5 : 1.05), 0.012, Math.pow(v, S.snout ? 0.55 : 1.4)); }
    const tailW = Math.pow(clamp(1 - d / (S.tail + S.body * 0.5)), 1.5), neckW = S.neck > 0.3 ? Math.pow(clamp((d - S.tail - S.body) / (neckL + S.head)), 1.3) : 0;
    const y = L * (S.wave * Math.sin(ph - u * 5) * tailW * 2 + 0.04 * Math.sin(ph * 0.5 + u * 3) * neckW + bend * 0.12 * Math.pow(u - 0.4, 2) * Math.sign(u - 0.4) + 0.1 * neckW);
    nodes.push({ x, y, r: r * k * (d < S.tail + S.body ? deep : 1) });
  }
  const atD = d => { const s = clamp(d / sum) * N, i = Math.min(N - 1, Math.floor(s)), f = s - i; return { x: lerp(nodes[i].x, nodes[i + 1].x, f), y: lerp(nodes[i].y, nodes[i + 1].y, f), r: lerp(nodes[i].r, nodes[i + 1].r, f) }; };
  const flipper = (d, len, ang, tone) => { const c = atD(d), l = len * L, w = l * 0.3, ca = Math.cos(ang), sa = Math.sin(ang), by = c.y - c.r * 0.55;
    out.push({ k: 'flipper', t: tone, p: [[c.x - w * 0.6, by], [c.x - w * 0.5 + ca * l * 0.5 - sa * w, by + sa * l * 0.5 + ca * w * 0.2], [c.x + ca * l, by + sa * l], [c.x + w * 0.5 + ca * l * 0.5, by + sa * l * 0.5], [c.x + w * 0.7, by]], s: 1 }); };
  const fa = -1.9 + 0.55 * Math.sin(ph), ha = -2.0 + 0.55 * Math.sin(ph + (S.fluke ? PI : 1.8));
  const dF = S.tail + S.body * 0.88, dH = S.tail + S.body * 0.12;
  flipper(dF, S.flip[0], fa - 0.25, 'far'); flipper(dH, S.flip[1], ha - 0.25, 'far');
  const e = nodes[0];
  if (S.fluke === 'moon') out.push({ k: 'fluke', t: 'body', p: [[e.x + L * 0.05, e.y], [e.x - L * 0.07, e.y + L * 0.13], [e.x - L * 0.02, e.y], [e.x - L * 0.06, e.y - L * 0.11]], s: 1 });
  if (S.fluke === 'low') out.push({ k: 'fluke', t: 'body', p: [[e.x + L * 0.12, e.y + L * 0.015], [e.x - L * 0.015, e.y + L * 0.03], [e.x - L * 0.04, e.y - L * 0.075], [e.x + L * 0.04, e.y - L * 0.02]], s: 1 });
  if (S.dorsal) { const c = atD(S.tail + S.body * 0.55); out.push({ k: 'fin', t: 'body', p: [[c.x - L * 0.05, c.y + c.r * 0.9], [c.x - L * 0.07, c.y + c.r + L * 0.07], [c.x + L * 0.05, c.y + c.r * 0.9]], s: 1 }); }
  out.push({ k: 'body', t: 'body', p: tube(nodes), s: 1 });
  { const lo = [], hi = []; for (let i = 3; i <= N - 1; i++) { const n = nodes[i]; lo.push([n.x, n.y - n.r]); hi.push([n.x, n.y - n.r * 0.3]); } out.push({ k: 'belly', t: 'belly', p: hi.concat(lo.reverse()), s: 1 }); }
  { const hi = [], lo = []; for (let i = 2; i <= N - 2; i++) { const n = nodes[i]; hi.push([n.x, n.y + n.r]); lo.push([n.x, n.y + n.r * 0.35]); } out.push({ k: 'mark', t: 'mark', p: hi.concat(lo.reverse()), s: 1 }); }
  flipper(dF, S.flip[0], fa, 'body'); flipper(dH, S.flip[1], ha, 'body');
  const hd0 = S.tail + S.body + neckL, hc = atD(hd0 + S.head * 0.28), tip = nodes[N], jb = atD(hd0 + S.head * 0.3), jaw = a.jaw || 0;
  out.push({ k: 'mouthline', t: 'mark', l: [[jb.x, jb.y - jb.r * 0.35], [tip.x, tip.y - L * 0.004 - jaw * S.head * k * 0.25]], w: L * 0.004 });
  if (sp.plan !== 'plesio' && sp.plan !== 'ichthyo') for (let i = 0; i < 7; i++) { const c = atD(hd0 + S.head * (0.4 + i * 0.08)), w = S.head * k * 0.025; out.push({ k: 'tooth', t: 'horn', p: [[c.x - w, c.y - c.r * 0.45], [c.x, c.y - c.r * 0.45 - w * 2.4], [c.x + w, c.y - c.r * 0.45]] }); }
  out.push({ k: 'eye', t: 'eye', c: [hc.x, hc.y + hc.r * 0.3, Math.max(L * 0.006, hc.r * 0.22 * (o.eye || 1))] });
  return out;
}
