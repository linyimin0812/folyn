import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useDocLinkHistory } from '@/store/docLinkHistory';
import { useVaultStore } from '@/store/vaultStore';

/**
 * Back/forward along followed document links, floated at the top-left of the
 * reading surface instead of the app toolbar — it belongs to the page being
 * read, not to the window chrome. Only rendered once a link has been followed;
 * a trail left in another vault doesn't count (the store clears it on next use).
 */
export function DocLinkNav(): React.JSX.Element | null {
  const { t } = useTranslation();
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const showBack = useDocLinkHistory((s) => s.vaultId === activeVaultId && s.back.length > 0);
  const showForward = useDocLinkHistory((s) => s.vaultId === activeVaultId && s.forward.length > 0);
  if (!showBack && !showForward) return null;

  const btn = 'w-6 h-6 flex items-center justify-center rounded-[5px] text-t3 cursor-pointer transition-[color,background-color,opacity] duration-[140ms] enabled:hover:bg-hov enabled:hover:text-t1 disabled:opacity-30 disabled:cursor-default';

  return (
    <div className="doc-link-nav absolute left-2 top-2 z-30 flex items-center gap-0.5 p-0.5 rounded-[7px] border border-brd bg-panel shadow-[0_2px_8px_rgba(0,0,0,.10)] opacity-55 transition-opacity duration-[140ms] hover:opacity-100">
      <button
        className={btn}
        disabled={!showBack}
        onClick={() => useDocLinkHistory.getState().goBack()}
        title={t('shell:docLink.back')}
        aria-label={t('shell:docLink.back')}
      >
        <ArrowLeft size={13} />
      </button>
      <button
        className={btn}
        disabled={!showForward}
        onClick={() => useDocLinkHistory.getState().goForward()}
        title={t('shell:docLink.forward')}
        aria-label={t('shell:docLink.forward')}
      >
        <ArrowRight size={13} />
      </button>
    </div>
  );
}
