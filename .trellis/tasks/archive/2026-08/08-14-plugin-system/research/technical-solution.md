# Technical Solution — Trusted Plugin Fault Isolation

Root-cause principle: wrap plugin-contributed components **at the adapter
(the single plugin→host registration chokepoint)**, not at every render site.
Render sites (`WorkArea`, `PreviewPane`, `MarkdownPreview`) already do
`createElement(registeredComponent, …)` — if the registered component is
pre-wrapped in a boundary, the render sites need **zero change**.

## 1. The wrap helper

`apps/desktop/src/services/plugin-host/pluginBoundary.tsx` (new, ~25 lines):

```tsx
import { createElement, type ComponentType } from 'react';
import { PanelErrorBoundary } from '@/components/sidebar/PanelErrorBoundary';

/**
 * Wrap a plugin-contributed component so a render throw is isolated to this
 * surface (inline fallback, never propagates to the host tree) and recorded
 * to pluginStore. Applied once at the adapter; render sites stay untouched.
 * Each createElement(Wrapped) instance gets its own boundary → sibling
 * isolation (one broken :::box / ```lang doesn't kill its siblings).
 */
export function withPluginBoundary<P extends object>(
  Comp: ComponentType<P>,
  pluginId: string,
  surface: string,
): ComponentType<P> {
  return function PluginBoundaryWrapped(props: P) {
    return createElement(
      PanelErrorBoundary,
      { pluginId, surface },
      createElement(Comp, props),
    );
  };
}
```

## 2. `PanelErrorBoundary` — minimal extension

Current: `panelId` only, logs to console. Add `pluginId` + `surface` + record
to `pluginStore`:

```tsx
interface PanelErrorBoundaryProps {
  children: React.ReactNode;
  panelId?: string;
  /** Plugin id owning this surface. When set, the throw is recorded to
   * pluginStore so Settings → Plugins shows an "errored" indicator. */
  pluginId?: string;
  /** Diagnostics label for the fallback, e.g. "file-type:dbml:editor". */
  surface?: string;
}
```

```tsx
componentDidCatch(error: Error, info: React.ErrorInfo): void {
  const label = this.props.surface ?? this.props.panelId ?? '<unknown>';
  console.error(`[plugin-host] surface "${label}" render failed:`, error, info.componentStack);
  if (this.props.pluginId) {
    // one-way import; pluginStore exposes recordRenderError (see §5)
    pluginStore.getState().recordRenderError(this.props.pluginId, { message: error.message, label });
  }
}
```

Fallback rendering: reuse the existing "面板加载失败" card; show `surface`
instead of `panelId` when set. `getDerivedStateFromError` unchanged.

Reset: a boundary stays in error state until remount. Reactivation disposes
the registered component (adapter `dispose`), so the next mount is a fresh
boundary → error cleared. Switching tabs remounts per-instance boundaries.
Acceptable for MVP (no retry button needed).

## 3. Apply at adapters (the actual render-isolation change)

### 3a. `registerPluginFileTypes` (contributionAdapters.ts)

Where it pulls `Editor`/`Preview` off `module.handlers[entryRef]`, wrap before
registering:

```ts
const raw = module.handlers?.[c.handler];
if (!raw) { warn + skip; continue; }
const handler: FileTypeHandler = {
  ...raw,
  pluginId: manifest.id,                       // ← new (see §4)
  Editor: raw.Editor  ? withPluginBoundary(raw.Editor,  manifest.id, `file-type:${c.id}:editor`)   : undefined,
  Preview: raw.Preview ? withPluginBoundary(raw.Preview, manifest.id, `file-type:${c.id}:preview`) : undefined,
};
registerFileType(handler);
```

→ `WorkArea.tsx:210/247` (`<handler.Editor>`) and `PreviewPane.tsx:128`
(`<Preview>`) render already-wrapped components. **No edit to either file.**

### 3b. `registerPluginMarkdownCodeRenderers` (markdownCodeRendererAdapter.ts)

```ts
const raw = module.markdownCodeRenderers?.[c.component];
if (!raw) { warn + skip; continue; }
const wrapped = withPluginBoundary(raw, manifest.id, `code-renderer:${c.language}`);
registerMarkdownCodeRenderer(c.language, manifest.id, c.canonical ?? c.language, wrapped);
```

→ `MarkdownPreview.tsx:572` `createElement(renderer.component, …)` renders the
wrapped component. **No edit to MarkdownPreview.** Per-`<pre>` isolation: each
`createElement(renderer.component)` call is its own boundary instance.

### Already-wrapped surfaces (leave untouched — don't fix working code)

- Sidebar feature panels — `Sidebar.tsx:63` already wraps `entry.component`.
- Markdown container directives — `MarkdownPreview.tsx:95` already wraps per
  instance. (Wrap-at-adapter would double-wrap; leave.)
- Tool windows — separate Tauri `WebviewWindow`, isolated by construction.
- Exporters — `exporterAdapter.ts:82` already try/catch.
- Trusted commands — `commandRegistry.runCommand` swallows+logs.

## 4. `FileTypeHandler.pluginId` — SDK contract addition

`packages/plugin-sdk/src/contracts.ts` — add optional `pluginId` so the
host can attribute errors and so future tooling knows provenance:

```ts
export interface FileTypeHandler {
  id: string;
  extensions: string[];
  /** Set by the host when this handler is contributed by a plugin (absent
   * for built-ins). Used for render-error attribution. Not authored by
   * plugin developers — the host stamps it during registration. */
  pluginId?: string;
  icon?: ReactNode;
  supportedViewModes: ViewMode[];
  // …rest unchanged
}
```

Optional field → backward compatible; built-in handlers unchanged. No SDK
runtime change (type-only). Re-exported through `apps/desktop/src/components/
file-types/types.ts` already, so app consumers see it with no extra wiring.

## 5. `pluginStore` — render-error log + Settings indicator

`apps/desktop/src/store/pluginStore.ts`:

```ts
interface RenderError { message: string; label: string; ts: number; }
interface PluginState {
  // …existing
  renderErrors: Record<string /* pluginId */, RenderError[]>;
  recordRenderError(pluginId: string, e: { message: string; label: string }): void;
  clearRenderErrors(pluginId: string): void;
}
```

- `recordRenderError` caps at N (e.g. 20) per plugin to bound memory.
- Derived selector `erroredPluginIds = Object.keys(renderErrors)`.
- `PluginsSettings.tsx` shows a small "⚠ errored" badge + last message for
  plugins in `erroredPluginIds`; "clear" calls `clearRenderErrors`.

(Verify the exact existing `pluginStore` shape during impl — the API above
is the target surface; rename to match existing convention if it differs.)

## 6. `PluginHost.activate` — rollback on failure (the missing line)

`packages/plugin-host/src/PluginHost.ts`:

```ts
async activate(id: string): Promise<void> {
  const record = this.records.get(id);
  if (!record) throw new Error(`Unknown plugin: ${id}`);
  if (record.state === 'active') return;
  try {
    const loader = this.loaders.get(record.manifest.tier);
    if (!loader) throw new Error(`No loader registered for tier: ${record.manifest.tier}`);
    const plugin = await loader.load(record.manifest);
    record.plugin = plugin;
    const ctx = this.makeContext(record);
    await plugin.activate?.(ctx);
    record.state = 'active';
    record.error = undefined;
  } catch (err) {
    // Rollback disposables pushed during this activation. The trusted loader
    // registers adapters BEFORE calling module.activate(); without this reap,
    // a failed activate leaves a half-wired plugin (commands/file-types still
    // registered, components still rendering, still crashing).
    await this.reapDisposables(record);
    record.plugin = undefined;
    record.state = 'failed';
    record.error = err;
    throw err;
  }
}
```

`reapDisposables` already exists and is idempotent; each adapter's `dispose`
unregisters from its store and is safe against partial registration. Test:

```ts
// PluginHost.test.ts
test('failed activate reaps disposables registered before the throw', async () => {
  const host = new PluginHost();
  host.registerLoader(makeFakeLoader({
    activate: async (ctx) => {
      ctx.addDisposable({ dispose: () => { disposed = true; } });
      throw new Error('boom');
    },
  }));
  await expect(host.activate('p')).rejects.toThrow('boom');
  expect(host.get('p')!.state).toBe('failed');
  expect(disposed).toBe(true);   // ← the regression this prevents
});
```

## 7. Edge cases (verified during impl — no code change needed)

- **exportEnhancer invocation** (`exportService.ts:406`): already wrapped —
  `await enhancer(body, ctx).catch(() => {})`, comment line 385 "broken
  enhancer should not abort the whole export". No change.
- **editorLanguage lazy factory**: stored in the registry, called later by
  CodeMirror's `LanguageDescription.load`. CM's own load-failure path swallows
  a throwing/rejecting factory (logs, no crash). Safe by CM; no wrapper added.

## 8. Files touched (actual)

| File | Change |
|---|---|
| `services/plugin-host/pluginBoundary.tsx` | NEW — `withPluginBoundary` |
| `services/plugin-host/pluginBoundary.test.tsx` | NEW — render-throw isolation test |
| `components/sidebar/PanelErrorBoundary.tsx` | + `pluginId`/`surface` props, + pluginStore record |
| `services/plugin-host/contributionAdapters.ts` | wrap Editor/Preview in `registerPluginFileTypes` |
| `services/plugin-host/markdownCodeRendererAdapter.ts` | wrap component in `registerPluginMarkdownCodeRenderers` |
| `store/pluginStore.ts` | + `renderErrors` / `recordRenderError` / `clearRenderErrors` |
| `components/settings/PluginsSettings.tsx` | + ⚠ errored badge + clear button |
| `i18n/locales/{en,zh,ja,de,es,fr}/settings.json` | + `renderError` / `clearRenderError` keys |
| `packages/plugin-host/src/PluginHost.ts` | + `reapDisposables` in activate catch |
| `packages/plugin-host/src/PluginHost.test.ts` | + failed-activate rollback test |
| `docs/plugin-development.md` | + "Render isolation" section |

**Dropped (YAGNI):** `FileTypeHandler.pluginId` SDK field — the boundary
attributes errors via `manifest.id` passed to `withPluginBoundary` directly;
stamping `pluginId` on the handler had no consumer. SDK stays type-only,
zero runtime change.

No SDK runtime API. No render-site edits (WorkArea/PreviewPane/MarkdownPreview).
Two adapter edits + one kernel line + one new helper + one new test.
