import { describe, it, expect, vi } from 'vitest';
import { validateClaims, buildTopicContent, parseTopicPage, serializeTopicPage, synthTopicsForSource } from './topicSynth';
import type { KbFs } from './kbFs';
import type { KbManifest, KbNavigation } from './kbTypes';

// 模型响应注入（synthTopicsForSource 内部走 kbChatJson）。
const llm = vi.hoisted(() => ({ response: {} as unknown }));
vi.mock('./kbLlm', () => ({ kbChatJson: async () => llm.response }));

const SOURCE = ['标题行', '第二行：窗口管理', '第三行', '第四行：透明窗口', ''];

describe('validateClaims — 行范围 + 锚文本双保险', () => {
  it('keeps a claim whose anchorText is inside the line range', () => {
    const kept = validateClaims(
      [{ text: 'Tauri 支持透明窗口', anchorText: '透明窗口', startLine: 4, endLine: 4 }],
      SOURCE,
    );
    expect(kept).toEqual([{ text: 'Tauri 支持透明窗口', anchorText: '透明窗口', startLine: 4, endLine: 4 }]);
  });

  it('drops out-of-range and anchor-mismatch claims', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kept = validateClaims(
      [
        { text: '越界', anchorText: '透明窗口', startLine: 4, endLine: 99 },
        { text: '锚文本不在范围内', anchorText: '透明窗口', startLine: 1, endLine: 2 },
        { text: '倒置', anchorText: '第二行', startLine: 3, endLine: 2 },
      ],
      SOURCE,
    );
    expect(kept).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});

describe('buildTopicContent — 页面 + 引用组装', () => {
  it('emits frontmatter, claim bullets with [^cN], footnote defs, and refs json', () => {
    const { markdown, refs } = buildTopicContent({
      tpId: 'tp-x1',
      title: '窗口管理',
      fmSources: ['src-1'],
      bodyBefore: '',
      footnoteBefore: [],
      sections: [
        {
          heading: '透明窗口',
          body: 'Tauri 的窗口能力。',
          claims: [{ text: '支持透明窗口', anchorText: '透明窗口', startLine: 4, endLine: 4 }],
        },
      ],
      srcId: 'src-1',
      srcPath: 'notes/a.md',
      versionHash: 'deadbeef',
      startRefNum: 1,
    });

    expect(markdown).toContain('id: tp-x1');
    expect(markdown).toContain('# 窗口管理');
    expect(markdown).toContain('- 支持透明窗口 [^c1]');
    expect(markdown).toContain('[^c1]: src-1 · notes/a.md · L4-L4 · 透明窗口');
    expect(refs).toEqual([
      {
        id: 'c1',
        topicId: 'tp-x1',
        anchorText: '透明窗口',
        srcId: 'src-1',
        srcPath: 'notes/a.md',
        versionHash: 'deadbeef',
        startLine: 4,
        endLine: 4,
        status: 'active',
      },
    ]);

    // 序列化/解析往返。
    const parsed = parseTopicPage(markdown);
    expect(parsed.fm).toEqual({ id: 'tp-x1', title: '窗口管理', sources: ['src-1'] });
    expect(parsed.body).toContain('## 透明窗口');
  });

  it('append continues ref numbering and keeps existing footnotes', () => {
    const existing: import('./kbTypes').KbRef[] = [
      { id: 'c1', topicId: 'tp-x1', anchorText: '旧锚', srcId: 'src-1', srcPath: 'notes/old.md', versionHash: 'h1', startLine: 1, endLine: 1, status: 'active' },
    ];
    const { markdown, refs } = buildTopicContent({
      tpId: 'tp-x1',
      title: '窗口管理',
      fmSources: ['src-1', 'src-2'],
      // 旧正文里带着程序写入的旧脚注定义 —— 重建时必须剥离，不能重复。
      bodyBefore: '# 窗口管理\n\n旧正文\n\n[^c1]: src-1 · notes/old.md · L1-L1 · 旧锚',
      footnoteBefore: existing,
      sections: [
        {
          heading: '新章节',
          body: '',
          claims: [{ text: '新结论', anchorText: '透明窗口', startLine: 4, endLine: 4 }],
        },
      ],
      srcId: 'src-2',
      srcPath: 'notes/b.md',
      versionHash: 'h2',
      startRefNum: 2,
    });
    expect(markdown).toContain('- 新结论 [^c2]');
    expect(markdown).toContain('[^c1]: src-1 · notes/old.md · L1-L1 · 旧锚');
    // 旧脚注定义只出现一次（refs 列表重新生成，页内旧定义已剥离）。
    expect(markdown.match(/\[\^c1\]:/g)).toHaveLength(1);
    expect(refs.map((r) => r.id)).toEqual(['c1', 'c2']);
    expect(refs[1]).toMatchObject({ srcId: 'src-2', versionHash: 'h2' });
  });

  it('serializeTopicPage round-trips a body with trailing newline', () => {
    const md = serializeTopicPage({ id: 'tp-1', title: 't', sources: ['s'] }, '# t\n\nbody\n');
    const parsed = parseTopicPage(md);
    expect(parsed.fm.title).toBe('t');
    expect(parsed.body.startsWith('# t')).toBe(true);
  });
});

describe('synthTopicsForSource — 快照仅在引用落盘时保留（ADR-0007）', () => {
  function memFs(): KbFs & { files: Record<string, string> } {
    const files: Record<string, string> = {};
    return {
      files,
      readFile: async (p) => {
        if (!(p in files)) throw new Error(`ENOENT: ${p}`);
        return files[p]!;
      },
      writeFile: async (p, c) => {
        files[p] = c;
      },
      exists: async (p) => p in files,
      rename: async (o, n) => {
        files[n] = files[o]!;
        delete files[o];
      },
    };
  }

  const content = SOURCE.join('\n');

  function run(manifest: KbManifest, nav: KbNavigation) {
    const fs = memFs();
    return {
      fs,
      promise: synthTopicsForSource({
        fs,
        manifest,
        nav,
        goal: '目标',
        srcId: 'src-1',
        srcPath: 'notes/a.md',
        versionHash: 'deadbeef',
        nodes: [{ title: 'A', summary: 'a', startLine: 1, endLine: 5 }],
        content,
      }),
    };
  }

  it('writes the version snapshot when refs are written', async () => {
    const manifest: KbManifest = { goal: '目标', scope: [], sources: {}, topics: {} };
    llm.response = {
      topics: [
        {
          title: '窗口管理',
          mode: 'new',
          sections: [
            { heading: '透明窗口', body: '', claims: [{ text: '支持透明窗口', anchorText: '透明窗口', startLine: 4, endLine: 4 }] },
          ],
        },
      ],
    };
    const { fs, promise } = run(manifest, { topics: [] });
    const outcome = await promise;
    expect(outcome.applied).toBe(1);
    // 引用已写入 → 该版本快照保留（ADR-0007）。
    expect(fs.files['__kb__/sources/src-1/deadbeef.md']).toBe(content);
    expect(Object.keys(manifest.topics)).toHaveLength(1);
  });

  it('does NOT write the snapshot when no valid claims are produced', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manifest: KbManifest = { goal: '目标', scope: [], sources: {}, topics: {} };
    llm.response = {
      topics: [
        {
          title: '窗口管理',
          mode: 'new',
          sections: [
            // 锚文本不在行范围内 → claim 被丢弃 → 无引用 → 无快照。
            { heading: '透明窗口', body: '', claims: [{ text: 'x', anchorText: '不存在的锚', startLine: 4, endLine: 4 }] },
          ],
        },
      ],
    };
    const { fs, promise } = run(manifest, { topics: [] });
    const outcome = await promise;
    expect(outcome.applied).toBe(0);
    expect(fs.files['__kb__/sources/src-1/deadbeef.md']).toBeUndefined();
    expect(Object.keys(manifest.topics)).toHaveLength(0);
    warn.mockRestore();
  });
});
