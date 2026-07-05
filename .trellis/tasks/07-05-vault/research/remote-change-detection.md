# Research: Remote Change Detection on S3 / WebDAV / GitHub for Incremental Sync

- **Query**: How to efficiently detect remote changes on S3-compatible and WebDAV object storage for incremental sync, without re-downloading file bodies
- **Scope**: external (API semantics) + internal (mapping onto `@quill/vault-provider`)
- **Date**: 2026-07-05
- **Note on sources**: This agent had no live web-search tool in this session. The API semantics below are stable, well-documented public facts. Canonical doc URLs are cited inline. Verify any version-specific detail (rate limits, header names) against the live docs before finalizing implementation.

## TL;DR for Quill

- The realistic remote-change-detection primitive is **metadata-only listing** (S3 `ListObjectsV2`, WebDAV `PROPFIND`, GitHub `git/trees`+`commits`). None of these download file bodies — they return per-path metadata (etag/size/lastModified/sha) you can diff against a persisted "last-synced manifest".
- **S3 ETag is NOT a content hash for multipart uploads** — it's `MD5(concat(per-part MD5s))-"<partCount>"`. For non-multipart PUTs it's the MD5 of the content. Mitigation: never compare ETags alone for "content same?" across clients; compare `Size + lastModified + ETag` and additionally store your own content hash (e.g. SHA-256, or Git blob SHA) at sync time for multipart-keyed objects.
- **Polling is the only realistic path for a desktop app.** S3 has EventBridge→webhook but needs a public endpoint. WebDAV has no push. GitHub has webhooks but needs a server. So: poll on a debounce, persist a manifest, diff.
- Recommended manifest shape: `Record<normalizedPath, { etag?, size, lastModifiedMs, contentHash?, remoteKey }>`. Persist **locally** at `.quill/sync-state.json` (per-vault), keyed by remote backend; do NOT write per-file `.quill-meta` sidecars on the remote (extra objects, extra cost, breaks E2E-encryption invariant). ETag pitfall handled by storing `contentHash` computed at push-time.
- **Cost**: S3 = 1 `ListObjectsV2` (paginated, 1000/page). WebDAV = 1 `PROPFIND Depth: infinity` if allowed, else per-dir recursive. GitHub = 1 `git/trees?recursive=1` + optional `commits` comparison.

---

## Findings

### 1. S3-compatible (ListObjectsV2, HeadObject, ListObjectVersions)

#### 1.1 `ListObjectsV2` (the workhorse)

`GET /?list-type=2` on a bucket returns up to 1000 keys/page (paginated via `NextContinuationToken`). Each `<Contents>` entry includes:

| Field | What it is | Use for change detection |
|---|---|---|
| `Key` | object path | manifest key |
| `ETag` | object ETag (see pitfall) | weak signal; combine with Size |
| `Size` | bytes | strong signal for "content differs" when combined with hash |
| `LastModified` | server-set mtime (ISO 8601, UTC) | monotonic per object; good "touched since" signal |
| `StorageClass` | storage class | not needed for sync diff |

One `ListObjectsV2` with a `Prefix` covering the vault root is **one request** returning the entire tree metadata (paginated but still O(1) requests per 1000 keys). This is the recommended primitive — avoid the N+1 `HeadObject`-per-key pattern.

Docs: AWS S3 ListObjectsV2 — `https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html`

#### 1.2 `HeadObject` (single key)

`HEAD /<key>` returns headers `ETag`, `Content-Length`, `Last-Modified`, `x-amz-version-id`, `x-amz-storage-class` — no body. Useful when you already know one path changed (e.g. webhook) and want a single stat. **Do not loop HeadObject over all keys** — that's the N+1 anti-pattern; use `ListObjectsV2` instead.

Docs: `https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html`

#### 1.3 Versioning buckets

If the bucket has `Versioning=Enabled`, `ListObjectVersions` (`?versions` on bucket) returns all versions per key with `VersionId`, `IsLatest`, and per-version ETag/LastModified/Size. For sync you usually only care about `IsLatest=true` (the live version). Enable versioning only if you need server-side history; otherwise it complicates the manifest (multi-version per key).

Docs: `https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectVersions.html`

#### 1.4 THE multipart-ETag pitfall

For an object uploaded via a single `PUT Object`, `ETag = MD5(content)` — a true content hash.

For an object uploaded via **multipart upload** (`CreateMultipartUpload` + `UploadPart` + `CompleteMultipartUpload` — which AWS SDKs auto-use above a threshold, ~8 MiB for the JS SDK's default `multipartUploadThreshold`), the ETag is:

```
ETag = MD5( concat( MD5(part_1) || MD5(part_2) || ... || MD5(part_n) ) ) + "-" + n
```

e.g. `8e9d3a1c2b5f...-7`. The part size and count are **not encoded**, so two clients using different part sizes will produce **different ETags for byte-identical content**. Therefore:

- Comparing ETags across clients/uploads is unreliable for "same content?".
- Comparing ETag against the *same* ETag you stored last sync *for the same object key* (without re-uploading via multipart) IS reliable for "did this object change since I last saw it?" — because if the object didn't change, its ETag is stable. The pitfall bites only when you try to use ETag as a content-DUP check across independently-uploaded copies.

**Mitigations for Quill sync:**

1. Compare `Size` first — if size differs, content definitely differs.
2. If size is equal, compare `(ETag, LastModified)` against last-synced manifest entry for that exact key. Same ETag → unchanged (you uploaded it last time; if remote re-uploaded via multipart with different part size, ETag changes and you'll treat it as modified → safe-fail to "needs fetch").
3. For authoritative content-equality (needed by E2E-encryption mode where remote body is ciphertext and ETag is over ciphertext anyway), store a **`contentHash`** computed client-side at push time (SHA-256 of the *plaintext*, or Git blob SHA of the plaintext). Persist it in the local manifest. On pull, compare remote `contentHash`... but you don't have it remotely. So really the rule is: `contentHash` lets you decide "is my local copy already equal to what I'd push?" without re-fetching; for "did remote change?" you fall back to `(Size, ETag, LastModified)`.
4. Optionally: force the S3 client to use `PUT Object` (single-shot) for files under the multipart threshold, and a **fixed part size** for multipart uploads, so ETags are reproducible across this app's own uploads. This still doesn't help when a *different* client (e.g. another device, or rclone) uploaded the object.

Reference: AWS ETag behavior — `https://docs.aws.amazon.com/AmazonS3/latest/API/API_Object.html` (ETag field notes); common community writeups document the multipart formula.

#### 1.5 Push alternatives (not viable for desktop)

- **S3 Event Notifications → EventBridge → HTTP webhook**: works only if you own a public endpoint to receive the webhook. A Tauri desktop app is not a server. Skip.
- **S3 Inventory**: daily-exported CSV of all objects+ETags. Useful for audits, too coarse for interactive sync.
- **Long-poll**: not offered by S3.

Conclusion: **poll**.

---

### 2. WebDAV (RFC 4918)

#### 2.1 `PROPFIND`

`PROPFIND` method with an XML `propfind` body listing requested properties. Response is a `207 Multi-Status` XML with one `<response>` per resource.

Requested props (using `DAV:` namespace):

| Property | Meaning |
|---|---|
| `DAV:getetag` | opaque etag (quoted string, e.g. `"abc123"`) |
| `DAV:getlastmodified` | HTTP-date (RFC 1123, e.g. `Mon, 01 Jan 2026 00:00:00 GMT`) |
| `DAV:getcontentlength` | size in bytes |
| `DAV:resourcetype` | collection (`<collection/>`) vs leaf — needed to walk dirs |

RFC 4918 §15 — `https://www.rfc-editor.org/rfc/rfc4918#section-15`

#### 2.2 `Depth` header (critical)

`Depth: 0` → just the resource itself.
`Depth: 1` → resource + immediate children (one level).
`Depth: infinity` → entire subtree in one request.

`Depth: infinity` is the obvious fit for "list the whole vault in one request", **but RFC 4918 §9.1 allows servers to forbid it**: many servers return `403 Forbidden` for `Depth: infinity` on large trees (performance / DoS protection). Notable:

- **Nextcloud/ownCloud**: allows `Depth: infinity` by default but admins can disable; very large trees may be capped.
- **Apache mod_dav**: configurable `DavDepthInfinity` directive, off by default in some distros.
- **Box, pCloud, generic servers**: frequently reject `Depth: infinity`.

**Fallback strategy for Quill WebDAV provider**: try `PROPFIND Depth: infinity` first; on `403`/`501`/`400` fall back to recursive per-directory `Depth: 1` walk (cache dir list, recurse into each collection). Track visited dirs to avoid loops (WebDAV allows cycles via bindings, rare).

#### 2.3 Listing a tree efficiently

Single request when infinity allowed. Otherwise:

```
queue = [vaultRoot]
while queue:
  dir = queue.pop()
  resp = PROPFIND dir, Depth:1, props=[getetag,getlastmodified,getcontentlength,resourcetype]
  for entry in resp:
    if entry is collection and entry.path != dir: queue.push(entry.path)
    else if entry is leaf: manifest[entry.path] = {etag,size,lastModified}
```

Cost = O(dirs) requests. For a typical vault (hundreds of dirs) that's hundreds of requests — slower than S3's one list but acceptable for debounce-poll.

#### 2.4 ETag semantics on WebDAV

`getetag` is **opaque** per RFC 4918 — the server picks what it means. In practice:

- Apache mod_dav: `inode + mtime + size` hash (changes when file changes).
- Nextcloud: internal fileid-based etag, rotates on content change.
- Some servers: weak etags (`W/"..."`).

Treat `getetag` as **change-token** (good for "did this resource change since I last saw this exact etag?"), NOT as a content hash. Combine with `getcontentlength` and `getlastmodified` for robustness. If a server doesn't return `getetag` (it's optional — RFC 4918 §15 says servers SHOULD but not MUST), fall back to `getlastmodified + getcontentlength`.

`getlastmodified` precision is HTTP-date (1-second granularity). Sub-second changes can collide on mtime — `getetag` matters there.

#### 2.5 Push: none

WebDAV has no push. Poll.

---

### 3. GitHub Contents API vs git/trees vs commits

GitHub is a git backend, so change detection is natively content-addressed.

#### 3.1 Per-file `sha` = git blob SHA

The `sha` returned by `GET /repos/{owner}/{repo}/contents/{path}` (Contents API) is the **git blob SHA-1**: `SHA1("blob " + byteLength + "\0" + content)`. Two files with identical bytes have identical `sha` across all repos — this is a **true content hash** (unlike S3 multipart ETags). Comparing `sha` across clients is safe and authoritative.

Docs: `https://docs.github.com/en/rest/repos/contents`

#### 3.2 Tree-level listing (recommended)

`GET /repos/{owner}/{repo}/git/trees/{tree_sha}?recursive=1` returns the entire tree as `blob`/`tree` entries with per-blob `sha` and `size`, in **one request** (truncated at 100k entries; if `truncated: true`, fall back to per-dir fetch). This is the GitHub equivalent of `ListObjectsV2`.

Docs: `https://docs.github.com/en/rest/git/trees`

#### 3.3 Commits / compare (push-free change signal)

`GET /repos/{owner}/{repo}/commits?path=...` or `compare/{base}...{head}` tells you which paths changed between two commits. Store the last-synced commit SHA in the manifest; on poll, fetch latest commit; if equal → no changes anywhere; if different → `compare/{storedCommit}...{latest}` returns the list of changed files. **This is the most efficient GitHub polling path**: one `commits` request to detect "anything changed?", one `compare` to enumerate exactly what changed. No need to walk the tree every poll.

Docs: `https://docs.github.com/en/rest/commits/commits`, `https://docs.github.com/en/rest/commits/commits#compare-two-commits`

#### 3.4 Rate limits

REST API: 5000 req/hour authenticated, 60/hour unauthenticated. For a polling sync at, say, 5-min cadence, you're at ~12 req/hour for the "anything changed?" check — far under limit. `git/trees` once per sync session is cheap. Avoid the Contents API in a loop (one request per path) — use `git/trees` instead.

Docs: `https://docs.github.com/en/rest/overview/resources-in-the-rest-api#rate-limiting`

#### 3.5 Push (webhooks) — also not for desktop

GitHub webhooks require a public endpoint. Skip; poll.

---

### 4. Polling cadence & debounce

No native push on any of S3/WebDAV/GitHub for an unattended desktop client. Recommendations:

- **Cadence**: 3–5 minutes for `autoSync` users; manual-trigger otherwise. Anything tighter wastes bandwidth and risks rate limits (GitHub) and server load (WebDAV).
- **Debounce**: when the sync engine itself triggers a remote write, **don't** immediately re-poll (you'll just re-see your own write). Use a `suppressRemotePollUntil` window of ~30–60s after a local push, mirroring the existing `suppressWatcherFor`/`pauseWatcher` pattern in `apps/desktop/src/utils/fileWatcher.ts`.
- **Backoff**: on transport error, exponential backoff (e.g. start 30s, cap 15 min) to avoid hammering a down endpoint.
- **On focus**: optionally poll on app-window-focus (cheap UX win) — debounced.

---

### 5. Building & diffing the remote manifest

#### 5.1 Manifest shape (recommended)

```ts
interface SyncManifest {
  backend: { type: 's3'|'webdav'|'github'; rootKey: string };
  lastSyncedAt: string;        // ISO 8601
  lastSyncedCommit?: string;   // GitHub only — store commit SHA
  entries: Record<string, {     // key = normalized POSIX-style path
    etag?: string;              // raw etag string (incl. quotes / "-N" suffix)
    size: number;
    lastModifiedMs: number;     // epoch ms, normalized across backends
    contentHash?: string;       // client-computed (SHA-256 of plaintext) — optional, E2E-mode recommended
    remoteKey: string;          // opaque per-backend key (S3 Key, WebDAV href, GitHub path)
  }>;
}
```

Why `lastModifiedMs` (number) instead of `Date`: serializes cleanly, timezone-safe for diffing.

#### 5.2 Diff algorithm

Given `remote` (fresh from list) and `lastSynced` (persisted manifest):

```
for path in union(remote, lastSynced):
  r = remote[path]; s = lastSynced[path]
  if !s and r:                  → REMOTE_ADDED
  if s and !r:                  → REMOTE_DELETED
  if s and r:
    if sameContentToken(s, r):  unchanged
    else:                       → REMOTE_MODIFIED
```

`sameContentToken(s, r)`:

- GitHub: `s.sha === r.sha` (authoritative).
- S3: `s.size === r.size && s.etag === r.etag && s.lastModifiedMs === r.lastModifiedMs` — any change → modified. (Conservative: ETag pitfall means a "modified" verdict may be a false positive when a third party re-uploaded identical content via different multipart sizing. Acceptable — safe-fail to fetch.)
- WebDAV: `s.etag === r.etag` if etags present; else `s.size === r.size && s.lastModifiedMs === r.lastModifiedMs`.

A "modified" verdict triggers a `readFile` (body fetch) only for the subset that changed — this is the win over re-downloading everything.

#### 5.3 Where to persist the manifest

**Recommendation: local sidecar, NOT remote per-file sidecars.**

- **Local**: `<vaultRoot>/.quill/sync-state.json` (one file per vault, per backend). Hidden dir already a convention in Quill (`.quill/`). Pros: no extra remote objects, no remote writes on every sync, doesn't pollute the remote tree, doesn't break E2E-encryption invariant (a remote per-file `.quill-meta` would itself need encryption/decryption and would be visible metadata).
- **Remote per-file `.quill-meta` sidecar**: rejected — doubles object count on S3 (cost), doubles WebDAV requests, exposes metadata leakage in E2E mode, and creates a bootstrapping problem (who syncs the meta sidecars?).

Edge case: when E2E encryption is on, the manifest still lives locally in plaintext (it's just etag/size/hash of ciphertext + hash of plaintext) — acceptable because it never leaves the device. If the user rotates devices, the new device has no manifest → first sync = full reconciliation (treat every remote object as "needs fetch + decrypt", then build manifest). That's fine.

#### 5.4 The multipart-ETag pitfall, concretely for Quill

- Quill pushes a 20 MB markdown file to R2. The S3 SDK auto-multipart-uploads it (say 5 MB parts → ETag `...-4`).
- Another device, or rclone, re-uploads the identical 20 MB file but with 8 MB parts → ETag `...-3`.
- A naive ETag-equality check says "remote differs from my manifest" even though content is identical → Quill re-downloads, decrypts, finds content equal, no-op. Wasted bandwidth but **no data loss**.
- Mitigation in E2E mode: `contentHash` (SHA-256 of plaintext) is in your local manifest; after re-fetch, you compute the plaintext hash and compare — if equal, skip the write and update the manifest's etag to the new value (so next poll sees no change). This is the "lazily reconcile" pattern.
- For non-E2E mode, accept the wasted fetch or force fixed-part-size multipart uploads from Quill so its own uploads are reproducible (doesn't help with third-party uploads).

---

## 6. Mapping onto `@quill/vault-provider` (Quill-specific)

### 6.1 Current state of providers

Inspected files (all currently stubs — return `[]` / log strings, no real backend wiring):

| File | Notes |
|---|---|
| `packages/vault-provider/src/providerInterface.ts` | `VaultProvider` interface; `listFiles(path, recursive?, showHidden?)` returns `VaultEntry[]`; optional `getMetadata?(path): Promise<VaultMetadata>` |
| `packages/vault-provider/src/types.ts` | `VaultEntry { path, name, type, size?, lastModified?: Date, etag?, children? }`; `VaultMetadata { path, size, lastModified: Date, etag?, mimeType? }` |
| `packages/vault-provider/src/providers/s3Provider.ts` | Stub — `listFiles` returns `[]`, no `getMetadata` impl |
| `packages/vault-provider/src/providers/webdavProvider.ts` | Stub — `listFiles` returns `[]`, no `getMetadata` |
| `packages/vault-provider/src/providers/githubProvider.ts` | Stub — has `watch` polling stub (30s interval, no real diff logic) |
| `packages/vault-provider/src/providers/baseProvider.ts` | Abstract base; no `getMetadata` default |

### 6.2 What the interface already supports / lacks for remote-change-detection

- `VaultEntry` already has `etag?`, `size?`, `lastModified?` — **sufficient** for the per-path manifest entry. No interface change strictly needed.
- `getMetadata?(path)` is declared but not implemented by any provider. For sync you mostly need the bulk-list path (`listFiles(recursive=true)`), not per-file `getMetadata` (that's the N+1 anti-pattern). `getMetadata` is useful only for single-key re-checks after a webhook or focus event — optional.
- `listFiles(recursive=true)` semantics are currently undefined — each stub returns `[]`. The contract should be: when `recursive=true` and the provider is a remote one (S3/WebDAV/GitHub), return the **full subtree** as a flat `VaultEntry[]` (or nested `children`) carrying `etag/size/lastModified` for every leaf. This is what the sync engine will turn into a manifest.

### 6.3 Recommended provider-level additions (for the implement agent, not this research's job to build)

- `S3VaultProvider.listFiles(recursive=true)`: paginate `ListObjectsV2` with the vault prefix; flatten to `VaultEntry[]` with `etag`/`size`/`lastModified` populated from the S3 response. One request per 1000 keys.
- `WebDAVVaultProvider.listFiles(recursive=true)`: `PROPFIND Depth: infinity`; on `403` fall back to recursive `Depth: 1` walk. Populate `etag`/`size`/`lastModified` from `getetag`/`getcontentlength`/`getlastmodified`.
- `GitHubVaultProvider.listFiles(recursive=true)`: `git/trees?recursive=1`; map each `blob` entry's `sha` into `etag` (overload — it's a real content hash) and `size` into `size`. No `lastModified` from trees API; fetch via `commits` if needed (or skip — `sha` is stronger than mtime).

### 6.4 Sync-engine-level (not provider-level) responsibilities

Per PRD, the sync engine lives at `apps/desktop/src/services/syncEngine.ts` (new). It should:

1. Call `remoteProvider.listFiles(vaultRoot, true)` → build `remoteManifest`.
2. Load `lastSyncedManifest` from `<vaultRoot>/.quill/sync-state.json`.
3. Diff (§5.2) → `{ added, modified, deleted }` remote paths.
4. For added/modified: `remoteProvider.readFile(path)` → write via `TauriVaultProvider.writeFile`.
5. For deleted: `TauriVaultProvider.deleteFile(path)`.
6. For local→remote direction: diff `localManifest` (from `fileWatcher` + `TauriVaultProvider.listFiles`) vs `lastSyncedManifest`.
7. After convergence: persist `lastSyncedManifest = remoteManifest` (with local `contentHash` values merged in).

### 6.5 Existing local-side primitives to reuse

- `apps/desktop/src/utils/fileWatcher.ts` — `watch`, `suppressWatcherFor`, `pauseWatcher`/`resumeWatcher`. The remote-poll debounce should mirror this pattern: a `suppressRemotePollUntil` window after a local push so the next poll doesn't re-see our own writes.

---

## Caveats / Not Found

- **No live web search was performed this session** (no web-search MCP tool was available to this agent). The API semantics above are stable public facts; canonical doc URLs are cited. Before finalizing the sync engine, re-verify: (a) GitHub current rate-limit numbers (5000/hr authenticated is the long-standing value but check), (b) the S3 SDK's current `multipartUploadThreshold` default for whichever client lib Quill adopts (`@aws-sdk/client-s3` v3 typically auto-multipart above 8 MiB — confirm against the chosen version), (c) any R2 / MinIO deviations from S3 ETag behavior (R2 claims S3-compat; MinIO is S3-compat including multipart ETag formula).
- **Provider stubs**: `S3VaultProvider` / `WebDAVVaultProvider` / `GitHubVaultProvider` are currently inert stubs. The interface is in place but no real backend calls exist yet — the sync engine cannot rely on any current `listFiles` behavior; it must be implemented alongside the engine.
- **E2E-encryption interaction**: when E2E is on, all of etag/size/lastModified refer to the **ciphertext** object on the remote. That's fine for change detection (ciphertext changed ⇒ plaintext changed, since encryption is deterministic per-key only with a fresh nonce/IV — AES-GCM with random IV means identical plaintext produces different ciphertext each push, so etag changes every push even for same content; `contentHash` of plaintext becomes the only way to dedupe). This is a real gotcha the implement agent must handle: in E2E mode, the manifest's `contentHash` field is mandatory for "did the plaintext actually change?" decisions, because remote etag will change on every push regardless of content.
