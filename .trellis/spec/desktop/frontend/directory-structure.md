# Directory Structure

> How frontend code is organized in the desktop app.

---

## Directory Layout

```
apps/desktop/src/
├── App.tsx              # Root component — shell layout, page routing, global
│                        #   shortcuts, init/wiring. Terminal dock layout
│                        #   subsystem lives in components/terminal/ (extracted).
├── main.tsx             # React entry point (ReactDOM.createRoot)
├── index.css            # Global styles (Tailwind directives + CSS custom properties)
├── vite-env.d.ts        # Vite type declarations
│
├── components/
│   ├── ai/              # AI panel host (AiPanel, ChatInput, DiffView, ReviewItemList,
│   │                    #   DeepResearchDialog, IngestDialog, adapterManager, inputModes,
│   │                    #   WikiToolbar, WikiActivityLog).
│   │                    #   NOTE: ChatMessages + MessageContent were extracted into chat/
│   │                    #   (see below) — AiPanel now composes the shared chat components.
│   ├── chat/            # Shared presentational chat UI consumed by BOTH the AI panel
│   │                    #   (main window) and the desktop-pet chat (secondary pet-panel
│   │                    #   window). ChatMessageList, MessageContent (markdown + plaintext),
│   │                    #   ChatInputBox (slot-based), ToolCallBlock + FileImage (chat-
│   │                    #   internal render parts — moved out of ai/ to keep chat/ from
│   │                    #   depending on ai/, breaking the ai↔chat cycle). See
│   │                    #   component-guidelines.md for the slot pattern + the
│   │                    #   no-store-import rule for secondary-window isolation.
│   ├── editor/          # Editor toolbar and overlays (SlashMenu, ExportMenu, DiffToolbar,
│   │                    #   ImagePasteDialog, CodeBlockLangMenu, DailyDigest)
│   ├── file-types/      # File type handler registry (markdown, code, image, pdf, web). The
│   │                    #   `clip/` subfolder holds the clip card editor: `ClipCardView`
│   │                    #   (frontmatter + 摘要/要点/信息图 renderer) and `InfographicView`
│   │                    #   (poster-style block renderer with 9 block types + unknown
│   │                    #   fallback). See `features/clips/clipParse.ts` for the shared
│   │                    #   `{ version, blocks: InfographicBlock[] }` schema and parsers.
│   ├── graph/           # Wiki link graph visualization (D3 force-directed)
│   ├── icons/           # Reusable SVG icon components (ThemeIcon)
│   ├── outline/         # Document heading outline panel
│   ├── pages/           # Full-page views (SettingsPage, VaultPage)
│   ├── preview/         # Markdown preview renderer (unified/rehype pipeline)
│   ├── search/          # Global search panel (GlobalSearchPanel)
│   ├── settings/        # Per-tab settings components, one file per tab:
│   │                    #   FileTemplatesSettings, SkillsSettings, PetSettings,
│   │                    #   NotificationsSettings, PluginsSettings, VoiceSettings,
│   │                    #   ShortcutEditor. `primitives.tsx` holds the shared
│   │                    #   `Toggle` + `NAV_GROUPS`; `useHotkeyRecording.ts`
│   │                    #   the shared hotkey-record hook. The shell that renders
│   │                    #   them lives in `pages/SettingsPage.tsx`.
│   ├── shell/           # App chrome (Topbar, ActivityBar, StatusBar)
│   ├── sidebar/         # File tree sidebar (Sidebar, FileTreeItem, WikiFileTree,
│   │                    #   CalendarPanel, ContextMenu, SidebarResizer, SidebarActions)
│   ├── terminal/        # Terminal UI: TerminalPanel (xterm host) + the dock
│   │                    #   layout subsystem extracted from App.tsx —
│   │                    #   TerminalHost (bottom/right layout container),
│   │                    #   TerminalDock (single persistent dock),
│   │                    #   TerminalResizeHandle / TerminalRightResizeHandle
│   │                    #   (drag handles). See work-area/EditorContent for the
│   │                    #   composition that wires terminal into the editor area.
│   ├── vault/           # Vault management UI
│   └── work-area/       # Main editor area: WorkArea (tab bar + editor/preview
                        #   host), EditorContent (composes WorkArea + RightDock
                        #   inside TerminalHost — focus mode drops the dock)
│
├── editor/              # CodeMirror extensions, themes, and setup
├── features/            # Feature modules — one folder per feature (analyze, clips,
│                        #   schedule, wiki). Each owns its domain logic AND its
│                        #   canonical .claude/ (CLAUDE.md + agents/<feature>.md)
├── hooks/               # Custom React hooks (useTheme, useExport)
├── services/            # Cross-feature business logic services (exportService, wikiProvider,
│                        #   wikiIngestService, wikiQueryService, wikiLintService,
│                        #   featureAgentService, clipService, githubAnalysisService,
│                        #   graphDataBuilder)
├── store/               # Zustand 5 stores (one per domain)
├── types/               # Shared TypeScript types (wiki.ts)
└── utils/               # Pure utility functions (no React dependencies)
```

---

## Module Organization

- **Feature folders** under `components/` — each folder owns one UI feature area with a main component plus helper subcomponents (e.g., `sidebar/Sidebar.tsx` + `FileTreeItem.tsx` + `SidebarActions.tsx` + `SidebarResizer.tsx`)
- **Feature modules** under `features/` — one folder per feature (`analyze`, `clips`, `schedule`, `wiki`). Each owns its domain logic (e.g. `clips/clipParse.ts` — shared clip-markdown parsers and the infographic `{ version, blocks: Block[] }` schema with 9 block types: hero/stat/keypoints/timeline/steps/comparison/quote/tags/source; `schedule/` columns/dnd/dailyScan/layout/markdown/types) AND its canonical agent definition (`.claude/CLAUDE.md` + `.claude/agents/<feature>.md`). See `feature-agents.md` for the agent architecture contract.

  > **Note**: `features/analyze` currently holds only its canonical `.claude/`; its bespoke service logic lives in `services/` (consumed via `featureAgentService`). `features/wiki` similarly delegates most domain logic to `services/` (`wikiIngestService`, `wikiLintService`, `wikiQueryService`, etc.) — the `features/<name>/` folder is the canonical-agent home and clip/schedule parsers; heavier domain logic for analyze/wiki is service-layer, not feature-folder. See `directory-structure.md` services list and `feature-agents.md`.
- **Stores** are flat in `store/`, one file per domain. The authoritative store registry and per-store responsibilities live in `state-management.md` ("Store Categories" table) — do not duplicate the list here. As of writing there are ~30 stores spanning navigation, appearance, editor (split into `editorStore` + `editorPrefsStore` + `editorAutoSave` + `editorPersistence` + `editorViewState`), vault/vaultConfig, ai (split into `aiStore` + `aiConfigStore` + `aiFileChangeActions` + `aiSessionPersistence`), wiki (split into `wikiStore` + `wikiGraphStore` + `wikiQueryStore`), pet (split into `petStore` + `petChatSessions`), schedule, clips, analysis, plugin, terminal, voice, translation, search, modelRegistry, bubbleTemplateChat, browser, locale, toast, toolWindow, featurePanel, commandPalette, diffReview. See `state-management.md` for the god-store split history and the `settingsStore` → 8 cohesive stores migration.
- **Store helpers** co-located when logic grows: `editorAutoSave.ts`, `editorPersistence.ts`, `editorViewState.ts`, `aiFileChangeActions.ts`, `aiSessionPersistence.ts`
- **Services** are flat in `services/` — cross-feature business logic (e.g. `featureAgentService` seeds canonical agent files into the vault; `clipService` / `githubAnalysisService` consume feature agents)
- **Utils** are flat in `utils/` — pure functions with no React or store dependencies

---

## Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Components | PascalCase `.tsx` | `Topbar.tsx`, `AiPanel.tsx` |
| Stores | camelCase `<domain>Store.ts` | `editorStore.ts`, `vaultStore.ts` |
| Hooks | camelCase `use<Name>.ts` | `useTheme.ts`, `useExport.ts` |
| Services | camelCase `<domain>Service.ts` or `<domain>Provider.ts` | `exportService.ts`, `wikiProvider.ts` |
| Utils | camelCase `<noun>.ts` | `treeUtils.ts`, `pathResolver.ts` |
| Types | camelCase `<domain>.ts` | `wiki.ts` |

---

## Path Aliases

`@/` maps to `apps/desktop/src/` — configured in both `vite.config.ts` and `tsconfig.json`:

```ts
import { useEditorStore } from '@/store/editorStore';
import { storageClient } from '@/utils/storageClient';
```

---

## Reference Files

- `apps/desktop/src/App.tsx` — root component showing the full layout pattern
- `apps/desktop/src/store/editorStore.ts` — canonical store pattern
- `apps/desktop/src/components/sidebar/Sidebar.tsx` — feature folder with subcomponents
