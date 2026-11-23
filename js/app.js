// Mega-Dino host: gallery, viewer, controls, screensaver shuffle, deep time, Mega-Clouds and Mega-Volcano combos,
// recording, Invisible Hands, and the embed API.
import { loadAll, defaultsFor, CONTROLS, LOOK, growRate } from './registry.js';
import { createOutput, MODES } from './post.js';
import { era, STAGES } from './time.js';
import { loadClouds, loadVolcano, CLOUDS_SITE, VOLCANO_SITE } from './layers.js';

const $ = s => document.querySelector(s);
const clamp = (v, lo = 0, hi = 1) => v < lo ? lo : v > hi ? hi : v;
const query = new URLSearchParams(location.search);
const EMBED = query.get('ui') === '0';
const EXTRA = ['x1', 'x2', 'x3', 'x4'];
const ALL_IDS = [...CONTROLS.map(c => c.id), ...EXTRA, ...LOOK.map(c => c.id)];
// Speed: 0 freezes, 0.5 is real time, 1 is 16×
const speedFactor = s => s < 0.02 ? 0 : Math.pow(2, (s - 0.5) * 8);

let scenes = [], engines = [];
let cur = null;           // current slot { scene, engine, canvas, ctx, inst, t, life }
let old = null;           // outgoing slot during a crossfade
let fadeT = 1, fadeDur = 1.5;
let params = {};          // live control values for the current scene
let paused = false, view = 'gallery';
let output;
let quality = 'auto', autoScale = 0.75;
let shuffleSec = 0, shuffleAt = 0, filterTag = 'all', searchText = '';
const pointer = { x: 0.5, y: 0.5, down: false, moved: false, dragX: 0, dragY: 0, clicks: [] };
let recorder = null, hands = null, lastMeasure = { luma: 0, white: 0, motion: 0 };
let shownStage = -1, captions = !EMBED && query.get('captions') !== '0';
// what the animals are doing, written by the scene each frame (see f.sig in docs/ENGINES.md); pulses decay here
const sig = { step: 0, roar: 0, count: 0, speed: 0 };

// Combo layers behind the dinosaurs (see post.js): a Mega-Clouds sky and a Mega-Volcano scene.
const mkLayer = extra => ({ lib: null, want: '', cur: null, old: null, mix: 1, link: true, ...extra });
const combo = mkLayer({
  mode: 'auto',           // 'auto' or one of MODES
  amount: 0.5,            // strength of the clouds in front (mist / over / screen)
  cover: null, size: null,// cloud Coverage and Size overrides (null = the cloud scene's own)
  shuffle: 'all',         // what the screensaver changes: all | dino | layers
});
const vol = mkLayer({
  stage: null,            // the island's life stage (null = the volcano scene's own, running its own growth)
  activity: null,         // eruption strength (null = the volcano scene's own)
  size: 0.36, lift: 0.78, // how big the volcano is drawn and how high it sits behind the dinosaurs
});
const comboOn = () => !!(combo.want && combo.cur);
const volOn = () => !!(vol.want && vol.cur);
const comboMode = (slot = cur) => combo.mode !== 'auto' ? combo.mode : slot?.engine.sky === false ? 'over' : 'sky';
const hasSky = slot => slot?.engine.sky !== false;

// ---------------------------------------------------------------- slots
function makeSlot(scene, layer = null) {
  const engine = scene.engine;
  const canvas = document.createElement('canvas');
  // everything except the cloud layer keeps an alpha channel so its sky can be transparent in a combo
  const alpha = layer !== 'clouds';
  const ctx = engine.kind === 'gl'
    ? canvas.getContext('webgl2', { alpha, antialias: false, preserveDrawingBuffer: false, premultipliedAlpha: false })
    : canvas.getContext('2d', { alpha });
  if (!ctx) throw new Error('Could not create a ' + engine.kind + ' context');
  const slot = { scene, engine, layer, canvas, ctx, inst: null, t: 20 + Math.random() * 80, nearest: !!engine.nearest, life: 0 };
  sizeSlot(slot);
  slot.inst = engine.create(ctx, scene.opts || {});
  return slot;
}
function disposeSlot(s) {
  if (!s) return;
  try { s.inst?.dispose?.(); } catch (e) { console.warn(e); }
  if (s.engine.kind === 'gl') s.ctx.getExtension('WEBGL_lose_context')?.loseContext();
  s.canvas.width = s.canvas.height = 1;
}
// the gallery backdrop is blurred, so it renders small; the layers behind are soft or distant, so they render smaller
function renderScale() { return view === 'gallery' ? 0.3 : quality === 'auto' ? autoScale : +quality; }
function sizeSlot(s) {
  const W = output.canvas.width, H = output.canvas.height;
  const k = renderScale() * (s.scene.res ?? s.engine.res ?? 1) * (s.layer === 'clouds' ? 0.8 : s.layer === 'volcano' ? 0.7 : 1);
  const w = Math.max(16, Math.round(W * k)), h = Math.max(9, Math.round(H * k));
  if (s.canvas.width !== w || s.canvas.height !== h) {
    s.canvas.width = w; s.canvas.height = h;
    s.inst?.resize?.(w, h);
  }
}
function sizeOutput() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  const cap = 1920 * 1200; if (w * h > cap) { const k = Math.sqrt(cap / (w * h)); w = Math.round(w * k); h = Math.round(h * k); }
  if (output.canvas.width !== w || output.canvas.height !== h) { output.canvas.width = w; output.canvas.height = h; }
  for (const s of [cur, old, combo.cur, combo.old, vol.cur, vol.old]) if (s) sizeSlot(s);
}

// ---------------------------------------------------------------- scene switching
function setScene(scene, { fade = true, keepParams = false } = {}) {
  if (!scene) return;
  let next;
  try { next = makeSlot(scene); }
  catch (e) { console.error(e); toast('Could not start ' + scene.name + ': ' + e.message); return; }
  if (old) disposeSlot(old);
  if (cur && fade && fadeDur > 0) { old = cur; old.params = params; fadeT = 0; } else { disposeSlot(cur); old = null; fadeT = 1; }
  cur = next;
  if (!keepParams) params = defaultsFor(scene.engine, scene);
  buildPanel();
  $('#s-name').textContent = scene.name;
  $('#s-engine').textContent = `${scene.engine.name} · ${scenes.indexOf(scene) + 1}/${scenes.length}`;
  $('#s-desc').textContent = scene.desc || '';
  document.title = scene.name + ' · Mega-Dino';
  pointer.dragX = pointer.dragY = 0;
  shuffleAt = performance.now() / 1000 + shuffleSec;
  shownStage = -1;
  hands?.describe();
  writeURL();
}
function pool() {
  const list = filtered();
  return list.length ? list : scenes;
}
function step(dir) {
  const list = pool(); const i = list.indexOf(cur?.scene);
  setScene(list[(i + dir + list.length) % list.length]);
}
function randomScene() {
  // with a volcano behind, prefer scenes that have a sky for it to show through
  let list = pool().filter(s => s !== cur?.scene);
  if (vol.want) { const open = list.filter(s => s.engine.sky !== false); if (open.length > 4) list = open; }
  setScene(list[Math.floor(Math.random() * list.length)] || scenes[0]);
}

// ---------------------------------------------------------------- combo layers
// want: '' (off), 'random' or a scene id of the layer's own app
async function setLayer(L, want, { fade = true } = {}) {
  const isVol = L === vol, label = isVol ? 'Mega-Volcano' : 'Mega-Clouds';
  L.want = want || '';
  if (!L.want) {
    disposeSlot(L.cur); disposeSlot(L.old); L.cur = L.old = null; L.mix = 1;
    syncLayerUI(); writeURL(); return;
  }
  if (!L.lib) {
    L.lib = await (isVol ? loadVolcano() : loadClouds());
    if (!L.lib) { L.want = ''; toast(label + ' could not be loaded'); syncLayerUI(); return; }
    fillLayerLists();
  }
  let list = L.lib.scenes;
  if (L.want === 'random' && isVol) list = list.filter(s => s.engine.sky !== false);     // a backdrop needs a horizon
  const scene = L.want === 'random'
    ? list.filter(s => s !== L.cur?.scene)[Math.floor(Math.random() * (list.length - 1))]
    : list.find(s => s.id === L.want);
  if (!scene) { L.want = ''; syncLayerUI(); return; }
  let next;
  try { next = makeSlot(scene, isVol ? 'volcano' : 'clouds'); }
  catch (e) { console.error(e); toast('Could not start ' + scene.name + ': ' + e.message); return; }
  if (L.old) disposeSlot(L.old);
  if (L.cur && fade && fadeDur > 0) { L.old = L.cur; L.mix = 0; } else { disposeSlot(L.cur); L.old = null; L.mix = 1; }
  L.cur = next;
  next.params = L.lib.defaultsFor(scene.engine, scene);
  syncLayerUI(); writeURL();
}
const setClouds = (want, o) => setLayer(combo, want, o);
const setVolcano = (want, o) => setLayer(vol, want, o);
function cloudParams(s) {
  const p = s.params;
  if (combo.cover != null) p.coverage = combo.cover;
  if (combo.size != null) p.scale = combo.size;
  if (combo.link) { p.light = params.light; p.wind = params.wind; p.speed = params.speed; }
  return p;
}
function volcanoParams(s) {
  const p = s.params;
  if (vol.stage != null) p.stage = vol.stage;
  if (vol.activity != null) p.activity = vol.activity;
  if (vol.link) { p.light = params.light; p.wind = params.wind; p.speed = params.speed; }
  return p;
}
function fillLayerLists() {
  for (const [L, sels, none, rnd] of [[combo, ['#c-clouds', '#g-clouds'], 'No clouds', 'Random clouds'], [vol, ['#c-volcano', '#g-volcano'], 'No volcano', 'Random volcano']]) {
    for (const sel of sels.map($)) {
      const keep = sel.value;
      sel.textContent = '';
      const add = (v, t, parent = sel) => { const o = document.createElement('option'); o.value = v; o.textContent = t; parent.append(o); };
      add('', none); add('random', rnd);
      if (L.lib) {
        const groups = {};
        for (const s of L.lib.scenes) (groups[s.engine.name] ||= []).push(s);
        for (const [name, list] of Object.entries(groups)) {
          const g = document.createElement('optgroup'); g.label = name;
          for (const s of list) add(s.id, s.name, g);
          sel.append(g);
        }
      }
      sel.value = keep;
    }
  }
}
function syncLayerUI() {
  for (const sel of [$('#c-clouds'), $('#g-clouds')]) if (sel.value !== combo.want) sel.value = combo.want;
  for (const sel of [$('#c-volcano'), $('#g-volcano')]) if (sel.value !== vol.want) sel.value = vol.want;
  $('#cloud-extra').hidden = !combo.want; $('#volcano-extra').hidden = !vol.want;
  $('#c-cmode').value = combo.mode;
  $('#s-clouds').textContent = comboOn() ? ' + ' + combo.cur.scene.name : '';
  $('#s-volcano').textContent = volOn() ? ' + ' + vol.cur.scene.name : '';
  $('#b-clouds').classList.toggle('lit', !!combo.want); $('#b-volcano').classList.toggle('lit', !!vol.want);
  const vals = { camount: combo.amount, ccover: combo.cover ?? combo.cur?.params?.coverage ?? 0.5, csize: combo.size ?? combo.cur?.params?.scale ?? 0.5,
    vstage: vol.stage ?? vol.cur?.params?.stage ?? 0.35, vactivity: vol.activity ?? vol.cur?.params?.activity ?? 0.5, vsize: vol.size, vlift: vol.lift };
  for (const [id, v] of Object.entries(vals)) { const el = $('#c-' + id); if (el) { el.value = v; el.nextSibling.textContent = Math.round(v * 100); } }
  $('#c-clink').checked = combo.link; $('#c-vlink').checked = vol.link;
  $('#c-cshuffle').value = combo.shuffle;
}

// ---------------------------------------------------------------- render loop
let last = performance.now(), frameMs = 16, slowFor = 0, fastFor = 0, fpsShown = 0, frames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.1, (now - last) / 1000); last = now;
  if (!cur) return;
  const t0 = performance.now();
  const sdt = paused ? 0 : dtReal * speedFactor(params.speed);
  const clouds = comboOn(), volcano = volOn() && hasSky(cur);
  sig.step *= Math.exp(-dtReal * 7); sig.roar *= Math.exp(-dtReal * 2.5);
  renderSlot(cur, sdt, now / 1000);
  if (old) {
    fadeT += dtReal / fadeDur;
    if (fadeT >= 1) { disposeSlot(old); old = null; fadeT = 1; }
    else renderSlot(old, sdt, now / 1000, true);
  }
  for (const [L, on, draw] of [[combo, clouds, renderCloud], [vol, volcano, renderVolcano]]) {
    if (!on) continue;
    draw(L.cur, sdt, now / 1000);
    if (L.old) {
      L.mix += dtReal / Math.max(fadeDur, 0.5);
      if (L.mix >= 1) { disposeSlot(L.old); L.old = null; L.mix = 1; }
      else draw(L.old, sdt, now / 1000);
    }
  }
  pointer.clicks.length = 0;
  output.draw(cur, old, fadeT, params, now / 1000,
    clouds ? { a: combo.cur, b: combo.old, mix: combo.mix, mode: comboMode(), amount: combo.amount } : null,
    volcano ? { a: vol.cur, b: vol.old, mix: vol.mix, scale: 0.55 + vol.size * 1.1, shift: (vol.lift - 0.5) * 0.6 } : null);
  // adaptive quality: keep the frame time under ~30 ms
  frameMs = frameMs * 0.95 + (performance.now() - t0 + (dtReal * 1000 > 40 ? dtReal * 1000 - 16 : 0)) * 0.05;
  if (quality === 'auto' && view === 'viewer' && !old && !combo.old && !vol.old) {
    if (frameMs > 30) { if (++slowFor > 45) { autoScale = Math.max(0.3, autoScale * 0.85); slowFor = 0; sizeOutput(); } } else slowFor = 0;
    if (frameMs < 10) { if (++fastFor > 240 && autoScale < 1) { autoScale = Math.min(1, autoScale * 1.12); fastFor = 0; sizeOutput(); } } else fastFor = 0;
  }
  if (++frames % 30 === 0) {
    const fps = Math.round(1000 / Math.max(1, (now - fpsShown) / 30)); fpsShown = now;
    if (view === 'viewer' && !$('#panel').hidden) $('#fps').textContent = `${fps} fps · ${cur.canvas.width}×${cur.canvas.height} render → ${output.canvas.width}×${output.canvas.height}`;
  }
  if (hands && frames % 12 === 0) lastMeasure = output.measure();
  if (frames % 10 === 0) showStage();
  if (shuffleSec > 0 && view === 'viewer' && !paused && now / 1000 > shuffleAt) shuffleStep();
}
function shuffleStep() {
  const layers = comboOn() || volOn(), what = layers ? combo.shuffle : 'dino';
  if (what !== 'dino') { if (combo.want) setClouds('random'); if (vol.want) setVolcano('random'); }
  if (what !== 'layers') randomScene(); else shuffleAt = performance.now() / 1000 + shuffleSec;
}
// where in deep time: the Era control plus however far Time travel has carried it since the scene started
function stageOf(s, p) {
  const x = p.stage + s.life;
  return { stage: x - Math.floor(x), epoch: Math.floor(x) };
}
function renderSlot(s, sdt, clock, outgoing) {
  sizeSlot(s);
  s.t += sdt;
  const p = s === cur ? params : (s.params ||= defaultsFor(s.engine, s.scene));
  // time travel slows to a quarter through the impact, so the fireball, flash and dark can be watched
  const at = stageOf(s, p).stage;
  s.life += sdt * growRate(p.grow) * (at > 0.866 && at < 0.93 ? 0.25 : 1);
  const { stage, epoch } = stageOf(s, p);
  const sky = hasSky(s), behind = volOn() && sky;
  const transparentSky = sky && (behind || (comboOn() && ['sky', 'mist'].includes(comboMode(s))));
  try {
    s.inst.render({ ctx: s.ctx, w: s.canvas.width, h: s.canvas.height, t: s.t, dt: sdt, clock, p, stage, epoch, era: era(stage),
      combo: transparentSky, backdrop: behind, sig: outgoing ? null : sig,
      pointer: outgoing ? { ...pointer, clicks: [] } : pointer, opts: s.scene.opts || {} });
  } catch (e) {
    if (!s.failed) { console.error(e); toast(s.scene.name + ': ' + e.message); s.failed = true; }
  }
}
const stillPointer = () => ({ x: 0.5, y: 0.5, down: false, moved: false, dragX: 0, dragY: 0, clicks: [] });
function renderCloud(s, sdt, clock) {
  sizeSlot(s);
  s.t += sdt;
  try {
    s.inst.render({ ctx: s.ctx, w: s.canvas.width, h: s.canvas.height, t: s.t, dt: sdt, clock, p: cloudParams(s), pointer: stillPointer(), opts: s.scene.opts || {} });
  } catch (e) {
    if (!s.failed) { console.error(e); toast('Clouds ' + s.scene.name + ': ' + e.message); s.failed = true; }
  }
}
function renderVolcano(s, sdt, clock) {
  sizeSlot(s);
  s.t += sdt;
  const p = volcanoParams(s), lib = vol.lib;
  if (vol.stage == null) s.life += sdt * lib.growRate(p.grow);
  const x = p.stage + s.life, stage = x - Math.floor(x);
  // the volcano's own sky is transparent when clouds are behind it
  const skyThrough = comboOn() && ['sky', 'mist'].includes(comboMode()) && s.engine.sky !== false;
  try {
    s.inst.render({ ctx: s.ctx, w: s.canvas.width, h: s.canvas.height, t: s.t, dt: sdt, clock, p, stage, epoch: Math.floor(x), life: lib.life(stage),
      combo: skyThrough, pointer: stillPointer(), opts: s.scene.opts || {} });
  } catch (e) {
    if (!s.failed) { console.error(e); toast('Volcano ' + s.scene.name + ': ' + e.message); s.failed = true; }
  }
}
function currentEra() { return cur ? era(stageOf(cur, params).stage) : era(params.stage ?? 0); }
function showStage() {
  if (!cur) return;
  const E = currentEra();
  const el = $('#stage');
  $('#stage-bar').style.left = (E.stage * 100).toFixed(1) + '%';
  el.hidden = !captions || view !== 'viewer' || cur.engine.captions === false;
  $('#stage-ma').textContent = E.ma > 66.5 || E.ma < 65.5 ? `${Math.round(E.ma)} million years ago` : '66 million years ago';
  if (E.index === shownStage) return;
  shownStage = E.index;
  $('#stage-name').textContent = `${E.index + 1}/${STAGES.length} · ${E.name}`;
  $('#stage-text').textContent = E.text;
}

// ---------------------------------------------------------------- controls panel
function slider(host, id, label, tip, get = () => params[id], set = v => { params[id] = v; }) {
  const row = document.createElement('div'); row.className = 'row';
  const lab = document.createElement('label'); lab.textContent = label; lab.htmlFor = 'c-' + id; if (tip) lab.title = tip;
  const inp = document.createElement('input'); inp.type = 'range'; inp.min = 0; inp.max = 1; inp.step = 0.001; inp.id = 'c-' + id; inp.value = get();
  const out = document.createElement('output'); out.textContent = Math.round(get() * 100);
  inp.oninput = () => { set(+inp.value); out.textContent = Math.round(+inp.value * 100); hands?.recenter(id); writeURLSoon(); };
  inp.ondblclick = () => { if (ALL_IDS.includes(id)) { params[id] = defaultsFor(cur.engine, cur.scene)[id]; syncSliders(); writeURLSoon(); } };
  if (hands) lab.append(hands.tag(id));
  row.append(lab, inp, out); host.append(row);
  return row;
}
function buildPanel() {
  const main = $('#ctl-main'), extra = $('#ctl-extra'), look = $('#ctl-look');
  main.textContent = extra.textContent = look.textContent = '';
  for (const c of CONTROLS) slider(main, c.id, c.label, c.tip);
  const ex = cur.engine.params || [];
  for (const x of ex) slider(extra, x.id, x.label, x.tip);
  $('#h-extra').hidden = !ex.length;
  for (const c of LOOK) slider(look, c.id, c.label);
}
function buildLayerPanels() {
  const c = $('#cloud-sliders'); c.textContent = '';
  slider(c, 'camount', 'In front', 'How strongly the clouds drift in front of the picture (Mist, Over and Screen modes)', () => combo.amount, v => { combo.amount = v; });
  slider(c, 'ccover', 'Cloud cover', 'Coverage of the cloud scene', () => combo.cover ?? 0.5, v => { combo.cover = v; });
  slider(c, 'csize', 'Cloud size', 'Size of the clouds', () => combo.size ?? 0.5, v => { combo.size = v; });
  const v = $('#volcano-sliders'); v.textContent = '';
  slider(v, 'vsize', 'Volcano size', 'How big the volcano is drawn behind the dinosaurs', () => vol.size, x => { vol.size = x; });
  slider(v, 'vlift', 'Height', 'How high the volcano sits: raise it to put its waterline on the dinosaurs’ horizon', () => vol.lift, x => { vol.lift = x; });
  slider(v, 'vstage', 'Island stage', 'The volcano’s life: seamount → breaching → shield → caldera → erosion → sinking → atoll. Moving this holds it there', () => vol.stage ?? 0.35, x => { vol.stage = x; });
  slider(v, 'vactivity', 'Eruption', 'How hard the volcano erupts', () => vol.activity ?? 0.5, x => { vol.activity = x; });
}
function syncSliders() {
  for (const id of ALL_IDS) { const el = $('#c-' + id); if (el) { el.value = params[id]; el.nextSibling.textContent = Math.round(params[id] * 100); } }
}
function labelFor(id) {
  const c = CONTROLS.find(c => c.id === id) || LOOK.find(c => c.id === id) || (cur?.engine.params || []).find(c => c.id === id);
  return c ? c.label : null;
}

// ---------------------------------------------------------------- URL state
function writeURL() {
  if (view !== 'viewer' || !cur) return;
  const q = new URLSearchParams();
  q.set('scene', cur.scene.id);
  const def = defaultsFor(cur.engine, cur.scene);
  for (const id of ALL_IDS) if (params[id] !== undefined && Math.abs(params[id] - def[id]) > 0.004) q.set(id, params[id].toFixed(3));
  if (combo.want) {
    q.set('clouds', combo.want);
    if (combo.mode !== 'auto') q.set('cmode', combo.mode);
    if (Math.abs(combo.amount - 0.5) > 0.004) q.set('camount', combo.amount.toFixed(3));
    if (combo.cover != null) q.set('ccover', combo.cover.toFixed(3));
    if (combo.size != null) q.set('csize', combo.size.toFixed(3));
    if (!combo.link) q.set('clink', '0');
  }
  if (vol.want) {
    q.set('volcano', vol.want);
    if (vol.stage != null) q.set('vstage', vol.stage.toFixed(3));
    if (vol.activity != null) q.set('vactivity', vol.activity.toFixed(3));
    if (Math.abs(vol.size - 0.36) > 0.004) q.set('vsize', vol.size.toFixed(3));
    if (Math.abs(vol.lift - 0.78) > 0.004) q.set('vlift', vol.lift.toFixed(3));
    if (!vol.link) q.set('vlink', '0');
  }
  if (EMBED) q.set('ui', '0');
  if (!captions && !EMBED) q.set('captions', '0');
  if (shuffleSec) q.set('shuffle', shuffleSec);
  if (hands?.room) q.set('room', hands.room);
  history.replaceState(null, '', '?' + q.toString().replace(/%2C/g, ','));
}
let urlTimer = 0;
function writeURLSoon() { clearTimeout(urlTimer); urlTimer = setTimeout(writeURL, 300); }

// ---------------------------------------------------------------- views
function showViewer(scene) {
  view = 'viewer';
  document.body.classList.remove('gallery-mode');
  $('#gallery').hidden = true; $('#hud').hidden = EMBED;
  if (scene && scene !== cur?.scene) setScene(scene, { fade: false });
  shownStage = -1;
  sizeOutput();
  writeURL(); wake();
}
function showGallery() {
  view = 'gallery';
  document.body.classList.add('gallery-mode');
  $('#gallery').hidden = false; $('#hud').hidden = true; $('#stage').hidden = true;
  history.replaceState(null, '', location.pathname);
  document.title = 'Mega-Dino';
  thumbs.kick();
}

// gallery grid + filters
function filtered() {
  const q = searchText.trim().toLowerCase();
  return scenes.filter(s => (filterTag === 'all' || s.tags.includes(filterTag)) &&
    (!q || (s.name + ' ' + s.desc + ' ' + s.tags.join(' ') + ' ' + s.engine.name).toLowerCase().includes(q)));
}
function buildGallery() {
  $('#count').textContent = scenes.length;
  const counts = {};
  for (const s of scenes) for (const t of s.tags) counts[t] = (counts[t] || 0) + 1;
  const tags = Object.keys(counts).filter(t => counts[t] >= 2).sort((a, b) => counts[b] - counts[a]);
  const chips = $('#chips'); chips.textContent = '';
  for (const t of ['all', ...tags]) {
    const b = document.createElement('button'); b.className = 'chip'; b.setAttribute('aria-pressed', t === filterTag);
    b.innerHTML = `${t}<small>${t === 'all' ? scenes.length : counts[t]}</small>`;
    b.onclick = () => { filterTag = t; chips.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c === b)); drawGrid(); };
    chips.append(b);
  }
  drawGrid();
}
function drawGrid() {
  const grid = $('#grid'); grid.textContent = '';
  thumbs.reset();
  for (const s of filtered()) {
    const card = document.createElement('button'); card.className = 'card'; card.title = s.desc || s.name;
    const c = document.createElement('canvas'); c.width = 384; c.height = 216;
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.innerHTML = `<strong></strong><span></span>`;
    meta.firstChild.textContent = s.name; meta.lastChild.textContent = s.engine.name;
    const desc = document.createElement('div'); desc.className = 'desc'; desc.textContent = s.desc || '';
    card.append(c, desc, meta);
    card.onclick = () => showViewer(s);
    grid.append(card);
    thumbs.watch(c, s);
  }
}

// Thumbnails: render one frame of each visible card on two shared canvases (one WebGL2, one 2D), one per idle slice.
const thumbs = (() => {
  const W = 384, H = 216, cache = new Map();
  let queue = [], busy = false, io = null, glc = null, c2 = null;
  function ctxFor(kind) {
    if (kind === 'gl') {
      if (!glc || glc.ctx.isContextLost()) { const c = document.createElement('canvas'); c.width = W; c.height = H; glc = { c, ctx: c.getContext('webgl2', { preserveDrawingBuffer: true, alpha: false }) }; }
      return glc;
    }
    if (!c2) { const c = document.createElement('canvas'); c.width = W; c.height = H; c2 = { c, ctx: c.getContext('2d', { alpha: false }) }; }
    return c2;
  }
  function paint(target, s) {
    const g = target.getContext('2d');
    if (cache.has(s.id)) { g.drawImage(cache.get(s.id), 0, 0); return; }
    const { c, ctx } = ctxFor(s.engine.kind);
    let inst;
    try {
      inst = s.engine.create(ctx, s.opts || {});
      const p = defaultsFor(s.engine, s);
      const E = era(p.stage);
      for (let i = 0; i < (s.engine.kind === 'gl' ? 1 : 3); i++) inst.render({ ctx, w: W, h: H, t: 30 + i / 30, dt: 1 / 30, clock: 30 + i / 30, p, stage: p.stage, epoch: 0, era: E, combo: false, backdrop: false, sig: null, pointer: stillPointer(), opts: s.opts || {} });
      const keep = document.createElement('canvas'); keep.width = W; keep.height = H; keep.getContext('2d').drawImage(c, 0, 0);
      cache.set(s.id, keep); g.drawImage(keep, 0, 0);
    } catch (e) { console.warn('thumb', s.id, e); g.fillStyle = '#16241a'; g.fillRect(0, 0, W, H); }
    try { inst?.dispose?.(); } catch {}
  }
  function pump() {
    if (busy || !queue.length) return;
    busy = true;
    const go = () => {
      const t0 = performance.now();
      while (queue.length && performance.now() - t0 < 30) { const { el, s } = queue.shift(); if (el.isConnected) paint(el, s); }
      busy = false; if (queue.length) setTimeout(pump, 0);
    };
    (window.requestIdleCallback || setTimeout)(go, { timeout: 100 });
  }
  return {
    reset() { queue = []; io?.disconnect(); io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); queue.push(e.target._q); } pump(); }, { rootMargin: '300px' }); },
    watch(el, s) { el._q = { el, s }; io.observe(el); },
    kick: pump
  };
})();

// ---------------------------------------------------------------- HUD behaviour
let idleTimer = 0;
function wake() {
  $('#hud').classList.remove('idle'); document.body.classList.remove('hide-cursor');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (view === 'viewer' && $('#panel').hidden) { $('#hud').classList.add('idle'); document.body.classList.add('hide-cursor'); } }, 3000);
}
let toastTimer = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400); }

function togglePause() { paused = !paused; $('#b-pause').textContent = paused ? '▶' : '❚❚'; toast(paused ? 'Paused' : 'Playing'); }
function toggleFull() { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); }
function toggleCaptions() { captions = !captions; shownStage = -1; showStage(); toast(captions ? 'Era captions on' : 'Era captions off'); writeURL(); }
function snapshot() {
  output.canvas.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${cur.scene.id}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
  toast('Saved PNG');
}
function toggleRecord() {
  const b = $('#b-rec');
  if (recorder) { recorder.stop(); return; }
  const stream = output.canvas.captureStream(30);
  const type = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t));
  recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 12e6 });
  const chunks = [];
  recorder.ondataavailable = e => chunks.push(e.data);
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType }); recorder = null; b.classList.remove('on');
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${cur.scene.id}.${type.includes('mp4') ? 'mp4' : 'webm'}`; a.click();
    toast('Recording saved');
  };
  recorder.start(); b.classList.add('on'); toast('Recording… press again to stop');
}

function bindUI() {
  $('#b-gallery').onclick = showGallery;
  $('#b-prev').onclick = () => step(-1);
  $('#b-next').onclick = () => step(1);
  $('#b-random').onclick = randomScene;
  $('#b-pause').onclick = togglePause;
  $('#b-full').onclick = toggleFull;
  $('#b-snap').onclick = snapshot;
  $('#b-rec').onclick = toggleRecord;
  $('#b-cap').onclick = toggleCaptions;
  $('#b-panel').onclick = () => { $('#panel').hidden = !$('#panel').hidden; wake(); };
  $('#b-clouds').onclick = () => { $('#panel').hidden = false; $('#cloud-sec').scrollIntoView({ block: 'start' }); if (!combo.want) setClouds('random'); };
  $('#b-volcano').onclick = () => { $('#panel').hidden = false; $('#volcano-sec').scrollIntoView({ block: 'start' }); if (!vol.want) setVolcano('random'); };
  $('#b-link').onclick = () => { writeURL(); navigator.clipboard?.writeText(location.href).then(() => toast('Link copied'), () => toast(location.href)); };
  $('#b-reset').onclick = () => { params = defaultsFor(cur.engine, cur.scene); cur.life = 0; syncSliders(); pointer.dragX = pointer.dragY = 0; writeURL(); };
  $('#b-dice').onclick = () => { for (const c of [...CONTROLS, ...(cur.engine.params || [])]) if (!['speed', 'grow', 'stage'].includes(c.id)) params[c.id] = clamp(params[c.id] + (Math.random() - 0.5) * 0.6); params.hue = Math.random() < 0.3 ? Math.random() : 0; syncSliders(); writeURL(); };
  $('#b-shuffle').onchange = e => setShuffle(+e.target.value);
  $('#quality').onchange = e => { quality = e.target.value; if (quality === 'auto') autoScale = 0.75; sizeOutput(); };
  $('#fade').onchange = e => { fadeDur = +e.target.value; };
  $('#g-shuffle').onclick = () => { setShuffle(shuffleSec || 30); showViewer(); randomScene(); };
  $('#g-combo').onclick = () => { combo.shuffle = 'all'; setClouds('random', { fade: false }); setVolcano('random', { fade: false }); setShuffle(shuffleSec || 30); showViewer(); randomScene(); };
  $('#g-clouds').onchange = e => setClouds(e.target.value, { fade: false });
  $('#g-volcano').onchange = e => setVolcano(e.target.value, { fade: false });
  $('#c-clouds').onchange = e => setClouds(e.target.value);
  $('#c-volcano').onchange = e => setVolcano(e.target.value);
  $('#c-cmode').onchange = e => { combo.mode = e.target.value; writeURL(); };
  $('#c-clink').onchange = e => { combo.link = e.target.checked; writeURL(); };
  $('#c-vlink').onchange = e => { vol.link = e.target.checked; writeURL(); };
  $('#c-cshuffle').onchange = e => { combo.shuffle = e.target.value; };
  $('#c-cnext').onclick = () => setClouds(combo.want === 'random' ? 'random' : nextId(combo, 1));
  $('#c-vnext').onclick = () => setVolcano(vol.want === 'random' ? 'random' : nextId(vol, 1));
  $('#c-vfree').onclick = () => { vol.stage = vol.activity = null; syncLayerUI(); writeURL(); toast('The volcano runs its own life again'); };
  $('#search').oninput = e => { searchText = e.target.value; drawGrid(); };

  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) addEventListener(ev, () => { if (view === 'viewer') wake(); }, { passive: true });
  const cv = output.canvas;
  let dragging = false, lx = 0, ly = 0, downAt = 0, moved = 0;
  cv.addEventListener('pointerdown', e => { dragging = true; lx = e.clientX; ly = e.clientY; downAt = performance.now(); moved = 0; pointer.down = true; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    pointer.x = e.clientX / innerWidth; pointer.y = e.clientY / innerHeight; pointer.moved = true;
    if (dragging) { const dx = (e.clientX - lx) / innerHeight, dy = (e.clientY - ly) / innerHeight; pointer.dragX += dx; pointer.dragY += dy; moved += Math.abs(dx) + Math.abs(dy); lx = e.clientX; ly = e.clientY; }
  });
  const up = () => { if (dragging && moved < 0.01 && performance.now() - downAt < 400) pointer.clicks.push({ x: pointer.x, y: pointer.y }); dragging = false; pointer.down = false; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('dblclick', toggleFull);

  addEventListener('keydown', e => {
    if (e.target.matches('input[type=search], input[type=text], select')) return;
    if (view !== 'viewer') return;
    const k = e.key.toLowerCase();
    if (k === 'arrowright') step(1); else if (k === 'arrowleft') step(-1);
    else if (k === 'arrowup') setClouds(combo.want ? nextId(combo, -1) : 'random');
    else if (k === 'arrowdown') setClouds(combo.want ? nextId(combo, 1) : 'random');
    else if (k === '[') setVolcano(vol.want ? nextId(vol, -1) : 'random');
    else if (k === ']') setVolcano(vol.want ? nextId(vol, 1) : 'random');
    else if (k === ' ') { e.preventDefault(); togglePause(); }
    else if (k === 'f') toggleFull();
    else if (k === 'h') { $('#hud').hidden = !$('#hud').hidden; }
    else if (k === 'c') $('#b-panel').click();
    else if (k === 'k') setClouds(combo.want ? '' : 'random');
    else if (k === 'l') setVolcano(vol.want ? '' : 'random');
    else if (k === 'i') toggleCaptions();
    else if (k === 'r') randomScene();
    else if (k === 's') snapshot();
    else if (k === 'v') toggleRecord();
    else if (k === 'g' || k === 'escape') { if (k === 'escape' && document.fullscreenElement) return; showGallery(); }
  });
  addEventListener('resize', sizeOutput);
}
function nextId(L, dir) {
  const list = L.lib?.scenes || [];
  if (!list.length) return 'random';
  const i = list.indexOf(L.cur?.scene);
  return list[(i + dir + list.length) % list.length].id;
}
function setShuffle(sec) {
  shuffleSec = sec; $('#b-shuffle').value = String(sec);
  shuffleAt = performance.now() / 1000 + sec;
  if (sec) toast(`Screensaver: new scene every ${sec < 60 ? sec + ' s' : sec / 60 + ' min'}`);
  writeURL();
}

// ---------------------------------------------------------------- Invisible Hands
function setupHands() {
  if (!window.InvisibleHands) return;
  const syncSlider = id => { const el = $('#c-' + id); if (el) { el.value = params[id]; el.nextSibling.textContent = Math.round(params[id] * 100); } };
  const ctl = id => ({ id, get label() { return labelFor(id) || id; }, get: () => params[id] ?? 0, set: v => { params[id] = v; syncSlider(id); } });
  const sceneCtl = {
    id: 'scene', label: 'Scene',
    get: () => scenes.length > 1 ? Math.max(0, scenes.indexOf(cur?.scene)) / (scenes.length - 1) : 0,
    set: v => { const s = scenes[Math.round(clamp(v) * (scenes.length - 1))]; if (s && s !== cur?.scene) setScene(s); }
  };
  // 0 = none, then every scene of the layer's app in order
  const layerCtl = (L, id, label, load) => ({
    id, label,
    get: () => { const l = L.lib?.scenes || []; return L.want && L.cur && l.length ? (l.indexOf(L.cur.scene) + 1) / l.length : 0; },
    set: async v => {
      if (!L.lib) L.lib = await load();
      const l = L.lib?.scenes || []; const i = Math.round(clamp(v) * l.length);
      const sid = i === 0 ? '' : l[i - 1]?.id;
      if (sid !== (L.want && L.cur ? L.cur.scene.id : '')) setLayer(L, sid);
    }
  });
  const val = (L, id, label, key, dflt = 0.5) => ({ id, label, get: () => L[key] ?? dflt, set: v => { L[key] = v; syncLayerUI(); } });
  const trig = (id, label, fn) => { let held = 0; return { id, label, kind: 'trig', get: () => held, set: v => { if (v > 0.5 && held <= 0.5) fn(); held = v; } }; };
  hands = window.InvisibleHands.create({
    app: 'mega-dino', name: 'Mega-Dino',
    params: [
      ...CONTROLS.map(c => ctl(c.id)),
      ...EXTRA.map(ctl),
      ...LOOK.map(c => ctl(c.id)),
      sceneCtl,
      trig('next', 'Next scene', () => step(1)),
      { id: 'pause', label: 'Pause', kind: 'toggle', get: () => paused ? 1 : 0, set: v => { if ((v > 0.5) !== paused) togglePause(); } },
      trig('call', 'Make them call', () => { pointer.clicks.push({ x: 0.3 + Math.random() * 0.4, y: 0.7 }); }),
      layerCtl(combo, 'clouds', 'Clouds (Mega-Clouds scene)', loadClouds),
      trig('cloudnext', 'Next clouds', () => setClouds('random')),
      val(combo, 'camount', 'Clouds in front', 'amount'),
      val(combo, 'ccover', 'Cloud cover', 'cover'),
      val(combo, 'csize', 'Cloud size', 'size'),
      layerCtl(vol, 'volcano', 'Volcano (Mega-Volcano scene)', loadVolcano),
      trig('volcanonext', 'Next volcano', () => setVolcano('random')),
      val(vol, 'vstage', 'Volcano island stage', 'stage', 0.35),
      val(vol, 'vactivity', 'Volcano eruption', 'activity'),
      val(vol, 'vsize', 'Volcano size', 'size'),
      val(vol, 'vlift', 'Volcano height', 'lift'),
    ],
    outs: [
      { id: 'brightness', label: 'Brightness', get: () => lastMeasure.luma },
      { id: 'motion', label: 'Motion in the picture', get: () => lastMeasure.motion },
      { id: 'step', label: 'Footfall of the biggest animal (pulse)', get: () => clamp(sig.step) },
      { id: 'roar', label: 'A call or roar (pulse)', get: () => clamp(sig.roar) },
      { id: 'pace', label: 'How fast the biggest animal moves', get: () => clamp(sig.speed) },
      { id: 'count', label: 'Animals in view', get: () => clamp(sig.count) },
      { id: 'era', label: 'Deep time (Era)', get: () => currentEra().stage },
      { id: 'alive', label: 'Dinosaurs alive (drops at the impact)', get: () => currentEra().dinos },
      { id: 'impact', label: 'Impact flash and darkness', get: () => clamp(currentEra().flash + currentEra().dark) },
      { id: 'scene', label: 'Scene', get: () => sceneCtl.get() },
    ]
  });
  hands.on('status', () => writeURLSoon());
  $('#hands-slot').append(hands.badge({ label: 'Hands' }));
}

// ---------------------------------------------------------------- embed API (MEGA·CV and other hosts)
// Same-origin pages (e.g. crumplabsandbox.github.io/mega-cv) can iframe this page with ?ui=0 and read
// iframe.contentWindow.megaDino.canvas directly; any page can drive it with postMessage:
//   frame.postMessage({ megaDino: { scene: 'walk-trex', set: { stage: 0.4 }, clouds: 'random', volcano: 'random' } }, '*')
function exposeAPI() {
  const brief = s => ({ id: s.id, name: s.name, engine: s.engine.id, engineName: s.engine.name, tags: s.tags, sky: s.engine.sky !== false });
  const api = {
    get canvas() { return output.canvas; },
    get scenes() { return scenes.map(brief); },
    get scene() { return cur?.scene.id; },
    get params() { return { ...params }; },
    get era() { return currentEra(); },
    get signals() { return { ...sig, ...lastMeasure }; },
    get clouds() { return comboOn() ? combo.cur.scene.id : ''; },
    get volcano() { return volOn() ? vol.cur.scene.id : ''; },
    get cloudScenes() { return (combo.lib?.scenes || []).map(brief); },
    get volcanoScenes() { return (vol.lib?.scenes || []).map(brief); },
    loadClouds: async () => { combo.lib ||= await loadClouds(); if (combo.lib) fillLayerLists(); return !!combo.lib; },
    loadVolcano: async () => { vol.lib ||= await loadVolcano(); if (vol.lib) fillLayerLists(); return !!vol.lib; },
    setScene(id) { const s = scenes.find(s => s.id === id) || scenes[+id]; if (s) { if (view !== 'viewer') showViewer(s); else setScene(s); } return !!s; },
    set(id, v) {
      if (ALL_IDS.includes(id)) { params[id] = clamp(+v); if (id === 'stage' && cur) cur.life = 0; syncSliders(); }
      else if (id === 'camount') combo.amount = clamp(+v); else if (id === 'ccover') combo.cover = clamp(+v); else if (id === 'csize') combo.size = clamp(+v);
      else if (id === 'vstage') vol.stage = clamp(+v); else if (id === 'vactivity') vol.activity = clamp(+v); else if (id === 'vsize') vol.size = clamp(+v); else if (id === 'vlift') vol.lift = clamp(+v);
    },
    setClouds: (id, mode) => { if (mode) combo.mode = MODES.includes(mode) ? mode : 'auto'; return setClouds(id); },
    setVolcano: id => setVolcano(id),
    next() { step(1); }, prev() { step(-1); }, random() { randomScene(); },
    pause(on = true) { if (paused !== on) togglePause(); },
    call() { pointer.clicks.push({ x: 0.3 + Math.random() * 0.4, y: 0.7 }); },
    measure: () => lastMeasure
  };
  window.megaDino = api;
  addEventListener('message', e => {
    const m = e.data && e.data.megaDino; if (!m || typeof m !== 'object') return;
    if (m.scene) api.setScene(m.scene);
    if (m.set && typeof m.set === 'object') for (const [k, v] of Object.entries(m.set)) api.set(k, v);
    if ('clouds' in m) api.setClouds(String(m.clouds || ''), m.cloudMode);
    if ('volcano' in m) api.setVolcano(String(m.volcano || ''));
    if (m.next) api.next(); if (m.prev) api.prev(); if (m.random) api.random(); if (m.call) api.call();
    if ('pause' in m) api.pause(!!m.pause);
  });
}

// ---------------------------------------------------------------- boot
async function boot() {
  try { output = createOutput($('#out')); }
  catch (e) { $('#err').hidden = false; $('#err').textContent = 'Mega-Dino needs WebGL2: ' + e.message; return; }
  sizeOutput();
  ({ scenes, engines } = await loadAll());
  if (!scenes.length) { $('#err').hidden = false; $('#err').textContent = 'No scenes loaded.'; return; }
  setupHands();
  bindUI();
  exposeAPI();
  buildGallery();
  buildLayerPanels();
  fillLayerLists();
  $('#clouds-site').href = CLOUDS_SITE; $('#volcano-site').href = VOLCANO_SITE;
  const want = query.get('scene');
  const first = scenes.find(s => s.id === want);
  // the gallery's backdrop is a live scene, blurred
  setScene(first || scenes.find(s => s.id === 'walk-trex') || scenes[0], { fade: false });
  if (first) {
    for (const id of ALL_IDS) if (query.has(id)) params[id] = clamp(+query.get(id));
    syncSliders();
  }
  if (query.get('quality')) { quality = query.get('quality'); $('#quality').value = quality; }
  if (query.has('cmode')) combo.mode = MODES.includes(query.get('cmode')) ? query.get('cmode') : 'auto';
  for (const [k, L, key] of [['camount', combo, 'amount'], ['ccover', combo, 'cover'], ['csize', combo, 'size'], ['vstage', vol, 'stage'], ['vactivity', vol, 'activity'], ['vsize', vol, 'size'], ['vlift', vol, 'lift']])
    if (query.has(k)) L[key] = clamp(+query.get(k));
  if (query.get('clink') === '0') combo.link = false;
  if (query.get('vlink') === '0') vol.link = false;
  const sh = +query.get('shuffle'); if (sh) setShuffle(sh);
  if (first || EMBED || sh) { showViewer(); if (sh && !first) randomScene(); } else showGallery();
  // load the sister apps in the background so the menus fill in; start a combo if the link asks for one
  loadClouds().then(lib => {
    combo.lib = lib;
    document.body.classList.toggle('no-clouds', !lib);
    fillLayerLists();
    if (lib && query.get('clouds')) setClouds(query.get('clouds'), { fade: false }); else syncLayerUI();
  });
  loadVolcano().then(lib => {
    vol.lib = lib;
    document.body.classList.toggle('no-volcano', !lib);
    fillLayerLists();
    if (lib && query.get('volcano')) setVolcano(query.get('volcano'), { fade: false }); else syncLayerUI();
  });
  requestAnimationFrame(frame);
}
boot();
