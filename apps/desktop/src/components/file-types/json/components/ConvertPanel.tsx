/**
 * ConvertPanel — toolbar + output area for the JSON viewer's Convert tab.
 *
 * Layout:
 *   [Output formats: YAML | XML | Base64 | Escaped]
 *   [Excel: Single-header | Multi-header]
 *   [Languages: Python | Go | Rust | Java | PHP | C#]
 *   ─────────────────────────────────────────────
 *   <pre>{output or placeholder}</pre>  [Copy]
 *
 * For Excel converters, the panel triggers a Tauri file save dialog
 * (`@tauri-apps/plugin-dialog` `save`) and writes the Blob via
 * `@tauri-apps/plugin-fs` `writeFile`. String outputs are surfaced to the
 * parent via `onOutput` so the auto-copy toggle (PR8) can copy them.
 */
import { useCallback, useState } from 'react';
import {
  listConverters,
  runConverter,
  type ConverterDef,
  type ConverterGroup,
} from '../lib/converters';

export interface ConvertPanelProps {
  value: unknown;
  onOutput: (text: string, mime?: string) => void;
  onCopyValue: (value: string) => void;
}

const GROUP_LABELS: Record<ConverterGroup, string> = {
  output: '输出格式',
  excel: 'Excel',
  language: '语言',
};

export function ConvertPanel({ value, onOutput, onCopyValue }: ConvertPanelProps) {
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const converters = listConverters();

  const handleRun = useCallback(
    async (def: ConverterDef) => {
      setLoading(true);
      setError(null);
      try {
        const result = await runConverter(def.id, value);
        if (result.blob && result.filename) {
          await downloadBlob(result.blob, result.filename);
          setOutput(`已保存: ${result.filename}`);
        } else {
          setOutput(result.output);
          onOutput(result.output, result.mime);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setOutput(null);
      } finally {
        setLoading(false);
      }
    },
    [value, onOutput],
  );

  const handleCopy = useCallback(() => {
    if (output === null) return;
    onCopyValue(output);
  }, [output, onCopyValue]);

  const groups: ConverterGroup[] = ['output', 'excel', 'language'];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-1 border-b border-brd bg-surf px-2 py-1.5">
        {groups.map((g) => (
          <div key={g} className="flex items-center gap-1">
            <span className="w-16 shrink-0 text-[11px] text-t3">{GROUP_LABELS[g]}</span>
            <div className="flex flex-wrap items-center gap-1">
              {converters
                .filter((c) => c.group === g)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={loading}
                    onClick={() => handleRun(c)}
                    className={`rounded border px-2 py-0.5 text-[11px] ${
                      loading
                        ? 'border-brd bg-surf text-t3 opacity-60'
                        : 'border-brd bg-panel text-t2 hover:bg-hov hover:text-t1'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
      {error !== null && (
        <div className="shrink-0 border-b border-rose-200 bg-rose-50 px-3 py-1 text-[11px] text-rose-700 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-300">
          <span className="font-medium">错误: </span>
          <span className="break-all font-mono">{error}</span>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-brd bg-panel px-2 py-0.5">
          <span className="text-[11px] text-t3">输出</span>
          <button
            type="button"
            disabled={output === null}
            onClick={handleCopy}
            className={`rounded px-2 py-0.5 text-[11px] ${
              output === null
                ? 'text-t3 opacity-50'
                : 'text-t2 hover:bg-hov hover:text-t1'
            }`}
          >
            复制
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto bg-panel px-2 py-1 font-mono text-[12px] leading-[1.5] text-t1 whitespace-pre-wrap break-all">
          {output ?? '点击上方按钮生成输出'}
        </pre>
      </div>
    </div>
  );
}

async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  try {
    const dialog = await import('@tauri-apps/plugin-dialog');
    const fs = await import('@tauri-apps/plugin-fs');
    const target = await dialog.save({
      defaultPath: filename,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (!target) return;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await fs.writeFile(target, bytes);
  } catch (err) {
    // Re-throw with a clearer message if the Tauri environment is missing.
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`保存文件失败: ${msg}`);
  }
}
