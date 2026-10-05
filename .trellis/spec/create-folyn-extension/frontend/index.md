# CLI Conventions

> Guidelines for the `create-folyn-extension` scaffolding CLI.

---

## Overview

`create-folyn-extension` scaffolds a Folyn extension into `./<name>/` from the templates in `packages/create-folyn-extension/template/` (`trusted/` and `sandbox/` variants, plus shared `tsconfig.json` and agent docs). It is a single-file CLI: `packages/create-folyn-extension/src/index.ts`, using `node:util` `parseArgs` for flags and `node:readline/promises` for interactive prompts. Stdlib only — no CLI framework.

## Conventions

- **`--tier <trusted|sandbox>` is REQUIRED.** Validated early when provided (`TIERS` const); prompted interactively in a TTY; hard error if missing after prompting. Tier meanings: `trusted` — host-realm blob-URL `import()`, inline React via `window.React`; `sandbox` — isolated iframe, postMessage RPC.
- **Interactive by default in a TTY**: prompts for any field not supplied via flags. **Non-TTY (piped stdin) auto-enables `--yes`** so the CLI never hangs on prompts — same behavior as passing `--yes, -y` explicitly (defaults for missing fields; `--tier` still required).
- **Flags over prompts**: `--name` (or positional), `--display-name`, `--author`, `--version`, `--folyn`, `--yes`, `-h/--help`. `parseCliArgs` maps `parseArgs` values to nullable fields; prompts fill the gaps.
- **Defaults**: version `0.1.0`, folyn engine constraint `>=0.1.0` (`DEFAULTS` const).
- **Errors go to stderr with `✗` prefix and exit non-zero**; help text (`HELP` const) documents every flag and the tier semantics — keep it in sync when adding a flag.
- Template rendering is copy + token replacement over the template dir; the template's own conventions (manifest, build, `window.React` rule for trusted) live in the template files and `packages/extension-sdk/docs/extension-development.md`, not duplicated here.

## When changing the CLI

- New flag: add to `parseCliArgs` options, the `HELP` text, and (only if needed) a prompt in the interactive path.
- New scaffold field: template tokens and `src/index.ts` rendering change together — check both `template/trusted/` and `template/sandbox/`.
- Behavior changes get a check in `packages/create-folyn-extension/test/smoke.mjs` — an end-to-end smoke test that runs the built CLI for both tiers with `--yes` + flags and asserts the scaffolded manifest/package.json placeholders and per-tier files.
