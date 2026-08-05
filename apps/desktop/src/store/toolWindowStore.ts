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

let labelCounter = 0;

function nextLabel(pluginId: string, toolId: string): string {
  // ponytail: global counter — collisions only matter if counter wraps, which
  // at 1-per-open would require billions of opens. Upgrade to UUID if a real
  // user ever hits it.
  labelCounter += 1;
  return `plugin-tool-${pluginId}-${toolId}-${labelCounter}`;
}

export const useToolWindowStore = create<ToolWindowState>((set, get) => ({
  windows: [],

  open: async (pluginId, tool) => {
    if (!isTauri()) return;
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const label = nextLabel(pluginId, tool.id);
    const url = `quill-plugin://localhost/${pluginId}/${tool.entry}`;
    const title = tool.title ?? `${pluginId}/${tool.id}`;
    const win = new WebviewWindow(label, {
      url,
      title,
      width: 800,
      height: 600,
      // Pinned tool window: open centered, above normal windows, and take
      // focus immediately. The pet-panel search path opens the popup while
      // the app may not be frontmost (the panel just hid), so without these
      // the window can appear without key focus — the user reads that as
      // "弹窗失焦/被关闭". Fullscreen is entered manually via the Window menu
      // "插件弹窗全屏" item (⌘⇧F); the Rust handler drops alwaysOnTop during
      // fullscreen and restores it on exit (macOS blocks native fullscreen on
      // always-on-top windows).
      center: true,
      focus: true,
      alwaysOnTop: true,
      resizable: true,
      skipTaskbar: false,
    });
    win.once('tauri://created', async () => {
      try {
        await win.setFocus();
      } catch (err) {
        console.warn(`[plugin-host] tool window "${label}" focus failed:`, err);
      }
    });
    win.once('tauri://close-requested', () => {
      get().remove(label);
    });
    win.once('tauri://error', (e: unknown) => {
      console.error(`[plugin-host] tool window "${label}" error:`, e);
      get().remove(label);
    });
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
