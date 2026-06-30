import { describe, it, expect, beforeEach } from 'vitest';
import { CliAdapterRegistry, registerBuiltinAdapters } from './registry';
import { ClaudeAdapter, buildClaudeArgs, buildClaudeShellCommand, quoteShellArg } from './claudeAdapter';

describe('CliAdapterRegistry singleton', () => {
  it('returns the same instance across calls', () => {
    const a = CliAdapterRegistry.getInstance();
    const b = CliAdapterRegistry.getInstance();
    expect(a).toBe(b);
  });
});

describe('CliAdapterRegistry.register / create', () => {
  let registry: CliAdapterRegistry;

  beforeEach(() => {
    // Use a fresh instance by calling getInstance (singleton state persists
    // across tests; we register under unique ids to avoid collisions).
    registry = CliAdapterRegistry.getInstance();
  });

  it('creates an adapter from a registered factory', () => {
    registry.register('test-factory', () => new ClaudeAdapter());
    const adapter = registry.create('test-factory');
    expect(adapter.id).toBe('claude');
  });

  it('throws when creating an unregistered id', () => {
    expect(() => registry.create('does-not-exist')).toThrow(/not found/i);
  });
});

describe('CliAdapterRegistry.getAll', () => {
  it('returns id, displayName, description for each registered adapter', () => {
    const registry = CliAdapterRegistry.getInstance();
    registry.register('desc-test', () => new ClaudeAdapter());
    const all = registry.getAll();
    const entry = all.find((x) => x.id === 'desc-test');
    expect(entry).toBeDefined();
    expect(entry?.displayName).toBe('Claude Code');
    expect(entry?.description).toContain('Anthropic');
  });
});

describe('registerBuiltinAdapters', () => {
  it('registers the "claude" adapter', () => {
    registerBuiltinAdapters();
    const registry = CliAdapterRegistry.getInstance();
    const adapter = registry.create('claude');
    expect(adapter).toBeInstanceOf(ClaudeAdapter);
  });
});

describe('ClaudeAdapter lifecycle (no spawn)', () => {
  it('starts with config and is not running until send', async () => {
    const adapter = new ClaudeAdapter();
    expect(adapter.isRunning()).toBe(false);
    await adapter.start({ cliPath: 'claude', workingDir: '/tmp' });
    expect(adapter.isRunning()).toBe(false);
  });

  it('stop clears running flag', async () => {
    const adapter = new ClaudeAdapter();
    await adapter.start({ cliPath: 'claude', workingDir: '/tmp' });
    await adapter.stop();
    expect(adapter.isRunning()).toBe(false);
  });

  it('send throws if not started', async () => {
    const adapter = new ClaudeAdapter();
    await expect(adapter.send('hi')).rejects.toThrow(/not started/i);
  });
});

describe('ClaudeAdapter event bus', () => {
  it('delivers events to registered handlers and removes them on offEvent', () => {
    const adapter = new ClaudeAdapter();
    const received: string[] = [];
    const handler = (e: { type: string }) => received.push(e.type);
    adapter.onEvent(handler);
    // Emit is protected; use a subclass trick to access it.
    (adapter as unknown as { emit: (e: { type: string }) => void }).emit({ type: 'text' });
    (adapter as unknown as { emit: (e: { type: string }) => void }).emit({ type: 'done' });
    expect(received).toEqual(['text', 'done']);
    adapter.offEvent(handler);
    (adapter as unknown as { emit: (e: { type: string }) => void }).emit({ type: 'error' });
    expect(received).toEqual(['text', 'done']);
  });
});

describe('buildClaudeArgs (PR9: --agent / --agents / --add-dir)', () => {
  const baseArgs = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--thinking', 'enabled',
    '--permission-mode', 'bypassPermissions',
    '--bare',
  ];

  it('基础参数以 --bare 开头，prompt 在最后', () => {
    const args = buildClaudeArgs('hello');
    expect(args.slice(0, baseArgs.length)).toEqual(baseArgs);
    expect(args[args.length - 1]).toBe('hello');
    expect(args).not.toContain('--resume');
  });

  it('resumeSessionId 在 prompt 之前、--bare 之后', () => {
    const args = buildClaudeArgs('hi', { resumeSessionId: 'rs-1' });
    const bareIdx = args.indexOf('--bare');
    const resumeIdx = args.indexOf('--resume');
    const promptIdx = args.length - 1;
    expect(resumeIdx).toBeGreaterThan(bareIdx);
    expect(promptIdx).toBeGreaterThan(resumeIdx);
    expect(args[resumeIdx + 1]).toBe('rs-1');
  });

  it('agent/agents/addDir 在 --bare 之后、--resume 之前', () => {
    const args = buildClaudeArgs('p', {
      agent: 'study',
      agents: { study: { prompt: 'be study' } },
      addDir: ['/tmp/extra'],
      resumeSessionId: 'rs',
    });
    const bareIdx = args.indexOf('--bare');
    const agentIdx = args.indexOf('--agent');
    const agentsIdx = args.indexOf('--agents');
    const addDirIdx = args.indexOf('--add-dir');
    const resumeIdx = args.indexOf('--resume');
    expect(agentIdx).toBeGreaterThan(bareIdx);
    expect(agentsIdx).toBeGreaterThan(bareIdx);
    expect(addDirIdx).toBeGreaterThan(bareIdx);
    expect(resumeIdx).toBeGreaterThan(agentIdx);
    expect(args[agentIdx + 1]).toBe('study');
    expect(args[agentsIdx + 1]).toBe(JSON.stringify({ study: { prompt: 'be study' } }));
    expect(args[addDirIdx + 1]).toBe('/tmp/extra');
  });

  it('agents 被序列化为 JSON 字符串（双引号、不含单引号）', () => {
    const args = buildClaudeArgs('p', { agents: { study: { prompt: 'hi', tools: ['Read'] } } });
    const json = args[args.indexOf('--agents') + 1];
    expect(json).toContain('"study"');
    expect(json).not.toContain("'");
    const parsed = JSON.parse(json);
    expect(parsed.study.prompt).toBe('hi');
    expect(parsed.study.tools).toEqual(['Read']);
  });

  it('多个 addDir 各自带 --add-dir 前缀', () => {
    const args = buildClaudeArgs('p', { addDir: ['/a', '/b'] });
    const dirs = args.filter((_, i) => args[i - 1] === '--add-dir');
    expect(dirs).toEqual(['/a', '/b']);
  });

  it('addDir 去重（保序），重复目录只出现一次', () => {
    const args = buildClaudeArgs('p', { addDir: ['/a', '/b', '/a', '/c', '/b'] });
    const dirs = args.filter((_, i) => args[i - 1] === '--add-dir');
    expect(dirs).toEqual(['/a', '/b', '/c']);
  });

  it('addDir 忽略空字符串项', () => {
    const args = buildClaudeArgs('p', { addDir: ['', '/a', ''] });
    const dirs = args.filter((_, i) => args[i - 1] === '--add-dir');
    expect(dirs).toEqual(['/a']);
  });

  it('无 agent/agents/addDir 时不出现这些 flag', () => {
    const args = buildClaudeArgs('p');
    expect(args).not.toContain('--agent');
    expect(args).not.toContain('--agents');
    expect(args).not.toContain('--add-dir');
  });
});

describe('quoteShellArg / buildClaudeShellCommand', () => {
  it('单引号包裹参数，内部单引号转义', () => {
    expect(quoteShellArg('abc')).toBe("'abc'");
    expect(quoteShellArg("a'b")).toBe("'a'\\''b'");
  });

  it('JSON 参数（含双引号、无单引号）原样保留，可从引号内还原', () => {
    const json = JSON.stringify({ study: { prompt: 'hi "quoted"' } });
    const quoted = quoteShellArg(json);
    // 去掉首尾单引号即得原 JSON
    expect(quoted.slice(1, -1)).toBe(json);
    expect(JSON.parse(quoted.slice(1, -1)).study.prompt).toBe('hi "quoted"');
  });

  it('buildClaudeShellCommand: 有 workingDir 时 cd + exec，并重定向 stdin', () => {
    const args = buildClaudeArgs('p', { agent: 'study' });
    const cmd = buildClaudeShellCommand('claude', '/vault', args);
    expect(cmd.startsWith("cd '/vault' && exec ")).toBe(true);
    expect(cmd).toContain('--agent');
    expect(cmd.endsWith(' < /dev/null')).toBe(true);
  });

  it('buildClaudeShellCommand: 无 workingDir 时仅 exec', () => {
    const cmd = buildClaudeShellCommand('claude', '', ['p']);
    expect(cmd.startsWith('exec ')).toBe(true);
    expect(cmd).not.toContain('cd ');
  });
});
