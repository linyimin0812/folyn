import { useEffect } from 'react';
import { useWikiStore } from '@/store/wikiStore';
import { useEditorStore } from '@/store/editorStore';
import type { WikiEntry } from '@/types/wiki';
import { WIKI_PREFIX } from '@/types/wiki';

function WikiEntryItem({ entry, depth }: { entry: WikiEntry; depth: number }) {
  const openFile = useEditorStore((s) => s.openFile);

  if (entry.type === 'dir') {
    return (
      <div className="wiki-tree-dir">
        <div
          className="wiki-tree-item dir"
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          <span className="wiki-tree-icon">📁</span>
          <span className="wiki-tree-name">{entry.name}</span>
          {entry.children && (
            <span className="wiki-tree-count">{entry.children.filter((c) => c.type === 'file').length}</span>
          )}
        </div>
        {entry.children?.map((child) => (
          <WikiEntryItem key={child.path} entry={child} depth={depth + 1} />
        ))}
      </div>
    );
  }

  return (
    <div
      className="wiki-tree-item file"
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
      onClick={() => openFile(`${WIKI_PREFIX}${entry.path}`, entry.name)}
      title={entry.path}
    >
      <span className="wiki-tree-icon">✦</span>
      <span className="wiki-tree-name">{entry.name.replace('.md', '')}</span>
    </div>
  );
}

export function WikiFileTree() {
  const wikiFiles = useWikiStore((s) => s.wikiFiles);
  const isInitialized = useWikiStore((s) => s.isInitialized);
  const initWiki = useWikiStore((s) => s.initWiki);

  useEffect(() => {
    if (!isInitialized) {
      initWiki();
    }
  }, [isInitialized, initWiki]);

  const topFiles = wikiFiles.filter((e) => e.type === 'file');
  const dirs = wikiFiles.filter((e) => e.type === 'dir');

  return (
    <div className="wiki-file-tree">
      <div className="wiki-tree-header">
        <span className="wiki-tree-title">Wiki</span>
      </div>
      <div className="wiki-tree-list">
        {topFiles.map((entry) => (
          <WikiEntryItem key={entry.path} entry={entry} depth={0} />
        ))}
        {dirs.map((entry) => (
          <WikiEntryItem key={entry.path} entry={entry} depth={0} />
        ))}
        {wikiFiles.length === 0 && (
          <div className="wiki-tree-empty">
            Wiki 为空。在 AI 面板中摄入文件开始构建知识库。
          </div>
        )}
      </div>
    </div>
  );
}
