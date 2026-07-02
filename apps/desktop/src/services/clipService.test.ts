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

import { generateClip, saveClip, clipUrl, generateInfographic } from './clipService';

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

describe('generateClip — curl.md URL construction', () => {
  it('constructs the curl.md URL with the original URL encoded', async () => {
    collectTextFromStream.mockResolvedValueOnce(
      '{"title":"T","tags":[],"suggestedTags":[],"summary":"","keyPoints":[]}',
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
    collectTextFromStream.mockResolvedValueOnce(
      '{"title":"T","tags":[],"suggestedTags":[],"summary":"","keyPoints":[]}',
    );
    await generateClip('https://example.com/path/#section');
    const prompt = fakeAdapter.send.mock.calls[0][0] as string;
    expect(prompt).toContain(
      'https://curl.md/' + encodeURIComponent('https://example.com/path/#section'),
    );
  });

  it('uses the curl.md URL in both skill and fallback prompt branches', async () => {
    // Fallback branch (no skill configured — the default mock returns undefined).
    collectTextFromStream.mockResolvedValueOnce(
      '{"title":"T","tags":[],"suggestedTags":[],"summary":"","keyPoints":[]}',
    );
    await generateClip('https://x.com/y');
    const prompt = fakeAdapter.send.mock.calls[0][0] as string;
    expect(prompt).toContain('https://curl.md/' + encodeURIComponent('https://x.com/y'));
    expect(prompt).toMatch(/WebFetch/s);
  });

  it('keeps the original (decoded) URL in the returned metadata', async () => {
    collectTextFromStream.mockResolvedValueOnce(
      '{"title":"T","tags":[],"suggestedTags":[],"summary":"","keyPoints":[]}',
    );
    const meta = await generateClip('https://example.com/a?b=c&d');
    expect(meta.url).toBe('https://example.com/a?b=c&d');
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
    collectTextFromStream.mockResolvedValueOnce(JSON.stringify(card));
    const meta = await generateClip('https://x.com/p');
    expect(meta).toEqual({
      title: 'My Page',
      tags: ['t1', 't2'],
      suggestedTags: ['s1'],
      summary: 'sum',
      keyPoints: ['a', 'b'],
      pageContent: '# Page\n\nbody',
      url: 'https://x.com/p',
    });
  });

  it('extracts JSON embedded in surrounding prose', async () => {
    const card = {
      title: 'Embedded',
      tags: [],
      suggestedTags: [],
      summary: '',
      keyPoints: [],
      pageContent: 'body',
    };
    collectTextFromStream.mockResolvedValueOnce(
      `Here is the card:\n${JSON.stringify(card)}\nThanks`,
    );
    const meta = await generateClip('https://x.com/e');
    expect(meta.title).toBe('Embedded');
    expect(meta.pageContent).toBe('body');
  });

  it('throws a parse error when AI output is not JSON', async () => {
    collectTextFromStream.mockResolvedValueOnce('the page is about cats');
    await expect(generateClip('https://x.com/bad')).rejects.toThrow(/无法解析为知识卡片/);
  });

  it('defaults missing fields to safe empties, including pageContent', async () => {
    collectTextFromStream.mockResolvedValueOnce('{"title":"Partial"}');
    const meta = await generateClip('https://x.com/partial');
    expect(meta.title).toBe('Partial');
    expect(meta.tags).toEqual([]);
    expect(meta.suggestedTags).toEqual([]);
    expect(meta.summary).toBe('');
    expect(meta.keyPoints).toEqual([]);
    expect(meta.pageContent).toBe('');
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

  it('writes a ## 正文 section when pageContent is provided', async () => {
    await saveClip({
      title: 'With Body',
      tags: ['t'],
      suggestedTags: [],
      summary: 's',
      keyPoints: ['p1'],
      url: 'https://x.com/b',
      pageContent: '# Page Title\n\nSome body text.',
    });
    const content = createFile.mock.calls[0][1] as string;
    expect(content).toContain('## 正文');
    expect(content).toContain('# Page Title');
    expect(content).toContain('Some body text.');
    // Section order: 摘要 → 要点 → 正文.
    const idxSummary = content.indexOf('## 摘要');
    const idxPoints = content.indexOf('## 要点');
    const idxBody = content.indexOf('## 正文');
    expect(idxSummary).toBeLessThan(idxPoints);
    expect(idxPoints).toBeLessThan(idxBody);
  });

  it('omits ## 正文 when pageContent is empty or missing', async () => {
    await saveClip({
      title: 'No Body',
      tags: ['t'],
      suggestedTags: [],
      summary: 's',
      keyPoints: ['p1'],
      url: 'https://x.com/n',
    });
    const content = createFile.mock.calls[0][1] as string;
    expect(content).not.toContain('## 正文');
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

const sampleClipMd = [
  '---',
  'title: "Hello World"',
  'type: clip',
  'url: "https://example.com/hello"',
  'tags: ["tech", "ai"]',
  'clipped: 2026-07-02',
  '---',
  '',
  '> **来源**: [example.com](https://example.com/hello)',
  '',
  '## 摘要',
  '',
  'A short summary of the page.',
  '',
  '## 要点',
  '',
  '- point one',
  '- point two',
  '',
].join('\n');

describe('generateInfographic', () => {
  it('reads the clip, invokes the clips agent, and writes back a ## 信息图 section', async () => {
    readFile.mockResolvedValueOnce(sampleClipMd);
    const aiDoc = {
      version: 1,
      blocks: [
        { type: 'hero', title: 'Hello' },
        { type: 'source', url: 'https://example.com/hello' },
      ],
    };
    collectTextFromStream.mockResolvedValueOnce(JSON.stringify(aiDoc));

    const doc = await generateInfographic('__clips__/tech/2026-07-02-hello-world.md');

    expect(doc.version).toBe(1);
    expect(doc.blocks).toHaveLength(2);
    expect(doc.blocks[0]).toEqual({ type: 'hero', title: 'Hello' });

    // Agent was started + stopped.
    expect(fakeAdapter.start).toHaveBeenCalledTimes(1);
    expect(fakeAdapter.stop).toHaveBeenCalledTimes(1);

    // The prompt carried the [infographic-mode] marker + clip content.
    const prompt = fakeAdapter.send.mock.calls[0][0] as string;
    expect(prompt).toContain('[infographic-mode]');
    expect(prompt).toContain('Hello World');
    expect(prompt).toContain('https://example.com/hello');
    expect(prompt).toContain('A short summary of the page.');
    expect(prompt).toContain('- point one');

    // Wrote back to the same path, with a ## 信息图 section.
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenContent] = writeFile.mock.calls[0];
    expect(writtenPath).toBe('__clips__/tech/2026-07-02-hello-world.md');
    expect(writtenContent).toContain('## 信息图');
    expect(writtenContent).toContain('"type": "hero"');
    // Original sections preserved byte-for-byte.
    expect(writtenContent).toContain('title: "Hello World"');
    expect(writtenContent).toContain('## 摘要');
    expect(writtenContent).toContain('A short summary of the page.');
    expect(writtenContent).toContain('## 要点');
    expect(writtenContent).toContain('- point one');
  });

  it('extracts JSON embedded in prose / fences (defensive parse)', async () => {
    readFile.mockResolvedValueOnce(sampleClipMd);
    collectTextFromStream.mockResolvedValueOnce(
      'Here is the infographic:\n```json\n{"version":1,"blocks":[{"type":"hero","title":"X"}]}\n```\nThanks',
    );
    const doc = await generateInfographic('__clips__/tech/x.md');
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]).toEqual({ type: 'hero', title: 'X' });
  });

  it('throws a parse error when AI output is not JSON', async () => {
    readFile.mockResolvedValueOnce(sampleClipMd);
    collectTextFromStream.mockResolvedValueOnce('not json at all');
    await expect(generateInfographic('__clips__/tech/x.md')).rejects.toThrow(/无法解析为信息图 JSON/);
    expect(fakeAdapter.stop).toHaveBeenCalledTimes(1);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('throws a shape error when blocks is missing', async () => {
    readFile.mockResolvedValueOnce(sampleClipMd);
    collectTextFromStream.mockResolvedValueOnce('{"version":1,"noBlocks":[]}');
    await expect(generateInfographic('__clips__/tech/x.md')).rejects.toThrow(/形状不合法/);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('throws when the clip file cannot be read', async () => {
    readFile.mockRejectedValueOnce(new Error('ENOENT'));
    await expect(generateInfographic('__clips__/tech/missing.md')).rejects.toThrow(/读取剪藏文件失败/);
    expect(fakeAdapter.start).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('replaces an existing ## 信息图 section (regenerate semantics)', async () => {
    const existingWithInfographic = `${sampleClipMd}## 信息图\n\n\`\`\`json\n${JSON.stringify({
      version: 1,
      blocks: [{ type: 'hero', title: 'OLD' }],
    })}\n\`\`\`\n`;
    readFile.mockResolvedValueOnce(existingWithInfographic);
    collectTextFromStream.mockResolvedValueOnce(
      JSON.stringify({ version: 1, blocks: [{ type: 'hero', title: 'NEW' }] }),
    );

    await generateInfographic('__clips__/tech/hello.md');

    expect(writeFile).toHaveBeenCalledTimes(1);
    const [, writtenContent] = writeFile.mock.calls[0];
    expect(writtenContent).not.toContain('OLD');
    expect(writtenContent).toContain('NEW');
    // Exactly one ## 信息图 heading.
    expect((writtenContent.match(/## 信息图/g) || []).length).toBe(1);
    // Surrounding content preserved.
    expect(writtenContent).toContain('## 摘要');
    expect(writtenContent).toContain('## 要点');
  });

  it('throws when clip content is empty', async () => {
    readFile.mockResolvedValueOnce('---\n---\n');
    await expect(generateInfographic('__clips__/tech/empty.md')).rejects.toThrow(/内容为空/);
    expect(fakeAdapter.start).not.toHaveBeenCalled();
  });

  it('writes ## 信息图 at the TOP position (before ## 摘要), not at the bottom', async () => {
    readFile.mockResolvedValueOnce(sampleClipMd);
    collectTextFromStream.mockResolvedValueOnce(
      JSON.stringify({ version: 1, blocks: [{ type: 'hero', title: 'H' }] }),
    );
    await generateInfographic('__clips__/tech/order.md');
    const [, writtenContent] = writeFile.mock.calls[0];
    const idxQuote = writtenContent.indexOf('> **来源**');
    const idxInfo = writtenContent.indexOf('## 信息图');
    const idxSummary = writtenContent.indexOf('## 摘要');
    const idxPoints = writtenContent.indexOf('## 要点');
    expect(idxQuote).toBeGreaterThan(-1);
    expect(idxInfo).toBeGreaterThan(idxQuote);
    expect(idxInfo).toBeLessThan(idxSummary);
    expect(idxSummary).toBeLessThan(idxPoints);
  });

  it('moves an existing bottom ## 信息图 to the TOP position on regenerate', async () => {
    // Legacy clip with ## 信息图 at the bottom (after ## 要点).
    const legacy = `${sampleClipMd}## 信息图\n\n\`\`\`json\n${JSON.stringify({
      version: 1,
      blocks: [{ type: 'hero', title: 'OLD' }],
    })}\n\`\`\`\n`;
    readFile.mockResolvedValueOnce(legacy);
    collectTextFromStream.mockResolvedValueOnce(
      JSON.stringify({ version: 1, blocks: [{ type: 'hero', title: 'NEW' }] }),
    );
    await generateInfographic('__clips__/tech/legacy.md');
    const [, writtenContent] = writeFile.mock.calls[0];
    expect(writtenContent).not.toContain('OLD');
    expect(writtenContent).toContain('NEW');
    expect((writtenContent.match(/## 信息图/g) || []).length).toBe(1);
    // Top position: 信息图 before 摘要.
    const idxInfo = writtenContent.indexOf('## 信息图');
    const idxSummary = writtenContent.indexOf('## 摘要');
    expect(idxInfo).toBeLessThan(idxSummary);
  });

  it('passes ## 正文 content to the agent when present', async () => {
    const clipWithBody = `${sampleClipMd}## 正文\n\n# Page Title\n\nReal body text from curl.md.\n`;
    readFile.mockResolvedValueOnce(clipWithBody);
    collectTextFromStream.mockResolvedValueOnce(
      JSON.stringify({ version: 1, blocks: [{ type: 'hero', title: 'H' }] }),
    );
    await generateInfographic('__clips__/tech/body.md');
    const prompt = fakeAdapter.send.mock.calls[0][0] as string;
    expect(prompt).toContain('## 正文');
    expect(prompt).toContain('Real body text from curl.md.');
    // Hint to the agent that 正文 is present.
    expect(prompt).toContain('7-9');
  });

  it('falls back to summary + keyPoints (no ## 正文 in prompt) when 正文 absent', async () => {
    readFile.mockResolvedValueOnce(sampleClipMd);
    collectTextFromStream.mockResolvedValueOnce(
      JSON.stringify({ version: 1, blocks: [{ type: 'hero', title: 'H' }] }),
    );
    await generateInfographic('__clips__/tech/nobody.md');
    const prompt = fakeAdapter.send.mock.calls[0][0] as string;
    // No `## 正文` section header line (a line that is exactly `## 正文`).
    // The hint text mentions `## 正文` inline within backticks, but there's
    // no actual section header + body in the prompt.
    expect(prompt).not.toMatch(/^## 正文$/m);
    // Still has summary + keyPoints.
    expect(prompt).toContain('A short summary of the page.');
    expect(prompt).toContain('- point one');
  });
});
