// The manifest schema, contribution points, contracts, and Disposable have
// moved to `folyn-extension-sdk` (publishable, no runtime). This package keeps
// only the runtime — `ExtensionHost` + `ExtensionRuntime` + the legacy
// `Extension`→`Extension` adapter — and re-exports the SDK surface so existing
// `import from '@folyn/extension-host'` keeps working.
export type { Disposable } from 'folyn-extension-sdk';
export { disposable, validateManifest, defineExtension } from 'folyn-extension-sdk';
export { DisposableStore, combineSignals, OwnedRegistry, FOLYN_CORE_OWNER } from 'folyn-extension-sdk';
export type { Registry } from 'folyn-extension-sdk';
export type { Extension, ExtensionApi, ExtensionContext, ExtensionUIContext, ExtensionLoader, ToolExtensionUIContext, FileTypeExtensionUIContext, VaultContext, VaultApi, FileApi, EditorApi, WorkspaceContextApi, CommandRegistryApi, EventApi, ExtensionStorageApi, AiApi, TerminalApi, ExportService, FileTypeRegistryApi, ExporterRegistryApi, ExtensionLogger, DialogApi, NotificationApi, WorkspaceApi, WorkspaceContribution, PresentationApi } from 'folyn-extension-sdk';
export { ExtensionHost, extensionHost } from './src/ExtensionHost';
export type { ExtensionState, ExtensionRecord, ExtensionHostHooks, ExtensionApiHandle } from './src/ExtensionHost';
export { ExtensionRuntime, consoleLogger } from './src/ExtensionRuntime';
export type {
  ExtensionManifest,
  ExtensionPermissions,
  ExtensionTier,
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
  ExtensionAiCapability,
  ExtensionAiChatParams,
  ExtensionAiAgentParams,
  ExtensionAiEditFileParams,
  ExtensionAiCreateFileParams,
  ExtensionAiStreamEvent,
  ExtensionAiEventType,
  ExtensionAiEventHandler,
  ExtensionEnv,
  ExtensionTheme,
  ExtensionLocale,
  ExtensionHttpCapability,
  ExtensionHttpInit,
  ExtensionHttpResponse,
  ViewMode,
  EditorProps,
  PreviewProps,
  FileTypeHandler,
  ContainerProps,
  ContainerCategory,
  ContainerExtension,
  ExtensionModule,
  ExporterContext,
  ExporterHandler,
  ExportEnhancerHandler,
  MarkdownCodeRendererProps,
  EditorLanguageFactory,
  HighlightGrammarFn,
} from 'folyn-extension-sdk';
