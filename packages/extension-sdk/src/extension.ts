/**
 * Extension runtime contracts — the stable surface a Folyn Extension programs
 * against (doc §4–§7).
 *
 * Framework-agnostic: no React, no Tauri, no Folyn internal stores. Type-only
 * surface so the SDK stays publishable with no runtime deps. Concrete capability
 * implementations (real vault/files/editor/ai/terminal/export) are layered on
 * by the host in a later phase; the interface is fixed now.
 */

import type { Disposable } from './Disposable';
import type { ExtensionManifest, ExtensionAiCapability, ExtensionEnv, ExtensionHttpCapability } from './types';
import type { ExportService } from './export-service';

// ── Extension entry (doc §4.1) ──────────────────────────────────────────────

/**
 * The runtime entry of an extension. `activate(api, ctx)` registers
 * contributions; `deactivate?(ctx)` is an optional cleanup hook.
 */
export interface Extension {
  activate(api: ExtensionApi, ctx: ExtensionContext): Promise<void> | void;
  deactivate?(ctx: ExtensionContext): Promise<void> | void;
}

/**
 * Strategy that resolves an installed manifest into a runtime {@link Extension}.
 * One loader per tier. The host injects a fake in tests; the real
 * sandbox-iframe and trusted-`import()` loaders live in the desktop app.
 */
export interface ExtensionLoader {
  readonly tier: 'trusted' | 'sandbox';
  load(manifest: ExtensionManifest): Promise<Extension>;
}

// ── Manifest (doc §4.2) ────────────────────────────────────────────────────
// The manifest schema lives in `./types` (`ExtensionManifest`); the runtime
// adds nothing here yet.

// ── Logger (doc §6) ─────────────────────────────────────────────────────────

export interface ExtensionLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, error?: Error): void;
}

// ── Vault context (doc §6) ───────────────────────────────────────────────────

/** Logical vault identity — `path` is a stable id, never a physical FS path. */
export interface VaultContext {
  readonly name: string;
  readonly path: string;
}

// ── UI context (doc §7) ─────────────────────────────────────────────────────

/** Base UI context — available to every extension tier. */
export interface ExtensionUIContext {
  readonly dialogs: DialogApi;
  readonly notifications: NotificationApi;
}

export interface DialogApi {
  info(message: string): Promise<void>;
  confirm(message: string): Promise<boolean>;
}

export interface NotificationApi {
  show(message: string, kind?: 'info' | 'warn' | 'error'): void;
}

/** Tool-extension UI surface (ActivityBar/Workspace). Adds `workspace`. */
export interface ToolExtensionUIContext extends ExtensionUIContext {
  readonly workspace: WorkspaceApi;
}

/** FileType-extension UI surface. Adds `presentation`. */
export interface FileTypeExtensionUIContext extends ExtensionUIContext {
  readonly presentation: PresentationApi;
}

// WorkspaceApi is real (doc §7.1, §32). PresentationApi stays opaque until
// the FileType/Presentation P1 follow-up wires it; it exists here so the
// typed UI-context tier split is real, not a TODO comment.

/** A Tool Extension workspace registration (doc §32). Registering one
 * auto-forms an ActivityBar item + the active Main View. The component is
 * resolved by the host from the contribution (declarative manifest entry-ref
 * OR a runtime factory) — kept as an opaque slot so the SDK has no React dep;
 * the host narrows it to a ComponentType. */
export interface WorkspaceContribution {
  id: string;
  title: string;
  /** Inline SVG string / ThemeIcon name / emoji. */
  icon?: string;
  /** Sort key within the activity bar (built-ins: files=0, wiki=10, …). */
  order?: number;
  /** Optional badge (text dot) when present. */
  badge?: string | number;
  /** Host-resolved view (ComponentType at runtime; opaque in the SDK). */
  view?: unknown;
}

/** Runtime Workspace surface for Tool Extensions (doc §7.1, §32). */
export interface WorkspaceApi {
  register(contribution: WorkspaceContribution): Disposable;
  open(id: string): void;
  close(id: string): void;
  toggle(id: string): void;
}

export interface PresentationApi {
  // P1: FileTypeProvider/PresentationMode. Opaque in P0.
}

// ── ExtensionContext (doc §6) ────────────────────────────────────────────────

export interface ExtensionContext {
  readonly extensionId: string;
  readonly extensionPath: string;
  readonly manifest: ExtensionManifest;

  readonly vault: VaultContext;
  readonly ui: ExtensionUIContext;

  /** Aborts when the runtime is deactivated / reloaded / vault switches. */
  readonly signal: AbortSignal;
  readonly logger: ExtensionLogger;

  addDisposable(disposable: Disposable): void;

  /** Resolve a file inside this extension's own `folyn-extension://` origin
   *  (e.g. `'preview.html'`, `'dbml-preview.html'`) to a URL the webview
   *  can navigate to as an iframe `src`. The raw `folyn-extension://`
   *  form is navigable on macOS/Linux (WKWebView) but NOT on Windows/Android
   *  WebView2, where a custom scheme is only fetchable as a sub-resource and
   *  cannot be a top-level document unless registered as a privileged scheme
   *  (CoreWebView2CustomSchemeRegistration — Tauri/wry does not do this;
   *  tauri-apps/tauri#10667). There the host rewrite is
   *  `http://folyn-extension.localhost/<id>/<file>` (the same rule Tauri's
   *  runtime applies in `convertFileSrc`). Use this for every iframe `src`
   *  into the extension origin; never hardcode `folyn-extension://localhost`.
   *  `file` is relative to the extension's served root (the `dist/` the
   *  scheme serves), MUST NOT start with `/`, and is appended verbatim. */
  resolveAssetUrl(file: string): string;
}

// ── ExtensionApi (doc §5) ───────────────────────────────────────────────────
//
// The capability boundary. P0 fixes the interface; concrete capability
// objects are injected by the host (Phase 2 wires real vault/files/editor/ai/
// terminal/export). Loaders receive `api` and forward it to the extension
// module's lifecycle hook.

/**
 * Vault-scoped filesystem access. All paths are vault-relative (or, for
 * {@link toAssetUrl}/{@link resolvePath}, vault-rooted). Extensions never
 * receive other vaults' physical paths (doc §5.2).
 */
export interface VaultApi {
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<Uint8Array>;
  writeText(path: string, content: string): Promise<void>;
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  /**
   * Convert an absolute filesystem path to a loadable URL the webview can
   * render (Tauri `asset://` via `convertFileSrc`). Non-Tauri runtimes
   * (jsdom tests) return the input path unchanged. Use for `<img src>` etc.
   * in custom editors that persist vault-relative asset paths to disk.
   */
  toAssetUrl(fsPath: string): string;
  /**
   * Resolve a path that may start with `~` or `$HOME` to an absolute
   * filesystem path (Tauri `homeDir()` lookup, cached on the host side).
   * Use to expand the vault root before joining with a vault-relative
   * asset directory (e.g. `imagePath`). Returns the input unchanged on
   * non-Tauri runtimes.
   */
  resolvePath(path: string): Promise<string>;
}

/**
 * Read-only access to host-managed vault-level user settings. Lets a
 * file-type extension (e.g. rich-text image persistence) honor the user's
 * vault config without a direct store import (doc §5.1).
 */
export interface VaultConfigApi {
  /**
   * Vault-relative directory where image uploads are persisted
   * (default `'assets/images/'`, trailing `/` trimmed). The directory may
   * not exist yet — the caller is responsible for `mkdir({recursive})`.
   */
  getImagePath(): string;
}

export interface FileApi {
  open(path: string, opts?: { providerId?: string; mode?: string }): Promise<void>;
}

export interface EditorApi {
  getSelection(): { text: string; startLine: number; startCol: number; endLine: number; endCol: number } | null;
  replaceSelection(text: string): Promise<void>;
}

export interface WorkspaceContextApi {
  // P1 surface; opaque in P0.
}

export interface CommandRegistryApi {
  register(contribution: CommandContributionApi): Disposable;
}

export interface CommandContributionApi {
  id: string;
  title: string;
  icon?: string;
  execute(context: CommandContext): Promise<void> | void;
}

export interface CommandContext {
  activeFile: { path: string; fileType?: string } | null;
}

export interface EventApi {
  on(event: string, handler: (payload: unknown) => void): Disposable;
  emit(event: string, payload: unknown): void;
}

export interface ExtensionStorageApi {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

// AI / network(http) / env capabilities — real types (the existing
// ExtensionAi/ExtensionHttp/ExtensionEnv surfaces the host wires in createExtensionApi).
export type AiApi = ExtensionAiCapability;
export type NetworkApi = ExtensionHttpCapability;
export type EnvApi = ExtensionEnv;
export interface TerminalApi {
  /** Open the terminal dock (creates a session if none exists). */
  open(): void;
  /** Close/collapse the terminal dock. */
  close(): void;
  /** Create a new terminal session; returns the session id. */
  createSession(): string;
}

export interface FileTypeRegistryApi {
  register(provider: unknown, ownerExtensionId: string): Disposable;
  resolve(path: string): unknown;
}

export interface ExporterRegistryApi {
  register(registration: unknown, ownerExtensionId: string): Disposable;
  list(fileType?: string): unknown[];
}

export interface ExtensionApi {
  readonly vault: VaultApi;
  readonly vaultConfig: VaultConfigApi;
  readonly files: FileApi;
  readonly editor: EditorApi;
  readonly workspace: WorkspaceContextApi;

  readonly commands: CommandRegistryApi;
  readonly events: EventApi;
  readonly storage: ExtensionStorageApi;

  readonly ai: AiApi;
  readonly network: NetworkApi;
  readonly env: EnvApi;
  readonly terminal: TerminalApi;
  readonly export: ExportService;

  readonly fileTypes: FileTypeRegistryApi;
  readonly exporters: ExporterRegistryApi;
}
