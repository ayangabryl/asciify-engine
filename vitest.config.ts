import { defineConfig } from 'vitest/config';

// Worker entries are inlined as script strings by the build (tsup.config.ts); tests run without a worker.
export default defineConfig({
  plugins: [{
    name: 'worker-source',
    enforce: 'pre',
    resolveId: id => id.endsWith('?worker-source') ? '\0worker-source' : null,
    load: id => id === '\0worker-source' ? 'export default "";' : null,
  }],
});
