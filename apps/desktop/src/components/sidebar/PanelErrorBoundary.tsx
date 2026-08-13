/**
 * Error boundary wrapping each sidebar panel component so a throwing plugin
 * panel doesn't white-screen the whole sidebar (Decision Q3, PRD acceptance).
 *
 * Minimal: on render error, render a small "面板加载失败" message with the
 * error text. The rest of the sidebar (other panels, the activity bar, the
 * file tree) is unaffected because the boundary isolates only the active
 * panel's component subtree.
 *
 * Also the host's trusted-plugin render-isolation chokepoint: when `pluginId`
 * is set, the throw is recorded to `pluginStore` so Settings → Plugins can
 * surface an "errored" indicator (a third-party plugin that throws during
 * render is contained here, never crashing the host, but the user should see
 * *something* went wrong). Builtin surfaces omit `pluginId` → console-only,
 * matching the original behavior.
 */

import React from 'react';
import i18n from '@/i18n';
import { usePluginStore } from '@/store/pluginStore';

interface PanelErrorBoundaryProps {
  children: React.ReactNode;
  /** Panel id, for diagnostics in the fallback message. */
  panelId?: string;
  /** Plugin id owning this surface. When set, the throw is recorded to
   * pluginStore (Settings → Plugins errored badge). Absent for builtin
   * surfaces (console-only, original behavior). */
  pluginId?: string;
  /** Diagnostics label naming the broken surface, e.g. "file-type:dbml:editor"
   * or "code-renderer:mermaid". Falls back to `panelId` when absent. */
  surface?: string;
}

interface PanelErrorBoundaryState {
  error: Error | null;
}

export class PanelErrorBoundary extends React.Component<
  PanelErrorBoundaryProps,
  PanelErrorBoundaryState
> {
  state: PanelErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const label = this.props.surface ?? this.props.panelId ?? '<unknown>';
    // ponytail: not wired to a remote logger; console is enough for MVP.
    console.error(`[plugin-host] surface "${label}" render failed:`, error, info.componentStack);
    if (this.props.pluginId) {
      // One-way imperative call (class component can't use the hook). The store
      // caps the per-plugin list so a render-error loop can't grow unbounded.
      usePluginStore.getState().recordRenderError(this.props.pluginId, {
        message: error.message,
        label,
      });
    }
  }

  render(): React.ReactNode {
    if (this.state.error) {
      const label = this.props.surface ?? this.props.panelId;
      return (
        <div
          className="panel-error-fallback"
          style={{ padding: 16, fontSize: 13, color: 'var(--t2, #3f3f46)' }}
        >
          {i18n.t('sidebar:panelError.failed')}
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--t3, #71717a)' }}>
            {label ? `[${label}] ` : ''}
            {this.state.error.message}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
