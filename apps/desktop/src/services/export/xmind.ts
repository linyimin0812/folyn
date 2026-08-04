/**
 * XMind export: Convert mmap (mind-elixir plaintext) to XMind 2021 format
 * (.xmind). XMind files are ZIP archives containing XML files.
 *
 * The XMind 2021 content format uses the namespace
 * `urn:xmind:xmap:xmlns:content:3.0`. The structure is:
 *   <xmap-content>
 *     <sheet>
 *       <topic>  (root)
 *         <title>...</title>
 *         <children>
 *           <topics type="attached">
 *             <topic> ... </topic>
 *           </topics>
 *         </children>
 *       </topic>
 *     </sheet>
 *   </xmap-content>
 *
 * This module converts mmap outline text to the XMind XML structure and
 * packages it into a ZIP blob with the proper file layout.
 */

import { parseOutline, type OutlineLine, type MmapMeta } from '@/components/file-types/mmap/outlineConverter';

// ── CRC-32 (used by ZIP format) ──────────────────────────────────────────

/** Precomputed CRC-32 lookup table (IEEE polynomial). */
const CRC_TABLE = new Uint32Array(256).map((_, i) => {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ── Minimal ZIP creator (stored entries, no compression) ─────────────────

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/**
 * Create a ZIP Blob from a list of entries. Uses "stored" (no compression)
 * for simplicity — XMind readers handle this correctly.
 */
function createZipBlob(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const localSections: Uint8Array[] = [];
  const centralSections: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    // ── Local file header ──
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lh = new DataView(localHeader.buffer);
    lh.setUint32(0, 0x04034b50, true); // signature
    lh.setUint16(4, 20, true);         // version needed
    lh.setUint16(6, 0, true);          // general purpose bit flag
    lh.setUint16(8, 0, true);          // compression method (stored)
    lh.setUint16(10, 0, true);         // last mod file time
    lh.setUint16(12, 0, true);         // last mod file date
    lh.setUint32(14, crc, true);       // CRC-32
    lh.setUint32(18, size, true);      // compressed size
    lh.setUint32(22, size, true);      // uncompressed size
    lh.setUint16(26, nameBytes.length, true); // file name length
    lh.setUint16(28, 0, true);         // extra field length
    localHeader.set(nameBytes, 30);

    localSections.push(localHeader, entry.data);

    // ── Central directory header ──
    const central = new Uint8Array(46 + nameBytes.length);
    const cd = new DataView(central.buffer);
    cd.setUint32(0, 0x02014b50, true); // signature
    cd.setUint16(4, 20, true);         // version made by
    cd.setUint16(6, 20, true);         // version needed
    cd.setUint16(8, 0, true);          // general purpose bit flag
    cd.setUint16(10, 0, true);         // compression method
    cd.setUint16(12, 0, true);         // last mod file time
    cd.setUint16(14, 0, true);         // last mod file date
    cd.setUint32(16, crc, true);       // CRC-32
    cd.setUint32(20, size, true);      // compressed size
    cd.setUint32(24, size, true);      // uncompressed size
    cd.setUint16(28, nameBytes.length, true); // file name length
    cd.setUint16(30, 0, true);         // extra field length
    cd.setUint16(32, 0, true);         // file comment length
    cd.setUint16(34, 0, true);         // disk number start
    cd.setUint16(36, 0, true);         // internal file attributes
    cd.setUint32(38, 0, true);         // external file attributes
    cd.setUint32(42, offset, true);    // relative offset of local header
    central.set(nameBytes, 46);

    centralSections.push(central);
    offset += 30 + nameBytes.length + size;
  }

  // ── End of central directory record ──
  const totLocal = localSections.reduce((s, a) => s + a.length, 0);
  const totCentral = centralSections.reduce((s, a) => s + a.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);    // signature
  eocdView.setUint16(4, 0, true);              // disk number
  eocdView.setUint16(6, 0, true);              // disk with central dir
  eocdView.setUint16(8, entries.length, true); // entries on this disk
  eocdView.setUint16(10, entries.length, true);// total entries
  eocdView.setUint32(12, totCentral, true);    // size of central dir
  eocdView.setUint32(16, totLocal, true);      // offset of central dir
  eocdView.setUint16(20, 0, true);             // comment length

  // Assemble final blob
  const allParts = [...localSections, ...centralSections, eocd];
  const total = allParts.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const part of allParts) {
    result.set(part, pos);
    pos += part.length;
  }
  return new Blob([result], { type: 'application/zip' });
}

// ── XMind XML generation ─────────────────────────────────────────────────

function uid(): string {
  // XMind uses lowercase hex UUIDs without dashes.
  return crypto.randomUUID().replace(/-/g, '');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build an XMind 2021 content.xml string from the mmap outline lines.
 */
function buildContentXml(lines: OutlineLine[], meta: MmapMeta | undefined): string {
  if (lines.length === 0) {
    lines = [{ text: 'Root', depth: 0 }];
  }

  // Determine structure class from mapStyle direction
  const direction = meta?.mapStyle?.direction;
  // 0=LEFT, 1=RIGHT (default), 2=SIDE (both sides)
  let structureClass: string;
  if (direction === 0) {
    structureClass = 'org.xmind.ui.logic.left';
  } else if (direction === 1) {
    structureClass = 'org.xmind.ui.logic.right';
  } else {
    // SIDE (2) or default — map layout (both sides)
    structureClass = 'org.xmind.ui.map.old';
  }

  const now = new Date().toISOString();

  // Build the tree from flat outline lines
  const rootLine = lines[0];
  const rootId = uid();

  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<xmap-content xmlns="urn:xmind:xmap:xmlns:content:3.0" modified-by="Quill" timestamp="${escapeXml(now)}">
  <sheet id="${uid()}" title="${escapeXml(rootLine.text)}">
    <topic id="${rootId}" structure-class="${structureClass}">
      <title>${escapeXml(rootLine.text)}</title>`;

  // Add note to root if present
  if (rootLine.note) {
    xml += `\n      <notes><plain>${escapeXml(rootLine.note)}</plain></notes>`;
  }

  // Add children
  const childrenXml = buildChildrenXml(lines, 1, 0 /* root depth */);
  if (childrenXml) {
    xml += `\n      <children>\n        <topics type="attached">`;
    xml += childrenXml;
    xml += `\n        </topics>\n      </children>`;
  }

  xml += `\n    </topic>\n  </sheet>\n</xmap-content>`;
  return xml;
}

/**
 * Recursively build <topic> elements for children of a given parent line.
 * Returns the concatenated XML string for all child topics, or '' if none.
 *
 * @param lines  Flat outline lines
 * @param startIdx  Index of the first line that could be a child
 * @param parentDepth  Depth of the parent
 */
function buildChildrenXml(
  lines: OutlineLine[],
  startIdx: number,
  parentDepth: number,
): string {
  let result = '';
  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i];
    if (line.depth <= parentDepth) break; // not a child (sibling or parent of parent)

    // This line is a child of the parent
    result += `\n          <topic id="${uid()}">`;
    result += `\n            <title>${escapeXml(line.text)}</title>`;

    // Add note if present
    if (line.note) {
      result += `\n            <notes><plain>${escapeXml(line.note)}</plain></notes>`;
    }

    // Recurse for grandchildren
    const grandChildren = buildChildrenXml(lines, i + 1, line.depth);
    if (grandChildren) {
      result += `\n            <children>\n              <topics type="attached">`;
      result += grandChildren;
      result += `\n              </topics>\n            </children>`;
    }

    result += `\n          </topic>`;
    i++;
  }
  return result;
}

function buildMetaXml(): string {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<meta xmlns="urn:xmind:xmap:xmlns:meta:2.0" created="${escapeXml(now)}">
  <author>
    <name>Quill</name>
  </author>
</meta>`;
}

function buildManifestXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<manifest xmlns="urn:xmind:xmap:xmlns:manifest:1.0">
  <file-entry full-path="content.xml" media-type="text/xml"/>
  <file-entry full-path="meta.xml" media-type="text/xml"/>
  <file-entry full-path="META-INF/manifest.xml" media-type="text/xml"/>
</manifest>`;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Convert mmap outline content to an XMind (.xmind) Blob.
 *
 * @param mmapContent  The raw mmap file content (mind-elixir plaintext).
 * @param sheetTitle   Title for the XMind sheet (defaults to the root topic text).
 * @returns A Blob ready for download as a .xmind file.
 */
export async function mmapToXmindBlob(
  mmapContent: string,
  _sheetTitle?: string,
): Promise<Blob> {
  const lines = parseOutline(mmapContent);
  const meta = lines[0]?.meta;

  const contentXml = buildContentXml(lines, meta);
  const metaXml = buildMetaXml();
  const manifestXml = buildManifestXml();

  const encoder = new TextEncoder();

  const entries: ZipEntry[] = [
    { name: 'content.xml', data: encoder.encode(contentXml) },
    { name: 'meta.xml', data: encoder.encode(metaXml) },
    { name: 'META-INF/manifest.xml', data: encoder.encode(manifestXml) },
  ];

  return createZipBlob(entries);
}