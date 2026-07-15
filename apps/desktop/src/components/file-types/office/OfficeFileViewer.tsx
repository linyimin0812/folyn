import { useEffect, useState } from 'react';
import { readFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import FileViewer from '@file-viewer/react';
import officePreset from '@file-viewer/preset-office';
import { isTauri } from '@/utils/platform';
import { resolveBasePath } from '@/utils/pathResolver';
import type { PreviewProps } from '../types';

export function OfficeFileViewer({ filePath, vaultRoot }: PreviewProps) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!filePath || !vaultRoot) {
      setError('文件路径或 vault 根目录为空');
      setLoading(false);
      return;
    }

    if (!isTauri()) {
      setError('Office 预览仅在桌面端可用');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const base = await resolveBasePath(vaultRoot);
        const abs = await join(base, filePath);
        const bytes = await readFile(abs);
        if (cancelled) return;
        const name = filePath.split('/').pop() || 'file';
        setFile(new File([bytes], name));
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath, vaultRoot]);

  return (
    <div className="h-full w-full overflow-y-auto overflow-x-hidden bg-panel">
      {loading && <div className="flex h-full items-center justify-center text-t3 text-[13px]">加载中…</div>}
      {error && (
        <div className="flex h-full items-center justify-center text-t3 text-[13px] text-red-500">
          无法加载文件：{error}
        </div>
      )}
      {!loading && !error && file && (
        <FileViewer
          file={file}
          options={{
            preset: officePreset,
            messages: {
              'spreadsheet.state.rows': '共 {rows} 行',
              'spreadsheet.state.rowsAndColumns': '共 {rows} 行，{cols} 列',
            },
          }}
          style={{ height: '100%', width: '100%' }}
        />
      )}
    </div>
  );
}
