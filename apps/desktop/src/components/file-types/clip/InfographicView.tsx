import { forwardRef } from 'react';
import type { InfographicBlock, InfographicDoc } from '@/features/clips/clipParse';

/**
 * Poster-style infographic renderer for clips.
 *
 * Renders a flat ordered `blocks` list (see `clipParse.ts`) as a **single
 * unified poster** — one container, one background, one accent header band —
 * not a vertical stack of separate cards. The poster is the export target
 * for the "导出为图片" button in `ClipCardView`, which calls
 * `html-to-image.toPng()` on the poster DOM node.
 *
 * Layout:
 *   ┌───────────────────────────────────────────┐
 *   │ ▌accent band                              │  HeroBlock (full-width)
 *   │  Title / subtitle                         │
 *   ├───────────────────────────────────────────┤
 *   │  stat  │  stat  │  stat  │  stat          │  StatBlock (full-width 4-col)
 *   ├──────────────────────┬────────────────────┤
 *   │  keypoints           │  timeline          │  2-col middle (when both present)
 *   ├──────────────────────┴────────────────────┤
 *   │  steps / comparison / quote / tags        │  full-width middle
 *   ├───────────────────────────────────────────┤
 *   │  source footer (hostname · url · clipped) │  SourceBlock (full-width)
 *   └───────────────────────────────────────────┘
 *
 * Block dispatch is unchanged from the card-stack version — each block has
 * its own typed renderer. The difference is the container: a single
 * `bg-panel rounded-2xl border shadow-lg` wrapper with no per-block card
 * chrome. Unknown block types fall back to muted plain-text and never throw.
 *
 * `InfographicView` is a `forwardRef` so the export button can grab the
 * poster DOM node directly.
 */

export interface InfographicViewProps {
  doc: InfographicDoc;
}

export const InfographicView = forwardRef<HTMLDivElement, InfographicViewProps>(
  function InfographicView({ doc }, ref) {
    // Partition blocks into layout slots. The poster layout is:
    //   hero (first, full-width header)
    //   stat (full-width row)
    //   middle (2-col where appropriate, full-width otherwise)
    //   source (last, full-width footer)
    // Everything else (keypoints/timeline/steps/comparison/quote/tags) goes
    // into the middle region in document order. When two adjacent middle
    // blocks are both "narrow" (keypoints/timeline/comparison), they share a
    // 2-col row; otherwise each takes a full-width row.
    const heroIdx = doc.blocks.findIndex((b) => b.type === 'hero');
    const statIdx = doc.blocks.findIndex((b) => b.type === 'stat');
    const sourceIdx = doc.blocks.findIndex((b) => b.type === 'source');
    const hero = heroIdx >= 0 ? (doc.blocks[heroIdx] as Extract<InfographicBlock, { type: 'hero' }>) : undefined;
    const stat = statIdx >= 0 ? (doc.blocks[statIdx] as Extract<InfographicBlock, { type: 'stat' }>) : undefined;
    const source = sourceIdx >= 0 ? (doc.blocks[sourceIdx] as Extract<InfographicBlock, { type: 'source' }>) : undefined;
    // Middle = everything except the first hero / stat / source (which are
    // promoted to header / stat-row / footer slots). Duplicate hero / stat /
    // source blocks remain in the middle and render via BlockView.
    const picked = new Set([heroIdx, statIdx, sourceIdx].filter((i) => i >= 0));
    const middleBlocks = doc.blocks.filter((_, i) => !picked.has(i));

    // Group consecutive "narrow" blocks into 2-col rows. Narrow = keypoints /
    // timeline / comparison / tags. "Wide" = steps / quote (full-width).
    const narrowTypes = new Set(['keypoints', 'timeline', 'comparison', 'tags']);
    type Row =
      | { kind: 'pair'; left: InfographicBlock; right: InfographicBlock }
      | { kind: 'single'; block: InfographicBlock };
    const rows: Row[] = [];
    for (let i = 0; i < middleBlocks.length; ) {
      const cur = middleBlocks[i];
      const next = middleBlocks[i + 1];
      if (next && narrowTypes.has(cur.type) && narrowTypes.has(next.type)) {
        rows.push({ kind: 'pair', left: cur, right: next });
        i += 2;
      } else {
        rows.push({ kind: 'single', block: cur });
        i += 1;
      }
    }

    return (
      <div
        ref={ref}
        className="poster-container max-w-[800px] w-full mx-auto bg-panel rounded-2xl overflow-hidden border border-brd shadow-lg flex flex-col"
      >
        {hero ? <HeroBlock block={hero} /> : null}
        <div className="poster-body px-6 py-5 flex flex-col gap-4">
          {stat ? <StatBlock block={stat} /> : null}
          {rows.map((row, i) =>
            row.kind === 'pair' ? (
              <div key={i} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <BlockView block={row.left} />
                <BlockView block={row.right} />
              </div>
            ) : (
              <BlockView key={i} block={row.block} />
            ),
          )}
        </div>
        {source ? <SourceBlock block={source} /> : null}
      </div>
    );
  },
);

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

function HeroBlock({ block }: { block: { type: 'hero'; title: string; subtitle?: string } }) {
  return (
    <div className="poster-hero border-b border-brd">
      {/* Accent band — poster header */}
      <div className="h-2 bg-acc" />
      <div className="px-6 py-5 bg-surf">
        <h2 className="text-[22px] font-bold text-t1 m-0 leading-tight break-words">{block.title}</h2>
        {block.subtitle && (
          <p className="mt-1.5 text-[13px] text-t2 m-0 leading-relaxed break-words">{block.subtitle}</p>
        )}
      </div>
    </div>
  );
}

function StatBlock({ block }: { block: { type: 'stat'; items: { value: string; label: string; unit?: string }[] } }) {
  const items = block.items.slice(0, 4);
  const cols = items.length <= 1 ? 'grid-cols-1' : items.length <= 2 ? 'grid-cols-2' : items.length === 3 ? 'grid-cols-3' : 'grid-cols-2 md:grid-cols-4';
  return (
    <div className={`grid ${cols} gap-3`}>
      {items.map((item, i) => (
        <div key={i} className="rounded-md bg-acc/10 border border-acc/15 px-3 py-2.5 flex flex-col">
          <div className="flex items-baseline gap-0.5">
            <span className="text-[22px] font-bold text-acc leading-none break-words">{item.value}</span>
            {item.unit && <span className="text-[12px] text-acc font-medium">{item.unit}</span>}
          </div>
          <span className="mt-1 text-[11px] text-t2 leading-snug break-words">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function KeyPointsBlock({ block }: { block: { type: 'keypoints'; items: string[] } }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] text-t3 font-semibold uppercase tracking-[0.5px]">要点</div>
      <ul className="m-0 pl-0 list-none flex flex-col gap-2">
        {block.items.map((point, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px] text-t1 leading-relaxed">
            <span className="shrink-0 w-5 h-5 rounded-full bg-acc/10 text-acc text-[10px] font-bold flex items-center justify-center mt-px">{i + 1}</span>
            <span className="break-words">{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TimelineBlock({ block }: { block: { type: 'timeline'; items: { time: string; title: string; detail?: string }[] } }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] text-t3 font-semibold uppercase tracking-[0.5px]">时间线</div>
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
    </div>
  );
}

function StepsBlock({ block }: { block: { type: 'steps'; steps: { title: string; detail?: string }[] } }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] text-t3 font-semibold uppercase tracking-[0.5px]">步骤</div>
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
    </div>
  );
}

function ComparisonBlock({ block }: { block: { type: 'comparison'; columns: { title: string; items: string[] }[] } }) {
  const cols = block.columns.slice(0, 3);
  const grid = cols.length <= 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-3';
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] text-t3 font-semibold uppercase tracking-[0.5px]">对比</div>
      <div className={`grid ${grid} gap-3`}>
        {cols.map((col, i) => (
          <div key={i} className="rounded-md border border-brd bg-bg px-3 py-2.5">
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
    </div>
  );
}

function QuoteBlock({ block }: { block: { type: 'quote'; text: string; source?: string } }) {
  return (
    <div className="border-l-[3px] border-l-acc pl-4 py-1">
      <p className="text-[14px] text-t1 italic m-0 leading-relaxed break-words">“{block.text}”</p>
      {block.source && <div className="mt-2 text-[11px] text-t3 break-words">— {block.source}</div>}
    </div>
  );
}

function TagsBlock({ block }: { block: { type: 'tags'; tags: string[] } }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] text-t3 font-semibold uppercase tracking-[0.5px]">标签</div>
      <div className="flex flex-wrap gap-1.5">
        {block.tags.map((tag, i) => (
          <span key={i} className="text-[11px] text-acc bg-acc/8 border border-acc/15 px-2 py-0.5 rounded-full font-medium">{tag}</span>
        ))}
      </div>
    </div>
  );
}

function SourceBlock({ block }: { block: { type: 'source'; url: string; hostname?: string; clipped?: string } }) {
  return (
    <div className="poster-footer px-6 py-3 bg-bg border-t border-brd flex flex-wrap items-center gap-2 text-[11px] text-t3">
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
  );
}

function UnknownBlock({ block }: { block: InfographicBlock }) {
  // Defensive fallback: never throw on enum drift. Log so it's observable.
  console.warn('[InfographicView] unknown block type:', (block as { type?: string }).type);
  return (
    <div className="rounded-md border border-dashed border-brd bg-bg px-4 py-2.5">
      <div className="text-[11px] text-t3 mb-1">未知信息图块</div>
      <pre className="m-0 text-[11px] text-t3 whitespace-pre-wrap break-all font-mono">
        {JSON.stringify(block, null, 2)}
      </pre>
    </div>
  );
}
