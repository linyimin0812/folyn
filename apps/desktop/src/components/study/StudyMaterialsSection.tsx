import { useState } from 'react';
import type { StudyMaterial } from '@/study/types';
import { DIFFICULTY_LABEL } from '@/study/types';
import { useEditorStore } from '@/store/editorStore';
import { isTauri } from '@/utils/platform';
import { isAiAvailable, openStudyAiAction, buildStudyPrompt } from '@/study/scheduleLink';

interface Props {
  path: string;
  topicName: string;
  materials: StudyMaterial[];
  /** 新增资料（lineIndex<0 → 追加到段尾）并回写。 */
  onAdd: (m: StudyMaterial) => Promise<void>;
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

/** 难度 → 颜色 token（复用 schedule sw-tag 体系）。 */
const DIFFICULTY_TAG: Record<'easy' | 'medium' | 'hard', string> = {
  easy: 'growth',
  medium: 'ops',
  hard: 'bug',
};

/** 资料区：列出 `## 资料` 段的书目/网络资料，卡片化展示；手动 inline 添加；
 *  AI 动作：学习研究（找资料）、SQ3R 预读（针对某条资料）。 */
export function StudyMaterialsSection({ path, topicName, materials, onAdd }: Props) {
  const [adding, setAdding] = useState<false | 'book' | 'web'>(false);
  const openFile = useEditorStore((s) => s.openFile);
  const aiAvailable = isAiAvailable();

  const openLink = (url?: string) => {
    if (!url) return;
    if (isTauri()) {
      import('@tauri-apps/plugin-shell').then(({ open }) => open(url));
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const runResearch = () => {
    if (!aiAvailable) return;
    openStudyAiAction(topicName, path, buildStudyPrompt('research', { topicName, topicPath: path }));
  };
  const runSq3r = (m: StudyMaterial) => {
    if (!aiAvailable) return;
    openStudyAiAction(topicName, path, buildStudyPrompt('sq3r', {
      topicName,
      topicPath: path,
      materialTitle: m.title,
      materialUrl: m.url,
    }));
  };

  return (
    <section className="sw-study-section">
      <header className="sw-study-sec-head">
        <h3>资料</h3>
        <div className="sw-study-sec-actions">
          <button onClick={() => setAdding('book')} title="手动添加书目">+ 书</button>
          <button onClick={() => setAdding('web')} title="手动添加网页">+ 网页</button>
          <button
            className="ghost"
            disabled={!aiAvailable}
            title={aiAvailable ? 'AI 检索网络资料与经典书籍/论文' : '未配置 AI 适配器'}
            onClick={runResearch}
          >
            AI 找资料
          </button>
          <button className="ghost" onClick={() => openFile(path, path.split('/').pop() ?? path)} title="在编辑器编辑资料段">编辑</button>
        </div>
      </header>

      {adding && (
        <MaterialAddForm
          kind={adding}
          onCancel={() => setAdding(false)}
          onSubmit={async (m) => {
            await onAdd(m);
            setAdding(false);
          }}
        />
      )}

      {materials.length === 0 ? (
        <div className="sw-empty-state">
          <span className="sw-empty-icon">{STACK_ICON}</span>
          <span className="sw-empty-text">还没有资料</span>
          <span className="sw-empty-hint">用 AI 找资料，或手动添加书目/网页</span>
          <button className="sw-empty-cta" disabled={!aiAvailable} onClick={runResearch} title={aiAvailable ? '' : '未配置 AI 适配器'}>
            AI 找资料
          </button>
        </div>
      ) : (
        <ul className="sw-study-list sw-material-grid">
          {materials.map((m) => (
            <li key={m.id} className="sw-card sw-material-card">
              <div className="sw-card-top">
                <span className={`sw-tag ${m.kind === 'book' ? 'dev' : 'ops'}`}>
                  <span className="sw-tag-icon">{m.kind === 'book' ? BOOK_ICON : LINK_ICON}</span>
                  {m.kind === 'book' ? '书' : '网页'}
                </span>
                {m.difficulty && (
                  <span className={`sw-tag ${DIFFICULTY_TAG[m.difficulty]}`} title="难度">
                    {DIFFICULTY_LABEL[m.difficulty]}
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
                <p className="sw-card-meta-line">作者：{m.author}</p>
              )}
              {m.summary && <p className="sw-material-summary">{m.summary}</p>}
              <div className="sw-card-foot">
                <div className="sw-card-meta">
                  {m.url && (
                    <button
                      className="sw-chip sw-link-chip"
                      onClick={() => openLink(m.url)}
                      title="打开链接"
                      aria-label={`打开 ${m.title} 的链接`}
                    >
                      {LINK_ICON}
                      打开
                    </button>
                  )}
                </div>
                <div className="sw-card-actions">
                  <button
                    className="sw-card-action"
                    disabled={!aiAvailable}
                    title={aiAvailable ? '对该资料做 SQ3R 预读（大纲 + 预读问题）' : '未配置 AI 适配器'}
                    onClick={() => runSq3r(m)}
                  >
                    SQ3R 预读
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

interface AddProps {
  kind: 'book' | 'web';
  onCancel: () => void;
  onSubmit: (m: StudyMaterial) => Promise<void>;
}

function MaterialAddForm({ kind, onCancel, onSubmit }: AddProps) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [summary, setSummary] = useState('');
  const [url, setUrl] = useState('');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');

  const submit = async () => {
    const t = title.trim();
    if (!t) return;
    await onSubmit({
      id: `#materials--1`,
      kind,
      title: t,
      author: kind === 'book' ? author.trim() || undefined : undefined,
      summary: summary.trim() || undefined,
      difficulty: kind === 'book' ? difficulty : undefined,
      url: url.trim() || undefined,
      lineIndex: -1,
    });
  };

  return (
    <div className="sw-quick-add sw-study-add-form">
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'book' ? '书名' : '标题'} />
      {kind === 'book' && (
        <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="作者" />
      )}
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="链接 https://" />
      {kind === 'book' && (
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as 'easy' | 'medium' | 'hard')}>
          <option value="easy">易</option>
          <option value="medium">中</option>
          <option value="hard">难</option>
        </select>
      )}
      <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="简介" />
      <button onClick={submit}>添加</button>
      <button className="ghost" onClick={onCancel}>取消</button>
    </div>
  );
}
