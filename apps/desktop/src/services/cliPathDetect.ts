import { buildAdapterDetectCommand } from '@quill/cli-adapter';
import { buildShellSidecar, isWindowsPlatform, isMacPlatform } from '@/utils/shellSidecar';

/** Detect an adapter's CLI binary on the user's PATH by running `which`/
 *  `where` inside their login shell. Returns the first non-empty stdout
 *  line, or empty string if not found / detect command failed. Mirrors the
 *  detect button in `CliSettings.tsx` so settings UI and send-time
 *  auto-detect share one source of truth. */
export async function detectAdapterCliPath(adapterId: string): Promise<string> {
  const { Command } = await import('@tauri-apps/plugin-shell');
  const platform = isWindowsPlatform() ? 'win32' : isMacPlatform() ? 'darwin' : 'linux';
  const detectCmd = buildAdapterDetectCommand(adapterId, platform);
  const [sidecarName, sidecarArgs] = buildShellSidecar(detectCmd);
  const cmd = Command.create(
    sidecarName,
    sidecarArgs,
    isWindowsPlatform() ? { encoding: 'gbk' } : undefined,
  );
  const output = await cmd.execute();
  if (output.code !== 0) return '';
  return output.stdout.trim().split('\n')[0] ?? '';
}
