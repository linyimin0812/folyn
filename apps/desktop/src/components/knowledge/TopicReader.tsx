/**
 * 「知识」页：选中主题的阅读视图 + 按需旁侧展开的来源依据面板。
 *
 * - 正文用现有 markdown 渲染管线（renderMarkdownToReact）；`[^cN]` 引用标记
 *   预处理成 `#cite-cN` 链接，点击在旁侧显示来源、位置、引用时版本 vs 当前版本。
 * - 「编辑知识页」页内编辑（10-28 任务）：编辑态用应用真实编辑器
 *   FolynEditor（CodeMirror markdown，行号/高亮/编辑器字体设置）编辑文件原文
 *   （frontmatter + 正文 + 脚注定义），保存走 store.saveTopicPage（用户编辑
 *   语义，ADR-0006），不跳转编辑器；编辑器跳转仅保留在引用面板的原文/
 *   历史版本。
 * - 窄屏降级（notes「视觉与键盘规则」）：先收导航（导航在侧栏），来源面板
 *   移到正文之后（工作区可用宽度达到 900px 后恢复旁侧）。
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BookOpenCheck, ExternalLink, History, Loader2, Pencil, ShieldCheck, X } from 'lucide-react';
import remarkGfm from 'remark-gfm';
import { renderMarkdownToReact } from '@/services/markdown/renderMarkdown';
import { FolynEditor } from '@/editor/EditorView';
import { useEditorStore } from '@/store/editorStore';
import { activeThemeFs, useKnowledgeStore } from '@/store/knowledgeStore';
import { openFile } from '@/services/editorIoService';
import { sha256Hex, type KbFs } from '@/services/knowledge/kbFs';
import { readTopicRefs } from '@/services/knowledge/kbFs';
import { kbSourceSnapshotPath } from '@/services/knowledge/kbPaths';
import { parseTopicPage, stripFootnoteDefs } from '@/services/knowledge/topicSynth';
import { citationVersionWarn } from '@/services/knowledge/sourceStatus';
import type { KbRef } from '@/services/knowledge/kbTypes';
import { BTN, BTN_PRIMARY } from './kbUi';
import { useVaultStore } from '@/store/vaultStore';

const readingPositions = new Map<string, { top: number; citation: string | null }>();

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

/** KB 生成物（快照等）在 vault 之外（ADR-0011），编辑器打开需要绝对路径
 *  （openFile 外部路径先例：drops）；无 absPath 的 fs（测试 fake）回退原路径。 */
async function openKbFileInEditor(fs: KbFs, path: string): Promise<void> {
  openInEditor((await fs.absPath?.(path)) ?? path);
}

export function TopicReader(): React.JSX.Element {
  const vaultId = useVaultStore((s) => s.activeVaultId);
  const themeId = useKnowledgeStore((s) => s.activeThemeId);
  const activeTpId = useKnowledgeStore((s) => s.activeTpId);
  const topics = useKnowledgeStore((s) => s.topics);
  const dataVersion = useKnowledgeStore((s) => s.dataVersion);
  const setPage = useKnowledgeStore((s) => s.setPage);
  const setActiveTopic = useKnowledgeStore((s) => s.setActiveTopic);
  const scope = useKnowledgeStore((s) => s.scope);
  const buildRunning = useKnowledgeStore((s) => s.buildRunning);
  const openSourceSettings = useKnowledgeStore((s) => s.openSourceSettings);
  const build = useKnowledgeStore((s) => s.build);
  const navigation = useKnowledgeStore((s) => s.navigation);
  const reviews = useKnowledgeStore((s) => s.reviews);
  const topic = topics.find((t) => t.tpId === activeTpId);

  if (!topic) {
    return (
      <div className="kb-page flex-1 min-h-0 overflow-y-auto">
        <div className="kb-page-inner">
          <div className="kb-eyebrow">主题内的知识积累</div>
          <h1 className="kb-page-title">知识概览</h1>
          <p className="kb-page-description">{topics.length > 0 ? `已整理 ${topics.length} 篇知识页。打开一篇阅读，沿着引用回到原始资料。` : '从原始资料中整理知识，让零散的信息形成脉络。'}</p>
          {topics.length > 0 ? (
            <div className="mt-4 border-t border-brd">
              {topics.map((t) => {
                const sourceCount = navigation.find((n) => n.tpId === t.tpId)?.sourceIds.length ?? 0;
                const reviewCount = reviews.filter((r) => r.topicId === t.tpId).length;
                return <button key={t.tpId} className="kb-topic-row" onClick={() => setActiveTopic(t.tpId)}>
                  <span className="min-w-0"><span className="block text-[15px] font-medium text-t1">{t.title}</span><span className="block mt-1 text-[12px] text-t3 break-all">{sourceCount > 0 ? `${sourceCount} 份关联资料` : '打开知识页，核对原文依据'}{reviewCount > 0 ? ` · ${reviewCount} 项修订待审阅` : ''}</span></span>
                  <span className="text-acc text-[12px] shrink-0">阅读 →</span>
                </button>;
              })}
            </div>
          ) : (
            <div className="kb-empty">
              <h2 className="text-[18px] font-medium text-t1">{scope.length === 0 ? '为这个主题添加第一份资料' : buildRunning ? '正在整理你的资料' : '资料已就绪，开始整理知识'}</h2>
              <p className="text-[13px] text-t3 max-w-[360px] leading-7">整理后的知识页会出现在这里。阅读时，点击引用标记即可核对原文与版本。</p>
              <button className={BTN} onClick={() => { if (scope.length === 0) openSourceSettings('add'); else if (buildRunning) setPage('sources'); else { setPage('sources'); void build(); } }}>{scope.length === 0 ? '添加资料' : buildRunning ? '查看整理过程' : '整理资料'}</button>
            </div>
          )}
        </div>
      </div>
    );
  }
  // Changing identity remounts the read state before paint, so a new title can never carry old content.
  return <SelectedTopic key={`${vaultId}:${themeId}:${topic.tpId}:${topic.path}:${dataVersion}`} topic={topic} readKey={`${vaultId}:${themeId}:${topic.tpId}`} />;
}

function SelectedTopic({ topic, readKey }: { topic: { tpId: string; title: string; path: string }; readKey: string }): React.JSX.Element {
  const [content, setContent] = useState<string | null>(null);
  const [refs, setRefs] = useState<KbRef[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refsUnavailable, setRefsUnavailable] = useState(false);
  const [citeId, setCiteId] = useState<string | null>(() => readingPositions.get(readKey)?.citation ?? null);
  const scroll = useRef<HTMLDivElement>(null);
  const selectCitation = (id: string) => { setCiteId(id); readingPositions.set(readKey, { top: scroll.current?.scrollTop ?? 0, citation: id }); };
  useLayoutEffect(() => { if (status === 'ready' && scroll.current) scroll.current.scrollTop = readingPositions.get(readKey)?.top ?? 0; }, [readKey, status]);
  const [attempt, setAttempt] = useState(0);
  // 页内编辑（10-28）：draft 为文件原文（含 frontmatter/脚注）；保存成功后
  // 退出编辑态，dataVersion+1 触发上方 remount key 重挂载重读正文与引用。
  // 编辑态渲染真实 FolynEditor（CodeMirror），外层不滚动，滚动交给编辑器自身。
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const saveTopicPage = useKnowledgeStore((s) => s.saveTopicPage);
  const enterEdit = () => { setDraft(content ?? ''); setSaveError(''); setCiteId(null); setEditing(true); };
  const handleSave = () => {
    if (saving) return;
    setSaving(true);
    setSaveError('');
    void saveTopicPage(topic.tpId, draft).then((outcome) => {
      setSaving(false);
      if (outcome.ok) setEditing(false); // 成功即回阅读态；随后的 dataVersion+1 重挂载只是双保险
      else setSaveError(outcome.error);
    });
  };
  const handleCancel = () => { setEditing(false); setSaveError(''); };

  useEffect(() => {
    let alive = true;
    setStatus('loading');
    setRefsUnavailable(false);
    void (async () => {
      try {
        const fs = activeThemeFs();
        const [text, references] = await Promise.all([
          fs.readFile(topic.path),
          readTopicRefs(fs, topic.tpId).catch(() => null),
        ]);
        if (!alive) return;
        setContent(text);
        setRefs(references ?? []);
        setRefsUnavailable(references === null);
        setStatus('ready');
      } catch {
        if (alive) setStatus('error');
      }
    })();
    return () => { alive = false; };
  }, [topic.path, topic.tpId, attempt]);

  const body = useMemo(() => {
    if (content === null) return '';
    const parsedBody = parseTopicPage(content).body;
    // Generated pages retain their H1 on disk. Omit only the matching leading title
    // in this reading surface, where the document header already presents it.
    const heading = parsedBody.match(/^\s*# ([^\n]+)\n?/);
    const displayBody = heading && heading[1].trim().replace(/\s+#+\s*$/, '') === topic.title.trim()
      ? parsedBody.slice(heading[0].length)
      : parsedBody;
    return citationizeBody(displayBody);
  }, [content, topic.title]);
  const citedRef = citeId ? refs.find((r) => r.id === citeId) ?? null : null;

  return (
    <div className="kb-reader bg-panel flex-1 min-h-0 min-w-0 flex overflow-hidden">
      {editing ? (
        // 编辑态与真实编辑器同布局（参考 EditorPane）：外层 flex 列 + overflow-hidden，
        // cm-wrapper flex:1 撑满可用高度，滚动由 CodeMirror 自身接管。
        <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-surf">
          <article className="kb-document shrink-0" style={{ paddingBottom: 0 }}>
            <ReaderHeader topic={topic} status={status} refsCount={refs.length} editing={editing} saving={saving} onEdit={enterEdit} onSave={handleSave} onCancel={handleCancel} />
            {refsUnavailable && <p role="status" className="text-[12px] text-t3">引用信息暂时无法读取，正文仍可阅读。</p>}
          </article>
          <div className="kb-edit-column flex-1 min-h-0 min-w-0 flex flex-col">
            <FolynEditor
              initialContent={draft}
              filePath={topic.path}
              onChange={setDraft}
              onSave={handleSave}
              persistTabScroll={false}
            />
            {saveError && <p role="alert" className="shrink-0 pb-2 text-[12px] text-[#e05252]">{saveError}</p>}
          </div>
        </div>
      ) : (
        <div ref={scroll} onScroll={() => readingPositions.set(readKey, { top: scroll.current?.scrollTop ?? 0, citation: citeId })} className="flex-1 min-h-0 min-w-0 overflow-y-auto [scrollbar-width:thin]">
          <article className="kb-document">
            <ReaderHeader topic={topic} status={status} refsCount={refs.length} editing={editing} saving={saving} onEdit={enterEdit} onSave={handleSave} onCancel={handleCancel} />
            {status === 'loading' && <div role="status" className="flex items-center gap-2 text-t3 text-[13px]"><Loader2 size={15} className="animate-spin" />正在读取主题与引用…</div>}
            {status === 'error' && <div role="alert" className="text-[13px] text-t2 leading-7"><p>无法读取主题文件。请检查知识库存储目录。</p><button className={`${BTN} mt-3`} onClick={() => setAttempt((n) => n + 1)}>重新读取</button></div>}
            {status === 'ready' && <>
              {refsUnavailable && <p role="status" className="mb-5 text-[12px] text-t3">引用信息暂时无法读取，正文仍可阅读。</p>}
              {body.trim() ? <MarkdownWithCitations body={body} onCite={selectCitation} /> : <p className="text-[13px] text-t3">这个主题还没有正文，点击上方「编辑知识页」补充。</p>}
              {citeId && !citedRef && <p role="status" className="mt-5 text-[12px] text-t3">未找到此引用的来源信息。</p>}
            </>}
          </article>
        </div>
      )}
      {citedRef && <CitationPanel key={`${citedRef.id}:${citedRef.srcId}:${citedRef.versionHash}:${citedRef.startLine}:${citedRef.endLine}`} citation={citedRef} onClose={() => { setCiteId(null); readingPositions.set(readKey, { top: scroll.current?.scrollTop ?? 0, citation: null }); }} />}
    </div>
  );
}

/** 文档头：标题 + 编辑态切换（保存/取消）或「编辑知识页」入口，阅读/编辑两态共用。 */
function ReaderHeader({ topic, status, refsCount, editing, saving, onEdit, onSave, onCancel }: {
  topic: { title: string; path: string };
  status: 'loading' | 'ready' | 'error';
  refsCount: number;
  editing: boolean;
  saving: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  return (
    <header className="mb-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="kb-eyebrow">知识页</span>
        {editing ? (
          <div className="flex items-center gap-1.5">
            <button
              className={BTN_PRIMARY}
              disabled={saving}
              title="写回主题页（用户编辑：后续 AI 追加内容须经审阅）"
              onClick={onSave}
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <BookOpenCheck size={13} />}
              保存
            </button>
            <button className={BTN} disabled={saving} title="丢弃修改，回到阅读态" onClick={onCancel}>
              取消
            </button>
          </div>
        ) : (
          <button
            className={BTN}
            title={`在当前页面编辑：${topic.path}`}
            disabled={status !== 'ready'}
            onClick={onEdit}
          >
            <Pencil size={13} />编辑知识页
          </button>
        )}
      </div>
      <h1 className="kb-document-title">{topic.title}</h1>
      <div className="mt-3 text-[12px] text-t3 flex flex-wrap gap-x-4 gap-y-1"><span>{status === 'ready' ? `${refsCount} 处引用` : status === 'loading' ? '读取主题…' : '主题未能载入'}</span><span>{editing ? '编辑文件原文，保存后引用与版本信息随之刷新' : '点击段落引用查看原文'}</span></div>
    </header>
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
  const fs = useMemo(() => activeThemeFs(), []);
  const sources = useKnowledgeStore((s) => s.sources);
  const dataVersion = useKnowledgeStore((s) => s.dataVersion);
  const verifyTopicRefItem = useKnowledgeStore((s) => s.verifyTopicRefItem);
  const verifyingRefId = useKnowledgeStore((s) => s.verifyingRefId);
  const refNotice = useKnowledgeStore((s) => s.refNotice);
  const entry = sources[citation.srcId];
  const removed = entry?.removed === true;

  // 磁盘当前版本实时检测（切片 B）：与 kbAsk.readSource 同口径 ——
  // manifest 收录 hash vs 磁盘实际 hash；只提示，不静默替换。
  const [diskHash, setDiskHash] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setDiskHash(null);
    if (!entry || removed) return;
    void fs
      .readFile(entry.path)
      .then((content) => sha256Hex(content))
      .then((h) => {
        if (alive) setDiskHash(h);
      })
      .catch(() => {
        if (alive) setDiskHash(null);
      });
    return () => {
      alive = false;
    };
  }, [entry, removed, dataVersion, fs]);

  const { citationStale, diskChanged } = citationVersionWarn(
    citation.versionHash,
    entry?.currentHash,
    diskHash,
  );
  const hash8 = (h: string | undefined | null) => (h ?? '').slice(0, 8) || '（未知）';

  return (
    <aside
      className="kb-citation-panel min-h-0 border-brd bg-panel flex flex-col overflow-hidden shrink-0"
      aria-label="来源依据"
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-brd shrink-0">
        <span className="text-[11px] font-semibold text-t2">来源依据 · {citation.id}</span>
        <div className="flex-1" />
        <button
          className="min-h-[28px] min-w-[28px] flex items-center justify-center rounded border-none bg-transparent text-t3 cursor-pointer hover:bg-hov hover:text-t1"
          aria-label="关闭来源面板"
          onClick={onClose}
        >
          <X size={12} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3 text-[12px] [scrollbar-width:thin]">
        <div>
          <div className="text-t3 text-[11px] mb-0.5">来源</div>
          <div className="text-t1 break-all">{entry?.path ?? citation.srcPath ?? citation.srcId}</div>
          {removed && (
            <div className="mt-0.5 text-[#b48a3f]">来源已移除（已停止跟踪），以下为引用时保留的历史原文。</div>
          )}
        </div>
        <RefStatusBlock citation={citation} removed={removed} />
        <div>
          <div className="text-t3 text-[11px] mb-0.5">位置</div>
          <div className="text-t1">L{citation.startLine}–L{citation.endLine}</div>
          <blockquote className="mt-1 pl-2 border-l-2 border-brd text-t2 whitespace-pre-wrap">
            {citation.anchorText}
          </blockquote>
        </div>
        <div>
          <div className="text-t3 text-[11px] mb-0.5">版本</div>
          <div className="text-t1">引用时：{hash8(citation.versionHash)}</div>
          {removed ? (
            <div className="text-t3">当前版本：已停止跟踪，不再读取当前文件。</div>
          ) : (
            <>
              <div className={citationStale ? 'text-[#b48a3f]' : 'text-t2'}>
                收录时：{hash8(entry?.currentHash)}
                {entry ? (citationStale ? '（资料已更新，引用基于旧版本）' : '（与引用时一致）') : ''}
              </div>
              <div className={diskChanged ? 'text-[#b48a3f]' : 'text-t2'}>
                当前文件：{diskHash ? hash8(diskHash) : '（读取中或不可读）'}
                {diskHash
                  ? diskChanged
                    ? '（较收录版本又有改动，待重新收录）'
                    : '（与收录版本一致）'
                  : ''}
              </div>
            </>
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
          <button className={BTN} onClick={() => { void openKbFileInEditor(fs, kbSourceSnapshotPath(citation.srcId, citation.versionHash, fs.root)); }}>
            <History size={12} />
            打开引用时版本
          </button>
          {citation.status === 'unverified' &&
            (removed || !entry ? (
              <span className="text-t3 text-[11px] self-center">来源已移除，不做核验。</span>
            ) : (
              <button
                className={BTN}
                disabled={verifyingRefId !== null}
                title="模型读引用时原文与段落现文本，判断原文是否支持现说法"
                onClick={() => void verifyTopicRefItem(citation.topicId, citation.id)}
              >
                {verifyingRefId === citation.id ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
                核验引用
              </button>
            ))}
        </div>
        {refNotice && (
          <div role="status" className="text-[11px] text-t2 border-t border-brd pt-2">
            {refNotice}
          </div>
        )}
      </div>
    </aside>
  );
}

/** 引用状态（ADR-0006 删除意图 / ADR-0007 待核验与核验结果）。 */
function RefStatusBlock({ citation, removed }: { citation: KbRef; removed: boolean }): React.JSX.Element {
  return (
    <div>
      <div className="text-t3 text-[11px] mb-0.5">状态</div>
      {citation.status === 'unverified' && (
        <div className="text-[#b48a3f]">
          引用待核验{removed ? '（来源已移除，不做核验）' : '：段落被人工修改过，原文是否支持新说法待检查。'}
        </div>
      )}
      {citation.status === 'verified' && (
        <div className="text-t2">核验通过{citation.verifyNote ? `：${citation.verifyNote}` : ''}</div>
      )}
      {citation.status === 'unsupported' && (
        <div className="text-[#b48a3f]">
          原文不支持该说法{citation.verifyNote ? `：${citation.verifyNote}` : ''}。正文保留；改写须经审阅。
        </div>
      )}
      {citation.status === 'deleted' && (
        <div className="text-t2">该结论已被人工删除（删除意图已记录，不会自动恢复）。</div>
      )}
      {citation.status === 'active' && <div className="text-t2">正常。</div>}
      {citation.status === 'source-removed' && (
        <div className="text-[#b48a3f]">来源已移除（已停止跟踪）。</div>
      )}
    </div>
  );
}

/** 引用时版本的原文摘录（ADR-0007；快照存 ~/.folyn，ADR-0011）。 */
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
    setText(null);
    setMissing(false);
    const fs = activeThemeFs();
    void fs
      .readFile(kbSourceSnapshotPath(srcId, versionHash, fs.root))
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
      <div className="text-t3 text-[11px]">引用时版本的原文快照暂时无法读取。请检查知识库存储目录中的历史文件。</div>
    );
  }
  if (text === null) return <div role="status" className="text-t3 text-[12px]">正在读取引用时原文…</div>;
  return (
    <div>
      <div className="text-t3 text-[11px] mb-0.5">引用时原文（L{startLine}–L{endLine}）</div>
      <pre className="whitespace-pre-wrap text-t2 text-[11px] font-mono bg-hov rounded p-2 max-h-[220px] overflow-y-auto [scrollbar-width:thin]">{text}</pre>
    </div>
  );
}
