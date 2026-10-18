import { readFileSync, rmSync } from 'node:fs';
import { build, defineConfig, type Options } from 'tsup';

// The kit draws with the field; it imports the published `./field` build rather than bundling a second copy of it.
const sharedField = (file: (format: string) => string) => ({
  name: 'kit-shared-field',
  setup(build: { initialOptions: { outExtension?: Record<string, string> }; onResolve(options: { filter: RegExp }, callback: () => { path: string; external: boolean }): void }) {
    // tsup builds CJS through an ESM pass when tree shaking, so the output extension is what tells the formats apart.
    const path = file(build.initialOptions.outExtension?.['.js'] === '.cjs' ? 'cjs' : 'js');
    build.onResolve({ filter: /^\.\.\/field$/ }, () => ({ path, external: true }));
  },
});

const shared: Options = { sourcemap: true, splitting: false, treeshake: true, minify: 'terser', external: ['mediabunny', 'figlet', 'gifenc'] };

// Hosts chunk per module, so a single-module kit lands whole in every route that imports one component. Built with a
// chunk per component, a route pays for the components it imports. Each component is an entry only to mark a chunk
// boundary; its entry file holds nothing but re-exports of those chunks and is removed after the build.
const kitModules = [...new Set([...readFileSync('src/kit.ts', 'utf8').matchAll(/from '\.\/kit\/([\w/-]+)'/g)].map(match => match[1]))];
const kitEsm: Options = {
  ...shared,
  entry: { kit: 'src/kit.ts', ...Object.fromEntries(kitModules.map(name => [`kit/${name}`, `src/kit/${name}.ts`])) },
  format: ['esm'],
  splitting: true,
  // Every chunk lands in dist/kit/, one level below the field.
  esbuildPlugins: [sharedField(ext => `../field.${ext}`)],
  esbuildOptions(options) { options.chunkNames = 'kit/[name]-[hash]'; },
};

export default defineConfig([
  {
    ...shared,
    entry: ['src/index.ts', 'src/core.ts', 'src/hover.ts', 'src/studio.ts', 'src/field.ts'],
    format: ['esm', 'cjs'],
    dts: { entry: ['src/index.ts', 'src/core.ts', 'src/hover.ts', 'src/studio.ts', 'src/field.ts', 'src/kit.ts'] },
    clean: true,
    // After the clean build, so nothing races its clean.
    async onSuccess() {
      await Promise.all([
        build({ ...shared, config: false, entry: ['src/kit.ts'], format: ['cjs'], esbuildPlugins: [sharedField(ext => `./field.${ext}`)] }),
        build({ ...kitEsm, config: false }),
      ]);
      for (const name of kitModules) {
        const stub = readFileSync(`dist/kit/${name}.js`, 'utf8').replace(/\/\/# sourceMappingURL=\S+\s*$/, '');
        if (!/^(export\{[^}]*\}from"[^"]+";|import"[^"]+";)*$/.test(stub)) throw new Error(`dist/kit/${name}.js holds code of its own`);
        for (const file of [`dist/kit/${name}.js`, `dist/kit/${name}.js.map`]) rmSync(file, { force: true });
      }
      rmSync('dist/kit/backgrounds', { recursive: true, force: true });
    },
  },
]);
