import { PairSelector, type Pair } from '@/components/ai/PairSelector';
import { useNavStore } from '@/store/navStore';
import { useTranslation } from 'react-i18next';

interface KnowledgeModelSelectorProps {
  value: Pair | null;
  onChange: (pair: Pair | null) => void;
  disabled?: boolean;
  panelAlign?: 'left' | 'right';
}

/** The knowledge workflow uses the app-wide configured provider/model pair. */
export function KnowledgeModelSelector({ value, onChange, disabled, panelAlign = 'right' }: KnowledgeModelSelectorProps): React.JSX.Element {
  const { t } = useTranslation();
  return <div role="group" aria-label={t('knowledge:modelSelector.label')} className="flex flex-wrap min-w-0 max-w-full gap-2 items-center text-[12px] text-t2">
    <span>{t('knowledge:modelSelector.label')}</span>
    <PairSelector value={value} onChange={onChange} disabled={disabled} panelAlign={panelAlign}
      className="max-w-[min(100%,420px)]"
      onOpenSettings={() => {
        if (disabled) return;
        useNavStore.getState().setSettingsTab('models');
        useNavStore.getState().setCurrentPage('settings');
      }} />
  </div>;
}
