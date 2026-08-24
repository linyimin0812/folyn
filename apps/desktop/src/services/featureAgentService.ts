// Feature agent 框架：canonical agent 文件播种 + getFeatureAgentSendOptions。
//
// 设计见 `.trellis/tasks/07-01-refactor-wiki-clips-schedule-project-analysis-to-per-vault-claude-agents/prd.md`：
// - 每 feature 独立子目录 `<vault>/__{feature}__/.claude/`（含 CLAUDE.md + agents/<feature>.md）。
// - canonical 源文件按功能就近放 `apps/desktop/src/<feature>/.claude/{CLAUDE.md,agents/<feature>.md}`，经 `?raw` import。
// - vault 切换/启动/lazy-seed 时把 canonical 文件拷贝到 `<vault>/__{feature}__/.claude/`，**always-overwrite**（canonical 是 single source of truth，不保留 vault 副本的用户手改）。
// - feature agent 调用：agent 文件存在 → `adapter.send(instruction, {agent, bare:false})`（cwd=`__{feature}__/` 自动发现）；
//   不存在 → 回退 `--bare` + `--agents` 内联交付 canonical agent 定义（contract 不丢，spec `feature-agents.md` Validation Matrix 承诺的 graceful degradation）。
// - schedule feature 额外传 `--add-dir <vault>` 以便访问 `__daily__/` 日记与今日修改文档。

import type { CliAgentDefinition, CliSendOptions } from '@mochi/cli-adapter';
import type { VaultManager } from '@mochi/vault-provider';
import analyzeAgentDoc from '@/features/analyze/.claude/agents/analyze.md?raw';
import analyzeClaudeDoc from '@/features/analyze/.claude/CLAUDE.md?raw';
import clipsAgentDoc from '@/features/clips/.claude/agents/clips.md?raw';
import clipsClaudeDoc from '@/features/clips/.claude/CLAUDE.md?raw';
import scheduleAgentDoc from '@/features/schedule/.claude/agents/schedule.md?raw';
import scheduleClaudeDoc from '@/features/schedule/.claude/CLAUDE.md?raw';
import wikiAgentDoc from '@/features/wiki/.claude/agents/wiki.md?raw';
import wikiClaudeDoc from '@/features/wiki/.claude/CLAUDE.md?raw';
import { resolveBasePath } from '@/utils/pathResolver';

/** Feature 子目录名前缀/后缀（双下划线包裹，与现有 `__clips__` / `__wiki__` / `__daily__` 约定一致）。 */
function featureDir(feature: string): string {
  return `__${feature}__`;
}

/** Vault 内 .claude 目录（相对 vault 根）。 */
function claudeDir(feature: string): string {
  return `${featureDir(feature)}/.claude`;
}

/** Vault 内 agent 文件存放目录（相对 vault 根）。 */
function agentsDir(feature: string): string {
  return `${claudeDir(feature)}/agents`;
}

/** Vault 内 CLAUDE.md 路径（相对 vault 根）。 */
function claudeMdPath(feature: string): string {
  return `${claudeDir(feature)}/CLAUDE.md`;
}

/** Vault 内 agent 文件路径（相对 vault 根）。 */
function agentFilePath(feature: string, file: string): string {
  return `${agentsDir(feature)}/${file}`;
}

/** 诊断日志目录（相对 vault 根；已在 excludePatterns 里，不污染文件树）。 */
const SEED_LOG_DIR = '.mochi-tmp';
/** 诊断日志文件路径（相对 vault 根）。 */
const SEED_LOG_PATH = `${SEED_LOG_DIR}/feature-agent-seed.log`;

/** 已注册的 feature agent（canonical 文件 → vault 播种目标）。 */
export interface FeatureAgentEntry {
  /** Feature 名（同时是 `--agent <name>` 的值与 vault 文件主名）。 */
  feature: string;
  /** vault 内 agent 文件名（`<agentsDir(feature)>/<file>`）。 */
  file: string;
  /** canonical agent 文件内容（`?raw` import）。 */
  doc: string;
  /** canonical CLAUDE.md 内容（`?raw` import）。 */
  claudeDoc: string;
  /** 调用时是否额外传 `--add-dir <vault>`（schedule 需要跨目录访问 `__daily__/`）。 */
  addVaultDir?: boolean;
  /** 本 feature agent 跑在哪个 CLI adapter 上（impl-decided，不受用户选器影响）。
   *  缺省 `'claude'`。scope A：v1 全部留 claude；`'pi'` 时 seedAgentFiles 额外播
   *  `<vault>/__{feature}__/AGENTS.md`（pi 在 cwd 自动发现）。
   *  pi 路径的 web/addDir 缺口在切该 feature 到 pi 时再处理。 */
  adapterId?: 'claude' | 'pi';
}

/**
 * Feature agent 注册表。新增 feature 时在此登记 canonical 文件。
 * - analyze/clips/schedule/wiki 走 bespoke 流程（getFeatureAgentSendOptions 仅给 adapter.send 提供 options）。
 */
export const FEATURE_AGENTS: FeatureAgentEntry[] = [
  { feature: 'analyze', file: 'analyze.md', doc: analyzeAgentDoc, claudeDoc: analyzeClaudeDoc },
  { feature: 'clips', file: 'clips.md', doc: clipsAgentDoc, claudeDoc: clipsClaudeDoc },
  { feature: 'schedule', file: 'schedule.md', doc: scheduleAgentDoc, claudeDoc: scheduleClaudeDoc, addVaultDir: true },
  { feature: 'wiki', file: 'wiki.md', doc: wikiAgentDoc, claudeDoc: wikiClaudeDoc },
];

/** 取某 feature 的注册项（不存在返回 undefined）。 */
export function getFeatureAgentEntry(feature: string): FeatureAgentEntry | undefined {
  return FEATURE_AGENTS.find((e) => e.feature === feature);
}

/**
 * 从 canonical agent .md frontmatter 解析出 `CliAgentDefinition`。
 * canonical 形如：
 * ```
 * ---
 * name: clips
 * description: ...
 * tools: WebFetch, WebSearch, Read
 * ---
 * <body>
 * ```
 * frontmatter 缺失或字段缺失时降级（至少返回 `{ prompt: <整份 md> }`）。
 *
 * 用于 fallback 路径：agent 文件未播种时，把解析后的 definition 通过 `--agents` flag 内联交付给 CLI，
 * 让 agent 仍能拿到输出契约（spec `feature-agents.md` Validation Matrix）。
 */
function parseAgentDoc(md: string): CliAgentDefinition {
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    return { prompt: md };
  }
  const fm = fmMatch[1];
  const body = fmMatch[2];
  const description = matchField(fm, 'description');
  const toolsLine = matchField(fm, 'tools');
  const tools = toolsLine
    ? toolsLine.split(',').map((t) => t.trim()).filter(Boolean)
    : undefined;
  return { description, prompt: body, tools };
}

/** 从 frontmatter 文本中取 `<key>: <value>` 行的 value（去引号、trim）；不存在返回 undefined。 */
function matchField(fm: string, key: string): string | undefined {
  const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!m) return undefined;
  return m[1].trim().replace(/^["']|["']$/g, '');
}

/** vault 内 agent 文件的相对路径（`__{feature}__/.claude/agents/<file>`）；未注册返回 null。 */
export function agentFilePathOf(feature: string): string | null {
  const entry = getFeatureAgentEntry(feature);
  return entry ? agentFilePath(entry.feature, entry.file) : null;
}

/** vault 内 CLAUDE.md 的相对路径（`__{feature}__/.claude/CLAUDE.md`）；未注册返回 null。 */
export function claudeMdPathOf(feature: string): string | null {
  const entry = getFeatureAgentEntry(feature);
  return entry ? claudeMdPath(entry.feature) : null;
}

/** pi feature-agent 上下文文件路径：`<vault>/__{feature}__/AGENTS.md`。
 *  pi 在 cwd 自动发现 `AGENTS.md`（等价于 claude 发现 `.claude/CLAUDE.md`）。
 *  未注册返回 null。 */
export function piContextFilePath(feature: string): string | null {
  const entry = getFeatureAgentEntry(feature);
  return entry ? `${featureDir(entry.feature)}/AGENTS.md` : null;
}

/** pi 侧播种目标（仅当 entry.adapterId==='pi'）：写 `<vault>/__{feature}__/AGENTS.md`，
 *  内容为 canonical CLAUDE.md（feature 上下文散文，工具无关，复用，不另起 pi 原生资产）。
 *  adapterId!='pi' → 空数组（claude 路径不走 pi 上下文播种）。 */
export function piSeedTargets(entry: FeatureAgentEntry): { path: string; content: string }[] {
  if ((entry.adapterId ?? 'claude') !== 'pi') return [];
  const path = piContextFilePath(entry.feature);
  return path ? [{ path, content: entry.claudeDoc }] : [];
}

/**
 * 调用时的懒播种兜底：即使启动时 switchVault 的 seeding 被跳过/失败，
 * 首次调用也会补播种。always-overwrite（重复写 canonical，安全）。
 *
 * 取 manager：动态 import vaultStore 避免循环依赖。
 * 失败静默（seedAgentFiles 内部已 catch）。
 */
async function lazySeedAgentFiles(): Promise<void> {
  try {
    const { useVaultStore } = await import('@/store/vaultStore');
    const manager = useVaultStore.getState().manager;
    if (!manager) return;
    await seedAgentFiles(manager);
  } catch (err) {
    console.warn('[featureAgent] lazy seed failed:', err);
  }
}

/**
 * 检查 `<vault>/__{feature}__/.claude/agents/<feature>.md` 是否存在（已播种或用户自建）。
 * vault 不可读 / 文件缺失 → 返回 false（调用方回退 `--bare`）。
 */
export async function agentFileExists(manager: VaultManager, feature: string): Promise<boolean> {
  const entry = getFeatureAgentEntry(feature);
  if (!entry) return false;
  const path = agentFilePath(entry.feature, entry.file);
  try {
    await manager.readFile(path);
    return true;
  } catch {
    return false;
  }
}

/** 单个 feature 播种结果（agent 文件 + CLAUDE.md 各一条）。 */
export interface SeedAgentResult {
  feature: string;
  path: string;
  /** 'seeded' (写了) | 'failed' (写失败)。'exists' 历史保留，always-overwrite 下不再触发。 */
  status: 'seeded' | 'exists' | 'failed';
  /** status==='failed' 时的错误信息。 */
  error?: string;
}

/**
 * 把所有已注册的 canonical 文件（agent .md + CLAUDE.md）播种到 `<vault>/__{feature}__/.claude/`。
 * **always-overwrite**：canonical 是 single source of truth，不保留 vault 副本的用户手改。缺父目录会自动创建。
 *
 * 播种失败（vault 只读等）静默降级——调用时 `agentFileExists` 返回 false → `--bare` 回退。
 * 不抛错，不阻塞 vault 切换。返回每个文件路径的播种结果（用于诊断）。
 */
export async function seedAgentFiles(manager: VaultManager): Promise<SeedAgentResult[]> {
  const results: SeedAgentResult[] = [];

  // 先确保所有 feature 的 agents/ 目录存在（非 tauri provider 的 writeFile 未必自动建父目录）。
  for (const entry of FEATURE_AGENTS) {
    try {
      await manager.createDir(agentsDir(entry.feature));
    } catch {
      // 目录已存在或 vault 不可写——继续尝试逐文件写入。
    }
  }

  for (const entry of FEATURE_AGENTS) {
    // CLAUDE.md（always-overwrite：canonical 是 single source of truth，vault 副本不保留用户手改）
    const claudePath = claudeMdPath(entry.feature);
    try {
      await manager.writeFile(claudePath, entry.claudeDoc);
      results.push({ feature: entry.feature, path: claudePath, status: 'seeded' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[featureAgent] seed CLAUDE.md failed for "${entry.feature}" at ${claudePath}:`, err);
      results.push({ feature: entry.feature, path: claudePath, status: 'failed', error: msg });
    }

    // agent .md（同 always-overwrite 策略）
    const agentPath = agentFilePath(entry.feature, entry.file);
    try {
      await manager.writeFile(agentPath, entry.doc);
      results.push({ feature: entry.feature, path: agentPath, status: 'seeded' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[featureAgent] seed agent failed for "${entry.feature}" at ${agentPath}:`, err);
      results.push({ feature: entry.feature, path: agentPath, status: 'failed', error: msg });
    }

    // pi feature-agent 上下文：adapterId='pi' 时额外写 `<vault>/__{feature}__/AGENTS.md`
    // （pi 在 cwd 自动发现 AGENTS.md）。同 always-overwrite 策略。
    // scope A：无 entry 设 adapterId='pi' → piSeedTargets 返 []，本块为 no-op。
    for (const target of piSeedTargets(entry)) {
      try {
        await manager.writeFile(target.path, target.content);
        results.push({ feature: entry.feature, path: target.path, status: 'seeded' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[featureAgent] seed pi context failed for "${entry.feature}" at ${target.path}:`, err);
        results.push({ feature: entry.feature, path: target.path, status: 'failed', error: msg });
      }
    }
  }

  // 写诊断日志到 <vault>/.mochi-tmp/feature-agent-seed.log（失败不抛）。
  await writeSeedLog(manager, results);
  return results;
}

/**
 * 把播种结果写入 `<vault>/.mochi-tmp/feature-agent-seed.log`。
 * webview console 在终端看不到——写文件让用户能直接在 vault 里确认 seeding 是否生效。
 * 失败静默（只 console.warn）。
 */
async function writeSeedLog(manager: VaultManager, results: SeedAgentResult[]): Promise<void> {
  const ts = new Date().toISOString();
  const lines: string[] = [
    `# feature-agent seeding diagnostic`,
    `timestamp: ${ts}`,
    `vault-manager: ${manager ? 'present' : 'null'}`,
    ``,
    `## results (${results.length})`,
  ];
  for (const r of results) {
    const detail = r.status === 'failed' ? ` — error: ${r.error}` : '';
    lines.push(`- ${r.feature}: ${r.status} (${r.path})${detail}`);
  }
  lines.push(``);
  const content = lines.join('\n');
  try {
    try {
      await manager.createDir(SEED_LOG_DIR);
    } catch {
      // 目录已存在或不可写——继续尝试写文件。
    }
    // 覆盖写（每次播种刷新日志，便于诊断最新一次）。
    await manager.writeFile(SEED_LOG_PATH, content);
    console.log(`[featureAgent] seed log written to ${SEED_LOG_PATH}`);
  } catch (err) {
    console.warn(`[featureAgent] failed to write seed log at ${SEED_LOG_PATH}:`, err);
  }
}

/**
 * feature agent 是否可用（agent 文件已播种/用户自建 + adapter 配置就绪）。
 * 供 UI 禁用按钮：agent 不存在时走 `--bare` 回退（仍可调用，但不是"feature agent 模式"）。
 */
export async function isAgentAvailable(feature: string): Promise<boolean> {
  try {
    // 调用时懒播种兜底（幂等，安全）。
    await lazySeedAgentFiles();
    const { useVaultStore } = await import('@/store/vaultStore');
    const manager = useVaultStore.getState().manager;
    return await agentFileExists(manager, feature);
  } catch {
    return false;
  }
}

/**
 * 给 bespoke feature service（analyze/clips/schedule/wiki）用的轻量辅助：返回 `adapter.send`
 * 的 options 片段。这些 feature 不走 aiStore 会话，保留各自 collectTextFromStream /
 * setDigest 结果处理；只把 send 从无 options 升级为 feature-agent 模式。
 *
 * - agent 文件存在 → `{ agent: feature, bare: false, addDir? }`（cwd=`__{feature}__/` 自动发现）。
 *   schedule feature 额外传 `addDir: ['<vaultbasePath>']` 以便访问 `__daily__/` 日记。
 * - 不存在 / vault 不可读 → `{ agent: feature, bare: true, agents: { [feature]: def }, addDir? }`
 *   （`--bare` 回退 + `--agents` 内联交付 canonical agent 定义，contract 不丢，spec graceful degradation）。
 *
 * 调用方把自己的 `adapter.send(prompt)` 改为 `adapter.send(prompt, await getFeatureAgentSendOptions(feature))`。
 * workingDir 仍由调用方在 `adapter.start({workingDir})` 处设为 `<vault>/__{feature}__/`。
 */
export async function getFeatureAgentSendOptions(feature: string): Promise<CliSendOptions> {
  try {
    // 调用时懒播种兜底（幂等，安全）。
    await lazySeedAgentFiles();
    const { useVaultStore } = await import('@/store/vaultStore');
    const vault = useVaultStore.getState();
    const manager = vault.manager;
    const available = await agentFileExists(manager, feature);
    const entry = getFeatureAgentEntry(feature);

    // schedule feature 需要 --add-dir <vault> 访问 __daily__/ 日记与今日修改文档。
    let addDir: string[] | undefined;
    if (entry?.addVaultDir && vault.currentVault) {
      let basePath = vault.currentVault.basePath;
      if (basePath.startsWith('~')) {
        try {
          basePath = await resolveBasePath(basePath);
        } catch {
          // 路径解析失败时退回原始值
        }
      }
      addDir = [basePath];
    }

    if (available) {
      return { agent: feature, bare: false, ...(addDir ? { addDir } : {}) };
    }
    // Fallback: 内联交付 canonical agent 定义 via --agents flag。
    // agent 文件未播种 / vault 不可读时仍把 contract 交给 CLI（spec graceful degradation）。
    if (entry) {
      const def = parseAgentDoc(entry.doc);
      return {
        agent: feature,
        bare: true,
        agents: { [feature]: def },
        ...(addDir ? { addDir } : {}),
      };
    }
    return { bare: true, ...(addDir ? { addDir } : {}) };
  } catch {
    // 异常路径也尝试内联交付（registry 是静态的，不依赖 vault）。
    const entry = getFeatureAgentEntry(feature);
    if (entry) {
      const def = parseAgentDoc(entry.doc);
      return { agent: feature, bare: true, agents: { [feature]: def } };
    }
    return { bare: true };
  }
}
