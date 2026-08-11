/**
 * Vitest stand-in for `virtual:file-viewer-renderers` (provided by
 * `@file-viewer/vite-plugin` in apps/desktop/vite.config.ts). Tests that
 * import CsvFileViewerPreview need the id to resolve; the preset value is
 * irrelevant because those tests mock `@file-viewer/react` and only assert
 * the constructed File (BOM prepending).
 */
export default [];
