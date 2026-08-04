# File Templates Settings Header — No Wrap

## Goal
`FileTemplatesSettings.tsx` 头部行（line 50-53）当前 `flex items-baseline gap-2`：标题 + 描述。描述为长中文，窄页宽时会折行，与其它 settings 子页头部视觉不一致。改为单行：描述占剩余宽度，按需省略号截断，自适应页宽。

## Scope
- `apps/desktop/src/components/settings/FileTemplatesSettings.tsx:52`：描述 div 追加 `flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis`。

## Non-goals
- 不动模板列表行（已 nowrap + ellipsis）、新增行、编辑器 textarea。
- 不动其它 settings 子页头部（保持本次范围聚焦）。

## Verification
- 在窄页宽下描述不折行，末尾省略号截断；宽页宽下完整显示。
- 鼠标悬停或拉宽窗口后能看到完整文本（不强制 tooltip，靠 ellipsis 自然截断即可）。
