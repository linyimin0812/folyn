import { PairSelector, type Pair } from '@/components/ai/PairSelector';
import { useNavStore } from '@/store/navStore';

interface KnowledgeModelSelectorProps {
  value: Pair | null;
  onChange: (pair: Pair | null) => void;
  disabled?: boolean;
  panelAlign?: 'left' | 'right';
}

/** The knowledge workflow uses the app-wide configured provider/model pair. */
export function KnowledgeModelSelector({ value, onChange, disabled, panelAlign = 'right' }: KnowledgeModelSelectorProps): React.JSX.Element {
  return <div role="group" aria-label="整理模型" className="flex flex-wrap min-w-0 max-w-full gap-2 items-center text-[12px] text-t2">
    <span>整理模型</span>
    <PairSelector value={value} onChange={onChange} disabled={disabled} panelAlign={panelAlign}
      className="max-w-[min(100%,420px)]"
      onOpenSettings={() => {
        if (disabled) return;
        useNavStore.getState().setSettingsTab('models');
        useNavStore.getState().setCurrentPage('settings');
      }} />
  </div>;
}
