/** Serializable, media-independent editing state. No DOM work at import time. */
export const STUDIO_STYLES = [
  "ascii",
  "blocks",
  "braille",
  "dots",
  "lines",
  "cross",
  "diagonal",
  "diamond",
  "mixed",
  "pixel",
  "mosaic",
  "lego",
  "voxel",
  "disco",
  "dither",
] as const;
export type StudioStyle = (typeof STUDIO_STYLES)[number];
export const DITHER_ALGORITHMS = [
  "none",
  "bayer2",
  "bayer4",
  "bayer8",
  "bayer16",
  "floyd-steinberg",
  "atkinson",
  "stucki",
  "sierra",
  "sierra-lite",
  "burkes",
  "jarvis",
  "halftone",
  "lines",
  "noise",
] as const;
export type DitherAlgorithm = (typeof DITHER_ALGORITHMS)[number];
export const BLEND_MODES = [
  "source-over",
  "multiply",
  "screen",
  "overlay",
  "soft-light",
  "hard-light",
  "color-dodge",
  "color-burn",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;
export const STUDIO_PALETTES: Record<string, readonly string[]> = {
  original: [],
  mono: ["#080808", "#f2f2e8"],
  asciify: ["#080808", "#625b38", "#a19558", "#e8b900"],
  gameboy: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"],
  cga: ["#000000", "#55ffff", "#ff55ff", "#ffffff"],
  pico8: [
    "#000000",
    "#1d2b53",
    "#7e2553",
    "#008751",
    "#ab5236",
    "#5f574f",
    "#c2c3c7",
    "#fff1e8",
    "#ff004d",
    "#ffa300",
    "#ffec27",
    "#00e436",
    "#29adff",
    "#83769c",
    "#ff77a8",
    "#ffccaa",
  ],
  c64: [
    "#000000",
    "#ffffff",
    "#880000",
    "#aaffee",
    "#cc44cc",
    "#00cc55",
    "#0000aa",
    "#eeee77",
    "#dd8855",
    "#664400",
    "#ff7777",
    "#333333",
    "#777777",
    "#aaff66",
    "#0088ff",
    "#bbbbbb",
  ],
  amber: ["#100b00", "#5f3b00", "#c98014", "#ffd17c"],
  ice: ["#081b29", "#25586e", "#69a6b3", "#d9ece7"],
  risograph: ["#f4ebd0", "#f2594b", "#2853a5", "#29232e"],
  sepia: ["#201b17", "#6b5039", "#b49868", "#f6e6c5"],
  nord: ["#2e3440", "#4c566a", "#88c0d0", "#eceff4"],
  dusk: ["#211b35", "#654271", "#c3788c", "#f5c9a3"],
  forest: ["#101f1b", "#355747", "#87a16f", "#e4e3ba"],
  ocean: ["#071b33", "#17577f", "#3fa7a4", "#d9efde"],
  newsprint: ["#191919", "#666666", "#aaaaaa", "#eee9df"],
  custom: ["#080808", "#e8b900"],
};
export interface StudioMask {
  kind: "rectangle" | "ellipse" | "brush";
  x: number;
  y: number;
  width: number;
  height: number;
  points?: [number, number][];
  size?: number;
}
export interface StudioLight {
  x: number;
  y: number;
  radius: number;
  intensity: number;
  color: string;
}
export interface StudioSettings {
  version: 1;
  aspectRatio: "original" | "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9";
  style: StudioStyle;
  cellSize: number;
  charset: string;
  colorMode: "accent" | "source" | "gray";
  ink: string;
  crop: { x: number; y: number; zoom: number; rotation: number };
  backdrop: {
    mode: "solid" | "transparent" | "source" | "blurred" | "gradient";
    color: string;
    color2: string;
    blur: number;
    opacity: number;
  };
  color: {
    brightness: number;
    contrast: number;
    saturation: number;
    grayscale: number;
    tint: string;
    amount: number;
    blend: (typeof BLEND_MODES)[number];
  };
  dither: {
    algorithm: DitherAlgorithm;
    palette: string;
    colors: string[];
    amount: number;
    scale: number;
    threshold: number;
    motion: "none" | "drift" | "shimmer";
    speed: number;
  };
  mask: { enabled: boolean; invert: boolean; shapes: StudioMask[] };
  lights: StudioLight[];
  effects: {
    bloom: number;
    characterBloom: number;
    grain: number;
    dust: number;
    scanlines: number;
    crt: number;
    prism: number;
    vignette: number;
    glitch: number;
    pixelate: number;
    blur: number;
    blurType: "gaussian" | "directional" | "radial" | "progressive";
    angle: number;
    focus: number;
    halftone: number;
  };
  motion: {
    type:
      | "none"
      | "breathe"
      | "wave"
      | "reveal"
      | "glitch"
      | "rainbow"
      | "hologram"
      | "fire"
      | "chrome"
      | "ripple"
      | "vapor";
    speed: number;
  };
  hover: {
    effect:
      "none" | "trail" | "water" | "contour" | "dissolve" | "silk" | "vortex";
    strength: number;
    radius: number;
    edgeSafe: boolean;
  };
}
export const DEFAULT_STUDIO_SETTINGS: StudioSettings = {
  version: 1,
  aspectRatio: "original",
  style: "ascii",
  cellSize: 7,
  charset: " .:-=+*#%@",
  colorMode: "accent",
  ink: "#e8b900",
  crop: { x: 0.5, y: 0.5, zoom: 1, rotation: 0 },
  backdrop: {
    mode: "solid",
    color: "#080808",
    color2: "#393323",
    blur: 12,
    opacity: 1,
  },
  color: {
    brightness: 0,
    contrast: 1,
    saturation: 1,
    grayscale: 0,
    tint: "#e8b900",
    amount: 0,
    blend: "source-over",
  },
  dither: {
    algorithm: "none",
    palette: "mono",
    colors: ["#080808", "#e8b900"],
    amount: 1,
    scale: 2,
    threshold: 0.5,
    motion: "none",
    speed: 1,
  },
  mask: { enabled: false, invert: false, shapes: [] },
  lights: [],
  effects: {
    bloom: 0,
    characterBloom: 0,
    grain: 0,
    dust: 0,
    scanlines: 0,
    crt: 0,
    prism: 0,
    vignette: 0,
    glitch: 0,
    pixelate: 0,
    blur: 0,
    blurType: "gaussian",
    angle: 0,
    focus: 0.5,
    halftone: 0,
  },
  motion: { type: "none", speed: 1 },
  hover: { effect: "trail", strength: 0.55, radius: 0.2, edgeSafe: false },
};
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const n = (v: unknown, f: number, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.min(max, Math.max(min, v))
    : f;
const color = (v: unknown, f: string) =>
  typeof v === "string" && /^#[\da-f]{6}$/i.test(v) ? v : f;
const choice = <T extends string>(
  v: unknown,
  values: readonly T[],
  fallback: T,
): T => (values.includes(v as T) ? (v as T) : fallback);
/** Whitelist external settings; reject future versions instead of misinterpreting them. */
export function normalizeStudioSettings(input: unknown = {}): StudioSettings {
  const v = record(input),
    d = DEFAULT_STUDIO_SETTINGS;
  if (v.version !== undefined && v.version !== 1)
    throw new Error(
      "Unsupported studio settings version. Update asciify-engine.",
    );
  const c = record(v.crop),
    b = record(v.backdrop),
    g = record(v.color),
    h = record(v.dither),
    m = record(v.mask),
    e = record(v.effects),
    a = record(v.motion),
    p = record(v.hover);
  const fx = { ...d.effects };
  for (const key of [
    "bloom",
    "characterBloom",
    "grain",
    "dust",
    "scanlines",
    "crt",
    "prism",
    "vignette",
    "glitch",
    "pixelate",
    "halftone",
  ] as const)
    fx[key] = n(e[key], 0, 0, 1);
  fx.blur = n(e.blur, 0, 0, 24);
  fx.blurType = choice(
    e.blurType,
    ["gaussian", "directional", "radial", "progressive"],
    d.effects.blurType,
  );
  fx.angle = n(e.angle, 0, -180, 180);
  fx.focus = n(e.focus, 0.5, 0, 1);
  let pointBudget = 2048;
  return {
    version: 1,
    aspectRatio: choice(
      v.aspectRatio,
      ["original", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
      "original",
    ),
    style: choice(v.style, STUDIO_STYLES, d.style),
    cellSize: n(v.cellSize, 7, 3, 60),
    charset:
      typeof v.charset === "string" && v.charset.length
        ? Array.from(v.charset).slice(0, 128).join("")
        : d.charset,
    colorMode: choice(v.colorMode, ["accent", "source", "gray"], d.colorMode),
    ink: color(v.ink, d.ink),
    crop: {
      x: n(c.x, 0.5, 0, 1),
      y: n(c.y, 0.5, 0, 1),
      zoom: n(c.zoom, 1, 1, 5),
      rotation: Math.round(n(c.rotation, 0, -360, 360) / 90) * 90,
    },
    backdrop: {
      mode: choice(
        b.mode,
        ["solid", "transparent", "source", "blurred", "gradient"],
        d.backdrop.mode,
      ),
      color: color(b.color, d.backdrop.color),
      color2: color(b.color2, d.backdrop.color2),
      blur: n(b.blur, 12, 0, 32),
      opacity: n(b.opacity, 1, 0, 1),
    },
    color: {
      brightness: n(g.brightness, 0, -1, 1),
      contrast: n(g.contrast, 1, 0, 3),
      saturation: n(g.saturation, 1, 0, 3),
      grayscale: n(g.grayscale, 0, 0, 1),
      tint: color(g.tint, d.color.tint),
      amount: n(g.amount, 0, 0, 1),
      blend: choice(g.blend, BLEND_MODES, d.color.blend),
    },
    dither: {
      algorithm: choice(h.algorithm, DITHER_ALGORITHMS, "none"),
      palette:
        typeof h.palette === "string" &&
        Object.prototype.hasOwnProperty.call(STUDIO_PALETTES, h.palette)
          ? h.palette
          : "mono",
      colors:
        Array.isArray(h.colors) && h.colors.length >= 2
          ? h.colors.slice(0, 32).map((x) => color(x, "#000000"))
          : [...d.dither.colors],
      amount: n(h.amount, 1, 0, 2),
      scale: Math.round(n(h.scale, 2, 1, 12)),
      threshold: n(h.threshold, 0.5, 0, 1),
      motion: choice(h.motion, ["none", "drift", "shimmer"], "none"),
      speed: n(h.speed, 1, 0.1, 3),
    },
    mask: {
      enabled: m.enabled === true,
      invert: m.invert === true,
      shapes: Array.isArray(m.shapes)
        ? m.shapes.slice(0, 64).map((raw) => {
            const s = record(raw),
              kind = choice(
                s.kind,
                ["rectangle", "ellipse", "brush"],
                "rectangle",
              );
            const points: [number, number][] =
              kind === "brush" && Array.isArray(s.points)
                ? s.points
                    .slice(0, pointBudget)
                    .map((p) =>
                      Array.isArray(p)
                        ? [
                            Math.round(n(p[0], 0, 0, 1) * 10000) / 10000,
                            Math.round(n(p[1], 0, 0, 1) * 10000) / 10000,
                          ]
                        : [0, 0],
                    )
                : [];
            pointBudget -= points.length;
            return {
              kind,
              x: n(s.x, 0, 0, 1),
              y: n(s.y, 0, 0, 1),
              width: n(s.width, 0.5, 0, 1),
              height: n(s.height, 0.5, 0, 1),
              size: n(s.size, 0.05, 0.005, 0.5),
              points,
            };
          })
        : [],
    },
    lights: Array.isArray(v.lights)
      ? v.lights.slice(0, 4).map((raw) => {
          const l = record(raw);
          return {
            x: n(l.x, 0.5, 0, 1),
            y: n(l.y, 0.5, 0, 1),
            radius: n(l.radius, 0.3, 0.02, 1),
            intensity: n(l.intensity, 0.5, 0, 1),
            color: color(l.color, "#ffffff"),
          };
        })
      : [],
    effects: fx,
    motion: {
      type: choice(
        a.type,
        [
          "none",
          "breathe",
          "wave",
          "reveal",
          "glitch",
          "rainbow",
          "hologram",
          "fire",
          "chrome",
          "ripple",
          "vapor",
        ],
        "none",
      ),
      speed: n(a.speed, 1, 0.1, 3),
    },
    hover: {
      effect: choice(
        p.effect,
        ["none", "trail", "water", "contour", "dissolve", "silk", "vortex"],
        "trail",
      ),
      strength: n(p.strength, 0.55, 0, 1),
      radius: n(p.radius, 0.2, 0.1, 1),
      edgeSafe: p.edgeSafe === true,
    },
  };
}
export function serializeStudioSettings(settings: StudioSettings): string {
  return JSON.stringify(normalizeStudioSettings(settings));
}
export function parseStudioSettings(json: string): StudioSettings {
  if (json.length > 100000) throw new Error("Settings exceed 100 KB.");
  return normalizeStudioSettings(JSON.parse(json));
}
export function studioCrop(
  sw: number,
  sh: number,
  w: number,
  h: number,
  c: StudioSettings["crop"],
) {
  const rotated = Math.abs(c.rotation / 90) % 2 === 1;
  const rw = rotated ? sh : sw,
    rh = rotated ? sw : sh;
  const scale = Math.max(w / rw, h / rh) * c.zoom;
  return {
    width: rw * scale,
    height: rh * scale,
    x: (w - rw * scale) * c.x,
    y: (h - rh * scale) * c.y,
    scale,
    rotated,
  };
}

/** Dimensions for the saved canvas ratio, including source rotation. */
export function studioDimensions(
  width: number,
  height: number,
  settings: StudioSettings,
): [number, number] {
  if (Math.abs(settings.crop.rotation / 90) % 2 === 1)
    [width, height] = [height, width];
  if (settings.aspectRatio === "original") return [width, height];
  const [a, b] = settings.aspectRatio.split(":").map(Number);
  return width / height > a / b
    ? [Math.round((height * a) / b), height]
    : [width, Math.round((width * b) / a)];
}

/** Partial configuration for mounting and incremental updates. Arrays replace previous arrays. */
export type StudioInput = {
  [K in keyof StudioSettings]?: StudioSettings[K] extends readonly unknown[]
    ? StudioSettings[K]
    : StudioSettings[K] extends object
      ? Partial<StudioSettings[K]>
      : StudioSettings[K];
};
export function updateStudioSettings(
  current: StudioSettings,
  patch: StudioInput,
): StudioSettings {
  const merged = { ...current, ...patch };
  for (const key of [
    "crop",
    "backdrop",
    "color",
    "dither",
    "mask",
    "effects",
    "motion",
    "hover",
  ] as const) {
    if (patch[key])
      Object.assign(merged, { [key]: { ...current[key], ...patch[key] } });
  }
  return normalizeStudioSettings(merged);
}

/** Effective grid and usable cell-size range at a bounded render resolution.
 * pixelRatio preserves preview density when exporting at a larger resolution.
 */
export function studioGrid(width: number, height: number, settings: Pick<StudioSettings, 'style' | 'cellSize' | 'dither'>, maxCells = 12000, pixelRatio = 1) {
  const w = Math.max(2, Number.isFinite(width) ? width : 960);
  const h = Math.max(2, Number.isFinite(height) ? height : 540);
  const budget = Math.max(1, Math.floor(Number.isFinite(maxCells) ? maxCells : 12000));
  const ratio = Math.max(0.01, Number.isFinite(pixelRatio) ? pixelRatio : 1);
  const aspect = ['dither', 'pixel', 'mosaic', 'lego', 'voxel', 'disco', 'dots'].includes(settings.style) ? 1 : 1.65;
  let minimum = Math.max(1, Math.ceil(Math.sqrt(w * h / (budget * aspect)) / ratio));
  while (Math.ceil(w / (minimum * ratio)) * Math.ceil(h / (minimum * ratio * aspect)) > budget) minimum++;
  const requested = settings.style === 'dither' ? settings.dither.scale : settings.cellSize;
  const cell = Math.max(minimum, requested) * ratio;
  return {cell, rowHeight: cell * aspect, columns: Math.ceil(w / cell), rows: Math.ceil(h / (cell * aspect)), minimum, limited: requested < minimum};
}
