/**
 * Tool contribution adapter.
 *
 * Wires a extension's `contributes.tools[]` declarations into the command
 * registry: each tool becomes an "Open: <title>" command in ⌘P. Running
 * the command opens a Tauri WebviewWindow loading the extension's HTML entry
 * via the `folyn-extension://localhost/<extensionId>/<entry>` URL (the existing
 * URI scheme handler serves the bytes).
 *
 * Tier-agnostic — works for both sandbox and trusted tiers. The window's
 * origin is `folyn-extension://localhost` on macOS/Linux and
 * `http://folyn-extension.localhost` on Windows; in both cases the WebviewWindow
 * is isolated from the main app's origin.
 *
 * Dispose unregisters the commands AND closes all of this extension's open tool
 * windows so extension deactivate reaps both the registration and the UI.
 */

import type { Disposable, ExtensionManifest } from '@folyn/extension-host';
import type { ToolContribution } from '@folyn/extension-host';
import { registerCommand } from '@/services/commandRegistry';
import { useToolWindowStore } from '@/store/toolWindowStore';

export function registerExtensionTools(manifest: ExtensionManifest): Disposable {
  const tools: ToolContribution[] = manifest.contributes?.tools ?? [];
  if (tools.length === 0) return { dispose: async () => {} };

  const disposables: Array<{ dispose: () => void }> = [];
  for (const tool of tools) {
    if (tool.window !== true) {
      // MVP: only `window: true` is implemented. Inline panels (`window: false`)
      // require a separate host slot — deferred to a follow-up task.
      console.warn(
        `[extension-host] extension "${manifest.id}" tool "${tool.id}" has window: false — inline panels not supported yet, skipped`,
      );
      continue;
    }
    const fullId = `extension.openTool.${manifest.id}.${tool.id}`;
    const title = tool.title ?? `${manifest.id}/${tool.id}`;
    const d = registerCommand({
      id: fullId,
      title: `Open: ${title}`,
      category: 'action',
      icon: tool.icon,
      keywords: ['extension', 'tool', 'open', manifest.id, tool.id],
      run: () => {
        void useToolWindowStore.getState().open(manifest.id, tool);
      },
    }, manifest.id);
    disposables.push(d);
  }

  return {
    dispose: async () => {
      for (const d of disposables) d.dispose();
      await useToolWindowStore.getState().closeAllForExtension(manifest.id);
    },
  };
}
