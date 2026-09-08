import type { AsciiOptions } from '../types';

export type AmbientMotion = 'none' | 'print' | 'current' | 'reform';
export const MOTION_STYLES = [
  { value: 'none', mode: 'none', label: 'Off', description: 'Keep the image still. Hover stays available.' },
  { value: 'breathe', mode: 'print', label: 'Living Print', description: 'Soft tonal movement. The character grid stays still.' },
  { value: 'wave', mode: 'current', label: 'Slow Current', description: 'A gentle flow through the image, with steady edges.' },
  { value: 'rain', mode: 'reform', label: 'Reveal & Reform', description: 'Disperse, gather, then hold the complete image.' },
] as const;
export function resolveMotion(style?: string): AmbientMotion {
  if (style === 'orbit') return 'current'; // Restore older saved selections gracefully.
  return MOTION_STYLES.find(s => s.value === style || s.mode === style)?.mode ?? 'none';
}
export const motionId = (mode: AmbientMotion) => ['none', 'print', 'current', 'reform'].indexOf(mode);
export const isFineDither = (options?: Pick<AsciiOptions, 'artStyle' | 'customText' | 'charsetFrames' | 'charset'>) => options?.artStyle === 'terminal' && !options.customText && !options.charsetFrames?.length && !/[A-Za-z]/.test(options.charset ?? '');
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp((v-a)/(b-a)); return t*t*(3-2*t); };
export const printGrain = (x: number, y: number) => { const v = 52.9829189 * ((x*.06711056+y*.00583715)%1); return v-Math.floor(v); };
/** Time is supplied by the preview clock: pause and speed edits cannot jump phase. */
export class AmbientTimeline {
  private last: number | null = null;
  private mode: AmbientMotion = 'none';
  private phase = 0;
  update(time: number, mode: AmbientMotion, speed = 1) {
    if (!Number.isFinite(time)) return this.phase;
    if (mode !== this.mode || this.last !== null && time < this.last) { this.mode=mode; this.phase=0; this.last=time; }
    if (this.last !== null) this.phase += Math.max(0,time-this.last) * Math.max(.1,Math.min(3,Number.isFinite(speed)?speed:1));
    this.last=time;
    return this.phase;
  }
}
/** CPU reference and Canvas fallback. Output: offset in CSS px, density shift, opacity. */
export function sampleAmbient(mode: AmbientMotion, x: number, y: number, time: number, out: number[]) {
  const p=time*Math.PI/6, envelope=smooth(0,.12,Math.min(x,1-x,y,1-y));
  out[0]=out[1]=out[2]=0; out[3]=1;
  if(mode==='print') {
    out[2]=(Math.sin(x*9+y*5+p)*Math.cos(y*8-x*3-p)*.065)*envelope;
    out[3]=.9+.1*Math.sin(x*6-y*4+p);
  } else if(mode==='current') {
    out[0]=(Math.sin(y*9+p)*Math.cos(x*7-p))*6*envelope;
    out[1]=(Math.cos(x*8+p)*Math.sin(y*6-p))*4*envelope;
  } else if(mode==='reform') {
    const cycle=((time%12)+12)%12;
    const order=x*.8+y*.2+Math.sin(x*8-y*5)*.08;
    const gone=smooth(1.8+order*1.2,3.8+order*1.2,cycle)*(1-smooth(5+order*1.7,7.2+order*1.7,cycle));
    out[2]=-gone*.95; out[3]=1-gone*.82;
  }
  return out;
}
export const AMBIENT_GLSL = `
  uniform float motionMode; uniform float motionTime; uniform float fineDither; uniform float ditherAmount;
  float printGrain(vec2 p) { return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715)))); }
  vec4 ambientAt(vec2 uv) {
    float p=motionTime*.5235987756;
    float edge=smoothstep(0.,.12,min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y)));
    if(motionMode<.5) return vec4(0.,0.,0.,1.);
    if(motionMode<1.5) return vec4(0.,0.,sin(uv.x*9.+uv.y*5.+p)*cos(uv.y*8.-uv.x*3.-p)*.065*edge,.9+.1*sin(uv.x*6.-uv.y*4.+p));
    if(motionMode<2.5) return vec4(sin(uv.y*9.+p)*cos(uv.x*7.-p)*6.*edge,cos(uv.x*8.+p)*sin(uv.y*6.-p)*4.*edge,0.,1.);
    float cycle=mod(motionTime,12.);
    float order=uv.x*.8+uv.y*.2+sin(uv.x*8.-uv.y*5.)*.08;
    float gone=smoothstep(1.8+order*1.2,3.8+order*1.2,cycle)*(1.-smoothstep(5.+order*1.7,7.2+order*1.7,cycle));
    return vec4(0.,0.,-gone*.95,1.-gone*.82);
  }
`;
