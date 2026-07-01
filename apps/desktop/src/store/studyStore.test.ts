import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStudyStore, collectDueAtoms, parseSuggestionText, materialDedupeKey } from './studyStore';
import { useVaultStore } from './vaultStore';
import { useSettingsStore } from './settingsStore';
import { storageClient } from '@/utils/storageClient';
import type { VaultEntry } from '@quill/vault-provider';
import { STUDY_DIR, slugifyTopic, buildEmptyStudyDoc, studyDocPath, extractSlug, type StudyTopicEntry } from '@/study/studyDoc';
import { parseStudy } from '@/study/markdown';

// 对标 vaultStore.test.ts 的 fake manager，提供 studyStore 用到的子集。
vi.mock('@/utils/fileWatcher', () => ({
  startVaultWatcher: vi.fn(async () => {}),
  stopVaultWatcher: vi.fn(async () => {}),
  suppressWatcherFor: vi.fn(),
  pauseWatcher: vi.fn(),
  resumeWatcher: vi.fn(),
}));
vi.mock('@/utils/pathResolver', () => ({
  resolveBasePath: vi.fn(async (p: string) => p.replace(/\/+$/, '')),
}));

function createFakeManager() {
  const files = new Map<string, string>();
  const tree: VaultEntry[] = [];
  return {
    files,
    tree,
    switchVault: vi.fn(async () => {}),
    createDir: vi.fn(async (path: string) => {
      if (path && !tree.some((e) => e.path === path && e.type === 'dir')) {
        tree.push({ path, name: path, type: 'dir' });
      }
    }),
    listFiles: vi.fn(async (dir: string) => {
      // 返回 tree 中直接位于 dir 下的条目（非递归）。
      const prefix = dir ? `${dir}/` : '';
      return tree.filter((e) => {
        const rel = e.path.startsWith(prefix) ? e.path.slice(prefix.length) : '';
        return rel.length > 0 && !rel.includes('/');
      });
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
      if (!tree.some((e) => e.path === path)) {
        tree.push({ path, name: path.split('/').pop() || path, type: 'file' });
      }
    }),
    readFile: vi.fn(async (path: string) => {
      if (!files.has(path)) throw new Error(`File not found: ${path}`);
      return files.get(path) as string;
    }),
    deleteFile: vi.fn(async (path: string) => {
      files.delete(path);
      const idx = tree.findIndex((e) => e.path === path);
      if (idx >= 0) tree.splice(idx, 1);
    }),
    reset() {
      files.clear();
      tree.length = 0;
    },
  };
}

type FakeManager = ReturnType<typeof createFakeManager>;

let manager: FakeManager;

beforeEach(() => {
  storageClient.__resetForTesting();
  useSettingsStore.setState({ dailyNotesDir: '__daily__', excludePatterns: '' });
  manager = createFakeManager();
  useVaultStore.setState({
    manager: manager as never,
    currentVault: { id: 'v1', name: 'a', providerType: 'tauri', basePath: '/a' } as never,
    fileTree: [],
  } as never);
  useStudyStore.setState({ topics: [], activeSlug: null, loading: false, error: null, suggestedUnits: [], pendingSuggestion: null });
});

describe('studyDoc helpers', () => {
  it('slugifyTopic keeps CJK and folds separators', () => {
    expect(slugifyTopic('Agent 开发')).toBe('agent-开发');
    expect(slugifyTopic('  React/Next.js! ')).toBe('react-next-js');
    expect(slugifyTopic('   ')).toBe('topic');
  });

  it('buildEmptyStudyDoc contains front-matter and four sections', () => {
    const doc = buildEmptyStudyDoc('Agent 开发', 'agent-开发', '2026-06-29');
    expect(doc).toContain('slug: agent-开发');
    expect(doc).toContain('## 资料');
    expect(doc).toContain('## 计划');
    expect(doc).toContain('## 笔记');
    expect(doc).toContain('## 复习');
  });

  it('studyDocPath joins dir and slug', () => {
    expect(studyDocPath('agent-dev')).toBe(`${STUDY_DIR}/agent-dev.md`);
  });

  it('extractSlug reads front-matter, falls back to stem', () => {
    const doc = buildEmptyStudyDoc('T', 'my-slug', '2026-06-29');
    expect(extractSlug(doc, 'fallback')).toBe('my-slug');
    expect(extractSlug('# no fm', 'fallback')).toBe('fallback');
  });
});

describe('useStudyStore.refresh', () => {
  it('returns empty state when study dir is missing', async () => {
    await useStudyStore.getState().refresh();
    const s = useStudyStore.getState();
    expect(s.topics).toEqual([]);
    expect(s.activeSlug).toBeNull();
    expect(s.loading).toBe(false);
  });

  it('scans 学习/*.md, parses each, and auto-selects the first topic', async () => {
    const doc = buildEmptyStudyDoc('Agent 开发', 'agent-dev', '2026-06-29');
    await useVaultStore.getState().createFile(studyDocPath('agent-dev'), doc);

    await useStudyStore.getState().refresh();
    const s = useStudyStore.getState();
    expect(s.topics).toHaveLength(1);
    expect(s.topics[0].slug).toBe('agent-dev');
    expect(s.topics[0].path).toBe(studyDocPath('agent-dev'));
    expect(s.activeSlug).toBe('agent-dev');
  });

  it('keeps activeSlug when still present, falls back otherwise', async () => {
    const a = buildEmptyStudyDoc('A', 'a', '2026-06-29');
    const b = buildEmptyStudyDoc('B', 'b', '2026-06-29');
    await useVaultStore.getState().createFile(studyDocPath('a'), a);
    await useVaultStore.getState().createFile(studyDocPath('b'), b);
    await useStudyStore.getState().refresh();
    useStudyStore.setState({ activeSlug: 'b' });

    // 删 a 后刷新：b 仍在，activeSlug 应保留 b。
    await useVaultStore.getState().deleteFile(studyDocPath('a'));
    await useStudyStore.getState().refresh();
    expect(useStudyStore.getState().activeSlug).toBe('b');

    // 删 b 后刷新：列表空，activeSlug 回退 null。
    await useVaultStore.getState().deleteFile(studyDocPath('b'));
    await useStudyStore.getState().refresh();
    expect(useStudyStore.getState().activeSlug).toBeNull();
  });

  it('skips non-markdown and unreadable files', async () => {
    manager.tree.push({ path: studyDocPath('good'), name: 'good.md', type: 'file' });
    manager.files.set(studyDocPath('good'), buildEmptyStudyDoc('Good', 'good', '2026-06-29'));
    manager.tree.push({ path: `${STUDY_DIR}/notes.txt`, name: 'notes.txt', type: 'file' });
    await useStudyStore.getState().refresh();
    expect(useStudyStore.getState().topics).toHaveLength(1);
  });
});

describe('useStudyStore.createTopic', () => {
  it('creates dir + file with empty doc and selects the new slug', async () => {
    const slug = await useStudyStore.getState().createTopic('Agent 开发');
    expect(slug).toBe('agent-开发');
    expect(manager.createDir).toHaveBeenCalledWith(STUDY_DIR);
    expect(manager.writeFile).toHaveBeenCalledWith(
      studyDocPath('agent-开发'),
      expect.stringContaining('slug: agent-开发'),
    );
    const s = useStudyStore.getState();
    expect(s.topics).toHaveLength(1);
    expect(s.activeSlug).toBe('agent-开发');
  });

  it('appends a numeric suffix when the slug collides', async () => {
    await useStudyStore.getState().createTopic('Agent 开发');
    const slug2 = await useStudyStore.getState().createTopic('Agent 开发');
    expect(slug2).toBe('agent-开发-2');
    expect(manager.writeFile).toHaveBeenCalledWith(
      studyDocPath('agent-开发-2'),
      expect.stringContaining('slug: agent-开发-2'),
    );
  });

  it('returns null for an empty title', async () => {
    const slug = await useStudyStore.getState().createTopic('   ');
    expect(slug).toBeNull();
    expect(manager.writeFile).not.toHaveBeenCalled();
  });
});

describe('useStudyStore.deleteTopic', () => {
  it('deletes the file and refreshes', async () => {
    await useStudyStore.getState().createTopic('React');
    const slug = useStudyStore.getState().activeSlug!;
    await useStudyStore.getState().deleteTopic(slug);
    expect(manager.deleteFile).toHaveBeenCalledWith(studyDocPath('react'));
    expect(useStudyStore.getState().topics).toHaveLength(0);
    expect(useStudyStore.getState().activeSlug).toBeNull();
  });

  it('is a no-op for an unknown slug', async () => {
    await useStudyStore.getState().deleteTopic('nope');
    expect(manager.deleteFile).not.toHaveBeenCalled();
  });
});

describe('useStudyStore.saveTopic', () => {
  it('serializes and writes back, updating the cached parse', async () => {
    await useStudyStore.getState().createTopic('Go');
    const slug = useStudyStore.getState().activeSlug!;
    const entry = useStudyStore.getState().topics.find((t) => t.slug === slug)!;
    // 给计划段追加一个学习单元（lineIndex = -1 → 序列化时追加到段尾）。
    const parsed = entry.parsed;
    const next = {
      ...parsed,
      units: [...parsed.units, {
        id: `${slug}#units--1`,
        order: 1,
        title: '入门',
        done: false,
        prog: 0,
        lineIndex: -1,
      }],
    };
    await useStudyStore.getState().saveTopic(next);

    const written = manager.files.get(studyDocPath('go'))!;
    expect(written).toContain('- [ ] 1. 入门 @{est:- dep:- prog:0}');
    // 缓存已更新：单元出现在缓存解析结果里，且拿到真实 lineIndex。
    const cached = useStudyStore.getState().topics.find((t) => t.slug === slug)!;
    expect(cached.parsed.units).toHaveLength(1);
    expect(cached.parsed.units[0].lineIndex).toBeGreaterThanOrEqual(0);
  });

  it('is a no-op when front-matter slug is missing', async () => {
    await useStudyStore.getState().saveTopic({
      rawLines: [],
      frontmatter: {},
      materials: [],
      units: [],
      reviewAtoms: [],
    } as never);
    expect(manager.writeFile).not.toHaveBeenCalled();
  });
});

describe('useStudyStore.selectTopic', () => {
  it('sets activeSlug', () => {
    useStudyStore.getState().selectTopic('x');
    expect(useStudyStore.getState().activeSlug).toBe('x');
  });
});

describe('collectDueAtoms (cross-topic today queue)', () => {
  const TODAY = '2026-06-29';

  function makeTopic(slug: string, reviewLines: string[]): StudyTopicEntry {
    const content = [
      '---',
      `title: ${slug}`,
      `slug: ${slug}`,
      '---',
      '',
      '## 复习',
      ...reviewLines,
      '',
    ].join('\n');
    return { slug, path: studyDocPath(slug), parsed: parseStudy(content, slug) };
  }

  it('aggregates due atoms across topics with source annotation', () => {
    const topics = [
      makeTopic('a', [
        `- [ ] a1 @{next:${TODAY} rep:0 ef:2.5 ivl:1 lapses:0 topic:a}`,
        `- [ ] a2 @{next:2026-07-02 rep:1 ef:2.5 ivl:6 lapses:0 topic:a}`,
      ]),
      makeTopic('b', [
        `- [ ] b1 @{next:2026-06-28 rep:2 ef:2.2 ivl:10 lapses:1 topic:b}`,
      ]),
    ];
    const due = collectDueAtoms(topics, TODAY);
    // a1 (today, due) + b1 (yesterday, due); a2 (future) excluded
    expect(due).toHaveLength(2);
    expect(due.map((d) => d.topicSlug).sort()).toEqual(['a', 'b']);
    expect(due.find((d) => d.topicSlug === 'a')?.atom.summary).toBe('a1');
  });

  it('returns empty when no topics or all upcoming', () => {
    expect(collectDueAtoms([], TODAY)).toEqual([]);
    const topics = [makeTopic('a', [`- [ ] a1 @{next:2099-01-01 rep:1 ef:2.5 ivl:6 lapses:0 topic:a}`])];
    expect(collectDueAtoms(topics, TODAY)).toEqual([]);
  });

  it('carries topicPath for write-back routing', () => {
    const topics = [makeTopic('a', [`- [ ] a1 @{next:${TODAY} rep:0 ef:2.5 ivl:1 lapses:0 topic:a}`])];
    expect(collectDueAtoms(topics, TODAY)[0].topicPath).toBe(studyDocPath('a'));
  });
});

describe('useStudyStore.rateAtomInTopic', () => {
  const TODAY = '2026-06-29';

  it('writes back updated SM-2 state for the rated atom (cross-topic path)', async () => {
    // 主题 a 含一条到期原子
    const docA = [
      '---', 'title: a', 'slug: a', '---', '',
      '## 复习',
      `- [ ] a1 @{next:${TODAY} rep:0 ef:2.5 ivl:1 lapses:0 topic:a}`,
      '',
    ].join('\n');
    await useVaultStore.getState().createFile(studyDocPath('a'), docA);
    await useStudyStore.getState().refresh();

    const entry = useStudyStore.getState().topics.find((t) => t.slug === 'a')!;
    const atom = entry.parsed.reviewAtoms[0];
    // Good 评级：rep 0→1, ivl=1, next=today+1
    const updated = await useStudyStore.getState().rateAtomInTopic('a', atom.id, {
      ...atom,
      rep: 1,
      ef: 2.5,
      ivl: 1,
      lapses: 0,
      next: '2026-06-30',
    });
    expect(updated).not.toBeNull();
    // 落盘行包含新 next
    const written = manager.files.get(studyDocPath('a'))!;
    expect(written).toContain('next:2026-06-30');
    expect(written).toContain('rep:1');
    // 缓存已刷新：atom 不再到期（next 推后）
    const cached = useStudyStore.getState().topics.find((t) => t.slug === 'a')!;
    expect(cached.parsed.reviewAtoms[0].next).toBe('2026-06-30');
  });

  it('returns null for an unknown slug', async () => {
    const res = await useStudyStore.getState().rateAtomInTopic('nope', 'x', {
      id: 'x', summary: '', done: false, next: TODAY, rep: 0, ef: 2.5, ivl: 1, lapses: 0, lineIndex: -1,
    });
    expect(res).toBeNull();
  });
});

/** 构造一个含两条资料 + 一个单元的主题文档并加载到 store。 */
async function setupTopicWithMaterials(slug: string) {
  const doc = [
    '---',
    `title: ${slug}`,
    `slug: ${slug}`,
    'created: 2026-06-29',
    '---',
    '',
    '## 资料',
    '- @book 《书A》 | 作者A | 简介A | 难度:中 | https://a',
    '- @web 网页B | https://b | 简介B',
    '',
    '## 计划',
    '- [ ] 1. 入门 @{est:2h dep:- prog:0}',
    '',
    '## 笔记',
    '',
    '## 复习',
    '',
  ].join('\n');
  await useVaultStore.getState().createFile(studyDocPath(slug), doc);
  await useStudyStore.getState().refresh();
}

describe('useStudyStore.saveTopicEdits (delete/edit/append via cached original parsed)', () => {
  it('deletes a material: round-trip parse no longer contains the line', async () => {
    await setupTopicWithMaterials('dev');

    const entry = useStudyStore.getState().topics.find((t) => t.slug === 'dev')!;
    const target = entry.parsed.materials[0];
    await useStudyStore.getState().saveTopicEdits('dev', {
      materials: entry.parsed.materials.filter((m) => m.id !== target.id),
    });

    const written = manager.files.get(studyDocPath('dev'))!;
    expect(written).not.toContain('《书A》');
    expect(written).toContain('网页B');
    // 缓存已刷新：重 parse 后该资料不再出现
    const cached = useStudyStore.getState().topics.find((t) => t.slug === 'dev')!;
    expect(cached.parsed.materials.map((m) => m.title)).toEqual(['网页B']);
  });

  it('edits a material in place (keeps lineIndex, rewrites line)', async () => {
    await setupTopicWithMaterials('edit');

    const entry = useStudyStore.getState().topics.find((t) => t.slug === 'edit')!;
    const target = entry.parsed.materials[1];
    await useStudyStore.getState().saveTopicEdits('edit', {
      materials: entry.parsed.materials.map((m) =>
        m.id === target.id ? { ...m, title: '网页B改名', summary: '新简介' } : m,
      ),
    });

    const written = manager.files.get(studyDocPath('edit'))!;
    expect(written).toContain('- @web 网页B改名 | https://b | 新简介');
    // 原行不再以旧标题出现
    expect(written).not.toContain('网页B | https://b | 简介B');
    // 另一条资料与单元原样保留
    expect(written).toContain('《书A》');
    expect(written).toContain('- [ ] 1. 入门');
  });

  it('appends a new material (lineIndex=-1) to the 资料 section', async () => {
    await setupTopicWithMaterials('append');

    await useStudyStore.getState().saveTopicEdits('append', {
      materials: [
        ...useStudyStore.getState().topics.find((t) => t.slug === 'append')!.parsed.materials,
        { id: 'x', kind: 'web', title: '新资料', url: 'https://c', summary: '好文', lineIndex: -1 },
      ],
    });

    const written = manager.files.get(studyDocPath('append'))!;
    expect(written).toContain('- @web 新资料 | https://c | 好文');
    // 出现在 ## 计划 之前
    expect(written.indexOf('新资料')).toBeLessThan(written.indexOf('## 计划'));
  });

  it('deleting via saveTopic (old path) does NOT remove the line (regression guard)', async () => {
    // 旧 saveTopic(parsed) 用同源 parsed 作为 serializeStudy 第一参数，删除检测失效。
    await setupTopicWithMaterials('oldsave');

    const entry = useStudyStore.getState().topics.find((t) => t.slug === 'oldsave')!;
    const filtered = { ...entry.parsed, materials: entry.parsed.materials.slice(1) };
    await useStudyStore.getState().saveTopic(filtered);

    const written = manager.files.get(studyDocPath('oldsave'))!;
    // 旧路径：删除不生效，旧行仍在（这正是 saveTopicEdits 要修复的 bug）
    expect(written).toContain('《书A》');
  });
});

describe('useStudyStore suggestion flow (research/plan)', () => {
  it('beginSuggestion sets pendingSuggestion', () => {
    useStudyStore.getState().beginSuggestion('research', 'dev');
    expect(useStudyStore.getState().pendingSuggestion).toEqual({ kind: 'research', slug: 'dev' });
  });

  it('consumeSuggestion (research) auto-appends to ## 资料 and clears pending', async () => {
    await setupTopicWithMaterials('dev');
    useStudyStore.getState().beginSuggestion('research', 'dev');
    const text = [
      '- @book 《书》 | 作者 | 简介 | 难度:难 | https://x',
      '说明文字',
      '- @web 标题 | https://y | 简介',
    ].join('\n');
    await useStudyStore.getState().consumeSuggestion(text);
    const s = useStudyStore.getState();
    expect(s.pendingSuggestion).toBeNull();
    // 资料已自动写入 `## 资料` 段。
    const written = manager.files.get(studyDocPath('dev'))!;
    expect(written).toContain('- @book 《书》 | 作者 | 简介 | 难度:难 | https://x');
    expect(written).toContain('- @web 标题 | https://y | 简介');
    // 原有资料仍在。
    expect(written).toContain('- @book 《书A》 | 作者A | 简介A | 难度:中 | https://a');
  });

  it('consumeSuggestion (research) dedups against existing materials', async () => {
    await setupTopicWithMaterials('dup');
    // 已有 《书A》|https://a 与 网页B|https://b；AI 再给一条重复的 https://b 和一条新的。
    useStudyStore.getState().beginSuggestion('research', 'dup');
    const text = [
      '- @web 网页B | https://b | 重复简介',
      '- @web 新资料 | https://new | 新简介',
    ].join('\n');
    await useStudyStore.getState().consumeSuggestion(text);
    const written = manager.files.get(studyDocPath('dup'))!;
    // 重复的不重复落盘（仍只有一条 https://b）。
    expect((written.match(/https:\/\/b/g) || []).length).toBe(1);
    expect(written).toContain('- @web 新资料 | https://new | 新简介');
  });

  it('consumeSuggestion scans plan text into suggestedUnits', async () => {
    useStudyStore.getState().beginSuggestion('plan', 'dev');
    const text = '- [ ] 1. 入门 @{est:2h dep:- prog:0}\n- [ ] 2. 进阶 @{est:4h dep:1 prog:0}';
    await useStudyStore.getState().consumeSuggestion(text);
    expect(useStudyStore.getState().suggestedUnits).toHaveLength(2);
    expect(useStudyStore.getState().suggestedUnits[1]).toMatchObject({ order: 2, title: '进阶', dep: '1' });
  });

  it('consumeSuggestion with no matching lines still clears pending', async () => {
    useStudyStore.getState().beginSuggestion('research', 'dev');
    await useStudyStore.getState().consumeSuggestion('AI 没按格式回复');
    expect(useStudyStore.getState().pendingSuggestion).toBeNull();
  });

  it('acceptUnitSuggestion renumbers order to max+1 and appends', async () => {
    await setupTopicWithMaterials('accu');
    // 建议里 order=1（与已有冲突），应被重排为 2
    const sug: StudyUnitLike = { id: 'accu#sug-unit-0', order: 1, title: '建议单元', done: false, est: '3h', dep: '-', prog: 0, lineIndex: -1 };
    useStudyStore.setState({ suggestedUnits: [sug as never], pendingSuggestion: null });

    await useStudyStore.getState().acceptUnitSuggestion('accu', sug as never);

    const written = manager.files.get(studyDocPath('accu'))!;
    expect(written).toContain('- [ ] 2. 建议单元 @{est:3h dep:- prog:0}');
    expect(useStudyStore.getState().suggestedUnits).toHaveLength(0);
  });
});

describe('parseSuggestionText (pure helper)', () => {
  it('routes research → scanMaterialSuggestions', () => {
    const out = parseSuggestionText('- @web A | https://a | s', 'research', 'sl') as { kind: string }[];
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('web');
  });
  it('routes plan → scanUnitSuggestions', () => {
    const out = parseSuggestionText('- [ ] 1. A @{est:1h dep:- prog:0}', 'plan', 'sl') as { order: number }[];
    expect(out[0].order).toBe(1);
  });
});

describe('materialDedupeKey (pure helper)', () => {
  it('prefers url over title and lowercases', () => {
    expect(materialDedupeKey({ title: 'A', url: 'https://X.com' })).toBe('https://x.com');
    expect(materialDedupeKey({ title: 'Title' })).toBe('title');
  });
  it('treats empty url as title', () => {
    expect(materialDedupeKey({ title: 'T', url: '   ' })).toBe('t');
  });
});

type StudyUnitLike = {
  id: string; order: number; title: string; done: boolean;
  est?: string; dep?: string; prog: number; lineIndex: number;
};
