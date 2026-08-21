/**
 * Plugins settings tab — the consent / permissions / lifecycle UI for quill's
 * microkernel (PR4).
 *
 * Surfaces:
 *  - "Install from folder…" button: native folder dialog (`open({directory:true})`)
 *    then `install_plugin(id, sourcePath)`. Dev/debug path — unpacked folder.
 *  - "Install from .zip…" button: native file dialog
 *    (`open({filters:[{extensions:['zip']}]})`) then
 *    `install_plugin_zip(id, zipPath)`. Main distribution path — compiled-only
 *    archive; the Rust side filters source/lockfiles/configs out of the zip.
 *  - List of installed plugins (from `usePluginStore.rows`): id, name,
 *    version, tier, state, permissions summary.
 *  - Per-plugin actions: Approve (trusted tier only — opens the consent
 *    modal), Activate/Deactivate, Uninstall.
 *  - Consent modal: lists declared permissions + the design-reality warning
 *    that trusted = full power. On confirm → `approve_plugin`. On cancel →
 *    leave unapproved (the plugin stays installed but inactive).
 *
 * State ownership (see state-management.md): this component is stateless
 * beyond local UI affordances (folder dialog open). All plugin state lives in
 * `usePluginStore`; this component subscribes via granular selectors. The
 * store refreshes itself after each action; App.tsx's lifecycle-event
 * listeners also call `refresh()` so the tab stays live even when the change
 * originates elsewhere (e.g. another window, or a future CLI install path).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { isTauri } from '@/utils/platform';
import { usePluginStore, type PluginRow } from '@/store/pluginStore';
import { useAppearanceStore } from '@/store/appearanceStore';
import { Toggle } from '@/components/settings/primitives';
import { ThemeIcon, hasIcon } from '@/components/icons/ThemeIcon';
import { FeatureAdapterDropdown } from '@/components/settings/FeatureAdapterDropdown';

/** State badge color per runtime state. */
function stateBadgeClass(state: PluginRow['state']): string {
  switch (state) {
    case 'active':
      return 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30';
    case 'inactive':
      return 'bg-surf2 text-t2 border-brd2';
    case 'failed':
      return 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30';
    default:
      return 'bg-accdim text-acc border-acc/30';
  }
}

function stateLabel(state: PluginRow['state']): string {
  switch (state) {
    case 'active':
      return i18n.t('settings:plugins.state.active');
    case 'inactive':
      return i18n.t('settings:plugins.state.inactive');
    case 'failed':
      return i18n.t('settings:plugins.state.failed');
    default:
      return i18n.t('settings:plugins.state.installed');
  }
}

function tierLabel(tier: PluginRow['entry']['tier']): string {
  return i18n.t(tier === 'trusted' ? 'settings:plugins.tier.trusted' : 'settings:plugins.tier.sandbox');
}

/** Render a plugin's manifest icon at a fixed 20×20 slot. Inline SVG is
 * rendered as a data-URI <img> — empirically reliable in the Tauri webview,
 * where dangerouslySetInnerHTML-injected SVG fails to paint. Because an
 * <img>-loaded SVG is an isolated document (currentColor / CSS vars don't
 * resolve inside it), currentColor references are substituted with the
 * theme's actual --t2 value before encoding, so stroke/fill="currentColor"
 * icons keep a visible, theme-appropriate color. A host ThemeIcon name
 * (e.g. "folder") is rendered via ThemeIcon; emoji/short text is rendered
 * as text; absent icon falls back to the first letter of the plugin name. */
function PluginIcon({ icon, iconDark, name }: { icon: string | undefined; iconDark?: string; name: string }) {
  // Subscribed so --t2 is re-resolved (and the data URI rebuilt) on theme change.
  const theme = useAppearanceStore((s) => s.theme);
  const size = 20;
  const boxCls =
    'shrink-0 inline-flex items-center justify-center rounded bg-surf2 border border-brd2 text-t2 overflow-hidden';

  // Pick the dark SVG text when a dark variant is provided AND the resolved
  // theme is dark. `theme` from the store covers user-toggled light/dark;
  // `dataset.theme` covers the 'system' → matchMedia path (set by setTheme).
  const resolvedDark = typeof document !== 'undefined'
    ? document.documentElement.dataset.theme === 'dark'
    : theme === 'dark';
  const effectiveIcon = resolvedDark && iconDark ? iconDark : icon;

  const dataUri = useMemo(() => {
    if (!effectiveIcon) return null;
    // Strip the XML prologue / DOCTYPE that design-tool-exported SVGs often
    // carry — otherwise the startsWith('<svg') check misses and the raw SVG
    // source would end up rendered as text.
    const svgText = effectiveIcon
      .trim()
      .replace(/^<\?xml[^?]*\?>\s*/, '')
      .replace(/^<!DOCTYPE[^>]*>\s*/i, '');
    if (!svgText.startsWith('<svg')) return null;
    const t2 = getComputedStyle(document.documentElement).getPropertyValue('--t2').trim();
    const colored = t2 ? svgText.replace(/currentColor/gi, t2) : svgText;
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(colored)))}`;
    // theme + effectiveIcon in deps: re-resolve --t2 and swap dark/light on theme switch
  }, [effectiveIcon, theme]);

  if (dataUri) {
    return <img src={dataUri} width={size} height={size} className="shrink-0" alt="" />;
  }

  // .svg file path that wasn't inlined by the store (defensive fallback).
  // This shouldn't normally be reached — fetchRows() in the store resolves
  // .svg paths — but serves as a safety net.
  if (effectiveIcon && effectiveIcon.trim().toLowerCase().endsWith('.svg') && !effectiveIcon.trim().startsWith('<svg')) {
    return (
      <span
        className={boxCls}
        style={{ width: size, height: size, fontSize: 11, fontWeight: 600, lineHeight: 1 }}
        aria-hidden
      >
        {(name.trim()[0] ?? '?').toUpperCase()}
      </span>
    );
  }

  // Host ThemeIcon name.
  if (icon && hasIcon(icon.trim())) {
    return <ThemeIcon name={icon.trim()} size={size} className={boxCls} />;
  }

  // Emoji or short text (e.g. "👋", "📝", "▦").
  if (icon && icon.trim().length > 0) {
    return (
      <span
        className={boxCls}
        style={{ width: size, height: size, fontSize: 12, lineHeight: 1 }}
        aria-hidden
      >
        {icon.trim()}
      </span>
    );
  }

  // First-letter avatar (fallback when no icon is declared).
  return (
    <span
      className={boxCls}
      style={{ width: size, height: size, fontSize: 11, fontWeight: 600, lineHeight: 1 }}
      aria-hidden
    >
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

/** A single plugin row with its action buttons. */
function PluginRowCard({ row }: { row: PluginRow }) {
  const { t } = useTranslation();
  const { entry, state, error, icon, description, builtin, nameKey, descKey } = row;
  const busy = usePluginStore(useShallow((s) => s.busy));
  const activate = usePluginStore((s) => s.activate);
  const deactivate = usePluginStore((s) => s.deactivate);
  const uninstall = usePluginStore((s) => s.uninstall);
  const openConsent = usePluginStore((s) => s.openConsent);
  // Built-in rows bind their enable toggle to appearanceStore flags (the
  // source of truth for panel visibility), not to pluginHost.activate. Grab
  // all 3 flag/setter pairs unconditionally — hooks can't be conditional,
  // and these subscriptions are cheap (zustand shallow-equals primitives).
  const enableWikiPanel = useAppearanceStore((s) => s.enableWikiPanel);
  const enableClipsPanel = useAppearanceStore((s) => s.enableClipsPanel);
  const enableAnalyzePanel = useAppearanceStore((s) => s.enableAnalyzePanel);
  const enableSchedulePanel = useAppearanceStore((s) => s.enableSchedulePanel);
  const enableTranslationPanel = useAppearanceStore((s) => s.enableTranslationPanel);
  const setEnableWikiPanel = useAppearanceStore((s) => s.setEnableWikiPanel);
  const setEnableClipsPanel = useAppearanceStore((s) => s.setEnableClipsPanel);
  const setEnableAnalyzePanel = useAppearanceStore((s) => s.setEnableAnalyzePanel);
  const setEnableSchedulePanel = useAppearanceStore((s) => s.setEnableSchedulePanel);
  const setEnableTranslationPanel = useAppearanceStore((s) => s.setEnableTranslationPanel);
  // Render errors captured by PanelErrorBoundary for this plugin's surfaces.
  // A plugin that threw during render is isolated (never crashes the host),
  // but surfaced here so the user can see something went wrong + clear it.
  const renderErrors = usePluginStore((s) => s.renderErrors[entry.id]);
  const clearRenderErrors = usePluginStore((s) => s.clearRenderErrors);

  const isApproveBusy = !!busy[`${entry.id}:approve`];
  const isActivateBusy = !!busy[`${entry.id}:activate`];
  const isDeactivateBusy = !!busy[`${entry.id}:deactivate`];
  const isUninstallBusy = !!busy[`${entry.id}:uninstall`];
  const anyBusy = isApproveBusy || isActivateBusy || isDeactivateBusy || isUninstallBusy;

  // Trusted-tier plugins require explicit TOFU approval before activation.
  // The Approve button opens the consent modal (which calls `approve_plugin`
  // on confirm). Sandbox plugins auto-activate on install — no approval
  // needed (their trust boundary is the iframe sandbox, not a pin).
  const needsApproval = !builtin && entry.tier === 'trusted' && !entry.trusted;
  const isActive = builtin
    ? (entry.id === 'builtin:wiki' ? enableWikiPanel
        : entry.id === 'builtin:clips' ? enableClipsPanel
        : entry.id === 'builtin:analyze' ? enableAnalyzePanel
        : entry.id === 'builtin:schedule' ? enableSchedulePanel
        : entry.id === 'builtin:translation' ? enableTranslationPanel
        : false)
    : state === 'active';
  const toggleBusy = isActivateBusy || isDeactivateBusy;
  const toggleValue = isActive && !toggleBusy;

  const handleApprove = useCallback(() => {
    void openConsent(entry.id);
  }, [entry.id, openConsent]);

  const handleUninstall = useCallback(async () => {
    if (!isTauri()) {
      void uninstall(entry.id);
      return;
    }
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    const ok = await confirm(t('settings:plugins.uninstallConfirm.message'), {
      title: t('settings:plugins.uninstallConfirm.title'),
      okLabel: t('settings:plugins.uninstallConfirm.confirm'),
      cancelLabel: t('settings:plugins.uninstallConfirm.cancel'),
    });
    if (!ok) return;
    void uninstall(entry.id);
  }, [entry.id, uninstall, t]);

  const displayName = builtin && nameKey ? t(nameKey) : entry.name;
  const displayDesc = builtin && descKey ? t(descKey) : description;

  return (
    <div className="tr-info border border-brd rounded-lg p-3 mb-2 bg-surf">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-start gap-2 min-w-0">
          <PluginIcon icon={icon} iconDark={row.iconDark} name={displayName} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[length:calc(var(--ui-font-size)-1px)] font-semibold text-t1 truncate">
                {displayName}
              </span>
              {!builtin && (
                <span className="text-[10px] text-t3 font-mono">{entry.version}</span>
              )}
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${stateBadgeClass(state)}`}>
                {stateLabel(state)}
              </span>
              {builtin ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-acc/30 text-acc bg-accdim">
                  {t('settings:plugins.builtin')}
                </span>
              ) : (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-brd2 text-t2 bg-surf2">
                  {tierLabel(entry.tier)}
                </span>
              )}
              {!builtin && entry.trusted && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-acc/30 text-acc bg-accdim">
                  {t('settings:plugins.approved')}
                </span>
              )}
            </div>
            <div className="text-[10.5px] text-t3 font-mono mt-0.5 truncate">{entry.id}</div>
            {displayDesc && (
              <div
                className="text-[11px] text-t2 mt-0.5 truncate"
                title={displayDesc}
              >
                {displayDesc}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {needsApproval && (
            <button
              className="btn btn-g btn-sm"
              disabled={anyBusy}
              onClick={handleApprove}
            >
              {isApproveBusy ? t('settings:plugins.approving') : t('settings:plugins.approve')}
            </button>
          )}
          {builtin && <FeatureAdapterDropdown rowId={entry.id} />}
          {(!needsApproval || builtin) && (
            <Toggle
              value={toggleValue}
              onChange={(v) => {
                if (builtin) {
                  if (entry.id === 'builtin:wiki') setEnableWikiPanel(v);
                  else if (entry.id === 'builtin:clips') setEnableClipsPanel(v);
                  else if (entry.id === 'builtin:analyze') setEnableAnalyzePanel(v);
                  else if (entry.id === 'builtin:schedule') setEnableSchedulePanel(v);
                  else if (entry.id === 'builtin:translation') setEnableTranslationPanel(v);
                  return;
                }
                if (v && !isActive) void activate(entry.id);
                else if (!v && isActive) void deactivate(entry.id);
              }}
            />
          )}
          {!builtin && (
            <button
              className="btn btn-g btn-sm"
              disabled={anyBusy}
              onClick={handleUninstall}
              title={t('settings:plugins.uninstallTitle')}
            >
              {isUninstallBusy ? t('settings:plugins.uninstalling') : t('settings:plugins.uninstall')}
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="text-[11px] text-red-600 dark:text-red-400 mt-1 break-words">
          {error}
        </div>
      )}
      {renderErrors?.length ? (
        <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-1 flex items-center gap-1.5">
          <TriangleAlert size={12} className="shrink-0" />
          <span className="truncate" title={renderErrors[renderErrors.length - 1].message}>
            {t('settings:plugins.renderError', { label: renderErrors[renderErrors.length - 1].label })}
          </span>
          <button
            className="ml-auto shrink-0 underline hover:text-t1"
            onClick={() => clearRenderErrors(entry.id)}
          >
            {t('settings:plugins.clearRenderError')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The consent modal — lists declared permissions + design-reality warning. */
function ConsentModal() {
  const { t } = useTranslation();
  const consent = usePluginStore((s) => s.consent);
  const approve = usePluginStore((s) => s.approve);
  const closeConsent = usePluginStore((s) => s.closeConsent);
  const busy = usePluginStore(useShallow((s) => (consent ? !!s.busy[`${consent.id}:approve`] : false)));

  if (!consent) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
      onClick={closeConsent}
    >
      <div
        className="bg-panel border border-brd rounded-lg p-4 max-w-md w-[90vw] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1 mb-1">
          {t('settings:plugins.consent.title')}
        </div>
        <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t2 mb-3">
          {t('settings:plugins.consent.intro')} <span className="font-semibold text-t1">{consent.name}</span>。
        </div>

        <div className="bg-surf2 border border-brd2 rounded-md p-2.5 mb-3">
          <div className="text-[11px] font-semibold text-t2 mb-1.5">{t('settings:plugins.consent.permissionsLabel')}</div>
          {consent.permissions.length === 0 ? (
            <div className="text-[11px] text-t3">{t('settings:plugins.consent.noPermissions')}</div>
          ) : (
            <ul className="text-[11px] text-t2 space-y-0.5 list-disc list-inside">
              {consent.permissions.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-amber/10 border border-amber/40 rounded-md p-2.5 mb-3">
          <div className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed flex gap-1.5">
            <TriangleAlert size={13} className="shrink-0 mt-0.5" />
            <span>{t('settings:plugins.consent.warning')}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn btn-g btn-sm" onClick={closeConsent}>
            {t('settings:plugins.consent.cancel')}
          </button>
          <button
            className="btn btn-p btn-sm"
            disabled={busy}
            onClick={() => void approve(consent.id)}
          >
            {busy ? t('settings:plugins.approving') : t('settings:plugins.consent.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PluginsSettings() {
  const { t } = useTranslation();
  const rows = usePluginStore((s) => s.rows);
  const refreshing = usePluginStore((s) => s.refreshing);
  const installing = usePluginStore((s) => s.installing);
  const error = usePluginStore((s) => s.error);
  const refresh = usePluginStore((s) => s.refresh);
  const installFromFolder = usePluginStore((s) => s.installFromFolder);
  const installFromZip = usePluginStore((s) => s.installFromZip);
  const clearError = usePluginStore((s) => s.clearError);
  const [folderOpen, setFolderOpen] = useState(false);
  const [zipOpen, setZipOpen] = useState(false);

  // Refresh on mount + whenever the tab gains focus (cheap; guards against
  // external mutation). The listener in App.tsx also calls refresh on
  // lifecycle events, so this is best-effort, not the only path.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleInstallFromFolder = useCallback(async () => {
    if (folderOpen) return;
    setFolderOpen(true);
    clearError();
    try {
      if (!isTauri()) {
        return;
      }
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({ directory: true, multiple: false });
      if (!picked || Array.isArray(picked)) return;
      await installFromFolder(picked as string);
    } finally {
      setFolderOpen(false);
    }
  }, [folderOpen, installFromFolder, clearError]);

  const handleInstallFromZip = useCallback(async () => {
    if (zipOpen) return;
    setZipOpen(true);
    clearError();
    try {
      if (!isTauri()) {
        return;
      }
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({
        filters: [{ name: 'Plugin zip', extensions: ['zip'] }],
        multiple: false,
      });
      if (!picked || Array.isArray(picked)) return;
      await installFromZip(picked as string);
    } finally {
      setZipOpen(false);
    }
  }, [zipOpen, installFromZip, clearError]);

  return (
    <div className="mb-8">
      <div className="pb-3 mb-5 border-b border-brd2 flex items-baseline gap-2">
        <div className="text-[length:calc(var(--ui-font-size)+3px)] font-bold text-t1 tracking-[-0.01em]">
          {t('settings:plugins.title')}
        </div>
        <div className="text-[length:calc(var(--ui-font-size)-1px)] text-t3">
          {t('settings:plugins.description')}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <button
          className="btn btn-p btn-sm"
          disabled={!!installing || folderOpen || zipOpen || !isTauri()}
          onClick={handleInstallFromFolder}
        >
          {installing ? t('settings:plugins.installing', { id: installing.id }) : t('settings:plugins.installFromFolder')}
        </button>
        <button
          className="btn btn-p btn-sm"
          disabled={!!installing || folderOpen || zipOpen || !isTauri()}
          onClick={handleInstallFromZip}
        >
          {installing ? t('settings:plugins.installing', { id: installing.id }) : t('settings:plugins.installFromZip')}
        </button>
        <button className="btn btn-g btn-sm" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? t('settings:plugins.refreshing') : t('settings:plugins.refresh')}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-[11px] rounded-md p-2 mb-3 break-words">
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="text-[12px] text-t3 bg-surf2 border border-brd2 rounded-md p-4 text-center">
          {t('settings:plugins.empty')}
        </div>
      ) : (
        <div>
          {rows.map((row) => (
            <PluginRowCard key={row.entry.id} row={row} />
          ))}
        </div>
      )}

      <ConsentModal />
    </div>
  );
}
