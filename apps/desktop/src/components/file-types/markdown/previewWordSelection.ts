const BLOCK_SELECTOR = 'p,li,dt,dd,td,th,h1,h2,h3,h4,h5,h6,pre,figcaption';
const INTERACTIVE_SELECTOR = 'button,input,textarea,select,[contenteditable="true"]';
const words = new Intl.Segmenter(undefined, { granularity: 'word' });

/** Resolve word boundaries without WebKit's Range.expand, which can jump to a newline. */
export function previewWordRange(root: HTMLElement, x: number, y: number): Range | null {
  const doc = root.ownerDocument as Document & {
    caretRangeFromPoint(x: number, y: number): Range | null;
  };
  const caret = doc.caretRangeFromPoint(x, y);
  if (!caret || caret.startContainer.nodeType !== Node.TEXT_NODE) return null;
  const hit = caret.startContainer as Text;
  if (!hit.length || !root.contains(hit) || hit.parentElement?.closest(INTERACTIVE_SELECTOR)) return null;
  // A caret in the right half of a glyph sits AFTER that character. Resolve
  // the painted glyph before segmentation, especially at a word's last letter.
  let hitOffset = Math.min(caret.startOffset, hit.length - 1);
  if (caret.startOffset > 0) {
    const glyph = doc.createRange();
    glyph.setStart(hit, caret.startOffset - 1);
    glyph.setEnd(hit, caret.startOffset);
    if (Array.from(glyph.getClientRects()).some((rect) =>
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) {
      hitOffset = caret.startOffset - 1;
    }
  }
  const block = hit.parentElement?.closest(BLOCK_SELECTOR) ?? hit.parentElement;
  if (!block || !root.contains(block)) return null;

  // Join inline formatting so a word split across <strong>/<code> stays whole.
  // Nested blocks and <br> are boundaries, never part of the clicked word.
  const nodes: { node: Text; start: number }[] = [];
  let text = '';
  let offset = -1;
  const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Element) {
      if (node.matches('br') || node.matches(BLOCK_SELECTOR)) text += '\n';
      continue;
    }
    if (!(node instanceof Text) || node.parentElement?.closest(INTERACTIVE_SELECTOR)) continue;
    if (block.matches(BLOCK_SELECTOR) && node.parentElement?.closest(BLOCK_SELECTOR) !== block) continue;
    nodes.push({ node, start: text.length });
    if (node === hit) offset = text.length + hitOffset;
    text += node.data;
  }
  if (offset < 0) return null;
  const word = words.segment(text).containing(offset);
  if (!word || !word.segment.trim()) return null;
  const start = word.index;
  const end = start + word.segment.length;
  const first = nodes.find((entry) => start >= entry.start && start < entry.start + entry.node.length);
  const last = nodes.find((entry) => end > entry.start && end <= entry.start + entry.node.length);
  if (!first || !last) return null;
  const range = doc.createRange();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start);
  return range;
}

/** Install a word-selection gesture scoped to this preview; returns listener cleanup. */
export function installPreviewWordSelection(root: HTMLElement): () => void {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  let word: Range | null = null;
  let releaseFrame = 0;
  const reset = () => {
    win.cancelAnimationFrame(releaseFrame);
    releaseFrame = 0;
    word = null;
  };
  const reassert = () => {
    if (!word || !root.contains(word.startContainer) || !root.contains(word.endContainer)) return reset();
    const selection = win.getSelection();
    if (!selection) return;
    const current = selection.rangeCount === 1 ? selection.getRangeAt(0) : null;
    if (current && current.compareBoundaryPoints(Range.START_TO_START, word) === 0
      && current.compareBoundaryPoints(Range.END_TO_END, word) === 0) return;
    selection.removeAllRanges();
    selection.addRange(word.cloneRange());
  };
  const down = (event: MouseEvent) => {
    if (event.button !== 0 || event.detail !== 2 || event.defaultPrevented) return;
    if (event.target instanceof Element && event.target.closest(INTERACTIVE_SELECTOR)) return;
    word = previewWordRange(root, event.clientX, event.clientY);
    if (!word) return;
    event.preventDefault();
    reassert();
  };
  const release = () => {
    if (!word) return;
    // Native selection updates may run AFTER mouseup/dblclick dispatch.
    // Keep the word until the next frame, then let later gestures work normally.
    win.cancelAnimationFrame(releaseFrame);
    releaseFrame = win.requestAnimationFrame(() => { reassert(); reset(); });
  };
  doc.addEventListener('mousedown', reset, true);
  root.addEventListener('mousedown', down);
  doc.addEventListener('selectionchange', reassert);
  doc.addEventListener('mouseup', release);
  root.addEventListener('dblclick', release);
  win.addEventListener('blur', reset);
  return () => {
    reset();
    doc.removeEventListener('mousedown', reset, true);
    root.removeEventListener('mousedown', down);
    doc.removeEventListener('selectionchange', reassert);
    doc.removeEventListener('mouseup', release);
    root.removeEventListener('dblclick', release);
    win.removeEventListener('blur', reset);
  };
}
