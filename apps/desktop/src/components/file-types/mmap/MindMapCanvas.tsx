import { useEffect, useRef } from 'react';
import type { MindElixirInstance } from 'mind-elixir';
import type { PreviewProps } from '../types';

const FALLBACK_SRC = '- Root';

function toSafeSrc(content: string | undefined): string {
  const trimmed = content?.trim();
  return trimmed || FALLBACK_SRC;
}

export default function MindMapCanvas({ content, onChange }: PreviewProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<MindElixirInstance | null>(null);
  const lastEmittedRef = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;

    (async () => {
      const [{ default: MindElixir }, { plaintextToMindElixir, mindElixirToPlaintext }] = await Promise.all([
        import('mind-elixir'),
        import('mind-elixir/plaintextConverter'),
        // @ts-expect-error — CSS module without type declaration
        import('mind-elixir/style'),
      ]);
      if (disposed || !elRef.current) return;

      const el = elRef.current;
      const inst = new MindElixir({
        el,
        editable: true,
        allowUndo: true,
      });

      const syncOut = () => {
        if (!onChange) return;
        const md = mindElixirToPlaintext(inst.getData());
        lastEmittedRef.current = md;
        onChange(md);
      };
      // ponytail: re-serialize on every operation. Full snapshot, no incremental
      // patch — fine for MVP; if large maps stutter, diff+patch by node id.
      inst.bus.addListener('operation', syncOut);

      const data = plaintextToMindElixir(toSafeSrc(content));
      inst.init(data);
      instRef.current = inst;
    })();

    return () => {
      disposed = true;
      instRef.current?.destroy();
      instRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External source change → re-init unless it matches the string we just
  // emitted (which would be the feedback from our own onChange writeback).
  useEffect(() => {
    if (!instRef.current || content === lastEmittedRef.current) return;
    let cancelled = false;
    (async () => {
      const { plaintextToMindElixir } = await import('mind-elixir/plaintextConverter');
      if (cancelled || !instRef.current) return;
      // ponytail: full re-init on external edit. Loses cursor/zoom/scroll state
      // on every keystroke in the source pane — acceptable for MVP; upgrade to
      // id-based diff+patch when it annoies.
      instRef.current.init(plaintextToMindElixir(toSafeSrc(content)));
    })();
    return () => {
      cancelled = true;
    };
  }, [content]);

  return <div ref={elRef} className="w-full h-full overflow-hidden" />;
}
