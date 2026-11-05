import { GLYPH_CELL_ASPECT, GLYPH_COLS, GLYPH_ROWS } from './glyph-table';
import { glyphTables, gridParams, levelsOf, matchConstants, prepareMatch, type AsciiGrid, type AsciiGridOptions } from './grid';
import { imageToAsciiGrid, sizeOf, type AsciiImageSource } from './image';

/** Error-diffusion offsets tried per cell: the carried error is looked up among these, 1/40 apart (±0.25). */
const OFFSETS = 21, OFFSET_STEP = 1 / 80;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const VERTEX = `#version 300 es
void main(){ vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2)); gl_Position=vec4(p*2.-1.,0.,1.); }`;

// The frame averaged over this output texel's box: the mip level as fine as the box's short side, a few taps along its long
// side (a cell is about twice as tall as wide), all in linear light from the sRGB texture.
const AVERAGE = `
vec2 uv0(){ return (gl_FragCoord.xy-uOrigin)/uGrid; }
vec4 average(vec2 uv){
  vec2 texels=uSourceSize/uGrid;
  // One tap per texel of the finest mip level that needs at most 6 a side: the box's own average, not a blur twice its size.
  float lod=max(0.,ceil(log2(max(texels.x,texels.y)/6.)));
  ivec2 n=ivec2(clamp(floor(texels/exp2(lod)+.5),1.,6.));
  vec4 sum=vec4(0.);
  for(int y=0;y<6;y++){ if(y>=n.y)break; for(int x=0;x<6;x++){ if(x>=n.x)break;
    vec2 at=uv+((vec2(x,y)+.5)/vec2(n)-.5)/uGrid;
    sum+=textureLod(uSource,at,lod);
  } }
  return sum/float(n.x*n.y);
}`;

// Each part of each cell: the frame's light averaged over the part (the mip level that size, sampled in linear light), as a
// perceptual tone in 16 bits (R high byte, G low). Cells' colours, when asked, in a second target at cell size.
const PARTS = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uGrid, uSourceSize, uOrigin;
uniform float uGround;
out vec4 o;
float perceptual(float v){ return v<=.0031308?v*12.92:1.055*pow(v,1./2.4)-.055; }
${AVERAGE}
void main(){
  vec4 c=average(uv0());
  vec3 rgb=c.rgb*c.a+uGround*(1.-c.a);
  float v=clamp(perceptual(clamp(dot(rgb,vec3(.2126,.7152,.0722)),0.,1.)),0.,1.);
  float q=floor(v*65535.+.5);
  o=vec4(floor(q/256.)/255.,mod(q,256.)/255.,0.,1.);
}`;
const COLORS = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uGrid, uSourceSize, uOrigin;
uniform float uGround;
out vec4 o;
vec3 perceptual(vec3 v){ return mix(v*12.92,1.055*pow(v,vec3(1./2.4))-.055,step(vec3(.0031308),v)); }
${AVERAGE}
void main(){
  vec4 c=average(uv0());
  o=vec4(perceptual(clamp(c.rgb*c.a+uGround*(1.-c.a),0.,1.)),1.);
}`;

// Levels on the GPU: every part's tone counted into a 256-bin histogram (one point a part, added up by blending), then the
// 2nd and 98th percentiles read off it, as levelsOf does on the CPU.
const HIST_VERTEX = `#version 300 es
precision highp float;
uniform sampler2D uParts;
void main(){
  int w=textureSize(uParts,0).x;
  vec4 p=texelFetch(uParts,ivec2(gl_VertexID%w,gl_VertexID/w),0);
  float t=(floor(p.r*255.+.5)*256.+floor(p.g*255.+.5))/65535.;
  gl_Position=vec4((floor(t*255.+.5)+.5)/128.-1.,0.,0.,1.);
  gl_PointSize=1.;
}`;
const HIST = `#version 300 es
precision highp float;
out vec4 o;
void main(){ o=vec4(1.); }`;
const LEVELS = `#version 300 es
precision highp float;
uniform sampler2D uHist;
uniform float uTotal;
out vec4 o;
void main(){
  float lo=0.,hi=1.,acc=0.,need=uTotal*.01;
  for(int v=0;v<256;v++){ acc+=texelFetch(uHist,ivec2(v,0),0).r; if(acc>=need){lo=float(v)/255.;break;} }
  acc=0.;
  for(int v=255;v>=0;v--){ acc+=texelFetch(uHist,ivec2(v,0),0).r; if(acc>=need){hi=float(v)/255.;break;} }
  if(hi-lo<.05){lo=0.;hi=1.;}
  o=vec4(lo,hi,0.,1.);
}`;

// Every cell's character at each of OFFSETS carried errors (one when not diffusing): the same matching as the CPU path, all
// cells at once.
const MATCH = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uParts, uGlyphs, uOrder, uPrevious, uLevels;
uniform int uCount, uFillCount, uRows, uOffsets, uShape, uOrdered, uHasPrevious, uLight, uShifts, uCellLevel, uGpuLevels;
uniform float uLo, uSpan, uContrast, uBrightness, uInvGamma, uStep, uSharpness, uSoften, uStructure, uToneWeight, uShiftCost, uKeepMargin, uKeepTone;
uniform float uWeight[15];
uniform float uBayer[16];
out vec4 o;
float tone(ivec2 at){ vec4 p=texelFetch(uParts,at,0); return (floor(p.r*255.+.5)*256.+floor(p.g*255.+.5))/65535.; }
float g(int glyph,int k){ return texelFetch(uGlyphs,ivec2(k,glyph),0).r; }
float score(int glyph,float soft[15],float softSquare){
  float best=1e30;
  for(int s=0;s<3;s++){
    if(s!=1&&uShifts==0)continue;
    float dot=0.;
    for(int k=0;k<15;k++)dot+=g(glyph,s*15+k)*soft[k];
    float v=g(glyph,45+s)-2.*dot+softSquare+(s!=1?uShiftCost:0.);
    best=min(best,v);
  }
  return best;
}
// One cell's character with \`offset\` of carried error added to each part; whether it was matched by shape, and its tone.
int pick(float base[15],float offset,int c,int r,int keep,out bool structured,out float want){
  float v[15];
  float most=0.;
  want=0.;
  for(int i=0;i<15;i++){ float t=clamp(base[i]+offset,0.,1.); v[i]=t; want+=t; most=max(most,t); }
  want/=15.;
  float spread2=0.;
  for(int i=0;i<15;i++){float d=v[i]-want;spread2+=d*d;}
  structured=uShape==1&&sqrt(spread2/15.)>uStructure*(want+.08);
  int best=0;
  if(structured){
    if(uSharpness>1.&&most>0.)for(int i=0;i<15;i++)v[i]=most*pow(v[i]/most,uSharpness);
    float soft[15];
    float side=uSoften/4.;
    for(int y=0;y<5;y++)for(int x=0;x<3;x++){
      float self=v[y*3+x];
      float l=x>0?v[y*3+x-1]:self, rr=x<2?v[y*3+x+1]:self, u=y>0?v[(y-1)*3+x]:self, d=y<4?v[(y+1)*3+x]:self;
      soft[y*3+x]=uSoften<=0.?self:self*(1.-uSoften)+(l+rr+u+d)*side;
    }
    float peak=1e-6;
    for(int i=0;i<15;i++)peak=max(peak,soft[i]);
    float softSquare=0.;
    for(int i=0;i<15;i++){soft[i]/=peak;softSquare+=uWeight[i]*soft[i]*soft[i];}
    // Outward from the cell's tone through the glyphs sorted by stroke tone, each side stopping once tone alone costs more.
    int a=0,b=uCount;
    while(a<b){int m=(a+b)/2;if(texelFetch(uOrder,ivec2(1,m),0).r<want)a=m+1;else b=m;}
    int hi=a,lo=a-1;
    bool loOpen=lo>=0,hiOpen=hi<uCount;
    float bestScore=1e30;
    for(int n=0;n<256;n++){
      if(!loOpen&&!hiOpen)break;
      bool useLo=loOpen&&(!hiOpen||want-texelFetch(uOrder,ivec2(1,lo),0).r<=texelFetch(uOrder,ivec2(1,hi),0).r-want);
      int glyph=int(texelFetch(uOrder,ivec2(0,useLo?lo:hi),0).r+.5);
      float miss=g(glyph,48)-want,toneCost=uToneWeight*miss*miss;
      if(toneCost>=bestScore){if(useLo)loOpen=false;else hiOpen=false;continue;}
      float sc=toneCost+score(glyph,soft,softSquare);
      if(sc<bestScore){bestScore=sc;best=glyph;}
      if(useLo){lo--;loOpen=lo>=0;}else{hi++;hiOpen=hi<uCount;}
    }
    if(keep>=0&&keep!=best){
      float miss=g(keep,48)-want;
      if(uToneWeight*miss*miss+score(keep,soft,softSquare)<=bestScore+uKeepMargin)best=keep;
    }
  } else if(uOrdered==1){
    int lo=-1,hi=-1;
    for(int n=0;n<256;n++){
      if(n>=uFillCount)break;
      int i=int(texelFetch(uOrder,ivec2(2,n),0).r+.5);
      float t=g(i,49);
      if(t<=want&&(lo<0||t>g(lo,49)))lo=i;
      if(t>=want&&(hi<0||t<g(hi,49)))hi=i;
    }
    if(lo<0)best=hi;else if(hi<0||hi==lo)best=lo;
    else best=(want-g(lo,49))/(g(hi,49)-g(lo,49))>(uBayer[(r&3)*4+(c&3)]+.5)/16.?hi:lo;
    if(keep>=0&&keep!=best&&g(keep,50)>.5&&abs(g(keep,49)-want)<=uKeepTone)best=keep;
  } else {
    float bestDelta=1e30;
    for(int n=0;n<256;n++){
      if(n>=uFillCount)break;
      int i=int(texelFetch(uOrder,ivec2(2,n),0).r+.5);
      float d=abs(g(i,49)-want);
      if(d<bestDelta){bestDelta=d;best=i;}
    }
    if(keep>=0&&keep!=best&&g(keep,50)>.5&&abs(g(keep,49)-want)<=bestDelta+uKeepTone)best=keep;
  }
  return best;
}
// A cell's results fill a column of texels, four bytes each: its character at every carried error tried (7 bits, the top bit
// set when matched by shape), then its tone at the first, middle and last of them, for the error it passes on.
void main(){
  int c=int(gl_FragCoord.x), fy=int(gl_FragCoord.y), j=fy/uRows, r=fy-j*uRows;
  float lo=uLo,span=uSpan;
  if(uGpuLevels==1){ vec2 l=texelFetch(uLevels,ivec2(0),0).rg; lo=l.x; span=1./max(l.y-l.x,1e-3); }
  float base[15];
  for(int y=0;y<5;y++)for(int x=0;x<3;x++){
    float t=clamp((tone(uCellLevel==1?ivec2(c,r):ivec2(c*3+x,r*5+y))-lo)*span,0.,1.);
    t=clamp((t-.5)*uContrast+.5+uBrightness,0.,1.);
    if(uInvGamma!=1.)t=pow(t,uInvGamma);
    if(uLight==1)t=1.-t;
    base[y*3+x]=t;
  }
  int keep=uHasPrevious==1?int(floor(texelFetch(uPrevious,ivec2(c,r),0).r*255.+.5))-1:-1;
  vec4 bytes=vec4(0.);
  int centre=(uOffsets-1)/2;
  for(int b=0;b<4;b++){
    int at=j*4+b;
    float byte=0.;
    if(at<uOffsets){
      bool structured; float want;
      int best=pick(base,float(at-centre)*uStep,c,r,keep,structured,want);
      byte=float(best+(structured?128:0));
    } else if(at<uOffsets+3){
      // The cell's tone at the first, middle and last error tried.
      float off=float((at-uOffsets)*centre-centre)*uStep, want=0.;
      for(int i=0;i<15;i++)want+=clamp(base[i]+off,0.,1.);
      byte=floor(clamp(want/15.,0.,1.)*255.+.5);
    }
    bytes[b]=byte/255.;
  }
  o=bytes;
}`;

/** Byte `k` of cell (c, r): texel k / 4 of the cell's column of texels, channel k % 4. */
function byteAt(columns: number, rows: number, c: number, r: number, k: number) { return ((r + (k >> 2) * rows) * columns + c) * 4 + (k & 3); }

/** Each cell's character, without diffusion. Top-level and closure-free, so the engine optimizes it. */
function walkPlain(picked: Uint8Array, columns: number, rows: number, codes: Uint16Array): string[] {
  const lines: string[] = [], row = new Uint16Array(columns);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) row[c] = codes[picked[byteAt(columns, rows, c, r, 0)] & 127] ?? 32;
    lines.push(text(row));
  }
  return lines;
}

/**
 * Floyd–Steinberg over the cells: the error carried so far picks among the characters matched at nearby errors, and what the
 * chosen character leaves is passed on. A cell's tone at its error is read off the three tones the GPU measured (first,
 * middle and last error tried), between them in a straight line, plus what is left of the error. `strokeTones` are the
 * tones of glyphs matched by shape, `fillTones` of those picked by tone.
 */
function walkDiffused(picked: Uint8Array, columns: number, rows: number, codes: Uint16Array, fillTones: Float64Array, strokeTones: Float64Array): string[] {
  const lines: string[] = [], row = new Uint16Array(columns), carried = new Float32Array(columns * rows), half = (OFFSETS - 1) / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const cell = r * columns + c, e = carried[cell];
      const k = Math.min(OFFSETS - 1, Math.max(0, Math.round(e / OFFSET_STEP) + half)), byte = picked[byteAt(columns, rows, c, r, k)];
      const g = byte & 127;
      const low = picked[byteAt(columns, rows, c, r, OFFSETS)] / 255, mid = picked[byteAt(columns, rows, c, r, OFFSETS + 1)] / 255, high = picked[byteAt(columns, rows, c, r, OFFSETS + 2)] / 255;
      let want = (k <= half ? low + (mid - low) * (k / half) : mid + (high - mid) * ((k - half) / half)) + (e - (k - half) * OFFSET_STEP);
      want = want < 0 ? 0 : want > 1 ? 1 : want;
      const error = want - (byte >= 128 ? strokeTones[g] : fillTones[g]);
      if (c + 1 < columns) carried[cell + 1] += error * (7 / 16);
      if (r + 1 < rows) {
        if (c > 0) carried[cell + columns - 1] += error * (3 / 16);
        carried[cell + columns] += error * (5 / 16);
        if (c + 1 < columns) carried[cell + columns + 1] += error * (1 / 16);
      }
      row[c] = codes[g] ?? 32;
    }
    lines.push(text(row));
  }
  return lines;
}

/** A row of character codes as a string, in chunks small enough to pass as arguments. */
function text(row: Uint16Array): string {
  if (row.length <= 4096) return String.fromCharCode.apply(null, row as unknown as number[]);
  let out = '';
  for (let i = 0; i < row.length; i += 4096) out += String.fromCharCode.apply(null, row.subarray(i, i + 4096) as unknown as number[]);
  return out;
}

/** Converts frames to character grids on the GPU. One per page is plenty; reuse it for every frame of a video. */
export interface AsciiGpu {
  /**
   * The frame as a grid of characters, matched on the GPU: the same options and, within rounding, the same characters as
   * `toAsciiGrid`. Resolves once the GPU is done, normally the next frame; the main thread only uploads the frame and walks
   * the cells once.
   */
  convert(source: AsciiImageSource, options?: AsciiGridOptions): Promise<AsciiGrid>;
  /** The last frame's cost: time on the main thread (upload, readback copies, the walk over the cells) and in all. */
  readonly stats: { mainThreadMs: number; totalMs: number };
  destroy(): void;
}

type Program = { program: WebGLProgram; at: (name: string) => WebGLUniformLocation | null };

/** A WebGL2 converter, or null where WebGL2 (or rendering to a texture) is missing: use `imageToAsciiGrid` there. */
export function createAsciiGpu(): AsciiGpu | null {
  if (typeof document === 'undefined' && typeof OffscreenCanvas !== 'function') return null;
  const canvas: HTMLCanvasElement | OffscreenCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(1, 1);
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false }) as WebGL2RenderingContext | null;
  if (!gl) return null;
  const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const compile = (fragment: string, vertex = VERTEX): Program | null => {
    const shader = (type: number, source: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, source); gl.compileShader(s); return s; };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    const cache = new Map<string, WebGLUniformLocation | null>();
    return { program, at: name => { if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name)); return cache.get(name)!; } };
  };
  const parts = compile(PARTS), colors = compile(COLORS), match = compile(MATCH);
  if (!parts || !colors || !match) return null;
  // Levels on the GPU need float targets that blend; without them the parts come back and the CPU reads the levels off them.
  const floatLevels = !!gl.getExtension('EXT_color_buffer_float') && !!gl.getExtension('EXT_float_blend');
  const hist = floatLevels ? compile(HIST, HIST_VERTEX) : null, levels = floatLevels ? compile(LEVELS) : null;
  const vao = gl.createVertexArray();
  const texture = (filter: number) => {
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.LINEAR_MIPMAP_LINEAR ? gl.LINEAR : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  // Uploads and resizes go through unit 7, which no program samples, so a target is never bound where a pass reads.
  const source = texture(gl.LINEAR_MIPMAP_LINEAR), glyphTex = texture(gl.NEAREST), orderTex = texture(gl.NEAREST), previousTex = texture(gl.NEAREST);
  // Render targets, kept and resized as grids change.
  const target = () => ({ texture: texture(gl.NEAREST), buffer: gl.createFramebuffer()!, width: 0, height: 0 });
  const partsTarget = target(), matchTarget = target(), histTarget = target(), levelsTarget = target();
  const floatTarget = (t: ReturnType<typeof target>, width: number, format: number) => {
    t.width = width; t.height = 1;
    gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, t.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, width, 1, 0, format === gl.R32F ? gl.RED : gl.RGBA, gl.FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.buffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texture, 0);
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  };
  const gpuLevels = !!hist && !!levels && floatTarget(histTarget, 256, gl.R32F) && floatTarget(levelsTarget, 1, gl.RGBA32F);
  const size = (t: ReturnType<typeof target>, width: number, height: number) => {
    if (t.width === width && t.height === height) return;
    t.width = width; t.height = height;
    gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, t.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.buffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texture, 0);
  };
  const run = (program: Program, t: ReturnType<typeof target>) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.buffer);
    gl.viewport(0, 0, t.width, t.height);
    gl.useProgram(program.program);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  // Reads a target back without waiting on the GPU: copied into a pixel buffer, fetched once a fence says it is done.
  const pending: WebGLBuffer[] = [];
  // Main-thread time of the frame being converted: everything but the waits for the GPU.
  let busy = 0, mark = 0, gpuMs = 0;
  const issue = (t: ReturnType<typeof target>) => {
    const buffer = pending.pop() ?? gl.createBuffer()!, bytes = t.width * t.height * 4;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.buffer);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
    gl.readPixels(0, 0, t.width, t.height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
    gl.flush();
    return { buffer, bytes, sync };
  };
  const collect = async ({ buffer, bytes, sync }: ReturnType<typeof issue>): Promise<Uint8Array> => {
    // Each check is a round trip to the GPU process, so the first waits most of what the last frame took (frames of a video
    // cost about the same; at most 50 ms), then checks follow 1, 2, 4, 8 and at most 16 ms apart.
    const issued = performance.now();
    for (let wait = Math.min(50, Math.floor(gpuMs * 0.8)); ; wait = Math.min(16, wait ? wait * 2 : 1)) {
      busy += performance.now() - mark;
      await new Promise(resolve => setTimeout(resolve, wait));
      mark = performance.now();
      if (destroyed) { gl.deleteSync(sync); throw new Error('The ASCII GPU converter was destroyed.'); }
      const state = gl.clientWaitSync(sync, 0, 0);
      if (state === gl.ALREADY_SIGNALED || state === gl.CONDITION_SATISFIED) { gpuMs = performance.now() - issued; break; }
      if (state === gl.WAIT_FAILED || gl.isContextLost()) { gl.deleteSync(sync); pending.push(buffer); throw new Error('The GPU did not finish the ASCII grid (context lost).'); }
    }
    gl.deleteSync(sync);
    const out = new Uint8Array(bytes);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    pending.push(buffer);
    return out;
  };
  const read = (t: ReturnType<typeof target>) => collect(issue(t));
  const stats = { mainThreadMs: 0, totalMs: 0 };
  // Glyph tables, uploaded once per charset and mode.
  let glyphKey = '';
  const { weight, shifted } = glyphTables();
  const constants = matchConstants();
  let prepared: ReturnType<typeof prepareMatch> | null = null, preparedKey = '', codes = new Uint16Array(0);
  let destroyed = false, queue: Promise<unknown> = Promise.resolve();

  const cpu = async (frame: AsciiImageSource, options: AsciiGridOptions) => imageToAsciiGrid(frame, options);
  const convertTimed = async (frame: AsciiImageSource, options: AsciiGridOptions): Promise<AsciiGrid> => {
    const start = performance.now();
    busy = 0; mark = start;
    try {
      // A lost context (the GPU reset, the tab in the background too long) falls back to the CPU path rather than failing.
      if (gl.isContextLost()) return await cpu(frame, options);
      try { return await convertNow(frame, options); }
      catch (error) { if (!destroyed && gl.isContextLost()) return await cpu(frame, options); throw error; }
    }
    finally { const end = performance.now(); stats.mainThreadMs = busy + end - mark; stats.totalMs = end - start; }
  };
  const convertNow = async (frame: AsciiImageSource, options: AsciiGridOptions): Promise<AsciiGrid> => {
    const [width, height] = sizeOf(frame);
    if (!(width > 0 && height > 0)) throw new Error('convert needs a source with a size (a decoded image, a playing video, a canvas).');
    const p = gridParams({ cellAspect: GLYPH_CELL_ASPECT, ...options }, width, height);
    const { columns, rows } = p;
    // The glyph pool and its tones, kept while the charset, mode and sharpness stay the same (every frame of a video).
    const matchKey = `${options.charset ?? ''}|${p.mode}|${options.sharpness ?? ''}`;
    if (matchKey !== preparedKey) { prepared = prepareMatch(options, p.mode); preparedKey = matchKey; codes = Uint16Array.from(prepared.glyphs, ch => ch.charCodeAt(0)); }
    const m = prepared!;
    const offsets = p.diffuse ? OFFSETS : 1;
    // Past the GPU's texture size or 127 glyphs, the CPU path does it.
    if (columns * GLYPH_COLS > maxSize || rows * GLYPH_ROWS > maxSize || rows * Math.ceil((offsets + 3) / 4) > maxSize || m.glyphs.length > 127) {
      return cpu(frame, options);
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    // sRGB storage, so the mip chain and filtering average light, as the CPU path does.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, frame as TexImageSource);
    gl.generateMipmap(gl.TEXTURE_2D);
    const ground = p.light ? 1 : 0;

    // 1. Parts: a tone for each of each cell's 15 parts, or one a cell when nothing is matched by shape (tone mode).
    const cellLevel = !m.shapeMode, across = cellLevel ? 1 : GLYPH_COLS, down = cellLevel ? 1 : GLYPH_ROWS, perCell = across * down;
    size(partsTarget, columns * across, rows * down);
    gl.useProgram(parts.program);
    gl.uniform1i(parts.at('uSource'), 0);
    gl.uniform2f(parts.at('uGrid'), columns * across, rows * down);
    gl.uniform2f(parts.at('uSourceSize'), width, height);
    gl.uniform1f(parts.at('uGround'), ground);
    gl.uniform2f(parts.at('uOrigin'), 0, 0);
    run(parts, partsTarget);
    // Levels: the 2nd and 98th percentile tones, counted on the GPU; or, without float targets, read off the parts on the CPU.
    let lo = 0, hi = 1;
    const levelsOnGpu = options.levels !== 'none' && gpuLevels;
    if (levelsOnGpu) {
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, partsTarget.texture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, histTarget.buffer);
      gl.viewport(0, 0, 256, 1);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(hist!.program);
      gl.uniform1i(hist!.at('uParts'), 1);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.POINTS, 0, columns * rows * perCell);
      gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, histTarget.texture);
      gl.useProgram(levels!.program);
      gl.uniform1i(levels!.at('uHist'), 5);
      gl.uniform1f(levels!.at('uTotal'), columns * rows * perCell);
      run(levels!, levelsTarget);
    } else if (options.levels !== 'none') {
      const bytes = await read(partsTarget), tones = new Float32Array(columns * rows * perCell);
      for (let i = 0; i < tones.length; i++) tones[i] = (bytes[i * 4] * 256 + bytes[i * 4 + 1]) / 65535;
      if (destroyed) throw new Error('The ASCII GPU converter was destroyed.');
      [lo, hi] = levelsOf(tones);
    }

    // 2. Glyph tables and the previous grid.
    const key = `${m.glyphs.join('')}|${p.mode}`;
    if (key !== glyphKey) {
      glyphKey = key;
      const n = m.glyphs.length, row = 52, data = new Float32Array(row * n), inFill = new Uint8Array(n);
      for (const g of m.fill) inFill[g] = 1;
      for (let g = 0; g < n; g++) {
        const gi = Math.max(0, m.indices[g]);
        for (let k = 0; k < 45; k++) data[g * row + k] = shifted.ink[gi * 45 + k];
        for (let sft = 0; sft < 3; sft++) data[g * row + 45 + sft] = shifted.square[gi * 3 + sft];
        data[g * row + 48] = m.strokeTone[g]; data[g * row + 49] = m.toneOf[g]; data[g * row + 50] = inFill[g];
      }
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, glyphTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, row, n, 0, gl.RED, gl.FLOAT, data);
      // Per row: the glyphs by stroke tone and that tone (for the shape search), and the fill ramp in its own order (ties go
      // to the character first in it, as on the CPU).
      const order = Array.from(m.indices, (_, g) => g).sort((a, b) => m.strokeTone[a] - m.strokeTone[b]);
      const height = Math.max(n, m.fill.length), orderData = new Float32Array(3 * height);
      order.forEach((g, i) => { orderData[i * 3] = g; orderData[i * 3 + 1] = m.strokeTone[g]; });
      m.fill.forEach((g, i) => { orderData[i * 3 + 2] = g; });
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, orderTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 3, height, 0, gl.RED, gl.FLOAT, orderData);
    }
    const previous = options.previous && options.previous.columns === columns && options.previous.rows === rows ? options.previous.lines : null;
    if (previous) {
      const at = new Map(m.glyphs.map((char, g) => [char, g])), data = new Uint8Array(columns * rows);
      for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) { const g = at.get(previous[r][c]); data[r * columns + c] = g === undefined ? 0 : g + 1; }
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, previousTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, columns, rows, 0, gl.RED, gl.UNSIGNED_BYTE, data);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    }

    // 3. Match every cell, at every carried error when diffusing.
    // The cells' colours, when asked, go in rows of their own below the matches, so one readback brings back everything.
    const texels = Math.ceil((offsets + 3) / 4);
    size(matchTarget, columns, rows * (texels + (p.wantColor ? 1 : 0)));
    gl.useProgram(match.program);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, partsTarget.texture); gl.uniform1i(match.at('uParts'), 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, glyphTex); gl.uniform1i(match.at('uGlyphs'), 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, orderTex); gl.uniform1i(match.at('uOrder'), 3);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, previousTex); gl.uniform1i(match.at('uPrevious'), 4);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, levelsTarget.texture); gl.uniform1i(match.at('uLevels'), 6);
    gl.uniform1i(match.at('uGpuLevels'), levelsOnGpu ? 1 : 0);
    gl.uniform1i(match.at('uCount'), m.glyphs.length);
    gl.uniform1i(match.at('uFillCount'), m.fill.length);
    gl.uniform1i(match.at('uCellLevel'), cellLevel ? 1 : 0);
    gl.uniform1i(match.at('uRows'), rows);
    gl.uniform1i(match.at('uOffsets'), offsets);
    gl.uniform1i(match.at('uShape'), m.shapeMode ? 1 : 0);
    gl.uniform1i(match.at('uOrdered'), p.ordered ? 1 : 0);
    gl.uniform1i(match.at('uHasPrevious'), previous ? 1 : 0);
    gl.uniform1i(match.at('uLight'), p.light ? 1 : 0);
    gl.uniform1i(match.at('uShifts'), constants.shiftCost ? 1 : 0);
    gl.uniform1f(match.at('uLo'), lo);
    gl.uniform1f(match.at('uSpan'), 1 / Math.max(hi - lo, 1e-3));
    gl.uniform1f(match.at('uContrast'), p.contrast);
    gl.uniform1f(match.at('uBrightness'), p.brightness);
    gl.uniform1f(match.at('uInvGamma'), 1 / p.gamma);
    gl.uniform1f(match.at('uStep'), OFFSET_STEP);
    gl.uniform1f(match.at('uSharpness'), m.sharpness);
    gl.uniform1f(match.at('uSoften'), constants.soften);
    gl.uniform1f(match.at('uStructure'), constants.structure);
    gl.uniform1f(match.at('uToneWeight'), constants.toneWeight);
    gl.uniform1f(match.at('uShiftCost'), constants.shiftCost);
    gl.uniform1f(match.at('uKeepMargin'), constants.keepMargin);
    gl.uniform1f(match.at('uKeepTone'), constants.keepTone);
    gl.uniform1fv(match.at('uWeight'), weight);
    gl.uniform1fv(match.at('uBayer'), BAYER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, matchTarget.buffer);
    gl.viewport(0, 0, columns, rows * texels);
    gl.useProgram(match.program); gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (p.wantColor) {
      gl.viewport(0, rows * texels, columns, rows);
      gl.useProgram(colors.program);
      gl.uniform1i(colors.at('uSource'), 0);
      gl.uniform2f(colors.at('uGrid'), columns, rows);
      gl.uniform2f(colors.at('uSourceSize'), width, height);
      gl.uniform2f(colors.at('uOrigin'), 0, rows * texels);
      gl.uniform1f(colors.at('uGround'), ground);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    const picked = await read(matchTarget);
    if (destroyed) throw new Error('The ASCII GPU converter was destroyed.');

    // 4. Walk the cells once: without diffusion each takes its character; with it, the error carried so far picks among the
    // characters matched at nearby errors, and what it leaves is passed on as Floyd–Steinberg does.
    const lines = p.diffuse ? walkDiffused(picked, columns, rows, codes, m.toneOf, m.strokeTone) : walkPlain(picked, columns, rows, codes);
    let rgb: Uint8Array | null = null;
    if (p.wantColor) {
      rgb = new Uint8Array(columns * rows * 3);
      for (let i = 0, at = rows * texels * columns * 4; i < columns * rows; i++, at += 4) { rgb[i * 3] = picked[at]; rgb[i * 3 + 1] = picked[at + 1]; rgb[i * 3 + 2] = picked[at + 2]; }
    }
    return { columns, rows, lines, colors: rgb, background: p.light ? 'light' : 'dark' };
  };

  return {
    convert(frame, options = {}) {
      if (destroyed) return Promise.reject(new Error('The ASCII GPU converter was destroyed.'));
      // One frame at a time: the targets are shared.
      const next = queue.then(() => convertTimed(frame, options));
      queue = next.catch(() => {});
      return next;
    },
    get stats() { return { ...stats }; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      (gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
    },
  };
}

let shared: AsciiGpu | null | undefined;
/**
 * `imageToAsciiGrid` on the GPU, for live video and large grids in a page or worker: the page's shared converter, made on
 * first use. Falls back to `imageToAsciiGrid` on the CPU where WebGL2 is missing.
 */
export async function imageToAsciiGridGPU(source: AsciiImageSource, options: AsciiGridOptions = {}): Promise<AsciiGrid> {
  if (shared === undefined) shared = createAsciiGpu();
  return shared ? shared.convert(source, options) : imageToAsciiGrid(source, options);
}


