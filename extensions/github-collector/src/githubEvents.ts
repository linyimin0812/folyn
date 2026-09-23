/**
 * GitHub event-stream collection (poll mode, personal activity).
 *
 * Polls `api.github.com/users/<login>/events[.public]` since the cursor (an
 * ISO-8601 `created_at` of the newest already-ingested mapped event) and maps
 * push/pr/issue activity to standard CollectorEvents. Dedup is host-side
 * (insert-ignore on stable `github:...` ids), so a boundary overlap at the
 * cursor is harmless.
 *
 * The token is only ever used in the Authorization header — it never appears
 * in event payloads or the raw event text we keep.
 */
import type { CollectorContext, CollectorEvent } from 'folyn-extension-sdk';

const API_ROOT = 'https://api.github.com';
/** Events endpoint pages we are willing to walk per poll (300 events max). */
const MAX_PAGES = 3;
const PER_PAGE = 100;

interface GhEvent {
  id: string;
  type: string;
  created_at: string;
  actor: { login: string };
  repo: { id: number; name: string; url: string };
  payload: {
    commits?: { sha: string; author?: { name?: string }; message: string }[];
    action?: string;
    number?: number;
    pull_request?: {
      number: number;
      title: string;
      html_url: string;
      state: string;
      merged?: boolean;
    };
    issue?: { number: number; title: string; html_url: string; state: string };
    [key: string]: unknown;
  };
}

/** GitHub's event `repo` object only carries the API url — derive the html one. */
function repoHtmlUrl(repoName: string): string {
  return `${API_ROOT.replace('api.', '')}/${repoName}`;
}

/** Config accessors (authSchema form values). */
function configString(ctx: CollectorContext, key: string): string {
  const v = ctx.config[key];
  return typeof v === 'string' ? v.trim() : '';
}

async function fetchPage(
  ctx: CollectorContext,
  username: string,
  token: string,
  page: number,
): Promise<GhEvent[]> {
  const path = token ? 'events' : 'events/public';
  const url = `${API_ROOT}/users/${encodeURIComponent(username)}/${path}?per_page=${PER_PAGE}&page=${page}`;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await ctx.http!(url, { headers });
  if (res.status !== 200) {
    throw new Error(`github events request failed (status ${res.status}): ${url}`);
  }
  return JSON.parse(res.body) as GhEvent[];
}

export async function collectGithubEvents(
  ctx: CollectorContext,
): Promise<{ events: CollectorEvent[]; nextCursor: string }> {
  const username = configString(ctx, 'username');
  const token = configString(ctx, 'token');
  const cursor = ctx.cursor ?? '';
  if (!username) {
    // Unconfigured — no events, cursor untouched.
    return { events: [], nextCursor: cursor };
  }
  if (!ctx.http) {
    throw new Error('github collector requires ctx.http');
  }

  const events: CollectorEvent[] = [];
  let newest = cursor;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageEvents = await fetchPage(ctx, username, token, page);
    if (pageEvents.length === 0) break;
    for (const ev of pageEvents) {
      // iso-8601 strings compare lexicographically as chronologically.
      if (cursor && ev.created_at <= cursor) continue;
      const created = Date.parse(ev.created_at);
      if (!Number.isFinite(created)) continue;
      events.push(...mapEvent(ev, created));
      if (!newest || ev.created_at > newest) newest = ev.created_at;
    }
    // Oldest entry already covered by the cursor — no need for more pages.
    const oldest = pageEvents[pageEvents.length - 1]!.created_at;
    if (cursor && oldest <= cursor) break;
  }
  return { events, nextCursor: newest };
}

/** Map one GitHub event to 0..n CollectorEvents. */
function mapEvent(ev: GhEvent, occurredAt: number): CollectorEvent[] {
  const login = ev.actor?.login ?? 'unknown';
  const repoName = ev.repo?.name ?? '';

  if (ev.type === 'PushEvent') {
    // ponytail: GitHub only includes the first 20 commits of a push — larger
    // pushes are under-counted; switch to the commit-by-commit REST endpoint
    // if that bites.
    return (ev.payload.commits ?? []).map((c): CollectorEvent => ({
      id: `github:${repoName}:${c.sha}`,
      type: 'commit',
      occurredAt,
      title: c.message.split('\n')[0] ?? c.sha,
      summary: `${login}: ${c.message.split('\n')[0] ?? ''}`,
      url: `${repoHtmlUrl(repoName)}/commit/${c.sha}`,
      actor: { type: 'person', identityKey: login, displayName: login },
      entities: [
        {
          type: 'repository',
          identityKey: repoHtmlUrl(repoName),
          displayName: repoName,
          relation: 'commit',
        },
      ],
      payload: { sha: c.sha, author: c.author?.name ?? login, repo: repoName },
    }));
  }

  if (ev.type === 'PullRequestEvent') {
    const pr = ev.payload.pull_request;
    if (!pr || !['opened', 'closed', 'reopened'].includes(ev.payload.action ?? '')) return [];
    const action = ev.payload.action === 'closed' && pr.merged ? 'merged' : ev.payload.action!;
    return [
      {
        id: `github:pr:${repoName}:${pr.number}:${action}`,
        type: 'github_pr',
        occurredAt,
        title: `${repoName} · PR #${pr.number} ${action}: ${pr.title}`,
        url: pr.html_url,
        actor: { type: 'person', identityKey: login, displayName: login },
        entities: [
          {
            type: 'repository',
            identityKey: repoHtmlUrl(repoName),
            displayName: repoName,
            relation: 'pr',
          },
        ],
        payload: { prNumber: pr.number, action, repo: repoName, state: pr.state },
      },
    ];
  }

  if (ev.type === 'IssuesEvent') {
    const issue = ev.payload.issue;
    if (!issue || !['opened', 'closed', 'reopened'].includes(ev.payload.action ?? '')) return [];
    return [
      {
        id: `github:issue:${repoName}:${issue.number}:${ev.payload.action}`,
        type: 'github_issue',
        occurredAt,
        title: `${repoName} · Issue #${issue.number} ${ev.payload.action}: ${issue.title}`,
        url: issue.html_url,
        actor: { type: 'person', identityKey: login, displayName: login },
        entities: [
          {
            type: 'repository',
            identityKey: repoHtmlUrl(repoName),
            displayName: repoName,
            relation: 'issue',
          },
        ],
        payload: {
          issueNumber: issue.number,
          action: ev.payload.action,
          repo: repoName,
          state: issue.state,
        },
      },
    ];
  }

  // ponytail: Watch/Star/Fork/Create/Release etc. — noise for a personal
  // activity timeline, skipped.
  return [];
}
