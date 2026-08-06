/**
 * Smoke test: ensures every registered namespace has zh + en JSON files
 * with identical key trees, and that i18n has all namespaces registered.
 *
 * Guards against drift when adding new namespaces.
 */
import { describe, it, expect } from 'vitest';
import i18n, { NAMESPACES } from './index';
import zhCommon from './locales/zh/common.json';
import enCommon from './locales/en/common.json';
import zhShell from './locales/zh/shell.json';
import enShell from './locales/en/shell.json';
import zhTopbar from './locales/zh/topbar.json';
import enTopbar from './locales/en/topbar.json';
import zhSidebar from './locales/zh/sidebar.json';
import enSidebar from './locales/en/sidebar.json';
import zhSettings from './locales/zh/settings.json';
import enSettings from './locales/en/settings.json';
import zhVault from './locales/zh/vault.json';
import enVault from './locales/en/vault.json';
import zhEditor from './locales/zh/editor.json';
import enEditor from './locales/en/editor.json';
import zhSearch from './locales/zh/search.json';
import enSearch from './locales/en/search.json';
import zhAi from './locales/zh/ai.json';
import enAi from './locales/en/ai.json';
import zhSchedule from './locales/zh/schedule.json';
import enSchedule from './locales/en/schedule.json';
import zhStudy from './locales/zh/study.json';
import enStudy from './locales/en/study.json';
import zhRustErrors from './locales/zh/rustErrors.json';
import enRustErrors from './locales/en/rustErrors.json';
import zhPet from './locales/zh/pet.json';
import enPet from './locales/en/pet.json';
import zhMmap from './locales/zh/mmap.json';
import enMmap from './locales/en/mmap.json';

const zhBundles = {
  common: zhCommon,
  shell: zhShell,
  topbar: zhTopbar,
  sidebar: zhSidebar,
  settings: zhSettings,
  vault: zhVault,
  editor: zhEditor,
  search: zhSearch,
  ai: zhAi,
  schedule: zhSchedule,
  study: zhStudy,
  rustErrors: zhRustErrors,
  pet: zhPet,
  mmap: zhMmap,
} as const;

const enBundles = {
  common: enCommon,
  shell: enShell,
  topbar: enTopbar,
  sidebar: enSidebar,
  settings: enSettings,
  vault: enVault,
  editor: enEditor,
  search: enSearch,
  ai: enAi,
  schedule: enSchedule,
  study: enStudy,
  rustErrors: enRustErrors,
  pet: enPet,
  mmap: enMmap,
} as const;

/** Recursively collect the tree of object keys (paths joined by '.'). */
function collectKeyTree(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') {
      out.push(...collectKeyTree(v, path));
    } else {
      out.push(path);
    }
  }
  return out.sort();
}

describe('i18n extracted namespaces', () => {
  it('every namespace declared in NAMESPACES is registered in i18next', () => {
    for (const ns of NAMESPACES) {
      expect(i18n.hasResourceBundle('zh', ns)).toBe(true);
      expect(i18n.hasResourceBundle('en', ns)).toBe(true);
    }
  });

  it.each(NAMESPACES)('%s: zh and en have identical key trees', (ns) => {
    const zhKeys = collectKeyTree(zhBundles[ns]);
    const enKeys = collectKeyTree(enBundles[ns]);
    expect(enKeys).toEqual(zhKeys);
  });
});
