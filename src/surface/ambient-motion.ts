import type { AsciiOptions } from '../types';

export type AmbientMotion = 'none' | 'caustics' | 'current' | 'reform';
export const MOTION_STYLES = [
  { value: 'none', mode: 'none', label: 'Off', description: 'Keep the image still. Hover stays available.' },
  { value: 'caustics', mode: 'caustics', label: 'Caustics', description: 'Soft ribbons of light travel across a stationary character grid.' },
  { value: 'current', mode: 'current', label: 'Slow Current', description: 'A gentle flow through the image, with steady edges.' },
  { value: 'reform', mode: 'reform', label: 'Reveal & Reform', description: 'Disperse, gather, then hold the complete image.' },
] as const;
export function resolveMotion(style?: string): AmbientMotion {
  return MOTION_STYLES.find(s => s.value === style || s.mode === style)?.mode ?? 'none';
}
export const motionId = (mode: AmbientMotion) => ['none', 'caustics', 'current', 'reform'].indexOf(mode);
export const isFineDither = (options?: Pick<AsciiOptions, 'fineDither' | 'customText' | 'charsetFrames' | 'charset'>) => options?.fineDither === true && !options.customText && !options.charsetFrames?.length && !/[A-Za-z]/.test(options.charset ?? '');
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
  out[0]=out[1]=out[2]=0; out[3]=1;
  if (mode === 'none') return out;
  const p=time*Math.PI/6, envelope=smooth(0,.12,Math.min(x,1-x,y,1-y));
  if(mode==='caustics') {
    const fold=Math.sin(x*9+y*5+p)+Math.sin(y*8-x*3-p);
    const light=Math.pow(Math.max(0,1-Math.abs(fold)*.72),3);
    out[2]=(light*.22-.045)*envelope;
  } else if(mode==='current') {
    out[0]=(Math.sin(y*9+p)*Math.cos(x*7-p))*10*envelope;
    out[1]=(Math.cos(x*8+p)*Math.sin(y*6-p))*7*envelope;
  } else if(mode==='reform') {
    const cycle=((time%12)+12)%12;
    const grain=printGrain(Math.floor(x*160),Math.floor(y*100));
    const order=x*.65+y*.2+grain*.15+Math.sin(x*8-y*5)*.08;
    const gone=smooth(1.8+order*1.2,3.8+order*1.2,cycle)*(1-smooth(5+order*1.7,7.2+order*1.7,cycle));
    out[0]=Math.sin(y*9+p)*gone*(1-gone)*24*envelope;
    out[1]=-gone*(1-gone)*(8+grain*12)*envelope;
    out[2]=-gone*.45; out[3]=1-gone*.9;
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
    if(motionMode<1.5) {
      float fold=sin(uv.x*9.+uv.y*5.+p)+sin(uv.y*8.-uv.x*3.-p);
      float light=pow(max(0.,1.-abs(fold)*.72),3.);
      return vec4(0.,0.,(light*.22-.045)*edge,1.);
    }
    if(motionMode<2.5) return vec4(sin(uv.y*9.+p)*cos(uv.x*7.-p)*10.*edge,cos(uv.x*8.+p)*sin(uv.y*6.-p)*7.*edge,0.,1.);
    float cycle=mod(motionTime,12.);
    float grain=printGrain(floor(uv*vec2(160.,100.)));
    float order=uv.x*.65+uv.y*.2+grain*.15+sin(uv.x*8.-uv.y*5.)*.08;
    float gone=smoothstep(1.8+order*1.2,3.8+order*1.2,cycle)*(1.-smoothstep(5.+order*1.7,7.2+order*1.7,cycle));
    return vec4(sin(uv.y*9.+p)*gone*(1.-gone)*24.*edge,-gone*(1.-gone)*(8.+grain*12.)*edge,-gone*.45,1.-gone*.9);
  }
`;
