import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type CustomProvider } from '@/services/providers/catalog';
import { avatarColor } from './helpers';

// ponytail: DrawerState lives here (its primary user). Main settings file
// imports the type from here — no separate helpers file entry needed.
export type DrawerState =
  | { mode: 'add' }
  | { mode: 'edit'; id: string };

// ── Custom provider drawer ─────────────────────────────────────
// Phase 3: adapter family options are the bundled catalog ids the Rust side
// dispatches by — the old endpoint enum keys ('anthropic-messages' etc.)
// are gone. 'openai-completions' is split from 'openai' because most
// OpenAI-compat gateways only expose /v1/chat/completions, not /v1/responses.
const ADAPTER_FAMILY_OPTIONS: string[] = [
  'anthropic',
  'openai-completions',
  'ollama',
  'gemini',
  'openai',
];

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function CustomProviderDrawer({
  state,
  existingIds,
  initial,
  onClose,
  onSave,
}: {
  state: DrawerState;
  existingIds: readonly string[];
  initial: CustomProvider | null;
  onClose: () => void;
  onSave: (data: {
    id: string;
    name: string;
    adapterFamily: string;
    description?: string;
    metadata?: CustomProvider['metadata'];
  }) => void;
}) {
  const { t } = useTranslation();
  const [id, setId] = useState(initial?.id ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [adapterFamily, setAdapterFamily] = useState<string>(
    initial?.adapterFamily ?? 'openai-completions',
  );
  const [description, setDescription] = useState(initial?.description ?? '');
  const [apiKey, setApiKey] = useState(initial?.metadata?.website?.apiKey ?? '');
  const [docs, setDocs] = useState(initial?.metadata?.website?.docs ?? '');
  const [models, setModels] = useState(initial?.metadata?.website?.models ?? '');
  const [official, setOfficial] = useState(initial?.metadata?.website?.official ?? '');
  const [metadataOpen, setMetadataOpen] = useState(false);

  const idValid = ID_PATTERN.test(id.trim());
  const idUnique = state.mode === 'edit' || !existingIds.includes(id.trim());
  const nameValid = name.trim().length > 0;
  const valid = idValid && idUnique && nameValid;

  const previewChar = (name.trim()[0] ?? '?').toUpperCase();

  const buildMetadata = (): CustomProvider['metadata'] | undefined => {
    if (!apiKey && !docs && !models && !official) return undefined;
    return { website: { apiKey: apiKey || undefined, docs: docs || undefined, models: models || undefined, official: official || undefined } };
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-brd rounded-md w-[480px] max-h-[90vh] overflow-y-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-2">
          <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1">
            {state.mode === 'add' ? t('settings:models.addCustomTitle') : t('settings:models.editCustomTitle')}
          </div>
        </div>
        <div className="h-px bg-brd mx-4" />

        <div className="px-4 py-4 flex flex-col gap-3">
          <div className="flex justify-center">
            <span
              className="inline-flex items-center justify-center rounded-full text-white text-[16px] font-bold"
              style={{ width: 40, height: 40, background: avatarColor(name || 'custom') }}
            >
              {previewChar}
            </span>
          </div>

          {state.mode === 'add' && (
            <label className="flex flex-col gap-1">
              <span className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2">
                {t('settings:models.idLabel') || 'ID'}
              </span>
              <input
                className={`fi2 h-[34px] py-[7px] px-2.5 rounded-md border bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui ${id && !idValid ? 'border-red text-red' : 'border-brd'}`}
                value={id}
                onChange={(e) => setId(e.target.value.slice(0, 64))}
                placeholder="my-provider"
                autoCapitalize="off"
                spellCheck={false}
                autoFocus
              />
              <span className={`text-[10px] ${id && !idValid ? 'text-red' : 'text-t3'}`}>
                {ID_PATTERN.test(id.trim())
                  ? (idUnique ? t('settings:models.idHint') || 'Letters, digits, - and _ only.'
                    : t('settings:models.idDuplicate') || 'ID already exists.')
                  : (t('settings:models.idInvalid') || 'Letters, digits, - and _ only.')}
              </span>
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2">
              {t('settings:models.displayNameLabel')}
            </span>
            <input
              className="fi2 h-[34px] py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 32))}
              placeholder={t('settings:models.customNamePlaceholder')}
              maxLength={32}
              autoFocus={state.mode === 'edit'}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2">
              {t('settings:models.categoryLabel')}
            </span>
            <select
              className="fi2 h-[34px] py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
              value={adapterFamily}
              onChange={(e) => setAdapterFamily(e.target.value)}
            >
              {[...ADAPTER_FAMILY_OPTIONS].sort().map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2">
              {t('settings:models.descriptionLabel') || 'Description'}
            </span>
            <textarea
              className="fi2 py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui min-h-[60px] resize-y"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 500))}
              placeholder={t('settings:models.descriptionPlaceholder') || 'Optional'}
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              className="flex items-center gap-1 text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 select-none"
              onClick={() => setMetadataOpen((v) => !v)}
            >
              <svg
                className={`transition-transform ${metadataOpen ? 'rotate-180' : ''}`}
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
              {t('settings:models.metadataLabel') || 'Metadata'}
            </button>
            {metadataOpen && (
              <>
                <input
                  className="fi2 h-[30px] py-[5px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t('settings:models.metadata.apiKey') || 'API key URL'}
                />
                <input
                  className="fi2 h-[30px] py-[5px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
                  value={docs}
                  onChange={(e) => setDocs(e.target.value)}
                  placeholder={t('settings:models.metadata.docs') || 'Docs URL'}
                />
                <input
                  className="fi2 h-[30px] py-[5px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
                  value={models}
                  onChange={(e) => setModels(e.target.value)}
                  placeholder={t('settings:models.metadata.models') || 'Models list URL'}
                />
                <input
                  className="fi2 h-[30px] py-[5px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
                  value={official}
                  onChange={(e) => setOfficial(e.target.value)}
                  placeholder={t('settings:models.metadata.official') || 'Official site URL'}
                />
              </>
            )}
          </div>
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
                name: name.trim(),
                adapterFamily,
                description: description.trim() || undefined,
                metadata: buildMetadata(),
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
