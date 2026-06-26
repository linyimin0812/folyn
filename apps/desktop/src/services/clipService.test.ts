import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Shared Tauri mocks are auto-loaded via test/setup.ts — no per-file vi.mock.

// vi.mock factories are hoisted above imports; declare shared mock fns via a
// single vi.hoisted call (destructured in the same statement so the bindings
// are available when the hoisted factories run).
const {
  collectTextFromStream,
  fakeAdapter,
  writeFile,
  createFile,
  createDir,
  openFile,
} = vi.hoisted(() => {
  const collectTextFromStream = vi.fn();
  const fakeAdapter = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    send: vi.fn(async (_prompt: string) => {}),
  };
  return {
    collectTextFromStream,
    fakeAdapter,
    writeFile: vi.fn(async (_path: string, _content: string) => {}),
    createFile: vi.fn(async (_path: string, _content: string) => {}),
    createDir: vi.fn(async (_dir: string) => {}),
    openFile: vi.fn(async (_path: string, _name: string) => {}),
  };
});

// Mock the stores so clipService touches no real AI / FS.
vi.mock('@/store/vaultStore', () => ({
  useVaultStore: {
    getState: () => ({
      currentVault: { basePath: '/mock/vault', id: 'v1' },
      writeFile,
      createFile,
      createDir,
    }),
  },
}));

vi.mock('@/store/editorStore', () => ({
  useEditorStore: {
    getState: () => ({ openFile }),
  },
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ cliAdapter: 'claude', cliPath: '/mock/claude' }),
  },
}));

vi.mock('@/store/skillStore', () => ({
  useSkillStore: {
    getState: () => ({ getSkillForCapability: () => undefined }),
  },
}));

// Fake CLI adapter registry + adapter so generateClip never spawns a process.
vi.mock('@quill/cli-adapter', () => ({
  CliAdapterRegistry: {
    getInstance: () => ({ create: () => fakeAdapter }),
  },
}));

// Mock collectTextFromStream so we can feed canned AI output.
vi.mock('./aiStreamUtils', () => ({
  collectTextFromStream,
}));

import { generateClip, saveClip, clipUrl } from './clipService';

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(new Date('2026-03-04T10:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('generateClip — validateUrl (via service entry)', () => {
  it('throws on a malformed URL before invoking AI', async () => {
    await expect(generateClip('not-a-url')).rejects.toThrow(/无效的网址/);
    expect(collectTextFromStream).not.toHaveBeenCalled();
    expect(fakeAdapter.start).not.toHaveBeenCalled();
  });

  it('throws on a non-http(s) protocol', async () => {
    await expect(generateClip('ftp://example.com/x')).rejects.toThrow(/无效的网址/);
    await expect(generateClip('file:///etc/passwd')).rejects.toThrow(/无效的网址/);
    expect(collectTextFromStream).not.toHaveBeenCalled();
  });

  it('accepts a valid https URL and proceeds to AI', async () => {
    collectTextFromStream.mockResolvedValueOnce(
      '{"title":"T","tags":["a"],"suggestedTags":[],"summary":"s","keyPoints":["p"]}',
    );
    const meta = await generateClip('https://example.com/article');
    expect(meta.url).toBe('https://example.com/article');
    expect(meta.title).toBe('T');
    expect(meta.tags).toEqual(['a']);
  });
});

describe('generateClip — AI response parsing', () => {
  it('parses a clean JSON card', async () => {
    collectTextFromStream.mockResolvedValueOnce(
      '{"title":"My Page","tags":["t1","t2"],"suggestedTags":["s1"],"summary":"sum","keyPoints":["a","b"]}',
    );
    const meta = await generateClip('https://x.com/p');
    expect(meta).toEqual({
      title: 'My Page',
      tags: ['t1', 't2'],
      suggestedTags: ['s1'],
      summary: 'sum',
      keyPoints: ['a', 'b'],
      url: 'https://x.com/p',
    });
  });

  it('extracts JSON embedded in surrounding prose', async () => {
    collectTextFromStream.mockResolvedValueOnce(
      'Here is the card:\n{"title":"Embedded","tags":[],"suggestedTags":[],"summary":"","keyPoints":[]}\nThanks',
    );
    const meta = await generateClip('https://x.com/e');
    expect(meta.title).toBe('Embedded');
  });

  it('throws a parse error when AI output is not JSON', async () => {
    collectTextFromStream.mockResolvedValueOnce('the page is about cats');
    await expect(generateClip('https://x.com/bad')).rejects.toThrow(/无法解析为知识卡片/);
  });

  it('defaults missing fields to safe empties', async () => {
    collectTextFromStream.mockResolvedValueOnce('{"title":"Partial"}');
    const meta = await generateClip('https://x.com/partial');
    expect(meta.title).toBe('Partial');
    expect(meta.tags).toEqual([]);
    expect(meta.suggestedTags).toEqual([]);
    expect(meta.summary).toBe('');
    expect(meta.keyPoints).toEqual([]);
  });

  it('stops the adapter even when parsing fails', async () => {
    collectTextFromStream.mockResolvedValueOnce('not json');
    await expect(generateClip('https://x.com/err')).rejects.toThrow();
    expect(fakeAdapter.stop).toHaveBeenCalledTimes(1);
  });

  it('stops the adapter on the success path', async () => {
    collectTextFromStream.mockResolvedValueOnce(
      '{"title":"ok","tags":[],"suggestedTags":[],"summary":"","keyPoints":[]}',
    );
    await generateClip('https://x.com/ok');
    expect(fakeAdapter.stop).toHaveBeenCalledTimes(1);
  });
});

describe('saveClip — markdown assembly', () => {
  it('writes frontmatter with title/type/url/tags/clipped date', async () => {
    const path = await saveClip({
      title: 'Hello World',
      tags: ['tech', 'ai'],
      suggestedTags: [],
      summary: 'a summary',
      keyPoints: ['p1', 'p2'],
      url: 'https://example.com/hello',
    });

    expect(path).toBe('__clips__/tech/2026-03-04-hello-world.md');
    const [filePath, content] = createFile.mock.calls[0];
    expect(filePath).toBe('__clips__/tech/2026-03-04-hello-world.md');
    expect(content).toContain('title: "Hello World"');
    expect(content).toContain('type: clip');
    expect(content).toContain('url: "https://example.com/hello"');
    expect(content).toContain('tags: ["tech", "ai"]');
    expect(content).toContain('clipped: 2026-03-04');
    expect(content).toContain('> **来源**: [example.com](https://example.com/hello)');
    expect(content).toContain('## 摘要');
    expect(content).toContain('a summary');
    expect(content).toContain('## 要点');
    expect(content).toContain('- p1');
    expect(content).toContain('- p2');
  });

  it('falls back to 未分类 when no tags provided', async () => {
    const path = await saveClip({
      title: 'No Tags',
      tags: [],
      suggestedTags: [],
      summary: '',
      keyPoints: [],
      url: 'https://x.com/n',
    });
    expect(path).toBe('__clips__/未分类/2026-03-04-no-tags.md');
    expect(createDir).toHaveBeenCalledWith('__clips__/未分类');
  });

  it('uses the first tag as the directory', async () => {
    await saveClip({
      title: 'X',
      tags: ['second-tag', 'first-tag'],
      suggestedTags: [],
      summary: '',
      keyPoints: [],
      url: 'https://x.com/x',
    });
    expect(createDir).toHaveBeenCalledWith('__clips__/second-tag');
  });

  it('renders the empty key-points placeholder when none provided', async () => {
    await saveClip({
      title: 'X',
      tags: ['t'],
      suggestedTags: [],
      summary: '',
      keyPoints: [],
      url: 'https://x.com/x',
    });
    const content = createFile.mock.calls[0][1] as string;
    expect(content).toContain('_无要点提取_');
  });

  it('slugifies titles: lowercases, drops non-alphanumerics, keeps CJK, caps at 60 chars', async () => {
    const path = await saveClip({
      title: 'My Cool Article! (Part 2) 关于 React',
      tags: ['t'],
      suggestedTags: [],
      summary: '',
      keyPoints: [],
      url: 'https://x.com/x',
    });
    expect(path).toBe('__clips__/t/2026-03-04-my-cool-article-part-2-关于-react.md');
  });

  it('falls back to "clip" slug when title yields empty', async () => {
    const path = await saveClip({
      title: '!!!',
      tags: ['t'],
      suggestedTags: [],
      summary: '',
      keyPoints: [],
      url: 'https://x.com/x',
    });
    expect(path).toBe('__clips__/t/2026-03-04-clip.md');
  });
});

describe('saveClip — overwrite + auto-open', () => {
  it('overwritePath writes to that path via writeFile and skips createFile/createDir', async () => {
    const path = await saveClip(
      { title: 'T', tags: ['t'], suggestedTags: [], summary: '', keyPoints: [], url: 'https://x.com' },
      '__clips__/t/existing.md',
    );
    expect(path).toBe('__clips__/t/existing.md');
    expect(writeFile).toHaveBeenCalledWith('__clips__/t/existing.md', expect.any(String));
    expect(createFile).not.toHaveBeenCalled();
    expect(createDir).not.toHaveBeenCalled();
  });

  it('auto-opens the saved file by default', async () => {
    await saveClip({
      title: 'T',
      tags: ['t'],
      suggestedTags: [],
      summary: '',
      keyPoints: [],
      url: 'https://x.com',
    });
    expect(openFile).toHaveBeenCalledTimes(1);
    const [openedPath, openedName] = openFile.mock.calls[0];
    expect(openedPath).toBe('__clips__/t/2026-03-04-t.md');
    expect(openedName).toBe('2026-03-04-t.md');
  });

  it('skipAutoOpen suppresses the editor open call', async () => {
    await saveClip(
      { title: 'T', tags: ['t'], suggestedTags: [], summary: '', keyPoints: [], url: 'https://x.com' },
      undefined,
      { skipAutoOpen: true },
    );
    expect(openFile).not.toHaveBeenCalled();
  });

  it('skipAutoOpen also applies on the overwrite path', async () => {
    await saveClip(
      { title: 'T', tags: ['t'], suggestedTags: [], summary: '', keyPoints: [], url: 'https://x.com' },
      '__clips__/t/existing.md',
      { skipAutoOpen: true },
    );
    expect(openFile).not.toHaveBeenCalled();
  });
});

describe('clipUrl — backward-compatible wrapper', () => {
  it('runs generate then save and returns the saved path', async () => {
    collectTextFromStream.mockResolvedValueOnce(
      '{"title":"W","tags":["t"],"suggestedTags":[],"summary":"s","keyPoints":[]}',
    );
    const path = await clipUrl('https://example.com/w');
    expect(path).toBe('__clips__/t/2026-03-04-w.md');
    expect(fakeAdapter.stop).toHaveBeenCalledTimes(1);
    expect(openFile).toHaveBeenCalledTimes(1);
  });

  it('forwards overwritePath to saveClip', async () => {
    collectTextFromStream.mockResolvedValueOnce(
      '{"title":"W","tags":["t"],"suggestedTags":[],"summary":"","keyPoints":[]}',
    );
    const path = await clipUrl(
      'https://example.com/w',
      undefined,
      'auto',
      undefined,
      undefined,
      '__clips__/t/existing.md',
    );
    expect(path).toBe('__clips__/t/existing.md');
    expect(writeFile).toHaveBeenCalledWith('__clips__/t/existing.md', expect.any(String));
    expect(createFile).not.toHaveBeenCalled();
  });
});
