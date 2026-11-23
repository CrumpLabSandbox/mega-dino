// The animals: every species the engines can draw, with what is known about it (see docs/SCIENCE.md for sources
// and for what is guesswork: colours and patterns are invented unless a note says otherwise).
// A species = a body plan (proportions the rig in rig.js animates) + overrides + features + facts.
//   kind 'walk' → pose()/parts() · 'fly' → flyParts() · 'swim' → swimParts()

// ---- body plans. Lengths are fractions of body length; leg segments and radii are fractions of hip height.
const theropod = {
  biped: 1, tail: .47, torso: .2, neck: .1, head: .125, hipH: .3, pitch: .03, arch: .03,
  r: .082, rHip: .08, rSh: .065, rNeck: [.055, .04], rTail: .062, taper: 1.25, belly: .1,
  neckA: [1.05, .3], up: .5, headA: -.12, tailA: [.06, .02],
  leg: [.4, .42, .3], legR: [.2, .085, .045, .04], foot: .17, toes: 'claw', lean: [.2, .95], lift: .16, stride: 1,
  arm: [.035, .03, .02], armR: .012, headT: 'theropod', top: 8,
};
const raptor = { ...theropod, tail: .5, torso: .18, neck: .12, head: .11, hipH: .27, r: .06, rHip: .058, rSh: .05, rNeck: [.035, .026],
  rTail: .035, taper: 1.1, neckA: [1.2, .25], leg: [.36, .44, .34], legR: [.16, .07, .035, .03], arm: [.07, .06, .05], headT: 'raptor', top: 13 };
const ornithomimid = { ...raptor, tail: .45, neck: .2, head: .07, hipH: .33, neckA: [1.25, .9], rNeck: [.03, .02], headT: 'ornitho', top: 16 };
const spinosaur = { ...theropod, head: .14, neck: .12, hipH: .24, arm: [.06, .055, .04], headT: 'spino', top: 6, neckA: [.9, .25] };
const therizino = { ...theropod, tail: .3, torso: .25, neck: .24, head: .05, hipH: .3, pitch: .45, r: .11, belly: .3, neckA: [1.2, 1.1],
  rNeck: [.04, .022], arm: [.1, .09, .06], headT: 'stego', top: 6 };
const prosauropod = { ...theropod, tail: .45, torso: .22, neck: .2, head: .05, hipH: .22, pitch: .12, r: .07, belly: .2, neckA: [.9, .5],
  rNeck: [.035, .02], arm: [.07, .06, .04], headT: 'sauro', top: 6, legR: [.17, .085, .05, .045] };
const ornithopod = { ...theropod, tail: .5, torso: .2, neck: .1, head: .075, hipH: .28, r: .065, neckA: [1.0, .4], rNeck: [.035, .026],
  arm: [.05, .045, .03], headT: 'stego', top: 11 };
const pachy = { ...ornithopod, head: .09, headT: 'pachy', hipH: .27, r: .075, top: 9 };
const sauropod = {
  biped: 0, tail: .5, torso: .16, neck: .27, head: .03, hipH: .155, pitch: -.02, arch: .035,
  r: .052, rHip: .05, rSh: .045, rNeck: [.03, .014], rTail: .035, taper: 1.8, belly: .2,
  neckA: [.3, .12], up: .9, headA: -.35, tailA: [-.12, .1],
  leg: [.5, .4, .14], legR: [.16, .12, .1, .11], foot: 0, toes: 'pad', lean: [.05, .35], lift: .07, stride: .85,
  arm: [.5, .42, .12], armR: [.14, .11, .095, .1], headT: 'sauro', top: 4,
};
const brachiosaur = { ...sauropod, tail: .3, torso: .2, neck: .36, head: .04, hipH: .2, pitch: .3, r: .075, rHip: .065, rSh: .07,
  rNeck: [.045, .02], rTail: .04, taper: 1.4, neckA: [1.05, 1.0], headA: -.2, tailA: [-.3, .05], headT: 'brachio', up: .3 };
const titanosaur = { ...sauropod, tail: .4, torso: .2, neck: .3, hipH: .17, pitch: .1, r: .065, neckA: [.6, .4], taper: 1.5 };
const camarasaur = { ...sauropod, tail: .4, neck: .24, torso: .22, head: .045, hipH: .2, pitch: .08, r: .075, neckA: [.75, .5],
  headT: 'brachio', rNeck: [.045, .025] };
const iguanodont = {
  biped: 0, tail: .45, torso: .24, neck: .12, head: .09, hipH: .27, pitch: -.2, arch: .04,
  r: .085, rHip: .08, rSh: .065, rNeck: [.045, .035], rTail: .06, taper: 1.2, belly: .15,
  neckA: [.75, .2], up: .5, headA: -.2, tailA: [.05, 0],
  leg: [.42, .42, .27], legR: [.19, .085, .05, .05], foot: .13, toes: 'hoof', lean: [.15, .8], lift: .12, stride: 1,
  arm: [.46, .42, .16], armR: [.07, .05, .04, .04], headT: 'duck', top: 10,
};
const ceratopsian = {
  biped: 0, tail: .3, torso: .3, neck: .06, head: .2, hipH: .3, pitch: -.08, arch: .05,
  r: .12, rHip: .105, rSh: .1, rNeck: [.08, .07], rTail: .07, taper: 1.3, belly: .25,
  neckA: [.1, -.15], up: .4, headA: -.45, tailA: [-.25, -.05],
  leg: [.46, .38, .2], legR: [.2, .11, .08, .085], foot: .08, toes: 'hoof', lean: [.1, .6], lift: .1, stride: .9,
  arm: [.44, .4, .17], armR: [.14, .095, .075, .08], headT: 'cerat', top: 7,
};
const stegosaur = {
  biped: 0, tail: .42, torso: .3, neck: .1, head: .06, hipH: .34, pitch: -.3, arch: .07,
  r: .11, rHip: .1, rSh: .08, rNeck: [.04, .028], rTail: .065, taper: 1.3, belly: .2,
  neckA: [-.1, -.15], up: .6, headA: -.2, tailA: [.12, .1],
  leg: [.5, .38, .16], legR: [.17, .1, .075, .08], foot: .07, toes: 'hoof', lean: [.08, .5], lift: .09, stride: .8,
  arm: [.45, .4, .16], armR: [.16, .1, .08, .085], headT: 'stego', top: 4,
};
const ankylosaur = {
  biped: 0, tail: .4, torso: .34, neck: .07, head: .1, hipH: .2, pitch: -.03, arch: .03,
  r: .11, rHip: .1, rSh: .095, rNeck: [.06, .055], rTail: .055, taper: .9, belly: .1,
  neckA: [.1, -.1], up: .3, headA: -.25, tailA: [-.05, .02],
  leg: [.46, .4, .18], legR: [.24, .13, .1, .1], foot: .08, toes: 'hoof', lean: [.1, .5], lift: .1, stride: .85,
  arm: [.46, .4, .16], armR: [.2, .13, .1, .1], headT: 'anky', top: 3,
};
const bird = {
  biped: 1, tail: .1, torso: .34, neck: .2, head: .16, hipH: .5, pitch: .25, arch: .05,
  r: .16, rHip: .14, rSh: .13, rNeck: [.06, .045], rTail: .07, taper: .8, belly: .15,
  neckA: [1.3, .9], up: .3, headA: -.1, tailA: [.2, .2],
  leg: [.3, .45, .35], legR: [.16, .06, .035, .03], foot: .22, toes: 'claw', lean: [.2, .9], lift: .2, stride: 1,
  arm: null, headT: 'bird', top: 8,
};
export const PLANS = { theropod, raptor, ornithomimid, spinosaur, therizino, prosauropod, ornithopod, pachy, sauropod, brachiosaur,
  titanosaur, camarasaur, iguanodont, ceratopsian, stegosaur, ankylosaur, bird };

// ---- species.  c = colours [body, belly, markings, display]; pat = stripes | bands | spots | saddle | plain
// f = features the rig draws; o = plan overrides; ma = [first, last] million years ago; len in metres, mass in kg.
const S = (id, name, plan, len, ma, rest) => ({ id, name, plan, len, ma, kind: 'walk', ...rest });
const RAW = [
  // Late Triassic
  S('eoraptor', 'Eoraptor', 'raptor', 1, [231, 228], { niche: 'tiny', diet: 'omnivore', mass: 10, where: 'Argentina', means: 'dawn plunderer',
    c: ['#8a7a4a', '#d9cc9a', '#5a4a2a', '#c2632e'], pat: 'stripes', o: { top: 9, head: .09 },
    fact: 'One of the earliest dinosaurs known: about the size of a fox, with teeth for both meat and plants.' }),
  S('herrerasaurus', 'Herrerasaurus', 'theropod', 4.5, [231, 229], { niche: 'apex', diet: 'carnivore', mass: 270, where: 'Argentina', means: 'Herrera’s lizard',
    c: ['#7b5a3c', '#cdb98f', '#3f2c1c', '#a8452e'], pat: 'bands', o: { head: .11, arm: [.06, .05, .04], top: 10, r: .07 },
    fact: 'An early predator, found by a goat herder named Victorino Herrera. It lived when dinosaurs were still rare.' }),
  S('coelophysis', 'Coelophysis', 'raptor', 3, [215, 201], { niche: 'pack', diet: 'carnivore', mass: 20, where: 'New Mexico, USA', means: 'hollow form',
    c: ['#9a8a55', '#e0d5a8', '#6a5a30', '#b9552f'], pat: 'stripes', o: { neck: .16, head: .09, r: .045, rHip: .045, top: 12 },
    fact: 'Hundreds of skeletons were found together at Ghost Ranch, perhaps a flock caught by a flash flood.' }),
  S('plateosaurus', 'Plateosaurus', 'prosauropod', 8, [214, 204], { niche: 'giant', diet: 'herbivore', mass: 2500, where: 'Germany, Switzerland, France', means: 'broad lizard',
    c: ['#6f7a4a', '#c9c79a', '#48522e', '#9a6a3a'], pat: 'saddle',
    fact: 'An early relative of the giant sauropods that still walked on two legs. Over a hundred skeletons are known.' }),
  // Early and Middle Jurassic
  S('dilophosaurus', 'Dilophosaurus', 'theropod', 7, [193, 183], { niche: 'apex', diet: 'carnivore', mass: 400, where: 'Arizona, USA', means: 'two-crested lizard',
    c: ['#5f6f4a', '#cfd0a0', '#39452a', '#d1502f'], pat: 'spots', f: { crest: 'double' }, o: { r: .062, rHip: .062, head: .1, neck: .13, arm: [.06, .05, .04], top: 10 },
    fact: 'It had two thin crests on its head. The neck frill and venom spit in films are made up.' }),
  S('scelidosaurus', 'Scelidosaurus', 'ankylosaur', 4, [196, 183], { niche: 'plated', diet: 'herbivore', mass: 270, where: 'England', means: 'limb lizard',
    c: ['#7a6a52', '#c8ba98', '#4a3e2e', '#9a8a6a'], pat: 'plain', f: { scutes: 1 }, o: { hipH: .24, r: .085, rHip: .08, rSh: .07, tail: .5, torso: .26, head: .07, headT: 'stego', top: 5 },
    fact: 'One of the first armoured dinosaurs, with rows of bony studs in its skin.' }),
  S('cryolophosaurus', 'Cryolophosaurus', 'theropod', 6.5, [194, 188], { niche: 'apex', diet: 'carnivore', mass: 465, where: 'Antarctica', means: 'cold crest lizard',
    c: ['#5a6878', '#d0d6da', '#34404e', '#e0a53a'], pat: 'bands', f: { crest: 'fan' }, o: { r: .068, arm: [.05, .045, .03], top: 10 },
    fact: 'Found 4,000 m up a mountain in Antarctica, which was then forested. Its crest runs across the head like a comb.' }),
  S('heterodontosaurus', 'Heterodontosaurus', 'ornithopod', 1.2, [200, 190], { niche: 'tiny', diet: 'omnivore', mass: 3, where: 'South Africa', means: 'different-toothed lizard',
    c: ['#8a6a3a', '#dccb9a', '#553d1e', '#c94f2a'], pat: 'stripes', f: { quills: 1 }, o: { top: 9 },
    fact: 'A turkey-sized plant eater with tusks like a boar and, most likely, a coat of bristles.' }),
  S('massospondylus', 'Massospondylus', 'prosauropod', 4, [200, 183], { niche: 'browser', diet: 'herbivore', mass: 500, where: 'South Africa, Zimbabwe', means: 'longer vertebra',
    c: ['#8a8250', '#d8d2a4', '#5c5630', '#a85a36'], pat: 'bands', o: { r: .055, neck: .22 },
    fact: 'Its nests are among the oldest dinosaur nests known, with eggs that still hold embryos.' }),
  S('megalosaurus', 'Megalosaurus', 'theropod', 9, [167, 165], { niche: 'apex', diet: 'carnivore', mass: 1400, where: 'England', means: 'great lizard',
    c: ['#5e5a44', '#c4bc94', '#35321f', '#8f4a2c'], pat: 'saddle', o: { arm: [.05, .045, .03] },
    fact: 'The first dinosaur ever named, in 1824, eighteen years before the word “dinosaur” existed.' }),
  S('shunosaurus', 'Shunosaurus', 'camarasaur', 9.5, [170, 160], { niche: 'giant', diet: 'herbivore', mass: 3000, where: 'Sichuan, China', means: 'Shu lizard',
    c: ['#7a7a5a', '#cfcda8', '#4c4c34', '#a0683a'], pat: 'saddle', f: { club: .5 }, o: { neck: .2, tail: .45 },
    fact: 'A short-necked sauropod with a spiked club at the end of its tail.' }),
  S('huayangosaurus', 'Huayangosaurus', 'stegosaur', 4.5, [168, 163], { niche: 'plated', diet: 'herbivore', mass: 500, where: 'Sichuan, China', means: 'Huayang lizard',
    c: ['#6a6048', '#c6bb96', '#3c3424', '#b5552e'], pat: 'plain', f: { plates: .6, spikes: 1, sideSpike: 1 }, o: { pitch: -.15, hipH: .3 },
    fact: 'An early stegosaur with narrow, spiky plates and a spike on each shoulder.' }),
  // Late Jurassic
  S('allosaurus', 'Allosaurus', 'theropod', 9, [155, 145], { niche: 'apex', diet: 'carnivore', mass: 2000, where: 'western USA, Portugal', means: 'different lizard',
    c: ['#6b5438', '#d2c097', '#3a2a18', '#b33d26'], pat: 'stripes', f: { crest: 'brow' }, o: { arm: [.055, .05, .035], head: .115 },
    fact: 'The top predator of the Late Jurassic. One skeleton, “Big Al”, shows 19 broken or infected bones it lived with.' }),
  S('stegosaurus', 'Stegosaurus', 'stegosaur', 8, [155, 145], { niche: 'plated', diet: 'herbivore', mass: 5000, where: 'western USA, Portugal', means: 'roof lizard',
    c: ['#6e6a44', '#cbc494', '#444226', '#c8532b'], pat: 'plain', f: { plates: 1, spikes: 1 },
    fact: 'The four tail spikes are called a thagomizer, a name that started as a joke in a Gary Larson cartoon. An Allosaurus bone has a hole that fits one.' }),
  S('diplodocus', 'Diplodocus', 'sauropod', 26, [154, 152], { niche: 'giant', diet: 'herbivore', mass: 14000, where: 'western USA', means: 'double beam',
    c: ['#7b7458', '#cdc7a6', '#4f4a36', '#8f7a4a'], pat: 'saddle', f: { spines: 1 },
    fact: 'Half of its length was tail, which ended in a whip that may have cracked faster than sound.' }),
  S('apatosaurus', 'Apatosaurus', 'sauropod', 22, [152, 151], { niche: 'giant', diet: 'herbivore', mass: 20000, where: 'western USA', means: 'deceptive lizard',
    c: ['#6a6a5c', '#c6c6b2', '#44443a', '#7a8a6a'], pat: 'plain', o: { r: .064, rHip: .06, rSh: .056, rNeck: [.042, .02], neck: .25, hipH: .165, legR: [.18, .13, .11, .12] },
    fact: 'The animal long known as “Brontosaurus”. Its neck was as thick as a tree trunk and may have been used in fights.' }),
  S('brachiosaurus', 'Brachiosaurus', 'brachiosaur', 22, [154, 150], { niche: 'giant', diet: 'herbivore', mass: 40000, where: 'western USA', means: 'arm lizard',
    c: ['#75705a', '#cfcab0', '#4a4636', '#a07a52'], pat: 'saddle',
    fact: 'Its front legs were longer than its back legs, so its back sloped up like a giraffe’s and it could browse 12 m off the ground.' }),
  S('camarasaurus', 'Camarasaurus', 'camarasaur', 15, [155, 145], { niche: 'giant', diet: 'herbivore', mass: 18000, where: 'western USA', means: 'chambered lizard',
    c: ['#857a5a', '#d6ceac', '#575037', '#9a6a44'], pat: 'bands',
    fact: 'The most common sauropod of the American West, with a short boxy skull and spoon-shaped teeth.' }),
  S('ceratosaurus', 'Ceratosaurus', 'theropod', 6.5, [153, 148], { niche: 'hunter', diet: 'carnivore', mass: 700, where: 'western USA, Portugal', means: 'horn lizard',
    c: ['#7a4a34', '#d4b894', '#42241a', '#cf6a2c'], pat: 'bands', f: { crest: 'nose', scutes: .5 }, o: { arm: [.045, .04, .03] },
    fact: 'A horn on its nose, one over each eye, and a row of small bony plates down its back.' }),
  S('compsognathus', 'Compsognathus', 'raptor', 1, [151, 149], { niche: 'tiny', diet: 'carnivore', mass: 3, where: 'Germany, France', means: 'elegant jaw',
    c: ['#7f8a4e', '#dfe0a8', '#4f5a2c', '#c8842e'], pat: 'stripes', f: { fuzz: 1 }, o: { top: 11, head: .1 },
    fact: 'About the size of a turkey. One skeleton has a lizard in its stomach, swallowed whole.' }),
  S('archaeopteryx', 'Archaeopteryx', 'raptor', 0.5, [150.8, 148.5], { niche: 'bird', diet: 'carnivore', mass: 0.9, where: 'Bavaria, Germany', means: 'ancient wing',
    c: ['#3a3a40', '#c9c4b4', '#1e1e24', '#8a5a2e'], pat: 'plain', f: { wings: 1.4, tailFan: 1, fuzz: 1 }, o: { top: 7, tail: .42, arm: [.1, .09, .07] }, span: 0.6,
    fact: 'Feathers and wings like a bird, teeth, claws and a bony tail like a dinosaur. Found in 1861, two years after Darwin’s Origin of Species.' }),
  S('kentrosaurus', 'Kentrosaurus', 'stegosaur', 4.5, [155, 150], { niche: 'plated', diet: 'herbivore', mass: 1000, where: 'Tanzania', means: 'spike lizard',
    c: ['#7a6040', '#d0bd95', '#49371f', '#a03a2a'], pat: 'bands', f: { plates: .55, spikes: 1, backSpikes: 1, sideSpike: 1 }, o: { pitch: -.22 },
    fact: 'Plates on the neck and shoulders turn into long spikes over the hips and tail.' }),
  S('mamenchisaurus', 'Mamenchisaurus', 'sauropod', 26, [160, 145], { niche: 'giant', diet: 'herbivore', mass: 25000, where: 'China', means: 'Mamenchi lizard',
    c: ['#6f7a5e', '#cdd4b4', '#465038', '#b0703a'], pat: 'bands', o: { neck: .45, tail: .34, torso: .15, neckA: [.55, .3], hipH: .15, r: .055, rNeck: [.032, .016] },
    fact: 'Its neck made up half of its body: up to 15 m in the largest species, the longest neck of any known animal.' }),
  // Early Cretaceous
  S('iguanodon', 'Iguanodon', 'iguanodont', 10, [126, 122], { niche: 'browser', diet: 'herbivore', mass: 4000, where: 'Belgium, England', means: 'iguana tooth',
    c: ['#5f7048', '#c9d0a0', '#3a472a', '#9a7a3a'], pat: 'saddle', f: { thumb: 1 },
    fact: 'The second dinosaur ever named. Its thumb spike was first reconstructed as a horn on its nose.' }),
  S('utahraptor', 'Utahraptor', 'raptor', 6, [135, 130], { niche: 'pack', diet: 'carnivore', mass: 400, where: 'Utah, USA', means: 'Utah’s predator',
    c: ['#5c4a36', '#d0bf9c', '#30241a', '#c2452a'], pat: 'bands', f: { sickle: 1.3, wings: .7, tailFan: .6, fuzz: 1 }, o: { r: .075, rHip: .072, top: 11, legR: [.2, .085, .045, .04] },
    fact: 'The largest raptor known, as heavy as a polar bear, with a 24 cm sickle claw on each foot.' }),
  S('deinonychus', 'Deinonychus', 'raptor', 3.4, [115, 108], { niche: 'pack', diet: 'carnivore', mass: 75, where: 'Montana and Oklahoma, USA', means: 'terrible claw',
    c: ['#7a5a3a', '#dccba0', '#44301c', '#3a6a8a'], pat: 'stripes', f: { sickle: 1, wings: .8, tailFan: .7, fuzz: 1 },
    fact: 'Its discovery in 1964 showed that dinosaurs could be fast and active, and tied them to birds.' }),
  S('baryonyx', 'Baryonyx', 'spinosaur', 9, [130, 125], { niche: 'hunter', diet: 'fish eater', mass: 1700, where: 'England, Spain', means: 'heavy claw',
    c: ['#4f6a6a', '#c4d4c8', '#2e4444', '#c87a3a'], pat: 'bands', f: { thumb: 1.5 },
    fact: 'Fish scales were found in its stomach. It hooked fish with a 30 cm thumb claw, like a grizzly bear.' }),
  S('psittacosaurus', 'Psittacosaurus', 'ornithopod', 2, [126, 101], { niche: 'tiny', diet: 'herbivore', mass: 20, where: 'China, Mongolia', means: 'parrot lizard',
    c: ['#6a4a30', '#e0cfa4', '#3c2818', '#c8a04a'], pat: 'spots', f: { quills: 1.5 }, o: { head: .1, headT: 'cerat', tail: .44, top: 8 }, known: 'colour',
    fact: 'One fossil keeps its skin and pigment: dark on top, pale below, with bristles on the tail. This colouring is the real one.' }),
  S('amargasaurus', 'Amargasaurus', 'sauropod', 10, [129, 122], { niche: 'giant', diet: 'herbivore', mass: 2600, where: 'Argentina', means: 'La Amarga lizard',
    c: ['#74684a', '#d2c8a0', '#473e2a', '#c9552e'], pat: 'bands', f: { neckSpines: 1 }, o: { neck: .2, tail: .46, torso: .2, hipH: .2, r: .07, rHip: .065, rNeck: [.04, .022], head: .045 },
    fact: 'A small sauropod with two rows of tall spines down its neck, perhaps holding up a pair of sails.' }),
  S('ouranosaurus', 'Ouranosaurus', 'iguanodont', 7.5, [115, 110], { niche: 'browser', diet: 'herbivore', mass: 2200, where: 'Niger', means: 'brave lizard',
    c: ['#8a7a4a', '#dcd2a0', '#5a4e2a', '#cf5a2e'], pat: 'plain', f: { sail: .6 },
    fact: 'A duck-billed relative with a tall sail or hump along its back.' }),
  S('acrocanthosaurus', 'Acrocanthosaurus', 'theropod', 11.5, [116, 110], { niche: 'apex', diet: 'carnivore', mass: 6000, where: 'Texas and Oklahoma, USA', means: 'high-spined lizard',
    c: ['#5a4c3c', '#cbbf9f', '#2f261c', '#a4482c'], pat: 'saddle', f: { sail: .25 }, o: { arm: [.05, .045, .03] },
    fact: 'Tall spines made a ridge of muscle down its back. A Texas trackway seems to show one following a sauropod.' }),
  S('microraptor', 'Microraptor', 'raptor', 0.8, [125, 120], { niche: 'bird', diet: 'carnivore', mass: 1, where: 'Liaoning, China', means: 'small thief',
    c: ['#1c1e2a', '#3a3e55', '#0e0f18', '#3f6fae'], pat: 'plain', f: { wings: 1.5, legWings: 1, tailFan: 1, fuzz: 1 }, o: { top: 7, arm: [.1, .09, .07] }, known: 'colour', span: 0.9,
    fact: 'A four-winged glider with flight feathers on its legs. Fossil pigment cells show it was glossy black, like a crow.' }),
  S('yutyrannus', 'Yutyrannus', 'theropod', 9, [125, 124], { niche: 'apex', diet: 'carnivore', mass: 1400, where: 'Liaoning, China', means: 'feathered tyrant',
    c: ['#8a8478', '#dedad0', '#55514a', '#c8732e'], pat: 'plain', f: { fuzz: 1.5, crest: 'nose' }, o: { arm: [.06, .055, .04] },
    fact: 'A 1.4-tonne tyrannosaur relative covered in shaggy feathers up to 20 cm long: the largest feathered animal known.' }),
  S('sauroposeidon', 'Sauroposeidon', 'brachiosaur', 30, [118, 110], { niche: 'giant', diet: 'herbivore', mass: 50000, where: 'Oklahoma and Texas, USA', means: 'lizard earthquake god',
    c: ['#6a6a58', '#c9c9b0', '#424236', '#8f6a4a'], pat: 'bands', o: { neck: .4 },
    fact: 'Perhaps the tallest dinosaur: with its neck up it could reach about 17 m, as high as a six-storey building.' }),
  S('gastonia', 'Gastonia', 'ankylosaur', 5, [139, 125], { niche: 'plated', diet: 'herbivore', mass: 1900, where: 'Utah, USA', means: 'Gaston’s',
    c: ['#6a5a44', '#c8ba9a', '#3c3022', '#a08a5a'], pat: 'plain', f: { scutes: 1, sideSpike: 2 },
    fact: 'A low, wide tank with big spikes sticking out from its shoulders and sides.' }),
  S('leaellynasaura', 'Leaellynasaura', 'ornithopod', 0.9, [118, 110], { niche: 'tiny', diet: 'herbivore', mass: 8, where: 'Victoria, Australia', means: 'Leaellyn’s lizard',
    c: ['#5a6a5a', '#d0dccb', '#33402f', '#b8884a'], pat: 'spots', f: { fuzz: 1 }, o: { tail: .7, top: 9 },
    fact: 'It lived inside the Antarctic Circle, through months of winter darkness, and had big eyes and a very long tail.' }),
  // Late Cretaceous
  S('spinosaurus', 'Spinosaurus', 'spinosaur', 14, [99, 93.5], { niche: 'apex', diet: 'fish eater', mass: 7000, where: 'Egypt, Morocco', means: 'spine lizard',
    c: ['#5e6a5a', '#c9d0b4', '#353f33', '#d8522c'], pat: 'bands', f: { sail: 1, paddleTail: 1 }, o: { hipH: .2, leg: [.44, .4, .26] },
    fact: 'Longer than T. rex, with a 1.6 m sail and a tail like a paddle. It hunted fish in rivers, the most water-loving dinosaur known.' }),
  S('giganotosaurus', 'Giganotosaurus', 'theropod', 12.5, [99, 95], { niche: 'apex', diet: 'carnivore', mass: 7000, where: 'Argentina', means: 'giant southern lizard',
    c: ['#6a5a40', '#d0c29a', '#3a2e1c', '#9a3a26'], pat: 'bands', o: { head: .135, arm: [.05, .045, .03] },
    fact: 'A little longer than T. rex, with a lighter skull and teeth like knives for slicing at giant sauropods.' }),
  S('argentinosaurus', 'Argentinosaurus', 'titanosaur', 33, [96, 92], { niche: 'giant', diet: 'herbivore', mass: 70000, where: 'Argentina', means: 'Argentine lizard',
    c: ['#746a56', '#cfc6ac', '#4a4234', '#9a7250'], pat: 'saddle',
    fact: 'Among the heaviest land animals ever: about 70 tonnes, as much as ten elephants. It hatched from an egg the size of a melon.' }),
  S('tyrannosaurus', 'Tyrannosaurus rex', 'theropod', 12.3, [68, 66], { niche: 'apex', diet: 'carnivore', mass: 8400, where: 'western North America', means: 'tyrant lizard king',
    c: ['#6a5a3c', '#cdbb90', '#3a2e1a', '#b5452f'], pat: 'saddle', o: { head: .135, hd: 1.12, r: .09, rHip: .088, legR: [.22, .09, .05, .045] },
    fact: 'It had the strongest bite of any land animal, enough to crush bone, and teeth the size of bananas. Its arms were short but strong.' }),
  S('triceratops', 'Triceratops', 'ceratopsian', 8.5, [68, 66], { niche: 'horned', diet: 'herbivore', mass: 8000, where: 'western North America', means: 'three-horned face',
    c: ['#7a6a4c', '#d2c6a0', '#4a3e28', '#c9632e'], pat: 'plain', f: { frill: 1, horns: 1, noseHorn: .5 },
    fact: 'Its skull could be 2.5 m long. Healed bite marks on frills and horns show it survived fights with T. rex.' }),
  S('ankylosaurus', 'Ankylosaurus', 'ankylosaur', 7, [68, 66], { niche: 'plated', diet: 'herbivore', mass: 6000, where: 'western North America', means: 'fused lizard',
    c: ['#6e5e44', '#cabb98', '#403423', '#a08a5a'], pat: 'plain', f: { scutes: 1, club: 1 },
    fact: 'Armoured down to its eyelids. The club on its tail could swing hard enough to break a tyrannosaur’s leg.' }),
  S('edmontosaurus', 'Edmontosaurus', 'iguanodont', 11, [73, 66], { niche: 'browser', diet: 'herbivore', mass: 4500, where: 'western North America', means: 'Edmonton lizard',
    c: ['#687248', '#cdd2a2', '#414a2a', '#b08a3e'], pat: 'bands', f: { crest: 'comb' }, o: { head: .1 },
    fact: '“Mummies” with skin show a soft comb on its head, like a rooster’s, and hooves on its front feet.' }),
  S('parasaurolophus', 'Parasaurolophus', 'iguanodont', 9.5, [76.5, 73], { niche: 'browser', diet: 'herbivore', mass: 2500, where: 'western North America', means: 'near crested lizard',
    c: ['#5a7a5a', '#cfd8a8', '#36503a', '#d1582c'], pat: 'stripes', f: { crest: 'tube' }, o: { head: .1 },
    fact: 'The hollow crest, up to 1.8 m long, was a trombone: air from the nose looped through it to make deep calls.' }),
  S('corythosaurus', 'Corythosaurus', 'iguanodont', 9, [77, 75.7], { niche: 'browser', diet: 'herbivore', mass: 3000, where: 'Alberta, Canada', means: 'helmet lizard',
    c: ['#6a6a3e', '#d6d09a', '#44441f', '#3f7a9a'], pat: 'spots', f: { crest: 'helmet' }, o: { head: .1 },
    fact: 'A duck-bill with a hollow crest shaped like a helmet, which worked as a horn for calling.' }),
  S('maiasaura', 'Maiasaura', 'iguanodont', 9, [77, 76], { niche: 'browser', diet: 'herbivore', mass: 2500, where: 'Montana, USA', means: 'good mother lizard',
    c: ['#7a724a', '#d8d0a4', '#4e482a', '#a86a3a'], pat: 'saddle', f: { crest: 'brow' }, o: { head: .1 },
    fact: 'Found with nests, eggs and young: the first proof that dinosaurs fed their babies in the nest. Colonies held thousands.' }),
  S('velociraptor', 'Velociraptor', 'raptor', 1.9, [75, 71], { niche: 'pack', diet: 'carnivore', mass: 15, where: 'Mongolia, China', means: 'swift seizer',
    c: ['#8a6a44', '#e0d0a8', '#553c20', '#c64a2a'], pat: 'bands', f: { sickle: 1, wings: .9, tailFan: .8, fuzz: 1 },
    fact: 'The size of a turkey, not a person, and feathered: its arm bones have the knobs where wing feathers attach.' }),
  S('protoceratops', 'Protoceratops', 'ceratopsian', 2, [75, 71], { niche: 'horned', diet: 'herbivore', mass: 80, where: 'Mongolia, China', means: 'first horned face',
    c: ['#9a8050', '#e0d2a4', '#665230', '#c9702e'], pat: 'bands', f: { frill: .8 }, o: { head: .17, r: .1, tail: .36, top: 6 },
    fact: 'A sheep-sized horned dinosaur with no horns. One fossil is locked in a fight with a Velociraptor.' }),
  S('styracosaurus', 'Styracosaurus', 'ceratopsian', 5.5, [75.5, 75], { niche: 'horned', diet: 'herbivore', mass: 2700, where: 'Alberta, Canada', means: 'spiked lizard',
    c: ['#6a5a4a', '#cfc2a4', '#3e3228', '#d14a2a'], pat: 'plain', f: { frill: .8, noseHorn: 1.6, frillSpikes: 1 },
    fact: 'A 60 cm nose horn and a crown of long spikes around its frill.' }),
  S('pachycephalosaurus', 'Pachycephalosaurus', 'pachy', 4.5, [70, 66], { niche: 'browser', diet: 'herbivore', mass: 450, where: 'western North America', means: 'thick-headed lizard',
    c: ['#7a6a48', '#d6caa0', '#4a3e26', '#c9862e'], pat: 'stripes', f: { crest: 'dome' },
    fact: 'The dome of solid bone on its head was up to 25 cm thick. Injuries on domes suggest they were used for butting.' }),
  S('gallimimus', 'Gallimimus', 'ornithomimid', 6, [72, 68], { niche: 'runner', diet: 'omnivore', mass: 450, where: 'Mongolia', means: 'chicken mimic',
    c: ['#a08a5a', '#e4d8b0', '#6a5a34', '#5a7a8a'], pat: 'saddle', f: { wings: .5, fuzz: 1 },
    fact: 'Built like an ostrich, toothless and fast, perhaps the quickest dinosaur of its size.' }),
  S('therizinosaurus', 'Therizinosaurus', 'therizino', 10, [72, 68], { niche: 'odd', diet: 'herbivore', mass: 5000, where: 'Mongolia', means: 'scythe lizard',
    c: ['#6a5a50', '#d0c4b0', '#3e322c', '#b0683a'], pat: 'bands', f: { claws: 1, fuzz: 1.2 },
    fact: 'A plant-eating theropod with a pot belly and the longest claws of any known animal, each about as long as a sword.' }),
  S('oviraptor', 'Oviraptor', 'raptor', 1.6, [75, 71], { niche: 'tiny', diet: 'omnivore', mass: 35, where: 'Mongolia', means: 'egg seizer',
    c: ['#8a5a3a', '#e0c8a0', '#553420', '#3f8a9a'], pat: 'saddle', f: { crest: 'casque', wings: 1, tailFan: 1, fuzz: 1 }, o: { tail: .34, head: .09, headT: 'bird', neck: .16, top: 10 },
    fact: 'Named a thief because it lay on a nest of eggs. They were its own: it died brooding them like a bird.' }),
  S('carnotaurus', 'Carnotaurus', 'theropod', 8, [72, 69], { niche: 'hunter', diet: 'carnivore', mass: 1400, where: 'Argentina', means: 'meat-eating bull',
    c: ['#8a4a34', '#dcbf9a', '#4f261a', '#d98a2e'], pat: 'spots', f: { crest: 'horns' }, o: { head: .09, hd: 1.25, arm: [.015, .012, .008], r: .07, top: 13, leg: [.38, .44, .32] },
    fact: 'Bull horns over the eyes, arms even smaller than T. rex’s, and a tail built for sprinting.' }),
  S('alamosaurus', 'Alamosaurus', 'titanosaur', 28, [70, 66], { niche: 'giant', diet: 'herbivore', mass: 38000, where: 'south-western USA', means: 'Ojo Alamo lizard',
    c: ['#7a705c', '#d2cab0', '#4e4638', '#a0764e'], pat: 'bands',
    fact: 'The last of the giant sauropods in North America, living alongside T. rex until the very end.' }),
  S('stenonychosaurus', 'Stenonychosaurus', 'raptor', 2.4, [77, 76], { niche: 'tiny', diet: 'omnivore', mass: 40, where: 'Alberta, Canada', means: 'narrow claw lizard',
    c: ['#5a5a48', '#d2d0b4', '#33332a', '#c8a23a'], pat: 'spots', f: { sickle: .7, wings: .8, tailFan: .6, fuzz: 1 }, o: { top: 12 },
    fact: 'Long known as Troodon. For its body size it had the biggest brain of any dinosaur, and large forward-facing eyes.' }),
  S('albertosaurus', 'Albertosaurus', 'theropod', 9, [71, 68], { niche: 'apex', diet: 'carnivore', mass: 2000, where: 'Alberta, Canada', means: 'Alberta lizard',
    c: ['#5f5a4a', '#cdc8ac', '#36322a', '#a8552e'], pat: 'stripes', o: { r: .072, rHip: .072, top: 10, leg: [.38, .44, .33] },
    fact: 'A lighter, faster cousin of T. rex. A bonebed of 26 animals of all ages hints that they lived in groups.' }),
  S('deinocheirus', 'Deinocheirus', 'ornithomimid', 11, [72, 68], { niche: 'odd', diet: 'omnivore', mass: 6400, where: 'Mongolia', means: 'terrible hand',
    c: ['#6a6050', '#d0c8b0', '#403830', '#9a5a7a'], pat: 'saddle', f: { sail: .45, fuzz: 1, tailFan: .5 }, o: { r: .1, rHip: .09, hipH: .28, top: 6, head: .09, headT: 'duck', neckA: [1.2, .7], arm: [.11, .1, .06], legR: [.2, .09, .05, .05] },
    fact: 'For fifty years only its 2.4 m arms were known. The rest turned out to be a humped, duck-billed giant that ate plants and fish.' }),
  S('saltasaurus', 'Saltasaurus', 'titanosaur', 8.5, [70, 68], { niche: 'giant', diet: 'herbivore', mass: 2500, where: 'Argentina', means: 'Salta lizard',
    c: ['#7a6e58', '#d0c6ac', '#4c4236', '#8a8a5a'], pat: 'spots', f: { scutes: .7 }, o: { neck: .24, r: .075, rHip: .07, hipH: .19 },
    fact: 'A small sauropod with armour: bony plates and studs set in the skin of its back.' }),
  // after the impact: the dinosaurs that are still here
  S('gastornis', 'Gastornis', 'bird', 1.9, [56, 45], { niche: 'apex', diet: 'herbivore', mass: 175, where: 'Europe, North America, China', means: 'Gaston’s bird',
    c: ['#5a4a3a', '#cfc0a4', '#33281e', '#d19a2e'], pat: 'plain', f: { fuzz: 1, wingFold: .7 }, o: { head: .22, hd: 1.25, r: .2, rHip: .18, rSh: .16, hipH: .42, torso: .4, neck: .18, rNeck: [.09, .07], legR: [.2, .08, .05, .045] },
    fact: 'A flightless bird two metres tall with a huge beak. It most likely cracked nuts and seeds, not bones.' }),
  S('presbyornis', 'Presbyornis', 'bird', 0.9, [62, 55], { niche: 'bird', diet: 'filter feeder', mass: 2, where: 'North America', means: 'elder bird',
    c: ['#6a5a4a', '#e6e0d0', '#3a3028', '#c8742e'], pat: 'plain', f: { fuzz: 1, wingFold: 1, tailFan: .5 }, o: { hipH: .62, neck: .3, head: .13, hd: .7, r: .13, leg: [.26, .46, .4], legR: [.12, .04, .025, .02], headT: 'duck', top: 6 },
    fact: 'A duck’s head on a flamingo’s legs. It waded in great flocks on lake shores a few million years after the impact.' }),
];

const F = (id, name, plan, span, ma, rest) => ({ id, name, plan, len: span, span, ma, kind: 'fly', ...rest });
const FLY = [
  F('eudimorphodon', 'Eudimorphodon', 'ptero', 1, [210, 203], { where: 'Italy', means: 'true two-form tooth', diet: 'fish eater', mass: 0.5,
    c: ['#6a5a48', '#d2c6b0', '#3c3228', '#b85a2e'], tailVane: 1, o: { head: .9 },
    fact: 'One of the first pterosaurs: the flying reptiles that shared the sky with the dinosaurs but were not dinosaurs.' }),
  F('dimorphodon', 'Dimorphodon', 'ptero', 1.45, [195, 190], { where: 'England', means: 'two-form tooth', diet: 'carnivore', mass: 1.5,
    c: ['#4a4a55', '#c8c8d0', '#2a2a33', '#d1602e'], tailVane: 1, o: { head: 1.4, hd: 1.5 },
    fact: 'A pterosaur with a big puffin-like head, found by Mary Anning at Lyme Regis in 1828.' }),
  F('rhamphorhynchus', 'Rhamphorhynchus', 'ptero', 1.8, [150.8, 148.5], { where: 'Bavaria, Germany', means: 'beak snout', diet: 'fish eater', mass: 2,
    c: ['#5a4a3a', '#d8cab0', '#33281e', '#3f7a9a'], tailVane: 1.5, o: { head: 1 },
    fact: 'Needle teeth for catching fish, and a long stiff tail tipped with a diamond-shaped vane.' }),
  F('pterodactylus', 'Pterodactylus', 'ptero', 1.04, [150.8, 148.5], { where: 'Bavaria, Germany', means: 'winged finger', diet: 'carnivore', mass: 1,
    c: ['#7a6a55', '#e0d6c0', '#4a3e30', '#c8502e'], crest: .4, o: { head: 1.2, neck: 1.2 },
    fact: 'The first pterosaur ever described, in 1784. Its wing is a sheet of skin held out by one enormous fourth finger.' }),
  F('tropeognathus', 'Tropeognathus', 'ptero', 8.2, [112, 108], { where: 'Brazil', means: 'keel jaw', diet: 'fish eater', mass: 60,
    c: ['#5a5a66', '#d6d6dc', '#34343c', '#d14a3a'], crest: .3, keel: 1, o: { head: 1.5 },
    fact: 'A sea-soaring pterosaur with rounded keels on the tips of its jaws, like the bow of a boat.' }),
  F('pteranodon', 'Pteranodon', 'ptero', 6.5, [86, 84.5], { where: 'Kansas, USA', means: 'toothless wing', diet: 'fish eater', mass: 35,
    c: ['#6a6058', '#e2dcd0', '#3e3630', '#d87a2e'], crest: 1.6, o: { head: 1.5 },
    fact: 'It soared over an inland sea like an albatross. Males had a long crest behind the head; over a thousand skeletons are known.' }),
  F('quetzalcoatlus', 'Quetzalcoatlus', 'ptero', 10.5, [68, 66], { where: 'Texas, USA', means: 'feathered serpent god', diet: 'carnivore', mass: 220,
    c: ['#6a5a4a', '#dcd2c0', '#3a3028', '#c9452e'], crest: .5, o: { head: 1.7, neck: 1.9 },
    fact: 'The largest flying animal known: wings as wide as a small plane and, standing, as tall as a giraffe.' }),
  F('ichthyornis', 'Ichthyornis', 'pbird', 0.6, [95, 83.5], { where: 'Kansas, USA', means: 'fish bird', diet: 'fish eater', mass: 0.3,
    c: ['#5a5a5e', '#eeeeee', '#2e2e33', '#d19a2e'], o: {},
    fact: 'A tern-like seabird that could fly as well as any modern bird, but still had teeth in its beak.' }),
];

const W = (id, name, plan, len, ma, rest) => ({ id, name, plan, len, ma, kind: 'swim', ...rest });
const SWIM = [
  W('shonisaurus', 'Shonisaurus', 'ichthyo', 15, [222, 212], { where: 'Nevada, USA', means: 'Shoshone mountain lizard', diet: 'carnivore', mass: 30000,
    c: ['#3a4a5a', '#c8d2d8', '#22303c', '#6a8aa0'], o: { deep: 1.2, snout: 1 },
    fact: 'A whale-sized ichthyosaur. These marine reptiles looked like dolphins but were neither dinosaurs nor fish.' }),
  W('ichthyosaurus', 'Ichthyosaurus', 'ichthyo', 2.5, [200, 190], { where: 'England', means: 'fish lizard', diet: 'fish eater', mass: 90,
    c: ['#2e3e4e', '#d2dce0', '#1a2632', '#5a7a90'], o: { deep: 1, snout: 1.2 },
    fact: 'Mary Anning and her brother found the first complete one in 1811, when she was twelve. They gave birth to live young at sea.' }),
  W('plesiosaurus', 'Plesiosaurus', 'plesio', 3.5, [199, 190], { where: 'England', means: 'near lizard', diet: 'fish eater', mass: 450,
    c: ['#4a5a4a', '#d6dcc8', '#2c3a2c', '#8a9a6a'], o: { neck: .9 },
    fact: 'Four flippers and a long neck: it “flew” under water like a penguin. Mary Anning found the first skeleton in 1823.' }),
  W('ophthalmosaurus', 'Ophthalmosaurus', 'ichthyo', 5, [165, 150], { where: 'England, Argentina', means: 'eye lizard', diet: 'squid eater', mass: 900,
    c: ['#33404a', '#cfd6da', '#1e2830', '#587088'], o: { deep: 1.1, snout: 1, eye: 1.8 },
    fact: 'Its eyes were 22 cm across, the largest for its size of any vertebrate, for hunting squid in the dark.' }),
  W('liopleurodon', 'Liopleurodon', 'plio', 6.5, [166, 155], { where: 'England, France', means: 'smooth-sided tooth', diet: 'carnivore', mass: 1700,
    c: ['#2a3a4a', '#d0d8dc', '#16222e', '#4a6a8a'], o: {},
    fact: 'A short-necked pliosaur with a 1.5 m skull, the top hunter of the Jurassic seas of Europe.' }),
  W('kronosaurus', 'Kronosaurus', 'plio', 10, [125, 100], { where: 'Queensland, Australia', means: 'lizard of Kronos', diet: 'carnivore', mass: 11000,
    c: ['#3a3e3a', '#d0d2c8', '#202420', '#6a7a5a'], o: {},
    fact: 'A pliosaur with a skull over 2 m long and teeth the size of bananas. It ate turtles and other plesiosaurs.' }),
  W('elasmosaurus', 'Elasmosaurus', 'plesio', 10.3, [80.5, 77], { where: 'Kansas, USA', means: 'thin-plate lizard', diet: 'fish eater', mass: 2000,
    c: ['#4a5a66', '#d8e0e4', '#2c3840', '#7a90a0'], o: { neck: 1.7 },
    fact: 'Its neck had 72 vertebrae and was longer than the rest of its body. The first reconstruction put the head on the tail.' }),
  W('mosasaurus', 'Mosasaurus', 'mosa', 13, [70, 66], { where: 'Netherlands, worldwide', means: 'Meuse lizard', diet: 'carnivore', mass: 10000,
    c: ['#2e3a44', '#c8d0d4', '#182028', '#55708a'], o: {},
    fact: 'A sea-going relative of monitor lizards and snakes with a shark-like tail. Its skull, found in 1764, started the science of extinction.' }),
];

export const SPECIES = [...RAW, ...FLY, ...SWIM];
for (const s of SPECIES) {
  s.f = s.f || {};
  if (s.kind === 'walk') s.P = { ...PLANS[s.plan], ...(s.o || {}) };
  s.group = s.kind === 'fly' ? (s.plan === 'pbird' ? 'bird' : 'pterosaur') : s.kind === 'swim' ? 'marine reptile'
    : ({ theropod: 'theropod', raptor: 'theropod', ornithomimid: 'theropod', spinosaur: 'theropod', therizino: 'theropod', bird: 'bird',
      prosauropod: 'sauropodomorph', sauropod: 'sauropod', brachiosaur: 'sauropod', titanosaur: 'sauropod', camarasaur: 'sauropod',
      ornithopod: 'ornithopod', pachy: 'pachycephalosaur', iguanodont: 'ornithopod', ceratopsian: 'ceratopsian', stegosaur: 'stegosaur', ankylosaur: 'ankylosaur' })[s.plan];
  if (s.id === 'psittacosaurus') s.group = 'ceratopsian';
  if (s.id === 'heterodontosaurus') s.group = 'ornithischian';
  if (s.id === 'scelidosaurus') s.group = 'thyreophoran';
  s.dino = s.kind === 'walk' || s.plan === 'pbird';     // pterosaurs and marine reptiles are not dinosaurs
}
const BY_ID = new Map(SPECIES.map(s => [s.id, s]));
const ALIAS = { trex: 'tyrannosaurus', rex: 'tyrannosaurus', raptor: 'velociraptor', bronto: 'apatosaurus', trike: 'triceratops', stego: 'stegosaurus' };

// species by id (or the object itself); unknown ids fall back to Tyrannosaurus so a typo never breaks a scene
export function species(id) {
  if (id && typeof id === 'object') return id;
  return BY_ID.get(id) || BY_ID.get(ALIAS[id]) || BY_ID.get('tyrannosaurus');
}
export const WALKERS = SPECIES.filter(s => s.kind === 'walk');
export const FLYERS = SPECIES.filter(s => s.kind === 'fly');
export const SWIMMERS = SPECIES.filter(s => s.kind === 'swim');

// was this species alive `ma` million years ago? (slack widens the range a little: the fossil record is patchy)
const birdy = s => s.plan === 'bird' || s.plan === 'pbird';
export const alive = (s, ma, slack = 2) => ma <= s.ma[0] + slack && ma >= s.ma[1] - slack && (ma >= 66 || birdy(s));
const gap = (s, ma) => ma > s.ma[0] ? ma - s.ma[0] : ma < s.ma[1] ? s.ma[1] - ma : 0;

// Who plays this species' part at another time. If `sp` was alive at `ma` it plays itself; otherwise the nearest
// species in time with the same niche (apex hunter, giant, plated…), then the same kind of animal. After the
// impact (66 Ma) only birds are left, whatever the niche.
export function standIn(sp, ma) {
  sp = species(sp);
  if (alive(sp, ma)) return sp;
  const pool = SPECIES.filter(s => s.kind === sp.kind && (ma >= 66 || birdy(s)));
  if (!pool.length) return null;                       // e.g. pterosaurs and marine reptiles after the impact
  let best = null, score = 1e9;
  for (const s of pool) {
    let d = gap(s, ma) * 3;
    if (s.niche !== sp.niche) d += 40;
    if (s.plan !== sp.plan) d += 12;
    if (s.diet !== sp.diet) d += 8;
    d += Math.abs(Math.log(s.len / sp.len)) * 6;
    if (d < score) { score = d; best = s; }
  }
  return best && gap(best, ma) < 30 ? best : null;
}

// everything of a kind that was alive at `ma`, nearest in time first
export function castAt(ma, kind = 'walk', slack = 3) {
  return SPECIES.filter(s => s.kind === kind && alive(s, ma, slack)).sort((a, b) => gap(a, ma) - gap(b, ma));
}

// a typical moment for a species, as a Stage value (the middle of its time range)
export { stageOfMa } from './time.js';
