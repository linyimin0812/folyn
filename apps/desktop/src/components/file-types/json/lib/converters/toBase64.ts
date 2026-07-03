/**
 * toBase64 — UTF-8-safe Base64 encoder.
 *
 * Uses native `TextEncoder` + `btoa` (no dep). The standard `btoa(str)` only
 * handles Latin-1; going through UTF-8 bytes makes Unicode-safe.
 *
 * Encodes the JSON-stringified form of the value (single-line, no indent)
 * so the output is a self-contained Base64 blob that decodes back to the
 * same JSON.
 */
export function toBase64(value: unknown): string {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  // Chunk the byte→char conversion to avoid call-stack limits on large
  // inputs (btoa accepts binary strings up to ~32k chars via spread, but
  // large JSON can exceed that).
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    bin += String.fromCharCode(...slice);
  }
  return btoa(bin);
}
