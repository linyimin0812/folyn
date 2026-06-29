import { useMemo, useState } from 'react';
import type { ParsedStudy } from '@/study/types';
import { useEditorStore } from '@/store/editorStore';
import { useVaultStore } from '@/store/vaultStore';
import { useStudyStore } from '@/store/studyStore';
import { STUDY_DIR, ELABORATION_TEMPLATE, appendToNotesSection } from '@/study/studyDoc';

interface Props {
  slug: string;
  path: string;
  parsed: ParsedStudy;
}

const WIKI_LINK_RE = /\[\[(.+?)\]\]/g;

/** 子文档 vault 路径：`学习/<主题>/<link>.md`（约定，与 studyDoc STUDY_DIR 一致）。 */
const subDocPath = (slug: string, link: string) => `${STUDY_DIR}/${slug}/${link}.md`;

/** 拒绝路径穿越：link 含 `..` 段或以 `/` 开头时视为不安全，避免越出主题子目录。 */
const isSafeLink = (link: string): boolean => {
  if (!link) return false;
  if (link.startsWith('/')) return false;
  return !link.split('/').some((seg) => seg === '..');
};

/** 笔记区：非托管段，提供"在编辑器编辑"入口 + 插入精细加工模板 + 列出子文档 wiki 链接。 */
export function StudyNotesSection({ slug, path, parsed }: Props) {
  const openFile = useEditorStore((s) => s.openFile);
  const refresh = useStudyStore((s) => s.refresh);
  const fileTree = useVaultStore((s) => s.fileTree);
  const [inserting, setInserting] = useState(false);

  // 扫描全文 `[[...]]` 链接（跨段），挑出指向 `学习/<主题>/` 子目录且在 vault 中已存在的子文档。
  const subDocs = useMemo(() => {
    const existing = new Set(fileTree.filter((e) => e.type === 'file').map((e) => e.path));
    const links: string[] = [];
    for (const line of parsed.rawLines) {
      WIKI_LINK_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = WIKI_LINK_RE.exec(line)) !== null) links.push(m[1]);
    }
    // 去重（保留顺序），仅保留安全且已存在的子文档（不自动创建）
    const seen = new Set<string>();
    return links.filter((l) => {
      if (!isSafeLink(l) || seen.has(l)) return false;
      seen.add(l);
      return existing.has(subDocPath(slug, l));
    });
  }, [parsed.rawLines, fileTree, slug]);

  const insertTemplate = async () => {
    setInserting(true);
    try {
      const vault = useVaultStore.getState();
      const content = await vault.readFile(path);
      const next = appendToNotesSection(content, ELABORATION_TEMPLATE);
      await vault.writeFile(path, next);
      await refresh();
    } finally {
      setInserting(false);
    }
  };

  // 笔记段摘要预览（取 `## 笔记` 段的前几行原文，渲染纯文本）
  const notesPreview = useMemo(() => {
    const lines = parsed.rawLines;
    let start = -1;
    let end = lines.length;
    for (let i = 0; i < lines.length; i++) {
      if (/^##\s+笔记\s*$/.test(lines[i])) {
        start = i + 1;
        for (let j = i + 1; j < lines.length; j++) {
          if (/^##\s+/.test(lines[j])) { end = j; break; }
        }
        break;
      }
    }
    if (start < 0) return [];
    return lines.slice(start, end).filter((l) => l.trim() !== '').slice(0, 6);
  }, [parsed.rawLines]);

  return (
    <section className="sw-study-section">
      <header className="sw-study-sec-head">
        <h3>笔记</h3>
        <div className="sw-study-sec-actions">
          <button onClick={insertTemplate} disabled={inserting} title="在笔记段尾追加精细加工模板行">
            {inserting ? '插入中…' : '+ 精细加工模板'}
          </button>
          <button className="ghost" onClick={() => openFile(path, path.split('/').pop() ?? path)} title="在编辑器自由编辑笔记段">
            在编辑器中编辑
          </button>
        </div>
      </header>

      {notesPreview.length === 0 ? (
        <p className="sw-empty-hint">笔记段为空。点"在编辑器中编辑"自由书写，或插入精细加工模板。</p>
      ) : (
        <pre className="sw-study-notes-preview">{notesPreview.join('\n')}{notesPreview.length >= 6 ? '\n…' : ''}</pre>
      )}

      <div className="sw-study-subdocs">
        <p className="sw-section-label">知识库 · 子文档（[[wiki]] 链接）</p>
        {subDocs.length === 0 ? (
          <p className="sw-empty-hint">暂无挂接的子文档。在笔记里用 `[[子文档名]]` 链接原子笔记。</p>
        ) : (
          <ul className="sw-study-list">
            {subDocs.map((link) => {
              const p = subDocPath(slug, link);
              return (
                <li key={link} className="sw-study-item sw-subdoc">
                  <span className="sw-tag growth">笔记</span>
                  <button className="sw-study-item-title link" onClick={() => openFile(p, `${link}.md`)}>
                    [[{link}]]
                  </button>
                  <span className="sw-study-item-meta">{p}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
