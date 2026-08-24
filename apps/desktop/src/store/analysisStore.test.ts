import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAnalysisStore } from './analysisStore';
import { useVaultStore } from './vaultStore';
import type { VaultEntry } from '@mochi/vault-provider';
import type { GeneratedReport } from '@/services/githubAnalysisService';

// Stub the GitHub analysis service so no real AI / network runs.
vi.mock('@/services/githubAnalysisService', () => ({
  analyzeProject: vi.fn(),
  generateReport: vi.fn(),
  saveReport: vi.fn(),
  parseGitHubUrl: vi.fn(),
}));

import {
  analyzeProject,
  generateReport,
  saveReport,
} from '@/services/githubAnalysisService';

/** A fake vault store slice covering the methods analysisStore uses. */
interface FakeVault {
  manager: {
    listFiles: ReturnType<typeof vi.fn>;
  };
  readFile: ReturnType<typeof vi.fn>;
  createFile: ReturnType<typeof vi.fn>;
  deleteFile: ReturnType<typeof vi.fn>;
}

function installFakeVault(overrides: Partial<FakeVault> = {}): FakeVault {
  const vault: FakeVault = {
    manager: { listFiles: vi.fn(async () => [] as VaultEntry[]) },
    readFile: vi.fn(async () => {
      throw new Error('not found');
    }),
    createFile: vi.fn(async () => {}),
    deleteFile: vi.fn(async () => {}),
    ...overrides,
  };
  useVaultStore.setState(vault as never);
  return vault;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAnalysisStore.setState({
    reports: [],
    isLoading: false,
    isAnalyzing: false,
    error: null,
    analysisProgress: '',
    aiStreamText: '',
    aiStreamEvents: [],
    pendingReport: null,
    pendingOverwritePath: null,
  });
});

describe('useAnalysisStore initial state', () => {
  it('starts empty and idle', () => {
    const s = useAnalysisStore.getState();
    expect(s.reports).toEqual([]);
    expect(s.isLoading).toBe(false);
    expect(s.isAnalyzing).toBe(false);
    expect(s.pendingReport).toBeNull();
    expect(s.error).toBeNull();
  });
});

describe('useAnalysisStore.loadReports', () => {
  it('lists HTML reports under __reports__ and reads sidecar tags', async () => {
    const entries: VaultEntry[] = [
      { path: '__reports__/2026-06-13-my-repo.html', name: '2026-06-13-my-repo.html', type: 'file' },
      { path: '__reports__/2026-06-14-other.html', name: '2026-06-14-other.html', type: 'file' },
      { path: '__reports__/not-html.txt', name: 'not-html.txt', type: 'file' },
    ];
    const vault = installFakeVault({
      manager: { listFiles: vi.fn(async () => entries) },
      readFile: vi.fn(async (p: string) => {
        if (p.endsWith('.tags.json')) return JSON.stringify({ tags: ['React', 'typescript'] });
        throw new Error('no file');
      }),
    });

    await useAnalysisStore.getState().loadReports();

    expect(vault.manager.listFiles).toHaveBeenCalledWith('__reports__', true, false);
    const reports = useAnalysisStore.getState().reports;
    // Only .html files, sorted by name desc.
    expect(reports.map((r) => r.name)).toEqual(['2026-06-14-other.html', '2026-06-13-my-repo.html']);
    // Tags are lowercased + trimmed.
    expect(reports[1].tags).toEqual(['react', 'typescript']);
    expect(useAnalysisStore.getState().isLoading).toBe(false);
  });

  it('assigns an empty tag list when the sidecar is missing', async () => {
    installFakeVault({
      manager: { listFiles: vi.fn(async () => [{ path: '__reports__/r.html', name: 'r.html', type: 'file' }]) },
      readFile: vi.fn(async () => {
        throw new Error('no sidecar');
      }),
    });
    await useAnalysisStore.getState().loadReports();
    expect(useAnalysisStore.getState().reports[0].tags).toEqual([]);
  });

  it('degrades gracefully (empty list, no error) when listFiles throws', async () => {
    installFakeVault({
      manager: { listFiles: vi.fn(async () => {
        throw new Error('fs down');
      }) },
    });
    await useAnalysisStore.getState().loadReports();
    // listFiles failure is caught via .catch(() => []) — no error surfaced.
    expect(useAnalysisStore.getState().error).toBeNull();
    expect(useAnalysisStore.getState().reports).toEqual([]);
  });

  it('is a no-op when already loading', async () => {
    useAnalysisStore.setState({ isLoading: true });
    const vault = installFakeVault();
    await useAnalysisStore.getState().loadReports();
    expect(vault.manager.listFiles).not.toHaveBeenCalled();
  });
});

describe('useAnalysisStore.startAnalysis', () => {
  it('streams progress + text chunks and returns the saved path', async () => {
    installFakeVault();
    vi.mocked(analyzeProject).mockImplementationOnce(
      async (_url, _lang, onProgress, onChunk, onEvent) => {
        onProgress('fetching');
        onChunk('partial');
        onEvent({ type: 'text', content: 'partial' });
        return '__reports__/report.html';
      },
    );

    const path = await useAnalysisStore.getState().startAnalysis('https://github.com/a/b', 'en');
    expect(path).toBe('__reports__/report.html');
    // During the run, progress + stream text were captured; after the run they reset.
    expect(useAnalysisStore.getState().analysisProgress).toBe('');
    expect(useAnalysisStore.getState().aiStreamText).toBe('');
    expect(useAnalysisStore.getState().isAnalyzing).toBe(false);
    // loadReports is called at the end.
    expect(useVaultStore.getState().manager.listFiles).toHaveBeenCalled();
  });

  it('rethrows and records an error when analyzeProject fails', async () => {
    installFakeVault();
    vi.mocked(analyzeProject).mockRejectedValueOnce(new Error('AI boom'));
    await expect(useAnalysisStore.getState().startAnalysis('https://github.com/a/b', 'en')).rejects.toThrow('AI boom');
    expect(useAnalysisStore.getState().error).toBe('AI boom');
    expect(useAnalysisStore.getState().isAnalyzing).toBe(false);
  });

  it('rejects a second concurrent analysis', async () => {
    useAnalysisStore.setState({ isAnalyzing: true });
    await expect(
      useAnalysisStore.getState().startAnalysis('https://github.com/a/b', 'en'),
    ).rejects.toThrow('分析正在进行中');
  });
});

describe('useAnalysisStore.generateAnalysis + confirmAnalysis', () => {
  const report: GeneratedReport = { tags: ['React'], html: '<html/>', repo: 'b' };

  it('generateAnalysis stores a pending report from the generated result', async () => {
    installFakeVault();
    vi.mocked(generateReport).mockResolvedValueOnce(report);

    await useAnalysisStore.getState().generateAnalysis('https://github.com/a/b', 'en');

    const pending = useAnalysisStore.getState().pendingReport;
    expect(pending).not.toBeNull();
    expect(pending!.repo).toBe('b');
    expect(pending!.html).toBe('<html/>');
    expect(pending!.url).toBe('https://github.com/a/b');
    expect(pending!.language).toBe('en');
    expect(useAnalysisStore.getState().isAnalyzing).toBe(false);
  });

  it('generateAnalysis records and rethrows errors', async () => {
    installFakeVault();
    vi.mocked(generateReport).mockRejectedValueOnce(new Error('nope'));
    await expect(useAnalysisStore.getState().generateAnalysis('https://github.com/a/b', 'en')).rejects.toThrow('nope');
    expect(useAnalysisStore.getState().error).toBe('nope');
    expect(useAnalysisStore.getState().pendingReport).toBeNull();
  });

  it('confirmAnalysis saves the report with normalized tags and clears pending', async () => {
    const vault = installFakeVault();
    useAnalysisStore.setState({
      pendingReport: { tags: ['React'], html: '<html/>', repo: 'b', url: 'https://github.com/a/b', language: 'en' },
    });
    vi.mocked(saveReport).mockResolvedValueOnce('__reports__/b.html');

    const path = await useAnalysisStore.getState().confirmAnalysis([' React ', 'TypeScript']);
    expect(path).toBe('__reports__/b.html');
    expect(saveReport).toHaveBeenCalledWith('b', ['react', 'typescript'], '<html/>');
    expect(useAnalysisStore.getState().pendingReport).toBeNull();
    expect(useAnalysisStore.getState().isAnalyzing).toBe(false);
    // loadReports re-ran after saving.
    expect(vault.manager.listFiles).toHaveBeenCalled();
  });

  it('confirmAnalysis deletes the old report when pendingOverwritePath is set', async () => {
    const vault = installFakeVault();
    useAnalysisStore.setState({
      pendingReport: { tags: ['x'], html: '<html/>', repo: 'b', url: 'u', language: 'en' },
      pendingOverwritePath: '__reports__/old.html',
    });
    vi.mocked(saveReport).mockResolvedValueOnce('__reports__/b.html');

    await useAnalysisStore.getState().confirmAnalysis(['x']);

    expect(vault.deleteFile).toHaveBeenCalledWith('__reports__/old.html');
    expect(vault.deleteFile).toHaveBeenCalledWith('__reports__/old.tags.json');
    expect(useAnalysisStore.getState().pendingOverwritePath).toBeNull();
  });

  it('confirmAnalysis throws when no report is pending', async () => {
    await expect(useAnalysisStore.getState().confirmAnalysis(['x'])).rejects.toThrow('没有待确认的报告');
  });
});

describe('useAnalysisStore.cancelAnalysis + setPendingOverwritePath', () => {
  it('cancelAnalysis clears pending report and error state', () => {
    useAnalysisStore.setState({
      pendingReport: { tags: [], html: '', repo: '', url: '', language: 'en' },
      error: 'old',
      analysisProgress: 'step',
      aiStreamText: 'partial',
    });
    useAnalysisStore.getState().cancelAnalysis();
    const s = useAnalysisStore.getState();
    expect(s.pendingReport).toBeNull();
    expect(s.error).toBeNull();
    expect(s.analysisProgress).toBe('');
    expect(s.aiStreamText).toBe('');
  });

  it('setPendingOverwritePath stores the path', () => {
    useAnalysisStore.getState().setPendingOverwritePath('__reports__/old.html');
    expect(useAnalysisStore.getState().pendingOverwritePath).toBe('__reports__/old.html');
  });
});

describe('useAnalysisStore.deleteReport', () => {
  it('deletes the HTML and sidecar then reloads', async () => {
    const vault = installFakeVault({
      manager: { listFiles: vi.fn(async () => []) },
    });
    await useAnalysisStore.getState().deleteReport('__reports__/r.html');
    expect(vault.deleteFile).toHaveBeenCalledWith('__reports__/r.html');
    expect(vault.deleteFile).toHaveBeenCalledWith('__reports__/r.tags.json');
    expect(vault.manager.listFiles).toHaveBeenCalled();
  });

  it('records an error when deleteFile throws', async () => {
    installFakeVault({
      deleteFile: vi.fn(async () => {
        throw new Error('locked');
      }),
      manager: { listFiles: vi.fn(async () => []) },
    });
    await useAnalysisStore.getState().deleteReport('__reports__/r.html');
    expect(useAnalysisStore.getState().error).toBe('locked');
  });
});

describe('useAnalysisStore tag queries', () => {
  beforeEach(() => {
    useAnalysisStore.setState({
      reports: [
        { path: 'a.html', name: '2026-01-01-react.html', tags: ['react', 'typescript'] },
        { path: 'b.html', name: '2026-01-02-vue.html', tags: ['vue', 'typescript'] },
      ],
    });
  });

  it('getAllTags returns the deduplicated, sorted union', () => {
    expect(useAnalysisStore.getState().getAllTags()).toEqual(['react', 'typescript', 'vue']);
  });

  it('getReportsByTag filters reports containing the tag', () => {
    const matches = useAnalysisStore.getState().getReportsByTag('typescript');
    expect(matches.map((r) => r.path).sort()).toEqual(['a.html', 'b.html']);
  });

  it('findExistingReport matches by parsed repo name (case-insensitive)', () => {
    expect(useAnalysisStore.getState().findExistingReport('React')?.path).toBe('a.html');
    expect(useAnalysisStore.getState().findExistingReport('unknown')).toBeUndefined();
  });
});

describe('useAnalysisStore.saveTags / removeTag', () => {
  it('saveTags writes the sidecar and reloads', async () => {
    const vault = installFakeVault({
      manager: { listFiles: vi.fn(async () => []) },
    });
    await useAnalysisStore.getState().saveTags('a.html', ['React', ' TS ']);
    expect(vault.createFile).toHaveBeenCalledWith('a.tags.json', JSON.stringify({ tags: ['react', 'ts'] }, null, 2));
    expect(vault.manager.listFiles).toHaveBeenCalled();
  });

  it('saveTags with no tags deletes the sidecar', async () => {
    const vault = installFakeVault({
      manager: { listFiles: vi.fn(async () => []) },
    });
    await useAnalysisStore.getState().saveTags('a.html', []);
    expect(vault.deleteFile).toHaveBeenCalledWith('a.tags.json');
  });

  it('removeTag updates the sidecar when tags remain', async () => {
    const vault = installFakeVault({
      manager: { listFiles: vi.fn(async () => []) },
    });
    useAnalysisStore.setState({
      reports: [{ path: 'a.html', name: 'a.html', tags: ['react', 'ts'] }],
    });
    await useAnalysisStore.getState().removeTag('a.html', 'react');
    expect(vault.createFile).toHaveBeenCalledWith('a.tags.json', JSON.stringify({ tags: ['ts'] }, null, 2));
  });

  it('removeTag deletes the report entirely when no tags remain', async () => {
    const vault = installFakeVault({
      manager: { listFiles: vi.fn(async () => []) },
    });
    useAnalysisStore.setState({
      reports: [{ path: 'a.html', name: 'a.html', tags: ['react'] }],
    });
    await useAnalysisStore.getState().removeTag('a.html', 'react');
    expect(vault.deleteFile).toHaveBeenCalledWith('a.html');
    expect(vault.deleteFile).toHaveBeenCalledWith('a.tags.json');
  });
});
