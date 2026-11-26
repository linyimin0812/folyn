// MainWindowChrome — 主窗口专属的宿主副作用集合（spec 6.3 多窗口）。
//
// 研究窗口（路由 `#/research/<id>`）运行同一个 App 壳，但不应承担这些
// 全局宿主职责——否则 tray 重复同步、voice 全局热键重复注册、deep-link
// 打开文件落到两个窗口、扩展宿主 hydration 双份安装、fileTree 广播双份
// 发送。集中在一个条件挂载的子组件里，hooks 规则也成立（不能在 App
// 体内条件调用 hook）。
//
// 本窗口身份判定用 windowSessionService.isMainWindow()（同步，读 hash），
// 不依赖 Tauri API —— jsdom/测试环境下默认主窗口路径。

import { useEffect } from 'react';
import { usePetHostBridge } from '@/hooks/usePetHostBridge';
import { useVoiceGlobalHotkey } from '@/hooks/useVoiceGlobalHotkey';
import { useTrayIconSync } from '@/hooks/useTrayIconSync';
import { useOpenExternalFiles } from '@/hooks/useOpenExternalFiles';
import { useExtensionHostSync } from '@/hooks/useExtensionHostSync';
import { startFileTreeBroadcast } from '@/store/vaultStore';
import { startProvidersBroadcast } from '@/store/aiConfigStore';
import { startPetChatSessionsHost } from '@/store/petChatSessions';
import { settingsLoadDone } from '@/store/settingsPersistence';
import { isMainWindow } from '@/services/windowSessionService';

export function MainWindowChrome() {
  usePetHostBridge();
  useVoiceGlobalHotkey();
  useTrayIconSync();
  useOpenExternalFiles();
  useExtensionHostSync();

  // ponytail: push fileTree + currentVault to secondary Tauri windows
  // (pet-panel) that mount AiPanel in `embedded` mode. Secondary windows
  // lack vault-path fs ACL, so they can't refreshFileTree themselves — the
  // main window owns the authoritative tree and broadcasts it on change.
  // Mirrors the pet://settings-updated broadcast pattern. (Moved here from
  // App.tsx — research windows are secondary windows too and must not
  // broadcast.)
  useEffect(() => {
    let stop: (() => void) | undefined;
    let stopProviders: (() => void) | undefined;
    let stopPetChat: (() => void) | undefined;
    settingsLoadDone.then(() => {
      stop = startFileTreeBroadcast();
      stopProviders = startProvidersBroadcast();
      stopPetChat = startPetChatSessionsHost();
    });
    return () => { stop?.(); stopProviders?.(); stopPetChat?.(); };
  }, []);

  return null;
}

/** App 壳里挂载的主窗口宿主层：研究窗口渲染 null 占位。 */
export function WindowHostChrome() {
  if (!isMainWindow()) return null;
  return <MainWindowChrome />;
}
