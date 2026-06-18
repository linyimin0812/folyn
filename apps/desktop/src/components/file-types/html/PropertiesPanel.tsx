import { useState, useEffect, useCallback, useRef } from 'react';

interface PropertiesPanelProps {
  quillId: string;
  tagName: string;
  callBridge: (fn: string, ...args: unknown[]) => unknown;
}

interface StyleData {
  color: string;
  backgroundColor: string;
  fontSize: string;
  fontWeight: string;
  marginTop: string;
  marginBottom: string;
  marginLeft: string;
  marginRight: string;
  paddingTop: string;
  paddingBottom: string;
  paddingLeft: string;
  paddingRight: string;
  borderRadius: string;
  textAlign: string;
  lineHeight: string;
  opacity: string;
}

interface PositionData {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FONT_WEIGHT_OPTIONS = [
  { label: 'Normal', value: 'normal' },
  { label: '100', value: '100' },
  { label: '200', value: '200' },
  { label: '300', value: '300' },
  { label: '400', value: '400' },
  { label: '500', value: '500' },
  { label: '600', value: '600' },
  { label: '700', value: '700' },
  { label: '800', value: '800' },
  { label: '900', value: '900' },
  { label: 'Bold', value: 'bold' },
];

/**
 * Convert CSS color string to hex for color inputs.
 * Handles rgb(), rgba(), hex, and falls back to canvas context for named colors.
 */
function cssColorToHex(cssColor: string): string {
  if (!cssColor || cssColor === 'transparent' || cssColor === 'rgba(0, 0, 0, 0)') return '#000000';
  if (cssColor.startsWith('#')) return cssColor.slice(0, 7);
  const match = cssColor.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (match) {
    const r = parseInt(match[1]).toString(16).padStart(2, '0');
    const g = parseInt(match[2]).toString(16).padStart(2, '0');
    const b = parseInt(match[3]).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = cssColor;
      const resolved = ctx.fillStyle;
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

function NumberInput({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-t3 shrink-0 w-12 truncate">{label}</span>
      <div className="flex-1 flex items-center gap-1">
        <input
          className="bg-surf border border-brd rounded px-2 py-1 text-t1 flex-1 min-w-0 text-[11px] focus:outline-none focus:border-acc transition-colors"
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {suffix && <span className="text-[10px] text-t3 shrink-0">{suffix}</span>}
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
      <span className="text-t3 shrink-0 w-12 truncate">{label}</span>
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

export function PropertiesPanel({ quillId, tagName, callBridge }: PropertiesPanelProps) {
  const [color, setColor] = useState('#000000');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [fontSize, setFontSize] = useState('16');
  const [fontWeight, setFontWeight] = useState('normal');
  const [posX, setPosX] = useState(0);
  const [posY, setPosY] = useState(0);
  const [sizeW, setSizeW] = useState(100);
  const [sizeH, setSizeH] = useState(50);

  // Refs for cross-dependent values — avoids stale closures when X/Y or W/H
  // handlers read the "other" coordinate in the same render cycle.
  const latestPosX = useRef(0);
  const latestPosY = useRef(0);
  const latestSizeW = useRef(100);
  const latestSizeH = useRef(50);
  const [padTop, setPadTop] = useState('0');
  const [padBottom, setPadBottom] = useState('0');
  const [padLeft, setPadLeft] = useState('0');
  const [padRight, setPadRight] = useState('0');
  const [marTop, setMarTop] = useState('0');
  const [marBottom, setMarBottom] = useState('0');
  const [marLeft, setMarLeft] = useState('0');
  const [marRight, setMarRight] = useState('0');
  const [borderRadius, setBorderRadius] = useState('0');

  // Fetch styles and position from bridge on mount / element change
  useEffect(() => {
    const styleResult = callBridge('getStyle', quillId) as Partial<StyleData> | null | undefined;
    if (styleResult) {
      if (styleResult.color) setColor(cssColorToHex(styleResult.color));
      if (styleResult.backgroundColor) setBgColor(cssColorToHex(styleResult.backgroundColor));
      if (styleResult.fontSize) setFontSize(stripPx(styleResult.fontSize));
      if (styleResult.fontWeight) setFontWeight(styleResult.fontWeight);
      if (styleResult.paddingTop) setPadTop(stripPx(styleResult.paddingTop));
      if (styleResult.paddingBottom) setPadBottom(stripPx(styleResult.paddingBottom));
      if (styleResult.paddingLeft) setPadLeft(stripPx(styleResult.paddingLeft));
      if (styleResult.paddingRight) setPadRight(stripPx(styleResult.paddingRight));
      if (styleResult.marginTop) setMarTop(stripPx(styleResult.marginTop));
      if (styleResult.marginBottom) setMarBottom(stripPx(styleResult.marginBottom));
      if (styleResult.marginLeft) setMarLeft(stripPx(styleResult.marginLeft));
      if (styleResult.marginRight) setMarRight(stripPx(styleResult.marginRight));
      if (styleResult.borderRadius) setBorderRadius(stripPx(styleResult.borderRadius));
    }

    const posResult = callBridge('getPosition', quillId) as PositionData | null | undefined;
    if (posResult) {
      const rx = Math.round(posResult.x);
      const ry = Math.round(posResult.y);
      const rw = Math.round(posResult.w);
      const rh = Math.round(posResult.h);
      setPosX(rx);
      setPosY(ry);
      setSizeW(rw);
      setSizeH(rh);
      latestPosX.current = rx;
      latestPosY.current = ry;
      latestSizeW.current = rw;
      latestSizeH.current = rh;
    }
  }, [quillId, callBridge]);

  const updateStyle = useCallback(
    (prop: string, val: string) => {
      callBridge('setStyle', quillId, prop, val);
    },
    [quillId, callBridge],
  );

  return (
    <div className="fixed right-0 top-0 bottom-0 w-64 bg-panel border-l border-brd z-50 shadow-xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-brd shrink-0">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <circle cx="8" cy="8" r="2.5" />
            <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
          </svg>
          <span className="text-xs font-semibold text-t1">Properties</span>
          <span className="text-[10px] font-mono text-t3 bg-surf px-1.5 py-0.5 rounded">&lt;{tagName}&gt;</span>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="overflow-y-auto flex-1 p-3 space-y-1">
        {/* Style */}
        <GroupLabel>Style</GroupLabel>
        <ColorInput
          label="Color"
          value={color}
          onChange={(v) => {
            setColor(v);
            updateStyle('color', v);
          }}
        />
        <ColorInput
          label="BG"
          value={bgColor}
          onChange={(v) => {
            setBgColor(v);
            updateStyle('backgroundColor', v);
          }}
        />
        <NumberInput
          label="Size"
          value={fontSize}
          suffix="px"
          onChange={(v) => {
            setFontSize(v);
            updateStyle('fontSize', v + 'px');
          }}
        />
        <div className="flex items-center gap-2 text-xs">
          <span className="text-t3 shrink-0 w-12 truncate">Weight</span>
          <select
            className="bg-surf border border-brd rounded px-2 py-1 text-t1 flex-1 min-w-0 text-[11px] focus:outline-none focus:border-acc transition-colors appearance-none cursor-pointer"
            value={fontWeight}
            onChange={(e) => {
              setFontWeight(e.target.value);
              updateStyle('fontWeight', e.target.value);
            }}
          >
            {FONT_WEIGHT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Position */}
        <GroupLabel>Position</GroupLabel>
        <NumberInput
          label="X"
          value={String(posX)}
          onChange={(v) => {
            const n = parseFloat(v) || 0;
            setPosX(n);
            latestPosX.current = n;
            callBridge('setPosition', quillId, n, latestPosY.current);
          }}
        />
        <NumberInput
          label="Y"
          value={String(posY)}
          onChange={(v) => {
            const n = parseFloat(v) || 0;
            setPosY(n);
            latestPosY.current = n;
            callBridge('setPosition', quillId, latestPosX.current, n);
          }}
        />

        {/* Size */}
        <GroupLabel>Size</GroupLabel>
        <NumberInput
          label="W"
          value={String(sizeW)}
          onChange={(v) => {
            const n = Math.max(20, parseFloat(v) || 20);
            setSizeW(n);
            latestSizeW.current = n;
            callBridge('setSize', quillId, n, latestSizeH.current);
          }}
        />
        <NumberInput
          label="H"
          value={String(sizeH)}
          onChange={(v) => {
            const n = Math.max(20, parseFloat(v) || 20);
            setSizeH(n);
            latestSizeH.current = n;
            callBridge('setSize', quillId, latestSizeW.current, n);
          }}
        />

        {/* Padding */}
        <GroupLabel>Padding</GroupLabel>
        <NumberInput
          label="Top"
          value={padTop}
          suffix="px"
          onChange={(v) => {
            setPadTop(v);
            callBridge('setPadding', quillId, 'top', v + 'px');
          }}
        />
        <NumberInput
          label="Bottom"
          value={padBottom}
          suffix="px"
          onChange={(v) => {
            setPadBottom(v);
            callBridge('setPadding', quillId, 'bottom', v + 'px');
          }}
        />
        <NumberInput
          label="Left"
          value={padLeft}
          suffix="px"
          onChange={(v) => {
            setPadLeft(v);
            callBridge('setPadding', quillId, 'left', v + 'px');
          }}
        />
        <NumberInput
          label="Right"
          value={padRight}
          suffix="px"
          onChange={(v) => {
            setPadRight(v);
            callBridge('setPadding', quillId, 'right', v + 'px');
          }}
        />

        {/* Margin */}
        <GroupLabel>Margin</GroupLabel>
        <NumberInput
          label="Top"
          value={marTop}
          suffix="px"
          onChange={(v) => {
            setMarTop(v);
            updateStyle('marginTop', v + 'px');
          }}
        />
        <NumberInput
          label="Bottom"
          value={marBottom}
          suffix="px"
          onChange={(v) => {
            setMarBottom(v);
            updateStyle('marginBottom', v + 'px');
          }}
        />
        <NumberInput
          label="Left"
          value={marLeft}
          suffix="px"
          onChange={(v) => {
            setMarLeft(v);
            updateStyle('marginLeft', v + 'px');
          }}
        />
        <NumberInput
          label="Right"
          value={marRight}
          suffix="px"
          onChange={(v) => {
            setMarRight(v);
            updateStyle('marginRight', v + 'px');
          }}
        />

        {/* Appearance */}
        <GroupLabel>Appearance</GroupLabel>
        <NumberInput
          label="Radius"
          value={borderRadius}
          suffix="px"
          onChange={(v) => {
            setBorderRadius(v);
            updateStyle('borderRadius', v + 'px');
          }}
        />
      </div>
    </div>
  );
}
