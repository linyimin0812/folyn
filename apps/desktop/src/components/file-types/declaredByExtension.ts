import { extensionHost } from '@folyn/extension-host';

/**
 * True when an installed extension declares `ext` (no dot) in its
 * `contributes.fileTypes`, whether or not it is active right now — it may be
 * disabled or still waiting for approval. Such a file needs that extension to
 * render: while no handler claims it, the host shows it as unsupported
 * instead of opening the raw text in the code editor.
 */
export function isDeclaredByInstalledExtension(ext: string): boolean {
  const wanted = ext.toLowerCase();
  return extensionHost.list().some((record) =>
    (record.manifest.contributes?.fileTypes ?? []).some((ft) =>
      ft.extensions.some((e) => e.replace(/^\./, '').toLowerCase() === wanted),
    ),
  );
}
