import { defineConfig } from 'tsup';

// The kit draws with the field; it imports the published `./field` build rather than bundling a second copy of it.
const sharedField = {
  name: 'kit-shared-field',
  setup(build: { initialOptions: { outExtension?: Record<string, string> }; onResolve(options: { filter: RegExp }, callback: () => { path: string; external: boolean }): void }) {
    // tsup builds CJS through an ESM pass when tree shaking, so the output extension is what tells the formats apart.
    const file = build.initialOptions.outExtension?.['.js'] === '.cjs' ? './field.cjs' : './field.js';
    build.onResolve({ filter: /^\.\.\/field$/ }, () => ({ path: file, external: true }));
  },
};

export default defineConfig([
  // Main library (ESM + CJS with types)
  {
    entry: ['src/index.ts', 'src/core.ts', 'src/hover.ts', 'src/studio.ts', 'src/field.ts', 'src/kit.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: true,
    minify: 'terser',
    external: ['mediabunny', 'figlet', 'gifenc'],
    esbuildPlugins: [sharedField],
  },
]);
