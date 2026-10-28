import { describe, it, expect, beforeEach, vi } from 'vitest';

// 模型响应注入（verifyTopicRef 内部走 kbChatJson）。
const llm = vi.hoisted(() => ({ response: {} as unknown }));
vi.mock('./kbLlm', () => ({ kbChatJson: async () => llm.response }));

import { verifyTopicRef } from './kbVerify';
import { readTopicRefs, sha256Hex } from './kbFs';
import { kbTopicPagePath, kbTopicRefsPath, kbSourceSnapshotPath } from './kbPaths';
import { serializeTopicPage } from './topicSynth';
import type { KbFs } from './kbFs';
import type { KbRef } from './kbTypes';

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
const REFS_PATH = kbTopicRefsPath(TP_ID);
const SNAPSHOT_PATH = kbSourceSnapshotPath('src-1', 'h1');

const REF: KbRef = {
  id: 'c1',
  topicId: TP_ID,
  anchorText: '透明窗口',
  claimText: '支持透明窗口',
  srcId: 'src-1',
  srcPath: 'notes/a.md',
  versionHash: 'h1',
  startLine: 2,
  endLine: 3,
  status: 'unverified',
};

const PAGE = serializeTopicPage(
  { id: TP_ID, title: '窗口管理', sources: ['src-1'] },
  '# 窗口管理\n\n- 支持透明窗口 [^c1]\n\n[^c1]: src-1 · notes/a.md · L2-L3 · 透明窗口\n',
);

function seed(fs: ReturnType<typeof memFs>, over: { removed?: boolean; currentHash?: string } = {}): void {
  fs.files[PAGE_PATH] = PAGE;
  fs.files[REFS_PATH] = JSON.stringify([REF]);
  fs.files[SNAPSHOT_PATH] = ['第一行', '第二行：透明窗口', '第三行'].join('\n');
  fs.files['notes/a.md'] = ['第一行', '第二行：透明窗口', '第三行'].join('\n');
  fs.files['__kb__/manifest.json'] = JSON.stringify({
    goal: '目标',
    scope: [],
    sources: {
      'src-1': {
        path: 'notes/a.md',
        currentHash: over.currentHash ?? 'h1',
        indexVersion: 1,
        ...(over.removed ? { removed: true } : {}),
      },
    },
    topics: { [TP_ID]: { path: PAGE_PATH, title: '窗口管理', lastProgramHash: 'x' } },
  });
}

beforeEach(() => {
  llm.response = { supported: true, reason: '原文明确提到透明窗口。' };
});

describe('verifyTopicRef — 引用核验（ADR-0007）', () => {
  it('原文支持 → 状态 verified，理由落盘', async () => {
    const fs = memFs();
    seed(fs);
    const outcome = await verifyTopicRef(fs, REF, PAGE_PATH);
    expect(outcome).toEqual({ ok: true, supported: true, reason: '原文明确提到透明窗口。' });
    const refs = await readTopicRefs(fs, TP_ID);
    expect(refs[0]).toMatchObject({ id: 'c1', status: 'verified', verifyNote: '原文明确提到透明窗口。' });
  });

  it('原文不支持 → 状态 unsupported（正文保留，改写须经审阅）', async () => {
    llm.response = { supported: false, reason: '原文只提到窗口，未提透明。' };
    const fs = memFs();
    seed(fs);
    const outcome = await verifyTopicRef(fs, REF, PAGE_PATH);
    expect(outcome).toMatchObject({ ok: true, supported: false });
    const refs = await readTopicRefs(fs, TP_ID);
    expect(refs[0]).toMatchObject({ status: 'unsupported', verifyNote: '原文只提到窗口，未提透明。' });
  });

  it('来源已移除（停止跟踪）→ 不核验，refs 不动', async () => {
    const fs = memFs();
    seed(fs, { removed: true });
    const outcome = await verifyTopicRef(fs, REF, PAGE_PATH);
    expect(outcome).toMatchObject({ ok: false, reason: 'source-removed' });
    const refs = await readTopicRefs(fs, TP_ID);
    expect(refs[0]).toMatchObject({ status: 'unverified' });
  });

  it('快照缺失且当前版本与引用时不一致 → 如实失败', async () => {
    const fs = memFs();
    seed(fs, { currentHash: 'h2' });
    delete fs.files[SNAPSHOT_PATH];
    const outcome = await verifyTopicRef(fs, REF, PAGE_PATH);
    expect(outcome).toMatchObject({ ok: false, reason: 'snapshot-missing' });
    expect(await readTopicRefs(fs, TP_ID)).toMatchObject([{ status: 'unverified' }]);
  });

  it('快照缺失但当前文件确与引用时版本一致 → 回退用当前原文', async () => {
    const fs = memFs();
    const content = ['第一行', '第二行：透明窗口', '第三行'].join('\n');
    const h = await sha256Hex(content);
    seed(fs, { currentHash: h });
    fs.files['notes/a.md'] = content;
    const ref = { ...REF, versionHash: h };
    fs.files[REFS_PATH] = JSON.stringify([ref]);
    const outcome = await verifyTopicRef(fs, ref, PAGE_PATH);
    expect(outcome).toMatchObject({ ok: true, supported: true });
  });

  it('快照缺失、manifest 一致但磁盘内容已漂移 → 如实失败，不用错版原文核验', async () => {
    const fs = memFs();
    seed(fs, { currentHash: 'h1' }); // manifest 声称当前版本即引用版本
    delete fs.files[SNAPSHOT_PATH]; // 快照缺失 → 走当前文件回退
    fs.files['notes/a.md'] = '第一行\n磁盘已被改过\n第三行'; // 实际内容漂移
    const outcome = await verifyTopicRef(fs, REF, PAGE_PATH);
    expect(outcome).toMatchObject({ ok: false, reason: 'snapshot-missing' });
    expect(await readTopicRefs(fs, TP_ID)).toMatchObject([{ status: 'unverified' }]);
  });

  it('正文中已无该引用标记的段落 → paragraph-missing', async () => {
    const fs = memFs();
    seed(fs);
    fs.files[PAGE_PATH] = serializeTopicPage(
      { id: TP_ID, title: '窗口管理', sources: ['src-1'] },
      '# 窗口管理\n\n（该结论已被删除）\n',
    );
    const outcome = await verifyTopicRef(fs, REF, PAGE_PATH);
    expect(outcome).toMatchObject({ ok: false, reason: 'paragraph-missing' });
  });

  it('模型返回无效 → error，refs 不动', async () => {
    llm.response = { supported: 'yes' };
    const fs = memFs();
    seed(fs);
    const outcome = await verifyTopicRef(fs, REF, PAGE_PATH);
    expect(outcome).toMatchObject({ ok: false, reason: 'error' });
    expect(await readTopicRefs(fs, TP_ID)).toMatchObject([{ status: 'unverified' }]);
  });
});
