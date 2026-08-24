import { createContext, useContext, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { InfographicBlock, InfographicDoc } from '@/features/clips/clipParse';
import { useAppearanceStore } from '@/store/appearanceStore';

/**
 * Editorial / newspaper-poster infographic renderer for clips.
 *
 * Replaces the old card-stack layout with a single unified poster modeled on
 * `.dev/infographic-reference.html`: warm oklch palette, strong horizontal
 * rules, 3-column body with vertical dividers, serif display type + mono
 * eyebrows, accent-color emphasis.
 *
 * Layout:
 *   ┌───────────────────────────────────────────────┐
 *   │ === 1.5px solid fg top border ===             │
 *   │ [kicker]  [hero title — serif]  [meta]        │  ← masthead
 *   │ === 1.5px solid fg bottom border ===          │
 *   │ ┌────────┬────────────┬────────┐              │
 *   │ │ col 1  │ col 2 (wide)│ col 3 │              │  ← 3-col body
 *   │ │ eyebrow│ eyebrow     │ eyebrow│              │
 *   │ │ block  │ block       │ block  │              │
 *   │ └────────┴────────────┴────────┘              │
 *   │ === 1.5px solid fg bottom border ===          │
 *   │ [quote / source]  [div]  [tags]               │  ← footer
 *   └───────────────────────────────────────────────┘
 *
 * Block placement:
 *   - hero   → masthead (full width)
 *   - quote  → footer left (stacked above source when both present)
 *   - tags   → footer right
 *   - source → footer left (always; stacked below quote when quote present)
 *   - stat / keypoints / timeline / steps / comparison → 3-col body, chunked
 *
 * Theme adaptation: the poster reads `theme` from `useAppearanceStore` and picks
 * between a light palette (warm off-white) and a dark palette (dark warm bg
 * with light foreground). The palette is distributed to all sub-components via
 * `PaletteContext` so direct `<BlockView>` renders (e.g. in unit tests) get a
 * sensible default (light) without needing to wrap in a provider.
 */

// --- Editorial design tokens (mirror .dev/infographic-reference.html) ------
const FONT_DISPLAY = "'Iwan Old Style', 'Charter', 'Songti SC', Georgia, serif";
const FONT_BODY =
  "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', system-ui, sans-serif";
const FONT_MONO = "ui-monospace, 'JetBrains Mono', 'IBM Plex Mono', Menlo, monospace";

export interface InfographicPalette {
  bg: string;
  surface: string;
  fg: string;
  muted: string;
  border: string;
  accent: string;
}

/** Light palette — warm off-white editorial (default). */
const C_LIGHT: InfographicPalette = {
  bg: 'oklch(98% 0.004 95)',
  surface: 'oklch(100% 0.002 95)',
  fg: 'oklch(20% 0.018 70)',
  muted: 'oklch(48% 0.012 70)',
  border: 'oklch(86% 0.006 95)',
  accent: 'oklch(52% 0.10 28)',
} as const;

/** Dark palette — mirrored warmth, inverted fg/bg for dark app theme. */
const C_DARK: InfographicPalette = {
  bg: 'oklch(20% 0.018 70)',
  surface: 'oklch(24% 0.018 70)',
  fg: 'oklch(95% 0.004 95)',
  muted: 'oklch(65% 0.012 70)',
  border: 'oklch(35% 0.012 70)',
  accent: 'oklch(72% 0.10 28)',
} as const;

/**
 * React context distributing the active palette. Defaults to the light palette
 * so block renderers work standalone (e.g. `<BlockView>` in unit tests) without
 * needing to wrap in an `<InfographicView>` provider.
 */
const PaletteContext = createContext<InfographicPalette>(C_LIGHT);

function usePalette(): InfographicPalette {
  return useContext(PaletteContext);
}

// --- Block type → eyebrow label ---------------------------------------------
const EYEBROW_LABELS: Record<string, string> = {
  stat: '数据 · NUMBERS',
  keypoints: '关键要点 · KEY POINTS',
  timeline: '时间线 · TIMELINE',
  steps: '步骤 · STEPS',
  comparison: '对比 · COMPARISON',
  quote: '引言 · QUOTE',
  tags: '标签 · TAGS',
  source: '来源 · SOURCE',
};

export interface InfographicViewProps {
  doc: InfographicDoc;
}

/**
 * Reads the current theme from `useAppearanceStore`.
 *
 * Implemented via `useSyncExternalStore` directly (rather than
 * `useAppearanceStore((s) => s.theme)`) so the SSR server snapshot reads CURRENT
 * state. Zustand v5's default `useStore` uses `api.getInitialState()` as the
 * server snapshot, which means `useAppearanceStore((s) => s.theme)` always
 * returns the initial `'light'` theme during `renderToString` — ignoring any
 * `setState({ theme: 'dark' })` the test set up. Passing `getState().theme` as
 * the third arg (`getServerSnapshot`) makes the hook SSR-correct while still
 * subscribing to (and re-rendering on) theme changes in the browser.
 */
function useThemeState(): string {
  return useSyncExternalStore(
    useAppearanceStore.subscribe,
    () => useAppearanceStore.getState().theme,
    () => useAppearanceStore.getState().theme,
  );
}

export function InfographicView({ doc }: InfographicViewProps) {
  const theme = useThemeState();
  const C = theme === 'dark' ? C_DARK : C_LIGHT;

  // Pick special-slot blocks (first occurrence wins; duplicates stay in body).
  const hero = doc.blocks.find((b) => b.type === 'hero');
  const quote = doc.blocks.find((b) => b.type === 'quote');
  const tags = doc.blocks.find((b) => b.type === 'tags');
  const source = doc.blocks.find((b) => b.type === 'source');
  const bodyBlocks = doc.blocks.filter(
    (b) => b !== hero && b !== quote && b !== tags && b !== source,
  );

  // Chunk body blocks into 3 columns (column-major order: read down then
  // across). Round-robin would interleave; chunking keeps related blocks
  // together which reads more like a real editorial column.
  const perCol = Math.ceil(Math.max(bodyBlocks.length, 1) / 3);
  const col1 = bodyBlocks.slice(0, perCol);
  const col2 = bodyBlocks.slice(perCol, perCol * 2);
  const col3 = bodyBlocks.slice(perCol * 2);

  return (
    <PaletteContext.Provider value={C}>
      <div
        className="poster-container w-full flex flex-col"
        style={{
          background: C.bg,
          color: C.fg,
          fontFamily: FONT_BODY,
          borderRadius: 4,
          overflow: 'hidden',
        }}
      >
        {hero ? <Masthead block={hero} /> : null}
        {/* Body has no top/bottom border — the masthead's bottom border and
            the footer's top border frame the body (matching the reference HTML,
            which uses exactly two strong horizontal rules, not four). When the
            masthead is absent, the body renders its own top border so the frame
            is preserved. */}
        <div
          className="poster-body grid grid-cols-1 md:grid-cols-[1.05fr_1.4fr_1fr]"
          style={hero ? undefined : { borderTop: `1.5px solid ${C.fg}` }}
        >
          <Column blocks={col1} />
          <Column blocks={col2} />
          <Column blocks={col3} last />
        </div>
        <Footer quote={quote} tags={tags} source={source} />
      </div>
    </PaletteContext.Provider>
  );
}

// --- Layout primitives ------------------------------------------------------

function Masthead({ block }: { block: Extract<InfographicBlock, { type: 'hero' }> }) {
  const C = usePalette();
  return (
    <header
      className="poster-masthead grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-4 px-8 py-6"
      style={{ borderBottom: `1.5px solid ${C.fg}` }}
    >
      <div
        className="poster-kicker text-left"
        style={{
          fontFamily: FONT_MONO,
          fontSize: 11,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: C.muted,
        }}
      >
        <span style={{ color: C.accent }}>●</span>
        &nbsp;INFOGRAPHIC · 网络知识卡片
      </div>
      <div className="poster-title-wrap text-center min-w-0">
        <h1
          className="poster-title poster-serif-title m-0 break-words"
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 48,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
          }}
        >
          {block.title}
        </h1>
        {block.subtitle ? (
          <p
            className="poster-subtitle m-0 mt-2 break-words"
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 17,
              color: C.muted,
              fontStyle: 'italic',
            }}
          >
            {block.subtitle}
          </p>
        ) : null}
      </div>
      <div
        className="poster-meta text-right"
        style={{
          fontFamily: FONT_MONO,
          fontSize: 11,
          lineHeight: 1.5,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: C.muted,
        }}
      >
        <strong style={{ color: C.fg, fontWeight: 600 }}>MOCHI</strong>
        &nbsp;·&nbsp;CLIP
      </div>
    </header>
  );
}

function Column({ blocks, last }: { blocks: InfographicBlock[]; last?: boolean }) {
  const C = usePalette();
  return (
    <div
      className={`poster-col flex flex-col gap-7 px-7 py-8${last ? '' : ' md:border-r'}`}
      style={{ borderRightColor: C.border }}
    >
      {blocks.length === 0 ? (
        <div style={{ minHeight: 8 }} />
      ) : (
        blocks.map((b, i) => <BlockView key={i} block={b} index={i + 1} />)
      )}
    </div>
  );
}

function Footer({
  quote,
  tags,
  source,
}: {
  quote?: InfographicBlock;
  tags?: InfographicBlock;
  source?: InfographicBlock;
}) {
  const C = usePalette();
  // Left slot stacks quote (editorial pull) above source (citation) when both
  // are present — neither is dropped, so the source URL is always preserved.
  // Right slot holds tags.
  return (
    <footer
      className="poster-footer grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-4 px-8 py-5"
      style={{ borderTop: `1.5px solid ${C.fg}` }}
    >
      <div className="poster-footer-left min-w-0 flex flex-col gap-3">
        {quote ? <BlockView block={quote} /> : null}
        {source ? <BlockView block={source} /> : null}
      </div>
      <div
        className="poster-footer-div hidden md:block"
        style={{ width: 1, height: 56, background: C.border }}
      />
      <div className="poster-footer-right text-center min-w-0">
        {tags ? <BlockView block={tags} /> : null}
      </div>
    </footer>
  );
}

// --- Block dispatch ---------------------------------------------------------

interface BlockViewProps {
  block: InfographicBlock;
  /** 1-based position within the parent column (used for eyebrow numbering). */
  index?: number;
}

/**
 * Dispatch a block to its typed renderer. Unknown types hit the fallback
 * (muted plain-text `JSON.stringify`) and emit a `console.warn` so enum drift
 * is observable in dev without crashing the card.
 *
 * Exported for unit testing.
 */
export function BlockView({ block, index = 1 }: BlockViewProps) {
  switch (block.type) {
    case 'hero':
      return <Masthead block={block} />;
    case 'stat':
      return <StatBlock block={block} />;
    case 'keypoints':
      return <KeyPointsBlock block={block} index={index} />;
    case 'timeline':
      return <TimelineBlock block={block} index={index} />;
    case 'steps':
      return <StepsBlock block={block} index={index} />;
    case 'comparison':
      return <ComparisonBlock block={block} index={index} />;
    case 'quote':
      return <QuoteBlock block={block} />;
    case 'tags':
      return <TagsBlock block={block} />;
    case 'source':
      return <SourceBlock block={block} />;
    default:
      return <UnknownBlock block={block} />;
  }
}

// --- Shared editorial atoms -------------------------------------------------

function Eyebrow({ label, num }: { label: string; num: number }) {
  const C = usePalette();
  return (
    <div
      className="poster-eyebrow"
      style={{
        fontFamily: FONT_MONO,
        fontSize: 11,
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        color: C.accent,
        marginBottom: 14,
      }}
    >
      {String(num).padStart(2, '0')} · {label}
    </div>
  );
}

function MonoLabel({ children }: { children: ReactNode }) {
  const C = usePalette();
  return (
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: 11,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: C.fg,
        fontWeight: 600,
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

// --- Per-block renderers ----------------------------------------------------

function StatBlock({ block }: { block: Extract<InfographicBlock, { type: 'stat' }> }) {
  const C = usePalette();
  const items = block.items.slice(0, 4);
  return (
    <div className="poster-stat">
      <Eyebrow label={EYEBROW_LABELS['stat']!} num={1} />
      <div className="flex flex-col">
        {items.map((item, i) => (
          <div
            key={i}
            className="flex items-baseline gap-3 py-2.5"
            style={i < items.length - 1 ? { borderBottom: `1px solid ${C.border}` } : undefined}
          >
            <span
              className="break-words"
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 700,
                fontSize: 32,
                color: C.accent,
                letterSpacing: '-0.02em',
                lineHeight: 1,
              }}
            >
              {item.value}
              {item.unit ? (
                <span style={{ fontSize: 16, marginLeft: 2 }}>{item.unit}</span>
              ) : null}
            </span>
            <span className="break-words" style={{ fontSize: 13, color: C.muted }}>
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function KeyPointsBlock({
  block,
  index,
}: {
  block: Extract<InfographicBlock, { type: 'keypoints' }>;
  index: number;
}) {
  const C = usePalette();
  return (
    <div className="poster-keypoints">
      <Eyebrow label={EYEBROW_LABELS['keypoints']!} num={index} />
      <div className="flex flex-col">
        {block.items.map((point, i) => (
          <div
            key={i}
            className="grid grid-cols-[28px_1fr] gap-3 pb-3 mb-3"
            style={
              i < block.items.length - 1 ? { borderBottom: `1px solid ${C.border}` } : undefined
            }
          >
            <span
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 600,
                fontSize: 18,
                color: C.fg,
                letterSpacing: '-0.01em',
                lineHeight: 1.2,
              }}
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            <span style={{ fontSize: 14, lineHeight: 1.55, color: C.fg }}>{point}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineBlock({
  block,
  index,
}: {
  block: Extract<InfographicBlock, { type: 'timeline' }>;
  index: number;
}) {
  const C = usePalette();
  return (
    <div className="poster-timeline">
      <Eyebrow label={EYEBROW_LABELS['timeline']!} num={index} />
      <div className="flex flex-col gap-3">
        {block.items.map((item, i) => (
          <div
            key={i}
            className="px-3.5 py-3"
            style={{ border: `1px solid ${C.border}`, background: C.surface }}
          >
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                letterSpacing: '0.16em',
                color: C.muted,
                marginBottom: 6,
              }}
            >
              {String(i + 1).padStart(2, '0')} / {item.time}
            </div>
            <div
              className="break-words"
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 600,
                fontSize: 17,
                marginBottom: 4,
                letterSpacing: '-0.01em',
              }}
            >
              {item.title}
            </div>
            {item.detail ? (
              <div className="break-words" style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
                {item.detail}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function StepsBlock({
  block,
  index,
}: {
  block: Extract<InfographicBlock, { type: 'steps' }>;
  index: number;
}) {
  const C = usePalette();
  return (
    <div className="poster-steps">
      <Eyebrow label={EYEBROW_LABELS['steps']!} num={index} />
      <div className="flex flex-col gap-3">
        {block.steps.map((step, i) => (
          <div
            key={i}
            className="px-3.5 py-3"
            style={{ border: `1px solid ${C.border}`, background: C.surface }}
          >
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                letterSpacing: '0.16em',
                color: C.muted,
                marginBottom: 6,
              }}
            >
              {String(i + 1).padStart(2, '0')} / STEP
            </div>
            <div
              className="break-words"
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 600,
                fontSize: 17,
                marginBottom: 4,
                letterSpacing: '-0.01em',
              }}
            >
              {step.title}
            </div>
            {step.detail ? (
              <div className="break-words" style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
                {step.detail}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ComparisonBlock({
  block,
  index,
}: {
  block: Extract<InfographicBlock, { type: 'comparison' }>;
  index: number;
}) {
  const C = usePalette();
  const cols = block.columns.slice(0, 3);
  return (
    <div className="poster-comparison">
      <Eyebrow label={EYEBROW_LABELS['comparison']!} num={index} />
      <div className="flex flex-col">
        {cols.map((col, i) => (
          <div
            key={i}
            className="py-2.5"
            style={i < cols.length - 1 ? { borderBottom: `1px solid ${C.border}` } : undefined}
          >
            <MonoLabel>{col.title}</MonoLabel>
            <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
              {col.items.map((item, j) => (
                <li
                  key={j}
                  className="flex items-start gap-2 break-words"
                  style={{ fontSize: 13, lineHeight: 1.55, color: C.fg }}
                >
                  <span style={{ color: C.accent }}>·</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuoteBlock({ block }: { block: Extract<InfographicBlock, { type: 'quote' }> }) {
  const C = usePalette();
  return (
    <div
      className="poster-quote"
      style={{ borderLeft: `3px solid ${C.accent}`, paddingLeft: 16 }}
    >
      <p
        className="m-0 break-words"
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 22,
          lineHeight: 1.35,
          color: C.fg,
          letterSpacing: '-0.01em',
        }}
      >
        <span style={{ color: C.accent, fontStyle: 'italic' }}>“</span>
        {block.text}
        <span style={{ color: C.accent, fontStyle: 'italic' }}>”</span>
      </p>
      {block.source ? (
        <div
          className="mt-2 break-words"
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: C.muted,
          }}
        >
          — {block.source}
        </div>
      ) : null}
    </div>
  );
}

function TagsBlock({ block }: { block: Extract<InfographicBlock, { type: 'tags' }> }) {
  const C = usePalette();
  return (
    <div
      className="poster-tags"
      style={{
        fontFamily: FONT_MONO,
        fontSize: 11,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: C.muted,
        textAlign: 'center',
        lineHeight: 1.6,
      }}
    >
      {block.tags.map((tag, i) => (
        <span key={i}>
          {i > 0 ? <span style={{ margin: '0 8px', color: C.border }}>·</span> : null}
          <span style={{ color: C.fg, fontWeight: 600 }}>{tag}</span>
        </span>
      ))}
    </div>
  );
}

function SourceBlock({ block }: { block: Extract<InfographicBlock, { type: 'source' }> }) {
  const C = usePalette();
  return (
    <div
      className="poster-source"
      style={{
        fontFamily: FONT_MONO,
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: C.muted,
        lineHeight: 1.6,
      }}
    >
      {block.hostname ? (
        <div className="break-words">
          <strong style={{ color: C.fg, fontWeight: 600 }}>{block.hostname}</strong>
        </div>
      ) : null}
      {block.clipped ? <div>{block.clipped}</div> : null}
      {block.url ? (
        <div
          className="break-all"
          style={{ color: C.accent, textTransform: 'none', letterSpacing: 0 }}
        >
          {block.url}
        </div>
      ) : null}
    </div>
  );
}

function UnknownBlock({ block }: { block: InfographicBlock }) {
  const C = usePalette();
  // Defensive fallback: never throw on enum drift. Log so it's observable.
  console.warn('[InfographicView] unknown block type:', (block as { type?: string }).type);
  return (
    <div
      className="poster-unknown"
      style={{ border: `1px dashed ${C.border}`, padding: 12 }}
    >
      <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.muted, marginBottom: 6 }}>
        未知信息图块
      </div>
      <pre
        className="m-0 whitespace-pre-wrap break-all"
        style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.muted }}
      >
        {JSON.stringify(block, null, 2)}
      </pre>
    </div>
  );
}
