export type {
  ContainerPlugin,
  ContainerProps,
  ContainerCategory,
} from './src/ContainerPlugin';
export { ContainerRegistry } from './src/ContainerRegistry';
export { VaultContext, useVaultContext } from './src/VaultContext';
export type { VaultContextValue } from './src/VaultContext';

// Built-in plugins
export { calloutPlugin } from './src/plugins/CalloutPlugin';
export { tabsPlugin, tabPlugin } from './src/plugins/TabsPlugin';
export { mermaidPlugin, MermaidBlock } from './src/plugins/MermaidPlugin';
export { aiResultPlugin } from './src/plugins/AiResultPlugin';
export { statusTagPlugin } from './src/plugins/StatusTagPlugin';
export { timelinePlugin } from './src/plugins/TimelinePlugin';
export { filePreviewPlugin } from './src/plugins/FilePreviewPlugin';
export { stepsPlugin, stepPlugin } from './src/plugins/StepsPlugin';
export { collapsiblePlugin } from './src/plugins/CollapsiblePlugin';
export { cardPlugin } from './src/plugins/CardPlugin';
export { gridPlugin } from './src/plugins/GridPlugin';
export { buttonPlugin } from './src/plugins/ButtonPlugin';

import { ContainerRegistry } from './src/ContainerRegistry';
import { calloutPlugin } from './src/plugins/CalloutPlugin';
import { tabsPlugin, tabPlugin } from './src/plugins/TabsPlugin';
import { mermaidPlugin } from './src/plugins/MermaidPlugin';
import { aiResultPlugin } from './src/plugins/AiResultPlugin';
import { statusTagPlugin } from './src/plugins/StatusTagPlugin';
import { timelinePlugin } from './src/plugins/TimelinePlugin';
import { filePreviewPlugin } from './src/plugins/FilePreviewPlugin';
import { stepsPlugin, stepPlugin } from './src/plugins/StepsPlugin';
import { collapsiblePlugin } from './src/plugins/CollapsiblePlugin';
import { cardPlugin } from './src/plugins/CardPlugin';
import { gridPlugin } from './src/plugins/GridPlugin';
import { buttonPlugin } from './src/plugins/ButtonPlugin';

/** Register all built-in container plugins */
export function registerBuiltinPlugins(): void {
  const registry = ContainerRegistry.getInstance();
  registry.register(calloutPlugin);
  registry.register(tabsPlugin);
  registry.register(tabPlugin);
  registry.register(mermaidPlugin);
  registry.register(aiResultPlugin);
  registry.register(statusTagPlugin);
  registry.register(timelinePlugin);
  registry.register(filePreviewPlugin);
  registry.register(stepsPlugin);
  registry.register(stepPlugin);
  registry.register(collapsiblePlugin);
  registry.register(cardPlugin);
  registry.register(gridPlugin);
  registry.register(buttonPlugin);
}
