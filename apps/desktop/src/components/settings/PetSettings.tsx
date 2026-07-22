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
  const setPetIcon = usePetStore((s) => s.setPetIcon);
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
  // payload shape is `{ source, path }` so the listener can blindly apply it.
  const emitIconChanged = useCallback(async (source: 'builtin' | 'custom', path: string) => {
    if (!isTauri()) return;
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('pet://icon-changed', { source, path });
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
      const { readFile, writeFile, stat, remove, readDir } = await import('@tauri-apps/plugin-fs');
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

      // Copy file to appDataDir/pet-icon.<ext>. The appDataDir is created
      // on demand by `writeFile` (fs plugin creates parent dirs). Delete
      // any prior pet-icon.<ext> with a DIFFERENT extension first so the
      // orphan doesn't linger (same-extension writes overwrite directly).
      const appData = await appDataDir();
      const destPath = await join(appData, `pet-icon.${ext}`);
      try {
        const entries = await readDir(appData);
        for (const e of entries) {
          if (e.name.startsWith('pet-icon.') && e.name !== `pet-icon.${ext}`) {
            try { await remove(await join(appData, e.name)); } catch {}
          }
        }
      } catch {
        // readDir on appDataDir can fail on first launch (dir doesn't
        // exist yet) — non-fatal, writeFile creates it.
      }

      const bytes = await readFile(filePath);
      if (bytes.length > MAX_ICON_BYTES) {
        // Re-check after read in case stat underreported (defensive).
        setErrorMsg(t('settings:pet.errors.fileTooLarge', { kb: (bytes.length / 1024).toFixed(0) }));
        return;
      }
      await writeFile(destPath, bytes);
      setPetIcon('custom', destPath);
      await emitIconChanged('custom', destPath);
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : t('settings:pet.errors.uploadFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, setPetIcon, emitIconChanged, t]);

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
        setPetIcon('builtin');
        await emitIconChanged('builtin', '');
        return;
      }
      const { remove, readDir } = await import('@tauri-apps/plugin-fs');
      const { appDataDir, join } = await import('@tauri-apps/api/path');
      const appData = await appDataDir();
      // Delete any pet-icon.<ext> files in appDataDir (covers all extensions
      // so a switch from png → svg → reset doesn't leave the png behind).
      try {
        const entries = await readDir(appData);
        for (const e of entries) {
          if (e.name.startsWith('pet-icon.')) {
            try { await remove(await join(appData, e.name)); } catch {}
          }
        }
      } catch {
        // Non-fatal; the flag still clears.
      }
      setPetIcon('builtin');
      await emitIconChanged('builtin', '');
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : t('settings:pet.errors.resetFailed'));
    }
  }, [setPetIcon, emitIconChanged, t]);

  const handleSelectCustom = useCallback(() => {
    // Radio "自定义": if a custom icon is already uploaded, just switch
    // the source flag; if not, trigger the upload picker so the user can
    // pick one (selecting "自定义" with no path would render nothing).
    if (petIconPath) {
      setPetIcon('custom', petIconPath);
      void emitIconChanged('custom', petIconPath);
    } else {
      void handleUploadIcon();
    }
  }, [petIconPath, setPetIcon, handleUploadIcon, emitIconChanged]);

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
    <div className="mb-[26px]">
      <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1 mb-[3px] tracking-[-0.01em]">{t('settings:pet.title')}</div>
      <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-3.5">{t('settings:pet.description')}</div>

      {/* 显示桌宠 toggle — reuses the existing petModeEnabled flag */}
      <div className="tr flex items-center justify-between py-2.5 border-b border-brd">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">{t('settings:pet.showPet.title')}</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">{t('settings:pet.showPet.desc')}</p>
        </div>
        <Toggle value={petModeEnabled} onChange={(v) => void handleTogglePetMode(v)} />
      </div>

      {/* 图标 source radio */}
      <div className="tr flex items-center justify-between py-2.5 border-b border-brd">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">{t('settings:pet.icon.title')}</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">{t('settings:pet.icon.desc')}</p>
        </div>
        <div className="flex gap-1">
          <button
            className={`py-[5px] px-3 rounded-md text-[11px] font-ui cursor-pointer border transition-all duration-100 ${petIconSource === 'builtin' ? 'border-acc bg-accdim text-acc' : 'border-brd bg-surf text-t2 hover:bg-hov hover:text-t1'}`}
            onClick={() => {
              setPetIcon('builtin');
              void emitIconChanged('builtin', '');
            }}
          >{t('settings:pet.icon.builtin')}</button>
          <button
            className={`py-[5px] px-3 rounded-md text-[11px] font-ui cursor-pointer border transition-all duration-100 ${petIconSource === 'custom' ? 'border-acc bg-accdim text-acc' : 'border-brd bg-surf text-t2 hover:bg-hov hover:text-t1'}`}
            onClick={handleSelectCustom}
          >{t('settings:pet.icon.custom')}</button>
        </div>
      </div>

      {/* Preview + upload / reset actions */}
      <div className="flex items-center gap-3 mt-3">
        <div className="w-14 h-14 rounded-md border border-brd2 bg-surf2 flex items-center justify-center overflow-hidden shrink-0">
          {petIconSource === 'custom' && petIconPath && isTauri() ? (
            <CustomIconPreview path={petIconPath} onError={() => {
              setPetIcon('builtin');
              void emitIconChanged('builtin', '');
            }} />
          ) : (
            <img src={builtinPreviewSrc} alt="Quill" className="w-12 h-12" />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <button
              className="btn btn-g btn-sm"
              disabled={busy}
              onClick={() => void handleUploadIcon()}
            >{busy ? t('settings:pet.icon.uploading') : t('settings:pet.icon.upload')}</button>
            <button
              className="btn btn-g btn-sm"
              disabled={petIconSource === 'builtin' && !petIconPath}
              onClick={() => void handleResetIcon()}
            >{t('settings:pet.icon.reset')}</button>
          </div>
          <div className="text-[10.5px] text-t3">{t('settings:pet.icon.hint')}</div>
        </div>
      </div>

      {errorMsg && (
        <div className="text-[11px] text-[#e53935] mt-2">{errorMsg}</div>
      )}

      {/* 透明度 radio — 4 percentage levels, applies NSWindow setAlphaValue */}
      <div className="tr flex items-center justify-between py-2.5 border-b border-brd">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">{t('settings:pet.opacity.title')}</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">{t('settings:pet.opacity.desc')}</p>
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
      <div className="tr flex items-center justify-between py-2.5 border-b border-brd">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">{t('settings:pet.clickThrough.title')}</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">{t('settings:pet.clickThrough.desc')}</p>
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
    // Placeholder while the lazy import resolves — 48×48 transparent box.
    return <div className="w-12 h-12" />;
  }
  return (
    <img
      src={src}
      alt={t('settings:pet.icon.alt')}
      className="w-12 h-12"
      style={{ objectFit: 'contain' }}
      onError={onError}
    />
  );
}
