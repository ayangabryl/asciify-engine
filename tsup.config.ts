import { defineConfig } from 'tsup';

export default defineConfig([
  // Main library (ESM + CJS with types)
  {
    entry: ['src/index.ts', 'src/core.ts', 'src/backgrounds.ts', 'src/hover.ts', 'src/studio.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: true,
    minify: 'terser',
    external: ['mediabunny', 'figlet', 'gifenc'],
  },
]);
