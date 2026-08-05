import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocaleStore, SUPPORTED_LOCALES, type Locale } from '@/store/localeStore';
import languageIcon from '@/assets/language.svg';

interface LanguageSwitcherProps {
  /** "compact" renders a single icon button with a dropdown (Topbar);
   *  "row" renders a labeled settings row. */
  variant?: 'compact' | 'row';
}

const LOCALE_LABELS: Record<Locale, string> = {
  zh: '中文',
  en: 'English',
};

/**
 * Topbar language switcher — compact dropdown. Renders a globe icon button
 * that opens a menu of supported locales. Mirrors the ExportMenu pattern
 * (click-outside to close). State is shared with the Settings row via
 * useLocaleStore.
 */
export function LanguageSwitcher({ variant = 'compact' }: LanguageSwitcherProps) {
  const { t } = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  if (variant === 'row') {
    return (
      <div className="tr flex items-center justify-between py-3.5 border-b border-brd">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">
            {t('language.switcher.title')}
          </h4>
        </div>
        <div className="flex items-center gap-1.5">
          {SUPPORTED_LOCALES.map((lg) => (
            <button
              key={lg}
              type="button"
              className={`lang-btn px-2 py-1 rounded text-[length:calc(var(--ui-font-size)-3px)] transition-all duration-150 ${
                locale === lg ? 'bg-accdim text-acc font-semibold' : 'text-t3 hover:bg-hov hover:text-t1'
              }`}
              onClick={() => setLocale(lg)}
            >
              {LOCALE_LABELS[lg]}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="lang-switcher relative shrink-0">
      <button
        type="button"
        className="tb-btn w-[30px] h-[30px] flex items-center justify-center rounded-[5px] text-sm text-t3 transition-all duration-150 hover:bg-hov hover:text-t1"
        onClick={() => setOpen((v) => !v)}
        title={t('language.switcher.title')}
        aria-label={t('language.switcher.aria')}
      >
        <img src={languageIcon} alt="" width="14" height="14" />
      </button>
      {open && (
        <div
          className="lang-menu absolute right-0 top-[34px] bg-panel border border-brd rounded-[6px] shadow-md py-1 min-w-[140px] z-50"
          role="menu"
        >
          {SUPPORTED_LOCALES.map((lg) => (
            <button
              key={lg}
              type="button"
              role="menuitemradio"
              aria-checked={locale === lg}
              className={`w-full text-left px-3 py-1.5 text-[length:calc(var(--ui-font-size)-2px)] transition-colors ${
                locale === lg ? 'text-acc bg-accdim font-semibold' : 'text-t2 hover:bg-hov hover:text-t1'
              }`}
              onClick={() => {
                setLocale(lg);
                setOpen(false);
              }}
            >
              {LOCALE_LABELS[lg]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
