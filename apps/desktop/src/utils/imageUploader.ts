/** Upload target types */
export type UploadTarget = 'local' | 'oss' | 'cdn';

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
  readonly label: string;
  readonly icon: string;
  readonly enabled: boolean;

  upload(imageBase64: string, config: ImageUploadConfig, vaultRoot: string, currentFilePath?: string): Promise<ImageUploadResult>;
}

// ─── Helpers ────────────────────────────────────────────

import { writeFile, mkdir } from '@tauri-apps/plugin-fs';
import { convertFileSrc } from '@tauri-apps/api/core';

// ─── Local Server Strategy ──────────────────────────────

class LocalFileStrategy implements ImageUploadStrategy {
  readonly name: UploadTarget = 'local';
  readonly label = '本地文件';
  readonly icon = '📁';
  readonly enabled = true;

  async upload(imageBase64: string, config: ImageUploadConfig, vaultRoot: string, currentFilePath?: string): Promise<ImageUploadResult> {
    const localConfig = config as LocalUploadConfig;
    const relativePath = `${localConfig.directory}/${localConfig.fileName}.${localConfig.format}`;

    const { homeDir, join } = await import('@tauri-apps/api/path');
    const resolvedRoot = vaultRoot.startsWith('~')
      ? await join(await homeDir(), vaultRoot.slice(2))
      : vaultRoot;
    const absPath = await join(resolvedRoot, relativePath);

    const parentDir = absPath.substring(0, absPath.lastIndexOf('/'));
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

// ─── OSS Strategy (reserved) ────────────────────────────

class OssStrategy implements ImageUploadStrategy {
  readonly name: UploadTarget = 'oss';
  readonly label = 'OSS 云存储';
  readonly icon = '☁️';
  readonly enabled = false;

  async upload(): Promise<ImageUploadResult> {
    throw new Error('OSS 上传暂未实现');
  }
}

// ─── CDN Strategy (reserved) ────────────────────────────

class CdnStrategy implements ImageUploadStrategy {
  readonly name: UploadTarget = 'cdn';
  readonly label = 'CDN';
  readonly icon = '🔗';
  readonly enabled = false;

  async upload(): Promise<ImageUploadResult> {
    throw new Error('CDN 上传暂未实现');
  }
}

// ─── Registry ───────────────────────────────────────────

const uploadStrategies: ImageUploadStrategy[] = [
  new LocalFileStrategy(),
  new OssStrategy(),
  new CdnStrategy(),
];

export function getStrategy(name: UploadTarget): ImageUploadStrategy {
  const strategy = uploadStrategies.find((s) => s.name === name);
  if (!strategy) throw new Error(`Unknown upload target: ${name}`);
  return strategy;
}

export function getAllStrategies(): ImageUploadStrategy[] {
  return uploadStrategies;
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
