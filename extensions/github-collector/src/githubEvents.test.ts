/**
 * Fixture-based collect() tests: ctx.http stubbed per-URL with canned GitHub
 * event JSON — no network, same contract shape as the host's collectorHttp.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CollectorContext, CollectorEvent } from 'folyn-extension-sdk';
import { collectGithubEvents } from './githubEvents';

interface GhEvent {
  id: string;
  type: string;
  created_at: string;
  actor: { login: string };
  repo: { id: number; name: string; url: string };
  payload: Record<string, unknown>;
}

function pushEvent(createdAt: string, commits: { sha: string; message: string; author?: { name: string } }[]): GhEvent {
  return {
    id: '9001',
    type: 'PushEvent',
    created_at: createdAt,
    actor: { login: 'octocat' },
    repo: { id: 1, name: 'octocat/hello-world', url: 'https://api.github.com/repos/octocat/hello-world' },
    payload: { commits },
  };
}

const PUSH_2 = pushEvent('2026-01-02T10:00:00Z', [
  { sha: 'aaa111', message: 'first line\n\nbody', author: { name: 'Octo Cat' } },
  { sha: 'bbb222', message: 'second commit' },
]);

const PR_MERGED: GhEvent = {
  id: '9002',
  type: 'PullRequestEvent',
  created_at: '2026-01-02T11:00:00Z',
  actor: { login: 'octocat' },
  repo: { id: 1, name: 'octocat/hello-world', url: 'https://api.github.com/repos/octocat/hello-world' },
  payload: {
    action: 'closed',
    number: 42,
    pull_request: {
      number: 42,
      title: 'Add feature',
      html_url: 'https://github.com/octocat/hello-world/pull/42',
      state: 'closed',
      merged: true,
    },
  },
};

const ISSUE: GhEvent = {
  id: '9003',
  type: 'IssuesEvent',
  created_at: '2026-01-02T12:00:00Z',
  actor: { login: 'octocat' },
  repo: { id: 1, name: 'octocat/hello-world', url: 'https://api.github.com/repos/octocat/hello-world' },
  payload: {
    action: 'opened',
    number: 7,
    issue: {
      number: 7,
      title: 'Bug found',
      html_url: 'https://github.com/octocat/hello-world/issues/7',
      state: 'open',
    },
  },
};

/** Page-1 fixture: newest first, mixing types + cursor-relevant noise. */
const PAGE_1: GhEvent[] = [ISSUE, PR_MERGED, PUSH_2];

function makeCtx(
  pages: Record<string, GhEvent[]>,
  opts: { cursor?: string | null; username?: string; token?: string } = {},
): CollectorContext {
  return {
    cursor: opts.cursor ?? null,
    config: { username: opts.username ?? 'octocat', token: opts.token ?? '' },
    http: vi.fn(async (url: string) => {
      // Unmapped URLs = an empty page (GitHub runs out of events).
      return { status: 200, body: JSON.stringify(pages[url] ?? []) };
    }),
  };
}

function pageUrl(username: string, token: string, page: number): string {
  const path = token ? 'events' : 'events/public';
  return `https://api.github.com/users/${username}/${path}?per_page=100&page=${page}`;
}

describe('collectGithubEvents', () => {
  it('is a no-op without a username (cursor untouched)', async () => {
    const ctx = makeCtx({}, { username: '', cursor: 'x' });
    expect(await collectGithubEvents(ctx)).toEqual({ events: [], nextCursor: 'x' });
    expect(ctx.http).not.toHaveBeenCalled();
  });

  it('throws without ctx.http', async () => {
    await expect(
      collectGithubEvents({ cursor: null, config: { username: 'octocat' } }),
    ).rejects.toThrow(/requires ctx\.http/);
  });

  it('maps a PushEvent to one commit event per commit (stable ids)', async () => {
    const ctx = makeCtx({ [pageUrl('octocat', '', 1)]: [PUSH_2] });
    const { events, nextCursor } = await collectGithubEvents(ctx);
    expect(events).toHaveLength(2);
    const [e1, e2] = events as CollectorEvent[];
    expect(e1.id).toBe('github:octocat/hello-world:aaa111');
    expect(e2.id).toBe('github:octocat/hello-world:bbb222');
    expect(e1).toMatchObject({
      type: 'commit',
      occurredAt: Date.parse('2026-01-02T10:00:00Z'),
      title: 'first line',
      summary: 'octocat: first line',
      url: 'https://github.com/octocat/hello-world/commit/aaa111',
      actor: { type: 'person', identityKey: 'octocat', displayName: 'octocat' },
    });
    // Unnamed commit author falls back to the pusher's login.
    expect(e2.payload).toMatchObject({ sha: 'bbb222', author: 'octocat', repo: 'octocat/hello-world' });
    expect(e1.entities?.[0]).toMatchObject({
      type: 'repository',
      identityKey: 'https://github.com/octocat/hello-world',
      displayName: 'octocat/hello-world',
      relation: 'commit',
    });
    expect(nextCursor).toBe('2026-01-02T10:00:00Z');
  });

  it('maps a merged PullRequestEvent with action "merged"', async () => {
    const ctx = makeCtx({ [pageUrl('octocat', '', 1)]: [PR_MERGED] });
    const { events } = await collectGithubEvents(ctx);
    const [e] = events as CollectorEvent[];
    expect(e).toMatchObject({
      id: 'github:pr:octocat/hello-world:42:merged',
      type: 'github_pr',
      title: 'octocat/hello-world · PR #42 merged: Add feature',
      url: 'https://github.com/octocat/hello-world/pull/42',
    });
    expect(e.payload).toMatchObject({ prNumber: 42, action: 'merged', repo: 'octocat/hello-world', state: 'closed' });
    expect(e.entities?.[0]).toMatchObject({ type: 'repository', relation: 'pr' });
  });

  it('maps an IssuesEvent', async () => {
    const ctx = makeCtx({ [pageUrl('octocat', '', 1)]: [ISSUE] });
    const { events } = await collectGithubEvents(ctx);
    const [e] = events as CollectorEvent[];
    expect(e).toMatchObject({
      id: 'github:issue:octocat/hello-world:7:opened',
      type: 'github_issue',
      title: 'octocat/hello-world · Issue #7 opened: Bug found',
      url: 'https://github.com/octocat/hello-world/issues/7',
    });
    expect(e.payload).toMatchObject({ issueNumber: 7, action: 'opened', repo: 'octocat/hello-world', state: 'open' });
    expect(e.entities?.[0]).toMatchObject({ type: 'repository', relation: 'issue' });
  });

  it('skips events at/before the cursor; nextCursor = newest seen', async () => {
    // PR (11:00) and Issue (12:00) are after the cursor; the push (10:00) is not.
    const ctx = makeCtx({ [pageUrl('octocat', '', 1)]: PAGE_1 }, { cursor: '2026-01-02T10:30:00Z' });
    const { events, nextCursor } = await collectGithubEvents(ctx);
    expect(events.map((e) => e.type).sort()).toEqual(['github_issue', 'github_pr']);
    expect(nextCursor).toBe('2026-01-02T12:00:00Z');
  });

  it('keeps the old cursor when nothing is new', async () => {
    const ctx = makeCtx({ [pageUrl('octocat', '', 1)]: PAGE_1 }, { cursor: '2026-01-02T23:00:00Z' });
    const { events, nextCursor } = await collectGithubEvents(ctx);
    expect(events).toEqual([]);
    expect(nextCursor).toBe('2026-01-02T23:00:00Z');
  });

  it('stops paginating when a page is fully covered by the cursor', async () => {
    const ctx = makeCtx({
      [pageUrl('octocat', '', 1)]: PAGE_1,
      [pageUrl('octocat', '', 2)]: [PUSH_2],
    });
    await collectGithubEvents({ ...ctx, cursor: '2026-01-02T12:00:01Z' });
    expect(ctx.http).toHaveBeenCalledTimes(1);
  });

  it('authenticates with a token: authed endpoint, Bearer header, token absent from events', async () => {
    const seen: { url: string; headers?: Record<string, string> }[] = [];
    const ctx: CollectorContext = {
      cursor: null,
      config: { username: 'octocat', token: 'ghp_secret' },
      http: vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
        seen.push({ url, headers: init?.headers });
        const body = url.includes('page=1') ? [PR_MERGED] : [];
        return { status: 200, body: JSON.stringify(body) };
      }),
    };
    const { events } = await collectGithubEvents(ctx);
    expect(seen[0]!.url).toContain('/users/octocat/events?');
    expect(seen[0]!.headers).toMatchObject({
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ghp_secret',
    });
    expect(JSON.stringify(events)).not.toContain('ghp_secret');
  });

  it('uses the public endpoint and no Authorization header without a token', async () => {
    const ctx = makeCtx({ [pageUrl('octocat', '', 1)]: [PUSH_2] });
    await collectGithubEvents(ctx);
    // vi.fn calls are argument tuples: [url, init].
    const [url, init] = (ctx.http as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [
      string,
      { headers?: Record<string, string> },
    ];
    expect(url).toBe(pageUrl('octocat', '', 1));
    expect(init?.headers?.Authorization).toBeUndefined();
    expect(JSON.stringify(init)).not.toContain('ghp');
  });

  it('throws a descriptive error on non-200', async () => {
    const ctx: CollectorContext = {
      cursor: null,
      config: { username: 'octocat' },
      http: vi.fn(async () => ({ status: 403, body: 'rate limited' })),
    };
    await expect(collectGithubEvents(ctx)).rejects.toThrow(/status 403/);
  });
});
