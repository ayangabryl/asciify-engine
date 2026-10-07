import type { AsciiOptions } from '../types';

export type AmbientMotion = 'none' | 'caustics' | 'current' | 'reform' | 'sheen' | 'tidal' | 'grain' | 'parallax' | 'weave' | 'print' | 'trace';
export const MOTION_STYLES = [
  { value: 'none', mode: 'none', group: 'Still', label: 'Off', description: 'Keep the image still. Hover stays available.' },
  { value: 'caustics', mode: 'caustics', group: 'Light and texture', label: 'Caustics', description: 'Soft ribbons of light travel across a stationary character grid.' },
  { value: 'current', mode: 'current', group: 'Flow and depth', label: 'Slow Current', description: 'A gentle flow through the image, with steady edges.' },
  { value: 'reform', mode: 'reform', group: 'Rebuild', label: 'Reveal & Reform', description: 'Disperse, gather, then hold the complete image.' },
  { value: 'sheen', mode: 'sheen', group: 'Light and texture', label: 'Sheen', description: 'A broad diagonal light sweep; characters stay anchored.' },
  { value: 'tidal', mode: 'tidal', group: 'Flow and depth', label: 'Tidal Rings', description: 'Concentric currents travel outward, with protected edges.' },
  { value: 'grain', mode: 'grain', group: 'Light and texture', label: 'Living Grain', description: 'Slow, individually phased tonal changes on a stationary grid.' },
  { value: 'parallax', mode: 'parallax', group: 'Flow and depth', label: 'Parallax', description: 'A shallow, continuous drift through the image, with the edges held in place.' },
  { value: 'weave', mode: 'weave', group: 'Flow and depth', label: 'Woven Flow', description: 'Interlaced bands move in opposing directions, like a flexible printed fabric.' },
  { value: 'print', mode: 'print', group: 'Rebuild', label: 'Print Shift', description: 'Staggered rows lift, soften and register back into the image.' },
  { value: 'trace', mode: 'trace', group: 'Light and texture', label: 'Contour Light', description: 'Light follows the source image’s tonal contours; every character stays anchored.' },
] as const;
export function resolveMotion(style?: string): AmbientMotion {
  return MOTION_STYLES.find(s => s.value === style || s.mode === style)?.mode ?? 'none';
}
export const motionId = (mode: AmbientMotion) => MOTION_STYLES.findIndex(style => style.mode === mode);
export const isAnchoredMotion = (mode: AmbientMotion) => ['none', 'caustics', 'sheen', 'grain', 'trace'].includes(mode);
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
export function sampleAmbient(mode: AmbientMotion, x: number, y: number, time: number, out: number[], tone = .5) {
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
  } else if(mode==='sheen') {
    out[2]=Math.pow(.5+.5*Math.cos(x*5+y*3-p),8)*.2-.025;
  } else if(mode==='tidal') {
    const dx=x-.5,dy=y-.5,d=Math.hypot(dx,dy),wave=Math.sin(d*22-p)*envelope;
    out[0]=dx*wave*9;out[1]=dy*wave*9;
    out[2]=wave*.035;
  } else if(mode==='grain') {
    const phase=printGrain(Math.floor(x*160),Math.floor(y*100))*Math.PI*2;
    out[2]=Math.sin(p+phase)*.07;
  } else if(mode==='parallax') {
    const depth=.45+.55*Math.max(0,1-Math.hypot(x-.5,y-.5)*1.4);
    out[0]=Math.sin(p)*12*depth*envelope;
    out[1]=(Math.cos(p)-1)*6*depth*envelope;
  } else if(mode==='weave') {
    out[0]=Math.sin(y*Math.PI*6+p)*Math.sin(p)*8*envelope;
    out[1]=Math.sin(x*Math.PI*6-p)*Math.sin(p)*6*envelope;
  } else if(mode==='print') {
    const row=Math.floor(y*24), cycle=((time+printGrain(row,3)*3)%12+12)%12;
    const lift=smooth(1,2.5,cycle)*(1-smooth(3.5,5,cycle));
    out[0]=Math.sin(row*2.4)*lift*9*envelope;
    out[1]=-lift*5*envelope;
    out[2]=-lift*.22; out[3]=1-lift*.45;
  } else if(mode==='trace') {
    const level=.5+.5*Math.cos(p);
    out[2]=Math.pow(Math.max(0,1-Math.abs(clamp(tone)-level)/.16),3)*.22-.015;
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
  vec4 ambientAt(vec2 uv, float tone) {
    float p=motionTime*.5235987756;
    float edge=smoothstep(0.,.12,min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y)));
    if(motionMode<.5) return vec4(0.,0.,0.,1.);
    if(motionMode<1.5) {
      float fold=sin(uv.x*9.+uv.y*5.+p)+sin(uv.y*8.-uv.x*3.-p);
      float light=pow(max(0.,1.-abs(fold)*.72),3.);
      return vec4(0.,0.,(light*.22-.045)*edge,1.);
    }
    if(motionMode<2.5) return vec4(sin(uv.y*9.+p)*cos(uv.x*7.-p)*10.*edge,cos(uv.x*8.+p)*sin(uv.y*6.-p)*7.*edge,0.,1.);
    if(motionMode>9.5) {
      float level=.5+.5*cos(p);
      return vec4(0.,0.,pow(max(0.,1.-abs(clamp(tone,0.,1.)-level)/.16),3.)*.22-.015,1.);
    }
    if(motionMode>8.5) {
      float row=floor(uv.y*24.),cycle=mod(motionTime+printGrain(vec2(row,3.))*3.,12.);
      float lift=smoothstep(1.,2.5,cycle)*(1.-smoothstep(3.5,5.,cycle));
      return vec4(sin(row*2.4)*lift*9.*edge,-lift*5.*edge,-lift*.22,1.-lift*.45);
    }
    if(motionMode>7.5) return vec4(sin(uv.y*18.8495559215+p)*sin(p)*8.*edge,sin(uv.x*18.8495559215-p)*sin(p)*6.*edge,0.,1.);
    if(motionMode>6.5) {
      float depth=.45+.55*max(0.,1.-length(uv-.5)*1.4);
      return vec4(sin(p)*12.*depth*edge,(cos(p)-1.)*6.*depth*edge,0.,1.);
    }
    if(motionMode>5.5) return vec4(0.,0.,sin(p+printGrain(floor(uv*vec2(160.,100.)))*6.28318530718)*.07,1.);
    if(motionMode>4.5) {
      vec2 delta=uv-.5; float wave=sin(length(delta)*22.-p)*edge;
      return vec4(delta*wave*9.,wave*.035,1.);
    }
    if(motionMode>3.5) return vec4(0.,0.,pow(.5+.5*cos(uv.x*5.+uv.y*3.-p),8.)*.2-.025,1.);
    float cycle=mod(motionTime,12.);
    float grain=printGrain(floor(uv*vec2(160.,100.)));
    float order=uv.x*.65+uv.y*.2+grain*.15+sin(uv.x*8.-uv.y*5.)*.08;
    float gone=smoothstep(1.8+order*1.2,3.8+order*1.2,cycle)*(1.-smoothstep(5.+order*1.7,7.2+order*1.7,cycle));
    return vec4(sin(uv.y*9.+p)*gone*(1.-gone)*24.*edge,-gone*(1.-gone)*(8.+grain*12.)*edge,-gone*.45,1.-gone*.9);
  }
`;

/** Scale motion without changing its phase or the stationary image. */
export function scaleMotion(out: number[], amount: number) {
  const strength = Math.max(0, Math.min(2, Number.isFinite(amount) ? amount : 1));
  out[0] *= strength; out[1] *= strength; out[2] *= strength;
  out[3] = clamp(1 + (out[3] - 1) * strength);
  return out;
}
