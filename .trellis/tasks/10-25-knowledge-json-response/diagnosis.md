# Knowledge JSON failure diagnosis

## Incident evidence

User reports `失败 · 模型未返回 JSON`. Original provider/model/raw reply not available; Folyn native app was not running in the app inventory. Do not treat synthetic reproduction as confirmation of the incident root cause.

## Red loop

Command: `pnpm exec vitest run apps/desktop/src/services/knowledge/kbLlm.responses.test.ts`.
Original implementation: 4 tests, 1 pass, 3 failed; recovery rejected `Error: 模型未返回 JSON`, empty and thinking-only both returned that same generic error. Main independently reran the same command and observed exit 1 with these 3 failures (1.35s).

## Ranked hypotheses and probes

1. Ordinary prose returned instead of JSON: inject prose then valid JSON at runRigChat seam; original call fails immediately instead of bounded recovery.
2. Empty or thinking-only response: inject separate event types; original diagnostic conflates them with format failures. Thinking must never be used as knowledge data.
3. Greedy extraction rejects valid fenced/wrapped JSON: test prose braces, string escapes, multiple objects and truncated outer objects separately. Improve only local knowledge response handling, not global extractJsonObject callers.
4. Native stream collection ordering: runRigChat awaits invoke, does not explicitly await channel Done. Native transport ordering not reproduced; no global stream behavior change without evidence.

Rust inspection confirms per-call preamble reaches all provider arms, and text/thinking events are distinct. Anthropic arm caps max_tokens at 4096, but provider is unknown, so truncation remains unconfirmed.

## Correction boundary

Bounded one extra format-constrained request for textual format failures; empty/thinking-only receive explicit error; provider/network failures propagate without format retry. No jsonrepair, invented values, raw source/output logs, or Rust changes. Caller claim/index/version validation remains responsible for all writes. Per-source errors identify indexing vs synthesis before replacing status with error.

## Verification outcome

- 5 targeted files / 41 tests passed: bridge responses (16), pair resolution (2), build phase (2), ingestion helpers (5), synthesis (16).
- Syntax parsing of the 4 affected TypeScript files and scoped diff checks passed; no whole-project build/typecheck or Rust compile.
- Review confirmed source failure phase is captured explicitly before status changes, and empty-payload error events cannot be swallowed by a truthiness check.
- No global stream timing changes. Actual provider/raw response remains unknown; original model/source retry is still required to verify incident recovery.
