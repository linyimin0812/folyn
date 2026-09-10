/**
 * Sandbox-tier ExtensionLoader.
 *
 * Implements the `ExtensionLoader` interface for `tier: 'sandbox'` extensions. On
 * `load()`, creates a hidden `<iframe sandbox="allow-scripts">` (NO
 * `allow-same-origin`) loading from `folyn-extension://localhost/<id>/<html>`,
 * wires a {@link RpcBridge} for host-mediated capability calls, and returns an
 * `Extension` whose `activate`/`deactivate` send lifecycle messages and
 * register contributed commands.
 *
 * Hard constraints (see research/tauri-runtime-loading.md):
 *   - `sandbox="allow-scripts"` WITHOUT `allow-same-origin` → unique opaque
 *     origin, cross-origin isolation, no parent DOM / Tauri API access.
 *   - Cross-origin `postMessage` is the only bridge.
 *   - ES module cache cannot be evicted → unload by destroying the iframe
 *     element (remove from DOM), not by module eviction.
 *   - Extensions get NO raw Tauri capabilities (no `add_capability`).
 */

import type {
  Extension,
  ExtensionApi,
  ExtensionContext,
  ExtensionLoader,
  ExtensionManifest,
} from '@folyn/extension-host';
import { disposable } from '@folyn/extension-host';
import { RpcBridge } from './rpcBridge';
import { registerExtensionCommands } from './commandAdapter';
import { registerExtensionTools } from './toolAdapter';

export const sandboxLoader: ExtensionLoader = {
  tier: 'sandbox',

  async load(manifest: ExtensionManifest): Promise<Extension> {
    const iframe = createExtensionIframe(manifest);
    const bridge = new RpcBridge({
      extensionId: manifest.id,
      manifest,
      targetWindow: () => iframe.contentWindow,
    });

    return {
      activate: (_api: ExtensionApi, ctx: ExtensionContext) => {
        // Register contributed commands — their `run` dispatches invoke
        // messages to the iframe via the bridge. Push the disposable so
        // ExtensionHost reaps it on deactivate.
        const cmdDisposable = registerExtensionCommands(manifest, bridge);
        ctx.addDisposable(cmdDisposable);

        // Register contributed tools (full-window extension UIs). Each tool
        // becomes an "Open: <title>" command in ⌘P that opens a Tauri
        // WebviewWindow loading the extension's HTML entry.
        const toolDisposable = registerExtensionTools(manifest);
        ctx.addDisposable(toolDisposable);

        // The iframe-destroy disposable: destroying the iframe is the
        // sandbox-tier "unload" path (ES module cache is evicted with the
        // realm). Push it so ExtensionHost reaps it after deactivate().
        ctx.addDisposable(
          disposable(() => {
            bridge.dispose();
            destroyIframe(iframe);
          }),
        );

        // Signal the extension to activate (it may set up its UI / state).
        bridge.sendLifecycle('activate');
      },
      deactivate: (_ctx: ExtensionContext) => {
        // Tell the extension it's being deactivated. The iframe itself is
        // destroyed by the disposable reaped immediately after this call.
        bridge.sendLifecycle('deactivate');
      },
    };
  },
};

/**
 * Create a hidden sandboxed iframe for the extension. The iframe is attached to
 * `document.body` but visually hidden (0×0, off-screen). Tool-window extensions
 * that need visible UI will create their own visible iframe via the
 * `window:open` RPC path.
 */
function createExtensionIframe(manifest: ExtensionManifest): HTMLIFrameElement {
  const html = manifest.html ?? 'index.html';
  const src = `folyn-extension://localhost/${manifest.id}/${html}`;

  const iframe = document.createElement('iframe');
  // `allow-scripts` lets the extension run JS; NO `allow-same-origin` gives a
  // unique opaque origin so the iframe cannot access parent DOM, cookies,
  // localStorage, or Tauri APIs.
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.src = src;
  iframe.style.display = 'none';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';
  iframe.style.position = 'absolute';
  iframe.style.top = '-9999px';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);
  return iframe;
}

/** Remove an iframe from the DOM and null its src to release resources. */
function destroyIframe(iframe: HTMLIFrameElement): void {
  try {
    iframe.src = 'about:blank';
  } catch {
    // Cross-origin src reset can throw in some browsers — non-fatal.
  }
  iframe.remove();
}
