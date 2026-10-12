/**
 * Focused interaction tests for the Sessions SIDEBAR panel (list-only): mount
 * refresh, the project-grouped session tree (group headers with source dots +
 * counts, collapse toggling, null-cwd 未知项目 group, group/session ordering),
 * source filters scoping the whole tree, search narrowing within groups and
 * hiding empty groups, opening a row (detail lands in sessionsUiStore →
 * WorkArea renders SessionDetailView), and manual refresh. The locator paste
 * entry, detail/selection/save/generation and navigation flows are covered in
 * SessionDetailView.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() { /* no-op */ };
}

const { summaries, detail, discoverMock, readMock } = vi.hoisted(() => {
  const summaries = [
    {
      source: 'codex' as const,
      sessionId: '11111111-2222-3333-4444-555555555555',
      filePath: '/home/u/.codex/sessions/2026/10/10/rollout-a.jsonl',
      title: 'Fix login',
      cwd: '/work/alpha',
      startedAt: Date.parse('2026-10-10T09:00:00Z'),
      updatedAt: Date.parse('2026-10-10T23:00:00Z'),
      parentSessionId: null,
    },
    {
      source: 'codex' as const,
      sessionId: 'aaaaaaa0-0000-0000-0000-000000000001',
      filePath: '/home/u/.codex/sessions/2026/10/09/rollout-b.jsonl',
      title: 'Beta work',
      cwd: '/work/beta',
      startedAt: Date.parse('2026-10-09T08:00:00Z'),
      updatedAt: null,
      parentSessionId: null,
    },
    {
      // Same project as the first fixture, different source — the per-project
      // source-dot cluster fixture (alpha = codex + claude, beta = codex only).
      source: 'claude' as const,
      sessionId: 'ccccccc0-0000-0000-0000-000000000002',
      filePath: '/home/u/.claude/projects/-work-alpha/ccccccc0.jsonl',
      title: 'Gamma chat',
      cwd: '/work/alpha',
      startedAt: Date.parse('2026-10-10T07:00:00Z'),
      updatedAt: null,
      parentSessionId: null,
    },
  ];

  const detail = {
    summary: summaries[0]!,
    messages: [
      {
        id: 'msg-1',
        role: 'user' as const,
        content: 'how to fix the login bug?',
        timestamp: Date.parse('2026-10-10T10:00:01Z'),
        images: [],
        missing: [],
        toolCalls: [],
        rawRecord: '{"type":"response_item"}',
        rawToolRecords: [],
      },
      {
        id: 'msg-2',
        role: 'assistant' as const,
        content: 'reset the token cache',
        timestamp: Date.parse('2026-10-10T10:00:02Z'),
        images: [],
        missing: [],
        toolCalls: [{ callId: 'c1', name: 'exec', input: '{"cmd":"ls"}', output: 'a b' }],
        rawRecord: '{"type":"response_item"}',
        rawToolRecords: [],
      },
    ],
    warnings: [],
    branch: { currentId: 'main', all: [{ id: 'main', label: '' }] },
  };

  const discoverMock = vi.fn(async () => ({ sessions: summaries, errors: [] }));
  const readMock = vi.fn(async () => detail);

  return { summaries, detail, discoverMock, readMock };
});

vi.mock('@/services/externalSessions', () => ({
  discoverExternalSessions: discoverMock,
  readExternalSession: readMock,
  saveExternalSessionCapture: vi.fn(async () => ({ notePath: 'notes/capture.md', evidencePath: 'notes/capture.evidence', missing: [], complete: true })),
  sanitizeFilename: (s: string) => s,
  CaptureConflictError: class CaptureConflictError extends Error {},
}));

// Sessions panel only runs discovery in Tauri contexts — force it on.
vi.mock('@/utils/platform', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, isTauri: () => true };
});

import { SessionsPanel } from './SessionsPanel';
import { useSessionsUiStore, INITIAL_SESSIONS_UI } from '@/store/sessionsUiStore';
import { useToastStore } from '@/store/toastStore';

/** A group header is the only row with the cwd title AND aria-expanded (the
 *  session rows under it carry the same cwd title). */
function groupHeader(cwd: string): HTMLElement {
  const header = screen.getAllByTitle(cwd).find((el) => el.hasAttribute('aria-expanded'));
  expect(header).toBeTruthy();
  return header as HTMLElement;
}

beforeEach(() => {
  cleanup();
  // reset calls AND implementation — the real-path regression describe swaps
  // the implementation, and the leak would otherwise flow into any describe
  // that runs after it (including the call-count assertions)
  discoverMock.mockReset();
  discoverMock.mockImplementation(async () => ({ sessions: summaries, errors: [] }));
  readMock.mockClear();
  useSessionsUiStore.setState(INITIAL_SESSIONS_UI);
  useToastStore.setState({ queue: [] });
});
afterEach(() => cleanup());

describe('SessionsPanel (project-grouped tree)', () => {
  it('mounting the panel refreshes discovery and renders sessions grouped by project', async () => {
    render(<SessionsPanel />);
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    expect(discoverMock).toHaveBeenCalledTimes(1);

    // group headers carry the project basename; the full cwd is the row title
    const alphaHeader = groupHeader('/work/alpha');
    const betaHeader = groupHeader('/work/beta');
    expect(alphaHeader.textContent).toContain('alpha');
    expect(betaHeader.textContent).toContain('beta');
    // counts: alpha 2 (Fix login + Gamma chat), beta 1
    expect(alphaHeader.textContent).toContain('2');
    expect(betaHeader.textContent).toContain('1');
    // group order: alpha (latest 10-10 23:00) before beta (10-09 08:00)
    expect(alphaHeader.compareDocumentPosition(betaHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // session rows: newest first within the group (Fix login before Gamma chat)
    const fixRow = screen.getByText('Fix login').closest('button')!;
    const gammaRow = screen.getByText('Gamma chat').closest('button')!;
    expect(fixRow.compareDocumentPosition(gammaRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the secondary line carries only the time — the project is the group header
    expect(fixRow.textContent).not.toContain('alpha');
    expect(fixRow.title).toBe('/work/alpha'); // full cwd still on the row
  });

  it('group headers show one source dot per source with sessions under them, scoped to the source filter', async () => {
    render(<SessionsPanel />);
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    // mixed-source group: codex + claude dots, tooltip names both sources
    const alphaCluster = groupHeader('/work/alpha').querySelector('span[title="Codex · Claude Code"]');
    expect(alphaCluster).not.toBeNull();
    expect((alphaCluster!.children[0] as HTMLElement).className).toContain('bg-acc');
    expect((alphaCluster!.children[1] as HTMLElement).className).toContain('bg-purple');
    // single-source group: exactly one dot
    const betaCluster = groupHeader('/work/beta').querySelector('span[title="Codex"]');
    expect(betaCluster).not.toBeNull();
    expect(betaCluster!.children).toHaveLength(1);

    // the source segment re-scopes the whole tree: Claude keeps only the
    // alpha group, single claude dot, count 1 — Gamma chat only
    fireEvent.click(screen.getByRole('button', { name: 'Claude' }));
    expect(screen.getByText('Gamma chat')).toBeTruthy();
    expect(screen.queryByText('Fix login')).toBeNull();
    expect(screen.queryByText('Beta work')).toBeNull();
    const claudeAlpha = groupHeader('/work/alpha');
    expect(claudeAlpha.textContent).toContain('1'); // claude-only count
    const cluster = claudeAlpha.querySelector('span[title="Claude Code"]');
    expect(cluster).not.toBeNull();
    expect(cluster!.children).toHaveLength(1); // codex dot gone
    expect(screen.queryByTitle('/work/beta')).toBeNull(); // whole group gone
  });

  it('the source filter with no matches shows the empty state, no error bar', async () => {
    render(<SessionsPanel />);
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'pi' }));
    expect(screen.queryByText('Fix login')).toBeNull();
    expect(screen.getByText('未发现可读取的外部会话')).toBeTruthy();
    expect(screen.queryByText(/部分来源读取失败/)).toBeNull();
  });

  it('clicking a group header collapses and re-expands only that group', async () => {
    render(<SessionsPanel />);
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    const alphaHeader = groupHeader('/work/alpha');
    expect(alphaHeader.getAttribute('aria-expanded')).toBe('true');
    // collapse alpha — its rows go, beta's stay
    fireEvent.click(alphaHeader);
    expect(screen.queryByText('Fix login')).toBeNull();
    expect(screen.queryByText('Gamma chat')).toBeNull();
    expect(screen.getByText('Beta work')).toBeTruthy();
    const collapsed = groupHeader('/work/alpha');
    expect(collapsed.getAttribute('aria-expanded')).toBe('false');
    expect(collapsed.textContent).toContain('2'); // count still describes the scope
    // collapse state survives a refresh (keyed by cwd)
    discoverMock.mockResolvedValueOnce({ sessions: [...summaries], errors: [] });
    fireEvent.click(screen.getByLabelText('刷新'));
    await waitFor(() => expect(discoverMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Beta work')).toBeTruthy();
    expect(screen.queryByText('Fix login')).toBeNull(); // still collapsed
    // re-expand — rows return
    fireEvent.click(groupHeader('/work/alpha'));
    expect(screen.getByText('Fix login')).toBeTruthy();
    expect(screen.getByText('Gamma chat')).toBeTruthy();
  });

  it('clicking a session row re-reads the conversation and puts the detail into the shared UI store', async () => {
    render(<SessionsPanel />);
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    fireEvent.click(screen.getByText('Fix login'));
    await waitFor(() => expect(readMock).toHaveBeenCalledWith(summaries[0]));
    await waitFor(() => expect(useSessionsUiStore.getState().detail).toBe(detail));
    // the open row gets the active accent (FileTreeItem convention)
    expect(screen.getByText('Fix login').closest('button')!.className).toContain('bg-accdim');
    expect(screen.getByText('Beta work').closest('button')!.className).not.toContain('bg-accdim');
  });

  it('the manual refresh button re-runs discovery and lists sessions the source tool added meanwhile', async () => {
    render(<SessionsPanel />);
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    expect(discoverMock).toHaveBeenCalledTimes(1); // mount-time discovery only

    // the source tool gained a conversation since the last discovery
    discoverMock.mockResolvedValueOnce({
      sessions: [
        ...summaries,
        { ...summaries[1]!, sessionId: 'bbbbbbb0-0000-0000-0000-000000000003', title: 'Fresh work' },
      ],
      errors: [],
    });
    fireEvent.click(screen.getByLabelText('刷新'));
    await waitFor(() => expect(screen.getByText('Fresh work')).toBeTruthy());
    expect(discoverMock).toHaveBeenCalledTimes(2);
  });

  // ── Regression: real-path filter wiring (user report「切换后，项目内容没有变化」) ──
  // Real-machine data shape: full cwd paths, several sessions per project,
  // a no-cwd session, and a same-basename sibling project. Clicks go through
  // the ACTUAL rendered controls (segment chip by accessible name, group
  // header by its full-path title) and assert the SESSION ROWS change on
  // every switch.
  describe('filter wiring (real-path regression)', () => {
    const FOLYN = '/Users/yiminlin/project/folyn';
    const OTHER = '/Users/yiminlin/project/other';
    const SIBLING = '/Users/yiminlin/code/folyn'; // same basename, different path

    const realSummaries = [
      { source: 'codex' as const, sessionId: 's-codex-1', title: 'Codex one', cwd: FOLYN, startedAt: 5, updatedAt: 50, parentSessionId: null },
      { source: 'codex' as const, sessionId: 's-codex-2', title: 'Codex two', cwd: OTHER, startedAt: 4, updatedAt: 40, parentSessionId: null },
      { source: 'claude' as const, sessionId: 's-claude-1', title: 'Claude one', cwd: FOLYN, startedAt: 3, updatedAt: 30, parentSessionId: null },
      { source: 'pi' as const, sessionId: 's-pi-1', title: 'Pi one', cwd: SIBLING, startedAt: 2, updatedAt: 20, parentSessionId: null },
      { source: 'codex' as const, sessionId: 's-codex-3', title: 'No cwd', cwd: null, startedAt: 1, updatedAt: 10, parentSessionId: null },
    ];

    beforeEach(() => {
      discoverMock.mockImplementation(async () => ({ sessions: realSummaries, errors: [] }));
    });

    it('clicking a source segment chip changes the session rows', async () => {
      render(<SessionsPanel />);
      await waitFor(() => expect(screen.getByText('Codex one')).toBeTruthy());
      expect(screen.getByText('Claude one')).toBeTruthy();
      expect(screen.getByText('Pi one')).toBeTruthy();

      // segment chip by accessible name (the control the user clicks)
      fireEvent.click(screen.getByRole('button', { name: 'Claude' }));
      expect(screen.getByText('Claude one')).toBeTruthy();
      expect(screen.queryByText('Codex one')).toBeNull();
      expect(screen.queryByText('Pi one')).toBeNull();

      // switch to another segment — rows change AGAIN
      fireEvent.click(screen.getByRole('button', { name: 'pi' }));
      expect(screen.getByText('Pi one')).toBeTruthy();
      expect(screen.queryByText('Claude one')).toBeNull();

      // back to all
      fireEvent.click(screen.getByRole('button', { name: '全部' }));
      expect(screen.getByText('Codex one')).toBeTruthy();
      expect(screen.getByText('Claude one')).toBeTruthy();
    });

    it('switching the source segment chip also changes the group headers, dots and counts', async () => {
      render(<SessionsPanel />);
      await waitFor(() => expect(screen.getByText('Codex one')).toBeTruthy());
      // all: every group present, including the no-cwd 未知项目 group
      expect(groupHeader(FOLYN)).toBeTruthy();
      expect(groupHeader(OTHER)).toBeTruthy();
      expect(groupHeader(SIBLING)).toBeTruthy();
      expect(screen.getByText('未知项目')).toBeTruthy();

      // REPRODUCTION (user report「切换后，项目内容没有变化」): after switching
      // to Claude, the tree must reflect it — only the folyn group remains
      // (claude's project), single claude dot, count 1.
      fireEvent.click(screen.getByRole('button', { name: 'Claude' }));
      const folynHeader = groupHeader(FOLYN);
      expect(folynHeader.textContent).toContain('1'); // claude-only count
      const cluster = folynHeader.querySelector('span[title="Claude Code"]');
      expect(cluster).not.toBeNull();
      expect(cluster!.children).toHaveLength(1); // codex dot gone
      expect(screen.queryByTitle(OTHER)).toBeNull();
      expect(screen.queryByTitle(SIBLING)).toBeNull();
      expect(screen.queryByText('未知项目')).toBeNull(); // its only session was codex
      expect(screen.getByText('Claude one')).toBeTruthy();
      expect(screen.queryByText('Codex one')).toBeNull();

      // back to all — full tree restored
      fireEvent.click(screen.getByRole('button', { name: '全部' }));
      expect(screen.getByText('Codex one')).toBeTruthy();
      expect(screen.getByText('Pi one')).toBeTruthy();
      expect(screen.getByText('未知项目')).toBeTruthy();
    });

    it('same-basename projects are distinct groups; groups sort by latest session; no-cwd sessions group under 未知项目', async () => {
      render(<SessionsPanel />);
      await waitFor(() => expect(screen.getByText('Codex one')).toBeTruthy());
      // two distinct folyn groups (different full cwds, same basename)
      const folynHeader = groupHeader(FOLYN);
      const siblingHeader = groupHeader(SIBLING);
      expect(folynHeader).not.toBe(siblingHeader);
      // group order by latest session desc: folyn(50) → other(40) → sibling(20) → 未知项目(10)
      const otherHeader = groupHeader(OTHER);
      const unknownHeader = screen.getByText('未知项目').closest('button')!;
      const order = [folynHeader, otherHeader, siblingHeader, unknownHeader];
      for (let i = 1; i < order.length; i++) {
        expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
      // the no-cwd session lives under 未知项目, not under any project group
      const noCwdRow = screen.getByText('No cwd').closest('button')!;
      expect(noCwdRow.title).toBe('');
      expect(unknownHeader.compareDocumentPosition(noCwdRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('collapsing one same-basename group leaves the other expanded', async () => {
      render(<SessionsPanel />);
      await waitFor(() => expect(screen.getByText('Codex one')).toBeTruthy());
      fireEvent.click(groupHeader(FOLYN));
      expect(screen.queryByText('Codex one')).toBeNull();
      expect(screen.queryByText('Claude one')).toBeNull();
      // the same-basename sibling group is untouched
      expect(screen.getByText('Pi one')).toBeTruthy();
    });
  });

  // ── Search row: input + ✕ clear + 刷新. Typing applies the text as a
  // case-insensitive title/cwd substring filter over the already-discovered
  // tree LIVE (no 查询 button, no re-discovery); empty text clears it;
  // refresh stays the only re-discovery action.
  describe('search (live filter)', () => {
    it('typing applies a case-insensitive title filter live; groups emptied by the search are hidden; backspacing restores; no re-discovery', async () => {
      render(<SessionsPanel />);
      await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
      const input = screen.getByPlaceholderText('搜索会话或项目…');

      // title match, case-insensitive — filters on the keystroke, no button;
      // the beta group has no match, so it disappears entirely (header included)
      fireEvent.change(input, { target: { value: 'GAMMA' } });
      expect(screen.getByText('Gamma chat')).toBeTruthy();
      expect(screen.queryByText('Fix login')).toBeNull();
      expect(screen.queryByText('Beta work')).toBeNull();
      expect(screen.queryByText('beta')).toBeNull();

      // no match → the existing empty state
      fireEvent.change(input, { target: { value: 'zzz' } });
      expect(screen.getByText('未发现可读取的外部会话')).toBeTruthy();

      // backspacing the text away = clearing the filter (live too)
      fireEvent.change(input, { target: { value: '' } });
      expect(screen.getByText('Fix login')).toBeTruthy();
      expect(screen.getByText('Beta work')).toBeTruthy();

      // searching never re-runs discovery
      expect(discoverMock).toHaveBeenCalledTimes(1);
    });

    it('a cwd match keeps the group with its matching sessions', async () => {
      render(<SessionsPanel />);
      await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
      // a cwd fragment narrows to that project's sessions ('beta' is also a
      // title prefix of 'Beta work' — 'alpha' disambiguates the cwd path)
      fireEvent.change(screen.getByPlaceholderText('搜索会话或项目…'), { target: { value: 'alpha' } });
      expect(screen.getByText('Fix login')).toBeTruthy(); // cwd /work/alpha
      expect(screen.getByText('Gamma chat')).toBeTruthy(); // cwd /work/alpha
      expect(screen.queryByText('Beta work')).toBeNull(); // cwd /work/beta
      expect(screen.queryByText('beta')).toBeNull(); // its group header too
    });

    it('allowClear ✕: hidden while empty; clicking clears the input AND the applied filter (rows restored)', async () => {
      render(<SessionsPanel />);
      await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
      // antd allowClear — the ✕ only exists while the input has text
      expect(screen.queryByLabelText('清空搜索')).toBeNull();

      const input = screen.getByPlaceholderText('搜索会话或项目…');
      fireEvent.change(input, { target: { value: 'GAMMA' } });
      expect(screen.getByText('Gamma chat')).toBeTruthy();
      expect(screen.queryByText('Fix login')).toBeNull();

      // ✕ clears text + filter in one click — rows restored
      fireEvent.click(screen.getByLabelText('清空搜索'));
      expect((input as HTMLInputElement).value).toBe(''); // placeholder returns
      expect(screen.getByText('Fix login')).toBeTruthy();
      expect(screen.getByText('Beta work')).toBeTruthy();
      expect(screen.queryByLabelText('清空搜索')).toBeNull(); // gone once empty
    });

    it('the source filter composes with search', async () => {
      render(<SessionsPanel />);
      await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
      // search 'alpha' matches both sessions under /work/alpha...
      fireEvent.change(screen.getByPlaceholderText('搜索会话或项目…'), { target: { value: 'alpha' } });
      expect(screen.getByText('Fix login')).toBeTruthy();
      expect(screen.getByText('Gamma chat')).toBeTruthy();
      // ...and the source segment further narrows to claude only
      fireEvent.click(screen.getByRole('button', { name: 'Claude' }));
      expect(screen.getByText('Gamma chat')).toBeTruthy();
      expect(screen.queryByText('Fix login')).toBeNull();
    });
  });
});
