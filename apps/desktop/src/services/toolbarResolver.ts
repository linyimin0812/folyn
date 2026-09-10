/**
 * ToolbarResolver impl — computes {@link ToolbarState} from a
 * {@link ToolbarContext}, memoized per file-type id (doc §16.5).
 *
 * Core owns the toolbar; the resolution here replaces the ad-hoc
 * `if (fileType === '...')` branches that used to live inline in Topbar.
 * Modes come from the active provider's `modes` (FileTypeProvider) — no
 * hardcode. Invalidation: file-switch / mode-switch / extension reload.
 */

import type {
  PresentationModeId,
  ResolvedFileType,
  ToolbarContext,
  ToolbarResolver,
  ToolbarState,
} from 'folyn-plugin-sdk';

class ToolbarResolverImpl implements ToolbarResolver {
  private cache = new Map<string, ToolbarState>();

  resolve(ctx: ToolbarContext): ToolbarState {
    const key = ctx.fileType?.id ?? 'no-file';
    const cached = this.cache.get(key);
    if (cached) return cached;

    const state = this.compute(ctx);
    this.cache.set(key, state);
    return state;
  }

  invalidate(fileTypeId: string): void {
    this.cache.delete(fileTypeId);
    this.cache.delete('no-file');
  }

  private compute(ctx: ToolbarContext): ToolbarState {
    const inEditor = ctx.currentPage === 'editor';
    // Mode segment: only when the provider offers >1 mode.
    const modes: PresentationModeId[] = ctx.fileType?.modes ?? [];
    return {
      showTerminal: inEditor,
      showAi: inEditor,
      // Export/language surface whenever a file is active in the editor surface.
      showExport: inEditor && !!ctx.activeFile,
      showLanguage: inEditor && !!ctx.activeFile,
      modes,
    };
  }
}

export const toolbarResolver: ToolbarResolver = new ToolbarResolverImpl();

/**
 * Build a {@link ResolvedFileType} from a provider id, reading its modes.
 * Kept here so Topbar / future toolbar consumers share one derivation.
 */
export function resolvedFileType(
  providerId: string | undefined,
  modes: PresentationModeId[],
): ResolvedFileType | null {
  if (!providerId) return null;
  return { id: providerId, modes };
}
