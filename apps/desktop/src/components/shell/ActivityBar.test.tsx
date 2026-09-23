/**
 * ActivityBar PR2 tests — data-driven panel rendering.
 *
 * Verifies the post-PR2 contract: ActivityBar reads `useVisiblePanels()` from
 * featurePanelStore and renders one button per visible panel; clicking a button
 * calls `onPanelChange(id)`; a hidden panel (enable flag off) doesn't render.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ActivityBar } from './ActivityBar';
import { useFeaturePanelStore } from '@/store/featurePanelStore';
import { useVaultStore } from '@/store/vaultStore';
import { useExtensionPageStore } from '@/store/extensionPageStore';
import { useNavStore } from '@/store/navStore';
import type { PanelEntry } from '@/store/featurePanelStore';
import type { PageEntry } from '@/store/extensionPageStore';

function panel(id: string, overrides: Partial<PanelEntry> = {}): PanelEntry {
  return {
    id,
    // Use a unique title prefix to avoid colliding with the hardcoded
    // daily/settings page-nav button titles.
    title: `Panel-${id.toUpperCase()}`,
    icon: <svg />,
    component: () => null,
    order: 50,
    visible: true,
    ...overrides,
  };
}

beforeEach(() => {
  useFeaturePanelStore.setState({ panels: [], activePanelId: null });
  useExtensionPageStore.setState({ pages: [] });
  useNavStore.setState({ currentPage: 'editor' });
});

afterEach(() => {
  cleanup();
  useFeaturePanelStore.setState({ panels: [], activePanelId: null });
  useExtensionPageStore.setState({ pages: [] });
  useNavStore.setState({ currentPage: 'editor' });
  useVaultStore.setState({ currentVault: null });
});

describe('ActivityBar (data-driven)', () => {
  it('renders one button per visible panel, sorted by order', () => {
    useFeaturePanelStore.getState().register(panel('a', { order: 30 }));
    useFeaturePanelStore.getState().register(panel('b', { order: 10 }));
    useFeaturePanelStore.getState().register(panel('c', { order: 20 }));

    render(<ActivityBar activePanel="a" onPanelChange={() => {}} />);

    // Three panel buttons + 3 page-nav buttons (activity/translation/settings) = 6.
    // DOM order: first panel (files slot), activity, translation, restPanels, settings.
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(6);
    // First panel button (by DOM order) is the lowest-order panel: 'b'.
    expect(buttons[0].getAttribute('title')).toBe('Panel-B');
    expect(buttons[1].getAttribute('title')).toBe('活动');
    expect(buttons[2].getAttribute('title')).toBe('翻译');
    expect(buttons[3].getAttribute('title')).toBe('Panel-C');
    expect(buttons[4].getAttribute('title')).toBe('Panel-A');
  });

  it('does not render invisible panels', () => {
    useFeaturePanelStore.getState().register(panel('a', { visible: true }));
    useFeaturePanelStore.getState().register(panel('b', { visible: false }));
    useFeaturePanelStore.getState().register(panel('c', { visible: true }));

    render(<ActivityBar activePanel="a" onPanelChange={() => {}} />);

    expect(screen.getByTitle('Panel-A')).toBeTruthy();
    expect(screen.getByTitle('Panel-C')).toBeTruthy();
    expect(screen.queryByTitle('Panel-B')).toBeNull();
  });

  it('marks the active panel button active', () => {
    useFeaturePanelStore.getState().register(panel('a'));
    useFeaturePanelStore.getState().register(panel('b'));

    const { rerender } = render(
      <ActivityBar activePanel="a" onPanelChange={() => {}} />,
    );
    expect(screen.getByTitle('Panel-A').className).toContain('active');
    expect(screen.getByTitle('Panel-B').className).not.toContain('active');

    rerender(<ActivityBar activePanel="b" onPanelChange={() => {}} />);
    expect(screen.getByTitle('Panel-B').className).toContain('active');
    expect(screen.getByTitle('Panel-A').className).not.toContain('active');
  });

  it('clicking a panel button calls onPanelChange with the id', () => {
    useFeaturePanelStore.getState().register(panel('a'));
    useFeaturePanelStore.getState().register(panel('b'));

    const onPanelChange = vi.fn();
    render(<ActivityBar activePanel="a" onPanelChange={onPanelChange} />);

    fireEvent.click(screen.getByTitle('Panel-B'));
    expect(onPanelChange).toHaveBeenCalledWith('b');
  });

  it('renders the translation/settings page-nav buttons regardless of panels', () => {
    render(<ActivityBar activePanel="files" onPanelChange={() => {}} />);
    expect(screen.getByTitle('翻译')).toBeTruthy();
    expect(screen.getByTitle('设置')).toBeTruthy();
  });

  it('renders a badge when a panel entry has one', () => {
    useFeaturePanelStore.getState().register(panel('a', { badge: '3' }));
    render(<ActivityBar activePanel="a" onPanelChange={() => {}} />);
    // The badge text '3' lives inside the panel button (title Panel-A).
    const btn = screen.getByTitle('Panel-A');
    expect(btn.textContent).toContain('3');
  });
});

describe('ActivityBar (extension pages)', () => {
  function page(id: string, overrides: Partial<PageEntry> = {}): PageEntry {
    return {
      id,
      title: `ExtPage-${id}`,
      icon: <svg />,
      component: () => null,
      order: 60,
      ...overrides,
    };
  }

  it('renders one page-nav button per registered extension page', () => {
    useExtensionPageStore.getState().register(page('ext:x.p1'));
    useExtensionPageStore.getState().register(page('ext:x.p2'));

    render(<ActivityBar activePanel="files" onPanelChange={() => {}} />);

    expect(screen.getByTitle('ExtPage-ext:x.p1')).toBeTruthy();
    expect(screen.getByTitle('ExtPage-ext:x.p2')).toBeTruthy();
  });

  it('clicking a page-nav button sets navStore.currentPage to the ext: id', () => {
    useExtensionPageStore.getState().register(page('ext:x.p1'));

    render(<ActivityBar activePanel="files" onPanelChange={() => {}} />);

    fireEvent.click(screen.getByTitle('ExtPage-ext:x.p1'));
    expect(useNavStore.getState().currentPage).toBe('ext:x.p1');
  });

  it('marks the page-nav button active when currentPage is its ext: id', () => {
    useExtensionPageStore.getState().register(page('ext:x.p1'));
    useNavStore.setState({ currentPage: 'ext:x.p1' });

    render(<ActivityBar activePanel="files" onPanelChange={() => {}} />);

    expect(screen.getByTitle('ExtPage-ext:x.p1').className).toContain('active');
    expect(screen.getByTitle('设置').className).not.toContain('active');
  });

  it('de-highlights panel buttons when on an ext: page', () => {
    useFeaturePanelStore.getState().register(panel('a'));
    useNavStore.setState({ currentPage: 'ext:x.p1' });

    render(<ActivityBar activePanel="a" onPanelChange={() => {}} />);

    expect(screen.getByTitle('Panel-A').className).not.toContain('active');
  });
});

describe('ActivityBar git icon', () => {
  it('does not render the git icon when the active vault is not github', () => {
    useVaultStore.setState({
      currentVault: { id: 'v', name: 'local', providerType: 'tauri', basePath: '/x' },
    });
    render(<ActivityBar activePanel="a" onPanelChange={() => {}} />);
    expect(screen.queryByTitle('Git 操作')).toBeNull();
  });

  it('renders the git icon above settings when the active vault is github', () => {
    useVaultStore.setState({
      currentVault: { id: 'v', name: 'gh', providerType: 'github', basePath: '/x' },
    });
    render(<ActivityBar activePanel="a" onPanelChange={() => {}} />);
    expect(screen.getByTitle('Git 操作')).toBeTruthy();
    // Settings icon still present.
    expect(screen.getByTitle('设置')).toBeTruthy();
  });
});

