# Report customization: prompts / model / save-path + activity secondary rail

User-locked design (grilling consensus, "一次做完" — one task, all parts).

## Requirements

### 1. Activity page secondary left rail
- The activity page gets a secondary left rail (icon column, ~44px, visually a sibling of the global ActivityBar, inside the activity page area — do NOT touch the global ActivityBar in `components/shell/ActivityBar.tsx`).
- Three entries: 活动 (current timeline+graph page) / 采集器 / 报告设置. Switching views replaces the activity page content (like the existing timeline/graph tab switch), state local to the activity page component (useState — no new store).
- Rail styling: icon buttons w/ tooltips, selected state like the existing tab styling conventions (bg-accdim text-acc).

### 2. CollectorsSettings relocation
- Move `CollectorsSettings` (`components/settings/CollectorsSettings.tsx`) into the 采集器 rail view. The component itself stays a single file — only its mount point moves. Layout wrapper adapts (it was embedded in a settings page section; give it the same max-w-[1200px] mx-auto p-8 wrapper as the activity timeline).
- Delete the entry from `components/settings/ExtensionsSettings.tsx` (line ~645 + import at ~37) — the whole settings block, not just the render (its heading too).

### 3. reportConfig persistence (activityCollectorStore)
- `useActivityCollectorStore` gains:
  ```ts
  reportConfig: {
    prompts: { daily: string; weekly: string; monthly: string }; // '' = deterministic template
    modelOverride?: { provider: string; model: string };         // undefined = follow global chat config
    rootDir: string;                                              // '' = '活动记录'
  }
  setReportPrompt(period: 'daily'|'weekly'|'monthly', v: string): void;
  setReportModelOverride(pair: {provider: string; model: string} | null): void;
  setReportRootDir(v: string): void;
  ```
- Add to `PERSIST_KEYS_ACTIVITY_COLLECTORS` and to `hydrate` (defensive type-guarded parse; missing → defaults `prompts: {daily:'',weekly:'',monthly:''}, rootDir: ''`).
- No new store, no new persist file.

### 4. 报告设置 panel (new component `components/activity/ReportSettingsView.tsx`)
- Period tabs (日报/周报/月报) → one textarea per period for the LLM prompt. Placeholder explains: 留空则使用内置模板. Empty = deterministic path (no master toggle).
- Model override: one (provider, model) pair for all reports. Default = follow global chat config (aiConfigStore chatProvider/chatModel). UI: a "跟随全局对话模型" toggle/button + provider/model pickers. Reuse the existing pair-selection pattern — see how pet/voice settings pick a pair (search for `voicePair` usage; do not build a new picker if one can be reused/inlined simply). Clearing the override returns to follow-global.
- Root dir input: single text field, placeholder 活动记录, used as the vault-relative report root.
- Saves to reportConfig via the setters above (immediate on change is fine — the store persists).

### 5. LLM generation wiring (reports.ts + ActivityPage)
- `generateReport` gains the config: read `reportConfig` from the store inside it (like reportHashes today).
- Non-empty prompt for the period → LLM path:
  - Build the data context from the SAME inputs the deterministic composer uses (metrics cards, events list, daily ongoing tasks) — serialize to markdown/JSON text.
  - Compose LLM input: user's prompt + data context (prompt is the instruction; data injected, not templated — no variable substitution).
  - One-shot call via `runRigChat` (`services/rigChat.ts`), `historyMode: 'none'`, `sessionId: 'activity-report'` (stable id, no session persistence needed). Resolve connection via `resolvePairConfig` from `store/aiConfigStore.ts`: pair = `reportConfig.modelOverride ?? { provider: chatProvider, model: chatModel }`. If `resolvePairConfig` returns null (unconfigured provider/key) → throw a typed error with a clear message ( surfaced in UI).
  - LLM output becomes the report body; prepend the same frontmatter block (type/period/date/generated_at) before writing. The rest of the pipeline (reportRelPath w/ custom rootDir, conflict/append rule, write, hash, notify, preview) is UNCHANGED and shared with the deterministic path.
- Empty prompt → existing deterministic `composeReportMarkdown` path.
- Failure: no file written; the error is shown near the generate button in ActivityPage (add a `reportError` state + a dismissible one-line error under the report button row, i18n'd). LLM stream errors (`ChatChunk` type 'error') reject the promise.
- `reportRelPath`/`REPORT_ROOT`: root dir becomes a parameter — `reportRelPath(mode, start, rootDir?: string)` with '' meaning default '活动记录'. Existing callers/tests keep working (default). Path sanitization: strip leading/trailing '/' and empty segments only — no deeper validation.

### 6. i18n
- New keys under `activity:` for: rail tooltips (活动/采集器/报告设置), report settings labels (period tabs reuse existing `report.daily/weekly/monthly`), prompt textarea label + placeholder, model override label/follow-global/clear, root dir label + placeholder, LLM error message, empty-model-config error. All 6 locales (`src/i18n/locales/*/activity.json`).

## Files
- apps/desktop/src/components/activity/ActivityPage.tsx (rail + view switch + reportError UI + LLM options passthrough)
- apps/desktop/src/components/activity/ReportSettingsView.tsx (new)
- apps/desktop/src/components/activity/ActivityRail.tsx (new — or inline in ActivityPage, implementer's choice)
- apps/desktop/src/store/activityCollectorStore.ts (reportConfig)
- apps/desktop/src/services/activity/reports.ts (LLM path + rootDir param)
- apps/desktop/src/components/settings/CollectorsSettings.tsx (only if import path/layout adjustments needed)
- apps/desktop/src/components/settings/ExtensionsSettings.tsx (remove entry)
- apps/desktop/src/i18n/locales/*/activity.json (×6)

## Non-goals (explicitly rejected in grilling)
- Prompt variable/template mode ({{metrics}} etc.) — data injected, prompt is pure instruction.
- Per-period models, free path templates, master LLM toggle, dual entries (rail AND settings).
- New stores or persist files.

## Tests
- Unit: reportRelPath rootDir param (default/custom/trim); LLM markdown assembly (frontmatter prepended to LLM output); prompt-empty → deterministic path chosen (pure decision fn if extracted); store hydrate round-trip for reportConfig.
- Follow existing test file conventions (`reports` has no test file yet — check `services/activity/` for one; co-locate as `reports.test.ts` if the harness picks up there, else next to existing activity tests).
