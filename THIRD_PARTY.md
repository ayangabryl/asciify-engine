# Third-party components

Asciify's own code is MIT licensed. Dependencies keep their own licenses.

| Component | Version used for this release | License | Source |
| --- | --- | --- | --- |
| gifuct-js | 2.1.2 | MIT | https://github.com/matt-way/gifuct-js |
| gifenc | 1.0.3 | MIT | https://github.com/mattdesl/gifenc |
| FIGlet.js | 1.11.4 | MIT | https://github.com/patorjk/figlet.js |
| Mediabunny | 1.56.0 | MPL-2.0 | https://github.com/Vanilagy/mediabunny/tree/533c857a313b15f98af24ad916eeda27204c38ce |

Mediabunny is loaded on demand for Studio video encoding. Its source is unmodified; the corresponding source release is available at https://registry.npmjs.org/mediabunny/-/mediabunny-1.56.0.tgz. The MPL-2.0 text is included in `licenses/Mediabunny-MPL-2.0.txt`. Encoding uses browser-provided WebCodecs implementations.

Font data loads individually from FIGlet.js and retains its embedded font authorship notices. The package includes only code for selecting fonts; it does not relicense the font authors' work.
