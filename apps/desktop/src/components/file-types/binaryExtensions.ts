/**
 * Extensions whose files are NOT plain text — office documents, archives,
 * media, CAD, 3D, etc. When no registered provider (app builtin or an
 * installed extension) claims one of these, the shell shows an "unsupported
 * file type" view instead of dumping the raw bytes into the code editor.
 *
 * Kept in sync with the Generic File Viewer extension's declared extensions
 * (extensions/file-viewer/manifest.json): when that extension is installed it
 * claims these before the fallback runs, so this list only decides the
 * no-provider case.
 */
export const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  // Office / PDF
  'pdf', 'ofd',
  'docx', 'doc', 'dot', 'docm', 'dotx', 'dotm', 'rtf', 'odt',
  'xlsx', 'xls', 'xlsm', 'xlsb', 'xltx', 'xlt', 'xltm', 'ods', 'fods', 'numbers',
  'pptx', 'pptm', 'potx', 'potm', 'ppsx', 'ppsm', 'odp',
  // Archives
  'zip', 'zipx', '7z', 'rar', 'tar', 'gz', 'gzip', 'tgz',
  'bz2', 'bzip2', 'tbz', 'tbz2', 'xz', 'txz', 'lzma', 'zst',
  'cab', 'ar', 'cpio', 'iso', 'xar', 'lha', 'lzh',
  'jar', 'war', 'ear', 'apk', 'cbz', 'cbr',
  // Email
  'eml', 'msg', 'mbox',
  // EDA
  'olb', 'dra', 'gds', 'oas', 'oasis',
  // CAD
  'dwg', 'dxf', 'dwf', 'dwfx', 'xps',
  // Geo
  'geojson', 'kml', 'gpx', 'shp', 'kmz',
  // 3D
  'glb', 'gltf', 'obj', 'stl', 'ply', 'fbx', 'dae', '3ds', '3mf', 'amf',
  'usd', 'usda', 'usdc', 'usdz', 'pcd', 'wrl', 'vrml',
  'xyz', 'vtk', 'vtp', 'step', 'stp', 'iges', 'igs', 'ifc', '3dm',
  // Mindmap
  'xmind',
  // Ebooks
  'epub', 'umd',
  // Image (supplement — non-web formats)
  'tiff', 'tif', 'avif', 'heic', 'heif', 'jxl', 'psd', 'ai', 'eps',
  // Audio
  'mp3', 'mpeg', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'weba',
  'midi', 'mid',
  // Video
  'mp4', 'webm', 'm3u8',
  // Font / binary data
  'ttf', 'otf', 'woff', 'woff2',
  'sqlite', 'wasm', 'parquet', 'avro', 'webarchive',
]);

/** True when `ext` (no dot, lowercased) is a known non-text format. */
export function isBinaryExtension(ext: string): boolean {
  return BINARY_EXTENSIONS.has(ext.toLowerCase());
}
