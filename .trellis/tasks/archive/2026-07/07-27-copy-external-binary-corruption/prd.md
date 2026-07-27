# Copy external file: binary corruption via text API

## Symptom

Copying an opened external file into the vault, then opening the copied file,
throws (from `@file-viewer/react`):

```
Error: End of data reached (data length = 168782487, asked index = 168783885). Corrupted zip ?
```

i.e. the copied file is **corrupted / truncated** for binary file types
(zip / xlsx / epub / images — anything `@file-viewer` parses as a zip).

## Root cause

`vaultStore.copyExternalFileToVault` reads the external source via
`externalFileProvider.readFile` → Tauri `readTextFile` (UTF-8 **text**), and
writes it via `manager.writeFile` → Tauri `writeTextFile` (UTF-8 **text**).

Both halves go through a UTF-8 `string` round-trip. For **binary** bytes that
are not valid UTF-8 (raw deflate, zip headers, image bytes), the
decode→encode is not byte-preserving: invalid sequences get replaced and the
re-encoded length differs from the source, so the destination is shorter /
corrupted. The existing `copyPath` has the same text-only limitation but is
only ever called on vault markdown notes, so it never surfaced.

The `VaultProvider.readFile/writeFile` interface is typed `string` (the editor
uses it for text content), so a byte-preserving copy needs **separate binary
read/write methods**.

## Fix

Add binary (byte-preserving) read/write alongside the existing text methods
(do **not** change the text `readFile`/`writeFile` — the editor depends on
their `string` shape):

1. `externalFileProvider.readFileBytes(path): Promise<Uint8Array>` — Tauri
   `readFile` (binary), same `$HOME` scope check + `~`/`$HOME` resolution.
2. `VaultProvider.writeFileBytes?(path, bytes: Uint8Array): Promise<void>` —
   optional binary write on the provider interface.
3. `TauriVaultProvider.writeFileBytes` — Tauri `writeFile` (binary) + parent
   `mkdir` (mirror `writeFile`).
4. `VaultManager.writeFileBytes` — delegate to provider (or no-op if the
   provider doesn't implement it).
5. `vaultStore.copyExternalFileToVault` — use `readFileBytes` +
   `manager.writeFileBytes` instead of the text `readFile`/`writeFile`.

## Acceptance Criteria

- [ ] Copying a binary external file (e.g. a `.xlsx` / zip) into the vault
  produces a **byte-identical** destination (verified via a regression test).
- [ ] The regression test uses an input `Uint8Array` containing bytes that are
  **not valid UTF-8** (e.g. `[0x80, 0xff, 0x00, 0x7f, 0xc3, 0x28]`) and asserts
  the bytes written to the vault equal the bytes read — byte-for-byte.
- [ ] Text files (`.md`) still copy correctly (no regression on the common case).
- [ ] `tsc` passes; `pnpm test` green; no new failures.

## Definition of Done

- Binary read/write methods on `externalFileProvider`, `VaultProvider`,
  `TauriVaultProvider`, `VaultManager`.
- `copyExternalFileToVault` switched to the binary path.
- Regression test at the store seam (mocked `externalFileProvider.readFileBytes`
  returns a `Uint8Array` of non-UTF-8 bytes; fake manager's `writeFileBytes`
  captures the `Uint8Array`; assert byte equality). This is the correct seam —
  it exercises the real copy call-site's fidelity contract.
- Commit message names the root cause (text-API round-trip corrupts non-UTF-8
  bytes) so the next debugger learns it.

## Out of Scope

- Migrating the editor's text `readFile`/`writeFile` to binary (separate, large
  change; the editor legitimately wants decoded text).
- `copyPath` (vault-internal) — text-only is fine for its markdown-only scope;
  not changing.
