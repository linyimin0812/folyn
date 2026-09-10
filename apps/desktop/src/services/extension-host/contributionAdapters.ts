/**
 * In-process contribution adapters for trusted-tier extensions.
 *
 * Trusted extensions are `import()`-ed into the host realm (see `trustedLoader`),
 * so their contributions resolve to real React components / handlers — not
 * postMessage proxies. Each adapter maps a manifest contribution array into
 * the matching app registry (`commandRegistry` / `file-types` /
 * `ContainerRegistry`) and returns a single
 * `Disposable` that unregisters everything on extension deactivate/uninstall.
 *
 * The extension module's export shape (the contract a trusted extension authors
 * against):
 *
 * ```ts
 * // index.js — a self-contained ESM bundle (no remote imports)
 * import type { FileTypeHandler, ContainerExtension, ... } from '@folyn/extension-host';
 * import type { ComponentType } from 'react';
 *
 * // Named export maps keyed by the manifest's entry-ref strings.
 * export const handlers: Record<string, FileTypeHandler> = { 'default': { ... } };
 * export const containers: Record<string, ComponentType> = { 'callout': MyComp };
 * export const commands: Record<string, () => void | Promise<void>> = { 'greet': () => {} };
 *
 * // Optional lifecycle hooks (also accepted as a default-export factory).
 * export function activate(ctx: ExtensionContext) { ... }
 * export function deactivate() { ... }
 * ```
 *
 * Entry-refs in the manifest (`handler: 'default'`, `component: 'callout'`,
 * `run: 'greet'`) index into these maps. An entry-ref that is missing from
 * the module's exports is skipped with a console warning (best-effort: a
 * partial extension should still load its other contributions).
 */

import type { Disposable, ExtensionManifest } from '@folyn/extension-host';
import type {
  CommandContribution,
  ContainerContribution,
} from '@folyn/extension-host';
import type { FileTypeHandler } from '@/components/file-types/types';
import type { ContainerCategory } from '@folyn/container-extensions';
import { withExtensionBoundary } from './extensionBoundary';

/**
 * The resolved exports of a trusted extension's ESM bundle. All maps are
 * optional — a extension may contribute only commands, only file-types, etc.
 *
 * ponytail: interface moved to `folyn-extension-sdk` contracts (so external
 * extension authors typecheck against the publishable SDK). Re-exported here so
 * existing `import type { ExtensionModule } from './contributionAdapters'` keeps
 * working.
 */
export type { ExtensionModule } from 'folyn-extension-sdk';
import type { ExtensionModule } from 'folyn-extension-sdk';

/** Merge a list of disposables into one. */
function mergeDisposables(disposables: Disposable[]): Disposable {
  return {
    dispose: async () => {
      for (const d of disposables) {
        try {
          await d.dispose();
        } catch (err) {
          console.error('[extension-host] contribution dispose failed:', err);
        }
      }
    },
  };
}

// ── Command adapter (in-process) ────────────────────────────────────────────

import { registerCommand } from '@/services/commandRegistry';

/**
 * Register a trusted extension's commands directly into `commandRegistry`. The
 * `run` handler is resolved from `module.commands[entryRef]` and called
 * in-process (no postMessage bridge, unlike the sandbox tier).
 */
export function registerTrustedExtensionCommands(
  manifest: ExtensionManifest,
  module: ExtensionModule,
): Disposable {
  const commands: CommandContribution[] = manifest.contributes?.commands ?? [];
  if (commands.length === 0) return { dispose: () => {} };

  const disposables: Disposable[] = [];
  for (const cmd of commands) {
    const handler = module.commands?.[cmd.run];
    if (typeof handler !== 'function') {
      console.warn(
        `[extension-host] extension "${manifest.id}" command "${cmd.id}" has no handler for entry-ref "${cmd.run}" — skipped`,
      );
      continue;
    }
    const fullId = `extension.${manifest.id}.${cmd.id}`;
    const d = registerCommand(
      {
        id: fullId,
        title: cmd.title,
        category: 'action',
        icon: cmd.icon,
        keywords: cmd.keywords,
        run: handler,
      },
      manifest.id,
    );
    disposables.push(d);
  }
  return mergeDisposables(disposables);
}

// ── File-type adapter ───────────────────────────────────────────────────────

import { registerFileTypeHandler } from '@/components/file-types/registry';

/**
 * Register a trusted extension's file-type handlers. Each
 * `contributes.fileTypes[]` entry's `handler` entry-ref indexes into
 * `module.handlers`. The handler must be a complete `FileTypeHandler`
 * (including `extensions`, `supportedViewModes`, etc.).
 */
export function registerExtensionFileTypes(
  manifest: ExtensionManifest,
  module: ExtensionModule,
): Disposable {
  const fileTypes = manifest.contributes?.fileTypes ?? [];
  if (fileTypes.length === 0) return { dispose: () => {} };

  const disposables: Disposable[] = [];
  for (const ft of fileTypes) {
    const handler = module.handlers?.[ft.handler];
    if (!handler) {
      console.warn(
        `[extension-host] extension "${manifest.id}" file-type "${ft.id}" has no handler for entry-ref "${ft.handler}" — skipped`,
      );
      continue;
    }
    // Ensure the handler's id matches the contribution id (defensive: the
    // extension author may have set a different id in the handler object).
    const merged: FileTypeHandler = { ...handler, id: ft.id, extensions: ft.extensions };
    // Wrap the extension's mode components in an error boundary at the
    // registration chokepoint so a render throw is isolated to this file-type
    // surface and never white-screens the host.
    if (merged.modes) {
      merged.modes = merged.modes.map((mode) => {
        if (mode.kind === 'component' && mode.component) {
          return {
            ...mode,
            component: withExtensionBoundary(mode.component, manifest.id, `file-type:${ft.id}:${mode.id}`),
          };
        }
        return mode;
      });
    }
    // Merge manifest-declared default mode if the handler doesn't declare one.
    if (ft.defaultViewMode && !merged.defaultMode) {
      merged.defaultMode = ft.defaultViewMode as FileTypeHandler['defaultMode'];
    }
    // Merge manifest-declared view modes into the handler's modes so the
    // shell's mode switcher surfaces them. Only append modes the handler
    // doesn't already declare.
    if (ft.supportedViewModes?.length) {
      const have = new Set((merged.modes ?? []).map((m) => m.id));
      const extras = ft.supportedViewModes
        .filter((m) => !have.has(m))
        .map((m) => ({ id: m, kind: 'component' as const, component: undefined }));
      if (extras.length) merged.modes = [...(merged.modes ?? []), ...extras];
    }
    const d = registerFileTypeHandler(merged, manifest.id);
    disposables.push({ dispose: () => d.dispose() });
  }
  return mergeDisposables(disposables);
}

// ── Container adapter ───────────────────────────────────────────────────────

import { ContainerRegistry } from '@folyn/container-extensions';
import { readExtensionFile } from './trustedLoader';

/**
 * Resolve a container `icon` field to the string the registry will store.
 *
 * - `.svg` file path → host reads the file from the extension install dir.
 *   On failure, warn + return '' (slash menu renders empty; never crashes).
 * - Anything else (inline `<svg>...</svg>` or emoji) → returned as-is; the
 *   slash-menu dispatcher branches on the `<svg` prefix at render time.
 *
 * ponytail: per-container `Promise.all` is fine — activation is rare and
 * bounded by the manifest's container count; no caching layer needed.
 */
async function resolveContainerIcon(
  manifest: ExtensionManifest,
  icon: string,
): Promise<string> {
  if (icon.endsWith('.svg')) {
    try {
      return await readExtensionFile(manifest.id, icon);
    } catch (err) {
      console.warn(
        `[extension-host] extension "${manifest.id}" container icon "${icon}" could not be read — falling back to empty`,
        err,
      );
      return '';
    }
  }
  return icon;
}

/**
 * Register a trusted extension's container directives into `ContainerRegistry`.
 * The contribution's `component` entry-ref resolves to a React component
 * exported by the extension module. A `ContainerExtension` object is built from the
 * manifest's declarative fields + the resolved component.
 *
 * Async because each container's `icon` may be a `.svg` file path that the
 * host must read from the extension install dir before registration. The
 * trusted loader awaits this in `activate`.
 */
export async function registerExtensionContainers(
  manifest: ExtensionManifest,
  module: ExtensionModule,
): Promise<Disposable> {
  const containers: ContainerContribution[] = manifest.contributes?.containers ?? [];
  if (containers.length === 0) return { dispose: () => {} };

  const registry = ContainerRegistry.getInstance();
  const disposables: Disposable[] = [];
  const resolved = await Promise.all(
    containers.map(async (c) => ({
      c,
      icon: c.icon ? await resolveContainerIcon(manifest, c.icon) : '',
    })),
  );
  for (const { c, icon } of resolved) {
    const component = module.containers?.[c.component];
    if (!component) {
      console.warn(
        `[extension-host] extension "${manifest.id}" container "${c.name}" has no component for entry-ref "${c.component}" — skipped`,
      );
      continue;
    }
    const extension = {
      name: c.name,
      icon,
      label: c.label,
      category: (c.category ?? 'custom') as ContainerCategory,
      component,
      template: c.template,
      description: c.description,
    };
    // register() now returns a Disposable (owned by manifest.id); no need to
    // track names manually for cleanup.
    disposables.push(registry.register(extension, manifest.id));
  }
  return mergeDisposables(disposables);
}
