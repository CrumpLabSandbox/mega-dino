# Mega-Dino

A dinosaur simulator for the browser. Herds on the move, families at the nest, hunters and the hunted, walking through
180 million years from the first dinosaurs to the asteroid and the birds that came through it, in over two hundred
styles: natural, skeleton X-ray, raymarched 3D, low poly, voxel, pixel art, cartoon, toys, woodblock, cut paper,
posters, paintings, notebook sketches, text mode and neon, plus diagrams, fossils, pterosaur skies, Mesozoic seas and
the planet seen from orbit. It works as a gallery, a screensaver and a clean video source, and any scene can stand in
front of any [Mega-Volcano](https://crumplabsandbox.github.io/mega-volcano/) under any
[Mega-Clouds](https://crumplabsandbox.github.io/Mega-Clouds/) sky.

**Live:** https://crumplabsandbox.github.io/mega-dino/

No build step and no dependencies: plain ES modules, canvas 2D and WebGL2. Serve the folder with any static server and
open `index.html`. To use the volcano and cloud layers locally, serve the folder that holds all three clones
(`node tools/serve.mjs`, then open http://localhost:8123/mega-dino/).

## The engines

241 scenes across 24 engines:

| engine | what it is |
|---|---|
| Dinosaur Walk | the plain, natural view: herds, hunts, nests and loners in nine kinds of country |
| Families & Nests | nesting colonies, brooding, hatching, young in the middle of the herd, a wall of horns |
| Living Skeletons | the same animals as walking skeletons: X-ray, skin-to-bone scan line, anatomical plates, a museum at night |
| Dinosaur 3D | raymarched dinosaurs you can orbit, built from the same rig |
| From Above | herds from overhead: trackways, flocking, a river ford, a nesting colony, thermal camera |
| Pterosaur Skies | flying reptiles and early birds soaring, fishing and circling; made for cloud combos |
| Mesozoic Seas | ichthyosaurs, plesiosaurs, pliosaurs and mosasaurs among ammonites and reefs |
| Field Guide | animated diagrams: species cards, size chart, line-ups, a timeline, the family tree, who is a dinosaur |
| Fossils & Digs | rock layers, a dig site, death to discovery, famous slabs, amber, a museum drawer, a CT scan |
| Drifting Continents & the Impact | the globe from Pangaea onward, maps, and the Chicxulub impact from five viewpoints |
| Low Poly | faceted turntable dioramas, a paper model and a wireframe |
| Voxel | isometric block dinosaurs on block dioramas |
| Pixel Art | NES, Game Boy, C64, PICO-8, CGA, 1-bit Mac, 16-bit |
| Arcade & LCD | games that play themselves: endless runner, virtual pet, LCD handheld, vector arcade, a boss fight |
| Cartoon | picture book, cel, chibi, stickers, clay, crayon, a comic page |
| Toy Box | plastic figures, wooden pull-toys, wind-up tin, bricks, plush, balloons, a shoebox diorama |
| Woodblock & Ink | ukiyo-e, sumi-e, a scroll, linocut, engraving, porcelain, a Greek vase, a cave wall |
| Paper & Craft | cut paper, origami, stained glass, mosaic, felt, a pop-up book, quilling, a shadow box |
| Silhouettes & Sunsets | dark shapes against giant suns, fog, moonlight, lightning and aurora |
| Posters | national-park, art deco, Bauhaus, Swiss, Memphis, risograph, constructivist, minimal |
| Painterly | impressionist, pointillist, watercolour, impasto, gouache, a nocturne, a museum mural |
| Sketch & Notebook | field notebook, blueprint, chalkboard, ballpoint, charcoal, stipple, flip-book, anatomical study |
| Text Mode | ASCII, ANSI, Braille, Teletext, a typewriter, a species database terminal |
| Vector & Neon | synthwave, vector monitor, oscilloscope, vaporwave, glitch, thermal, a neon sign, a hologram, lasers |

## One model behind every scene

Everything is drawn from the same four pieces, so all the views agree:

- **Species** (`js/species.js`): 77 animals — 61 walking dinosaurs (two of them birds), 8 pterosaurs and early birds, 8
  marine reptiles — each with its length, mass, age, where it was found, what its name means and one fact.
- **The rig** (`js/rig.js`): one skeleton model that walks, runs, grazes, calls, rests and rears for every body plan,
  and hands engines the animal as shapes to style: skin, bones, a top view or 3D capsules.
- **The world** (`js/world.js`): terrain, era-correct plants and a cast that migrates, mills about, raises young, nests,
  hunts and stands its ground.
- **Deep time** (`js/time.js`): the **Era** control.

| Era | | |
|---|---|---|
| 0.00 | Late Triassic | the first dinosaurs: small, quick, two-legged, on Pangaea |
| 0.14 | Early and Middle Jurassic | dinosaurs spread and grow |
| 0.36 | Late Jurassic | giant sauropods, stegosaurs, Allosaurus, the first birds |
| 0.50 | Early Cretaceous | feathered raptors, iguanodonts, the first flowers |
| 0.68 | Late Cretaceous | tyrannosaurs, horned dinosaurs, duck-bills, ankylosaurs |
| 0.88 | The impact | a fireball, a flash, then darkness and ash |
| 0.94 | After | ferns on burnt ground; only the birds are left |

**Era** sets when a scene is; **Time travel** runs the whole story on a loop (from 10 minutes down to 20 seconds, and
slower through the impact so it can be watched; 0 stays put). Move Era on any scene and its animals are replaced by
whoever filled the same role at that time, and the plants change with them (no grass, and no flowers before the
Cretaceous). A caption names the era (`I` toggles it). [docs/SCIENCE.md](docs/SCIENCE.md) says what is known and what
is guessed; colours, mostly, are guessed.

## Using it

- **Gallery**: filter by tag or search, then click a scene.
- **Viewer**: drag to look around or orbit; click an animal to make it call (or to play, in the games). Press ⚙ for controls.
- **Controls** (all 0–1): Speed (0 freezes, the middle is real time, the top is a 16× time-lapse), Era, Time travel,
  Activity (sleepy → restless), Herd (how many), Size, Detail, Wind direction, Light (night → golden hour → noon), up
  to four scene-specific controls, and a Look section (hue, saturation, brightness, contrast, vignette, grain).
- **Screensaver**: the ⟳ menu changes scene every 15 s to 5 min with a crossfade. Shuffle respects the gallery filter.
- **Keys**: `←` `→` scene · `↑` `↓` clouds · `[` `]` volcano · `K` clouds on/off · `L` volcano on/off · `Space` pause ·
  `R` random · `I` captions · `F` full screen · `H` hide the HUD · `C` controls · `S` save a PNG · `V` record WebM ·
  `G`/`Esc` gallery.
- **Quality**: Auto lowers the render resolution until the frame rate holds, then raises it again.

## Dinosaurs + volcano + clouds

Mega-Dino loads the engines of [Mega-Volcano](https://github.com/CrumpLabSandbox/mega-volcano) and
[Mega-Clouds](https://github.com/CrumpLabSandbox/Mega-Clouds) straight from their sites (all three live on
`crumplabsandbox.github.io`), and stacks three live pictures: the sky at the back, the volcano in front of it, the
dinosaurs in front of both. Pick layers with 🌋 and ☁ in the viewer or the menus in the gallery, or press
**▶ Dinosaurs + volcano + clouds** for random combinations.

- **Volcano**: shows wherever the dinosaur scene has open sky. *Volcano size* and *Height* place it on the horizon;
  *Island stage* and *Eruption* take over its life cycle (or press *Run free*). Scenes with no sky (from above, under
  water, diagrams) cannot show one.
- **Clouds**: *Sky* puts them behind everything; *Mist* also lets their bright parts drift in front; *Over* lays them
  on top (the default for scenes with no sky); *Screen* blends the pictures.
- **Follow** (on by default): both layers take the scene's Light, Wind and Speed.
- Shuffle can change everything, only the dinosaurs, or only the layers behind them.

### Mix & Match

[`mix.html`](https://crumplabsandbox.github.io/mega-dino/mix.html) rolls random combinations of the three.
**🎲 Mix** (or `Space`) rolls every unlocked layer; ↻ rerolls one (`D`, `V`, `C`); 🔒 keeps one (`1`, `2`, `3`); ✕
switches the volcano or the clouds off (`X`, `Z`); ↶ goes back (`B`). It can roll the cloud layering too, roll on a
timer, and with **Wild** also roll the era, the island's stage, the time of day and the wind. The address always names
what is on screen (`?d=<dino id>&v=<volcano id>&c=<cloud id>`), so 🔗 copies a link to it and ⚙ opens it in the main
viewer with all its controls. `?room=<code>` passes an Invisible Hands room through to the picture.

## As a video source

URL parameters:

| parameter | effect |
|---|---|
| `scene=<id>` | open a scene (ids are shown by 🔗 *Copy link*) |
| `ui=0` | no HUD, no gallery, no captions: just the picture (H still toggles the HUD) |
| `shuffle=<seconds>` | screensaver mode |
| `stage=0.42`, `grow=0`, `activity=0.8`, `herd=1`, `light=0.3`, … | any control, 0–1 |
| `volcano=<volcano scene id \| random>` | put a Mega-Volcano scene behind |
| `vsize`, `vlift`, `vstage`, `vactivity`, `vlink=0` | volcano size, height, island stage, eruption, don't follow |
| `clouds=<cloud scene id \| random>` | add a Mega-Clouds sky |
| `cmode=sky \| mist \| over \| screen`, `camount`, `ccover`, `csize`, `clink=0` | cloud layering, strength, cover, size, don't follow |
| `captions=0` | hide the era caption |
| `quality=0.5 \| 0.75 \| 1 \| 1.5` | fix the render scale |
| `room=<code>` | join an Invisible Hands room |

Embedding: `window.megaDino` exposes `canvas` (the output, a WebGL2 canvas with `preserveDrawingBuffer`), `scenes`,
`era` (the current moment of deep time and its curves), `signals` (footfall, call, pace, count, brightness, motion),
`setScene(id)`, `set(control, value)`, `setVolcano(id)`, `setClouds(id, mode)`, `volcanoScenes`, `cloudScenes`,
`next()`, `prev()`, `random()`, `call()`, `pause()` and `measure()`. A page on the same origin, such as
[MEGA·CV](https://crumplabsandbox.github.io/mega-cv/), can iframe `?ui=0` and read that canvas each frame as a
texture. Any page can drive it with
`frame.contentWindow.postMessage({ megaDino: { scene: 'walk-trex', set: { stage: 0.42 }, volcano: 'random', clouds: 'random' } }, '*')`.
Screen capture of the tab works too.

## Invisible Hands

The **Hands** button joins an [Invisible Hands](https://github.com/samuelling/InvisibleHands) room (Sam Ling's
protocol, `js/vendor/invisible-hands.js`, copied unchanged from MEGA·CV), so other apps, MEGA·CV's Hands module for
one, can move the controls. It exposes every control (`speed`, `stage`, `grow`, `activity`, `herd`, `scale`, `detail`,
`wind`, `light`, `x1`–`x4`, the look controls), `scene` (0–1 across the list), `next` and `call` (triggers), `pause`
(toggle), the cloud layer (`clouds`: 0 = none, then every Mega-Clouds scene; `cloudnext`, `camount`, `ccover`,
`csize`) and the volcano layer (`volcano`, `volcanonext`, `vstage`, `vactivity`, `vsize`, `vlift`). It publishes
`step` (a pulse on each footfall of the biggest animal: a clock you can patch), `roar` (a pulse when something calls),
`pace`, `count`, `brightness`, `motion`, `era`, `alive` (drops to zero at the impact), `impact` and `scene`. Opening
the page with `?room=<code>` joins that room. While linked, the page holds a WebSocket to Sam's relay,
`invisible-hands.samuelling.workers.dev`.

## How it is built

```
index.html, css/style.css
mix.html           Mix & Match: random dinosaur + volcano + cloud combinations, driving the app in a frame
js/app.js          gallery, viewer, controls, deep time, layers, shuffle, recording, Invisible Hands, embed API
js/time.js         deep time (JS and GLSL): eras, the impact, what grows when
js/species.js      the animals and what is known about them; who stands in for whom at another time
js/rig.js          the walking skeleton: pose → skin parts, bones, top view, 3D capsules
js/swimfly.js      the same for pterosaurs, birds and marine reptiles
js/flora.js        Mesozoic plants and props in the same part format
js/world.js        the simulated world: terrain, plants, herds, families, hunts, nests, camera
js/draw.js         ready-made painters for parts and for the whole world
js/post.js         output stage: stacks clouds, volcano and dinosaurs, look controls, crossfades (one WebGL2 canvas)
js/layers.js       loads Mega-Clouds' and Mega-Volcano's engines from ../Mega-Clouds/ and ../mega-volcano/
js/registry.js     engine list, standard controls, defaults
js/gl.js           shaderEngine() helper and the GLSL noise library
js/util.js         2D helpers: noise, random, colour, sky
js/engines/*.js    one file per engine, each exporting the engine and its scenes
tools/             serve.mjs (local server), preview.html + shot.mjs (render an engine's scenes), smoke.mjs (app test),
                   lineup.html and others.html (every species, flyer, swimmer and plant on one sheet)
docs/              ENGINES.md (how to write an engine), SCIENCE.md (what is known and what is guessed)
```

An **engine** is a way of drawing dinosaurs; a **scene** is an engine plus presets. To add one, see
[docs/ENGINES.md](docs/ENGINES.md). `node tools/shot.mjs <engine> out.png stages=1` renders all its scenes at seven
moments of deep time to one image (needs Playwright).
