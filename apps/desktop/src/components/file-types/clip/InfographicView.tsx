import type { InfographicBlock, InfographicDoc } from '@/features/clips/clipParse';

/**
 * Poster-style infographic renderer for clips.
 *
 * Renders a flat ordered `blocks` list (see `clipParse.ts`) as a vertical
 * stack of self-contained Tailwind card sections — one `BlockView` per block.
 * Layout is a per-block render decision (e.g. `stat` uses a grid); there is no
 * document-level layout engine. Unknown block types fall back to a muted
 * plain-text render and never throw — mirroring the defensive discipline of
 * `parseInfographic` (which drops malformed blocks) and `normalizeInfographicDoc`.
 *
 * Styling matches `ClipCardView`: `rounded-xl border border-brd bg-panel`,
 * color tokens `text-t1/t2/t3`, `text-acc`, `bg-acc/10`, etc.
 */

interface InfographicViewProps {
  doc: InfographicDoc;
}

export function InfographicView({ doc }: InfographicViewProps) {
  return (
    <div className="flex flex-col gap-3">
      {doc.blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </div>
  );
}

interface BlockViewProps {
  block: InfographicBlock;
}

/**
 * Dispatch a block to its typed renderer. Unknown types hit the fallback
 * (muted plain-text `JSON.stringify`) and emit a `console.warn` so missing
 * enum drift is observable in dev without crashing the card.
 *
 * Exported for unit testing.
 */
export function BlockView({ block }: BlockViewProps) {
  switch (block.type) {
    case 'hero':
      return <HeroBlock block={block} />;
    case 'stat':
      return <StatBlock block={block} />;
    case 'keypoints':
      return <KeyPointsBlock block={block} />;
    case 'timeline':
      return <TimelineBlock block={block} />;
    case 'steps':
      return <StepsBlock block={block} />;
    case 'comparison':
      return <ComparisonBlock block={block} />;
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

/** Shared card section wrapper — matches ClipCardView's card aesthetic. */
function Section({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-brd bg-panel shadow-[0_2px_12px_rgba(0,0,0,.06)] overflow-hidden">
      {label && (
        <div className="px-5 pt-4">
          <div className="text-[11px] text-t3 font-semibold uppercase tracking-[0.5px]">{label}</div>
        </div>
      )}
      <div className={label ? 'px-5 pb-4 pt-2' : 'p-5'}>{children}</div>
    </div>
  );
}

function HeroBlock({ block }: { block: { type: 'hero'; title: string; subtitle?: string } }) {
  return (
    <div className="rounded-xl border border-brd bg-surf overflow-hidden">
      {/* Accent band — poster header */}
      <div className="h-1.5 bg-acc" />
      <div className="px-5 py-5">
        <h2 className="text-[20px] font-bold text-t1 m-0 leading-tight break-words">{block.title}</h2>
        {block.subtitle && (
          <p className="mt-1.5 text-[13px] text-t2 m-0 leading-relaxed">{block.subtitle}</p>
        )}
      </div>
    </div>
  );
}

function StatBlock({ block }: { block: { type: 'stat'; items: { value: string; label: string; unit?: string }[] } }) {
  const items = block.items.slice(0, 4);
  const cols = items.length <= 1 ? 'grid-cols-1' : items.length <= 2 ? 'grid-cols-2' : items.length === 3 ? 'grid-cols-3' : 'grid-cols-2 md:grid-cols-4';
  return (
    <Section label="数据">
      <div className={`grid ${cols} gap-3`}>
        {items.map((item, i) => (
          <div key={i} className="rounded-lg bg-acc/10 border border-acc/15 px-3 py-2.5 flex flex-col">
            <div className="flex items-baseline gap-0.5">
              <span className="text-[20px] font-bold text-acc leading-none break-words">{item.value}</span>
              {item.unit && <span className="text-[12px] text-acc font-medium">{item.unit}</span>}
            </div>
            <span className="mt-1 text-[11px] text-t2 leading-snug break-words">{item.label}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function KeyPointsBlock({ block }: { block: { type: 'keypoints'; items: string[] } }) {
  // Mirrors ClipCardView's keyPoints rendering (numbered pill + text).
  return (
    <Section label="要点">
      <ul className="m-0 pl-0 list-none flex flex-col gap-2">
        {block.items.map((point, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px] text-t1 leading-relaxed">
            <span className="shrink-0 w-5 h-5 rounded-full bg-acc/10 text-acc text-[10px] font-bold flex items-center justify-center mt-px">{i + 1}</span>
            <span className="break-words">{point}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function TimelineBlock({ block }: { block: { type: 'timeline'; items: { time: string; title: string; detail?: string }[] } }) {
  return (
    <Section label="时间线">
      <ol className="m-0 pl-0 list-none flex flex-col gap-3">
        {block.items.map((item, i) => (
          <li key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="w-2.5 h-2.5 rounded-full bg-acc border-2 border-panel shrink-0 mt-1" />
              {i < block.items.length - 1 && <span className="w-px flex-1 bg-brd mt-1" />}
            </div>
            <div className="flex-1 min-w-0 pb-0.5">
              <div className="text-[11px] text-acc font-semibold">{item.time}</div>
              <div className="text-[13px] text-t1 font-medium leading-snug break-words">{item.title}</div>
              {item.detail && <div className="mt-0.5 text-[12px] text-t2 leading-relaxed break-words">{item.detail}</div>}
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function StepsBlock({ block }: { block: { type: 'steps'; steps: { title: string; detail?: string }[] } }) {
  return (
    <Section label="步骤">
      <ol className="m-0 pl-0 list-none flex flex-col gap-2.5">
        {block.steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className="shrink-0 w-6 h-6 rounded-full bg-acc text-white text-[11px] font-bold flex items-center justify-center mt-px">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-t1 font-medium leading-snug break-words">{step.title}</div>
              {step.detail && <div className="mt-0.5 text-[12px] text-t2 leading-relaxed break-words">{step.detail}</div>}
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function ComparisonBlock({ block }: { block: { type: 'comparison'; columns: { title: string; items: string[] }[] } }) {
  const cols = block.columns.slice(0, 3);
  const grid = cols.length <= 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-3';
  return (
    <Section label="对比">
      <div className={`grid ${grid} gap-3`}>
        {cols.map((col, i) => (
          <div key={i} className="rounded-lg border border-brd bg-bg px-3 py-2.5">
            <div className="text-[12px] text-acc font-semibold mb-1.5 break-words">{col.title}</div>
            <ul className="m-0 pl-0 list-none flex flex-col gap-1">
              {col.items.map((item, j) => (
                <li key={j} className="text-[12px] text-t1 leading-snug break-words flex items-start gap-1.5">
                  <span className="text-acc mt-px">·</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

function QuoteBlock({ block }: { block: { type: 'quote'; text: string; source?: string } }) {
  return (
    <div className="rounded-xl border border-brd bg-panel overflow-hidden">
      <div className="px-5 py-4 border-l-[3px] border-l-acc">
        <p className="text-[14px] text-t1 italic m-0 leading-relaxed break-words">“{block.text}”</p>
        {block.source && <div className="mt-2 text-[11px] text-t3 break-words">— {block.source}</div>}
      </div>
    </div>
  );
}

function TagsBlock({ block }: { block: { type: 'tags'; tags: string[] } }) {
  // Mirrors ClipCardView's tags pill rendering.
  return (
    <Section label="标签">
      <div className="flex flex-wrap gap-1.5">
        {block.tags.map((tag, i) => (
          <span key={i} className="text-[11px] text-acc bg-acc/8 border border-acc/15 px-2 py-0.5 rounded-full font-medium">{tag}</span>
        ))}
      </div>
    </Section>
  );
}

function SourceBlock({ block }: { block: { type: 'source'; url: string; hostname?: string; clipped?: string } }) {
  return (
    <div className="rounded-xl border border-brd bg-bg overflow-hidden">
      <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 text-[11px] text-t3">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 2a9 9 0 0 1 0 12M8 2a9 9 0 0 0 0 12M2 8h12" />
        </svg>
        {block.hostname && <span className="text-t2 break-all">{block.hostname}</span>}
        {block.clipped && <span className="text-t3">· {block.clipped}</span>}
        {block.url && (
          <a
            href={block.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-acc hover:underline break-all"
            title={block.url}
          >
            {block.url}
          </a>
        )}
      </div>
    </div>
  );
}

function UnknownBlock({ block }: { block: InfographicBlock }) {
  // Defensive fallback: never throw on enum drift. Log so it's observable.
  console.warn('[InfographicView] unknown block type:', (block as { type?: string }).type);
  return (
    <div className="rounded-xl border border-dashed border-brd bg-bg px-4 py-2.5">
      <div className="text-[11px] text-t3 mb-1">未知信息图块</div>
      <pre className="m-0 text-[11px] text-t3 whitespace-pre-wrap break-all font-mono">
        {JSON.stringify(block, null, 2)}
      </pre>
    </div>
  );
}
