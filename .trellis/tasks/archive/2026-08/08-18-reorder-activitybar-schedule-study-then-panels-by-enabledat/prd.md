# Reorder ActivityBar: Schedule → Study → panels-by-enabledAt

## Context
当前 `ActivityBar.tsx` 顺序：visiblePanels（files=0, wiki=10, clips=20, analyze=30）→ Schedule → Study → spacer → settings。用户要求调整为：

1. **日程工作台（Schedule）固定顶部第一**
2. **学习（Study）固定第二**
3. **Files 永远启用，在面板区排第一**
4. **Wiki / Clips / Analyze 默认关闭**，被用户开启后按「首次启用时间戳」由早到晚排序

「开启时间」= 用户把对应 enable flag 从 false 切到 true 的时间点（首次）。现有 appearanceStore 只有 boolean flag，没有时间戳字段，需要扩展。

## Decisions

### D1: appearanceStore 增加 enabledAt 字段
新增 `enabledAtWiki` / `enabledAtClips` / `enabledAtAnalyze`（`number | undefined`，存 `Date.now()`）。

setter 规则：
- `setEnableWikiPanel(true)`：当前为 false 时设 `enabledAtWiki = Date.now()`；当前为 true 时不动
- `setEnableWikiPanel(false)`：清空 `enabledAtWiki = undefined`

加入 PERSIST_KEYS_APPEARANCE，hydrate 兼容（缺字段=undefined）。

### D2: 默认值改为 false
`enableWikiPanel` / `enableClipsPanel` / `enableAnalyzePanel` 默认值从 `true` 改为 `false`。已持久化的老用户值不变（hydrate 优先），但他们的 enabledAt 可能是 undefined（升级前没记过）—— 此时回退到 base order（10/20/30）保持稳定顺序，并把他们下次切换视为「重新启用」补上时间戳。

### D3: featurePanelStore 增加 setOrder
新增 `setOrder(id: string, order: number)` 方法，用于动态调整已注册面板的 sort key。register 时的初始 order 保留不变（files=0, wiki=10, clips=20, analyze=30），后续由 registerBuiltinPanels 的 appearanceStore 订阅按 enabledAt 更新。

### D4: registerBuiltinPanels 的订阅扩展
在现有 `useAppearanceStore.subscribe` 回调里，当某 flag 从 false→true 时，调用 `featurePanelStore.setOrder(id, enabledAt ?? baseOrder)`；当 true→false 时无需改 order（面板已 invisible，不影响排序）。

初始注册时（registerBuiltinPanels 开头的 `fps.register({...})`）：wiki/clips/analyze 的 `order` 字段直接用 `enabledAt ?? baseOrder`。

### D5: ActivityBar JSX 调整
把现有 Schedule / Study 两个 button 移到 `visiblePanels.map` 之前。原顺序：
```tsx
{visiblePanels.map(...)}  // files, wiki, clips, analyze
<ScheduleButton/>
<StudyButton/>
```
新顺序：
```tsx
<ScheduleButton/>
<StudyButton/>
{visiblePanels.map(...)}  // files (order=0) always first, others by enabledAt
```

useVisiblePanels 的 sort（featurePanelStore.ts:96）保持不变：`(order asc, registration idx asc)`。files 的 order=0 永远最小所以永远第一；wiki/clips/analyze 的 order 被 registerBuiltinPanels 按 enabledAt 动态更新，自然按时间戳升序排列。

## Out of scope
- plugin 面板的 order —— 第三方面板仍走 register 时的初始 order，不参与 enabledAt 排序（它们有自己的 order 字段，用户也不通过 enable flag 启用）。
- 持久化 activePanel 的回退：wiki/clips/analyze 默认关闭后，老用户若曾把 activePanel 持久为 wiki/clips/analyze 但 flag 现在为 false，registerBuiltinPanels 现有的 mirrorActive 会 fallback 到 files，行为正确，不改。
- 测试用例改动：appearanceStore.test.ts / registerBuiltinPanels.test.ts 需要补 enabledAt setter 的测试和 setOrder 的初始化验证。

## Acceptance
1. 全新 vault：ActivityBar 顺序为 Schedule → Study → Files（其他三个面板不可见）
2. 在插件设置里启用 Wiki：Wiki 出现在 Files 之后；再启用 Clips：Clips 出现在 Wiki 之后；再启用 Analyze：Analyze 出现在 Clips 之后
3. 关闭 Clips 再开启：Clips 重新出现在最后（因为 enabledAt 被刷新为新时间戳）
4. 老用户升级：enable flag 仍为 true（hydrate 保留），但 enabledAt 为 undefined → 回退到 base order（10/20/30），顺序为 Files → Wiki → Clips → Analyze
5. Schedule / Study 在任何情况下都固定在顶部前两位
