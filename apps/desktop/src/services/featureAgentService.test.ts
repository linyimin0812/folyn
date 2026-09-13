import { describe, it, expect, beforeEach, vi } from 'vitest';

// featureAgentService dynamically imports `@/store/vaultStore` (to avoid a
// cycle). Mock it with a mutable state holder so each test can stage the
// vault manager + currentVault that getFeatureAgentSendOptions / lazySeed /
// agentFileExists read via `useVaultStore.getState()`.
const vaultState = {
  manager: null as {
    createDir: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    readFile: ReturnType<typeof vi.fn>;
  } | null,
  currentVault: { basePath: '/mock/vault', id: 'v1', name: 'v1' } as {
    basePath: string;
    id: string;
    name: string;
  } | null,
};

vi.mock('@/store/vaultStore', () => ({
  useVaultStore: {
    getState: () => vaultState,
  },
}));

function makeMockManager() {
  const fs = new Map<string, string>();
  return {
    fs,
    createDir: vi.fn(async (_path: string) => {}),
    writeFile: vi.fn(async (path: string, content: string) => {
      fs.set(path, content);
    }),
    readFile: vi.fn(async (path: string) => {
      const hit = fs.get(path);
      if (hit === undefined) throw new Error(`NOT_FOUND: ${path}`);
      return hit;
    }),
  };
}

import {
  FEATURE_AGENTS,
  getFeatureAgentEntry,
  getFeatureAgentSendOptions,
  agentFilePathOf,
  claudeMdPathOf,
  piContextFilePath,
  seedAgentFiles,
  agentFileExists,
  isAgentAvailable,
} from './featureAgentService';

beforeEach(() => {
  const m = makeMockManager();
  vaultState.manager = m;
  vaultState.currentVault = { basePath: '/mock/vault', id: 'v1', name: 'v1' };
});

describe('FEATURE_AGENTS registry', () => {
  it('registers exactly 1 feature: schedule', () => {
    const features = FEATURE_AGENTS.map((e) => e.feature).sort();
    expect(features).toEqual(['schedule']);
  });

  it('only schedule has addVaultDir: true (cross-vault __daily__/ access)', () => {
    const withAddDir = FEATURE_AGENTS.filter((e) => e.addVaultDir).map((e) => e.feature);
    expect(withAddDir).toEqual(['schedule']);
  });

  it('every entry carries a non-empty doc + claudeDoc (canonical ?raw imports)', () => {
    for (const e of FEATURE_AGENTS) {
      expect(e.doc.length).toBeGreaterThan(0);
      expect(e.claudeDoc.length).toBeGreaterThan(0);
      expect(e.file).toBe(`${e.feature}.md`);
    }
  });
});

describe('getFeatureAgentEntry', () => {
  it('returns the entry for a registered feature', () => {
    const entry = getFeatureAgentEntry('schedule');
    expect(entry?.feature).toBe('schedule');
    expect(entry?.file).toBe('schedule.md');
  });

  it('returns undefined for an unregistered feature', () => {
    expect(getFeatureAgentEntry('study')).toBeUndefined();
    expect(getFeatureAgentEntry('nonexistent')).toBeUndefined();
  });
});

describe('path helpers', () => {
  it('agentFilePathOf returns __<feature>__/.claude/agents/<file>', () => {
    expect(agentFilePathOf('schedule')).toBe(
      '__schedule__/.claude/agents/schedule.md',
    );
  });

  it('claudeMdPathOf returns __<feature>__/.claude/CLAUDE.md', () => {
    expect(claudeMdPathOf('schedule')).toBe('__schedule__/.claude/CLAUDE.md');
  });

  it('path helpers return null for unregistered features', () => {
    expect(agentFilePathOf('study')).toBeNull();
    expect(claudeMdPathOf('study')).toBeNull();
    expect(piContextFilePath('study')).toBeNull();
  });
});

describe('seedAgentFiles', () => {
  it('writes CLAUDE.md + agent .md for every feature into __<feature>__/.claude/', async () => {
    const manager = vaultState.manager!;
    await seedAgentFiles(manager as never);

    const writes = manager.writeFile.mock.calls.map((c) => c[0] as string);
    expect(writes).toContain('__schedule__/.claude/CLAUDE.md');
    expect(writes).toContain('__schedule__/.claude/agents/schedule.md');
  });

  it('creates each feature agents/ dir before writing', async () => {
    const manager = vaultState.manager!;
    await seedAgentFiles(manager as never);

    const dirs = manager.createDir.mock.calls.map((c) => c[0] as string);
    expect(dirs).toContain('__schedule__/.claude/agents');
  });

  it('always-overwrites: second seed re-writes canonical content (no write-if-missing)', async () => {
    const manager = vaultState.manager!;
    await seedAgentFiles(manager as never);
    await seedAgentFiles(manager as never);

    const scheduleAgentWrites = manager.writeFile.mock.calls.filter(
      (c) => c[0] === '__schedule__/.claude/agents/schedule.md',
    );
    expect(scheduleAgentWrites).toHaveLength(2);
  });

  it('writes canonical content verbatim (byte-for-byte from ?raw imports)', async () => {
    const manager = vaultState.manager!;
    await seedAgentFiles(manager as never);

    const entry = getFeatureAgentEntry('schedule')!;
    const claudeCall = manager.writeFile.mock.calls.find(
      (c) => c[0] === '__schedule__/.claude/CLAUDE.md',
    );
    const agentCall = manager.writeFile.mock.calls.find(
      (c) => c[0] === '__schedule__/.claude/agents/schedule.md',
    );
    expect(claudeCall?.[1]).toBe(entry.claudeDoc);
    expect(agentCall?.[1]).toBe(entry.doc);
  });

  it('writes a diagnostic seed log to .folyn-tmp/feature-agent-seed.log', async () => {
    const manager = vaultState.manager!;
    await seedAgentFiles(manager as never);

    const logCall = manager.writeFile.mock.calls.find(
      (c) => c[0] === '.folyn-tmp/feature-agent-seed.log',
    );
    expect(logCall).toBeDefined();
    const content = logCall![1] as string;
    expect(content).toContain('feature-agent seeding diagnostic');
    expect(content).toContain('__schedule__/.claude/CLAUDE.md');
    expect(content).toContain('__schedule__/.claude/agents/schedule.md');
  });

  it('continues on per-file write failure (records status=failed, does not throw)', async () => {
    const manager = vaultState.manager!;
    manager.writeFile.mockImplementation(async (path: string, _content: string) => {
      if (path === '__schedule__/.claude/CLAUDE.md') {
        throw new Error('read-only vault');
      }
      const m = vaultState.manager!;
      (m.fs as Map<string, string>).set(path, _content);
    });

    const results = await seedAgentFiles(manager as never);
    const scheduleClaude = results.find(
      (r) => r.feature === 'schedule' && r.path === '__schedule__/.claude/CLAUDE.md',
    );
    expect(scheduleClaude?.status).toBe('failed');
    expect(scheduleClaude?.error).toContain('read-only vault');
  });
});

describe('agentFileExists', () => {
  it('returns true when the agent .md is already seeded', async () => {
    const manager = vaultState.manager!;
    await seedAgentFiles(manager as never);
    expect(await agentFileExists(manager as never, 'schedule')).toBe(true);
  });

  it('returns false when the agent .md is absent (unseeded vault)', async () => {
    const manager = vaultState.manager!;
    expect(await agentFileExists(manager as never, 'schedule')).toBe(false);
  });

  it('returns false for an unregistered feature', async () => {
    const manager = vaultState.manager!;
    expect(await agentFileExists(manager as never, 'study')).toBe(false);
  });
});

describe('getFeatureAgentSendOptions', () => {
  it("returns {agent:'schedule', bare:false, addDir:[basePath]} for schedule (cross-vault __daily__ access)", async () => {
    const manager = vaultState.manager!;
    await seedAgentFiles(manager as never);
    const opts = await getFeatureAgentSendOptions('schedule');
    expect(opts.agent).toBe('schedule');
    expect(opts.bare).toBe(false);
    expect(opts.addDir).toEqual(['/mock/vault']);
  });

  it('falls back with addDir for schedule when its vault is read-only (seed fails)', async () => {
    vaultState.manager!.writeFile.mockRejectedValue(new Error('read-only vault'));
    const opts = await getFeatureAgentSendOptions('schedule');
    expect(opts.bare).toBe(true);
    expect(opts.agent).toBe('schedule');
    expect(opts.addDir).toEqual(['/mock/vault']);
    expect(opts.agents?.schedule).toBeDefined();
  });

  it('returns {bare:true} (no agent) for an unregistered feature', async () => {
    const opts = await getFeatureAgentSendOptions('study');
    expect(opts.bare).toBe(true);
    expect(opts.agent).toBeUndefined();
    expect(opts.agents).toBeUndefined();
  });

  it('omits addDir when currentVault is null even for schedule', async () => {
    vaultState.currentVault = null;
    const opts = await getFeatureAgentSendOptions('schedule');
    expect(opts.addDir).toBeUndefined();
  });
});

describe('isAgentAvailable', () => {
  it('returns true after seeding', async () => {
    await seedAgentFiles(vaultState.manager as never);
    expect(await isAgentAvailable('schedule')).toBe(true);
  });

  it('returns false when the vault is read-only (seed fails, agent file never written)', async () => {
    vaultState.manager!.writeFile.mockRejectedValue(new Error('read-only vault'));
    expect(await isAgentAvailable('schedule')).toBe(false);
  });

  it('returns false for an unregistered feature', async () => {
    expect(await isAgentAvailable('study')).toBe(false);
  });
});
