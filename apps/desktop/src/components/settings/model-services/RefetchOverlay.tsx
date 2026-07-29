import { Loader2, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type RefetchStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok' }
  | { kind: 'err'; message: string };

interface RefetchOverlayProps {
  status: RefetchStatus;
}

export function RefetchOverlay({ status }: RefetchOverlayProps) {
  const { t } = useTranslation();

  if (status.kind === 'idle') return null;

  return (
    // ponytail: containing block = SettingsPage root (added `relative` there).
    // `left-[190px]` skips the left nav (`<nav className="sn w-[190px]">`)
    // so the nav stays interactive while the right panel + right-side
    // blank are grayed. Coupled to nav width — change there too.
    <div className="absolute top-0 right-0 bottom-0 left-[190px] z-[100] flex items-center justify-center bg-black/40 pointer-events-none">
      {status.kind === 'loading' && (
        <Loader2 size={28} className="animate-spin text-t2" />
      )}
      {status.kind === 'ok' && (
        <div className="flex items-center gap-2 text-white text-[14px]">
          <Check size={16} className="text-green-400" />
          <span>{t('settings:models.refetchModelsDevOk')}</span>
        </div>
      )}
      {status.kind === 'err' && (
        <span className="text-red-400 text-[12px] px-4 text-center max-w-[400px]">
          {t('settings:models.refetchModelsDevErr', { message: status.message })}
        </span>
      )}
    </div>
  );
}
