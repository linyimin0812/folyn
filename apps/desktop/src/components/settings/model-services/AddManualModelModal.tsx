import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { familyGroup } from './helpers';

// ── Add manual model modal ───────────────────────────────────────
export function AddManualModelModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (data: { id: string; displayName: string; group: string }) => void;
}) {
  const { t } = useTranslation();
  const [id, setId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [group, setGroup] = useState('');

  const valid = id.trim().length > 0;

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
            {t('settings:models.addManual.title')}
          </div>
        </div>
        <div className="h-px bg-brd mx-4" />

        <div className="px-4 py-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2">
              {t('settings:models.addManual.idLabel')}
            </span>
            <input
              className="fi2 h-[34px] py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
              value={id}
              onChange={(e) => setId(e.target.value.slice(0, 128))}
              placeholder="gpt-4o-mini"
              autoCapitalize="off"
              autoComplete="off"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2">
              {t('settings:models.addManual.nameLabel')}
            </span>
            <input
              className="fi2 h-[34px] py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value.slice(0, 64))}
              placeholder="GPT-4o mini"
              autoCapitalize="off"
              autoComplete="off"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2">
              {t('settings:models.addManual.groupLabel')}
            </span>
            <input
              className="fi2 h-[34px] py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
              value={group}
              onChange={(e) => setGroup(e.target.value.slice(0, 32))}
              placeholder="Gpt 4"
              autoCapitalize="off"
              autoComplete="off"
            />
          </label>
        </div>

        <div className="h-px bg-brd mx-4" />
        <div className="flex justify-end gap-2 px-4 py-3">
          <button className="btn btn-g btn-sm" onClick={onClose}>
            {t('settings:models.cancel')}
          </button>
          <button
            className="btn btn-p btn-sm"
            disabled={!valid}
            onClick={() =>
              onSave({
                id: id.trim(),
                displayName: displayName.trim() || id.trim(),
                group: group.trim() || familyGroup(id.trim()),
              })
            }
          >
            {t('settings:models.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
