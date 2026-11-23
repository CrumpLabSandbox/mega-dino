# Writing an engine

An **engine** is one way of drawing dinosaurs (a storybook, pixel art, a skeleton X-ray, a raymarcher…). A **scene**
is an engine plus preset values. The gallery lists scenes. Each engine lives in `js/engines/<id>.js` and is listed in
`js/registry.js`. The host API is the same as [Mega-Volcano](https://github.com/CrumpLabSandbox/mega-volcano)'s and
[Mega-Clouds](https://github.com/CrumpLabSandbox/Mega-Clouds)' (their engines are useful reading), plus the shared
dinosaur model: the species, the rig that animates them, the world they live in, and deep time.

`js/engines/walk.js` is the reference engine. Read it first: it is 30 lines of code plus scenes.

```js
// js/engines/example.js
import { createWorld } from '../world.js';
import { paintWorld, paintDino, drawParts, palette } from '../draw.js';

export default {
  id: 'example',
  name: 'Example',
  kind: '2d',          // '2d' → the host passes a CanvasRenderingContext2D; 'gl' → a WebGL2RenderingContext
  res: 1,              // render-resolution multiplier (0.5 for heavy shaders); the host upscales
  sky: true,           // false for views with no open sky (from above, under water, diagrams that fill the frame)
  nearest: false,      // true → the host upscales with hard pixels (pixel art)
  params: [            // up to four engine-specific controls, mapped to p.x1..p.x4, all 0..1
    { id: 'x1', label: 'Outline', value: 0.5, tip: 'optional tooltip' },
  ],
  create(ctx, opts) {  // opts = the scene's opts object (constants: cast, biome, palette, mode…)
    const W = createWorld(opts);
    return {
      render(f) { const v = W.frame(f); paintWorld(f, v, { /* style overrides */ }); },
      resize(w, h) {},  // optional
      dispose() {}      // optional
    };
  }
};

export const scenes = [
  { id: 'example-trex', name: 'Example Rex', tags: ['cartoon', '2d', 'theropod'], desc: 'One line about it.',
    opts: { cast: [{ sp: 'tyrannosaurus', n: 1 }], biome: 'plain', seed: 3 },
    params: { stage: 0.855, light: 0.8, x1: 0.5 } },
];
```

## Deep time (`js/time.js`)

Every scene sits somewhere in the same story: the age of dinosaurs. The host turns the **Era** (`stage`) and
**Time travel** (`grow`) controls into `f.stage` (0..1, looping when Time travel is above 0) and hands you `f.era`:

| stage | era (`f.era.id`) | when | what to show |
|---|---|---|---|
| 0.00–0.14 | `triassic` | 237–201 Ma | small two-legged dinosaurs; hot, dry Pangaea; conifers, cycads, ferns; **no flowers, no grass** |
| 0.14–0.36 | `jurassic` | 201–164 Ma | dinosaurs spread and grow; wetter and greener |
| 0.36–0.50 | `giants` | 164–145 Ma | giant sauropods, stegosaurs, Allosaurus, the first birds |
| 0.50–0.68 | `earlyk` | 145–100 Ma | feathered raptors, iguanodonts; first flowers |
| 0.68–0.88 | `latek` | 100–66 Ma | tyrannosaurs, ceratopsians, duck-bills, ankylosaurs; flowers everywhere |
| 0.88–0.94 | `impact` | 66 Ma | the asteroid: a fireball, a flash, then darkness, ash and cold |
| 0.94–1.00 | `after` | 66–56 Ma | ferns on burnt ground; only birds are left |

`f.era` fields (all smooth): `ma` (million years ago), `pangaea` (1 one continent → 0 apart), `dry`, `warm`,
`flowers`, `giants`, `meteor` (0, or 0..1.25 while the fireball crosses the sky; 1 = it hits), `flash`, `dark`
(impact winter 0..1), `dinos` (non-avian dinosaurs alive, 1 → 0), `ferns` (fern spike), plus `stage`, `index`, `id`,
`name`, `span`, `text`. `f.epoch` counts completed loops. `maOf(stage)` and `stageOfMa(ma)` convert.

Scenes set their era with `params.stage`. Handy values: Late Triassic 0.08 · Early Jurassic 0.2 · Late Jurassic
(Morrison: Allosaurus, Stegosaurus, Diplodocus) 0.42 · Early Cretaceous 0.56 · Spinosaurus 0.71 · Velociraptor 0.79 ·
T. rex and Triceratops 0.855 · just before the impact 0.865 · impact winter 0.9 · after 0.97. A scene that should run
through time by itself sets `grow` (0.5 ≈ a loop every two minutes); the default is 0 (stay put).

**Everything must cope with any stage**, because the user can drag Era on any scene. With the world this is automatic:
species that were not alive at the chosen time are replaced by whoever filled the same niche then (`standIn`), and at
the impact the dinosaurs go and birds come back later. If you draw species yourself, call
`standIn(species, f.era.ma)` (it may return `null`: nothing like it was alive) or lock the species on purpose
(diagrams, a museum, toys) and say so in the scene description.

## The animals (`js/species.js`)

`species(id)` → a species object; `SPECIES`, `WALKERS`, `FLYERS`, `SWIMMERS` list them; `castAt(ma, kind)` lists who was
alive; `standIn(sp, ma)` recasts for another time. Fields: `id`, `name`, `kind` (`walk` | `fly` | `swim`), `group`
(theropod, sauropod, ceratopsian…), `plan`, `len` (metres), `span` (flyers), `mass` (kg), `ma` ([first, last]), `diet`,
`niche`, `where`, `means` (what the name means), `fact` (one true sentence), `c` (colours `[body, belly, markings,
display]`), `pat`, `f` (features: plates, frill, sail, crest…), `dino` (false for pterosaurs and marine reptiles: they
were **not** dinosaurs, so never label them as such), `known: 'colour'` when the colouring is from fossil pigment.

Walkers (56): eoraptor herrerasaurus coelophysis plateosaurus · dilophosaurus scelidosaurus cryolophosaurus
heterodontosaurus massospondylus megalosaurus shunosaurus huayangosaurus · allosaurus stegosaurus diplodocus apatosaurus
brachiosaurus camarasaurus ceratosaurus compsognathus archaeopteryx kentrosaurus mamenchisaurus · iguanodon utahraptor
deinonychus baryonyx psittacosaurus amargasaurus ouranosaurus acrocanthosaurus microraptor yutyrannus sauroposeidon
gastonia leaellynasaura · spinosaurus giganotosaurus argentinosaurus tyrannosaurus triceratops ankylosaurus edmontosaurus
parasaurolophus corythosaurus maiasaura velociraptor protoceratops styracosaurus pachycephalosaurus gallimimus
therizinosaurus oviraptor carnotaurus alamosaurus stenonychosaurus albertosaurus deinocheirus saltasaurus · gastornis
presbyornis (birds, after the impact).
Flyers (8): eudimorphodon dimorphodon rhamphorhynchus pterodactylus tropeognathus pteranodon quetzalcoatlus ichthyornis.
Swimmers (8): shonisaurus ichthyosaurus plesiosaurus ophthalmosaurus liopleurodon kronosaurus elasmosaurus mosasaurus.

Colours and patterns are guesses unless `known` says otherwise; `docs/SCIENCE.md` says what is known.

## The rig (`js/rig.js`, `js/swimfly.js`)

One skeleton model animates every walker. Nothing in it touches a canvas: it returns geometry in **metres**, in the
animal's own frame (x forward, the animal faces +x; y up; origin on the ground under the hips).

```js
import { pose, parts, bones, topParts, capsules, gait, size } from '../rig.js';
const q = pose('triceratops', { phase, run, headTo, jaw, crouch, rear, t, scale, young });
```

- `phase`: stride cycles (advance by `speed * dt / gait(sp, run).stride` so feet don't slide; `gait` also gives
  `vWalk` and `top` speeds in m/s and `duty`). `run`: 0 walk … 1 flat out.
- `headTo`: −1 head down to the ground (grazing, drinking, sniffing) … 0 … +1 head up (alert, calling, browsing).
- `jaw` 0..1, `crouch` 0..1 (lying down), `rear` 0..1 (rearing up), `t` seconds (tail sway, breathing),
  `scale` (0.25 for a hatchling), `young` 0..1 (bigger head and eyes), `gy(dx)` optional ground height under the body.
- `size(sp)` → `{ len, hip, tall }` in metres, for framing.

`parts(q)` → what to draw, **back to front**, each `{ k: kind, t: tone, … }` with one of `p: [[x, y]…]` (a polygon,
`s: 1` when it wants smoothing), `c: [x, y, r]` (a circle) or `l: [[x, y]…], w` (a polyline with a width in metres).
Tones: `body`, `belly`, `far` (limbs on the far side), `mark` (stripes, spots), `accent` (plates, frills, sails,
crests, feathers), `accentFar`, `horn` (horns, claws, beaks, teeth), `eye`, `mouth`. Kinds: `leg arm wing body belly
mark plate spike sail ray frill skull jaw tooth crest horn beak eye nostril foot claw club scute quill fuzz tailfan`.
Style them however you like: fill by tone, stroke outlines, rasterise to pixels, hatch, jitter, extrude.

- `bones(q)` → the same animal as a skeleton (tones `bone`, `boneFar`, `hole`).
- `topParts(q)` → seen from above, polygons in `[x forward, z sideways]`.
- `capsules(q)` → 3D capsules `[ax, ay, az, bx, by, bz, ra, rb, tone]` for raymarchers, voxels and low-poly meshes.
- `q.nodes` is the spine (tail tip → head, `{x, y, z, r}`), `q.iHip`, `q.iSh`, `q.head` (`x y a len jaw`), `q.legs`
  (`pts` = hip/knee/ankle/toe joints, `tip`, `stance`, `near`, `front`), `q.arms`.
- `flyParts(sp, { t, glide, yaw, pitch, scale, jaw })` and `swimParts(sp, { t, phase, scale, jaw, bend })` return the
  same part format for pterosaurs/birds and marine reptiles, origin at the middle of the body.
- `plantParts(kind, seed, sway)` (`js/flora.js`) does the same for plants and props, origin at the base. Kinds: `fern
  horsetail bush cycad reed flowers treefern ginkgo conifer araucaria redwood magnolia palm deadtree stump rock boulder
  log bones nest`; tones `trunk leaf leaf2 flower rock rock2 egg bone`. `flora(f.era)` gives era-correct weights.
  `PLANTS[kind].h` is the height in metres.

`js/draw.js` puts parts on a canvas: `drawParts(ctx, parts, T, look)` with `T = { x, y, k, dir }` (canvas position of
the origin, pixels per metre, facing ±1) and `look = { pal, stroke, lw, alpha, fill(tone, part), pupil }`;
`palette(sp, { light, fog })` gives a species' tone colours; `trace(ctx, part, T)` adds one part to the current path;
`mapParts(parts, T)` converts to pixel coordinates. `tools/lineup.html` shows every species; `tools/others.html` shows
flyers, swimmers and plants.

## The world (`js/world.js`)

Most engines draw the shared world: terrain, era-correct plants and a cast that walks, grazes, calls, rests, raises
young, hunts and flees. `createWorld(opts)` in `create`, then `const v = W.frame(f)` each frame.

`opts`: `cast` — `'era'` (whoever was alive, changing as time passes) or a list of `{ sp, n, young, role, lane, lock }`
(`young`: how many juveniles follow the adults; `role: 'pred'` marks the hunters in hunt mode; `lock: true` keeps the
species at any time) · `mode` — `'migrate'` (walk together, pause to graze; the camera follows), `'wander'` (mill about
one place), `'hunt'` (stalk → charge → flee, or a standoff when the prey is horned or plated), `'nest'` (nests,
brooding adults, hatchlings) · `biome` — `plain forest swamp floodplain desert coast badlands polar uplands` (or an
object like those in `BIOMES`) · `seed` · `flyers` (pterosaurs in the sky) · `horizon`, `foot` (fractions of the
height: where the horizon and the main animals' feet sit; defaults 0.56 and 0.85) · `frame` (>1 pulls the camera back)
· `dir`, `pace`, `nonstop`, `pan`, `nests`, `cam: 'still'`.

`v` (everything in canvas pixels):

- `v.layers`: ground bands far → near. Each band: `pts` (its top edge, a polyline across the canvas), `u` (0 far … 1
  near), `d` (depth in metres), `wet` + `anyWet` + `level` + `next` (shallow water), and `items`: what stands on it.
  Draw the band (fill below `pts` to the bottom), then its items, in order.
- items: `{ type: 'dino', sp, actor, T: { x, y, k, dir }, pose, parts, bones, fade, fog, wade, waterY, state, young }`
  (`pose`, `parts`, `bones` are computed when first read; `state` is `walk run stand graze look call rest sniff guard
  feed stalk`), or `{ type: 'plant', kind, seed, x, y, k, sway, fog, parts }`.
- `v.far`: silhouette layers on the horizon (`pts`, `tone`, `kind`), `v.sea` (coast), `v.flyers` (items with
  `type: 'flyer'`), `v.sun` (`x y r night dusk moon`), `v.meteor` (`x y r ang len hit` or null), `v.flash`, `v.dark`,
  `v.light` (the Light control, dimmed by the impact winter), `v.horizon`, `v.k0` (pixels per metre at the stage),
  `v.sx(x, d)`, `v.sy(x, d, y)`, `v.actors`, `v.lead`, `v.hunt` (phase), `v.biome`, `v.wind`.

`paintWorld(f, v, S)` (`js/draw.js`) paints all of that in order and lets you replace any step: `S.sky S.sun S.flyer
S.meteor S.far S.sea S.ground S.water S.plant S.dino S.fx`, each `(f, v, thing)`. The defaults are exported
(`paintSky`, `paintGround`, `paintDino`…), so a style can be as small as a new `S.dino` and a palette, or a full
repaint. You can also skip `paintWorld` and walk `v.layers` yourself.

The world is a simulation, but it rebuilds itself when the Stage jumps or the Herd control changes a lot, so thumbnails
and slider drags are clean. Controls it already honours: Activity (pace, calling, hunting), Herd (numbers), Size
(zoom), Detail (plants, bands), Wind (plant sway), Light. Clicking makes the nearest animal call; dragging pans.

Engines that don't want the world (diagrams, close-ups, a museum, toys, the sea) use the rig directly.

## The frame object

| field | meaning |
|---|---|
| `f.ctx` | the context (same one `create` got) |
| `f.w`, `f.h` | canvas size in pixels (already includes the quality scale) |
| `f.t` | scene time in seconds, **already scaled by the Speed control** (Speed 0 freezes it). Animate with `f.t`. |
| `f.dt` | scaled seconds since the last frame (0 when frozen) |
| `f.clock` | real seconds, unscaled (only for things like flicker) |
| `f.stage`, `f.epoch`, `f.era` | deep time (above) |
| `f.combo` | true when a sky or volcano layer will show through your sky: leave sky pixels **transparent** (below) |
| `f.backdrop` | true when a Mega-Volcano scene is behind you: also leave out your own distant scenery |
| `f.p` | controls, all **0..1**: `stage`, `grow`, `activity`, `herd`, `scale`, `detail`, `wind`, `light`, `x1..x4` |
| `f.pointer` | `{ x, y }` in 0..1 (y down), `down`, `moved`, `dragX`, `dragY` accumulated drag in screen heights, `clicks` (array of `{x,y}` since the last frame) |
| `f.sig` | signals for Invisible Hands, or null: set `f.sig.step = 1` on a heavy footfall and `f.sig.roar = 1` on a call (the host fades them), `f.sig.count` and `f.sig.speed` 0..1. The world does this for you. |
| `f.opts` | the scene opts |

`energy(f)` (util.js) turns Activity into a 0.4..1.6 multiplier. **Size** (`p.scale`) is how close the view is.
**Wind** (`p.wind`, 0.5 = blowing right; `windX`, `windDir`) moves plants and dust. **Light** (`p.light`, 0 night →
~0.3 golden hour → 1 noon; `daylight(p.light)` gives `day`, `dusk`, `night` weights).

## Combos: keep the sky transparent when asked

Mega-Dino can put any Mega-Volcano scene behind the dinosaurs and any Mega-Clouds sky behind that. Both show through
wherever your picture is transparent. So when `f.combo` is true:

- **2D**: don't paint the sky. Call `sky(f)` (or `sky(f, (ctx, w, h) => yourSkyPainter())`) from `util.js`: it paints
  normally, but clears to transparent in a combo. `paintWorld` already does. Everything else (ground, plants, animals,
  dust) draws on top as usual. Skip your sun, moon and stars too (the layers bring their own). Low-res buffers made with
  `buffer()` have alpha: clear them the same way and `drawImage` keeps the transparency. Never paint the sky as a
  full-frame `fillRect` with alpha for trails, and use `globalCompositeOperation = 'source-atop'` for full-frame tints
  (night, paper grain, vignettes) so they only touch what is already painted.
- When `f.backdrop` is also true a volcano stands on the horizon: leave out mountains, far hills, the sea and anything
  else that would cover the area above your horizon line. Keep your horizon near 0.56 of the height so the two line up.
- **GL** (`shaderEngine` in `gl.js`): end `main()` with `finish(col, skyAmount)`, where `skyAmount` is 1 for open-sky
  pixels and 0 for anything solid. It writes alpha 1 normally and `1 - skyAmount` in a combo. `uBackdrop` is 1 when a
  volcano is behind.
- Engines with no open sky (`sky: false`) ignore both flags; the host lays clouds over the top instead, and a volcano
  cannot show.

Test it with `node tools/shot.mjs <engine> /tmp/x.png combo=1` (transparent pixels show as a checkerboard) and
`… backdrop=1`.

## Rules

- Draw the **whole** frame every call unless the engine deliberately keeps buffers.
- Look good on the very first frame, at any `t` (the host starts `t` at a random offset, and thumbnails render three
  frames at 384×216). If you keep particles or your own simulation, warm it up and rebuild it when the stage jumps by
  more than ~0.03 or `f.epoch` changes.
- Be resolution independent: size things relative to `f.h` / `f.w`, never fixed pixels.
- No network requests, no external libraries, no images. Plain ES modules. Text on the canvas is fine (system fonts).
- Be true to the science where you state facts: use the species' own `name`, `means`, `fact`, `len`, `ma`. Don't invent
  numbers. Pterosaurs and marine reptiles are not dinosaurs. No grass before the end of the Cretaceous, no flowers
  before the Early Cretaceous (`flora(f.era)` handles it), and no humans alongside (a human silhouette is fine as a
  scale figure in a diagram).
- `rng(seed)` gives correlated first values for nearby seeds; spread them first, e.g. `rng(Math.imul(i + 1, 2654435761))`.
- Hue/saturation/brightness/contrast/vignette/grain are applied by the host afterwards — don't duplicate them.
- Keep a frame under ~8 ms at 1280×720 for 2D, and make GL shaders scale with Detail.
- Only edit your own engine file. If you need a helper that isn't in the shared modules, put it in your file.

## Shader engines

`js/gl.js` exports `shaderEngine({ id, name, fs, params, res, sky, defaults })`. `fs` is GLSL ES 3.00 with a `main()`
that ends with `finish(col, skyAmount)` (or writes `outColor` itself with alpha 1). Prepended for you:

- uniforms `uRes uTime uClock uMouse uDrag uStage uEpoch uActivity uHerd uSize uDetail uWind uLight uX1..uX4 uSeed
  uCombo uBackdrop`
- noise: `noise2/3`, `fbm2/3(p, octaves)` (fractional octaves), `worley2/3`, `hash11/12/22/13`, `hsv2rgb`, `luma`, `rot2`,
  `windDir()`, `skyColor(rd, sun, day)`
- deep time: `Era E = era(uStage);` (fields `ma pangaea dry warm flowers giants meteor flash dark dinos ferns`),
  `energy()`, `finish(col, sky)`

Scene `opts` that are numbers become float `#define`s (`K: 0.5` → `#define K 0.50000`, `MODE: 2` → `#define MODE
2.00000`); a non-negative integer also defines a flag, `MODE: 2` → `#define MODE_2`. Arrays of 2–4 numbers become
`vecN`. Give every define a default in the engine's `defaults`.

To raymarch the animals, write a `kind: 'gl'` engine by hand with `compile(gl, fullscreenVS, HEADER + NOISE + DINO +
yourFS)` from `gl.js` and upload `capsules(pose(…))` as a uniform array each frame.

## Testing

- `node tools/shot.mjs <engine> /tmp/<engine>.png` renders every scene of the engine to one image (Playwright, headless,
  SwiftShader — slow GPU, so timings are pessimistic). Look at the image.
- `… stages=1` renders each scene at seven moments of deep time (0.06 0.25 0.43 0.6 0.86 0.897 0.97).
- `… combo=1` / `… backdrop=1` render with a transparent sky (checkerboard). Any control can be added: `"light=0.1&herd=1"`.
- `… "scene=<id>&w=960&h=540"` renders one scene larger.
- `node tools/smoke.mjs` runs the real app through every scene with layers on.
- `node tools/serve.mjs` serves the parent folder at http://localhost:8123/mega-dino/ so the combos work locally (it
  needs the sibling `mega-volcano` and `Mega-Clouds` clones).
