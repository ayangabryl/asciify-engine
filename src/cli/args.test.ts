import { describe, expect, it } from 'vitest';
import { CliError, formatOf, parseArgs } from './args';

describe('command-line flags', () => {
  it('reads an input, sizes, modes and formats', () => {
    const o = parseArgs(['photo.jpg', '-w', '120', '--height=40', '--half', '--color', '-o', 'out.svg', '--title', 'A photo']);
    expect(o).toMatchObject({ input: 'photo.jpg', width: 120, height: 40, mode: 'half', color: true, output: 'out.svg', title: 'A photo' });
    expect(parseArgs(['-', '--braille']).input).toBe('-');
    expect(parseArgs(['x.png', '-m', 'sextant']).mode).toBe('sextant');
    expect(parseArgs(['x.png', '--no-color', '--256']).color).toBe(false);
    expect(parseArgs(['x.png', '--256']).colorDepth).toBe('256');
    expect(parseArgs(['x.png', '--dither', 'none']).dither).toBe(false);
  });
  it('takes --spin with or without a speed', () => {
    expect(parseArgs(['m.glb', '--spin']).spin).toBe(30);
    expect(parseArgs(['m.glb', '--spin', '-o', 'x.svg']).spin).toBe(30);
    expect(parseArgs(['m.glb', '--spin', '90']).spin).toBe(90);
    expect(parseArgs(['m.glb', '--spin', '-45']).spin).toBe(-45);
  });
  it('says what is wrong with a bad flag or value', () => {
    expect(() => parseArgs(['x.png', '--nope'])).toThrow(CliError);
    expect(() => parseArgs(['x.png', '-w', 'wide'])).toThrow(/-w takes a number from 1 to 2000/);
    expect(() => parseArgs(['x.png', '--mode', 'blocks'])).toThrow(/--mode is one of/);
    expect(() => parseArgs(['a.png', 'b.png'])).toThrow(/One input at a time/);
    expect(() => parseArgs(['x.png', '--paint', 'red'])).toThrow(/hex colour/);
    expect(() => parseArgs(['x.png', '-o'])).toThrow(/needs a value/);
  });
  it('picks the format from a file name', () => {
    expect(formatOf('a.svg')).toBe('svg');
    expect(formatOf('a.HTML')).toBe('html');
    expect(formatOf('a.ans')).toBe('ansi');
    expect(formatOf('a.json')).toBe('json');
    expect(formatOf('a.txt')).toBe('text');
    expect(formatOf('a.png')).toBeNull();
  });
});
