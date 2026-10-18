import type { AsciiOptions } from '../types';

export type AmbientMotion = 'none' | 'relight' | 'sheen' | 'glow' | 'shimmer' | 'parallax' | 'push' | 'focus' | 'mist' | 'current' | 'develop';
/** Retired after 4.21: each still loads, as its closest photo-aware replacement. */
export type LegacyAmbientMotion = 'caustics' | 'grain' | 'trace' | 'tidal' | 'weave' | 'breeze' | 'reform' | 'print' | 'unfold';
export const DEPRECATED_MOTIONS: Readonly<Record<LegacyAmbientMotion, AmbientMotion>> = {
  caustics: 'sheen', grain: 'shimmer', trace: 'relight', tidal: 'current', weave: 'current', breeze: 'current',
  reform: 'develop', print: 'develop', unfold: 'develop',
};
// Every motion reads the photo's own light, depth and detail; none is a pattern laid over the image.
export const MOTION_STYLES = [
  { value: 'none', mode: 'none', group: 'Still', label: 'Off', description: 'Keep the image still. Hover stays available.' },
  { value: 'relight', mode: 'relight', group: 'Light', label: 'Relight', description: 'A key light circles the subject and models its own relief, like moving a lamp around a sculpture.' },
  { value: 'sheen', mode: 'sheen', group: 'Light', label: 'Specular sweep', description: 'One slow pass of light glances across the highlights and follows their form, then rests.' },
  { value: 'glow', mode: 'glow', group: 'Light', label: 'Highlight bloom', description: 'The brightest areas breathe a soft halo into their surroundings. Shadows stay deep.' },
  { value: 'shimmer', mode: 'shimmer', group: 'Light', label: 'Glints', description: 'Sparse glints on bright fine detail, like light on water, metal or an eye. Everything else holds still.' },
  { value: 'parallax', mode: 'parallax', group: 'Depth', label: 'Parallax', description: 'A slow camera drift: the subject moves against its background, read from the photo’s own depth cues.' },
  { value: 'push', mode: 'push', group: 'Depth', label: 'Slow push', description: 'A gentle push toward the subject and back, with nearer areas moving slightly more.' },
  { value: 'focus', mode: 'focus', group: 'Depth', label: 'Focus pull', description: 'Focus racks from the subject to the background and back; the characters soften out of focus.' },
  { value: 'mist', mode: 'mist', group: 'Atmosphere', label: 'Mist', description: 'Soft mist drifts through the distance and plain areas, leaving the subject clear.' },
  { value: 'current', mode: 'current', group: 'Atmosphere', label: 'Drift', description: 'Water swells and glints, falls stream down, sky and clouds drift slowly, like a cinemagraph. Subjects and buildings hold still.' },
  { value: 'develop', mode: 'develop', group: 'Reveal', label: 'Develop', description: 'The image holds, fades, then develops back in from its highlights to its shadows, like a print in the tray.' },
] as const;
export function resolveMotion(style?: string): AmbientMotion {
  const legacy = style && Object.prototype.hasOwnProperty.call(DEPRECATED_MOTIONS, style) ? DEPRECATED_MOTIONS[style as LegacyAmbientMotion] : style;
  return MOTION_STYLES.find(s => s.value === legacy || s.mode === legacy)?.mode ?? 'none';
}
export const motionId = (mode: AmbientMotion) => MOTION_STYLES.findIndex(style => style.mode === mode);
/** Motions that change light only: the character grid and every glyph's position stay fixed. */
export const isAnchoredMotion = (mode: AmbientMotion) => ['none', 'relight', 'sheen', 'glow', 'shimmer', 'focus', 'mist', 'develop'].includes(mode);
export const isFineDither = (options?: Pick<AsciiOptions, 'fineDither' | 'customText' | 'charsetFrames' | 'charset'>) => options?.fineDither === true && !options.customText && !options.charsetFrames?.length && !/[A-Za-z]/.test(options.charset ?? '');
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp((v-a)/(b-a)); return t*t*(3-2*t); };
export const printGrain = (x: number, y: number) => { const v = 52.9829189 * ((x*.06711056+y*.00583715)%1); return v-Math.floor(v); };
/** Time is supplied by the preview clock: pause and speed edits cannot jump phase. */
export class AmbientTimeline {
  private last: number | null = null;
  private mode: AmbientMotion = 'none';
  private phase = 0;
  update(time: number, style: AmbientMotion | LegacyAmbientMotion, speed = 1) {
    const mode = resolveMotion(style);
    if (!Number.isFinite(time)) return this.phase;
    if (mode !== this.mode || this.last !== null && time < this.last) { this.mode=mode; this.phase=0; this.last=time; }
    if (this.last !== null) this.phase += Math.max(0,time-this.last) * Math.max(.1,Math.min(3,Number.isFinite(speed)?speed:1));
    this.last=time;
    return this.phase;
  }
}
/**
 * CPU reference and Canvas fallback. Output: offset in CSS px (at a 960px frame), tone shift, opacity.
 * `cues` holds photo cues (see photo-cues.ts) from `at`; without them the cell's tone stands in.
 * At time 0 every motion shows the still image, so reduced motion and paused previews stay faithful.
 */
export function sampleAmbient(mode: AmbientMotion, x: number, y: number, time: number, out: number[], tone = .5, cues?: ArrayLike<number>, at = 0) {
  out[0]=out[1]=out[2]=0; out[3]=1;
  if (mode === 'none') return out;
  tone = clamp(tone);
  const light = cues ? cues[at] : tone;
  const depth = cues ? cues[at+1] : .5+.5*clamp(1-Math.hypot(x-.5,y-.55)*2);
  const glow = cues ? cues[at+2] : smooth(.55,1,tone)**2;
  const detail = cues ? cues[at+3] : .5;
  const nx = cues ? cues[at+4] : 0, ny = cues ? cues[at+5] : 0;
  const p=time*Math.PI/6, cycle=((time%12)+12)%12, envelope=smooth(0,.12,Math.min(x,1-x,y,1-y));
  if(mode==='relight') {
    const a=p+.6, lx=Math.cos(a), ly=Math.sin(a);
    const form=Math.max(-1,Math.min(1,nx*lx+ny*ly))+(lx*(x-.5)+ly*(y-.5))*.35;
    out[2]=form*.2*(.3+.7*smooth(.04,.3,light)*(1-.6*smooth(.82,1,tone)));
  } else if(mode==='sheen') {
    const position=-.35+1.9*smooth(0,8,cycle);
    const d=(x*.75+y*.45)/1.2+(nx*.75+ny*.45)*.05;
    const band=Math.exp(-(((d-position)/.12)**2));
    out[2]=band*smooth(.3,.8,light)*(1-.5*smooth(.9,1,tone))*.45;
  } else if(mode==='glow') {
    const k=.5-.5*Math.cos(p), threshold=1-.8*k;
    out[2]=.2*smooth(threshold-.3,threshold+.02,glow)*Math.sqrt(glow)*(1-.65*tone)+.05*k*smooth(.6,.95,tone);
  } else if(mode==='shimmer') {
    const phase=printGrain(Math.floor(x*160),Math.floor(y*100))*Math.PI*2;
    const glint=Math.pow(.5+.5*Math.cos(p*2+phase),28);
    out[2]=glint*smooth(.5,.88,tone)*(.35+.65*smooth(.1,.55,detail))*.42;
  } else if(mode==='parallax') {
    const near=depth-.45;
    out[0]=near*16*Math.sin(p)*envelope;
    out[1]=near*7*Math.sin(p*2)*envelope;
  } else if(mode==='push') {
    // Zooming in only ever samples inside the frame, so the edges need no pinning.
    const zoom=.045*(.5-.5*Math.cos(p))*(.7+.6*depth)*960;
    const cx=cues ? cues[at+6] : .5, cy=cues ? cues[at+7] : .5;
    out[0]=(x-cx)*zoom; out[1]=(y-cy)*zoom;
  } else if(mode==='focus') {
    const s=Math.sin(p), defocus=s*s*smooth(.35,.85,s>=0 ? 1-depth : depth);
    out[2]=(light-tone)*defocus*.75;
  } else if(mode==='mist') {
    const far=Math.pow(1-depth,1.5)*(1-.6*detail);
    const veil=Math.sin(x*4.1-p+Math.sin(y*3.3+p)*.9)*.5+Math.sin(x*7.3+y*2.1-p*2+Math.sin(x*2.7-y*5.1+p)*1.1)*.3+Math.sin(y*5.7-x*1.9+p)*.2;
    out[2]=smooth(-.3,.9,veil)*far*.16*(1-.55*tone);
  } else if(mode==='current') {
    // Measured from the still at time zero: the flow starts from, and returns to, the photograph.
    // Water swells sideways and glints; sky and cloud slide very slowly; everything else holds.
    const water=cues?.[at+8] ?? 0, sky=cues?.[at+9] ?? 0, falls=cues?.[at+10] ?? 0, edge=smooth(0,.06,Math.min(x,1-x,y,1-y));
    // Without cues (the bare CPU fallback) a smooth, far ground flows instead; with them only water and sky move.
    const plain=cues ? 0 : (1-.4*detail)*(1-.8*depth)*envelope;
    const wave=(q: number) => y*14-q+Math.sin(x*3+q)*1.5;
    const swell=(q: number) => y*16+x*2-q, chop=(q: number) => y*29-x*3-q*2;
    const sheet=(q: number) => x*1.7+y*2.3-q, fall=(q: number) => y*26+Math.sin(x*40)*1.5-q*2;
    out[0]=(Math.sin(wave(p))-Math.sin(wave(0))+(Math.sin(x*5-y*3+p)-Math.sin(x*5-y*3))*.43)*7*plain
      +((Math.sin(swell(p))-Math.sin(swell(0)))*3.5+(Math.sin(chop(p))-Math.sin(chop(0)))*1.5)*water*edge
      +(Math.sin(sheet(p))-Math.sin(sheet(0)))*5*sky*edge;
    // Falling water: streaks travel downward through the fall.
    out[1]=(Math.sin(x*11+p)-Math.sin(x*11))*2*plain+(Math.cos(swell(p))-Math.cos(swell(0)))*.8*water*edge+(Math.sin(fall(p))-Math.sin(fall(0)))*12*falls*edge;
    const glint=Math.pow(.5+.5*Math.cos(p*2+x*9-y*4+printGrain(Math.floor(x*160),Math.floor(y*100))*6.2831853),24)
      -Math.pow(.5+.5*Math.cos(x*9-y*4+printGrain(Math.floor(x*160),Math.floor(y*100))*6.2831853),24);
    out[2]=(Math.cos(wave(p))-Math.cos(wave(0)))*.03*plain+(glint*smooth(.5,.85,tone)*.3+(Math.cos(swell(p))-Math.cos(swell(0)))*.025)*water*edge
      +(Math.cos(fall(p))-Math.cos(fall(0)))*.08*falls*edge;
  } else if(mode==='develop') {
    const fade=smooth(7,8.5,cycle), k=clamp((cycle-8.5)/3.5);
    const shown=cycle<8.5 ? 1-fade : smooth(0,1,(k*1.45-(1-tone)+(printGrain(Math.floor(x*160),Math.floor(y*100))-.5)*.06)/.3);
    out[2]=-(1-shown)*.3; out[3]=1-(1-shown)*.9;
  }
  return out;
}
export const AMBIENT_GLSL = `
  uniform float motionMode; uniform float motionTime; uniform float fineDither; uniform float ditherAmount; uniform vec2 motionFocus;
  float printGrain(vec2 p) { return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715)))); }
  // cue: light, depth, glow, detail; normal: relief normal.
  vec4 ambientAt(vec2 uv, float tone, vec4 cue, vec2 normal) {
    if(motionMode<.5) return vec4(0.,0.,0.,1.);
    float p=motionTime*.5235987756, cycle=mod(motionTime,12.);
    float edge=smoothstep(0.,.12,min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y)));
    tone=clamp(tone,0.,1.);
    if(motionMode<1.5) {
      float a=p+.6; vec2 l=vec2(cos(a),sin(a));
      float form=clamp(dot(normal,l),-1.,1.)+dot(uv-.5,l)*.35;
      return vec4(0.,0.,form*.2*(.3+.7*smoothstep(.04,.3,cue.x)*(1.-.6*smoothstep(.82,1.,tone))),1.);
    }
    if(motionMode<2.5) {
      float position=-.35+1.9*smoothstep(0.,8.,cycle);
      float d=(uv.x*.75+uv.y*.45)/1.2+(normal.x*.75+normal.y*.45)*.05;
      float band=exp(-pow((d-position)/.12,2.));
      return vec4(0.,0.,band*smoothstep(.3,.8,cue.x)*(1.-.5*smoothstep(.9,1.,tone))*.45,1.);
    }
    if(motionMode<3.5) {
      float k=.5-.5*cos(p), threshold=1.-.8*k;
      return vec4(0.,0.,.2*smoothstep(threshold-.3,threshold+.02,cue.z)*sqrt(cue.z)*(1.-.65*tone)+.05*k*smoothstep(.6,.95,tone),1.);
    }
    if(motionMode<4.5) {
      float phase=printGrain(floor(uv*vec2(160.,100.)))*6.28318530718;
      float glint=pow(.5+.5*cos(p*2.+phase),28.);
      return vec4(0.,0.,glint*smoothstep(.5,.88,tone)*(.35+.65*smoothstep(.1,.55,cue.w))*.42,1.);
    }
    if(motionMode<5.5) { float near=cue.y-.45; return vec4(near*16.*sin(p)*edge,near*7.*sin(p*2.)*edge,0.,1.); }
    if(motionMode<6.5) return vec4((uv-motionFocus)*.045*(.5-.5*cos(p))*(.7+.6*cue.y)*960.,0.,1.);
    if(motionMode<7.5) {
      float s=sin(p), defocus=s*s*smoothstep(.35,.85,s>=0.?1.-cue.y:cue.y);
      return vec4(0.,0.,(cue.x-tone)*defocus*.75,1.);
    }
    if(motionMode<8.5) {
      float far=pow(1.-cue.y,1.5)*(1.-.6*cue.w);
      float veil=sin(uv.x*4.1-p+sin(uv.y*3.3+p)*.9)*.5+sin(uv.x*7.3+uv.y*2.1-p*2.+sin(uv.x*2.7-uv.y*5.1+p)*1.1)*.3+sin(uv.y*5.7-uv.x*1.9+p)*.2;
      return vec4(0.,0.,smoothstep(-.3,.9,veil)*far*.16*(1.-.55*tone),1.);
    }
    if(motionMode<9.5) {
      // Drift is packed with water in z and sky in w (see packPhotoCues): only they move.
      // w holds sky below one half and falling water above it.
      float water=cue.z, sky=min(1.,cue.w*2.), falls=max(0.,cue.w*2.-1.), rim=smoothstep(0.,.06,min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y)));
      sky*=1.-step(.5,cue.w);
      float swell=uv.y*16.+uv.x*2., chop=uv.y*29.-uv.x*3., sheet=uv.x*1.7+uv.y*2.3, fall=uv.y*26.+sin(uv.x*40.)*1.5;
      float seed=printGrain(floor(uv*vec2(160.,100.)))*6.2831853+uv.x*9.-uv.y*4.;
      float glint=pow(.5+.5*cos(p*2.+seed),24.)-pow(.5+.5*cos(seed),24.);
      return vec4(
        ((sin(swell-p)-sin(swell))*3.5+(sin(chop-p*2.)-sin(chop))*1.5)*water*rim+(sin(sheet-p)-sin(sheet))*5.*sky*rim,
        (cos(swell-p)-cos(swell))*.8*water*rim+(sin(fall-p*2.)-sin(fall))*12.*falls*rim,
        (glint*smoothstep(.5,.85,tone)*.3+(cos(swell-p)-cos(swell))*.025)*water*rim+(cos(fall-p*2.)-cos(fall))*.08*falls*rim,1.);
    }
    float fade=smoothstep(7.,8.5,cycle), k=clamp((cycle-8.5)/3.5,0.,1.);
    float shown=cycle<8.5?1.-fade:smoothstep(0.,1.,(k*1.45-(1.-tone)+(printGrain(floor(uv*vec2(160.,100.)))-.5)*.06)/.3);
    return vec4(0.,0.,-(1.-shown)*.3,1.-(1.-shown)*.9);
  }
`;

/** Motions whose tone is light: it mostly brightens the ink and changes character density only in part, so it glows rather than flickers. */
export const isLightMotion = (mode: AmbientMotion) => mode === 'relight' || mode === 'sheen' || mode === 'glow' || mode === 'shimmer' || mode === 'mist';
/** A cell-grid position whose blend between neighbours is brief, so moving tones stay crisp instead of averaging to mush. */
export function crispCell(v: number) {
  const i = Math.floor(v), t = Math.max(0, Math.min(1, (v - i - .2) / .6));
  return i + t * t * (3 - 2 * t);
}
/**
 * Displacing motions move the image through a fixed grid, so every character stays aligned and readable: the cell at
 * (x, y) shows the still from `out`, in cells. Shared by the Studio and core renderers.
 */
export function motionSource(ambient: ArrayLike<number>, x: number, y: number, cols: number, rows: number, out: number[]) {
  out[0] = crispCell(Math.max(0, Math.min(cols - 1, x - ambient[0] / 960 * cols)));
  out[1] = crispCell(Math.max(0, Math.min(rows - 1, y - ambient[1] / 960 * rows)));
  return out;
}

/** Scale motion without changing its phase or the stationary image. */
export function scaleMotion(out: number[], amount: number) {
  const strength = Math.max(0, Math.min(2, Number.isFinite(amount) ? amount : 1));
  out[0] *= strength; out[1] *= strength; out[2] *= strength;
  out[3] = clamp(1 + (out[3] - 1) * strength);
  return out;
}
