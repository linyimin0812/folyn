import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import type { EditorProps } from '../types';
import {
  parseOutline,
  serializeOutline,
  type OutlineLine,
  type MmapMeta,
  type MmapNodeStyle,
} from './outlineConverter';
import { useSettingsStore } from '@/store/settingsStore';
import { useVaultStore } from '@/store/vaultStore';
import { ImagePasteDialog, type ImageSaveConfig } from '@/components/editor/ImagePasteDialog';
import { getStrategy, fileToBase64, convertImageFormat } from '@/utils/imageUploader';

// ponytail: per-row textareas, not a single big textarea. Reason: fold
// (collapse/expand) needs to hide a subtree range, which is trivial when each
// row is its own DOM node and a pain when everything is one textarea's
// internal text. Trade-off: focus management across rows is manual (we track
// focusIdxRef + refocus via layout effect after structural edits).
//
// ponytail: deferred — ArrowUp/ArrowDown cross-row navigation. Default
// textarea behavior moves the caret within the row only; switching rows on
// up/down requires intercepting the key + computing a column target. Add
// when the user asks; meanwhile users click or use Tab/Enter to move.

// Compute the set of row indices hidden by collapse (subtree range hide).
// Exported so keyboard handlers can find the previous visible row without
// duplicating the render-side fold walk.
export function computeHiddenIdx(
  lines: OutlineLine[],
  collapsed: Set<number>,
): Set<number> {
  const hidden = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (hidden.has(i)) {
      let j = i + 1;
      while (j < lines.length && lines[j].depth > lines[i].depth) {
        hidden.add(j);
        j++;
      }
      continue;
    }
    if (collapsed.has(i)) {
      let j = i + 1;
      while (j < lines.length && lines[j].depth > lines[i].depth) {
        hidden.add(j);
        j++;
      }
    }
  }
  return hidden;
}

function autoSize(ta: HTMLTextAreaElement | null) {
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight}px`;
}

// ponytail: per-row tree lines are drawn in two passes.
//
// Pass 1 — per-ancestor verticals (a from 1 to D-1): one full-height segment
// per ancestor depth at the ancestor's bullet column x = (a-1)*16 + 14. Full
// height (top:-6, bottom:0) — a single span passes through the bullet and
// runs off the bottom edge of the last visible descendant, where the next
// sibling's landing segment (pass 2) picks it up.
//
// Pass 2 — landing segment: when the previous visible row's depth > current
// row's depth D, a subtree at depth D ended above and the current row is the
// next sibling at depth D. Draw a half-height segment (top:0, height:15) at
// x = (D-1)*16 + 14 — the depth-D bullet column, which is the current row's
// OWN bullet column (pass 1 stops at D-1, so this column is otherwise empty
// on this row). The segment lands the vertical line coming from above onto
// the current row's bullet. If the previous visible row is shallower than D,
// no subtree ended → no landing. Skip depth 0 (root has no bullet column).
//
// Row layout (per depth D) is
//   paddingLeft(max(D-1,0)*16) + chevron slot(w-2=8) + gap-1(4) + bullet
//   wrap(4) so bullet center = max(D-1,0)*16 + 8 + 4 + 2 = max(D-1,0)*16 + 14.
// The chevron slot is narrowed to w-2 (8px) so the ancestor vertical line at
// x = (a-1)*16 + 14 on a depth-D row (a from 1..D-1) lands in the row's
// paddingLeft area (0..(D-1)*16), strictly left of the chevron slot
// ((D-1)*16..(D-1)*16+8) — no overlap with the triangle. Skip a=0 (root) —
// root has no bullet column to anchor a vertical line. Magic numbers —
// recompute if row layout changes.
const BULLET_CENTER_OFFSET = 12;
const ROW_HALF_HEIGHT = 15; // ~half of single-line row height for landing stub

// ponytail: metadata (arrows/summaries/links/styles/mapStyle) round-trips via
// a trailing `<!-- mmap:meta -->` block on lines[0].meta. The OutlineEditor
// textarea rows show only the tree; this section mirrors the metadata block
// as visible read-only rows below the tree so users can see what's there
// without scrolling into the source. Editing happens in the source textarea
// (re-parsing live textareas here is more work than MVP needs — ceiling:
// promote to editable rows with their own onChange → re-serialize when a
// user asks to edit metadata in-place).

// Display order for per-node style keys. Keys not in this list fall through
// in their JSON order at the tail.
const STYLE_KEY_ORDER: (keyof MmapNodeStyle)[] = [
  'fontSize',
  'fontFamily',
  'fontWeight',
  'fontStyle',
  'color',
  'background',
  'textDecoration',
  'border',
  'width',
];

// Format one MmapNodeStyle as a comma-separated summary string matching the
// footer's compact shape, e.g. `fontSize:16, bold, color:#fff, bg:#f00`.
// - fontWeight/fontStyle/textDecoration render as bare values (short, common).
// - background renders as `bg:<value>` to distinguish from `color`.
// - fontSize strips a trailing `px` (display-only; source keeps the raw value).
// - unknown keys fall back to `<key>:<value>`.
function formatNodeStyle(style: MmapNodeStyle): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  const pushKey = (key: keyof MmapNodeStyle) => {
    const v = style[key];
    if (v == null || v === '') return;
    seen.add(key);
    switch (key) {
      case 'fontWeight':
      case 'fontStyle':
      case 'textDecoration':
        parts.push(String(v));
        break;
      case 'background':
        parts.push(`bg:${v}`);
        break;
      case 'fontSize': {
        const stripped = String(v).replace(/px$/, '');
        parts.push(`fontSize:${stripped}`);
        break;
      }
      default:
        parts.push(`${key}:${v}`);
    }
  };
  for (const k of STYLE_KEY_ORDER) pushKey(k);
  for (const k of Object.keys(style) as (keyof MmapNodeStyle)[]) {
    if (!seen.has(k)) pushKey(k);
  }
  return parts.join(', ');
}

function metaCount(meta: MmapMeta): number {
  const styleCount = Object.keys(meta.styles ?? {}).length;
  const mapStyleCount =
    meta.mapStyle?.rainbow === false ? 1 : 0;
  return (
    meta.arrows.length +
    meta.summaries.length +
    meta.links.length +
    styleCount +
    mapStyleCount
  );
}

// ponytail: metadata footer is pinned OUTSIDE the scroll container at the
// bottom of the editor — the chevron + "Links / Arrows / Summaries / Styles (N)"
// header stays visible while the tree scrolls. Entries render ABOVE the
// header when expanded (footer expands upward — conventional for pinned
// footers). Only rendered when lines[0]?.meta has entries.
function renderMetaSection(
  meta: MmapMeta | undefined,
  collapsed: boolean,
  onToggle: () => void,
) {
  if (!meta) return null;
  const count = metaCount(meta);
  if (count === 0) return null;
  const typeRowCls =
    'flex items-start gap-1.5 text-t3 text-[12px] leading-normal';
  const labelCls = 'font-medium text-t3 shrink-0 w-[56px]';
  const entryCls = 'text-t2 break-all';
  return (
    <div className="border-t border-brd px-6 py-2 select-text">
      {!collapsed && (
        <div className="mb-1.5 flex flex-col gap-1">
          {meta.arrows.map((a, i) => (
            <div key={`arrow${i}`} className={typeRowCls}>
              <span className={labelCls}>Arrow</span>
              <span className={entryCls}>
                {a.label
                  ? `${a.from} ${a.bidirectional ? '<->' : '->'} ${a.to} [${a.label}]`
                  : `${a.from} ${a.bidirectional ? '<->' : '->'} ${a.to}`}
              </span>
            </div>
          ))}
          {meta.summaries.map((s, i) => (
            <div key={`summary${i}`} className={typeRowCls}>
              <span className={labelCls}>Summary</span>
              <span className={entryCls}>
                {s.label
                  ? `${s.parent}/${s.start}-${s.end} [${s.label}]`
                  : `${s.parent}/${s.start}-${s.end}`}
              </span>
            </div>
          ))}
          {meta.links.map((l, i) => (
            <div key={`link${i}`} className={typeRowCls}>
              <span className={labelCls}>Link</span>
              <span className={entryCls}>{`${l.node} -> ${l.url}`}</span>
            </div>
          ))}
          {Object.entries(meta.styles ?? {}).map(([topic, style], i) => (
            <div key={`style${i}`} className={typeRowCls}>
              <span className={labelCls}>Style</span>
              <span className={entryCls}>{`${topic} -> ${formatNodeStyle(style)}`}</span>
            </div>
          ))}
          {meta.mapStyle?.rainbow === false && (
            <div key="mapStyle" className={typeRowCls}>
              <span className={labelCls}>Map</span>
              <span className={entryCls}>rainbow=false</span>
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 w-full text-left text-[12px] text-t3 font-medium leading-normal hover:text-t2"
        aria-expanded={!collapsed}
        title={collapsed ? '展开' : '折叠'}
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="currentColor"
          style={{
            transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
            transition: 'transform 100ms',
            transformOrigin: '50% 50%',
          }}
        >
          <polygon points="1.5,1 6.5,4 1.5,7" />
        </svg>
        <span>Links / Arrows / Summaries / Styles ({count})</span>
      </button>
    </div>
  );
}

export function OutlineEditor({ content, filePath, onChange }: EditorProps) {
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const vaultRoot = useVaultStore((s) => s.currentVault?.basePath ?? '');
  const [lines, setLines] = useState<OutlineLine[]>(() => parseOutline(content));
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  // ponytail: metadata section collapsed by default — keeps the editor
  // clutter-free until the user wants to inspect arrows/summaries/links.
  const [metaCollapsed, setMetaCollapsed] = useState(true);
  const lastEmittedRef = useRef<string | null>(null);
  const taRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const focusIdxRef = useRef<number>(0);
  // Where to place the caret after a structural edit re-renders. -1 = leave
  // default (end of textarea value); 0 = start; N = caret at offset N.
  const focusCaretRef = useRef<number>(-1);

  // Image-paste dialog state — mirrors EditorPane's markdown-editor flow:
  // paste → open ImagePasteDialog → save via imageUploader strategy → insert
  // `![](url)` at the cursor. The dialog is modal (z-200 overlay) so `lines`
  // can't change between paste and confirm.
  const [imagePasteVisible, setImagePasteVisible] = useState(false);
  const [imagePasteFile, setImagePasteFile] = useState<File | null>(null);
  const [imagePastePreviewUrl, setImagePastePreviewUrl] = useState('');
  // Captures which textarea row + caret offset the image markdown should be
  // inserted at once the user confirms the upload dialog.
  const pasteTargetRef = useRef<{ idx: number; caret: number }>({ idx: 0, caret: 0 });

  // External content change → re-parse unless we just emitted it (feedback
  // loop guard mirroring MindMapCanvas).
  useEffect(() => {
    if (content === lastEmittedRef.current) return;
    setLines(parseOutline(content));
  }, [content]);

  const emit = useCallback(
    (newLines: OutlineLine[]) => {
      const src = serializeOutline(newLines);
      lastEmittedRef.current = src;
      onChange(src);
    },
    [onChange],
  );

  // Re-size all textareas whenever line texts change.
  useLayoutEffect(() => {
    taRefs.current.forEach(autoSize);
  }, [lines]);

  // Re-focus the row that should hold the caret after a structural edit.
  useLayoutEffect(() => {
    const idx = focusIdxRef.current;
    const ta = taRefs.current[idx];
    if (!ta) return;
    if (document.activeElement !== ta) ta.focus();
    const caret = focusCaretRef.current;
    if (caret >= 0) {
      try {
        ta.setSelectionRange(caret, caret);
      } catch {
        // out of range — ignore
      }
      focusCaretRef.current = -1;
    }
  }, [lines]);

  // ponytail: option 3 — compute `next` from closure `lines`, call
  // `setLines(next)` value-form, then `emit(next)`. Safe because these run
  // in event handlers (onChange/onKeyDown), each its own tick — no batched
  // stale-closure risk. Avoids calling `emit` inside a `setLines` updater
  // (which executes during render phase and trips the "Cannot update a
  // component while rendering a different component" warning via the parent
  // setState in `onChange`).
  //
  // The textarea value for each row is `text + '\n' + note` — the first line
  // is the topic, subsequent lines are the note. Shift+Enter inserts a `\n`
  // (default textarea behavior — not intercepted here); Enter (no shift) is
  // intercepted and calls splitLine. updateLineText splits the new value on
  // the first `\n`: head → text, tail (joined with `\n`) → note.
  const updateLineText = (idx: number, value: string) => {
    const [text, ...rest] = value.split('\n');
    const note = rest.length ? rest.join('\n') : undefined;
    const next = lines.slice();
    next[idx] = { ...next[idx], text, note };
    setLines(next);
    emit(next);
  };

  const changeDepth = (idx: number, delta: 1 | -1) => {
    // ponytail: single-root invariant — the root row (idx 0) is the implicit
    // container at depth 0 and must never be indented (would make it a
    // non-root, rendering it bullet-less and orphaning the tree). No-op.
    if (idx === 0) return;
    const cur = lines[idx];
    const newDepth = Math.max(1, Math.min(20, cur.depth + delta));
    if (newDepth === cur.depth) return;
    const next = lines.slice();
    next[idx] = { ...cur, depth: newDepth };
    setLines(next);
    emit(next);
  };

  const splitLine = (idx: number, cursorPos: number) => {
    const cur = lines[idx];
    // ponytail: operate on the full textarea value (text + '\n' + note) so
    // Enter works whether the caret is in the topic or the note section.
    // before/after may themselves contain `\n`; split on first `\n` to
    // recover (text, note) for each side. The new sibling inherits no note
    // of its own unless the caret was in the note section.
    const fullValue = cur.text + (cur.note ? '\n' + cur.note : '');
    const before = fullValue.slice(0, cursorPos);
    const after = fullValue.slice(cursorPos);
    const [beforeText, ...beforeRest] = before.split('\n');
    const [afterText, ...afterRest] = after.split('\n');
    const beforeNote = beforeRest.length ? beforeRest.join('\n') : undefined;
    const afterNote = afterRest.length ? afterRest.join('\n') : undefined;
    const next = lines.slice();
    next[idx] = { ...cur, text: beforeText, note: beforeNote };
    // ponytail: root (depth 0) is a unique implicit container — WorkFlowy
    // semantics say Enter on root creates a depth-1 child, not a depth-0
    // sibling (a depth-0 sibling would render without a bullet since bullets
    // are gated on depth > 0). Non-root rows split into a same-depth sibling.
    const newDepth = cur.depth === 0 ? 1 : cur.depth;
    next.splice(idx + 1, 0, { text: afterText, depth: newDepth, note: afterNote });
    focusIdxRef.current = idx + 1;
    focusCaretRef.current = 0;
    setLines(next);
    emit(next);
  };

  // Backspace handling — WorkFlowy contract:
  //   - mid-text (caret > 0): default textarea behavior, no intercept.
  //   - caret 0 + non-empty row: merge current row's content into the
  //     previous visible row, caret lands at the merge boundary.
  //   - empty row: delete the row, focus moves to previous visible row at end.
  //   - no previous visible row (root): do nothing.
  //
  // ponytail: merge joins the full textarea values (text + '\n' + note) of
  // prev and cur, then re-splits on the first `\n` — so notes survive a
  // caret-0 backspace (the prev row's note absorbs cur's content). Edge
  // cases like "caret at note-text boundary" (offset = text.length+1) are
  // NOT intercepted (selectionStart !== 0), so default backspace removes the
  // `\n` joining text and note — updateLineText then re-splits and the note
  // collapses back into the topic. Both paths preserve data.
  const backspaceAtStart = (idx: number) => {
    const hidden = computeHiddenIdx(lines, collapsed);
    let prevIdx = -1;
    for (let i = idx - 1; i >= 0; i--) {
      if (!hidden.has(i)) {
        prevIdx = i;
        break;
      }
    }
    if (prevIdx < 0) return; // root — no-op
    const cur = lines[idx];
    const prevRow = lines[prevIdx];
    const next = lines.slice();
    const prevFull = prevRow.text + (prevRow.note ? '\n' + prevRow.note : '');
    const curFull = cur.text + (cur.note ? '\n' + cur.note : '');
    const merged = prevFull + curFull;
    const [mergedText, ...mergedRest] = merged.split('\n');
    const mergedNote = mergedRest.length ? mergedRest.join('\n') : undefined;
    next[prevIdx] = { ...prevRow, text: mergedText, note: mergedNote };
    next.splice(idx, 1);
    focusIdxRef.current = prevIdx;
    focusCaretRef.current = prevRow.text.length;
    setLines(next);
    emit(next);
  };

  // Compute hidden rows (subtrees of collapsed ancestors).
  const hiddenIdx = computeHiddenIdx(lines, collapsed);

  // Image-paste handler — mirrors EditorPane.handleImageConfirm. Reads the
  // same imageUploader strategies so files land in the same vault
  // `assets/images/` directory as markdown editor pastes, then splices the
  // `![](url)` markdown into the focused row's text at the caret.
  const handleImageConfirm = useCallback(
    async (config: ImageSaveConfig) => {
      if (!imagePasteFile) return;
      try {
        const strategy = getStrategy(config.target);
        const originalFormat = imagePasteFile.type.split('/')[1] as string;
        const needsConversion = config.format !== originalFormat;
        const base64 = needsConversion
          ? await convertImageFormat(imagePasteFile, config.format)
          : await fileToBase64(imagePasteFile);
        const result = await strategy.upload(base64, config, vaultRoot, filePath);
        const encodedUrl = result.markdownUrl.split('/').map(encodeURIComponent).join('/');
        const hasCustomSize = config.width || config.height;
        const imageMarkdown = hasCustomSize
          ? `<img src="${encodedUrl}" alt="${config.fileName}"${config.width ? ` width="${config.width}"` : ''}${config.height ? ` height="${config.height}"` : ''} />`
          : `![${config.fileName}](${encodedUrl})`;
        const { idx, caret } = pasteTargetRef.current;
        const line = lines[idx];
        if (!line) return;
        const newText = line.text.slice(0, caret) + imageMarkdown + line.text.slice(caret);
        // Re-focus the row and place the caret at the end of the inserted
        // markdown after the next paint.
        focusIdxRef.current = idx;
        focusCaretRef.current = caret + imageMarkdown.length;
        updateLineText(idx, newText);
      } catch (error) {
        console.error('[ImageUpload] Failed:', error);
      } finally {
        URL.revokeObjectURL(imagePastePreviewUrl);
        setImagePasteVisible(false);
        setImagePasteFile(null);
        setImagePastePreviewUrl('');
      }
    },
    [imagePasteFile, imagePastePreviewUrl, vaultRoot, filePath, lines, updateLineText],
  );

  const handleImageCancel = useCallback(() => {
    URL.revokeObjectURL(imagePastePreviewUrl);
    setImagePasteVisible(false);
    setImagePasteFile(null);
    setImagePastePreviewUrl('');
  }, [imagePastePreviewUrl]);

  // ponytail: precompute previous visible row's depth per row for the
  // landing-segment heuristic (pass 2 of tree-line drawing). O(n) once per
  // render instead of O(n) per visible row. -1 = no previous visible row
  // (root, or first visible row after only hidden rows above).
  const prevVisibleDepth: number[] = new Array(lines.length).fill(-1);
  {
    let prev = -1;
    for (let i = 0; i < lines.length; i++) {
      if (hiddenIdx.has(i)) continue;
      prevVisibleDepth[i] = prev;
      prev = lines[i].depth;
    }
  }

  const hasChildren = (idx: number) =>
    idx + 1 < lines.length && lines[idx + 1].depth > lines[idx].depth;

  const toggleCollapse = (idx: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden editor-mmap bg-surf">
      <div className="flex-1 overflow-auto px-6 py-4">
        {lines.map((line, idx) => {
          if (hiddenIdx.has(idx)) return null;
          const isCollapsed = collapsed.has(idx);
          const hasKids = hasChildren(idx);
          return (
            <div
              key={idx}
              className="group relative flex items-start gap-1 rounded-[3px] min-h-[30px] transition-colors duration-100 hover:bg-hov/40"
              style={{ paddingLeft: `${line.depth === 0 ? 4 : Math.max(line.depth - 1, 0) * 16}px` }}
            >
              {/* Tree connecting lines.
                  Pass 1: per-ancestor verticals (a from 1 to depth-1) at the
                  ancestor's bullet column. Always full height — the line
                  runs through the subtree and off the bottom of the last
                  descendant, where the next sibling's landing segment (pass
                  2) picks it up. Skip a=0 (root — no bullet column). */}
              {Array.from({ length: Math.max(line.depth - 1, 0) }, (_, k) => k + 1).map((a) => {
                const parentCol = (a - 1) * 16 + BULLET_CENTER_OFFSET;
                return (
                  <span
                    key={`v${a}`}
                    className="absolute pointer-events-none border-l border-brd"
                    style={{ left: `${parentCol}px`, top: -6, bottom: 0 }}
                  />
                );
              })}
              {/* Pass 2: landing segment. When the previous visible row was
                  deeper than this row, a subtree at this row's depth ended
                  above and this row is the next sibling — draw a half-height
                  vertical at this row's own bullet column to land the line
                  coming from above onto this row's bullet. Skip depth 0
                  (root has no bullet column). */}
              {line.depth > 0 && prevVisibleDepth[idx] > line.depth && (
                <span
                  className="absolute pointer-events-none border-l border-brd"
                  style={{
                    left: `${(line.depth - 1) * 16 + BULLET_CENTER_OFFSET}px`,
                    top: -6,
                    height: `${ROW_HALF_HEIGHT}px`,
                  }}
                />
              )}
              {/* Hover-triggered action zone (fold toggle only, only when row
                  has children). Invisible by default to keep the clean look;
                  reveals on row hover. Always takes layout space so the bullet
                  column stays aligned across rows. The zone itself is the
                  chevron's first-line centering box: h-[30px] matches the row
                  min-height and the textarea's first-line center (py-[3px] +
                  half of 14*1.7 ≈ 15px), so items-center puts the chevron on
                  the first text line. */}
              {/* ponytail: tree lines are absolute, default z-index — they
                  would paint over the static-positioned textarea/images. Give
                  every content wrapper `relative z-10` so text + images stack
                  above the vertical branch lines. */}
              {line.depth > 0 && (
                <div className="relative z-10 flex items-center justify-start w-2 h-[30px] self-start shrink-0">
                  {/* Root (depth 0) renders no chevron — root is an implicit
                      container, not a collapsable item. Spacer keeps the
                      textarea column aligned with child rows. */}
                  {hasKids ? (
                    <button
                      type="button"
                      onClick={() => toggleCollapse(idx)}
                      className="flex items-center justify-start w-[16px] h-[16px] text-t1"
                      title={isCollapsed ? '展开' : '折叠'}
                    >
                      <svg
                        width="8"
                        height="8"
                        viewBox="0 0 8 8"
                        fill="currentColor"
                        style={{
                          transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                          transition: 'transform 100ms',
                          transformOrigin: '50% 50%',
                        }}
                      >
                        {/* ponytail: solid right-pointing triangle (collapsed).
                            Rotated 90deg → down-pointing (expanded). Fill currentColor
                            inherits text-t1 from the button. */}
                        <polygon points="1.5,1 6.5,4 1.5,7" />
                      </svg>
                    </button>
                  ) : null}
                </div>
              )}
              {line.depth > 0 && (
                <div className="relative z-10 self-start h-[30px] flex items-center justify-center shrink-0">
                  <span className="w-[4px] h-[4px] rounded-full bg-t1 shrink-0" />
                </div>
              )}
              <textarea
                ref={(el) => {
                  taRefs.current[idx] = el;
                }}
                // ponytail: use `!== undefined` not truthy — an empty-string
                // note (user just pressed Shift+Enter, hasn't typed note body
                // yet) must still render the `\n` separator. A truthy check
                // would strip the newline and Shift+Enter would appear to do
                // nothing. `note` is `undefined` only when no `\n` was ever
                // inserted.
                value={line.text + (line.note !== undefined ? '\n' + line.note : '')}
                onChange={(e) => updateLineText(idx, e.target.value)}
                onPaste={(e) => {
                  // ponytail: mirror markdown editor's image-paste detection.
                  // Textareas only accept text by default; intercept image
                  // items and route them through the same ImagePasteDialog +
                  // imageUploader flow as EditorPane.tsx.
                  const items = e.clipboardData?.items;
                  if (!items) return;
                  for (const item of Array.from(items)) {
                    if (item.type.startsWith('image/')) {
                      e.preventDefault();
                      const file = item.getAsFile();
                      if (!file) return;
                      const ta = e.currentTarget;
                      const previewUrl = URL.createObjectURL(file);
                      pasteTargetRef.current = {
                        idx,
                        caret: ta.selectionStart,
                      };
                      setImagePasteFile(file);
                      setImagePastePreviewUrl(previewUrl);
                      setImagePasteVisible(true);
                      return;
                    }
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Tab') {
                    e.preventDefault();
                    changeDepth(idx, e.shiftKey ? -1 : 1);
                  } else if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    splitLine(idx, e.currentTarget.selectionStart);
                  } else if (e.key === 'Backspace') {
                    const ta = e.currentTarget;
                    const atStart =
                      ta.selectionStart === 0 && ta.selectionEnd === 0;
                    if (!atStart) return; // mid-text — default backspace
                    // Root (no previous visible row) — don't intercept.
                    const hidden = computeHiddenIdx(lines, collapsed);
                    let hasPrev = false;
                    for (let i = idx - 1; i >= 0; i--) {
                      if (!hidden.has(i)) {
                        hasPrev = true;
                        break;
                      }
                    }
                    if (!hasPrev) return;
                    e.preventDefault();
                    backspaceAtStart(idx);
                  }
                }}
                onFocus={() => {
                  focusIdxRef.current = idx;
                }}
                rows={1}
                placeholder="输入文字"
                style={{ color: 'var(--t1)', caretColor: 'var(--t1)', fontSize: `${line.depth === 0 ? editorFontSize + 4 : editorFontSize}px`, fontWeight: line.depth === 0 ? 'bold' : 'normal', position: 'relative', zIndex: 10 }}
                className={
                  'flex-1 resize-none bg-transparent outline-none text-t1 leading-[1.7] py-[3px] px-[4px] rounded-[3px] overflow-hidden transition-colors duration-100 placeholder:text-t3 placeholder:opacity-50 focus:bg-surf/60 '
                }
              />
            </div>
          );
        })}
      </div>
      {renderMetaSection(lines[0]?.meta, metaCollapsed, () =>
        setMetaCollapsed((v) => !v),
      )}
      <ImagePasteDialog
        visible={imagePasteVisible}
        previewUrl={imagePastePreviewUrl}
        currentFilePath={filePath}
        vaultRoot={vaultRoot}
        onConfirm={handleImageConfirm}
        onCancel={handleImageCancel}
      />
    </div>
  );
}
