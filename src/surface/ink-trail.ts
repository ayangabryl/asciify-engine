/** A bounded, advected ink field. Independent of image resolution and glyph count. */
export class InkTrail {
  readonly pixels: Uint8Array;
  private u: Float32Array; private v: Float32Array; private ink: Float32Array;
  private a: Float32Array; private b: Float32Array; private c: Float32Array;
  private pressure: Float32Array; private pressureNext: Float32Array;
  private divergence: Float32Array; private curl: Float32Array;
  private previous: {x: number; y: number} | null = null;
  private remainder = 0;
  private peak = 0;
  readonly width: number; readonly height: number;
  constructor(width: number, height: number) {
    this.width=width; this.height=height;
    const n = width * height;
    this.pixels = new Uint8Array(n * 4);
    this.u=new Float32Array(n); this.v=new Float32Array(n); this.ink=new Float32Array(n);
    this.a=new Float32Array(n); this.b=new Float32Array(n); this.c=new Float32Array(n);
    this.pressure=new Float32Array(n); this.pressureNext=new Float32Array(n);
    this.divergence=new Float32Array(n); this.curl=new Float32Array(n);
  }
  get active() { return this.peak > .0002; }
  clear() {
    for (const f of [this.u,this.v,this.ink,this.a,this.b,this.c,this.pressure,this.pressureNext,this.divergence,this.curl,this.pixels]) f.fill(0);
    this.previous=null; this.peak=0; this.remainder=0;
  }
  leave() { this.previous=null; }
  move(x: number,y: number,radius: number) {
    const old=this.previous; this.previous={x,y}; if(!old) return;
    const dx=(x-old.x)*(this.width-1),dy=(y-old.y)*(this.height-1),travel=Math.hypot(dx,dy);
    if(travel<.001) return;
    const r=Math.min(this.width,this.height)*(.038+radius*.12);
    const count=Math.min(128,Math.max(1,Math.ceil(travel/(r*.5))));
    const deposit=travel/r*.95/count;
    for(let s=0;s<count;s++) {
      const t=(s+.5)/count,cx=(old.x+(x-old.x)*t)*(this.width-1),cy=(old.y+(y-old.y)*t)*(this.height-1);
      const left=Math.max(1,Math.floor(cx-r*2.5)),right=Math.min(this.width-2,Math.ceil(cx+r*2.5));
      const top=Math.max(1,Math.floor(cy-r*2.5)),bottom=Math.min(this.height-2,Math.ceil(cy+r*2.5));
      for(let gy=top;gy<=bottom;gy++) for(let gx=left;gx<=right;gx++) {
        const k=Math.exp(-((gx-cx)**2+(gy-cy)**2)/(r*r)),i=gy*this.width+gx;
        this.ink[i]=Math.min(1,this.ink[i]+k*deposit);
        this.u[i]=Math.max(-50,Math.min(50,this.u[i]+dx*k*5/count));
        this.v[i]=Math.max(-50,Math.min(50,this.v[i]+dy*k*5/count));
      }
    }
    this.peak=1;
  }
  private read(f: Float32Array,x: number,y: number) {
    x=Math.max(.5,Math.min(this.width-1.5,x)); y=Math.max(.5,Math.min(this.height-1.5,y));
    const ix=x|0,iy=y|0,fx=x-ix,fy=y-iy,i=iy*this.width+ix;
    return (f[i]*(1-fx)+f[i+1]*fx)*(1-fy)+(f[i+this.width]*(1-fx)+f[i+this.width+1]*fx)*fy;
  }
  sample(x: number,y: number) { return this.read(this.ink,x*(this.width-1),y*(this.height-1)); }
  step(seconds: number) {
    if(!this.active || !Number.isFinite(seconds)) return;
    this.remainder+=Math.max(0,Math.min(.05,seconds));
    const dt=1/60,w=this.width,h=this.height;
    while(this.remainder+1e-8>=dt) {
      this.remainder-=dt;
      // Semi-Lagrangian transport: older ink follows the velocity left by a stroke.
      for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++) {
        const i=y*w+x,px=x-this.u[i]*dt,py=y-this.v[i]*dt;
        this.a[i]=this.read(this.u,px,py)*.972; this.b[i]=this.read(this.v,px,py)*.972;
        this.c[i]=this.read(this.ink,px,py)*.964;
      }
      [this.u,this.a]=[this.a,this.u]; [this.v,this.b]=[this.b,this.v]; [this.ink,this.c]=[this.c,this.ink];
      for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++) {
        const i=y*w+x; this.curl[i]=(this.v[i+1]-this.v[i-1]-this.u[i+w]+this.u[i-w])*.5;
      }
      // A little curl keeps the wake alive without shaking the character grid.
      for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++) {
        const i=y*w+x,gx=Math.abs(this.curl[i+1])-Math.abs(this.curl[i-1]),gy=Math.abs(this.curl[i+w])-Math.abs(this.curl[i-w]);
        const length=Math.hypot(gx,gy)+.0001,spin=this.curl[i]*dt*5;
        this.u[i]+=gy/length*spin; this.v[i]-=gx/length*spin;
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
        this.u[i]=Math.max(-50,Math.min(50,this.u[i]-(this.pressure[i+1]-this.pressure[i-1])*.5));
        this.v[i]=Math.max(-50,Math.min(50,this.v[i]-(this.pressure[i+w]-this.pressure[i-w])*.5));
        peak=Math.max(peak,this.ink[i]);
      }
      this.peak=peak;
    }
    if(!this.active) { this.clear(); return; }
    for(let i=0;i<this.ink.length;i++) {
      const value=Math.round(Math.min(1,this.ink[i])*65535);
      this.pixels[i*4]=value>>>8; this.pixels[i*4+1]=value&255;
    }
  }
}

export const isDensityHover = (mode: string) => ['trail','contour','dissolve'].includes(mode);

/** Identical tonal response in hero and playground; glyph positions never move. */
export const INK_TRAIL_GLSL = `
uniform float trailAmount;
uniform float trailKind;
float trailDensity(vec2 address) {
  vec2 encodedInk = texture2D(surface, (address * (surfaceSize - 1.0) + .5) / surfaceSize).rg;
  return (encodedInk.r * 65280.0 + encodedInk.g * 255.0) / 65535.0 * trailAmount;
}
vec3 trailInk(vec3 ink, float density) {
  float peak=max(ink.r,max(ink.g,ink.b));
  float raised=trailKind>1.5?peak:max(peak,min(.44,density*.75));
  return peak>.001 ? ink*(raised/peak) : vec3(raised);
}
float trailIndex(float index, float count, float density, vec2 cell) {
  // A stable cell pattern gives Dissolve a granular edge without random flicker.
  float grain=fract((cell.x*cell.x*17.0+cell.y*cell.y*23.0+cell.x*cell.y*19.0)*.0137);
  if(trailKind>1.5) return max(0.0,index-floor(density*count*(1.35+grain*.9)));
  return min(count - 1.0, index + floor(density * count * .85));
}
`;
