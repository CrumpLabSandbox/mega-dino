// Dinosaur 3D: a raymarched dinosaur you can orbit by dragging.
// Each frame the shared rig poses one to three animals walking on the spot (the ground scrolls under them at the
// speed their feet say it should). The pose becomes a list of round cones (capsules(pose) for the spine and limbs,
// plus a skull, jaw, eyes, horns, and flat shapes for plates, frills, sails and feathers built here) that is
// uploaded as uniform arrays. The fragment shader sphere-traces their smooth union, with a per-ray bit mask so each
// step only looks at the few shapes the ray can touch, and shades skin, shadow and ambient occlusion on a rolling
// fern prairie with stylised ferns, cycads and boulders.
import { compile, fullscreenVS, HEADER, NOISE, DINO } from '../gl.js';
import { pose, capsules, gait, at, HEADS, CRESTS } from '../rig.js';
import { species, standIn } from '../species.js';
import { clamp, lerp, smooth } from '../util.js';

const MAXP = 144, MAXA = 3;
const PI = Math.PI, TAU = PI * 2;

const FS = `
#define MAXP ${MAXP}
#define MAXA ${MAXA}
uniform vec4 uPA[MAXP];     // shape end a (xyz) and its radius
uniform vec4 uPB[MAXP];     // shape end b (xyz) and its radius
uniform vec4 uPC[MAXP];     // xyz = thin axis * half thickness (zero for a round shape), w = tone
uniform int uNA;            // animals on stage
uniform vec4 uAni[MAXA];    // bounding sphere
uniform vec4 uAniM[MAXA];   // first shape, end shape, spine shapes, pattern
uniform vec4 uAniF[MAXA];   // body length, fuzz, scutes, seed
uniform vec4 uAniO[MAXA];   // origin xyz
uniform vec3 uCol[MAXA*4];  // body, belly, markings, display
uniform vec3 uCam, uTgt;
uniform vec4 uView;         // framing unit (m), focal length, ground scroll (m), half width of the bare track (m)
uniform vec4 uGround;       // hill height, plant density, share of rocks, wetness
uniform vec4 uMode;         // clay, plinth radius, plinth height, plant size (m)
uniform vec3 uSoil, uVeg;

Era E;
float U, SCROLL, TRACK, PS, CS, PH, AMP, CLAY, RP, PLH, DENS, ROCK, WET, PFAR, DAYP, NIGHT, SUNI;
vec3 SUN, MOON, KEY, KEYC, AMB, IMP, CAM;
uint MASK[5];

float smin(float a, float b, float k){ float h = max(k - abs(a - b), 0.)/k; return min(a, b) - h*h*k*.25; }

// round cone between a and b (Inigo Quilez)
float sdRC(vec3 p, vec3 a, vec3 b, float r1, float r2){
  vec3 ba = b - a; float l2 = dot(ba, ba), rr = r1 - r2, a2 = l2 - rr*rr, il2 = 1./l2;
  vec3 pa = p - a; float y = dot(pa, ba), z = y - l2;
  vec3 xv = pa*l2 - ba*y; float x2 = dot(xv, xv), y2 = y*y*l2, z2 = z*z*l2;
  float k = sign(rr)*rr*rr*x2;
  if (sign(z)*a2*z2 > k) return sqrt(x2 + z2)*il2 - r2;
  if (sign(y)*a2*y2 < k) return sqrt(x2 + y2)*il2 - r1;
  return (sqrt(x2*a2*il2) + y*rr)*il2 - r1;
}
float sdShape(vec3 p, vec4 A, vec4 B, vec4 C){
  float t2 = dot(C.xyz, C.xyz);
  if (t2 > 0.) {                       // a flat shape: the round cone's outline in a plane, with a thickness
    float th = sqrt(t2); vec3 n = C.xyz/th; float dn = dot(p - A.xyz, n);
    float d2 = sdRC(p - n*dn, A.xyz, B.xyz, A.w, B.w), rn = th*.6;
    vec2 w = vec2(d2 + rn, abs(dn) - th + rn);
    return min(max(w.x, w.y), 0.) + length(max(w, 0.)) - rn;
  }
  return sdRC(p, A.xyz, B.xyz, A.w, B.w);
}
bool on(int i){ return ((MASK[i >> 5] >> uint(i & 31)) & 1u) != 0u; }
// mark the shapes that come within pad of a ray's first tmax metres (anything else is at least pad away)
void buildMask(vec3 ro, vec3 rd, float tmax, float pad){
  for (int w = 0; w < 5; w++) MASK[w] = 0u;
  for (int a = 0; a < MAXA; a++) {
    if (a >= uNA) break;
    vec4 bs = uAni[a]; vec3 oc = ro - bs.xyz; float bw = bs.w*1.04 + pad, b = dot(oc, rd), c = dot(oc, oc) - bw*bw;
    if (b*b - c < 0. || (c > 0. && b > 0.)) continue;
    int i0 = int(uAniM[a].x), i1 = int(uAniM[a].y);
    for (int i = i0; i < i1; i++) {
      vec4 A = uPA[i], B = uPB[i];
      vec3 ba = B.xyz - A.xyz, oa = ro - A.xyz;
      float oad = dot(oa, rd), dba = dot(rd, ba), baba = dot(ba, ba), oaba = dot(oa, ba);
      float den = max(baba - dba*dba, 1e-6*baba);
      float tr = clamp((dba*oaba - oad*baba)/den, 0., tmax);
      float ts = clamp((oaba + tr*dba)/baba, 0., 1.);
      tr = clamp(dot(A.xyz + ba*ts - ro, rd), 0., tmax);
      vec3 dv = A.xyz + ba*ts - ro - rd*tr;
      float r = max(A.w, B.w)*1.55 + .012*U + pad;
      if (dot(dv, dv) < r*r) MASK[i >> 5] |= (1u << uint(i & 31));
    }
  }
}
float map(vec3 p){
  float d = 1e9;
  for (int a = 0; a < MAXA; a++) {
    if (a >= uNA) break;
    vec4 bs = uAni[a]; float bd = length(p - bs.xyz) - bs.w;
    if (bd > .03*bs.w) { d = min(d, bd); continue; }
    int i0 = int(uAniM[a].x), i1 = int(uAniM[a].y);
    for (int i = i0; i < i1; i++) {
      if (!on(i)) continue;
      vec4 A = uPA[i], B = uPB[i], C = uPC[i];
      float di = sdShape(p, A, B, C);
      float k = (C.w < .5 ? .16 : C.w < 2.5 ? .45 : dot(C.xyz, C.xyz) > 0. ? .02 : .1)*max(A.w, B.w) + 1e-4;
      d = smin(d, di, k);
    }
  }
  return d;
}
vec3 mapN(vec3 p, float e){
  vec2 k = vec2(1., -1.);
  return normalize(k.xyy*map(p + k.xyy*e) + k.yyx*map(p + k.yyx*e) + k.yxy*map(p + k.yxy*e) + k.xxx*map(p + k.xxx*e));
}

// ---------------------------------------------------------------- ground
float flatMask(vec2 xz){
  if (RP > 0.) return smoothstep(RP*1.3, RP*3.2, length(xz));
  return smoothstep(TRACK, TRACK*2.8, abs(xz.y));
}
float gH(vec2 xz){
  vec2 P = (xz + vec2(SCROLL, 0.))/U;
  float n = noise2(P*.27) - .5 + .45*(noise2(P*.71 + 7.3) - .5);
  return n*AMP*flatMask(xz);
}
vec3 gN(vec2 xz, float e){
  float hx = gH(xz + vec2(e, 0.)) - gH(xz - vec2(e, 0.)), hz = gH(xz + vec2(0., e)) - gH(xz - vec2(0., e));
  return normalize(vec3(-hx, 2.*e, -hz));
}
float groundMarch(vec3 ro, vec3 rd, float far){
  float top = AMP*.75, t = 0.;
  if (ro.y > top) { if (rd.y >= 0.) return -1.; t = (ro.y - top)/(-rd.y); }
  float slope = .45*AMP/U + .05, ld = 0., dt = 0.;
  for (int i = 0; i < 40; i++) {
    vec3 p = ro + rd*t; float dy = p.y - gH(p.xz);
    if (dy < .0012*t) { if (i > 0 && dy < 0.) t -= dt*(-dy)/(ld - dy); return t; }
    if (t > far || (rd.y > 0. && p.y > top)) break;
    dt = dy/(max(-rd.y, 0.) + slope); ld = dy; t += dt;
  }
  return rd.y < -1e-4 ? max(t, ro.y/(-rd.y)) : -1.;
}
// what the animals cast on a point: x = shadow of the key light, y = ambient occlusion
vec2 castOn(vec3 p, vec3 n){
  float sh = 1., occ = 0.;
  for (int a = 0; a < MAXA; a++) {
    if (a >= uNA) break;
    vec4 bs = uAni[a]; vec3 oc = p - bs.xyz; float b = dot(oc, KEY), c = dot(oc, oc) - bs.w*bs.w*1.7;
    bool ray = !(b*b - c < 0. || (c > 0. && b > 0.)), near = c < 0.;
    if (!ray && !near) continue;
    int i0 = int(uAniM[a].x), i1 = int(uAniM[a].y);
    for (int i = i0; i < i1; i++) {
      vec4 A = uPA[i], B = uPB[i];
      float flt = dot(uPC[i].xyz, uPC[i].xyz) > 0. ? .6 : 1.;
      vec3 ba = B.xyz - A.xyz, oa = p - A.xyz;
      float baba = dot(ba, ba), oaba = dot(oa, ba);
      if (ray) {
        float oad = dot(oa, KEY), dba = dot(KEY, ba);
        float den = max(baba - dba*dba, 1e-6*baba);
        float tx = max((dba*oaba - oad*baba)/den, 1e-4), ty = clamp((oaba - oad*dba)/den, 0., 1.);
        float d = length(A.xyz + ba*ty - p - KEY*tx) - mix(A.w, B.w, ty)*flt;
        float s = clamp(7.*d/tx + .5, 0., 1.);
        sh = min(sh, s*s*(3. - 2.*s));
      }
      if (near) {
        float h = clamp(oaba/baba, 0., 1.); vec3 dv = A.xyz + ba*h - p; float l2 = dot(dv, dv), r = mix(A.w, B.w, h)*flt;
        occ = max(occ, max(dot(dv, n), 0.)*inversesqrt(l2)*clamp(r*r/l2, 0., 1.));
      }
    }
  }
  return vec2(sh, 1. - .8*occ);
}

// ---------------------------------------------------------------- plants and rocks (one per ground cell)
float PKIND, PSEED, PRR;
vec3 PRD; float PEXIT;
// distance along the marching ray to the wall of this ground cell
float cellExit(vec2 f){ vec2 d = PRD.xz; vec2 tt = (.5*CS - f*sign(d))/max(abs(d), vec2(1e-5)); return min(tt.x, tt.y) + .02*CS; }
float cellKeep(vec2 cw){
  float keep = RP > 0. ? smoothstep(RP*1.15, RP*1.7, length(cw)) : smoothstep(TRACK, TRACK*1.4, abs(cw.y));
  float dc = length(cw - CAM.xz);
  return keep*smoothstep(.3*U, 1.*U, dc)*(1. - smoothstep(.7*PFAR, PFAR, dc));
}
float plantMap(vec3 p){
  float y = p.y - gH(p.xz);
  PEXIT = 1e9;
  if (y > PH) return (y - PH)*.6 + .25*PS;
  vec2 P = p.xz + vec2(SCROLL, 0.);
  vec2 id = floor(P/CS), f = P - (id + .5)*CS;
  PEXIT = cellExit(f);
  vec2 h2 = hash22(id + 17.3); float hk = hash12(id*1.31 + 5.7);
  if (hk > DENS) return 1e3;
  vec2 jit = (h2 - .5)*.36*CS;
  float sc = cellKeep((id + .5)*CS + jit - vec2(SCROLL, 0.))*(.6 + .4*h2.x);
  if (sc < .1) return 1e3;
  vec3 q = vec3(f.x - jit.x, y, f.y - jit.y)/sc;
  float d, kind = hash12(id*2.17 + 1.3);
  PSEED = hk/max(DENS, .01);
  if (kind < ROCK) {
    vec3 e = vec3(.2 + .1*h2.y, .1 + .08*h2.x, .16 + .1*hk)*CS;
    vec3 qq = q - vec3(0., e.y*.3, 0.); qq.xz = rot2(qq.xz, h2.x*6.);
    d = (length(qq/e) - 1.)*min(e.x, min(e.y, e.z));
    d = max(d, dot(qq, vec3(.63, .7, .33)) - e.y*.7); d = max(d, dot(qq, vec3(-.5, .62, -.6)) - e.y*.78); d = max(d, dot(qq, vec3(.1, .8, .59)) - e.y*.74) - .012*CS;
    PKIND = 0.; PRR = clamp(q.y/(e.y*1.3), 0., 1.);
  } else {
    float R = .3*CS, hgt = PS*(.7 + .5*h2.y);
    float trunk = kind > .84 ? PS*(.5 + .9*h2.x) : 0.;
    vec3 qt = q; qt.y -= clamp(qt.y, 0., trunk);
    float dT = trunk > 0. ? length(qt) - R*(.13 + .02*sin(q.y*26./PS)) : 1e9;
    vec3 qf = q - vec3(0., trunk, 0.);
    qf.xz -= windDir()*sin(uTime*1.3 + hk*40.)*.03*max(qf.y, 0.);
    float r = length(qf.xz), ang = atan(qf.z, qf.x) + h2.x*TAU;
    float sec = TAU/9., fi = floor(ang/sec), a = ang - (fi + .5)*sec, rr = r/R;
    float hf = hgt*(.6 + .4*hash11(fi + h2.y*31.));
    float yc = hf*(2.1*rr - 1.45*rr*rr);
    float w = R*.15*sin(PI*clamp(rr*.95 + .03, 0., 1.))*(.55 + .45*abs(cos(rr*19.))) + .012*R;
    vec2 e2 = vec2(abs(r*sin(a)) - w, abs(qf.y - yc) - .022*R - .012*hgt);
    d = min(max(e2.x, e2.y), 0.) + length(max(e2, 0.)) - .012*R;
    d = max(d, r - R)*.4;
    PKIND = dT < d ? 2. : 1.; PRR = dT < d ? clamp(q.y/max(trunk, 1e-3), 0., 1.) : rr;
    d = min(d, dT);
  }
  return d*sc;
}
vec3 plantN(vec3 p, float e){
  vec2 k = vec2(1., -1.); PRD = vec3(0.);
  return normalize(k.xyy*plantMap(p + k.xyy*e) + k.yyx*plantMap(p + k.yyx*e) + k.yxy*plantMap(p + k.yxy*e) + k.xxx*plantMap(p + k.xxx*e));
}

// ---------------------------------------------------------------- sky
vec3 skyBase(vec3 rd){
  vec3 c = skyColor(rd, SUN, DAYP);
  c = mix(c, mix(vec3(.04, .055, .11), vec3(.008, .014, .045), pow(max(rd.y, 0.), .5)), NIGHT*.92);
  c = mix(c, vec3(.24, .18, .14)*(.3 + .7*smoothstep(0., .6, uLight)), E.dark*.9);
  c += vec3(1., .6, .28)*E.flash*(.3 + 1.3*exp(-max(rd.y, 0.)*5.)*(.5 + .5*dot(normalize(rd.xz + 1e-4), IMP.xz)));
  return c;
}
vec3 skyAll(vec3 rd){
  vec3 c = skyBase(rd);
  float clear = 1. - E.dark;
  if (NIGHT > .01) {
    vec3 q = rd*210.; vec3 qi = floor(q);
    float st = step(.9955, hash13(qi))*pow(hash13(qi + 7.), 2.)*smoothstep(.75, .2, length(fract(q) - .5));
    c += st*NIGHT*clear*smoothstep(0., .15, rd.y)*1.4;
    float m = max(dot(rd, MOON), 0.);
    c += (vec3(.95, .95, .88)*smoothstep(.9994, .9996, m) + vec3(.3, .36, .5)*pow(m, 60.)*.5)*NIGHT*clear;
  }
  // thin high cloud
  if (rd.y > 0.) {
    vec2 cp = rd.xz/(rd.y + .12)*1.3 + vec2(uTime*.004, 0.);
    float cl = smoothstep(.5, .85, fbm2(cp*vec2(1., 2.2), 4.))*smoothstep(0., .25, rd.y)*.35*clear;
    c = mix(c, c*.6 + mix(vec3(.9, .55, .35), vec3(1.), smoothstep(.1, .45, uLight))*(.55 - .5*NIGHT), cl);
  }
  // the asteroid
  if (E.meteor > 0.) {
    vec3 from = normalize(vec3(-IMP.x*.3 + .5, .8, -IMP.z*.3 - .4)), to = normalize(vec3(IMP.x, .02, IMP.z));
    vec3 mp = normalize(mix(from, to, min(E.meteor, 1.)));
    float dd = acos(clamp(dot(rd, mp), -1., 1.));
    vec3 tl = normalize(from - to); float along = dot(rd - mp, tl), side = length(rd - mp - tl*along);
    float tail = smoothstep(.5, 0., along)*step(0., along)*exp(-side*side*2500./(1. + along*40.));
    c += vec3(1., .85, .6)*(exp(-dd*dd*4000.)*3. + exp(-dd*30.)*.6 + tail)*(1. - smoothstep(1., 1.1, E.meteor));
  }
  return c;
}

// ---------------------------------------------------------------- shading
vec3 soilCol(){ vec3 s = mix(uSoil, vec3(.62, .37, .22), clamp((E.dry - .35)*.7, 0., .5)); return mix(s, vec3(.2, .19, .185), E.dark*.85); }
vec3 vegCol(){ vec3 v = mix(uVeg, vec3(.42, .4, .16), clamp((E.dry - .3)*.9, 0., .6)); v = mix(v, vec3(.16, .36, .1), E.ferns*.7); return mix(v, vec3(.12, .1, .08), E.dark*.9); }

vec3 light(vec3 col, vec3 n, vec3 rd, float sh, float ao, float gloss){
  float dif = max(dot(n, KEY), 0.);
  vec3 c = col*(KEYC*dif*sh + AMB*(.55 + .45*n.y)*ao + soilCol()*SUNI*.22*max(-n.y*.7 + .3, 0.)*ao);
  vec3 hv = normalize(KEY - rd);
  c += KEYC*pow(max(dot(n, hv), 0.), gloss > 1. ? 160. : 28.)*gloss*sh*dif;
  c += vec3(1., .55, .25)*E.flash*col*(.4 + max(dot(n, IMP), 0.));
  return c;
}

vec3 shadeGround(vec3 p, vec3 rd, float t){
  vec2 P = p.xz + vec2(SCROLL, 0.);
  float lod = clamp(1. - t/(30.*U), 0., 1.), oct = mix(1.5, mix(3., 5., uDetail), lod);
  vec3 n = gN(p.xz, .02*U + .002*t);
  float fm = flatMask(p.xz);
  float n1 = fbm2(P*(1.1/PS), oct), n2 = fbm2(P*(.33/PS) + 31., min(oct, 3.));
  float wl = worley2(P*(3.4/PS));
  vec3 soil = soilCol()*(.72 + .55*n1), veg = vegCol()*(.5 + .5*n1)*mix(1., .55 + .9*wl, lod);
  float cover = smoothstep(.42, .62, n2 + (fm - .5)*.42 + (DENS - .5)*.3 - E.dark*.3 + E.ferns*.15);
  vec3 col = mix(soil, veg, cover*(.85 - .2*n1));
  // pebbles, and flowers once there are any
  float wv = worley2(P*(2.6/PS));
  col *= .86 + .2*smoothstep(.1, .5, wv)*lod + .14*(1. - lod);
  vec2 fp = P*(4.5/PS), fi = floor(fp);
  float fl = step(.9, hash12(fi))*smoothstep(.22, .1, length(fract(fp) - .3 - .4*hash22(fi)))*cover*smoothstep(.55, .9, lod)*E.flowers*(1. - E.dark);
  col = mix(col, mix(vec3(.93, .9, .74), vec3(.86, .62, .7), step(.6, hash12(fi + 3.))), fl*.75);
  n = normalize(n + vec3(n1 - .5, 0., fbm2(P*(1.1/PS) + 9., oct) - .5)*.5*lod);
  // puddles on wet ground
  float pud = WET*smoothstep(.36, .3, n2 + .12*n1)*(1. - fm)*(1. - CLAY);
  // each plant darkens the ground it stands on
  vec2 id = floor(P/CS), f = P - (id + .5)*CS; float hk = hash12(id*1.31 + 5.7), pao = 1.;
  if (hk < DENS) { vec2 jit = (hash22(id + 17.3) - .5)*.36*CS; float sc = cellKeep((id + .5)*CS + jit - vec2(SCROLL, 0.));
    pao = 1. - .5*sc*smoothstep(.34*CS, .06*CS, length(f - jit + KEY.xz*.05*CS)); }
  if (CLAY > .5) { col = vec3(.5, .49, .47)*(.92 + .16*n1); pud = 0.; }
  vec2 so = castOn(p, n);
  vec3 c = light(col, n, rd, so.x, so.y*pao, .03);
  if (pud > .01) { vec3 rr = reflect(rd, vec3(0., 1., 0.)); float fr = .25 + .75*pow(1. - max(-rd.y, 0.), 4.);
    c = mix(c, c*.35 + skyBase(rr)*fr*(.4 + .6*so.x), pud); }
  return c;
}
vec3 shadePlinth(vec3 p, vec3 n, vec3 rd){
  float m = fbm2(p.xz*(2.5/U) + p.y*9., 4.);
  vec3 col = mix(vec3(.5, .48, .45), vec3(.66, .64, .6), m)*(n.y > .5 ? 1. : .8 + .2*sin(p.y*90./U));
  vec2 so = castOn(p, n);
  return light(col, n, rd, so.x, so.y, .12);
}
vec3 shadePlant(vec3 p, vec3 rd, float t){
  vec3 n = plantN(p, .012*PS + .001*t);
  plantMap(p);
  float kind = PKIND, rr = PRR, sd = PSEED;
  vec3 veg = vegCol(), col;
  if (kind < .5) col = mix(mix(vec3(.36, .34, .31), vec3(.56, .53, .48), noise3(p*(5./PS))), vegCol()*.8, .5*smoothstep(.55, .75, noise3(p*(2.2/PS) + 5.))*(1. - E.dark))*(.7 + .3*rr);
  else if (kind > 1.5) col = mix(vec3(.3, .2, .12), vec3(.42, .3, .18), rr)*(1. - .5*E.dark);
  else col = mix(veg*.38, veg*vec3(.8, .86, .68), smoothstep(.05, 1., rr))*(.75 + .45*sd);
  if (CLAY > .5) col = vec3(.5, .49, .47);
  vec2 so = castOn(p, n);
  float ao = kind < .5 ? .6 + .4*rr : .45 + .55*smoothstep(0., .8, rr);
  float wrap = kind < .5 ? 0. : .35;
  vec3 nn = normalize(mix(n, vec3(0., 1., 0.), wrap));
  return light(col, nn, rd, so.x, ao*so.y, kind < .5 ? .05 : .15);
}
vec3 shadeAnimal(vec3 p, vec3 rd, float t){
  vec3 n = mapN(p, max(.0025*U, .0012*t));
  // which shape is this?
  int idx = 0; float best = 1e9;
  for (int a = 0; a < MAXA; a++) {
    if (a >= uNA) break;
    int i0 = int(uAniM[a].x), i1 = int(uAniM[a].y);
    for (int i = i0; i < i1; i++) { if (!on(i)) continue; float d = sdShape(p, uPA[i], uPB[i], uPC[i]); if (d < best) { best = d; idx = i; } }
  }
  int a = 0;
  for (int k = 1; k < MAXA; k++) if (k < uNA && idx >= int(uAniM[k].x)) a = k;
  vec4 A = uPA[idx], B = uPB[idx], C = uPC[idx], M = uAniM[a], Fz = uAniF[a];
  float tone = C.w;
  vec3 ba = B.xyz - A.xyz; float hh = clamp(dot(p - A.xyz, ba)/dot(ba, ba), 0., 1.);
  float li = float(idx) - M.x, s = (li + hh)/M.z;
  vec3 cb = uCol[a*4], cv = uCol[a*4 + 1], cm = uCol[a*4 + 2], cd = uCol[a*4 + 3];
  vec3 q = (p - uAniO[a].xyz)/Fz.x;
  float wob = noise3(q*11. + Fz.w*9.) - .5, pat = M.w;
  float under = smoothstep(.1, -.6, n.y), back = smoothstep(-.25, .65, n.y + wob*.3);
  float stripe = clamp(uX3*2., 0., 1.6);
  float ao = 1., gloss = .1;
  vec3 col;
  if (tone < 2.5) {
    bool spine = tone < .5, limb = tone > .5 && tone < 1.5;
    float ss = spine ? s : .9 + hh*.05, mk;
    if (limb) {
      mk = (pat > .5 && pat < 2.5) ? .7*smoothstep(.2, .6, sin(hh*9. + li*2.1)) : pat < .5 ? .4*back : pat < 3.5 ? 0. : .9*smoothstep(-.2, .45, n.y + wob*.5);
    } else if (pat < .5) mk = .4*back;
    else if (pat < 1.5) mk = smoothstep(0., .22, sin(ss*190. + wob*3.)*.5 + .5 - (1. - back)*1.1 - .28);
    else if (pat < 2.5) mk = ss < .47 ? smoothstep(-.1, .25, sin(ss*130.)) : smoothstep(0., .22, sin(ss*150. + wob*3.)*.5 + .5 - (1. - back)*1.2 - .3);
    else if (pat < 3.5) mk = smoothstep(.34, .22, worley2(vec2(ss*46., n.y*2.2 + (n.z > 0. ? 5. : 0.))))*back;
    else mk = .9*smoothstep(-.2, .45, n.y + wob*.5);
    col = mix(cb, cm, clamp(mk*stripe, 0., 1.));
    col = mix(col, cv, under*(spine ? smoothstep(.02, .2, s) : 1.));
    col *= mix(.74, 1., smoothstep(0., .1*Fz.x, p.y - PLH));
    if (tone > 1.5) col = mix(col, cd, .32*smoothstep(.35, .95, n.y)*stripe);
    // skin: scales, armour or feathers
    float fine = uDetail*smoothstep(26.*U, 5.*U, t);
    if (Fz.y > .5) col *= 1. + (noise3(q*vec3(50., 150., 150.)) - .5)*.45*fine;
    else { float sc = worley3(q*(70. + 60.*uDetail)); col *= 1. + (sc - .5)*.3*fine; n = normalize(n + (sc - .5)*.35*fine*normalize(q + .01)); }
    if (Fz.z > .5 && spine) { float w = worley2(vec2(s*44., atan(n.z, n.y)*3.2));
      float b2 = smoothstep(-.3, .2, n.y)*smoothstep(.36, .2, w); col = mix(col, cm*1.15 + .04, b2*.85); n = normalize(n + vec3(0., b2*.5, 0.)); }
  } else if (tone < 3.5) {
    col = mix(mix(cb, cd, .45), cd, smoothstep(.1, .8, hh))*(.86 + .28*sin(dot(q, vec3(260., 60., 0.)) + wob*6.)*smoothstep(26.*U, 6.*U, t));
    col = mix(col, cm, .25*clamp(stripe, 0., 1.)*smoothstep(.75, 1., hh));
  } else if (tone < 4.5) { col = vec3(.9, .86, .74)*mix(.55, 1.05, hh); gloss = .3; }
  else if (tone < 5.5) { float ez = abs(normalize(p - A.xyz).z); col = mix(vec3(.8, .6, .12), vec3(.02), smoothstep(.8, .86, ez)); gloss = 3.; }
  else if (tone < 6.5) col = cm*1.25 + .03;
  else if (tone < 7.5) { float rd2 = length(p - .5*(A.xyz + B.xyz))/(A.w + .5*length(ba));
    col = mix(cb, cd, (.25 + .6*smoothstep(.45, .7, rd2)*smoothstep(1., .8, rd2))*clamp(stripe + .3, 0., 1.)); col = mix(col, cv, .5*smoothstep(.85, 1., rd2)); }
  else { col = mix(cb*.85, cm, smoothstep(.35, .9, hh))*(.85 + .3*sin(dot(q, vec3(420., 120., 0.)))*smoothstep(20.*U, 5.*U, t)); col = mix(col, cd, .25*smoothstep(.8, 1., hh)*stripe); }
  if (CLAY > .5) { col = vec3(.6, .58, .55); gloss = .05; }
  // ambient occlusion from the body itself, then from the ground below
  float aou = .1*U, o = 0., w = 1.;
  buildMask(p, n, aou, aou);
  for (int i = 0; i < 4; i++) { float h = (.12 + .29*float(i))*aou; o += (h - min(map(p + n*h), aou))*w; w *= .72; }
  ao = clamp(1. - mix(1.5, 2.6, CLAY)*o/aou, 0., 1.);
  ao *= mix(.62, 1., smoothstep(0., .3*U, p.y - PLH + (n.y + 1.)*.12*U));
  // shadow of the key light: the rest of the body
  float sh = 1.;
  if (dot(n, KEY) > 0.) {
    vec3 so = p + n*.012*U; float tm = 2.4*U, pad = tm/14.; buildMask(so, KEY, tm, pad);
    float ts = .02*U;
    for (int i = 0; i < 20; i++) {
      float d = min(map(so + KEY*ts), pad); sh = min(sh, 14.*d/ts);
      if (sh < .02 || ts > tm) break;
      ts += clamp(d, .02*U, .3*U);
    }
    sh = smoothstep(0., 1., clamp(sh, 0., 1.));
  }
  vec3 c = light(col, n, rd, sh, ao, gloss);
  float rim = pow(1. - max(dot(n, -rd), 0.), 3.);
  c += rim*(AMB*.45 + KEYC*.12*NIGHT)*ao*(.4 + .6*max(n.y, 0.))*(1. + CLAY);
  return c;
}

void main(){
  E = era(uStage);
  U = uView.x; SCROLL = uView.z; TRACK = uView.w; PS = uMode.w; CS = 2.4*PS; PH = 2.6*PS; CLAY = uMode.x; RP = uMode.y; PLH = uMode.z;
  AMP = uGround.x*U; ROCK = uGround.z; WET = uGround.w; PFAR = 9.*U;
  DENS = clamp(uGround.y*(1.25 - .8*E.dry + .5*E.ferns)*(1. - .55*E.dark)*(.45 + .9*uDetail), 0., .95);
  // light: the sun by day, the moon by night
  float sunE = (uLight - .12)*1.05, sc = sqrt(max(1. - sunE*sunE, .01));
  SUN = normalize(vec3(.62*sc, sunE, .78*sc)); MOON = normalize(vec3(-.5, .52, .62)); IMP = normalize(vec3(-.8, .12, -.6));
  NIGHT = smoothstep(.2, .03, uLight);
  DAYP = mix(-.5, .12, smoothstep(0., .12, uLight)) + max(uLight - .12, 0.);
  float dim = 1. - .8*E.dark;
  SUNI = smoothstep(-.02, .12, sunE)*dim;
  float moonI = NIGHT*.85*dim;
  bool day = SUNI > .02;
  KEY = day ? SUN : MOON;
  KEYC = day ? mix(vec3(1.25, .62, .3), vec3(1.12, 1.07, .98), smoothstep(0., .45, sunE))*SUNI*1.12 : vec3(.62, .78, 1.15)*moonI;
  AMB = mix(vec3(.1, .135, .23), vec3(.56, .64, .76), smoothstep(0., .5, uLight))*(1. - .7*E.dark) + vec3(.06, .045, .035)*E.dark;

  vec2 uv = (gl_FragCoord.xy - .5*uRes)/uRes.y*2.;
  vec3 ro = uCam; ro.y = max(ro.y, gH(ro.xz) + .1*U); CAM = ro;
  vec3 fw = normalize(uTgt - ro), rt = normalize(cross(fw, vec3(0., 1., 0.))), up = cross(rt, fw);
  float F = uView.y;
  float shift = clamp(-fw.y*F/max(up.y, .2) + .12, -.4, .4);     // keeps the horizon near 0.56 of the height
  vec3 rd = normalize(fw*F + rt*uv.x + up*(uv.y + shift));

  float far = 400.*U, tHit = -1.; int what = 0;
  vec3 pn = vec3(0., 1., 0.);
  float tG = groundMarch(ro, rd, 60.*U);
  if (tG > 0.) { tHit = tG; what = 1; }
  // the plinth of a turntable
  if (RP > 0.) {
    float tt = -1.;
    if (rd.y < 0. && ro.y > PLH) { float t1 = (ro.y - PLH)/(-rd.y); if (length(ro.xz + rd.xz*t1) < RP) { tt = t1; pn = vec3(0., 1., 0.); } }
    if (tt < 0.) { float a = dot(rd.xz, rd.xz), b = dot(ro.xz, rd.xz), c = dot(ro.xz, ro.xz) - RP*RP, h = b*b - a*c;
      if (h > 0.) { float t1 = (-b - sqrt(h))/a; float y = ro.y + rd.y*t1; if (t1 > 0. && y < PLH && y > -.2*U) { tt = t1; pn = normalize(vec3(ro.x + rd.x*t1, 0., ro.z + rd.z*t1)); } } }
    if (tt > 0. && (tHit < 0. || tt < tHit)) { tHit = tt; what = 4; }
  }
  // the animals
  if (uNA > 0) {
    float t0 = 1e9, t1 = -1.;
    for (int a = 0; a < MAXA; a++) { if (a >= uNA) break;
      vec4 bs = uAni[a]; vec3 oc = ro - bs.xyz; float b = dot(oc, rd), c = dot(oc, oc) - bs.w*bs.w, h = b*b - c;
      if (h > 0.) { h = sqrt(h); if (-b + h > 0.) { t0 = min(t0, max(-b - h, 0.)); t1 = max(t1, -b + h); } } }
    if (tHit > 0.) t1 = min(t1, tHit);
    if (t1 > t0) {
      buildMask(ro, rd, 1e9, 0.);
      if ((MASK[0] | MASK[1] | MASK[2] | MASK[3] | MASK[4]) != 0u) {
        float t = t0; int steps = int(mix(34., 80., uDetail));
        for (int i = 0; i < 80; i++) {
          if (i >= steps || t > t1) break;
          float d = map(ro + rd*t);
          if (d < .0012*t) { tHit = t; what = 2; break; }
          t += d;
        }
      }
    }
  }
  // plants and rocks
  if (DENS > .01) {
    float top = AMP*.75 + PH, t = 0., tEnd = min(tHit > 0. ? tHit : far, PFAR + 3.*U);
    bool go = true;
    if (ro.y > top) { if (rd.y >= 0.) go = false; else t = (ro.y - top)/(-rd.y); }
    if (go && t < tEnd) {
      int steps = int(mix(20., 56., uDetail)); PRD = rd;
      for (int i = 0; i < 56; i++) {
        if (i >= steps) break;
        vec3 p = ro + rd*t; float d = plantMap(p);
        if (d < min(.0012*t, .12*PS) + .003*PS) { tHit = t; what = 3; break; }
        t += min(d, PEXIT);
        if (t > tEnd || (rd.y > 0. && p.y > top)) break;
      }
    }
  }

  vec3 col; float sky = 0.;
  if (what == 0) {
    col = skyAll(rd); sky = 1.;
    // far hills and a conifer treeline (left out when a volcano stands behind)
    if (uBackdrop < .5 && rd.y < .25) {
      float az = atan(rd.z, rd.x), el = rd.y/length(rd.xz);
      vec2 cz = vec2(cos(az), sin(az));
      vec3 fogc = skyBase(normalize(vec3(rd.x, .03, rd.z)));
      float h1 = .03 + .085*fbm2(cz*1.7 + 3., 4.);
      float e1 = 1.6/(uRes.y*F);
      vec3 hc = mix(mix(vegCol(), soilCol(), .3)*(AMB + KEYC*.35), fogc, .72);
      float m1 = smoothstep(h1 + e1, h1 - e1, el); col = mix(col, hc, m1); sky *= 1. - m1;
      float cx = az/TAU*420., tid = floor(cx);
      float tree = step(.3, hash11(tid + 3.))*(.4 + .6*hash11(tid))*(1. - abs(fract(cx) - .5)*2.)*(1. - E.dark*.6);
      float h2 = .012 + .04*fbm2(cz*4. + 11., 3.) + .022*tree;
      vec3 tc = mix(vegCol()*.6*(AMB + KEYC*.3), fogc, .5);
      float m2 = smoothstep(h2 + e1, h2 - e1, el); col = mix(col, tc, m2); sky *= 1. - m2;
    }
  } else {
    vec3 p = ro + rd*tHit;
    if (what == 1) col = shadeGround(p, rd, tHit);
    else if (what == 2) col = shadeAnimal(p, rd, tHit);
    else if (what == 3) col = shadePlant(p, rd, tHit);
    else col = shadePlinth(p, pn, rd);
    float fd = (.006 + .09*uX4*uX4)*(1. + 3.*E.dark)/U;
    vec3 fogc = skyBase(normalize(vec3(rd.x, .03, rd.z)));
    col = mix(col, fogc, 1. - exp(-tHit*fd));
  }
  // ash falling through the impact winter
  if (E.dark > .01) {
    float ash = 0.;
    for (int i = 0; i < 3; i++) { float fi = float(i), sz = 26. + fi*22.;
      vec2 g = uv*sz + vec2(sin(uTime*.4 + fi)*.6 + uTime*(uWind - .5)*2., uTime*(1.2 + fi*.5)) + fi*17.;
      vec2 id = floor(g), f = fract(g) - .5; vec2 o = (hash22(id) - .5)*.6;
      ash += step(.8, hash12(id + 5.))*smoothstep(.14, .04, length(f - o)); }
    col = mix(col, vec3(.5, .48, .46)*(.25 + .75*uLight), clamp(ash, 0., 1.)*E.dark*.5);
  }
  col += vec3(1., .8, .55)*E.flash*.22;
  finish(clamp(col, 0., 1.), sky);
}
`;

const hex = c => { const v = parseInt(c.slice(1), 16); return [(v >> 16) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };
const PATS = { plain: 0, stripes: 1, bands: 2, spots: 3, saddle: 4 };
// where the ground comes from: [soil, plants, hill height, plant density, share of rocks, wetness]
const GROUNDS = {
  prairie: [[.38, .29, .18], [.2, .36, .12], .5, .5, .12, 0],
  forest: [[.3, .21, .14], [.13, .31, .1], .4, .8, .08, 0],
  floodplain: [[.33, .27, .2], [.17, .37, .13], .16, .62, .04, 1],
  desert: [[.74, .56, .35], [.46, .43, .2], .85, .16, .55, 0],
  uplands: [[.42, .36, .28], [.25, .36, .15], .9, .42, .5, 0],
};
const survivor = sp => sp.plan === 'bird' || sp.ma[1] < 65.9;   // the birds came through the impact

// the animal's rest box, for framing (cached per species and scale)
const boxes = new Map();
function restBox(sp, scale) {
  const key = sp.id + '|' + scale;
  if (boxes.has(key)) return boxes.get(key);
  const q = pose(sp, { scale });
  let x0 = 1e9, x1 = -1e9, tall = 0;
  for (const n of q.nodes) { x0 = Math.min(x0, n.x - n.r); x1 = Math.max(x1, n.x + n.r); tall = Math.max(tall, n.y + n.r); }
  x1 = Math.max(x1, q.head.x + Math.cos(q.head.a) * q.head.len); tall = Math.max(tall, q.head.y + q.head.len * 0.4);
  const f = sp.f || {};
  if (f.plates) tall += sp.len * scale * 0.08 * f.plates;
  if (f.sail) tall += sp.len * scale * 0.1 * f.sail;
  const b = { x0, x1, tall }; boxes.set(key, b); return b;
}

// One posed animal → shapes [ax, ay, az, bx, by, bz, ra, rb, tone, nx, ny, nz, halfThickness], most important first.
// Tones: 0 spine, 1 limb, 2 head, 3 display (plates, frill, sail, feathers), 4 horn, 5 eye, 6 markings colour.
function shapes(q, budget) {
  const { sp, P, L, nodes: n, iHip, iSh, iEnd } = q, f = sp.f || {}, out = [];
  const lean = budget < 60;
  const add = (a, b, ra, rb, tone, nrm, th) => { out.push([a[0], a[1], a[2] || 0, b[0], b[1], b[2] || 0, ra, rb, tone, nrm ? nrm[0] : 0, nrm ? nrm[1] : 0, nrm ? nrm[2] : 0, th || 0]); };
  const Z = [0, 0, 1];
  // spine: tail tip → neck (the belly hangs a little below the back)
  const nd = j => { const o = n[j], b = o.b ?? o.r; return [[o.x, o.y - (b - o.r) / 2, o.z], (o.r + b) / 2]; };
  let nSp = 0;
  for (let i = 0; i < n.length - 1; i++) {
    const j = lean && i < iHip - 1 && i % 2 === 0 ? i + 2 : i + 1;
    const [a, ra] = nd(i), [b, rb] = nd(j);
    add(a, b, ra, rb, 0); nSp++; i = j - 1;
  }
  // head: a skull and a jaw read off the rig's own skull outlines
  const Hd = HEADS[P.headT] || HEADS.theropod, hd = P.hd || 1, h = q.head, Lh = h.len, dH = Lh * hd;
  const ca = Math.cos(h.a), sa = Math.sin(h.a);
  const M = (lx, ly) => [h.x + lx * Lh * ca - ly * dH * sa, h.y + lx * Lh * sa + ly * dH * ca];
  const M3 = (lx, ly, z) => { const p = M(lx, ly); return [p[0], p[1], z]; };
  const span = (poly, x) => {
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < poly.length; i++) { const A = poly[i], B = poly[(i + 1) % poly.length];
      if ((A[0] - x) * (B[0] - x) <= 0 && A[0] !== B[0]) { const y = A[1] + (B[1] - A[1]) * (x - A[0]) / (B[0] - A[0]); lo = Math.min(lo, y); hi = Math.max(hi, y); } }
    return hi > lo ? [lo, hi] : [-0.03, 0.03];
  };
  const rCap = 0.23 * dH;
  const st = (poly, x, k = 1) => { const [lo, hi] = span(poly, x); return { x, y: (lo + hi) / 2, r: Math.min(rCap, (hi - lo) / 2 * dH * k) }; };
  const sk = (lean ? [0.12, 0.5, 0.93] : [0.1, 0.38, 0.7, 0.94]).map(x => st(Hd.up, x));
  for (let i = 0; i < sk.length - 1; i++) add(M(sk[i].x, sk[i].y), M(sk[i + 1].x, sk[i + 1].y), sk[i].r, sk[i + 1].r, 2);
  const jawA = -h.jaw * 0.62, pv = [0.08, -0.07], cj = Math.cos(jawA), sj = Math.sin(jawA);
  const J = (lx, ly) => { const dx = lx - pv[0], dy = ly - pv[1]; return M(pv[0] + dx * cj - dy * sj, pv[1] + dx * sj + dy * cj); };
  const jw = (lean ? [0.15, 0.88] : [0.14, 0.5, 0.88]).map(x => st(Hd.jaw, x, 0.95));
  for (let i = 0; i < jw.length - 1; i++) add(J(jw[i].x, jw[i].y), J(jw[i + 1].x, jw[i + 1].y), jw[i].r, jw[i + 1].r, 2);
  // limbs (rig capsules after the spine and its one head capsule)
  const caps = capsules(q);
  for (let i = n.length; i < caps.length; i++) { const c = caps[i]; if (c[8] !== 1) continue;
    if (Math.hypot(c[3] - c[0], c[4] - c[1], c[5] - c[2]) < 1e-3 * L) continue;
    add([c[0], c[1], c[2]], [c[3], c[4], c[5]], c[6], c[7], 1); }
  if (Hd.teeth && sp.diet !== 'herbivore' && budget - out.length > 40) { const [x0, x1] = Hd.teeth, N = 6;
    for (let i = 0; i < N; i++) for (const sd of [-1, 1]) { const x = lerp(x0 + 0.04, x1 - 0.03, i / (N - 1)), s0 = st(Hd.up, x), tl = (0.05 + 0.035 * Math.sin(PI * (i + 0.5) / N)) * dH;
      const zz = s0.r * 0.72, yb = s0.y - s0.r / dH * 0.62;
      add(M3(x, yb, sd * zz), M3(x, yb - tl / dH, sd * zz * 0.97), tl * 0.3, tl * 0.06, 4); } }
  const zAt = x => { const s = st(Hd.up, x); return s; };
  // ---- extras
  if (f.horns) for (const sd of [-1, 1]) { const k = f.horns;
    add(M3(0.43, 0.4, sd * 0.15 * Lh), M3(0.63, 0.72 * k + 0.1, sd * 0.2 * Lh), 0.075 * Lh, 0.05 * Lh, 4);
    add(M3(0.63, 0.72 * k + 0.1, sd * 0.2 * Lh), M3(1.0, 1.02 * k + 0.08, sd * 0.2 * Lh), 0.05 * Lh, 0.012 * Lh, 4); }
  if (f.noseHorn) add(M(0.78, 0.26), M(0.81, 0.34 + 0.42 * f.noseHorn), 0.06 * Lh, 0.014 * Lh, 4);
  if (f.frill) { const k = f.frill, ky = 0.4 + 0.6 * k;
    const c = M(-0.2 * k, 0.45 * ky), e0 = M(0.1, 0.1), e1 = M(-0.45 * k, 0.8 * ky);
    let ux = e1[0] - e0[0], uy = e1[1] - e0[1]; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    const R = 0.4 * k * Lh, w = 0.13 * Lh * k, nr = [uy, -ux, 0];
    add([c[0], c[1], -w], [c[0], c[1], w], R, R, 7, nr, 0.035 * Lh);
    if (f.frillSpikes && !lean) for (let j = -2; j <= 2; j++) { const ph = j * 0.55, cu = Math.cos(ph), sz = Math.sin(ph), e = (0.45 - Math.abs(j) * 0.07) * Lh;
      const b = [c[0] + ux * cu * R * 0.85, c[1] + uy * cu * R * 0.85, sz * R * 0.85 + Math.sign(j) * w];
      add(b, [b[0] + ux * cu * e, b[1] + uy * cu * e, b[2] + sz * e], 0.05 * Lh, 0.012 * Lh, 4); } }
  if (P.headT === 'anky') for (const sd of [-1, 1]) { const r0 = zAt(0.1).r;
    add(M3(0.06, 0.26, sd * r0 * 0.7), M3(-0.14, 0.42, sd * r0 * 1.5), 0.05 * Lh, 0.015 * Lh, 4);
    add(M3(0.06, -0.06, sd * r0 * 0.8), M3(-0.1, -0.18, sd * r0 * 1.7), 0.05 * Lh, 0.015 * Lh, 4); }
  // rows of plates or spikes standing on the back
  const frame = s => { const o = at(n, s); return o; };
  if (f.plates) { const s0 = iHip * 0.45, s1 = iEnd - 1.5, N = lean ? 6 : 9;
    for (let row = 0; row < 2; row++) for (let i = 0; i < N; i++) {
      const sd = row ? -1 : 1, s = lerp(s0, s1, (i + (row ? 0.5 : 0)) / N), u = (s - s0) / (s1 - s0), bell = Math.pow(Math.sin(PI * clamp(0.08 + u * 0.8)), 1.3);
      const hgt = L * 0.105 * f.plates * (0.3 + 0.7 * bell), o = frame(s), tilt = 0.22, ct = Math.cos(tilt), stl = Math.sin(tilt) * sd;
      const upv = [o.nx * ct, o.ny * ct, stl], thin = [-o.nx * stl, -o.ny * stl, ct];
      const base = [o.x + o.nx * o.r * 0.8, o.y + o.ny * o.r * 0.8, sd * o.r * 0.2];
      const pt = k => [base[0] + upv[0] * hgt * k, base[1] + upv[1] * hgt * k, base[2] + upv[2] * hgt * k];
      if (f.backSpikes && s < iHip + 2.5) add(pt(0), pt(1.5), hgt * 0.14, hgt * 0.02, 4);
      else add(pt(0.42), pt(0.88), hgt * 0.42, hgt * 0.11, 3, thin, hgt * 0.05 + L * 0.004);
    } }
  if (f.spikes) for (const u of [0.8, 0.93]) for (const sd of [-1, 1]) { const o = frame(iHip * (1 - u)), e = L * 0.085;
    add([o.x, o.y, sd * o.r * 0.5], [o.x - o.tx * e * 0.35 + o.nx * e * 0.5, o.y - o.ty * e * 0.35 + o.ny * e * 0.5, sd * (o.r * 0.5 + e * 0.75)], L * 0.011, L * 0.002, 4); }
  if (f.sail) { const s0 = f.paddleTail ? iHip - 1.5 : iHip - 0.6, s1 = iSh + 0.6, N = lean ? 5 : 8, pts = [];
    for (let i = 0; i <= N; i++) { const u = i / N, o = frame(lerp(s0, s1, u)), hgt = L * 0.135 * f.sail * Math.pow(Math.sin(PI * u), 0.55) + 0.01 * L;
      pts.push([[o.x + o.nx * (o.r * 0.6 + hgt / 2), o.y + o.ny * (o.r * 0.6 + hgt / 2), 0], hgt / 2]); }
    for (let i = 0; i < N; i++) add(pts[i][0], pts[i + 1][0], pts[i][1], pts[i + 1][1], 3, Z, L * 0.006); }
  if (f.club) { const e = n[0], r = L * 0.036 * f.club; add([e.x - r * 0.3, e.y, -r * 0.7], [e.x - r * 0.3, e.y, r * 0.7], r * 0.8, r * 0.8, 4); }
  if (f.neckSpines) for (let i = 0; i < (lean ? 4 : 7); i++) for (const sd of [-1, 1]) { const o = frame(iSh + 0.6 + i * 0.75), e = L * 0.06 * (1 - i * 0.07);
    add([o.x + o.nx * o.r * 0.7, o.y + o.ny * o.r * 0.7, sd * o.r * 0.35], [o.x + (o.nx * 0.9 - o.tx * 0.45) * (o.r + e), o.y + (o.ny * 0.9 - o.ty * 0.45) * (o.r + e), sd * o.r * 0.5], L * 0.007, L * 0.002, 3); }
  // armour: rows of bony studs over the back
  if (f.scutes && !lean) { const s0 = iHip * 0.35, s1 = iSh + 1.2, room = Math.max(0, budget - out.length - 12), rows = [-0.95, -0.32, 0.32, 0.95];
    const per = Math.min(13, Math.floor(room / rows.length));
    for (let i = 0; i < per; i++) for (let j = 0; j < rows.length; j++) { const o = frame(lerp(s0, s1, (i + (j % 2) * 0.5) / per)), cp = Math.cos(rows[j]), sp2 = Math.sin(rows[j]), e = L * 0.02 * f.scutes;
      const dx = o.nx * cp, dy = o.ny * cp, k0 = o.r * 0.93, k1 = o.r * 0.93 + e;
      add([o.x + dx * k0, o.y + dy * k0, sp2 * k0], [o.x + dx * k1, o.y + dy * k1, sp2 * k1], e * 0.75, e * 0.2, 6); } }
  // crests
  const cr = f.crest, CP = cr && CRESTS[cr];
  if (cr === 'tube') { add(M(0.3, 0.36), M(-0.35, 0.72), 0.075 * Lh, 0.065 * Lh, 3); add(M(-0.35, 0.72), M(-0.8, 0.76), 0.065 * Lh, 0.05 * Lh, 3); }
  else if (cr === 'dome') add(M(0.26, 0.4), M(0.34, 0.42), 0.25 * dH, 0.23 * dH, 2);
  else if (cr === 'brow' || cr === 'horns') for (const sd of [-1, 1]) { const r0 = zAt(0.32).r, big = cr === 'horns' ? 1 : 0;
    add(M3(0.32, 0.34, sd * r0 * 0.6), M3(0.32 - big * 0.06, 0.5 + big * 0.22, sd * r0 * (0.75 + big * 0.9)), 0.06 * Lh, 0.02 * Lh, cr === 'brow' ? 3 : 4); }
  else if (CP) { const A = CP[0], B = CP[CP.length - 1], base = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    let apex = CP[1], far = 0; for (const p of CP) { const d = Math.hypot(p[0] - base[0], p[1] - base[1]); if (d > far) { far = d; apex = p; } }
    const hw = Math.hypot(B[0] - A[0], B[1] - A[1]) / 2 * Lh, mx = k => M(lerp(base[0], apex[0], k), lerp(base[1], apex[1], k));
    for (const sd of cr === 'double' ? [-1, 1] : [0]) { const z = sd * zAt(0.5).r * 0.45, a = mx(0.3), b = mx(0.78);
      add([a[0], a[1], z], [b[0], b[1], z], hw * 0.85, hw * 0.45, 3, Z, 0.035 * Lh); } }
  // feathers: wings on the arms, a fan on the tail, folded wings on birds
  if (f.wings) for (const g of q.arms) { const E = g.pts[1], W = g.pts[2], d = L * 0.1 * f.wings, an = PI + 0.25 + q.th, c = Math.cos(an), s = Math.sin(an);
    const m = [(E[0] + W[0]) / 2, (E[1] + W[1]) / 2], z = g.z * 1.2;
    add([m[0] + c * d * 0.2, m[1] + s * d * 0.2, z], [m[0] + c * d * 0.85, m[1] + s * d * 0.85, z], d * 0.42, d * 0.24, 8, Z, L * 0.004); }
  if (f.tailFan) { const a = frame(iHip * 0.36), b = frame(0.3), r = L * 0.034 * f.tailFan;
    const dx = b.x - a.x, dy = b.y - a.y, dl = Math.hypot(dx, dy) || 1;
    add([a.x, a.y, 0], [b.x, b.y, 0], r * 0.55, r, 8, [-dy / dl, dx / dl, 0], L * 0.004); }
  if (f.wingFold) for (const sd of [-1, 1]) { const a = frame(iSh - 0.3), b = frame(iHip + 0.3), r = a.r * 0.5 * f.wingFold;
    add([a.x, a.y + r * 0.2, sd * a.r * 0.75], [b.x - r * 0.4, b.y - r * 0.2, sd * b.r * 0.8], r, r * 0.6, 6); }
  if (f.sickle && !lean) for (const g of q.legs) if (!g.front) { const T = g.pts[3], r = g.R[3], c = q.H * 0.07 * f.sickle;
    add([T[0] + r * 0.4, T[1] + r * 0.5, g.z * 1.0], [T[0] + r * 0.4 + c * 0.9, T[1] + r * 0.4 + c * 0.7, g.z * 1.0], r * 0.5, r * 0.08, 4); }
  // eyes last: the first to go when there is no room
  { const e = Hd.eye, s0 = st(Hd.up, e[0]), dy = (e[1] - s0.y) * dH, zs = Math.sqrt(Math.max(s0.r * s0.r - dy * dy, s0.r * s0.r * 0.2)) * 0.86;
    const er = e[2] * dH * 1.35 * (1 + q.young * 0.6);
    for (const sd of [-1, 1]) { const c = M3(e[0], e[1], sd * zs); add(c, [c[0] + er * 0.05, c[1], c[2]], er, er, 5); } }
  if (out.length > budget) out.length = budget;
  // keep every round cone well formed
  for (const c of out) {
    let dx = c[3] - c[0], dy = c[4] - c[1], dz = c[5] - c[2], d = Math.hypot(dx, dy, dz);
    if (d < 1e-4 * L) { c[3] = c[0] + 1e-3 * L; c[4] = c[1]; c[5] = c[2]; d = 1e-3 * L; c[6] = c[7] = Math.max(c[6], c[7]); }
    if (Math.abs(c[6] - c[7]) > d * 0.9) { if (c[6] > c[7]) c[7] = c[6] - d * 0.9; else c[6] = c[7] - d * 0.9; }
  }
  return { list: out, nSp };
}

export default {
  id: 'dino3d',
  name: 'Dinosaur 3D',
  kind: 'gl',
  res: 0.5,
  sky: true,
  params: [
    { id: 'x1', label: 'Orbit speed', value: 0.3, tip: 'How fast the camera drifts around the animal (0 holds it still; drag to orbit yourself)' },
    { id: 'x2', label: 'Zoom', value: 0.5, tip: 'Camera distance, on top of Size' },
    { id: 'x3', label: 'Stripes', value: 0.5, tip: 'How strong the markings are' },
    { id: 'x4', label: 'Fog', value: 0.35, tip: 'Haze in the air' },
  ],
  create(gl, opts = {}) {
    const prog = compile(gl, fullscreenVS, HEADER + NOISE + DINO + FS);
    const U = {};
    for (const nm of ['uRes', 'uTime', 'uClock', 'uMouse', 'uDrag', 'uStage', 'uEpoch', 'uActivity', 'uHerd', 'uBackdrop', 'uSize', 'uDetail', 'uWind', 'uLight',
      'uX1', 'uX2', 'uX3', 'uX4', 'uSeed', 'uCombo', 'uPA', 'uPB', 'uPC', 'uNA', 'uAni', 'uAniM', 'uAniF', 'uAniO', 'uCol', 'uCam', 'uTgt', 'uView', 'uGround', 'uMode', 'uSoil', 'uVeg'])
      U[nm] = gl.getUniformLocation(prog, nm);
    const vao = gl.createVertexArray();
    const seed = ((opts.seed || 1) * 0.6180339) % 1;
    const PA = new Float32Array(MAXP * 4), PB = new Float32Array(MAXP * 4), PC = new Float32Array(MAXP * 4);
    const ANI = new Float32Array(MAXA * 4), ANM = new Float32Array(MAXA * 4), ANF = new Float32Array(MAXA * 4), ANO = new Float32Array(MAXA * 4), COL = new Float32Array(MAXA * 12);
    const cast = opts.cast || [{ sp: 'tyrannosaurus' }];
    const G = GROUNDS[opts.ground] || GROUNDS.prairie;
    const turn = !!opts.turntable;
    const S = { ph: [0.1, 0.47, 0.78], scroll: (opts.seed || 1) * 37.7, unit: 0, tx: 0, ty: 0, tz: 0, stage: -9, roar: 0, stance: 0, yaw: 0, lt: null };
    // where the others walk, in body lengths of the lead animal (x forward, z towards the default camera)
    const SLOTS = [[0, 0], [-0.45, -1.05], [-0.7, 0.95]];

    return {
      render(f) {
        const p = f.p, E = f.era, dt = Math.max(0, Math.min(f.dt || 0, 0.1));
        // ---- who is on stage
        const want = clamp(Math.round(cast.length + (p.herd - 0.5) * 4), 1, MAXA);
        const actors = [];
        for (let i = 0; i < want; i++) {
          const c = cast[i] || { ...cast[0], scale: (cast[0].scale || 1) * (i === 1 ? 0.9 : 0.8) };
          const lock = c.lock || opts.lock;
          const sp = lock ? species(c.sp) : standIn(c.sp, E.ma);
          if (!sp || sp.kind !== 'walk') continue;
          if (!lock && !survivor(sp) && E.dinos < 0.04) continue;
          actors.push({ sp, c, slot: i, down: lock || survivor(sp) ? 0 : smooth(0.55, 0.12, E.dinos) });
        }
        const lead = actors[0];
        // ---- pace: Activity walks faster, then breaks into a run
        const run = turn ? 0 : clamp((opts.run || 0) + (p.activity - 0.5) * 0.7);
        let v = 0;
        if (lead && !turn) { const g = gait(lead.sp, run, lead.c.scale || 1); v = g.speed * (0.75 + 0.5 * p.activity) * (1 - lead.down); }
        S.scroll += v * dt;
        if (f.pointer.clicks && f.pointer.clicks.length) { S.roar = 1.4; if (f.sig) f.sig.roar = 1; }
        S.roar = Math.max(0, S.roar - dt);
        // ---- pose each one and turn it into shapes
        const budget = Math.floor(MAXP / Math.max(1, actors.length));
        let np = 0, gx0 = 1e9, gx1 = -1e9, gz = 0, tall = 0;
        const L0 = lead ? lead.sp.len * (lead.c.scale || 1) : 1;
        const zoff = lead ? clamp(3.6 * lead.sp.P.r * L0, 0.16 * L0, 0.35 * L0) : 0;
        const plinthH = turn ? 1 : 0;
        actors.forEach((A, ai) => {
          const sc = A.c.scale || 1, sl = A.c.at || SLOTS[A.slot];
          const g = gait(A.sp, run, sc);
          S.ph[A.slot] += v * dt / g.stride;
          const meat = A.sp.diet !== 'herbivore';
          const roar = A.slot === 0 ? Math.sin(PI * clamp(S.roar / 1.4)) : 0;
          const idle = meat ? 0.55 * smooth(0.8, 0.98, Math.sin(f.t * 0.37 + A.slot * 2.1)) : 0.25 * smooth(0.9, 1, Math.sin(f.t * 0.23 + A.slot * 1.7));
          const q = pose(A.sp, { phase: turn ? 0.07 : S.ph[A.slot], run, t: f.t + A.slot * 3.3, scale: sc, young: A.c.young || 0, crouch: A.down,
            headTo: clamp((A.c.headTo ?? opts.headTo ?? 0) + 0.12 * Math.sin(f.t * 0.31 + A.slot * 2) + roar * 0.35 - A.down * 0.6, -1, 1), jaw: Math.max(roar, idle) * (1 - A.down) });
          A.q = q;
          const { list, nSp } = shapes(q, budget);
          const ox = sl[0] * L0, oz = sl[1] * zoff, i0 = np;
          let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
          for (const c of list) {
            const k = np * 4, r = Math.max(c[6], c[7]);
            PA[k] = c[0] + ox; PA[k + 1] = c[1]; PA[k + 2] = c[2] + oz; PA[k + 3] = c[6];
            PB[k] = c[3] + ox; PB[k + 1] = c[4]; PB[k + 2] = c[5] + oz; PB[k + 3] = c[7];
            PC[k] = c[9] * c[12]; PC[k + 1] = c[10] * c[12]; PC[k + 2] = c[11] * c[12]; PC[k + 3] = c[8];
            x0 = Math.min(x0, PA[k] - r, PB[k] - r); x1 = Math.max(x1, PA[k] + r, PB[k] + r);
            y0 = Math.min(y0, PA[k + 1] - r, PB[k + 1] - r); y1 = Math.max(y1, PA[k + 1] + r, PB[k + 1] + r);
            z0 = Math.min(z0, PA[k + 2] - r, PB[k + 2] - r); z1 = Math.max(z1, PA[k + 2] + r, PB[k + 2] + r);
            np++;
          }
          const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2; let R = 0;
          for (let i = i0; i < np; i++) { const k = i * 4;
            R = Math.max(R, Math.hypot(PA[k] - cx, PA[k + 1] - cy, PA[k + 2] - cz) + PA[k + 3], Math.hypot(PB[k] - cx, PB[k + 1] - cy, PB[k + 2] - cz) + PB[k + 3]); }
          ANI.set([cx, cy, cz, R * 1.02], ai * 4);
          ANM.set([i0, np, nSp, PATS[A.sp.pat] ?? 0], ai * 4);
          ANF.set([q.L, (A.sp.f || {}).fuzz ? 1 : 0, (A.sp.f || {}).scutes ? 1 : 0, (A.slot * 0.37 + seed) % 1], ai * 4);
          ANO.set([ox, 0, oz, 0], ai * 4);
          for (let j = 0; j < 4; j++) COL.set(hex(A.sp.c[j]), ai * 12 + j * 3);
          const b = restBox(A.sp, sc);
          gx0 = Math.min(gx0, b.x0 + ox); gx1 = Math.max(gx1, b.x1 + ox); gz = Math.max(gz, Math.abs(oz)); tall = Math.max(tall, b.tall);
        });
        // footfalls for the sound layer
        if (f.sig && lead) { let st = 0; lead.q.legs.forEach((g, i) => { if (g.stance) st |= 1 << i; });
          if (st & ~S.stance && v > 0) f.sig.step = Math.max(f.sig.step || 0, clamp(lead.sp.mass / 4000, 0.15, 1));
          S.stance = st; f.sig.count = actors.length / MAXA; f.sig.speed = run; }
        // ---- framing: eased, but snapped on the first frame and when time jumps
        let unit, tx, ty, tz;
        if (lead) { const lb = restBox(lead.sp, lead.c.scale || 1);
          unit = Math.max((gx1 - gx0) * 0.4, tall * 0.8, gz * 1.3); tx = lerp((gx0 + gx1) / 2, (lb.x0 + lb.x1) / 2, 0.5); ty = Math.max(tall * 0.46, unit * 0.3); tz = actors.length > 2 ? 0 : -gz * 0.3; }
        else { const sp = species(cast[0].sp), b = restBox(sp, cast[0].scale || 1); unit = Math.max((b.x1 - b.x0) * 0.4, b.tall * 0.8); tx = 0; ty = unit * 0.4; tz = 0; }
        const jump = S.unit === 0 || Math.abs(f.stage - S.stage) > 0.03 || dt === 0;
        const k = jump ? 1 : 1 - Math.exp(-dt * 2.5);
        S.unit = lerp(S.unit, unit, k); S.tx = lerp(S.tx, tx, k); S.ty = lerp(S.ty, ty, k); S.tz = lerp(S.tz, tz, k); S.stage = f.stage;
        const Un = S.unit, ph = turn ? Un * 0.07 : 0, rp = turn ? Math.max((gx1 - gx0) * 0.56, Un * 0.9) : 0;
        if (ph) for (let i = 0; i < np; i++) { PA[i * 4 + 1] += ph; PB[i * 4 + 1] += ph; }
        if (ph) for (let i = 0; i < actors.length; i++) { ANI[i * 4 + 1] += ph; ANO[i * 4 + 1] = ph; }
        // ---- camera: drag to orbit; Orbit speed sways it (or spins it, on a turntable)
        const rate = p.x1 * p.x1 * 1.6;
        const yaw = (opts.az ?? 0.55) - f.pointer.dragX * 3.2 + (turn ? f.t * rate : 0.65 * Math.sin(f.t * rate * 0.6 + seed * 6) * Math.min(1, p.x1 * 4));
        const el = clamp((opts.el ?? -0.04) + f.pointer.dragY * 1.6, -0.1, 1.3);
        const zoom = lerp(0.6, 1.7, p.scale) * lerp(0.6, 1.6, p.x2) / 1.265 * (opts.zoom || 1);
        const D = 2.05 * Un / zoom, F = 1.9;
        const cx = S.tx + (turn ? 0 : 0) + D * Math.sin(yaw) * Math.cos(el), cy = S.ty + ph + D * Math.sin(el), cz = S.tz + D * Math.cos(yaw) * Math.cos(el);
        const track = turn ? 0 : gz + Math.max(0.2 * Un, lead ? lead.sp.P.r * L0 * 2.2 : 0.2 * Un);
        const ps = Math.min(0.24 * Math.pow(Un, 0.6), 0.17 * Un);

        gl.viewport(0, 0, f.w, f.h);
        gl.useProgram(prog); gl.bindVertexArray(vao);
        gl.uniform2f(U.uRes, f.w, f.h);
        gl.uniform1f(U.uTime, f.t % 3600); gl.uniform1f(U.uClock, f.clock);
        gl.uniform4f(U.uMouse, f.pointer.x, 1 - f.pointer.y, f.pointer.down ? 1 : 0, f.pointer.moved ? 1 : 0);
        gl.uniform2f(U.uDrag, f.pointer.dragX, -f.pointer.dragY);
        gl.uniform1f(U.uStage, f.stage); gl.uniform1f(U.uEpoch, f.epoch || 0); gl.uniform1f(U.uCombo, f.combo ? 1 : 0); gl.uniform1f(U.uBackdrop, f.backdrop ? 1 : 0);
        gl.uniform1f(U.uActivity, p.activity); gl.uniform1f(U.uHerd, p.herd); gl.uniform1f(U.uSize, p.scale); gl.uniform1f(U.uDetail, p.detail);
        gl.uniform1f(U.uWind, p.wind); gl.uniform1f(U.uLight, p.light);
        gl.uniform1f(U.uX1, p.x1); gl.uniform1f(U.uX2, p.x2); gl.uniform1f(U.uX3, p.x3); gl.uniform1f(U.uX4, p.x4);
        gl.uniform1f(U.uSeed, seed);
        gl.uniform4fv(U.uPA, PA); gl.uniform4fv(U.uPB, PB); gl.uniform4fv(U.uPC, PC);
        gl.uniform1i(U.uNA, actors.length);
        gl.uniform4fv(U.uAni, ANI); gl.uniform4fv(U.uAniM, ANM); gl.uniform4fv(U.uAniF, ANF); gl.uniform4fv(U.uAniO, ANO); gl.uniform3fv(U.uCol, COL);
        gl.uniform3f(U.uCam, cx, cy, cz); gl.uniform3f(U.uTgt, S.tx, S.ty + ph, S.tz);
        gl.uniform4f(U.uView, Un, F, S.scroll % 4096, track);
        gl.uniform4f(U.uGround, G[2], G[3], G[4], G[5]);
        gl.uniform4f(U.uMode, opts.clay ? 1 : 0, rp, ph, ps);
        gl.uniform3fv(U.uSoil, G[0]); gl.uniform3fv(U.uVeg, G[1]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      dispose() { gl.deleteProgram(prog); gl.deleteVertexArray(vao); }
    };
  }
};

const Sc = (id, name, desc, tags, opts, params) => ({ id: 'dino3d-' + id, name, desc, tags: ['raymarched', '3d', ...tags], opts, params });
export const scenes = [
  Sc('trex', 'Tyrannosaurus in the Round', 'A T. rex striding across the fern prairie. Drag to walk around it; click to make it roar.', ['theropod', 'cretaceous'],
    { cast: [{ sp: 'tyrannosaurus' }], ground: 'prairie', seed: 3 }, { stage: 0.855, light: 0.72 }),
  Sc('brachio', 'Brachiosaurus, Golden Hour', 'Twelve metres of neck against a low sun, with a half-grown one keeping up.', ['sauropod', 'jurassic'],
    { cast: [{ sp: 'brachiosaurus', headTo: 0.3 }, { sp: 'brachiosaurus', scale: 0.55, young: 0.4, at: [-0.75, -1.15] }], ground: 'forest', seed: 17, az: 0.75 }, { stage: 0.43, light: 0.3 }),
  Sc('trike', 'Triceratops Herd', 'Three horned faces on the move, frills and all, with a calf at the back.', ['ceratopsian', 'cretaceous', 'herd'],
    { cast: [{ sp: 'triceratops' }, { sp: 'triceratops', scale: 0.92 }, { sp: 'triceratops', scale: 0.5, young: 0.6 }], ground: 'prairie', seed: 5, az: 0.4, el: 0.1 }, { stage: 0.86, light: 0.85 }),
  Sc('stego', 'Stegosaurus Plates', 'Two rows of plates catching the light and four spikes on the tail.', ['stegosaur', 'jurassic'],
    { cast: [{ sp: 'stegosaurus' }], ground: 'forest', seed: 8, az: 0.45, el: 0.06 }, { stage: 0.43, light: 0.6 }),
  Sc('raptor', 'Velociraptors at a Run', 'A pair of feathered, turkey-sized hunters sprinting over the Gobi dunes at dusk.', ['theropod', 'cretaceous', 'desert', 'pack'],
    { cast: [{ sp: 'velociraptor' }, { sp: 'velociraptor', scale: 0.92 }], ground: 'desert', run: 0.75, seed: 21, az: 0.4 }, { stage: 0.79, light: 0.28, activity: 0.6 }),
  Sc('diplo', 'Diplodocus on the Floodplain', 'Twenty-six metres from nose to whip-tail, wading through the puddles with its young.', ['sauropod', 'jurassic', 'family'],
    { cast: [{ sp: 'diplodocus' }, { sp: 'diplodocus', scale: 0.42, young: 0.6, at: [0.42, 1.05] }], ground: 'floodplain', seed: 11, az: 0.6, el: 0.03 }, { stage: 0.436, light: 0.9 }),
  Sc('ankylo', 'Ankylosaurus, Low and Armoured', 'A walking fortress among the boulders, tail club swinging behind.', ['ankylosaur', 'cretaceous'],
    { cast: [{ sp: 'ankylosaurus' }], ground: 'uplands', seed: 23, az: 0.6, el: 0.12 }, { stage: 0.86, light: 0.62 }),
  Sc('moon', 'Allosaurus by Moonlight', 'The hunter of the Morrison out under a full moon and the stars.', ['theropod', 'jurassic', 'night'],
    { cast: [{ sp: 'allosaurus' }], ground: 'prairie', seed: 14, az: 0.85 }, { stage: 0.43, light: 0.06, x4: 0.5 }),
  Sc('clay', 'Clay Model: Spinosaurus', 'The sculptor’s view: plain grey clay and deep shadows, so only the shape speaks.', ['clay', 'theropod', 'cretaceous'],
    { cast: [{ sp: 'spinosaurus' }], ground: 'prairie', clay: 1, seed: 6, az: 0.5, el: 0.1 }, { stage: 0.71, light: 0.7, x3: 0, x4: 0.2 }),
  Sc('turntable', 'Turntable: Styracosaurus', 'A museum model on a stone plinth, turning slowly. The species is locked: it stays whatever the Era says.', ['ceratopsian', 'cretaceous', 'museum'],
    { cast: [{ sp: 'styracosaurus' }], ground: 'uplands', turntable: 1, lock: 1, seed: 9, el: 0.14 }, { stage: 0.804, light: 0.7, x1: 0.45 }),
];
