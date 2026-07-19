/**
 * Error boundary wrapping each sidebar panel component so a throwing plugin
 * panel doesn't white-screen the whole sidebar (Decision Q3, PRD acceptance).
 *
 * Minimal: on render error, render a small "面板加载失败" message with the
 * error text. The rest of the sidebar (other panels, the activity bar, the
 * file tree) is unaffected because the boundary isolates only the active
 * panel's component subtree.
 */

import React from 'react';
import i18n from '@/i18n';

interface PanelErrorBoundaryProps {
  children: React.ReactNode;
  /** Panel id, for diagnostics in the fallback message. */
  panelId?: string;
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
    // ponytail: not wired to a remote logger; console is enough for MVP.
    console.error(`[sidebar] panel "${this.props.panelId ?? '<unknown>'}" render failed:`, error, info.componentStack);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div
          className="panel-error-fallback"
          style={{ padding: 16, fontSize: 13, color: 'var(--t2, #3f3f46)' }}
        >
          {i18n.t('sidebar:panelError.failed')}
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--t3, #71717a)' }}>
            {this.props.panelId ? `[${this.props.panelId}] ` : ''}
            {this.state.error.message}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
