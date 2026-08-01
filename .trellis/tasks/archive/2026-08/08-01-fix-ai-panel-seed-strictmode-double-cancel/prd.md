# fix: AI panel seed StrictMode double-cancel

## Goal

Follow-up regression to 4147fe4. With `showAiPanel=true` persisted, the AI panel still doesn't auto-open on launch.

## Root Cause

`App.tsx` mount effect:
```ts
const aiPanelVisibilitySeeded = useRef(false);
useEffect(() => {
  if (aiPanelVisibilitySeeded.current) return;  // ← problem
  aiPanelVisibilitySeeded.current = true;
  let cancelled = false;
  settingsLoadDone.then(() => {
    if (cancelled) return;  // ← problem
    useEditorViewStateStore.setState({ aiPanelVisible: ... });
  });
  return () => { cancelled = true; };
}, []);
```

React 18 StrictMode (enabled at `main.tsx:91`) simulates unmount/remount on mount:
1. Mount 1: ref=false→true, schedule `.then`.
2. Cleanup 1: `cancelled=true`.
3. Mount 2: ref is true (refs persist across StrictMode remount) → early return.
4. Mount 1's `.then` resolves: `cancelled=true` → skip setState.

Result: neither mount actually seeds `aiPanelVisible`. Panel stays closed even with `showAiPanel=true`.

The codebase already has a canonical pattern for this at `App.tsx:381-423` (voice hotkey effect): no ref guard, just `cancelled`, each mount gets its own closure. The ref guard is the bug.

## Requirements

- Drop the `aiPanelVisibilitySeeded` ref guard.
- Keep the `cancelled` flag and the `settingsLoadDone.then(...)` structure.
- StrictMode's double-mount must seed `aiPanelVisible` exactly once (the second mount wins; idempotent setState).
- Existing tests pass.

## Acceptance Criteria

- [ ] With `showAiPanel=true` persisted: launch app in dev (StrictMode) → AiPanel auto-visible.
- [ ] With `showAiPanel=false` persisted: launch app → AiPanel hidden (regression check on the previous fix).
- [ ] Existing tests pass.

## Technical Approach

```ts
useEffect(() => {
  let cancelled = false;
  settingsLoadDone.then(() => {
    if (cancelled) return;
    useEditorViewStateStore.setState({
      aiPanelVisible: useAppearanceStore.getState().showAiPanel,
    });
  });
  return () => { cancelled = true; };
}, []);
```

Mirrors `App.tsx:381-423` voice hotkey pattern exactly.

## Out of Scope

- Refactoring the broader seeding pattern.
- Disabling StrictMode.

## Technical Notes

- Pattern reference: `App.tsx:381-423` voice hotkey effect (no ref guard, `cancelled` flag, async side effect).
- StrictMode enabled at `main.tsx:91`.
