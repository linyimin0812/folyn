# Directory Structure

> How frontend code is organized in the desktop app.

---

## Directory Layout

```
apps/desktop/src/
├── App.tsx              # Root component — shell layout, page routing, global shortcuts
├── main.tsx             # React entry point (ReactDOM.createRoot)
├── index.css            # Global styles (Tailwind directives + CSS custom properties)
├── vite-env.d.ts        # Vite type declarations
│
├── components/
│   ├── ai/              # AI panel and chat (AiPanel, ChatInput, ChatMessages, DiffView,
│   │                    #   ToolCallBlock, MessageContent, ReviewItemList, DeepResearchDialog,
│   │                    #   IngestDialog, adapterManager, WikiToolbar, WikiActivityLog)
│   ├── editor/          # Editor toolbar and overlays (SlashMenu, ExportMenu, DiffToolbar,
│   │                    #   ImagePasteDialog, CodeBlockLangMenu, DailyDigest)
│   ├── file-types/      # File type handler registry (markdown, code, image, pdf, web)
│   ├── graph/           # Wiki link graph visualization (D3 force-directed)
│   ├── icons/           # Reusable SVG icon components (ThemeIcon)
│   ├── outline/         # Document heading outline panel
│   ├── pages/           # Full-page views (SettingsPage, VaultPage)
│   ├── preview/         # Markdown preview renderer (unified/rehype pipeline)
│   ├── search/          # Global search panel (GlobalSearchPanel)
│   ├── shell/           # App chrome (Topbar, ActivityBar, StatusBar)
│   ├── sidebar/         # File tree sidebar (Sidebar, FileTreeItem, WikiFileTree,
│   │                    #   CalendarPanel, ContextMenu, SidebarResizer, SidebarActions)
│   ├── vault/           # Vault management UI
│   └── work-area/       # Main editor area (WorkArea, tab bar, editor host)
│
├── editor/              # CodeMirror extensions, themes, and setup
├── features/            # Feature modules — one folder per feature (study, clips, wiki,
│                        #   schedule, analyze). Each owns its domain logic AND its
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
- **Feature modules** under `features/` — one folder per feature (`study`, `clips`, `wiki`, `schedule`, `analyze`). Each owns its domain logic (e.g. `study/sm2.ts`, `study/studyDoc.ts`) AND its canonical agent definition (`.claude/CLAUDE.md` + `.claude/agents/<feature>.md`). See `feature-agents.md` for the agent architecture contract.
- **Stores** are flat in `store/`, one file per domain: `editorStore.ts`, `settingsStore.ts`, `vaultStore.ts`, `aiStore.ts`, `searchStore.ts`, `wikiStore.ts`, `wikiGraphStore.ts`
- **Store helpers** co-located when logic grows: `editorAutoSave.ts`, `editorPersistence.ts`, `aiFileChangeActions.ts`, `aiSessionPersistence.ts`
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
