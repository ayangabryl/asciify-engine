import { samplePixel, samplePixelTransparent } from './sample-pixel';

/** Source transformations, applied in list order before style conversion. */
export const STUDIO_WARPS = [
  {value:'twirl',label:'Twirl',description:'Rotate the center into a smooth spiral; the outer boundary stays fixed.',direction:false,frequency:false},
  {value:'pinch',label:'Pinch',description:'Contract the center, or expand it with negative strength.',direction:false,frequency:false},
  {value:'sphere',label:'Spherize',description:'Magnify a rounded lens through the source; negative strength recedes.',direction:false,frequency:false},
  {value:'ripple',label:'Ripple',description:'Bend the image through concentric, soft-edged waves.',direction:false,frequency:true},
  {value:'zigzag',label:'Zigzag',description:'Alternate the twist in sharp, concentric bands.',direction:false,frequency:true},
  {value:'shear',label:'Shear',description:'Slant a region along an adjustable direction.',direction:true,frequency:false},
  {value:'smudge',label:'Smudge',description:'Draw a soft region of the source along one direction.',direction:true,frequency:false},
  {value:'polar',label:'Polar',description:'Unwrap a region into polar coordinates; negative strength wraps it.',direction:true,frequency:false},
  {value:'fragment',label:'Fragment',description:'Offset small source tiles into a stable fractured texture.',direction:true,frequency:true},
] as const;
export type StudioWarpType = typeof STUDIO_WARPS[number]['value'];
export interface StudioWarp {
  type: StudioWarpType;
  enabled?: boolean;
  amount?: number;
  x?: number;
  y?: number;
  /** Radius as a fraction of the canvas's shorter side. */
  radius?: number;
  angle?: number;
  frequency?: number;
}
export type StudioWarpEdge = 'clamp' | 'transparent';
export const MAX_STUDIO_WARPS = 8;
const finite = (v:unknown,f:number,low:number,high:number) =>
  typeof v==='number' && Number.isFinite(v) ? Math.max(low,Math.min(high,v)) : f;

/** Unknown types are omitted, never silently converted into a different warp. */
export function normalizeStudioWarps(input:unknown): Required<StudioWarp>[] {
  if(!Array.isArray(input))return [];
  const result: Required<StudioWarp>[]=[];
  for(const value of input.slice(0,64)) {
    if(!value||typeof value!=='object'||!STUDIO_WARPS.some(w=>w.value===value.type))continue;
    result.push({type:value.type,enabled:value.enabled!==false,amount:finite(value.amount,.35,-1,1),
      x:finite(value.x,.5,0,1),y:finite(value.y,.5,0,1),radius:finite(value.radius,.55,.05,2),
      angle:finite(value.angle,0,-180,180),frequency:finite(value.frequency,5,1,24)});
    if(result.length===MAX_STUDIO_WARPS)break;
  }
  return result;
}

type CompiledWarp = Required<StudioWarp> & {cos:number;sin:number};
const TAU=Math.PI*2;
const hash=(x:number,y:number) => {
  let bits=Math.imul(x,374761393)^Math.imul(y,668265263);
  bits=Math.imul(bits^(bits>>>13),1274126177);
  return ((bits^(bits>>>16))>>>0)/4294967296;
};

/** Bounded reusable sampling maps. No trigonometry in the per-frame resampler. */
export class SourceWarpProcessor {
  private warps:CompiledWarp[]=[];
  private signature='';
  private geometry='';
  private coordinates=new Float32Array(0);
  private output=new Uint8ClampedArray(0);
  private sampled=[0,0,0,0];
  private edge:StudioWarpEdge='clamp';

  constructor(input:unknown=[],edge:StudioWarpEdge='clamp') {this.configure(input,edge);}
  configure(input:unknown=[],edge:StudioWarpEdge='clamp') {
    const warps=normalizeStudioWarps(input).filter(w=>w.enabled&&w.amount!==0);
    const signature=JSON.stringify(warps);
    this.edge=edge==='transparent'?'transparent':'clamp';
    if(signature===this.signature)return;
    this.signature=signature;this.geometry='';
    this.warps=warps.map(w=>({...w,cos:Math.cos(w.angle*Math.PI/180),sin:Math.sin(w.angle*Math.PI/180)}));
    if(!warps.length)this.clear();
  }
  get active() {return this.warps.length>0;}
  /** Returns owned reusable storage when active, or the original pixels for identity. */
  apply(pixels:Uint8ClampedArray,width:number,height:number,aspect=width/height) {
    if(!this.active)return pixels;
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||
      width*height*4!==pixels.length||!Number.isFinite(aspect)||aspect<=0)throw new Error('Warp dimensions do not match the source.');
    const geometry=`${width}:${height}:${aspect}`;
    if(geometry!==this.geometry) {
      if(this.coordinates.length!==width*height*2)this.coordinates=new Float32Array(width*height*2);
      const ax=Math.max(1,aspect),ay=Math.max(1,1/aspect);
      for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
        let u=(x+.5)/width,v=(y+.5)/height;
        // Inverse sampling composes in reverse so list order matches visible operations.
        for(let n=this.warps.length-1;n>=0;n--) {
          const w=this.warps[n],dx=(u-w.x)*ax/w.radius,dy=(v-w.y)*ay/w.radius;
          const r2=dx*dx+dy*dy;
          if(r2>=1)continue;
          const r=Math.sqrt(r2),falloff=(1-r2)*(1-r2),a=w.amount;
          let px=dx,py=dy;
          if(w.type==='twirl'||w.type==='zigzag') {
            const theta=w.type==='twirl' ? -a*TAU*falloff
              : a*.65*(2/Math.PI*Math.asin(Math.sin(r*TAU*w.frequency)))*falloff;
            const c=Math.cos(theta),s=Math.sin(theta);px=dx*c-dy*s;py=dx*s+dy*c;
          } else if(w.type==='pinch') {
            const scale=Math.exp(a*2*falloff);px=dx*scale;py=dy*scale;
          } else if(w.type==='sphere'&&r>0) {
            const projected=Math.asin(r)*2/Math.PI;
            const scale=1+a*falloff*(projected/r-1);px=dx*scale;py=dy*scale;
          } else if(w.type==='ripple'&&r>0) {
            const scale=1+a*.12*Math.sin(r*TAU*w.frequency)*falloff/r;
            px=dx*scale;py=dy*scale;
          } else if(w.type==='shear') {
            const perpendicular=-dx*w.sin+dy*w.cos;
            px-=a*perpendicular*.9*falloff*w.cos;py-=a*perpendicular*.9*falloff*w.sin;
          } else if(w.type==='smudge') {
            px-=a*.65*falloff*w.cos;py-=a*.65*falloff*w.sin;
          } else if(w.type==='polar') {
            const lx=dx*w.cos+dy*w.sin,ly=-dx*w.sin+dy*w.cos;
            const theta=Math.atan2(ly,lx);
            const tx=a>0?theta/Math.PI:Math.cos(lx*Math.PI)*(ly+1)/2;
            const ty=a>0?r*2-1:Math.sin(lx*Math.PI)*(ly+1)/2;
            const targetX=tx*w.cos-ty*w.sin,targetY=tx*w.sin+ty*w.cos;
            px+=(targetX-dx)*Math.abs(a)*falloff;py+=(targetY-dy)*Math.abs(a)*falloff;
          } else if(w.type==='fragment') {
            const tx=Math.floor((dx*w.cos+dy*w.sin)*w.frequency),ty=Math.floor((-dx*w.sin+dy*w.cos)*w.frequency);
            const ox=(hash(tx,ty)-.5)*a*.5*falloff,oy=(hash(ty+71,tx-31)-.5)*a*.5*falloff;
            px+=ox*w.cos-oy*w.sin;py+=ox*w.sin+oy*w.cos;
          }
          u=w.x+px*w.radius/ax;v=w.y+py*w.radius/ay;
        }
        const i=(y*width+x)*2;
        this.coordinates[i]=u*width-.5;this.coordinates[i+1]=v*height-.5;
      }
      this.geometry=geometry;
    }
    if(this.output.length!==pixels.length)this.output=new Uint8ClampedArray(pixels.length);
    const source=pixels===this.output?pixels.slice():pixels;
    const sample=this.edge==='transparent'?samplePixelTransparent:samplePixel;
    for(let i=0,j=0;i<pixels.length;i+=4,j+=2) {
      sample(source,width,height,this.coordinates[j],this.coordinates[j+1],this.sampled);
      for(let c=0;c<4;c++)this.output[i+c]=this.sampled[c];
    }
    return this.output;
  }
  clear() {this.coordinates=new Float32Array(0);this.output=new Uint8ClampedArray(0);this.geometry='';}
}
