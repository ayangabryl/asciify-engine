/** Four bounded, expanding density rings. No geometry displacement or growing event list. */
export class ContourField {
  readonly pixels: Uint8Array;
  private rings: {x:number;y:number;age:number;radius:number}[]=[];
  private previous: {x:number;y:number}|null=null;
  private elapsed=1;
  private echo:Float32Array;private echoPeak=0;
  readonly width:number; readonly height:number;
  constructor(width:number,height:number) { this.width=width;this.height=height;this.pixels=new Uint8Array(width*height*4);this.echo=new Float32Array(width*height); }
  get active() { return this.rings.length>0||this.echoPeak>.0002; }
  clear() { this.rings=[];this.previous=null;this.elapsed=1;this.pixels.fill(0);this.echo.fill(0);this.echoPeak=0; }
  leave() { this.previous=null; }
  move(x:number,y:number,radius:number) {
    const sx=Math.max(1,this.width/this.height),sy=Math.max(1,this.height/this.width);
    if(this.previous && (Math.hypot((x-this.previous.x)*sx,(y-this.previous.y)*sy)<.065 || this.elapsed<.3)) return;
    // Let visible rings finish rather than popping the oldest under fast input.
    if(this.rings.length===4)return;
    this.previous={x,y};this.elapsed=0;
    this.rings.push({x,y,age:0,radius});
  }
  private ringSample(x:number,y:number) {
    const sx=Math.max(1,this.width/this.height),sy=Math.max(1,this.height/this.width);
    let value=0;
    for(const r of this.rings) {
      const spread=.015+r.age*(.15+r.radius*.22),width=.009+r.radius*.014;
      const d=(Math.hypot((x-r.x)*sx,(y-r.y)*sy)-spread)/width;
      const envelope=Math.sin(Math.min(1,r.age/.07)*Math.PI/2)*Math.max(0,1-r.age/1.35)**2;
      value=Math.max(value,Math.exp(-d*d)*envelope);
    }
    return value;
  }
  sample(x:number,y:number) {
    const gx=Math.max(0,Math.min(this.width-1,Math.round(x*(this.width-1)))),gy=Math.max(0,Math.min(this.height-1,Math.round(y*(this.height-1))));
    return Math.max(this.ringSample(x,y),this.echo[gy*this.width+gx]);
  }
  step(seconds:number) {
    if(!Number.isFinite(seconds))return;
    const dt=Math.max(0,Math.min(.05,seconds));this.elapsed+=dt;
    for(const r of this.rings)r.age+=dt;
    this.rings=this.rings.filter(r=>r.age<1.35);
    if(!this.active){this.pixels.fill(0);return;}
    const decay=Math.exp(-5.5*dt);let peak=0;
    for(let y=0;y<this.height;y++)for(let x=0;x<this.width;x++) {
      const cell=y*this.width+x;this.echo[cell]=Math.max(this.ringSample(x/(this.width-1),y/(this.height-1)),this.echo[cell]*decay);peak=Math.max(peak,this.echo[cell]);
      const value=Math.round(this.echo[cell]*65535),i=cell*4;
      this.pixels[i]=value>>>8;this.pixels[i+1]=value&255;
    }
    this.echoPeak=peak;if(!this.active){this.echo.fill(0);this.pixels.fill(0);}
  }
}
