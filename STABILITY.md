# Stability

What asciify-engine promises a project that depends on it, and how releases keep that promise.

## Versions

Releases follow [semantic versioning](https://semver.org):

- **Patch** (4.33.1): bug fixes and performance only. No new options, nothing removed, **and no change to how anything looks** (see below).
- **Minor** (4.34.0): new APIs and options, and deliberate visual changes, each listed in the changelog. Existing code keeps working.
- **Major** (5.0.0): removals and breaking changes, each with a migration note in `CHANGELOG.md` and the agent skill's `references/upgrading.md`.

The public API is everything exported from the package's entry points (`asciify-engine`, `/core`, `/headless`, `/field`, `/hover`, `/studio`, `/kit`) and documented in their type declarations. Exports marked `@internal` are not part of it and may change in any release.

### Experimental APIs

New APIs may ship marked **experimental** in their doc comment and in the changelog. An experimental API can change in a minor release, with a changelog note, until it is declared stable. Nothing is experimental by default; currently experimental:

| API | Since | Notes |
| --- | --- | --- |
| `defineFieldEffect` and `effects` on `/field` | 4.33.0 | The GLSL inputs and outputs may gain members; existing ones keep their meaning. |
| `asciify-engine/headless` | 4.33.0 | Output for a given input may improve in minor releases (see below). |
| `elementSource` on `/kit` | 4.33.0 | Follows the HTML-in-Canvas API, which is still changing in browsers. |

## How things look is part of the API

A design team approves a look. A routine `npm update` must not change it.

- **Patch releases never change rendered output.** Every kit component, background preset and field mark is drawn on a frozen clock and compared with a stored screenshot in CI (`npm run test:visual`). A patch that moves any of them fails.
- **Visual changes ship in minor releases**, under a "Looks changed" heading in the changelog that names each component or preset and what changed.
- **The headless renderer is deterministic.** The same pixels and options give the same characters on every platform and runtime. Improvements to its character choice are visual changes and follow the rule above.

To pin a look exactly, pin the version (`"asciify-engine": "4.33.0"`) rather than a range.

## Deprecation

Before an export or option is removed, it is deprecated for at least one minor release and three months: its doc comment says what replaces it, the changelog says so, and where it costs nothing it keeps working. Removal happens only in a major release.

## Release cadence

Fixes and features are batched: at most one minor and one patch release a week, except for security fixes, which ship as soon as they are ready. Each release has a changelog entry before it is tagged.

## Support

The latest major version receives fixes. The previous major version receives security fixes for six months after a new major ships.

## Runtime promises

These hold for every entry point and are checked in tests:

- **Nothing runs at import.** Importing any entry starts no timers, touches no DOM and makes no requests, so the package is safe under SSR and in workers. `asciify-engine/headless` never touches the DOM at all and runs in Node, Deno, Bun and edge runtimes.
- **No requests of its own.** The engine fetches only the sources you pass it (an image or video URL). It loads no fonts, scripts or telemetry.
- **CSP friendly.** No `eval` or `new Function`. The Studio's optional render worker starts from a `blob:` URL; a Content Security Policy needs `worker-src blob:` for it.
- **Accessible by default.** Fields and kit canvases are `aria-hidden` or labelled, honour `prefers-reduced-motion`, pause off screen, and leave the page's own HTML working when WebGL2 is unavailable.
- **One GPU context per page.** However many fields and kit components a page mounts, they share one WebGL2 context and one frame loop.

## If a promise is broken

Open an issue with the version and a reproduction. A visual change in a patch release, or a breaking change in a minor one, is treated as a bug: it is reverted or fixed in the next patch.
