import type { SettingsTab } from '@/store/navStore';

/**
 * Shared presentational primitives used across the settings tabs
 * (`pages/SettingsPage.tsx` shell + every `components/settings/*Settings.tsx`).
 * Kept here so the shell and the per-tab files don't reach back into the
 * god-file for `Toggle` / nav layout — they import from this module instead.
 */

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={`sw2 w-9 h-5 rounded-[10px] cursor-pointer relative transition-[background] duration-200 shrink-0 ${value ? 'bg-acc' : 'bg-brd2'}`} onClick={() => onChange(!value)}>
      <div className={`absolute w-4 h-4 rounded-full bg-white top-0.5 left-0.5 transition-transform duration-200 ${value ? 'translate-x-4' : ''}`} />
    </div>
  );
}

export const NAV_GROUPS = [
  { label: '通用', items: [
    { id: 'appearance' as SettingsTab, icon: '🖥', name: '外观' },
    { id: 'editor' as SettingsTab, icon: '✏️', name: '编辑器' },
    { id: 'shortcuts' as SettingsTab, icon: '⌨️', name: '快捷键' },
    { id: 'templates' as SettingsTab, icon: '📄', name: '文件模板' },
    { id: 'pet' as SettingsTab, icon: '🐾', name: '桌宠' },
    { id: 'notifications' as SettingsTab, icon: '🔔', name: '通知' },
    { id: 'plugins' as SettingsTab, icon: '🧩', name: '插件' },
  ]},
  { label: 'AI', items: [
    { id: 'ai' as SettingsTab, icon: '✦', name: 'AI 工具' },
    { id: 'voice' as SettingsTab, icon: '🎤', name: '语音输入' },
    { id: 'skills' as SettingsTab, icon: '⚡', name: 'Skills' },
  ]},
  { label: '关于', items: [
    { id: 'about' as SettingsTab, icon: 'ℹ️', name: '关于 Quill' },
  ]},
];
