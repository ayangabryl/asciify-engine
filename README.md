<p align="center">
  <a href="https://asciify.org">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ayangabryl/asciify-engine/main/.github/assets/logo-dark.png">
      <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/ayangabryl/asciify-engine/main/.github/assets/logo-light.png">
      <img alt="Asciify" src="https://raw.githubusercontent.com/ayangabryl/asciify-engine/main/.github/assets/logo-light.png" width="220">
    </picture>
  </a>
</p>

<p align="center">ASCII components, backgrounds and media for the web, drawn in real characters on the GPU.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/asciify-engine"><img alt="npm version" src="https://img.shields.io/npm/v/asciify-engine?style=flat-square&labelColor=171716&color=3d3d3a"></a>
  <a href="https://bundlejs.com/?q=asciify-engine"><img alt="Bundle size" src="https://img.shields.io/bundlejs/size/asciify-engine?style=flat-square&labelColor=171716&color=3d3d3a&label=gzip"></a>
  <a href="https://www.npmjs.com/package/asciify-engine"><img alt="Downloads" src="https://img.shields.io/npm/dm/asciify-engine?style=flat-square&labelColor=171716&color=3d3d3a"></a>
  <a href="https://github.com/ayangabryl/asciify-engine/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/npm/l/asciify-engine?style=flat-square&labelColor=171716&color=3d3d3a"></a>
</p>

<p align="center">
  <a href="https://asciify.org">Website</a> ·
  <a href="https://asciify.org/docs">Docs</a> ·
  <a href="https://asciify.org/components">Components</a> ·
  <a href="https://asciify.org/editor">Studio</a>
</p>

<p align="center">
  <a href="https://asciify.org">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ayangabryl/asciify-engine/main/.github/assets/hero-dark.webp">
      <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/ayangabryl/asciify-engine/main/.github/assets/hero-light.webp">
      <img alt="The asciify.org home page: an ASCII field behind the headline and three live kit components" src="https://raw.githubusercontent.com/ayangabryl/asciify-engine/main/.github/assets/hero-light.webp" width="100%">
    </picture>
  </a>
</p>

Asciify is a framework-agnostic engine for ASCII on the web. Use it for interface components (loading buttons, toasts, tabs, AI states, charts, page transitions), for backgrounds behind your content, and for turning images, GIFs, video and text into characters. Components take their ink from your CSS tokens in light and dark, follow their element's size and radius, honour reduced motion and pause off screen.

## Install

```bash
npm i asciify-engine
```

Building with a coding agent? Add the skill, then describe what you want:

```bash
npx skills add ayangabryl/asciify-engine
```

## Quick start

```ts
import { buttonLoading } from 'asciify-engine/kit';
import { asciify } from 'asciify-engine';

const save = buttonLoading(document.querySelector('#save')!);
save.start('Saving');
await saveDraft();
save.succeed('Saved');

const stop = await asciify('/photo.jpg', document.querySelector('canvas')!, {
  fontSize: 8,
  options: { colorMode: 'fullcolor' },
});
// On unmount: save.destroy(); stop();
```

## Features

- **Kit** (`/kit`): 31 interface components and the curated asciify.org backgrounds, one call each.
- **Media** (`asciify-engine`, `/core`): images, GIFs, video, webcam and text to ASCII on a canvas, with scroll-scrubbed video, chroma key and source crop.
- **GPU fields** (`/field`): full-bleed WebGL2 character fields with trail, fluid and lantern cursor responses, in any font and charset.
- **Hover and motion** (`/hover`): 19 pointer effects and 10 still-image motions for media on your page.
- **Studio** (`/studio`): 24 render styles, tonal curves, source warps, layered projects and PNG, JPEG, GIF, MP4 and WebM export.
- **Agent skill**: the house design, every component's prompt and snippet, and the full API, for Claude Code, Cursor, Codex and other agents.
- **Built for host pages**: no work at import, safe under SSR, tree-shaken per component, TypeScript types, ESM and CommonJS.

## Docs

Everything else lives at **[asciify.org/docs](https://asciify.org/docs)**: the API reference, options, framework guides, chroma key, layering, Studio and GPU fields. The agent skill's [references](skills/asciify-engine/references) cover the same ground for agents.

## Performance

Each optional entry loads only when imported, and a route that uses one kit component downloads that component, not the whole kit. What the engine promises a host page, and how it is measured, is in [performance.md](skills/asciify-engine/references/performance.md).

## Contributing

Issues and pull requests are welcome. To work on the engine:

```bash
npm ci
npm test
npm run build
```

`npm run test:browser` serves the browser regression page. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Sponsors

<!-- sponsors:start -->

<p align="center"><a href="https://asciify.org/sponsor"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.asciify.org/sponsors-dark.svg"><img src="https://cdn.asciify.org/sponsors.svg" alt="Asciify sponsors" width="720"></picture></a></p>

<p align="center"><sub>Backers: <a href="https://releasetime.io/">ReleaseTime</a></sub></p>

Asciify is free and open source. [Become a sponsor](https://asciify.org/sponsor).

<!-- sponsors:end -->

## License

[MIT](LICENSE) © ayangabryl
