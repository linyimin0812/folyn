# Separate service findings, outside the UI refinement

These are code inspection findings, not fixes or end-to-end benchmarks. User clarified this turn concerns layout and reading.

- `retrievalLoop.ts` actions expose list_topics/open_topic/search/read_source, with no action to read the per-source structural index. `kbAsk.ts` does not read source index nodes. The current retrieval loop therefore cannot navigate the generated source structure as intended; resolving this requires a separate retrieval behavior change and fixtures.
- `kbAsk.ts` readSource reads current file text and computes actualHash, but puts manifest currentHash on returned evidence. When the file changed, the text and labelled version differ, even though status warns. Evidence should identify the exact read version in a future fix with tests.
- Default 10s retrieval budget starts inside runRetrievalLoop, after ensureIndex. Cold load/index time is excluded; existing tests do not establish the end-to-end 1,000-document target. Also in-flight model calls are only checked at round boundaries, as existing code explicitly documents.
