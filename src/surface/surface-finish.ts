export type SurfaceFilter = 'clean' | 'prism' | 'etch' | 'signal';
export interface SurfaceFinish { filter?: SurfaceFilter; edgeEffect?: number; edgeSoftness?: number }
export const SURFACE_FILTERS: { value: SurfaceFilter; label: string; description: string }[] = [
  { value: 'clean', label: 'Clean', description: 'Crisp characters with no optical texture.' },
  { value: 'signal', label: 'Signal', description: 'Broken scanlines at the edges, with a clear center.' },
  { value: 'prism', label: 'Prism', description: 'Soft red/cyan separation at the edges, with a crisp center.' },
  { value: 'etch', label: 'Etch', description: 'A fine engraved texture, keeping the ink monochrome.' },
];
export function finishSettings(finish: SurfaceFinish = {}) {
  const filter = SURFACE_FILTERS.some(f => f.value === finish.filter) ? finish.filter! : 'prism';
  const amount = Number.isFinite(finish.edgeEffect) ? Math.max(0, Math.min(1, finish.edgeEffect!)) : finish.filter ? 1 : 0;
  const softness = Number.isFinite(finish.edgeSoftness) ? Math.max(0, Math.min(1, finish.edgeSoftness!)) : 0;
  return { mode: ['clean', 'prism', 'etch', 'signal'].indexOf(filter), amount: filter === 'clean' ? 0 : amount, softness: filter === 'prism' ? softness : 0 };
}
/** App preview metadata stays separate from core conversion options. */
export function readSurfaceFinish(options: object): SurfaceFinish {
  const value = options as { surfaceFilter?: SurfaceFilter; surfaceFilterStrength?: number; surfaceEdgeSoftness?: number };
  return { filter: value.surfaceFilter ?? 'clean', edgeEffect: value.surfaceFilterStrength ?? .85, edgeSoftness: value.surfaceEdgeSoftness ?? 0 };
}
export function withSurfaceFinish<T extends object>(options: T, finish: SurfaceFinish): T {
  return { ...options, surfaceFilter: finish.filter, surfaceFilterStrength: finish.edgeEffect, surfaceEdgeSoftness: finish.edgeSoftness };
}

/** Stationary glyph finishes: no whole-canvas blur, extra pass, or time-random flicker. */
export const EDGE_FINISH_GLSL = `
uniform float finishMode;
uniform float finishPixelRatio;
uniform float finishSoftness;
vec3 edgeCoverage(sampler2D sheet, vec2 uv, vec2 atlas, vec2 pixel, vec2 viewport, float amount) {
  float a=texture2D(sheet,uv).a;
  if(amount<=0.0 || finishMode<.5) return vec3(a);
  vec2 radial=(pixel/viewport-.5)*2.0;
  float edge=smoothstep(.3,1.05,length(radial));
  float strength=clamp(amount,0.0,1.0)*edge;
  if(strength<=0.0) return vec3(a);
  vec2 cssPixel=pixel/max(1.0,finishPixelRatio);
  // Etch is a single texture sample: linework, not an opacity wash.
  if(finishMode>1.5 && finishMode<2.5) {
    float hatch=step(.68,fract((cssPixel.y+cssPixel.x*.22)*.5));
    return vec3(a*(1.0-hatch*strength*.64));
  }
  // Samples remain inside the current atlas tile's three-pixel padding.
  if(finishMode>2.5) {
    float band=floor(cssPixel.y/3.0);
    float phase=fract(sin(band*12.9898)*43758.5453);
    float tear=(phase-.5)*3.6*strength;
    float displaced=texture2D(sheet,uv+vec2(tear,0.0)/atlas).a;
    float cut=step(.72,fract(cssPixel.y*.5));
    return vec3(mix(a,displaced,strength)*(1.0-cut*.55*strength));
  }
  // A five-tap lens: opposed red/cyan edges with a short soft shoulder.
  // The center remains untouched; all offsets stay within three atlas texels.
  vec2 direction=normalize(vec2(radial.x-radial.y*.3,radial.y+radial.x*.3)+vec2(.00001));
  vec2 shift=direction*(2.35+.45*finishSoftness)*strength/atlas;
  float left=texture2D(sheet,uv-shift).a,right=texture2D(sheet,uv+shift).a;
  float softLeft=texture2D(sheet,uv-shift*.45).a,softRight=texture2D(sheet,uv+shift*.45).a;
  float red=left*.7+softLeft*.22+a*.08;
  float cyan=right*.7+softRight*.22+a*.08;
  // Reuse the same taps for a short optical blur and peripheral fade.
  // No whole-canvas blur, extra pass or softened HTML controls.
  float soft=a*.4+(left+right+softLeft+softRight)*.15;
  vec3 fringe=mix(vec3(red,cyan,cyan),vec3(soft),finishSoftness*.45);
  return mix(vec3(a),fringe,strength)*(1.-finishSoftness*strength*.32);

}
`;
