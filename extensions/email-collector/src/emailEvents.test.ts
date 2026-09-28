/**
 * Fixture-based collect() tests: ctx.imapFetch stubbed with canned messages —
 * no network, same message shape as the Rust `activity_imap_fetch` output.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CollectorContext, CollectorEvent } from 'folyn-extension-sdk';
import { collectEmailEvents, decodeMimeHeader, emailId, errorText, inferImapHost, parseAccounts, senderAddress, type ImapFetchedMessage } from './emailEvents';

function msg(partial: Partial<ImapFetchedMessage>): ImapFetchedMessage {
  return {
    uid: 1,
    messageId: '<abc@example.com>',
    subject: 'Hello',
    from: 'Alice <alice@example.com>',
    to: 'Bob <bob@example.com>',
    dateMs: 1_000,
    snippet: 'hi there',
    ...partial,
  };
}

function ctx(config: Record<string, unknown>, cursor: string | null, messages: ImapFetchedMessage[]): CollectorContext {
  return {
    cursor,
    config,
    imapFetch: vi.fn().mockResolvedValue(messages),
  } as unknown as CollectorContext;
}

const CFG = {
  username: 'bob@example.com',
  password: 'secret',
  folder: 'INBOX',
  backfillDays: 30,
};

const MULTI = {
  accounts: [
    { username: 'a@example.com', password: 'p1' },
    { username: 'b@example.com', password: 'p2', folder: 'Archive' },
  ],
};

describe('collectEmailEvents', () => {
  it('unconfigured → no fetch, cursor untouched', async () => {
    const c = { ...CFG, username: '' } as Record<string, unknown>;
    const fetch = vi.fn();
    const out = await collectEmailEvents({
      cursor: '123',
      config: c,
      imapFetch: fetch as never,
    } as unknown as CollectorContext);
    expect(out.events).toEqual([]);
    expect(out.nextCursor).toBe('123');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('infers the IMAP host from the username when host is blank', async () => {
    const c = ctx({ ...CFG, host: '' }, null, [msg({})]);
    await collectEmailEvents(c);
    const called = (c.imapFetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { host: string };
    expect(called.host).toBe('imap.example.com');
  });

  it('maps messages to email_received events with sender actor + mailbox entity', async () => {
    const out = await collectEmailEvents(ctx(CFG, null, [msg({})]));
    expect(out.events).toHaveLength(1);
    const ev = out.events[0]!;
    expect(ev.id).toBe('email:<abc@example.com>');
    expect(ev.type).toBe('email_received');
    expect(ev.occurredAt).toBe(1_000);
    expect(ev.title).toBe('Hello');
    // The mailbox is the hub: actor = mailbox, edges mailbox→self and
    // mailbox→sender — click the mailbox node to see all senders.
    expect(ev.actor).toEqual({
      type: 'mailbox',
      identityKey: 'bob@example.com@imap.example.com',
      displayName: 'bob@example.com',
    });
    expect(ev.entities).toEqual([
      {
        type: 'person',
        identityKey: 'self',
        displayName: '我',
        relation: '归属',
      },
      {
        type: 'person',
        identityKey: 'alice@example.com',
        displayName: 'Alice <alice@example.com>',
        relation: '发件人',
      },
    ]);
    expect(ev.payload).toMatchObject({ mailbox: 'bob@example.com', from: 'Alice <alice@example.com>', folder: 'INBOX' });
    // Password never reaches the event.
    expect(JSON.stringify(ev)).not.toContain('secret');
    expect(JSON.parse(out.nextCursor)).toEqual({ 'bob@example.com|INBOX': 1000 });
  });

  it('filters at the cursor (SINCE day-slack overlap) and advances to newest', async () => {
    const M2 = msg({ uid: 2, messageId: '<two@example.com>', dateMs: 2_000 });
    const M3 = msg({ uid: 3, messageId: '<three@example.com>', dateMs: 3_000 });
    // Legacy bare-number cursor belongs to the (migrated) first account.
    const out = await collectEmailEvents(ctx(CFG, '2000', [msg({}), M2, M3]));
    // dateMs <= cursor filtered: uid1 (1000) and uid2 (2000) gone.
    expect(out.events.map((e) => e.id)).toEqual(['email:<three@example.com>']);
    expect(JSON.parse(out.nextCursor)).toEqual({ 'bob@example.com|INBOX': 3000 });
  });

  it('first run passes backfill sinceMs; empty result anchors cursor at now', async () => {
    const before = Date.now();
    const c = ctx(CFG, null, []);
    const out = await collectEmailEvents(c);
    expect(out.events).toEqual([]);
    expect(JSON.parse(out.nextCursor)['bob@example.com|INBOX']).toBeGreaterThanOrEqual(before);
    const called = (c.imapFetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { sinceMs: number };
    const days = (Date.now() - called.sinceMs) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });

  it('id falls back to host:folder:uid without Message-ID', async () => {
    const out = await collectEmailEvents(ctx(CFG, null, [msg({ messageId: null, uid: 42 })]));
    expect(out.events[0]!.id).toBe('email:imap.example.com:INBOX:42');
  });

  it('falls back to a plain from string for the sender entity', async () => {
    const out = await collectEmailEvents(ctx(CFG, null, [msg({ from: 'plain@example.com' })]));
    const sender = out.events[0]!.entities![1]!;
    expect(sender.identityKey).toBe('plain@example.com');
    expect(sender.displayName).toBe('plain@example.com');
  });

  const multiCtx = (cursor: string | null, failUsernames: string[] = []) => {
    const imapFetch = vi.fn(async (args: { username: string; sinceMs: number }) => {
      if (failUsernames.includes(args.username)) throw new Error('auth failed');
      return [msg({ messageId: `<${args.username}@x>`, dateMs: 5_000 })];
    });
    return {
      cursor,
      config: MULTI,
      imapFetch,
    } as unknown as CollectorContext & { imapFetch: ReturnType<typeof vi.fn> };
  }

  it('collects every account with an independent cursor', async () => {
    const cursor = JSON.stringify({ 'a@example.com|INBOX': 4_000, 'b@example.com|Archive': 6_000 });
    const c = multiCtx(cursor);
    const out = await collectEmailEvents(c);
    // a@example.com: 5000 > 4000 → kept; b@example.com: 5000 <= 6000 → filtered.
    expect(out.events.map((e) => e.id)).toEqual(['email:<a@example.com@x>']);
    // Every event stamps its receiving mailbox into the payload.
    expect(out.events[0]!.payload).toMatchObject({ mailbox: 'a@example.com' });
    expect(JSON.parse(out.nextCursor)).toEqual({
      'a@example.com|INBOX': 5_000,
      'b@example.com|Archive': 6_000,
    });
    // A second call: imapFetch got one call per account.
    expect(c.imapFetch).toHaveBeenCalledTimes(2);
  });

  it('an account without a cursor entry backfills (first-run sinceMs)', async () => {
    const cursor = JSON.stringify({ 'a@example.com|INBOX': 4_000 });
    const c = multiCtx(cursor);
    await collectEmailEvents(c);
    const calls = (c.imapFetch as ReturnType<typeof vi.fn>).mock.calls as Array<
      [{ username: string; sinceMs: number }]
    >;
    const byUser = Object.fromEntries(calls.map(([a]) => [a.username, a]));
    expect(byUser['a@example.com']!.sinceMs).toBe(4_000);
    expect(Date.now() - byUser['b@example.com']!.sinceMs).toBeLessThan(86_400_000 * 31);
  });

  it('one failing account does not block the others and keeps its cursor', async () => {
    const cursor = JSON.stringify({ 'a@example.com|INBOX': 4_000 });
    const c = multiCtx(cursor, ['a@example.com']);
    const out = await collectEmailEvents(c);
    // b (the healthy account) still produced its event.
    expect(out.events.map((e) => e.id)).toEqual(['email:<b@example.com@x>']);
    // a's cursor unchanged, b advanced.
    expect(JSON.parse(out.nextCursor)).toEqual({
      'a@example.com|INBOX': 4_000,
      'b@example.com|Archive': 5_000,
    });
  });

  it('all accounts failing → throws with per-account messages', async () => {
    const c = multiCtx(null, ['a@example.com', 'b@example.com']);
    await expect(collectEmailEvents(c)).rejects.toThrow(/a@example.com: auth failed/);
  });

  it('all accounts failing → throws with the AppError-shaped message (no [object Object])', async () => {
    const imapFetch = vi.fn(async () => {
      throw { category: 'internal', detail: 'imap: login failed' };
    });
    const c = {
      cursor: null,
      config: MULTI,
      imapFetch,
    } as unknown as CollectorContext;
    await expect(collectEmailEvents(c)).rejects.toThrow(
      'a@example.com: internal: imap: login failed; b@example.com: internal: imap: login failed',
    );
  });
});

describe('helpers', () => {
  it('decodeMimeHeader: multi-word Q with CJK (the Gmail case)', () => {
    const raw =
      '=?UTF-8?Q?[Task_Update]_=E6=AF=8F=E6=97=A5=E7=B2=BE=E9=80=89=E6=96=87?= =?UTF-8?Q?=E7=AB=A0:_Agent_harness_rea?= =?UTF-8?Q?ding_list_for_deeper_evaluation_insights?=';
    // Q-encoding: `_` is an encoded space → [Task Update], and the whitespace
    // between adjacent encoded words is dropped.
    expect(decodeMimeHeader(raw)).toBe(
      '[Task Update] 每日精选文章: Agent harness reading list for deeper evaluation insights',
    );
  });

  it('decodeMimeHeader: B-encoded utf-8, plain text, null', () => {
    expect(decodeMimeHeader('=?UTF-8?B?5L2g5aW9?=')) // 你好
      .toBe('你好');
    expect(decodeMimeHeader('plain subject')).toBe('plain subject');
    expect(decodeMimeHeader(null)).toBeNull();
  });

  it('decodeMimeHeader: gbk charset + mixed encoded/plain parts', () => {
    // 每日 in GBK Q-encoding.
    expect(decodeMimeHeader('=?GBK?Q?=C3=BF=C8=D5?=')) // 每日
      .toBe('每日');
    expect(decodeMimeHeader('re: =?UTF-8?B?5L2g5aW9?= =?UTF-8?B?5aW9?=(1)')).toBe('re: 你好好(1)');
  });

  it('decodeMimeHeader: encoded display name before an address', () => {
    const raw = '=?UTF-8?B?5byg5LiJ?= <zhang@example.com>';
    expect(decodeMimeHeader(raw)).toBe('张三 <zhang@example.com>');
  });

  it('parseAccounts: accounts array with defaults, legacy flat config, junk skipped', () => {
    expect(parseAccounts(MULTI)).toEqual([
      { username: 'a@example.com', password: 'p1', host: '', port: 993, folder: 'INBOX', backfillDays: 30 },
      { username: 'b@example.com', password: 'p2', host: '', port: 993, folder: 'Archive', backfillDays: 30 },
    ]);
    expect(parseAccounts(CFG)).toHaveLength(1);
    expect(parseAccounts({ username: 'x@y.com' })).toEqual([]);
    expect(parseAccounts({ accounts: [{ username: 'x@y.com' }, null, 'junk'] })).toEqual([]);
    expect(parseAccounts(undefined)).toEqual([]);
  });

  it('errorText: Error, AppError object, message object, string', () => {
    expect(errorText(new Error('boom'))).toBe('boom');
    expect(errorText({ category: 'io', detail: 'dns' })).toBe('io: dns');
    expect(errorText({ message: 'm' })).toBe('m');
    expect(errorText('raw')).toBe('raw');
    expect(errorText(42)).toBe('42');
  });

  it('inferImapHost: known table + imap.<domain> fallback + no domain', () => {
    expect(inferImapHost('a@gmail.com')).toBe('imap.gmail.com');
    expect(inferImapHost('a@QQ.COM')).toBe('imap.qq.com');
    expect(inferImapHost('a@163.com')).toBe('imap.163.com');
    expect(inferImapHost('a@outlook.com')).toBe('outlook.office365.com');
    expect(inferImapHost('a@fastmail.com')).toBe('imap.fastmail.com');
    expect(inferImapHost('a@example.cn')).toBe('imap.example.cn');
    expect(inferImapHost('no-at-sign')).toBe('');
  });

  it('senderAddress extracts angle-bracket and bare forms', () => {
    expect(senderAddress('Alice <alice@example.com>')).toBe('alice@example.com');
    expect(senderAddress('plain@example.com')).toBe('plain@example.com');
    expect(senderAddress(null)).toBe('unknown');
    expect(senderAddress('   ')).toBe('unknown');
  });

  it('emailId prefers Message-ID and trims it', () => {
    expect(emailId(msg({ messageId: '  <x@y>  ' }), 'h', 'INBOX')).toBe('email:<x@y>');
    expect(emailId(msg({ messageId: null, uid: 7 }), 'h', 'F')).toBe('email:h:F:7');
  });
});
