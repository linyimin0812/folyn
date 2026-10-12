/**
 * Focused interaction tests for the MAIN WORK-AREA session detail view
 * (`SessionDetailView`, rendered by WorkArea when a session is open in
 * sessionsUiStore): fresh open reads, message/branch/text-range selection,
 * verbatim capture + AI-organized note flows, and slice-6 locator
 * navigation (including the saved-evidence fallback). The list behaviors
 * are covered in SessionsPanel.test.tsx.
 *
 * `renderSessions` mounts the sidebar list AND a host component that
 * replicates WorkArea's sessions branch (evidence viewer → detail view),
 * so the tests exercise the same store-driven split the app renders.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() { /* no-op */ };
}

const { summaries, detail, branchedDetail, altDetail, detailWithTools, discoverMock, readMock, saveMock, refreshFileTreeMock, useVaultStoreMock, vaultState, vaultReadFileMock } = vi.hoisted(() => {
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
        missing: [{ kind: 'image' as const, reason: 'image stored by file reference in the source (not inline) — bytes not obtainable' }],
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

  // Tool-carrying detail for the text-only display filter: msg-2 keeps its
  // text + a correlated exec call; msg-3 is a tool-only carrier record (no
  // text, no images) that only exists to hold a tool call.
  const detailWithTools = {
    ...detail,
    messages: [
      detail.messages[0]!,
      {
        ...detail.messages[1]!,
        rawToolRecords: ['{"type":"function_call","id":"c1"}', '{"type":"function_call_output"}'],
      },
      {
        id: 'msg-3',
        role: 'assistant' as const,
        content: '',
        timestamp: Date.parse('2026-10-10T10:00:03Z'),
        images: [],
        missing: [],
        toolCalls: [{ callId: 'c2', name: 'read_file', input: '{"path":"a.ts"}', output: 'x' }],
        rawRecord: '{"type":"response_item","tool_only":true}',
        rawToolRecords: ['{"type":"function_call","id":"c2"}'],
      },
    ],
  };

  // Branched (pi-style) detail: mainline c1 + alt branch b1.
  const msg = (id: string, role: 'user' | 'assistant', content: string) => ({
    id,
    role,
    content,
    timestamp: Date.parse('2026-10-10T10:00:01Z'),
    images: [],
    missing: [],
    toolCalls: [],
    rawRecord: '{"type":"message"}',
    rawToolRecords: [],
  });
  const branchList = [
    { id: 'c1', label: 'mainline direction' },
    { id: 'b1', label: 'alt direction' },
  ];
  const branchedDetail = {
    ...detail,
    messages: [msg('msg-1', 'user', 'how to fix the login bug?'), msg('msg-9', 'assistant', 'mainline answer')],
    branch: { currentId: 'c1', all: branchList },
  };
  const altDetail = {
    ...detail,
    messages: [msg('msg-1', 'user', 'how to fix the login bug?'), msg('msg-5', 'user', 'alt answer')],
    branch: { currentId: 'b1', all: branchList },
  };

  const discoverMock = vi.fn(async () => ({ sessions: summaries, errors: [] }));
  const readMock = vi.fn(async () => detail);
  const saveMock = vi.fn(async () => ({ notePath: 'notes/capture.md', evidencePath: 'notes/capture.evidence', missing: [], complete: true }));
  const refreshFileTreeMock = vi.fn(async () => {});
  const vaultReadFileMock = vi.fn(async () => '');

  const vaultState = {
    fileTree: [
      { path: 'notes', name: 'notes', type: 'dir' as const, children: [] },
    ],
    currentVault: { id: 'v1', name: 'Test Vault' } as { id: string; name: string } | null,
    refreshFileTree: refreshFileTreeMock,
    // Slice 6: the evidence fallback reads records.json through the vault manager.
    manager: { readFile: vaultReadFileMock } as unknown as { readFile: (p: string) => Promise<string> },
  };
  const useVaultStoreMock = ((selector: (s: typeof vaultState) => unknown) => selector(vaultState)) as unknown as {
    (selector: (s: typeof vaultState) => unknown): unknown;
    getState: () => typeof vaultState;
  };
  useVaultStoreMock.getState = () => vaultState;

  return { summaries, detail, branchedDetail, altDetail, detailWithTools, discoverMock, readMock, saveMock, refreshFileTreeMock, useVaultStoreMock, vaultState, vaultReadFileMock };
});

vi.mock('@/services/externalSessions', () => ({
  discoverExternalSessions: discoverMock,
  readExternalSession: readMock,
  saveExternalSessionCapture: saveMock,
  sanitizeFilename: (s: string) => s,
  CaptureConflictError: class CaptureConflictError extends Error {},
}));

// Session views only run reads in Tauri contexts — force it on.
vi.mock('@/utils/platform', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, isTauri: () => true };
});

vi.mock('@/store/vaultStore', () => ({ useVaultStore: useVaultStoreMock }));

// The pair selector reads enabled providers × selectedModelIds from
// aiConfigStore (PairSelector conventions: a mutable backing object lets each
// test seed the catalog snapshot it needs). The GLOBAL chat pair lives here
// too — the tests assert the sessions flow never rewrites it.
const { aiState } = vi.hoisted(() => ({
  aiState: {
    chatProvider: 'anthropic',
    chatModel: 'claude-sonnet-4-6',
    providerSettings: {} as Record<string, {
      id: string; baseUrl: string; apiKey: string;
      selectedModelIds: string[]; enabled: boolean; extra: Record<string, unknown>;
    }>,
    customerProviders: {} as Record<string, unknown>,
  },
}));

vi.mock('@/store/aiConfigStore', () => ({
  useAiConfigStore: (sel: (s: typeof aiState) => unknown) => sel(aiState),
}));

// Slice 5: stub ONLY generateSessionNote — the typed error classes stay real
// so the detail view's instanceof mapping runs the actual logic.
const { generateMock } = vi.hoisted(() => ({ generateMock: vi.fn() }));
vi.mock('@/services/externalSessions/noteGeneration', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, generateSessionNote: generateMock };
});

import { SessionsPanel } from './SessionsPanel';
import { SessionDetailView } from './SessionDetailView';
import { EvidenceViewer } from './EvidenceViewer';
import { useSessionsUiStore, INITIAL_SESSIONS_UI } from '@/store/sessionsUiStore';
import { useToastStore } from '@/store/toastStore';
import {
  InsufficientContextError,
  NoModelConfiguredError,
  NoteGenerationCancelledError,
  UnsupportedImageModelError,
} from '@/services/externalSessions/noteGeneration';
// Real (unmocked) pure module — the locator parser must run for real.
import { renderSourceLocator } from '@/services/externalSessions/sourceLocator';
// Aliased to the global test mock of the Tauri clipboard plugin.
import { readText } from '@tauri-apps/plugin-clipboard-manager';

/** WorkArea's sessions branch, replicated: evidence fallback first, then the
 *  detail view, nothing when the list is showing. */
function SessionsArea(): React.JSX.Element | null {
  const evidence = useSessionsUiStore((s) => s.evidence);
  const detail = useSessionsUiStore((s) => s.detail);
  const detailLoading = useSessionsUiStore((s) => s.detailLoading);
  const closeEvidence = useSessionsUiStore((s) => s.closeEvidence);
  if (evidence) return <EvidenceViewer record={evidence.record} onBack={closeEvidence} />;
  if (detail || detailLoading) return <SessionDetailView />;
  return null;
}

/** Sidebar list + main-area view — the split the app renders. */
function renderSessions() {
  return render(
    <>
      <SessionsPanel />
      <SessionsArea />
    </>,
  );
}

beforeEach(() => {
  cleanup();
  discoverMock.mockClear();
  readMock.mockClear();
  saveMock.mockClear();
  refreshFileTreeMock.mockClear();
  vaultReadFileMock.mockClear();
  vaultReadFileMock.mockResolvedValue('');
  useToastStore.setState({ queue: [] });
  useSessionsUiStore.setState(INITIAL_SESSIONS_UI);
  generateMock.mockReset();
  generateMock.mockResolvedValue('# 默认整理笔记');
  // Two enabled providers: the chat default (anthropic) + a switchable
  // alternative (openai) — the quota-error scenario.
  aiState.chatProvider = 'anthropic';
  aiState.chatModel = 'claude-sonnet-4-6';
  aiState.providerSettings = {
    anthropic: {
      id: 'anthropic', baseUrl: '', apiKey: 'key-1',
      selectedModelIds: ['claude-sonnet-4-6'], enabled: true, extra: {},
    },
    openai: {
      id: 'openai', baseUrl: '', apiKey: 'key-2',
      selectedModelIds: ['gpt-5.2'], enabled: true, extra: {},
    },
  };
  aiState.customerProviders = {};
});
afterEach(() => cleanup());

describe('SessionDetailView', () => {
  it('opening a conversation re-reads its detail and renders messages', async () => {
    renderSessions();
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    fireEvent.click(screen.getByText('Fix login'));
    await waitFor(() => expect(readMock).toHaveBeenCalledWith(summaries[0]));
    await waitFor(() => expect(screen.getByText('how to fix the login bug?')).toBeTruthy());
    expect(screen.getByText(/reset the token cache/)).toBeTruthy();
    // linear (single-branch) detail: no branch switcher is rendered
    expect(screen.queryByLabelText('分支')).toBeNull();
  });

  it('selecting messages, seeing missing material, and capturing to the vault', async () => {
    renderSessions();
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    fireEvent.click(screen.getByText('Fix login'));
    await waitFor(() => expect(screen.getByText('how to fix the login bug?')).toBeTruthy());

    // select both messages
    const toggles = screen.getAllByLabelText('选中');
    expect(toggles).toHaveLength(2);
    fireEvent.click(toggles[0]!);
    fireEvent.click(toggles[1]!);
    expect(screen.getByText('已选 2 条')).toBeTruthy();

    // missing material is visible BEFORE saving
    expect(screen.getByText(/所选内容含 1 项缺失素材/)).toBeTruthy();

    // save → dialog → confirm
    fireEvent.click(screen.getByLabelText('保存已选'));
    expect(screen.getByText('保存消息')).toBeTruthy();
    fireEvent.click(screen.getByText('保存')); // confirm button (not 保存中…)
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));

    const [dir, filename, input] = saveMock.mock.calls[0]!;
    expect(dir).toBe('');
    expect(filename).toContain('Fix login');
    expect(input.detail).toBe(detail);
    expect(input.selectedMessages).toHaveLength(2);

    // success toast + vault tree refresh
    await waitFor(() =>
      expect(useToastStore.getState().queue.some((q) => q.message.includes('已收录'))).toBe(true),
    );
    expect(refreshFileTreeMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('保存消息')).toBeNull());
  });

  it('choosing a vault subdirectory in the save dialog saves into that directory', async () => {
    renderSessions();
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    fireEvent.click(screen.getByText('Fix login'));
    await waitFor(() => expect(screen.getByText('how to fix the login bug?')).toBeTruthy());
    fireEvent.click(screen.getAllByLabelText('选中')[0]!);

    fireEvent.click(screen.getByLabelText('收录所选'));
    // pick the `notes` subdirectory instead of the vault root
    fireEvent.click(screen.getByText('notes'));
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));

    const [dir, filename, input] = saveMock.mock.calls[0]!;
    expect(dir).toBe('notes'); // the chosen directory, not the vault root
    expect(filename).toContain('Fix login');
    expect(input.selectedMessages).toHaveLength(1);
  });

  it('a branched session shows a branch switcher; switching re-reads and clears the selection', async () => {
    readMock.mockImplementation(async (_s: unknown, _fs: unknown, branchId?: string) =>
      branchId === 'b1' ? altDetail : branchedDetail);
    renderSessions();
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    fireEvent.click(screen.getByText('Fix login'));
    await waitFor(() => expect(screen.getByText(/mainline answer/)).toBeTruthy());

    // select a message on the mainline
    fireEvent.click(screen.getAllByLabelText('选中')[0]!);
    expect(screen.getByText('已选 1 条')).toBeTruthy();

    // switch branch → explicit fresh read with the branch id; the alt
    // branch's messages replace the projection and the selection is cleared
    const branchSelect = screen.getByLabelText('分支');
    fireEvent.change(branchSelect, { target: { value: 'b1' } });
    await waitFor(() => expect(readMock).toHaveBeenLastCalledWith(summaries[0], undefined, 'b1'));
    await waitFor(() => expect(screen.getByText(/alt answer/)).toBeTruthy());
    expect(screen.queryByText(/mainline answer/)).toBeNull();
    expect(screen.queryByText('已选 1 条')).toBeNull();
  });

  it('going back returns to the list and refreshes discovery', async () => {
    renderSessions();
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    fireEvent.click(screen.getByText('Fix login'));
    await waitFor(() => expect(screen.getByText('how to fix the login bug?')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('返回列表'));
    await waitFor(() => {
      // detail is gone, the sidebar rows are back in focus
      expect(useSessionsUiStore.getState().detail).toBeNull();
      expect(screen.getByText('Fix login')).toBeTruthy();
      expect(discoverMock).toHaveBeenCalledTimes(2);
    });
  });

  it('with no vault open, confirming a save toasts the no-vault message and writes nothing', async () => {
    const previous = vaultState.currentVault;
    vaultState.currentVault = null;
    try {
      renderSessions();
      await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
      fireEvent.click(screen.getByText('Fix login'));
      await waitFor(() => expect(screen.getByText('how to fix the login bug?')).toBeTruthy());
      fireEvent.click(screen.getAllByLabelText('选中')[0]!);
      fireEvent.click(screen.getByLabelText('保存已选'));
      fireEvent.click(screen.getByText('保存'));
      await waitFor(() =>
        expect(useToastStore.getState().queue.some((q) => q.message.includes('请先打开一个知识库'))).toBe(true),
      );
      expect(saveMock).not.toHaveBeenCalled();
    } finally {
      vaultState.currentVault = previous;
    }
  });

  // ── Slice 4: whole-branch selection ──

  it('select entire branch selects every message of the CURRENT branch', async () => {
    readMock.mockImplementation(async () => branchedDetail);
    try {
      renderSessions();
      await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
      fireEvent.click(screen.getByText('Fix login'));
      await waitFor(() => expect(screen.getByText(/mainline answer/)).toBeTruthy());

      fireEvent.click(screen.getByLabelText('收录整条分支（仅当前分支）'));
      await waitFor(() => expect(screen.getByText('已选 2 条')).toBeTruthy());

      // save → the capture input carries the whole branch projection
      fireEvent.click(screen.getByLabelText('收录所选'));
      fireEvent.click(screen.getByText('保存'));
      await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
      const input = saveMock.mock.calls[0]![2]!;
      expect(input.selectedMessages.map((m: { id: string }) => m.id)).toEqual(['msg-1', 'msg-9']);
      expect(input.textRanges).toEqual([]);
    } finally {
      // restore the default read for subsequent tests (mockClear keeps impls)
      readMock.mockImplementation(async () => detail);
    }
  });

  it('select entire branch toggles off when the whole branch is already selected', async () => {
    renderSessions();
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    fireEvent.click(screen.getByText('Fix login'));
    await waitFor(() => expect(screen.getByText('how to fix the login bug?')).toBeTruthy());

    const branchBtn = screen.getByTestId('select-all-branch');
    expect(branchBtn.getAttribute('aria-pressed')).toBe('false');

    // click 1 — every visible message selected; the button shows pressed
    fireEvent.click(branchBtn);
    expect(screen.getByText('已选 2 条消息 · 0 段文字')).toBeTruthy();
    expect(branchBtn.getAttribute('aria-pressed')).toBe('true');

    // click 2 — toggle OFF: the message selection is empty again
    fireEvent.click(branchBtn);
    expect(screen.queryByText(/已选 \d+ 条消息/)).toBeNull();
    expect(branchBtn.getAttribute('aria-pressed')).toBe('false');

    // partial selection (one message unchecked) → the button selects all,
    // it never toggles a partial selection off
    fireEvent.click(screen.getAllByLabelText('选中')[0]!);
    fireEvent.click(branchBtn);
    expect(screen.getByText('已选 2 条消息 · 0 段文字')).toBeTruthy();
    expect(branchBtn.getAttribute('aria-pressed')).toBe('true');

    // text ranges are a separate selection mode: a toggle-off never drops
    // them. (Full-branch + range is a state the click flow itself cannot
    // produce — picking a range deselects the message — so seed the store
    // directly at the seam that owns the toggle logic.)
    useSessionsUiStore.setState({
      selectedIds: new Set(['msg-1', 'msg-2']),
      textRanges: [{ messageId: 'msg-1', start: 4, end: 13 }],
    });
    fireEvent.click(branchBtn);
    expect(useSessionsUiStore.getState().selectedIds.size).toBe(0);
    expect(useSessionsUiStore.getState().textRanges).toEqual([
      { messageId: 'msg-1', start: 4, end: 13 },
    ]);
  });

  // ── Slice 4: text-range selection ──

  it('selecting a text range captures only the excerpt with exact coordinates', async () => {
    renderSessions();
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    fireEvent.click(screen.getByText('Fix login'));
    await waitFor(() => expect(screen.getByText('how to fix the login bug?')).toBeTruthy());

    // per-message "选择文字" button opens the range picker
    fireEvent.click(screen.getAllByLabelText('选择文字')[0]!);
    const textarea = screen.getByLabelText('消息原文') as HTMLTextAreaElement;
    expect(textarea.value).toBe('how to fix the login bug?'); // canonical text, verbatim

    // drag a selection inside the textarea → exact [start, end) coordinates
    textarea.setSelectionRange(4, 13); // 'to fix t'
    fireEvent.select(textarea);
    expect(screen.getByTestId('range-excerpt-preview').textContent).toContain('to fix t');

    fireEvent.click(screen.getByText('确定'));
    // summary bar: 0 whole messages, 1 text excerpt + the chip preview
    expect(screen.getByText('已选 0 条消息 · 1 段文字')).toBeTruthy();
    expect(screen.getByText(/msg-1: “to fix th”/)).toBeTruthy();

    // capture the range → the excerpt alone, no whole messages
    fireEvent.click(screen.getByLabelText('收录所选'));
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const [dir, filename, input] = saveMock.mock.calls[0]!;
    expect(dir).toBe('');
    expect(filename).toContain('Fix login');
    expect(input.selectedMessages).toEqual([]);
    expect(input.textRanges).toEqual([{ messageId: 'msg-1', start: 4, end: 13 }]);
    await waitFor(() =>
      expect(useToastStore.getState().queue.some((q) => q.message.includes('已收录'))).toBe(true),
    );
  });

  it('a range chip can be removed; block-selecting a message drops its range', async () => {
    renderSessions();
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    fireEvent.click(screen.getByText('Fix login'));
    await waitFor(() => expect(screen.getByText('how to fix the login bug?')).toBeTruthy());

    fireEvent.click(screen.getAllByLabelText('选择文字')[0]!);
    const textarea = screen.getByLabelText('消息原文') as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 3);
    fireEvent.select(textarea);
    fireEvent.click(screen.getByText('确定'));
    expect(screen.getByText('已选 0 条消息 · 1 段文字')).toBeTruthy();

    // block-select the same message → the range is superseded
    fireEvent.click(screen.getAllByLabelText('选中')[0]!);
    expect(screen.getByText('已选 1 条消息 · 0 段文字')).toBeTruthy();

    // re-pick a range → it replaces the block selection of that message
    fireEvent.click(screen.getAllByLabelText('选择文字')[0]!);
    const ta = screen.getByLabelText('消息原文') as HTMLTextAreaElement;
    ta.setSelectionRange(0, 3);
    fireEvent.select(ta);
    fireEvent.click(screen.getByText('确定'));
    expect(screen.getByText('已选 0 条消息 · 1 段文字')).toBeTruthy();

    // remove the chip via its remove button
    fireEvent.click(screen.getByLabelText('移除该文字片段'));
    expect(screen.queryByText(/1 段文字/)).toBeNull();
  });

  // ── Slice 4: tool-evidence preview + staleness ──

  it('the selection preview lists the tool records that will be included (tools shown)', async () => {
    readMock.mockImplementation(async () => detailWithTools);
    try {
      renderSessions();
      await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
      fireEvent.click(screen.getByText('Fix login'));
      await waitFor(() => expect(screen.getByText('how to fix the login bug?')).toBeTruthy());

      // tools are display-hidden by default — flip the quiet pill ON first
      fireEvent.click(screen.getByTestId('show-tools-toggle'));
      expect(screen.getByTestId('show-tools-toggle').getAttribute('aria-pressed')).toBe('true');

      fireEvent.click(screen.getAllByLabelText('选中')[1]!); // msg-2 carries the exec tool call
      expect(screen.getByText(/已选 1 条消息 · 0 段文字/)).toBeTruthy();
      expect(screen.getByText(/将一并收录的工具记录：msg-2 · exec/)).toBeTruthy();

      // capture with tools shown keeps the tool evidence in the snapshot
      fireEvent.click(screen.getByLabelText('保存已选'));
      fireEvent.click(screen.getByText('保存'));
      await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
      const saved = saveMock.mock.calls[0]![2]!.selectedMessages.find((m: { id: string }) => m.id === 'msg-2')!;
      expect(saved.toolCalls).toHaveLength(1);
      expect(saved.rawToolRecords).toHaveLength(2);
    } finally {
      readMock.mockImplementation(async () => detail);
    }
  });

  // ── Text-only reading mode (display filter, default) ──

  it('default view shows the clean conversation: tool rows and tool-only records are hidden', async () => {
    readMock.mockImplementation(async () => detailWithTools);
    try {
      renderSessions();
      await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
      fireEvent.click(screen.getByText('Fix login'));
      await waitFor(() => expect(screen.getByText('how to fix the login bug?')).toBeTruthy());

      // text messages present; tool rows (exec, read_file) and the tool-only
      // carrier message absent; only the 2 text messages offer selection
      expect(screen.getByText(/reset the token cache/)).toBeTruthy();
      expect(screen.queryByText('exec')).toBeNull();
      expect(screen.queryByText('read_file')).toBeNull();
      expect(screen.getAllByLabelText('选中')).toHaveLength(2);
      expect(screen.getByTestId('show-tools-toggle').getAttribute('aria-pressed')).toBe('false');

      // toggle ON — tool rows return, the tool-only record becomes selectable
      fireEvent.click(screen.getByTestId('show-tools-toggle'));
      expect(screen.getByText('exec')).toBeTruthy();
      expect(screen.getByText('read_file')).toBeTruthy();
      expect(screen.getAllByLabelText('选中')).toHaveLength(3);
    } finally {
      readMock.mockImplementation(async () => detail);
    }
  });

  it('text-only selection captures no tool records, and the preview says so honestly', async () => {
    // msg-2 carries a correlated exec call + raw tool records in the source
    readMock.mockImplementation(async () => detailWithTools);
    try {
      renderSessions();
      await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
      fireEvent.click(screen.getByText('Fix login'));
      await waitFor(() => expect(screen.getByText('how to fix the login bug?')).toBeTruthy());

      fireEvent.click(screen.getAllByLabelText('选中')[1]!); // msg-2 (text + exec call)
      expect(screen.getByText(/已选 1 条消息 · 0 段文字/)).toBeTruthy();
      // the tool-evidence preview reflects what will ACTUALLY be captured: nothing
      expect(screen.queryByText(/将一并收录的工具记录/)).toBeNull();

      fireEvent.click(screen.getByLabelText('保存已选'));
      fireEvent.click(screen.getByText('保存'));
      await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
      const saved = saveMock.mock.calls[0]![2]!.selectedMessages.find((m: { id: string }) => m.id === 'msg-2')!;
      expect(saved.toolCalls).toEqual([]);
      expect(saved.rawToolRecords).toEqual([]);
      // the unchanged source must NOT be reported stale by the stripped snapshot
      await waitFor(() =>
        expect(useToastStore.getState().queue.some((q) => q.message.includes('已收录'))).toBe(true),
      );
    } finally {
      readMock.mockImplementation(async () => detail);
    }
  });

  it('whole-branch selection in text-only mode selects only the visible text messages', async () => {
    readMock.mockImplementation(async () => detailWithTools);
    try {
      renderSessions();
      await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
      fireEvent.click(screen.getByText('Fix login'));
      await waitFor(() => expect(screen.getByText('how to fix the login bug?')).toBeTruthy());

      fireEvent.click(screen.getByLabelText('收录整条分支（仅当前分支）'));
      expect(screen.getByText('已选 2 条消息 · 0 段文字')).toBeTruthy();

      fireEvent.click(screen.getByLabelText('收录所选'));
      fireEvent.click(screen.getByText('保存'));
      await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
      const input = saveMock.mock.calls[0]![2]!;
      expect(input.selectedMessages.map((m: { id: string }) => m.id)).toEqual(['msg-1', 'msg-2']);
    } finally {
      readMock.mockImplementation(async () => detail);
    }
  });

  it('confirming after the source changed fails with a reselect-required error and writes nothing', async () => {
    renderSessions();
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    fireEvent.click(screen.getByText('Fix login'));
    await waitFor(() => expect(screen.getByText('how to fix the login bug?')).toBeTruthy());
    fireEvent.click(screen.getAllByLabelText('选中')[0]!);

    fireEvent.click(screen.getByLabelText('保存已选'));
    expect(screen.getByText('保存消息')).toBeTruthy();

    // the source changes between snapshot and confirm
    const changed = {
      ...detail,
      messages: [
        { ...detail.messages[0]!, rawRecord: '{"type":"response_item","changed":true}' },
        detail.messages[1]!,
      ],
    };
    readMock.mockResolvedValueOnce(changed);

    fireEvent.click(screen.getByText('保存'));
    await waitFor(() =>
      expect(useToastStore.getState().queue.some((q) => q.message.includes('来源已变化'))).toBe(true),
    );
    expect(saveMock).not.toHaveBeenCalled(); // nothing written
    await waitFor(() => expect(screen.queryByText('保存消息')).toBeNull());
  });

  // ── Slice 5: AI-organized notes ────────────────────────────────────────

  /** Open the session and select the first message (shared setup). */
  async function openAndSelectFirst(): Promise<void> {
    renderSessions();
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    fireEvent.click(screen.getByText('Fix login'));
    await waitFor(() => expect(screen.getByText('how to fix the login bug?')).toBeTruthy());
    fireEvent.click(screen.getAllByLabelText('选中')[0]!);
  }

  it('generates an editable draft; confirming saves the EDITED content plus the evidence bundle', async () => {
    generateMock.mockResolvedValueOnce('# 整理后的笔记');
    await openAndSelectFirst();

    fireEvent.click(screen.getByLabelText('AI 整理'));
    const draft = await waitFor(() => screen.getByLabelText('笔记内容') as HTMLTextAreaElement);
    expect(draft.value).toBe('# 整理后的笔记');
    // the generation input is EXACTLY the selection snapshot
    expect(generateMock).toHaveBeenCalledTimes(1);
    const [genInput, genOpts] = generateMock.mock.calls[0]!;
    expect(genInput.detail).toBe(detail);
    expect(genInput.selectedMessages.map((m: { id: string }) => m.id)).toEqual(['msg-1']);
    expect(genInput.textRanges).toEqual([]);
    expect(typeof genOpts.cancelled).toBe('function');

    // the user EDITS the draft — the saved note is the edit, not the raw output
    fireEvent.change(draft, { target: { value: '# 编辑后的笔记\n\n用户补充' } });
    fireEvent.click(screen.getByLabelText('保存到知识库'));
    expect(screen.getByText('保存消息')).toBeTruthy();
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));

    const [dir, filename, input] = saveMock.mock.calls[0]!;
    expect(dir).toBe('');
    expect(filename).toContain('Fix login');
    expect(input.noteBody).toBe('# 编辑后的笔记\n\n用户补充');
    expect(input.selectedMessages).toHaveLength(1);
    await waitFor(() =>
      expect(useToastStore.getState().queue.some((q) => q.message.includes('已收录'))).toBe(true),
    );
  });

  it('insufficient context is an explicit state — no draft, nothing written', async () => {
    generateMock.mockRejectedValueOnce(new InsufficientContextError());
    await openAndSelectFirst();

    fireEvent.click(screen.getByLabelText('AI 整理'));
    await waitFor(() =>
      expect(screen.getByTestId('gen-status-banner').textContent).toContain('信息不足'),
    );
    expect(screen.queryByLabelText('笔记内容')).toBeNull();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('a generation failure shows an error with retry; the retry succeeds', async () => {
    generateMock.mockRejectedValueOnce(new Error('boom'));
    await openAndSelectFirst();

    fireEvent.click(screen.getByLabelText('AI 整理'));
    await waitFor(() =>
      expect(screen.getByTestId('gen-status-banner').textContent).toContain('生成失败：boom'),
    );
    expect(saveMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('重试'));
    await waitFor(() => expect(generateMock).toHaveBeenCalledTimes(2));
    // the retry reuses the STORED selection snapshot
    expect(generateMock.mock.calls[1]![0].selectedMessages.map((m: { id: string }) => m.id))
      .toEqual(['msg-1']);
    await waitFor(() => expect(screen.getByLabelText('笔记内容')).toBeTruthy());
    expect(saveMock).not.toHaveBeenCalled(); // still nothing written
  });

  it('cancelling generation returns to idle and writes nothing', async () => {
    generateMock.mockImplementationOnce(
      (_input: unknown, opts: { cancelled?: () => boolean }) =>
        new Promise((_resolve, reject) => {
          const iv = setInterval(() => {
            if (opts?.cancelled?.()) {
              clearInterval(iv);
              reject(new NoteGenerationCancelledError());
            }
          }, 10);
        }),
    );
    await openAndSelectFirst();

    fireEvent.click(screen.getByLabelText('AI 整理'));
    await waitFor(() => expect(screen.getByText('正在生成整理笔记…')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('取消生成'));

    await waitFor(() => expect(screen.queryByText('正在生成整理笔记…')).toBeNull());
    expect(screen.queryByLabelText('笔记内容')).toBeNull();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('an image-unsupported model offers explicit text-only processing', async () => {
    generateMock.mockRejectedValueOnce(new UnsupportedImageModelError('anthropic', 'm1', 1));
    await openAndSelectFirst();

    fireEvent.click(screen.getByLabelText('AI 整理'));
    await waitFor(() =>
      expect(screen.getByTestId('gen-status-banner').textContent).toContain('不支持'),
    );

    // the explicit text-only choice re-runs generation without images
    fireEvent.click(screen.getByLabelText('仅用文字整理'));
    await waitFor(() => expect(generateMock).toHaveBeenCalledTimes(2));
    expect(generateMock.mock.calls[1]![1]).toMatchObject({ includeImages: false });
    await waitFor(() => expect(screen.getByLabelText('笔记内容')).toBeTruthy());
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('no configured model is an explicit state — nothing generated or written', async () => {
    generateMock.mockRejectedValueOnce(new NoModelConfiguredError());
    await openAndSelectFirst();

    fireEvent.click(screen.getByLabelText('AI 整理'));
    await waitFor(() =>
      expect(screen.getByTestId('gen-status-banner').textContent).toContain('尚未配置'),
    );
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(saveMock).not.toHaveBeenCalled();
  });

  // ── provider/model pair selection for AI note generation ──────────────

  it('generation defaults to the app chat pair; the selector lists the enabled pairs from aiConfigStore', async () => {
    await openAndSelectFirst();

    // the icon trigger reflects the effective (default) pair
    const trigger = screen.getByTestId('pair-selector');
    expect(trigger.title).toContain('claude-sonnet-4-6');
    fireEvent.click(trigger);
    const panel = screen.getByTestId('pair-selector-panel');
    // 1 anthropic + 1 openai pair row (placeholder row is separate)
    expect(panel.querySelectorAll('[role="option"]').length).toBe(2);
    expect(screen.getByText('gpt-5.2')).toBeTruthy();
    fireEvent.click(trigger); // close the panel before generating

    fireEvent.click(screen.getByLabelText('AI 整理'));
    await waitFor(() => expect(screen.getByLabelText('笔记内容')).toBeTruthy());
    expect(generateMock).toHaveBeenCalledTimes(1);
    // no explicit pair passed → the service uses its default (chat pair)
    expect(generateMock.mock.calls[0]![1].pair).toBeUndefined();
  });

  it('picking another pair routes THAT pair into the generation request without touching the global chat pair', async () => {
    await openAndSelectFirst();

    fireEvent.click(screen.getByTestId('pair-selector'));
    fireEvent.mouseDown(screen.getByText('gpt-5.2'));

    // the choice is local to the sessions flow; the app default is unchanged
    expect(useSessionsUiStore.getState().notePair).toEqual({ provider: 'openai', model: 'gpt-5.2' });
    expect(aiState.chatProvider).toBe('anthropic');
    expect(aiState.chatModel).toBe('claude-sonnet-4-6');

    fireEvent.click(screen.getByLabelText('AI 整理'));
    await waitFor(() => expect(screen.getByLabelText('笔记内容')).toBeTruthy());
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(generateMock.mock.calls[0]![1].pair).toEqual({ provider: 'openai', model: 'gpt-5.2' });
  });

  it('after a failed generation (e.g. a quota error), switching the pair and retrying uses the new pair', async () => {
    generateMock.mockRejectedValueOnce(new Error('429 rate limited'));
    await openAndSelectFirst();

    fireEvent.click(screen.getByLabelText('AI 整理'));
    await waitFor(() =>
      expect(screen.getByTestId('gen-status-banner').textContent).toContain('429'),
    );

    // the user switches providers for this flow, then retries
    fireEvent.click(screen.getByTestId('pair-selector'));
    fireEvent.mouseDown(screen.getByText('gpt-5.2'));
    fireEvent.click(screen.getByLabelText('重试'));

    await waitFor(() => expect(generateMock).toHaveBeenCalledTimes(2));
    expect(generateMock.mock.calls[1]![1].pair).toEqual({ provider: 'openai', model: 'gpt-5.2' });
    await waitFor(() => expect(screen.getByLabelText('笔记内容')).toBeTruthy());
  });

  it('clearing the selection back to the default pair passes no explicit pair', async () => {
    await openAndSelectFirst();

    // pick, then clear via the placeholder row (PairSelector's clear path)
    fireEvent.click(screen.getByTestId('pair-selector'));
    fireEvent.mouseDown(screen.getByText('gpt-5.2'));
    expect(useSessionsUiStore.getState().notePair).toEqual({ provider: 'openai', model: 'gpt-5.2' });
    fireEvent.click(screen.getByTestId('pair-selector'));
    fireEvent.mouseDown(screen.getByText('选择模型'));

    expect(useSessionsUiStore.getState().notePair).toBeNull();
    fireEvent.click(screen.getByLabelText('AI 整理'));
    await waitFor(() => expect(screen.getByLabelText('笔记内容')).toBeTruthy());
    expect(generateMock.mock.calls[0]![1].pair).toBeUndefined();
  });

  it('no enabled pairs → the selector shows its empty state (settings shortcut) in the action bar', async () => {
    aiState.providerSettings = {};
    aiState.chatProvider = '';
    aiState.chatModel = '';
    await openAndSelectFirst();

    expect(screen.getByTestId('pair-selector-empty')).toBeTruthy();
  });

  it('a stale persisted notePair (id no longer configured) shows the default and is cleared', async () => {
    // persisted choice whose provider/model is no longer among the configured
    // pairs (e.g. removed in settings between launches)
    useSessionsUiStore.setState({ notePair: { provider: 'gone-provider', model: 'gone-model' } });
    await openAndSelectFirst();

    // reconciled away on mount — the store (and its persisted copy) no longer
    // hold the unknown id
    await waitFor(() => expect(useSessionsUiStore.getState().notePair).toBeNull());

    // the selector reflects the DEFAULT chat pair, not a broken raw-id label
    expect(screen.getByTestId('pair-selector').title).toContain('claude-sonnet-4-6');

    // generation uses the default path: no explicit pair passed
    fireEvent.click(screen.getByLabelText('AI 整理'));
    await waitFor(() => expect(screen.getByLabelText('笔记内容')).toBeTruthy());
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(generateMock.mock.calls[0]![1].pair).toBeUndefined();
  });

  it('switching the vault between generation and confirm writes exactly once, at confirm', async () => {
    generateMock.mockResolvedValueOnce('# note');
    await openAndSelectFirst();

    fireEvent.click(screen.getByLabelText('AI 整理'));
    await waitFor(() => expect(screen.getByLabelText('笔记内容')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('保存到知识库'));
    expect(screen.getByText('保存消息')).toBeTruthy();

    // the active vault changes mid-flow (before the user confirms); the write
    // still happens once, bound at the moment of confirmation
    vaultState.currentVault = { id: 'v2', name: 'Second Vault' };

    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(saveMock.mock.calls[0]![2].noteBody).toBe('# note');
    await waitFor(() =>
      expect(useToastStore.getState().queue.some((q) => q.message.includes('已收录'))).toBe(true),
    );
  });

  it('switching the vault while generation is IN FLIGHT writes exactly once, at confirm', async () => {
    let resolveGen!: (v: string) => void;
    generateMock.mockImplementationOnce(
      () => new Promise<string>((res) => { resolveGen = res; }),
    );
    await openAndSelectFirst();

    fireEvent.click(screen.getByLabelText('AI 整理'));
    await waitFor(() => expect(screen.getByText('正在生成整理笔记…')).toBeTruthy());

    // the active vault changes WHILE the model request is in flight — the
    // pending draft is not a write; only the user's confirm writes
    const previous = vaultState.currentVault;
    vaultState.currentVault = { id: 'v2', name: 'Second Vault' };
    try {
      resolveGen('# inflight note');
      await waitFor(() => expect(screen.getByLabelText('笔记内容')).toBeTruthy());
      fireEvent.click(screen.getByLabelText('保存到知识库'));
      fireEvent.click(screen.getByText('保存'));
      await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
      expect(saveMock.mock.calls[0]![2].noteBody).toBe('# inflight note');
      await waitFor(() =>
        expect(useToastStore.getState().queue.some((q) => q.message.includes('已收录'))).toBe(true),
      );
    } finally {
      vaultState.currentVault = previous;
    }
  });
});

// ── Slice 6: source navigation from a saved note's locator ──────────────

describe('SessionDetailView source navigation', () => {
  const copyLocator = (over: Partial<Parameters<typeof renderSourceLocator>[0]>) => {
    const text = renderSourceLocator({
      source: 'codex',
      sessionId: summaries[0]!.sessionId,
      filePath: summaries[0]!.filePath,
      branchId: null,
      messageIds: ['msg-1', 'msg-2'],
      ranges: [],
      evidencePath: 'notes/capture.evidence',
      ...over,
    });
    readText.mockResolvedValue(text);
  };

  const evidenceRecord = (over: Record<string, unknown> = {}) => JSON.stringify({
    format: 'folyn-session-evidence/1',
    capturedAt: '2026-10-10T12:00:00.000Z',
    source: {
      tool: 'codex',
      sessionId: '11111111-2222-3333-4444-555555555555',
      title: 'Fix login',
      cwd: '/work/alpha',
      filePath: '/home/u/.codex/sessions/2026/10/10/rollout-a.jsonl',
      branch: null,
    },
    selectedMessageIds: ['msg-1'],
    messages: [
      { id: 'msg-1', role: 'user', digest: 'd1', rawRecords: ['{"type":"response_item","text":"how to fix the login bug?"}'] },
    ],
    assets: [{ file: 'assets/0001.png', digest: 'abc', messageId: 'msg-1' }],
    missing: [{ messageId: 'msg-1', kind: 'image', reason: 'not inline' }],
    sessionWarnings: [],
    complete: false,
    ...over,
  });

  /** The locate entry ("打开来源") lives in the DETAIL header — open a row
   *  first so the button is rendered. */
  const openFirstSession = async () => {
    fireEvent.click(screen.getByText('Fix login'));
    await waitFor(() => expect(screen.getByText('how to fix the login bug?')).toBeTruthy());
  };

  it('a pasted locator lands on the live session with no changed-content notice', async () => {
    copyLocator({});
    renderSessions();
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    await openFirstSession();
    fireEvent.click(screen.getByLabelText('打开来源（读取剪贴板中的定位信息）'));
    await waitFor(() => expect(screen.getByText('how to fix the login bug?')).toBeTruthy());
    // fresh discovery + read by source+sessionId
    expect(discoverMock).toHaveBeenCalled();
    await waitFor(() => expect(readMock).toHaveBeenCalledWith(summaries[0], undefined, undefined));
    // all recorded ids resolve → no "changed since capture" claim either way
    expect(screen.queryByTestId('source-changed-notice')).toBeNull();
  });

  it('unparsable clipboard content is an explicit error, not navigation', async () => {
    readText.mockResolvedValue('随便粘贴的内容');
    renderSessions();
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    await openFirstSession();
    const reads = readMock.mock.calls.length;
    const discovers = discoverMock.mock.calls.length;
    fireEvent.click(screen.getByLabelText('打开来源（读取剪贴板中的定位信息）'));
    await waitFor(() =>
      expect(useToastStore.getState().queue.some((q) => q.message.includes('不是有效的来源定位'))).toBe(true),
    );
    expect(readMock.mock.calls.length).toBe(reads); // no re-read, no navigation
    expect(discoverMock.mock.calls.length).toBe(discovers);
    expect(useSessionsUiStore.getState().detail).toBe(detail); // the open session stays
  });

  it('a clipboard READ failure is the same explicit error, never navigation', async () => {
    readText.mockRejectedValue(new Error('clipboard locked'));
    renderSessions();
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    await openFirstSession();
    const reads = readMock.mock.calls.length;
    fireEvent.click(screen.getByLabelText('打开来源（读取剪贴板中的定位信息）'));
    await waitFor(() =>
      expect(useToastStore.getState().queue.some((q) => q.message.includes('不是有效的来源定位'))).toBe(true),
    );
    expect(readMock.mock.calls.length).toBe(reads);
    expect(useSessionsUiStore.getState().detail).toBe(detail);
  });

  it('a locator with a recorded branch re-reads that branch', async () => {
    readMock.mockImplementation(async (_s: unknown, _fs: unknown, branchId?: string) =>
      branchId === 'b1' ? altDetail : branchedDetail);
    try {
      copyLocator({ source: 'pi', branchId: 'b1', messageIds: ['msg-1'], ranges: [] });
      renderSessions();
      await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
      await openFirstSession();
      fireEvent.click(screen.getByLabelText('打开来源（读取剪贴板中的定位信息）'));
      await waitFor(() =>
        expect(readMock).toHaveBeenLastCalledWith(summaries[0], undefined, 'b1'),
      );
      await waitFor(() => expect(screen.getByText(/alt answer/)).toBeTruthy());
      expect(screen.queryByTestId('source-changed-notice')).toBeNull();
    } finally {
      readMock.mockImplementation(async () => detail);
    }
  });

  it('recorded message ids that no longer resolve produce a changed notice — never a silent match', async () => {
    copyLocator({ messageIds: ['msg-1', 'msg-9'] }); // msg-9 does not exist in the live detail
    renderSessions();
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    await openFirstSession();
    fireEvent.click(screen.getByLabelText('打开来源（读取剪贴板中的定位信息）'));
    await waitFor(() => expect(screen.getByTestId('source-changed-notice')).toBeTruthy());
    expect(screen.getByTestId('source-changed-notice').textContent).toContain('msg-9');
    // the session still opens — surrounding discussion stays inspectable
    expect(screen.getByText('how to fix the login bug?')).toBeTruthy();
  });

  it('a missing live source opens the saved evidence bundle with capture time + completeness', async () => {
    copyLocator({ sessionId: 'gone-session', filePath: '/home/u/.codex/sessions/gone.jsonl', messageIds: ['msg-1'] });
    vaultReadFileMock.mockResolvedValue(evidenceRecord());
    renderSessions();
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    await openFirstSession();
    const before = discoverMock.mock.calls.length;
    fireEvent.click(screen.getByLabelText('打开来源（读取剪贴板中的定位信息）'));
    await waitFor(() => expect(screen.getByTestId('evidence-viewer')).toBeTruthy());
    // records.json read fresh from the vault, from the locator's evidence path
    expect(vaultReadFileMock).toHaveBeenCalledWith('notes/capture.evidence/records.json');
    // capture time + honest completeness (missing image is visible)
    expect(screen.getByTestId('evidence-capture-time').textContent).toContain('2026/10/10');
    expect(screen.getByTestId('evidence-completeness').textContent).toContain('1');
    expect(screen.getByText(/not inline/)).toBeTruthy();
    // verbatim selected records are rendered
    expect(screen.getByTestId('evidence-raw-records').textContent).toContain('how to fix the login bug?');
    // the live-source-missing state is explicit, not a claimed match
    expect(discoverMock.mock.calls.length).toBe(before + 1);
    await waitFor(() =>
      expect(useToastStore.getState().queue.some((q) => q.message.includes('来源会话已不存在'))).toBe(true),
    );
  });

  it('the evidence view re-reads the bundle from the vault on every open (restart = fresh read)', async () => {
    copyLocator({ sessionId: 'gone-session', filePath: '/home/u/.codex/sessions/gone.jsonl', messageIds: ['msg-1'] });
    vaultReadFileMock.mockResolvedValueOnce(evidenceRecord());
    renderSessions();
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    await openFirstSession();
    fireEvent.click(screen.getByLabelText('打开来源（读取剪贴板中的定位信息）'));
    await waitFor(() => expect(screen.getByTestId('evidence-viewer')).toBeTruthy());
    expect(screen.getByTestId('evidence-completeness').textContent).toContain('1'); // incomplete

    // leave the viewer, the bundle changes on disk (another session wrote it)
    fireEvent.click(screen.getByLabelText('返回列表'));
    await waitFor(() => expect(screen.queryByTestId('evidence-viewer')).toBeNull());
    vaultReadFileMock.mockResolvedValueOnce(evidenceRecord({
      missing: [], complete: true,
    }));

    // reopen — the NEW content is shown (no stale cache across the reopen)
    await openFirstSession();
    fireEvent.click(screen.getByLabelText('打开来源（读取剪贴板中的定位信息）'));
    await waitFor(() => expect(screen.getByTestId('evidence-viewer')).toBeTruthy());
    expect(screen.getByTestId('evidence-completeness').textContent).toContain('完整收录');
    expect(vaultReadFileMock).toHaveBeenCalledTimes(2);
  });

  it('a vanished recorded branch opens the default projection WITH a branch-changed notice', async () => {
    // the recorded branch ('gone-b') no longer resolves — the reader throws;
    // the default projection opens and the view SAYS it is not the recorded
    // branch (the recorded ids still resolve there, so only the notice
    // distinguishes the fallback from a real match).
    readMock.mockImplementation(async (_s: unknown, _fs: unknown, branchId?: string) => {
      if (branchId === 'gone-b') throw new Error('branch not found');
      return branchedDetail;
    });
    try {
      copyLocator({ source: 'pi', branchId: 'gone-b', messageIds: ['msg-1'], ranges: [] });
      renderSessions();
      await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
      await openFirstSession();
      fireEvent.click(screen.getByLabelText('打开来源（读取剪贴板中的定位信息）'));
      await waitFor(() => expect(screen.getByText(/mainline answer/)).toBeTruthy());
      expect(screen.getByTestId('branch-changed-notice')).toBeTruthy();
      expect(screen.queryByTestId('source-changed-notice')).toBeNull(); // ids did resolve
    } finally {
      readMock.mockImplementation(async () => detail);
    }
  });

  it('a missing source with an unreadable evidence bundle reports the failure honestly', async () => {
    copyLocator({ sessionId: 'gone-session', filePath: '/home/u/.codex/sessions/gone.jsonl', evidencePath: 'notes/lost.evidence', messageIds: ['msg-1'] });
    vaultReadFileMock.mockRejectedValue(new Error('ENOENT'));
    renderSessions();
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    await openFirstSession();
    fireEvent.click(screen.getByLabelText('打开来源（读取剪贴板中的定位信息）'));
    await waitFor(() =>
      expect(useToastStore.getState().queue.some((q) => q.message.includes('无法读取收录时的证据副本'))).toBe(true),
    );
    expect(screen.queryByTestId('evidence-viewer')).toBeNull();
  });

  it('an evidence bundle with an unknown format is rejected with an explicit message', async () => {
    copyLocator({ sessionId: 'gone-session', filePath: '/home/u/.codex/sessions/gone.jsonl', messageIds: ['msg-1'] });
    vaultReadFileMock.mockResolvedValue(evidenceRecord({ format: 'folyn-session-evidence/99' }));
    renderSessions();
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    await openFirstSession();
    fireEvent.click(screen.getByLabelText('打开来源（读取剪贴板中的定位信息）'));
    await waitFor(() =>
      expect(useToastStore.getState().queue.some((q) => q.message.includes('无法识别的证据包格式'))).toBe(true),
    );
    expect(screen.queryByTestId('evidence-viewer')).toBeNull();
  });

  it('a ranged-excerpt record renders the excerpt text + coordinates, with no raw records', async () => {
    copyLocator({ sessionId: 'gone-session', filePath: '/home/u/.codex/sessions/gone.jsonl', messageIds: [] });
    vaultReadFileMock.mockResolvedValue(evidenceRecord({
      selectedMessageIds: ['msg-3'],
      messages: [
        {
          id: 'msg-3',
          role: 'user',
          digest: 'd3',
          rawRecords: [],
          ranges: [{ start: 0, end: 11, text: 'to fix the ' }],
        },
      ],
    }));
    renderSessions();
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy());
    await openFirstSession();
    fireEvent.click(screen.getByLabelText('打开来源（读取剪贴板中的定位信息）'));
    await waitFor(() => expect(screen.getByTestId('evidence-viewer')).toBeTruthy());
    // the excerpt coordinates + verbatim text are shown
    expect(screen.getByText(/节选 \[0, 11\)/)).toBeTruthy();
    expect(screen.getByText('to fix the')).toBeTruthy();
    // no raw records for a range-only selection — the unselected text stays out
    expect(screen.getByText(/仅保留节选/)).toBeTruthy();
    expect(screen.queryByTestId('evidence-raw-records')).toBeNull();
  });
});
