import { describe, it, expect, beforeEach } from 'vitest';
import { useSearchStore } from './searchStore';
import { useVaultStore } from './vaultStore';

beforeEach(() => {
  useSearchStore.setState({
    isOpen: false,
    query: '',
    caseSensitive: false,
    useRegex: false,
    results: [],
    isSearching: false,
    fileContentCache: new Map(),
  });
});

describe('useSearchStore panel + query + toggles', () => {
  it('opens and closes the panel', () => {
    useSearchStore.getState().openPanel();
    expect(useSearchStore.getState().isOpen).toBe(true);
    useSearchStore.getState().closePanel();
    expect(useSearchStore.getState().isOpen).toBe(false);
  });

  it('closePanel resets results and query', () => {
    useSearchStore.getState().setQuery('hello');
    useSearchStore.getState().openPanel();
    useSearchStore.getState().closePanel();
    expect(useSearchStore.getState().query).toBe('');
    expect(useSearchStore.getState().results).toEqual([]);
  });

  it('setQuery updates the query', () => {
    useSearchStore.getState().setQuery('needle');
    expect(useSearchStore.getState().query).toBe('needle');
  });

  it('toggles caseSensitive and useRegex', () => {
    useSearchStore.getState().toggleCaseSensitive();
    expect(useSearchStore.getState().caseSensitive).toBe(true);
    useSearchStore.getState().toggleUseRegex();
    expect(useSearchStore.getState().useRegex).toBe(true);
  });

  it('clearResults resets results', () => {
    useSearchStore.setState({ results: [{ filePath: 'a', fileName: 'a', lineNumber: 1, lineContent: 'x', matchStart: 0, matchEnd: 1 }] });
    useSearchStore.getState().clearResults();
    expect(useSearchStore.getState().results).toEqual([]);
  });

  it('clearCache empties the cache map', () => {
    const cache = new Map([['a', 'content']]);
    useSearchStore.setState({ fileContentCache: cache });
    useSearchStore.getState().clearCache();
    expect(useSearchStore.getState().fileContentCache.size).toBe(0);
  });
});

describe('useSearchStore.performSearch', () => {
  beforeEach(() => {
    // Set up a vault with two markdown files.
    useVaultStore.setState({
      currentVault: { id: 'v1', name: 'v1', basePath: '/mock/vault' } as never,
      fileTree: [
        { path: 'notes/a.md', name: 'a.md', type: 'file' },
        { path: 'notes/b.md', name: 'b.md', type: 'file' },
        { path: 'img/p.png', name: 'p.png', type: 'file' },
      ],
    });
    useVaultStore.setState({
      readFile: async (p: string) => {
        if (p === 'notes/a.md') return 'hello world\nneedle here';
        if (p === 'notes/b.md') return 'another line\nNEEDLE upper';
        throw new Error('not found');
      },
    } as never);
  });

  it('returns no results for an empty query', async () => {
    useSearchStore.getState().setQuery('   ');
    await useSearchStore.getState().performSearch();
    expect(useSearchStore.getState().results).toEqual([]);
    expect(useSearchStore.getState().isSearching).toBe(false);
  });

  it('finds case-insensitive matches across files', async () => {
    useSearchStore.getState().setQuery('needle');
    await useSearchStore.getState().performSearch();
    const results = useSearchStore.getState().results;
    expect(results.length).toBe(2);
    expect(results.map((r) => r.filePath).sort()).toEqual(['notes/a.md', 'notes/b.md']);
  });

  it('respects caseSensitive flag', async () => {
    useSearchStore.getState().setQuery('NEEDLE');
    useSearchStore.getState().toggleCaseSensitive();
    await useSearchStore.getState().performSearch();
    const paths = useSearchStore.getState().results.map((r) => r.filePath);
    expect(paths).toEqual(['notes/b.md']);
  });

  it('supports regex queries', async () => {
    useSearchStore.getState().setQuery('nee.*le');
    useSearchStore.getState().toggleUseRegex();
    await useSearchStore.getState().performSearch();
    expect(useSearchStore.getState().results.length).toBeGreaterThanOrEqual(1);
  });

  it('aborts on invalid regex without throwing', async () => {
    useSearchStore.getState().setQuery('(unclosed');
    useSearchStore.getState().toggleUseRegex();
    await useSearchStore.getState().performSearch();
    expect(useSearchStore.getState().results).toEqual([]);
    expect(useSearchStore.getState().isSearching).toBe(false);
  });

  it('records correct line number and match offsets', async () => {
    useSearchStore.getState().setQuery('needle');
    await useSearchStore.getState().performSearch();
    const aResult = useSearchStore.getState().results.find((r) => r.filePath === 'notes/a.md')!;
    expect(aResult.lineNumber).toBe(2);
    expect(aResult.matchStart).toBe(0);
    expect(aResult.matchEnd).toBe(6);
  });

  it('caches file contents across searches', async () => {
    useSearchStore.getState().setQuery('needle');
    await useSearchStore.getState().performSearch();
    expect(useSearchStore.getState().fileContentCache.has('notes/a.md')).toBe(true);
    // Mutate readFile to ensure cache is used.
    useVaultStore.setState({ readFile: async () => 'should not be called' } as never);
    useSearchStore.getState().setQuery('hello');
    await useSearchStore.getState().performSearch();
    const hit = useSearchStore.getState().results.find((r) => r.filePath === 'notes/a.md');
    expect(hit?.lineContent).toBe('hello world');
  });
});
