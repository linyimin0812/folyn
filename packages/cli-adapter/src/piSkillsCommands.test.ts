import { describe, it, expect, beforeEach } from 'vitest';
import { writeTextFile, mkdir } from '@tauri-apps/plugin-fs';
import { PiAdapter } from './piAdapter';

const HOME = '/mock/home';
const CWD = '/vault';

async function seedSkill(path: string, name: string, description: string, extra = ''): Promise<void> {
  const fm = `---\nname: ${name}\ndescription: ${description}\n${extra}---\nbody\n`;
  await writeTextFile(`${path}/SKILL.md`, fm);
}

async function seedTemplate(path: string, description: string, argHint?: string): Promise<void> {
  const fm = argHint
    ? `---\ndescription: ${description}\nargument-hint: ${argHint}\n---\nbody\n`
    : `---\ndescription: ${description}\n---\nbody\n`;
  await writeTextFile(path, fm);
}

beforeEach(async () => {
  // setup.ts resets the fs mock before each test.
  await mkdir(`${HOME}/.pi/agent/skills`);
  await mkdir(`${HOME}/.pi/agent`);
  await mkdir(`${CWD}/.pi/skills`);
  await mkdir(`${CWD}/.pi/prompts`);
});

describe('PiAdapter.listSkills', () => {
  async function adapterWith(cwd: string = CWD): Promise<PiAdapter> {
    const a = new PiAdapter();
    await a.start({ cliPath: 'pi', workingDir: cwd });
    return a;
  }

  it('returns [] when not started', async () => {
    const a = new PiAdapter();
    expect(await a.listSkills()).toEqual([]);
  });

  it('reads ~/.pi/agent/skills/<name>/SKILL.md', async () => {
    await seedSkill(`${HOME}/.pi/agent/skills/ask-matt`, 'ask-matt', 'router skill');
    const a = await adapterWith();
    const skills = await a.listSkills();
    const s = skills.find((x) => x.name === 'ask-matt');
    expect(s).toBeDefined();
    expect(s!.source).toBe('user');
  });

  it('includes skills with disable-model-invocation: true (user-triggerable)', async () => {
    await seedSkill(
      `${HOME}/.pi/agent/skills/hidden`,
      'hidden',
      'desc',
      'disable-model-invocation: true\n',
    );
    const a = await adapterWith();
    const skills = await a.listSkills();
    expect(skills.some((s) => s.name === 'hidden')).toBe(true);
  });

  it('skips skills without description', async () => {
    await writeTextFile(
      `${HOME}/.pi/agent/skills/nd/SKILL.md`,
      '---\nname: nd\n---\nbody\n',
    );
    const a = await adapterWith();
    expect(await a.listSkills()).toEqual([]);
  });

  it('discovers root *.md skills in ~/.pi/agent/skills (rootMd rule)', async () => {
    await writeTextFile(`${HOME}/.pi/agent/skills/flat.md`, '---\nname: flat\ndescription: flat desc\n---\nbody\n');
    const a = await adapterWith();
    const skills = await a.listSkills();
    expect(skills.some((s) => s.name === 'flat')).toBe(true);
  });

  it('reads project .pi/skills/', async () => {
    await seedSkill(`${CWD}/.pi/skills/local`, 'local', 'local skill');
    const a = await adapterWith();
    const skills = await a.listSkills();
    const s = skills.find((x) => x.name === 'local');
    expect(s).toBeDefined();
    expect(s!.source).toBe('project');
  });

  it('reads ~/.agents/skills/ (SKILL.md dirs only, root .md ignored)', async () => {
    await mkdir(`${HOME}/.agents/skills`);
    await seedSkill(`${HOME}/.agents/skills/shared`, 'shared', 'shared skill');
    // root .md in ~/.agents/skills is ignored per the discovery rules
    await writeTextFile(`${HOME}/.agents/skills/ignored.md`, '---\nname: ignored\ndescription: x\n---\n');
    const a = await adapterWith();
    const skills = await a.listSkills();
    expect(skills.some((s) => s.name === 'shared')).toBe(true);
    expect(skills.some((s) => s.name === 'ignored')).toBe(false);
  });

  it('reads package skills from settings.json skills[]', async () => {
    await mkdir('/pkg/skills');
    await seedSkill('/pkg/skills/pkgskill', 'pkgskill', 'pkg');
    await writeTextFile(
      `${HOME}/.pi/agent/settings.json`,
      JSON.stringify({ skills: ['/pkg/skills'] }),
    );
    const a = await adapterWith();
    const skills = await a.listSkills();
    const s = skills.find((x) => x.name === 'pkgskill');
    expect(s).toBeDefined();
    expect(s!.source).toBe('plugin');
  });
});

describe('PiAdapter.listCommands', () => {
  async function adapterWith(cwd: string = CWD): Promise<PiAdapter> {
    const a = new PiAdapter();
    await a.start({ cliPath: 'pi', workingDir: cwd });
    return a;
  }

  it('returns [] when not started', async () => {
    const a = new PiAdapter();
    expect(await a.listCommands()).toEqual([]);
  });

  it('reads ~/.pi/agent/prompts/*.md (NON-recursive; filename = name)', async () => {
    await mkdir(`${HOME}/.pi/agent/prompts`);
    await seedTemplate(`${HOME}/.pi/agent/prompts/review.md`, 'review staged');
    const a = await adapterWith();
    const cmds = await a.listCommands();
    const c = cmds.find((x) => x.name === 'review');
    expect(c).toBeDefined();
    expect(c!.source).toBe('user');
  });

  it('is non-recursive: subfolder .md files are NOT discovered', async () => {
    await mkdir(`${HOME}/.pi/agent/prompts/sub`);
    await seedTemplate(`${HOME}/.pi/agent/prompts/sub/nested.md`, 'nested');
    await seedTemplate(`${HOME}/.pi/agent/prompts/top.md`, 'top');
    const a = await adapterWith();
    const cmds = (await a.listCommands()).map((c) => c.name);
    expect(cmds).toContain('top');
    expect(cmds).not.toContain('nested');
  });

  it('reads project .pi/prompts/', async () => {
    await seedTemplate(`${CWD}/.pi/prompts/local.md`, 'local template');
    const a = await adapterWith();
    const c = (await a.listCommands()).find((x) => x.name === 'local');
    expect(c!.source).toBe('project');
  });
});
