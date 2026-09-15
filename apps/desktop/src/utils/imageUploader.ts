/** Upload target id. `'local'` for the vault-local strategy; otherwise a
 *  registered storage provider id (e.g. `r2`, `github-jsdelivr`). String so
 *  extension provider ids flow through without a cast — mirrors
 *  `StorageProviderId`'s stance. */
export type UploadTarget = string;

/** Result returned after a successful upload */
export interface ImageUploadResult {
  /** URL or path to use in Markdown `![](here)` */
  markdownUrl: string;
  /** Fully-qualified URL the preview can fetch */
  previewUrl: string;
  /** Approximate file size in bytes */
  fileSize: number;
}

/** Common config shared by all strategies */
export interface ImageUploadConfig {
  fileName: string;
  format: 'png' | 'jpeg' | 'webp';
}

/** Config specific to local-server uploads */
export interface LocalUploadConfig extends ImageUploadConfig {
  directory: string;
}

/** Strategy interface – every upload backend implements this */
export interface ImageUploadStrategy {
  readonly name: UploadTarget;
  readonly labelKey: string;
  readonly icon: string;
  readonly enabled: boolean;

  upload(imageBase64: string, config: ImageUploadConfig, vaultRoot: string, currentFilePath?: string): Promise<ImageUploadResult>;
}

// ─── Helpers ────────────────────────────────────────────

import { writeFile, mkdir } from '@tauri-apps/plugin-fs';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useStorageConfigStore } from '@/services/storage/storageConfigStore';
import { getAllProviders, type StorageProviderEntry } from '@/services/storage/registry';

// ─── Local Server Strategy ──────────────────────────────

class LocalFileStrategy implements ImageUploadStrategy {
  readonly name: UploadTarget = 'local';
  readonly labelKey = 'editor:imagePaste.targets.local';
  readonly icon = '📁';
  readonly enabled = true;

  async upload(imageBase64: string, config: ImageUploadConfig, vaultRoot: string, currentFilePath?: string): Promise<ImageUploadResult> {
    const localConfig = config as LocalUploadConfig;
    const relativePath = `${localConfig.directory}/${localConfig.fileName}.${localConfig.format}`;

    const { homeDir, join, dirname } = await import('@tauri-apps/api/path');
    const resolvedRoot = vaultRoot.startsWith('~')
      ? await join(await homeDir(), vaultRoot.slice(2))
      : vaultRoot;
    const absPath = await join(resolvedRoot, relativePath);

    const parentDir = await dirname(absPath);
    await mkdir(parentDir, { recursive: true });

    const bytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
    await writeFile(absPath, bytes);

    // Generate markdown URL relative to the current file's directory
    let markdownUrl = `./${relativePath}`;
    if (currentFilePath) {
      const fileDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));
      if (fileDir && relativePath.startsWith(fileDir + '/')) {
        markdownUrl = `./${relativePath.slice(fileDir.length + 1)}`;
      }
    }

    return {
      markdownUrl,
      previewUrl: convertFileSrc(absPath),
      fileSize: bytes.length,
    };
  }
}

const localStrategy = new LocalFileStrategy();

// ─── Cloud-provider Strategy (delegates to storage layer) ─────────────
// One strategy per image-capable registered provider (built-in R2/Qiniu/OSS
// + extension-contributed providers like github-jsdelivr). The provider list
// comes from the StorageProviderRegistry, so the paste dropdown stays in sync
// with whatever providers are registered — no per-provider class, no
// hardcoded id list.

class CloudProviderStrategy implements ImageUploadStrategy {
  readonly name: UploadTarget;
  readonly labelKey: string;
  readonly icon: string;
  constructor(private readonly entry: StorageProviderEntry) {
    this.name = entry.id;
    this.labelKey = entry.labelKey;
    this.icon = entry.icon ?? '';
  }
  get enabled(): boolean {
    const cfg = useStorageConfigStore.getState().configs[this.entry.id] ?? null;
    return this.entry.isConfigured(cfg);
  }

  async upload(imageBase64: string, config: ImageUploadConfig, _vaultRoot: string, _currentFilePath?: string): Promise<ImageUploadResult> {
    const cfg = useStorageConfigStore.getState().configs[this.entry.id] ?? null;
    const upload = this.entry.uploadImage;
    if (!this.entry.isConfigured(cfg) || !upload) throw new Error(`${this.entry.id} not configured`);
    const bytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
    const ext = config.format === 'jpeg' ? 'jpg' : config.format;
    const url = await upload(bytes, ext, cfg);
    return { markdownUrl: url, previewUrl: url, fileSize: bytes.length };
  }
}

// ─── Registry ─────────────────────────────────────────────────────────
// Built fresh on each call so extension providers that register after boot
// (trusted-tier activation) appear in the paste dropdown immediately.

export function getAllStrategies(): ImageUploadStrategy[] {
  const cloud = getAllProviders()
    .filter((p) => p.capabilities.image)
    .map((p) => new CloudProviderStrategy(p));
  return [localStrategy, ...cloud];
}

export function getStrategy(name: UploadTarget): ImageUploadStrategy {
  const strategy = getAllStrategies().find((s) => s.name === name);
  if (!strategy) throw new Error(`Unknown upload target: ${name}`);
  return strategy;
}

// ─── Image conversion helpers ───────────────────────────

/** Convert a File to a base64 string (without the data-url prefix) */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Convert an image File to a different format via Canvas, returning base64 */
export function convertImageFormat(
  file: File,
  format: 'png' | 'jpeg' | 'webp',
  quality = 0.92,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas not supported')); return; }
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL(`image/${format}`, quality);
      resolve(dataUrl.split(',')[1]);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

/** Generate a default file name based on current timestamp */
export function generateDefaultFileName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `screenshot-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
