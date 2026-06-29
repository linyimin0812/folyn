import { useState } from 'react';
import type { StudyMaterial } from '@/study/types';
import { DIFFICULTY_LABEL } from '@/study/types';
import { useEditorStore } from '@/store/editorStore';
import { isTauri } from '@/utils/platform';

interface Props {
  path: string;
  materials: StudyMaterial[];
  /** 新增资料（lineIndex<0 → 追加到段尾）并回写。 */
  onAdd: (m: StudyMaterial) => Promise<void>;
}

/** 资料区：列出 `## 资料` 段的书目/网络资料，链接可点；手动 inline 添加。 */
export function StudyMaterialsSection({ path, materials, onAdd }: Props) {
  const [adding, setAdding] = useState<false | 'book' | 'web'>(false);
  const openFile = useEditorStore((s) => s.openFile);

  const openLink = (url?: string) => {
    if (!url) return;
    if (isTauri()) {
      import('@tauri-apps/plugin-shell').then(({ open }) => open(url));
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <section className="sw-study-section">
      <header className="sw-study-sec-head">
        <h3>资料</h3>
        <div className="sw-study-sec-actions">
          <button onClick={() => setAdding('book')}>+ 书</button>
          <button onClick={() => setAdding('web')}>+ 网页</button>
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
        <p className="sw-empty-hint">暂无资料。可手动添加，或等待 PR4 的 AI 学习研究填充。</p>
      ) : (
        <ul className="sw-study-list">
          {materials.map((m) => (
            <li key={m.id} className="sw-study-item sw-material">
              <span className={`sw-tag ${m.kind === 'book' ? 'dev' : 'growth'}`}>
                {m.kind === 'book' ? '书' : '网'}
              </span>
              <div className="sw-study-item-body">
                <div className="sw-study-item-title">
                  {m.url ? (
                    <a href={m.url} onClick={(e) => { e.preventDefault(); openLink(m.url); }}>{m.title}</a>
                  ) : (
                    <span>{m.title}</span>
                  )}
                </div>
                {m.kind === 'book' && m.author && (
                  <div className="sw-study-item-meta">作者：{m.author}{m.difficulty ? ` · 难度：${DIFFICULTY_LABEL[m.difficulty]}` : ''}</div>
                )}
                {m.summary && <p className="sw-study-item-summary">{m.summary}</p>}
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
