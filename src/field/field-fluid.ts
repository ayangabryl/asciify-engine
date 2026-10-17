/**
 * An incompressible fluid for the field's wake: splat, vorticity confinement, pressure projection, advection.
 * Velocity is in simulation texels per second, the convention of the classic WebGL stable-fluids solvers.
 * Needs float render targets; the field keeps its single-pass wake where they are missing.
 */

const HEADER = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform vec2 uTexel;
out vec4 outColor;
vec2 here(){return gl_FragCoord.xy*uTexel;}
`;

const SPLAT = HEADER + `
uniform sampler2D uVelocity;
uniform vec2 uFrom, uTo, uForce;
uniform float uAspect, uRadius;
float segment(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/max(dot(ba,ba),1e-8),0.,1.);return length(pa-ba*h);}
void main(){
  vec2 uv=here(),scale=vec2(uAspect,1.);
  float d=segment(uv*scale,uFrom*scale,uTo*scale);
  outColor=vec4(texture(uVelocity,uv).xy+uForce*exp(-d*d/(uRadius*uRadius)),0.,1.);
}`;

const CURL = HEADER + `
uniform sampler2D uVelocity;
void main(){
  vec2 uv=here();
  float l=texture(uVelocity,uv-vec2(uTexel.x,0.)).y,r=texture(uVelocity,uv+vec2(uTexel.x,0.)).y;
  float t=texture(uVelocity,uv+vec2(0.,uTexel.y)).x,b=texture(uVelocity,uv-vec2(0.,uTexel.y)).x;
  outColor=vec4(.5*(r-l-t+b),0.,0.,1.);
}`;

const VORTICITY = HEADER + `
uniform sampler2D uVelocity, uCurl;
uniform float uStrength, uDt;
void main(){
  vec2 uv=here();
  float l=texture(uCurl,uv-vec2(uTexel.x,0.)).x,r=texture(uCurl,uv+vec2(uTexel.x,0.)).x;
  float t=texture(uCurl,uv+vec2(0.,uTexel.y)).x,b=texture(uCurl,uv-vec2(0.,uTexel.y)).x,c=texture(uCurl,uv).x;
  vec2 force=.5*vec2(abs(t)-abs(b),abs(r)-abs(l));
  force=force/(length(force)+1e-4)*uStrength*c;
  force.y=-force.y;
  outColor=vec4(clamp(texture(uVelocity,uv).xy+force*uDt,-1000.,1000.),0.,1.);
}`;

const DIVERGENCE = HEADER + `
uniform sampler2D uVelocity;
void main(){
  vec2 uv=here(),c=texture(uVelocity,uv).xy;
  float l=texture(uVelocity,uv-vec2(uTexel.x,0.)).x,r=texture(uVelocity,uv+vec2(uTexel.x,0.)).x;
  float t=texture(uVelocity,uv+vec2(0.,uTexel.y)).y,b=texture(uVelocity,uv-vec2(0.,uTexel.y)).y;
  if(uv.x-uTexel.x<0.)l=-c.x;
  if(uv.x+uTexel.x>1.)r=-c.x;
  if(uv.y+uTexel.y>1.)t=-c.y;
  if(uv.y-uTexel.y<0.)b=-c.y;
  outColor=vec4(.5*(r-l+t-b),0.,0.,1.);
}`;

const FADE = HEADER + `
uniform sampler2D uSource;
uniform float uAmount;
void main(){outColor=vec4(texture(uSource,here()).x*uAmount,0.,0.,1.);}`;

const PRESSURE = HEADER + `
uniform sampler2D uPressure, uDivergence;
void main(){
  vec2 uv=here();
  float l=texture(uPressure,uv-vec2(uTexel.x,0.)).x,r=texture(uPressure,uv+vec2(uTexel.x,0.)).x;
  float t=texture(uPressure,uv+vec2(0.,uTexel.y)).x,b=texture(uPressure,uv-vec2(0.,uTexel.y)).x;
  outColor=vec4((l+r+b+t-texture(uDivergence,uv).x)*.25,0.,0.,1.);
}`;

const GRADIENT = HEADER + `
uniform sampler2D uPressure, uVelocity;
void main(){
  vec2 uv=here();
  float l=texture(uPressure,uv-vec2(uTexel.x,0.)).x,r=texture(uPressure,uv+vec2(uTexel.x,0.)).x;
  float t=texture(uPressure,uv+vec2(0.,uTexel.y)).x,b=texture(uPressure,uv-vec2(0.,uTexel.y)).x;
  outColor=vec4(texture(uVelocity,uv).xy-vec2(r-l,t-b),0.,1.);
}`;

const ADVECT = HEADER + `
uniform sampler2D uVelocity;
uniform float uDt, uDissipation;
void main(){
  vec2 uv=here();
  vec2 back=uv-uDt*texture(uVelocity,uv).xy*uTexel;
  outColor=vec4(texture(uVelocity,back).xy/(1.+uDissipation*uDt),0.,1.);
}`;

export interface FluidSplat { from: [number, number]; to: [number, number]; force: [number, number] }
export interface FluidStep { dt: number; radius: number; curl: number; dissipation: number; aspect: number }

type Locations = Record<string, WebGLUniformLocation | null>;
/** Starts linking a program; `ready` reports whether it has linked, without blocking where the browser can compile in parallel. */
export interface FieldProgram { program: WebGLProgram; locations: Locations | null }
type Link = (fragment: string) => FieldProgram;
type Ready = (entry: FieldProgram) => boolean;
interface Target { texture: WebGLTexture; buffer: WebGLFramebuffer }

const ITERATIONS = 20;

export function createStableFluid(gl: WebGL2RenderingContext, link: Link, linked: Ready) {
  const programs = {
    splat: link(SPLAT),
    curl: link(CURL),
    vorticity: link(VORTICITY),
    divergence: link(DIVERGENCE),
    fade: link(FADE),
    pressure: link(PRESSURE),
    gradient: link(GRADIENT),
    advect: link(ADVECT),
  };
  const entries = Object.values(programs);
  let width = 0, height = 0;
  let velocity: Target[] = [], pressure: Target[] = [], divergence: Target | null = null, curl: Target | null = null;

  const target = (filter: number): Target | null => {
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    const buffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(buffer); gl.deleteTexture(texture);
      return null;
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { texture, buffer };
  };
  const drop = (item: Target | null) => { if (item) { gl.deleteTexture(item.texture); gl.deleteFramebuffer(item.buffer); } };
  const release = () => {
    [...velocity, ...pressure, divergence, curl].forEach(drop);
    velocity = []; pressure = []; divergence = curl = null;
  };

  // Each pass binds its own inputs, so a step allocates nothing.
  const use = (entry: FieldProgram, output: Target) => {
    const at = entry.locations!;
    gl.useProgram(entry.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, output.buffer);
    gl.uniform2f(at.uTexel, 1 / width, 1 / height);
    return at;
  };
  const bind = (at: Locations, name: string, unit: number, texture: WebGLTexture) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(at[name], unit);
  };
  const draw = () => gl.drawArrays(gl.TRIANGLES, 0, 3);
  const swap = (pair: Target[]) => { const first = pair[0]; pair[0] = pair[1]; pair[1] = first; };

  return {
    /** Returns false when float render targets are unavailable. */
    resize(nextWidth: number, nextHeight: number) {
      release();
      width = nextWidth; height = nextHeight;
      const made = [target(gl.LINEAR), target(gl.LINEAR), target(gl.NEAREST), target(gl.NEAREST), target(gl.NEAREST), target(gl.NEAREST)];
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (made.some(item => !item)) { made.forEach(drop); return false; }
      velocity = [made[0]!, made[1]!]; pressure = [made[2]!, made[3]!]; divergence = made[4]; curl = made[5];
      return true;
    },
    /** True once every pass has linked. Throws if one failed. */
    ready() { return entries.every(linked); },
    step(splat: FluidSplat | null, options: FluidStep) {
      if (!velocity.length || !divergence || !curl) return;
      gl.viewport(0, 0, width, height);
      let at: Locations;
      if (splat) {
        at = use(programs.splat, velocity[1]);
        bind(at, 'uVelocity', 0, velocity[0].texture);
        gl.uniform2f(at.uFrom, splat.from[0], splat.from[1]);
        gl.uniform2f(at.uTo, splat.to[0], splat.to[1]);
        gl.uniform2f(at.uForce, splat.force[0], splat.force[1]);
        gl.uniform1f(at.uAspect, options.aspect);
        gl.uniform1f(at.uRadius, options.radius);
        draw(); swap(velocity);
      }
      if (options.curl > 0) {
        at = use(programs.curl, curl);
        bind(at, 'uVelocity', 0, velocity[0].texture);
        draw();
        at = use(programs.vorticity, velocity[1]);
        bind(at, 'uVelocity', 0, velocity[0].texture);
        bind(at, 'uCurl', 1, curl.texture);
        gl.uniform1f(at.uStrength, options.curl);
        gl.uniform1f(at.uDt, options.dt);
        draw(); swap(velocity);
      }
      at = use(programs.divergence, divergence);
      bind(at, 'uVelocity', 0, velocity[0].texture);
      draw();
      at = use(programs.fade, pressure[1]);
      bind(at, 'uSource', 0, pressure[0].texture);
      gl.uniform1f(at.uAmount, 0.8);
      draw(); swap(pressure);
      for (let i = 0; i < ITERATIONS; i++) {
        at = use(programs.pressure, pressure[1]);
        bind(at, 'uPressure', 0, pressure[0].texture);
        bind(at, 'uDivergence', 1, divergence.texture);
        draw(); swap(pressure);
      }
      at = use(programs.gradient, velocity[1]);
      bind(at, 'uPressure', 0, pressure[0].texture);
      bind(at, 'uVelocity', 1, velocity[0].texture);
      draw(); swap(velocity);
      at = use(programs.advect, velocity[1]);
      bind(at, 'uVelocity', 0, velocity[0].texture);
      gl.uniform1f(at.uDt, options.dt);
      gl.uniform1f(at.uDissipation, options.dissipation);
      draw(); swap(velocity);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    get velocity() { return velocity[0]?.texture ?? null; },
    get size() { return [width, height] as const; },
    release,
    dispose() {
      release();
      entries.forEach(({ program }) => gl.deleteProgram(program));
    },
  };
}
export type StableFluid = ReturnType<typeof createStableFluid>;
