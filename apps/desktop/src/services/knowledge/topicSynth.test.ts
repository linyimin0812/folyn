import { describe, it, expect, vi } from 'vitest';
import { validateClaims, buildTopicContent, parseTopicPage, serializeTopicPage, synthTopicsForSource, synthProposalDetailLine, synthOutcomeDetailLine } from './topicSynth';
import type { KbFs } from './kbFs';
import { sha256Hex } from './kbFs';
import type { KbManifest, KbNavigation, KbRef, KbReviewItem } from './kbTypes';

// 模型响应注入（synthTopicsForSource 内部走 kbChatJson）。
const llm = vi.hoisted(() => ({ response: {} as unknown }));
vi.mock('./kbLlm', () => ({ kbChatJson: async () => llm.response }));

const SOURCE = ['标题行', '第二行：窗口管理', '第三行', '第四行：透明窗口', ''];

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
        claimText: '支持透明窗口',
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

describe('synthTopicsForSource — 命中删除意图的提议转恢复建议（切片 C）', () => {
  const TP_ID = 'tp-1';
  const PAGE_PATH = '__kb__/topics/tp-1.md';
  const REFS_PATH = '__kb__/topics/tp-1.refs.json';

  function setup(deletions: unknown[], lastProgramHash: string | null) {
    const fs = memFs();
    const manifest: KbManifest = {
      goal: '目标',
      scope: [],
      sources: { 'src-1': { path: 'notes/a.md', currentHash: 'deadbeef', indexVersion: 1 } },
      topics: { [TP_ID]: { path: PAGE_PATH, title: '窗口管理', lastProgramHash } },
    };
    fs.files[PAGE_PATH] = serializeTopicPage(
      { id: TP_ID, title: '窗口管理', sources: ['src-1'] },
      '# 窗口管理\n\n- 旧结论 [^c1]\n\n[^c1]: src-1 · notes/a.md · L1-L1 · 旧锚\n',
    );
    fs.files[REFS_PATH] = JSON.stringify([
      {
        id: 'c1',
        topicId: TP_ID,
        anchorText: '旧锚',
        claimText: '旧结论',
        srcId: 'src-1',
        srcPath: 'notes/a.md',
        versionHash: 'deadbeef',
        startLine: 1,
        endLine: 1,
        status: 'active',
      },
    ]);
    fs.files['__kb__/deletions.json'] = JSON.stringify(deletions);
    return { fs, manifest };
  }

  const APPEND_RESPONSE = {
    topics: [
      {
        title: '窗口管理',
        mode: 'append',
        sections: [
          {
            heading: '透明窗口',
            body: '',
            claims: [
              // 第一条命中删除意图（锚文本「透明窗口」），第二条不受影响。
              { text: '支持透明窗口', anchorText: '透明窗口', startLine: 4, endLine: 4 },
              { text: '第二个结论', anchorText: '第二行', startLine: 2, endLine: 2 },
            ],
          },
        ],
      },
    ],
  };

  it('命中意图的 claim 不自动写入，转 restore-suggestion 审阅；其余正常追加', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { fs, manifest } = setup([{ id: 'del-1', topicId: TP_ID, anchorText: '透明窗口', createdAt: 1 }], null);
    llm.response = APPEND_RESPONSE;
    const outcome = await synthTopicsForSource({
      fs, manifest, nav: { topics: [] }, goal: '目标',
      srcId: 'src-1', srcPath: 'notes/a.md', versionHash: 'deadbeef',
      nodes: [{ title: 'A', summary: 'a', startLine: 1, endLine: 5 }], content: SOURCE.join('\n'),
    });

    // 未被阻断的 claim 正常追加（lastProgramHash 为 null → 允许自动写入）。
    expect(outcome.applied).toBe(1);
    const page = fs.files[PAGE_PATH]!;
    expect(page).toContain('- 旧结论 [^c1]');
    expect(page).toContain('- 第二个结论 [^c2]');
    expect(page).not.toContain('支持透明窗口');

    // 命中意图的 claim 落成恢复建议审阅（含原文依据与 topicHash 复核值）。
    const reviews = JSON.parse(fs.files['__kb__/reviews.json']!) as KbReviewItem[];
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ topicId: TP_ID, reason: 'restore-suggestion', status: 'pending' });
    expect(reviews[0]!.refs).toHaveLength(1);
    expect(reviews[0]!.refs![0]).toMatchObject({ anchorText: '透明窗口', srcId: 'src-1' });
    expect(reviews[0]!.proposedMarkdown).toContain('支持透明窗口');
    expect(reviews[0]!.topicHash).toBeDefined();
    info.mockRestore();
  });

  it('全部 claim 命中意图 → 只生成恢复建议，不自动写入', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { fs, manifest } = setup([{ id: 'del-1', topicId: TP_ID, anchorText: '透明窗口', createdAt: 1 }], null);
    llm.response = {
      topics: [
        {
          title: '窗口管理',
          mode: 'append',
          sections: [
            { heading: '透明窗口', body: '', claims: [{ text: '支持透明窗口', anchorText: '透明窗口', startLine: 4, endLine: 4 }] },
          ],
        },
      ],
    };
    const outcome = await synthTopicsForSource({
      fs, manifest, nav: { topics: [] }, goal: '目标',
      srcId: 'src-1', srcPath: 'notes/a.md', versionHash: 'deadbeef',
      nodes: [{ title: 'A', summary: 'a', startLine: 1, endLine: 5 }], content: SOURCE.join('\n'),
    });
    expect(outcome.applied).toBe(0);
    expect(fs.files[PAGE_PATH]).toContain('旧结论');
    expect(fs.files[PAGE_PATH]).not.toContain('支持透明窗口');
    const reviews = JSON.parse(fs.files['__kb__/reviews.json']!) as KbReviewItem[];
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.reason).toBe('restore-suggestion');
    info.mockRestore();
  });

  it('删除意图属于其他主题 → 不阻断本主题的追加', async () => {
    const { fs, manifest } = setup([{ id: 'del-1', topicId: 'tp-other', anchorText: '透明窗口', createdAt: 1 }], null);
    llm.response = APPEND_RESPONSE;
    const outcome = await synthTopicsForSource({
      fs, manifest, nav: { topics: [] }, goal: '目标',
      srcId: 'src-1', srcPath: 'notes/a.md', versionHash: 'deadbeef',
      nodes: [{ title: 'A', summary: 'a', startLine: 1, endLine: 5 }], content: SOURCE.join('\n'),
    });
    expect(outcome.applied).toBe(1);
    expect(outcome.reviews).toHaveLength(0);
    expect(fs.files[PAGE_PATH]).toContain('支持透明窗口');
  });
});

describe('synthTopicsForSource — 重复佐证补引用（不重复生成正文，ADR-0006）', () => {
  const TP_ID = 'tp-1';
  const PAGE_PATH = '__kb__/topics/tp-1.md';
  const REFS_PATH = '__kb__/topics/tp-1.refs.json';

  const C1: KbRef = {
    id: 'c1', topicId: TP_ID, anchorText: '旧锚', claimText: '旧结论',
    srcId: 'src-1', srcPath: 'notes/a.md', versionHash: 'deadbeef',
    startLine: 1, endLine: 1, status: 'active',
  };

  interface DupSetupOpts {
    refs?: KbRef[];
    pageBody?: string;
    lastProgramHash?: string | null;
  }

  async function setup(opts: DupSetupOpts = {}) {
    const fs = memFs();
    const page = serializeTopicPage(
      { id: TP_ID, title: '窗口管理', sources: ['src-1'] },
      opts.pageBody ?? '# 窗口管理\n\n- 旧结论 [^c1]\n\n[^c1]: src-1 · notes/a.md · L1-L1 · 旧锚\n',
    );
    const manifest: KbManifest = {
      goal: '目标',
      scope: [],
      sources: { 'src-2': { path: 'notes/b.md', currentHash: 'h2', indexVersion: 1 } },
      topics: { [TP_ID]: { path: PAGE_PATH, title: '窗口管理', lastProgramHash: opts.lastProgramHash ?? await sha256Hex(page) } },
    };
    fs.files[PAGE_PATH] = page;
    fs.files[REFS_PATH] = JSON.stringify(opts.refs ?? [C1]);
    return { fs, manifest, page };
  }

  function run(fs: KbFs, manifest: KbManifest) {
    return synthTopicsForSource({
      fs, manifest, nav: { topics: [] }, goal: '目标',
      srcId: 'src-2', srcPath: 'notes/b.md', versionHash: 'h2',
      nodes: [{ title: 'A', summary: 'a', startLine: 1, endLine: 5 }], content: SOURCE.join('\n'),
    });
  }

  const dupProposal = (text: string) => ({
    topics: [
      {
        title: '窗口管理',
        mode: 'append' as const,
        sections: [
          { heading: '透明窗口', body: '', claims: [{ text, anchorText: '透明窗口', startLine: 4, endLine: 4 }] },
        ],
      },
    ],
  });

  it('命中既有结论：正文不重复生成，[^c1] 后补 [^c2] 与 refs/脚注', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { fs, manifest } = await setup();
    llm.response = dupProposal('旧结论');
    const outcome = await run(fs, manifest);
    expect(outcome.applied).toBe(1);

    const page = fs.files[PAGE_PATH]!;
    expect(page).toContain('- 旧结论 [^c1] [^c2]');
    expect(page.match(/- 旧结论/g)).toHaveLength(1); // 不追加重复正文行
    expect(page).not.toContain('## 透明窗口'); // 无新章节
    expect(page).toContain('[^c1]: src-1 · notes/a.md · L1-L1 · 旧锚');
    expect(page).toContain('[^c2]: src-2 · notes/b.md · L4-L4 · 透明窗口');
    expect(parseTopicPage(page).fm.sources).toEqual(['src-1', 'src-2']);

    const refs = JSON.parse(fs.files[REFS_PATH]!) as KbRef[];
    expect(refs.map((r) => r.id)).toEqual(['c1', 'c2']);
    expect(refs[1]).toMatchObject({
      claimText: '旧结论', anchorText: '透明窗口', srcId: 'src-2',
      versionHash: 'h2', startLine: 4, endLine: 4, status: 'active',
    });
    // 引用已落盘 → 版本快照保留（ADR-0007）。
    expect(fs.files['__kb__/sources/src-2/h2.md']).toBe(SOURCE.join('\n'));
    info.mockRestore();
  });

  it('未命中既有结论：走常规追加（新 bullet + 接续编号）', async () => {
    const { fs, manifest } = await setup();
    llm.response = dupProposal('全新结论');
    const outcome = await run(fs, manifest);
    expect(outcome.applied).toBe(1);
    const page = fs.files[PAGE_PATH]!;
    expect(page).toContain('- 旧结论 [^c1]');
    expect(page).toContain('- 全新结论 [^c2]');
    expect(page).toContain('## 透明窗口');
    const refs = JSON.parse(fs.files[REFS_PATH]!) as KbRef[];
    expect(refs.map((r) => r.id)).toEqual(['c1', 'c2']);
  });

  it('目标页被用户编辑过 → 补引用降级为 add-ref 审阅，不写正文', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fs, manifest, page } = await setup({ lastProgramHash: 'stale-program-hash' });
    llm.response = dupProposal('旧结论');
    const outcome = await run(fs, manifest);
    expect(outcome.applied).toBe(0);
    expect(fs.files[PAGE_PATH]).toBe(page); // 页面未写入
    expect(fs.files['__kb__/sources/src-2/h2.md']).toBeUndefined(); // 无引用落盘 → 无快照

    const reviews = JSON.parse(fs.files['__kb__/reviews.json']!) as KbReviewItem[];
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ topicId: TP_ID, reason: 'add-ref', status: 'pending' });
    expect(reviews[0]!.refs).toHaveLength(1);
    expect(reviews[0]!.refs![0]).toMatchObject({
      claimText: '旧结论', anchorText: '透明窗口', srcId: 'src-2', versionHash: 'h2', startLine: 4,
    });
    expect(reviews[0]!.topicHash).toBeDefined();
    warn.mockRestore();
  });

  it('新标记取页内未用的最小编号（既有 c1/c3 → 补 c2），编号不冲突', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const C3: KbRef = {
      ...C1, id: 'c3', anchorText: '锚三', claimText: '另一结论', startLine: 2, endLine: 2,
    };
    const { fs, manifest } = await setup({
      refs: [C1, C3],
      pageBody: '# 窗口管理\n\n- 旧结论 [^c1]\n- 另一结论 [^c3]\n\n[^c1]: src-1 · notes/a.md · L1-L1 · 旧锚\n[^c3]: src-1 · notes/a.md · L2-L2 · 锚三\n',
    });
    llm.response = dupProposal('旧结论');
    const outcome = await run(fs, manifest);
    expect(outcome.applied).toBe(1);
    const page = fs.files[PAGE_PATH]!;
    expect(page).toContain('- 旧结论 [^c1] [^c2]');
    expect(page).toContain('- 另一结论 [^c3]');
    // 页内每个脚注定义恰好一次，编号互不冲突。
    for (const id of ['c1', 'c2', 'c3']) {
      expect(page.match(new RegExp(`\\[\\^${id}\\](?!:)`, 'g'))).toHaveLength(1);
    }
    const refs = JSON.parse(fs.files[REFS_PATH]!) as KbRef[];
    expect(refs.map((r) => r.id)).toEqual(['c1', 'c3', 'c2']);
    info.mockRestore();
  });

  it('标记/脚注定义出现在代码围栏内：不误配、不剥离，补到围栏外的真实结论行', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    // 围栏内是用户写的「脚注语法示例」—— 正文里 [^c1] 首次出现在围栏内，
    // 补引用必须跳过它，落在围栏外的真实结论行；围栏内的 `[^c1]:` 行也不能
    // 被 stripFootnoteDefs 剥掉（那是用户内容，删了 = 写坏页面）。
    const { fs, manifest } = await setup({
      pageBody: [
        '# 窗口管理',
        '',
        '```markdown',
        '示例：- 旧结论 [^c1]',
        '[^c1]: src-1 · notes/a.md · L1-L1 · 旧锚',
        '```',
        '',
        '- 旧结论 [^c1]',
        '',
        '[^c1]: src-1 · notes/a.md · L1-L1 · 旧锚',
      ].join('\n'),
    });
    llm.response = dupProposal('旧结论');
    const outcome = await run(fs, manifest);
    expect(outcome.applied).toBe(1);
    const page = fs.files[PAGE_PATH]!;
    // 真实结论行补上 [^c2]；围栏内示例原样保留（未被补标记、未被剥离）。
    expect(page.match(/- 旧结论 \[\^c1\] \[\^c2\]/g)).toHaveLength(1);
    expect(page).toContain('示例：- 旧结论 [^c1]');
    // 围栏内的示例脚注定义行保留；程序重建的定义恰好一条 → 共 2 处 [^c1]:。
    expect(page.match(/\[\^c1\]:/g)).toHaveLength(2);
    const refs = JSON.parse(fs.files[REFS_PATH]!) as KbRef[];
    expect(refs.map((r) => r.id)).toEqual(['c1', 'c2']);
    info.mockRestore();
  });

  it('同一提议混合重复与新结论：补引用 + 常规追加各自生效', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { fs, manifest } = await setup();
    llm.response = {
      topics: [
        {
          title: '窗口管理',
          mode: 'append',
          sections: [
            {
              heading: '透明窗口',
              body: '',
              claims: [
                { text: '旧结论', anchorText: '透明窗口', startLine: 4, endLine: 4 },
                { text: '全新结论', anchorText: '第二行', startLine: 2, endLine: 2 },
              ],
            },
          ],
        },
      ],
    };
    const outcome = await run(fs, manifest);
    expect(outcome.applied).toBe(1);
    const page = fs.files[PAGE_PATH]!;
    expect(page).toContain('- 旧结论 [^c1] [^c2]'); // 重复佐证 → 补标记
    expect(page).toContain('- 全新结论 [^c3]'); // 新结论 → 追加正文
    expect(page).toContain('## 透明窗口');
    const refs = JSON.parse(fs.files[REFS_PATH]!) as KbRef[];
    expect(refs.map((r) => r.id)).toEqual(['c1', 'c2', 'c3']);
    expect(refs[2]).toMatchObject({ claimText: '全新结论', startLine: 2 });
    info.mockRestore();
  });
});

describe('synthTopicsForSource — 详细过程上报（hooks，真实数据行）', () => {
  it('detail 行纯函数输出稳定文案', () => {
    expect(synthProposalDetailLine(3)).toBe('模型提议 3 个主题');
    expect(synthOutcomeDetailLine(2, 1, 1)).toBe('合成提议：新增 2 / 补引用 1 / 审阅 1');
  });

  it('按块上报行范围、提议数与整份结果，数据来自真实返回值', async () => {
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
    const lines: string[] = [];
    const outcome = await synthTopicsForSource({
      fs: memFs(),
      manifest,
      nav: { topics: [] },
      goal: '目标',
      srcId: 'src-1',
      srcPath: 'notes/a.md',
      versionHash: 'deadbeef',
      nodes: [{ title: 'A', summary: 'a', startLine: 1, endLine: 5 }],
      content: SOURCE.join('\n'),
      hooks: { onDetail: (line) => lines.push(line) },
    });
    expect(outcome.applied).toBe(1);
    expect(lines).toEqual([
      '合成块 1/1（第 1–5 行）',
      '模型提议 1 个主题',
      '合成提议：新增 1 / 补引用 0 / 审阅 0',
    ]);
  });
});
