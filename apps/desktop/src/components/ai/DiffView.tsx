import { useState } from 'react';
import type { FileChange } from '@quill/cli-adapter';

interface DiffViewProps {
  changes: FileChange[];
  onAccept: (path: string) => void;
  onReject: (path: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: DiffLine[] = [];

  const n = oldLines.length;
  const m = newLines.length;

  // Simple LCS-based diff
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const diff: { type: 'add' | 'remove' | 'context'; line: string }[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diff.unshift({ type: 'context', line: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.unshift({ type: 'add', line: newLines[j - 1] });
      j--;
    } else {
      diff.unshift({ type: 'remove', line: oldLines[i - 1] });
      i--;
    }
  }

  let oldLineNo = 1;
  let newLineNo = 1;
  for (const d of diff) {
    if (d.type === 'context') {
      result.push({ type: 'context', content: d.line, oldLineNo: oldLineNo++, newLineNo: newLineNo++ });
    } else if (d.type === 'remove') {
      result.push({ type: 'remove', content: d.line, oldLineNo: oldLineNo++ });
    } else {
      result.push({ type: 'add', content: d.line, newLineNo: newLineNo++ });
    }
  }

  return result;
}

function DiffCard({ change, onAccept, onReject }: {
  change: FileChange;
  onAccept: () => void;
  onReject: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const isPending = change.status === 'pending';
  const lines = computeLineDiff(change.oldContent, change.newContent);

  const addCount = lines.filter((l) => l.type === 'add').length;
  const removeCount = lines.filter((l) => l.type === 'remove').length;

  // Only show changed lines + 3 lines of context around them
  const changedIndices = new Set<number>();
  lines.forEach((line, idx) => {
    if (line.type !== 'context') {
      for (let k = Math.max(0, idx - 3); k <= Math.min(lines.length - 1, idx + 3); k++) {
        changedIndices.add(k);
      }
    }
  });

  const visibleLines: (DiffLine | { type: 'separator' })[] = [];
  let lastIdx = -1;
  for (const idx of [...changedIndices].sort((a, b) => a - b)) {
    if (lastIdx >= 0 && idx - lastIdx > 1) {
      visibleLines.push({ type: 'separator' });
    }
    visibleLines.push(lines[idx]);
    lastIdx = idx;
  }

  return (
    <div className={`diff-card ${change.status}`}>
      <div className="diff-card-header" onClick={() => setCollapsed(!collapsed)}>
        <div className="diff-file-info">
          <span className="diff-file-icon">{collapsed ? '▶' : '▼'}</span>
          <span className="diff-file-name">{change.path}</span>
          <span className="diff-stats">
            {addCount > 0 && <span className="diff-stat-add">+{addCount}</span>}
            {removeCount > 0 && <span className="diff-stat-remove">-{removeCount}</span>}
          </span>
        </div>
        {isPending && (
          <div className="diff-actions">
            <button className="diff-btn diff-btn-reject" onClick={(e) => { e.stopPropagation(); onReject(); }} title="撤销修改">
              Undo
            </button>
            <button className="diff-btn diff-btn-accept" onClick={(e) => { e.stopPropagation(); onAccept(); }} title="保留修改">
              Keep
            </button>
          </div>
        )}
        {change.status === 'accepted' && <span className="diff-status-badge accepted">已接受</span>}
        {change.status === 'rejected' && <span className="diff-status-badge rejected">已拒绝</span>}
      </div>

      {!collapsed && (
        <div className="diff-body">
          {visibleLines.map((line, idx) => {
            if (line.type === 'separator') {
              return <div key={`sep-${idx}`} className="diff-line diff-separator">···</div>;
            }
            const dl = line as DiffLine;
            return (
              <div key={idx} className={`diff-line diff-${dl.type}`}>
                <span className="diff-ln">{dl.type === 'add' ? '' : (dl.oldLineNo ?? '')}</span>
                <span className="diff-ln">{dl.type === 'remove' ? '' : (dl.newLineNo ?? '')}</span>
                <span className="diff-marker">{dl.type === 'add' ? '+' : dl.type === 'remove' ? '-' : ' '}</span>
                <span className="diff-content">{dl.content}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DiffView({ changes, onAccept, onReject, onAcceptAll, onRejectAll }: DiffViewProps) {
  const pendingChanges = changes.filter((c) => c.status === 'pending');

  if (changes.length === 0) return null;

  return (
    <div className="diff-view">
      {pendingChanges.length > 1 && (
        <div className="diff-bulk-actions">
          <button className="diff-btn diff-btn-reject-all" onClick={onRejectAll}>
            Undo All
          </button>
          <button className="diff-btn diff-btn-accept-all" onClick={onAcceptAll}>
            Keep All
          </button>
          <span className="diff-pending-count">{pendingChanges.length} 个文件待审查</span>
        </div>
      )}
      {changes.map((change) => (
        <DiffCard
          key={change.path}
          change={change}
          onAccept={() => onAccept(change.path)}
          onReject={() => onReject(change.path)}
        />
      ))}
    </div>
  );
}
