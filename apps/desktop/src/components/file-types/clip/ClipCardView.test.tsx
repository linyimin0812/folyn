import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { InfographicDoc } from '@/features/clips/clipParse';

// Mock editor store — the real module pulls in CodeMirror / settings /
// tauri storage chains that aren't available in the node test environment.
const editorState = {
  openWebFromClip: () => {},
};
vi.mock('@/store/editorStore', () => ({
  useEditorStore: Object.assign((sel: (s: typeof editorState) => unknown) => sel(editorState), {
    getState: () => editorState,
  }),
}));

import { ClipCardView } from './ClipCardView';

/**
 * Component tests for the simplified clip card view (PR4 — chrome removed).
 *
 * The infographic region now renders ONLY the poster — no header label, no
 * "重新生成" / "导出为图片" / "生成信息图" buttons, no error display, no
 * re-clip hint. The region is also placed BEFORE 摘要 (poster-first).
 *
 * Mirrors prior `renderToString` discipline (no @testing-library/react dep).
 */

const noop = async () => {};
const noopSync = () => {};

const baseFrontmatter = `---
title: "测试标题"
type: clip
url: "https://example.com/post"
tags: ["ai"]
clipped: 2026-07-02
---
`;

const clipWithInfographic = (doc: InfographicDoc): string => `${baseFrontmatter}
## 信息图

\`\`\`json
${JSON.stringify(doc, null, 2)}
\`\`\`

## 摘要

一句话摘要

## 要点

- 要点一
- 要点二
`;

const clipWithoutInfographic = `${baseFrontmatter}
## 摘要

摘要内容

## 要点

- 要点一
`;

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ClipCardView — infographic region', () => {
  it('renders the infographic poster when the section is present', () => {
    const doc: InfographicDoc = {
      version: 1,
      blocks: [{ type: 'hero', title: 'HERO_X' }],
    };
    const html = renderToString(
      <ClipCardView content={clipWithInfographic(doc)} tabId="t1" filePath="p.md" onChange={noopSync} onSave={noopSync} />,
    );
    expect(html).toContain('HERO_X');
    expect(html).toContain('poster-container');
  });

  it('renders no infographic chrome (label / buttons) when an infographic is present', () => {
    const doc: InfographicDoc = {
      version: 1,
      blocks: [{ type: 'hero', title: 'H' }],
    };
    const html = renderToString(
      <ClipCardView content={clipWithInfographic(doc)} tabId="t1" filePath="p.md" onChange={noopSync} onSave={noopSync} />,
    );
    // No section header label.
    expect(html).not.toContain('>信息图<');
    // No manual action buttons — infographic is auto-generated at clip time now.
    expect(html).not.toContain('重新生成');
    expect(html).not.toContain('生成信息图');
    expect(html).not.toContain('导出为图片');
    // No re-clip hint.
    expect(html).not.toContain('重新剪藏可获得更丰富的内容');
  });

  it('renders nothing in the infographic slot when the section is absent', () => {
    const html = renderToString(
      <ClipCardView content={clipWithoutInfographic} tabId="t1" filePath="p.md" onChange={noopSync} onSave={noopSync} />,
    );
    expect(html).not.toContain('poster-container');
    expect(html).not.toContain('信息图');
    expect(html).not.toContain('重新生成');
    expect(html).not.toContain('生成信息图');
  });
});

describe('ClipCardView — section ordering', () => {
  it('renders infographic region BEFORE 摘要 region', () => {
    const doc: InfographicDoc = {
      version: 1,
      blocks: [{ type: 'hero', title: 'POSTER_TITLE' }],
    };
    const html = renderToString(
      <ClipCardView content={clipWithInfographic(doc)} tabId="t1" filePath="p.md" onChange={noopSync} onSave={noopSync} />,
    );
    const idxInfographic = html.indexOf('POSTER_TITLE');
    const idxSummary = html.indexOf('摘要');
    const idxPoints = html.indexOf('要点');
    expect(idxInfographic).toBeGreaterThan(-1);
    expect(idxSummary).toBeGreaterThan(-1);
    expect(idxPoints).toBeGreaterThan(-1);
    // Poster → 摘要 → 要点.
    expect(idxInfographic).toBeLessThan(idxSummary);
    expect(idxSummary).toBeLessThan(idxPoints);
  });
});
