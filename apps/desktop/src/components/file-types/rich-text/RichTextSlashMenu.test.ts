import { describe, it, expect } from 'vitest';
import { filterItems, type SlashMenuItem } from './RichTextSlashMenu';

const items: SlashMenuItem[] = [
  { id: 'heading1', icon: {} as never, labelKey: 'a.heading1', category: 'blocks', run: () => {} },
  { id: 'heading2', icon: {} as never, labelKey: 'a.heading2', category: 'blocks', run: () => {} },
  { id: 'bulletList', icon: {} as never, labelKey: 'a.bulletList', category: 'lists', run: () => {} },
  { id: 'orderedList', icon: {} as never, labelKey: 'a.orderedList', category: 'lists', run: () => {} },
  { id: 'taskList', icon: {} as never, labelKey: 'a.taskList', category: 'lists', run: () => {} },
];

describe('filterItems', () => {
  it('returns all items when filter is empty', () => {
    expect(filterItems(items, '')).toHaveLength(items.length);
  });

  it('filters by case-insensitive id substring', () => {
    expect(filterItems(items, 'h')).toEqual([
      items[0],
      items[1],
    ]);
  });

  it('matches uppercase filter against lowercase id', () => {
    expect(filterItems(items, 'LIST')).toEqual([items[2], items[3], items[4]]);
  });

  it('matches "list" against bulletList/orderedList/taskList', () => {
    expect(filterItems(items, 'list')).toEqual([
      items[2],
      items[3],
      items[4],
    ]);
  });

  it('returns empty when no match', () => {
    expect(filterItems(items, 'zzz')).toEqual([]);
  });
});
