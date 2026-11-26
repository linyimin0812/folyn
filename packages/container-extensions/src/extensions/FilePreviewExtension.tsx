import { useEffect, useState } from 'react';
import type { ContainerExtension, ContainerProps } from '../ContainerExtension';
import { useVaultContext } from '../VaultContext';

// ponytail: inline SVG (stroke=currentColor) — packages/container-extensions
// can't import apps/desktop assets, and these are 2-line icons.
const EXTERNAL_LINK_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
    <polyline points="14 4 20 4 20 10" />
    <line x1="20" y1="4" x2="10" y2="14" />
  </svg>
);

const CODE_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="8 18 2 12 8 6" />
    <polyline points="16 6 22 12 16 18" />
  </svg>
);

function resolveVaultPath(src: string, filePath: string): string {
  // Returns a vault-relative path. VaultManager.readFile joins this with the
  // vault base path, so we must NOT pass absolute paths (they'd get doubled).
  if (src.startsWith('/') || src.startsWith('~')) return src;
  // Bare path (no ./ ../ prefix) → vault-relative (Obsidian/wikilink convention,
  // matches the paths the autocomplete source returns).
  if (
    !src.startsWith('./') && !src.startsWith('.\\') &&
    !src.startsWith('../') && !src.startsWith('..\\')
  ) {
    return src;
  }
  // ./ and ../ → resolve relative to the current document's directory
  // (markdown image convention). Walk segments: '.' is no-op, '..' pops one
  // level, otherwise descend. Handles N-level `../../`, matching the
  // completion source's resolveDirPart so picked entries actually resolve.
  // ponytail: duplicated 5-line loop from FilePreviewSrcExtension.ts:resolveDirPart —
  // two packages, different build graphs, sharing it isn't worth a new dep.
  const fileDir = filePath ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
  const segments = fileDir.split('/').filter(Boolean);
  const parts = src.replace(/\\/g, '/').split('/').filter((s) => s !== '.' && s !== '');
  for (const seg of parts) {
    if (seg === '..') segments.pop();
    else segments.push(seg);
  }
  return segments.join('/');
}

function FilePreviewComponent({ attributes }: ContainerProps) {
  const src = attributes?.src || '';
  const ctx = useVaultContext();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ponytail: state persists across src changes — no useEffect reset. Revisit
  // if users get confused seeing source view from a stale file on a new one.
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview');

  // ponytail: basename for export fallback / a11y — derived, no memo needed.
  const basename = src ? src.replace(/\\/g, '/').split('/').pop() : '';

  useEffect(() => {
    if (!src) {
      setContent(null);
      setError('未指定 src');
      return;
    }
    if (!ctx) {
      setContent(null);
      setError('无法访问 vault 上下文');
      return;
    }
    let cancelled = false;
    const vaultRelPath = resolveVaultPath(src, ctx.filePath);
    ctx.readFile(vaultRelPath).then(
      (text) => {
        if (!cancelled) { setContent(text); setError(null); }
      },
      (err) => {
        if (!cancelled) {
          setContent(null);
          setError(err instanceof Error ? err.message : '读取失败');
        }
      },
    );
    return () => { cancelled = true; };
  }, [src, ctx]);

  // ponytail: called every render — renderFile is a pure lookup (ext regex +
  // handler.Preview + createElement), not hot enough to memoize. Revisit if
  // a no-preview file preview block appears in a tight list.
  const previewEl = content && ctx?.renderFile ? (ctx.renderFile(resolveVaultPath(src, ctx.filePath), content) ?? null) : null;

  return (
    <div
      data-file-preview=""
      data-file-preview-src={src}
      data-file-preview-name={basename}
      className="docmd-fileview"
    >
      <div className="docmd-fileview-head">
        <span className="docmd-fileview-path">
          {ctx?.getFileIcon ? ctx.getFileIcon(src) : '📄'} {src || '文件预览'}
        </span>
        {content && (
          <div className="docmd-fileview-actions">
            <button
              type="button"
              className={`docmd-icon-btn${viewMode === 'source' ? ' is-on' : ''}`}
              title={viewMode === 'source' ? '切换到预览' : '查看源码'}
              onClick={() => setViewMode((m) => (m === 'source' ? 'preview' : 'source'))}
            >
              {CODE_ICON}
            </button>
            {ctx?.openFile && src && (
              <button
                type="button"
                className="docmd-icon-btn"
                title="跳转到源文件"
                onClick={() => {
                  const vaultRel = resolveVaultPath(src, ctx?.filePath ?? '');
                  ctx.openFile?.(vaultRel);
                }}
              >
                {EXTERNAL_LINK_ICON}
              </button>
            )}
          </div>
        )}
      </div>
      {error && <div className="docmd-fileview-error">{error}</div>}
      {content && viewMode === 'source' && (
        <pre className="docmd-fileview-source">{content}</pre>
      )}
      {content && viewMode === 'preview' && previewEl && (
        // ponytail: fixed height — embedded preview components like the dbml
        // ER diagram use h-full (height:100%), and percentage heights need a
        // real `height` on the parent (min-height is not enough). Markdown
        // flow content scrolls within this box; adjust if it bites.
        <div data-file-preview-body="" className="docmd-fileview-body">
          {previewEl}
        </div>
      )}
      {content && viewMode === 'preview' && !previewEl && (
        <div data-file-preview-body="" className="docmd-fileview-empty">
          此类型暂无预览，可点击右上 code 图标查看源码
        </div>
      )}
      {!error && !content && (
        <div className="docmd-fileview-loading">加载中...</div>
      )}
    </div>
  );
}

export const filePreviewExtension: ContainerExtension = {
  name: 'file-preview',
  icon: '📄',
  label: '文件预览',
  category: 'media',
  component: FilePreviewComponent,
  template: ':::file-preview{src=""}\n:::',
  description: '内联展示 Vault 中的文件内容',
};
