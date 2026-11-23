// Dinosaur Walk: the plain, natural view of the shared world. Herds on the move through every kind of country.
// It is also the reference engine: everything here comes from world.js (the simulation) and draw.js (the painter).
import { createWorld } from '../world.js';
import { paintWorld, paintDino, drawParts, palette } from '../draw.js';

export default {
  id: 'walk',
  name: 'Dinosaur Walk',
  kind: '2d',
  sky: true,
  params: [
    { id: 'x1', label: 'Outline', value: 0.3, tip: 'Ink outline around the animals' },
    { id: 'x2', label: 'Haze', value: 0.5, tip: 'How quickly distant animals fade into the air' },
  ],
  create(ctx, opts) {
    const W = createWorld(opts);
    return {
      render(f) {
        const v = W.frame(f), p = f.p;
        paintWorld(f, v, {
          dino(f, v, it) {
            if (it.type !== 'dino' || p.x1 < 0.05) { it.fog *= p.x2 * 2; return paintDino(f, v, it); }
            it.fog *= p.x2 * 2; paintDino(f, v, it);
            ctx.globalAlpha = (it.fade ?? 1) * p.x1 * (1 - it.fog);
            drawParts(ctx, it.parts.filter(q => q.k === 'body' || q.k === 'skull' || q.k === 'jaw' || q.k === 'leg' && q.t === 'body'), it.T, { stroke: palette(it.sp, { light: v.light }).line, lw: Math.max(0.6, it.k * 0.02), fill: () => null });
            ctx.globalAlpha = 1;
          }
        });
      }
    };
  }
};

const S = (id, name, desc, tags, opts, params) => ({ id: 'walk-' + id, name, desc, tags: ['natural', '2d', ...tags], opts, params });
export const scenes = [
  S('trex', 'Tyrannosaurus on Patrol', 'A lone T. rex crosses the fern prairie of Late Cretaceous Montana.', ['theropod', 'cretaceous'],
    { cast: [{ sp: 'tyrannosaurus', n: 1 }], biome: 'plain', seed: 3 }, { stage: 0.855 }),
  S('sauropods', 'Diplodocus Herd', 'Long-necks on the move with their young in the middle of the herd.', ['sauropod', 'jurassic', 'herd', 'family'],
    { cast: [{ sp: 'diplodocus', n: 4, young: 3 }], biome: 'floodplain', seed: 11 }, { stage: 0.42, light: 0.6 }),
  S('trike', 'Triceratops Family', 'Horned faces grazing their way across the plain, calves close behind.', ['ceratopsian', 'cretaceous', 'family', 'herd'],
    { cast: [{ sp: 'triceratops', n: 3, young: 2 }], biome: 'plain', seed: 5 }, { stage: 0.86 }),
  S('stego', 'Stegosaurus in the Conifers', 'Plates and spikes among the araucarias of the Morrison.', ['stegosaur', 'jurassic', 'forest'],
    { cast: [{ sp: 'stegosaurus', n: 2, young: 1 }], biome: 'forest', mode: 'wander', seed: 8 }, { stage: 0.43 }),
  S('raptors', 'Velociraptors at Dusk', 'Turkey-sized, feathered and quick, over the dunes of the Gobi.', ['theropod', 'cretaceous', 'desert', 'pack'],
    { cast: [{ sp: 'velociraptor', n: 5 }], biome: 'desert', seed: 21 }, { stage: 0.805, light: 0.3, activity: 0.7 }),
  S('hunt', 'Allosaurus and Stegosaurus', 'A hunter tests a herd that can fight back. Watch the standoff.', ['theropod', 'stegosaur', 'jurassic', 'hunt'],
    { cast: [{ sp: 'stegosaurus', n: 3, young: 1 }, { sp: 'allosaurus', n: 1, role: 'pred' }], mode: 'hunt', biome: 'plain', seed: 14 }, { stage: 0.43, activity: 0.6 }),
  S('chase', 'Gallimimus Run', 'A flock of ostrich mimics bolts from a tyrannosaur.', ['theropod', 'cretaceous', 'hunt', 'herd'],
    { cast: [{ sp: 'gallimimus', n: 7 }, { sp: 'albertosaurus', n: 1, role: 'pred' }], mode: 'hunt', biome: 'desert', seed: 4 }, { stage: 0.82, activity: 0.7 }),
  S('nest', 'Maiasaura Nesting Ground', 'Good mother lizards feed their hatchlings in the nest.', ['ornithopod', 'cretaceous', 'family', 'nest'],
    { cast: [{ sp: 'maiasaura', n: 4, young: 7 }], mode: 'nest', biome: 'floodplain', seed: 9 }, { stage: 0.795, herd: 0.6 }),
  S('brachio', 'Brachiosaurus at the Treeline', 'Browsing twelve metres up, in the golden hour.', ['sauropod', 'jurassic', 'forest'],
    { cast: [{ sp: 'brachiosaurus', n: 2, young: 1 }], mode: 'wander', biome: 'forest', seed: 17 }, { stage: 0.425, light: 0.32 }),
  S('swamp', 'Spinosaurus in the Shallows', 'The sail-backed fisher wades the river deltas of North Africa.', ['theropod', 'cretaceous', 'water'],
    { cast: [{ sp: 'spinosaurus', n: 1 }], mode: 'wander', biome: 'swamp', seed: 6, flyers: 2 }, { stage: 0.71 }),
  S('coast', 'Hadrosaurs on the Shore', 'Crested duck-bills along the inland sea, pterosaurs overhead.', ['ornithopod', 'cretaceous', 'coast', 'herd'],
    { cast: [{ sp: 'parasaurolophus', n: 4, young: 2 }, { sp: 'corythosaurus', n: 2 }], biome: 'coast', seed: 12, flyers: 4 }, { stage: 0.80 }),
  S('triassic', 'Dawn of the Dinosaurs', 'Small, quick and two-legged in the red deserts of Pangaea.', ['triassic', 'desert', 'pack'],
    { cast: [{ sp: 'coelophysis', n: 5 }, { sp: 'plateosaurus', n: 2 }], biome: 'badlands', seed: 2 }, { stage: 0.1, light: 0.7 }),
  S('polar', 'Polar Night', 'Small dinosaurs of the Antarctic Circle under the winter stars.', ['ornithopod', 'cretaceous', 'snow', 'night'],
    { cast: [{ sp: 'leaellynasaura', n: 6 }], mode: 'wander', biome: 'polar', seed: 19 }, { stage: 0.63, light: 0.08 }),
  S('ankylo', 'Ankylosaurus, Armoured', 'A living tank with a club for a tail, in no hurry at all.', ['ankylosaur', 'cretaceous'],
    { cast: [{ sp: 'ankylosaurus', n: 1 }, { sp: 'pachycephalosaurus', n: 3 }], mode: 'wander', biome: 'uplands', seed: 23 }, { stage: 0.86 }),
  S('deeptime', 'Deep Time Safari', 'One valley through 180 million years: the cast changes as the eras go by, until the sky falls.', ['time travel', 'herd', 'impact'],
    { cast: 'era', biome: 'plain', seed: 1 }, { stage: 0.02, grow: 0.5 }),
  S('lastday', 'The Last Day', 'Hell Creek, 66 million years ago. Something is coming.', ['cretaceous', 'impact', 'time travel'],
    { cast: [{ sp: 'triceratops', n: 2, young: 1 }, { sp: 'tyrannosaurus', n: 1 }, { sp: 'edmontosaurus', n: 3 }], mode: 'wander', biome: 'plain', seed: 30 }, { stage: 0.862, grow: 0.62 }),
];
