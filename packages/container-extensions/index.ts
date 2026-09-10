export type {
  ContainerExtension,
  ContainerProps,
  ContainerCategory,
} from './src/ContainerExtension';
export { ContainerRegistry } from './src/ContainerRegistry';
export { VaultContext, useVaultContext } from './src/VaultContext';
export type { VaultContextValue } from './src/VaultContext';

// Built-in extensions
export { calloutExtension } from './src/extensions/CalloutExtension';
export { tabsExtension, tabExtension } from './src/extensions/TabsExtension';
export { mermaidExtension, MermaidBlock, useMermaidSvg } from './src/extensions/MermaidExtension';
export { PlantUmlBlock, usePlantUmlSvg } from './src/extensions/PlantUmlExtension';
export { encodePlantUml } from './src/plantuml/encode';
export { GraphvizBlock, useGraphvizSvg } from './src/extensions/GraphvizExtension';
export { aiResultExtension } from './src/extensions/AiResultExtension';
export { statusTagExtension } from './src/extensions/StatusTagExtension';
export { timelineExtension } from './src/extensions/TimelineExtension';
export { filePreviewExtension } from './src/extensions/FilePreviewExtension';
export { stepsExtension, stepExtension } from './src/extensions/StepsExtension';
export { collapsibleExtension } from './src/extensions/CollapsibleExtension';
export { cardExtension } from './src/extensions/CardExtension';
export { gridExtension } from './src/extensions/GridExtension';
export { buttonExtension } from './src/extensions/ButtonExtension';

// Built-in editor language factories (CodeMirror StreamLanguage, hosted by
// the app — see apps/desktop registerBuiltinCodeContributions).
export { mermaid as mermaidLanguageFactory } from './src/editor-languages/mermaid';
export { plantuml as plantumlLanguageFactory } from './src/editor-languages/plantuml';
export { dot as dotLanguageFactory } from './src/editor-languages/dot';

import { ContainerRegistry } from './src/ContainerRegistry';
import { calloutExtension } from './src/extensions/CalloutExtension';
import { tabsExtension, tabExtension } from './src/extensions/TabsExtension';
import { mermaidExtension } from './src/extensions/MermaidExtension';
import { aiResultExtension } from './src/extensions/AiResultExtension';
import { statusTagExtension } from './src/extensions/StatusTagExtension';
import { timelineExtension } from './src/extensions/TimelineExtension';
import { filePreviewExtension } from './src/extensions/FilePreviewExtension';
import { stepsExtension, stepExtension } from './src/extensions/StepsExtension';
import { collapsibleExtension } from './src/extensions/CollapsibleExtension';
import { cardExtension } from './src/extensions/CardExtension';
import { gridExtension } from './src/extensions/GridExtension';
import { buttonExtension } from './src/extensions/ButtonExtension';

/** Register all built-in container extensions */
export function registerBuiltinExtensions(): void {
  const registry = ContainerRegistry.getInstance();
  registry.register(calloutExtension);
  registry.register(tabsExtension);
  registry.register(tabExtension);
  registry.register(mermaidExtension);
  registry.register(aiResultExtension);
  registry.register(statusTagExtension);
  registry.register(timelineExtension);
  registry.register(filePreviewExtension);
  registry.register(stepsExtension);
  registry.register(stepExtension);
  registry.register(collapsibleExtension);
  registry.register(cardExtension);
  registry.register(gridExtension);
  registry.register(buttonExtension);
}
