# fix: AI panel mount gate vs showAiPanel semantics

## Goal

`showAiPanel` (appearanceStore) is documented as "默认显示 AI 面板 / Show AI panel by default" — i.e. a launch-time auto-expand preference. But `App.tsx:613` and `App.tsx:640` gate the mount with `{showAiPanel && <AiPanel/>}`, turning it into a "can-open at all" hard gate. Result: when the user turns the setting off (wanting "don't auto-open"), clicking the Topbar AI button flips `editorViewState.aiPanelVisible` to true but no component is mounted — nothing renders.

Restore intended semantics: AiPanel always mounts on `editor` and `study` pages; `showAiPanel` only seeds the initial value of `aiPanelVisible` at app launch.

## What I already know

- `appearanceStore.showAiPanel` defaults to `true`; persisted; toggled in Settings → Appearance → "默认显示 AI 面板".
- i18n (`zh/settings.json`, `en/settings.json`) confirms semantics: "打开编辑器时自动展开 AI 对话面板" / "Auto-expand AI chat panel when opening the editor".
- `editorViewState.aiPanelVisible` defaults to `false`; toggled by `Topbar.tsx:130` AI button (calls `toggleAiPanel`).
- `AiPanel.tsx:150` returns `null` when `aiPanelVisible` is false — that's the runtime visibility gate, not the mount gate.
- Hard-mount gates live at `App.tsx:613` (editor page) and `App.tsx:640` (study page).
- Sibling settings: `enableWikiPanel` / `enableClipsPanel` / `enableAnalyzePanel` / `enableDailyPanel` — those names suggest "enable" semantics (different from `showAiPanel`'s "show by default"). Only `showAiPanel` is misused as a mount gate.

## Requirements

- AiPanel mounts on `editor` and `study` pages regardless of `showAiPanel`.
- On app launch, `aiPanelVisible` initializes to the value of `showAiPanel` (so "auto-expand" works).
- Toggling `showAiPanel` at runtime in Settings does NOT close an already-open panel, and does NOT open a closed one — it's a launch-time preference only. (Matches user's stated semantics.)
- Topbar AI button toggle behavior unchanged: always flips `aiPanelVisible`.
- `editorViewState.test.ts` and `AiPanel.smoke.test.tsx` continue to pass; add coverage for the new init path.

## Acceptance Criteria

- [ ] With `showAiPanel=false` persisted: launch app → AiPanel hidden; click Topbar AI button → AiPanel renders.
- [ ] With `showAiPanel=true` persisted: launch app → AiPanel visible without clicking.
- [ ] Turning the Settings toggle on/off after launch does not force-open or force-close an already-mounted AiPanel.
- [ ] Existing `editorViewState.test.ts` and `AiPanel.smoke.test.tsx` pass.
- [ ] New test covers the launch-time init: initial `aiPanelVisible === showAiPanel` at first paint.

## Out of Scope

- Reconsidering sibling `enable*Panel` settings (they may or may not have similar misuse — separate task).
- Persisting `aiPanelVisible` itself across sessions (currently in-memory; out of scope).

## Technical Approach

1. **`App.tsx`**: drop `showAiPanel &&` from lines 613 and 640 — `<AiPanel />` always mounts on `editor` and `study` pages.
2. **`App.tsx`**: add a mount-time `useEffect` that runs once: `useEditorViewStateStore.setState({ aiPanelVisible: useAppearanceStore.getState().showAiPanel })`. Use a `useRef` guard (mirrors the `vaultInitialized` pattern at App.tsx:151) so React 18 StrictMode double-invoke doesn't clobber a user click that lands between the two invocations.
3. Runtime Settings toggle of `showAiPanel` does NOT touch `aiPanelVisible` — purely a launch-time default.

## Decision (ADR-lite)

**Context**: `showAiPanel` is documented as "auto-expand on launch" but used as a mount gate, breaking the manual-open path when the setting is off.

**Decision**: Always mount AiPanel; seed `aiPanelVisible` from `showAiPanel` once at app launch via an App.tsx mount effect. Keep the two stores decoupled (no cross-store read in editorViewState module init).

**Consequences**:
- Pro: Minimal diff, no architectural change, stores stay decoupled.
- Pro: Settings toggle keeps its current "default" semantics — no surprise runtime open/close.
- Con: One render frame where `aiPanelVisible=false` before the effect flips it to `true` (only when `showAiPanel=true`). Acceptable: AiPanel returns null on `aiPanelVisible=false`, so no visual flash — the panel just appears on the first effect tick, same as today's `toggleAiPanel` path.

## Technical Notes

- Files touched: `apps/desktop/src/App.tsx`, `apps/desktop/src/components/ai/AiPanel.smoke.test.tsx` (add launch-init coverage).
- Pattern reference: `App.tsx:151` `vaultInitialized` useRef guard for one-shot effects.
- `useAppearanceStore.getState().showAiPanel` is synchronous at mount — no async needed.
