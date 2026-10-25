/**
 * 「知识」页：选中主题的阅读视图 + 按需旁侧展开的来源依据面板。
 *
 * - 正文用现有 markdown 渲染管线（renderMarkdownToReact）；`[^cN]` 引用标记
 *   预处理成 `#cite-cN` 链接，点击在旁侧显示来源、位置、引用时版本 vs 当前版本。
 * - 编辑跳现有编辑器（editorIoService.openFile + 切回 files 面板），不另造编辑器。
 * - 窄屏降级（notes「视觉与键盘规则」）：先收导航（导航在侧栏），来源面板
 *   移到正文之后（xl 以上恢复旁侧）。
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ExternalLink, History, Pencil, X } from 'lucide-react';
import remarkGfm from 'remark-gfm';
import { renderMarkdownToReact } from '@/services/markdown/renderMarkdown';
import { useEditorStore } from '@/store/editorStore';
import { useKnowledgeStore } from '@/store/knowledgeStore';
import { openFile } from '@/services/editorIoService';
import { vaultKbFs } from '@/services/knowledge/kbFs';
import { readTopicRefs } from '@/services/knowledge/kbFs';
import { kbSourceSnapshotPath } from '@/services/knowledge/kbPaths';
import { parseTopicPage, stripFootnoteDefs } from '@/services/knowledge/topicSynth';
import type { KbRef } from '@/services/knowledge/kbTypes';
import { BTN } from './kbUi';

/** `[^cN]` → `[N](#cite-cN)`：确定性链接化，避免依赖 markdown 脚注机制。 */
function citationizeBody(body: string): string {
  return stripFootnoteDefs(body).replace(/\[\^c(\d+)\]/g, (_m, n: string) => `[${n}](#cite-c${n})`);
}

function openInEditor(path: string): void {
  const name = path.split('/').pop() ?? path;
  void openFile(path, name);
  // 打开的标签页属于 files 面板（detectActivity 恒为 'files'），切回去才能看到。
  useEditorStore.getState().setActivePanel('files');
}

export function TopicReader(): React.JSX.Element {
  const activeTpId = useKnowledgeStore((s) => s.activeTpId);
  const topics = useKnowledgeStore((s) => s.topics);
  const dataVersion = useKnowledgeStore((s) => s.dataVersion);
  const setPage = useKnowledgeStore((s) => s.setPage);

  const topic = topics.find((t) => t.tpId === activeTpId);

  const [content, setContent] = useState<string | null>(null);
  const [refs, setRefs] = useState<KbRef[]>([]);
  const [citeId, setCiteId] = useState<string | null>(null);

  useEffect(() => {
    setCiteId(null);
    if (!topic) {
      setContent(null);
      setRefs([]);
      return;
    }
    let alive = true;
    void (async () => {
      const fs = vaultKbFs();
      const text = await fs.readFile(topic.path).catch(() => null);
      const r = await readTopicRefs(fs, topic.tpId).catch(() => []);
      if (!alive) return;
      setContent(text);
      setRefs(r);
    })();
    return () => {
      alive = false;
    };
  }, [topic, dataVersion]);

  const body = useMemo(() => (content ? citationizeBody(parseTopicPage(content).body) : ''), [content]);

  const citedRef = citeId ? refs.find((r) => r.id === citeId) ?? null : null;

  if (!topic) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-t3 text-[13px] select-none">
        {topics.length > 0 ? (
          <>
            <span>在左侧「主题」中选择一个知识页开始阅读。</span>
            <span className="text-[11px]">点击段落中的引用标记可在此处核对来源依据。</span>
          </>
        ) : (
          <>
            <span>尚未生成主题知识页。</span>
            <button className={BTN} onClick={() => setPage('sources')}>
              去收录资料并构建
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    // ponytail: 侧栏宽度 320px；xl 以下来源面板下沉到正文之后（notes 降级顺序）。
    <div className="flex-1 flex flex-col xl:flex-row overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-brd shrink-0">
          <span className="text-[13px] font-semibold text-t1 truncate" title={topic.title}>{topic.title}</span>
          <span className="text-[11px] text-t3 truncate" title={topic.path}>{topic.path}</span>
          <div className="flex-1" />
          <button className={BTN} onClick={() => openInEditor(topic.path)}>
            <Pencil size={12} />
            编辑
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 [scrollbar-width:thin]">
          {content === null ? (
            <div className="text-t3 text-[12px]">主题页读取失败：{topic.path}</div>
          ) : (
            <MarkdownWithCitations body={body} onCite={setCiteId} />
          )}
        </div>
      </div>

      {citedRef && (
        <CitationPanel citation={citedRef} onClose={() => setCiteId(null)} />
      )}
    </div>
  );
}

function MarkdownWithCitations({ body, onCite }: { body: string; onCite: (id: string) => void }): React.JSX.Element {
  const node = useMemo(() => {
    try {
      return renderMarkdownToReact(body, {
        remarkExtensions: [remarkGfm],
        components: { a: CiteAnchor(onCite) },
      });
    } catch {
      return body;
    }
  }, [body, onCite]);
  return <div className="kb-md">{node}</div>;
}

/** 引用标记锚点：`#cite-cN` 拦截为旁侧展开，其余链接原样渲染。 */
function CiteAnchor(onCite: (id: string) => void) {
  const Cite = (props: { href?: string; children?: ReactNode }) => {
    const href = props.href ?? '';
    if (!href.startsWith('#cite-')) return <a {...props}>{props.children}</a>;
    const id = href.slice('#cite-'.length);
    return (
      <a
        href={href}
        className="text-acc no-underline text-[0.85em] cursor-pointer hover:underline"
        title="查看来源依据"
        aria-label={`查看引用 ${id} 的来源依据`}
        onClick={(e) => {
          e.preventDefault();
          onCite(id);
        }}
      >
        {props.children}
      </a>
    );
  };
  return Cite;
}

function CitationPanel({ citation, onClose }: { citation: KbRef; onClose: () => void }): React.JSX.Element {
  const sources = useKnowledgeStore((s) => s.sources);
  const entry = sources[citation.srcId];
  const removed = entry?.removed === true;
  const versionMatches = !!entry && entry.currentHash === citation.versionHash;

  return (
    <aside
      className="w-full xl:w-[320px] xl:border-l border-t xl:border-t-0 border-brd bg-panel flex flex-col overflow-hidden shrink-0"
      aria-label="来源依据"
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-brd shrink-0">
        <span className="text-[11px] font-semibold text-t2">来源依据 · {citation.id}</span>
        <div className="flex-1" />
        <button
          className="p-1 rounded border-none bg-transparent text-t3 cursor-pointer hover:bg-hov hover:text-t1"
          aria-label="关闭来源面板"
          onClick={onClose}
        >
          <X size={12} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2.5 py-2 flex flex-col gap-2 text-[12px] [scrollbar-width:thin]">
        <div>
          <div className="text-t3 text-[10px] mb-0.5">来源</div>
          <div className="text-t1 break-all">{entry?.path ?? citation.srcPath ?? citation.srcId}</div>
          {removed && (
            <div className="mt-0.5 text-[#b48a3f]">来源已移除（已停止跟踪），以下为引用时保留的历史原文。</div>
          )}
        </div>
        <div>
          <div className="text-t3 text-[10px] mb-0.5">位置</div>
          <div className="text-t1">L{citation.startLine}–L{citation.endLine}</div>
          <blockquote className="mt-1 pl-2 border-l-2 border-brd text-t2 whitespace-pre-wrap">
            {citation.anchorText}
          </blockquote>
        </div>
        <div>
          <div className="text-t3 text-[10px] mb-0.5">版本</div>
          <div className="text-t1">引用时：{(citation.versionHash ?? '').slice(0, 8) || '（未知）'}</div>
          {removed ? (
            <div className="text-t3">当前版本：已停止跟踪，不再读取当前文件。</div>
          ) : (
            <div className={versionMatches ? 'text-t2' : 'text-[#b48a3f]'}>
              当前：{(entry?.currentHash ?? '').slice(0, 8) || '（未收录）'}
              {entry
                ? versionMatches
                  ? '（与引用时一致）'
                  : '（资料已更新，引用基于旧版本）'
                : ''}
            </div>
          )}
        </div>

        <SnapshotExcerpt srcId={citation.srcId} versionHash={citation.versionHash} startLine={citation.startLine} endLine={citation.endLine} />

        <div className="flex gap-1.5 flex-wrap mt-1">
          {!removed && entry && (
            <button className={BTN} onClick={() => openInEditor(entry.path)}>
              <ExternalLink size={12} />
              打开当前原文
            </button>
          )}
          <button className={BTN} onClick={() => openInEditor(kbSourceSnapshotPath(citation.srcId, citation.versionHash))}>
            <History size={12} />
            打开引用时版本
          </button>
        </div>
      </div>
    </aside>
  );
}

/** 引用时版本的原文摘录（ADR-0007：引用版本快照随 Vault 携带）。 */
function SnapshotExcerpt({
  srcId,
  versionHash,
  startLine,
  endLine,
}: {
  srcId: string;
  versionHash: string;
  startLine: number;
  endLine: number;
}): React.JSX.Element | null {
  const [text, setText] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    void vaultKbFs()
      .readFile(kbSourceSnapshotPath(srcId, versionHash))
      .then((content) => {
        if (!alive) return;
        const lines = content.split('\n');
        setText(lines.slice(startLine - 1, endLine).join('\n'));
      })
      .catch(() => {
        if (alive) setMissing(true);
      });
    return () => {
      alive = false;
    };
  }, [srcId, versionHash, startLine, endLine]);

  if (missing) {
    return (
      <div className="text-t3 text-[11px]">引用时版本的原文快照缺失（该版本未被其他引用保留）。</div>
    );
  }
  if (text === null) return null;
  return (
    <div>
      <div className="text-t3 text-[10px] mb-0.5">引用时原文（L{startLine}–L{endLine}）</div>
      <pre className="whitespace-pre-wrap text-t2 text-[11px] font-mono bg-hov rounded p-2 max-h-[220px] overflow-y-auto [scrollbar-width:thin]">{text}</pre>
    </div>
  );
}
