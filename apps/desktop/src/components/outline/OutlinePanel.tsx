import { useState } from 'react';
import { useEditorStore } from '../../store/editorStore';

interface HeadingItem {
  level: number;
  text: string;
  line: number;
}

function extractHeadings(content: string): HeadingItem[] {
  const lines = content.split('\n');
  const headings: HeadingItem[] = [];
  lines.forEach((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      headings.push({ level: match[1].length, text: match[2], line: index + 1 });
    }
  });
  return headings;
}

export function OutlinePanel() {
  const outlineVisible = useEditorStore((s) => s.outlineVisible);
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const [collapsed, setCollapsed] = useState(false);

  if (!outlineVisible) return null;

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const headings = activeTab ? extractHeadings(activeTab.content) : [];

  return (
    <div className={`${collapsed ? 'w-8' : 'w-[200px]'} shrink-0 h-full bg-panel border-l border-brd flex flex-col overflow-hidden transition-[width] duration-200`}>
      <div className="flex items-center justify-between py-2.5 px-2 shrink-0 border-b border-brd">
        {!collapsed && <span className="text-[11px] font-semibold text-t2 uppercase tracking-[0.05em]">大纲</span>}
        <button className="w-[22px] h-[22px] flex items-center justify-center rounded text-[10px] text-t3 cursor-pointer transition-[background] duration-[120ms] hover:bg-hov hover:text-t1" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▸' : '◂'}
        </button>
      </div>
      {!collapsed && (
        <div className="flex-1 overflow-y-auto py-1.5">
          {headings.length === 0 ? (
            <p className="text-center text-t3 text-[11px] mt-4">暂无标题</p>
          ) : (
            headings.map((h, i) => (
              <div
                key={i}
                className="py-1 px-2 text-xs text-t2 cursor-pointer rounded-none transition-all duration-[120ms] whitespace-nowrap overflow-hidden text-ellipsis hover:bg-hov hover:text-t1"
                style={{ paddingLeft: `${8 + (h.level - 1) * 12}px` }}
                title={`Ln ${h.line}`}
              >
                {h.text}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
