import { describe, it, expect, beforeEach } from 'vitest';
// ponytail: import fs helpers from the aliased mock (test/mocks/plugin-fs);
// setup.ts resets the mock state in beforeEach, so no manual __internals here.
import { writeTextFile, mkdir } from '@tauri-apps/plugin-fs';
import { ClaudeAdapter } from './claudeAdapter';
import { parseMarkdownFrontmatter, parseTomlTopLevel } from './frontmatter';

// ponytail: seed the in-memory fs mock (test/mocks/plugin-fs) with skill /
// command trees mirroring the real on-disk layout described in the research
// file. homeDir() mock returns /mock/home.

const HOME = '/mock/home';
const CWD = '/vault';

async function seedSkill(path: string, name: string, description: string, extra = ''): Promise<void> {
  const fm = `---\nname: ${name}\ndescription: ${description}\n${extra}---\nbody\n`;
  await writeTextFile(`${path}/SKILL.md`, fm);
}

async function seedRootSkill(path: string, name: string, description: string): Promise<void> {
  await writeTextFile(path, `---\nname: ${name}\ndescription: ${description}\n---\nbody\n`);
}

async function seedMdCommand(
  path: string,
  description: string,
  argHint?: string,
): Promise<void> {
  const fm = argHint
    ? `---\ndescription: ${description}\nargument-hint: ${argHint}\n---\nbody\n`
    : `---\ndescription: ${description}\n---\nbody\n`;
  await writeTextFile(path, fm);
}

async function seedTomlCommand(path: string, description: string, prompt: string): Promise<void> {
  await writeTextFile(path, `description = "${description}"\nprompt = """\n${prompt}\n"""\n`);
}

beforeEach(async () => {
  // setup.ts (cli-adapter project) resets the fs mock before each test.
  // Create the root dirs the mock needs.
  await mkdir(`${HOME}/.claude/skills`);
  await mkdir(`${HOME}/.claude/commands`);
  await mkdir(`${HOME}/.claude/plugins`);
  await mkdir(`${CWD}/.claude/skills`);
  await mkdir(`${CWD}/.claude/commands`);
});

describe('parseMarkdownFrontmatter', () => {
  it('parses a --- fenced YAML block', () => {
    const text = '---\nname: foo\ndescription: bar\n---\nbody';
    const { data, body } = parseMarkdownFrontmatter(text);
    expect(data).toEqual({ name: 'foo', description: 'bar' });
    expect(body).toBe('body');
  });

  it('returns null data when no fence is present', () => {
    expect(parseMarkdownFrontmatter('no fence').data).toBeNull();
  });

  it('returns null data when the closing fence is missing', () => {
    expect(parseMarkdownFrontmatter('---\nname: foo\n').data).toBeNull();
  });

  it('returns null data on malformed YAML', () => {
    const text = '---\n: : bad\n---\nbody';
    expect(parseMarkdownFrontmatter(text).data).toBeNull();
  });
});

describe('parseTomlTopLevel', () => {
  it('reads top-level quoted string keys', () => {
    const out = parseTomlTopLevel('description = "hi"\nprompt = "go"\n');
    expect(out).toEqual({ description: 'hi', prompt: 'go' });
  });

  it('skips comments and section headers', () => {
    const out = parseTomlTopLevel('# c\n[s]\ndescription = "d"\n');
    expect(out).toEqual({ description: 'd' });
  });
});

describe('ClaudeAdapter.listSkills', () => {
  async function adapterWith(cwd: string = CWD): Promise<ClaudeAdapter> {
    const a = new ClaudeAdapter();
    await a.start({ cliPath: 'claude', workingDir: cwd });
    return a;
  }

  it('returns [] when not started', async () => {
    const a = new ClaudeAdapter();
    expect(await a.listSkills()).toEqual([]);
  });

  it('parses SKILL.md frontmatter from user + project sources', async () => {
    await seedSkill(`${HOME}/.claude/skills/code-reader`, 'code-reader', 'reads code');
    await seedSkill(`${CWD}/.claude/skills/brainstorm`, 'trellis-brainstorm', 'brainstorms');
    const a = await adapterWith();
    const skills = await a.listSkills();
    expect(skills.map((s) => s.name).sort()).toEqual(['code-reader', 'trellis-brainstorm']);
    const user = skills.find((s) => s.name === 'code-reader')!;
    expect(user.source).toBe('user');
    const project = skills.find((s) => s.name === 'trellis-brainstorm')!;
    expect(project.source).toBe('project');
  });

  it('skips skills without description', async () => {
    await writeTextFile(
      `${HOME}/.claude/skills/no-desc/SKILL.md`,
      '---\nname: no-desc\n---\nbody\n',
    );
    const a = await adapterWith();
    expect(await a.listSkills()).toEqual([]);
  });

  it('reads plugin skills via installed_plugins.json', async () => {
    await seedSkill(`${HOME}/.claude/plugins/cache/mkt/pony/1.0.0/skills/pt`, 'ponytail', 'audit');
    await writeTextFile(
      `${HOME}/.claude/plugins/installed_plugins.json`,
      JSON.stringify({ 'ponytail@mkt': { installPath: `${HOME}/.claude/plugins/cache/mkt/pony/1.0.0`, version: '1.0.0' } }),
    );
    const a = await adapterWith();
    const skills = await a.listSkills();
    const plugin = skills.find((s) => s.name === 'ponytail');
    expect(plugin).toBeDefined();
    expect(plugin!.source).toBe('plugin');
    expect(plugin!.pluginName).toBe('ponytail');
  });

  it('precedence: user wins over plugin on name collision', async () => {
    await seedSkill(`${HOME}/.claude/skills/dup`, 'dup', 'user desc');
    await seedSkill(`${HOME}/.claude/plugins/cache/mkt/p/1.0.0/skills/dup`, 'dup', 'plugin desc');
    await writeTextFile(
      `${HOME}/.claude/plugins/installed_plugins.json`,
      JSON.stringify({ 'p@mkt': { installPath: `${HOME}/.claude/plugins/cache/mkt/p/1.0.0`, version: '1.0.0' } }),
    );
    const a = await adapterWith();
    const skills = await a.listSkills();
    const dup = skills.find((s) => s.name === 'dup');
    expect(dup!.source).toBe('user');
    expect(dup!.description).toBe('user desc');
  });
});

describe('ClaudeAdapter.listCommands', () => {
  async function adapterWith(cwd: string = CWD): Promise<ClaudeAdapter> {
    const a = new ClaudeAdapter();
    await a.start({ cliPath: 'claude', workingDir: cwd });
    return a;
  }

  it('returns [] when not started', async () => {
    const a = new ClaudeAdapter();
    expect(await a.listCommands()).toEqual([]);
  });

  it('names commands from subdirectory as group:name', async () => {
    await mkdir(`${CWD}/.claude/commands/trellis`);
    await seedMdCommand(`${CWD}/.claude/commands/trellis/continue.md`, 'continue task');
    const a = await adapterWith();
    const cmds = await a.listCommands();
    const c = cmds.find((x) => x.name === 'trellis:continue');
    expect(c).toBeDefined();
    expect(c!.source).toBe('project');
  });

  it('parses .toml plugin commands (description + prompt)', async () => {
    await mkdir(`${HOME}/.claude/plugins/cache/mkt/p/1.0.0/commands`);
    await seedTomlCommand(`${HOME}/.claude/plugins/cache/mkt/p/1.0.0/commands/audit.toml`, 'audit it', 'do audit');
    await writeTextFile(
      `${HOME}/.claude/plugins/installed_plugins.json`,
      JSON.stringify({ 'p@mkt': { installPath: `${HOME}/.claude/plugins/cache/mkt/p/1.0.0`, version: '1.0.0' } }),
    );
    const a = await adapterWith();
    const cmds = await a.listCommands();
    const c = cmds.find((x) => x.name === 'audit');
    expect(c).toBeDefined();
    expect(c!.description).toBe('audit it');
    expect(c!.source).toBe('plugin');
  });

  it('exposes argumentHint from frontmatter', async () => {
    await seedMdCommand(`${CWD}/.claude/commands/review.md`, 'review', '<PR-URL>');
    const a = await adapterWith();
    const c = (await a.listCommands()).find((x) => x.name === 'review');
    expect(c!.argumentHint).toBe('<PR-URL>');
  });

  it('uses first non-empty body line as description when frontmatter lacks one', async () => {
    await writeTextFile(`${CWD}/.claude/commands/no-fm.md`, '---\nargument-hint: x\n---\nFirst body line\n');
    const a = await adapterWith();
    const c = (await a.listCommands()).find((x) => x.name === 'no-fm');
    expect(c!.description).toBe('First body line');
  });
});
