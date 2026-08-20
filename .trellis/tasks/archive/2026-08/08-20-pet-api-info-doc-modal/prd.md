# Pet API Info Icon → Doc Modal

## Problem
The Pet External API block in settings currently embeds field documentation as `#` comments inline in the displayed curl string. User wants the curl clean (no inline comments) and the field reference moved into a modal triggered by an info icon next to the section title.

## Goal
1. Remove `SAMPLE_NOTIFY_FIELD_DOC` from the curl string — curl reverts to a clean single-line command.
2. Add an info (ℹ) icon button next to the "外部通知 API" h4 title.
3. Clicking the icon opens a modal with the full API doc: endpoint, field table, example payload, close button.

## Scope
- Single file: `apps/desktop/src/components/settings/NotificationsSettings.tsx`
- i18n keys added to `apps/desktop/src/i18n/locales/zh/settings.json` and `en/settings.json` under `settings.pet.api`: `doc` (icon aria-label / tooltip) and `docClose` (close button label). Field-table content stays as inline zh strings in the component (documentation prose, not UI chrome) — same pattern as `BubbleTemplateAIChatModal` and other content-heavy modals.

## Non-Goals
- External docs site / hyperlink approach (rejected: modal picked).
- Full i18n of every field description line.
- Reformatting other parts of the settings page.

## Spec
- Modal pattern follows `ConsentModal` in `PluginsSettings.tsx:335`: fixed `inset-0 bg-black/40` overlay, centered panel, click-outside to close.
- Field reference content must match the actual `build_notify` contract in `apps/desktop/src-tauri/src/pet_api/dispatch.rs`:
  - `action: "notify"` (required; `show`/`hide` reserved, not implemented)
  - `kind`: `info` | `reminder` | `message` | `event` (default `info`)
  - `title`: optional non-empty string
  - `source`: optional, ≤128 chars
  - `text`: required, non-empty, ≤4096 chars
  - `actions`: optional array of `{id, label, launch?}` — per-action launch fires on click
  - `launch`: optional, bubble-body click target `{type: "url"|"app", value}` — url must be http(s), app must match `[A-Za-z0-9 .\-]+`
- Example payload shown in modal matches `SAMPLE_NOTIFY_BODY` constant.

## Implementation
1. Remove `SAMPLE_NOTIFY_FIELD_DOC` constant; revert `curl` computation to single-line.
2. Add `import { Info } from 'lucide-react';`.
3. Add `const [showDoc, setShowDoc] = useState(false);` in `PetExternalApiBlock`.
4. Next to the h4 title, render `<button aria-label={t('settings:pet.api.doc')} onClick={() => setShowDoc(true)}><Info size={14} /></button>`.
5. At the end of `PetExternalApiBlock`'s return, conditionally render `{showDoc && <PetApiDocModal onClose={() => setShowDoc(false)} port={info.port} />}`.
6. Add `PetApiDocModal` component (same file, below `PetExternalApiBlock`): overlay + panel with endpoint, field table (grid), example `<pre>`, close button.
7. i18n: add `doc` and `docClose` keys to zh + en.
8. Revert `<code>` className to `break-all` only (single-line again, no need for `whitespace-pre-wrap`).

## Test
- Manual: open settings → Pet External API → see info icon next to title → click → modal opens with field table + example → close button / click-outside dismisses.
- The displayed curl is single-line, no `#` comments.

## Risk
- None beyond standard modal a11y (focus trap not implemented, matches `ConsentModal` precedent — separate a11y pass if needed).
