/**
 * End-to-end-ish collect() harness: drives a REAL temp git repo through the
 * same ctx.exec contract the host provides (node child_process behind the
 * same {stdout, stderr, exitCode} shape as the Rust activity_exec command).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { collectGitCommits, repoDisplayName } from './gitCommit';

const execFileAsync = promisify(execFile);

type ExecOut = { stdout: string; stderr: string; exitCode: number };

/** Mirror of the host's `ctx.exec` (activity_exec) in node. */
function nodeExec(program: string, args: string[], cwd: string): Promise<ExecOut> {
  return new Promise((resolve) => {
    execFile(program, args, { cwd }, (err, stdout, stderr) => {
      const code = (err as { code?: number | string } | null)?.code;
      resolve({
        stdout: String(stdout),
        stderr: String(stderr),
        exitCode: typeof code === 'number' ? code : err ? 1 : 0,
      });
    });
  });
}

const repo = mkdtempSync(join(tmpdir(), 'folyn-git-collector-'));
const DATES = [
  '2026-01-01T10:00:00Z',
  '2026-01-01T11:00:00Z',
  '2026-01-01T12:00:00Z',
];

function git(args: string[], env: Record<string, string> = {}) {
  return execFileAsync(
    'git',
    ['-c', 'user.name=Tester', '-c', 'user.email=tester@example.com', ...args],
    { cwd: repo, env: { ...process.env, ...env } },
  );
}

/** A deterministic commit at a fixed date. */
function commit(date: string, message: string) {
  return git(['commit', '--allow-empty', '-m', message], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
}

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('collectGitCommits', () => {
  it('collects a temp repo end-to-end: first run, cursor replay, new commit', async () => {
    await git(['init', '-q']);
    await commit(DATES[0]!, 'first');
    await commit(DATES[1]!, 'second');

    // First run (no cursor): both commits, cursor = newest author date.
    const first = await collectGitCommits({
      cursor: null,
      config: { repoPath: repo },
      exec: nodeExec,
    });
    expect(first.events.map((e) => e.title)).toEqual(['second', 'first']);
    expect(first.events[0]!.id).toMatch(/^git-commit:[0-9a-f]{40}$/);
    expect(first.events[0]).toMatchObject({
      id: `git-commit:${first.events[0]!.payload!.sha}`,
      type: 'commit',
      occurredAt: Date.parse(DATES[1]!),
      actor: { type: 'person', identityKey: 'Tester' },
    });
    expect(first.events[0]!.entities?.[0]).toMatchObject({
      type: 'repository',
      identityKey: repo,
      relation: 'commit',
    });
    expect(first.nextCursor).toBe(DATES[1]!);

    // Replay with the advanced cursor: nothing new, cursor unchanged.
    const replay = await collectGitCommits({
      cursor: first.nextCursor,
      config: { repoPath: repo },
      exec: nodeExec,
    });
    expect(replay.events).toEqual([]);
    expect(replay.nextCursor).toBe(first.nextCursor);

    // One new commit after the cursor: exactly that one.
    await commit(DATES[2]!, 'third');
    const second = await collectGitCommits({
      cursor: first.nextCursor,
      config: { repoPath: repo },
      exec: nodeExec,
    });
    expect(second.events.map((e) => e.title)).toEqual(['third']);
    expect(second.nextCursor).toBe(DATES[2]!);
  });

  it('is a no-op without a repoPath config (cursor untouched)', async () => {
    const out = await collectGitCommits({ cursor: 'x', config: {}, exec: nodeExec });
    expect(out).toEqual({ events: [], nextCursor: 'x' });
  });

  it('throws a descriptive error for a non-repo path', async () => {
    await expect(
      collectGitCommits({
        cursor: null,
        config: { repoPath: tmpdir() },
        exec: nodeExec,
      }),
    ).rejects.toThrow(/git log failed/);
  });
});

describe('repoDisplayName', () => {
  it('prefers the remote url basename, falls back to the path', () => {
    expect(repoDisplayName('/srv/work/folyn', 'git@github.com:linyimin/folyn.git')).toBe('folyn');
    expect(repoDisplayName('/srv/work/folyn', '')).toBe('folyn');
    expect(repoDisplayName('/srv/work/folyn/', '')).toBe('folyn');
  });
});
