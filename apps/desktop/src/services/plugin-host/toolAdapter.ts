/**
 * Tool contribution adapter.
 *
 * Wires a plugin's `contributes.tools[]` declarations into the command
 * registry: each tool becomes an "Open: <title>" command in ⌘P. Running
 * the command opens a Tauri WebviewWindow loading the plugin's HTML entry
 * via the `quill-plugin://localhost/<pluginId>/<entry>` URL (the existing
 * URI scheme handler serves the bytes).
 *
 * Tier-agnostic — works for both sandbox and trusted tiers. The window's
 * origin is `quill-plugin://localhost` on macOS/Linux and
 * `http://quill-plugin.localhost` on Windows; in both cases the WebviewWindow
 * is isolated from the main app's origin.
 *
 * Dispose unregisters the commands AND closes all of this plugin's open tool
 * windows so plugin deactivate reaps both the registration and the UI.
 */

import type { Disposable, PluginManifest } from '@quill/plugin-host';
import type { ToolContribution } from '@quill/plugin-host';
import { registerCommand } from '@/services/commandRegistry';
import { useToolWindowStore } from '@/store/toolWindowStore';

export function registerPluginTools(manifest: PluginManifest): Disposable {
  const tools: ToolContribution[] = manifest.contributes?.tools ?? [];
  if (tools.length === 0) return { dispose: async () => {} };

  const disposables: Array<{ dispose: () => void }> = [];
  for (const tool of tools) {
    if (tool.window !== true) {
      // MVP: only `window: true` is implemented. Inline panels (`window: false`)
      // require a separate host slot — deferred to a follow-up task.
      console.warn(
        `[plugin-host] plugin "${manifest.id}" tool "${tool.id}" has window: false — inline panels not supported yet, skipped`,
      );
      continue;
    }
    const fullId = `plugin.openTool.${manifest.id}.${tool.id}`;
    const title = tool.title ?? `${manifest.id}/${tool.id}`;
    const d = registerCommand({
      id: fullId,
      title: `Open: ${title}`,
      category: 'action',
      icon: tool.icon,
      keywords: ['plugin', 'tool', 'open', manifest.id, tool.id],
      run: () => {
        void useToolWindowStore.getState().open(manifest.id, tool);
      },
    });
    disposables.push(d);
  }

  return {
    dispose: async () => {
      for (const d of disposables) d.dispose();
      await useToolWindowStore.getState().closeAllForPlugin(manifest.id);
    },
  };
}
