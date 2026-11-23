// Every engine, in gallery order. A scene = engine + presets; see docs/ENGINES.md.
const ENGINE_FILES = [
  'walk', 'family', 'skeleton', 'dino3d', 'topdown', 'flyers', 'sea', 'guide', 'fossil', 'earth', 'lowpoly', 'voxel',
  'pixel', 'arcade', 'cartoon', 'toybox', 'woodblock', 'papercut', 'silhouette', 'poster', 'painterly', 'sketch', 'ascii', 'synth'
];

// The standard controls every scene has (0..1). Engines add x1..x4.
// `wind` and `light` mean the same as in Mega-Clouds and Mega-Volcano, so those layers can follow them.
export const CONTROLS = [
  { id: 'speed', label: 'Speed', value: 0.5, tip: '0 freezes time; the middle is real time; the top is a 16× time-lapse' },
  { id: 'stage', label: 'Era', value: 0.855, tip: 'When in deep time: Triassic → Jurassic → Cretaceous → the impact → after. The animals and plants change with it' },
  { id: 'grow', label: 'Time travel', value: 0, tip: '0 stays in one era; higher runs the whole age of dinosaurs on a loop, from 10 minutes down to 20 seconds' },
  { id: 'activity', label: 'Activity', value: 0.5, tip: 'How lively the animals are: slow and sleepy → restless, calling and running' },
  { id: 'herd', label: 'Herd', value: 0.5, tip: 'How many animals: a few → a crowd' },
  { id: 'scale', label: 'Size', value: 0.5, tip: 'How close the view is' },
  { id: 'detail', label: 'Detail', value: 0.6, tip: 'Plants and fine structure (heavier to draw)' },
  { id: 'wind', label: 'Wind dir', value: 0.5, tip: 'Which way the wind blows: middle blows right, the ends blow left' },
  { id: 'light', label: 'Light', value: 0.8, tip: 'Time of day: night → golden hour → noon' },
];
export const LOOK = [
  { id: 'hue', label: 'Hue', value: 0 },
  { id: 'saturation', label: 'Saturation', value: 0.5 },
  { id: 'brightness', label: 'Brightness', value: 0.5 },
  { id: 'contrast', label: 'Contrast', value: 0.5 },
  { id: 'vignette', label: 'Vignette', value: 0 },
  { id: 'grain', label: 'Grain', value: 0 },
];

// Time travel control → loops through deep time per second of scene time (0 holds the era)
export const growRate = g => g < 0.02 ? 0 : 1 / (20 * Math.pow(30, 1 - g));

// all params for a scene: standard defaults < engine extras < scene presets
export function defaultsFor(engine, scene) {
  const p = {};
  for (const c of CONTROLS) p[c.id] = c.value;
  for (const k of ['x1', 'x2', 'x3', 'x4']) p[k] = 0.5;
  for (const x of engine.params || []) p[x.id] = x.value ?? 0.5;
  for (const c of LOOK) p[c.id] = c.value;
  Object.assign(p, scene.params || {});
  return p;
}

export async function loadAll(only) {
  const files = only ? ENGINE_FILES.filter(f => only.includes(f)) : ENGINE_FILES;
  const mods = await Promise.all(files.map(f => import(`./engines/${f}.js`).then(m => m, err => { console.error(`engine ${f}:`, err); return null; })));
  const engines = [], scenes = [];
  mods.forEach(m => {
    if (!m) return;
    const e = m.default; engines.push(e);
    for (const s of m.scenes || []) scenes.push({ ...s, engine: e, tags: s.tags || [] });
  });
  return { engines, scenes };
}
