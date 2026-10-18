# Extension settings installation order

## Goal
Keep built-in extensions first in Settings, followed by other extensions in reverse installation order (newest first).

## Requirements
- Preserve the existing built-in order at the top.
- Show externally installed extensions newest first using the persisted registry order.
- Refreshes and restarts preserve this order; updates retain the original install position.

## Acceptance Criteria
- Built-ins precede external entries.
- Registry entries oldest → newest display newest → oldest.
- No changes to install persistence, lifecycle, catalog order, or existing unrelated work.

## Technical Notes
`extension_commands::upsert_record` appends new IDs and replaces existing IDs in place. `list_extensions` returns that persisted order. `fetchRows` already prepends built-ins. Reverse only external rows before combining. This is a trivial ordering change with explicit user requirements; no further preference decisions are needed. Do not run full builds or whole-project type checking.

## Definition of Done
Review the diff and existing targeted checks; document any limitations.

## Out of Scope
Timestamps, data migrations, manual sorting, unrelated changes.

## Verification
- Implemented built-ins first and newest-installed external rows first in fetchRows.
- Existing extensionStore test file: 11 tests passed.
- git diff --check passed for extensionStore.ts.
- Independent trellis-check review passed; no fixes needed.
- No spec update needed for this local ordering rule; code comment documents registry-order dependency.
- Full builds and whole-project type checks were not run per project instructions.
- User authorized commit and push; unrelated existing changes excluded.
