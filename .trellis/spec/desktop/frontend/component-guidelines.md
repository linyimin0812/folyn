# Component Guidelines

> How components are built in the desktop app.

---

## Component Structure

Every component is a **named function export** (not default export, except `App`):

```tsx
// apps/desktop/src/components/shell/Topbar.tsx
interface TopbarProps {
  isMobile?: boolean;
  onToggleSidebar?: () => void;
}

export function Topbar({ isMobile, onToggleSidebar }: TopbarProps) {
  // 1. Store selectors first
  const viewMode = useEditorStore((state) => state.viewMode);
  const setViewMode = useEditorStore((state) => state.setViewMode);
  const { theme, toggleTheme } = useTheme();

  // 2. Local state
  const [menuOpen, setMenuOpen] = useState(false);

  // 3. Effects
  useEffect(() => { /* ... */ }, [dep]);

  // 4. JSX return
  return <header className="topbar h-[36px] ...">...</header>;
}
```

Reference: `apps/desktop/src/components/shell/Topbar.tsx`, `apps/desktop/src/components/sidebar/Sidebar.tsx`

---

## Props Conventions

- **Interface naming**: `<Component>Props` (e.g., `TopbarProps`, `SidebarProps`)
- **Optional over required**: prefer `?` for props that have sensible defaults
- **Callback naming**: `on<Verb><Noun>` pattern — `onToggleSidebar`, `onPanelChange`, `onFileSelect`
- **No children prop** unless the component is a generic container

```tsx
interface SidebarProps {
  activePanel?: ActivityPanel;
  onFileSelect?: () => void;
}
```

---

## Styling Patterns

**Primary**: Tailwind CSS utility classes via `className` string templates:
```tsx
<header className="topbar h-[36px] shrink-0 bg-panel border-b border-brd flex items-center justify-between px-2.5 gap-[3px] z-50">
```

**CSS custom properties** for theming:
- `--ui-font-size` — base UI font size (set from store)
- `--t1`, `--t2`, `--t3` — text color tiers
- `--acc` — accent color
- `--hov` — hover background
- `--brd`, `--brd2` — border colors
- `--panel` — panel background

**Tailwind color tokens** (mapped from CSS vars in `index.css`):
- `bg-panel`, `bg-hov`, `bg-accdim` — backgrounds
- `text-t1`, `text-t2`, `text-t3` — text colors
- `text-acc` — accent text
- `border-brd`, `border-brd2` — borders

**Inline styles** only for dynamic values that can't be Tailwind classes:
```tsx
<div style={{ '--ui-font-size': `${fontSize}px` } as any}>
```

**Icons**: inline SVG in JSX — not separate icon files or icon libraries:
```tsx
<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
  <path d="M13.5 8.5a5.5 5.5 0 01-6-6 5.5 5.5 0 106 6z" />
</svg>
```

---

## Composition

- **Feature folders** contain a main component plus helper subcomponents
  - `sidebar/` → `Sidebar.tsx` (main) + `FileTreeItem.tsx` + `SidebarActions.tsx` + `SidebarResizer.tsx` + `ContextMenu.tsx`
- **No HOC patterns** — plain function composition and hooks
- **Shared components** (icons, dialogs) extracted when used in 2+ feature folders

---

## Shared Presentational Components (`components/chat/`)

`components/chat/` holds chat UI shared by **two consumers with divergent capability**:
the main-window AI panel (full: markdown, attachments, @-mention, inputMode, tool calls,
multi-session) and the secondary `pet-panel` window chat (minimal: plain text, single
linear session, vault-free). The shared components stay presentational — they receive
data + callbacks and render; they do NOT own adapter lifecycle, store mutations, or
prompt-building (those stay in each consumer).

### Pattern: slot-based extension for capability divergence

When a shared component must serve a full-featured consumer AND a minimal consumer,
expose advanced capabilities as **explicit slots** the minimal consumer simply omits —
not as a forest of internal conditionals.

`ChatInputBox` (canonical example) owns only the base (textarea + send/stop + optional
clear) and exposes slots for everything else:

```tsx
interface ChatInputBoxProps {
  // base — both consumers
  value: string; onChange: (v: string) => void; onSend: () => void;
  streaming: boolean; onStop?: () => void; onClear?: () => void;
  disabled?: boolean; placeholder?: string; textareaRows?: number;
  // keyboard gate for consumers that intercept keys before base (e.g. @-mention nav)
  onBeforeKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  // slots — AiPanel fills these; PetChat leaves them undefined
  leadingSlot?: React.ReactNode;     // file-picker btn + input-mode dropdown
  attachmentsRow?: React.ReactNode;  // attachment chips
  overlayLayer?: React.ReactNode;    // @-mention popup + mode-menu (absolutely positioned)
  trailingSlot?: React.ReactNode;
}
```

- AiPanel's `ChatInput` is a thin wrapper that builds the slots from its own
  attachment/mention/mode state (vault-coupled logic stays in the wrapper, NOT in the
  shared component) and forwards `onBeforeKeyDown` so @-mention nav can gate base Enter.
- PetChat passes only base props + `onClear`. No slots, no `onBeforeKeyDown`.

The same shape applies to `ChatMessageList`: `plaintext?` / `showCopy?` / `onClear?` /
`onSaveToWiki?` / `streamingIndicator?` / `renderMessage?` are all optional — the minimal
consumer passes a subset. Reserved-but-unrendered optional props (`sessions?` /
`activeSessionId?` / `onSwitchSession?`) preserve extension points without coupling the
minimal consumer to concepts it doesn't have.

The `renderPairTag?: (msg: CliMessage) => ReactNode | null` slot follows the same pattern
when a shared chat component needs to display a model attribution tag on AI messages: the
shared component can't import `@/services/providers/catalog` (it would couple the
secondary window bundle), so the main-window consumer supplies a resolver via the slot;
the minimal consumer omits it and renders no tag. Don't put `providerDisplayName` calls
inside `components/chat/*` — pass the resolver in.

### Convention: shared components MUST NOT top-level import vault/editor/main-window stores

`components/chat/*` is imported by the secondary `pet-panel` Tauri window, which has no
vault/editor/`aiStore` in its bundle. A top-level `import { useVaultStore } from
'@/store/vaultStore'` in a shared component would either break the secondary window's
build or pull main-window-only state into it.

**Rule**: shared chat components may import only `react`, `@quill/cli-adapter` types,
fellow `components/chat/*` / `components/icons/*`, and platform guards (`isTauri`).
Anything vault/editor/main-window-coupled (file-tree for @-mention, `aiStore.inputMode`,
attachment blob-saving) belongs in the **consumer wrapper** (`ChatInput.tsx`,
`PetChat.tsx`), injected via props/slots. Verify with a grep before adding an import to
`components/chat/`:

```bash
grep -nE "from '@/store/(aiStore|vaultStore|editorStore|petChatStore)'" \
  apps/desktop/src/components/chat/*.tsx   # must return nothing
```

> **Bundle gotcha**: a top-level `import` of a heavy pipeline (e.g. the
> `unified`/remark/rehype markdown stack in `MessageContent`) is pulled into every
> consumer's bundle even when that consumer only uses the `plaintext` path. The `plaintext`
> prop gates runtime behavior but not bundle inclusion. If a secondary window's bundle
> size matters, lazy-load the heavy path via dynamic `import()` inside the non-`plaintext`
> branch rather than at module top level. (Currently accepted as a known cost in
> `MessageContent` — `TODO` marker in source.)

### Pattern: extracting a shared helper from a vault-coupled consumer

When a main-window consumer (e.g. `components/ai/ChatInput.tsx`) holds logic you want to
reuse in a vault-free secondary window (e.g. pet-panel's `PetChat`), extract the
**vault-free** core into a shared helper under `components/chat/` and keep the
**vault-coupled** part in each consumer's wrapper.

Canonical example: `components/chat/attachments.ts` holds the attachment lifecycle
(`PendingAttachment`, `addFiles`, `handlePaste`, `saveBlobs`, `buildReadInstructions`,
`validateFile`, `revokeUrls`) — none of which touch the vault. AiPanel's `ChatInput`
uses it AND layers `@mention` (which needs `vaultStore.flattenFileTree`) locally;
PetChat uses it with no `@mention` layer.

- The helper follows the same no-store-import rule as shared components: grep-verify
  `grep -nE "from '@/store/(vaultStore|editorStore|aiStore)'" apps/desktop/src/components/chat/*.ts` is empty.
- Vault-coupled features that have no vault-free form (file-tree `@mention`, wiki/clip
  toolbars) stay in the consumer wrapper — do NOT try to abstract them into the helper
  with an optional vault dependency; that re-couples the secondary window.
- A consumer may pass its own `workingDir` to a side-effectful helper (`saveBlobs(atts, workingDir, ...)`)
  so the same helper serves both appData-scoped (pet, `strategy:'fs'`) and vault-scoped
  (AiPanel, `strategy:'shell'`) callers without either coupling.



| Tool | Use Case | Example |
|------|----------|---------|
| `useState` | Local UI state | sidebar width, expanded dirs, dialog open |
| `useRef` | Mutable refs that don't re-render | `vaultInitialized`, `hasAutoExpanded` |
| `useCallback` | Stable callback refs passed as props | `toggleMobileSidebar`, `closeMobileSidebar` |
| `useEffect` | Side effects with cleanup | event listeners, DOM sync, watchers |
| `useMemo` | Expensive derived values | filtered file lists |

---

## Common Mistakes

- Using `useStore()` with no selector — subscribes to everything, causes unnecessary re-renders
- Putting business logic in components instead of stores or services
- Forgetting cleanup in `useEffect` (event listeners leak)
- Using Tailwind classes in container-plugin components (preview pane has its own CSS context)
