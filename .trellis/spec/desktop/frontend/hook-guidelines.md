# Hook Guidelines

> How custom hooks are used in the desktop app.

---

## Hook Inventory

| Hook | Location | Purpose |
|------|----------|---------|
| `useTheme` | `src/hooks/useTheme.ts` | Syncs theme store to DOM, returns theme state + actions |
| `useExport` | `src/hooks/useExport.ts` | Export document to Markdown/HTML/PDF |
| `useDragDrop` | `src/components/sidebar/useDragDrop.ts` | File tree drag-and-drop behavior |
| `useSidebarActions` | `src/components/sidebar/SidebarActions.tsx` | Sidebar context menu actions |
| `useIsMobile` | inline in `App.tsx` | Responsive breakpoint detection |

---

## Hook Structure Pattern

Standard pattern — read from stores, manage side effects, return value + actions:

```ts
// apps/desktop/src/hooks/useTheme.ts
export function useTheme() {
  // 1. Read from Zustand stores (granular selectors)
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const toggleTheme = useSettingsStore((state) => state.toggleTheme);

  // 2. Side effects with cleanup
  useEffect(() => {
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const applySystemTheme = () => {
        document.documentElement.dataset.theme = mediaQuery.matches ? 'dark' : 'light';
      };
      applySystemTheme();
      mediaQuery.addEventListener('change', applySystemTheme);
      return () => mediaQuery.removeEventListener('change', applySystemTheme);
    }
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // 3. Return current value + action functions
  return { theme, setTheme, toggleTheme };
}
```

---

## Naming Conventions

- `use<Domain>` — `useTheme`, `useExport`, `useDragDrop`
- Hooks returning a single boolean: `useIsMobile`, `useIsResizing`
- Hooks co-located with the component that owns them when component-specific (e.g., `useDragDrop` lives in `sidebar/`)

---

## Return Value Pattern

Always return an **object** with named fields, not a tuple:

```ts
// ✅ Good — named return
return { theme, setTheme, toggleTheme };

// ❌ Avoid — tuple return (harder to consume)
return [theme, setTheme];
```

---

## Data Fetching

No React Query or SWR. All async operations go through:

| Pattern | When to Use | Example |
|---------|-------------|---------|
| Store actions | Data lives in global state | `useVaultStore.getState().initVault()` |
| Service functions | One-off operations | `exportService.exportToPdf(...)` |
| `useEffect` + `useState` | Component-scoped async loads | Loading file content for preview |

---

## Inline Hooks

Hooks used in only one component may be defined inline (not extracted to `hooks/`):

```ts
// apps/desktop/src/App.tsx
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= breakpoint : false,
  );
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    mql.addEventListener('change', handler);
    setIsMobile(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, [breakpoint]);
  return isMobile;
}
```

---

## Common Mistakes

- Reading store values in hooks and passing them as params — read from stores directly inside the hook
- Forgetting cleanup in `useEffect` (event listeners, media queries leak)
- Extracting hooks to `hooks/` when they're only used by one component — co-locate instead
- Using `useStore()` with no selector inside hooks — same re-render problem as in components
