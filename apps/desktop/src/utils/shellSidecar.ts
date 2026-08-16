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
 *
 * Accepts either a pre-built command string OR a pre-split argv array. The
 * array form is required when an argument is a filesystem path on Windows:
 * passing `node "C:\path\file.js"` as one string makes Rust (which builds the
 * CreateProcess command line) backslash-escape the embedded `"` as `\"`, but
 * cmd.exe does not understand `\"` — it passes the literal `"` through to the
 * target program, whose CRT then decodes `\"` back to a literal `"`, so the
 * path arrives with embedded quote characters (MODULE_NOT_FOUND). Splitting
 * into separate args lets Rust quote each one independently, producing a clean
 * quoted path with no `\"` for cmd.exe to mishandle.
 */
import { isTauri } from '@/utils/platform';

/** Single-quote-escape one POSIX sh argument: wraps in `'...'` with embedded
 *  `'` escaped as `'\''`. Sufficient for args we construct; not a security
 *  boundary (inputs are ours). The canonical home for this helper — gitService
 *  and scriptRunner both reach for it via buildShellSidecar's array form. */
export function escapeShellArg(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function buildShellSidecar(cmd: string | string[]): [name: string, args: string[]] {
  const isWin = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform);
  // Array form: pre-split argv. Windows passes each element as a separate
  // `cmd /c` arg (Rust quotes per-arg, avoiding the `\"` + cmd.exe mismatch).
  // Unix joins shell-escaped elements into the `sh -lc` string (sh -c takes
  // a single string argument).
  if (Array.isArray(cmd)) {
    return isWin
      ? ['win-detect', ['/c', ...cmd]]
      : ['claude-cli', ['-l', '-c', cmd.map(escapeShellArg).join(' ')]];
  }
  return isWin
    ? ['win-detect', ['/c', cmd]]
    : ['claude-cli', ['-l', '-c', cmd]];
}

/** Whether the current platform is Windows (browser-safe navigator check). */
export function isWindowsPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Win/i.test(navigator.platform);
}

/** Whether the current platform is macOS (browser-safe navigator check). */
export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
}

/** Whether the voice module is supported on the current platform.
 *
 *  Voice input is macOS-only for now. Windows support was added in R15 but
 *  is temporarily hidden (the Rust voice module is still cfg-gated to macOS).
 *  Re-enable Windows by restoring: `return isMacPlatform() || isWindowsPlatform();`
 *  Centralized here so VoiceInputButton / useVoiceInput / VoiceSettings share
 *  one source of truth. `isTauri()` guard ensures the web build (no
 *  `navigator.platform` Tauri webview semantics) short-circuits to false. */
export function isVoiceSupportedPlatform(): boolean {
  if (!isTauri()) return false;
  // Windows 语音输入暂未支持，先隐藏（代码保留，后续再支持）。
  return isMacPlatform();
  // return isMacPlatform() || isWindowsPlatform();
}
