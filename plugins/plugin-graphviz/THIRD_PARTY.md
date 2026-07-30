# Third-Party Licenses — @quill/plugin-graphviz

This plugin bundles third-party software. The host application (Quill, MIT) is
**not** copylefted by the EPL dependency below — EPL is weak copyleft and does
not extend to separate works that only link to it at runtime.

## @viz-js/viz — MIT License

- **Package**: <https://www.npmjs.com/package/@viz-js/viz>
- **Version**: 3.28.0
- **License**: MIT
- **Purpose**: JavaScript/WebAssembly port of Graphviz. Bundled into this
  plugin's `dist/index.js`. The wasm is inlined as a `binaryDecode('…')` string
  literal inside the package's JS — no separate `.wasm` asset is shipped.

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
```

## Graphviz — Eclipse Public License 2.0

- **Project**: <https://gitlab.com/graphviz/graphviz>
- **License**: EPL-2.0
- **Purpose**: The WASM binary embedded inside `@viz-js/viz` is a build of the
  Graphviz reference implementation. EPL-2.0 is weak copyleft: modifications to
  Graphviz itself must stay under EPL, but a separate work that merely
  executes the Graphviz binary at runtime (such as this plugin, or the Quill
  host) is **not** required to adopt EPL. See
  <https://www.eclipse.org/legal/epl-2.0/> for the full text.

This plugin declares both licenses per the Graphviz project's distribution
requirements.
