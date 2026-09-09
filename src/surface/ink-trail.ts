/** A bounded, advected ink field. Independent of image resolution and glyph count. */
export class InkTrail {
  readonly pixels: Uint8Array;
  private u: Float32Array; private v: Float32Array; private ink: Float32Array;
  private a: Float32Array; private b: Float32Array; private c: Float32Array;
  private pressure: Float32Array; private pressureNext: Float32Array;
  private divergence: Float32Array; private curl: Float32Array;
  private offsetX: Float32Array; private offsetY: Float32Array;
  private driftX: Float32Array; private driftY: Float32Array;
  private previous: {x: number; y: number; time: number} | null = null;
  private signal: Float32Array;
  private peak = 0;
  readonly width: number; readonly height: number;
  constructor(width: number, height: number) {
    this.width=width; this.height=height;
    const n = width * height;
    this.pixels = new Uint8Array(n * 4);
    this.signal = new Float32Array(n);
    this.offsetX=new Float32Array(n); this.offsetY=new Float32Array(n);
    this.driftX=new Float32Array(n); this.driftY=new Float32Array(n);
    this.u=new Float32Array(n); this.v=new Float32Array(n); this.ink=new Float32Array(n);
    this.a=new Float32Array(n); this.b=new Float32Array(n); this.c=new Float32Array(n);
    this.pressure=new Float32Array(n); this.pressureNext=new Float32Array(n);
    this.divergence=new Float32Array(n); this.curl=new Float32Array(n);
  }
  get active() { return this.peak > .0002; }
  clear() {
    for (const f of [this.u,this.v,this.ink,this.a,this.b,this.c,this.pressure,this.pressureNext,this.divergence,this.curl,this.signal,this.pixels,this.offsetX,this.offsetY,this.driftX,this.driftY]) f.fill(0);
    this.previous=null; this.peak=0;
  }
  leave() { this.previous=null; }
  move(x: number, y: number, radius: number, time = performance.now()) {
    if (!Number.isFinite(x + y + radius + time)) return;
    x = Math.max(0, Math.min(1, x)); y = Math.max(0, Math.min(1, y));
    radius = Math.max(.1, Math.min(1, radius));
    const old = this.previous; this.previous = {x, y, time}; if (!old) return;
    const dx = (x-old.x)*(this.width-1), dy = (y-old.y)*(this.height-1);
    const travel = Math.hypot(dx,dy); if (travel < .001) return;
    const size = Math.min(this.width,this.height);
    // Pointer speed, rather than event count, controls the wake's width and force.
    // Coalesced input is still integrated along the complete travelled segment.
    const elapsed = time > old.time ? Math.max(1/240, (time-old.time)/1000) : 1/60;
    const speed = Math.min(12, travel / size / elapsed);
    const energy = 1 - Math.exp(-speed / 2.2);
    const r = size * (.022 + radius*.075) * (.65 + energy*.95);
    const count = Math.min(128,Math.max(1,Math.ceil(travel/(r*.4))));
    const deposit = travel/r * (.32 + energy*.22) / count;
    const tx=dx/travel, ty=dy/travel, nx=-ty, ny=tx;
    const force = travel * (2 + energy*18) / count;
    for (let s=0;s<count;s++) {
      const t=(s+.5)/count, cx=(old.x+(x-old.x)*t)*(this.width-1), cy=(old.y+(y-old.y)*t)*(this.height-1);
      const left=Math.max(1,Math.floor(cx-r*3)), right=Math.min(this.width-2,Math.ceil(cx+r*3));
      const top=Math.max(1,Math.floor(cy-r*3)), bottom=Math.min(this.height-2,Math.ceil(cy+r*3));
      for (let gy=top;gy<=bottom;gy++) for (let gx=left;gx<=right;gx++) {
        const along=((gx-cx)*tx+(gy-cy)*ty)/r;
        const across=((gx-cx)*nx+(gy-cy)*ny)/r;
        const k=Math.exp(-along*along*.65-across*across*1.7), i=gy*this.width+gx;
        // Exponential accumulation avoids a clipped, uniformly painted plateau.
        this.ink[i]=1-(1-this.ink[i])*Math.exp(-k*deposit);
        // A forward impulse and counter-rotating shoulders shed small eddies.
        // Reversal redirects the field; previous momentum continues to advect it.
        const forward=1-across*across*.55, sideways=along*across*.7;
        this.u[i]=Math.max(-80,Math.min(80,this.u[i]+(tx*forward+nx*sideways)*k*force));
        this.v[i]=Math.max(-80,Math.min(80,this.v[i]+(ty*forward+ny*sideways)*k*force));
      }
    }
    this.peak=1;
  }
  private read(f: Float32Array,x: number,y: number) {
    x=Math.max(.5,Math.min(this.width-1.5,x)); y=Math.max(.5,Math.min(this.height-1.5,y));
    const ix=x|0,iy=y|0,fx=x-ix,fy=y-iy,i=iy*this.width+ix;
    return (f[i]*(1-fx)+f[i+1]*fx)*(1-fy)+(f[i+this.width]*(1-fx)+f[i+this.width+1]*fx)*fy;
  }
  sample(x: number,y: number) { return this.read(this.signal,x*(this.width-1),y*(this.height-1)); }
  displacement(x: number, y: number, out: number[]) {
    out[0]=this.read(this.offsetX,x*(this.width-1),y*(this.height-1));
    out[1]=this.read(this.offsetY,x*(this.width-1),y*(this.height-1));
  }
  step(seconds: number) {
    if(!this.active || !Number.isFinite(seconds)) return;
    let remaining=Math.max(0,Math.min(.05,seconds));
    const w=this.width,h=this.height;
    // Integrate every display frame, including 120/144 Hz. Large gaps remain
    // bounded to three 60 Hz substeps; damping is measured in seconds.
    while(remaining>1e-7) {
      const dt=Math.min(1/60,remaining);remaining-=dt;
      const velocityDecay=Math.exp(-1.9*dt),inkDecay=Math.exp(-3.2*dt);
      // Semi-Lagrangian transport: older ink follows the velocity left by a stroke.
      for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++) {
        const i=y*w+x,px=Math.max(.5,Math.min(w-1.5,x-this.u[i]*dt)),py=Math.max(.5,Math.min(h-1.5,y-this.v[i]*dt));
        // All transported channels use the same departure point. Calculate the
        // bilinear weights once instead of repeating bounds/index work three times.
        const ix=px|0,iy=py|0,fx=px-ix,fy=py-iy,j=iy*w+ix;
        const tl=(1-fx)*(1-fy),tr=fx*(1-fy),bl=(1-fx)*fy,br=fx*fy;
        this.a[i]=(this.u[j]*tl+this.u[j+1]*tr+this.u[j+w]*bl+this.u[j+w+1]*br)*velocityDecay;
        this.b[i]=(this.v[j]*tl+this.v[j+1]*tr+this.v[j+w]*bl+this.v[j+w+1]*br)*velocityDecay;
        this.c[i]=(this.ink[j]*tl+this.ink[j+1]*tr+this.ink[j+w]*bl+this.ink[j+w+1]*br)*inkDecay;
      }
      [this.u,this.a]=[this.a,this.u]; [this.v,this.b]=[this.b,this.v]; [this.ink,this.c]=[this.c,this.ink];
      for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++) {
        const i=y*w+x; this.curl[i]=(this.v[i+1]-this.v[i-1]-this.u[i+w]+this.u[i-w])*.5;
      }
      // A little curl keeps the wake alive without shaking the character grid.
      for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++) {
        const i=y*w+x,gx=Math.abs(this.curl[i+1])-Math.abs(this.curl[i-1]),gy=Math.abs(this.curl[i+w])-Math.abs(this.curl[i-w]);
        const length=Math.hypot(gx,gy)+.0001,spin=this.curl[i]*dt*10;
        const speed=Math.hypot(this.u[i],this.v[i]);
        this.u[i]+=gy/length*spin; this.v[i]-=gx/length*spin;
        // Curl redirects momentum, but must not create energy after release.
        const limit=Math.min(1,speed/(Math.hypot(this.u[i],this.v[i])+.000001));
        this.u[i]*=limit;this.v[i]*=limit;
        this.divergence[i]=-.5*(this.u[i+1]-this.u[i-1]+this.v[i+w]-this.v[i-w]);
      }
      this.pressure.fill(0);
      for(let pass=0;pass<4;pass++) {
        for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++) {
          const i=y*w+x; this.pressureNext[i]=(this.divergence[i]+this.pressure[i-1]+this.pressure[i+1]+this.pressure[i-w]+this.pressure[i+w])*.25;
        }
        [this.pressure,this.pressureNext]=[this.pressureNext,this.pressure];
      }
      let peak=0;
      for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++) {
        const i=y*w+x;
        this.u[i]=Math.max(-80,Math.min(80,this.u[i]-(this.pressure[i+1]-this.pressure[i-1])*.5));
        this.v[i]=Math.max(-80,Math.min(80,this.v[i]-(this.pressure[i+w]-this.pressure[i-w])*.5));
        // Fluid velocity pushes a damped spring; source sampling coasts and returns
        // rather than snapping to pointer coordinates or accumulating drift.
        this.driftX[i]+=(this.u[i]*3.6-58*this.offsetX[i]-12*this.driftX[i])*dt;
        this.driftY[i]+=(this.v[i]*3.6-58*this.offsetY[i]-12*this.driftY[i])*dt;
        this.offsetX[i]=Math.max(-2,Math.min(2,this.offsetX[i]+this.driftX[i]*dt));
        this.offsetY[i]=Math.max(-2,Math.min(2,this.offsetY[i]+this.driftY[i]*dt));
        // Visible response follows local kinetic energy, not just deposited ink.
        // Fast strokes clear a wider channel; the advected velocity rolls on
        // after reversal while a small ink contribution carries the fine tail.
        this.signal[i]=1-Math.exp(-Math.hypot(this.u[i],this.v[i])*.06-this.ink[i]*.16);
        peak=Math.max(peak,this.signal[i]);
      }
      this.peak=peak;
    }
    if(!this.active) { this.clear(); return; }
    for(let i=0;i<this.ink.length;i++) {
      const value=Math.round(Math.min(1,this.signal[i])*65535);
      this.pixels[i*4]=value>>>8; this.pixels[i*4+1]=value&255;
      this.pixels[i*4+2]=Math.round(128+this.offsetX[i]*63.5);
      this.pixels[i*4+3]=Math.round(128+this.offsetY[i]*63.5);
    }
  }
}

export const isDensityHover = (mode: string) => ['trail','contour','dissolve'].includes(mode);

/** Bounded reversal: sparse marks fill in, dense marks open up along the wake. */
export function invertTrailTone(tone: number, density: number) {
  const t = Math.max(0, Math.min(1, density / .38));
  const blend = t * t * (3 - 2 * t);
  return tone + (1 - 2 * tone) * blend;
}

/** Continuous tonal fold: bright regions open up, dark regions gain detail.
 * The ink stays opaque; it is the selected glyph that changes. */
export function flowTrailIndex(index: number, count: number, density: number) {
  const last = Math.max(0, count - 1);
  const response = 1 - Math.exp(-Math.max(0, density) * 3.5);
  return Math.max(0, last - Math.abs(last - (index + response * last * 2.1)));
}

/** Sample cached source cells through a flow; never move the destination grid.
 * Output: fractional glyph index, source tone, then RGBA. No per-cell allocation. */
export function sampleFlowGlyph(
  indices: Uint8Array, colors: Uint8ClampedArray, cols: number, rows: number,
  x: number, y: number, density: number, driftX: number, driftY: number, count: number, out: number[], edgeSafe = false,
) {
  const edge = Math.min(x, y, cols - 1 - x, rows - 1 - y);
  const t = Math.max(0, Math.min(1, (edge - 1) / 4)), pin = edgeSafe ? t * t * (3 - 2 * t) : 1;
  density *= pin;
  const response = 1 - Math.exp(-Math.max(0, density) * 3.5);
  const sx = Math.max(0, Math.min(cols - 1, x - driftX * response * .026 * cols * pin));
  const sy = Math.max(0, Math.min(rows - 1, y - driftY * response * .026 * rows * pin));
  const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
  out.fill(0);
  for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) {
    const i = (Math.min(rows - 1, iy + yy) * cols + Math.min(cols - 1, ix + xx)) * 4;
    const weight = (xx ? fx : 1 - fx) * (yy ? fy : 1 - fy);
    out[0] += (indices[i] + indices[i + 1] * 256) * weight;
    out[1] += indices[i + 2] / 255 * weight;
    for (let c = 0; c < 4; c++) out[c + 2] += colors[i + c] * weight;
  }
  const phase = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  const grain = phase - Math.floor(phase);
  out[0] = Math.max(0, flowTrailIndex(out[0], count, density) - response * (1-response) * grain * 3);
}

/** Shared fixed-grid source transport and character-density mapping. */
export const INK_TRAIL_GLSL = `
uniform float edgeSafe;
uniform float trailAmount;
uniform float trailKind;
vec4 trailField(vec2 address) {
  return texture2D(surface,(address*(surfaceSize-1.0)+.5)/surfaceSize);
}
float trailFieldDensity(vec4 field) {
  return (field.r*65280.0+field.g*255.0)/65535.0*trailAmount;
}
float trailDensity(vec2 address) { return trailFieldDensity(trailField(address)); }
float trailPin(vec2 cell, vec2 grid) {
  vec2 edge=min(cell,grid-1.0-cell);
  return mix(1.,smoothstep(1.0,5.0,min(edge.x,edge.y)),edgeSafe);
}
vec2 trailSource(vec2 cell, vec2 grid, vec4 field) {
  vec2 home=(cell+.5)/grid;
  if(trailKind>.5 || trailAmount<=0.) return home;
  float pin=trailPin(cell,grid);
  float response=1.-exp(-trailFieldDensity(field)*pin*3.5);
  vec2 drift=(field.ba*255.-128.)/127.;
  return clamp(home-drift*response*.026*pin,.5/grid,1.-.5/grid);
}
vec2 decodedGlyph(vec4 code) {
  return vec2(floor(code.r*255.+.5)+floor(code.g*255.+.5)*256.,code.b);
}
// Bilinear interpolation happens before glyph selection, never between bitmap
// letters. Four small metadata reads replace the old four full-glyph gathers.
vec2 flowGlyph(sampler2D codes,vec2 uv,vec2 grid) {
  vec2 p=uv*grid-.5,b=floor(p),f=fract(p);
  return mix(mix(decodedGlyph(texture2D(codes,(b+.5)/grid)),decodedGlyph(texture2D(codes,(b+vec2(1.5,.5))/grid)),f.x),
    mix(decodedGlyph(texture2D(codes,(b+vec2(.5,1.5))/grid)),decodedGlyph(texture2D(codes,(b+1.5)/grid)),f.x),f.y);
}
vec3 trailInk(vec3 ink, float density) {
  if (trailKind < .5) return ink;
  float peak=max(ink.r,max(ink.g,ink.b));
  float raised=trailKind>1.5?peak:max(peak,min(.44,density*.75));
  return peak>.001 ? ink*(raised/peak) : vec3(raised);
}
float flowIndex(float index,float count,float density) {
  float last=max(0.,count-1.);
  float response=1.-exp(-max(0.,density)*3.5);
  return max(0.,last-abs(last-(index+response*last*2.1)));
}
float trailTone(float tone, float density) {
  if (trailKind < .5) return flowIndex(tone,2.,density);
  return clamp(tone + (trailKind > 1.5 ? -density : density) * .65, 0.0, 1.0);
}
float trailIndex(float index, float count, float density, vec2 cell) {
  float grain=fract((cell.x*cell.x*17.0+cell.y*cell.y*23.0+cell.x*cell.y*19.0)*.0137);
  if(trailKind>1.5) return max(0.0,index-floor(density*count*(1.35+grain*.9)));
  if(trailKind<.5) {
    float seed=fract(sin(dot(cell,vec2(127.1,311.7)))*43758.5453);
    float response=1.-exp(-max(0.,density)*3.5);
    return floor(max(0.,flowIndex(index,count,density)-response*(1.-response)*seed*3.)+.5);
  }
  return min(count-1.0,index+floor(density*count*.85));
}
`;
