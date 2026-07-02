/**
 * RFC-4180 CSV parser.
 *
 * Pure state-machine: iterates char by char, tracks `inQuotes`. Supports quoted
 * fields, escaped quotes (`""` -> `"`), fields containing commas/newlines, and
 * `\n` / `\r\n` line endings. Never throws — on any anomaly returns what's
 * parsed so far. A trailing newline does NOT produce an extra empty row.
 *
 * @returns array of rows, each an array of field strings.
 */
export function parseCsv(raw: string): string[][] {
  if (!raw) return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote: `""` -> literal `"`.
        if (raw[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          // Closing quote.
          inQuotes = false;
        }
      } else {
        // Everything inside a quoted field (commas, newlines, CR) is literal.
        field += ch;
      }
      continue;
    }

    // Not in quotes.
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // `\r\n` line ending: ignore the `\r`, the following `\n` ends the row.
      // A lone `\r` outside quotes is treated as a line break too (defensive).
      if (raw[i + 1] === '\n') {
        // Handled when we hit `\n` next iteration — but we still need to end
        // the current field/row now. Push field, push row, reset.
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i++; // consume the `\n`
      } else {
        // Lone `\r` — treat as line break (rare, but safer than dropping it).
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      }
    } else {
      field += ch;
    }
  }

  // Flush trailing field/row only if there is leftover content (no final newline).
  const hasLeftover = field.length > 0 || row.length > 0 || inQuotes;
  if (hasLeftover) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
