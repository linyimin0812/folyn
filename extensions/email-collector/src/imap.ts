/**
 * A small IMAP4rev1 client for the mail collector, over a TLS socket the host
 * opens (`api.network.connect`). It does only what the collector needs:
 * LOGIN, ID, EXAMINE, UID SEARCH SINCE, UID FETCH of envelope data and a
 * body prefix, LOGOUT.
 *
 * The parser reads responses as a byte stream: a line is a run of bytes up to
 * CRLF, except that `{n}` at the end of a line announces n bytes of literal
 * data, which may contain anything (CRLFs, parentheses, quotes). Lines and
 * literals are decoded as UTF-8 only once they are whole.
 */

import PostalMime from 'postal-mime';
import type { ExtensionSocket } from 'folyn-extension-sdk';

// ── Protocol values ─────────────────────────────────────────────────────────

/** A parsed response item: an atom/number, a string (quoted or literal), NIL
 *  as `null`, or a parenthesized list. */
export type Value = string | null | Value[];

/** One response line, literals included. `tag` is `*` for untagged ones. */
export interface Response {
  tag: string;
  /** The rest after the tag, tokenized. */
  items: Value[];
  /** The rest after the tag as text, for status lines ("OK LOGIN completed"). */
  text: string;
}

const CRLF = Uint8Array.from([13, 10]);
const utf8 = new TextDecoder();

/** Reads complete responses off a byte stream. */
export class ResponseReader {
  private buffer = new Uint8Array(0);

  constructor(private readonly next: () => Promise<Uint8Array | null>) {}

  /** The next whole response, or null when the stream ends first. */
  async read(): Promise<Response | null> {
    // A response is lines joined by literals: `... {12}\r\n<12 bytes>... \r\n`.
    const parts: Array<{ text: string } | { literal: Uint8Array }> = [];
    for (;;) {
      const line = await this.readLine();
      if (line === null) return null;
      const m = /\{(\d+)\}$/.exec(line);
      if (!m) {
        parts.push({ text: line });
        break;
      }
      parts.push({ text: line.slice(0, m.index) });
      const literal = await this.readBytes(Number(m[1]));
      if (literal === null) return null;
      parts.push({ literal });
    }
    return parseResponse(parts);
  }

  private async fill(): Promise<boolean> {
    const chunk = await this.next();
    if (chunk === null) return false;
    const joined = new Uint8Array(this.buffer.length + chunk.length);
    joined.set(this.buffer);
    joined.set(chunk, this.buffer.length);
    this.buffer = joined;
    return true;
  }

  private async readLine(): Promise<string | null> {
    for (;;) {
      const end = indexOf(this.buffer, CRLF);
      if (end >= 0) {
        const line = utf8.decode(this.buffer.subarray(0, end));
        this.buffer = this.buffer.subarray(end + 2);
        return line;
      }
      if (!(await this.fill())) return null;
    }
  }

  private async readBytes(n: number): Promise<Uint8Array | null> {
    while (this.buffer.length < n) {
      if (!(await this.fill())) return null;
    }
    const out = this.buffer.slice(0, n);
    this.buffer = this.buffer.subarray(n);
    return out;
  }
}

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Tokenize a response made of text runs and literal byte blocks. */
export function parseResponse(parts: Array<{ text: string } | { literal: Uint8Array }>): Response {
  // Literals become placeholder tokens the tokenizer maps back, so a literal's
  // bytes are never re-scanned as syntax.
  const literals: string[] = [];
  let source = '';
  for (const p of parts) {
    if ('text' in p) source += p.text;
    else {
      literals.push(utf8.decode(p.literal));
      source += `\u0000${literals.length - 1}\u0000`;
    }
  }
  const space = source.indexOf(' ');
  const tag = space < 0 ? source : source.slice(0, space);
  const rest = space < 0 ? '' : source.slice(space + 1);
  const items = tokenize(rest, literals);
  const text = rest.replace(/\u0000(\d+)\u0000/g, (_, i) => literals[Number(i)]!);
  return { tag, items, text };
}

function tokenize(s: string, literals: string[]): Value[] {
  const stack: Value[][] = [[]];
  let i = 0;
  const push = (v: Value) => stack[stack.length - 1]!.push(v);
  while (i < s.length) {
    const c = s[i]!;
    if (c === ' ') { i++; continue; }
    if (c === '(' || c === '[') { const list: Value[] = []; push(list); stack.push(list); i++; continue; }
    if (c === ')' || c === ']') { if (stack.length > 1) stack.pop(); i++; continue; }
    if (c === '\u0000') {
      const end = s.indexOf('\u0000', i + 1);
      push(literals[Number(s.slice(i + 1, end))]!);
      i = end + 1;
      continue;
    }
    if (c === '"') {
      let out = '';
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length) i++;
        out += s[i];
        i++;
      }
      i++;
      push(out);
      continue;
    }
    let j = i;
    // An atom may carry a section in brackets (`BODY[]<0>`); keep it whole.
    while (j < s.length && !' ()"\u0000'.includes(s[j]!)) {
      if (s[j] === '[') { const close = s.indexOf(']', j); j = close < 0 ? s.length : close + 1; continue; }
      j++;
    }
    const atom = s.slice(i, j);
    push(atom.toUpperCase() === 'NIL' ? null : atom);
    i = j;
  }
  return stack[0]!;
}

// ── Commands ────────────────────────────────────────────────────────────────

/** A string as an IMAP quoted string; rejects what cannot be quoted. */
export function quoted(value: string): string {
  if (/[\r\n\u0000]/.test(value)) throw new Error('IMAP: value contains a line break or NUL');
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Mailbox name → IMAP astring: an atom as-is, quoted when it contains spaces
 * or quotes. Non-ASCII names are rejected — real non-ASCII folders are
 * modified UTF-7 on the wire.
 * ponytail: add modified UTF-7 encoding if non-ASCII folder names matter.
 */
export function mailboxName(folder: string): string {
  // eslint-disable-next-line no-control-regex
  if (!folder || /[\u0000-\u001f\u007f]|[^\u0000-\u007f]/.test(folder)) {
    throw new Error(`IMAP: invalid folder name: ${JSON.stringify(folder)}`);
  }
  return /[ "\\]/.test(folder) ? quoted(folder) : folder;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Epoch ms → IMAP date `DD-Mon-YYYY`, one day earlier (SEARCH SINCE is
 *  day-granular; callers still filter exactly). */
export function sinceDate(sinceMs: number): string {
  const d = new Date(sinceMs - 86_400_000);
  return `${String(d.getUTCDate()).padStart(2, '0')}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

export class ImapError extends Error {}

/** One IMAP session over an open socket. */
export class ImapSession {
  private readonly reader: ResponseReader;
  private counter = 0;

  constructor(private readonly socket: ExtensionSocket) {
    this.reader = new ResponseReader(() => socket.read());
  }

  /** The server greeting. */
  async greeting(): Promise<void> {
    const r = await this.reader.read();
    if (!r) throw new ImapError(this.closedMessage('greeting'));
    if (r.tag !== '*' || !/^(OK|PREAUTH)\b/i.test(r.text)) throw new ImapError(`IMAP greeting: ${r.text}`);
  }

  /**
   * Send a command; collect untagged responses until its tagged completion.
   * Rejects unless the completion is OK (`tolerateBad` accepts NO/BAD too).
   */
  async command(line: string, opts: { tolerateBad?: boolean } = {}): Promise<Response[]> {
    const tag = `a${++this.counter}`;
    await this.socket.write(`${tag} ${line}\r\n`);
    const untagged: Response[] = [];
    for (;;) {
      const r = await this.reader.read();
      if (!r) throw new ImapError(this.closedMessage(line.split(' ')[0]!));
      if (r.tag === '*') { untagged.push(r); continue; }
      if (r.tag === '+') continue; // no continuation is ever requested here
      if (r.tag !== tag) continue;
      if (!/^OK\b/i.test(r.text) && !opts.tolerateBad) {
        throw new ImapError(`${line.split(' ')[0]} failed: ${r.text}`);
      }
      return untagged;
    }
  }

  private closedMessage(step: string): string {
    return `IMAP: connection closed during ${step}${this.socket.error ? ` (${this.socket.error})` : ''}`;
  }
}

// ── Fetching mail ───────────────────────────────────────────────────────────

/** One fetched message, as the collector maps it to an event. */
export interface ImapFetchedMessage {
  uid: number;
  messageId: string | null;
  subject: string | null;
  from: string | null;
  to: string | null;
  /** INTERNALDATE as epoch ms. */
  dateMs: number;
  /** First text/plain part, trimmed, at most 2000 characters. */
  snippet: string | null;
  /** First text/html part (within the fetched prefix). */
  bodyHtml: string | null;
}

export interface ImapFetchOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  folder: string;
  /** Messages with INTERNALDATE on or after this day (minus one day). */
  sinceMs: number;
  /** Newest-by-UID cap. */
  max: number;
}

/** Bytes of each message fetched: enough for headers and the text parts. */
const BODY_PREFIX = 262_144;
const MAX_SNIPPET_CHARS = 2000;

/** Opens a socket to `host:port` (the extension's `api.network.connect`). */
export type Connect = (host: string, port: number) => Promise<ExtensionSocket>;

export async function fetchMail(connect: Connect, opts: ImapFetchOptions, version: string): Promise<ImapFetchedMessage[]> {
  if (!opts.host || /\s/.test(opts.host)) throw new ImapError(`IMAP: invalid host: ${JSON.stringify(opts.host)}`);
  const folder = mailboxName(opts.folder);
  const socket = await connect(opts.host, opts.port);
  const session = new ImapSession(socket);
  try {
    await session.greeting();
    await session.command(`LOGIN ${quoted(opts.username)} ${quoted(opts.password)}`).catch((e: Error) => {
      throw new ImapError(`login to ${opts.host} failed: ${e.message.replace(/^LOGIN failed: /, '')}`);
    });
    // NetEase (163/126/yeah) and QQ reject later commands with "Unsafe Login"
    // until the client identifies itself (RFC 2971). Best-effort: servers
    // without ID answer BAD, which is fine.
    await session.command(`ID ("name" "Folyn" "version" ${quoted(version)})`, { tolerateBad: true });
    await session.command(`EXAMINE ${folder}`);

    const search = await session.command(`UID SEARCH SINCE ${sinceDate(opts.sinceMs)}`);
    let uids = search
      .flatMap((r) => (r.items[0] === 'SEARCH' ? r.items.slice(1) : []))
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0)
      .sort((a, b) => a - b);
    if (uids.length > opts.max) uids = uids.slice(uids.length - opts.max); // newest by UID
    if (uids.length === 0) return [];

    const fetched = await session.command(`UID FETCH ${uids.join(',')} (UID ENVELOPE INTERNALDATE BODY.PEEK[]<0.${BODY_PREFIX}>)`);
    const messages: ImapFetchedMessage[] = [];
    for (const r of fetched) {
      if (r.items[1] !== 'FETCH' || !Array.isArray(r.items[2])) continue;
      const message = await toMessage(fieldsOf(r.items[2]));
      if (message) messages.push(message);
    }
    return messages;
  } finally {
    // Best-effort logout: errors after a successful fetch are not worth failing on.
    await session.command('LOGOUT', { tolerateBad: true }).catch(() => {});
    await socket.close().catch(() => {});
  }
}

/** `(UID 5 ENVELOPE (...) ...)` → { UID: '5', ENVELOPE: [...], ... }. The
 *  body item's name varies (`BODY[]<0>`); it is keyed as `BODY`. */
export function fieldsOf(list: Value[]): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (let i = 0; i + 1 < list.length; i += 2) {
    const key = String(list[i]).toUpperCase();
    out[key.startsWith('BODY[') ? 'BODY' : key] = list[i + 1]!;
  }
  return out;
}

async function toMessage(f: Record<string, Value>): Promise<ImapFetchedMessage | null> {
  // INTERNALDATE is the timeline anchor; a message without one is unusable.
  const dateMs = typeof f.INTERNALDATE === 'string' ? Date.parse(f.INTERNALDATE.replace(/^(\d{1,2})-(\w{3})-(\d{4})/, '$1 $2 $3')) : NaN;
  if (!Number.isFinite(dateMs)) return null;
  const env = Array.isArray(f.ENVELOPE) ? f.ENVELOPE : [];
  const body = typeof f.BODY === 'string' ? await mailBody(f.BODY) : { plain: null, html: null };
  return {
    uid: Number(f.UID) || 0,
    subject: asString(env[1]),
    from: addresses(env[2]),
    to: addresses(env[5]),
    messageId: asString(env[9]),
    dateMs,
    snippet: body.plain,
    bodyHtml: body.html,
  };
}

const asString = (v: Value | undefined): string | null => (typeof v === 'string' ? v : null);

/** Envelope address list → `Name <mailbox@host>, …`; null when empty. */
export function addresses(v: Value | undefined): string | null {
  if (!Array.isArray(v)) return null;
  const out = v
    .map((a) => {
      if (!Array.isArray(a)) return '';
      const [name, , mailbox, host] = a.map(asString);
      const email = mailbox && host ? `${mailbox}@${host}` : mailbox ?? '';
      return name ? `${name} <${email}>` : email;
    })
    .filter((s) => s);
  return out.length ? out.join(', ') : null;
}

/** postal-mime's per-part record: each part's own decoded text, by subtype. */
type TextMap = Map<unknown, Partial<Record<'plain' | 'html', Array<{ type: string; value: string }>>>>;

/**
 * The first text/plain part (trimmed, capped) and the first text/html part of
 * a raw message, decoded — transfer encoding and charset (GBK etc.) included.
 * Each is null when the message has no such part of its own (postal-mime's
 * `text` / `html` fill one from the other; its `textMap` keeps each part's own).
 */
export async function mailBody(raw: string | Uint8Array): Promise<{ plain: string | null; html: string | null }> {
  const parser = new PostalMime();
  try {
    await parser.parse(raw);
  } catch {
    return { plain: null, html: null };
  }
  const first = (type: 'plain' | 'html'): string | null => {
    for (const entry of ((parser as unknown as { textMap?: TextMap }).textMap ?? new Map()).values()) {
      for (const t of entry[type] ?? []) {
        if (t.type === 'text' && t.value.trim()) return t.value;
      }
    }
    return null;
  };
  const plain = first('plain');
  return {
    plain: plain === null ? null : [...plain.trim()].slice(0, MAX_SNIPPET_CHARS).join(''),
    // The part's trailing line break is the MIME boundary's, not content.
    html: first('html')?.trimEnd() ?? null,
  };
}
