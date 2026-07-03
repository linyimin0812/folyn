/**
 * PreviewToolbar — top toolbar for the JSON file viewer preview.
 *
 * Layout (left → right):
 *   [Input | Query | Convert | Diff] tabs
 *   | Input-mode dropdown (Auto / JSON5 / Escaped / Base64 / YAML / XML / CSV)
 *   | [Expand all] [Collapse all]   (active on Input tab only)
 *   | [Auto-sort toggle] [Auto-copy toggle]
 *
 * PR4-6: pass `enableAllTabs` to enable the Query/Convert/Diff tabs (they
 * start disabled in PR3 and are flipped on once their panes ship).
 */
import type { InputMode } from '../lib/parseInput';

export type PreviewTab = 'input' | 'query' | 'convert' | 'diff';

export interface PreviewToolbarProps {
  activeTab: PreviewTab;
  inputMode: InputMode;
  autoSort: boolean;
  autoCopy: boolean;
  enableAllTabs?: boolean;
  onTabChange: (tab: PreviewTab) => void;
  onInputModeChange: (mode: InputMode) => void;
  onToggleAutoSort: () => void;
  onToggleAutoCopy: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

const MODE_OPTIONS: Array<{ value: InputMode; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'json5', label: 'JSON5' },
  { value: 'escaped', label: 'Escaped' },
  { value: 'base64', label: 'Base64' },
  { value: 'yaml', label: 'YAML' },
  { value: 'xml', label: 'XML' },
  { value: 'csv', label: 'CSV' },
];

export function PreviewToolbar({
  activeTab,
  inputMode,
  autoSort,
  autoCopy,
  enableAllTabs = false,
  onTabChange,
  onInputModeChange,
  onToggleAutoSort,
  onToggleAutoCopy,
  onExpandAll,
  onCollapseAll,
}: PreviewToolbarProps) {
  const tabs: Array<{ id: PreviewTab; label: string; disabled: boolean; tooltip?: string }> = [
    { id: 'input', label: 'Input', disabled: false },
    {
      id: 'query',
      label: 'Query',
      disabled: !enableAllTabs,
      tooltip: enableAllTabs ? undefined : 'coming in PR4',
    },
    {
      id: 'convert',
      label: 'Convert',
      disabled: !enableAllTabs,
      tooltip: enableAllTabs ? undefined : 'coming in PR5',
    },
    {
      id: 'diff',
      label: 'Diff',
      disabled: !enableAllTabs,
      tooltip: enableAllTabs ? undefined : 'coming in PR6',
    },
  ];

  return (
    <div className="flex h-[36px] shrink-0 items-center gap-2 border-b border-brd bg-panel px-2">
      {/* Tabs */}
      <div className="flex items-center gap-px">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const base =
            'inline-flex items-center rounded px-2.5 py-1 text-[12px] font-medium transition-colors';
          const cls = tab.disabled
            ? `${base} cursor-not-allowed text-t3 opacity-60`
            : isActive
              ? `${base} bg-accdim text-acc`
              : `${base} text-t2 hover:bg-hov hover:text-t1`;
          return (
            <button
              key={tab.id}
              type="button"
              disabled={tab.disabled}
              title={tab.tooltip}
              onClick={() => !tab.disabled && onTabChange(tab.id)}
              className={cls}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="mx-1 h-4 w-px bg-brd" />

      {/* Input-mode dropdown */}
      <label className="flex items-center gap-1 text-[11px] text-t3">
        <span>格式</span>
        <select
          value={inputMode}
          onChange={(e) => onInputModeChange(e.target.value as InputMode)}
          className="rounded border border-brd bg-surf px-1.5 py-0.5 text-[11px] text-t1 focus:outline-none focus:border-acc"
        >
          {MODE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <div className="mx-1 h-4 w-px bg-brd" />

      {/* Expand / Collapse all (Input tab only) */}
      <button
        type="button"
        disabled={activeTab !== 'input'}
        onClick={onExpandAll}
        className={`rounded px-2 py-0.5 text-[11px] ${activeTab === 'input' ? 'text-t2 hover:bg-hov hover:text-t1' : 'cursor-not-allowed text-t3 opacity-50'}`}
      >
        全部展开
      </button>
      <button
        type="button"
        disabled={activeTab !== 'input'}
        onClick={onCollapseAll}
        className={`rounded px-2 py-0.5 text-[11px] ${activeTab === 'input' ? 'text-t2 hover:bg-hov hover:text-t1' : 'cursor-not-allowed text-t3 opacity-50'}`}
      >
        全部收起
      </button>

      <div className="mx-1 h-4 w-px bg-brd" />

      {/* Auto-sort toggle */}
      <ToggleChip
        label="自动排序"
        active={autoSort}
        onClick={onToggleAutoSort}
        title="解析后对键按字母顺序递归排序"
      />
      {/* Auto-copy toggle (PR8: wired to copy parse/query/convert results) */}
      <ToggleChip
        label="自动复制"
        active={autoCopy}
        onClick={onToggleAutoCopy}
        title="格式/排序/查询/转换后自动复制结果到剪贴板"
      />
    </div>
  );
}

function ToggleChip({
  label,
  active,
  onClick,
  title,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  const cls = active
    ? 'bg-accdim text-acc border-acc/40'
    : 'bg-surf text-t3 border-brd hover:bg-hov hover:text-t1';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded border px-2 py-0.5 text-[11px] ${cls}`}
    >
      {label}
    </button>
  );
}
