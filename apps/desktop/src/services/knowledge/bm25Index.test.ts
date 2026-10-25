import { describe, it, expect } from 'vitest';
import { tokenize, buildBm25Index, bm25Search, type KbDoc } from './bm25Index';

describe('tokenize', () => {
  it('splits English words and lowercases', () => {
    expect(tokenize('Tauri Window Manager')).toEqual(['tauri', 'window', 'manager']);
  });

  it('produces Chinese bigrams and keeps single-char runs', () => {
    expect(tokenize('知识库')).toEqual(['知识', '识库']);
    expect(tokenize('中')).toEqual(['中']);
  });

  it('drops stopwords from both languages', () => {
    expect(tokenize('the 的 and')).toEqual([]);
  });
});

describe('bm25Search', () => {
  const docs: KbDoc[] = [
    { id: 'src-1', kind: 'source', path: 'a.md', title: 'Tauri 窗口管理', text: 'Tauri multiwindow transparent window click-through window management' },
    { id: 'src-2', kind: 'source', path: 'b.md', title: '日记', text: '今天天气不错，去了公园。' },
    { id: 'tp-1', kind: 'topic', path: 't.md', title: '窗口管理经验', text: 'transparent click-through 的实现要点' },
  ];

  it('ranks the doc matching both English terms first', () => {
    const hits = bm25Search(buildBm25Index(docs), 'tauri window');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.docId).toBe('src-1');
  });

  it('matches Chinese bigram queries', () => {
    const hits = bm25Search(buildBm25Index(docs), '天气');
    expect(hits.map((h) => h.docId)).toContain('src-2');
  });

  it('title hits outrank body-only hits at equal idf', () => {
    // tp-1 的标题命中"窗口管理"（bigram 窗口/口管/管理），src-1 标题也命中；
    // 构造一个只正文命中的对照文档即可验证加权方向。
    const docs2: KbDoc[] = [
      { id: 'title-hit', kind: 'source', path: 'x.md', title: '窗口管理', text: '别的内容' },
      { id: 'body-hit', kind: 'source', path: 'y.md', title: '别的标题', text: '窗口管理' },
    ];
    const hits = bm25Search(buildBm25Index(docs2), '窗口管理');
    expect(hits[0]!.docId).toBe('title-hit');
  });

  it('returns empty for empty index or stopword-only query', () => {
    expect(bm25Search(buildBm25Index([]), 'anything')).toEqual([]);
    expect(bm25Search(buildBm25Index(docs), 'the')).toEqual([]);
  });
});
