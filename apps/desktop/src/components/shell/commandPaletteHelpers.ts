/**
 * Pure helpers for the command palette UI (PR2).
 *
 * Extracted from {@link ./CommandPalette.tsx} so they can be unit-tested without
 * rendering React: highlight-segment building + Chinese group-label mapping.
 */

import type { PaletteGroup } from '@/store/commandPaletteStore';

export interface HighlightSegment {
  text: string;
  matched: boolean;
}

/**
 * Split `title` into contiguous segments, marking the chars whose indices appear
 * in `matches` as matched. `matches` may be unsorted / contain duplicates; out
 * of bounds indices are ignored. An empty `matches` yields a single unmatched
 * segment covering the whole title (empty-query default list).
 */
export function buildHighlightSegments(title: string, matches: number[]): HighlightSegment[] {
  if (title.length === 0) return [];
  if (matches.length === 0) return [{ text: title, matched: false }];

  const matchSet = new Set<number>();
  for (const idx of matches) {
    if (idx >= 0 && idx < title.length) matchSet.add(idx);
  }
  if (matchSet.size === 0) return [{ text: title, matched: false }];

  const segments: HighlightSegment[] = [];
  for (let i = 0; i < title.length; i++) {
    const isMatch = matchSet.has(i);
    const last = segments[segments.length - 1];
    if (last && last.matched === isMatch) {
      last.text += title[i];
    } else {
      segments.push({ text: title[i], matched: isMatch });
    }
  }
  return segments;
}

/**
 * Map a palette group's English store label to the Chinese label used in the UI,
 * matching the existing Chinese labels elsewhere in the app. Unknown labels fall
 * back to the original store label so future groups still render.
 */
const GROUP_LABEL_ZH: Record<string, string> = {
  Actions: '动作',
  'Panels / Modes': '面板与模式',
  'Recent Files': '最近文件',
  'All Files': '全部文件',
};

export function groupLabelZh(group: PaletteGroup): string {
  return GROUP_LABEL_ZH[group.label] ?? group.label;
}
