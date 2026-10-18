import { afterEach, describe, expect, it, vi } from 'vitest';

// Importing an entry must cost a host nothing but parsing: no DOM, canvas, WebGL, observer, timer or frame at import time.
const touched: string[] = [];
const trap = (name: string): object => new Proxy(function () {}, {
  get(_, key) { if (key === Symbol.toPrimitive || key === 'then') return undefined; touched.push(`${name}.${String(key)}`); return trap(`${name}.${String(key)}`); },
  apply() { touched.push(`${name}()`); return trap(`${name}()`); },
  construct() { touched.push(`new ${name}`); return trap(`new ${name}`); },
});
const GLOBALS = ['window', 'document', 'navigator', 'matchMedia', 'requestAnimationFrame', 'requestIdleCallback', 'setTimeout', 'setInterval', 'queueMicrotask',
  'ResizeObserver', 'IntersectionObserver', 'MutationObserver', 'PerformanceObserver', 'Worker', 'OffscreenCanvas', 'Image', 'createImageBitmap', 'fetch',
  'HTMLCanvasElement', 'WebGL2RenderingContext', 'CSS', 'customElements', 'addEventListener', 'devicePixelRatio', 'innerWidth', 'innerHeight', 'localStorage'];

afterEach(() => { vi.unstubAllGlobals(); });

describe('entry points', () => {
  for (const entry of ['index', 'core', 'field', 'hover', 'studio', 'kit']) {
    it(`asciify-engine/${entry === 'index' ? '' : entry} does no work at import`, async () => {
      vi.resetModules();
      touched.length = 0;
      const timer = { setTimeout, setInterval, queueMicrotask };
      for (const name of GLOBALS) vi.stubGlobal(name, trap(name));
      let module: Record<string, unknown>;
      try {
        module = await import(`./${entry}.ts`);
      } finally {
        Object.assign(globalThis, timer);
      }
      expect(Object.keys(module).length).toBeGreaterThan(0);
      expect(touched).toEqual([]);
    });
  }
});
