# 02 — Paperclip button + HTML file upload input mode

**What to build:** Inside the T1 modal's `ChatInputBox`, the `leadingSlot` hosts a single paperclip button with `accept=".html,.htm,image/*"`. On file pick, MIME-dispatch: `text/html` → `readTextFile` → wrap as "把以下 HTML 改造成 BubbleTemplate（须过 DOMPurify、剥 on*、不能引用外链资源）：\n\`\`\`html\n<original>\n\`\`\`" → push a `PendingAttachment` with `type='file'` showing a file-name chip. Image branch is a noop (or briefly warns "image upload coming soon") — T3 implements it. On send, the wrapped HTML text is part of the user's chat message.

**Blocked by:** 01 — needs the modal spine from T1.

**Status:** ready-for-agent

- [ ] Paperclip button rendered in modal's `ChatInputBox.leadingSlot`
- [ ] `accept=".html,.htm,image/*"` filters at the OS file-picker level
- [ ] Picking a `.html`/`.htm` file → `readTextFile` reads it → wrapped into transformation prompt → file-name chip displayed above input
- [ ] Picking an image → noop / brief "image upload coming soon" notice (T3 will replace)
- [ ] On send, the wrapped HTML is part of the user's message; AI's reply can still produce a `\`\`json` fence → import works
- [ ] `PendingAttachment` chip rendering reuses `components/chat/attachments.ts` types
- [ ] Modal component test extended: HTML-pick path injects wrapped text into the send payload
