# sq3r modal shows actual pre-read content

## Goal

弹窗显示 AI 拒绝文本"Reflexion 的 SQ3R 预读块已存在于 `## 笔记` 段...append-only 下不重复追加"而不是预读内容。根因：study session 复用 + 历史污染。

## Background

- `agent开发学习` 主题被重命名为 `agent开发`（文件改名 `agent开发学习.md` → `agent开发.md`），但：
  - aiStore 里的 study session `1787098496606-4z1dfi`（studyTopic: agent开发学习, 170 msgs）仍存留。
  - `editor_openTabs_ms97cswahwoyn.json` 残留 `agent开发学习.md` tab。
  - session msg 161-169 含 Reflexion SQ3R 的拒绝 pattern（"已存在...不重复追加"）。
- 用户在 stale tab 上点 Reflexion SQ3R → `active.slug = 'agent开发学习'` → `getOrCreateStudySession` orphan scan 找到坏 session → resume → AI 加载新契约但看历史里的拒绝 pattern → 跟着拒绝。
- `studyStore.deleteTopic` 只删文件 + refreshFileTree，没清 aiStore session。重命名/删除 topic 都会留孤儿 session。

## Requirements

1. **删孤儿 session 文件**：`/Users/yiminlin/.folyn/vaults/ms97cswahwoyn/1787098496606-4z1dfi.json`（studyTopic: agent开发学习，topic 文件已不存在）。同时清掉 editor_openTabs 里的 stale `agent开发学习.md` 条目。
2. **`deleteTopic` 同步删 session**：`studyStore.deleteTopic(slug)` 调用 `aiStore.deleteSession` 删该 slug 的 study session（通过 `getStudySessionId(slug)` 拿 id，再 `deleteSession(id)`）。避免未来产生孤儿 session。

## Acceptance Criteria

- [ ] 删除 `/Users/yiminlin/.folyn/vaults/ms97cswahwoyn/1787098496606-4z1dfi.json`
- [ ] `editor_openTabs_ms97cswahwoyn.json` 不再含 `agent开发学习.md`
- [ ] `studyStore.deleteTopic` 调 `aiStore.deleteSession` 清理 study session
- [ ] 用户重启 app + 打开 `agent开发` topic + 点 Reflexion SQ3R → 弹窗显示 `**大纲**` + `**预读问题**` markdown 文本

## Definition of Done

- 测试：`studyStore.test.ts` 加用例验证 deleteTopic 调用 deleteSession（mock aiStore）
- 行为变更点在 commit message 写清

## Out of Scope

- 给 study session 加 UI 清理按钮（用户暂未要求，ponytail 不扩）
- 让 SQ3R 强制走 fresh session（破坏 grill/plan/feynman 多轮复用，先不做）
- 修 stale tab 自动清理逻辑（editor 层面，与 study 无关，单独提）

## Technical Approach

### 操作修复

```bash
rm /Users/yiminlin/.folyn/vaults/ms97cswahwoyn/1787098496606-4z1dfi.json
# editor_openTabs_ms97cswahwoyn.json 移除 agent开发学习.md 条目
```

### 代码修复

`apps/desktop/src/store/studyStore.ts:309-320` `deleteTopic`：

```ts
deleteTopic: async (slug) => {
  const vault = useVaultStore.getState();
  const target = get().topics.find((t) => t.slug === slug);
  if (!target) return;
  try {
    await vault.deleteFile(target.path);
  } catch { /* 文件可能已被外部删除 */ }
  // 同步清理 aiStore 里的 study session，避免孤儿 session 被 orphan scan 复用污染下次同 slug 主题。
  const { useAiStore } = await import('@/store/aiStore');
  const ai = useAiStore.getState();
  const sid = ai.getStudySessionId(slug);
  if (sid) ai.deleteSession(sid);
  useVaultStore.getState().refreshFileTree().catch(() => {});
  await get().refresh();
},
```

## Decision (ADR-lite)

**Context**: 重命名/删除 topic 留下孤儿 study session，orphan scan 在下次同 slug 时复用污染 AI 行为。
**Decision**: `deleteTopic` 同步删 aiStore session。dynamic import aiStore 避免循环依赖（与 featureAgentService 同模式）。
**Consequences**: 删 topic 时连 study 对话历史一起清。对真实删除场景是正确行为；对"误删"场景会丢历史——但删 topic 本身就是大动作，丢对话历史符合预期。

## Technical Notes

- 关键文件：`apps/desktop/src/store/studyStore.ts:309`、`apps/desktop/src/store/aiStore.ts:233`、`apps/desktop/src/store/aiStore.ts:200`（getStudySessionId）。
- 孤儿 session 文件：`/Users/yiminlin/.folyn/vaults/ms97cswahwoyn/1787098496606-4z1dfi.json`
- stale tab 文件：`/Users/yiminlin/.folyn/storage/editor_openTabs_ms97cswahwoyn.json`
- spec: `state-management.md`（store 间联动）、`quality-guidelines.md`（错误处理）
