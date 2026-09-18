# folyn-extension-dev-skill

A Code-Agent skill for developing [Folyn](https://github.com/linyimin0812/folyn)
extensions end to end: **scaffold → develop with the SDK → publish to the Folyn
extension store**.

## Install as a real skill

```bash
npx folyn-extension-dev-skill
```

In a TTY it opens an arrow-key menu — pick an agent with **↑/↓** (or `j`/`k`),
**Enter** to confirm. It installs `SKILL.md` + `references/` into
`<skills-dir>/folyn-extension-dev/` so the agent discovers it as a registered
skill alongside its built-ins.

Agent skills dirs:

| `--agent` key | Dir | Harness |
| --- | --- | --- |
| `pi` | `~/.pi/agent/skills` | pi / ThinkRail |
| `claude` | `~/.claude/skills` | Claude Code |
| `agent` | `~/.agents/skills` | generic (cross-harness) |

Non-interactive options:

```bash
npx folyn-extension-dev-skill --agent agent      # the generic ~/.agents/skills
npx folyn-extension-dev-skill --agent claude    # Claude Code
npx folyn-extension-dev-skill --dir /path/to/skills   # custom
npx folyn-extension-dev-skill --yes             # all detected dirs
```

The interactive menu offers: each agent (marked `[detected]` if present),
`all detected`, or `custom path` (prompts for a path). Piped stdin / non-TTY
auto-falls back to `--yes`.

Restart your agent (or reload skills) after install for it to be discovered.

Uninstall: `rm -rf <skills-dir>/folyn-extension-dev`

## What the skill does

An agent that picks up this skill follows four phases:

1. **Scaffold** — `npx create-folyn-extension <name> --tier <trusted|sandbox>`
2. **Develop** — wire `manifest.json` contribution points ↔ `src/index.ts`
   `ExtensionModule` maps, against `folyn-extension-sdk`
3. **Build & test** — `pnpm build` → install `dist/` in Folyn → reload
4. **Publish** — zip `dist/` → GitHub Release → PR `catalog.json` in the
   `folyn-extensions` repo → users install via the in-app Store

## What's in the package

- **`SKILL.md`** — the workflow orchestrator (commands + decisions per phase,
  pointers to authoritative references).
- **`references/contribution-points.md`** — tier × contribution × module-map
  decision matrix.
- **`references/publish-checklist.md`** — the publish runbook (exact `zip` +
  `gh release` commands, `catalog.json` entry shape, install-path constraints).
- **`index.js`** — the installer bin.

## How this skill relates to the others

| Package | Role |
| --- | --- |
| `create-folyn-extension` (npm) | Scaffolds an extension project (`npx create-folyn-extension`). |
| `folyn-extension-sdk` (npm) | Type contracts + dev helpers (`defineExtension`, `validateManifest`) + the full `docs/` (`extension-development.md`, `extension-sdk-reference.md`). |
| **`folyn-extension-dev-skill`** (this) | The agent-facing skill that orchestrates the above two into a workflow and adds the publish runbook. Installs into the agent's skills dir. |

The scaffolded project ships its own `AGENTS.md` with the full in-project
contribution contract; this skill does not duplicate it — it routes to it.

## License

MIT — same as the Folyn project.
