# Extension network: fetch vs download

## Scope / trigger
Any extension needs the host to reach a remote origin, or to save a remote binary. Contracts are SDK-only (`packages/extension-sdk/src/types.ts`); implementation is a desktop capability provider.

## Signatures
`api.network.fetch(url, init?) → { status, headers, body }` (text, 30 s total, redirects followed up to 10).
`api.network.download(url, init? & { onProgress }) → { saved: true, status, name, path, size } | { saved: false, status, headers, body }`.
`api.downloads.list() → { name, size, modifiedMs }[]`; `api.downloads.path(name) → string`; `api.downloads.reveal(name) → void`.
`api.fileView.component() → ComponentType<{ path, content?, onChange?, onSave? }>` — the Vault editor's own editor + preview, with its edit / split / preview switch.
`api.icons.render(fileName, { isDir }) → { svg }` — the Vault tree icons as markup.

## Contracts
Both are gated by `permissions.http.origins`: JS fast-fail in `httpCapability.ts`, then Rust re-reads the on-disk manifest (`check_http_origin`). `download` writes to `~/.folyn/extension-data/<id>/downloads/`, never into `~/.folyn/extensions/<id>/` (reinstall and update wipe that directory). The body streams to a hidden `.part` file with `Response::chunk()`; reqwest has no `stream` feature here. A finished file is published by `hard_link`, so an existing file is never replaced — a taken name gains ` (n)`. A non-2xx or `application/json` response is not saved; it comes back as `saved: false` with the text body so the caller can show the API's `msg`. Redirects are not followed: reqwest only strips standard auth headers cross-origin, so a custom token header would leak to an origin the manifest never declared; a redirect is returned as `saved: false`. Timeouts are connect 30 s and read 60 s — no total cap, because a whole-space ZIP can take minutes.

## Contract boundaries
`download` transports and saves; it never renders. Display belongs to `fileView.component()`, which returns the **Vault editor's own editor and preview** — `FolynEditor` (the CodeMirror instance EditorPane mounts) plus the file type's `preview` mode component — and mounts the preview inside the same `.prev-body` wrapper. The component owns its edit / split / preview switch, so an extension page does not reimplement mode handling; editing calls `onChange`, and the save shortcut calls `onSave` with the full text (the extension decides where to persist it). Do not add a second rendering path: an exported-HTML `<iframe srcdoc>` was tried and rejected, because it is not "the same as opening a vault file" (no cursor-sync markup, no live extension renderers, a separate CSS surface). A page showing remote content passes `{ path: name, content: text }`; a saved download passes `{ path: absolutePath }` so its own handler reads it. A format the app cannot display (`detectFileType === 'unsupported'`) renders an in-pane notice. Icons come from the host's `<FileIcon>` via `renderToStaticMarkup`, so the extension never duplicates the extension→icon map; the markup is host-produced and may be injected with `dangerouslySetInnerHTML`.

## Validation / error matrix
Undeclared origin: JS throws before IPC, Rust throws if bypassed. Invalid extension id: rejects (path traversal). `revealDownload` name that is not a bare file name (`safe_file_name(name) != name`): rejects, so the reveal path cannot leave the downloads directory. Truncated body or write error: the temp file is removed and the command fails. No free name in 10 000 attempts: rejects.

## Good / base / bad cases
Good: POST an OpenAPI download endpoint with a token header and get the ZIP with its server-provided name. Base: `fetch` for JSON APIs. Bad: using `fetch` for a ZIP (lossy text decode), or saving into the extension install directory, or following redirects with a token header.

## Tests required
`extension_download.rs` unit tests (naming, traversal, no-overwrite, JSON rejection, redirect rejection, truncated body, progress, `Future: Send`) run in a standalone harness with the root lockfile; `httpCapability.test.ts` covers IPC payload, origin denial and progress; `downloadsCapability.test.ts` (list / path / reveal) and `iconsCapability.test.ts` cover the rest; the preview component is exercised through the consuming extension's tests, which assert it mounts with the remote text or the saved path. Do not build the whole Tauri app to check them.

## Wrong vs correct
Wrong: buffering a download through IPC, or overwriting an existing download. Correct: stream Rust-side, bump the name.
