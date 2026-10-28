# Diagnose knowledge model JSON response failure

## Report
User sees `失败 · 模型未返回 JSON` while organizing sources. Actual provider/model/output not yet supplied; do not claim an incident root cause without it.

## Requirements
- Establish a fast deterministic regression at the real kbChatJson/runRigChat seam, reproducing the exact reported error from a scripted non-JSON/empty response.
- Diagnose response text collection and parsing separately. Existing kbChatJson currently makes one request and extracts with a greedy brace regex.
- Fix verified response handling gaps; do not fabricate knowledge, swallow provider errors, or mark incomplete output successful.
- Keep recovery bounded. Preserve caller validation and model/file-write separation. Surface actionable error categories and operation context while avoiding raw source/prompt/credential logging.
- Preserve unrelated existing changes. No whole-project builds/typecheck or Rust compilation.

## Acceptance
- Regression fails with original code using the exact reported error; passes after the targeted correction.
- Valid JSON remains one request; provider errors are propagated without format retries; final malformed response fails visibly.
- Empty or thinking-only output is differentiated from an ordinary non-JSON answer.
- Indexing vs topic synthesis phase is visible in per-source failure feedback.
- Existing knowledge-related targeted tests pass; no new dependencies unless justified.

## Scope
Knowledge model bridge and minimal error context in source build. Do not change global provider architecture or claim the real native incident was reproduced using only mocks.
