/**
 * Normalize a URL for consistent duplicate detection.
 *
 * Rule: lowercase host + strip fragment (#...) + strip trailing slash,
 * KEEP query string. Root URLs (`https://site.com` / `https://site.com/`)
 * both normalize to `https://site.com` (no trailing slash).
 *
 * Invalid input (not an http/https URL) is returned unchanged so that
 * downstream validation (`validateUrl`) can surface the real error.
 */
export function normalizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return url;
  }

  // Strip trailing slashes from the pathname (root `/` becomes empty).
  const pathname = parsed.pathname.replace(/\/+$/, '');
  const port = parsed.port ? `:${parsed.port}` : '';

  // Fragment is intentionally dropped; query is preserved.
  return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${port}${pathname}${parsed.search}`;
}
