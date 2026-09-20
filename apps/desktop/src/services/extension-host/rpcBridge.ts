/**
 * Host RPC bridge for sandbox-tier extensions.
 *
 * This is the host-mediation boundary: sandboxed iframe extensions (origin
 * `folyn-extension://localhost`, `sandbox="allow-scripts"` without
 * `allow-same-origin`) NEVER get raw Tauri APIs. Every privileged operation
 * goes through a postMessage RPC that this bridge validates against the
 * extension's declared permissions before executing.
 *
 * Message protocol:
 *   iframe → host: { type: 'request',     id, method, params }
 *   host → iframe: { type: 'response',    id, result?, error? }
 *   host → iframe: { type: 'lifecycle',   event: 'activate' | 'deactivate' }
 *   host → iframe: { type: 'invoke',      id, command, params? }
 *   iframe → host: { type: 'invoke-result', id, result?, error? }
 */

import type { ExtensionAiStreamEvent, ExtensionManifest, ExtensionPermissions } from '@folyn/extension-host';
import type { CliStreamEvent } from '@folyn/cli-adapter';
import { runRigChat } from '@/services/rigChat';
import { extensionStoragePrefix } from './extensionStoragePrefix';

// ── Pure capability-checking helpers (exported for unit testing) ─────────────

/**
 * Check whether a relative path (sent by the extension in an RPC request) falls
 * within the declared `permissions.fs.scope` patterns.
 *
 * Scope entries are glob patterns relative to the extension's root dir:
 *   - `data/**`   → matches `data/foo.txt`, `data/sub/foo.txt`
 *   - `config/*`  → matches `config/settings.json` (single segment after /)
 *   - `vault:...` → special token (NOT a path pattern; skipped here)
 *
 * Path-traversal segments (`..`) are always rejected.
 */
export function isPathInScope(relativePath: string, scope: string[]): boolean {
  const normalized = relativePath.replace(/^\/+/, '');
  if (normalized.includes('..')) return false;
  if (normalized === '') return false;

  for (const pattern of scope) {
    // Skip special tokens (e.g. "vault:read-active").
    if (pattern.includes(':')) continue;
    if (matchGlob(normalized, pattern)) return true;
  }
  return false;
}

/**
 * Recursive glob matcher supporting `**` (any depth) and `*` (within a single
 * path segment). Patterns are matched against slash-separated paths.
 */
function matchGlob(path: string, pattern: string): boolean {
  const pathParts = path.split('/');
  const patternParts = pattern.split('/');
  return matchParts(pathParts, 0, patternParts, 0);
}

function matchParts(
  pathParts: string[],
  pi: number,
  patternParts: string[],
  qi: number,
): boolean {
  if (qi >= patternParts.length) return pi >= pathParts.length;

  const part = patternParts[qi];

  if (part === '**') {
    // `**` matches zero or more remaining path segments.
    for (let i = pi; i <= pathParts.length; i++) {
      if (matchParts(pathParts, i, patternParts, qi + 1)) return true;
    }
    return false;
  }

  if (pi >= pathParts.length) return false;

  if (segmentMatch(pathParts[pi], part)) {
    return matchParts(pathParts, pi + 1, patternParts, qi + 1);
  }
  return false;
}

/** Match a single path segment against a pattern that may contain `*`. */
function segmentMatch(segment: string, pattern: string): boolean {
  const regex = new RegExp(
    '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
  );
  return regex.test(segment);
}

/**
 * Check whether a URL's origin is in the declared `permissions.http.origins`
 * allowlist. Origins are compared as scheme://host[:port].
 */
export function isOriginAllowed(url: string, allowedOrigins: string[]): boolean {
  if (allowedOrigins.length === 0) return false;
  const origin = extractOrigin(url);
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}

function extractOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** Map host CliStreamEvent → extension-visible event (drop tool/file_change). */
function mapSandboxEvent(e: CliStreamEvent): ExtensionAiStreamEvent | null {
  switch (e.type) {
    case 'text':
    case 'thinking':
    case 'error':
    case 'done':
      return { type: e.type, content: e.content };
    default:
      return null;
  }
}

/**
 * Resolve the host's `theme` value (which may be `'system'`) to a concrete
 * `'light' | 'dark'` for sandbox extensions. MatchMedia is available in the
 * host webview where the RpcBridge runs.
 */
function resolveSystemTheme(theme: 'light' | 'dark' | 'system'): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

/**
 * Normalize a `RequestInit.headers` value (which may be a `Headers`, a plain
 * `Record`, or an array of `[key, value]` tuples) into a plain string map for
 * Tauri IPC serialization. Non-string-coercible entries are skipped. Returns
 * `undefined` when there are no headers so the Rust `Option<HashMap>` receives
 * `None`.
 */
export function normalizeHeaders(
  headers: HeadersInit | undefined,
): Record<string, string> | undefined {
  if (headers == null) return undefined;
  const out: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = value;
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      if (typeof key === 'string' && typeof value === 'string') out[key] = value;
    }
  } else {
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Check whether an error thrown by the clipboard-manager plugin is arboard's
 * `ContentNotAvailable` — the clipboard holds no payload in the requested
 * flavor (e.g. an image was copied, so there is no text; or the clipboard is
 * empty). Callers map this to `null` instead of surfacing an error.
 */
function isContentNotAvailable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('not available in the requested format');
}

/** Uint8Array → base64 in the main webview (chunked to avoid arg limits). */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Change-count gate state for `clipboard:read-image` (see that case). */
const imageCache: { count: number; payload: unknown } = { count: -1, payload: null };

/** base64 → Uint8Array in the main webview (for clipboard:write-image). */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Check whether the manifest grants a specific capability. Used by the bridge
 * to gate methods that require a boolean permission flag.
 */
export function hasPermission(manifest: ExtensionManifest, capability: string): boolean {
  const perms: ExtensionPermissions | undefined = manifest.permissions;
  if (!perms) return false;
  switch (capability) {
    case 'clipboard':
      return perms.clipboard === true;
    case 'dialog':
      return perms.dialog === true;
    case 'window':
      return perms.window === true;
    case 'vault:read-active':
      return perms.vault?.readActive === true;
    case 'vault:read-binary':
      return perms.vault?.readBinary === true;
    case 'vault:insert-content':
      return perms.vault?.insertContent === true;
    default:
      return false;
  }
}

// ── Message types ────────────────────────────────────────────────────────────

export interface RpcRequest {
  type: 'request';
  id: string;
  method: string;
  params: unknown;
}

export interface RpcResponse {
  type: 'response';
  id: string;
  result?: unknown;
  error?: string;
}

export interface LifecycleMessage {
  type: 'lifecycle';
  event: 'activate' | 'deactivate';
}

export interface InvokeMessage {
  type: 'invoke';
  id: string;
  command: string;
  params?: unknown;
}

export interface InvokeResultMessage {
  type: 'invoke-result';
  id: string;
  result?: unknown;
  error?: string;
}

/** Streaming AI event pushed from host to iframe (sandbox ai:chat). The final
 * `RpcResponse` with the same `id` terminates the stream. */
export interface AiStreamMessage {
  type: 'ai-stream';
  id: string;
  event: ExtensionAiStreamEvent;
}

/** Env state push from host to iframe. Fired when the host's theme or locale
 * changes while a sandbox extension is active. Extension listens for these in
 * addition to calling `env:get` to seed initial values. */
export interface EnvEventMessage {
  type: 'env-event';
  event: 'theme' | 'locale';
  value: string;
}

type ExtensionMessage =
  | RpcRequest
  | RpcResponse
  | LifecycleMessage
  | InvokeMessage
  | InvokeResultMessage
  | AiStreamMessage
  | EnvEventMessage;

// ── RpcBridge ────────────────────────────────────────────────────────────────

export interface RpcBridgeOptions {
  extensionId: string;
  manifest: ExtensionManifest;
  /** Returns the iframe's contentWindow (may be null before load). */
  targetWindow: () => Window | null;
  /** Called for messages the bridge doesn't handle (e.g. custom events). */
  onUnhandled?: (msg: ExtensionMessage) => void;
  /**
   * Optional injectable path resolver for tests. In production this uses
   * Tauri's homeDir + join. Returns an absolute path string.
   */
  resolveExtensionPath?: (relativePath: string) => Promise<string>;
}

/**
 * Manages the postMessage RPC channel between the host and a sandboxed extension
 * iframe. Enforces capability scoping on every privileged call.
 *
 * The bridge is NOT a React component — it is a plain object so it can be
 * unit-tested in isolation and survive React re-renders without dropping its
 * message listener.
 */
export class RpcBridge {
  private readonly opts: RpcBridgeOptions;
  private readonly pendingInvokes = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private listener: ((event: MessageEvent) => void) | null = null;
  private disposed = false;
  /** Env store unsubscribers — set up lazily on first subscribe so the test
   * injected resolver pattern is preserved; torn down in `dispose()`. */
  private envUnsubs: Array<() => void> = [];

  constructor(opts: RpcBridgeOptions) {
    this.opts = opts;
    this.attachListener();
    this.attachEnvSubscriptions();
  }

  /** Process an incoming message from the iframe. Called by the message listener. */
  async handleMessage(data: unknown, source: Window | null): Promise<void> {
    if (this.disposed) return;
    if (!data || typeof data !== 'object') return;
    const msg = data as ExtensionMessage;
    if (typeof msg.type !== 'string') return;

    // Verify the message came from our iframe. Sandboxed iframes without
    // allow-same-origin have origin "null", so we check `source` instead.
    const target = this.opts.targetWindow();
    if (target && source !== target) return;

    switch (msg.type) {
      case 'request':
        await this.handleRequest(msg as RpcRequest);
        break;
      case 'invoke-result':
        this.handleInvokeResult(msg as InvokeResultMessage);
        break;
      default:
        this.opts.onUnhandled?.(msg);
    }
  }

  /** Send a lifecycle message to the iframe. */
  sendLifecycle(event: 'activate' | 'deactivate'): void {
    this.send({ type: 'lifecycle', event });
  }

  /** Invoke a command handler inside the extension iframe. Resolves when the
   *  iframe returns an `invoke-result`. */
  invokeCommand(command: string, params?: unknown): Promise<unknown> {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pendingInvokes.set(id, { resolve, reject });
      this.send({ type: 'invoke', id, command, params });
      // Safety timeout so a frozen iframe doesn't hang the caller forever.
      setTimeout(() => {
        if (this.pendingInvokes.has(id)) {
          this.pendingInvokes.delete(id);
          reject(new Error(`extension command timed out: ${command}`));
        }
      }, 30_000);
    });
  }

  /** Remove the message listener, reject all pending invokes, and tear down
   *  env store subscriptions. */
  dispose(): void {
    this.disposed = true;
    if (this.listener) {
      window.removeEventListener('message', this.listener);
      this.listener = null;
    }
    for (const un of this.envUnsubs) {
      try { un(); } catch { /* store already torn down */ }
    }
    this.envUnsubs = [];
    for (const [, { reject }] of this.pendingInvokes) {
      reject(new Error('bridge disposed'));
    }
    this.pendingInvokes.clear();
  }

  // ── Internal ──

  /**
   * Subscribe to host theme + locale stores; on change, push an `env-event`
   * message to the iframe so sandbox extensions can react mid-session. Stores
   * are imported dynamically so the bridge module stays unit-testable without
   * the full desktop store graph at module load. Subscriptions are torn down
   * in `dispose()`. Ponytail: one subscription per store, fan-out in
   * `sendEnvEvent` for any extension that's still active.
   */
  private attachEnvSubscriptions(): void {
    void Promise.all([
      import('@/store/appearanceStore'),
      import('@/store/localeStore'),
    ]).then(([appearanceMod, localeMod]) => {
      if (this.disposed) return;
      this.envUnsubs.push(
        appearanceMod.useAppearanceStore.subscribe((state, prev) => {
          if (state.theme === prev.theme) return;
          this.sendEnvEvent('theme', resolveSystemTheme(state.theme));
        }),
      );
      this.envUnsubs.push(
        localeMod.useLocaleStore.subscribe((state, prev) => {
          if (state.locale === prev.locale) return;
          this.sendEnvEvent('locale', state.locale);
        }),
      );
    });
  }

  private sendEnvEvent(event: 'theme' | 'locale', value: string): void {
    if (this.disposed) return;
    this.send({ type: 'env-event', event, value });
  }

  private attachListener(): void {
    this.listener = (event: MessageEvent) => {
      void this.handleMessage(event.data, event.source as Window | null);
    };
    window.addEventListener('message', this.listener);
  }

  private send(msg: ExtensionMessage): void {
    const target = this.opts.targetWindow();
    if (!target) return;
    // `*` target because the sandboxed iframe has an opaque origin; we verify
    // the source on the receive side.
    target.postMessage(msg, '*');
  }

  private sendResponse(id: string, result?: unknown, error?: string): void {
    this.send({ type: 'response', id, result, error });
  }

  private handleInvokeResult(msg: InvokeResultMessage): void {
    const pending = this.pendingInvokes.get(msg.id);
    if (!pending) return;
    this.pendingInvokes.delete(msg.id);
    if (msg.error) {
      pending.reject(new Error(msg.error));
    } else {
      pending.resolve(msg.result);
    }
  }

  private async handleRequest(req: RpcRequest): Promise<void> {
    // Streaming methods push `ai-stream` messages keyed by req.id during
    // their execution; the final `response` terminates the stream.
    const stream = (event: ExtensionAiStreamEvent) => {
      this.send({ type: 'ai-stream', id: req.id, event });
    };
    try {
      const result = await dispatchExtensionRpc(
        this.opts.manifest,
        this.opts.extensionId,
        req.method,
        req.params,
        (p) => this.resolvePath(p),
        stream,
      );
      this.sendResponse(req.id, result);
    } catch (err) {
      this.sendResponse(req.id, undefined, err instanceof Error ? err.message : String(err));
    }
  }

  /** Resolve a extension-relative path to an absolute filesystem path.
   * Data files resolve under the DATA dir (`~/.folyn/extensions-data/<id>/`),
   * NOT the install dir — install/uninstall wipes the code dir, so anything
   * stored there dies on every re-install. The override stays for tests. */
  private async resolvePath(relativePath: string): Promise<string> {
    if (this.opts.resolveExtensionPath) {
      return this.opts.resolveExtensionPath(relativePath);
    }
    const { homeDir, join } = await import('@tauri-apps/api/path');
    const home = await homeDir();
    return join(home, '.folyn', 'extensions-data', this.opts.extensionId, relativePath);
  }
}

// ── Shared free-function dispatcher ──────────────────────────────────────────
//
// `dispatchExtensionRpc` is the canonical host-side RPC method table. It is
// called from two transports:
//   1. `RpcBridge.dispatch` — iframe sandbox path (postMessage).
//   2. `toolWindowRpcListener` — fetch-RPC path for tool windows (POST
//      `folyn-extension://localhost/<id>/rpc`, see extension_commands.rs).
//
// Keeping the table in one place ensures both transports enforce the same
// permission checks and resolve paths the same way.

// ── Tool-window chat jobs (poll-based streaming) ─────────────────────────────
//
// The tool-window fetch transport has no push channel (no postMessage to a
// separate native window, no Tauri events injected into extension webviews),
// so `ai:chat` there starts the rig chat as a background job and returns
// `{ jobId }` immediately. The client drains undrained text/thinking deltas
// via `ai:chat-poll` (~150ms cadence) — token streaming without a stream
// callback. The poll that observes `done` deletes the job; a 10-min TTL
// reaps jobs that are never polled to completion (window closed mid-chat).

interface ChatJob {
  /** Undrained text deltas since the last poll. */
  text: string;
  /** Undrained thinking deltas since the last poll. */
  thinking: string;
  done: boolean;
  error?: string;
}

const CHAT_JOBS = new Map<string, ChatJob>();

/**
 * Dispatch an RPC method to the matching host capability, gated by the
 * extension's declared `permissions`.
 *
 * @param manifest      The extension manifest (source of permission declarations).
 * @param extensionId      The extension id (used for path resolution + logging).
 * @param method        RPC method name (e.g. `vault:insert-content`).
 * @param params        Method params object.
 * @param resolvePath   Resolves a extension-relative path (data file) to an
 *                      absolute path. Both transports use
 *                      `~/.folyn/extensions-data/<extensionId>/<rel>` — the
 *                      data dir, separate from the code dir so re-installs
 *                      (which wipe the code dir) cannot destroy data.
 * @param stream        Streaming-event callback (sandbox iframe transport
 *                      only). Pushed once per `ExtensionAiStreamEvent` during a
 *                      long-running `ai:chat` call. Tool-window fetch transport
 *                      passes `undefined` → `ai:chat` starts a background
 *                      chat job and returns `{ jobId }`; the caller drains
 *                      deltas via `ai:chat-poll` until `done`.
 */
export async function dispatchExtensionRpc(
  manifest: ExtensionManifest,
  extensionId: string,
  method: string,
  params: unknown,
  resolvePath: (relativePath: string) => Promise<string>,
  stream?: (event: ExtensionAiStreamEvent) => void,
): Promise<unknown> {
  const perms = manifest.permissions;

  switch (method) {
    // ── fs (scoped to extension data dir) ──
    case 'fs:read': {
      const { path } = (params ?? {}) as { path?: string };
      if (typeof path !== 'string') throw new Error('fs:read requires { path }');
      if (!perms?.fs || !isPathInScope(path, perms.fs.scope)) {
        throw new Error(`fs:read denied: path out of scope: ${path}`);
      }
      const abs = await resolvePath(path);
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      return readTextFile(abs);
    }
    case 'fs:write': {
      const { path, content } = (params ?? {}) as { path?: string; content?: string };
      if (typeof path !== 'string' || typeof content !== 'string') {
        throw new Error('fs:write requires { path, content }');
      }
      if (!perms?.fs || !isPathInScope(path, perms.fs.scope)) {
        throw new Error(`fs:write denied: path out of scope: ${path}`);
      }
      const abs = await resolvePath(path);
      const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs');
      const { dirname } = await import('@tauri-apps/api/path');
      const dir = await dirname(abs);
      if (dir) await mkdir(dir, { recursive: true }).catch(() => {});
      return writeTextFile(abs, content);
    }
    case 'fs:list': {
      const { path } = (params ?? {}) as { path?: string };
      if (typeof path !== 'string') throw new Error('fs:list requires { path }');
      if (!perms?.fs || !isPathInScope(path, perms.fs.scope)) {
        throw new Error(`fs:list denied: path out of scope: ${path}`);
      }
      const abs = await resolvePath(path);
      const { readDir } = await import('@tauri-apps/plugin-fs');
      return readDir(abs);
    }

    // ── http (origin allowlist) ──
    //
    // Routed through the Rust `extension_http_fetch` command rather than a
    // host-webview `fetch()`. The host webview's CSP `connect-src` does not
    // include extension-declared origins, so a direct `fetch()` is blocked in
    // release (dev does not inject CSP, masking the bug). The JS-side
    // `isOriginAllowed` fast-fails before the IPC hop; the Rust command
    // re-checks against the on-disk `manifest.json` `permissions.http.origins`
    // as defense-in-depth, then performs the request with `reqwest` (no CSP).
    case 'http:fetch': {
      const { url, init } = (params ?? {}) as { url?: string; init?: RequestInit };
      if (typeof url !== 'string') throw new Error('http:fetch requires { url }');
      if (!perms?.http || !isOriginAllowed(url, perms.http.origins)) {
        throw new Error(`http:fetch denied: origin not allowed: ${url}`);
      }
      const { invoke } = await import('@tauri-apps/api/core');
      const resp = await invoke<{ status: number; headers: Record<string, string>; body: string }>(
        'extension_http_fetch',
        { extensionId, url, method: typeof init?.method === 'string' ? init.method : undefined, headers: normalizeHeaders(init?.headers), body: typeof init?.body === 'string' ? init.body : undefined },
      );
      return { status: resp.status, headers: resp.headers, body: resp.body };
    }

    // ── clipboard ──
    case 'clipboard:read': {
      if (!hasPermission(manifest, 'clipboard')) {
        throw new Error('clipboard:read denied: clipboard permission not granted');
      }
      const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
      return readText();
    }
    case 'clipboard:write': {
      const { text } = (params ?? {}) as { text?: string };
      if (typeof text !== 'string') throw new Error('clipboard:write requires { text }');
      if (!hasPermission(manifest, 'clipboard')) {
        throw new Error('clipboard:write denied: clipboard permission not granted');
      }
      const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
      return writeText(text);
    }
    case 'clipboard:read-image': {
      if (!hasPermission(manifest, 'clipboard')) {
        throw new Error('clipboard:read-image denied: clipboard permission not granted');
      }
      // Change-count gate: while an image sits UNCHANGED on the clipboard,
      // a naive poll re-decodes + re-base64s + re-IPCs the full image every
      // second (observed on Windows: multi-MB screenshot → the main webview
      // (this window's UI thread) saturated → whole-app freeze). The count is
      // NSPasteboard changeCount (macOS) / GetClipboardSequenceNumber
      // (Windows) — a microsecond no-payload read; when it matches the count
      // at our last full read, return `{ unchanged: true }` instead.
      // `params.full` forces a full read (a fresh extension realm has no
      // copy of the previous image and must fetch it once). -1 (Linux /
      // command missing on an older binary) = no gate, always full read.
      // ponytail: module-level cache is shared across extensions — correct,
      // it mirrors global clipboard state, not per-extension state.
      const wantsFull = (params as { full?: boolean } | undefined)?.full === true;
      const { invoke } = await import('@tauri-apps/api/core');
      const count = await invoke<number>('clipboard_change_count').catch(() => -1);
      if (!wantsFull && count >= 0 && imageCache.count === count) {
        return { unchanged: true };
      }
      const { readImage } = await import('@tauri-apps/plugin-clipboard-manager');
      let img: Awaited<ReturnType<typeof readImage>>;
      try {
        img = await readImage();
      } catch (err) {
        // arboard ContentNotAvailable: no image flavor on the clipboard
        // (e.g. text was copied). That is a normal state, not an error —
        // `null` keeps the RPC contract total.
        if (isContentNotAvailable(err)) return null;
        throw err;
      }
      const [rgba, size] = await Promise.all([img.rgba(), img.size()]);
      const payload = { rgba: bytesToBase64(rgba), w: size.width, h: size.height };
      imageCache.count = count;
      imageCache.payload = payload;
      return payload;
    }

    case 'clipboard:write-image': {
      // Takes { png } — base64 PNG, the storage form extensions keep. The
      // DECODE happens Rust-side (JsImage::Bytes → Image::from_bytes, enabled
      // by tauri's image-png feature) — JS-side canvas decoding proved
      // unreliable for large images (wrong rgba lengths / engine hangs), and
      // this avoids transferring raw RGBA (4× PNG size) over the bridge at all.
      const p = (params ?? {}) as { png?: unknown };
      if (typeof p.png !== 'string' || p.png.length < 8) {
        throw new Error('clipboard:write-image requires { png }');
      }
      if (!hasPermission(manifest, 'clipboard')) {
        throw new Error('clipboard:write-image denied: clipboard permission not granted');
      }
      const bytes = base64ToBytes(p.png);
      const { writeImage } = await import('@tauri-apps/plugin-clipboard-manager');
      // Uint8Array → JsImage::Bytes (serde untagged) → Rust PNG decode.
      return writeImage(bytes);
    }

    // ── dialog ──
    case 'dialog:confirm': {
      const { message } = (params ?? {}) as { message?: string };
      if (typeof message !== 'string') throw new Error('dialog:confirm requires { message }');
      if (!hasPermission(manifest, 'dialog')) {
        throw new Error('dialog:confirm denied: dialog permission not granted');
      }
      const { confirm } = await import('@tauri-apps/plugin-dialog');
      return confirm(message, { kind: 'warning' });
    }
    case 'dialog:open': {
      if (!hasPermission(manifest, 'dialog')) {
        throw new Error('dialog:open denied: dialog permission not granted');
      }
      const { open } = await import('@tauri-apps/plugin-dialog');
      return open();
    }
    case 'dialog:save': {
      const { content } = (params ?? {}) as { content?: string };
      if (typeof content !== 'string') throw new Error('dialog:save requires { content }');
      if (!hasPermission(manifest, 'dialog')) {
        throw new Error('dialog:save denied: dialog permission not granted');
      }
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      const filePath = await save();
      if (!filePath) return null;
      return writeTextFile(filePath, content);
    }

    // ── vault ──
    case 'vault:read-active-doc': {
      if (!hasPermission(manifest, 'vault:read-active')) {
        throw new Error('vault:read-active-doc denied: vault.readActive not granted');
      }
      const { useEditorStore } = await import('@/store/editorStore');
      const store = useEditorStore.getState();
      const activeTab = store.tabs.find((t) => t.id === store.activeTabId);
      if (!activeTab) return null;
      return { path: activeTab.path, content: activeTab.content };
    }
    case 'vault:read-binary': {
      // Binary file read for sandbox File Viewer (doc §29). Returns the
      // bytes of the active document (vault-relative path) as Uint8Array —
      // no raw Tauri in the sandbox; structured-cloned over postMessage.
      if (!hasPermission(manifest, 'vault:read-binary')) {
        throw new Error('vault:read-binary denied: vault.readBinary not granted');
      }
      const { useEditorStore } = await import('@/store/editorStore');
      const { useVaultStore } = await import('@/store/vaultStore');
      const editor = useEditorStore.getState();
      const tab = editor.tabs.find((t) => t.id === editor.activeTabId);
      if (!tab?.path) throw new Error('vault:read-binary: no active document path');
      const vaultRoot = useVaultStore.getState().currentVault?.basePath ?? '';
      if (!vaultRoot) throw new Error('vault:read-binary: no active vault');
      const { join } = await import('@tauri-apps/api/path');
      const { readFile } = await import('@tauri-apps/plugin-fs');
      // Restrict to the active vault root so a sandbox extension can't escape.
      const abs = await join(vaultRoot, tab.path);
      return new Uint8Array(await readFile(abs));
    }
    case 'vault:insert-content': {
      const { content } = (params ?? {}) as { content?: string };
      if (typeof content !== 'string') throw new Error('vault:insert-content requires { content }');
      if (!hasPermission(manifest, 'vault:insert-content')) {
        throw new Error('vault:insert-content denied: vault.insertContent not granted');
      }
      const { useEditorStore } = await import('@/store/editorStore');
      const store = useEditorStore.getState();
      const activeTab = store.tabs.find((t) => t.id === store.activeTabId);
      if (!activeTab) throw new Error('no active tab to insert content into');
      store.updateTabContent(activeTab.id, activeTab.content + '\n' + content);
      return { ok: true };
    }

    // ── window (tool window) ──
    case 'window:open': {
      if (!hasPermission(manifest, 'window')) {
        throw new Error('window:open denied: window permission not granted');
      }
      const { toolId } = (params ?? {}) as { toolId?: string };
      if (typeof toolId !== 'string') throw new Error('window:open requires { toolId }');
      // Tool windows are opened by the host's toolWindowStore when the user
      // runs the corresponding "Open: <tool>" command. The RPC method exists
      // so extensions can request their own tool window programmatically; MVP
      // returns a stub because the actual open is a host-side concern.
      return { opened: true, toolId };
    }

    // ── storage (same backend + namespace as the trusted api.storage slot;
    //    non-sensitive own-namespace data, no permission flag — like env) ──
    case 'storage:get': {
      const { key } = (params ?? {}) as { key?: string };
      if (typeof key !== 'string') throw new Error('storage:get requires { key }');
      const { storageClient } = await import('@/utils/storageClient');
      return storageClient.get(extensionStoragePrefix(extensionId) + key);
    }
    case 'storage:set': {
      const { key, value } = (params ?? {}) as { key?: string; value?: unknown };
      if (typeof key !== 'string') throw new Error('storage:set requires { key, value }');
      const { storageClient } = await import('@/utils/storageClient');
      await storageClient.set(extensionStoragePrefix(extensionId) + key, value ?? null);
      return { ok: true };
    }

    // ── env (host theme + locale; non-sensitive, no permission flag) ──
    case 'env:get': {
      const [{ useAppearanceStore }, { useLocaleStore }] = await Promise.all([
        import('@/store/appearanceStore'),
        import('@/store/localeStore'),
      ]);
      const theme = resolveSystemTheme(useAppearanceStore.getState().theme);
      const locale = useLocaleStore.getState().locale;
      return { theme, locale };
    }

    // ── ai (sandbox streaming over postMessage; poll-based job streaming for
    //    the tool-window fetch transport, which has no stream channel) ──
    case 'ai:pairs': {
      if (!perms?.ai?.chat) {
        throw new Error('ai:pairs denied: permissions.ai.chat not granted');
      }
      const [{ useAiConfigStore }, { allProviders, providerDisplayName }, { default: i18n }, { providerIconUrl }] =
        await Promise.all([
          import('@/store/aiConfigStore'),
          import('@/services/providers/catalog'),
          import('@/i18n'),
          import('@/services/providers/icon'),
        ]);
      const state = useAiConfigStore.getState();
      const t = (k: string) => i18n.t(k);
      const pairs: { provider: string; model: string; label?: string; iconUrl?: string }[] = [];
      for (const entry of allProviders(state.customerProviders)) {
        const slot = state.providerSettings[entry.id];
        if (!slot || !slot.enabled) continue;
        const label = providerDisplayName(entry, t);
        const iconUrl = providerIconUrl(entry.id);
        for (const model of slot.selectedModelIds) {
          pairs.push({ provider: entry.id, model, ...(label ? { label } : {}), ...(iconUrl ? { iconUrl } : {}) });
        }
      }
      // The RPC transports serve origins that cannot load host-relative asset
      // URLs (tool windows: folyn-extension://, sandbox iframes: opaque) —
      // inline the SVG as a data URL so <img src> works everywhere.
      return Promise.all(pairs.map(async (p) => {
        if (!p.iconUrl) return p;
        try {
          const svg = await (await fetch(p.iconUrl)).text();
          return { ...p, iconUrl: `data:image/svg+xml,${encodeURIComponent(svg)}` };
        } catch {
          const copy = { ...p };
          delete copy.iconUrl;
          return copy;
        }
      }));
    }
    case 'ai:chat': {
      if (!perms?.ai?.chat) {
        throw new Error('ai:chat denied: permissions.ai.chat not granted');
      }
      const { sessionId, prompt, provider, model, images } = (params ?? {}) as {
        sessionId?: string; prompt?: string; provider?: string; model?: string;
        images?: { data?: unknown; mediaType?: unknown }[];
      };
      if (typeof sessionId !== 'string' || typeof prompt !== 'string') {
        throw new Error('ai:chat requires { sessionId, prompt }');
      }
      if (
        images !== undefined && (!Array.isArray(images) || images.some((i) =>
          typeof i?.data !== 'string' || typeof i?.mediaType !== 'string'))
      ) {
        throw new Error('ai:chat images must be { data: base64, mediaType }[]');
      }
      const imgs = images && images.length > 0
        ? images.map((i) => ({ data: i.data as string, mediaType: i.mediaType as string }))
        : undefined;
      const { useAiConfigStore, resolvePairConfig } = await import('@/store/aiConfigStore');
      // Explicit (provider, model) override from the extension, else the
      // per-caller extensionPair. Same resolution as the trusted capability.
      const override = provider && model ? { provider, model } : null;
      const cfg = resolvePairConfig(override ?? useAiConfigStore.getState().extensionPair ?? null);
      if (!cfg) {
        throw new Error(
          override
            ? `pair (${provider}, ${model}) is not configured — pick one from ai:pairs`
            : 'host AI not configured — pick a (provider, model) pair in Extensions Settings',
        );
      }
      const rigParams = {
        sessionId,
        prompt,
        provider: cfg.provider,
        model: cfg.model,
        apiKey: cfg.apiKey,
        ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
        ...(cfg.thinkingBudget != null ? { thinkingBudget: cfg.thinkingBudget } : {}),
        ...(cfg.adapterFamily ? { adapterFamily: cfg.adapterFamily } : {}),
        ...(imgs ? { images: imgs } : {}),
      };
      // Iframe transport: forward every event as it arrives.
      if (stream) {
        await runRigChat({
          ...rigParams,
          onEvent: (e: CliStreamEvent) => {
            const mapped = mapSandboxEvent(e);
            if (mapped) stream(mapped);
          },
        });
        return undefined;
      }
      // Tool-window fetch transport: no stream channel — start the chat as a
      // pollable job and return immediately. Deltas accumulate on the job;
      // `ai:chat-poll` drains them. runRigChat rejects on error events, so the
      // catch + finally cover both the error and done flags.
      const jobId = crypto.randomUUID();
      const job: ChatJob = { text: '', thinking: '', done: false };
      CHAT_JOBS.set(jobId, job);
      void runRigChat({
        ...rigParams,
        onEvent: (e: CliStreamEvent) => {
          if (e.type === 'text' && e.content) job.text += e.content;
          else if (e.type === 'thinking' && e.content) job.thinking += e.content;
          else if (e.type === 'error') job.error = e.content ?? 'chat error';
        },
      })
        .catch((err: unknown) => {
          job.error = err instanceof Error ? err.message : String(err);
        })
        .finally(() => {
          job.done = true;
          setTimeout(() => CHAT_JOBS.delete(jobId), 600_000);
        });
      return { jobId };
    }
    case 'ai:chat-poll': {
      if (!perms?.ai?.chat) {
        throw new Error('ai:chat-poll denied: permissions.ai.chat not granted');
      }
      const { jobId } = (params ?? {}) as { jobId?: string };
      if (typeof jobId !== 'string') throw new Error('ai:chat-poll requires { jobId }');
      const job = CHAT_JOBS.get(jobId);
      // Unknown jobId (already drained + deleted, or never existed): report
      // done so a caller that lost the final poll response doesn't hang.
      if (!job) return { done: true };
      const out = {
        done: job.done,
        ...(job.error ? { error: job.error } : {}),
        text: job.text,
        thinking: job.thinking,
      };
      job.text = '';
      job.thinking = '';
      if (job.done) CHAT_JOBS.delete(jobId);
      return out;
    }

    default:
      throw new Error(`unknown RPC method: ${method}`);
  }
}
