// `import source from './x?worker-source'` as the package build does it (tsup.config.ts): x bundled to a script string.
import path from 'node:path';
import { build } from 'esbuild';

export const workerSource = {
  name: 'worker-source',
  setup(b) {
    b.onResolve({ filter: /\?worker-source$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.replace(/\?worker-source$/, '.ts')), namespace: 'worker-source' }));
    b.onLoad({ filter: /.*/, namespace: 'worker-source' }, async args => {
      const result = await build({ entryPoints: [args.path], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020', minify: true, legalComments: 'none' });
      return { contents: `export default ${JSON.stringify(result.outputFiles[0].text)};`, loader: 'js' };
    });
  },
};
