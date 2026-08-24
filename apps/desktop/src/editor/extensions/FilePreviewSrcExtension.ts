import {
  acceptCompletion,
  closeCompletion,
  moveCompletionSelection,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { Transaction, type EditorState } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { useVaultStore } from '@/store/vaultStore';
import { flattenFileTree } from '@/utils/treeUtils';
import type { VaultEntry } from '@folyn/vault-provider';

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

/** Insert `insert` over [from, to) and CLOSE the dropdown. Deliberately NOT
 *  annotated as a user event — CodeMirror's default string-apply dispatches
 *  with userEvent "input.complete", which re-triggers completion after every
 *  pick and leaves the dropdown open on the just-inserted path. */
function applyFileAndClose(insert: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
    });
    closeCompletion(view);
  };
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
 *
 * Behavior:
 * - partial has no `/` → global search across all vault files. Options carry
 *   the full path as their label so CodeMirror's built-in fuzzy matcher
 *   (subsequence match with word-boundary bonuses) filters AND ranks them
 *   client-side — the result stays valid while typing, so the dropdown never
 *   tears down per keystroke.
 * - partial has `/` → list immediate children of the resolved directory.
 *   Directories apply with a trailing `/` so the user can keep drilling.
 */
export function createFilePreviewSrcCompletion(filePath: string) {
  return function filePreviewSrcCompletion(ctx: CompletionContext): CompletionResult | null {
    const found = srcPartialAt(ctx.state, ctx.pos);
    if (!found) return null;

    const partial = found.text;
    const partialStart = found.start;

    const slashIdx = Math.max(partial.lastIndexOf('/'), partial.lastIndexOf('\\'));
    if (slashIdx === -1) {
      // No `/` → global search. Full path as label: CodeMirror fuzzy-matches
      // and ranks against it per keystroke, and the match highlighting shows
      // exactly which part of the path matched. No result cap — CodeMirror
      // only renders maxRenderedOptions (100) rows.
      const fileTree = useVaultStore.getState().fileTree;
      const options = flattenFileTree(fileTree).map((f) => ({
        label: f.path,
        apply: applyFileAndClose(f.path),
        type: 'file' as const,
      }));
      // ponytail: stay valid while the query has no `/` — client-side
      // filtering handles narrowing, so no re-query (and no tooltip rebuild)
      // happens per keystroke. A `/` transitions to the dir branch below.
      return {
        from: partialStart,
        to: ctx.pos,
        options,
        validFor: (text: string) => !/[/\\]/.test(text),
      };
    }

    const dirPart = partial.slice(0, slashIdx + 1);
    const dirPath = resolveDirPart(dirPart, filePath);
    if (dirPath === null) return null;

    const fileTree = useVaultStore.getState().fileTree;
    const children = findDirChildren(fileTree, dirPath);
    if (!children) return null;

    // ponytail: `from` is the position AFTER the last `/` in the partial, so
    // CodeMirror's fuzzy matcher uses just the segment after it as the
    // pattern. `apply` is the bare child name so picking replaces only that
    // segment and preserves the typed directory prefix (e.g. `./<dir>/`).
    // No `detail`: every row shares the same resolved dir, so a per-row
    // detail would repeat the identical path on every line.
    const filterStart = partialStart + slashIdx + 1;
    const options = children.map((c): Completion =>
      c.type === 'dir'
        ? {
            label: c.name + '/',
            // Custom apply: drilling into a dir must KEEP the dropdown open
            // with that dir's children (the default string-apply would just
            // dismiss it). The inserted text is annotated as user typing, so
            // completion immediately re-queries against the new dir — exactly
            // as if the user had typed `name/` by hand.
            apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
              const insert = c.name + '/';
              view.dispatch({
                changes: { from, to, insert },
                selection: { anchor: from + insert.length },
                annotations: Transaction.userEvent.of('input.type'),
              });
            },
            type: 'dir' as const,
          }
        : { label: c.name, apply: applyFileAndClose(c.name), type: 'file' as const },
    );
    // ponytail: invalidate when the directory part of the partial changes
    // (drilling into a subdir must re-query). Filter-only typing within the
    // same dir reuses the result, so the popup doesn't rebuild per keystroke.
    const validFor = (_text: string, _from: number, to: number, state: EditorState) => {
      const currentPartial = state.sliceDoc(partialStart, to);
      const newSlash = Math.max(currentPartial.lastIndexOf('/'), currentPartial.lastIndexOf('\\'));
      return currentPartial.slice(0, newSlash + 1) === dirPart;
    };
    return { from: filterStart, to: ctx.pos, options, validFor };
  };
}

/**
 * Resolve a `dirPart` (with trailing `/`) to a vault-relative directory path.
 * Returns null for absolute `/` or `~`-prefixed paths (no vault-inside-home
 * completion — matches the existing early-return).
 *
 * ponytail: segment-walk loop — handles N-level `../../`, replacing the old
 * single-level `../` slice. Bare paths (no `./` or `../` prefix) stay
 * vault-relative, matching the runtime resolver in FilePreviewPlugin.tsx.
 */
function resolveDirPart(dirPart: string, filePath: string): string | null {
  if (dirPart.startsWith('/') || dirPart.startsWith('~')) return null;
  // Bare path (no ./ ../ prefix) → vault-relative.
  if (
    !dirPart.startsWith('./') && !dirPart.startsWith('.\\') &&
    !dirPart.startsWith('../') && !dirPart.startsWith('..\\')
  ) {
    return dirPart;
  }
  const fileDir = filePath ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
  const segments = fileDir.split('/').filter(Boolean);
  const parts = dirPart.replace(/\\/g, '/').split('/').filter((s) => s !== '.' && s !== '');
  for (const seg of parts) {
    if (seg === '..') segments.pop();
    else segments.push(seg);
  }
  return segments.join('/');
}

/** Walk `tree` by `/`-separated segments to find the target directory's
 *  immediate children. Returns null if the directory is not found. */
function findDirChildren(tree: VaultEntry[], dirPath: string): VaultEntry[] | null {
  if (!dirPath) return tree;
  const segs = dirPath.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean);
  let nodes: VaultEntry[] | undefined = tree;
  for (const seg of segs) {
    const found: VaultEntry | undefined = nodes?.find((n) => n.type === 'dir' && n.name === seg);
    if (!found) return null;
    nodes = found.children;
  }
  return nodes ?? null;
}
