// @ts-ignore The engine has no Node types; Vitest runs this in Node.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIELD_COMPOSITE, fieldCellShader, fieldFluidShader } from './field-shaders';
import { FIELD_MARKS } from './field-model';

// Uniform locations are read from the linked program, so a misspelt name would be silently ignored by WebGL.
const declared = (shader: string) => new Set([...shader.matchAll(/uniform\s+\w+\s+([^;]+);/g)].flatMap(([, names]) => names.split(',').map(name => name.trim().replace(/\[\d+\]$/, ''))));
const used = (code: string, object: string) => new Set([...code.matchAll(new RegExp(`\\b${object}\\.(u[A-Z]\\w*)`, 'g'))].map(([, name]) => name));
const field = readFileSync(new URL('./glyph-field.ts', import.meta.url), 'utf8');
const draw = field.slice(field.indexOf('const draw = () =>'), field.indexOf('const live = () =>'));
const fluid = field.slice(field.indexOf('const stepFluid ='), field.indexOf('const draw = () =>'));

describe('glyph field programs', () => {
  it('sets every uniform the cell pass declares, by its declared name', () => {
    const names = declared(fieldCellShader(false));
    expect([...used(draw, 'u')].filter(name => !names.has(name))).toEqual([]);
    expect([...names].filter(name => !used(draw, 'u').has(name))).toEqual([]);
  });
  it('sets every uniform the pixel pass declares, by its declared name', () => {
    const names = declared(FIELD_COMPOSITE);
    expect([...used(draw, 'p')].filter(name => !names.has(name))).toEqual([]);
    expect([...names].filter(name => !used(draw, 'p').has(name))).toEqual([]);
  });
  it('sets every uniform the single-pass wake declares', () => {
    const names = declared(fieldFluidShader(true));
    expect([...used(fluid, 'at')].filter(name => !names.has(name))).toEqual([]);
    expect([...names].filter(name => !used(fluid, 'at').has(name))).toEqual([]);
  });
  it('draws every mark in one branch of the pixel pass, indexed as FIELD_MARKS orders them', () => {
    const branches = new Set([...FIELD_COMPOSITE.matchAll(/uMark==(\d+)/g)].map(([, n]) => Number(n)));
    for (let i = 0; i < FIELD_MARKS.length; i++) expect(branches.has(i)).toBe(true);
    expect(Math.max(...branches)).toBe(FIELD_MARKS.length - 1);
    expect(draw).toContain('gl.uniform1i(p.uMark, FIELD_MARKS.indexOf(settings.mark))');
    expect(draw).toContain('gl.uniform1i(u.uMark, FIELD_MARKS.indexOf(settings.mark))');
    // No mark samples anything but its own cell, so styles cost no extra passes or textures.
    expect(FIELD_COMPOSITE.match(/texelFetch\(uCells/g)).toHaveLength(1);
  });
  it('writes ink and what lies under it from the cell pass, which the pixel pass reads per cell', () => {
    for (const packed of [false, true]) {
      const cell = fieldCellShader(packed);
      expect(cell).toContain('layout(location=0) out vec4 outInk;');
      expect(cell).toContain('layout(location=1) out vec4 outUnder;');
      expect(cell).not.toContain('uAtlas');
    }
    expect(FIELD_COMPOSITE).toContain('texelFetch(uCells,ivec2(cell),0)');
    expect(FIELD_COMPOSITE).not.toMatch(/fbm|textureLod/);
  });
});
