import { normalizeStudioSettings, type StudioSettings } from "./model";
export const STUDIO_LOOKS: {
  id: string;
  name: string;
  description: string;
  settings: StudioSettings;
}[] = [
  ["ascii", "Signature ASCII", "Brand ink and clean characters.", {}],
  [
    "print",
    "Newsprint",
    "Fine diffusion on warm paper.",
    {
      style: "dither",
      dither: { algorithm: "floyd-steinberg", palette: "newsprint" },
    },
  ],
  [
    "handheld",
    "Pocket camera",
    "Four-tone ordered dither.",
    {
      style: "dither",
      dither: { algorithm: "bayer4", palette: "gameboy", scale: 3 },
    },
  ],
  [
    "riso",
    "Two inks",
    "Limited-color print texture.",
    {
      style: "dither",
      dither: { algorithm: "atkinson", palette: "risograph", scale: 2 },
    },
  ],
  [
    "night",
    "Night signal",
    "Gray characters and optical fringe.",
    { ink: "#888888", effects: { prism: 0.7, scanlines: 0.2, vignette: 0.3 } },
  ],
  [
    "terminal",
    "Phosphor",
    "Green glyphs with a soft glow.",
    { ink: "#83efad", effects: { bloom: 0.4, scanlines: 0.35, crt: 0.2 } },
  ],
  [
    "mosaic",
    "Mosaic study",
    "Separated color tiles.",
    { style: "mosaic", cellSize: 14, colorMode: "source" },
  ],
  [
    "bricks",
    "Brickwork",
    "Colorful studded cells.",
    { style: "lego", cellSize: 18, colorMode: "source" },
  ],
  [
    "voxel",
    "Little volumes",
    "Three-face isometric tiles.",
    { style: "voxel", cellSize: 22, colorMode: "source" },
  ],
  [
    "disco",
    "Mirror room",
    "Faceted tiles and warm light.",
    {
      style: "disco",
      cellSize: 18,
      colorMode: "source",
      lights: [
        { x: 0.35, y: 0.25, radius: 0.25, intensity: 0.45, color: "#fff2d4" },
      ],
    },
  ],
  [
    "wallpaper",
    "Wallpaper",
    "Living ASCII over a softened source.",
    {
      backdrop: { mode: "blurred", blur: 18, opacity: 0.55 },
      ink: "#f2e9c9",
      motion: { type: "caustics", speed: 0.5 },
    },
  ],
  [
    "blueprint",
    "Blueprint",
    "Linework in a cool monochrome.",
    {
      style: "lines",
      ink: "#9bccdf",
      backdrop: { mode: "solid", color: "#0a1e30" },
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
