#!/usr/bin/env node
// folyn-extension-dev-skill — install the Folyn extension-development skill
// into an AI agent's skills directory so the agent discovers it as a real skill.
//
// Usage:
//   npx folyn-extension-dev-skill                 interactive (TTY): pick an agent with ↑/↓ + Enter
//   npx folyn-extension-dev-skill --agent <key>   non-interactive: pi | claude | agent
//   npx folyn-extension-dev-skill --dir <path>    non-interactive: custom skills dir
//   npx folyn-extension-dev-skill --yes           non-interactive: all detected dirs
//
// Agent skills-dir candidates:
//   pi       ~/.pi/agent/skills   (pi / ThinkRail)
//   claude   ~/.claude/skills     (Claude Code)
//   agent    ~/.agents/skills     (generic — works across agent harnesses)
//
// The skill directory contains SKILL.md + references/. Restart your agent (or
// reload skills) after install for it to be discovered.

import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const root = dirname(fileURLToPath(import.meta.url));
const SKILL_NAME = "folyn-extension-dev";

// Agent skills-dir candidates. `agent` is the generic cross-harness location.
const AGENTS = [
  { key: "pi", label: "pi / ThinkRail", path: join(homedir(), ".pi/agent/skills") },
  { key: "claude", label: "Claude Code", path: join(homedir(), ".claude/skills") },
  { key: "agent", label: "generic", path: join(homedir(), ".agents/skills") },
];

const HELP = `Usage: folyn-extension-dev-skill [options]

Installs the Folyn extension-development skill into an agent's skills dir.

Options:
  --agent <pi|claude|agent>  Install into a specific agent's skills dir
  --dir <path>               Install into a custom skills dir
  --yes, -y                  Non-interactive: install into all detected dirs
  -h, --help                 Show this help

Interactive (default TTY): pick an agent with ↑/↓ + Enter.
Agent skills dirs:
  pi       ~/.pi/agent/skills   (pi / ThinkRail)
  claude   ~/.claude/skills     (Claude Code)
  agent    ~/.agents/skills     (generic)`;

function parseArgs(argv) {
  const ai = argv.indexOf("--agent");
  const di = argv.indexOf("--dir");
  const agent = ai > -1 ? argv[ai + 1] : null;
  const dir = di > -1 ? argv[di + 1] : null;
  return {
    agent,
    dir,
    yes: argv.includes("--yes") || argv.includes("-y"),
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

function validateAgentKey(key) {
  if (!AGENTS.some((a) => a.key === key)) {
    console.error(`✗ --agent must be one of: ${AGENTS.map((a) => a.key).join(", ")}`);
    console.error(HELP);
    process.exit(1);
  }
}

// Arrow-key selector over `options` (each { label }). Returns the chosen index.
// Requires a real TTY (stdin + stdout). ↑/↓ or j/k move, Enter confirms,
// Ctrl+C exits. Redraws in place via ANSI cursor movement + line clear.
function select(title, options) {
  return new Promise((resolve) => {
    stdout.write(`${title}\n`);
    let idx = 0;
    const N = options.length;

    const draw = (initial) => {
      if (!initial) {
        // cursor back up to the first option row
        stdout.write(`\x1B[${N}A`);
      }
      for (const o of options) {
        const mark = options.indexOf(o) === idx ? "❯" : " ";
        stdout.write(`\x1B[2K\r${mark} ${o.label}\n`);
      }
    };
    draw(true);

    const finish = (chosen) => {
      stdin.setRawMode(false);
      stdin.removeListener("data", onKey);
      stdin.pause();
      // clear the title + options so only install output remains
      stdout.write(`\x1B[${N + 1}A\x1B[J`);
      resolve(chosen);
    };

    const onKey = (buf) => {
      const s = buf.toString();
      if (s === "\r" || s === "\n") {
        finish(idx);
      } else if (s === "\x1B[A" || s === "k") {
        idx = (idx - 1 + N) % N;
        draw(false);
      } else if (s === "\x1B[B" || s === "j") {
        idx = (idx + 1) % N;
        draw(false);
      } else if (s === "\x03") {
        // Ctrl+C in raw mode doesn't raise SIGINT — exit explicitly.
        stdout.write("\n");
        process.exit(130);
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onKey);
  });
}

async function promptCustomPath() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    for (;;) {
      const p = (await rl.question("Skills dir path: ")).trim();
      if (p) return [p];
      console.error("✗ path required");
    }
  } finally {
    rl.close();
  }
}

async function promptDirs() {
  const opts = AGENTS.map((a) => ({
    label: `${a.label.padEnd(14)} ${a.path}${existsSync(a.path) ? " [detected]" : ""}`,
    kind: "agent",
    path: a.path,
  }));
  opts.push({ label: "all detected", kind: "all" });
  opts.push({ label: "custom path", kind: "custom" });

  const i = await select(
    "Select agent to install the skill into (↑/↓ move, Enter select):",
    opts,
  );
  const o = opts[i];
  if (o.kind === "custom") return promptCustomPath();
  if (o.kind === "all") {
    const found = AGENTS.filter((x) => existsSync(x.path)).map((x) => x.path);
    if (!found.length) {
      console.error("✗ no detected dirs — pick an agent or custom path");
      return promptDirs();
    }
    return found;
  }
  return [o.path];
}

async function install(targetSkillsDir) {
  const dest = join(targetSkillsDir, SKILL_NAME);
  // Fresh copy: drop stale files from a previous version, then lay down current.
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  await cp(join(root, "SKILL.md"), join(dest, "SKILL.md"));
  await cp(join(root, "references"), join(dest, "references"), { recursive: true });
  return dest;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.dir && args.agent) {
    console.error("✗ --dir and --agent are mutually exclusive");
    console.error(HELP);
    process.exit(1);
  }
  if (args.agent) validateAgentKey(args.agent);

  // Interactive only when both stdin + stdout are real TTYs (arrow-key selector
  // needs raw keystroke capture). Piped stdin / non-TTY auto-falls back to --yes.
  const interactive =
    !args.yes && !args.dir && !args.agent && stdin.isTTY && stdout.isTTY;

  let dirs;
  if (args.dir) {
    dirs = [args.dir];
  } else if (args.agent) {
    dirs = [AGENTS.find((a) => a.key === args.agent).path];
  } else if (interactive) {
    dirs = await promptDirs();
  } else {
    // --yes / non-TTY default: all detected, or the generic ~/.agents/skills if none.
    dirs = AGENTS.filter((a) => existsSync(a.path)).map((a) => a.path);
    if (!dirs.length) dirs = [AGENTS.find((a) => a.key === "agent").path];
  }

  let ok = 0;
  for (const d of dirs) {
    try {
      const dest = await install(d);
      console.log(`✓ installed "${SKILL_NAME}" → ${dest}`);
      ok++;
    } catch (e) {
      console.error(`✗ ${d}: ${e.message}`);
    }
  }
  if (ok) {
    console.log("");
    console.log("Restart your agent (or reload skills) and it appears as a skill.");
    console.log(`Uninstall: rm -rf <skills-dir>/${SKILL_NAME}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
