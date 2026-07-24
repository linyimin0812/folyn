# 01 — Text-only AI chat generates a BubbleTemplate (the spine)

**What to build:** The user clicks an "AI 生成" button inside `BubbleTemplateBlock` (settings → notifications). A modal opens. The user types a description, the AI replies with multi-turn streaming chat via `runRigChat`, and when the AI's reply contains a `\`\`json` fenced code block, an "导入此模板" button appears. Clicking it extracts the JSON, runs it through the existing `tryImport` validator (same path as pasted JSON), and on success adds the template and closes the modal. On failure the modal stays open with the same error path as paste. System prompt is full (BubbleTemplate schema, mustache syntax, DOMPurify constraints, `id='default'` rule, size guidance, BUILT_IN_TEMPLATES as examples, awareness of HTML/image uploads coming later). sessionId is a fresh `crypto.randomUUID()` per open — persistence is T4, not here.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] "AI 生成" button rendered in `BubbleTemplateBlock` below the template grid
- [ ] Clicking opens a modal with `ChatMessageList` + `ChatInputBox` (reuse `components/chat/`)
- [ ] User types text → click send → `runRigChat` invoked with full system prompt → streaming deltas render in the message list
- [ ] When AI's reply contains a `\`\`json` fence, "导入此模板" button renders next to the reply; when no fence, no button
- [ ] Click "导入此模板" → `tryImport(extractedJson)` called → on success `addTemplate` + modal closes
- [ ] Malformed JSON in fence → `tryImport` error path fires → error message shown in modal → modal stays open
- [ ] Unconfigured AI (`chatApiKey` empty) → modal shows configuration guidance CTA instead of input
- [ ] `extractLastJsonFence(markdownText): string | null` pure util + unit test (0/1/multiple fences, malformed JSON inside fence still extracted)
- [ ] `BubbleTemplateAIChatModal` component test: end-to-end text flow with mocked `runRigChat` (send → stream reply with json fence → import button appears → click → `tryImport` called → modal closes)
- [ ] System prompt built at modal mount; includes static schema/syntax/sanitization/id/size + dynamic `JSON.stringify(BUILT_IN_TEMPLATES)`
