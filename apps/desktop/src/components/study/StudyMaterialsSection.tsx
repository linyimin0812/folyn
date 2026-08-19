import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NotebookText, Link } from 'lucide-react';
import type { StudyMaterial } from '@/features/study/types';
import { useStudyStore } from '@/store/studyStore';
import { useAiStore } from '@/store/aiStore';
import { isTauri } from '@/utils/platform';
import { isAiAvailable } from '@/features/study/scheduleLink';

interface Props {
  slug: string;
  path: string;
  materials: StudyMaterial[];
  /** 新增资料（lineIndex<0 → 追加到段尾）并回写。 */
  onAdd: (m: StudyMaterial) => Promise<void>;
  /** 编辑资料（保持 lineIndex，原地重写）并回写。 */
  onEdit: (m: StudyMaterial) => Promise<void>;
  /** 删除资料（按 id 过滤后回写，托管行移除）。 */
  onDelete: (id: string) => Promise<void>;
  /** 发起 AI 找资料：先让 AI 根据主题生成澄清问题（grill 式），回答后执行 research 并自动写入 `## 资料`。 */
  onResearch: () => void;
  /** SQ3R 预读：先查 `## 笔记` callout 缓存，未命中则调 AI 产出 → 弹窗展示。 */
  onSq3r: (m: StudyMaterial) => void;
}

/** 资料空态图标。 */
const STACK_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2 2 7l10 5 10-5-10-5z" />
    <path d="m2 12 10 5 10-5" />
    <path d="m2 17 10 5 10-5" />
  </svg>
);
/** 区段标题图标。 */
const SECTION_ICON = (
  <svg viewBox="0 0 1026 1024" fill="#d4237a" aria-hidden="true">
    <path d="M1015.808 790.528q5.12 30.72-12.8 55.296t-48.64 29.696l-122.88 19.456q-29.696 5.12-54.784-12.8t-30.208-48.64l-104.448-661.504q-2.048-15.36 1.536-29.184t11.776-25.6 20.992-19.456 28.16-10.752l121.856-19.456q30.72-5.12 55.296 13.312t29.696 49.152zM500.736 63.488q30.72 0 52.224 21.504t21.504 52.224l0 684.032q0 30.72-21.504 52.224t-52.224 21.504l-106.496 0q-30.72 0-52.224-21.504t-21.504-52.224l0-684.032q0-30.72 16.384-52.224t48.128-21.504l115.712 0zM500.736 579.584q10.24 0 17.408-9.728t7.168-23.04q0-14.336-7.168-23.552t-17.408-9.216l-106.496 0q-10.24 0-17.408 9.216t-7.168 23.552q0 13.312 7.168 23.04t17.408 9.728l106.496 0zM500.736 449.536q10.24 0 17.408-9.728t7.168-24.064-7.168-23.552-17.408-9.216l-106.496 0q-10.24 0-17.408 9.216t-7.168 23.552 7.168 24.064 17.408 9.728l106.496 0zM179.2 63.488q30.72 0 52.736 21.504t22.016 52.224l0 684.032q0 30.72-22.016 52.224t-52.736 21.504l-106.496 0q-30.72 0-52.736-21.504t-22.016-52.224l0-684.032q0-30.72 22.016-52.224t52.736-21.504l106.496 0zM76.8 319.488q-11.264 0-18.432 9.216t-7.168 23.552q0 13.312 7.168 23.04t18.432 9.728l98.304 0q11.264 0 17.92-9.728t6.656-23.04q0-14.336-6.656-23.552t-17.92-9.216l-98.304 0zM179.2 641.024q11.264 0 17.92-9.216t6.656-22.528q0-14.336-6.656-23.04t-17.92-8.704l-102.4 0q-11.264 0-18.432 8.704t-7.168 23.04q0 13.312 7.168 22.528t18.432 9.216l102.4 0zM179.2 515.072q11.264 0 17.92-9.216t6.656-23.552-6.656-23.552-17.92-9.216l-102.4 0q-11.264 0-18.432 9.216t-7.168 23.552 7.168 23.552 18.432 9.216l102.4 0z" />
  </svg>
);

/** 难度 → 颜色 token（复用 schedule sw-tag 体系）。 */
const DIFFICULTY_TAG: Record<'easy' | 'medium' | 'hard', string> = {
  easy: 'growth',
  medium: 'ops',
  hard: 'bug',
};

/**
 * 资料区：列出 `## 资料` 段的书目/网络资料，卡片化展示；手动 inline 添加/编辑/删除；
 * 多选资料 → 用选中资料生成计划；AI 动作：学习研究（建议卡片）、SQ3R 预读（直编+diff）。
 */
export function StudyMaterialsSection({
  slug,
  path,
  materials,
  onAdd,
  onEdit,
  onDelete,
  onResearch,
  onSq3r,
}: Props) {
  const [adding, setAdding] = useState<false | 'book' | 'web'>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 批量编辑模式：进入时默认全选（checked=保留），用户反选要删的；保存=批量删除未选中项。
  const [bulkEdit, setBulkEdit] = useState(false);
  // AI 正在确认（grill 阶段）或正在查找（research 阶段）——按钮显示等待态防重复点击。
  const pendingKind = useStudyStore((s) => s.pendingSuggestion?.kind);
  const clarifying = pendingKind === 'grill';
  const researching = pendingKind === 'research';
  // 首轮 grill（AI 尚未产出第一个问题）或资料查找中：整个资料栏置灰 + 居中加载图标。
  const grillQuestion = useStudyStore((s) => s.grillQuestion);
  const firstRoundLoading = clarifying && !grillQuestion;
  const sectionLoading = firstRoundLoading || researching;
  const aiAvailable = isAiAvailable();
  const { t } = useTranslation();

  // SQ3R 后台跑在隐藏的 study 会话（每主题一个）——按钮需要本地 loading 指示，
  // 否则用户看不到反馈。studySlug 与 openStudyAiAction 内部推导逻辑保持一致。
  const studySlug = path.split('/').pop()?.replace(/\.md$/, '') ?? 'default';
  const studySessionId = useAiStore((s) => s.studySessionIds[studySlug]);
  const studyStreaming = useAiStore((s) => {
    if (!studySessionId) return false;
    return s.sessions.find((x) => x.id === studySessionId)?.isStreaming ?? false;
  });
  const [sq3rId, setSq3rId] = useState<string | null>(null);
  useEffect(() => {
    if (!studyStreaming && sq3rId) setSq3rId(null);
  }, [studyStreaming, sq3rId]);
  // SQ3R 弹窗：命中 callout 缓存或 AI 产出后由 store 填充 sq3rOutput。
  const sq3rOutput = useStudyStore((s) => s.sq3rOutput);
  const setSq3rOutput = useStudyStore((s) => s.setSq3rOutput);
  const saveSq3rCallout = useStudyStore((s) => s.saveSq3rCallout);
  // 弹窗期间清掉 sq3rId，避免按钮持续显示 loading（弹窗已提供反馈）。
  useEffect(() => {
    if (sq3rOutput && sq3rId) setSq3rId(null);
  }, [sq3rOutput, sq3rId]);

  const openLink = (url?: string) => {
    if (!url) return;
    if (isTauri()) {
      import('@tauri-apps/plugin-shell').then(({ open }) => open(url));
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const runSq3r = (m: StudyMaterial) => {
    if (!aiAvailable || studyStreaming) return;
    setSq3rId(m.id);
    onSq3r(m);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const enterBulkEdit = () => {
    setSelectedIds(new Set(materials.map((m) => m.id)));
    setBulkEdit(true);
  };

  const saveBulkEdit = async () => {
    const toDelete = materials.filter((m) => !selectedIds.has(m.id));
    setBulkEdit(false);
    await Promise.all(toDelete.map((m) => onDelete(m.id)));
  };

  const editing = editingId ? materials.find((m) => m.id === editingId) ?? null : null;

  return (
    <section className={`sw-study-section${sectionLoading ? ' loading' : ''}`}>
      {sectionLoading && (
        <div className="sw-study-loading" role="status">
          <span className="sw-grill-spinner" aria-hidden="true" />
          <span>{researching ? t('study:materials.researchRunning') : t('study:grillDialog.generatingFirst')}</span>
        </div>
      )}
      <header className="sw-study-sec-head">
        <h3><span className="sw-sec-icon" aria-hidden="true">{SECTION_ICON}</span>{t('study:materials.sectionTitle')}</h3>
        <div className="sw-study-sec-actions">
          <button onClick={() => setAdding('book')} disabled={bulkEdit} title={t('study:materials.addBookTitle')}>{t('study:materials.addBook')}</button>
          <button onClick={() => setAdding('web')} disabled={bulkEdit} title={t('study:materials.addWebTitle')}>{t('study:materials.addWeb')}</button>
          <button
            className="primary"
            disabled={!aiAvailable || clarifying || researching || bulkEdit}
            title={aiAvailable ? t('study:materials.researchTitle') : t('study:materials.aiDisabled')}
            onClick={onResearch}
          >
            {researching ? (
              <><span className="sw-study-spinner" aria-hidden="true" />{t('study:materials.researchRunning')}</>
            ) : clarifying ? t('study:materials.researchClarifying') : t('study:materials.research')}
          </button>
          {bulkEdit ? (
            <button className="primary" onClick={saveBulkEdit} title={t('study:materials.form.save')}>{t('study:materials.form.save')}</button>
          ) : (
            <button onClick={enterBulkEdit} title={t('study:materials.edit')}>{t('study:materials.edit')}</button>
          )}
        </div>
      </header>

      {adding && (
        <MaterialForm
          key={`add-${adding}`}
          kind={adding}
          onCancel={() => setAdding(false)}
          onSubmit={async (m) => {
            await onAdd({ ...m, id: `${slug}#materials-new`, lineIndex: -1 });
            setAdding(false);
          }}
        />
      )}

      {editing && (
        <MaterialForm
          key={`edit-${editing.id}`}
          kind={editing.kind}
          initial={editing}
          onCancel={() => setEditingId(null)}
          onSubmit={async (m) => {
            await onEdit({ ...editing, ...m });
            setEditingId(null);
          }}
        />
      )}

      {materials.length === 0 ? (
        <div className="sw-empty-state">
          <span className="sw-empty-icon">{STACK_ICON}</span>
          <span className="sw-empty-text">{t('study:materials.empty')}</span>
          <span className="sw-empty-hint">{t('study:materials.emptyHint')}</span>
          <button className="sw-empty-cta" disabled={!aiAvailable || clarifying || researching} onClick={onResearch} title={aiAvailable ? '' : t('study:materials.aiDisabled')}>
            {researching ? (
              <><span className="sw-study-spinner" aria-hidden="true" />{t('study:materials.researchRunning')}</>
            ) : clarifying ? t('study:materials.researchClarifying') : t('study:materials.research')}
          </button>
        </div>
      ) : (
        <ul className="sw-study-list sw-material-grid">
          {materials.map((m) => (
            <li key={m.id} className={`sw-card sw-material-card${bulkEdit && selectedIds.has(m.id) ? ' selected' : ''}`}>
              <div className="sw-card-top">
                {bulkEdit && (
                  <label className="sw-card-select" title={t('study:materials.select')}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(m.id)}
                      onChange={() => toggleSelect(m.id)}
                    />
                  </label>
                )}
                <div className="sw-card-tags">
                  {m.difficulty && (
                    <span className={`sw-tag ${DIFFICULTY_TAG[m.difficulty]}`} title={t('study:materials.difficulty')}>
                      {t(`study:difficulty.${m.difficulty}`)}
                    </span>
                  )}
                  <span className={`sw-tag ${m.kind === 'book' ? 'dev' : 'ops'}`}>
                    <span className="sw-tag-icon">{m.kind === 'book' ? <NotebookText /> : <Link />}</span>
                    {m.kind === 'book' ? t('study:materials.kindBook') : t('study:materials.kindWeb')}
                  </span>
                </div>
              </div>
              <h4 className="sw-material-title">
                {m.url ? (
                  <a href={m.url} onClick={(e) => { e.preventDefault(); openLink(m.url); }} title={m.url}>{m.title}</a>
                ) : (
                  <span>{m.title}</span>
                )}
              </h4>
              {m.kind === 'book' && m.author && (
                <p className="sw-card-meta-line">{t('study:materials.author', { name: m.author })}</p>
              )}
              {m.summary && <p className="sw-material-summary">{m.summary}</p>}
              {!bulkEdit && (
                <div className="sw-card-foot">
                  <div className="sw-card-actions">
                    <button className="sw-card-action" onClick={() => setEditingId(m.id)} title={t('study:materials.editMaterial')}>{t('study:materials.edit')}</button>
                    <button className="sw-card-action" onClick={() => onDelete(m.id)} title={t('study:materials.deleteMaterial')}>{t('study:materials.delete')}</button>
                    <button
                      className="sw-card-action"
                      disabled={!aiAvailable || studyStreaming}
                      title={aiAvailable ? t('study:materials.sq3rTitle') : t('study:materials.aiDisabled')}
                      onClick={() => runSq3r(m)}
                    >
                    {sq3rId === m.id && studyStreaming ? (
                      <><span className="sw-study-spinner" aria-hidden="true" />{t('study:materials.sq3rRunning')}</>
                    ) : t('study:materials.sq3r')}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {sq3rOutput && (
        <Sq3rModal
          materialTitle={sq3rOutput.materialTitle}
          content={sq3rOutput.content}
          onClose={() => setSq3rOutput(null)}
          onKeep={async (body) => {
            await saveSq3rCallout(slug, sq3rOutput.materialTitle, body);
            setSq3rOutput(null);
          }}
          onReread={() => {
            const m = materials.find((x) => x.id === sq3rOutput.materialId);
            setSq3rOutput(null);
            if (m) runSq3r(m);
          }}
        />
      )}
    </section>
  );
}

interface FormProps {
  kind: 'book' | 'web';
  initial?: StudyMaterial;
  onCancel: () => void;
  onSubmit: (m: Omit<StudyMaterial, 'id' | 'lineIndex'>) => Promise<void>;
}

function MaterialForm({ kind, initial, onCancel, onSubmit }: FormProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [author, setAuthor] = useState(initial?.author ?? '');
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>(initial?.difficulty ?? 'medium');

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    await onSubmit({
      kind,
      title: trimmed,
      author: kind === 'book' ? author.trim() || undefined : undefined,
      summary: summary.trim() || undefined,
      difficulty: kind === 'book' ? difficulty : undefined,
      url: url.trim() || undefined,
    });
  };

  return (
    <div className="sw-overlay open" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="sw-modal" role="dialog" aria-modal="true">
        <h3>{initial ? t('study:materials.form.titleEdit', { kind: kind === 'book' ? t('study:materials.kindBook') : t('study:materials.kindWeb') }) : t('study:materials.form.titleNew', { kind: kind === 'book' ? t('study:materials.kindBook') : t('study:materials.kindWeb') })}</h3>

        <div className="sw-field">
          <label>{kind === 'book' ? t('study:materials.form.titleBook') : t('study:materials.form.titleWeb')}</label>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'book' ? t('study:materials.form.titleBook') : t('study:materials.form.titleWeb')} />
        </div>

        {kind === 'book' && (
          <div className="sw-field">
            <label>{t('study:materials.form.author')}</label>
            <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder={t('study:materials.form.author')} />
          </div>
        )}

        <div className="sw-field">
          <label>{t('study:materials.form.url')}</label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('study:materials.form.url')} />
        </div>

        {kind === 'book' && (
          <div className="sw-field">
            <label>{t('study:materials.form.difficultyLabel')}</label>
            <div className="sw-seg-inline">
              {(['easy', 'medium', 'hard'] as const).map((d) => (
                <label key={d}>
                  <input
                    type="radio"
                    name="sw-material-difficulty"
                    checked={difficulty === d}
                    onChange={() => setDifficulty(d)}
                  />
                  <span>{t(`study:difficulty.${d}`)}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="sw-field">
          <label>{t('study:materials.form.summary')}</label>
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={t('study:materials.form.summary')} />
        </div>

        <div className="sw-actions">
          <button className="sw-btn sw-btn-ghost" onClick={onCancel}>{t('study:materials.form.cancel')}</button>
          <button className="sw-btn sw-btn-primary" onClick={submit}>{initial ? t('study:materials.form.save') : t('study:materials.form.add')}</button>
        </div>
      </div>
    </div>
  );
}

interface Sq3rModalProps {
  materialTitle: string;
  content: string;
  onClose: () => void;
  onKeep: (body: string) => void;
  onReread: () => void;
}

function Sq3rModal({ materialTitle, content, onClose, onKeep, onReread }: Sq3rModalProps) {
  const { t } = useTranslation();
  // ponytail: 本地态持有 content——弹窗内可删改后再"保留"，匹配 PRD"写入前主动筛选"诉求；
  // props.content 变化（重新预读替换）时 useEffect 同步。
  const [body, setBody] = useState(content);
  useEffect(() => { setBody(content); }, [content]);
  return (
    <div className="sw-overlay open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sw-modal sw-sq3r-modal" role="dialog" aria-modal="true">
        <h3>{t('study:materials.sq3rModalTitle', { title: materialTitle })}</h3>
        <textarea
          className="sw-sq3r-content"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          autoFocus
        />
        <div className="sw-actions">
          <button className="sw-btn sw-btn-ghost" onClick={onClose}>{t('study:materials.sq3rClose')}</button>
          <button className="sw-btn sw-btn-ghost" onClick={onReread} title={t('study:materials.sq3rRereadTitle')}>{t('study:materials.sq3rReread')}</button>
          <button className="sw-btn sw-btn-primary" onClick={() => onKeep(body)} title={t('study:materials.sq3rKeepTitle')}>{t('study:materials.sq3rKeep')}</button>
        </div>
      </div>
    </div>
  );
}