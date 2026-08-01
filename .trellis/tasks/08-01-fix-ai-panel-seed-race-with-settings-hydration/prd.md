# fix: AI panel seed race with settings hydration

## Goal

Follow-up regression to a0922b5. The mount-time seeding effect that sets `aiPanelVisible = showAiPanel` runs **before** `settingsLoadDone` resolves — appearanceStore hasn't hydrated yet, so `useAppearanceStore.getState().showAiPanel` returns the default `true`. Result: with `showAiPanel=false` persisted, the AI panel still auto-opens on launch.

## Root Cause

`App.tsx` mount effect:
```ts
useEffect(() => {
  if (aiPanelVisibilitySeeded.current) return;
  aiPanelVisibilitySeeded.current = true;
  useEditorViewStateStore.setState({
    aiPanelVisible: useAppearanceStore.getState().showAiPanel,  // ← reads pre-hydration default
  });
}, []);
```

`settingsLoadDone` (from `settingsPersistence.ts:177`) is the promise that resolves after `loadSettings()` finishes dispatching persisted blobs to each slice's `hydrate`. At mount time, hydration is still in-flight.

## Requirements

- The seeding effect MUST read `showAiPanel` AFTER appearanceStore has hydrated.
- The seeding effect MUST still run only once (ref guard preserved).
- The seeding effect MUST NOT fire on every settings change — only once at launch.
- Existing `AiPanel.smoke.test.tsx` + `editorViewState.test.ts` continue to pass.

## Acceptance Criteria

- [ ] With `showAiPanel=false` persisted: launch app → AiPanel hidden until the user clicks the Topbar AI button.
- [ ] With `showAiPanel=true` persisted: launch app → AiPanel auto-visible.
- [ ] Existing tests pass.

## Technical Approach

`await settingsLoadDone` inside the effect before reading `showAiPanel`. Effect becomes async (wrap in IIFE or use `.then()`). The ref guard stays — but move the guard set to AFTER the await so a StrictMode double-invoke doesn't skip the second run (the second run will see `aiPanelVisibilitySeeded.current = true` after the first completes and skip — but the first run completes before the second starts in StrictMode so this is fine; alternatively, set the ref flag inside the async body after the await).

Simplest form:
```ts
useEffect(() => {
  if (aiPanelVisibilitySeeded.current) return;
  aiPanelVisibilitySeeded.current = true;
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

## Out of Scope

- Re-architecting the persistence layer or making hydration synchronous.
- Other settings that might have similar race conditions (separate task if any).

## Technical Notes

- `settingsLoadDone` already imported at `App.tsx:22`.
- Pattern reference: `App.tsx:181-185` already awaits `settingsLoadDone` inside another effect.
