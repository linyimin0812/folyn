/**
 * Host-realm entry for the File Collector — trusted tier, poll mode.
 *
 * Exports the collector impl under the manifest's `contributes.collectors[].id`
 * key (`file-activity`); the host's collector adapter + poll runtime resolve
 * `collect` through `module.collectors['file-activity']`.
 */
import type { CollectorContext, CollectorEvent, ExtensionModule } from 'folyn-extension-sdk';
import { diffSnapshots, parseSnapshot, snapshotHasContent } from './fileEvents';

/** authSchema `excludeDirs` value → trimmed, non-empty list. */
function parseExcludeDirs(raw: unknown): string[] {
  return typeof raw === 'string'
    ? raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : [];
}

/**
 * Read file contents into `out` (path → text or null for binary/huge). Read
 * errors on a single file are swallowed — content capture is best-effort, the
 * metadata event still goes out. Chunked (32 concurrent) so a baseline run
 * over a big vault doesn't fire thousands of simultaneous invokes.
 */
async function readContents(
  readVaultFile: (path: string, maxBytes?: number) => Promise<string | null>,
  paths: string[],
  out: Map<string, string | null>,
  onProgress?: (message: string) => void,
): Promise<void> {
  let done = 0;
  let reported = 0;
  for (let i = 0; i < paths.length; i += 32) {
    await Promise.all(
      paths.slice(i, i + 32).map(async (p) => {
        try {
          out.set(p, await readVaultFile(p));
        } catch {
          /* unreadable this run — retried next time the file changes */
        }
        done++;
      }),
    );
    if (onProgress && done - reported >= 500) {
      reported = done;
      onProgress(`content ${done}/${paths.length}`);
    }
  }
}

/** Paths that will produce created/modified events this run (vs `prev`). */
function changedPaths(prev: Record<string, { mtimeMs: number; size: number }>, current: Array<{ path: string; mtimeMs: number; size: number }>): string[] {
  const out: string[] = [];
  for (const f of current) {
    const before = prev[f.path];
    if (!before || before.mtimeMs !== f.mtimeMs || before.size !== f.size) out.push(f.path);
  }
  return out;
}

export async function collectFileActivity(
  ctx: CollectorContext,
): Promise<{ events: CollectorEvent[]; nextCursor: string }> {
  const cursor = ctx.cursor ?? '';
  const excludeDirs = parseExcludeDirs(ctx.config.excludeDirs);
  const current = ctx.scanVault ? await ctx.scanVault({ excludeDirs }) : null;
  if (!current) {
    // Unavailable (no vault / non-Tauri host): no events, cursor untouched.
    return { events: [], nextCursor: cursor };
  }
  const prev = parseSnapshot(cursor);
  // Legacy cursor (metadata-only version, no `content` in any entry): treat
  // like a baseline for content — read the whole vault once so the new
  // snapshot is content-seeded. Events still compute normally against prev.
  const legacy = prev !== null && !snapshotHasContent(prev);
  const contents = new Map<string, string | null>();
  if (ctx.readVaultFile) {
    if (prev === null || legacy) {
      // Baseline: one-time full-vault read so future modifications have an
      // old content to diff against. Binary/huge files return null.
      await readContents(ctx.readVaultFile, current.map((f) => f.path), contents, ctx.onProgress);
    } else {
      const changed = changedPaths(prev, current);
      if (changed.length > 0) {
        await readContents(ctx.readVaultFile, changed, contents, ctx.onProgress);
      }
    }
  }
  const { events, snapshot } = diffSnapshots(prev, current, contents, Date.now());
  if (events.length > 0) {
    const created = events.filter((e) => e.type === 'file_created').length;
    const modified = events.filter((e) => e.type === 'file_modified').length;
    const deleted = events.filter((e) => e.type === 'file_deleted').length;
    ctx.onProgress?.(`files +${created} ~${modified} -${deleted}`);
  }
  return { events, nextCursor: JSON.stringify(snapshot) };
}

const module: ExtensionModule = {
  collectors: {
    'file-activity': {
      id: 'file-activity',
      collect: collectFileActivity,
    },
  },
};

export default module;
