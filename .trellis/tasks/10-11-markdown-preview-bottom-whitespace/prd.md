# Markdown 预览模式底部空白过大

## 问题

`PreviewPane.tsx` 给 markdown 的 `.prev-body` 无条件加了 `pb-[100vh]`(整整一屏的底部填充)。在纯预览(阅读)模式下,这块空白没有任何用途:

- 它的两个存在理由都只在 split 模式生效:
  1. 大纲标题点击把最后一个标题停到视口顶部
  2. 光标同步在短文档时仍有滚动余量(纯预览模式下 `cursorLine` 恒为 0,同步不生效)
- 用户报告:预览模式滚到底后底部一大片空白。

## 需求

- **纯预览模式**(非 split):底部改为小 padding(约 20vh),保留少量呼吸空间,滚到最后一行时内容贴近视口底部。
- **split 模式**:维持 `pb-[100vh]` 不变——光标同步对齐依赖它(曾降到 80vh 导致短文档高亮漂移,见 PreviewPane.tsx 注释)。
- 非 markdown 文件类型的 full-bleed 路径不受影响。

## 涉及文件

- `apps/desktop/src/components/work-area/PreviewPane.tsx`(markdown 分支,约 233 行)
