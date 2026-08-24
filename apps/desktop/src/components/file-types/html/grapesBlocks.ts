/**
 * Custom GrapesJS blocks for the Mochi HTML editor.
 *
 * The `grapesjs-blocks-basic` plugin already ships the basic grid/column/text
 * blocks. The blocks registered here complement it with the higher-level
 * content primitives called out in prd §4.5 (text/heading/button/quote/card/
 * hero/hr/spacing).
 *
 * Blocks are registered with simple string templates so GrapesJS's component
 * model parses them — we deliberately avoid inline style attributes on root
 * nodes here so the Style Manager exposes a clean starting point.
 */

import type { Editor } from 'grapesjs';

interface BlockOptions {
  id: string;
  label: string;
  category: string;
  content: string;
}

const BLOCKS: BlockOptions[] = [
  // —— Text category ——
  {
    id: 'mochi-heading',
    label: '标题',
    category: '文本',
    content: '<h2 style="padding:8px 0;font-size:24px;font-weight:600;">标题文本</h2>',
  },
  {
    id: 'mochi-paragraph',
    label: '段落',
    category: '文本',
    content: '<p style="line-height:1.6;color:#333;">这是一段示例文字，可在此处编辑内容。</p>',
  },
  {
    id: 'mochi-button',
    label: '按钮',
    category: '文本',
    content:
      '<a href="#" style="display:inline-block;padding:8px 16px;border-radius:6px;background-color:#3a6ef0;color:#fff;text-decoration:none;">点击</a>',
  },
  {
    id: 'mochi-list',
    label: '列表',
    category: '文本',
    content: '<ul><li>列表项 1</li><li>列表项 2</li><li>列表项 3</li></ul>',
  },
  {
    id: 'mochi-quote',
    label: '引用',
    category: '文本',
    content:
      '<blockquote style="border-left:3px solid #3a6ef0;padding-left:12px;margin:8px 0;color:#555;">引用文本</blockquote>',
  },
  // —— Layout category ——
  {
    id: 'mochi-card',
    label: '卡片',
    category: '布局',
    content:
      '<div style="border:1px solid #e2e8f0;border-radius:8px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,0.06);">' +
      '<img src="https://via.placeholder.com/600x200" alt="" style="width:100%;border-radius:4px;"/>' +
      '<h3 style="margin:12px 0 4px;font-size:16px;font-weight:600;">卡片标题</h3>' +
      '<p style="margin:0;color:#666;font-size:13px;">卡片描述文字，简要说明内容。</p>' +
      '</div>',
  },
  {
    id: 'mochi-hero',
    label: 'Hero 区域',
    category: '布局',
    content:
      '<section style="padding:48px 24px;background:linear-gradient(135deg,#3a6ef0,#6a3af0);color:#fff;text-align:center;border-radius:8px;">' +
      '<h1 style="margin:0 0 8px;font-size:32px;font-weight:700;">主标题</h1>' +
      '<p style="margin:0 0 16px;opacity:0.9;">副标题说明文字</p>' +
      '<a href="#" style="display:inline-block;padding:10px 20px;background-color:#fff;color:#3a6ef0;border-radius:6px;text-decoration:none;font-weight:600;">行动按钮</a>' +
      '</section>',
  },
  {
    id: 'mochi-divider',
    label: '分割线',
    category: '布局',
    content: '<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;"/>',
  },
  {
    id: 'mochi-spacer',
    label: '间距',
    category: '布局',
    content: '<div style="height:24px;"></div>',
  },
];

/**
 * Register Mochi's custom block library on a GrapesJS editor instance.
 * Idempotent — re-registration on the same editor is a no-op.
 */
export function registerCustomBlocks(editor: Editor): void {
  const bm = editor.BlockManager;
  if (!bm) return;
  for (const block of BLOCKS) {
    if (bm.get(block.id)) continue;
    bm.add(block.id, {
      label: block.label,
      category: block.category,
      content: block.content,
    });
  }
}
