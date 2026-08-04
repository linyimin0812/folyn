# Voice Source Dir Browse Button

## Goal
In Voice Settings → "源文件目录" row, replace the bare `<input>` with an input + "浏览" button in `Space.Compact` layout. Clicking the button opens the native directory picker; the chosen absolute path is written into `sourceDir`.

## Scope
- File: `apps/desktop/src/components/settings/VoiceSettings.tsx` (the `sourceDir` input block, lines ~206-216).
- i18n: add `settings:voice.sourceDir.browse` key in `zh/settings.json` and `en/settings.json`.
- Reuse `@tauri-apps/plugin-dialog` `open({ directory: true, multiple: false })` — already a project dep, same pattern as `PetSettings.tsx:85`, `PluginsSettings.tsx:255`, `CreateVaultDialog.tsx:68`.
- Non-Tauri (web/Windows unsupported): button disabled or no-op. The surrounding block is already rendered under `saveSource &&` regardless of `onMac`, so keep it working on non-Mac too — but `@tauri-apps/plugin-dialog` only runs in Tauri, so guard with `isTauri()`.

## Non-Goals
- Changing `sourceDir` semantics (still a path string stored in `voiceStore`).
- Persisting absolute vs relative resolution — `sourceDir` is stored as-is; existing logic resolves relative to vault root elsewhere. User can still type a relative path manually.
- Refactoring other settings rows.

## Visual
`Space.Compact` equivalent with Tailwind: input (right-rounded-0) + button (left-rounded-0) sharing a border, no gap.

## Acceptance
- Browse button opens native dir picker on macOS (Tauri).
- Picking a directory writes the path into the input and `voiceStore.sourceDir`.
- Cancel picker → no change.
- Input remains manually editable.
