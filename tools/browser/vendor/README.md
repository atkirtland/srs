Vendored browser build of [js-yaml](https://github.com/nodeca/js-yaml), version
5.5.0, distributed under the accompanying MIT license. `tools/build.py` embeds it
in an isolated module wrapper inside the standalone reviewer; no runtime module
loader or package installation is needed on desktop or Android.

To update, change the pinned tools development dependency and copy
`node_modules/js-yaml/dist/browser/js-yaml.umd.min.js` and its `LICENSE` here.
Run the browser YAML regression tests and rebuild `view.js`.

The bundled ts-fsrs code in `../browser-base.js` is covered by
[ts-fsrs-LICENSE](ts-fsrs-LICENSE).
