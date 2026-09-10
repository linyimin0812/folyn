import { useTranslation } from 'react-i18next';
import { FileQuestion } from 'lucide-react';
import type { PreviewProps } from '../types';

/**
 * Shown when no registered provider (app builtin or installed extension)
 * claims the file's type. Does not read the file content — a binary format
 * would only render as garbled text.
 */
export function UnsupportedFileView({ filePath }: PreviewProps): React.JSX.Element {
  const { t } = useTranslation();
  const name = filePath.split(/[\\/]/).pop() || filePath;
  return (
    <div className="flex-1 h-full flex flex-col items-center justify-center gap-3 px-6 text-center select-none">
      <FileQuestion size={40} className="text-t3 opacity-60" strokeWidth={1.25} />
      <div className="flex flex-col gap-1">
        <div className="text-[14px] font-medium text-t2">
          {t('shell:workArea.unsupported.title')}
        </div>
        <div className="text-[12px] text-t3 max-w-[420px] break-all">
          {t('shell:workArea.unsupported.desc', { name })}
        </div>
      </div>
    </div>
  );
}
