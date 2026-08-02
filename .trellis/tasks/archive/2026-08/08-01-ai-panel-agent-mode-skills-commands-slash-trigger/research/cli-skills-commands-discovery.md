# Research: Claude Code & Pi skills / slash-commands discovery

- **Query**: How do Claude Code and Pi expose "skills" and "slash commands" so an adapter can list them at runtime from the CLI's real on-disk/config sources?
- **Scope**: mixed (internal adapter context + external on-disk layout + official docs)
- **Date**: 2026-08-02

## Summary (read this first)

Both CLIs have **both** a "skills" system and a "slash commands / prompt templates" system, and for **both** the invocation mechanism in non-interactive mode is the same: **embed `/name` in the prompt text.** Neither has a `--skill`/`--command` flag for Claude Code; Pi has `--skill <path>` (for loading extra files) but still invokes existing skills via `/skill:name` in the prompt. So the adapter's existing `claude -p …` and pi `--mode rpc` prompt pipeline already works for triggering — the new work is purely *listing* them.

| Concern | Claude Code | Pi |
|---|---|---|
| Skills on disk | `~/.claude/skills/`, `.claude/skills/`, plugin `skills/` | `~/.pi/agent/skills/`, `~/.agents/skills/`, `.pi/skills/`, packages, settings `skills[]`, `--skill` |
| Skill file | `<name>/SKILL.md` | `<name>/SKILL.md` (Agent Skills standard, shared spec) |
| Skill frontmatter | `name`, `description` (+ plugin/best-practice extras) | `name`, `description` required; optional `license`, `compatibility`, `metadata`, `allowed-tools`, `disable-model-invocation` |
| Slash-commands on disk | `~/.claude/commands/*.md`, `.claude/commands/*.md`, plugin `commands/` | `~/.pi/agent/prompts/*.md`, `.pi/prompts/*.md`, packages, settings `prompts[]`, `--prompt-template` |
| Command file | `.md` (frontmatter `description`, `allowed-tools`, `argument-hint`) — also `.toml` for some plugins | `.md` (frontmatter `description`, `argument-hint`) |
| Invoke in non-interactive | `/name` in prompt text (no flag) | `/skill:name` or `/template` in prompt text; rpc expands both before send |
| Built-in commands | hardcoded (`/clear`, `/help`, `/init`, …), not enumerable from disk | none enumerable from disk; `/skill:name` and `/template` are the user-extensible commands |
| Listing flag | none — read the dirs directly | none — read the dirs directly |

The skill format is actually **shared** between the two: both follow [agentskills.io](https://agentskills.io/specification) (Pi explicitly, Claude Code by convention). A `SKILL.md` in either tree parses the same YAML frontmatter.

---

## Claude Code

### Skills on disk

Sources (verified on this machine, claude `2.1.114`):

- **User skills**: `~/.claude/skills/<name>/SKILL.md` — confirmed present (`code-reader-zh`, `last30days`, `study-planner-pro-1.0.0`).
- **Project skills**: `<repo>/.claude/skills/<name>/SKILL.md` — confirmed in this repo (`trellis-before-dev`, `trellis-brainstorm`, `trellis-check`, `trellis-update-spec`, …).
- **Plugin skills**: under `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<name>/SKILL.md`. Registry: `~/.claude/plugins/installed_plugins.json` maps `name@marketplace` → `{installPath, version}`. Confirmed: `mattpocock` plugin ships `skills/misc/setup-pre-commit/SKILL.md` etc.; `ponytail` ships `skills/ponytail/SKILL.md`.
- **Built-in skills**: none discovered as on-disk files. Claude Code does not ship a `skills/` tree in the binary; the skills surfaced in the system reminder (e.g. `init`, `run`, `code-review`) come from the binary itself and are not enumerable from disk by a third party. Treat as hardcoded / not listable.

Directory layout (confirmed):
```
~/.claude/skills/
└── <name>/
    └── SKILL.md
```
A skill may also be a single root `.md` file in `~/.claude/skills/` (Pi allows this; Claude Code tolerates it for user skills per the shared spec, but the dominant pattern on disk here is `<name>/SKILL.md`).

SKILL.md frontmatter (real example, `~/.claude/skills/code-reader-zh/SKILL.md`):
```markdown
---
name: code-reader-v2-cn
description: 基于认知科学的源代码深度理解助手（中文改进版）…
---
```
Minimum fields an adapter needs: **`name`**, **`description`**. Both are required by the Agent Skills standard. (Project `trellis-brainstorm` uses the same two fields, with `description` as a quoted YAML string.)

### Slash commands on disk

- **User commands**: `~/.claude/commands/*.md` (file does not exist on this machine — user has no user-level commands). Folder is created on demand.
- **Project commands**: `<repo>/.claude/commands/<group>/*.md` — confirmed: `.claude/commands/trellis/continue.md`, `finish-work.md`. These become `/trellis:continue` / `/trellis:finish-work` (subdirectory → `group:name`).
- **Plugin commands**: `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/commands/`. Formats seen:
  - `.md` with frontmatter `{description, allowed-tools}` — e.g. `claude-hud/commands/setup.md`.
  - `.toml` with top-level `description = "…"` and `prompt = "…"` — e.g. `ponytail/commands/ponytail-audit.toml`.
- **Built-in slash commands** (`/clear`, `/help`, `/init`, `/config`, `/resume`, …): hardcoded in the CLI, not files. `claude --help` exposes `--disable-slash-commands` ("Disable all skills") and notes under `--bare`: "Skills still resolve via /skill-name". There is **no** enumeration API/flag for built-ins; an adapter must either hardcode a known list or omit built-ins.

Command `.md` format (per official docs + on-disk `claude-hud/commands/setup.md`):
```markdown
---
description: Configure claude-hud as your statusline
allowed-tools: Bash, Read, Edit, AskUserQuestion
---
<body; `$ARGUMENTS` placeholder interpolated from the user's args>
```
Frontmatter fields: `description` (optional; first non-empty line used if absent), `allowed-tools` (optional), `argument-hint` (optional). Body supports `$ARGUMENTS` and `$1`/`$2` positional interpolation (per [docs.claude.com/en/docs/claude-code/slash-commands](https://docs.claude.com/en/docs/claude-code/slash-commands)). Plugin `.toml` commands instead use `description` + `prompt` top-level keys.

### CLI flags for invocation

Confirmed from `claude --help` (full `-p` help inspected). The adapter's current arg set (`-p --output-format stream-json --verbose --thinking enabled --permission-mode <mode> [--bare] [--append-system-prompt …] [--agent/--agents/--add-dir] [--resume …]`) is correct. For skills/slash-commands:

- **There is no `--skill` or `--command` flag.** Invocation is by **putting `/name` in the prompt text**. `--bare`'s help text explicitly says *"Skills still resolve via /skill-name"* even in minimal mode. `--disable-slash-commands` disables all skills (so keep it off).
- Therefore the adapter triggers a skill/command by appending `/skill-name` or `/trellis:continue <args>` to the prompt string passed to `claude -p`. No new flags needed.
- `--plugin-dir <path>` (repeatable) loads an extra plugin dir for one session — useful if the adapter wants to load a non-installed plugin, but not needed for listing.

### Exact fields an adapter should list

For each skill: `{ name, description, source }` where `source ∈ {user, project, plugin, builtin}`. For each command: `{ name, description, source, argumentHint? }`.

On-disk sources to read for Claude Code:
1. `~/.claude/skills/*/SKILL.md` (+ `~/.claude/skills/*.md`) → `source: user`
2. `<cwd>/.claude/skills/*/SKILL.md` (walk up to repo root) → `source: project`
3. `~/.claude/plugins/installed_plugins.json` → for each entry, glob `<installPath>/skills/*/SKILL.md` → `source: plugin`, plus `pluginName`/`marketplace` from the registry key.
4. Commands: same three trees but `commands/` subdir, globbing both `*.md` and `*.toml`. Group from subdirectory (`trellis/continue.md` → `trellis:continue`).

---

## Pi (`@earendil-works/pi-coding-agent`)

Pi has **three** user-extensible systems. Two are directly relevant (skills, prompt templates); extensions are TS modules and out of scope for a simple list.

### Skills (the Agent Skills standard)

Verified on this machine (pi `0.82.1`, npm `0.83.0`) and against Pi's bundled `docs/skills.md`.

Locations (from `docs/skills.md` "Locations"):
- Global: `~/.pi/agent/skills/`, `~/.agents/skills/`
- Project (only after project is trusted): `.pi/skills/`, `.agents/skills/` (cwd + ancestors up to repo root)
- Packages: `skills/` dirs or `pi.skills` entries in `package.json`
- Settings: `settings.json` `skills` array (files/dirs)
- CLI: `--skill <path>` (repeatable, additive even with `--no-skills`)

Confirmed: `~/.pi/agent/skills/` has 43 skills, each `<name>/SKILL.md`. Example `ask-matt`:
```markdown
---
name: ask-matt
description: Ask which skill or flow fits your situation. A router over the skills in this repo.
disable-model-invocation: true
---
```

SKILL.md frontmatter (per `docs/skills.md` "Frontmatter", [agentskills.io/specification](https://agentskills.io/specification)):

| Field | Required | Notes |
|---|---|---|
| `name` | yes | 1-64 chars, lowercase a-z 0-9 hyphens; need NOT match dir name (Pi relaxes the spec) |
| `description` | yes | ≤1024 chars; skills **without** description are NOT loaded |
| `license` | no | |
| `compatibility` | no | ≤500 chars |
| `metadata` | no | arbitrary k-v |
| `allowed-tools` | no | space-delimited (experimental) |
| `disable-model-invocation` | no | when `true`, hidden from system prompt; user must `/skill:name` |

Discovery rules (from `docs/skills.md` "Discovery rules"):
- In `~/.pi/agent/skills/` and `.pi/skills/`, root `.md` files are discovered as individual skills.
- In all skill locations, directories containing `SKILL.md` are discovered **recursively**.
- In `~/.agents/skills/` and project `.agents/skills/`, root `.md` files are **ignored** (only `SKILL.md` dirs count).
- Name collisions: warn, keep first found.
- Disable with `--no-skills` (explicit `--skill` paths still load).

Skills register as `/skill:name` commands (`docs/skills.md` "Skill Commands"):
```
/skill:brave-search
/skill:pdf-tools extract   # args appended as "User: <args>"
```
Toggle via `settings.json` `{ "enableSkillCommands": true }`.

### Prompt templates (the slash-command analog)

From `docs/prompt-templates.md`. These are the direct counterpart of Claude Code's custom slash commands.

Locations:
- Global: `~/.pi/agent/prompts/*.md`
- Project: `.pi/prompts/*.md` (after trust)
- Packages: `prompts/` dirs or `pi.prompts` in `package.json`
- Settings: `settings.json` `prompts` array
- CLI: `--prompt-template <path>` (repeatable)
- Disable: `--no-prompt-templates`

Confirmed `~/.pi/agent/prompts/` does **not** exist on this machine (user has no global templates) — valid, adapter should treat missing dir as empty.

Format (filename → command name; `review.md` → `/review`):
```markdown
---
description: Review staged git changes
argument-hint: "<PR-URL>"
---
<body with $1, $2, $@, $ARGUMENTS, ${1:-default} interpolation>
```
Frontmatter: `description` (optional; first non-empty line used if absent), `argument-hint` (optional). Discovery in `prompts/` is **non-recursive** (subdirs must be added explicitly). Body supports positional args `$1`/`$2`, `$@`/`$ARGUMENTS` for all, `${1:-default}`, `${@:N}`, `${@:N:L}`.

### Extensions (out of scope for listing, but noted)

From `docs/extensions.md`. TS modules in `~/.pi/agent/extensions/` (global) or `.pi/extensions/` (project). They can register **custom commands** via `pi.registerCommand()` (e.g. `/mycommand`), but these are code, not data files — an adapter cannot enumerate them without executing TS. `pi list` lists installed extension *packages* (from `settings.json` `packages[]`, e.g. `npm:@liziy/token-stats`) but not their commands. Skip for the listing feature.

### Invocation in non-interactive / rpc mode

The adapter uses `pi --mode rpc` and writes `prompt` commands to stdin. Confirmed from `docs/rpc.md`:

> **Input expansion**: Skill commands (`/skill:name`) and prompt templates (`/template`) are expanded before sending/queueing.

So in rpc mode, the adapter sends a `prompt` command whose message text contains `/skill:<name> <args>` or `/<template> <args>`, and Pi expands it before passing to the model — exactly parallel to Claude Code's prompt-text `/name`. Same `steer`/`follow_up` commands also expand skill/template input. Extension commands (`/mycommand`) are **not** expanded in `steer`/`follow_up` (only in `prompt`); since the adapter won't list extension commands anyway, this is fine.

CLI flags (from `pi --help`):
- `--skill <path>` — load an extra skill file/dir (repeatable, additive even with `--no-skills`). Not a listing tool; only for adding.
- `--no-skills` — disable discovery.
- `--prompt-template <path>` (repeatable), `--no-prompt-templates`.
- `--no-extensions`, `--extension/-e <path>`.
- No `--list-skills` / `--list-commands` flag exists.

### Settings file correction

The task brief says "settings file is `~/.pi/agent/models.json` with template `{"providers":{}}`". That's only the models file. The real **settings** file is `~/.pi/agent/settings.json`. Confirmed contents:
```json
{
  "lastChangelogVersion": "0.82.1",
  "theme": "light",
  "packages": ["npm:@liziy/token-stats"],
  "defaultProvider": "moonshot",
  "defaultModel": "kimi-k3"
}
```
`settings.json` is also where `skills[]`, `prompts[]`, `enableSkillCommands` live when set (per the docs). `models.json` is a separate concerns file. The adapter's existing self-test should not be confused.

---

## Adapter contract recommendation

```ts
interface SkillEntry  { name: string; description: string; source: 'user'|'project'|'plugin'|'builtin'; pluginName?: string; dir: string; }
interface CommandEntry { name: string; description: string; source: 'user'|'project'|'plugin'|'builtin'; argumentHint?: string; pluginName?: string; file: string; }
```

### `listSkills()` / `listCommands()` — Claude Code

Read these on-disk sources (frontmatter-parse each SKILL.md / command file's YAML; for `.toml` commands parse `description`/`prompt`):

| Entry kind | Source dir(s) | `source` | Notes |
|---|---|---|---|
| user skill | `~/.claude/skills/*/SKILL.md` (+ root `*.md`) | `user` | walk subdirs; SKILL.md is recursive |
| project skill | `<cwd>/.claude/skills/**/SKILL.md`, up to repo root | `project` | |
| plugin skill | for each row in `~/.claude/plugins/installed_plugins.json` → `<installPath>/skills/**/SKILL.md` | `plugin` | pluginName = part before `@` |
| user command | `~/.claude/commands/*.md` and `*.toml` | `user` | |
| project command | `<cwd>/.claude/commands/**/*.md`/`*.toml` | `project` | subdir prefix → `group:name` (e.g. `trellis:continue`) |
| plugin command | `<installPath>/commands/**/*.{md,toml}` | `plugin` | |
| builtin | — | `builtin` | NOT enumerable from disk; return `[]` or hardcode a curated list (`clear`,`help`,`init`,`config`,`resume`) |

Invocation: no flag changes — append `/name` (or `/group:name`) to the prompt string the adapter already builds. Confirmed by `claude --help` `--bare` note: *"Skills still resolve via /skill-name."*

### `listSkills()` / `listCommands()` — Pi

Pi **does** have skills and prompt-templates — do NOT return empty arrays. Read:

| Entry kind | Source dir(s) | `source` | Notes |
|---|---|---|---|
| user skill | `~/.pi/agent/skills/*/SKILL.md` (+ root `*.md`) | `user` | recursive SKILL.md discovery |
| shared-agent skill | `~/.agents/skills/*/SKILL.md` | `user` | root `.md` ignored here |
| project skill | `.pi/skills/`, `.agents/skills/` (cwd + ancestors to repo root) | `project` | only if project trusted — but adapter can still read files regardless |
| package skill | from `settings.json` `packages[]` + `skills[]` | `plugin` | parse `package.json` `pi.skills`/`skills/` dirs; lower priority |
| user template (command) | `~/.pi/agent/prompts/*.md` | `user` | **non-recursive**; filename = command name |
| project template | `.pi/prompts/*.md` | `project` | non-recursive |
| package template | packages' `prompts/` dirs / `pi.prompts` | `plugin` | |
| extension command | `~/.pi/agent/extensions/*.ts` | — | SKIP (code, not data; not enumerable without executing) |

Invocation (rpc): no new flags. The adapter writes a `prompt` command to stdin whose message text is `/skill:<name> <args>` or `/<template> <args>`; `docs/rpc.md` confirms Pi expands both before send. (Note the `skill:` prefix is mandatory for skills; templates use bare `/name`.)

For Pi, `listCommands()` maps to **prompt templates**, not extension commands. If a UI wants to also surface extension-registered commands, it cannot do so statically — leave empty and document the gap.

### Caveats

- **Built-ins**: Neither CLI exposes built-in slash commands as enumerable files. Claude Code `/clear` `/help` `/init` etc. and any Pi built-ins are hardcoded. Adapter should either hardcode a small known list (drift risk) or omit (cleaner). Recommendation: omit, document.
- **Project trust**: Pi only loads `.pi/skills` etc. after the project is trusted. The adapter can still *read* the files (it's just listing), but a Pi started in rpc mode against an untrusted project won't actually resolve those skills. Document this; don't try to replicate trust logic.
- **`.toml` commands** (Claude Code plugins): only some plugins use them (ponytail). Adapter's command parser must handle both `.md` (frontmatter + body) and `.toml` (`description`/`prompt` keys).
- **Name collisions**: Pi keeps first found and warns; Claude Code plugin/user/project precedence is not documented here. Adapter should define a deterministic precedence (suggest user > project > plugin, mirroring config layering) rather than relying on glob order.
- **Frontmatter parsing**: Use a real YAML parser for the frontmatter block (between `---` fences), not regex. Skills use the same Agent Skills spec on both sides, so one parser covers both CLIs for skills; commands need separate `.md`/`.toml` handling.

## Files inspected (internal)

| File Path | Relevance |
|---|---|
| `/Users/yiminlin/project/quill/packages/cli-adapter/src/claudeAdapter.ts` | Current `buildClaudeArgs` — base flags + `--append-system-prompt`/`--agent`/`--agents`/`--add-dir`/`--resume`/`--bare`. No skill/command listing today. |
| `/Users/yiminlin/project/quill/packages/cli-adapter/src/piAdapter.ts` | rpc-mode prompt command builder; `translatePiEvent` handles `extension_error`. No skill listing today. |
| `/Users/yiminlin/project/quill/packages/cli-adapter/src/types.ts` | Adapter types (not read in detail). |

## External references

- Claude Code skills — https://docs.claude.com/en/docs/claude-code/skills (layout: `~/.claude/skills/<name>/SKILL.md`, frontmatter `name`/`description`)
- Claude Code slash commands — https://docs.claude.com/en/docs/claude-code/slash-commands (frontmatter `description`/`allowed-tools`/`argument-hint`, `$ARGUMENTS` interpolation; project commands in `.claude/commands/`)
- Claude Code plugins — https://docs.claude.com/en/docs/claude-code/plugins (marketplace + cache layout; `installed_plugins.json`)
- Pi skills doc — bundled at `<npm-root>/@earendil-works/pi-coding-agent/docs/skills.md` (locations, frontmatter table, discovery rules)
- Pi prompt-templates doc — bundled `docs/prompt-templates.md` (locations, format, arg syntax)
- Pi extensions doc — bundled `docs/extensions.md` (extension commands via `pi.registerCommand()` — code, not data)
- Pi rpc doc — bundled `docs/rpc.md` ("Input expansion: Skill commands (`/skill:name`) and prompt templates (`/template`) are expanded before sending/queueing")
- Agent Skills standard — https://agentskills.io/specification (shared spec both CLIs follow)
