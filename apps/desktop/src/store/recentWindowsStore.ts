// recentWindowsStore — 最近研究窗口面板的开关状态（spec 6.4）。
// 面板本体是 RecentWindowsPanel；打开入口在 commandRegistry（命令面板）
// 与 useGlobalShortcuts。极简 store（对齐 searchStore 的 open/close 形状），
// 查询词留在组件本地——面板每次打开都重新拉列表，不常驻。

import { create } from 'zustand';

interface RecentWindowsState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const useRecentWindowsStore = create<RecentWindowsState>((set, get) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set({ isOpen: !get().isOpen }),
}));

/** 测试缝：重置面板开关状态（模块级 zustand 单例跨用例持久）。 */
export function __resetRecentWindowsStore(): void {
  useRecentWindowsStore.setState({ isOpen: false });
}
