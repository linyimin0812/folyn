// Inbox tab for the pet-panel window (PRD: pet inbox).
//
// Lists notifications received via `pet://notify` and captured by
// `petNotifyDispatcher.dispatchNotification` into `petStore.inboxItems`.
// Each row mirrors what the bubble/corner toast showed, and re-fires the
// same jump on click via `pet://bubble-action` (the MAIN window's jump
// router handles it exactly like a bubble title-click).
//
// State is persisted to `settings:all` and synced to the pet-panel window
// via the shared `pet://settings-updated` channel — no separate IPC needed.

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { usePetStore, type InboxItem } from '@/store/petStore';
import type { PetBubbleActionEvent } from './PetBubbleApp';

/** Format a receivedAt epoch ms as a locale-aware string. Kept tiny — no
 *  relative-time library, no i18n key. ponytail: yagni on relative time. */
function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '';
  }
}

/** Fire the same `pet://bubble-action` event the bubble window emits on
 *  title-click. The main-window jump router handles target.kind routing
 *  (schedule / chat / task / file). `launch` payloads route via type
 *  'launch' instead. */
async function fireAction(event: PetBubbleActionEvent) {
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit('pet://bubble-action', event);
  } catch {
    // Non-tauri (tests) — non-fatal.
  }
}

/** A single inbox row. Click re-fires the payload's jump. */
function InboxRow({ item }: { item: InboxItem }) {
  const { t } = useTranslation();
  const { payload } = item;
  const onClick = useCallback(() => {
    if (payload.target) {
      void fireAction({
        type: 'navigate',
        target: payload.target,
        source: payload.source,
      });
    } else if (payload.launch) {
      void fireAction({
        type: 'launch',
        target: payload.target,
        source: payload.source,
        launch: payload.launch,
      });
    }
  }, [payload]);

  const kind = payload.kind ?? 'info';
  const title = payload.title ?? payload.source ?? '';
  const clickable = Boolean(payload.target || payload.launch);
  const kindLabel = t(`pet:inbox.kind.${kind}`, { defaultValue: kind });

  return (
    <button
      type="button"
      className={`pet-inbox-row${clickable ? ' is-clickable' : ''}`}
      onClick={onClick}
      disabled={!clickable}
    >
      <div className="pet-inbox-row-head">
        {kind !== 'info' && (
          <span className={`pet-inbox-kind pet-inbox-kind--${kind}`}>{kindLabel}</span>
        )}
        {title && <span className="pet-inbox-title">{title}</span>}
        <span className="pet-inbox-time">{formatTime(item.receivedAt)}</span>
      </div>
      {payload.text && <div className="pet-inbox-text">{payload.text}</div>}
    </button>
  );
}

export function PetInbox(): JSX.Element {
  const { t } = useTranslation();
  const items = usePetStore((s) => s.inboxItems);
  const clearInbox = usePetStore((s) => s.clearInbox);

  if (items.length === 0) {
    return (
      <div className="pet-inbox-empty">
        {t('pet:inbox.empty')}
      </div>
    );
  }

  return (
    <div className="pet-inbox">
      <div className="pet-inbox-toolbar">
        <span className="pet-inbox-count">{items.length}</span>
        <button
          type="button"
          className="pet-inbox-clear"
          onClick={() => clearInbox()}
        >
          {t('pet:inbox.clear')}
        </button>
      </div>
      <div className="pet-inbox-list">
        {items.map((item) => (
          <InboxRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
