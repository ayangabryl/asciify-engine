import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { build as esbuild } from 'esbuild';
import { build, defineConfig, type Options } from 'tsup';

// The kit draws with the field; it imports the published `./field` build rather than bundling a second copy of it. Its
// imports of the field's shared context and frame loop (`../field/field-gl`, `../field/glyph-field`) go there too: a second
// copy would be a second context, frame loop and memory budget, blind to the fields the first one draws.
const sharedField = (file: (format: string) => string) => ({
  name: 'kit-shared-field',
  setup(build: { initialOptions: { outExtension?: Record<string, string> }; onResolve(options: { filter: RegExp }, callback: () => { path: string; external: boolean }): void }) {
    // tsup builds CJS through an ESM pass when tree shaking, so the output extension is what tells the formats apart.
    const path = file(build.initialOptions.outExtension?.['.js'] === '.cjs' ? 'cjs' : 'js');
    build.onResolve({ filter: /^\.\.\/field(\/field-gl|\/glyph-field)?$/ }, () => ({ path, external: true }));
  },
});

// `import source from './x?worker-source'` inlines x, bundled and minified, as a script string: the Studio starts its
// render worker from a Blob URL, so hosts need no worker file, bundler plugin or extra request.
const workerSource = {
  name: 'worker-source',
  setup(build: { onResolve(options: { filter: RegExp }, callback: (args: { path: string; resolveDir: string }) => { path: string; namespace: string }): void; onLoad(options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => Promise<{ contents: string; loader: 'js' }>): void }) {
    build.onResolve({ filter: /\?worker-source$/ }, args => ({ path: resolve(args.resolveDir, args.path.replace(/\?worker-source$/, '.ts')), namespace: 'worker-source' }));
    build.onLoad({ filter: /.*/, namespace: 'worker-source' }, async args => {
      const result = await esbuild({ entryPoints: [args.path], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020', minify: true, legalComments: 'none' });
      return { contents: `export default ${JSON.stringify(result.outputFiles[0].text)};`, loader: 'js' };
    });
  },
};

// The ESM studio fetches its worker script as a chunk of its own (dist/studio-worker.js) on the first mount; the CJS
// build, for Node and SSR where no worker runs, keeps it inline.
const workerChunk = {
  name: 'studio-worker-chunk',
  setup(build: { initialOptions: { outExtension?: Record<string, string> }; onResolve(options: { filter: RegExp }, callback: () => { path: string; external: boolean } | undefined): void }) {
    if (build.initialOptions.outExtension?.['.js'] === '.cjs') return;
    build.onResolve({ filter: /^\.\/worker-source$/ }, () => ({ path: './studio-worker.js', external: true }));
  },
};

const shared: Options = { sourcemap: true, splitting: false, treeshake: true, minify: 'terser', external: ['mediabunny', 'figlet', 'gifenc'], esbuildPlugins: [workerSource] };

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
  esbuildPlugins: [workerSource, sharedField(ext => `../field.${ext}`)],
  esbuildOptions(options) { options.chunkNames = 'kit/[name]-[hash]'; },
};

export default defineConfig([
  {
    ...shared,
    entry: ['src/index.ts', 'src/core.ts', 'src/hover.ts', 'src/studio.ts', 'src/field.ts'],
    format: ['esm', 'cjs'],
    esbuildPlugins: [workerSource, workerChunk],
    dts: { entry: ['src/index.ts', 'src/core.ts', 'src/hover.ts', 'src/studio.ts', 'src/field.ts', 'src/kit.ts'] },
    clean: true,
    // After the clean build, so nothing races its clean.
    async onSuccess() {
      await Promise.all([
        build({ ...shared, config: false, entry: { 'studio-worker': 'src/studio/worker-source.ts' }, format: ['esm'], sourcemap: false }),
        build({ ...shared, config: false, entry: ['src/kit.ts'], format: ['cjs'], esbuildPlugins: [workerSource, sharedField(ext => `./field.${ext}`)] }),
        build({ ...kitEsm, config: false }),
      ]);
      for (const name of kitModules) {
        const stub = readFileSync(`dist/kit/${name}.js`, 'utf8').replace(/\/\/# sourceMappingURL=\S+\s*$/, '');
        if (!/^(export\{[^}]*\}from"[^"]+";|import"[^"]+";)*$/.test(stub)) throw new Error(`dist/kit/${name}.js holds code of its own`);
        for (const file of [`dist/kit/${name}.js`, `dist/kit/${name}.js.map`]) rmSync(file, { force: true });
      }
      rmSync('dist/kit/backgrounds', { recursive: true, force: true });
      // One shared context per page: the kit must reach the field's through ./field, never carry a copy of its own.
      for (const file of ['dist/kit.cjs', ...readdirSync('dist/kit').filter(name => name.endsWith('.js')).map(name => `dist/kit/${name}`)]) {
        if (readFileSync(file, 'utf8').includes('Glyph field program failed to link')) throw new Error(`${file} bundles its own copy of the field's shared context`);
      }
    },
  },
]);
