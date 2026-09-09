# AGENTS.md

## Cursor Cloud specific instructions

`asciify-engine` is a **framework-agnostic, browser-only TypeScript library** (published to npm) that converts images, GIFs, and video into ASCII art rendered onto an HTML `<canvas>`. There is no server or standalone app — the "application" is the library API consumed in a browser.

### Toolchain
- Node.js 22 with `npm` (see `package-lock.json`). CI (`.github/workflows/ci.yml`) uses Node 22 + `npm ci`.
- Dependencies are refreshed automatically by the startup update script (`npm ci`), so you normally do not need to install anything manually.

### Standard commands (defined in `package.json`)
- Test: `npm test` (Vitest, `vitest run`).
- Build: `npm run build` (tsup → ESM + CJS + `.d.ts` into `dist/`, minified with terser).
- Type-check only: `npx tsc --noEmit`.
- There is **no lint script and no ESLint config**; type-checking via `tsc`/the build is the closest equivalent gate.

### Non-obvious gotchas
- The published bundle **externalizes `gifuct-js`** (a `dependencies` entry), so `dist/index.js` contains a bare `import ... from "gifuct-js"`. It is **not directly loadable in a browser via a plain `<script type="module">`** — a bundler (Vite/webpack/esbuild) or an import map must resolve dependencies, exactly as a real consumer would. To exercise the library in a browser, bundle a small entry with `npx esbuild entry.js --bundle --format=esm --outfile=bundle.js` and serve it with any static server (e.g. `npx http-server`).
- Most core functions (`imageToAsciiFrame`, `renderFrameToCanvas`, `asciiBackground`, `asciify*`) require a DOM/`canvas` and only run in a browser, not in Node. The Vitest suite only covers pure logic (charset catalogs, `resolveSourceCrop`, `computeCanvasRenderSize`), so end-to-end verification of rendering must be done in a browser.
- `asciiBackground()` mounts its canvas at `opacity: 0.2` by default. On a dark container the animation is nearly invisible — pass `opacity: 1` (and an `accentColor`) when you want it clearly visible for a demo/screenshot.
- Animated backgrounds use `requestAnimationFrame`, which the browser throttles/pauses when the tab is not the focused, visible foreground window (e.g. when DevTools is focused). During idle screen recording the animation can appear frozen even though it works; keep the page focused and DevTools closed when capturing animation.
