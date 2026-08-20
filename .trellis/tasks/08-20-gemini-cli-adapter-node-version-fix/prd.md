# gemini cli adapter node version fix

## Goal

Fix the gemini adapter's `SyntaxError: Unexpected token '||='` runtime error.
The just-shipped `geminiAdapter.ts` uses `/bin/sh -lc` in
`buildGeminiShellCommand`; on this machine `/bin/sh -lc` does NOT load nvm
(bash login sources `.bash_profile`, not `.bashrc` where nvm lives), so the
`gemini` binary's `#!/usr/bin/env node` shebang resolves to
`/usr/local/bin/node` v14.16.0 — too old for `||=` (needs Node 16+).
Compiled-CLI adapters (codex/qoder/opencode — all Mach-O binaries) don't
hit this because they don't need node; gemini is the only nvm-installed JS
script among them.

## Requirements

- `buildGeminiShellCommand` switches from `/bin/sh -lc` to `$SHELL -lic`
  (interactive login) so nvm loads and PATH has the user's v25.9.0 node.
  - `$SHELL` is inherited from the Tauri sidecar's env (login sets it).
  - `-l` + `-i` together source `.zshrc` (and equivalents) which is where
    nvm is loaded.
  - Falls back to `/bin/sh -lc` if `$SHELL` is unset (defensive — matches
    the original behavior).
- `GeminiAdapter.send`'s stderr handler filters version-manager noise lines
  (java/ensa/sdkman/rtx/asdf/conda activate-style banners) so they don't
  emit as `error` events. Only forward lines that look like real stderr
  (non-empty after the filter).
- `geminiAdapter.test.ts` updates: shell command tests now expect
  `$SHELL -lic` prefix; add a stderr-filter unit test (feed a noise +
  real-error stream, assert only the real-error is emitted).

## Acceptance Criteria

- [ ] `buildGeminiShellCommand` uses `$SHELL -lic` when `$SHELL` is set,
      `/bin/sh -lc` as fallback when unset.
- [ ] stderr handler filters nvm/sdkman/rtx/conda activate banners.
- [ ] Unit tests for both behaviors pass.
- [ ] `npx vitest run --project cli-adapter` stays green.

## Definition of Done

- Tests added/updated; lint + typecheck green.
- User re-runs gemini via the desktop app and confirms it streams
  (init/message/tool_use/etc. events flow without the `||=` SyntaxError).

## Technical Approach

### Shell command

Current:
```ts
const cliCmd = [cliPath, ...args].map(quoteShellArg).join(' ') + ' < /dev/null';
return workingDir
  ? `cd ${quoteShellArg(workingDir)} && exec ${cliCmd}`
  : `exec ${cliCmd}`;
```

Sidecar call: `Command.create('gemini-cli', ['-l', '-c', shellCmd])` —
`-l -c` is what we pass to the shell binary. For `sh` this means login +
command; for `zsh` it means the same.

Wait — the sidecar definition is `{ "cmd": "/bin/sh", "args": true }` — the
CMD is `/bin/sh`, and we pass `['-l', '-c', shellCmd]` as args. So even
if `buildGeminiShellCommand` returns a `$SHELL -lic` wrapper, the sidecar
itself invokes `/bin/sh -l -c "$SHELL -lic '...'"`. That's an extra layer.

Better fix: change the sidecar args we pass. Currently
`Command.create('gemini-cli', ['-l', '-c', shellCmd])`. The Tauri shell
plugin spawns `cmd` (which is `/bin/sh`) with the args. So we get
`/bin/sh -l -c <shellCmd>`. We control `<shellCmd>`, so we can make it
`exec $SHELL -lic '<real command>'`. But that's two layers of shell
quoting.

Simplest: stop passing `-l` to `/bin/sh`; pass `-c` only and let
`shellCmd` be `$SHELL -lic 'cd ... && exec gemini ...'`. This means the
sidecar runs `/bin/sh -c "$SHELL -lic '...'"`. The inner `$SHELL -lic`
loads nvm.

But the sidecar entry is `{ "cmd": "/bin/sh", "args": true }` — we pass
the whole arg vector. Change from `['-l', '-c', shellCmd]` to
`['-c', shellCmd]` where `shellCmd` now embeds the `$SHELL -lic` wrapper.

Actually even simpler — just change the shell command to invoke
`$SHELL -lic` directly:

```ts
const innerCmd = workingDir
  ? `cd ${quoteShellArg(workingDir)} && exec ${cliCmd}`
  : `exec ${cliCmd}`;
return `${quoteShellArg(process.env.SHELL || '/bin/sh')} -lic ${quoteShellArg(innerCmd)}`;
```

And change the sidecar call to `Command.create('gemini-cli', ['-c', shellCmd])`
(drop `-l` since we don't need login on the outer `/bin/sh` — the inner
`$SHELL -lic` handles it).

### stderr filter

Filter lines matching these patterns (any of):
- `Using (java|gradle|maven|scala|...) version` (sdkman)
- `Using the ...` (ensa)
- ` ____ __ _____` style ASCII art banners
- Lines that are only whitespace after trim

Simplest: filter out lines starting with `Using ` (covers sdkman + most
version-manager banners). Real gemini errors start with `[ERROR]` or
`Error:` or stack-trace lines — they don't start with `Using `.

## Out of Scope

- Making nvm loading work for `sh` users without nvm in `.zshrc`. If the
  user runs `sh` as their $SHELL they'd hit the same bug — but $SHELL on
  macOS is virtually always zsh or bash, and bash interactive sources
  .bashrc which has nvm. Out of scope to fix non-zsh/non-bash shells.
- Path-prepend approach (`dirname <abs-cliPath>` to PATH) — only works
  for absolute cliPath; default `"gemini"` doesn't. Defer until user
  actually wants to pin a node version per-adapter.
- Verifying with a real authenticated gemini run (API endpoint still
  unreachable from this machine).

## Research References

- `.trellis/tasks/archive/2026-08/08-20-gemini-cli-adapter/research/gemini-cli-shape.md`
  — wire shape unchanged; only the shell invocation changes.

## Technical Notes

- User confirmed via question: "根因修 + stderr 过滤（推荐）".
- `process.env.SHELL` is the TS-side env; Tauri's `Command` inherits the
  parent process env, so `$SHELL` propagates into the spawned shell.
- zsh interactive non-TTY may print job-control warnings — those would
  also be filtered by the stderr noise filter (lines starting with
  `zsh:` or containing `job control`).
