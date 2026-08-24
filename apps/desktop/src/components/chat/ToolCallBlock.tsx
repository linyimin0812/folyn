import { useState, Component, type ReactNode } from 'react';
import type { ToolCallInfo } from '@mochi/cli-adapter';

class ToolCallErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return <pre className="font-mono text-[10px] leading-normal bg-surf2 border border-brd rounded py-1.5 px-2 overflow-x-auto whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto text-t2">[渲染出错]</pre>;
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
    <div className="rounded border border-brd bg-surf overflow-hidden">
      <div className="flex items-center gap-1.5 py-[5px] px-2 cursor-pointer text-[11px] transition-[background] duration-100 hover:bg-hov" onClick={() => setExpanded(!expanded)}>
        <span className="flex items-center justify-center w-4 h-4 shrink-0">
          {tc.status === 'running' ? (
            <span className="tc-spinner" />
          ) : (
            <svg className="text-green" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </span>
        <span className="font-semibold text-t1 whitespace-nowrap">{tc.name}</span>
        {summary && <span className="text-t3 font-mono overflow-hidden text-ellipsis whitespace-nowrap min-w-0 flex-1">{summary}</span>}
        <span className={`ml-auto shrink-0 text-t3 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </div>
      {expanded && (
        <ToolCallErrorBoundary>
          <div className="px-2 pb-2">
            {tc.input && (
              <div className="mt-1.5">
                <div className="text-[9px] font-semibold text-t3 uppercase mb-[3px]">Input</div>
                <pre className="font-mono text-[10px] leading-normal bg-surf2 border border-brd rounded py-1.5 px-2 overflow-x-auto whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto text-t2">{(() => {
                  try {
                    return safeText(JSON.stringify(tc.input, null, 2), 10000);
                  } catch { return '[无法显示]'; }
                })()}</pre>
              </div>
            )}
            {tc.output && (
              <div className="mt-1.5">
                <div className="text-[9px] font-semibold text-t3 uppercase mb-[3px]">Output</div>
                <pre className="font-mono text-[10px] leading-normal bg-surf2 border border-brd rounded py-1.5 px-2 overflow-x-auto whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto text-t2">{safeText(tc.output, 10000)}</pre>
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
    <div className="flex flex-col gap-0.5 mb-1.5">
      {toolCalls.map((tc) => (
        <ToolCallItem key={tc.id} tc={tc} />
      ))}
    </div>
  );
}
