# Release

Releases are tag-driven. A pushed `v*.*.*` tag runs CI and publishes the package
to npm from GitHub Actions.

## One-time setup

Configure npm publishing for the repository using one of these options:

- Preferred: npm Trusted Publishing for `ayangabryl/asciify-engine`.
- Fallback: add an `NPM_TOKEN` repository secret with publish permission.

The release workflow requests `id-token: write` and publishes with provenance.

## Release a new version

From a clean `main` branch:

```bash
npm run release:patch
npm run release:push
```

Use `release:minor` or `release:major` for larger releases.

`npm version` updates `package.json` and `package-lock.json`, creates the
version commit, and creates the matching Git tag. `release:push` pushes the
commit and tag, which triggers the npm publish workflow.

## Patch an already-published manual release

If a version was published manually before the tag existed, create the tag from
the matching commit and push it:

```bash
git tag v1.0.115
git push origin v1.0.115
```

Do not create the tag if `package.json` is already on a newer version.
