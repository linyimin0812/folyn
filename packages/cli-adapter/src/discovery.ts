import { readDir, readTextFile } from '@tauri-apps/plugin-fs';
import { homeDir } from '@tauri-apps/api/path';
import type { CommandEntry, SkillEntry } from './types';
import { parseMarkdownFrontmatter, parseTomlTopLevel } from './frontmatter';

/** Tauri readDir entry shape (subset we use). */
interface DirEntryLite {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

/** Read a directory's direct children; returns [] when the dir is missing
 *  (a missing skills/commands dir is a valid, empty state — e.g. the user
 *  has no user-level commands). */
export async function listDir(path: string): Promise<DirEntryLite[]> {
  try {
    const entries = (await readDir(path)) as DirEntryLite[];
    return entries ?? [];
  } catch {
    return [];
  }
}

/** Resolve `~` to the user home directory. Paths not starting with `~` are
 *  returned unchanged. */
export async function resolveHome(path: string): Promise<string> {
  if (!path.startsWith('~')) return path;
  const home = (await homeDir()).replace(/\/+$/, '');
  return home + path.slice(1);
}

/** Recursively collect all file paths under `dir`. Returns [] if missing. */
export async function walkFiles(dir: string): Promise<string[]> {
  const entries = await listDir(dir);
  const out: string[] = [];
  for (const e of entries) {
    const child = `${dir}/${e.name}`;
    if (e.isDirectory) {
      out.push(...(await walkFiles(child)));
    } else if (e.isFile) {
      out.push(child);
    }
  }
  return out;
}

/** Parse a SKILL.md / root skill .md file. Returns { name, description } or
 *  null when frontmatter is missing or `description` is absent — Pi refuses
 *  to load skills without description, and Claude mirrors that (the Agent
 *  Skills standard requires both fields). */
export async function parseSkillFile(
  filePath: string,
): Promise<{ name: string; description: string } | null> {
  let text: string;
  try {
    text = await readTextFile(filePath);
  } catch {
    return null;
  }
  const { data } = parseMarkdownFrontmatter(text);
  if (!data) return null;
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  if (!name || !description) return null;
  return { name, description };
}

export interface SkillSource {
  path: string;
  source: SkillEntry['source'];
  pluginName?: string;
  /** When true, a direct-child `*.md` file (not in a subfolder) is also
   *  discovered as an individual skill — Pi's rule for
   *  `~/.pi/agent/skills/` and `.pi/skills/`. Claude and `~/.agents/skills/`
   *  ignore root `.md` (only `SKILL.md` dirs count). */
  rootMd?: boolean;
}

/** Collect skills from a list of source dirs (in precedence order — first
 *  occurrence of a name wins via dedupeByName). For each source dir:
 *  - recursive `SKILL.md` discovery (any subfolder containing `SKILL.md`)
 *  - when `rootMd`, direct-child `*.md` files are also parsed as skills. */
export async function collectSkills(sources: SkillSource[]): Promise<SkillEntry[]> {
  const entries: SkillEntry[] = [];
  for (const src of sources) {
    const children = await listDir(src.path);
    for (const child of children) {
      const childPath = `${src.path}/${child.name}`;
      if (child.isDirectory) {
        const skillFiles = await findSkillMds(childPath);
        for (const sf of skillFiles) {
          const parsed = await parseSkillFile(sf);
          if (parsed) {
            entries.push({
              ...parsed,
              source: src.source,
              pluginName: src.pluginName,
              dir: sf.slice(0, -'/SKILL.md'.length),
            });
          }
        }
      } else if (child.isFile && src.rootMd && child.name.endsWith('.md') && child.name !== 'SKILL.md') {
        const parsed = await parseSkillFile(childPath);
        if (parsed) {
          entries.push({ ...parsed, source: src.source, pluginName: src.pluginName, dir: src.path });
        }
      }
    }
  }
  return dedupeByName(entries);
}

/** Recursively find all `SKILL.md` files under `dir` (handles nested
 *  `<root>/<group>/<name>/SKILL.md` layouts). */
async function findSkillMds(dir: string): Promise<string[]> {
  const entries = await listDir(dir);
  const out: string[] = [];
  for (const e of entries) {
    const child = `${dir}/${e.name}`;
    if (e.isDirectory) {
      out.push(...(await findSkillMds(child)));
    } else if (e.isFile && e.name === 'SKILL.md') {
      out.push(child);
    }
  }
  return out;
}

export interface CommandSource {
  path: string;
  source: CommandEntry['source'];
  pluginName?: string;
  /** When true, command files are read non-recursively (Pi prompt
   *  templates: filename = command name, no subfolder grouping). When
   *  false (Claude), the tree is walked recursively and subfolder →
   *  `group:name`. */
  flat?: boolean;
  /** When true, parse `.toml` command files (Claude plugin commands) in
   *  addition to `.md`. Ignored when `flat` (Pi has no toml templates). */
  toml?: boolean;
}

/** Collect slash commands / prompt templates from source dirs (in
 *  precedence order — first occurrence wins). `.md` files use YAML
 *  frontmatter (`description`, `argument-hint`); `.toml` files (Claude
 *  plugins only) use top-level `description`/`prompt` keys. */
export async function collectCommands(sources: CommandSource[]): Promise<CommandEntry[]> {
  const entries: CommandEntry[] = [];
  for (const src of sources) {
    if (src.flat) {
      const children = await listDir(src.path);
      for (const child of children) {
        if (child.isFile && child.name.endsWith('.md')) {
          const file = `${src.path}/${child.name}`;
          const cmd = await parseMdCommand(file, src);
          if (cmd) entries.push(cmd);
        }
      }
    } else {
      const files = await walkFiles(src.path);
      for (const file of files) {
        const base = file.slice(src.path.length + 1).replace(/\\/g, '/');
        if (file.endsWith('.md')) {
          const name = commandNameFromPath(base);
          const cmd = await parseMdCommand(file, src, name);
          if (cmd) entries.push(cmd);
        } else if (src.toml && file.endsWith('.toml')) {
          const name = commandNameFromPath(base).replace(/\.toml$/, '');
          const cmd = await parseTomlCommand(file, src, name);
          if (cmd) entries.push(cmd);
        }
      }
    }
  }
  return dedupeByName(entries);
}

/** Convert a relative path under a commands root to a command name. Top-level
 *  `setup.md` → `setup`; nested `trellis/continue.md` → `trellis:continue`
 *  (subdirectory becomes a `group:` prefix). The `.md`/`.toml` suffix is
 *  stripped by the caller for toml; for md it is stripped here. */
function commandNameFromPath(relPath: string): string {
  const noExt = relPath.replace(/\.md$/, '');
  return noExt.replace(/\//g, ':');
}

async function parseMdCommand(
  file: string,
  src: CommandSource,
  nameOverride?: string,
): Promise<CommandEntry | null> {
  let text: string;
  try {
    text = await readTextFile(file);
  } catch {
    return null;
  }
  const { data, body } = parseMarkdownFrontmatter(text);
  const name = nameOverride ?? file.split('/').pop()!.replace(/\.md$/, '');
  let description = '';
  if (data && typeof data.description === 'string') description = data.description.trim();
  if (!description) {
    // ponytail: first non-empty body line as description (matches Claude/Pi
    // convention when frontmatter description is absent).
    description = body.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  }
  if (!description) return null;
  const argumentHint =
    data && typeof data['argument-hint'] === 'string' ? data['argument-hint'].trim() || undefined : undefined;
  return {
    name,
    description,
    source: src.source,
    argumentHint,
    pluginName: src.pluginName,
    file,
  };
}

async function parseTomlCommand(
  file: string,
  src: CommandSource,
  name: string,
): Promise<CommandEntry | null> {
  let text: string;
  try {
    text = await readTextFile(file);
  } catch {
    return null;
  }
  const data = parseTomlTopLevel(text);
  const description = (data.description ?? '').trim();
  if (!description) return null;
  return { name, description, source: src.source, pluginName: src.pluginName, file };
}

/** Deduplicate entries by `name`, keeping the first occurrence (callers pass
 *  sources in precedence order: user > project > plugin). */
export function dedupeByName<T extends { name: string }>(entries: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of entries) {
    if (seen.has(e.name)) continue;
    seen.add(e.name);
    out.push(e);
  }
  return out;
}
