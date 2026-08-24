# 移除 SKILL 设置页，内置 prompt 内联到消费点

## 目标
删除 SkillsSettings 设置页及其 store/defaults/持久化，将两个内置技能（clip-card、github-analysis）的 prompt 模板直接内联到实际消费它们的 service 中。用户自定义能力与 capability 重映射一并丢弃。

## 范围

### 删除
- `apps/desktop/src/components/settings/SkillsSettings.tsx`
- `apps/desktop/src/store/skillStore.ts`
- `apps/desktop/src/services/skillDefaults.ts`
- `apps/desktop/src/types/skill.ts`
- 各 locale `settings.json` 中 `settings.skills` 节点与 `settings.tabs.skills`

### 改造（消费点直接使用内置 prompt 字符串）
- `apps/desktop/src/services/clipService.ts:112` — clip capability，原 `clip-card` 模板
- `apps/desktop/src/services/githubAnalysisService.ts:127` — `github-analysis` 模板
- `apps/desktop/src/services/planMyDayService.ts:324` — 复用 clip capability，同 clip-card 模板

### 入口移除
- `apps/desktop/src/store/navStore.ts:7` — `'skills'` tab 类型
- `apps/desktop/src/components/settings/primitives.tsx:35` — NAV_GROUPS 菜单项
- `apps/desktop/src/components/pages/SettingsPage.tsx:11,298-300` — import 与渲染分支

## 非目标
- 不保留用户自定义 skill 的迁移路径
- 不清理 `~/.folyn/storage/skills_*.json` 孤儿文件（用户本地文件，留作无害残留）
- 不动其他 settings tab

## 验收
- 设置页不再出现 Skills 入口
- clip / github-analysis / plan-my-day 三处功能行为与原先内置默认值一致
- 无类型错误、无残留 import
