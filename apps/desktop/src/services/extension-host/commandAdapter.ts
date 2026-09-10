/**
 * Command adapter — bridges sandbox extension command contributions into the
 * app's command registry (`commandRegistry`).
 *
 * When a sandbox extension declares `contributes.commands`, each command is
 * registered with an id namespaced as `extension.<extensionId>.<cmd.id>`. Running
 * the command posts an invoke message to the extension iframe via the RPC
 * bridge; the extension's own handler runs inside the sandbox.
 *
 * On dispose, all registered commands are unregistered (only if they haven't
 * been re-registered by someone else — the `commandRegistry`'s disposable
 * contract handles this).
 */

import type { Disposable } from '@folyn/extension-host';
import type { ExtensionManifest } from '@folyn/extension-host';
import { registerCommand, type CommandDisposable } from '@/services/commandRegistry';
import type { RpcBridge } from './rpcBridge';

/**
 * Register all commands declared in `manifest.contributes.commands`.
 *
 * @param manifest     The extension manifest.
 * @param bridge       The RPC bridge to the extension iframe (for dispatching
 *                     command invocations).
 * @returns A disposable that unregisters all commands registered by this call.
 */
export function registerExtensionCommands(
  manifest: ExtensionManifest,
  bridge: RpcBridge,
): Disposable {
  const commands = manifest.contributes?.commands;
  if (!commands || commands.length === 0) {
    return { dispose: () => {} };
  }

  const disposables: CommandDisposable[] = [];
  const extensionId = manifest.id;

  for (const cmd of commands) {
    const fullId = `extension.${extensionId}.${cmd.id}`;
    const disposable = registerCommand({
      id: fullId,
      title: cmd.title,
      category: 'action',
      icon: cmd.icon,
      keywords: cmd.keywords,
      run: () => { void bridge.invokeCommand(cmd.id); },
    }, manifest.id);
    disposables.push(disposable);
  }

  return {
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
