// Drifting Continents & the Impact: the planet through the age of dinosaurs.
// (A) The globe and flat maps through deep time. The land is a sum of soft blobs on the sphere whose centres move
//     between three hand-placed layouts (Pangaea about 237 Ma, the Late Jurassic about 150 Ma, the end of the
//     Cretaceous 66 Ma). It is an approximate, stylised reconstruction, not a plate model.
// (B) The Chicxulub impact, 66 Ma: the asteroid, the flash, shock ring, ejecta curtain, re-entry glow, fires,
//     tsunami rings and the soot veil, seen from orbit, from the asteroid, close over the crater and from the Moon.
// One shader, views picked with #define opts (VIEW 0 globe, 1 flat map, 2 the asteroid's view, 3 crater close-up,
// 4 from beyond the Moon). The blob centres and the map labels are computed in JS each frame and handed to the
// shader as extra uniforms and one overlay texture, on top of what shaderEngine() already provides.
import { shaderEngine } from '../gl.js';
import { STAGES } from '../time.js';

const RAD = Math.PI / 180;
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- the continents: [name, [lon, lat] Pangaea, [lon, lat] Late Jurassic, [lon, lat] end-Cretaceous, radius°, weights]
// Negative weights carve seas (the Tethys, and the shallow inland seaways of the Cretaceous).
const BLOBS = [
  ['na1', [-58, 28], [-80, 38], [-113, 47], 14],          // western North America (Laramidia)
  ['na2', [-38, 42], [-58, 52], [-82, 60], 16],           // Canadian shield
  ['na3', [-36, 22], [-55, 30], [-80, 37], 12],
  ['na6', [-57, 18], [-80, 28], [-108, 34], 8],           // the south-west           // Appalachia
  ['na4', [-62, 50], [-95, 62], [-150, 68], 9],           // Alaska
  ['na5', [-55, 10], [-78, 18], [-102, 24], 8],           // Mexico
  ['grn', [-15, 52], [-25, 62], [-38, 72], 9],            // Greenland
  ['yuc', [-45, 5], [-67, 13], [-89, 16.5], 4.5, [0.75, 0.75, 0.75]],   // the Yucatán platform
  ['gpl', [-46, 8], [-68, 15], [-90, 20], 9, [0.25, 0.25, 0.25]],            // the Gulf platform: crust under a shallow sea
  ['chx', [-45.5, 9.3], [-67.5, 16.3], [-89.5, 21.3], 4, [-0.2, -0.2, -0.2]],
  ['sa1', [-30, -14], [-34, -10], [-52, -10], 15],        // Amazonia
  ['sa2', [-22, -34], [-28, -30], [-55, -28], 11],
  ['sa3', [-22, -50], [-30, -47], [-62, -45], 7],         // Patagonia
  ['sa4', [-45, -3], [-48, 0], [-66, 2], 8],
  ['af1', [-10, 5], [-6, 10], [2, 14], 18],               // West Africa
  ['af2', [10, -8], [14, -3], [22, 4], 15],
  ['af3', [12, -30], [16, -26], [24, -20], 13],           // southern Africa
  ['af4', [25, -10], [30, -5], [40, 4], 8],               // the Horn
  ['arb', [32, -2], [37, 5], [45, 16], 8],                // Arabia
  ['eu1', [-5, 32], [5, 38], [12, 44], 9, [1, 1, 0.78]],  // western Europe (an archipelago in the Cretaceous)
  ['eu2', [15, 40], [25, 45], [35, 52], 12],
  ['scn', [-2, 48], [8, 55], [18, 62], 7],                // Scandinavia
  ['as1', [50, 62], [75, 62], [95, 62], 20],              // Siberia
  ['as2', [38, 48], [55, 48], [68, 48], 14],              // Kazakhstan
  ['as3', [85, 28], [100, 35], [108, 36], 14],            // China
  ['as4', [85, 62], [115, 65], [135, 62], 13],            // the far east
  ['as5', [100, 8], [105, 15], [102, 16], 8],
  ['as6', [62, 40], [80, 40], [88, 40], 12],              // central Asia             // South-East Asia
  ['ind', [40, -48], [40, -42], [68, -15], 9],            // India, on its run north
  ['mdg', [30, -42], [30, -36], [46, -24], 4, [0.8, 0.8, 0.8]],
  ['an1', [20, -66], [15, -68], [0, -80], 15],            // Antarctica
  ['an2', [60, -66], [70, -70], [90, -78], 15],
  ['an3', [-10, -62], [-25, -64], [-65, -70], 9],
  ['au1', [88, -52], [95, -55], [128, -52], 14],          // Australia
  ['au2', [100, -40], [108, -45], [145, -42], 8],
  ['tet', [55, 8], [65, 12], [70, 18], 22, [-0.55, -0.4, -0.25]],     // the Tethys
  ['ws1', [-50, 32], [-70, 44], [-101, 53], 5.5, [0, 0, -1]],           // Western Interior Seaway
  ['ws2', [-47, 22], [-66, 32], [-99, 40], 5.5, [0, 0, -1]],
  ['trg', [42, 52], [60, 52], [64, 52], 5, [0, 0, -0.9]],             // Turgai Strait
  ['sah', [-8, 8], [-3, 14], [6, 17], 5, [0, 0, -0.6]],               // Trans-Saharan seaway
];
const NB = BLOBS.length;
const IDX = Object.fromEntries(BLOBS.map((b, i) => [b[0], i]));
const SITE = [-89.5, 21.3];           // Chicxulub, in the end-Cretaceous layout
const vec = (lon, lat) => { const a = lon * RAD, b = lat * RAD; return [Math.cos(b) * Math.sin(a), Math.sin(b), Math.cos(b) * Math.cos(a)]; };
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// where every blob is at drift time t (0 Pangaea … 0.5 Late Jurassic … 1 end-Cretaceous, a little beyond for the Paleocene)
function layout(t) {
  const lon = new Float32Array(NB), lat = new Float32Array(NB), B = new Float32Array(NB * 4), D = new Float32Array(NB * 4);
  const first = t < 0.5, u = first ? t * 2 : (t - 0.5) * 2;
  for (let i = 0; i < NB; i++) {
    const b = BLOBS[i], k0 = first ? b[1] : b[2], k1 = first ? b[2] : b[3], w = b[5] || [1, 1, 1];
    const uu = Math.min(u, 1);
    lon[i] = k0[0] + (k1[0] - k0[0]) * u; lat[i] = k0[1] + (k1[1] - k0[1]) * u;
    const c = vec(lon[i], lat[i]), ref = vec(b[3][0], b[3][1]), r = b[4] * RAD;
    B.set([c[0], c[1], c[2], 2 / (r * r)], i * 4);
    D.set([c[0] - ref[0], c[1] - ref[1], c[2] - ref[2], first ? w[0] + (w[1] - w[0]) * uu : w[1] + (w[2] - w[1]) * uu], i * 4);
  }
  const m = IDX.na5, s0 = vec(SITE[0], SITE[1]);
  const site = norm([s0[0] + D[m * 4], s0[1] + D[m * 4 + 1], s0[2] + D[m * 4 + 2]]);
  return { lon, lat, B, D, site };
}

const fs = `
#define NB ${NB}
uniform vec4 uB[NB];      // blob centre (unit vector) and 2/r²
uniform vec4 uD[NB];      // how far the blob has moved from its end-Cretaceous place, and its weight
uniform vec3 uSite;       // Chicxulub
uniform sampler2D uLab;   // text overlay (labels, timeline)
uniform float uLabOn;

Era E;
float FLOOD, S_, TP, M2, HIT, TH, OCT, SCORCH, FIRE, REENT, FRONT, EMK;
vec3 SE, SN, AST, SUNT;
vec2 SUNSCR;

// ---------- land: a sum of soft blobs; qa is the point carried back with the drift, so texture travels with the land
float field(vec3 q, out vec3 qa, out float fp){
  float f = 0., ws = .2; vec3 d = vec3(0.); fp = 0.;
  for (int i = 0; i < NB; i++) {
    float g = exp((dot(q, uB[i].xyz) - 1.)*uB[i].w);
    float w = uD[i].w;
    f += g*w; float a = g*max(w, 0.); fp += a; d += a*uD[i].xyz; ws += a;
  }
  qa = normalize(q - d/ws);
  return f;
}

float cloudCover(vec3 q){
  float t = uTime*.006*energy();
  vec3 p = q; p.xz = rot2(p.xz, t*.6*windDir().x);
  float w = fbm3(p*2.1 + vec3(3.3, t*.7, 1.1), 3.);
  vec3 pw = p + (vec3(w, fbm3(p*2.1 + vec3(9.1, 2.2, t*.7), 3.), w) - .5)*.3;        // swirl
  float c = .62*fbm3(pw*3.6 + vec3(0., 0., t*.4), 4.) + .38*fbm3(pw*13. + vec3(t, 0., 5.), max(OCT - 2., 2.));
#ifdef FINE_1
  c = mix(c, fbm3(pw*42. + vec3(t*3., 0., 2.), 4.), .3) + .03;
#endif
  float lat = asin(clamp(q.y, -1., 1.));
  float cov = uX2*(.7 + .3*cos(lat*6.)) + (.5 - E.dry)*.1;
  return smoothstep(.63 - cov*.26, .82 - cov*.26, c)*CLOUDK;
}

// soot and dust in the air after the impact: spreads out from the site, then thins everywhere
float veil(vec3 q){
  if (E.dark <= 0.) return 0.;
  float ds = acos(clamp(dot(q, uSite), -1., 1.));
  float n = fbm3(q*3.1 + vec3(uTime*.01, 0., 4.), 4.);
  return smoothstep(0., .8, E.dark*2.1 - ds/PI*1.1 + (n - .5)*.7);
}

// ---------- the surface of the Earth at q (unit vector), lit with n·l = ndl. flat_ = 1 for maps (no glint, no limb)
vec3 surface(vec3 q, vec3 rd, vec3 sun, float ndl, float flat_){
  vec3 qa; float fp; float f = field(q, qa, fp);
  float n1 = fbm3(qa*2.7 + 11.3, OCT);
  float n2 = fbm3(qa*7.3 + 3.1, max(OCT - 1., 2.));
  // continental crust (Fp) and what stands above the sea (F): seaways and flooded basins are shallow water on crust
  float crust = (n1 - .5)*.2 + (n2 - .5)*.1;
  float Fp = (1. - exp(-1.7*fp))*(.6 + .8*n1) + crust;
  float F = (1. - exp(-1.7*max(f, 0.)))*(.6 + .8*n1) + min(f, 0.) + crust - FLOOD*.3*smoothstep(.48, .72, noise3(qa*2.3 + 31.));
#ifdef FINE_1
  float n3 = fbm3(qa*46. + 1.7, 4.);
  F += (n3 - .5)*.07; n2 = mix(n2, n3, .45);
#endif
  float e = F - TH;
  float aa = clamp(fwidth(F)*1.2, .003, .05);
  float land = smoothstep(-aa, aa, e);
  float shelf = smoothstep(-.25, 0., Fp - TH)*(1. - .55*smoothstep(0., .3, -e));
  float lat = asin(clamp(q.y, -1., 1.)), al = abs(lat);
  float dsc = length(q - uSite);
  float dang = acos(clamp(dot(q, uSite), -1., 1.));

  // climate: dry belts in the subtropics and deep inside big continents, wet at the equator
  float arid = E.dry*1.15 - .38 + .55*(.45 + .8*E.dry)*exp(-pow((al - .44)/.24, 2.)) + .45*smoothstep(.1, .5, e) - .5*exp(-pow(lat/.17, 2.)) + (n2 - .5)*.8;
  float des = smoothstep(.3, .75, arid);
  float belt = smoothstep(.5, .68, noise3(qa*4.2 + 20.))*smoothstep(.06, .4, e);
  float ridge = 1. - abs(2.*fbm3(qa*21. + 5., 2.) - 1.);
  float mtn = belt*(.35 + .65*ridge);
#ifdef STYLE_1
  vec3 lc = mix(vec3(.46,.56,.30), vec3(.80,.69,.44), des);
  lc = mix(lc, vec3(.56,.46,.36), mtn*.8);
  lc *= .92 + .16*n2;
  vec3 oc = mix(vec3(.20,.36,.52), vec3(.50,.72,.76), shelf*shelf);
#else
  vec3 forest = mix(vec3(.06,.23,.05), vec3(.11,.25,.09), smoothstep(.3, 1.1, al));
  forest = mix(forest*vec3(.95,.86,.8), forest*vec3(1.,1.12,.9), E.flowers);
  vec3 sand = mix(vec3(.72,.56,.36), vec3(.58,.32,.19), smoothstep(.35, .7, n2 + .3*E.dry - .15));
  vec3 lc = mix(forest, vec3(.36,.36,.17), smoothstep(.12, .5, arid));
  lc = mix(lc, sand, des);
  lc = mix(lc, vec3(.34,.30,.26), mtn*.7);
  lc *= .78 + .44*n2;
  vec3 oc = mix(mix(vec3(.008,.04,.12), vec3(.014,.075,.18), n2), vec3(.05,.36,.40), shelf*shelf*.9);
#endif
  // relief from screen-space slope toward the sun
  vec3 st = SUNT - q*dot(SUNT, q);
  vec3 qb = qa + st*.012;
  float ridgeB = 1. - abs(2.*fbm3(qb*21. + 5., 2.) - 1.);
  float rel = clamp(((n2 - fbm3(qb*7.3 + 3.1, max(OCT - 1., 2.)))*.5 + (ridge - ridgeB)*belt*.9)*RELK, -.5, .5);
  lc *= 1. + rel;
  // burnt ground, then the fern spike
  float burn = SCORCH*smoothstep(FRONT + .3, FRONT - .1, dang);
  lc = mix(lc, vec3(.055,.045,.04)*(.6 + .8*n2), burn*.85);
  lc = mix(lc, vec3(.2,.42,.1)*(.7 + .6*n2), E.ferns*.55*(1. - des*.6));
  // impact winter: frost and sea ice creep down from the poles
  float cold = 1. - E.warm;
  float snowLat = mix(1.95, .6, smoothstep(.4, .85, cold));
  float snow = smoothstep(snowLat - .1, snowLat + .12, al + (n2 - .5)*.35 + mtn*.25);
  lc = mix(lc, vec3(.84,.88,.93), snow);
  oc = mix(oc, vec3(.72,.8,.88), snow*.75*smoothstep(snowLat + .1, snowLat + .3, al + (n1 - .5)*.3));
#ifdef STYLE_1
  lc = mix(lc, vec3(.16,.14,.1), smoothstep(aa*2.2, aa*.6, abs(e))*.7);
#endif
  vec3 alb = mix(oc, lc, land);
  vec3 emit = vec3(0.), lava = vec3(0.);
  float foam = 0., clear = 0.;
  if (HIT > .5) {
    // the crater: molten at first, then a flooded basin with a rim and a peak ring
    float cr = .0145, hot = exp(-TP/.01), grown = smoothstep(0., .0012, TP);
    float wob = 1. + .12*(noise3(q*160.) - .5);
    float inC = smoothstep(cr*1.08, cr*.92, dsc*wob);
    float rimC = exp(-pow((dsc*wob - cr)/(cr*.14), 2.));
    float peak = exp(-pow((dsc*wob - cr*.45)/(cr*.11), 2.));
    alb = mix(alb, mix(vec3(.015,.08,.13), vec3(.3,.3,.27), peak*.7), inC*grown);
    alb = mix(alb, vec3(.42,.4,.34), rimC*.8*grown);
    alb = mix(alb, vec3(.3,.27,.24), grown*.55*exp(-dsc/(cr*2.2))*(1. - inC));   // ejecta blanket
    lava = (vec3(1.,.5,.15)*inC*(1. + 1.5*noise3(q*300. + uTime*.3)) + vec3(1.,.3,.05)*exp(-dsc/(cr*2.5))*.8)*hot*grown*3.;
    // tsunami rings running out across the sea
    float rt = TP*26.;
    float env = smoothstep(rt + .012, rt - .004, dsc)*smoothstep(rt*.35 - .02, rt*.8, dsc)*exp(-rt*1.3);
    foam = pow(.5 + .5*sin((dsc - rt)*WAVEF), 3.)*env*(1. - land);
    clear = exp(-dsc/(.05 + TP*40.))*(1. - smoothstep(.0, .06, TP));
  }
  alb += vec3(.3,.4,.42)*foam;
#ifdef MARK_1
  if (S_ > .84) {
    float px = fwidth(dang) + 1e-5;
    float ring = smoothstep(px*1.6, px*.4, abs(dang - .05 - .008*sin(uTime*3.)));
    alb = mix(alb, vec3(1.,.35,.1), ring*.9*smoothstep(.84, .86, S_));
  }
#endif
  float cl = cloudCover(q)*(1. - clear);
  float v = veil(q);
  float day = smoothstep(-.1, .22, ndl);
  vec3 sunc = mix(vec3(1.,.5,.25), vec3(1.), smoothstep(-.02, .35, ndl));
  vec3 light = sunc*day*(.3 + .7*clamp(ndl, 0., 1.))*1.25 + vec3(.075,.105,.19);
  alb *= 1. - cl*.25;                                           // cloud shadow
  vec3 col = alb;
  col = mix(col, vec3(.92,.94,.97), cl*.93);
  vec3 soot = vec3(.20,.17,.15)*(.7 + .6*fbm3(q*5. + 2., 3.));
  col = mix(col, soot, v*.94);
  col *= light;
  // sun glint on open water
  if (flat_ < .5) {
    float sp = pow(max(dot(reflect(-sun, q), -rd), 0.), 140.)*.9 + pow(max(dot(reflect(-sun, q), -rd), 0.), 18.)*.05;
    col += vec3(1.,.9,.7)*sp*.6*(1. - land)*(1. - cl)*(1. - v)*day;
  }
  // things that glow: mostly seen on the night side
  float nk = 1. - day*(1. - EMK);
  float flick = .7 + .3*sin(uClock*9. + n2*40.);
  float fire = land*FIRE*smoothstep(FRONT + .2, FRONT - .2, dang)*smoothstep(.5, .66, fbm3(qa*17. + 9., 3.) + .2*(n2 - .5))*(1. - snow)*(1. - des*.7);
  emit += vec3(1.,.36,.06)*fire*flick*1.7;
  vec3 vcx = qa*11.; float vh = hash13(floor(vcx) + 3.7);
  vec3 vo = fract(vcx) - .5 - (vec3(hash13(floor(vcx) + 1.1), hash13(floor(vcx) + 2.2), hash13(floor(vcx) + 5.5)) - .5)*.6;
  emit += vec3(1.,.25,.05)*step(.94, vh)*land*exp(-dot(vo, vo)*300.)*flick*3.*VOLC*(1. - day);
  vec3 lcx = q*9.; float lh = hash13(floor(lcx) + floor(uTime*3.*energy())*7.13);
  emit += vec3(.7,.8,1.)*step(.94, lh)*smoothstep(.1, .6, cl)*exp(-dot(fract(lcx) - .5, fract(lcx) - .5)*14.)*3.*(1. - v);
  float au = exp(-pow((al - 1.2)/.06, 2.))*(.3 + .7*noise3(q*vec3(14., 2., 14.) + uTime*.15));
  emit += vec3(.1,.9,.45)*au*.4*(1. - v)*(1. - flat_);
  col += emit*nk*(1. - .65*v)*(1. - cl*.7) + lava;
  // air: blue toward the limb, grey-brown under the soot veil
  if (flat_ < .5) {
    float rim = pow(1. - max(dot(q, -rd), 0.), 2.6);
    col += mix(vec3(.22,.48,1.), vec3(.3,.26,.22), v)*rim*day*(.25 + 1.1*uX3);
    col += vec3(1.,.4,.15)*rim*smoothstep(.25, 0., abs(ndl))*.25*uX3;
  }
  return col;
}

// ---------- thin glowing layers above the surface: ejecta curtain, shock ring, re-entry rain. Premultiplied.
vec4 shellFx(vec3 p, float h, float k, vec3 sun){
  vec3 e = vec3(0.); float a = 0.;
  float ds = acos(clamp(dot(p, uSite), -1., 1.));
  float lit = smoothstep(-.15, .25, dot(p, sun));
  if (TP > 0. && TP < .03) {
    float re = .04 + .6*pow(TP/.012, .6);
    float r = re + h*1.3, w = .015 + re*.16;
    vec2 az = normalize(vec2(dot(p, SE), dot(p, SN)) + 1e-5);
    float rays = .6*noise2(az*4. + 3.) + .4*noise2(az*13. + ds*18. - TP*600.);
    float band = exp(-pow((ds - r)/w, 2.));
    float fill = smoothstep(r, r*.4, ds)*.3;
    float fade = (1. - smoothstep(.008, .024, TP))*exp(-h/(.03 + re*.12));
    float dens = (band*(.3 + 1.4*rays) + fill)*fade;
    float hotk = exp(-TP/.0025);
    vec3 c = mix(vec3(.5,.42,.34)*(.12 + .9*lit), vec3(1.6,1.,.5), hotk) + vec3(1.,.4,.1)*.4*exp(-TP/.006)*band;
    a = clamp(dens*.8, 0., .95); e = c*a;
  }
  if (k < .5) {
    if (TP > 0. && TP < .012) {
      float rs = TP/.012*3.;
      float sh = exp(-pow((ds - rs)/.016, 2.))*pow(1. - TP/.012, 1.5)*.55;
      e = e*(1. - sh) + vec3(.9,.95,1.)*(.4 + .7*lit)*sh; a += sh*(1. - a);
    }
    if (REENT > 0.) {
      float fr = clamp(smoothstep(FRONT + .05, FRONT - .25, ds) + .6*smoothstep(.5, 0., PI - ds)*smoothstep(.8, 1.1, FRONT/PI), 0., 1.);
      vec3 cp = p*SPARKF;
      float hh = hash13(floor(cp) + floor(uTime*9.)*3.1);
      float spark = step(.84, hh)*exp(-dot(fract(cp) - .5, fract(cp) - .5)*12.);
      float al = REENT*fr*((.2 + .3*noise3(p*6. + uTime*.4))*.4 + spark*.9);
      e += vec3(1.,.42,.1)*al*1.6; a += al*.3*(1. - a);
    }
  }
  return vec4(e, a);
}

vec3 moonCol(vec3 n, vec3 sun){
  float m = fbm3(n*2.3 + 5., 5.);
  float c1 = worley3(n*6.), c2 = worley3(n*15. + 3.);
  vec3 a = mix(vec3(.34,.33,.32), vec3(.13,.13,.14), smoothstep(.47, .58, m));
  a *= .8 + .3*smoothstep(.1, .4, c1) + .12*exp(-pow((c1 - .32)/.05, 2.));
  a *= .85 + .2*smoothstep(.1, .35, c2) + .1*exp(-pow((c2 - .3)/.05, 2.));
  a *= .85 + .3*fbm3(n*22., 3.);
  return a*(pow(max(dot(n, sun), 0.), .8)*1.5 + .012);
}

// closest approach of the view ray to a segment a→b: x = distance, y = ray t, z = position along the segment 0..1
vec3 raySeg(vec3 ro, vec3 rd, vec3 a, vec3 b){
  vec3 u = b - a, w = ro - a;
  float B_ = dot(rd, u), C_ = dot(u, u), D_ = dot(rd, w), E_ = dot(u, w);
  float s = clamp((E_ - D_*B_)/max(C_ - B_*B_, 1e-6), 0., 1.);
  float t = s*B_ - D_;
  return vec3(length(w + rd*t - u*s), t, s);
}

void main(){
  vec2 uv = (gl_FragCoord.xy - .5*uRes)/uRes.y;
  float asp = uRes.x/uRes.y;
  S_ = uStage; E = era(S_);
  TP = S_ - .880; HIT = step(0., TP); M2 = TP/.008;
  FLOOD = smoothstep(.22, .68, S_)*(1. - .3*smoothstep(.9, 1., S_));
  TH = .5 + .04*FLOOD;
  OCT = OCTS*(.62 + .6*uDetail);
  SCORCH = smoothstep(.8805, .885, S_)*(1. - smoothstep(.93, .99, S_));
  FIRE = smoothstep(.8808, .884, S_)*(1. - smoothstep(.895, .925, S_));
  REENT = smoothstep(.8806, .8825, S_)*(1. - smoothstep(.886, .896, S_));
  FRONT = clamp(TP/.005, 0., 1.2)*PI;
  SE = normalize(cross(vec3(0., 1., 0.), uSite)); SN = cross(uSite, SE);
  AST = normalize(uSite*.866 + (SE + SN)*.3536);     // it came in steeply from the north-east
  vec3 col = vec3(0.);
  float shellN = floor(3. + 3.*uDetail);

#ifdef VIEW_1
  // ---------- flat map
  EMK = .85; SUNSCR = vec2(-.7, .7); SUNT = vec3(0.);
  float k = min(1., asp/1.78);
  vec2 mn = (uv - vec2(0., .035))/k/vec2(.84, .42);
  float lon, lat, inside;
#ifdef PROJ_1
  float aam = 2./(uRes.y*.42*k);
  float th = asin(clamp(mn.y, -1., 1.));
  lat = asin(clamp((2.*th + sin(2.*th))/PI, -1., 1.));
  lon = PI*mn.x/max(cos(th), 1e-3);
  inside = smoothstep(1. + aam, 1. - aam, length(mn));
#else
  lon = mn.x*PI; lat = mn.y*PI*.5;
  inside = step(abs(mn.x), 1.)*step(abs(mn.y), 1.);
#endif
  col = vec3(.022,.026,.04)*(1. - .5*dot(uv, uv));
  if (inside > 0.) {
    float lo = lon + LON0*PI/180. - uDrag.x*2.;
    vec3 q = vec3(cos(lat)*sin(lo), sin(lat), cos(lat)*cos(lo));
    vec3 sun = q;
    SUNT = normalize(vec3(-cos(lo), 0., sin(lo))*.7 + vec3(-sin(lat)*sin(lo), cos(lat), -sin(lat)*cos(lo))*.7);   // light from the north-west
    float ndl = mix(.25, 1., smoothstep(0., .6, uLight));
    vec3 c = surface(q, -q, sun, ndl, 1.);
    if (TP > 0. && (TP < .03 || REENT > 0.)) {
      vec4 s0 = shellFx(q, .012, 0., sun); c = c*(1. - s0.a) + s0.rgb;
      vec4 s1 = shellFx(q, .05, 1., sun); c = c*(1. - s1.a) + s1.rgb;
    }
    // graticule every 30°, the equator a little stronger
    float px = PI/(.84*k*uRes.y);
    float gs = PI/6.;
#ifdef PROJ_1
    float GCOS = max(cos(lat), .05);
#else
    float GCOS = 1.;
#endif
    float gx = abs(fract(lo/gs + .5) - .5)*gs*GCOS, gy = abs(fract(lat/gs + .5) - .5)*gs;
    float line = smoothstep(px*1.4, px*.3, min(gx, gy));
    c = mix(c, vec3(1.), line*.13 + smoothstep(px*1.6, px*.4, abs(lat))*.14);
    col = mix(col, c, inside);
  }
  // the impact lights up the whole page for a moment
  col += vec3(1.,.9,.75)*smoothstep(-.0005, .0002, TP)*exp(-max(TP, 0.)/.0009)*.35;
#else
  // ---------- cameras
  EMK = .12;
  vec3 ro, cu, cv, cf; float foc; vec2 off = vec2(0.);
  vec3 moonC = vec3(0.); float moonOn = 0.;
#ifdef VIEW_0
  float lonC = LON0*PI/180. - uDrag.x*2.5 + uTime*uX1*.1;
  float latC = clamp(LAT0*PI/180. - uDrag.y*1.8, -1.45, 1.45);
  vec3 wv = vec3(cos(latC)*sin(lonC), sin(latC), cos(latC)*cos(lonC));
  ro = wv*DIST*mix(1.45, .7, uSize); cf = -wv; cu = normalize(cross(vec3(0., 1., 0.), wv)); cv = cross(wv, cu); foc = FOC;
#endif
#ifdef VIEW_2
  float alt = S_ < .862 ? 6. + (.862 - S_)*8. : (TP < 0. ? .012 + 6.*pow(-M2/2.25, 1.4) : mix(3.4, 12.9, smoothstep(.95, 1., S_)));
  vec3 da = normalize(AST + (SE*uDrag.x + SN*uDrag.y)*.6);
  ro = uSite + da*alt;
  cf = normalize(uSite*clamp(1.5/alt, 0., 1.) - ro); cu = normalize(cross(cf, vec3(0., 1., 0.))); cv = cross(cu, cf);
  foc = 2.*mix(.7, 1.4, uSize);
#endif
#ifdef VIEW_3
  float az = AZ + uDrag.x*2.5 + uTime*uX1*.03;
  float zoom = mix(1.7, .6, uSize);
  ro = uSite*(1. + clamp(.075 + uDrag.y*.08, .02, .3)*zoom) + (SE*cos(az) + SN*sin(az))*.15*zoom;
  cf = normalize(uSite - ro); cu = normalize(cross(cf, uSite)); cv = cross(cu, cf); foc = 1.5;
#endif
#ifdef VIEW_4
  vec3 dm = normalize(uSite + .45*SE + .15*SN); dm.xz = rot2(dm.xz, uDrag.x*2. - uTime*uX1*.1);
  vec3 mu_ = normalize(cross(vec3(0., 1., 0.), dm)), mv_ = cross(dm, mu_);
  moonC = dm*60.; moonOn = 1.;
  ro = dm*65.5 + mu_*.40 + mv_*(.27 + uDrag.y*.3);
  cf = normalize(-ro); cu = normalize(cross(cf, vec3(0., 1., 0.))); cv = cross(cu, cf);
  foc = 8.5*mix(.75, 1.3, uSize); off = vec2(.36*min(1., asp/1.78), .18);
#endif
  vec3 rd = normalize(cu*(uv.x - off.x) + cv*(uv.y - off.y) + cf*foc);
  float sa = mix(2.7, .4, uLight);
  vec3 sun = normalize(-cf*cos(sa) + cu*sin(sa) + cv*.25);
  SUNSCR = normalize(vec2(dot(sun, cu), dot(sun, cv)) + 1e-4); SUNT = sun;
  float pixA = 1./(foc*uRes.y);

  // stars
  vec3 sq = rd*220.; float sh_ = hash13(floor(sq));
  col = vec3(step(.9965, sh_))*(.35 + .65*hash13(floor(sq) + 7.))*mix(vec3(.8,.9,1.), vec3(1.,.9,.8), hash13(floor(sq) + 3.))*.6;

  // ---------- the Earth
  float b = dot(ro, rd), c = dot(ro, ro) - 1.;
  float disc = b*b - c, tS = -1.;
  if (disc > 0. && -b - sqrt(disc) > 0.) {
    tS = -b - sqrt(disc);
    vec3 p = ro + rd*tS;
    col = surface(p, rd, sun, dot(p, sun), 0.);
  } else if (b < 0.) {
    vec3 pc = ro - rd*b; float hh = length(pc) - 1.;
    float lit = smoothstep(-.3, .3, dot(normalize(pc), sun));
    float v = veil(normalize(pc));
    col += mix(vec3(.25,.5,1.), vec3(.3,.26,.22), v)*exp(-hh/.022)*lit*(.3 + 1.1*uX3);
    col += vec3(1.,.4,.15)*exp(-hh/.012)*smoothstep(.35, 0., abs(dot(normalize(pc), sun)))*.3*uX3;
  }
  if (TP > 0. && (TP < .03 || REENT > 0.)) {
    for (int pass = 0; pass < 2; pass++) for (int i = 0; i < 6; i++) {
      float kk = pass == 0 ? shellN - 1. - float(i) : float(i);      // far sides first (outer → inner), then near sides
      if (kk < 0. || kk >= shellN) continue;
      float h = (.012 + .09*pow(kk/(shellN - 1.), 1.5))*SHELLH;
      float R = 1. + h, d2 = b*b - (dot(ro, ro) - R*R);
      if (d2 <= 0.) continue;
      float t = -b + (pass == 0 ? 1. : -1.)*sqrt(d2);
      if (t <= 0. || (tS > 0. && t > tS)) continue;
      vec4 sfx = shellFx(normalize(ro + rd*t), h, kk, sun);
      col = col*(1. - sfx.a) + sfx.rgb;
    }
  }

  // ---------- the Moon
  if (moonOn > .5) {
    vec3 om = ro - moonC; float bm = dot(om, rd), cm = dot(om, om) - .2727*.2727;
    float dm2 = bm*bm - cm;
    if (dm2 > 0. && -bm - sqrt(dm2) > 0.) { vec3 n = normalize(om + rd*(-bm - sqrt(dm2))); col = moonCol(n, sun); }
  }

  // ---------- the asteroid, its fireball and the flash
  vec3 sdv = uSite - ro; float sz = dot(sdv, cf);
  vec2 sscr = vec2(dot(sdv, cu), dot(sdv, cv))/max(sz, 1e-3)*foc + off;
  float facing = smoothstep(-.25, .15, dot(uSite, normalize(ro - uSite*.97)));
  float rE = foc/length(ro);
#ifndef VIEW_2
  if (M2 > -2.4 && M2 < 0.04) {
    float altA = max(-M2, 0.)*2.7;
    vec3 A = uSite*1.001 + AST*altA;
    float heat = smoothstep(-.25, -.02, M2);
    vec3 ad = A - ro; float ta = dot(ad, rd);
    if (ta > 0. && (tS < 0. || ta < tS + .02)) {
      float ang = length(ad - rd*ta)/ta;
      float sr = max(.0008/ta, pixA*1.4);
      col += (vec3(.75,.7,.62)*.9 + vec3(1.,.8,.5)*heat*4.)*exp(-pow(ang/sr, 2.))*smoothstep(-2.4, -2.2, M2);
      col += vec3(1.,.6,.3)*heat*.5*exp(-ang/(sr*5.));
    }
    if (heat > 0.) {
      vec3 rs = raySeg(ro, rd, A, A + AST*.55*heat);
      if (rs.y > 0. && (tS < 0. || rs.y < tS + .02)) {
        float wd = max(.004 + .012*rs.z, rs.y*pixA*1.3);
        col += mix(vec3(1.,.85,.6), vec3(1.,.35,.1), rs.z)*exp(-pow(rs.x/wd, 2.))*pow(1. - rs.z, 1.5)*heat*1.6;
      }
    }
#ifdef RETICLE_1
    float az_ = dot(ad, cf);
    if (az_ > 0.) {
      vec2 asc = vec2(dot(ad, cu), dot(ad, cv))/az_*foc + off;
      float rr = length(uv - asc);
      float px = 1.5/uRes.y;
      col += vec3(1.,.8,.5)*smoothstep(px*1.5, px*.4, abs(rr - .035))*.6*smoothstep(-2.4, -2.1, M2)*smoothstep(-.03, -.2, M2);
    }
#endif
  }
#endif
  if (TP > -.0006 && TP < .012) {
    float I = smoothstep(-.0005, .0002, TP)*exp(-max(TP, 0.)/.004);
    float rf = .02 + 3.*max(TP, 0.);
    vec3 Pf = uSite*(1. + rf*.6);
    float tf = dot(Pf - ro, rd);
    if (tf > 0. && (tS < 0. || tf < tS + rf)) {
      float d2f = dot(Pf - ro, Pf - ro) - tf*tf;
      col += vec3(1.,.8,.55)*I*(2.*exp(-d2f/(rf*rf)) + .3*rf*rf/(d2f + rf*rf));
    }
  }
  float fl = smoothstep(-.0005, .0002, TP)*exp(-max(TP, 0.)/.0018);
  if (fl > .001 && sz > 0.) {
    float dd = length(uv - sscr), rb = rE*.3 + .03;
    col += vec3(1.,.95,.85)*fl*facing*(.5*fl*fl*fl + 2.2*exp(-dd*dd/(rb*rb)) + .08/(dd*4. + .15));
  }
#ifdef VIEW_2
  // the asteroid itself, underfoot; it starts to glow as it meets the air
  {
    float gone = HIT > .5 ? 1. - smoothstep(.95, 1., S_) : 0.;
    float heat = HIT > .5 ? 0. : smoothstep(-.35, -.03, M2);
    float drift = uTime*.01;
    float prof = -.33 + .11*fbm2(vec2(uv.x*2.1 + 3. + drift, 1.7), 4.) - .16*uv.x*uv.x - gone*.6 + .02*heat*sin(uClock*31.);
    float dR = prof - uv.y;
    // plasma streaming past
    vec2 pc = uv - vec2(0., .1); float ra = length(pc);
    vec2 pd = pc/max(ra, 1e-3);
    float streak = fbm2(vec2(pd.x*9. + pd.y*5., ra*3. - uClock*6.) + pd*4., 3.);
    col += vec3(1.,.5,.2)*heat*heat*smoothstep(.4, .95, ra)*streak*.8;
    col += vec3(1.,.6,.3)*heat*exp(-max(-dR, 0.)*9.)*.9;
    if (dR > 0.) {
      vec2 rp = vec2(uv.x + drift*.5, dR*2.4 + uv.x*uv.x*.3);
      float tex = fbm2(rp*7. + 2., 5.);
      float cr = worley2(rp*5.5 + 1.3);
      vec2 rq = rp + vec2(sign(SUNSCR.x + .001), .6)*.012;
      float slope = clamp(((tex - fbm2(rq*7. + 2., 5.))*.7 + (smoothstep(.0, .3, cr) - smoothstep(.0, .3, worley2(rq*5.5 + 1.3)))*.5)*9., -.7, .9);
      vec3 rk = vec3(.19,.17,.15)*(.5 + .8*tex)*(.75 + slope);
      float lightK = .25 + .75*smoothstep(.0, .5, uLight);
      rk *= lightK*smoothstep(.5, .0, dR)*1.3 + .03;
      rk += vec3(.9,.85,.75)*exp(-dR*60.)*.25*lightK;                  // sunlit edge
      rk += vec3(1.,.45,.15)*heat*(exp(-dR*10.)*1.2 + .15);
      col = mix(col, rk, smoothstep(0., .004, dR));
    }
    col += vec3(1.,.95,.85)*fl*fl*fl*fl*3.;
  }
#endif
#endif
  col = 1. - exp(-max(col, 0.)*1.45);
  if (uLabOn > .5) { vec4 tx = texture(uLab, vec2(gl_FragCoord.x/uRes.x, 1. - gl_FragCoord.y/uRes.y)); col = mix(col, tx.rgb, tx.a); }
  finish(col, 0.);
}
`;

const DEFAULTS = { VIEW: 0, PROJ: 0, STYLE: 0, LABELS: 0, MARK: 0, RETICLE: 1, LON0: 0.0, LAT0: 15.0, DIST: 3.2, FOC: 1.35, OCTS: 5.0,
  CLOUDK: 1.0, FINE: 0, RELK: 6.0, WAVEF: 110.0, SPARKF: 85.0, SHELLH: 1.0, VOLC: 1.0, AZ: -0.5 };

const base = shaderEngine({
  id: 'earth', name: 'Drifting Continents & the Impact', fs, res: 0.8, sky: false, defaults: DEFAULTS,
  params: [
    { id: 'x1', label: 'Spin', value: 0.5, tip: 'How fast the view circles the planet (0 holds still; drag to turn it yourself)' },
    { id: 'x2', label: 'Clouds', value: 0.5, tip: 'Cloud cover' },
    { id: 'x3', label: 'Glow', value: 0.5, tip: 'How much the air glows at the edge of the planet' },
  ]
});

// ---------- labels and the timeline, drawn on a 2D canvas and laid over the picture
const LABELS = [
  // text, blobs to sit on (or a fixed [lon, lat]), size, drift-time window, kind (0 land, 1 sea, 2 big)
  ['PANGAEA', ['af1', 'na3', 'eu1', 'af2'], 1.5, -1, 0.2, 2],
  ['LAURASIA', ['na2', 'eu2', 'as2'], 1.25, 0.2, 0.66, 2],
  ['GONDWANA', ['af2', 'af3', 'sa1', 'ind'], 1.25, 0.2, 0.66, 2],
  ['Tethys Sea', ['tet'], 0.9, -1, 0.8, 1],
  ['Panthalassa', [-140, -8], 0.9, -1, 0.6, 1],
  ['Pacific', [-150, -8], 0.9, 0.78, 9, 1],
  ['Atlantic', ['na3', 'af1', 'sa1'], 0.8, 0.82, 9, 1],
  ['North America', ['na1', 'na2'], 0.85, 0.7, 9, 0],
  ['South America', ['sa1', 'sa2'], 0.85, 0.7, 9, 0],
  ['Africa', ['af1', 'af2', 'af3'], 0.85, 0.7, 9, 0],
  ['Europe', ['eu2', 'scn'], 0.75, 0.74, 9, 0],
  ['Asia', ['as1', 'as3'], 0.85, 0.7, 9, 0],
  ['India', ['ind'], 0.75, 0.62, 9, 0],
  ['Antarctica', ['an1', 'an2'], 0.8, 0.7, 9, 0],
  ['Australia', ['au1'], 0.8, 0.7, 9, 0],
];
const ERA_COL = ['#c98a4b', '#7fae5b', '#4f9a63', '#56a58f', '#5b93c4', '#e2572e', '#9a8fb8'];

function drawOverlay(c, w, h, f, o, L, t, lon0) {
  c.clearRect(0, 0, w, h);
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
  const s = f.stage, font = (k, style = '') => `${style} ${Math.max(7, h * 0.034 * k).toFixed(1)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const text = (str, x, y, fill, a) => {
    if (a <= 0.01) return;
    c.globalAlpha = a; c.lineWidth = Math.max(2, h * 0.007); c.strokeStyle = 'rgba(6,10,18,0.75)'; c.strokeText(str, x, y);
    c.fillStyle = fill; c.fillText(str, x, y); c.globalAlpha = 1;
  };
  if (o.VIEW === 1 && o.LABELS >= 2) {
    const k = Math.min(1, w / h / 1.78);
    const proj = (lon, lat) => {
      let l = (lon * RAD - lon0) % (2 * Math.PI); if (l > Math.PI) l -= 2 * Math.PI; if (l < -Math.PI) l += 2 * Math.PI;
      let xn, yn; const ph = lat * RAD;
      if (o.PROJ === 1) {
        let th = ph; for (let i = 0; i < 6; i++) th -= (2 * th + Math.sin(2 * th) - Math.PI * Math.sin(ph)) / Math.max(0.05, 2 + 2 * Math.cos(2 * th));
        xn = l * Math.cos(th) / Math.PI; yn = Math.sin(th);
      } else { xn = l / Math.PI; yn = ph / (Math.PI / 2); }
      return [w / 2 + xn * 0.84 * k * h, h / 2 - (yn * 0.42 * k + 0.035) * h];
    };
    for (const [str, at, size, t0, t1, kind] of LABELS) {
      const a = ss(t0 - 0.06, t0 + 0.06, t) * (1 - ss(t1 - 0.06, t1 + 0.06, t));
      if (a <= 0.01) continue;
      let lon = 0, lat = 0;
      if (typeof at[0] === 'number') [lon, lat] = at;
      else { for (const n of at) { lon += L.lon[IDX[n]]; lat += L.lat[IDX[n]]; } lon /= at.length; lat /= at.length; }
      const [x, y] = proj(lon, lat);
      c.font = font(size, kind === 1 ? 'italic' : kind === 2 ? '600' : '500');
      text(kind === 2 ? str.split('').join(' ') : str, x, y, kind === 1 ? '#bfe3f2' : '#ffffff', a * (kind === 1 ? 0.85 : 0.95));
    }
    const ac = ss(0.845, 0.86, s);
    if (ac > 0.01) {
      const v = L.site, lat = Math.asin(v[1]) / RAD, lon = Math.atan2(v[0], v[2]) / RAD;
      const [x, y] = proj(lon, lat);
      c.font = font(0.75, '600'); text('Chicxulub', x, y - h * 0.05 * k, '#ffc9a0', ac);
    }
  }
  if (o.LABELS >= 1) {
    // the timeline: one coloured stretch for each chapter, a marker for now
    const x0 = w * 0.07, x1 = w * 0.93, y = h * 0.955, bh = Math.max(2, h * 0.012);
    for (let i = 0; i < STAGES.length; i++) {
      const a = STAGES[i].at, b = i + 1 < STAGES.length ? STAGES[i + 1].at : 1;
      c.globalAlpha = f.era.index === i ? 1 : 0.55; c.fillStyle = ERA_COL[i];
      c.fillRect(x0 + (x1 - x0) * a + 1, y - bh / 2, (x1 - x0) * (b - a) - 1, bh);
    }
    c.globalAlpha = 1;
    const mx = x0 + (x1 - x0) * s;
    c.fillStyle = '#fff'; c.strokeStyle = 'rgba(6,10,18,0.8)'; c.lineWidth = Math.max(1, h * 0.004);
    c.beginPath(); c.arc(mx, y, bh * 1.1, 0, 7); c.fill(); c.stroke();
    const ma = f.era.ma, when = f.era.id === 'impact' ? '66 million years ago' : `${Math.round(ma)} million years ago`;
    c.textAlign = 'left'; c.font = font(1.05, '600'); text(when, x0, y - h * 0.045, '#ffffff', 0.95);
    c.textAlign = 'right'; c.font = font(0.9, '500'); text(f.era.name, x1, y - h * 0.045, ERA_COL[f.era.index], 0.95);
  }
}

export default {
  ...base,
  create(gl, opts) {
    const o = { ...DEFAULTS, ...(opts || {}) };
    // shaderEngine keeps its program to itself; catch it as it is made so the extra uniforms can be set
    let prog = null;
    const make = gl.createProgram;
    gl.createProgram = function () { return (prog = make.call(this)); };
    let inst;
    try { inst = base.create(gl, opts); } finally { delete gl.createProgram; }
    let U = null;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const wantText = o.LABELS >= 1 && typeof document !== 'undefined';
    const cv = wantText ? document.createElement('canvas') : null, c2 = cv ? cv.getContext('2d') : null;
    let key = '';
    return {
      render(f) {
        if (!prog) { inst.render(f); prog = gl.getParameter(gl.CURRENT_PROGRAM); }
        if (!U) U = { B: gl.getUniformLocation(prog, 'uB'), D: gl.getUniformLocation(prog, 'uD'), site: gl.getUniformLocation(prog, 'uSite'), lab: gl.getUniformLocation(prog, 'uLab'), on: gl.getUniformLocation(prog, 'uLabOn') };
        const t = (1 - f.era.pangaea) + 0.12 * ss(0.8, 1, f.stage);
        const L = layout(t);
        gl.useProgram(prog);
        gl.uniform4fv(U.B, L.B); gl.uniform4fv(U.D, L.D); gl.uniform3fv(U.site, L.site);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
        if (c2) {
          const w = Math.min(1600, f.w), h = Math.round(w * f.h / f.w);
          const k2 = `${w}x${h}|${Math.round(f.stage * 2500)}|${Math.round(f.pointer.dragX * 400)}`;
          if (k2 !== key) {
            key = k2;
            if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
            drawOverlay(c2, w, h, f, o, L, t, o.LON0 * RAD - f.pointer.dragX * 2);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
          }
        }
        gl.uniform1i(U.lab, 0); gl.uniform1f(U.on, c2 ? 1 : 0);
        inst.render(f);
      },
      dispose() { gl.deleteTexture(tex); inst.dispose(); }
    };
  }
};

const d = (id, name, desc, tags, opts, params) => ({ id: 'earth-' + id, name, desc, tags, opts, params });
const HIT = { stage: 0.868, grow: 0.55 };
export const scenes = [
  d('globe', 'The Turning Globe', 'The Late Jurassic Earth from space: Pangaea coming apart, no ice at the poles. The continents are approximate. Drag to spin.',
    ['space', '3d', 'jurassic', 'globe'], { LON0: -20, LAT0: 12 }, { stage: 0.42, light: 0.78, x1: 0.5, x2: 0.5 }),
  d('pangaea', 'Pangaea', 'One supercontinent curled around the Tethys Sea, red and dry inside, 230 million years ago (approximate shapes).',
    ['space', '3d', 'triassic', 'globe', 'desert'], { LON0: 22, LAT0: 2, DIST: 2.9 }, { stage: 0.04, light: 0.85, x1: 0.12, x2: 0.4, scale: 0.55 }),
  d('deeptime', '180 Million Years in Two Minutes', 'Watch Pangaea split, the Atlantic open and India run north, until the asteroid arrives. An approximate reconstruction.',
    ['space', '3d', 'time travel', 'globe', 'impact'], { LON0: -25, LAT0: 15, LABELS: 1 }, { stage: 0.0, grow: 0.5, light: 0.85, x1: 0.25, x2: 0.4 }),
  d('map', 'Drifting Continents Map', 'The whole world on one page, with names, as the continents move from Pangaea to nearly today’s places (approximate). Drag to slide the map.',
    ['map', '2d', 'time travel', 'diagram', 'triassic', 'jurassic', 'cretaceous'], { VIEW: 1, PROJ: 1, LABELS: 2, MARK: 1, CLOUDK: 0.45, RELK: 8.0 }, { stage: 0.0, grow: 0.45, light: 0.9, x2: 0.4 }),
  d('seaways', 'Atlas of the High Seas', 'A Late Cretaceous atlas page: seas so high that shallow water floods the continents and splits North America in two (approximate).',
    ['map', '2d', 'cretaceous', 'diagram', 'water'], { VIEW: 1, PROJ: 0, STYLE: 1, LABELS: 2, MARK: 1, CLOUDK: 0, RELK: 9.0 }, { stage: 0.8, light: 1 }),
  d('impact', 'Chicxulub from Orbit', 'The asteroid comes in over the Gulf of Mexico: flash, shock ring, ejecta, a rain of fire, then soot greys the planet. Lower Time travel to slow it down.',
    ['space', '3d', 'impact', 'time travel', 'cretaceous'], { LON0: -78, LAT0: 16, DIST: 3.0 }, { ...HIT, light: 0.72, x1: 0, x2: 0.4 }),
  d('asteroid', 'The Asteroid’s View', 'Riding a rock about 10 km wide as the Earth swells ahead, down to the Yucatán. Then the view pulls back to watch what it did.',
    ['space', '3d', 'impact', 'time travel', 'asteroid'], { VIEW: 2, VOLC: 0 }, { ...HIT, light: 0.75, x2: 0.4 }),
  d('crater', 'Crater in a Shallow Sea', 'Low over the Yucatán shelf: the fireball, the ejecta curtain, tsunami rings racing across the Gulf, and the flooded crater left behind.',
    ['space', '3d', 'impact', 'time travel', 'water'], { VIEW: 3, FINE: 1, OCTS: 7, WAVEF: 420, SPARKF: 420, SHELLH: 0.6, RELK: 5.0, VOLC: 0 }, { ...HIT, light: 0.8, x1: 0.3, x2: 0.3 }),
  d('night', 'Night of Fire', 'The night side of the Cretaceous Earth: lightning, volcanoes and aurora, until glowing debris falls around the world and the forests burn.',
    ['space', '3d', 'night', 'impact', 'time travel'], { LON0: -100, LAT0: 20, DIST: 3.0 }, { ...HIT, light: 0.12, x1: 0, x2: 0.45, x3: 0.6 }),
  d('moon', 'Seen from the Moon', 'From beyond the Moon, to scale: a small blue planet, and a spark on it bright enough to see from 380,000 km away.',
    ['space', '3d', 'impact', 'time travel', 'moon'], { VIEW: 4, RETICLE: 0 }, { ...HIT, light: 0.7, x1: 0, x2: 0.45 }),
];
