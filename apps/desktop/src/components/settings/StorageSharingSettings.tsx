/**
 * 存储与分享 settings tab. Lists every registered storage provider
 * (built-in R2/Qiniu/OSS + trusted-extension-contributed providers) and
 * renders the active provider's own config form — each provider brings its
 * form via the registry, so built-ins and extensions are the same kind of
 * thing.
 */
import { useTranslation } from 'react-i18next';
import { CloudCog } from 'lucide-react';
import { useStorageConfigStore } from '@/services/storage/storageConfigStore';
import { getAllProviders } from '@/services/storage/registry';
import { StorageProviderIcon } from '@/components/icons/StorageProviderIcon';
import { IconSelect } from '@/components/common/IconSelect';


export function StorageSharingSettings() {
  const { t } = useTranslation();
  const providers = getAllProviders();
  const activeProvider = useStorageConfigStore((s) => s.activeProvider);
  const setActiveProvider = useStorageConfigStore((s) => s.setActiveProvider);
  const configs = useStorageConfigStore((s) => s.configs);
  const saveProviderConfig = useStorageConfigStore((s) => s.saveProviderConfig);
  const removeProviderConfig = useStorageConfigStore((s) => s.removeProviderConfig);

  const activeEntry = providers.find((p) => p.id === activeProvider) ?? providers[0];
  const activeCfg = activeEntry ? (configs[activeEntry.id] ?? activeEntry.defaultConfig) : null;
  const Form = activeEntry?.configForm;

  return (
    <div className="mb-8">
      <div className="pb-3 mb-5 border-b border-brd2 flex items-baseline gap-2">
        <CloudCog size={20} className="text-acc" />
        <div className="text-[length:calc(var(--ui-font-size)+3px)] font-bold text-t1 tracking-[-0.01em]">{t('settings:storage.title')}</div>
        <div className="text-[length:calc(var(--ui-font-size)-1px)] text-t3">{t('settings:storage.description')}</div>
      </div>

      {/* Provider selector */}
      <div className="mb-5">
        <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">{t('settings:storage.provider.label')}</div>
        <IconSelect
          value={activeEntry?.id ?? ''}
          onChange={setActiveProvider}
          options={providers.map((p) => {
            const cfg = configs[p.id] ?? p.defaultConfig;
            const configured = p.isConfigured(cfg);
            const suffix = configured ? '' : ` (${t('settings:storage.provider.notConfigured')})`;
            return {
              value: p.id,
              label: t(p.labelKey),
              icon: <StorageProviderIcon icon={p.icon} />,
              suffix,
            };
          })}
        />
      </div>

      {/* Active provider form (each provider ships its own) */}
      {Form && activeEntry && (
        <Form
          config={activeCfg}
          onSave={(cfg) => saveProviderConfig(activeEntry.id, cfg)}
          onRemove={() => removeProviderConfig(activeEntry.id)}
        />
      )}
    </div>
  );
}
