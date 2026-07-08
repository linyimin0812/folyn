/**
 * Host RPC bridge for sandbox-tier plugins.
 *
 * This is the host-mediation boundary: sandboxed iframe plugins (origin
 * `quill-plugin://localhost`, `sandbox="allow-scripts"` without
 * `allow-same-origin`) NEVER get raw Tauri APIs. Every privileged operation
 * goes through a postMessage RPC that this bridge validates against the
 * plugin's declared permissions before executing.
 *
 * Message protocol:
 *   iframe → host: { type: 'request',     id, method, params }
 *   host → iframe: { type: 'response',    id, result?, error? }
 *   host → iframe: { type: 'lifecycle',   event: 'activate' | 'deactivate' }
 *   host → iframe: { type: 'invoke',      id, command, params? }
 *   iframe → host: { type: 'invoke-result', id, result?, error? }
 */

import type { PluginManifest, PluginPermissions } from '@quill/plugin-host';

// ── Pure capability-checking helpers (exported for unit testing) ─────────────

/**
 * Check whether a relative path (sent by the plugin in an RPC request) falls
 * within the declared `permissions.fs.scope` patterns.
 *
 * Scope entries are glob patterns relative to the plugin's root dir:
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

/**
 * Normalize a `RequestInit.headers` value (which may be a `Headers`, a plain
 * `Record`, or an array of `[key, value]` tuples) into a plain string map for
 * Tauri IPC serialization. Non-string-coercible entries are skipped. Returns
 * `undefined` when there are no headers so the Rust `Option<HashMap>` receives
 * `None`.
 */
function normalizeHeaders(
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
 * Check whether the manifest grants a specific capability. Used by the bridge
 * to gate methods that require a boolean permission flag.
 */
export function hasPermission(manifest: PluginManifest, capability: string): boolean {
  const perms: PluginPermissions | undefined = manifest.permissions;
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

type PluginMessage = RpcRequest | RpcResponse | LifecycleMessage | InvokeMessage | InvokeResultMessage;

// ── RpcBridge ────────────────────────────────────────────────────────────────

export interface RpcBridgeOptions {
  pluginId: string;
  manifest: PluginManifest;
  /** Returns the iframe's contentWindow (may be null before load). */
  targetWindow: () => Window | null;
  /** Called for messages the bridge doesn't handle (e.g. custom events). */
  onUnhandled?: (msg: PluginMessage) => void;
  /**
   * Optional injectable path resolver for tests. In production this uses
   * Tauri's homeDir + join. Returns an absolute path string.
   */
  resolvePluginPath?: (relativePath: string) => Promise<string>;
}

/**
 * Manages the postMessage RPC channel between the host and a sandboxed plugin
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

  constructor(opts: RpcBridgeOptions) {
    this.opts = opts;
    this.attachListener();
  }

  /** Process an incoming message from the iframe. Called by the message listener. */
  async handleMessage(data: unknown, source: Window | null): Promise<void> {
    if (this.disposed) return;
    if (!data || typeof data !== 'object') return;
    const msg = data as PluginMessage;
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

  /** Invoke a command handler inside the plugin iframe. Resolves when the
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
          reject(new Error(`plugin command timed out: ${command}`));
        }
      }, 30_000);
    });
  }

  /** Remove the message listener and reject all pending invokes. */
  dispose(): void {
    this.disposed = true;
    if (this.listener) {
      window.removeEventListener('message', this.listener);
      this.listener = null;
    }
    for (const [, { reject }] of this.pendingInvokes) {
      reject(new Error('bridge disposed'));
    }
    this.pendingInvokes.clear();
  }

  // ── Internal ──

  private attachListener(): void {
    this.listener = (event: MessageEvent) => {
      void this.handleMessage(event.data, event.source as Window | null);
    };
    window.addEventListener('message', this.listener);
  }

  private send(msg: PluginMessage): void {
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
    try {
      const result = await this.dispatch(req.method, req.params);
      this.sendResponse(req.id, result);
    } catch (err) {
      this.sendResponse(req.id, undefined, err instanceof Error ? err.message : String(err));
    }
  }

  /** Dispatch an RPC method to the corresponding host capability. */
  private async dispatch(method: string, params: unknown): Promise<unknown> {
    const perms = this.opts.manifest.permissions;

    switch (method) {
      // ── fs (scoped to plugin data dir) ──
      case 'fs:read': {
        const { path } = (params ?? {}) as { path?: string };
        if (typeof path !== 'string') throw new Error('fs:read requires { path }');
        if (!perms?.fs || !isPathInScope(path, perms.fs.scope)) {
          throw new Error(`fs:read denied: path out of scope: ${path}`);
        }
        const abs = await this.resolvePath(path);
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
        const abs = await this.resolvePath(path);
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
        const abs = await this.resolvePath(path);
        const { readDir } = await import('@tauri-apps/plugin-fs');
        return readDir(abs);
      }

      // ── http (origin allowlist) ──
      //
      // Routed through the Rust `plugin_http_fetch` command rather than a
      // host-webview `fetch()`. The host webview's CSP `connect-src` does not
      // include plugin-declared origins, so a direct `fetch()` is blocked in
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
          'plugin_http_fetch',
          {
            pluginId: this.opts.pluginId,
            url,
            method: typeof init?.method === 'string' ? init.method : undefined,
            headers: normalizeHeaders(init?.headers),
            body: typeof init?.body === 'string' ? init.body : undefined,
          },
        );
        return { status: resp.status, headers: resp.headers, body: resp.body };
      }

      // ── clipboard ──
      case 'clipboard:read': {
        if (!hasPermission(this.opts.manifest, 'clipboard')) {
          throw new Error('clipboard:read denied: clipboard permission not granted');
        }
        const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
        return readText();
      }
      case 'clipboard:write': {
        const { text } = (params ?? {}) as { text?: string };
        if (typeof text !== 'string') throw new Error('clipboard:write requires { text }');
        if (!hasPermission(this.opts.manifest, 'clipboard')) {
          throw new Error('clipboard:write denied: clipboard permission not granted');
        }
        const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
        return writeText(text);
      }

      // ── dialog ──
      case 'dialog:open': {
        if (!hasPermission(this.opts.manifest, 'dialog')) {
          throw new Error('dialog:open denied: dialog permission not granted');
        }
        const { open } = await import('@tauri-apps/plugin-dialog');
        return open();
      }
      case 'dialog:save': {
        const { content } = (params ?? {}) as { content?: string };
        if (typeof content !== 'string') throw new Error('dialog:save requires { content }');
        if (!hasPermission(this.opts.manifest, 'dialog')) {
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
        if (!hasPermission(this.opts.manifest, 'vault:read-active')) {
          throw new Error('vault:read-active-doc denied: vault.readActive not granted');
        }
        const { useEditorStore } = await import('@/store/editorStore');
        const store = useEditorStore.getState();
        const activeTab = store.tabs.find((t) => t.id === store.activeTabId);
        if (!activeTab) return null;
        return { path: activeTab.path, content: activeTab.content };
      }
      case 'vault:insert-content': {
        const { content } = (params ?? {}) as { content?: string };
        if (typeof content !== 'string') throw new Error('vault:insert-content requires { content }');
        if (!hasPermission(this.opts.manifest, 'vault:insert-content')) {
          throw new Error('vault:insert-content denied: vault.insertContent not granted');
        }
        const { useEditorStore } = await import('@/store/editorStore');
        const store = useEditorStore.getState();
        const activeTab = store.tabs.find((t) => t.id === store.activeTabId);
        if (!activeTab) throw new Error('no active tab to insert content into');
        store.updateTabContent(activeTab.id, activeTab.content + '\n' + content);
        return undefined;
      }

      // ── window (tool window) ──
      case 'window:open': {
        if (!hasPermission(this.opts.manifest, 'window')) {
          throw new Error('window:open denied: window permission not granted');
        }
        const { toolId } = (params ?? {}) as { toolId?: string };
        if (typeof toolId !== 'string') throw new Error('window:open requires { toolId }');
        // MVP: the tool window is opened by the sandbox loader which has
        // access to the iframe management layer. Here we just signal back so
        // the host can decide how to render. The actual visible iframe is
        // managed by the command/tool adapter, not the RPC bridge.
        return { opened: true, toolId };
      }

      default:
        throw new Error(`unknown RPC method: ${method}`);
    }
  }

  /** Resolve a plugin-relative path to an absolute filesystem path. */
  private async resolvePath(relativePath: string): Promise<string> {
    if (this.opts.resolvePluginPath) {
      return this.opts.resolvePluginPath(relativePath);
    }
    const { homeDir, join } = await import('@tauri-apps/api/path');
    const home = await homeDir();
    return join(home, '.quill', 'plugins', this.opts.pluginId, relativePath);
  }
}
