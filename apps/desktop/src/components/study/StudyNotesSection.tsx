import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ParsedStudy } from '@/features/study/types';
import * as editorIoService from '@/services/editorIoService';
import { useVaultStore } from '@/store/vaultStore';
import { useStudyStore } from '@/store/studyStore';
import { STUDY_DIR, ELABORATION_TEMPLATE, appendToNotesSection } from '@/features/study/studyDoc';
import { isAiAvailable, openStudyAiAction, buildStudyInstruction } from '@/features/study/scheduleLink';
import { MarkdownPreview } from '@/components/file-types/markdown/MarkdownPreview';

interface Props {
  slug: string;
  path: string;
  topicName: string;
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

/** 从 `## 笔记` 段提取正文 markdown（不含该 heading 自身）。 */
function extractNotesSection(rawLines: string[]): string {
  let start = -1;
  let end = rawLines.length;
  for (let i = 0; i < rawLines.length; i++) {
    if (/^##\s+笔记\s*$/.test(rawLines[i])) {
      start = i + 1;
      for (let j = i + 1; j < rawLines.length; j++) {
        if (/^##\s+/.test(rawLines[j])) { end = j; break; }
      }
      break;
    }
  }
  if (start < 0) return '';
  return rawLines.slice(start, end).join('\n').trim();
}

/** 笔记图标。 */
const NOTE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
  </svg>
);
/** 子文档图标。 */
const DOC_LINK_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 3h6l5 5v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path d="M14 3v5h5" />
  </svg>
);
/** 区段标题图标。 */
const SECTION_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
  </svg>
);

/** 笔记区：非托管段，复用项目 MarkdownPreview 渲染（含 callout）；"在编辑器编辑" +
 *  插入精细加工模板置顶；列出子文档 wiki 链接（可点击 chips）；
 *  AI 动作：费曼挑战（扮演 5 岁小孩追问，暴露盲区写入 :::callout{type="warning"}）。 */
export function StudyNotesSection({ slug, path, topicName, parsed }: Props) {
  const { t } = useTranslation();
  const openFile = editorIoService.openFile;
  const refresh = useStudyStore((s) => s.refresh);
  const fileTree = useVaultStore((s) => s.fileTree);
  const vaultRoot = useVaultStore((s) => s.currentVault?.basePath ?? '');
  const [inserting, setInserting] = useState(false);
  const aiAvailable = isAiAvailable();

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

  /** `## 笔记` 段的正文 markdown（复用项目 MarkdownPreview 渲染 callout）。 */
  const notesBody = useMemo(() => extractNotesSection(parsed.rawLines), [parsed.rawLines]);

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

  return (
    <section className="sw-study-section">
      <header className="sw-study-sec-head">
        <h3><span className="sw-sec-icon" aria-hidden="true">{SECTION_ICON}</span>{t('study:notes.sectionTitle')}</h3>
        <div className="sw-study-sec-actions">
          <button onClick={insertTemplate} disabled={inserting} title={t('study:notes.insertTitle')}>
            {inserting ? t('study:notes.inserting') : t('study:notes.insertTemplate')}
          </button>
          <button
            className="primary"
            disabled={!aiAvailable}
            title={aiAvailable ? t('study:notes.feynmanTitle') : t('study:materials.aiDisabled')}
            onClick={() => openStudyAiAction(path, buildStudyInstruction('feynman', { topicName, topicPath: path }))}
          >
            {t('study:notes.feynman')}
          </button>
          <button className="ghost" onClick={() => openFile(path, path.split('/').pop() ?? path)} title={t('study:notes.editInEditorTitle')}>
            {t('study:notes.editInEditor')}
          </button>
        </div>
      </header>

      {notesBody.trim() === '' ? (
        <div className="sw-empty-state">
          <span className="sw-empty-icon">{NOTE_ICON}</span>
          <span className="sw-empty-text">{t('study:notes.empty')}</span>
          <span className="sw-empty-hint">{t('study:notes.emptyHint')}</span>
        </div>
      ) : (
        <div className="sw-study-notes-render md-preview">
          <MarkdownPreview content={notesBody} filePath={path} vaultRoot={vaultRoot} />
        </div>
      )}

      <div className="sw-study-subdocs">
        <p className="sw-section-label">
          {t('study:notes.subwiki')}
          <span className="sw-section-count">{subDocs.length}</span>
        </p>
        {subDocs.length === 0 ? (
          <p className="sw-empty-hint">{t('study:notes.subwikiEmpty')}</p>
        ) : (
          <div className="sw-subdoc-chips">
            {subDocs.map((link) => {
              const p = subDocPath(slug, link);
              return (
                <button
                  key={link}
                  className="sw-chip sw-subdoc-chip"
                  onClick={() => openFile(p, `${link}.md`)}
                  title={p}
                >
                  {DOC_LINK_ICON}
                  [[{link}]]
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
