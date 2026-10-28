// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fixture = vi.hoisted(() => ({
  vault: {activeVaultId: 'vault-a', currentVault: null, fileTree: []},
  state: {loaded: true, themes: [{id: 'a', name: 'Engineering'}], activeThemeId: 'a' as string | null, goal: 'Learn systems', page: 'knowledge', reviews: [], scope: [] as string[], buildRunning: false, buildItems: [], cancelBuild: false, sourceEntry: 'closed', buildError: '', loadFromManifest: vi.fn(), createTheme: vi.fn(), setPage: vi.fn(), build: vi.fn(), cancelBuildRequested: vi.fn(), openSourceSettings: vi.fn()},
}));
vi.mock('@/store/vaultStore', () => ({useVaultStore: Object.assign((select: (state: typeof fixture.vault) => unknown) => select(fixture.vault), {getState: () => fixture.vault})}));
vi.mock('@/store/knowledgeStore', () => ({useKnowledgeStore: Object.assign((select: (state: typeof fixture.state) => unknown) => select(fixture.state), {getState: () => fixture.state})}));
vi.mock('@/services/knowledge/knowledgeBuild', () => ({expandScope: () => [], isSupportedSourcePath: () => true}));
vi.mock('./TopicReader', () => ({TopicReader: () => <p>Knowledge content</p>}));
vi.mock('./AskView', () => ({AskView: () => <p>Ask content</p>}));
vi.mock('./SourcesView', () => ({SourcesView: () => <input aria-label="Preserved source draft" defaultValue="" />}));
vi.mock('./ReviewsView', () => ({ReviewsView: () => <p>Review content</p>}));
import { SetupView } from './SetupView';
import { ThemeDialog } from './ThemeDialog';
import { KnowledgeWorkbench } from './KnowledgeWorkbench';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { useThemeUiStore } from './themeUiStore';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
beforeEach(() => {
  fixture.vault.activeVaultId = 'vault-a';
  fixture.state.activeThemeId = 'a'; fixture.state.page = 'knowledge'; fixture.state.sourceEntry = 'closed'; fixture.state.buildRunning = false;
  useAiConfigStore.setState({kbPair: null, providerSettings: {}, customerProviders: {}});
  fixture.state.createTheme.mockReset().mockResolvedValue({ok: true});
  fixture.state.setPage.mockReset();
  fixture.state.buildError = ''; fixture.state.loadFromManifest.mockReset().mockResolvedValue(undefined);
  useThemeUiStore.setState({createOpen: false});
});
afterEach(cleanup);

function fillTheme() {
  fireEvent.change(screen.getByRole('textbox', {name: '主题名称'}), {target: {value: 'Distributed systems'}});
  fireEvent.change(screen.getByRole('textbox', {name: '整理目标'}), {target: {value: 'Understand consensus'}});
}

describe('theme workspace interaction', () => {
  it('keeps the reading workspace header free of the model selector (intake form is the only entry)', () => {
    useAiConfigStore.setState({providerSettings: {openai: {id: 'openai', enabled: true, selectedModelIds: ['gpt-fixture'], baseUrl: '', apiKey: '', extra: {}}}});
    render(<KnowledgeWorkbench />);
    expect(screen.queryByTestId('pair-selector')).toBeNull();
    expect(screen.queryByRole('group', {name: '整理模型'})).toBeNull();
  });

  it('shows a registry read failure and offers a real retry instead of silently appearing empty', async () => {
    fixture.state.buildError = '读取知识主题失败：目录损坏'; render(<SetupView />);
    expect(screen.getByRole('alert').textContent).toContain('目录损坏');
    fireEvent.click(screen.getByRole('button', {name: '重新读取主题'}));
    await waitFor(() => expect(fixture.state.loadFromManifest).toHaveBeenCalledOnce());
  });
  it('creates a named independent theme with its own goal and source selection', async () => {
    useThemeUiStore.setState({createOpen: true}); render(<ThemeDialog />); fillTheme();
    fireEvent.click(screen.getByRole('button', {name: '创建主题'}));
    await waitFor(() => expect(fixture.state.createTheme).toHaveBeenCalledWith({name: 'Distributed systems', goal: 'Understand consensus', scope: [], language: 'auto'}));
    expect(useThemeUiStore.getState().createOpen).toBe(false);
  });
  it('cancel discards new-theme edits without changing configured themes', () => {
    useThemeUiStore.setState({createOpen: true}); render(<ThemeDialog />); fillTheme();
    fireEvent.click(screen.getByRole('button', {name: '取消'}));
    expect(fixture.state.createTheme).not.toHaveBeenCalled();
    act(() => useThemeUiStore.setState({createOpen: true}));
    expect((screen.getByRole('textbox', {name: '主题名称'}) as HTMLInputElement).value).toBe('');
  });
  it('retains entered theme configuration when creation fails', async () => {
    fixture.state.createTheme.mockResolvedValue({ok: false, error: 'Write failed'});
    useThemeUiStore.setState({createOpen: true}); render(<ThemeDialog />); fillTheme();
    fireEvent.click(screen.getByRole('button', {name: '创建主题'}));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Write failed');
    expect((screen.getByRole('textbox', {name: '主题名称'}) as HTMLInputElement).value).toBe('Distributed systems');
  });
  it('closes the new-theme draft on a Vault switch instead of carrying selected paths to another Vault', () => {
    useThemeUiStore.setState({createOpen: true}); const view = render(<ThemeDialog />); fillTheme();
    fixture.vault.activeVaultId = 'vault-b'; view.rerender(<ThemeDialog />);
    expect(useThemeUiStore.getState().createOpen).toBe(false);
  });
  it('keeps the source page mounted across local page switches', () => {
    const view = render(<KnowledgeWorkbench />);
    fixture.state.page = 'sources'; view.rerender(<KnowledgeWorkbench />);
    fireEvent.change(screen.getByRole('textbox', {name: 'Preserved source draft'}), {target: {value: 'Unfinished choice'}});
    fixture.state.page = 'knowledge'; view.rerender(<KnowledgeWorkbench />);
    fixture.state.page = 'sources'; view.rerender(<KnowledgeWorkbench />);
    expect((screen.getByRole('textbox', {name: 'Preserved source draft'}) as HTMLInputElement).value).toBe('Unfinished choice');
    expect(screen.getByRole('heading', {name: 'Engineering'})).toBeTruthy();
  });
});
