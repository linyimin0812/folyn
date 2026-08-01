import { TauriVaultProvider } from './tauriProvider';
import type { ProviderType, VaultCapabilities } from '../types';

/**
 * GitHub vault provider. Clones a GitHub repo to a local directory on vault
 * creation, then operates purely on the cloned local files — so all file
 * operations (read/write/list/rename/delete) are identical to the local
 * Tauri provider. This class only overrides identity + capabilities; the
 * actual clone is orchestrated by the desktop `gitService` (via the shell
 * plugin) at vault-creation time, not on every `connect()`.
 *
 * `connect()` inherits Tauri's behavior: expand `~`, ensure the directory
 * exists. On reconnect (repo already cloned) this means "open local dir",
 * never a re-clone — re-cloning would clobber uncommitted local edits.
 */
export class GithubVaultProvider extends TauriVaultProvider {
  override readonly id: string = 'github';
  override readonly type: ProviderType = 'github' as any;
  override readonly displayName: string = 'GitHub 仓库';
  override readonly capabilities: VaultCapabilities = {
    writable: true,
    watch: true,
    search: false,
    history: true, // git-backed → version history available via shell
    sharing: false,
    streaming: false,
    offline: true,
  };
}
