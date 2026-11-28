## Implementation and verification

The host and extension repositories were both updated. Private subscription state, bodies, translations, images, and learning records now use the extension session's `data` API, resolved natively under `~/.folyn/subscriptions/<vaultId>`. Exported Markdown and copied attachments remain in the user Vault. No old `.folyn/subscriptions` Vault data is read or migrated.

Extension validation: TypeScript typecheck passed; full Vitest suite passed (217 tests, 1 skipped). Host capability tests passed (18 tests). Extension SDK typecheck passed. Rust source formatting and `git diff --check` passed. The full desktop/Rust build and native Rust unit test were not run, following repository guidance against whole-project builds.
