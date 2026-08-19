/**
 * Tool-window state.
 *
 * Tracks open plugin tool windows (one Tauri `WebviewWindow` per activation,
 * multi-instance). The store is the runtime side of the `tools` contribution
 * point; `registerPluginTools` (services/plugin-host/toolAdapter.ts) opens
 * windows via this store when the user invokes an "Open: <tool>" command.
 *
 * On plugin deactivate, the adapter's disposable calls `closeAllForPlugin`
 * so all of that plugin's tool windows are destroyed in the same pass that
 * reaps commands + containers.
 *
 * State management conventions (see .trellis/spec/desktop/frontend/state-
 * management.md): granular selectors, `getState()` for imperative code
 * (Tauri event listeners in App.tsx), no whole-store subscriptions.
 */

import { create } from 'zustand';
import { isTauri } from '@/utils/platform';
import type { ToolContribution } from '@quill/plugin-host';

export interface OpenToolWindow {
  label: string;
  pluginId: string;
  toolId: string;
  title: string;
}

interface ToolWindowState {
  windows: OpenToolWindow[];
  /** Open a new tool window. Multi-instance: each call creates a new window. */
  open: (pluginId: string, tool: ToolContribution) => Promise<void>;
  /** Close a specific window by label. No-op if not open. */
  close: (label: string) => Promise<void>;
  /** Close all windows for a plugin (used on deactivate). */
  closeAllForPlugin: (pluginId: string) => Promise<void>;
  /** Remove a window from tracking (called after the OS window closes). */
  remove: (label: string) => void;
}

export const useToolWindowStore = create<ToolWindowState>((set, get) => ({
  windows: [],

  open: async (pluginId, tool) => {
    if (!isTauri()) return;
    // ponytail: window creation is routed through the Rust
    // `open_plugin_tool_window` command so the fullscreen close handling and
    // the per-tool fullscreen memory stay in one place (Rust). The Rust side
    // reopens a tool in the fullscreen state it was closed in, and the
    // app-level on_window_event does the fullscreen-aware close (exit
    // fullscreen → wait for the transition → destroy) that avoids the black
    // fullscreen Space macOSPrivateApi leaves behind on a
    // destroy-mid-transition.
    // Creation is intentionally NOT done via the JS `WebviewWindow`
    // constructor: a JS `once('tauri://close-requested')` listener on a
    // cross-window handle registers an event target on the isolated plugin
    // webview, which is exactly the "callback silently dropped" case — Tauri
    // routes the window event to the source window's webview context, which
    // for isolated plugin webviews has no Tauri APIs — so any close/cleanup
    // logic hung off that listener never runs. Routing creation through Rust
    // keeps the close handling where it can actually fire.
    const { invoke } = await import('@tauri-apps/api/core');
    const title = tool.title ?? `${pluginId}/${tool.id}`;
    let label: string;
    try {
      label = await invoke<string>('open_plugin_tool_window', {
        pluginId,
        toolId: tool.id,
        entry: tool.entry,
        title,
      });
    } catch (err) {
      console.error(`[plugin-host] open_plugin_tool_window failed for ${pluginId}/${tool.id}:`, err);
      return;
    }
    set({
      windows: [
        ...get().windows,
        { label, pluginId, toolId: tool.id, title },
      ],
    });
  },

  close: async (label) => {
    if (!isTauri()) return;
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.close().catch((err: unknown) => {
        console.warn(`[plugin-host] failed to close tool window "${label}":`, err);
      });
    }
    get().remove(label);
  },

  closeAllForPlugin: async (pluginId) => {
    const toClose = get()
      .windows.filter((w) => w.pluginId === pluginId)
      .map((w) => w.label);
    await Promise.all(toClose.map((l) => get().close(l)));
  },

  remove: (label) =>
    set({ windows: get().windows.filter((w) => w.label !== label) }),
}));
