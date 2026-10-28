import { describe, it, expect } from 'vitest';
import { applyReview, discardReview } from './kbReviewActions';
import { sha256Hex, readTopicRefs, readReviews } from './kbFs';
import { kbTopicPagePath, kbTopicRefsPath } from './kbPaths';
import { parseTopicPage, serializeTopicPage } from './topicSynth';
import type { KbFs } from './kbFs';
import type { KbManifest, KbRef, KbReviewItem } from './kbTypes';

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

const TP_ID = 'tp-1';
const PAGE_PATH = kbTopicPagePath(TP_ID);

const CURRENT_PAGE = serializeTopicPage(
  { id: TP_ID, title: '窗口管理', sources: ['src-1'] },
  '# 窗口管理\n\n- 旧结论 [^c1]\n\n[^c1]: src-1 · notes/old.md · L1-L1 · 旧锚\n',
);

const EXISTING_REF: KbRef = {
  id: 'c1',
  topicId: TP_ID,
  anchorText: '旧锚',
  srcId: 'src-1',
  srcPath: 'notes/old.md',
  versionHash: 'h1',
  startLine: 1,
  endLine: 1,
  status: 'active',
};

const PROPOSAL_PAGE = serializeTopicPage(
  { id: TP_ID, title: '窗口管理', sources: ['src-1', 'src-2'] },
  '## 透明窗口\n\n- 新结论 [^c1]\n\n[^c1]: src-2 · notes/new.md · L4-L4 · 透明窗口\n',
);

const PROPOSAL_REFS: KbRef[] = [
  {
    id: 'c1',
    topicId: TP_ID,
    anchorText: '透明窗口',
    srcId: 'src-2',
    srcPath: 'notes/new.md',
    versionHash: 'h2',
    startLine: 4,
    endLine: 4,
    status: 'active',
  },
];

function makeReview(topicHash?: string): KbReviewItem {
  const review: KbReviewItem = {
    id: 'rev-1',
    topicId: TP_ID,
    topicPath: PAGE_PATH,
    reason: 'user-edited',
    proposedMarkdown: PROPOSAL_PAGE,
    refs: PROPOSAL_REFS,
    createdAt: 1,
    status: 'pending',
  };
  if (topicHash) review.topicHash = topicHash;
  return review;
}

function seed(fs: KbFs & { files: Record<string, string> }, manifest?: KbManifest): KbManifest {
  fs.files[PAGE_PATH] = CURRENT_PAGE;
  fs.files[kbTopicRefsPath(TP_ID)] = JSON.stringify([EXISTING_REF]);
  const m: KbManifest = manifest ?? {
    goal: '目标',
    scope: [],
    sources: {},
    topics: { [TP_ID]: { path: PAGE_PATH, title: '窗口管理', lastProgramHash: 'stale-program-hash' } },
  };
  fs.files['__kb__/manifest.json'] = JSON.stringify(m);
  fs.files['__kb__/reviews.json'] = JSON.stringify([]);
  return m;
}

describe('applyReview — 程序写入 + 版本复核', () => {
  it('merges the proposal, renumbers [^cN] markers, updates refs/manifest, removes the review', async () => {
    const fs = memFs();
    const manifest = seed(fs);
    const review = makeReview(await sha256Hex(CURRENT_PAGE));
    fs.files['__kb__/reviews.json'] = JSON.stringify([review]);

    const outcome = await applyReview(fs, review);
    expect(outcome.ok).toBe(true);

    const page = fs.files[PAGE_PATH]!;
    // 旧结论保持 c1；提议的 c1 重编为 c2（接续已有引用，避免撞号）。
    expect(page).toContain('- 旧结论 [^c1]');
    expect(page).toContain('- 新结论 [^c2]');
    expect(page).toContain('[^c1]: src-1 · notes/old.md · L1-L1 · 旧锚');
    expect(page).toContain('[^c2]: src-2 · notes/new.md · L4-L4 · 透明窗口');
    // 页内旧脚注定义只出现一次（提议页脚注已剥离，重编后追加）。
    expect(page.match(/\[\^c1\]:/g)).toHaveLength(1);

    const refs = await readTopicRefs(fs, TP_ID);
    expect(refs.map((r) => r.id)).toEqual(['c1', 'c2']);
    expect(refs[1]).toMatchObject({ srcId: 'src-2', versionHash: 'h2', topicId: TP_ID });

    // manifest.lastProgramHash 复核后更新（后续自动追加恢复正常）。
    const updated = JSON.parse(fs.files['__kb__/manifest.json']!) as KbManifest;
    expect(updated.topics[TP_ID]!.lastProgramHash).toBe(await sha256Hex(page));
    expect(updated.topics[TP_ID]!.title).toBe('窗口管理');
    expect(manifest).toBeDefined();

    // 审阅记录被移除。
    expect(await readReviews(fs)).toEqual([]);
  });

  it('renumber 是单遍替换：新编号落在提议旧编号区间内时不链式误替换', async () => {
    // 已有 1 条引用（c1），提议含 2 条（c1、c2）→ 重编为 c2、c3。
    // 逐个 split/join 会把先改好的 [^c2] 再改成 [^c3]（两条 claim 撞到同一引用）。
    const fs = memFs();
    seed(fs);
    const proposalPage = serializeTopicPage(
      { id: TP_ID, title: '窗口管理', sources: ['src-2'] },
      '## 多结论\n\n- 结论A [^c1]\n- 结论B [^c2]\n\n[^c1]: src-2 · notes/new.md · L4-L4 · 锚A\n[^c2]: src-2 · notes/new.md · L5-L5 · 锚B\n',
    );
    const proposalRefs: KbRef[] = [
      { id: 'c1', topicId: TP_ID, anchorText: '锚A', srcId: 'src-2', srcPath: 'notes/new.md', versionHash: 'h2', startLine: 4, endLine: 4, status: 'active' },
      { id: 'c2', topicId: TP_ID, anchorText: '锚B', srcId: 'src-2', srcPath: 'notes/new.md', versionHash: 'h2', startLine: 5, endLine: 5, status: 'active' },
    ];
    const review: KbReviewItem = {
      ...makeReview(await sha256Hex(CURRENT_PAGE)),
      proposedMarkdown: proposalPage,
      refs: proposalRefs,
    };

    const outcome = await applyReview(fs, review);
    expect(outcome.ok).toBe(true);

    const page = fs.files[PAGE_PATH]!;
    // 结论A → c2（src-2 L4），结论B → c3（src-2 L5）；页内标记与 refs 一一对应。
    expect(page).toContain('- 结论A [^c2]');
    expect(page).toContain('- 结论B [^c3]');
    const refs = await readTopicRefs(fs, TP_ID);
    expect(refs.map((r) => r.id)).toEqual(['c1', 'c2', 'c3']);
    expect(refs[1]).toMatchObject({ srcId: 'src-2', startLine: 4 });
    expect(refs[2]).toMatchObject({ srcId: 'src-2', startLine: 5 });
    // 页内每个脚注定义恰好被引用一次。
    for (const id of ['c1', 'c2', 'c3']) {
      expect(page.match(new RegExp(`\\[\\^${id}\\](?!:)`, 'g'))).toHaveLength(1);
    }
  });

  it('stale: 页面在修订生成后被修改 → 不写入，保留审阅记录', async () => {
    const fs = memFs();
    seed(fs);
    const review = makeReview('hash-at-review-time');
    fs.files['__kb__/reviews.json'] = JSON.stringify([review]);

    const outcome = await applyReview(fs, review);
    expect(outcome).toMatchObject({ ok: false, reason: 'stale' });
    // 正文未被改写。
    expect(fs.files[PAGE_PATH]).toBe(CURRENT_PAGE);
    expect(await readReviews(fs)).toHaveLength(1);
  });

  it('missing-page: 主题页不可读 → 如实失败', async () => {
    const fs = memFs();
    seed(fs);
    delete fs.files[PAGE_PATH];
    const review = makeReview();
    const outcome = await applyReview(fs, review);
    expect(outcome).toMatchObject({ ok: false, reason: 'missing-page' });
  });

  it('discards only the targeted review and never touches the page', async () => {
    const fs = memFs();
    seed(fs);
    const r1 = makeReview();
    r1.id = 'rev-1';
    const r2 = makeReview();
    r2.id = 'rev-2';
    fs.files['__kb__/reviews.json'] = JSON.stringify([r1, r2]);

    await discardReview(fs, r1);
    expect((await readReviews(fs)).map((r) => r.id)).toEqual(['rev-2']);
    expect(fs.files[PAGE_PATH]).toBe(CURRENT_PAGE);
  });

  it('refs 编号存在空缺（c1/c3）时重编接续最大编号，不与既有 c3 撞号', async () => {
    const fs = memFs();
    seed(fs);
    // 空缺编号：既有 c1、c3。旧算法 existingRefs.length + 1 = 3 → 新引用
    // 撞 c3（refs.json 重复 id + 页内重复脚注定义）。必须接续最大编号 → c4。
    fs.files[kbTopicRefsPath(TP_ID)] = JSON.stringify([
      EXISTING_REF,
      { ...EXISTING_REF, id: 'c3', anchorText: '锚三', startLine: 2, endLine: 2 },
    ]);
    const review = makeReview(await sha256Hex(CURRENT_PAGE));

    const outcome = await applyReview(fs, review);
    expect(outcome.ok).toBe(true);
    const refs = await readTopicRefs(fs, TP_ID);
    expect(refs.map((r) => r.id)).toEqual(['c1', 'c3', 'c4']);
    const page = fs.files[PAGE_PATH]!;
    expect(page).toContain('- 新结论 [^c4]');
    expect(page.match(/\[\^c3\]:/g)).toHaveLength(1);
    expect(page.match(/\[\^c4\]:/g)).toHaveLength(1);
  });

  it('applies a legacy review without topicHash/refs (schema 兼容：optional 字段缺省)', async () => {
    const fs = memFs();
    seed(fs);
    const review = makeReview(); // 再剥掉两个 optional 字段，模拟旧记录
    delete review.topicHash;
    delete review.refs;
    const outcome = await applyReview(fs, review);
    expect(outcome.ok).toBe(true);
    const refs = await readTopicRefs(fs, TP_ID);
    expect(refs).toEqual([EXISTING_REF]); // 无新增引用，refs 不变
    const page = fs.files[PAGE_PATH]!;
    expect(page).toContain('## 透明窗口');
    // 提议页自己的脚注定义行被剥离（无 refs 记录，不再重编）。
    expect(page.match(/\[\^c1\]:/g)).toHaveLength(1);
    const parsed = parseTopicPage(page);
    expect(parsed.fm.sources).toEqual(['src-1', 'src-2']);
  });
});

describe('applyReview — 编辑后采用 + 删除意图解除（切片 C）', () => {
  it('editedBody 替换提议正文（引用重编照旧），写入用户编辑后的文本', async () => {
    const fs = memFs();
    seed(fs);
    const review = makeReview(await sha256Hex(CURRENT_PAGE));
    const outcome = await applyReview(fs, review, { editedBody: '## 透明窗口\n\n- 用户改过的结论 [^c1]' });
    expect(outcome.ok).toBe(true);
    const page = fs.files[PAGE_PATH]!;
    expect(page).toContain('- 用户改过的结论 [^c2]');
    expect(page).not.toContain('新结论');
    // refs 照原提议（锚文本/行号不因正文编辑而变）。
    const refs = await readTopicRefs(fs, TP_ID);
    expect(refs[1]).toMatchObject({ anchorText: '透明窗口', startLine: 4 });
  });

  it('恢复建议采用后：解除命中的删除意图，未命中的保留', async () => {
    const fs = memFs();
    seed(fs);
    const review: KbReviewItem = {
      ...makeReview(await sha256Hex(CURRENT_PAGE)),
      reason: 'restore-suggestion',
    };
    fs.files['__kb__/deletions.json'] = JSON.stringify([
      { id: 'del-1', topicId: TP_ID, anchorText: '透明窗口', createdAt: 1 },
      { id: 'del-2', topicId: TP_ID, anchorText: '毫不相关的锚', createdAt: 2 },
      { id: 'del-3', topicId: 'tp-other', anchorText: '透明窗口', createdAt: 3 },
    ]);

    const outcome = await applyReview(fs, review);
    expect(outcome.ok).toBe(true);
    const deletions = JSON.parse(fs.files['__kb__/deletions.json']!) as { id: string }[];
    // 命中（同主题同锚）解除；其他主题的与未命中的保留。
    expect(deletions.map((d) => d.id)).toEqual(['del-2', 'del-3']);
  });

  it('discard（保留删除意图）：只移除审阅记录，deletions.json 原样', async () => {
    const fs = memFs();
    seed(fs);
    const review: KbReviewItem = {
      ...makeReview(),
      reason: 'restore-suggestion',
    };
    fs.files['__kb__/reviews.json'] = JSON.stringify([review]);
    fs.files['__kb__/deletions.json'] = JSON.stringify([
      { id: 'del-1', topicId: TP_ID, anchorText: '透明窗口', createdAt: 1 },
    ]);
    await discardReview(fs, review);
    expect(await readReviews(fs)).toEqual([]);
    expect(JSON.parse(fs.files['__kb__/deletions.json']!)).toHaveLength(1);
  });

  it('采用后补齐引用版本快照（ADR-0007）：当前原文与引用版本一致时落盘，漂移则不落', async () => {
    const fs = memFs();
    const content = '第四行：透明窗口\n';
    const h = await sha256Hex(content);
    const manifest: KbManifest = {
      goal: '目标',
      scope: [],
      sources: {
        'src-1': { path: 'notes/old.md', currentHash: 'h1', indexVersion: 1 },
        'src-2': { path: 'notes/new.md', currentHash: h, indexVersion: 1 },
        'src-3': { path: 'notes/drift.md', currentHash: 'h3', indexVersion: 1 },
      },
      topics: { [TP_ID]: { path: PAGE_PATH, title: '窗口管理', lastProgramHash: 'stale' } },
    };
    seed(fs, manifest);
    fs.files['notes/new.md'] = content;
    fs.files['notes/drift.md'] = '内容已漂移';
    const review = makeReview(await sha256Hex(CURRENT_PAGE));
    // 两条新引用：src-2 可取到正确版本，src-3 的 manifest hash 与 refs 记录
    // 一致但磁盘内容已漂移（手动改过未重建）→ 不落错版快照。
    review.refs = [
      { ...PROPOSAL_REFS[0]!, versionHash: h },
      { ...PROPOSAL_REFS[0]!, id: 'c2', srcId: 'src-3', srcPath: 'notes/drift.md', versionHash: 'h3' },
    ];

    const outcome = await applyReview(fs, review);
    expect(outcome.ok).toBe(true);
    expect(fs.files[`__kb__/sources/src-2/${h}.md`]).toBe(content);
    expect(fs.files['__kb__/sources/src-3/h3.md']).toBeUndefined();
  });
});

describe('applyReview — add-ref（重复佐证补引用降级审阅）', () => {
  // 既有引用无 claimText（旧记录）→ 目标匹配回退 anchorText「旧锚」。
  const ADD_REF_REF: KbRef = {
    id: 'c1',
    topicId: TP_ID,
    anchorText: '透明窗口',
    claimText: '旧锚',
    srcId: 'src-2',
    srcPath: 'notes/new.md',
    versionHash: 'h2',
    startLine: 4,
    endLine: 4,
    status: 'active',
  };

  function makeAddRefReview(topicHash: string, claimText = '旧锚'): KbReviewItem {
    return {
      ...makeReview(topicHash),
      reason: 'add-ref',
      refs: [{ ...ADD_REF_REF, claimText }],
    };
  }

  it('采用：只补标记与 refs/脚注，不追加正文，不解锁删除意图', async () => {
    const fs = memFs();
    seed(fs);
    fs.files['__kb__/deletions.json'] = JSON.stringify([
      { id: 'del-1', topicId: TP_ID, anchorText: '透明窗口', createdAt: 1 },
    ]);
    const review = makeAddRefReview(await sha256Hex(CURRENT_PAGE));
    fs.files['__kb__/reviews.json'] = JSON.stringify([review]);

    const outcome = await applyReview(fs, review);
    expect(outcome.ok).toBe(true);

    const page = fs.files[PAGE_PATH]!;
    expect(page).toContain('- 旧结论 [^c1] [^c2]');
    expect(page).not.toContain('新结论'); // 不追加提议正文
    expect(page).toContain('[^c1]: src-1 · notes/old.md · L1-L1 · 旧锚');
    expect(page).toContain('[^c2]: src-2 · notes/new.md · L4-L4 · 透明窗口');

    const refs = await readTopicRefs(fs, TP_ID);
    expect(refs.map((r) => r.id)).toEqual(['c1', 'c2']);
    expect(refs[1]).toMatchObject({ claimText: '旧锚', anchorText: '透明窗口', srcId: 'src-2', versionHash: 'h2', status: 'active' });

    // add-ref 无正文恢复语义 → 删除意图不解锁；审阅记录移除；manifest hash 更新。
    expect(JSON.parse(fs.files['__kb__/deletions.json']!)).toHaveLength(1);
    expect(await readReviews(fs)).toEqual([]);
    const m = JSON.parse(fs.files['__kb__/manifest.json']!) as KbManifest;
    expect(m.topics[TP_ID]!.lastProgramHash).toBe(await sha256Hex(page));
  });

  it('目标结论已不在引用记录中 → stale 失败，正文与审阅记录保留', async () => {
    const fs = memFs();
    seed(fs);
    const review = makeAddRefReview(await sha256Hex(CURRENT_PAGE), '毫不相关的结论');
    fs.files['__kb__/reviews.json'] = JSON.stringify([review]);

    const outcome = await applyReview(fs, review);
    expect(outcome).toMatchObject({ ok: false, reason: 'stale' });
    expect(fs.files[PAGE_PATH]).toBe(CURRENT_PAGE);
    expect(await readReviews(fs)).toHaveLength(1);
  });

  it('目标结论的标记已被用户从正文删除 → stale 失败，不误配其他标记', async () => {
    const fs = memFs();
    seed(fs);
    const edited = serializeTopicPage(
      { id: TP_ID, title: '窗口管理', sources: ['src-1'] },
      '# 窗口管理\n\n- 旧结论（标记已被删）\n',
    );
    fs.files[PAGE_PATH] = edited;
    const review = makeAddRefReview(await sha256Hex(edited));
    fs.files['__kb__/reviews.json'] = JSON.stringify([review]);

    const outcome = await applyReview(fs, review);
    expect(outcome).toMatchObject({ ok: false, reason: 'stale' });
    expect(fs.files[PAGE_PATH]).toBe(edited);
    expect(await readReviews(fs)).toHaveLength(1);
  });
});
