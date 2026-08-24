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
  readFile,
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
    readFile: vi.fn(async (_path: string) => ''),
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
      readFile,
    }),
  },
}));

vi.mock('@/services/editorIoService', () => ({
  openFile,
}));

vi.mock('@/store/aiConfigStore', () => ({
  useAiConfigStore: {
    getState: () => ({ cliAdapter: 'claude', cliPath: '/mock/claude' }),
  },
  getFeatureAdapter: () => 'claude',
  getFeatureCliPath: () => '/mock/claude',
}));

// Fake CLI adapter factory + adapter so generateClip never spawns a process.
vi.mock('@folyn/cli-adapter', () => ({
  createAdapter: () => fakeAdapter,
}));

// Mock collectTextFromStream so we can feed canned AI output; keep the real
// extractJsonObject (clipService imports it from this module).
vi.mock('./aiStreamUtils', async () => {
  const actual = await vi.importActual<typeof import('./aiStreamUtils')>('./aiStreamUtils');
  return { ...actual, collectTextFromStream };
});

import { generateClip, saveClip, clipUrl } from './clipService';

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(new Date('2026-03-04T10:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

// Helper: enqueue two canned AI responses for the chained
// (card-metadata → infographic) agent calls inside `generateClip`.
function enqueueCardThenInfographic(cardJson: string, infographicJson: string) {
  collectTextFromStream
    .mockResolvedValueOnce(cardJson)
    .mockResolvedValueOnce(infographicJson);
}

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
    enqueueCardThenInfographic(
      '{"title":"T","tags":["a"],"suggestedTags":[],"summary":"s","keyPoints":["p"]}',
      '{"version":1,"blocks":[{"type":"hero","title":"H"}]}',
    );
    const { metadata, infographic } = await generateClip('https://example.com/article');
    expect(metadata.url).toBe('https://example.com/article');
    expect(metadata.title).toBe('T');
    expect(metadata.tags).toEqual(['a']);
    expect(infographic).not.toBeNull();
    expect(infographic!.blocks[0]).toEqual({ type: 'hero', title: 'H' });
  });
});

describe('generateClip — curl.md URL construction', () => {
  it('constructs the curl.md URL with the original URL encoded', async () => {
    enqueueCardThenInfographic(
      '{"title":"T","tags":[],"suggestedTags":[],"summary":"","keyPoints":[]}',
      '{"version":1,"blocks":[]}',
    );
    await generateClip('https://example.com/a?b=c&d');
    const prompt = fakeAdapter.send.mock.calls[0][0] as string;
    // Original URL is URL-encoded into the curl.md path (query params preserved
    // inside the encoded segment, not as a live query string).
    expect(prompt).toContain('https://curl.md/https%3A%2F%2Fexample.com%2Fa%3Fb%3Dc%26d');
    // The agent must WebFetch the curl.md URL, not the raw page URL as a fetch target.
    expect(prompt).toMatch(/WebFetch.*curl\.md/s);
    // The raw URL is still conveyed for source/title context.
    expect(prompt).toContain('https://example.com/a?b=c&d');
  });

  it('encodes the URL even with fragment and trailing slash', async () => {
    enqueueCardThenInfographic(
      '{"title":"T","tags":[],"suggestedTags":[],"summary":"","keyPoints":[]}',
      '{"version":1,"blocks":[]}',
    );
    await generateClip('https://example.com/path/#section');
    const prompt = fakeAdapter.send.mock.calls[0][0] as string;
    expect(prompt).toContain(
      'https://curl.md/' + encodeURIComponent('https://example.com/path/#section'),
    );
  });

  it('uses the curl.md URL in the prompt', async () => {
    enqueueCardThenInfographic(
      '{"title":"T","tags":[],"suggestedTags":[],"summary":"","keyPoints":[]}',
      '{"version":1,"blocks":[]}',
    );
    await generateClip('https://x.com/y');
    const prompt = fakeAdapter.send.mock.calls[0][0] as string;
    expect(prompt).toContain('https://curl.md/' + encodeURIComponent('https://x.com/y'));
    expect(prompt).toMatch(/WebFetch/s);
  });

  it('keeps the original (decoded) URL in the returned metadata', async () => {
    enqueueCardThenInfographic(
      '{"title":"T","tags":[],"suggestedTags":[],"summary":"","keyPoints":[]}',
      '{"version":1,"blocks":[]}',
    );
    const { metadata } = await generateClip('https://example.com/a?b=c&d');
    expect(metadata.url).toBe('https://example.com/a?b=c&d');
  });
});

describe('generateClip — AI response parsing', () => {
  it('parses a clean JSON card', async () => {
    const card = {
      title: 'My Page',
      tags: ['t1', 't2'],
      suggestedTags: ['s1'],
      summary: 'sum',
      keyPoints: ['a', 'b'],
      pageContent: '# Page\n\nbody',
    };
    const infoDoc = {
      version: 1,
      blocks: [
        { type: 'hero', title: 'My Page' },
        { type: 'source', url: 'https://x.com/p' },
      ],
    };
    enqueueCardThenInfographic(JSON.stringify(card), JSON.stringify(infoDoc));
    const { metadata, infographic } = await generateClip('https://x.com/p');
    expect(metadata).toEqual({
      title: 'My Page',
      tags: ['t1', 't2'],
      suggestedTags: ['s1'],
      summary: 'sum',
      keyPoints: ['a', 'b'],
      pageContent: '# Page\n\nbody',
      url: 'https://x.com/p',
    });
    expect(infographic).toEqual(infoDoc);
  });

  it('extracts JSON embedded in surrounding prose for the card call', async () => {
    const card = {
      title: 'Embedded',
      tags: [],
      suggestedTags: [],
      summary: '',
      keyPoints: [],
      pageContent: 'body',
    };
    enqueueCardThenInfographic(
      `Here is the card:\n${JSON.stringify(card)}\nThanks`,
      '{"version":1,"blocks":[]}',
    );
    const { metadata } = await generateClip('https://x.com/e');
    expect(metadata.title).toBe('Embedded');
    expect(metadata.pageContent).toBe('body');
  });

  it('throws a parse error when the card AI output is not JSON', async () => {
    collectTextFromStream.mockResolvedValueOnce('the page is about cats');
    await expect(generateClip('https://x.com/bad')).rejects.toThrow(/无法解析为知识卡片/);
  });

  it('defaults missing fields to safe empties, including pageContent', async () => {
    enqueueCardThenInfographic(
      '{"title":"Partial"}',
      '{"version":1,"blocks":[]}',
    );
    const { metadata } = await generateClip('https://x.com/partial');
    expect(metadata.title).toBe('Partial');
    expect(metadata.tags).toEqual([]);
    expect(metadata.suggestedTags).toEqual([]);
    expect(metadata.summary).toBe('');
    expect(metadata.keyPoints).toEqual([]);
    expect(metadata.pageContent).toBe('');
  });

  it('stops the adapter even when parsing fails', async () => {
    collectTextFromStream.mockResolvedValueOnce('not json');
    await expect(generateClip('https://x.com/err')).rejects.toThrow();
    expect(fakeAdapter.stop).toHaveBeenCalledTimes(1);
  });

  it('stops the adapter on the success path (after both card + infographic calls)', async () => {
    enqueueCardThenInfographic(
      '{"title":"ok","tags":[],"suggestedTags":[],"summary":"","keyPoints":[]}',
      '{"version":1,"blocks":[]}',
    );
    await generateClip('https://x.com/ok');
    expect(fakeAdapter.stop).toHaveBeenCalledTimes(1);
    // Two agent sends: card-metadata + infographic-mode.
    expect(fakeAdapter.send).toHaveBeenCalledTimes(2);
  });
});

describe('generateClip — chained infographic call', () => {
  it('chains a second agent call in [infographic-mode] after the card call', async () => {
    enqueueCardThenInfographic(
      '{"title":"T","tags":["a"],"suggestedTags":[],"summary":"s","keyPoints":["p"],"pageContent":"body text"}',
      '{"version":1,"blocks":[{"type":"hero","title":"H"},{"type":"source","url":"https://x.com/p"}]}',
    );
    const { infographic } = await generateClip('https://x.com/p');
    expect(fakeAdapter.send).toHaveBeenCalledTimes(2);
    const infographicPrompt = fakeAdapter.send.mock.calls[1][0] as string;
    expect(infographicPrompt).toContain('[infographic-mode]');
    expect(infographicPrompt).toContain('title: T');
    expect(infographicPrompt).toContain('https://x.com/p');
    expect(infographicPrompt).toContain('## 正文');
    expect(infographicPrompt).toContain('body text');
    expect(infographic).not.toBeNull();
    expect(infographic!.blocks).toHaveLength(2);
  });

  it('returns infographic: null when the chained call fails (best-effort)', async () => {
    // Card call succeeds, infographic call returns non-JSON.
    collectTextFromStream
      .mockResolvedValueOnce('{"title":"T","tags":[],"suggestedTags":[],"summary":"","keyPoints":[]}')
      .mockResolvedValueOnce('not json at all');
    const { metadata, infographic } = await generateClip('https://x.com/ok');
    expect(metadata.title).toBe('T');
    expect(infographic).toBeNull();
  });

  it('returns infographic: null when the chained call returns a bad shape', async () => {
    collectTextFromStream
      .mockResolvedValueOnce('{"title":"T","tags":[],"suggestedTags":[],"summary":"","keyPoints":[]}')
      .mockResolvedValueOnce('{"version":1,"noBlocks":[]}');
    const { infographic } = await generateClip('https://x.com/badshape');
    expect(infographic).toBeNull();
  });

  it('omits ## 正文 from the infographic prompt when pageContent is empty', async () => {
    enqueueCardThenInfographic(
      '{"title":"T","tags":[],"suggestedTags":[],"summary":"s","keyPoints":["p"]}',
      '{"version":1,"blocks":[]}',
    );
    await generateClip('https://x.com/nobody');
    const infographicPrompt = fakeAdapter.send.mock.calls[1][0] as string;
    // No `## 正文` section header line in the prompt.
    expect(infographicPrompt).not.toMatch(/^## 正文$/m);
    // Summary + keyPoints still present.
    expect(infographicPrompt).toContain('s');
    expect(infographicPrompt).toContain('- p');
  });
});

describe('saveClip — markdown assembly', () => {
  it('writes frontmatter with title/type/url/tags/clipped date', async () => {
    const path = await saveClip({
      metadata: {
        title: 'Hello World',
        tags: ['tech', 'ai'],
        suggestedTags: [],
        summary: 'a summary',
        keyPoints: ['p1', 'p2'],
        url: 'https://example.com/hello',
      },
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
      metadata: {
        title: 'No Tags',
        tags: [],
        suggestedTags: [],
        summary: '',
        keyPoints: [],
        url: 'https://x.com/n',
      },
    });
    expect(path).toBe('__clips__/未分类/2026-03-04-no-tags.md');
    expect(createDir).toHaveBeenCalledWith('__clips__/未分类');
  });

  it('uses the first tag as the directory', async () => {
    await saveClip({
      metadata: {
        title: 'X',
        tags: ['second-tag', 'first-tag'],
        suggestedTags: [],
        summary: '',
        keyPoints: [],
        url: 'https://x.com/x',
      },
    });
    expect(createDir).toHaveBeenCalledWith('__clips__/second-tag');
  });

  it('renders the empty key-points placeholder when none provided', async () => {
    await saveClip({
      metadata: {
        title: 'X',
        tags: ['t'],
        suggestedTags: [],
        summary: '',
        keyPoints: [],
        url: 'https://x.com/x',
      },
    });
    const content = createFile.mock.calls[0][1] as string;
    expect(content).toContain('_无要点提取_');
  });

  it('writes a ## 正文 section when pageContent is provided', async () => {
    await saveClip({
      metadata: {
        title: 'With Body',
        tags: ['t'],
        suggestedTags: [],
        summary: 's',
        keyPoints: ['p1'],
        url: 'https://x.com/b',
        pageContent: '# Page Title\n\nSome body text.',
      },
    });
    const content = createFile.mock.calls[0][1] as string;
    expect(content).toContain('## 正文');
    expect(content).toContain('# Page Title');
    expect(content).toContain('Some body text.');
    // Section order: 信息图 (absent) → 摘要 → 要点 → 正文.
    const idxSummary = content.indexOf('## 摘要');
    const idxPoints = content.indexOf('## 要点');
    const idxBody = content.indexOf('## 正文');
    expect(idxSummary).toBeLessThan(idxPoints);
    expect(idxPoints).toBeLessThan(idxBody);
  });

  it('omits ## 正文 when pageContent is empty or missing', async () => {
    await saveClip({
      metadata: {
        title: 'No Body',
        tags: ['t'],
        suggestedTags: [],
        summary: 's',
        keyPoints: ['p1'],
        url: 'https://x.com/n',
      },
    });
    const content = createFile.mock.calls[0][1] as string;
    expect(content).not.toContain('## 正文');
  });

  it('writes ## 信息图 at the TOP position when infographic is provided', async () => {
    const doc = {
      version: 1,
      blocks: [
        { type: 'hero', title: 'H' },
        { type: 'source', url: 'https://x.com/b' },
      ],
    };
    await saveClip({
      metadata: {
        title: 'With Infographic',
        tags: ['t'],
        suggestedTags: [],
        summary: 's',
        keyPoints: ['p1'],
        url: 'https://x.com/b',
        pageContent: 'body',
      },
      infographic: doc,
    });
    const content = createFile.mock.calls[0][1] as string;
    expect(content).toContain('## 信息图');
    expect(content).toContain('"type": "hero"');
    // Top position: 信息图 right after the quote, before 摘要 / 要点 / 正文.
    const idxQuote = content.indexOf('> **来源**');
    const idxInfo = content.indexOf('## 信息图');
    const idxSummary = content.indexOf('## 摘要');
    const idxPoints = content.indexOf('## 要点');
    const idxBody = content.indexOf('## 正文');
    expect(idxQuote).toBeGreaterThan(-1);
    expect(idxInfo).toBeGreaterThan(idxQuote);
    expect(idxInfo).toBeLessThan(idxSummary);
    expect(idxSummary).toBeLessThan(idxPoints);
    expect(idxPoints).toBeLessThan(idxBody);
  });

  it('skips ## 信息图 when infographic is null', async () => {
    await saveClip({
      metadata: {
        title: 'No Infographic',
        tags: ['t'],
        suggestedTags: [],
        summary: 's',
        keyPoints: ['p1'],
        url: 'https://x.com/n',
      },
      infographic: null,
    });
    const content = createFile.mock.calls[0][1] as string;
    expect(content).not.toContain('## 信息图');
  });

  it('slugifies titles: lowercases, drops non-alphanumerics, keeps CJK, caps at 60 chars', async () => {
    const path = await saveClip({
      metadata: {
        title: 'My Cool Article! (Part 2) 关于 React',
        tags: ['t'],
        suggestedTags: [],
        summary: '',
        keyPoints: [],
        url: 'https://x.com/x',
      },
    });
    expect(path).toBe('__clips__/t/2026-03-04-my-cool-article-part-2-关于-react.md');
  });

  it('falls back to "clip" slug when title yields empty', async () => {
    const path = await saveClip({
      metadata: {
        title: '!!!',
        tags: ['t'],
        suggestedTags: [],
        summary: '',
        keyPoints: [],
        url: 'https://x.com/x',
      },
    });
    expect(path).toBe('__clips__/t/2026-03-04-clip.md');
  });

  it('accepts a bare ClipMetadata (backward-compat shape) without infographic', async () => {
    // Legacy callers may pass a bare ClipMetadata instead of { metadata, infographic }.
    const path = await saveClip({
      title: 'Bare',
      tags: ['t'],
      suggestedTags: [],
      summary: 's',
      keyPoints: ['p1'],
      url: 'https://x.com/bare',
    });
    expect(path).toBe('__clips__/t/2026-03-04-bare.md');
    const content = createFile.mock.calls[0][1] as string;
    expect(content).not.toContain('## 信息图');
  });
});

describe('saveClip — overwrite + auto-open', () => {
  it('overwritePath writes to that path via writeFile and skips createFile/createDir', async () => {
    const path = await saveClip(
      { metadata: { title: 'T', tags: ['t'], suggestedTags: [], summary: '', keyPoints: [], url: 'https://x.com' } },
      '__clips__/t/existing.md',
    );
    expect(path).toBe('__clips__/t/existing.md');
    expect(writeFile).toHaveBeenCalledWith('__clips__/t/existing.md', expect.any(String));
    expect(createFile).not.toHaveBeenCalled();
    expect(createDir).not.toHaveBeenCalled();
  });

  it('auto-opens the saved file by default', async () => {
    await saveClip({
      metadata: {
        title: 'T',
        tags: ['t'],
        suggestedTags: [],
        summary: '',
        keyPoints: [],
        url: 'https://x.com',
      },
    });
    expect(openFile).toHaveBeenCalledTimes(1);
    const [openedPath, openedName] = openFile.mock.calls[0];
    expect(openedPath).toBe('__clips__/t/2026-03-04-t.md');
    expect(openedName).toBe('2026-03-04-t.md');
  });

  it('skipAutoOpen suppresses the editor open call', async () => {
    await saveClip(
      { metadata: { title: 'T', tags: ['t'], suggestedTags: [], summary: '', keyPoints: [], url: 'https://x.com' } },
      undefined,
      { skipAutoOpen: true },
    );
    expect(openFile).not.toHaveBeenCalled();
  });

  it('skipAutoOpen also applies on the overwrite path', async () => {
    await saveClip(
      { metadata: { title: 'T', tags: ['t'], suggestedTags: [], summary: '', keyPoints: [], url: 'https://x.com' } },
      '__clips__/t/existing.md',
      { skipAutoOpen: true },
    );
    expect(openFile).not.toHaveBeenCalled();
  });
});

describe('clipUrl — backward-compatible wrapper', () => {
  it('runs generate then save and returns the saved path', async () => {
    enqueueCardThenInfographic(
      '{"title":"W","tags":["t"],"suggestedTags":[],"summary":"s","keyPoints":[]}',
      '{"version":1,"blocks":[]}',
    );
    const path = await clipUrl('https://example.com/w');
    expect(path).toBe('__clips__/t/2026-03-04-w.md');
    expect(fakeAdapter.stop).toHaveBeenCalledTimes(1);
    expect(openFile).toHaveBeenCalledTimes(1);
  });

  it('forwards overwritePath to saveClip', async () => {
    enqueueCardThenInfographic(
      '{"title":"W","tags":["t"],"suggestedTags":[],"summary":"","keyPoints":[]}',
      '{"version":1,"blocks":[]}',
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

  it('writes the auto-generated infographic to disk via saveClip', async () => {
    enqueueCardThenInfographic(
      '{"title":"W","tags":["t"],"suggestedTags":[],"summary":"s","keyPoints":[],"pageContent":"body"}',
      '{"version":1,"blocks":[{"type":"hero","title":"W"},{"type":"source","url":"https://example.com/w"}]}',
    );
    await clipUrl('https://example.com/w');
    const content = createFile.mock.calls[0][1] as string;
    expect(content).toContain('## 信息图');
    expect(content).toContain('"type": "hero"');
    expect(content).toContain('## 正文');
    expect(content).toContain('body');
  });
});
