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

function configString(ctx: CollectorContext, key: string): string {
  const v = ctx.config[key];
  return typeof v === 'string' ? v.trim() : '';
}

function configNumber(ctx: CollectorContext, key: string, fallback: number, min: number, max: number): number {
  const v = ctx.config[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
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

export async function collectEmailEvents(
  ctx: CollectorContext,
): Promise<{ events: CollectorEvent[]; nextCursor: string }> {
  const username = configString(ctx, 'username');
  const password = configString(ctx, 'password');
  const cursor = ctx.cursor ?? '';
  if (!username || !password) {
    // Unconfigured — no events, cursor untouched.
    return { events: [], nextCursor: cursor };
  }
  if (!ctx.imapFetch) {
    throw new Error('email collector requires ctx.imapFetch');
  }
  const host = configString(ctx, 'host') || inferImapHost(username);
  if (!host) {
    throw new Error('email collector: cannot infer an IMAP server from the username — fill in the IMAP 服务器 field');
  }

  const folder = configString(ctx, 'folder') || 'INBOX';
  const backfillDays = configNumber(ctx, 'backfillDays', 30, 1, 365);
  const cursorMs = Number(cursor);
  const firstRun = !Number.isFinite(cursorMs) || cursorMs <= 0;
  const sinceMs = firstRun ? Date.now() - backfillDays * 86_400_000 : cursorMs;

  const messages =
    (await ctx.imapFetch({
      host,
      port: configNumber(ctx, 'port', 993, 1, 65_535),
      username,
      password,
      folder,
      sinceMs,
      max: MAX_BATCH,
    })) ?? [];
  ctx.onProgress?.(`${messages.length} messages`);

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
      id: emailId(msg, host, folder),
      type: 'email_received',
      occurredAt: msg.dateMs,
      title: subject || '(no subject)',
      summary: [from, subject || '(no subject)'].filter(Boolean).join(' · '),
      actor: {
        type: 'mailbox',
        identityKey: `${username}@${host}`,
        displayName: username,
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
        from,
        to: msg.to ?? '',
        subject,
        folder,
        snippet: msg.snippet ?? '',
      },
    });
    if (msg.dateMs > newest) newest = msg.dateMs;
  }
  // No new mail on the first run → anchor the cursor at now so the next poll
  // doesn't refetch the whole backfill window.
  return { events, nextCursor: String(newest > 0 ? newest : Date.now()) };
}
