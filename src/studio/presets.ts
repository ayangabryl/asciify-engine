import { normalizeStudioSettings, type StudioSettings } from "./model";
export const STUDIO_LOOKS: {
  id: string;
  name: string;
  description: string;
  settings: StudioSettings;
}[] = [
  // One restrained family: near-black or warm paper grounds, graphite and paper inks, a single muted color at most.
  // Cell sizes match the studio's own per-style defaults, so applying a look never coarsens the image.
  [
    "ascii",
    "Signature ASCII",
    "Clean characters in paper white on near black.",
    {
      cellSize: 4,
      ink: "#ece9e0",
      backdrop: { mode: "solid", color: "#0b0b0a" },
      color: { contrast: 1.25, gamma: 1.25 },
      effects: { characterBloom: 0.12 },
    },
  ],
  [
    "print",
    "Newsprint",
    "Fine diffusion in soft black on warm paper.",
    {
      style: "dither",
      cellSize: 6,
      ink: "#1d1c19",
      backdrop: { mode: "solid", color: "#efece4" },
      dither: {
        algorithm: "floyd-steinberg",
        palette: "custom",
        colors: ["#efece4", "#1d1c19"],
        scale: 2,
      },
    },
  ],
  [
    "handheld",
    "Pocket camera",
    "Four-tone ordered dither in graphite.",
    {
      style: "dither",
      cellSize: 6,
      ink: "#dedbd2",
      backdrop: { mode: "solid", color: "#121211" },
      dither: {
        algorithm: "bayer4",
        palette: "custom",
        colors: ["#121211", "#3e3d39", "#8a8880", "#dedbd2"],
        scale: 2,
      },
    },
  ],
  [
    "riso",
    "Two inks",
    "Muted blue and coral on warm paper.",
    {
      style: "dither",
      cellSize: 6,
      ink: "#3d5068",
      backdrop: { mode: "solid", color: "#f0ece3" },
      dither: {
        algorithm: "atkinson",
        palette: "custom",
        colors: ["#f0ece3", "#c27461", "#3d5068"],
        scale: 2,
      },
    },
  ],
  [
    "night",
    "Night signal",
    "Graphite characters with a faint optical fringe.",
    {
      cellSize: 4,
      ink: "#cdc9be",
      backdrop: { mode: "solid", color: "#0b0b0a" },
      color: { contrast: 1.2, gamma: 1.2 },
      effects: { prism: 0.2, scanlines: 0.08, vignette: 0.3, bloom: 0.12 },
    },
  ],
  [
    "terminal",
    "Phosphor",
    "Soft sage glyphs with a faint glow.",
    {
      cellSize: 5,
      ink: "#a4c9b3",
      backdrop: { mode: "solid", color: "#0a0d0b" },
      effects: { bloom: 0.16, scanlines: 0.12, crt: 0.06 },
    },
  ],
  [
    "mosaic",
    "Mosaic study",
    "Separated tiles in quiet source color.",
    {
      style: "mosaic",
      ink: "#e6e3da",
      cellSize: 9,
      colorMode: "source",
      backdrop: { mode: "solid", color: "#0b0b0a" },
      color: { saturation: 0.55, contrast: 1.05 },
    },
  ],
  [
    "bricks",
    "Brickwork",
    "Studded cells in softened color.",
    {
      style: "lego",
      ink: "#e6e3da",
      cellSize: 12,
      colorMode: "source",
      backdrop: { mode: "solid", color: "#0b0b0a" },
      color: { saturation: 0.55 },
    },
  ],
  [
    "voxel",
    "Little volumes",
    "Three-face isometric tiles in muted color.",
    {
      style: "voxel",
      ink: "#e6e3da",
      cellSize: 12,
      colorMode: "source",
      backdrop: { mode: "solid", color: "#0b0b0a" },
      color: { saturation: 0.5 },
    },
  ],
  [
    "disco",
    "Mirror room",
    "Faceted tiles under one soft light.",
    {
      style: "disco",
      ink: "#e6e3da",
      cellSize: 11,
      colorMode: "source",
      backdrop: { mode: "solid", color: "#0b0b0a" },
      color: { saturation: 0.5 },
      lights: [
        { x: 0.35, y: 0.25, radius: 0.28, intensity: 0.28, color: "#f4efe4" },
      ],
    },
  ],
  [
    "wallpaper",
    "Wallpaper",
    "Living ASCII over a softened source.",
    {
      cellSize: 5,
      backdrop: { mode: "blurred", color: "#0b0b0a", blur: 18, opacity: 0.4 },
      ink: "#e6e3da",
      motion: { type: "caustics", speed: 0.35 },
    },
  ],
  [
    "blueprint",
    "Blueprint",
    "Fine linework in pale blue on deep navy.",
    {
      style: "lines",
      cellSize: 6,
      ink: "#b3c9d8",
      backdrop: { mode: "solid", color: "#0e1b28" },
    },
  ],
].map(([id, name, description, settings]) => ({
  id: id as string,
  name: name as string,
  description: description as string,
  settings: normalizeStudioSettings(settings),
}));
/** Return independent state; applying or editing a look never mutates its preset. */
export function studioLook(id: string): StudioSettings {
  const look = STUDIO_LOOKS.find((l) => l.id === id);
  if (!look) throw new Error("Unknown studio look.");
  return normalizeStudioSettings(look.settings);
}
export function restyleStudio(
  current: StudioSettings,
  random = Math.random,
): StudioSettings {
  const candidates = STUDIO_LOOKS.filter(
    (l) => l.settings.style !== current.style || l.settings.ink !== current.ink,
  );
  const index = Math.min(
    candidates.length - 1,
    Math.max(0, Math.floor(random() * candidates.length)),
  );
  const next = studioLook(candidates[index].id);
  next.aspectRatio = current.aspectRatio;
  next.crop = { ...current.crop };
  next.mask = normalizeStudioSettings(current).mask;
  return next;
}
