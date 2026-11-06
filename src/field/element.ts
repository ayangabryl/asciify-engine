import { mountGlyphField } from './mount';
import type { GlyphField, GlyphFieldOptions } from './glyph-field';

/**
 * `<asciify-field>`: a glyph field as an HTML element, for any framework or none (React 19, Vue, Svelte, Astro, Angular,
 * plain HTML). Defined only when asked, with `defineAsciifyField()`, so importing does nothing and server rendering is safe.
 *
 * ```html
 * <asciify-field src="/hero.mp4" hover="fluid" cell-size="10" worker style="height: 60vh"></asciify-field>
 * ```
 *
 * Every attribute is a field option in kebab case (`cell-size` is `cellSize`): numbers, `true`/`false`, JSON for objects
 * (`lantern='{"radius":0.3}'`) and a bare attribute for true. `src` is the source; `label` names it for assistive technology.
 * Options an attribute cannot hold (an element as source, `effects`, `clear`) go in the `options` property, and `field` is
 * the mounted `GlyphField` (`pulse()`, `pointer()`, `redraw()` …). Children are laid over the field.
 */
export interface AsciifyFieldElement extends HTMLElement {
  /** Options set as a property, merged over the attributes. */
  options: GlyphFieldOptions;
  /** The mounted field, or null before it mounts and after the element leaves the page. */
  readonly field: GlyphField | null;
  /** Resolves once the field has drawn its first frame. */
  readonly ready: Promise<void>;
}

// Attributes that are the element's own rather than the field's.
const OWN = new Set(['class', 'style', 'id', 'slot', 'part', 'role', 'tabindex', 'hidden', 'title', 'lang', 'dir', 'is', 'inert', 'autofocus', 'popover', 'nonce']);
// Options that pick how the field is built: a change mounts it again.
const STRUCTURAL = new Set(['worker', 'context', 'live']);

const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
/** An attribute's value as a field option: true for a bare attribute, numbers, booleans, JSON objects and arrays, else text. */
export function readFieldAttribute(value: string): unknown {
  const text = value.trim();
  if (text === '' || text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return Number(text);
  if (/^[[{]/.test(text)) { try { return JSON.parse(text); } catch { /* text, then */ } }
  return value;
}

/** The field options an element's attributes ask for. @internal */
export function fieldOptionsFromAttributes(element: Element): GlyphFieldOptions {
  const out: Record<string, unknown> = {};
  for (const { name, value } of Array.from(element.attributes)) {
    if (OWN.has(name) || name.startsWith('aria-') || name.startsWith('data-') || name.startsWith('on')) continue;
    if (name === 'src') out.source = value || null;
    else if (name === 'label') out.label = value;
    else out[camel(name)] = readFieldAttribute(value);
  }
  return out as GlyphFieldOptions;
}

const STYLE = ':host{display:block;position:relative;height:320px;contain:layout paint;overflow:hidden}'
  + ':host([hidden]){display:none}'
  + 'canvas{position:absolute;inset:0;width:100%;height:100%;display:block}'
  + '.over{position:relative;height:100%}';

/**
 * Registers `<asciify-field>` (or `tag`) with the page's custom elements. Safe to call more than once and where there is no
 * DOM (it returns false there). Returns true once the element is defined.
 */
export function defineAsciifyField(tag = 'asciify-field'): boolean {
  if (typeof window === 'undefined' || typeof customElements === 'undefined' || typeof HTMLElement === 'undefined') return false;
  if (customElements.get(tag)) return true;

  class AsciifyField extends HTMLElement implements AsciifyFieldElement {
    #canvas: HTMLCanvasElement | null = null;
    #field: GlyphField | null = null;
    #options: GlyphFieldOptions = {};
    #observer: MutationObserver | null = null;
    #applied: GlyphFieldOptions = {};
    #ready: { promise: Promise<void>; resolve: () => void };
    #pending = false;

    constructor() {
      super();
      let resolve!: () => void;
      this.#ready = { promise: new Promise<void>(r => { resolve = r; }), resolve };
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${STYLE}</style><canvas part="canvas"></canvas><div class="over" part="content"><slot></slot></div>`;
      this.#canvas = root.querySelector('canvas');
    }

    get field() { return this.#field; }
    get ready() { return this.#ready.promise; }
    get options() { return this.#options; }
    set options(value: GlyphFieldOptions) { this.#options = value ?? {}; this.#sync(); }

    connectedCallback() {
      // A property set before the element was defined shadows the accessor: take it over.
      if (Object.prototype.hasOwnProperty.call(this, 'options')) {
        const value = (this as unknown as { options: GlyphFieldOptions }).options;
        delete (this as unknown as { options?: unknown }).options;
        this.options = value;
      }
      this.#observer ??= new MutationObserver(() => this.#sync());
      this.#observer.observe(this, { attributes: true });
      this.#sync();
    }

    disconnectedCallback() {
      this.#observer?.disconnect();
      // Moved within the page: connected again in the same task, so the field stays.
      queueMicrotask(() => { if (!this.isConnected) this.#unmount(); });
    }

    #want(): GlyphFieldOptions { return { ...fieldOptionsFromAttributes(this), ...this.#options }; }

    // Attribute and property changes, gathered into one update a microtask later.
    #sync() {
      if (this.#pending) return;
      this.#pending = true;
      queueMicrotask(() => {
        this.#pending = false;
        if (!this.isConnected || !this.#canvas) return;
        const next = this.#want();
        if (!this.#field) { this.#mount(next); return; }
        const changed: Record<string, unknown> = {};
        const keys = new Set([...Object.keys(next), ...Object.keys(this.#applied)]);
        let rebuild = false;
        for (const key of keys) {
          const a = (next as Record<string, unknown>)[key], b = (this.#applied as Record<string, unknown>)[key];
          if (a === b || (typeof a === 'object' && a && JSON.stringify(a) === JSON.stringify(b) && !(a instanceof EventTarget))) continue;
          if (STRUCTURAL.has(key)) rebuild = true;
          changed[key] = a;
        }
        if (rebuild) { this.#unmount(false); this.#mount(next); return; }
        if (Object.keys(changed).length) { this.#field.update(changed as GlyphFieldOptions); this.#applied = next; }
      });
    }

    #mount(options: GlyphFieldOptions) {
      if (!options.label && this.hasAttribute('aria-label')) options = { ...options, label: this.getAttribute('aria-label')! };
      this.#applied = options;
      const field = mountGlyphField(this.#canvas!, options);
      this.#field = field;
      void field.ready.then(() => { if (this.#field === field) { this.#ready.resolve(); this.dispatchEvent(new Event('ready')); } }, () => {});
    }

    #unmount(fresh = true) {
      this.#field?.destroy();
      this.#field = null;
      // A field drawn in a worker took the canvas: the next one gets a new canvas.
      const old = this.#canvas;
      if (old && this.shadowRoot) {
        const canvas = document.createElement('canvas');
        canvas.setAttribute('part', 'canvas');
        old.replaceWith(canvas);
        this.#canvas = canvas;
      }
      if (fresh) {
        let resolve!: () => void;
        this.#ready = { promise: new Promise<void>(r => { resolve = r; }), resolve };
      }
    }
  }

  customElements.define(tag, AsciifyField);
  return true;
}
