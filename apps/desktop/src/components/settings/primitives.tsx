import type { ReactNode } from 'react';
import type { SettingsTab } from '@/store/navStore';
import { Monitor, SquarePen, Keyboard, FileText, PawPrint, Bell, Puzzle, Sparkles, Mic, Zap, Info } from 'lucide-react';

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

export const NAV_GROUPS: { label: string; items: { id: SettingsTab; icon: ReactNode; name: string }[] }[] = [
  { label: '通用', items: [
    { id: 'appearance', icon: <Monitor size={14} />, name: '外观' },
    { id: 'editor', icon: <SquarePen size={14} />, name: '编辑器' },
    { id: 'shortcuts', icon: <Keyboard size={14} />, name: '快捷键' },
    { id: 'templates', icon: <FileText size={14} />, name: '文件模板' },
    { id: 'pet', icon: <PawPrint size={14} />, name: '桌宠' },
    { id: 'notifications', icon: <Bell size={14} />, name: '通知' },
    { id: 'plugins', icon: <Puzzle size={14} />, name: '插件' },
  ]},
  { label: 'AI', items: [
    { id: 'ai', icon: <Sparkles size={14} />, name: 'AI 工具' },
    { id: 'voice', icon: <Mic size={14} />, name: '语音输入' },
    { id: 'skills', icon: <Zap size={14} />, name: 'Skills' },
  ]},
  { label: '关于', items: [
    { id: 'about', icon: <Info size={14} />, name: '关于 Quill' },
  ]},
];
