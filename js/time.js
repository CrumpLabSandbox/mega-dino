// Deep time, shared by every engine so all views tell the same story.
// stage 0..1 runs through the age of dinosaurs: from the first dinosaurs of the Late Triassic, through the Jurassic
// giants and the Cretaceous, to the asteroid impact 66 million years ago and the birds that came through it
// (see docs/SCIENCE.md). era(stage) returns smooth curves engines draw from; TIME_GLSL is the same model for shaders.

export const STAGES = [
  { at: 0.00, id: 'triassic', name: 'Late Triassic', span: '237–201 million years ago',
    text: 'The first dinosaurs are small, quick and walk on two legs. All the land is one supercontinent, Pangaea: hot, with dry seasons, conifers, cycads and ferns. No flowers or grass exist yet.' },
  { at: 0.14, id: 'jurassic', name: 'Early and Middle Jurassic', span: '201–164 million years ago',
    text: 'A mass extinction clears out the dinosaurs’ rivals. Dinosaurs spread everywhere and grow. Pangaea starts to rift apart and the climate turns wetter and greener.' },
  { at: 0.36, id: 'giants', name: 'Late Jurassic', span: '164–145 million years ago',
    text: 'The age of giants. Long-necked sauropods, the largest land animals ever, browse conifer forests beside plated stegosaurs, hunted by Allosaurus. The first birds take to the air.' },
  { at: 0.50, id: 'earlyk', name: 'Early Cretaceous', span: '145–100 million years ago',
    text: 'The continents drift apart and each grows its own dinosaurs. Feathered raptors and iguanodonts spread, and the first flowering plants appear.' },
  { at: 0.68, id: 'latek', name: 'Late Cretaceous', span: '100–66 million years ago',
    text: 'Dinosaurs at their most varied: tyrannosaurs, horned ceratopsians, duck-bills in vast herds, armoured ankylosaurs. Flowers and broad-leaved trees are everywhere.' },
  { at: 0.88, id: 'impact', name: 'The impact', span: '66 million years ago',
    text: 'An asteroid about 10 km wide hits what is now Chicxulub, Mexico. Fire, tsunamis and then years of darkness and cold follow. About three quarters of all species die out, among them every dinosaur except the birds.' },
  { at: 0.94, id: 'after', name: 'After the dinosaurs', span: '66–56 million years ago',
    text: 'Ferns are first to cover the burnt ground. The surviving dinosaurs, the birds, and the small mammals spread into an empty world. Today there are about 11,000 species of living dinosaur.' },
];

// stage → million years ago (piecewise linear; the last two million years before the impact get extra room)
const KEYS = [[0, 237], [0.14, 201.4], [0.36, 163.5], [0.50, 145], [0.68, 100.5], [0.84, 68], [0.88, 66.04], [0.94, 66], [1, 56]];
export function maOf(stage) {
  const s = Math.min(1, Math.max(0, stage));
  for (let i = 1; i < KEYS.length; i++) if (s <= KEYS[i][0]) {
    const [s0, m0] = KEYS[i - 1], [s1, m1] = KEYS[i];
    return m0 + (m1 - m0) * (s - s0) / (s1 - s0);
  }
  return 56;
}
// million years ago → stage (inverse of maOf), for placing a species on the Stage control
export function stageOfMa(ma) {
  for (let i = 1; i < KEYS.length; i++) if (ma >= KEYS[i][1]) {
    const [s0, m0] = KEYS[i - 1], [s1, m1] = KEYS[i];
    return m0 === m1 ? s0 : s0 + (s1 - s0) * (ma - m0) / (m1 - m0);
  }
  return 1;
}

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function stageIndex(s) { let i = 0; while (i + 1 < STAGES.length && s >= STAGES[i + 1].at) i++; return i; }

export function era(stage) {
  const s = Math.min(1, Math.max(0, stage));
  const i = stageIndex(s), ma = maOf(s);
  return {
    stage: s, index: i, id: STAGES[i].id, name: STAGES[i].name, text: STAGES[i].text, span: STAGES[i].span,
    ma,                                                             // million years ago (237 … 56)
    pangaea: 1 - ss(0.12, 0.8, s),                                  // 1 = one supercontinent, 0 = continents apart
    dry: 0.75 - 0.5 * ss(0.1, 0.3, s) + 0.1 * ss(0.5, 0.7, s),      // 0 wet … 1 arid
    warm: 0.8 - 0.15 * ss(0.14, 0.4, s) + 0.1 * ss(0.5, 0.7, s) - 0.65 * ss(0.885, 0.9, s) + 0.5 * ss(0.93, 1, s),
    flowers: ss(0.52, 0.74, s) * (1 - 0.8 * ss(0.88, 0.9, s)) + 0.6 * ss(0.96, 1, s),   // flowering plants
    giants: ss(0.2, 0.38, s) * (1 - ss(0.88, 0.89, s)),             // how big the biggest animals are
    meteor: s >= 0.872 && s < 0.882 ? (s - 0.872) / 0.008 : 0,      // 0..1.25: the fireball crossing the sky (1 = it hits)
    flash: ss(0.8795, 0.8815, s) * (1 - ss(0.882, 0.9, s)),         // the impact flash and glow
    dark: ss(0.881, 0.895, s) * (1 - ss(0.925, 0.985, s)),          // impact winter: soot and dust hide the sun
    dinos: 1 - ss(0.882, 0.9, s),                                   // non-avian dinosaurs still alive
    ferns: ss(0.905, 0.94, s) * (1 - ss(0.955, 1, s)),              // the fern spike on the burnt ground
    age: s,
  };
}

// Same model in GLSL. Call `Era E = era(uStage);`.
export const TIME_GLSL = `
struct Era { float ma, pangaea, dry, warm, flowers, giants, meteor, flash, dark, dinos, ferns; };
float maOf(float s){
  if (s < .14) return mix(237., 201.4, s/.14);
  if (s < .36) return mix(201.4, 163.5, (s-.14)/.22);
  if (s < .50) return mix(163.5, 145., (s-.36)/.14);
  if (s < .68) return mix(145., 100.5, (s-.50)/.18);
  if (s < .84) return mix(100.5, 68., (s-.68)/.16);
  if (s < .88) return mix(68., 66.04, (s-.84)/.04);
  if (s < .94) return mix(66.04, 66., (s-.88)/.06);
  return mix(66., 56., (s-.94)/.06);
}
Era era(float s){
  Era E;
  E.ma = maOf(s);
  E.pangaea = 1. - smoothstep(.12,.8,s);
  E.dry = .75 - .5*smoothstep(.1,.3,s) + .1*smoothstep(.5,.7,s);
  E.warm = .8 - .15*smoothstep(.14,.4,s) + .1*smoothstep(.5,.7,s) - .65*smoothstep(.885,.9,s) + .5*smoothstep(.93,1.,s);
  E.flowers = smoothstep(.52,.74,s)*(1. - .8*smoothstep(.88,.9,s)) + .6*smoothstep(.96,1.,s);
  E.giants = smoothstep(.2,.38,s)*(1. - smoothstep(.88,.89,s));
  E.meteor = (s >= .872 && s < .882) ? (s-.872)/.008 : 0.;
  E.flash = smoothstep(.8795,.8815,s)*(1. - smoothstep(.882,.9,s));
  E.dark = smoothstep(.881,.895,s)*(1. - smoothstep(.925,.985,s));
  E.dinos = 1. - smoothstep(.882,.9,s);
  E.ferns = smoothstep(.905,.94,s)*(1. - smoothstep(.955,1.,s));
  return E;
}
`;
