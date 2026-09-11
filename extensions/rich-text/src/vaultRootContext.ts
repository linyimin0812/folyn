import { createContext, useContext } from 'react';

// ponytail: vaultRoot is projected by the host shell into EditorProps
// (Phase 1). RichTextEditor reads it from props and provides it via this
// context so the tiptap NodeView (RichTextImageView) and the toolbar — both
// rendered inside the editor's React subtree but NOT direct EditorProps
// consumers — can resolve vault-relative image srcs without touching the
// host's vaultStore. One context, one value; mirrors how MarkdownPreview
// threads resolvedVaultRoot as local state, just shared across the subtree.
export const VaultRootContext = createContext<string>('');

export function useVaultRoot(): string {
  return useContext(VaultRootContext);
}
