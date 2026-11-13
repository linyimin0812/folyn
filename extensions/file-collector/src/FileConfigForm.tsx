/**
 * Settings form of the file collector: which files and folders to leave out
 * (`config.excludePatterns`), as editable chips. Every edit is saved at once.
 *
 * The list starts as a copy of the user's file-panel filters and is the
 * collector's own from then on: later edits on either side do not reach the
 * other.
 */
import { useEffect, useState } from 'react';
import type { CollectorConfigFormProps } from 'folyn-extension-sdk';
import { addPattern, parsePatterns, removePattern } from './excludePatterns';

const STRINGS = {
  zh: {
    label: '过滤文件/文件夹：',
    add: '添加',
    prompt: '输入过滤规则（支持 * 和 ? 通配符）',
    empty: '暂无过滤规则',
  },
  en: {
    label: 'Filter files/folders:',
    add: 'Add',
    prompt: 'Enter a filter pattern (supports * and ? wildcards)',
    empty: 'No filter rules',
  },
  ja: {
    label: 'ファイル/フォルダを除外：',
    add: '追加',
    prompt: 'フィルタパターンを入力（*と?のワイルドカードをサポート）',
    empty: 'フィルタルールなし',
  },
  fr: {
    label: 'Filtrer fichiers/dossiers :',
    add: 'Ajouter',
    prompt: 'Saisir un motif de filtre (prend en charge * et ?)',
    empty: 'Aucune règle de filtre',
  },
  de: {
    label: 'Dateien/Ordner filtern:',
    add: 'Hinzufügen',
    prompt: 'Filtermuster eingeben (unterstützt * und ?)',
    empty: 'Keine Filterregeln',
  },
  es: {
    label: 'Filtrar archivos/carpetas:',
    add: 'Añadir',
    prompt: 'Introduce un patrón (soporta * y ?)',
    empty: 'Sin reglas de filtro',
  },
};

export function FileConfigForm({ config, update, api }: CollectorConfigFormProps) {
  const t = STRINGS[api.env.locale as keyof typeof STRINGS] ?? STRINGS.en;
  const patterns = parsePatterns(config.excludePatterns);
  // Inline「+ 添加」input, open while the user types a new pattern.
  const [input, setInput] = useState<string | null>(null);

  // One-time seed from the file-panel filters. Written even when empty, so the
  // key is defined and never seeded again.
  useEffect(() => {
    if (config.excludePatterns !== undefined) return;
    update({ excludePatterns: api.vaultConfig.getExcludePatterns().join('\n') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = () => {
    const value = (input ?? '').trim();
    if (value) update({ excludePatterns: addPattern(config.excludePatterns, value) });
    setInput(null);
  };

  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-2">
      <span className="text-[10px] text-t3">{t.label}</span>
      {input !== null ? (
        <input
          autoFocus
          className="py-[5px] px-2.5 rounded-md text-[11px] font-ui border border-acc bg-inp text-t1 outline-none w-[180px]"
          placeholder={t.prompt}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // IME composition: Enter here commits the composition, not the add.
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') setInput(null);
          }}
          onBlur={commit}
        />
      ) : (
        <button
          className="inline-flex items-center gap-1 h-[26px] px-2.5 rounded-md text-[11px] font-ui cursor-pointer border border-dashed border-brd2 text-t3 hover:border-acc hover:text-acc transition-all duration-100 bg-transparent"
          onClick={() => setInput('')}
        >
          + {t.add}
        </button>
      )}
      {patterns.length === 0 && input === null && (
        <span className="text-[11px] text-t3 italic">{t.empty}</span>
      )}
      {patterns.map((p) => (
        <span key={p} className="inline-flex items-center gap-1 h-[26px] pl-2.5 pr-1 rounded-md text-[11px] font-ui bg-accdim text-t1 border border-brd2">
          <span className="font-mono leading-none">{p}</span>
          <button
            className="w-[18px] h-[18px] flex items-center justify-center rounded text-t3 hover:text-[#f06a6a] hover:bg-hov transition-colors leading-none"
            onClick={() => update({ excludePatterns: removePattern(config.excludePatterns, p) })}
            aria-label={`× ${p}`}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
