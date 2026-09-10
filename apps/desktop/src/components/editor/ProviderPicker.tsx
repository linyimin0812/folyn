/**
 * Shared storage-provider picker for export/share dialogs.
 *
 * Used by SourceExportDialog, FormatExportDialog, SingleDocExportDialog, and
 * VaultExportDialog — extracts the duplicated providerPicker + goToSettings +
 * configuredProviders logic into one reusable component so all export dialogs
 * share the same UI, i18n keys, and error handling.
 */
import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import { useStorageConfigStore } from '@/services/storage/storageConfigStore';
import { getAllProviders } from '@/services/storage/registry';
import { IconSelect } from '@/components/common/IconSelect';
import { useNavStore } from '@/store/navStore';

/**
 * Shared width for every export/share dialog (Source / Format / SingleDoc /
 * Vault). Overrides the base `.dlg` width so all export dialogs render at the
 * same size regardless of content.
 */
export const EXPORT_DIALOG_STYLE = { width: 440, maxWidth: '92vw' } as const;

interface ProviderPickerProps {
  /** Currently selected provider id, or null. */
  value: string | null;
  /** Called when the user picks a provider. */
  onChange: (id: string) => void;
  /** Whether this picker is active (greyed out when false, e.g. output=download). */
  enabled: boolean;
  /** Whether the provider is required but not yet selected (shows red outline). */
  missing: boolean;
  /** Whether to show the "required" error (controlled by parent's submit attempt). */
  showRequired: boolean;
  /** Called when the user clicks "go to settings". */
  onGoToSettings: () => void;
}

export function ProviderPicker({
  value, onChange, enabled, missing, showRequired, onGoToSettings,
}: ProviderPickerProps): React.JSX.Element {
  const { t } = useTranslation();
  const configs = useStorageConfigStore((s) => s.configs);
  const providers = getAllProviders();
  const configuredProviders = providers.filter((p) =>
    configs[p.id] ? p.isConfigured(configs[p.id]!) : false);

  if (configuredProviders.length === 0) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-[5px] border border-brd2 bg-surf">
        <span className="text-[11px] text-t3 flex-1">{t('editor:export.provider.notConfigured')}</span>
        <button className="btn btn-g btn-sm shrink-0" onClick={onGoToSettings}>
          <Settings size={13} className="inline mr-1 -mt-px" />
          {t('editor:export.provider.goToSettings')}
        </button>
      </div>
    );
  }

  const showErr = showRequired && missing;
  return (
    <div
      className={enabled ? '' : 'opacity-50 pointer-events-none'}
      style={showErr ? { outline: '1.5px solid var(--danger, #d33)', borderRadius: 5 } : undefined}
    >
      <IconSelect
        value={value ?? ''}
        onChange={onChange}
        ariaLabel={t('editor:export.provider.fileLabel')}
        placeholder={t('editor:export.provider.selectPlaceholder')}
        options={configuredProviders.map((p) => ({
          value: p.id,
          label: t(p.labelKey),
          icon: <span className="text-[14px] leading-none">{p.icon}</span>,
        }))}
      />
      {showErr && (
        <div style={{ fontSize: 11, color: 'var(--danger, #d33)', marginTop: 4 }}>
          {t('editor:export.provider.required')}
        </div>
      )}
    </div>
  );
}

/**
 * Shared hook: the "go to settings" callback used by all export dialogs.
 */
export function useGoToSettings(onClose: () => void) {
  return () => {
    useNavStore.getState().setCurrentPage('settings');
    useNavStore.getState().setSettingsTab('storage');
    onClose();
  };
}

/**
 * Shared hook: configured providers list + isProviderReady helper.
 */
export function useConfiguredProviders() {
  const configs = useStorageConfigStore((s) => s.configs);
  const providers = getAllProviders();
  const configured = providers.filter((p) =>
    configs[p.id] ? p.isConfigured(configs[p.id]!) : false);
  const isReady = (providerId: string | null) => {
    if (!providerId) return false;
    const c = configs[providerId] ?? null;
    return c ? providers.find((p) => p.id === providerId)?.isConfigured(c) ?? false : false;
  };
  return { configured, isReady, configs };
}

/**
 * Shared radio row used by all export dialogs.
 */
export function ExportRadioRow({
  checked, onChange, label, desc,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  desc?: string;
}): React.JSX.Element {
  return (
    <label
      className="flex items-start gap-2.5 py-1.5 px-2.5 rounded-[5px] cursor-pointer transition-[background] duration-100 hover:bg-hov"
      style={{ outline: checked ? '1.5px solid var(--acc)' : '1px solid var(--brd2)' }}
    >
      <input type="radio" checked={checked} onChange={onChange} className="mt-0.5 accent-[var(--acc)]" />
      <span className="flex flex-col gap-px">
        <span className="text-xs font-medium text-t1">{label}</span>
        {desc && <span className="text-[10px] text-t3">{desc}</span>}
      </span>
    </label>
  );
}
