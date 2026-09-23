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
 * - `trusted`: TOFU-pinned extension `import()`-ed into the host realm. No
 *   per-extension runtime ACL — it shares the main webview's full host
 *   capability from `capabilities/default.json`; the manifest `permissions`
 *   block is informational (not enforced) for this tier.
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
  /** Optional display icon. Inline `<svg>…</svg>` string, `.svg` file path
   * (resolved by host via `read_extension_file`), or emoji/short text. Mirrors
   * `ContainerContribution.icon`. */
  icon?: string;
  /** Optional one-line human-readable description shown in Settings → Extensions. */
  description?: string;
}

// ── Permissions (declarative; enforced by tier) ────────────────────────────
//
// Two-tier enforcement (see extension-development.md “Permissions model”):
//   - sandbox: HARD boundary. Every privileged call crosses the RPC bridge,
//     which checks the matching permission before dispatch. Omit a permission
//     → that call throws. This is the only tier where `permissions` is enforced.
//   - trusted: INFORMATIONAL only. Trusted extensions run in the main webview
//     realm, which already has full host capability via capabilities/default.json.
//     There is no per-extension runtime ACL; the manifest `permissions` block is
//     not checked for trusted code. The sole boundary on the trusted tier is the
//     TOFU gate (user-pin + SHA-256 integrity match on `main`). Declare
//     permissions anyway as documentation + forward-compat if a trusted tier
//     ever gains enforcement, but do not rely on them to confine trusted code.

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
// forwarding to the shared AI chokepoints. The apiKey is never exposed — the
// host resolves it from its own settings; extensions may list configured
// (provider, model) pairs via `ctx.ai.pairs()` and pass one as a chat override.

/** Subset of {@link CliStreamEvent} a extension may observe. Tool / file-change
 * events are filtered out by the host before delivery. */
export type ExtensionAiEventType = 'text' | 'thinking' | 'error' | 'done';

export interface ExtensionAiStreamEvent {
  type: ExtensionAiEventType;
  content?: string;
}

export type ExtensionAiEventHandler = (event: ExtensionAiStreamEvent) => void;

/** A selectable (provider, model) pair from the host's AI settings. The apiKey
 * never leaves the host — `chat` re-resolves it from the provider slot. */
export interface ExtensionAiPair {
  provider: string;
  model: string;
  /** Provider display label (already localized host-side). */
  label?: string;
  /** Host asset URL for the provider logo, when one exists. */
  iconUrl?: string;
}

export interface ExtensionAiChatParams {
  /** Extension-managed session id (extension owns persistence/history). */
  sessionId: string;
  prompt: string;
  onEvent: ExtensionAiEventHandler;
  /** When true, the host also surfaces the turn in aiPanel (aiStore session).
   * Defaults to false (extension-only, not in UI). */
  useSharedSession?: boolean;
  /** Optional pair override from {@link ExtensionAiCapability.pairs}. Omitted →
   * the host's extensionPair (Extensions Settings) default. The provider slot
   * must exist and be configured, else the call rejects. */
  provider?: string;
  model?: string;
  /** Image attachments for this turn (base64 bytes, no `data:` prefix). Only
   * sent to multimodal-capable models; the host forwards them as rig image
   * content blocks. */
  images?: { data: string; mediaType: string }[];
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
  /** List the user's configured (provider, model) pairs (enabled providers ×
   * selected models). Ids only — apiKeys stay in the host. Rejects if
   * `permissions.ai.chat` is not declared. */
  pairs(): Promise<ExtensionAiPair[]>;
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
  /** True if this container shows only one child at a time and hides the
   *  rest (e.g. `tabs`, `carousel`), or is itself such a hidden child (e.g.
   *  `tab`, `slide`). Passed through to ContainerExtension at registration;
   *  see that field's doc for why the host reads it (cursor-sync). */
  hidesInactiveChildren?: boolean;
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
  /** Sort key within the activity bar. Built-ins: files=0, wiki=10, analyze=30, calendar=40. */
  order?: number;
  /** Optional badge rendered as a small text dot when present. */
  badge?: string | number;
}

export interface PageContribution {
  id: string;
  /** Entry ref to the page component (resolved via `ExtensionModule.pages`). */
  component: string;
  /**
   * Page-nav button icon — REQUIRED. Raw inline SVG string (rendered via
   * `IconFromSvg`) or a `ThemeIcon` name (host `assets/icons/*.svg`).
   */
  icon: string;
  /** Page title (activity bar tooltip + accessibility label). Raw string, not i18n'd. */
  title?: string;
  /** Sort key among extension page-nav buttons (default: registration order from 100). */
  order?: number;
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

// ── Storage-provider contribution (Settings → Storage & Sharing) ─────────────
// Adds a cloud object-storage provider (image hosting + HTML sharing) to the
// Storage & Sharing settings. Trusted-tier only — the sandbox tier cannot
// return a React component. The host adapter registers each into the same
// `StorageProviderRegistry` the built-in R2/Qiniu/OSS providers use; the
// settings UI + upload call sites route through that one registry.

export interface StorageProviderContribution {
  /** Unique provider id, e.g. `smms`. Globally unique across built-ins + extensions. */
  id: string;
  /** i18n key for the provider label shown in the selector. */
  labelKey: string;
  /** Emoji, inline `<svg>…</svg>`, `.svg` path, or ThemeIcon name — mirrors `ContainerContribution.icon`. */
  icon?: string;
  /** What this provider can upload. */
  capabilities: { image: boolean; html: boolean };
  /** Entry ref into `ExtensionModule.storageProviders` — the React config-form
   *  component (`ComponentType<StorageConfigFormProps>`). */
  configForm: string;
  /** Entry ref into `ExtensionModule.storageProviders` — `(config: unknown) => boolean`,
   *  whether the saved config is populated enough to attempt an upload. */
  isConfigured: string;
  /** Entry ref into `ExtensionModule.storageProviders` —
   *  `(bytes, ext, config) => Promise<publicUrl>`. Required when `capabilities.image`. */
  uploadImage?: string;
  /** Entry ref into `ExtensionModule.storageProviders` —
   *  `(html, config) => Promise<publicUrl>`. Required when `capabilities.html`. */
  uploadHtml?: string;
  /** Default config seeded when the provider is first selected. */
  defaultConfig: Record<string, unknown>;
}

// ── Activity-collection contributions (design folyn-activity-collection-design.md §2/§3) ──
// Trusted-tier only. Collectors produce standard ActivityEvents + declarative
// display metadata; storage/ingest/render stay host-native. The host validates
// constraints (icon from the loaded set, palette-key colors, builtin formatters)
// at registration — the types below express what is cheap to union-ize.

/** Collector run mode: host-polled (`collect()` on a timer) or host-routed
 *  webhook (`onWebhook` on a local callback). */
export type ActivityCollectorMode = 'poll' | 'webhook';

/**
 * Loose JSON-Schema-ish config schema for a collector's settings form.
 * The host auto-renders a form from `properties` + `required`; values are
 * stored host-side (never in the extension). Only a subset of JSON Schema is
 * honored — extra keys are ignored, not rejected.
 */
export interface CollectorAuthSchema {
  type: 'object';
  properties: Record<string, {
    type: 'string' | 'number' | 'boolean';
    title?: string;
    description?: string;
    /** Input placeholder / prefilled value. */
    default?: unknown;
    /** Restricted values → the form renders a dropdown. */
    enum?: string[];
  }>;
  required?: string[];
}

/** `contributes.collectors[]` — one collectable activity source (design §2.1). */
export interface CollectorContribution {
  /** Collector id, e.g. `git-commit`. Unique across all enabled collectors;
   *  the value stored in `activity_events.source` and in the cursor table. */
  id: string;
  /** Event `type` values this collector is allowed to push (validated
   *  host-side by `activity_push_events`'s declaredTypes check). */
  activityTypes: string[];
  mode: ActivityCollectorMode;
  /** Declared default poll interval. Host floors at 60s; the user can raise
   *  it or turn polling off entirely in Settings (design §2.1). */
  pollIntervalMs?: number;
  /** Config form schema — host renders + persists the values (design §2.1). */
  authSchema?: CollectorAuthSchema;
  /** Hosts the collector's outbound requests target. Confirmed once at
   *  install/enable; enforced at runtime on outbound calls. */
  hostAllowlist: string[];
}

/** Built-in detail-field formatters (design §3.1). No templates, no HTML. */
export type ActivityDetailFormat = 'text' | 'number' | 'currency' | 'date' | 'badge' | 'list';
/** Metric-card aggregations (design §3.1). No custom expressions. */
export type ActivityMetricAggregate = 'count' | 'sum';
/** Palette keys the host accepts (no arbitrary hex, design §3.1). */
export type ActivityPaletteColor = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'teal';

/** `contributes.activityDisplay[]` — how one event `type` renders (design §3.1). */
export interface ActivityDisplayContribution {
  /** The event `type` this display entry indexes. */
  type: string;
  /** Icon name from the host's loaded icon set (e.g. a lucide name). */
  icon?: string;
  color?: ActivityPaletteColor;
  /** Fields shown in the expanded detail panel. */
  detailFields?: { key: string; label: string; format: ActivityDetailFormat }[];
  /** When present, adds a metric card for this type. */
  metric?: { id: string; label: string; aggregate: ActivityMetricAggregate };
  /** When present, this event type's entities join the relation graph. */
  entity?: { role: string; relationLabel: string };
}

/** `contributes.entityTypes[]` — registers a custom entity type (design §3.4).
 *  Conflicts (builtin 5 or an already-registered type) are skipped + logged +
 *  surfaced as a conflict badge in the extension store; first registrant wins. */
export interface EntityTypeContribution {
  /** Type id, e.g. `customer`. Valid within the declaring collector's scope;
   *  referenced by `activityDisplay[].entity.role`. */
  id: string;
  /** Free text label shown in the entity graph. */
  label: string;
  color?: ActivityPaletteColor;
  icon?: string;
}

export interface ContributionPoints {
  commands?: CommandContribution[];
  fileTypes?: FileTypeContribution[];
  containers?: ContainerContribution[];
  features?: FeatureContribution[];
  /** Full pages rendered like the built-in translation page (trusted only). */
  pages?: PageContribution[];
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
  /** Cloud object-storage providers added to Settings → Storage & Sharing. */
  storageProviders?: StorageProviderContribution[];
  /** Activity collectors (trusted only, design §2). Poll/webhook sources
   *  that push standard ActivityEvents through the host ingest pipeline. */
  collectors?: CollectorContribution[];
  /** Declarative display metadata per event type (design §3.1). */
  activityDisplay?: ActivityDisplayContribution[];
  /** Custom entity-type registrations for the activity relation graph (design §3.4). */
  entityTypes?: EntityTypeContribution[];
}
