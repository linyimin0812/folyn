import {
  acceptCompletion,
  closeCompletion,
  moveCompletionSelection,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { Transaction, type EditorState } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { buildPathCompletion } from './pathCompletion';

const SRC_ATTR_RE = /:::file-preview\b[^{]*\{[^}]*?src="([^"]*)$/;

/** Locate the `src="..."` partial being typed before `pos`, and its document
 *  offset. Shared by the completion source and the search-box plugin. */
function srcPartialAt(state: EditorState, pos: number): { start: number; text: string } | null {
  const windowStart = Math.max(0, pos - 500);
  const before = state.sliceDoc(windowStart, pos);
  const m = before.match(SRC_ATTR_RE);
  if (!m) return null;
  return { start: windowStart + (m.index ?? 0) + m[0].length - m[1].length, text: m[1] };
}

/**
 * Adds a search input pinned to the top of the src-completion dropdown.
 * Typing in the input rewrites the document's src partial (annotated as user
 * typing, so completion re-filters exactly as if typed in the editor); arrow
 * keys and Enter drive the option list while focus stays in the input.
 *
 * ponytail: focus bookkeeping — CodeMirror rebuilds the tooltip DOM whenever
 * the result object changes (e.g. crossing the no-`/` ↔ `dir/` branch
 * boundary), which detaches and remounts this input. `hadFocus` survives the
 * rebuild so the remounted input gets its focus back; it is cleared the
 * moment focus lands anywhere else.
 */
export function filePreviewSrcSearchBox() {
  return ViewPlugin.fromClass(
    class {
      box: HTMLDivElement | null = null;
      input: HTMLInputElement | null = null;
      hadFocus = false;
      readonly onFocusIn = (e: FocusEvent) => {
        const t = e.target as Node;
        if (this.input && t === this.input) {
          this.hadFocus = true;
          return;
        }
        this.hadFocus = false;
        // closeOnBlur is disabled for this editor's autocompletion so the
        // dropdown survives focusing the search box; compensate by closing
        // when focus moves outside the editor entirely. Tooltips live on
        // document.body (so they can overlay the preview pane), hence the
        // explicit .cm-tooltip exemption.
        if (
          !this.view.dom.contains(t) &&
          !(t instanceof HTMLElement && t.closest('.cm-tooltip'))
        ) {
          closeCompletion(this.view);
        }
      };
      readonly onMouseDown = (e: MouseEvent) => {
        // Clicking a non-focusable area fires no focusin — close via
        // mousedown as well so the dropdown never lingers. Clicks inside the
        // tooltip itself (e.g. picking an option) must not close it — CM
        // applies the pick on the same mousedown.
        const t = e.target;
        if (
          !this.view.dom.contains(t as Node) &&
          !(t instanceof HTMLElement && t.closest('.cm-tooltip'))
        ) {
          this.hadFocus = false;
          closeCompletion(this.view);
        }
      };

      constructor(readonly view: EditorView) {
        document.addEventListener('focusin', this.onFocusIn);
        document.addEventListener('mousedown', this.onMouseDown);
      }

      update() {
        this.sync();
      }

      destroy() {
        document.removeEventListener('focusin', this.onFocusIn);
        document.removeEventListener('mousedown', this.onMouseDown);
        this.box?.remove();
      }

      sync() {
        // Tooltips are mounted on document.body (tooltips({parent}) in
        // EditorView), not inside view.dom — search the whole document.
        const tooltip = document.querySelector<HTMLElement>('.cm-tooltip-autocomplete');
        if (!tooltip) {
          this.box = null;
          this.input = null;
          return;
        }
        if (!this.box || this.box.parentElement !== tooltip) this.mount(tooltip);
        // Two-way sync: if the user typed in the editor instead of the box,
        // reflect the current partial in the (unfocused) input.
        const partial = srcPartialAt(this.view.state, this.view.state.selection.main.head);
        if (
          partial && this.input &&
          document.activeElement !== this.input && this.input.value !== partial.text
        ) {
          this.input.value = partial.text;
        }
      }

      mount(tooltip: HTMLElement) {
        const box = document.createElement('div');
        box.className = 'cm-src-search-box';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '搜索文件…';
        const partial = srcPartialAt(this.view.state, this.view.state.selection.main.head);
        if (partial) input.value = partial.text;

        box.addEventListener('mousedown', (e) => {
          // Don't let the click move the editor selection; just focus the box.
          e.preventDefault();
          input.focus();
        });
        input.addEventListener('input', () => {
          const p = srcPartialAt(this.view.state, this.view.state.selection.main.head);
          if (!p) return;
          this.view.dispatch({
            changes: { from: p.start, to: p.start + p.text.length, insert: input.value },
            selection: { anchor: p.start + input.value.length },
            // Annotated as typing so completion re-filters / re-opens.
            annotations: Transaction.userEvent.of('input.type'),
          });
        });
        input.addEventListener('keydown', (e) => {
          const run = (cmd: (v: EditorView) => boolean) => {
            if (cmd(this.view)) {
              e.preventDefault();
              e.stopPropagation();
            }
          };
          if (e.key === 'ArrowDown') run((v) => moveCompletionSelection(true)(v));
          else if (e.key === 'ArrowUp') run((v) => moveCompletionSelection(false)(v));
          else if (e.key === 'Enter') {
            run(acceptCompletion);
            requestAnimationFrame(() => {
              // File picked → dropdown closed → hand focus back to the
              // editor. Dir picked → dropdown reopened on the new dir →
              // refresh the box with the post-apply partial.
              if (!document.querySelector('.cm-tooltip-autocomplete')) {
                this.hadFocus = false;
                this.view.focus();
                return;
              }
              const p = srcPartialAt(this.view.state, this.view.state.selection.main.head);
              if (p && this.input) this.input.value = p.text;
            });
          } else if (e.key === 'Escape') {
            this.hadFocus = false;
            closeCompletion(this.view);
            this.view.focus();
          }
        });

        box.appendChild(input);
        tooltip.prepend(box);
        this.box = box;
        this.input = input;
        // The tooltip was rebuilt while the user was typing in the box —
        // hand focus (and the caret) back to the fresh input.
        if (this.hadFocus) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      }
    },
  );
}

/**
 * Factory: returns a completion source for the `src` attribute of
 * `:::file-preview{src="..."}` directives, closing over the current document's
 * `filePath` so `./` and `../` resolve relative to the document's directory.
 */
export function createFilePreviewSrcCompletion(filePath: string) {
  return async function filePreviewSrcCompletion(ctx: CompletionContext): Promise<CompletionResult | null> {
    const found = srcPartialAt(ctx.state, ctx.pos);
    if (!found) return null;
    const result = await buildPathCompletion(found.text, found.start, ctx.pos, filePath, false);
    if (!result) return null;
    return { from: result.from, to: result.to, options: result.options, validFor: result.validFor };
  };
}
