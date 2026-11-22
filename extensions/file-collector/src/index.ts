/**
 * Host-realm entry for the File Collector — trusted tier, poll mode.
 *
 * Exports the collector impl under the manifest's `contributes.collectors[].id`
 * key (`file-activity`); the host's collector adapter + poll runtime resolve
 * `collect` through `module.collectors['file-activity']`, and the collector's
 * settings card mounts `configForm`.
 */
import type { CollectorContext, CollectorEvent, ExtensionApi, ExtensionModule } from 'folyn-extension-sdk';
import { diffSnapshots, parseSnapshot, snapshotHasContent, type VaultFile } from './fileEvents';
import { parsePatterns } from './excludePatterns';
import { FileConfigForm } from './FileConfigForm';

/** Bytes of each file kept for diffing — content capture is a sample, not a
 *  copy of the vault. */
const CONTENT_BYTES = 8192;
/** Files larger than this get no content at all. */
const MAX_CONTENT_FILE = 1_048_576;

/**
 * Read file contents into `out` (path → text, or null for binary/huge). Read
 * errors on a single file are swallowed — content capture is best-effort, the
 * metadata event still goes out. Chunked (32 concurrent) so a baseline run
 * over a big vault doesn't fire thousands of simultaneous reads.
 */
async function readContents(
  vault: ExtensionApi['vault'],
  files: VaultFile[],
  out: Map<string, string | null>,
  onProgress?: (message: string) => void,
): Promise<void> {
  let done = 0;
  let reported = 0;
  for (let i = 0; i < files.length; i += 32) {
    await Promise.all(
      files.slice(i, i + 32).map(async (f) => {
        try {
          out.set(f.path, f.size > MAX_CONTENT_FILE ? null : await vault.readText(f.path, { maxBytes: CONTENT_BYTES }));
        } catch {
          /* unreadable this run — retried next time the file changes */
        }
        done++;
      }),
    );
    if (onProgress && done - reported >= 500) {
      reported = done;
      onProgress(`content ${done}/${files.length}`);
    }
  }
}

/** Files that will produce created/modified events this run (vs `prev`). */
function changedFiles(prev: Record<string, { mtimeMs: number; size: number }>, current: VaultFile[]): VaultFile[] {
  return current.filter((f) => {
    const before = prev[f.path];
    return !before || before.mtimeMs !== f.mtimeMs || before.size !== f.size;
  });
}

export async function collectFileActivity(
  ctx: CollectorContext,
): Promise<{ events: CollectorEvent[]; nextCursor: string }> {
  const cursor = ctx.cursor ?? '';
  const vault = ctx.api.vault;
  if (!vault.current()) {
    // No vault open: no events, cursor untouched.
    return { events: [], nextCursor: cursor };
  }
  // The collector's own filters (not the file panel's), dotfiles included —
  // activity in a hidden folder is still activity.
  const current: VaultFile[] = (
    await vault.listFiles({ exclude: parsePatterns(ctx.config.excludePatterns), includeHidden: true })
  )
    .map(({ path, mtimeMs, size }) => ({ path, mtimeMs, size }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const prev = parseSnapshot(cursor);
  // Legacy cursor (metadata-only version, no `content` in any entry): treat
  // like a baseline for content — read the whole vault once so the new
  // snapshot is content-seeded. Events still compute normally against prev.
  const legacy = prev !== null && !snapshotHasContent(prev);
  const contents = new Map<string, string | null>();
  if (prev === null || legacy) {
    // Baseline: one-time full-vault read so future modifications have an old
    // content to diff against. Binary/huge files get null.
    await readContents(vault, current, contents, ctx.onProgress);
  } else {
    const changed = changedFiles(prev, current);
    if (changed.length > 0) await readContents(vault, changed, contents, ctx.onProgress);
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
      configForm: FileConfigForm,
    },
  },
};

export default module;
