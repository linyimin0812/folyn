import { useEffect, useState } from 'react';
import type { ContainerPlugin, ContainerProps } from '../ContainerPlugin';
import { useVaultContext } from '../VaultContext';

function resolveVaultPath(src: string, filePath: string): string {
  // Returns a vault-relative path. VaultManager.readFile joins this with the
  // vault base path, so we must NOT pass absolute paths (they'd get doubled).
  if (src.startsWith('/') || src.startsWith('~')) return src;
  const fileDir = filePath ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
  // `./` and `../` → resolve relative to the current document's directory
  // (markdown image convention).
  if (src.startsWith('./') || src.startsWith('.\\')) {
    const raw = src.slice(2);
    return fileDir ? `${fileDir}/${raw}` : raw;
  }
  if (src.startsWith('../') || src.startsWith('..\\')) {
    // ponytail: single-level `../` only — nested parents need a loop if needed.
    const raw = src.slice(3);
    const parentDir = fileDir ? fileDir.substring(0, fileDir.lastIndexOf('/')) : '';
    return parentDir ? `${parentDir}/${raw}` : raw;
  }
  // No prefix → vault-relative (Obsidian/wikilink convention, matches the
  // paths the autocomplete source returns).
  return src;
}

function FilePreviewComponent({ attributes }: ContainerProps) {
  const src = attributes?.src || '';
  const ctx = useVaultContext();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);

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
  const previewEl = content && ctx?.renderFile ? (ctx.renderFile(src, content) ?? null) : null;

  return (
    <div style={{
      padding: '12px 16px',
      background: 'var(--surf, #f8f9fd)',
      borderRadius: '8px',
      border: '1px solid var(--brd, #dde2f0)',
      margin: '12px 0',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        fontSize: '11px', color: 'var(--t3, #8892b0)', marginBottom: '8px',
      }}>
        <span>{ctx?.getFileIcon ? ctx.getFileIcon(src) : '📄'} {src || '文件预览'}</span>
        {ctx?.openFile && src && (
          <button
            type="button"
            onClick={() => {
              const vaultRel = resolveVaultPath(src, ctx?.filePath ?? '');
              ctx.openFile?.(vaultRel);
            }}
            style={{
              marginLeft: 'auto', padding: '2px 8px', fontSize: '11px',
              background: 'transparent', color: 'var(--acc, #597ef7)',
              border: '1px solid var(--brd, #dde2f0)', borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            跳转到源文件 ↗
          </button>
        )}
      </div>
      {error && (
        <div style={{ fontSize: '12px', color: '#d94040' }}>{error}</div>
      )}
      {content && previewEl && (
        // ponytail: fixed height — embedded preview components like the dbml
        // ER diagram use h-full (height:100%), and percentage heights need a
        // real `height` on the parent (min-height is not enough). Markdown
        // flow content scrolls within this box; adjust if it bites.
        <div style={{ height: 420, overflow: 'auto' }}>
          {previewEl}
        </div>
      )}
      {content && !previewEl && (
        // ponytail: no Preview handler for this extension (e.g. .drawio —
        // only has Editor). Default to a collapsed source view so users can
        // still peek at the raw text on demand, without leaking it inline.
        <div>
          <div style={{ fontSize: '12px', color: 'var(--t3, #8892b0)', marginBottom: '8px' }}>
            此类型暂无预览，可打开源文件查看
          </div>
          <button
            type="button"
            onClick={() => setShowSource((s) => !s)}
            style={{
              padding: '2px 8px', fontSize: '11px',
              background: 'transparent', color: 'var(--acc, #597ef7)',
              border: '1px solid var(--brd, #dde2f0)', borderRadius: '4px',
              cursor: 'pointer', marginBottom: '8px',
            }}
          >
            {showSource ? '收起源码 ▲' : '显示源码 ▼'}
          </button>
          {showSource && (
            <pre style={{
              margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              fontSize: '12px', color: 'var(--t1, #2a3146)', fontFamily: 'inherit',
            }}>
              {content}
            </pre>
          )}
        </div>
      )}
      {!error && !content && (
        <div style={{ fontSize: '12px', color: 'var(--t3, #8892b0)' }}>加载中...</div>
      )}
    </div>
  );
}

export const filePreviewPlugin: ContainerPlugin = {
  name: 'file-preview',
  icon: '📄',
  label: '文件预览',
  category: 'media',
  component: FilePreviewComponent,
  template: ':::file-preview{src="path/to/file.md"}\n:::',
  description: '内联展示 Vault 中的文件内容',
};
