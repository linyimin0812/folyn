import { describe, it, expect, beforeEach } from 'vitest';
import { useFindUiStore } from './findUiStore';

describe('findUiStore (per-tab find bar visibility)', () => {
  beforeEach(() => {
    useFindUiStore.setState({ openByTab: {}, queryByTab: {} });
  });

  it('open / close flip one tab without touching others', () => {
    const s = useFindUiStore.getState();
    s.open('t1');
    s.open('t2');
    expect(useFindUiStore.getState().openByTab).toEqual({ t1: true, t2: true });
    s.close('t1');
    expect(useFindUiStore.getState().openByTab).toEqual({ t1: false, t2: true });
  });

  it('open on an already-open tab and close on a closed one are no-op state writes', () => {
    const s = useFindUiStore.getState();
    s.open('t1');
    const first = useFindUiStore.getState().openByTab;
    s.open('t1'); // same value → same object identity (no re-render)
    expect(useFindUiStore.getState().openByTab).toBe(first);
    s.close('t2'); // absent tab → no-op, no entry created
    expect(useFindUiStore.getState().openByTab).toBe(first);
  });

  it('close on an unknown tab creates no entry (no map growth on stray closes)', () => {
    const s = useFindUiStore.getState();
    s.open('t1');
    const first = useFindUiStore.getState().openByTab;
    s.close('nope');
    expect(useFindUiStore.getState().openByTab).toBe(first);
    s.close('t1');
    expect(useFindUiStore.getState().openByTab['t1']).toBe(false);
  });
});

describe('findUiStore queryByTab (spec 6.2 per-tab query)', () => {
  beforeEach(() => {
    useFindUiStore.setState({ openByTab: {}, queryByTab: {} });
  });

  it('setQuery stores the last query per tab', () => {
    const s = useFindUiStore.getState();
    s.setQuery('t1', 'install');
    s.setQuery('t2', '其他');
    expect(useFindUiStore.getState().queryByTab).toEqual({ t1: 'install', t2: '其他' });
    s.setQuery('t1', 'guide');
    expect(useFindUiStore.getState().queryByTab.t1).toBe('guide');
  });

  it('setQuery with the same value is a no-op write (identity preserved)', () => {
    const s = useFindUiStore.getState();
    s.setQuery('t1', 'a');
    const first = useFindUiStore.getState().queryByTab;
    s.setQuery('t1', 'a');
    expect(useFindUiStore.getState().queryByTab).toBe(first);
  });

  it('close prunes the tab query but close(false-tab) keeps it (query only dies with the open flag)', () => {
    const s = useFindUiStore.getState();
    s.setQuery('t1', 'x');
    const first = useFindUiStore.getState().queryByTab;
    s.close('t2');
    expect(useFindUiStore.getState().queryByTab).toBe(first);
    s.open('t1');
    s.close('t1');
    expect(useFindUiStore.getState().queryByTab).toEqual({});
  });

  it('empty-string queries are never stored (no empty entries)', () => {
    const s = useFindUiStore.getState();
    s.setQuery('t1', '');
    expect(useFindUiStore.getState().queryByTab).toEqual({});
  });
});
