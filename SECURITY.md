# Security policy

## Supported versions

| Version | Security fixes |
| --- | --- |
| 4.x (latest) | Yes |
| 3.x | No |

When a new major version ships, the previous one receives security fixes for six months. See [STABILITY.md](STABILITY.md).

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub's private vulnerability reporting](https://github.com/ayangabryl/asciify-engine/security/advisories/new), not in a public issue.

Include the affected version, what an attacker can do, and a reproduction if you have one. You can expect an acknowledgement within three working days and a fix or a plan within fourteen. Once a fix is released, the advisory is published with credit to the reporter unless they prefer otherwise.

## Scope

In scope: the published `asciify-engine` package, including its entry points, the bundled agent skill and the examples shipped in the package.

Things that are by design and not vulnerabilities:

- The engine loads the media URLs you pass it. Validate untrusted URLs before passing them, as you would for an `<img>`.
- `defineFieldEffect` compiles the GLSL you give it on the user's GPU. Do not build effect code from untrusted input.
- `gridToHtml` and `gridToSvg` escape every character of the art and every option value, but `fontFamily`, `ink` and `background` still land in the markup's styles as given, so they can carry other CSS. Do not pass untrusted strings to them.

## Supply chain

Releases are published from GitHub Actions with npm provenance, from a pushed version tag on `main`. The package has four runtime dependencies (`gifuct-js`, `gifenc`, `figlet`, `mediabunny`), each loaded only by the feature that needs it.
