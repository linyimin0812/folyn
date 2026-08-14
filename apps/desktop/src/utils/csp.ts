import { useCspConfigStore, type CspMode } from '@/store/cspConfigStore';
import { settingsLoadDone } from '@/store/settingsPersistence';

/**
 * Runtime Content-Security-Policy management.
 *
 * Tauri's own CSP (tauri.conf.json `app.security.csp`) is compile-time only:
 * there is no official API to change it at runtime, and a `<meta>` tag can
 * never *relax* a CSP that Tauri already injected via response header
 * (macOS/Windows) or meta tag (Linux) — multiple policies intersect, so the
 * strictest wins. To let users configure allowed URLs from the settings UI,
 * tauri.conf.json therefore sets `csp: null` and Quill applies the policy
 * itself here: build a policy from the persisted config and swap a single
 * `<meta http-equiv="Content-Security-Policy">` tag (removing the old one
 * first, since two CSP metas would intersect instead of replace).
 *
 * The baseline directives below are the minimum Quill + Tauri need to work:
 * Tauri IPC (`ipc:` / `http://ipc.localhost`), the custom `quill-plugin:`
 * protocol, the `asset:` protocol, and `data:` / `blob:`. Users only get to
 * add *extra* hosts on top of this baseline.
 *
 * The asset protocol is served under two different schemes: `asset://localhost`
 * on macOS/Linux but `http://asset.localhost` on Windows (Tauri serves custom
 * protocols through a virtual host there). Both must appear in img-src /
 * media-src, otherwise `convertFileSrc(...)` images (custom pet icon, markdown
 * images, rich-text images, image viewer) are blocked by CSP on Windows.
 */

export interface CspConfig {
  mode: CspMode;
  /** User-entered sources (hostnames / URLs / scheme sources) for custom mode. */
  allowedUrls: string[];
}

/** Fixed baseline sources — never user-editable. */
const BASE_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", 'blob:', 'quill-plugin:'],
  "style-src": ["'self'", "'unsafe-inline'"],
  "font-src": ["'self'", 'data:'],
  "img-src": ["'self'", 'data:', 'blob:', 'asset:', 'http://asset.localhost'],
  "media-src": ["'self'", 'blob:', 'asset:', 'http://asset.localhost'],
  "connect-src": ["'self'", 'ipc:', 'http://ipc.localhost', 'quill-plugin:'],
  "worker-src": ["'self'", 'blob:'],
  "frame-src": ["'self'", 'blob:', 'data:', 'quill-plugin:'],
};

/** Directives that receive the user's custom sources (or `*` in "allow all" mode). */
const NETWORK_DIRECTIVES = [
  'script-src',
  'style-src',
  'font-src',
  'img-src',
  'media-src',
  'connect-src',
  'worker-src',
  'frame-src',
] as const;

/** Vite dev-server endpoints (HMR websocket + page origin). Only added in dev. */
const DEV_CONNECT_SOURCES = ['http://localhost:1420', 'ws://localhost:1420'];

const INVALID_SOURCE_CHARS = /[\s;'"<>]/;
// * | scheme: / scheme://... | hostname / *.hostname | host:port
const SOURCE_RE =
  /^(\*|[a-zA-Z][a-zA-Z0-9+.-]*:(\/\/)?[^\s]*|[a-zA-Z0-9*][a-zA-Z0-9.*-]*|[a-zA-Z0-9.*-]+:\d+)$/;

/** Loose validation for a user-entered CSP source (host / URL / scheme). */
export function isValidSource(input: string): boolean {
  const s = input.trim();
  if (!s || INVALID_SOURCE_CHARS.test(s)) return false;
  return SOURCE_RE.test(s);
}

/** Build the full CSP policy string from the persisted config. */
export function buildCsp(config: CspConfig, opts?: { dev?: boolean }): string {
  const isDev = opts?.dev ?? import.meta.env.DEV;
  const userSources =
    config.mode === 'all'
      ? ['*']
      : [
          ...new Set(
            config.allowedUrls
              .map((u) => u.trim())
              .filter((u) => u && isValidSource(u)),
          ),
        ];

  const directives: Record<string, string[]> = {};
  for (const [name, sources] of Object.entries(BASE_DIRECTIVES)) {
    directives[name] = [...sources];
  }
  if (isDev) {
    for (const src of DEV_CONNECT_SOURCES) {
      if (!directives['connect-src'].includes(src)) directives['connect-src'].push(src);
    }
  }
  for (const name of NETWORK_DIRECTIVES) {
    for (const src of userSources) {
      if (!directives[name].includes(src)) directives[name].push(src);
    }
  }

  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

/**
 * Apply a CSP policy by replacing the page's CSP `<meta>` tag. Removing the
 * old tag first is required: with two CSP metas in the document the browser
 * enforces the intersection (strictest) of both, which would prevent
 * *relaxing* the policy when the user edits their config.
 */
export function applyCsp(policy: string): void {
  if (typeof document === 'undefined' || !document.head) return;
  document
    .querySelectorAll('meta[http-equiv="Content-Security-Policy"]')
    .forEach((el) => el.remove());
  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = policy;
  document.head.appendChild(meta);
}

/** Build + apply the policy from the persisted CSP config store. */
export function applyCspFromStore(): void {
  applyCsp(buildCsp(useCspConfigStore.getState()));
}

let cspInitialized = false;

/**
 * Bootstrap runtime CSP: subscribe to store changes (hydration + live edits)
 * and apply exactly once after settings hydration completes.
 *
 * The first policy applied to a document is the ONLY one that can set the
 * ceiling — browsers never *relax* an already-enforced CSP, so injecting a
 * pre-hydration default first would permanently block any URL that only
 * exists in the persisted config: "adding" a URL (or switching to allow-all)
 * would never take effect, even after reload. We therefore must not touch the
 * DOM until the hydrated config is ready.
 *
 * Runs once per window from main.tsx. In the main window hydration comes
 * from disk (loadSettings -> settingsLoadDone); secondary windows (pet /
 * voice-orb) hydrate from the `pet://settings-updated` broadcast, which fires
 * the store subscription below.
 */
export function initCsp(): void {
  if (cspInitialized) return;
  cspInitialized = true;
  useCspConfigStore.subscribe(() => applyCspFromStore());
  settingsLoadDone.then(() => applyCspFromStore());
}
