# gemini cli version command node fix

## Goal

Fix the CLI settings page "测试连接" button for gemini. The button calls
`buildAdapterVersionCommand('gemini', cliPath, platform)`, which returns
`exec '<cli>' '--version'` and runs via `/bin/sh -lc`. Same root cause as
the spawn-path fix (commit `369428da`): `/bin/sh -lc` doesn't load nvm
(bash login sources `.bash_profile`, not `.bashrc` where nvm lives), so
gemini's `#!/usr/bin/env node` shebang resolves to `/usr/local/bin/node`
v14.16.0 — too old for `||=` (Node 16+). Result: SyntaxError before
`--version` even runs.

The spawn-path fix (commit `369428da`) used `$SHELL -lic` in
`buildGeminiShellCommand`. The settings-page version-probe path bypasses
the adapter entirely — it goes through `buildAdapterVersionCommand` in
`piAdapter.ts`. Need the same fix here.

## Requirements

- `buildAdapterVersionCommand` adds a `gemini` case that mirrors the
  `pi` case's two-branch logic:
  - **Absolute cliPath** (contains `/`): use sibling node — same
    `dirname(cliPath)/node + cliPath + --version` shape as pi. Avoids
    nvm-loading overhead. The detect button already resolves to absolute
    nvm paths, so this is the common case.
  - **Bare cliPath** (e.g. `gemini`): wrap with the user's login shell
    + `-ilc` (mirrors `buildAdapterDetectCommand`) so `.zshrc`/`.bashrc`
    loads nvm → PATH has v25 node → shebang resolves correctly. Drop
    `exec` (need `| tail -1` to extract version line from under sdkman
    banner noise); `2>/dev/null` silences nvm/sdkman stderr.
- `piAdapter.test.ts` updates: add gemini cases for both branches
  (absolute → sibling node; bare → user shell wrapper).
- No change to claude/codex/opencode behavior (compiled binaries, no
  node shebang, no fix needed).

## Acceptance Criteria

- [ ] `buildAdapterVersionCommand('gemini', '/Users/x/.nvm/.../bin/gemini', 'darwin')`
      returns a command using sibling node from the same dir.
- [ ] `buildAdapterVersionCommand('gemini', 'gemini', 'darwin')` returns
      a command wrapping with the user's login shell + `-ilc`.
- [ ] `buildAdapterVersionCommand('gemini', 'gemini', 'linux')` uses
      `getent`-resolved shell.
- [ ] `buildAdapterVersionCommand('gemini', 'gemini', 'win32')` keeps
      the Windows `"<cli>" --version` shape (unchanged).
- [ ] Existing tests for pi/claude/unknown stay green.
- [ ] `npx vitest run --project cli-adapter` stays green.

## Definition of Done

- Tests added/updated; lint + typecheck green.
- User clicks "测试连接" on the gemini row in CLI settings and sees the
  gemini version string (no SyntaxError).

## Technical Approach

### Sibling-node branch (absolute cliPath)

Mirror `buildPiShellCommand`'s sibling-node logic:
```ts
const dir = cliPath.slice(0, cliPath.lastIndexOf('/'));
return `exec ${quoteShellArg(`${dir}/node`)} ${quoteShellArg(cliPath)} ${quoteShellArg('--version')}`;
```

### User-shell-wrapper branch (bare cliPath)

Mirror `buildAdapterDetectCommand`'s shell resolution + `-ilc`:
```ts
const userShell = platform === 'darwin'
  ? `$(dscl . -read /Users/$(whoami) UserShell | awk '{print $2}')`
  : platform === 'linux'
    ? `$(getent passwd $(whoami) | cut -d: -f7)`
    : '';
if (!userShell) {
  // Unknown platform — fall back to bare exec (matches pre-fix behavior).
  return `exec ${quoteShellArg(cliPath)} ${quoteShellArg('--version')}`;
}
// Drop exec — we need `| tail -1` to extract the version line from
// under the sdkman/nvm banner noise that -ilc sources print to stdout
// before `gemini --version` runs.
return `"${userShell}" -ilc ${quoteShellArg(`${cliPath} --version`)} 2>/dev/null | tail -1`;
```

### Why `| tail -1` and `2>/dev/null`

- `-ilc` sources rc files which print banners (sdkman "Using java
  version ...", nvm "Now using node v...") to stdout BEFORE the version
  command runs. The settings page does `stdout.trim().split('\n')[0]`
  to extract the version — the first line would be the banner, not the
  version. `| tail -1` takes the last line (the version output).
- `2>/dev/null` silences zsh/bash non-TTY job-control warnings and
  rc-file init noise that goes to stderr.

### Why drop `exec` for the bare case

`exec` replaces the shell process, so a pipe can't attach to its output.
The wrapper `/bin/sh -lc "<cmd>"` (the sidecar) hosts the pipeline as a
parent, launching the user shell as a child. (Same reason
`buildAdapterDetectCommand` doesn't use exec.)

## Out of Scope

- Fixing pi's bare-cliPath case (`exec 'pi' '--version'` has the same
  latent bug). pi users typically set absolute cliPath via the detect
  button. Fix when a pi user reports it.
- Applying the sibling-node/user-shell fix to all JS-shebang adapters
  generically (no abstraction until we have 3+ cases — pi and gemini
  are the only two now, and they share the pattern by coincidence, not
  by shared abstraction).

## Research References

- `.trellis/tasks/archive/2026-08/08-20-gemini-cli-adapter-node-version-fix/research/`
  — N/A (no new research; this is a code-path follow-up to the spawn
  fix in the same root-cause family).
- `packages/cli-adapter/src/piAdapter.ts` — `buildAdapterDetectCommand`
  is the precedent for the user-shell + `-ilc` + `| tail -1` pattern.
- `packages/cli-adapter/src/piAdapter.test.ts` — `buildAdapterVersionCommand`
  tests for pi/claude/unknown establish the test shape.

## Technical Notes

- User confirmed via question: the SyntaxError is from the CLI settings
  page "测试连接" button (CliSettings.tsx:139-160) — calls
  `buildAdapterVersionCommand(a.id, p, platform)` then
  `buildShellSidecar(versionCmd)` → `Command.create(sidecarName, sidecarArgs)`
  → spawns `/bin/sh -lc "<versionCmd>"`.
- The fix is one branch in `buildAdapterVersionCommand` — ponytail root-
  cause fix in the shared function, not a patch in the settings page.
