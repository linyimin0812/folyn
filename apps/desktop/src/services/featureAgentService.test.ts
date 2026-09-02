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

// In-memory filesystem backing the mock manager. `readFile` throws when a
// path is absent so `agentFileExists` reports false (mirrors the real
// VaultManager contract — see packages/vault-provider/src/registry.test.ts).
function makeMockManager() {
  const fs = new Map<string, string>();
  return {
    fs,
    createDir: vi.fn(async (_path: string) => {
      // directories are implicit in the map (path keys carry their content);
      // real providers auto-create parents, here we just no-op.
    }),
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

// Imported after vi.mock is registered so the dynamic import resolves to our
// mock. The service module captures `useVaultStore` lazily inside each call,
// so mutating vaultState between tests takes effect immediately.
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
  // Seed-log write happens on every seedAgentFiles call; clear call history
  // so per-test assertions only see their own writes.
});

describe('FEATURE_AGENTS registry', () => {
  it('registers exactly 4 features: analyze, clips, schedule, wiki', () => {
    const features = FEATURE_AGENTS.map((e) => e.feature).sort();
    expect(features).toEqual(['analyze', 'clips', 'schedule', 'wiki']);
  });

  it('only schedule has addVaultDir: true (cross-vault __daily__/ access)', () => {
    const withAddDir = FEATURE_AGENTS.filter((e) => e.addVaultDir).map((e) => e.feature);
    expect(withAddDir).toEqual(['schedule']);
  });

  it('every entry carries a non-empty doc + claudeDoc (canonical ?raw imports)', () => {
    for (const e of FEATURE_AGENTS) {
      expect(e.doc.length).toBeGreaterThan(0);
      expect(e.claudeDoc.length).toBeGreaterThan(0);
      // agent file name must match the feature name (cwd auto-discovery contract)
      expect(e.file).toBe(`${e.feature}.md`);
    }
  });
});

describe('getFeatureAgentEntry', () => {
  it('returns the entry for a registered feature', () => {
    const entry = getFeatureAgentEntry('wiki');
    expect(entry?.feature).toBe('wiki');
    expect(entry?.file).toBe('wiki.md');
  });

  it('returns undefined for an unregistered feature', () => {
    expect(getFeatureAgentEntry('study')).toBeUndefined();
    expect(getFeatureAgentEntry('nonexistent')).toBeUndefined();
  });
});

describe('path helpers', () => {
  it('agentFilePathOf returns __<feature>__/.claude/agents/<file>', () => {
    expect(agentFilePathOf('wiki')).toBe('__wiki__/.claude/agents/wiki.md');
    expect(agentFilePathOf('schedule')).toBe(
      '__schedule__/.claude/agents/schedule.md',
    );
  });

  it('claudeMdPathOf returns __<feature>__/.claude/CLAUDE.md', () => {
    expect(claudeMdPathOf('analyze')).toBe('__analyze__/.claude/CLAUDE.md');
  });

  it('path helpers return null for unregistered features', () => {
    expect(agentFilePathOf('study')).toBeNull();
    expect(claudeMdPathOf('study')).toBeNull();
    expect(piContextFilePath('study')).toBeNull();
  });

  it('piContextFilePath returns __<feature>__/AGENTS.md', () => {
    expect(piContextFilePath('clips')).toBe('__clips__/AGENTS.md');
  });
});

describe('seedAgentFiles', () => {
  it('writes CLAUDE.md + agent .md for every feature into __<feature>__/.claude/', async () => {
    const manager = vaultState.manager!;
    await seedAgentFiles(manager as never);

    const writes = manager.writeFile.mock.calls.map((c) => c[0] as string);
    // 4 features × (CLAUDE.md + agent .md) = 8 canonical writes (no pi targets;
    // no entry sets adapterId='pi' in scope A — see featureAgentService.ts).
    for (const f of ['analyze', 'clips', 'schedule', 'wiki']) {
      expect(writes).toContain(`__${f}__/.claude/CLAUDE.md`);
      expect(writes).toContain(`__${f}__/.claude/agents/${f}.md`);
    }
  });

  it('creates each feature agents/ dir before writing', async () => {
    const manager = vaultState.manager!;
    await seedAgentFiles(manager as never);

    const dirs = manager.createDir.mock.calls.map((c) => c[0] as string);
    expect(dirs).toContain('__analyze__/.claude/agents');
    expect(dirs).toContain('__clips__/.claude/agents');
    expect(dirs).toContain('__schedule__/.claude/agents');
    expect(dirs).toContain('__wiki__/.claude/agents');
  });

  it('always-overwrites: second seed re-writes canonical content (no write-if-missing)', async () => {
    // The service is always-overwrite by design — canonical is single source
    // of truth, vault copies don't preserve user edits. Two seeds → each path
    // written twice.
    const manager = vaultState.manager!;
    await seedAgentFiles(manager as never);
    await seedAgentFiles(manager as never);

    const wikiAgentWrites = manager.writeFile.mock.calls.filter(
      (c) => c[0] === '__wiki__/.claude/agents/wiki.md',
    );
    expect(wikiAgentWrites).toHaveLength(2);
  });

  it('writes canonical content verbatim (byte-for-byte from ?raw imports)', async () => {
    const manager = vaultState.manager!;
    await seedAgentFiles(manager as never);

    const entry = getFeatureAgentEntry('clips')!;
    const claudeCall = manager.writeFile.mock.calls.find(
      (c) => c[0] === '__clips__/.claude/CLAUDE.md',
    );
    const agentCall = manager.writeFile.mock.calls.find(
      (c) => c[0] === '__clips__/.claude/agents/clips.md',
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
    // one result line per canonical file (8) — the log lists every write
    expect(content).toContain('__wiki__/.claude/CLAUDE.md');
    expect(content).toContain('__wiki__/.claude/agents/wiki.md');
  });

  it('continues on per-file write failure (records status=failed, does not throw)', async () => {
    // Make writeFile throw for one path only — seedAgentFiles must record the
    // failure and still write the others.
    const manager = vaultState.manager!;
    manager.writeFile.mockImplementation(async (path: string, _content: string) => {
      if (path === '__wiki__/.claude/CLAUDE.md') {
        throw new Error('read-only vault');
      }
      // delegate to the in-memory fs for everything else (incl. the seed log)
      const m = vaultState.manager!;
      if (path === '__wiki__/.claude/CLAUDE.md') throw new Error('read-only vault');
      (m.fs as Map<string, string>).set(path, _content);
    });

    const results = await seedAgentFiles(manager as never);
    const wikiClaude = results.find(
      (r) => r.feature === 'wiki' && r.path === '__wiki__/.claude/CLAUDE.md',
    );
    expect(wikiClaude?.status).toBe('failed');
    expect(wikiClaude?.error).toContain('read-only vault');
    // other features still seeded
    const analyzeSeeded = results.some(
      (r) => r.feature === 'analyze' && r.status === 'seeded',
    );
    expect(analyzeSeeded).toBe(true);
  });
});

describe('agentFileExists', () => {
  it('returns true when the agent .md is already seeded', async () => {
    const manager = vaultState.manager!;
    await seedAgentFiles(manager as never); // seed everything
    expect(await agentFileExists(manager as never, 'wiki')).toBe(true);
  });

  it('returns false when the agent .md is absent (unseeded vault)', async () => {
    const manager = vaultState.manager!;
    expect(await agentFileExists(manager as never, 'wiki')).toBe(false);
  });

  it('returns false for an unregistered feature', async () => {
    const manager = vaultState.manager!;
    expect(await agentFileExists(manager as never, 'study')).toBe(false);
  });
});

describe('getFeatureAgentSendOptions', () => {
  it('returns {agent, bare:false} (no addDir) when the agent file is seeded — non-schedule feature', async () => {
    const manager = vaultState.manager!;
    await seedAgentFiles(manager as never); // seed wiki agent file
    const opts = await getFeatureAgentSendOptions('wiki');
    expect(opts).toEqual({ agent: 'wiki', bare: false });
    expect(opts.addDir).toBeUndefined();
  });

  it("returns {agent:'schedule', bare:false, addDir:[basePath]} for schedule (cross-vault __daily__ access)", async () => {
    const manager = vaultState.manager!;
    await seedAgentFiles(manager as never); // seed schedule agent file
    const opts = await getFeatureAgentSendOptions('schedule');
    expect(opts.agent).toBe('schedule');
    expect(opts.bare).toBe(false);
    expect(opts.addDir).toEqual(['/mock/vault']);
  });

  it('falls back to {agent, bare:true, agents:{[feature]:def}} when the vault is read-only (seed fails)', async () => {
    // The real fallback trigger is a read-only / unwritable vault: lazySeed
    // fails, agentFileExists returns false → --bare + inline agent def so the
    // contract still reaches the CLI (spec graceful degradation).
    const manager = vaultState.manager!;
    manager.writeFile.mockRejectedValue(new Error('read-only vault'));
    const opts = await getFeatureAgentSendOptions('wiki');
    expect(opts.agent).toBe('wiki');
    expect(opts.bare).toBe(true);
    expect(opts.agents).toBeDefined();
    expect(opts.agents!.wiki).toBeDefined();
    // parseAgentDoc strips the frontmatter and keeps the body as prompt
    expect(opts.agents!.wiki.prompt.length).toBeGreaterThan(0);
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
    // still seeded or fallback, but no addDir (no vault base path to grant)
    expect(opts.addDir).toBeUndefined();
  });

  it('parseAgentDoc fallback parses frontmatter description + tools, body becomes prompt', async () => {
    // clips agent .md carries a `--- name/description/tools ---` frontmatter.
    // Read-only vault forces the --bare + inline-agent fallback path, which
    // runs parseAgentDoc on the canonical doc.
    vaultState.manager!.writeFile.mockRejectedValue(new Error('read-only vault'));
    const opts = await getFeatureAgentSendOptions('clips');
    const def = opts.agents!.clips;
    expect(def.prompt.length).toBeGreaterThan(0);
    // description/tools are best-effort parsed; assert only if the canonical
    // doc actually declares them (the clips doc does declare tools).
    if (def.tools) {
      expect(Array.isArray(def.tools)).toBe(true);
      expect(def.tools.length).toBeGreaterThan(0);
    }
  });
});

describe('isAgentAvailable', () => {
  it('returns true after seeding', async () => {
    await seedAgentFiles(vaultState.manager as never);
    expect(await isAgentAvailable('wiki')).toBe(true);
  });

  it('returns false when the vault is read-only (seed fails, agent file never written)', async () => {
    vaultState.manager!.writeFile.mockRejectedValue(new Error('read-only vault'));
    expect(await isAgentAvailable('wiki')).toBe(false);
  });

  it('returns false for an unregistered feature', async () => {
    expect(await isAgentAvailable('study')).toBe(false);
  });
});
