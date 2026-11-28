# Vault-scoped application subscription data

User asks to store subscription data under ~/.folyn rather than in vault directories, separated by vault ID. Do not migrate or read legacy vault data.

Use session.data IO explicitly for internal state, bodies, translations, images and learning records. Native data command resolves ~/.folyn/vaults/<validated-vault-id> and plugin keys are subscriptions/... . Vault session IO remains for user-saved Markdown and attachments. data.assetUrl resolves native validated path; old pinned tasks retain their captured vault ID. No new permissions, no old-storage fallback.

Scope: Rust subscription_data_io and dispatcher; SDK session.data contract + provider; plugin repositories/cache/learning reads and writes; mocks and focused tests; docs and package0.0.1. No automatic commit/push/re-release requested in this turn.

Acceptance: two vault IDs write distinct app roots; stale pinned writes stay in original partition; user exports read app images and write vault files; malformed IDs/traversal/symlinks rejected; cached-image URLs reference app data; plugin tests pass. Do not run a whole-project build.
