import type { CliSendOptions, PermissionMode } from '@quill/cli-adapter';
import { MessageSquare, Bot, CircleHelp, type LucideIcon } from 'lucide-react';

/**
 * Declarative descriptor for an AI panel input mode (ask / agent / future).
 *
 * Most modes only need to fill the declarative fields (`permissionMode`,
 * `bare`, `systemPrompt`, …) — `resolveSendOptions` merges them onto the
 * caller's base `CliSendOptions`. Modes that need dynamic logic (e.g. computing
 * a tool whitelist from vault state) can supply `buildSendOptions`, which runs
 * after the declarative merge and may override anything.
 *
 * To add a new mode: call `registerInputMode({ id, label, ... })`. ChatInput
 * renders the toggle from `listInputModes()`, so a registered mode appears in
 * the UI with no further changes.
 */
export interface AiInputModeDef {
  id: string;
  label: string;
  /** Icon for the compact (icon-only) mode trigger + dropdown rows.
   *  Optional — ChatInput falls back to a generic sparkles glyph. */
  icon?: LucideIcon;
  /** Short human hint shown as the button title. */
  description?: string;
  /** Maps to `--permission-mode`. */
  permissionMode?: PermissionMode;
  /** Reserved for future tool-whitelist wiring (not yet consumed by buildClaudeArgs). */
  allowedTools?: string[];
  /** Reserved for future tool-blacklist wiring. */
  disallowedTools?: string[];
  /** Override `--bare` (defaults to true when unset). */
  bare?: boolean;
  /** Appended to the CLI's default system prompt via `--append-system-prompt`. */
  systemPrompt?: string;
  /** Which backend serves this mode. `'rig'` modes bypass the CLI adapter and
   * call the Rust `chat_stream` command directly (see `services/rigChat.ts`);
   * unset (the default) means the CLI adapter (`claude` binary). */
  backend?: 'rig';
  /** Escape hatch: transform the merged options arbitrarily. Runs last. */
  buildSendOptions?: (base: CliSendOptions) => CliSendOptions;
}

const defsById = new Map<string, AiInputModeDef>();
const order: string[] = [];

/** Register (or replace) an input mode. Idempotent on `id`. */
export function registerInputMode(def: AiInputModeDef): void {
  if (!defsById.has(def.id)) order.push(def.id);
  defsById.set(def.id, def);
}

/** Look up a mode by id (e.g. the value stored in `aiStore.inputMode`). */
export function getInputModeDef(id: string): AiInputModeDef | undefined {
  return defsById.get(id);
}

/** Ordered list of registered modes, for rendering the ChatInput toggle. */
export function listInputModes(): AiInputModeDef[] {
  return order.map((id) => defsById.get(id)!).filter(Boolean);
}

/**
 * Merge a mode's declarative fields onto `base`, then apply its
 * `buildSendOptions` escape hatch if present. Unknown mode ids return `base`
 * unchanged so a stale stored `inputMode` never breaks sending.
 */
export function resolveSendOptions(modeId: string, base: CliSendOptions): CliSendOptions {
  const def = defsById.get(modeId);
  if (!def) return base;
  const merged: CliSendOptions = { ...base };
  if (def.permissionMode !== undefined) merged.permissionMode = def.permissionMode;
  if (def.bare !== undefined) merged.bare = def.bare;
  if (def.systemPrompt) merged.systemPrompt = def.systemPrompt;
  return def.buildSendOptions ? def.buildSendOptions(merged) : merged;
}

// --- Built-in modes -------------------------------------------------------
// Display order in the ChatInput toggle follows registration order:
// Chat → Agent → Ask.
registerInputMode({
  id: 'chat',
  label: 'Chat',
  icon: MessageSquare,
  description: '多轮对话（rig 直连 LLM，无工具，不读写文件）',
  backend: 'rig',
});
registerInputMode({
  id: 'agent',
  label: 'Agent',
  icon: Bot,
  description: '全工具自主执行（可读写文件）',
  permissionMode: 'bypassPermissions',
  // bare:false aligns with interactive Claude Code: --bare isolates the
  // session and skips discovery of user/project skills (and CLAUDE.md /
  // cwd agents), so /skill-name from the slash dropdown would resolve to
  // "Unknown command". Matching the interactive CLI keeps skills loadable.
  bare: false,
});
registerInputMode({
  id: 'ask',
  label: 'Ask',
  icon: CircleHelp,
  description: '只读问答，不修改文件',
  permissionMode: 'plan',
});

/** True if the mode is served by the rig backend (bypasses the CLI adapter). */
export function isRigMode(modeId: string): boolean {
  return getInputModeDef(modeId)?.backend === 'rig';
}
