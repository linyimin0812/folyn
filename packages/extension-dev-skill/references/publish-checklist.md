# Publish a Folyn Extension to the Store

Folyn extensions are **not** distributed via npm. They ship as a **zip** on a
**GitHub Release**, are listed in **`catalog.json`** in the
[`folyn-extensions`](https://github.com/linyimin0812/folyn-extensions) repo, and
users install them via the in-app **Settings → Extensions → Store** tab or
**Install from URL**.

This runbook covers the full publish path for a scaffolded extension.

## 0. Before you start

- The extension builds cleanly: `pnpm build` → `dist/`.
- You've QA'd it locally (Phase 3 of the SKILL): installed `dist/` from folder,
  exercised every contribution, and (trusted) clicked 批准并授权.
- `gh` CLI is authed to GitHub.

## 1. Build

```bash
cd my-extension
pnpm build        # → dist/ (manifest.json + index.js [+ index.html for sandbox])
```

The scaffolded `build.mjs` writes a **self-contained installable `dist/`**:

- `dist/manifest.json` — copied from root, with `main` rewritten `dist/index.js` → `index.js`.
- `dist/index.js` — the esbuild bundle (ESM for trusted, IIFE for sandbox).
- `dist/index.html` (sandbox only) — the iframe entry, script src rewritten to `./index.js`.

So `manifest.json` is **already at the `dist/` root** — you zip from inside `dist/`.

## 2. Zip

```bash
cd dist
zip -r -X ../<id>-<version>.zip . -x "*.map" "*.DS_Store"
cd ..
```

Replace `<id>` with the extension's manifest `id` (kebab-case, e.g.
`my-extension`) and `<version>` with the manifest `version` (e.g. `0.1.0`).

Example: `zip -r -X ../my-extension-0.1.0.zip . -x "*.map" "*.DS_Store"`.

### Zip constraints (the installer hard-enforces these)

The zip **root** must contain `manifest.json`. The installer (`extract_zip_filtered`)
rejects forbidden files — `build.mjs` already keeps `dist/` clean, but don't ship
extra junk:

| ❌ Hard-rejects install (lists every offender) | reason |
| --- | --- |
| `src/**`, `node_modules/**`, `.git/**`, `.vscode/**`, `.idea/**` | source / dev tooling |
| `*.ts`, `*.tsx`, `*.jsx` | TypeScript / JSX sources |
| `*.map` | sourcemaps |
| `*.env` (incl. `.env.local`, …) | secrets |
| `package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` | npm metadata |
| `tsconfig.json` | TS build config |
| `vite.config.*`, `webpack.config.*`, `rollup.config.*` | bundler configs |
| `.DS_Store`, `Thumbs.db` | OS cruft |

- **Size caps**: 50 MB per entry, 100 MB total uncompressed, 1000 entries max.
- **Zip-slip defense**: no absolute paths, no `..` segments, no symlinks.
- **Soft-skipped** (not copied, install continues): any file whose extension is
  outside the allowed set. Allowed: `manifest.json`, built `main`/`html`,
  `html`/`htm`/`css`/`svg`/`png`/`jpg`/`jpeg`/`gif`/`ico`/`woff`/`woff2`/`ttf`/
  `wasm`/`json`/`md`, `LICENSE`, `README.md`.

## 3. Create the GitHub Release

Upload the zip as a Release asset in the `folyn-extensions` repo. The asset's tag
convention is `<id>-<version>`:

```bash
gh release create <id>-<version> <id>-<version>.zip \
  --repo linyimin0812/folyn-extensions \
  --title "<display name> <version>" \
  --notes "Publish <id> <version>."
```

Example:

```bash
gh release create my-extension-0.1.0 my-extension-0.1.0.zip \
  --repo linyimin0812/folyn-extensions \
  --title "My Extension 0.1.0" \
  --notes "Initial release."
```

The resulting asset URL is:
`https://github.com/linyimin0812/folyn-extensions/releases/download/<id>-<version>/<id>-<version>.zip`

> **`downloadUrl` host must be `github.com`** — `install_extension_from_url`
> enforces this (SSRF defense). Release assets 302 to `objects.githubusercontent.com`;
> the host check only inspects the initial URL.

### Third-party publishers

Host the zip on **your own** GitHub Releases (a public repo), then PR the
`downloadUrl` (pointing at your release) into the `folyn-extensions` `catalog.json`.
The maintainer reviews manifest / permissions / tier and merges; users then see it
in the Store. See
[`folyn-extensions/CONTRIBUTING.md`](https://github.com/linyimin0812/folyn-extensions/blob/main/CONTRIBUTING.md).

## 4. Add the catalog entry

Edit `catalog.json` in the `folyn-extensions` repo (`main` branch). Add or
replace an entry in `extensions[]`:

```jsonc
{
  "extensions": [
    {
      "id": "my-extension",
      "name": { "zh": "我的扩展", "en": "My Extension" },
      "version": "0.1.0",
      "description": { "zh": "一句话描述", "en": "One-line description" },
      "tier": "trusted",
      "author": "Jane Doe",
      "icon": "<svg ...>...</svg>",
      "downloadUrl": "https://github.com/linyimin0812/folyn-extensions/releases/download/my-extension-0.1.0/my-extension-0.1.0.zip"
    }
  ]
}
```

### Field rules

| Field | Rule |
| --- | --- |
| `id` | **Must match** the zip's `manifest.json` `id` (kebab-case `^[a-z0-9]+(-[a-z0-9]+)+$`). `install_extension_zip` verifies. |
| `name` | Display name. Plain string (fallback for all locales) or `{ locale: text }`. |
| `version` | Must match the manifest `version`. |
| `description` | Plain string or `{ locale: text }`. Fallback: current locale → `zh` → `en` → first available. |
| `tier` | `"trusted"` \| `"sandbox"`. Trusted still needs 批准并授权 after install (TOFU). |
| `author` | Display string. |
| `icon` | **Match** the extension `manifest.json` `icon`: inline `<svg>...</svg>` text or emoji. The Store renders from `catalog.json`, the installed list from the local manifest — they must agree or the icon differs between the two views. |
| `downloadUrl` | Direct link to the GitHub Release zip asset. Host must be `github.com`. |

Open the PR against `main`. The Store fetches `catalog.json` via
`https://raw.githubusercontent.com/linyimin0812/folyn-extensions/main/catalog.json`
(Rust `fetch_url` proxies it — the webview can't cross-origin to
`raw.githubusercontent.com` directly). Users see new entries on the Store tab's
next refresh.

## 5. Update an already-published extension

Bump `version` in `manifest.json`, `pnpm build`, re-zip with the new
`<id>-<version>` tag, `gh release create` the new tag, and update the
`catalog.json` entry's `version` + `downloadUrl` (tag and asset name must agree).
MVP has **no auto-update check** — users uninstall + reinstall, or reinstall
from the Store to overwrite.

## Recap (one-liner each)

```bash
pnpm build                                                      # 1. → dist/
cd dist && zip -r -X ../<id>-<ver>.zip . -x "*.map" "*.DS_Store"  # 2. zip (manifest at root)
gh release create <id>-<ver> <id>-<ver>.zip \                   # 3. GitHub Release
  --repo linyimin0812/folyn-extensions --title "<name> <ver>"
# 4. PR catalog.json in folyn-extensions: id/name/version/description/tier/author/icon/downloadUrl
```
