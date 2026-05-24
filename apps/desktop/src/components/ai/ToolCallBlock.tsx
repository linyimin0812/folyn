import { useState, Component, type ReactNode } from 'react';
import type { ToolCallInfo } from '@quill/cli-adapter';

class ToolCallErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return <pre className="tc-code">[渲染出错]</pre>;
    return this.props.children;
  }
}

function safeText(str: unknown, maxLen: number): string {
  if (!str) return '';
  const s = typeof str === 'string' ? str : JSON.stringify(str);
  const safe = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  return safe.length > maxLen ? safe.slice(0, maxLen) + '\n...(已截断)' : safe;
}

function getToolSummary(tc: ToolCallInfo): string {
  if (!tc.input) return '';
  const path = tc.input.file_path || tc.input.path || tc.input.command || tc.input.query || '';
  if (typeof path === 'string') {
    const short = path.length > 50 ? '...' + path.slice(-47) : path;
    return short;
  }
  return '';
}

function ToolCallItem({ tc }: { tc: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false);
  const summary = getToolSummary(tc);

  return (
    <div className={`tc-item ${tc.status}`}>
      <div className="tc-header" onClick={() => setExpanded(!expanded)}>
        <span className="tc-icon">
          {tc.status === 'running' ? (
            <span className="tc-spinner" />
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </span>
        <span className="tc-name">{tc.name}</span>
        {summary && <span className="tc-summary">{summary}</span>}
        <span className={`tc-chevron ${expanded ? 'open' : ''}`}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </div>
      {expanded && (
        <ToolCallErrorBoundary>
          <div className="tc-details">
            {tc.input && (
              <div className="tc-section">
                <div className="tc-section-label">Input</div>
                <pre className="tc-code">{(() => {
                  try {
                    return safeText(JSON.stringify(tc.input, null, 2), 1000);
                  } catch { return '[无法显示]'; }
                })()}</pre>
              </div>
            )}
            {tc.output && (
              <div className="tc-section">
                <div className="tc-section-label">Output</div>
                <pre className="tc-code">{safeText(tc.output, 500)}</pre>
              </div>
            )}
          </div>
        </ToolCallErrorBoundary>
      )}
    </div>
  );
}

export function ToolCallBlock({ toolCalls }: { toolCalls: ToolCallInfo[] }) {
  if (!toolCalls || toolCalls.length === 0) return null;

  return (
    <div className="tc-block">
      {toolCalls.map((tc) => (
        <ToolCallItem key={tc.id} tc={tc} />
      ))}
    </div>
  );
}
