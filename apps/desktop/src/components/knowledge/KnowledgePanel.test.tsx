// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const fixture = vi.hoisted(() => ({ selectTheme: vi.fn(), setCreateOpen: vi.fn() }));
vi.mock('@/store/vaultStore', () => ({ useVaultStore: (selector: (state: unknown) => unknown) => selector({ currentVault: null }) }));
vi.mock('@/store/knowledgeStore', () => ({ useKnowledgeStore: (selector: (state: unknown) => unknown) => selector({
  loaded: true, themes: [{id: 'a', name: '主题 A'}, {id: 'b', name: '主题 B'}], activeThemeId: 'a',
  selectTheme: fixture.selectTheme, topics: [], reviews: [], buildItems: [], page: 'knowledge',
  setActiveTopic: vi.fn(), setPage: vi.fn(), openSourceSettings: vi.fn(),
}) }));
vi.mock('@/services/knowledge/kbAutoBuild', () => ({startKbAutoBuild: vi.fn(), stopKbAutoBuild: vi.fn()}));
vi.mock('@/services/knowledge/kbIntentWatch', () => ({startKbIntentWatch: vi.fn(), stopKbIntentWatch: vi.fn()}));
vi.mock('./themeUiStore', () => ({ useThemeUiStore: (selector: (state: unknown) => unknown) => selector({ setCreateOpen: fixture.setCreateOpen }) }));
import { KnowledgePanel } from './KnowledgePanel';
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('knowledge theme menu', () => {
  it('opens a custom menu and switches themes with the keyboard', () => {
    render(<KnowledgePanel />);
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    expect(screen.getByRole('option', {name: '主题 A'}).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(trigger, {key: 'ArrowDown'});
    fireEvent.keyDown(trigger, {key: 'Enter'});
    expect(fixture.selectTheme).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
  it('closes on Escape or outside click without switching', () => {
    render(<KnowledgePanel />);
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger); fireEvent.keyDown(trigger, {key: 'Escape'});
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(trigger); fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(fixture.selectTheme).not.toHaveBeenCalled();
  });
});
