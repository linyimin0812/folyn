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

## State Inside Components

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
