# Research: Atomic Write Pattern (temp + rename)

- **Query**: Does `settingsPersistence.ts` / `storageClient.ts` already do atomic writes (temp file + rename)? If yes, document the helper. If no, document the simplest available pattern. Note the debounce/single-writer pattern currently in use.
- **Scope**: internal
- **Date**: 2026-07-29

## Findings

### No atomic write helper exists in the codebase

`grep -E 'rename|tmp|temp|atomic'` across `**/*.{ts,rs}` returned no matches for any temp-file-then-rename utility used for config writes. Existing write sites all use `writeTextFile` directly:

- `apps/desktop/src/utils/storageClient.ts:47` — `await writeTextFile(filePath, JSON.stringify(cache, null, 2));` (the unified `storage.json` blob).
- `apps/desktop/src/services/modelRegistry/userProvidersCatalog.ts:65` — `await writeTextFile(filePath, JSON.stringify(file, null, 2) + '\n');` (per-provider `models.json`).
- `apps/desktop/src/utils/sessionStorage.ts:34, 77` — same pattern.

No `renameFile` usage in any TS service module. The `@tauri-apps/plugin-fs` plugin exports both `writeTextFile` and `renameFile` (and `copyFile`), but only `writeTextFile` is used.

### Simplest atomic-write pattern available in the codebase

Tauri fs plugin (`@tauri-apps/plugin-fs`) provides `renameFile`. The minimal pattern:

```ts
import { writeTextFile, renameFile, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';

async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.tmp.${Date.now()}`;
  await writeTextFile(tmp, JSON.stringify(data, null, 2));
  await renameFile(tmp, path);
}
```

Caveat on Tauri fs plugin: `renameFile` requires the destination's parent dir to exist and (per plugin semantics) overwrites the target on POSIX. On Windows, `renameFile` to an existing target fails — would need `remove` first. For this codebase (macOS-primary, cross-platform desktop), POSIX rename is sufficient; if Windows support is required, gate the `remove` call on `exists(path)` before `renameFile`.

Alternative: `@tauri-apps/plugin-fs` also exposes `writeTextFile` with an `OpenOptions`-style API in newer versions, but the temp+rename sequence is the only true-atomic option. The bundled plugin version isn't inspected here.

### Current debounce / single-writer pattern

`apps/desktop/src/store/settingsPersistence.ts:57-68` — the single-writer debounced persist:

```ts
const debouncedPersist = debounce(() => {
  const blob = collectPersistedBlob();
  void storageClient.set(SETTINGS_STORAGE_KEY, blob);
  void (async () => {
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('pet://settings-updated', blob);
    } catch { /* non-tauri or emit failed */ }
  })();
}, 300);
```

`schedulePersist()` (settingsPersistence.ts:75-77) is the single entry every store setter calls. 300ms trailing edge, single-writer. Slice registration via `registerPersistSlice` (settingsPersistence.ts:29-31).

`apps/desktop/src/utils/storageClient.ts:54` — its own second debounce layer:

```ts
const scheduleFlush = debounce(flushImpl, FLUSH_DELAY);  // FLUSH_DELAY = 300
```

`storageClient.ts:38-52` `flushImpl` does the actual `writeTextFile` call. So writes are 300ms (settingsPersistence debounce) → 300ms (storageClient debounce) → disk. Non-atomic.

### Recommendation for the new `providerConfigStorage.ts` module

Since the new module lives alongside `userProvidersCatalog.ts` (both under `~/.quill/providers/`) and writes small maps infrequently, the simplest correct pattern is:

1. Use `getUserProvidersDir()` from `userProvidersCatalog.ts:36-41` to resolve paths.
2. Write to `<target>.tmp` then `renameFile` to `<target>` (atomic on POSIX).
3. Skip the debounce — provider config writes are user-driven (drawer save, settings page blur), low frequency. The single-writer invariant is enforced by the store setter being the only caller.

`ponytail:` comment to leave: `// ponytail: no debounce — provider config writes are user-gated, low-frequency; atomic temp+rename is enough. Add a coalescer if settings-page blur triggers > 1 write/sec.`

## Files Found

| File Path | Description |
|---|---|
| `apps/desktop/src/store/settingsPersistence.ts` | Debounced single-writer for `settings:all` blob; 300ms |
| `apps/desktop/src/utils/storageClient.ts` | `storage.json` read/write + 2nd 300ms debounce; non-atomic `writeTextFile` |
| `apps/desktop/src/services/modelRegistry/userProvidersCatalog.ts` | Per-provider `models.json` writer — non-atomic `writeTextFile`; same dir as the new module |
| `apps/desktop/src/utils/debounce.ts` | The shared debounce helper |

## Caveats / Not Found

- The `@tauri-apps/plugin-fs` version installed isn't inspected; `renameFile`'s cross-platform semantics (esp. Windows overwrite behavior) need a quick doc check before relying on temp+rename as truly atomic.
- If atomicity matters for the `~/.quill/providers/{id}/models.json` cache too (currently non-atomic), the same helper could be retro-fit — out of scope for this PRD.
