import { useEffect } from 'react';
import { useWikiStore } from '@/store/wikiStore';
import { useEditorStore } from '@/store/editorStore';
import type { WikiEntry } from '@/types/wiki';
import { WIKI_PREFIX } from '@/types/wiki';
import { FileIcon } from '@/components/icons/FileIcon';

function WikiEntryItem({ entry, depth }: { entry: WikiEntry; depth: number }) {
  const openFile = useEditorStore((s) => s.openFile);

  if (entry.type === 'dir') {
    return (
      <div>
        <div
          className="flex items-center gap-1.5 py-1 px-2 font-medium cursor-default text-[calc(var(--ui-font-size)-2px)] text-t2 rounded mx-1 transition-colors duration-100 hover:bg-hov hover:text-t1"
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          <span className="shrink-0 text-xs"><FileIcon filename={entry.name} isDir /></span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap min-w-0 flex-1">{entry.name}</span>
          {entry.children && (
            <span className="shrink-0 text-[10px] text-t3 bg-hov px-[5px] rounded-lg">{entry.children.filter((c) => c.type === 'file').length}</span>
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
      className="flex items-center gap-1.5 py-1 px-2 cursor-pointer text-[calc(var(--ui-font-size)-2px)] text-t2 rounded mx-1 transition-colors duration-100 hover:bg-hov hover:text-t1"
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
      onClick={() => openFile(`${WIKI_PREFIX}${entry.path}`, entry.name)}
      title={entry.path}
    >
      <span className="shrink-0 text-xs"><FileIcon filename={entry.name} /></span>
      <span className="overflow-hidden text-ellipsis whitespace-nowrap min-w-0 flex-1">{entry.name.replace('.md', '')}</span>
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
    <div className="flex-1 overflow-y-auto flex flex-col">
      <div className="py-2 px-3 text-[11px] font-semibold text-t3 uppercase tracking-[0.5px]">
        <span>Wiki</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {topFiles.map((entry) => (
          <WikiEntryItem key={entry.path} entry={entry} depth={0} />
        ))}
        {dirs.map((entry) => (
          <WikiEntryItem key={entry.path} entry={entry} depth={0} />
        ))}
        {wikiFiles.length === 0 && (
          <div className="p-4 text-center text-xs text-t3 leading-relaxed">
            Wiki 为空。在 AI 面板中摄入文件开始构建知识库。
          </div>
        )}
      </div>
    </div>
  );
}
