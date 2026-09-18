---
name: folyn-extension-dev
description: "Develop a Folyn extension end to end: scaffold with create-folyn-extension, build contribution points against the folyn-extension-sdk, and publish to the Folyn extension store (GitHub Releases + catalog.json). Use when the user wants to create, build, test, or publish a Folyn extension."
---

# Folyn Extension Development Skill

This skill walks a Code Agent through the full lifecycle of a Folyn extension:
**scaffold → develop → build & test → publish**. It is an orchestrator: it gives
the commands and decisions for each phase, then points at the authoritative
reference for depth (it does not duplicate the SDK docs).

## When to use

- "Create / write / build a Folyn extension"
- "Add a file type / container / command / exporter / sidebar panel / tool window to Folyn"
- "Publish my Folyn extension to the store"
- The user is starting a new extension, or extending an existing scaffolded one.

## Prerequisites

- Node ≥ 20, npm/npx.
- The Folyn desktop app (for local install + QA).
- `gh` CLI (GitHub auth) — only for the publish phase.

## The two tiers — decide first

Every extension is `sandbox` or `trusted`. This is the design axis and is baked
in at scaffold time:

| Tier | Runs in | When to pick | Contribution points available |
| --- | --- | --- | --- |
| **trusted** | host webview realm (in-process) | Renders inline React/CodeMirror, deep host integration. Needs a one-time user **批准并授权** (TOFU). | all (`commands`, `fileTypes`, `containers`, `features`, `tools`, `exporters`, `fileTemplates`, `keybindings`, `exportEnhancers`, `markdownCodeRenderers`, `editorLanguages`, `storageProviders`) |
| **sandbox** | isolated iframe (`folyn-extension://` opaque origin) | Self-contained tool/launcher; safest for untrusted third-party code. No host React. | `commands`, `tools` only |

Default to **trusted** unless you have a reason to isolate.

## Phase 1 — Scaffold

```bash
npx create-folyn-extension my-extension --tier trusted
# or: --tier sandbox
```

`--tier` is required. Interactive prompts fill the rest (name, author, version,
folyn engine compat); pass `--yes` + flags for non-interactive / CI use.

This creates `./my-extension/` — a `folyn-extension-<id>` package (private) with:

- `manifest.json` — declares `id`, `tier`, `main`, `permissions`, `contributes.*`
- `src/index.ts` — extension entry (trusted: `ExtensionModule` default export; sandbox: postMessage RPC bridge)
- `build.mjs` — esbuild config → `dist/` (self-contained installable dir)
- `AGENTS.md` + `CLAUDE.md` — **the full in-project reference** (manifest schema, every contribution point with examples, the `ExtensionModule` export contract, `ExtensionContext`, AI/HTTP/Env capabilities, lifecycle, pitfalls). Read this once scaffolded.
- `README.md` — install + structure overview (human-facing)

> The scaffolded project's `AGENTS.md` is the authoritative contribution
> reference while you develop. This SKILL does not re-print it.

## Phase 2 — Develop with the SDK

A Folyn extension = `manifest.json` (declarative contributions) + `src/index.ts`
(the matching `ExtensionModule` exports). They must stay in lockstep: every
`contributes.*[].run` / `.handler` / `.component` / `.entry` **string entry-ref**
must equal a key in the matching `ExtensionModule` map.

Loop:

1. Add an entry under the matching `contributes.*[]` array in `manifest.json`. Note the entry-ref string.
2. Wire the matching key in `src/index.ts`'s `ExtensionModule` map (same key).
3. Update `permissions` in `manifest.json` if the contribution touches `fs` / `http` / `clipboard` / `dialog` / `window` / `vault` / `ai`. Permissions are enforced at runtime — missing = runtime reject, not build error.
4. If it needs lifecycle setup, put it in `module.activate(ctx)` and register cleanup via `ctx.addDisposable()`.

### Key constraints (the ones that bite)

- **Trusted React is external.** `build.mjs` aliases `react` + `react/jsx-runtime` to shims that read `window.React` (the host exposes it before any trusted extension loads). **Do not bundle React** — a second copy breaks hooks ("Invalid hook call"). Use the global.
- **Sandbox has no host React.** Bundle your own UI deps or use plain DOM. All host capability goes through `postMessage` RPC (`src/index.ts` already wires the bridge).
- **`manifest.main` rewrite.** Root `manifest.json` says `"main": "dist/index.js"`; `build.mjs` strips the `dist/` prefix when copying into `dist/manifest.json` (→ `"index.js"`). Don't "fix" one without the other — install breaks silently.
- **Remote fetch (trusted).** The main webview CSP does not include third-party origins. To call a remote URL, declare `permissions.http.origins` and use `ctx.http.fetch` (routes through Rust, outside CSP) — never a direct `fetch()` in the bundle.
- **Entry-ref keys must match exactly.** The manifest is JSON, not typed — typos surface as runtime resolution errors, not type errors.

### Where the depth lives

- **`AGENTS.md`** in the scaffolded project — full contribution contract, always present after scaffold. Start here.
- **`node_modules/folyn-extension-sdk/docs/`** — `extension-development.md` (full guide: TOFU, sandbox RPC protocol, packaging, AI capability) + `extension-sdk-reference.md` (manifest field tables, `ExtensionModule` contract, type quick-ref). Shipped with the SDK.
- **`references/contribution-points.md`** in this skill — the tier × contribution × module-map decision matrix (quick chooser).
- **`references/publish-checklist.md`** in this skill — the publish runbook (Phase 4).

## Phase 3 — Build & test locally

```bash
cd my-extension
pnpm install
pnpm build        # → dist/ (manifest.json + index.js [+ index.html for sandbox])
```

`dist/` is the installable folder — `build.mjs` writes `manifest.json` into it
(with `main` rewritten to `index.js`). Install it in Folyn:

**Settings → Extensions → Install from folder… → pick `dist/`.**

- **Trusted** extensions then need a one-time **批准并授权** click (TOFU approval) in the Extensions list.
- Reload Folyn (or restart) to pick up code changes — re-install `dist/` after each `pnpm build`.
- Test by exercising the contribution you added (palette ⌘P → your command; open your file type; type your `:::container` directive; etc.).

> Type errors that pass at build time do not prove the extension runs. Always
> install + reload + exercise.

## Phase 4 — Publish to the Folyn extension store

Folyn extensions are **not** distributed via npm. They ship as a **zip** on a
**GitHub Release**, listed in **`catalog.json`** in the
[`folyn-extensions`](https://github.com/linyimin0812/folyn-extensions) repo, and
users install them via the in-app **Store** tab or **Install from URL**.

The full runbook (exact `zip` + `gh release` commands, the `catalog.json` entry
shape, and the install-path constraints) is in
**`references/publish-checklist.md`**. Summary:

1. `pnpm build` → `dist/`.
2. Zip `dist/` contents (manifest.json at the zip root, no `src`/`*.ts`/`*.map`/`package*.json`).
3. `gh release create <id>-<version> <zip> --repo linyimin0812/folyn-extensions`.
4. PR `catalog.json` in the `folyn-extensions` repo: add/replace the entry (`id`, `name`, `version`, `description`, `tier`, `author`, `icon`, `downloadUrl`). `id` must match the zip's `manifest.json` `id`; `downloadUrl` host must be `github.com`.
5. Maintainer reviews manifest / permissions / tier → merges → users see it in the Store.

Third-party publishers host the zip on **their own** GitHub Releases and PR the
`downloadUrl` into `catalog.json`.

## Workflow recap

```
npx create-folyn-extension <name> --tier <trusted|sandbox>
cd <name> && pnpm install
# develop: manifest.json contributes.*  ↔  src/index.ts ExtensionModule maps
pnpm build                       # → dist/
# local QA: Folyn → Settings → Extensions → Install from folder… → pick dist/
# (trusted: 批准并授权)
# ship: cd dist && zip … → gh release … → PR catalog.json
```

## Reference

- `references/contribution-points.md` — tier × contribution × module-map decision matrix
- `references/publish-checklist.md` — publish runbook (build → zip → GitHub Release → catalog.json PR)
- Scaffolded project's `AGENTS.md` — full in-project contribution contract
- `node_modules/folyn-extension-sdk/docs/` — `extension-development.md` + `extension-sdk-reference.md`
