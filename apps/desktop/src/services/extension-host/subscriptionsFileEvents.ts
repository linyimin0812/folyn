import type { ExtensionVaultFileChange } from 'folyn-extension-sdk';
const handlers = new Set<(event: ExtensionVaultFileChange) => void>();
/** Emits only after the host filesystem operation succeeded. */
export function emitVaultFileChange(event: ExtensionVaultFileChange): void {
  for (const handler of handlers) { try { handler(event); } catch (e) { console.error('[vault-files] listener failed', e); } }
}
export function onVaultFileChange(handler: (event: ExtensionVaultFileChange) => void): () => void {
  handlers.add(handler);
  return () => { handlers.delete(handler); };
}
