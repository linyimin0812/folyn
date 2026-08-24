import { useMemo, useState, type ReactNode } from 'react';
import { renderMarkdownToReact } from '@/services/markdown/renderMarkdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { AssistantImage } from '@mochi/cli-adapter';
import { useVaultStore } from '@/store/vaultStore';
import { saveImageToVault } from '@/services/chatImageService';
import { CodeOverride, FilePathContext, type FilePathContextValue } from './FilePathCode';
import { ZoomableImage } from './ZoomableImage';

// ponytail: image models (e.g. rig-backed image gen) return the generated
// image inline as a `data:image/...;base64,...` text delta. The Rust
// `ImageScanner` state machine in `chat.rs` extracts these into structured
// `ChatChunk::Image` events, so by the time content reaches this component,
// `content` is pure text and `images[]` carries the inline image data with
// its character offset. We split `content` at image offsets and interleave
// `<img>` segments between markdown-rendered text segments.
//
// Memoization: each text segment is keyed on its value, so once a new image
// arrives and a fresh text segment starts growing, the prior text segments
// don't re-parse through the markdown pipeline on every delta. Only the
// trailing (growing) text segment re-parses — O(delta size), not
// O(accumulated size).

// TODO(PRx): lazy-load markdown pipeline via dynamic import to keep the
// pet-panel bundle lean. The top-level import is acceptable for PR1
// (correctness first); PR2/PR3 will split the heavy markdown deps out of
// the secondary window bundle.

// ponytail: renderMarkdownToReact is sync (processSync) and MathJax SVG
// rendering happens at parse time, so each new text segment re-parses to
// fresh SVG — no runtime typeset/useEffect needed for streaming. The
// per-segment useMemo cache below keeps prior segments from re-parsing.
const render = (value: string): ReactNode =>
  renderMarkdownToReact(value, {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [[rehypeHighlight, { detect: true } as any]],
    components: { code: CodeOverride },
  });

type Segment =
  | { type: 'text'; value: string }
  | { type: 'image'; value: AssistantImage };

/** Split `content` into ordered text/image segments by image `atOffset`s.
 *  Images consume no characters in `content`; they mark render positions.
 *  Trailing/leading empty text segments are dropped. */
function splitSegments(content: string, images?: AssistantImage[]): Segment[] {
  if (!images || images.length === 0) {
    return content ? [{ type: 'text', value: content }] : [];
  }
  const sorted = [...images].sort((a, b) => a.atOffset - b.atOffset);
  const segs: Segment[] = [];
  let cursor = 0;
  for (const img of sorted) {
    const start = Math.min(img.atOffset, content.length);
    if (start > cursor) {
      segs.push({ type: 'text', value: content.slice(cursor, start) });
    }
    segs.push({ type: 'image', value: img });
    // ponytail: clamp cursor to content.length so an image past the end
    // (e.g. streamed before any text) doesn't slice a negative range. The
    // image is rendered at the end in this case.
    cursor = Math.max(cursor, start);
  }
  if (cursor < content.length) {
    segs.push({ type: 'text', value: content.slice(cursor) });
  }
  return segs;
}

/** Render one text segment through the markdown pipeline. Memoized by value
 *  so re-renders with the same segment value reuse the prior React node. */
function useTextNode(value: string): ReactNode {
  // ponytail: per-segment memoization. The unified processor is sync
  // (`processSync`); for an N-segment message, only the trailing segment
  // (whose value changes on each delta) re-parses. Prior segments hit the
  // cache. This is the lazy version of an incremental markdown tree —
  // a full incremental parser would be more efficient but adds a dep.
  return useMemo(() => {
    if (!value.trim()) return null;
    try {
      return render(value);
    } catch {
      return value;
    }
  }, [value]);
}

export interface MessageContentProps {
  content: string;
  /** Inline images emitted by image-generation models. Each carries an
   *  `atOffset` into `content`; this component interleaves them between
   *  text segments. The caller (ChatMessageList) is responsible for
   *  passing `msg.images`. */
  images?: AssistantImage[];
  /** Skip the unified markdown pipeline and render the raw content inside a
   *  plain div. The caller is responsible for whitespace handling (e.g.
   *  passing a `whitespace-pre-wrap` Tailwind class). Used by the pet chat,
   *  which is vault-free and renders assistant text as-is. */
  plaintext?: boolean;
  /** Extra class for the outer div. In markdown mode the outer always
   *  carries `msg-md`; in plaintext mode only `className` is applied. */
  className?: string;
  /** When true, image segments render a "保存到 vault" button. Defaults
   *  to false — only the AiPanel and Pet chat callers opt in. */
  showSaveImageButton?: boolean;
  /** Callbacks for clickable inline-code file paths. When both are present,
   *  an inline-code token that matches a file-path shape renders as a
   *  clickable element that calls `onPathClick(path, line?, col?)` after
   *  `resolvePath(raw)` confirms the file exists. The pet chat omits both
   *  (vault-free secondary window); the AiPanel supplies them. */
  onPathClick?: (path: string, line?: number, col?: number) => void;
  resolvePath?: (raw: string) => Promise<boolean>;
}

export function MessageContent({
  content,
  images,
  plaintext,
  className,
  showSaveImageButton,
  onPathClick,
  resolvePath,
}: MessageContentProps) {
  const segments = useMemo(() => splitSegments(content, images), [content, images]);

  if (plaintext) {
    // Plaintext path: no markdown processing. Render text + interleaved
    // images (so image-generation in pet chat still renders).
    return (
      <div className={className}>
        {segments.map((seg, i) =>
          seg.type === 'text' ? (
            <span key={`t-${i}`}>{seg.value}</span>
          ) : (
            <ImageSegment
              key={`i-${i}`}
              image={seg.value}
              showSaveButton={!!showSaveImageButton}
            />
          ),
        )}
      </div>
    );
  }

  if (segments.length === 0) {
    // No content, no images — render the wrapper (caller decides whether
    // to render the bubble at all).
    return <div className={`msg-md${className ? ` ${className}` : ''}`} />;
  }

  const ctx: FilePathContextValue = { onPathClick, resolvePath };

  return (
    <FilePathContext.Provider value={ctx}>
      <div className={`msg-md${className ? ` ${className}` : ''}`}>
        {segments.map((seg, i) => {
          if (seg.type === 'image') {
            return (
              <ImageSegment
                key={`i-${i}`}
                image={seg.value}
                showSaveButton={!!showSaveImageButton}
              />
            );
          }
          // Text segment — memoized.
          // ponytail: key is the segment value so React preserves the node
          // identity across re-renders when the value is unchanged. This is
          // what makes the per-segment memoization effective.
          return <TextSegment key={`t-${i}`} value={seg.value} />;
        })}
      </div>
    </FilePathContext.Provider>
  );
}

/** A single text segment rendered through the markdown pipeline. The
 *  component boundary lets `useMemo` cache the parsed React node per value
 *  even when the parent re-renders. */
function TextSegment({ value }: { value: string }) {
  const node = useTextNode(value);
  return <>{node}</>;
}

/** An image segment rendered as `<img>` plus an optional "保存到 vault"
 *  button. The button is disabled when no vault is active (with a tooltip
 *  "未激活 vault"); otherwise it calls `saveImageToVault` and shows
 *  success/failure feedback inline. */
function ImageSegment({
  image,
  showSaveButton,
}: {
  image: AssistantImage;
  showSaveButton: boolean;
}) {
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const handleSave = async () => {
    setStatus('saving');
    setErrMsg(null);
    try {
      const path = await saveImageToVault(image.data);
      setSavedPath(path);
      setStatus('saved');
      window.setTimeout(() => {
        setStatus((curr) => (curr === 'saved' ? 'idle' : curr));
        setSavedPath(null);
      }, 2000);
    } catch (err) {
      setErrMsg(String(err));
      setStatus('error');
      window.setTimeout(() => {
        setStatus((curr) => (curr === 'error' ? 'idle' : curr));
        setErrMsg(null);
      }, 4000);
    }
  };

  return (
    <span className="inline-block align-top my-1">
      <ZoomableImage src={image.data} alt="" className="max-w-full h-auto rounded" />
      {showSaveButton && (
        <span className="block mt-0.5">
          <button
            type="button"
            disabled={!activeVaultId || status === 'saving' || status === 'saved'}
            onClick={() => void handleSave()}
            className="text-[11px] py-0.5 px-2 border border-brd rounded bg-transparent text-t3 hover:bg-hov hover:text-t1 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={!activeVaultId ? '未激活 vault' : undefined}
          >
            {status === 'saving'
              ? '保存中...'
              : status === 'saved'
                ? '已保存'
                : status === 'error'
                  ? '保存失败'
                  : '保存到 vault'}
          </button>
          {savedPath && status === 'saved' && (
            <span className="ml-1.5 text-[10px] text-t3" title={savedPath}>
              已写入 __attachments__
            </span>
          )}
          {errMsg && status === 'error' && (
            <span className="ml-1.5 text-[10px] text-red-500" title={errMsg}>
              {errMsg.length > 40 ? errMsg.slice(0, 40) + '…' : errMsg}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
