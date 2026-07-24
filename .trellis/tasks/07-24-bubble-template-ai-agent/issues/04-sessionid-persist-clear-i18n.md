# 04 — sessionId persistence + "清空" button + i18n polish

**What to build:** The modal's `sessionId` is persisted (in `localStorage` or `petStore`'s persistence slice — TBD at implement time) so closing and reopening the modal rehydrates the prior chat (rig backend replays history from `~/.quill/chat-sessions/<id>.json`). A "清空" button generates a fresh `crypto.randomUUID()`, clears the in-memory message list, and updates persistence — the old session JSON file is left as an orphan on disk (harmless, KB-sized). All new UI strings (button labels, error messages, modal title, paperclip tooltip, etc.) move to i18n keys under the existing `settings:pet.templates.*` namespace, with both `zh` and `en` translations.

**Blocked by:** 01 — builds on the modal spine; does NOT block on T2/T3 (independent of upload features).

**Status:** ready-for-agent

- [ ] `sessionId` persisted; close+reopen rehydrates the prior chat
- [ ] "清空" button generates a new sessionId, clears in-memory messages, updates persistence
- [ ] Orphaned `~/.quill/chat-sessions/<old-id>.json` files do not interfere with the new session
- [ ] All new UI strings extracted to i18n keys under `settings:pet.templates.*` (or similar, matching existing convention)
- [ ] Both `zh` and `en` locale files updated
- [ ] Modal component test extended: close+reopen preserves message list; "清空" clears it
