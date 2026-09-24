/**
 * The extension consent modal — lists declared permissions + design-reality
 * warning. Mounted once at the app root (App.tsx) so the TOFU re-approval
 * prompt can appear no matter which page triggered the install (extensions
 * settings, collectors page, store, URL install).
 */

import { useShallow } from 'zustand/react/shallow';
import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useExtensionStore } from '@/store/extensionStore';

/** The consent modal — lists declared permissions + design-reality warning. */
export function ConsentModal() {
  const { t } = useTranslation();
  const consent = useExtensionStore((s) => s.consent);
  const approve = useExtensionStore((s) => s.approve);
  const closeConsent = useExtensionStore((s) => s.closeConsent);
  const busy = useExtensionStore(useShallow((s) => (consent ? !!s.busy[`${consent.id}:approve`] : false)));

  if (!consent) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
      onClick={closeConsent}
    >
      <div
        className="bg-panel border border-brd rounded-lg p-4 max-w-md w-[90vw] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1 mb-1">
          {t('settings:extensions.consent.title')}
        </div>
        <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t2 mb-3">
          {t('settings:extensions.consent.intro')} <span className="font-semibold text-t1">{consent.name}</span>。
        </div>

        <div className="bg-surf2 border border-brd2 rounded-md p-2.5 mb-3">
          <div className="text-[11px] font-semibold text-t2 mb-1.5">{t('settings:extensions.consent.permissionsLabel')}</div>
          {consent.permissions.length === 0 ? (
            <div className="text-[11px] text-t3">{t('settings:extensions.consent.noPermissions')}</div>
          ) : (
            <ul className="text-[11px] text-t2 space-y-0.5 list-disc list-inside">
              {consent.permissions.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>

        {/* Collector hostAllowlist (design §2.1/§7.3): one-time domain consent.
            Only rendered when non-empty — an empty allowlist shows nothing. */}
        {consent.hostAllowlist.length > 0 && (
          <div className="bg-red-500/5 border border-red-500/30 rounded-md p-2.5 mb-3">
            <div className="text-[11px] font-semibold text-t2 mb-1.5">
              {t('settings:extensions.consent.hostsLabel')}
            </div>
            <ul className="text-[11px] text-t2 space-y-0.5 list-disc list-inside">
              {consent.hostAllowlist.map((h) => (
                <li key={h} className="font-mono">{h}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="bg-amber/10 border border-amber/40 rounded-md p-2.5 mb-3">
          <div className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed flex gap-1.5">
            <TriangleAlert size={13} className="shrink-0 mt-0.5" />
            <span>{t('settings:extensions.consent.warning')}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn btn-g btn-sm" onClick={closeConsent}>
            {t('settings:extensions.consent.cancel')}
          </button>
          <button
            className="btn btn-p btn-sm"
            disabled={busy}
            onClick={() => void approve(consent.id)}
          >
            {busy ? t('settings:extensions.approving') : t('settings:extensions.consent.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
