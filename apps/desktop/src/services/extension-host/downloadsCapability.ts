/**
 * Downloads capability: the files `network.download` saved.
 *
 * Display is not this capability's job — `preview.component()` renders them
 * with the editor's own preview, so `path` just hands over the location.
 */

import type { ExtensionDownloadedFile, ExtensionDownloadsCapability, ExtensionManifest } from '@folyn/extension-host';
import { isTauri } from '@/utils/platform';

export function buildExtensionDownloads(manifest: ExtensionManifest): ExtensionDownloadsCapability {
  const call = async <T>(command: string, args: Record<string, unknown> = {}): Promise<T> => {
    if (!isTauri()) throw new Error('下载文件需要 Folyn 桌面版');
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(command, { extensionId: manifest.id, ...args });
  };

  return {
    list: () => call<ExtensionDownloadedFile[]>('extension_downloads_list'),
    path: (name) => call<string>('extension_download_path', { name }),
    async reveal(name) {
      await call('extension_reveal_download', { name });
    },
  };
}
