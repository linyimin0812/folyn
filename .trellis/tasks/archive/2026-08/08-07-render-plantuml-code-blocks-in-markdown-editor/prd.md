# Pluggable Markdown code-block renderers (with PlantUML via plugin)

## Goal

Make fenced code blocks in Markdown preview renderable by **plugins**, without touching Folyn core for each new language. Concretely: a plugin author can declare "I render ` ```plantuml `" in their plugin manifest, and the Markdown preview dispatches to their renderer.

This also retires the existing `language-mermaid` hardcode in `MarkdownPreview.tsx` by routing mermaid through the same pluggable mechanism (as a builtin), so the dispatch path is uniform.

## What I already know

- Markdown preview: `apps/desktop/src/components/file-types/markdown/MarkdownPreview.tsx`, unified/remark pipeline.
- Dispatch site today: `componentMap['pre'] = PreWithMermaid` (MarkdownPreview.tsx:535) — hardcoded `language-mermaid` → `<MermaidBlock>`.
- `MermaidBlock` lives in `packages/container-plugins/src/plugins/MermaidPlugin.tsx` (a builtin package, not a user-installable plugin).
- PlantUML file-type plugin `plugins/folyn-plugin-plantuml` already renders `.puml` files via `plantuml-encoder` + public server `https://www.plantuml.com/plantuml/svg/<encoded>`; reusable building block for a markdown renderer.
- SDK already has a contribution-point pattern (`commands`/`fileTypes`/`containers`/`exporters`/`exportEnhancers`/...). New point follows the same shape.
- Plugin loading: `services/plugin-host/trustedLoader.ts` resolves `tier: 'trusted'` plugin manifests; adapters in `services/plugin-host/contributionAdapters.ts` (file-type/container/feature/exporter/keybinding/...) turn `contributes.*` declarations into host-registry entries. New adapter mirrors existing ones.
- Builtin container plugins are registered via `packages/container-plugins/index.ts` `registerBuiltinPlugins()`.

## Requirements

### SDK surface (`packages/plugin-sdk`)

- New contribution: `MarkdownCodeRendererContribution { language: string; aliases?: string[]; component: string }`.
- New contribution: `EditorLanguageContribution { id: string; aliases?: string[]; entry: string }` — CodeMirror language extension contributed by a plugin (resolves to a `LanguageSupport` factory via `PluginModule.editorLanguages`).
- New `ContributionPoints.markdownCodeRenderers?: MarkdownCodeRendererContribution[]`.
- New `ContributionPoints.editorLanguages?: EditorLanguageContribution[]`.
- New contract: `MarkdownCodeRendererProps { source: string; language: string; resolvedLanguage: string; filePath: string }`.
- New contract: `EditorLanguageFactory = () => LanguageSupport` (lazy — CodeMirror language modules can be heavy; factory defers construction until first use).
- New `PluginModule.markdownCodeRenderers?: Record<string, ComponentType<MarkdownCodeRendererProps>>`.
- New `PluginModule.editorLanguages?: Record<string, EditorLanguageFactory>`.

### Host wiring (`apps/desktop`)

- New adapter `registerPluginMarkdownCodeRenderers(manifest, module)` mirroring the other adapters in `contributionAdapters.ts`.
- New adapter `registerPluginEditorLanguages(manifest, module)` — same shape.
- New `markdownCodeRendererRegistry` (language + aliases → component), consulted by `MarkdownPreview` via a hook/lookup. Disposed on plugin deactivate.
- New `editorLanguageRegistry` (id + aliases → `LanguageSupport` factory). `EditorView.tsx` builds its markdown `codeLanguages` lookup to consult this registry first, falling back to `@codemirror/language-data`. A registry change (plugin load/unload) invalidates open editors' language config — MVP: affects newly-opened editors; live-migration of open editors is a follow-up.
- `MarkdownPreview.tsx` `PreWithMermaid` → `PreWithCodeRenderer`: looks up registry by `language-*` className; hits → render plugin component; miss → `CodeBlockWrapper`.

### Builtin renderer migration (mermaid)

- `container-plugins` package: register `mermaid` (+ alias `mmd`) as a builtin markdown code renderer pointing at `MermaidBlock`. Mirrors how `registerBuiltinPlugins` registers container directives.
- `container-plugins` package: also register `mermaid` (+ `mmd`) as a builtin editor language pointing at the existing `mermaidLanguage` StreamLanguage (currently hardcoded in `apps/desktop/src/editor/extensions/`). Remove the hardcoded `mermaidLanguage.ts` from `apps/desktop/src/editor/extensions/` and move it to `packages/container-plugins/src/editor-languages/` (or similar) so it ships with the builtin package.
- Remove the hardcoded `language-mermaid` branch from `MarkdownPreview.tsx`. Behavior stays identical: ` ```mermaid ` renders via `MermaidBlock` from the same package, just routed through the registry.

### PlantUML plugin (`plugins/folyn-plugin-plantuml`)

- `manifest.json` `contributes.markdownCodeRenderers`: declare `{ language: 'plantuml', aliases: ['puml', 'pu'], component: 'PlantUmlMarkdownBlock' }`.
- `manifest.json` `contributes.containers`: declare `{ name: 'plantuml', icon, label, category: 'media', component: 'PlantUmlContainerBlock', template: ':::plantuml\n@startuml\nA -> B\n@enduml\n:::' }` so `:::plantuml` directives also render.
- `manifest.json` `contributes.exportEnhancers`: declare `{ name: 'plantuml', run: 'enhancePlantUml' }` so the export pipeline can fetch the rendered `<img>` and inline the SVG (offline-safe export).
- `manifest.json` `contributes.editorLanguages`: declare `{ id: 'plantuml', aliases: ['puml', 'pu'], entry: 'plantumlLanguage' }`.
- `src/index.ts` `PluginModule.markdownCodeRenderers` / `containers` / `exportEnhancers` / `editorLanguages`: export
  - `PlantUmlMarkdownBlock` (fenced-block renderer),
  - `PlantUmlContainerBlock` (container directive — wraps the same encode/render),
  - `enhancePlantUml` (fetch the `<img>`'s SVG and replace with inline `<svg>`),
  - `plantumlLanguage` factory (returns `LanguageSupport` wrapping a `StreamLanguage` for PlantUML syntax).
  Reuse `plantuml-encoder` + `PLANTUML_SERVER` constants already in the plugin.
- `permissions.http.origins` already includes the PlantUML server (file-type preview uses it). Verify in manifest; add if missing.

### CodeMirror syntax highlighting — fully plugin-driven

- No `apps/desktop/src/editor/extensions/plantumlLanguage.ts` in core. The PlantUML plugin ships the StreamLanguage via `contributes.editorLanguages` (see above). Mirrors the `markdownCodeRenderers` design: builtin (mermaid) registers via `container-plugins` package, plugin (plantuml) registers via its manifest.

## Acceptance Criteria

- [ ] ` ```plantuml\n@startuml\nA -> B\n@enduml ` in a `.md` renders an SVG diagram in preview when the PlantUML plugin is enabled; shows source + error on render failure.
- [ ] ` ```puml ` and ` ```pu ` aliases also render.
- [ ] ` ```mermaid ` (and ` ```mmd ` alias) still renders — zero regression vs. before.
- [ ] Other fenced languages still go through `CodeBlockWrapper` (line numbers, copy, run, html toggle unaffected).
- [ ] Disabling/uninstalling the PlantUML plugin makes ` ```plantuml ` fall back to plain code block (no crash, no broken img).
- [ ] A second plugin contributing `language: 'foo'` is picked up without any `MarkdownPreview.tsx` edit (architectural proof).
- [ ] `:::plantuml\n@startuml\nA -> B\n@enduml\n:::` directive renders identically to the fenced form.
- [ ] PlantUML source in CodeMirror editor has basic syntax highlighting (`@startuml`/`@enduml`/keywords/comments distinct from prose) — via the PlantUML plugin's `contributes.editorLanguages` declaration, not a core file.
- [ ] ` ```mermaid ` fenced source retains its existing CodeMirror highlighting (mermaid migrated from core hardcoded file to builtin editor-language registration).
- [ ] Export a Markdown file containing a ` ```plantuml ` block to HTML — diagram appears (remote img URL). Export to PDF — diagram appears (either remote img or inlined SVG via enhancer, whichever the pipeline supports).
- [ ] With network offline at export time, the `enhancePlantUml` export enhancer still produces an inlined `<svg>` (fetch attempts may fail; fallback to source text in the rendered block, not a broken img).

## Definition of Done

- Type-check / lint / build green in `packages/plugin-sdk`, `packages/container-plugins`, `apps/desktop`, and `plugins/folyn-plugin-plantuml`.
- Existing `trustedLoader.test.ts` / adapter tests still pass; new adapter test for `registerPluginMarkdownCodeRenderers`.
- Manual: golden path (render), error path (bad syntax / offline), mermaid regression, disable-plugin fallback.
- SDK type exports updated (`dist/` regenerated or built).

## Technical Approach

**Dispatch shape in `MarkdownPreview.tsx`**

```ts
map['pre'] = function PreWithCodeRenderer(props) {
  const langEl = /* find first child with language-* className */;
  const lang = langEl?.props?.className?.match(/language-([\w-]+)/)?.[1];
  const Renderer = lang ? markdownCodeRendererRegistry.get(lang) : null;
  if (Renderer) {
    const source = /* extract text from code child */;
    return createElement(Renderer, { source, language: lang, resolvedLanguage: Renderer.canonicalLanguage, filePath });
  }
  return createElement(CodeBlockWrapper, { /* ...existing */ }, children);
};
```

**Registry shape**

```ts
interface MarkdownCodeRendererEntry {
  canonicalLanguage: string;   // 'plantuml' for aliases 'puml'/'pu'
  component: ComponentType<MarkdownCodeRendererProps>;
}
// Map<languageOrAlias, entry>; first-registered wins (builtin before plugin).
```

Builtins (mermaid) registered at app boot via `container-plugins` package init. Plugin-contributed renderers registered by the new adapter on plugin activate, disposed on deactivate.

## Decision (ADR-lite)

**Context**: Mermaid fenced-block rendering AND mermaid CodeMirror highlighting were both hardcoded in core (`MarkdownPreview.tsx` + `apps/desktop/src/editor/extensions/mermaidLanguage.ts`). Adding PlantUML the same way would double down on a pattern that requires core edits per language. The user wants plugin authors to contribute fenced-block renderers, editor languages, container directives, and export enhancers via manifest — full convergence.

**Decision**: Add two new contribution points — `markdownCodeRenderers` (render fenced blocks) and `editorLanguages` (CodeMirror language extensions) — mirroring the existing contribution-point pattern. Migrate mermaid (renderer + editor language) to register as builtins via `container-plugins` package. PlantUML plugin declares all four contributions (markdown renderer, container directive, export enhancer, editor language) in its manifest and exports the matching `PluginModule` entries.

**Consequences**:
- (+) Future fenced renderers / editor languages (graphviz, vega, dbml, etc.) ship as plugins with zero core changes.
- (+) Uniform dispatch path; mermaid hardcodes retired (both render + highlight).
- (−) Two new SDK contribution points + two new host adapters + two new registries. Bounded — both mirror existing patterns.
- (Risk) CodeMirror editor language registry changes don't live-migrate open editors — MVP only affects newly-opened editors. Acceptable for v1.
- (Risk) Plugin deactivation while a ` ```plantuml ` block is open: registry miss → `CodeBlockWrapper` fallback; editor language reverts to no highlighting on next editor open. Acceptable; matches "plugin disabled = feature gone".

## Out of Scope

- Live-migration of already-open CodeMirror editors when a plugin that contributes an editor language loads/unloads mid-session — MVP only guarantees newly-opened editors pick up the registry; open editors get the language set from when they were constructed.
- Local/offline PlantUML jar rendering — continues to use the public server, parity with the existing `.puml` file preview.
- Export of a standalone `.puml` file as SVG — already exists (`exportPlantUmlSvg`); not changed.

## Technical Notes

- `packages/plugin-sdk/src/types.ts` — `ContributionPoints` + new `MarkdownCodeRendererContribution`.
- `packages/plugin-sdk/src/contracts.ts` — `PluginModule` + new `MarkdownCodeRendererProps`.
- `apps/desktop/src/services/plugin-host/contributionAdapters.ts` — new adapter alongside existing ones.
- `apps/desktop/src/components/file-types/markdown/MarkdownPreview.tsx` — `PreWithMermaid` rename + registry lookup.
- `apps/desktop/src/editor/EditorView.tsx` — markdown `codeLanguages` lookup consults `editorLanguageRegistry` before falling back to `@codemirror/language-data`.
- `packages/container-plugins/src/plugins/MermaidPlugin.tsx` + `packages/container-plugins/index.ts` — register `mermaid` (+ `mmd`) as builtin renderer AND builtin editor language.
- `apps/desktop/src/editor/extensions/mermaidLanguage.ts` — moved to `packages/container-plugins/src/editor-languages/mermaid.ts` (or similar) and registered as builtin.
- `apps/desktop/src/services/exportService.ts` — `applyContainerEnhancers` walks `[data-container]` and consults `getEnhancer(name)`; fenced `plantuml` blocks rendered as `<img>` need to either (a) be wrapped in `[data-container="plantuml"]` by the renderer, or (b) be picked up by a fenced-block enhancer walk (TBD — verify export path for `<pre>` blocks during Markdown export).
- `plugins/folyn-plugin-plantuml/manifest.json` + `src/index.ts` — declare + export `PlantUmlMarkdownBlock`, `PlantUmlContainerBlock`, `enhancePlantUml`, `plantumlLanguage` factory.
