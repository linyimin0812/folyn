/**
 * Extension SDK type contract — manifest schema, lifecycle, contribution points.
 *
 * This file is the public surface extension authors program against. It is
 * framework-agnostic: contribution points declare entry references (strings)
 * that a {@link ExtensionLoader} resolves to real functions/components at runtime,
 * so the SDK package has no runtime dependency (React types are peer-only,
 * erased at build for type-only consumers).
 *
 * Tier model (see prd.md ADR-lite):
 * - `sandbox`: untrusted extension hosted in a sandboxed iframe (`folyn-extension://`
 *   origin), talks to the host via a vetted postMessage RPC. No raw Tauri APIs.
 * - `trusted`: TOFU-pinned extension `import()`-ed into the host realm; may
 *   contribute inline React/CodeMirror components and receive scoped Tauri
 *   capability grants via `add_capability`.
 */

import type { Disposable } from './Disposable';

/** Execution tier — determines loader, isolation, and capability surface. */
export type ExtensionTier = 'sandbox' | 'trusted';

/** Response shape returned by {@link ExtensionHttpCapability.fetch}. Mirrors the
 * rpcBridge `http:fetch` + Rust `extension_http_fetch` body: a single string
 * `body` (no streaming, no binary). Add a `fetchBlob` variant when a extension
 * needs binary responses. */
export interface ExtensionHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Init shape accepted by {@link ExtensionHttpCapability.fetch}. Subset of the
 * stdlib `RequestInit`: only string bodies + simple headers — the Rust
 * command serializes headers as `HashMap<String, String>` so non-string
 * values are dropped. */
export interface ExtensionHttpInit {
  method?: string;
  headers?: HeadersInit;
  body?: string;
}

export interface ExtensionHttpCapability {
  /**
   * Fetch a remote URL via the host. The host enforces
   * `permissions.http.origins` (JS-side fast-fail + Rust-side re-check) before
   * performing the request with reqwest. Rejects with `origin not allowed`
   * if the URL's origin is not declared in the manifest.
   */
  fetch(url: string, init?: ExtensionHttpInit): Promise<ExtensionHttpResponse>;
}


// ── Manifest ───────────────────────────────────────────────────────────────

export interface ExtensionManifest {
  /** Globally-unique kebab-case id. */
  id: string;
  name: string;
  version: string;
  author?: string;
  /** Engine compat, e.g. `>=0.1.0`. */
  folyn?: string;
  tier: ExtensionTier;
  /** Entry module path (resolved by the loader against the extension origin). */
  main: string;
  /** Sandbox-tier HTML UI entry. Required when `tier === 'sandbox'`. */
  html?: string;
  permissions?: ExtensionPermissions;
  contributes?: ContributionPoints;
  activation?: ActivationEvents;
  /** Optional ed25519 signature over the canonicalized manifest (base64). MVP:
   * not enforced; verified best-effort on the Rust side. See
   * docs/extension-development.md "Integrity upgrade path". */
  signature?: string;
  /** Optional base64 ed25519 public key paired with `signature`. */
  publisherPublicKey?: string;
  /** Optional display icon. Inline `<svg>…</svg>` string, `.svg` file path
   * (resolved by host via `read_extension_file`), or emoji/short text. Mirrors
   * `ContainerContribution.icon`. */
  icon?: string;
  /** Optional one-line human-readable description shown in Settings → Extensions. */
  description?: string;
}

// ── Permissions (declarative; host enforces) ───────────────────────────────

export interface ExtensionPermissions {
  fs?: { scope: string[] };
  http?: { origins: string[] };
  clipboard?: boolean;
  dialog?: boolean;
  window?: boolean;
  vault?: { readActive?: boolean; insertContent?: boolean; readBinary?: boolean };
  /**
   * AI capability grant. Host mediates all AI access (chat_stream + feature
   * agents) through this declaration; undeclared `ai.*` calls throw.
   *
   * - `chat`: allow `ExtensionContext.ai.chat` (sandbox + trusted).
   * - `agents`: whitelist of feature names the extension may drive via
   *   `ExtensionContext.ai.agent` (trusted only — sandbox cannot reach feature
   *   agents). Empty/absent = no agent calls.
   * - `edit`: allow `ExtensionContext.ai.editFile` / `createFile` (trusted only).
   *   Host applies the resulting file changes through the shared editor/vault
   *   chokepoint; the extension never writes the filesystem directly.
   */
  ai?: { chat?: boolean; agents?: string[]; edit?: boolean };
}

// ── Extension env (theme + locale) ─────────────────────────────────────────────
//
// Extensions that render UI need to track the host's resolved theme and current
// locale, and react when the user switches either mid-session. The host
// signals the current values and pushes change events; extensions bring their
// own i18n bundles and styling keyed off `theme` — host's `t()`/message
// catalog is NOT exposed.

/** Resolved theme name. `'system'` is resolved to 'light'|'dark' by the host
 * before delivery, so extensions never see 'system'. */
export type ExtensionTheme = 'light' | 'dark';

/**
 * Locale identifier string (e.g. 'zh', 'en'). Typed as a generic string so
 * the publishable SDK has no dependency on the desktop app's locale union —
 * the host narrows to its supported set at runtime, extensions handle whatever
 * string arrives.
 */
export type ExtensionLocale = string;

export interface ExtensionEnv {
  /** Resolved current theme. */
  readonly theme: ExtensionTheme;
  /** Current locale identifier. */
  readonly locale: ExtensionLocale;
  /** Subscribe to subsequent theme changes. Returns a Disposable. */
  onThemeChange(cb: (theme: ExtensionTheme) => void): Disposable;
  /** Subscribe to subsequent locale changes. Returns a Disposable. */
  onLocaleChange(cb: (locale: ExtensionLocale) => void): Disposable;
}

// ── AI capability (host-mediated) ─────────────────────────────────────────────
//
// Extension authors call `ctx.ai.chat` / `ctx.ai.agent`. The host implementation
// (PR2: trusted — wraps runRigChat / runFeatureAgent; PR3: sandbox — same
// methods over rpcBridge postMessage) enforces manifest.permissions.ai before
// forwarding to the shared AI chokepoints. Provider/model/apiKey are never
// exposed — host uses the user's configured defaults.

/** Subset of {@link CliStreamEvent} a extension may observe. Tool / file-change
 * events are filtered out by the host before delivery. */
export type ExtensionAiEventType = 'text' | 'thinking' | 'error' | 'done';

export interface ExtensionAiStreamEvent {
  type: ExtensionAiEventType;
  content?: string;
}

export type ExtensionAiEventHandler = (event: ExtensionAiStreamEvent) => void;

export interface ExtensionAiChatParams {
  /** Extension-managed session id (extension owns persistence/history). */
  sessionId: string;
  prompt: string;
  onEvent: ExtensionAiEventHandler;
  /** When true, the host also surfaces the turn in aiPanel (aiStore session).
   * Defaults to false (extension-only, not in UI). */
  useSharedSession?: boolean;
}

export interface ExtensionAiAgentParams {
  /** Feature name — must be in `permissions.ai.agents` whitelist. */
  feature: string;
  instruction: string;
  onEvent: ExtensionAiEventHandler;
}

/** Params for {@link ExtensionAiCapability.editFile} — modify an existing file. */
export interface ExtensionAiEditFileParams {
  /** Vault-relative path of the file to modify. */
  path: string;
  /** Natural-language instruction describing the desired change. */
  instruction: string;
  onEvent: ExtensionAiEventHandler;
}

/** Params for {@link ExtensionAiCapability.createFile} — create a new file. */
export interface ExtensionAiCreateFileParams {
  /** Vault-relative path of the file to create (overwrites if present). */
  path: string;
  /** Natural-language instruction describing the file to create. */
  instruction: string;
  onEvent: ExtensionAiEventHandler;
}

export interface ExtensionAiCapability {
  /** Stream a multi-turn chat turn through the host's configured provider.
   * Rejects if `permissions.ai.chat` is not declared. */
  chat(params: ExtensionAiChatParams): Promise<void>;
  /** Drive a registered feature agent (trusted tier only). Rejects if the
   * feature is not in `permissions.ai.agents`. */
  agent(params: ExtensionAiAgentParams): Promise<void>;
  /** Apply an AI-driven edit to an existing vault file (trusted tier only).
   * The host streams progress via `onEvent` and applies the change through the
   * shared editor chokepoint. Rejects if `permissions.ai.edit` is not declared. */
  editFile(params: ExtensionAiEditFileParams): Promise<void>;
  /** Create a new vault file from an AI instruction (trusted tier only).
   * Rejects if `permissions.ai.edit` is not declared. */
  createFile(params: ExtensionAiCreateFileParams): Promise<void>;
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
   * visual/source; extensions may declare custom ids (e.g. 'canvas').
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
   *    host's `IconFromSvg`. Recommended for self-contained extension icons.
   * 2. `.svg` file path relative to the extension install dir — the host reads
   *    the file at activate via `read_extension_file` and stores the resolved
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
  /** Entry ref to the panel component (resolved via `ExtensionModule.features`). */
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
// `run` entry-ref resolves (via `ExtensionModule.exporters`) to a function that
// takes the active doc content + ctx and returns a Blob/string to write.

export interface ExporterContribution {
  id: string;
  /** Output format id, e.g. `pdf`, `docx`. Globally unique within a extension. */
  format: string;
  /** Menu label, e.g. `Export as PDF`. */
  label: string;
  /** Output file extension without dot, e.g. `pdf`. */
  fileExtension: string;
  /** Entry ref to the exporter function (indexed by `ExtensionModule.exporters`). */
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
// Binds a key to a command id (a extension-contributed command or a built-in).
// `key` is a Tauri accelerator string (e.g. `Cmd+Shift+P`). `mac` overrides
// for macOS; `when` is an optional activation clause (kept as an opaque
// string for forward-compat — MVP registers globally).

export interface KeybindingContribution {
  /** Command id to invoke (e.g. `extension.my-extension.greet` or a built-in id). */
  command: string;
  /** Tauri accelerator, e.g. `Cmd+Shift+K`. */
  key: string;
  /** macOS-specific accelerator override. */
  mac?: string;
  /** Optional activation clause (opaque string; reserved for `when` contexts). */
  when?: string;
}

// ── Export-enhancer contribution (post-render DOM mutation) ─────────────────
// Lets a trusted extension post-process its own `:::name` container (or a
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
  /** Entry ref into `ExtensionModule.exportEnhancers`. */
  run: string;
}

export interface MarkdownCodeRendererContribution {
  /** Fenced-block language id, e.g. `plantuml` or `mermaid`. */
  language: string;
  /** Alternate fence languages that also dispatch to this renderer. */
  aliases?: string[];
  /** Entry ref into `ExtensionModule.markdownCodeRenderers`. */
  component: string;
}

export interface EditorLanguageContribution {
  /** CodeMirror language id, e.g. `plantuml` or `mermaid`. */
  id: string;
  /** Alternate language names that also resolve to this language support. */
  aliases?: string[];
  /** File extensions (without the leading dot) that should open with this language, e.g. `puml`, `dot`. */
  extensions?: string[];
  /** Entry ref into `ExtensionModule.editorLanguages`. */
  entry: string;
}

export interface HighlightGrammarContribution {
  /**
   * highlight.js language name to register (e.g. `plantuml`). Becomes the
   * canonical id; `aliases` below are registered as additional lookup keys
   * via hljs's own alias mechanism.
   */
  name: string;
  /** Alternate fence languages / file extensions that resolve to this grammar. */
  aliases?: string[];
  /** Entry ref into `ExtensionModule.highlightGrammars`. */
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
  /** CodeMirror language extensions contributed by extensions. */
  editorLanguages?: EditorLanguageContribution[];
  /** highlight.js grammars contributed by extensions (drives ```lang code blocks + CodeFileViewer). */
  highlightGrammars?: HighlightGrammarContribution[];
}

export interface ActivationEvents {
  onCommand?: string;
  onFileType?: string[];
  onLanguage?: string[];
}
