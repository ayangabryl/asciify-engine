# Update Asciify and its agent skill

Use this when a user asks for the latest package or skill, or a requested feature needs a newer release. Updating npm does not refresh a Vercel Skills CLI installation, and updating a skill does not change the application's runtime dependency.

## Package

1. In the target application, inspect its manifest and lockfile; use that project's existing package manager. Read the installed version (`npm ls asciify-engine --depth=0`, or its package-manager equivalent) and check the registry (`npm view asciify-engine@latest version`). The skill's `tested-engine` is a compatibility checkpoint, not a live registry alias.
2. When the task authorizes an upgrade, use `npm install asciify-engine@latest`, `pnpm add asciify-engine@latest`, `yarn add asciify-engine@latest`, or `bun add asciify-engine@latest` as appropriate. Preserve the project's exact-version policy and update the matching lockfile. Do not use `npm update` as a substitute when an existing range excludes latest. Never use a sibling `file:` dependency in a consumer release.
3. Verify the resolved version and installed `asciify-engine/hover` types. Run the application's relevant build/tests and exercise its ASCII media, hover, cleanup and reduced-motion path. Check release notes before crossing a major version; resolve affected integration code rather than claiming the upgrade is automatically compatible.

Version 1.3.0 adds velocity-driven Trail, character finishes (`filter`, `edgeEffect`, `edgeSoftness`), text cutouts (`textMask`) and optional boundary protection (`edgeSafe`, default false). Use `radius` from 0.1 to 1 for hover size. Existing core media APIs remain supported. Read [hero-finish.md](hero-finish.md) for complete examples and limits.

Version 1.4.0 adds the optional `/studio` composition and export API. Its settings are separate from `AsciiOptions`; existing `/core` and `/hover` integrations keep their behavior. Read [studio-workspace.md](studio-workspace.md) only when adding these tools.

## Installed agent skill

Inspect `npx skills list --json` for project installs or `npx skills list -g --json` for global installs. Refresh this skill in the same scope:

```sh
# Existing project installation
npx skills update asciify-engine --project --yes

# Existing global installation
npx skills update asciify-engine --global --yes
```

Use the scoped command matching the existing installation. Do not run an unqualified bulk update of every installed skill. If this skill is absent, install it with `npx skills add ayangabryl/asciify-engine --skill asciify-engine` and the appropriate scope/agent flags. Preserve agent selection; do not add `--all` unless requested. Inspect `npx skills --help` if CLI flags differ in the installed version. A manually copied skill can be refreshed from the same repository or the matching npm tarball's `skills/asciify-engine` directory; preserve unrelated files.

After updating, read the installed SKILL.md and its linked references, confirm its source/version and resource links, and report both the resolved npm version and whether the installed skill was refreshed. If an offline/registry/authentication error prevents either step, report the actual partial result; do not silently fall back to an unverified version. These consumer upgrade instructions do not authorize publishing npm packages or deploying a site.

## 2.0 catalog migration

2.0.0 removes the `emoji`, `musical`, and `starfield` keys from `CHARSETS`, `ArtStyle`, and `ART_STYLE_PRESETS`. Before upgrading, search application settings and saved presets for those names. Use `classic` plus a custom `charset` to retain an application-owned alphabet, or use `circles`, `braille`, or `geometric` for structural alternatives. The existing cosmic sequence now uses sparse marks/circles/shadows, and angular uses geometry/shards/blocks. Other core options and renderers retain their behavior. Do not pass retired keys or tell users that custom Unicode has been removed.

The curated `STUDIO_CHARACTER_SETS` export is available from `/studio` in 2.0.0. Its values contain `label` and `chars`; assign `chars` to Studio settings only for `style: 'ascii'`. The primary editor at `/editor` uses Studio; earlier webcam and classic-editor workflows remain at `/editor/classic`.

2.0.1 fixes Dither size controls and publishes `studioGrid` for budget-aware size pickers. Still-image exports accept `time` for the selected frame. Existing calls default to frame zero. No preset names change in this patch.

## 3.0 motion migration

3.0 removes the old ambient animation identifiers from the public `AnimationStyle` and Studio types and deletes their implementations. Use `none`, `caustics`, `current`, or `reform` instead. The `/hover` module also replaces `print` with `caustics`. Old saved Studio IDs normalize to `none`; do not silently substitute an effect. Review application-owned saved core options when upgrading and replace retired IDs explicitly.

These are actual new treatments, not aliases for Fire, Breathe, Rainbow, Hologram, or the old row-wave effects. Caustics moves light through a fixed grid; Current carries the image with bounded local flow; Reform disperses and reassembles cells with spatially staggered timing. Core Canvas uses the same field with simpler opacity modulation; `/hover` and `/studio` also modulate character density. Hover and optical glitch/blur finishes are separate and remain available. Optional procedural backgrounds are unchanged.

Use one motion owner: `animationStyle` for core, `motion` for `/hover`, or `motion.type` for `/studio`. Keep Off as the default for video. Each motion loops every `12 / speed` seconds. Offer pause, respect reduced motion, and avoid claiming a guaranteed FPS on every device.

## 4.0 background migration

Remove imports from `asciify-engine/backgrounds` and generator imports from the root package. Download the chosen `.js` template from https://asciify.org/backgrounds and change the import to `./wave.js` (or your selected file). The template exports `asciiBackground`; keep calling `destroy()` on unmount. It handles resizing, hidden/offscreen suspension, reduced motion, and cleanup. A selected template contains only that generator; backgrounds.js is the optional full collection. Application-owned source templates are separate from npm updates. Existing installations can stay on 3.x while migrating. Text and media rendering remain supported, including text backgrounds.

Use `CHARACTER_SETS` from root or `/core` for the same eight choices as the editor's `STUDIO_CHARACTER_SETS`. This data-only import does not load Studio. Keep custom characters available separately; do not populate standard UI choices from the larger legacy `CHARSETS` object.
