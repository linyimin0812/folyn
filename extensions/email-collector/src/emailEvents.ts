/**
 * Custom-IMAP mailbox collection (poll mode).
 *
 * The host's `ctx.imapFetch` (Rust `activity_imap_fetch`) does the wire work
 * over TLS; this module only picks config, filters by the cursor, and maps
 * messages to standard CollectorEvents. The cursor is the epoch-ms INTERNALDATE
 * of the newest already-ingested message. IMAP SEARCH SINCE is day-granular,
 * so the host fetches with a day of slack and the exact `dateMs <= cursor`
 * filter here plus host-side insert-ignore dedup absorbs the overlap.
 *
 * The password is only ever passed to `imapFetch` — it never appears in event
 * payloads, ids, or cursors.
 */
import type { CollectorContext, CollectorEvent } from 'folyn-extension-sdk';

/** Message shape returned by ctx.imapFetch (see extension-sdk contracts). */
export interface ImapFetchedMessage {
  uid: number;
  messageId: string | null;
  subject: string | null;
  from: string | null;
  to: string | null;
  dateMs: number;
  snippet: string | null;
  /** Decoded text/html body from the host — null for plain-text-only mail. */
  bodyHtml: string | null;
}

const MAX_BATCH = 200;

// ── RFC 2047 encoded-word decoding (`=?UTF-8?Q?...?= / =?GBK?B?...?=`) ──────
// IMAP ENVELOPE returns raw header bytes: subjects/addresses from Gmail etc.
// arrive as encoded words. Decoded here (not host-side) because the webview's
// TextDecoder natively covers gbk/gb18030 — a Rust decoder would need a crate.

const ENCODED_WORD_RE = /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g;

function decodeQWord(data: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const c = data[i]!;
    if (c === '_') {
      bytes.push(0x20);
    } else if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(data.slice(i + 1, i + 3))) {
      bytes.push(parseInt(data.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(c.charCodeAt(0));
    }
  }
  return Uint8Array.from(bytes);
}

function decodeWord(charset: string, enc: string, data: string): string {
  try {
    const bytes =
      enc.toUpperCase() === 'B'
        ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
        : decodeQWord(data);
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    // ponytail: unknown charset / bad base64 → raw text beats a crash.
    return data;
  }
}

/**
 * Decode one header value: replaces encoded words, dropping the whitespace
 * that separates two adjacent ones (RFC 2047 §6.2). Non-encoded text passes
 * through; returns null for null.
 */
export function decodeMimeHeader(input: string | null): string | null {
  if (!input || !input.includes('=?')) return input;
  let result = '';
  let prevEnd = 0;
  let prevEncoded = false;
  for (const m of input.matchAll(ENCODED_WORD_RE)) {
    const idx = m.index!;
    const between = input.slice(prevEnd, idx);
    // Whitespace BETWEEN two encoded words is an artifact; keep any other text.
    if (!(prevEncoded && between.trim() === '')) result += between;
    result += decodeWord(m[1]!, m[2]!, m[3]!);
    prevEnd = idx + m[0].length;
    prevEncoded = true;
  }
  return result + input.slice(prevEnd);
}

/**
 * Well-known providers whose IMAP host doesn't follow the `imap.<domain>`
 * convention. Unknown domains fall back to the convention — right for most
 * providers (fastmail, zoho, ...), and the fetch error names the host so the
 * user knows what to fill in manually.
 * ponytail: MX-based discovery needs DNS, which collectors don't have.
 */
const IMAP_HOSTS: Record<string, string> = {
  'gmail.com': 'imap.gmail.com',
  'googlemail.com': 'imap.gmail.com',
  'qq.com': 'imap.qq.com',
  'foxmail.com': 'imap.qq.com',
  '163.com': 'imap.163.com',
  '126.com': 'imap.126.com',
  'yeah.net': 'imap.yeah.net',
  'sina.com': 'imap.sina.com',
  'outlook.com': 'outlook.office365.com',
  'hotmail.com': 'outlook.office365.com',
  'live.com': 'outlook.office365.com',
  'yahoo.com': 'imap.mail.yahoo.com',
  'icloud.com': 'imap.mail.me.com',
};

/** Email address domain → IMAP host guess; '' when the address has no domain. */
export function inferImapHost(username: string): string {
  const domain = username.split('@')[1]?.toLowerCase().trim() ?? '';
  if (!domain) return '';
  return IMAP_HOSTS[domain] ?? `imap.${domain}`;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** One configured mailbox. host '' = infer from the username at collect time. */
export interface EmailAccount {
  username: string;
  password: string;
  host: string;
  port: number;
  folder: string;
  backfillDays: number;
}

/**
 * Config → account list. `config.accounts` is the multi-mailbox shape
 * ({accounts: [{username, password, host?, port?, folder?, backfillDays?}]});
 * a legacy flat single-account config is still accepted.
 */
export function parseAccounts(config: Record<string, unknown> | undefined): EmailAccount[] {
  const cfg = config ?? {};
  const fromRecord = (r: Record<string, unknown>): EmailAccount | null => {
    const username = str(r.username);
    const password = typeof r.password === 'string' ? r.password : '';
    if (!username || !password) return null;
    return {
      username,
      password,
      host: str(r.host),
      port: num(r.port, 993, 1, 65_535),
      folder: str(r.folder) || 'INBOX',
      backfillDays: num(r.backfillDays, 30, 1, 365),
    };
  };
  if (Array.isArray(cfg.accounts)) {
    const out: EmailAccount[] = [];
    for (const a of cfg.accounts) {
      if (a && typeof a === 'object' && !Array.isArray(a)) {
        const acc = fromRecord(a as Record<string, unknown>);
        if (acc) out.push(acc);
      }
    }
    return out;
  }
  const legacy = fromRecord(cfg);
  return legacy ? [legacy] : [];
}

/** Cursor key — username + folder so one mailbox can be watched on two folders.
 *  ponytail: no host in the key — same mailbox moved between hosts re-backfills. */
function cursorKey(acc: EmailAccount): string {
  return `${acc.username}|${acc.folder}`;
}

/** Error → readable text. Tauri command failures reject with the host's
 *  AppError shape `{category, detail}`, not Error instances. */
export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const r = err as Record<string, unknown>;
    if (typeof r.detail === 'string') return `${String(r.category ?? 'error')}: ${r.detail}`;
    if (typeof r.message === 'string') return r.message;
    try {
      return JSON.stringify(err);
    } catch {
      // Unstringifiable object — at least name the type.
      return Object.prototype.toString.call(err);
    }
  }
  return String(err);
}

/** `Name <addr@host>` → `addr@host` (identity keys must be stable). */
export function senderAddress(from: string | null): string {
  const s = from ?? '';
  const m = s.match(/<([^<>]+)>/);
  return (m?.[1] ?? s).trim() || 'unknown';
}

/** Stable dedup id: Message-ID when present, else server+folder+uid. */
export function emailId(msg: ImapFetchedMessage, host: string, folder: string): string {
  const mid = msg.messageId?.trim();
  return mid ? `email:${mid}` : `email:${host}:${folder}:${msg.uid}`;
}

type ImapFetch = NonNullable<CollectorContext['imapFetch']>;

/** Fetch + map one account's new messages since `cursorMs` (0 = first run).
 *  The receiving mailbox is stamped into each event's payload (`mailbox`) —
 *  the host timeline renders the provider badge + address from it. */
async function collectAccount(
  imapFetch: ImapFetch,
  acc: EmailAccount,
  cursorMs: number,
): Promise<{ events: CollectorEvent[]; newest: number }> {
  const host = acc.host || inferImapHost(acc.username);
  if (!host) {
    throw new Error(`cannot infer an IMAP server from ${acc.username} — fill in the IMAP 服务器 field`);
  }
  const firstRun = cursorMs <= 0;
  const sinceMs = firstRun ? Date.now() - acc.backfillDays * 86_400_000 : cursorMs;

  const messages =
    (await imapFetch({
      host,
      port: acc.port,
      username: acc.username,
      password: acc.password,
      folder: acc.folder,
      sinceMs,
      max: MAX_BATCH,
    })) ?? [];

  const events: CollectorEvent[] = [];
  let newest = firstRun ? 0 : cursorMs;
  for (const msg of messages) {
    if (!Number.isFinite(msg.dateMs)) continue;
    if (!firstRun && msg.dateMs <= cursorMs) continue;
    const from = decodeMimeHeader(msg.from) ?? '';
    const to = decodeMimeHeader(msg.to) ?? '';
    const subject = decodeMimeHeader(msg.subject) ?? '';
    // The mailbox is the graph hub: edges mailbox→self and mailbox→sender.
    // Around 'self' the mailbox node shows (email is visible in the default
    // graph); clicking it navigates to the mailbox center, where all senders
    // appear — no per-collector UI wiring. The actor is not rendered in the
    // timeline, so using the mailbox as actor is purely a graph-shape choice.
    events.push({
      id: emailId(msg, host, acc.folder),
      type: 'email_received',
      occurredAt: msg.dateMs,
      title: subject || '(no subject)',
      summary: [from, subject || '(no subject)'].filter(Boolean).join(' · '),
      actor: {
        type: 'mailbox',
        identityKey: `${acc.username}@${host}`,
        displayName: acc.username,
      },
      entities: [
        {
          type: 'person',
          identityKey: 'self',
          displayName: '我',
          relation: '归属',
        },
        {
          type: 'person',
          identityKey: senderAddress(from),
          displayName: from || senderAddress(from),
          relation: '发件人',
        },
      ],
      payload: {
        mailbox: acc.username,
        from,
        to: msg.to ?? '',
        subject,
        folder: acc.folder,
        snippet: msg.snippet ?? '',
        // Preview-panel content: the html body when the mail has one, else the
        // decoded plain snippet (the panel renders plain text escaped).
        bodyHtml: msg.bodyHtml ?? msg.snippet ?? '',
      },
    });
    if (msg.dateMs > newest) newest = msg.dateMs;
  }
  return { events, newest };
}

/**
 * Cursor format (multi-account): JSON `{"username|folder": epochMs}`.
 * A legacy bare epoch-ms cursor belongs to the first (migrated) account.
 */
function parseCursorMap(cursor: string): { map: Record<string, number>; legacyMs: number } {
  if (cursor.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(cursor);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const map: Record<string, number> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === 'number' && Number.isFinite(v) && v > 0) map[k] = v;
        }
        return { map, legacyMs: 0 };
      }
    } catch {
      // Malformed JSON → fall through to the bare-number path.
    }
  }
  const n = Number(cursor);
  return { map: {}, legacyMs: Number.isFinite(n) && n > 0 ? n : 0 };
}

export async function collectEmailEvents(
  ctx: CollectorContext,
): Promise<{ events: CollectorEvent[]; nextCursor: string }> {
  const accounts = parseAccounts(ctx.config);
  const cursorIn = ctx.cursor ?? '';
  // Unconfigured — no events, cursor untouched.
  if (accounts.length === 0) return { events: [], nextCursor: cursorIn };
  if (!ctx.imapFetch) throw new Error('email collector requires ctx.imapFetch');
  const imapFetch = ctx.imapFetch;

  const { map, legacyMs } = parseCursorMap(cursorIn);
  const events: CollectorEvent[] = [];
  const nextMap: Record<string, number> = {};
  const errors: string[] = [];

  for (const [i, acc] of accounts.entries()) {
    const key = cursorKey(acc);
    // Legacy cursor / prior cursor of a failed account is preserved so the
    // next run re-reads the same window instead of skipping it.
    const prevMs = map[key] ?? (i === 0 ? legacyMs : 0);
    if (prevMs > 0) nextMap[key] = prevMs;
    try {
      const { events: accountEvents, newest } = await collectAccount(imapFetch, acc, prevMs);
      events.push(...accountEvents);
      // No new mail on the first run → anchor the cursor at now so the next
      // poll doesn't refetch the whole backfill window.
      nextMap[key] = newest > 0 ? newest : Date.now();
      ctx.onProgress?.(`${acc.username}: ${accountEvents.length} messages`);
    } catch (err) {
      const message = errorText(err);
      errors.push(`${acc.username}: ${message}`);
      ctx.onProgress?.(`${acc.username}: ${message}`);
    }
  }

  // Every account failed → surface the failure (runCollect records it).
  if (errors.length === accounts.length) {
    throw new Error(`email collector: ${errors.join('; ')}`);
  }
  return { events, nextCursor: JSON.stringify(nextMap) };
}
