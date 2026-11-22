/**
 * File-template contribution adapter + registry (trusted-tier new-file
 * templates).
 *
 * A `contributes.fileTemplates[]` entry is fully declarative (no module map):
 * `{ id, label, fileName, template, icon? }`. This adapter registers each
 * template into a module-level {@link fileTemplateRegistry} (keyed by
 * `<extensionId>.<templateId>`) AND surfaces a palette command
 * `extension.<extensionId>.new.<templateId>` titled `New <label>` that prompts for
 * a save path (default under the vault root) and writes the template content.
 *
 * The file tree's 新建 flow also reads this registry: a new file whose
 * extension matches a template's `fileName` starts with that template, unless
 * the user set their own template for the extension (Settings → 文件模板).
 */

import type { Disposable, ExtensionManifest } from '@folyn/extension-host';
import type { FileTemplateContribution } from '@folyn/extension-host';
import { registerCommand } from '@/services/commandRegistry';
import { useVaultStore } from '@/store/vaultStore';

export interface RegisteredFileTemplate {
  /** Globally-unique id: `<extensionId>.<templateId>`. */
  id: string;
  extensionId: string;
  label: string;
  fileName: string;
  template: string;
  icon?: string;
}

const templates = new Map<string, RegisteredFileTemplate>();

/** Register a extension file template. Returns a remove handle. */
export function registerFileTemplate(
  extensionId: string,
  contribution: FileTemplateContribution,
): { dispose: () => void } {
  const id = `${extensionId}.${contribution.id}`;
  const entry: RegisteredFileTemplate = {
    id,
    extensionId,
    label: contribution.label,
    fileName: contribution.fileName,
    template: contribution.template,
    icon: contribution.icon,
  };
  templates.set(id, entry);
  return { dispose: () => templates.delete(id) };
}

/** Look up a registered template by `<extensionId>.<templateId>`. */
export function getFileTemplate(id: string): RegisteredFileTemplate | undefined {
  return templates.get(id);
}

/** The template an extension contributes for new files ending in `.ext`
 *  (first registered wins), or undefined. */
export function getFileTemplateForExtension(ext: string): RegisteredFileTemplate | undefined {
  const wanted = ext.toLowerCase();
  for (const t of templates.values()) {
    if (t.fileName.split('.').pop()?.toLowerCase() === wanted) return t;
  }
  return undefined;
}

/** All registered extension file templates (insertion order). */
export function getExtensionFileTemplates(): RegisteredFileTemplate[] {
  return Array.from(templates.values());
}

/** Test helper: clear the registry. */
export function clearFileTemplates(): void {
  templates.clear();
}

export function registerExtensionFileTemplates(manifest: ExtensionManifest): Disposable {
  const contributions: FileTemplateContribution[] = manifest.contributes?.fileTemplates ?? [];
  if (contributions.length === 0) return { dispose: () => {} };

  const disposables: Array<{ dispose: () => void }> = [];
  for (const contribution of contributions) {
    const templateId = `${manifest.id}.${contribution.id}`;
    disposables.push(registerFileTemplate(manifest.id, contribution));
    const fullId = `extension.${manifest.id}.new.${contribution.id}`;
    const d = registerCommand({
      id: fullId,
      title: `New ${contribution.label}`,
      category: 'action',
      icon: contribution.icon,
      keywords: ['extension', 'new', 'template', manifest.id, contribution.id],
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
    }, manifest.id);
    disposables.push(d);
  }

  return {
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
