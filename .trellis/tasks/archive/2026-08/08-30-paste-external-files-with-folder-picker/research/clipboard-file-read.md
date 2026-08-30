# Research: reading an externally-copied file's path from the system clipboard

- **Query**: How to read a file PATH (not text/image) from the system clipboard in a Tauri v2 desktop app (webview + Rust) on macOS and Windows, after the user Cmd+C's a file in Finder/Explorer.
- **Scope**: mixed (internal deps audit + external crate docs)
- **Date**: 2026-08-30

## TL;DR (recommended approach)

**Use `arboard` directly.** It is already a transitive dependency in this repo (`Cargo.lock`: `arboard 3.6.1`, pulled in by `tauri-plugin-clipboard-manager 2.3.2`), and version 3.6.1 **already exposes a public `Get::file_list()` API on macOS, Windows, and Linux**. No need for `objc2`/`cocoa`/`windows` hand-rolled code, and no need to touch `tauri-plugin-clipboard-manager`.

Minimal diff:
1. Add `arboard = "3"` to `apps/desktop/src-tauri/Cargo.toml` `[dependencies]` (no version bump needed — it's already resolved in `Cargo.lock`, so no new download).
2. Register one ~15-line Tauri command that calls `arboard::Clipboard::new()?.get().file_list()`.
3. Add a capability permission for the new command in `capabilities/default.json`.

Sketch (Rust, `src-tauri/src/` somewhere, e.g. a new `clipboard_files.rs`):

```rust
use std::path::PathBuf;
use tauri::command;

/// Returns the file paths currently on the system clipboard, or an empty
/// vec if the clipboard holds no file references (e.g. user copied text).
///
/// Finder (macOS) places `public.file-url` entries on the pasteboard when
/// you Cmd+C a file; Explorer (Windows) places a `CF_HDROP`. arboard reads
/// both via `Get::file_list()`.
#[command]
pub async fn clipboard_read_files() -> Result<Vec<String>, String> {
    // ponytail: arboard locks the pasteboard briefly; run on a blocking
    // worker so the async command doesn't stall the runtime. Same pattern
    // as voice::insert (see src/voice.rs:1011).
    tauri::async_runtime::spawn_blocking(|| {
        let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        let paths = cb.get().file_list().unwrap_or_default();
        Ok(paths.into_iter().map(|p| p.to_string_lossy().into_owned()).collect())
    })
    .await
    .map_err(|e| format!("clipboard join failed: {e}"))?
}
```

Notes on the sketch:
- `get().file_list()` returns `Err(ContentNotAvailable)` when no file URLs are on the pasteboard; the `unwrap_or_default()` makes the command return an empty `Vec<String>` in that case (frontend: empty array = "not a file paste, ignore").
- Do NOT also call `get().text()` afterwards on the same `Get` — `Get` is consumed by `file_list()` (it takes `self`). If you also want the file's name as text, re-create the `Clipboard` or read text first.
- Run on `spawn_blocking` — arboard acquires the pasteboard lock (see existing comment at `apps/desktop/src-tauri/src/voice.rs:1011`).
- Frontend calls `invoke('clipboard_read_files')` from a Cmd+V / paste handler. `navigator.clipboard.read()` is NOT used (it can't see file URLs).

Capability addition in `apps/desktop/src-tauri/capabilities/default.json` (next to the existing `clipboard-manager:allow-write-text` at line 132): define a new permission for the command, or scope it under the app's `core:default` allowlist — exact identifier depends on how the command is registered. Simplest: add a `core:allow-invoke` entry or a custom permission set in the command's module. (Existing `win-detect` permission in the same file shows the pattern for custom command permissions.)

## Question-by-question answers

### Q1. What does Finder / Explorer place on the clipboard when you Cmd+C a file?

**macOS (Finder):** multiple representations on `NSPasteboard`, the relevant ones for reading file paths:
- `public.file-url` (UTI) — one `NSURL` per copied file. This is the canonical, modern source. (`NSPasteboardTypeFileURL` also maps here.)
- `NSFilenamesPboardType` (legacy, deprecated since 10.14 but still written for back-compat) — an `NSArray` of `NSString` paths.
- `public.tiff` — a preview/thumbnail of the file (image). This is why `navigator.clipboard.read()` on the webview sometimes sees `image/png` when a file is copied — it's reading the preview, not the file path.
- Apple docs: [NSPasteboard reading file URLs](https://developer.apple.com/documentation/appkit/nspasteboard/1533584-readobjectsforclasses), [UTI `public.file-url`](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/understanding_utis/understand_uti_conc/understand_uti_conc.html).

**Windows (Explorer):** a `CF_HDROP` clipboard format — a global memory object containing a `DROPFILES` header followed by a null-terminated list of UTF-16 file paths (double-null-terminated). Also `FileDrop` (the .NET / WinForms name for the same format) and a `DragDropHelper` `IDataObject` wrapper. Reading paths = parse `CF_HDROP`. MS docs: [CF_HDROP format](https://learn.microsoft.com/en-us/windows/win32/dataxchg/clipboard-formats), [DROPFILES struct](https://learn.microsoft.com/en-us/windows/win32/api/shlobj/ns-shlobj-dropfiles), [DragQueryFileW](https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-dragqueryfilew).

### Q2. Does `arboard` support reading file references from the clipboard on macOS and Windows?

**Yes — on all three desktop platforms**, contrary to the task's "historically only Linux/X11" note. Verified by reading the crate source directly:

- Crate version in this repo: `arboard 3.6.1` (`Cargo.lock`), source at `~/.cargo/registry/src/index.crates.io-*/arboard-3.6.1/`.
- Public API, `src/lib.rs:205`:
  ```rust
  pub fn file_list(self) -> Result<Vec<PathBuf>, Error> {
      self.platform.file_list()
  }
  ```
  Exposed on the `Get<'_>` builder returned by `Clipboard::get()` (`src/lib.rs:166`). There is a matching `Set::file_list()` for writing (`src/lib.rs:251`), plus an example round-trip in the crate's doctests (`src/lib.rs:371-372`).
- **macOS impl** (`src/platform/osx.rs:244-271`): calls `NSPasteboard#readObjectsForClasses:options:` with `[NSURL class]` and option `NSPasteboardURLReadingFileURLsOnlyKey = YES`, then downcasts each object to `NSURL` and reads `.path()`. This is exactly the recommended Apple pattern for "give me the copied files" — and it handles multi-file selections.
- **Windows impl** (`src/platform/windows.rs:646-653`): delegates to `clipboard_win::raw::get_file_list_path(&mut file_list)`, which parses `CF_HDROP`. `clipboard-win 5.4.1` is the transitive dep that does the actual `DragQueryFileW` parsing.
- **Linux impl** (`src/platform/linux/mod.rs:184-188`): reads `text/uri-list` from the X11 / Wayland clipboard selection.

So: **arboard 3.6.1 already solves the problem on macOS + Windows + Linux.** No custom `objc2`/`cocoa`/`windows-rs` code is required.

The `ClipboardContent` enum the task mentions is from an older arboard 1.x/2.x API and no longer exists in 3.x — 3.x replaced it with the `Get`/`Set` builder pattern, and `file_list` is a first-class method on both.

Sources:
- arboard crate docs: https://docs.rs/arboard/3.6.1/arboard/struct.Clipboard.html#method.get
- arboard GitHub README (lists `file_list` in the API tour): https://github.com/1Password/arboard
- Local source (authoritative for the version pinned here): `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/arboard-3.6.1/src/lib.rs`, `…/src/platform/osx.rs`, `…/src/platform/windows.rs`.

### Q3. Does `tauri-plugin-clipboard-manager` v2 expose a file / file-url read API?

**No.** Verified by reading the local crate source (`~/.cargo/registry/src/index.crates.io-*/tauri-plugin-clipboard-manager-2.3.2/`):

- `src/lib.rs:46-53` — the only commands registered are:
  ```rust
  commands::write_text,
  commands::read_text,
  commands::read_image,
  commands::write_image,
  commands::write_html,
  commands::clear
  ```
- `src/commands.rs` confirms the same six — no `read_files`, no `read_file_list`, no custom-format / `readText`-with-format escape hatch.
- The JS bindings (`@tauri-apps/plugin-clipboard-manager` `^2.2.0`, per `apps/desktop/package.json:45`) mirror exactly those six. There is no `readFiles` export.

So the plugin cannot read file paths. The webview's `navigator.clipboard.read()` is similarly limited to `text/plain` and `image/png` (per the W3C async clipboard spec), and even where browsers expose `web`, `html`, `image/svg+xml`, they still do NOT expose `public.file-url` / `CF_HDROP` — file URLs are deliberately withheld from the web for security reasons. A Rust-side command is mandatory.

Sources:
- Local plugin source: `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-plugin-clipboard-manager-2.3.2/src/lib.rs`, `…/src/commands.rs`.
- Plugin README & JS bindings: https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/clipboard-manager
- W3C async clipboard (no file URL support): https://www.w3.org/TR/clipboard-apis/

### Q4. If both arboard and the Tauri plugin can't read paths on macOS — minimal Rust approach?

This premise is moot: **arboard CAN read paths on macOS** (see Q2). So the "minimal Rust approach using `objc2`/`cocoa`" is not needed.

For completeness, if one wanted to avoid arboard anyway, the minimal macOS-only hand-roll would be ~25 lines using `objc2` + `objc2-app-kit` (already in arboard's dep tree):

```rust
// NOT RECOMMENDED — arboard already does exactly this in src/platform/osx.rs:244.
// Sketch only for reference.
use objc2::rc::Retained;
use objc2_app_kit::{NSPasteboard, NSPasteboardURLReadingFileURLsOnlyKey};
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSURL, NSString};

let pb: Retained<NSPasteboard> = unsafe { NSPasteboard::generalPasteboard() };
let classes = NSArray::from_slice(&[NSURL::class()]);
let opts = NSDictionary::from_slices(
    &[unsafe { NSPasteboardURLReadingFileURLsOnlyKey }],
    &[NSNumber::new_bool(true).as_ref()],
);
let objects = unsafe { pb.readObjectsForClasses_options(&classes, Some(&opts)) };
let paths: Vec<String> = objects.map(|a| a.iter()
    .filter_map(|o| o.downcast::<NSURL>().ok())
    .filter_map(|u| unsafe { u.path() }.map(|s| s.to_string()))
    .collect()).unwrap_or_default();
```

On Windows the hand-roll would be `OpenClipboard` + `GetClipboardData(CF_HDROP)` + `DragQueryFileW` (~30 lines). Both are strictly worse than reusing `arboard::Clipboard::get().file_list()`, which already wraps both with the same code.

### Q5. Is there a simpler cross-platform crate that wraps this (e.g. `clipboard-files`, `pastey`)?

**No, and `pastey` is a red herring.** Verified:

- `pastey 0.2.3` is in `Cargo.lock` and shows up in the `target/debug/.fingerprint/` tree, but reading its source (`~/.cargo/registry/src/index.crates.io-*/pastey-0.2.3/src/lib.rs`) reveals it is a **proc-macro crate** (a `paste`-style identifier concatenator — `#[proc_macro] pub fn paste(...)`). It has nothing to do with the system clipboard. The name collision misled the task brief; ignore it.
- `clipboard-files` — not a crate; the relevant functionality lives inside `arboard` (which uses `clipboard-win` on Windows for the `CF_HDROP` parse) and inside `arboard`'s own NSPasteboard code on macOS. No separate `clipboard-files` crate on crates.io provides a smaller cross-platform wrapper.
- `clipboard-win 5.4.1` (already a transitive dep) can read `CF_HDROP` directly via `clipboard_win::raw::get_file_list_path`, but it is Windows-only — `arboard` gives you both platforms in one call, so prefer arboard.

Sources:
- pastey source: https://docs.rs/pastey/0.2.3/pastey/ (proc-macro, "Token identifier concatenation")
- clipboard-win: https://docs.rs/clipboard-win/5.4.1/clipboard_win/
- arboard (covers both): https://docs.rs/arboard/3.6.1/arboard/

## Recommended approach (ranked, minimal-diff first)

**Option A (recommended, ~15 lines of Rust + 1 Cargo.toml line):** add `arboard = "3"` as a direct dep and expose one `clipboard_read_files` Tauri command (sketch above). Reuses a crate that is already in the dependency graph and already implements the exact pasteboard reads for macOS + Windows + Linux. No new transitive deps pulled in.

**Option B (fallback if you want to avoid adding a direct `arboard` dep):** write the NSPasteboard / `CF_HDROP` calls yourself via `objc2-app-kit` (macOS) and `windows` / `clipboard-win` (Windows). ~25-30 lines per platform, more code paths to maintain, zero reuse benefit since arboard is already compiled into the binary. Only do this if you have a concrete reason to not depend on arboard directly.

**Do NOT** try to extend `tauri-plugin-clipboard-manager` with a `readFiles` command — that would mean forking the plugin or contributing upstream and waiting for a release. The plugin's command set is hard-coded in `src/lib.rs:46-53`; a custom app-level command is strictly less work.

## Platform coverage notes

| Platform | Does `arboard::Clipboard::get().file_list()` work? | Source of paths |
|---|---|---|
| macOS | Yes | `public.file-url` / `NSURL` via `NSPasteboard#readObjectsForClasses:options:` with `NSPasteboardURLReadingFileURLsOnlyKey=YES` |
| Windows | Yes | `CF_HDROP` via `clipboard_win::raw::get_file_list_path` (which calls `DragQueryFileW`) |
| Linux (X11) | Yes | `text/uri-list` on the clipboard selection |
| Linux (Wayland) | Yes (with `wayland-data-control` feature) | `text/uri-list` via `wl-clipboard-rs` |

Edge cases to be aware of when the frontend consumes the result:
- Finder also writes a `public.tiff` preview when copying an image file. If the frontend's existing paste handler also listens for `image/png` from `navigator.clipboard.read()`, it may fire alongside the Rust `clipboard_read_files` call — decide which wins (recommend: file path wins, ignore the preview image).
- Copying a folder in Finder yields its directory URL in `file_list()` — the frontend importer needs to handle a directory path, not just file paths.
- On Windows, paths come back as `\\?\C:\...` long-path-prefixed form from `clipboard_win` in some cases; `PathBuf::to_string_lossy()` normalizes for display but the importer should pass through `fs` APIs that accept the verbatim path.
- `Clipboard::new()` can return `ClipboardOccupied` if another process holds the clipboard lock — the command should surface that as an error string the frontend can retry on.

## Related code in this repo (for the implementer)

| File | Why it matters |
|---|---|
| `apps/desktop/src-tauri/src/lib.rs:608-609` | Where `tauri_plugin_clipboard_manager::init()` is registered; the new `clipboard_read_files` command would be added to the same `generate_handler!` list. |
| `apps/desktop/src-tauri/src/voice/insertion.rs`, `insertion_win.rs` | Existing pattern for calling `ClipboardExt` (the plugin's trait) cross-platform. The new command does not need the plugin — it uses `arboard` directly — but the file layout (per-platform split) is the local convention if a per-platform impl were ever needed. |
| `apps/desktop/src-tauri/src/voice.rs:1011-1018` | Existing `spawn_blocking` pattern for arboard/pasteboard locks. Reuse it for the new command. |
| `apps/desktop/src-tauri/capabilities/default.json:132-133` | Existing clipboard permissions (`clipboard-manager:allow-write-text`, `clipboard-manager:allow-write-image`). A new capability entry for the `clipboard_read_files` command goes next to these. |
| `apps/desktop/src/services/tauriBrowserShim.ts:86-92`, `apps/desktop/src/services/plugin-host/rpcBridge.ts:552-561` | Existing JS call sites for `@tauri-apps/plugin-clipboard-manager` `readText`/`writeText`/`writeImage`. The new `invoke('clipboard_read_files')` call follows the same shim pattern. |
| `apps/desktop/src-tauri/Cargo.lock` (entries for `arboard 3.6.1`, `clipboard-win 5.4.1`, `pastey 0.2.3`, `tauri-plugin-clipboard-manager 2.3.2`) | Confirms all relevant crates are already resolved; adding `arboard = "3"` to `Cargo.toml` requires no network fetch. |

## Caveats / not found

- Exact capability-permission identifier for a custom `#[command]` not auto-registered via a plugin: depends on whether the command is invoked through the app's own `generate_handler!` (then it needs either an `allow-invoke` entry or a custom permission set in `capabilities/default.json`). The existing `win-detect` entry (`capabilities/default.json:122-125`) shows the local convention for app-defined commands; the implementer should mirror that.
- `arboard`'s macOS pasteboard read uses `objc2-app-kit`; that crate is already in the dep tree (arboard pulls it). No extra compile cost beyond arboard itself becoming a direct dep.
- The webview-level `paste` event (`onpaste`) fires for Cmd+V regardless of clipboard content; the frontend should call `invoke('clipboard_read_files')` on paste, and if the result is non-empty, treat it as a file drop (import) and `preventDefault()` so the webview doesn't also paste the TIFF preview as an image. This is the same integration concern as the existing drag-drop path (commit `22aba65c`), not a clipboard-reading concern.
