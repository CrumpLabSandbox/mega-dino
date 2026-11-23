// Mesozoic plants and ground props, in the same part format as the animals (rig.js), so any styler can draw them.
//   plantParts(kind, seed, sway) → parts in metres, origin at the base, y up
// tones: trunk, leaf, leaf2, flower, rock, egg, bone. There is no grass: it had not evolved yet.
import { rng, lerp } from './util.js';

const PI = Math.PI;
// typical height in metres, and whether it is low enough to stand in front of the animals
export const PLANTS = {
  fern: { h: 0.9, low: 1 }, horsetail: { h: 1.8, low: 1 }, bush: { h: 1.4, low: 1 }, cycad: { h: 2.4, low: 1 }, reed: { h: 1.6, low: 1 },
  flowers: { h: 0.5, low: 1 }, treefern: { h: 6 }, ginkgo: { h: 13 }, conifer: { h: 20 }, araucaria: { h: 28 }, redwood: { h: 45 },
  magnolia: { h: 8 }, palm: { h: 9 }, deadtree: { h: 12 }, stump: { h: 1.2, low: 1 },
  rock: { h: 1, low: 1 }, boulder: { h: 2.6, low: 1 }, log: { h: 0.7, low: 1 }, bones: { h: 1.2, low: 1 }, nest: { h: 0.5, low: 1 },
};
// which plants grow when: weights by era (f.era), for engines that scatter their own plants
export function flora(E) {
  const burnt = E.dark + (1 - E.dinos) * (1 - E.ferns) * 0.5, fl = E.flowers;
  return { fern: 1 + E.ferns * 4, horsetail: 0.5 * (1 - E.dry), cycad: 0.8 * (1 - fl * 0.6), bush: 0.3 + fl * 0.6, treefern: 0.5 * (1 - E.dry) * (1 - burnt),
    ginkgo: 0.35 * (1 - burnt), conifer: 1 * (1 - burnt), araucaria: 0.6 * (1 - fl * 0.5) * (1 - burnt), magnolia: fl * 0.7 * (1 - burnt), palm: fl * 0.5 * (1 - burnt),
    flowers: fl * 0.8 * (1 - burnt), deadtree: burnt * 2.5, stump: burnt, rock: 0.25 };
}

// a leaf or frond: a curved blade from (x, y) at angle a (0 = straight up, + leans right), bending by droop
function frond(x, y, a, len, wid, droop, n = 5) {
  const L = [], R = [];
  let px = x, py = y, ang = a;
  for (let i = 0; i <= n; i++) {
    const u = i / n, w = wid * Math.sin(PI * (0.08 + 0.92 * u)) * (1 - u * 0.35);
    L.push([px - Math.cos(ang) * w, py - Math.sin(ang) * w]); R.push([px + Math.cos(ang) * w, py + Math.sin(ang) * w]);
    ang += droop / n; px += Math.sin(ang) * len / n; py += Math.cos(ang) * len / n;
  }
  return L.concat([[px, py]], R.reverse());
}
const trunk = (x0, x1, h, w0, w1) => [[x0 - w0, 0], [x1 - w1, h], [x1 + w1, h], [x0 + w0, 0]];

export function plantParts(kind, seed = 1, sway = 0, size = 1) {
  const R = rng(Math.imul(seed | 0, 2654435761) ^ 0x51ed), out = [], P = PLANTS[kind] || PLANTS.fern, h = P.h * size * (0.75 + R() * 0.5);
  const add = (t, p, s) => out.push(s ? { k: 'plant', t, p, s: 1 } : { k: 'plant', t, p });
  const sw = u => sway * h * 0.05 * u * u;       // sideways lean at height fraction u
  const crown = (cx, cy, n, len, wid, spread, droop, tone) => {
    for (let i = 0; i < n; i++) { const u = n > 1 ? i / (n - 1) : 0.5, a = (u - 0.5) * 2 * spread + (R() - 0.5) * 0.2;
      add(i % 2 ? tone : tone === 'leaf' ? 'leaf2' : tone, frond(cx, cy, a + sway * 0.12, len * (0.75 + R() * 0.4), wid, Math.sign(a || 1) * droop * (0.6 + Math.abs(a)), 5), 1); }
  };
  switch (kind) {
    case 'fern': crown(0, 0, 7, h * 1.1, h * 0.12, 1.25, 0.9, 'leaf'); break;
    case 'flowers': for (let i = 0; i < 5; i++) { const x = (R() - 0.5) * h * 2, hh = h * (0.5 + R() * 0.6); out.push({ k: 'plant', t: 'leaf', l: [[x, 0], [x + sw(1) * 2, hh]], w: h * 0.05 }, { k: 'plant', t: 'flower', c: [x + sw(1) * 2, hh, h * 0.13] }); } break;
    case 'reed': case 'horsetail': for (let i = 0; i < (kind === 'reed' ? 7 : 4); i++) { const x = (R() - 0.5) * h * 0.6, hh = h * (0.6 + R() * 0.5), lean = (R() - 0.5) * 0.2;
        out.push({ k: 'plant', t: i % 2 ? 'leaf' : 'leaf2', l: [[x, 0], [x + hh * lean * 0.5 + sw(0.5), hh * 0.5], [x + hh * lean + sw(1) * 2, hh]], w: h * 0.035 });
        if (kind === 'horsetail') for (let j = 1; j < 6; j++) { const y = hh * j / 6, xx = x + hh * lean * j / 6, w = hh * 0.1 * (1 - j / 8); out.push({ k: 'plant', t: 'leaf', l: [[xx - w, y + w * 0.5], [xx, y], [xx + w, y + w * 0.5]], w: h * 0.018 }); } } break;
    case 'bush': for (let i = 0; i < 5; i++) out.push({ k: 'plant', t: i % 2 ? 'leaf' : 'leaf2', c: [(R() - 0.5) * h * 1.1 + sw(0.6), h * (0.3 + R() * 0.4), h * (0.3 + R() * 0.15)] }); break;
    case 'cycad': add('trunk', trunk(0, sw(0.4), h * 0.4, h * 0.11, h * 0.1), 0); crown(sw(0.4), h * 0.38, 9, h * 0.75, h * 0.06, 1.45, 1.0, 'leaf'); break;
    case 'treefern': add('trunk', trunk(0, sw(0.8), h * 0.8, h * 0.035, h * 0.025), 0); crown(sw(0.8), h * 0.8, 9, h * 0.38, h * 0.035, 1.5, 1.3, 'leaf'); break;
    case 'palm': { const lean = (R() - 0.5) * h * 0.25; add('trunk', trunk(0, lean + sw(0.9), h * 0.9, h * 0.03, h * 0.02), 0); crown(lean + sw(0.9), h * 0.9, 9, h * 0.33, h * 0.03, 1.7, 1.5, 'leaf'); } break;
    case 'conifer': case 'redwood': { const bare = kind === 'redwood' ? 0.45 : 0.18, tw = h * (kind === 'redwood' ? 0.035 : 0.028);
      add('trunk', trunk(0, sw(1), h, tw, tw * 0.25), 0);
      const tiers = kind === 'redwood' ? 9 : 7;
      for (let i = 0; i < tiers; i++) { const u = i / tiers, y = h * lerp(bare, 0.96, u), w = h * 0.2 * (1 - u * 0.85) * (kind === 'redwood' ? 0.7 : 1) * (0.85 + R() * 0.3), th = h * (1 - bare) / tiers * 1.7, x = sw(lerp(bare, 1, u));
        add(i % 2 ? 'leaf' : 'leaf2', [[x - w, y - th * 0.15], [x - w * 0.35, y + th * 0.45], [x, y + th], [x + w * 0.35, y + th * 0.45], [x + w, y - th * 0.15], [x, y + th * 0.1]], 0); } } break;
    case 'araucaria': { add('trunk', trunk(0, sw(1), h, h * 0.022, h * 0.01), 0);
      for (let i = 0; i < 9; i++) { const u = i / 9, y = h * lerp(0.6, 0.97, u), side = i % 2 ? 1 : -1, w = h * 0.2 * (1 - u * 0.7), x = sw(lerp(0.6, 1, u));
        out.push({ k: 'plant', t: 'trunk', l: [[x, y], [x + side * w * 0.6, y + w * 0.1], [x + side * w, y + w * 0.4]], w: h * 0.008 });
        out.push({ k: 'plant', t: i % 3 ? 'leaf' : 'leaf2', c: [x + side * w, y + w * 0.42, h * 0.05 * (1 - u * 0.4)] }, { k: 'plant', t: 'leaf2', c: [x + side * w * 0.55, y + w * 0.2, h * 0.035] }); }
      out.push({ k: 'plant', t: 'leaf', c: [sw(1), h, h * 0.06] }); } break;
    case 'ginkgo': case 'magnolia': { const tw = h * 0.035; add('trunk', trunk(0, sw(0.5), h * 0.5, tw, tw * 0.6), 0);
      for (let i = 0; i < 7; i++) { const a = R() * 6.28, d = R() * h * 0.2; out.push({ k: 'plant', t: i % 2 ? 'leaf' : 'leaf2', c: [Math.cos(a) * d * 1.2 + sw(0.7), h * 0.68 + Math.sin(a) * d, h * (0.17 + R() * 0.08)] }); }
      if (kind === 'magnolia') for (let i = 0; i < 9; i++) { const a = R() * 6.28, d = R() * h * 0.32; out.push({ k: 'plant', t: 'flower', c: [Math.cos(a) * d + sw(0.7), h * 0.68 + Math.sin(a) * d * 0.8, h * 0.03] }); } } break;
    case 'deadtree': { add('trunk', trunk(0, h * 0.03, h * 0.8, h * 0.03, h * 0.008), 0);
      for (let i = 0; i < 5; i++) { const y = h * (0.35 + i * 0.1), s = i % 2 ? 1 : -1, l = h * (0.25 - i * 0.03); out.push({ k: 'plant', t: 'trunk', l: [[h * 0.02, y], [s * l * 0.6, y + l * 0.3], [s * l, y + l * 0.9]], w: h * 0.012 }); } } break;
    case 'stump': add('trunk', [[-h * 0.35, 0], [-h * 0.28, h * 0.8], [-h * 0.05, h], [h * 0.1, h * 0.75], [h * 0.3, h * 0.85], [h * 0.36, 0]], 0); break;
    case 'rock': case 'boulder': { const n = 7, p = []; for (let i = 0; i <= n; i++) { const a = PI * (1 - i / n); p.push([Math.cos(a) * h * (0.75 + R() * 0.35), Math.sin(a) * h * (0.6 + R() * 0.45)]); } add('rock', p, 0);
      add('rock2', [p[1], p[2], p[3], [p[3][0] * 0.6, p[3][1] * 0.5], [p[1][0] * 0.8, p[1][1] * 0.4]], 0); } break;
    case 'log': add('trunk', [[-h * 2, 0], [-h * 2, h * 0.9], [h * 2, h], [h * 2.1, 0]], 1); out.push({ k: 'plant', t: 'leaf2', c: [h * 2.05, h * 0.5, h * 0.48] }); break;
    case 'bones': for (let i = 0; i < 6; i++) { const x = (i - 2.5) * h * 0.3; out.push({ k: 'plant', t: 'bone', l: [[x, 0], [x - h * 0.12, h * 0.6], [x + h * 0.1, h * (0.95 - Math.abs(i - 2.5) * 0.1)]], w: h * 0.06 }); }
      out.push({ k: 'plant', t: 'bone', l: [[-h * 1.2, h * 0.12], [h * 1.3, h * 0.1]], w: h * 0.09 }); break;
    case 'nest': add('rock', [[-h * 1.6, 0], [-h * 1.2, h * 0.7], [-h * 0.5, h * 0.45], [h * 0.5, h * 0.45], [h * 1.2, h * 0.7], [h * 1.6, 0]], 1);
      for (let i = 0; i < 5; i++) out.push({ k: 'plant', t: 'egg', c: [(i - 2) * h * 0.42, h * (0.62 + (i % 2) * 0.1), h * 0.26] }); break;
  }
  return out;
}
// default plant colours for a time of day and era (burnt after the impact)
export function plantPalette(light = 1, E = null, fog = 0) {
  const k = 0.35 + 0.65 * light, burnt = E ? Math.min(1, E.dark * 1.2) : 0;
  const c = (r, g, b) => { const m = (v, grey) => Math.round(lerp(lerp(v, grey, burnt * 0.8) * k, 170, fog)); return `rgb(${m(r, 60)},${m(g, 55)},${m(b, 50)})`; };
  return { trunk: c(92, 70, 48), leaf: c(52, 104, 52), leaf2: c(74, 128, 60), flower: c(236, 196, 214), rock: c(128, 124, 116), rock2: c(158, 154, 144), egg: c(232, 224, 200), bone: c(232, 226, 204) };
}
