// The manifest schema, contribution points, contracts, and Disposable have
// moved to `@quill/plugin-sdk` (publishable, no runtime). This package keeps
// only the runtime microkernel (`PluginHost` + shared instance) and re-exports
// the SDK surface so existing `import from '@quill/plugin-host'` keeps working.
export type { Disposable } from '@quill/plugin-sdk';
export { disposable, validateManifest, definePlugin } from '@quill/plugin-sdk';
export { PluginHost, pluginHost } from './src/PluginHost';
export type {
  Plugin,
  PluginContext,
  PluginLoader,
  PluginManifest,
  PluginPermissions,
  PluginRecord,
  PluginState,
  PluginTier,
  ContributionPoints,
  CommandContribution,
  FileTypeContribution,
  ContainerContribution,
  FeatureContribution,
  ToolContribution,
  ExporterContribution,
  FileTemplateContribution,
  KeybindingContribution,
  ExportEnhancerContribution,
  ActivationEvents,
  PluginAiCapability,
  PluginAiChatParams,
  PluginAiAgentParams,
  PluginAiEditFileParams,
  PluginAiCreateFileParams,
  PluginAiStreamEvent,
  PluginAiEventType,
  PluginAiEventHandler,
  ViewMode,
  EditorProps,
  PreviewProps,
  FileTypeHandler,
  ContainerProps,
  ContainerCategory,
  ContainerPlugin,
  PluginModule,
  ExporterContext,
  ExporterHandler,
  ExportEnhancerHandler,
} from '@quill/plugin-sdk';
