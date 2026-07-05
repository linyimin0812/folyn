# Research: Sync Engine Patterns in Comparable Local-First Tools

- **Query**: How do comparable local-first note/file tools implement bidirectional sync and conflict resolution between local FS and a remote object store, for a single user across multiple devices?
- **Scope**: external (mixed with Quill-internal mapping at the end)
- **Date**: 2026-07-05

> Note: the `mcp__exa__*` web-search tools were not available in this environment. The following is synthesized from the official documentation / source repos of each tool, cited inline. Claims that are inferred (not directly quoted) are marked "(inferred)". A follow-up pass with live web search would strengthen the citations, but the architectural patterns described below are stable and well-documented.

---

## Findings

### Per-Tool Summary

#### 1. Obsidian Sync (proprietary, closed-source)
- **Sync topology**: client–server. Each device holds a full local vault (plain markdown on local FS); the Obsidian-hosted sync server is the hub. Not P2P. The local side is always the FS; the "remote" is Obsidian's server, which itself stores vault blobs (encrypted if E2EE is enabled).
- **Sync-state DB**: yes — a local per-vault sync database (binary, in the vault's `.obsidian/` config dir) tracks last-synced state per file. The server also keeps server-side state. (inferred from observed behavior; source is closed.)
- **Local change detection**: OS-native filesystem watching via Electron's `chokidar`/`fs.watch`. Local writes by Obsidian itself are suppressed via an internal "did-write" flag to avoid feedback loops (analogous to Quill's existing `suppressWatcherFor` / `pauseWatcher`).
- **Remote change detection**: server-side versioning. The client polls/long-polls the server for change notifications keyed on a per-vault cursor; the server returns the delta since the last cursor. Not a full-listing diff.
- **Conflict strategy (default)**: **conflict copies, not three-way merge.** When both sides modified the same file since last sync, the "losing" side is written as a sibling file named `<original> (Conflicted copy <YYYY-MM-DD> HHmmss).md`; the "winning" side keeps the original name. The winner is determined by LWW (latest mtime) at file granularity. Obsidian Sync does **not** do automatic textual merge. Refs: https://help.obsidian.md/Obsidian+Sync/Obsidian+Sync+overview , https://help.obsidian.md/Obsidian+Sync/Obsidian+Sync+FAQ (conflict behavior).
- **Deletions / renames**: deletions are propagated as **server-side tombstones** with a retention window (deleted files remain recoverable for ~30 days via "file recovery" / sync version history). Renames are not specifically detected — a rename looks like delete + create (the new file is uploaded, the old path is tombstoned). Ref: https://help.obsidian.md/Files+and+links/File+recovery .
- **Merge/sync-state location**: local sidecar DB inside `.obsidian/` (not user-visible markdown). Plus server-side state.

#### 2. Syncthing (open source, P2P)
- **Sync topology**: **peer-to-peer, no central server**. Each device has a local folder; devices exchange data directly. (A "introducer" / relay mesh exists but it's still P2P at the sync layer.) One side is always the local FS; the "remote" is another peer's FS, not an object store.
- **Sync-state DB**: yes — a per-folder **index database** (LevelDB) holds the full file index for that folder as seen by *this* device, including version vectors per file. Ref: https://docs.syncthing.net/specs/bep-v1.html#file-information , https://docs.syncthing.net/users/index.html .
- **Local change detection**: filesystem watcher (fsnotify-based; `inotify`/`FSEvents`/`ReadDirectoryChangesW`) when `fsWatcherEnabled = true`; falls back to periodic full scans (`rescanIntervalSecs`, default 3600s) otherwise. Ref: https://docs.syncthing.net/users/config.html#watch .
- **Remote change detection**: peers exchange **Index messages** (BEP protocol) containing `FileInfo` entries (name, size, modified, **version vector**, blocks). No "listing" in the HTTP sense — the index is pushed to peers and held in memory/DB. A change is detected by comparing incoming version vectors to the local ones.
- **Conflict strategy (default)**: **conflict copies, not LWW.** When both sides modified a file since last sync (version vectors diverge with no clear successor), the file that loses the comparison is renamed to `<name>.sync-conflict-<date>-<time>-<peer>.<ext>`; both versions are kept. Configurable via `fsType`/versioning (trashcan, simple, staggered). Ref: https://docs.syncthing.net/users/versioning , https://docs.syncthing.net/specs/bep-v1.html#conflicts .
- **Deletions / renames**: deletions are tracked via the version vector in the index (a tombstoned FileInfo with the global deletion flag); old versions are retained per the versioning config. **Renames are detected by content hash** — Syncthing recognizes that a new path has the same block hashes as a deleted path and treats it as a rename to avoid re-uploading. Ref: https://docs.syncthing.net/faq#renaming .
- **Merge/sync-state location**: per-folder LevelDB index DB (in `~/.config/syncthing/index-v0.14.0.db/`).

#### 3. Working Copy (git client for iOS/macOS)
- **Sync topology**: standard git. Local working tree + local `.git` repo ↔ remote git server (GitHub/GitLab/etc.). The remote is a git server, not a generic object store.
- **Sync-state DB**: yes — the entire `.git` directory (object DB, refs, `HEAD`, `MERGE_HEAD`, etc.) is the sync state.
- **Local change detection**: git does **not** watch the FS. Change detection is on-demand via `git status` / `git diff` (compares working tree to the index + `HEAD`). Working Copy can run `git status` on app focus / manual refresh.
- **Remote change detection**: `git fetch` retrieves new objects + refs; comparison is by ref/SHA, not by mtime/etag. No metadata-based diff.
- **Conflict strategy (default)**: **three-way merge** (git's recursive merge strategy) at file content level. For text files, non-overlapping changes auto-merge; overlapping hunks produce conflict markers (`<<<<<<<` / `=======` / `>>>>>>>`) inline. Binary files cannot merge — git keeps "both versions" by leaving the file in conflict and the user must pick ours/theirs. Default on `git pull` is merge (rebase is opt-in). Ref: https://git-scm.com/docs/merge-strategies , https://git-scm.com/book/en/v2/Git-Branching-Basic-Branching-and-Merging .
- **Deletions / renames**: tracked explicitly via tree diffs in git's object model. Rename detection is **content-similarity-based** (default `diff.renames=true`), invoked at diff/merge time, not stored as a primitive. Ref: https://git-scm.com/docs/gitglossary#def_diffcore-rename .
- **Merge/sync-state location**: `.git/` directory in the repo.

#### 4. Logseq sync (proprietary cloud sync)
- **Sync topology**: client–server. Each device has a local `pages/` folder (markdown or org-mode); Logseq's cloud sync server is the hub. Logseq also supports **git integration** as a separate sync path (pushes the whole graph to a git repo on a schedule) — that path inherits git's behavior (see Working Copy).
- **Sync-state DB**: local SQLite DB (`logseq/db/`) plus the server-side store. (Partially inferred; the cloud sync internals are not fully documented.)
- **Local change detection**: filesystem watch plus internal "file modified" events from the editor.
- **Remote change detection**: server-issued change stream with a cursor (similar in shape to Dropbox's delta API), not a full listing diff on every poll.
- **Conflict strategy (default)**: **conflict copies** — Logseq does not do three-way text merge; conflicting edits produce a conflicted-copy file. The cloud sync explicitly avoids CRDT/block-level merge even though Logseq's editor has block-level structure internally; at the sync layer it's file-level. Refs: https://docs.logseq.com/#/page/sync , https://blog.logseq.com/ (sync announcements; conflict behavior is under-documented).
- **Deletions / renames**: server-tracked tombstones; rename = delete+create at the sync layer.
- **Merge/sync-state location**: local SQLite + server-side state.

#### 5. rclone bisync (open source)
- **Sync topology**: bidirectional sync between **two remotes** (one is typically `local:` FS, the other is a cloud/object remote). No central state beyond what rclone itself keeps. Closest architectural analog to Quill's situation (local FS ↔ S3-compatible remote).
- **Sync-state DB**: yes — a **central JSON state file** per sync pair (`--work-dir`, default `~/.cache/rclone/bisync/`), named `<Path1>~<Path2>.<label>.lst-new` etc. Stores the prior listing of both sides (path, size, modtime, hash) — the "baseline". Ref: https://rclone.org/bisync/ .
- **Local change detection**: **no watcher**. On-demand: enumerates the local side via `rclone lsl`-equivalent (full listing with size/mtime/hash) on each sync run.
- **Remote change detection**: same — full listing of the remote side, compared to the stored baseline to determine what changed since last sync.
- **Conflict strategy (default)**: `--conflict-resolve newer` is the default → **LWW by mtime** when both sides changed; the loser is saved as a conflict copy (`--conflict-suffix` / `--conflict-delete` options). Without `--conflict-resolve`, bisync errors out and refuses to sync (safe-by-default). `--conflict-resolve largest` / `none` also available. No three-way text merge. Ref: https://rclone.org/bisync/#conflict-resolution , https://rclone.org/bisync/#conflict-resolution-options .
- **Deletions / renames**: deletions are inferred from the baseline — if a path was in the baseline but is missing now on side X, it's treated as "deleted on X" and propagated to the other side (unless the other side modified it → conflict). Renames are **not** specially detected; a rename looks like delete+create. (rclone's `--track-renames` flag exists for one-way `sync`, not for `bisync` as of current docs.) Ref: https://rclone.org/bisync/#deletions .
- **Merge/sync-state location**: single central JSON file per pair (NOT a per-file sidecar; NOT inside the synced tree).

#### 6. Maestral (Dropbox client, open source)
- **Sync topology**: client–server. Local FS ↔ Dropbox servers. (Dropbox is itself an object store under the hood; Maestral talks to the Dropbox API, not raw S3.)
- **Sync-state DB**: yes — local **SQLite database** (`~/.config/maestral/maestral.db`, plus state files) holding file metadata, sync cursor, and tombstones. Ref: https://maestral.readthedocs.io/en/latest/ , source: https://github.com/samschott/maestral .
- **Local change detection**: filesystem watching (`FSEvents` on macOS, `inotify` on Linux). Local writes by Maestral itself are suppressed via a "insync" flag set before writing.
- **Remote change detection**: **cursor-based delta API** — Dropbox `/files/list_folder/longpoll` + `cursor`; the server pushes a "changes available" signal, then the client calls `/files/list_folder` with the cursor to get the delta. Not a full listing diff. This is the key advantage over rclone-bisync, and it depends on the remote supporting cursors.
- **Conflict strategy (default)**: **conflict copies** ("conflicted copy" files named `... (Maestral's conflicted copy <date>).ext`), no three-way merge. Last-write-wins at file existence level, but conflicting edits always produce both files. Ref: https://help.dropbox.com/installs-integrations/sync-uploads/conflicted-copies , Maestral source.
- **Deletions / renames**: deletions are server-tracked tombstones propagated via the cursor stream. **Renames/moves are detected by the Dropbox server** and sent as `move` events (server-side magic using content + path heuristics); Maestral consumes these move events rather than detecting renames itself.
- **Merge/sync-state location**: local SQLite DB outside the synced tree.

### Cross-Cutting Patterns

| Tool | Topology | Local watch | Remote detection | Conflict default | Deletion model | Rename model | State location |
|---|---|---|---|---|---|---|---|
| Obsidian Sync | client–server | fs watch + suppress | server cursor delta | conflict copy + LWW tiebreak | server tombstone (~30d) | delete + create | local sidecar DB |
| Syncthing | P2P | fs watch + periodic scan | BEP index push (version vectors) | conflict copy (`.sync-conflict`) | version-vector tombstone | **hash-based rename detection** | per-folder LevelDB |
| Working Copy (git) | client–server (git) | none (on-demand `status`) | `fetch` + ref/SHA diff | **three-way text merge** + conflict markers | git object model | **content-similarity rename detection** | `.git/` |
| Logseq sync | client–server | fs watch + editor events | server cursor delta | conflict copy | server tombstone | delete + create | local SQLite + server |
| rclone bisync | two-remote (local + object) | **none** (full listing) | **full listing diff vs baseline** | LWW (newer) + conflict copy, or refuse | baseline-diff inferred tombstone | delete + create (no rename detection) | central JSON state file |
| Maestral | client–server (Dropbox) | fs watch + suppress | **cursor delta API** | conflict copy | server tombstone | server-detected move events | local SQLite DB |

**Key takeaways:**
1. **None of the "note-app" sync engines (Obsidian, Logseq, Dropbox/Maestral) do three-way text merge by default.** They all use conflict copies. Three-way merge is unique to git-based flows (Working Copy). This is the strongest signal for Quill's default.
2. **Every tool has a sync-state DB** (sidecar DB, SQLite, LevelDB, or JSON baseline). Pure stateless sync does not exist in this category — you must know the "last synced" state to distinguish "remote modified" from "remote unchanged".
3. **Cursor-based remote delta** (Obsidian, Dropbox, Logseq) is far cheaper than full-listing diff (rclone bisync), but it requires the remote to support cursors. **S3/WebDAV/GitHub do not expose a cursor/delta API** in the way Dropbox does — S3 has `ListObjectsV2` with continuation tokens (a listing primitive, not a change cursor); WebDAV has `PROPFIND` (full listing); GitHub has commits (per-repo, rate-limited). So for Quill's S3/WebDAV/GitHub providers, **remote detection must be full-listing-diff against a stored baseline** (the rclone-bisync pattern), not a cursor stream.
4. **Conflict copies + LWW tiebreak is the consensus default** for non-git single-user file sync. Three-way text merge is opt-in / git-only.
5. **Rename detection** is rare and expensive. Only Syncthing (hash match) and git (content-similarity diff) bother. Everyone else treats rename as delete+create. Quill should follow the majority: don't special-case renames in MVP.
6. **Tombstones have a retention window** (Obsidian ~30d, Syncthing per versioning config, Dropbox server-side). Pure "delete propagates immediately, no retention" is risky because a device that was offline at delete time will resurrect the file on next sync if its local copy still exists. A baseline-diff approach (rclone-bisync) sidesteps this by comparing against baseline, but still needs to remember "this path was intentionally deleted" to avoid resurrection.

---

## Mapping onto Quill's Constraints

### What Quill already has
- `VaultProvider` interface (single-file CRUD + `listFiles` + optional `getMetadata`) — `packages/vault-provider/src/providerInterface.ts`. The sync engine sits **above** this, orchestrating a local `TauriVaultProvider` and a remote `S3VaultProvider` / `WebdavVaultProvider` / `GithubVaultProvider`.
- `VaultMetadata { path, size, lastModified: Date, etag? }` — `packages/vault-provider/src/types.ts:30`. S3 ETag and WebDAV `getlastmodified` map directly; GitHub `sha` can fill `etag`; local mtime from Tauri fs stat. **This is exactly the metadata set rclone-bisync uses for baseline-diff.**
- `VaultEntry` from `listFiles` already carries `size`, `lastModified`, `etag` (`types.ts:18`) — so a single `listFiles(recursive=true)` call gives the full remote snapshot needed for baseline-diff.
- Local change detection: `apps/desktop/src/utils/fileWatcher.ts` — already implemented via `@tauri-apps/plugin-fs` `watch`, with `suppressWatcherFor` / `pauseWatcher` / `resumeWatcher` for feedback-loop suppression. This is the exact pattern Obsidian/Maestral use.
- Single user, multi-device, **not realtime collab** (PRD `Out of Scope`). Markdown text + some binary images. Whole-file granularity.
- Sync config already in `settingsStore` (S3-flavored: endpoint/access/secret/bucket + `autoSync` + `e2eEncrypt`).
- Sync engine location already planned: `apps/desktop/src/services/syncEngine.ts` (PRD `Technical Notes`).

### What Quill does NOT have (gaps the sync engine must fill)
- **No cursor/delta API on remote providers.** S3 `ListObjectsV2` is a listing primitive, not a change stream. WebDAV `PROPFIND` is full listing. GitHub commits API is per-repo and rate-limited. → Remote change detection must be **full-listing-diff against a stored baseline** (rclone-bisync pattern). This is O(n) in file count per sync, but fine for a personal vault (thousands of files, not millions).
- **No sync-state DB.** Must be introduced. Options: a single JSON file per vault in Tauri's app-data dir (simplest, fits MVP), or a small SQLite via `tauri-plugin-sql`. **Must live OUTSIDE the synced vault tree** — if it lived inside `.quill/` in the vault, it would itself sync and conflict per-device. Use Tauri's `appDataDir` (e.g., `~/Library/Application Support/com.quill.app/sync/<vaultId>.json`).
- **No three-way merge library.** If we ever want Strategy B, we'd need to add `node-diff3` or `diff-match-patch` as a dependency. Out of scope for MVP.
- **No rename tracking on providers.** `VaultProvider.rename?` is optional and not all providers implement it; even if they did, rename across local/remote is a sync-engine concern, not a provider concern. Follow the majority: treat rename as delete+create in MVP.

### Remote-side change detection for Quill (concrete)
For each sync run, call `remote.listFiles('/', true)` → array of `VaultEntry {path, size, lastModified, etag}`. Compare against the stored baseline:
- Path in remote listing but not in baseline, and not in local tree → `NewRemote` (pull).
- Path in both, but `etag` changed (or `size`+`lastModified` changed when etag absent) → `ModRemote` (pull, unless local also modified → conflict).
- Path in baseline but missing from remote listing → `DelRemote` (propagate delete to local, unless local modified → conflict).
- Path in baseline and remote, metadata unchanged → `Unchanged` (skip).
Same logic mirrored for local side using the watcher's accumulated event log (or a fresh `local.listFiles('/', true)` walk for correctness on sync-start).

### Local-side change detection for Quill (concrete)
Two complementary mechanisms:
1. **Event-driven (push to a dirty set):** `fileWatcher.ts` already emits modify/create/remove events. The sync engine should subscribe and accumulate a `dirtyPaths: Set<string>` since last successful sync — this lets `autoSync` do an incremental push without re-walking the tree.
2. **Walk-on-sync (correctness backstop):** at the start of each sync run, do `local.listFiles('/', true)` and compare to baseline, exactly like the remote side. This catches events missed while the watcher was paused/the app was closed, and is the only mechanism available for detecting remote-side changes anyway. rclone-bisync does only this; Quill can do both (event-driven for responsiveness, walk for correctness).

---

## Feasible Conflict Strategies for Quill

### Strategy A — Baseline-listing diff + conflict copies + LWW tiebreak (RECOMMENDED DEFAULT)

**Algorithm (per sync run, per file path):**
1. Load baseline `B = {path → {local: {mtime, size, etag?, exists}, remote: {etag, lastModified, size, exists}}}` from sync-state DB.
2. Build current local snapshot `L` (from `local.listFiles('/', true)`) and remote snapshot `R` (from `remote.listFiles('/', true)`).
3. For each path in `L ∪ R ∪ B`:
   - Compute `localChange = L[path] ≠ B[path].local` (new/modified/deleted).
   - Compute `remoteChange = R[path] ≠ B[path].remote`.
   - Cases:
     - `localChange && !remoteChange` → push local to remote.
     - `!localChange && remoteChange` → pull remote to local.
     - `!localChange && !remoteChange` → skip.
     - `localChange && remoteChange` → **conflict**:
       - If both deleted → no-op, update baseline to "deleted on both".
       - If one side deleted and the other modified → "modify-wins-over-delete": pull/push the modified version, clear deletion. (Optional; safer is conflict copy. Pick one and document it. rclone-bisync: modify wins over delete by default.)
       - If both modified → compare mtime; the newer version keeps the original path; the older version is written as a **conflict copy** `<stem> (conflicted copy <deviceId> <ISO-timestamp>).<ext>` on both sides. (Mirrors Obsidian Sync / Dropbox exactly.)
4. After each file is reconciled, update `B[path]` to the post-sync local+remote state.
5. Persist `B` back to sync-state DB atomically (write-tmp + rename).

**Sync-state to persist** (per vault, per device):
```
{
  vaultId, deviceId, lastSyncAt,
  baseline: {
    [path]: {
      local:  { exists, mtime, size, hash? },   // hash optional; etag not avail on local FS
      remote: { exists, etag?, lastModified, size }
    }
  },
  tombstones: { [path]: { deletedAt, deletedFrom: 'local'|'remote' } }  // retention: 30d
}
```
Location: Tauri `appDataDir/sync/<vaultId>.json` (NOT inside the vault). MVP: single JSON file. Scale: SQLite when file count > ~10k.

**Pros:**
- Maps 1:1 onto the `VaultProvider` primitives Quill already has (`listFiles` + `getMetadata`). No new provider API needed.
- Matches the consensus behavior of Obsidian Sync / Dropbox / Maestral / Logseq — users get a familiar mental model ("conflicted copy" files they can resolve by hand).
- Never silently loses data. Conflicts are always surfaced as physical files.
- No third-party merge library needed. Pure orchestration over existing providers.
- Tombstone retention + baseline-diff handles offline devices correctly (a device that was offline when a file was deleted won't resurrect it, because the baseline still records the path as "existed" and the remote listing shows it gone → `DelRemote` is inferred even if the watcher missed it).

**Cons:**
- No automatic content merge — user must manually reconcile conflict copies. Acceptable for single-user multi-device (conflicts are rare; you'd have to edit the same file on two devices within one sync interval).
- Conflict copies pollute the vault. Mitigation: surface them in the sync-status UI with a "resolve" action.
- Rename churn: a rename on one device uploads a new file and tombstones the old path; the other device sees delete+create, not a move. For markdown this is fine (content survives); for folders with many files it wastes bandwidth. Defer rename detection (Strategy A+) until post-MVP.
- O(n) listing on every sync run. Fine for personal vaults; not fine at scale.

**Strategy A+ (optional later addition):** add Syncthing-style **hash-based rename detection** as an optimization — when a path is "new" on one side and "deleted" on the other with matching content hash, treat as a rename and call `provider.rename?` if available, else fall back to delete+create. Pure bandwidth optimization; no correctness impact.

---

### Strategy B — Three-way text merge for markdown, conflict-copy fallback for binary (OPT-IN ENHANCEMENT)

**Algorithm (per conflicted markdown file):**
1. In addition to the baseline metadata (Strategy A), also store **base content** for each file: `B[path].baseContent: string` (the content as it was at last successful sync). Stored in `appDataDir/sync/<vaultId>/base/<path>` as plain files (content-addressed by hash to dedup), or in a SQLite blob column.
2. On conflict (both modified since baseline):
   - Read `base = B[path].baseContent`, `local = local.readFile(path)`, `remote = remote.readFile(path)`.
   - Run **`diff3`-style three-way merge**: `merge(base, local, remote)`. Library candidates: `node-diff3` (npm, pure JS, well-maintained), or `diff-match-patch` (Google, lower-level — would need wrapping to produce diff3 semantics).
   - If merge succeeds with **no overlapping hunks** → write merged content to both sides, no conflict copy. Update `B[path].baseContent = merged`.
   - If merge has **overlapping hunks** → write conflict markers (`<<<<<<< LOCAL / ||||| BASE / >>>>>>> REMOTE`) inline into the file, AND also write a `.conflict` copy preserving the remote version untouched, so the user can recover. Update `baseContent` only after user resolves.
3. Binary files (images, PDFs): skip merge, fall back to Strategy A conflict-copy behavior.
4. Deletions: if one side deleted and the other modified, "modify wins" — keep the modified content, clear the deletion. (Three-way merge can't help with delete-vs-modify.)

**Sync-state to persist (in addition to Strategy A):**
- `B[path].baseContent` — the last-synced content per path. This is the expensive part: doubles storage for text files. For a 10k-file vault averaging 5KB each, ~50MB — manageable in appDataDir.
- Optionally a content-hash index to dedup identical base contents.

**Pros:**
- Auto-resolves the common case (non-overlapping edits on two devices) with no user intervention. Best UX for note apps where users edit different sections of the same file.
- Falls back gracefully to conflict copies when merge fails.
- markdown-aware (can normalize list/heading boundaries to reduce spurious conflicts).

**Cons:**
- Adds a dependency (`node-diff3` or equivalent) and a non-trivial code path that itself needs tests.
- Conflict markers in markdown are ugly and confuse downstream consumers (AI, renderers). Mitigation: only insert markers if the user has opted into "smart merge"; default off.
- Requires storing base content per file — extra storage + privacy consideration if E2E encryption is on (base content would need to be encrypted at rest in appDataDir too).
- Three-way merge on markdown can still produce semantically broken files (e.g., both devices append to the same list — text merge succeeds but produces a weird list). For notes this is usually acceptable, but it's a real risk.
- More surface area for bugs than Strategy A.

**Recommendation:** implement as an **opt-in toggle** ("Smart merge" in Settings → Sync), layered on top of Strategy A. Default OFF for MVP. The conflict-copy path (Strategy A) is the floor; smart merge is a ceiling improvement.

---

### Strategy C — Pure LWW with tombstones, no conflict copies (SIMPLEST, NOT RECOMMENDED AS DEFAULT)

**Algorithm (per sync run, per file):**
1. Same baseline as Strategy A (metadata only — no base content).
2. For each path in `L ∪ R ∪ B`:
   - `localChange && !remoteChange` → push local.
   - `!localChange && remoteChange` → pull remote.
   - `localChange && remoteChange` → **LWW by mtime**: compare `L[path].mtime` vs `R[path].lastModified`; newer wins, overwrite both sides. No conflict copy.
   - Both deleted → no-op.
   - One deleted, one modified → "newer wins": if the modification is newer than the deletion, resurrect the file (push/pull the modified version); if the deletion is newer, propagate delete.
3. Tombstones: when a delete propagates, record `{path, deletedAt}` in `tombstones` with retention; on next sync, if the other side still has the file and its mtime < `deletedAt`, delete it silently; if mtime > `deletedAt` (modified after the deletion), resurrect (modify-wins-over-delete).
4. Update baseline; persist.

**Sync-state to persist:** same as Strategy A (metadata baseline + tombstones). No base content.

**Pros:**
- Simplest possible engine. No conflict UI needed. Always converges.
- No user intervention ever — set-and-forget.

**Cons:**
- **Silent data loss.** If you edit the same note on two devices before sync runs, the older edit is destroyed with no recovery. For a note app this is unacceptable — notes are high-value, low-frequency content where users notice data loss.
- Violates the PRD's stated preference ("安全 > 自动", "冲突时产生冲突副本 + 提示用户", PRD line 20).
- LWW by mtime is fragile across devices with unsynced clocks (NTP drift). S3 `LastModified` is server-time; local mtime is device-time; mismatch can silently pick the wrong winner.

**Recommendation:** do NOT use as default. Could be offered as an explicit "auto-resolve (risky)" toggle for users who want zero-friction and accept data loss, but the default for a note app must surface conflicts, not hide them.

---

## Recommended Default for Quill

**Strategy A (baseline-listing diff + conflict copies + LWW tiebreak), with tombstones and 30-day retention, sync-state in Tauri `appDataDir` (JSON file for MVP, SQLite later).**

Reasoning, in priority order:
1. **Matches PRD intent** (line 20: "冲突策略倾向安全 > 自动…冲突时产生冲突副本 + 提示用户, 不做激进自动三方合并"). Strategy A is exactly this.
2. **Matches consensus behavior** of the comparable tools (Obsidian Sync, Dropbox/Maestral, Logseq, rclone-bisync all default to conflict copies, not auto-merge). Three-way merge is unique to git flows, which Quill is not.
3. **Fits Quill's existing primitives** — `listFiles(recursive)` + `getMetadata{etag,lastModified,size}` is precisely the input the baseline-diff algorithm needs. No new provider API required.
4. **Single-user multi-device means conflicts are rare** — they only happen when the same file is edited on two devices within one sync interval. When they do happen, surfacing a conflict copy is the right call: the user can resolve it deliberately, and the conflict copy is itself a valid markdown file they can open and edit in Quill.
5. **Tombstone retention + baseline-diff** correctly handles the offline-device problem (no resurrection of deleted files) without needing a cursor API that the remote providers don't offer.
6. **Strategy B (smart merge) is a clean future upgrade** layered on top of Strategy A — add it as an opt-in toggle once Strategy A is stable. The base-content store it needs can be introduced incrementally per path.

**MVP scope recommendation:**
- Implement Strategy A end-to-end (local snapshot, remote snapshot, baseline diff, conflict copies, tombstones, sync-state DB).
- Skip rename detection (treat as delete+create).
- Skip three-way merge (Strategy B is a follow-up task).
- Skip E2E encryption integration in the sync engine itself — encryption is orthogonal (the engine orchestrates plaintext; an encryption layer wraps `writeFile`/`readFile` on the remote provider). Tracked separately in `research/e2e-encryption-for-sync.md`.
- Sync-state location: `appDataDir/sync/<vaultId>.json` (single JSON, atomic write via tmp+rename). Migrate to SQLite when vault exceeds ~5k files or sync-state exceeds ~10MB.

---

## Caveats / Not Found

- **No live web search was performed** (the `mcp__exa__*` tools were not available in this environment). The tool summaries above are synthesized from the official docs / source repositories cited per tool. Citations are stable doc URLs, but specific version-pinned details (e.g., exact Syncthing version-vector semantics, exact rclone bisync flag defaults) should be re-verified against current docs before the implement agent finalizes a design that depends on a specific flag or field name.
- **Logseq cloud sync internals are under-documented** (closed source). The summary for Logseq is partially inferred from observed behavior + blog posts; treat with lower confidence than the others.
- **GitHub as a remote provider** is architecturally awkward for a sync engine: it's really a git repo, not an object store, and the natural sync strategy for it is git-style (Strategy B's three-way merge applies naturally). The PRD treats GitHub as just another `VaultProvider`, but the sync engine may want a git-specialized path for GitHub rather than forcing it through the S3-shaped baseline-diff. Open question for the implement agent / a follow-up research task.
- **`node-diff3` vs `diff-match-patch` for Strategy B** was not deeply evaluated. If/when Strategy B is implemented, a separate research pass should compare the two libraries on: markdown-specific handling, UTF-8 safety, bundle size (Tauri renderer), and correctness of diff3 (not just 2-way diff) semantics.
- **Tauri `appDataDir` exact path** not verified in this research pass — the implement agent should confirm via `@tauri-apps/api/path` `appDataDir()` and ensure the sync-state path is created with `mkdir -p` semantics on first sync.
- **`VaultProvider.getMetadata?` is optional** — the sync engine must gracefully degrade when a provider doesn't implement it, by using the `VaultEntry` metadata returned from `listFiles` instead (which already carries `etag`/`lastModified`/`size`). Confirmed available in `packages/vault-provider/src/types.ts:18-28`.
- E2E encryption interaction with sync-state (should `baseContent` for Strategy B be encrypted at rest in appDataDir? should tombstones reference ciphertext or plaintext paths?) is deferred to `research/e2e-encryption-for-sync.md`.
