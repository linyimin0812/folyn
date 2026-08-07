/**
 * Plugin SDK type contract — manifest schema, lifecycle, contribution points.
 *
 * This file is the public surface plugin authors program against. It is
 * framework-agnostic: contribution points declare entry references (strings)
 * that a {@link PluginLoader} resolves to real functions/components at runtime,
 * so the SDK package has no runtime dependency (React types are peer-only,
 * erased at build for type-only consumers).
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
  /**
   * Host-mediated AI capability. Present when the host wires it (trusted
   * tier in PR2; sandbox via rpcBridge in PR3). Plugins must declare
   * `permissions.ai` in manifest; calls throw otherwise. `undefined` on
   * tiers that do not provide AI access.
   */
  readonly ai?: PluginAiCapability;
  /**
   * Host environment: resolved theme + current locale. Present on the trusted
   * tier (wired by `trustedLoader`); sandbox tier reaches the same data via
   * the `env:get` RPC method + `env-event` push messages. `undefined` only on
   * tiers that do not expose env.
   */
  readonly env?: PluginEnv;
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
  /** Optional ed25519 signature over the canonicalized manifest (base64). MVP:
   * not enforced; verified best-effort on the Rust side. See
   * docs/plugin-development.md "Integrity upgrade path". */
  signature?: string;
  /** Optional base64 ed25519 public key paired with `signature`. */
  publisherPublicKey?: string;
}

// ── Permissions (declarative; host enforces) ───────────────────────────────

export interface PluginPermissions {
  fs?: { scope: string[] };
  http?: { origins: string[] };
  clipboard?: boolean;
  dialog?: boolean;
  window?: boolean;
  vault?: { readActive?: boolean; insertContent?: boolean };
  /**
   * AI capability grant. Host mediates all AI access (chat_stream + feature
   * agents) through this declaration; undeclared `ai.*` calls throw.
   *
   * - `chat`: allow `PluginContext.ai.chat` (sandbox + trusted).
   * - `agents`: whitelist of feature names the plugin may drive via
   *   `PluginContext.ai.agent` (trusted only — sandbox cannot reach feature
   *   agents). Empty/absent = no agent calls.
   * - `edit`: allow `PluginContext.ai.editFile` / `createFile` (trusted only).
   *   Host applies the resulting file changes through the shared editor/vault
   *   chokepoint; the plugin never writes the filesystem directly.
   */
  ai?: { chat?: boolean; agents?: string[]; edit?: boolean };
}

// ── Plugin env (theme + locale) ─────────────────────────────────────────────
//
// Plugins that render UI need to track the host's resolved theme and current
// locale, and react when the user switches either mid-session. The host
// signals the current values and pushes change events; plugins bring their
// own i18n bundles and styling keyed off `theme` — host's `t()`/message
// catalog is NOT exposed.

/** Resolved theme name. `'system'` is resolved to 'light'|'dark' by the host
 * before delivery, so plugins never see 'system'. */
export type PluginTheme = 'light' | 'dark';

/**
 * Locale identifier string (e.g. 'zh', 'en'). Typed as a generic string so
 * the publishable SDK has no dependency on the desktop app's locale union —
 * the host narrows to its supported set at runtime, plugins handle whatever
 * string arrives.
 */
export type PluginLocale = string;

export interface PluginEnv {
  /** Resolved current theme. */
  readonly theme: PluginTheme;
  /** Current locale identifier. */
  readonly locale: PluginLocale;
  /** Subscribe to subsequent theme changes. Returns a Disposable. */
  onThemeChange(cb: (theme: PluginTheme) => void): Disposable;
  /** Subscribe to subsequent locale changes. Returns a Disposable. */
  onLocaleChange(cb: (locale: PluginLocale) => void): Disposable;
}

// ── AI capability (host-mediated) ─────────────────────────────────────────────
//
// Plugin authors call `ctx.ai.chat` / `ctx.ai.agent`. The host implementation
// (PR2: trusted — wraps runRigChat / runFeatureAgent; PR3: sandbox — same
// methods over rpcBridge postMessage) enforces manifest.permissions.ai before
// forwarding to the shared AI chokepoints. Provider/model/apiKey are never
// exposed — host uses the user's configured defaults.

/** Subset of {@link CliStreamEvent} a plugin may observe. Tool / file-change
 * events are filtered out by the host before delivery. */
export type PluginAiEventType = 'text' | 'thinking' | 'error' | 'done';

export interface PluginAiStreamEvent {
  type: PluginAiEventType;
  content?: string;
}

export type PluginAiEventHandler = (event: PluginAiStreamEvent) => void;

export interface PluginAiChatParams {
  /** Plugin-managed session id (plugin owns persistence/history). */
  sessionId: string;
  prompt: string;
  onEvent: PluginAiEventHandler;
  /** When true, the host also surfaces the turn in aiPanel (aiStore session).
   * Defaults to false (plugin-only, not in UI). */
  useSharedSession?: boolean;
}

export interface PluginAiAgentParams {
  /** Feature name — must be in `permissions.ai.agents` whitelist. */
  feature: string;
  instruction: string;
  onEvent: PluginAiEventHandler;
}

/** Params for {@link PluginAiCapability.editFile} — modify an existing file. */
export interface PluginAiEditFileParams {
  /** Vault-relative path of the file to modify. */
  path: string;
  /** Natural-language instruction describing the desired change. */
  instruction: string;
  onEvent: PluginAiEventHandler;
}

/** Params for {@link PluginAiCapability.createFile} — create a new file. */
export interface PluginAiCreateFileParams {
  /** Vault-relative path of the file to create (overwrites if present). */
  path: string;
  /** Natural-language instruction describing the file to create. */
  instruction: string;
  onEvent: PluginAiEventHandler;
}

export interface PluginAiCapability {
  /** Stream a multi-turn chat turn through the host's configured provider.
   * Rejects if `permissions.ai.chat` is not declared. */
  chat(params: PluginAiChatParams): Promise<void>;
  /** Drive a registered feature agent (trusted tier only). Rejects if the
   * feature is not in `permissions.ai.agents`. */
  agent(params: PluginAiAgentParams): Promise<void>;
  /** Apply an AI-driven edit to an existing vault file (trusted tier only).
   * The host streams progress via `onEvent` and applies the change through the
   * shared editor chokepoint. Rejects if `permissions.ai.edit` is not declared. */
  editFile(params: PluginAiEditFileParams): Promise<void>;
  /** Create a new vault file from an AI instruction (trusted tier only).
   * Rejects if `permissions.ai.edit` is not declared. */
  createFile(params: PluginAiCreateFileParams): Promise<void>;
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
  /**
   * Optional view modes this handler supports (incl. custom mode ids). When
   * present, merged into the registered handler's `supportedViewModes` so the
   * shell's view-mode switcher surfaces them. Built-in ids: split/edit/preview/
   * visual/source; plugins may declare custom ids (e.g. 'canvas').
   */
  supportedViewModes?: string[];
}

export interface ContainerContribution {
  /** Directive name, e.g. `callout`. */
  name: string;
  /**
   * Container icon shown in the `/` slash menu. Three accepted forms:
   *
   * 1. Inline SVG string (`<svg ...>...</svg>`) — rendered verbatim via the
   *    host's `IconFromSvg`. Recommended for self-contained plugin icons.
   * 2. `.svg` file path relative to the plugin install dir — the host reads
   *    the file at activate via `read_plugin_file` and stores the resolved
   *    SVG string. Missing file → warn + empty fallback (no crash).
   * 3. Emoji / short string (fallback) — rendered as plain text. Preserves
   *    the original builtin convention (e.g. `💡`).
   */
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
  /**
   * Where the panel mounts: 'left' | 'right' | 'bottom'.
   *
   * MVP hosts `left` only; `right`/`bottom` are warned + skipped (see
   * featureAdapter.ts). Right/bottom shell slots are a follow-up task.
   */
  panel: 'left' | 'right' | 'bottom';
  /** Entry ref to the panel component (resolved via `PluginModule.features`). */
  component: string;
  /**
   * Panel icon — REQUIRED. Either a raw inline SVG string (`<svg ...>...</svg>`,
   * rendered verbatim via `IconFromSvg`) or a `ThemeIcon` name (resolved against
   * host `assets/icons/*.svg`).
   */
  icon: string;
  /** Panel title (shown in the activity bar tooltip + accessibility label). */
  title?: string;
  /** Sort key within the activity bar. Built-ins: files=0, wiki=10, clips=20, analyze=30, calendar=40. */
  order?: number;
  /** Optional badge rendered as a small text dot when present. */
  badge?: string | number;
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

// ── Exporter contribution ──────────────────────────────────────────────────
// Adds a custom file export format to the export menu / exportService. The
// `run` entry-ref resolves (via `PluginModule.exporters`) to a function that
// takes the active doc content + ctx and returns a Blob/string to write.

export interface ExporterContribution {
  id: string;
  /** Output format id, e.g. `pdf`, `docx`. Globally unique within a plugin. */
  format: string;
  /** Menu label, e.g. `Export as PDF`. */
  label: string;
  /** Output file extension without dot, e.g. `pdf`. */
  fileExtension: string;
  /** Entry ref to the exporter function (indexed by `PluginModule.exporters`). */
  run: string;
  /**
   * Optional file-type id this exporter applies to. When set, the host only
   * surfaces the menu entry for tabs whose `fileType` matches (so a `.puml`-only
   * SVG exporter doesn't show on markdown, etc.). When absent, applies to all
   * file types (backward-compat).
   */
  fileType?: string;
}

// ── File-template contribution (new-file submenu) ──────────────────────────
// Adds a secondary entry to the file-tree right-click "新建" submenu. Selecting
// it creates a new file at the chosen path seeded with `template`.

export interface FileTemplateContribution {
  id: string;
  /** Submenu label, e.g. `New DBML diagram`. */
  label: string;
  /** Default file name (without directory), e.g. `untitled.dbml`. */
  fileName: string;
  /** Initial file content. */
  template: string;
  /** Optional emoji/ThemeIcon for the submenu row. */
  icon?: string;
}

// ── Keybinding contribution ────────────────────────────────────────────────
// Binds a key to a command id (a plugin-contributed command or a built-in).
// `key` is a Tauri accelerator string (e.g. `Cmd+Shift+P`). `mac` overrides
// for macOS; `when` is an optional activation clause (kept as an opaque
// string for forward-compat — MVP registers globally).

export interface KeybindingContribution {
  /** Command id to invoke (e.g. `plugin.my-plugin.greet` or a built-in id). */
  command: string;
  /** Tauri accelerator, e.g. `Cmd+Shift+K`. */
  key: string;
  /** macOS-specific accelerator override. */
  mac?: string;
  /** Optional activation clause (opaque string; reserved for `when` contexts). */
  when?: string;
}

// ── Export-enhancer contribution (post-render DOM mutation) ─────────────────
// Lets a trusted plugin post-process its own `:::name` container (or a
// file-extension preview) during HTML/PDF export, after the in-DOM render has
// settled. The handler runs host-realm on the rendered HTMLElement and mutates
// it in place to be self-contained for export (e.g. canvas→SVG capture).

export interface ExportEnhancerContribution {
  /**
   * Key the enhancer matches on: a `:::` container directive `name`, OR a
   * file extension (without the dot). The host tries both lookups so a single
   * enhancer can serve either surface.
   */
  name: string;
  /** Entry ref into `PluginModule.exportEnhancers`. */
  run: string;
}

export interface MarkdownCodeRendererContribution {
  /** Fenced-block language id, e.g. `plantuml` or `mermaid`. */
  language: string;
  /** Alternate fence languages that also dispatch to this renderer. */
  aliases?: string[];
  /** Entry ref into `PluginModule.markdownCodeRenderers`. */
  component: string;
}

export interface EditorLanguageContribution {
  /** CodeMirror language id, e.g. `plantuml` or `mermaid`. */
  id: string;
  /** Alternate language names that also resolve to this language support. */
  aliases?: string[];
  /** Entry ref into `PluginModule.editorLanguages`. */
  entry: string;
}

export interface ContributionPoints {
  commands?: CommandContribution[];
  fileTypes?: FileTypeContribution[];
  containers?: ContainerContribution[];
  features?: FeatureContribution[];
  tools?: ToolContribution[];
  /** Custom export formats added to the export menu. */
  exporters?: ExporterContribution[];
  /** Entries added to the file-tree right-click "新建" submenu. */
  fileTemplates?: FileTemplateContribution[];
  /** Key→command bindings registered with the global-shortcut layer. */
  keybindings?: KeybindingContribution[];
  /** Post-render export enhancers for container/file-preview DOM. */
  exportEnhancers?: ExportEnhancerContribution[];
  /** Fenced-block renderers for Markdown preview (e.g. ```mermaid, ```plantuml). */
  markdownCodeRenderers?: MarkdownCodeRendererContribution[];
  /** CodeMirror language extensions contributed by plugins. */
  editorLanguages?: EditorLanguageContribution[];
}

export interface ActivationEvents {
  onCommand?: string;
  onFileType?: string[];
  onLanguage?: string[];
}
