// The output stage. Every scene draws into its own canvas; this copies it onto the visible WebGL2 canvas with the
// "look" controls (hue, saturation, brightness, contrast, vignette, grain) and crossfades between scenes.
// It also stacks the layers of a combo, back to front: a Mega-Clouds sky, a Mega-Volcano scene, the dinosaurs.
// The volcano shows wherever the dinosaur picture is transparent (its sky); the clouds are layered by mode:
//   sky    clouds fill the sky (the transparent pixels of what is in front)
//   mist   as sky, plus the clouds' bright parts drift in front
//   over   the picture keeps its own sky; the clouds' bright parts are laid over it
//   screen the cloud picture is screen-blended over everything
// The output canvas is what Record, Snapshot and embedding (window.megaDino.canvas) see.
import { compile, fullscreenVS } from './gl.js';

export const MODES = ['sky', 'mist', 'over', 'screen'];

const FS = `#version 300 es
precision highp float;
uniform sampler2D uA, uB, uC, uD, uE, uF;   // dinosaurs now / outgoing, clouds now / outgoing, volcano now / outgoing
uniform float uMix, uCMix, uVMix, uCombo, uVol, uMode, uAmount, uVScale, uVShift, uHue, uSat, uBright, uContrast, uVig, uGrain, uTime;
uniform vec2 uRes;
out vec4 o;
vec3 hueRot(vec3 c, float a){ const vec3 k = vec3(0.57735); float ca = cos(a);
  return c*ca + cross(k, c)*sin(a) + k*dot(k, c)*(1.-ca); }
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
// how cloud-like a pixel of the cloud layer is: bright and unsaturated (white/grey), not blue sky
float cloudKey(vec3 c){
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float sat = (mx - mn)/max(mx, 1e-3), l = dot(c, vec3(.2126,.7152,.0722));
  return smoothstep(.32, .8, l)*(1. - smoothstep(.12, .55, sat));
}
// front picture over the volcano (straight alpha)
vec4 over(vec4 d, vec4 v){ float a = d.a + v.a*(1. - d.a); return vec4((d.rgb*d.a + v.rgb*v.a*(1. - d.a))/max(a, 1e-4), a); }
vec3 layer(vec4 v, vec3 cl){
  if (uCombo < .5) return v.rgb;
  if (uMode < .5) return mix(cl, v.rgb, v.a);
  if (uMode < 1.5) return mix(mix(cl, v.rgb, v.a), cl, cloudKey(cl)*uAmount*.6*v.a);
  if (uMode < 2.5) return mix(v.rgb, cl, cloudKey(cl)*uAmount);
  return 1. - (1. - v.rgb)*(1. - cl*uAmount);
}
void main(){
  vec2 uv = gl_FragCoord.xy/uRes;
  vec3 cl = vec3(0.);
  if (uCombo > .5) { cl = texture(uC, uv).rgb; if (uCMix < 1.) cl = mix(texture(uD, uv).rgb, cl, smoothstep(0., 1., uCMix)); }
  vec4 vv = vec4(0.);
  if (uVol > .5) { vec2 q = vec2((uv.x - .5)/uVScale + .5, (uv.y - .5 - uVShift)/uVScale + .5);
    vv = texture(uE, q); if (uVMix < 1.) vv = mix(texture(uF, q), vv, smoothstep(0., 1., uVMix)); }
  vec3 c = layer(over(texture(uA, uv), vv), cl);
  if (uMix < 1.) c = mix(layer(over(texture(uB, uv), vv), cl), c, smoothstep(0., 1., uMix));
  c = hueRot(c, uHue*6.2831853);
  float l = dot(c, vec3(.2126,.7152,.0722));
  c = mix(vec3(l), c, uSat*2.);
  c = (c - .5)*(.25 + uContrast*1.5) + .5;
  c *= uBright*2.;
  vec2 q = uv - .5; q.x *= uRes.x/uRes.y;
  c *= 1. - uVig*1.4*smoothstep(.25, 1.1, length(q));
  c += (h12(gl_FragCoord.xy + fract(uTime*7.)*917.) - .5)*uGrain*.35;
  o = vec4(clamp(c, 0., 1.), 1.);
}`;

export function createOutput(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  const prog = compile(gl, fullscreenVS, FS);
  const u = {};
  for (const n of ['A', 'B', 'C', 'D', 'E', 'F', 'Mix', 'CMix', 'VMix', 'Combo', 'Vol', 'Mode', 'Amount', 'VScale', 'VShift', 'Hue', 'Sat', 'Bright', 'Contrast', 'Vig', 'Grain', 'Time', 'Res']) u[n] = gl.getUniformLocation(prog, 'u' + n);
  const vao = gl.createVertexArray();
  const tex = () => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    return t;
  };
  const T = [tex(), tex(), tex(), tex(), tex(), tex()];
  let small = null, sctx = null, prev = null; // read-back for the brightness and motion outputs (Invisible Hands)

  function upload(t, src, nearest) {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const f = nearest ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  }

  return {
    gl, canvas,
    // a, b: { canvas, nearest } — b is the outgoing scene during a crossfade (or null). look: post controls 0..1.
    // clouds: null, or { a, b, mix, mode, amount }.  vol: null, or { a, b, mix, scale, shift } (the volcano backdrop).
    draw(a, b, mix, look, time, clouds, vol) {
      if (a) upload(T[0], a.canvas, a.nearest);
      if (b && mix < 1) upload(T[1], b.canvas, b.nearest);
      if (clouds) { if (clouds.a) upload(T[2], clouds.a.canvas, clouds.a.nearest); if (clouds.b && clouds.mix < 1) upload(T[3], clouds.b.canvas, clouds.b.nearest); }
      if (vol) { if (vol.a) upload(T[4], vol.a.canvas, vol.a.nearest); if (vol.b && vol.mix < 1) upload(T[5], vol.b.canvas, vol.b.nearest); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prog); gl.bindVertexArray(vao);
      ['A', 'B', 'C', 'D', 'E', 'F'].forEach((n, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, T[i]); gl.uniform1i(u[n], i); });
      gl.uniform1f(u.Mix, b ? mix : 1);
      gl.uniform1f(u.Combo, clouds ? 1 : 0);
      gl.uniform1f(u.CMix, clouds?.b ? clouds.mix : 1);
      gl.uniform1f(u.Mode, clouds ? Math.max(0, MODES.indexOf(clouds.mode)) : 0);
      gl.uniform1f(u.Amount, clouds ? clouds.amount : 0);
      gl.uniform1f(u.Vol, vol ? 1 : 0);
      gl.uniform1f(u.VMix, vol?.b ? vol.mix : 1);
      gl.uniform1f(u.VScale, vol ? vol.scale : 1); gl.uniform1f(u.VShift, vol ? vol.shift : 0);
      gl.uniform1f(u.Hue, look.hue); gl.uniform1f(u.Sat, look.saturation); gl.uniform1f(u.Bright, look.brightness);
      gl.uniform1f(u.Contrast, look.contrast); gl.uniform1f(u.Vig, look.vignette); gl.uniform1f(u.Grain, look.grain);
      gl.uniform1f(u.Time, time); gl.uniform2f(u.Res, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    // average luminance, the share of bright pixels, and how much the picture changed since the last call, from a 16×9 copy
    measure() {
      if (!small) { small = document.createElement('canvas'); small.width = 16; small.height = 9; sctx = small.getContext('2d', { willReadFrequently: true }); }
      sctx.drawImage(canvas, 0, 0, 16, 9);
      const d = sctx.getImageData(0, 0, 16, 9).data, now = new Float32Array(144); let sum = 0, bright = 0, diff = 0;
      for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        now[j] = l; sum += l; if (l > 0.72) bright++; if (prev) diff += Math.abs(l - prev[j]);
      }
      prev = now;
      return { luma: sum / 144, white: bright / 144, motion: Math.min(1, diff / 144 * 12) };
    }
  };
}
