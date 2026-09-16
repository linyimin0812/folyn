# create-folyn-extension

Scaffold a [Folyn](https://github.com/linyimin0812/folyn) extension from a
template.

```bash
npx create-folyn-extension my-extension
# or
npm create folyn-extension my-extension
```

## Usage

```text
Usage: create-folyn-extension [name] [options]

Scaffolds a Folyn extension in ./<name>/.

Options:
  --tier <trusted|sandbox>  Extension tier (REQUIRED)
  --name <name>             Extension name (alternative to positional arg)
  --display-name <name>     Human-readable name (default: same as --name)
  --author <name>           Author (default: empty)
  --version <ver>           Extension version (default: 0.1.0)
  --folyn <constraint>      Folyn engine compat (default: >=0.1.0)
  --yes, -y                 Skip prompts; use defaults for missing fields (--tier still required)
  -h, --help                Show this help

Interactive (default TTY): prompts for any field not supplied via flags.
Non-interactive: pass --yes, supply all fields via flags/positional (--tier required).
Piped stdin (non-TTY) auto-enables --yes to avoid hanging on prompts.
```

## The two tiers

A `--tier` is required — the two tiers scaffold very different projects:

- **`trusted`** — host-realm `import()` extension (TOFU-pinned). Renders inline in
  the host React tree; `build.mjs` aliases `react` + `react/jsx-runtime` to the
  bundled shims that read `window.React`, so JSX + hooks work out of the box
  against the host's single React instance. Use for file types, containers,
  exporters, markdown code renderers, editor languages.

- **`sandbox`** — sandboxed iframe (`folyn-extension://` origin, opaque). No
  host React access; `src/index.ts` wires a `postMessage` RPC bridge (every host
  capability gated by `manifest.permissions`). Use for isolated tools /
  launchers that don't need to share the host's realm.

## After scaffolding

```bash
cd my-extension
pnpm install
pnpm build        # → dist/ (installable)
```

Then pick the `dist/` folder in **Folyn → Settings → Extensions → Install
from folder…**.

## License

MIT — same as the Folyn project.
