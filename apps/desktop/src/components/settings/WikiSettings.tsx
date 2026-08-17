import { useTranslation } from 'react-i18next';
import { useWikiSettingsStore } from '@/store/wikiSettingsStore';
import { Toggle } from './primitives';

export function WikiSettings() {
  const { t } = useTranslation();
  const autoAfterIngest = useWikiSettingsStore((s) => s.autoAfterIngest);
  const semanticManualOnly = useWikiSettingsStore((s) => s.semanticManualOnly);
  const archiveRetentionDays = useWikiSettingsStore((s) => s.archiveRetentionDays);
  const queryCacheTtlMinutes = useWikiSettingsStore((s) => s.queryCacheTtlMinutes);
  const setAutoAfterIngest = useWikiSettingsStore((s) => s.setAutoAfterIngest);
  const setSemanticManualOnly = useWikiSettingsStore((s) => s.setSemanticManualOnly);
  const setArchiveRetentionDays = useWikiSettingsStore((s) => s.setArchiveRetentionDays);
  const setQueryCacheTtlMinutes = useWikiSettingsStore((s) => s.setQueryCacheTtlMinutes);

  return (
    <div className="mb-8">
      <div className="pb-3 mb-5 border-b border-brd2 flex items-baseline gap-2">
        <div className="text-[length:calc(var(--ui-font-size)+3px)] font-bold text-t1 tracking-[-0.01em]">{t('settings:wiki.title')}</div>
        <div className="text-[length:calc(var(--ui-font-size)-1px)] text-t3">{t('settings:wiki.description')}</div>
      </div>

      <div className="tr flex items-center justify-between py-3.5 border-b border-brd">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:wiki.autoAfterIngest.label')}</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:wiki.autoAfterIngest.description')}</p>
        </div>
        <Toggle value={autoAfterIngest} onChange={setAutoAfterIngest} />
      </div>

      <div className="tr flex items-center justify-between py-3.5 border-b border-brd">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:wiki.semanticManualOnly.label')}</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:wiki.semanticManualOnly.description')}</p>
        </div>
        <Toggle value={semanticManualOnly} onChange={setSemanticManualOnly} />
      </div>

      <div className="tr flex items-center justify-between py-3.5 border-b border-brd">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:wiki.archiveRetentionDays.label')}</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:wiki.archiveRetentionDays.description')}</p>
        </div>
        <input
          type="number"
          min={1}
          className="settings-select"
          style={{ maxWidth: 100 }}
          value={archiveRetentionDays}
          onChange={(e) => setArchiveRetentionDays(parseInt(e.target.value, 10) || 30)}
        />
      </div>

      <div className="tr flex items-center justify-between py-3.5 border-b border-brd">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:wiki.queryCacheTtlMinutes.label')}</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:wiki.queryCacheTtlMinutes.description')}</p>
        </div>
        <input
          type="number"
          min={0}
          className="settings-select"
          style={{ maxWidth: 100 }}
          value={queryCacheTtlMinutes}
          onChange={(e) => setQueryCacheTtlMinutes(parseInt(e.target.value, 10) || 0)}
        />
      </div>

      <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 mt-3 italic">
        {t('settings:wiki.noHotReload')}
      </p>
    </div>
  );
}
