import { describe, expect, it } from 'vitest';
import { defineAsciifyField, readFieldAttribute } from './element';

describe('<asciify-field>', () => {
  it('reads attribute values as field options', () => {
    expect(readFieldAttribute('')).toBe(true);
    expect(readFieldAttribute('false')).toBe(false);
    expect(readFieldAttribute('12')).toBe(12);
    expect(readFieldAttribute('-0.5')).toBe(-0.5);
    expect(readFieldAttribute('1e2')).toBe(100);
    expect(readFieldAttribute('{"radius":0.2}')).toEqual({ radius: 0.2 });
    expect(readFieldAttribute('[1,2]')).toEqual([1, 2]);
    expect(readFieldAttribute('{not json')).toBe('{not json');
    expect(readFieldAttribute('#ff0000')).toBe('#ff0000');
    expect(readFieldAttribute(' .:-=+*#%@')).toBe(' .:-=+*#%@');
  });
  it('defines nothing where there is no DOM', () => {
    expect(defineAsciifyField()).toBe(false);
  });
});
