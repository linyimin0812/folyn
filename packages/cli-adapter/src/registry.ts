import type { CliAdapter } from './types';
import { ClaudeAdapter } from './claudeAdapter';
import { CodexAdapter } from './codexAdapter';
import { GeminiAdapter } from './geminiAdapter';
import { OpencodeAdapter } from './opencodeAdapter';
import { PiAdapter } from './piAdapter';
import { QoderAdapter } from './qoderAdapter';

type AdapterDescriptor = {
  displayName: string;
  description: string;
  factory: () => CliAdapter;
  /** Home-relative path to the adapter's user-editable settings file. The
   *  settings UI offers a button to open this file in Folyn's editor. Use `~`
   *  so `externalFileProvider.resolveHome` expands it; never bake in an
   *  absolute path. */
  settingsFilePath: string;
  /** Initial content written when the user asks to create a missing settings
   *  file. Each adapter picks the minimal valid shape for its own schema. */
  settingsFileTemplate: string;
};

const CLAUDE_SETTINGS_TEMPLATE = '{}\n';
const PI_SETTINGS_TEMPLATE = '{\n  "providers": {}\n}\n';
// ponytail: empty TOML file is valid — Codex boots with defaults. A
// comment-only template still parses as empty and tells the user how to
// bootstrap auth (separate from config) when they click "create settings".
const CODEX_SETTINGS_TEMPLATE = '# Codex config (TOML). Empty is valid — Codex boots with defaults.\n# Run `codex login` to set up auth at ~/.codex/auth.json.\n';
// ponytail: empty JSON — qodercli boots with defaults; `qodercli login` sets
// up auth under ~/.qoder/.auth/ (separate from settings.json).
const QODER_SETTINGS_TEMPLATE = '{}\n';

// ponytail: empty JSONC — opencode boots with defaults; `opencode providers
// login` sets up auth at ~/.local/share/opencode/auth.json (separate from
// the user config). $schema helps editors validate the file.
const OPENCODE_SETTINGS_TEMPLATE =
  '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';

// ponytail: empty JSON — gemini boots with defaults; auth is configured via
// settings.json's security.auth.selectedType + GEMINI_API_KEY env var (no
// `auth` subcommand exists, unlike opencode's `providers login`). Minimal
// template pins the auth type so the CLI picks up the API key from env.
const GEMINI_SETTINGS_TEMPLATE =
  '{\n  "security": {\n    "auth": {\n      "selectedType": "gemini-api-key"\n    }\n  }\n}\n';

const ADAPTERS: Record<string, AdapterDescriptor> = {
  claude: {
    displayName: 'Claude Code',
    description: 'Anthropic 官方 CLI 工具，支持对话式编辑与多工具调用',
    factory: () => new ClaudeAdapter(),
    settingsFilePath: '~/.claude/settings.json',
    settingsFileTemplate: CLAUDE_SETTINGS_TEMPLATE,
  },
  codex: {
    displayName: 'Codex',
    description: 'OpenAI Codex CLI（codex exec --json），一发一进程，exec/resume 两模式，shell + apply_patch 工具',
    factory: () => new CodexAdapter(),
    settingsFilePath: '~/.codex/config.toml',
    settingsFileTemplate: CODEX_SETTINGS_TEMPLATE,
  },
  pi: {
    displayName: 'Pi',
    description: 'pi 代码 Agent（@earendil-works/pi-coding-agent），read/bash/edit/write 工具，rpc 多轮会话',
    factory: () => new PiAdapter(),
    settingsFilePath: '~/.pi/agent/models.json',
    settingsFileTemplate: PI_SETTINGS_TEMPLATE,
  },
  // ponytail: one parameterized class backs both intl + cn — qodercli and
  // qoderclicn share the same CLI surface (research/qoder-cli-shape.md §5);
  // only binary name, config dir, and sidecar registration differ.
  qoder: {
    displayName: 'Qoder',
    description: 'Qoder CLI（qodercli -p --output-format stream-json），一发一进程，shell + tool_use 工具',
    factory: () => new QoderAdapter({
      id: 'qoder',
      displayName: 'Qoder',
      description: 'Qoder CLI（qodercli -p --output-format stream-json），一发一进程，shell + tool_use 工具',
      sidecarName: 'qoder-cli',
      cliPathDefault: 'qodercli',
    }),
    settingsFilePath: '~/.qoder/settings.json',
    settingsFileTemplate: QODER_SETTINGS_TEMPLATE,
  },
  'qoder-cn': {
    displayName: 'Qoder (China)',
    description: 'Qoder CLI 中国版（qoderclicn -p --output-format stream-json），与国际版同源，endpoint/配置目录差异',
    factory: () => new QoderAdapter({
      id: 'qoder-cn',
      displayName: 'Qoder (China)',
      description: 'Qoder CLI 中国版（qoderclicn -p --output-format stream-json），与国际版同源，endpoint/配置目录差异',
      sidecarName: 'qoder-cli-cn',
      cliPathDefault: 'qoderclicn',
    }),
    settingsFilePath: '~/.qodercn/settings.json',
    settingsFileTemplate: QODER_SETTINGS_TEMPLATE,
  },
  opencode: {
    displayName: 'opencode',
    description: 'opencode CLI（opencode run --format json --auto），一发一进程，NDJSON 事件流，shell + tool 工具',
    factory: () => new OpencodeAdapter(),
    settingsFilePath: '~/.config/opencode/opencode.jsonc',
    settingsFileTemplate: OPENCODE_SETTINGS_TEMPLATE,
  },
  gemini: {
    displayName: 'Gemini',
    description: 'Gemini CLI（gemini -p -o stream-json -y --skip-trust），一发一进程，NDJSON 事件流，shell + tool 工具',
    factory: () => new GeminiAdapter(),
    settingsFilePath: '~/.gemini/settings.json',
    settingsFileTemplate: GEMINI_SETTINGS_TEMPLATE,
  },
};

/** List all registered CLI adapters (id + display metadata + settings file). */
export function listAdapters(): {
  id: string;
  displayName: string;
  description: string;
  settingsFilePath: string;
  settingsFileTemplate: string;
}[] {
  return Object.entries(ADAPTERS).map(([id, d]) => ({
    id,
    displayName: d.displayName,
    description: d.description,
    settingsFilePath: d.settingsFilePath,
    settingsFileTemplate: d.settingsFileTemplate,
  }));
}

/** Create an adapter instance by id. Throws if the id is unknown. */
export function createAdapter(id: string): CliAdapter {
  const descriptor = ADAPTERS[id];
  if (!descriptor) {
    throw new Error(`CLI adapter "${id}" not found`);
  }
  return descriptor.factory();
}
