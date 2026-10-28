// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const data = vi.hoisted(() => ({
  vault: { activeVaultId: 'vault-a', fileTree: [{ path: 'docs', name: 'docs', type: 'dir', children: [{ path: 'docs/a.md', name: 'a.md', type: 'file' }] }] },
  ai: { providerSettings: {} as Record<string, {id:string;enabled:boolean;selectedModelIds:string[];baseUrl:string;apiKey:string;extra:Record<string,unknown>}>, customerProviders: {}, kbPair: null, kbAutoBuild: false, setKbPair: vi.fn(), setKbAutoBuild: vi.fn() },
  write: vi.fn(), read: vi.fn(), build: vi.fn(), fsWrite: vi.fn(), fsRename: vi.fn(),
}));
vi.mock('@/store/vaultStore', () => ({ useVaultStore: Object.assign((selector: (s: typeof data.vault) => unknown) => selector(data.vault), { getState: () => data.vault }) }));
vi.mock('@/store/aiConfigStore', () => ({ useAiConfigStore: Object.assign((selector: (s: typeof data.ai) => unknown) => selector(data.ai), { getState: () => data.ai }) }));
vi.mock('@/store/editorStore', () => ({ useEditorStore: { getState: () => ({ setActivePanel: vi.fn() }) } }));
vi.mock('@/services/editorIoService', () => ({ openFile: vi.fn() }));
vi.mock('@/store/modelRegistryStore', () => ({useModelRegistryStore: (selector: (state: {modelsByProvider: Record<string, never[]>}) => unknown) => selector({modelsByProvider: {}})}));
vi.mock('@/components/settings/primitives', () => ({ Toggle: ({value, onChange}: {value: boolean; onChange: (value: boolean) => void}) => <div role="switch" aria-checked={value} onClick={() => onChange(!value)} /> }));
vi.mock('@/services/knowledge/kbFs', () => ({ vaultKbFs: () => ({ writeFile: data.fsWrite, rename: data.fsRename, exists: async () => true, readFile: async () => '' }), readManifest: data.read, writeManifest: data.write, readReviews: async () => [], readNavigation: async () => ({ topics: [] }), readTopicRefs: async () => [] }));
vi.mock('@/services/knowledge/kbThemes', () => ({
  themeKbFs: (_vault: string, id: string) => ({root: `__kb__/themes/${id}`, writeFile: data.fsWrite, rename: data.fsRename, exists: async () => true, readFile: async () => ''}),
  readThemeRegistry: async () => ({themes: [{id: 'theme-a', name: 'Existing theme'}], activeThemeId: 'theme-a'}),
  updateThemeRegistry: async (_vault: string, update: (registry: {themes: {id:string;name:string}[];activeThemeId:string}) => void) => { const registry = {themes: [{id: useKnowledgeStore.getState().activeThemeId ?? 'theme-a', name: 'Existing theme'}], activeThemeId: 'theme-a'}; update(registry); return registry; },
}));
vi.mock('@/services/knowledge/knowledgeBuild', () => ({ buildKnowledge: data.build, isSupportedSourcePath: (p: string) => p.endsWith('.md'), expandScope: (scope: string[], rows: {path: string; type: string}[]) => rows.filter((r) => r.type === 'file' && scope.some((p) => p === r.path || r.path.startsWith(`${p}/`))).map((r) => r.path) }));
vi.mock('@/services/knowledge/kbAsk', () => ({ askKnowledge: vi.fn(), invalidateKbIndexCache: vi.fn() }));
vi.mock('@/services/knowledge/kbReviewActions', () => ({ applyReview: vi.fn(), discardReview: vi.fn() }));
vi.mock('@/services/knowledge/kbVerify', () => ({ verifyTopicRef: vi.fn() }));
import { useKnowledgeStore } from '@/store/knowledgeStore';
import { SourcesView } from './SourcesView';
import { ScopePicker } from './ScopePicker';
import { useNavStore } from '@/store/navStore';

let fixtureId = 0;
beforeEach(() => {
  data.vault.activeVaultId = 'vault-a';
  data.ai.providerSettings = {}; data.ai.setKbPair.mockClear();
  useNavStore.setState({currentPage: 'editor', settingsTab: 'appearance'});
  data.read.mockReset().mockResolvedValue({ goal: 'Existing goal', scope: [], topics: {}, sources: {} });
  data.write.mockReset().mockResolvedValue(undefined);
  data.fsWrite.mockReset().mockResolvedValue(undefined); data.fsRename.mockReset().mockResolvedValue(undefined);
  data.build.mockReset().mockResolvedValue(undefined);
  useKnowledgeStore.setState({ contextVaultId: 'vault-a', activeThemeId: `theme-${++fixtureId}`, themes: [{id: `theme-${fixtureId}`, name: 'Existing theme'}], mutationRunning: false, goal: 'Existing goal', scope: [], sources: {}, topics: [], navigation: [], reviews: [], sourceEntry: 'closed', buildRunning: false, buildItems: [], buildError: '', cancelBuild: false });
});
afterEach(cleanup);

describe('Source ingestion transactions', () => {
  it('offers a real model picker during source intake and commits it only after saving', async () => {
    data.ai.providerSettings = {openai: {id: 'openai', enabled: true, selectedModelIds: ['gpt-fixture'], baseUrl: '', apiKey: '', extra: {}}};
    render(<SourcesView />);
    fireEvent.click(screen.getByRole('button', {name: '添加资料'}));
    fireEvent.click(screen.getByTestId('pair-selector'));
    fireEvent.mouseDown(screen.getByRole('option', {name: /gpt-fixture/}));
    expect(data.ai.setKbPair).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: '仅保存'}));
    await waitFor(() => expect(data.ai.setKbPair).toHaveBeenCalledWith({provider: 'openai', model: 'gpt-fixture'}));
  });

  it('does not commit a selected model when source configuration fails to save', async () => {
    data.ai.providerSettings = {openai: {id: 'openai', enabled: true, selectedModelIds: ['gpt-fixture'], baseUrl: '', apiKey: '', extra: {}}};
    data.write.mockRejectedValue(new Error('disk full'));
    render(<SourcesView />);
    fireEvent.click(screen.getByRole('button', {name: '添加资料'}));
    fireEvent.click(screen.getByTestId('pair-selector'));
    fireEvent.mouseDown(screen.getByRole('option', {name: /gpt-fixture/}));
    fireEvent.click(screen.getByRole('button', {name: '仅保存'}));
    await screen.findByRole('alert');
    expect(data.ai.setKbPair).not.toHaveBeenCalled();
    expect(screen.getByTestId('pair-selector').textContent).toContain('gpt-fixture');
  });

  it('discards a model choice when source intake is canceled', () => {
    data.ai.providerSettings = {openai: {id: 'openai', enabled: true, selectedModelIds: ['gpt-fixture'], baseUrl: '', apiKey: '', extra: {}}};
    render(<SourcesView />);
    fireEvent.click(screen.getByRole('button', {name: '添加资料'}));
    fireEvent.click(screen.getByTestId('pair-selector'));
    fireEvent.mouseDown(screen.getByRole('option', {name: /gpt-fixture/}));
    fireEvent.click(screen.getByRole('button', {name: '取消'}));
    expect(data.ai.setKbPair).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: '添加资料'}));
    expect(screen.getByTestId('pair-selector').textContent).not.toContain('gpt-fixture');
  });

  it('opens model service settings when no provider/model is available', () => {
    useKnowledgeStore.getState().openSourceSettings('settings');
    render(<SourcesView />);
    fireEvent.click(screen.getByRole('button', {name: '前往模型设置'}));
    expect(useNavStore.getState().currentPage).toBe('settings');
    expect(useNavStore.getState().settingsTab).toBe('models');
  });

  it('deep-links directly to settings and keeps goal and scope as cancelable drafts', () => {
    useKnowledgeStore.getState().openSourceSettings('settings');
    render(<SourcesView />);
    fireEvent.change(screen.getByRole('textbox', { name: '整理目标' }), { target: { value: 'Draft goal' } });
    fireEvent.click(screen.getByRole('button', { name: '选择文件 / 目录' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /docs/ }));
    expect(useKnowledgeStore.getState().goal).toBe('Existing goal');
    expect(useKnowledgeStore.getState().scope).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '主题设置' }));
    expect((screen.getByRole('textbox', { name: '整理目标' }) as HTMLTextAreaElement).value).toBe('Existing goal');
    fireEvent.click(screen.getByRole('button', { name: '选择文件 / 目录' }));
    expect((screen.getByRole('checkbox', { name: /docs/ }) as HTMLInputElement).checked).toBe(false);
  });

  it('Add sources opens the searchable chooser and makes inherited child selection explicit', () => {
    render(<SourcesView />);
    fireEvent.click(screen.getByRole('button', { name: '添加资料' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /docs/ }));
    const child = screen.getByRole('checkbox', { name: /a.md/ }) as HTMLInputElement;
    expect(child.checked).toBe(true);
    expect(child.disabled).toBe(true);
    expect(screen.getByText(/将收录 1 份资料/)).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索文件或目录' }), { target: { value: 'a.md' } });
    expect(screen.queryByRole('checkbox', { name: /docs/ })).toBeNull();
    expect(screen.getByRole('checkbox', { name: /a.md/ })).toBeTruthy();
  });

  it('failed Save and organize stays open with drafts and never starts processing', async () => {
    data.write.mockRejectedValue(new Error('disk full'));
    render(<SourcesView />);
    fireEvent.click(screen.getByRole('button', { name: '添加资料' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /docs/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存并整理' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('region', { name: '添加资料' })).toBeTruthy();
    expect(useKnowledgeStore.getState().scope).toEqual([]);
    expect(data.build).not.toHaveBeenCalled();
  });

  it('Save only commits configuration without starting processing', async () => {
    render(<SourcesView />);
    fireEvent.click(screen.getByRole('button', { name: '添加资料' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /docs/ }));
    fireEvent.click(screen.getByRole('button', { name: '仅保存' }));
    await waitFor(() => expect(useKnowledgeStore.getState().scope).toEqual(['docs']));
    expect(data.build).not.toHaveBeenCalled();
    expect(screen.getByText(/此次保存未启动整理/)).toBeTruthy();
  });

  it('Save and organize launches real processing after successful configuration save', async () => {
    render(<SourcesView />);
    fireEvent.click(screen.getByRole('button', { name: '添加资料' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /docs/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存并整理' }));
    await waitFor(() => expect(data.build).toHaveBeenCalledTimes(1));
    expect(data.write).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('本次处理已结束，请查看下方结果。')).toBeTruthy();
    expect(screen.queryByText('收录范围已保存，开始整理资料。')).toBeNull();
  });


  it('expands folders separately from selection, including inherited folders and search', () => {
    const onChange = vi.fn();
    const rows = [
      {path: 'docs', name: 'docs', type: 'dir' as const, depth: 0},
      {path: 'docs/nested', name: 'nested', type: 'dir' as const, depth: 1},
      {path: 'docs/nested/note.md', name: 'note.md', type: 'file' as const, depth: 2},
    ];
    const view = render(<ScopePicker rows={rows} scope={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', {name: /docs/}));
    expect(screen.queryByText('nested')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: /docs/}));
    expect(screen.getByText('note.md')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', {name: /docs/}));
    expect(onChange).toHaveBeenCalledWith(['docs']);
    view.rerender(<ScopePicker rows={rows} scope={['docs']} onChange={onChange} />);
    expect((screen.getByRole('checkbox', {name: /nested/}) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', {name: /nested/}));
    expect(screen.queryByText('note.md')).toBeNull();
    fireEvent.change(screen.getByRole('searchbox', {name: '搜索文件或目录'}), {target: {value: 'note.md'}});
    expect(screen.getByText('note.md')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', {name: '搜索文件或目录'}), {target: {value: ''}});
    expect(screen.queryByText('note.md')).toBeNull();
  });

  it('nested directories inherit selection while unsupported child files remain excluded', () => {
    render(<ScopePicker rows={[{path: 'docs', name: 'docs', type: 'dir', depth: 0}, {path: 'docs/nested', name: 'nested', type: 'dir', depth: 1}, {path: 'docs/image.png', name: 'image.png', type: 'file', depth: 1}]} scope={['docs']} onChange={vi.fn()} />);
    const nested = screen.getByRole('checkbox', { name: /nested/ }) as HTMLInputElement;
    const image = screen.getByRole('checkbox', { name: /image.png/ }) as HTMLInputElement;
    expect(nested.checked).toBe(true); expect(nested.disabled).toBe(true);
    expect(image.checked).toBe(false); expect(image.disabled).toBe(true);
    expect(screen.getByText('暂不支持')).toBeTruthy();
  });

  it('excludes stopped sources from the processing preview and action', () => {
    useKnowledgeStore.setState({ scope: ['docs'], sources: { s1: { path: 'docs/a.md', currentHash: 'hash', removed: true } } });
    render(<SourcesView />);
    fireEvent.click(screen.getByRole('button', { name: '添加资料' }));
    expect(screen.getByText(/其中 1 份已停止跟踪，不参与整理/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '保存并整理' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('provides actual associated topic links after processing instead of claiming changed pages', () => {
    useKnowledgeStore.setState({ sources: {s1: { path: 'docs/a.md', currentHash: 'hash' }}, topics: [{tpId: 't1', title: 'Result topic', path: 'topic.md'}], navigation: [{tpId: 't1', title: 'Result topic', sourceIds: ['s1']}], buildItems: [{path: 'docs/a.md', status: 'done'}] });
    render(<SourcesView />);
    expect(screen.getByText('本次已处理资料关联的知识页')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Result topic →' }));
    expect(useKnowledgeStore.getState().activeTpId).toBe('t1');
    expect(useKnowledgeStore.getState().page).toBe('knowledge');
  });

  it('locks every draft control while saving, including model and automatic processing settings', async () => {
    let finish!: () => void;
    data.write.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    useKnowledgeStore.getState().openSourceSettings('settings');
    render(<SourcesView />);
    fireEvent.click(screen.getByRole('button', { name: '仅保存' }));
    const fieldset = screen.getByRole('textbox', { name: '整理目标' }).closest('fieldset');
    expect(fieldset?.disabled).toBe(true);
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
    finish();
    await waitFor(() => expect(screen.queryByRole('region', { name: '主题设置' })).toBeNull());
  });

  it('links source-specific pending review counts to the real review page', () => {
    useKnowledgeStore.setState({ scope: ['docs'], sources: {s1: {path: 'docs/a.md', currentHash: 'hash'}}, reviews: [{id: 'r1', topicId: 't1', topicPath: 'topic.md', topicHash: 'hash', reason: 'user-edited', status: 'pending', createdAt: 1, proposedMarkdown: 'Change', refs: [{id: 'c1', srcId: 's1', topicId: 't1', versionHash: 'hash', startLine: 1, endLine: 1, anchorText: 'Claim', status: 'active'}]}] });
    render(<SourcesView />);
    fireEvent.click(screen.getByRole('button', { name: '前往审阅 · 1 项涉及此资料' }));
    expect(useKnowledgeStore.getState().page).toBe('reviews');
  });

  it('does not start processing another theme when a pending save finishes after switching', async () => {
    let finish!: () => void;
    data.write.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    render(<SourcesView />);
    fireEvent.click(screen.getByRole('button', {name: '添加资料'}));
    fireEvent.click(screen.getByRole('checkbox', {name: /docs/}));
    fireEvent.click(screen.getByRole('button', {name: '保存并整理'}));
    useKnowledgeStore.setState({activeThemeId: 'other-theme', sourceEntry: 'closed', mutationRunning: false});
    finish();
    await waitFor(() => expect((screen.getByRole('button', {name: '添加资料'}) as HTMLButtonElement).disabled).toBe(false));
    expect(data.build).not.toHaveBeenCalled();
  });
  it('restores unfinished source configuration after a theme round trip', () => {
    const originalTheme = useKnowledgeStore.getState().activeThemeId;
    useKnowledgeStore.getState().openSourceSettings('settings');
    const view = render(<SourcesView key={originalTheme} />);
    fireEvent.change(screen.getByRole('textbox', {name: '整理目标'}), {target: {value: 'Unfinished goal'}});
    act(() => { useKnowledgeStore.setState({activeThemeId: 'another-theme', sourceEntry: 'closed', goal: 'Another goal'}); view.rerender(<SourcesView key="another-theme" />); });
    act(() => { useKnowledgeStore.setState({activeThemeId: originalTheme, sourceEntry: 'settings', goal: 'Existing goal'}); view.rerender(<SourcesView key={originalTheme} />); });
    expect((screen.getByRole('textbox', {name: '整理目标'}) as HTMLTextAreaElement).value).toBe('Unfinished goal');
  });

});
