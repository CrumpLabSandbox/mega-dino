// Smoke test of the real app: open it, switch through every scene (with and without volcano and cloud layers), report errors.
//   node tools/smoke.mjs [out.png]
import { serve, playwright, base } from './serve.mjs';
const pw = await playwright();
const srv = await serve();
const out = process.argv[2] || '/tmp/mega-dino-smoke.png';
const b = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 300)); });
await p.goto(`http://localhost:${srv.address().port}${base}?scene=walk-trex`);
await p.waitForTimeout(2500);
const ids = await p.evaluate(() => window.megaDino.scenes.map(s => s.id));
const clouds = await p.evaluate(async () => { await window.megaDino.loadClouds(); return window.megaDino.cloudScenes.length; });
const vols = await p.evaluate(async () => { await window.megaDino.loadVolcano(); return window.megaDino.volcanoScenes.length; });
console.log('scenes:', ids.length, '· cloud scenes:', clouds, '· volcano scenes:', vols);
for (const [i, id] of ids.entries()) {
  const n = errs.length;
  await p.evaluate(id => window.megaDino.setScene(id), id);
  if (i % 4 === 0 && clouds) await p.evaluate(() => window.megaDino.setClouds('random'));
  if (i % 4 === 1 && vols) await p.evaluate(() => window.megaDino.setVolcano('random'));
  if (i % 4 === 3) await p.evaluate(() => { window.megaDino.setClouds(''); window.megaDino.setVolcano(''); });
  await p.waitForTimeout(150);
  if (errs.length > n) console.log('  after', id, '→', errs.slice(n).join(' | '));
}
await p.evaluate(() => { window.megaDino.setScene('walk-trex'); window.megaDino.setVolcano('island3d-shield'); return window.megaDino.setClouds('volumetric-cumulus'); });
await p.waitForTimeout(3000);
await p.screenshot({ path: out });
console.log(errs.length ? `${errs.length} errors/warnings:\n` + [...new Set(errs)].slice(0, 30).join('\n') : 'no errors');
await b.close(); srv.close();
