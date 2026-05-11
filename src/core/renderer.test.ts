import { describe, expect, it } from 'vitest';
import { CHARSETS, DEFAULT_OPTIONS } from '../types';
import { renderTextFrameToCanvas, type AsciiTextFrame } from './renderer';

function createRecordingContext() {
  const calls: string[] = [];
  const ctx = {
    canvas: {},
    clearRect: () => {},
    fillRect: () => {},
    fillText: (text: string) => { calls.push(text); },
    fillStyle: '',
    font: '',
    globalAlpha: 1,
    textAlign: '',
    textBaseline: '',
  };
  return { calls, ctx: ctx as unknown as CanvasRenderingContext2D };
}

describe('renderTextFrameToCanvas', () => {
  it('renders emoji charset rows as complete glyphs in fullcolor mode', () => {
    Object.assign(globalThis, {
      document: { documentElement: { parentElement: null } },
      getComputedStyle: () => ({ backgroundColor: 'rgb(0, 0, 0)' }),
      matchMedia: () => ({ matches: true }),
    });

    const glyphs = [...CHARSETS.emoji].slice(1, 6);
    const colors = new Uint8ClampedArray(glyphs.length * 4);
    for (let index = 0; index < glyphs.length; index++) {
      colors[index * 4] = 240;
      colors[index * 4 + 1] = 230;
      colors[index * 4 + 2] = 210;
      colors[index * 4 + 3] = 255;
    }

    const frame: AsciiTextFrame = {
      cols: glyphs.length,
      rowCount: 1,
      rows: [glyphs.join('')],
      colors,
    };
    const { calls, ctx } = createRecordingContext();

    renderTextFrameToCanvas(ctx, frame, {
      ...DEFAULT_OPTIONS,
      charset: CHARSETS.emoji,
      colorMode: 'fullcolor',
    }, 120, 20);

    expect(calls).toEqual([glyphs.join('')]);
  });

  it('renders combined grapheme charsets without splitting code units', () => {
    Object.assign(globalThis, {
      document: { documentElement: { parentElement: null } },
      getComputedStyle: () => ({ backgroundColor: 'rgb(0, 0, 0)' }),
      matchMedia: () => ({ matches: true }),
    });

    const glyphs = ['👩‍💻', '🏳️‍🌈', '5️⃣', 'é'];
    const colors = new Uint8ClampedArray(glyphs.length * 4);
    for (let index = 0; index < glyphs.length; index++) {
      colors[index * 4] = 240;
      colors[index * 4 + 1] = 230;
      colors[index * 4 + 2] = 210;
      colors[index * 4 + 3] = 255;
    }

    const frame: AsciiTextFrame = {
      cols: glyphs.length,
      rowCount: 1,
      rows: [glyphs.join('')],
      colors,
    };
    const { calls, ctx } = createRecordingContext();

    renderTextFrameToCanvas(ctx, frame, {
      ...DEFAULT_OPTIONS,
      charset: ` ${glyphs.join('')}`,
      colorMode: 'fullcolor',
    }, 120, 20);

    expect(calls).toEqual([glyphs.join('')]);
  });
});
