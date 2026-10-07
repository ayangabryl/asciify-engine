import { surfaceEdgeWeight } from './surface-edge';

/** Eight bounded wave packets. Tonal waves never move the character grid. */
export class RippleField {
  edgeSafe = false;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  private readonly values: Float32Array;
  // x, y, age, amplitude, radius; reused rather than allocating per event.
  private readonly rings = new Float64Array(8 * 5);
  private slot = 0;
  private clock = 0;
  private lastRing = -1;
  private previous: { x: number; y: number; time: number } | null = null;
  private alive = false;
  constructor(width: number, height: number) {
    this.width=width;this.height=height;
    this.pixels = new Uint8Array(width * height * 4);
    this.values = new Float32Array(width * height);
    this.clear();
  }
  get active() { return this.alive; }
  clear() {
    this.rings.fill(0); this.values.fill(0); this.pixels.fill(0);
    for(let i=0;i<this.pixels.length;i+=4)this.pixels[i]=128;
    this.previous=null;this.alive=false;this.slot=0;this.lastRing=-1;this.clock=0;
  }
  leave() { this.previous = null; }
  move(x: number, y: number, radius: number, milliseconds?: number) {
    if(!Number.isFinite(x+y+radius))return;
    x=Math.max(0,Math.min(1,x));y=Math.max(0,Math.min(1,y));
    const time=Number.isFinite(milliseconds)?milliseconds!/1000:this.clock;
    const previous=this.previous;this.previous={x,y,time};
    if(!previous)return;
    const aspect=this.width/this.height;
    const distance=Math.hypot((x-previous.x)*Math.max(1,aspect),(y-previous.y)*Math.max(1,1/aspect));
    if(distance<.0001 || this.clock-this.lastRing<1/24)return;
    const speed=distance/Math.max(1/240,Math.min(.1,time-previous.time||1/60));
    const i=this.slot*5;this.slot=(this.slot+1)%8;
    this.rings[i]=x;this.rings[i+1]=y;this.rings[i+2]=0;
    this.rings[i+3]=Math.min(.82,.14+speed*.16);
    this.rings[i+4]=.035+Math.max(.1,Math.min(1,radius))*.13;
    this.alive=true;this.lastRing=this.clock;
  }
  step(seconds: number) {
    if(!Number.isFinite(seconds)||seconds<=0)return;
    const dt=Math.min(.05,seconds);this.clock+=dt;
    if(!this.alive)return;
    this.values.fill(0);this.alive=false;
    const aspect=this.width/this.height,sx=Math.max(1,aspect),sy=Math.max(1,1/aspect);
    for(let i=0;i<this.rings.length;i+=5){
      if(!this.rings[i+3])continue;
      const age=this.rings[i+2]+=dt;
      if(age>2.8){this.rings[i+3]=0;continue;}
      this.alive=true;
      const width=this.rings[i+4],front=age*.17;
      const amplitude=this.rings[i+3]*(1-Math.exp(-age*20))*Math.exp(-age*2.5);
      const reach=front+width*1.8,cx=this.rings[i],cy=this.rings[i+1];
      const left=Math.max(0,Math.floor((cx-reach/sx)*(this.width-1)));
      const right=Math.min(this.width-1,Math.ceil((cx+reach/sx)*(this.width-1)));
      const top=Math.max(0,Math.floor((cy-reach/sy)*(this.height-1)));
      const bottom=Math.min(this.height-1,Math.ceil((cy+reach/sy)*(this.height-1)));
      for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
        const d=Math.hypot((x/(this.width-1)-cx)*sx,(y/(this.height-1)-cy)*sy);
        const q=(d-front)/width;
        if(Math.abs(q)>1.8)continue;
        this.values[y*this.width+x]+=amplitude*Math.cos(q*Math.PI*2)*Math.exp(-q*q*2.5);
      }
    }
    for(let y=0;y<this.height;y++)for(let x=0;x<this.width;x++){
      const i=y*this.width+x;
      const v=this.values[i]=Math.max(-1,Math.min(1,this.values[i]))*(this.edgeSafe?surfaceEdgeWeight(x/(this.width-1),y/(this.height-1),aspect):1);
      const packed=Math.round(v*32767+32768);this.pixels[i*4]=packed>>>8;this.pixels[i*4+1]=packed&255;
    }
  }
  sample(x: number, y: number, out: number[]) {
    const gx=Math.max(0,Math.min(this.width-1.001,x*(this.width-1))),gy=Math.max(0,Math.min(this.height-1.001,y*(this.height-1)));
    const ix=Math.floor(gx),iy=Math.floor(gy),fx=gx-ix,fy=gy-iy,a=iy*this.width+ix,b=a+this.width;
    out[0]=out[1]=0;
    out[2]=((this.values[a]*(1-fx)+this.values[a+1]*fx)*(1-fy)+(this.values[b]*(1-fx)+this.values[b+1]*fx)*fy)*3;
  }
}
