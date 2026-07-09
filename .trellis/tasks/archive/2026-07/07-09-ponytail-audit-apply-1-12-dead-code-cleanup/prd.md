# Ponytail audit: apply findings 1–12 (dead code + YAGNI)

Apply the high-confidence, low-risk cuts from the repo-wide ponytail-audit.
All cuts are deletion or single-impl abstraction collapse — no behavior change,
no dependency changes. Correctness/security/perf are out of scope (audit is
over-engineering only).

## Scope — the 12 findings

### Rust (Tauri commands)
1. `delete` `select_directory` command — always returns `Err("Use tauri-plugin-dialog...")`, zero frontend callers. Remove fn + `invoke_handler` entry. [apps/desktop/src-tauri/src/commands.rs:47, lib.rs:412]
2. `delete` `fetch_url_content` command — curl.md wrapper, zero frontend callers. Remove fn + entry. [apps/desktop/src-tauri/src/commands.rs:91, lib.rs:414]

### vault-provider package
3. `delete` 3 stub providers (GitHub/S3/WebDAV) — never imported, only console.log + return empty. [packages/vault-provider/src/providers/githubProvider.ts, s3Provider.ts, webdavProvider.ts]
4. `yagni` `BaseVaultProvider` abstract class — after stubs go, only `TauriVaultProvider` remains; have it implement `VaultProvider` directly, inline connect/disconnect/ping. [packages/vault-provider/src/providers/baseProvider.ts, tauriProvider.ts]

### cli-adapter package
5. `yagni` `CliAdapterRegistry` singleton + register/unregister/registerBuiltinAdapters — exactly one adapter (claude) ever registered; `unregister` has zero non-test callers. Replace with `new ClaudeAdapter()` + module-fn `listAdapters()/getAdapter(id)`. [packages/cli-adapter/src/registry.ts]
6. `shrink` `BaseCliAdapter` abstract class — single implementation; fold onEvent/offEvent/emit handler-list into `ClaudeAdapter`. [packages/cli-adapter/src/baseAdapter.ts]

### plugin-host
7. `yagni` Feature-panel registry (`PluginFeaturePanel` interface, `featurePanels` Map, `registerPluginFeatures`/`getPluginFeaturePanels`/`clearPluginFeaturePanels`) — write-only, only tests read it; ActivityBar consumer never landed. Delete block + the call in `trustedLoader.ts:110`. [apps/desktop/src/services/plugin-host/contributionAdapters.ts:205-270]

### aiStore
8. `delete` `aiStore.setStreaming` deprecated wrapper + top-level `isStreaming` field — production callers all use `petChatStore.setStreaming`; only `aiStore.test.ts` touches this. [apps/desktop/src/store/aiStore.ts:64,97,111,337]
9. `delete` `aiStore` re-export `export type {CliMessage, FileChange, ToolCallInfo, MessageAttachment}` — no consumer imports these from aiStore. [apps/desktop/src/store/aiStore.ts:13]

### container-plugins
10. `delete` `ContainerRegistry.getCategories` — zero non-test callers. [packages/container-plugins/src/ContainerRegistry.ts:43]

### file-types
11. `delete` `HandlerRegistry.clear()` — zero callers on the file-types registry. [apps/desktop/src/components/file-types/HandlerRegistry.ts:64]

### pet
12. `delete` `PET_PANEL_WIDTH`/`PET_PANEL_HEIGHT` re-export from `PetPanelApp` — imported at top only to re-export at bottom; tests import from `petPosition.ts` directly. [apps/desktop/src/components/pet/PetPanelApp.tsx:9,374]

## Out of scope
- Findings 13–27 (dedup / stdlib / shrink consolidations) — separate pass.
- Any correctness, security, or performance change.
- New dependencies or dependency removal.

## Verification
- `cargo build` (src-tauri) compiles.
- `pnpm build` / `tsc -b` typechecks (deleting re-exports and types must not break importers — verify with grep before deleting).
- Affected test files updated: registry.test.ts, baseAdapter.test.ts, contributionAdapters.test.ts, trustedLoader.test.ts, aiStore.test.ts, HandlerRegistry.test.ts, ContainerRegistry.test.ts. Tests must still pass.
- No production caller remains for any deleted symbol (grep-verified in audit; re-verify at edit time).

## Notes
- Findings 5–6 (cli-adapter) collapse an abstraction with test coverage — update tests to the new module-fn API rather than preserving the singleton shape.
- Finding 4 depends on finding 3 (base class only collapsible once stubs are gone).

## Extended scope — findings 13–18 (dedup / stdlib consolidations)

13. `yagni` 6 inlined `~`→homeDir expansions (featureAgentService x2 @321,456; wikiIngestService:147; wikiLintService:68; wikiProvider:8; wikiQueryService:87) — `resolveBasePath` in `utils/pathResolver.ts` already does exactly this (async, `~`→homeDir, strip trailing `/`). Replace each 4-line block with `basePath = await resolveBasePath(basePath)`. Verify each site's downstream usage is unchanged.
14. `delete` `generateId()` re-inlined in `wikiLintService:11` — identical to `utils/idGenerator.generateId`. Import instead.
15. `stdlib` `idGenerator.generateId` hand-rolls `Date.now()+Math.random()`. **Conditional**: switch to `crypto.randomUUID()` ONLY if no test asserts the `${Date.now()}-...` format AND no persistence/display parses the id shape. Grep tests + aiSessionPersistence first. If any dependency, SKIP and report — do not break persisted sessions.
16. `shrink` `wikiStore:48` local `generateId` (identical to utils) — import from `@/utils/idGenerator`, delete local.
17. `shrink` 3 near-identical recursers (searchStore.flattenMarkdownFiles / clipStore.flattenMdFiles / analysisStore.flattenHtmlFiles) — all walk VaultEntry tree, filter by ext, push `{path,name}`. Add `flattenFilesByExt(entries, ext): {path, name}[]` to `utils/treeUtils.ts`; callers use it (cast to ClipFile/ReportFile if those are structural supersets — verify the types).
18. `shrink` `fileCommands.flattenMarkdownFiles` + `graphDataBuilder.flattenMdFiles` — already covered by `treeUtils.flattenFileTree` ({path,name}[]) / `flattenTree` (string[]). Replace bodies with `.filter(name/path endsWith ext)` + existing sort.

## Extended scope — findings 19–27 (shrink / dedup, progressively opinionated)

19. `shrink` hand-rolled debounces → shared `debounce(fn, ms)` util (+ `debounceByKey<K>` for editorAutoSave's per-key variant). Sites: storageClient.scheduleFlush, editorPersistence.persistOpenTabs, aiSessionPersistence.debouncedPersist, skillStore (2 timers), petChatStore.schedulePersist, editorAutoSave (keyed).
20. `shrink` `clipBatchHelpers.isValidHttpUrl` == `clipService.validateUrl` logic → one `isHttpUrl(url)` in urlUtils.
21. `shrink` `extractJsonObject` (clipService:85) re-inlined in planMyDayService:247 + wikiIngestService:189 (identical `/\{[\s\S]*\}/` regex). Move to a neutral shared util (aiStreamUtils), export, update all 3.
22. `yagni` `OssUploadConfig` + `CdnUploadConfig` interfaces in imageUploader — no caller. Delete.
23. `shrink` duplicate `subscribeToFileTree` in scheduleStore:536 + studyStore:383 → one shared copy.
24. `shrink` settingsStore `debouncedPersist` double-destructure → `pick(state, PERSIST_KEYS)` with ONE field list (allowlist must stay — state has runtime fields). NOT a blind `storageClient.set(KEY, state)`.
25. `shrink` searchStore.toggleCaseSensitive / toggleUseRegex → inline at call sites.
26. `shrink` `normalizeModule` (trustedLoader:149) — factory shape dead, collapse to one pass.
27. `shrink` `newItemBridge` + `planMyDayBridge` → generic `createBridge<T>()`. BORDERLINE — apply only if clean, else skip.

## Verification (19–27)
- `tsc -b` clean. Full desktop suite: only the 2 pre-existing failures (toExcel, HtmlVisualEditor).
- No behavior change (debounce timing, persisted field set, JSON extraction all preserved).

