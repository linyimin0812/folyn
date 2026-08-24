/**
 * Command adapter — bridges sandbox plugin command contributions into the
 * app's command registry (`commandRegistry`).
 *
 * When a sandbox plugin declares `contributes.commands`, each command is
 * registered with an id namespaced as `plugin.<pluginId>.<cmd.id>`. Running
 * the command posts an invoke message to the plugin iframe via the RPC
 * bridge; the plugin's own handler runs inside the sandbox.
 *
 * On dispose, all registered commands are unregistered (only if they haven't
 * been re-registered by someone else — the `commandRegistry`'s disposable
 * contract handles this).
 */

import type { Disposable } from '@folyn/plugin-host';
import type { PluginManifest } from '@folyn/plugin-host';
import { registerCommand, type CommandDisposable } from '@/services/commandRegistry';
import type { RpcBridge } from './rpcBridge';

/**
 * Register all commands declared in `manifest.contributes.commands`.
 *
 * @param manifest     The plugin manifest.
 * @param bridge       The RPC bridge to the plugin iframe (for dispatching
 *                     command invocations).
 * @returns A disposable that unregisters all commands registered by this call.
 */
export function registerPluginCommands(
  manifest: PluginManifest,
  bridge: RpcBridge,
): Disposable {
  const commands = manifest.contributes?.commands;
  if (!commands || commands.length === 0) {
    return { dispose: () => {} };
  }

  const disposables: CommandDisposable[] = [];
  const pluginId = manifest.id;

  for (const cmd of commands) {
    const fullId = `plugin.${pluginId}.${cmd.id}`;
    const disposable = registerCommand({
      id: fullId,
      title: cmd.title,
      category: 'action',
      icon: cmd.icon,
      keywords: cmd.keywords,
      run: () => { void bridge.invokeCommand(cmd.id); },
    });
    disposables.push(disposable);
  }

  return {
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
