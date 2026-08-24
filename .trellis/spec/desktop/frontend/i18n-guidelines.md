# i18n Guidelines

> Executable contracts for internationalizing Mochi desktop UI. zh/en supported.

## Scope / Trigger

Applies to any code change that:
- Adds or modifies user-visible UI text (button labels, titles, tooltips, empty states, toast/dialog messages)
- Adds a Tauri invoke command whose errors reach the user (toast/dialog)
- Touches a Zustand store that surfaces user-visible messages
- Touches `apps/desktop/src/i18n/` or `apps/desktop/src/services/tauriInvoke.ts`

Pure log strings, OS-level error text, and code comments are OUT OF SCOPE (leave raw).

## Architecture (Signatures + Contracts)

### i18next init

`apps/desktop/src/i18n/index.ts` is the SINGLE init site. It is imported as a side-effect at the top of `apps/desktop/src/main.tsx` (`import './i18n'`).

```ts
export const SUPPORTED_LOCALES = ['zh', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const LOCALE_STORAGE_KEY = 'mochi:locale';
export const NAMESPACES = ['common','shell','topbar','sidebar','settings','vault','editor','search','ai','schedule','study','rustErrors','pet'] as const;

export function detectInitialLocale(): Locale  // localStorage > navigator.language > 'zh'
```

- `fallbackLng: 'zh'`
- `defaultNS: 'common'`
- `returnNull: false` — a missing key NEVER returns null; it returns the key string itself + fires `missingKeyHandler` (console.warn). UI never breaks on a missing key.
- Static JSON imports (no lazy loading) — bundle size is bounded; revisit only if total i18n JSON > 200KB gzipped.

### localeStore

`apps/desktop/src/store/localeStore.ts` — zustand store, OWN localStorage key `mochi:locale` (NOT the centralized `settings:all` blob).

**Why the deviation from `appearanceStore`'s `settings:all` slice pattern**: i18next needs the locale SYNCHRONOUSLY at module init, but `settings:all` hydrates async via `loadSettings()`. A dedicated key is readable at `i18n.init` time. Documented at `localeStore.ts:4-9` with a `ponytail:` comment naming the upgrade path.

```ts
export const useLocaleStore = create<LocaleState>((set, get) => ({
  locale: detectInitialLocale(),
  setLocale: (lg) => { persistLocale(lg); void i18n.changeLanguage(lg); set({ locale: lg }); },
  hydrate: () => { /* re-reads detectInitialLocale, syncs i18n */ },
}));
```

### Cross-window locale sync (non-obvious)

Each Tauri webview window (`pet` / `pet-panel` / `pet-bubble` / `voice-orb` / `main`) is a **separate JS realm with its own i18next + localeStore instance**. `setLocale` in the main window updates only the main window's store/i18n — secondary windows stay at their module-load locale until explicitly notified.

**Pattern**: `setLocale` emits a `locale://changed` event (Tauri 2 `emit` is global — reaches all windows); secondary windows listen and call `i18n.changeLanguage(lg)` + `useLocaleStore.setState({ locale: lg })` on their own instance. Mirrors the `pet://icon-changed` cross-window sync pattern (see `tauri-window-patterns.md`).

**Why not just read localStorage**: secondary windows DO share localStorage with main on macOS WKWebView (same `WKWebsiteDataStore`), but the i18next instance is already initialized at module load with the then-current locale; `i18n.language` won't refresh without an explicit `changeLanguage` call. The event broadcast is what triggers that call.

**Consumers that read `i18n.language` in a secondary window** (e.g. `openPetContextMenu` passing locale to Rust for native menu localization) rely on this listener being mounted. Without it, the right-click menu would lag the user's last locale switch until the pet window reloads.

**Reference impl**: `localeStore.ts::emitLocaleChanged` + `PetApp.tsx` listener (mirrored by `PetPanelApp` / `PetBubbleApp` / `VoiceOrbApp` if they need localized strings).

### Resource JSON

`apps/desktop/src/i18n/locales/{zh,en}/<namespace>.json` — flat key trees per namespace. zh and en MUST have identical key trees. Enforced by `apps/desktop/src/i18n/extracted-namespaces.test.ts` (recursive key-path parity check across every namespace in `NAMESPACES`).

## Contracts

### React components — `useTranslation()` hook

```tsx
import { useTranslation } from 'react-i18next';

export function MyComponent() {
  const { t } = useTranslation();
  return <button title={t('topbar:menu')}>{t('topbar:ai.panel')}</button>;
}
```

**Namespace prefix is mandatory**: `t('ns:key.path')` — NOT `t('key.path')`. i18next's default `nsSeparator` is `:`; without it the key resolves to the `common` namespace and returns the literal key string. Smoke-test `missing-key fallback` covers the common case but won't catch a namespace typo.

### Non-React store/service layer — `i18n` singleton

Stores and pure-function helpers can't call `useTranslation()` (it's a hook). Use the singleton:

```ts
import i18n from '@/i18n';

// inside a Zustand action / async helper:
const msg = i18n.t('schedule:toast.taskCreated', { title });
```

This pattern is established at `scheduleStore.ts` (toast strings), `useDragDrop.ts`, `PanelErrorBoundary.tsx`, `PluginsSettings.tsx` (module-scope label helpers).

### Rust `AppError` contract

`apps/desktop/src-tauri/src/errors.rs` — `AppError` enum (Io / NotFound / Permission / Internal). Serde serializes to:

```json
{ "category": "notFound", "detail": "vault config not found: /Users/.../vault.json" }
```

`From<io::Error>` maps `ErrorKind::NotFound` → `NotFound`, `PermissionDenied` → `Permission`, else → `Io`. `From<String>` collapses every legacy `.map_err(|e| e.to_string())` site to `Internal` so command signatures flip without touching helper bodies.

User-visible invoke commands return `Result<T, AppError>`. Internal helpers can stay `Result<_, String>` and auto-convert at the command boundary via `?`.

### Frontend invoke wrapper

`apps/desktop/src/services/tauriInvoke.ts` — drop-in replacement for `@tauri-apps/api/core`'s `invoke`:

```ts
export class AppInvocationError extends Error {
  constructor(public readonly category: string, public readonly detail: string) { ... }
  translatedTitle(): string   // i18n.t(`rustErrors:${category}.title`)
  translatedMessage(): string // i18n.t(`rustErrors:${category}.message`, { detail })
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>
```

The `err as AppErrorShape` cast at the catch site is acceptable — Tauri invoke rejects with `unknown`; this is the type-narrowing at the trust boundary.

## Validation & Error Matrix

| Condition | Behavior |
|-----------|----------|
| Missing i18n key | `t()` returns the key string; `missingKeyHandler` calls `console.warn('[i18n] missing key: <key>')` |
| Missing namespace (not in `NAMESPACES`) | resource lookup returns the key string (same as missing key) |
| zh/en key-tree mismatch | `extracted-namespaces.test.ts` fails with the diff'd key paths |
| Rust invoke throws `{category, detail}` | `tauriInvoke` throws `AppInvocationError`; `translatedMessage()` returns localized text |
| Rust invoke throws plain string (legacy) | `tauriInvoke` wraps as `category: 'internal'`, `detail: String(err)` |
| localStorage unavailable (SSR/test) | `detectInitialLocale()` falls back to `navigator.language` → `'zh'`; `persistLocale` swallows the throw |

## Patterns

### Good — namespace-prefixed call with interpolation

```tsx
const { t } = useTranslation();
return <p>{t('vault:deleteConfirm.message', { name: vault.name })}</p>;
```

zh: `"确定要删除 Vault「{{name}}」吗？此操作不会删除磁盘上的文件。"`
en: `"Are you sure you want to delete vault \"{{name}}\"? This won't delete files on disk."`

### Good — array return for weekday lists

```ts
const weekdays = t('schedule:weekGrid.weekdays', { returnObjects: true }) as string[];
```

zh: `["日","一",...]`, en: `["Sun","Mon",...]`. Parity enforced by key-tree test.

### Good — split bold-span messages

When a message contains a bold `<strong>` run, split into `prefix` + `suffix` keys so the bold span stays in JSX (never smuggle HTML through i18next):

```tsx
<p>
  {t('vault:deleteConfirm.prefix')} <strong>{vault.name}</strong> {t('vault:deleteConfirm.suffix')}
</p>
```

### Good — store-layer toast via singleton

```ts
// scheduleStore.ts
import i18n from '@/i18n';
get().toast(i18n.t('schedule:toast.taskCreated', { title: task.title }));
```

## Wrong vs Correct

### Wrong — bare `t('key')` without namespace

```tsx
// Bad: resolves against the `common` namespace; returns the literal key string.
const { t } = useTranslation();
return <button>{t('settings.appearance.title')}</button>;
```

```tsx
// Correct: namespace prefix routes to the settings bundle.
return <button>{t('settings:appearance.title')}</button>;
```

### Wrong — calling `useTranslation()` outside a React component

```ts
// Bad: scheduleStore action can't call a hook.
import { useTranslation } from 'react-i18next';
get().toast(useTranslation().t('schedule:toast.taskCreated'));
```

```ts
// Correct: use the singleton i18n instance.
import i18n from '@/i18n';
get().toast(i18n.t('schedule:toast.taskCreated'));
```

### Wrong — putting locale in `settings:all`

```ts
// Bad: settings:all hydrates ASYNC; i18n.init needs the locale at module load.
registerPersistSlice({ keys: ['locale'], /* ... */ });
```

```ts
// Correct: dedicated `mochi:locale` localStorage key, sync-readable.
persistLocale(lg) { window.localStorage?.setItem(LOCALE_STORAGE_KEY, lg); }
```

## Tests Required

| Test | File | Asserts |
|------|------|---------|
| Locale detection (localStorage > navigator.language > zh) | `src/i18n/localeStore.test.ts` | `detectInitialLocale()` returns `'en'` when `navigator.language = 'en-US'` |
| Locale switch live-persists | `src/i18n/localeStore.test.ts` | After `setLocale('en')`: `i18n.language === 'en'` AND `localStorage.getItem('mochi:locale') === 'en'` |
| Missing-key fallback (no throw) | `src/i18n/localeStore.test.ts` | `i18n.t('common.__missing__')` returns the key string |
| zh/en key-tree parity per namespace | `src/i18n/extracted-namespaces.test.ts` | For every `ns` in `NAMESPACES`: every key path in zh exists in en and vice versa |
| Every namespace registered in `index.ts` | `src/i18n/extracted-namespaces.test.ts` | `i18n.hasResourceBundle(lng, ns)` for each `(lng, ns)` pair |
| `tauriInvoke` wraps `{category, detail}` rejection | `src/services/tauriInvoke.test.ts` | Throws `AppInvocationError` with `.category === 'notFound'` AND `translatedTitle()` returns the rustErrors title for the current locale |
| Legacy string rejection → `internal` | `src/services/tauriInvoke.test.ts` | `category === 'internal'` |

## Common Mistakes

### Forgetting the namespace prefix

**Symptom**: UI renders the literal key string (e.g. `settings.appearance.title`) instead of the translated text.

**Cause**: Called `t('settings.appearance.title')` instead of `t('settings:appearance.title')`.

**Fix**: Add the `ns:` prefix. i18next's default `nsSeparator` is `:`.

**Prevention**: The smoke test only catches missing keys, not namespace typos. Code review for the `:` prefix when adding new `t()` calls.

### Adding a namespace without registering in `index.ts`

**Symptom**: `t('newNs:key')` returns the key string even though the JSON file exists.

**Cause**: Created `locales/zh/newNs.json` but forgot to `import` it and add to `NAMESPACES` + `resources.zh` in `i18n/index.ts`.

**Fix**: Add the import + resources entry + NAMESPACES entry. The `extracted-namespaces.test.ts` test will catch this — it asserts `i18n.hasResourceBundle(lng, ns)` for every entry in `NAMESPACES`.

### Breaking zh/en key-tree parity

**Symptom**: `extracted-namespaces.test.ts` fails with a diff'd key path.

**Cause**: Added a key to zh JSON but forgot the en mirror (or vice versa).

**Fix**: Mirror the key in the other locale. The test message names the exact key path.

### Breaking legacy Chinese-string assertions in tests

**Symptom**: Existing test (e.g. `ActivityBar.test.tsx` uses `getByTitle('设置')`) fails after extraction.

**Cause**: The zh JSON produces different text than the original raw string, OR the test setup doesn't initialize i18n with zh.

**Fix**: `test/setup.desktop.ts` imports `@/i18n` and calls `i18n.changeLanguage('zh')` so legacy assertions hold — ensure your zh JSON faithfully reproduces the original Chinese. If you intentionally changed the text, update the test to assert via `getByRole({ name: t('ns:key') })` or `getByTestId`.

## Out of Scope (deferred)

These remain raw Chinese intentionally — out of PRD MVP scope:
- Internal log strings + Rust internal log messages
- OS-level error strings (passed through as `detail` interpolation param)
- Plugin manifest title/description localization
- Code comments (Chinese comments stay)
- Third language support (ja/ko etc.) — extend `SUPPORTED_LOCALES` + add JSON
- i18n resource lazy loading — revisit when total JSON > 200KB gzipped
