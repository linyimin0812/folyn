import type { FileTypeProvider, PresentationModeId, PresentationModeRegistration } from './types';
import { HandlerRegistry } from './HandlerRegistry';
import { FOLYN_CORE_OWNER } from '@folyn/extension-host';

/**
 * File-type handler registry.
 *
 * Built-in handlers are discovered at build time via `import.meta.glob` and
 * registered once at module load. {@link registerFileTypeHandler} /
 * {@link unregisterFileTypeHandler} expose the registry as the contribution
 * target for extensions (PR3 trusted tier): a extension can register a handler for
 * a new extension at runtime and it takes effect immediately, and is removed
 * on uninstall.
 *
 * Public read API (`getHandlerByExtension` / `getHandlerById` /
 * `getAllHandlers`) is unchanged so existing call sites behave identically.
 * The Map/extension-index logic lives in {@link HandlerRegistry} so it can be
 * unit-tested without triggering the eager glob (which pulls @excalidraw).
 */

const registry = new HandlerRegistry({
  text: 'markdown',
});

/** Register a file-type handler owned by `ownerExtensionId` (default
 * Folyn core). Replaces any prior handler with the same id. */
export function registerFileTypeHandler(
  handler: FileTypeProvider,
  ownerExtensionId: string = FOLYN_CORE_OWNER,
): { dispose: () => void } {
  return registry.register(handler, ownerExtensionId);
}

/** Remove every handler contributed by `ownerExtensionId` (reload/deactivate). */
export function removeFileTypesByOwner(ownerExtensionId: string): void {
  registry.removeByOwner(ownerExtensionId);
}

/** Remove a handler by id. Returns true if a handler was removed. */
export function unregisterFileTypeHandler(id: string): boolean {
  return registry.unregister(id);
}

export function getHandlerByExtension(ext: string): FileTypeProvider | undefined {
  return registry.getByExtension(ext);
}

/** All providers claiming `ext`, highest priority first (Open With, §26). */
export function listProviders(ext: string): FileTypeProvider[] {
  return registry.listProviders(ext);
}

/** The default (highest-priority) provider for `ext` (§25). */
export function resolveDefault(ext: string): FileTypeProvider | undefined {
  return registry.resolveDefault(ext);
}

export function getHandlerById(id: string): FileTypeProvider | undefined {
  return registry.getById(id);
}

export function getAllHandlers(): FileTypeProvider[] {
  return registry.getAll();
}

// ── Presentation-mode helpers ─────────────────────────────────────────────
// Derived accessors over a provider's `modes`, so consumers do not each repeat
// the derivation.

/** All mode ids a provider offers (order = declaration order), excluding
 * `hidden` modes (those stay resolvable via `getMode` but are filtered from
 * the mode switcher). */
export function getSupportedModes(h: FileTypeProvider | undefined): PresentationModeId[] {
  return h?.modes.filter((m) => !m.hidden).map((m) => m.id) ?? [];
}

/** Default mode id: declared `defaultMode` else the first mode. */
export function getDefaultMode(h: FileTypeProvider | undefined): PresentationModeId | undefined {
  if (!h) return undefined;
  return h.defaultMode ?? h.modes[0]?.id;
}

/** Look up a mode registration by id. */
export function getMode(
  h: FileTypeProvider | undefined,
  id: PresentationModeId,
): PresentationModeRegistration | undefined {
  return h?.modes.find((m) => m.id === id);
}

/** True if the provider offers a shell-editor (CodeMirror) mode. */
export function usesShellEditor(h: FileTypeProvider | undefined): boolean {
  return !!h?.modes.some((m) => m.kind === 'shell-editor');
}

/** The component of the `component`-kind mode with this id (undefined for
 * shell-editor / split modes). */
export function getModeComponent(
  h: FileTypeProvider | undefined,
  id: PresentationModeId,
): FileTypeProvider['modes'][number]['component'] {
  const m = getMode(h, id);
  return m?.kind === 'component' ? m.component : undefined;
}

// ── Built-in discovery ──────────────────────────────────────────────────────
const modules = import.meta.glob<{ default: FileTypeProvider }>(
  './*/index.{ts,tsx}',
  { eager: true },
);

for (const m of Object.values(modules)) {
  registry.register(m.default);
}
