import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StudyMaterial } from '@/features/study/types';
import * as editorIoService from '@/services/editorIoService';
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
  /** 发起 AI 找资料（research 后自动写入 `## 资料`，不再产建议卡片）。 */
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
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
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
  const openFile = editorIoService.openFile;
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
    <section className="sw-study-section">
      <header className="sw-study-sec-head">
        <h3><span className="sw-sec-icon" aria-hidden="true">{SECTION_ICON}</span>{t('study:materials.sectionTitle')}</h3>
        <div className="sw-study-sec-actions">
          <button onClick={() => setAdding('book')} title={t('study:materials.addBookTitle')}>{t('study:materials.addBook')}</button>
          <button onClick={() => setAdding('web')} title={t('study:materials.addWebTitle')}>{t('study:materials.addWeb')}</button>
          <button
            className="primary"
            disabled={!aiAvailable}
            title={aiAvailable ? t('study:materials.researchTitle') : t('study:materials.aiDisabled')}
            onClick={onResearch}
          >
            {t('study:materials.research')}
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
          <button className="ghost" onClick={() => openFile(path, path.split('/').pop() ?? path)} title={t('study:materials.editTitle')}>{t('study:materials.edit')}</button>
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
          <button className="sw-empty-cta" disabled={!aiAvailable} onClick={onResearch} title={aiAvailable ? '' : t('study:materials.aiDisabled')}>
            {t('study:materials.research')}
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
