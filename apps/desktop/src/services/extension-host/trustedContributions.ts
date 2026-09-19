/**
 * Trusted-tier contribution adapter manifest.
 *
 * Imports each trusted adapter function and registers it into the
 * {@link ContributionAdapter} registry (from `@folyn/extension-host`). The
 * trusted loader imports this module for the side effect, then folds over
 * `getContributionAdapters()` in `activate()` and `normalizeModule` — neither
 * of which references a specific adapter by name.
 *
 * Adding a contribution point = write the adapter + add one line here.
 * `trustedLoader.activate` and `normalizeModule` stay stable folds.
 *
 * ponytail: a single declarative table is the right granularity — the
 * `ContributionPoints` contract is SDK-level and rarely extended, so the flat
 * manifest is the most boring/readable surface. `moduleKey` drives
 * `normalizeModule` (which module export map to pull); omit for declarative
 * contributions (manifest-only, no module map).
 */
import { registerContributionAdapter } from '@folyn/extension-host';
import {
  registerTrustedExtensionCommands,
  registerExtensionFileTypes,
  registerExtensionContainers,
} from './contributionAdapters';
import { registerExtensionTools } from './toolAdapter';
import { registerExtensionFeatures } from './featureAdapter';
import { registerExtensionPages } from './pageAdapter';
import { registerExtensionExporters } from './exporterAdapter';
import { registerExtensionFileTemplates } from './fileTemplateAdapter';
import { registerExtensionKeybindings } from './keybindingAdapter';
import { registerExtensionExportEnhancers } from './exportEnhancerAdapter';
import { registerExtensionMarkdownCodeRenderers } from './markdownCodeRendererAdapter';
import { registerExtensionEditorLanguages } from './editorLanguageAdapter';
import { registerExtensionHighlightGrammars } from './highlightGrammarAdapter';
import { registerExtensionStorageProviders } from './storageProviderAdapter';

// Registration order = activation order. Adapters are independent (each reads
// its own `contributes.*` array), so order is not load-bearing; it mirrors the
// prior hardcoded list (containers awaited first, then sync adapters) for a
// like-for-like behavior-preserving migration.
registerContributionAdapter({
  moduleKey: 'containers',
  register: (m, mod) => registerExtensionContainers(m, mod),
});
registerContributionAdapter({
  moduleKey: 'commands',
  register: (m, mod) => registerTrustedExtensionCommands(m, mod),
});
registerContributionAdapter({
  moduleKey: 'handlers',
  register: (m, mod) => registerExtensionFileTypes(m, mod),
});
registerContributionAdapter({
  register: (m) => registerExtensionTools(m),
});
registerContributionAdapter({
  moduleKey: 'features',
  register: (m, mod) => registerExtensionFeatures(m, mod),
});
registerContributionAdapter({
  moduleKey: 'pages',
  register: (m, mod) => registerExtensionPages(m, mod),
});
registerContributionAdapter({
  moduleKey: 'exporters',
  register: (m, mod) => registerExtensionExporters(m, mod),
});
registerContributionAdapter({
  register: (m) => registerExtensionFileTemplates(m),
});
registerContributionAdapter({
  register: (m) => registerExtensionKeybindings(m),
});
registerContributionAdapter({
  moduleKey: 'exportEnhancers',
  register: (m, mod) => registerExtensionExportEnhancers(m, mod),
});
registerContributionAdapter({
  moduleKey: 'markdownCodeRenderers',
  register: (m, mod) => registerExtensionMarkdownCodeRenderers(m, mod),
});
registerContributionAdapter({
  moduleKey: 'editorLanguages',
  register: (m, mod) => registerExtensionEditorLanguages(m, mod),
});
// ponytail: no moduleKey — the prior normalizeModule did NOT pull
// `highlightGrammars`, so the adapter received `module.highlightGrammars ===
// undefined` and skipped every grammar with a warning. That was a latent bug
// (the adapter call existed but the module map was never copied through).
// Keeping it absent preserves exact pre-refactor behavior; the bug should be
// fixed in a separate task (add `moduleKey: 'highlightGrammars'` here).
registerContributionAdapter({
  register: (m, mod) => registerExtensionHighlightGrammars(m, mod),
});
registerContributionAdapter({
  moduleKey: 'storageProviders',
  register: (m, mod) => registerExtensionStorageProviders(m, mod),
});
