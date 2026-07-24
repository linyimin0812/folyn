import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { usePetStore, type PetOpacity } from '@/store/petStore';
import { isTauri } from '@/utils/platform';
import { Toggle } from '@/components/settings/primitives';

/**
 * Pet settings tab (PRD: settings-pet-tab-and-custom-icon). Surfaces:
 *  - Toggle "显示桌宠" bound to existing `petModeEnabled` / `setPetModeEnabled`
 *    (the pet window's visibility is owned by the host; this only persists
 *    the user's preference, which the App startup effect re-applies).
 *  - Icon source radio: 默认 (inline SVG) vs. 自定义 (`<img>` from
 *    `petIconPath`). 自定义 with no path yet triggers the upload picker.
 *  - "上传图标…" button: native file picker (png/jpg/jpeg/webp/svg,
 *    ≤1MB) → copy file to `appDataDir/pet-icon.<ext>` → `setPetIcon('custom', path)`.
 *    Files >1MB or non-image extensions are rejected with a local error
 *    message (no toast system reused — the existing settings sections use
 *    local `errorMsg` state, so we follow that pattern).
 *  - "恢复默认" button: deletes any `pet-icon.<ext>` file in appDataDir +
 *    `setPetIcon('builtin')`.
 *  - Preview thumbnail of the current icon (builtin quill.svg or the
 *    custom image via `convertFileSrc`).
 *
 * ACL: the main window's capability file (`capabilities/default.json`)
 * already grants `fs:allow-exists`, `fs:allow-remove`, `fs:allow-read-dir`,
 * `fs:allow-stat`, `fs:allow-read-file`, `fs:allow-write-file`, plus
 * `dialog:default` and `fs:scope-appdata-recursive`. No capability changes
 * needed for the upload/reset flows here.
 */
export function PetSettings() {
  const { t } = useTranslation();
  const petModeEnabled = usePetStore((s) => s.petModeEnabled);
  const setPetModeEnabled = usePetStore((s) => s.setPetModeEnabled);
  const petIconSource = usePetStore((s) => s.petIconSource);
  const petIconPath = usePetStore((s) => s.petIconPath);
  const petIcons = usePetStore((s) => s.petIcons);
  const setPetIcon = usePetStore((s) => s.setPetIcon);
  const addPetIcon = usePetStore((s) => s.addPetIcon);
  const removePetIcon = usePetStore((s) => s.removePetIcon);
  const resetPetIcons = usePetStore((s) => s.resetPetIcons);
  const petOpacity = usePetStore((s) => s.petOpacity);
  const setPetOpacity = usePetStore((s) => s.setPetOpacity);
  const petClickThrough = usePetStore((s) => s.petClickThrough);
  const setPetClickThrough = usePetStore((s) => s.setPetClickThrough);
  const [errorMsg, setErrorMsg] = useState('');
  const [busy, setBusy] = useState(false);

  /** Accepted image extensions for the custom icon (PRD: png/jpg/webp/svg). */
  const VALID_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'svg'];
  /** File-size cap: 10MB. Rejected oversized files instead of resizing. */
  const MAX_ICON_BYTES = 10 * 1024 * 1024;

  // Cross-window icon-change broadcast. The `pet` Tauri window has its own
  // JS context + its own Zustand store instance; `storageClient`'s in-memory
  // cache is per-window with no cross-window invalidation, so a `setPetIcon`
  // call here only updates the main window's store. The pet window would keep
  // rendering the stale icon until next launch. Emit `pet://icon-changed` so
  // `PetApp.tsx`'s listener can `setState` on its own store instance. Guarded
  // with `isTauri()` so non-Tauri/test envs skip the dynamic import. The
  // payload shape mirrors the relevant pet-icon slice (`source`, `path`,
  // `icons`) so the listener can apply it blindly. Reading from
  // `usePetStore.getState()` (rather than taking args) means every call site
  // emits the latest state with no per-call wiring — Zustand's setState is
  // synchronous, so by the time this async runs the state is already settled.
  const emitIconChanged = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const { emit } = await import('@tauri-apps/api/event');
      const { petIconSource: source, petIconPath: path, petIcons: icons } = usePetStore.getState();
      await emit('pet://icon-changed', { source, path, icons });
    } catch {
      // Non-fatal — the pet window will pick up the change on next launch.
    }
  }, []);

  const handleUploadIcon = useCallback(async () => {
    setErrorMsg('');
    if (busy) return;
    setBusy(true);
    try {
      if (!isTauri()) {
        setErrorMsg(t('settings:pet.errors.desktopOnly'));
        return;
      }
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { readFile, writeFile, stat } = await import('@tauri-apps/plugin-fs');
      const { appDataDir, join } = await import('@tauri-apps/api/path');

      const picked = await open({
        filters: [{ name: 'Image', extensions: VALID_EXTS }],
        multiple: false,
      });
      // `open()` returns `string | null | string[]`; with `multiple: false`
      // it's `string | null`. Treat null/[]/array as "user cancelled".
      if (!picked || Array.isArray(picked)) return;
      const filePath = picked as string;

      // Validate extension (the dialog filter restricts, but the user can
      // bypass via "All files" on some platforms — defensive validate).
      const ext = (filePath.split('.').pop() || '').toLowerCase();
      if (!VALID_EXTS.includes(ext)) {
        setErrorMsg(t('settings:pet.errors.unsupportedFormat'));
        return;
      }

      // Validate file size (PRD: 1MB cap, reject instead of resizing).
      let size = 0;
      try {
        const s = await stat(filePath);
        size = s.size;
      } catch {
        // stat can fail on permission edge cases; treat as 0 and let
        // readFile surface a real error if the file is unreadable.
        size = 0;
      }
      if (size > MAX_ICON_BYTES) {
        setErrorMsg(t('settings:pet.errors.fileTooLarge', { kb: (size / 1024).toFixed(0) }));
        return;
      }

      // Copy file to appDataDir/pet-icon-<timestamp>.<ext>. The timestamp
      // disambiguates multiple saved icons (PRD: multi-icon library). The
      // appDataDir is created on demand by `writeFile` (fs plugin creates
      // parent dirs). No deletion of prior files — every upload is a new
      // library entry; reset clears them all.
      const appData = await appDataDir();
      const destPath = await join(appData, `pet-icon-${Date.now()}.${ext}`);

      const bytes = await readFile(filePath);
      if (bytes.length > MAX_ICON_BYTES) {
        // Re-check after read in case stat underreported (defensive).
        setErrorMsg(t('settings:pet.errors.fileTooLarge', { kb: (bytes.length / 1024).toFixed(0) }));
        return;
      }
      await writeFile(destPath, bytes);
      addPetIcon(destPath);
      await emitIconChanged();
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : t('settings:pet.errors.uploadFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, addPetIcon, emitIconChanged, t]);

  const handleTogglePetMode = useCallback(async (v: boolean) => {
    // Optimistic store update so the toggle feels snappy; then invoke the
    // Rust `toggle_pet_mode` command so the actual Tauri window state matches.
    // `toggle_pet_mode` is a *toggle* (not set-absolute), so only call it when
    // the new value differs from the current state — otherwise it would flip
    // the window the wrong way. The `pet://visibility-changed` listener in
    // App.tsx syncs the store flag back from Rust's authoritative state, so
    // if the optimistic update disagrees with Rust, Rust wins.
    if (v === petModeEnabled) return;
    setPetModeEnabled(v);
    if (!isTauri()) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('toggle_pet_mode');
    } catch {
      // Non-fatal — the visibility-changed event will reconcile the flag.
    }
  }, [petModeEnabled, setPetModeEnabled]);

  const handleResetIcon = useCallback(async () => {
    setErrorMsg('');
    try {
      if (!isTauri()) {
        resetPetIcons();
        await emitIconChanged();
        return;
      }
      const { remove, readDir } = await import('@tauri-apps/plugin-fs');
      const { appDataDir, join } = await import('@tauri-apps/api/path');
      const appData = await appDataDir();
      // Delete any pet-icon* files in appDataDir (covers `pet-icon.<ext>`
      // from the legacy single-icon schema and `pet-icon-<ts>.<ext>` from
      // the current multi-icon schema).
      try {
        const entries = await readDir(appData);
        for (const e of entries) {
          if (e.name.startsWith('pet-icon')) {
            try { await remove(await join(appData, e.name)); } catch {}
          }
        }
      } catch {
        // Non-fatal; the flag still clears.
      }
      resetPetIcons();
      await emitIconChanged();
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : t('settings:pet.errors.resetFailed'));
    }
  }, [resetPetIcons, emitIconChanged, t]);

  // Per-icon delete: confirm first (deleting a saved icon is destructive),
  // then remove the file from disk + drop from the library. The store's
  // `removePetIcon` handles the active-selection fallback; this handler
  // also deletes the underlying file so it doesn't linger in appDataDir.
  // File-delete failures are non-fatal (store still updates).
  //
  // Uses `@tauri-apps/plugin-dialog`'s `confirm()` rather than
  // `window.confirm` — browser-extension userscripts (Stay/Tampermonkey)
  // can intercept `window.confirm` and route it through a non-existent
  // `dialog.confirm` command, surfacing as "Command not found". The Tauri
  // plugin's `confirm()` goes through the IPC layer directly and isn't
  // affected. Non-Tauri envs (tests, web preview) fall back to
  // `window.confirm` (no userscript interception there).
  const handleDeleteIcon = useCallback(async (path: string) => {
    let ok = true;
    if (isTauri()) {
      try {
        const { confirm } = await import('@tauri-apps/plugin-dialog');
        ok = await confirm(t('settings:pet.icon.confirmDelete'), { kind: 'warning' });
      } catch {
        // Non-fatal — if the dialog somehow fails, default to proceeding
        // (the user already clicked ×, so intent is clear).
        ok = true;
      }
    } else {
      ok = window.confirm(t('settings:pet.icon.confirmDelete'));
    }
    if (!ok) return;
    try {
      if (isTauri()) {
        const { remove } = await import('@tauri-apps/plugin-fs');
        try { await remove(path); } catch {}
      }
    } catch {
      // Non-fatal — the store update is the source of truth.
    }
    removePetIcon(path);
    await emitIconChanged();
  }, [removePetIcon, emitIconChanged, t]);

  const handleSelectCustom = useCallback(() => {
    // Radio "自定义": if a custom icon is already uploaded, switch to it
    // (pick the most recent if no active path); if the library is empty,
    // trigger the upload picker so the user can pick one (selecting
    // "自定义" with no path would render nothing).
    if (petIconPath) {
      setPetIcon('custom', petIconPath);
      void emitIconChanged();
    } else if (petIcons.length > 0) {
      setPetIcon('custom', petIcons[petIcons.length - 1]);
      void emitIconChanged();
    } else {
      void handleUploadIcon();
    }
  }, [petIconPath, petIcons, setPetIcon, handleUploadIcon, emitIconChanged]);

  // Opacity radio: optimistic store update + Rust `set_pet_opacity` (finds
  // the `pet` window by label and sets NSWindow `setAlphaValue:`). The
  // command is no-op if the pet window isn't currently shown; on next pet
  // mount, `PetApp.tsx` re-applies the persisted opacity.
  const handleOpacityChange = useCallback(async (level: PetOpacity) => {
    setPetOpacity(level);
    if (!isTauri()) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_pet_opacity', { level });
    } catch {
      // Non-fatal; persisted value re-applies on next pet mount.
    }
  }, [setPetOpacity]);

  // Click-through toggle: optimistic store update + Rust
  // `set_pet_click_through` (Tauri `setIgnoreCursorEvents`). When ON, the
  // pet window becomes click-through — including right-click, so the user
  // toggles it OFF from this settings page (the only always-clickable path
  // once the pet is non-interactive).
  const handleToggleClickThrough = useCallback(async (v: boolean) => {
    setPetClickThrough(v);
    if (!isTauri()) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_pet_click_through', { enabled: v });
    } catch {
      // Non-fatal; persisted value re-applies on next pet mount.
    }
  }, [setPetClickThrough]);

  // Preview thumbnail: builtin quill.svg (served from the app's public dir)
  // or the custom image via `convertFileSrc` (resolved in `CustomIconPreview`
  // so the Tauri-only module is only imported when actually rendering a
  // custom preview). The asset protocol scope in tauri.conf.json allows
  // `$APPDATA/**` so appDataDir paths resolve.
  const builtinPreviewSrc = `${import.meta.env.BASE_URL}quill.svg`;

  return (
    <div className="mb-8">
      <div className="pb-3 mb-5 border-b border-brd2 flex items-baseline gap-2">
        <div className="text-[length:calc(var(--ui-font-size)+3px)] font-bold text-t1 tracking-[-0.01em]">{t('settings:pet.title')}</div>
        <div className="text-[length:calc(var(--ui-font-size)-1px)] text-t3">{t('settings:pet.description')}</div>
      </div>

      {/* 显示桌宠 toggle — reuses the existing petModeEnabled flag */}
      <div className="tr flex items-center justify-between py-3.5 border-b border-brd">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:pet.showPet.title')}</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:pet.showPet.desc')}</p>
        </div>
        <Toggle value={petModeEnabled} onChange={(v) => void handleTogglePetMode(v)} />
      </div>

      {/* 图标 source radio */}
      <div className="tr flex items-center justify-between py-3.5 border-b border-brd">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:pet.icon.title')}</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:pet.icon.desc')}</p>
        </div>
        <div className="flex gap-1">
          <button
            className={`py-[5px] px-3 rounded-md text-[11px] font-ui cursor-pointer border transition-all duration-100 ${petIconSource === 'builtin' ? 'border-acc bg-accdim text-acc' : 'border-brd bg-surf text-t2 hover:bg-hov hover:text-t1'}`}
            onClick={() => {
              setPetIcon('builtin');
              void emitIconChanged();
            }}
          >{t('settings:pet.icon.builtin')}</button>
          <button
            className={`py-[5px] px-3 rounded-md text-[11px] font-ui cursor-pointer border transition-all duration-100 ${petIconSource === 'custom' ? 'border-acc bg-accdim text-acc' : 'border-brd bg-surf text-t2 hover:bg-hov hover:text-t1'}`}
            onClick={handleSelectCustom}
          >{t('settings:pet.icon.custom')}</button>
        </div>
      </div>

      {/* Preview + upload / reset actions */}
      <div className="flex items-center gap-4 mt-5">
        <div className="w-14 h-14 rounded-md border border-brd2 bg-surf2 flex items-center justify-center overflow-hidden shrink-0">
          {petIconSource === 'custom' && petIconPath && isTauri() ? (
            <CustomIconPreview path={petIconPath} onError={() => {
              setPetIcon('builtin');
              void emitIconChanged();
            }} />
          ) : (
            <img src={builtinPreviewSrc} alt="Quill" className="w-12 h-12" />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              className="btn btn-g btn-sm"
              disabled={busy}
              onClick={() => void handleUploadIcon()}
            >{busy ? t('settings:pet.icon.uploading') : t('settings:pet.icon.upload')}</button>
            <button
              className="btn btn-g btn-sm"
              disabled={petIcons.length === 0 && petIconSource === 'builtin'}
              onClick={() => void handleResetIcon()}
            >{t('settings:pet.icon.reset')}</button>
          </div>
        <div className="text-[10.5px] text-t3 mt-1">{t('settings:pet.icon.hint')}</div>
        </div>
      </div>

      {/* Library strip — thumbnails of all saved custom icons. Click to
          select as active, × to delete (with confirm). Hidden when the
          library is empty. The active thumbnail is marked three ways —
          thicker accent border, accent-dim background, and a ✓ badge in
          the top-left corner (mirrors the × in the top-right) — so the
          selection reads at a glance even on bright/icon-heavy thumbnails
          where a border alone blends in. */}
      {petIcons.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {petIcons.map((p) => {
            const active = petIconSource === 'custom' && petIconPath === p;
            return (
              <div key={p} className="relative">
                <button
                  className={`w-20 h-20 rounded-md border-2 overflow-hidden flex items-center justify-center transition-colors ${active ? 'border-acc bg-accdim' : 'border-brd2 hover:border-brd'}`}
                  onClick={() => {
                    setPetIcon('custom', p);
                    void emitIconChanged();
                  }}
                  aria-label={t('settings:pet.icon.select')}
                >
                  <CustomIconPreview path={p} onError={() => {
                    // Broken thumbnail — drop from the library silently
                    // (no confirm: the file is already gone/unreadable,
                    // prompting would just confuse the user).
                    removePetIcon(p);
                    void emitIconChanged();
                  }} />
                </button>
                {active && (
                  <div className="absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full bg-acc text-white text-[10px] leading-none flex items-center justify-center pointer-events-center shadow-sm" aria-hidden="true">✓</div>
                )}
                <button
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-surf2 border border-brd2 text-t2 text-[10px] leading-none flex items-center justify-center hover:bg-hov hover:text-t1 shadow-sm"
                  onClick={() => void handleDeleteIcon(p)}
                  aria-label={t('settings:pet.icon.delete')}
                >×</button>
              </div>
            );
          })}
        </div>
      )}

      {errorMsg && (
        <div className="text-[11px] text-[#e53935] mt-3">{errorMsg}</div>
      )}

      {/* 透明度 radio — 4 percentage levels, applies NSWindow setAlphaValue */}
      <div className="tr flex items-center justify-between py-3.5 border-y border-brd mt-3.5">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:pet.opacity.title')}</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:pet.opacity.desc')}</p>
        </div>
        <div className="flex gap-1">
          {(['25', '50', '75', '100'] as PetOpacity[]).map((level) => (
            <button
              key={level}
              className={`py-[5px] px-3 rounded-md text-[11px] font-ui cursor-pointer border transition-all duration-100 ${petOpacity === level ? 'border-acc bg-accdim text-acc' : 'border-brd bg-surf text-t2 hover:bg-hov hover:text-t1'}`}
              onClick={() => void handleOpacityChange(level)}
            >{t(`settings:pet.opacity.level${level}`)}</button>
          ))}
        </div>
      </div>

      {/* 桌宠穿透 toggle — setIgnoreCursorEvents on the pet window */}
      <div className="tr flex items-center justify-between py-3.5 border-b border-brd">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:pet.clickThrough.title')}</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:pet.clickThrough.desc')}</p>
        </div>
        <Toggle value={petClickThrough} onChange={(v) => void handleToggleClickThrough(v)} />
      </div>
    </div>
  );
}

/**
 * Preview `<img>` for a custom pet icon. Resolves `convertFileSrc` lazily
 * (Tauri-only module) and falls back to the builtin quill.svg if the
 * conversion or load fails. Kept as a separate component so the lazy import
 * only runs when actually rendering a custom preview (the common case —
 * builtin — never touches Tauri).
 */
interface CustomIconPreviewProps {
  path: string;
  onError: () => void;
}

function CustomIconPreview({ path, onError }: CustomIconPreviewProps) {
  const { t } = useTranslation();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { convertFileSrc } = await import('@tauri-apps/api/core');
        if (!cancelled) setSrc(convertFileSrc(path));
      } catch {
        if (!cancelled) onError();
      }
    })();
    return () => { cancelled = true; };
  }, [path, onError]);
  if (!src) {
    // Placeholder while the lazy import resolves — fills the parent button.
    return <div className="w-full h-full" />;
  }
  return (
    <img
      src={src}
      alt={t('settings:pet.icon.alt')}
      className="w-full h-full"
      style={{ objectFit: 'contain' }}
      onError={onError}
    />
  );
}

