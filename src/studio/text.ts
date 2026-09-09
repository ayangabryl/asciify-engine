/** Fonts are loaded individually only when selected; none enter the core renderer. */
const loaders = {
  Standard: () => import("figlet/fonts/Standard"),
  Slant: () => import("figlet/fonts/Slant"),
  Small: () => import("figlet/fonts/Small"),
  Big: () => import("figlet/fonts/Big"),
  Banner: () => import("figlet/fonts/Banner"),
  Block: () => import("figlet/fonts/Block"),
  Bubble: () => import("figlet/fonts/Bubble"),
  Digital: () => import("figlet/fonts/Digital"),
  Doom: () => import("figlet/fonts/Doom"),
  Lean: () => import("figlet/fonts/Lean"),
  Mini: () => import("figlet/fonts/Mini"),
  Script: () => import("figlet/fonts/Script"),
  Shadow: () => import("figlet/fonts/Shadow"),
  Speed: () => import("figlet/fonts/Speed"),
  Starwars: () => import("figlet/fonts/Star Wars"),
  Stop: () => import("figlet/fonts/Stop"),
  Straight: () => import("figlet/fonts/Straight"),
  Thin: () => import("figlet/fonts/Thin"),
  ThreeD: () => import("figlet/fonts/3-D"),
  Univers: () => import("figlet/fonts/Univers"),
  Wavy: () => import("figlet/fonts/Wavy"),
};
export const STUDIO_TEXT_FONTS = Object.keys(
  loaders,
) as (keyof typeof loaders)[];
export async function createStudioText(
  text: string,
  font: keyof typeof loaders = "Standard",
  ink = "#ffffff",
) {
  if (!Object.prototype.hasOwnProperty.call(loaders, font))
    throw new Error("Unknown text font.");
  const { default: figlet } = await import("figlet/browser");
  const data = await loaders[font]();
  figlet.parseFont(font, data.default);
  figlet.defaults({ fetchFontIfMissing: false });
  const ascii = figlet.textSync(text.slice(0, 120), { font: font as never }),
    lines = ascii.split("\n");
  const cols = Math.max(1, ...lines.map((l) => l.length)),
    rows = Math.max(1, lines.length),
    scale = Math.min(1, 2048 / (cols * 9));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(cols * 9 * scale + 32);
  canvas.height = Math.ceil(rows * 15 * scale + 32);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#080808";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = ink;
  ctx.font = `${15 * scale}px monospace`;
  ctx.textBaseline = "top";
  lines.forEach((line, i) => ctx.fillText(line, 16, 16 + i * 15 * scale));
  return { canvas, ascii };
}
