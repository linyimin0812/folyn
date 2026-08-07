# Journal - linyimin0812 (Part 3)

> Continuation from `journal-2.md` (archived at ~2000 lines)
> Started: 2026-08-03

---



## Session 115: Fix markdown file-preview rerender on every keystroke

**Date**: 2026-08-03
**Task**: Fix markdown file-preview rerender on every keystroke
**Package**: api
**Branch**: `master`

### Summary

Markdown preview rebuilt componentMap and VaultContext value on every keystroke, causing every :::file-preview block to re-fetch and re-mount. Moved content/onChange into refs read by the pre wrapper, dropped them from componentMap deps, and memoized VaultContext value. Root-cause fix, 27-line diff, no new deps.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `9795ff2` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 116: file-preview html 支持导出

**Date**: 2026-08-03
**Task**: file-preview html 支持导出
**Package**: api
**Branch**: `master`

### Summary

processFilePreviews 兜底分支前加 if (body.querySelector('iframe')) return; html file-preview 的 iframe (srcDoc+sandbox 自包含) 原样保留,不再落到'此文件类型内容不支持导出'卡片。一行修复。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `9735f1f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 117: Desktop pet icon: GIF support

**Date**: 2026-08-03
**Task**: Desktop pet icon: GIF support
**Package**: api
**Branch**: `master`

### Summary

Extended VALID_EXTS in PetSettings.tsx to include 'gif' so users can upload animated GIFs as the desktop pet mascot. Render path (PetMascot <img>) already animates GIFs natively in the Tauri webview — no renderer change needed. 10MB cap and existing fallback logic reused.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `811f946` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 118: Fix file-preview locking preview scroll

**Date**: 2026-08-03
**Task**: Fix file-preview locking preview scroll
**Package**: api
**Branch**: `master`

### Summary

Tightened .prev-body:has(.image-viewer/.html-preview-frame/.pdf-viewer) to direct-child :has(> ...) so embedding image/html/pdf via :::file-preview in markdown no longer applies overflow:hidden to the whole preview pane. Standalone .png/.svg/.html/.pdf full-bleed behavior preserved.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `66f6759` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 119: Dark-mode markdown editor indent markers

**Date**: 2026-08-04
**Task**: Dark-mode markdown editor indent markers
**Package**: api
**Branch**: `master`

### Summary

Fixed jarring vertical indent-guide lines in the markdown editor under dark mode. Root cause: @replit/codemirror-indentation-markers sets --indent-marker-bg-color via its &dark selector, which only activates when the editor has the cm-dark class — this project never adds it, so dark mode fell back to the light default (#F0F1F2, near-white) on a #0b0d14 background. Overrode the var on [data-theme=dark] .cm-indent-markers to match the existing dark border palette (#1c2136 / #252d4a). Inline change per user; no task created.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `103db28` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 120: Fix AI Panel Chat table overflow

**Date**: 2026-08-04
**Task**: Fix AI Panel Chat table overflow
**Package**: api
**Branch**: `master`

### Summary

AI Panel Chat 中 AI 返回含宽表格的消息时会撑破 380px 面板布局。根因：apps/desktop/src/index.css 的 .msg-md table 无宽度约束（对比 .md-preview table 已有 width:100%）。最小 CSS 修复：将 .msg-md table 改为 display:block; width:max-content; max-width:100%; overflow-x:auto，宽表在气泡内横向滚动，窄表保持自然宽度。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `c29d591` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 121: Mute AI Panel user bubble in dark mode

**Date**: 2026-08-04
**Task**: Mute AI Panel user bubble in dark mode
**Package**: api
**Branch**: `master`

### Summary

AI Panel Chat 用户气泡在暗黑模式下背景过亮突兀。根因：.chat-msg-bubble-user 用 var(--acc) 作背景，暗黑下 --acc 为 #5b8af5 饱和度高。最小 CSS 修复：新增 [data-theme="dark"] .chat-msg-bubble-user { background: color-mix(in srgb, var(--acc) 55%, var(--surf)); }，将蓝色与暗背景混合 45% 降低饱和度；明亮模式不变。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `ca707a4` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 122: Fix CSP frame-src for embed.diagrams.net in prod

**Date**: 2026-08-04
**Task**: Fix CSP frame-src for embed.diagrams.net in prod
**Package**: api
**Branch**: `master`

### Summary

Prod build refused to load the drawio iframe because frame-src had a trailing colon after https://embed.diagrams.net:, making the source entry an invalid host:port and causing CSP to reject it. Dev was lax (Tauri dev CSP enforcement is loose on localhost devUrl) so the bug only surfaced in prod. Removed the trailing colon to match the other CSP directives.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `1a2312b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 123: AI panel mode icons swap to custom SVGs

**Date**: 2026-08-04
**Task**: AI panel mode icons swap to custom SVGs
**Package**: api
**Branch**: `master`

### Summary

Swapped Chat/Agent/Ask mode trigger icons in the AI panel input from lucide (MessageSquare/Bot/CircleHelp) to assets/icons/{chat,agent,ask}.svg. Renamed inputModes.ts → .tsx for inline <img> wrapper, reusing the URL-as-src pattern already used by AgentCliTag. tsc + 13 inputModes tests pass.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `409dffa` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 124: Pet menu: connect + clamp + revert to working state

**Date**: 2026-08-05
**Task**: Pet menu: connect + clamp + revert to working state
**Package**: api
**Branch**: `master`

### Summary

Connected pet-menu cards and clamped to work area on all edges, tried moving shadow from cards to wrapper but it broke display, reverted to the d136825 working state for the pet-menu.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `220670a` | (see git log) |
| `1831c43` | (see git log) |
| `cc31584` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 125: mmap fishbone spine and parallel bones

**Date**: 2026-08-06
**Task**: mmap fishbone spine and parallel bones
**Package**: api
**Branch**: `master`

### Summary

Restructured fishbone skeleton: added horizontal spine pseudo-element on me-main, modified slantedBranch to draw short bones from spine-at-child-x instead of fanning from root, added 12px gap between sibling sub-branches. Logical margins throughout. Archived 08-06-mmap (tree skeleton scope already committed in prior session).

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `37ce7a7` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete



## Session 126: mmap: trim skeletons + fix xmind export

**Date**: 2026-08-06
**Task**: mmap: trim skeletons + fix xmind export
**Package**: api
**Branch**: `master`

### Summary

Deleted bracket/fishbone/timeline skeletons, kept mind/org/tree with resolve() fallback for residual meta. Fixed xmind export to honor skeleton (org→org-chart, tree→tree.right) instead of direction-only.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `ac79c00` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 127: Plugin SDK refactor: extract @quill/plugin-sdk + 6 contribution points

**Date**: 2026-08-06
**Task**: Plugin SDK refactor: extract @quill/plugin-sdk + 6 contribution points
**Package**: api
**Branch**: `sharp-mountain`

### Summary

Split publishable @quill/plugin-sdk (types + contracts + dev helpers, no runtime) out of @quill/plugin-host; contract types (FileTypeHandler/ViewMode/ContainerProps/PluginModule) moved into SDK with re-export shims so existing consumers are unchanged. Added 6 new trusted-tier contribution points with host adapters + samples + tests + docs: exporters, fileTemplates, keybindings (app-scope keydown), custom view modes, AI editFile/createFile (vault-manager-mediated), and exportEnhancers (closes async-container export loop). Plus concise standalone SDK reference doc and ed25519 signature/publisherPublicKey fields on PluginManifest.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `42e053d` | (see git log) |
| `000b313` | (see git log) |
| `55c9534` | (see git log) |
| `7425727` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 128: Plugin env capability (theme + locale) + publish plugin-sdk to npm

**Date**: 2026-08-07
**Task**: Plugin env capability (theme + locale) + publish plugin-sdk to npm
**Package**: api
**Branch**: `master`

### Summary

Added PluginEnv to SDK (theme + locale + on*Change returning Disposable); trusted tier wires ctx.env via buildPluginEnv subscribing appearanceStore + localeStore; sandbox tier gets env:get RPC + env-event push messages from RpcBridge. Renamed published npm package from @quill/plugin-sdk to quill-plugin-sdk (unscoped) after @quill scope publish 404'd; package.json now points at dist/ outputs with prepublishOnly=tsc and publishConfig.access=public. 145 plugin-host tests + tsc clean; npm pack dry-run produces quill-plugin-sdk-0.1.0.tgz. Actual npm publish pending user's manual step.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f1a8099` | (see git log) |
| `271c0d7` | (see git log) |
| `a38f5f4` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 129: Code-fence autocomplete plugin langs + gitignore dummy folder

**Date**: 2026-08-07
**Task**: Code-fence autocomplete plugin langs + gitignore dummy folder
**Package**: api
**Branch**: `master`

### Summary

Fixed markdown editor code-fence language picker missing plugin-contributed langs (plantuml + aliases puml/pu). Root cause: CodeBlockExtension.getAllLanguages() only consulted highlight.js + hardcoded mermaid/html extras, missing markdownCodeRenderers and editorLanguages registries. Added listMarkdownCodeRendererLanguages() enumerator and merged both registry sources into the popup list, dropped module-level cache so async-loaded plugins appear on next trigger. Also gitignored repo-root dummy-non-existing-folder (vite-plugin test fallback path) — existing apps/desktop-scoped entry missed the root-level creation.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `36ea354` | (see git log) |
| `8d96391` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 130: AI Panel 输入框加清除上下文/清空消息图标

**Date**: 2026-08-07
**Task**: AI Panel 输入框加清除上下文/清空消息图标
**Package**: api
**Branch**: `master`

### Summary

AI Panel 输入框 trailingSlot 新增 Eraser(清除上下文) + Trash2(清空消息) 两个 ghost 图标按钮。aiStore 新增 clearContext()（清 cliSessionId+fileChanges，保留 messages），清空消息复用 clearMessages()。清空消息点击弹 Tauri confirm 框防误删；清除上下文点击后右下角浮出 chat-toast 小弹窗提示「已清除上下文」。zh/en i18n 全套。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `9085962` | (see git log) |
| `e897d96` | (see git log) |
| `d90859f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 131: Plugins settings: drop AI pair picker, toggle for state

**Date**: 2026-08-07
**Task**: Plugins settings: drop AI pair picker, toggle for state
**Package**: api
**Branch**: `master`

### Summary

Removed per-plugin AI model pair selector from PluginsSettings (store field retained for aiCapability runtime). Replaced Activate/Deactivate button pair with a single Toggle. Archived 3 stale tasks: 08-06-direct-terminal-icon, 08-06-tab-list-dropdown-in-editor, 08-06-plantuml-file-viewer-plugin.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `9614ad8` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 132: Plugin settings: icon/description display + toggle-after-approve gate

**Date**: 2026-08-07
**Task**: Plugin settings: icon/description display + toggle-after-approve gate
**Package**: api
**Branch**: `master`

### Summary

Settings → Plugins rows now render the manifest icon (inline SVG / .svg-path-inlined / emoji / first-letter fallback) and one-line description. PluginManifest SDK type gained optional top-level icon/description fields; pluginStore.fetchRows Promise.all-fetches each installed plugin's manifest to surface them on PluginRow (best-effort; .svg path icons inlined via read_plugin_file). Separately: hide the activate Toggle until a trusted plugin is approved (Approve button replaces Toggle in that state). Also renamed ~/project/quill-plugin-sdk/quill-plugin-plantuml → plantuml-plugin (manifest id + test assertion updated to match folder name for install_plugin cross-check).

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `4294103` | (see git log) |
| `04c0724` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 133: Trim plugin settings empty-state hint

**Date**: 2026-08-07
**Task**: Trim plugin settings empty-state hint
**Package**: api
**Branch**: `master`

### Summary

Removed the examples/plugins/ pointer line and trimmed empty-state text in PluginsSettings and zh/en settings.json.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `e3e0b86` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 134: PlantUML source fallback, tabs export clicks, highlightGrammars contribution point

**Date**: 2026-08-07
**Task**: PlantUML source fallback, tabs export clicks, highlightGrammars contribution point
**Package**: api
**Branch**: `master`

### Summary

Three small fixes plus one course correction. (1) plantuml file-preview now shows source when the plantuml plugin is absent — dropped plantuml/puml from the office handler's extensions list so the code handler picks them up. (2) Exported HTML tabs now switch — injected a one-shot click delegation script into the export template's <head>, keyed off [data-tab-button] inside [data-container=tabs]. (3) PlantUML code blocks in markdown were unhighlighted; first attempt added a core plantuml grammar for highlight.js, but user redirected the work to a plugin contribution point: added contributes.highlightGrammars[] + HighlightGrammarFn to plugin-sdk, wired a host-side highlightGrammarAdapter (mirrors editorLanguageAdapter — foreign-plugin guard, first-registered-wins), reverted the core grammar + plantuml-specific EXT_TO_LANG mapping, generalized CodeFileViewer fallback to hljs.getLanguage(ext) ? ext : EXT_TO_LANG[ext]. The plantuml grammar itself ships in the external plantuml plugin repo (out of scope here).

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `9c90857` | (see git log) |
| `31a395f` | (see git log) |
| `014d16a` | (see git log) |
| `12b7d86` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 135: Plugin zip install + template buildable dir + svg filetype icon

**Date**: 2026-08-07
**Task**: Plugin zip install + template buildable dir + svg filetype icon
**Package**: api
**Branch**: `master`

### Summary

Added install_plugin_zip Tauri command with compiled-only enforcement (blacklist hard-fail + unknown-ext soft-skip + zip-slip/zip-bomb defenses) + Install from .zip UI button. Updated plugin template build.mjs to assemble dist/ as a self-contained installable dir (manifest copied + main rewritten). Wired the svg file type to the dedicated assets/icons/svg.svg icon across both handler and extension maps.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `e7ae374` | (see git log) |
| `144108b` | (see git log) |
| `ff5f61b` | (see git log) |
| `5b4b071` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
