/**
 * The IMAP client against a scripted server: `server` maps each command the
 * client sends to the bytes the server answers, split into small chunks so
 * lines and literals arrive across reads, as over TCP.
 */
import { describe, it, expect } from 'vitest';
import type { ExtensionSocket } from 'folyn-extension-sdk';
import { addresses, fetchMail, mailBody, mailboxName, parseResponse, quoted, ResponseReader, sinceDate } from './imap';

const enc = new TextEncoder();

/** A socket whose server answers each tagged command from `replies`
 *  (keyed by the command word, `$tag` replaced). Records what was sent. */
function scriptedServer(greeting: string, replies: Record<string, string>, chunk = 7) {
  const sent: string[] = [];
  const queue: Uint8Array[] = [];
  const push = (text: string) => {
    const bytes = enc.encode(text);
    for (let i = 0; i < bytes.length; i += chunk) queue.push(bytes.subarray(i, i + chunk));
  };
  push(greeting);
  let closed = false;
  const socket: ExtensionSocket = {
    async read() { return closed && queue.length === 0 ? null : queue.shift() ?? null; },
    async write(data) {
      const line = typeof data === 'string' ? data : new TextDecoder().decode(data);
      sent.push(line);
      const [tag, word, maybeSecond] = line.trim().split(' ');
      const key = word === 'UID' ? `UID ${maybeSecond}` : word!;
      const reply = replies[key];
      if (reply === undefined) throw new Error(`unscripted command: ${line}`);
      push(reply.replaceAll('$tag', tag!));
    },
    async close() { closed = true; },
    error: null,
  };
  return { socket, sent };
}

const MESSAGE = [
  'Message-ID: <m1@x>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="4a32dc26"',
  '',
  '--4a32dc26',
  'Content-Type: text/plain; charset="utf-8"',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Kilo Weekly =F0=9F=8F=86',
  'Read more =E2=86=92',
  '--4a32dc26',
  'Content-Type: text/html; charset="utf-8"',
  'Content-Transfer-Encoding: base64',
  '',
  'PGh0bWw+PGJvZHk+aGkgdGhlcmU8L2JvZHk+PC9odG1sPg==',
  '--4a32dc26--',
  '',
].join('\r\n');
const literal = (s: string) => `{${enc.encode(s).length}}\r\n${s}`;

describe('mailBody (the Rust fixtures)', () => {
  it('decodes a multipart message: QP text/plain and base64 text/html', async () => {
    expect(await mailBody(MESSAGE)).toEqual({
      plain: 'Kilo Weekly 🏆\nRead more →',
      html: '<html><body>hi there</body></html>',
    });
  });

  it('decodes a single-part GBK quoted-printable body, with no html', async () => {
    const raw = 'Content-Type: text/plain; charset=gbk\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n=D6=D0=CE=C4=D5=FD=CE=C4';
    expect(await mailBody(raw)).toEqual({ plain: '中文正文', html: null });
  });

  it('takes each only from a part of its own type (no text synthesized from html)', async () => {
    expect(await mailBody('Content-Type: text/html\r\n\r\n<p>only html</p>')).toEqual({ plain: null, html: '<p>only html</p>' });
  });

  it('yields nothing for garbage or an empty message', async () => {
    expect(await mailBody(Uint8Array.from([0xff, 0xfe, 0x00, 0x01, 0x02]))).toEqual({ plain: null, html: null });
    expect(await mailBody('')).toEqual({ plain: null, html: null });
  });

  it('caps the snippet at 2000 characters', async () => {
    const { plain } = await mailBody(`Content-Type: text/plain\r\n\r\n${'a'.repeat(5000)}`);
    expect([...plain!].length).toBe(2000);
  });
});

describe('protocol helpers (the Rust fixtures)', () => {
  it('sinceDate is one day earlier, UTC', () => {
    expect(sinceDate(1_790_553_600_000)).toBe('27-Sep-2026');
    // A month boundary rolls back properly.
    expect(sinceDate(Date.UTC(2026, 2, 1))).toBe('28-Feb-2026');
  });

  it('mailboxName quotes when needed and rejects what it cannot encode', () => {
    expect(mailboxName('INBOX')).toBe('INBOX');
    expect(mailboxName('Sent Items')).toBe('"Sent Items"');
    expect(mailboxName('we"ird')).toBe('"we\\"ird"');
    expect(mailboxName('a\\b')).toBe('"a\\\\b"');
    expect(() => mailboxName('中文')).toThrow();
    expect(() => mailboxName('bad\nname')).toThrow();
    expect(() => mailboxName('')).toThrow();
  });

  it('quoted escapes quotes and backslashes and refuses line breaks', () => {
    expect(quoted('p"a\\ss')).toBe('"p\\"a\\\\ss"');
    expect(() => quoted('a\r\nb')).toThrow();
  });

  it('addresses formats names and plain addresses, NIL-safe', () => {
    expect(addresses([['Alice', null, 'alice', 'x.com'], [null, null, 'bob', 'y.org']])).toBe('Alice <alice@x.com>, bob@y.org');
    expect(addresses(null)).toBeNull();
    expect(addresses([])).toBeNull();
  });
});

describe('ResponseReader', () => {
  it('reads a literal holding CRLFs and parentheses whole, across small chunks', async () => {
    const body = 'a (b)\r\n"c" {9}\r\n';
    const bytes = enc.encode(`* 1 FETCH (UID 5 BODY[]<0> ${literal(body)} FLAGS (\\Seen))\r\na1 OK done\r\n`);
    let pos = 0;
    const reader = new ResponseReader(async () => (pos < bytes.length ? bytes.subarray(pos, (pos += 3)) : null));
    const r = await reader.read();
    expect(r!.items).toEqual(['1', 'FETCH', ['UID', '5', 'BODY[]<0>', body, 'FLAGS', ['\\Seen']]]);
    expect((await reader.read())!.text).toBe('OK done');
    expect(await reader.read()).toBeNull();
  });

  it('parses quoted strings with escapes and NIL', () => {
    expect(parseResponse([{ text: '* X ("a \\"q\\"" NIL atom)' }]).items).toEqual(['X', ['a "q"', null, 'atom']]);
  });
});

describe('fetchMail', () => {
  const opts = { host: 'imap.x', port: 993, username: 'me@x', password: 'p"w', folder: 'INBOX', sinceMs: 1_790_553_600_000, max: 100 };
  const connect = (socket: ExtensionSocket) => async () => socket;

  it('logs in, identifies, searches since the day before, fetches and parses the messages', async () => {
    const fetchLine =
      `* 1 FETCH (UID 41 INTERNALDATE "28-Sep-2026 09:15:00 +0800" ENVELOPE ("Mon, 28 Sep 2026 09:15:00 +0800" ` +
      `"=?UTF-8?B?5L2g5aW9?=" (("Alice" NIL "alice" "x.com")) NIL NIL (("Me" NIL "me" "x")) NIL NIL NIL "<m1@x>") ` +
      `BODY[]<0> ${literal(MESSAGE)})\r\n`;
    const { socket, sent } = scriptedServer('* OK IMAP ready\r\n', {
      LOGIN: '$tag OK LOGIN completed\r\n',
      ID: '* ID ("name" "Coremail")\r\n$tag OK ID completed\r\n',
      EXAMINE: '* 3 EXISTS\r\n$tag OK [READ-ONLY] EXAMINE completed\r\n',
      'UID SEARCH': '* SEARCH 41\r\n$tag OK SEARCH completed\r\n',
      'UID FETCH': `${fetchLine}$tag OK FETCH completed\r\n`,
      LOGOUT: '* BYE\r\n$tag OK LOGOUT completed\r\n',
    });
    const messages = await fetchMail(connect(socket), opts, '0.1.0');

    expect(sent.map((l) => l.split(' ').slice(1, 3).join(' ').trim())).toEqual([
      'LOGIN "me@x"', 'ID ("name"', 'EXAMINE INBOX', 'UID SEARCH', 'UID FETCH', 'LOGOUT',
    ]);
    expect(sent[0]).toBe('a1 LOGIN "me@x" "p\\"w"\r\n');
    expect(sent[3]).toBe('a4 UID SEARCH SINCE 27-Sep-2026\r\n');
    expect(sent[4]).toBe('a5 UID FETCH 41 (UID ENVELOPE INTERNALDATE BODY.PEEK[]<0.262144>)\r\n');
    expect(messages).toEqual([{
      uid: 41,
      messageId: '<m1@x>',
      // Encoded words stay raw here; the collector decodes them (decodeMimeHeader).
      subject: '=?UTF-8?B?5L2g5aW9?=',
      from: 'Alice <alice@x.com>',
      to: 'Me <me@x>',
      dateMs: Date.parse('2026-09-28T09:15:00+08:00'),
      snippet: 'Kilo Weekly 🏆\nRead more →',
      bodyHtml: '<html><body>hi there</body></html>',
    }]);
  });

  it('keeps only the newest `max` UIDs', async () => {
    const { socket, sent } = scriptedServer('* OK\r\n', {
      LOGIN: '$tag OK\r\n', ID: '$tag BAD unknown command\r\n', EXAMINE: '$tag OK\r\n',
      'UID SEARCH': '* SEARCH 9 3 7 5\r\n$tag OK\r\n', 'UID FETCH': '$tag OK\r\n', LOGOUT: '$tag OK\r\n',
    });
    await fetchMail(connect(socket), { ...opts, max: 2 }, '0.1.0');
    expect(sent.find((l) => l.includes('UID FETCH'))).toContain('UID FETCH 7,9 ');
  });

  it('fetches nothing when the search finds nothing, and still logs out', async () => {
    const { socket, sent } = scriptedServer('* OK\r\n', {
      LOGIN: '$tag OK\r\n', ID: '$tag OK\r\n', EXAMINE: '$tag OK\r\n', 'UID SEARCH': '* SEARCH\r\n$tag OK\r\n', LOGOUT: '$tag OK\r\n',
    });
    expect(await fetchMail(connect(socket), opts, '0.1.0')).toEqual([]);
    expect(sent.some((l) => l.includes('UID FETCH'))).toBe(false);
    expect(sent.at(-1)).toContain('LOGOUT');
  });

  it('reports a failed login with the server text', async () => {
    const { socket } = scriptedServer('* OK\r\n', { LOGIN: '$tag NO [AUTHENTICATIONFAILED] Invalid credentials\r\n', LOGOUT: '$tag OK\r\n' });
    await expect(fetchMail(connect(socket), opts, '0.1.0')).rejects.toThrow('login to imap.x failed: NO [AUTHENTICATIONFAILED] Invalid credentials');
  });

  it('rejects an invalid host or folder before connecting', async () => {
    let connected = false;
    const never = async () => { connected = true; throw new Error('should not connect'); };
    await expect(fetchMail(never, { ...opts, host: 'a b' }, '0.1.0')).rejects.toThrow(/invalid host/);
    await expect(fetchMail(never, { ...opts, folder: '中文' }, '0.1.0')).rejects.toThrow(/invalid folder/);
    expect(connected).toBe(false);
  });

  it('fails clearly when the server closes mid-session', async () => {
    const { socket } = scriptedServer('* OK\r\n', { LOGIN: '', LOGOUT: '' });
    await socket.close();
    await expect(fetchMail(connect(socket), opts, '0.1.0')).rejects.toThrow(/connection closed during/);
  });
});
