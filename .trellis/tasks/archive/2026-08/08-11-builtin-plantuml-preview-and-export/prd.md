# PRD: Builtin PlantUML Preview & Export

## Goal
Add PlantUML as a builtin file type in the desktop app, rendered via the public
`plantuml.com` server. Support both `:::file-preview{src="*.puml"}` and
fenced code blocks ` ```plantuml `, with SVG export.

## Routes (decided)
- **Integration**: builtin to `apps/desktop` (mirror mermaid/dbml pattern),
  not an external plugin. Reverses the archived `08-07-move-plantuml-plugin-to-
  external-sdk-repo` decision — the user wants it in-tree.
- **Render service**: `https://www.plantuml.com/plantuml/svg/<encoded>` (public,
  no key). No configurable server URL for now.
- **Export**: SVG only. PNG/TXT deferred (YAGNI).

## Architecture

Reuse existing surfaces, no new registries:

1. **Fenced code blocks** (` ```plantuml ` / `puml` / `pu`)
   - New `PlantUmlBlock` component (lives in `@folyn/container-plugins` next to
     `MermaidPlugin`) — fetches SVG from plantuml.com, renders inline.
   - Registered as builtin markdown code renderer in
     `registerBuiltinCodeContributions.ts` under `plantuml` + aliases
     `puml`, `pu`.
   - Editor language: lazy CodeMirror StreamLanguage that highlights
     `@startuml`/`@enduml` + keywords. Skip if non-trivial — highlight.js
     fallback already works for `plantuml` grammar if registered. **Decision:
     ship the renderer first; editor syntax can be a follow-up if users ask.**
     Ponytail: don't scaffold the language until needed.

2. **`:::file-preview{src="*.puml"}`**
   - New file-type handler at
     `apps/desktop/src/components/file-types/plantuml/index.tsx` —
     `supportedViewModes: ['split','edit','preview']`, `useCodeMirror: true`,
     reuses `PlantUmlBlock` for the preview pane.
   - Registered automatically via the `import.meta.glob('./*/index.{ts,tsx}')`
     convention at `apps/desktop/src/components/file-types/registry.ts:47` —
     no code change needed beyond dropping the file in.

3. **SVG export**
   - New `apps/desktop/src/services/export/plantuml.ts` exposing `enhance()`
     that re-fetches the SVG from plantuml.com and injects it into the export
     body. Register in `REGISTRY` at `exportService.ts:292` under `plantuml`
     + extension aliases `puml`, `pu`.
   - Reuse `downloadBlob` from `shared.ts` for the save dialog.

## PlantUML encoding

PlantUML server expects a deflate-raw + custom base64 alphabet encoding. Use
the **native `CompressionStream('deflate-raw')`** stream (Chrome 80+, Safari
16.4+, Firefox 113+) — no `pako` dependency. The custom base64 alphabet is a
~10-line swap from standard base64. Reference algorithm:
<https://plantuml.com/text-encoding> (section "Deflate").

`CompressionStream` is async-streaming; for one-shot encoding we collect the
stream into a single buffer. Add a `ponytail:` comment noting the alternative
is `pako.deflateRaw` if browser compat ever matters.

## Surface checklist

| Surface | File | Action |
|---|---|---|
| Code fence renderer | `packages/container-plugins/src/plugins/PlantUmlPlugin.tsx` | new |
| Code fence registration | `apps/desktop/src/services/registerBuiltinCodeContributions.ts` | edit |
| Code fence language autocomplete | `apps/desktop/src/editor/extensions/CodeBlockExtension.ts` | verify auto-includes renderer langs |
| File-type handler | `apps/desktop/src/components/file-types/plantuml/index.tsx` | new (glob auto-registers) |
| Exporter | `apps/desktop/src/services/export/plantuml.ts` | new |
| Export registry | `apps/desktop/src/services/exportService.ts:292` | edit |
| Encoding util | `packages/container-plugins/src/plantuml/encode.ts` | new |

## Non-goals
- No PNG export (can add later via `svgToPngBlob` in `shared.ts`).
- No configurable server URL.
- No CodeMirror syntax highlighting for `.puml` files (highlight.js fallback OK).
- No dark-mode CSS filter (PlantUML has its own skin param; user controls via
  source).
- No retry/backoff — plantuml.com is reliable; network errors surface inline
  like MermaidBlock's error block.

## Tests
One self-check `demo()` in the encode util: `encode('@startuml\nA --> B\n@enduml')`
must start with a known-length prefix and round-trip through the plantuml.com
fetch (smoke test against the real server, skipped in CI by default).

## Risks
- plantuml.com rate limits — none documented, but the lazy fallback if a fetch
  fails is to show the error inline; no caching layer.
- `CompressionStream` is async — render path needs to be async, like
  MermaidBlock already is.
