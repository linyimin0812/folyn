/**
 * File-template contribution adapter + registry (trusted-tier new-file
 * templates).
 *
 * A `contributes.fileTemplates[]` entry is fully declarative (no module map):
 * `{ id, label, fileName, template, icon? }`. This adapter registers each
 * template into a module-level {@link fileTemplateRegistry} (keyed by
 * `<pluginId>.<templateId>`) AND surfaces a palette command
 * `plugin.<pluginId>.new.<templateId>` titled `New <label>` that prompts for
 * a save path (default under the vault root) and writes the template content.
 *
 * ponytail: the right-click "新建" submenu (ContextMenu.tsx) is NOT wired
 * here — its inline-rename flow keys file content off the extension via
 * prefsStore.fileTemplates, which can't carry an arbitrary body. Surfacing
 * templates as palette commands is the MVP consumption path. The registry is
 * the single source of truth so a future submenu group can read
 * `getPluginFileTemplates()` without re-plumbing the adapter. Ceiling:
 * templates don't appear in the right-click submenu. Upgrade path: thread a
 * `onStartNewFromTemplate(parentDir, template)` callback through
 * SidebarActions → FilesPanel → ContextMenu and render a plugin-templates
 * group in `NEW_FILE_GROUPS`.
 */

import type { Disposable, PluginManifest } from '@mochi/plugin-host';
import type { FileTemplateContribution } from '@mochi/plugin-host';
import { registerCommand } from '@/services/commandRegistry';
import { useVaultStore } from '@/store/vaultStore';

export interface RegisteredFileTemplate {
  /** Globally-unique id: `<pluginId>.<templateId>`. */
  id: string;
  pluginId: string;
  label: string;
  fileName: string;
  template: string;
  icon?: string;
}

const templates = new Map<string, RegisteredFileTemplate>();

/** Register a plugin file template. Returns a remove handle. */
export function registerFileTemplate(
  pluginId: string,
  contribution: FileTemplateContribution,
): { dispose: () => void } {
  const id = `${pluginId}.${contribution.id}`;
  const entry: RegisteredFileTemplate = {
    id,
    pluginId,
    label: contribution.label,
    fileName: contribution.fileName,
    template: contribution.template,
    icon: contribution.icon,
  };
  templates.set(id, entry);
  return { dispose: () => templates.delete(id) };
}

/** Look up a registered template by `<pluginId>.<templateId>`. */
export function getFileTemplate(id: string): RegisteredFileTemplate | undefined {
  return templates.get(id);
}

/** All registered plugin file templates (insertion order). */
export function getPluginFileTemplates(): RegisteredFileTemplate[] {
  return Array.from(templates.values());
}

/** Test helper: clear the registry. */
export function clearFileTemplates(): void {
  templates.clear();
}

export function registerPluginFileTemplates(manifest: PluginManifest): Disposable {
  const contributions: FileTemplateContribution[] = manifest.contributes?.fileTemplates ?? [];
  if (contributions.length === 0) return { dispose: () => {} };

  const disposables: Array<{ dispose: () => void }> = [];
  for (const contribution of contributions) {
    const templateId = `${manifest.id}.${contribution.id}`;
    disposables.push(registerFileTemplate(manifest.id, contribution));
    const fullId = `plugin.${manifest.id}.new.${contribution.id}`;
    const d = registerCommand({
      id: fullId,
      title: `New ${contribution.label}`,
      category: 'action',
      icon: contribution.icon,
      keywords: ['plugin', 'new', 'template', manifest.id, contribution.id],
      run: async () => {
        const entry = getFileTemplate(templateId);
        const tpl = entry ?? {
          fileName: contribution.fileName,
          template: contribution.template,
        };
        const vaultRoot = useVaultStore.getState().currentVault?.basePath ?? '';
        const { isTauri } = await import('@/utils/platform');
        if (!isTauri()) return;
        const { save } = await import('@tauri-apps/plugin-dialog');
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        const defaultPath = vaultRoot
          ? `${vaultRoot}/${tpl.fileName}`
          : tpl.fileName;
        const target = await save({
          defaultPath,
          filters: [
            {
              name: tpl.fileName.split('.').pop()?.toUpperCase() ?? 'File',
              extensions: [tpl.fileName.split('.').pop() ?? 'txt'],
            },
          ],
        });
        if (!target) return;
        await writeTextFile(target, tpl.template);
        await useVaultStore.getState().refreshFileTree();
      },
    });
    disposables.push(d);
  }

  return {
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
