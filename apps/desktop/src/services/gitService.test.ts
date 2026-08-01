import { describe, it, expect } from 'vitest';
import {
  escapeShellArg,
  buildCloneUrl,
  buildCloneCommand,
  buildCheckoutBranchCommand,
  buildStatusCommand,
  buildPullCommand,
  buildCommitPushCommand,
} from './gitService';

describe('gitService: escapeShellArg', () => {
  it('wraps a plain string in single quotes', () => {
    expect(escapeShellArg('path/with space')).toBe("'path/with space'");
  });

  it('escapes embedded single quotes', () => {
    // escapeShellArg("it's") === "'it'\\''s'"  (closes quote, escapes the ', reopens)
    expect(escapeShellArg("it's")).toBe("'it'\\''s'");
  });
});

describe('gitService: buildCloneUrl', () => {
  it('returns ssh URLs unchanged', () => {
    expect(buildCloneUrl('git@github.com:owner/repo.git')).toBe('git@github.com:owner/repo.git');
  });

  it('injects token into https URLs', () => {
    expect(buildCloneUrl('https://github.com/owner/repo', 'tok123')).toBe(
      'https://tok123@github.com/owner/repo.git',
    );
  });

  it('appends .git to https URLs without it', () => {
    expect(buildCloneUrl('https://github.com/owner/repo')).toBe('https://github.com/owner/repo.git');
  });

  it('does not re-inject token when credentials already embedded', () => {
    expect(buildCloneUrl('https://existing@github.com/owner/repo', 'tok123')).toBe(
      'https://existing@github.com/owner/repo.git',
    );
  });

  it('leaves public https URLs as-is (no token)', () => {
    expect(buildCloneUrl('https://github.com/owner/repo.git')).toBe(
      'https://github.com/owner/repo.git',
    );
  });

  it('assumes https for schemeless URLs and injects token', () => {
    expect(buildCloneUrl('github.com/owner/repo', 'tok')).toBe('https://tok@github.com/owner/repo.git');
  });
});

describe('gitService: command builders', () => {
  it('buildCloneCommand uses no -C (target dir does not exist yet)', () => {
    expect(buildCloneCommand('https://tok@github.com/o/r.git', '/tmp/r')).toBe(
      "git clone 'https://tok@github.com/o/r.git' '/tmp/r'",
    );
  });

  it('buildCheckoutBranchCommand uses git -C with checkout -b', () => {
    expect(buildCheckoutBranchCommand('/tmp/r', 'feature-x')).toBe(
      "git -C '/tmp/r' checkout -b 'feature-x'",
    );
  });

  it('buildStatusCommand uses git -C status --short', () => {
    expect(buildStatusCommand('/tmp/r')).toBe("git -C '/tmp/r' status --short");
  });

  it('buildPullCommand uses git -C pull', () => {
    expect(buildPullCommand('/tmp/r')).toBe("git -C '/tmp/r' pull");
  });

  it('buildCommitPushCommand chains add/commit/push with && and push -u origin HEAD', () => {
    const cmd = buildCommitPushCommand('/tmp/r', 'fix typo');
    expect(cmd).toContain("git -C '/tmp/r' add -A");
    expect(cmd).toContain("git -C '/tmp/r' commit -m 'fix typo'");
    expect(cmd).toContain("git -C '/tmp/r' push -u origin HEAD");
    expect(cmd.split(' && ')).toHaveLength(3);
  });

  it('buildCommitPushCommand escapes quotes in the commit message', () => {
    expect(buildCommitPushCommand('/tmp/r', "it's done")).toContain("'it'\\''s done'");
  });
});
