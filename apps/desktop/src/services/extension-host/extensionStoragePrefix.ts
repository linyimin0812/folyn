/** Storage namespace prefix for one extension — shared by the trusted
 * `api.storage` slot (createExtensionApi) and the sandbox/tool
 * `storage:get`/`storage:set` RPC (rpcBridge) so every surface of the same
 * extension sees the same keys. Lives in its own module so rpcBridge stays
 * free of the createExtensionApi import graph. */
export function extensionStoragePrefix(extensionId: string): string {
  return `ext:${extensionId}:`;
}
