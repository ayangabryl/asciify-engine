import { surfaceEdgeWeight } from './surface-edge';

export type AfterimageMode = 'dissolve' | 'silk' | 'vortex' | 'magnetic' | 'scatter' | 'etch' | 'elastic' | 'rake';
export const isAfterimageMode = (mode: string): mode is AfterimageMode =>
  ['dissolve', 'silk', 'vortex', 'magnetic', 'scatter', 'etch', 'elastic', 'rake'].includes(mode);

/** A decaying stroke memory, not fluid advection. Fixed storage at every image size. */
export class AfterimageField {
  edgeSafe = false;
  readonly width:number; readonly height:number; readonly pixels:Uint8Array;
  private ink:Float32Array; private targetX:Float32Array; private targetY:Float32Array;
  private offsetX:Float32Array; private offsetY:Float32Array; private edge:Float32Array;
  private previous:{x:number;y:number}|null=null;
  private peak=0;
  private scatterDirections:Float64Array|null=null;
  private springX:Float32Array|null=null;
  private springY:Float32Array|null=null;
  private mode:AfterimageMode='dissolve';
  constructor(width:number,height:number) {
    this.width=width;this.height=height;const n=width*height;
    this.pixels=new Uint8Array(n*4);this.ink=new Float32Array(n);
    this.targetX=new Float32Array(n);this.targetY=new Float32Array(n);
    this.offsetX=new Float32Array(n);this.offsetY=new Float32Array(n);this.edge=new Float32Array(n);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)this.edge[y*width+x]=surfaceEdgeWeight(x/(width-1),y/(height-1),width/height);
    this.clear();
  }
  get active(){return this.peak>.0002;}
  setMode(mode:AfterimageMode){
    if(mode==='elastic'&&!this.springX){
      this.springX=new Float32Array(this.ink.length);this.springY=new Float32Array(this.ink.length);
    }
    if(mode==='scatter'&&!this.scatterDirections){
      // Spatial noise belongs to the field, not the pointer event. Compute it
      // once; rapid movement then only combines existing directions.
      const directions=this.scatterDirections=new Float64Array(this.width*this.height*2);
      for(let gy=0;gy<this.height;gy++)for(let gx=0;gx<this.width;gx++){
        const grain=Math.sin(gx*127.1+gy*311.7)*43758.5453;
        const angle=(grain-Math.floor(grain))*Math.PI*2, i=(gy*this.width+gx)*2;
        directions[i]=Math.cos(angle)*.7;directions[i+1]=Math.sin(angle)*.7;
      }
    }
    if(mode!==this.mode){this.mode=mode;this.clear();}
  }
  clear(){
    for(const a of [this.ink,this.targetX,this.targetY,this.offsetX,this.offsetY,this.pixels])a.fill(0);
    this.previous=null;this.peak=0;
    this.springX?.fill(0);this.springY?.fill(0);
    if(this.mode!=='dissolve')for(let i=0;i<this.pixels.length;i+=4)this.pixels[i]=this.pixels[i+2]=128;
  }
  leave(){this.previous=null;}
  move(x:number,y:number,radius:number){
    if(!Number.isFinite(x+y+radius))return;
    x=Math.max(0,Math.min(1,x));y=Math.max(0,Math.min(1,y));
    const previous=this.previous;this.previous={x,y};
    const w=this.width,h=this.height,sx=Math.max(1,w/h),sy=Math.max(1,h/w);
    const dx=previous?(x-previous.x)*sx:0,dy=previous?(y-previous.y)*sy:0,travel=Math.hypot(dx,dy);
    if(!previous && this.mode!=='dissolve' && this.mode!=='etch')return;
    if(previous && travel<.0001)return;
    const r=.035+Math.max(.1,Math.min(1,radius))*.11;
    const count=Math.min(128,Math.max(1,Math.ceil(travel/(r*.45))));
    const tx=travel?dx/travel:1,ty=travel?dy/travel:0;
    const gain=Math.min(1,travel/(r*count)*2.2);
    for(let s=0;s<count;s++){
      const t=(s+.5)/count,cx=previous?previous.x+(x-previous.x)*t:x,cy=previous?previous.y+(y-previous.y)*t:y;
      const left=Math.max(0,Math.floor((cx-r*2.5/sx)*(w-1))),right=Math.min(w-1,Math.ceil((cx+r*2.5/sx)*(w-1)));
      const top=Math.max(0,Math.floor((cy-r*2.5/sy)*(h-1))),bottom=Math.min(h-1,Math.ceil((cy+r*2.5/sy)*(h-1)));
      for(let gy=top;gy<=bottom;gy++)for(let gx=left;gx<=right;gx++){
        const rx=(gx/(w-1)-cx)*sx/r,ry=(gy/(h-1)-cy)*sy/r,k=Math.exp(-(rx*rx+ry*ry)*1.5),i=gy*w+gx;
        if(this.mode==='dissolve'||this.mode==='etch')this.ink[i]=Math.max(this.ink[i],k);
        else if(this.mode==='elastic'){
          // Momentum is stored separately from displacement. Reversals add to
          // the existing velocity, and the spring can overshoot its rest point.
          this.springX![i]=Math.max(-24,Math.min(24,this.springX![i]+tx*k*gain*8));
          this.springY![i]=Math.max(-24,Math.min(24,this.springY![i]+ty*k*gain*8));
        }
        else {
          // Silk shears opposite sides of a stroke; Vortex turns around it.
          const fold=(-rx*ty+ry*tx)*k*2.8;
          const fx=this.mode==='rake'?tx*Math.sin(gy*Math.PI/3)*k*2:this.mode==='magnetic'?-rx*k*2.5:this.mode==='scatter'?(rx+this.scatterDirections![i*2])*k*2:this.mode==='silk'?tx*fold:-ry*k*2.5;
          const fy=this.mode==='rake'?ty*Math.sin(gx*Math.PI/3)*k*2:this.mode==='magnetic'?-ry*k*2.5:this.mode==='scatter'?(ry+this.scatterDirections![i*2+1])*k*2:this.mode==='silk'?ty*fold:rx*k*2.5;
          this.targetX[i]=Math.max(-1,Math.min(1,this.targetX[i]+fx*gain));
          this.targetY[i]=Math.max(-1,Math.min(1,this.targetY[i]+fy*gain));
        }
      }
    }
    this.peak=1;
  }
  step(seconds:number){
    if(!this.active||!Number.isFinite(seconds))return;
    const dt=Math.max(0,Math.min(.05,seconds)),decay=Math.exp(-(this.mode==='dissolve'?2.15:3.2)*dt),follow=1-Math.exp(-22*dt);
    let peak=0;
    // Exact damped spring integration, independent of frame subdivision.
    const damping=8,omega=Math.sqrt(400-damping*damping),attenuation=Math.exp(-damping*dt);
    const cosine=Math.cos(omega*dt),sine=Math.sin(omega*dt)/omega;
    for(let i=0;i<this.ink.length;i++){
      if(this.mode==='etch'){
        this.ink[i]*=decay;peak=Math.max(peak,this.ink[i]);
      } else if(this.mode==='dissolve'){
        this.ink[i]*=decay;peak=Math.max(peak,this.ink[i]);const v=Math.round(this.ink[i]*65535);
        this.pixels[i*4]=v>>>8;this.pixels[i*4+1]=v&255;
      } else {
        if(this.mode==='elastic'){
          const x=this.offsetX[i],y=this.offsetY[i],vx=this.springX![i],vy=this.springY![i];
          this.offsetX[i]=Math.max(-1,Math.min(1,attenuation*(x*cosine+(vx+damping*x)*sine)));
          this.offsetY[i]=Math.max(-1,Math.min(1,attenuation*(y*cosine+(vy+damping*y)*sine)));
          this.springX![i]=attenuation*(vx*cosine-(damping*vx+400*x)*sine);
          this.springY![i]=attenuation*(vy*cosine-(damping*vy+400*y)*sine);
          peak=Math.max(peak,Math.abs(this.springX![i])*.05,Math.abs(this.springY![i])*.05);
        }else{
          this.targetX[i]*=decay;this.targetY[i]*=decay;
          this.offsetX[i]+=(this.targetX[i]-this.offsetX[i])*follow;this.offsetY[i]+=(this.targetY[i]-this.offsetY[i])*follow;
        }
        peak=Math.max(peak,Math.abs(this.offsetX[i]),Math.abs(this.offsetY[i]),Math.abs(this.targetX[i]),Math.abs(this.targetY[i]));
        const x=Math.round(this.offsetX[i]*(this.edgeSafe?this.edge[i]:1)*32767+32768),y=Math.round(this.offsetY[i]*(this.edgeSafe?this.edge[i]:1)*32767+32768);
        this.pixels[i*4]=x>>>8;this.pixels[i*4+1]=x&255;this.pixels[i*4+2]=y>>>8;this.pixels[i*4+3]=y&255;
      }
    }
    if(this.mode==='etch')for(let y=0;y<this.height;y++)for(let x=0;x<this.width;x++){
      const i=y*this.width+x;
      const slope=(this.ink[y*this.width+Math.max(0,x-1)]-this.ink[y*this.width+Math.min(this.width-1,x+1)]
        +this.ink[Math.max(0,y-1)*this.width+x]-this.ink[Math.min(this.height-1,y+1)*this.width+x])*3;
      this.offsetX[i]=Math.max(-1,Math.min(1,slope))*(this.edgeSafe?this.edge[i]:1);
      const value=Math.round(this.offsetX[i]*32767+32768);
      this.pixels[i*4]=value>>>8;this.pixels[i*4+1]=value&255;
    }
    this.peak=peak;if(!this.active)this.clear();
  }
  sample(x:number,y:number,out:number[]){
    const gx=Math.max(0,Math.min(this.width-1.001,x*(this.width-1))),gy=Math.max(0,Math.min(this.height-1.001,y*(this.height-1)));
    const ix=Math.floor(gx),iy=Math.floor(gy),fx=gx-ix,fy=gy-iy,a=iy*this.width+ix,b=a+this.width;
    const read=(v:Float32Array)=>(v[a]*(1-fx)+v[a+1]*fx)*(1-fy)+(v[b]*(1-fx)+v[b+1]*fx)*fy;
    if(this.mode==='etch'){out[0]=out[1]=0;out[2]=read(this.offsetX)*3;return;}
    out[0]=read(this.offsetX)*(this.edgeSafe?surfaceEdgeWeight(x,y,this.width/this.height):1)*.08;
    out[1]=read(this.offsetY)*(this.edgeSafe?surfaceEdgeWeight(x,y,this.width/this.height):1)*.08;
    out[2]=this.mode==='dissolve'?-read(this.ink)*6:0;
  }
}
