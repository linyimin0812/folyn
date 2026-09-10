// The manifest schema, contribution points, contracts, and Disposable have
// moved to `folyn-plugin-sdk` (publishable, no runtime). This package keeps
// only the runtime — `ExtensionHost` + `ExtensionRuntime` + the legacy
// `Plugin`→`Extension` adapter — and re-exports the SDK surface so existing
// `import from '@folyn/plugin-host'` keeps working.
export type { Disposable } from 'folyn-plugin-sdk';
export { disposable, validateManifest, definePlugin } from 'folyn-plugin-sdk';
export { DisposableStore, combineSignals, OwnedRegistry, FOLYN_CORE_OWNER } from 'folyn-plugin-sdk';
export type { Registry } from 'folyn-plugin-sdk';
export type { Extension, ExtensionApi, ExtensionContext, ExtensionManifest, ExtensionUIContext, ExtensionLoader, ToolExtensionUIContext, FileTypeExtensionUIContext, VaultContext, VaultApi, FileApi, EditorApi, WorkspaceContextApi, CommandRegistryApi, EventApi, ExtensionStorageApi, AiApi, TerminalApi, ExportService, FileTypeRegistryApi, ExporterRegistryApi, ExtensionLogger, DialogApi, NotificationApi, WorkspaceApi, WorkspaceContribution, PresentationApi } from 'folyn-plugin-sdk';
export { ExtensionHost, extensionHost } from './src/ExtensionHost';
export type { ExtensionState, ExtensionRecord, ExtensionHostHooks, ExtensionApiHandle } from './src/ExtensionHost';
export { ExtensionRuntime, consoleLogger } from './src/ExtensionRuntime';
export type {
  PluginManifest,
  PluginPermissions,
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
  MarkdownCodeRendererContribution,
  EditorLanguageContribution,
  HighlightGrammarContribution,
  ActivationEvents,
  PluginAiCapability,
  PluginAiChatParams,
  PluginAiAgentParams,
  PluginAiEditFileParams,
  PluginAiCreateFileParams,
  PluginAiStreamEvent,
  PluginAiEventType,
  PluginAiEventHandler,
  PluginEnv,
  PluginTheme,
  PluginLocale,
  PluginHttpCapability,
  PluginHttpInit,
  PluginHttpResponse,
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
  MarkdownCodeRendererProps,
  EditorLanguageFactory,
  HighlightGrammarFn,
} from 'folyn-plugin-sdk';
