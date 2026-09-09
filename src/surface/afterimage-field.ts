import { surfaceEdgeWeight } from './surface-edge';

export type AfterimageMode = 'dissolve' | 'silk' | 'vortex';

/** A decaying stroke memory, not fluid advection. Fixed storage at every image size. */
export class AfterimageField {
  edgeSafe = false;
  readonly width:number; readonly height:number; readonly pixels:Uint8Array;
  private ink:Float32Array; private targetX:Float32Array; private targetY:Float32Array;
  private offsetX:Float32Array; private offsetY:Float32Array; private edge:Float32Array;
  private previous:{x:number;y:number}|null=null;
  private peak=0;
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
  setMode(mode:AfterimageMode){if(mode!==this.mode){this.mode=mode;this.clear();}}
  clear(){
    for(const a of [this.ink,this.targetX,this.targetY,this.offsetX,this.offsetY,this.pixels])a.fill(0);
    this.previous=null;this.peak=0;
    if(this.mode!=='dissolve')for(let i=0;i<this.pixels.length;i+=4)this.pixels[i]=this.pixels[i+2]=128;
  }
  leave(){this.previous=null;}
  move(x:number,y:number,radius:number){
    if(!Number.isFinite(x+y+radius))return;
    x=Math.max(0,Math.min(1,x));y=Math.max(0,Math.min(1,y));
    const previous=this.previous;this.previous={x,y};
    const w=this.width,h=this.height,sx=Math.max(1,w/h),sy=Math.max(1,h/w);
    const dx=previous?(x-previous.x)*sx:0,dy=previous?(y-previous.y)*sy:0,travel=Math.hypot(dx,dy);
    if(!previous && this.mode!=='dissolve')return;
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
        if(this.mode==='dissolve')this.ink[i]=Math.max(this.ink[i],k);
        else {
          // Silk shears opposite sides of a stroke; Vortex turns around it.
          const fold=(-rx*ty+ry*tx)*k*2.8;
          const fx=this.mode==='silk'?tx*fold:-ry*k*2.5;
          const fy=this.mode==='silk'?ty*fold:rx*k*2.5;
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
    for(let i=0;i<this.ink.length;i++){
      if(this.mode==='dissolve'){
        this.ink[i]*=decay;peak=Math.max(peak,this.ink[i]);const v=Math.round(this.ink[i]*65535);
        this.pixels[i*4]=v>>>8;this.pixels[i*4+1]=v&255;
      } else {
        this.targetX[i]*=decay;this.targetY[i]*=decay;
        this.offsetX[i]+=(this.targetX[i]-this.offsetX[i])*follow;this.offsetY[i]+=(this.targetY[i]-this.offsetY[i])*follow;
        peak=Math.max(peak,Math.abs(this.offsetX[i]),Math.abs(this.offsetY[i]),Math.abs(this.targetX[i]),Math.abs(this.targetY[i]));
        const x=Math.round(this.offsetX[i]*(this.edgeSafe?this.edge[i]:1)*32767+32768),y=Math.round(this.offsetY[i]*(this.edgeSafe?this.edge[i]:1)*32767+32768);
        this.pixels[i*4]=x>>>8;this.pixels[i*4+1]=x&255;this.pixels[i*4+2]=y>>>8;this.pixels[i*4+3]=y&255;
      }
    }
    this.peak=peak;if(!this.active)this.clear();
  }
  sample(x:number,y:number,out:number[]){
    const gx=Math.max(0,Math.min(this.width-1.001,x*(this.width-1))),gy=Math.max(0,Math.min(this.height-1.001,y*(this.height-1)));
    const ix=Math.floor(gx),iy=Math.floor(gy),fx=gx-ix,fy=gy-iy,a=iy*this.width+ix,b=a+this.width;
    const read=(v:Float32Array)=>(v[a]*(1-fx)+v[a+1]*fx)*(1-fy)+(v[b]*(1-fx)+v[b+1]*fx)*fy;
    out[0]=read(this.offsetX)*(this.edgeSafe?surfaceEdgeWeight(x,y,this.width/this.height):1)*.08;
    out[1]=read(this.offsetY)*(this.edgeSafe?surfaceEdgeWeight(x,y,this.width/this.height):1)*.08;
    out[2]=this.mode==='dissolve'?-read(this.ink)*6:0;
  }
}
