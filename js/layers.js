// Bridges to the sister apps: loads Mega-Clouds' and Mega-Volcano's engines straight from their own sites so any sky
// and any volcano can sit behind any dinosaur scene. All three live on crumplabsandbox.github.io, so ../Mega-Clouds/
// and ../mega-volcano/ are the same origin. Locally, serve the folder that holds the clones (see README).
// ?clouds-base=<url> / ?volcano-base=<url> point somewhere else (it must send CORS headers for ES modules).

const query = new URLSearchParams(location.search);
export const CLOUDS_BASE = new URL(query.get('clouds-base') || '../Mega-Clouds/', location.href).href;
export const VOLCANO_BASE = new URL(query.get('volcano-base') || '../mega-volcano/', location.href).href;
export const CLOUDS_SITE = 'https://crumplabsandbox.github.io/Mega-Clouds/';
export const VOLCANO_SITE = 'https://crumplabsandbox.github.io/mega-volcano/';

let clouds = null, volcano = null;
// → { scenes, engines, defaultsFor } or null when Mega-Clouds can't be reached
export function loadClouds() {
  clouds ||= import(CLOUDS_BASE + 'js/registry.js').then(async reg => {
    const { scenes, engines } = await reg.loadAll();
    return scenes.length ? { scenes, engines, defaultsFor: reg.defaultsFor } : null;
  }).catch(err => { console.warn('Mega-Clouds not available:', err.message); return null; });
  return clouds;
}
// → { scenes, engines, defaultsFor, growRate, life } or null when Mega-Volcano can't be reached
export function loadVolcano() {
  volcano ||= Promise.all([import(VOLCANO_BASE + 'js/registry.js'), import(VOLCANO_BASE + 'js/life.js')]).then(async ([reg, lf]) => {
    const { scenes, engines } = await reg.loadAll();
    return scenes.length ? { scenes, engines, defaultsFor: reg.defaultsFor, growRate: reg.growRate, life: lf.life } : null;
  }).catch(err => { console.warn('Mega-Volcano not available:', err.message); return null; });
  return volcano;
}
