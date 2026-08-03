import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Capability } from '@/services/modelRegistry/types';
import { CAPABILITY_PILL } from '@/components/icons/capabilityIcons';

const EDITABLE_CAPABILITIES: Capability[] = [
  'reasoning',
  'function-call',
  'vision',
  'web-search',
  'embedding',
  'rerank',
];

export function CapabilityEditModal({
  modelId,
  initialCapabilities,
  onClose,
  onSave,
}: {
  modelId: string;
  initialCapabilities: readonly Capability[];
  onClose: () => void;
  onSave: (capabilities: Capability[]) => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<Capability>>(() => new Set(initialCapabilities));

  useEffect(() => {
    setSelected(new Set(initialCapabilities));
  }, [initialCapabilities]);

  const toggle = (c: Capability) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-brd rounded-md w-[420px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-2">
          <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1">
            {t('settings:models.editCapabilities.title')}
          </div>
          <div className="text-[length:calc(var(--ui-font-size)-2.5px)] text-t3 mt-0.5 truncate">
            {modelId}
          </div>
        </div>
        <div className="h-px bg-brd mx-4" />

        <div className="px-4 py-4 flex flex-col gap-2">
          {EDITABLE_CAPABILITIES.map((c) => {
            const pill = CAPABILITY_PILL[c];
            const isOn = selected.has(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggle(c)}
                className={`flex items-center justify-between px-3 py-2 rounded-md border transition-colors ${
                  isOn
                    ? 'border-acc bg-accdim'
                    : 'border-brd bg-transparent hover:bg-hov'
                }`}
              >
                <span className="flex items-center gap-2">
                  {pill && (
                    <span
                      className="inline-flex items-center justify-center rounded-[5px]"
                      style={{ width: 18, height: 18, background: pill.bg, color: pill.color }}
                    >
                      <pill.Icon size={11} />
                    </span>
                  )}
                  <span className="text-[length:calc(var(--ui-font-size)-2px)] font-ui text-t1">
                    {t(`settings:models.capability.${c}`)}
                  </span>
                </span>
                <span
                  className={`text-[10px] font-bold px-1.5 h-[14px] inline-flex items-center rounded-full ${
                    isOn ? 'text-white bg-acc' : 'text-t3 bg-hov'
                  }`}
                >
                  {isOn ? 'ON' : 'OFF'}
                </span>
              </button>
            );
          })}
        </div>

        <div className="h-px bg-brd mx-4" />
        <div className="flex justify-end gap-2 px-4 py-3">
          <button className="btn btn-g btn-sm" onClick={onClose}>
            {t('settings:models.cancel')}
          </button>
          <button
            className="btn btn-p btn-sm"
            onClick={() => onSave(Array.from(selected))}
          >
            {t('settings:models.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
