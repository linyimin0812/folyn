# PRD: Vault HTML folder export names folder after vault

## Problem

When exporting an entire vault to an **HTML folder** (`exportVaultToHtml` folder
mode), the export writes `index.html` + `docs/` directly into the directory the
user picks. The picked directory keeps its own (arbitrary) name, so the exported
product is not self-identifying and pollutes the chosen folder.

The user expects:
1. The export to produce a **folder named after the vault**.
2. `index.html` (and `docs/`) to live **inside** that vault-named folder.

## Current behavior

`apps/desktop/src/services/export/vaultExport.ts` — `exportVaultToHtml('folder')`:

```ts
const picked = await open({ directory: true, multiple: false });
const outDir = picked as string;                 // ← picked dir used directly
const docsDir = await join(outDir, 'docs');
// writes ./index.html and ./docs/* into picked dir
```

Note inconsistency: `uploadVaultFolderToCloud` (cloud folder upload) already
keys objects under `${safeName}/index.html` and `${safeName}/docs/...`, so the
cloud path names the folder after the vault — only the local download path does
not.

## Desired behavior

Local folder download matches the cloud folder upload: create a `<vaultName>/`
subfolder inside the picked directory, write `index.html` + `docs/` into it.

```ts
const picked = await open({ directory: true, multiple: false });
const safeName = vaultName.replace(/[/\\]/g, '_');   // same sanitization as single/cloud
const outDir = await join(picked as string, safeName);
if (!(await exists(outDir))) await mkdir(outDir, { recursive: true });
const docsDir = await join(outDir, 'docs');           // unchanged from here on
```

- Tauri's `open({ directory: true })` only picks an existing directory; creating
  a `<vaultName>` subfolder is the only way to name the product folder after the
  vault.
- Sanitization reuses the existing `vaultName.replace(/[/\\]/g, '_')` used by
  single-mode download and cloud folder upload → consistent across all three
  folder/file exports.
- If a `<vaultName>` folder already exists at the picked location, merge/overwrite
  individual files (same behavior as the cloud path; no collision handling — YAGNI).

## Out of scope

- No i18n key changes. `folder.label` ("HTML 文件夹" / "HTML folder") and
  `folder.desc` ("index.html + 每篇文档一个 HTML" / "index.html + one HTML per
  document") remain accurate after the change.
- No UI/dialog changes — the user still picks a parent directory; the vault-named
  subfolder is created automatically.

## Acceptance

- [ ] Folder-mode export creates `<picked>/<vaultName>/` (sanitized) and writes
      `index.html` + `docs/*.html` inside it.
- [ ] Single-mode and cloud folder/single upload behavior unchanged.
- [ ] `tsc --noEmit` on `vaultExport.ts` green.
