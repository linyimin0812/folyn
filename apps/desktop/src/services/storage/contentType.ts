/** Map a file extension to its upload Content-Type. Previewable text
 *  types (html/css/js/json/csv/xml/txt) get explicit charset=utf-8 so
 *  browsers render them inline instead of downloading as octet-stream.
 *  Unknown extensions fall back to application/octet-stream. */
export function contentTypeForExt(ext: string): string {
  const e = ext.toLowerCase();
  switch (e) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    case 'svg': return 'image/svg+xml';
    case 'html':
    case 'htm': return 'text/html; charset=utf-8';
    case 'css': return 'text/css; charset=utf-8';
    case 'js':
    case 'mjs': return 'application/javascript; charset=utf-8';
    case 'json': return 'application/json; charset=utf-8';
    case 'csv': return 'text/csv; charset=utf-8';
    case 'xml': return 'application/xml; charset=utf-8';
    case 'txt':
    case 'md': return 'text/plain; charset=utf-8';
    default: return 'application/octet-stream';
  }
}
