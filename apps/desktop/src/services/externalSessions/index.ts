/**
 * Entrypoint for external-session browsing + capture (slice 1: Codex,
 * slice 2: Claude Code, slice 3: pi with branch projection).
 *
 * Pure cores live in `codexSessions.ts` / `claudeSessions.ts` /
 * `piSessions.ts` / `captureService.ts`; this wrapper resolves the default
 * source roots (`~/.codex`, `~/.claude/projects`, `~/.pi/agent/sessions`) and
 * injects the Tauri adapters. Discovery aggregates every source with
 * per-source error isolation — one failing source never removes the others
 * from the list.
 */
import { homeDir, join } from '@tauri-apps/api/path';
import type { ClaudeDiscovery, ClaudeSessionFs } from './claudeSessions';
import { discoverClaudeSessions, readClaudeSession } from './claudeSessions';
import type { CodexDiscovery, CodexSessionFs } from './codexSessions';
import { discoverCodexSessions, readCodexSession } from './codexSessions';
import type { PiDiscovery } from './piSessions';
import { discoverPiSessions, readPiSession } from './piSessions';
import type { CaptureResult, CaptureWritePort, SaveCaptureInput } from './captureService';
import { saveVerbatimCapture } from './captureService';
import { errorToMessage } from './errorToMessage';
import type { ExternalSessionDetail, ExternalSessionSummary } from './types';
import { bindVaultCapturePort, tauriSessionFs } from './fs.tauri';

// ponytail: module-level cache — homeDir() is static per app session
// (mirrors versionHistory.ts). Invalidate if OS-user switching ever matters.
let codexRoot = '';
let claudeRoot = '';
let piRoot = '';

export async function resolveCodexRoot(): Promise<string> {
  if (!codexRoot) {
    const home = (await homeDir()).replace(/\/+$/, '');
    codexRoot = await join(home, '.codex');
  }
  return codexRoot;
}

export async function resolveClaudeRoot(): Promise<string> {
  if (!claudeRoot) {
    const home = (await homeDir()).replace(/\/+$/, '');
    claudeRoot = await join(home, '.claude', 'projects');
  }
  return claudeRoot;
}

export async function resolvePiRoot(): Promise<string> {
  if (!piRoot) {
    const home = (await homeDir()).replace(/\/+$/, '');
    piRoot = await join(home, '.pi', 'agent', 'sessions');
  }
  return piRoot;
}

/** FS ports per source. `tauriSessionFs` satisfies all three interfaces. */
export interface ExternalSessionFsPorts {
  codex: CodexSessionFs;
  claude: ClaudeSessionFs;
  pi: ClaudeSessionFs;
}

export interface ExternalSessionDiscovery {
  sessions: ExternalSessionSummary[];
  /** Per-source read problems, prefixed with the source name. */
  errors: string[];
}

/** Run one source's discovery; a total failure is one error, never fatal. */
async function discoverOne(
  source: string,
  run: () => Promise<CodexDiscovery | ClaudeDiscovery | PiDiscovery>,
): Promise<ExternalSessionDiscovery> {
  try {
    const result = await run();
    return { sessions: result.sessions, errors: result.errors };
  } catch (err) {
    return { sessions: [], errors: [`${source}: ${errorToMessage(err)}`] };
  }
}

export interface ExternalSessionRoots {
  codex: string;
  claude: string;
  pi: string;
}

/**
 * Discover every readable external session (list refresh / manual refresh).
 * A failure in one source is reported without dropping the other sources.
 */
export async function discoverExternalSessions(
  ports: ExternalSessionFsPorts = { codex: tauriSessionFs, claude: tauriSessionFs, pi: tauriSessionFs },
  roots?: ExternalSessionRoots,
): Promise<ExternalSessionDiscovery> {
  const r = roots ?? {
    codex: await resolveCodexRoot(),
    claude: await resolveClaudeRoot(),
    pi: await resolvePiRoot(),
  };
  const [codex, claude, pi] = await Promise.all([
    discoverOne('codex', () => discoverCodexSessions(r.codex, ports.codex)),
    discoverOne('claude', () => discoverClaudeSessions(r.claude, ports.claude)),
    discoverOne('pi', () => discoverPiSessions(r.pi, ports.pi)),
  ]);
  const sessions = [...codex.sessions, ...claude.sessions, ...pi.sessions].sort(
    (a, b) => (b.updatedAt ?? b.startedAt ?? 0) - (a.updatedAt ?? a.startedAt ?? 0),
  );
  return { sessions, errors: [...codex.errors, ...claude.errors, ...pi.errors] };
}

/** Read one session's current detail (fresh read on open), by source.
 * `branchId` (pi) selects the projected branch; linear sources ignore it.
 * `ClaudeSessionFs` is the superset port — it satisfies every reader. */
export async function readExternalSession(
  summary: ExternalSessionSummary,
  fs: ClaudeSessionFs = tauriSessionFs,
  branchId?: string,
): Promise<ExternalSessionDetail> {
  if (summary.source === 'claude') {
    return readClaudeSession(summary, fs);
  }
  if (summary.source === 'pi') {
    return readPiSession(summary, fs, branchId);
  }
  return readCodexSession(summary, fs);
}

/**
 * Save a verbatim capture into the CURRENT vault. The write port is bound
 * here — at the moment the user confirmed — so a vault switch during the
 * async write cannot retarget it.
 */
export async function saveExternalSessionCapture(
  dir: string,
  filename: string,
  input: SaveCaptureInput,
  port: CaptureWritePort = bindVaultCapturePort(),
): Promise<CaptureResult> {
  return saveVerbatimCapture(dir, filename, input, port);
}

export type { ExternalSessionDetail, ExternalSessionMessage, ExternalSessionSource, ExternalSessionSummary, TextRangeSelection } from './types';
export { CaptureConflictError, StaleSelectionError, verifySelectionFresh } from './captureService';
export type { CaptureMissingItem, CaptureResult, SaveCaptureInput } from './captureService';
export { EVIDENCE_FORMAT } from './captureService';
export type { EvidenceRecord } from './captureService';
export { LOCATOR_FORMAT, parseSourceLocator, renderSourceLocator } from './sourceLocator';
export type { SourceLocator, SourceLocatorRange } from './sourceLocator';
export type { ClaudeDiscovery, ClaudeSessionFs } from './claudeSessions';
export { discoverClaudeSessions, readClaudeSession } from './claudeSessions';
export type { CodexDiscovery, CodexSessionFs } from './codexSessions';
export { sessionIdFromFilename } from './codexSessions';
export type { PiDiscovery, PiSessionFs } from './piSessions';
export { discoverPiSessions, readPiSession, parsePiSession } from './piSessions';
export { sanitizeFilename } from './captureService';
export type { ResolvedSelection } from './captureService';
export { resolveSelectionParts } from './captureService';
export {
  NOTE_INPUT_CHAR_LIMIT,
  INSUFFICIENT_CONTEXT_MARKER,
  NOTE_SYSTEM_PREAMBLE,
  buildNotePrompt,
  generateSessionNote,
  InsufficientContextError,
  NoModelConfiguredError,
  NoteGenerationCancelledError,
  SelectionTooLargeError,
  UnsupportedImageModelError,
} from './noteGeneration';
export type { GenerateNoteOptions, NotePromptMaterial } from './noteGeneration';
export { errorToMessage } from './errorToMessage';
