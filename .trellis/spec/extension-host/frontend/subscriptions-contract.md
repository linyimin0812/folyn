# Trusted subscriptions contract

## Scope / trigger
The desktop subscription extension needs stable vault sessions and public web downloads. Contracts are SDK-only; implementation is a desktop capability provider.

## Signatures
`api.subscriptions?: ExtensionSubscriptions`; `subscription_fetch({ extensionId, url, binary })`; `subscription_vault_io({ extensionId, root, path, operation, content })`; `subscription_data_io({ extensionId, vaultId, path, operation, content })`.

## Contracts
Manifest declares `permissions.subscriptions: { vault: true, network: true }` and trusted tier. Rust rechecks installed approved/enabled record, pinned manifest SHA-256 integrity, and on-disk grant. `current()` returns local/GitHub session, null while switching or unsupported provider. Each snapshot resolves its own basePath once. `session.data` is a separate private store rooted at `~/.folyn/subscriptions/<vaultId>`; its keys are relative to that root and the native command validates the captured Vault ID, extension grant and symlink-safe path. Subscription indexes, bodies, translations, images and learning records use this store. User-authored files and exported Markdown/attachments continue using normal Vault IO. Legacy `.folyn/subscriptions` data in a Vault is neither read nor migrated. `createText` syncs a temporary file, atomically hard-links to destination and fails on collisions; normal writes rename complete content. Fetch returns `{ status, headers, body, url }`, final URL and base64 binary, 30 s total, 8 MiB text or 20 MiB binary. Every redirect re-resolves and pins public destination IPs; no proxies or URL credentials.

## Validation / error matrix
Sandbox or missing grants: no API; unapproved/disabled: native command rejects; traversal/absolute path/symlink: rejects; duplicate create: rejects preserving original; stale open: rejects before tabs/nav update; private IP or redirect: rejects; byte/time/redirect limit: rejects. Old pinned writes can finish against old physical root, never new current root.

## Good / base / bad cases
Good: save started in A finishes in A after switch to B. Base: request public HTTPS article and open saved Markdown in current A. Bad: resolve active vault dynamically after awaiting image fetch; that writes A's article into B.

## Tests required
Focused `subscriptionsCapability.test.ts`: permission gate, pinned pending create, stale open, immediate null transition, disposal. Native pure-helper harness or Rust tests: private IPv4/IPv6 rejection, concurrent exclusive create one winner, traversal rejection. Registry/editor/vault/ActivityBar tests protect existing behavior. Avoid whole desktop/Rust builds per root AGENTS.md. Native module can be checked with rustc metadata against cached deps and stubbed extension registry to avoid loading unrelated source.

## Wrong vs correct
Wrong: `useVaultStore.getState().currentVault` inside every snapshot write. Correct: capture vault ID/basePath at session creation and use that same resolved root throughout each save. Native watcher paired rename/remove events carry captured physical `root`; ignore stale roots after switching. Unpaired OS rename lacks destination and must use missing-file recovery.

## Independent AI jobs
`ExtensionAiChatParams.persistHistory: false` forwards `runRigChat({ historyMode: 'none' })` through trusted and sandbox chat. It prevents fragment jobs from reading/writing global host chat history. Absent/true leaves the existing default. Pair resolution, credentials and provider/model metadata remain host-managed and unchanged. Regression: `aiCapability.test.ts` verifies no-history forwarding and default omission.

## Rendered acquisition expansion

### Scope / trigger
General public blogs and dynamic websites need a native browser fallback after deterministic HTTP extraction.

### Signatures
`permissions.subscriptions.render?: boolean`; optional `ExtensionSubscriptions.render(url)`; commands `subscription_render({ extensionId, requestId, url })` and `subscription_cancel_renders({ extensionId, requestIds })`. Custom app command dispatch rejects all source labels for which `is_acquisition_webview(label)` is true before generated handler dispatch.

### Contracts
Trust/integrity/grant gate is shared with pinned IO. One request globally; 28-second deadline; 8 MiB serialized UTF-8 DOM; 12 bounded navigation retries. Each main destination is validated as credential-free HTTP(S) with public resolved addresses. Unknown destinations are denied before navigation, asynchronously validated, then retried. Bootstrap about:blank is inert and allowed. Browser profile is unique/incognito; windows are hidden, downloads/new windows denied. Native evaluation callback uses a bounded mpsc channel because Tauri requires Fn callbacks. No IPC bridge is exposed; default plugin ACL grants no privileges to render labels, and explicit custom-command label denial is authoritative. Drop destroys window, clears browser data and retries profile deletion.

Readiness samples stable DOM/text/link/height dimensions, waits >=3 seconds plus >=1.5 seconds stable, scrolls four initial viewports at bounded intervals, and accepts short content after 12 seconds. XML roots serialize unchanged. Executable scripts/inline handlers/embedded frames are removed; inert JSON script payloads retained. Synthetic status 200 is marked by rendered/status-unavailable headers.

### Validation / error matrix
Missing render grant: method absent/native rejects. Invalid URL or private main destination: denied. Visible challenge/login: explicit blocked error. Busy/oversized/unstable/unloaded/cancelled: explicit errors. Main browser status is unavailable. Native browser cannot pin socket DNS or comprehensively intercept subresources; direct HTTP preserves IP pinning and no proxy. OS browser proxy is inherited, but private/fake DNS answers still reject.

### Good / base / bad cases
Good: JS adds article links after hydration, acquired after stable DOM; cancellation destroys current isolated window. Base: short static page settles and is accepted after 12 seconds. Bad: trusting a hidden Tauri window's ACL to protect custom commands, or globally disabling DNS guards for proxy compatibility.

### Required tests
SDK-only typecheck, capability render grant/cancel regressions; cached-dependency full module metadata check with typed generated handler; native executable pure decode/readiness/IP/atomic helpers; standalone native Tauri/Wry delayed-DOM fixture with inert JSON, forced timeout cleanup and cancellation cleanup. IPC guard smoke deliberately leaves bridge accessible in test-only fixture to force a privileged invoke; generated dispatcher must deny it and dummy privileged counter remain zero.

### Wrong vs correct
Wrong: `let handler = generate_handler![...]` loses runtime inference inside a wrapper closure; callback consumes a oneshot Sender in an Fn. Correct: explicit `fn(Invoke<Wry>) -> bool` generated dispatcher and bounded mpsc callback. Do not expose render capability without a separate explicit permission, and never reuse main/browser user-data profiles.

Concurrent first saves may race when creating shared parent directories. After create_dir returns AlreadyExists, re-read with symlink_metadata and accept only a non-symlink directory; preserve all other errors. The 32-thread shared-parent create/write test must produce all 32 files successfully. Never unconditionally swallow mkdir errors or follow symlinks.

## Cache removal contract
`session.remove(path)` accepts a regular file or directory tree and is idempotent when the path is absent. Native subscription IO must not call `remove_file` on directories: macOS reports `Operation not permitted (os error 1)`. Validate the scoped path first, inspect its final entry with `symlink_metadata`, reject final links, then choose `remove_dir_all` or `remove_file`; suppress only NotFound. Directory removal unlinks inner symlinks without following targets. Required regressions cover nested caches, uncached paths, regular files, unrelated notes, final/ancestor links, inner links preserving targets, and genuine invalid-parent errors.

## Image network fallback
Keep direct HTTP public-IP pinning and no_proxy. Some routes fail before HTTP while the OS-proxy/browser route succeeds; changing User-Agent/Referer or disabling certificate checks does not address that route difference. The internal binary fetch fallback requires both network+render grants and a JS-generated requestId tracked by activation disposal. Only image documents are acquired: validate public main navigation, same-origin credentialless fetch with redirect:error, stream-limit20MiB, preserve actual Content-Type and bytes (no Canvas). Native result validation checks successful image MIME, base64 size, nonempty bytes and byte-count agreement.

Both page/image acquisitions share FIFO single-renderer capacity, a bounded8-job registry and28-second total queue/acquisition deadline. Pin the semaphore acquire future across cancellation polling so waiting jobs keep their position. Cancel only active jobs owned by the requesting extension, and batch JS teardown IDs into at most32 per native invocation. Tests must verify a real production binary fallback path, two concurrent image requests, queued cancellation without an extra window, foreign-owner cancellation rejection, cleanup, MIME/raw byte preservation and private destination denial. A standalone smoke with registry auth stub is not installed-plugin end-to-end QA.


## Learning-note editor handoff

The pinned session owns `chooseNotes`, `readNote`, and `appendNote(path,text,expectedText)`. Snapshot fields are `{path,title,text}`. Native picker selections must be `.md` files inside the captured root; read through native subscription IO even when a dirty editor buffer exists so grant and symlink checks remain effective. Unsaved editor buffers (including empty strings) override disk. Learning reads/pickers reject late results after vault transition or extension disposal.

Editor policy belongs in `editorNoteService`, not the capability provider: match the handle by captured vault + tab ID, open a source mode, and wait for readiness instead of appending through the previous tab's global handle. Compare `expectedText` at request time and against the mounted CodeMirror document. The append is one `isolateHistory('full')` transaction so Undo removes only the addition, preserving prior typing. Never replace the whole tab content or force-save through an error-swallowing service. Success means editor insertion under the user's existing auto-save setting; auto-save-off remains dirty.

The handle registry must track tab identity and notify readiness when view mode changes. Opening an existing dirty empty tab must not reload old disk contents. Focused regressions cover dirty empty snapshots, current-vault picker containment, stale picker/read results, mounting the correct target, stale snapshot/readonly/unsupported editor rejection, concurrent appends (one winner), timeout cleanup, and actual CodeMirror Undo. Full React/native window mounting is a separate acceptance step; isolated service tests do not prove it.
