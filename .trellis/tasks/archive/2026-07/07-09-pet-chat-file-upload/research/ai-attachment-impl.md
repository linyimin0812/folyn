# Research: AiPanel attachment / paste / blob-save / Read-instruction implementation

- **Query**: Research the EXACT current implementation of file attachments / paste-image / blob-save / Read-instruction building in AiPanel's ChatInput, so a shared vault-free `components/chat/attachments.ts` helper can be extracted and reused by PetChat.
- **Scope**: internal
- **Date**: 2026-07-09

## Findings

### Files Deep-Read

| File Path | Description |
|---|---|
| `apps/desktop/src/components/ai/ChatInput.tsx` (1–348) | Owns attachment state, paste, file picker, chip rendering, @mention; passes slots to ChatInputBox |
| `apps/desktop/src/components/ai/AiPanel.tsx` (153–357) | `handleSend`: blob save via shell base64, Read-instruction prepend, @file regex resolution |
| `apps/desktop/src/components/chat/ChatInputBox.tsx` (1–166) | Shared presentational input; slot props (leadingSlot/attachmentsRow/overlayLayer/onPaste/canSend/inputRef/onBeforeKeyDown) |
| `apps/desktop/src/utils/idGenerator.ts` | `generateId()` = `${Date.now()}-${Math.random().toString(36).slice(2,8)}` |
| `apps/desktop/src/utils/platform.ts` | `isTauri()` hardcodes true |
| `apps/desktop/src/utils/imageUploader.ts` (50–75) | EXISTING precedent: writes binary via `writeFile(absPath, bytes)` from `@tauri-apps/plugin-fs` (LocalFileStrategy) |
| `apps/desktop/src/services/petChatService.ts` (89–166) | Pet workingDir = `<appData>/pet-chat-tmp` (mkdir recursive); appData scope granted |
| `apps/desktop/src-tauri/capabilities/pet-panel.json` | Pet-panel ACL: `fs:allow-write-file`, `fs:allow-mkdir`, `fs:scope-appdata-recursive`, `shell:allow-execute claude-cli` |

---

### 1. PendingAttachment shape

Defined and **exported** from `ChatInput.tsx:10-17`:

```ts
export interface PendingAttachment {
  id: string;
  name: string;
  type: 'image' | 'file';
  path?: string;      // disk path (vault @mention, or pendingFileAttachments from aiStore, or a File WITH a path — see below)
  blob?: Blob;        // set for paste-image & file-picker selections (a File IS a Blob)
  previewUrl?: string; // URL.createObjectURL(file) — only for images
}
```

AiPanel imports it as `import type { PendingAttachment } from './ChatInput';` (AiPanel.tsx:25).

**Population by source**:
- **File picker** (ChatInput.tsx:220-235): sets `blob: file` (a `File`), `previewUrl` only if `file.type.startsWith('image/')`. **No `path` is set** — the picker yields a `File` object without a disk path (Tauri webview `<input type=file>` does not expose the absolute FS path; only `file.name`).
- **Paste image** (ChatInput.tsx:194-214): sets `blob: file` (from `item.getAsFile()`), `previewUrl = URL.createObjectURL(file)`, `type: 'image'`, `name = paste-<ts>.<ext>`. No `path`.
- **@mention** (ChatInput.tsx:128-155): sets `path: filePath` (vault path), `type: 'file'`, NO blob, NO previewUrl.
- **aiStore.pendingFileAttachments** (ChatInput.tsx:59-74): sets `path: f.path`, `type: 'file'`, no blob/previewUrl.

So **`path` is populated only for vault-coupled disk-file sources** (mention / pendingFileAttachments). Paste & picker blobs have NO path — they MUST be saved to disk before send.

`id` uses inline `` `${Date.now()}-${Math.random().toString(36).slice(2, 6)}` `` everywhere (4-char suffix), NOT the shared `generateId()` (6-char suffix in idGenerator.ts). Minor inconsistency — helper should standardize on `generateId()`.

---

### 2. File picker

Hidden input at ChatInput.tsx:338-345:
```tsx
<input ref={fileInputRef} type="file" multiple
  accept="image/*,.txt,.md,.json,.csv,.pdf,.html,.htm,.xml,.yaml,.yml,.toml,.log"
  style={{ display: 'none' }} onChange={handleFileInputChange} />
```

**Type whitelist (the EXACT `accept` string to mirror)**:
```
image/*,.txt,.md,.json,.csv,.pdf,.html,.htm,.xml,.yaml,.yml,.toml,.log
```

`handleFileInputChange` (220-235):
```ts
const files = e.target.files;
if (!files) return;
for (const file of Array.from(files)) {
  const isImage = file.type.startsWith('image/');
  const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
  setAttachments((prev) => [...prev, {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: file.name,
    type: isImage ? 'image' : 'file',
    blob: file,
    previewUrl,
  }]);
}
e.target.value = '';   // reset so same file can be re-picked
```
Image vs file detection is **purely `file.type.startsWith('image/')`** (mime), not extension. Note: no maxBytes/size validation exists today; no dedup except @mention path-check.

---

### 3. Paste image

`handlePaste` (ChatInput.tsx:194-214):
```ts
const items = e.clipboardData?.items;
if (!items) return;
for (const item of Array.from(items)) {
  if (item.type.startsWith('image/')) {
    e.preventDefault();              // blocks pasting the image as text
    const file = item.getAsFile();
    if (!file) continue;
    const ext = file.type.split('/')[1] || 'png';
    const previewUrl = URL.createObjectURL(file);
    setAttachments((prev) => [...prev, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: `paste-${Date.now()}.${ext}`,
      type: 'image',
      blob: file,
      previewUrl,
    }]);
    return;   // only first image item; no multi-image paste
  }
}
```
- `previewUrl` via `URL.createObjectURL(file)`.
- ext derived from mime subtype (`png`/`jpeg`/`gif`/…); fallback `png`.
- Only the FIRST image item is consumed (`return`).
- Non-image paste falls through (text inserted normally).

---

### 4. Attachment chip rendering

`attachmentsRow` JSX (ChatInput.tsx:247-261):
```tsx
<div className="flex flex-wrap gap-1.5 mb-2">
  {attachments.map((att) => (
    <div className="...bg-surf border border-brd rounded-md text-[11px] text-t2 max-w-[160px]">
      {att.previewUrl ? (
        <img className="w-7 h-7 object-cover rounded shrink-0" src={att.previewUrl} alt={att.name} />
      ) : (
        <span className="inline-flex items-center shrink-0"><FileIcon filename={att.name} /></span>
      )}
      <span className="truncate min-w-0 flex-1">{att.name}</span>
      <button ... onClick={() => removeAttachment(att.id)}>×</button>
    </div>
  ))}
</div>
```
Thumbnail: `<img w-7 h-7>` for images with previewUrl; `<FileIcon filename>` for files. Remove button calls `removeAttachment` (237-243) which revokes the object URL then filters.

**Recommendation**: chip rendering is pure presentation driven only by `PendingAttachment[]` + `onRemove(id)`. It has NO vault/store coupling. It SHOULD move into the shared helper (or a `AttachmentChips` sub-component in `components/chat/`) so PetChat reuses it. `FileIcon` is already vault-free (icon component).

---

### 5. Blob save (AiPanel.handleSend)

Exact mechanism, AiPanel.tsx:227-261. workingDir = vault base path (213-222, with `~` → homeDir expansion).

```ts
if (currentAttachments.length > 0) {
  try {
    const { Command } = await import('@tauri-apps/plugin-shell');
    const tmpDir = `${workingDir}/.folyn-tmp`;
    await Command.create('claude-cli', ['-l', '-c', `mkdir -p '${tmpDir}'`]).execute();

    for (const att of currentAttachments) {
      if (att.path) {
        // vault-coupled source (mention / pendingFileAttachments): path already on disk
        savedAttachments.push({ name: att.name, path: att.path, type: att.type });
      } else if (att.blob) {
        const ext = att.name.split('.').pop() || 'png';
        const fileName = `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
        const filePath = `${tmpDir}/${fileName}`;
        const buffer = await att.blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binaryStr = '';
        const chunk = 8192;
        for (let i = 0; i < bytes.length; i += chunk) {
          binaryStr += String.fromCharCode(...bytes.slice(i, i + chunk));
        }
        const base64 = btoa(binaryStr);
        const writeResult = await Command.create('claude-cli', ['-l', '-c',
          `printf '%s' '${base64}' | base64 -D > '${filePath}'`,
        ]).execute();
        if (writeResult.code === 0) {
          savedAttachments.push({ name: att.name, path: filePath, type: att.type });
        }
      }
      if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);   // cleanup per-att
    }
  } catch (err) {
    attachSaveError = String(err);
    console.error('[AiPanel] Failed to save attachments:', err);
  }
}
```

**Mechanism**: shell sidecar `claude-cli` (which maps to `/bin/sh` per pet-panel.json) runs `mkdir -p <tmpDir>` then, per blob, base64-encodes in JS (chunked `String.fromCharCode` + `btoa`) and pipes `printf '<b64>' | base64 -D > '<filePath>'`. **vault-coupled**: tmpDir = `<vault>/.folyn-tmp`. The `att.path` branch just passes through (no save). `savedAttachments` carry `{name, path, type}`.

**Why shell + not plugin-fs today?** No technical reason — `imageUploader.ts:50-75` ALREADY writes binary via `writeFile(absPath, bytes)` from `@tauri-apps/plugin-fs`. The shell-base64 approach predates / is parallel to that precedent and is more fragile (shell-quoting of base64 in single quotes; base64 decode via macOS `base64 -D` — non-portable flag on Linux would be `-d`).

#### plugin-fs feasibility assessment (RECOMMENDATION)

`@tauri-apps/plugin-fs` `writeFile(path, Uint8Array)` is **fully viable and cleaner**:

1. **Binary write**: `writeFile` accepts a `Uint8Array` directly — no base64 encode/decode, no shell quoting risk, no 8192-chunk `String.fromCharCode` (which can stack-overflow on large blobs via `...spread`). Just `await writeFile(filePath, new Uint8Array(await att.blob.arrayBuffer()))`.
2. **pet-panel ACL**: pet-panel.json grants `fs:allow-mkdir`, `fs:allow-write-file`, `fs:scope-appdata-recursive`. Pet passes `<appData>/pet-chat-tmp` (petChatService.ts:108) — IN scope. ✅
3. **Main window ACL**: default.json (not read here, but AiPanel already uses plugin-fs for read/write elsewhere — SettingsPage, sessionStorage, storageClient, wikiProvider). Writing to `<vault>/.folyn-tmp` requires the vault path to be in the main window's fs scope. The current shell approach sidesteps fs scope by going through `/bin/sh`. ⚠️ **Risk**: plugin-fs `writeFile` to an arbitrary vault path may be DENIED by the main window's fs ACL if the vault isn't in scope. Need to verify default.json's fs scope. If vault is NOT in scope, AiPanel must keep the shell path (or the vault must be added to scope), while PetChat uses plugin-fs (appData, in scope). The helper should support BOTH: `saveBlobs(attachments, workingDir, { strategy: 'fs' | 'shell' })`, defaulting to `'fs'` for pet (appData) and allowing AiPanel to choose.
4. **mkdir**: `mkdir(tmpDir, { recursive: true })` from plugin-fs — already used by imageUploader.ts:72 and wikiProvider.ts:22.

**Recommendation**: shared helper `saveBlobs` uses **plugin-fs** (`writeFile` + `mkdir recursive`) by default. This is cleaner, works under pet-panel's ACL (appData scope), and matches the existing `imageUploader.LocalFileStrategy` precedent. AiPanel can adopt the same path IF the main window's fs scope covers the vault's `.folyn-tmp`; otherwise AiPanel keeps a shell fallback. The base64-in-JS-then-shell-decode path should be dropped from the shared helper.

---

### 6. Read-instruction building

AiPanel.tsx:264-292. Two phases.

**Phase A — saved attachments** (264-277):
```ts
let prompt = userText;
if (savedAttachments.length > 0) {
  const images = savedAttachments.filter((a) => a.type === 'image');
  const files = savedAttachments.filter((a) => a.type === 'file');
  const parts: string[] = [];
  if (images.length > 0) {
    parts.push(`请先使用 Read 工具读取以下图片文件:\n${images.map((a) => a.path).join('\n')}`);
  }
  if (files.length > 0) {
    parts.push(`请先使用 Read 工具读取以下文件:\n${files.map((a) => a.path).join('\n')}`);
  }
  const instruction = parts.join('\n\n');
  prompt = prompt ? `${instruction}\n\n用户消息: ${prompt}` : instruction;
}
```

Exact strings:
- images: `` `请先使用 Read 工具读取以下图片文件:\n${paths.join('\n')}` ``
- files:  `` `请先使用 Read 工具读取以下文件:\n${paths.join('\n')}` ``

**Ordering**: images FIRST, then files. The two blocks are joined with `\n\n`. Paths within a block joined with `\n`. If both present: `[image-block]\n\n[file-block]`. Then wrapped: `${instruction}\n\n用户消息: ${prompt}` (only if userText non-empty; else instruction alone). If only images or only files, parts has one element, `parts.join('\n\n')` = that element.

**Phase B — @file mentions** (279-292) — runs AFTER phase A, on the ALREADY-WRAPPED prompt:
```ts
const mentionedFiles: string[] = [];
const mentionRegex = /@([\w\-./一-鿿]+)/g;
let match: RegExpExecArray | null;
while ((match = mentionRegex.exec(prompt)) !== null) {
  const mentioned = match[1];
  if (allFiles.some((f) => f.path === mentioned)) {
    mentionedFiles.push(mentioned);
  }
}
if (mentionedFiles.length > 0) {
  const fileInstruction = `请先使用 Read 工具读取以下文件:\n${mentionedFiles.join('\n')}`;
  prompt = `${fileInstruction}\n\n用户消息: ${prompt}`;
}
```

So when BOTH attachments AND @mentions exist, final ordering is:
```
<mention-file-instruction>

用户消息: <attachment-image-instruction>

<attachment-file-instruction>

用户消息: <original-userText>
```
(i.e. mentions are prepended OUTERMOST, wrapping the already-wrapped attachment prompt.) Note @mention resolution needs `allFiles` (vault fileTree) — vault-coupled, stays in AiPanel wrapper. The regex `@([\w\-./一-鿿]+)` matches CJK filenames (一-鿿 = CJK Unified Ideographs block). Dedup is NOT applied to mentionedFiles (same @file twice → listed twice).

---

### 7. canSend / send-disabled logic

ChatInput.tsx:328 (passed to ChatInputBox):
```tsx
canSend={input.trim().length > 0 || attachments.length > 0}
```
ChatInputBox.tsx:93-94:
```ts
const isDisabled = streaming || disabled;
const canSendNow = !isDisabled && (canSend ?? value.trim().length > 0);
```
And the send-click guard in handleSendClick (157-164):
```ts
if ((!input.trim() && attachments.length === 0) || isStreaming) return;
```
Confirmed: **send enabled iff `input.trim().length > 0 || attachments.length > 0`** (and not streaming). Attachments alone can send. The pet path omits `canSend` → text-only default `value.trim().length > 0`.

---

### 8. Where @mention is interleaved (so refactor can separate)

Vault-coupled @mention code lives ONLY in `ChatInput.tsx` (NOT in the shared helper):

- **State** (28-29): `mentionMenu`, `mentionIndex`.
- **Store reads** (92-108): `useVaultStore` fileTree → `flattenFileTree` → `allFiles`; `useEditorStore` activeFilePath for ordering. `filteredMentionFiles` useMemo.
- **handleChange** (110-126): `@` detection via `textareaRef.current.selectionStart`, `lastIndexOf('@')`, whitespace-boundary check, `setMentionMenu`.
- **insertMention** (128-155): splices `@filter` out of input, pushes a `path`-only PendingAttachment.
- **handleBeforeKeyDown** (168-192): ArrowUp/Down/Enter/Tab/Escape when mentionMenu visible (returns true to skip base Enter-to-send).
- **mentionOverlay JSX** (263-276): the popup; rendered into `overlayLayer` slot.
- **AiPanel.handleSend Phase B** (279-292): `mentionRegex` + `allFiles` resolution → prepend file instruction. Needs `allFiles` (vault).

The helper MUST NOT touch: `useVaultStore`, `useEditorStore`, `flattenFileTree`, `allFiles`, the `@` regex in handleChange, `mentionMenu` state, `mentionOverlay`. All of these stay in the AiPanel wrapper. PetChat wrapper adds ONLY: paste + file-picker + chip-row + canSend-with-attachments; NO mention, NO overlay.

The `@file` regex in AiPanel.tsx:281 (`/@([\w\-./一-鿿]+)/g`) is vault-coupled (needs `allFiles.some(...)` to validate) and stays in AiPanel.

---

### 9. Object URL cleanup

- **removeAttachment** (ChatInput.tsx:237-243): `URL.revokeObjectURL(att.previewUrl)` on remove. ✅
- **send path** (AiPanel.tsx:255): inside the per-attachment loop, `if (att.previewUrl) URL.revokeObjectURL(att.previewUrl)` after save. ✅ (runs even on save failure of that att, since it's after the if/else).
- **No unmount cleanup**: there is NO `useEffect` cleanup that revokes leftover previewUrls on component unmount. If the user closes the panel with attachments pending, the object URLs leak until the page unloads. Minor memory leak; the helper should add a `useEffect(() => () => revokeUrls(attachments)` cleanup hook (or expose `revokeUrls` for the wrapper to call on unmount).

---

## Synthesis

### Proposed `components/chat/attachments.ts` API

```ts
// ── Types ──
export interface PendingAttachment {
  id: string;
  name: string;
  type: 'image' | 'file';
  path?: string;        // disk path (vault @mention / pendingFileAttachments / saved blob)
  blob?: Blob;          // raw blob (paste / picker) — to be saved before send
  previewUrl?: string;  // URL.createObjectURL — images only
}

// ── Pure (no side effects) ──

/** Validate a File against size/type whitelist. Returns {ok, error?}. */
export function validateFile(
  file: File,
  opts: { maxBytes?: number; allowedTypes?: string[] },  // allowedTypes = extensions ['.md','.txt'…] OR mime prefixes ['image/']
): { ok: boolean; error?: string };

/** Build the Read-tool instruction prefix from saved attachments. Pure string build.
 *  Ordering: images first, then files, joined by '\n\n'.
 *  If prompt non-empty: `${instruction}\n\n用户消息: ${prompt}`; else instruction alone. */
export function buildReadInstructions(
  attachments: { path: string; type: 'image' | 'file' }[],
  prompt: string,
): string;

/** Revoke all previewUrl object URLs. Pure-ish (calls URL.revokeObjectURL). */
export function revokeUrls(attachments: PendingAttachment[]): void;

/** Detect image vs file by mime. */
export function isImageFile(file: File): boolean;  // file.type.startsWith('image/')

// ── Side-effectful ──

/** Default id generator — delegates to utils/idGenerator.generateId (injectable for tests). */
export type IdGenerator = () => string;

/** Convert a FileList/File[] into PendingAttachment[] (image vs file detection, previewUrl for images).
 *  Does NOT validate — call validateFile first, or pass opts to filter. */
export function addFiles(
  files: FileList | File[],
  opts: { idGenerator?: IdGenerator },
): PendingAttachment[];

/** Handle a paste event — returns the image PendingAttachment if an image was pasted (and preventsDefault), else null. */
export function handlePaste(
  e: React.ClipboardEvent<HTMLTextAreaElement>,
  opts: { idGenerator?: IdGenerator },
): PendingAttachment | null;

/** Save blob attachments to <workingDir>/.folyn-tmp via plugin-fs writeFile + mkdir recursive.
 *  - path-only attachments are passed through unchanged.
 *  - blob attachments are written as `img-<ts>-<rand>.<ext>`.
 *  - revokes previewUrl after save (or on failure).
 *  Returns the resolved {name, path, type}[] for downstream Read-instruction building. */
export async function saveBlobs(
  attachments: PendingAttachment[],
  workingDir: string,
  opts?: {
    strategy?: 'fs' | 'shell';   // default 'fs' (plugin-fs). 'shell' = legacy base64+claude-cli for AiPanel vault fallback.
    tmpSubdir?: string,           // default '.folyn-tmp' — pet may pass 'pet-chat-tmp'
  },
): Promise<{ name: string; path: string; type: 'image' | 'file' }[]>;
```

**`opts` each function needs**:
- `validateFile`: `{ maxBytes, allowedTypes }` — caller decides limits.
- `addFiles`: `{ idGenerator }` — default `generateId` from `utils/idGenerator`.
- `handlePaste`: `{ idGenerator }`.
- `saveBlobs`: `{ strategy, tmpSubdir }` — strategy chooses fs vs shell; tmpSubdir defaults `.folyn-tmp` (AiPanel) / `pet-chat-tmp` (pet).

**Pure**: `validateFile`, `buildReadInstructions`, `revokeUrls`, `isImageFile`.
**Side-effectful**: `addFiles` (creates object URLs), `handlePaste` (preventDefault + object URL), `saveBlobs` (disk writes + revoke).

### What stays in each wrapper

**AiPanel keeps (vault-coupled)**:
- `mentionMenu`/`mentionIndex` state, `filteredMentionFiles` (flattenFileTree + activeFilePath).
- `handleChange` `@` detection.
- `insertMention` (splices input + pushes path-only PendingAttachment).
- `handleBeforeKeyDown` mention key handling.
- `mentionOverlay` JSX → `overlayLayer` slot.
- `inputMode`/`modeMenu` dropdown → `leadingSlot` (alongside the file-picker button).
- AiPanel.handleSend **Phase B** `@file` regex resolution + prepend (needs `allFiles`).
- `aiStore.pendingFileAttachments` / `pendingPrompt` consumption (vault/editor bridge).
- Hidden `<input type=file>` ref + `handleFileSelect`/`handleFileInputChange` (could move to helper but stays because the ref is co-located with leadingSlot button).

**Moves to shared helper** (vault-free):
- `PendingAttachment` type.
- `handlePaste` logic.
- `handleFileInputChange` logic (as `addFiles`).
- `removeAttachment` revoke logic (as `revokeUrls` + a remove helper).
- `attachmentsRow` chip JSX → recommend a shared `AttachmentChips({ attachments, onRemove })` component in `components/chat/` (reuses `FileIcon`).
- `saveBlobs` + `buildReadInstructions` (AiPanel.handleSend Phase A).

**PetChat adds (minimal)**:
- Hidden file input + paste handler (via helper).
- `attachmentsRow` via shared `AttachmentChips`.
- `canSend={input.trim() || attachments.length > 0}`.
- `saveBlobs(att, workingDir=appData/pet-chat-tmp, {strategy:'fs'})` + `buildReadInstructions` in its send path.
- NO `overlayLayer`, NO `@mention`, NO `inputMode` dropdown, NO `pendingFileAttachments`/`pendingPrompt`.

### Blob-save recommendation

**Use `@tauri-apps/plugin-fs` (`writeFile` + `mkdir recursive`) as the default strategy.** Rationale:
1. Cleaner: direct binary `Uint8Array` write, no base64 encode/decode, no shell quoting of base64 in single quotes, no non-portable `base64 -D` (macOS) vs `-d` (Linux) flag.
2. Avoids the 8192-chunk `String.fromCharCode(...spread)` stack-overflow risk on large images.
3. **Precedent**: `imageUploader.LocalFileStrategy` (imageUploader.ts:50-75) ALREADY does exactly this — `mkdir(parent, {recursive:true})` + `writeFile(absPath, bytes)`.
4. **Pet-panel ACL**: `fs:allow-mkdir` + `fs:allow-write-file` + `fs:scope-appdata-recursive` all granted (pet-panel.json:39-46). Pet writes to `<appData>/pet-chat-tmp` — in scope. ✅
5. **AiPanel caveat**: AiPanel writes to `<vault>/.folyn-tmp` — an arbitrary vault path. If the main window's fs ACL scope does NOT cover the vault, plugin-fs `writeFile` will be DENIED. The helper should offer `strategy: 'shell'` fallback (the current `claude-cli` base64 path) for AiPanel until the main window's fs scope is confirmed to cover the vault. Action item for the implementer: **verify `capabilities/default.json`'s fs scope covers vault paths** before dropping the shell fallback.

### Type whitelist (exact `accept` string to mirror)

```
image/*,.txt,.md,.json,.csv,.pdf,.html,.htm,.xml,.yaml,.yml,.toml,.log
```
(from ChatInput.tsx:342). Export as `DEFAULT_ACCEPT` in the helper; PetChat should mirror the same string.

---

## Caveats / Not Found

- **default.json fs scope NOT verified**: I did not read `capabilities/default.json` — the implementer must confirm whether the main window's `fs:scope-*` covers arbitrary vault paths before deciding AiPanel can drop the shell-base64 fallback. The shell path is the ONLY one that works without fs scope (it goes through `/bin/sh`).
- **No maxBytes today**: the current code has NO file-size limit. The helper's `validateFile({maxBytes})` is a new guard — caller must pick a limit (e.g. 10MB).
- **No dedup on file picker**: only @mention dedups by path. Picking the same file twice creates two chips.
- **No unmount cleanup of previewUrls**: minor leak on panel close — helper should add a `useEffect` unmount revoker in the wrapper (or a `useAttachments` hook).
- **`idGenerator` inconsistency**: inline 4-char suffix vs `generateId()` 6-char — helper should standardize on `generateId()`.
- **plugin-fs `writeFile` binary path**: confirmed supported (imageUploader.ts:75, exportService.ts:264, SettingsPage.tsx:715). No issue.
