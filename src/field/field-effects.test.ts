import { describe, expect, it, vi } from 'vitest';
import { defineFieldEffect, effectSource, effectUniforms, MAX_FIELD_EFFECTS } from './field-effects';
import { fieldCellShader } from './field-shaders';

const swell = () => defineFieldEffect({
  name: 'swell',
  params: { radius: 0.2, strength: 0.8 },
  shade: 'float d=distance(uv*vec2(aspect,1.),pointer*vec2(aspect,1.));float k=smoothstep(params.radius,0.,d)*params.strength*pointerOn;tone+=k;glyph+=k*2.;',
});

describe('field effects', () => {
  it('validates names, params and snippets', () => {
    expect(() => defineFieldEffect({ name: 'has space', shade: 'tone+=.1;' })).toThrow(/name/);
    expect(() => defineFieldEffect({ name: 'x', shade: '' })).toThrow(/displace or a shade/);
    expect(() => defineFieldEffect({ name: 'x', shade: 'tone+=.1;}' })).toThrow(/braces/);
    expect(() => defineFieldEffect({ name: 'x', shade: '#version 300 es' })).toThrow(/statements/);
    expect(() => defineFieldEffect({ name: 'x', params: { 'bad-key': 1 }, shade: 'tone+=.1;' })).toThrow(/param name/);
    expect(() => defineFieldEffect({ name: 'x', params: { float: 1 }, shade: 'tone+=.1;' })).toThrow(/param name/);
    expect(() => defineFieldEffect({ name: 'x', params: { a: Number.NaN }, shade: 'tone+=.1;' })).toThrow(/finite/);
    expect(() => defineFieldEffect({ name: 'x', params: Object.fromEntries('abcdefghi'.split('').map(k => [k, 0])), shade: 'tone+=.1;' })).toThrow(/limit/);
  });

  it('redraws subscribed fields when a param changes, and only then', () => {
    const effect = swell(), redraw = vi.fn();
    const stop = effect.subscribe(redraw);
    effect.params.strength = 0.5;
    effect.params.strength = 0.5;
    expect(redraw).toHaveBeenCalledTimes(1);
    // Other keys (an animation library's bookkeeping) are kept and draw nothing.
    (effect.params as Record<string, unknown>)._gsap = {};
    expect(redraw).toHaveBeenCalledTimes(1);
    stop();
    effect.params.radius = 0.3;
    expect(redraw).toHaveBeenCalledTimes(1);
  });

  it('packs params two vec4s per effect, in order', () => {
    const a = swell(), b = defineFieldEffect({ name: 'b', params: { p0: 1, p1: 2, p2: 3, p3: 4, p4: 5 }, displace: 'at.x+=params.p4*0.;' });
    const data = effectUniforms([a, b]);
    expect([...data.slice(0, 2)].map(v => +v.toFixed(3))).toEqual([0.2, 0.8]);
    expect([...data.slice(8, 13)]).toEqual([1, 2, 3, 4, 5]);
    expect(data.length).toBe(MAX_FIELD_EFFECTS * 8);
  });

  it('leaves the field program unchanged without effects', () => {
    expect(fieldCellShader(false, [])).toBe(fieldCellShader(false));
    expect(effectSource([])).toBeNull();
  });

  it('splices each hook once, in its own block, reading its own params', () => {
    const a = swell(), b = defineFieldEffect({ name: 'pull', params: { pull: 0.1 }, displace: 'at+=(pointer-uv)*params.pull*pointerOn;' });
    const code = fieldCellShader(false, [a, b]);
    expect(code.match(/uniform vec4 uFx\[/g)).toHaveLength(1);
    expect(code).toContain('struct Fx0Params{float radius;float strength;};');
    expect(code).toContain('Fx1Params params=Fx1Params(uFx[2].x);');
    // displace runs between the sampling position and the sample; shade before the clear zones.
    const sample = code.indexOf('vec2 sampleAt='), displace = code.indexOf('effect "pull"'), read = code.indexOf('textureLod(uSource,s,uLod)');
    expect(sample).toBeLessThan(displace);
    expect(displace).toBeLessThan(read);
    const shade = code.indexOf('effect "swell"'), vignette = code.indexOf('tone*=1.-uVignette'), clear = code.indexOf('if(uClear.z>0.)');
    expect(shade).toBeLessThan(vignette);
    expect(vignette).toBeLessThan(clear);
    expect(code).toContain('ink=mix(ink,clamp(fxInk,0.,1.),clamp(fxInkAmount,0.,1.));');
  });
});
