# Settings detect: show "not installed" instead of silent no-op

## Goal

When the user clicks **Detect** in (a) Script Runtimes settings and (b) CLI adapter settings, and the binary is not installed on the system, the UI currently silently no-ops (path unchanged, no feedback). Show an explicit "not installed" message so the user knows detection ran and failed. Must work on macOS and Windows.

## What I already know

Detection commands are platform-aware already — no new platform branching needed:
- Script runtimes: `apps/desktop/src/services/scriptRunner/scriptRunnerService.ts:41-69` — `where <bin>` on Windows, `which <bin>` elsewhere (shell runtime special-cased).
- CLI adapters: `packages/cli-adapter/src/piAdapter.ts:172-186` `buildAdapterDetectCommand` — darwin uses `dscl`-resolved login shell, win32 uses `where`, default `which`. Routed through `buildShellSidecar` (`apps/desktop/src/utils/shellSidecar.ts:18-28`) which picks `/bin/sh -lc` on non-Windows and `cmd.exe /c` on Windows.

Both UIs share the same silent-failure pattern:
- `apps/desktop/src/components/settings/ScriptRuntimesSettings.tsx:49-51` — only `setRuntimePath` when `code === 0 && detected`; catch `{}` swallowed.
- `apps/desktop/src/components/settings/CliSettings.tsx:121-123` — only `setCliPathFor` when `code === 0 && detected`; catch `{}` swallowed.

Both UIs already have a per-row `result` channel for the Test button (red text, auto-clears after 6s):
- `ScriptRuntimesSettings.tsx:139-146` reads `testStatus[r.id].result`.
- `CliSettings.tsx:156-160` reads `st.result`.

i18n namespaces live in `apps/desktop/src/i18n/locales/{en,zh,ja}/settings.json`. Existing keys: `scriptRuntime.detect`, `scriptRuntime.test.{success,exitCode,cannotRun}`; `cli.cliPath.{detect,detectTitle,hint}`, `cli.test.{success,exitCode,cannotRun}`.

## Requirements

- On Detect failure where the sidecar returned non-zero exit OR detected path is empty, surface a "not installed" message in the same red-text slot the Test button uses. macOS and Windows both surface this — the underlying detect commands already branch per platform, so no new platform logic is required.
- On Detect failure where the sidecar itself threw (e.g. `/bin/sh` launch failed, plugin-shell rejection), surface the actual error string in the same slot (reuse the `cannotRun: {{error}}` shape from the Test button) — not a generic "not installed", since the user can act on the real error text.
- Message auto-clears after 6s, mirroring the Test result behavior, so a stale message doesn't linger after the user fixes the issue and re-detects.
- On Detect success, behavior is unchanged: path is set, no message shown.
- Three locales updated: en / zh / ja.

## Acceptance Criteria

- [ ] On macOS, with `claude` not on PATH, clicking Detect in CLI settings shows the "not installed" message in red beneath the row.
- [ ] On macOS, with `node` not on PATH, clicking Detect in Script Runtimes shows the "not installed" message for that row.
- [ ] On Windows, same behavior for both rows (`where` returns non-zero).
- [ ] After ~6s the message disappears on its own.
- [ ] On Detect success (tool installed), path is filled and no "not installed" message is shown.
- [ ] en / zh / ja strings all present and used.

## Definition of Done

- Lint / typecheck green for the desktop app.
- Manually verified on at least one platform (macOS most likely); Windows path reasoned through via the existing `where` branch.
- No new dependencies, no new state slots beyond reusing the existing `result` channel.

## Technical Approach

Reuse the existing per-row `result` state slot — do not add a new `detectStatus`. On the detect-failure branch (currently silent), call the same setter the Test button uses, with `{ success: false, message: t('…notInstalled') }`, and arm the same 6s auto-clear `setTimeout`.

Concretely:

- `ScriptRuntimesSettings.tsx`: in `onDetect`, replace the silent `if (output.code === 0 && detected) { setRuntimePath(...) }` with an `else` branch that pushes the notInstalled message into `testStatus[r.id].result`, and in `catch` do the same. Arm `setTimeout(... 6000)` to clear, mirroring `onTest`.
- `CliSettings.tsx`: same shape — on Detect's `else` branch and `catch`, push notInstalled into `st.result`; arm the 6s clear.
- i18n: add `scriptRuntime.detect.notInstalled` and `cli.cliPath.notInstalled` to en/zh/ja `settings.json`.

Skipped: a separate detect-status state slot, a new UI element, distinguishing "non-zero exit" vs "sidecar threw" — both are practically "couldn't find it" and the user doesn't care about the distinction. Add when telemetry shows users hit a detect bug that isn't "not installed".

## Decision (ADR-lite)

**Context**: Detect currently fails silently, leaving the user unsure whether detection ran. **Decision**: Reuse the Test button's `result` slot for detect-failure messages instead of adding a parallel `detectStatus` state. **Consequences**: One message channel per row, simpler diff; the 6s auto-clear applies to detect too (good — stale "not installed" would mislead after install). Risk: if a user runs Detect then immediately runs Test, the Test result overwrites — acceptable, Test is the stronger signal.

## Out of Scope

- Distinguishing "binary missing" from "sidecar failed to launch" — both surface as "not installed".
- Linux-specific testing (commands already branch for it; no Linux machine required to ship).
- Adding new tools to detect (ffmpeg/pandoc) — runtime/adapter sets stay fixed.
- Showing the resolved path on success beyond filling the input — already done.

## Technical Notes

- Files to touch: `apps/desktop/src/components/settings/ScriptRuntimesSettings.tsx`, `apps/desktop/src/components/settings/CliSettings.tsx`, `apps/desktop/src/i18n/locales/{en,zh,ja}/settings.json`.
- Detection command sources: `apps/desktop/src/services/scriptRunner/scriptRunnerService.ts` (runtimes), `packages/cli-adapter/src/piAdapter.ts` (adapters), `apps/desktop/src/utils/shellSidecar.ts` (platform sidecar).
