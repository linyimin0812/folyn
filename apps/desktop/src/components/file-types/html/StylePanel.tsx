import { useState, useEffect, useCallback, useRef } from 'react';

interface StylePanelProps {
  quillId: string;
  tagName: string;
  onClose: () => void;
  callBridge: (fn: string, ...args: unknown[]) => unknown;
}

interface StyleState {
  fontSize: string;
  fontWeight: string;
  color: string;
  marginTop: string;
  marginBottom: string;
  marginLeft: string;
  marginRight: string;
  paddingTop: string;
  paddingBottom: string;
  paddingLeft: string;
  paddingRight: string;
  backgroundColor: string;
  display: string;
  textAlign: string;
  borderRadius: string;
  opacity: string;
}

const DEFAULT_STYLE: StyleState = {
  fontSize: '16px',
  fontWeight: 'normal',
  color: '#000000',
  marginTop: '0px',
  marginBottom: '0px',
  marginLeft: '0px',
  marginRight: '0px',
  paddingTop: '0px',
  paddingBottom: '0px',
  paddingLeft: '0px',
  paddingRight: '0px',
  backgroundColor: 'rgba(0, 0, 0, 0)',
  display: 'block',
  textAlign: 'left',
  borderRadius: '0px',
  opacity: '1',
};

const FONT_SIZE_OPTIONS = ['10px', '11px', '12px', '13px', '14px', '16px', '18px', '20px', '24px', '28px', '32px', '36px', '48px'];
const FONT_WEIGHT_OPTIONS = [
  { label: 'Normal', value: 'normal' },
  { label: 'Medium', value: '500' },
  { label: 'Semi-Bold', value: '600' },
  { label: 'Bold', value: 'bold' },
];
const DISPLAY_OPTIONS = ['block', 'inline', 'inline-block', 'flex', 'grid', 'none'];
const TEXT_ALIGN_OPTIONS = ['left', 'center', 'right', 'justify'];

/**
 * Convert CSS color string to hex for color inputs.
 * Handles rgb(), rgba() (comma or space separated), hex, and falls back
 * to a temporary canvas context for named colors (red, inherit, etc.).
 */
function cssColorToHex(cssColor: string): string {
  if (!cssColor || cssColor === 'transparent' || cssColor === 'rgba(0, 0, 0, 0)') return '#000000';
  if (cssColor.startsWith('#')) return cssColor.slice(0, 7);
  // Parse rgb/rgba — comma-separated: rgb(255, 0, 0) or rgba(255, 0, 0, 1)
  // Also space-separated (modern CSS): rgb(255 0 0) or rgb(255 0 0 / 1)
  const match = cssColor.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (match) {
    const r = parseInt(match[1]).toString(16).padStart(2, '0');
    const g = parseInt(match[2]).toString(16).padStart(2, '0');
    const b = parseInt(match[3]).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  // Fallback: use OffscreenCanvas / canvas context to resolve named colors
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = cssColor;
      const resolved = ctx.fillStyle;
      // ctx.fillStyle normalizes to hex (#rrggbb) or rgb()
      if (resolved.startsWith('#')) return resolved.slice(0, 7);
      const m2 = resolved.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
      if (m2) {
        const r = parseInt(m2[1]).toString(16).padStart(2, '0');
        const g = parseInt(m2[2]).toString(16).padStart(2, '0');
        const b = parseInt(m2[3]).toString(16).padStart(2, '0');
        return `#${r}${g}${b}`;
      }
    }
  } catch {
    // Ignore — return default
  }
  return '#000000';
}

/** Strip 'px' suffix and return numeric string for spacing inputs */
function stripPx(val: string): string {
  if (!val || val === '0px') return '0';
  return val.replace('px', '');
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wider text-t3 font-semibold mt-3 mb-1.5 first:mt-0">
      {children}
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { label: string; value: string }[] | string[];
  onChange: (val: string) => void;
}) {
  const normalizedOptions = typeof options[0] === 'string'
    ? (options as string[]).map((v) => ({ label: v, value: v }))
    : (options as { label: string; value: string }[]);

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-t3 shrink-0 w-16 truncate">{label}</span>
      <select
        className="bg-surf border border-brd rounded px-2 py-1 text-t1 flex-1 min-w-0 text-[11px] focus:outline-none focus:border-acc transition-colors appearance-none cursor-pointer"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {normalizedOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function PxInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-t3 shrink-0 w-16 truncate">{label}</span>
      <div className="flex-1 flex items-center gap-1">
        <input
          className="bg-surf border border-brd rounded px-2 py-1 text-t1 flex-1 min-w-0 text-[11px] focus:outline-none focus:border-acc transition-colors"
          type="number"
          value={stripPx(value)}
          onChange={(e) => onChange(e.target.value + 'px')}
        />
        <span className="text-[10px] text-t3 shrink-0">px</span>
      </div>
    </div>
  );
}

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-t3 shrink-0 w-16 truncate">{label}</span>
      <div className="flex-1 flex items-center gap-2">
        <input
          type="color"
          className="w-6 h-6 rounded border border-brd cursor-pointer bg-transparent p-0"
          value={cssColorToHex(value)}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="text-[10px] text-t3 font-mono truncate">{value}</span>
      </div>
    </div>
  );
}

export function StylePanel({ quillId, tagName, onClose, callBridge }: StylePanelProps) {
  const [styles, setStyles] = useState<StyleState>(DEFAULT_STYLE);
  const panelRef = useRef<HTMLDivElement>(null);

  // Fetch computed styles from bridge
  useEffect(() => {
    const result = callBridge('getStyle', quillId) as Partial<StyleState> | null | undefined;
    if (!result) return;
    setStyles((prev) => ({ ...prev, ...result }));
  }, [quillId, callBridge]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const updateStyle = useCallback(
    (prop: keyof StyleState, val: string) => {
      setStyles((prev) => ({ ...prev, [prop]: val }));
      callBridge('setStyle', quillId, prop, val);
    },
    [quillId, callBridge],
  );

  return (
    <div
      ref={panelRef}
      className="fixed right-0 top-0 bottom-0 w-72 bg-panel border-l border-brd z-50 shadow-xl flex flex-col"
      data-quill-panel
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-brd shrink-0">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M2 12.5l3-1L13.5 3a1.4 1.4 0 00-2-2L3 9.5l-1 3z" />
            <path d="M10 4.5l2 2" />
          </svg>
          <span className="text-xs font-semibold text-t1">Styles</span>
          <span className="text-[10px] font-mono text-t3 bg-surf px-1.5 py-0.5 rounded">&lt;{tagName}&gt;</span>
        </div>
        <button
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-hov text-t3 hover:text-t1 transition-colors"
          onClick={onClose}
          title="Close"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* Style groups */}
      <div className="overflow-y-auto flex-1 p-3 space-y-1">
        {/* Typography */}
        <GroupLabel>Typography</GroupLabel>
        <SelectField
          label="Font Size"
          value={styles.fontSize}
          options={FONT_SIZE_OPTIONS}
          onChange={(v) => updateStyle('fontSize', v)}
        />
        <SelectField
          label="Weight"
          value={styles.fontWeight}
          options={FONT_WEIGHT_OPTIONS}
          onChange={(v) => updateStyle('fontWeight', v)}
        />
        <ColorInput label="Color" value={styles.color} onChange={(v) => updateStyle('color', v)} />

        {/* Spacing - Margin */}
        <GroupLabel>Margin</GroupLabel>
        <div className="grid grid-cols-2 gap-1.5">
          <PxInput label="Top" value={styles.marginTop} onChange={(v) => updateStyle('marginTop', v)} />
          <PxInput label="Bottom" value={styles.marginBottom} onChange={(v) => updateStyle('marginBottom', v)} />
          <PxInput label="Left" value={styles.marginLeft} onChange={(v) => updateStyle('marginLeft', v)} />
          <PxInput label="Right" value={styles.marginRight} onChange={(v) => updateStyle('marginRight', v)} />
        </div>

        {/* Spacing - Padding */}
        <GroupLabel>Padding</GroupLabel>
        <div className="grid grid-cols-2 gap-1.5">
          <PxInput label="Top" value={styles.paddingTop} onChange={(v) => updateStyle('paddingTop', v)} />
          <PxInput label="Bottom" value={styles.paddingBottom} onChange={(v) => updateStyle('paddingBottom', v)} />
          <PxInput label="Left" value={styles.paddingLeft} onChange={(v) => updateStyle('paddingLeft', v)} />
          <PxInput label="Right" value={styles.paddingRight} onChange={(v) => updateStyle('paddingRight', v)} />
        </div>

        {/* Background */}
        <GroupLabel>Background</GroupLabel>
        <ColorInput
          label="BG Color"
          value={styles.backgroundColor}
          onChange={(v) => updateStyle('backgroundColor', v)}
        />

        {/* Layout */}
        <GroupLabel>Layout</GroupLabel>
        <SelectField
          label="Display"
          value={styles.display}
          options={DISPLAY_OPTIONS}
          onChange={(v) => updateStyle('display', v)}
        />
        <SelectField
          label="Text Align"
          value={styles.textAlign}
          options={TEXT_ALIGN_OPTIONS}
          onChange={(v) => updateStyle('textAlign', v)}
        />

        {/* Appearance */}
        <GroupLabel>Appearance</GroupLabel>
        <PxInput
          label="Radius"
          value={styles.borderRadius}
          onChange={(v) => updateStyle('borderRadius', v)}
        />
        <div className="flex items-center gap-2 text-xs">
          <span className="text-t3 shrink-0 w-16 truncate">Opacity</span>
          <div className="flex-1 flex items-center gap-2">
            <input
              type="range"
              className="flex-1 accent-[var(--acc)] h-1"
              min="0"
              max="1"
              step="0.05"
              value={styles.opacity}
              onChange={(e) => updateStyle('opacity', e.target.value)}
            />
            <span className="text-[10px] text-t3 w-7 text-right shrink-0">
              {Math.round(parseFloat(styles.opacity) * 100)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
