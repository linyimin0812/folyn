# settings-pet-tab-and-custom-icon

## Goal

Add a dedicated "桌宠" (Pet) tab to the desktop settings page where users can:
1. Toggle whether the desktop pet is shown
2. Configure the pet icon (default built-in vs. custom uploaded image)

Also make the default pet icon smaller, and support custom icon upload so users can personalize the pet.

## What I already know

* **Framework**: Tauri (Rust) + React/Vite/TS desktop app at `apps/desktop/`.
* **Settings page**: single file `apps/desktop/src/components/pages/SettingsPage.tsx` (~933 lines) with tab union `SettingsTab` in `apps/desktop/src/store/settingsStore.ts:7`. Tabs rendered as conditional `{settingsTab === '<id>' && (...)}` blocks; nav defined in `NAV_GROUPS` const (line 127-141). Reusable `Toggle` component for boolean switches.
* **Existing pet toggle**: `petModeEnabled` + `setPetModeEnabled` already exist in `settingsStore` (line 101-128) and are wired elsewhere — we just surface them in the new tab.
* **Pet render surface**:
  * `apps/desktop/src/components/pet/PetMascot.tsx` — inline SVG (88×88) in a 120×120 transparent Tauri window. Artwork duplicated from `/public/folyn.svg`. State-driven (idle/hover/drag/click) with CSS breathing animation.
  * `apps/desktop/src/components/pet/PetApp.tsx` — window sizing/positioning, `SPRITE_SIZE = 120` constant.
* **Tauri window config**: `apps/desktop/src-tauri/tauri.conf.json:40-44` — `pet` window `width:120, height:120, transparent:true, alwaysOnTop:true`.
* **Settings persistence**: Zustand `useSettingsStore` with debounced (300ms) `storageClient.set('settings:all', {...})` (line 200). Loaded at startup (line 427). Persist allowlist at line ~204-227.
* **Image upload precedent**: `apps/desktop/src/utils/imageUploader.ts` has `LocalFileStrategy` using `@tauri-apps/plugin-fs` `writeFile` + `convertFileSrc`. `plugin-dialog` `open()` used in SettingsPage (line 388-414) for skill import/export — reusable for icon picker.
* **Migration gate precedent**: `petPanelSizeVersion` + `petPosVersion` exist for default-bump auto-apply (see commit `d7f0a9e`).

## Decisions (locked)

* (Q1) Custom icon storage: **copy to app data dir, store path**. Use `@tauri-apps/api/path` `appDataDir()` + `@tauri-apps/plugin-fs` `writeFile` to persist `pet-icon.<ext>`; store `petIconPath` (relative or absolute) + `petIconSource: 'builtin' | 'custom'` in settingsStore. Render via `convertFileSrc(path)`. Cleanup: delete previous file on replace / reset-to-default. Migration: if `petIconSource === 'custom'` but file missing, fall back to builtin.

## Open Questions

* (Q2) Default smaller size: **96×96 window / 72×72 mascot** (~20% shrink). Bump `petSizeVersion` so existing users auto-migrate.
* (Q3) Custom icon animation: **keep CSS transform animation on the `<img>`**. Reuse `pet-breathe` keyframes + hover/drag scale on the `<img>` element so the "alive" feel is preserved regardless of source image.
* (Q4) Reset-to-default button: **include "恢复默认"** — sets `petIconSource='builtin'` + deletes the saved `pet-icon.<ext>` file from appDataDir.

## Requirements

* New "桌宠" tab in settings page under 通用 group (`SettingsTab` gets `'pet'`)
* Toggle: show/hide pet (reuses `petModeEnabled` / `setPetModeEnabled`)
* Icon source selector: built-in default vs. custom uploaded image
* Custom icon upload via native file picker (`plugin-dialog` `open`)
  * Accepted formats: png / jpg / webp / svg
  * File-size cap: 1MB; reject with toast if exceeded
  * Reject non-image picks (filter by extension in dialog + validate)
* Custom icon persisted as `appDataDir/pet-icon.<ext>`; store `petIconPath` + `petIconSource` in settingsStore
* Render via `convertFileSrc(petIconPath)` in `PetMascot.tsx` when `petIconSource==='custom'`
* Keep CSS breathing / hover / drag animations on the `<img>` (reuse `pet-breathe` keyframes)
* "恢复默认" button: sets `petIconSource='builtin'` + deletes the saved file
* Smaller default size: 96×96 window / 72×72 mascot; bump `petSizeVersion` for auto-migration
* Fallback: if `petIconSource==='custom'` but file missing on render → fall back to builtin + clear flag
* Cleanup: delete old `pet-icon.<ext>` on (a) replace, (b) reset-to-default, (c) startup orphan sweep if `petIconSource!=='custom'`

## Acceptance Criteria

* [ ] Settings page shows a "桌宠" tab in the 通用 group
* [ ] Toggling "显示桌宠" hides/shows the pet window
* [ ] Icon source radio: 默认 / 自定义
* [ ] Uploading a png/jpg/webp/svg (<1MB) renders as the pet icon after restart
* [ ] File >1MB or non-image → rejected with toast, no state change
* [ ] "恢复默认" reverts to built-in SVG and deletes the saved file
* [ ] Default pet size is 96×96 window / 72×72 mascot (visibly smaller than before)
* [ ] Existing users auto-migrate to the new default via `petSizeVersion` bump
* [ ] If custom file is externally deleted, pet falls back to builtin gracefully
* [ ] Breathing / hover / drag animation still applies when using a custom icon

## Definition of Done

* Lint / typecheck / build green
* Manual smoke: toggle, upload png, upload svg, restart app, position still valid
* Settings persist + reload correctly
* No regression on pet drag / context menu / panel

## Out of Scope (explicit)

* Per-icon size slider (only the default shrinks; custom size is a future task)
* Multiple built-in mascots (only `folyn.svg`)
* Animated GIF frame suppression (GIF renders as `<img>` and animates natively)
* SVG sanitization (accept the risk on user-supplied SVG)
* Image auto-downscaling (rejected oversized files instead of resizing)
* Per-vault pet icon (icon is global, stored in appDataDir)

## Technical Approach

### Settings store (`apps/desktop/src/store/settingsStore.ts`)
* Add `'pet'` to `SettingsTab` union.
* New state: `petIconSource: 'builtin' | 'custom'` (default `'builtin'`), `petIconPath: string` (default `''`), `petSizeVersion: number` (default `2` — current baseline is `1` for the 120×120 era).
* New actions: `setPetIcon(source, path?)`, `bumpPetSizeVersion()`.
* Extend persist allowlist with the three new keys.

### Settings page (`apps/desktop/src/components/pages/SettingsPage.tsx`)
* Add `{ id: 'pet', icon: PawPrint, name: '桌宠' }` to 通用 group in `NAV_GROUPS`.
* New render block `{settingsTab === 'pet' && (...)}`:
  * `Toggle` bound to `petModeEnabled` / `setPetModeEnabled` — "显示桌宠"
  * Radio: 图标 source — 默认 / 自定义
  * "上传图标…" button → `plugin-dialog` `open({ filters: [{ name:'Image', extensions:['png','jpg','jpeg','webp','svg'] }] })` → `readBinaryFile` → size check (1MB) → `writeFile` to `appDataDir/pet-icon.<ext>` (delete prior first) → `setPetIcon('custom', path)`
  * "恢复默认" button → delete file → `setPetIcon('builtin')`
  * Preview thumbnail of current icon

### Pet mascot (`apps/desktop/src/components/pet/PetMascot.tsx`)
* If `petIconSource === 'custom'` and file exists: render `<img src={convertFileSrc(petIconPath)} />` with the same `pet-breathe` / hover / drag CSS classes as the inline SVG.
* Else: render current inline SVG (scaled to 72×72).
* Fallback: if `convertFileSrc` load fails (`onError`), clear `petIconSource` to `'builtin'`.

### Pet window (`apps/desktop/src/components/pet/PetApp.tsx` + `tauri.conf.json`)
* Reduce `SPRITE_SIZE` 120 → 96; reduce mascot SVG 88 → 72.
* Update `tauri.conf.json` `pet` window `width`/`height` to 96.
* Bump `petSizeVersion` so on next launch, if user's stored version < current, re-clamp position to new bounds (mirror `petPanelSizeVersion` logic in `petPosition.ts`).

### Startup orphan sweep (`apps/desktop/src/components/pet/PetApp.tsx` useEffect)
* If `petIconSource !== 'custom'` but `appDataDir/pet-icon.*` exists → delete it.
* If `petIconSource === 'custom'` but file missing → set `petIconSource='builtin'`.
