/**
 * Plugins settings tab — the consent / permissions / lifecycle UI for quill's
 * microkernel (PR4).
 *
 * Surfaces:
 *  - "Install from folder…" button: native folder dialog (`open({directory:true})`)
 *    then `install_plugin(id, sourcePath)`. MVP source is an unpacked folder;
 *    zip extraction is explicitly deferred.
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

import { useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { isTauri } from '@/utils/platform';
import { usePluginStore, type PluginRow } from '@/store/pluginStore';

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
      return '运行中';
    case 'inactive':
      return '已停用';
    case 'failed':
      return '失败';
    default:
      return '已安装';
  }
}

function tierLabel(tier: PluginRow['entry']['tier']): string {
  return tier === 'trusted' ? '可信层' : '沙箱层';
}

/** A single plugin row with its action buttons. */
function PluginRowCard({ row }: { row: PluginRow }) {
  const { entry, state, error } = row;
  const busy = usePluginStore(useShallow((s) => s.busy));
  const activate = usePluginStore((s) => s.activate);
  const deactivate = usePluginStore((s) => s.deactivate);
  const uninstall = usePluginStore((s) => s.uninstall);
  const openConsent = usePluginStore((s) => s.openConsent);

  const isApproveBusy = !!busy[`${entry.id}:approve`];
  const isActivateBusy = !!busy[`${entry.id}:activate`];
  const isDeactivateBusy = !!busy[`${entry.id}:deactivate`];
  const isUninstallBusy = !!busy[`${entry.id}:uninstall`];
  const anyBusy = isApproveBusy || isActivateBusy || isDeactivateBusy || isUninstallBusy;

  // Trusted-tier plugins require explicit TOFU approval before activation.
  // The Approve button opens the consent modal (which calls `approve_plugin`
  // on confirm). Sandbox plugins auto-activate on install — no approval
  // needed (their trust boundary is the iframe sandbox, not a pin).
  const needsApproval = entry.tier === 'trusted' && !entry.trusted;
  const canActivate = state !== 'active' && !needsApproval;
  const canDeactivate = state === 'active';

  const handleApprove = useCallback(() => {
    void openConsent(entry.id);
  }, [entry.id, openConsent]);

  return (
    <div className="tr-info border border-brd rounded-lg p-3 mb-2 bg-surf">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[length:calc(var(--ui-font-size)-1px)] font-semibold text-t1 truncate">
              {entry.name}
            </span>
            <span className="text-[10px] text-t3 font-mono">{entry.version}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${stateBadgeClass(state)}`}>
              {stateLabel(state)}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-brd2 text-t2 bg-surf2">
              {tierLabel(entry.tier)}
            </span>
            {entry.trusted && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-acc/30 text-acc bg-accdim">
                已批准
              </span>
            )}
          </div>
          <div className="text-[10.5px] text-t3 font-mono mt-0.5 truncate">{entry.id}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {needsApproval && (
            <button
              className="btn btn-g btn-sm"
              disabled={anyBusy}
              onClick={handleApprove}
            >
              {isApproveBusy ? '批准中…' : '批准并授权'}
            </button>
          )}
          {canActivate && (
            <button
              className="btn btn-g btn-sm"
              disabled={anyBusy}
              onClick={() => void activate(entry.id)}
            >
              {isActivateBusy ? '启用中…' : '启用'}
            </button>
          )}
          {canDeactivate && (
            <button
              className="btn btn-g btn-sm"
              disabled={anyBusy}
              onClick={() => void deactivate(entry.id)}
            >
              {isDeactivateBusy ? '停用中…' : '停用'}
            </button>
          )}
          <button
            className="btn btn-g btn-sm"
            disabled={anyBusy}
            onClick={() => void uninstall(entry.id)}
            title="卸载插件"
          >
            {isUninstallBusy ? '卸载中…' : '卸载'}
          </button>
        </div>
      </div>
      {error && (
        <div className="text-[11px] text-red-600 dark:text-red-400 mt-1 break-words">
          {error}
        </div>
      )}
    </div>
  );
}

/** The consent modal — lists declared permissions + design-reality warning. */
function ConsentModal() {
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
          批准可信插件
        </div>
        <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t2 mb-3">
          即将批准 <span className="font-semibold text-t1">{consent.name}</span>。
        </div>

        <div className="bg-surf2 border border-brd2 rounded-md p-2.5 mb-3">
          <div className="text-[11px] font-semibold text-t2 mb-1.5">声明的权限与贡献点：</div>
          {consent.permissions.length === 0 ? (
            <div className="text-[11px] text-t3">无</div>
          ) : (
            <ul className="text-[11px] text-t2 space-y-0.5 list-disc list-inside">
              {consent.permissions.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-amber/10 border border-amber/40 rounded-md p-2.5 mb-3">
          <div className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
            ⚠️ 可信插件运行在主进程中，拥有完整的宿主能力（可读写 vault、调用
            Tauri 命令、访问所有 React 状态）。批准等同于完全信任——仅批准来自
            你信任的来源的插件。卸载可随时移除其贡献点。
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn btn-g btn-sm" onClick={closeConsent}>
            取消
          </button>
          <button
            className="btn btn-p btn-sm"
            disabled={busy}
            onClick={() => void approve(consent.id)}
          >
            {busy ? '批准中…' : '我了解，批准'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PluginsSettings() {
  const rows = usePluginStore((s) => s.rows);
  const refreshing = usePluginStore((s) => s.refreshing);
  const installing = usePluginStore((s) => s.installing);
  const error = usePluginStore((s) => s.error);
  const refresh = usePluginStore((s) => s.refresh);
  const installFromFolder = usePluginStore((s) => s.installFromFolder);
  const clearError = usePluginStore((s) => s.clearError);
  const [folderOpen, setFolderOpen] = useState(false);

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

  return (
    <div className="mb-[26px]">
      <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1 mb-[3px] tracking-[-0.01em]">
        插件
      </div>
      <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-3.5">
        安装、批准、启用或卸载第三方插件（微内核 + 插件 SDK）
      </div>

      <div className="flex items-center gap-2 mb-3">
        <button
          className="btn btn-p btn-sm"
          disabled={!!installing || folderOpen || !isTauri()}
          onClick={handleInstallFromFolder}
        >
          {installing ? `安装中（${installing.id}）…` : '从文件夹安装…'}
        </button>
        <button className="btn btn-g btn-sm" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? '刷新中…' : '刷新'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-[11px] rounded-md p-2 mb-3 break-words">
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="text-[12px] text-t3 bg-surf2 border border-brd2 rounded-md p-4 text-center">
          尚未安装任何插件。将插件文件夹放到任意位置，然后点"从文件夹安装"。
          <br />
          示例插件见仓库 <code className="font-mono text-t2">examples/plugins/</code>。
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
