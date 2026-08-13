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

// ponytail: math slash items don't run a chain command — they delete the
// "/<filter>" text then hand off to the LaTeX modal via onInsertMath. The
// mathKind marker drives that branch in RichTextSlashMenu.select; filtering
// still matches on the item id ("inlinemath" / "blockmath"), so typing
// "/math" or "/block" reaches them like any other item.
describe('math slash items', () => {
  const mathItems: SlashMenuItem[] = [
    { id: 'inlineMath', icon: {} as never, labelKey: 'a.inlineMath', category: 'blocks', mathKind: 'inline', run: () => {} },
    { id: 'blockMath', icon: {} as never, labelKey: 'a.blockMath', category: 'blocks', mathKind: 'block', run: () => {} },
  ];

  it('matches "math" against both inlineMath and blockMath', () => {
    expect(filterItems(mathItems, 'math')).toEqual(mathItems);
  });

  it('matches "inline"/"block" to the right item', () => {
    expect(filterItems(mathItems, 'inline')).toEqual([mathItems[0]]);
    expect(filterItems(mathItems, 'block')).toEqual([mathItems[1]]);
  });
});
