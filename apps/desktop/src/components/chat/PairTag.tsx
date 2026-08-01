/**
 * Shared per-message (provider, model) tag — the small meta line rendered
 * above assistant bubbles (AiPanel + PetChat both used to inline duplicate
 * copies of this). Provider name is emphasized (semibold t2) to distinguish
 * it from the model id (regular t3), separated by a dim pipe.
 *
 * Presentational only (services + icons, no store imports) so it stays safe
 * for the secondary pet window — see the chat/ no-store-import rule in
 * directory-structure.md.
 */

import { useTranslation } from 'react-i18next';
import {
  allProviders,
  providerDisplayName,
  type ProviderEntry,
  type CustomProvider,
} from '@/services/providers/catalog';
import { ProviderIcon } from '@/components/icons/ProviderIcon';

export interface PairTagProps {
  provider: string;
  model: string;
  customerProviders: Readonly<Record<string, CustomProvider>>;
}

export function PairTag({ provider, model, customerProviders }: PairTagProps) {
  const { t } = useTranslation();
  const entry: ProviderEntry =
    allProviders(customerProviders).find((e) => e.id === provider) ??
    ({ id: provider, name: provider } as ProviderEntry);
  return (
    <>
      <ProviderIcon entry={entry} t={t} size={13} />
      <span className="font-semibold text-t2">{providerDisplayName(entry, t)}</span>
      <span className="text-t3">|</span>
      <span className="text-t3">{model}</span>
    </>
  );
}
