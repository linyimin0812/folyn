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
