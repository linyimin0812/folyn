import { Extension } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import type { EditorView } from '@tiptap/pm/view';

// ponytail: no @tiptap/suggestion, no tippy.js. The slash trigger is detected
// from editor state on every transaction (RichTextEditor subscribes to
// `editor.on('transaction', ...)`, computes the new SlashCommandState via
// computeSlashState, and re-renders <RichTextSlashMenu>). This mirrors the
// CodeMirror side's SlashCommandExtension.ts — same trigger rules, no extra
// deps. The trigger predicate is a pure function so it's unit-testable without
// mounting a real prosemirror view (jsdom can't host one — same ceiling as
// RichTextImage / ErDiagramX6 per file-type-editors.md).

export interface SlashCommandState {
  visible: boolean;
  /** Doc range of the "/<filter>" text — deleted when a command is selected. */
  rangeFrom: number;
  rangeTo: number;
  filter: string;
}

export const INITIAL_SLASH_STATE: SlashCommandState = {
  visible: false,
  rangeFrom: 0,
  rangeTo: 0,
  filter: '',
};

/** Typed accessor — Tiptap's Storage interface is intentionally empty. */
export function getSlashState(editor: Editor): SlashCommandState {
  return ((editor.storage as unknown as Record<string, unknown>).slashCommand as SlashCommandState | undefined) ?? INITIAL_SLASH_STATE;
}

export function writeSlashState(editor: Editor, state: SlashCommandState): void {
  (editor.storage as unknown as Record<string, unknown>).slashCommand = state;
}

/**
 * Inspect the text before the cursor on the current line. Return the slash
 * trigger context if `/` is at line-start or after whitespace, not part of a
 * self-closing HTML tag (`/>`), and (when filter text exists) the filter
 * contains no whitespace. Otherwise null.
 *
 * Mirrors SlashCommandExtension.ts's trigger rules. Lifted as a pure function
 * so it's unit-testable without a prosemirror view (jsdom ceiling).
 */
export function findSlashTrigger(textBefore: string): {
  triggerFrom: number;
  filter: string;
} | null {
  const slashIdx = textBefore.lastIndexOf('/');
  if (slashIdx === -1) return null;
  const charBeforeSlash = slashIdx > 0 ? textBefore[slashIdx - 1] : '\n';
  const isAtLineStart =
    slashIdx === 0 ||
    charBeforeSlash === ' ' ||
    charBeforeSlash === '\t' ||
    charBeforeSlash === '\n';
  if (!isAtLineStart) return null;
  const afterSlash = textBefore.slice(slashIdx + 1);
  if (afterSlash.startsWith('>')) return null;
  if (/\s/.test(afterSlash)) return null;
  return {
    triggerFrom: slashIdx,
    filter: afterSlash,
  };
}

/** Text content of the parent block (paragraph/heading/etc) before the cursor. */
function textBeforeCursor(view: EditorView): { text: string; $headPos: number; parentOffset: number } {
  const $head = view.state.selection.$head;
  return {
    text: $head.parent.textContent.slice(0, $head.parentOffset),
    $headPos: $head.pos,
    parentOffset: $head.parentOffset,
  };
}

/** Recompute the slash menu state from the current editor state. */
export function computeSlashState(editor: Editor): SlashCommandState {
  const view = editor.view;
  const { text, $headPos, parentOffset } = textBeforeCursor(view);
  const trigger = findSlashTrigger(text);
  if (!trigger) return INITIAL_SLASH_STATE;
  return {
    visible: true,
    rangeFrom: $headPos - parentOffset + trigger.triggerFrom,
    rangeTo: $headPos,
    filter: trigger.filter,
  };
}

/**
 * Delete the "/<filter>" text range, then run a block command. Called by the
 * menu when the user picks an item. Returns true on success.
 */
export function applySlashCommand(
  editor: Editor,
  state: SlashCommandState,
  run: (chain: ReturnType<typeof editor.chain>) => void,
): boolean {
  if (!editor.isEditable) return false;
  const chain = editor.chain().focus().deleteRange({ from: state.rangeFrom, to: state.rangeTo });
  run(chain);
  chain.run();
  return true;
}

/**
 * Minimal extension: holds storage for slash state (so React subscribers can
 * read `editor.storage.slashCommand` after the transaction listener computes
 * it) and registers the `Mod-/` keyboard shortcut that inserts a `/` at the
 * cursor — the inserted `/` is detected by `computeSlashState` on the next
 * transaction, opening the menu. This is the "trigger button" behavior the
 * Tiptap doc describes, without the doc's `react-hotkeys-hook` dep.
 */
export const RichTextSlashExtension = Extension.create<unknown, SlashCommandState>({
  name: 'slashCommand',
  addStorage() {
    return { ...INITIAL_SLASH_STATE };
  },
  addKeyboardShortcuts() {
    return {
      'Mod-/': () => {
        const editor = this.editor;
        if (!editor.isEditable) return false;
        return editor.chain().focus().insertContent('/').run();
      },
    };
  },
});
