import { type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { useVaultStore } from '@/store/vaultStore';
import { flattenFileTree } from '@/utils/treeUtils';

/**
 * Completion source for the `src` attribute of `:::file-preview{src="..."}`
 * directives. Suggests files from the current vault's file tree, filtered
 * by the partial path typed inside the quotes.
 */
export function filePreviewSrcCompletion(ctx: CompletionContext): CompletionResult | null {
  const windowStart = Math.max(0, ctx.pos - 500);
  const textBefore = ctx.state.sliceDoc(windowStart, ctx.pos);
  const m = textBefore.match(/:::file-preview\b[^{]*\{[^}]*?src="([^"]*)$/);
  if (!m) return null;

  const partial = m[1];
  const partialStart = windowStart + (m.index ?? 0) + m[0].length - m[1].length;

  const fileTree = useVaultStore.getState().fileTree;
  const files = flattenFileTree(fileTree);
  const lower = partial.toLowerCase();
  const filtered = partial
    ? files.filter(
        (f) => f.path.toLowerCase().includes(lower) || f.name.toLowerCase().includes(lower),
      )
    : files;

  // ponytail: cap at 50 matches — vault can have thousands of files, the
  // dropdown is unusable past that. Replace with ranked/scored search
  // (fuzzy, recency) if/when the cap bites.
  const options = filtered.slice(0, 50).map((f) => ({
    label: f.name,
    detail: f.path,
    apply: f.path,
    type: 'file' as const,
  }));

  return {
    from: partialStart,
    to: ctx.pos,
    options,
    validFor: /[^"\s{}=]*/,
  };
}
