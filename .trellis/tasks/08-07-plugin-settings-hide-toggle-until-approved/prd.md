# Plugin Settings — Hide Toggle Until Trusted Plugin Approved

## Goal

In `Settings → Plugins`, the `Toggle` (activate/deactivate) currently always renders next to each row's action buttons. For a trusted-tier plugin that has NOT been approved yet, showing the toggle is misleading — the trusted loader refuses to `import()` an unapproved plugin, so toggling on does nothing useful. The only meaningful action at that stage is the **Approve** button (which opens the consent modal → `approve_plugin`).

Hide the `Toggle` when `needsApproval` is true (trusted + unapproved). Show it otherwise:
- Sandbox plugins: always show (auto-activate on install; trust boundary is the iframe).
- Trusted approved: show toggle.

## Approach

Single-line guard in `PluginRowCard` (`apps/desktop/src/components/settings/PluginsSettings.tsx`): wrap the `<Toggle>` in `{!needsApproval && (...)}`. The Approve button already gates on `needsApproval`, so the two buttons become mutually exclusive — exactly one of them shows at any time for a trusted plugin (Approve → Toggle after approval), and sandbox always shows Toggle.

## Files touched

- `apps/desktop/src/components/settings/PluginsSettings.tsx` — guard the `<Toggle>` render with `!needsApproval`.

## Acceptance

- Trusted + unapproved: row shows only the **Approve** button (no Toggle).
- After approval (or any sandbox plugin): row shows the **Toggle** (+ Uninstall).
- Approve flow (consent modal → `approve_plugin`) still works.
- Activate/Deactivate flow still works after approval.

## Test plan

Manual in `pnpm dev`:
1. Install a trusted-tier plugin without approving — verify only Approve button shows.
2. Approve it — verify Toggle replaces Approve.
3. Sandbox plugin — verify Toggle always shows.
