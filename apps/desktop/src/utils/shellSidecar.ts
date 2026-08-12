/**
 * Build the Tauri shell-plugin sidecar name + args for a one-shot shell command.
 *
 * Two sidecars are ACL-granted (see src-tauri/capabilities/*.json):
 * - `claude-cli` (`/bin/sh`) on macOS/Linux — invoked as `sh -lc "<cmd>"` so
 *   PATH from /etc/profile + ~/.profile resolves nvm/pyenv shims.
 * - `win-detect` (`cmd.exe`) on Windows — invoked as `cmd /c "<cmd>"` since
 *   Windows has no login-shell concept; the GUI process inherits the system
 *   PATH and `where`/`<bin> --version` work directly.
 *
 * Caller picks the sidecar name based on `navigator.platform` (browser-safe,
 * no node:detection needed). Used by CliSettings / ScriptRuntimesSettings /
 * gitService / scriptRunnerService — all 4 callers route through here so the
 * platform branch lives in one place.
 */
export function buildShellSidecar(cmd: string): [name: string, args: string[]] {
  const isWin = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform);
  return isWin
    ? ['win-detect', ['/c', cmd]]
    : ['claude-cli', ['-l', '-c', cmd]];
}

/** Whether the current platform is Windows (browser-safe navigator check). */
export function isWindowsPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Win/i.test(navigator.platform);
}
