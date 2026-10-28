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
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
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
  const { t } = useTranslation();
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
          <div className="kb-eyebrow">{t('knowledge:reader.overviewEyebrow')}</div>
          <h1 className="kb-page-title">{t('knowledge:reader.overviewTitle')}</h1>
          <p className="kb-page-description">{topics.length > 0 ? t('knowledge:reader.overviewDescTopics', { count: topics.length }) : t('knowledge:reader.overviewDescEmpty')}</p>
          {topics.length > 0 ? (
            <div className="mt-4 border-t border-brd">
              {topics.map((tp) => {
                const sourceCount = navigation.find((n) => n.tpId === tp.tpId)?.sourceIds.length ?? 0;
                const reviewCount = reviews.filter((r) => r.topicId === tp.tpId).length;
                return <button key={tp.tpId} className="kb-topic-row" onClick={() => setActiveTopic(tp.tpId)}>
                  <span className="min-w-0"><span className="block text-[15px] font-medium text-t1">{tp.title}</span><span className="block mt-1 text-[12px] text-t3 break-all">{sourceCount > 0 ? t('knowledge:reader.relatedSources', { count: sourceCount }) : t('knowledge:reader.relatedNone')}{reviewCount > 0 ? t('knowledge:reader.reviewPending', { count: reviewCount }) : ''}</span></span>
                  <span className="text-acc text-[12px] shrink-0">{t('knowledge:reader.read')}</span>
                </button>;
              })}
            </div>
          ) : (
            <div className="kb-empty">
              <h2 className="text-[18px] font-medium text-t1">{scope.length === 0 ? t('knowledge:reader.emptyFirst') : buildRunning ? t('knowledge:reader.emptyBuilding') : t('knowledge:reader.emptyReady')}</h2>
              <p className="text-[13px] text-t3 max-w-[360px] leading-7">{t('knowledge:reader.emptyHint')}</p>
              <button className={BTN} onClick={() => { if (scope.length === 0) openSourceSettings('add'); else if (buildRunning) setPage('sources'); else { setPage('sources'); void build(); } }}>{scope.length === 0 ? t('knowledge:reader.emptyAdd') : buildRunning ? t('knowledge:reader.emptyView') : t('knowledge:reader.emptyOrganize')}</button>
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
  const { t } = useTranslation();
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
        <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-panel">
          <article className="kb-document shrink-0" style={{ paddingBottom: 0 }}>
            <ReaderHeader topic={topic} status={status} refsCount={refs.length} editing={editing} saving={saving} onEdit={enterEdit} onSave={handleSave} onCancel={handleCancel} />
            {refsUnavailable && <p role="status" className="text-[12px] text-t3">{t('knowledge:reader.refsUnavailable')}</p>}
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
            {status === 'loading' && <div role="status" className="flex items-center gap-2 text-t3 text-[13px]"><Loader2 size={15} className="animate-spin" />{t('knowledge:reader.loadingRefs')}</div>}
            {status === 'error' && <div role="alert" className="text-[13px] text-t2 leading-7"><p>{t('knowledge:reader.readError')}</p><button className={`${BTN} mt-3`} onClick={() => setAttempt((n) => n + 1)}>{t('knowledge:reader.retry')}</button></div>}
            {status === 'ready' && <>
              {refsUnavailable && <p role="status" className="mb-5 text-[12px] text-t3">{t('knowledge:reader.refsUnavailable')}</p>}
              {body.trim() ? <MarkdownWithCitations body={body} onCite={selectCitation} /> : <p className="text-[13px] text-t3">{t('knowledge:reader.noBody')}</p>}
              {citeId && !citedRef && <p role="status" className="mt-5 text-[12px] text-t3">{t('knowledge:reader.citeNotFound')}</p>}
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
  const { t } = useTranslation();
  return (
    <header className="mb-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="kb-eyebrow">{t('knowledge:reader.headerEyebrow')}</span>
        {editing ? (
          <div className="flex items-center gap-1.5">
            <button
              className={BTN_PRIMARY}
              disabled={saving}
              title={t('knowledge:reader.saveTitle')}
              onClick={onSave}
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <BookOpenCheck size={13} />}
              {t('knowledge:reader.save')}
            </button>
            <button className={BTN} disabled={saving} title={t('knowledge:reader.cancelTitle')} onClick={onCancel}>
              {t('knowledge:reader.cancel')}
            </button>
          </div>
        ) : (
          <button
            className={BTN}
            title={t('knowledge:reader.editTitle', { path: topic.path })}
            disabled={status !== 'ready'}
            onClick={onEdit}
          >
            <Pencil size={13} />{t('knowledge:reader.edit')}
          </button>
        )}
      </div>
      <h1 className="kb-document-title">{topic.title}</h1>
      <div className="mt-3 text-[12px] text-t3 flex flex-wrap gap-x-4 gap-y-1"><span>{status === 'ready' ? t('knowledge:reader.refsCount', { count: refsCount }) : status === 'loading' ? t('knowledge:reader.loadingTopic') : t('knowledge:reader.topicFailed')}</span><span>{editing ? t('knowledge:reader.metaEdit') : t('knowledge:reader.metaRead')}</span></div>
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
  // ponytail: renderMarkdownToReact 急切求值组件（在 useMemo 内直接调用），
  // Cite 里不能用 hook —— 用 i18n 单例（i18n-guidelines 非 React 层模式）。
  const Cite = (props: { href?: string; children?: ReactNode }) => {
    const href = props.href ?? '';
    if (!href.startsWith('#cite-')) return <a {...props}>{props.children}</a>;
    const id = href.slice('#cite-'.length);
    return (
      <a
        href={href}
        className="text-acc no-underline text-[0.85em] cursor-pointer hover:underline"
        title={i18n.t('knowledge:reader.citeTitle')}
        aria-label={i18n.t('knowledge:reader.citeAria', { id })}
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
  const { t } = useTranslation();
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
  const hash8 = (h: string | undefined | null) => (h ?? '').slice(0, 8) || t('knowledge:reader.unknownHash');

  return (
    <aside
      className="kb-citation-panel min-h-0 border-brd bg-panel flex flex-col overflow-hidden shrink-0"
      aria-label={t('knowledge:reader.panelLabel')}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-brd shrink-0">
        <span className="text-[11px] font-semibold text-t2">{t('knowledge:reader.panelTitle', { id: citation.id })}</span>
        <div className="flex-1" />
        <button
          className="min-h-[28px] min-w-[28px] flex items-center justify-center rounded border-none bg-transparent text-t3 cursor-pointer hover:bg-hov hover:text-t1"
          aria-label={t('knowledge:reader.closePanel')}
          onClick={onClose}
        >
          <X size={12} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3 text-[12px] [scrollbar-width:thin]">
        <div>
          <div className="text-t3 text-[11px] mb-0.5">{t('knowledge:reader.source')}</div>
          <div className="text-t1 break-all">{entry?.path ?? citation.srcPath ?? citation.srcId}</div>
          {removed && (
            <div className="mt-0.5 text-[#b48a3f]">{t('knowledge:reader.sourceRemovedNote')}</div>
          )}
        </div>
        <RefStatusBlock citation={citation} removed={removed} />
        <div>
          <div className="text-t3 text-[11px] mb-0.5">{t('knowledge:reader.position')}</div>
          <div className="text-t1">L{citation.startLine}–L{citation.endLine}</div>
          <blockquote className="mt-1 pl-2 border-l-2 border-brd text-t2 whitespace-pre-wrap">
            {citation.anchorText}
          </blockquote>
        </div>
        <div>
          <div className="text-t3 text-[11px] mb-0.5">{t('knowledge:reader.versionLabel')}</div>
          <div className="text-t1">{t('knowledge:reader.citedAt', { hash: hash8(citation.versionHash) })}</div>
          {removed ? (
            <div className="text-t3">{t('knowledge:reader.currentStopped')}</div>
          ) : (
            <>
              <div className={citationStale ? 'text-[#b48a3f]' : 'text-t2'}>
                {t('knowledge:reader.ingestedAt', { hash: hash8(entry?.currentHash) })}
                {entry ? (citationStale ? t('knowledge:reader.stale') : t('knowledge:reader.sameAsCited')) : ''}
              </div>
              <div className={diskChanged ? 'text-[#b48a3f]' : 'text-t2'}>
                {t('knowledge:reader.currentFile', { hash: diskHash ? hash8(diskHash) : t('knowledge:reader.diskUnreadable') })}
                {diskHash
                  ? diskChanged
                    ? t('knowledge:reader.diskChanged')
                    : t('knowledge:reader.diskSame')
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
              {t('knowledge:reader.openCurrent')}
            </button>
          )}
          <button className={BTN} onClick={() => { void openKbFileInEditor(fs, kbSourceSnapshotPath(citation.srcId, citation.versionHash, fs.root)); }}>
            <History size={12} />
            {t('knowledge:reader.openSnapshot')}
          </button>
          {citation.status === 'unverified' &&
            (removed || !entry ? (
              <span className="text-t3 text-[11px] self-center">{t('knowledge:reader.verifySkipped')}</span>
            ) : (
              <button
                className={BTN}
                disabled={verifyingRefId !== null}
                title={t('knowledge:reader.verifyTitle')}
                onClick={() => void verifyTopicRefItem(citation.topicId, citation.id)}
              >
                {verifyingRefId === citation.id ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
                {t('knowledge:reader.verify')}
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
  const { t } = useTranslation();
  return (
    <div>
      <div className="text-t3 text-[11px] mb-0.5">{t('knowledge:reader.statusLabel')}</div>
      {citation.status === 'unverified' && (
        <div className="text-[#b48a3f]">
          {t('knowledge:reader.statusUnverified')}{removed ? t('knowledge:reader.statusUnverifiedRemoved') : t('knowledge:reader.statusUnverifiedHint')}
        </div>
      )}
      {citation.status === 'verified' && (
        <div className="text-t2">{t('knowledge:reader.statusVerified')}{citation.verifyNote ? `${t('knowledge:reader.colon')}${citation.verifyNote}` : ''}</div>
      )}
      {citation.status === 'unsupported' && (
        <div className="text-[#b48a3f]">
          {t('knowledge:reader.statusUnsupported')}{citation.verifyNote ? `${t('knowledge:reader.colon')}${citation.verifyNote}` : ''}{t('knowledge:reader.noteSuffix')}
        </div>
      )}
      {citation.status === 'deleted' && (
        <div className="text-t2">{t('knowledge:reader.statusDeleted')}</div>
      )}
      {citation.status === 'active' && <div className="text-t2">{t('knowledge:reader.statusActive')}</div>}
      {citation.status === 'source-removed' && (
        <div className="text-[#b48a3f]">{t('knowledge:reader.statusSourceRemoved')}</div>
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
  const { t } = useTranslation();
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
      <div className="text-t3 text-[11px]">{t('knowledge:reader.snapshotMissing')}</div>
    );
  }
  if (text === null) return <div role="status" className="text-t3 text-[12px]">{t('knowledge:reader.snapshotLoading')}</div>;
  return (
    <div>
      <div className="text-t3 text-[11px] mb-0.5">{t('knowledge:reader.snapshotTitle', { start: startLine, end: endLine })}</div>
      <pre className="whitespace-pre-wrap text-t2 text-[11px] font-mono bg-hov rounded p-2 max-h-[220px] overflow-y-auto [scrollbar-width:thin]">{text}</pre>
    </div>
  );
}
