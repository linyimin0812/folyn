# 04 — 全局"重新拉取全部" + JSON 持久化 + 孤儿 model 处理

**What to build:** T2 实现了 per-provider"获取模型"按钮但 model 列表只在内存。T4 把列表持久化到磁盘 + 加全局"重新拉取全部"按钮 + 处理孤儿 model(用户曾选过的 id 不在新 fetch 结果里)。

**`~/.quill/models.json` 单一聚合文件:** 顶层按 provider id 分段:

```json
{
  "anthropic": [{"id": "claude-sonnet-4-6", "providerId": "anthropic", "capabilities": ["vision", "reasoning"], "inputModalities": ["text", "image"], "pricing": {...}}, ...],
  "openai": [...],
  ...
}
```

**原子写:** 写到 `~/.quill/models.json.tmp` 后 `rename` 到 `~/.quill/models.json`(POSIX 原子)。per-provider 拉取:读现文件 → 替换对应 provider 段 → 原子写回。全局"重新拉取全部":并发拉所有 configured providers,settled 后一次性原子写回(全文件替换,不是按段写)。

**`modelRegistryStore`(新 zustand store 或 `aiConfigStore` 内 slice — 实现者按现有惯例选):**
- state: `modelsByProvider: Record<providerId, Model[]>`、`fetchStatus: Record<providerId, 'idle' | 'loading' | 'success' | 'error'>`、`fetchError: Record<providerId, string>`、`lastFetchedAt: Record<providerId, number>`
- hydrate: app boot 时从 `~/.quill/models.json` 读 + zod 校验 → 填 `modelsByProvider` + `lastFetchedAt`
- write-through: per-provider 拉取成功 → 更新内存 state + 写回 JSON 文件段
- selectors: `modelsForProvider(pid) → Model[]`、`selectedModel() → Model | null`(查 `chatModel` + `chatProvider` 对应段)

**SettingsPage UI:**
- Chat 模式 section 标题右侧加"重新拉取全部"按钮。
- 按钮点 → 遍历所有 `chatApiKey` 非空(Ollama 跳过 key 检查)的 provider → 并发 `invoke('list_models', ...)` → 每个 provider 显示状态点(灰=未拉,黄=进行中,绿=成功,红=失败 + tooltip 错误消息)。
- 至少一个 provider 配置了 key/api_url 时按钮才 enabled;否则 disabled + tooltip"请先配置至少一个 provider"。
- 拉取期间 UI 不阻塞,用户可继续编辑其他字段。

**孤儿 model 处理:**
- `chatModel` 不在当前 provider 的 `modelsByProvider[chatProvider]` 列表里时,model 下拉在列表顶部插入一个特殊 option:`<id> · 已不在可用列表`(灰色),selected。
- 用户可继续选这个孤儿 option — Rust `chat_stream` 不验证 `chatModel` 是否在缓存里,直接转发给 provider(可能 provider 仍服务旧 id,也可能 404)。
- 不在 dropdown 里的 model id 不会自动清空 `chatModel` — 用户得手动选新的。

**T2 的 per-provider"获取模型"按钮也走 `modelRegistryStore`:** 拉取成功 → 更新 state + 写回 JSON 段。T2 之前是临时存在组件 state,T4 后改为持久化 + 跨 session 复用。

**Blocked by:** 02, 03 — 所有 20 个 provider 的 list_models 路由已存在(7 Rig + OpenAICompat + Azure),否则全局刷新会调用未实现的路径

**Status:** ready-for-agent

- [ ] `~/.quill/models.json` 单一聚合文件,顶层按 provider id 分段,zod 校验
- [ ] 原子写:tmp + rename,per-provider 拉取读现文件 → 替换段 → 写回
- [ ] `modelRegistryStore`(或 `aiConfigStore` slice)存在,持 `modelsByProvider` / `fetchStatus` / `fetchError` / `lastFetchedAt`
- [ ] app boot 时从 JSON hydrate;fetch 成功后 write-through
- [ ] SettingsPage Chat 模式 section 标题右侧加"重新拉取全部"按钮
- [ ] 按钮遍历所有 configured provider 并发拉取,每 provider 状态点(灰/黄/绿/红 + tooltip)
- [ ] 按钮在零配置时 disabled + tooltip"请先配置至少一个 provider"
- [ ] 拉取期间不阻塞 UI
- [ ] 孤儿 model:`chatModel` 不在当前 provider 列表 → 下拉顶部插灰"已不在可用列表" option,selected
- [ ] 孤儿 model 不会被自动清空,用户可继续选;Rust `chat_stream` 不验证 `chatModel`
- [ ] T2 的 per-provider"获取模型"按钮也走 `modelRegistryStore` + 持久化(之前临时存组件 state)
- [ ] app 重启后模型列表从 JSON 缓存加载,无需重新拉取
- [ ] aiConfigStore.test 扩展:`modelRegistryStore` hydrate 测试、write-through 测试、孤儿 model 渲染逻辑测试
