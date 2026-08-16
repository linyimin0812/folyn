import type { ReactNode } from 'react';
import type { SettingsTab } from '@/store/navStore';
import { Monitor, SquarePen, Keyboard, FileText, PawPrint, Bell, Puzzle, ShieldCheck, Sparkles, Mic, Info, Terminal, Cloud } from 'lucide-react';

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

export const NAV_GROUPS: { labelKey: string; items: { id: SettingsTab; icon: ReactNode; nameKey: string }[] }[] = [
  { labelKey: 'settings:groups.general', items: [
    { id: 'appearance', icon: <Monitor size={14} />, nameKey: 'settings:tabs.appearance' },
    { id: 'editor', icon: <SquarePen size={14} />, nameKey: 'settings:tabs.editor' },
    { id: 'shortcuts', icon: <Keyboard size={14} />, nameKey: 'settings:tabs.shortcuts' },
    { id: 'templates', icon: <FileText size={14} />, nameKey: 'settings:tabs.templates' },
    { id: 'pet', icon: <PawPrint size={14} />, nameKey: 'settings:tabs.pet' },
    { id: 'notifications', icon: <Bell size={14} />, nameKey: 'settings:tabs.notifications' },
    { id: 'plugins', icon: <Puzzle size={14} />, nameKey: 'settings:tabs.plugins' },
    { id: 'csp', icon: <ShieldCheck size={14} />, nameKey: 'settings:tabs.csp' },
    { id: 'storage', icon: <Cloud size={14} />, nameKey: 'settings:tabs.storage' },
  ]},
  { labelKey: 'settings:groups.ai', items: [
    { id: 'cli', icon: <Terminal size={14} />, nameKey: 'settings:tabs.cli' },
    { id: 'models', icon: <Sparkles size={14} />, nameKey: 'settings:tabs.models' },
    { id: 'voice', icon: <Mic size={14} />, nameKey: 'settings:tabs.voice' },
  ]},
  { labelKey: 'settings:groups.about', items: [
    { id: 'about', icon: <Info size={14} />, nameKey: 'settings:tabs.about' },
  ]},
];
