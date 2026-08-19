import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StudyMaterial } from '@/features/study/types';
import { useStudyStore } from '@/store/studyStore';
import { isTauri } from '@/utils/platform';
import { isAiAvailable, openStudyAiAction, buildStudyInstruction } from '@/features/study/scheduleLink';

interface Props {
  slug: string;
  path: string;
  topicName: string;
  materials: StudyMaterial[];
  /** 新增资料（lineIndex<0 → 追加到段尾）并回写。 */
  onAdd: (m: StudyMaterial) => Promise<void>;
  /** 编辑资料（保持 lineIndex，原地重写）并回写。 */
  onEdit: (m: StudyMaterial) => Promise<void>;
  /** 删除资料（按 id 过滤后回写，托管行移除）。 */
  onDelete: (id: string) => Promise<void>;
  /** 发起 AI 找资料：先让 AI 根据主题生成澄清问题（grill 式），回答后执行 research 并自动写入 `## 资料`。 */
  onResearch: () => void;
  /** 用选中的资料生成学习计划（plan 建议）。 */
  onGeneratePlanFromSelected: (selected: StudyMaterial[]) => void;
}

/** 书籍图标。 */
const BOOK_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);
/** 链接图标。 */
const LINK_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.07 0l1.42-1.42a5 5 0 0 0-7.07-7.07L10 5" />
    <path d="M14 11a5 5 0 0 0-7.07 0L5.51 12.42a5 5 0 0 0 7.07 7.07L10 19" />
  </svg>
);
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
  topicName,
  materials,
  onAdd,
  onEdit,
  onDelete,
  onResearch,
  onGeneratePlanFromSelected,
}: Props) {
  const [adding, setAdding] = useState<false | 'book' | 'web'>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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

  const openLink = (url?: string) => {
    if (!url) return;
    if (isTauri()) {
      import('@tauri-apps/plugin-shell').then(({ open }) => open(url));
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const runSq3r = (m: StudyMaterial) => {
    if (!aiAvailable) return;
    openStudyAiAction(path, buildStudyInstruction('sq3r', {
      topicName,
      topicPath: path,
      materialTitle: m.title,
      materialUrl: m.url,
    }));
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const generatePlan = () => {
    const selected = materials.filter((m) => selectedIds.has(m.id));
    if (!selected.length) return;
    onGeneratePlanFromSelected(selected);
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
          <button onClick={() => setAdding('book')} title={t('study:materials.addBookTitle')}>{t('study:materials.addBook')}</button>
          <button onClick={() => setAdding('web')} title={t('study:materials.addWebTitle')}>{t('study:materials.addWeb')}</button>
          <button
            className="primary"
            disabled={!aiAvailable}
            disabled={!aiAvailable || clarifying || researching}
            title={aiAvailable ? t('study:materials.researchTitle') : t('study:materials.aiDisabled')}
            onClick={onResearch}
          >
            {researching ? (
              <><span className="sw-study-spinner" aria-hidden="true" />{t('study:materials.researchRunning')}</>
            ) : clarifying ? t('study:materials.researchClarifying') : t('study:materials.research')}
          </button>
          {selectedIds.size > 0 && (
            <button
              className="ghost"
              disabled={!aiAvailable}
              title={aiAvailable ? t('study:materials.planFromSelectedTitle', { count: selectedIds.size }) : t('study:materials.aiDisabled')}
              onClick={generatePlan}
            >
              {t('study:materials.planFromSelected', { count: selectedIds.size })}
            </button>
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
            <li key={m.id} className={`sw-card sw-material-card${selectedIds.has(m.id) ? ' selected' : ''}`}>
              <div className="sw-card-top">
                <label className="sw-card-select" title={t('study:materials.select')}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(m.id)}
                    onChange={() => toggleSelect(m.id)}
                  />
                </label>
                <span className={`sw-tag ${m.kind === 'book' ? 'dev' : 'ops'}`}>
                  <span className="sw-tag-icon">{m.kind === 'book' ? BOOK_ICON : LINK_ICON}</span>
                  {m.kind === 'book' ? t('study:materials.kindBook') : t('study:materials.kindWeb')}
                </span>
                {m.difficulty && (
                  <span className={`sw-tag ${DIFFICULTY_TAG[m.difficulty]}`} title={t('study:materials.difficulty')}>
                    {t(`study:difficulty.${m.difficulty}`)}
                  </span>
                )}
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
              <div className="sw-card-foot">
                <div className="sw-card-meta">
                  {m.url && (
                    <button
                      className="sw-chip sw-link-chip"
                      onClick={() => openLink(m.url)}
                      title={t('study:materials.openLink')}
                      aria-label={t('study:materials.openLinkAria', { title: m.title })}
                    >
                      {LINK_ICON}
                      {t('study:materials.openLink')}
                    </button>
                  )}
                </div>
                <div className="sw-card-actions">
                  <button className="sw-card-action" onClick={() => setEditingId(m.id)} title={t('study:materials.editMaterial')}>{t('study:materials.edit')}</button>
                  <button className="sw-card-action" onClick={() => onDelete(m.id)} title={t('study:materials.deleteMaterial')}>{t('study:materials.deleteMaterial')}</button>
                  <button
                    className="sw-card-action"
                    disabled={!aiAvailable}
                    title={aiAvailable ? t('study:materials.sq3rTitle') : t('study:materials.aiDisabled')}
                    onClick={() => runSq3r(m)}
                  >
                    {t('study:materials.sq3r')}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
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
    <div className="sw-quick-add sw-study-add-form">
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'book' ? t('study:materials.form.titleBook') : t('study:materials.form.titleWeb')} />
      {kind === 'book' && (
        <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder={t('study:materials.form.author')} />
      )}
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('study:materials.form.url')} />
      {kind === 'book' && (
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as 'easy' | 'medium' | 'hard')}>
          <option value="easy">{t('study:materials.form.difficultyEasy')}</option>
          <option value="medium">{t('study:materials.form.difficultyMedium')}</option>
          <option value="hard">{t('study:materials.form.difficultyHard')}</option>
        </select>
      )}
      <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={t('study:materials.form.summary')} />
      <button onClick={submit}>{initial ? t('study:materials.form.save') : t('study:materials.form.add')}</button>
      <button className="ghost" onClick={onCancel}>{t('study:materials.form.cancel')}</button>
    </div>
  );
}