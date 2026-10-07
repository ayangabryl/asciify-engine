/** Print geometry is optional Studio work; importing the catalog creates no canvas. */
export const STUDIO_PRINT_STYLE_IDS = ['stipple','engraving','crosshatch','woodblock','risograph','pointillism'] as const;
export type StudioPrintStyle = typeof STUDIO_PRINT_STYLE_IDS[number];
export const STUDIO_PRINT_STYLES = [
  { value: 'stipple', label: 'Stipple', description: 'Scattered ink dots shape the image through their size.' },
  { value: 'engraving', label: 'Engraving', description: 'Continuous parallel cuts change weight with the image.' },
  { value: 'crosshatch', label: 'Crosshatch', description: 'Crossing layers of fine lines build the tonal range.' },
  { value: 'woodblock', label: 'Woodblock', description: 'Broad carved bands with irregular edges and stepped tones.' },
  { value: 'risograph', label: 'Risograph', description: 'Two offset ink screens with adjustable registration.' },
  { value: 'pointillism', label: 'Pointillism', description: 'Small pigment strokes mix source colors into the image.' },
] as const satisfies readonly {value:StudioPrintStyle;label:string;description:string}[];
export function isStudioPrintStyle(style: string): style is StudioPrintStyle {
  return STUDIO_PRINT_STYLE_IDS.includes(style as StudioPrintStyle);
}
export interface StudioPrintSettings {
  density: number;
  weight: number;
  angle: number;
  roughness: number;
  invert: boolean;
  secondaryInk: string;
  registration: number;
  seed: number;
}
export const DEFAULT_STUDIO_PRINT: Readonly<StudioPrintSettings> = {
  density: 1, weight: 1, angle: -35, roughness: .35, invert: false,
  secondaryInk: '#ec6752', registration: .2, seed: 7,
};
export function normalizeStudioPrint(input: unknown): StudioPrintSettings {
  const v = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const number = (key: keyof StudioPrintSettings, min: number, max: number) => {
    const value = v[key];
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(min, Math.min(max, value)) : DEFAULT_STUDIO_PRINT[key] as number;
  };
  return {
    density: number('density', 0, 2), weight: number('weight', .25, 2),
    angle: number('angle', -180, 180), roughness: number('roughness', 0, 1),
    invert: v.invert === true,
    secondaryInk: typeof v.secondaryInk === 'string' && /^#[\da-f]{6}$/i.test(v.secondaryInk) ? v.secondaryInk : DEFAULT_STUDIO_PRINT.secondaryInk,
    registration: number('registration', 0, 1), seed: Math.round(number('seed', 0, 65535)),
  };
}
