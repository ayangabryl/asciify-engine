/**
 * Levels and hover scope of a moving source, measured on the GPU from its own mip chain with nothing read back: the results
 * stay in textures the field's shader samples. A playing video or live canvas is measured this way a few times a second at
 * no cost to the main thread beyond a few draw calls; without float render targets the field reads a mip back instead
 * (field-readback.ts).
 *
 * Levels follow `fieldLevels`: a 256-bin histogram of the samples' luminance (points added up by blending), then the 2nd
 * and 98th percentiles, or the full range when they are under 0.08 apart. Scope follows `buildHoverGuide`: a source with
 * transparency is its alpha; an opaque one on a plain ground (the border ring's luminance within 0.07) is keyed by its
 * distance from the ground's tone; a busy photo has no subject, which the red channel says (the shader then acts
 * everywhere, as the CPU guide does). Feathered by two box blurs about 2 % of the short side, as a triangle blur.
 */
import { mipLevelFor } from './field-readback';

const VERTEX = `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;
const HEAD = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSource;
uniform int uLevel;
float lum(vec3 c){ return dot(c,vec3(.2126,.7152,.0722)); }
`;
// One point a sample, at the bin of its luminance (0–255); samples under 8/255 alpha fall outside.
const HISTOGRAM_VERTEX = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSource;
uniform int uLevel, uWidth;
void main(){
  vec4 c=texelFetch(uSource,ivec2(gl_VertexID%uWidth,gl_VertexID/uWidth),uLevel);
  float bin=floor(dot(c.rgb,vec3(.2126,.7152,.0722))*255.+.5);
  gl_Position=c.a*255.<8.?vec4(2.,2.,0.,1.):vec4((bin+.5)/128.-1.,0.,0.,1.);
  gl_PointSize=1.;
}`;
const ONE = `#version 300 es
precision highp float;
out vec4 o;
void main(){ o=vec4(1.); }`;
// The 2nd and 98th percentile from the histogram.
const LEVELS = `#version 300 es
precision highp float;
uniform sampler2D uHistogram;
out vec4 o;
void main(){
  float count=0.;
  for(int v=0;v<256;v++)count+=texelFetch(uHistogram,ivec2(v,0),0).r;
  if(count<.5){o=vec4(0.,1.,0.,1.);return;}
  float low=1.,high=1.,seen=0.;bool lowFound=false;
  for(int v=0;v<256;v++){
    seen+=texelFetch(uHistogram,ivec2(v,0),0).r;
    if(!lowFound&&seen>=count*.02){low=float(v)/255.;lowFound=true;}
    if(seen>=count*.98){high=float(v)/255.;break;}
  }
  o=high-low<.08?vec4(0.,1.,0.,1.):vec4(low,high,0.,1.);
}`;
// The share of samples with transparency, and the luminance of the border ring: its mean and spread.
const STATS = `${HEAD}
uniform ivec2 uSize;
out vec4 o;
void main(){
  int ring=max(1,int(floor(float(min(uSize.x,uSize.y))*.03+.5)));
  float clear=0.,sum=0.,square=0.,count=0.;
  for(int y=0;y<128;y++){
    if(y>=uSize.y)break;
    for(int x=0;x<128;x++){
      if(x>=uSize.x)break;
      vec4 c=texelFetch(uSource,ivec2(x,y),uLevel);
      if(c.a*255.<249.5)clear+=1.;
      if(x>=ring&&y>=ring&&x<uSize.x-ring&&y<uSize.y-ring)continue;
      float l=lum(c.rgb);sum+=l;square+=l*l;count+=1.;
    }
  }
  float ground=sum/max(1.,count);
  o=vec4(clear/float(uSize.x*uSize.y),ground,sqrt(max(0.,square/max(1.,count)-ground*ground)),1.);
}`;
// Each sample's subject coverage in alpha; red is 1 when the source has no subject to key.
const SUBJECT = `${HEAD}
uniform sampler2D uStats;
out vec4 o;
void main(){
  vec4 stats=texelFetch(uStats,ivec2(0),0);
  vec4 c=texelFetch(uSource,ivec2(gl_FragCoord.xy),uLevel);
  if(stats.x>.01){o=vec4(0.,0.,0.,c.a);return;}
  if(stats.z>=.07){o=vec4(1.,0.,0.,1.);return;}
  float t=clamp((abs(lum(c.rgb)-stats.y)-.035)/.12,0.,1.);
  o=vec4(0.,0.,0.,t*t*(3.-2.*t));
}`;
// Two box blurs of radius r, as one triangle blur of radius 2r, along uStep; the red flag is carried through.
const BLUR = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uImage;
uniform ivec2 uStep;
uniform int uRadius;
out vec4 o;
void main(){
  ivec2 at=ivec2(gl_FragCoord.xy),last=textureSize(uImage,0)-1;
  float sum=0.,total=0.;
  for(int k=-16;k<=16;k++){
    if(k<-2*uRadius||k>2*uRadius)continue;
    float w=float(2*uRadius+1-abs(k));
    sum+=texelFetch(uImage,clamp(at+uStep*k,ivec2(0),last),0).a*w;total+=w;
  }
  o=vec4(texelFetch(uImage,at,0).r,0.,0.,sum/total);
}`;

type Program = { program: WebGLProgram; at: (name: string) => WebGLUniformLocation | null };
const programCache = new WeakMap<WebGL2RenderingContext, Map<string, Program>>();
/** Forgets a context's measuring programs: after a lost context is restored, they must be built again. */
export const forgetFieldMeasure = (gl: WebGL2RenderingContext) => { programCache.delete(gl); };
type Target = { texture: WebGLTexture; buffer: WebGLFramebuffer; width: number; height: number };

export interface FieldMeasure {
  /** The 1×1 texture holding the latest levels (red low, green high), once measured. */
  readonly levels: WebGLTexture | null;
  /** The scope texture (subject coverage in alpha, red set when there is no subject), once measured. */
  readonly scope: WebGLTexture | null;
  /** Measures the source's levels into `levels`. Needs the source's mip chain built. */
  measureLevels(source: WebGLTexture, width: number, height: number): void;
  /** Measures the source's hover scope into `scope`. Needs the source's mip chain built. */
  measureScope(source: WebGLTexture, width: number, height: number): void;
  dispose(): void;
}

/** A GPU measure for this context, or null where it cannot render to float targets or blend into them. */
export function createFieldMeasure(gl: WebGL2RenderingContext): FieldMeasure | null {
  if (!gl.getExtension('EXT_color_buffer_float') || !gl.getExtension('EXT_float_blend')) return null;
  const compile = (fragment: string, vertex = VERTEX): Program | null => {
    const shader = (type: number, code: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, code); gl.compileShader(s); return s; };
    const program = gl.createProgram()!, vs = shader(gl.VERTEX_SHADER, vertex), fs = shader(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(program, vs); gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return null; }
    const cache = new Map<string, WebGLUniformLocation | null>();
    return { program, at: name => { if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name)); return cache.get(name)!; } };
  };
  // Linked when first needed, once per context: every field measuring a moving source through it shares them.
  let cache = programCache.get(gl);
  if (!cache) programCache.set(gl, cache = new Map());
  const programs = cache;
  const need = (key: string, make: () => Program | null) => {
    const known = programs.get(key);
    if (known) return known;
    const made = make();
    if (!made) throw new Error('The glyph field could not build its GPU measure.');
    programs.set(key, made);
    return made;
  };
  const targets: Target[] = [];
  const target = (format: number, type: number, base: number, filter: number): Target => {
    const texture = gl.createTexture()!, buffer = gl.createFramebuffer()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const t = { texture, buffer, width: 0, height: 0, format, type, base } as Target & { format: number; type: number; base: number };
    targets.push(t);
    return t;
  };
  const size = (t: Target, width: number, height: number) => {
    const full = t as Target & { format: number; type: number; base: number };
    if (t.width === width && t.height === height) return;
    t.width = width; t.height = height;
    gl.bindTexture(gl.TEXTURE_2D, t.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, full.format, width, height, 0, full.base, full.type, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.buffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texture, 0);
  };
  let histogramTarget: Target | null = null, levelsTarget: Target | null = null, statsTarget: Target | null = null;
  let subjectTarget: Target | null = null, blurTarget: Target | null = null, scopeTarget: Target | null = null;
  const vao = gl.createVertexArray();
  const pass = (program: Program, t: Target) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.buffer);
    gl.viewport(0, 0, t.width, t.height);
    gl.useProgram(program.program);
  };
  // Every pass reads its inputs on unit 11, which the field's own draws do not use.
  const bind = (texture: WebGLTexture, program: Program, name: string) => {
    gl.activeTexture(gl.TEXTURE11); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(program.at(name), 11);
  };

  return {
    get levels() { return levelsTarget?.texture ?? null; },
    get scope() { return scopeTarget?.texture ?? null; },
    measureLevels(source, width, height) {
      const mip = mipLevelFor(width, height, 128);
      const histogram = need('histogram', () => compile(ONE, HISTOGRAM_VERTEX)), levelsProgram = need('levels', () => compile(LEVELS));
      histogramTarget ??= target(gl.R32F, gl.FLOAT, gl.RED, gl.NEAREST);
      levelsTarget ??= target(gl.RGBA32F, gl.FLOAT, gl.RGBA, gl.NEAREST);
      size(histogramTarget, 256, 1);
      size(levelsTarget, 1, 1);
      pass(histogram, histogramTarget);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      bind(source, histogram, 'uSource');
      gl.uniform1i(histogram.at('uLevel'), mip.level);
      gl.uniform1i(histogram.at('uWidth'), mip.width);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.POINTS, 0, mip.width * mip.height);
      gl.disable(gl.BLEND);
      pass(levelsProgram, levelsTarget);
      bind(histogramTarget.texture, levelsProgram, 'uHistogram');
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    measureScope(source, width, height) {
      const mip = mipLevelFor(width, height, 128), w = Math.min(128, mip.width), h = Math.min(128, mip.height);
      const stats = need('stats', () => compile(STATS)), subject = need('subject', () => compile(SUBJECT)), blur = need('blur', () => compile(BLUR));
      statsTarget ??= target(gl.RGBA32F, gl.FLOAT, gl.RGBA, gl.NEAREST);
      subjectTarget ??= target(gl.RGBA8, gl.UNSIGNED_BYTE, gl.RGBA, gl.NEAREST);
      blurTarget ??= target(gl.RGBA8, gl.UNSIGNED_BYTE, gl.RGBA, gl.NEAREST);
      scopeTarget ??= target(gl.RGBA8, gl.UNSIGNED_BYTE, gl.RGBA, gl.LINEAR);
      size(statsTarget, 1, 1); size(subjectTarget, w, h); size(blurTarget, w, h); size(scopeTarget, w, h);
      gl.bindVertexArray(vao);
      pass(stats, statsTarget);
      bind(source, stats, 'uSource');
      gl.uniform1i(stats.at('uLevel'), mip.level);
      gl.uniform2i(stats.at('uSize'), w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      pass(subject, subjectTarget);
      bind(source, subject, 'uSource');
      gl.uniform1i(subject.at('uLevel'), mip.level);
      gl.activeTexture(gl.TEXTURE12); gl.bindTexture(gl.TEXTURE_2D, statsTarget.texture); gl.uniform1i(subject.at('uStats'), 12);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const radius = Math.min(8, Math.max(1, Math.round(Math.min(w, h) * .02)));
      pass(blur, blurTarget);
      bind(subjectTarget.texture, blur, 'uImage');
      gl.uniform2i(blur.at('uStep'), 1, 0);
      gl.uniform1i(blur.at('uRadius'), radius);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      pass(blur, scopeTarget);
      bind(blurTarget.texture, blur, 'uImage');
      gl.uniform2i(blur.at('uStep'), 0, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      for (const t of targets) { gl.deleteTexture(t.texture); gl.deleteFramebuffer(t.buffer); }
      if (vao) gl.deleteVertexArray(vao);
      targets.length = 0;
      histogramTarget = levelsTarget = statsTarget = subjectTarget = blurTarget = scopeTarget = null;
    },
  };
}
