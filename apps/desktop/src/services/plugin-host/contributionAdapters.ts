/**
 * In-process contribution adapters for trusted-tier plugins.
 *
 * Trusted plugins are `import()`-ed into the host realm (see `trustedLoader`),
 * so their contributions resolve to real React components / handlers — not
 * postMessage proxies. Each adapter maps a manifest contribution array into
 * the matching app registry (`commandRegistry` / `file-types` /
 * `ContainerRegistry`) and returns a single
 * `Disposable` that unregisters everything on plugin deactivate/uninstall.
 *
 * The plugin module's export shape (the contract a trusted plugin authors
 * against):
 *
 * ```ts
 * // index.js — a self-contained ESM bundle (no remote imports)
 * import type { FileTypeHandler, ContainerPlugin, ... } from '@quill/plugin-host';
 * import type { ComponentType } from 'react';
 *
 * // Named export maps keyed by the manifest's entry-ref strings.
 * export const handlers: Record<string, FileTypeHandler> = { 'default': { ... } };
 * export const containers: Record<string, ComponentType> = { 'callout': MyComp };
 * export const commands: Record<string, () => void | Promise<void>> = { 'greet': () => {} };
 *
 * // Optional lifecycle hooks (also accepted as a default-export factory).
 * export function activate(ctx: PluginContext) { ... }
 * export function deactivate() { ... }
 * ```
 *
 * Entry-refs in the manifest (`handler: 'default'`, `component: 'callout'`,
 * `run: 'greet'`) index into these maps. An entry-ref that is missing from
 * the module's exports is skipped with a console warning (best-effort: a
 * partial plugin should still load its other contributions).
 */

import type { ComponentType } from 'react';
import type { Disposable, PluginManifest, PluginContext } from '@quill/plugin-host';
import type {
  CommandContribution,
  ContainerContribution,
} from '@quill/plugin-host';
import type { FileTypeHandler } from '@/components/file-types/types';
import type { ContainerProps, ContainerCategory } from '@quill/container-plugins';

/**
 * The resolved exports of a trusted plugin's ESM bundle. All maps are
 * optional — a plugin may contribute only commands, only file-types, etc.
 */
export interface PluginModule {
  /** Entry-ref → file-type handler. Keys match `contributes.fileTypes[].handler`. */
  handlers?: Record<string, FileTypeHandler>;
  /** Entry-ref → React component. Keys match `contributes.containers[].component`. */
  containers?: Record<string, ComponentType<ContainerProps>>;
  /** Entry-ref → command handler. Keys match `contributes.commands[].run`. */
  commands?: Record<string, () => void | Promise<void>>;
  /** Optional lifecycle hook; called by the trusted loader on activate. */
  activate?: (ctx: PluginContext) => void | Promise<void>;
  /** Optional lifecycle hook; called by the trusted loader on deactivate. */
  deactivate?: (ctx: PluginContext) => void | Promise<void>;
}

/** Merge a list of disposables into one. */
function mergeDisposables(disposables: Disposable[]): Disposable {
  return {
    dispose: async () => {
      for (const d of disposables) {
        try {
          await d.dispose();
        } catch (err) {
          console.error('[plugin-host] contribution dispose failed:', err);
        }
      }
    },
  };
}

// ── Command adapter (in-process) ────────────────────────────────────────────

import { registerCommand } from '@/services/commandRegistry';

/**
 * Register a trusted plugin's commands directly into `commandRegistry`. The
 * `run` handler is resolved from `module.commands[entryRef]` and called
 * in-process (no postMessage bridge, unlike the sandbox tier).
 */
export function registerTrustedPluginCommands(
  manifest: PluginManifest,
  module: PluginModule,
): Disposable {
  const commands: CommandContribution[] = manifest.contributes?.commands ?? [];
  if (commands.length === 0) return { dispose: () => {} };

  const disposables: Disposable[] = [];
  for (const cmd of commands) {
    const handler = module.commands?.[cmd.run];
    if (typeof handler !== 'function') {
      console.warn(
        `[plugin-host] plugin "${manifest.id}" command "${cmd.id}" has no handler for entry-ref "${cmd.run}" — skipped`,
      );
      continue;
    }
    const fullId = `plugin.${manifest.id}.${cmd.id}`;
    const d = registerCommand({
      id: fullId,
      title: cmd.title,
      category: 'action',
      icon: cmd.icon,
      keywords: cmd.keywords,
      run: handler,
    });
    disposables.push(d);
  }
  return mergeDisposables(disposables);
}

// ── File-type adapter ───────────────────────────────────────────────────────

import { registerFileTypeHandler } from '@/components/file-types/registry';

/**
 * Register a trusted plugin's file-type handlers. Each
 * `contributes.fileTypes[]` entry's `handler` entry-ref indexes into
 * `module.handlers`. The handler must be a complete `FileTypeHandler`
 * (including `extensions`, `supportedViewModes`, etc.).
 */
export function registerPluginFileTypes(
  manifest: PluginManifest,
  module: PluginModule,
): Disposable {
  const fileTypes = manifest.contributes?.fileTypes ?? [];
  if (fileTypes.length === 0) return { dispose: () => {} };

  const disposables: Disposable[] = [];
  for (const ft of fileTypes) {
    const handler = module.handlers?.[ft.handler];
    if (!handler) {
      console.warn(
        `[plugin-host] plugin "${manifest.id}" file-type "${ft.id}" has no handler for entry-ref "${ft.handler}" — skipped`,
      );
      continue;
    }
    // Ensure the handler's id matches the contribution id (defensive: the
    // plugin author may have set a different id in the handler object).
    const merged: FileTypeHandler = { ...handler, id: ft.id, extensions: ft.extensions };
    if (ft.defaultViewMode && !merged.defaultViewMode) {
      merged.defaultViewMode = ft.defaultViewMode as FileTypeHandler['defaultViewMode'];
    }
    const d = registerFileTypeHandler(merged);
    disposables.push({ dispose: () => d.dispose() });
  }
  return mergeDisposables(disposables);
}

// ── Container adapter ───────────────────────────────────────────────────────

import { ContainerRegistry } from '@quill/container-plugins';

/**
 * Register a trusted plugin's container directives into `ContainerRegistry`.
 * The contribution's `component` entry-ref resolves to a React component
 * exported by the plugin module. A `ContainerPlugin` object is built from the
 * manifest's declarative fields + the resolved component.
 */
export function registerPluginContainers(
  manifest: PluginManifest,
  module: PluginModule,
): Disposable {
  const containers: ContainerContribution[] = manifest.contributes?.containers ?? [];
  if (containers.length === 0) return { dispose: () => {} };

  const registry = ContainerRegistry.getInstance();
  const registeredNames: string[] = [];
  for (const c of containers) {
    const component = module.containers?.[c.component];
    if (!component) {
      console.warn(
        `[plugin-host] plugin "${manifest.id}" container "${c.name}" has no component for entry-ref "${c.component}" — skipped`,
      );
      continue;
    }
    const plugin = {
      name: c.name,
      icon: c.icon,
      label: c.label,
      category: (c.category ?? 'custom') as ContainerCategory,
      component,
      template: c.template,
      description: c.description,
    };
    registry.register(plugin);
    registeredNames.push(c.name);
  }
  return {
    dispose: async () => {
      for (const name of registeredNames) {
        registry.unregister(name);
      }
    },
  };
}
