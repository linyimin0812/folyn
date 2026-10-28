// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { KbRef } from '@/services/knowledge/kbTypes';

const mocks = vi.hoisted(() => ({
  state: { activeThemeId: 'theme-a', scope: [], buildRunning: false, openSourceSettings: vi.fn(), build: vi.fn(), activeTpId: 'a' as string | null, topics: [{ tpId: 'a', title: 'Topic A', path: 'a.md' }, { tpId: 'b', title: 'Topic B', path: 'b.md' }], dataVersion: 0, goal: 'Knowledge goal', navigation: [], reviews: [], sources: {}, setPage: vi.fn(), setActiveTopic: vi.fn(), verifyTopicRefItem: vi.fn(), verifyingRefId: null, refNotice: '', saveTopicPage: vi.fn() },
  readFile: vi.fn(), readRefs: vi.fn(),
}));
vi.mock('@/store/knowledgeStore', () => ({ activeThemeFs: () => ({root: `__kb__/themes/${mocks.state.activeThemeId}`, readFile: mocks.readFile}), useKnowledgeStore: (selector: (s: typeof mocks.state) => unknown) => selector(mocks.state) }));
vi.mock('@/store/editorStore', () => ({ useEditorStore: { getState: () => ({ setActivePanel: vi.fn() }) } }));
// vaultStore 真模块链到 file-types registry → excalidraw → open-color JSON，
// Node ESM 下无法 collect（同 KnowledgePanel.test 的处理）。
vi.mock('@/store/vaultStore', () => ({ useVaultStore: (selector: (state: { activeVaultId: string | null }) => unknown) => selector({ activeVaultId: 'vault-a' }) }));
vi.mock('@/services/editorIoService', () => ({ openFile: vi.fn() }));
// FolynEditor 真模块链 CodeMirror/搜索面板等，jsdom 下过重且会撞 file-types
// registry 的 open-color JSON collect 错误（同 vaultStore mock 的处理）；
// 编辑态用替身 textarea 维持现有查询方式与 initialContent/onChange/onSave 语义。
vi.mock('@/editor/EditorView', () => ({
  FolynEditor: ({ initialContent = '', filePath = '', onChange, onSave }: { initialContent?: string; filePath?: string; onChange?: (value: string) => void; onSave?: () => void }) => (
    <textarea
      aria-label="知识页原文（编辑后保存）"
      defaultValue={initialContent}
      data-file-path={filePath}
      onChange={(e) => onChange?.(e.target.value)}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault();
          onSave?.();
        }
      }}
    />
  ),
}));
vi.mock('@/services/knowledge/kbFs', () => ({ vaultKbFs: () => ({ readFile: mocks.readFile }), readTopicRefs: mocks.readRefs, sha256Hex: vi.fn() }));
vi.mock('@/services/knowledge/topicSynth', () => ({ parseTopicPage: (body: string) => ({ body }), stripFootnoteDefs: (body: string) => body }));
vi.mock('@/services/markdown/renderMarkdown', () => ({ renderMarkdownToReact: (body: string, opts: { components: { a: (p: { href: string; children: string }) => ReactNode } }) => <div>{body}<button onClick={() => undefined}>body</button>{[...body.matchAll(/#cite-(c\d+)/g)].map((m) => <span key={m[1]}>{opts.components.a({ href: `#cite-${m[1]}`, children: m[1] })}</span>)}</div> }));
import { TopicReader } from './TopicReader';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const ref = (id: string, srcId: string): KbRef => ({ id, topicId: 'a', anchorText: 'quoted claim', srcId, versionHash: 'hash', startLine: 1, endLine: 1, status: 'active' });
beforeEach(() => { mocks.state.activeTpId = 'a'; mocks.state.dataVersion = 0; mocks.readFile.mockReset(); mocks.readRefs.mockReset().mockResolvedValue([]); mocks.state.saveTopicPage.mockReset(); });
afterEach(cleanup);

describe('TopicReader asynchronous content', () => {
  it('clears the old topic immediately and ignores its late response after selection changes', async () => {
    const a = deferred<string>(); const b = deferred<string>();
    mocks.readFile.mockImplementation((path: string) => path === 'a.md' ? a.promise : b.promise);
    const view = render(<TopicReader />);
    expect(screen.queryByRole('alert')).toBeNull();
    mocks.state.activeTpId = 'b'; view.rerender(<TopicReader />);
    await act(async () => a.resolve('old content'));
    expect(screen.queryByText('old content')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Topic B' })).toBeTruthy();
    await act(async () => b.resolve('new content'));
    expect(screen.getByText('new content')).toBeTruthy();
  });

  it('distinguishes loading from failure and can retry a missing file', async () => {
    mocks.readFile.mockRejectedValueOnce(new Error('missing')).mockResolvedValue('recovered');
    render(<TopicReader />);
    expect(screen.getByRole('status').textContent).toContain('正在读取');
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    expect(await screen.findByText('recovered')).toBeTruthy();
  });

  it('resets a failed snapshot and never leaves an old excerpt under a different citation', async () => {
    const second = deferred<string>();
    mocks.readRefs.mockResolvedValue([ref('c1', 's1'), ref('c2', 's2')]);
    mocks.readFile.mockImplementation((path: string) => path === 'a.md' ? Promise.resolve('claims [^c1] and [^c2]') : path.includes('s1') ? Promise.reject(new Error('missing')) : second.promise);
    render(<TopicReader />);
    fireEvent.click(await screen.findByRole('link', { name: '查看引用 c1 的来源依据' }));
    expect(await screen.findByText(/快照暂时无法读取/)).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: '查看引用 c2 的来源依据' }));
    expect(screen.queryByText(/快照暂时无法读取/)).toBeNull();
    expect(screen.getByText('正在读取引用时原文…')).toBeTruthy();
    await act(async () => second.resolve('second excerpt'));
    expect(await screen.findByText('second excerpt')).toBeTruthy();
  });

  it('omits only a matching leading H1 from the display and preserves different headings', async () => {
    mocks.readFile.mockResolvedValueOnce('# Topic A\n\nContent\n\n# Embedded heading');
    const view = render(<TopicReader />);
    await screen.findByText(/Content/);
    expect(screen.queryByText(/# Topic A/)).toBeNull();
    expect(screen.getByText(/# Embedded heading/)).toBeTruthy();
    mocks.state.activeTpId = 'b';
    mocks.readFile.mockResolvedValueOnce('# A different title\n\nDifferent content');
    view.rerender(<TopicReader />);
    expect(await screen.findByText(/# A different title/)).toBeTruthy();
  });

  it('offers actual topic selection from the overview', () => {
    mocks.state.activeTpId = null;
    render(<TopicReader />);
    fireEvent.click(screen.getByRole('button', { name: /Topic B/ }));
    expect(mocks.state.setActiveTopic).toHaveBeenCalledWith('b');
  });
  it('restores reading position and citation on returning to the same theme without leaking them to another', async () => {
    mocks.state.activeThemeId = 'reading-theme-a';
    mocks.readRefs.mockResolvedValue([ref('c1', 's1')]);
    mocks.readFile.mockImplementation((path: string) => path === 'a.md' ? Promise.resolve('Read [^c1]') : Promise.resolve('Source excerpt'));
    const view = render(<TopicReader />);
    fireEvent.click(await screen.findByRole('link', {name: '查看引用 c1 的来源依据'}));
    const scroller = screen.getByRole('article').parentElement!;
    fireEvent.scroll(scroller, {target: {scrollTop: 210}});
    mocks.state.activeThemeId = 'reading-theme-b'; view.rerender(<TopicReader />);
    await screen.findByRole('link', {name: '查看引用 c1 的来源依据'});
    expect(screen.queryByRole('complementary', {name: '来源依据'})).toBeNull();
    mocks.state.activeThemeId = 'reading-theme-a'; view.rerender(<TopicReader />);
    expect(await screen.findByRole('complementary', {name: '来源依据'})).toBeTruthy();
    expect(screen.getByRole('article').parentElement?.scrollTop).toBe(210);
  });

});

describe('TopicReader inline editing', () => {
  it('edits the raw file in place and saves the draft through the store', async () => {
    mocks.readFile.mockResolvedValue('---\nid: a\n---\n\nContent [^c1]');
    mocks.state.saveTopicPage.mockResolvedValue({ ok: true });
    render(<TopicReader />);
    fireEvent.click(await screen.findByRole('button', { name: /编辑知识页/ }));
    const editor = screen.getByRole('textbox', { name: '知识页原文（编辑后保存）' }) as HTMLTextAreaElement;
    // 编辑态展示磁盘原文（含 frontmatter），与阅读态剥离 H1 的展示不同。
    expect(editor.value).toContain('id: a');
    fireEvent.change(editor, { target: { value: '---\nid: a\n---\n\nEdited [^c1]' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存' })));
    expect(mocks.state.saveTopicPage).toHaveBeenCalledWith('a', '---\nid: a\n---\n\nEdited [^c1]');
    // 保存成功回阅读态；不经过编辑器跳转。
    expect(screen.queryByRole('textbox', { name: '知识页原文（编辑后保存）' })).toBeNull();
    const { openFile } = await import('@/services/editorIoService');
    expect(vi.mocked(openFile)).not.toHaveBeenCalled();
  });

  it('keeps the editor open with the error message when saving fails', async () => {
    mocks.readFile.mockResolvedValue('Content');
    mocks.state.saveTopicPage.mockResolvedValue({ ok: false, error: '保存失败：磁盘只读' });
    render(<TopicReader />);
    fireEvent.click(await screen.findByRole('button', { name: /编辑知识页/ }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存' })));
    expect(screen.getByRole('alert').textContent).toContain('保存失败：磁盘只读');
    expect(screen.getByRole('textbox', { name: '知识页原文（编辑后保存）' })).toBeTruthy();
  });

  it('cancel discards the draft without writing', async () => {
    mocks.readFile.mockResolvedValue('Content');
    render(<TopicReader />);
    fireEvent.click(await screen.findByRole('button', { name: /编辑知识页/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '知识页原文（编辑后保存）' }), { target: { value: 'Discarded' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(mocks.state.saveTopicPage).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: '知识页原文（编辑后保存）' })).toBeNull();
  });
});
