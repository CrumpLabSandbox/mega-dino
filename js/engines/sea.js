// Mesozoic Seas: under water with the marine reptiles (ichthyosaurs, plesiosaurs, pliosaurs, mosasaurs). They were
// not dinosaurs. The engine does not use the land world: it runs its own small swimming simulation (pods that cruise
// across and wrap, animals that turn by flipping, schooling fish, hunters that charge a bait ball) and paints the
// water itself: a depth gradient that follows Light, light shafts and caustics from the surface, marine snow,
// bubbles, and a sea floor with the life of the period (crinoids, sponges, corals, rudists, giant clams, ammonites,
// belemnites, hybodont sharks, sea turtles). The Era control recasts the animals with standIn(); after the impact
// the big reptiles, ammonites, belemnites and rudists are gone and fish, sharks and turtles are left.
//
// Units: x is in view widths (−0.5 … 0.5 is the frame), y in frame heights (0 top … 1 bottom); lengths are metres
// and env.k is pixels per metre, so nothing depends on the canvas size.
import { clamp, lerp, smooth, hash, rng, TAU, energy, buffer, fbm2, skyGradient } from '../util.js';
import { species, standIn } from '../species.js';
import { swimParts, flyParts } from '../swimfly.js';
import { drawParts, palette, trace } from '../draw.js';

const PI = Math.PI;
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const css = (c, a = 1) => `rgba(${clamp(c[0], 0, 255) | 0},${clamp(c[1], 0, 255) | 0},${clamp(c[2], 0, 255) | 0},${a})`;
const hex = c => '#' + c.map(v => (clamp(v, 0, 255) | 0).toString(16).padStart(2, '0')).join('');
const toward = (v, to, d) => v < to ? Math.min(to, v + d) : Math.max(to, v - d);

// water palettes: [top, bottom] in bright shallow water; Depth and Light darken them
const WATER = {
  reef: [[92, 204, 208], [14, 98, 132]],
  blue: [[78, 168, 222], [10, 58, 128]],
  green: [[126, 186, 150], [24, 84, 86]],
  teal: [[84, 180, 176], [10, 72, 98]],
  deep: [[40, 96, 170], [3, 9, 30]],
};
const SAND = { sand: [214, 200, 160], mud: [150, 152, 128], dark: [84, 92, 104] };

// ---------------------------------------------------------------- shared sprites (made once)
let CAUS = null, GLOW = null;
function causticTile() {
  if (CAUS) return CAUS;
  const n = 192, G = 5, b = buffer(n, n), img = b.ctx.createImageData(n, n), R = rng(977), pts = [];
  for (let i = 0; i < G * G; i++) pts.push([(i % G + 0.15 + 0.7 * R()) / G, (Math.floor(i / G) + 0.15 + 0.7 * R()) / G]);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n, v = y / n, cx = Math.floor(u * G), cy = Math.floor(v * G); let d1 = 9, d2 = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const gx = (cx + i + G) % G, gy = (cy + j + G) % G, p = pts[gy * G + gx];
      let dx = Math.abs(p[0] - u), dy = Math.abs(p[1] - v); if (dx > 0.5) dx = 1 - dx; if (dy > 0.5) dy = 1 - dy;
      const d = Math.hypot(dx, dy) * G; if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    const e = 1 - smooth(0, 0.3, d2 - d1), o = (y * n + x) * 4;
    img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = 255; img.data[o + 3] = 255 * e * e * e;
  }
  b.ctx.putImageData(img, 0, 0);
  return (CAUS = b.canvas);
}
function glowSprite() {
  if (GLOW) return GLOW;
  const b = buffer(48, 48), g = b.ctx.createRadialGradient(24, 24, 0, 24, 24, 24);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  b.ctx.fillStyle = g; b.ctx.fillRect(0, 0, 48, 48);
  return (GLOW = b.canvas);
}

// how far a swimmer reaches in front of and behind its origin, and where its eye is, as fractions of its length
const EXT = new Map();
function extent(sp) {
  let e = EXT.get(sp.id);
  if (!e) {
    const parts = swimParts(sp, { t: 0, phase: 0 }), body = parts.find(q => q.k === 'body'), eye = parts.find(q => q.k === 'eye');
    let x0 = 0, x1 = 0; for (const p of body.p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); }
    e = { back: -x0 / sp.len, front: x1 / sp.len, ex: eye.c[0] / sp.len, ey: eye.c[1] / sp.len };
    EXT.set(sp.id, e);
  }
  return e;
}

// ---------------------------------------------------------------- the simulation
function build(opts) {
  const R = rng(Math.imul((opts.seed || 1) + 7, 2654435761));
  const S = { agents: [], shoals: [], critters: [], items: [], bubbles: [], zoom: 1, last: -9, epoch: -1, born: false, heads: [], flash: 0 };
  const podDir = R() < 0.5 ? -1 : 1;
  (opts.cast || []).forEach((c, ci) => {
    const nMax = Math.max(1, Math.ceil(c.n * 2)), first = S.agents.length, y = c.y || [0.3, 0.62], z = c.z || [0.66, 1];
    const order = []; for (let i = 0; i < nMax; i++) order.push(i);
    for (let i = 0; i < nMax + (c.young || 0); i++) {
      const young = i >= nMax, parent = young ? S.agents[first + (i - nMax) % Math.max(1, c.n)] : null;
      const dir = c.dir || (c.n > 1 && R() < 0.2 ? -podDir : podDir) * (ci % 2 && !c.dir && opts.cross ? -1 : 1);
      const slot = (i % Math.max(1, c.n) + 0.5) / Math.max(1, c.n) - 0.5, home = lerp(y[0], y[1], c.n === 1 && !young ? 0.5 : R());
      const a = { c, ci, i, young, parent, base: species(c.sp), cur: null, alpha: 0, role: c.role || 'cruise',
        x: c.x != null && i === 0 ? c.x : slot * (c.spread || 0.8) + (R() - 0.5) * 0.12 + (i >= c.n ? 0.4 : 0), y: home, home,
        z: i === 0 ? z[1] : lerp(z[0], z[1], R()), dir: parent ? parent.dir : dir, face: 0, turn: 0, boost: 1, v: 0,
        phase: R() * 5, bend: 0, pitch: 0, jaw: 0, state: 'prowl', cool: 2 + R() * 5, sd: R() * 100, spd: 0.9 + R() * 0.2,
        scale: young ? 0.48 : 0.9 + R() * 0.12, hx: 0, hy: 0, air: 0 };
      a.roam = c.roam ?? (i === 0 && c.n > 1 && c.hero !== false ? 0.3 : 0);
      if (parent) { a.x = parent.x - parent.dir * 0.04; a.y = a.home = parent.home + 0.05; a.z = Math.max(0.3, parent.z - 0.03); }
      a.face = a.dir; a.hx = a.x; a.hy = a.y;
      S.agents.push(a);
    }
  });
  (opts.shoals || []).forEach(s => {
    const fish = [], n = Math.ceil(s.n * 1.7);
    for (let i = 0; i < n; i++) fish.push({ a: R() * TAU, r: Math.pow(R(), 0.6), w: 0.6 + R() * 0.8, tilt: R() * 2 - 1, hgt: R() * 2 - 1, ox: R() + R() - 1, oy: R() + R() - 1, sd: R() * 50 });
    S.shoals.push({ s, fish, cx: s.x, cy: s.y, hx: s.x, hy: s.y, vy: 0, scare: 0, dir: s.dir || 1, z: s.z ?? 0.86, sd: R() * 50, rNow: s.r });
  });
  const X = opts.extras || {};
  const crit = (kind, n, gate) => { for (let i = 0; i < n; i++) S.critters.push({ kind, gate, i, x: R() - 0.5, y: 0, home: lerp(...(X.y || [0.2, 0.7]), R()), z: lerp(0.3, 0.72, R()), dir: R() < 0.5 ? -1 : 1, sd: R() * 100, spd: 0.8 + R() * 0.4, size: 0.75 + R() * 0.5, alpha: 0 }); };
  crit('ammonite', (X.ammonite || 0) * 2, 'amm'); crit('belemnite', (X.belemnite || 0) * 2, 'bel');
  crit('shark', (X.shark || 0) * 2, 'one'); crit('turtle', (X.turtle || 0) * 2, 'turtle');
  crit('shark', 3, 'after'); crit('turtle', 1, 'after');           // whoever is left when the reptiles are gone
  for (const c of S.critters) { c.y = c.home; if (c.gate === 'after') { c.z = 0.9 + 0.1 * R(); c.size *= 1.25; c.home = lerp(0.35, 0.6, R()); } }
  // sea floor life: places only; what grows there depends on the era
  for (let i = 0; i < 64; i++) S.items.push({ x: (i + R()) / 64 * 1.3 - 0.65, row: Math.pow(R(), 1.4), pick: R(), show: R(), s: 0.7 + R() * 0.6, sd: R() * 1000, col: Math.floor(R() * 4) });
  S.items.sort((a, b) => a.row - b.row);
  S.fore = [0, 1, 2, 3].map(i => ({ x: [-0.47, 0.46, -0.33, 0.3][i] + (R() - 0.5) * 0.05, s: 1.5 + R() * 0.5, sd: R() * 1000, pick: R() }));
  S.floorSeed = R() * 100;
  S.coral = new Map();
  return S;
}

function startTurn(a) { if (a.turn === 0) { a.dir = -a.dir; a.turn = 1e-4; } }

function stepAgent(a, S, f, env, dt) {
  const sp = a.cur; if (!sp) return;
  const L = sp.len * a.scale, zs = lerp(0.42, 1, a.z), ext = extent(sp), E = env.E, Lx = L * zs / env.VW;
  const slow = sp.plan === 'plesio' ? 0.7 : sp.plan === 'plio' ? 0.85 : 1;
  let cruise = 0.8 * Math.pow(L, 0.45) * slow * a.spd * E, ty = a.home + 0.035 * Math.sin(env.t * 0.23 * a.spd + a.sd), tx = null, boostT = 1, jawT = 0, bendAdd = 0;
  const thick = 0.14 * L * zs * env.k / env.h;
  let role = a.role;
  if (a.young && a.parent && a.parent.cur) {
    const p = a.parent; role = 'cruise';
    if (p.dir !== a.dir && a.turn === 0 && p.turn === 0) startTurn(a);
    cruise = Math.max(0.2, p.v) * (1 + clamp(((p.x - p.dir * 0.035) - a.x) * a.dir * 8, -0.5, 1));
    ty = p.y + thick * 1.6 + 0.02;
  }
  if (role === 'hunt') {
    const sh = S.shoals[a.c.target || 0];
    a.cool -= dt * E;
    if (!sh) role = 'cruise';
    else if (a.state === 'prowl') {
      if (a.cool <= 0 && Math.abs(sh.cx) < 0.4 && a.turn === 0) {
        const d = Math.sign(sh.cx - a.x) || 1;
        if (d !== a.dir) startTurn(a); else if (Math.abs(sh.cx - a.x) > 0.1) { a.state = 'charge'; if (f.sig) f.sig.roar = 1; }
      }
    } else if (a.state === 'charge') {
      boostT = 3.4; ty = sh.cy;
      const d = (sh.cx - (a.x + a.dir * ext.front * Lx)) * a.dir;
      jawT = d < 0.2 ? 1 : 0;
      if (d < 0.16) sh.scare = Math.max(sh.scare, 1 - Math.max(0, d) / 0.16);
      if (d < -0.03 || a.turn !== 0) { a.state = 'coast'; a.cool = 5 + 7 * hash(a.sd, Math.floor(env.t)); for (let i = 0; i < 10; i++) bubble(S, a.hx + (hash(i, a.sd) - 0.5) * 0.03, a.hy + (hash(i, 3) - 0.5) * 0.03, env); }
    } else if (a.boost < 1.25) a.state = 'prowl';
  }
  if (role === 'fish') {
    const sh = S.shoals[a.c.target || 0];
    if (sh) {
      const cyc = (env.t * 0.2 * E + a.sd) % 1, lunge = cyc < 0.2 ? Math.sin(cyc / 0.2 * PI) : 0;
      tx = sh.cx - a.dir * (ext.ex * Lx + sh.rNow * 0.62 - lunge * 0.035) + 0.015 * Math.sin(env.t * 0.31 + a.sd);
      ty = sh.cy + (ext.ey + 0.02) * L * zs * env.k / env.h + 0.02 * Math.sin(env.t * 0.19 + a.sd);
      jawT = lunge > 0.35 ? 1 : 0; bendAdd = 0.15 + 0.5 * lunge;
      if (lunge > 0.6) sh.scare = Math.max(sh.scare, 0.35);
    }
  }
  if (role === 'breathe' && env.surf > 0) {
    const cyc = (env.t * 0.055 * E + a.sd * 0.37) % 1;
    if (cyc < 0.3) { ty = env.surf + thick * 0.35; bendAdd = 0.25; }
  }
  // turning: flip through a short squash
  if (a.turn > 0) { a.turn += dt / 0.85 * Math.sqrt(E); if (a.turn >= 1) { a.turn = 0; a.face = a.dir; } else a.face = a.dir * (2 * smooth(0, 1, a.turn) - 1); }
  else a.face = a.dir;
  a.boost += (boostT - a.boost) * Math.min(1, dt * (boostT > a.boost ? 2.2 : 0.7));
  let v;
  if (tx != null) { const vx = (tx - a.x) * 1.4; a.x += vx * dt; v = Math.abs(vx) * env.VW + 0.25 * cruise; }
  else { v = cruise * a.boost; a.x += a.face * v * dt / env.VW; }
  a.v = v;
  const vmax = Math.max(0.02, v * env.k / env.h * 0.45), vy = clamp((ty - a.y) * 0.9, -vmax, vmax);
  a.y += vy * dt;
  const lo = env.top + (role === 'breathe' ? thick * 0.2 : thick * 1.2 + 0.02), hi = env.floor - thick * 1.3;
  a.y = clamp(a.y, lo, Math.max(lo, hi));
  const slope = tx != null ? 0 : vy * env.h / Math.max(v * env.k, 1e-3), q = Math.min(1, dt * 2.5);
  a.pitch += (clamp(Math.atan(slope) * 0.8, -0.4, 0.4) - a.pitch) * q;
  a.bend += (clamp(-slope * 1.5 + bendAdd + (a.turn > 0 ? 0.5 * Math.sin(a.turn * PI) : 0), -0.9, 0.9) - a.bend) * q;
  a.jaw += (jawT - a.jaw) * Math.min(1, dt * 7);
  a.phase += dt * Math.max(0.16 * Math.sqrt(E), v / (L * 0.8));
  // edges: turn round inside the frame, or swim out and come back in on the other side
  if (a.young) { if (Math.abs(a.x) > 0.75 + Lx) a.x = -Math.sign(a.x) * (0.5 + Lx); }
  else if (a.roam && tx == null) { if (a.turn === 0 && a.x * a.dir > (a.state === 'charge' ? 0.46 : a.roam)) startTurn(a); }
  else if (tx == null) {
    const edge = 0.52, r = hash(a.sd, Math.floor(env.t * 3)), y = a.c.y || [0.3, 0.62];
    if (a.dir > 0 && a.x - ext.back * Lx * 1.2 > edge) { a.x = -edge - ext.front * Lx * 1.05; a.home = lerp(y[0], y[1], r); a.y = lerp(a.y, a.home, 0.6); }
    else if (a.dir < 0 && a.x + ext.back * Lx * 1.2 < -edge) { a.x = edge + ext.front * Lx * 1.05; a.home = lerp(y[0], y[1], r); a.y = lerp(a.y, a.home, 0.6); }
  }
  // now and then a breath of bubbles
  if (a.z > 0.6 && hash(a.sd, Math.floor(env.t * 2.5)) < 0.05 * dt * 30 * 0.2) bubble(S, a.hx, a.hy, env);
}

function bubble(S, x, y, env) { if (S.bubbles.length < 90) S.bubbles.push({ x, y, r: 0.4 + Math.random() * 0.9, v: 0.05 + Math.random() * 0.05, sd: Math.random() * 20 }); }

function step(S, f, env, dt) {
  const act = [];
  for (const a of S.agents) {
    const res = env.resolve(a.base), c = a.c;
    const adj = res ? Math.min(1, Math.sqrt(a.base.len / res.len) * 1.1) : 1;
    const nAct = clamp(Math.round(c.n * env.herdK * adj), 1, Math.ceil(c.n * 2));
    const on = a.young ? a.parent.on && env.herdK > 0.6 : a.i < nAct; a.on = on;
    const target = on && res ? env.reptiles : 0;
    if (env.jump) { a.cur = res; a.alpha = target; }
    else if (res !== a.cur) { a.alpha -= dt * 1.5; if (a.alpha <= 0) { a.cur = res; a.alpha = 0; } }
    else a.alpha = toward(a.alpha, target, dt * 1.2);
    if (a.cur && (a.alpha > 0 || on)) { stepAgent(a, S, f, env, dt); if (a.alpha > 0.3) act.push(a); }
  }
  S.act = act;
  for (const sh of S.shoals) {
    const s = sh.s, t = env.t;
    if (s.kind === 'stream') {
      sh.hx += sh.dir * (s.speed || 1.1) * env.E * (1 + sh.scare * 1.6) * dt / env.VW;
      const ext = s.r * 2.6; if (sh.hx * sh.dir > 0.5 + ext) { sh.hx = -sh.dir * (0.5 + ext); sh.cx = sh.hx; }
      sh.cx = sh.hx; sh.hy = clamp(sh.hy, env.top + 0.08, env.floor - 0.1);
    } else sh.cx += (sh.hx + 0.04 * Math.sin(t * 0.13 + sh.sd) - sh.cx) * Math.min(1, dt * 0.8);
    let push = 0;
    for (const a of act) if (a.state === 'charge') { const dx = sh.cx - a.hx, dy = (sh.cy - a.hy) / env.A; if (Math.hypot(dx, dy) < 0.2) push += (dy >= 0 ? 1 : -1) * 0.1 * sh.scare; }
    sh.vy += push * dt * 6; sh.vy *= Math.exp(-dt * 2.2);
    sh.cy += (sh.hy + 0.03 * Math.sin(t * 0.17 + sh.sd) - sh.cy) * Math.min(1, dt * 0.5) + sh.vy * dt;
    sh.cy = clamp(sh.cy, env.top + 0.06, env.floor - 0.08);
    sh.scare *= Math.exp(-dt * 0.45);
    sh.rNow = s.r * (1 + 0.45 * sh.scare);
  }
  for (const c of S.critters) {
    const g = c.gate, n = S.critters.length;
    const gate = g === 'amm' ? env.life.amm : g === 'bel' ? env.life.bel : g === 'turtle' ? env.life.turtle : g === 'after' ? 1 - env.reptiles : 1;
    const on = g === 'after' || (c.i < Math.round((c.kind === 'ammonite' ? env.X.ammonite : c.kind === 'belemnite' ? env.X.belemnite : c.kind === 'shark' ? env.X.shark : env.X.turtle) * env.herdK));
    c.alpha = env.jump ? (on ? gate : 0) : toward(c.alpha, on ? gate : 0, dt);
    const sp = c.kind === 'ammonite' ? 0.35 * (0.5 + Math.max(0, Math.sin(env.t * 2.2 + c.sd))) : c.kind === 'belemnite' ? 1.3 * (0.6 + 0.6 * Math.max(0, Math.sin(env.t * 2.6 + c.sd))) : c.kind === 'shark' ? 1.3 : 0.8;
    c.x += c.dir * sp * c.spd * env.E * dt / env.VW;
    if (c.x * c.dir > 0.62) { c.x = -c.dir * 0.62; }
    c.y = clamp(c.home + 0.03 * Math.sin(env.t * 0.3 * c.spd + c.sd), env.top + 0.07, env.floor - 0.06);
  }
  for (let i = S.bubbles.length - 1; i >= 0; i--) { const b = S.bubbles[i]; b.y -= b.v * (0.6 + 0.4 * b.r) * dt * 12 / Math.sqrt(env.VW); b.x += Math.sin(env.t * 5 + b.sd) * 0.0006; if (b.y < env.top) S.bubbles.splice(i, 1); }
}

// ---------------------------------------------------------------- the animals the engine draws itself (unit shapes)
// all face +x in the direction of travel; `s` is the size in pixels
function drawAmmonite(ctx, x, y, s, dir, t, sd, C) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(dir * 0.14 * Math.sin(t * 1.3 + sd)); ctx.scale(dir * s, s);
  ctx.lineCap = 'round'; ctx.strokeStyle = C.flesh; ctx.lineWidth = 0.035; ctx.beginPath();
  for (let i = 0; i < 8; i++) { const yy = 0.16 + i * 0.03, w = Math.sin(t * 3 + sd + i * 0.8); ctx.moveTo(-0.4, yy); ctx.quadraticCurveTo(-0.66, yy + 0.02 + w * 0.04, -0.86 - (i % 3) * 0.06, yy - 0.06 + i * 0.035 + w * 0.07); }
  ctx.stroke();
  ctx.fillStyle = C.flesh; ctx.beginPath(); ctx.ellipse(-0.36, 0.22, 0.19, 0.13, 0.5, 0, TAU); ctx.fill();
  ctx.fillStyle = C.shell; ctx.beginPath(); ctx.arc(0, 0, 0.5, 0, TAU); ctx.fill();
  ctx.strokeStyle = C.rib; ctx.lineWidth = 0.045; ctx.beginPath();
  for (let j = 0; j < 18; j++) { const a = j / 18 * TAU + sd; ctx.moveTo(Math.cos(a) * 0.49, Math.sin(a) * 0.49); ctx.quadraticCurveTo(Math.cos(a + 0.12) * 0.38, Math.sin(a + 0.12) * 0.38, Math.cos(a + 0.3) * 0.29, Math.sin(a + 0.3) * 0.29); }
  ctx.stroke();
  ctx.fillStyle = C.shell2; ctx.beginPath(); ctx.arc(0.02, 0.01, 0.28, 0, TAU); ctx.fill();
  ctx.lineWidth = 0.03; ctx.beginPath();
  for (let j = 0; j < 11; j++) { const a = j / 11 * TAU + sd; ctx.moveTo(0.02 + Math.cos(a) * 0.27, 0.01 + Math.sin(a) * 0.27); ctx.lineTo(0.02 + Math.cos(a + 0.3) * 0.15, 0.01 + Math.sin(a + 0.3) * 0.15); }
  ctx.moveTo(0.17, 0.02); ctx.arc(0.03, 0.02, 0.14, 0, TAU); ctx.moveTo(0.09, 0.02); ctx.arc(0.03, 0.02, 0.06, 0, TAU); ctx.stroke();
  ctx.strokeStyle = C.line; ctx.lineWidth = 0.025; ctx.beginPath(); ctx.arc(0, 0, 0.5, 0, TAU); ctx.stroke();
  ctx.fillStyle = C.eye; ctx.beginPath(); ctx.arc(-0.43, 0.2, 0.04, 0, TAU); ctx.fill();
  ctx.fillStyle = '#0c0c10'; ctx.beginPath(); ctx.arc(-0.435, 0.2, 0.02, 0, TAU); ctx.fill();
  ctx.restore();
}
function drawBelemnite(ctx, x, y, s, dir, t, sd, C, tiltA = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(dir * (tiltA + 0.08 * Math.sin(t * 1.1 + sd))); ctx.scale(dir * s, s);
  const pulse = Math.max(0, Math.sin(t * 2.6 + sd));
  ctx.lineCap = 'round'; ctx.strokeStyle = C.flesh; ctx.lineWidth = 0.028; ctx.beginPath();
  for (let i = 0; i < 8; i++) { const sp = (i / 7 - 0.5), w = Math.sin(t * 4 + sd + i); ctx.moveTo(-0.3, sp * 0.07); ctx.quadraticCurveTo(-0.45, sp * (0.2 - 0.1 * pulse) + w * 0.01, -0.62 + Math.abs(sp) * 0.1, sp * (0.3 - 0.2 * pulse) + w * 0.03); }
  ctx.stroke();
  ctx.fillStyle = C.fin; ctx.beginPath(); ctx.moveTo(0.44, 0); ctx.lineTo(0.24, -0.15); ctx.lineTo(0.16, -0.03); ctx.lineTo(0.16, 0.03); ctx.lineTo(0.24, 0.15); ctx.closePath(); ctx.fill();
  ctx.fillStyle = C.body; ctx.beginPath(); ctx.moveTo(0.5, 0); ctx.quadraticCurveTo(0.1, -0.12, -0.22, -0.075); ctx.lineTo(-0.22, 0.075); ctx.quadraticCurveTo(0.1, 0.12, 0.5, 0); ctx.fill();
  ctx.fillStyle = C.belly; ctx.beginPath(); ctx.moveTo(0.46, 0.01); ctx.quadraticCurveTo(0.1, 0.11, -0.21, 0.07); ctx.quadraticCurveTo(0.1, 0.03, 0.46, 0.01); ctx.fill();
  ctx.fillStyle = C.flesh; ctx.beginPath(); ctx.ellipse(-0.27, 0, 0.075, 0.065, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = C.eye; ctx.beginPath(); ctx.arc(-0.27, -0.012, 0.034, 0, TAU); ctx.fill();
  ctx.fillStyle = '#0a0a10'; ctx.beginPath(); ctx.arc(-0.275, -0.012, 0.018, 0, TAU); ctx.fill();
  if (C.glow) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = C.glow; ctx.beginPath(); for (let i = 0; i < 6; i++) { const u = 0.38 - i * 0.11; ctx.moveTo(u + 0.016, 0.03); ctx.arc(u, 0.03, 0.016, 0, TAU); } ctx.fill(); ctx.globalCompositeOperation = 'source-over'; }
  ctx.restore();
}
function drawShark(ctx, x, y, s, dir, t, sd, C, hybo) {
  ctx.save(); ctx.translate(x, y); ctx.scale(dir * s, s);
  const g = Math.sin(t * 3.4 + sd) * 0.035;
  ctx.fillStyle = C.far; ctx.beginPath(); ctx.moveTo(0.2, 0.05); ctx.lineTo(0.02, 0.2); ctx.lineTo(0.08, 0.06); ctx.moveTo(-0.1, 0.06); ctx.lineTo(-0.22, 0.14); ctx.lineTo(-0.19, 0.05); ctx.fill();
  ctx.fillStyle = C.body; ctx.beginPath();
  ctx.moveTo(0.14, -0.08); ctx.lineTo(0.03, -0.22); ctx.lineTo(-0.03, -0.075); ctx.moveTo(-0.15, -0.065); ctx.lineTo(-0.25, -0.16); ctx.lineTo(-0.29, -0.045); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0.5, 0.015); ctx.quadraticCurveTo(0.32, -0.1, 0.05, -0.088); ctx.quadraticCurveTo(-0.2, -0.07, -0.37, -0.022 + g);
  ctx.lineTo(-0.54, -0.2 + g * 2.4); ctx.lineTo(-0.44, g * 1.4); ctx.lineTo(-0.48, 0.1 + g * 1.6); ctx.lineTo(-0.37, 0.022 + g);
  ctx.quadraticCurveTo(-0.1, 0.09, 0.2, 0.08); ctx.quadraticCurveTo(0.43, 0.07, 0.5, 0.015); ctx.fill();
  ctx.fillStyle = C.belly; ctx.beginPath(); ctx.moveTo(0.48, 0.025); ctx.quadraticCurveTo(0.42, 0.07, 0.2, 0.078); ctx.quadraticCurveTo(-0.1, 0.088, -0.36, 0.022 + g); ctx.quadraticCurveTo(-0.05, 0.03, 0.48, 0.025); ctx.fill();
  if (hybo) { ctx.strokeStyle = C.horn; ctx.lineWidth = 0.014; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0.15, -0.085); ctx.lineTo(0.065, -0.245); ctx.moveTo(-0.14, -0.07); ctx.lineTo(-0.225, -0.18); ctx.stroke(); }
  ctx.fillStyle = C.body; ctx.beginPath(); ctx.moveTo(0.22, 0.04); ctx.lineTo(0.06, 0.22); ctx.lineTo(0.11, 0.05); ctx.fill();
  ctx.strokeStyle = C.line; ctx.lineWidth = 0.008; ctx.beginPath(); for (let i = 0; i < 4; i++) { ctx.moveTo(0.27 + i * 0.022, -0.035); ctx.lineTo(0.265 + i * 0.022, 0.035); } ctx.stroke();
  ctx.fillStyle = '#0a0c10'; ctx.beginPath(); ctx.arc(0.4, -0.012, 0.014, 0, TAU); ctx.fill();
  ctx.restore();
}
function drawTurtle(ctx, x, y, s, dir, t, sd, C) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(dir * 0.06 * Math.sin(t * 1.2 + sd)); ctx.scale(dir * s, s);
  const ph = t * 1.8 + sd, blade = (px, py, th, len, wd) => { const c = Math.cos(th), sn = Math.sin(th); ctx.beginPath(); ctx.moveTo(px - sn * wd * 0.4, py + c * wd * 0.4); ctx.quadraticCurveTo(px + c * len * 0.5 - sn * wd, py + sn * len * 0.5 + c * wd, px + c * len, py + sn * len); ctx.quadraticCurveTo(px + c * len * 0.6 + sn * wd * 0.9, py + sn * len * 0.6 - c * wd * 0.9, px + sn * wd * 0.6, py - c * wd * 0.6); ctx.fill(); };
  ctx.fillStyle = C.far; blade(0.2, 0.0, 2.3 - 0.75 * Math.sin(ph), 0.5, 0.11); blade(-0.3, 0.05, 2.8 + 0.2 * Math.sin(ph + 1), 0.24, 0.08);
  ctx.fillStyle = C.skin; ctx.beginPath(); ctx.ellipse(0.44, -0.03, 0.105, 0.075, -0.1, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0.5, -0.09); ctx.lineTo(0.585, -0.005); ctx.lineTo(0.5, 0.03); ctx.fill();
  ctx.fillStyle = C.belly; ctx.beginPath(); ctx.moveTo(-0.37, 0.03); ctx.quadraticCurveTo(0, 0.2, 0.36, 0.02); ctx.lineTo(0.3, -0.05); ctx.lineTo(-0.3, -0.05); ctx.fill();
  ctx.fillStyle = C.shell; ctx.beginPath(); ctx.moveTo(-0.4, 0.04); ctx.quadraticCurveTo(-0.32, -0.21, 0, -0.21); ctx.quadraticCurveTo(0.32, -0.2, 0.38, 0.015); ctx.quadraticCurveTo(0, 0.1, -0.4, 0.04); ctx.fill();
  ctx.strokeStyle = C.line; ctx.lineWidth = 0.012; ctx.beginPath();
  for (let i = -2; i <= 2; i++) { ctx.moveTo(i * 0.13, -0.19 + Math.abs(i) * 0.025); ctx.lineTo(i * 0.15, 0.05 - Math.abs(i) * 0.01); }
  ctx.moveTo(-0.33, -0.08); ctx.quadraticCurveTo(0, -0.13, 0.33, -0.08); ctx.stroke();
  ctx.fillStyle = C.skin; blade(0.2, 0.03, 2.1 + 0.75 * Math.sin(ph), 0.54, 0.12); blade(-0.3, 0.06, 2.7 - 0.2 * Math.sin(ph + 1), 0.25, 0.085);
  ctx.fillStyle = '#0a0c10'; ctx.beginPath(); ctx.arc(0.47, -0.045, 0.016, 0, TAU); ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- sea floor life
function coralSegs(S, sd) {
  let g = S.coral.get(sd); if (g) return g;
  const R = rng(Math.imul(Math.floor(sd) + 3, 2654435761)); g = [[], [], []];
  const grow = (x, y, a, len, d) => { const x1 = x + Math.sin(a) * len, y1 = y - Math.cos(a) * len; g[Math.min(2, 3 - d)].push(x, y, x1, y1); if (d > 0) { const n = d === 3 ? 3 : 2; for (let i = 0; i < n; i++) grow(x1, y1, a + (i - (n - 1) / 2) * (0.55 + R() * 0.35) + (R() - 0.5) * 0.3, len * (0.62 + R() * 0.2), d - 1); } };
  grow(0, 0, (R() - 0.5) * 0.3, 0.34, 3);
  S.coral.set(sd, g); return g;
}
const LIFE_COL = {
  crinoid: [[240, 176, 60], [236, 112, 84], [226, 96, 140], [244, 214, 120]],
  sponge: [[222, 156, 62], [176, 116, 180], [228, 124, 72], [206, 196, 112]],
  coral: [[240, 132, 146], [244, 176, 122], [204, 152, 216], [244, 224, 172]],
  brain: [[172, 194, 112], [214, 174, 112], [150, 190, 170], [220, 190, 140]],
  rudist: [[222, 208, 176], [196, 176, 154], [226, 196, 170], [204, 204, 186]],
};
function drawLife(ctx, S, type, x, y, s, t, it, tint, silhouette) {
  const sway = Math.sin(t * 0.8 + it.sd) * 0.5 + Math.sin(t * 0.37 + it.sd * 1.7) * 0.5;
  const col = (c, k = 1) => silhouette || tint(mul3(c, k));
  ctx.lineCap = ctx.lineJoin = 'round';
  if (type === 'crinoid') {
    const c = LIFE_COL.crinoid[it.col], bx = x + sway * s * 0.16, by = y - s * 0.7;
    ctx.strokeStyle = col([168, 150, 116]); ctx.lineWidth = Math.max(1, s * 0.035); ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x - sway * s * 0.08, y - s * 0.38, bx, by); ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -PI / 2 + (i / 9 - 0.5) * 2.5 + sway * 0.22, len = s * 0.36 * (0.75 + 0.25 * hash(i, it.sd)), ca = Math.cos(a), sa = Math.sin(a);
      ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + ca * len * 0.75, by + sa * len * 0.25 - len * 0.1, bx + ca * len * 0.8 + sway * s * 0.03, by + sa * len - len * 0.08); }
    ctx.strokeStyle = col(c, 0.85); ctx.globalAlpha *= 0.45; ctx.lineWidth = Math.max(1.5, s * 0.085); ctx.stroke(); ctx.globalAlpha /= 0.45;
    ctx.strokeStyle = col(c, 1.05); ctx.lineWidth = Math.max(0.8, s * 0.028); ctx.stroke();
    ctx.fillStyle = col(c, 0.8); ctx.beginPath(); ctx.arc(bx, by, s * 0.05, 0, TAU); ctx.fill();
  } else if (type === 'sponge') {
    const c = LIFE_COL.sponge[it.col];
    for (let j = 0; j < 3; j++) { const hj = s * (0.45 + 0.5 * hash(j, it.sd)), w0 = s * 0.07, w1 = s * (0.13 + 0.07 * hash(j, it.sd + 1)), xo = x + (j - 1) * s * 0.24 + sway * s * 0.01;
      ctx.fillStyle = col(c, 0.85 + 0.12 * j); ctx.beginPath(); ctx.moveTo(xo - w0, y); ctx.quadraticCurveTo(xo - w1 * 1.25, y - hj * 0.6, xo - w1, y - hj); ctx.lineTo(xo + w1, y - hj); ctx.quadraticCurveTo(xo + w1 * 1.25, y - hj * 0.6, xo + w0, y); ctx.fill();
      ctx.fillStyle = col(c, 0.4); ctx.beginPath(); ctx.ellipse(xo, y - hj, w1, w1 * 0.32, 0, 0, TAU); ctx.fill(); }
  } else if (type === 'coral') {
    const c = LIFE_COL.coral[it.col], g = coralSegs(S, it.sd);
    for (let d = 0; d < 3; d++) { ctx.strokeStyle = col(c, 0.72 + d * 0.16); ctx.lineWidth = Math.max(1, s * [0.085, 0.055, 0.036][d]); ctx.beginPath(); const q = g[d]; for (let i = 0; i < q.length; i += 4) { ctx.moveTo(x + q[i] * s, y + q[i + 1] * s); ctx.lineTo(x + q[i + 2] * s, y + q[i + 3] * s); } ctx.stroke(); }
  } else if (type === 'brain') {
    const c = LIFE_COL.brain[it.col], rx = s * 0.42, ry = s * 0.3;
    ctx.fillStyle = col(c); ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, PI, TAU); ctx.fill();
    ctx.strokeStyle = col(c, 0.68); ctx.lineWidth = Math.max(0.7, s * 0.022); ctx.beginPath();
    for (let i = 1; i < 4; i++) { ctx.moveTo(x - rx * i / 4, y); ctx.ellipse(x, y, rx * i / 4, ry * (i / 4), 0, PI, TAU); }
    for (let i = -2; i <= 2; i++) { ctx.moveTo(x + i * rx * 0.22, y - ry * 0.2); ctx.lineTo(x + i * rx * 0.3, y - ry * Math.sqrt(1 - i * i * 0.09) * 0.96); }
    ctx.stroke();
  } else if (type === 'rudist') {
    const c = LIFE_COL.rudist[it.col], n = 4 + (it.col % 3);
    for (let j = 0; j < n; j++) { const u = (j / (n - 1) - 0.5), tl = u * 0.9 + (hash(j, it.sd) - 0.5) * 0.3, hj = s * (0.4 + 0.45 * hash(j, it.sd + 2)), xb = x + u * s * 0.3, xt = xb + Math.sin(tl) * hj, yt = y - Math.cos(tl) * hj, wt = s * 0.11;
      ctx.fillStyle = col(c, 0.78 + 0.2 * hash(j, it.sd + 5)); ctx.beginPath(); ctx.moveTo(xb - s * 0.03, y); ctx.lineTo(xt - wt, yt); ctx.lineTo(xt + wt, yt); ctx.lineTo(xb + s * 0.03, y); ctx.fill();
      ctx.strokeStyle = col(c, 0.6); ctx.lineWidth = Math.max(0.6, s * 0.012); ctx.beginPath(); for (let r = -1; r <= 1; r++) { ctx.moveTo(xb + r * s * 0.012, y); ctx.lineTo(xt + r * wt * 0.55, yt); } ctx.stroke();
      ctx.fillStyle = col(c, 1.08); ctx.beginPath(); ctx.ellipse(xt, yt, wt, wt * 0.36, tl * 0.5, 0, TAU); ctx.fill();
      ctx.fillStyle = col(c, 0.45); ctx.beginPath(); ctx.ellipse(xt, yt, wt * 0.6, wt * 0.16, tl * 0.5, 0, TAU); ctx.fill(); }
  } else if (type === 'clam') {
    const c = [212, 210, 196], rx = s * 0.62, ry = s * 0.2;
    ctx.fillStyle = col(c, 0.9); ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, PI, TAU); ctx.fill();
    ctx.strokeStyle = col(c, 0.62); ctx.lineWidth = Math.max(0.6, s * 0.014); ctx.beginPath(); for (let i = 1; i < 5; i++) { ctx.moveTo(x - rx * i / 5, y); ctx.ellipse(x, y, rx * i / 5, ry * i / 5, 0, PI, TAU); } ctx.stroke();
  } else {
    ctx.fillStyle = col([104, 108, 110], 0.8 + 0.3 * hash(it.sd, 2)); ctx.beginPath(); ctx.moveTo(x - s * 0.42, y + s * 0.03);
    ctx.quadraticCurveTo(x - s * 0.4, y - s * (0.2 + 0.2 * hash(it.sd, 3)), x - s * 0.05, y - s * (0.3 + 0.15 * hash(it.sd, 4))); ctx.quadraticCurveTo(x + s * 0.36, y - s * 0.3, x + s * 0.44, y + s * 0.03); ctx.fill();
  }
}
// what grows on the sea floor, by age (weights)
function lifeMix(ma, E, mixIn) {
  const post = ma < 66 ? 1 : 0, w = {
    crinoid: ma > 201 ? 1.3 : ma > 145 ? 1.2 : 0.6,
    sponge: ma > 164 ? 0.8 : ma > 145 ? 1.3 : 0.7,
    coral: (ma > 201 ? 0.4 : ma > 185 ? 0.35 : ma > 145 ? 1.2 : ma > 100 ? 0.8 : 0.5) * (1 - 0.7 * E.dark),
    brain: (ma > 185 ? 0.2 : ma > 145 ? 0.7 : 0.4) * (1 - 0.7 * E.dark),
    rudist: post ? 0 : smooth(158, 120, ma) * 1.7 * E.dinos,
    clam: ma < 150 ? 0.35 : 0.1,
    rock: 0.5 + post * 0.5 + E.dark,
  };
  if (mixIn) for (const k in mixIn) w[k] = (w[k] || 0) * mixIn[k];
  let sum = 0; const keys = Object.keys(w); for (const k of keys) sum += w[k];
  return { keys, w, sum };
}
function pickLife(M, r) { let a = r * M.sum; for (const k of M.keys) { a -= M.w[k]; if (a <= 0) return k; } return 'rock'; }

// ---------------------------------------------------------------- the engine
export default {
  id: 'sea',
  name: 'Mesozoic Seas',
  kind: '2d',
  sky: false,
  params: [
    { id: 'x1', label: 'Murk', value: 0.4, tip: 'How cloudy the water is: plankton, silt and how fast things fade with distance' },
    { id: 'x2', label: 'Light shafts', value: 0.6, tip: 'Sunbeams and caustics from the surface' },
    { id: 'x3', label: 'Depth', value: 0.3, tip: 'How far down: sunlit shallows → the dark below' },
    { id: 'x4', label: 'Sea life', value: 0.6, tip: 'Reef growth, shoals, ammonites and the other small life' },
  ],
  create(ctx, opts) {
    const S = build(opts), X = { ammonite: 0, belemnite: 0, shark: 0, turtle: 0, ...(opts.extras || {}) };
    const cache = new Map(); let cacheMa = -1, pat = null;
    const WP = WATER[opts.water] || WATER.blue, floorF = opts.floor || 0, surfF = opts.surface || 0;
    const floorPts = []; for (let i = 0; i <= 48; i++) floorPts.push(fbm2(i * 0.17 + S.floorSeed, 3.1, 3) - 0.5);
    const ridge = (j, i) => fbm2(i * 0.21 + S.floorSeed * (j + 2), 7.7 + j, 4) - 0.5;

    function render(f) {
      const { w, h, p } = f, t = f.t, E = f.era, A = w / h;
      const dark = E.dark, Lw = clamp(p.light) * (1 - 0.62 * dark), D = clamp(p.x3), murk = clamp(p.x1), lifeK = clamp(p.x4);
      // ---- environment
      const ma = E.ma, mk = Math.round(ma * 4);
      if (mk !== cacheMa) { cache.clear(); cacheMa = mk; }
      const resolve = b => { let r = cache.get(b.id); if (r === undefined) { r = standIn(b, ma); if (r && r.kind !== 'swim') r = null; cache.set(b.id, r); } return r; };
      const jump = !S.born || Math.abs(f.stage - S.last) > 0.03 || f.epoch !== S.epoch;
      S.last = f.stage; S.epoch = f.epoch;
      let big = 0, bigBase = 0, grow = 0; for (const c of opts.cast || []) { const b = species(c.sp), r = resolve(b); bigBase = Math.max(bigBase, b.len); if (r) { big = Math.max(big, r.len); grow = Math.max(grow, r.len / b.len); } }
      const zoomT = big ? clamp(Math.pow(Math.max(big / bigBase, grow * 0.75), 0.85), 0.6, 4) : 1;
      S.zoom = jump ? zoomT : S.zoom + (zoomT - S.zoom) * Math.min(1, f.dt * 0.8);
      const VW = (opts.view || 14) * S.zoom / lerp(0.7, 1.45, clamp(p.scale)), k = w / VW;
      const top = surfF ? surfF + 0.012 : 0, floor = floorF || 1.04;
      const herdK = p.herd < 0.5 ? lerp(0.4, 1, p.herd * 2) : lerp(1, 2, (p.herd - 0.5) * 2);
      const dusk = Math.max(0, 1 - Math.abs(Lw - 0.3) / 0.2);
      let cT = mix3(WP[0], mul3(WP[1], 0.9), D * 0.85), cB = mix3(WP[1], [2, 7, 22], 0.25 + D * 0.75);
      cT = mix3(cT, [236, 176, 120], dusk * 0.22 * (1 - D));
      const lk = 0.07 + 0.93 * Math.pow(Lw, 0.8);
      cT = mix3([3, 9, 24], cT, lk); cB = mix3([1, 3, 11], cB, lk);
      if (dark > 0) { cT = mix3(cT, [70, 56, 44], dark * 0.5); cB = mix3(cB, [14, 12, 12], dark * 0.5); }
      const waterAt = y => mix3(cT, cB, clamp((y - top) / (1 - top)));
      const Lf = 0.22 + 0.78 * clamp(Lw * (1 - 0.5 * D) + 0.06);
      const tintAt = (y, fog) => { const wc = waterAt(y); return c => css(mix3(mul3(c, Lf), wc, fog)); };
      const life = { amm: ma >= 66 ? E.dinos : 0, bel: ma >= 66 && ma <= 201.4 ? E.dinos * smooth(201.4, 197, ma) : 0, turtle: ma < 122 ? 1 : 0 };
      const env = { w, h, A, VW, k, t, E: energy(f), top, floor, surf: surfF, herdK, resolve, jump, reptiles: ma >= 66 ? E.dinos : 0, life, X };
      const sun = Lw * (1 - D * 0.75) * (1 - dark), shaftK = clamp(p.x2) * sun, caus = clamp(p.x2) * sun * 0.9;

      // ---- simulate
      const dt = Math.min(0.1, f.dt || 0);
      if (!S.born) { S.born = true; step(S, f, env, 0); env.jump = false; for (let i = 0; i < 40; i++) { env.t = t - (40 - i) * 0.08; step(S, f, env, 0.08); } env.t = t; env.jump = true; step(S, f, env, 0); env.jump = false; }
      else step(S, f, env, dt);
      for (const c of f.pointer?.clicks || []) for (const sh of S.shoals) if (Math.hypot(sh.cx - (c.x - 0.5), (sh.cy - c.y) / A) < 0.25) sh.scare = 1;
      if (f.sig) { f.sig.count = clamp(S.act.length / 8); let sp = 0; for (const a of S.act) sp = Math.max(sp, (a.boost - 1) / 2.4); f.sig.speed = clamp(sp + 0.15); }

      // ---- above the waterline (split view)
      const sy = surfF * h, wl = x => sy + h * 0.006 * Math.sin(x / w * 13 + t * 1.3) + h * 0.004 * Math.sin(x / w * 29 - t * 1.9);
      const wlPath = down => { ctx.beginPath(); ctx.moveTo(0, down ? h : 0); for (let i = 0; i <= 32; i++) ctx.lineTo(i / 32 * w, wl(i / 32 * w)); ctx.lineTo(w, down ? h : 0); ctx.closePath(); };
      if (surfF) { paintAbove(f, sy, Lw, env, ma); ctx.save(); wlPath(true); ctx.clip(); }

      // ---- water
      const g = ctx.createLinearGradient(0, top * h, 0, h); g.addColorStop(0, css(cT)); g.addColorStop(0.55, css(mix3(cT, cB, 0.62))); g.addColorStop(1, css(cB));
      ctx.fillStyle = g; ctx.fillRect(0, surfF ? sy - h * 0.02 : 0, w, h);
      if (sun > 0.02) {                                          // the bright window of the surface overhead
        const gx = w * (0.5 + 0.12 * Math.sin(t * 0.05)), r = h * (0.75 - 0.25 * D), gr = ctx.createRadialGradient(gx, top * h - h * 0.12, 0, gx, top * h - h * 0.12, r);
        gr.addColorStop(0, `rgba(235,255,250,${0.55 * sun})`); gr.addColorStop(0.4, `rgba(200,245,240,${0.16 * sun})`); gr.addColorStop(1, 'rgba(200,245,240,0)');
        ctx.fillStyle = gr; ctx.fillRect(0, top * h, w, r);
      }
      if (E.flash > 0.01) { const fl = ctx.createLinearGradient(0, top * h, 0, h * 0.85); fl.addColorStop(0, `rgba(255,214,150,${E.flash * 0.55})`); fl.addColorStop(1, 'rgba(255,214,150,0)'); ctx.fillStyle = fl; ctx.fillRect(0, 0, w, h * 0.85); }
      // light shafts
      if (shaftK > 0.02) {
        const y0 = top * h - (surfF ? h * 0.03 : 0), H = h * (0.95 - 0.3 * D), sg = ctx.createLinearGradient(0, y0, 0, y0 + H);
        sg.addColorStop(0, `rgba(215,255,245,${0.2 * shaftK})`); sg.addColorStop(0.5, `rgba(200,250,240,${0.07 * shaftK})`); sg.addColorStop(1, 'rgba(200,250,240,0)');
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = sg;
        const n = 11;
        for (let i = 0; i < n; i++) {
          const u = ((i + hash(i, 4) * 0.7) / n + t * 0.004 * (0.5 + hash(i, 2))) % 1, x0 = (u * 1.5 - 0.3) * w, wd = (0.018 + 0.05 * hash(i, 9)) * w, sl = (0.22 + 0.1 * (u - 0.5)) * H;
          ctx.globalAlpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (0.4 + hash(i, 6) * 0.5) + i * 2.1));
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + wd, y0); ctx.lineTo(x0 + wd * 2.2 + sl, y0 + H); ctx.lineTo(x0 - wd * 0.6 + sl, y0 + H); ctx.fill();
        }
        ctx.restore();
      }

      // ---- draw list, far to near
      const fog0 = 0.1 + 0.16 * murk + 0.1 * D, fogZ = 0.5 + 0.7 * murk;
      const fogOf = z => clamp(fog0 + (1 - z) * fogZ, 0, 0.93);
      const list = [];
      for (const a of S.agents) if (a.cur && a.alpha > 0.06) list.push({ z: a.z, a });
      for (const sh of S.shoals) list.push({ z: sh.z, sh });
      for (const c of S.critters) if (c.alpha > 0.02) list.push({ z: c.z, c });
      if (floorF) list.push({ z: 0.3, ridges: 1 }, { z: 0.5, floor: 1 });
      list.sort((a, b) => a.z - b.z);
      S.heads = S.act.filter(a => a.z > 0.5).map(a => [a.hx, a.hy, (0.035 + 0.05 * a.cur.len / VW) * (0.6 + a.jaw * 0.6)]);
      const La = Math.max(opts.glow ? 0.72 : 0, clamp(Lw * (1 - 0.45 * D) + 0.12));
      const deepGlow = opts.glow ? 1 : smooth(0.75, 1, D) * (1 - Lw);

      const critterCol = (c, fog) => {
        let T = tintAt(c.y, fog);
        if (c.kind === 'ammonite') { const v = c.i % 3; return { shell: T([[232, 214, 176], [226, 190, 150], [214, 206, 196]][v]), shell2: T([[214, 190, 150], [206, 166, 128], [190, 184, 176]][v]), rib: T([[176, 96, 66], [150, 84, 60], [112, 116, 130]][v]), flesh: T([214, 150, 130]), line: T([80, 60, 50]), eye: T([240, 230, 200]) }; }
        if (c.kind === 'belemnite') { const T0 = T; if (opts.glow) T = q => T0(mul3(q, 1.9)); return { body: T([196, 108, 92]), belly: T([236, 196, 176]), fin: T([170, 90, 84]), flesh: T([214, 140, 120]), eye: T([240, 236, 220]), glow: deepGlow > 0.2 ? `rgba(120,255,230,${0.8 * deepGlow})` : null }; }
        if (c.kind === 'shark') return { body: T([92, 104, 112]), far: T([66, 76, 84]), belly: T([214, 220, 216]), horn: T([230, 224, 200]), line: T([40, 48, 56]) };
        return { shell: T([104, 112, 70]), skin: T([128, 132, 92]), far: T([84, 90, 62]), belly: T([214, 204, 150]), line: T([58, 64, 40]) };
      };
      const drawCritter = c => {
        const zs = lerp(0.42, 1, c.z), px = w * (0.5 + c.x), py = h * c.y, C = critterCol(c, fogOf(c.z)), late = ma < 90;
        const m = c.kind === 'ammonite' ? 0.75 * (late ? 1.3 : 1) : c.kind === 'belemnite' ? 1.1 : c.kind === 'shark' ? 2.3 : ma < 66 ? 1.6 : late ? 3.2 : 2.2;
        const s = Math.min(h * 0.34, Math.max(m * c.size * k * zs, h * (c.kind === 'ammonite' ? 0.035 : 0.06) * zs));
        ctx.globalAlpha = c.alpha;
        if (c.kind === 'ammonite') drawAmmonite(ctx, px, py, s, c.dir, t, c.sd, C);
        else if (c.kind === 'belemnite') drawBelemnite(ctx, px, py, s, c.dir, t, c.sd, C);
        else if (c.kind === 'shark') drawShark(ctx, px, py, s, c.dir, t, c.sd, C, ma > 100);
        else drawTurtle(ctx, px, py, s, c.dir, t, c.sd, C);
        ctx.globalAlpha = 1;
      };
      const drawShoal = sh => {
        const s = sh.s, zs = lerp(0.42, 1, sh.z), n = Math.min(sh.fish.length, Math.round(s.n * herdK * (0.6 + 0.8 * lifeK)));
        const bel = s.of === 'bel' && life.bel > 0.3, T = tintAt(sh.cy, fogOf(sh.z));
        const rx = sh.rNow, ry = rx * (s.flat || 0.8), E2 = env.E, sc = sh.scare;
        if (bel) {
          const C = critterCol({ kind: 'belemnite', y: sh.cy }, fogOf(sh.z)), m = Math.min(n, s.nBel || 9), sz = Math.max(1.1 * k * zs, h * 0.05 * zs);
          for (let i = 0; i < m; i++) { const q = sh.fish[i]; let fx = sh.cx + q.ox * rx * 2.3 + 0.006 * Math.sin(t * 0.9 + q.sd), fy = sh.cy + (q.oy * ry * 1.2 + 0.01 * Math.sin(t * 1.3 + q.sd)) * A;
            for (const hd of S.heads) { const dx = fx - hd[0], dy = (fy - hd[1]) / A, d = Math.hypot(dx, dy), R = hd[2] * 1.6; if (d < R && d > 1e-4) { const pu = (R - d) / d; fx += dx * pu; fy += dy * pu * A; } }
            drawBelemnite(ctx, w * (0.5 + fx), h * fy, sz * (0.75 + 0.4 * q.r), sh.dir, t * (1 + sc), q.sd, C, -sh.vy * 3); }
          return;
        }
        const sz = Math.max((s.size || 0.3) * k * zs, h * 0.011), flash = [];
        ctx.fillStyle = T([58, 84, 104]); ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const q = sh.fish[i]; let fx, fy, ux, uy, dep = 0;
          if (s.kind === 'stream') { fx = sh.cx + q.ox * rx * 2.3 + 0.008 * Math.sin(t * 0.8 + q.sd); fy = sh.cy + (q.oy * ry + 0.008 * Math.sin(t * 1.1 + q.sd * 2)) * A; ux = sh.dir; uy = 0.25 * Math.cos(t * 1.1 + q.sd * 2) * 0.3 - sh.vy * 2; }
          else { const an = q.a + t * q.w * 0.55 * E2 * (1 + sc * 1.5) * (s.spin || 1), rad = q.r * (0.8 + 0.2 * Math.sin(t * 0.6 + q.sd)), ca = Math.cos(an), sa = Math.sin(an);
            fx = sh.cx + ca * rx * rad; fy = sh.cy + (sa * rad * 0.4 * q.tilt + q.hgt * Math.sqrt(Math.max(0, 1 - rad * rad)) * 0.95) * ry * A; ux = -sa * (s.spin || 1); uy = ca * 0.4 * q.tilt * (s.spin || 1); dep = sa * rad; }
          for (const hd of S.heads) { const dx = fx - hd[0], dy = (fy - hd[1]) / A, d = Math.hypot(dx, dy), R = hd[2]; if (d < R && d > 1e-4) { const pu = (R - d) / d * 0.9; fx += dx * pu; fy += dy * pu * A; } }
          const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul; if (Math.abs(ux) < 0.25) ux = ux < 0 ? -0.25 : 0.25;
          const x = w * (0.5 + fx), y = h * fy, l = sz * (0.75 + 0.5 * hash(i, 7)) * (1 - 0.2 * dep);
          if (x < -l || x > w + l) continue;
          if (Math.sin(t * 2.2 + q.sd * 3 + fx * 30) > 0.25 - 0.4 * dep) { flash.push(x, y, ux, uy, l); continue; }
          fishPath(ctx, x, y, ux, uy, l);
        }
        ctx.fill();
        ctx.fillStyle = T(mix3([150, 176, 190], [236, 244, 244], clamp(sun * 1.3 + 0.25))); ctx.beginPath();
        for (let i = 0; i < flash.length; i += 5) fishPath(ctx, flash[i], flash[i + 1], flash[i + 2], flash[i + 3], flash[i + 4]);
        ctx.fill();
      };
      const drawAgent = (a, air) => {
        const sp = a.cur, zs = lerp(0.42, 1, a.z), kk = k * zs, px = w * (0.5 + a.x), py = h * a.y;
        const fd = Math.abs(a.face) < 0.1 ? (a.face < 0 ? -0.1 : 0.1) : a.face, rot = a.pitch * (fd < 0 ? -1 : 1);
        const parts = swimParts(sp, { t: t + a.sd, phase: a.phase, scale: a.scale, jaw: a.jaw, bend: a.bend });
        const fog = air ? 0 : fogOf(a.z) * (opts.glow ? 0.6 : 1), wc = waterAt(a.y), T = { x: 0, y: 0, k: kk, dir: fd };
        const pal = palette(sp, { light: air ? clamp(Lw + 0.15) : La, fog, tint: hex(wc) });
        const look = { pal, stroke: (La < 0.42 || opts.glow) && !air ? `rgba(140,200,235,${0.6 * (1 - fog)})` : css(mix3(mul3(wc, 0.3), wc, fog), 0.55), lw: Math.max(0.5, kk * sp.len * a.scale * 0.0035) };
        if (a.alpha < 0.99) { const al = a.alpha; look.alpha = { body: al, belly: al, far: al, mark: al * 0.55, horn: al, eye: al, accent: al }; look.pupil = false; look.stroke = null; }
        ctx.save(); ctx.translate(px, py); ctx.rotate(rot);
        drawParts(ctx, parts, T, look);
        const body = parts.find(q => q.k === 'body'), eye = parts.find(q => q.k === 'eye');
        if (!air && a.z > 0.55 && a.alpha > 0.9 && (caus > 0.04 || sun > 0.05)) {      // sunlight rippling over the back
          const r = sp.len * a.scale * kk * 0.13;
          ctx.save(); ctx.beginPath(); trace(ctx, body, T); ctx.clip(); ctx.globalCompositeOperation = 'lighter';
          const lg = ctx.createLinearGradient(0, -r, 0, r * 0.2); lg.addColorStop(0, `rgba(190,240,235,${0.34 * sun})`); lg.addColorStop(1, 'rgba(190,240,235,0)');
          ctx.fillStyle = lg; ctx.fillRect(-sp.len * kk, -r * 2.4, sp.len * kk * 2, r * 3);
          if (caus > 0.04 && pat) { const sc = h * 0.5 / 192; ctx.globalAlpha = caus * 0.13; ctx.fillStyle = pat; ctx.rotate(-rot); ctx.scale(sc, sc * 0.7); ctx.translate((-px * 0.6 + t * 9) / sc % 192, t * 5 % 192); ctx.fillRect(-sp.len * kk * 2 / sc, -sp.len * kk * 2 / sc, sp.len * kk * 4 / sc, sp.len * kk * 4 / sc); }
          ctx.restore();
        }
        const ex = eye.c[0] * kk * fd, ey = -eye.c[1] * kk, cr = Math.cos(rot), sr = Math.sin(rot);
        ctx.restore();
        const hpx = px + ex * cr - ey * sr, hpy = py + ex * sr + ey * cr;
        a.hx = hpx / w - 0.5; a.hy = hpy / h;
        if (deepGlow > 0.2 && !air && Math.abs(fd) > 0.5) { const r = Math.max(2, eye.c[2] * kk * 3.2); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 * deepGlow * a.alpha; ctx.drawImage(glowSprite(), hpx - r, hpy - r, r * 2, r * 2); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
      };

      if (!pat) pat = ctx.createPattern(causticTile(), 'repeat');
      const floorY = x => h * (floorF + 0.03 * floorPts[clamp(Math.round((x / w) * 40 + 4), 0, 48)]);
      const sand = SAND[opts.sand] || SAND.sand, M = floorF ? lifeMix(ma, E, opts.floorMix) : null;
      const dens = (opts.reef ?? 0.6) * (0.35 + 1.1 * lifeK) * (0.5 + 0.5 * clamp(p.detail + 0.3)), kf = k * Math.pow(VW / 12, 0.55);
      for (const it of list) {
        if (it.a) drawAgent(it.a, false);
        else if (it.sh) drawShoal(it.sh);
        else if (it.c) drawCritter(it.c);
        else if (it.ridges) {
          for (let j = 0; j < 2; j++) {
            const y0 = h * (floorF - 0.085 + j * 0.045), T = tintAt(floorF, 0.78 - j * 0.2);
            ctx.fillStyle = T(mix3(sand, [90, 110, 120], 0.5)); ctx.beginPath(); ctx.moveTo(0, h);
            for (let i = 0; i <= 60; i++) { const n = ridge(j, i), bump = (opts.reef ?? 0.6) * Math.max(0, fbm2(i * 0.6 + j * 9 + S.floorSeed, 2.2, 2) - 0.45) * 0.3; ctx.lineTo(i / 60 * w, y0 - h * (n * 0.07 + bump)); }
            ctx.lineTo(w, h); ctx.fill();
          }
        } else if (it.floor) {
          const fg = ctx.createLinearGradient(0, floorF * h, 0, h), Tt = tintAt(floorF, 0.42), Tb = tintAt(1, 0.3);
          fg.addColorStop(0, Tt(sand)); fg.addColorStop(1, Tb(mul3(sand, 0.72)));
          ctx.fillStyle = fg; ctx.beginPath(); ctx.moveTo(0, h + 2); for (let i = 0; i <= 40; i++) ctx.lineTo(i / 40 * w, floorY(i / 40 * w)); ctx.lineTo(w, h + 2); ctx.fill();
          ctx.strokeStyle = Tb(mul3(sand, 0.6)); ctx.globalAlpha = 0.5; ctx.lineWidth = Math.max(0.6, h * 0.003); ctx.beginPath();             // ripple marks
          for (let i = 0; i < 26; i++) { const x = hash(i, 11) * w, y = h * lerp(floorF + 0.035, 1, hash(i, 12)), l = w * (0.03 + 0.05 * hash(i, 13)); ctx.moveTo(x - l, y); ctx.quadraticCurveTo(x, y - h * 0.008, x + l, y); }
          ctx.stroke(); ctx.globalAlpha = 1;
          if (caus > 0.03) {
            ctx.save(); ctx.beginPath(); ctx.moveTo(0, h); for (let i = 0; i <= 40; i++) ctx.lineTo(i / 40 * w, floorY(i / 40 * w)); ctx.lineTo(w, h); ctx.clip();
            ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = pat; const sc = h * 0.6 / 192;
            for (let j = 0; j < 2; j++) { ctx.save(); ctx.globalAlpha = caus * 0.15; ctx.translate(j ? -t * h * 0.012 : t * h * 0.016, floorF * h + (j ? t * h * 0.004 : 0)); ctx.scale(sc * (1 + j * 0.3), sc * 0.36); ctx.fillRect(-w / sc - 400, -40, w * 3 / sc + 800, h / sc); ctx.restore(); }
            ctx.restore();
          }
          for (const q of S.items) {                                                           // what grows here
            if (q.show > dens) continue;
            const x = (0.5 + q.x) * w, yb = floorY(x), y = yb + q.row * (h - yb) * 0.6 + h * 0.008, type = pickLife(M, q.pick);
            const m = type === 'crinoid' ? 1.5 : type === 'coral' ? 1.7 : type === 'rudist' ? 1.4 : type === 'clam' ? 1.5 : type === 'rock' ? 1.2 : 1.1;
            const s = Math.max(h * 0.035, m * q.s * kf * (0.55 + 0.6 * q.row));
            drawLife(ctx, S, type, x, y, s, t, q, tintAt(floorF, 0.34 - 0.24 * q.row + 0.2 * murk));
          }
        }
      }
      // ---- out-of-focus foreground on the bottom edge
      if (floorF && opts.fore !== false) {
        const sil = css(mul3(waterAt(1), 0.5));
        for (const q of S.fore) { const type = pickLife(M, q.pick); if (type !== 'coral' && type !== 'crinoid' && type !== 'rock') continue; drawLife(ctx, S, type === 'rock' ? 'rock' : type, (0.5 + q.x) * w, h * 1.03, h * 0.15 * q.s * (type === 'rock' ? 0.8 : 1), t, q, null, sil); }
      }
      // ---- bubbles, marine snow, living light
      ctx.strokeStyle = `rgba(225,250,255,${0.25 + 0.5 * Lf})`; ctx.lineWidth = Math.max(0.6, h * 0.0022); ctx.beginPath();
      for (const b of S.bubbles) { const r = b.r * h * 0.0042, x = w * (0.5 + b.x), y = h * b.y; ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
      if (floorF) for (let j = 0; j < 3; j++) { const bx = w * (0.12 + 0.36 * j + 0.1 * hash(j, S.floorSeed)); for (let i = 0; i < 7; i++) { const u = (t * (0.05 + 0.01 * i) * 2 + hash(i, j) * 3) % 1, y = lerp(floorF * h, top * h, u * u * 0.9 + u * 0.1), r = h * (0.002 + 0.003 * hash(i, j + 5)) * (0.6 + u), x = bx + Math.sin(t * 2 + i * 1.7 + u * 9) * h * 0.012; ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); } }
      ctx.stroke();
      const ns = Math.round((40 + 170 * murk + 120 * dark) * (0.5 + 0.5 * p.detail)), colS = dark > 0.3 ? '190,184,176' : '226,240,236';
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = `rgba(${colS},${(pass ? 0.5 : 0.24) * (0.35 + 0.65 * Lf)})`; ctx.beginPath();
        for (let i = pass; i < ns; i += 2) { const sp = 0.006 + 0.014 * hash(i, 3), x = ((hash(i, 1) + t * 0.004 * (hash(i, 5) - 0.3) + 0.004 * Math.sin(t * 0.4 + i)) % 1 + 1) % 1 * w, y = lerp(top, 1, (hash(i, 2) + t * sp) % 1) * h, r = h * (pass ? 0.0016 : 0.003) * (0.6 + hash(i, 8)); ctx.rect(x, y, r, r); }
        ctx.fill();
      }
      if (deepGlow > 0.05) {
        const gs = glowSprite(); ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 46; i++) { const bl = Math.pow(0.5 + 0.5 * Math.sin(t * (0.5 + hash(i, 21)) + i * 4.1), 3); if (bl < 0.04) continue;
          const x = ((hash(i, 22) + t * 0.003 * (hash(i, 23) - 0.5)) % 1 + 1) % 1 * w, y = lerp(top, 1, (hash(i, 24) + 1 - (t * 0.004 * hash(i, 25)) % 1) % 1) * h, r = h * (0.006 + 0.012 * hash(i, 26));
          ctx.globalAlpha = bl * deepGlow * 0.8; ctx.drawImage(gs, x - r, y - r, r * 2, r * 2); }
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
      // ---- murk over everything, heavier with depth
      if (murk > 0.05 || dark > 0.05) { const mg = ctx.createLinearGradient(0, top * h, 0, h), a = 0.2 * murk + 0.08 * dark; mg.addColorStop(0, css(cT, a * 0.5)); mg.addColorStop(1, css(cB, a)); ctx.fillStyle = mg; ctx.fillRect(0, 0, w, h); }

      // ---- back to the surface: animals breaking it, and the waterline itself
      if (surfF) {
        const under = ctx.createLinearGradient(0, sy, 0, sy + h * 0.1); under.addColorStop(0, `rgba(220,255,250,${0.5 * sun + 0.05})`); under.addColorStop(1, 'rgba(220,255,250,0)');
        ctx.fillStyle = under; ctx.fillRect(0, sy - h * 0.02, w, h * 0.13);
        ctx.restore();
        const foam = `rgba(255,255,255,${0.35 + 0.5 * Lw})`;
        for (const a of S.act) {
          const sp = a.cur, zs = lerp(0.42, 1, a.z), rr = 0.16 * sp.len * a.scale * k * zs, ext = extent(sp);
          if (h * a.y - rr > sy) continue;
          ctx.save(); wlPath(false); ctx.clip(); drawAgent(a, true); ctx.restore();
          const cx = w * (0.5 + a.x) + a.face * (ext.front - ext.back) * 0.25 * sp.len * k * zs, rx = sp.len * k * zs * 0.3 * clamp((sy - (h * a.y - rr)) / rr, 0.2, 1);
          ctx.strokeStyle = foam; ctx.lineWidth = Math.max(1, h * 0.004); ctx.beginPath();
          for (let i = 0; i < 3; i++) { const u = (t * 0.4 + i / 3) % 1; ctx.moveTo(cx + rx * (1 + u), sy); ctx.ellipse(cx, sy, rx * (1 + u), h * 0.006 * (1 + u), 0, 0, PI, true); }
          ctx.globalAlpha = 0.7; ctx.stroke(); ctx.globalAlpha = 1;
        }
        ctx.lineWidth = Math.max(1, h * 0.005); ctx.strokeStyle = css(mix3(cT, [255, 255, 255], 0.55 * Lw + 0.1), 0.9); ctx.beginPath();
        for (let i = 0; i <= 48; i++) { const x = i / 48 * w; i ? ctx.lineTo(x, wl(x)) : ctx.moveTo(x, wl(x)); } ctx.stroke();
      }
    }

    // the half of the split view that is above the water: sky, a far shore, the sea surface and pterosaurs
    function paintAbove(f, sy, Lw, env, ma) {
      const { w, h, t } = f, E = f.era, hy = sy * 0.6, day = clamp(Lw);
      skyGradient(ctx, w, hy + 1, Lw);
      if (E.dark > 0) { ctx.fillStyle = `rgba(38,26,20,${E.dark * 0.75})`; ctx.fillRect(0, 0, w, hy + 1); }
      const sx = w * 0.73, syy = hy * lerp(0.9, 0.3, day), sr = h * 0.03, sa = 1 - E.dark;
      const sgl = ctx.createRadialGradient(sx, syy, 0, sx, syy, sr * 6); sgl.addColorStop(0, `rgba(255,240,200,${0.7 * sa})`); sgl.addColorStop(1, 'rgba(255,220,160,0)');
      ctx.fillStyle = sgl; ctx.fillRect(sx - sr * 6, 0, sr * 12, hy);
      ctx.fillStyle = day < 0.15 ? `rgba(236,240,250,${sa})` : `rgba(255,244,214,${sa})`; ctx.beginPath(); ctx.arc(sx, syy, sr * (day < 0.15 ? 0.7 : 1), 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.5 * (0.3 + 0.7 * day) * (1 - E.dark)})`;                               // clouds
      for (let i = 0; i < 5; i++) { const x = ((hash(i, 31) + t * 0.002 * (1 + hash(i, 32))) % 1) * w * 1.3 - w * 0.15, y = hy * (0.25 + 0.5 * hash(i, 33)), r = h * (0.02 + 0.02 * hash(i, 34)); ctx.beginPath(); for (let j = 0; j < 5; j++) ctx.ellipse(x + (j - 2) * r * 1.3, y + (j % 2) * r * 0.3, r * (1.6 - Math.abs(j - 2) * 0.3), r * (0.8 - Math.abs(j - 2) * 0.12), 0, 0, TAU); ctx.fill(); }
      if (E.flash > 0.01) { ctx.fillStyle = `rgba(255,236,190,${E.flash * 0.8})`; ctx.fillRect(0, 0, w, hy + 1); }
      // far shore
      const L = 0.3 + 0.7 * day * (1 - 0.6 * E.dark), shore = css(mul3(mix3([70, 96, 92], [176, 196, 212], 0.45), L));
      ctx.fillStyle = shore; ctx.beginPath(); ctx.moveTo(0, hy + 1);
      for (let i = 0; i <= 60; i++) { const u = i / 60, land = smooth(0.45, 0.1, u) + 0.6 * smooth(0.12, 0.02, Math.abs(u - 0.86)); ctx.lineTo(u * w, hy - land * h * (0.02 + 0.05 * fbm2(u * 9 + S.floorSeed, 1.3, 3) + 0.012 * hash(i, 41))); }
      ctx.lineTo(w, hy + 1); ctx.fill();
      // the sea from above
      const g = ctx.createLinearGradient(0, hy, 0, sy), c0 = mul3(mix3([120, 170, 190], [200, 214, 222], 0.4), L), c1 = mul3([28, 104, 132], L);
      g.addColorStop(0, css(c0)); g.addColorStop(1, css(c1)); ctx.fillStyle = g; ctx.fillRect(0, hy, w, sy - hy + h * 0.02);
      ctx.strokeStyle = `rgba(255,255,255,${0.4 * day * (1 - E.dark)})`; ctx.lineWidth = Math.max(0.6, h * 0.002); ctx.beginPath();
      for (let i = 0; i < 46; i++) { const v = Math.pow(hash(i, 51), 1.6), y = lerp(hy + 1, sy - h * 0.01, v), x = ((hash(i, 52) + t * 0.006 * (0.4 + v)) % 1) * w * 1.2 - w * 0.1, l = w * (0.006 + 0.03 * v) * (0.6 + 0.4 * Math.sin(t * 1.5 + i)); ctx.moveTo(x - l, y); ctx.lineTo(x + l, y); }
      for (let i = 0; i < 24; i++) { const v = hash(i, 61), y = lerp(hy + 1, sy - h * 0.012, v), x = sx + (hash(i, 62) - 0.5) * w * (0.02 + 0.1 * v), l = w * (0.004 + 0.016 * v) * (0.5 + 0.5 * Math.sin(t * 2.3 + i * 1.3)); ctx.moveTo(x - l, y); ctx.lineTo(x + l, y); }
      ctx.stroke();
      // flyers of the time
      const fb = standIn(species(f.opts.flyer || 'pteranodon'), ma), nF = fb && fb.kind === 'fly' ? Math.round(2 * env.herdK) : 0;
      for (let i = 0; i < nF; i++) {
        const dir = i % 2 ? -1 : 1, u = ((hash(i, 71) + t * 0.012 * (0.8 + 0.4 * hash(i, 72)) * env.E) % 1.3) / 1.3, x = (dir > 0 ? u : 1 - u) * w * 1.3 - w * 0.15, y = hy * (0.3 + 0.35 * hash(i, 73)) + Math.sin(t * 0.5 + i * 2) * h * 0.01;
        const kk = h * (0.2 - 0.07 * i) / Math.max(2.5, fb.span);
        drawParts(ctx, flyParts(fb, { t: t + i * 1.7, glide: 0.75, yaw: 0.3, pitch: 0.35 }), { x, y, k: kk, dir }, { pal: palette(fb, { light: clamp(Lw + 0.1), fog: 0.25 + 0.2 * i }) });
      }
    }
    return { render };
  }
};

function fishPath(ctx, x, y, ux, uy, l) {
  const nx = -uy * l * 0.2, ny = ux * l * 0.2, hx = ux * l * 0.5, hy = uy * l * 0.5;
  ctx.moveTo(x + hx, y + hy); ctx.quadraticCurveTo(x + nx * 1.5, y + ny * 1.5, x - hx * 0.7, y - hy * 0.7);
  ctx.lineTo(x - hx * 1.25 + nx * 0.9, y - hy * 1.25 + ny * 0.9); ctx.lineTo(x - hx * 1.25 - nx * 0.9, y - hy * 1.25 - ny * 0.9); ctx.lineTo(x - hx * 0.7, y - hy * 0.7);
  ctx.quadraticCurveTo(x - nx * 1.5, y - ny * 1.5, x + hx, y + hy);
}

// ---------------------------------------------------------------- scenes
const Sc = (id, name, desc, tags, opts, params) => ({ id: 'sea-' + id, name, desc, tags: ['underwater', '2d', 'marine', ...tags], opts, params });
export const scenes = [
  Sc('reef', 'Ichthyosaurus Pod at the Reef', 'Dolphin-shaped marine reptiles (not dinosaurs) cruise over an Early Jurassic reef of corals, sponges and sea lilies.', ['jurassic', 'reef', 'pod', 'family'],
    { cast: [{ sp: 'ichthyosaurus', n: 5, young: 1, y: [0.22, 0.6] }], shoals: [{ kind: 'stream', n: 34, x: 0.1, y: 0.5, r: 0.07, size: 0.22, z: 0.6, dir: -1 }],
      extras: { ammonite: 3, belemnite: 3, shark: 1, y: [0.3, 0.72] }, view: 8.5, floor: 0.8, water: 'reef', reef: 1, floorMix: { coral: 2.6, brain: 2, clam: 0.2, rock: 0.5 }, seed: 3 },
    { stage: 0.2, light: 0.9, x1: 0.3, x2: 0.7, x3: 0.12, x4: 0.7 }),
  Sc('plesio', 'Plesiosaurus in Flight', 'A pair of long-necked marine reptiles row with four flippers, flying under water like penguins.', ['jurassic', 'pair'],
    { cast: [{ sp: 'plesiosaurus', n: 2, roam: 0.26, y: [0.34, 0.6], z: [0.8, 1] }], shoals: [{ kind: 'stream', n: 26, x: -0.2, y: 0.26, r: 0.06, size: 0.2, z: 0.55, dir: 1 }],
      extras: { ammonite: 3, belemnite: 2, y: [0.15, 0.85] }, view: 9.5, water: 'blue', seed: 8 },
    { stage: 0.19, light: 0.8, x1: 0.25, x2: 0.9, x3: 0.3 }),
  Sc('hunt', 'Liopleurodon on the Hunt', 'The top marine reptile of the Late Jurassic seas prowls green water, then charges the shoal.', ['jurassic', 'hunt', 'school'],
    { cast: [{ sp: 'liopleurodon', n: 1, role: 'hunt', roam: 0.3, y: [0.4, 0.55], z: [0.9, 0.96] }], shoals: [{ kind: 'ball', n: 90, x: 0.1, y: 0.44, r: 0.085, size: 0.3, z: 0.97 }],
      extras: { shark: 2, ammonite: 2, belemnite: 2, y: [0.2, 0.75] }, view: 16, floor: 0.88, water: 'green', sand: 'mud', reef: 0.5, floorMix: { sponge: 2, coral: 0.4 }, seed: 14 },
    { stage: 0.385, light: 0.5, activity: 0.62, x1: 0.62, x2: 0.5, x3: 0.42 }),
  Sc('mosasaur', 'Mosasaurus in the Seaway', 'A giant sea lizard (a marine reptile, not a dinosaur) patrols the chalky Western Interior Seaway over giant clams, with turtles and ammonites.', ['cretaceous', 'hunt'],
    { cast: [{ sp: 'mosasaurus', n: 1, role: 'hunt', roam: 0.24, y: [0.36, 0.52], z: [0.94, 0.96] }], shoals: [{ kind: 'stream', n: 44, x: 0.25, y: 0.4, r: 0.06, size: 0.4, z: 0.97, dir: -1, speed: 1.6 }],
      extras: { turtle: 2, ammonite: 3, shark: 1, y: [0.2, 0.74] }, view: 25, floor: 0.86, water: 'green', sand: 'mud', reef: 0.42, floorMix: { clam: 14, rudist: 0.15, coral: 0.1, brain: 0.1, crinoid: 0.3 }, seed: 5 },
    { stage: 0.86, light: 0.72, x1: 0.5, x2: 0.55, x3: 0.3 }),
  Sc('elasmo', 'Elasmosaurus at the Bait Ball', 'A marine reptile with a neck of 72 vertebrae picks fish from a swirling shoal.', ['cretaceous', 'school', 'hunt'],
    { cast: [{ sp: 'elasmosaurus', n: 1, role: 'fish', dir: 1, x: -0.2, y: [0.5, 0.6], z: [0.92, 0.96] }], shoals: [{ kind: 'ball', n: 170, x: 0.27, y: 0.42, r: 0.105, size: 0.3, z: 0.92 }],
      extras: { shark: 1, ammonite: 2, turtle: 1, y: [0.15, 0.85] }, view: 18.5, water: 'blue', seed: 21 },
    { stage: 0.787, light: 0.85, x1: 0.3, x2: 0.8, x3: 0.36 }),
  Sc('shonisaurus', 'Shonisaurus, the Giant', 'A whale-sized Triassic ichthyosaur (a marine reptile) passes; the shoals and ammonites give the scale.', ['triassic', 'giant', 'school'],
    { cast: [{ sp: 'shonisaurus', n: 2, hero: false, spread: 1.5, y: [0.34, 0.56], z: [0.78, 1] }], shoals: [{ kind: 'stream', n: 60, x: -0.1, y: 0.68, r: 0.05, size: 0.35, z: 0.98, dir: 1 }, { kind: 'ball', n: 50, x: 0.28, y: 0.24, r: 0.05, size: 0.3, z: 0.7 }],
      extras: { ammonite: 4, shark: 1, y: [0.2, 0.8] }, view: 34, floor: 0.9, water: 'teal', reef: 0.5, floorMix: { crinoid: 2 }, cross: 1, seed: 2 },
    { stage: 0.08, light: 0.68, x1: 0.42, x2: 0.6, x3: 0.38 }),
  Sc('deep', 'Ophthalmosaurus in the Dark', 'Eyes 22 cm across, made for the deep: marine reptiles chase belemnites where the light gives out.', ['jurassic', 'night', 'hunt', 'deep'],
    { cast: [{ sp: 'ophthalmosaurus', n: 2, role: 'hunt', roam: 0.3, y: [0.36, 0.6], z: [0.86, 0.95] }], shoals: [{ kind: 'stream', of: 'bel', n: 20, nBel: 9, x: 0.15, y: 0.46, r: 0.07, size: 0.25, z: 0.96, dir: -1, speed: 0.9 }],
      extras: { belemnite: 3, ammonite: 1, y: [0.15, 0.85] }, view: 13, water: 'deep', glow: 1, seed: 17 },
    { stage: 0.42, light: 0.42, x1: 0.3, x2: 0.5, x3: 0.74 }),
  Sc('surface', 'Up for Air', 'Half above the water, half below: Kronosaurus, a marine reptile, breathes air and must come up for it, under the pterosaurs.', ['cretaceous', 'split view', 'coast'],
    { cast: [{ sp: 'kronosaurus', n: 1, role: 'breathe', roam: 0.22, y: [0.6, 0.7], z: [0.94, 1] }], shoals: [{ kind: 'stream', n: 40, x: 0.2, y: 0.8, r: 0.06, size: 0.35, z: 0.8, dir: -1 }],
      extras: { turtle: 1, ammonite: 2, shark: 1, y: [0.55, 0.9] }, view: 20, surface: 0.4, water: 'reef', flyer: 'tropeognathus', seed: 12 },
    { stage: 0.632, light: 0.78, x1: 0.3, x2: 0.7, x3: 0.2 }),
  Sc('deeptime', 'Sea of Deep Time', 'One reef through 180 million years: the marine reptiles change with the eras, until the impact empties the sea of them.', ['time travel', 'reef', 'impact'],
    { cast: [{ sp: 'ichthyosaurus', n: 3, y: [0.2, 0.5] }, { sp: 'liopleurodon', n: 1, role: 'hunt', roam: 0.3, y: [0.4, 0.55], z: [0.9, 0.96] }, { sp: 'elasmosaurus', n: 1, roam: 0.3, y: [0.5, 0.64], z: [0.7, 0.8] }],
      shoals: [{ kind: 'ball', n: 70, x: 0.05, y: 0.42, r: 0.07, size: 0.28, z: 0.97 }], extras: { ammonite: 3, belemnite: 3, shark: 1, turtle: 1, y: [0.2, 0.74] }, view: 15, floor: 0.82, water: 'teal', reef: 0.9, seed: 1 },
    { stage: 0.02, grow: 0.5, light: 0.8, x1: 0.35, x2: 0.65, x3: 0.2 }),
];
