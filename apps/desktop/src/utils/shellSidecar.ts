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
import { isTauri } from '@/utils/platform';

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
