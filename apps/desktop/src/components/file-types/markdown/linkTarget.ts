import { isExternalPath } from '@/utils/isExternalPath';

/** What a markdown link points at. Only http(s) and `www.` hrefs are web
 *  pages; mailto/tel/ftp go to the system handler; `#…` is an in-page
 *  anchor; everything else is a document path relative to the linking file. */
export type LinkTarget =
  | { kind: 'web'; url: string }
  | { kind: 'system'; url: string }
  | { kind: 'anchor' }
  | { kind: 'file'; path: string };

export function classifyLinkHref(href: string, filePath: string): LinkTarget {
  if (/^https?:\/\//i.test(href)) return { kind: 'web', url: href };
  if (/^www\./i.test(href)) return { kind: 'web', url: `https://${href}` };
  if (/^(mailto|tel|ftp):/i.test(href)) return { kind: 'system', url: href };
  if (href.startsWith('#')) return { kind: 'anchor' };
  return { kind: 'file', path: resolveLinkPath(href, filePath) };
}

/** Resolve a document link against the linking file's directory. Absolute and
 *  home-relative targets pass through; the `#fragment` / `?query` is dropped
 *  and percent-escapes (`my%20note.md`) decoded. */
export function resolveLinkPath(href: string, filePath: string): string {
  const raw = href.replace(/[?#].*$/, '');
  let target: string;
  try {
    target = decodeURIComponent(raw);
  } catch {
    target = raw;
  }
  if (isExternalPath(target)) return target;
  const normalized = filePath.replace(/\\/g, '/');
  const dir = normalized.substring(0, normalized.lastIndexOf('/') + 1);
  const lead = dir.startsWith('/') ? '/' : '';
  const segments = dir.split('/').filter(Boolean);
  for (const seg of target.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') segments.pop();
    else segments.push(seg);
  }
  return lead + segments.join('/');
}
