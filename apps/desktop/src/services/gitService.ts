/**
 * Git shell service — orchestrates git operations (clone/pull/push/status)
 * for GitHub-type vaults via the existing `claude-cli` shell scope
 * (cmd `/bin/sh`, `args: true`). No new Tauri ACL needed.
 *
 * All shell strings are built by pure, unit-tested builders; only `runShell`
 * actually spawns, and it stays a thin wrapper (mirrors scriptRunnerService's
 * approach of not unit-testing the spawn itself).
 */

import { resolveBasePath } from '@/utils/pathResolver';

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Authentication method chosen at vault creation. */
export type GitAuthMethod = 'https-public' | 'https-private' | 'ssh';

/** Branch strategy stored in `VaultConfig.options.branchStrategy`. */
export interface BranchStrategy {
  mode: 'default' | 'new-branch';
  branch?: string;
}

/** ponytail: single-quote-escape with '\'' for embedded quotes. Sufficient
 *  for git args we construct; not a security boundary (inputs are ours). */
export function escapeShellArg(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Build the clone URL, injecting a PAT for private HTTPS repos.
 *  - ssh (`git@...`) → returned as-is, no token.
 *  - https + token → `https://<token>@host/...`, `.git` appended if missing.
 *  - https no token → as-is, `.git` appended if missing. */
export function buildCloneUrl(repoUrl: string, token?: string): string {
  const trimmed = repoUrl.trim();
  if (trimmed.startsWith('git@')) return trimmed;
  if (trimmed.startsWith('https://')) {
    const withoutScheme = trimmed.slice('https://'.length);
    // Already has credentials embedded — don't re-inject.
    if (withoutScheme.includes('@')) {
      return ensureDotGit(trimmed);
    }
    if (token) {
      return ensureDotGit(`https://${token}@${withoutScheme}`);
    }
    return ensureDotGit(trimmed);
  }
  // ponytail: assume https if no scheme — keeps the dialog forgiving.
  if (token) {
    return ensureDotGit(`https://${token}@${trimmed}`);
  }
  return ensureDotGit(`https://${trimmed}`);
}

function ensureDotGit(url: string): string {
  return url.endsWith('.git') ? url : `${url}.git`;
}

/** `git clone '<url>' '<path>'`. No `-C` — the target dir does not exist yet. */
export function buildCloneCommand(cloneUrl: string, targetPath: string): string {
  return `git clone ${escapeShellArg(cloneUrl)} ${escapeShellArg(targetPath)}`;
}

/** `git -C '<path>' checkout -b '<branch>'` — used after clone for new-branch. */
export function buildCheckoutBranchCommand(targetPath: string, branch: string): string {
  return `git -C ${escapeShellArg(targetPath)} checkout -b ${escapeShellArg(branch)}`;
}

/** `git -C '<path>' status --short`. */
export function buildStatusCommand(targetPath: string): string {
  return `git -C ${escapeShellArg(targetPath)} status --short`;
}

/** `git -C '<path>' pull`. */
export function buildPullCommand(targetPath: string): string {
  return `git -C ${escapeShellArg(targetPath)} pull`;
}

/**
 * `git -C '<path>' add -A && git commit -m '<msg>' && git push -u origin HEAD`.
 * Chained with `&&` so a failed step (e.g. nothing to commit) halts before
 * push. `push -u origin HEAD` sets upstream on first push for a new branch
 * and is a no-op when upstream already exists — one command covers both
 * branch strategies.
 */
export function buildCommitPushCommand(targetPath: string, message: string): string {
  return [
    `git -C ${escapeShellArg(targetPath)} add -A`,
    `git -C ${escapeShellArg(targetPath)} commit -m ${escapeShellArg(message)}`,
    `git -C ${escapeShellArg(targetPath)} push -u origin HEAD`,
  ].join(' && ');
}

/** Resolve a vault-relative/`~` basePath to an absolute path (for git -C).
 *  Reuses `utils/pathResolver.resolveBasePath` (shared with vaultStore). */
export const resolveAbsPath = resolveBasePath;

/**
 * Run a shell command string via the `claude-cli` sidecar (`/bin/sh -lc`).
 * Returns combined stdout/stderr and exit code. Throws on spawn failure.
 * ponytail: stderr is surfaced verbatim so git's real message reaches the
 * UI (auth failure, conflict, missing identity) instead of a vague mask.
 */
export async function runShell(shellCmd: string): Promise<GitResult> {
  const { Command } = await import('@tauri-apps/plugin-shell');
  const cmd = Command.create('claude-cli', ['-l', '-c', shellCmd]);
  let stdout = '';
  let stderr = '';
  cmd.stdout.on('data', (line) => { stdout += line + '\n'; });
  cmd.stderr.on('data', (line) => { stderr += line + '\n'; });
  // Register close listener before spawn (race-safe), then await it after
  // spawn so we don't return before the process exits.
  const closePromise = new Promise<number>((resolve) => {
    cmd.on('close', (payload: { code: number | null }) => resolve(payload.code ?? 0));
    cmd.on('error', () => resolve(1));
  });
  await cmd.spawn();
  const code = await closePromise;
  return { stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), code };
}

/** Clone a repo into `targetPath`. On `new-branch`, also create the branch.
 *  Returns the git result of the last step that ran. */
export async function cloneRepo(
  repoUrl: string,
  targetPath: string,
  opts: { auth: GitAuthMethod; token?: string; branch?: BranchStrategy },
): Promise<GitResult> {
  const cloneUrl = buildCloneUrl(repoUrl, opts.token);
  let result = await runShell(buildCloneCommand(cloneUrl, targetPath));
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || 'git clone failed');
  }
  if (opts.branch?.mode === 'new-branch' && opts.branch.branch) {
    result = await runShell(buildCheckoutBranchCommand(targetPath, opts.branch.branch));
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || 'git checkout -b failed');
    }
  }
  return result;
}

/** `git status --short` output for the panel. Empty string when clean. */
export async function getStatus(targetPath: string): Promise<string> {
  const result = await runShell(buildStatusCommand(targetPath));
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || 'git status failed');
  }
  return result.stdout;
}

/** `git pull`. Throws with stderr on failure (conflict / network). */
export async function pullRepo(targetPath: string): Promise<GitResult> {
  const result = await runShell(buildPullCommand(targetPath));
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || 'git pull failed');
  }
  return result;
}

/** commit+push. Throws with stderr on failure (e.g. missing user.name/email). */
export async function commitAndPush(targetPath: string, message: string): Promise<GitResult> {
  const result = await runShell(buildCommitPushCommand(targetPath, message));
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || 'git commit+push failed');
  }
  return result;
}
