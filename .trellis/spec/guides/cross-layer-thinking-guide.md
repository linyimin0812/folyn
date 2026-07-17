# Cross-Layer Thinking Guide

> **Purpose**: Think through data flow across layers before implementing.

---

## The Problem

**Most bugs happen at layer boundaries**, not within layers.

Common cross-layer bugs:
- API returns format A, frontend expects format B
- Database stores X, service transforms to Y, but loses data
- Multiple layers implement the same logic differently

---

## Before Implementing Cross-Layer Features

### Step 1: Map the Data Flow

Draw out how data moves:

```
Source → Transform → Store → Retrieve → Transform → Display
```

For each arrow, ask:
- What format is the data in?
- What could go wrong?
- Who is responsible for validation?

### Step 2: Identify Boundaries

| Boundary | Common Issues |
|----------|---------------|
| API ↔ Service | Type mismatches, missing fields |
| Service ↔ Database | Format conversions, null handling |
| Backend ↔ Frontend | Serialization, date formats |
| Component ↔ Component | Props shape changes |

### Step 3: Define Contracts

For each boundary:
- What is the exact input format?
- What is the exact output format?
- What errors can occur?

---

## Common Cross-Layer Mistakes

### Mistake 1: Implicit Format Assumptions

**Bad**: Assuming date format without checking

**Good**: Explicit format conversion at boundaries

### Mistake 2: Scattered Validation

**Bad**: Validating the same thing in multiple layers

**Good**: Validate once at the entry point

### Mistake 3: Raw `~/...` Paths Crossing the FFI Boundary

**Symptom**: A file the user expects at `~/.voice_input/foo.wav` (or `~/quill/default_vault/.voice_input/foo.wav`) is silently written to `<process-CWD>/~/...` — a literal directory named `~` in whichever directory the app was launched from. The user can't find the file; `save_source_wav` returns Ok because the write succeeded.

**Cause**: Frontend state often holds user-configured paths with a leading `~` (e.g. `useVaultStore.getState().currentVault?.basePath === '~/quill/default_vault'`). Rust's `Path::new("~/quill/default_vault").join(".voice_input")` does NOT expand `~` — it's a literal segment. Shell tilde expansion is a shell feature; neither `std::path::Path` nor `tauri::path` expand it automatically at the Rust call site.

**Fix**: The canonical expansion helper is `apps/desktop/src/utils/pathResolver.ts::resolveBasePath()` — it awaits `homeDir()` from `@tauri-apps/api/path` and replaces a leading `~` with the real home directory. The `vaultStore` already uses it internally before `startVaultWatcher`; any NEW call site that passes `basePath` to a Rust command must use it too.

**Prevention**: Before any `invoke('some_command', { vaultPath: ..., basePath: ... })`, grep the frontend for the path's source. If it comes from `useVaultStore.currentVault?.basePath` or any user-editable config field, wrap it in `await resolveBasePath(...)` first. This is a cross-layer contract: the frontend OWNS tilde expansion; Rust OWNS filesystem write — neither side can do the other's job.

#### Wrong
```ts
const vaultPath = useVaultStore.getState().currentVault?.basePath ?? '';
// vaultPath === '~/quill/default_vault'
await invoke('voice_stop', { saveSource, sourceDir, vaultPath });
// Rust: Path::new("~/quill/default_vault").join(".voice_input")
// → file written to <CWD>/~/quill/default_vault/.voice_input/<ts>.wav
```

#### Correct
```ts
import { resolveBasePath } from '@/utils/pathResolver';
const rawVaultPath = useVaultStore.getState().currentVault?.basePath ?? '';
const vaultPath = await resolveBasePath(rawVaultPath);
// vaultPath === '/Users/yiminlin/quill/default_vault'
await invoke('voice_stop', { saveSource, sourceDir, vaultPath });
// Rust: Path::new("/Users/yiminlin/quill/default_vault").join(".voice_input")
// → file written to /Users/yiminlin/quill/default_vault/.voice_input/<ts>.wav
```

**Real-world example**: `apps/desktop/src/hooks/useVoiceInput.ts::stop()` originally passed `currentVault.basePath` straight to `voice_stop`. The source WAV silently landed in `<CWD>/~/quill/default_vault/.voice_input/`. Round-2 fix wrapped the path in `resolveBasePath`.

### Mistake 3: Leaky Abstractions

**Bad**: Component knows about database schema

**Good**: Each layer only knows its neighbors

---

## Checklist for Cross-Layer Features

Before implementation:
- [ ] Mapped the complete data flow
- [ ] Identified all layer boundaries
- [ ] Defined format at each boundary
- [ ] Decided where validation happens

After implementation:
- [ ] Tested with edge cases (null, empty, invalid)
- [ ] Verified error handling at each boundary
- [ ] Checked data survives round-trip

---

## Cross-Platform Template Consistency

In Trellis, command templates (e.g., `record-session.md`) exist in **multiple platforms** with identical or near-identical content. This is a cross-layer boundary.

### Checklist: After Modifying Any Command Template

- [ ] Find all platforms with the same command: `find src/templates/*/commands/trellis/ -name "<command>.*"`
- [ ] Update all platform copies (Markdown `.md` and TOML `.toml`)
- [ ] For Gemini TOML: adapt line continuations (`\\` vs `\`) and triple-quoted strings
- [ ] Run `/trellis:check-cross-layer` to verify nothing was missed

**Real-world example**: Updated `record-session.md` in Claude to use `--mode record`, but forgot iFlow, Kilo, OpenCode, and Gemini — caught by cross-layer check.

---

## Generated Runtime Template Upgrade Consistency

Some generated files are both documentation and runtime input. In Trellis,
`.trellis/workflow.md` is parsed by `get_context.py`, `workflow_phase.py`,
SessionStart filters, and per-turn hooks. Template changes must be validated
against both fresh init and upgrade paths.

### Checklist: After Modifying A Runtime-Parsed Template

- [ ] Identify every runtime parser that reads the template, not just the file
  writer that installs it
- [ ] Check whether relevant syntax lives outside obvious managed regions
  such as tag blocks
- [ ] Verify fresh `init` output and a versioned `update` scenario that writes
  the older `.trellis/.version`
- [ ] Add an upgrade regression using an older pristine template fixture, then
  assert the installed file reaches the current packaged shape
- [ ] Update the backend spec that owns the runtime contract

**Real-world example**: Codex inline mode changed workflow platform markers from
`[Codex]` / `[Kilo, Antigravity, Windsurf]` to `[codex-sub-agent]` /
`[codex-inline, Kilo, Antigravity, Windsurf]`. Fresh init was correct, but
`trellis update` only merged `[workflow-state:*]` blocks and preserved stale
markers outside those blocks. Result: upgraded projects got new hook scripts
but old workflow routing, so `get_context.py --mode phase --platform codex`
could return empty Phase 2.1 detail.

---

## Mode-Detection Probe Checklist

When a CLI auto-detects a mode by probing a remote resource (e.g., checking if `index.json` exists to decide marketplace vs direct download):

### Before implementing:
- [ ] Probe runs in **ALL** code paths that use the result (interactive, `-y`, `--flag` combos)
- [ ] 404 vs transient error are distinguished — don't treat both as "not found"
- [ ] Transient errors **abort or retry**, never silently switch modes
- [ ] Shared state (caches, prefetched data) is **reset** when context changes (e.g., user switches source)
- [ ] **Shortcut paths** (e.g., `--template` skipping picker) must have the same error-handling quality as the probed path — check that downstream functions don't call catch-all wrappers

### After implementing:
- [ ] Trace every path from probe result to the mode-decision branch — no fallthrough
- [ ] External format contracts (giget URI, raw URLs) are tested or at least documented as comments
- [ ] Metadata reads consume a complete response or use a streaming parser — never parse a fixed-size prefix as full JSON
- [ ] When reconstructing a composite identifier from parsed parts, verify **all** fields are included and in the **correct position** (e.g., `provider:repo/path#ref` not `provider:repo#ref/path`)
- [ ] Verify that **action functions** called after a shortcut don't internally use the old catch-all fetch — they must use the probe-quality variant when error distinction matters

**Real-world example**: Custom registry flow had 8 bugs across 3 review rounds: (1) probe only ran in interactive mode, (2) transient errors fell through to wrong mode, (3) giget URI had `#ref` in wrong position, (4) prefetched templates leaked across source switches, (5) `--template` shortcut bypassed probe but `downloadTemplateById` internally used catch-all `fetchTemplateIndex`, turning timeouts into "Template not found".

**Real-world example**: Agent-session update hints fetched npm `latest` metadata with `response.read(4096)` and then parsed it as complete JSON. The `@mindfoldhq/trellis` package metadata exceeded 4 KB, so the JSON was truncated, parse failed silently, and the first session injection showed no update hint. Fix: read the complete response before parsing, and add a regression where `version` is followed by an 8 KB metadata tail.

---

## When to Create Flow Documentation

Create detailed flow docs when:
- Feature spans 3+ layers
- Multiple teams are involved
- Data format is complex
- Feature has caused bugs before

---

## Known Ceiling: `chat_stream` / `runRigChat` Has No `systemPrompt` Param

When orchestrating a one-shot LLM pass from the frontend (e.g. polish-style calls that transcribe → apply a prompt template → return text), the current `runRigChat` (`apps/desktop/src/services/rigChat.ts`) + `chat_stream` Rust command (`apps/desktop/src-tauri/src/chat.rs`) lack a `systemPrompt` argument. The Rust side hardcodes a `PREAMBLE` and there's no `skipHistory` toggle either.

**Current workaround** (used by voice polish in `apps/desktop/src/hooks/useVoiceInput.ts`): prepend the polish prompt to the user transcript as the `prompt` field, with each call using a unique `sessionId` so prior polish history doesn't leak. The default polish prompt ends with "原始文本:" so the concatenation reads naturally. Marked with a `ponytail:` comment in source.

**Upgrade path** when this becomes a problem (file litter, preamble interference, history bleed):
- Add `system_prompt: Option<String>` + `skip_history: bool` params to `chat_stream`.
- Plumb through `runRigChat({ ...args, systemPrompt?, skipHistory? })`.
- Update voice polish to pass `polishPrompt` as `systemPrompt` (clean system/user separation).

**Checklist before adding a new one-shot LLM orchestration**:
- [ ] Does the call need system/user prompt separation? If yes, you're blocked by this ceiling — either accept the prepend workaround or upgrade `chat_stream` first.
- [ ] Will the call accumulate across user sessions? If yes, mint a unique `sessionId` per call so history doesn't bleed (the voice polish pattern).
- [ ] Does the call need streaming UI? `runRigChat` returns a `CliStreamEvent` stream — wire `onEvent` for incremental text. Polish-style one-shot calls can drain + resolve on `done` instead.

