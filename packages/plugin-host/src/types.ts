/**
 * Plugin SDK type contract — manifest schema, lifecycle, contribution points.
 *
 * This file is the public surface plugin authors program against. It is
 * framework-agnostic: contribution points declare entry references (strings)
 * that a {@link PluginLoader} resolves to real functions/components at runtime,
 * so the kernel package has no React dependency.
 *
 * Tier model (see prd.md ADR-lite):
 * - `sandbox`: untrusted plugin hosted in a sandboxed iframe (`quill-plugin://`
 *   origin), talks to the host via a vetted postMessage RPC. No raw Tauri APIs.
 * - `trusted`: TOFU-pinned plugin `import()`-ed into the host realm; may
 *   contribute inline React/CodeMirror components and receive scoped Tauri
 *   capability grants via `add_capability`.
 */

import type { Disposable } from './Disposable';

/** Execution tier — determines loader, isolation, and capability surface. */
export type PluginTier = 'sandbox' | 'trusted';

/**
 * Runtime plugin object produced by a {@link PluginLoader}. `activate`/
 * `deactivate` are optional; the host guards with optional chaining so a
 * plugin that needs no explicit lifecycle still loads.
 */
export interface Plugin {
  readonly manifest: PluginManifest;
  activate?(ctx: PluginContext): Promise<void> | void;
  deactivate?(ctx: PluginContext): Promise<void> | void;
}

/** Host-provided context passed to `activate`/`deactivate`. */
export interface PluginContext {
  readonly pluginId: string;
  readonly manifest: PluginManifest;
  /** Register a disposable for automatic cleanup. Idempotent. */
  addDisposable(d: Disposable): void;
  // Capability RPC + UI contribution adapters are layered on in PR2 (sandbox)
  // and PR3 (trusted); kept out of PR1 so the kernel is testable in isolation.
}

/**
 * Strategy that resolves an installed manifest into a runtime {@link Plugin}.
 * One loader per {@link PluginTier}. PR1 tests inject a fake; PR2/PR3 provide
 * the real sandbox-iframe and trusted-`import()` loaders.
 */
export interface PluginLoader {
  readonly tier: PluginTier;
  load(manifest: PluginManifest): Promise<Plugin>;
}

export type PluginState = 'installed' | 'active' | 'inactive' | 'failed';

/** Internal record held by {@link PluginHost}. */
export interface PluginRecord {
  manifest: PluginManifest;
  state: PluginState;
  /** Resolved lazily on first activation; cleared on deactivate. */
  plugin?: Plugin;
  /** Disposables registered during the current activation. */
  disposables: Disposable[];
  /** Last error if `state === 'failed'`, for diagnostics UI. */
  error?: unknown;
}

// ── Manifest ───────────────────────────────────────────────────────────────

export interface PluginManifest {
  /** Globally-unique kebab-case id. */
  id: string;
  name: string;
  version: string;
  author?: string;
  /** Engine compat, e.g. `>=0.1.0`. */
  quill?: string;
  tier: PluginTier;
  /** Entry module path (resolved by the loader against the plugin origin). */
  main: string;
  /** Sandbox-tier HTML UI entry. Required when `tier === 'sandbox'`. */
  html?: string;
  permissions?: PluginPermissions;
  contributes?: ContributionPoints;
  activation?: ActivationEvents;
}

// ── Permissions (declarative; host enforces) ───────────────────────────────

export interface PluginPermissions {
  fs?: { scope: string[] };
  http?: { origins: string[] };
  clipboard?: boolean;
  dialog?: boolean;
  window?: boolean;
  vault?: { readActive?: boolean; insertContent?: boolean };
}

// ── Contribution points ────────────────────────────────────────────────────
//
// Each declaration is a plain data descriptor; the host adapts it into the
// matching app registry (commandRegistry / file-types / ContainerRegistry /
// feature panel / tool window). Entry refs are strings resolved by the loader
// so this file stays React-free.

export interface CommandContribution {
  id: string;
  title: string;
  icon?: string;
  keywords?: string[];
  /** Entry ref to the handler function. */
  run: string;
}

export interface FileTypeContribution {
  id: string;
  extensions: string[];
  /** Entry ref to a component or 'default' to reuse built-in rendering. */
  handler: string;
  defaultViewMode?: string;
}

export interface ContainerContribution {
  /** Directive name, e.g. `callout`. */
  name: string;
  icon: string;
  label: string;
  category?: string;
  /** Entry ref to the renderer component. */
  component: string;
  template: string;
  description?: string;
}

export interface FeatureContribution {
  id: string;
  /** Where the panel mounts: 'left' | 'right' | 'bottom'. */
  panel: 'left' | 'right' | 'bottom';
  /** Entry ref to the panel component. */
  component: string;
}

export interface ToolContribution {
  id: string;
  title: string;
  icon?: string;
  /** Open in its own window (true) or inline panel (false). */
  window: boolean;
  /** Entry ref to the tool UI (HTML for sandbox, component for trusted). */
  entry: string;
}

export interface ContributionPoints {
  commands?: CommandContribution[];
  fileTypes?: FileTypeContribution[];
  containers?: ContainerContribution[];
  features?: FeatureContribution[];
  tools?: ToolContribution[];
}

export interface ActivationEvents {
  onCommand?: string;
  onFileType?: string[];
  onLanguage?: string[];
}
