# Auto-detect CLI path when AI Panel Agent/Ask mode runs without configured path

## Goal

When the user invokes AI Panel's Agent/Ask mode and the CLI path for the
active adapter has not been configured (empty or still the adapter's default
binary name), auto-detect the path via the user's login shell and persist it
before starting the adapter — instead of failing at spawn with a confusing
ENOENT / permission error.

## What I already know

- Send path: `apps/desktop/src/components/ai/AiPanel.tsx:580` calls
  `adapter.start({ cliPath: aiConfig.cliPath, workingDir })` with no validation.
  A missing/misconfigured path fails at spawn.
- Detect logic exists: `buildAdapterDetectCommand` in
  `packages/cli-adapter/src/piAdapter.ts:206` runs `which` in the user's login
  shell. Currently only used from `CliSettings.tsx:130-153` (settings detect
  button).
- Shell sidecar helpers `buildShellSidecar` + `isWindowsPlatform` already
  live in `apps/desktop/src/utils/shellSidecar.ts` — reusable.
- `aiConfigStore` defaults `cliPath: 'claude'` when never set
  (`store/aiConfigStore.ts:359-360`); `setCliPath` at `:391-397` persists.
- Per-adapter default binary name lives in adapter config
  (`registry.ts:79,92` `cliPathDefault`).
- Rig Chat mode is unaffected — it has no CLI path and already errors at
  `AiPanel.tsx:380-384`.

## Definition of "unconfigured"

`!cliPath || cliPath === adapter.cliPathDefault` (empty or still the default
binary name the store ships with). If the user has ever set a path (even a
broken one), we respect their setting and surface the spawn error — silently
overwriting a user-set path is worse than showing the error.

## Requirements

- Before `adapter.start` in the Ask/Agent branch of `AiPanel.tsx`, check
  whether the current `cliPath` is "unconfigured" per the definition above.
- If unconfigured, run detect via the existing sidecar + `buildAdapterDetectCommand`.
- On success: persist with `setCliPath` and use the detected path for `adapter.start`.
- On failure (detect returns empty / non-zero exit): surface a helpful
  message via the existing stream-error path (`appendToLastMessage` +
  `t('settings:cli.cliPath.notInstalled')` or a new `ai:errors.cliPathNotConfigured`
  i18n key that tells the user to open Settings → CLI to configure manually).
- Extract a shared `detectAdapterCliPath(adapterId)` helper from
  `CliSettings.tsx` so both the settings button and the send path use the
  same flow. New home: `apps/desktop/src/services/cliPathDetect.ts` (sibling
  of existing services).

## Acceptance Criteria

- [ ] Fresh state (default `cliPath: 'claude'`): first Agent/Ask send runs
  detect, persists detected path, and the prompt reaches the CLI — no manual
  settings visit required.
- [ ] If detect finds nothing: user sees a clear "not installed, configure
  in Settings → CLI" message in the chat, not a raw spawn error.
- [ ] Already-configured (user-set) path is never silently overwritten;
  if broken, the existing spawn error path still fires.
- [ ] Rig chat mode unaffected.
- [ ] `CliSettings.tsx` detect button still works after extracting the helper.

## Definition of Done

- Type-check clean (no new `any`).
- No new dependencies.
- No whole-repo build run (per user feedback memory).

## Technical Approach

1. Extract a `detectAdapterCliPath(adapterId: string): Promise<string>` into
   `apps/desktop/src/services/cliPathDetect.ts`. Wraps the Tauri shell-plugin
   `Command.create(sidecar, args)` call and returns the first non-empty stdout
   line (empty string on failure). This is the body of `CliSettings.tsx:131-152`
   generalized to any adapter id.
2. `CliSettings.tsx` detect button swaps its inline impl for the new helper
   (keeps its local UI state for test-status spinners).
3. `AiPanel.tsx` Ask/Agent branch: before `adapter.start`, if
   `!aiConfig.cliPath || aiConfig.cliPath === adapter.cliPathDefault`,
   call `detectAdapterCliPath(adapter.id)`. If non-empty, `setCliPath(detected)`
   and use it; if empty, throw an error with the not-configured message so
   the existing catch at `:585-590` surfaces it in chat.

## Decision (ADR-lite)

**Context**: The send path silently relies on whatever `aiConfig.cliPath`
holds; a fresh install ships with the default binary name and fails at spawn
if that binary isn't on PATH.

**Decision**: Detect-on-send for the unconfigured case only, reuse the
existing settings-detect logic, persist the detected path so subsequent
sends skip detection.

**Consequences**: One-shot detect cost on first send after install or after
clearing settings. User-set paths are respected (no silent overwrite). If
the binary truly isn't installed, the user gets a clear in-chat hint to
open Settings rather than a raw ENOENT.

## Out of Scope

- ENOENT recovery when a user-set path no longer exists (separate concern;
  the user can fix it in Settings).
- Re-detecting on every send (cached persisted path is fine).
- Rig chat mode (no CLI path).
- Feature-adapter callers (`wikiLintService`, `githubAnalysisService`) —
  these already go through `getFeatureCliPath` which falls back to the
  adapter id; they can be migrated later if the same pain shows up.

## Technical Notes

- `AiPanel.tsx:580` — insertion point.
- `CliSettings.tsx:130-153` — existing inline detect to extract.
- `packages/cli-adapter/src/piAdapter.ts:206-220` — `buildAdapterDetectCommand`.
- `apps/desktop/src/utils/shellSidecar.ts` — `buildShellSidecar`, `isWindowsPlatform`.
- `apps/desktop/src/store/aiConfigStore.ts:391-404` — `setCliPath` / `setCliPathFor`.
- i18n keys: `settings:cli.cliPath.notInstalled` exists; add
  `ai:errors.cliPathNotConfigured` pointing the user to Settings → CLI.
