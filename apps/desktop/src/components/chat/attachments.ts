/**
 * Vault-free attachment helpers shared by the main-window AI panel
 * (AiPanel) and the desktop-pet chat (pet-panel window).
 *
 * This module MUST stay free of vault/editor/ai-store coupling so it can
 * be bundled into the secondary pet-panel Tauri window (which has no
 * vault/editor/aiStore). Grep-verify before adding an import:
 *
 *   grep -nE "from '@/store/(vaultStore|editorStore|aiStore)'" \
 *     apps/desktop/src/components/chat/attachments.ts   # must be empty
 *
 * @mention resolution, input-mode dropdowns, and vault file-tree lookups
 * stay in each consumer wrapper — this helper owns ONLY the vault-free
 * attachment lifecycle (validate, add, paste, save-to-disk, Read-instruction
 * prefix, object-URL cleanup).
 */

import { mkdir, writeFile } from '@tauri-apps/plugin-fs';
import { isTauri } from '@/utils/platform';
import { generateId } from '@/utils/idGenerator';

// ── Types ───────────────────────────────────────────────

export interface PendingAttachment {
  id: string;
  name: string;
  type: 'image' | 'file';
  /** Disk path for attachments that already live on disk (vault @mention,
   *  pendingFileAttachments, or a saved blob after `saveBlobs`). Undefined
   *  for paste / file-picker blobs that have not yet been saved. */
  path?: string;
  /** Raw blob awaiting save. Set for paste-image and file-picker `File`
   *  selections (a `File` is a `Blob`). Undefined for path-only sources. */
  blob?: Blob;
  /** `URL.createObjectURL` preview for images; revoke via `revokeUrls`. */
  previewUrl?: string;
}

export interface SavedAttachment {
  name: string;
  path: string;
  type: 'image' | 'file';
}

export interface ValidationOptions {
  /** Per-file byte cap. Defaults to {@link DEFAULT_MAX_BYTES}. */
  maxBytes?: number;
  /** Whitelist of accept tokens — either `image/*` (matches any image
   *  mime) or dot-prefixed extensions (`.md`, `.txt`, …). Defaults to
   *  {@link DEFAULT_ALLOWED_TYPES}. */
  allowedTypes?: string[];
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export interface AddFilesOptions extends ValidationOptions {
  /** ID generator for new attachments. Defaults to {@link generateId}. */
  idGenerator?: () => string;
}

export interface AddFilesResult {
  accepted: PendingAttachment[];
  rejected: { name: string; error: string }[];
}

export interface SaveBlobsOptions {
  /** `'fs'` (default) uses `@tauri-apps/plugin-fs` `mkdir` + `writeFile`;
   *  `'shell'` mirrors AiPanel's legacy base64-via-`claude-cli` sidecar
   *  path for vault-grounded writes that may fall outside the window's
   *  fs ACL scope. */
  strategy?: 'fs' | 'shell';
  /** Subdirectory under `workingDir` to write blobs into. Defaults to
   *  {@link ATTACHMENTS_SUBDIR}. */
  subdir?: string;
}

// ── Constants ───────────────────────────────────────────

/** Default per-file size cap: 10 MB. */
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/** Default type whitelist — mirrors AiPanel's `accept` attribute exactly. */
export const DEFAULT_ALLOWED_TYPES: readonly string[] = [
  'image/*',
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.pdf',
  '.html',
  '.htm',
  '.xml',
  '.yaml',
  '.yml',
  '.toml',
  '.log',
];

/** Default subdirectory under a working dir for saved blob attachments. */
export const ATTACHMENTS_SUBDIR = 'attachments';

/** Image extensions used as a fallback when a `File` has an empty mime. */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];

// ── Pure helpers ────────────────────────────────────────

/** Detect an image `File` by mime, falling back to extension when the mime
 *  is empty (some webview paste paths leave `file.type` blank). */
export function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  const lower = file.name.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Validate a `File` against the size + type whitelist. */
export function validateFile(
  file: File,
  opts: ValidationOptions = {},
): ValidationResult {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const allowed = opts.allowedTypes ?? DEFAULT_ALLOWED_TYPES;

  if (file.size > maxBytes) {
    const mb = Math.round((maxBytes / 1024 / 1024) * 10) / 10;
    return { ok: false, error: `文件超过 ${mb}MB 上限` };
  }

  const lowerName = file.name.toLowerCase();
  const matched = allowed.some((token) => {
    if (token === 'image/*') {
      return file.type.startsWith('image/') || IMAGE_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
    }
    if (token.startsWith('.')) {
      return lowerName.endsWith(token.toLowerCase());
    }
    // Treat any other token as a literal mime prefix.
    return file.type.startsWith(token.toLowerCase());
  });
  if (!matched) {
    return { ok: false, error: '不支持的文件类型' };
  }
  return { ok: true };
}

/**
 * Build the Read-tool instruction prefix from saved attachments.
 *
 * Mirrors AiPanel.handleSend Phase A exactly:
 * - images first, then files, blocks joined with `\n\n`.
 * - paths within a block joined with `\n`.
 * - if `prompt` is non-empty: `${instruction}\n\n用户消息: ${prompt}`;
 *   else instruction alone.
 * - no attachments → `prompt` unchanged.
 *
 * @mention resolution (Phase B) is NOT handled here — it stays in the
 * AiPanel wrapper (it needs the vault file tree).
 */
export function buildReadInstructions(
  attachments: SavedAttachment[],
  prompt: string,
): string {
  if (attachments.length === 0) return prompt;

  const images = attachments.filter((a) => a.type === 'image');
  const files = attachments.filter((a) => a.type === 'file');
  const parts: string[] = [];
  if (images.length > 0) {
    parts.push(`请先使用 Read 工具读取以下图片文件:\n${images.map((a) => a.path).join('\n')}`);
  }
  if (files.length > 0) {
    parts.push(`请先使用 Read 工具读取以下文件:\n${files.map((a) => a.path).join('\n')}`);
  }
  const instruction = parts.join('\n\n');
  return prompt ? `${instruction}\n\n用户消息: ${prompt}` : instruction;
}

/** Revoke all `previewUrl` object URLs. No-op for attachments without a
 *  preview URL or when running outside a browser. */
export function revokeUrls(attachments: PendingAttachment[]): void {
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  for (const att of attachments) {
    if (att.previewUrl) {
      URL.revokeObjectURL(att.previewUrl);
    }
  }
}

// ── Side-effectful helpers ──────────────────────────────

/**
 * Convert a `FileList` / `File[]` into validated `PendingAttachment[]`.
 *
 * File-picker `File` objects in the Tauri webview do not expose an absolute
 * disk path, so `path` is left undefined — blob attachments are saved to
 * disk later via {@link saveBlobs}. Image attachments get a `previewUrl`
 * (`URL.createObjectURL`); file attachments do not.
 *
 * Returns both accepted and rejected lists so the caller can surface inline
 * errors for rejected files.
 */
export function addFiles(
  files: FileList | File[],
  opts: AddFilesOptions = {},
): AddFilesResult {
  const idGen = opts.idGenerator ?? generateId;
  const accepted: PendingAttachment[] = [];
  const rejected: { name: string; error: string }[] = [];

  for (const file of Array.from(files)) {
    const result = validateFile(file, opts);
    if (!result.ok) {
      rejected.push({ name: file.name, error: result.error ?? '文件无效' });
      continue;
    }
    const image = isImageFile(file);
    accepted.push({
      id: idGen(),
      name: file.name,
      type: image ? 'image' : 'file',
      blob: file,
      previewUrl: image ? URL.createObjectURL(file) : undefined,
    });
  }
  return { accepted, rejected };
}

/**
 * Handle a paste event — extract image attachments from the clipboard.
 *
 * Mirrors AiPanel's `handlePaste`: scans `clipboardData.items` for
 * `kind === 'file'` image items, builds a `PendingAttachment` per image
 * (named `paste-<ts>.<ext>`). Non-image paste yields an empty result so
 * the caller can let the browser insert text normally.
 *
 * Does NOT call `preventDefault` — the caller decides whether to consume
 * the event based on whether the result is non-empty.
 */
export function handlePaste(
  e: React.ClipboardEvent<HTMLTextAreaElement>,
  opts: AddFilesOptions = {},
): AddFilesResult {
  const idGen = opts.idGenerator ?? generateId;
  const accepted: PendingAttachment[] = [];
  const rejected: { name: string; error: string }[] = [];

  const items = e.clipboardData?.items;
  if (!items) return { accepted, rejected };

  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (!file) continue;
    if (!isImageFile(file)) continue;

    const result = validateFile(file, opts);
    if (!result.ok) {
      const ext = file.type.split('/')[1] || 'png';
      rejected.push({ name: `paste-${Date.now()}.${ext}`, error: result.error ?? '文件无效' });
      continue;
    }
    const ext = file.type.split('/')[1] || 'png';
    accepted.push({
      id: idGen(),
      name: `paste-${Date.now()}.${ext}`,
      type: 'image',
      blob: file,
      previewUrl: URL.createObjectURL(file),
    });
  }
  return { accepted, rejected };
}

/** Build the on-disk filename for a blob attachment: `<id>-<safeName>`,
 *  appending `.<ext>` only when the sanitized name does not already end
 *  with that extension (avoids `pic.png.png`). */
function buildBlobFileName(att: PendingAttachment, ext: string): string {
  const safeName = sanitizeFileName(att.name, att.id);
  const lower = safeName.toLowerCase();
  const suffix = `.${ext}`.toLowerCase();
  const tail = lower.endsWith(suffix) ? '' : suffix;
  return `${att.id}-${safeName}${tail}`;
}

/** Sanitize a filename for disk write: strip path separators, fall back to
 *  `attachment-<id>` when empty. Does NOT otherwise restrict characters
 *  (the workingDir is a trusted temp path). */
function sanitizeFileName(name: string, id: string): string {
  const cleaned = name.replace(/[/\\]/g, '_').trim();
  return cleaned || `attachment-${id}`;
}

/** Derive an extension for the on-disk filename. Prefers the filename's
 *  extension (mirrors AiPanel's `att.name.split('.').pop()`), falling back
 *  to the blob mime subtype, then `bin`. */
function deriveExtension(att: PendingAttachment): string {
  const dot = att.name.lastIndexOf('.');
  if (dot >= 0 && dot < att.name.length - 1) {
    const ext = att.name.slice(dot + 1).replace(/[^a-zA-Z0-9+]/g, '');
    if (ext) return ext;
  }
  if (att.blob?.type) {
    const sub = att.blob.type.split('/')[1];
    if (sub) return sub.replace(/[^a-zA-Z0-9+]/g, '');
  }
  return 'bin';
}

/**
 * Save blob attachments to disk and return their resolved disk paths.
 *
 * - path-only attachments pass through unchanged (their `path` is returned
 *   as-is, type preserved) — they are already on disk.
 * - blob attachments are written to `${workingDir}/${subdir}/${id}-${name}`
 *   (sanitized) and their `previewUrl` is revoked after the write.
 *
 * Default strategy `'fs'` uses `@tauri-apps/plugin-fs` `mkdir` (recursive)
 * + `writeFile(Uint8Array)` — cleaner than the legacy base64 shell path
 * (no shell quoting, no non-portable `base64 -D` flag, no
 * `String.fromCharCode(...spread)` stack risk). It works under the
 * pet-panel ACL (`fs:allow-mkdir` + `fs:allow-write-file` +
 * `fs:scope-appdata-recursive`) because pet writes under appData.
 *
 * `'shell'` mirrors AiPanel's legacy base64-via-`claude-cli` sidecar path,
 * kept as an opt-in for AiPanel until the main window's fs ACL scope is
 * confirmed to cover arbitrary vault paths.
 *
 * Throws when not running inside Tauri (caller catches and surfaces an
 * inline error).
 */
export async function saveBlobs(
  attachments: PendingAttachment[],
  workingDir: string,
  opts: SaveBlobsOptions = {},
): Promise<SavedAttachment[]> {
  const strategy = opts.strategy ?? 'fs';
  const subdir = opts.subdir ?? ATTACHMENTS_SUBDIR;

  if (strategy === 'fs') {
    return saveBlobsFs(attachments, workingDir, subdir);
  }
  return saveBlobsShell(attachments, workingDir, subdir);
}

async function saveBlobsFs(
  attachments: PendingAttachment[],
  workingDir: string,
  subdir: string,
): Promise<SavedAttachment[]> {
  if (!isTauri()) {
    throw new Error('附件保存需要 Tauri 环境');
  }

  const dir = `${workingDir}/${subdir}`;
  // The mock and real plugin both accept { recursive: true }; the mock's
  // ensureDir already creates intermediate dirs recursively regardless.
  await mkdir(dir, { recursive: true });

  const saved: SavedAttachment[] = [];
  for (const att of attachments) {
    if (att.path) {
      saved.push({ name: att.name, path: att.path, type: att.type });
      continue;
    }
    if (!att.blob) {
      // No path and no blob — nothing to save; skip.
      continue;
    }
    const ext = deriveExtension(att);
    const fileName = buildBlobFileName(att, ext);
    const filePath = `${dir}/${fileName}`;
    const bytes = new Uint8Array(await att.blob.arrayBuffer());
    await writeFile(filePath, bytes);
    if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
    saved.push({ name: att.name, path: filePath, type: att.type });
  }
  return saved;
}

async function saveBlobsShell(
  attachments: PendingAttachment[],
  workingDir: string,
  subdir: string,
): Promise<SavedAttachment[]> {
  const { Command } = await import('@tauri-apps/plugin-shell');
  const dir = `${workingDir}/${subdir}`;
  await Command.create('claude-cli', ['-l', '-c', `mkdir -p '${dir}'`]).execute();

  const saved: SavedAttachment[] = [];
  for (const att of attachments) {
    if (att.path) {
      saved.push({ name: att.name, path: att.path, type: att.type });
      continue;
    }
    if (!att.blob) continue;

    const ext = deriveExtension(att);
    const fileName = buildBlobFileName(att, ext);
    const filePath = `${dir}/${fileName}`;

    const buffer = await att.blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    // Chunked base64 encode (avoids spread-stack overflow on large blobs).
    let binaryStr = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      binaryStr += String.fromCharCode(...bytes.slice(i, i + chunk));
    }
    const base64 = btoa(binaryStr);
    const writeResult = await Command.create(
      'claude-cli',
      ['-l', '-c', `printf '%s' '${base64}' | base64 -D > '${filePath}'`],
    ).execute();
    if (writeResult.code === 0) {
      saved.push({ name: att.name, path: filePath, type: att.type });
    }
    if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
  }
  return saved;
}
