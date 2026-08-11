/**
 * PlantUML text encoding for the public plantuml.com server.
 *
 * The server expects a URL path segment of the form `/plantuml/svg/<encoded>`
 * where `<encoded>` is RFC 1951 raw DEFLATE compression of the UTF-8 source,
 * then a PlantUML-specific base64 variant (alphabet
 * `0-9A-Za-z-_`, no padding). Reference: https://plantuml.com/text-encoding.
 *
 * Uses the native `CompressionStream('deflate-raw')` (Chrome 103+, Safari 16.4+,
 * Firefox 113+). ponytail: no `pako` dependency — the alternative is a
 * userland deflate, but every browser shipping in the last 2 years has this
 * stream. If Tauri's WebView ever targets an older Chromium, swap to
 * `pako.deflateRaw` (peer deps already allow it).
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

function encodeByte(b: number): string {
  return ALPHABET[b & 0x3f];
}

/** PlantUML variant of base64 — same 6-bit grouping, no `=` padding. */
function encode64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    if (i + 1 >= bytes.length) {
      out += encodeByte(b1 >> 2);
      out += encodeByte((b1 << 4) & 0x30);
      break;
    }
    const b2 = bytes[i + 1];
    if (i + 2 >= bytes.length) {
      out += encodeByte(b1 >> 2);
      out += encodeByte(((b1 << 4) & 0x30) | (b2 >> 4));
      out += encodeByte((b2 << 2) & 0x3c);
      break;
    }
    const b3 = bytes[i + 2];
    out += encodeByte(b1 >> 2);
    out += encodeByte(((b1 << 4) & 0x30) | (b2 >> 4));
    out += encodeByte(((b2 << 2) & 0x3c) | (b3 >> 6));
    out += encodeByte(b3 & 0x3f);
  }
  return out;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(bytes as unknown as BufferSource);
  writer.close();
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/** Encode PlantUML source into the plantuml.com URL segment. */
export async function encodePlantUml(source: string): Promise<string> {
  const bytes = new TextEncoder().encode(source);
  const compressed = await deflateRaw(bytes);
  return encode64(compressed);
}
