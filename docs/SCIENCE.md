# What is known, and what is guessed

Mega-Dino runs every scene on one model: a cast of species (`js/species.js`), one skeleton rig that animates them
(`js/rig.js`), a world they live in (`js/world.js`) and a clock that runs through deep time (`js/time.js`). This page
says where the model follows the evidence and where it is invention.

## Deep time: the Era control

The Era control (stage 0–1) runs from the Late Triassic to just after the extinction. Dates follow the International
Chronostratigraphic Chart (2022 version), rounded; the 2024 chart moves two of these boundaries by about two million years. "Ma" means million years ago.

| stage | era | dates | what happens |
|---|---|---|---|
| 0.00–0.14 | Late Triassic | 237–201 Ma | The first dinosaurs appear by about 233–231 Ma. They are small, two-legged and a minor part of the fauna. All the land is joined in the supercontinent **Pangaea**; the interior is hot with strong dry seasons. Plants are conifers, cycads, ginkgoes, ferns and horsetails. |
| 0.14–0.36 | Early and Middle Jurassic | 201–164 Ma | The end-Triassic extinction (about 201 Ma, tied to huge eruptions as the Atlantic began to open) removes many competitors. Dinosaurs spread, diversify and grow. Pangaea starts to rift. |
| 0.36–0.50 | Late Jurassic | 164–145 Ma | The giant sauropods, stegosaurs and large theropods such as Allosaurus. *Archaeopteryx*, about 150 Ma. |
| 0.50–0.68 | Early Cretaceous | 145–100 Ma | Continents separate and faunas diverge. Feathered dinosaurs are preserved in detail in Liaoning, China. Flowering plants appear and spread. |
| 0.68–0.88 | Late Cretaceous | 100–66 Ma | High seas flood the continents (North America is split by the Western Interior Seaway). Tyrannosaurs, ceratopsians, hadrosaurs, ankylosaurs. The last two million years get extra room on the control so *T. rex* and *Triceratops* have somewhere to stand. |
| 0.88–0.94 | The impact | 66.0 Ma | An asteroid about 10 km across strikes at Chicxulub on the Yucatán Peninsula. |
| 0.94–1.00 | After | 66–56 Ma | The Paleocene. Birds and mammals radiate. |

### The impact

The scenes show, in order: a fireball crossing the sky (seconds in reality), a flash and glow, then darkness, ash and
cold, then ferns. The evidence behind that sequence:

- A worldwide thin clay layer at the Cretaceous–Paleogene boundary is rich in **iridium**, rare in the crust and common
  in asteroids (Alvarez and colleagues, 1980). The layer also holds shocked quartz and glass spherules.
- The **Chicxulub crater**, about 180 km across and buried under the Yucatán, was identified in 1991 and is the same age.
- Soot and dust in the atmosphere cut sunlight for months to years (an "impact winter"), collapsing food chains based on
  photosynthesis. Sulphur from the target rocks made it worse.
- Just above the boundary, pollen records show a **fern spike**: ferns recolonise bare ground first, as they do on
  fresh lava today.
- About three quarters of species died out, including all dinosaurs except some birds, all pterosaurs, and the mosasaurs
  and plesiosaurs. Massive volcanism in India (the Deccan Traps) was under way at the same time and may have added stress;
  the impact is the accepted main cause.

In the model non-avian dinosaurs leave the stage between 0.882 and 0.90, the dark lasts to about 0.98 and birds return
from 0.94. Real recovery took hundreds of thousands to millions of years; the control compresses it.

### Plants

There is **no grass** in any scene set in the Mesozoic. Grasses left only traces at the very end of the Cretaceous and
grasslands came tens of millions of years later. Flowering plants (magnolia-like trees, palms, small flowers) appear
from the Early Cretaceous and build up; before that the model uses only conifers (including Araucaria, the
monkey-puzzle family), cycads, ginkgoes, tree ferns, ferns and horsetails (`flora()` in `js/flora.js`).

## The animals

`js/species.js` holds 61 walking dinosaurs (two of them birds from after the impact), 8 flyers and 8 marine reptiles.
For each: its length, mass, age range, where it was found, what its name means and one fact.

- **Lengths and ages** are published estimates, rounded. Many species are known from a few specimens, so a length is
  "the size of a large adult as currently reconstructed". The giants are the least certain: *Argentinosaurus* is known
  from a handful of bones, and its 30–35 m and 65–80 tonnes are scaled from relatives.
- **Masses** are volumetric or limb-bone estimates and can differ by a factor of two between studies. Treat them as
  rough.
- **Who is a dinosaur.** Pterosaurs (the flyers) and the marine reptiles (ichthyosaurs, plesiosaurs, pliosaurs,
  mosasaurs) are *not* dinosaurs. Pterosaurs are close cousins; ichthyosaurs and plesiosaurs are separate groups of
  reptiles; mosasaurs are lizards. Birds *are* dinosaurs: they descend from small feathered theropods, so the scenes
  after the impact still show dinosaurs.
- **Recasting.** When you move Era on a scene, each species is replaced by the species closest in time that filled the
  same role (apex predator, giant plant eater, armoured plant eater…). That is a storytelling device: the stand-ins
  are not ancestors or descendants of the originals, and they did not necessarily live in the same place. The species
  the scene is named for is the one that fits its default Era.

### Bodies and posture

The rig gives every species a horizontal back, a tail held off the ground and legs straight under the body. That
posture is well supported by trackways (no tail drag marks) and joint anatomy, and replaced the upright,
tail-dragging reconstructions of the early twentieth century.

- Proportions are set per body plan (theropod, raptor, sauropod, ceratopsian…) with per-species adjustments. They are
  drawn to read clearly, not measured from skeletons, so silhouettes are approximate.
- **Sauropod necks**: *Brachiosaurus* held its neck up; whether *Diplodocus* held its neck near horizontal or raised is
  debated. The model follows the usual reconstructions.
- **Hadrosaurs and iguanodonts** are shown walking on four legs; they could also run on two.
- ***Spinosaurus*** is shown with the paddle-like tail described in 2020. How much it swam is debated.
- ***T. rex* lips, exposed teeth** and similar soft-tissue questions are unsettled; the model shows teeth when the
  mouth opens.

### Feathers, skin and colour

- **Feathers.** Feathers or feather-like filaments are known directly in many theropods (*Velociraptor* has quill knobs
  on its arm bones; *Yutyrannus*, *Microraptor*, *Archaeopteryx* and others preserve the feathers themselves) and in
  a few plant eaters (*Psittacosaurus* tail bristles). The model gives those species wings, tail fans and a fuzzy outline.
  Large tyrannosaurs such as *T. rex* are shown scaly, following skin impressions; their young may have been fuzzy.
- **Colour is almost entirely invented.** The palettes are muted, counter-shaded guesses based on living animals. The
  exceptions, where fossil pigment cells (melanosomes) or preserved skin give real evidence, are marked
  `known: 'colour'`: *Psittacosaurus* (dark above, pale below, a forest animal's camouflage) and *Microraptor*
  (iridescent black). The bright plates, frills, sails and crests are a guess that these were display structures.
- **Stegosaurus plates** are shown in two alternating rows, the arrangement the best skeletons support.

### Movement

- **Gait.** Bipeds alternate legs; four-legged dinosaurs use a lateral-sequence walk (hind, front on the same side,
  then the other side), as large living quadrupeds do and as trackways suggest.
- **Speeds.** Walking speed scales with the square root of hip height (a constant Froude number, the same rule that
  links leg length and speed in living animals). Top speeds per species are rough figures from published biomechanical
  estimates: giant sauropods could not run; *T. rex* probably managed a fast walk or slow run of 20–30 km/h; small
  theropods and ornithomimids were fast. None of these has been measured, only modelled or inferred from a few
  trackways. The "Speed estimates" diagram says so on screen.

### Behaviour

What the scenes show, and the evidence for it:

| shown | evidence |
|---|---|
| Herds on the move | Bonebeds of single species (*Maiasaura*, *Centrosaurus*, *Edmontosaurus*) and parallel trackways of sauropods and ornithopods. |
| Young walking with adults | Trackways with small prints among large ones; a cluster of 34 *Psittacosaurus* hatchlings found with an older juvenile (the "adult" first reported is disputed). |
| Nesting colonies, adults feeding hatchlings | *Maiasaura* at Egg Mountain, Montana: nests spaced about an adult's length apart, hatchlings with worn teeth still in the nest. |
| Brooding on eggs | Oviraptorids (*Citipati*, and *Oviraptor* itself) found sitting on their nests in a bird-like posture. |
| Horned and plated dinosaurs standing their ground | Healed *T. rex* bite marks on *Triceratops*; an *Allosaurus* vertebra punctured by a *Stegosaurus* tail spike. |
| Predators in groups | Weak. *Albertosaurus* and *Deinonychus* have been found in groups, but that may be scavenging or chance. Pack hunting like wolves is a popular idea, not an established fact; the scenes with several raptors show animals moving together and nothing more elaborate. |
| Calls | Hadrosaur crests are resonating chambers, so they almost certainly called. Roaring by big theropods is a guess; closed-mouth booms like those of crocodiles and large birds are thought more likely. |
| Polar dinosaurs in winter darkness | *Leaellynasaura* and others from Victoria, Australia, then inside the Antarctic Circle. |

The individual choices the animals make (when to graze, rest, look up or turn back) are a simple simulation with
random timers. Hunts never end in a kill: the chase runs out or turns into a standoff.

## The sea and the sky

- Marine reptiles swam with different strokes: ichthyosaurs and mosasaurs by tail, plesiosaurs by "flying" with four
  flippers. The model follows that. Ichthyosaurs gave birth to live young at sea (fossils show it).
- Pterosaur wings were skin membranes stretched from an enormously long fourth finger to the hind legs. The model's
  wing shape follows that; flight style (soaring, flapping rates) is a guess scaled by wingspan.
- The sea scenes use period life (ammonites, belemnites, crinoids, rudist reefs) and leave out kelp forests and marine
  mammals, which came later.

## Maps

The globe in "Drifting Continents" is a hand-made approximation that blends between a few layouts: one Pangaea, a
northern Laurasia and southern Gondwana, and something near today's map with higher seas. It shows the order of events,
not accurate coastlines.

## Sources

General references the data was drawn from; any error is ours.

- International Commission on Stratigraphy, *International Chronostratigraphic Chart*.
- S. Brusatte, *The Rise and Fall of the Dinosaurs* (2018) and *Dinosaur Paleobiology* (2012).
- D. Weishampel, P. Dodson, H. Osmólska (eds.), *The Dinosauria*, 2nd ed. (2004).
- G. Paul, *The Princeton Field Guide to Dinosaurs* (lengths and masses).
- L. Alvarez et al., "Extraterrestrial cause for the Cretaceous–Tertiary extinction", *Science* 208 (1980).
- P. Schulte et al., "The Chicxulub asteroid impact and mass extinction at the Cretaceous–Paleogene boundary", *Science* 327 (2010).
- J. Horner and R. Makela, "Nest of juveniles provides evidence of family structure among dinosaurs", *Nature* 282 (1979).
- J. Vinther et al., "3D camouflage in an ornithischian dinosaur", *Current Biology* 26 (2016) (*Psittacosaurus* colour).
- Q. Li et al., "Reconstruction of *Microraptor* and the evolution of iridescent plumage", *Science* 335 (2012).
- N. Ibrahim et al., "Tail-propelled aquatic locomotion in a theropod dinosaur", *Nature* 581 (2020) (*Spinosaurus*).
- R. McN. Alexander, "Estimates of speeds of dinosaurs", *Nature* 261 (1976).
- Natural History Museum (London) Dino Directory and the Paleobiology Database, for ranges and localities.
