# Confirm dialog before uninstall plugin

## Goal

Add a confirmation dialog before uninstalling a plugin, so a stray click on "Uninstall" doesn't wipe a trusted plugin's data/approval without explicit consent.

## Requirements

- Clicking "Uninstall" on a plugin row opens a confirm dialog before calling `uninstall_plugin`.
- Cancel → no-op. Confirm → proceed with existing `uninstall(id)` flow.
- i18n: en + zh strings for title/message/confirm/cancel.

## Technical Approach

Use native `confirm()` from `@tauri-apps/plugin-dialog` (already imported for `open()` in the same file). Avoids a new modal component, store state, and ConsentModal-style plumbing. Matches the laziest rung: native platform feature > custom UI.

## Out of Scope

- Custom modal component mirroring ConsentModal.
- Persisting "don't ask again" preference.
- Bulk uninstall.

## Acceptance Criteria

- [ ] Uninstall click opens native confirm dialog.
- [ ] Cancel does nothing.
- [ ] Confirm calls existing `uninstall(id)`.
- [ ] en + zh strings present.
- [ ] Typecheck passes.
