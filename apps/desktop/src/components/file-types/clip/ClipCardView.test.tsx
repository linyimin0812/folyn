import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { InfographicDoc } from '@/features/clips/clipParse';

// Mock editor store — the real module pulls in CodeMirror / settings /
// tauri storage chains that aren't available in the node test environment.
const editorState = {
  openWebFromClip: () => {},
  updateTabContent: async () => {},
};
vi.mock('@/store/editorStore', () => ({
  useEditorStore: Object.assign((sel: (s: typeof editorState) => unknown) => sel(editorState), {
    getState: () => editorState,
  }),
}));

// Mock vault store to avoid filesystem / tauri initialization.
const vaultState = { readFile: async () => '' };
vi.mock('@/store/vaultStore', () => ({
  useVaultStore: Object.assign((sel: (s: typeof vaultState) => unknown) => sel(vaultState), {
    getState: () => vaultState,
  }),
}));

// Mock clipStore. The real zustand store + `useSyncExternalStore` does not
// re-read `setState` mutations during a synchronous `renderToString` pass
// (server snapshot is captured at subscription time), so we substitute a
// plain mutable-state hook that the test controls directly. This is the same
// `renderToString` discipline PR2 used — no @testing-library/react dep.
interface FakeClipState {
  isGeneratingInfographic: boolean;
  infographicError: string | null;
  infographicErrorPath: string | null;
  generateInfographic: (filePath: string) => Promise<unknown>;
}
const fakeClipState: FakeClipState = {
  isGeneratingInfographic: false,
  infographicError: null,
  infographicErrorPath: null,
  generateInfographic: async () => undefined,
};
vi.mock('@/store/clipStore', () => ({
  useClipStore: Object.assign((sel: (s: FakeClipState) => unknown) => sel(fakeClipState), {
    getState: () => fakeClipState,
    setState: (patch: Partial<FakeClipState>) => Object.assign(fakeClipState, patch),
  }),
}));

// Mock the PNG export helper so the test never touches html-to-image / Tauri.
// The mock captures the element passed in so the test can assert it's the
// poster container, and resolves by default (success path).
const exportInfographicToPng = vi.fn(async (_el: HTMLElement, _opts: { slug: string }) => {});
vi.mock('./InfographicExport', () => ({
  exportInfographicToPng: (...args: Parameters<typeof exportInfographicToPng>) =>
    exportInfographicToPng(...args),
}));

import { ClipCardView } from './ClipCardView';
import { useClipStore } from '@/store/clipStore';

/**
 * Component tests for the clip card infographic region (PR3 finalize layer).
 *
 * Mirrors PR2's `renderToString` approach (no @testing-library/react dep).
 * Store state is preset via `useClipStore.setState` (mocked to mutate a plain
 * object the hook reads directly) so synchronous render reads preset values.
 */

const noop = async () => {};
const noopSync = () => {};

function presetStores(overrides: {
  isGeneratingInfographic?: boolean;
  infographicError?: string | null;
  infographicErrorPath?: string | null;
} = {}) {
  useClipStore.setState({
    isGeneratingInfographic: overrides.isGeneratingInfographic ?? false,
    infographicError: overrides.infographicError ?? null,
    // Default the error path to the test's clip path so existing assertions
    // (which set an error and expect it shown) keep working without each
    // test having to specify the path.
    infographicErrorPath: overrides.infographicErrorPath ?? 'p.md',
    generateInfographic: noop as never,
  });
}

const baseFrontmatter = `---
title: "测试标题"
type: clip
url: "https://example.com/post"
tags: ["ai"]
clipped: 2026-07-02
---
`;

const clipWithInfographic = (doc: InfographicDoc): string => `${baseFrontmatter}
## 摘要

一句话摘要

## 要点

- 要点一
- 要点二

## 信息图

\`\`\`json
${JSON.stringify(doc, null, 2)}
\`\`\`
`;

const clipWithoutInfographic = `${baseFrontmatter}
## 摘要

摘要内容

## 要点

- 要点一
`;

const clipWithCorruptInfographic = `${baseFrontmatter}
## 摘要

摘要

## 要点

- 要点一

## 信息图

\`\`\`json
{ not valid json
`;

afterEach(() => {
  vi.restoreAllMocks();
  exportInfographicToPng.mockClear();
  exportInfographicToPng.mockResolvedValue(undefined);
});

beforeEach(() => {
  presetStores();
  exportInfographicToPng.mockResolvedValue(undefined);
});

describe('ClipCardView — infographic region', () => {
  it('shows "生成信息图" button when no infographic section exists', () => {
    presetStores();
    const html = renderToString(
      <ClipCardView content={clipWithoutInfographic} tabId="t1" filePath="p.md" onChange={noopSync} onSave={noopSync} />,
    );
    expect(html).toContain('生成信息图');
    expect(html).not.toContain('重新生成');
  });

  it('shows "重新生成" button when an infographic is present', () => {
    presetStores();
    const doc: InfographicDoc = {
      version: 1,
      blocks: [{ type: 'hero', title: 'HERO_X' }],
    };
    const html = renderToString(
      <ClipCardView content={clipWithInfographic(doc)} tabId="t1" filePath="p.md" onChange={noopSync} onSave={noopSync} />,
    );
    expect(html).toContain('重新生成');
    expect(html).toContain('HERO_X');
    // The primary generate button should not also render (region switches to
    // the regenerate affordance in the header). Match the button text node,
    // not the `title` attribute which contains "重新生成信息图".
    expect(html).not.toContain('>生成信息图<');
  });

  it('shows corrupt hint + regenerate when section exists but JSON is invalid', () => {
    presetStores();
    const html = renderToString(
      <ClipCardView content={clipWithCorruptInfographic} tabId="t1" filePath="p.md" onChange={noopSync} onSave={noopSync} />,
    );
    expect(html).toContain('信息图数据损坏，重新生成可修复');
    expect(html).toContain('重新生成');
  });

  it('shows error + retry affordance when infographicError is set', () => {
    presetStores({ infographicError: '生成失败：网络错误' });
    const html = renderToString(
      <ClipCardView content={clipWithoutInfographic} tabId="t1" filePath="p.md" onChange={noopSync} onSave={noopSync} />,
    );
    expect(html).toContain('生成失败：网络错误');
    expect(html).toContain('重试');
  });

  it('does not leak an error scoped to a different clip path onto this card', () => {
    // Regression guard: a generation failure on clip A (path 'other.md') must
    // not surface its error on clip B (path 'p.md') when the user switches tabs.
    presetStores({ infographicError: 'clip A failed', infographicErrorPath: 'other.md' });
    const html = renderToString(
      <ClipCardView content={clipWithoutInfographic} tabId="t1" filePath="p.md" onChange={noopSync} onSave={noopSync} />,
    );
    expect(html).not.toContain('clip A failed');
    expect(html).not.toContain('重试');
  });

  it('disables buttons and shows generating text while isGeneratingInfographic', () => {
    presetStores({ isGeneratingInfographic: true });
    const html = renderToString(
      <ClipCardView content={clipWithoutInfographic} tabId="t1" filePath="p.md" onChange={noopSync} onSave={noopSync} />,
    );
    expect(html).toContain('生成中...');
    expect(html).toContain('disabled=""');
    // Error retry block is hidden while generating.
    expect(html).not.toContain('重试');
  });

  it('shows regenerating text while isGeneratingInfographic and infographic present', () => {
    presetStores({ isGeneratingInfographic: true });
    const doc: InfographicDoc = {
      version: 1,
      blocks: [{ type: 'hero', title: 'H' }],
    };
    const html = renderToString(
      <ClipCardView content={clipWithInfographic(doc)} tabId="t1" filePath="p.md" onChange={noopSync} onSave={noopSync} />,
    );
    expect(html).toContain('重新生成中...');
    expect(html).toContain('disabled=""');
  });
});

describe('ClipCardView — export-as-image button', () => {
  it('renders the export button next to regenerate when an infographic is present', () => {
    presetStores();
    const doc: InfographicDoc = {
      version: 1,
      blocks: [{ type: 'hero', title: 'H' }],
    };
    const html = renderToString(
      <ClipCardView content={clipWithInfographic(doc)} tabId="t1" filePath="p.md" onChange={noopSync} onSave={noopSync} />,
    );
    expect(html).toContain('导出为图片');
    // Regenerate button still present alongside.
    expect(html).toContain('重新生成');
  });

  it('does not render the export button when no infographic exists', () => {
    presetStores();
    const html = renderToString(
      <ClipCardView content={clipWithoutInfographic} tabId="t1" filePath="p.md" onChange={noopSync} onSave={noopSync} />,
    );
    expect(html).not.toContain('导出为图片');
  });

  it('shows re-clip hint when an infographic exists but ## 正文 is absent', () => {
    presetStores();
    const doc: InfographicDoc = {
      version: 1,
      blocks: [{ type: 'hero', title: 'H' }],
    };
    const html = renderToString(
      <ClipCardView content={clipWithInfographic(doc)} tabId="t1" filePath="p.md" onChange={noopSync} onSave={noopSync} />,
    );
    // clipWithInfographic has no ## 正文 section → hint shown.
    expect(html).toContain('重新剪藏可获得更丰富的内容');
  });

  it('does not show re-clip hint when ## 正文 is present', () => {
    presetStores();
    const doc: InfographicDoc = {
      version: 1,
      blocks: [{ type: 'hero', title: 'H' }],
    };
    const clipWithBody = `${clipWithInfographic(doc)}## 正文\n\npage body text\n`;
    const html = renderToString(
      <ClipCardView content={clipWithBody} tabId="t1" filePath="p.md" onChange={noopSync} onSave={noopSync} />,
    );
    expect(html).not.toContain('重新剪藏可获得更丰富的内容');
  });
});
