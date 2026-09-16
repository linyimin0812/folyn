/**
 * Containers settings tab — a gallery of every registered `:::name` container
 * directive (the 14 built-ins + any contributed by an active extension).
 * Each card is a compact, clickable header; clicking opens a modal with the
 * directive's full-fidelity live preview (its own `template` rendered) and a
 * copyable template. Below the gallery, an entrypoint to install third-party
 * extensions that contribute containers (reuses the same install pipeline as
 * Settings → Extensions).
 *
 * Source of the list is {@link ContainerRegistry.getInstance().getAll()} —
 * the singleton the editor's slash-menu and markdown preview also read. It
 * is not reactive, so this component re-reads it on mount and whenever the
 * extension-store `rows` change (install/activate/deactivate/uninstall) —
 * that's the cheapest signal that the registered-container set may have
 * changed, without adding a subscription seam to the registry itself.
 */

import { useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Folder, FileArchive, RefreshCw, Copy, Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ContainerRegistry, FOLYN_CORE_OWNER, type ContainerExtension, type ContainerCategory } from '@folyn/container-extensions';
import { isTauri } from '@/utils/platform';
import { useExtensionStore } from '@/store/extensionStore';
import { usePrefsStore } from '@/store/prefsStore';
import { ContainerPreview } from '@/components/settings/ContainerPreview';
import { Toggle } from '@/components/settings/primitives';
import { ExtensionIcon } from '@/components/settings/ExtensionsSettings';
import type { ExtensionRow } from '@/store/extensionStore';

/** Stable category ordering for the gallery (matches the slash-menu groups). */
const CATEGORY_ORDER: ContainerCategory[] = ['layout', 'media', 'ai', 'data', 'custom'];

/** A compact card: clickable header (opens the preview modal) on the left,
 *  controls on the right — enable/disable toggle, plus an Uninstall button
 *  for external (non-builtin) containers. */
function ContainerCard({ ext, builtin, onPreview }: {
  ext: ContainerExtension;
  builtin: boolean;
  onPreview: () => void;
}) {
  const { t } = useTranslation();
  // Subscribe so the toggle reflects the live enabled state and re-renders
  // immediately on toggle (prefsStore persists across restarts).
  const disabled = usePrefsStore((s) => s.disabledContainers.includes(ext.name));
  const toggleContainerEnabled = usePrefsStore((s) => s.toggleContainerEnabled);
  const uninstall = useExtensionStore((s) => s.uninstall);
  const uninstalling = useExtensionStore(useShallow((s) => !!s.busy[`${ext.name}:uninstall`]));

  // For an external container, ownerOf(name) is the contributing extension's
  // manifest id — uninstalling it removes ALL that extension's containers
  // (via ContainerRegistry.removeByOwner). Builtin (folyn.core) shows no
  // uninstall (can't uninstall built-in directives).
  const ownerId = builtin ? null : ContainerRegistry.getInstance().ownerOf(ext.name);
  const canUninstall = !builtin && !!ownerId && ownerId !== FOLYN_CORE_OWNER;

  const handleUninstall = useCallback(async () => {
    if (!ownerId) return;
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    const ok = await confirm(t('settings:containers.uninstallConfirm.message'), {
      title: t('settings:containers.uninstallConfirm.title'),
      okLabel: t('settings:containers.uninstallConfirm.confirm'),
      cancelLabel: t('settings:containers.uninstallConfirm.cancel'),
    });
    if (!ok) return;
    void uninstall(ownerId);
  }, [ownerId, uninstall, t]);

  return (
    <div className="flex items-start gap-1 bg-surf border border-brd rounded-lg p-2 transition-colors hover:border-acc hover:bg-hov/40 min-w-0">
      <button
        type="button"
        className="flex items-start gap-2 min-w-0 flex-1 text-left bg-transparent border-none cursor-pointer p-0 m-0"
        onClick={onPreview}
      >
        <span className="shrink-0 inline-flex items-center justify-center w-5 h-5 text-[14px] leading-none" aria-hidden>
          {ext.icon}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[length:calc(var(--ui-font-size)-1px)] font-semibold text-t1 truncate">
              {ext.label}
            </span>
            {builtin ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-acc/30 text-acc bg-accdim">
                {t('settings:containers.builtin')}
              </span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-brd2 text-t2 bg-surf2">
                {t('settings:containers.external')}
              </span>
            )}
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-brd2 text-t2 bg-surf2">
              {t(`settings:containers.category.${ext.category}`)}
            </span>
            <span className="text-[10.5px] text-t3 font-mono truncate">
              :::{ext.name}
            </span>
          </div>
          {ext.description && (
            <div className="text-[11px] text-t2 mt-0.5 truncate" title={ext.description}>
              {ext.description}
            </div>
          )}
        </div>
      </button>

      {/* Right-side controls. Toggle reuses the standard settings switch
          primitive. External (non-builtin) containers get an Uninstall button
          (ownerOf(name) = the contributing extension's id → uninstalling
          removes all its containers). */}
      <div className="flex items-center gap-2 shrink-0 mt-0.5">
        <Toggle
          value={!disabled}
          onChange={() => toggleContainerEnabled(ext.name)}
        />
        {canUninstall && (
          <button
            type="button"
            className="btn btn-d btn-sm"
            disabled={uninstalling}
            onClick={handleUninstall}
            title={t('settings:containers.uninstallTitle')}
          >
            {uninstalling ? t('settings:containers.uninstalling') : t('settings:containers.uninstall')}
          </button>
        )}
      </div>
    </div>
  );
}

/** A pending (not-yet-active) container extension card — same layout as
 *  an installed ContainerCard, but driven by ExtensionRow metadata (the
 *  extension isn't activated, so its containers aren't in the registry yet).
 *  No preview (containers can't render until activated); just icon + name +
 *  badges + description + Approve/Uninstall buttons. */
function PendingContainerCard({ row, onApprove, onUninstall }: {
  row: ExtensionRow;
  onApprove: () => void;
  onUninstall: () => void;
}) {
  const { t } = useTranslation();
  const approveBusy = useExtensionStore(useShallow((s) => !!s.busy[`${row.entry.id}:approve`]));
  const uninstallBusy = useExtensionStore(useShallow((s) => !!s.busy[`${row.entry.id}:uninstall`]));
  const anyBusy = approveBusy || uninstallBusy;
  const needsApproval = row.entry.tier === 'trusted' && !row.entry.trusted;

  return (
    <div className="flex items-start gap-1 bg-surf border border-brd rounded-lg p-2 transition-colors hover:border-acc hover:bg-hov/40 min-w-0">
      <div className="flex items-start gap-2 min-w-0 flex-1">
        <ExtensionIcon icon={row.icon} name={row.entry.name} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[length:calc(var(--ui-font-size)-1px)] font-semibold text-t1 truncate">
              {row.entry.name}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-brd2 text-t2 bg-surf2">
              {t('settings:containers.external')}
            </span>
            <span className="text-[10.5px] text-t3 font-mono truncate">
              {row.entry.id}
            </span>
          </div>
          {row.description && (
            <div className="text-[11px] text-t2 mt-0.5 truncate" title={row.description}>
              {row.description}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 mt-0.5">
        <button
          type="button"
          className="btn btn-p btn-sm"
          disabled={anyBusy}
          onClick={onApprove}
        >
          {approveBusy
            ? t('settings:containers.approving')
            : needsApproval
              ? t('settings:containers.approve')
              : t('settings:containers.activate')}
        </button>
        <button
          type="button"
          className="btn btn-d btn-sm"
          disabled={anyBusy}
          onClick={onUninstall}
          title={t('settings:containers.uninstallTitle')}
        >
          {uninstallBusy ? t('settings:containers.uninstalling') : t('settings:containers.uninstall')}
        </button>
      </div>
    </div>
  );
}

/** Modal showing the full-fidelity live preview + template for one directive.
 *  Click-outside / Esc / X closes. The preview uses the non-compact
 *  `.md-preview` so it matches the editor's real rendering. */
function ContainerPreviewModal({ ext, builtin, onClose }: {
  ext: ContainerExtension;
  builtin: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  // Esc closes; one listener for the modal's lifetime.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(ext.template).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  }, [ext.template]);

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-brd rounded-lg w-[min(760px,92vw)] max-h-[86vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 p-3 border-b border-brd2">
          <div className="flex items-start gap-2 min-w-0">
            <span className="shrink-0 inline-flex items-center justify-center w-5 h-5 text-[16px] leading-none mt-0.5" aria-hidden>
              {ext.icon}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1 truncate">
                  {ext.label}
                </span>
                {builtin ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-acc/30 text-acc bg-accdim">
                    {t('settings:containers.builtin')}
                  </span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-brd2 text-t2 bg-surf2">
                    {t('settings:containers.external')}
                  </span>
                )}
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-brd2 text-t2 bg-surf2">
                  {t(`settings:containers.category.${ext.category}`)}
                </span>
              </div>
              <div className="text-[11px] text-t3 font-mono mt-0.5 truncate">
                :::{ext.name}
              </div>
              {ext.description && (
                <div className="text-[11px] text-t2 mt-0.5" title={ext.description}>
                  {ext.description}
                </div>
              )}
            </div>
          </div>
          <button
            className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-md text-t3 hover:text-t1 hover:bg-hov transition-colors"
            onClick={onClose}
            aria-label={t('settings:containers.preview')}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body: template (top) + live preview (below), scrollable. */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {/* Template source + copy. */}
          <div className="relative">
            <button
              className="absolute top-1 right-1 inline-flex items-center gap-1 h-[20px] px-1.5 rounded text-[10px] font-ui border border-brd2 bg-surf2 text-t3 hover:text-t1 hover:border-acc transition-colors"
              onClick={handleCopy}
              title={t('settings:containers.copyTemplate')}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? t('settings:containers.copied') : t('settings:containers.copyTemplate')}
            </button>
            <pre className="text-[11px] font-mono text-t2 bg-surf2 border border-brd2 rounded-md px-2.5 py-2 m-0 overflow-x-auto whitespace-pre">
              {ext.template}
            </pre>
          </div>

          {/* Live preview — full-fidelity (non-compact) so it matches the
              editor. The frame vertically centers the preview within a
              min-height so short directives sit in the middle. */}
          <div className="border border-brd2 rounded-md bg-panel overflow-hidden">
            <div className="p-4 overflow-x-auto flex items-center justify-center min-h-[120px]">
              <ContainerPreview template={ext.template} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ContainersSettings() {
  const { t } = useTranslation();
  const [containers, setContainers] = useState<ContainerExtension[]>([]);
  // The directive whose preview modal is open (null = closed). Parent-owned
  // so there's exactly one modal for the whole gallery, regardless of how
  // many cards are rendered.
  const [previewing, setPreviewing] = useState<ContainerExtension | null>(null);

  // The extension store is the cheapest reactivity signal for "the registered-
  // container set may have changed": install/activate/deactivate/uninstall all
  // mutate rows. Subscribe to the rows identity and re-read the registry when it
  // changes — no new subscription seam needed on ContainerRegistry itself.
  // (Builtin containers register once at app boot, before this tab renders.)
  const rows = useExtensionStore(useShallow((s) => s.rows));
  const installing = useExtensionStore((s) => s.installing);
  const error = useExtensionStore((s) => s.error);
  const clearError = useExtensionStore((s) => s.clearError);
  const installFromFolder = useExtensionStore((s) => s.installFromFolder);
  const installFromZip = useExtensionStore((s) => s.installFromZip);
  const approve = useExtensionStore((s) => s.approve);
  const activate = useExtensionStore((s) => s.activate);
  const uninstall = useExtensionStore((s) => s.uninstall);

  const [folderOpen, setFolderOpen] = useState(false);
  const [zipOpen, setZipOpen] = useState(false);

  // (Re)read the registry on mount and whenever the extension rows change.
  useEffect(() => {
    setContainers(ContainerRegistry.getInstance().getAll());
  }, [rows]);

  const handleInstallFromFolder = useCallback(async () => {
    if (folderOpen) return;
    setFolderOpen(true);
    clearError();
    try {
      if (!isTauri()) return;
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
      if (!isTauri()) return;
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({
        filters: [{ name: 'Extension zip', extensions: ['zip'] }],
        multiple: false,
      });
      if (!picked || Array.isArray(picked)) return;
      await installFromZip(picked as string);
    } finally {
      setZipOpen(false);
    }
  }, [zipOpen, installFromZip, clearError]);

  // Group by category in stable order; unknown categories fall to "custom".
  // `tab` and `step` are internal sub-directives — they only render
  // meaningfully inside `tabs`/`steps` (TabComponent is display:none until
  // collected by its parent; StepComponent's number relies on a `steps`
  // counter). Excluded from the gallery exactly like the slash menu; their
  // parent directives already preview with sample children.
  const GALLERY_HIDDEN = new Set(['tab', 'step']);
  const visible = containers.filter((c) => !GALLERY_HIDDEN.has(c.name));
  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: visible.filter((c) => (c.category ?? 'custom') === cat),
  })).filter((g) => g.items.length > 0);

  // Installed extensions that contribute containers but aren't active yet
  // (e.g. a freshly-installed trusted container extension awaiting TOFU
  // approval). Surface them here so the user sees their install + can
  // approve/activate it from the Containers page, instead of wondering where
  // the new directive went (it only registers into ContainerRegistry after
  // activation).
  const pending = rows.filter(
    (r) => !r.builtin && (r.contributesContainers ?? 0) > 0 && r.state !== 'active',
  );

  return (
    <div className="mb-8">
      {/* Install entrypoint — same pipeline as Settings → Extensions, surfaced
          here so a container-focused user doesn't have to leave the tab. */}
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <button
          className="btn btn-p btn-sm inline-flex items-center gap-1.5"
          disabled={!!installing || folderOpen || zipOpen || !isTauri()}
          onClick={handleInstallFromFolder}
        >
          <Folder size={13} />
          {installing ? t('settings:containers.installing', { id: installing.id }) : t('settings:containers.installFromFolder')}
        </button>
        <button
          className="btn btn-p btn-sm inline-flex items-center gap-1.5"
          disabled={!!installing || folderOpen || zipOpen || !isTauri()}
          onClick={handleInstallFromZip}
        >
          <FileArchive size={13} />
          {installing ? t('settings:containers.installing', { id: installing.id }) : t('settings:containers.installFromZip')}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-[11px] rounded-md p-2 mb-3 break-words">
          {error}
        </div>
      )}

      {pending.length > 0 && (
        <div className="mb-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-[3px] h-[12px] rounded-full bg-amber-500" />
            <h3 className="text-[11.5px] font-bold text-t1 m-0">
              {t('settings:containers.pendingTitle')}
            </h3>
            <span className="text-[10px] text-t3">{pending.length}</span>
          </div>
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: 'repeat(2, 1fr)', alignItems: 'start' }}
          >
            {pending.map((r) => {
              const needsApproval = r.entry.tier === 'trusted' && !r.entry.trusted;
              const handleApprove = () => {
                if (needsApproval) void approve(r.entry.id);
                else void activate(r.entry.id);
              };
              const handleUninstall = async () => {
                const { confirm } = await import('@tauri-apps/plugin-dialog');
                const ok = await confirm(t('settings:containers.uninstallConfirm.message'), {
                  title: t('settings:containers.uninstallConfirm.title'),
                  okLabel: t('settings:containers.uninstallConfirm.confirm'),
                  cancelLabel: t('settings:containers.uninstallConfirm.cancel'),
                });
                if (ok) void uninstall(r.entry.id);
              };
              return (
                <PendingContainerCard
                  key={r.entry.id}
                  row={r}
                  onApprove={handleApprove}
                  onUninstall={() => void handleUninstall()}
                />
              );
            })}
          </div>
        </div>
      )}

      {containers.length === 0 ? (
        <div className="text-[12px] text-t3 bg-surf2 border border-brd2 rounded-md p-4 text-center">
          {t('settings:containers.empty')}
        </div>
      ) : (
        <div>
          {grouped.map((g) => (
            <div key={g.cat} className="mb-3.5">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="w-[3px] h-[12px] rounded-full bg-t2" />
                <h3 className="text-[11.5px] font-bold text-t1 m-0">
                  {t(`settings:containers.category.${g.cat}`)}
                </h3>
                <span className="text-[10px] text-t3">{g.items.length}</span>
              </div>
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: 'repeat(2, 1fr)', alignItems: 'start' }}
              >
                {g.items.map((ext) => (
                  <ContainerCard
                    key={ext.name}
                    ext={ext}
                    builtin={
                      ContainerRegistry.getInstance().ownerOf(ext.name) === FOLYN_CORE_OWNER
                    }
                    onPreview={() => setPreviewing(ext)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2.5 text-[11px] text-t3 flex items-center gap-1.5">
        <RefreshCw size={11} className="shrink-0" />
        {t('settings:containers.installHint')}
      </div>

      {previewing && (
        <ContainerPreviewModal
          ext={previewing}
          builtin={
            ContainerRegistry.getInstance().ownerOf(previewing.name) === FOLYN_CORE_OWNER
          }
          onClose={() => setPreviewing(null)}
        />
      )}
    </div>
  );
}
