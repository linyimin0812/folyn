/**
 * Git commit collection logic (design §2.3 official poll-mode reference).
 *
 * Reads `git log` in the configured repo since the cursor (an ISO-8601 author
 * timestamp of the newest already-ingested commit) and maps each commit to a
 * standard CollectorEvent. Dedup is host-side (insert-ignore on the stable
 * `git-commit:<sha>` id), so a boundary overlap at `--since` is harmless.
 *
 * ponytail: `--since` filters on commit date while the cursor tracks author
 * date — a rebased commit (commit date < author date) can be missed. Accept
 * for the reference impl; switch to a rev-list/sha cursor if that bites.
 */
import type { CollectorContext, CollectorEvent } from 'folyn-extension-sdk';

/** Unit separator — cannot appear in git field values. */
const SEP = '\x1f';
/** First-run cap so a huge repo doesn't ingest years of history in one shot. */
const FIRST_RUN_LIMIT = 500;

export function repoDisplayName(repoPath: string, remoteUrl: string): string {
  if (remoteUrl) {
    const base = remoteUrl.replace(/\.git$/, '').split('/').pop();
    if (base) return base;
  }
  const base = repoPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return base || repoPath;
}

export async function collectGitCommits(
  ctx: CollectorContext,
): Promise<{ events: CollectorEvent[]; nextCursor: string }> {
  const repoPath =
    typeof ctx.config.repoPath === 'string' ? ctx.config.repoPath.trim() : '';
  const cursor = ctx.cursor ?? '';
  if (!repoPath) {
    // Unconfigured or misconfigured — no events, cursor untouched.
    return { events: [], nextCursor: cursor };
  }
  if (!ctx.exec) {
    throw new Error('git-commit collector requires ctx.exec (host activity_exec)');
  }

  const logArgs = [
    '-c',
    'core.quotepath=false',
    'log',
    '--date=iso-strict',
    `--pretty=format:%H${SEP}%an${SEP}%aI${SEP}%s`,
  ];
  if (cursor) {
    // git needs the "since" marker to survive CLI parsing as one arg.
    logArgs.push(`--since=${cursor}`);
  } else {
    logArgs.push('-n', String(FIRST_RUN_LIMIT));
  }
  const log = await ctx.exec('git', logArgs, repoPath);
  if (log.exitCode !== 0) {
    throw new Error(`git log failed (exit ${log.exitCode}): ${log.stderr.trim()}`);
  }

  // Remote URL is best-effort — a repo without origin just gets no url.
  const remote = await ctx.exec('git', ['remote', 'get-url', 'origin'], repoPath);
  const remoteUrl = remote.exitCode === 0 ? remote.stdout.trim() : '';

  const events: CollectorEvent[] = [];
  let newest = cursor;
  for (const line of log.stdout.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split(SEP);
    if (parts.length < 4) continue;
    const [sha, author, authoredAt, ...rest] = parts;
    const subject = rest.join(SEP);
    const occurredAt = Date.parse(authoredAt);
    if (!sha || !author || !Number.isFinite(occurredAt)) continue;
    // `--since` includes its boundary, so also skip commits at/before the
    // cursor. ponytail: a *different* commit authored in the same second as
    // the cursor value waits until a later commit advances the cursor —
    // sub-second window, host insert-ignore makes the overlap harmless either
    // way; switch the cursor to a sha (`git log <sha>..HEAD`) if it bites.
    if (cursor && authoredAt <= cursor) continue;
    events.push({
      id: `git-commit:${sha}`,
      type: 'commit',
      occurredAt,
      title: subject,
      summary: `${author}: ${subject}`,
      url: remoteUrl
        ? `${remoteUrl.replace(/\.git$/, '')}/commit/${sha}`
        : undefined,
      actor: { type: 'person', identityKey: author, displayName: author },
      entities: [
        {
          type: 'repository',
          identityKey: remoteUrl || repoPath,
          displayName: repoDisplayName(repoPath, remoteUrl),
          relation: 'commit',
        },
      ],
      payload: { sha, author, authoredAt },
    });
    // iso-strict strings compare lexicographically as chronologically.
    if (!newest || authoredAt > newest) newest = authoredAt;
  }
  return { events, nextCursor: newest };
}
