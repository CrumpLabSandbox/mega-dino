// The living world most engines draw: a strip of Mesozoic country with terrain, plants and a cast of animals that
// walk, graze, call, rest, raise young, hunt and flee. It is a simulation (it keeps state between frames), but it
// rebuilds itself whenever the Stage jumps, so first frames and slider drags are clean.
//
//   const W = createWorld(opts)          // in an engine's create()
//   const v = W.frame(f)                 // in render(): advance by f.dt and get everything to draw, in pixels
//
// v = { horizon, layers: [{ band, items }] far → near, far: [silhouette layers], sea, flyers, sun, meteor, flash, dark,
//       light, k0, sx(x, d), sy(x, d, y), actors }.  See docs/ENGINES.md for the fields of bands and items.
import { clamp, lerp, smooth, hash, fbm2, noise2, rng, fract, windX, daylight } from './util.js';
import { species, standIn, castAt, FLYERS } from './species.js';
import { pose, parts, bones, gait, size } from './rig.js';
import { flyParts } from './swimfly.js';
import { PLANTS, flora, plantParts } from './flora.js';

// hills: terrain relief · water: how much of the ground is under shallow water · density: plants · tall: trees
// far: what stands on the horizon · ground: [far colour, near colour] · mult: plant weights on top of the era's flora
export const BIOMES = {
  plain: { hills: 0.35, water: 0, density: 0.5, tall: 0.25, far: 'hills', ground: ['#93a065', '#607a3e'], mult: { fern: 2 } },
  forest: { hills: 0.3, water: 0, density: 1, tall: 1, far: 'forest', ground: ['#5f7a48', '#3c5630'], mult: { conifer: 2, treefern: 1.5, fern: 2, araucaria: 1.5 } },
  swamp: { hills: 0.5, water: 0.45, density: 0.9, tall: 0.5, far: 'forest', ground: ['#5e6c40', '#3a472b'], mult: { horsetail: 4, reed: 3, treefern: 2, fern: 2 } },
  floodplain: { hills: 0.25, water: 0.36, density: 0.6, tall: 0.3, far: 'hills', ground: ['#80925a', '#566f3c'], mult: { reed: 3, horsetail: 2 } },
  desert: { hills: 0.6, water: 0, density: 0.14, tall: 0.06, far: 'mesas', ground: ['#dcbc84', '#b98a52'], mult: { cycad: 1.5, rock: 6, boulder: 2, fern: 0.2, conifer: 0.3, flowers: 0 } },
  coast: { hills: 0.2, water: 0, density: 0.3, tall: 0.15, far: 'sea', ground: ['#e0d0a0', '#b9a66e'], mult: { palm: 3, cycad: 2, rock: 2, fern: 0.6 } },
  badlands: { hills: 0.85, water: 0, density: 0.2, tall: 0.1, far: 'mesas', ground: ['#86695a', '#57423b'], mult: { rock: 8, boulder: 4, deadtree: 1, cycad: 1, fern: 0.3 } },
  polar: { hills: 0.4, water: 0, density: 0.5, tall: 0.6, far: 'mountains', ground: ['#e6eef2', '#b6c6d0'], mult: { conifer: 3, fern: 0.5, cycad: 0, palm: 0, flowers: 0, magnolia: 0 } },
  uplands: { hills: 1, water: 0, density: 0.5, tall: 0.5, far: 'mountains', ground: ['#8c9262', '#5a6840'], mult: { conifer: 1.5, rock: 3 } },
};
const TALL_NICHE = new Set(['brachiosaur', 'camarasaur', 'therizino']);     // plans that browse up in the trees
const STANDS = new Set(['horned', 'plated']);
const BULKY = new Set(['bush', 'cycad', 'boulder', 'log', 'stump', 'bones']);                               // prey that face a predator down

let nextId = 1;
export function createWorld(o = {}) {
  const seed = o.seed ?? 7, R = rng(Math.imul(seed + 3, 2654435761));
  const biome = { ...BIOMES.plain, ...(typeof o.biome === 'string' ? BIOMES[o.biome] : o.biome || {}) };
  const mode = o.mode || 'migrate';
  const entries = normCast(o.cast);
  const U = o.unit || Math.max(4, Math.min(16, 2.2 * Math.max(...entries.filter(e => e.sp).map(e => size(e.sp).tall), 2.5)));
  const d0 = U * 2, dN = d0 * 0.74, dF = d0 * 7;
  const W = { actors: [], cam: { x: 0 }, t: 0, biome, mode, opts: o, lastStage: -9, lastEpoch: -9, viewM: 0, hunt: { phase: 'calm', timer: 4 + R() * 6 }, groups: [], roar: 0, step: 0 };
  const wl = biome.water ? biome.water : 0;                    // water level in noise units
  const amp = biome.hills * U * 0.34;
  const land = (x, d) => {                                      // terrain height in metres (below 0 = under water)
    const n = fbm2(x / (U * 2.6) + seed * 3.1, d / (U * 1.8) + seed, 3);
    const rise = (d - d0) * 0.02 * biome.hills;
    const flat = smooth(d0 * 0.75, d0 * 0.95, d) * (1 - smooth(d0 * 1.5, d0 * 2.2, d)) * 0.5;   // the stage is gentler
    return wl ? (n - wl) * amp * 2.2 * (1 - flat * 0.6) + rise : (n - 0.5) * amp * 2 * (1 - flat) + rise;
  };
  W.land = land;

  // ---- cast
  function normCast(c) {
    if (!c || c === 'era') return [{ era: 1 }];
    return (Array.isArray(c) ? c : [c]).map(e => typeof e === 'string' ? { sp: species(e), n: 1 } : e.era ? e : { ...e, sp: species(e.sp), n: e.n ?? 1 });
  }
  // who should be on stage at this moment of deep time: [{ key, sp, role, young, group }]
  function roster(E, herd) {
    const mult = herd < 0.5 ? lerp(0.4, 1, herd * 2) : lerp(1, 2.2, herd * 2 - 1), out = [];     // the middle gives exactly the scene's numbers
    const put = (g, sp, n, young, role, lane) => {
      if (!sp) return;
      const N = Math.max(1, Math.round(n * (n > 1 ? mult : 1) * (n === 1 && herd > 0.85 && role !== 'pred' ? 2 : 1)));
      const alive = sp.plan === 'bird' ? 1 : E.dinos;
      const keep = Math.round(N * alive + (alive > 0.02 && alive < 1 ? 0.3 : 0));
      for (let i = 0; i < keep; i++) out.push({ key: g + ':' + i, sp, role: role || 'herd', young: 0, group: g, i, lane });
      const Y = Math.round((young || 0) * mult * alive);
      for (let i = 0; i < Y; i++) out.push({ key: g + ':y' + i, sp, role: 'young', young: 1, group: g, i, lane });
    };
    entries.forEach((e, g) => {
      if (e.era) {
        const here = castAt(E.ma, 'walk', 8);
        const meat = here.filter(s => s.diet === 'carnivore' || s.diet === 'fish eater').sort((a, b) => b.len - a.len);
        const veg = here.filter(s => !meat.includes(s)).sort((a, b) => hash(a.len, 3) - hash(b.len, 3));
        const picks = [veg[0], veg[1], meat[0], veg[2]].filter(Boolean).slice(0, e.kinds || 3);
        picks.forEach((sp, i) => put(g * 10 + i, sp, sp.len < 3 ? 4 : sp.len < 9 ? 3 : 2, sp.diet === 'herbivore' ? 1 : 0, meat.includes(sp) ? 'solo' : 'herd'));
      } else put(g, e.lock ? e.sp : standIn(e.sp, E.ma), e.n, e.young, e.role, e.lane);
    });
    return out;
  }
  function spawn(want, instant, hw) {
    const sp = want.sp, G = W.groups[want.group] ||= { dir: R() < 0.5 && mode !== 'migrate' ? -1 : (o.dir ?? 1), anchor: W.cam.x, moving: true, timer: 8 + R() * 10, home: W.cam.x };
    const scale = want.young ? lerp(0.22, 0.5, R()) : lerp(0.88, 1.06, R());
    const a = { id: nextId++, key: want.key, sp, role: want.role, group: want.group, scale, young: want.young ? 1 - (scale - 0.22) / 0.4 : 0,
      i: want.i, x: 0, d: 0, dir: G.dir, phase: R(), run: 0, v: 0, tx: 0, hurry: 0, idle: null, timer: R() * 6, turn: 0,
      headTo: 0, jaw: 0, crouch: 0, rear: 0, wHead: 0, wJaw: 0, wCrouch: 0, wRear: 0, fade: instant ? 1 : 0, leaving: false, steps: 0,
      ox: 0, lane: 0, seed: R() };
    const spread = Math.max(sp.len * 1.3, hw * (mode === 'migrate' ? 0.7 : 0.8));
    a.ox = (R() - 0.5) * 2 * spread * (want.role === 'young' ? 0.6 : want.i ? 1 : 0.25);     // the first of each group stays near the middle
    a.lane = d0 * (want.lane ?? lerp(0.92, mode === 'nest' ? 1.4 : 1.7, R() * R() * (want.i ? 1 : 0.3)));
    if (want.role === 'pred') a.lane = d0 * lerp(1.0, 1.25, R());
    a.d = a.lane;
    a.x = instant ? G.anchor + a.ox : W.cam.x - a.dir * (hw * (a.d / d0) + sp.len * 1.5 + R() * hw * 0.5);
    if (mode === 'hunt' && want.role === 'pred' && instant) a.x = G.anchor - hw * 0.75 - (want.i || 0) * sp.len * 1.1;
    a.tx = a.x;
    W.actors.push(a);
  }
  function reconcile(E, herd, instant, hw) {
    const want = roster(E, herd), have = new Map();
    if (instant) { W.actors.length = 0; W.groups = []; W.hunt = { phase: 'calm', timer: 4 + R() * 5 }; }
    for (const a of W.actors) if (!a.leaving) have.set(a.key, a);
    for (const w of want) { const a = have.get(w.key); if (a && a.sp === w.sp) have.delete(w.key); else spawn(w, instant, hw); }
    for (const a of have.values()) a.leaving = true;                    // wrong species for this time, or one too many
    // young animals follow an adult of their own kind
    for (const a of W.actors) if (a.role === 'young' && (!a.parent || a.parent.leaving)) {
      const ad = W.actors.filter(b => b.group === a.group && b.role !== 'young' && !b.leaving);
      a.parent = ad.length ? ad[Math.floor(a.seed * ad.length)] : null;
      if (a.parent && instant) { a.x = a.parent.x - a.parent.dir * a.parent.sp.len * (0.3 + a.seed * 0.5); a.d = a.lane = a.parent.lane * (0.93 + a.seed * 0.12); }
    }
  }

  // ---- behaviour
  const IDLE = { herbivore: ['graze', 'graze', 'graze', 'look', 'call', 'rest'], carnivore: ['look', 'sniff', 'look', 'call', 'rest', 'sniff'] };
  function pickIdle(a, e) {
    const list = IDLE[a.sp.diet === 'herbivore' ? 'herbivore' : 'carnivore'], r = R();
    a.idle = r < 0.12 * e ? 'call' : list[Math.floor(R() * list.length)];
    if (a.idle === 'rest' && e > 1.2) a.idle = 'look';
    if (a.idle === 'call') W.roar = 1;
  }
  function posture(a, t) {
    let h = 0, j = 0, c = 0, r = 0;
    if (a.v < 0.1 * gait(a.sp, 0, a.scale).vWalk) switch (a.idle) {
      case 'graze': h = TALL_NICHE.has(a.sp.plan) ? 0.7 : -1; j = 0.2 + 0.2 * Math.sin(t * 7 + a.id); break;
      case 'sniff': h = -0.8; break;
      case 'drink': h = -1; break;
      case 'look': h = 0.45; break;
      case 'call': h = 0.75; j = 1; r = a.sp.P.biped ? 0.15 : 0; break;
      case 'rear': r = 1; h = 0.6; break;
      case 'rest': c = 1; h = -0.2; break;
      case 'guard': h = -0.35; j = 0.5 + 0.5 * Math.sin(t * 3 + a.id); break;
      case 'feed': h = -1; j = 0.4 + 0.4 * Math.sin(t * 8); break;
    } else if (a.idle === 'stalk') h = -0.45;
    a.wHead = h; a.wJaw = j; a.wCrouch = c; a.wRear = r;
  }
  function think(dt, e, hw, t) {
    const A = W.actors.filter(a => !a.leaving), by = g => A.filter(a => a.group === g);
    if (mode === 'hunt') huntThink(dt, e, hw, A);
    W.groups.forEach((G, gi) => {
      if (!G) return;
      const mine = by(gi), adults = mine.filter(a => a.role !== 'young');
      if (!adults.length) return;
      if (mode === 'migrate' || mode === 'parade') {
        G.timer -= dt * (0.5 + 0.5 * e);
        if (G.timer <= 0) { G.moving = !G.moving || !!o.nonstop; G.timer = G.moving ? 14 + R() * 16 : 5 + R() * 7; if (!G.moving) for (const a of mine) pickIdle(a, e); }
        const sp = Math.min(...adults.map(a => gait(a.sp, 0, a.scale).vWalk)) * (0.75 + 0.35 * e) * (o.pace ?? 1);
        if (G.moving) G.anchor += G.dir * sp * dt;
        for (const a of adults) { a.tx = G.anchor + a.ox; if (G.moving) a.idle = null; }
      } else if (mode === 'wander' || mode === 'nest' || (mode === 'hunt' && W.hunt.phase === 'calm')) {
        for (const a of adults) {
          if (a.busy) continue;
          a.timer -= dt * (0.4 + 0.6 * e);
          if (a.timer <= 0) {
            if (a.idle && R() < 0.7) { a.idle = null; a.tx = G.home + (R() - 0.5) * 2 * hw * (mode === 'nest' ? 0.45 : 0.85); a.timer = 6 + R() * 8; }
            else { pickIdle(a, e); a.tx = a.x; a.timer = 4 + R() * 8; }
          }
        }
      }
      for (const a of mine) if (a.role === 'young' && a.parent) {
        const p = a.parent, still = p.v < 0.2;
        a.tx = p.x - p.dir * p.sp.len * (0.25 + a.seed * 0.5) + (still ? Math.sin(t * 0.5 * e + a.id) * p.sp.len * 0.7 : 0);
        a.idle = still ? (Math.sin(t * 0.21 + a.id * 2) > 0.55 ? 'rest' : p.idle === 'graze' ? 'graze' : 'look') : null;
        a.lane = p.lane * (0.92 + a.seed * 0.14);
      }
    });
    if (mode === 'nest' && W.nests) for (const a of A) if (a.role === 'young') {       // hatchlings stay by the nest
      const n = W.nests[a.i % W.nests.length]; a.tx = n.x + Math.sin(t * 0.6 + a.id * 1.7) * U * 0.35; a.lane = n.d * (0.95 + 0.1 * a.seed); a.idle = Math.sin(t * 0.3 + a.id) > 0.3 ? 'look' : 'rest';
    }
  }
  function huntThink(dt, e, hw, A) {
    const H = W.hunt, preds = A.filter(a => a.role === 'pred'), prey = A.filter(a => a.role !== 'pred');
    if (!preds.length || !prey.length) { H.phase = 'calm'; return; }
    const cx = l => l.reduce((s, a) => s + a.x, 0) / l.length, px = cx(preds), qx = cx(prey), gap = Math.abs(qx - px), away = Math.sign(qx - px) || 1;
    const big = Math.max(...preds.map(a => a.sp.len)), stands = prey.some(a => STANDS.has(a.sp.niche) && a.role !== 'young');
    H.timer -= dt * (0.4 + 0.6 * e);
    const all = (l, fn) => l.forEach(fn);
    if (H.phase === 'calm' && H.timer <= 0) { H.phase = 'stalk'; H.timer = 14; }
    else if (H.phase === 'stalk') {
      all(preds, (a, i) => { a.busy = 1; a.idle = 'stalk'; a.tx = qx - away * big * (1.2 + i * 0.5); a.hurry = 0; });
      if (gap < big * 2.6 || H.timer <= 0) { H.phase = stands ? 'standoff' : 'charge'; H.timer = stands ? 9 : 7 + 4 * e; W.roar = 1; }
    } else if (H.phase === 'charge') {
      all(preds, (a, i) => { a.idle = null; a.tx = qx + away * big * (i * 0.6 - 0.3); a.hurry = 0.85 + 0.15 * e; });
      all(prey, a => { a.busy = 1; a.idle = null; a.tx = a.x + away * hw * 3; a.hurry = a.role === 'young' ? 1 : 0.9; });
      if (H.timer <= 0) { H.phase = 'tired'; H.timer = 7; }
    } else if (H.phase === 'standoff') {
      all(prey, (a, i) => { a.busy = 1; a.tx = a.x; a.dir = -away; a.idle = a.role === 'young' ? 'rest' : 'guard'; if (a.role === 'young' && a.parent) a.tx = a.parent.x + away * a.parent.sp.len * 0.4; });
      all(preds, (a, i) => { a.tx = qx - away * (big * 1.4 + (0.5 + 0.5 * Math.sin(H.timer * 0.9 + i)) * big * 1.2 + i * big * 0.6); a.hurry = 0.25; a.idle = H.timer % 3 < 1.2 ? 'call' : 'look';
        if (Math.sign(a.tx - a.x) !== away || Math.abs(a.tx - a.x) < a.sp.len * 0.4) { a.tx = a.x; if (!a.turn) a.dir = away; } });     // never turn its back on the horns
      if (H.timer <= 0) { H.phase = 'tired'; H.timer = 6; }
    } else if (H.phase === 'tired') {
      all(preds, a => { a.tx = a.x; a.hurry = 0; a.idle = 'call'; });
      all(prey, a => { a.hurry = Math.min(a.hurry, 0.3); });
      if (H.timer <= 0) { H.phase = 'calm'; H.timer = 10 + R() * 12; all(A, a => { a.busy = 0; a.hurry = 0; a.timer = R() * 3; });
        const g = W.groups[prey[0].group]; if (g) g.home = qx; const pg = W.groups[preds[0].group]; if (pg) pg.home = px; }
    }
  }
  function move(a, dt, t, hw) {
    const G = gait(a.sp, 0, a.scale), dead = a.sp.len * a.scale * 0.12;
    if (a.leaving) { a.tx = a.x + a.dir * 99; a.hurry = Math.max(a.hurry, 0.35); a.idle = null; }
    const dx = a.tx - a.x, far = Math.abs(dx);
    let want = far < dead ? 0 : clamp(far * 0.5, G.vWalk * 0.5, lerp(G.vWalk * (a.role === 'young' ? 1.5 : 1), G.top, clamp(a.hurry + (a.role === 'young' ? smooth(a.sp.len, a.sp.len * 3, far) * 0.6 : 0))));
    if (want > 0 && Math.sign(dx) !== a.dir && !a.turn) { if (far > dead * 2.5) a.turn = 0.001; want = 0; }
    if (a.turn) { want = 0; const was = a.turn; a.turn += dt * 2.2; if (was < 0.5 && a.turn >= 0.5) a.dir = -a.dir; if (a.turn >= 1) a.turn = 0; }
    a.v += (want - a.v) * Math.min(1, dt * (want > a.v ? 1.6 : 3));
    a.run = clamp((a.v - G.vWalk) / (G.top - G.vWalk));
    const before = Math.floor(a.phase * 2);
    a.phase += a.v * dt / gait(a.sp, a.run, a.scale).stride;
    if (Math.floor(a.phase * 2) !== before) a.steps++;
    a.x += a.dir * a.v * dt;
    a.d += (a.lane - a.d) * Math.min(1, dt * 0.4);
    posture(a, t);
    const k = Math.min(1, dt * 3);
    a.headTo += (a.wHead - a.headTo) * k; a.jaw += (a.wJaw - a.jaw) * Math.min(1, dt * 8); a.crouch += (a.wCrouch - a.crouch) * Math.min(1, dt * 1.5); a.rear += (a.wRear - a.rear) * Math.min(1, dt * 2);
    const off = Math.abs(a.x - W.cam.x) > hw * (a.d / d0) + a.sp.len * 2;
    a.fade = clamp(a.fade + dt * (a.leaving && off ? -2 : 2));
    return !(a.leaving && off && a.fade <= 0);
  }

  // ---- one frame
  W.frame = f => {
    const { w, h, p } = f, E = f.era, dt = Math.min(0.25, f.dt || 0), e = 0.4 + 1.2 * clamp(p.activity);
    W.t = f.t;
    const zoom = Math.pow(2, (p.scale - 0.5) * 2);
    const jump = Math.abs(f.stage - W.lastStage) > 0.03 || f.epoch !== W.lastEpoch || W.lastStage < -1 || Math.abs((W.lastHerd ?? p.herd) - p.herd) > 0.2;
    // frame the cast: tall enough for the tallest, wide enough for the longest
    const fitOf = () => { let tall = 1, long = 1.2; for (const a of W.actors) if (!a.leaving) { const s = size(a.sp); tall = Math.max(tall, s.tall * a.scale); long = Math.max(long, a.sp.len * a.scale); }
      return Math.max(tall * 2.15, long * (h / w) / 0.62, 1.6) * (o.frame ?? 1); };
    if (jump) {       // rebuild the cast first (spread over a view guessed from the unit), then frame what is there
      reconcile(E, p.herd, true, w / h * (W.viewM || U * 1.2) / zoom / 2);
      if (W.lastStage < -1) W.cam.x = 0;
      W.viewM = fitOf();
    } else { const fit = fitOf(); W.viewM += (fit - W.viewM) * Math.min(1, dt * 0.5); }
    const viewM = W.viewM / zoom, k0 = h / viewM;
    const horizon = h * (o.horizon ?? 0.56), foot = h * (o.foot ?? 0.85), ch = (foot - horizon) / k0;
    const kd = d => k0 * d0 / d, hw = w / 2 / k0;
    if (!jump && fract(f.t * 0.7) < dt * 0.7 + 0.02) reconcile(E, p.herd, false, hw);
    W.lastStage = f.stage; W.lastEpoch = f.epoch; W.lastHerd = p.herd;
    if (mode === 'nest' && !W.nests) { W.nests = []; const n = o.nests || 3; for (let i = 0; i < n; i++) W.nests.push({ x: (i - (n - 1) / 2) * U * 1.5 + (R() - 0.5) * U * 0.4, d: d0 * (1.05 + 0.25 * (i % 2) + R() * 0.1), seed: i + 1 }); }
    // clicks: the nearest animal calls, the rest look up
    for (const c of f.pointer?.clicks || []) { let best = null, bd = 1e9; for (const a of W.actors) { const sx = w / 2 + (a.x - W.cam.x) * kd(a.d), dd = Math.abs(sx - c.x * w); if (dd < bd) { bd = dd; best = a; } }
      for (const a of W.actors) if (a.v < 0.3) { a.idle = a === best ? 'call' : 'look'; a.timer = 3; } if (best) { best.idle = 'call'; best.timer = Math.max(best.timer, 2.5); W.roar = 1; } }
    if (dt > 0) {
      think(dt, e, hw, f.t);
      // the impact: everything looks up, then runs
      if (E.meteor > 0.3) for (const a of W.actors) if (E.meteor < 1) { a.idle = 'look'; a.tx = a.x; a.busy = 1; } else { a.hurry = 1; a.tx = a.x + a.dir * 50; a.idle = null; }
      W.actors = W.actors.filter(a => move(a, dt, f.t, hw));
    }
    // camera
    const live = W.actors.filter(a => !a.leaving && a.role !== 'young');
    let focus = W.cam.x;
    if (o.cam === 'still' || ((mode === 'wander' || mode === 'nest') && o.cam !== 'follow')) { const home = (W.groups.find(Boolean)?.home ?? 0) + (o.pan || 0) * f.t;
      focus = live.length && !o.pan ? home + clamp((live.reduce((s, a) => s + a.x, 0) / live.length - home) * 0.7, -hw * 0.6, hw * 0.6) : home; }
    else if (mode === 'hunt' && live.length) { const pr = live.filter(a => a.role === 'pred'), py = live.filter(a => a.role !== 'pred'), m = l => l.reduce((s, a) => s + a.x, 0) / (l.length || 1);
      focus = pr.length && py.length ? (m(pr) + m(py)) / 2 : m(live); }
    else if (live.length) { const G = W.groups[live[0].group]; focus = (G?.anchor ?? live[0].x) + (G?.dir ?? 1) * hw * 0.12; }
    if (o.pan && (mode === 'wander' || mode === 'nest')) for (const G of W.groups) if (G) G.home = focus;
    W.cam.x = jump ? focus : W.cam.x + (focus - W.cam.x) * Math.min(1, dt * 1.4);
    const camX = W.cam.x - (f.pointer?.dragX || 0) * viewM;
    const sx = (x, d) => w / 2 + (x - camX) * kd(d), sy = (x, d, y = 0) => horizon + (ch - y) * kd(d);

    // ---- ground bands, far → near
    const nB = Math.round(6 + p.detail * 6), bands = [], cols = 36;
    for (let i = 0; i < nB; i++) {
      const d = dF * Math.pow(dN / dF, i / (nB - 1)), pts = [], wet = []; let anyWet = false;
      for (let c = -1; c <= cols + 1; c++) { const px = c / cols * w, x = camX + (px - w / 2) / kd(d), y = land(x, d), under = wl > 0 && y < 0; wet.push(under); anyWet ||= under; pts.push([px, horizon + (ch - (under ? 0 : y)) * kd(d)]); }
      bands.push({ d, u: i / (nB - 1), pts, wet, anyWet, level: horizon + ch * kd(d), items: [] });
    }
    bands.forEach((b, i) => { b.next = bands[i + 1] ? bands[i + 1].level : h + 2; });

    // ---- plants and props
    const items = [], light = clamp(p.light) * (1 - 0.75 * E.dark), fw = flora(E), wxs = windX(p.wind);
    for (const k in biome.mult) if (k in fw) fw[k] *= biome.mult[k]; else fw[k] = biome.mult[k] * 0.3;
    const lowK = Object.keys(fw).filter(k => PLANTS[k]?.low && fw[k] > 0), tallK = Object.keys(fw).filter(k => PLANTS[k] && !PLANTS[k].low && fw[k] > 0);
    const pickK = (keys, r) => { let s = 0; for (const k of keys) s += fw[k]; let t = r * s; for (const k of keys) { t -= fw[k]; if (t <= 0) return k; } return keys[0]; };
    const rows = Math.round(8 + p.detail * 9), thin = clamp(U * 1.4 / viewM, 0.15, 1);
    for (let r = 0; r < rows; r++) {
      const d = dN * 0.97 * Math.pow(dF * 0.8 / dN, (r + 0.5) / rows), cs = U * 0.5 * Math.sqrt(d / d0) / Math.sqrt(thin), span = w / 2 / kd(d) + cs * 2;
      const c0 = Math.floor((camX - span) / cs), c1 = Math.ceil((camX + span) / cs);
      if (c1 - c0 > 90) continue;
      for (let c = c0; c <= c1; c++) {
        const h1 = hash(c, r * 7.3, seed);
        if (h1 > biome.density * (0.35 + 0.65 * p.detail) * (1 - 0.5 * E.dark)) continue;
        const x = (c + hash(c, r, seed + 1)) * cs, dd = d * (0.94 + 0.12 * hash(c, r, seed + 2)), y = land(x, dd);
        if (dd < d0 * 0.86 && Math.abs(sx(x, dd) - w / 2) < w * 0.16 && hash(c, r, seed + 5) < 0.6) continue;   // keep the middle of the foreground open
        let kind;
        if (wl && y < 0) { if (y < -U * 0.05 || !fw.reed && !fw.horsetail) continue; kind = fw.reed ? 'reed' : 'horsetail'; }
        else kind = dd > d0 * 1.4 && tallK.length && hash(c, r, seed + 3) < biome.tall ? pickK(tallK, hash(c, r, seed + 4)) : lowK.length ? pickK(lowK, hash(c, r, seed + 4)) : null;
        if (!kind || (dd < d0 * 0.95 && BULKY.has(kind))) continue;      // nothing bulky in front of the animals
        const sd = (c * 7919 + r * 104729 + seed) | 0, sway = wxs * (0.35 + 0.65 * Math.sin(f.t * 1.3 + x * 0.21 + r));
        items.push({ type: 'plant', kind, seed: sd, wx: x, d: dd, x: sx(x, dd), y: sy(x, dd, wl ? Math.max(y, 0) : y), k: kd(dd), sway, fog: fogOf(dd),
          get parts() { return this._p ||= plantParts(kind, sd, sway); } });
      }
    }
    if (W.nests) for (const n of W.nests) items.push({ type: 'plant', kind: 'nest', seed: n.seed, wx: n.x, d: n.d, x: sx(n.x, n.d), y: sy(n.x, n.d, wl ? Math.max(0, land(n.x, n.d)) : land(n.x, n.d)), k: kd(n.d) * Math.max(1, U / 8), sway: 0, fog: fogOf(n.d),
      get parts() { return this._p ||= plantParts('nest', n.seed, 0); } });
    function fogOf(d) { return clamp((d - d0) / (dF - d0)) * 0.75; }

    // ---- animals
    let lead = null;
    for (const a of W.actors) {
      const X = sx(a.x, a.d), k = kd(a.d), reach = a.sp.len * a.scale * k;
      if (X < -reach * 1.2 || X > w + reach * 1.2) continue;
      const base = land(a.x, a.d), deep = -a.sp.P.hipH * a.sp.len * a.scale * 0.55;
      const gy = wl ? dx => Math.max(deep, land(a.x + a.dir * dx, a.d)) : dx => land(a.x + a.dir * dx, a.d);
      const flip = a.turn ? Math.cos(Math.PI * a.turn) * (a.turn < 0.5 ? 1 : -1) : 1;
      const it = { type: 'dino', actor: a, sp: a.sp, d: a.d, x: X, y: sy(a.x, a.d, 0), k, dir: a.dir * (Math.abs(flip) < 0.12 ? 0.12 * Math.sign(flip || 1) : flip), fade: a.fade, fog: fogOf(a.d),
        wade: wl && base < 0 ? -base : 0, waterY: sy(a.x, a.d, 0), state: a.idle || (a.v > 0.1 ? (a.run > 0.3 ? 'run' : 'walk') : 'stand'), young: a.role === 'young',
        get pose() { return this._q ||= pose(a.sp, { phase: a.phase, run: a.run, headTo: a.headTo, jaw: a.jaw, crouch: a.crouch, rear: a.rear, t: f.t + a.id, gy, scale: a.scale, young: a.young }); },
        get parts() { return this._p ||= parts(this.pose); }, get bones() { return this._b ||= bones(this.pose); } };
      it.T = { x: it.x, y: it.y, k: it.k, dir: it.dir };
      items.push(it);
      if (!a.leaving && a.role !== 'young' && (!lead || a.sp.len * a.scale / a.d > lead.sp.len * lead.scale / lead.d)) lead = a;
    }
    items.sort((a, b) => b.d - a.d);
    // hang each item on the band it stands in front of
    for (const it of items) { let bi = 0; while (bi + 1 < bands.length && bands[bi + 1].d >= it.d) bi++; bands[bi].items.push(it); }

    // ---- sky: sun, pterosaurs, the meteor
    const dl = daylight(p.light), sunA = lerp(-0.25, 1.15, clamp(p.light));
    const sun = { x: w * (0.2 + 0.25 * clamp(p.light)), y: horizon - h * 0.5 * Math.sin(Math.max(0, sunA) * 1.1) + (p.light < 0.2 ? 0 : 0), r: h * 0.035, night: dl.night, dusk: dl.dusk };
    if (dl.night > 0.6) { sun.moon = true; sun.x = w * 0.72; sun.y = h * 0.16; }
    const flyers = [], nf = Math.round((o.flyers ?? (biome.far === 'sea' ? 3 : 1)) * (0.5 + p.herd) * (E.ma > 66 || E.ma < 64.5 ? 1 : 0) * (E.ma > 228 ? 0 : 1) * (1 - E.dark));
    for (let i = 0; i < nf; i++) {
      const pick = FLYERS[Math.floor(hash(i, seed, 9) * FLYERS.length)], sp = standIn(pick, E.ma); if (!sp) continue;
      const dep = 2 + hash(i, seed, 4) * 5, k = k0 / dep * Math.min(1, 4 / Math.sqrt(sp.span)) * (0.6 + 0.6 * U / 8), dir = hash(i, seed, 5) < 0.5 ? -1 : 1, sp1 = (8 + 6 * hash(i, 2, seed)) * e;
      const lap = w + sp.span * k * 4, x0 = fract((f.t * sp1 * k * dir + hash(i, 7, seed) * 5000 - (camX * k0 / dep)) / lap);
      const x = x0 * lap - sp.span * k * 2, y = horizon * (0.12 + 0.6 * hash(i, 3, seed)) + Math.sin(f.t * 0.4 + i * 2) * h * 0.02;
      const glide = 0.5 + 0.5 * Math.sin(f.t * 0.23 + i * 3.1), ti = f.t + i * 7;
      flyers.push({ type: 'flyer', sp, x, y, k, dir, fog: clamp(dep / 9), T: { x, y, k, dir }, get parts() { return this._p ||= flyParts(sp, { t: ti, glide, yaw: 0.25, pitch: 0.55 }); } });
    }
    let meteor = null;
    if (E.meteor > 0) { const m = Math.min(1, E.meteor), x = lerp(w * 0.08, w * 0.74, m), y = lerp(-h * 0.05, horizon, m * m);
      meteor = { x, y, r: h * lerp(0.008, 0.03, m), ang: Math.atan2(horizon + h * 0.05, w * 0.66), len: h * lerp(0.25, 0.7, m), hit: E.meteor >= 1, glowX: w * 0.74 }; }

    // ---- what stands on the horizon
    let farBottom = horizon + 2; for (const q of bands[0].pts) farBottom = Math.max(farBottom, q[1] + 2);     // down to the first ground band: no gap
    const far = [], ridge = (kind, par, amp2, base, tone, fr) => {
      const pts = []; for (let c = -1; c <= 49; c++) { const px = c / 48 * w, u = px / h * fr + camX / U * par + seed * 5.7 + tone * 31;
        let n = fbm2(u, tone * 9.1, 4);
        if (kind === 'mountains') n = 1 - Math.abs(2 * n - 1) * 1.6 + 0.3 * noise2(u * 6, 2); else if (kind === 'mesas') n = Math.round(n * 3.2) / 3.2 * 0.8 + 0.08 * noise2(u * 9, 1);
        else if (kind === 'forest') n = 0.45 + 0.35 * n + 0.1 * Math.abs(Math.sin(u * 37 + tone)) + 0.05 * Math.abs(Math.sin(u * 91));
        pts.push([px, horizon - h * (base + amp2 * clamp(n))]); }
      far.push({ kind, pts, tone, bottom: farBottom });
    };
    if (biome.far === 'mountains') { ridge('mountains', 0.02, 0.26, 0.02, 0, 1.3); ridge('hills', 0.05, 0.1, 0, 1, 2.2); }
    else if (biome.far === 'mesas') { ridge('mesas', 0.02, 0.2, 0.01, 0, 1.2); ridge('mesas', 0.05, 0.1, 0, 1, 2.5); }
    else if (biome.far === 'forest') { ridge('hills', 0.02, 0.14, 0.01, 0, 1.4); ridge('forest', 0.06, 0.12, 0, 1, 3); }
    else if (biome.far === 'hills') { ridge('hills', 0.02, 0.16, 0.01, 0, 1.3); ridge('hills', 0.05, 0.08, 0, 1, 2.6); }
    const sea = biome.far === 'sea' ? { y0: horizon - h * 0.045, y1: bands[0].level + h * 0.01 } : null;

    // signals for the host (Invisible Hands outputs)
    if (f.sig) {
      if (lead) { if (lead.steps !== W.leadSteps || lead.id !== W.leadId) { if (lead.id === W.leadId && lead.v > 0.1) f.sig.step = clamp(0.35 + lead.sp.len / 20); W.leadSteps = lead.steps; W.leadId = lead.id; }
        f.sig.speed = clamp(lead.v / gait(lead.sp, 0, lead.scale).top); }
      if (W.roar) f.sig.roar = 1;
      f.sig.count = clamp(items.filter(i => i.type === 'dino').length / 16);
    }
    W.roar = 0;
    return W.view = { w, h, horizon, k0, d0, viewM, camX, sx, sy, layers: bands, far, sea, flyers, sun, meteor, flash: E.flash, dark: E.dark, light, day: dl,
      biome, actors: W.actors, items, lead, wind: wxs, hunt: mode === 'hunt' ? W.hunt.phase : null };
  };
  return W;
}
