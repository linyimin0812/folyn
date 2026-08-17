import { isTauri } from '@/utils/platform';

// ponytail: a single document-level capture listener beats injecting a custom
// `a` component into the markdown pipeline — one listener covers every
// markdown render path (AiPanel, pet-panel, future plugin containers) and
// doesn't touch the renderMarkdownToReact component-override contract.
//
// Ceiling: anchors created from a separate JS realm (e.g. plugin iframe
// posting a message that triggers host-side navigation) won't be caught
// because the click still fires inside the iframe. Out of scope here.
export function installExternalLinkInterceptor(): () => void {
  if (!isTauri()) return () => {};

  const handler = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const anchor = target?.closest?.('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (!href) return;
    // Skip internal navigation: hash, SPA-relative, blob: (handled by
    // tauriBrowserShim's installAnchorDownloadInterceptor), and javascript:.
    if (
      href.startsWith('#') ||
      href.startsWith('/') ||
      href.startsWith('blob:') ||
      href.startsWith('javascript:')
    ) {
      return;
    }
    // Only intercept external protocols — let anything else fall through.
    if (!/^(https?:|mailto:|tel:|ftp:)/i.test(href)) return;

    e.preventDefault();
    e.stopPropagation();
    void (async () => {
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(href);
      } catch (err) {
        console.warn('[externalLinks] openUrl failed:', err);
      }
    })();
  };

  document.addEventListener('click', handler, true);
  return () => document.removeEventListener('click', handler, true);
}
