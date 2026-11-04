/**
 * Custom effects: a few lines of GLSL that a glyph field runs for every cell, every frame, alongside its own hovers. An effect
 * can move where a cell samples the picture (`displace`), and change its tone, its step along the charset and its ink (`shade`).
 * The field keeps everything else: the atlas, sizing, the pointer, clear zones, reduced motion and cleanup.
 */

/** Numeric parameters an effect reads as `params.<name>`. Up to eight per effect. */
export type FieldEffectParams = Record<string, number>;

export interface FieldEffectSpec<P extends FieldEffectParams = FieldEffectParams> {
  /** A name for errors and the devtools; letters, digits and dashes. */
  name: string;
  /** Starting values. Assign `effect.params.<name>` (or tween it with GSAP or Motion) and every field using the effect redraws. */
  params?: P;
  /**
   * GLSL run before the cell samples its source. Reads the inputs below and may write `at`, the vec2 position sampled
   * (the same 0–1 space as `uv`). Example: `at += (pointer - uv) * params.pull * pointerOn;`
   */
  displace?: string;
  /**
   * GLSL run after the field's own hovers and pulses, before its clear zones and vignette (so content stays readable).
   * May write `tone` (0–1), `glyph` (whole steps along the charset, added to the cell's own), `ink` (vec3, 0–1) with
   * `inkAmount` (0–1, how much of `ink` replaces the field's colour).
   */
  shade?: string;
  /** True when the effect moves on its own over `time`; the field then keeps drawing while motion is allowed. Default false. */
  animate?: boolean;
}

/**
 * The GLSL inputs every effect reads:
 * - `uv` vec2: the cell's centre, 0–1 across the field from its top-left corner.
 * - `cell` vec2: the cell's column and row.
 * - `aspect` float: field width over height. Multiply x offsets by it for round shapes.
 * - `time` float: seconds of field motion; it stands still under reduced motion and while paused.
 * - `pointer` vec2: the pointer in the same space as `uv`; `pointerOn` float 0–1 eases in when it arrives and out when it leaves.
 * - `color` vec3 (in `shade`): the source colour sampled for this cell, or the generated scene's.
 * - `motion` float: 1 when motion is allowed, 0 under reduced motion.
 * - `hash(vec2)`, `noise(vec2)` and `fbm(vec2)`: the field's value noise, 0–1.
 */
export interface FieldEffect<P extends FieldEffectParams = FieldEffectParams> {
  readonly name: string;
  /** Live parameters: setting one redraws every field that uses the effect. */
  readonly params: P;
  readonly displace: string;
  readonly shade: string;
  readonly animate: boolean;
  /** Called with a redraw function for each field that mounts the effect; returns the unsubscribe. Used by the field. */
  subscribe(redraw: () => void): () => void;
}

export const MAX_FIELD_EFFECTS = 4;
export const MAX_EFFECT_PARAMS = 8;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
// GLSL reserves these words, and the generated struct must not reuse them as member names.
const RESERVED = new Set(['in', 'out', 'inout', 'uniform', 'float', 'int', 'bool', 'vec2', 'vec3', 'vec4', 'if', 'else', 'for', 'while', 'return', 'struct', 'const', 'discard', 'break', 'continue', 'true', 'false', 'void', 'main', 'mat2', 'mat3', 'mat4', 'highp', 'mediump', 'lowp', 'precision', 'sampler2D', 'layout', 'switch', 'case', 'default', 'do']);

/**
 * Defines a custom field effect. Pass it to `mountGlyphField(canvas, { effects: [effect] })` or `field.update({ effects })`.
 * @experimental Its GLSL inputs and outputs may gain members in a minor release; see STABILITY.md.
 */
export function defineFieldEffect<P extends FieldEffectParams = FieldEffectParams>(spec: FieldEffectSpec<P>): FieldEffect<P> {
  const name = String(spec.name ?? '').trim();
  if (!/^[\w-]+$/.test(name)) throw new Error(`A field effect needs a name of letters, digits and dashes (got "${spec.name}").`);
  const initial = { ...(spec.params ?? {}) } as P;
  const keys = Object.keys(initial);
  if (keys.length > MAX_EFFECT_PARAMS) throw new Error(`Field effect "${name}" has ${keys.length} params; the limit is ${MAX_EFFECT_PARAMS}.`);
  for (const key of keys) {
    if (!IDENTIFIER.test(key) || RESERVED.has(key)) throw new Error(`Field effect "${name}": "${key}" cannot be a param name; use a plain identifier.`);
    if (typeof initial[key] !== 'number' || !Number.isFinite(initial[key])) throw new Error(`Field effect "${name}": param "${key}" must be a finite number.`);
  }
  const displace = spec.displace?.trim() ?? '', shade = spec.shade?.trim() ?? '';
  if (!displace && !shade) throw new Error(`Field effect "${name}" needs a displace or a shade snippet.`);
  for (const code of [displace, shade]) {
    // Snippets are statements inside a block; a stray brace or a version line would break the whole program.
    let depth = 0;
    for (const char of code) { if (char === '{') depth++; else if (char === '}' && --depth < 0) break; }
    if (depth !== 0) throw new Error(`Field effect "${name}" has unbalanced braces.`);
    if (/#\s*version|\bvoid\s+main\b/.test(code)) throw new Error(`Field effect "${name}": a snippet is statements, not a whole shader.`);
  }
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(redraw => redraw());
  const params = new Proxy(initial, {
    set(target, key, value) {
      // Animation libraries keep their own bookkeeping on the object they tween (GSAP's `_gsap`): kept, but it draws nothing.
      if (typeof key !== 'string' || !keys.includes(key)) return Reflect.set(target, key, value);
      const next = Number(value);
      if (!Number.isFinite(next)) return true;
      if ((target as FieldEffectParams)[key] !== next) { (target as FieldEffectParams)[key] = next; notify(); }
      return true;
    },
    deleteProperty() { return false; },
  });
  return {
    name, params, displace, shade, animate: !!spec.animate,
    subscribe(redraw) { listeners.add(redraw); return () => { listeners.delete(redraw); }; },
  };
}

const paramKeys = (effect: FieldEffect) => Object.keys(effect.params);

/** The GLSL the cell pass gains for these effects: a struct of params each, uniforms, and the two hook blocks. */
export function effectSource(effects: readonly FieldEffect[]) {
  if (!effects.length) return null;
  const structs = effects.map((effect, i) => {
    const keys = paramKeys(effect);
    return `struct Fx${i}Params{${keys.length ? keys.map(key => `float ${key};`).join('') : 'float unused;'}};`;
  }).join('\n');
  const read = (effect: FieldEffect, i: number) => {
    const keys = paramKeys(effect);
    const values = keys.length ? keys.map((_, k) => `uFx[${i * 2 + (k >> 2)}].${'xyzw'[k & 3]}`).join(',') : '0.';
    return `Fx${i}Params params=Fx${i}Params(${values});`;
  };
  // Each snippet runs in a block of its own, with its params and the variables it may write, so effects stack in order.
  const wrap = { displace: ['vec2 at=sampleAt;', 'sampleAt=at;'], shade: ['vec3 color=rgb;vec3 ink=fxInk;float inkAmount=fxInkAmount;float glyph=fxGlyph;', 'fxInk=ink;fxInkAmount=inkAmount;fxGlyph=glyph;'] };
  const block = (hook: 'displace' | 'shade') => effects.map((effect, i) => effect[hook]
    ? `{// effect "${effect.name}"\n${read(effect, i)}${wrap[hook][0]}\n${effect[hook]}\n${wrap[hook][1]}}` : '').filter(Boolean).join('\n');
  return {
    declarations: `uniform vec4 uFx[${MAX_FIELD_EFFECTS * 2}];\nuniform vec4 uFxPointer;\nuniform float uFxTime;\n${structs}`,
    displace: block('displace'),
    shade: block('shade'),
  };
}

/** The values for `uFx`: each effect's params, in declaration order, two vec4s per effect. */
export function effectUniforms(effects: readonly FieldEffect[], into = new Float32Array(MAX_FIELD_EFFECTS * 8)) {
  into.fill(0);
  effects.slice(0, MAX_FIELD_EFFECTS).forEach((effect, i) => {
    paramKeys(effect).forEach((key, k) => { into[i * 8 + k] = effect.params[key]; });
  });
  return into;
}
