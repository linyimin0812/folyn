/**
 * Host-realm entry for the File Collector — trusted tier, poll mode.
 *
 * Exports the collector impl under the manifest's `contributes.collectors[].id`
 * key (`file-activity`); the host's collector adapter + poll runtime resolve
 * `collect` through `module.collectors['file-activity']`.
 */
import type { CollectorContext, CollectorEvent, ExtensionModule } from 'folyn-extension-sdk';
import { diffSnapshots, parseSnapshot } from './fileEvents';

/** authSchema `excludeDirs` value → trimmed, non-empty list. */
function parseExcludeDirs(raw: unknown): string[] {
  return typeof raw === 'string'
    ? raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : [];
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
  const { events, snapshot } = diffSnapshots(parseSnapshot(cursor), current, Date.now());
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
