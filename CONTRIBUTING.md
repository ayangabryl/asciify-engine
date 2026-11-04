# Contributing

Thanks for helping. Issues and pull requests are welcome; for anything larger than a fix, open an issue first so the approach can be agreed before you spend time on it.

## Setup

```bash
npm ci
npm test          # unit tests (Vitest, Node)
npm run build     # the package, into dist/
```

Browser checks use Playwright's Chromium (`npx playwright install chromium`):

```bash
npm run test:visual    # screenshots of kit components, presets and field marks against tests/visual/baselines
npm run test:effects   # custom field effects and live sources
npm run test:browser   # the interactive regression page (open the printed URL)
```

The comparison with other ASCII renderers lives in `bench/` with its own dependencies: `cd bench && npm i && node compare.mjs`.

## What a change needs

- **Tests.** A fix comes with a test that fails without it. A new option is covered by a unit test and, if it draws, a visual case.
- **No visual drift in a fix.** `npm run test:visual` must pass unchanged. If a change is meant to alter how something looks, it belongs in a minor release: update the baselines with `npm run test:visual -- --update`, say which cases changed and why in the pull request, and add a "Looks changed" note to `CHANGELOG.md`. See [STABILITY.md](STABILITY.md).
- **No breaking changes outside a major.** Deprecate first (doc comment, changelog), remove later.
- **The runtime promises hold.** Nothing at import, no requests of the engine's own, no `eval`, reduced motion honoured.
- **Docs.** Public options have doc comments. If agents should know about a change, update the skill under `skills/asciify-engine/`.
- **Changelog.** Add an entry under the next version in `CHANGELOG.md`.

## Style

Match the surrounding code: TypeScript, two-space indent, short comments that say why rather than what. Keep each entry point free of imports from the others except where the build already allows it (the kit draws through `/field`).

## Releases

Maintainers release from `main` with `npm run release:patch|minor|major` and `npm run release:push`; the tag publishes to npm with provenance. See [RELEASE.md](RELEASE.md).
