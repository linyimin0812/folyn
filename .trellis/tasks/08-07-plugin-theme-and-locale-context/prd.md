# plugin theme and locale context

## Goal

Pass the host's current bright/dark theme and the user's locale (i18n) through to plugins so plugins that render UI can match the host's appearance and language, and react when the user switches theme or locale mid-session. Covers both trusted (in-process) and sandbox (iframe RPC) tiers.

## Requirements

- `PluginContext` exposes a single optional `env: PluginEnv` capability on the trusted tier.
- `PluginEnv` provides:
  - `readonly theme: 'light' | 'dark'` (resolved; never 'system')
  - `readonly locale: Locale` (post-`i18n.changeLanguage`, never stale)
  - `onThemeChange(cb): Disposable` — push-based subscription; cb fires on subsequent theme changes
  - `onLocaleChange(cb): Disposable` — same for locale
- Sandbox tier gets equivalent access via two RPC methods:
  - `env:get` → `{ theme: 'light'|'dark', locale: Locale }` (request/response)
  - host pushes `{ type: 'env-event', event: 'theme'|'locale', value: string }` to the iframe on change
- Plugins bring their own i18n bundles; host only signals the current locale string. No `t()` exposed.
- Subscriptions clean up via `Disposable` returned from `on*Change`, integrated with `ctx.addDisposable` on trusted tier.

## Acceptance Criteria

- [ ] `PluginEnv` type added to `packages/plugin-sdk/src/types.ts`; re-exported from `@quill/plugin-host` and `@quill/plugin-sdk`.
- [ ] `PluginContext.env?: PluginEnv` field added.
- [ ] Trusted loader wires `env` from `appearanceStore` + `localeStore` via `buildPluginEnv()` (mirrors `buildPluginAi`).
- [ ] `onThemeChange` callbacks fire when `appearanceStore.setTheme` runs; same for `onLocaleChange` vs `localeStore.setLocale`.
- [ ] Disposables returned by `on*Change` unsubscribe the cb; `ctx.addDisposable` reaps them on plugin deactivate.
- [ ] Sandbox: `env:get` RPC method in `dispatchPluginRpc` returns current `{theme, locale}`.
- [ ] Sandbox: host pushes `env-event` messages on theme/locale change (subscribed once per active sandbox plugin via the bridge).
- [ ] Unit tests: trusted build/read/subscribe/dispose; sandbox env:get + push on change.
- [ ] `docs/plugin-development.md` updated with `ctx.env` shape + sandbox `env:get`/`env-event` protocol.

## Definition of Done

- Tests added/updated (unit in `plugin-host` + desktop adapter + rpcBridge).
- Lint / typecheck / CI green.
- SDK type change is backwards-compatible (new optional `env` field).
- No new runtime dependency; reuses `appearanceStore.subscribeWithSelector`-equivalent pattern (zustand `subscribe`) and `i18n.on('languageChanged', ...)`.

## Technical Approach

### Trusted tier

```ts
// packages/plugin-sdk/src/types.ts
export interface PluginEnv {
  readonly theme: 'light' | 'dark';
  readonly locale: Locale;
  onThemeChange(cb: (theme: 'light' | 'dark') => void): Disposable;
  onLocaleChange(cb: (locale: Locale) => void): Disposable;
}

export interface PluginContext {
  readonly pluginId: string;
  readonly manifest: PluginManifest;
  readonly addDisposable(d: Disposable): void;
  readonly ai?: PluginAiCapability;
  readonly env?: PluginEnv;  // <-- new
}
```

```ts
// apps/desktop/src/services/plugin-host/envCapability.ts (new, mirrors aiCapability.ts)
export function buildPluginEnv(): PluginEnv { ... }
```

`trustedLoader.ts:136` merges `{ ...ctx, ai, env }` when calling `module.activate`.

Subscription source for theme: zustand `useAppearanceStore.subscribe((s) => s.theme)` plus a `system`→resolved resolver. For locale: `useLocaleStore.subscribe((s) => s.locale)` + `i18n.on('languageChanged', ...)` (defensive — localeStore.setLocale already calls i18n.changeLanguage; one source is enough; pick localeStore to keep single subscription).

### Sandbox tier

- Add `env:get` case in `dispatchPluginRpc` returning `{ theme, locale }` (no permission flag needed — env is non-sensitive).
- `RpcBridge` constructor subscribes to theme + locale stores; pushes `env-event` messages on change; unsubscribes in `dispose()`.

## Decision (ADR-lite)

**Context**: Plugins rendering UI need to track host theme + locale. Two tiers (trusted in-process; sandbox iframe RPC). Theme via CSS variables already works for some cases; explicit value + subscription is needed for canvas/inline-style/SVG cases and for plugins that bring their own i18n.

**Decision**: Single `ctx.env` object on trusted tier (bundles theme + locale + future extensible). Locale-only signal (no `t()` exposed — plugins bring their own i18n bundles). Sandbox tier gets parity via `env:get` RPC + push `env-event` messages.

**Consequences**: One `ctx.env` field is extensible for future env state (fontSize, accent, etc.) without proliferating top-level context fields. Sandbox RPC shape mirrors the request/push patterns already in `rpcBridge` (response/ai-stream). Plugins with their own i18n bundles own their translation lifecycle.

## Out of Scope

- Per-plugin overrides (a plugin forcing its own theme/locale on the host).
- Exposing host's i18n message bundles / `t()` function to plugins.
- Exposing other env state (fontSize, accent color, reduced motion) — follow-up.
- Sandbox plugin-side SDK shim for `env:get`/`env-event` — plugins postMessage directly per the existing rpcBridge protocol; no host-side shim in this repo yet.

## Technical Notes

- `appearanceStore` is a zustand store; `useAppearanceStore.subscribe` (the raw zustand subscribe) fires on any state change. Filter by `s.theme` to avoid spurious fires.
- `system` theme resolves to `light`/`dark` at apply time via `window.matchMedia('(prefers-color-scheme: dark)')`. The resolved value is what `document.documentElement.dataset.theme` holds — read that for the *current resolved* value, since `appearanceStore.theme` may be `'system'`.
- `localeStore` is the single source of truth for locale; `i18n.language` is kept in sync by `setLocale`.
- `Disposable` shape: `{ dispose: () => Promise<void> | void }` (already used everywhere).
- `rpcBridge.ts` `dispatchPluginRpc` is the canonical host-side method table; sandbox env methods go here.
- `trustedLoader.ts:107-148` is the activate wiring site; mirror the `ai` injection pattern.
