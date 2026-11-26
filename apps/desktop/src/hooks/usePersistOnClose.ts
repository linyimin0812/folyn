// usePersistOnClose — flushes persisted settings (and open tabs) before the
// window closes. Extracted from App.tsx (split-oversized-p1-files).
//
// Spec: hook-guidelines.md (effect cleanup, teardown-races-await guard).
//
// spec 6.3 多窗口：研究窗口（label research-*）关闭时持久化自己的会话
// 记录（tabCount/最近文档/几何/closed 标记，最近窗口列表据此展示），
// 然后直接 destroy——pet/tray 的「关闭即隐藏」只属于主窗口（Rust 的
// on_window_event 也只对 label=="main" 做 prevent_close + hide，两边判定
// 必须一致）。主窗口的会话记录在真实退出（pet/tray 均关）时同样标记
// closed，让重启后的最近窗口列表准确。

import { useEffect } from 'react';
import * as editorIoService from '@/services/editorIoService';
import { persistNow } from '@/store/settingsPersistence';
import { usePetStore } from '@/store/petStore';
import { isTauri } from '@/utils/platform';
import { closeOwnSessionRecord, isResearchWindow } from '@/services/windowSessionService';

export function usePersistOnClose() {
  // ponytail: flush persisted settings before the window closes. The 300ms
  // debounce in storageClient would otherwise drop the last setter's write
  // if the user changes a setting and Cmd+Q / closes the window within
  // that window. pet menu "退出应用" goes through routePetMenuAction which
  // also awaits persistNow; this listener covers Cmd+Q and window-close.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        unlisten = await getCurrentWindow().onCloseRequested(async (e) => {
          e.preventDefault();
          try {
            // Flush open tabs first (sync, marks storage dirty), then
            // persistNow() flushes everything to disk. Without this, closing
            // a tab and quitting within the persist debounce window would
            // restore the closed tab on the next launch.
            editorIoService.saveOpenTabs();
            // 会话最终记录（含几何 + closed 标记）必须在 persistNow 之前
            // 落进 storageClient 的 dirty 队列。
            await closeOwnSessionRecord();
            await persistNow();
          } catch (err) {
            console.warn('[App] persistNow on close failed:', err);
          }
          if (isResearchWindow()) {
            // 研究窗口：无 pet 语义，持久化完成即销毁。
            await getCurrentWindow().destroy();
            return;
          }
          // ponytail: pet mode on → Rust's on_window_event owns the hide
          // (prevent_close + hide, and fullscreen-aware on macOS: hiding a
          // fullscreen window under macOSPrivateApi leaves a black fullscreen
          // Space behind, so Rust exits fullscreen + waits for the transition
          // before hiding). The webview stays alive after the window is
          // hidden, so the persistNow() flush above is not cut short. Pet off
          // → real close (app exits, pet window cleanup is automatic).
          const petOn = usePetStore.getState().petModeEnabled;
          if (!petOn) {
            await getCurrentWindow().destroy();
          }
        });
      } catch (err) {
        console.warn('[App] close-requested listener setup failed:', err);
      }
      if (cancelled) unlisten?.();
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
