import { EditorState, Transaction, Annotation, ChangeSet } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';

/**
 * Matches an ordered list item header line: optional indent, number, dot, space.
 * e.g. "1. foo", "  2. bar"
 */
const OL_ITEM_RE = /^(\s*)(\d+)\.\s/;

/**
 * Continuation line indent: the indent used for wrapped content under a list item.
 * We use 3 spaces (aligns with "1. " prefix width).
 */
const CONTINUATION_INDENT = '   ';

/** Annotation to mark renumber transactions so we don't re-process them */
const renumberAnnotation = Annotation.define<boolean>();

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Given a line number, walk backwards to find the list item header line
 * that owns this line (either the header itself, or a continuation line).
 * Returns null if the line is not part of an ordered list item.
 */
function findOwnerItemLine(doc: EditorState['doc'], lineNum: number): { lineNum: number; indent: string; number: number } | null {
  const totalLines = doc.lines;
  if (lineNum < 1 || lineNum > totalLines) return null;

  const line = doc.line(lineNum);
  const headerMatch = line.text.match(OL_ITEM_RE);
  if (headerMatch) {
    return { lineNum, indent: headerMatch[1], number: parseInt(headerMatch[2], 10) };
  }

  // Walk backwards looking for the owning header
  for (let num = lineNum - 1; num >= 1; num--) {
    const prevLine = doc.line(num);
    const prevMatch = prevLine.text.match(OL_ITEM_RE);
    if (prevMatch) {
      // Check that every line between prevLine and lineNum is a continuation
      const itemIndent = prevMatch[1];
      const continuationPrefix = itemIndent + CONTINUATION_INDENT;
      let allContinuation = true;
      for (let between = num + 1; between <= lineNum; between++) {
        const betweenText = doc.line(between).text;
        if (!betweenText.startsWith(continuationPrefix) && betweenText.trim() !== '') {
          allContinuation = false;
          break;
        }
      }
      if (allContinuation) {
        return { lineNum: num, indent: prevMatch[1], number: parseInt(prevMatch[2], 10) };
      }
      return null;
    }
    // If we hit a non-continuation, non-header line, stop
    const prevText = prevLine.text;
    if (prevText.trim() !== '' && !OL_ITEM_RE.test(prevText)) break;
  }
  return null;
}

/**
 * Check if a line is a continuation line (indented content under a list item).
 */
function isContinuationLine(text: string, itemIndent: string): boolean {
  return text.startsWith(itemIndent + CONTINUATION_INDENT) && !OL_ITEM_RE.test(text);
}

// ── Renumber logic ────────────────────────────────────────────────────────────

/**
 * Collect all list item header line numbers in the same block as the given line.
 * A "block" must start with item number 1. If the block doesn't start at 1,
 * we return an empty array to skip renumbering (avoids corrupting isolated items like "3. foo").
 */
function collectBlockItemLines(doc: EditorState['doc'], startLineNum: number): number[] {
  const totalLines = doc.lines;
  const startLine = doc.line(startLineNum);
  const headerMatch = startLine.text.match(OL_ITEM_RE);
  if (!headerMatch) return [];

  const blockIndent = headerMatch[1];

  // Walk backwards to find block start (only follow contiguous list items at same indent)
  let blockFirstItem = startLineNum;
  let scanLine = startLineNum - 1;
  while (scanLine >= 1) {
    const text = doc.line(scanLine).text;
    const prevMatch = text.match(OL_ITEM_RE);
    if (prevMatch && prevMatch[1] === blockIndent) {
      blockFirstItem = scanLine;
      scanLine--;
    } else if (isContinuationLine(text, blockIndent)) {
      // Continuation lines belong to the item above — keep scanning
      scanLine--;
    } else {
      break;
    }
  }

  // The block must start at item number 1; otherwise skip renumbering
  const firstItemMatch = doc.line(blockFirstItem).text.match(OL_ITEM_RE);
  if (!firstItemMatch || parseInt(firstItemMatch[2], 10) !== 1) return [];

  // Walk forwards collecting header lines
  const itemLines: number[] = [];
  let current = blockFirstItem;
  while (current <= totalLines) {
    const text = doc.line(current).text;
    const match = text.match(OL_ITEM_RE);
    if (match && match[1] === blockIndent) {
      itemLines.push(current);
      current++;
      // Skip continuation lines belonging to this item
      while (current <= totalLines && isContinuationLine(doc.line(current).text, blockIndent)) {
        current++;
      }
    } else {
      break;
    }
  }

  return itemLines;
}

function computeRenumberChanges(
  newDoc: EditorState['doc'],
  changes: ChangeSet,
): { from: number; to: number; insert: string }[] | null {
  const totalLines = newDoc.lines;

  const changedLineNums = new Set<number>();
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const startLine = newDoc.lineAt(fromB).number;
    const endLine = newDoc.lineAt(Math.min(toB, newDoc.length)).number;
    for (let n = startLine; n <= endLine; n++) changedLineNums.add(n);
  });

  if (changedLineNums.size === 0) return null;

  const processedBlockStarts = new Set<number>();
  const renumberChanges: { from: number; to: number; insert: string }[] = [];

  for (const changedLineNum of changedLineNums) {
    if (changedLineNum > totalLines) continue;

    // Find the header line for this changed line
    const lineText = newDoc.line(changedLineNum).text;
    let headerLineNum: number;
    if (OL_ITEM_RE.test(lineText)) {
      headerLineNum = changedLineNum;
    } else {
      const owner = findOwnerItemLine(newDoc, changedLineNum);
      if (!owner) continue;
      headerLineNum = owner.lineNum;
    }

    const itemLines = collectBlockItemLines(newDoc, headerLineNum);
    if (itemLines.length === 0) continue;

    const blockStart = itemLines[0];
    if (processedBlockStarts.has(blockStart)) continue;
    processedBlockStarts.add(blockStart);

    // Check if renumbering is needed
    let needsRenumber = false;
    for (let idx = 0; idx < itemLines.length; idx++) {
      const line = newDoc.line(itemLines[idx]);
      const match = line.text.match(OL_ITEM_RE);
      if (!match || parseInt(match[2], 10) !== idx + 1) {
        needsRenumber = true;
        break;
      }
    }

    if (!needsRenumber) continue;

    for (let idx = 0; idx < itemLines.length; idx++) {
      const line = newDoc.line(itemLines[idx]);
      const match = line.text.match(OL_ITEM_RE);
      if (!match) continue;
      const expectedNumber = idx + 1;
      const currentNumber = parseInt(match[2], 10);
      if (currentNumber !== expectedNumber) {
        const numberStart = line.from + match[1].length;
        const numberEnd = numberStart + match[2].length;
        renumberChanges.push({ from: numberStart, to: numberEnd, insert: String(expectedNumber) });
      }
    }
  }

  return renumberChanges.length > 0 ? renumberChanges : null;
}

const orderedListTransactionFilter = EditorState.transactionFilter.of((tr: Transaction) => {
  if (!tr.docChanged || tr.annotation(renumberAnnotation)) return tr;

  const renumberChanges = computeRenumberChanges(tr.newDoc, tr.changes);
  if (!renumberChanges) return tr;

  const renumberChangeSet = ChangeSet.of(
    renumberChanges.map(({ from, to, insert }) => ({ from, to, insert })),
    tr.newDoc.length,
  );

  return [tr, {
    changes: renumberChangeSet,
    annotations: renumberAnnotation.of(true),
  }];
});

// ── Enter key handler ─────────────────────────────────────────────────────────

/**
 * Behaviour matrix for Enter key:
 *
 * Cursor on list item header line (e.g. "1. content"):
 *   - Item is empty ("1. ") → exit list: remove prefix, leave blank line
 *   - Item has content, cursor at end → insert next list item header ("2. ")
 *   - Item has content, cursor in middle → split: rest of line moves to next item
 *
 * Cursor on continuation line (e.g. "   more content"):
 *   - Continuation is empty ("   ") → insert next list item header
 *   - Continuation has content → insert another continuation line
 *
 * Shift+Enter on list item header → insert continuation line (indented, no number)
 */
function handleOrderedListEnter(view: EditorView): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  if (from !== to) return false; // Don't handle range selections

  const line = state.doc.lineAt(from);
  const cursorOffset = from - line.from;
  const headerMatch = line.text.match(OL_ITEM_RE);

  // ── Case 1: Cursor is on a list item header line ──────────────────────────
  if (headerMatch) {
    const indent = headerMatch[1];
    const prefixLength = headerMatch[0].length;
    const currentNumber = parseInt(headerMatch[2], 10);

    if (cursorOffset < prefixLength) return false; // Cursor inside prefix, don't handle

    const contentAfterCursor = line.text.slice(cursorOffset);
    const contentBeforeCursor = line.text.slice(prefixLength, cursorOffset);

    // Empty item → exit list
    if (contentBeforeCursor.trim() === '' && contentAfterCursor.trim() === '') {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: indent },
        selection: { anchor: line.from + indent.length },
      });
      return true;
    }

    // Has content → insert next list item header, moving text after cursor to new item
    const nextPrefix = `${indent}${currentNumber + 1}. `;
    view.dispatch({
      changes: { from, to: line.to, insert: `\n${nextPrefix}${contentAfterCursor}` },
      selection: { anchor: from + 1 + nextPrefix.length },
    });
    return true;
  }

  // ── Case 2: Cursor is on a continuation line ──────────────────────────────
  const owner = findOwnerItemLine(state.doc, line.number);
  if (!owner) return false;

  const { indent: itemIndent, number: ownerNumber } = owner;
  const continuationPrefix = itemIndent + CONTINUATION_INDENT;

  if (!line.text.startsWith(continuationPrefix)) return false;

  const contentAfterCursor = line.text.slice(cursorOffset);
  const contentOnLine = line.text.slice(continuationPrefix.length, cursorOffset);

  // Empty continuation → insert next list item header
  if (contentOnLine.trim() === '' && contentAfterCursor.trim() === '') {
    const nextPrefix = `${itemIndent}${ownerNumber + 1}. `;
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: nextPrefix },
      selection: { anchor: line.from + nextPrefix.length },
    });
    return true;
  }

  // Non-empty continuation → insert another continuation line
  view.dispatch({
    changes: { from, to: line.to, insert: `\n${continuationPrefix}${contentAfterCursor}` },
    selection: { anchor: from + 1 + continuationPrefix.length },
  });
  return true;
}

/**
 * Shift+Enter on a list item header → insert a continuation line (indented, no number).
 * This allows multi-line content under a single list item.
 */
function handleOrderedListShiftEnter(view: EditorView): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  if (from !== to) return false;

  const line = state.doc.lineAt(from);
  const cursorOffset = from - line.from;
  const headerMatch = line.text.match(OL_ITEM_RE);
  if (!headerMatch) return false;

  const indent = headerMatch[1];
  const prefixLength = headerMatch[0].length;
  if (cursorOffset < prefixLength) return false;

  const contentAfterCursor = line.text.slice(cursorOffset);
  const continuationPrefix = indent + CONTINUATION_INDENT;

  view.dispatch({
    changes: { from, to: line.to, insert: `\n${continuationPrefix}${contentAfterCursor}` },
    selection: { anchor: from + 1 + continuationPrefix.length },
  });
  return true;
}

const orderedListKeymap = keymap.of([
  { key: 'Shift-Enter', run: handleOrderedListShiftEnter },
  { key: 'Enter', run: handleOrderedListEnter },
]);

export const orderedListExtension = [orderedListTransactionFilter, orderedListKeymap];
