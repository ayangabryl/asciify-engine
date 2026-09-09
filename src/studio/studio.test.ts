import { describe, it, expect } from "vitest";
import {
  normalizeStudioSettings,
  parseStudioSettings,
  serializeStudioSettings,
  studioDimensions,
  studioCrop,
  studioGrid,
  updateStudioSettings,
  DITHER_ALGORITHMS,
  STUDIO_PALETTES,
} from "./model";
import { bayer, ditherPixels, rgb } from "./dither";
import { STUDIO_LOOKS, studioLook, restyleStudio } from "./presets";

describe("Studio project interchange", () => {
  it("merges partial updates without resetting unrelated choices", () => {
    const first = normalizeStudioSettings({
      ink: "#112233",
      crop: { zoom: 2, x: 0.3 },
      lights: [{ x: 0.2 }],
    });
    const next = updateStudioSettings(first, { crop: { x: 0.8 }, lights: [] });
    expect(next.crop.zoom).toBe(2);
    expect(next.crop.x).toBe(0.8);
    expect(next.ink).toBe("#112233");
    expect(next.lights).toEqual([]);
    expect(first.lights).toHaveLength(1);
  });
  it("preserves composition, masks, palettes and effects without media URLs", () => {
    const settings = normalizeStudioSettings({
      aspectRatio: "9:16",
      crop: { rotation: 90, zoom: 2, x: 0.2 },
      mask: {
        enabled: true,
        shapes: [
          {
            kind: "brush",
            points: [
              [0.1, 0.2],
              [0.3, 0.4],
            ],
            size: 0.1,
          },
        ],
      },
      dither: { palette: "custom", colors: ["#112233", "#abcdef"] },
      effects: { prism: 0.6, blur: 4 },
    });
    expect(parseStudioSettings(serializeStudioSettings(settings))).toEqual(
      settings,
    );
    expect(studioDimensions(1920, 1080, settings)).toEqual([1080, 1920]);
  });
  it("rejects future schemas and oversized imports", () => {
    expect(() => normalizeStudioSettings({ version: 2 })).toThrow(/Update/);
    expect(() => parseStudioSettings(" ".repeat(100001))).toThrow(/100 KB/);
  });
  it("whitelists input, bounds expensive options, and creates independent defaults", () => {
    const a = normalizeStudioSettings({
        mediaUrl: "secret",
        cellSize: NaN,
        dither: { palette: "__proto__" },
        lights: Array(200).fill({ intensity: 9 }),
        effects: { blur: 999 },
        hover: { radius: -2 },
      }),
      b = normalizeStudioSettings();
    expect(a).not.toHaveProperty("mediaUrl");
    expect(a.cellSize).toBe(6);
    expect(a.dither.palette).toBe("mono");
    expect(a.lights).toHaveLength(4);
    expect(a.effects.blur).toBe(24);
    expect(a.hover.radius).toBe(0.1);
    a.dither.colors[0] = "#ffffff";
    expect(b.dither.colors[0]).toBe("#080808");
  });
  it("covers and anchors rotated media without blank crop edges", () => {
    const c = studioCrop(1920, 1080, 500, 500, {
      x: 1,
      y: 0,
      rotation: 90,
      zoom: 2,
    });
    expect(c.width).toBe(1000);
    expect(c.height).toBeCloseTo(1777.777);
    expect(c.x).toBe(-500);
    expect(c.y).toBeCloseTo(0);
  });
  it("ships distinct valid presets and restyles without losing composition", () => {
    const looks = STUDIO_LOOKS.map((l) => studioLook(l.id));
    expect(new Set(looks.map(serializeStudioSettings)).size).toBe(looks.length);
    const original = normalizeStudioSettings({
        crop: { zoom: 3 },
        mask: { enabled: true, shapes: [{ kind: "ellipse" }] },
      }),
      next = restyleStudio(original);
    expect(next.crop).toEqual(original.crop);
    expect(next.mask).toEqual(original.mask);
  });
});
describe("Dither kernels", () => {
  it("has standard dispersed Bayer order at every size", () => {
    const values = Array.from({ length: 16 }, (_, i) =>
      Math.round((bayer(i % 4, Math.floor(i / 4), 4) + 0.5) * 16 - 0.5),
    );
    expect(values).toEqual([
      0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5,
    ]);
    for (const size of [2, 4, 8, 16]) {
      const map = Array.from({ length: size * size }, (_, i) =>
        bayer(i % size, Math.floor(i / size), size),
      );
      expect(new Set(map).size).toBe(size * size);
      expect(map.reduce((a, b) => a + b, 0)).toBeCloseTo(0);
    }
  });
  const ramp = () => {
    const data = new Uint8ClampedArray(64 * 32 * 4);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 64; x++) {
        const i = (y * 64 + x) * 4;
        data[i] = x * 4;
        data[i + 1] = y * 8;
        data[i + 2] = (x + y) * 2;
        data[i + 3] = x === 0 ? 0 : 255;
      }
    return data;
  };
  it("keeps palette membership, alpha and deterministic results for every algorithm", () => {
    const outputs = new Set<string>();
    for (const algorithm of DITHER_ALGORITHMS) {
      const settings = normalizeStudioSettings({
          dither: { algorithm, palette: "gameboy" },
        }),
        a = ramp(),
        b = ramp();
      ditherPixels(a, 64, 32, settings.dither);
      ditherPixels(b, 64, 32, settings.dither);
      expect(a).toEqual(b);
      const palette = STUDIO_PALETTES.gameboy.map((c) => rgb(c).join(","));
      for (let i = 0; i < a.length; i += 4) {
        expect(a[i + 3]).toBe((i / 4) % 64 === 0 ? 0 : 255);
        if (a[i + 3])
          expect(palette).toContain(Array.from(a.slice(i, i + 3)).join(","));
      }
      outputs.add(Array.from(a).join(","));
    }
    expect(outputs.size).toBe(DITHER_ALGORITHMS.length);
  });
  it("supports narrow images and animated ordered thresholds without changing static output", () => {
    for (const algorithm of DITHER_ALGORITHMS) {
      const data = new Uint8ClampedArray([
        120, 80, 60, 255, 190, 220, 200, 255,
      ]);
      expect(() =>
        ditherPixels(
          data,
          1,
          2,
          normalizeStudioSettings({ dither: { algorithm } }).dither,
        ),
      ).not.toThrow();
    }
    const a = ramp(),
      b = ramp(),
      settings = normalizeStudioSettings({
        dither: { algorithm: "bayer8", motion: "drift" },
      });
    ditherPixels(a, 64, 32, settings.dither, 0);
    ditherPixels(b, 64, 32, settings.dither, 1);
    expect(a).not.toEqual(b);
  });
});

describe('Studio cell size', () => {
  it('provides distinct usable sizes and stays within the cell budget', () => {
    for (const style of ['ascii', 'dots', 'dither'] as const) {
      const settings = normalizeStudioSettings({style});
      const minimum = studioGrid(960, 540, settings).minimum;
      let previous = Infinity;
      for (let size = minimum; size <= 40; size++) {
        const grid = studioGrid(960, 540, {...settings, cellSize: size, dither: {...settings.dither, scale: size}});
        expect(grid.columns * grid.rows).toBeLessThanOrEqual(12000);
        expect(grid.cell).toBe(size);
        expect(grid.columns * grid.rows).toBeLessThanOrEqual(previous);
        previous = grid.columns * grid.rows;
      }
    }
  });
  it('uses dither scale and preserves the same grid for upscaled exports', () => {
    const settings = normalizeStudioSettings({style:'dither', cellSize:40, dither:{scale:2}});
    const preview = studioGrid(960,540,settings);
    const exportGrid = studioGrid(1920,1080,settings,12000,2);
    expect(preview.limited).toBe(true);
    expect(preview.columns).toBe(exportGrid.columns);
    expect(preview.rows).toBe(exportGrid.rows);
    expect(exportGrid.cell).toBe(preview.cell*2);
    expect(studioGrid(960,540,{...settings,dither:{...settings.dither,scale:12}}).cell).toBe(12);
  });
});

it('keeps sampling density unchanged when only raster sharpness increases', () => {
  const settings = normalizeStudioSettings();
  for (const scale of [.5, 1.5, 2]) {
    const logical = studioGrid(960, 540, settings, 12000);
    const raster = studioGrid(960 * scale, 540 * scale, settings, 12000, scale);
    expect([raster.columns, raster.rows]).toEqual([logical.columns, logical.rows]);
    expect(raster.minimum).toBe(logical.minimum);
    expect(raster.columns * raster.rows).toBeLessThanOrEqual(12000);
  }
});
