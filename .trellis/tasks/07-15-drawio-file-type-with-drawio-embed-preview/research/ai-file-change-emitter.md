# Research: AI `file_change` event emitter — what the CLI adapter produces and when

- **Query**: Where/when is `file_change` emitted, what's the content shape, is real-time (mid-modification) rendering possible with the current event flow?
- **Scope**: internal
- **Date**: 2026-07-15

## TL;DR

`file_change` is emitted **once per completed write/edit tool call**, AFTER the tool returns its result. It carries the FULL new file content (re-read from disk). There is **no token-streaming, no patch/diff, no partial/delta mechanism** anywhere in the pipeline. Real-time rendering "while AI is mid-modification" is NOT possible with the current architecture — the event only fires after the whole tool call is done.

The existing research file `ai-file-modification-paths.md` covers what the desktop side does with `file_change` once it arrives (it enters diff-review mode and does NOT bump `externalContentVersion`, so the iframe does not reload). This file covers the producer side.

## Emitter location

`packages/cli-adapter/src/claudeAdapter.ts` — `ClaudeAdapter` is the only emitter of `file_change` `CliStreamEvent`s in the repo. It wraps the `claude` CLI run with `--output-format stream-json --verbose` (claudeAdapter.ts:320) and translates the CLI's JSON stream blocks into `CliStreamEvent`s.

The desktop consumer code (`AiPanel.tsx:302`, `featureAgentService.ts:376`) just listens to `CliAdapter.onEvent` — it does not itself detect file writes. All file-change detection happens inside `ClaudeAdapter`.

## Type definition

`packages/cli-adapter/src/types.ts:26-32`:

```ts
export interface FileChange {
  path: string;          // relative to workingDir
  oldContent: string;    // snapshot read BEFORE the tool ran
  newContent: string;    // FULL file content re-read from disk AFTER the tool returned
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: number;
}
```

`CliStreamEvent` (types.ts:44-53) adds `fileChange?: FileChange` as an optional field on the `'file_change'` variant (types.ts:39).

**Shape**: full file content, both old and new. No diff, no patch, no hunks, no ranges. `oldContent` is captured up-front; `newContent` is read from disk post-tool.

## When the emitter fires

There are exactly two code paths that call `this.emit({ type: 'file_change', fileChange })`:

### Path A — `handleToolComplete(toolId)` (claudeAdapter.ts:228-248)

Triggered when a `tool_result` block arrives from the CLI stream (lines 172-179, 184-189, 192-194 all call `handleToolComplete(toolId)` after emitting `tool_end`).

```ts
private async handleToolComplete(toolId: string): Promise<void> {
  const info = this.pendingWriteTools.get(toolId);
  if (!info) return;
  this.pendingWriteTools.delete(toolId);
  if (this.pendingFileContents.has(info.relativePath)) return; // skip if Path B pending
  try {
    const newContent = await readTextFile(info.absolutePath);  // re-read from DISK
    const fileChange: FileChange = { path, oldContent: '', newContent, status: 'pending', createdAt: Date.now() };
    this.emit({ type: 'file_change', fileChange });
  } catch { /* file may have been deleted */ }
}
```

Note: `oldContent: ''` here — the before-snapshot is stored in `pendingFileContents` (set in `snapshotBeforeWrite`), which Path A checks and skips if present. So Path A only fires when the 500ms timer in Path B has not yet fired.

### Path B — `checkFileChange` (claudeAdapter.ts:265-288), fired by a 500ms `setTimeout` set in `snapshotBeforeWrite` (line 262)

```ts
setTimeout(() => this.checkFileChange(relativePath, absolutePath, toolId), 500);
```

Path B reads disk, compares to the snapshot, and emits `file_change` with the real `oldContent` if changed. Path A and Path B are mutually exclusive (Path A early-returns when `pendingFileContents.has(...)` is still true; Path B deletes the pending entry first).

### What triggers detection in the first place — `handleToolUse` (claudeAdapter.ts:206-226)

Called when the CLI stream emits a `tool_use` block (lines 144-156, on `block.type === 'tool_use'`). It only fires for these tool names (the hardcoded whitelist at line 211):

```ts
const WRITE_TOOL_NAMES = new Set(['write', 'edit', 'write_file', 'edit_file', 'writefile', 'editfile']);
```

It extracts `file_path`/`path`/`filePath` from the tool input, registers the pending tool, takes a before-snapshot via `readTextFile`, and schedules the 500ms `checkFileChange`.

## Answers to the specific questions

1. **Where is `file_change` emitted?** Only in `packages/cli-adapter/src/claudeAdapter.ts` (lines 244 and 283). The desktop side (`AiPanel.tsx`, `featureAgentService.ts`, `aiStore.ts`) only consumes.

2. **When does the emitter fire `file_change`?**
   - **Once per completed write/edit tool call.** Not streamed during token generation. Not once at end of turn. Per tool call.
   - If the AI makes multiple Edit/Write tool calls in one turn (e.g. 5 edits to the same file), the emitter fires up to 5 `file_change` events — one per tool-result arrival. (Subject to the 500ms-timer vs tool-complete race; in practice the tool_result block typically arrives well within 500ms of the tool_use block, so Path A usually wins and Path B is a fallback.)
   - **One tool call = one file_change event.** If the AI uses a single big `Write` call that rewrites the whole .drawio, that's ONE event, after the Write returns.

3. **Content shape?** `FileChange` carries `oldContent` + `newContent` as full file strings (re-read from disk via `readTextFile`). No diff, no patch, no hunk list, no byte ranges.

4. **How does the AI agent loop modify files?** The AI (Claude Code CLI itself, driven via `claude --print --output-format stream-json`) emits tool_use blocks for `Write`/`Edit` tools. Each tool_use → tool_result pair is one write to disk by the CLI. The adapter detects each pair and emits one `file_change`. So:
   - **One tool call per modification → multiple `file_change` events per turn** if the AI calls the tool multiple times.
   - **No token-by-token streaming of file content.** The CLI's stream-json only emits tool_use (with full input) and tool_result (with output text); the actual file is written by the CLI's tool implementation, atomically, between those two events. The adapter only learns the file changed AFTER the result returns.
   - **Patch vs full-rewrite:** both `Edit` (patch-style, with old/new hunks) and `Write` (full rewrite) tool calls are detected, but the adapter's emitted `FileChange.newContent` is ALWAYS the full file content read from disk post-write — regardless of whether the AI used Edit or Write. The adapter does not pass through the AI's patch payload.

5. **Is there any streaming-file-content mechanism?** Grep across `packages/cli-adapter` for `file_patch|partial|incremental|delta|file_delta|file_partial` → **zero matches**. There is no partial, streaming, or delta file-content event in the `CliStreamEvent` union (types.ts:34-42: text, thinking, tool_start, tool_end, file_change, session_id, error, done). The only "streamed" thing is `text` (the assistant's prose tokens) and `thinking` — neither carries file content.

6. **`.drawio`-specific streaming?** None. Grep for `drawio.*stream|stream.*drawio|drawio.*file_change|file_change.*drawio` → zero matches in `apps/desktop/src`. The adapter's `WRITE_TOOL_NAMES` whitelist has no drawio awareness; the file extension is irrelevant to the emitter.

## Implications for real-time rendering

With the current emitter architecture, "AI边修改边实时渲染" is only possible at the granularity of **completed tool calls**. Specifically:

- If the AI performs N separate Edit/Write tool calls against the same .drawio file in one turn, the desktop can in principle re-render N times (one per `file_change` event).
- BUT the desktop's `addFileChange` handler (`aiStore.ts:253-272`, documented in the existing research file) currently routes to `enterDiffReview`, which does NOT bump `externalContentVersion` and therefore does NOT remount the DrawioEditor iframe. So even the per-tool-call granularity is not currently surfaced to the iframe. That's a consumer-side gap, separate from the emitter.
- True token-level "while AI is writing the file" rendering is **not possible** with the current emitter — the CLI does not expose partial file content mid-tool-call, and the adapter has nothing to emit until `readTextFile(absolutePath)` returns a changed file post-tool-result.

## Related specs

- `.trellis/spec/cli-adapter/frontend/state-management.md` — mentions `fileChange` event handling in the cli-adapter frontend spec.
- `.trellis/spec/cli-adapter/frontend/type-safety.md` — covers `FileChange` typing.
- `.trellis/spec/desktop/frontend/state-management.md` — desktop-side AI store behavior.

## Caveats / Not found

- Did not reproduce the exact ordering between Path A (`handleToolComplete`) and Path B (500ms `checkFileChange` timer) empirically. Both emit the same `file_change` shape; the difference is whether `oldContent` is `''` (Path A) or the real snapshot (Path B). Whichever fires, the consumer side treats it the same.
- Did not verify whether Claude Code CLI has any newer streaming-tool-output mode that this adapter does not yet parse. The adapter only reads the stream-json blocks documented in `claudeAdapter.ts:120-204`; if the CLI now emits a partial-write block type, this adapter ignores it.
- The desktop consumer-side behavior of `file_change` (no iframe reload for active drawio tab) is documented in `ai-file-modification-paths.md` (same research directory), not re-traced here.
